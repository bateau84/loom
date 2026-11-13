import { test, expect } from "bun:test"
import { Database } from "bun:sqlite"
import { EvaluationStore, type EvaluationFreeze } from "../src/evaluation-store.js"

const freeze = (): EvaluationFreeze => ({
  owner_session: "owner", scope_key: "evidence", source_store_id: "source-store",
  boundary: { ledger: 3 },
  method: { id: "descriptive/v1", instruction_sha256: "a".repeat(64) },
  members: [{ key: "session:1:3", kind: "session", source_refs: [
    { kind: "ledger-record", id: "record-1", session_id: "owner", revision: "1", sha256: "b".repeat(64), required: true },
  ] }],
})

test("frozen source and method identity survives reopen without another logical batch", () => {
  const db = new Database(":memory:")
  try {
    const first = new EvaluationStore(db, () => true).freeze(freeze())
    const store = new EvaluationStore(db, () => true)
    const replay = store.freeze(freeze())
    expect(replay.id).toBe(first.id)
    expect(replay.revision).toBe(1)
    expect(replay.state).toBe("pending")
    expect(replay.member_count).toBe(1)
    expect(replay.processed_count).toBe(0)
    expect(store.list("owner").items.map(batch => batch.id)).toEqual([first.id])
    expect(() => store.get(first.id, "unrelated")).toThrow("unavailable")
  } finally { db.close() }
})
