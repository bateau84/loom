import { expect, spyOn, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { IncrementalInterpretation, incrementalInterpretationScope } from "../src/incremental-interpretation.js"
import type { IncrementReportBody } from "../src/automatic-learning.js"
import { canonical, digest } from "../src/model.js"
import type { IncrementalInterpretationConfig } from "../src/config.js"
import type { RetrospectiveSourceResolver } from "../src/retrospective-populations.js"
import { ACTOR, POLICY, openState, freshSignal, method } from "./helpers/evaluator-execution-fixture.js"
import { publicationFixture } from "./helpers/evaluator-publication-fixture.js"

const config = (overrides: Partial<IncrementalInterpretationConfig> = {}): IncrementalInterpretationConfig => ({
  enabled: true, method: method(), budget_policy: POLICY, min_sources: 1, max_age_ms: 60000, min_interval_ms: 0, ...overrides,
})
function setup() {
  const root = mkdtempSync(join(tmpdir(), "loom-incremental-interpretation-")), path = join(root, "state")
  let state = openState(path)
  const authorize = async () => {}
  const resolve: RetrospectiveSourceResolver = async request => {
    const original = state.learning.automatic.sources.resolve(request.source, request.source_store_id)
    return original ? { ...request, status: "available", source: original.ref, value: original.value } : { ...request, status: "missing" }
  }
  return { root, path, get state() { return state }, access: { authorize, resolve },
    async record(statement = "Ordinary Session engineering evidence", kind: "result" | "concern" = "result") {
      return state.store.record(ACTOR, undefined, { kind, statement })
    },
    async collect(limit = 128) {
      let result = await state.learning.automatic.run(ACTOR.session_id, authorize, freshSignal(), { incremental: true, max_sources: limit })
      while (result.state === "pending") result = await state.learning.automatic.run(ACTOR.session_id, authorize, freshSignal(), { incremental: true, max_sources: limit })
      return result
    },
    restart() { state.close(); state = openState(path) },
    close() { state.close(); rmSync(root, { recursive: true, force: true }) } }
}
function pendingPopulation(f: ReturnType<typeof setup>, settings = config()) {
  const progress = f.state.learning.incrementalInterpretation.progress(ACTOR.session_id, settings)
  const intent = f.state.learning.automatic.history.incrementalHead(ACTOR.session_id, incrementalInterpretationScope(settings.method!))
  if (!progress.pending || intent?.id !== progress.pending.batch_id) throw new Error("Fixture lacks an exact pending population")
  return f.state.learning.automatic.history.retrospectivePopulation(String(intent.boundary.population_id), ACTOR.session_id)
}
function native(f: ReturnType<typeof setup>, settings = config()) {
  const population = pendingPopulation(f, settings)
  const fixture = publicationFixture(f.state, ACTOR, { manifest: population.manifest, authorityPath: join(f.root, "authority.sqlite"), resolve: f.access.resolve })
  const engine = new IncrementalInterpretation(f.state.learning.automatic, f.state.learning.populations, f.state.learning.evaluator, fixture.runtime)
  return { fixture, engine, run: (signal = freshSignal()) => engine.opportunity(ACTOR, settings, f.access, signal) }
}

test("cheap interpretation coalesces metadata without original retrieval, prepares once without authority, and keeps an exact partial checkpoint cutoff", async () => {
  const f = setup(), settings = config({ min_sources: 3 })
  try {
    await f.record("First meaningful record"); await f.collect(1)
    const original = spyOn(f.state.learning.automatic.sources, "resolve")
    for (let i = 0; i < 20; i++) expect(await f.state.learning.incrementalInterpretation.opportunity(ACTOR, settings, f.access, freshSignal()))
      .toMatchObject({ state: "waiting", reason: "coalescing-new-evidence" })
    expect(original).not.toHaveBeenCalled(); original.mockRestore()
    await f.record("Second"); await f.record("Third"); await f.record("Later append beyond processed frontier"); await f.collect(2)
    const plan = await f.state.learning.incrementalInterpretation.opportunity(ACTOR, settings, f.access, freshSignal())
    expect(plan).toMatchObject({ state: "blocked", reason: "evaluator-execution-authority-unavailable" })
    const progress = f.state.learning.incrementalInterpretation.progress(ACTOR.session_id, settings)
    expect(progress.processed).toBeNull(); expect(progress.interpreted).toBeNull()
    const population = pendingPopulation(f, settings)
    expect(population.manifest.members).toHaveLength(3)
    expect(population.manifest.selection.mode).toBe("explicit-subject")
    if (population.manifest.selection.mode !== "explicit-subject") throw new Error("Expected ordinary Session selection")
    expect(population.manifest.selection.target).toEqual({ kind: "session", id: ACTOR.session_id })
    expect(population.manifest.selection.frontier.ledger).toBe(3)
    const repeated = spyOn(f.state.learning.automatic.sources, "resolve")
    for (let i = 0; i < 20; i++) expect((await f.state.learning.incrementalInterpretation.opportunity(ACTOR, settings, f.access, freshSignal())).batch_id).toBe(plan.batch_id)
    expect(repeated).not.toHaveBeenCalled(); repeated.mockRestore()
    expect(progress.pending!.preparation).not.toHaveProperty("request_id")
    expect(progress.pending!.preparation).not.toHaveProperty("manifest_sha256")
    expect(progress.pending!.preparation).not.toHaveProperty("attempt_id")
    expect(f.state.learning.automatic.history.listScope(ACTOR.session_id, incrementalInterpretationScope(method())).items).toHaveLength(1)
    expect(f.state.ledger.query("SELECT COUNT(*) AS n FROM ledger").get()).toEqual({ n: 4 })
  } finally { f.close() }
})

test("a controlled existing S5 execution commits once, unchanged idle dispatches nothing, and stronger methods retain independent cursors", async () => {
  const f = setup()
  let n: ReturnType<typeof native> | undefined
  try {
    await f.record("Preserve this original unresolved finding", "concern"); await f.record("First investigation step"); await f.collect()
    await f.state.learning.incrementalInterpretation.opportunity(ACTOR, config(), f.access, freshSignal())
    n = native(f)
    const result = await n.run()
    expect(result.state).toBe("complete"); expect(result.interpretation).toBeTruthy()
    const count = n.fixture.base.counts()
    expect(count).toEqual({ reservations: 1, consumed: 1, execute_calls: 1, effects: 1 })
    const resolve = spyOn(f.state.learning.automatic.sources, "resolve")
    for (let i = 0; i < 20; i++) expect(await n.run()).toMatchObject({ state: "caught-up", replayed: true })
    expect(resolve).not.toHaveBeenCalled(); resolve.mockRestore()
    expect(n.fixture.base.counts()).toEqual(count)
    const stronger = method(); stronger.model.model_id = "stronger-qualified-model-required"
    const strongerSettings = config({ method: stronger })
    expect(await f.state.learning.incrementalInterpretation.opportunity(ACTOR, strongerSettings, f.access, freshSignal()))
      .toMatchObject({ state: "blocked", reason: "evaluator-execution-authority-unavailable" })
    const strongerProgress = f.state.learning.incrementalInterpretation.progress(ACTOR.session_id, strongerSettings)
    expect(strongerProgress.processed).toBeNull(); expect(strongerProgress.pending!.from_sequence).toBe(0)
    expect(strongerProgress.pending!.preparation!.batch_id).not.toBe(result.interpretation!.batch_id)
    const progress = n.engine.progress(ACTOR.session_id, config())
    expect(progress.interpreted?.inspect).toEqual({ operation: "evaluation-interpretation", batch_id: result.interpretation!.batch_id })
    const s5 = spyOn(f.state.learning.automatic.history, "readEvaluatorInterpretation")
    const originals = spyOn(f.state.learning.automatic.sources, "resolve")
    const status = n.engine.progress(ACTOR.session_id, config())
    expect(status.interpreted).not.toHaveProperty("report_id")
    expect(status.interpreted).not.toHaveProperty("report_sha256")
    expect(s5).not.toHaveBeenCalled(); expect(originals).not.toHaveBeenCalled()
    s5.mockRestore(); originals.mockRestore()
    expect(f.state.ledger.query("SELECT COUNT(*) AS n FROM ledger").get()).toEqual({ n: 2 })
  } finally { n?.fixture.close(); f.close() }
})

test("failed cursor publication recovers the same completed S5 result after restart and cannot absorb later evidence", async () => {
  const f = setup()
  let n: ReturnType<typeof native> | undefined
  try {
    const original = await f.record("Original exact checkpoint"); await f.collect()
    await f.state.learning.incrementalInterpretation.opportunity(ACTOR, config(), f.access, freshSignal())
    n = native(f)
    const initial = n.engine.progress(ACTOR.session_id, config()).pending!, selectedPopulation = pendingPopulation(f)
    f.state.derived.exec("CREATE TRIGGER fail_increment_commit BEFORE INSERT ON learning_evaluation_reports WHEN json_extract(NEW.body_json,'$.format')='loom-incremental-interpretation-checkpoint/v1' BEGIN SELECT RAISE(ABORT,'checkpoint interrupted'); END")
    expect(await n.run()).toMatchObject({ state: "blocked", reason: "checkpoint interrupted", batch_id: initial.batch_id })
    expect(n.engine.progress(ACTOR.session_id, config()).processed).toBeNull()
    expect(f.state.learning.automatic.history.readEvaluatorInterpretation(initial.preparation!.batch_id, ACTOR.session_id)).not.toBeNull()
    await f.record("Concurrent append after failed cursor publication"); await f.collect()
    n.fixture.close(); n = undefined
    f.restart(); f.state.derived.exec("DROP TRIGGER fail_increment_commit")
    n = native(f)
    expect((await n.run()).state).toBe("complete")
    expect(n.fixture.base.counts().effects).toBe(1)
    const progress = n.engine.progress(ACTOR.session_id, config())
    expect(progress.processed!.sequence).toBe(initial.through_sequence)
    const population = f.state.learning.automatic.history.retrospectivePopulation(selectedPopulation.population_id, ACTOR.session_id)
    expect(population.manifest.members.map(member => member.source.id)).toEqual([original.id])
    expect(progress.state).toBe("waiting")
    await f.state.learning.incrementalInterpretation.opportunity(ACTOR, config(), f.access, freshSignal())
    const successor = f.state.learning.incrementalInterpretation.progress(ACTOR.session_id, config()).pending!
    expect(successor.batch_id).not.toBe(initial.batch_id)
    expect(successor.from_sequence).toBe(initial.through_sequence)
  } finally { n?.fixture.close(); f.close() }
})

test("quota exhaustion and cancellation before claim retain the exact pending request and never advance the cursor", async () => {
  const f = setup()
  let n: ReturnType<typeof native> | undefined
  try {
    await f.record("Work before inference resource contention"); await f.collect()
    await f.state.learning.incrementalInterpretation.opportunity(ACTOR, config(), f.access, freshSignal())
    n = native(f)
    const before = n.engine.progress(ACTOR.session_id, config()).pending
    n.fixture.base.capacity({ requests: 0, input_tokens: 0, output_tokens: 0 })
    expect(await n.run()).toMatchObject({ state: "blocked", reason: "Fixture shared pool exhausted" })
    expect(n.engine.progress(ACTOR.session_id, config()).processed).toBeNull()
    expect(n.fixture.base.counts().effects).toBe(0)
    n.fixture.base.capacity({ requests: 10, input_tokens: 100, output_tokens: 100 })
    const cancellation = new AbortController()
    n.fixture.base.phase = async phase => { if (phase === "reserved") cancellation.abort(new Error("Controlled idle cancellation")) }
    await expect(n.run(cancellation.signal)).rejects.toThrow("Controlled idle cancellation")
    expect(n.engine.progress(ACTOR.session_id, config()).pending!.preparation).toEqual(before!.preparation)
    expect(n.engine.progress(ACTOR.session_id, config()).processed).toBeNull()
    expect(n.fixture.base.counts().effects).toBe(0)
    n.fixture.base.phase = async () => {}
    expect((await n.run()).state).toBe("complete")
    expect(n.fixture.base.counts()).toEqual({ reservations: 1, consumed: 1, execute_calls: 1, effects: 1 })
  } finally { n?.fixture.close(); f.close() }
})

test("oldest bounded prefixes and durable method interval prevent loss or one model per work event", async () => {
  const f = setup()
  let n: ReturnType<typeof native> | undefined
  try {
    for (let i = 0; i < 67; i++) { await f.record("Checkpoint " + i); await f.collect(1) }
    await f.state.learning.incrementalInterpretation.opportunity(ACTOR, config(), f.access, freshSignal())
    const pending = f.state.learning.incrementalInterpretation.progress(ACTOR.session_id, config()).pending!
    const population = pendingPopulation(f)
    expect(population.manifest.members).toHaveLength(64)
    expect(Math.max(...population.manifest.members.map(member => Number(member.source.revision)))).toBe(64)
    n = native(f)
    expect((await n.run()).state).toBe("complete")
    const interval = config({ min_interval_ms: 60000 })
    const waited = await n.engine.opportunity(ACTOR, interval, f.access, freshSignal())
    expect(waited).toMatchObject({ state: "waiting", reason: "minimum-interpretation-interval" })
    expect(waited.retry_at).toBeGreaterThan(Date.now())
    expect(n.fixture.base.counts().effects).toBe(1)
    await f.state.learning.incrementalInterpretation.opportunity(ACTOR, config(), f.access, freshSignal())
    const remaining = f.state.learning.incrementalInterpretation.progress(ACTOR.session_id, config()).pending!
    const next = pendingPopulation(f)
    expect(next.manifest.members.map(member => Number(member.source.revision)).sort((a, b) => a - b)).toEqual([65, 66, 67])
    const context = (next.manifest.coverage.incremental as Record<string, unknown>).previous_interpretation
    expect(context).toMatchObject({ batch_id: pending.preparation!.batch_id, relation: "context" })
  } finally { n?.fixture.close(); f.close() }
})

test("long excluded-only prefixes checkpoint coverage without creating an S5 population or starving later engineering evidence", async () => {
  const f = setup()
  try {
    for (let i = 0; i < 66; i++) {
      const invocation = { session_id: ACTOR.session_id, message_id: "retrieval-message-" + i, call_id: "retrieval-call-" + i }
      f.state.store.observe(ACTOR, undefined, { phase: "finished", status: "error", tool: "codemode", message_id: invocation.message_id, call_id: invocation.call_id })
      f.state.learning.automatic.subjects.recordActivity({ actor: ACTOR, invocation, phase: "evidence-retrieval", outcome: "failed",
        elapsed_ms: 3, returned_bytes: 0, detail: "Supported source denied; no history crawl attempted." })
      await f.collect(1)
    }
    const engine = f.state.learning.incrementalInterpretation
    expect(await engine.opportunity(ACTOR, config(), f.access, freshSignal())).toMatchObject({ state: "complete", interpretation: null })
    expect(engine.progress(ACTOR.session_id, config()).interpreted).toBeNull()
    expect(await engine.opportunity(ACTOR, config(), f.access, freshSignal())).toMatchObject({ state: "complete", interpretation: null })
    expect((await engine.opportunity(ACTOR, config(), f.access, freshSignal())).state).toBe("caught-up")
    expect(f.state.derived.query("SELECT name FROM sqlite_schema WHERE name='learning_retrospective_populations'").get()).toBeNull()
    const record = await f.record("Engineering continues after many failed learning reads"); await f.collect(1)
    expect(await engine.opportunity(ACTOR, config(), f.access, freshSignal())).toMatchObject({ state: "blocked", reason: "evaluator-execution-authority-unavailable" })
    const pending = engine.progress(ACTOR.session_id, config()).pending!
    const population = pendingPopulation(f)
    expect(population.manifest.members.map(member => member.source.id)).toEqual([record.id])
    expect(f.state.derived.query("SELECT COUNT(*) AS n FROM learning_subject_activities WHERE json_extract(data_json,'$.phase')='evidence-retrieval'").get()).toEqual({ n: 66 })
  } finally { f.close() }
})

test("partial model populations inherit the checkpoint's namespace ceiling without advancing the Session cursor for unrelated work", async () => {
  const f = setup()
  try {
    for (let i = 0; i < 5; i++) await f.record("Owner work " + i)
    const other = { session_id: "other-session", agent: "engineer" }
    const foreign = () => {
      const record = f.state.store.record(other, undefined, { kind: "result", statement: "Unrelated namespace work" })
      f.state.learning.objectives.create(other, f.state.learning.objectives.ledgerSource(record.id), "Separately authored foreign goal")
    }
    foreign()
    const selected = await f.collect(1)
    const body = f.state.learning.automatic.history.report(selected.batch_id!, ACTOR.session_id)!.body as IncrementReportBody
    expect(body.through.ledger).toBe(1); expect(body.namespace_through!.ledger).toBe(1)
    expect(body.through.objectives).toBe(0); expect(body.namespace_through!.objectives).toBe(1)
    foreign()
    await f.state.learning.incrementalInterpretation.opportunity(ACTOR, config(), f.access, freshSignal())
    const population = pendingPopulation(f)
    expect(population.manifest.selection.mode).toBe("explicit-subject")
    if (population.manifest.selection.mode !== "explicit-subject") throw new Error("Expected ordinary Session")
    expect(population.manifest.selection.namespace_frontier).toEqual(body.namespace_through)
    const intent = f.state.learning.automatic.history.incrementalHead(ACTOR.session_id, incrementalInterpretationScope(method()))!
    expect(JSON.parse(String(intent.boundary.namespace_through))).toEqual(body.namespace_through)
    expect(population.manifest.members).toHaveLength(1)
    await f.collect()
    foreign()
    expect(await f.collect()).toMatchObject({ state: "complete", replayed: true })
  } finally { f.close() }
})

test("a rehashed report cannot replace the exact namespace frozen before deterministic processing", async () => {
  const f = setup()
  try {
    await f.record("Established source"); const completed = await f.collect()
    await f.record("Later unprocessed engineering evidence")
    const report = f.state.learning.automatic.history.report(completed.batch_id!, ACTOR.session_id)!
    const body = structuredClone(report.body) as IncrementReportBody
    body.namespace_through!.ledger++
    const sha256 = digest({ batch_id: completed.batch_id!, member_key: null, body, qualifications: report.qualifications, source_refs: report.source_refs })
    f.state.derived.query("UPDATE learning_evaluation_reports SET body_json=?,sha256=? WHERE id=?").run(canonical(body), sha256, report.id)
    expect(f.state.learning.automatic.history.report(completed.batch_id!, ACTOR.session_id)!.availability).toBe("available")
    expect(() => f.state.learning.automatic.incrementReport(ACTOR.session_id, completed.batch_id!)).toThrow("frozen evidence boundary")
    await expect(f.state.learning.incrementalInterpretation.opportunity(ACTOR, config(), f.access, freshSignal())).rejects.toThrow("frozen evidence boundary")
    expect(f.state.learning.automatic.history.incrementalHead(ACTOR.session_id, incrementalInterpretationScope(method()))).toBeNull()
    await expect(f.collect()).rejects.toThrow("frozen evidence boundary")
  } finally { f.close() }
})
