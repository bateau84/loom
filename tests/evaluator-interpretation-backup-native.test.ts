import { expect, test } from "bun:test"
import { Database } from "bun:sqlite"
import { createHash } from "node:crypto"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { EvaluatorExecution } from "../src/evaluator-execution.js"
import { canonical, digest } from "../src/model.js"
import { ACTOR, NOW, openState, pins, type FixtureState } from "./helpers/evaluator-execution-fixture.js"
import { publicationFixture } from "./helpers/evaluator-publication-fixture.js"

const command = new URL("../tools/learning-state-backup.py", import.meta.url).pathname
const sha = (value: string | Uint8Array) => createHash("sha256").update(value).digest("hex")
const files = (directory: string) => Object.fromEntries(readdirSync(directory).filter(name => name !== "loom-state-manifest.json").sort()
  .map(name => [name, { size: statSync(join(directory, name)).size, sha256: sha(readFileSync(join(directory, name))) }]))

async function fixture(published = true) {
  const root = mkdtempSync(join(tmpdir(), "loom-interpretation-backup-")), project = join(root, "project")
  mkdirSync(project)
  const source = join(root, digest({ project: "interpretation-backup", canonical: project })), state = openState(source)
  const publication = publicationFixture(state, ACTOR, { authorityPath: join(root, "authority.sqlite") })
  try {
    await publication.execute()
    if (published) await publication.publish()
  } catch (error) {
    state.close(); publication.close(); rmSync(root, { recursive: true, force: true }); throw error
  }
  const expected = state.learning.automatic.history.readEvaluatorInterpretation(publication.prepared.batch_id, ACTOR.session_id)
  state.close()
  const backup = join(root, "backup"), restoredParent = join(root, "restored")
  mkdirSync(restoredParent)
  const destination = join(restoredParent, source.slice(source.lastIndexOf("/") + 1))
  const settings = ["--project-id", "interpretation-backup", "--project-canonical", project,
    "--loom-revision", "389598a0d88645a76c6ef77b91eb060a721e7607", "--package-version", "2.0.0-alpha.1"]
  const run = (operation: "backup" | "restore") => Bun.spawnSync(["python3", command, operation,
    ...(operation === "backup" ? ["--source-dir", source, "--backup-dir", backup]
      : ["--backup-dir", backup, "--destination-dir", destination]), ...settings],
    { env: { ...process.env, LOOM_WRITERS_STOPPED: "yes" } })
  const runtime = (current: FixtureState) => new EvaluatorExecution(current.learning.evaluator, current.learning.automatic.history, current.store, {
    authority: publication.authority, authorize: publication.authorize,
    retrospective: { populations: current.learning.populations, authorize: publication.authorize, resolve: async request => {
      await publication.authorize()
      const ref = request.source
      const original = current.learning.automatic.sources.retrospectiveOriginal(ref.kind, ref.id, ref.session_id!, request.recipient_session_id)
      return original ? { ...request, source: original.ref, status: "available", value: original.value } : { ...request, status: "missing" }
    } },
  }, () => NOW)
  return { ...publication, root, source, backup, destination, expected, run, runtime,
    close() { publication.close(); rmSync(root, { recursive: true, force: true }) } }
}

function ok(result: ReturnType<Awaited<ReturnType<typeof fixture>>["run"]>) {
  if (result.exitCode !== 0) throw new Error(result.stderr.toString())
}

function rehashReports(db: Database, batchID: string, rebindCheckpoints = true) {
  const rows = db.query("SELECT id,member_key,body_json,qualifications_json FROM learning_evaluation_reports WHERE batch_id=? ORDER BY member_key")
    .all(batchID) as Array<{ id: string; member_key: string | null; body_json: string; qualifications_json: string }>
  let overall = ""
  for (const row of rows) {
    const body = JSON.parse(row.body_json)
    if (row.member_key !== null && rebindCheckpoints) body.report_sha256 = overall
    const source_refs = (db.query("SELECT source_ref FROM learning_evaluation_dependencies WHERE report_id=? ORDER BY source_key")
      .all(row.id) as Array<{ source_ref: string }>).map(item => JSON.parse(item.source_ref))
    const checksum = digest({ batch_id: batchID, member_key: row.member_key, body,
      qualifications: JSON.parse(row.qualifications_json), source_refs })
    db.query("UPDATE learning_evaluation_reports SET body_json=?,sha256=? WHERE id=?").run(canonical(body), checksum, row.id)
    if (row.member_key === null) overall = checksum
  }
}

function rehashBackup(directory: string) {
  const path = join(directory, "loom-state-manifest.json"), manifest = JSON.parse(readFileSync(path, "utf8"))
  manifest.files = files(directory)
  writeFileSync(path, JSON.stringify(manifest))
}

test("stopped backup restores the actual consumer publication and every checkpoint without another inference", async () => {
  const f = await fixture()
  try {
    const original = files(f.source)
    ok(f.run("backup")); ok(f.run("restore"))
    expect(files(f.source)).toEqual(original)
    expect(files(f.destination)).toEqual(original)
    const restored = openState(f.destination)
    try {
      const before = f.base.counts(), outcome = await f.runtime(restored).publish(ACTOR, pins(f.prepared))
      const recovered = restored.learning.automatic.history.readEvaluatorInterpretation(f.prepared.batch_id, ACTOR.session_id)!
      expect(recovered.report.id).toBe(f.expected!.report.id)
      expect(recovered.report.sha256).toBe(f.expected!.report.sha256)
      expect(recovered.report.body).toEqual(f.expected!.report.body)
      expect(outcome).toMatchObject({ report_id: recovered.report.id, report_sha256: recovered.report.sha256 })
      expect(restored.derived.query("SELECT COUNT(*) AS n FROM learning_evaluation_reports WHERE batch_id=?").get(f.prepared.batch_id))
        .toEqual({ n: f.population.manifest.members.length + 1 })
      expect(f.base.counts()).toEqual(before)
      expect(before.effects).toBe(1)
    } finally { restored.close() }
  } finally { f.close() }
})

test("restoring a snapshot before publication recovers the original result into the same durable report identity", async () => {
  const f = await fixture(false)
  try {
    expect(f.expected).toBeNull()
    ok(f.run("backup"))
    const original = openState(f.source)
    let published: Awaited<ReturnType<EvaluatorExecution["publish"]>>
    try { published = await f.runtime(original).publish(ACTOR, pins(f.prepared)) }
    finally { original.close() }
    const counts = f.base.counts(), sourceBytes = files(f.source)
    ok(f.run("restore"))
    const restored = openState(f.destination)
    try {
      expect(restored.learning.automatic.history.readEvaluatorInterpretation(f.prepared.batch_id, ACTOR.session_id)).toBeNull()
      const replay = await f.runtime(restored).publish(ACTOR, pins(f.prepared))
      expect(replay.report_id).toBe(published.report_id)
      expect(replay.report_sha256).toBe(published.report_sha256)
      expect(f.base.counts()).toEqual(counts)
      expect(counts).toEqual({ reservations: 1, consumed: 1, execute_calls: 1, effects: 1 })
    } finally { restored.close() }
    expect(files(f.source)).toEqual(sourceBytes)
  } finally { f.close() }
})

for (const damage of ["substituted interpretation", "omitted uncited dependency", "omitted checkpoint parent", "changed checkpoint parent checksum"] as const)
  test("restore rejects checksum-consistent " + damage + " before creating a destination", async () => {
    const f = await fixture()
    try {
      ok(f.run("backup"))
      const db = new Database(join(f.backup, "learning.sqlite"))
      try {
        if (damage === "substituted interpretation") {
          const body = structuredClone(f.expected!.report.body)
          body.interpretation.claims[0]!.statement = "Rehashed unsupported replacement conclusion"
          db.query("UPDATE learning_evaluation_reports SET body_json=? WHERE id=?").run(canonical(body), f.expected!.report.id)
        } else if (damage === "omitted uncited dependency") {
          const uncited = f.population.manifest.members.find(member => member.key !== f.retrieved[0]!.member_key)!
          db.query("DELETE FROM learning_evaluation_dependencies WHERE json_extract(source_ref,'$.id')=?").run(uncited.source.id)
        } else {
          const checkpoint = db.query("SELECT id,body_json FROM learning_evaluation_reports WHERE batch_id=? AND member_key IS NOT NULL LIMIT 1")
            .get(f.prepared.batch_id) as { id: string; body_json: string }
          const body = JSON.parse(checkpoint.body_json)
          if (damage === "omitted checkpoint parent") delete body.report_id
          else body.report_sha256 = "f".repeat(64)
          db.query("UPDATE learning_evaluation_reports SET body_json=? WHERE id=?").run(canonical(body), checkpoint.id)
        }
        rehashReports(db, f.prepared.batch_id, !damage.includes("checkpoint parent"))
      } finally { db.close(true) }
      rehashBackup(f.backup)
      const bytes = files(f.backup), result = f.run("restore")
      expect(result.exitCode).not.toBe(0)
      const reason = damage === "substituted interpretation" ? "differs from original execution result"
        : damage === "omitted uncited dependency" ? "source dependency union mismatch" : "member checkpoint binding mismatch"
      expect(result.stderr.toString()).toContain(reason)
      expect(existsSync(f.destination)).toBe(false)
      expect(files(f.backup)).toEqual(bytes)
      expect(f.base.counts().effects).toBe(1)
    } finally { f.close() }
  })
