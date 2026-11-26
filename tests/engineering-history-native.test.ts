import { test, expect } from "bun:test"
import { Database } from "bun:sqlite"
import { createHash } from "node:crypto"
import { Store, type SQL } from "../src/store.js"
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

test("selective discovery finds old eligible evidence outside every overview representative and keeps its append boundary", () => {
  const { db, store, action } = fixture()
  try {
    const old = store.record(actor("old_investigation"), { action_id: action.id }, { kind: "concern", statement: "Freshness regression at 100%_literal remains unexplained." })
    for (let i = 0; i < 40; i++) store.record(actor(`later_${i}`), { action_id: action.id }, { kind: "concern", statement: "A different later concern." })
    const overview = store.engineeringHistory.read({ action_id: action.id, limit: 1 })
    expect(overview.highlights.some(record => record.source.record_id === old.id)).toBe(false)
    const found = store.engineeringHistory.read({ action_id: action.id, match: "FRESHNESS REGRESSION", record_kinds: ["concern"], limit: 1 })
    expect(found.mode).toBe("discovery")
    expect(found.records.map(record => record.source.record_id)).toEqual([old.id])
    expect(found.coverage.matching_records).toBe(1)
    expect(found.totals.records).toBe(41)
    expect(store.engineeringHistory.read({ action_id: action.id, match: "100%_literal" }).records.map(record => record.source.record_id)).toEqual([old.id])
    expect(store.engineeringHistory.read({ action_id: action.id, match: "100%_li_eral" }).records).toEqual([])
    expect(store.engineeringHistory.read(found.records[0].expand).records[0].source.record_id).toBe(old.id)
    const first = store.engineeringHistory.read({ action_id: action.id, record_kinds: ["concern"], limit: 2 })
    store.record(actor("appended"), { action_id: action.id }, { kind: "concern", statement: "Later append." })
    const next = store.engineeringHistory.read({ action_id: action.id, ...first.selection, through: first.boundary.observed_through, after: first.coverage.next_after!, limit: 2 })
    expect(next.totals.records).toBe(41)
    expect(next.coverage.matching_records).toBe(41)
    expect(next.records.map(record => record.sequence)).toEqual([3, 4])
  } finally { db.close() }
})

test("historical Plan ancestors are actionable and authored fingerprints link without inventing an exact revision", () => {
  const { db, store, action } = fixture()
  try {
    store.savePlan(action.id, 0, [{ id: "phase", kind: "phase", title: "Original phase" }, { id: "task", kind: "task", parent: "phase", title: "Original task" }], actor("planner"))
    store.select("worker", { action_id: action.id, node_id: "task" })
    const observed = store.startObservation(actor("worker"), { phase: "started", tool: "read" })
    const authored = store.record(actor("worker"), { action_id: action.id, node_id: "task" }, { kind: "result", statement: "Original contract was checked." })
    store.savePlan(action.id, 1, [{ id: "task", kind: "task", title: "Moved current task" }], actor("planner"))
    const overview = store.engineeringHistory.read({ action_id: action.id })
    const historical = overview.branches.find(branch => branch.kind === "historical-plan")!
    expect(historical.historical_scope).toEqual({ action_revision: 1, plan_revision: 1 })
    const phase = store.engineeringHistory.read(historical.expand).branches.find(branch => branch.node_id === "phase")!
    expect(phase.title).toBe("Original phase")
    const selected = store.engineeringHistory.read(phase.expand)
    expect(selected.branches.map(branch => branch.title)).toEqual(["Original task"])
    expect(selected.intended_plan).toBeNull()
    expect(selected.branches.every(branch => branch.parent_ref === phase.ref)).toBe(true)
    const work = store.engineeringHistory.read(selected.branches[0].expand)
    expect(work.records.map(record => record.source.record_id)).toEqual([observed.id])
    expect(work.ancestors.map(branch => branch.title)).toContain("Original phase")
    expect(work.related_branches.some(branch => branch.kind === "unversioned-node" && branch.gaps.some(gap => gap.code === "same-work-fingerprint"))).toBe(true)
    const report = store.engineeringHistory.read({ action_id: action.id, record_id: authored.id })
    expect(report.records[0].fingerprint).toBe(observed.fingerprint!)
    expect(report.records[0].work_ref).toBeNull()
    expect(report.related_branches.some(branch => branch.work_ref?.plan_revision === 1)).toBe(true)
  } finally { db.close() }
})

test("a reused unplanned Session has expandable recorded-message and analytical chronology children", () => {
  const { db, store, action } = fixture()
  try {
    const focus = { action_id: action.id }
    const first = store.observe(actor("reused"), focus, { phase: "started", tool: "read", message_id: "message-one", call_id: "call-one" })
    const second = store.observe(actor("reused"), focus, { phase: "started", tool: "shell", message_id: "message-two", call_id: "call-two" })
    const failure = store.record(actor("reused"), focus, { kind: "assessment", verdict: "fail", statement: "First investigation failed." })
    const result = store.record(actor("reused"), focus, { kind: "result", statement: "A later correction was reported." })
    const root = store.engineeringHistory.read({ action_id: action.id }).branches[0]
    const session = store.engineeringHistory.read(root.expand)
    expect(session.selected_branch?.child_count).toBe(4)
    expect(session.branches.filter(branch => branch.kind === "message")).toHaveLength(2)
    expect(session.branches.filter(branch => branch.meaning === "analytical-chronology")).toHaveLength(2)
    const groups = session.branches.map(branch => store.engineeringHistory.read(branch.expand))
    expect(groups.map(view => view.records.map(record => record.source.record_id))).toEqual(expect.arrayContaining([[first.id], [second.id], [failure.id], [result.id]]))
    expect(groups.every(view => view.branches.length === 0 && view.intended_plan === null)).toBe(true)
    expect(groups.every(view => view.ancestors[0].ref === root.ref)).toBe(true)
    expect(session.totals.native_dispatches).toBeNull()
  } finally { db.close() }
})

test("observation coverage and use-time provenance remain visible and selectively discoverable", () => {
  const { db, store, action } = fixture()
  try {
    const observed = store.observe(actor("worker"), { action_id: action.id }, { phase: "finished", tool: "skill", status: "completed", capture_gap: true,
      attribution: "missing-start; not assigned to current work", work_scope: { status: "unknown", reason: "not-observed", detail: "No captured start." },
      message_id: "msg", call_id: "call", input_digest: "a".repeat(64), result_digest: "b".repeat(64) })
    store.observe(actor("worker"), { action_id: action.id }, { phase: "skill-load-result", skill_id: "reviewer", rendered_sha256: "c".repeat(64),
      registry_content_sha256: "d".repeat(64), registered_content_present: true, observation: "Result provenance, not proof of model application." })
    const view = store.engineeringHistory.read({ action_id: action.id, has_gaps: true })
    expect(view.totals.capture_gap_records).toBe(1)
    expect(view.totals.unestablished_finishes).toBe(1)
    expect(view.records.find(record => record.source.record_id === observed.id)?.observation).toMatchObject({ capture_gap: true, finish_pairing: "unestablished",
      message_id: "msg", call_id: "call", input_digest: "a".repeat(64), work_scope: { status: "unknown", reason: "not-observed", detail: "No captured start." } })
    expect(view.records.find(record => record.observation?.phase === "skill-load-result")?.observation).toMatchObject({ skill_id: "reviewer", rendered_sha256: "c".repeat(64), registered_content_present: true })
    expect(view.highlights.some(record => record.source.record_id === observed.id)).toBe(true)
  } finally { db.close() }
})

test("discovery filters combine without promoting fingerprint-only reports into historical WorkRefs", () => {
  const { db, store, action } = fixture()
  try {
    store.savePlan(action.id, 0, [{ id: "task", kind: "task", title: "Stable contract" }])
    store.select("worker", { action_id: action.id, node_id: "task" })
    const first = store.startObservation(actor("worker"), { phase: "started", tool: "read", message_id: "old-message" })
    store.savePlan(action.id, 1, [{ id: "task", kind: "task", title: "Stable contract" }, { id: "unrelated", kind: "task", title: "Unrelated new work" }])
    const second = store.startObservation(actor("worker"), { phase: "started", tool: "read", message_id: "new-message" })
    const report = store.record(actor("worker"), { action_id: action.id, node_id: "task" }, { kind: "qa", verdict: "pass", statement: "The same captured contract passed." })
    expect(first.fingerprint).toBe(second.fingerprint!)
    const authored = store.engineeringHistory.read({ action_id: action.id, record_id: report.id })
    expect(authored.records[0].work_ref).toBeNull()
    expect(authored.selected_branch?.historical_scope).toBeNull()
    expect(authored.ancestors.every(branch => branch.historical_scope === null)).toBe(true)
    expect(authored.related_branches.map(branch => branch.work_ref?.plan_revision).sort()).toEqual([1, 2])
    const exact = store.engineeringHistory.read({ action_id: action.id, plan_revision: 2, node_id: "task", source_session_id: "worker", record_kinds: ["observation"], match: "read" })
    expect(exact.records.map(record => record.source.record_id)).toEqual([second.id])
    expect(store.engineeringHistory.read({ action_id: action.id, plan_revision: 2, record_kinds: ["qa"] }).coverage.matching_records).toBe(0)
    store.savePlan(action.id, 2, [{ id: "task", kind: "task", title: "Changed contract" }])
    const changed = store.record(actor("worker"), { action_id: action.id, node_id: "task" }, { kind: "qa", verdict: "pass", statement: "A different contract passed." })
    const related = store.engineeringHistory.read({ action_id: action.id, record_id: first.id }).related_branches.find(branch => branch.kind === "unversioned-node")!
    expect(store.engineeringHistory.read(related.expand).records.map(record => record.source.record_id)).toEqual([report.id])
    expect(store.engineeringHistory.read(related.expand).records.some(record => record.source.record_id === changed.id)).toBe(false)
    expect(store.engineeringHistory.read({ action_id: action.id, verdict: "fail" }).records).toEqual([])
  } finally { db.close() }
})

test("ambiguous work scope exposes only bounded candidate identities supported inside the requested scope", () => {
  const { db, store, action } = fixture()
  try {
    const plan = store.savePlan(action.id, 0, [{ id: "task", kind: "task", title: "VISIBLE_ACTION_PLAN_SECRET" }])
    const visibleRef = workReference(action, plan, "task")
    const visible = store.observe(actor("reader"), { action_id: action.id, node_id: "task" }, { phase: "started", work_scope: { status: "established", work_ref: visibleRef } })
    const hiddenAction = store.create("HIDDEN_ACTION_TITLE", "HIDDEN_ACTION_GOAL", actor("hidden"))
    const hiddenPlan = store.savePlan(hiddenAction.id, 0, [{ id: "hidden-task", kind: "task", title: "HIDDEN_PLAN_TITLE" }])
    const hiddenRef = workReference(hiddenAction, hiddenPlan, "hidden-task")
    const hidden = store.observe(actor("hidden"), { action_id: hiddenAction.id, node_id: "hidden-task" }, { phase: "started", work_scope: { status: "established", work_ref: hiddenRef } })
    const uncertain = store.observe(actor("reader"), undefined, { phase: "finished", attribution: "ambiguous-host-call; not assigned to current work",
      work_scope: { status: "ambiguous", candidates: [visibleRef, hiddenRef, { ...visibleRef, unsupported: true }], observation_ids: [visible.id, hidden.id, "missing-private-id"] } })
    const view = store.engineeringHistory.read({ session_id: "reader", record_id: uncertain.id })
    expect(view.records[0].observation?.work_scope).toEqual({ status: "ambiguous", candidates: [visibleRef], observation_ids: [visible.id], candidates_complete: false,
      candidates_omitted: 2, observation_ids_omitted: 2 })
    expect(view.totals.ambiguous_scope_records).toBe(1)
    expect(view.records[0].work_ref).toBeNull()
    const encoded = JSON.stringify(view)
    for (const secret of [hidden.id, hiddenAction.id, hiddenRef.hash, "missing-private-id", "HIDDEN_PLAN_TITLE", "VISIBLE_ACTION_PLAN_SECRET"]) expect(encoded).not.toContain(secret)
    expect(store.engineeringHistory.read({ action_id: action.id, has_gaps: true }).records.some(record => record.source.record_id === uncertain.id)).toBe(false)
  } finally { db.close() }
})

test("unsupported scope shapes and overlong attribution are qualified without arbitrary payload projection", () => {
  const { db, store, action } = fixture()
  try {
    const observed = store.observe(actor("worker"), { action_id: action.id }, { phase: "finished", attribution: "x".repeat(300), input_digest: "NOT_A_DIGEST",
      work_scope: { status: "unknown", reason: "unsupported-reason", secret: "DO_NOT_PROJECT_ARBITRARY_SCOPE" } })
    const projected = store.engineeringHistory.read({ action_id: action.id, record_id: observed.id }).records[0]
    expect(projected.observation).toMatchObject({ attribution: "x".repeat(200), attribution_excerpted: true, input_digest: null,
      finish_pairing: "unestablished", work_scope: { status: "unavailable", reason: "unsupported" } })
    expect(JSON.stringify(projected)).not.toContain("DO_NOT_PROJECT_ARBITRARY_SCOPE")
    for (const query of [{ match: "" }, { match: "x".repeat(201) }, { record_kinds: [] }, { record_kinds: ["qa", "qa"] }, { record_kinds: ["bad-kind"] },
      { plan_revision: 0 }, { source_session_id: "bad/identity" }, { has_gaps: 1 }, { match: "x", after: 1 }])
      expect(() => store.engineeringHistory.read({ action_id: action.id, ...query } as never)).toThrow()
  } finally { db.close() }
})

test("selected child pages and analytical chronology membership retain their explicit append boundary", () => {
  const { db, store, action } = fixture()
  try {
    for (let i = 0; i < 6; i++) store.observe(actor("reused"), { action_id: action.id }, { phase: "started", message_id: `message-${i}`, tool: "read" })
    const root = store.engineeringHistory.read({ action_id: action.id }).branches[0]
    const first = store.engineeringHistory.read({ ...root.expand, limit: 3 })
    expect(first.coverage).toMatchObject({ page_limit: 3, branch_count: 6, branches_returned: 3, branches_omitted: 3, total_branch_count: 7, matching_records: 6, matching_branches: 6, next_branch_offset: 3 })
    expect([...first.branches, ...first.ancestors, first.selected_branch!].every(branch => branch.expand.limit === 3)).toBe(true)
    expect([...first.records, ...first.highlights].every(record => record.expand.limit === 3)).toBe(true)
    store.observe(actor("reused"), { action_id: action.id }, { phase: "started", message_id: "after-boundary", tool: "read" })
    const next = store.engineeringHistory.read({ ...root.expand, limit: 3, branch_offset: first.coverage.next_branch_offset! })
    expect(next.coverage.next_branch_offset).toBeNull()
    expect(new Set([...first.branches, ...next.branches].map(branch => branch.ref)).size).toBe(6)
    expect(next.selected_branch?.child_count).toBe(6)
    expect(next.intended_plan).toBeNull()
    expect(next.branches.every(branch => branch.parent_ref === root.ref)).toBe(true)
    expect(store.engineeringHistory.read({ ...root.expand, through: undefined }).selected_branch?.child_count).toBe(7)
  } finally { db.close() }
})

test("request-local definition reuse still validates each historical WorkRef hash", () => {
  const { db, store, action } = fixture()
  try {
    const plan = store.savePlan(action.id, 0, [{ id: "task", kind: "task", title: "Exact historical contract" }])
    const ref = workReference(action, plan, "task")
    store.observe(actor("worker"), { action_id: action.id, node_id: "task" }, { phase: "started", work_scope: { status: "established", work_ref: ref } })
    const invalid = store.observe(actor("worker"), { action_id: action.id, node_id: "task" }, { phase: "started", work_scope: { status: "established", work_ref: { ...ref, hash: "0".repeat(64) } } })
    const view = store.engineeringHistory.read({ action_id: action.id, record_id: invalid.id })
    expect(view.selected_branch?.historical_node).toBeNull()
    expect(view.selected_branch?.parent_ref).toBeNull()
    expect(view.selected_branch?.gaps.some(gap => gap.code === "historical-definition-unavailable")).toBe(true)
    expect(view.ancestors).toEqual([])
  } finally { db.close() }
})

test("historical definition bytes are reserved before hydration and Session reads do not touch those definitions", () => {
  const { db, store, action } = fixture()
  try {
    const plan = store.savePlan(action.id, 0, [{ id: "task", kind: "task", title: "Original contract" }])
    store.observe(actor("worker"), { action_id: action.id, node_id: "task" }, { phase: "started", work_scope: { status: "established", work_ref: workReference(action, plan, "task") } })
    store.savePlan(action.id, 1, [{ id: "task", kind: "task", title: "Current contract" }])
    db.query("UPDATE plans SET data=CAST(zeroblob(?) AS TEXT) WHERE action_id=? AND revision=1").run(34 * 1024 * 1024, action.id)
    expect(() => store.engineeringHistory.read({ action_id: action.id })).toThrow("historical definitions exceed the bounded read")
    const session = store.engineeringHistory.read({ session_id: "worker" })
    expect(session.totals.records).toBe(1)
    expect(session.branches[0].historical_node).toBeNull()
    expect(JSON.stringify(session)).not.toContain("Current contract")
  } finally { db.close() }
})

test("historical definition budget includes every source-owner Action and Plan hydration", () => {
  const db = new Database(":memory:"), source = new Store(db), author = { session_id: "source", agent: "author" }
  try {
    const action = source.create("Hydration budget probe", "a".repeat(16000), author)
    for (let i = 0; i < 1375; i++) {
      source.savePlan(action.id, i, [{ id: "task", kind: "task", title: `Task definition ${i}` }], author)
      if (!i) source.select(author.session_id, { action_id: action.id, node_id: "task" })
      source.startObservation(author, { phase: "started", tool: "read" })
    }
    for (let i = 0; i < 4; i++) source.record(author, { action_id: action.id }, {
      kind: i % 2 ? "result" : "concern", statement: `Representative record ${i}`,
    })
    let measuring = false, hydratedBytes = 0
    const observed: SQL = {
      exec: statement => db.exec(statement),
      prepare(statement) {
        const prepared = db.prepare(statement)
        const track = (row: unknown) => {
          if (measuring && /FROM (action_versions|actions|plans)\b/i.test(statement)
            && row && typeof row === "object" && "data" in row && typeof row.data === "string")
            hydratedBytes += Buffer.byteLength(row.data)
          return row
        }
        return { get: (...args) => track(prepared.get(...args as never[])),
          all: (...args) => prepared.all(...args as never[]).map(track), run: (...args) => prepared.run(...args as never[]) }
      },
    }
    const store = new Store(observed)
    measuring = true
    const nearBoundary = store.engineeringHistory.read({ action_id: action.id, limit: 1 })
    expect(nearBoundary.highlights).toHaveLength(4)
    expect(hydratedBytes).toBeGreaterThan(63 * 1024 * 1024)
    expect(hydratedBytes).toBeLessThanOrEqual(64 * 1024 * 1024)
    measuring = false
    for (let i = 1375; i < 1400; i++) {
      source.savePlan(action.id, i, [{ id: "task", kind: "task", title: `Task definition ${i}` }], author)
      source.startObservation(author, { phase: "started", tool: "read" })
    }
    hydratedBytes = 0; measuring = true
    expect(() => store.engineeringHistory.read({ action_id: action.id, limit: 1 })).toThrow("historical definitions exceed the bounded read")
    expect(hydratedBytes).toBeGreaterThan(63 * 1024 * 1024)
    expect(hydratedBytes).toBeLessThanOrEqual(64 * 1024 * 1024)
  } finally { db.close() }
})

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
    const historicalPlans = view.branches.filter(branch => branch.kind === "historical-plan")
    expect(historicalPlans).toHaveLength(2)
    const historicalWork = historicalPlans.flatMap(branch => store.engineeringHistory.read(branch.expand).branches)
    const old = historicalWork.find(branch => branch.work_ref?.plan_revision === 1)!
    const current = historicalWork.find(branch => branch.work_ref?.plan_revision === 2)!
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
    expect(first.coverage.records_returned).toBe(5) // three paged records plus two independent gap representatives
    expect(first.coverage.records_omitted).toBe(2)
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
    expect(store.engineeringHistory.read({ ...first.branches[0].expand, branch_offset: 0 }).selected_branch?.ref).toBe(first.branches[0].ref)
    expect(() => store.engineeringHistory.read({ action_id: action.id, record_id: "record", branch_offset: 0 })).toThrow("only applies")
  } finally { db.close() }
})

test("a large legal Plan remains navigable through a compact qualified intent projection", () => {
  const { db, store, action } = fixture()
  try {
    store.savePlan(action.id, 0, Array.from({ length: 30 }, (_, i) => ({ id: `task_${i}`, kind: "task", title: `Task ${i}`, context: "x".repeat(7000), criteria: ["Retain the complete original contract."] })))
    const view = store.engineeringHistory.read({ action_id: action.id, limit: 1 })
    expect(view.intended_plan).toMatchObject({ revision: 1, nodes_total: 30, nodes_omitted: 10, projection: "identity-and-title" })
    expect(view.intended_plan?.nodes).toEqual(Array.from({ length: 20 }, (_, i) => ({ id: `task_${i}`, kind: "task", title: `Task ${i}` })))
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
      expect.objectContaining({ from: expect.stringContaining(second.id), to: expect.stringContaining(first.id), kind: "follows-reopen", target: "included" }),
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

test("record and branch paging does not shrink independent representative, relationship or Plan detail", () => {
  const { db, store, action } = fixture()
  try {
    const focus = { action_id: action.id }
    const observations = Array.from({ length: 20 }, () => store.observe(actor("worker"), focus, { tool: "read" }))
    for (const verdict of ["fail", "pass"] as const) for (let i = 0; i < 2; i++)
      store.record(actor("reviewer"), focus, { kind: "qa", verdict, statement: `Partial ${verdict} check ${i}.`, evidence_ids: observations.map(record => record.id) })
    const usual = store.engineeringHistory.read({ action_id: action.id })
    const small = store.engineeringHistory.read({ action_id: action.id, limit: 1 })
    expect(usual.highlights).toHaveLength(6)
    expect(usual.relationships).toHaveLength(80)
    expect(small.highlights.map(({ expand, ...record }) => record)).toEqual(usual.highlights.map(({ expand, ...record }) => record))
    expect(small.highlights.filter(record => record.meaning === "authored").map(record => record.verdict).sort()).toEqual(["fail", "fail", "pass", "pass"])
    expect(small.relationships).toEqual(usual.relationships)
    expect(small.branches).toHaveLength(1)
    expect(small.totals).toEqual(usual.totals)
    expect(small.highlights.every(record => record.gaps.every(gap => gap.code !== "relationships-omitted"))).toBe(true)
    expect(small.coverage.gaps.some(gap => gap.code === "representative-highlights")).toBe(true)
  } finally { db.close() }
})
