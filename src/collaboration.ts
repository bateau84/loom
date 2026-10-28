import { type Action, type Actor, type Focus, type LedgerRecord, type Plan, type PlanNode,
  canonical, digest, uid, ProcessingBudget, ProcessingLimitError, PROCESSING_LIMITS } from "./model.js"
import type { SQL, Store } from "./store.js"

/** A reference to read work, not execution authority or proof that it was performed. */
export type WorkRef = { action_id: string; node_id: string; action_revision: number; plan_revision: number; hash: string }
export type QuestionReference = { action_id: string; kind: "action" | PlanNode["kind"]; id: string }
export type QuestionRecipient = { kind: "agent" | "role" | "dispatcher" | "user"; id?: string }
export type QuestionTarget = { expected_agent?: string; expected_session?: string; expected_parent_session?: string }
export function questionRecipient(raw: unknown): QuestionRecipient {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("recipient must be an object")
  const value = raw as Record<string, unknown>
  fields(value, ["kind", "id"])
  if (value.kind !== "agent" && value.kind !== "role" && value.kind !== "dispatcher" && value.kind !== "user")
    throw new Error("recipient.kind must be agent, role, dispatcher or user")
  if (value.kind === "agent" || value.kind === "role") {
    const id = text(value.id, "recipient.id", 100)
    if (!/^[a-zA-Z0-9][a-zA-Z0-9_.:/-]{0,99}$/.test(id)) throw new Error("Invalid recipient.id")
    return { kind: value.kind, id }
  }
  if (value.id !== undefined) throw new Error("recipient.id is only valid for agent and role")
  return { kind: value.kind }
}
/** Ephemeral post-COMMIT handoff only. Never stored, exposed by reads, or reconstructed. */
export type AnswerCommit = { record: LedgerRecord; resume?: { question_id: string; answer_id: string; asking_session_id: string } }
export const QUESTION_DISPATCH = { status: "not-attempted", reason: "policy-capability-unavailable" } as const
function fields(input: Record<string, unknown>, allowed: string[]) {
  for (const field of Object.keys(input)) if (!allowed.includes(field)) throw new Error(`${field} is not supported`)
}
const text = (value: unknown, label: string, max = 16000): string => {
  if (typeof value !== "string" || value.length > max || !value.trim()) throw new Error(`${label} must be 1-${max} characters`)
  return value.trim()
}
function page(after = 0, limit = 20) {
  if (!Number.isSafeInteger(after) || after < 0 || !Number.isSafeInteger(limit) || limit < 1 || limit > 50) throw new Error("Invalid collaboration page (limit 1-50)")
  return { after, limit }
}
function references(input: unknown, label = "artifact_refs"): string[] {
  if (input === undefined) return []
  if (!Array.isArray(input) || input.length > 50 || input.some(s => typeof s !== "string" || s.length > 2000)) throw new Error(`Invalid ${label}`)
  return input
}

// Creation and verification admit the same normalized definition. Read callers
// pass one shared budget through all comparisons; do not reset it per reference.
const workReferenceBudget = () => new ProcessingBudget(PROCESSING_LIMITS.contextHashChars, PROCESSING_LIMITS.contextHashValues)

/** Descendants count for the selected group and dependency groups, NOT its ancestors. */
export function workReference(action: Action, plan: Plan, nodeID: string, budget = workReferenceBudget()): WorkRef {
  uid(nodeID, "node id")
  if (!Array.isArray(plan.nodes) || plan.nodes.length > 300) throw new ProcessingLimitError("work reference exceeds 300 nodes")
  const nodes = new Map(plan.nodes.map(n => [n.id, n])), children = new Map<string, string[]>()
  for (const n of plan.nodes) if (n.parent) {
    const siblings = children.get(n.parent) ?? []
    siblings.push(n.id); children.set(n.parent, siblings)
  }
  const selected = new Map<string, PlanNode>(), expanded = new Set<string>()
  function add(id: string, contained: boolean) {
    const n = nodes.get(id)
    if (!n) throw new Error(`Unknown or removed node: ${id}`)
    if (!selected.has(id)) {
      selected.set(id, n)
      if (n.parent) add(n.parent, false)
      for (const dep of n.depends_on ?? []) add(dep, true)
    }
    if (contained && !expanded.has(id)) {
      expanded.add(id)
      for (const child of children.get(id) ?? []) add(child, true)
    }
  }
  add(nodeID, true)
  const contracts = [...selected.values()].sort((a, b) => a.id.localeCompare(b.id)).map(n => ({
    ...n, depends_on: [...new Set(n.depends_on ?? [])].sort(),
    roles: [...new Set(n.roles ?? [])].sort(), skills: [...new Set(n.skills ?? [])].sort(),
  }))
  return { action_id: action.id, node_id: nodeID, action_revision: action.revision, plan_revision: plan.revision,
    hash: digest({ version: "loom-work/v1", action_id: action.id, goal: { title: action.title, goal: action.goal }, node_id: nodeID, contracts }, budget) }
}
export function checkedRef(value: WorkRef): WorkRef {
  canonical(value, new ProcessingBudget(4096, 100))
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("work_ref from the worked-against context is required")
  const keys = ["action_id", "node_id", "action_revision", "plan_revision", "hash"]
  if (Object.keys(value).some(k => !keys.includes(k))) throw new Error("Unknown work_ref field")
  uid(value.action_id); uid(value.node_id)
  for (const revision of [value.action_revision, value.plan_revision]) if (!Number.isSafeInteger(revision) || revision < 1) throw new Error("work_ref revisions must identify saved work")
  if (typeof value.hash !== "string" || !/^[a-f0-9]{64}$/.test(value.hash)) throw new Error("Invalid work_ref hash")
  return { action_id: value.action_id, node_id: value.node_id, action_revision: value.action_revision,
    plan_revision: value.plan_revision, hash: value.hash }
}

const semantics = "Agent-reported, not independent acceptance. Answered means a response exists, not resolution, approval or permission."
type ReadAllowance = { bytes: number }
type Candidate = { seq: number; data_bytes: number }
type QuestionQuery = { action_id: string; node_id?: string; respondent?: string; state?: "open" | "answered" | "all"; after?: number; limit?: number }

/** All progress and question/answer events are append-only ledger records. */
export class Collaboration {
  constructor(private store: Store, private db: SQL) {
    db.exec(`CREATE TABLE IF NOT EXISTS action_versions (
      action_id TEXT NOT NULL REFERENCES actions(id), revision INTEGER NOT NULL, data TEXT NOT NULL,
      PRIMARY KEY(action_id, revision));
      CREATE INDEX IF NOT EXISTS ledger_progress ON ledger(action_id,json_extract(data,'$.node_id'),seq)
        WHERE kind IN ('completion','reopen');
      CREATE INDEX IF NOT EXISTS ledger_questions ON ledger(action_id,seq) WHERE kind='question';
      CREATE INDEX IF NOT EXISTS ledger_answers ON ledger(action_id,json_extract(data,'$.data.question_id'),seq) WHERE kind='answer';
`)

  }
  /** Called inside the Action update transaction, before mutating the old object. */
  preserveAction(action: Action) {
    this.db.prepare("INSERT OR IGNORE INTO action_versions(action_id,revision,data) VALUES(?,?,?)")
      .run(action.id, action.revision, canonical(action, new ProcessingBudget(PROCESSING_LIMITS.recordChars)))
  }
  private atomic<T>(write: boolean, run: () => T): T {
    this.db.exec(write ? "BEGIN IMMEDIATE" : "BEGIN")
    try { const result = run(); this.db.exec("COMMIT"); return result }
    catch (error) { this.db.exec("ROLLBACK"); throw error }
  }
  private originalAction(current: Action, revision: number): Action {
    if (current.revision === revision) return current
    const row = this.db.prepare(`SELECT CASE WHEN typeof(data)='text' AND octet_length(data)<=${PROCESSING_LIMITS.recordChars * 3} THEN data END AS data
      FROM action_versions WHERE action_id=? AND revision=?`).get(current.id, revision) as { data: string } | undefined
    if (!row) throw new Error("Worked-against Action revision is unavailable; no completion recorded")
    if (typeof row.data !== "string" || row.data.length > PROCESSING_LIMITS.recordChars) throw new ProcessingLimitError("historical Action exceeds read limit")
    return JSON.parse(row.data) as Action
  }
  private candidates(sql: string, params: unknown[]): Candidate[] {
    return this.db.prepare(sql).all(...params) as Candidate[]
  }
  private load(rows: Candidate[], allowance: ReadAllowance) {
    for (const row of rows) {
      if (!Number.isSafeInteger(row.data_bytes) || row.data_bytes < 0) throw new ProcessingLimitError("invalid collaboration row size")
      allowance.bytes += row.data_bytes
      if (allowance.bytes > 4194304) throw new ProcessingLimitError("collaboration read exceeds 4 MiB; use a smaller page or exact record_id")
    }
    return this.store.hydrateLedger(rows)
  }
  private record(id: string, kind: "question", allowance: ReadAllowance = { bytes: 0 }): LedgerRecord {
    const candidates = this.candidates("SELECT seq,octet_length(data) AS data_bytes FROM ledger WHERE id=? AND kind=?", [uid(id), kind])
    const record = this.load(candidates, allowance)[0]
    if (!record) throw new Error(`Unknown ${kind}: ${id}`)
    return record
  }
  /** Caller owns a write transaction. Never substitutes a current definition. */
  private verifyReference(ref: WorkRef) {
    const original = this.originalAction(this.store.action(ref.action_id), ref.action_revision)
    if (workReference(original, this.store.plan(ref.action_id, ref.plan_revision), ref.node_id).hash !== ref.hash)
      throw new Error("work_ref does not match the recorded definition; no record saved")
    return original
  }
  complete(actor: Actor, input: { work_ref: WorkRef; statement: string; artifact_refs?: string[] }): LedgerRecord {
    canonical(input, new ProcessingBudget(PROCESSING_LIMITS.recordChars))
    const ref = checkedRef(input.work_ref), statement = text(input.statement, "statement"), artifact_refs = references(input.artifact_refs)
    return this.atomic(true, () => {
      const original = this.verifyReference(ref)
      return this.store.append({ ...actor, action_id: ref.action_id, node_id: ref.node_id, kind: "completion",
        data: { statement, work_ref: ref,
          work_goal: { title: original.title, goal: original.goal }, artifact_refs, verification: "Performing agent reports work finished; not acceptance or proof" } })
    })
  }
  reopen(actor: Actor, focus: Focus, statement: string): LedgerRecord {
    const node = uid(focus.node_id, "node id"), reason = text(statement, "statement")
    return this.atomic(true, () => {
      const plan = this.store.plan(focus.action_id), previous = this.latest(focus.action_id, node)
      if (!plan.nodes.some(n => n.id === node) && !previous) throw new Error("Unknown node without progress history")
      return this.store.append({ ...actor, ...focus, kind: "reopen", data: { statement: reason, previous_report_id: previous?.id, plan_revision: plan.revision } })
    })
  }
  ask(actor: Actor, focus: Focus | undefined, input: Record<string, unknown>, target: QuestionTarget = {}): LedgerRecord {
    canonical(input, new ProcessingBudget(PROCESSING_LIMITS.recordChars))
    fields(input, ["question", "to_agent", "recipient", "blocking", "context", "context_attachments", "reference"])
    const question = text(input.question, "question")
    if ((input.to_agent === undefined) === (input.recipient === undefined))
      throw new Error("Supply exactly one of to_agent (legacy manual) or recipient")
    const to_agent = input.to_agent === undefined ? undefined : text(input.to_agent, "to_agent", 100)
    const recipient = input.recipient === undefined ? undefined : questionRecipient(input.recipient)
    if (typeof input.blocking !== "boolean") throw new Error("blocking must be an explicit Boolean")
    const blocking = input.blocking, context = input.context === undefined ? undefined : text(input.context, "context", 8000)
    const context_attachments = references(input.context_attachments, "context_attachments")
    return this.atomic(true, () => {
      let reference: QuestionReference | undefined
      if (input.reference !== undefined) {
        const ref = input.reference
        if (!ref || typeof ref !== "object" || Array.isArray(ref)) throw new Error("reference must be an object")
        fields(ref as Record<string, unknown>, ["action_id", "kind", "id"])
        const r = ref as Record<string, unknown>, action_id = uid(r.action_id), id = uid(r.id)
        if (r.kind !== "action" && r.kind !== "phase" && r.kind !== "wave" && r.kind !== "task" && r.kind !== "subtask") throw new Error("Invalid reference kind")
        reference = { action_id, id, kind: r.kind }
      } else if (focus) {
        const node = focus.node_id === undefined ? undefined : this.store.plan(focus.action_id).nodes.find(n => n.id === focus.node_id)
        if (focus.node_id !== undefined && !node) throw new Error("Unknown or removed selected node")
        reference = { action_id: focus.action_id, id: focus.node_id ?? focus.action_id, kind: node?.kind ?? "action" }
      }
      let association: Focus | undefined, revisions: Record<string, number> = {}
      if (reference) {
        const action = this.store.action(reference.action_id), plan = this.store.plan(action.id)
        if (reference.kind === "action") {
          if (reference.id !== action.id) throw new Error("Action reference id must match action_id")
        } else {
          const node = plan.nodes.find(n => n.id === reference.id)
          if (!node || node.kind !== reference.kind) throw new Error("Unknown reference node or kind mismatch")
        }
        association = { action_id: action.id, ...(reference.kind !== "action" ? { node_id: reference.id } : {}) }
        revisions = { action_revision: action.revision, plan_revision: plan.revision }
      }
      return this.store.append({ ...actor, ...association, kind: "question", data: { format: recipient ? "loom-question/v2" : "loom-question/v1",
        question, ...(recipient ? { recipient, ...target } : { to_agent }), blocking,
        context, context_attachments, reference, ...revisions } })
    })
  }
  /** Bind one verified native child before allowing it to receive or answer the question. */
  bindRespondent(questionID: string, sessionID: string, agent: string, dispatcherSession?: string): LedgerRecord {
    uid(sessionID, "respondent Session"); uid(questionID, "question ID")
    return this.atomic(true, () => {
      const question = this.record(questionID, "question")
      if (question.data.format !== "loom-question/v2" || question.data.expected_agent !== agent ||
          question.data.expected_session || question.data.expected_parent_session !== dispatcherSession)
        throw new Error("Question is not owned by this dispatching Session or respondent")
      const bound = this.db.prepare(`SELECT 1 FROM ledger WHERE kind='result'
        AND json_extract(data,'$.data.format')='loom-question-respondent-binding/v1'
        AND json_extract(data,'$.data.question_id')=? LIMIT 1`).get(questionID)
      if (bound) throw new Error("Question respondent is already bound")
      return this.store.append({ session_id: question.session_id, agent: "system",
        ...(question.action_id ? { action_id: question.action_id } : {}),
        ...(question.node_id ? { node_id: question.node_id } : {}),
        kind: "result", data: { format: "loom-question-respondent-binding/v1",
          question_id: questionID, session_id: sessionID, agent,
          ...(dispatcherSession ? { parent_session_id: dispatcherSession } : {}),
          qualification: "Verified respondent Session identity, not proof of delivery, execution or answer" } })
    })
  }
  answer(actor: Actor, input: Record<string, unknown>, verifiedParentSession?: string): AnswerCommit {
    canonical(input, new ProcessingBudget(PROCESSING_LIMITS.recordChars))
    fields(input, ["question_id", "answer", "context_attachments"])
    const answer = text(input.answer, "answer"), context_attachments = references(input.context_attachments, "context_attachments")
    const committed = this.atomic(true, () => {
      const question = this.record(input.question_id as string, "question")
      if (question.data.format === "loom-question/v2") {
        const expectedAgent = question.data.expected_agent
        let expectedSession = question.data.expected_session
        if (!expectedAgent && !expectedSession) throw new Error("Question has no authorized respondent; arrange routing first")
        if (expectedAgent && actor.agent !== expectedAgent) throw new Error("Answering agent does not match the intended respondent")
        if (question.data.expected_parent_session !== undefined &&
            verifiedParentSession !== question.data.expected_parent_session)
          throw new Error("Answering Session is not a verified child of the dispatching Session")
        if (expectedAgent) {
          const bound = this.db.prepare(`SELECT json_extract(data,'$.data.session_id') AS session_id
            FROM ledger WHERE kind='result'
            AND json_extract(data,'$.data.format')='loom-question-respondent-binding/v1'
            AND json_extract(data,'$.data.question_id')=? LIMIT 1`).get(question.id) as { session_id?: string } | undefined
          if (typeof bound?.session_id !== "string") {
            if (question.data.expected_parent_session) throw new Error("Forwarded question is not bound to an intended specialist Session")
            throw new Error("Question has no verified receiving Session")
          }
          expectedSession = bound.session_id
        }
        if (expectedSession && actor.session_id !== expectedSession)
          throw new Error("Answering Session does not match the intended respondent")
      }
      const prior = this.db.prepare("SELECT 1 FROM ledger WHERE kind='answer' AND json_extract(data,'$.data.question_id')=? LIMIT 1").get(question.id)
      // No selection, current node, Plan or host availability is required to preserve an answer.
      const record = this.store.append({ ...actor, action_id: question.action_id, node_id: question.node_id, kind: "answer",
        data: { format: question.data.format === "loom-question/v2" ? "loom-answer/v2" : "loom-answer/v1",
          question_id: question.id, answer, context_attachments,
          verification: question.data.format === "loom-question/v2"
            ? "Intended respondent identity checked; response only, not resolution, approval, user provenance or execution permission"
            : "Response only; not resolution, approval or execution permission" } })
      return { record, question, first: !prior }
    })
    // atomic() has returned only after COMMIT succeeded. No callback or native I/O
    // runs inside the transaction. Later answers never inherit a lost handoff.
    const { record, question, first } = committed
    return { record, ...(first && (question.data.format === "loom-question/v1" || question.data.format === "loom-question/v2") && question.data.blocking === true
      ? { resume: { question_id: question.id, answer_id: record.id, asking_session_id: question.session_id } } : {}) }
  }
  private latest(action: string, node: string, allowance: ReadAllowance = { bytes: 0 }) {
    const rows = this.candidates(`SELECT seq,octet_length(data) AS data_bytes FROM ledger
      WHERE action_id=? AND json_extract(data,'$.node_id')=? AND kind IN ('completion','reopen') ORDER BY seq DESC LIMIT 1`, [action, node])
    return this.load(rows, allowance)[0]
  }
  private progressAt(action: Action, plan: Plan, node: string, budget: ProcessingBudget, allowance: ReadAllowance) {
    const last = this.latest(action.id, node, allowance), current_node = plan.nodes.some(n => n.id === node)
    let state: "open" | "reported-complete" | "needs-reconfirmation" | "validity-unknown" = "open"
    let reason: string | undefined
    if (last?.kind === "completion") {
      if (!current_node) { state = "needs-reconfirmation"; reason = "node-not-in-current-plan" }
      else try {
        const ref = checkedRef(last.data.work_ref as WorkRef)
        state = workReference(action, plan, node, budget).hash === ref.hash ? "reported-complete" : "needs-reconfirmation"
      } catch (error) {
        if (!(error instanceof ProcessingLimitError)) throw error
        state = "validity-unknown"; reason = "processing-limit"
      }
    }
    return { node_id: node, state, current_node, ...(last ? { report_id: last.id, reported_by: last.agent,
      session_id: last.session_id, reported_at: last.created_at, work_ref: last.data.work_ref } : {}), ...(reason ? { reason } : {}) }
  }
  progress(actionID: string, nodeID?: string, offset = 0, limit = 20) {
    page(offset, limit)
    if (nodeID !== undefined) uid(nodeID, "node id")
    return this.store.contextSnapshot(actionID, (action, plan) => {
      const allowance = { bytes: 0 }
      const ids = nodeID === undefined ? plan.nodes.map(n => n.id) : [nodeID]
      const budget = workReferenceBudget()
      return { items: ids.slice(offset, offset + limit).map(id => this.progressAt(action, plan, id, budget, allowance)),
        next_offset: ids.length > offset + limit ? offset + limit : null, plan_revision: plan.revision, note: semantics }
    })
  }
  private questionRows(q: QuestionQuery, relevant?: string[], agent?: string, newest = false) {
    uid(q.action_id)
    const { after, limit } = page(q.after, q.limit)
    if (q.node_id !== undefined) uid(q.node_id)
    if (q.respondent !== undefined) text(q.respondent, "respondent", 100)
    const state = q.state ?? "open"
    if (!["open", "answered", "all"].includes(state)) throw new Error("Question state must be open, answered or all")
    const params: unknown[] = [q.action_id, after]
    let filter = "q.action_id=? AND q.kind='question' AND q.seq>?"
    if (q.node_id !== undefined) { filter += " AND json_extract(q.data,'$.node_id')=?"; params.push(q.node_id) }
    const recipient = "(json_extract(q.data,'$.data.to_agent')=? OR json_extract(q.data,'$.data.respondent')=? OR json_extract(q.data,'$.data.recipient.id')=? OR json_extract(q.data,'$.data.expected_agent')=?)"
    const agentRecipient = "(json_extract(q.data,'$.data.to_agent')=? OR json_extract(q.data,'$.data.respondent')=? OR json_extract(q.data,'$.data.expected_agent')=?)"
    if (q.respondent !== undefined) { filter += ` AND ${recipient}`; params.push(...Array(4).fill(q.respondent)) }
    if (relevant !== undefined) {
      if (relevant.length > 300) throw new ProcessingLimitError("question context exceeds 300 nodes")
      filter += ` AND (json_extract(q.data,'$.node_id') IS NULL${relevant.length ? ` OR json_extract(q.data,'$.node_id') IN (${relevant.map(() => "?").join(",")})` : ""}${agent ? ` OR ${agentRecipient}` : ""})`
      params.push(...relevant); if (agent) params.push(...Array(3).fill(agent))
    }
    if (state !== "all") filter += ` AND ${state === "open" ? "NOT " : ""}EXISTS (SELECT 1 FROM ledger a
      WHERE a.kind='answer' AND a.action_id=q.action_id AND json_extract(a.data,'$.data.question_id')=q.id)`
    const order = newest && state === "answered"
      ? "(SELECT a.seq FROM ledger a WHERE a.kind='answer' AND a.action_id=q.action_id AND json_extract(a.data,'$.data.question_id')=q.id ORDER BY a.seq DESC LIMIT 1) DESC,q.seq DESC"
      : `q.seq ${newest ? "DESC" : "ASC"}`
    return this.candidates(`SELECT q.seq,octet_length(q.data) AS data_bytes FROM ledger q WHERE ${filter} ORDER BY ${order} LIMIT ?`, [...params, limit + 1])
  }
  private answerRows(question: LedgerRecord, after: number, limit: number, newest = false) {
    return this.candidates(`SELECT seq,octet_length(data) AS data_bytes FROM ledger WHERE action_id IS ? AND kind='answer'
      AND json_extract(data,'$.data.question_id')=? AND seq>? ORDER BY seq ${newest ? "DESC" : "ASC"} LIMIT ?`, [question.action_id ?? null, question.id, after, limit + 1])
  }
  private briefQuestion(question: LedgerRecord, allowance: ReadAllowance, preview = 240) {
    const answers = this.answerRows(question, 0, 1, true)
    const latest = this.load(answers.slice(0, 1), allowance)[0]
    return { question_id: question.id, node_id: question.node_id, asked_by: question.agent, asking_session_id: question.session_id,
      respondent: question.data.to_agent ?? question.data.respondent ?? question.data.expected_agent ?? (question.data.recipient as QuestionRecipient | undefined)?.kind,
      ...(question.data.recipient ? { recipient: question.data.recipient } : {}),
      state: answers.length ? "answered" : "open", asked_plan_revision: question.data.plan_revision, question: String(question.data.question ?? question.data.statement).slice(0, preview),
      ...(latest ? { answer: { record_id: latest.id, author: latest.agent, session_id: latest.session_id, statement: String(latest.data.answer ?? latest.data.statement).slice(0, preview) } } : {}),
      answers_have_more: answers.length > 1, excerpted: true }
  }
  questions(query: QuestionQuery) {
    return this.atomic(false, () => {
      this.store.action(query.action_id)
      const allowance = { bytes: 0 }
      const { limit } = page(query.after, query.limit), rows = this.questionRows(query)
      return { items: this.load(rows.slice(0, limit), allowance).map(q => this.briefQuestion(q, allowance)),
        next_after: rows.length > limit ? rows[limit - 1].seq : null, note: semantics + " Excerpts may omit qualifications; query view=thread with question_id for the original and all answers." }
    })
  }
  thread(questionID: string, after = 0, limit = 20, actionID?: string) {
    page(after, limit)
    return this.atomic(false, () => {
      const allowance = { bytes: 0 }
      const question = this.record(questionID, "question", allowance)
      if (actionID !== undefined && actionID !== question.action_id) throw new Error("Question belongs to another Action")
      const rows = this.answerRows(question, after, limit)
      return { question, answers: this.load(rows.slice(0, limit), allowance),
        next_after: rows.length > limit ? rows[limit - 1].seq : null, note: semantics }
    })
  }
  /** Route only the new operations; original ledger add/query behavior stays in the plugin. */
  execute(actor: Actor, input: Record<string, unknown>, focus?: Focus): unknown {
    const operation = input.operation, view = input.view
    const key = operation === "query" ? `query:${view}` : String(operation)
    const allowed: Record<string, string[]> = {
      complete: ["operation", "work_ref", "statement", "artifact_refs", "action_id", "node_id"],
      reopen: ["operation", "action_id", "node_id", "statement"],
      ask: ["operation", "question", "to_agent", "recipient", "blocking", "context", "context_attachments", "reference"],
      answer: ["operation", "question_id", "answer", "context_attachments"],
      "query:progress": ["operation", "view", "action_id", "node_id", "offset", "limit"],
      "query:questions": ["operation", "view", "action_id", "node_id", "respondent", "question_state", "after", "limit"],
      "query:thread": ["operation", "view", "question_id", "action_id", "after", "limit"],
    }
    if (!allowed[key]) throw new Error("Unknown collaboration operation/view")
    for (const field of Object.keys(input)) if (!allowed[key].includes(field)) throw new Error(`${field} is not supported by ${key}`)
    if (operation === "complete") {
      const ref = checkedRef(input.work_ref as WorkRef)
      if ((input.action_id !== undefined && input.action_id !== ref.action_id) || (input.node_id !== undefined && input.node_id !== ref.node_id)) throw new Error("Explicit scope disagrees with work_ref")
      return this.complete(actor, { work_ref: ref, statement: input.statement as string, artifact_refs: input.artifact_refs as string[] | undefined })
    }
    if (operation === "answer") return this.answer(actor, { question_id: input.question_id, answer: input.answer, context_attachments: input.context_attachments }).record
    if (view === "thread") return this.thread(input.question_id as string, input.after as number | undefined, input.limit as number | undefined, input.action_id as string | undefined)
    if (operation === "ask") return this.ask(actor, focus, { question: input.question, to_agent: input.to_agent, recipient: input.recipient, blocking: input.blocking,
      context: input.context, context_attachments: input.context_attachments, reference: input.reference })
    if (!focus) throw new Error("Provide action_id or select an Action for this operation")
    if (operation === "reopen") return this.reopen(actor, focus, input.statement as string)
    if (view === "progress") return this.progress(focus.action_id, focus.node_id, input.offset as number | undefined, input.limit as number | undefined)
    // Unlike ordinary ledger queries, questions default to the selected Action,
    // not its Task: the recipient can discover incoming questions from other nodes.
    return this.questions({ action_id: focus.action_id, node_id: input.node_id as string | undefined, respondent: input.respondent as string | undefined,
      state: input.question_state as QuestionQuery["state"], after: input.after as number | undefined, limit: input.limit as number | undefined })
  }
  /** Caller owns the existing Action/Plan/ledger snapshot. Never writes on a context read. */
  context(action: Action, plan: Plan, focus: Focus, relevant: string[], agent?: string) {
    const allowance = { bytes: 0 }
    const budget = workReferenceBudget()
    let work_ref: WorkRef | null = null, work_ref_reason: string | undefined
    if (focus.node_id && !plan.nodes.some(n => n.id === focus.node_id)) work_ref_reason = "node-not-in-current-plan"
    else if (focus.node_id) try { work_ref = workReference(action, plan, focus.node_id, budget) }
    catch (error) { if (!(error instanceof ProcessingLimitError)) throw error; work_ref_reason = "processing-limit" }
    const ids = focus.node_id ? relevant : plan.nodes.map(n => n.id)
    const progress = ids.slice(0, 16).map(id => this.progressAt(action, plan, id, budget, allowance))
      .filter(p => p.report_id || p.node_id === focus.node_id)
    const q = { action_id: action.id, limit: 6, state: "open" as const }
    const open = this.questionRows(q, focus.node_id ? relevant : undefined, agent)
    const answered = this.questionRows({ ...q, limit: 2, state: "answered" }, focus.node_id ? relevant : undefined, agent, true)
    const questions = this.load([...open.slice(0, 6), ...answered.slice(0, 2)], allowance).map(q => this.briefQuestion(q, allowance, 160))
    return { work_ref, ...(work_ref_reason ? { work_ref_reason } : {}), progress, questions,
      has_more: ids.length > 16 || open.length > 6 || answered.length > 2,
      note: "Reported progress, not acceptance. Answered=response exists, not resolution or approval. Use loom_record query view=progress/questions/thread for more; thread needs question_id. Read full answers before consequential decisions." }
  }
}
