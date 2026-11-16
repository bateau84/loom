import { expect, test } from "bun:test"
import { Database } from "bun:sqlite"
import { copyFileSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Learning } from "../src/learning.js"
import { Store, type SQL } from "../src/store.js"
import { canonical, digest } from "../src/model.js"
import { DESCRIPTIVE_METHOD } from "../src/automatic-learning.js"
import type { EvaluatorMethodManifest } from "../src/evaluator-method.js"
import { workReference } from "../src/collaboration.js"

const actor = { session_id: "owner", agent: "general" }
function method(): EvaluatorMethodManifest {
  const ref = (locator: string) => ({ locator, sha256: "a".repeat(64) })
  const policy = (id: string) => ({ id, revision: "1", sha256: "b".repeat(64) })
  return { format: "loom-evaluator-method/v1", evaluator: { agent: "evaluator", definition: ref("fixture://evaluator") },
    audit_skill: { skill: "agent-run-audit", definition: ref("fixture://agent-run-audit") },
    rubric: ref("fixture://rubric"), instruction_bundle: ref("fixture://bundle"), result_format: "loom-evaluator-interpretation/v1",
    model: { provider_id: "unqualified-fixture", model_id: "never-dispatched", settings: ref("fixture://settings") },
    adapter: { id: "unqualified", version: "1", profile: policy("profile") }, source_policy: policy("source"), route_policy: policy("route") }
}
function fixture(root?: string, wrapLearning?: (db: Database) => SQL) {
  const action = new Database(root ? join(root, "ledger.sqlite") : ":memory:")
  const derived = new Database(root ? join(root, "learning.sqlite") : ":memory:")
  const store = new Store(action), learning = new Learning(wrapLearning ? wrapLearning(derived) : derived, store, action)
  return { action, derived, store, learning, close() { derived.close(true); action.close(true) } }
}
type Fixture = ReturnType<typeof fixture>
async function sourceBatch(f: Fixture) {
  let result = await f.learning.automatic.run(actor.session_id, async () => {}, new AbortController().signal)
  let quanta = 1
  while (result.state === "pending" && quanta++ < 100)
    result = await f.learning.automatic.run(actor.session_id, async () => {}, new AbortController().signal)
  expect(result.state).toBe("complete")
  if (!result.batch_id) throw new Error("Stage 3 failed to produce a source batch")
  return result.batch_id
}
async function seed(f: Fixture) {
  const original = f.store.record(actor, undefined, { kind: "result", statement: "Original objective: repair behavior" })
  const objective = f.learning.objectives.create(actor, f.learning.objectives.ledgerSource(original.id), "Repair behavior")
  for (const [index, outcome] of (["fail", "fail", "pass"] as const).entries()) {
    const claimed = f.store.record(actor, undefined, { kind: "result", statement: `Attempt ${index + 1} reported complete` })
    f.learning.objectives.link(actor, { objective_id: objective.id, phase: "handback", assessment: "reported-done",
      source: f.learning.objectives.ledgerSource(claimed.id) })
    const verification = f.store.record(actor, undefined, { kind: "result", statement: `Verification ${index + 1}: ${outcome}` })
    const checked = f.learning.objectives.link(actor, { objective_id: objective.id, phase: "verification", assessment: outcome,
      source: f.learning.objectives.ledgerSource(verification.id) })
    if (outcome === "fail") {
      const correction = f.store.record(actor, undefined, { kind: "result", statement: `Corrective attempt after verification ${index + 1}` })
      f.learning.objectives.link(actor, { objective_id: objective.id, phase: "corrective-dispatch", related_sequence: checked.sequence,
        source: f.learning.objectives.ledgerSource(correction.id) })
    }
  }
  return { batch: await sourceBatch(f), original, objective }
}
function mapped(f: Fixture) {
  const row = f.derived.query("SELECT batch_id,request_id,sha256 FROM learning_evaluator_requests").get() as {
    batch_id: string; request_id: string; sha256: string;
  } | null
  if (!row) throw new Error("Expected durable preparation mapping")
  return row
}
function counts(f: Fixture) {
  return { requests: f.action.query("SELECT COUNT(*) AS n FROM review_requests").get(),
    issues: f.action.query("SELECT COUNT(*) AS n FROM review_issue_intents").get(),
    mappings: f.derived.query("SELECT COUNT(*) AS n FROM learning_evaluator_requests").get() }
}

test("preparation preserves one fail/fail/pass objective and stable request identity without reasoning or effects", async () => {
  const f = fixture()
  try {
    const source = await seed(f), before = f.learning.automatic.history.report(source.batch, actor.session_id)
    const prepared = f.learning.evaluator.prepare(actor, source.batch, method(), null)
    const again = f.learning.evaluator.prepare({ ...actor, agent: "different-native-agent" }, source.batch, method(), null)
    expect(again).toEqual(prepared)
    expect(prepared).toMatchObject({ state: "prepared", mode: "preparation-only", method_binding: "declared-not-admitted",
      policy_authority: "not-established", interpretation: null, automatic_model_calls: false, budget_reservation: null,
      Q4: "partial-unqualified", Q5: "unqualified-transfer-withheld", E11: "unqualified",
      issue: { attempt: { state: "prepared", claimant_id: null, native_outcome: "not-issued" } } })
    expect(prepared.request.review_request.requester).toEqual(actor)
    expect(prepared.request.originating_request_independence).toBe("unknown")
    expect(prepared.request.review_request.members).toHaveLength(1)
    expect(prepared.request.review_request.members[0]?.producing_attempt_refs).toEqual([])
    expect(prepared.request.review_request.members[0]?.artifact_refs[0]?.version).toEqual({ kind: "sha256", value: prepared.manifest_sha256 })
    const members = f.learning.evaluator.members(actor.session_id, prepared.batch_id, prepared.request_id, prepared.manifest_sha256)
    expect(members.items.filter(member => member.kind === "objective")).toHaveLength(1)
    expect(members.items.flatMap(member => member.source_refs).some(ref => ref.kind === "objective" && ref.id === source.objective.id)).toBe(true)
    expect(f.learning.automatic.history.get(prepared.batch_id, actor.session_id)).toMatchObject({ state: "blocked", report_id: null, processed_count: 0 })
    expect(f.learning.automatic.history.report(source.batch, actor.session_id)).toEqual(before)
    expect(counts(f)).toEqual({ requests: { n: 1 }, issues: { n: 1 }, mappings: { n: 1 } })
  } finally { f.close() }
})

test("source and method changes create attributable preparation revisions without rewriting prior requests", async () => {
  const f = fixture()
  try {
    const source = await seed(f), first = f.learning.evaluator.prepare(actor, source.batch, method(), null)
    const changed = method()
    changed.rubric.sha256 = "c".repeat(64)
    const second = f.learning.evaluator.prepare(actor, source.batch, changed, null)
    expect(second.batch_id).not.toBe(first.batch_id)
    expect(second.request_id).not.toBe(first.request_id)
    expect(f.learning.automatic.history.get(second.batch_id, actor.session_id).previous_batch_id).toBe(first.batch_id)
    f.store.record(actor, undefined, { kind: "concern", statement: "Later counterevidence" })
    const laterSource = await sourceBatch(f), third = f.learning.evaluator.prepare(actor, laterSource, changed, null)
    expect(laterSource).not.toBe(source.batch)
    expect(third.batch_id).not.toBe(second.batch_id)
    expect(f.learning.automatic.history.get(third.batch_id, actor.session_id).previous_batch_id).toBe(second.batch_id)
    expect(f.learning.evaluator.read(actor.session_id, first.batch_id).request).toEqual(first.request)
    expect(f.learning.evaluator.read(actor.session_id, second.batch_id).request).toEqual(second.request)
    expect(counts(f)).toEqual({ requests: { n: 3 }, issues: { n: 3 }, mappings: { n: 3 } })
  } finally { f.close() }
})

test("an immutable mapping rejects conflicting content and preserves the original slot", async () => {
  const f = fixture()
  try {
    const source = await seed(f), prepared = f.learning.evaluator.prepare(actor, source.batch, method(), null), before = mapped(f)
    expect(() => f.learning.automatic.history.prepareEvaluatorRequest(prepared.batch_id, actor.session_id, method(), actor,
      () => ({ ...prepared.request, target_agent: "unrelated-agent" }))).toThrow("immutable slot conflict")
    expect(mapped(f)).toEqual(before)
    expect(f.learning.evaluator.read(actor.session_id, prepared.batch_id)).toEqual(prepared)
  } finally { f.close() }
})

test("an uncertain consumed canonical issue never becomes a new permit on preparation replay", async () => {
  const f = fixture()
  try {
    const source = await seed(f), prepared = f.learning.evaluator.prepare(actor, source.batch, method(), null)
    const intent = { request_id: prepared.request_id, kind: "initial" as const }
    const claim = f.store.reviews.claimIssue(actor, intent, "host-owner-before-crash")
    expect(claim.status).toBe("claimed-now")
    const reopened = new Learning(f.derived, new Store(f.action), f.action)
    const again = reopened.evaluator.prepare(actor, source.batch, method(), null)
    expect(again.issue?.attempt).toEqual(claim.attempt)
    expect(again.issue?.attempt.native_outcome).toBe("unknown")
    expect(f.store.reviews.claimIssue(actor, intent, "reclaimer").status).toBe("existing-state")
    expect(counts(f)).toEqual({ requests: { n: 1 }, issues: { n: 1 }, mappings: { n: 1 } })
    expect(again.interpretation).toBeNull()
  } finally { f.close() }
})

test.each(["delete", "change"] as const)("%s of an original withholds preparation, pages and replay", async damage => {
  const f = fixture()
  try {
    const source = await seed(f), prepared = f.learning.evaluator.prepare(actor, source.batch, method(), null)
    const before = counts(f)
    const page = f.learning.evaluator.members(actor.session_id, prepared.batch_id, prepared.request_id, prepared.manifest_sha256)
    const member = page.items.find(item => item.source_refs.some(ref => ref.id === source.original.id))
    if (!member) throw new Error("Original source was not in the preparation")
    const index = member.source_refs.findIndex(ref => ref.id === source.original.id)
    expect(f.learning.evaluator.source(actor.session_id, prepared.batch_id, prepared.request_id, prepared.manifest_sha256, member.key, index).value.id).toBe(source.original.id)
    if (damage === "delete") f.action.query("DELETE FROM ledger WHERE id=?").run(source.original.id)
    else f.action.query("UPDATE ledger SET data=json_set(data,'$.data.statement','altered original') WHERE id=?").run(source.original.id)
    expect(() => f.learning.evaluator.read(actor.session_id, prepared.batch_id)).toThrow("unavailable")
    expect(() => f.learning.evaluator.members(actor.session_id, prepared.batch_id, prepared.request_id, prepared.manifest_sha256)).toThrow("unavailable")
    expect(() => f.learning.evaluator.source(actor.session_id, prepared.batch_id, prepared.request_id, prepared.manifest_sha256, member.key, index)).toThrow("unavailable")
    expect(() => f.learning.evaluator.prepare(actor, source.batch, method(), null)).toThrow("unavailable")
    expect(counts(f)).toEqual(before)
    expect(f.learning.automatic.history.report(source.batch, actor.session_id)).toMatchObject({ availability: "source-unavailable", body: null })
  } finally { f.close() }
})

test("foreign owners, namespaces, optional sources and wrong page identities cannot disclose preparation", async () => {
  const f = fixture()
  try {
    const source = await seed(f), prepared = f.learning.evaluator.prepare(actor, source.batch, method(), null)
    expect(() => f.learning.evaluator.prepare({ session_id: "foreign", agent: "evaluator" }, source.batch, method(), null)).toThrow("unavailable")
    expect(() => f.learning.evaluator.read("foreign", prepared.batch_id)).toThrow("unavailable")
    expect(() => f.learning.evaluator.members("foreign", prepared.batch_id, prepared.request_id, prepared.manifest_sha256)).toThrow("unavailable")
    expect(() => f.learning.evaluator.members(actor.session_id, prepared.batch_id, "other-request", prepared.manifest_sha256)).toThrow("identity mismatch")
    expect(() => f.learning.evaluator.members(actor.session_id, prepared.batch_id, prepared.request_id, "c".repeat(64))).toThrow("identity mismatch")
    const population = f.learning.automatic.history.preparationPopulation(source.batch, actor.session_id)
    for (const patch of [
      { source_store_id: "foreign-namespace", members: population.members },
      { source_store_id: population.batch.source_store_id, members: population.members.map(member => ({ ...member,
        source_refs: member.source_refs.map(ref => ({ ...ref, required: false })) })) },
    ]) {
      const wrong = f.learning.automatic.history.freeze({ owner_session: actor.session_id, scope_key: "permitted-session-evidence",
        method: DESCRIPTIVE_METHOD, boundary: population.batch.boundary, ...patch })
      expect(() => f.learning.evaluator.prepare(actor, wrong.id, method(), null)).toThrow("unavailable")
    }
    expect(counts(f)).toEqual({ requests: { n: 1 }, issues: { n: 1 }, mappings: { n: 1 } })
  } finally { f.close() }
})

test("foreign linked originals remain uninspected metadata in the authorized source view", async () => {
  const f = fixture()
  try {
    const other = { session_id: "foreign", agent: "coder" }
    const secret = f.store.record(other, undefined, { kind: "result", statement: "FORBIDDEN ORIGINAL SENTINEL" })
    f.learning.objectives.create(actor, f.learning.objectives.ledgerSource(secret.id), "Declared continuation", "one-goal")
    const source = await sourceBatch(f), prepared = f.learning.evaluator.prepare(actor, source, method(), null)
    const page = f.learning.evaluator.members(actor.session_id, prepared.batch_id, prepared.request_id, prepared.manifest_sha256)
    expect(page.items.flatMap(member => member.source_refs).some(ref => ref.kind === "ledger-record" && ref.id === secret.id)).toBe(false)
    expect(canonical({ prepared, page })).not.toContain("FORBIDDEN ORIGINAL SENTINEL")
    expect(prepared.qualifications).toContain("foreign-linked-content-not-inspected")
    expect(prepared.request.originating_request_independence).toBe("unknown")
  } finally { f.close() }
})

test("501 authored anchors stay complete across bounded pages behind one manifest review member", async () => {
  const f = fixture()
  try {
    const original = f.store.record(actor, undefined, { kind: "result", statement: "One original request with many authored units" })
    const source = f.learning.objectives.ledgerSource(original.id), objectiveIDs: string[] = []
    for (let i = 0; i < 501; i++) objectiveIDs.push(f.learning.objectives.create(actor, source, "Work unit " + i, "unit-" + i).id)
    const batch = await sourceBatch(f), prepared = f.learning.evaluator.prepare(actor, batch, method(), null)
    expect(prepared.manifest.member_count).toBe(502)
    expect(prepared.request.review_request.members).toHaveLength(1)
    expect(prepared.request.review_request.members[0]?.producing_attempt_refs).toEqual([])
    const members = [], seen = new Set<number>()
    let after = 0
    for (;;) {
      const page = f.learning.evaluator.members(actor.session_id, prepared.batch_id, prepared.request_id, prepared.manifest_sha256, after, 17)
      expect(page.items.length).toBeGreaterThan(0)
      expect(page.items.length).toBeLessThanOrEqual(17)
      for (const item of page.items) { expect(seen.has(item.ordinal)).toBe(false); seen.add(item.ordinal); members.push(item) }
      if (page.next_after === null) break
      expect(page.next_after).toBeGreaterThan(after)
      after = page.next_after
    }
    expect(members).toHaveLength(502)
    expect([...new Set(members.flatMap(member => member.source_refs).filter(ref => ref.kind === "objective").map(ref => ref.id))].sort()).toEqual(objectiveIDs.sort())
    expect(new Set(members.flatMap(member => member.source_refs).filter(ref => ref.kind === "ledger-record").map(ref => ref.id))).toEqual(new Set([original.id]))
    expect(prepared.request.originating_request_independence).toBe("unknown")
    expect(prepared.interpretation).toBeNull()
  } finally { f.close() }
}, 30000)

for (const boundary of ["mapping", "review"] as const) test(`failed write after ${boundary} recovers the same mapping and original actor`, async () => {
  const f = fixture()
  try {
    const source = await seed(f), table = boundary === "mapping" ? "review_requests" : "review_issue_intents"
    f.action.exec(`CREATE TRIGGER stop_preparation BEFORE INSERT ON ${table} BEGIN SELECT RAISE(ABORT,'injected preparation write failure'); END`)
    expect(() => f.learning.evaluator.prepare(actor, source.batch, method(), null)).toThrow("injected preparation write failure")
    const saved = mapped(f)
    expect(f.learning.evaluator.read(actor.session_id, saved.batch_id)).toMatchObject({ state: "incomplete", request_id: saved.request_id })
    expect(counts(f)).toEqual({ requests: { n: boundary === "mapping" ? 0 : 1 }, issues: { n: 0 }, mappings: { n: 1 } })
    f.action.exec("DROP TRIGGER stop_preparation")
    const resumed = new Learning(f.derived, new Store(f.action), f.action).evaluator.prepare({ ...actor, agent: "recovery-agent" }, source.batch, method(), null)
    expect(resumed.request_id).toBe(saved.request_id)
    expect(resumed.request.review_request.requester).toEqual(actor)
    expect(mapped(f)).toEqual(saved)
    expect(counts(f)).toEqual({ requests: { n: 1 }, issues: { n: 1 }, mappings: { n: 1 } })
  } finally { f.close() }
})

test("a lost mapping COMMIT acknowledgement recovers the committed identity without another allocation", async () => {
  let armed = false, lose = true
  const f = fixture(undefined, db => ({
    prepare(sql) {
      const statement = db.prepare(sql)
      if (!sql.startsWith("INSERT INTO learning_evaluator_requests")) return statement
      return { get: (...args) => statement.get(...args), all: (...args) => statement.all(...args),
        run(...args) { const result = statement.run(...args); armed = true; return result } }
    },
    exec(sql) {
      const result = db.exec(sql)
      if (sql === "COMMIT" && armed && lose) { lose = false; throw new Error("mapping acknowledgement lost") }
      return result
    },
  }))
  try {
    const source = await seed(f)
    expect(() => f.learning.evaluator.prepare(actor, source.batch, method(), null)).toThrow("mapping acknowledgement lost")
    const saved = mapped(f)
    const resumed = new Learning(f.derived, new Store(f.action), f.action).evaluator.prepare(actor, source.batch, method(), null)
    expect(resumed.request_id).toBe(saved.request_id)
    expect(mapped(f)).toEqual(saved)
    expect(counts(f)).toEqual({ requests: { n: 1 }, issues: { n: 1 }, mappings: { n: 1 } })
  } finally { f.close() }
})

test("damaged optional preparation schema blocks recovery while Stage 3 remains readable", async () => {
  const f = fixture()
  try {
    const source = await seed(f), prepared = f.learning.evaluator.prepare(actor, source.batch, method(), null)
    const report = f.learning.automatic.history.report(source.batch, actor.session_id)
    f.derived.exec("DROP TABLE learning_evaluator_requests")
    const reopened = new Learning(f.derived, new Store(f.action), f.action)
    expect(() => reopened.evaluator.read(actor.session_id, prepared.batch_id)).toThrow("schema is incomplete")
    expect(() => reopened.evaluator.prepare(actor, source.batch, method(), null)).toThrow("schema is incomplete")
    expect(reopened.automatic.history.report(source.batch, actor.session_id)).toEqual(report)
    expect(f.action.query("SELECT COUNT(*) AS n FROM review_issue_intents").get()).toEqual({ n: 1 })
  } finally { f.close() }
})

for (const loss of ["mapping-row", "entire-extension"] as const) test(`lost committed ${loss} cannot allocate replacement preparation identity`, async () => {
  const f = fixture()
  try {
    const source = await seed(f), prepared = f.learning.evaluator.prepare(actor, source.batch, method(), null)
    const requests = f.action.query("SELECT * FROM review_requests").all(), issues = f.action.query("SELECT * FROM review_issue_intents").all()
    if (loss === "mapping-row") f.derived.query("DELETE FROM learning_evaluator_requests WHERE batch_id=?").run(prepared.batch_id)
    else f.derived.exec("DROP TABLE learning_evaluator_requests; DROP TABLE learning_evaluator_methods; DROP TABLE learning_evaluator_schema")
    const schema = f.derived.query("SELECT name,sql FROM sqlite_schema WHERE type='table' AND name GLOB 'learning_evaluator_*' ORDER BY name").all()
    const reopened = new Learning(f.derived, new Store(f.action), f.action)
    expect(() => reopened.evaluator.prepare(actor, source.batch, method(), null)).toThrow()
    expect(() => reopened.evaluator.read(actor.session_id, prepared.batch_id)).toThrow()
    expect(f.action.query("SELECT * FROM review_requests").all()).toEqual(requests)
    expect(f.action.query("SELECT * FROM review_issue_intents").all()).toEqual(issues)
    expect(f.derived.query("SELECT name,sql FROM sqlite_schema WHERE type='table' AND name GLOB 'learning_evaluator_*' ORDER BY name").all()).toEqual(schema)
    expect(reopened.automatic.history.report(source.batch, actor.session_id)?.availability).toBe("available")
    f.store.record(actor, undefined, { kind: "result", statement: "New ordinary engineering evidence after restore gap" })
    const newSource = await sourceBatch(f)
    expect(newSource).not.toBe(source.batch)
    expect(reopened.automatic.history.report(newSource, actor.session_id)?.availability).toBe("available")
  } finally { f.close() }
})

test("lost committed mapping after acknowledgement loss blocks replacement even before any review write", async () => {
  let armed = false, lose = true
  const f = fixture(undefined, db => ({
    prepare(sql) {
      const statement = db.prepare(sql)
      if (!sql.startsWith("INSERT INTO learning_evaluator_requests")) return statement
      return { get: (...args) => statement.get(...args), all: (...args) => statement.all(...args),
        run(...args) { const result = statement.run(...args); armed = true; return result } }
    },
    exec(sql) {
      const result = db.exec(sql)
      if (sql === "COMMIT" && armed && lose) { lose = false; throw new Error("mapping acknowledgement lost") }
      return result
    },
  }))
  try {
    const source = await seed(f)
    expect(() => f.learning.evaluator.prepare(actor, source.batch, method(), null)).toThrow("mapping acknowledgement lost")
    const prior = mapped(f)
    expect(f.action.query("SELECT COUNT(*) AS n FROM review_requests").get()).toEqual({ n: 0 })
    f.derived.query("DELETE FROM learning_evaluator_requests WHERE batch_id=?").run(prior.batch_id)
    const reopened = new Learning(f.derived, new Store(f.action), f.action)
    expect(() => reopened.evaluator.prepare(actor, source.batch, method(), null)).toThrow()
    expect(counts(f)).toEqual({ requests: { n: 0 }, issues: { n: 0 }, mappings: { n: 0 } })
    expect(reopened.automatic.history.report(source.batch, actor.session_id)?.availability).toBe("available")
  } finally { f.close() }
})

test("a real write failure before mapping commit remains recoverable without a false restore fence", async () => {
  let reject = true
  const f = fixture(undefined, db => ({
    exec: sql => db.exec(sql),
    prepare(sql) {
      const statement = db.prepare(sql)
      if (!sql.startsWith("INSERT INTO learning_evaluator_requests")) return statement
      return { get: (...args) => statement.get(...args), all: (...args) => statement.all(...args),
        run(...args) { if (reject) { reject = false; throw new Error("mapping write rejected") } return statement.run(...args) } }
    },
  }))
  try {
    const source = await seed(f)
    expect(() => f.learning.evaluator.prepare(actor, source.batch, method(), null)).toThrow("mapping write rejected")
    expect(f.action.query("SELECT COUNT(*) AS n FROM review_requests").get()).toEqual({ n: 0 })
    const resumed = new Learning(f.derived, new Store(f.action), f.action).evaluator.prepare(actor, source.batch, method(), null)
    expect(resumed.state).toBe("prepared")
    expect(counts(f)).toEqual({ requests: { n: 1 }, issues: { n: 1 }, mappings: { n: 1 } })
  } finally { f.close() }
})

test("restoring an actual pre-mapping learning snapshot preserves the later consumed issue and historical requester", async () => {
  const root = mkdtempSync(join(tmpdir(), "loom-evaluator-stale-restore-")), snapshot = join(root, "pre-mapping.sqlite")
  let capture = false, captured = false
  let f = fixture(root, db => ({
    prepare(sql) {
      const statement = db.prepare(sql)
      if (!sql.startsWith("INSERT INTO learning_evaluation_batches(")) return statement
      return { get: (...args) => statement.get(...args), all: (...args) => statement.all(...args),
        run(...args) {
          const result = statement.run(...args)
          if (args.includes("evaluator-preparation/calling-session")) capture = true
          return result
        } }
    },
    exec(sql) {
      const result = db.exec(sql)
      if (sql === "COMMIT" && capture && !captured) {
        // The freeze is durable and its transaction has ended; the mapping has
        // not started. Capture a real SQLite snapshot at that exact boundary.
        db.query("VACUUM INTO ?").run(snapshot)
        captured = true
      }
      return result
    },
  }))
  try {
    const source = await seed(f), prepared = f.learning.evaluator.prepare(actor, source.batch, method(), null)
    expect(captured).toBe(true)
    const frozen = new Database(snapshot, { readonly: true })
    try {
      expect(frozen.query("SELECT id,state,blocked_reason FROM learning_evaluation_batches WHERE id=?").get(prepared.batch_id))
        .toEqual({ id: prepared.batch_id, state: "pending", blocked_reason: null })
      expect(frozen.query("SELECT name FROM sqlite_schema WHERE type='table' AND name GLOB 'learning_evaluator_*'").all()).toEqual([])
    } finally { frozen.close(true) }
    const claim = f.store.reviews.claimIssue(actor, { request_id: prepared.request_id, kind: "initial" }, "issuer-before-rollback")
    expect(claim.status).toBe("claimed-now")
    const originalRequests = f.action.query("SELECT * FROM review_requests").all(), originalIssues = f.action.query("SELECT * FROM review_issue_intents").all()
    f.close()
    rmSync(join(root, "learning.sqlite-wal"), { force: true })
    rmSync(join(root, "learning.sqlite-shm"), { force: true })
    copyFileSync(snapshot, join(root, "learning.sqlite"))
    f = fixture(root)
    expect(() => f.learning.evaluator.read(actor.session_id, prepared.batch_id)).toThrow("unavailable")
    const resumed = f.learning.evaluator.prepare({ ...actor, agent: "different-agent-after-restore" }, source.batch, method(), null)
    expect(resumed.batch_id).toBe(prepared.batch_id)
    expect(resumed.request_id).toBe(prepared.request_id)
    expect(resumed.manifest_sha256).toBe(prepared.manifest_sha256)
    expect(resumed.request).toEqual(prepared.request)
    expect(resumed.request.review_request.requester).toEqual(actor)
    expect(resumed.issue?.attempt).toEqual(claim.attempt)
    expect(resumed.issue?.attempt.native_outcome).toBe("unknown")
    expect(f.action.query("SELECT * FROM review_requests").all()).toEqual(originalRequests)
    expect(f.action.query("SELECT * FROM review_issue_intents").all()).toEqual(originalIssues)
    expect(counts(f)).toEqual({ requests: { n: 1 }, issues: { n: 1 }, mappings: { n: 1 } })
    expect(resumed.interpretation).toBeNull()
  } finally { try { f.close() } catch {} rmSync(root, { recursive: true, force: true }) }
})

test("preparation source reads preserve security R1 over A and partial correction R2 over B without promoting their scope", async () => {
  const f = fixture()
  try {
    const action = f.store.create("Security repair", "Preserve exact original review scope", actor)
    const planA = f.store.savePlan(action.id, 0, [
      { id: "auth", kind: "task", title: "Original authentication" }, { id: "storage", kind: "task", title: "Original storage" },
    ], actor)
    const member = (id: string, plan: typeof planA, artifact: string, prior: string | null) => ({
      member_id: id, work_ref: workReference(action, plan, id), producing_attempt_refs: [], prior_review_request_id: prior,
      artifact_refs: [{ locator: "fixture://" + artifact, version: { kind: "sha256" as const, value: digest(artifact) }, content_ref: null }],
      membership_source_refs: ["request:security-repair"], gaps: [],
    })
    const first = { format: "loom-review-request/v1", request_id: "security-R1-A",
      mandate: { question: "  Review artifact A for security only.  ", dimensions: ["security"],
        criteria: [{ text: "Authentication and storage preserve access restrictions", source_ref: "requirement:security" }], mode: "initial-review",
        inclusions: ["authentication A", "storage A"], exclusions: ["performance", "general functional acceptance"] },
      intended_recipient: { agent: "reviewer", session_id: null }, work_revision_policy: "frozen-historical",
      members: [member("auth", planA, "artifact-A", null), member("storage", planA, "artifact-A", null)], rechecks: [] }
    expect(f.store.reviews.freeze(actor, first).status).toBe("created")
    const fail = f.store.record({ ...actor, agent: "security-reviewer" }, undefined, { kind: "qa", verdict: "fail", statement: "Authentication in A violates the named security criterion" })
    const finding = f.store.reviews.relate(actor, first.request_id, { relationship: "finding", source_record_id: fail.id, member_ids: ["auth"] })
    const planB = f.store.savePlan(action.id, 1, planA.nodes.map(node => ({ ...node, title: "Corrected B " + node.title })), actor)
    const second = { format: "loom-review-request/v1", request_id: "security-R2-partial-B",
      mandate: { question: "Recheck only the authentication correction in B", dimensions: ["security correction"],
        criteria: [{ text: "Previously reported authentication finding is resolved", source_ref: finding.id }], mode: "partial-re-review",
        inclusions: ["authentication correction B"], exclusions: ["storage B", "other findings", "whole-objective acceptance"] },
      intended_recipient: { agent: "reviewer", session_id: null }, work_revision_policy: "frozen-historical",
      members: [member("auth", planB, "artifact-B", first.request_id)], rechecks: [{ request_id: first.request_id, finding_ids: [finding.id] }] }
    expect(f.store.reviews.freeze(actor, second).status).toBe("created")
    const pass = f.store.record({ ...actor, agent: "partial-reviewer" }, undefined, { kind: "qa", verdict: "pass", statement: "Only the selected authentication correction in B was checked" })
    const recheck = f.store.reviews.relate(actor, second.request_id, { relationship: "finding", source_record_id: pass.id, member_ids: ["auth"] })
    const source = await sourceBatch(f), prepared = f.learning.evaluator.prepare(actor, source, method(), null)
    const page = f.learning.evaluator.members(actor.session_id, prepared.batch_id, prepared.request_id, prepared.manifest_sha256)
    const returned = new Map<string, Record<string, unknown>>()
    for (const item of page.items) for (let index = 0; index < item.source_refs.length; index++) {
      const ref = item.source_refs[index]!
      if (ref.kind !== "review-request" && ref.kind !== "review-relationship") continue
      const original = f.learning.evaluator.source(actor.session_id, prepared.batch_id, prepared.request_id, prepared.manifest_sha256, item.key, index)
      expect(original.native_evaluator_retrieval).toBe("not-established")
      returned.set(ref.id, original.value)
    }
    expect(returned.get(first.request_id)?.request).toEqual({ ...first, requester: actor })
    expect(returned.get(second.request_id)?.request).toEqual({ ...second, requester: actor })
    expect(returned.get(finding.id)).toMatchObject({ request_id: first.request_id, member_ids: ["auth"], declared_verdict: "fail",
      source_producer: { session_id: actor.session_id, agent: "security-reviewer" }, review_binding: { status: "unknown" } })
    expect(returned.get(recheck.id)).toMatchObject({ request_id: second.request_id, member_ids: ["auth"], declared_verdict: "pass",
      source_producer: { session_id: actor.session_id, agent: "partial-reviewer" }, review_binding: { status: "unknown" } })
    expect(prepared.interpretation).toBeNull()
    expect(prepared.E11).toBe("unqualified")
  } finally { f.close() }
})

function generatedReviewRef(f: Fixture, requestID: string) {
  const row = f.action.query("SELECT rowid AS sequence FROM review_requests WHERE request_id=?").get(requestID) as { sequence: number } | null
  if (!row) throw new Error("Generated review was not durably frozen")
  const value = f.store.reviews.evaluationSource(actor, requestID)
  return { kind: "review-request", id: requestID, session_id: actor.session_id, revision: String(row.sequence), sha256: digest(value), required: true }
}

test("generated preparation reviews cannot launder a withheld original through later Stage 3 source reads", async () => {
  const f = fixture()
  try {
    const original = f.store.record(actor, undefined, { kind: "result", statement: "Original A with restricted later availability" })
    const firstSource = await sourceBatch(f), firstMethod = method()
    firstMethod.audit_skill.definition.locator = "fixture://PRIVATE-METHOD-LOCATOR-A"
    const first = f.learning.evaluator.prepare(actor, firstSource, firstMethod, null), generated = generatedReviewRef(f, first.request_id)
    f.action.query("DELETE FROM ledger WHERE id=?").run(original.id)
    expect(() => f.learning.evaluator.read(actor.session_id, first.batch_id)).toThrow("unavailable")
    const ordinary = f.store.record(actor, undefined, { kind: "result", statement: "Independent later ordinary engineering evidence" })
    const later = await sourceBatch(f), second = f.learning.evaluator.prepare(actor, later, method(), null)
    const page = f.learning.evaluator.members(actor.session_id, second.batch_id, second.request_id, second.manifest_sha256)
    const sources = page.items.flatMap(member => member.source_refs.map((_, index) =>
      f.learning.evaluator.source(actor.session_id, second.batch_id, second.request_id, second.manifest_sha256, member.key, index)))
    expect(sources.some(item => item.source.id === ordinary.id)).toBe(true)
    expect(JSON.stringify(sources)).not.toContain(first.request_id)
    expect(JSON.stringify(sources)).not.toContain(first.manifest_sha256)
    expect(JSON.stringify(sources)).not.toContain("PRIVATE-METHOD-LOCATOR-A")
    expect(f.learning.automatic.sources.resolve(generated, f.store.reviews.storeID)).toBeNull()
    expect(f.learning.automatic.sources.snapshot(actor.session_id).members.flatMap(member => member.source_refs).some(ref =>
      ref.kind === "review-request" && [first.request_id, second.request_id].includes(ref.id))).toBe(false)
  } finally { f.close() }
})

test("generated preparation alone never becomes a new engineering source population", async () => {
  const f = fixture()
  try {
    const original = f.store.record(actor, undefined, { kind: "result", statement: "Only original engineering source" })
    const source = await sourceBatch(f), prepared = f.learning.evaluator.prepare(actor, source, method(), null)
    const generated = generatedReviewRef(f, prepared.request_id)
    f.action.query("DELETE FROM ledger WHERE id=?").run(original.id)
    expect(f.learning.automatic.sources.snapshot(actor.session_id).members).toEqual([])
    expect(f.learning.automatic.sources.resolve(generated, f.store.reviews.storeID)).toBeNull()
    expect(f.learning.automatic.sources.sessions()).not.toContain(actor.session_id)
    expect(await f.learning.automatic.run(actor.session_id, async () => {}, new AbortController().signal)).toEqual({ state: "empty" })
    expect(counts(f)).toEqual({ requests: { n: 1 }, issues: { n: 1 }, mappings: { n: 1 } })
  } finally { f.close() }
})

test("public review freezing cannot forge the reserved preparation classification", async () => {
  const f = fixture()
  try {
    const source = await seed(f), prepared = f.learning.evaluator.prepare(actor, source.batch, method(), null)
    const { requester: _requester, ...request } = prepared.request.review_request
    expect(() => f.store.reviews.freeze(actor, { ...request, request_id: "forged-preparation-marker" })).toThrow()
    expect(counts(f)).toEqual({ requests: { n: 1 }, issues: { n: 1 }, mappings: { n: 1 } })
  } finally { f.close() }
})

test("two actual processes share one preparation request and canonical initial issue", async () => {
  const root = mkdtempSync(join(tmpdir(), "loom-evaluator-race-")), f = fixture(root)
  const children: ReturnType<typeof Bun.spawn>[] = []
  try {
    const source = await seed(f), gate = join(root, "gate")
    const script = `import {Database} from 'bun:sqlite'; import {Store} from ${JSON.stringify(new URL("../src/store.ts", import.meta.url).pathname)};
      import {Learning} from ${JSON.stringify(new URL("../src/learning.ts", import.meta.url).pathname)}; import {writeFileSync,existsSync} from 'node:fs';
      const action=new Database(process.env.PREP_ACTION),db=new Database(process.env.PREP_LEARNING),store=new Store(action),learning=new Learning(db,store,action);
      writeFileSync(process.env.PREP_READY,'ready'); const deadline=Date.now()+10000;
      while(!existsSync(process.env.PREP_GATE)){if(Date.now()>deadline)throw new Error('barrier expired');await Bun.sleep(2)}
      try{const p=learning.evaluator.prepare({session_id:'owner',agent:process.env.PREP_AGENT},process.env.PREP_BATCH,JSON.parse(process.env.PREP_METHOD),null);
      console.log(JSON.stringify({batch_id:p.batch_id,request_id:p.request_id,manifest_sha256:p.manifest_sha256,attempt_id:p.issue.attempt.attempt_id,requester:p.request.review_request.requester}));}
      finally{db.close();action.close()}`
    for (let i = 0; i < 2; i++) children.push(Bun.spawn([process.execPath, "--eval", script], { env: { ...process.env,
      PREP_ACTION: join(root, "ledger.sqlite"), PREP_LEARNING: join(root, "learning.sqlite"), PREP_READY: join(root, "ready-" + i),
      PREP_GATE: gate, PREP_BATCH: source.batch, PREP_METHOD: JSON.stringify(method()), PREP_AGENT: "coordinator-" + i }, stdout: "pipe", stderr: "pipe" }))
    const deadline = Date.now() + 10000
    while (![0, 1].every(i => existsSync(join(root, "ready-" + i)))) {
      if (Date.now() > deadline) throw new Error("Preparation processes did not reach the barrier")
      await Bun.sleep(5)
    }
    writeFileSync(gate, "release")
    const results = await Promise.all(children.map(async child => {
      if (!child.stdout || !child.stderr || typeof child.stdout === "number" || typeof child.stderr === "number") throw new Error("Missing worker pipes")
      const [code, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()])
      expect(stderr).toBe(""); expect(code).toBe(0)
      return JSON.parse(stdout) as Record<string, unknown>
    }))
    expect(results[0]).toEqual(results[1])
    expect(counts(f)).toEqual({ requests: { n: 1 }, issues: { n: 1 }, mappings: { n: 1 } })
  } finally { for (const child of children) child.kill(); f.close(); rmSync(root, { recursive: true, force: true }) }
}, 15000)

for (const boundary of ["mapping", "review", "issue"] as const) test(`SIGKILL after durable ${boundary} commit resumes the same preparation`, async () => {
  const root = mkdtempSync(join(tmpdir(), "loom-evaluator-kill-"))
  let f = fixture(root)
  try {
    const source = await seed(f)
    f.close()
    const script = `import {Database} from 'bun:sqlite'; import {writeSync} from 'node:fs';
      import {Store} from ${JSON.stringify(new URL("../src/store.ts", import.meta.url).pathname)};
      import {Learning} from ${JSON.stringify(new URL("../src/learning.ts", import.meta.url).pathname)};
      let armed=false;function wrap(db,needle){return {prepare(sql){const s=db.prepare(sql);if(!sql.startsWith(needle))return s;
        return {get:(...args)=>s.get(...args),all:(...args)=>s.all(...args),run(...args){const r=s.run(...args);armed=true;return r}}},
        exec(sql){const r=db.exec(sql);if(sql==='COMMIT'&&armed){writeSync(1,'durable-${boundary}\\n');process.kill(process.pid,'SIGKILL')}return r}}}
      const action=new Database(${JSON.stringify(join(root, "ledger.sqlite"))}),db=new Database(${JSON.stringify(join(root, "learning.sqlite"))});
      action.exec('PRAGMA wal_autocheckpoint=0');db.exec('PRAGMA wal_autocheckpoint=0');
      const actionSQL=wrap(action,${JSON.stringify(boundary === "review" ? "INSERT INTO review_requests(" : boundary === "issue" ? "INSERT INTO review_issue_intents(" : "never-match")});
      const learningSQL=wrap(db,${JSON.stringify(boundary === "mapping" ? "INSERT INTO learning_evaluator_requests" : "never-match")});
      const store=new Store(actionSQL),learning=new Learning(learningSQL,store,action);
      learning.evaluator.prepare(${JSON.stringify(actor)},${JSON.stringify(source.batch)},${JSON.stringify(method())},null);
      throw new Error('crash boundary was not reached');`
    const child = Bun.spawnSync([process.execPath, "--eval", script])
    expect(child.signalCode).toBe("SIGKILL")
    expect(child.stderr.toString()).toBe("")
    expect(child.stdout.toString().trim()).toBe("durable-" + boundary)
    expect(readFileSync(join(root, "learning.sqlite-wal")).length).toBeGreaterThan(32)
    f = fixture(root)
    const saved = mapped(f), partial = f.learning.evaluator.read(actor.session_id, saved.batch_id)
    expect(partial.state).toBe(boundary === "issue" ? "prepared" : "incomplete")
    expect(counts(f)).toEqual({ requests: { n: boundary === "mapping" ? 0 : 1 }, issues: { n: boundary === "issue" ? 1 : 0 }, mappings: { n: 1 } })
    const resumed = f.learning.evaluator.prepare({ ...actor, agent: "after-restart" }, source.batch, method(), null)
    expect(resumed.request_id).toBe(saved.request_id)
    expect(resumed.request.review_request.requester).toEqual(actor)
    expect(resumed.interpretation).toBeNull()
    expect(resumed.issue?.attempt).toMatchObject({ state: "prepared", claimant_id: null, native_outcome: "not-issued" })
    expect(mapped(f)).toEqual(saved)
    expect(counts(f)).toEqual({ requests: { n: 1 }, issues: { n: 1 }, mappings: { n: 1 } })
  } finally { try { f.close() } catch {} rmSync(root, { recursive: true, force: true }) }
})
