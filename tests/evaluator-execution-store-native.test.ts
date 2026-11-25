import { expect, test } from "bun:test"
import { Database } from "bun:sqlite"
import { existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Learning } from "../src/learning.js"
import { digest } from "../src/model.js"
import { Store, type SQL } from "../src/store.js"
import type { EvaluatorMethodManifest } from "../src/evaluator-method.js"
import type { EvaluatorExecutionAdmission, EvaluatorExecutionReceipt } from "../src/evaluator-execution-contract.js"

const actor = { session_id: "execution-store-owner", agent: "general" }
function method(): EvaluatorMethodManifest {
  const ref = (locator: string) => ({ locator, sha256: "a".repeat(64) })
  const policy = (id: string) => ({ id, revision: "1", sha256: "b".repeat(64) })
  return { format: "loom-evaluator-method/v1", evaluator: { agent: "evaluator", definition: ref("fixture://evaluator") },
    audit_skill: { skill: "agent-run-audit", definition: ref("fixture://audit") }, rubric: ref("fixture://rubric"), instruction_bundle: ref("fixture://bundle"),
    result_format: "loom-evaluator-interpretation/v1", model: { provider_id: "controlled-fixture", model_id: "fixture-only", settings: ref("fixture://settings") },
    adapter: { id: "fixture-only", version: "1", profile: policy("profile") }, source_policy: policy("source"), route_policy: policy("route") }
}
function open(state: string, wrap?: (db: Database) => SQL) {
  const action = new Database(join(state, "ledger.sqlite")), derived = new Database(join(state, "learning.sqlite"))
  const store = new Store(action), learning = new Learning(wrap ? wrap(derived) : derived, store, action)
  return { action, derived, store, learning, close() { derived.close(true); action.close(true) } }
}
async function fixture(wrap?: (db: Database) => SQL) {
  const root = mkdtempSync(join(tmpdir(), "loom-execution-store-")), project = join(root, "project")
  const scope = digest({ project: "execution-store", canonical: project }), state = join(root, scope)
  mkdirSync(project); mkdirSync(state)
  const f = open(state, wrap)
  const original = f.store.record(actor, undefined, { kind: "result", statement: "Original controlled fixture evidence" })
  const source = await f.learning.automatic.run(actor.session_id, async () => {}, new AbortController().signal)
  if (source.state !== "complete" || !source.batch_id) throw new Error("Fixture source batch missing")
  const prepared = f.learning.evaluator.prepare(actor, source.batch_id, method(), { id: "fixture-budget", revision: "1", sha256: "c".repeat(64) })
  if (!prepared.issue) throw new Error("Fixture issue missing")
  // These values exercise local mirrors only. No native or account grant exists.
  const admission: EvaluatorExecutionAdmission = { format: "loom-evaluation-admission/v1", grant: {
    authority_id: "controlled-fixture", grant_id: "grant-1", expires_at: "2030-01-01T00:00:00.000Z",
    subject: { source_store_id: prepared.manifest.source_store_id, owner_session: actor.session_id, batch_id: prepared.batch_id,
      request_id: prepared.request_id, attempt_id: prepared.issue.attempt.attempt_id, manifest_sha256: prepared.manifest_sha256, semantic_key: "d".repeat(64) },
    method: method(), recipient: { host_id: "fixture-host", session_id: "ses_fixture_recipient", agent: "evaluator" },
    account: { provider_id: "controlled-fixture", model_id: "fixture-only", account_id: "no-real-account", credential_revision: "fixture-only" },
    source_authority_ref: "fixture://source", account_authority_ref: "fixture://account", budget_authority_ref: "fixture://budget",
    limits: { requests: 1, input_tokens: 100, output_tokens: 100 } }, reservation_id: "reservation-1", pool_id: "shared-fixture-pool", authority_epoch: "fixture-epoch-1" }
  const receipt = (patch: Partial<EvaluatorExecutionReceipt> = {}): EvaluatorExecutionReceipt => ({
    format: "loom-evaluation-execution-receipt/v1", authority_id: admission.grant.authority_id, receipt_id: "receipt-1", sequence: 1,
    admission_sha256: digest(admission), reservation_id: admission.reservation_id, execution: "unknown", budget: "uncertain", fenced: false,
    usage: null, result: null, ...patch })
  return { ...f, root, state, project, scope, sourceBatch: source.batch_id, prepared, original, admission, receipt,
    cleanup() { f.close(); rmSync(root, { recursive: true, force: true }) } }
}

test("execution mirrors initialize only after an immutable prepared admission and preserve preparation replay", async () => {
  const f = await fixture()
  try {
    const history = f.learning.automatic.history
    expect(history.readExecution(f.prepared.batch_id, actor.session_id)).toBeNull()
    expect(f.derived.query("SELECT name FROM sqlite_schema WHERE name LIKE 'learning_execution_%'").all()).toEqual([])
    expect(() => history.saveExecutionAdmission(f.prepared.batch_id, "foreign", f.admission)).toThrow()
    expect(history.saveExecutionAdmission(f.prepared.batch_id, actor.session_id, f.admission)).toEqual(f.admission)
    expect(history.saveExecutionAdmission(f.prepared.batch_id, actor.session_id, f.admission)).toEqual(f.admission)
    expect(history.readExecution(f.prepared.batch_id, actor.session_id)).toEqual({ admission: f.admission, receipts: [] })
    expect(f.derived.query("SELECT COUNT(*) AS n FROM learning_execution_admissions").get()).toEqual({ n: 1 })
    expect(f.learning.evaluator.prepare(actor, f.sourceBatch, method(), f.prepared.request.budget_policy)).toEqual(f.prepared)
    const changed = method(); changed.rubric.sha256 = "e".repeat(64)
    const second = f.learning.evaluator.prepare(actor, f.sourceBatch, changed, f.prepared.request.budget_policy)
    expect(second.batch_id).not.toBe(f.prepared.batch_id)
    expect(history.readExecution(second.batch_id, actor.session_id)).toBeNull()
  } finally { f.cleanup() }
})

test("execution admission rejects changed preparation, method and reservation identities", async () => {
  const f = await fixture()
  try {
    const history = f.learning.automatic.history
    for (const field of ["source_store_id", "owner_session", "batch_id", "request_id", "manifest_sha256"] as const) {
      const bad = structuredClone(f.admission)
      bad.grant.subject[field] = field === "manifest_sha256" ? "e".repeat(64) : "other-identity"
      expect(() => history.saveExecutionAdmission(f.prepared.batch_id, actor.session_id, bad)).toThrow()
    }
    const bad = structuredClone(f.admission); bad.grant.method.rubric.sha256 = "e".repeat(64)
    expect(() => history.saveExecutionAdmission(f.prepared.batch_id, actor.session_id, bad)).toThrow()
    expect(f.derived.query("SELECT name FROM sqlite_schema WHERE name LIKE 'learning_execution_%'").all()).toEqual([])
    history.saveExecutionAdmission(f.prepared.batch_id, actor.session_id, f.admission)
    for (const field of ["reservation_id", "pool_id", "authority_epoch"] as const) {
      expect(() => history.saveExecutionAdmission(f.prepared.batch_id, actor.session_id, { ...f.admission, [field]: "different" })).toThrow("immutable admission conflict")
    }
    const newAttempt = structuredClone(f.admission); newAttempt.grant.subject.attempt_id = "replacement-attempt"
    expect(() => history.saveExecutionAdmission(f.prepared.batch_id, actor.session_id, newAttempt)).toThrow("immutable admission conflict")
  } finally { f.cleanup() }
})

test("append-only receipts replay exactly and reject changed IDs, sequences and contradictory settled history", async () => {
  const f = await fixture()
  try {
    const history = f.learning.automatic.history
    history.saveExecutionAdmission(f.prepared.batch_id, actor.session_id, f.admission)
    const unknown = f.receipt()
    expect(history.appendExecutionReceipt(f.prepared.batch_id, actor.session_id, unknown).receipts).toEqual([unknown])
    expect(history.appendExecutionReceipt(f.prepared.batch_id, actor.session_id, unknown).receipts).toEqual([unknown])
    expect(() => history.appendExecutionReceipt(f.prepared.batch_id, actor.session_id, { ...unknown, receipt_id: "other" })).toThrow("receipt identity conflict")
    expect(() => history.appendExecutionReceipt(f.prepared.batch_id, actor.session_id, { ...unknown, sequence: 2 })).toThrow("receipt identity conflict")
    expect(() => history.appendExecutionReceipt(f.prepared.batch_id, actor.session_id, { ...unknown, admission_sha256: "f".repeat(64) })).toThrow("binding mismatch")
    const complete = f.receipt({ receipt_id: "receipt-2", sequence: 2, execution: "completed", budget: "settled", fenced: true,
      usage: { requests: 1, input_tokens: 10, output_tokens: 20 },
      result: { host_id: "fixture-host", session_id: "ses_fixture_recipient", input_id: "msg_original", result_id: "msg_result", sha256: "e".repeat(64) } })
    const result = history.appendExecutionReceipt(f.prepared.batch_id, actor.session_id, complete)
    expect(result.receipts).toEqual([unknown, complete])
    // Replayed earlier observations remain history; they cannot downgrade the latest.
    expect(history.appendExecutionReceipt(f.prepared.batch_id, actor.session_id, unknown)).toEqual(result)
    expect(() => history.appendExecutionReceipt(f.prepared.batch_id, actor.session_id, f.receipt({ receipt_id: "receipt-3", sequence: 3 }))).toThrow("Contradictory")
    expect(() => history.appendExecutionReceipt(f.prepared.batch_id, actor.session_id, { ...complete, receipt_id: "receipt-3", sequence: 3,
      usage: { requests: 0, input_tokens: 0, output_tokens: 0 } })).toThrow("Contradictory")
    expect(history.readExecution(f.prepared.batch_id, actor.session_id)).toEqual(result)
  } finally { f.cleanup() }
})

test("admitted execution cannot later manufacture fenced non-admission to release capacity", async () => {
  const f = await fixture()
  try {
    const history = f.learning.automatic.history
    history.saveExecutionAdmission(f.prepared.batch_id, actor.session_id, f.admission)
    history.appendExecutionReceipt(f.prepared.batch_id, actor.session_id, f.receipt({ execution: "admitted" }))
    history.appendExecutionReceipt(f.prepared.batch_id, actor.session_id, f.receipt({ receipt_id: "receipt-2", sequence: 2 }))
    expect(() => history.appendExecutionReceipt(f.prepared.batch_id, actor.session_id, f.receipt({ receipt_id: "receipt-3", sequence: 3,
      execution: "not-admitted", budget: "released", fenced: true, usage: { requests: 0, input_tokens: 0, output_tokens: 0 } }))).toThrow()
    expect(history.readExecution(f.prepared.batch_id, actor.session_id)?.receipts.at(-1)?.budget).toBe("uncertain")
  } finally { f.cleanup() }
})

test("accounting mirror survives original-source loss without granting source or result disclosure", async () => {
  const f = await fixture()
  try {
    const history = f.learning.automatic.history
    history.saveExecutionAdmission(f.prepared.batch_id, actor.session_id, f.admission)
    history.appendExecutionReceipt(f.prepared.batch_id, actor.session_id, f.receipt())
    f.action.exec("DELETE FROM ledger WHERE id='" + f.original.id + "'")
    expect(() => f.learning.evaluator.read(actor.session_id, f.prepared.batch_id)).toThrow()
    expect(history.readExecution(f.prepared.batch_id, actor.session_id)?.receipts).toEqual([f.receipt()])
    expect(() => history.readExecution(f.prepared.batch_id, "foreign")).toThrow()
    history.appendExecutionReceipt(f.prepared.batch_id, actor.session_id, f.receipt({ receipt_id: "receipt-2", sequence: 2,
      execution: "not-admitted", budget: "released", fenced: true, usage: { requests: 0, input_tokens: 0, output_tokens: 0 } }))
    expect(history.readExecution(f.prepared.batch_id, actor.session_id)?.receipts.at(-1)?.budget).toBe("released")
  } finally { f.cleanup() }
})

test("committed admission with lost acknowledgement is recovered without duplicate records", async () => {
  let lose = false
  const f = await fixture(db => ({ prepare: db.prepare.bind(db), exec(sql: string) {
    db.exec(sql)
    if (lose && sql === "COMMIT") { lose = false; throw new Error("lost commit acknowledgement") }
  } }))
  try {
    const history = f.learning.automatic.history
    lose = true
    expect(() => history.saveExecutionAdmission(f.prepared.batch_id, actor.session_id, f.admission)).toThrow("lost commit acknowledgement")
    expect(history.readExecution(f.prepared.batch_id, actor.session_id)?.admission).toEqual(f.admission)
    expect(history.saveExecutionAdmission(f.prepared.batch_id, actor.session_id, f.admission)).toEqual(f.admission)
    expect(f.derived.query("SELECT COUNT(*) AS n FROM learning_execution_admissions").get()).toEqual({ n: 1 })
  } finally { f.cleanup() }
})

test("separate connections preserve the winner's immutable admission and restart preserves uncertain claims", async () => {
  const f = await fixture()
  let second: ReturnType<typeof open> | undefined
  try {
    second = open(f.state)
    f.learning.automatic.history.saveExecutionAdmission(f.prepared.batch_id, actor.session_id, f.admission)
    expect(second.learning.automatic.history.saveExecutionAdmission(f.prepared.batch_id, actor.session_id, f.admission)).toEqual(f.admission)
    expect(() => second!.learning.automatic.history.saveExecutionAdmission(f.prepared.batch_id, actor.session_id,
      { ...f.admission, reservation_id: "contender" })).toThrow("immutable admission conflict")
    const claim = f.store.reviews.claimIssue(actor, { request_id: f.prepared.request_id, kind: "initial" }, "claimant")
    expect(claim.status).toBe("claimed-now")
    f.learning.automatic.history.appendExecutionReceipt(f.prepared.batch_id, actor.session_id, f.receipt())
    second.close(); second = open(f.state)
    expect(second.learning.automatic.history.readExecution(f.prepared.batch_id, actor.session_id)?.receipts).toEqual([f.receipt()])
    expect(second.store.reviews.claimIssue(actor, { request_id: f.prepared.request_id, kind: "initial" }, "other-worker").status).toBe("existing-state")
  } finally { second?.close(); f.cleanup() }
})

for (const [name, sql] of [
  ["missing-table", "DROP TABLE learning_execution_receipts"],
  ["missing-marker", "DELETE FROM learning_execution_schema"],
  ["unsupported-version", "DROP TABLE learning_execution_schema; CREATE TABLE learning_execution_schema(singleton INTEGER,version INTEGER); INSERT INTO learning_execution_schema VALUES(1,2)"],
  ["all-tables-lost", "DROP TABLE learning_execution_receipts; DROP TABLE learning_execution_admissions; DROP TABLE learning_execution_schema"],
  ["admission-row-lost", "DELETE FROM learning_execution_admissions"],
] as const) test("damaged execution extension fails only execution: " + name, async () => {
  const f = await fixture()
  try {
    const history = f.learning.automatic.history
    history.saveExecutionAdmission(f.prepared.batch_id, actor.session_id, f.admission)
    f.derived.exec(sql)
    expect(() => history.readExecution(f.prepared.batch_id, actor.session_id)).toThrow()
    expect(() => history.saveExecutionAdmission(f.prepared.batch_id, actor.session_id, f.admission)).toThrow()
    expect(f.learning.evaluator.read(actor.session_id, f.prepared.batch_id).request_id).toBe(f.prepared.request_id)
    expect(history.get(f.sourceBatch, actor.session_id).state).toBe("complete")
    expect(f.store.record(actor, undefined, { kind: "result", statement: "Ordinary engineering remains usable" }).id).toBeString()
  } finally { f.cleanup() }
})

test("stopped-state backup and restore retain execution mirrors and reject a surviving enrollment with missing extension", async () => {
  const f = await fixture()
  const command = new URL("../tools/learning-state-backup.py", import.meta.url).pathname
  try {
    f.learning.automatic.history.saveExecutionAdmission(f.prepared.batch_id, actor.session_id, f.admission)
    f.learning.automatic.history.appendExecutionReceipt(f.prepared.batch_id, actor.session_id, f.receipt())
    f.close()
    const backup = join(f.root, "backup"), restoredParent = join(f.root, "restored"), destination = join(restoredParent, f.scope)
    mkdirSync(restoredParent)
    const settings = ["--project-id", "execution-store", "--project-canonical", f.project,
      "--loom-revision", "9e9697a105693b54054d8036b1cc88edfb0fcd01", "--package-version", "2.0.0-alpha.1"]
    const run = (...args: string[]) => Bun.spawnSync(["python3", command, ...args, ...settings], { env: { ...process.env, LOOM_WRITERS_STOPPED: "yes" } })
    const saved = run("backup", "--source-dir", f.state, "--backup-dir", backup)
    expect(saved.stderr.toString()).toBe(""); expect(saved.exitCode).toBe(0)
    const restored = run("restore", "--backup-dir", backup, "--destination-dir", destination)
    expect(restored.stderr.toString()).toBe(""); expect(restored.exitCode).toBe(0)
    const reopened = open(destination)
    try { expect(reopened.learning.automatic.history.readExecution(f.prepared.batch_id, actor.session_id)).toEqual({ admission: f.admission, receipts: [f.receipt()] }) }
    finally { reopened.close() }
    const db = new Database(join(f.state, "learning.sqlite"))
    db.exec("DROP TABLE learning_execution_receipts; DROP TABLE learning_execution_admissions; DROP TABLE learning_execution_schema")
    db.close(true)
    const damagedBackup = join(f.root, "damaged-backup"), rejected = run("backup", "--source-dir", f.state, "--backup-dir", damagedBackup)
    expect(rejected.exitCode).not.toBe(0)
    expect(rejected.stderr.toString()).toContain("learning_execution_")
    expect(existsSync(join(damagedBackup, "loom-state-manifest.json"))).toBe(false)
  } finally { f.cleanup() }
})
