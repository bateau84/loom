import { test, expect } from "bun:test"
import { Database } from "bun:sqlite"
import { createHash } from "node:crypto"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Store } from "../src/store.js"
import { Learning } from "../src/learning.js"
import { digest } from "../src/model.js"

const command = new URL("../tools/learning-state-backup.py", import.meta.url).pathname
const actor = { session_id: "owner", agent: "author" }
const sha = (bytes: Uint8Array | string) => createHash("sha256").update(bytes).digest("hex")
const revision = "b0f73cf345d2eb8d54e58c093831b6792ee2216d"
function files(directory: string) {
  return Object.fromEntries(readdirSync(directory).filter(name => name !== "loom-state-manifest.json").sort()
    .map(name => [name, { size: statSync(join(directory, name)).size, sha256: sha(readFileSync(join(directory, name))) }]))
}
async function fixture() {
  const root = mkdtempSync(join(tmpdir(), "loom-evaluation-backup-")), project = join(root, "project")
  const source = join(root, digest({ project: "evaluation-backup", canonical: project }))
  mkdirSync(project); mkdirSync(source)
  const action = new Database(join(source, "ledger.sqlite")), derived = new Database(join(source, "learning.sqlite"))
  let batchID: string
  try {
    const store = new Store(action), learning = new Learning(derived, store, action)
    store.observe(actor, undefined, { phase: "finished", status: "error" })
    const result = await learning.automatic.run(actor.session_id, async () => {}, new AbortController().signal)
    expect(result.state).toBe("complete")
    batchID = result.batch_id!
  } finally { derived.close(true); action.close(true) }
  const backup = join(root, "backup"), restoredHome = join(root, "restored")
  mkdirSync(restoredHome)
  const destination = join(restoredHome, source.slice(source.lastIndexOf("/") + 1))
  const settings = ["--project-id", "evaluation-backup", "--project-canonical", project,
    "--loom-revision", revision, "--package-version", "2.0.0-alpha.1"]
  const run = (operation: "backup" | "restore") => Bun.spawnSync(["python3", command, operation,
    ...(operation === "backup" ? ["--source-dir", source, "--backup-dir", backup]
      : ["--backup-dir", backup, "--destination-dir", destination]), ...settings],
    { env: { ...process.env, LOOM_WRITERS_STOPPED: "yes" } })
  return { root, source, backup, destination, batchID, run, close: () => rmSync(root, { recursive: true, force: true }) }
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

test("offline evaluation recovery preserves published reports and unchanged source bytes", async () => {
  const f = await fixture()
  try {
    const original = files(f.source)
    ok(f.run("backup")); ok(f.run("restore"))
    expect(files(f.source)).toEqual(original)
    expect(files(f.destination)).toEqual(original)
    const action = new Database(join(f.destination, "ledger.sqlite")), derived = new Database(join(f.destination, "learning.sqlite"))
    try {
      const store = new Store(action), learning = new Learning(derived, store, action)
      expect(learning.automatic.history.get(f.batchID, actor.session_id).state).toBe("complete")
      expect(learning.automatic.history.report(f.batchID, actor.session_id)!.body).toMatchObject({ observations: { "tool-error": 1 }, objective_success: "not-assessed" })
    } finally { derived.close(true); action.close(true) }
    expect(files(f.source)).toEqual(original)
  } finally { f.close() }
})

const damage = [
  ["missing-table", "DROP TABLE learning_evaluation_opportunities", "learning_evaluation_opportunities"],
  ["missing-schema", "DROP TABLE learning_evaluation_schema", "learning_evaluation_schema"],
  ["missing-marker", "DELETE FROM learning_evaluation_schema", "evaluation schema marker"],
  ["future-version", "DROP TABLE learning_evaluation_schema; CREATE TABLE learning_evaluation_schema(singleton INTEGER,version INTEGER); INSERT INTO learning_evaluation_schema VALUES(1,2)", "evaluation schema version"],
  ["missing-column", "ALTER TABLE learning_evaluation_opportunities RENAME COLUMN generation TO lost_generation", "generation"],
] as const
for (const [name, sql, phrase] of damage) test("offline backup rejects structurally valid evaluation damage: " + name, async () => {
  const f = await fixture()
  try {
    alter(f.source, sql)
    const before = files(f.source), result = f.run("backup")
    expect(result.exitCode).not.toBe(0)
    expect(result.stderr.toString()).toContain(phrase)
    expect(existsSync(join(f.backup, "loom-state-manifest.json"))).toBe(false)
    expect(files(f.source)).toEqual(before)
  } finally { f.close() }
})

test("restore rejects a checksum-consistent incomplete evaluation schema before creating its destination", async () => {
  const f = await fixture()
  try {
    ok(f.run("backup"))
    alter(f.backup, "DROP TABLE learning_evaluation_opportunities")
    const manifestPath = join(f.backup, "loom-state-manifest.json")
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8"))
    const db = new Database(join(f.backup, "learning.sqlite"))
    try {
      // Simulate a self-consistent set produced by the old validator. Checksums
      // cannot substitute for the application's versioned schema obligations.
      const schema = db.query("SELECT type,name,tbl_name,sql FROM sqlite_schema ORDER BY type,name,tbl_name").values()
      manifest.databases["learning.sqlite"].schema_sha256 = sha(JSON.stringify(schema))
    } finally { db.close(true) }
    manifest.files = files(f.backup)
    writeFileSync(manifestPath, JSON.stringify(manifest))
    const before = files(f.backup), result = f.run("restore")
    expect(result.exitCode).not.toBe(0)
    expect(result.stderr.toString()).toContain("learning_evaluation_opportunities")
    expect(existsSync(f.destination)).toBe(false)
    expect(files(f.backup)).toEqual(before)
  } finally { f.close() }
})

test("offline backup and restore still accept learning state with no evaluation schema", async () => {
  const f = await fixture()
  try {
    const db = new Database(join(f.source, "learning.sqlite"))
    try {
      db.exec("PRAGMA foreign_keys=OFF")
      const tables = db.query("SELECT name FROM sqlite_schema WHERE type='table' AND name GLOB 'learning_evaluation_*'").all() as Array<{ name: string }>
      for (const { name } of tables) db.exec('DROP TABLE "' + name + '"')
    } finally { db.close(true) }
    const original = files(f.source)
    ok(f.run("backup")); ok(f.run("restore"))
    expect(files(f.source)).toEqual(original)
    expect(files(f.destination)).toEqual(original)
  } finally { f.close() }
})
