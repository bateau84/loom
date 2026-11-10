import { randomUUID } from "node:crypto"
import type { Actor } from "./model.js"
import type { SQL } from "./store.js"

/** Durable source IDs, never transcript bodies or inferred objective membership. */
export type ObjectiveSource = {
  type: "native-message" | "native-call" | "ledger-record" | "external-ref" | "unavailable"
  id: string
  session_id?: string
  message_id?: string
  parent_session_id?: string
  action_id?: string
  node_id?: string
  event_kind?: string
  occurred_at_ms?: number
  verification: "native-context" | "provided-export-unverified" | "loom-ledger" | "declared-external" | "reported-gap"
}

export type ObjectivePhase =
  | "request" | "coordination" | "dispatch" | "handback" | "verification"
  | "corrective-dispatch" | "continuation" | "planned-increment"
  | "requirement-change" | "environment-failure" | "outcome"
  | "coverage-gap" | "link-correction"

type LinkInput = {
  objective_id: string
  phase: ObjectivePhase
  source: ObjectiveSource
  confidence?: "supported" | "uncertain"
  assessment?: "reported-done" | "reported-failed" | "pass" | "fail" | "inconclusive" | "confirm" | "reject"
  related_sequence?: number
  gap_reason?: "missing-child" | "compacted" | "denied-access" | "opaque-tool" | "missing-source" | "unknown"
  note?: string
}

type ObjectiveRow = {
  id: string; source_key: string; unit_key: string; label: string; created_at: string
  author_session: string; author_agent: string
}
type LinkRow = {
  sequence: number; objective_id: string; source_key: string; source_type: string
  source_id: string; source_session_id: string | null; source_message_id: string | null
  parent_session_id: string | null; action_id: string | null; node_id: string | null
  event_kind: string | null; verification: string; source_at_ms: number | null
  sort_ms: number; recorded_at: string; phase: ObjectivePhase
  confidence: string; assessment: string | null; related_sequence: number | null
  gap_reason: string | null; note: string | null; author_session: string; author_agent: string
  revised_relation?: string | null
}
const phases = new Set<ObjectivePhase>([
  "request", "coordination", "dispatch", "handback", "verification",
  "corrective-dispatch", "continuation", "planned-increment",
  "requirement-change", "environment-failure", "outcome", "coverage-gap", "link-correction",
])
const gaps = new Set(["missing-child", "compacted", "denied-access", "opaque-tool", "missing-source", "unknown"])
const simple = (v: unknown, field: string) => {
  if (typeof v !== "string" || !/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,119}$/.test(v))
    throw new Error(`Invalid ${field}: expected a short source identifier`)
  return v
}
const bounded = (v: unknown, field: string, max: number) => {
  if (typeof v !== "string" || !v.trim() || v.length > max)
    throw new Error(`${field} must be 1-${max} characters`)
  return v
}
const pageSize = (n: unknown, fallback: number, max: number) => {
  const v = n === undefined ? fallback : n
  if (!Number.isSafeInteger(v) || (v as number) < 1 || (v as number) > max) throw new Error("Invalid objective page size")
  return v as number
}
const pageOffset = (n: unknown) => {
  const v = n === undefined ? 0 : n
  if (!Number.isSafeInteger(v) || (v as number) < 0 || (v as number) > 100000) throw new Error("Invalid objective offset")
  return v as number
}
const utc = () => new Date().toISOString()
const safeInt = (x: unknown) => Number.isSafeInteger(x) && (x as number) >= 0
const stamp = (x: unknown) => {
  if (x === undefined) return undefined
  if (!safeInt(x) || (x as number) > 20000000000000) throw new Error("Invalid source timestamp")
  return x as number
}

/** A source identity is independent of its role in a particular objective.
 * Repeated sources may belong to several objectives, or to none. */
export function objectiveSourceKey(source: Pick<ObjectiveSource, "type" | "id" | "session_id" | "message_id">) {
  if (source.type === "external-ref") {
    const url = bounded(source.id, "external source URL", 300)
    // No query parameters, fragment, credentials or arbitrary unqualified paths.
    if (!/^https:\/\/[A-Za-z0-9.-]+\/[A-Za-z0-9._~/%:-]+$/.test(url) || url.includes(".."))
      throw new Error("External evidence must be an HTTPS source URL without credentials, query or fragment")
    if (source.session_id !== undefined || source.message_id !== undefined) throw new Error("External source has no native Session")
  } else {
    simple(source.id, "source_id")
  }
  if (source.type === "native-message" || source.type === "native-call") {
    simple(source.session_id, "source_session_id")
    if (source.type === "native-call") simple(source.message_id, "source_message_id")
    else if (source.message_id !== undefined) throw new Error("native-message does not take a separate message ID")
  } else if (source.type === "ledger-record") {
    if (source.session_id !== undefined) simple(source.session_id, "original record Session")
    if (source.message_id !== undefined) throw new Error("Ledger evidence does not have a native message ID")
  } else if (source.session_id !== undefined || source.message_id !== undefined)
    throw new Error("Only native or ledger sources carry a Session scope")
  if (!["native-message", "native-call", "ledger-record", "external-ref", "unavailable"].includes(source.type))
    throw new Error("Unsupported objective source type")
  const native = source.type === "native-message" || source.type === "native-call"
  return JSON.stringify([source.type, native ? source.session_id ?? null : null,
    native ? source.message_id ?? null : null, source.id])
}

type PageCursor = { v: 1; objective: string; max: number; time: number; sequence: number }
function decodeCursor(raw: string, objective: string): PageCursor {
  if (typeof raw !== "string" || raw.length > 512 || !/^[A-Za-z0-9_-]+$/.test(raw)) throw new Error("Invalid objective cursor")
  let data: Record<string, unknown>
  try { data = JSON.parse(Buffer.from(raw, "base64url").toString("utf8")) as Record<string, unknown> }
  catch { throw new Error("Invalid objective cursor") }
  if (data.v !== 1 || data.objective !== objective || !safeInt(data.max) ||
      !safeInt(data.time) || !safeInt(data.sequence) || (data.sequence as number) > (data.max as number) ||
      Object.keys(data).sort().join(",") !== "max,objective,sequence,time,v")
    throw new Error("Objective cursor does not match this objective or its bounds")
  return data as PageCursor
}
const encodeCursor = (cursor: PageCursor) => Buffer.from(JSON.stringify(cursor)).toString("base64url")

/** An optional, append-only interpretation index over source facts.
 * The Action database remains authoritative; these rows are not work controls. */
export class ObjectiveIndex {
  constructor(private db: SQL, private actionDB: SQL) {
    db.exec(`CREATE TABLE IF NOT EXISTS learning_objectives (
      id TEXT PRIMARY KEY, source_key TEXT NOT NULL, unit_key TEXT NOT NULL,
      label TEXT NOT NULL, created_at TEXT NOT NULL, author_session TEXT NOT NULL, author_agent TEXT NOT NULL,
      UNIQUE(source_key, unit_key)
    );
    CREATE TABLE IF NOT EXISTS learning_objective_links (
      sequence INTEGER PRIMARY KEY AUTOINCREMENT, objective_id TEXT NOT NULL REFERENCES learning_objectives(id),
      source_key TEXT NOT NULL, source_type TEXT NOT NULL, source_id TEXT NOT NULL,
      source_session_id TEXT, source_message_id TEXT, parent_session_id TEXT,
      action_id TEXT, node_id TEXT, event_kind TEXT, verification TEXT NOT NULL,
      source_at_ms INTEGER, sort_ms INTEGER NOT NULL, recorded_at TEXT NOT NULL,
      phase TEXT NOT NULL, confidence TEXT NOT NULL, assessment TEXT, related_sequence INTEGER,
      gap_reason TEXT, note TEXT, author_session TEXT NOT NULL, author_agent TEXT NOT NULL
    );
    CREATE UNIQUE INDEX IF NOT EXISTS learning_objective_link_identity ON learning_objective_links
      (objective_id, source_key, phase, IFNULL(related_sequence, 0));
    CREATE INDEX IF NOT EXISTS learning_objective_timeline ON learning_objective_links(objective_id, sort_ms, sequence);
    CREATE INDEX IF NOT EXISTS learning_objective_related ON learning_objective_links(objective_id, related_sequence, sequence);
    CREATE INDEX IF NOT EXISTS learning_objective_source ON learning_objective_links(source_key, objective_id);`)
  }

  private transaction<T>(fn: () => T): T {
    this.db.exec("BEGIN IMMEDIATE")
    try { const result = fn(); this.db.exec("COMMIT"); return result }
    catch (error) { this.db.exec("ROLLBACK"); throw error }
  }

  /** Resolve a real ledger row by ID without materializing its private body. */
  ledgerSource(recordID: string): ObjectiveSource {
    const row = this.actionDB.prepare(`SELECT id,session_id,action_id,kind,octet_length(data) AS data_bytes,
      CASE WHEN octet_length(data)<=393216 THEN json_extract(data,'$.node_id') END AS node_id,
      CASE WHEN octet_length(data)<=393216 THEN json_extract(data,'$.created_at') END AS occurred_at
      FROM ledger WHERE id=?`).get(simple(recordID, "record_id")) as
      { id: string; session_id: string; action_id: string | null; node_id: string | null; kind: string; occurred_at: string | null; data_bytes: number } | undefined
    if (!row) throw new Error("Unknown original Loom ledger record")
    if (!Number.isSafeInteger(row.data_bytes) || row.data_bytes > 393216)
      throw new Error("Original ledger record exceeds bounded source projection; no objective link added")
    const occurred = row.occurred_at ? Date.parse(row.occurred_at) : NaN
    return { type: "ledger-record", id: row.id, verification: "loom-ledger",
      session_id: row.session_id, event_kind: row.kind,
      ...(Number.isSafeInteger(occurred) && occurred >= 0 ? { occurred_at_ms: occurred } : {}),
      ...(row.action_id ? { action_id: row.action_id } : {}),
      ...(row.node_id ? { node_id: row.node_id } : {}) }
  }

  create(actor: Actor, source: ObjectiveSource, label: string, unitKey = "whole") {
    const key = objectiveSourceKey(source), unit = simple(unitKey, "unit_key"), title = bounded(label, "label", 200)
    return this.transaction(() => {
      const previous = this.db.prepare("SELECT * FROM learning_objectives WHERE source_key=? AND unit_key=?").get(key, unit) as ObjectiveRow | undefined
      if (previous) {
        if (previous.label !== title) throw new Error("Objective anchor already exists with another label; use its original ID")
        return { ...previous, existing: true, authority: "source-linked interpretation, not a proof of outcome" }
      }
      const entry: ObjectiveRow = { id: randomUUID(), source_key: key, unit_key: unit,
        label: title, created_at: utc(), author_session: simple(actor.session_id, "author Session"),
        author_agent: simple(actor.agent, "author agent") }
      this.db.prepare("INSERT INTO learning_objectives(id,source_key,unit_key,label,created_at,author_session,author_agent) VALUES(?,?,?,?,?,?,?)")
        .run(entry.id, entry.source_key, entry.unit_key, entry.label, entry.created_at, entry.author_session, entry.author_agent)
      this.insert(actor, { objective_id: entry.id, phase: "request", source, confidence: "supported" })
      return { ...entry, existing: false, authority: "source-linked interpretation, not a proof of outcome" }
    })
  }

  link(actor: Actor, input: LinkInput) {
    return this.transaction(() => this.insert(actor, input))
  }

  private insert(actor: Actor, input: LinkInput) {
    const objective = simple(input.objective_id, "objective_id")
    if (!this.db.prepare("SELECT 1 FROM learning_objectives WHERE id=?").get(objective)) throw new Error("Unknown objective")
    if (!phases.has(input.phase)) throw new Error("Invalid objective phase")
    const source = input.source, key = objectiveSourceKey(source)
    const confidence = input.confidence ?? "supported"
    if (!["supported", "uncertain"].includes(confidence)) throw new Error("Invalid relationship confidence")
    const assessment = input.assessment ?? null
    const allowed = input.phase === "handback" ? ["reported-done", "reported-failed", "inconclusive"]
      : input.phase === "verification" || input.phase === "outcome" ? ["pass", "fail", "inconclusive"]
      : input.phase === "link-correction" ? ["confirm", "reject"] : []
    if ((allowed.length && !assessment) || (assessment && !allowed.includes(assessment)))
      throw new Error("Assessment must match the phase; reported completion is not verified outcome")
    if (input.phase === "coverage-gap" && !gaps.has(input.gap_reason ?? ""))
      throw new Error("A coverage gap requires its explicit reason")
    if (input.phase !== "coverage-gap" && input.gap_reason !== undefined) throw new Error("Only coverage gaps have gap_reason")
    if (source.type === "unavailable" && input.phase !== "coverage-gap")
      throw new Error("An unavailable source can only support a reported coverage gap")
    if (source.type === "native-call" && ["dispatch", "corrective-dispatch"].includes(input.phase) && source.event_kind !== "agent_dispatch")
      throw new Error("Native tool call does not establish direct dispatch; record opaque delegation as a gap")
    if (input.phase === "link-correction" || input.phase === "continuation" || input.phase === "corrective-dispatch") {
      if (input.related_sequence === undefined) throw new Error("This relationship requires an earlier linked source sequence")
    }
    const related = input.related_sequence === undefined ? null : input.related_sequence
    if (related !== null) {
      if (!Number.isSafeInteger(related) || related < 1 ||
          !this.db.prepare("SELECT 1 FROM learning_objective_links WHERE objective_id=? AND sequence=?").get(objective, related))
        throw new Error("Related source must be an earlier link in this objective")
    }
    const note = input.note === undefined ? null : bounded(input.note, "interpretation note", 800)
    if (confidence === "uncertain" && !note) throw new Error("Uncertain attribution requires an explanation")
    const existing = this.db.prepare(`SELECT * FROM learning_objective_links WHERE objective_id=? AND source_key=? AND phase=?
      AND IFNULL(related_sequence,0)=?`)
      .get(objective, key, input.phase, related ?? 0) as LinkRow | undefined
    if (existing) {
      if (existing.confidence !== confidence || existing.note !== note || existing.gap_reason !== (input.gap_reason ?? null) || existing.assessment !== assessment)
        throw new Error("This source link exists with another interpretation; append a sourced correction instead")
      return { ...existing, existing: true }
    }
    const recordedAt = utc(), time = stamp(source.occurred_at_ms)
    const verification = bounded(source.verification, "source verification", 64)
    if (!["native-context", "provided-export-unverified", "loom-ledger", "declared-external", "reported-gap"].includes(verification))
      throw new Error("Unsupported source verification")
    if ((source.type === "native-message" || source.type === "native-call") &&
      !["native-context", "provided-export-unverified"].includes(verification))
      throw new Error("Native source must have been inspected through its authorized host path")
    if (source.type === "ledger-record" && verification !== "loom-ledger") throw new Error("Ledger source needs a resolved original record")
    if (source.type === "external-ref" && verification !== "declared-external") throw new Error("External source is not host-verified")
    if (source.type === "unavailable" && verification !== "reported-gap") throw new Error("Missing source is an authored gap")
    this.db.prepare(`INSERT INTO learning_objective_links
      (objective_id,source_key,source_type,source_id,source_session_id,source_message_id,parent_session_id,
       action_id,node_id,event_kind,verification,source_at_ms,sort_ms,recorded_at,phase,confidence,
       assessment,related_sequence,gap_reason,note,author_session,author_agent)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
      objective, key, source.type, source.id, source.session_id ?? null, source.message_id ?? null,
      source.parent_session_id ?? null, source.action_id ?? null, source.node_id ?? null,
      source.event_kind ?? null, verification, time ?? null,
      input.phase === "link-correction" ? Date.parse(recordedAt) : time ?? Date.parse(recordedAt), recordedAt,
      input.phase, confidence, assessment, related, input.gap_reason ?? null, note,
      simple(actor.session_id, "author Session"), simple(actor.agent, "author agent"))
    const row = this.db.prepare("SELECT * FROM learning_objective_links WHERE sequence=last_insert_rowid()").get() as LinkRow
    return { ...row, existing: false }
  }

  list(offset?: number) {
    const skip = pageOffset(offset)
    const rows = this.db.prepare("SELECT id,unit_key,label,created_at,author_session,author_agent FROM learning_objectives ORDER BY rowid DESC LIMIT 21 OFFSET ?")
      .all(skip) as ObjectiveRow[]
    return { items: rows.slice(0, 20), next_offset: rows.length > 20 ? skip + 20 : null,
      note: "These are authored objective identities, not verified unique goals or successes." }
  }

  /** Cross-objective lookup is a list of candidates, not automatic coalescing. */
  find(source: Pick<ObjectiveSource, "type" | "id" | "session_id" | "message_id">, offset?: number) {
    const key = objectiveSourceKey(source), skip = pageOffset(offset)
    const rows = this.db.prepare(`SELECT o.id,o.unit_key,o.label,o.created_at
      FROM (SELECT id AS objective_id FROM learning_objectives WHERE source_key=?
        UNION SELECT objective_id FROM learning_objective_links WHERE source_key=?) AS candidates
      JOIN learning_objectives o ON o.id=candidates.objective_id
      ORDER BY o.created_at,o.id LIMIT 21 OFFSET ?`).all(key, key, skip) as ObjectiveRow[]
    return { items: rows.slice(0, 20), next_offset: rows.length > 20 ? skip + 20 : null,
      interpretation: "Shared source IDs do not establish that objectives should be merged." }
  }

  /** Stable insertion-bound snapshot, ordered by original event time where known.
   * Later judgments remain new rows, never rewrites of earlier DONE claims. */
  read(objectiveID: string, cursor?: string, limit?: number) {
    const objective = this.db.prepare("SELECT * FROM learning_objectives WHERE id=?").get(simple(objectiveID, "objective_id")) as ObjectiveRow | undefined
    if (!objective) throw new Error("Unknown objective")
    const take = pageSize(limit, 20, 50)
    const max = this.db.prepare("SELECT COALESCE(MAX(sequence),0) AS max FROM learning_objective_links WHERE objective_id=?").get(objective.id) as { max: number }
    const pos = cursor === undefined
      ? { v: 1 as const, objective: objective.id, max: max.max, time: 0, sequence: 0 }
      : decodeCursor(cursor, objective.id)
    if (pos.max > max.max) throw new Error("Objective cursor exceeds current stored history")
    const rows = this.db.prepare(`SELECT l.*,
      (SELECT c.assessment FROM learning_objective_links c
       WHERE c.objective_id=l.objective_id AND c.related_sequence=l.sequence
         AND c.phase='link-correction' AND c.sequence<=?
       ORDER BY c.sequence DESC LIMIT 1) AS revised_relation
      FROM learning_objective_links l
      WHERE l.objective_id=? AND l.sequence<=?
        AND (l.sort_ms>? OR (l.sort_ms=? AND l.sequence>?))
      ORDER BY l.sort_ms,l.sequence LIMIT ?`)
      .all(pos.max, objective.id, pos.max, pos.time, pos.time, pos.sequence, take + 1) as LinkRow[]
    const page = rows.slice(0, take)
    const last = page.at(-1)
    return { objective: { ...objective, source_key: undefined }, entries: page.map(({ source_key: _key, revised_relation, ...row }) => ({
      ...row,
      current_relationship: revised_relation === "reject" ? "rejected" :
        revised_relation === "confirm" ? "supported" : row.confidence,
    })), next_cursor: rows.length > take && last
      ? encodeCursor({ v: 1, objective: objective.id, max: pos.max, time: last.sort_ms, sequence: last.sequence }) : null,
      snapshot_max_sequence: pos.max,
      coverage: { native_history: "only explicitly linked inspected sources", completeness: "unknown",
        raw_transcripts_stored: false, parentage_is_objective_identity: false },
      note: "Source projections are facts with stated verification limits. Phases, confidence, interpretations and outcome judgments are authored; neither a reported DONE nor an annotated pass is host-certified correctness. Follow pages and original authorized sources; gaps and uncertain links remain visible.",
    }
  }
}
