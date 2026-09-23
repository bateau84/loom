import { createDashboardPublisher } from "../plugins/loom/dashboard"
import type { LoomRuntimeIdentity, RawStorage } from "../plugins/loom/runtime"
import type { OpenQuestion } from "../plugins/loom/oq"
import type { Workflow } from "../plugins/loom/workflow"
import type { WorkHierarchy } from "../plugins/loom/work"

export const readableIds = {
  project: "11111111-1111-4111-8111-111111111111",
  workflow: "22222222-2222-4222-8222-222222222222",
  question: "33333333-3333-4333-8333-333333333333",
  objective: "44444444-4444-4444-8444-444444444444",
  verification: "55555555-5555-4555-8555-555555555555",
  coordinator: "ses_zzzzzzzzzzzzzzzzzzzzzzzzzz",
  participant: "ses_aaaaaaaaaaaaaaaaaaaaaaaaaa",
}

export class DashboardFixtureStorage implements RawStorage {
  values = new Map<string, unknown>()
  async get(key: string) { return this.values.get(key) }
  async set(key: string, value: unknown) { this.values.set(key, value); return value }
  async scan({ prefix, limit = 100, after = "" }: { prefix: string; limit?: number; after?: string }) {
    const all = [...this.values].filter(([key]) => key.startsWith(prefix) && key > after).sort(([a], [b]) => a.localeCompare(b))
    const entries = all.slice(0, limit).map(([key, value]) => ({ key, value }))
    return { entries, next: all.length > entries.length ? entries.at(-1)?.key : undefined }
  }
}

/** Authored records -> production publisher; this is not a hand-built context payload. */
export function readableFixture(root: string) {
  const now = new Date().toISOString()
  const ids = readableIds
  const runtime: LoomRuntimeIdentity = {
    installationId: "readable-installation", instanceId: "readable-publisher", projectId: ids.project,
    canonicalLocation: "/work/leash", identitySource: "loom-project-marker", markerLocation: root + "/marker",
    runtimeRoot: root, stateRoot: root + "/state",
  }
  const workflow: Workflow = {
    id: ids.workflow, projectId: ids.project, revision: 7, anchor: "docs/anchors/leash-v1/anchor.md",
    request: "Build persistence without losing existing workflow history.",
    createdBySession: ids.coordinator, createdAt: now, work: { objectiveId: ids.objective, generation: 1 },
    steps: [
      { id: "task:build", agent: "worker", kind: "work", status: "pending", dependsOn: [], task: {
        id: "build", title: "Build persistence layer", objective: "Persist workflow history", dependsOn: [],
        write: ["src/**"], skills: [], verify: ["Persistence round-trip test"],
      } },
      { id: "review-implementation", agent: "reviewer", kind: "gate", status: "pending", dependsOn: ["task:build"] },
    ],
    verification: [{ id: ids.verification, createdByStepId: "task:build", createdByAgent: "worker",
      beforeStepId: "review-implementation", kind: "test", statement: "Prove existing workflow history survives a restart.",
      status: "open", createdAt: now }],
  }
  const question: OpenQuestion = {
    id: ids.question, workflowId: ids.workflow, question: "How long should completed workflow history be kept?",
    raisedByAgent: "worker", raisedByStepId: "task:build", requiredAuthority: "user", blocking: true,
    consumerStepIds: ["task:build"], evidence: [], status: "open", reconciliations: {}, createdAt: now,
  }
  const work: WorkHierarchy = {
    objectiveId: ids.objective, anchor: workflow.anchor, title: "Leash v1", objectiveStatus: "active", version: 1,
    generation: 1, workflowIds: [ids.workflow], createdAt: now, updatedAt: now,
    nodes: [
      { id: "phase:1:build", logicalId: "build", type: "phase", title: "Build", status: "active", generation: 1, createdAt: now, updatedAt: now },
      { id: "wave:1:persistence", logicalId: "persistence", type: "wave", title: "Persistence", status: "active", generation: 1,
        parentId: "phase:1:build", claimedByWorkflowId: ids.workflow, createdAt: now, updatedAt: now },
      { id: "task:1:build", logicalId: "build", type: "task", title: "Build persistence layer", objective: "Persist workflow history",
        status: "active", generation: 1, parentId: "wave:1:persistence", claimedByWorkflowId: ids.workflow, createdAt: now, updatedAt: now },
    ],
  }
  const storage = new DashboardFixtureStorage()
  storage.values.set("workflow/" + ids.workflow, workflow)
  storage.values.set("work/" + ids.objective, work)
  storage.values.set("oq/" + ids.workflow + "/" + ids.question, question)
  storage.values.set("session/" + ids.coordinator, ids.workflow)
  storage.values.set("session/" + ids.participant, ids.workflow)
  storage.values.set("budget/" + ids.workflow, { totalDispatches: 8, byKey: {}, seenDispatches: [] })
  storage.values.set("limits/" + ids.workflow, { maxTotalDispatches: 40 })
  return { storage, runtime, workflow, question, work }
}

if (import.meta.main) {
  const root = process.argv[2]
  if (!root) throw new Error("Fixture runtime root is required")
  const { storage, runtime } = readableFixture(root)
  await createDashboardPublisher(storage, runtime, { leaseMs: 600_000 }).publish()
}
