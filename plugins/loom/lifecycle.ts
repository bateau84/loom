import { plannedTaskSteps, runnable, assertWorkflowNotCancelled, WorkflowCancelledError, type Workflow } from "./workflow"
import { assertWorkGeneration, assertCompletedWaveForTasks, releaseCancelledWorkflowClaims, type WorkHierarchy } from "./work"
import { revokeWorkflowDispatchGrantsLocked, withRuntimeLocks, type RawStorage, type LoomRuntimeIdentity } from "./runtime"

export function workflowBindingTerminal(workflow: Workflow) {
  if (workflow.cancellation) return true
  if (workflow.steps.length === 0) return false
  return workflow.steps.every((step) => ["complete", "passed", "failed"].includes(step.status)) ||
    (runnable(workflow).length === 0 && workflow.steps.some((step) => step.status === "failed"))
}

const readTools = new Set([
  "find", "grep", "select", "stats", "status", "work_status", "task_status", "scope_status",
  "oq_list", "evidence_list", "evidence_observations", "knowledge_status", "pa_status",
  "budget_status", "intent_status", "learn_query", "learn_get",
])

function loomToolLeaf(name: string) {
  return name.replace(/^tools\./, "").replace(/^loom[._](?:code[._])?/, "")
}

function readOnlyTool(name: string, input: unknown) {
  return readTools.has(name) || (name === "verification" &&
    (input as { action?: string } | undefined)?.action === "status")
}

/** Entry fence. Commit fences below remain necessary for cancellation races. */
export async function assertLoomToolAdmission(
  storage: RawStorage, name: string, input: unknown, actor: { agent: string; sessionID: string },
) {
  if (readOnlyTool(name, input)) return
  const bound = await storage.get(`session/${actor.sessionID}`)
  const workflow = bound ? await storage.get(`workflow/${bound}`) as Workflow | undefined : undefined
  const parentConversation = actor.agent === "general" && workflow?.createdBySession === actor.sessionID &&
    (name === "start" || name === "cancel" || name.startsWith("intent_") || name === "report_promote")
  // A new exact grant is the only route for reusing a cancelled child session.
  if (workflow?.cancellation && name !== "attach" && !parentConversation) {
    throw new WorkflowCancelledError(workflow.id)
  }
  const id = (input as { workflowId?: string } | undefined)?.workflowId
  if (id && name !== "cancel") {
    const target = await storage.get(`workflow/${id}`) as Workflow | undefined
    if (target) assertWorkflowNotCancelled(target)
  }
}

/** Deny new host/MCP calls from old children, not just Worker edits. */
export async function assertCancelledChildToolAdmission(
  storage: RawStorage, tool: string, input: unknown, sessionID: string,
) {
  const id = await storage.get(`session/${sessionID}`)
  const workflow = id ? await storage.get(`workflow/${id}`) as Workflow | undefined : undefined
  if (!workflow?.cancellation || workflow.createdBySession === sessionID) return
  const name = loomToolLeaf(tool)
  const isLoom = /^(?:tools\.)?loom[._]/.test(tool)
  if (isLoom && (readOnlyTool(name, input) || name === "attach")) return
  throw new WorkflowCancelledError(workflow.id)
}

export type CancelWorkflowInput = { workflowId: string; reason: string; confirmation: string }

/** One transaction: cancellation, owned claims, grant revocation, binding release. */
export async function cancelWorkflow(
  storage: RawStorage, runtime: LoomRuntimeIdentity, input: CancelWorkflowInput,
  actor: { agent: string; sessionID: string },
) {
  if (actor.agent !== "general") throw new Error("Only General may cancel a workflow.")
  if (typeof input.reason !== "string" || !input.reason.trim() || input.reason.length > 4000 ||
      typeof input.confirmation !== "string" || !input.confirmation.trim() || input.confirmation.length > 8000) {
    throw new Error("Cancellation requires a concrete reason and the exact explicit user confirmation (within 4000/8000 characters).")
  }
  const key = `workflow/${input.workflowId}`
  const snapshot = await storage.get(key) as Workflow | undefined
  if (!snapshot || snapshot.projectId !== runtime.projectId || snapshot.createdBySession !== actor.sessionID) {
    throw new Error("Cancellation requires the workflow's owning General session in this project.")
  }
  return withRuntimeLocks(runtime, [
    { aggregate: "workflow", resourceIdentity: snapshot.id },
    ...(snapshot.work ? [{ aggregate: "work", resourceIdentity: snapshot.work.objectiveId }] : []),
  ], async () => {
    const workflow = await storage.get(key) as Workflow | undefined
    if (!workflow || workflow.projectId !== runtime.projectId || workflow.createdBySession !== actor.sessionID ||
        workflow.work?.objectiveId !== snapshot.work?.objectiveId) {
      throw new Error("Workflow ownership/work binding changed; retry cancellation.")
    }
    // Retrying after the owner has started a replacement must not touch it.
    if (workflow.cancellation) return { cancelled: true, alreadyCancelled: true, workflowId: workflow.id, cancellation: workflow.cancellation }
    if (await storage.get(`session/${actor.sessionID}`) !== workflow.id) {
      throw new Error("General is no longer bound to this workflow.")
    }
    if (workflowBindingTerminal(workflow)) return { cancelled: false, terminal: true, workflowId: workflow.id }

    const at = new Date().toISOString()
    let releasedClaimIds: string[] = []
    let retainedForeignClaimIds: string[] = []
    let workMissing = false
    if (workflow.work) {
      const workKey = `work/${encodeURIComponent(workflow.work.objectiveId)}`
      const work = await storage.get(workKey) as WorkHierarchy | undefined
      workMissing = !work
      if (work) {
        if (work.objectiveId !== workflow.work.objectiveId) throw new Error("Work hierarchy identity mismatch.")
        const taskIds = new Set(plannedTaskSteps(workflow).map((step) => step.task!.id))
        const waveIds = new Set(work.nodes.filter((node) => node.generation === workflow.work!.generation &&
          node.type === "task" && taskIds.has(node.logicalId)).map((node) => node.parentId))
        retainedForeignClaimIds = work.nodes.filter((node) => node.generation === workflow.work!.generation &&
          (waveIds.has(node.id) || (node.type === "task" && taskIds.has(node.logicalId))) &&
          node.claimedByWorkflowId && node.claimedByWorkflowId !== workflow.id).map((node) => node.id)
        releasedClaimIds = releaseCancelledWorkflowClaims(work, workflow.id, at)
        if (releasedClaimIds.length) await storage.set(workKey, work)
      }
    }
    const revokedGrantIds = await revokeWorkflowDispatchGrantsLocked(storage, runtime, workflow.id, at)
    workflow.cancellation = {
      at, byAgent: "general", bySessionId: actor.sessionID,
      reason: input.reason.trim(), confirmation: input.confirmation,
      releasedClaimIds, retainedForeignClaimIds, workMissing, revokedGrantIds,
    }
    workflow.revision++
    await storage.set(key, workflow)
    await storage.set(`binding-release/${workflow.id}/${actor.sessionID}`, {
      reason: input.reason.trim(), at, by: actor.agent, kind: "cancellation",
    })
    return { cancelled: true, alreadyCancelled: false, workflowId: workflow.id, cancellation: workflow.cancellation }
  })
}

function legacyCompletionCandidate(work: WorkHierarchy, workflow: Workflow, waveId: string) {
  if (workflow.cancellation || workflow.anchor !== work.anchor || workflow.work?.objectiveId !== work.objectiveId ||
      workflow.work.generation !== work.generation || !work.workflowIds.includes(workflow.id)) return false
  const tasks = plannedTaskSteps(workflow)
  if (!tasks.length || new Set(tasks.map((step) => step.task!.id)).size !== tasks.length ||
      tasks.some((step) => step.status !== "complete" || step.agent !== "worker" || step.kind !== "work") ||
      !workflow.steps.some((step) => step.id === "review-implementation" && step.agent === "reviewer" &&
        step.kind === "gate" && step.status === "passed" &&
        tasks.every((task) => step.dependsOn.includes(task.id)))) return false
  return tasks.every((step) => work.nodes.some((node) => node.generation === work.generation &&
    node.type === "task" && node.parentId === waveId && node.logicalId === step.task!.id &&
    node.title === step.task!.title && node.objective === step.task!.objective && node.status === "complete" &&
    !node.claimedByWorkflowId))
}

/** Recover only uniquely attributable legacy review history; never claim a Wave. */
export async function ensureCompletedWaveHistory(storage: RawStorage, work: WorkHierarchy, workflow: Workflow) {
  assertWorkGeneration(work, workflow.work!.generation)
  const taskIds = plannedTaskSteps(workflow).map((step) => step.task!.id)
  const task = work.nodes.find((node) => node.generation === work.generation && node.type === "task" && node.logicalId === taskIds[0])
  const wave = work.nodes.find((node) => node.id === task?.parentId && node.type === "wave")
  if (wave?.status === "complete" && !wave.completion && !wave.claimedByWorkflowId) {
    const candidates: Workflow[] = []
    for (const id of new Set(work.workflowIds)) {
      const candidate = await storage.get(`workflow/${id}`) as Workflow | undefined
      if (candidate?.projectId === workflow.projectId && legacyCompletionCandidate(work, candidate, wave.id)) candidates.push(candidate)
    }
    if (candidates.length !== 1 || candidates[0]!.id !== workflow.id) {
      throw new Error("Legacy completed Wave has ambiguous/missing review provenance. Cancel the workflow to recover without rewriting evidence.")
    }
    wave.completion = {
      workflowId: workflow.id, generation: work.generation, taskIds: [...taskIds].sort(),
      reviewedTaskIds: work.nodes.filter((node) => node.parentId === wave.id && node.type === "task")
        .map((node) => node.logicalId).sort(),
      at: wave.updatedAt, provenance: "legacy-reviewed-workflow",
    }
    work.version++
  }
  return assertCompletedWaveForTasks(work, workflow.id, workflow.work!.generation, taskIds)
}
