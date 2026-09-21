import { afterEach, describe, expect, test } from "bun:test"
import { mkdtemp, readFile, rm } from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"
import {
  aggregateFleet,
  aggregateFleetFromDisk,
  buildProjectSnapshot,
  createDashboardPublisher,
  projectionDigest,
  type InstanceManifestV1,
  type ProjectSnapshotV1,
  type PublisherRecord,
} from "./dashboard"
import type { LoomRuntimeIdentity, RawStorage } from "./runtime"
import type { Workflow } from "./workflow"
import type { WorkHierarchy } from "./work"

const roots: string[] = []

class MemoryStorage implements RawStorage {
  values = new Map<string, unknown>()
  async get(key: string) { return this.values.get(key) }
  async set(key: string, value: unknown) { this.values.set(key, value); return value }
  async scan({ prefix, limit = 100, after = "" }: { prefix: string; limit?: number; after?: string }) {
    const entries = [...this.values.entries()]
      .filter(([key]) => key.startsWith(prefix) && key > after)
      .sort(([a], [b]) => a.localeCompare(b))
      .slice(0, limit)
      .map(([key, value]) => ({ key, value }))
    const all = [...this.values.keys()].filter((key) => key.startsWith(prefix) && key > after).sort()
    return { entries, next: all.length > entries.length ? entries.at(-1)?.key : undefined }
  }
}

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "loom-dashboard-test-"))
  roots.push(root)
  return root
}

function runtime(root: string): LoomRuntimeIdentity {
  return {
    installationId: "installation-a",
    instanceId: "instance-a",
    projectId: "project-a",
    canonicalLocation: join(root, "project-a"),
    identitySource: "loom-project-marker",
    markerLocation: join(root, "project-a", ".loom", "project-id"),
    runtimeRoot: root,
    stateRoot: join(root, "state"),
  }
}

function workflow(revision = 3): Workflow {
  return {
    id: "workflow-a",
    projectId: "project-a",
    revision,
    anchor: "docs/anchors/product/anchor.md",
    createdBySession: "session-general",
    createdAt: "2026-09-21T12:00:00.000Z",
    work: { objectiveId: "objective:docs/anchors/product/anchor.md", generation: 1 },
    steps: [
      { id: "task:build", agent: "worker", kind: "work", dependsOn: [], status: "complete" },
      { id: "review-implementation", agent: "reviewer", kind: "gate", dependsOn: ["task:build"], status: "pending" },
    ],
    verification: [{
      id: "verify-a",
      createdByStepId: "task:build",
      createdByAgent: "worker",
      beforeStepId: "review-implementation",
      kind: "test",
      statement: "integration passes",
      status: "open",
      createdAt: "2026-09-21T12:01:00.000Z",
    }],
  }
}

function work(): WorkHierarchy {
  const objectiveId = "objective:docs/anchors/product/anchor.md"
  return {
    objectiveId,
    anchor: "docs/anchors/product/anchor.md",
    title: "product",
    objectiveStatus: "active",
    version: 4,
    generation: 1,
    workflowIds: ["workflow-a"],
    createdAt: "2026-09-21T12:00:00.000Z",
    updatedAt: "2026-09-21T12:05:00.000Z",
    nodes: [
      { id: "phase:1:build", logicalId: "build", type: "phase", title: "Build", status: "active", generation: 1, createdAt: "2026-09-21T12:00:00.000Z", updatedAt: "2026-09-21T12:05:00.000Z" },
      { id: "wave:1:build/runtime", logicalId: "runtime", type: "wave", title: "Runtime", status: "active", generation: 1, parentId: "phase:1:build", claimedByWorkflowId: "workflow-a", createdAt: "2026-09-21T12:00:00.000Z", updatedAt: "2026-09-21T12:05:00.000Z" },
      { id: "task:1:build", logicalId: "build", type: "task", title: "Build runtime", objective: "Build it", status: "active", generation: 1, parentId: "wave:1:build/runtime", claimedByWorkflowId: "workflow-a", createdAt: "2026-09-21T12:00:00.000Z", updatedAt: "2026-09-21T12:05:00.000Z" },
    ],
  }
}

async function populated(root: string) {
  const storage = new MemoryStorage()
  await storage.set("workflow/workflow-a", workflow())
  await storage.set("work/objective", work())
  await storage.set("session/session-general", "workflow-a")
  await storage.set("session/session-reviewer", "workflow-a")
  await storage.set("oq/workflow-a/OQ-1", { id: "OQ-1", status: "open" })
  await storage.set("budget/workflow-a", { totalDispatches: 5, byKey: {}, seenDispatches: [] })
  await storage.set("limits/workflow-a", { maxTotalDispatches: 40 })
  return { storage, runtime: runtime(root) }
}

afterEach(async () => {
  while (roots.length) await rm(roots.pop()!, { recursive: true, force: true })
})

describe("Loom dashboard projection", () => {
  test("projects bounded authoritative state with independent workflow and work revisions", async () => {
    const root = await fixture()
    const { storage, runtime } = await populated(root)
    const snapshot = await buildProjectSnapshot(storage, runtime, 7, {}, new Date("2026-09-21T12:10:00.000Z"))
    expect(snapshot.generation).toBe(7)
    expect(snapshot.workflows).toHaveLength(1)
    expect(snapshot.workflows[0]).toMatchObject({
      workflowId: "workflow-a",
      workflowRevision: 3,
      status: "active",
      openOqCount: 1,
      openVerificationCount: 1,
      participatingSessionIds: ["session-general", "session-reviewer"],
    })
    expect(snapshot.workObjectives[0]).toMatchObject({
      workVersion: 4,
      generation: 1,
    })
    expect(snapshot.workflows[0].stateDigest).toHaveLength(64)
    expect(snapshot.workObjectives[0].stateDigest).toHaveLength(64)
  })

  test("recent activity includes OQ, verification and budget semantic changes", async () => {
    const root = await fixture()
    const { storage, runtime } = await populated(root)
    const current = workflow()
    current.verification![0].proof = {
      byAgent: "reviewer",
      stepId: "review-implementation",
      statement: "verified",
      observationIds: ["obs-1"],
      provedAt: "2026-09-21T12:07:00.000Z",
    }
    await storage.set("workflow/workflow-a", current)
    await storage.set("oq/workflow-a/OQ-1", {
      id: "OQ-1",
      workflowId: "workflow-a",
      question: "Which behavior applies?",
      raisedByAgent: "worker",
      raisedByStepId: "task:build",
      requiredAuthority: "reviewer",
      blocking: true,
      consumerStepIds: ["task:build"],
      evidence: [],
      status: "answered",
      answer: {
        by: "reviewer",
        source: "agent",
        text: "Use the accepted behavior.",
        evidence: [],
        at: "2026-09-21T12:09:00.000Z",
      },
      reconciliations: {},
      createdAt: "2026-09-21T12:06:00.000Z",
    })
    await storage.set("budget/workflow-a", {
      totalDispatches: 5,
      byKey: {},
      seenDispatches: [],
      grants: [{
        key: "step:review-implementation",
        agent: "reviewer",
        grantedBy: "general",
        reason: "new evidence",
        progress: {
          newEvidence: true,
          changedHypothesis: false,
          changedStrategy: false,
          reducedUnresolved: false,
        },
        evidence: ["obs-1"],
        grantedAt: "2026-09-21T12:08:00.000Z",
      }],
    })

    const snapshot = await buildProjectSnapshot(
      storage,
      runtime,
      8,
      {},
      new Date("2026-09-21T12:10:00.000Z"),
    )
    expect(snapshot.workflows[0].recentActivityAt).toBe("2026-09-21T12:09:00.000Z")
  })

  test("state digest is canonical across object key ordering", () => {
    expect(projectionDigest({ b: 2, a: { d: 4, c: 3 } })).toBe(
      projectionDigest({ a: { c: 3, d: 4 }, b: 2 }),
    )
  })

  test("publisher writes atomic manifest/project snapshots and advances one-publisher generation", async () => {
    const root = await fixture()
    const { storage, runtime } = await populated(root)
    const publisher = createDashboardPublisher(storage, runtime, { leaseMs: 10_000 })
    const first = await publisher.publish()
    const second = await publisher.publish()
    expect(first.generation).toBe(1)
    expect(second.generation).toBe(2)
    const projectPath = join(root, "instances", "installation-a", "instance-a", "projects", "project-a.json")
    const manifestPath = join(root, "instances", "installation-a", "instance-a", "manifest.json")
    expect(JSON.parse(await readFile(projectPath, "utf8")).generation).toBe(2)
    expect(JSON.parse(await readFile(manifestPath, "utf8")).projects).toEqual(["project-a"])
    const fleet = await aggregateFleetFromDisk(root, new Date(second.generatedAt))
    expect(fleet.projects[0].workflows[0].workflowId).toBe("workflow-a")
  })

  test("aggregator keeps stale highest revision and exposes a live lower revision as lagging participant", () => {
    const at = new Date("2026-09-21T12:10:00.000Z")
    const manifest = (instanceId: string, lease: string): InstanceManifestV1 => ({
      schemaVersion: 1, installationId: "i", instanceId, startedAt: "2026-09-21T12:00:00.000Z",
      generatedAt: "2026-09-21T12:09:00.000Z", leaseExpiresAt: lease, projects: ["p"],
    })
    const snapshot = (instanceId: string, revision: number, digest: string, lease: string): ProjectSnapshotV1 => ({
      schemaVersion: 1, installationId: "i", instanceId, projectId: "p", generation: 1,
      generatedAt: "2026-09-21T12:09:00.000Z", leaseExpiresAt: lease,
      project: { canonicalLocation: "/p" }, projectionWindow: { workflowsTruncated: false, completedObjectivesTruncated: false },
      workObjectives: [],
      workflows: [{
        workflowId: "w", workflowRevision: revision, stateDigest: digest, status: "active",
        currentSteps: [], runnableSteps: [], openOqCount: 0, openVerificationCount: 0,
        budget: { exhausted: false }, recentActivityAt: "2026-09-21T12:09:00.000Z", participatingSessionIds: [],
      }],
    })
    const records: PublisherRecord[] = [
      { manifest: manifest("high-stale", "2026-09-21T12:09:30.000Z"), snapshot: snapshot("high-stale", 5, "d5", "2026-09-21T12:09:30.000Z") },
      { manifest: manifest("low-live", "2026-09-21T12:20:00.000Z"), snapshot: snapshot("low-live", 4, "d4", "2026-09-21T12:20:00.000Z") },
    ]
    const workflow = aggregateFleet(records, at).projects[0].workflows[0]
    expect(workflow.workflowRevision).toBe(5)
    expect(workflow.sourceFreshness).toBe("stale-source")
    expect(workflow.projection?.workflowRevision).toBe(5)
    expect(workflow.participants.find((participant) => participant.instanceId === "low-live")?.live).toBe(true)
  })

  test("aggregator surfaces same-revision digest disagreement without inventing a winner", () => {
    const lease = "2026-09-21T12:20:00.000Z"
    const manifest = (instanceId: string): InstanceManifestV1 => ({
      schemaVersion: 1, installationId: "i", instanceId, startedAt: "2026-09-21T12:00:00.000Z",
      generatedAt: "2026-09-21T12:09:00.000Z", leaseExpiresAt: lease, projects: ["p"],
    })
    const make = (instanceId: string, digest: string): PublisherRecord => ({
      manifest: manifest(instanceId),
      snapshot: {
        schemaVersion: 1, installationId: "i", instanceId, projectId: "p", generation: 1,
        generatedAt: "2026-09-21T12:09:00.000Z", leaseExpiresAt: lease,
        project: { canonicalLocation: "/p" }, projectionWindow: { workflowsTruncated: false, completedObjectivesTruncated: false },
        workObjectives: [],
        workflows: [{
          workflowId: "w", workflowRevision: 7, stateDigest: digest, status: "blocked",
          currentSteps: [], runnableSteps: [], openOqCount: 1, openVerificationCount: 0,
          budget: { exhausted: false }, recentActivityAt: "2026-09-21T12:09:00.000Z", participatingSessionIds: [],
        }],
      },
    })
    const workflow = aggregateFleet([make("a", "digest-a"), make("b", "digest-b")], new Date("2026-09-21T12:10:00.000Z")).projects[0].workflows[0]
    expect(workflow.consistency).toBe("conflict")
    expect(workflow.projection).toBeUndefined()
    expect(workflow.conflictCandidates?.map((candidate) => candidate.stateDigest).sort()).toEqual(["digest-a", "digest-b"])
    expect(workflow.participants).toHaveLength(2)
  })
  test("bounded history never trims active workflows or non-terminal objectives", async () => {
    const root = await fixture()
    const { storage, runtime } = await populated(root)

    for (let i = 0; i < 5; i++) {
      await storage.set(`workflow/completed-${i}`, {
        ...workflow(100 + i),
        id: `completed-${i}`,
        work: undefined,
        steps: [{ id: "worker", agent: "worker", kind: "work", dependsOn: [], status: "complete" }],
      } satisfies Workflow)
      await storage.set(`work/completed-${i}`, {
        ...work(),
        objectiveId: `objective:completed-${i}`,
        objectiveStatus: "complete",
        version: 100 + i,
        workflowIds: [`completed-${i}`],
      } satisfies WorkHierarchy)
    }

    const snapshot = await buildProjectSnapshot(
      storage,
      runtime,
      1,
      { maxWorkflows: 2, maxObjectives: 1 },
      new Date("2026-09-21T12:10:00.000Z"),
    )
    expect(snapshot.workflows.some((entry) => entry.workflowId === "workflow-a")).toBe(true)
    expect(snapshot.workObjectives.some((entry) => entry.objectiveId === work().objectiveId)).toBe(true)
    expect(snapshot.projectionWindow.workflowsTruncated).toBe(true)
    expect(snapshot.projectionWindow.completedObjectivesTruncated).toBe(true)
  })

  test("missing and explicit zero dashboard values remain distinct", async () => {
    const root = await fixture()
    const storage = new MemoryStorage()
    const rt = runtime(root)
    await storage.set("workflow/workflow-a", workflow())
    const missing = await buildProjectSnapshot(storage, rt, 1)
    expect(missing.workflows[0].budget.used).toBeUndefined()
    expect(missing.enrichment).toBeUndefined()

    await storage.set("budget/workflow-a", { totalDispatches: 0, byKey: {}, seenDispatches: [] })
    const zero = await buildProjectSnapshot(storage, rt, 2)
    expect(zero.workflows[0].budget.used).toBe(0)
  })

  test("projection trigger isolates write failure from Loom execution", async () => {
    const root = await fixture()
    const { storage, runtime } = await populated(root)
    await Bun.write(join(root, "not-a-directory"), "x")
    runtime.runtimeRoot = join(root, "not-a-directory")
    const publisher = createDashboardPublisher(storage, runtime)
    expect(() => publisher.trigger()).not.toThrow()
    for (let i = 0; i < 20 && !publisher.lastError; i++) await Bun.sleep(10)
    expect(publisher.lastError).toBeTruthy()
  })

  test("work hierarchy conflict exposes candidates without selecting a winner", () => {
    const lease = "2026-09-21T12:20:00.000Z"
    const manifest = (instanceId: string): InstanceManifestV1 => ({
      schemaVersion: 1, installationId: "i", instanceId,
      startedAt: "2026-09-21T12:00:00.000Z",
      generatedAt: "2026-09-21T12:09:00.000Z",
      leaseExpiresAt: lease, projects: ["p"],
    })
    const objective = (digest: string): any => ({
      objectiveId: "o", title: "Objective", status: "active",
      workVersion: 8, generation: 1, stateDigest: digest, phases: [],
    })
    const records: PublisherRecord[] = ["a", "b"].map((instanceId, index) => ({
      manifest: manifest(instanceId),
      snapshot: {
        schemaVersion: 1, installationId: "i", instanceId, projectId: "p", generation: 1,
        generatedAt: "2026-09-21T12:09:00.000Z", leaseExpiresAt: lease,
        project: { canonicalLocation: "/p" },
        projectionWindow: { workflowsTruncated: false, completedObjectivesTruncated: false },
        workObjectives: [objective(index === 0 ? "work-a" : "work-b")],
        workflows: [],
      },
    }))
    const aggregated = aggregateFleet(records, new Date("2026-09-21T12:10:00.000Z")).projects[0].workObjectives[0]
    expect(aggregated.consistency).toBe("conflict")
    expect(aggregated.projection).toBeUndefined()
    expect(aggregated.conflictCandidates).toHaveLength(2)
  })

})
