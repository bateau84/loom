import { afterEach, describe, expect, test } from "bun:test"
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"
import {
  deleteWorkflowRecords,
  deletedWorkflowIds,
} from "./workflow-cleanup"
import { assertCancelledChildToolAdmission } from "./lifecycle"
import { createProjectStorage, type LoomRuntimeIdentity, type RawStorage } from "./runtime"
import type { WorkHierarchy } from "./work"
import type { Workflow } from "./workflow"

const roots: string[] = []

class MemoryStorage implements RawStorage {
  values = new Map<string, unknown>()
  failDeleteKey?: string

  async get(key: string) {
    return this.values.get(key)
  }

  async set(key: string, value: unknown) {
    this.values.set(key, value)
    return value
  }

  async delete(key: string) {
    if (key === this.failDeleteKey) throw new Error("injected delete failure")
    return this.values.delete(key)
  }

  async transaction<T>(fn: () => Promise<T>): Promise<T> {
    const before = new Map(
      [...this.values.entries()].map(([key, value]) => [key, structuredClone(value)]),
    )
    try {
      return await fn()
    } catch (error) {
      this.values = before
      throw error
    }
  }

  async scan({
    prefix,
    limit = 100,
    after = "",
  }: {
    prefix: string
    limit?: number
    after?: string
  }) {
    const all = [...this.values.entries()]
      .filter(([key]) => key.startsWith(prefix) && key > after)
      .sort(([a], [b]) => a.localeCompare(b))
    const selected = all.slice(0, limit)
    return {
      entries: selected.map(([key, value]) => ({ key, value })),
      next: all.length > selected.length ? selected.at(-1)?.[0] : undefined,
    }
  }
}

afterEach(async () => {
  while (roots.length) await rm(roots.pop()!, { recursive: true, force: true })
})

async function runtime() {
  const root = await mkdtemp(join(tmpdir(), "loom-workflow-cleanup-"))
  roots.push(root)
  return {
    installationId: "installation-test",
    instanceId: "dashboard-control",
    projectId: "project-a",
    canonicalLocation: join(root, "project"),
    identitySource: "loom-project-marker" as const,
    markerLocation: join(root, "project", ".loom", "project-id"),
    runtimeRoot: join(root, "runtime"),
    stateRoot: join(root, "state"),
  } satisfies LoomRuntimeIdentity
}

function failedWorkflow(): Workflow {
  return {
    id: "workflow-failed",
    projectId: "project-a",
    revision: 5,
    anchor: "docs/anchors/product/anchor.md",
    createdBySession: "session-general",
    createdAt: "2026-09-25T10:00:00.000Z",
    work: {
      objectiveId: "objective:docs/anchors/product/anchor.md",
      generation: 1,
    },
    steps: [
      {
        id: "task:build",
        agent: "worker",
        kind: "work",
        dependsOn: [],
        status: "complete",
      },
      {
        id: "review-implementation",
        agent: "reviewer",
        kind: "gate",
        dependsOn: ["task:build"],
        status: "failed",
      },
    ],
  }
}

function activeWorkflow(): Workflow {
  const workflow = failedWorkflow()
  workflow.id = "workflow-active"
  workflow.revision = 2
  workflow.steps[1]!.status = "pending"
  return workflow
}

function recoverableFailedWorkflow(): Workflow {
  const workflow = failedWorkflow()
  workflow.id = "workflow-recoverable"
  workflow.revision = 6
  workflow.steps = [
    {
      id: "task:failed",
      agent: "worker",
      kind: "work",
      dependsOn: [],
      status: "failed",
    },
    {
      id: "task:recover",
      agent: "worker",
      kind: "work",
      dependsOn: [],
      status: "pending",
    },
  ]
  return workflow
}

function work(): WorkHierarchy {
  return {
    objectiveId: "objective:docs/anchors/product/anchor.md",
    anchor: "docs/anchors/product/anchor.md",
    title: "product",
    objectiveStatus: "active",
    version: 4,
    generation: 1,
    workflowIds: ["workflow-failed"],
    createdAt: "2026-09-25T10:00:00.000Z",
    updatedAt: "2026-09-25T10:10:00.000Z",
    nodes: [
      {
        id: "phase:1:build",
        logicalId: "build",
        type: "phase",
        title: "Build",
        status: "active",
        generation: 1,
        createdAt: "2026-09-25T10:00:00.000Z",
        updatedAt: "2026-09-25T10:10:00.000Z",
      },
      {
        id: "wave:1:build/runtime",
        logicalId: "runtime",
        type: "wave",
        title: "Runtime",
        status: "active",
        generation: 1,
        parentId: "phase:1:build",
        claimedByWorkflowId: "workflow-failed",
        claimedAt: "2026-09-25T10:02:00.000Z",
        createdAt: "2026-09-25T10:00:00.000Z",
        updatedAt: "2026-09-25T10:10:00.000Z",
      },
      {
        id: "task:1:build",
        logicalId: "build",
        type: "task",
        title: "Build runtime",
        status: "active",
        generation: 1,
        parentId: "wave:1:build/runtime",
        claimedByWorkflowId: "workflow-failed",
        claimedAt: "2026-09-25T10:02:00.000Z",
        createdAt: "2026-09-25T10:00:00.000Z",
        updatedAt: "2026-09-25T10:10:00.000Z",
      },
    ],
  }
}

describe("workflow cleanup", () => {
  test("removes failed execution state, releases claims and keeps evidence", async () => {
    const storage = new MemoryStorage()
    const rt = await runtime()
    await mkdir(rt.canonicalLocation, { recursive: true })
    const projectSentinel = join(rt.canonicalLocation, "user-file.txt")
    await writeFile(projectSentinel, "project bytes stay untouched\n", "utf8")
    await storage.set("workflow/workflow-failed", failedWorkflow())
    await storage.set("work/objective%3Adocs%2Fanchors%2Fproduct%2Fanchor.md", work())
    await storage.set("session/session-general", "workflow-failed")
    await storage.set("session-step/session-general", "review-implementation")
    await storage.set("session/session-child", "workflow-failed")
    await storage.set("session-step/session-child", "task:build")
    await storage.set("oq-index/workflow-failed", ["OQ-1"])
    await storage.set("oq/workflow-failed/OQ-1", { id: "OQ-1" })
    await storage.set("budget/workflow-failed", { totalDispatches: 7 })
    await storage.set("limits/workflow-failed", { maxTotalDispatches: 40 })
    await storage.set("scope/workflow-failed/task:build", { read: ["**"], write: ["a.ts"] })
    await storage.set("claim/workflow-failed/task:build/claim-1", { statement: "retained evidence" })
    await storage.set("observation/obs-1", { workflowId: "workflow-failed" })

    const result = await deleteWorkflowRecords(storage, rt, {
      workflowIds: ["workflow-failed"],
      reason: "Restarted after a failed attempt.",
    })

    expect(result.deleted).toEqual(["workflow-failed"])
    expect(result.releasedSessionIds).toEqual(["session-child", "session-general"])
    expect(await storage.get("workflow/workflow-failed")).toBeUndefined()
    expect(await storage.get("session/session-general")).toBeUndefined()
    expect(await storage.get("session/session-child")).toBeUndefined()
    expect(await storage.get("session-step/session-child")).toBeUndefined()
    expect(await storage.get("session-deletion-fence/session-child")).toMatchObject({
      schemaVersion: 1,
      workflowId: "workflow-failed",
    })
    await expect(
      assertCancelledChildToolAdmission(
        storage,
        "bash",
        { command: "pwd" },
        "session-child",
      ),
    ).rejects.toThrow("was deleted")
    await expect(
      assertCancelledChildToolAdmission(
        storage,
        "loom_status",
        {},
        "session-child",
      ),
    ).resolves.toBeUndefined()
    await expect(
      assertCancelledChildToolAdmission(
        storage,
        "tools.loom.code.status",
        {},
        "session-child",
      ),
    ).resolves.toBeUndefined()
    expect(await storage.get("oq/workflow-failed/OQ-1")).toBeUndefined()
    expect(await storage.get("budget/workflow-failed")).toBeUndefined()
    expect(await storage.get("scope/workflow-failed/task:build")).toBeUndefined()
    expect(await storage.get("claim/workflow-failed/task:build/claim-1")).toEqual({
      statement: "retained evidence",
    })
    expect(await storage.get("observation/obs-1")).toEqual({
      workflowId: "workflow-failed",
    })
    expect(await readFile(projectSentinel, "utf8")).toBe("project bytes stay untouched\n")

    const remainingWork = (await storage.get(
      "work/objective%3Adocs%2Fanchors%2Fproduct%2Fanchor.md",
    )) as WorkHierarchy
    expect(remainingWork.workflowIds).toEqual([])
    expect(remainingWork.nodes.some((node) => node.claimedByWorkflowId === "workflow-failed")).toBe(false)

    expect(await deletedWorkflowIds(storage)).toEqual(new Set(["workflow-failed"]))
    expect(await storage.get("workflow-deletion/workflow-failed")).toMatchObject({
      schemaVersion: 1,
      workflowId: "workflow-failed",
      projectId: "project-a",
      status: "failed",
      retainedEvidence: true,
    })
  })

  test("cleanup works through project-scoped storage and revokes grants without double-prefixing keys", async () => {
    const raw = new MemoryStorage()
    const scoped = createProjectStorage(raw, "project-a")
    const rt = await runtime()
    await scoped.set("workflow/workflow-failed", failedWorkflow())
    await scoped.set("session/session-general", "workflow-failed")
    await scoped.set("dispatch-grant/grant-1", {
      schemaVersion: 1,
      grantId: "grant-1",
      projectId: "project-a",
      workflowId: "workflow-failed",
      stepId: "review-implementation",
      expectedAgent: "reviewer",
      issuingParentSessionId: "session-general",
      createdAt: "2026-09-25T10:00:00.000Z",
      expiresAt: "2026-09-25T11:00:00.000Z",
    })

    await deleteWorkflowRecords(scoped, rt, {
      workflowIds: ["workflow-failed"],
      reason: "Remove failed restart.",
    })

    expect(await raw.get("project/project-a/workflow/workflow-failed")).toBeUndefined()
    expect(await raw.get("project/project-a/session/session-general")).toBeUndefined()
    expect(await raw.get("project/project-a/dispatch-grant/grant-1")).toMatchObject({
      grantId: "grant-1",
      revokedAt: expect.any(String),
    })
    expect(
      [...raw.values.keys()].some((key) => key.includes("project/project-a/project/project-a")),
    ).toBe(false)
  })

  test("cleanup retry is idempotent after an uncertain response", async () => {
    const storage = new MemoryStorage()
    const rt = await runtime()
    await storage.set("workflow/workflow-failed", failedWorkflow())

    const first = await deleteWorkflowRecords(storage, rt, {
      workflowIds: ["workflow-failed"],
      reason: "Initial cleanup.",
    })
    const tombstone = structuredClone(
      await storage.get("workflow-deletion/workflow-failed"),
    )

    const retry = await deleteWorkflowRecords(storage, rt, {
      workflowIds: ["workflow-failed"],
      reason: "Retry after response was lost.",
    })

    expect(first.deleted).toEqual(["workflow-failed"])
    expect(retry.deleted).toEqual(["workflow-failed"])
    expect(await storage.get("workflow/workflow-failed")).toBeUndefined()
    expect(await storage.get("workflow-deletion/workflow-failed")).toEqual(tombstone)
  })

  test("rolls back canonical state when cleanup fails mid-transaction", async () => {
    const storage = new MemoryStorage()
    const rt = await runtime()
    await storage.set("workflow/workflow-failed", failedWorkflow())
    await storage.set("work/objective%3Adocs%2Fanchors%2Fproduct%2Fanchor.md", work())
    await storage.set("session/session-general", "workflow-failed")
    await storage.set("session-step/session-general", "review-implementation")
    storage.failDeleteKey = "session-step/session-general"

    await expect(
      deleteWorkflowRecords(storage, rt, {
        workflowIds: ["workflow-failed"],
        reason: "Exercise rollback.",
      }),
    ).rejects.toThrow("injected delete failure")

    expect(await storage.get("workflow/workflow-failed")).toMatchObject({ id: "workflow-failed" })
    expect(await storage.get("session/session-general")).toBe("workflow-failed")
    expect(await storage.get("session-step/session-general")).toBe("review-implementation")
    expect(await storage.get("workflow-deletion/workflow-failed")).toBeUndefined()
    const retainedWork = (await storage.get(
      "work/objective%3Adocs%2Fanchors%2Fproduct%2Fanchor.md",
    )) as WorkHierarchy
    expect(retainedWork.workflowIds).toEqual(["workflow-failed"])
    expect(retainedWork.nodes.some((node) => node.claimedByWorkflowId === "workflow-failed")).toBe(true)
  })

  test("refuses to delete active work", async () => {
    const storage = new MemoryStorage()
    const rt = await runtime()
    await storage.set("workflow/workflow-active", activeWorkflow())

    await expect(
      deleteWorkflowRecords(storage, rt, {
        workflowIds: ["workflow-active"],
        reason: "Should not be allowed.",
      }),
    ).rejects.toThrow("not a terminal failed/cancelled workflow")
  })

  test("refuses a failed workflow while independent recovery work is still runnable", async () => {
    const storage = new MemoryStorage()
    const rt = await runtime()
    await storage.set("workflow/workflow-recoverable", recoverableFailedWorkflow())

    await expect(
      deleteWorkflowRecords(storage, rt, {
        workflowIds: ["workflow-recoverable"],
        reason: "Must stay recoverable.",
      }),
    ).rejects.toThrow("not a terminal failed/cancelled workflow")
  })

  test("refuses deletion when durable completed Wave history depends on the workflow", async () => {
    const storage = new MemoryStorage()
    const rt = await runtime()
    const hierarchy = work()
    const wave = hierarchy.nodes.find((node) => node.type === "wave")!
    wave.status = "complete"
    delete wave.claimedByWorkflowId
    delete wave.claimedAt
    wave.completion = {
      workflowId: "workflow-failed",
      generation: 1,
      taskIds: ["build"],
      reviewedTaskIds: ["build"],
      at: "2026-09-25T10:15:00.000Z",
      provenance: "implementation-review",
    }
    const task = hierarchy.nodes.find((node) => node.type === "task")!
    task.status = "complete"
    delete task.claimedByWorkflowId
    delete task.claimedAt

    await storage.set("workflow/workflow-failed", failedWorkflow())
    await storage.set("work/objective%3Adocs%2Fanchors%2Fproduct%2Fanchor.md", hierarchy)

    await expect(
      deleteWorkflowRecords(storage, rt, {
        workflowIds: ["workflow-failed"],
        reason: "Clean up.",
      }),
    ).rejects.toThrow("owns completed Wave review history")
  })
})
