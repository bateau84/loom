import { createHash } from "node:crypto"
import { checkedRef, type WorkRef } from "./collaboration.js"
import { canonical, ProcessingBudget, ProcessingLimitError, PROCESSING_LIMITS, uid, type PlanNode, type RecordKind } from "./model.js"
import { RECORD_KINDS, type SQL, type Store } from "./store.js"

export type EngineeringHistoryScope = { action_id: string } | { session_id: string }
export type EngineeringHistoryQuery = {
  action_id?: string; session_id?: string; branch_ref?: string; record_id?: string;
  through?: number; after?: number; limit?: number; branch_offset?: number;
}
export type EngineeringHistoryCounts = {
  records: number; sessions: number; observations: number; concerns: number;
  observed_tool_errors: number;
  reported_completions: number; reported_reopens: number; reported_passes: number; reported_failures: number;
  reported_inconclusive: number; observation_starts: number; paired_finishes: number;
  verified_outcomes: null; native_dispatches: null;
  by_kind: Partial<Record<RecordKind, number>>;
}
export type EngineeringHistoryGap = { code: string; detail: string }
export type EngineeringHistorySource = {
  store_id: string; record_id: string; session_id: string; sequence: number; sha256: string;
  tool: "loom_record"; query: { operation: "query"; action_id?: string; source_session_id?: string; session_only?: boolean; record_id: string };
  authority: "reference-only; retrieval requires current source permission";
}
export type EngineeringHistoryRecord = {
  ref: string; branch_ref: string; kind: RecordKind; sequence: number; session_id: string; agent: string; created_at: string;
  meaning: "observed" | "authored"; title: string; excerpt: string | null; excerpt_truncated: boolean;
  verdict: string | null; verification: "recorded observation; engineering outcome not established" | "authored claim; not independently verified";
  work_ref: WorkRef | null;
  observation: { tool: string | null; phase: string | null; status: string | null; elapsed_ms: number | null; start_id: string | null } | null;
  source: EngineeringHistorySource; gaps: EngineeringHistoryGap[];
}
export type EngineeringHistoryBranch = {
  ref: string; kind: "historical-work" | "unversioned-node" | "session"; title: string;
  meaning: "recorded-work-binding" | "unversioned-association" | "observed-session-group";
  work_ref: WorkRef | null; node_id: string | null; session_id: string | null;
  counts: EngineeringHistoryCounts; first_sequence: number; last_sequence: number;
  historical_node: PlanNode | null; gaps: EngineeringHistoryGap[];
  expand: EngineeringHistoryQuery;
}
export type EngineeringHistoryRelationship = {
  from: string; to: string; kind: "cites-observation" | "paired-observation" | "answers-question" | "reopens-completion" | "follows-reopen";
  meaning: "observed" | "authored"; source_record_id: string;
  target: "included" | "in-scope-not-included" | "unresolved";
  qualification: string;
}
export type EngineeringHistoryView = {
  format: "loom-engineering-history/v1";
  scope: EngineeringHistoryScope; store_id: string;
  boundary: { live: true; observed_through: number; current_through: number; membership: "append-bound only; not a frozen retrospective population" };
  intent: { title: string; goal: string | null; meaning: "current-authored-action" | "session-scope"; action_revision: number | null };
  intended_plan: { revision: number; nodes: PlanNode[]; nodes_total: number; nodes_omitted: number; projection: "identity-and-title";
    read: { tool: "loom_plan"; query: { operation: "read"; action_id: string; revision: number } };
    meaning: "current-intended-structure; not historical execution membership" } | null;
  totals: EngineeringHistoryCounts;
  branches: EngineeringHistoryBranch[]; selected_branch: EngineeringHistoryBranch | null;
  highlights: EngineeringHistoryRecord[]; records: EngineeringHistoryRecord[]; relationships: EngineeringHistoryRelationship[];
  coverage: {
    ledger: "complete-within-boundary"; branch_count: number; branches_returned: number; branches_omitted: number;
    records_returned: number; records_omitted: number; next_after: number | null; next_branch_offset: number | null;
    gaps: EngineeringHistoryGap[];
  };
}

export const ENGINEERING_HISTORY_LIMITS = Object.freeze({ records: 100000, storedBytes: 64 * 1024 * 1024,
  responseBytes: 262144, branches: 20, highlights: 16, excerptChars: 600 })

type Row = { seq: number; id: string; data_bytes: number; group_key: string }
type Aggregate = { group_key?: string; records: number; sessions: number; observations: number; concerns: number; observed_tool_errors: number;
  reported_completions: number; reported_reopens: number; reported_passes: number; reported_failures: number; reported_inconclusive: number;
  observation_starts: number; paired_finishes: number; first_sequence: number; last_sequence: number }
type GroupKey = ["work", WorkRef] | ["node", string | null, string] | ["session", string]
const hash = (text: string) => createHash("sha256").update(text).digest("hex")
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v)
const integer = (v: unknown): v is number => Number.isSafeInteger(v) && (v as number) >= 0
const small = (v: unknown, max = 200): string | null => typeof v === "string" && v.length <= max ? v : null
const gap = (code: string, detail: string): EngineeringHistoryGap => ({ code, detail })

function queryScope(query: EngineeringHistoryQuery): EngineeringHistoryScope {
  if (!object(query) || Object.keys(query).some(k => !["action_id", "session_id", "branch_ref", "record_id", "through", "after", "limit", "branch_offset"].includes(k)))
    throw new Error("Unsupported engineering history query")
  if ((query.action_id === undefined) === (query.session_id === undefined)) throw new Error("History needs exactly one explicit Action or Session")
  for (const name of ["through", "after"] as const) if (query[name] !== undefined && !integer(query[name])) throw new Error(`Invalid history ${name}`)
  if (query.after !== undefined && query.through !== undefined && query.after > query.through) throw new Error("History after exceeds through boundary")
  if (query.limit !== undefined && (!integer(query.limit) || query.limit < 1 || query.limit > 50)) throw new Error("History limit must be 1-50")
  if (query.record_id !== undefined) uid(query.record_id, "record_id")
  if (query.record_id !== undefined && query.branch_ref !== undefined) throw new Error("Select one history branch or record")
  if (query.after !== undefined && query.branch_ref === undefined) throw new Error("History after requires a selected branch")
  if (query.branch_offset !== undefined && (!integer(query.branch_offset) || query.branch_offset > 100000)) throw new Error("Invalid history branch_offset")
  if (query.branch_offset !== undefined && (query.branch_ref !== undefined || query.record_id !== undefined)) throw new Error("branch_offset only applies to the overview")
  if (query.branch_offset && query.through === undefined) throw new Error("Branch continuation requires the overview through boundary")
  return query.action_id !== undefined ? { action_id: uid(query.action_id, "action_id") } : { session_id: uid(query.session_id, "session_id") }
}
const scopeSQL = (scope: EngineeringHistoryScope) => "action_id" in scope
  ? { where: "action_id=?", id: scope.action_id } : { where: "session_id=?", id: scope.session_id }
const compactNode = (node: PlanNode): PlanNode => ({ id: node.id, kind: node.kind, title: node.title, ...(node.parent ? { parent: node.parent } : {}) })

// All SQL paths and expressions below are fixed. No user input becomes SQL.
const aggregateSQL = () => `COUNT(*) AS records,COUNT(DISTINCT session_id) AS sessions,
  SUM(kind='observation') AS observations,SUM(kind='concern') AS concerns,
  SUM(kind='observation' AND status='error') AS observed_tool_errors,
  SUM(kind='completion') AS reported_completions,
  SUM(kind='reopen') AS reported_reopens,
  SUM(kind IN ('assessment','qa') AND verdict='pass') AS reported_passes,
  SUM(kind IN ('assessment','qa') AND verdict='fail') AS reported_failures,
  SUM(kind IN ('assessment','qa') AND verdict='inconclusive') AS reported_inconclusive,
  SUM(kind='observation' AND phase='started') AS observation_starts,
  SUM(kind='observation' AND phase='finished' AND start_id IS NOT NULL) AS paired_finishes,
  MIN(seq) AS first_sequence,MAX(seq) AS last_sequence,
  ${RECORD_KINDS.map((kind, index) => `SUM(kind='${kind}') AS kind_${index}`).join(",")}`

/** A live, read-only projection of the existing Loom source owner. Consumers must
 * authorize scope and all contributing Sessions before calling read, and recheck
 * that same resource union before disclosure. This class is not an authority. */
export class EngineeringHistory {
  constructor(private store: Store, private db: SQL) {}

  /** Metadata-only authorization preflight. No body hydration or returned counts.
   * The current contributor union is deliberately a superset of an append-bound read. */
  authorizationSessions(query: EngineeringHistoryQuery): string[] {
    const scope = queryScope(query), sql = scopeSQL(scope)
    const rows = this.db.prepare(`SELECT DISTINCT session_id FROM ledger WHERE ${sql.where} ORDER BY session_id LIMIT 2001`).all(sql.id) as { session_id: string }[]
    if (rows.length > 2000) throw new ProcessingLimitError("history contributor set exceeds 2000 Sessions; use a narrower Session scope")
    const result = new Set(rows.map(row => uid(row.session_id, "source Session")))
    if ("session_id" in scope) result.add(scope.session_id)
    else {
      // Plan labels are authored by their saver. Preserve the same Session deny
      // boundary even when the author has not written a ledger record.
      const authors = this.db.prepare(`SELECT DISTINCT json_extract(data,'$.saved_by.session_id') AS session_id
        FROM plans WHERE action_id=? AND json_type(data,'$.saved_by.session_id')='text' LIMIT 2001`).all(scope.action_id) as { session_id: string }[]
      if (authors.length > 2000) throw new ProcessingLimitError("history Plan author set exceeds 2000 Sessions")
      for (const author of authors) result.add(uid(author.session_id, "Plan author Session"))
    }
    if (result.size > 2000) throw new ProcessingLimitError("history contributor set exceeds 2000 Sessions")
    return [...result].sort()
  }

  private prefix(where: string): string {
    return `WITH source AS MATERIALIZED (
      SELECT seq,id,action_id,session_id,kind,octet_length(data) AS data_bytes,data
      FROM ledger WHERE ${where} AND seq<=?
    ), fields AS (
      SELECT *,json_extract(data,'$.node_id') AS node_id,json_extract(data,'$.data.verdict') AS verdict,
        json_extract(data,'$.data.phase') AS phase,json_extract(data,'$.data.start_id') AS start_id,json_extract(data,'$.data.status') AS status,
        CASE WHEN kind<>'observation' AND json_type(data,'$.data.work_ref')='object' THEN json_extract(data,'$.data.work_ref')
          WHEN kind='observation' AND json_type(data,'$.data.work_scope')='object'
          AND json_extract(data,'$.data.work_scope.status')='established'
          AND (SELECT COUNT(*) FROM json_each(data,'$.data.work_scope'))=2
          AND NOT EXISTS (SELECT 1 FROM json_each(data,'$.data.work_scope') WHERE key NOT IN ('status','work_ref'))
          AND json_type(data,'$.data.work_scope.work_ref')='object' THEN json_extract(data,'$.data.work_scope.work_ref') END AS wr
      FROM source
    ), grouped AS (
      SELECT *,CASE WHEN wr IS NOT NULL
        AND (SELECT COUNT(*) FROM json_each(wr))=5
        AND NOT EXISTS (SELECT 1 FROM json_each(wr) WHERE key NOT IN ('action_id','node_id','action_revision','plan_revision','hash'))
        AND json_type(wr,'$.action_id')='text' AND json_type(wr,'$.node_id')='text'
        AND json_extract(wr,'$.action_id') IS action_id
        AND json_extract(wr,'$.node_id') IS node_id
        AND length(action_id) BETWEEN 1 AND 120 AND action_id GLOB '[A-Za-z0-9]*' AND action_id NOT GLOB '*[^A-Za-z0-9_.:-]*'
        AND length(node_id) BETWEEN 1 AND 120 AND node_id GLOB '[A-Za-z0-9]*' AND node_id NOT GLOB '*[^A-Za-z0-9_.:-]*'
        AND json_type(wr,'$.action_revision')='integer' AND json_extract(wr,'$.action_revision') BETWEEN 1 AND 9007199254740991
        AND json_type(wr,'$.plan_revision')='integer' AND json_extract(wr,'$.plan_revision') BETWEEN 1 AND 9007199254740991
        AND json_type(wr,'$.hash')='text' AND length(json_extract(wr,'$.hash'))=64
        AND json_extract(wr,'$.hash') NOT GLOB '*[^a-f0-9]*'
        THEN json_array('work',json(wr))
        WHEN node_id IS NOT NULL THEN json_array('node',action_id,node_id)
        ELSE json_array('session',session_id) END AS group_key
      FROM fields
    ) `
  }

  private branchRef(scope: EngineeringHistoryScope, key: string): string {
    return Buffer.from(JSON.stringify({ v: 1, store: this.store.reviews.storeID, scope, key })).toString("base64url")
  }
  private branchKey(scope: EngineeringHistoryScope, ref: string): string {
    const fail = () => new Error("History branch reference is malformed or belongs to another source/scope")
    if (typeof ref !== "string" || ref.length > 4096 || !/^[A-Za-z0-9_-]+$/.test(ref)) throw fail()
    let value: unknown
    try { value = JSON.parse(Buffer.from(ref, "base64url").toString("utf8")) } catch { throw fail() }
    if (!object(value) || value.v !== 1 || value.store !== this.store.reviews.storeID || typeof value.key !== "string"
      || canonical(value.scope) !== canonical(scope) || this.branchRef(scope, value.key) !== ref) throw fail()
    return value.key
  }

  private counts(row: Aggregate): EngineeringHistoryCounts {
    return { records: row.records, sessions: row.sessions, observations: row.observations ?? 0, concerns: row.concerns ?? 0,
      observed_tool_errors: row.observed_tool_errors ?? 0,
      reported_completions: row.reported_completions ?? 0, reported_reopens: row.reported_reopens ?? 0, reported_passes: row.reported_passes ?? 0,
      reported_failures: row.reported_failures ?? 0, reported_inconclusive: row.reported_inconclusive ?? 0,
      observation_starts: row.observation_starts ?? 0, paired_finishes: row.paired_finishes ?? 0,
      verified_outcomes: null, native_dispatches: null,
      by_kind: Object.fromEntries(RECORD_KINDS.flatMap((kind, index) => {
        const value = (row as unknown as Record<string, number>)[`kind_${index}`]
        return value ? [[kind, value]] : []
      })) }
  }

  private branch(scope: EngineeringHistoryScope, row: Aggregate, through: number): EngineeringHistoryBranch {
    const key = JSON.parse(row.group_key!) as GroupKey, ref = this.branchRef(scope, row.group_key!)
    let work_ref: WorkRef | null = null, historical_node: PlanNode | null = null
    const gaps: EngineeringHistoryGap[] = []
    if (key[0] === "work") {
      // Revalidate the original supported object, never a reconstruction that
      // would erase unsupported fields or silently change its version semantics.
      work_ref = checkedRef(key[1])
      if ("action_id" in scope) {
        try {
          historical_node = compactNode(this.store.collaboration.resolveWork(work_ref).node)
          gaps.push(gap("historical-definition-projected", "Historical node identity, kind, title and parent are shown. Read the exact Plan revision for contract fields, dependencies and acceptance criteria."))
        }
        catch { gaps.push(gap("historical-definition-unavailable", "The exact recorded WorkRef definition could not be resolved; no current Plan definition was substituted.")) }
      } else gaps.push(gap("action-definition-not-in-scope", "Historical Action and Plan content requires a separate authorized Action-scoped read."))
    } else if (key[0] === "node") gaps.push(gap("historical-binding-unknown", "Node association lacks a supported exact historical WorkRef. It is not assigned to the latest Plan."))
    else gaps.push(gap("session-group-not-invocation", "This is an observed Session group. It can contain multiple dispatches or objectives; neither membership nor invocation count is inferred."))
    return { ref, kind: key[0] === "work" ? "historical-work" : key[0] === "node" ? "unversioned-node" : "session",
      title: historical_node?.title ?? (key[0] === "work" ? `Work ${key[1].node_id} · Plan revision ${key[1].plan_revision}` : key[0] === "node" ? `Unversioned activity · ${key[2]}` : `Session ${key[1]}`),
      meaning: key[0] === "work" ? "recorded-work-binding" : key[0] === "node" ? "unversioned-association" : "observed-session-group",
      work_ref, node_id: key[0] === "work" ? key[1].node_id : key[0] === "node" ? key[2] : null,
      session_id: key[0] === "session" ? key[1] : null,
      counts: this.counts(row), first_sequence: row.first_sequence, last_sequence: row.last_sequence,
      historical_node, gaps, expand: { ...scope, branch_ref: ref, through } }
  }

  private project(scope: EngineeringHistoryScope, rows: Row[]): EngineeringHistoryRecord[] {
    const records = this.store.hydrateLedger(rows), keyed = new Map(rows.map(row => [row.seq, row.group_key]))
    return records.map(record => {
      const { sequence, ...original } = record
      const source: EngineeringHistorySource = { store_id: this.store.reviews.storeID, record_id: uid(record.id), session_id: uid(record.session_id),
        sequence, sha256: hash(canonical(original, new ProcessingBudget(PROCESSING_LIMITS.recordChars))), tool: "loom_record",
        query: { operation: "query", ...("action_id" in scope ? { action_id: scope.action_id } : {}), source_session_id: record.session_id, record_id: record.id },
        authority: "reference-only; retrieval requires current source permission" }
      if (!object(record.data)) throw new Error("Stored history record has invalid data")
      const observed = record.kind === "observation", rawText = !observed ? record.data.statement ?? record.data.question ?? record.data.answer : undefined
      const text = typeof rawText === "string" ? rawText : null, key = keyed.get(sequence)!
      let work_ref: WorkRef | null = null
      const parsed = JSON.parse(key) as GroupKey
      if (parsed[0] === "work") work_ref = checkedRef(parsed[1])
      const phase = small(record.data.phase), tool = small(record.data.tool), status = small(record.data.status)
      const gaps = [gap("originals-not-expanded", "Original native messages, tool bodies and external artifacts are not resolved by this projection; follow separately authorized source readers.")]
      return { ref: `loom-record:${encodeURIComponent(this.store.reviews.storeID)}:${encodeURIComponent(record.id)}`,
        branch_ref: this.branchRef(scope, key), kind: record.kind, sequence, session_id: record.session_id, agent: record.agent, created_at: record.created_at,
        meaning: observed ? "observed" : "authored", title: observed ? [tool, phase].filter(Boolean).join(" · ") || "Recorded observation" : record.kind,
        excerpt: text?.slice(0, ENGINEERING_HISTORY_LIMITS.excerptChars) ?? null, excerpt_truncated: text !== null && text.length > ENGINEERING_HISTORY_LIMITS.excerptChars,
        verdict: small(record.data.verdict, 64), verification: observed ? "recorded observation; engineering outcome not established" : "authored claim; not independently verified",
        work_ref, observation: observed ? { tool, phase, status,
          elapsed_ms: typeof record.data.duration_ms === "number" && Number.isFinite(record.data.duration_ms) && record.data.duration_ms >= 0 ? record.data.duration_ms : null,
          start_id: small(record.data.start_id, 120) } : null, source, gaps }
    })
  }

  read(query: EngineeringHistoryQuery): EngineeringHistoryView {
    const scope = queryScope(query), sql = scopeSQL(scope), limit = query.limit ?? ENGINEERING_HISTORY_LIMITS.branches
    const selectedKey = query.branch_ref === undefined ? undefined : this.branchKey(scope, query.branch_ref)
    this.db.exec("BEGIN")
    try {
      const action = "action_id" in scope ? this.store.action(scope.action_id) : undefined
      const plan = action ? this.store.plan(action.id) : undefined
      const current = this.db.prepare(`SELECT COALESCE(MAX(seq),0) AS sequence FROM ledger WHERE ${sql.where}`).get(sql.id) as { sequence: number }
      const through = query.through ?? current.sequence
      if (through > current.sequence) throw new Error("History through boundary exceeds the current scope")
      const reserve = this.db.prepare(`SELECT COUNT(*) AS records,COALESCE(SUM(octet_length(data)),0) AS bytes,
        COALESCE(MAX(octet_length(data)),0) AS max_bytes FROM ledger WHERE ${sql.where} AND seq<=?`).get(sql.id, through) as { records: number; bytes: number; max_bytes: number }
      if (reserve.records > ENGINEERING_HISTORY_LIMITS.records || reserve.bytes > ENGINEERING_HISTORY_LIMITS.storedBytes
        || reserve.max_bytes > PROCESSING_LIMITS.recordChars * 3) throw new ProcessingLimitError("engineering history source exceeds its bounded read; use a narrower Session scope")
      const invalid = this.db.prepare(`SELECT 1 FROM ledger WHERE ${sql.where} AND seq<=? AND (typeof(data) IS NOT 'text' OR NOT json_valid(data)
        OR json_type(data) IS NOT 'object' OR json_type(data,'$.data') IS NOT 'object'
        OR json_type(data,'$.id') IS NOT 'text' OR json_type(data,'$.session_id') IS NOT 'text' OR json_type(data,'$.kind') IS NOT 'text'
        OR json_type(data,'$.agent') IS NOT 'text' OR length(json_extract(data,'$.agent')) NOT BETWEEN 1 AND 200
        OR json_type(data,'$.created_at') IS NOT 'text' OR length(json_extract(data,'$.created_at')) NOT BETWEEN 1 AND 64
        OR length(id) NOT BETWEEN 1 AND 120 OR id NOT GLOB '[A-Za-z0-9]*' OR id GLOB '*[^A-Za-z0-9_.:-]*'
        OR length(session_id) NOT BETWEEN 1 AND 120 OR session_id NOT GLOB '[A-Za-z0-9]*' OR session_id GLOB '*[^A-Za-z0-9_.:-]*'
        OR kind NOT IN (${RECORD_KINDS.map(kind => `'${kind}'`).join(",")})
        OR json_extract(data,'$.id') IS NOT id OR json_extract(data,'$.session_id') IS NOT session_id
        OR json_extract(data,'$.action_id') IS NOT action_id OR json_extract(data,'$.kind') IS NOT kind) LIMIT 1`).get(sql.id, through)
      if (invalid) throw new Error("Stored history source is invalid; projection withheld")
      const prefix = this.prefix(sql.where), args: unknown[] = [sql.id, through]
      const totalsRow = this.db.prepare(prefix + `SELECT ${aggregateSQL()} FROM grouped`).get(...args) as Aggregate
      const groupCount = this.db.prepare(prefix + "SELECT COUNT(DISTINCT group_key) AS count FROM grouped").get(...args) as { count: number }
      const branchRows = this.db.prepare(prefix + `SELECT group_key,${aggregateSQL()} FROM grouped GROUP BY group_key
        ORDER BY reported_failures DESC,observed_tool_errors DESC,reported_reopens DESC,concerns DESC,reported_inconclusive DESC,reported_completions DESC,last_sequence DESC,group_key LIMIT ? OFFSET ?`)
        .all(...args, limit, query.branch_offset ?? 0) as Aggregate[]
      const branches = branchRows.map(row => this.branch(scope, row, through))
      let effectiveKey = selectedKey
      if (query.record_id) {
        const found = this.db.prepare(prefix + "SELECT group_key FROM grouped WHERE id=?").get(...args, query.record_id) as { group_key: string } | undefined
        if (!found) throw new Error("History record is unavailable in the selected source scope and boundary")
        effectiveKey = found.group_key
      }
      let selected_branch: EngineeringHistoryBranch | null = null
      if (effectiveKey !== undefined) {
        const row = this.db.prepare(prefix + `SELECT group_key,${aggregateSQL()} FROM grouped WHERE group_key=? GROUP BY group_key`).get(...args, effectiveKey) as Aggregate | undefined
        if (!row) throw new Error("History branch is unavailable in this source scope and boundary")
        selected_branch = this.branch(scope, row, through)
      }
      const selection = effectiveKey === undefined ? "" : " WHERE group_key=?", selectedArgs = effectiveKey === undefined ? args : [...args, effectiveKey]
      // Independent representative lanes keep a later pass from erasing a fail.
      const highRows = this.db.prepare(prefix + `, important AS (
        SELECT *,CASE WHEN kind IN ('assessment','qa') AND verdict='fail' THEN 'failure'
          WHEN kind='observation' AND status='error' THEN 'tool-error'
          WHEN kind='reopen' THEN 'reopen'
          WHEN kind='concern' THEN 'concern' WHEN kind IN ('assessment','qa') AND verdict='inconclusive' THEN 'inconclusive'
          WHEN kind='completion' THEN 'completion' WHEN kind='result' THEN 'result'
          WHEN kind IN ('assessment','qa') AND verdict='pass' THEN 'pass' END AS lane FROM grouped${selection}
      ), ranked AS (SELECT *,ROW_NUMBER() OVER(PARTITION BY lane ORDER BY seq DESC) AS rank FROM important WHERE lane IS NOT NULL)
      SELECT seq,id,data_bytes,group_key FROM ranked WHERE rank<=${Math.min(2, limit)} ORDER BY seq LIMIT ${ENGINEERING_HISTORY_LIMITS.highlights}`)
        .all(...selectedArgs) as Row[]
      const highlights = this.project(scope, highRows)
      let recordRows: Row[] = [], next_after: number | null = null
      if (effectiveKey !== undefined) {
        if (query.record_id) recordRows = this.db.prepare(prefix + "SELECT seq,id,data_bytes,group_key FROM grouped WHERE id=?").all(...args, query.record_id) as Row[]
        else {
          const rows = this.db.prepare(prefix + "SELECT seq,id,data_bytes,group_key FROM grouped WHERE group_key=? AND seq>? ORDER BY seq LIMIT ?")
            .all(...args, effectiveKey, query.after ?? 0, limit + 1) as Row[]
          recordRows = rows.slice(0, limit)
          if (rows.length > limit) next_after = recordRows.at(-1)!.seq
        }
      }
      // One canonical projected object per source identity. A record displayed in
      // both the highlight and detail lanes must carry the same qualifications.
      const included = new Map(highlights.map(record => [record.source.record_id, record]))
      const records = this.project(scope, recordRows).map(record => {
        const existing = included.get(record.source.record_id)
        if (existing) return existing
        included.set(record.source.record_id, record)
        return record
      })
      const relationships = this.relationships(scope, through, [...included.values()], Math.min(20, limit))
      const returned = included.size, relevantCount = selected_branch?.counts.records ?? totalsRow.records
      const view: EngineeringHistoryView = {
        format: "loom-engineering-history/v1", scope, store_id: this.store.reviews.storeID,
        boundary: { live: true, observed_through: through, current_through: current.sequence, membership: "append-bound only; not a frozen retrospective population" },
        intent: { title: action?.title ?? `Session ${"session_id" in scope ? scope.session_id : ""}`, goal: action?.goal ?? null,
          meaning: action ? "current-authored-action" : "session-scope", action_revision: action?.revision ?? null },
        intended_plan: plan && plan.revision > 0 ? { revision: plan.revision, nodes: plan.nodes.slice(0, limit).map(compactNode),
          nodes_total: plan.nodes.length, nodes_omitted: Math.max(0, plan.nodes.length - limit), projection: "identity-and-title",
          read: { tool: "loom_plan", query: { operation: "read", action_id: action!.id, revision: plan.revision } },
          meaning: "current-intended-structure; not historical execution membership" } : null,
        totals: this.counts(totalsRow), branches, selected_branch, highlights, records, relationships,
        coverage: { ledger: "complete-within-boundary", branch_count: groupCount.count, branches_returned: branches.length,
          branches_omitted: groupCount.count - branches.length, records_returned: returned, records_omitted: Math.max(0, relevantCount - returned), next_after,
          next_branch_offset: (query.branch_offset ?? 0) + branches.length < groupCount.count ? (query.branch_offset ?? 0) + branches.length : null,
          gaps: [gap("ledger-coverage-only", "Counts cover this authorized Loom ledger scope only. Unrecorded native activity, child Sessions and objective membership are unknown."),
            gap("representative-highlights", `Highlights select at most ${Math.min(2, limit)} recent records per significant category. They are representatives, not a complete chronology. Relationship detail is limited to ${Math.min(20, limit)} references per included record; omissions are qualified on that record.`),
            gap("claims-not-verification", "Completion, assessments and QA verdicts remain authored claims. No aggregate proves successful delivery or resolves a concern."),
            gap("native-originals-unavailable", "This view does not read native history, assignments, model reasoning or tool bodies. Exact native originals retain their existing source-owner limitations."),
            gap("review-objective-not-expanded", "Private review manifests and authored objective relationships are not expanded by a ledger read; use their separately authorized readers."),
            gap("live-not-frozen", "through pins ledger append membership only. Current Action/Plan intent may change. This is not an immutable retrospective population or Evaluator authorization."),
            ...(groupCount.count > branches.length ? [gap("branches-omitted", "Only the ranked branch set is returned. Whole-scope counts remain complete; use Session scope or stable returned branch references for selective reads.")] : [])] }
      }
      const encoded = canonical(view, new ProcessingBudget(ENGINEERING_HISTORY_LIMITS.responseBytes))
      if (Buffer.byteLength(encoded, "utf8") > ENGINEERING_HISTORY_LIMITS.responseBytes) throw new ProcessingLimitError("engineering history response exceeds 262144 bytes; use a smaller limit")
      this.db.exec("COMMIT")
      return view
    } catch (error) { this.db.exec("ROLLBACK"); throw error }
  }

  private relationships(scope: EngineeringHistoryScope, through: number, records: EngineeringHistoryRecord[], limit: number): EngineeringHistoryRelationship[] {
    const sql = scopeSQL(scope), included = new Map(records.map(record => [record.source.record_id, record.ref]))
    const result: EngineeringHistoryRelationship[] = []
    for (const record of records) {
      const original = this.store.records({ ...("action_id" in scope ? scope : { session_id: scope.session_id }), record_id: record.source.record_id, limit: 1 }).items[0]
      if (!original) throw new Error("History relationship source disappeared")
      const candidates: Array<{ id: string; kind: "cites-observation" | "paired-observation" | "answers-question" | "previous-progress-report" }> = []
      if (Array.isArray(original.data.evidence_ids)) for (const id of original.data.evidence_ids.slice(0, 100))
        if (typeof id === "string") candidates.push({ id, kind: "cites-observation" })
      if (original.kind === "observation" && typeof original.data.start_id === "string") candidates.push({ id: original.data.start_id, kind: "paired-observation" })
      if (original.kind === "answer" && typeof original.data.question_id === "string") candidates.push({ id: original.data.question_id, kind: "answers-question" })
      if (original.kind === "reopen" && typeof original.data.previous_report_id === "string") candidates.push({ id: original.data.previous_report_id, kind: "previous-progress-report" })
      if (candidates.length > limit) record.gaps.push(gap("relationships-omitted", `${candidates.length - limit} additional authored relationship references are omitted from this bounded projection; inspect the exact source record.`))
      let unresolved = 0
      for (const candidate of candidates.slice(0, limit)) {
        // Do not return a target identity merely because a record named it.
        // Only in-scope source-owned rows can produce a resolved edge.
        const target = this.db.prepare(`SELECT id,kind FROM ledger WHERE ${sql.where} AND seq<=? AND id=?`).get(sql.id, through, candidate.id) as { id: string; kind: string } | undefined
        // The stored previous_report_id can name either kind of progress report.
        // Preserve that exact edge; do not jump over a reopening to a completion.
        const kind = candidate.kind === "previous-progress-report"
          ? target?.kind === "completion" ? "reopens-completion" : target?.kind === "reopen" ? "follows-reopen" : null
          : candidate.kind
        const targetKind = kind === "answers-question" ? "question" : kind === "reopens-completion" ? "completion" : kind === "follows-reopen" ? "reopen" : "observation"
        if (!target || kind === null || target.kind !== targetKind) { unresolved++; continue }
        result.push({ from: record.ref, to: included.get(target.id) ?? `loom-record:${encodeURIComponent(this.store.reviews.storeID)}:${encodeURIComponent(target.id)}`,
          kind, meaning: kind === "paired-observation" ? "observed" : "authored", source_record_id: record.source.record_id,
          target: included.has(target.id) ? "included" : "in-scope-not-included",
          qualification: kind === "cites-observation" ? "An authored evidence citation, not proof of correctness, correction or verification."
            : kind === "paired-observation" ? "The observer recorded this start/finish pair; it does not establish objective membership or outcome."
              : kind === "reopens-completion" ? "An authored reopening of the referenced completion report; it is not independently verified failure, resolution or a new historical WorkRef."
              : kind === "follows-reopen" ? "An authored follow-up to the referenced reopening; it does not establish a new completion, resolution or independently verified outcome."
              : "An authored answer to a stored question; response is not resolution or approval." })
      }
      if (unresolved) record.gaps.push(gap("relationships-unresolved", `${unresolved} authored relationship references could not be resolved inside this selected source scope and boundary. No outside target identities or existence claims are disclosed.`))
    }
    return result
  }
}
