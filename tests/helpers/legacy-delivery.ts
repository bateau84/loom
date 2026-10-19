import { Database } from "bun:sqlite"
import { Store } from "../../src/store.js"
import { workReference } from "../../src/collaboration.js"

// Exact table/index DDL from the independent capture evidence. History below is
// synthetic; no captured records or private identities belong in this fixture.
export const legacyDeliveryDDL = `CREATE TABLE primary_deliveries (
      intent_id TEXT PRIMARY KEY REFERENCES ledger(id), intent_seq INTEGER NOT NULL, bucket TEXT NOT NULL,
      version INTEGER NOT NULL DEFAULT 0, phase TEXT NOT NULL DEFAULT 'pending', attempt_id TEXT,
      binding_record_id TEXT, latest_event_id TEXT, receipt_id TEXT, started INTEGER NOT NULL DEFAULT 0, native_cancel_event_id TEXT);
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
  const question = store.collaboration.ask(actor, focus, { to_agent: "reviewer", question: "Still needs an answer?", blocking: false })
  store.collaboration.reopen(actor, focus, "Explicitly reopened")
  store.update(action.id, 1, { goal: "Changed contract needs reconfirmation" })
  store.savePlan(action.id, 1, [{ ...nodes[0], criteria: ["New qualification"] }])
  store.savePlan(other.id, 0, nodes)
  store.savePlan(other.id, 1, [{ ...nodes[0], title: "Other contract" }])
  // Only the known-empty projection is replaced to reproduce the captured input.
  // All meaningful history/control rows already exist and are retained below.
  db.exec("DROP TABLE IF EXISTS primary_deliveries;" + legacyDeliveryDDL)
  const meaning = (s: Store) => ({
    ref: workReference(s.action(action.id), s.plan(action.id), "work"),
    selected: s.selected(actor.session_id),
    progress: s.collaboration.progress(action.id),
    thread: s.collaboration.thread(question.id),
  })
  return { store, actor, action, other, ref, question, meaning }
}

/** Rowid-ordered storage types and bytes of every column, not just row counts. */
export function savedRows(db: Database) {
  return Object.fromEntries(["actions", "plans", "focus", "ledger", "action_versions", "primary_deliveries", "sqlite_sequence"].map(table => {
    const columns = db.query(`PRAGMA table_info(${table})`).all() as { name: string }[]
    const bytes = columns.map(({ name }) => {
      const column = `"${name.replaceAll('"', '""')}"`
      return `typeof(${column}),hex(CAST(${column} AS BLOB))`
    }).join(",")
    return [table, db.query(`SELECT rowid,${bytes} FROM ${table} ORDER BY rowid`).values()]
  }))
}
