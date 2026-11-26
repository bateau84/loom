import { test, expect } from "bun:test"
import { Database } from "bun:sqlite"
import { createHash } from "node:crypto"
import { Store } from "../src/store.js"
import { canonical } from "../src/model.js"
import { checkedRef, workReference } from "../src/collaboration.js"
import type { EngineeringHistoryView } from "../src/engineering-history.js"

const actor = (session_id: string) => ({ session_id, agent: "fixture-engineer" })
function fixture() {
  const db = new Database(":memory:"), store = new Store(db)
  const action = store.create("Restore freshness", "Understand the failure and verify the corrected subtests separately from the suite.", actor("primary"))
  return { db, store, action }
}
const statements = (view: EngineeringHistoryView) => [...view.highlights, ...view.records].map(record => record.excerpt).filter(Boolean)

test("large unfamiliar history exposes the significant four-Session trajectory without client enumeration", () => {
  const { db, store, action } = fixture()
  try {
    for (let n = 0; n < 266; n++) for (let i = 0; i < 10; i++)
      store.observe(actor(`unrelated_${n}`), { action_id: action.id }, { phase: "started", tool: "read", input: "DO_NOT_RETURN_RAW_INPUT" })
    const focus = { action_id: action.id }
    const first = store.record(actor("initial_test"), focus, { kind: "assessment", verdict: "fail", statement: "Initial /coarse subtest failed at the original revision." })
    const rerun = store.record(actor("initial_test"), focus, { kind: "result", statement: "Unchanged-code rerun passed; this did not verify a correction." })
    store.record(actor("investigation"), focus, { kind: "concern", statement: "Historical timing explanation is plausible but unproven." })
    const correction = store.record(actor("correction"), focus, { kind: "result", statement: "Corrected the test on a distinct revision." })
    const subtests = store.record(actor("verification"), focus, { kind: "qa", verdict: "pass", statement: "Both named subtests passed on the corrected head; partial recheck only." })
    const suite = store.record(actor("verification"), focus, { kind: "qa", verdict: "pass", statement: "Separate suite-level race verification passed." })
    const before = db.query("SELECT COUNT(*) AS count FROM ledger").get()
    const view = store.engineeringHistory.read({ action_id: action.id, limit: 4 })
    expect(view.totals.records).toBe(2666)
    expect(view.totals.sessions).toBe(270)
    expect(view.totals.observation_starts).toBe(2660)
    expect(view.totals.by_kind).toEqual({ observation: 2660, assessment: 1, result: 2, concern: 1, qa: 2 })
    expect(view.totals.verified_outcomes).toBeNull()
    expect(view.totals.native_dispatches).toBeNull()
    expect(view.coverage.branch_count).toBe(270)
    expect(view.coverage.branches_omitted).toBe(266)
    expect(view.highlights.map(record => record.source.record_id)).toEqual(expect.arrayContaining([first.id, rerun.id, correction.id, subtests.id, suite.id]))
    expect(statements(view).join(" ")).toContain("plausible but unproven")
    expect(JSON.stringify(view)).not.toContain("DO_NOT_RETURN_RAW_INPUT")
    const relevant = view.branches.find(branch => branch.session_id === "initial_test")!
    expect(relevant).toBeDefined()
    const detail = store.engineeringHistory.read(relevant.expand)
    expect(detail.records.map(record => record.source.record_id)).toEqual([first.id, rerun.id])
    expect(detail.records.every(record => record.meaning === "authored")).toBe(true)
    expect(detail.records.every(record => record.verification === "authored claim; not independently verified")).toBe(true)
    expect(db.query("SELECT COUNT(*) AS count FROM ledger").get()).toEqual(before)
  } finally { db.close() }
})

test("historical Plan bindings retain their own definition and node-only history is not retroactively rebound", () => {
  const { db, store, action } = fixture()
  try {
    const plan1 = store.savePlan(action.id, 0, [{ id: "task", kind: "task", title: "Original task" }], actor("planner"))
    store.select("worker", { action_id: action.id, node_id: "task" })
    const first = store.startObservation(actor("worker"), { phase: "started", tool: "read" })
    const ref1 = workReference(action, plan1, "task")
    const done = store.collaboration.complete(actor("worker"), { work_ref: ref1, statement: "I have finished the original task." })
    store.savePlan(action.id, 1, [{ id: "task", kind: "task", title: "Revised task", criteria: ["New criterion"] }], actor("planner"))
    const second = store.startObservation(actor("worker"), { phase: "started", tool: "shell" })
    const legacy = store.record(actor("worker"), { action_id: action.id, node_id: "task" }, { kind: "concern", statement: "A node-only concern has no exact Plan binding." })
    const view = store.engineeringHistory.read({ action_id: action.id })
    expect(view.intended_plan?.revision).toBe(2)
    expect(view.intended_plan?.nodes[0].title).toBe("Revised task")
    expect(view.branches.filter(branch => branch.kind === "historical-work")).toHaveLength(2)
    const old = view.branches.find(branch => branch.work_ref?.plan_revision === 1)!
    const current = view.branches.find(branch => branch.work_ref?.plan_revision === 2)!
    expect(old.title).toBe("Original task")
    expect(old.counts.records).toBe(2)
    expect(old.counts.reported_completions).toBe(1)
    expect(old.counts.verified_outcomes).toBeNull()
    expect(current.title).toBe("Revised task")
    const unversioned = view.branches.find(branch => branch.kind === "unversioned-node")!
    expect(unversioned.historical_node).toBeNull()
    expect(unversioned.gaps.some(gap => gap.code === "historical-binding-unknown")).toBe(true)
    expect(store.engineeringHistory.read(old.expand).records.map(record => record.source.record_id)).toEqual([first.id, done.id])
    expect(store.engineeringHistory.read(current.expand).records.map(record => record.source.record_id)).toEqual([second.id])
    expect(store.engineeringHistory.read(unversioned.expand).records.map(record => record.source.record_id)).toEqual([legacy.id])
    expect(store.engineeringHistory.authorizationSessions({ action_id: action.id })).toEqual(["planner", "worker"])
  } finally { db.close() }
})

test("unplanned work has Session branches without manufacturing a Plan, invocation, objective or elapsed duration", () => {
  const { db, store, action } = fixture()
  try {
    const source = store.observe(actor("reused-child"), { action_id: action.id }, { phase: "started", tool: "subagent" })
    store.observe(actor("reused-child"), { action_id: action.id }, { phase: "started", tool: "subagent" })
    const view = store.engineeringHistory.read({ action_id: action.id })
    expect(view.intended_plan).toBeNull()
    expect(view.branches).toHaveLength(1)
    expect(view.branches[0].meaning).toBe("observed-session-group")
    expect(view.branches[0].counts.native_dispatches).toBeNull()
    expect(view.branches[0].counts.observation_starts).toBe(2)
    expect(view.branches[0].gaps[0].detail).toContain("multiple dispatches or objectives")
    const detail = store.engineeringHistory.read({ action_id: action.id, record_id: source.id })
    expect(detail.records[0].observation?.elapsed_ms).toBeNull()
    expect(detail.records[0].meaning).toBe("observed")
  } finally { db.close() }
})

test("Session scope does not dereference linked Action intent or Plans and does not merge same node IDs across Actions", () => {
  const { db, store, action } = fixture()
  try {
    const plan = store.savePlan(action.id, 0, [{ id: "task", kind: "task", title: "ACTION_ONLY_PLAN_SECRET" }])
    store.collaboration.complete(actor("source"), { work_ref: workReference(action, plan, "task"), statement: "Reported done." })
    store.record(actor("source"), { action_id: action.id, node_id: "task" }, { kind: "claim", statement: "Old unversioned association." })
    const other = store.create("OTHER_ACTION_SECRET", "OTHER_GOAL_SECRET", actor("owner"))
    store.savePlan(other.id, 0, [{ id: "task", kind: "task", title: "OTHER_PLAN_SECRET" }])
    store.record(actor("source"), { action_id: other.id, node_id: "task" }, { kind: "claim", statement: "Another unversioned association." })
    const view = store.engineeringHistory.read({ session_id: "source" })
    expect(view.branches).toHaveLength(3)
    expect(view.intended_plan).toBeNull()
    expect(view.intent.goal).toBeNull()
    const encoded = JSON.stringify(view)
    expect(encoded).not.toContain("ACTION_ONLY_PLAN_SECRET")
    expect(encoded).not.toContain("OTHER_ACTION_SECRET")
    expect(encoded).not.toContain(action.goal)
    expect(view.branches.find(branch => branch.work_ref)?.gaps[0].code).toBe("action-definition-not-in-scope")
  } finally { db.close() }
})

test("fail and inconclusive representative lanes survive a later stream of authored passes", () => {
  const { db, store, action } = fixture()
  try {
    const focus = { action_id: action.id }
    const fail = store.record(actor("reviewer"), focus, { kind: "assessment", verdict: "fail", statement: "Fails with the original code." })
    const inconclusive = store.record(actor("reviewer"), focus, { kind: "qa", verdict: "inconclusive", statement: "Cause remains uncertain." })
    for (let i = 0; i < 30; i++) store.record(actor("reviewer"), focus, { kind: "qa", verdict: "pass", statement: "Partial recheck passed." })
    const view = store.engineeringHistory.read({ action_id: action.id })
    expect(view.highlights.map(record => record.source.record_id)).toEqual(expect.arrayContaining([fail.id, inconclusive.id]))
    expect(view.totals.reported_passes).toBe(30)
    expect(view.totals.reported_failures).toBe(1)
    expect(view.totals.reported_inconclusive).toBe(1)
    expect(view.totals.verified_outcomes).toBeNull()
  } finally { db.close() }
})

test("stable branch references bind source store and scope and remain valid at an old append boundary", () => {
  const { db, store, action } = fixture(), otherDB = new Database(":memory:")
  try {
    store.record(actor("worker"), { action_id: action.id }, { kind: "result", statement: "First result." })
    const view = store.engineeringHistory.read({ action_id: action.id }), branch = view.branches[0]
    store.record(actor("worker"), { action_id: action.id }, { kind: "result", statement: "Later result." })
    const old = store.engineeringHistory.read(branch.expand)
    expect(old.totals.records).toBe(1)
    expect(old.boundary.current_through).toBeGreaterThan(old.boundary.observed_through)
    expect(old.boundary.live).toBe(true)
    expect(store.engineeringHistory.read({ action_id: action.id }).branches[0].ref).toBe(branch.ref)
    expect(() => store.engineeringHistory.read({ session_id: "worker", branch_ref: branch.ref })).toThrow("another source/scope")
    const otherStore = new Store(otherDB)
    expect(() => otherStore.engineeringHistory.read(branch.expand)).toThrow("another source/scope")
    const forged = JSON.parse(Buffer.from(branch.ref, "base64url").toString())
    forged.extra = "not allowed"
    expect(() => store.engineeringHistory.read({ action_id: action.id, branch_ref: Buffer.from(JSON.stringify(forged)).toString("base64url") })).toThrow()
  } finally { db.close(); otherDB.close() }
})

test("selective record expansion exposes exact original version references and safe typed relationships", () => {
  const { db, store, action } = fixture()
  try {
    const focus = { action_id: action.id }, obs = store.observe(actor("worker"), focus, { tool: "shell", phase: "started", secret_input: "HIDDEN_TOOL_INPUT" })
    const finding = store.record(actor("reviewer"), focus, { kind: "assessment", verdict: "fail", statement: "The original command failed.", evidence_ids: [obs.id] })
    const view = store.engineeringHistory.read({ action_id: action.id, record_id: finding.id })
    const record = view.records[0]
    expect(record.source.sha256).toBe(createHash("sha256").update(canonical(finding)).digest("hex"))
    expect(record.source.query).toEqual({ operation: "query", action_id: action.id, source_session_id: "reviewer", record_id: finding.id })
    expect(view.relationships).toHaveLength(1)
    expect(view.relationships[0]).toMatchObject({ kind: "cites-observation", meaning: "authored", target: "in-scope-not-included" })
    expect(view.relationships[0].qualification).toContain("not proof")
    expect(JSON.stringify(view)).not.toContain("HIDDEN_TOOL_INPUT")
  } finally { db.close() }
})

test("unsupported out-of-scope references do not disclose another source identity", () => {
  const { db, store, action } = fixture()
  try {
    const hidden = store.observe(actor("hidden"), undefined, { tool: "HIDDEN_TOOL", phase: "started" })
    const authored = store.append({ ...actor("reader"), action_id: action.id, kind: "claim", data: { statement: "Untrusted citation.", evidence_ids: [hidden.id] } })
    const view = store.engineeringHistory.read({ action_id: action.id, record_id: authored.id })
    expect(view.relationships).toEqual([])
    expect(JSON.stringify(view)).not.toContain(hidden.id)
    expect(JSON.stringify(view)).not.toContain("HIDDEN_TOOL")
    expect(store.engineeringHistory.authorizationSessions({ action_id: action.id })).toEqual(["reader"])
  } finally { db.close() }
})

test("branch expansion pages keep whole branch coverage and source membership stable", () => {
  const { db, store, action } = fixture()
  try {
    const ids: string[] = []
    for (let i = 0; i < 7; i++) ids.push(store.observe(actor("worker"), { action_id: action.id }, { tool: "read", phase: "started" }).id)
    const branch = store.engineeringHistory.read({ action_id: action.id }).branches[0]
    const first = store.engineeringHistory.read({ ...branch.expand, limit: 3 })
    expect(first.selected_branch?.counts.records).toBe(7)
    expect(first.records.map(record => record.source.record_id)).toEqual(ids.slice(0, 3))
    expect(first.coverage.records_omitted).toBe(4)
    const second = store.engineeringHistory.read({ ...branch.expand, limit: 3, after: first.coverage.next_after! })
    expect(second.records.map(record => record.source.record_id)).toEqual(ids.slice(3, 6))
    const third = store.engineeringHistory.read({ ...branch.expand, limit: 3, after: second.coverage.next_after! })
    expect(third.records.map(record => record.source.record_id)).toEqual(ids.slice(6))
    expect(third.coverage.next_after).toBeNull()
  } finally { db.close() }
})

test("empty histories and unsafe queries have explicit outcomes", () => {
  const { db, store, action } = fixture()
  try {
    const view = store.engineeringHistory.read({ action_id: action.id })
    expect(view.totals.records).toBe(0)
    expect(view.branches).toEqual([])
    expect(view.totals.by_kind).toEqual({})
    expect(view.totals.native_dispatches).toBeNull()
    for (const query of [{}, { action_id: action.id, session_id: "s" }, { action_id: action.id, through: 1 },
      { action_id: action.id, limit: 0 }, { action_id: action.id, after: -1 }, { action_id: action.id, unknown: true }])
      expect(() => store.engineeringHistory.read(query)).toThrow()
    expect(() => store.engineeringHistory.read({ action_id: action.id, record_id: "absent" })).toThrow("unavailable")
  } finally { db.close() }
})

test("ranked branch continuation reaches all groups without including new appended activity", () => {
  const { db, store, action } = fixture()
  try {
    for (let i = 0; i < 57; i++) store.observe(actor(`session_${i}`), { action_id: action.id }, { phase: "started", tool: "read" })
    const first = store.engineeringHistory.read({ action_id: action.id, limit: 10 })
    const through = first.boundary.observed_through
    store.record(actor("new_failure"), { action_id: action.id }, { kind: "assessment", verdict: "fail", statement: "Appended after overview." })
    const refs = first.branches.map(branch => branch.ref)
    let next = first.coverage.next_branch_offset
    while (next !== null) {
      const page = store.engineeringHistory.read({ action_id: action.id, through, branch_offset: next, limit: 10 })
      expect(page.totals.records).toBe(57)
      refs.push(...page.branches.map(branch => branch.ref))
      next = page.coverage.next_branch_offset
    }
    expect(refs).toHaveLength(57)
    expect(new Set(refs).size).toBe(57)
    expect(() => store.engineeringHistory.read({ action_id: action.id, branch_offset: 10 })).toThrow("through")
    expect(() => store.engineeringHistory.read({ action_id: action.id, after: 0 })).toThrow("selected branch")
    expect(() => store.engineeringHistory.read({ ...first.branches[0].expand, branch_offset: 0 })).toThrow("only applies")
  } finally { db.close() }
})

test("a large legal Plan remains navigable through a compact qualified intent projection", () => {
  const { db, store, action } = fixture()
  try {
    store.savePlan(action.id, 0, Array.from({ length: 30 }, (_, i) => ({ id: `task_${i}`, kind: "task", title: `Task ${i}`, context: "x".repeat(7000), criteria: ["Retain the complete original contract."] })))
    const view = store.engineeringHistory.read({ action_id: action.id, limit: 1 })
    expect(view.intended_plan).toMatchObject({ revision: 1, nodes_total: 30, nodes_omitted: 29, projection: "identity-and-title" })
    expect(view.intended_plan?.nodes).toEqual([{ id: "task_0", kind: "task", title: "Task 0" }])
    expect(view.intended_plan?.read.query).toEqual({ operation: "read", action_id: action.id, revision: 1 })
    expect(Buffer.byteLength(JSON.stringify(view))).toBeLessThan(10000)
    expect(store.plan(action.id).nodes[0].context).toHaveLength(7000)
  } finally { db.close() }
})

test("relationship limits and unavailable targets are visible without revealing outside identities", () => {
  const { db, store, action } = fixture()
  try {
    const observations = Array.from({ length: 25 }, () => store.observe(actor("worker"), { action_id: action.id }, { tool: "read" }))
    const record = store.record(actor("reviewer"), { action_id: action.id }, { kind: "assessment", verdict: "fail", statement: "Many observations cited.", evidence_ids: observations.map(record => record.id) })
    const view = store.engineeringHistory.read({ action_id: action.id, record_id: record.id })
    expect(view.relationships).toHaveLength(20)
    expect(view.records[0].gaps.some(gap => gap.code === "relationships-omitted" && gap.detail.startsWith("5 "))).toBe(true)
    expect(view.highlights.find(item => item.source.record_id === record.id)).toEqual(view.records[0])
    const hidden = store.observe(actor("hidden"), undefined, { tool: "read" })
    const bad = store.append({ ...actor("reviewer"), action_id: action.id, kind: "claim", data: { statement: "Unresolved reference.", evidence_ids: [hidden.id] } })
    const missing = store.engineeringHistory.read({ action_id: action.id, record_id: bad.id })
    expect(missing.records[0].gaps.some(gap => gap.code === "relationships-unresolved")).toBe(true)
    expect(JSON.stringify(missing)).not.toContain(hidden.id)
  } finally { db.close() }
})

test("observed tool errors surface independently of authored assessment verdicts", () => {
  const { db, store, action } = fixture()
  try {
    const failed = store.observe(actor("failure"), { action_id: action.id }, { tool: "shell", phase: "finished", status: "error", error: "PRIVATE_ERROR_BODY" })
    for (let i = 0; i < 30; i++) store.observe(actor(`later_${i}`), { action_id: action.id }, { tool: "read", phase: "finished", status: "completed" })
    const view = store.engineeringHistory.read({ action_id: action.id, limit: 1 })
    expect(view.totals.observed_tool_errors).toBe(1)
    expect(view.totals.reported_failures).toBe(0)
    expect(view.branches[0].session_id).toBe("failure")
    expect(view.highlights[0].source.record_id).toBe(failed.id)
    expect(view.highlights[0].meaning).toBe("observed")
    expect(JSON.stringify(view)).not.toContain("PRIVATE_ERROR_BODY")
  } finally { db.close() }
})

test("a sourced reopen remains visible beside the earlier completion after later unrelated activity", () => {
  const { db, store, action } = fixture()
  try {
    const plan = store.savePlan(action.id, 0, [{ id: "task", kind: "task", title: "Verify the correction" }])
    const complete = store.collaboration.complete(actor("worker"), { work_ref: workReference(action, plan, "task"), statement: "Reported finished." })
    const reopened = store.collaboration.reopen(actor("reviewer"), { action_id: action.id, node_id: "task" }, "Required check still fails; work must be reopened.")
    for (let i = 0; i < 30; i++) store.observe(actor(`later_${i}`), { action_id: action.id }, { tool: "read", phase: "started" })
    const view = store.engineeringHistory.read({ action_id: action.id, limit: 1 })
    expect(view.highlights.map(record => record.source.record_id)).toContain(reopened.id)
    expect(view.highlights.map(record => record.source.record_id)).toContain(complete.id)
    expect(view.branches[0].counts.by_kind.reopen).toBe(1)
    expect(view.relationships.some(edge => (edge.kind as string) === "reopens-completion" && edge.from.endsWith(reopened.id) && edge.to.endsWith(complete.id))).toBe(true)
    expect(view.totals.verified_outcomes).toBeNull()
    const selected = store.engineeringHistory.read({ action_id: action.id, record_id: reopened.id })
    expect(selected.relationships.some(edge => (edge.kind as string) === "reopens-completion")).toBe(true)
  } finally { db.close() }
})

test("consecutive authored reopens retain the exact prior progress report without inventing another completion", () => {
  const { db, store, action } = fixture()
  try {
    const plan = store.savePlan(action.id, 0, [{ id: "task", kind: "task", title: "Check the correction" }])
    const focus = { action_id: action.id, node_id: "task" }
    const complete = store.collaboration.complete(actor("worker"), { work_ref: workReference(action, plan, "task"), statement: "Reported finished." })
    const first = store.collaboration.reopen(actor("reviewer"), focus, "First reopening.")
    const second = store.collaboration.reopen(actor("reviewer"), focus, "Further reason to keep the work open.")
    expect(first.data.previous_report_id).toBe(complete.id)
    expect(second.data.previous_report_id).toBe(first.id)
    const view = store.engineeringHistory.read({ action_id: action.id })
    expect(view.relationships).toEqual(expect.arrayContaining([
      expect.objectContaining({ from: expect.stringContaining(first.id), to: expect.stringContaining(complete.id), kind: "reopens-completion", meaning: "authored" }),
      expect.objectContaining({ from: expect.stringContaining(second.id), to: expect.stringContaining(first.id), kind: "follows-reopen", meaning: "authored" }),
    ]))
    expect(view.highlights.filter(record => record.kind === "reopen").every(record => record.gaps.every(gap => gap.code !== "relationships-unresolved"))).toBe(true)
    expect(view.relationships.some(edge => edge.from.endsWith(second.id) && edge.to.endsWith(complete.id))).toBe(false)
    expect(view.totals.reported_reopens).toBe(2)
    expect(view.totals.reported_completions).toBe(1)
    expect(view.totals.verified_outcomes).toBeNull()
    const bounded = store.engineeringHistory.read({ action_id: action.id, limit: 1 })
    expect(bounded.relationships).toEqual(expect.arrayContaining([
      expect.objectContaining({ from: expect.stringContaining(second.id), to: expect.stringContaining(first.id), kind: "follows-reopen", target: "in-scope-not-included" }),
    ]))
  } finally { db.close() }
})

test("unsupported original WorkRef fields and observation wrappers remain unknown instead of being normalized into established history", () => {
  const { db, store, action } = fixture()
  try {
    const plan = store.savePlan(action.id, 0, [{ id: "task", kind: "task", title: "Original task" }])
    const ref = workReference(action, plan, "task")
    const variants = [
      { status: "established", work_ref: { ...ref, unsupported_version: 2 } },
      { status: "established", work_ref: ref, unsupported_version: 2 },
      { status: "unknown", work_ref: ref },
    ]
    expect(() => checkedRef(variants[0].work_ref)).toThrow("Unknown work_ref field")
    for (const work_scope of variants) {
      const record = store.observe(actor("worker"), { action_id: action.id, node_id: "task" }, { phase: "started", tool: "read", work_scope })
      const view = store.engineeringHistory.read({ action_id: action.id, record_id: record.id })
      expect(view.records[0].work_ref).toBeNull()
      expect(view.selected_branch?.kind).toBe("unversioned-node")
      expect(view.selected_branch?.gaps.some(gap => gap.code === "historical-binding-unknown")).toBe(true)
    }
    const valid = store.observe(actor("worker"), { action_id: action.id, node_id: "task" }, { phase: "started", tool: "read", work_scope: { status: "established", work_ref: ref } })
    expect(store.engineeringHistory.read({ action_id: action.id, record_id: valid.id }).records[0].work_ref).toEqual(ref)
  } finally { db.close() }
})

test("malformed whole-scope source data is rejected even when no highlight would hydrate the row", () => {
  for (const shape of ["missing-data", "null-data", "missing-kind", "wrong-id", "wrong-session", "oversized"] as const) {
    const { db, store, action } = fixture()
    try {
      const record = store.record(actor("worker"), { action_id: action.id }, { kind: "claim", statement: "Must not disappear from a successful overview." })
      if (shape === "missing-data") db.query("UPDATE ledger SET data=json_remove(data,'$.data') WHERE id=?").run(record.id)
      if (shape === "null-data") db.query("UPDATE ledger SET data=json_set(data,'$.data',NULL) WHERE id=?").run(record.id)
      if (shape === "missing-kind") db.query("UPDATE ledger SET data=json_remove(data,'$.kind') WHERE id=?").run(record.id)
      if (shape === "wrong-id") db.query("UPDATE ledger SET data=json_set(data,'$.id','another-id') WHERE id=?").run(record.id)
      if (shape === "wrong-session") db.query("UPDATE ledger SET data=json_set(data,'$.session_id','another-session') WHERE id=?").run(record.id)
      if (shape === "oversized") db.query("UPDATE ledger SET data=json_set(data,'$.data.statement',?) WHERE id=?").run("x".repeat(400000), record.id)
      expect(() => store.engineeringHistory.read({ action_id: action.id })).toThrow()
    } finally { db.close() }
  }
})

test("a smaller limit bounds representative and relationship detail while retaining opposing verdicts and complete counts", () => {
  const { db, store, action } = fixture()
  try {
    const focus = { action_id: action.id }
    const observations = Array.from({ length: 20 }, () => store.observe(actor("worker"), focus, { tool: "read" }))
    for (const verdict of ["fail", "pass"] as const) for (let i = 0; i < 2; i++)
      store.record(actor("reviewer"), focus, { kind: "qa", verdict, statement: `Partial ${verdict} check ${i}.`, evidence_ids: observations.map(record => record.id) })
    const usual = store.engineeringHistory.read({ action_id: action.id })
    const small = store.engineeringHistory.read({ action_id: action.id, limit: 1 })
    expect(usual.highlights).toHaveLength(4)
    expect(usual.relationships).toHaveLength(80)
    expect(small.highlights).toHaveLength(2)
    expect(small.highlights.map(record => record.verdict).sort()).toEqual(["fail", "pass"])
    expect(small.relationships).toHaveLength(2)
    expect(small.totals).toEqual(usual.totals)
    expect(small.highlights.every(record => record.gaps.some(gap => gap.code === "relationships-omitted" && gap.detail.startsWith("19 ")))).toBe(true)
    expect(small.coverage.gaps.some(gap => gap.code === "representative-highlights")).toBe(true)
  } finally { db.close() }
})
