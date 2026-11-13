import { test, expect } from "bun:test"
import { Database } from "bun:sqlite"
import { Learning } from "../src/learning.js"
import { Store } from "../src/store.js"
import { workReference } from "../src/collaboration.js"

function fixture() {
  const action = new Database(":memory:"), derived = new Database(":memory:")
  const store = new Store(action), learning = new Learning(derived, store, action)
  const actor = { session_id: "owner", agent: "coder" }
  return { action, derived, store, learning, actor, close: () => { derived.close(); action.close() } }
}

test("automatic processing discovers original observations, publishes once, and never calls a model", async () => {
  const f = fixture()
  try {
    const record = f.store.observe(f.actor, undefined, { phase: "finished", tool: "test", status: "error" })
    let checks = 0
    const authorize = async () => { checks++ }
    const first = await f.learning.automatic.run("owner", authorize, new AbortController().signal)
    expect(first.state).toBe("complete")
    expect(checks).toBeGreaterThanOrEqual(2)
    const report = f.learning.automatic.history.report(first.batch_id!, "owner")!
    expect(report.availability).toBe("available")
    expect(report.source_refs.some(ref => ref.id === record.id)).toBe(true)
    expect(report.body).toMatchObject({ method: "descriptive-source-analysis/v1", objective_success: "not-assessed", genuine_evaluator: { state: "blocked" }, population: { source_count: 1, independent_originating_requests: null } })
    const again = await f.learning.automatic.run("owner", authorize, new AbortController().signal)
    expect(again.batch_id).toBe(first.batch_id)
    expect(f.learning.automatic.history.list("owner").items).toHaveLength(1)
  } finally { f.close() }
})

test("native source authorization is required before any snapshot or report", async () => {
  const f = fixture()
  try {
    f.store.observe(f.actor, undefined, { phase: "finished", status: "error" })
    await expect(f.learning.automatic.run("owner", async () => { throw new Error("denied") }, new AbortController().signal)).rejects.toThrow("denied")
    expect(f.learning.automatic.history.list("owner").items).toHaveLength(0)
  } finally { f.close() }
})

test("permission withdrawal at publication keeps a resumable checkpoint, not a completed batch", async () => {
  const f = fixture()
  try {
    f.store.observe(f.actor, undefined, { phase: "finished", status: "error" })
    let checks = 0
    await expect(f.learning.automatic.run("owner", async () => { if (++checks === 2) throw new Error("revoked") }, new AbortController().signal)).rejects.toThrow("revoked")
    const batch = f.learning.automatic.history.list("owner").items[0]!
    expect(batch).toMatchObject({ state: "pending", processed_count: 1, report_id: null })
    const resumed = await new Learning(f.derived, f.store, f.action).automatic.run("owner", async () => {}, new AbortController().signal)
    expect(resumed).toEqual({ state: "complete", batch_id: batch.id })
  } finally { f.close() }
})

test("source ownership is enforced and removed originals withhold derived report bodies", async () => {
  const f = fixture()
  try {
    const record = f.store.observe(f.actor, undefined, { phase: "finished", status: "error" })
    expect(await f.learning.automatic.run("unrelated", async () => {}, new AbortController().signal)).toEqual({ state: "empty" })
    const result = await f.learning.automatic.run("owner", async () => {}, new AbortController().signal)
    expect(() => f.learning.automatic.history.report(result.batch_id!, "unrelated")).toThrow("unavailable")
    f.action.query("DELETE FROM ledger WHERE id=?").run(record.id)
    expect(f.learning.automatic.history.get(result.batch_id!, "owner").state).toBe("incomplete")
    expect(f.learning.automatic.history.report(result.batch_id!, "owner")).toMatchObject({ availability: "source-unavailable", body: null })
  } finally { f.close() }
})

test("late contradictory observations create attributable revisions, not independent outcomes", async () => {
  const f = fixture()
  try {
    const action = f.store.create("Fix", "One originating goal", f.actor)
    const plan = f.store.savePlan(action.id, 0, [{ id: "task", kind: "task", title: "Fix" }], f.actor)
    f.store.collaboration.complete(f.actor, { work_ref: workReference(action, plan, "task"), statement: "Local work is done" })
    const first = await f.learning.automatic.run("owner", async () => {}, new AbortController().signal)
    f.store.observe(f.actor, undefined, { phase: "finished", status: "error" })
    const second = await f.learning.automatic.run("owner", async () => {}, new AbortController().signal)
    expect(second.batch_id).not.toBe(first.batch_id)
    expect(f.learning.automatic.history.get(first.batch_id!, "owner").state).toBe("stale")
    expect(f.learning.automatic.history.get(second.batch_id!, "owner")).toMatchObject({ revision: 2, previous_batch_id: first.batch_id })
    const report = f.learning.automatic.history.report(second.batch_id!, "owner")!
    expect(report.body).toMatchObject({ observations: { "reported-completion": 1, "tool-error": 1 }, population: { independent_originating_requests: null } })
    expect(JSON.stringify(report.body)).toContain("correction within one goal")
  } finally { f.close() }
})

test("cancelled processing cannot publish an overall report", async () => {
  const f = fixture()
  try {
    f.store.observe(f.actor, undefined, { phase: "finished", status: "error" })
    const controller = new AbortController()
    let n = 0
    await expect(f.learning.automatic.run("owner", async () => { if (++n === 2) controller.abort() }, controller.signal)).rejects.toThrow()
    expect(f.learning.automatic.history.list("owner").items[0]).toMatchObject({ state: "pending", report_id: null })
  } finally { f.close() }
})
