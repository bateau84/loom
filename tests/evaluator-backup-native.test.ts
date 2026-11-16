import { expect, test } from "bun:test"
import { Database } from "bun:sqlite"
import { createHash } from "node:crypto"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { parseEvaluatorMethod } from "../src/evaluator-method.js"
import { Learning } from "../src/learning.js"
import { digest } from "../src/model.js"
import { Store } from "../src/store.js"

const command = new URL("../tools/learning-state-backup.py", import.meta.url).pathname
const actor = { session_id: "evaluator-backup-owner", agent: "original-author" }
const revision = "535db61746773309511dc5110d0786b97b40c96a"
const sha = (bytes: Uint8Array | string) => createHash("sha256").update(bytes).digest("hex")

function files(directory: string) {
  return Object.fromEntries(readdirSync(directory).filter(name => name !== "loom-state-manifest.json").sort()
    .map(name => [name, { size: statSync(join(directory, name)).size, sha256: sha(readFileSync(join(directory, name))) }]))
}

function preparationRows(db: Database) {
  return {
    methods: db.query("SELECT * FROM learning_evaluator_methods ORDER BY id").all(),
    requests: db.query("SELECT * FROM learning_evaluator_requests ORDER BY batch_id,slot,method_id").all(),
  }
}

async function fixture(extension = true) {
  const root = mkdtempSync(join(tmpdir(), "loom-evaluator-backup-")), project = join(root, "project")
  const source = join(root, digest({ project: "evaluator-backup", canonical: project }))
  mkdirSync(project); mkdirSync(source)
  const action = new Database(join(source, "ledger.sqlite")), derived = new Database(join(source, "learning.sqlite"))
  let expected: ReturnType<typeof preparationRows> | undefined
  let prepared: ReturnType<Learning["evaluator"]["prepare"]> | undefined
  let originalID: string | undefined
  let manifest: ReturnType<typeof parseEvaluatorMethod> | undefined
  let batchID: string
  try {
    const store = new Store(action), learning = new Learning(derived, store, action)
    const original = store.record(actor, undefined, { kind: "result", statement: "Original source for backup reconstruction" })
    originalID = original.id
    store.observe(actor, undefined, { phase: "finished", status: "error" })
    const result = await learning.automatic.run(actor.session_id, async () => {}, new AbortController().signal)
    if (result.state !== "complete" || !result.batch_id) throw new Error("Stage 3 backup fixture did not complete")
    batchID = result.batch_id
    if (extension) {
      const ref = (locator: string) => ({ locator, sha256: "a".repeat(64) })
      const policy = (id: string) => ({ id, revision: "revision-1", sha256: "b".repeat(64) })
      manifest = parseEvaluatorMethod({
        format: "loom-evaluator-method/v1",
        evaluator: { agent: "evaluator", definition: ref("agents/evaluator.md@immutable-1") },
        audit_skill: { skill: "agent-run-audit", definition: ref("skills/agent-run-audit/SKILL.md@immutable-1") },
        rubric: ref("audit/rubric@immutable-1"), instruction_bundle: ref("audit/instructions@immutable-1"),
        result_format: "loom-evaluator-interpretation/v1",
        model: { provider_id: "unqualified-fixture", model_id: "not-dispatched", settings: ref("settings@immutable-1") },
        adapter: { id: "unavailable", version: "1", profile: policy("sealed-profile-unqualified") },
        source_policy: policy("same-owner"), route_policy: policy("disabled"),
      })
      prepared = learning.evaluator.prepare(actor, batchID, manifest, null)
      expect(prepared.request.review_request.requester).toEqual(actor)
      expect(prepared.issue?.attempt).toMatchObject({ state: "prepared", native_outcome: "not-issued", claimant_id: null })
      expected = preparationRows(derived)
    }
  } finally { derived.close(true); action.close(true) }
  const backup = join(root, "backup"), restoredHome = join(root, "restored")
  mkdirSync(restoredHome)
  const destination = join(restoredHome, source.slice(source.lastIndexOf("/") + 1))
  const settings = ["--project-id", "evaluator-backup", "--project-canonical", project,
    "--loom-revision", revision, "--package-version", "2.0.0-alpha.1"]
  const run = (operation: "backup" | "restore") => Bun.spawnSync(["python3", command, operation,
    ...(operation === "backup" ? ["--source-dir", source, "--backup-dir", backup]
      : ["--backup-dir", backup, "--destination-dir", destination]), ...settings],
    { env: { ...process.env, LOOM_WRITERS_STOPPED: "yes" } })
  return { root, source, backup, destination, batchID, expected, prepared, originalID, manifest, run,
    close: () => rmSync(root, { recursive: true, force: true }) }
}

function alter(directory: string, sql: string) {
  const db = new Database(join(directory, "learning.sqlite"))
  try {
    db.exec("PRAGMA foreign_keys=OFF; " + sql)
    expect(db.query("PRAGMA integrity_check").values()).toEqual([["ok"]])
    expect(db.query("PRAGMA foreign_key_check").values()).toEqual([])
  } finally { db.close(true) }
}

function ok(result: ReturnType<Awaited<ReturnType<typeof fixture>>["run"]>) {
  if (result.exitCode !== 0) throw new Error(result.stderr.toString())
}

test("paired stopped-state restore preserves exact evaluator preparation rows and the unclaimed canonical issue", async () => {
  const f = await fixture()
  try {
    if (!f.expected || !f.prepared || !f.manifest || !f.originalID) throw new Error("Evaluator backup fixture omitted preparation state")
    const original = files(f.source), prepared = f.prepared
    if (!prepared.issue) throw new Error("Evaluator backup fixture omitted canonical issue")
    ok(f.run("backup")); ok(f.run("restore"))
    expect(files(f.source)).toEqual(original)
    expect(files(f.destination)).toEqual(original)
    const action = new Database(join(f.destination, "ledger.sqlite")), derived = new Database(join(f.destination, "learning.sqlite"))
    try {
      expect(preparationRows(derived)).toEqual(f.expected)
      const store = new Store(action), learning = new Learning(derived, store, action)
      const reconstructed = learning.evaluator.read(actor.session_id, prepared.batch_id)
      expect(reconstructed).toEqual(prepared)
      expect(reconstructed.request.review_request.requester).toEqual(actor)
      expect(reconstructed.manifest_sha256).toBe(prepared.manifest_sha256)
      expect(reconstructed.request.review_request.members[0]?.artifact_refs[0]?.version).toEqual({ kind: "sha256", value: prepared.manifest_sha256 })
      expect(store.reviews.readIssue(actor, prepared.request_id)).toEqual(prepared.issue)
      expect(reconstructed.issue?.attempt).toMatchObject({ state: "prepared", native_outcome: "not-issued", claimant_id: null })
      expect(learning.automatic.history.get(f.batchID, actor.session_id).state).toBe("complete")
      const page = learning.evaluator.members(actor.session_id, prepared.batch_id, prepared.request_id, prepared.manifest_sha256)
      const member = page.items.find(item => item.source_refs.some(ref => ref.id === f.originalID))
      if (!member) throw new Error("Original source missing from restored manifest")
      const index = member.source_refs.findIndex(ref => ref.id === f.originalID)
      expect(learning.evaluator.source(actor.session_id, prepared.batch_id, prepared.request_id, prepared.manifest_sha256, member.key, index).value.id).toBe(f.originalID)
      expect(learning.evaluator.prepare({ ...actor, agent: "recovery-agent" }, f.batchID, f.manifest, null)).toEqual(prepared)
      const intent = { request_id: prepared.request_id, kind: "initial" as const }
      const claim = store.reviews.claimIssue(actor, intent, "before-replay")
      expect(claim.status).toBe("claimed-now")
      const replay = learning.evaluator.prepare(actor, f.batchID, f.manifest, null)
      expect(replay.issue?.attempt).toEqual(claim.attempt)
      expect(store.reviews.claimIssue(actor, intent, "after-replay").status).toBe("existing-state")
      expect(action.query("SELECT COUNT(*) AS n FROM review_requests").get()).toEqual({ n: 1 })
      expect(action.query("SELECT COUNT(*) AS n FROM review_issue_intents").get()).toEqual({ n: 1 })
      expect(derived.query("SELECT COUNT(*) AS n FROM learning_evaluator_requests").get()).toEqual({ n: 1 })
    } finally { derived.close(true); action.close(true) }
    expect(files(f.source)).toEqual(original)
  } finally { f.close() }
})

test("stopped-state backup accepts legacy Stage 3 without any evaluator preparation table", async () => {
  const f = await fixture(false)
  try {
    const original = files(f.source)
    ok(f.run("backup")); ok(f.run("restore"))
    expect(files(f.source)).toEqual(original)
    expect(files(f.destination)).toEqual(original)
  } finally { f.close() }
})

const damage = [
  ["missing-request-table", "DROP TABLE learning_evaluator_requests", "learning_evaluator_requests"],
  ["missing-method-table", "DELETE FROM learning_evaluator_requests; DROP TABLE learning_evaluator_methods", "learning_evaluator_methods"],
  ["missing-schema-table", "DROP TABLE learning_evaluator_schema", "learning_evaluator_schema"],
  ["missing-marker", "DELETE FROM learning_evaluator_schema", "evaluator preparation schema marker"],
  ["duplicate-marker", "DROP TABLE learning_evaluator_schema; CREATE TABLE learning_evaluator_schema(singleton INTEGER,version INTEGER); INSERT INTO learning_evaluator_schema VALUES(1,1),(2,1)", "evaluator preparation schema marker"],
  ["future-version", "DROP TABLE learning_evaluator_schema; CREATE TABLE learning_evaluator_schema(singleton INTEGER,version INTEGER); INSERT INTO learning_evaluator_schema VALUES(1,2)", "evaluator preparation schema version"],
  ["missing-column", "ALTER TABLE learning_evaluator_requests RENAME COLUMN request_id TO lost_request_id", "request_id"],
  ["missing-base-evaluation-schema", "DROP TABLE learning_evaluation_schema", "learning_evaluation_schema"],
] as const

for (const [name, sql, phrase] of damage) test("stopped-state backup refuses incomplete evaluator preparation: " + name, async () => {
  const f = await fixture()
  try {
    alter(f.source, sql)
    const original = files(f.source), result = f.run("backup")
    expect(result.exitCode).not.toBe(0)
    expect(result.stderr.toString()).toContain(phrase)
    expect(existsSync(join(f.backup, "loom-state-manifest.json"))).toBe(false)
    expect(files(f.source)).toEqual(original)
  } finally { f.close() }
})

test("a matching backup integrity manifest cannot substitute a missing evaluator request table", async () => {
  const f = await fixture()
  try {
    ok(f.run("backup"))
    alter(f.backup, "DROP TABLE learning_evaluator_requests")
    const manifestPath = join(f.backup, "loom-state-manifest.json")
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8"))
    const db = new Database(join(f.backup, "learning.sqlite"))
    try {
      const schema = db.query("SELECT type,name,tbl_name,sql FROM sqlite_schema ORDER BY type,name,tbl_name").values()
      manifest.databases["learning.sqlite"].schema_sha256 = sha(JSON.stringify(schema))
    } finally { db.close(true) }
    manifest.files = files(f.backup)
    writeFileSync(manifestPath, JSON.stringify(manifest))
    const original = files(f.backup), result = f.run("restore")
    expect(result.exitCode).not.toBe(0)
    expect(result.stderr.toString()).toContain("learning_evaluator_requests")
    expect(existsSync(f.destination)).toBe(false)
    expect(files(f.backup)).toEqual(original)
  } finally { f.close() }
})
