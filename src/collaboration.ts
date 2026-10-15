import { type Action, type Actor, type Focus, type LedgerRecord, type Plan, type PlanNode,
  canonical, digest, uid, ProcessingBudget, ProcessingLimitError, PROCESSING_LIMITS } from "./model.js"
import type { SQL, Store } from "./store.js"

/** A reference to read work, not execution authority or proof that it was performed. */
export type WorkRef = { action_id: string; node_id: string; action_revision: number; plan_revision: number; hash: string }
const text = (value: unknown, label: string, max = 16000): string => {
  if (typeof value !== "string" || value.length > max || !value.trim()) throw new Error(`${label} must be 1-${max} characters`)
  return value.trim()
}
function page(after = 0, limit = 20) {
  if (!Number.isSafeInteger(after) || after < 0 || !Number.isSafeInteger(limit) || limit < 1 || limit > 50) throw new Error("Invalid collaboration page (limit 1-50)")
  return { after, limit }
}
function references(input?: string[]) {
  if (input !== undefined && (!Array.isArray(input) || input.length > 50 || input.some(s => typeof s !== "string" || s.length > 2000))) throw new Error("Invalid artifact_refs")
  return input ?? []
}

/** Descendants count for the selected group and dependency groups, NOT its ancestors. */
export function workReference(action: Action, plan: Plan, nodeID: string, budget?: ProcessingBudget): WorkRef {
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
function checkedRef(value: WorkRef): WorkRef {
  canonical(value, new ProcessingBudget(4096, 100))
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("work_ref from the worked-against context is required")
  const keys = ["action_id", "node_id", "action_revision", "plan_revision", "hash"]
  if (Object.keys(value).some(k => !keys.includes(k))) throw new Error("Unknown work_ref field")
  uid(value.action_id); uid(value.node_id)
  for (const revision of [value.action_revision, value.plan_revision]) if (!Number.isSafeInteger(revision) || revision < 1) throw new Error("work_ref revisions must identify saved work")
  if (typeof value.hash !== "string" || !/^[a-f0-9]{64}$/.test(value.hash)) throw new Error("Invalid work_ref hash")
  return { ...value }
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
      CREATE INDEX IF NOT EXISTS ledger_answers ON ledger(action_id,json_extract(data,'$.data.question_id'),seq) WHERE kind='answer';`)
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
  complete(actor: Actor, input: { work_ref: WorkRef; statement: string; artifact_refs?: string[] }): LedgerRecord {
    canonical(input, new ProcessingBudget(PROCESSING_LIMITS.recordChars))
    const ref = checkedRef(input.work_ref), statement = text(input.statement, "statement"), artifact_refs = references(input.artifact_refs)
    return this.atomic(true, () => {
      const current = this.store.action(ref.action_id)
      const original = this.originalAction(current, ref.action_revision), plan = this.store.plan(ref.action_id, ref.plan_revision)
      if (workReference(original, plan, ref.node_id).hash !== ref.hash) throw new Error("work_ref does not match the recorded definition; no completion recorded")
      return this.store.append({ ...actor, action_id: ref.action_id, node_id: ref.node_id, kind: "completion",
        data: { statement, work_ref: ref, work_goal: { title: original.title, goal: original.goal }, artifact_refs, verification: "Performing agent reports work finished; not acceptance or proof" } })
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
  ask(actor: Actor, focus: Focus, input: { statement: string; respondent: string; background?: string; artifact_refs?: string[] }): LedgerRecord {
    canonical(input, new ProcessingBudget(PROCESSING_LIMITS.recordChars))
    const statement = text(input.statement, "statement"), respondent = text(input.respondent, "respondent", 100)
    const background = input.background === undefined ? undefined : text(input.background, "background", 8000)
    const artifact_refs = references(input.artifact_refs)
    return this.atomic(true, () => {
      const action = this.store.action(focus.action_id), plan = this.store.plan(focus.action_id)
      const work_ref = focus.node_id === undefined ? undefined : workReference(action, plan, focus.node_id)
      return this.store.append({ ...actor, ...focus, kind: "question", data: { statement, respondent, background, artifact_refs, work_ref,
        action_revision: action.revision, plan_revision: plan.revision } })
    })
  }
  answer(actor: Actor, input: { question_id: string; statement: string; artifact_refs?: string[]; action_id?: string }): LedgerRecord {
    canonical(input, new ProcessingBudget(PROCESSING_LIMITS.recordChars))
    const statement = text(input.statement, "statement"), artifact_refs = references(input.artifact_refs)
    return this.atomic(true, () => {
      const question = this.record(input.question_id, "question")
      if (input.action_id !== undefined && input.action_id !== question.action_id) throw new Error("Question belongs to another Action")
      // No selection, current node or current Plan is required to preserve an answer.
      return this.store.append({ ...actor, action_id: question.action_id, node_id: question.node_id, kind: "answer",
        data: { question_id: question.id, statement, artifact_refs, verification: "Response only; not resolution, approval or execution permission" } })
    })
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
      const budget = new ProcessingBudget(PROCESSING_LIMITS.contextHashChars, PROCESSING_LIMITS.contextHashValues)
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
    if (q.respondent !== undefined) { filter += " AND json_extract(q.data,'$.data.respondent')=?"; params.push(q.respondent) }
    if (relevant !== undefined) {
      if (relevant.length > 300) throw new ProcessingLimitError("question context exceeds 300 nodes")
      filter += ` AND (json_extract(q.data,'$.node_id') IS NULL${relevant.length ? ` OR json_extract(q.data,'$.node_id') IN (${relevant.map(() => "?").join(",")})` : ""}${agent ? " OR json_extract(q.data,'$.data.respondent')=?" : ""})`
      params.push(...relevant); if (agent) params.push(agent)
    }
    if (state !== "all") filter += ` AND ${state === "open" ? "NOT " : ""}EXISTS (SELECT 1 FROM ledger a
      WHERE a.kind='answer' AND a.action_id=q.action_id AND json_extract(a.data,'$.data.question_id')=q.id)`
    const order = newest && state === "answered"
      ? "(SELECT a.seq FROM ledger a WHERE a.kind='answer' AND a.action_id=q.action_id AND json_extract(a.data,'$.data.question_id')=q.id ORDER BY a.seq DESC LIMIT 1) DESC,q.seq DESC"
      : `q.seq ${newest ? "DESC" : "ASC"}`
    return this.candidates(`SELECT q.seq,octet_length(q.data) AS data_bytes FROM ledger q WHERE ${filter} ORDER BY ${order} LIMIT ?`, [...params, limit + 1])
  }
  private answerRows(question: LedgerRecord, after: number, limit: number, newest = false) {
    return this.candidates(`SELECT seq,octet_length(data) AS data_bytes FROM ledger WHERE action_id=? AND kind='answer'
      AND json_extract(data,'$.data.question_id')=? AND seq>? ORDER BY seq ${newest ? "DESC" : "ASC"} LIMIT ?`, [question.action_id, question.id, after, limit + 1])
  }
  private briefQuestion(question: LedgerRecord, allowance: ReadAllowance, preview = 240) {
    const answers = this.answerRows(question, 0, 1, true)
    const latest = this.load(answers.slice(0, 1), allowance)[0]
    return { question_id: question.id, node_id: question.node_id, asked_by: question.agent, respondent: question.data.respondent,
      state: answers.length ? "answered" : "open", asked_plan_revision: question.data.plan_revision, question: String(question.data.statement).slice(0, preview),
      ...(latest ? { answer: { record_id: latest.id, author: latest.agent, statement: String(latest.data.statement).slice(0, preview) } } : {}),
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
      ask: ["operation", "action_id", "node_id", "statement", "respondent", "background", "artifact_refs"],
      answer: ["operation", "question_id", "action_id", "statement", "artifact_refs"],
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
    if (operation === "answer") return this.answer(actor, { question_id: input.question_id as string, statement: input.statement as string,
      action_id: input.action_id as string | undefined, artifact_refs: input.artifact_refs as string[] | undefined })
    if (view === "thread") return this.thread(input.question_id as string, input.after as number | undefined, input.limit as number | undefined, input.action_id as string | undefined)
    if (!focus) throw new Error("Provide action_id or select an Action for this operation")
    if (operation === "reopen") return this.reopen(actor, focus, input.statement as string)
    if (operation === "ask") return this.ask(actor, focus, { statement: input.statement as string, respondent: input.respondent as string,
      background: input.background as string | undefined, artifact_refs: input.artifact_refs as string[] | undefined })
    if (view === "progress") return this.progress(focus.action_id, focus.node_id, input.offset as number | undefined, input.limit as number | undefined)
    // Unlike ordinary ledger queries, questions default to the selected Action,
    // not its Task: the recipient can discover incoming questions from other nodes.
    return this.questions({ action_id: focus.action_id, node_id: input.node_id as string | undefined, respondent: input.respondent as string | undefined,
      state: input.question_state as QuestionQuery["state"], after: input.after as number | undefined, limit: input.limit as number | undefined })
  }
  /** Caller owns the existing Action/Plan/ledger snapshot. Never writes on a context read. */
  context(action: Action, plan: Plan, focus: Focus, relevant: string[], agent?: string) {
    const allowance = { bytes: 0 }
    const budget = new ProcessingBudget(PROCESSING_LIMITS.contextHashChars, PROCESSING_LIMITS.contextHashValues)
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
