import { createHash, randomUUID } from "node:crypto"
import { canonical, ProcessingBudget, ProcessingLimitError, type Actor } from "./model.js"
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

export const OBJECTIVE_RELATIONS = ["supports", "contradicts", "addresses", "assesses", "supersedes", "contests"] as const
export type ObjectiveRelation = typeof OBJECTIVE_RELATIONS[number]
type LinkInput = {
  objective_id: string
  phase: ObjectivePhase
  source: ObjectiveSource
  confidence?: "supported" | "uncertain"
  assessment?: "reported-done" | "reported-failed" | "pass" | "fail" | "inconclusive" | "confirm" | "reject"
  related_sequence?: number
  gap_reason?: "missing-child" | "compacted" | "denied-access" | "opaque-tool" | "missing-source" | "unknown"
  note?: string
  /** An attributed interpretation of two original sources, never native provenance. */
  relation?: ObjectiveRelation
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
  relation: ObjectiveRelation | null
}
export type ObjectiveHistorySelection = {
  action_id?: string; session_id?: string; objective_id?: string;
  ledger_through?: number; link_through?: number;
}
export type ObjectiveHistorySources = {
  contributors: string[]; ledger_record_ids: string[]; ledger_through: number; link_through: number; digest: string;
}
export type ObjectiveHistoryLink = Omit<LinkRow, "source_key" | "revised_relation"> & {
  current_relationship: string; source_availability: "record-available" | "reference-only";
}
export type ObjectiveHistorySnapshot = ObjectiveHistorySources & {
  objectives: Array<Omit<ObjectiveRow, "source_key">>; links: ObjectiveHistoryLink[];
  gaps: Array<{ code: string; detail: string }>; content_digest: string;
}
const HISTORY_LIMITS = { ledger: 100000, objectives: 1000, links: 10000, bytes: 8 * 1024 * 1024, originalBytes: 64 * 1024 * 1024 } as const
type HistoryLedger = { id: string; seq: number; session_id: string; action_id: string | null; data_bytes: number }
type HistoryLink = Omit<LinkRow, "note" | "source_key" | "revised_relation"> & { row_bytes: number }
const historyLedgerColumns = `CASE WHEN typeof(id)='text' AND octet_length(id) BETWEEN 1 AND 120 THEN id END AS id,seq,
  CASE WHEN typeof(session_id)='text' AND octet_length(session_id) BETWEEN 1 AND 120 THEN session_id END AS session_id,
  CASE WHEN typeof(action_id)='text' AND octet_length(action_id) BETWEEN 1 AND 120 THEN action_id END AS action_id,
  CASE WHEN action_id IS NULL OR typeof(action_id)='text' AND octet_length(action_id) BETWEEN 1 AND 120 THEN 1 ELSE 0 END AS action_valid,
  octet_length(data) AS data_bytes`
const historyDigest = (value: unknown) => createHash("sha256").update(canonical(value,
  new ProcessingBudget(HISTORY_LIMITS.bytes, 1000000))).digest("hex")
const historyLinkBytes = ["objective_id", "source_key", "source_type", "source_id", "source_session_id", "source_message_id", "parent_session_id",
  "action_id", "node_id", "event_kind", "verification", "recorded_at", "phase", "confidence", "assessment", "gap_reason", "note", "author_session", "author_agent", "relation"]
  .map(column => `COALESCE(octet_length(${column}),0)`).join("+") + "+256"
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
      gap_reason TEXT, note TEXT, author_session TEXT NOT NULL, author_agent TEXT NOT NULL, relation TEXT
    );
    CREATE UNIQUE INDEX IF NOT EXISTS learning_objective_link_identity ON learning_objective_links
      (objective_id, source_key, phase, IFNULL(related_sequence, 0));
    CREATE INDEX IF NOT EXISTS learning_objective_timeline ON learning_objective_links(objective_id, sort_ms, sequence);
    CREATE INDEX IF NOT EXISTS learning_objective_related ON learning_objective_links(objective_id, related_sequence, sequence);
    CREATE INDEX IF NOT EXISTS learning_objective_source ON learning_objective_links(source_key, objective_id);
    CREATE INDEX IF NOT EXISTS learning_objective_record_source ON learning_objective_links(source_type,source_id,sequence);`)
    // Additive owner-schema evolution. Original associations and notes are never rewritten.
    const columns = db.prepare("PRAGMA table_info(learning_objective_links)").all() as { name: string }[]
    if (!columns.some(column => column.name === "relation")) db.exec("ALTER TABLE learning_objective_links ADD COLUMN relation TEXT")
  }

  private transaction<T>(fn: () => T): T {
    this.db.exec("BEGIN IMMEDIATE")
    try { const result = fn(); this.db.exec("COMMIT"); return result }
    catch (error) { this.db.exec("ROLLBACK"); throw error }
  }

  /** Resolve a real ledger row by ID without materializing its private body. */
  ledgerSource(recordID: string): ObjectiveSource {
    // CASE guards are inside SQL: malformed or oversized scalars must never be
    // copied into the driver, even when the whole original record is bounded.
    const row = this.actionDB.prepare(`WITH bounded AS (
      SELECT ${historyLedgerColumns},
        CASE WHEN typeof(kind)='text' AND octet_length(kind) BETWEEN 1 AND 64 THEN kind END AS kind,
        CASE WHEN typeof(data)='text' AND octet_length(data)<=393216 THEN CASE WHEN json_valid(data) THEN data END END AS original
      FROM ledger WHERE id=?)
      SELECT id,session_id,action_id,action_valid,kind,data_bytes,
        CASE WHEN original IS NOT NULL THEN 1 ELSE 0 END AS original_valid,
        CASE WHEN json_type(original,'$.node_id')='text' AND octet_length(json_extract(original,'$.node_id')) BETWEEN 1 AND 120
          THEN json_extract(original,'$.node_id') END AS node_id,
        CASE WHEN json_type(original,'$.node_id') IS NULL OR json_type(original,'$.node_id')='null'
          OR json_type(original,'$.node_id')='text' AND octet_length(json_extract(original,'$.node_id')) BETWEEN 1 AND 120 THEN 1 ELSE 0 END AS node_valid,
        CASE WHEN json_type(original,'$.created_at')='text' AND octet_length(json_extract(original,'$.created_at')) BETWEEN 1 AND 64
          THEN json_extract(original,'$.created_at') END AS occurred_at,
        CASE WHEN json_type(original,'$.created_at') IS NULL OR json_type(original,'$.created_at')='null'
          OR json_type(original,'$.created_at')='text' AND octet_length(json_extract(original,'$.created_at')) BETWEEN 1 AND 64 THEN 1 ELSE 0 END AS occurred_valid
      FROM bounded`).get(simple(recordID, "record_id")) as
      { id: string; session_id: string; action_id: string | null; action_valid: number; node_id: string | null; kind: string | null;
        occurred_at: string | null; data_bytes: number; original_valid: number; node_valid: number; occurred_valid: number } | undefined
    if (!row) throw new Error("Unknown original Loom ledger record")
    if (!safeInt(row.data_bytes) || row.data_bytes > 393216 || row.original_valid !== 1 || row.action_valid !== 1
      || row.node_valid !== 1 || row.occurred_valid !== 1 || row.kind === null || row.id === null || row.session_id === null)
      throw new Error("Original ledger record exceeds bounded source projection; no objective link added")
    simple(row.id, "source record_id"); simple(row.session_id, "source Session"); simple(row.kind, "source event kind")
    if (row.action_id !== null) simple(row.action_id, "source Action")
    if (row.node_id !== null) simple(row.node_id, "source node_id")
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
    if (input.relation !== undefined && !OBJECTIVE_RELATIONS.includes(input.relation)) throw new Error("Invalid authored objective relation")
    if (input.relation !== undefined && (input.phase === "link-correction" || input.related_sequence === undefined || input.source.type !== "ledger-record"))
      throw new Error("An authored relation needs two original ledger sources; link-correction retains association-only meaning")
    const source = input.relation === undefined ? input.source : this.ledgerSource(input.source.id), key = objectiveSourceKey(source)
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
      if (input.relation !== undefined) {
        const target = this.db.prepare("SELECT source_type,source_id,related_sequence FROM learning_objective_links WHERE objective_id=? AND sequence=?")
          .get(objective, related) as { source_type: string; source_id: string; related_sequence: number | null }
        if (target.source_type !== "ledger-record" || target.source_id === source.id)
          throw new Error("An authored relation needs distinct original ledger sources")
        this.ledgerSource(target.source_id)
        // Every stored relation points backward to an existing link. Reject a
        // repeated source along that ancestry as well as a direct self edge.
        let predecessor: number | null = target.related_sequence, visited = 0
        while (predecessor !== null) {
          if (++visited > HISTORY_LIMITS.links) throw new ProcessingLimitError("objective relation ancestry exceeds its bounded validation")
          const prior = this.db.prepare("SELECT sequence,source_id,related_sequence FROM learning_objective_links WHERE objective_id=? AND sequence=?")
            .get(objective, predecessor) as { sequence: number; source_id: string; related_sequence: number | null } | undefined
          if (!prior || prior.related_sequence !== null && prior.related_sequence >= prior.sequence) throw new Error("Objective relation ancestry is invalid")
          if (prior.source_id === source.id) throw new Error("An authored objective relation cannot cycle through its source")
          predecessor = prior.related_sequence
        }
      }
    }
    const note = input.note === undefined ? null : bounded(input.note, "interpretation note", 800)
    if (confidence === "uncertain" && !note) throw new Error("Uncertain attribution requires an explanation")
    const existing = this.db.prepare(`SELECT * FROM learning_objective_links WHERE objective_id=? AND source_key=? AND phase=?
      AND IFNULL(related_sequence,0)=?`)
      .get(objective, key, input.phase, related ?? 0) as LinkRow | undefined
    if (existing) {
      if (existing.confidence !== confidence || existing.note !== note || existing.gap_reason !== (input.gap_reason ?? null) || existing.assessment !== assessment
        || existing.relation !== (input.relation ?? null))
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
       assessment,related_sequence,gap_reason,note,author_session,author_agent,relation)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
      objective, key, source.type, source.id, source.session_id ?? null, source.message_id ?? null,
      source.parent_session_id ?? null, source.action_id ?? null, source.node_id ?? null,
      source.event_kind ?? null, verification, time ?? null,
      input.phase === "link-correction" ? Date.parse(recordedAt) : time ?? Date.parse(recordedAt), recordedAt,
      input.phase, confidence, assessment, related, input.gap_reason ?? null, note,
      simple(actor.session_id, "author Session"), simple(actor.agent, "author agent"), input.relation ?? null)
    const row = this.db.prepare("SELECT * FROM learning_objective_links WHERE sequence=last_insert_rowid()").get() as LinkRow
    return { ...row, existing: false }
  }

  /** Internal permission preflight: no objective label or interpretation note is
   * materialized. The caller authorizes this contributor union before snapshot. */
  historySources(selection: ObjectiveHistorySelection): ObjectiveHistorySources {
    return this.historyRead(() => this.historySelection(selection).sources)
  }

  /** Read-only composition seam. It preserves original rows; omitted sources
   * never become identities or conclusions about a different scope. */
  historySnapshot(selection: ObjectiveHistorySelection): ObjectiveHistorySnapshot {
    return this.historyRead(() => {
      const selected = this.historySelection(selection)
      const { sources, metadata, objectives: identities } = selected
      const objectives: ObjectiveHistorySnapshot["objectives"] = []
      for (const identity of identities) {
        const row = this.db.prepare("SELECT id,unit_key,label,created_at,author_session,author_agent FROM learning_objectives WHERE id=?").get(identity.id) as Omit<ObjectiveRow, "source_key"> | undefined
        if (!row || row.author_session !== identity.author_session || row.author_agent !== identity.author_agent
          || row.created_at !== identity.created_at || row.unit_key !== identity.unit_key) throw new Error("Objective history source changed during read")
        bounded(row.label, "stored objective label", 200)
        objectives.push(row)
      }
      const corrections = new Map<number, string>()
      for (const row of metadata) if (row.phase === "link-correction" && row.related_sequence !== null) corrections.set(row.related_sequence, row.assessment ?? "")
      const links = metadata.map(meta => {
        // The byte bound was reserved before hydration; guard this reread too so
        // a replaced source cannot cross the driver's allocation boundary.
        const body = this.db.prepare("SELECT CASE WHEN note IS NULL OR (typeof(note)='text' AND octet_length(note)<=2400) THEN note END AS note, octet_length(note) AS note_bytes FROM learning_objective_links WHERE sequence=? AND objective_id=?")
          .get(meta.sequence, meta.objective_id) as { note: string | null; note_bytes: number | null } | undefined
        if (!body || body.note_bytes !== null && (body.note_bytes > 2400 || typeof body.note !== "string")) throw new Error("Objective history note is unavailable or oversized")
        if (body.note !== null) bounded(body.note, "stored interpretation note", 800)
        if (meta.confidence === "uncertain" && body.note === null) throw new Error("Uncertain objective association is missing its explanation")
        const { row_bytes: _bytes, ...row } = meta
        const correction = corrections.get(row.sequence)
        const link: ObjectiveHistoryLink = { ...row, note: body.note,
          current_relationship: correction === "reject" ? "rejected" : correction === "confirm" ? "supported" : row.confidence,
          source_availability: row.source_type === "ledger-record" ? "record-available" : "reference-only" }
        return link
      })
      const gaps = [
        { code: "authored-objective-associations", detail: "Objective membership, phases, confidence and typed relations are attributed interpretations. Source resolution does not establish causation, native dispatch, historical review membership or verified correctness." },
        { code: "objective-source-scope", detail: "Only sources available within the selected scope and pinned append boundaries are projected. Unavailable or outside source identities and their associations are withheld; source coverage and overall objective completeness remain unknown." },
        { code: "association-correction-only", detail: "link-correction confirms or rejects an objective association. It does not correct the truth of the source claim. current_relationship considers only corrections visible within this selected scope and boundary." },
      ]
      return { ...sources, objectives, links, gaps, content_digest: historyDigest({ objectives, links, gaps }) }
    })
  }

  private historyRead<T>(read: () => T): T {
    const opened: SQL[] = []
    try {
      // Reuse the source owners' vector-snapshot convention: one read snapshot
      // per existing database, not a claim of cross-database atomicity or freeze.
      for (const db of new Set([this.db, this.actionDB])) { db.exec("BEGIN"); opened.push(db) }
      const result = read()
      for (const db of [...opened].reverse()) db.exec("COMMIT")
      return result
    } catch (error) {
      for (const db of [...opened].reverse()) try { db.exec("ROLLBACK") } catch { /* Preserve the original source failure. */ }
      throw error
    }
  }

  private historySelection(selection: ObjectiveHistorySelection) {
    if (!selection || typeof selection !== "object" || Array.isArray(selection)
      || Object.keys(selection).some(key => !["action_id", "session_id", "objective_id", "ledger_through", "link_through"].includes(key))
      || selection.action_id !== undefined && selection.session_id !== undefined
      || selection.action_id === undefined && selection.session_id === undefined && selection.objective_id === undefined)
      throw new Error("Objective history needs an explicit Action, Session or objective scope")
    for (const field of ["action_id", "session_id", "objective_id"] as const) if (selection[field] !== undefined) simple(selection[field], field)
    for (const field of ["ledger_through", "link_through"] as const) if (selection[field] !== undefined && !safeInt(selection[field])) throw new Error("Invalid objective history append boundary")
    const currentLink = this.db.prepare("SELECT COALESCE(MAX(sequence),0) AS n FROM learning_objective_links").get() as { n: number }
    const linkBound = selection.link_through ?? currentLink.n
    if (linkBound > currentLink.n) throw new Error("Objective history link boundary is unavailable")
    const scoped = selection.action_id !== undefined || selection.session_id !== undefined
    const currentLedger = this.actionDB.prepare(`SELECT COALESCE(MAX(seq),0) AS n FROM ledger${selection.action_id !== undefined ? " WHERE action_id=?" : selection.session_id !== undefined ? " WHERE session_id=?" : ""}`)
      .get(...(selection.action_id !== undefined ? [selection.action_id] : selection.session_id !== undefined ? [selection.session_id] : [])) as { n: number }
    const ledgerBound = selection.ledger_through ?? currentLedger.n
    if (ledgerBound > currentLedger.n) throw new Error("Objective history ledger boundary is unavailable")
    const ledger = new Map<string, HistoryLedger>()
    const rememberLedger = (rows: Array<HistoryLedger & { action_valid: number }>) => {
      for (const { action_valid, ...row } of rows) {
        if (action_valid !== 1) throw new Error("Original ledger source Action exceeds bounded source projection")
        simple(row.id, "source record_id"); simple(row.session_id, "source Session")
        if (row.action_id !== null) simple(row.action_id, "source Action")
        ledger.set(row.id, row)
      }
    }
    if (scoped) {
      const where = selection.action_id !== undefined ? "action_id=?" : "session_id=?"
      const rows = this.actionDB.prepare(`SELECT ${historyLedgerColumns} FROM ledger WHERE ${where} AND seq<=? ORDER BY seq LIMIT ?`)
        .all(selection.action_id ?? selection.session_id, ledgerBound, HISTORY_LIMITS.ledger + 1) as Array<HistoryLedger & { action_valid: number }>
      if (rows.length > HISTORY_LIMITS.ledger) throw new ProcessingLimitError("objective history ledger membership exceeds its bounded read")
      rememberLedger(rows)
    }
    const objectiveIDs = new Set<string>()
    if (selection.objective_id !== undefined) {
      if (!this.db.prepare("SELECT 1 FROM learning_objectives WHERE id=?").get(selection.objective_id)) throw new Error("Objective history scope unavailable")
      objectiveIDs.add(selection.objective_id)
    } else {
      const ids = [...ledger.keys()]
      for (let start = 0; start < ids.length; start += 500) {
        const chunk = ids.slice(start, start + 500)
        const rows = this.db.prepare(`SELECT DISTINCT objective_id FROM learning_objective_links WHERE source_type='ledger-record' AND sequence<=? AND source_id IN (${chunk.map(() => "?").join(",")}) LIMIT ?`)
          .all(linkBound, ...chunk, HISTORY_LIMITS.objectives + 1) as { objective_id: string }[]
        for (const row of rows) objectiveIDs.add(simple(row.objective_id, "stored objective_id"))
        if (objectiveIDs.size > HISTORY_LIMITS.objectives) throw new ProcessingLimitError("objective history objective membership exceeds its bounded read")
      }
    }
    const ids = [...objectiveIDs].sort()
    const reserved = ids.length ? this.db.prepare(`SELECT COUNT(*) AS n,COALESCE(SUM(${historyLinkBytes}),0) AS bytes,COALESCE(MAX(${historyLinkBytes}),0) AS max_bytes
      FROM learning_objective_links WHERE objective_id IN (${ids.map(() => "?").join(",")}) AND sequence<=?`)
      .get(...ids, linkBound) as { n: number; bytes: number; max_bytes: number } : { n: 0, bytes: 0, max_bytes: 0 }
    if (reserved.n > HISTORY_LIMITS.links || reserved.bytes > HISTORY_LIMITS.bytes || reserved.max_bytes > 8192)
      throw new ProcessingLimitError("objective history source bytes or links exceed its bounded read")
    const raw = ids.length ? this.db.prepare(`SELECT sequence,objective_id,source_type,source_id,source_session_id,source_message_id,parent_session_id,
      action_id,node_id,event_kind,verification,source_at_ms,sort_ms,recorded_at,phase,confidence,assessment,related_sequence,gap_reason,author_session,author_agent,relation,
      ${historyLinkBytes} AS row_bytes
      FROM learning_objective_links WHERE objective_id IN (${ids.map(() => "?").join(",")}) AND sequence<=? AND (${historyLinkBytes})<=8192 ORDER BY sequence LIMIT ?`)
      .all(...ids, linkBound, HISTORY_LIMITS.links + 1) as HistoryLink[] : []
    if (raw.length !== reserved.n) throw new Error("Objective history source membership changed during read")
    const indexedLinks = new Map(raw.map(row => [row.sequence, row]))
    let bytes = 0
    for (const row of raw) {
      if (!safeInt(row.row_bytes) || row.row_bytes > 8192 || (bytes += row.row_bytes) > HISTORY_LIMITS.bytes)
        throw new ProcessingLimitError("objective history source bytes exceed its bounded read")
      if (!safeInt(row.sequence) || row.sequence < 1 || !phases.has(row.phase)
        || !["supported", "uncertain"].includes(row.confidence)
        || row.related_sequence !== null && (!safeInt(row.related_sequence) || row.related_sequence < 1 || row.related_sequence >= row.sequence)
        || row.relation !== null && (!OBJECTIVE_RELATIONS.includes(row.relation) || row.phase === "link-correction" || row.related_sequence === null))
        throw new Error("Stored objective history relationship is invalid")
      simple(row.objective_id, "stored objective_id"); simple(row.author_session, "association author Session"); simple(row.author_agent, "association author agent")
      bounded(row.recorded_at, "stored relationship time", 64)
      if (row.related_sequence !== null && indexedLinks.get(row.related_sequence)?.objective_id !== row.objective_id)
        throw new Error("Stored objective relationship leaves its original objective")
    }
    if (!scoped) {
      const sourceIDs = [...new Set(raw.filter(row => row.source_type === "ledger-record").map(row => simple(row.source_id, "source record_id")))]
      for (let start = 0; start < sourceIDs.length; start += 500) {
        const chunk = sourceIDs.slice(start, start + 500)
        const rows = this.actionDB.prepare(`SELECT ${historyLedgerColumns} FROM ledger WHERE seq<=? AND id IN (${chunk.map(() => "?").join(",")})`)
          .all(ledgerBound, ...chunk) as Array<HistoryLedger & { action_valid: number }>
        rememberLedger(rows)
      }
    }
    // Reserve the unique originals before resolving any refreshed source
    // metadata. Cached link sizes cannot stand in for current source sizes.
    const originalIDs = new Set(raw.filter(row => row.source_type === "ledger-record" && ledger.has(row.source_id)).map(row => row.source_id))
    let originalBytes = 0
    for (const id of originalIDs) {
      const original = ledger.get(id)!
      if (!safeInt(original.data_bytes) || original.data_bytes > 393216 || (originalBytes += original.data_bytes) > HISTORY_LIMITS.originalBytes)
        throw new ProcessingLimitError("objective original bytes exceed bounded source projection")
    }
    const metadata: HistoryLink[] = []
    let metadataBytes = 0
    const appendMetadata = (row: HistoryLink) => {
      if ((metadataBytes += Buffer.byteLength(JSON.stringify(row), "utf8")) > HISTORY_LIMITS.bytes)
        throw new ProcessingLimitError("objective refreshed metadata bytes exceed its bounded read")
      metadata.push(row)
    }
    const resolvedSources = new Map<string, ObjectiveSource>()
    const usedRecords = new Set<string>(), contributors = new Set<string>()
    for (const row of raw) {
      if (row.source_type === "ledger-record") {
        const actual = ledger.get(row.source_id)
        if (!actual) continue
        const source = resolvedSources.get(row.source_id) ?? this.ledgerSource(row.source_id)
        resolvedSources.set(row.source_id, source)
        // Cached source scope can never move a record into this selection.
        appendMetadata({ ...row, source_session_id: source.session_id ?? null, source_message_id: null, parent_session_id: null,
          action_id: source.action_id ?? null, node_id: source.node_id ?? null, event_kind: source.event_kind ?? null,
          verification: source.verification, source_at_ms: source.occurred_at_ms ?? null })
        usedRecords.add(actual.id); contributors.add(simple(actual.session_id, "source Session"))
      } else {
        if (selection.action_id !== undefined || selection.session_id !== undefined && row.source_session_id !== selection.session_id) continue
        const source: ObjectiveSource = { type: row.source_type as ObjectiveSource["type"], id: row.source_id,
          verification: row.verification as ObjectiveSource["verification"],
          ...(row.source_session_id !== null ? { session_id: row.source_session_id } : {}),
          ...(row.source_message_id !== null ? { message_id: row.source_message_id } : {}) }
        objectiveSourceKey(source)
        const expected = source.type === "external-ref" ? ["declared-external"] : source.type === "unavailable" ? ["reported-gap"] : ["native-context", "provided-export-unverified"]
        if (!expected.includes(source.verification)) throw new Error("Stored objective source verification is invalid")
        appendMetadata({ ...row, action_id: null, node_id: null, parent_session_id: null })
        if (row.source_session_id !== null) contributors.add(simple(row.source_session_id, "source Session"))
      }
      contributors.add(row.author_session)
    }
    const visibleSequences = new Set(metadata.map(row => row.sequence)), visibleObjectives = new Set(metadata.map(row => row.objective_id))
    for (const row of metadata) if (row.related_sequence !== null && !visibleSequences.has(row.related_sequence)) row.related_sequence = null
    const objectives: Array<Omit<ObjectiveRow, "source_key" | "label">> = []
    for (const id of ids.filter(id => visibleObjectives.has(id))) {
      const row = this.db.prepare(`SELECT id,unit_key,created_at,author_session,author_agent,octet_length(label) AS label_bytes FROM learning_objectives WHERE id=?
        AND octet_length(id)+octet_length(unit_key)+octet_length(created_at)+octet_length(author_session)+octet_length(author_agent)+octet_length(label)<=2048`)
        .get(id) as Omit<ObjectiveRow, "source_key" | "label"> & { label_bytes: number } | undefined
      if (!row || !safeInt(row.label_bytes) || row.label_bytes > 600) throw new Error("Stored objective label is unavailable or oversized")
      simple(row.author_session, "objective creator Session"); simple(row.author_agent, "objective creator agent")
      simple(row.unit_key, "stored objective unit"); bounded(row.created_at, "stored objective time", 64)
      const { label_bytes: _labelBytes, ...identity } = row
      objectives.push(identity); contributors.add(row.author_session)
    }
    const store = this.actionDB.prepare("SELECT store_id FROM review_store_identity WHERE singleton=1").get() as { store_id: string } | undefined
    if (!store) throw new Error("Objective history source-store identity is unavailable")
    const effectiveLedger = selection.ledger_through ?? (scoped ? ledgerBound : Math.max(0, ...[...usedRecords].map(id => ledger.get(id)!.seq)))
    const sources: ObjectiveHistorySources = { contributors: [...contributors].sort(), ledger_record_ids: [...usedRecords].sort(),
      ledger_through: effectiveLedger, link_through: selection.link_through ?? Math.max(0, ...metadata.map(row => row.sequence)),
      digest: historyDigest({ source_store_id: simple(store.store_id, "source store"), objectives, metadata,
        records: [...usedRecords].sort().map(id => ledger.get(id)), ledger_through: effectiveLedger,
        link_through: selection.link_through ?? Math.max(0, ...metadata.map(row => row.sequence)) }) }
    return { sources, objectives, metadata }
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
