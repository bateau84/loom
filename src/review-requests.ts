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
  freeze(actor: Actor, raw: unknown) {
    const request = parseRequest(actor, raw), encoded = encode(request)
    return this.atomic(true, () => {
      const existing = this.db.prepare(`SELECT requester_session,${guarded} FROM review_requests WHERE request_id=?`).get(request.request_id) as { requester_session: string; data: string } | undefined
      if (existing) {
        this.getRequest(actor, request.request_id)
        return { status: existing.data === encoded ? "existing" as const : "conflict" as const, request_id: request.request_id }
      }
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
