import { test, expect } from "bun:test"
import { Database } from "bun:sqlite"
import { createHash } from "node:crypto"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { Store } from "../src/store.js"
import { Store as LegacyStore } from "./fixtures/historical-3f08da9/store.js"
import { digest } from "../src/model.js"
import { registeredLoom } from "./helpers/registered-loom.js"

const actor = { session_id: "s", agent: "author" }
const revision = "3a7b74f69ea98236c11dcee9e03c8000139453b4"
const command = new URL("../tools/learning-state-backup.py", import.meta.url).pathname
const hash = (data: Uint8Array) => createHash("sha256").update(data).digest("hex")
const hashes = (directory: string) => Object.fromEntries(readdirSync(directory).sort().map(name => [name, hash(readFileSync(join(directory, name)))]))
const scope = (project: string) => digest({ project: "tool-help", canonical: project })
const state = (home: string, project: string) => join(home, "loom", "actions-v1", scope(project))
const settings = (project: string) => ["--project-id", "tool-help", "--project-canonical", project,
  "--loom-revision", revision, "--package-version", "2.0.0-alpha.1"]
function python(args: string[]) {
  return Bun.spawnSync(["python3", command, ...args], { env: { ...process.env, LOOM_WRITERS_STOPPED: "yes" } })
}
function success(result: ReturnType<typeof python>) {
  if (result.exitCode !== 0) throw new Error(result.stderr.toString())
  expect(result.stderr.toString()).toBe("")
  return result.stdout.toString()
}
function request(id = "recovery-request") {
  return { format: "loom-review-request/v1", request_id: id,
    mandate: { question: "Does original artifact A meet the original correctness requirement?", dimensions: ["correctness"],
      criteria: [{ text: "Retain the original qualification", source_ref: "request:original" }], mode: "assessment",
      inclusions: ["artifact A"], exclusions: ["new artifact B"] },
    intended_recipient: { agent: "reviewer", session_id: null },
    members: [{ member_id: "artifact-A", work_ref: null, producing_attempt_refs: [], prior_review_request_id: null,
      artifact_refs: [{ locator: "fixture://artifact-A", version: { kind: "sha256", value: digest("artifact A") }, content_ref: null }],
      membership_source_refs: ["request:original"], gaps: [{ reason: "source-missing", source_ref: "fixture://artifact-A" }] }], rechecks: [] }
}

test("v1 migration preserves original ledger bytes and adds empty v2 review state without inferred mandates", () => {
  const db = new Database(":memory:")
  try {
    const legacy = new LegacyStore(db), action = legacy.create("Original Action", "Retain the historical meaning", actor)
    const plan = legacy.savePlan(action.id, 0, [{ id: "task", kind: "task", title: "Historical Task" }])
    const source = legacy.observe(actor, { action_id: action.id, node_id: "task" }, { phase: "started", tool: "read", correlation_key: "old-key" })
    const original = db.query("SELECT data FROM ledger ORDER BY seq").all()
    expect(db.query("PRAGMA user_version").get()).toEqual({ user_version: 1 })
    const current = new Store(db)
    expect(db.query("PRAGMA user_version").get()).toEqual({ user_version: 2 })
    expect(db.query("SELECT data FROM ledger ORDER BY seq").all()).toEqual(original)
    expect(current.action(action.id)).toEqual(action)
    expect(current.plan(action.id, 1)).toEqual(plan)
    expect(current.records({ action_id: action.id, record_id: source.id }).items[0].data).not.toHaveProperty("work_scope")
    for (const table of ["review_requests", "review_relationships", "review_issue_intents", "review_issue_outcomes"])
      expect(db.query("SELECT COUNT(*) AS n FROM " + table).get()).toEqual({ n: 0 })
    const identity = current.reviews.storeID
    expect(new Store(db).reviews.storeID).toBe(identity)
    expect(db.query("SELECT COUNT(*) AS n FROM review_store_identity").get()).toEqual({ n: 1 })
  } finally { db.close() }
})

test("a failed v1 migration rolls back newly created review tables and preserves the old version and records", () => {
  const db = new Database(":memory:")
  try {
    const legacy = new LegacyStore(db), action = legacy.create("Keep", "No partial migration", actor)
    legacy.record(actor, { action_id: action.id }, { kind: "result", statement: "Existing evidence" })
    db.exec("CREATE TABLE review_requests(unrecognized TEXT); INSERT INTO review_requests VALUES ('preserved')")
    const original = db.query("SELECT type,name,tbl_name,sql FROM sqlite_schema ORDER BY type,name").all()
    const records = db.query("SELECT data FROM ledger").all()
    expect(() => new Store(db)).toThrow()
    expect(db.query("PRAGMA user_version").get()).toEqual({ user_version: 1 })
    expect(db.query("SELECT type,name,tbl_name,sql FROM sqlite_schema ORDER BY type,name").all()).toEqual(original)
    expect(db.query("SELECT data FROM ledger").all()).toEqual(records)
    expect(db.query("SELECT * FROM review_requests").all()).toEqual([{ unrecognized: "preserved" }])
  } finally { db.close() }
})

for (const damage of ["missing-table", "missing-identity", "future-version"] as const) {
  test("v2 recovery refuses " + damage + " without rebuilding consumed state", () => {
    const db = new Database(":memory:")
    try {
      const store = new Store(db)
      store.reviews.freeze(actor, request())
      const prepared = store.reviews.prepareIssue(actor, "recovery-request", { kind: "initial" })
      expect(store.reviews.claimIssue(actor, prepared.intent, "crashed-caller").status).toBe("claimed-now")
      if (damage === "missing-table") db.exec("DROP TABLE review_issue_outcomes")
      else if (damage === "missing-identity") db.exec("DELETE FROM review_store_identity")
      else db.exec("PRAGMA user_version=42")
      const schema = db.query("SELECT type,name,tbl_name,sql FROM sqlite_schema ORDER BY type,name").all()
      const claims = db.query("SELECT * FROM review_issue_intents").all()
      expect(() => new Store(db)).toThrow(damage === "missing-table" ? "persistence is incomplete"
        : damage === "missing-identity" ? "identity is missing" : "Unsupported Loom Action database version")
      expect(db.query("SELECT type,name,tbl_name,sql FROM sqlite_schema ORDER BY type,name").all()).toEqual(schema)
      expect(db.query("SELECT * FROM review_issue_intents").all()).toEqual(claims)
      expect(db.query("PRAGMA user_version").get()).toEqual({ user_version: damage === "future-version" ? 42 : 2 })
    } finally { db.close() }
  })
}

for (const mode of ["closed", "residual-WAL"] as const) {
  test("offline " + mode + " restore preserves request identity, consumed intent and authorized public readback", async () => {
    const root = mkdtempSync(join(tmpdir(), "loom-review-recovery-")), project = join(root, "project")
    const sourceHome = join(project, "state"), restoredHome = join(root, "restored-state"), backup = join(root, "backup")
    mkdirSync(project)
    mkdirSync(join(restoredHome, "loom", "actions-v1"), { recursive: true })
    const originalRequest = request()
    let storeID: string, attemptID: string, relationID: string
    try {
      const host = await registeredLoom([], { directory: project, versionedHost: true })
      try {
        expect((await host.invoke("review", { operation: "freeze", request: originalRequest })).result.status).toBe("created")
        const result = (await host.invoke("record", { operation: "add", session_only: true, kind: "assessment", verdict: "inconclusive",
          statement: "Artifact A bytes unavailable; original mandate remains unsatisfied." })).result
        relationID = (await host.invoke("review", { operation: "relate", request_id: originalRequest.request_id,
          relationship: "finding", source_record_id: result.id, member_ids: ["artifact-A"] })).result.id
        const before = (await host.invoke("review", { operation: "read", request_id: originalRequest.request_id })).result
        storeID = before.namespace.store_id
        attemptID = (await host.invoke("review", { operation: "prepare", request_id: originalRequest.request_id })).result.attempt.attempt_id
        expect(host.sessionPrompts).toHaveLength(0)
        expect(host.sessionCreates).toHaveLength(0)
      } finally { await host.close() }
      const filename = join(state(sourceHome, project), "ledger.sqlite")
      // Consume only the local permit, with no native dispatch. A crash can leave
      // exactly this durable uncertainty, so reopening must never renew it.
      if (mode === "closed") {
        const db = new Database(filename)
        try {
          const store = new Store(db)
          expect(store.reviews.claimIssue(actor, { request_id: originalRequest.request_id, kind: "initial" }, "crashed-caller").status).toBe("claimed-now")
        } finally { db.close() }
      } else {
        const childProgram = [
          'import { Database } from "bun:sqlite";',
          "import { Store } from " + JSON.stringify(new URL("../src/store.ts", import.meta.url).pathname) + ";",
          'import { writeSync } from "node:fs";',
          "const db = new Database(" + JSON.stringify(filename) + "), store = new Store(db);",
          'db.exec("PRAGMA wal_autocheckpoint=0");',
          "const claim = store.reviews.claimIssue(" + JSON.stringify(actor) + ', {request_id:"recovery-request",kind:"initial"}, "crashed-caller");',
          'writeSync(1, claim.status + "\\n");',
          'process.kill(process.pid, "SIGKILL");',
        ].join("\n")
        const child = Bun.spawnSync([process.execPath, "--eval", childProgram])
        expect(child.signalCode).toBe("SIGKILL")
        expect(child.stderr.toString()).toBe("")
        expect(child.stdout.toString().trim()).toBe("claimed-now")
        expect(readFileSync(filename + "-wal").length).toBeGreaterThan(32)
      }
      const before = hashes(state(sourceHome, project))
      expect(success(python(["backup", "--source-dir", state(sourceHome, project), "--backup-dir", backup, ...settings(project)]))).toContain("BACKUP VERIFIED")
      const manifest = JSON.parse(readFileSync(join(backup, "loom-state-manifest.json"), "utf8"))
      expect(manifest.databases["ledger.sqlite"].user_version).toBe(2)
      const backupBytes = hashes(backup)
      expect(success(python(["restore", "--backup-dir", backup, "--destination-dir", state(restoredHome, project), ...settings(project)]))).toContain("RESTORE VERIFIED")
      expect(hashes(state(restoredHome, project))).toEqual(before)
      const inspection = new Database(join(state(restoredHome, project), "ledger.sqlite"))
      try {
        const restored = new Store(inspection), prepared = restored.reviews.prepareIssue(actor, originalRequest.request_id, { kind: "initial" })
        expect(restored.reviews.storeID).toBe(storeID!)
        expect(prepared.status).toBe("existing")
        expect(prepared.attempt).toMatchObject({ attempt_id: attemptID!, state: "claimed", native_outcome: "unknown", claimant_id: "crashed-caller" })
        expect(restored.reviews.claimIssue(actor, prepared.intent, "crashed-caller").status).toBe("existing-state")
        expect(restored.reviews.claimIssue(actor, prepared.intent, "replacement-caller").status).toBe("existing-state")
        expect(inspection.query("SELECT id FROM review_relationships").get()).toEqual({ id: relationID! })
      } finally { inspection.close() }

      // The reader has its own environment and connection lifetime; another
      // test's host cannot redirect it to the still-preserved original WAL.
      const expectations = join(root, "review-reader-expectations.json")
      writeFileSync(expectations, JSON.stringify({ request: originalRequest, storeID: storeID!, attemptID: attemptID! }))
      for (let reopen = 0; reopen < 2; reopen++) {
        const reader = Bun.spawnSync([process.execPath, new URL("./helpers/review-recovery-reader.ts", import.meta.url).pathname,
          project, restoredHome, expectations])
        if (reader.exitCode !== 0) throw new Error("restored public review readback failed: " + reader.stderr.toString())
        expect(reader.stdout.toString()).toContain("PASS: restored review mandate, qualification, consumed intent and reader boundaries")
      }
      expect(hashes(state(sourceHome, project))).toEqual(before)
      expect(hashes(backup)).toEqual(backupBytes)
    } finally { rmSync(root, { recursive: true, force: true }) }
  })
}

test("offline backups accept real v1 state and reject incomplete or unsupported v2 state before publishing a manifest", () => {
  const root = mkdtempSync(join(tmpdir(), "loom-review-backup-guards-")), project = join(root, "project"), source = state(join(root, "source"), project)
  mkdirSync(project)
  mkdirSync(source, { recursive: true })
  const filename = join(source, "ledger.sqlite")
  try {
    const db = new Database(filename), legacy = new LegacyStore(db)
    legacy.create("Legacy", "Preserve genuine v1 backup support", actor)
    db.close()
    expect(success(python(["backup", "--source-dir", source, "--backup-dir", join(root, "v1"), "--legacy-no-learning", ...settings(project)]))).toContain("BACKUP VERIFIED")
    expect(JSON.parse(readFileSync(join(root, "v1", "loom-state-manifest.json"), "utf8")).databases["ledger.sqlite"].user_version).toBe(1)
    const upgraded = new Database(filename)
    new Store(upgraded)
    upgraded.exec("DROP TABLE review_issue_outcomes")
    upgraded.close()
    const missing = join(root, "missing")
    const rejected = python(["backup", "--source-dir", source, "--backup-dir", missing, "--legacy-no-learning", ...settings(project)])
    expect(rejected.exitCode).not.toBe(0)
    expect(rejected.stderr.toString()).toContain("Missing required ledger.sqlite tables: review_issue_outcomes")
    expect(existsSync(join(missing, "loom-state-manifest.json"))).toBe(false)
    const unknown = new Database(filename)
    unknown.exec("PRAGMA user_version=42")
    unknown.close()
    const future = join(root, "future")
    const incompatible = python(["backup", "--source-dir", source, "--backup-dir", future, "--legacy-no-learning", ...settings(project)])
    expect(incompatible.exitCode).not.toBe(0)
    expect(incompatible.stderr.toString()).toContain("Unsupported ledger.sqlite user_version=42")
    expect(existsSync(join(future, "loom-state-manifest.json"))).toBe(false)
  } finally { rmSync(root, { recursive: true, force: true }) }
})
