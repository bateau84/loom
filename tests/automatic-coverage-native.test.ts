import { test, expect } from "bun:test"
import { Database } from "bun:sqlite"
import { Observer } from "../src/context.js"
import { Learning } from "../src/learning.js"
import { digest } from "../src/model.js"
import { Store } from "../src/store.js"

const actor = { session_id: "owner", agent: "coder" }
const priorInstructions = "Project existing authorized ledger, authored objective links and immutable review sources into observations, not native execution attestations. Keep correction relations and historical reviewed membership distinct; a partial re-review does not clear unreviewed work. Preserve authored versus observed outcomes, source order and scope. Deduplicate evidence, not originating goals. Tool completion is not correctness. Skills observed before or after outcomes do not establish causal effect. No model, mutation, experiment or paid dispatch. Missing original sources invalidate dependent reports. Overall completion means all frozen members were processed, never objective success."
type Coverage = {
  capture_gap: boolean | null; attribution: string | null; attribution_excerpted: boolean;
  finish_pairing: "paired" | "unestablished" | "not-applicable";
}
type Description = { observations: Array<{ source: { id: string }; coverage?: Coverage }> }
function fixture() {
  const action = new Database(":memory:"), derived = new Database(":memory:")
  const store = new Store(action), learning = new Learning(derived, store, action), observer = new Observer(store)
  const event = { sessionID: actor.session_id, agent: actor.agent, messageID: "m", id: "call", tool: "read", input: { path: "fixture" } }
  const run = () => learning.automatic.run(actor.session_id, async () => {}, new AbortController().signal)
  return { action, derived, store, learning, observer, event, run, close() { derived.close(true); action.close(true) } }
}
function descriptions(f: ReturnType<typeof fixture>, batch: string) {
  return f.learning.automatic.history.reports(batch, actor.session_id).items
    .flatMap(item => (item.report!.body as Description).observations)
}

test("a real observed start after a capture gap retains continuity and attribution in automatic reports", async () => {
  const f = fixture()
  try {
    f.observer.captureGap()
    const start = f.observer.before(f.event)
    const finish = f.observer.after({ ...f.event, status: "error", error: { message: "failed" } })!
    expect(start.data.capture_gap).toBe(true)
    expect(String(finish.data.attribution)).toContain("capture-gap")
    // The same original also occurs in authored objective membership. Counts
    // describe unique source records, not duplicate membership or distinct gaps.
    f.learning.objectives.create(actor, f.learning.objectives.ledgerSource(start.id), "One authored goal")
    const before = f.action.query("SELECT id,data FROM ledger ORDER BY seq").all()
    const result = await f.run()
    expect(result.state).toBe("complete")
    const observations = descriptions(f, result.batch_id!)
    expect(observations.find(item => item.source.id === start.id)!.coverage).toMatchObject({ capture_gap: true, finish_pairing: "not-applicable" })
    expect(observations.find(item => item.source.id === finish.id)!.coverage).toMatchObject({
      attribution: finish.data.attribution, attribution_excerpted: false, finish_pairing: "unestablished",
    })
    expect(f.learning.automatic.history.report(result.batch_id!, actor.session_id)!.body).toMatchObject({
      population: { complete_through_frozen_boundary: true },
      coverage: { complete_native_history: false, observation_records: 2, capture_gap_flagged_records: 1, unestablished_finish_records: 1 },
    })
    expect(f.action.query("SELECT id,data FROM ledger ORDER BY seq").all()).toEqual(before)
  } finally { f.close() }
})

test("healthy observed pairing is preserved without claiming complete native history", async () => {
  const f = fixture()
  try {
    const start = f.observer.before(f.event)
    const finish = f.observer.after({ ...f.event, status: "completed", result: { content: "read" } })!
    expect(start.data.capture_gap).toBe(false)
    expect(finish.data.attribution).toBe("captured-at-start")
    const result = await f.run(), observations = descriptions(f, result.batch_id!)
    expect(observations.find(item => item.source.id === start.id)!.coverage).toMatchObject({ capture_gap: false })
    expect(observations.find(item => item.source.id === finish.id)!.coverage).toMatchObject({ capture_gap: null, finish_pairing: "paired" })
    expect(f.learning.automatic.history.report(result.batch_id!, actor.session_id)!.body).toMatchObject({
      coverage: { complete_native_history: false, capture_gap_flagged_records: 0, unknown_capture_continuity_records: 1, unestablished_finish_records: 0 },
      objective_success: "not-assessed",
    })
  } finally { f.close() }
})

test("missing continuity stays unknown and long attribution is explicitly excerpted", async () => {
  const f = fixture()
  try {
    const original = f.store.observe(actor, undefined, { phase: "finished", status: "completed", attribution: "x".repeat(400) })
    const result = await f.run()
    const coverage = descriptions(f, result.batch_id!).find(item => item.source.id === original.id)!.coverage!
    expect(coverage).toMatchObject({ capture_gap: null, attribution: "x".repeat(200), attribution_excerpted: true, finish_pairing: "unestablished" })
    expect(f.learning.automatic.history.report(result.batch_id!, actor.session_id)!.body).toMatchObject({
      coverage: { complete_native_history: false, unknown_capture_continuity_records: 1, unestablished_finish_records: 1 },
    })
    expect(original.data.attribution).toHaveLength(400)
  } finally { f.close() }
})

test("a report from the old gap-omitting method is retained but not reused as the corrected interpretation", async () => {
  const f = fixture()
  try {
    f.observer.captureGap()
    f.observer.before(f.event)
    const engine = f.learning.automatic, frozen = engine.sources.snapshot(actor.session_id)
    const older = engine.history.freeze({ owner_session: actor.session_id, scope_key: "permitted-session-evidence",
      source_store_id: engine.sources.namespace, ...frozen,
      method: { id: "descriptive-source-analysis/v2", instruction_sha256: digest(priorInstructions) } })
    const acquisition = engine.history.claim(older.id, "old-method-fixture")
    if (acquisition.status !== "claimed") throw new Error("Expected fresh fixture claim")
    for (const member of frozen.members) engine.history.checkpoint(acquisition.claim, member.key, {
      body: { method: "descriptive-source-analysis/v2", scope: "provisional-session-fragment", observations: [] },
      dependencies: [], qualifications: ["legacy-gap-projection"],
    })
    engine.history.publish(acquisition.claim, { body: { legacy_projection: true }, dependencies: [], qualifications: ["legacy-gap-projection"] })
    const result = await f.run()
    expect(result.state).toBe("complete")
    expect(result.batch_id).not.toBe(older.id)
    expect(engine.history.report(result.batch_id!, actor.session_id)!.body).toMatchObject({ coverage: { capture_gap_flagged_records: 1 } })
    expect(engine.history.report(older.id, actor.session_id)!.body).toEqual({ legacy_projection: true })
    expect(engine.history.get(older.id, actor.session_id).state).toBe("stale")
  } finally { f.close() }
})
