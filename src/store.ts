import { randomUUID } from "node:crypto"
import { realpathSync } from "node:fs"
import { type Action, type Actor, type Focus, type LedgerRecord, type Plan, type PlanNode, type RecordKind, subject, uid, validatePlan } from "./model.js"

export interface SQL { exec(sql: string): unknown; prepare(sql: string): { get(...params: any[]): unknown; all(...params: any[]): unknown[]; run(...params: any[]): unknown } }
const parse = <T>(row: unknown): T => JSON.parse((row as { data: string }).data) as T
const now = () => new Date().toISOString()
const nonempty = (s: unknown, label: string, max = 16000): string => {
  if (typeof s !== "string" || !s.trim() || s.length > max) throw new Error(`${label} must be 1-${max} characters`)
  return s.trim()
}
export class Store {
  constructor(private db: SQL) {
    const version = db.prepare("PRAGMA user_version").get() as { user_version: number }
    if (![0, 1].includes(version.user_version)) throw new Error("Unsupported Loom Action database version; existing data was not modified")
    db.exec("PRAGMA busy_timeout=2000; PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;")
    db.exec(`CREATE TABLE IF NOT EXISTS actions (id TEXT PRIMARY KEY, data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS plans (action_id TEXT NOT NULL REFERENCES actions(id), revision INTEGER NOT NULL, data TEXT NOT NULL, PRIMARY KEY(action_id, revision));
      CREATE TABLE IF NOT EXISTS focus (session_id TEXT PRIMARY KEY, data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS ledger (seq INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT NOT NULL UNIQUE, action_id TEXT, session_id TEXT NOT NULL, kind TEXT NOT NULL, data TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS ledger_action ON ledger(action_id, seq);
      CREATE INDEX IF NOT EXISTS ledger_session ON ledger(session_id, seq);
      CREATE INDEX IF NOT EXISTS ledger_observation_boundary ON ledger(
        json_extract(data,'$.data.correlation_key'), json_extract(data,'$.data.phase'), seq
      ) WHERE kind='observation';
      CREATE INDEX IF NOT EXISTS ledger_context_kind ON ledger(action_id, kind, seq)
        WHERE kind<>'observation';
      CREATE INDEX IF NOT EXISTS ledger_context_scope ON ledger(action_id, json_extract(data,'$.node_id'), kind, seq)
        WHERE kind<>'observation';
      PRAGMA user_version=1;`)
  }
  /** Stable within a host lifetime, even when a replacement opens a new connection. */
  captureScope(): string | object {
    const row = this.db.prepare("PRAGMA database_list").all().find(row => (row as { name: string }).name === "main") as { file: string } | undefined
    if (!row || typeof row.file !== "string") throw new Error("Cannot identify the observation database")
    return row.file ? realpathSync(row.file) : this.db
  }
  private transaction<T>(fn: () => T): T {
    this.db.exec("BEGIN IMMEDIATE")
    try { const result = fn(); this.db.exec("COMMIT"); return result } catch (e) { this.db.exec("ROLLBACK"); throw e }
  }
  action(id: string): Action {
    const row = this.db.prepare("SELECT data FROM actions WHERE id=?").get(uid(id))
    if (!row) throw new Error(`Unknown Action: ${id}`)
    return parse<Action>(row)
  }
  list(offset = 0) {
    if (!Number.isSafeInteger(offset) || offset < 0) throw new Error("Invalid offset")
    const rows = this.db.prepare("SELECT data FROM actions ORDER BY rowid LIMIT 51 OFFSET ?").all(offset)
    return { items: rows.slice(0, 50).map(r => parse<Action>(r)), next_offset: rows.length > 50 ? offset + 50 : null }
  }
  create(title: string, goal: string, actor: Actor): Action {
    const a: Action = { id: randomUUID(), title: nonempty(title, "title", 500), goal: nonempty(goal, "goal"), state: "active", revision: 1, created_at: now() }
    return this.transaction(() => {
      this.db.prepare("INSERT INTO actions(id,data) VALUES(?,?)").run(a.id, JSON.stringify(a))
      this.select(actor.session_id, { action_id: a.id }); return a
    })
  }
  update(id: string, revision: number, patch: { title?: string; goal?: string; state?: Action["state"] }): Action {
    return this.transaction(() => {
      const a = this.action(id)
      if (revision !== a.revision) throw new Error(`Action changed; read revision ${a.revision} before editing`)
      if (patch.title !== undefined) a.title = nonempty(patch.title, "title", 500)
      if (patch.goal !== undefined) a.goal = nonempty(patch.goal, "goal")
      if (patch.state !== undefined) {
        if (!["active", "paused", "completed", "cancelled"].includes(patch.state)) throw new Error("Invalid Action state")
        a.state = patch.state
      }
      a.revision++
      this.db.prepare("UPDATE actions SET data=? WHERE id=?").run(JSON.stringify(a), id)
      return a
    })
  }
  plan(id: string, revision?: number): Plan {
    this.action(id)
    const row = revision === undefined
      ? this.db.prepare("SELECT data FROM plans WHERE action_id=? ORDER BY revision DESC LIMIT 1").get(id)
      : this.db.prepare("SELECT data FROM plans WHERE action_id=? AND revision=?").get(id, revision)
    if (!row && revision !== undefined && revision !== 0) throw new Error("Unknown plan revision")
    return row ? parse<Plan>(row) : { revision: 0, nodes: [] }
  }
  savePlan(id: string, expected: number, nodes: unknown): Plan {
    const valid = validatePlan(nodes)
    return this.transaction(() => {
      const current = this.plan(id)
      if (expected !== current.revision) throw new Error(`Plan changed; read revision ${current.revision} before editing`)
      const plan: Plan = { revision: current.revision + 1, nodes: valid }
      this.db.prepare("INSERT INTO plans(action_id,revision,data) VALUES(?,?,?)").run(id, plan.revision, JSON.stringify(plan))
      return plan
    })
  }
  selected(session: string): Focus | undefined {
    const row = this.db.prepare("SELECT data FROM focus WHERE session_id=?").get(session)
    return row ? parse<Focus | null>(row) ?? undefined : undefined
  }
  hasSelection(session: string): boolean { return !!this.db.prepare("SELECT data FROM focus WHERE session_id=?").get(session) }
  select(session: string, focus?: Focus) {
    if (focus) subject(this.action(focus.action_id), this.plan(focus.action_id), focus.node_id)
    this.db.prepare("INSERT INTO focus(session_id,data) VALUES(?,?) ON CONFLICT(session_id) DO UPDATE SET data=excluded.data").run(session, JSON.stringify(focus ?? null))
  }
  /** Internal capture only. Agents cannot insert observation records through the tool API. */
  observe(actor: Actor, focus: Focus | undefined, data: Record<string, unknown>, fingerprint?: string): LedgerRecord {
    return this.append({ ...actor, ...focus, fingerprint, kind: "observation", data })
  }
  /** Capture selection and its contract in the same transaction as the start. */
  startObservation(actor: Actor, data: Record<string, unknown>): LedgerRecord {
    return this.transaction(() => {
      const focus = this.selected(actor.session_id)
      let fingerprint: string | undefined
      if (focus) {
        // A removed Task still has a historical selection, but no current contract.
        const action = this.action(focus.action_id), plan = this.plan(focus.action_id)
        if (!focus.node_id || plan.nodes.some(n => n.id === focus.node_id)) fingerprint = subject(action, plan, focus.node_id)
      }
      return this.observe(actor, focus, data, fingerprint)
    })
  }
  private observationBoundary(key: string, phase: string, limit: number): LedgerRecord[] {
    return this.db.prepare(`SELECT data FROM ledger WHERE kind='observation'
      AND json_extract(data,'$.data.correlation_key')=?
      AND json_extract(data,'$.data.phase')=? ORDER BY seq LIMIT ?`)
      .all(key, phase, limit).map(row => parse<LedgerRecord>(row))
  }
  /** Eligibility only, not proof of pairing; finishObservation rechecks atomically. */
  hasUnfinishedObservationStart(key: string): boolean {
    return this.observationBoundary(key, "started", 2).length === 1
      && this.observationBoundary(key, "finished", 1).length === 0
  }
  /**
   * At most two starts and one finish are read through an index. Counts/order,
   * equal inputs, and elapsed time never disambiguate a reused host call key.
   * The transaction also prevents two writers from claiming the same start.
   */
  finishObservation(actor: Actor, data: Record<string, unknown>, allowPairing: boolean, recordUnpaired = true): LedgerRecord | undefined {
    return this.transaction(() => {
      const key = String(data.correlation_key)
      const starts = this.observationBoundary(key, "started", 2)
      const finished = this.observationBoundary(key, "finished", 1).length > 0
      const start = starts[0]
      const reason = !allowPairing ? "capture-gap"
        : starts.length > 1 ? "ambiguous-host-call"
        : !start ? "missing-start"
        : finished ? "already-finished-host-call"
        : start.data.observer_epoch !== data.observer_epoch ? "observer-restarted"
        : start.data.capture_gap === true ? "capture-gap"
        : start.session_id !== actor.session_id || start.agent !== actor.agent ? "actor-mismatch"
        : start.data.input_digest !== data.input_digest ? "input-mismatch"
        : undefined
      const matched = reason === undefined ? start : undefined
      // Capture-off permits only an unambiguous finish of previously captured work.
      // Do not record a disabled/uncertain call just to diagnose why it cannot pair.
      if (!recordUnpaired && !matched) return undefined
      const focus = matched?.action_id ? { action_id: matched.action_id, ...(matched.node_id ? { node_id: matched.node_id } : {}) } : undefined
      return this.observe(matched ? { session_id: matched.session_id, agent: matched.agent } : actor, focus,
        { ...data, ...(matched ? { start_id: matched.id } : {}),
          attribution: matched ? "captured-at-start" : `${reason}; not assigned to current work` }, matched?.fingerprint)
    })
  }
  private append(input: Omit<LedgerRecord, "id" | "created_at">): LedgerRecord {
    const r: LedgerRecord = { ...input, id: randomUUID(), created_at: now() }
    this.db.prepare("INSERT INTO ledger(id,action_id,session_id,kind,data) VALUES(?,?,?,?,?)").run(r.id, r.action_id ?? null, r.session_id, r.kind, JSON.stringify(r))
    return r
  }
  record(actor: Actor, focus: Focus, input: { kind: Exclude<RecordKind,"observation">; statement: string; evidence_ids?: string[]; verdict?: string; artifact_refs?: string[] }): LedgerRecord {
    if (!["claim", "result", "assessment", "qa"].includes(input.kind)) throw new Error("Only the host observer may record observations")
    const statement = nonempty(input.statement, "statement")
    const ids = input.evidence_ids ?? []
    if (!Array.isArray(ids) || ids.length > 100 || ids.some(x => typeof x !== "string")) throw new Error("evidence_ids must be a list of at most 100 IDs")
    if ((input.kind === "assessment" || input.kind === "qa") && !["pass", "fail", "inconclusive"].includes(input.verdict ?? "")) throw new Error("Review verdict must be pass, fail or inconclusive")
    const artifacts = input.artifact_refs ?? []
    if (!Array.isArray(artifacts) || artifacts.length > 50 || artifacts.some(x => typeof x !== "string" || x.length > 2000)) throw new Error("Invalid artifact_refs")
    return this.transaction(() => {
      const fingerprint = subject(this.action(focus.action_id), this.plan(focus.action_id), focus.node_id)
      for (const id of ids) {
        const row = this.db.prepare("SELECT data FROM ledger WHERE id=?").get(id)
        const r = row ? parse<LedgerRecord>(row) : undefined
        if (!r || r.kind !== "observation" || r.action_id !== focus.action_id) throw new Error(`Evidence must reference an existing observation in this Action: ${id}`)
      }
      return this.append({ ...actor, ...focus, fingerprint, kind: input.kind, data: { statement, evidence_ids: ids, ...(input.verdict ? { verdict: input.verdict } : {}), artifact_refs: artifacts, verification: "agent-reported; not independently validated by Loom" } })
    })
  }
  records(query: { action_id?: string; session_id?: string; node_id?: string; record_id?: string; after?: number; limit?: number }) {
    const after = query.after ?? 0, limit = query.limit ?? 30
    if (!Number.isSafeInteger(after) || after < 0 || !Number.isSafeInteger(limit) || limit < 1 || limit > 50) throw new Error("Invalid ledger page (limit 1-50)")
    if (!query.action_id && !query.session_id) throw new Error("Ledger queries need an Action or Session")
    if (query.action_id) this.action(query.action_id)
    const column = query.action_id ? "action_id" : "session_id"
    let where = `${column}=? AND seq>?`
    const params: unknown[] = [query.action_id ?? query.session_id, after]
    if (query.node_id) { where += " AND json_extract(data,'$.node_id')=?"; params.push(uid(query.node_id)) }
    if (query.record_id) { where += " AND id=?"; params.push(uid(query.record_id)) }
    const rows = this.db.prepare(`SELECT seq,data FROM ledger WHERE ${where} ORDER BY seq LIMIT ?`).all(...params, limit + 1) as { seq: number; data: string }[]
    const page = rows.slice(0, limit)
    return { items: page.map(row => ({ sequence: row.seq, ...parse<LedgerRecord>(row) })), next_after: rows.length > limit ? page.at(-1)!.seq : null }
  }
  /** One read-only snapshot; the callback must stay synchronous and never write. */
  contextSnapshot<T>(actionID: string, read: (action: Action, plan: Plan) => T): T {
    this.db.exec("BEGIN")
    try {
      const action = this.action(actionID)
      const row = this.db.prepare("SELECT data FROM plans WHERE action_id=? ORDER BY revision DESC LIMIT 1").get(actionID)
      const plan = row ? parse<Plan>(row) : { revision: 0, nodes: [] }
      const result = read(action, plan)
      this.db.exec("COMMIT")
      return result
    } catch (error) { this.db.exec("ROLLBACK"); throw error }
  }
  /**
   * Conclusions have their own indexed buckets. Routine observations cannot
   * evict them, and a busy Task cannot evict every dependency or review result.
   * Limits are a context sampling policy, not a completeness or truth claim.
   */
  contextRecords(actionID: string, nodeIDs?: string[]) {
    uid(actionID)
    const kinds = ["result", "qa", "assessment", "claim"] as const
    const allScopes = nodeIDs?.length ? [...new Set([nodeIDs[0], null, ...nodeIDs.slice(1)])] : [undefined]
    const scopes = allScopes.slice(0, 16)
    type Row = { seq: number; data: string }
    const decode = (row: Row) => ({ sequence: row.seq, ...parse<LedgerRecord>(row) })
    let hasMore = allScopes.length > scopes.length
    const groups = scopes.map(scope => kinds.map(kind => {
      const params: unknown[] = [actionID, kind]
      const scoped = scope !== undefined
      if (scoped) params.push(scope)
      const rows = this.db.prepare(`SELECT seq,data FROM ledger WHERE action_id=?
        AND kind<>'observation' AND kind=?${scoped ? " AND json_extract(data,'$.node_id') IS ?" : ""}
        ORDER BY seq DESC LIMIT 3`).all(...params) as Row[]
      if (rows.length > 2) hasMore = true
      return rows.slice(0, 2).map(decode)
    }))
    const conclusions: Array<ReturnType<typeof decode>> = []
    // First give each scope a recent result of each kind, then older context.
    for (let depth = 0; depth < 2; depth++) for (let kind = 0; kind < kinds.length; kind++) {
      for (const group of groups) {
        const record = group[kind][depth]
        if (record) conclusions.push(record)
      }
    }
    if (conclusions.length > 48) hasMore = true
    let filter = "action_id=? AND kind='observation'"
    const params: unknown[] = [actionID]
    if (nodeIDs?.length) {
      filter += ` AND (json_extract(data,'$.node_id') IS NULL OR json_extract(data,'$.node_id') IN (${nodeIDs.map(() => "?").join(",")}))`
      params.push(...nodeIDs)
    }
    const observations = this.db.prepare(`SELECT seq,data FROM ledger WHERE ${filter} ORDER BY seq DESC LIMIT 9`).all(...params) as Row[]
    return {
      conclusions: conclusions.slice(0, 48), observations: observations.slice(0, 8).map(decode),
      has_more: hasMore || observations.length > 8, scopes_omitted: allScopes.length - scopes.length,
    }
  }
  /** A matching contract is not a claim that the code or evidence is still current. */
  contractMatch(record: LedgerRecord): boolean | null {
    if (!record.action_id || !record.fingerprint) return null
    try { return subject(this.action(record.action_id), this.plan(record.action_id), record.node_id) === record.fingerprint } catch { return false }
  }
}
