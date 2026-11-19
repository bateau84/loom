import { test, expect } from "bun:test"
import { Database } from "bun:sqlite"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Store } from "../src/store.js"
import { sqliteConnection } from "../src/sqlite-connection.js"
import { WorkloadDecisionJournal } from "../src/workload-admission.js"
import { defaults, mergeConfig } from "../src/config.js"
import type { WorkloadAssignment } from "../src/workload-routing.js"
import type { RouteInventory } from "../src/model-routing.js"

const config = () => mergeConfig(defaults(), {
  "model-routing": { enabled: true, "default-class": "standard",
    "default-reasoning": "medium", "paid-fallback": false },
  "model-classes": { standard: { models: ["fast"] }, frontier: { models: ["premium"] } },
  agents: { architect: { roles: ["architecture"] } },
  roles: { architecture: {
    "model-class": "standard", reasoning: "medium",
    "workload-tiers": { frontier: { "model-class": "frontier", reasoning: "high" } },
  } },
})
const inventory: RouteInventory[] = [
  { providerID: "go", modelID: "fast", billing: "included", quota: "unknown", enabled: true,
    tools: true, reasoning: ["medium", "high"] as const, accountID: "account-A" },
  { providerID: "go", modelID: "premium", billing: "included", quota: "unknown", enabled: true,
    tools: true, reasoning: ["high"] as const, accountID: "account-B" },
]
const work = (id = "work-1", riskFactors: WorkloadAssignment["riskFactors"] = []): WorkloadAssignment => ({
  assignmentId: id, objectiveId: "one-origin", boundary: "new-assignment", riskFactors,
  assessment: { status: "assessed", confidence: "high", sourceRef: "approved-task" },
  quality: { minimumTier: "standard", minimumReasoning: "low", independence: "required" },
  spending: "included-only",
})

function withFixture(run: (f: { db: Database; store: Store; journal: WorkloadDecisionJournal; actionId: string }) => void) {
  const db = new Database(":memory:")
  try {
    const sql = sqliteConnection(db), store = new Store(sql)
    const action = store.create("Work", "Do bounded task", { session_id: "session-A", agent: "architect" })
    store.savePlan(action.id, 0, [{ id: "node-A", kind: "task", title: "Task" }])
    store.select("session-A", { action_id: action.id, node_id: "node-A" })
    run({ db, store, journal: new WorkloadDecisionJournal(sql, store), actionId: action.id })
  } finally { db.close() }
}
const source = (actionId: string) => ({
  ownerSessionID: "session-A", actionID: actionId, nodeID: "node-A",
  actionRevision: 1, planRevision: 1,
})

test("F-03: one assignment is durably pinned, and changed risk cannot replan it", () => withFixture(({ journal, actionId, db }) => {
  const ref = source(actionId)
  const first = journal.record(ref, config(), "architect", inventory, work())
  expect(first.status).toBe("candidate-only")
  expect(first.decision.route?.accountID).toBe("account-A")
  expect(journal.record(ref, config(), "architect", inventory, work())).toEqual(first)
  expect(() => journal.record(ref, config(), "architect", inventory, work("work-1", ["authority"]))).toThrow("CONFLICT")
  expect(db.query("SELECT count(*) AS n FROM loom_workload_records").get()).toEqual({ n: 1 })
  expect(journal.get("work-1", "another-session")).toBeNull()
}))

test("F-03: a second assignment cannot relabel the same work/owner/revision to bypass a pinned decision", () => withFixture(({ journal, actionId }) => {
  const ref = source(actionId)
  journal.record(ref, config(), "architect", inventory, work("first"))
  expect(() => journal.record(ref, config(), "architect", inventory, work("second", ["authority"]))).toThrow("CONFLICT")
  expect(journal.get("first", "session-A")?.objectiveId).toBe("one-origin")
}))

test("F-03A: title-only Action revision cannot mint a second candidate for the same logical work", () =>
  withFixture(({ journal, store, db, actionId }) => {
    const initial = journal.record(source(actionId), config(), "architect", inventory, work("first"))
    const revision = store.update(actionId, 1, { title: "Renamed without changing task" })
    expect(revision.revision).toBe(2)
    const after = { ...source(actionId), actionRevision: 2 }
    expect(() => journal.record(after, config(), "architect", inventory,
      work("second", ["authority"]))).toThrow("CONFLICT")
    expect(() => journal.record(after, config(), "architect", inventory,
      work("first"))).toThrow("CONFLICT")
    expect(journal.get("first", "session-A")).toEqual(initial)
    expect(db.query("SELECT COUNT(*) AS n FROM loom_workload_records").get()).toEqual({ n: 1 })
  }))

test("F-03A: a plan-only revision or another Session cannot reissue the same node/agent candidate", () =>
  withFixture(({ journal, store, db, actionId }) => {
    journal.record(source(actionId), config(), "architect", inventory, work("first"))
    store.savePlan(actionId, 1, [{ id: "node-A", kind: "task", title: "Still same task" }])
    const updated = { ...source(actionId), planRevision: 2 }
    expect(() => journal.record(updated, config(), "architect", inventory,
      work("another", ["authority"]))).toThrow("CONFLICT")

    store.select("session-B", { action_id: actionId, node_id: "node-A" })
    const otherOwner = { ...updated, ownerSessionID: "session-B" }
    expect(() => journal.record(otherOwner, config(), "architect", inventory,
      work("new-session", ["credentials"]))).toThrow("CONFLICT")
    expect(db.query("SELECT COUNT(*) AS n FROM loom_workload_records").get()).toEqual({ n: 1 })
  }))

test("F-03A: distinct task nodes can retain separate candidate identity after a valid plan revision", () =>
  withFixture(({ journal, store, db, actionId }) => {
    journal.record(source(actionId), config(), "architect", inventory, work("first"))
    store.savePlan(actionId, 1, [
      { id: "node-A", kind: "task", title: "First task" },
      { id: "node-B", kind: "task", title: "Separate task" },
    ])
    store.select("session-A", { action_id: actionId, node_id: "node-B" })
    const second = journal.record({ ...source(actionId), planRevision: 2, nodeID: "node-B" },
      config(), "architect", inventory, work("second"))
    expect(second.status).toBe("candidate-only")
    expect(db.query("SELECT COUNT(*) AS n FROM loom_workload_records").get()).toEqual({ n: 2 })
  }))

test("F-03: stale plan, wrong selection, and made-up safe phase cannot admit a new decision", () => withFixture(({ journal, store, actionId, db }) => {
  const ref = source(actionId)
  expect(() => journal.record({ ...ref, planRevision: 0 }, config(), "architect", inventory, work())).toThrow("STALE")
  expect(() => journal.record({ ...ref, ownerSessionID: "session-B" }, config(), "architect", inventory, work())).toThrow("SCOPE")
  const fakePhase = { ...work(), boundary: "safe-next-phase" } as WorkloadAssignment
  expect(() => journal.record(ref, config(), "architect", inventory, fakePhase)).toThrow("BOUNDARY")
  expect(() => journal.record(ref, config(), "architect", inventory,
    { ...work(), boundary: "continuation" })).toThrow("BOUNDARY")
  expect(db.query("SELECT count(*) AS n FROM loom_workload_records").get()).toEqual({ n: 0 })
  store.savePlan(actionId, 1, [{ id: "node-A", kind: "task", title: "Changed" }])
  expect(() => journal.record(ref, config(), "architect", inventory, work())).toThrow("STALE")
}))

test("F-03: file reopen and independent SQLite connections agree on one persisted candidate", () => {
  const root = mkdtempSync(join(tmpdir(), "loom-workload-")), path = join(root, "actions.sqlite")
  let firstDB = new Database(path), secondDB = new Database(path)
  try {
    const oneSQL = sqliteConnection(firstDB), a = new Store(oneSQL)
    const action = a.create("Work", "Do bounded task", { session_id: "session-A", agent: "architect" })
    a.savePlan(action.id, 0, [{ id: "node-A", kind: "task", title: "Task" }])
    a.select("session-A", { action_id: action.id, node_id: "node-A" })
    const ref = source(action.id)
    const one = new WorkloadDecisionJournal(oneSQL, a)
    const original = one.record(ref, config(), "architect", inventory, work())
    const twoSQL = sqliteConnection(secondDB), b = new Store(twoSQL)
    const second = new WorkloadDecisionJournal(twoSQL, b)
    expect(second.get("work-1", "session-A")).toEqual(original)
    expect(second.record(ref, config(), "architect", inventory, work())).toEqual(original)
    expect(() => second.record(ref, config(), "architect", inventory, work("another", ["credentials"]))).toThrow("CONFLICT")
    firstDB.close(); secondDB.close()
    firstDB = new Database(path)
    const reopenedSQL = sqliteConnection(firstDB), reopenedStore = new Store(reopenedSQL)
    const reopened = new WorkloadDecisionJournal(reopenedSQL, reopenedStore)
    expect(reopened.get("work-1", "session-A")).toEqual(original)
    expect(reopened.record(ref, config(), "architect", inventory, work())).toEqual(original)
  } finally {
    try { firstDB.close() } catch { /* closed already */ }
    try { secondDB.close() } catch { /* closed already */ }
    rmSync(root, { recursive: true, force: true })
  }
})

test("F-03: corrupt record or incomplete schema fails rather than claiming a stored admission", () => withFixture(({ journal, actionId, db }) => {
  journal.record(source(actionId), config(), "architect", inventory, work())
  db.exec("UPDATE loom_workload_records SET content_json='{}' WHERE assignment_id='work-1'")
  expect(() => journal.get("work-1", "session-A")).toThrow("INTEGRITY")
  db.exec("DROP TABLE loom_workload_records")
  expect(() => new WorkloadDecisionJournal(sqliteConnection(db), new Store(sqliteConnection(db)))).toThrow("SCHEMA")
}))
