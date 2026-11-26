import { expect, test } from "bun:test"
import { Database } from "bun:sqlite"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { EvaluationStore } from "../src/evaluation-store.js"
import { parseRetrospectiveManifest, retrospectiveDigest, retrospectiveMemberKey } from "../src/retrospective-contract.js"
import type { SQL } from "../src/store.js"
import { retrospectiveActor as actor, retrospectiveFixture as manifest } from "./helpers/retrospective-store-fixture.js"

function fixture(run: (store: EvaluationStore, db: Database) => void) {
  const db = new Database(":memory:")
  try { run(new EvaluationStore(db, () => { throw new Error("No synchronous source authorization") }), db) }
  finally { db.close() }
}
const rows = (db: Database) => db.query("SELECT COUNT(*) AS n FROM learning_retrospective_populations").get()

test("retrospective preview parsing and lookup never initialize persistence", () => fixture((store, db) => {
  const proposed = parseRetrospectiveManifest(manifest()), hash = retrospectiveDigest(proposed)
  expect(store.findRetrospective(hash, actor.session_id)).toBeNull()
  expect(() => store.retrospectivePopulation("missing", actor.session_id)).toThrow("unavailable")
  expect(db.query("SELECT name FROM sqlite_schema WHERE name GLOB 'learning_retrospective_*'").all()).toEqual([])
}))

test("freeze owns a canonical complete population independent of source availability and callback", () => fixture((store, db) => {
  const input = manifest(107), saved = store.freezeRetrospective(actor, input)
  input.members.length = 0
  expect(saved.manifest.members).toHaveLength(107)
  expect(saved.manifest.coverage.objectives).toBe(1)
  const recovered = new EvaluationStore(db, () => false).retrospectivePopulation(saved.population_id, actor.session_id)
  expect(recovered).toEqual(saved)
  expect(store.retrospectiveSources(saved.population_id, actor.session_id)).toMatchObject({ member_count: 107,
    contributors: ["correction", "initial", "verification"], contains_private_reviews: false })
  expect(store.list(actor.session_id).items).toEqual([])
  expect(db.query("SELECT COUNT(*) AS n FROM learning_evaluation_batches").get()).toEqual({ n: 0 })
}))

test("equivalent order and retrying investigator agent preserve initial freeze identity", () => fixture((store, db) => {
  const first = store.freezeRetrospective(actor, manifest())
  const reordered = manifest(); reordered.members.reverse(); reordered.contributors.reverse()
  expect(store.freezeRetrospective({ ...actor, agent: "recovery" }, reordered)).toEqual(first)
  expect(first.frozen_by).toEqual(actor)
  expect(store.findRetrospective(first.manifest_sha256, actor.session_id)?.population_id).toBe(first.population_id)
  expect(store.findRetrospective(first.manifest_sha256, "foreign")).toBeNull()
  expect(rows(db)).toEqual({ n: 1 })
}))

test("question, source versions, scope, qualifications and relationship basis participate in identity", () => fixture(store => {
  const original = store.freezeRetrospective(actor, manifest())
  for (const change of [
    (input: ReturnType<typeof manifest>) => { input.selection.question = "Is release acceptance established?" },
    (input: ReturnType<typeof manifest>) => { input.selection.owner_boundary.objective_links = (input.selection.owner_boundary.objective_links ?? 0) + 1 },
    (input: ReturnType<typeof manifest>) => { input.members[0]!.qualifications.push("missing-original") },
    (input: ReturnType<typeof manifest>) => { input.members[0]!.basis.push({ kind: "contradicts", meaning: "candidate" }) },
    (input: ReturnType<typeof manifest>) => { const member = input.members[0]!; member.source.revision = "99";
      member.key = retrospectiveMemberKey(member.source_store_id, member.source, member.permitted_view) },
  ]) {
    const input = manifest(); change(input)
    expect(store.freezeRetrospective(actor, input).population_id).not.toBe(original.population_id)
    expect(store.retrospectivePopulation(original.population_id, actor.session_id)).toEqual(original)
  }
}))

test("foreign owner and missing identity have the same unavailable result", () => fixture(store => {
  const saved = store.freezeRetrospective(actor, manifest())
  expect(() => store.retrospectiveSources(saved.population_id, "foreign")).toThrow("Retrospective population unavailable")
  expect(() => store.retrospectivePopulation(saved.population_id, "foreign")).toThrow("Retrospective population unavailable")
  expect(() => store.retrospectivePopulation("missing", "foreign")).toThrow("Retrospective population unavailable")
}))

test("duplicate evidence and incorrect identity or view cannot enter persistence", () => fixture(store => {
  for (const change of [
    (input: ReturnType<typeof manifest>) => { input.members.push(input.members[0]!) },
    (input: ReturnType<typeof manifest>) => { input.members[0]!.source.sha256 = "wrong" },
    (input: ReturnType<typeof manifest>) => { input.members[0]!.source.sha256 = "b".repeat(64) },
    (input: ReturnType<typeof manifest>) => { input.members[0]!.permitted_view = "native-input" },
    (input: ReturnType<typeof manifest>) => { input.members[0]!.source_store_id = "foreign" },
    (input: ReturnType<typeof manifest>) => { input.contributors = ["initial"] },
  ]) {
    const input = manifest(); change(input)
    expect(() => store.freezeRetrospective(actor, input)).toThrow()
  }
}))

for (const damage of ["missing-row", "wrong-ordinal", "altered-basis", "changed-header", "wrong-source-version", "changed-contributor", "private-flag", "changed-freezer", "changed-timestamp"] as const) {
  test("retained population detects " + damage, () => fixture((store, db) => {
    const saved = store.freezeRetrospective(actor, manifest()), first = saved.manifest.members[0]!
    if (damage === "missing-row") db.query("DELETE FROM learning_retrospective_members WHERE population_id=? AND key=?").run(saved.population_id, first.key)
    else if (damage === "wrong-ordinal") db.query("UPDATE learning_retrospective_members SET ordinal=999 WHERE population_id=? AND key=?").run(saved.population_id, first.key)
    else if (damage === "changed-header") db.query("UPDATE learning_retrospective_populations SET header_json=json_set(header_json,'$.selection.question','altered') WHERE id=?").run(saved.population_id)
    else if (damage === "changed-contributor") db.query("UPDATE learning_retrospective_populations SET contributors_json='[]' WHERE id=?").run(saved.population_id)
    else if (damage === "private-flag") db.query("UPDATE learning_retrospective_populations SET contains_private_reviews=1 WHERE id=?").run(saved.population_id)
    else if (damage === "changed-freezer") db.query("UPDATE learning_retrospective_populations SET owner_agent='forged' WHERE id=?").run(saved.population_id)
    else if (damage === "changed-timestamp") db.query("UPDATE learning_retrospective_populations SET created_at='2000-01-01T00:00:00.000Z' WHERE id=?").run(saved.population_id)
    else db.query("UPDATE learning_retrospective_members SET data_json=json_set(data_json,?,?) WHERE population_id=? AND key=?")
      .run(damage === "altered-basis" ? "$.basis[0].meaning" : "$.source.revision", damage === "altered-basis" ? "observed" : "999", saved.population_id, first.key)
    expect(() => store.retrospectivePopulation(saved.population_id, actor.session_id)).toThrow()
    expect(() => store.freezeRetrospective(actor, manifest())).toThrow()
  }))
}

test("one failed member insert rolls back the complete freeze and permits faithful retry", () => fixture((store, db) => {
  const prior = store.freezeRetrospective(actor, manifest())
  db.exec("CREATE TRIGGER stop_retrospective BEFORE INSERT ON learning_retrospective_members WHEN NEW.ordinal=2 BEGIN SELECT RAISE(ABORT,'population fault'); END")
  expect(() => store.freezeRetrospective(actor, manifest(9))).toThrow("population fault")
  expect(rows(db)).toEqual({ n: 1 })
  expect(store.retrospectivePopulation(prior.population_id, actor.session_id)).toEqual(prior)
  db.exec("DROP TRIGGER stop_retrospective")
  expect(store.freezeRetrospective(actor, manifest(9)).manifest.members).toHaveLength(9)
}))

test("lost durable COMMIT acknowledgement replays the same population", () => {
  const db = new Database(":memory:"); let lose = false
  const sql: SQL = { prepare: query => db.prepare(query), exec(query) { const result = db.exec(query)
    if (lose && query === "COMMIT") { lose = false; throw new Error("lost acknowledgement") }; return result } }
  try {
    const store = new EvaluationStore(sql, () => false)
    lose = true
    expect(() => store.freezeRetrospective(actor, manifest())).toThrow("lost acknowledgement")
    const saved = store.freezeRetrospective(actor, manifest())
    expect(new EvaluationStore(db, () => false).retrospectivePopulation(saved.population_id, actor.session_id)).toEqual(saved)
    expect(rows(db)).toEqual({ n: 1 })
  } finally { db.close() }
})

for (const mode of ["during-members", "after-commit"] as const) test("SIGKILL " + mode + " retains all-or-nothing identity across process restart", () => {
  const directory = mkdtempSync(join(tmpdir(), "loom-retrospective-crash-")), path = join(directory, "learning.sqlite")
  const script = new URL("./helpers/retrospective-store-process.ts", import.meta.url).pathname
  try {
    const killed = Bun.spawnSync([process.execPath, script, path, mode])
    expect(killed.signalCode).toBe("SIGKILL")
    const recovered = Bun.spawnSync([process.execPath, script, path, "freeze"])
    expect(recovered.exitCode).toBe(0)
    const saved = JSON.parse(recovered.stdout.toString())
    const reread = Bun.spawnSync([process.execPath, script, path, "read", saved.population_id])
    expect(reread.exitCode).toBe(0)
    expect(JSON.parse(reread.stdout.toString())).toEqual(saved)
    const db = new Database(path)
    try { expect(rows(db)).toEqual({ n: 1 }); expect(db.query("SELECT COUNT(*) AS n FROM learning_retrospective_members").get()).toEqual({ n: 7 }) }
    finally { db.close(true) }
  } finally { rmSync(directory, { recursive: true, force: true }) }
})

test("damaged optional schema refuses populations while legacy Stage 3 stays available", () => fixture((store, db) => {
  store.freezeRetrospective(actor, manifest())
  db.exec("DROP TABLE learning_retrospective_schema")
  expect(() => store.freezeRetrospective(actor, manifest())).toThrow("schema")
  const legacy = store.freeze({ owner_session: actor.session_id, scope_key: "permitted-session-evidence", source_store_id: "source-store",
    boundary: { ledger: 0 }, method: { id: "descriptive", instruction_sha256: "a".repeat(64) },
    members: [{ key: "legacy", kind: "session", source_refs: [] }] })
  expect(new EvaluationStore(db, () => false).get(legacy.id, actor.session_id).member_count).toBe(1)
}))

test("retrospective preparation integrity never weakens legacy complete-original validation", () => fixture(store => {
  const saved = store.freezeRetrospective(actor, manifest())
  const input = { owner_session: actor.session_id, scope_key: "evaluator-preparation/retrospective", source_store_id: "source-store",
    boundary: { retrospective_population_id: saved.population_id }, method: { id: "evaluator/test", instruction_sha256: "a".repeat(64) },
    members: [{ key: "objective", kind: "objective" as const, source_refs: saved.manifest.members.map(member => member.source) }] }
  const prepared = store.freeze(input)
  expect(store.frozenPreparationPopulation(prepared.id, actor.session_id).members).toHaveLength(1)
  expect(() => store.preparationPopulation(prepared.id, actor.session_id)).toThrow("unavailable")
  const legacy = store.freeze({ ...input, scope_key: "evaluator-preparation/calling-session" })
  expect(() => store.frozenPreparationPopulation(legacy.id, actor.session_id)).toThrow("unavailable")
  expect(() => store.preparationPopulation(legacy.id, actor.session_id)).toThrow("unavailable")
}))

test("multiple preparation exclusions apply before Stage 3 inventory pagination", () => fixture(store => {
  const input = { owner_session: actor.session_id, scope_key: "permitted-session-evidence", source_store_id: "source-store",
    boundary: { ledger: 1 }, method: { id: "test", instruction_sha256: "a".repeat(64) },
    members: [{ key: "original", kind: "session" as const, source_refs: [] }] }
  const first = store.freeze(input)
  store.freeze({ ...input, scope_key: "evaluator-preparation/calling-session" })
  const second = store.freeze({ ...input, boundary: { ledger: 2 } })
  const retrospective = store.freeze({ ...input, scope_key: "evaluator-preparation/retrospective" })
  const exclude = ["evaluator-preparation/calling-session", "evaluator-preparation/retrospective"]
  const page = store.list(actor.session_id, { limit: 1, exclude_scope: exclude })
  expect(page.items.map(item => item.id)).toEqual([second.id])
  expect(page.next_before).toBe(second.sequence)
  expect(store.list(actor.session_id, { limit: 1, exclude_scope: exclude, before: page.next_before! })).toMatchObject({ items: [{ id: first.id }], next_before: null })
  expect(store.list(actor.session_id, { exclude_scope: "evaluator-preparation/calling-session" }).items.map(item => item.id))
    .toEqual([retrospective.id, second.id, first.id])
  expect(store.list(actor.session_id, { exclude_scope: [] }).items).toHaveLength(4)
}))
