import { strict as assert } from "node:assert"
import type { Database } from "bun:sqlite"
import { snapshot, type Snapshot } from "../fixtures/baseline-c9ffcfa/oracle.js"

// Explicit v2 allowance, independent of production DDL. Every pre-existing SQL
// declaration and stored row must still match the untouched v1 snapshot.
const columns: Record<string, string[]> = {
  review_store_identity: ["singleton", "store_id"],
  review_requests: ["request_id", "requester_session", "data", "membership_data", "created_at"],
  review_relationships: ["sequence", "id", "request_id", "data"],
  review_issue_intents: ["sequence", "intent_key", "request_id", "attempt_id", "intent_data", "decision_ref", "decision_data",
    "state", "claimant_id", "rejection_reason", "native_outcome", "created_at", "claimed_at", "updated_at"],
  review_issue_outcomes: ["sequence", "attempt_id", "status", "source_ref", "reason", "recorded_at"],
}
const indexes: Array<{ name: string; table: string; columns: string[]; unique: number }> = [
  { name: "review_requests_requester", table: "review_requests", columns: ["requester_session", "request_id"], unique: 0 },
  { name: "review_relationships_request", table: "review_relationships", columns: ["request_id", "sequence"], unique: 0 },
  { name: "review_issue_request", table: "review_issue_intents", columns: ["request_id", "sequence"], unique: 0 },
  { name: "review_issue_outcome_attempt", table: "review_issue_outcomes", columns: ["attempt_id", "sequence"], unique: 0 },
  { name: "sqlite_autoindex_review_store_identity_1", table: "review_store_identity", columns: ["store_id"], unique: 1 },
  { name: "sqlite_autoindex_review_requests_1", table: "review_requests", columns: ["request_id"], unique: 1 },
  { name: "sqlite_autoindex_review_relationships_1", table: "review_relationships", columns: ["id"], unique: 1 },
  { name: "sqlite_autoindex_review_issue_intents_1", table: "review_issue_intents", columns: ["intent_key"], unique: 1 },
  { name: "sqlite_autoindex_review_issue_intents_2", table: "review_issue_intents", columns: ["attempt_id"], unique: 1 },
  { name: "sqlite_autoindex_review_issue_intents_3", table: "review_issue_intents", columns: ["decision_ref"], unique: 1 },
]

export function assertReviewMigration(db: Database, original: Snapshot, expectedStoreID?: string): string {
  assert.equal(original.user_version, 1, "Migration oracle requires an original v1 snapshot")
  const current = snapshot(db)
  assert.equal(current.user_version, 2)
  const identity = (row: { type: string; name: string }) => row.type + ":" + row.name
  const oldNames = new Set(original.schema.map(identity))
  assert.deepEqual(current.schema.filter(row => oldNames.has(identity(row))), original.schema,
    "A pre-existing schema declaration changed or disappeared")
  for (const [table, rows] of Object.entries(original.tables))
    assert.deepEqual(current.tables[table], rows, "Original storage bytes or types changed in " + table)
  const extra = current.schema.filter(row => !oldNames.has(identity(row)))
    .map(row => ({ type: row.type, name: row.name, tbl_name: row.tbl_name }))
    .sort((a, b) => identity(a).localeCompare(identity(b)))
  const allowed = [
    ...Object.keys(columns).map(name => ({ type: "table", name, tbl_name: name })),
    ...indexes.map(index => ({ type: "index", name: index.name, tbl_name: index.table })),
  ].sort((a, b) => identity(a).localeCompare(identity(b)))
  assert.deepEqual(extra, allowed, "Migration added unexpected schema objects")
  assert.deepEqual(Object.keys(current.tables).sort(), [...Object.keys(original.tables), ...Object.keys(columns)].sort())
  for (const [table, expected] of Object.entries(columns)) {
    const actual = db.query('PRAGMA table_info("' + table + '")').all() as Array<{ name: string }>
    assert.deepEqual(actual.map(column => column.name), expected, "Unexpected v2 columns in " + table)
    if (table !== "review_store_identity")
      assert.deepEqual(current.tables[table], [], "Migration invented review requests, relationships or execution state")
  }
  for (const expected of indexes) {
    const actual = db.query('PRAGMA index_info("' + expected.name + '")').all() as Array<{ name: string }>
    assert.deepEqual(actual.map(column => column.name), expected.columns)
    const list = db.query('PRAGMA index_list("' + expected.table + '")').all() as Array<{ name: string; unique: number }>
    assert.equal(list.find(index => index.name === expected.name)?.unique, expected.unique)
  }
  const rows = db.query("SELECT singleton,store_id FROM review_store_identity").all() as Array<{ singleton: number; store_id: string }>
  assert.equal(rows.length, 1)
  assert.equal(rows[0].singleton, 1)
  assert.match(rows[0].store_id, /^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,119}$/)
  if (expectedStoreID !== undefined) assert.equal(rows[0].store_id, expectedStoreID, "Restart replaced source-store identity")
  return rows[0].store_id
}
