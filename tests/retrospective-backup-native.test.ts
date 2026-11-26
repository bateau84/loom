import { expect, test } from "bun:test"
import { Database } from "bun:sqlite"
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs"
import { createHash } from "node:crypto"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Learning } from "../src/learning.js"
import { Store } from "../src/store.js"
import { digest } from "../src/model.js"
import { retrospectiveMemberKey, type RetrospectiveManifest } from "../src/retrospective-contract.js"
import { retrospectiveActor as actor, retrospectiveFixture } from "./helpers/retrospective-store-fixture.js"

const command = new URL("../tools/learning-state-backup.py", import.meta.url).pathname
const sha = (value: string | Uint8Array) => createHash("sha256").update(value).digest("hex")
const files = (directory: string) => Object.fromEntries(readdirSync(directory).filter(name => name !== "loom-state-manifest.json").sort()
  .map(name => [name, { size: statSync(join(directory, name)).size, sha256: sha(readFileSync(join(directory, name))) }]))

function fixture(prepare: (manifest: RetrospectiveManifest) => RetrospectiveManifest = value => value) {
  const root = mkdtempSync(join(tmpdir(), "loom-retrospective-backup-")), project = join(root, "project")
  const source = join(root, digest({ project: "retrospective-backup", canonical: project }))
  mkdirSync(project); mkdirSync(source)
  const action = new Database(join(source, "ledger.sqlite")), derived = new Database(join(source, "learning.sqlite"))
  let frozen
  try {
    const store = new Store(action), learning = new Learning(derived, store, action)
    frozen = learning.automatic.history.freezeRetrospective(actor, prepare(retrospectiveFixture(107, store.reviews.storeID)))
  } finally { derived.close(true); action.close(true) }
  const backup = join(root, "backup"), restored = join(root, "restored")
  mkdirSync(restored)
  const destination = join(restored, source.slice(source.lastIndexOf("/") + 1))
  const settings = ["--project-id", "retrospective-backup", "--project-canonical", project,
    "--loom-revision", "dfe649210ff9ac0a70ea9878e7e09d18450d2de6", "--package-version", "2.0.0-alpha.1"]
  const run = (operation: "backup" | "restore") => Bun.spawnSync(["python3", command, operation,
    ...(operation === "backup" ? ["--source-dir", source, "--backup-dir", backup] : ["--backup-dir", backup, "--destination-dir", destination]), ...settings],
    { env: { ...process.env, LOOM_WRITERS_STOPPED: "yes" } })
  return { source, backup, destination, frozen, run, close: () => rmSync(root, { recursive: true, force: true }) }
}
function alter(directory: string, sql: string) {
  const db = new Database(join(directory, "learning.sqlite"))
  try { db.exec("PRAGMA foreign_keys=OFF"); db.exec(sql) } finally { db.close(true) }
}
function ok(result: ReturnType<ReturnType<typeof fixture>["run"]>) {
  if (result.exitCode !== 0) throw new Error(result.stderr.toString())
}

test("paired offline restore preserves every retrospective identity and frozen descriptor", () => {
  const f = fixture()
  try {
    const original = files(f.source)
    ok(f.run("backup")); ok(f.run("restore"))
    expect(files(f.source)).toEqual(original)
    expect(files(f.destination)).toEqual(original)
    const action = new Database(join(f.destination, "ledger.sqlite")), derived = new Database(join(f.destination, "learning.sqlite"))
    try {
      const store = new Store(action), learning = new Learning(derived, store, action)
      expect(learning.automatic.history.retrospectivePopulation(f.frozen.population_id, actor.session_id)).toEqual(f.frozen)
      expect(learning.automatic.history.freezeRetrospective({ ...actor, agent: "after-restore" }, f.frozen.manifest)).toEqual(f.frozen)
      expect(learning.automatic.history.retrospectiveSources(f.frozen.population_id, actor.session_id).member_count).toBe(107)
      expect(learning.automatic.history.list(actor.session_id).items).toEqual([])
    } finally { derived.close(true); action.close(true) }
  } finally { f.close() }
})

test("paired backup preserves distinct native message identities for a repeated call ID", () => {
  const f = fixture(manifest => ({ ...manifest,
    coverage: { objectives: 1, originals: 0, unresolved_native_sources: 2 },
    members: manifest.members.slice(0, 2).map((member, index) => {
      const source = { kind: "native-call", id: "same-call", session_id: "initial", message_id: "message-" + index, required: true }
      return { ...member, source, availability: "unresolved", permitted_view: "native-tool-call",
        key: retrospectiveMemberKey(manifest.source_store_id, source, "native-tool-call") }
    }),
  }))
  try {
    const original = files(f.source)
    ok(f.run("backup")); ok(f.run("restore"))
    expect(files(f.source)).toEqual(original)
    expect(files(f.destination)).toEqual(original)
    const action = new Database(join(f.destination, "ledger.sqlite")), derived = new Database(join(f.destination, "learning.sqlite"))
    try {
      const store = new Store(action), learning = new Learning(derived, store, action)
      const restored = learning.automatic.history.retrospectivePopulation(f.frozen.population_id, actor.session_id)
      expect(restored).toEqual(f.frozen)
      expect(new Set(restored.manifest.members.map(member => member.key)).size).toBe(2)
      expect(restored.manifest.members.map(member => member.source.message_id).sort()).toEqual(["message-0", "message-1"])
    } finally { derived.close(true); action.close(true) }
  } finally { f.close() }
})

for (const [name, sql, phrase] of [
  ["missing member table", "DROP TABLE learning_retrospective_members", "learning_retrospective_members"],
  ["missing schema", "DROP TABLE learning_retrospective_schema", "learning_retrospective_schema"],
  ["missing marker", "DELETE FROM learning_retrospective_schema", "retrospective population schema marker"],
  ["future schema", "DROP TABLE learning_retrospective_schema; CREATE TABLE learning_retrospective_schema(singleton INTEGER,version INTEGER); INSERT INTO learning_retrospective_schema VALUES(1,2)", "retrospective population schema version"],
  ["missing column", "ALTER TABLE learning_retrospective_members RENAME COLUMN ordinal TO lost_ordinal", "ordinal"],
  ["missing member", "DELETE FROM learning_retrospective_members WHERE ordinal=3", "frozen membership"],
  ["broken ordinals", "UPDATE learning_retrospective_members SET ordinal=500 WHERE ordinal=3", "frozen ordinals"],
  ["changed relationship", "UPDATE learning_retrospective_members SET data_json=json_set(data_json,'$.basis[0].meaning','observed') WHERE ordinal=3", "digest mismatch"],
  ["changed question", "UPDATE learning_retrospective_populations SET header_json=json_set(header_json,'$.selection.question','different question')", "digest mismatch"],
  ["wrong version", "UPDATE learning_retrospective_members SET data_json=json_set(data_json,'$.source.revision','different-version') WHERE ordinal=3", "source identity"],
  ["invalid availability", "UPDATE learning_retrospective_members SET data_json=json_set(data_json,'$.availability','secretly-authorized') WHERE ordinal=3", "member source"],
  ["wrong private flag", "UPDATE learning_retrospective_populations SET contains_private_reviews=1", "private-source metadata"],
  ["message identity on a ledger source", "UPDATE learning_retrospective_members SET data_json=json_set(data_json,'$.source.message_id','message-1') WHERE ordinal=3", "native-call message identity"],
  ["native message without a source Session", "UPDATE learning_retrospective_members SET data_json=json_remove(json_set(data_json,'$.source.kind','native-call','$.source.message_id','message-1'),'$.source.session_id') WHERE ordinal=3", "native-call message identity"],
  ["native call without a source message", "UPDATE learning_retrospective_members SET data_json=json_set(data_json,'$.source.kind','native-call') WHERE ordinal=3", "native-call message identity"],
] as const) test("backup independently refuses " + name, () => {
  const f = fixture()
  try {
    alter(f.source, sql)
    const original = files(f.source), result = f.run("backup")
    expect(result.exitCode).not.toBe(0)
    expect(result.stderr.toString()).toContain(phrase)
    expect(existsSync(join(f.backup, "loom-state-manifest.json"))).toBe(false)
    expect(files(f.source)).toEqual(original)
  } finally { f.close() }
})

test("matching outer backup hashes do not launder incomplete retrospective membership", () => {
  const f = fixture()
  try {
    ok(f.run("backup"))
    alter(f.backup, "DELETE FROM learning_retrospective_members WHERE ordinal=3")
    const path = join(f.backup, "loom-state-manifest.json"), manifest = JSON.parse(readFileSync(path, "utf8"))
    manifest.files = files(f.backup)
    writeFileSync(path, JSON.stringify(manifest))
    const preserved = files(f.backup), result = f.run("restore")
    expect(result.exitCode).not.toBe(0)
    expect(result.stderr.toString()).toContain("frozen membership")
    expect(existsSync(f.destination)).toBe(false)
    expect(files(f.backup)).toEqual(preserved)
  } finally { f.close() }
})

for (const operation of ["backup", "restore"] as const) test(operation + " refuses populations paired with a different valid ledger owner", () => {
  const f = fixture(), other = fixture()
  try {
    if (operation === "restore") ok(f.run("backup"))
    const directory = operation === "backup" ? f.source : f.backup
    // Both databases are independently valid. Replacing the ledger with a
    // different complete owner must not certify this mixed pair as recoverable.
    copyFileSync(join(other.source, "ledger.sqlite"), join(directory, "ledger.sqlite"))
    if (operation === "restore") {
      const path = join(f.backup, "loom-state-manifest.json"), manifest = JSON.parse(readFileSync(path, "utf8"))
      manifest.files = files(f.backup)
      writeFileSync(path, JSON.stringify(manifest))
    }
    const preserved = files(directory), result = f.run(operation)
    expect(result.exitCode).not.toBe(0)
    expect(result.stderr.toString()).toContain("Retrospective source namespace does not match paired ledger")
    expect(existsSync(operation === "backup" ? join(f.backup, "loom-state-manifest.json") : f.destination)).toBe(false)
    expect(files(directory)).toEqual(preserved)
  } finally { other.close(); f.close() }
})

test("a retained retrospective preparation prevents treating lost population tables as legacy state", () => {
  const f = fixture()
  try {
    const db = new Database(join(f.source, "learning.sqlite")), action = new Database(join(f.source, "ledger.sqlite"))
    try {
      const store = new Store(action), learning = new Learning(db, store, action)
      learning.automatic.history.freeze({ owner_session: actor.session_id, scope_key: "evaluator-preparation/retrospective",
        source_store_id: store.reviews.storeID, boundary: { retrospective_population_id: f.frozen.population_id },
        method: { id: "test", instruction_sha256: "a".repeat(64) }, members: [{ key: "objective", kind: "objective", source_refs: [] }] })
    } finally { db.close(true); action.close(true) }
    alter(f.source, "DROP TABLE learning_retrospective_members; DROP TABLE learning_retrospective_populations; DROP TABLE learning_retrospective_schema")
    const result = f.run("backup")
    expect(result.exitCode).not.toBe(0)
    expect(result.stderr.toString()).toContain("Missing required learning_retrospective_ tables")
  } finally { f.close() }
})
