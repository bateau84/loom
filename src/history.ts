import { createHash, randomUUID } from "node:crypto"
import { canonical, PROCESSING_LIMITS, ProcessingBudget, type LedgerRecord, uid } from "./model.js"
import type { SQL, Store } from "./store.js"

export type HistoryScope = { action_id: string; node_id?: string } | { session_id: string }
export type HistoryQuery = { action_id?: string; node_id?: string; session_id?: string; cursor?: string; limit?: number }
export type HistoryRecord = LedgerRecord & { sequence: number }
export type HistoryPage = {
  scope: HistoryScope; items: HistoryRecord[]; offset: number; next_cursor: string | null
  /** Advance only after the renderer has emitted the complete record. */
  cursorAfter(recordID: string): string
  /** Renderer-owned UTF-16 offset; repeat this exact record, without advancing it.
   * The renderer must validate the offset against its versioned representation.
   */
  cursorWithin(recordID: string, offset: number): string
}

// Increment when the membership or continuation representation changes. This is
// not a ledger revision or a concurrent-history snapshot/perpetual cursor promise.
export const HISTORY_CURSOR_VERSION = "loom-full-history/v1"
type Position = { after: number; part?: { sequence: number; id: string; digest: string; offset: number } }
type Candidate = { seq: number; id: string; action_id: string | null; session_id: string; kind: string; node_id: string | null; data_bytes: number }
const memoryIDs = new WeakMap<object, string>()
const hash = (text: string) => createHash("sha256").update(text).digest("hex")
const integer = (n: unknown): n is number => Number.isSafeInteger(n) && (n as number) >= 0
const mapping = (x: unknown): x is Record<string, unknown> => !!x && typeof x === "object" && !Array.isArray(x)
const keys = (x: Record<string, unknown>, allowed: string[]) => Object.keys(x).every(k => allowed.includes(k))
const kinds = new Set(["observation", "claim", "result", "concern", "assessment", "qa", "completion", "reopen", "question", "answer",
  "assignment", "delivery-intent", "continuation-authorization", "continuation-withdrawal", "delivery-event"])

function scopeOf(query: HistoryQuery): HistoryScope {
  if (!mapping(query) || !keys(query, ["action_id", "node_id", "session_id", "cursor", "limit"])) throw new Error("Invalid full history query fields")
  if (query.session_id !== undefined) {
    if (query.action_id !== undefined || query.node_id !== undefined) throw new Error("Session history cannot include an Action or node")
    return { session_id: uid(query.session_id, "session_id") }
  }
  if (query.action_id === undefined) throw new Error("Full history requires an explicit action_id or session_id")
  return { action_id: uid(query.action_id, "action_id"), ...(query.node_id !== undefined ? { node_id: uid(query.node_id, "node_id") } : {}) }
}

/** Local Store-only relational history. No host, selected scope or delivery state. */
export class FullHistory {
  constructor(private store: Store, private db: SQL) {}
  private binding(scope: HistoryScope) {
    const location = this.store.captureScope()
    let identity: string
    if (typeof location === "string") identity = location
    else {
      let id = memoryIDs.get(location)
      if (!id) { id = randomUUID(); memoryIDs.set(location, id) }
      identity = id
    }
    return hash(canonical({ location: identity, scope }))
  }
  private decode(cursor: unknown, binding: string): Position {
    if (cursor === undefined) return { after: 0 }
    const invalid = () => new Error("Invalid full history cursor: malformed, scope/location/version mismatch or unsupported continuation; restart this scope")
    if (typeof cursor !== "string" || cursor.length > 4096 || !/^[A-Za-z0-9_-]+$/.test(cursor)) throw invalid()
    const bytes = Buffer.from(cursor, "base64url")
    if (bytes.toString("base64url") !== cursor) throw invalid()
    let value: unknown
    try { value = JSON.parse(bytes.toString("utf8")) } catch { throw invalid() }
    if (!mapping(value) || !keys(value, ["version", "binding", "after", "part"]) || value.version !== HISTORY_CURSOR_VERSION || value.binding !== binding || !integer(value.after)) throw invalid()
    const part = value.part
    if (part !== undefined && (!mapping(part) || !keys(part, ["sequence", "id", "digest", "offset"])
      || !integer(part.sequence) || part.sequence <= value.after || !integer(part.offset)
      || typeof part.id !== "string" || typeof part.digest !== "string" || !/^[a-f0-9]{64}$/.test(part.digest))) throw invalid()
    if (part !== undefined) {
      uid((part as Record<string, unknown>).id, "cursor record id")
      return { after: value.after, part: part as Position["part"] }
    }
    return { after: value.after }
  }
  private encode(binding: string, position: Position) {
    return Buffer.from(JSON.stringify({ version: HISTORY_CURSOR_VERSION, binding, ...position })).toString("base64url")
  }
  private candidates(scope: HistoryScope, after: number, limit: number): Candidate[] {
    const params: unknown[] = []
    const owned = (alias: string) => {
      if ("session_id" in scope) { params.push(scope.session_id); return `${alias}.session_id=?` }
      params.push(scope.action_id)
      if (scope.node_id === undefined) return `${alias}.action_id=?`
      params.push(scope.node_id)
      const node = alias === "q" ? "q.node_id" : `json_extract(${alias}.data,'$.node_id')`
      return `(${alias}.action_id=? AND ${node}=?)`
    }
    const sameScope = (a: string, q: string) => `${a}.action_id IS ${q}.action_id AND json_extract(${a}.data,'$.node_id') IS ${q}.node_id`
    // Only question/answer links seed conversations. Advisory agent names,
    // assignments, notices (even admitted ones), attachments and evidence do not.
    const questionOwned = owned("q"), answerOwned = owned("a")
    params.push(after)
    const recordOwned = owned("r")
    return this.db.prepare(`WITH questions AS (
      SELECT id,action_id,json_extract(data,'$.node_id') AS node_id,session_id FROM ledger WHERE kind='question'
    ), seeds AS (
      SELECT q.* FROM questions q WHERE ${questionOwned} OR EXISTS (
        SELECT 1 FROM ledger a WHERE a.kind='answer' AND ${answerOwned}
          AND json_extract(a.data,'$.data.question_id')=q.id AND ${sameScope("a", "q")}
      )
    ) SELECT r.seq,r.id,r.action_id,r.session_id,r.kind,json_extract(r.data,'$.node_id') AS node_id,octet_length(r.data) AS data_bytes
      FROM ledger r WHERE r.seq>? AND (${recordOwned}
        OR (r.kind='question' AND EXISTS (SELECT 1 FROM seeds q WHERE q.id=r.id))
        OR (r.kind='answer' AND EXISTS (SELECT 1 FROM seeds q WHERE json_extract(r.data,'$.data.question_id')=q.id AND ${sameScope("r", "q")})))
      ORDER BY r.seq LIMIT ?`).all(...params, limit + 1) as Candidate[]
  }
  read(query: HistoryQuery): HistoryPage {
    const scope = scopeOf(query), limit = query.limit === undefined ? 20 : query.limit
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 50) throw new Error("Invalid full history page (limit 1-50)")
    const binding = this.binding(scope), position = this.decode(query.cursor, binding)
    this.db.exec("BEGIN")
    try {
      if ("action_id" in scope) this.store.action(scope.action_id)
      // Removed nodes deliberately need no current Plan entry. Reserve metadata
      // first; the existing hydrator enforces per-row and aggregate read budgets.
      const candidates = this.candidates(scope, position.after, limit), selected = candidates.slice(0, limit)
      const items = this.store.hydrateLedger(selected)
      const digests = new Map<string, string>()
      for (let i = 0; i < items.length; i++) {
        const r = items[i], c = selected[i]
        if (!mapping(r) || r.sequence !== c.seq || r.id !== c.id || r.session_id !== c.session_id || (r.action_id ?? null) !== c.action_id
          || (r.node_id ?? null) !== c.node_id || r.kind !== c.kind || !kinds.has(r.kind) || !mapping(r.data)
          || typeof r.agent !== "string" || !r.agent || typeof r.created_at !== "string" || !r.created_at) throw new Error(`Corrupt or unsupported full history record at sequence ${c.seq}; cursor not advanced`)
        uid(r.id); uid(r.session_id); if (r.action_id !== undefined) uid(r.action_id); if (r.node_id !== undefined) uid(r.node_id)
        digests.set(r.id, hash(canonical(r, new ProcessingBudget(PROCESSING_LIMITS.recordChars + 100))))
      }
      if (position.part && (items[0]?.sequence !== position.part.sequence || items[0]?.id !== position.part.id || digests.get(items[0].id) !== position.part.digest))
        throw new Error("Full history continuation record changed, disappeared or is no longer eligible; cursor not advanced; restart this scope")
      const find = (id: string) => {
        const index = items.findIndex(r => r.id === id)
        if (index < 0) throw new Error("Continuation must identify a record on this full history page")
        return index
      }
      const cursorAfter = (id: string) => this.encode(binding, { after: items[find(id)].sequence })
      const cursorWithin = (id: string, offset: number) => {
        if (!integer(offset)) throw new Error("Invalid full history part offset")
        const index = find(id), record = items[index]
        return this.encode(binding, { after: index ? items[index - 1].sequence : position.after,
          part: { sequence: record.sequence, id: record.id, digest: digests.get(id)!, offset } })
      }
      const result = { scope, items, offset: position.part?.offset ?? 0,
        next_cursor: candidates.length > limit ? cursorAfter(items.at(-1)!.id) : null, cursorAfter, cursorWithin }
      this.db.exec("COMMIT")
      return result
    } catch (error) { this.db.exec("ROLLBACK"); throw error }
  }
}
