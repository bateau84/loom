import { randomUUID } from "node:crypto"
import { canonical, ProcessingBudget, uid, type Actor } from "./model.js"
import type { SQL } from "./store.js"

export type IssueIntentKey =
  | { request_id: string; kind: "initial" }
  | { request_id: string; kind: "retry"; authorization_ref: string }
export type RetryDecision = {
  canonical_ref: string
  request_id: string
  after_intent: IssueIntentKey
  allow_unresolved_prior: boolean
  authority_source: string
}
export type IssueIntentBody =
  | { intent: Extract<IssueIntentKey, { kind: "initial" }> }
  | { intent: Extract<IssueIntentKey, { kind: "retry" }>; after_intent: IssueIntentKey; decision: RetryDecision }
/** Trusted owner integration, never tool input. Decisions must already be durable.
 * The current production host supplies no qualified retry authority. */
export interface RetryAuthority {
  resolve(actor: Actor, reference: string): RetryDecision | undefined
  recheck(actor: Actor, decision: RetryDecision): boolean
}
export type ReviewIssueRequest = {
  request_id: string
  requester: Actor
  work_revision_policy: "frozen-historical" | "current-at-issue-claim"
}
type Owners = {
  request(actor: Actor, id: string): ReviewIssueRequest
  checkFresh(request: ReviewIssueRequest): void
}
type State = "prepared" | "claimed" | "issued" | "rejected" | "unknown"
type NativeOutcome = "not-issued" | "unknown" | "issued" | "proven-non-admission"
export type ReviewIssueOutcome = {
  status: "unknown" | "issued" | "proven-non-admission"
  source_ref: string
  reason: string
}
export type ReviewIssueAttempt = {
  attempt_id: string
  state: State
  claimant_id: string | null
  rejection_reason: string | null
  native_outcome: NativeOutcome
  created_at: string
  claimed_at: string | null
  updated_at: string
  native_binding: { status: "unknown"; reason: "native-causal-receipt-unavailable" }
}
type Entry = { intent: IssueIntentKey; attempt: ReviewIssueAttempt }
type Row = {
  sequence: number; intent_key: string; request_id: string; attempt_id: string
  intent_data: string; decision_ref: string | null; decision_data: string | null
  state: State; claimant_id: string | null; rejection_reason: string | null
  native_outcome: NativeOutcome; created_at: string; claimed_at: string | null; updated_at: string
}
export class ReviewIssueError extends Error {
  constructor(readonly code: string, message: string) { super(message); this.name = "ReviewIssueError" }
}
const encode = (value: unknown) => canonical(value, new ProcessingBudget(16384, 256))
const now = () => new Date().toISOString()
function object(value: unknown, allowed: string[]): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)
      || ![Object.prototype, null].includes(Object.getPrototypeOf(value)))
    throw new ReviewIssueError("invalid-input", "Expected a plain review issue object")
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key) || !Object.prototype.hasOwnProperty.call(Object.getOwnPropertyDescriptor(value, key), "value"))
      throw new ReviewIssueError("invalid-input", `Unsupported review issue field: ${key}`)
  }
  return value as Record<string, unknown>
}
function identifier(value: unknown, name: string): string {
  try { return uid(value, name) }
  catch { throw new ReviewIssueError("invalid-input", `${name} must be a simple identifier of 1-120 characters`) }
}
function reference(value: unknown, name: string): string {
  if (typeof value !== "string" || !value.trim() || value.length > 2000 || value !== value.trim())
    throw new ReviewIssueError("invalid-input", `${name} must be an exact nonempty reference of at most 2000 characters`)
  return value
}
function key(value: unknown): IssueIntentKey {
  const input = object(value, ["request_id", "kind", "authorization_ref"])
  const request_id = identifier(input.request_id, "request_id")
  if (input.kind === "initial" && !Object.hasOwn(input, "authorization_ref")) return { request_id, kind: "initial" }
  if (input.kind === "retry") return { request_id, kind: "retry", authorization_ref: reference(input.authorization_ref, "authorization_ref") }
  throw new ReviewIssueError("invalid-input", "Expected initial or retry issue intent key")
}
function decision(value: unknown): RetryDecision {
  const input = object(value, ["canonical_ref", "request_id", "after_intent", "allow_unresolved_prior", "authority_source"])
  if (typeof input.allow_unresolved_prior !== "boolean")
    throw new ReviewIssueError("retry-authority-invalid", "Retry decision must declare unresolved-prior authorization")
  return {
    canonical_ref: reference(input.canonical_ref, "canonical_ref"),
    request_id: identifier(input.request_id, "request_id"),
    after_intent: key(input.after_intent),
    allow_unresolved_prior: input.allow_unresolved_prior,
    authority_source: reference(input.authority_source, "authority_source"),
  }
}
function unresolved(row: Row): boolean {
  return row.native_outcome !== "proven-non-admission" && !(row.state === "rejected" && row.claimant_id === null)
}
function stored<T>(read: () => T): T {
  try { return read() }
  catch { throw new ReviewIssueError("invalid-stored-issue", "Stored review issue has corrupt or unsupported required meaning") }
}
function storedJSON(value: unknown): unknown {
  if (typeof value !== "string" || value.length > 16384) throw new Error("Unsupported stored JSON size")
  return JSON.parse(value) as unknown
}
function timestamp(value: unknown): string {
  if (typeof value !== "string" || value.length > 32 || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString() !== value)
    throw new Error("Unsupported stored timestamp")
  return value
}

/** Local issue arbitration inside the existing Store. No scheduling or native I/O.
 * Constructor runs inside Store's schema transaction; operations own their own
 * immediate transaction so distinct connections cannot prepare or claim twice. */
export class ReviewIssues {
  constructor(private db: SQL, private owners: Owners, private authority?: RetryAuthority) {
    db.exec(`CREATE TABLE IF NOT EXISTS review_issue_intents (
      sequence INTEGER PRIMARY KEY AUTOINCREMENT,
      intent_key TEXT NOT NULL UNIQUE,
      request_id TEXT NOT NULL REFERENCES review_requests(request_id),
      attempt_id TEXT NOT NULL UNIQUE,
      intent_data TEXT NOT NULL,
      decision_ref TEXT UNIQUE,
      decision_data TEXT,
      state TEXT NOT NULL CHECK(state IN ('prepared','claimed','issued','rejected','unknown')),
      claimant_id TEXT,
      rejection_reason TEXT,
      native_outcome TEXT NOT NULL CHECK(native_outcome IN ('not-issued','unknown','issued','proven-non-admission')),
      created_at TEXT NOT NULL,
      claimed_at TEXT,
      updated_at TEXT NOT NULL,
      CHECK((decision_ref IS NULL) = (decision_data IS NULL)),
      CHECK((claimant_id IS NULL) = (claimed_at IS NULL))
    );
    CREATE INDEX IF NOT EXISTS review_issue_request ON review_issue_intents(request_id,sequence);
    CREATE TABLE IF NOT EXISTS review_issue_outcomes (
      sequence INTEGER PRIMARY KEY AUTOINCREMENT,
      attempt_id TEXT NOT NULL REFERENCES review_issue_intents(attempt_id),
      status TEXT NOT NULL CHECK(status IN ('unknown','issued','proven-non-admission')),
      source_ref TEXT NOT NULL,
      reason TEXT NOT NULL,
      recorded_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS review_issue_outcome_attempt ON review_issue_outcomes(attempt_id,sequence);`)
  }
  private atomic<T>(write: boolean, run: () => T): T {
    this.db.exec(write ? "BEGIN IMMEDIATE" : "BEGIN")
    try { const result = run(); this.db.exec("COMMIT"); return result }
    catch (error) {
      // A driver can lose acknowledgement after COMMIT. Never mask that error
      // or reopen the already durable claim because ROLLBACK finds no transaction.
      try { this.db.exec("ROLLBACK") } catch { /* Preserve original failure. */ }
      throw error
    }
  }
  private row(intent: IssueIntentKey): Row | undefined {
    const row = this.db.prepare(`SELECT sequence,intent_key,
      CASE WHEN typeof(request_id)='text' AND octet_length(request_id)<=360 THEN request_id END AS request_id,
      CASE WHEN typeof(attempt_id)='text' AND octet_length(attempt_id)<=360 THEN attempt_id END AS attempt_id,
      CASE WHEN typeof(intent_data)='text' AND octet_length(intent_data)<=49152 THEN intent_data END AS intent_data,
      CASE WHEN decision_ref IS NULL THEN NULL WHEN typeof(decision_ref)='text' AND octet_length(decision_ref)<=6000 THEN decision_ref ELSE 0 END AS decision_ref,
      CASE WHEN decision_data IS NULL THEN NULL WHEN typeof(decision_data)='text' AND octet_length(decision_data)<=49152 THEN decision_data ELSE 0 END AS decision_data,
      CASE WHEN octet_length(state)<=60 THEN state END AS state,
      CASE WHEN claimant_id IS NULL THEN NULL WHEN typeof(claimant_id)='text' AND octet_length(claimant_id)<=360 THEN claimant_id ELSE 0 END AS claimant_id,
      CASE WHEN rejection_reason IS NULL THEN NULL WHEN typeof(rejection_reason)='text' AND octet_length(rejection_reason)<=6000 THEN rejection_reason ELSE 0 END AS rejection_reason,
      CASE WHEN octet_length(native_outcome)<=60 THEN native_outcome END AS native_outcome,
      CASE WHEN octet_length(created_at)<=32 THEN created_at END AS created_at,
      CASE WHEN claimed_at IS NULL THEN NULL WHEN typeof(claimed_at)='text' AND octet_length(claimed_at)<=32 THEN claimed_at ELSE 0 END AS claimed_at,
      CASE WHEN octet_length(updated_at)<=32 THEN updated_at END AS updated_at
      FROM review_issue_intents WHERE intent_key=?`).get(encode(intent)) as Row | undefined
    if (row && (typeof row.intent_data !== "string" || row.intent_data.length > 16384
        || (row.decision_ref !== null && (typeof row.decision_data !== "string" || row.decision_data.length > 16384))))
      throw new ReviewIssueError("invalid-stored-issue", "Stored review issue exceeds its supported read contract")
    if (row) this.entry(row)
    return row
  }
  private required(intent: IssueIntentKey): Row {
    const row = this.row(intent)
    if (!row) throw new ReviewIssueError("issue-not-found", "Unknown review issue intent")
    return row
  }
  private intentBody(row: Row): IssueIntentBody {
    return stored(() => {
      const intent = key(storedJSON(row.intent_key)), body = object(storedJSON(row.intent_data),
        intent.kind === "initial" ? ["intent"] : ["intent", "after_intent", "decision"])
      if (intent.request_id !== row.request_id || encode(key(body.intent)) !== encode(intent)) throw new Error("Intent identity mismatch")
      if (intent.kind === "initial") {
        if (row.decision_ref !== null || row.decision_data !== null) throw new Error("Initial intent contains retry authority")
        return { intent }
      }
      const after = key(body.after_intent), bound = decision(body.decision), saved = decision(storedJSON(row.decision_data))
      if (row.decision_ref !== intent.authorization_ref || bound.canonical_ref !== row.decision_ref
          || bound.request_id !== intent.request_id || after.request_id !== intent.request_id
          || encode(after) !== encode(bound.after_intent) || encode(after) === encode(intent)
          || encode(bound) !== encode(saved)) throw new Error("Retry authority or predecessor binding mismatch")
      return { intent, after_intent: after, decision: bound }
    })
  }
  private entry(row: Row): Entry {
    const { intent } = this.intentBody(row)
    return stored(() => {
      identifier(row.attempt_id, "attempt_id")
      if (!Number.isSafeInteger(row.sequence) || row.sequence < 1
          || !["prepared", "claimed", "issued", "rejected", "unknown"].includes(row.state)
          || !["not-issued", "unknown", "issued", "proven-non-admission"].includes(row.native_outcome)
          || (row.claimant_id === null) !== (row.claimed_at === null)) throw new Error("Unsupported issue state")
      if (row.claimant_id !== null) { identifier(row.claimant_id, "claimant_id"); timestamp(row.claimed_at) }
      timestamp(row.created_at); timestamp(row.updated_at)
      const expectedNative = row.state === "prepared" ? "not-issued" : row.state === "issued" ? "issued"
        : row.state === "rejected" ? row.claimant_id === null ? "not-issued" : "proven-non-admission" : "unknown"
      if (row.native_outcome !== expectedNative || (row.state === "prepared" && row.claimant_id !== null)
          || (["claimed", "issued", "unknown"].includes(row.state) && row.claimant_id === null)
          || (row.state === "rejected") !== (row.rejection_reason !== null)) throw new Error("Inconsistent issue projection")
      if (row.rejection_reason !== null) reference(row.rejection_reason, "rejection_reason")
      return { intent, attempt: {
      attempt_id: row.attempt_id, state: row.state, claimant_id: row.claimant_id,
      rejection_reason: row.rejection_reason, native_outcome: row.native_outcome,
      created_at: row.created_at, claimed_at: row.claimed_at, updated_at: row.updated_at,
      native_binding: { status: "unknown", reason: "native-causal-receipt-unavailable" },
      } }
    })
  }
  private resolve(actor: Actor, authorizationRef: string): RetryDecision {
    if (!this.authority) throw new ReviewIssueError("retry-authority-unavailable", "No qualified durable retry authorization owner is connected")
    const resolved = this.authority.resolve(actor, authorizationRef)
    if (!resolved) throw new ReviewIssueError("retry-not-authorized", "Retry authorization decision is unavailable")
    const parsed = decision(resolved)
    if (authorizationRef !== parsed.canonical_ref) {
      const canonical = this.authority.resolve(actor, parsed.canonical_ref)
      if (!canonical || encode(decision(canonical)) !== encode(parsed))
        throw new ReviewIssueError("conflict", "Retry alias does not resolve to the same canonical durable decision")
    }
    return parsed
  }
  prepare(actor: Actor, requestID: string, rawIntent: unknown): Entry & { status: "created" | "existing" } {
    const request_id = identifier(requestID, "request_id")
    const input = object(rawIntent, ["kind", "after_intent", "authorization_ref"])
    let after: IssueIntentKey | undefined, authorizationRef: string | undefined
    if (input.kind === "initial") {
      if (Object.keys(input).length !== 1) throw new ReviewIssueError("invalid-input", "Initial issue accepts only kind")
    } else if (input.kind === "retry") {
      after = key(input.after_intent); authorizationRef = reference(input.authorization_ref, "authorization_ref")
      if (after.request_id !== request_id) throw new ReviewIssueError("conflict", "Retry predecessor belongs to another request")
    } else throw new ReviewIssueError("invalid-input", "Expected an initial or retry intent")
    return this.atomic(true, () => {
      this.owners.request(actor, request_id)
      const resolved = authorizationRef === undefined ? undefined : this.resolve(actor, authorizationRef)
      if (resolved && (resolved.request_id !== request_id || encode(resolved.after_intent) !== encode(after)))
        throw new ReviewIssueError("conflict", "Retry decision does not authorize this request and predecessor")
      const intent: IssueIntentKey = resolved ? { request_id, kind: "retry", authorization_ref: resolved.canonical_ref }
        : { request_id, kind: "initial" }
      const body = resolved ? { intent, after_intent: after, decision: resolved } : { intent }
      const encoded = encode(body), previous = this.row(intent)
      if (previous) {
        if (previous.intent_data !== encoded) throw new ReviewIssueError("conflict", "Canonical issue intent is already bound to a different immutable body")
        return { status: "existing", ...this.entry(previous) }
      }
      if (resolved) {
        const bound = this.db.prepare("SELECT intent_key FROM review_issue_intents WHERE decision_ref=?").get(resolved.canonical_ref)
        if (bound) throw new ReviewIssueError("conflict", "Retry decision is already bound to another issue intent")
        const prior = this.required(resolved.after_intent)
        if (this.authority?.recheck(actor, resolved) !== true) throw new ReviewIssueError("retry-not-authorized", "Retry authorization is no longer valid")
        if (unresolved(prior) && !resolved.allow_unresolved_prior)
          throw new ReviewIssueError("unresolved-prior-issue", "Retry decision does not authorize an additional issue despite unresolved prior execution")
      }
      const at = now(), attempt = randomUUID()
      this.db.prepare(`INSERT INTO review_issue_intents(intent_key,request_id,attempt_id,intent_data,
        decision_ref,decision_data,state,claimant_id,rejection_reason,native_outcome,created_at,claimed_at,updated_at)
        VALUES(?,?,?,?,?,?,'prepared',NULL,NULL,'not-issued',?,NULL,?)`)
        .run(encode(intent), request_id, attempt, encoded, resolved?.canonical_ref ?? null,
          resolved ? encode(resolved) : null, at, at)
      return { status: "created", ...this.entry(this.required(intent)) }
    })
  }
  claim(actor: Actor, rawKey: unknown, claimantID: string): Entry & { status: "claimed-now" | "existing-state" | "rejected" } {
    const intent = key(rawKey), claimant = identifier(claimantID, "claimant_id")
    return this.atomic(true, () => {
      const request = this.owners.request(actor, intent.request_id), row = this.required(intent)
      if (row.state !== "prepared") return { status: "existing-state", ...this.entry(row) }
      let rejection: string | undefined
      if (intent.kind === "retry") {
        const saved = decision(JSON.parse(row.decision_data as string))
        try {
          const live = this.resolve(actor, intent.authorization_ref)
          if (encode(live) !== encode(saved)) rejection = "retry-authority-changed"
          else if (this.authority?.recheck(actor, live) !== true) rejection = "retry-authority-revoked"
          else if (unresolved(this.required(live.after_intent)) && !live.allow_unresolved_prior) rejection = "unresolved-prior-issue"
        } catch (error) {
          if (error instanceof ReviewIssueError && ["retry-authority-unavailable", "retry-not-authorized"].includes(error.code)) rejection = error.code
          else throw error
        }
      }
      if (!rejection && request.work_revision_policy === "current-at-issue-claim") {
        try { this.owners.checkFresh(request) }
        catch (error) {
          // Only the owner can classify a failed precondition. Storage/lookup
          // failures abort without manufacturing a stable rejection reason.
          if (error instanceof Error && "code" in error && typeof error.code === "string"
              && ["stale-scope", "not-authorized", "source-missing", "history-unavailable", "unsupported-version", "processing-limit"].includes(error.code)) rejection = error.code
          else throw error
        }
      }
      const at = now()
      if (rejection) this.db.prepare("UPDATE review_issue_intents SET state='rejected',rejection_reason=?,updated_at=? WHERE intent_key=?")
        .run(rejection, at, encode(intent))
      else this.db.prepare(`UPDATE review_issue_intents SET state='claimed',claimant_id=?,claimed_at=?,
        native_outcome='unknown',updated_at=? WHERE intent_key=?`).run(claimant, at, at, encode(intent))
      return { status: rejection ? "rejected" : "claimed-now", ...this.entry(this.required(intent)) }
    })
  }
  /** Host-only observation boundary. Native tool arguments cannot invoke this.
   * The durable claimant must match, and observations never grant issue permits. */
  recordOutcome(rawKey: unknown, claimantID: string, rawOutcome: unknown): Entry {
    const intent = key(rawKey), claimant = identifier(claimantID, "claimant_id")
    const input = object(rawOutcome, ["status", "source_ref", "reason"])
    if (!["unknown", "issued", "proven-non-admission"].includes(String(input.status)))
      throw new ReviewIssueError("invalid-input", "Unsupported native issue outcome")
    const status = input.status as ReviewIssueOutcome["status"]
    const source = reference(input.source_ref, "source_ref"), reason = reference(input.reason, "reason")
    return this.atomic(true, () => {
      const row = this.required(intent)
      if (row.claimant_id !== claimant || row.claimed_at === null)
        throw new ReviewIssueError("claim-owner-mismatch", "Only this intent's durable issuing owner may record its native outcome")
      const at = now()
      this.db.prepare("INSERT INTO review_issue_outcomes(attempt_id,status,source_ref,reason,recorded_at) VALUES(?,?,?,?,?)")
        .run(row.attempt_id, status, source, reason, at)
      const seen = this.db.prepare("SELECT DISTINCT status FROM review_issue_outcomes WHERE attempt_id=?").all(row.attempt_id) as Array<{ status: string }>
      const issued = seen.some(item => item.status === "issued"), rejected = seen.some(item => item.status === "proven-non-admission")
      // Issuance means the call started, not that native execution was admitted.
      // A trusted rejection can therefore refine an earlier issued/unknown fact.
      const native: NativeOutcome = rejected ? "proven-non-admission" : issued ? "issued" : "unknown"
      const state: State = native === "proven-non-admission" ? "rejected" : native === "issued" ? "issued" : "unknown"
      this.db.prepare("UPDATE review_issue_intents SET state=?,native_outcome=?,rejection_reason=?,updated_at=? WHERE intent_key=?")
        .run(state, native, native === "proven-non-admission" ? "proven-non-admission" : null, at, encode(intent))
      return this.entry(this.required(intent))
    })
  }
  read(actor: Actor, rawKey: unknown, after = 0, limit = 50) {
    const intent = key(rawKey)
    this.page(after, limit)
    return this.atomic(false, () => {
      this.owners.request(actor, intent.request_id)
      const row = this.required(intent)
      const observations = this.db.prepare(`SELECT sequence,
        CASE WHEN octet_length(status)<=60 THEN status END AS status,
        CASE WHEN typeof(source_ref)='text' AND octet_length(source_ref)<=6000 THEN source_ref END AS source_ref,
        CASE WHEN typeof(reason)='text' AND octet_length(reason)<=6000 THEN reason END AS reason,
        CASE WHEN octet_length(recorded_at)<=32 THEN recorded_at END AS recorded_at FROM review_issue_outcomes
        WHERE attempt_id=? AND sequence>? ORDER BY sequence LIMIT ?`).all(row.attempt_id, after, limit + 1) as Array<ReviewIssueOutcome & { sequence: number; recorded_at: string }>
      const outcomes = observations.slice(0, limit).map(value => stored(() => {
        if (!Number.isSafeInteger(value.sequence) || value.sequence < 1 || !["unknown", "issued", "proven-non-admission"].includes(value.status))
          throw new Error("Unsupported native outcome observation")
        return { sequence: value.sequence, status: value.status, source_ref: reference(value.source_ref, "source_ref"),
          reason: reference(value.reason, "reason"), recorded_at: timestamp(value.recorded_at) }
      }))
      return { ...this.entry(row), intent_body: this.intentBody(row), outcomes,
        next_outcome_sequence: observations.length > limit ? outcomes.at(-1)?.sequence ?? null : null }
    })
  }
  list(actor: Actor, requestID: string, after = 0, limit = 50) {
    return this.atomic(false, () => this.listSnapshot(actor, requestID, after, limit))
  }
  /** Existing Store reader owns the surrounding snapshot transaction. */
  listSnapshot(actor: Actor, requestID: string, after = 0, limit = 50) {
    const request_id = identifier(requestID, "request_id")
    this.page(after, limit)
    this.owners.request(actor, request_id)
    const rows = this.db.prepare(`SELECT sequence,
      CASE WHEN typeof(intent_key)='text' AND octet_length(intent_key)<=49152 THEN intent_key END AS intent_key FROM review_issue_intents
      WHERE request_id=? AND sequence>? ORDER BY sequence LIMIT ?`).all(request_id, after, limit + 1) as Array<{ sequence: number; intent_key: string }>
    const selected = rows.slice(0, limit)
    return { items: selected.map(row => this.entry(this.required(stored(() => key(storedJSON(row.intent_key)))))),
      next_sequence: rows.length > limit ? selected.at(-1)?.sequence ?? null : null }
  }
  private page(after: number, limit: number): void {
    if (!Number.isSafeInteger(after) || after < 0 || !Number.isSafeInteger(limit) || limit < 1 || limit > 50)
      throw new ReviewIssueError("invalid-input", "Issue page requires nonnegative sequence and limit 1-50")
  }
}
