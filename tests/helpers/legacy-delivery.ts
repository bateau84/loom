import { Database } from "bun:sqlite"
import { Store } from "../../src/store.js"
import { workReference } from "../../src/collaboration.js"

// Synthetic diagnostic shape, not a claim about any historical producer/version.
export const legacyDeliveryDDL = `CREATE TABLE primary_deliveries (
  intent_id TEXT PRIMARY KEY REFERENCES ledger(id), intent_seq INTEGER NOT NULL, bucket TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 0, phase TEXT NOT NULL DEFAULT 'pending', attempt_id TEXT,
  binding_record_id TEXT, latest_event_id TEXT, receipt_id TEXT, native_cancel_event_id TEXT,
  started INTEGER NOT NULL DEFAULT 0);
  CREATE INDEX primary_delivery_bucket ON primary_deliveries(bucket,intent_seq);`

export function legacyFixture(db: Database) {
  const store = new Store(db), actor = { session_id: "synthetic-worker", agent: "worker" }
  const action = store.create("Synthetic work", "Preserve qualified history, not consent", actor)
  const other = store.create("Other synthetic work", "Keep independent identity", { ...actor, session_id: "other" })
  const nodes = [{ id: "work", kind: "task", title: "Original contract" }]
  store.savePlan(action.id, 0, nodes)
  const ref = workReference(action, store.plan(action.id), "work")
  const focus = { action_id: action.id, node_id: "work" }
  store.select(actor.session_id, focus)
  const observation = store.observe(actor, focus, { statement: "Synthetic observation", qualification: "not independently validated" })
  store.record(actor, focus, { kind: "result", statement: "Agent-reported result", evidence_ids: [observation.id], artifact_refs: ["fixture://result"] })
  store.record(actor, focus, { kind: "assessment", statement: "Qualified assessment", verdict: "inconclusive", evidence_ids: [observation.id] })
  store.collaboration.complete(actor, { work_ref: ref, statement: "Reported, not accepted", artifact_refs: ["fixture://completion"] })
  const question = store.collaboration.ask(actor, focus, { respondent: "reviewer", statement: "Still needs an answer?" })
  store.collaboration.reopen(actor, focus, "Explicitly reopened")
  store.update(action.id, 1, { goal: "Changed contract needs reconfirmation" })
  store.savePlan(action.id, 1, [{ ...nodes[0], criteria: ["New qualification"] }])
  store.savePlan(other.id, 0, nodes)
  store.savePlan(other.id, 1, [{ ...nodes[0], title: "Other contract" }])
  // Only the known-empty projection is replaced to reproduce the captured input.
  // All meaningful history/control rows already exist and are retained below.
  db.exec("DROP TABLE primary_deliveries;" + legacyDeliveryDDL)
  const meaning = (s: Store) => ({
    ref: workReference(s.action(action.id), s.plan(action.id), "work"),
    selected: s.selected(actor.session_id),
    progress: s.collaboration.progress(action.id),
    thread: s.collaboration.thread(question.id),
  })
  return { store, actor, action, other, ref, question, meaning }
}

/** Compare raw JSON bytes as well as every scalar, key, sequence and reference. */
export function savedRows(db: Database) {
  return Object.fromEntries(["actions", "plans", "focus", "ledger", "action_versions", "primary_deliveries", "sqlite_sequence"].map(table => [
    table, db.query(`SELECT *, ${table === "primary_deliveries" || table === "sqlite_sequence" ? "NULL" : "hex(data)"} AS json_bytes FROM ${table} ORDER BY rowid`).all(),
  ]))
}
