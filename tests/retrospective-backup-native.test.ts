import { expect, spyOn, test } from "bun:test"
import { Database } from "bun:sqlite"
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs"
import { createHash } from "node:crypto"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Learning } from "../src/learning.js"
import { Store } from "../src/store.js"
import { canonical, digest } from "../src/model.js"
import type { EvaluationMember } from "../src/evaluation-store.js"
import { retrospectiveMemberKey, type RetrospectiveManifest } from "../src/retrospective-contract.js"
import { retrospectiveActor as actor, retrospectiveFixture } from "./helpers/retrospective-store-fixture.js"
import { method, openState, POLICY, type FixtureState } from "./helpers/evaluator-execution-fixture.js"

const command = new URL("../tools/learning-state-backup.py", import.meta.url).pathname
const sha = (value: string | Uint8Array) => createHash("sha256").update(value).digest("hex")
const files = (directory: string) => Object.fromEntries(readdirSync(directory).filter(name => name !== "loom-state-manifest.json").sort()
  .map(name => [name, { size: statSync(join(directory, name)).size, sha256: sha(readFileSync(join(directory, name))) }]))

function fixture(prepare: (manifest: RetrospectiveManifest, learning: Learning, store: Store) => RetrospectiveManifest = value => value) {
  const root = mkdtempSync(join(tmpdir(), "loom-retrospective-backup-")), project = join(root, "project")
  const source = join(root, digest({ project: "retrospective-backup", canonical: project }))
  mkdirSync(project); mkdirSync(source)
  const action = new Database(join(source, "ledger.sqlite")), derived = new Database(join(source, "learning.sqlite"))
  let frozen
  try {
    const store = new Store(action), learning = new Learning(derived, store, action)
    frozen = learning.automatic.history.freezeRetrospective(actor, prepare(retrospectiveFixture(107, store.reviews.storeID), learning, store))
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

function originalManifest(learning: Learning, store: Store, objective: string, count = 7) {
  const manifest = retrospectiveFixture(count, store.reviews.storeID)
  manifest.selection.objective_id = objective
  manifest.selection.question = "Evaluate the controlled " + objective + " objective"
  manifest.objective.id = objective
  manifest.coverage.unresolved_native_sources = 0
  manifest.members = manifest.members.map(member => {
    const record = store.record({ session_id: member.source.session_id!, agent: "worker" }, undefined,
      { kind: "result", statement: objective + " original " + member.source.id })
    const source = learning.automatic.sources.retrospectiveOriginal("ledger-record", record.id, record.session_id, actor.session_id)
    if (!source) throw new Error("Controlled original unavailable")
    return { ...member, source: source.ref, key: retrospectiveMemberKey(manifest.source_store_id, source.ref, member.permitted_view) }
  })
  return manifest
}

function preparedFixture(count = 7) {
  const f = fixture((_manifest, learning, store) => originalManifest(learning, store, "objective-a", count))
  const state = openState(f.source)
  try {
    const other = state.learning.automatic.history.freezeRetrospective(actor, originalManifest(state.learning, state.store, "objective-b", count))
    const prepared = state.learning.evaluator.prepareRetrospective(actor, f.frozen, method(), POLICY)
    const otherPrepared = state.learning.evaluator.prepareRetrospective(actor, other, method(), POLICY)
    return { ...f, other, prepared, otherPrepared }
  } catch (error) { state.close(); f.close(); throw error } finally { state.close() }
}

function rehashBackup(directory: string) {
  const path = join(directory, "loom-state-manifest.json"), manifest = JSON.parse(readFileSync(path, "utf8"))
  manifest.files = files(directory)
  writeFileSync(path, JSON.stringify(manifest))
}

test("paired backup and restore preserve two actual retrospective preparations and reconstruct their complete populations across pages", () => {
  const f = preparedFixture(107)
  try {
    const original = files(f.source)
    ok(f.run("backup")); ok(f.run("restore"))
    expect(files(f.source)).toEqual(original)
    expect(files(f.destination)).toEqual(original)
    const state = openState(f.destination)
    try {
      for (const [population, prepared] of [[f.frozen, f.prepared], [f.other, f.otherPrepared]] as const) {
        expect(state.learning.automatic.history.retrospectivePopulation(population.population_id, actor.session_id)).toEqual(population)
        expect(state.learning.evaluator.read(actor.session_id, prepared.batch_id)).toEqual(prepared)
        const members: EvaluationMember[] = []
        let after: number | null = 0, pages = 0
        do {
          const page = state.learning.evaluator.members(actor.session_id, prepared.batch_id, prepared.request_id, prepared.manifest_sha256, after, 25)
          expect(page.batch_id).toBe(prepared.batch_id)
          expect(page.manifest_sha256).toBe(prepared.manifest_sha256)
          members.push(...page.items.map(({ ordinal: _ordinal, ...member }) => member))
          after = page.next_after
          pages++
        } while (after !== null)
        expect(pages).toBe(5)
        expect(members).toEqual(population.manifest.members.map(member => ({ key: member.key, kind: "objective", source_refs: [member.source] })))
        const replay = state.learning.evaluator.prepareRetrospective({ ...actor, agent: "after-restore" }, population, method(), POLICY)
        expect(replay).toEqual(prepared)
        expect(replay.request.review_request.requester).toEqual(actor)
        expect(replay.issue?.attempt).toMatchObject({ state: "prepared", claimant_id: null, native_outcome: "not-issued" })
        expect(replay.automatic_model_calls).toBe(false)
      }
      expect(state.derived.query("SELECT COUNT(*) AS n FROM learning_evaluator_requests").get()).toEqual({ n: 2 })
      expect(state.ledger.query("SELECT COUNT(*) AS n FROM review_issue_intents").get()).toEqual({ n: 2 })
    } finally { state.close() }
  } finally { f.close() }
})

test("paired backup and restore preserve frozen preparation descriptors when originals change or disappear", () => {
  const f = preparedFixture(), changed = f.frozen.manifest.members[0]!.source, missing = f.frozen.manifest.members[1]!.source
  try {
    const ledger = new Database(join(f.source, "ledger.sqlite"))
    try {
      ledger.query("UPDATE ledger SET data=json_set(data,'$.data.statement','Changed after freezing') WHERE id=?").run(changed.id)
      ledger.query("DELETE FROM ledger WHERE id=?").run(missing.id)
    } finally { ledger.close(true) }
    const original = files(f.source)
    ok(f.run("backup")); ok(f.run("restore"))
    expect(files(f.source)).toEqual(original)
    expect(files(f.destination)).toEqual(original)
    const state = openState(f.destination)
    try {
      expect(state.learning.automatic.history.retrospectivePopulation(f.frozen.population_id, actor.session_id)).toEqual(f.frozen)
      expect(state.learning.evaluator.read(actor.session_id, f.prepared.batch_id)).toEqual(f.prepared)
      expect(state.learning.evaluator.read(actor.session_id, f.otherPrepared.batch_id)).toEqual(f.otherPrepared)
      const current = state.learning.automatic.sources.retrospectiveOriginal("ledger-record", changed.id, changed.session_id!, actor.session_id)
      expect(current).not.toBeNull()
      expect(current!.ref.sha256).not.toBe(changed.sha256)
      expect(state.learning.automatic.sources.retrospectiveOriginal("ledger-record", missing.id, missing.session_id!, actor.session_id)).toBeNull()
      // Offline recovery certifies the retained descriptors. It does not substitute
      // current originals, release source contents, or establish execution authority.
      expect(f.prepared.issue?.attempt).toMatchObject({ state: "prepared", claimant_id: null, native_outcome: "not-issued" })
    } finally { state.close() }
  } finally { f.close() }
})

for (const boundary of ["request mapping", "canonical review", "canonical issue", "final block"] as const)
  test("paired backup and restore allow preparation interrupted before " + boundary + " to replay its retained identity", () => {
    const f = fixture((_manifest, learning, store) => originalManifest(learning, store, "interrupted-objective"))
    let state = openState(f.source)
    try {
      const fail = () => { throw new Error("controlled interrupted " + boundary) }
      const fault = boundary === "request mapping" ? spyOn(state.learning.automatic.history, "prepareEvaluatorRequest").mockImplementation(fail)
        : boundary === "canonical review" ? spyOn(state.store.reviews, "freezeEvaluatorPreparation").mockImplementation(fail)
          : boundary === "canonical issue" ? spyOn(state.store.reviews, "prepareIssue").mockImplementation(fail)
            : spyOn(state.learning.automatic.history, "block").mockImplementation(fail)
      try { expect(() => state.learning.evaluator.prepareRetrospective(actor, f.frozen, method(), POLICY)).toThrow("controlled interrupted") }
      finally { fault.mockRestore() }
      const batches = state.learning.automatic.history.list(actor.session_id).items
      expect(batches).toHaveLength(1)
      const batch = batches[0]!
      const mapped = state.learning.automatic.history.readEvaluatorRequest(batch.id, actor.session_id)
      expect(mapped === null).toBe(boundary === "request mapping")
      expect(batch.blocked_reason).toBe(boundary === "request mapping" ? null : "evaluator-request-mapped")
      state.close()
      const original = files(f.source)
      ok(f.run("backup")); ok(f.run("restore"))
      expect(files(f.source)).toEqual(original)
      expect(files(f.destination)).toEqual(original)
      state = openState(f.destination)
      expect(state.learning.automatic.history.readEvaluatorRequest(batch.id, actor.session_id)).toEqual(mapped)
      expect(state.learning.automatic.history.retrospectivePopulation(f.frozen.population_id, actor.session_id)).toEqual(f.frozen)
      const replay = state.learning.evaluator.prepareRetrospective(actor, f.frozen, method(), POLICY)
      expect(replay.batch_id).toBe(batch.id)
      if (mapped) {
        expect(replay.request_id).toBe(mapped.request_id)
        expect(mapped.data).toEqual(replay.request)
      }
      expect(replay.request).toMatchObject({ format: "loom-evaluation-request/v2", source: {
        population_id: f.frozen.population_id, manifest_sha256: f.frozen.manifest_sha256 } })
      expect(replay.issue?.attempt).toMatchObject({ state: "prepared", claimant_id: null, native_outcome: "not-issued" })
      expect(replay.automatic_model_calls).toBe(false)
      expect(state.derived.query("SELECT COUNT(*) AS n FROM learning_evaluator_requests").get()).toEqual({ n: 1 })
      expect(state.ledger.query("SELECT COUNT(*) AS n FROM review_issue_intents").get()).toEqual({ n: 1 })
    } finally { state.close(); f.close() }
  })

for (const operation of ["backup", "restore"] as const) test(operation + " refuses a retained preparation whose complete population is missing while another prepared population survives", () => {
  const f = preparedFixture()
  try {
    if (operation === "restore") ok(f.run("backup"))
    const directory = operation === "backup" ? f.source : f.backup
    const db = new Database(join(directory, "learning.sqlite"))
    try {
      db.query("DELETE FROM learning_retrospective_members WHERE population_id=?").run(f.frozen.population_id)
      db.query("DELETE FROM learning_retrospective_populations WHERE id=?").run(f.frozen.population_id)
      expect(db.query("SELECT COUNT(*) AS n FROM learning_retrospective_populations").get()).toEqual({ n: 1 })
      expect(db.query("SELECT COUNT(*) AS n FROM learning_evaluator_requests").get()).toEqual({ n: 2 })
    } finally { db.close(true) }
    // Runtime already refuses A while B remains readable; recovery must agree.
    const state = openState(directory)
    try {
      expect(() => state.learning.evaluator.read(actor.session_id, f.prepared.batch_id)).toThrow()
      expect(state.learning.evaluator.read(actor.session_id, f.otherPrepared.batch_id)).toEqual(f.otherPrepared)
    } finally { state.close() }
    if (operation === "restore") rehashBackup(directory)
    const preserved = files(directory), result = f.run(operation)
    expect(result.exitCode).not.toBe(0)
    expect(result.stderr.toString().toLowerCase()).toContain("retrospective")
    expect(existsSync(operation === "backup" ? join(f.backup, "loom-state-manifest.json") : f.destination)).toBe(false)
    expect(files(directory)).toEqual(preserved)
  } finally { f.close() }
})

type PreparedState = ReturnType<typeof preparedFixture>
type RetrospectiveRequest = Extract<ReturnType<FixtureState["learning"]["evaluator"]["prepareRetrospective"]>["request"], { format: "loom-evaluation-request/v2" }>
type RequestEnvelope = { requester: typeof actor; data: RetrospectiveRequest }
function rewriteRequest(db: Database, batchID: string, change: (envelope: RequestEnvelope) => void) {
  const row = db.query("SELECT data_json FROM learning_evaluator_requests WHERE batch_id=?").get(batchID) as { data_json: string }
  const envelope = JSON.parse(row.data_json) as RequestEnvelope
  expect(envelope.data.format).toBe("loom-evaluation-request/v2")
  change(envelope)
  // Keep the request envelope checksum valid so a semantic mismatch must fail.
  db.query("UPDATE learning_evaluator_requests SET data_json=?,sha256=? WHERE batch_id=?")
    .run(canonical(envelope), digest(envelope), batchID)
}
function rehashMembers(db: Database, batchID: string) {
  const rows = db.query("SELECT key,kind,source_refs FROM learning_evaluation_members WHERE batch_id=? ORDER BY ordinal").all(batchID) as Array<{
    key: string; kind: EvaluationMember["kind"]; source_refs: string;
  }>
  const members = rows.map(row => ({ ...row, source_refs: JSON.parse(row.source_refs) }))
  db.query("UPDATE learning_evaluation_batches SET membership_sha256=? WHERE id=?").run(digest(members), batchID)
}
const preparationCorruptions: Array<[string, (db: Database, f: PreparedState) => void, number?]> = [
  ["batch bound to the other valid population", (db, f) => {
    db.query("UPDATE learning_evaluation_batches SET boundary_json=json_set(boundary_json,'$.retrospective_population',?) WHERE id=?")
      .run(f.other.population_id, f.prepared.batch_id)
  }],
  ["batch population digest mismatch", (db, f) => {
    db.query("UPDATE learning_evaluation_batches SET boundary_json=json_set(boundary_json,'$.retrospective_manifest',?) WHERE id=?")
      .run(f.other.manifest_sha256, f.prepared.batch_id)
  }],
  ["missing batch population reference", (db, f) => {
    db.query("UPDATE learning_evaluation_batches SET boundary_json=json_remove(boundary_json,'$.retrospective_population') WHERE id=?").run(f.prepared.batch_id)
  }],
  ["request bound to the other valid population", (db, f) => {
    rewriteRequest(db, f.prepared.batch_id, envelope => { envelope.data.source.population_id = f.other.population_id })
  }],
  ["request population digest mismatch", (db, f) => {
    rewriteRequest(db, f.prepared.batch_id, envelope => { envelope.data.source.manifest_sha256 = f.other.manifest_sha256 })
  }],
  ["request preparation digest replaced by population digest", (db, f) => {
    expect(f.prepared.manifest_sha256).not.toBe(f.frozen.manifest_sha256)
    rewriteRequest(db, f.prepared.batch_id, envelope => { envelope.data.manifest_sha256 = f.frozen.manifest_sha256 })
  }],
  ["batch owner mismatch", (db, f) => {
    db.query("UPDATE learning_evaluation_batches SET owner_session='unrelated-investigator' WHERE id=?").run(f.prepared.batch_id)
  }],
  ["request owner mismatch", (db, f) => {
    rewriteRequest(db, f.prepared.batch_id, envelope => {
      envelope.requester.session_id = "unrelated-investigator"
      envelope.data.review_request.requester.session_id = "unrelated-investigator"
    })
  }],
  ["batch source namespace mismatch", (db, f) => {
    db.query("UPDATE learning_evaluation_batches SET source_store_id='unrelated-store' WHERE id=?").run(f.prepared.batch_id)
  }],
  ["request source namespace mismatch", (db, f) => {
    rewriteRequest(db, f.prepared.batch_id, envelope => { envelope.data.source_store_id = "unrelated-store" })
  }],
  ["incomplete batch membership beyond one page with a recomputed membership checksum", (db, f) => {
    db.query("DELETE FROM learning_evaluation_members WHERE batch_id=? AND ordinal=?").run(f.prepared.batch_id, f.frozen.manifest.members.length)
    rehashMembers(db, f.prepared.batch_id)
  }, 107],
  ["changed batch source version with a recomputed membership checksum", (db, f) => {
    db.query("UPDATE learning_evaluation_members SET source_refs=json_set(source_refs,'$[0].revision','changed-version') WHERE batch_id=? AND ordinal=1").run(f.prepared.batch_id)
    rehashMembers(db, f.prepared.batch_id)
  }],
  ["changed batch source requiredness with a recomputed membership checksum", (db, f) => {
    db.query("UPDATE learning_evaluation_members SET source_refs=json_set(source_refs,'$[0].required',json('false')) WHERE batch_id=? AND ordinal=1").run(f.prepared.batch_id)
    rehashMembers(db, f.prepared.batch_id)
  }],
  ["changed batch member kind with a recomputed membership checksum", (db, f) => {
    db.query("UPDATE learning_evaluation_members SET kind='session' WHERE batch_id=? AND ordinal=1").run(f.prepared.batch_id)
    rehashMembers(db, f.prepared.batch_id)
  }],
  ["missing request mapping with a retained dispatch marker", (db, f) => {
    db.query("DELETE FROM learning_evaluator_requests WHERE batch_id=?").run(f.prepared.batch_id)
    expect(db.query("SELECT blocked_reason FROM learning_evaluation_batches WHERE id=?").get(f.prepared.batch_id))
      .toEqual({ blocked_reason: "evaluator-dispatch-unavailable" })
  }],
  ["missing request mapping with a retained mapped marker", (db, f) => {
    db.query("DELETE FROM learning_evaluator_requests WHERE batch_id=?").run(f.prepared.batch_id)
    db.query("UPDATE learning_evaluation_batches SET blocked_reason='evaluator-request-mapped' WHERE id=?").run(f.prepared.batch_id)
  }],
  ["retained v2 request hidden under a calling-session scope and legacy boundary", (db, f) => {
    db.query("UPDATE learning_evaluation_batches SET scope_key='evaluator-preparation/calling-session',boundary_json=? WHERE id=?")
      .run(canonical({ through: 7, preparation_source_batch: "legacy-source", preparation_budget_policy: digest(POLICY) }), f.prepared.batch_id)
  }],
]
for (const operation of ["backup", "restore"] as const) for (const [name, corrupt, count] of preparationCorruptions)
  test(operation + " refuses retrospective preparation with " + name, () => {
    const f = preparedFixture(count)
    try {
      if (operation === "restore") ok(f.run("backup"))
      const directory = operation === "backup" ? f.source : f.backup
      const db = new Database(join(directory, "learning.sqlite"))
      try { corrupt(db, f) } finally { db.close(true) }
      if (operation === "restore") rehashBackup(directory)
      const preserved = files(directory), result = f.run(operation)
      expect(result.exitCode).not.toBe(0)
      expect(result.stderr.toString().toLowerCase()).toContain("retrospective")
      expect(existsSync(operation === "backup" ? join(f.backup, "loom-state-manifest.json") : f.destination)).toBe(false)
      expect(files(directory)).toEqual(preserved)
    } finally { f.close() }
  })

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
    rehashBackup(f.backup)
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
    if (operation === "restore") rehashBackup(f.backup)
    const preserved = files(directory), result = f.run(operation)
    expect(result.exitCode).not.toBe(0)
    expect(result.stderr.toString()).toContain("Retrospective source namespace does not match paired ledger")
    expect(existsSync(operation === "backup" ? join(f.backup, "loom-state-manifest.json") : f.destination)).toBe(false)
    expect(files(directory)).toEqual(preserved)
  } finally { other.close(); f.close() }
})

for (const operation of ["backup", "restore"] as const) test(operation + " refuses to treat lost population tables with retained real preparations as legacy state", () => {
  const f = preparedFixture()
  try {
    if (operation === "restore") ok(f.run("backup"))
    const directory = operation === "backup" ? f.source : f.backup
    alter(directory, "DROP TABLE learning_retrospective_members; DROP TABLE learning_retrospective_populations; DROP TABLE learning_retrospective_schema")
    if (operation === "restore") rehashBackup(f.backup)
    const preserved = files(directory), result = f.run(operation)
    expect(result.exitCode).not.toBe(0)
    expect(result.stderr.toString()).toContain("Missing required learning_retrospective_ tables")
    expect(existsSync(operation === "backup" ? join(f.backup, "loom-state-manifest.json") : f.destination)).toBe(false)
    expect(files(directory)).toEqual(preserved)
  } finally { f.close() }
})
