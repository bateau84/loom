import { randomUUID } from "node:crypto"
import { checkedRef, workReference, type WorkRef } from "./collaboration.js"
import { canonical, digest, uid, ProcessingBudget, ProcessingLimitError, PROCESSING_LIMITS, type Actor, type LedgerRecord } from "./model.js"
import { ReviewIssues, type IssueIntentKey, type ReviewIssueRequest } from "./review-issues.js"
import { RETRIEVAL_LIMITS, type SQL, type Store } from "./store.js"

type FrozenWorkMembership = { member_id: string; selection: WorkRef; constituents: WorkRef[] }

export type GapReason = "not-observed" | "unsupported-host-boundary" | "missing-native-field" | "opaque-inner-call"
  | "capture-disabled" | "capture-failed" | "observer-discontinuity" | "history-unavailable" | "compacted"
  | "redacted" | "not-authorized" | "source-missing" | "source-changed" | "unsupported-version" | "processing-limit"
const gaps: readonly string[] = ["not-observed", "unsupported-host-boundary", "missing-native-field", "opaque-inner-call",
  "capture-disabled", "capture-failed", "observer-discontinuity", "history-unavailable", "compacted", "redacted",
  "not-authorized", "source-missing", "source-changed", "unsupported-version", "processing-limit"]
export type ArtifactRef = { locator: string; version: { kind: "git"; repository: string; object_id: string; path: string | null }
  | { kind: "sha256"; value: string }; content_ref: string | null }
export type ReviewMember = { member_id: string; work_ref: WorkRef | null; producing_attempt_refs: string[];
  artifact_refs: ArtifactRef[]; prior_review_request_id: string | null; membership_source_refs: string[];
  gaps: Array<{ reason: GapReason; source_ref: string | null }> }
export type ReviewMandate = { question: string; dimensions: string[]; criteria: Array<{ text: string; source_ref: string | null }>;
  mode: string; inclusions: string[]; exclusions: string[]; currentness?: "current-at-issue-claim" }
export type ReviewRequest = { format: "loom-review-request/v1"; request_id: string; requester: Actor;
  mandate: ReviewMandate; intended_recipient: { agent: string; session_id: string | null };
  work_revision_policy: "frozen-historical" | "current-at-issue-claim"; members: ReviewMember[];
  rechecks: Array<{ request_id: string; finding_ids: string[] }>; extensions?: Record<string, unknown> }
type RelationshipKind = "observed" | "retrieved" | "cited" | "claimed-inspected" | "finding" | "correction"
type Relationship = { format: "loom-review-relationship/v1"; request_id: string; relationship: RelationshipKind;
  source_record_id: string; member_ids: string[]; author: Actor; source_producer: Actor;
  relationship_attribution: { status: "established"; basis: "original-source-return" }
    | { status: "unknown"; reason: "authored-association-unverified" };
  review_binding: { status: "unknown"; reason: "unsupported-host-boundary" };
  observed_source?: Record<string, unknown>; declared_verdict?: string; verdict_scope?: string; supersedes?: string }
export type ReviewHistorySelection = {
  action_id?: string; session_id?: string; record_ids?: string[];
  through?: number; request_through?: number; relationship_through?: number;
}
export type ReviewHistorySources = {
  contributors: string[]; ledger_record_ids: string[]; through: number;
  request_through: number; relationship_through: number; digest: string;
}
export type ReviewHistorySnapshot = ReviewHistorySources & {
  requests: Array<{ request: ReviewRequest; frozen_work_membership: FrozenWorkMembership[];
    relationships: Array<Relationship & { id: string; sequence: number; source_availability: "record-available" }>;
    qualification: { request: "frozen-authored-mandate"; native_review_binding: { status: "unknown"; reason: "unsupported-host-boundary" };
      rechecks: "requested-only; actual inspection and verification require their own evidence";
      source_content: "references-only; original source permission required" } }>;
  gaps: Array<{ code: string; detail: string }>; content_digest: string;
}
const HISTORY_LIMITS = { requests: 1000, relationships: 10000, ledger: 100000, bytes: 8 * 1024 * 1024 } as const
type ReviewHistoryRequestRow = { rowid: number; request_id: string; data_bytes: number; membership_bytes: number }
type ReviewHistoryRelationshipRow = { id: string; sequence: number; request_id: string; source_record_id: string;
  author_session: string; source_session: string; supersedes: string | null; data_bytes: number }
type ReviewHistoryLedgerRow = { id: string; seq: number; session_id: string; action_id: string | null; work_ref: string | null; data_bytes: number }
const historyHash = (value: unknown) => digest(value, new ProcessingBudget(HISTORY_LIMITS.bytes, 1000000))
export class ReviewRequestError extends Error {
  constructor(readonly code: string, message: string) { super(message) }
}
function object(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new ReviewRequestError("validation", `${label} must be an object`)
  return value as Record<string, unknown>
}
function fields(value: Record<string, unknown>, allowed: string[], required = allowed) {
  for (const key of Object.keys(value)) if (!allowed.includes(key)) throw new ReviewRequestError("validation", `${key} is not supported`)
  for (const key of required) if (!(key in value)) throw new ReviewRequestError("validation", `${key} is required`)
}
// Authored mandate text is deliberately not trimmed or rewritten.
function text(value: unknown, label: string, max = 16000): string {
  if (typeof value !== "string" || !value.trim() || value.length > max) throw new ReviewRequestError("validation", `${label} must be nonempty text of at most ${max} characters`)
  return value
}
function nullableText(value: unknown, label: string): string | null { return value === null ? null : text(value, label, 2000) }
function list<T>(value: unknown, label: string, parse: (value: unknown) => T, max = 100): T[] {
  if (!Array.isArray(value) || value.length > max) throw new ReviewRequestError("validation", `${label} must be an array of at most ${max} entries`)
  return value.map(parse)
}
const strings = (value: unknown, label: string) => list(value, label, v => text(v, label, 2000))
function work(value: unknown): WorkRef {
  const ref = object(value, "work_ref")
  fields(ref, ["action_id", "node_id", "action_revision", "plan_revision", "hash"])
  if (typeof ref.action_revision !== "number" || typeof ref.plan_revision !== "number") throw new ReviewRequestError("validation", "Invalid work_ref revisions")
  return checkedRef({ action_id: uid(ref.action_id), node_id: uid(ref.node_id), action_revision: ref.action_revision,
    plan_revision: ref.plan_revision, hash: text(ref.hash, "hash", 64) })
}
function artifact(value: unknown): ArtifactRef {
  const ref = object(value, "artifact_ref")
  fields(ref, ["locator", "version", "content_ref"])
  const version = object(ref.version, "artifact version")
  let parsed: ArtifactRef["version"]
  if (version.kind === "sha256") {
    fields(version, ["kind", "value"])
    if (typeof version.value !== "string" || !/^[a-f0-9]{64}$/.test(version.value)) throw new ReviewRequestError("validation", "Artifact SHA-256 must identify exact bytes")
    parsed = { kind: "sha256", value: version.value }
  } else if (version.kind === "git") {
    fields(version, ["kind", "repository", "object_id", "path"])
    if (typeof version.object_id !== "string" || !/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(version.object_id)) throw new ReviewRequestError("validation", "Artifact Git version requires a full immutable object ID")
    parsed = { kind: "git", repository: text(version.repository, "repository", 2000), object_id: version.object_id, path: nullableText(version.path, "path") }
  } else throw new ReviewRequestError("unsupported-version", "Unsupported artifact version")
  return { locator: text(ref.locator, "locator", 2000), version: parsed, content_ref: nullableText(ref.content_ref, "content_ref") }
}
function member(value: unknown): ReviewMember {
  const v = object(value, "review member")
  fields(v, ["member_id", "work_ref", "producing_attempt_refs", "artifact_refs", "prior_review_request_id", "membership_source_refs", "gaps"])
  const parsed: ReviewMember = { member_id: uid(v.member_id), work_ref: v.work_ref === null ? null : work(v.work_ref),
    producing_attempt_refs: list(v.producing_attempt_refs, "producing_attempt_refs", v => uid(v)),
    artifact_refs: list(v.artifact_refs, "artifact_refs", artifact, 50),
    prior_review_request_id: v.prior_review_request_id === null ? null : uid(v.prior_review_request_id),
    membership_source_refs: strings(v.membership_source_refs, "membership_source_refs"),
    gaps: list(v.gaps, "gaps", raw => {
      const gap = object(raw, "gap"); fields(gap, ["reason", "source_ref"])
      if (typeof gap.reason !== "string" || !gaps.includes(gap.reason)) throw new ReviewRequestError("validation", "Unknown source gap")
      return { reason: gap.reason as GapReason, source_ref: nullableText(gap.source_ref, "source_ref") }
    }) }
  if (!parsed.work_ref && !parsed.producing_attempt_refs.length && !parsed.artifact_refs.length && !parsed.prior_review_request_id)
    throw new ReviewRequestError("validation", "Review member must select a concrete subject")
  return parsed
}
function mandate(value: unknown): ReviewMandate {
  const v = object(value, "mandate")
  const required = ["question", "dimensions", "criteria", "mode", "inclusions", "exclusions"]
  fields(v, [...required, "currentness"], required)
  if (v.currentness !== undefined && v.currentness !== "current-at-issue-claim") throw new ReviewRequestError("validation", "Unsupported original currentness condition")
  return { question: text(v.question, "question"), dimensions: strings(v.dimensions, "dimensions"),
    criteria: list(v.criteria, "criteria", raw => {
      const c = object(raw, "criterion"); fields(c, ["text", "source_ref"])
      return { text: text(c.text, "criterion"), source_ref: nullableText(c.source_ref, "source_ref") }
    }), mode: text(v.mode, "mode"), inclusions: strings(v.inclusions, "inclusions"), exclusions: strings(v.exclusions, "exclusions"),
    ...(v.currentness === "current-at-issue-claim" ? { currentness: v.currentness } : {}) }
}
function parseRequest(actor: Actor, raw: unknown, stored = false): ReviewRequest {
  canonical(raw, new ProcessingBudget(PROCESSING_LIMITS.recordChars))
  const v = object(raw, "review request")
  const required = ["format", "request_id", "mandate", "intended_recipient", "members", "rechecks"]
  fields(v, [...required, "work_revision_policy", "extensions", ...(stored ? ["requester"] : [])], required)
  if (v.format !== "loom-review-request/v1") throw new ReviewRequestError("unsupported-version", "Unsupported review request version")
  const original = mandate(v.mandate), recipient = object(v.intended_recipient, "intended_recipient")
  fields(recipient, ["agent", "session_id"])
  const policy = original.currentness === "current-at-issue-claim" ? "current-at-issue-claim" : "frozen-historical"
  if (v.work_revision_policy !== undefined && v.work_revision_policy !== policy)
    throw new ReviewRequestError("validation", "work_revision_policy must follow the original mandate.currentness condition")
  const members = list(v.members, "members", member)
  if (!members.length) throw new ReviewRequestError("validation", "A review request needs at least one frozen member")
  const ids = new Set<string>(), subjects = new Set<string>()
  for (const m of members) {
    const identity = canonical({ work_ref: m.work_ref, producing_attempt_refs: [...new Set(m.producing_attempt_refs)].sort(),
      artifact_refs: [...new Set(m.artifact_refs.map(a => canonical(a)))].sort(), prior_review_request_id: m.prior_review_request_id })
    if (ids.has(m.member_id) || subjects.has(identity)) throw new ReviewRequestError("validation", "Duplicate review member or subject selection")
    ids.add(m.member_id); subjects.add(identity)
  }
  return { format: "loom-review-request/v1", request_id: uid(v.request_id), requester: { session_id: uid(actor.session_id), agent: text(actor.agent, "requester agent", 200) },
    mandate: original, intended_recipient: { agent: text(recipient.agent, "intended recipient agent", 200),
      session_id: recipient.session_id === null ? null : uid(recipient.session_id) }, work_revision_policy: policy, members,
    rechecks: list(v.rechecks, "rechecks", raw => {
      const r = object(raw, "recheck"); fields(r, ["request_id", "finding_ids"])
      return { request_id: uid(r.request_id), finding_ids: list(r.finding_ids, "finding_ids", v => uid(v)) }
    }), ...(v.extensions === undefined ? {} : { extensions: object(v.extensions, "extensions") }) }
}
const encode = (value: unknown) => canonical(value, new ProcessingBudget(PROCESSING_LIMITS.recordChars))
function json(row: unknown): unknown {
  const v = object(row, "stored review row")
  if (typeof v.data !== "string" || v.data.length > PROCESSING_LIMITS.recordChars) throw new ProcessingLimitError("stored review exceeds read limit")
  return JSON.parse(v.data)
}
const guarded = `CASE WHEN typeof(data)='text' AND octet_length(data)<=${PROCESSING_LIMITS.recordChars * 3} THEN data END AS data`
const qualifier = { status: "unknown", reason: "unsupported-host-boundary" } as const
function relationshipBody(raw: unknown): Relationship {
  const v = object(raw, "relationship")
  const required = ["format", "request_id", "relationship", "source_record_id", "member_ids", "author", "source_producer", "relationship_attribution", "review_binding"]
  fields(v, [...required, "observed_source", "declared_verdict", "verdict_scope", "supersedes"], required)
  if (v.format !== "loom-review-relationship/v1") throw new ReviewRequestError("unsupported-version", "Unsupported review relationship version")
  if (!["observed", "retrieved", "cited", "claimed-inspected", "finding", "correction"].includes(String(v.relationship)))
    throw new ReviewRequestError("unsupported-version", "Unsupported review relationship meaning")
  if (canonical(v.review_binding) !== canonical(qualifier)) throw new ReviewRequestError("unsupported-version", "Unsupported native review binding; no attestation was inferred")
  const parseActor = (raw: unknown): Actor => { const a = object(raw, "actor"); fields(a, ["session_id", "agent"]); return { session_id: uid(a.session_id), agent: text(a.agent, "agent", 200) } }
  const expectedAttribution: Relationship["relationship_attribution"] = v.relationship === "retrieved"
    ? { status: "established", basis: "original-source-return" }
    : { status: "unknown", reason: "authored-association-unverified" }
  if (canonical(v.relationship_attribution) !== canonical(expectedAttribution)) throw new ReviewRequestError("unsupported-version", "Unsupported relationship attribution")
  const result: Relationship = { format: "loom-review-relationship/v1", request_id: uid(v.request_id), relationship: v.relationship as RelationshipKind,
    source_record_id: uid(v.source_record_id), member_ids: list(v.member_ids, "member_ids", v => uid(v)),
    author: parseActor(v.author), source_producer: parseActor(v.source_producer), relationship_attribution: expectedAttribution, review_binding: qualifier }
  if (v.observed_source !== undefined) {
    const source = object(v.observed_source, "observed_source")
    fields(source, ["locator", "sha256", "boundary", "coverage", "receiving_session_id", "message_id", "call_id", "authorization"])
    if (result.relationship !== "retrieved" || source.boundary !== "tool-return" || source.coverage !== "full"
      || typeof source.sha256 !== "string" || !/^[a-f0-9]{64}$/.test(source.sha256))
      throw new ReviewRequestError("unsupported-version", "Unsupported observed source-return meaning")
    result.observed_source = { locator: text(source.locator, "locator", 2000), sha256: source.sha256, boundary: source.boundary, coverage: source.coverage,
      receiving_session_id: uid(source.receiving_session_id), message_id: nullableText(source.message_id, "message_id"),
      call_id: nullableText(source.call_id, "call_id"), authorization: text(source.authorization, "authorization", 2000) }
  }
  if (v.declared_verdict !== undefined) {
    if (!["pass", "fail", "inconclusive"].includes(String(v.declared_verdict))) throw new ReviewRequestError("unsupported-version", "Unsupported declared verdict")
    result.declared_verdict = String(v.declared_verdict); result.verdict_scope = text(v.verdict_scope, "verdict_scope", 2000)
  } else if (v.verdict_scope !== undefined) throw new ReviewRequestError("unsupported-version", "Verdict scope without a declared verdict")
  if (v.supersedes !== undefined) result.supersedes = uid(v.supersedes)
  if ((result.relationship === "correction") !== (result.supersedes !== undefined)) throw new ReviewRequestError("unsupported-version", "Unsupported correction relationship")
  if ((result.relationship === "retrieved") !== (result.observed_source !== undefined)) throw new ReviewRequestError("unsupported-version", "Unsupported source return relationship")
  return result
}

/** Request persistence is part of Store's database, not another evidence store or dispatcher. */
export class ReviewRequests {
  readonly issues: ReviewIssues
  readonly storeID: string
  constructor(private store: Store, private db: SQL, existingSchema = false) {
    if (existingSchema) {
      for (const name of ["review_store_identity", "review_requests", "review_relationships", "review_issue_intents", "review_issue_outcomes"])
        if (!db.prepare("SELECT 1 FROM sqlite_schema WHERE type='table' AND name=?").get(name))
          throw new ReviewRequestError("history-unavailable", "Review persistence is incomplete; restore the complete Store before issuing work")
    }
    db.exec(`CREATE TABLE IF NOT EXISTS review_store_identity (singleton INTEGER PRIMARY KEY CHECK(singleton=1), store_id TEXT NOT NULL UNIQUE);
      CREATE TABLE IF NOT EXISTS review_requests (request_id TEXT PRIMARY KEY NOT NULL, requester_session TEXT NOT NULL, data TEXT NOT NULL, membership_data TEXT NOT NULL, created_at TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS review_requests_requester ON review_requests(requester_session,request_id);
      CREATE TABLE IF NOT EXISTS review_relationships (sequence INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT NOT NULL UNIQUE,
        request_id TEXT NOT NULL REFERENCES review_requests(request_id), data TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS review_relationships_request ON review_relationships(request_id,sequence);`)
    const identity = db.prepare("SELECT store_id FROM review_store_identity WHERE singleton=1").get() as { store_id: string } | undefined
    if (existingSchema && !identity) throw new ReviewRequestError("history-unavailable", "Review source-store identity is missing; no new identity was substituted")
    this.storeID = identity ? uid(identity.store_id) : randomUUID()
    if (!identity) db.prepare("INSERT INTO review_store_identity(singleton,store_id) VALUES(1,?)").run(this.storeID)
    this.issues = new ReviewIssues(db, { request: (actor, id) => this.getRequest(actor, id), checkFresh: request => this.checkFresh(request) })
  }
  private atomic<T>(write: boolean, fn: () => T): T {
    this.db.exec(write ? "BEGIN IMMEDIATE" : "BEGIN")
    try { const result = fn(); this.db.exec("COMMIT"); return result } catch (error) {
      // A lost acknowledgement after COMMIT is not permission to create anew.
      try { this.db.exec("ROLLBACK") } catch { /* Preserve the original failure. */ }
      throw error
    }
  }
  /** Internal read: caller owns snapshot/transaction; ownership never comes from tool input. */
  getRequest(actor: Actor, id: string): ReviewRequest {
    const requestID = uid(id)
    const row = this.db.prepare(`SELECT requester_session,${guarded} FROM review_requests WHERE request_id=?`).get(requestID) as { requester_session: string; data: string } | undefined
    // Unknown and denied identifiers have the same public error; no metadata oracle.
    if (!row || row.requester_session !== actor.session_id) throw new ReviewRequestError("not-authorized", "Review request is unavailable to this Session")
    const parsed = object(json(row), "stored request"), requester = object(parsed.requester, "stored requester")
    fields(requester, ["session_id", "agent"])
    if (requester.session_id !== row.requester_session) throw new ReviewRequestError("history-unavailable", "Review requester identity is inconsistent")
    const request = parseRequest({ session_id: row.requester_session, agent: text(requester.agent, "requester agent", 200) }, parsed, true)
    if (request.request_id !== requestID) throw new ReviewRequestError("history-unavailable", "Stored review request identity is inconsistent")
    this.frozenWork(request)
    return request
  }
  /** Internal original-source projection. Caller owns the read snapshot and native
   * source permission; the existing requester check is never bypassed. */
  evaluationSource(actor: Actor, requestID: string, relationshipID?: string): Record<string, unknown> {
    const request = this.getRequest(actor, requestID)
    if (relationshipID !== undefined) {
      const row = this.db.prepare(`SELECT id,sequence,${guarded} FROM review_relationships WHERE request_id=? AND id=?`)
        .get(requestID, relationshipID) as { id: string; sequence: number; data: string } | undefined
      if (!row) throw new ReviewRequestError("source-missing", "Review relationship unavailable")
      const parsed = relationshipBody(json(row))
      if (parsed.request_id !== requestID || parsed.member_ids.some(id => !request.members.some(member => member.member_id === id)))
        throw new ReviewRequestError("history-unavailable", "Relationship no longer identifies the frozen request membership")
      return { id: row.id, sequence: row.sequence, ...parsed }
    }
    const membership = this.frozenWork(request), histories = new Map<string, unknown>()
    for (const member of membership) {
      const ref = member.selection, key = `${ref.action_id}:${ref.action_revision}:${ref.plan_revision}`
      if (!histories.has(key)) histories.set(key, this.store.collaboration.resolveWork(ref))
    }
    return { request, frozen_work_membership: membership, historical_work: [...histories.values()] }
  }
  freeze(actor: Actor, raw: unknown) {
    return this.freezeRequest(actor, raw, false)
  }
  /** Trusted preparation owner only; no native tool exposes this producer. */
  freezeEvaluatorPreparation(actor: Actor, raw: unknown) {
    const value = object(raw, "evaluator preparation request"), extensions = object(value.extensions, "evaluator preparation classification")
    fields(extensions, ["classification", "evaluation_batch_id"])
    if (extensions.classification !== "evaluator-preparation" || typeof extensions.evaluation_batch_id !== "string")
      throw new ReviewRequestError("validation", "Invalid evaluator preparation classification")
    return this.freezeRequest(actor, raw, true)
  }
  private freezeRequest(actor: Actor, raw: unknown, evaluatorPreparation: boolean) {
    const request = parseRequest(actor, raw), encoded = encode(request)
    return this.atomic(true, () => {
      const existing = this.db.prepare(`SELECT requester_session,${guarded} FROM review_requests WHERE request_id=?`).get(request.request_id) as { requester_session: string; data: string } | undefined
      if (existing) {
        this.getRequest(actor, request.request_id)
        return { status: existing.data === encoded ? "existing" as const : "conflict" as const, request_id: request.request_id }
      }
      if (request.extensions?.classification === "evaluator-preparation" && !evaluatorPreparation)
        throw new ReviewRequestError("validation", "Evaluator preparation classification is reserved for its durable owner")
      const membership: FrozenWorkMembership[] = [], membershipBudget = new ProcessingBudget(PROCESSING_LIMITS.recordChars)
      for (const m of request.members) {
        if (m.work_ref) {
          const { action, plan } = this.store.collaboration.resolveWork(m.work_ref)
          // Only the selected node and its descendants are requested subjects.
          // Contextual ancestors/dependencies still contribute to each WorkRef,
          // but are not silently added as separately requested review subjects.
          const descendants = new Set([m.work_ref.node_id])
          for (let changed = true; changed;) {
            changed = false
            for (const node of plan.nodes) if (node.parent && descendants.has(node.parent) && !descendants.has(node.id)) {
              descendants.add(node.id); changed = true
            }
          }
          const constituents = plan.nodes.filter(node => descendants.has(node.id)).map(node => {
            const ref = node.id === m.work_ref?.node_id ? m.work_ref : workReference(action, plan, node.id)
            membershipBudget.take(canonical(ref).length)
            return ref
          })
          membership.push({ member_id: m.member_id, selection: m.work_ref, constituents })
        }
        if (m.prior_review_request_id) this.getRequest(actor, m.prior_review_request_id)
        for (const id of m.producing_attempt_refs) {
          const source = this.sourceRecord(actor, id, true)
          if (!source && !m.gaps.some(g => g.source_ref === id && ["source-missing", "history-unavailable", "not-authorized"].includes(g.reason)))
            throw new ReviewRequestError("source-missing", "Missing producing attempt requires an explicit source gap")
          if (source && source.kind !== "observation" && source.kind !== "completion")
            throw new ReviewRequestError("validation", "Producing attempts must reference an observed start or historical completion")
          if (source?.kind === "observation" && source.data.phase !== "started")
            throw new ReviewRequestError("validation", "Producing attempt reference must name the original start")
        }
      }
      for (const r of request.rechecks) {
        this.getRequest(actor, r.request_id)
        for (const findingID of r.finding_ids) {
          const row = this.db.prepare(`SELECT ${guarded} FROM review_relationships WHERE request_id=? AND id=?`).get(r.request_id, findingID)
          if (!row || !["finding", "correction"].includes(relationshipBody(json(row)).relationship))
            throw new ReviewRequestError("source-missing", "Recheck finding must identify an existing finding relationship in the original request")
        }
      }
      this.db.prepare("INSERT INTO review_requests(request_id,requester_session,data,membership_data,created_at) VALUES(?,?,?,?,?)")
        .run(request.request_id, actor.session_id, encoded,
          encode({ format: "loom-review-work-membership/v1", members: membership, sha256: digest(membership) }), new Date().toISOString())
      return { status: "created" as const, request_id: request.request_id }
    })
  }
  private checkFresh(request: ReviewIssueRequest) {
    const full = this.getRequest(request.requester, request.request_id)
    if (full.mandate.currentness !== "current-at-issue-claim") throw new ReviewRequestError("validation", "Currentness was not part of the original mandate")
    for (const m of full.members) if (m.work_ref) {
      const ref = m.work_ref, action = this.store.action(ref.action_id), plan = this.store.plan(ref.action_id)
      if (action.revision !== ref.action_revision || plan.revision !== ref.plan_revision) throw new ReviewRequestError("stale-scope", "Requested work no longer meets the original currentness condition")
      this.store.collaboration.resolveWork(ref)
    }
  }
  private frozenWork(request: ReviewRequest): FrozenWorkMembership[] {
    const row = this.db.prepare(`SELECT CASE WHEN typeof(membership_data)='text' AND octet_length(membership_data)<=${PROCESSING_LIMITS.recordChars * 3} THEN membership_data END AS data
      FROM review_requests WHERE request_id=?`).get(request.request_id)
    const envelope = object(json(row), "frozen work membership")
    fields(envelope, ["format", "members", "sha256"])
    if (envelope.format !== "loom-review-work-membership/v1") throw new ReviewRequestError("unsupported-version", "Unsupported frozen work membership version")
    // An integrity checksum, never a host receipt or proof against an editor
    // who can replace both the source-store bytes and their checksum.
    if (envelope.sha256 !== digest(envelope.members)) throw new ReviewRequestError("history-unavailable", "Frozen constituent membership integrity failed")
    const membership = list(envelope.members, "frozen work membership", value => {
      const v = object(value, "frozen work member"); fields(v, ["member_id", "selection", "constituents"])
      const memberID = uid(v.member_id), selection = work(v.selection)
      const selected = request.members.find(m => m.member_id === memberID)
      if (!selected?.work_ref || canonical(selection) !== canonical(selected.work_ref)) throw new ReviewRequestError("history-unavailable", "Frozen work selection is inconsistent")
      const constituents = list(v.constituents, "frozen constituents", work, 300)
      if (!constituents.length || !constituents.some(ref => canonical(ref) === canonical(selection))
        || new Set(constituents.map(ref => ref.node_id)).size !== constituents.length
        || constituents.some(ref => ref.action_id !== selection.action_id || ref.action_revision !== selection.action_revision || ref.plan_revision !== selection.plan_revision))
        throw new ReviewRequestError("history-unavailable", "Frozen constituent membership is incomplete or inconsistent")
      return { member_id: memberID, selection, constituents }
    })
    if (membership.length !== request.members.filter(m => m.work_ref).length || new Set(membership.map(m => m.member_id)).size !== membership.length)
      throw new ReviewRequestError("history-unavailable", "Frozen work membership is incomplete")
    return membership
  }
  prepareIssue(actor: Actor, id: string, input: unknown) { return this.issues.prepare(actor, id, input) }
  claimIssue(actor: Actor, key: IssueIntentKey, claimant: string) { return this.issues.claim(actor, key, claimant) }
  readIssue(actor: Actor, id: string, options: { authorization_ref?: string; after?: number; limit?: number } = {}) {
    const intent: IssueIntentKey = options.authorization_ref === undefined ? { request_id: id, kind: "initial" }
      : { request_id: id, kind: "retry", authorization_ref: options.authorization_ref }
    return this.issues.read(actor, intent, options.after, options.limit)
  }

  /** Metadata-only permission preflight. Owner identity remains the real caller;
   * reserved Evaluator preparation requests are excluded before any projection. */
  historySources(actor: Actor, selection: ReviewHistorySelection): ReviewHistorySources {
    return this.atomic(false, () => this.historySelection(actor, selection).sources)
  }

  historySnapshot(actor: Actor, selection: ReviewHistorySelection): ReviewHistorySnapshot {
    return this.atomic(false, () => {
      const selected = this.historySelection(actor, selection)
      const requests: ReviewHistorySnapshot["requests"] = selected.requests.map(row => {
        const request = this.getRequest(actor, row.request_id)
        if (request.extensions?.classification === "evaluator-preparation") throw new ReviewRequestError("not-authorized", "Review history source unavailable")
        const relationships = selected.relationships.filter(relation => relation.request_id === row.request_id).map(meta => {
          const stored = this.db.prepare(`SELECT ${guarded} FROM review_relationships WHERE id=? AND sequence=? AND request_id=?`)
            .get(meta.id, meta.sequence, row.request_id)
          const relation = relationshipBody(json(stored))
          if (relation.request_id !== row.request_id || relation.source_record_id !== meta.source_record_id
            || relation.author.session_id !== actor.session_id || relation.source_producer.session_id !== actor.session_id
            || relation.member_ids.some(id => !request.members.some(member => member.member_id === id)))
            throw new ReviewRequestError("history-unavailable", "Review history relationship identity is inconsistent")
          const actual = selected.ledger.get(relation.source_record_id)
          if (!actual || actual.session_id !== actor.session_id) throw new ReviewRequestError("not-authorized", "Review history source unavailable")
          return { ...relation, id: meta.id, sequence: meta.sequence, source_availability: "record-available" as const }
        })
        return { request, frozen_work_membership: this.frozenWork(request), relationships,
          qualification: { request: "frozen-authored-mandate" as const, native_review_binding: qualifier,
            rechecks: "requested-only; actual inspection and verification require their own evidence" as const,
            source_content: "references-only; original source permission required" as const } }
      })
      const gaps = [
        { code: "requester-owned-review-scope", detail: "Only the actual caller's applicable frozen review requests are projected. Inaccessible, reserved preparation or outside-scope manifests are not expanded. Their identifiers and counts are not disclosed." },
        { code: "review-source-scope", detail: "Review relationships require an available original in the selected scope and append boundary. Missing or outside sources are withheld; absence here does not establish complete observed review coverage." },
        { code: "review-request-is-not-inspection", detail: "Frozen membership and rechecks describe requested scope. Cited, claimed-inspected, finding and correction relationships retain their authored attribution; they do not establish whole-request inspection, native review binding, correction success or overall release acceptance." },
      ]
      return { ...selected.sources, requests, gaps, content_digest: historyHash({ requests, gaps }) }
    })
  }

  private historySelection(actor: Actor, selection: ReviewHistorySelection) {
    uid(actor.session_id)
    if (!selection || typeof selection !== "object" || Array.isArray(selection)
      || Object.keys(selection).some(key => !["action_id", "session_id", "record_ids", "through", "request_through", "relationship_through"].includes(key))
      || selection.action_id !== undefined && selection.session_id !== undefined
      || selection.action_id === undefined && selection.session_id === undefined && selection.record_ids === undefined)
      throw new ReviewRequestError("validation", "Review history needs an explicit source scope")
    for (const name of ["action_id", "session_id"] as const) if (selection[name] !== undefined) uid(selection[name])
    for (const name of ["through", "request_through", "relationship_through"] as const)
      if (selection[name] !== undefined && (!Number.isSafeInteger(selection[name]) || selection[name]! < 0)) throw new ReviewRequestError("validation", "Invalid review history boundary")
    if (selection.record_ids !== undefined && (!Array.isArray(selection.record_ids) || selection.record_ids.length > 10000
      || new Set(selection.record_ids).size !== selection.record_ids.length)) throw new ReviewRequestError("validation", "Invalid review history source selection")
    const recordIDs = selection.record_ids?.map(id => uid(id))
    const ledgerWhere = selection.action_id !== undefined ? "action_id=?" : selection.session_id !== undefined ? "session_id=?" : "1"
    const ledgerArgs = selection.action_id !== undefined ? [selection.action_id] : selection.session_id !== undefined ? [selection.session_id] : []
    const ledgerMax = this.db.prepare(`SELECT COALESCE(MAX(seq),0) AS n FROM ledger WHERE ${ledgerWhere}`).get(...ledgerArgs) as { n: number }
    const through = selection.through ?? ledgerMax.n
    if (through > ledgerMax.n) throw new ReviewRequestError("history-unavailable", "Review history ledger boundary unavailable")
    const ledger = new Map<string, ReviewHistoryLedgerRow>()
    const chunks = recordIDs === undefined ? [undefined] : Array.from({ length: Math.ceil(recordIDs.length / 500) }, (_, i) => recordIDs.slice(i * 500, i * 500 + 500))
    let ledgerBytes = 0
    for (const chunk of chunks) {
      const reserve = this.db.prepare(`SELECT COUNT(*) AS n,COALESCE(SUM(octet_length(data)),0) AS bytes,COALESCE(MAX(octet_length(data)),0) AS max_bytes
        FROM ledger WHERE ${ledgerWhere} AND seq<=?${chunk ? ` AND id IN (${chunk.map(() => "?").join(",")})` : ""}`)
        .get(...ledgerArgs, through, ...(chunk ?? [])) as { n: number; bytes: number; max_bytes: number }
      ledgerBytes += reserve.bytes
      if (ledger.size + reserve.n > HISTORY_LIMITS.ledger || ledgerBytes > 64 * 1024 * 1024 || reserve.max_bytes > 393216)
        throw new ProcessingLimitError("review history ledger source exceeds its bounded read")
      const workExpression = "CASE WHEN json_extract(data,'$.data.work_scope.status')='established' THEN json_extract(data,'$.data.work_scope.work_ref') WHEN kind IN ('completion','reopen') THEN json_extract(data,'$.data.work_ref') END"
      const rows = this.db.prepare(`SELECT id,seq,session_id,action_id,octet_length(data) AS data_bytes,
        CASE WHEN typeof(data)='text' AND octet_length(data)<=393216 AND json_valid(data)
          THEN CASE WHEN octet_length(${workExpression})<=2048 THEN ${workExpression} END END AS work_ref
        FROM ledger WHERE ${ledgerWhere} AND seq<=?${chunk ? ` AND id IN (${chunk.map(() => "?").join(",")})` : ""} ORDER BY seq LIMIT ?`)
        .all(...ledgerArgs, through, ...(chunk ?? []), HISTORY_LIMITS.ledger + 1) as ReviewHistoryLedgerRow[]
      for (const row of rows) ledger.set(row.id, row)
      if (ledger.size > HISTORY_LIMITS.ledger) throw new ProcessingLimitError("review history ledger membership exceeds its bounded read")
    }
    const workRefs = new Set<string>()
    for (const row of ledger.values()) {
      uid(row.id); uid(row.session_id)
      if (!Number.isSafeInteger(row.data_bytes) || row.data_bytes > 393216) throw new ProcessingLimitError("review history ledger source exceeds its byte bound")
      if (row.work_ref !== null) {
        try { workRefs.add(canonical(work(JSON.parse(row.work_ref)))) }
        catch { /* An unsupported historical binding cannot authorize a manifest. */ }
      }
    }
    // The classification is consulted inside the owner, before request labels,
    // mandates, counts or contributor metadata can enter this projection.
    const classification = "json_extract(CASE WHEN json_valid(data) AND octet_length(data)<=393216 THEN data ELSE '{}' END,'$.extensions.classification') IS NOT 'evaluator-preparation'"
    const selectedRecordIDs = JSON.stringify([...ledger.keys()])
    const workMatch = selection.action_id !== undefined ? "json_extract(m.value,'$.work_ref.action_id')=?"
      : "json_extract(m.value,'$.work_ref') IN (SELECT value FROM json_each(?))"
    const workMatchValue = selection.action_id ?? JSON.stringify([...workRefs])
    // Apply exact source/work membership before request bounds. Unrelated
    // caller-owned reviews do not consume this scope's budget or append fence.
    const requestJSON = "CASE WHEN json_valid(review_requests.data) AND octet_length(review_requests.data)<=393216 THEN review_requests.data ELSE '{}' END"
    const applicability = `(EXISTS (SELECT 1 FROM json_each(${requestJSON},'$.members') m
      WHERE ${workMatch} OR EXISTS (SELECT 1 FROM json_each(m.value,'$.producing_attempt_refs') p WHERE p.value IN (SELECT value FROM json_each(?))))
      OR EXISTS (SELECT 1 FROM review_relationships r WHERE r.request_id=review_requests.request_id
        AND (? IS NULL OR r.sequence<=?) AND json_extract(CASE WHEN json_valid(r.data) AND octet_length(r.data)<=393216 THEN r.data ELSE '{}' END,'$.source_record_id') IN (SELECT value FROM json_each(?)))
      OR EXISTS (SELECT 1 FROM json_each(${requestJSON},'$.rechecks') c,json_each(c.value,'$.finding_ids') f
        JOIN review_relationships r ON r.id=f.value AND r.request_id=json_extract(c.value,'$.request_id')
        JOIN review_requests prior ON prior.request_id=r.request_id
        WHERE prior.requester_session=review_requests.requester_session
          AND json_extract(CASE WHEN json_valid(prior.data) AND octet_length(prior.data)<=393216 THEN prior.data ELSE '{}' END,'$.extensions.classification') IS NOT 'evaluator-preparation'
          AND (? IS NULL OR prior.rowid<=?) AND (? IS NULL OR r.sequence<=?)
          AND json_extract(CASE WHEN json_valid(r.data) AND octet_length(r.data)<=393216 THEN r.data ELSE '{}' END,'$.source_record_id') IN (SELECT value FROM json_each(?))))`
    const applicabilityArgs = [workMatchValue, selectedRecordIDs, selection.relationship_through ?? null, selection.relationship_through ?? null, selectedRecordIDs,
      selection.request_through ?? null, selection.request_through ?? null, selection.relationship_through ?? null, selection.relationship_through ?? null, selectedRecordIDs]
    const requestMax = this.db.prepare(`SELECT COALESCE(MAX(rowid),0) AS n FROM review_requests WHERE requester_session=? AND ${classification} AND ${applicability}`)
      .get(actor.session_id, ...applicabilityArgs) as { n: number }
    const requestThrough = selection.request_through ?? requestMax.n
    if (requestThrough > requestMax.n) {
      // A valid owner fence can be reused by a narrower selection with fewer
      // members. Validate it against the same caller-owned nonprepared domain.
      const ownerMax = this.db.prepare(`SELECT COALESCE(MAX(rowid),0) AS n FROM review_requests WHERE requester_session=? AND ${classification}`).get(actor.session_id) as { n: number }
      if (requestThrough > ownerMax.n) throw new ReviewRequestError("history-unavailable", "Review history request boundary unavailable")
    }
    const registry = this.db.prepare(`SELECT rowid,request_id,octet_length(data) AS data_bytes,octet_length(membership_data) AS membership_bytes
      FROM review_requests WHERE requester_session=? AND rowid<=? AND ${classification} AND ${applicability} ORDER BY rowid LIMIT ?`)
      .all(actor.session_id, requestThrough, ...applicabilityArgs, HISTORY_LIMITS.requests + 1) as ReviewHistoryRequestRow[]
    if (registry.length > HISTORY_LIMITS.requests) throw new ProcessingLimitError("review history requester registry exceeds its bounded read")
    let bytes = 0
    for (const row of registry) {
      uid(row.request_id)
      if (!Number.isSafeInteger(row.data_bytes) || !Number.isSafeInteger(row.membership_bytes)
        || row.data_bytes > 393216 || row.membership_bytes > 393216 || (bytes += row.data_bytes + row.membership_bytes) > HISTORY_LIMITS.bytes)
        throw new ProcessingLimitError("review history manifest bytes exceed its bounded read")
    }
    const requestIDs = registry.map(row => row.request_id)
    const relationMax = requestIDs.length ? this.db.prepare(`SELECT COALESCE(MAX(sequence),0) AS n FROM review_relationships WHERE request_id IN (${requestIDs.map(() => "?").join(",")})`)
      .get(...requestIDs) as { n: number } : { n: 0 }
    const relationshipThrough = selection.relationship_through ?? relationMax.n
    if (relationshipThrough > relationMax.n) {
      const ownerMax = this.db.prepare(`SELECT COALESCE(MAX(sequence),0) AS n FROM review_relationships WHERE request_id IN
        (SELECT request_id FROM review_requests WHERE requester_session=? AND ${classification})`).get(actor.session_id) as { n: number }
      if (relationshipThrough > ownerMax.n) throw new ReviewRequestError("history-unavailable", "Review history relationship boundary unavailable")
    }
    const relationReserve = requestIDs.length ? this.db.prepare(`SELECT COUNT(*) AS n,COALESCE(SUM(octet_length(data)),0) AS bytes,COALESCE(MAX(octet_length(data)),0) AS max_bytes
      FROM review_relationships WHERE request_id IN (${requestIDs.map(() => "?").join(",")}) AND sequence<=?`).get(...requestIDs, relationshipThrough) as { n: number; bytes: number; max_bytes: number } : { n: 0, bytes: 0, max_bytes: 0 }
    if (relationReserve.n > HISTORY_LIMITS.relationships || relationReserve.max_bytes > 393216 || bytes + relationReserve.bytes > HISTORY_LIMITS.bytes)
      throw new ProcessingLimitError("review history relationship sources exceed its bounded read")
    const relationRows = requestIDs.length ? this.db.prepare(`SELECT id,sequence,request_id,octet_length(data) AS data_bytes,
      json_extract(data,'$.source_record_id') AS source_record_id,json_extract(data,'$.author.session_id') AS author_session,
      json_extract(data,'$.source_producer.session_id') AS source_session,json_extract(data,'$.supersedes') AS supersedes
      FROM review_relationships WHERE request_id IN (${requestIDs.map(() => "?").join(",")}) AND sequence<=? ORDER BY sequence`)
      .all(...requestIDs, relationshipThrough) as ReviewHistoryRelationshipRow[] : []
    const candidateRelations = relationRows.filter(row => {
      const source = ledger.get(row.source_record_id)
      if (!source || source.session_id !== actor.session_id) return false
      uid(row.id); uid(row.request_id); uid(row.source_record_id)
      if (row.author_session !== actor.session_id || row.source_session !== actor.session_id) throw new ReviewRequestError("history-unavailable", "Review history source ownership is inconsistent")
      if (row.supersedes !== null) uid(row.supersedes)
      return true
    })
    const candidates = new Map<string, { row: ReviewHistoryRequestRow; dependencies: string[]; attempts: string[]; member_metadata: unknown[];
      rechecks: Array<{ request_id: string; finding_ids: string[] }> }>()
    for (const row of registry) {
      // Read only typed membership identities here. Authored mandate text and
      // labels are not materialized until the contributor grants succeed.
      const members = this.db.prepare(`SELECT json_extract(m.value,'$.member_id') AS member_id,json_extract(m.value,'$.work_ref') AS work_ref,
        json_extract(m.value,'$.producing_attempt_refs') AS attempts,json_extract(m.value,'$.prior_review_request_id') AS prior
        FROM review_requests r,json_each(r.data,'$.members') m WHERE r.request_id=? AND r.requester_session=? LIMIT 101`)
        .all(row.request_id, actor.session_id) as { member_id: string; work_ref: string | null; attempts: string; prior: string | null }[]
      if (!members.length || members.length > 100) throw new ReviewRequestError("history-unavailable", "Review history membership is unavailable")
      let inScope = false, outside = false
      const dependencies: string[] = [], attempts: string[] = []
      for (const member of members) {
        uid(member.member_id)
        if (member.work_ref !== null) {
          const ref = work(JSON.parse(member.work_ref))
          const permitted = selection.action_id !== undefined ? ref.action_id === selection.action_id : workRefs.has(canonical(ref))
          if (!permitted) outside = true
          else inScope = true
        }
        const producing = list(JSON.parse(member.attempts), "historical producing attempts", value => uid(value))
        for (const id of producing) { if (ledger.get(id)?.session_id !== actor.session_id) outside = true; else { attempts.push(id); inScope = true } }
        if (member.prior !== null) dependencies.push(uid(member.prior))
      }
      const rechecks = this.db.prepare("SELECT json_extract(data,'$.rechecks') AS rechecks FROM review_requests WHERE request_id=? AND requester_session=?")
        .get(row.request_id, actor.session_id) as { rechecks: string }
      const parsedRechecks = list(JSON.parse(rechecks.rechecks), "historical rechecks", value => {
        const r = object(value, "historical recheck"); fields(r, ["request_id", "finding_ids"])
        const requestID = uid(r.request_id), findings = list(r.finding_ids, "historical recheck findings", value => uid(value))
        if (findings.some(id => !candidateRelations.some(relation => relation.id === id && relation.request_id === requestID))) outside = true
        else if (findings.length) inScope = true
        return { request_id: requestID, finding_ids: findings }
      })
      dependencies.push(...parsedRechecks.map(recheck => recheck.request_id))
      if (!outside && (inScope || candidateRelations.some(relation => relation.request_id === row.request_id)))
        candidates.set(row.request_id, { row, dependencies, attempts, member_metadata: members, rechecks: parsedRechecks })
    }
    // A raw immutable manifest is returned whole or omitted whole. Never turn
    // an out-of-scope mandate into a misleadingly complete filtered request.
    const retainedRelations = new Map(candidateRelations.map(row => [row.id, row]))
    for (let changed = true; changed;) {
      changed = false
      for (const [id, row] of retainedRelations) if (!candidates.has(row.request_id)
        || row.supersedes !== null && retainedRelations.get(row.supersedes)?.request_id !== row.request_id) {
        retainedRelations.delete(id); changed = true
      }
      for (const [id, candidate] of candidates) if (candidate.dependencies.some(dependency => !candidates.has(dependency))
        || candidate.rechecks.some(recheck => recheck.finding_ids.some(id => retainedRelations.get(id)?.request_id !== recheck.request_id))) {
        candidates.delete(id); changed = true
      }
    }
    const relationships = [...retainedRelations.values()]
    const used = new Set(relationships.map(row => row.source_record_id))
    for (const value of candidates.values()) for (const id of value.attempts) used.add(id)
    const contributors = new Set<string>()
    if (candidates.size) contributors.add(actor.session_id)
    for (const id of used) contributors.add(ledger.get(id)!.session_id)
    const requests = [...candidates.values()].map(value => value.row)
    const requestBoundary = selection.request_through ?? Math.max(0, ...requests.map(row => row.rowid))
    const relationBoundary = selection.relationship_through ?? Math.max(0, ...relationships.map(row => row.sequence))
    const sources: ReviewHistorySources = { contributors: [...contributors].sort(), ledger_record_ids: [...used].sort(), through,
      request_through: requestBoundary, relationship_through: relationBoundary,
      digest: historyHash({ store_id: this.storeID, through, request_through: requestBoundary, relationship_through: relationBoundary,
        requests: [...candidates.values()], relationships, records: [...used].sort().map(id => ledger.get(id)) }) }
    return { sources, requests, relationships, ledger }
  }

  read(actor: Actor, id: string, options: { after?: number; limit?: number; relationship_after?: number; issue_after?: number } = {}) {
    const after = options.after ?? 0, limit = options.limit ?? 20, relationshipAfter = options.relationship_after ?? 0, issueAfter = options.issue_after ?? 0
    if (!Number.isSafeInteger(after) || after < 0 || !Number.isSafeInteger(limit) || limit < 1 || limit > 50
      || !Number.isSafeInteger(relationshipAfter) || relationshipAfter < 0 || !Number.isSafeInteger(issueAfter) || issueAfter < 0)
      throw new ReviewRequestError("validation", "Invalid review page (limit 1-50)")
    return this.atomic(false, () => {
      const fullRequest = this.getRequest(actor, id), { members, ...request } = fullRequest
      const membership = this.frozenWork(fullRequest), selectedMembers = members.slice(after, after + limit)
      const rows = this.db.prepare(`SELECT id,sequence,${guarded} FROM review_relationships WHERE request_id=? AND sequence>? ORDER BY sequence LIMIT ?`).all(id, relationshipAfter, limit + 1)
      const relationships = rows.slice(0, limit).map(row => {
        const parsed = relationshipBody(json(row)), relation = row as { id: string; sequence: number }
        if (parsed.request_id !== id || parsed.member_ids.some(memberID => !members.some(m => m.member_id === memberID)))
          throw new ReviewRequestError("history-unavailable", "Relationship no longer identifies the frozen request membership")
        const source = this.sourceRecord(actor, parsed.source_record_id, true)
        return { id: relation.id, sequence: relation.sequence, ...parsed,
          source_availability: source ? "record-available" : "source-missing",
          source_record: source ?? null }
      })
      // Issue reads use the same transaction snapshot. They do not return a permit.
      const issues = this.issues.listSnapshot(actor, id, issueAfter, limit)
      const result = { request, members: selectedMembers, member_count: members.length,
        frozen_work_membership: membership.filter(m => selectedMembers.some(selected => selected.member_id === m.member_id)),
        artifact_availability: selectedMembers.flatMap(member => member.artifact_refs.map((ref, index) => ({ member_id: member.member_id, artifact_index: index,
          status: "unknown", reason: ref.content_ref === null ? "source-missing" : "not-observed",
          qualification: ref.content_ref === null ? "No retrievable content reference was supplied" : "Authored content reference; availability and source access have not been established" }))),
        next_after: after + limit < members.length ? after + limit : null,
        namespace: { store_id: this.storeID, project_id: null, workspace_id: null, directory: null },
        issues: issues.items, next_issue_after: issues.next_sequence,
        relationships, next_relationship_after: rows.length > limit ? (rows[limit - 1] as { sequence: number }).sequence : null,
        qualification: { request: "frozen-authored-mandate", membership: "frozen", native_review_binding: qualifier,
          protected_delivery: "withheld", source_content: "references-only; availability requires authorized source read",
          observations: "Original ledger receipts remain the source. A cited/claimed-inspected/finding link is its author's unverified interpretation, not an assertion by the source producer or proof of exact review execution." } }
      const serialized = canonical(result, new ProcessingBudget(RETRIEVAL_LIMITS.recordSetBytes))
      if (Buffer.byteLength(serialized, "utf8") > RETRIEVAL_LIMITS.recordSetBytes)
        throw new ProcessingLimitError("review reconstruction exceeds 4 MiB; use a smaller page")
      return result
    })
  }
  work(actor: Actor, id: string, memberID: string) {
    return this.atomic(false, () => {
      const request = this.getRequest(actor, id), selected = request.members.find(m => m.member_id === uid(memberID))
      if (!selected) throw new ReviewRequestError("not-found", "Unknown member in this review request")
      if (!selected.work_ref) return { status: "unknown", reason: "not-observed", work_ref: null }
      try { return { status: "established", work_ref: selected.work_ref, ...this.store.collaboration.resolveWork(selected.work_ref) } }
      catch (error) {
        if (error instanceof ProcessingLimitError) return { status: "unknown", reason: "processing-limit", work_ref: selected.work_ref }
        return { status: "unknown", reason: "history-unavailable", work_ref: selected.work_ref }
      }
    })
  }
  private sourceRecord(actor: Actor, id: string, optional = false): LedgerRecord | undefined {
    const row = this.db.prepare(`SELECT ${guarded} FROM ledger WHERE id=? AND session_id=?`).get(uid(id), actor.session_id)
    if (!row) {
      if (optional) return undefined
      throw new ReviewRequestError("not-authorized", "Source record is unavailable to this Session")
    }
    // Existing Store owns the LedgerRecord schema; no input can author observations.
    const source = json(row) as LedgerRecord
    if (source.id !== id || source.session_id !== actor.session_id) throw new ReviewRequestError("history-unavailable", "Source record identity is inconsistent")
    return source
  }
  relate(actor: Actor, id: string, raw: unknown) {
    canonical(raw, new ProcessingBudget(PROCESSING_LIMITS.recordChars))
    const input = object(raw, "relationship")
    fields(input, ["relationship", "source_record_id", "member_ids", "supersedes"], ["relationship", "source_record_id", "member_ids"])
    if (!["observed", "retrieved", "cited", "claimed-inspected", "finding", "correction"].includes(String(input.relationship)))
      throw new ReviewRequestError("validation", "Unsupported evidence relationship; supplied material needs a qualified native receipt")
    const memberIDs = list(input.member_ids, "member_ids", v => uid(v)), sourceID = uid(input.source_record_id)
    if (!memberIDs.length || new Set(memberIDs).size !== memberIDs.length) throw new ReviewRequestError("validation", "Select distinct requested member IDs")
    const relationship = String(input.relationship)
    if ((relationship === "correction") !== (input.supersedes !== undefined)) throw new ReviewRequestError("validation", "Only a correction names the original relationship it supersedes")
    return this.atomic(true, () => {
      const request = this.getRequest(actor, id), source = this.sourceRecord(actor, sourceID)
      if (!source) throw new ReviewRequestError("source-missing", "Source record unavailable")
      const selected = memberIDs.map(memberID => {
        const found = request.members.find(m => m.member_id === memberID)
        if (!found) throw new ReviewRequestError("validation", "Relationship selects a member outside the frozen request")
        return found
      })
      let observedSource: Record<string, unknown> | undefined
      if (relationship === "observed" || relationship === "retrieved") {
        if (source.kind !== "observation") throw new ReviewRequestError("validation", "Observed relationships require an original host observation")
        if (relationship === "retrieved") {
          // This is the already instrumented permission-checked source-return seam.
          // Generic tool completion/digests cannot prove source material retrieval.
          if (source.data.phase !== "companion-load-result" || source.data.source !== "successful-companion-tool-result"
            || typeof source.data.content_sha256 !== "string" || !/^[a-f0-9]{64}$/.test(source.data.content_sha256)
            || typeof source.data.skill_id !== "string" || !["assessment", "qa"].includes(String(source.data.lens)))
            throw new ReviewRequestError("unsupported-host-boundary", "This observation does not establish a qualified source return")
          const locator = `skill://${source.data.skill_id}/${source.data.lens === "qa" ? "QA.md" : "ASSESSMENT.md"}`
          if (selected.some(m => !m.artifact_refs.some(a => a.locator === locator && a.version.kind === "sha256" && a.version.value === source.data.content_sha256)))
            throw new ReviewRequestError("validation", "Source return does not match the requested exact artifact")
          observedSource = { locator, sha256: source.data.content_sha256, boundary: "tool-return", coverage: "full",
            receiving_session_id: source.session_id, message_id: source.data.message_id ?? null, call_id: source.data.call_id ?? null,
            authorization: "successful permission-checked source tool; no cross-recipient transfer authorized" }
        }
      } else if (!["assessment", "qa", "result", "concern"].includes(source.kind))
        throw new ReviewRequestError("validation", "Authored evidence relationships require an original result or finding")
      if (input.supersedes !== undefined && !this.db.prepare("SELECT 1 FROM review_relationships WHERE request_id=? AND id=?").get(id, uid(input.supersedes)))
        throw new ReviewRequestError("not-found", "Correction must preserve an existing relationship in this request")
      const body = { format: "loom-review-relationship/v1", request_id: id, relationship, source_record_id: sourceID,
        member_ids: memberIDs, author: { ...actor }, source_producer: { session_id: source.session_id, agent: source.agent },
        relationship_attribution: relationship === "retrieved" ? { status: "established", basis: "original-source-return" }
          : { status: "unknown", reason: "authored-association-unverified" },
        review_binding: qualifier, ...(observedSource ? { observed_source: observedSource } : {}),
        ...(typeof source.data.verdict === "string" ? { declared_verdict: source.data.verdict, verdict_scope: "authored; not proof of whole-request coverage" } : {}),
        ...(input.supersedes === undefined ? {} : { supersedes: uid(input.supersedes) }) }
      // Equivalent local relationship replay is harmless, but never native attestation.
      const relationID = digest(body), existing = this.db.prepare("SELECT 1 FROM review_relationships WHERE id=?").get(relationID)
      if (existing) return { status: "existing" as const, id: relationID }
      this.db.prepare("INSERT INTO review_relationships(id,request_id,data) VALUES(?,?,?)").run(relationID, id, encode(relationshipBody(body)))
      return { status: "created" as const, id: relationID }
    })
  }
}
