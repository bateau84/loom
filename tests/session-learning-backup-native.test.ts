import { expect, test } from "bun:test"
import { Database } from "bun:sqlite"
import { createHash } from "node:crypto"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { canonical, digest } from "../src/model.js"
import { INCREMENTAL_SCOPE } from "../src/automatic-learning.js"
import { IncrementalInterpretation, incrementalInterpretationScope } from "../src/incremental-interpretation.js"
import type { IncrementalInterpretationConfig } from "../src/config.js"
import type { EvaluatorRetrievedContext, EvaluatorSourceReader } from "../src/evaluator-execution-contract.js"
import { ACTOR, POLICY, openState, freshSignal, method } from "./helpers/evaluator-execution-fixture.js"
import { publicationFixture } from "./helpers/evaluator-publication-fixture.js"

const command = new URL("../tools/learning-state-backup.py", import.meta.url).pathname
const sha = (value: string | Uint8Array) => createHash("sha256").update(value).digest("hex")
const files = (directory: string) => Object.fromEntries(readdirSync(directory).filter(name => name !== "loom-state-manifest.json").sort()
  .map(name => [name, { size: statSync(join(directory, name)).size, sha256: sha(readFileSync(join(directory, name))) }]))
const settings = (stronger = false): IncrementalInterpretationConfig => {
  const selected = method()
  if (stronger) selected.model.model_id = "stronger-controlled-model"
  return { enabled: true, method: selected, budget_policy: POLICY, min_sources: 1, max_age_ms: 60000, min_interval_ms: 0 }
}
type Controlled = ReturnType<typeof publicationFixture>

async function fixture(withSynthesis = false) {
  const root = mkdtempSync(join(tmpdir(), "loom-session-learning-backup-")), project = join(root, "project")
  mkdirSync(project)
  const source = join(root, digest({ project: "session-learning-backup", canonical: project })), state = openState(source)
  const controlled: Controlled[] = []
  const access = { authorize: async () => {}, resolve: async (request: Parameters<Controlled["resolve"]>[0]) => {
    const original = state.learning.automatic.sources.resolve(request.source, request.source_store_id)
    return original ? { ...request, status: "available" as const, source: original.ref, value: original.value }
      : { ...request, status: "missing" as const }
  } }
  const collect = async () => {
    let result = await state.learning.automatic.run(ACTOR.session_id, access.authorize, freshSignal(), { incremental: true, max_sources: 128 })
    while (result.state === "pending") result = await state.learning.automatic.run(ACTOR.session_id, access.authorize, freshSignal(), { incremental: true, max_sources: 128 })
    if (result.state !== "complete" || !result.batch_id) throw new Error("Fixture increment did not commit")
    return result.batch_id
  }
  let expected: any
  try {
    const concern = state.store.record(ACTOR, undefined, { kind: "concern", statement: "Original engineering question remains unresolved." })
    state.store.record(ACTOR, undefined, { kind: "result", statement: "The initial investigation was interrupted before verification." })
    const first = await collect()
    const origin = { session_id: ACTOR.session_id, message_id: "review-message", call_id: "review-call" }
    const subject = state.learning.automatic.subjects.establish(ACTOR, { target: { kind: "session", id: ACTOR.session_id },
      question: "Explain the investigation, interruption and later correction." }, origin)
    state.learning.automatic.subjects.recordActivity({ subject_id: subject.subject_id, actor: ACTOR, invocation: origin,
      phase: "evidence-retrieval", outcome: "failed", returned_bytes: 640, elapsed_ms: 9,
      detail: "Supported original history lookup was unavailable; no native crawler was attempted." })
    state.learning.automatic.subjects.registerDescendant({ parent: origin, child_session_id: "retrieval-child", native_parent_session_id: ACTOR.session_id })
    state.learning.automatic.subjects.registerSessionDescendant({ child_session_id: "retrieval-grandchild", native_parent_session_id: "retrieval-child" })
    state.store.observe(ACTOR, undefined, { phase: "finished", status: "error", tool: "codemode", message_id: origin.message_id, call_id: origin.call_id })
    state.store.record({ session_id: "retrieval-child", agent: "researcher" }, undefined,
      { kind: "concern", statement: "This failed evaluation retrieval is outside the original engineering subject." })
    state.store.record(ACTOR, undefined, { kind: "result", statement: "Later continuation corrected the engineering approach." })
    const second = await collect()
    const originalRef = state.learning.automatic.sources.retrospectiveOriginal("ledger-record", concern.id, ACTOR.session_id, ACTOR.session_id)!.ref
    const population = state.learning.automatic.history.freezeRetrospective(ACTOR, state.learning.populations.fromSources(subject, [originalRef]))
    const prepared = state.learning.evaluator.prepareRetrospective(ACTOR, population, method(), POLICY)
    let result = await state.learning.incrementalInterpretation.opportunity(ACTOR, settings(), access, freshSignal())
    if (result.state !== "blocked" || result.reason !== "evaluator-execution-authority-unavailable") throw new Error("Fixture requires a durable unqualified pending request")
    const syntheses: Array<{ batch_id: string; report_id: string; report_sha256: string }> = []
    if (withSynthesis) {
      for (let iteration = 0; iteration < 2; iteration++) {
        if (iteration) {
          state.store.record(ACTOR, undefined, { kind: "result", statement: "Subsequent verification limits the earlier conclusion." })
          await collect()
          await state.learning.incrementalInterpretation.opportunity(ACTOR, settings(), access, freshSignal())
        }
        const progress = state.learning.incrementalInterpretation.progress(ACTOR.session_id, settings())
        const intent = state.learning.automatic.history.incrementalHead(ACTOR.session_id, incrementalInterpretationScope(settings().method!))
        if (!progress.pending || intent?.id !== progress.pending.batch_id) throw new Error("Fixture lacks exact pending interpretation")
        const frozen = state.learning.automatic.history.retrospectivePopulation(String(intent.boundary.population_id), ACTOR.session_id)
        const producer = publicationFixture(state, ACTOR, { manifest: frozen.manifest, resolve: access.resolve,
          authorityPath: join(root, `authority-${iteration}.sqlite`), claims: 1 })
        controlled.push(producer)
        const previous = syntheses.at(-1)
        if (previous) {
          const own = state.learning.automatic.history.readEvaluatorInterpretation(previous.batch_id, ACTOR.session_id)!.population.manifest.members[0]!
          const reference = { kind: "prior-original" as const, report_id: previous.report_id, report_sha256: previous.report_sha256,
            member_key: own.key, source_index: 0 as const }
          producer.interpretation.prior_interpretations.push({ report_id: previous.report_id, report_sha256: previous.report_sha256,
            relation: "context", reason: "Retain the earlier original without invalidating its report." })
          producer.interpretation.claims[0]!.contradicting.push(reference)
          const execute = producer.authority.execute.bind(producer.authority), readResult = producer.authority.readResult!.bind(producer.authority)
          producer.base.db.exec("CREATE TABLE fixture_context(admission TEXT PRIMARY KEY,receipts TEXT NOT NULL)")
          producer.authority.execute = async (admission, read, signal) => {
            const source: EvaluatorSourceReader = Object.assign(async (key: string, index: number) => {
              const { kind: _kind, ...selection } = reference
              const earlier = await read.interpretations.source(selection) as any
              const receipts: EvaluatorRetrievedContext[] = [{ ...reference, source_sha256: earlier.source.sha256,
                receipt_id: "durable-earlier-original", boundary: "native-tool-result" }]
              producer.base.db.query("INSERT INTO fixture_context VALUES(?,?)").run(digest(admission), canonical(receipts))
              return read(key, index)
            }, { interpretations: read.interpretations })
            return execute(admission, source, signal)
          }
          producer.authority.readResult = async (admission, receipt) => {
            const original = await readResult(admission, receipt)
            const delivered = producer.base.db.query("SELECT receipts FROM fixture_context WHERE admission=?").get(digest(admission)) as { receipts: string }
            return { ...original, context_retrieved: JSON.parse(delivered.receipts) }
          }
        }
        const engine = new IncrementalInterpretation(state.learning.automatic, state.learning.populations, state.learning.evaluator, producer.runtime)
        result = await engine.opportunity(ACTOR, settings(), access, freshSignal())
        if (result.state !== "complete" || !result.interpretation) throw new Error("Controlled S5 checkpoint failed: " + JSON.stringify(result))
        syntheses.push(result.interpretation)
      }
      // A suffix consisting only of learning preparation rows advances
      // processing coverage without making another model result or objective.
      await collect()
      const empty = await state.learning.incrementalInterpretation.opportunity(ACTOR, settings(), access, freshSignal())
      if (empty.state !== "complete" || empty.interpretation !== null) throw new Error("Expected explicit no-inference checkpoint")
      await state.learning.incrementalInterpretation.opportunity(ACTOR, settings(true), access, freshSignal())
    }
    const history = state.learning.automatic.history
    const batches = history.listScope(ACTOR.session_id, INCREMENTAL_SCOPE, { direction: "asc" }).items
    expected = { first, second, subject, population, prepared, syntheses,
      batches: batches.map(batch => ({ id: batch.id, report: history.report(batch.id, ACTOR.session_id) })),
      progress: state.learning.incrementalInterpretation.progress(ACTOR.session_id, settings()),
      stronger: withSynthesis ? state.learning.incrementalInterpretation.progress(ACTOR.session_id, settings(true)) : null,
      activities: state.learning.automatic.subjects.activities(subject.subject_id, ACTOR.session_id),
      ledgerCount: state.ledger.query("SELECT COUNT(*) AS n FROM ledger").get() }
    expect(state.ledger.query("SELECT COUNT(*) AS n FROM actions").get()).toEqual({ n: 0 })
    expect(state.ledger.query("SELECT COUNT(*) AS n FROM plans").get()).toEqual({ n: 0 })
    expect(state.derived.query("SELECT COUNT(*) AS n FROM learning_objectives").get()).toEqual({ n: 0 })
  } catch (error) { state.close(); for (const producer of controlled) producer.close(); rmSync(root, { recursive: true, force: true }); throw error }
  state.close()
  const backup = join(root, "backup"), destinationParent = join(root, "restored")
  mkdirSync(destinationParent)
  const destination = join(destinationParent, source.slice(source.lastIndexOf("/") + 1))
  const flags = ["--project-id", "session-learning-backup", "--project-canonical", project,
    "--loom-revision", "389598a0d88645a76c6ef77b91eb060a721e7607", "--package-version", "2.0.0-alpha.1"]
  const run = (operation: "backup" | "restore") => Bun.spawnSync(["python3", command, operation,
    ...(operation === "backup" ? ["--source-dir", source, "--backup-dir", backup] : ["--backup-dir", backup, "--destination-dir", destination]), ...flags],
    { env: { ...process.env, LOOM_WRITERS_STOPPED: "yes" } })
  return { root, source, backup, destination, expected, controlled, run,
    close() { for (const producer of controlled) producer.close(); rmSync(root, { recursive: true, force: true }) } }
}
const ok = (result: ReturnType<Awaited<ReturnType<typeof fixture>>["run"]>) => {
  if (result.exitCode !== 0) throw new Error(result.stderr.toString())
}
function rehashBackup(directory: string) {
  const path = join(directory, "loom-state-manifest.json"), manifest = JSON.parse(readFileSync(path, "utf8"))
  manifest.files = files(directory); writeFileSync(path, JSON.stringify(manifest))
}
function changeBoundary(db: Database, batchID: string, change: (value: any) => void) {
  const row = db.query("SELECT * FROM learning_evaluation_batches WHERE id=?").get(batchID) as any
  const boundary = JSON.parse(row.boundary_json); change(boundary)
  const identity = digest({ owner: row.owner_session, scope: row.scope_key, namespace: row.source_store_id,
    boundary, method: JSON.parse(row.method_json), membership: row.membership_sha256 })
  db.query("UPDATE learning_evaluation_batches SET boundary_json=?,identity=? WHERE id=?").run(canonical(boundary), identity, batchID)
}
function rehashReports(db: Database, batchID: string, change?: (body: any) => void) {
  let overall = ""
  const rows = db.query("SELECT * FROM learning_evaluation_reports WHERE batch_id=? ORDER BY member_key").all(batchID) as any[]
  for (const row of rows) {
    const body = JSON.parse(row.body_json)
    change?.(body)
    if (row.member_key !== null && body.format === "loom-evaluator-member/v1") body.report_sha256 = overall
    const sources = (db.query("SELECT source_ref FROM learning_evaluation_dependencies WHERE report_id=? ORDER BY source_key").all(row.id) as any[]).map(item => JSON.parse(item.source_ref))
    const checksum = digest({ batch_id: batchID, member_key: row.member_key, body, qualifications: JSON.parse(row.qualifications_json), source_refs: sources })
    db.query("UPDATE learning_evaluation_reports SET body_json=?,sha256=? WHERE id=?").run(canonical(body), checksum, row.id)
    if (row.member_key === null) overall = checksum
  }
  return overall
}

for (const synthesis of [false, true]) test(`paired stopped backup restores ordinary Session increments, exact subjects and ${synthesis ? "controlled S5 context checkpoints" : "unqualified pending preparation"}`, async () => {
  const f = await fixture(synthesis)
  try {
    const before = files(f.source), inference = f.controlled.map(producer => producer.base.counts())
    ok(f.run("backup")); ok(f.run("restore"))
    expect(files(f.source)).toEqual(before); expect(files(f.destination)).toEqual(before)
    const restored = openState(f.destination)
    try {
      const history = restored.learning.automatic.history
      for (const batch of f.expected.batches) expect(history.report(batch.id, ACTOR.session_id)).toEqual(batch.report)
      expect(restored.learning.automatic.subjects.read(f.expected.subject.subject_id, ACTOR.session_id)).toEqual(f.expected.subject)
      expect(restored.learning.automatic.subjects.activities(f.expected.subject.subject_id, ACTOR.session_id)).toEqual(f.expected.activities)
      expect(restored.learning.automatic.sources.isEvaluationSession("retrieval-grandchild")).toBe(true)
      expect(history.retrospectivePopulation(f.expected.population.population_id, ACTOR.session_id)).toEqual(f.expected.population)
      expect(restored.learning.evaluator.read(ACTOR.session_id, f.expected.prepared.batch_id)).toEqual(f.expected.prepared)
      expect(restored.learning.incrementalInterpretation.progress(ACTOR.session_id, settings())).toEqual(f.expected.progress)
      if (synthesis) {
        expect(restored.learning.incrementalInterpretation.progress(ACTOR.session_id, settings(true))).toEqual(f.expected.stronger)
        const latest = f.expected.syntheses.at(-1), report = history.readEvaluatorInterpretation(latest.batch_id, ACTOR.session_id)!
        expect(report.report.sha256).toBe(latest.report_sha256)
        expect(report.report.body.context_retrieved).toHaveLength(1)
      }
      const replay = await restored.learning.automatic.run(ACTOR.session_id, async () => {}, freshSignal(), { incremental: true })
      expect(replay.state).toBe("complete")
      // Preparation added review-owner audit rows after the last engineering
      // checkpoint. Catch-up may acknowledge this excluded-only suffix once.
      if (replay.batch_id !== f.expected.batches.at(-1).id)
        expect(history.report(replay.batch_id!, ACTOR.session_id)!.body).toMatchObject({ new_sources: 0 })
      expect(await restored.learning.automatic.run(ACTOR.session_id, async () => {}, freshSignal(), { incremental: true }))
        .toMatchObject({ state: "complete", batch_id: replay.batch_id, replayed: true })
      expect(restored.ledger.query("SELECT COUNT(*) AS n FROM ledger").get()).toEqual(f.expected.ledgerCount)
      expect(f.controlled.map(producer => producer.base.counts())).toEqual(inference)
    } finally { restored.close() }
  } finally { f.close() }
})

for (const damage of ["missing subject", "changed subject", "lost descendant origin", "owner cursor outside range", "skipped owner cursor", "missing namespace checkpoint", "widened namespace checkpoint", "changed report namespace", "skipped source checkpoint", "lost committed checkpoint", "omitted original dependency", "changed member slot"] as const)
  test("restore refuses rehashed Session learning " + damage, async () => {
    const f = await fixture()
    try {
      ok(f.run("backup"))
      const db = new Database(join(f.backup, "learning.sqlite"))
      try {
        if (damage === "missing subject") db.query("DELETE FROM learning_subject_subjects WHERE id=?").run(f.expected.subject.subject_id)
        else if (damage === "changed subject") {
          const row = db.query("SELECT data_json FROM learning_subject_subjects WHERE id=?").get(f.expected.subject.subject_id) as any
          const value = JSON.parse(row.data_json); value.through.ledger++
          const text = canonical(value)
          db.query("UPDATE learning_subject_subjects SET data_json=?,sha256=? WHERE id=?").run(text, sha(text), f.expected.subject.subject_id)
        } else if (damage === "lost descendant origin") {
          db.query("DELETE FROM learning_subject_activities WHERE call_id='review-call'").run()
          const row = db.query("SELECT data_json FROM learning_subject_descendants WHERE session_id='retrieval-child'").get() as any
          const value = JSON.parse(row.data_json); value.parent.call_id = "unknown-call"
          const text = canonical(value)
          db.query("UPDATE learning_subject_descendants SET data_json=?,sha256=? WHERE session_id='retrieval-child'").run(text, sha(text))
        } else if (damage === "owner cursor outside range") changeBoundary(db, f.expected.second, boundary => { boundary.through_owner = 5 })
        else if (damage === "skipped owner cursor") changeBoundary(db, f.expected.second, boundary => { boundary.from_owner = (boundary.from_owner + 1) % 5 })
        else if (damage === "missing namespace checkpoint") changeBoundary(db, f.expected.second, boundary => { delete boundary.namespace_through })
        else if (damage === "widened namespace checkpoint") changeBoundary(db, f.expected.second, boundary => {
          const namespace = JSON.parse(boundary.namespace_through); namespace.objective_links++
          boundary.namespace_through = canonical(namespace)
        })
        else if (damage === "changed report namespace") {
          rehashReports(db, f.expected.second, body => { if (body.namespace_through) body.namespace_through.objectives++ })
          const row = db.query("SELECT report_id FROM learning_evaluation_batches WHERE id=?").get(f.expected.second) as any
          const report = db.query("SELECT sha256 FROM learning_evaluation_reports WHERE id=?").get(row.report_id) as any
          changeBoundary(db, f.expected.progress.pending.batch_id, boundary => {
            const sources = JSON.parse(boundary.source_batches)
            sources.find((source: any) => source.report_id === row.report_id).sha256 = report.sha256
            boundary.source_batches = canonical(sources)
          })
        }
        else if (damage === "skipped source checkpoint") changeBoundary(db, f.expected.progress.pending.batch_id, boundary => {
          boundary.source_batches = canonical(JSON.parse(boundary.source_batches).slice(1))
        })
        else if (damage === "lost committed checkpoint") {
          db.query("DELETE FROM learning_evaluation_dependencies WHERE report_id IN (SELECT id FROM learning_evaluation_reports WHERE batch_id=?)").run(f.expected.first)
          db.query("DELETE FROM learning_evaluation_reports WHERE batch_id=?").run(f.expected.first)
          db.query("DELETE FROM learning_evaluation_members WHERE batch_id=?").run(f.expected.first)
          db.query("DELETE FROM learning_evaluation_batches WHERE id=?").run(f.expected.first)
        }
        else if (damage === "omitted original dependency") {
          const report = db.query("SELECT report_id FROM learning_evaluation_batches WHERE id=?").get(f.expected.second) as any
          const dependency = db.query("SELECT source_key FROM learning_evaluation_dependencies WHERE report_id=? LIMIT 1").get(report.report_id) as any
          db.query("DELETE FROM learning_evaluation_dependencies WHERE report_id=? AND source_key=?").run(report.report_id, dependency.source_key)
          rehashReports(db, f.expected.second)
          // Keep the pending model's receipt hash consistent with this forged
          // report, so the frozen original union must detect the omission.
          const changed = db.query("SELECT sha256 FROM learning_evaluation_reports WHERE id=?").get(report.report_id) as any
          changeBoundary(db, f.expected.progress.pending.batch_id, boundary => {
            const sources = JSON.parse(boundary.source_batches)
            sources.find((source: any) => source.report_id === report.report_id).sha256 = changed.sha256
            boundary.source_batches = canonical(sources)
          })
        } else {
          db.query("UPDATE learning_evaluation_reports SET slot='unattributed-member' WHERE batch_id=? AND member_key IS NOT NULL").run(f.expected.second)
        }
      } finally { db.close(true) }
      rehashBackup(f.backup)
      const restored = f.run("restore")
      expect(restored.exitCode).not.toBe(0)
      expect(existsSync(f.destination)).toBe(false)
    } finally { f.close() }
  })

test("stopped recovery preserves missing engineering originals but cannot present their dependent learning or advance past the loss", async () => {
  const f = await fixture()
  try {
    const source = f.expected.population.manifest.members[0].source
    const ledger = new Database(join(f.source, "ledger.sqlite"))
    try { ledger.query("DELETE FROM ledger WHERE id=?").run(source.id) } finally { ledger.close(true) }
    ok(f.run("backup")); ok(f.run("restore"))
    const restored = openState(f.destination)
    try {
      expect(restored.learning.automatic.history.report(f.expected.second, ACTOR.session_id))
        .toMatchObject({ availability: "source-unavailable", body: null })
      const count = restored.derived.query("SELECT COUNT(*) AS n FROM learning_evaluation_batches").get()
      await expect(restored.learning.automatic.run(ACTOR.session_id, async () => {}, freshSignal(), { incremental: true }))
        .rejects.toThrow("Original retained learning source unavailable")
      expect(restored.derived.query("SELECT COUNT(*) AS n FROM learning_evaluation_batches").get()).toEqual(count)
      expect(restored.learning.automatic.subjects.read(f.expected.subject.subject_id, ACTOR.session_id)).toEqual(f.expected.subject)
    } finally { restored.close() }
  } finally { f.close() }
})

test("restore refuses a rehashed prior-original receipt outside its named frozen report", async () => {
  const f = await fixture(true)
  try {
    ok(f.run("backup"))
    const db = new Database(join(f.backup, "learning.sqlite"))
    try {
      const latest = f.expected.syntheses.at(-1), row = db.query("SELECT body_json FROM learning_evaluation_reports WHERE id=?").get(latest.report_id) as any
      const body = JSON.parse(row.body_json); body.context_retrieved[0].source_sha256 = "f".repeat(64)
      db.query("UPDATE learning_evaluation_reports SET body_json=? WHERE id=?").run(canonical(body), latest.report_id)
      const changed = rehashReports(db, latest.batch_id)
      const checkpoints = db.query("SELECT id,batch_id,body_json FROM learning_evaluation_reports WHERE json_extract(body_json,'$.interpretation.report_id')=? OR json_extract(body_json,'$.previous_interpretation.report_id')=?")
        .all(latest.report_id, latest.report_id) as any[]
      for (const checkpoint of checkpoints) {
        const value = JSON.parse(checkpoint.body_json)
        if (value.interpretation?.report_id === latest.report_id) value.interpretation.report_sha256 = changed
        if (value.previous_interpretation?.report_id === latest.report_id) value.previous_interpretation.report_sha256 = changed
        db.query("UPDATE learning_evaluation_reports SET body_json=? WHERE id=?").run(canonical(value), checkpoint.id)
      }
      for (const batch of db.query("SELECT id,boundary_json FROM learning_evaluation_batches").all() as any[]) {
        const previous = JSON.parse(batch.boundary_json).previous_interpretation
        if (typeof previous === "string" && JSON.parse(previous)?.report_id === latest.report_id)
          changeBoundary(db, batch.id, boundary => { const value = JSON.parse(boundary.previous_interpretation); value.report_sha256 = changed; boundary.previous_interpretation = canonical(value) })
      }
      for (const batchID of new Set(checkpoints.map(checkpoint => checkpoint.batch_id))) rehashReports(db, batchID)
    } finally { db.close(true) }
    rehashBackup(f.backup)
    const result = f.run("restore")
    expect(result.exitCode).not.toBe(0)
    expect(result.stderr.toString()).toContain("Context original")
    expect(existsSync(f.destination)).toBe(false)
  } finally { f.close() }
})
