import { test, expect } from "bun:test"
import { Database } from "bun:sqlite"
import { EvaluationStore } from "../src/evaluation-store.js"

function fixture(run: (store: EvaluationStore, db: Database, batchID: string) => void) {
  const db = new Database(":memory:")
  try {
    const store = new EvaluationStore(db, () => true)
    const batch = store.freeze({
      owner_session: "owner", scope_key: "scope", source_store_id: "namespace", boundary: { ledger: 2 },
      method: { id: "descriptive/v1", instruction_sha256: "a".repeat(64) },
      members: [
        { key: "first", kind: "session", source_refs: [] },
        { key: "second", kind: "objective", source_refs: [] },
      ],
    })
    const lease = store.claim(batch.id, "worker")
    if (lease.status !== "claimed") throw new Error("Expected claim")
    for (const key of ["first", "second"]) store.checkpoint(lease.claim, key, { body: { key }, dependencies: [], qualifications: [] })
    store.publish(lease.claim, { body: { population: 2 }, dependencies: [], qualifications: ["authored-members-not-independent-requests"] })
    run(store, db, batch.id)
  } finally { db.close() }
}

test("single-member and paginated readers reject a member pointing at the overall report", () => fixture((store, db, batchID) => {
  const overall = store.report(batchID, "owner")!
  db.prepare("UPDATE learning_evaluation_members SET report_id=? WHERE batch_id=? AND key='first'").run(overall.id, batchID)
  expect(() => store.report(batchID, "owner", "first")).toThrow("misattributed")
  expect(() => store.reports(batchID, "owner")).toThrow("misattributed")
  expect(() => store.report(batchID, "owner")).toThrow("misattributed")
  expect(store.get(batchID, "owner").state).toBe("incomplete")
}))

test("a member cannot borrow another member's intact report", () => fixture((store, db, batchID) => {
  const second = store.report(batchID, "owner", "second")!
  db.prepare("UPDATE learning_evaluation_members SET report_id=? WHERE batch_id=? AND key='first'").run(second.id, batchID)
  expect(() => store.report(batchID, "owner", "first")).toThrow("misattributed")
  expect(() => store.report(batchID, "owner")).toThrow("misattributed")
  expect(store.get(batchID, "owner").state).toBe("incomplete")
}))

test("the overall pointer cannot borrow an intact member report", () => fixture((store, db, batchID) => {
  const member = store.report(batchID, "owner", "first")!
  db.prepare("UPDATE learning_evaluation_batches SET report_id=? WHERE id=?").run(member.id, batchID)
  expect(() => store.report(batchID, "owner")).toThrow("misattributed")
  expect(store.get(batchID, "owner").state).toBe("incomplete")
}))

test("an intact overall digest cannot hide a corrupted retained member body", () => fixture((store, db, batchID) => {
  const member = store.report(batchID, "owner", "first")!
  db.prepare("UPDATE learning_evaluation_reports SET body_json=? WHERE id=?").run('{"changed":true}', member.id)
  expect(() => store.report(batchID, "owner")).toThrow("integrity")
  expect(store.get(batchID, "owner").state).toBe("incomplete")
}))
