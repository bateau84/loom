import { expect, test } from "bun:test"
import { Database } from "bun:sqlite"
import { mkdir } from "node:fs/promises"
import { join } from "node:path"
import { workReference, type WorkRef } from "../src/collaboration.js"
import type { EngineeringHistoryQuery, EngineeringHistoryView } from "../src/engineering-history.js"
import { canonical, digest, type LedgerRecord } from "../src/model.js"
import { Store } from "../src/store.js"
import { registeredLoom } from "./helpers/registered-loom.js"

const actor = (session_id: string) => ({ session_id, agent: "fixture-engineer" })
async function fixture() {
  const host = await registeredLoom()
  const db = new Database(join(host.directory, "state", "loom", "actions-v1",
    digest({ project: "tool-help", canonical: host.directory }), "ledger.sqlite"))
  const store = new Store(db)
  const action = store.create("Historical assignment investigation", "Follow saved originals without inventing dispatch.", actor("primary"))
  const plan = store.savePlan(action.id, 0, [{ id: "repair", kind: "task", title: "Historical correction" }])
  const work = workReference(action, plan, "repair")
  const read = async (query: EngineeringHistoryQuery) =>
    (await host.invoke("history", { operation: "read", ...query }, "investigator")).result as EngineeringHistoryView
  const original = (record: LedgerRecord) => canonical(store.records({ session_id: record.session_id, record_id: record.id }).items[0])
  const assignment = (id: string, worker = "worker", ref: WorkRef = work) => store.append({ ...actor("primary"),
    action_id: action.id, node_id: "repair", kind: "assignment", data: { assignment_id: id,
      primary_session_id: "primary", worker_session_id: worker, work_ref: ref, statement: "Historical requested work." } })
  const completion = (id: string) => store.append({ ...actor("worker"), action_id: action.id, node_id: "repair", kind: "completion",
    data: { assignment_id: id, work_ref: work, statement: "The worker reported a correction; execution and success are not independently established." } })
  return { host, db, store, action, work, read, original, assignment, completion,
    async close() { db.close(); await host.close() } }
}
const recordIDs = (view: EngineeringHistoryView) => view.records.map(record => record.source.record_id)

test("objective-root history follows a completion's exact original assignment without registering that assignment", async () => {
  const f = await fixture()
  try {
    // These are controlled saved historical rows. The current public API must
    // not revive retired assignment creation or native dispatch machinery.
    const assigned = f.assignment("saved-assignment"), completed = f.completion("saved-assignment")
    const before = [assigned, completed].map(f.original)
    const objective = (await f.host.invoke("objective", { operation: "create", source_type: "ledger-record",
      source_id: completed.id, label: "Trace the reported correction" }, "investigator")).result
    const action = await f.read({ action_id: f.action.id, record_id: completed.id, related: true })
    expect(recordIDs(action).sort()).toEqual([assigned.id, completed.id].sort())
    const view = await f.read({ objective_id: objective.id, related: true })
    expect(recordIDs(view).sort()).toEqual(recordIDs(action).sort())
    expect(view.relationships.find(edge => edge.kind === "historical-assignment-completion")).toMatchObject({
      source_record_id: completed.id, meaning: "authored", target: "included",
    })
    expect(view.connections.objectives[0]!.links.map(link => link.source_id)).toEqual([completed.id])
    expect(view.totals.native_dispatches).toBeNull()
    expect(view.totals.verified_outcomes).toBeNull()
    f.assignment("saved-assignment")
    // A later duplicate cannot rewrite the earlier append-bound view. A fresh
    // Action read does see the ambiguity and must withhold that relationship.
    expect(recordIDs(await f.read(view.navigation.repeat)).sort()).toEqual(recordIDs(view).sort())
    const fresh = await f.read({ action_id: f.action.id, record_id: completed.id, related: true })
    expect(recordIDs(fresh)).toEqual([completed.id])
    expect(fresh.records[0]!.gaps.some(gap => gap.code === "relationships-unresolved")).toBe(true)
    expect([assigned, completed].map(f.original)).toEqual(before)
    expect(f.host.permissionRequests.some(request => JSON.stringify(request).includes("primary"))).toBe(true)
    expect(f.host.sessionCreates).toEqual([])
    expect(f.host.sessionPrompts).toEqual([])
  } finally { await f.close() }
})

test.each(["duplicate", "wrong-worker", "wrong-work", "row-scope"] as const)("historical assignment identity rejects %s in every root", async ambiguity => {
    const f = await fixture()
    try {
      const assigned = f.assignment("saved-assignment", ambiguity === "wrong-worker" ? "different-worker" : "worker",
        ambiguity === "wrong-work" ? { ...f.work, hash: "f".repeat(64) } : f.work)
      if (ambiguity === "duplicate") f.assignment("saved-assignment")
      const completed = f.completion("saved-assignment")
      if (ambiguity === "row-scope") for (const record of [assigned, completed])
        f.db.prepare("UPDATE ledger SET data=json_set(data,'$.data.work_ref.node_id','another-node') WHERE id=?").run(record.id)
      const action = await f.read({ action_id: f.action.id, record_id: completed.id, related: true })
      expect(recordIDs(action)).toEqual([completed.id])
      expect(action.relationships.some(edge => edge.kind === "historical-assignment-completion")).toBe(false)
      const objective = (await f.host.invoke("objective", { operation: "create", source_type: "ledger-record",
        source_id: completed.id, label: "Ambiguous historical assignment" }, "investigator")).result
      const view = await f.read({ objective_id: objective.id, related: true })
      expect(recordIDs(view)).toEqual([completed.id])
      expect(view.relationships.some(edge => edge.kind === "historical-assignment-completion")).toBe(false)
      expect(view.records[0]!.gaps.some(gap => gap.code === "relationships-unresolved")).toBe(true)
      expect(JSON.stringify(view)).not.toContain(assigned.id)
    } finally { await f.close() }
})

test("frozen historical questions and assignments retain their exact saved references without reviving dispatch", async () => {
  const { Store: HistoricalStore } = await import("./fixtures/historical-3f08da9/store.js")
  const { workReference: historicalWorkReference } = await import("./fixtures/historical-3f08da9/collaboration.js")
  let fixture: { action_id: string; work: WorkRef; prior: string; assigned: string; later: string; completed: string;
    originals: Array<{ id: string; data: string }> } | undefined
  const host = await registeredLoom([], { beforeSetup: async directory => {
    const state = join(directory, "state", "loom", "actions-v1", digest({ project: "tool-help", canonical: directory }))
    await mkdir(state, { recursive: true })
    const db = new Database(join(state, "ledger.sqlite"))
    try {
      const old = new HistoricalStore(db), primary = actor("primary"), worker = actor("worker")
      const action = old.create("Preserved assigned questions", "Keep historical work association distinct from native dispatch.", primary)
      const plan = old.savePlan(action.id, 0, [{ id: "repair", kind: "task", title: "Historical correction" }])
      const work = historicalWorkReference(action, plan, "repair")
      const prior = old.collaboration.ask(worker, { action_id: action.id, node_id: "repair" }, { statement: "Which source needs correction?", respondent: "research" })
      const assigned = old.collaboration.assign(primary, { assignment_id: "saved-question-assignment", worker_session_id: worker.session_id, work_ref: work, question_id: prior.id })
      const later = old.collaboration.ask(worker, undefined, { assignment_id: "saved-question-assignment", statement: "Does the correction cover the requested case?", respondent: "research" })
      const completed = old.collaboration.complete(worker, { assignment_id: "saved-question-assignment", work_ref: work, statement: "Correction reported; acceptance remains separate." })
      fixture = { action_id: action.id, work, prior: prior.id, assigned: assigned.id, later: later.id, completed: completed.id,
        originals: db.query("SELECT id,data FROM ledger ORDER BY seq").all() as Array<{ id: string; data: string }> }
    } finally { db.close() }
  } })
  const db = new Database(join(host.directory, "state", "loom", "actions-v1",
    digest({ project: "tool-help", canonical: host.directory }), "ledger.sqlite"))
  try {
    if (!fixture) throw new Error("Historical fixture was not populated")
    const saved = fixture, store = new Store(db)
    const objectiveRead = async (source_id: string) => {
      const objective = (await host.invoke("objective", { operation: "create", source_type: "ledger-record", source_id,
        label: "Follow exact historical assignment references" }, "investigator")).result
      return (await host.invoke("history", { operation: "read", objective_id: objective.id, related: true }, "investigator")).result as EngineeringHistoryView
    }
    const view = await objectiveRead(saved.later)
    expect(recordIDs(view).sort()).toEqual([saved.prior, saved.assigned, saved.later].sort())
    expect(view.relationships.filter(edge => edge.kind === "historical-assignment-question")).toHaveLength(2)
    expect(view.relationships.filter(edge => edge.kind === "historical-assignment-question").every(edge => edge.meaning === "authored")).toBe(true)
    expect(view.connections.objectives[0]!.links.map(link => link.source_id)).toEqual([saved.later])
    const action = (await host.invoke("history", { operation: "read", action_id: saved.action_id, record_id: saved.later, related: true }, "investigator")).result as EngineeringHistoryView
    expect(recordIDs(action).sort()).toEqual(saved.originals.map(record => record.id).sort())
    expect(db.query("SELECT id,data FROM ledger ORDER BY seq").all()).toEqual(saved.originals)

    // Controlled imported counterexamples: a question target is not a completion,
    // and a later Plan revision is not the assignment's exact requested work.
    const invalidAssignment = store.append({ ...actor("primary"), action_id: saved.action_id, node_id: "repair", kind: "assignment",
      data: { assignment_id: "invalid-question-kind", question_id: saved.completed, primary_session_id: "primary", worker_session_id: "worker", work_ref: saved.work } })
    const invalidAssignedQuestion = store.append({ ...actor("primary"), action_id: saved.action_id, node_id: "repair", kind: "assignment",
      data: { assignment_id: "invalid-already-assigned-question", question_id: saved.later, primary_session_id: "primary", worker_session_id: "worker", work_ref: saved.work } })
    const invalidQuestion = store.append({ ...actor("worker"), action_id: saved.action_id, node_id: "repair", kind: "question",
      data: { assignment_id: "saved-question-assignment", work_ref: { ...saved.work, plan_revision: 2 }, statement: "A different revision cannot borrow the old assignment." } })
    for (const source of [invalidAssignment, invalidAssignedQuestion, invalidQuestion]) {
      const invalid = await objectiveRead(source.id)
      expect(recordIDs(invalid)).toEqual([source.id])
      expect(invalid.records[0]!.gaps.some(gap => gap.code === "relationships-unresolved")).toBe(true)
    }
    expect(host.sessionCreates).toEqual([])
    expect(host.sessionPrompts).toEqual([])
  } finally { db.close(); await host.close() }
})

test("trajectory expansion preserves claim-specific unavailable evidence without disclosing outside targets", async () => {
  const f = await fixture()
  try {
    const valid = f.store.observe(actor("worker"), { action_id: f.action.id }, { tool: "read", phase: "started" })
    const wrongKind = f.store.record(actor("worker"), { action_id: f.action.id }, { kind: "result", statement: "An authored claim is not an observation." })
    const hidden = f.store.observe(actor("private-source"), undefined, { tool: "read", phase: "started" })
    const missing = "missing-historical-evidence"
    const claim = f.store.append({ ...actor("worker"), action_id: f.action.id, kind: "claim",
      data: { statement: "This historical claim contains an unresolved supporting citation.",
        evidence_ids: [valid.id, wrongKind.id, hidden.id, missing] } })
    const before = f.original(claim)
    const ordinary = await f.read({ action_id: f.action.id, record_id: claim.id })
    const expected = ordinary.records[0]!.gaps.find(gap => gap.code === "relationships-unresolved")
    expect(expected?.detail).toStartWith("3 ")
    const trajectory = await f.read(ordinary.records[0]!.trajectory)
    const projected = trajectory.records.find(record => record.source.record_id === claim.id)!
    expect(projected.gaps.find(gap => gap.code === "relationships-unresolved")).toEqual(expected)
    expect(recordIDs(trajectory).sort()).toEqual([valid.id, claim.id].sort())
    for (const format of ["json", "markdown", "html"]) {
      const response = await f.host.tools.get("history").execute({ operation: "read", ...trajectory.navigation.repeat, response_format: format }, {
        sessionID: "investigator", agent: "author", messageID: "reader", id: "reader", signal: new AbortController().signal,
      })
      expect(response.content).toContain("relationships-unresolved")
      expect(response.content).not.toContain(hidden.id)
      expect(response.content).not.toContain(missing)
    }
    expect(f.original(claim)).toBe(before)
  } finally { await f.close() }
})

test("ordinary and trajectory pages retain source-specific omissions and Session scope limits", async () => {
  const f = await fixture()
  try {
    const observations = Array.from({ length: 25 }, () => f.store.observe(actor("worker"), { action_id: f.action.id }, { tool: "read" }))
    const claim = f.store.record(actor("worker"), { action_id: f.action.id }, { kind: "claim",
      statement: "Several original observations support this report.", evidence_ids: observations.map(record => record.id) })
    const ordinary = await f.read({ action_id: f.action.id, record_id: claim.id, limit: 1 })
    expect(ordinary.records[0]!.gaps.find(gap => gap.code === "relationships-omitted")?.detail).toStartWith("5 ")
    const trajectory = await f.read({ ...ordinary.records[0]!.trajectory, limit: 1, after: 25 })
    const selected = trajectory.records.find(record => record.source.record_id === claim.id)!
    expect(selected.gaps.some(gap => gap.code === "relationships-omitted")).toBe(true)
    const assigned = f.assignment("saved-assignment"), completed = f.completion("saved-assignment")
    const session = await f.read({ session_id: "worker", record_id: completed.id, related: true })
    expect(recordIDs(session)).toEqual([completed.id])
    expect(session.records[0]!.gaps.some(gap => gap.code === "relationships-unresolved")).toBe(true)
    expect(JSON.stringify(session)).not.toContain(assigned.id)
  } finally { await f.close() }
})
