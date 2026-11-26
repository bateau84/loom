import { createHash } from "node:crypto"
import { checkedRef, workReference, type WorkRef } from "./collaboration.js"
import { canonical, ProcessingBudget, ProcessingLimitError, PROCESSING_LIMITS, uid, type PlanNode, type RecordKind } from "./model.js"
import { RECORD_KINDS, type SQL, type Store } from "./store.js"
import { EngineeringConnections, type EngineeringHistoryOwners, type EngineeringHistoryConnections } from "./engineering-trajectories.js"

export type EngineeringHistoryScope = { action_id: string } | { session_id: string } | { objective_id: string }
export type EngineeringHistoryOwnerBoundary = { objective_links: number | null; review_requests: number; review_relationships: number }
export type EngineeringHistorySelection = {
  match?: string; record_kinds?: RecordKind[]; verdict?: "pass" | "fail" | "inconclusive";
  source_session_id?: string; node_id?: string; plan_revision?: number; has_gaps?: boolean;
}
export type EngineeringHistoryQuery = EngineeringHistorySelection & {
  action_id?: string; session_id?: string; objective_id?: string; branch_ref?: string; record_id?: string; related?: boolean;
  through?: number; after?: number; limit?: number; branch_offset?: number;
  owner_boundary?: EngineeringHistoryOwnerBoundary; owner_version?: string; connection_cursor?: string;
}
export type EngineeringHistoryCounts = {
  records: number; sessions: number; observations: number; concerns: number;
  observed_tool_errors: number;
  reported_completions: number; reported_reopens: number; reported_passes: number; reported_failures: number;
  reported_inconclusive: number; observation_starts: number; paired_finishes: number;
  capture_gap_records: number; unestablished_finishes: number; ambiguous_scope_records: number; unavailable_scope_records: number;
  verified_outcomes: null; native_dispatches: null;
  by_kind: Partial<Record<RecordKind, number>>;
}
export type EngineeringHistoryGap = { code: string; detail: string }
export type EngineeringHistorySource = {
  store_id: string; record_id: string; session_id: string; sequence: number; sha256: string;
  tool: "loom_record"; query: { operation: "query"; action_id?: string; source_session_id?: string; session_only?: boolean; record_id: string };
  authority: "reference-only; retrieval requires current source permission";
}
export type EngineeringHistoryWorkScope =
  | { status: "established"; work_ref: WorkRef }
  | { status: "unscoped" }
  | { status: "unknown"; reason: "source-missing" | "history-unavailable" | "processing-limit" | "not-observed"; detail: string | null; detail_excerpted: boolean }
  | { status: "ambiguous"; candidates: WorkRef[]; observation_ids: string[]; candidates_complete: false; candidates_omitted: number; observation_ids_omitted: number }
  | { status: "unavailable"; reason: "absent" | "unsupported" }
export type EngineeringHistoryObservation = {
  tool: string | null; phase: string | null; status: string | null; elapsed_ms: number | null; start_id: string | null;
  capture_gap: boolean | null; attribution: string | null; attribution_excerpted: boolean;
  finish_pairing: "paired" | "unestablished" | "not-applicable"; work_scope: EngineeringHistoryWorkScope;
  message_id: string | null; call_id: string | null; correlation_key: string | null; observer_epoch: string | null;
  input_digest: string | null; result_digest: string | null; agent_id: string | null; skill_id: string | null; lens: string | null;
  content_sha256: string | null; context_system_sha256: string | null; rendered_sha256: string | null; registry_content_sha256: string | null;
  registered_content_present: boolean | null; source: string | null; qualification: string | null; qualification_excerpted: boolean;
}
export type EngineeringHistoryRecord = {
  ref: string; branch_ref: string; kind: RecordKind; sequence: number; session_id: string; agent: string; created_at: string;
  meaning: "observed" | "authored"; title: string; excerpt: string | null; excerpt_truncated: boolean;
  verdict: string | null; verification: "recorded observation; engineering outcome not established" | "authored claim; not independently verified";
  work_ref: WorkRef | null; fingerprint: string | null; expand: EngineeringHistoryQuery; trajectory: EngineeringHistoryQuery;
  observation: EngineeringHistoryObservation | null;
  source: EngineeringHistorySource; gaps: EngineeringHistoryGap[];
}
export type EngineeringHistoryBranch = {
  ref: string; kind: "historical-work" | "unversioned-node" | "session" | "historical-plan" | "historical-node" | "message" | "chronology"; title: string;
  meaning: "recorded-work-binding" | "unversioned-association" | "observed-session-group" | "historical-plan-structure" | "observed-message-group" | "analytical-chronology";
  work_ref: WorkRef | null; node_id: string | null; session_id: string | null;
  parent_ref: string | null; child_count: number; historical_scope: { action_revision: number; plan_revision: number } | null;
  counts: EngineeringHistoryCounts; first_sequence: number; last_sequence: number;
  historical_node: PlanNode | null; gaps: EngineeringHistoryGap[];
  expand: EngineeringHistoryQuery;
}
export type EngineeringHistoryRelationship = {
  from: string; to: string; kind: string;
  meaning: "observed" | "authored" | "candidate"; source_record_id: string | null;
  target: "included" | "in-scope-not-included" | "unresolved";
  qualification: string;
  provenance?: { owner: "objective" | "review" | "ledger"; id: string; author_session?: string; author_agent?: string;
    confidence?: string; association_status?: string; source_verification?: string; recorded_at?: string };
}
export type EngineeringHistoryView = {
  format: "loom-engineering-history/v1";
  mode: "overview" | "discovery" | "branch" | "record" | "trajectory" | "connections"; selection: EngineeringHistorySelection;
  scope: EngineeringHistoryScope; store_id: string;
  boundary: { live: true; observed_through: number; current_through: number; membership: "append-bound only; not a frozen retrospective population";
    owners?: EngineeringHistoryOwnerBoundary; owner_version?: string };
  intent: { title: string; goal: string | null; meaning: "current-authored-action" | "session-scope" | "authored-objective"; action_revision: number | null };
  intended_plan: { revision: number; nodes: PlanNode[]; nodes_total: number; nodes_omitted: number; projection: "identity-and-title";
    read: { tool: "loom_plan"; query: { operation: "read"; action_id: string; revision: number } };
    meaning: "current-intended-structure; not historical execution membership" } | null;
  totals: EngineeringHistoryCounts;
  branches: EngineeringHistoryBranch[]; selected_branch: EngineeringHistoryBranch | null;
  ancestors: EngineeringHistoryBranch[]; related_branches: EngineeringHistoryBranch[];
  highlights: EngineeringHistoryRecord[]; records: EngineeringHistoryRecord[]; relationships: EngineeringHistoryRelationship[];
  connections: EngineeringHistoryConnections;
  navigation: { repeat: EngineeringHistoryQuery; next_records: EngineeringHistoryQuery | null; next_branches: EngineeringHistoryQuery | null;
    next_connections: EngineeringHistoryQuery | null; next_relationships: EngineeringHistoryQuery | null };
  coverage: {
    ledger: "complete-within-boundary"; page_limit: number; branch_count: number; branches_returned: number; branches_omitted: number;
    total_branch_count: number; matching_records: number; matching_branches: number; related_branches_omitted: number;
    records_returned: number; records_omitted: number; next_after: number | null; next_branch_offset: number | null;
    gaps: EngineeringHistoryGap[];
  };
}

export const ENGINEERING_HISTORY_LIMITS = Object.freeze({ records: 100000, storedBytes: 64 * 1024 * 1024,
  responseBytes: 262144, branches: 20, highlights: 18, relationships: 20, planNodes: 20, excerptChars: 600 })

type Row = { seq: number; id: string; data_bytes: number; group_key: string }
type Metadata = Row & { action_id: string | null; node_id: string | null; session_id: string; kind: RecordKind; fingerprint: string | null;
  verdict: string | null; phase: string | null; status: string | null; attribution: string | null; capture_gap: number | null;
  scope_status: string; message_id: string | null; landmark_title: string | null; matched: number }
type GroupKey = ["work", WorkRef] | ["node", string | null, string] | ["session", string]
  | ["plan", number, number] | ["structure", number, number, string] | ["message", string, string] | ["chronology", string, string | null]
  | ["fingerprint", string | null, string, string]
type BranchNode = { key: string; parent: string | null; children: Set<string>; rows: Metadata[];
  kind: EngineeringHistoryBranch["kind"]; meaning: EngineeringHistoryBranch["meaning"]; title: string;
  work_ref: WorkRef | null; node_id: string | null; session_id: string | null; historical_node: PlanNode | null;
  historical_scope: EngineeringHistoryBranch["historical_scope"]; gaps: EngineeringHistoryGap[]; counts?: EngineeringHistoryCounts }
type LedgerRelationshipFields = { id: string; kind: RecordKind; action_id: string | null; session_id: string;
  node_id?: unknown; phase?: unknown; attribution?: unknown; evidence_ids?: unknown; start_id?: unknown; question_id?: unknown; previous_report_id?: unknown;
  assignment_id?: unknown; assignment_id_type?: unknown; primary_session_id?: unknown; worker_session_id?: unknown; work_ref?: unknown }
type LedgerReference = { id: string; kind: string; meaning: "authored" | "observed"; qualification: string }
const assignmentFields = `CASE WHEN json_type(data,'$.data.assignment_id')='text' AND length(json_extract(data,'$.data.assignment_id'))<=120
    THEN json_extract(data,'$.data.assignment_id') END AS assignment_id,
  json_type(data,'$.data.assignment_id') AS assignment_id_type,
  CASE WHEN json_type(data,'$.node_id')='text' AND length(json_extract(data,'$.node_id'))<=120
    THEN json_extract(data,'$.node_id') END AS node_id,
  CASE WHEN json_type(data,'$.data.primary_session_id')='text' AND length(json_extract(data,'$.data.primary_session_id'))<=120
    THEN json_extract(data,'$.data.primary_session_id') END AS primary_session_id,
  CASE WHEN json_type(data,'$.data.worker_session_id')='text' AND length(json_extract(data,'$.data.worker_session_id'))<=120
    THEN json_extract(data,'$.data.worker_session_id') END AS worker_session_id,
  CASE WHEN json_type(data,'$.data.work_ref')='object' AND octet_length(json_extract(data,'$.data.work_ref'))<=1024
    THEN json_extract(data,'$.data.work_ref') END AS work_ref`
const relationshipFields = `id,kind,action_id,session_id,
  json_extract(data,'$.data.phase') AS phase,json_extract(data,'$.data.attribution') AS attribution,
  json_extract(data,'$.data.evidence_ids') AS evidence_ids,json_extract(data,'$.data.start_id') AS start_id,
  json_extract(data,'$.data.question_id') AS question_id,json_extract(data,'$.data.previous_report_id') AS previous_report_id,
  ${assignmentFields}`
const boundedRelationshipIdentity = () => `typeof(id)='text' AND length(id) BETWEEN 1 AND 120
  AND typeof(session_id)='text' AND length(session_id) BETWEEN 1 AND 120
  AND (action_id IS NULL OR typeof(action_id)='text' AND length(action_id) BETWEEN 1 AND 120)
  AND kind IN (${RECORD_KINDS.map(kind => `'${kind}'`).join(",")})`
const hash = (text: string) => createHash("sha256").update(text).digest("hex")
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v)
const integer = (v: unknown): v is number => Number.isSafeInteger(v) && (v as number) >= 0
const small = (v: unknown, max = 200): string | null => typeof v === "string" && v.length <= max ? v : null
const digest = (v: unknown): string | null => typeof v === "string" && /^[a-f0-9]{64}$/.test(v) ? v : null
const gap = (code: string, detail: string): EngineeringHistoryGap => ({ code, detail })

function matchesHistoricalAssignment(assignment: LedgerRelationshipFields | undefined, worker: LedgerRelationshipFields): boolean {
  if (assignment?.kind !== "assignment" || assignment.id === worker.id || assignment.action_id !== worker.action_id
    || typeof assignment.assignment_id !== "string" || worker.assignment_id_type !== null && worker.assignment_id !== assignment.assignment_id
    || assignment.primary_session_id !== assignment.session_id || assignment.worker_session_id !== worker.session_id
    || assignment.primary_session_id === assignment.worker_session_id
    || typeof assignment.work_ref !== "string" || typeof worker.work_ref !== "string") return false
  try {
    const requested = checkedRef(JSON.parse(assignment.work_ref)), reported = checkedRef(JSON.parse(worker.work_ref))
    return requested.action_id === assignment.action_id && requested.node_id === assignment.node_id
      && reported.action_id === worker.action_id && reported.node_id === worker.node_id && canonical(requested) === canonical(reported)
  } catch { return false } // Malformed legacy associations cannot manufacture an edge.
}

/** Resolve only the supported references actually recorded by this source. The
 * caller supplies its authorized target population; failure never exposes a
 * target identity. Both objective closure and ordinary/trajectory projection
 * use these same kind, pairing and historical assignment checks. */
function ledgerReferences(source: LedgerRelationshipFields, target: (id: string, historicalWork?: boolean) => LedgerRelationshipFields | undefined,
  assignment: () => LedgerRelationshipFields | undefined): { resolved: LedgerReference[]; unresolved: number; omitted: number } {
  const candidates: Array<{ id: string; kind: string }> = [], resolved: LedgerReference[] = []
  let unresolved = 0, omitted = 0
  if (typeof source.evidence_ids === "string") {
    const ids: unknown = JSON.parse(source.evidence_ids)
    if (Array.isArray(ids)) {
      for (const id of ids.slice(0, 100)) if (typeof id === "string") candidates.push({ id, kind: "cites-observation" })
      omitted = ids.slice(100).filter(id => typeof id === "string").length
    }
  }
  if (source.kind === "observation" && typeof source.start_id === "string") candidates.push({ id: source.start_id,
    kind: source.phase === "finished" && source.attribution === "captured-at-start" ? "paired-observation" : "references-observation-start" })
  if (source.kind === "answer" && typeof source.question_id === "string") candidates.push({ id: source.question_id, kind: "answers-question" })
  if (source.kind === "reopen" && typeof source.previous_report_id === "string") candidates.push({ id: source.previous_report_id, kind: "previous-progress-report" })
  for (const candidate of candidates) {
    const original = target(candidate.id)
    const kind = candidate.kind === "previous-progress-report"
      ? original?.kind === "completion" ? "reopens-completion" : original?.kind === "reopen" ? "follows-reopen" : null : candidate.kind
    const targetKind = kind === "answers-question" ? "question" : kind === "reopens-completion" ? "completion" : kind === "follows-reopen" ? "reopen" : "observation"
    const start = kind === "paired-observation" || kind === "references-observation-start"
    const sameSourceScope = original && (source.action_id ? original.action_id === source.action_id
      : original.action_id === null && original.session_id === source.session_id)
    if (!original || !sameSourceScope || original.id === source.id || kind === null || original.kind !== targetKind || start && original.phase !== "started") { unresolved++; continue }
    resolved.push({ id: original.id, kind, meaning: start ? "observed" : "authored",
      qualification: kind === "cites-observation" ? "An authored evidence citation, not proof of correctness, correction or verification."
        : kind === "paired-observation" ? "The observer recorded this start/finish pair; it does not establish objective membership or outcome."
          : kind === "references-observation-start" ? "The observation names this start, but captured-at-start finish pairing is unestablished. No native attempt provenance is inferred."
            : kind === "reopens-completion" ? "An authored reopening of the referenced completion report; it is not independently verified failure, resolution or a new historical WorkRef."
              : kind === "follows-reopen" ? "An authored follow-up to the referenced reopening; it does not establish a new completion, resolution or independently verified outcome."
                : "An authored answer to a stored question; response is not resolution or approval." })
  }
  if ((source.kind === "completion" || source.kind === "question") && typeof source.assignment_id === "string") {
    const original = assignment()
    if (matchesHistoricalAssignment(original, source) && original) resolved.push({ id: original.id,
      kind: source.kind === "completion" ? "historical-assignment-completion" : "historical-assignment-question", meaning: "authored",
      qualification: source.kind === "completion"
        ? "This historical completion explicitly names the saved assignment and its exact WorkRef, from the recorded worker Session. It is an authored completion, not native dispatch provenance or verified success."
        : "This historical question explicitly names the saved assignment and its exact WorkRef, from the recorded worker Session. It is an authored association, not native dispatch provenance, approval or resolution." })
    else unresolved++
  }
  if (source.kind === "assignment" && typeof source.question_id === "string") {
    const question = target(source.question_id, true), original = typeof source.assignment_id === "string" ? assignment() : undefined
    if (original?.id === source.id && question?.kind === "question" && question.assignment_id_type === null && matchesHistoricalAssignment(source, question))
      resolved.push({ id: question.id, kind: "historical-assignment-question", meaning: "authored",
        qualification: "This historical assignment explicitly names the recorded worker question and its exact WorkRef. It is requested work association, not native dispatch provenance, approval or resolution." })
    else unresolved++
  }
  return { resolved, unresolved, omitted }
}
const selectionFields = ["match", "record_kinds", "verdict", "source_session_id", "node_id", "plan_revision", "has_gaps"] as const
const selectedFilters = (query: EngineeringHistoryQuery): EngineeringHistorySelection => Object.fromEntries(selectionFields.flatMap(name =>
  query[name] === undefined ? [] : [[name, name === "record_kinds" ? RECORD_KINDS.filter(kind => query.record_kinds!.includes(kind)) : query[name]]]))

export function engineeringHistoryScope(query: EngineeringHistoryQuery): EngineeringHistoryScope {
  if (!object(query) || Object.keys(query).some(k => !["action_id", "session_id", "objective_id", "branch_ref", "record_id", "related", "through", "after", "limit", "branch_offset", "owner_boundary", "owner_version", "connection_cursor", ...selectionFields].includes(k)))
    throw new Error("Unsupported engineering history query")
  if ([query.action_id, query.session_id, query.objective_id].filter(value => value !== undefined).length !== 1) throw new Error("History needs exactly one explicit Action, Session or objective")
  for (const name of ["through", "after"] as const) if (query[name] !== undefined && !integer(query[name])) throw new Error(`Invalid history ${name}`)
  if (query.after !== undefined && query.through !== undefined && query.after > query.through) throw new Error("History after exceeds through boundary")
  if (query.limit !== undefined && (!integer(query.limit) || query.limit < 1 || query.limit > 50)) throw new Error("History limit must be 1-50")
  if (query.record_id !== undefined) uid(query.record_id, "record_id")
  if (query.record_id !== undefined && query.branch_ref !== undefined) throw new Error("Select one history branch or record")
  if (query.match !== undefined && (typeof query.match !== "string" || !query.match.trim() || query.match.length > 200)) throw new Error("History match must be 1-200 characters")
  if (query.record_kinds !== undefined && (!Array.isArray(query.record_kinds) || query.record_kinds.length === 0
    || query.record_kinds.some(kind => !RECORD_KINDS.includes(kind)) || new Set(query.record_kinds).size !== query.record_kinds.length)) throw new Error("Invalid history record_kinds")
  if (query.verdict !== undefined && !["pass", "fail", "inconclusive"].includes(query.verdict)) throw new Error("Invalid history verdict")
  for (const name of ["source_session_id", "node_id"] as const) if (query[name] !== undefined) uid(query[name], name)
  if (query.plan_revision !== undefined && (!integer(query.plan_revision) || query.plan_revision === 0)) throw new Error("Invalid history plan_revision")
  if (query.has_gaps !== undefined && typeof query.has_gaps !== "boolean") throw new Error("Invalid history has_gaps")
  const filtering = selectionFields.some(name => query[name] !== undefined)
  if (query.related !== undefined && typeof query.related !== "boolean") throw new Error("Invalid history related selection")
  if (query.related && (query.branch_ref !== undefined || query.record_id === undefined && query.objective_id === undefined || filtering))
    throw new Error("Related history needs an exact record or objective seed without discovery filters or branch selection")
  if (query.after !== undefined && !query.related && (query.record_id !== undefined || query.branch_ref === undefined && !filtering && query.objective_id === undefined)) throw new Error("History after requires a selected branch, objective, related trajectory or discovery filters")
  if (query.after !== undefined && query.through === undefined) throw new Error("Record continuation requires the history through boundary")
  if (query.branch_offset !== undefined && (!integer(query.branch_offset) || query.branch_offset > 100000)) throw new Error("Invalid history branch_offset")
  if (query.branch_offset !== undefined && query.record_id !== undefined) throw new Error("branch_offset only applies to branch lists")
  if (query.branch_offset && query.through === undefined) throw new Error("Branch continuation requires the overview through boundary")
  if (query.owner_boundary !== undefined) {
    const b = query.owner_boundary
    if (!object(b) || Object.keys(b).sort().join(",") !== "objective_links,review_relationships,review_requests"
      || b.objective_links !== null && !integer(b.objective_links) || !integer(b.review_requests) || !integer(b.review_relationships))
      throw new Error("Invalid history owner boundary")
    if (query.through === undefined) throw new Error("Owner boundaries require the ledger through boundary")
  }
  if (query.owner_version !== undefined && (!digest(query.owner_version) || query.owner_boundary === undefined)) throw new Error("Invalid history owner version")
  if (query.connection_cursor !== undefined && (typeof query.connection_cursor !== "string" || query.connection_cursor.length > 2048
    || !/^[A-Za-z0-9_-]+$/.test(query.connection_cursor) || query.through === undefined))
    throw new Error("Connection continuation requires a valid cursor and the original through boundary")
  return query.action_id !== undefined ? { action_id: uid(query.action_id, "action_id") }
    : query.session_id !== undefined ? { session_id: uid(query.session_id, "session_id") } : { objective_id: uid(query.objective_id, "objective_id") }
}
const scopeSQL = (scope: EngineeringHistoryScope, objectiveRecords: string[] = []) => "action_id" in scope
  ? { where: "action_id=?", id: scope.action_id } : "session_id" in scope ? { where: "session_id=?", id: scope.session_id }
    : { where: "id IN (SELECT value FROM json_each(?))", id: JSON.stringify(objectiveRecords) }
const compactNode = (node: PlanNode): PlanNode => ({ id: node.id, kind: node.kind, title: node.title, ...(node.parent ? { parent: node.parent } : {}) })

// Discovery is literal ASCII-folded substring matching over authored prose and
// named observed metadata, not native bodies, semantic search or relevance proof.
// Paths are fixed; user values always remain SQL parameters (including % and _).
const searchablePaths = ["statement", "question", "answer", "tool", "phase", "status", "attribution", "message_id", "call_id", "skill_id", "agent_id", "lens", "source", "observation", "work_scope.reason", "work_scope.detail"]
function discoverySQL(query: EngineeringHistorySelection): { where: string; args: unknown[] } {
  const parts: string[] = [], args: unknown[] = []
  if (query.match !== undefined) {
    parts.push(`instr(lower(${searchablePaths.map(path => `CASE WHEN json_type(data,'$.data.${path}')='text' THEN json_extract(data,'$.data.${path}') ELSE '' END`).join(" || char(10) || ")}),lower(?))>0`)
    args.push(query.match)
  }
  if (query.record_kinds) { parts.push(`kind IN (${query.record_kinds.map(() => "?").join(",")})`); args.push(...query.record_kinds) }
  if (query.verdict !== undefined) { parts.push("kind IN ('assessment','qa') AND verdict=?"); args.push(query.verdict) }
  if (query.source_session_id !== undefined) { parts.push("session_id=?"); args.push(query.source_session_id) }
  if (query.node_id !== undefined) { parts.push("node_id=?"); args.push(query.node_id) }
  if (query.plan_revision !== undefined) { parts.push("json_extract(group_key,'$[0]')='work' AND json_extract(group_key,'$[1].plan_revision')=?"); args.push(query.plan_revision) }
  if (query.has_gaps !== undefined) { parts.push("has_gaps=?"); args.push(query.has_gaps ? 1 : 0) }
  return { where: parts.length ? parts.map(part => `(${part})`).join(" AND ") : "1", args }
}
const materialKinds = new Set<RecordKind>(["concern", "result", "assessment", "qa", "completion", "reopen", "question"])
const rowHasGap = (row: Metadata) => row.kind === "observation" && (row.capture_gap === 1 || row.phase === "finished" && row.attribution !== "captured-at-start"
  || ["unknown", "ambiguous", "unavailable"].includes(row.scope_status))
function countRows(rows: Metadata[]): EngineeringHistoryCounts {
  const count: EngineeringHistoryCounts = { records: rows.length, sessions: new Set(rows.map(row => row.session_id)).size, observations: 0, concerns: 0,
    observed_tool_errors: 0, reported_completions: 0, reported_reopens: 0, reported_passes: 0, reported_failures: 0, reported_inconclusive: 0,
    observation_starts: 0, paired_finishes: 0, capture_gap_records: 0, unestablished_finishes: 0, ambiguous_scope_records: 0, unavailable_scope_records: 0,
    verified_outcomes: null, native_dispatches: null, by_kind: {} }
  for (const row of rows) {
    count.by_kind[row.kind] = (count.by_kind[row.kind] ?? 0) + 1
    if (row.kind === "concern") count.concerns++
    if (row.kind === "completion") count.reported_completions++
    if (row.kind === "reopen") count.reported_reopens++
    if (row.kind === "assessment" || row.kind === "qa") {
      if (row.verdict === "pass") count.reported_passes++
      if (row.verdict === "fail") count.reported_failures++
      if (row.verdict === "inconclusive") count.reported_inconclusive++
    }
    if (row.kind !== "observation") continue
    count.observations++
    if (row.status === "error") count.observed_tool_errors++
    if (row.phase === "started") count.observation_starts++
    if (row.phase === "finished") {
      if (row.attribution === "captured-at-start") count.paired_finishes++
      else count.unestablished_finishes++
    }
    if (row.capture_gap === 1) count.capture_gap_records++
    if (row.scope_status === "ambiguous") count.ambiguous_scope_records++
    if (row.scope_status === "unavailable") count.unavailable_scope_records++
  }
  return count
}

/** A live, read-only projection of the existing Loom source owner. Consumers must
 * authorize scope and all contributing Sessions before calling read, and recheck
 * that same resource union before disclosure. This class is not an authority. */
export class EngineeringHistory {
  constructor(private store: Store, private db: SQL) {}

  /** Metadata-only original-evidence closure for an objective seed. Objective
   * membership stays authored; additional rows are explicitly referenced source
   * evidence or assignments, not inferred members. No reverse fan-out is used. */
  objectiveEvidenceSources(seedIDs: string[], through: number): string[] {
    if (!integer(through) || seedIDs.length > 10000) throw new ProcessingLimitError("Objective evidence scope exceeds its bounded read")
    const included = new Set(seedIDs.map(id => uid(id))), queue = [...included]
    let sourceBytes = 0
    for (let cursor = 0; cursor < queue.length; cursor++) {
      const size = this.db.prepare(`SELECT octet_length(data) AS bytes,${boundedRelationshipIdentity()} AS identity_valid
        FROM ledger WHERE id=? AND seq<=?`)
        .get(queue[cursor], through) as { bytes: number; identity_valid: number } | undefined
      if (!size || size.identity_valid !== 1 || !integer(size.bytes) || size.bytes > PROCESSING_LIMITS.recordChars * 3)
        throw new Error("Objective original evidence unavailable")
      sourceBytes += size.bytes
      if (sourceBytes > ENGINEERING_HISTORY_LIMITS.storedBytes) throw new ProcessingLimitError("Objective evidence exceeds its bounded source bytes")
      const source = this.db.prepare(`SELECT ${relationshipFields}
        FROM ledger WHERE id=? AND seq<=? AND octet_length(data)<=393216 AND json_valid(data)`)
        .get(queue[cursor], through) as LedgerRelationshipFields | undefined
      if (!source) throw new Error("Objective original evidence unavailable")
      const sourceScope = scopeSQL(source.action_id ? { action_id: source.action_id } : { session_id: source.session_id })
      const target = (id: string, historicalWork = false): LedgerRelationshipFields | undefined => {
        const row = this.db.prepare(`SELECT id,kind,action_id,session_id,${historicalWork ? `${assignmentFields},` : ""}
          CASE WHEN json_type(data,'$.data.phase')='text' AND length(json_extract(data,'$.data.phase'))<=64
            THEN json_extract(data,'$.data.phase') END AS phase FROM ledger WHERE ${sourceScope.where}
            ${source.action_id ? "" : "AND action_id IS NULL"} AND id=? AND seq<=?
            AND ${boundedRelationshipIdentity()} AND octet_length(data)<=393216 AND json_valid(data)`)
          .get(sourceScope.id, id, through) as LedgerRelationshipFields | undefined
        return row
      }
      const references = ledgerReferences(source, target, () => {
        const id = this.assignmentOriginalID(source, through)
        if (!id || !target(id)) return undefined
        return this.db.prepare(`SELECT id,kind,action_id,session_id,${assignmentFields}
          FROM ledger WHERE id=? AND seq<=? AND octet_length(data)<=393216 AND json_valid(data)`)
          .get(id, through) as LedgerRelationshipFields | undefined
      })
      if (references.omitted) throw new Error("Objective evidence references unavailable")
      for (const reference of references.resolved) {
        if (included.has(reference.id)) continue
        uid(reference.id)
        if (included.size >= 10000) throw new ProcessingLimitError("Objective evidence scope exceeds 10000 records")
        included.add(reference.id); queue.push(reference.id)
      }
    }
    return [...included].sort()
  }

  /** Check uniqueness in the source's original Action/Session, never just the
   * objective subset: an excluded duplicate must not manufacture identity. */
  private assignmentOriginalID(source: LedgerRelationshipFields, through: number): string | undefined {
    const scope = scopeSQL(source.action_id ? { action_id: source.action_id } : { session_id: source.session_id })
    const rows = this.db.prepare(`SELECT CASE WHEN typeof(id)='text' AND length(id) BETWEEN 1 AND 120 THEN id END AS id
      FROM ledger WHERE ${scope.where} AND seq<=? AND kind='assignment'
      AND json_type(data,'$.data.assignment_id')='text' AND json_extract(data,'$.data.assignment_id')=? LIMIT 2`)
      .all(scope.id, through, source.assignment_id) as { id: string | null }[]
    return rows.length === 1 ? rows[0]!.id ?? undefined : undefined
  }

  /** Metadata-only authorization preflight. No body hydration or returned counts.
   * The current contributor union is deliberately a superset of an append-bound read. */
  authorizationSessions(query: EngineeringHistoryQuery, objectiveRecords?: string[]): string[] {
    const scope = engineeringHistoryScope(query), sql = scopeSQL(scope, objectiveRecords)
    if ("objective_id" in scope && objectiveRecords === undefined) throw new Error("Objective history needs its authorized source owner")
    const rows = this.db.prepare(`SELECT DISTINCT session_id FROM ledger WHERE ${sql.where} ORDER BY session_id LIMIT 2001`).all(sql.id) as { session_id: string }[]
    if (rows.length > 2000) throw new ProcessingLimitError("history contributor set exceeds 2000 Sessions; use a narrower Session scope")
    const result = new Set(rows.map(row => uid(row.session_id, "source Session")))
    if ("session_id" in scope) result.add(scope.session_id)
    else if ("action_id" in scope) {
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
        CASE WHEN json_type(data,'$.fingerprint')='text' AND length(json_extract(data,'$.fingerprint'))=64
          AND json_extract(data,'$.fingerprint') NOT GLOB '*[^a-f0-9]*' THEN json_extract(data,'$.fingerprint') END AS fingerprint,
        CASE WHEN json_type(data,'$.data.attribution')='text' THEN substr(json_extract(data,'$.data.attribution'),1,201) END AS attribution,
        CASE WHEN json_type(data,'$.data.capture_gap') IN ('true','false') THEN json_extract(data,'$.data.capture_gap') END AS capture_gap,
        CASE WHEN json_type(data,'$.data.message_id')='text' AND length(json_extract(data,'$.data.message_id')) BETWEEN 1 AND 200
          THEN json_extract(data,'$.data.message_id') END AS message_id,
        CASE WHEN json_type(data,'$.data.statement')='text' THEN substr(json_extract(data,'$.data.statement'),1,160)
          WHEN json_type(data,'$.data.question')='text' THEN substr(json_extract(data,'$.data.question'),1,160) END AS landmark_title,
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
    ), qualified AS (
      SELECT *,CASE
        WHEN json_extract(group_key,'$[0]')='work' THEN 'established'
        WHEN json_type(data,'$.data.work_scope')='object' AND json_extract(data,'$.data.work_scope.status')='unscoped'
          AND (SELECT COUNT(*) FROM json_each(data,'$.data.work_scope'))=1 THEN 'unscoped'
        WHEN json_type(data,'$.data.work_scope')='object' AND json_extract(data,'$.data.work_scope.status')='unknown'
          AND NOT EXISTS (SELECT 1 FROM json_each(data,'$.data.work_scope') WHERE key NOT IN ('status','reason','detail'))
          AND json_extract(data,'$.data.work_scope.reason') IN ('source-missing','history-unavailable','processing-limit','not-observed')
          AND (json_type(data,'$.data.work_scope.detail') IS NULL OR json_type(data,'$.data.work_scope.detail')='text') THEN 'unknown'
        WHEN json_type(data,'$.data.work_scope')='object' AND json_extract(data,'$.data.work_scope.status')='ambiguous'
          AND NOT EXISTS (SELECT 1 FROM json_each(data,'$.data.work_scope') WHERE key NOT IN ('status','candidates','observation_ids'))
          AND json_type(data,'$.data.work_scope.candidates')='array' AND json_type(data,'$.data.work_scope.observation_ids')='array' THEN 'ambiguous'
        ELSE 'unavailable' END AS scope_status
      FROM grouped
    ), metadata AS (
      SELECT *,CASE WHEN kind='observation' AND (capture_gap=1 OR (phase='finished' AND attribution IS NOT 'captured-at-start')
        OR scope_status IN ('unknown','ambiguous','unavailable')) THEN 1 ELSE 0 END AS has_gaps FROM qualified
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

  /** Build navigation only from bounded source metadata and exact saved WorkRefs.
   * Containers aggregate their recorded descendants; their existence is never an
   * assertion that the parent contract ran. Nothing here writes or caches history. */
  private tree(scope: EngineeringHistoryScope, rows: Metadata[], definitionBytes: number): Map<string, BranchNode> {
    const nodes = new Map<string, BranchNode>()
    // Reuse exact definitions only within this read snapshot. Reserve the bytes
    // before asking the source owner to parse them. resolveWork reads the Plan
    // twice and the current Action three times (including Store.plan's checks).
    const definitions = new Map<string, ReturnType<Store["collaboration"]["resolveWork"]>>()
    const make = (key: string, value: Partial<BranchNode> & Pick<BranchNode, "kind" | "meaning" | "title">): BranchNode => {
      const existing = nodes.get(key)
      if (existing) return existing
      const node: BranchNode = { key, parent: null, children: new Set(), rows: [], work_ref: null, node_id: null, session_id: null,
        historical_node: null, historical_scope: null, gaps: [], ...value }
      nodes.set(key, node)
      return node
    }
    for (const keyText of new Set(rows.map(row => row.group_key))) {
      const key = JSON.parse(keyText) as GroupKey
      if (key[0] === "work") {
        const work_ref = checkedRef(key[1])
        const node = make(keyText, { kind: "historical-work", meaning: "recorded-work-binding", work_ref, node_id: work_ref.node_id,
          historical_scope: { action_revision: work_ref.action_revision, plan_revision: work_ref.plan_revision },
          title: `Work ${work_ref.node_id} · Plan revision ${work_ref.plan_revision}` })
        if (!("action_id" in scope)) {
          node.gaps.push(gap("action-definition-not-in-scope", "Historical Action and Plan content requires a separate authorized Action-scoped read."))
          continue
        }
        const definitionKey = JSON.stringify([work_ref.action_revision, work_ref.plan_revision]), prior = definitions.get(definitionKey)
        if (!prior) {
          const reservation = this.db.prepare(`SELECT
            2*COALESCE((SELECT octet_length(data) FROM plans WHERE action_id=? AND revision=?),0)
            +3*COALESCE((SELECT octet_length(data) FROM actions WHERE id=?),0)
            +COALESCE((SELECT octet_length(data) FROM action_versions WHERE action_id=? AND revision=?),0) AS bytes`)
            .get(scope.action_id, work_ref.plan_revision, scope.action_id, scope.action_id, work_ref.action_revision) as { bytes: number }
          definitionBytes += reservation.bytes
          if (!integer(definitionBytes) || definitionBytes > ENGINEERING_HISTORY_LIMITS.storedBytes)
            throw new ProcessingLimitError("engineering history historical definitions exceed the bounded read; use a narrower Session scope")
        }
        try {
          const definition = prior ?? this.store.collaboration.resolveWork(work_ref)
          if (prior && workReference(prior.action, prior.plan, work_ref.node_id).hash !== work_ref.hash) throw new Error("Historical WorkRef does not match its exact definition")
          const byID = new Map(definition.plan.nodes.map(item => [item.id, item])), historicalNode = byID.get(work_ref.node_id)
          if (!historicalNode) throw new Error("Historical node is unavailable")
          const resolved = { ...definition, node: historicalNode }
          definitions.set(definitionKey, definition)
          node.historical_node = compactNode(resolved.node); node.title = resolved.node.title
          node.gaps.push(gap("historical-definition-projected", "Historical node identity, kind, title and parent are shown. Read the exact Plan revision for contract fields, dependencies and acceptance criteria."))
          const revisions = node.historical_scope!
          const plan = make(JSON.stringify(["plan", revisions.action_revision, revisions.plan_revision]), { kind: "historical-plan", meaning: "historical-plan-structure",
            title: `Historical Plan ${revisions.plan_revision} · Action revision ${revisions.action_revision}`, historical_scope: revisions,
            gaps: [gap("structure-not-execution", "This saved Plan structure contains recorded descendant work. A container is not evidence that its own contract executed or completed.")] })
          let parent = plan.key, cursor = resolved.node.parent
          const ancestors: PlanNode[] = [], seen = new Set<string>([resolved.node.id])
          while (cursor) {
            if (seen.has(cursor) || ancestors.length >= 300) throw new Error("Historical Plan ancestry is invalid")
            seen.add(cursor)
            const ancestor = byID.get(cursor)
            if (!ancestor) throw new Error("Historical Plan ancestor is unavailable")
            ancestors.unshift(ancestor); cursor = ancestor.parent
          }
          for (const ancestor of ancestors) {
            const container = make(JSON.stringify(["structure", revisions.action_revision, revisions.plan_revision, ancestor.id]), {
              kind: "historical-node", meaning: "historical-plan-structure", title: ancestor.title, parent, node_id: ancestor.id,
              historical_node: compactNode(ancestor), historical_scope: revisions,
              gaps: [gap("structure-not-execution", "This exact saved ancestor organizes recorded descendant work; it is not an execution, assignment or completion claim.")] })
            parent = container.key
          }
          node.parent = parent
        } catch {
          node.historical_node = null
          node.gaps.push(gap("historical-definition-unavailable", "The exact recorded WorkRef definition could not be resolved; no current Plan definition was substituted."))
        }
      } else if (key[0] === "node") make(keyText, { kind: "unversioned-node", meaning: "unversioned-association", node_id: key[2],
        title: `Unversioned activity · ${key[2]}`, gaps: [gap("historical-binding-unknown", "Node association lacks a supported exact historical WorkRef. It is not assigned to the latest Plan.")] })
      else if (key[0] === "session") make(keyText, { kind: "session", meaning: "observed-session-group", session_id: key[1], title: `Session ${key[1]}`,
        gaps: [gap("session-group-not-invocation", "This is an observed Session group. It can contain multiple dispatches or objectives; neither membership nor invocation count is inferred.")] })
    }
    // A node can have both direct recorded work and recorded descendants. Keep
    // the direct binding as a separate child of its historical structure node.
    for (const node of nodes.values()) if (node.work_ref && node.parent) {
      const ref = node.work_ref, container = nodes.get(JSON.stringify(["structure", ref.action_revision, ref.plan_revision, ref.node_id]))
      if (container) { node.parent = container.key; node.title = `Direct activity · ${node.title}` }
    }
    const landmarks = new Map<string, Metadata>()
    for (const row of rows) {
      const base = nodes.get(row.group_key)!
      if (base.kind === "unversioned-node" && row.fingerprint) {
        const contract = make(JSON.stringify(["fingerprint", row.action_id, row.node_id, row.fingerprint]), {
          kind: "unversioned-node", meaning: "unversioned-association", parent: base.key, node_id: row.node_id,
          title: `Recorded contract · ${row.node_id} · ${row.fingerprint.slice(0, 12)}`,
          gaps: [...base.gaps, gap("source-work-fingerprint", `These source records explicitly carry subject fingerprint ${row.fingerprint}. It can remain equal across Plan revisions and unrelated edits; it does not identify an exact Plan revision, invocation or execution.`)] })
        row.group_key = contract.key
      } else if (base.kind === "session") {
        let child: BranchNode
        if (row.kind === "observation" && row.message_id) child = make(JSON.stringify(["message", row.session_id, row.message_id]), {
          kind: "message", meaning: "observed-message-group", title: `Recorded message ${row.message_id}`, parent: base.key, session_id: row.session_id,
          gaps: [gap("message-group-not-invocation", "Observations share the recorded host message identity within this Session. A message is not a dispatch, objective or complete native transcript.")] })
        else {
          if (materialKinds.has(row.kind)) landmarks.set(row.session_id, row)
          const landmark = landmarks.get(row.session_id)
          child = make(JSON.stringify(["chronology", row.session_id, landmark?.id ?? null]), {
            kind: "chronology", meaning: "analytical-chronology", parent: base.key, session_id: row.session_id,
            title: landmark ? `From ${landmark.kind} · ${landmark.landmark_title ?? `sequence ${landmark.seq}`}` : "Chronology before an authored landmark",
            gaps: [gap("analytical-chronology-not-execution", "Records without a recorded message identity are grouped by Session sequence, from this authored landmark until the next material authored landmark. This analytical navigation does not infer an attempt, execution phase, cause or objective.")] })
        }
        row.group_key = child.key
      }
    }
    for (const node of nodes.values()) if (node.parent) nodes.get(node.parent)!.children.add(node.key)
    for (const row of rows) {
      let node: BranchNode | undefined = nodes.get(row.group_key)
      while (node) { node.rows.push(row); node = node.parent ? nodes.get(node.parent) : undefined }
    }
    for (const [key, node] of nodes) if (!node.rows.length) nodes.delete(key)
    return nodes
  }

  private branch(scope: EngineeringHistoryScope, node: BranchNode, through: number, limit: number): EngineeringHistoryBranch {
    const ref = this.branchRef(scope, node.key)
    return { ref, kind: node.kind, title: node.title, meaning: node.meaning, work_ref: node.work_ref, node_id: node.node_id, session_id: node.session_id,
      parent_ref: node.parent ? this.branchRef(scope, node.parent) : null, child_count: node.children.size, historical_scope: node.historical_scope,
      counts: node.counts ??= countRows(node.rows), first_sequence: node.rows[0].seq, last_sequence: node.rows.at(-1)!.seq,
      historical_node: node.historical_node, gaps: [...node.gaps], expand: { ...scope, branch_ref: ref, through, limit } }
  }

  private ranked(nodes: BranchNode[]): BranchNode[] {
    const keys = ["reported_failures", "observed_tool_errors", "reported_reopens", "concerns", "reported_inconclusive", "reported_completions"] as const
    for (const node of nodes) node.counts ??= countRows(node.rows)
    return nodes.sort((a, b) => {
      for (const key of keys) { const delta = b.counts![key] - a.counts![key]; if (delta) return delta }
      return b.rows.at(-1)!.seq - a.rows.at(-1)!.seq || a.key.localeCompare(b.key)
    })
  }

  private observationScope(data: Record<string, unknown>, row: Metadata, available: Map<string, Metadata>): EngineeringHistoryWorkScope {
    const raw = data.work_scope
    if (!object(raw)) return { status: "unavailable", reason: raw === undefined ? "absent" : "unsupported" }
    if (row.scope_status === "established") return { status: "established", work_ref: checkedRef((JSON.parse(row.group_key) as ["work", WorkRef])[1]) }
    if (row.scope_status === "unscoped") return { status: "unscoped" }
    if (row.scope_status === "unknown") {
      const detail = typeof raw.detail === "string" ? raw.detail : null
      return { status: "unknown", reason: raw.reason as "source-missing" | "history-unavailable" | "processing-limit" | "not-observed",
        detail: detail?.slice(0, 200) ?? null, detail_excerpted: detail !== null && detail.length > 200 }
    }
    if (row.scope_status === "ambiguous" && Array.isArray(raw.candidates) && Array.isArray(raw.observation_ids)) {
      // An arbitrary stored pointer cannot expose an outside source identity.
      // Candidate WorkRefs require a supporting, already in-scope start row;
      // the source's bounded possibilities never become an exhaustive set.
      const observation_ids = [...new Set(raw.observation_ids.slice(0, 20).filter((id): id is string => {
        const target = typeof id === "string" ? available.get(id) : undefined
        return !!target && target.kind === "observation" && target.phase === "started"
      }))]
      const supported = new Set(observation_ids.flatMap(id => {
        const target = available.get(id)!
        return target.scope_status === "established" ? [canonical((JSON.parse(target.group_key) as ["work", WorkRef])[1])] : []
      }))
      const candidates: WorkRef[] = [], seen = new Set<string>()
      for (const value of raw.candidates.slice(0, 20)) {
        try {
          const candidate = checkedRef(value as WorkRef), key = canonical(candidate)
          if (supported.has(key) && !seen.has(key)) { seen.add(key); candidates.push(candidate) }
        } catch { /* Unsupported source shapes remain omitted, never normalized. */ }
      }
      return { status: "ambiguous", candidates, observation_ids, candidates_complete: false,
        candidates_omitted: raw.candidates.length - candidates.length, observation_ids_omitted: raw.observation_ids.length - observation_ids.length }
    }
    return { status: "unavailable", reason: "unsupported" }
  }

  private project(scope: EngineeringHistoryScope, rows: Metadata[], through: number, available: Map<string, Metadata>, limit: number): EngineeringHistoryRecord[] {
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
      const metadata = available.get(record.id)!
      let work_ref: WorkRef | null = null
      const parsed = JSON.parse(key) as GroupKey
      if (parsed[0] === "work") work_ref = checkedRef(parsed[1])
      const phase = small(record.data.phase), tool = small(record.data.tool), status = small(record.data.status)
      const gaps = [gap("originals-not-expanded", "Original native messages, tool bodies and external artifacts are not resolved by this projection; follow separately authorized source readers.")]
      const attribution = typeof record.data.attribution === "string" ? record.data.attribution : null
      const qualification = typeof record.data.observation === "string" ? record.data.observation : null
      const work_scope = observed ? this.observationScope(record.data, metadata, available) : null
      if (observed && rowHasGap(metadata)) gaps.push(gap("observation-coverage-gap", "The recorded capture continuity, finish attribution or work scope is incomplete or ambiguous. These are record counts, not counts of independent gap incidents."))
      if (work_scope?.status === "ambiguous") gaps.push(gap("ambiguous-work-scope", "Only bounded candidate identities supported by observations inside this authorized scope and append boundary are shown. They are possibilities, not established work membership or an exhaustive set."))
      if (work_scope?.status === "unavailable") gaps.push(gap("observation-scope-unavailable", "No supported frozen work scope was recorded. Current selection and current Plan were not substituted."))
      const start = typeof record.data.start_id === "string" ? available.get(record.data.start_id) : undefined
      return { ref: `loom-record:${encodeURIComponent(this.store.reviews.storeID)}:${encodeURIComponent(record.id)}`,
        branch_ref: this.branchRef(scope, key), kind: record.kind, sequence, session_id: record.session_id, agent: record.agent, created_at: record.created_at,
        meaning: observed ? "observed" : "authored", title: observed ? [tool, phase].filter(Boolean).join(" · ") || "Recorded observation" : record.kind,
        excerpt: text?.slice(0, ENGINEERING_HISTORY_LIMITS.excerptChars) ?? null, excerpt_truncated: text !== null && text.length > ENGINEERING_HISTORY_LIMITS.excerptChars,
        verdict: small(record.data.verdict, 64), verification: observed ? "recorded observation; engineering outcome not established" : "authored claim; not independently verified",
        work_ref, fingerprint: digest(record.fingerprint), expand: { ...scope, branch_ref: this.branchRef(scope, key), through, limit },
        trajectory: { ...scope, record_id: record.id, related: true, through, limit }, observation: observed ? { tool, phase, status,
          elapsed_ms: typeof record.data.duration_ms === "number" && Number.isFinite(record.data.duration_ms) && record.data.duration_ms >= 0 ? record.data.duration_ms : null,
          start_id: start?.kind === "observation" && start.phase === "started" ? start.id : null,
          capture_gap: typeof record.data.capture_gap === "boolean" ? record.data.capture_gap : null,
          attribution: attribution?.slice(0, 200) ?? null, attribution_excerpted: attribution !== null && attribution.length > 200,
          finish_pairing: phase !== "finished" ? "not-applicable" : attribution === "captured-at-start" ? "paired" : "unestablished",
          work_scope: work_scope!, message_id: small(record.data.message_id), call_id: small(record.data.call_id), correlation_key: small(record.data.correlation_key),
          observer_epoch: small(record.data.observer_epoch), input_digest: digest(record.data.input_digest), result_digest: digest(record.data.result_digest),
          agent_id: small(record.data.agent_id), skill_id: small(record.data.skill_id), lens: small(record.data.lens),
          content_sha256: digest(record.data.content_sha256), context_system_sha256: digest(record.data.context_system_sha256),
          rendered_sha256: digest(record.data.rendered_sha256), registry_content_sha256: digest(record.data.registry_content_sha256),
          registered_content_present: typeof record.data.registered_content_present === "boolean" ? record.data.registered_content_present : null,
          source: small(record.data.source), qualification: qualification?.slice(0, 600) ?? null, qualification_excerpted: qualification !== null && qualification.length > 600,
        } : null, source, gaps }
    })
  }

  read(query: EngineeringHistoryQuery, owners?: EngineeringHistoryOwners): EngineeringHistoryView {
    const scope = engineeringHistoryScope(query), sql = scopeSQL(scope, owners?.record_ids ?? owners?.objectives?.ledger_record_ids), limit = query.limit ?? ENGINEERING_HISTORY_LIMITS.branches
    const connectionPage = query.connection_cursor !== undefined
    if ("objective_id" in scope && !owners?.objectives) throw new Error("Objective history needs its authorized source owner")
    if (query.owner_boundary && !owners) throw new Error("History owner boundaries require the original source owners")
    if (query.owner_version && query.owner_version !== owners?.version) throw new Error("History relationship sources changed; restart the read")
    const trajectory = query.related === true || "objective_id" in scope && query.branch_ref === undefined && query.record_id === undefined
    const selectedKey = query.branch_ref === undefined ? undefined : this.branchKey(scope, query.branch_ref)
    this.db.exec("BEGIN")
    try {
      const overview = !connectionPage && !trajectory && query.branch_ref === undefined && query.record_id === undefined
        && !selectionFields.some(name => query[name] !== undefined)
      // The intent read hydrates one Action. Only the overview needs today's
      // Plan; Store.plan also reads that Action. Reserve all of those bytes
      // before hydration and carry them into the historical-definition budget.
      const definitionBytes = "action_id" in scope ? (this.db.prepare(`SELECT
        ?*COALESCE((SELECT octet_length(data) FROM actions WHERE id=?),0)
        +?*COALESCE((SELECT octet_length(data) FROM plans WHERE action_id=? ORDER BY revision DESC LIMIT 1),0) AS bytes`)
        .get(overview ? 2 : 1, scope.action_id, overview ? 1 : 0, scope.action_id) as { bytes: number }).bytes : 0
      if (!integer(definitionBytes) || definitionBytes > ENGINEERING_HISTORY_LIMITS.storedBytes)
        throw new ProcessingLimitError("engineering history historical definitions exceed the bounded read; use a narrower Session scope")
      const action = "action_id" in scope ? this.store.action(scope.action_id) : undefined
      const plan = action && overview ? this.store.plan(action.id) : undefined
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
      const selection = selectedFilters(query), filtering = Object.keys(selection).length > 0, filter = discoverySQL(selection)
      const rows = this.db.prepare(this.prefix(sql.where) + `SELECT seq,id,data_bytes,group_key,action_id,node_id,session_id,kind,fingerprint,
        verdict,phase,status,attribution,capture_gap,scope_status,message_id,landmark_title,CASE WHEN ${filter.where} THEN 1 ELSE 0 END AS matched
        FROM metadata ORDER BY seq`).all(sql.id, through, ...filter.args) as Metadata[]
      const tree = this.tree(scope, rows, definitionBytes), available = new Map(rows.map(row => [row.id, row]))
      const graph = new EngineeringConnections(this.store.reviews.storeID, scope, owners,
        new Map(rows.map(row => [row.id, { id: row.id, seq: row.seq, work_ref: tree.get(row.group_key)?.work_ref ?? null }])))
      this.legacyConnections(graph, scope, sql, through, available)
      const exact = query.record_id ? available.get(query.record_id) : undefined
      if (query.record_id && (!exact || !exact.matched)) throw new Error("History record is unavailable in the selected source scope and boundary")
      const connected = trajectory ? graph.reachable(query.record_id, "objective_id" in scope ? scope.objective_id : undefined) : null
      const effectiveKey = trajectory ? undefined : exact?.group_key ?? selectedKey, selectedNode = effectiveKey === undefined ? undefined : tree.get(effectiveKey)
      if (effectiveKey !== undefined && !selectedNode) throw new Error("History branch is unavailable in this source scope and boundary")
      const selected_branch = selectedNode ? this.branch(scope, selectedNode, through, limit) : null
      const matching = (selectedNode?.rows ?? rows).filter(row => row.matched && (!connected || connected.has(row.id))), matchingKeys = new Set(matching.map(row => row.group_key))
      const candidates = trajectory ? [] : this.ranked(filtering ? [...matchingKeys].map(key => tree.get(key)!)
        : selectedNode ? [...selectedNode.children].map(key => tree.get(key)!) : [...tree.values()].filter(node => node.parent === null))
      const branchOffset = query.branch_offset ?? 0
      const branches = connectionPage ? [] : candidates.slice(branchOffset, branchOffset + limit).map(node => this.branch(scope, node, through, limit))
      const ancestors: EngineeringHistoryBranch[] = []
      let parent = selectedNode?.parent
      while (parent) { const node = tree.get(parent)!; ancestors.unshift(this.branch(scope, node, through, limit)); parent = node.parent }
      // Equal subject fingerprints compare the same stored Action/node contract.
      // They cannot select a Plan revision, invocation, assignment or outcome.
      const fingerprints = new Set((selectedNode?.rows ?? []).flatMap(row => row.fingerprint ? [JSON.stringify([row.action_id, row.node_id, row.fingerprint])] : []))
      const selectedKeys = new Set(selectedNode?.rows.map(row => row.group_key) ?? [])
      const relatedNodes = selectedNode ? this.ranked([...tree.values()].filter(node => node.children.size === 0 && !selectedKeys.has(node.key)
        && node.rows.some(row => row.fingerprint && fingerprints.has(JSON.stringify([row.action_id, row.node_id, row.fingerprint]))))) : []
      const related_branches = relatedNodes.slice(0, ENGINEERING_HISTORY_LIMITS.branches).map(node => {
        const branch = this.branch(scope, node, through, limit)
        branch.gaps.push(gap("same-work-fingerprint", "Some source records share an explicitly recorded subject fingerprint for the same Action and node. This compares the work contract; it does not establish an exact Plan revision, execution identity, assignment, completion or cause."))
        return branch
      })
      // Fixed independent representative lanes do not change when callers page
      // one child or one record at a time. Gaps have their own visible lane.
      const laneRows = new Map<string, Metadata[]>()
      for (const row of matching) {
        const lane = (row.kind === "assessment" || row.kind === "qa") && row.verdict === "fail" ? "failure"
          : row.kind === "observation" && row.status === "error" ? "tool-error"
          : row.kind === "reopen" ? "reopen" : row.kind === "concern" ? "concern"
          : (row.kind === "assessment" || row.kind === "qa") && row.verdict === "inconclusive" ? "inconclusive"
          : row.kind === "completion" ? "completion" : row.kind === "result" ? "result"
          : (row.kind === "assessment" || row.kind === "qa") && row.verdict === "pass" ? "pass" : null
        for (const category of [...(lane ? [lane] : []), ...(rowHasGap(row) ? ["gap"] : [])]) {
          const items = laneRows.get(category) ?? []; items.push(row); if (items.length > 2) items.shift(); laneRows.set(category, items)
        }
      }
      const highRows = [...new Map([...laneRows.values()].flat().map(row => [row.id, row])).values()].sort((a, b) => a.seq - b.seq)
        .slice(0, ENGINEERING_HISTORY_LIMITS.highlights)
      const highlights = this.project(scope, trajectory || connectionPage ? [] : highRows, through, available, limit)
      let recordRows: Metadata[] = [], next_after: number | null = null
      if (exact && !trajectory) recordRows = [exact]
      else if (trajectory || selectedNode || filtering) {
        const eligible = matching.filter(row => row.seq > (query.after ?? 0))
        recordRows = eligible.slice(0, limit)
        if (eligible.length > limit) next_after = recordRows.at(-1)!.seq
      }
      // One canonical projected object per source identity. A record displayed in
      // both the highlight and detail lanes must carry the same qualifications.
      const selectedIDs = new Set([...(trajectory ? [] : highRows), ...recordRows].map(row => row.id))
      const included = new Map(highlights.map(record => [record.source.record_id, record]))
      const records = this.project(scope, connectionPage ? [] : recordRows, through, available, limit).map(record => {
        const existing = included.get(record.source.record_id)
        if (existing) return existing
        included.set(record.source.record_id, record)
        return record
      })
      const ownerScope = owners ? { owner_boundary: owners.boundary, owner_version: owners.version } : {}
      for (const record of included.values()) {
        if (trajectory) {
          // A focused trajectory already supplies the connected group. A record
          // context read is enough to recover its structural branch; repeating
          // each long branch selector here needlessly enlarges every page.
          record.expand = { ...scope, record_id: record.source.record_id, through, limit }
          record.gaps = record.gaps.filter(item => item.code !== "originals-not-expanded")
        }
        Object.assign(record.expand, ownerScope)
        Object.assign(record.trajectory, ownerScope)
      }
      for (const branch of [...branches, ...ancestors, ...related_branches, ...(selected_branch ? [selected_branch] : [])]) Object.assign(branch.expand, ownerScope)
      const repeat: EngineeringHistoryQuery = { ...query, ...selection, ...scope, through, limit, ...ownerScope }
      const { connections, relationships, next_connections, next_relationships } = graph.page(selectedIDs, limit, repeat,
        trajectory ? null : ENGINEERING_HISTORY_LIMITS.relationships,
        "action_id" in scope && !trajectory && !filtering && query.record_id === undefined && query.branch_ref === undefined)
      for (const [id, record] of included) record.gaps.push(...graph.recordGaps(id, relationships))
      const returned = included.size
      const view: EngineeringHistoryView = {
        format: "loom-engineering-history/v1", mode: connectionPage ? "connections" : trajectory ? "trajectory" : query.record_id ? "record" : filtering ? "discovery" : selectedNode ? "branch" : "overview", selection,
        scope, store_id: this.store.reviews.storeID,
        boundary: { live: true, observed_through: through, current_through: current.sequence, membership: "append-bound only; not a frozen retrospective population",
          ...(owners ? { owners: owners.boundary, owner_version: owners.version } : {}) },
        intent: { title: action?.title ?? ("objective_id" in scope ? owners?.objectives?.objectives.find(item => item.id === scope.objective_id)?.label ?? "Authored objective" : `Session ${"session_id" in scope ? scope.session_id : ""}`), goal: trajectory || connectionPage ? null : action?.goal ?? null,
          meaning: action ? "current-authored-action" : "objective_id" in scope ? "authored-objective" : "session-scope", action_revision: action?.revision ?? null },
        intended_plan: !connectionPage && !selectedNode && !filtering && plan && plan.revision > 0 ? { revision: plan.revision, nodes: plan.nodes.slice(0, ENGINEERING_HISTORY_LIMITS.planNodes).map(compactNode),
          nodes_total: plan.nodes.length, nodes_omitted: Math.max(0, plan.nodes.length - ENGINEERING_HISTORY_LIMITS.planNodes), projection: "identity-and-title",
          read: { tool: "loom_plan", query: { operation: "read", action_id: action!.id, revision: plan.revision } },
          meaning: "current-intended-structure; not historical execution membership" } : null,
        totals: countRows(connectionPage ? rows.filter(row => selectedIDs.has(row.id)) : trajectory ? matching : rows), branches,
        selected_branch: connectionPage ? null : selected_branch, ancestors: connectionPage ? [] : ancestors,
        related_branches: connectionPage ? [] : related_branches, highlights, records, relationships, connections,
        navigation: { repeat, next_records: connectionPage || next_after === null ? null : { ...repeat, after: next_after },
          next_branches: !connectionPage && branchOffset + branches.length < candidates.length ? { ...repeat, branch_offset: branchOffset + branches.length } : null,
          next_connections, next_relationships },
        coverage: { ledger: "complete-within-boundary", page_limit: limit, branch_count: connectionPage ? 0 : candidates.length, total_branch_count: connectionPage ? 0 : tree.size,
          matching_records: connectionPage ? selectedIDs.size : matching.length, matching_branches: connectionPage ? 0 : matchingKeys.size,
          related_branches_omitted: connectionPage ? 0 : Math.max(0, relatedNodes.length - related_branches.length),
          branches_returned: branches.length, branches_omitted: connectionPage ? 0 : candidates.length - branches.length,
          records_returned: returned, records_omitted: Math.max(0, (connectionPage ? selectedIDs.size : matching.length) - returned), next_after: connectionPage ? null : next_after,
          next_branch_offset: !connectionPage && branchOffset + branches.length < candidates.length ? branchOffset + branches.length : null,
          gaps: [gap("ledger-coverage-only", connectionPage ? "This page expands relationships for the original selected source references. Record bodies and the global overview are not repeated; use the retained context request for them."
            : trajectory ? "Counts describe the selected connected sources. Explicit citations reach original evidence without making it authored objective membership. Unrecorded native activity and complete objective coverage remain unknown."
            : "Counts cover this authorized Loom ledger scope only. Unrecorded native activity, child Sessions and complete objective membership are unknown."),
            ...(trajectory || connectionPage ? [] : [gap("representative-highlights", `Highlights select at most two recent records per significant category, including coverage gaps, independently of the page limit. They are representatives, not a complete chronology. Relationship detail is limited to ${ENGINEERING_HISTORY_LIMITS.relationships} references per included record; omissions are qualified on that record.`),
              gap("literal-discovery", "Discovery filters scan all eligible records inside this authorized scope and append boundary before paging. match is literal ASCII-folded substring search over authored prose and named observed metadata, not native bodies, semantic search or a guarantee of relevance.")]),
            gap("claims-not-verification", "Completion, assessments and QA verdicts remain authored claims. No aggregate proves successful delivery or resolves a concern."),
            gap("native-originals-unavailable", "This view does not read native history, assignments, model reasoning or tool bodies. Exact native originals retain their existing source-owner limitations."),
            ...connections.gaps,
            gap("live-not-frozen", "through and owner_boundary fence append membership in their separate owners; owner_version detects changed relationship views. Current Action/Plan intent may change. These are live navigation boundaries, not an immutable evaluation population or authority."),
            ...(!connectionPage && candidates.length > branches.length ? [gap("branches-omitted", "Only this page of immediate children or matching leaves is returned. Whole-scope totals remain complete. Retain scope, filters, selected branch and through when following next_branch_offset, or use discovery to locate omitted eligible evidence directly.")] : [])] }
      }
      const oversized = () => new ProcessingLimitError("engineering history response exceeds 262144 bytes; narrow the discovery filters or Session scope, or try a smaller page limit")
      let encoded: string
      try { encoded = canonical(view, new ProcessingBudget(ENGINEERING_HISTORY_LIMITS.responseBytes)) }
      catch (error) { if (error instanceof ProcessingLimitError) throw oversized(); throw error }
      if (Buffer.byteLength(encoded, "utf8") > ENGINEERING_HISTORY_LIMITS.responseBytes) throw oversized()
      this.db.exec("COMMIT")
      return view
    } catch (error) { this.db.exec("ROLLBACK"); throw error }
  }

  /** Resolve explicit ledger relationships in both directions. The fixed field
   * projection does not hydrate statements or use wording/time as an edge. */
  private legacyConnections(graph: EngineeringConnections, scope: EngineeringHistoryScope,
    sql: { where: string; id: string }, through: number, available: Map<string, Metadata>) {
    const fields = this.db.prepare(`SELECT ${relationshipFields}
      FROM ledger WHERE ${sql.where} AND seq<=? AND (
        json_type(data,'$.data.evidence_ids')='array' OR json_type(data,'$.data.start_id')='text'
        OR json_type(data,'$.data.question_id')='text' OR json_type(data,'$.data.previous_report_id')='text'
        OR json_type(data,'$.data.assignment_id')='text'
        OR kind='question' AND json_type(data,'$.data.work_ref')='object')`).all(sql.id, through) as LedgerRelationshipFields[]
    const byID = new Map(fields.map(item => [item.id, item]))
    const assignments = new Map<string, string>(), duplicates = new Set<string>()
    const assignmentKey = (item: LedgerRelationshipFields) => JSON.stringify([item.action_id,
      item.action_id ? null : item.session_id, item.assignment_id])
    for (const item of fields) if (item.kind === "assignment" && typeof item.assignment_id === "string") {
      const key = assignmentKey(item)
      if (assignments.has(key)) duplicates.add(key)
      assignments.set(key, item.id)
    }
    for (const item of fields) {
      const references = ledgerReferences(item, id => available.has(id) ? byID.get(id) ?? available.get(id) : undefined, () => {
        const key = assignmentKey(item)
        // Objective roots can contain only a subset of the original Action.
        // Uniqueness must still include an assignment omitted from that subset.
        const id = "objective_id" in scope ? this.assignmentOriginalID(item, through)
          : duplicates.has(key) ? undefined : assignments.get(key)
        return id && available.has(id) ? byID.get(id) : undefined
      })
      graph.recordReferences(item.id, references.unresolved, references.omitted)
      for (const reference of references.resolved)
        graph.addRecord(item.id, reference.id, reference.kind, reference.meaning, reference.qualification)
    }
  }
}
