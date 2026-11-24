import { Database } from "bun:sqlite"
import { mkdirSync } from "node:fs"
import { join } from "node:path"
import { Learning } from "../../src/learning.js"
import { Store } from "../../src/store.js"
import { canonical, digest, type Actor } from "../../src/model.js"
import type { EvaluatorMethodManifest, EvaluatorPolicyRef } from "../../src/evaluator-method.js"
import { parseEvaluatorAdmission, parseEvaluatorGrant, parseEvaluatorReceipt,
  type EvaluatorExecutionAdmission, type EvaluatorExecutionAuthority, type EvaluatorExecutionGrant,
  type EvaluatorExecutionReceipt, type EvaluatorExecutionSnapshot, type EvaluatorExecutionSubject, type EvaluatorResources } from "../../src/evaluator-execution-contract.js"

export const ACTOR = { session_id: "fixture-owner", agent: "general" }
export const NOW = Date.parse("2026-11-25T01:00:00.000Z")
export const POLICY: EvaluatorPolicyRef = { id: "fixture-budget", revision: "1", sha256: digest("explicit synthetic test allowance") }
export const freshSignal = () => new AbortController().signal
export function method(): EvaluatorMethodManifest {
  const ref = (name: string) => ({ locator: "fixture://" + name, sha256: digest("synthetic " + name) })
  const policy = (name: string) => ({ id: "fixture-" + name, revision: "1", sha256: digest(name) })
  return { format: "loom-evaluator-method/v1", evaluator: { agent: "evaluator", definition: ref("evaluator") },
    audit_skill: { skill: "agent-run-audit", definition: ref("audit") }, rubric: ref("rubric"), instruction_bundle: ref("instructions"),
    result_format: "loom-evaluator-interpretation/v1", model: { provider_id: "fixture-only", model_id: "scripted", settings: ref("settings") },
    adapter: { id: "synthetic-consumer-test", version: "1", profile: policy("profile") }, source_policy: policy("source"), route_policy: policy("route") }
}
export function openState(path: string) {
  mkdirSync(path, { recursive: true })
  const ledger = new Database(join(path, "ledger.sqlite")), derived = new Database(join(path, "learning.sqlite"))
  const store = new Store(ledger), learning = new Learning(derived, store, ledger)
  let closed = false
  return { path, ledger, derived, store, learning, close() {
    if (closed) return
    derived.close(true); ledger.close(true); closed = true
  } }
}
export type FixtureState = ReturnType<typeof openState>
export type PreparedFixture = ReturnType<FixtureState["learning"]["evaluator"]["prepare"]>
export async function prepareFixture(state: FixtureState, actor: Actor = ACTOR, text = "Actual synthetic engineering source") {
  const original = state.store.record(actor, undefined, { kind: "result", statement: text })
  let batch = await state.learning.automatic.run(actor.session_id, async () => {}, freshSignal())
  for (let n = 0; batch.state === "pending" && n < 100; n++) batch = await state.learning.automatic.run(actor.session_id, async () => {}, freshSignal())
  if (batch.state !== "complete" || !batch.batch_id) throw new Error("Fixture Stage 3 did not complete")
  const prepared = state.learning.evaluator.prepare(actor, batch.batch_id, method(), POLICY)
  return { original, prepared, sourceBatch: batch.batch_id }
}
export function pins(prepared: PreparedFixture) {
  if (!prepared.issue) throw new Error("Fixture lacks canonical issue")
  return { batch_id: prepared.batch_id, request_id: prepared.request_id, manifest_sha256: prepared.manifest_sha256,
    attempt_id: prepared.issue.attempt.attempt_id }
}
export function firstSource(state: FixtureState, prepared: PreparedFixture, actor = ACTOR) {
  const page = state.learning.evaluator.members(actor.session_id, prepared.batch_id, prepared.request_id, prepared.manifest_sha256)
  if (!page.items[0]?.source_refs.length) throw new Error("Fixture lacks original source")
  return { memberKey: page.items[0].key, sourceIndex: 0 }
}

type Row = { admission: string; receipt: string; consumed: number; execute_calls: number; effect_calls: number }
type Phase = "prepared" | "reserved" | "claim" | "source" | "before-consume" | "consumed" | "result" | "cancelled"
/** Deliberately synthetic authority. This is NOT an OpenCode, account or billing
 * implementation. Real SQLite transactions test the consumer's contract under
 * separate workers and rollback of ONLY the Loom databases. The provider effect
 * is a durable fixture counter; installed-native evidence is a separate suite. */
export class FixtureExecutionAuthority implements EvaluatorExecutionAuthority {
  readonly db: Database
  readonly qualification = "synthetic-consumer-contract-only"
  phase: (phase: Phase, admission?: EvaluatorExecutionAdmission) => Promise<void> = async () => {}
  source: { memberKey: string; sourceIndex: number } | undefined
  clock: () => number = () => NOW
  constructor(readonly path: string, capacity = 10) {
    this.db = new Database(path)
    this.db.exec(`PRAGMA busy_timeout=5000; PRAGMA journal_mode=WAL;
      CREATE TABLE IF NOT EXISTS fixture_policy(singleton INTEGER PRIMARY KEY, capacity INTEGER NOT NULL,
        input_capacity INTEGER NOT NULL, output_capacity INTEGER NOT NULL, active INTEGER NOT NULL,
        account_id TEXT NOT NULL, credential_revision TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS fixture_grants(semantic_key TEXT PRIMARY KEY, data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS fixture_enrollments(semantic_key TEXT PRIMARY KEY, admission TEXT NOT NULL, receipt TEXT NOT NULL,
        consumed INTEGER NOT NULL DEFAULT 0, execute_calls INTEGER NOT NULL DEFAULT 0, effect_calls INTEGER NOT NULL DEFAULT 0);
      CREATE TABLE IF NOT EXISTS fixture_results(result_id TEXT PRIMARY KEY, content TEXT NOT NULL);`)
    this.db.query("INSERT OR IGNORE INTO fixture_policy VALUES(1,?,?,?,1,'fixture-account','fixture-credential-1')").run(capacity, capacity * 10, capacity * 10)
  }
  close() { this.db.close(true) }
  private atomic<T>(run: () => T): T {
    this.db.exec("BEGIN IMMEDIATE")
    try { const result = run(); this.db.exec("COMMIT"); return result }
    catch (error) { try { this.db.exec("ROLLBACK") } catch {} throw error }
  }
  private policy() {
    return this.db.query("SELECT * FROM fixture_policy WHERE singleton=1").get() as {
      capacity: number; input_capacity: number; output_capacity: number; active: number; account_id: string; credential_revision: string;
    }
  }
  revoke() { this.db.query("UPDATE fixture_policy SET active=0 WHERE singleton=1").run() }
  changeAccount() { this.db.query("UPDATE fixture_policy SET credential_revision='changed' WHERE singleton=1").run() }
  capacity(limits: EvaluatorResources) {
    this.db.query("UPDATE fixture_policy SET capacity=?,input_capacity=?,output_capacity=? WHERE singleton=1")
      .run(limits.requests, limits.input_tokens, limits.output_tokens)
  }
  private eligible(grant: EvaluatorExecutionGrant) {
    const policy = this.policy()
    return policy.active === 1 && Date.parse(grant.expires_at) > this.clock()
      && grant.account.account_id === policy.account_id && grant.account.credential_revision === policy.credential_revision
  }
  private row(key: string): Row | undefined {
    return this.db.query("SELECT * FROM fixture_enrollments WHERE semantic_key=?").get(key) as Row | undefined
  }
  private snapshot(row: Row): EvaluatorExecutionSnapshot {
    const admission = parseEvaluatorAdmission(JSON.parse(row.admission))
    return { admission, receipt: parseEvaluatorReceipt(JSON.parse(row.receipt), admission) }
  }
  private checked(admission: EvaluatorExecutionAdmission) {
    const row = this.row(admission.grant.subject.semantic_key)
    if (!row || row.admission !== canonical(admission)) throw new Error("Fixture admission not authorized")
    return row
  }
  private receipt(admission: EvaluatorExecutionAdmission, previous: EvaluatorExecutionReceipt | null,
    state: Pick<EvaluatorExecutionReceipt, "execution" | "budget" | "fenced" | "usage" | "result">) {
    const sequence = (previous?.sequence ?? 0) + 1
    return parseEvaluatorReceipt({ format: "loom-evaluation-execution-receipt/v1", authority_id: admission.grant.authority_id,
      receipt_id: `fixture-receipt-${admission.grant.subject.semantic_key}-${sequence}`, sequence,
      admission_sha256: digest(admission), reservation_id: admission.reservation_id, ...state }, admission)
  }
  private update(admission: EvaluatorExecutionAdmission, receipt: EvaluatorExecutionReceipt) {
    this.db.query("UPDATE fixture_enrollments SET receipt=? WHERE semantic_key=?").run(canonical(receipt), admission.grant.subject.semantic_key)
  }
  async reconcile(subject: EvaluatorExecutionSubject) {
    const row = this.row(subject.semantic_key)
    if (!row) return null
    const result = this.snapshot(row)
    if (canonical(result.admission.grant.subject) !== canonical(subject)) throw new Error("Fixture restore enrollment conflict")
    return result
  }
  async prepare(subject: EvaluatorExecutionSubject, declaredMethod: EvaluatorMethodManifest, budget: EvaluatorPolicyRef) {
    if (canonical(budget) !== canonical(POLICY) || canonical(declaredMethod) !== canonical(method())) throw new Error("Fixture grant unavailable")
    const result = this.atomic(() => {
      const prior = this.db.query("SELECT data FROM fixture_grants WHERE semantic_key=?").get(subject.semantic_key) as { data: string } | undefined
      if (prior) {
        const saved = parseEvaluatorGrant(JSON.parse(prior.data))
        if (canonical(saved.subject) !== canonical(subject) || !this.eligible(saved)) throw new Error("Fixture grant conflict or revoked")
        return saved
      }
      const current = this.policy()
      const grant: EvaluatorExecutionGrant = { authority_id: "fixture-authority", grant_id: `fixture-grant-${subject.semantic_key}`,
        expires_at: new Date(NOW + 60_000).toISOString(), subject, method: declaredMethod,
        recipient: { host_id: "fixture-host", session_id: `ses_fixture_${subject.semantic_key}`, agent: "evaluator" },
        account: { provider_id: declaredMethod.model.provider_id, model_id: declaredMethod.model.model_id,
          account_id: current.account_id, credential_revision: current.credential_revision },
        source_authority_ref: "fixture-source-grant", account_authority_ref: "fixture-account-grant", budget_authority_ref: "fixture-budget-grant",
        limits: { requests: 1, input_tokens: 10, output_tokens: 10 } }
      if (!this.eligible(grant)) throw new Error("Fixture grant revoked")
      this.db.query("INSERT INTO fixture_grants VALUES(?,?)").run(subject.semantic_key, canonical(grant))
      return grant
    })
    await this.phase("prepared")
    return result
  }
  async reserve(input: EvaluatorExecutionGrant) {
    const grant = parseEvaluatorGrant(input)
    const admission = this.atomic(() => {
      const stored = this.db.query("SELECT data FROM fixture_grants WHERE semantic_key=?").get(grant.subject.semantic_key) as { data: string } | undefined
      if (!stored || stored.data !== canonical(grant) || !this.eligible(grant)) throw new Error("Fixture reservation lacks authority")
      const prior = this.row(grant.subject.semantic_key)
      if (prior) return this.snapshot(prior).admission
      const rows = this.db.query("SELECT * FROM fixture_enrollments").all() as Row[]
      const used = rows.reduce((sum, row) => {
        const { admission, receipt } = this.snapshot(row)
        const accounted = receipt.budget === "released" ? { requests: 0, input_tokens: 0, output_tokens: 0 }
          : receipt.budget === "settled" ? receipt.usage! : admission.grant.limits
        return { requests: sum.requests + accounted.requests, input_tokens: sum.input_tokens + accounted.input_tokens,
          output_tokens: sum.output_tokens + accounted.output_tokens }
      }, { requests: 0, input_tokens: 0, output_tokens: 0 })
      const policy = this.policy()
      if (used.requests + grant.limits.requests > policy.capacity || used.input_tokens + grant.limits.input_tokens > policy.input_capacity
          || used.output_tokens + grant.limits.output_tokens > policy.output_capacity) throw new Error("Fixture shared pool exhausted")
      const result: EvaluatorExecutionAdmission = { format: "loom-evaluation-admission/v1", grant,
        reservation_id: `fixture-reservation-${grant.subject.semantic_key}`, pool_id: "shared-fixture-account-pool", authority_epoch: "fixture-epoch-1" }
      const receipt = this.receipt(result, null, { execution: "reserved", budget: "held", fenced: false, usage: null, result: null })
      this.db.query("INSERT INTO fixture_enrollments(semantic_key,admission,receipt) VALUES(?,?,?)")
        .run(grant.subject.semantic_key, canonical(result), canonical(receipt))
      return result
    })
    await this.phase("reserved", admission)
    return admission
  }
  async execute(admission: EvaluatorExecutionAdmission, readSource: (memberKey: string, sourceIndex: number) => Promise<unknown>, signal: AbortSignal) {
    this.atomic(() => { this.checked(admission); this.db.query("UPDATE fixture_enrollments SET execute_calls=execute_calls+1 WHERE semantic_key=?").run(admission.grant.subject.semantic_key) })
    await this.phase("before-consume", admission)
    if (signal.aborted || !this.eligible(admission.grant)) return this.cancel(admission)
    const material = this.source ? await readSource(this.source.memberKey, this.source.sourceIndex) : { fixture: "no original selected" }
    const accepted = this.atomic(() => {
      const row = this.checked(admission), snapshot = this.snapshot(row)
      if (!this.eligible(admission.grant) || signal.aborted) return false
      if (row.consumed || snapshot.receipt.fenced || snapshot.receipt.execution !== "reserved") throw new Error("Fixture effect already consumed or fenced")
      this.db.query("UPDATE fixture_enrollments SET consumed=1,effect_calls=effect_calls+1 WHERE semantic_key=?").run(admission.grant.subject.semantic_key)
      this.update(admission, this.receipt(admission, snapshot.receipt, { execution: "unknown", budget: "uncertain", fenced: false, usage: null, result: null }))
      return true
    })
    if (!accepted) return this.cancel(admission)
    await this.phase("consumed", admission)
    const result = this.atomic(() => {
      const before = this.snapshot(this.checked(admission)).receipt
      const resultID = `msg_result_${admission.grant.subject.semantic_key}`
      const content = canonical({ fixture_only: true, original: material, outcome: "Scripted result; no Evaluator reasoning qualification" })
      this.db.query("INSERT OR IGNORE INTO fixture_results VALUES(?,?)").run(resultID, content)
      const receipt = this.receipt(admission, before, { execution: before.execution === "cancelled" ? "cancelled" : "completed",
        budget: "settled", fenced: true, usage: { requests: 1, input_tokens: 1, output_tokens: 1 },
        result: { host_id: admission.grant.recipient.host_id, session_id: admission.grant.recipient.session_id,
          input_id: `msg_input_${admission.grant.subject.semantic_key}`, result_id: resultID, sha256: digest(content) } })
      this.update(admission, receipt)
      return receipt
    })
    await this.phase("result", admission)
    return result
  }
  async validate(admission: EvaluatorExecutionAdmission, boundary: "claim" | "source") {
    this.checked(admission)
    if (!this.eligible(admission.grant)) throw new Error("Fixture authority expired, revoked or changed")
    await this.phase(boundary, admission)
    if (!this.eligible(admission.grant)) throw new Error("Fixture authority expired, revoked or changed")
  }
  async cancel(admission: EvaluatorExecutionAdmission) {
    const result = this.atomic(() => {
      const row = this.checked(admission), previous = this.snapshot(row).receipt
      if (previous.fenced) return previous
      const receipt = this.receipt(admission, previous, row.consumed
        ? { execution: "cancelled", budget: "uncertain", fenced: true, usage: null, result: previous.result }
        : { execution: "not-admitted", budget: "released", fenced: true, usage: { requests: 0, input_tokens: 0, output_tokens: 0 }, result: null })
      this.update(admission, receipt)
      return receipt
    })
    await this.phase("cancelled", admission)
    return result
  }
  counts() {
    const row = this.db.query("SELECT COUNT(*) AS reservations,COALESCE(SUM(consumed),0) AS consumed,COALESCE(SUM(execute_calls),0) AS execute_calls,COALESCE(SUM(effect_calls),0) AS effects FROM fixture_enrollments").get()
    return row as { reservations: number; consumed: number; execute_calls: number; effects: number }
  }
  all() { return (this.db.query("SELECT * FROM fixture_enrollments ORDER BY semantic_key").all() as Row[]).map(row => this.snapshot(row)) }
}
