import { workflowBindingTerminal } from "./lifecycle"
import {
  revokeWorkflowDispatchGrantsLocked,
  withRuntimeLocks,
  type LoomRuntimeIdentity,
  type RawStorage,
} from "./runtime"
import { releaseCancelledWorkflowClaims, type WorkHierarchy } from "./work"
import type { Workflow } from "./workflow"

export type WorkflowDeletionRecordV1 = {
  schemaVersion: 1
  workflowId: string
  projectId: string
  status: "failed" | "cancelled"
  workflowRevision: number
  createdBySession: string
  deletedAt: string
  reason: string
  retainedEvidence: true
}

export type DeleteWorkflowsInput = {
  workflowIds: string[]
  reason: string
}

export type DeleteWorkflowsResult = {
  deleted: string[]
  releasedSessionIds: string[]
  deletedAt: string
}

function deletionStatus(workflow: Workflow): "failed" | "cancelled" | undefined {
  if (workflow.cancellation) return "cancelled"
  if (workflow.steps.some((step) => step.status === "failed")) return "failed"
  return undefined
}

function validDeletionRecord(
  value: unknown,
  workflowId: string,
  projectId: string,
): value is WorkflowDeletionRecordV1 {
  const record = value as WorkflowDeletionRecordV1 | undefined
  return record?.schemaVersion === 1 &&
    record.workflowId === workflowId &&
    record.projectId === projectId &&
    (record.status === "failed" || record.status === "cancelled") &&
    record.retainedEvidence === true
}

async function scanEntries(storage: RawStorage, prefix: string) {
  const entries: Array<{ key: string; value: unknown }> = []
  let after: string | undefined
  do {
    const page = await storage.scan({
      prefix,
      limit: 500,
      ...(after ? { after } : {}),
    })
    entries.push(...(page.entries ?? []))
    after = page.next
  } while (after)
  return entries
}

async function deleteKey(storage: RawStorage, key: string) {
  if (!storage.delete || !storage.transaction) {
    throw new Error("Workflow deletion requires transactional Loom storage.")
  }
  await storage.delete(key)
}

function localScannedKey(key: string, prefix: string) {
  if (key.startsWith(prefix)) return key
  const marker = `/${prefix}`
  const index = key.lastIndexOf(marker)
  return index >= 0 ? key.slice(index + 1) : key
}

async function deletePrefix(storage: RawStorage, prefix: string) {
  const entries = await scanEntries(storage, prefix)
  for (const entry of entries) {
    await deleteKey(storage, localScannedKey(entry.key, prefix))
  }
}

/**
 * Permanently remove failed/cancelled workflow execution records.
 *
 * Completed evidence and durable work results are intentionally retained. The
 * operational workflow record, stale session bindings, budgets, OQs, scopes,
 * and other execution-only state are removed so the workflow can no longer
 * participate in routing or agent admission.
 */
export async function deleteWorkflowRecords(
  storage: RawStorage,
  runtime: LoomRuntimeIdentity,
  input: DeleteWorkflowsInput,
): Promise<DeleteWorkflowsResult> {
  if (!storage.delete || !storage.transaction) {
    throw new Error("Workflow deletion requires transactional Loom storage.")
  }

  const workflowIds = [...new Set(input.workflowIds.map((id) => id.trim()).filter(Boolean))]
  if (
    workflowIds.length === 0 ||
    workflowIds.length > 100 ||
    workflowIds.some((id) => id.length > 512)
  ) {
    throw new Error("Workflow deletion requires between 1 and 100 bounded workflow IDs.")
  }

  const reason = input.reason.trim()
  if (!reason || reason.length > 2000) {
    throw new Error("Workflow deletion requires a concrete reason of at most 2000 characters.")
  }

  const [snapshots, deletionRecords] = await Promise.all([
    Promise.all(
      workflowIds.map((id) => storage.get(`workflow/${id}`) as Promise<Workflow | undefined>),
    ),
    Promise.all(
      workflowIds.map((id) => storage.get(`workflow-deletion/${id}`)),
    ),
  ])

  for (let index = 0; index < workflowIds.length; index++) {
    const workflow = snapshots[index]
    if (!workflow) {
      if (validDeletionRecord(deletionRecords[index], workflowIds[index]!, runtime.projectId)) {
        continue
      }
      throw new Error(`Workflow ${workflowIds[index]} was not found.`)
    }
    if (workflow.projectId !== runtime.projectId) {
      throw new Error(`Workflow ${workflow.id} belongs to another project.`)
    }
    if (!deletionStatus(workflow) || !workflowBindingTerminal(workflow)) {
      throw new Error(
        `Workflow ${workflow.id} is not a terminal failed/cancelled workflow. Cancel active work before deleting it.`,
      )
    }
  }

  const resources = [
    ...workflowIds.map((id) => ({ aggregate: "workflow", resourceIdentity: id })),
    ...[...new Set(
      snapshots
        .map((workflow) => workflow?.work?.objectiveId)
        .filter((value): value is string => Boolean(value)),
    )].map((id) => ({ aggregate: "work", resourceIdentity: id })),
  ]

  return withRuntimeLocks(runtime, resources, async () =>
    storage.transaction!(async () => {
    const [workflows, currentDeletionRecords] = await Promise.all([
      Promise.all(
        workflowIds.map((id) => storage.get(`workflow/${id}`) as Promise<Workflow | undefined>),
      ),
      Promise.all(
        workflowIds.map((id) => storage.get(`workflow-deletion/${id}`)),
      ),
    ])

    for (let index = 0; index < workflowIds.length; index++) {
      const before = snapshots[index]
      const workflow = workflows[index]
      if (!workflow) {
        if (validDeletionRecord(
          currentDeletionRecords[index],
          workflowIds[index]!,
          runtime.projectId,
        )) {
          continue
        }
        throw new Error(`Workflow ${workflowIds[index]} disappeared before deletion.`)
      }
      if (!before) {
        throw new Error(`Workflow ${workflow.id} reappeared after deletion; refresh and inspect state.`)
      }
      if (
        workflow.projectId !== runtime.projectId ||
        workflow.revision !== before.revision ||
        workflow.work?.objectiveId !== before.work?.objectiveId
      ) {
        throw new Error(`Workflow ${workflow.id} changed before deletion; refresh and try again.`)
      }
      if (!deletionStatus(workflow) || !workflowBindingTerminal(workflow)) {
        throw new Error(`Workflow ${workflow.id} is no longer safe to delete.`)
      }
    }

    const presentWorkflows = workflows.filter(
      (workflow): workflow is Workflow => Boolean(workflow),
    )
    const deletedAt = new Date().toISOString()
    const byObjective = new Map<string, Workflow[]>()
    for (const workflow of presentWorkflows) {
      if (!workflow.work) continue
      const list = byObjective.get(workflow.work.objectiveId) ?? []
      list.push(workflow)
      byObjective.set(workflow.work.objectiveId, list)
    }

    for (const [objectiveId, related] of byObjective) {
      const key = `work/${encodeURIComponent(objectiveId)}`
      const work = (await storage.get(key)) as WorkHierarchy | undefined
      if (!work) continue

      for (const workflow of related) {
        const durableReceipt = work.nodes.find(
          (node) => node.completion?.workflowId === workflow.id,
        )
        if (durableReceipt) {
          throw new Error(
            `Workflow ${workflow.id} owns completed Wave review history and cannot be deleted. Keep it as history instead.`,
          )
        }
      }

      let changed = false
      for (const workflow of related) {
        if (releaseCancelledWorkflowClaims(work, workflow.id, deletedAt).length > 0) {
          changed = true
        }
      }

      const deletedIds = new Set(related.map((workflow) => workflow.id))
      const retainedIds = work.workflowIds.filter((id) => !deletedIds.has(id))
      if (retainedIds.length !== work.workflowIds.length) {
        work.workflowIds = retainedIds
        work.version += 1
        work.updatedAt = deletedAt
        changed = true
      }

      if (changed) await storage.set(key, work)
    }

    for (const workflow of presentWorkflows) {
      await revokeWorkflowDispatchGrantsLocked(storage, runtime, workflow.id, deletedAt)
    }

    const workflowById = new Map(presentWorkflows.map((workflow) => [workflow.id, workflow]))
    const workflowIdSet = new Set(workflowIds)
    const releasedSessionIds: string[] = []
    const sessions = await scanEntries(storage, "session/")
    for (const entry of sessions) {
      if (typeof entry.value !== "string" || !workflowIdSet.has(entry.value)) continue
      const sessionKey = localScannedKey(entry.key, "session/")
      const sessionId = sessionKey.slice("session/".length)
      if (!sessionId) continue

      const workflow = workflowById.get(entry.value)
      // Remove stale membership from the active binding namespace. Child
      // sessions receive a separate deletion fence so old host/tool calls stay
      // denied after the workflow record is gone. The owning General session
      // is released without a fence so it can immediately start replacement
      // work.
      await deleteKey(storage, sessionKey)
      releasedSessionIds.push(sessionId)
      if (workflow && workflow.createdBySession !== sessionId) {
        await storage.set(`session-deletion-fence/${sessionId}`, {
          schemaVersion: 1,
          workflowId: workflow.id,
          deletedAt,
        })
      }
      await deleteKey(storage, `session-step/${sessionId}`)
      await deleteKey(storage, `session-oq/${sessionId}`)
      await deleteKey(storage, `session-plan-review/${encodeURIComponent(sessionId)}`)
    }

    for (const workflow of presentWorkflows) {
      const status = deletionStatus(workflow)!
      const record: WorkflowDeletionRecordV1 = {
        schemaVersion: 1,
        workflowId: workflow.id,
        projectId: workflow.projectId,
        status,
        workflowRevision: workflow.revision,
        createdBySession: workflow.createdBySession,
        deletedAt,
        reason,
        retainedEvidence: true,
      }
      await storage.set(`workflow-deletion/${workflow.id}`, record)

      await deleteKey(storage, `budget/${workflow.id}`)
      await deleteKey(storage, `limits/${workflow.id}`)
      await deleteKey(storage, `oq-index/${workflow.id}`)
      await deletePrefix(storage, `oq/${workflow.id}/`)
      await deletePrefix(storage, `scope/${workflow.id}/`)
      await deletePrefix(storage, `binding-release/${workflow.id}/`)
      await deletePrefix(storage, `work-release/${workflow.id}/`)
      await deleteKey(storage, `workflow/${workflow.id}`)
    }

    return {
      deleted: workflowIds,
      releasedSessionIds: [...new Set(releasedSessionIds)].sort(),
      deletedAt,
    }
    }),
  )
}

export async function deletedWorkflowIds(storage: RawStorage) {
  const entries = await scanEntries(storage, "workflow-deletion/")
  return new Set(
    entries
      .map((entry) => (entry.value as WorkflowDeletionRecordV1 | undefined)?.workflowId)
      .filter((id): id is string => typeof id === "string" && Boolean(id)),
  )
}
