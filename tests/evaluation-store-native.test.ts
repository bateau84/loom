import { test, expect } from "bun:test"
import { Database } from "bun:sqlite"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { EvaluationStore, type EvaluationFreeze, type EvaluationClaim } from "../src/evaluation-store.js"
import type { SQL } from "../src/store.js"

const freeze = (): EvaluationFreeze => ({
  owner_session: "owner", scope_key: "evidence", source_store_id: "source-store",
  boundary: { ledger: 3 }, method: { id: "descriptive/v1", instruction_sha256: "a".repeat(64) },
  members: [{ key: "session:1:3", kind: "session", source_refs: [
    { kind: "ledger-record", id: "record-1", session_id: "owner", revision: "1", sha256: "b".repeat(64), required: true },
  ] }],
})
const report = (value = "observed") => ({ body: { finding: value, independent_episodes: 0 }, dependencies: [], qualifications: ["descriptive-not-causal"] })
function fixture(run: (store: EvaluationStore, db: Database) => void) {
  const db = new Database(":memory:")
  try { run(new EvaluationStore(db, () => true), db) } finally { db.close() }
}
function acquire(store: EvaluationStore, id: string, now = Date.now(), worker = "worker"): EvaluationClaim {
  const acquired = store.claim(id, worker, { now_ms: now, lease_ms: 300000 })
  if (acquired.status !== "claimed") throw new Error("Expected a fresh worker claim")
  return acquired.claim
}
function complete(store: EvaluationStore) {
  const batch = store.freeze(freeze()), claim = acquire(store, batch.id)
  store.checkpoint(claim, "session:1:3", report())
  store.publish(claim, report("whole population"))
  return batch
}

test("frozen source and method identity survives reopen without another logical batch", () => fixture((store, db) => {
  const first = store.freeze(freeze()), replay = new EvaluationStore(db, () => true).freeze(freeze())
  expect(replay.id).toBe(first.id)
  expect(replay).toMatchObject({ revision: 1, state: "pending", member_count: 1, processed_count: 0 })
  expect(store.list("owner").items.map(batch => batch.id)).toEqual([first.id])
  expect(() => store.get(first.id, "unrelated")).toThrow("unavailable")
  expect(() => store.get("missing", "unrelated")).toThrow("unavailable")
}))

test("member order is canonical and conflicting or empty membership is rejected", () => fixture(store => {
  const input = freeze(); input.members.push({ key: "other", kind: "objective", source_refs: [] })
  const first = store.freeze(input)
  expect(store.freeze({ ...input, members: [...input.members].reverse() }).id).toBe(first.id)
  expect(() => store.freeze({ ...input, members: [input.members[0]!, input.members[0]!] })).toThrow("Duplicate")
  expect(() => store.freeze({ ...input, members: [] })).toThrow("population")
  expect(() => store.freeze({ ...input, method: { id: "bad", instruction_sha256: "not-a-hash" } })).toThrow("fingerprint")
}))

test("late evidence makes a new revision and preserves the original report", () => fixture(store => {
  const first = complete(store), original = store.report(first.id, "owner")
  const later = store.freeze({ ...freeze(), boundary: { ledger: 4 }, previous_batch_id: first.id })
  store.invalidate(first.id, "owner", "later-evidence")
  expect(later).toMatchObject({ revision: 2, previous_batch_id: first.id, state: "pending" })
  expect(store.get(first.id, "owner").state).toBe("stale")
  expect(store.report(first.id, "owner")).toEqual(original)
  expect(store.list("owner", { limit: 1 }).next_before).toBe(later.sequence)
  expect(store.list("owner", { before: later.sequence }).items.map(b => b.id)).toEqual([first.id])
}))

test("independent SQLite connections converge on one batch and one live worker", () => {
  const root = mkdtempSync(join(tmpdir(), "loom-evaluation-")), path = join(root, "learning.sqlite")
  const a = new Database(path), b = new Database(path)
  try {
    const one = new EvaluationStore(a, () => true), two = new EvaluationStore(b, () => true)
    const first = one.freeze(freeze())
    expect(two.freeze(freeze()).id).toBe(first.id)
    const claim = acquire(one, first.id, 1000)
    expect(two.claim(first.id, "second", { now_ms: 1001 })).toEqual({ status: "busy", lease_until_ms: 301000 })
    one.checkpoint(claim, "session:1:3", report(), 1002)
    one.release(claim, "chunk-finished", 1003)
    const second = acquire(two, first.id, 1004, "second")
    expect(() => one.publish(claim, report(), 1005)).toThrow("replaced")
    two.publish(second, report(), 1005)
    expect(one.get(first.id, "owner").state).toBe("complete")
  } finally { b.close(); a.close(); rmSync(root, { recursive: true, force: true }) }
})

test("expired claims are fenced and restart reclaims without another idle event", () => fixture(store => {
  const batch = store.freeze(freeze()), first = acquire(store, batch.id, 1000)
  expect(() => store.checkpoint(first, "session:1:3", report(), 301000)).toThrow("expired")
  const replacement = acquire(store, batch.id, 301000, "replacement")
  expect(() => store.release(first, "late", 301001)).toThrow("replaced")
  store.checkpoint(replacement, "session:1:3", report(), 301001)
  store.publish(replacement, report(), 301002)
  expect(store.claim(batch.id, "third", { now_ms: 301003 })).toEqual({ status: "complete" })
}))

test("a completed chunk cannot be published as the complete frozen population", () => fixture(store => {
  const input = freeze(); input.members.push({ key: "second", kind: "session", source_refs: [] })
  const batch = store.freeze(input), claim = acquire(store, batch.id)
  store.checkpoint(claim, "session:1:3", report())
  expect(() => store.publish(claim, report())).toThrow("incomplete")
  expect(store.get(batch.id, "owner")).toMatchObject({ processed_count: 1, member_count: 2, state: "processing", report_id: null })
  expect(store.report(batch.id, "owner")).toBeNull()
}))

test("report and member checkpoint roll back together when the pointer write fails", () => fixture((store, db) => {
  const batch = store.freeze(freeze()), claim = acquire(store, batch.id)
  db.exec("CREATE TRIGGER stop_checkpoint BEFORE UPDATE OF report_id ON learning_evaluation_members BEGIN SELECT RAISE(ABORT,'checkpoint fault'); END")
  expect(() => store.checkpoint(claim, "session:1:3", report())).toThrow("checkpoint fault")
  expect(db.query("SELECT COUNT(*) AS n FROM learning_evaluation_reports").get()).toEqual({ n: 0 })
  expect(db.query("SELECT COUNT(*) AS n FROM learning_evaluation_dependencies").get()).toEqual({ n: 0 })
  expect(store.get(batch.id, "owner").processed_count).toBe(0)
  db.exec("DROP TRIGGER stop_checkpoint")
  store.checkpoint(claim, "session:1:3", report())
  expect(store.get(batch.id, "owner").processed_count).toBe(1)
}))

test("overall report and successful completion roll back together", () => fixture((store, db) => {
  const batch = store.freeze(freeze()), claim = acquire(store, batch.id)
  store.checkpoint(claim, "session:1:3", report())
  db.exec("CREATE TRIGGER stop_publication BEFORE UPDATE OF report_id ON learning_evaluation_batches BEGIN SELECT RAISE(ABORT,'publication fault'); END")
  expect(() => store.publish(claim, report())).toThrow("publication fault")
  expect(db.query("SELECT COUNT(*) AS n FROM learning_evaluation_reports").get()).toEqual({ n: 1 })
  expect(store.get(batch.id, "owner").published_state).toBe("processing")
  expect(store.report(batch.id, "owner")).toBeNull()
  db.exec("DROP TRIGGER stop_publication")
  store.publish(claim, report())
  expect(store.get(batch.id, "owner").state).toBe("complete")
}))

test("lost COMMIT acknowledgement never duplicates a report or logical success", () => {
  const db = new Database(":memory:"); let loseAck = false
  const sql: SQL = {
    prepare: query => db.prepare(query),
    exec: query => { const result = db.exec(query); if (loseAck && query === "COMMIT") { loseAck = false; throw new Error("lost acknowledgement") } return result },
  }
  try {
    const store = new EvaluationStore(sql, () => true), batch = store.freeze(freeze()), claim = acquire(store, batch.id)
    loseAck = true
    expect(() => store.checkpoint(claim, "session:1:3", report())).toThrow("lost acknowledgement")
    const prior = store.report(batch.id, "owner", "session:1:3")!
    expect(store.checkpoint(claim, "session:1:3", report())).toBe(prior.id)
    expect(() => store.checkpoint(claim, "session:1:3", report("different"))).toThrow("Conflicting")
    loseAck = true
    expect(() => store.publish(claim, report())).toThrow("lost acknowledgement")
    expect(new EvaluationStore(db, () => true).get(batch.id, "owner").state).toBe("complete")
    expect(store.claim(batch.id, "retry")).toEqual({ status: "complete" })
    expect(db.query("SELECT COUNT(*) AS n FROM learning_evaluation_reports").get()).toEqual({ n: 2 })
  } finally { db.close() }
})

test("missing or changed required originals prevent checkpoint and later report disclosure", () => {
  const db = new Database(":memory:"); let available = false
  try {
    const store = new EvaluationStore(db, () => available), batch = store.freeze(freeze()), claim = acquire(store, batch.id)
    expect(() => store.checkpoint(claim, "session:1:3", report())).toThrow("source unavailable")
    available = true; store.checkpoint(claim, "session:1:3", report()); store.publish(claim, report())
    available = false
    expect(store.get(batch.id, "owner").state).toBe("incomplete")
    expect(store.report(batch.id, "owner")).toMatchObject({ availability: "source-unavailable", body: null })
  } finally { db.close() }
})

test("private report metadata cannot be read through another owner", () => fixture(store => {
  const batch = complete(store)
  expect(store.list("foreign").items).toEqual([])
  for (const read of [() => store.members(batch.id, "foreign"), () => store.reports(batch.id, "foreign"), () => store.report(batch.id, "foreign")]) expect(read).toThrow("unavailable")
}))

test("corrupt retained report content cannot preserve a complete status", () => fixture((store, db) => {
  const batch = complete(store)
  db.prepare("UPDATE learning_evaluation_reports SET body_json=? WHERE id=?").run(JSON.stringify({ altered: true }), store.report(batch.id, "owner")!.id)
  expect(() => store.report(batch.id, "owner")).toThrow("integrity")
  expect(store.get(batch.id, "owner").state).toBe("incomplete")
}))

test("deleting frozen members cannot silently turn a partial population into a complete one", () => fixture((store, db) => {
  const batch = complete(store)
  db.prepare("DELETE FROM learning_evaluation_members WHERE batch_id=?").run(batch.id)
  expect(store.get(batch.id, "owner").state).toBe("incomplete")
  expect(() => store.report(batch.id, "owner")).toThrow("membership")
}))

test("a member pointer to the overall report does not satisfy retained member coverage", () => fixture((store, db) => {
  const batch = complete(store), overall = store.report(batch.id, "owner")!
  db.prepare("UPDATE learning_evaluation_members SET report_id=? WHERE batch_id=?").run(overall.id, batch.id)
  expect(store.get(batch.id, "owner").state).toBe("incomplete")
}))

test("an interrupted additive migration rolls back and incomplete schemas are rejected", () => {
  const db = new Database(":memory:")
  try {
    const failing: SQL = { prepare: query => db.prepare(query), exec: query => {
      if (query.includes("CREATE TABLE learning_evaluation_schema")) { db.exec("CREATE TABLE learning_evaluation_schema(singleton INTEGER,version INTEGER)"); throw new Error("migration interrupted") }
      return db.exec(query)
    } }
    expect(() => new EvaluationStore(failing, () => true)).toThrow("migration interrupted")
    expect(db.query("SELECT name FROM sqlite_schema WHERE name LIKE 'learning_evaluation_%'").all()).toEqual([])
    new EvaluationStore(db, () => true)
    expect(db.query("PRAGMA user_version").get()).toEqual({ user_version: 0 })
    db.exec("DROP TABLE learning_evaluation_opportunities")
    expect(() => new EvaluationStore(db, () => true)).toThrow("Incomplete")
  } finally { db.close() }
})

test("a stale opportunity acknowledgement cannot erase newly arrived evidence", () => fixture(store => {
  store.noteOpportunity("owner", "first")
  const first = store.opportunity("owner")!
  store.noteOpportunity("owner", "second")
  expect(store.setOpportunity("owner", "idle", null, first.generation)).toBe(false)
  expect(store.opportunity("owner")).toMatchObject({ state: "pending", generation: 2 })
  expect(store.opportunities().map(row => row.session_id)).toEqual(["owner"])
  expect(store.setOpportunity("owner", "idle", null, 2)).toBe(true)
  expect(store.opportunities()).toEqual([])
}))

test("file reopen retains frozen membership and a checkpoint without inferring completion", () => {
  const root = mkdtempSync(join(tmpdir(), "loom-evaluation-reopen-")), path = join(root, "learning.sqlite")
  let db = new Database(path)
  try {
    let store = new EvaluationStore(db, () => true)
    const batch = store.freeze(freeze()), claim = acquire(store, batch.id, 1000)
    const reportID = store.checkpoint(claim, "session:1:3", report(), 1001)
    db.close(); db = new Database(path); store = new EvaluationStore(db, () => true)
    expect(store.get(batch.id, "owner")).toMatchObject({ state: "processing", processed_count: 1, report_id: null })
    expect(store.report(batch.id, "owner", "session:1:3")!.id).toBe(reportID)
    const recovered = acquire(store, batch.id, 301000, "recovery")
    store.publish(recovered, report(), 301001)
    expect(store.get(batch.id, "owner").state).toBe("complete")
    expect(db.query("PRAGMA foreign_key_check").all()).toEqual([])
  } finally { db.close(); rmSync(root, { recursive: true, force: true }) }
})

test("601 frozen authored members survive keyset pagination without claiming independent objectives", () => fixture(store => {
  const input = freeze()
  input.members = Array.from({ length: 601 }, (_, i) => ({ key: `objective:${String(i).padStart(4, "0")}`, kind: "objective" as const, source_refs: [] }))
  const batch = store.freeze(input), seen: string[] = []; let after = 0
  for (;;) {
    const page = store.members(batch.id, "owner", { after, limit: 47 })
    seen.push(...page.items.map(member => member.key))
    if (page.next_after === null) break
    after = page.next_after
  }
  expect(seen).toHaveLength(601)
  expect(new Set(seen).size).toBe(601)
  expect(store.get(batch.id, "owner")).toMatchObject({ member_count: 601, processed_count: 0, state: "pending" })
  const claim = acquire(store, batch.id)
  store.checkpoint(claim, seen[0]!, report())
  expect(() => store.publish(claim, report())).toThrow("incomplete")
}))
