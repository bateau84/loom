import { expect, test } from "bun:test"
import { Database } from "bun:sqlite"
import { Store, type RecordQuery, type SQL } from "../src/store.js"
import { PROCESSING_LIMITS, type LedgerRecord } from "../src/model.js"
import { sqliteConnection } from "../src/sqlite-connection.js"

const actor = { session_id: "parent", agent: "engineer" }
const child = { session_id: "participating-child", agent: "reviewer" }
const other = { session_id: "unrelated-child", agent: "reviewer" }

function fixture(run: (f: {
  store: Store; db: Database;
  tripwire: { enabled: boolean; forbidden: string[]; reads: number; afterCandidates?: () => void };
}) => void) {
  const db = new Database(":memory:"), original = sqliteConnection(db)
  const tripwire = { enabled: false, forbidden: [] as string[], reads: 0, afterCandidates: undefined as (() => void) | undefined }
  const inspect = (sql: string, value: unknown) => {
    if (!tripwire.enabled || !/\bledger\b/.test(sql)) return value
    tripwire.reads++
    const rows = Array.isArray(value) ? value : [value]
    for (const row of rows) {
      if (row && typeof row === "object" && ("data" in row || "source" in row)) throw new Error("Original body crossed the SQL driver")
      const text = JSON.stringify(row)
      if (tripwire.forbidden.some(secret => text?.includes(secret))) throw new Error("Unselected content crossed the SQL driver")
    }
    if (/^SELECT seq,octet_length/.test(sql)) {
      const after = tripwire.afterCandidates
      tripwire.afterCandidates = undefined
      after?.()
    }
    return value
  }
  const sql: SQL = {
    exec: text => { if (tripwire.enabled) throw new Error("A projection wrote state"); return original.exec(text) },
    prepare: text => {
      const statement = original.prepare(text)
      return {
        get: (...params) => inspect(text, statement.get(...params)),
        all: (...params) => inspect(text, statement.all(...params)) as unknown[],
        run: (...params) => { if (tripwire.enabled) throw new Error("A projection wrote state"); return statement.run(...params) },
      }
    },
  }
  try { run({ store: new Store(sql), db, tripwire }) } finally { db.close() }
}

function work(store: Store) {
  const action = store.create("Controlled historical work", "Inspect one correction", actor)
  store.savePlan(action.id, 0, [{ id: "fix", kind: "task", title: "Controlled correction" }])
  return { action_id: action.id, node_id: "fix" }
}
function dropJSONIndexes(db: Database) {
  // Corruption belongs only to this isolated fixture. Expression indexes would
  // otherwise reject malformed JSON before the public read could exercise it.
  const indexes = db.query("SELECT name,sql FROM sqlite_schema WHERE type='index' AND tbl_name='ledger'").all() as Array<{ name: string; sql: string | null }>
  for (const index of indexes) if (index.sql?.includes("json_")) {
    if (!/^[a-z_]+$/.test(index.name)) throw new Error("Unexpected fixture index")
    db.exec(`DROP INDEX ${index.name}`)
  }
}

test("record metadata uses SQL projections without materializing statements, payloads or artifact references", () => fixture(({ store, db, tripwire }) => {
  const focus = work(store)
  const observation = store.observe(child, focus, { tool: "test", output: "PRIVATE-TOOL-PAYLOAD" })
  const record = store.record(child, focus, { kind: "result", statement: "PRIVATE-STATEMENT-" + "x".repeat(12_000),
    evidence_ids: [observation.id], artifact_refs: ["https://example.test/PRIVATE-ARTIFACT-REFERENCE"] })
  const originalBytes = (db.query("SELECT octet_length(data) AS bytes FROM ledger WHERE id=?").get(record.id) as { bytes: number }).bytes
  tripwire.forbidden = ["PRIVATE-TOOL-PAYLOAD", "PRIVATE-STATEMENT", "PRIVATE-ARTIFACT-REFERENCE"]
  tripwire.enabled = true
  const page = store.records({ action_id: focus.action_id, projection: "metadata" })
  expect(tripwire.reads).toBeGreaterThan(0)
  expect(page.projection).toBe("metadata")
  expect(page.items).toHaveLength(2)
  expect(page.items[1]).toEqual({ sequence: 2, id: record.id, session_id: child.session_id, agent: child.agent,
    action_id: focus.action_id, node_id: focus.node_id, kind: "result", created_at: record.created_at,
    fingerprint: record.fingerprint, stored_bytes: originalBytes, evidence_count: 1, artifact_count: 1 })
  expect(page.items[0]).toMatchObject({ kind: "observation", evidence_count: 0, artifact_count: 0 })
  expect(page.items.every(item => !("data" in item) && !("statement" in item) && !("artifact_refs" in item))).toBe(true)
  expect(page.next_after).toBeNull()
}))

test("exact fields return only requested originals and identify absent fields without substituting a full record", () => fixture(({ store, tripwire }) => {
  const record = store.record(actor, undefined, { kind: "result", statement: "Original Æøå, 漢字, 😀\nstatement",
    artifact_refs: ["https://example.test/UNSELECTED-ARTIFACT"] })
  tripwire.forbidden = ["UNSELECTED-ARTIFACT"]
  tripwire.enabled = true
  const page = store.records({ session_id: actor.session_id, record_id: record.id, projection: "fields", fields: ["statement", "verdict"] })
  expect(page).toMatchObject({ projection: "fields", fields: ["statement", "verdict"], next_after: null })
  expect(page.items[0]!.data).toEqual({ statement: record.data.statement })
  expect(page.items[0]!.missing_fields).toEqual(["verdict"])
  expect(JSON.stringify(page)).not.toContain("agent-reported; not independently validated by Loom")
  expect(JSON.stringify(page)).not.toContain("UNSELECTED-ARTIFACT")
}))

test("exact reference fields retain original arrays and verification wording; default retrieval is unchanged", () => fixture(({ store }) => {
  const observed = store.observe(actor, undefined, { tool: "test" })
  const record = store.record(actor, undefined, { kind: "assessment", statement: "Original finding", verdict: "inconclusive",
    evidence_ids: [observed.id], artifact_refs: ["https://example.test/original", "https://example.test/other"] })
  const fields = store.records({ session_id: actor.session_id, record_id: record.id, projection: "fields",
    fields: ["evidence_ids", "artifact_refs", "verdict", "verification"] })
  expect(fields.items[0]!.data).toEqual({ evidence_ids: record.data.evidence_ids, artifact_refs: record.data.artifact_refs,
    verdict: "inconclusive", verification: record.data.verification })
  expect(fields.items[0]!.missing_fields).toEqual([])
  expect(store.records({ session_id: actor.session_id, record_id: record.id })).toEqual({ items: [{ sequence: 2, ...record }], next_after: null })
  expect(store.records({ session_id: actor.session_id, record_kinds: ["observation"] }).items).toEqual([{ sequence: 1, ...observed }])
}))

test("source Session filtering intersects an Action and never includes another Session or Action", () => fixture(({ store }) => {
  const focus = work(store), second = store.create("Other work", "Separate objective", actor)
  const selected = store.record(child, focus, { kind: "result", statement: "Selected correction" })
  const sameAction = store.record(other, focus, { kind: "result", statement: "Unrelated Session at the same revision" })
  const sameSession = store.record(child, { action_id: second.id }, { kind: "result", statement: "Separate Action" })
  const query = { action_id: focus.action_id, source_session_id: child.session_id, projection: "metadata" as const }
  expect(store.records(query).items.map(row => row.id)).toEqual([selected.id])
  expect(store.records({ ...query, record_id: sameAction.id }).items).toEqual([])
  expect(store.records({ ...query, record_id: sameSession.id }).items).toEqual([])
  expect(store.records({ session_id: actor.session_id, source_session_id: child.session_id, projection: "metadata" }).items.map(row => row.id))
    .toEqual([selected.id, sameSession.id])
  expect(store.records({ source_session_id: child.session_id }).items.map(row => row.id)).toEqual([selected.id, sameSession.id])
}))

test("exclusive after, inclusive through and kind filtering preserve complete sequence traversal across later arrivals", () => fixture(({ store }) => {
  const records: LedgerRecord[] = []
  for (let i = 0; i < 7; i++) records.push(store.record(actor, undefined, { kind: i % 2 ? "concern" : "result", statement: "Historical " + i }))
  const query = { session_id: actor.session_id, projection: "metadata" as const, record_kinds: ["result" as const], after: 1, through: 7, limit: 1 }
  const first = store.records(query)
  expect(first.items.map(row => row.sequence)).toEqual([3])
  expect(first.next_after).toBe(3)
  store.record(actor, undefined, { kind: "result", statement: "Later record must remain outside through" })
  const second = store.records({ ...query, after: first.next_after! })
  const third = store.records({ ...query, after: second.next_after! })
  expect(second.items.map(row => row.sequence)).toEqual([5])
  expect(third.items.map(row => row.sequence)).toEqual([7])
  expect(third.next_after).toBeNull()
  expect(store.records({ ...query, after: 7 }).items).toEqual([])
  expect(store.records({ ...query, record_id: records[0]!.id }).items).toEqual([])
}))

test("projection and filter arguments fail closed even when schema validation is bypassed", () => fixture(({ store }) => {
  const record = store.record(actor, undefined, { kind: "result", statement: "Original" })
  const invalid: unknown[] = [
    { projection: "unknown" }, { projection: null }, { fields: ["statement"] }, { projection: "metadata", fields: [] },
    { projection: "fields", fields: ["statement"] }, { projection: "fields", record_id: record.id, fields: [] },
    { projection: "fields", record_id: record.id, fields: ["statement", "statement"] },
    { projection: "fields", record_id: record.id, fields: ["$.data.statement"] },
    { projection: "fields", record_id: record.id, fields: ["statement') FROM ledger --"] },
    { projection: "fields", record_id: record.id, fields: null },
    { record_kinds: [] }, { record_kinds: ["result", "result"] }, { record_kinds: ["invented"] }, { record_kinds: "result" },
    { source_session_id: "" }, { source_session_id: "bad/session" }, { source_session_id: null }, { record_id: "" },
    { through: -1 }, { through: 1.5 }, { after: 2, through: 1 }, { through: null }, { after: null }, { limit: null },
  ]
  for (const input of invalid) expect(() => store.records({ session_id: actor.session_id, ...(input as object) } as RecordQuery)).toThrow()
  expect(() => store.records({ projection: "metadata" })).toThrow("Action or Session")
}))

for (const corruption of ["invalid-json", "root-array", "wrong-identity", "wrong-data-shape", "invalid-reference-array", "oversized-characters", "oversized-bytes"] as const)
  test(`metadata fails closed for ${corruption} without exposing a stored body`, () => fixture(({ store, db, tripwire }) => {
    const record = store.record(actor, undefined, { kind: "result", statement: "PRIVATE-STORED-STATEMENT" })
    dropJSONIndexes(db)
    const json = corruption === "invalid-json" ? "{\"PRIVATE-STORED-STATEMENT\":"
      : corruption === "root-array" ? JSON.stringify([record])
      : corruption === "wrong-identity" ? JSON.stringify({ ...record, id: "another-record" })
      : corruption === "wrong-data-shape" ? JSON.stringify({ ...record, data: [record.data] })
      : corruption === "invalid-reference-array" ? JSON.stringify({ ...record, data: { ...record.data, evidence_ids: "not-an-array" } })
      : JSON.stringify({ ...record, data: { statement: "PRIVATE-STORED-STATEMENT" + "x".repeat(PROCESSING_LIMITS.recordChars * (corruption === "oversized-bytes" ? 4 : 1)) } })
    db.query("UPDATE ledger SET data=? WHERE id=?").run(json, record.id)
    tripwire.enabled = true; tripwire.forbidden = ["PRIVATE-STORED-STATEMENT"]
    expect(() => store.records({ session_id: actor.session_id, record_id: record.id, projection: "metadata" })).toThrow()
  }))

test("projection rechecks reserved sizes and refuses growth between membership selection and retrieval", () => fixture(({ store, db, tripwire }) => {
  const record = store.record(actor, undefined, { kind: "result", statement: "Original small source" })
  tripwire.enabled = true
  tripwire.afterCandidates = () => db.query("UPDATE ledger SET data=? WHERE id=?").run(
    JSON.stringify({ ...record, data: { ...record.data, statement: "GROWN-PRIVATE-SOURCE" + "x".repeat(10_000) } }), record.id)
  tripwire.forbidden = ["GROWN-PRIVATE-SOURCE"]
  expect(() => store.records({ session_id: actor.session_id, record_id: record.id, projection: "fields", fields: ["statement"] }))
    .toThrow("invalid or changed")
}))
