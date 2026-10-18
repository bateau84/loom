import { Database } from "bun:sqlite"
import { createHash } from "node:crypto"
import { Store } from "./producer/store.js"
import { workReference } from "./producer/collaboration.js"

export const sha = (value: string | Uint8Array) => createHash("sha256").update(value).digest("hex")
export function snapshot(db: Database) {
  const schema = db.query("SELECT type,name,tbl_name,sql FROM sqlite_schema ORDER BY type,name").all() as { type: string; name: string; tbl_name: string; sql: string | null }[]
  const tables = Object.fromEntries(schema.filter(row => row.type === "table").map(row => {
    const query = db.query(`SELECT * FROM "${row.name.replaceAll('"', '""')}" ORDER BY rowid`)
    return [row.name, query.all()]
  }))
  return { user_version: (db.query("PRAGMA user_version").get() as { user_version: number }).user_version, schema, tables }
}
export type Snapshot = ReturnType<typeof snapshot>
export function hydrate(db: Database, saved: Snapshot) {
  if (db.query("SELECT name FROM sqlite_schema").all().length) throw new Error("Hydrate requires an empty disposable database")
  db.exec("PRAGMA foreign_keys=OFF; BEGIN IMMEDIATE")
  try {
    for (const row of saved.schema.filter(row => row.type === "table" && row.name !== "sqlite_sequence")) db.exec(row.sql!)
    for (const [table, rows] of Object.entries(saved.tables)) {
      const quoted = '"' + table.replaceAll('"', '""') + '"'
      db.exec(`DELETE FROM ${quoted}`)
      for (const row of rows as Record<string, string | number | null>[]) {
        const columns = Object.keys(row)
        db.query(`INSERT INTO ${quoted} (${columns.map(column => '"' + column + '"').join(',')}) VALUES (${columns.map(() => '?').join(',')})`).run(...Object.values(row))
      }
    }
    for (const row of saved.schema.filter(row => row.type !== "table" && row.sql)) db.exec(row.sql!)
    db.exec(`PRAGMA user_version=${saved.user_version}; COMMIT`)
  } catch (error) { db.exec("ROLLBACK"); throw error }
}

// Synthetic inputs through frozen real persistence APIs. No plugin, host,
// PrimarySender instance, native transport, or model provider is constructed.
export function populate(db: Database) {
  const store = new Store(db, "synthetic-baseline-c9ffcfa")
  const primary = { session_id: "synthetic-primary", agent: "coordinator" }
  const worker = { session_id: "synthetic-worker", agent: "implementer" }
  const researcher = { session_id: "synthetic-research-a", agent: "researcher" }
  const later = { session_id: "synthetic-research-b", agent: "researcher" }
  const action = store.create("SYNTHETIC preservation baseline", "Only synthetic observations; not production or acceptance evidence", primary)
  const other = store.create("SYNTHETIC unrelated", "Same agent is not Session membership", { session_id: "synthetic-unrelated", agent: "researcher" })
  const noPlan = store.create("SYNTHETIC no Plan", "Optional Plan fixture", primary)
  const nodes = [
    { id: "phase", kind: "phase" as const, title: "Synthetic phase" },
    { id: "research", kind: "task" as const, title: "Synthetic research", parent: "phase" },
    { id: "work", kind: "task" as const, title: "Synthetic work", parent: "phase", depends_on: ["research"] },
    { id: "removed", kind: "task" as const, title: "Synthetic removed", parent: "phase" },
    { id: "reopened", kind: "task" as const, title: "Synthetic reopened", parent: "phase" },
  ]
  const plan1 = store.savePlan(action.id, 0, nodes), focus = { action_id: action.id, node_id: "work" }
  store.select(worker.session_id, focus)
  store.select("synthetic-removed-selection", { action_id: action.id, node_id: "removed" })
  const boundary = { tool: "synthetic-read", observer_epoch: "synthetic-epoch", input_digest: "synthetic-input" }
  const start = store.startObservation(worker, { ...boundary, correlation_key: "synthetic-paired", phase: "started" })
  const finish = store.finishObservation(worker, { ...boundary, correlation_key: "synthetic-paired", phase: "finished", status: "completed", result_digest: "synthetic-output" }, true)!
  const interrupted = store.startObservation(worker, { ...boundary, correlation_key: "synthetic-interrupted", phase: "started" })
  const ambiguous = [1, 2].map(() => store.startObservation(worker, { ...boundary, correlation_key: "synthetic-reused", phase: "started" }))
  const unpaired = store.finishObservation(worker, { ...boundary, correlation_key: "synthetic-reused", phase: "finished", status: "completed" }, true)!
  const conclusions = (["result", "claim", "assessment", "qa"] as const).map(kind => store.record(worker, focus, {
    kind, statement: `${kind}: SYNTHETIC only; NOT acceptance. Preserve <tags>, | pipes, Unicode 雪🙂 and qualifications.`,
    evidence_ids: [finish.id], artifact_refs: ["fixture://synthetic/evidence"],
    ...(["assessment", "qa"].includes(kind) ? { verdict: "inconclusive" } : {}),
  }))
  const ref = workReference(action, plan1, "work")
  const assignment = store.collaboration.assign(primary, { assignment_id: "synthetic-assignment", worker_session_id: worker.session_id, work_ref: ref })
  const question = store.collaboration.ask(worker, focus, { assignment_id: "synthetic-assignment", respondent: researcher.agent, statement: "SYNTHETIC: is this general approval?", background: "No native recipient was contacted", artifact_refs: ["fixture://synthetic/question"] })
  const falseAnswer = store.collaboration.answer(researcher, { question_id: question.id, statement: "SYNTHETIC preliminary; not approval", artifact_refs: ["fixture://synthetic/answer-a"] })
  const missingAnswer = store.collaboration.answer(later, { question_id: question.id, statement: "SYNTHETIC missing-flag compatibility specimen; not approval" })
  // ONE explicit compatibility mutation, not claimed as API-produced output.
  db.query("UPDATE ledger SET data=json_remove(data,'$.data.automatic_continuation') WHERE id=?").run(missingAnswer.delivery.intent_id!)
  const authorization = store.collaboration.execute(primary, { operation: "authorize-continuation", assignment_id: "synthetic-assignment", continuation: "primary-native/v1" })
  const uncertainAnswer = store.collaboration.answer(later, { question_id: question.id, statement: "SYNTHETIC qualified correction: only this fixture", artifact_refs: ["fixture://synthetic/correction"] })
  const uncertainID = uncertainAnswer.delivery.intent_id!, attempt = store.delivery.claim(uncertainID)!
  if (!store.delivery.start(uncertainID, attempt.attempt_id)) throw new Error("Expected local uncertain fence")
  const pendingAnswer = store.collaboration.answer(researcher, { question_id: question.id, statement: "SYNTHETIC pending local intent; never dispatched" })
  const withdrawal = store.collaboration.execute(primary, { operation: "withdraw-continuation", assignment_id: "synthetic-assignment", statement: "SYNTHETIC withdrawal; no native execution" })
  const withdrawnAnswer = store.collaboration.answer(later, { question_id: question.id, statement: "SYNTHETIC after withdrawal" })
  const completion = store.collaboration.complete(worker, { work_ref: ref, assignment_id: "synthetic-assignment", statement: "SYNTHETIC ORIGINAL work only; not acceptance", artifact_refs: ["fixture://synthetic/completion"] })
  const removedCompletion = store.collaboration.complete(worker, { work_ref: workReference(action, plan1, "removed"), statement: "SYNTHETIC removed-node report" })
  const reopenedCompletion = store.collaboration.complete(worker, { work_ref: workReference(action, plan1, "reopened"), statement: "SYNTHETIC before reopening" })
  const reopen = store.collaboration.reopen(primary, { action_id: action.id, node_id: "reopened" }, "SYNTHETIC explicitly reopened, no acceptance cascade")
  const plan2 = store.savePlan(action.id, 1, nodes.map(n => n.id === "reopened" ? { ...n, title: "Unrelated synthetic rename" } : n))
  const unrelatedProgress = store.collaboration.progress(action.id, "work")
  const plan3 = store.savePlan(action.id, 2, plan2.nodes.filter(n => n.id !== "removed").map(n => n.id === "work" ? { ...n, criteria: ["Changed synthetic contract"] } : n))
  const lateAnswer = store.collaboration.answer({ session_id: "synthetic-late", agent: "other-author" }, { question_id: question.id, statement: "SYNTHETIC late author retains original association" })
  const noPlanQuestion = store.collaboration.ask(primary, { action_id: noPlan.id }, { respondent: "researcher", statement: "SYNTHETIC action-only question" })
  const current = store.update(action.id, 1, { goal: "SYNTHETIC changed goal requires reconfirmation" })
  // A separate uncompleted assignment retains genuinely pending/uncertain local
  // projection buckets as well as the withdrawn assignment above.
  const pendingRef = workReference(current, plan3, "research")
  const pendingAssignment = store.collaboration.assign(primary, { assignment_id: "synthetic-pending-assignment", worker_session_id: worker.session_id, work_ref: pendingRef })
  const pendingQuestion = store.collaboration.ask(worker, undefined, { assignment_id: "synthetic-pending-assignment", respondent: "researcher", statement: "SYNTHETIC pending assignment; never send from this fixture" })
  store.collaboration.execute(primary, { operation: "authorize-continuation", assignment_id: "synthetic-pending-assignment", continuation: "primary-native/v1" })
  const activeUncertain = store.collaboration.answer(researcher, { question_id: pendingQuestion.id, statement: "SYNTHETIC local uncertain fence, NOT native admission" })
  const activeAttempt = store.delivery.claim(activeUncertain.delivery.intent_id!)!
  if (!store.delivery.start(activeUncertain.delivery.intent_id!, activeAttempt.attempt_id)) throw new Error("Expected independent uncertain fence")
  const activePending = store.collaboration.answer(later, { question_id: pendingQuestion.id, statement: "SYNTHETIC active pending row; no native send" })
  return { action, current, other, noPlan, plan1, plan2, plan3, ref, focus, start, finish, interrupted, ambiguous, unpaired, conclusions,
    assignment, question, falseAnswer, missingAnswer, authorization, uncertainAnswer, pendingAnswer, withdrawal, withdrawnAnswer,
    completion, removedCompletion, reopenedCompletion, reopen, lateAnswer, noPlanQuestion, unrelatedProgress,
    pendingAssignment, pendingQuestion, activeUncertain, activePending }
}
