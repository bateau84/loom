import { randomUUID } from "node:crypto"
import { canonical, digest, ProcessingBudget } from "./model.js"
import type { SQL } from "./store.js"

export type EvaluationSourceRef = { kind: string; id: string; session_id?: string; revision?: string; sha256?: string; required: boolean }
export type EvaluationMember = { key: string; kind: "session" | "objective"; source_refs: EvaluationSourceRef[] }
export type EvaluationMethod = { id: string; instruction_sha256: string }
export type EvaluationFreeze = {
  owner_session: string; scope_key: string; source_store_id: string;
  boundary: Record<string, number | string>; method: EvaluationMethod;
  members: EvaluationMember[]; previous_batch_id?: string;
}
export type EvaluationClaim = { batch_id: string; token: string; worker_id: string }
export type EvaluationReportInput = { body: unknown; dependencies: EvaluationSourceRef[]; qualifications: string[] }
export type EvaluationOpportunity = { session_id: string; state: "pending" | "blocked" | "idle"; reason: string | null; generation: number; updated_at: string }
type BatchRow = {
  sequence: number; id: string; identity: string; owner_session: string; scope_key: string; source_store_id: string;
  boundary_json: string; method_json: string; membership_sha256: string; revision: number; previous_batch_id: string | null;
  state: "pending" | "processing" | "blocked" | "complete"; blocked_reason: string | null;
  claim_token: string | null; worker_id: string | null; lease_until_ms: number | null;
  created_at: string; updated_at: string; report_id: string | null;
}
type MemberRow = { batch_id: string; key: string; ordinal: number; kind: "session" | "objective"; source_refs: string; report_id: string | null }
type ReportRow = { id: string; batch_id: string; member_key: string | null; slot: string; created_at: string; body_json: string; qualifications_json: string; sha256: string }
export type EvaluationReport = {
  id: string; batch_id: string; member_key: string | null; created_at: string; sha256: string; body: unknown;
  qualifications: string[]; source_refs: EvaluationSourceRef[]; availability: "available" | "source-unavailable";
  missing_sources: EvaluationSourceRef[];
}
export type EvaluationBatch = {
  id: string; sequence: number; owner_session: string; scope_key: string; source_store_id: string;
  boundary: Record<string, number | string>; method: EvaluationMethod; membership_sha256: string; revision: number;
  previous_batch_id: string | null; state: BatchRow["state"] | "stale" | "incomplete"; published_state: BatchRow["state"];
  blocked_reason: string | null; member_count: number; processed_count: number; report_id: string | null;
  created_at: string; updated_at: string;
  invalidations: Array<{ source_key: string; reason: string; recorded_at: string }>;
}
export type EvaluationClaimResult = { status: "claimed"; claim: EvaluationClaim } | { status: "busy"; lease_until_ms: number } | { status: "complete" }

const prefix = "learning_evaluation_"
export const EVALUATION_COLUMNS = {
  schema: ["singleton", "version"],
  batches: ["sequence", "id", "identity", "owner_session", "scope_key", "source_store_id", "boundary_json", "method_json", "membership_sha256", "revision", "previous_batch_id", "state", "blocked_reason", "claim_token", "worker_id", "lease_until_ms", "created_at", "updated_at", "report_id"],
  members: ["batch_id", "key", "ordinal", "kind", "source_refs", "report_id"],
  reports: ["id", "batch_id", "member_key", "slot", "created_at", "body_json", "qualifications_json", "sha256"],
  dependencies: ["report_id", "source_key", "source_ref"],
  invalidations: ["sequence", "batch_id", "source_key", "reason", "recorded_at"],
  opportunities: ["session_id", "state", "reason", "generation", "updated_at"],
} as const
const text = (value: unknown, label: string, max = 500): string => {
  if (typeof value !== "string" || !value.trim() || value.length > max || /[\u0000-\u001f]/.test(value)) throw new Error(`Invalid evaluation ${label}`)
  return value
}
const integer = (value: unknown, label: string, minimum = 0, maximum = Number.MAX_SAFE_INTEGER): number => {
  if (!Number.isSafeInteger(value) || (value as number) < minimum || (value as number) > maximum) throw new Error(`Invalid evaluation ${label}`)
  return value as number
}
const hash = (value: unknown): string => {
  if (typeof value !== "string" || !/^[a-f0-9]{64}$/.test(value)) throw new Error("Invalid evaluation fingerprint")
  return value
}
const budget = () => new ProcessingBudget(33554432, 2000000)
const encoded = (value: unknown) => canonical(value, budget())
const fingerprint = (value: unknown) => digest(value, budget())
const sourceKey = (ref: EvaluationSourceRef) => fingerprint({ kind: ref.kind, id: ref.id, session_id: ref.session_id, revision: ref.revision, sha256: ref.sha256 })
const refs = (input: EvaluationSourceRef[]): EvaluationSourceRef[] => {
  if (!Array.isArray(input) || input.length > 100000) throw new Error("Invalid evaluation source population")
  const found = new Map<string, EvaluationSourceRef>()
  for (const value of input) {
    if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).some(k => !["kind", "id", "session_id", "revision", "sha256", "required"].includes(k)) || typeof value.required !== "boolean") throw new Error("Invalid evaluation source")
    const ref: EvaluationSourceRef = { kind: text(value.kind, "source kind", 100), id: text(value.id, "source ID", 1000), required: value.required }
    if (value.session_id !== undefined) ref.session_id = text(value.session_id, "source Session", 200)
    if (value.revision !== undefined) ref.revision = text(value.revision, "source revision", 200)
    if (value.sha256 !== undefined) ref.sha256 = hash(value.sha256)
    const key = sourceKey(ref), previous = found.get(key)
    found.set(key, { ...ref, required: ref.required || previous?.required === true })
  }
  return [...found].sort(([a], [b]) => a.localeCompare(b)).map(([, ref]) => ref)
}

/** Derived reports share the existing learning database. This is not a native permission authority. */
export class EvaluationStore {
  constructor(private readonly db: SQL, private readonly validateSource: (ref: EvaluationSourceRef, sourceStoreID: string) => boolean, private readonly clock: () => number = Date.now) {
    db.exec("PRAGMA busy_timeout=2000; PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON")
    this.transaction(() => {
      const existing = db.prepare("SELECT name FROM sqlite_schema WHERE type='table' AND name LIKE 'learning_evaluation_%'").all() as Array<{ name: string }>
      if (existing.length) {
        if (!existing.some(row => row.name === prefix + "schema")) throw new Error("Incomplete evaluation schema")
        const marker = db.prepare("SELECT version FROM learning_evaluation_schema WHERE singleton=1").get() as { version: number } | undefined
        if (marker?.version !== 1) throw new Error("Unsupported evaluation schema")
        for (const [name, required] of Object.entries(EVALUATION_COLUMNS)) {
          const columns = db.prepare(`PRAGMA table_info(${prefix}${name})`).all() as Array<{ name: string }>
          if (required.some(column => !columns.some(actual => actual.name === column))) throw new Error(`Incomplete evaluation schema: ${name}`)
        }
        return
      }
      db.exec(`
        CREATE TABLE learning_evaluation_schema(singleton INTEGER PRIMARY KEY CHECK(singleton=1), version INTEGER NOT NULL CHECK(version=1));
        CREATE TABLE learning_evaluation_batches(
          sequence INTEGER PRIMARY KEY, id TEXT NOT NULL UNIQUE, identity TEXT NOT NULL UNIQUE,
          owner_session TEXT NOT NULL, scope_key TEXT NOT NULL, source_store_id TEXT NOT NULL,
          boundary_json TEXT NOT NULL, method_json TEXT NOT NULL, membership_sha256 TEXT NOT NULL,
          revision INTEGER NOT NULL CHECK(revision>0), previous_batch_id TEXT REFERENCES learning_evaluation_batches(id),
          state TEXT NOT NULL CHECK(state IN ('pending','processing','blocked','complete')), blocked_reason TEXT,
          claim_token TEXT, worker_id TEXT, lease_until_ms INTEGER, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
          report_id TEXT REFERENCES learning_evaluation_reports(id), UNIQUE(owner_session,scope_key,revision));
        CREATE INDEX learning_evaluation_owner ON learning_evaluation_batches(owner_session,scope_key,sequence);
        CREATE TABLE learning_evaluation_members(
          batch_id TEXT NOT NULL REFERENCES learning_evaluation_batches(id), key TEXT NOT NULL, ordinal INTEGER NOT NULL CHECK(ordinal>0),
          kind TEXT NOT NULL CHECK(kind IN ('session','objective')), source_refs TEXT NOT NULL,
          report_id TEXT REFERENCES learning_evaluation_reports(id), PRIMARY KEY(batch_id,key), UNIQUE(batch_id,ordinal));
        CREATE TABLE learning_evaluation_reports(
          id TEXT PRIMARY KEY NOT NULL, batch_id TEXT NOT NULL REFERENCES learning_evaluation_batches(id), member_key TEXT,
          slot TEXT NOT NULL, created_at TEXT NOT NULL, body_json TEXT NOT NULL, qualifications_json TEXT NOT NULL, sha256 TEXT NOT NULL,
          UNIQUE(batch_id,slot));
        CREATE TABLE learning_evaluation_dependencies(
          report_id TEXT NOT NULL REFERENCES learning_evaluation_reports(id), source_key TEXT NOT NULL, source_ref TEXT NOT NULL,
          PRIMARY KEY(report_id,source_key));
        CREATE INDEX learning_evaluation_source ON learning_evaluation_dependencies(source_key,report_id);
        CREATE TABLE learning_evaluation_invalidations(
          sequence INTEGER PRIMARY KEY, batch_id TEXT NOT NULL REFERENCES learning_evaluation_batches(id), source_key TEXT NOT NULL,
          reason TEXT NOT NULL, recorded_at TEXT NOT NULL, UNIQUE(batch_id,source_key,reason));
        CREATE TABLE learning_evaluation_opportunities(
          session_id TEXT PRIMARY KEY NOT NULL, state TEXT NOT NULL CHECK(state IN ('pending','blocked','idle')),
          reason TEXT, generation INTEGER NOT NULL CHECK(generation>0), updated_at TEXT NOT NULL);
        INSERT INTO learning_evaluation_schema VALUES(1,1);
      `)
    })
  }

  private transaction<T>(run: () => T): T {
    this.db.exec("BEGIN IMMEDIATE")
    try { const result = run(); this.db.exec("COMMIT"); return result }
    catch (error) { try { this.db.exec("ROLLBACK") } catch { /* A lost COMMIT acknowledgement may follow a durable commit. */ } throw error }
  }
  private row(id: string, owner?: string): BatchRow {
    const row = this.db.prepare("SELECT * FROM learning_evaluation_batches WHERE id=?").get(text(id, "batch ID", 200)) as BatchRow | undefined
    if (!row || (owner !== undefined && row.owner_session !== owner)) throw new Error("Evaluation unavailable")
    return row
  }
  private originals(batch: BatchRow, sources: EvaluationSourceRef[]): EvaluationSourceRef[] {
    return sources.filter(ref => {
      if (!ref.required) return false
      try { return !this.validateSource(ref, batch.source_store_id) } catch { return true }
    })
  }
  private memberRows(id: string): MemberRow[] {
    return this.db.prepare("SELECT * FROM learning_evaluation_members WHERE batch_id=? ORDER BY ordinal").all(id) as MemberRow[]
  }
  private verifyMembership(batch: BatchRow): MemberRow[] {
    const rows = this.memberRows(batch.id)
    const members = rows.map(row => ({ key: row.key, kind: row.kind, source_refs: refs(JSON.parse(row.source_refs)) }))
    if (fingerprint(members) !== batch.membership_sha256) throw new Error("Evaluation frozen membership is incomplete")
    return rows
  }
  private claimed(claim: EvaluationClaim, at = this.clock()): BatchRow {
    integer(at, "clock")
    const batch = this.row(claim.batch_id)
    if (batch.state !== "processing" || batch.claim_token !== claim.token || batch.worker_id !== claim.worker_id || (batch.lease_until_ms ?? 0) <= at) throw new Error("Evaluation claim expired or replaced")
    return batch
  }

  noteOpportunity(sessionID: string, reason: string): void {
    this.db.prepare("INSERT INTO learning_evaluation_opportunities VALUES(?,'pending',?,1,?) ON CONFLICT(session_id) DO UPDATE SET state='pending',reason=excluded.reason,generation=generation+1,updated_at=excluded.updated_at")
      .run(text(sessionID, "Session", 200), text(reason, "opportunity reason"), new Date(this.clock()).toISOString())
  }
  opportunity(sessionID: string): EvaluationOpportunity | null {
    return (this.db.prepare("SELECT * FROM learning_evaluation_opportunities WHERE session_id=?").get(text(sessionID, "Session", 200)) as EvaluationOpportunity | undefined) ?? null
  }
  opportunities(after = "", limit = 100): EvaluationOpportunity[] {
    return this.db.prepare("SELECT * FROM learning_evaluation_opportunities WHERE state<>'idle' AND session_id>? ORDER BY session_id LIMIT ?").all(after, integer(limit, "page limit", 1, 200)) as EvaluationOpportunity[]
  }
  setOpportunity(sessionID: string, state: EvaluationOpportunity["state"], reason: string | null, generation?: number): boolean {
    if (!["pending", "blocked", "idle"].includes(state)) throw new Error("Invalid evaluation opportunity state")
    if (reason !== null) text(reason, "opportunity reason")
    return this.transaction(() => {
      const row = this.opportunity(sessionID)
      if (!row || (generation !== undefined && row.generation !== generation)) return false
      this.db.prepare("UPDATE learning_evaluation_opportunities SET state=?,reason=?,updated_at=? WHERE session_id=?").run(state, reason, new Date(this.clock()).toISOString(), sessionID)
      return true
    })
  }

  freeze(input: EvaluationFreeze): EvaluationBatch {
    const owner = text(input.owner_session, "owner", 200), scope = text(input.scope_key, "scope", 200), namespace = text(input.source_store_id, "source store", 200)
    const method = { id: text(input.method?.id, "method", 200), instruction_sha256: hash(input.method?.instruction_sha256) }
    if (!input.boundary || typeof input.boundary !== "object" || Array.isArray(input.boundary) || Object.values(input.boundary).some(v => typeof v !== "string" && (!Number.isSafeInteger(v) || (v as number) < 0))) throw new Error("Invalid evaluation boundary")
    if (!Array.isArray(input.members) || input.members.length < 1 || input.members.length > 100000) throw new Error("Invalid frozen evaluation population")
    const seen = new Set<string>()
    const members = input.members.map(member => {
      const key = text(member.key, "member", 500)
      if (seen.has(key)) throw new Error("Duplicate evaluation member")
      seen.add(key)
      if (member.kind !== "session" && member.kind !== "objective") throw new Error("Invalid evaluation member kind")
      return { key, kind: member.kind, source_refs: refs(member.source_refs) }
    }).sort((a, b) => a.key.localeCompare(b.key))
    const boundary = JSON.parse(canonical(input.boundary)) as EvaluationFreeze["boundary"]
    const membership = fingerprint(members), identity = fingerprint({ owner, scope, namespace, boundary, method, membership })
    const id = this.transaction(() => {
      const existing = this.db.prepare("SELECT id FROM learning_evaluation_batches WHERE identity=?").get(identity) as { id: string } | undefined
      if (existing) return existing.id
      const latest = this.db.prepare("SELECT * FROM learning_evaluation_batches WHERE owner_session=? AND scope_key=? ORDER BY sequence DESC LIMIT 1").get(owner, scope) as BatchRow | undefined
      const previous = input.previous_batch_id === undefined ? latest : this.row(input.previous_batch_id, owner)
      if (previous && (previous.scope_key !== scope || previous.id !== latest?.id)) throw new Error("Evaluation predecessor is not the current scope revision")
      const id = randomUUID(), now = new Date(this.clock()).toISOString()
      this.db.prepare("INSERT INTO learning_evaluation_batches(id,identity,owner_session,scope_key,source_store_id,boundary_json,method_json,membership_sha256,revision,previous_batch_id,state,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,'pending',?,?)")
        .run(id, identity, owner, scope, namespace, canonical(boundary), canonical(method), membership, (latest?.revision ?? 0) + 1, previous?.id ?? null, now, now)
      const insert = this.db.prepare("INSERT INTO learning_evaluation_members(batch_id,key,ordinal,kind,source_refs) VALUES(?,?,?,?,?)")
      members.forEach((member, index) => insert.run(id, member.key, index + 1, member.kind, encoded(member.source_refs)))
      return id
    })
    return this.get(id, owner)
  }

  claim(batchID: string, workerID: string, options: { now_ms?: number; lease_ms?: number } = {}): EvaluationClaimResult {
    const now = integer(options.now_ms ?? this.clock(), "clock"), lease = integer(options.lease_ms ?? 30000, "lease", 1, 300000)
    text(workerID, "worker", 200)
    return this.transaction(() => {
      const batch = this.row(batchID)
      if (batch.state === "complete") return { status: "complete" }
      if (batch.state === "processing" && (batch.lease_until_ms ?? 0) > now) return { status: "busy", lease_until_ms: batch.lease_until_ms! }
      this.verifyMembership(batch)
      const claim = { batch_id: batchID, worker_id: workerID, token: randomUUID() }
      this.db.prepare("UPDATE learning_evaluation_batches SET state='processing',blocked_reason=NULL,claim_token=?,worker_id=?,lease_until_ms=?,updated_at=? WHERE id=?")
        .run(claim.token, workerID, now + lease, new Date(now).toISOString(), batchID)
      return { status: "claimed", claim }
    })
  }
  release(claim: EvaluationClaim, reason = "interrupted", at = this.clock()): void {
    this.transaction(() => { this.claimed(claim, at); this.db.prepare("UPDATE learning_evaluation_batches SET state='pending',blocked_reason=?,claim_token=NULL,worker_id=NULL,lease_until_ms=NULL,updated_at=? WHERE id=?").run(text(reason, "release reason"), new Date(at).toISOString(), claim.batch_id) })
  }
  block(batchID: string, reason: string, claim?: EvaluationClaim, at = this.clock()): void {
    this.transaction(() => {
      const batch = claim ? this.claimed(claim, at) : this.row(batchID)
      if (batch.id !== batchID || batch.state === "complete") throw new Error("Evaluation cannot be blocked in this state")
      if (!claim && batch.state === "processing" && (batch.lease_until_ms ?? 0) > at) throw new Error("Evaluation has an active claim")
      this.db.prepare("UPDATE learning_evaluation_batches SET state='blocked',blocked_reason=?,claim_token=NULL,worker_id=NULL,lease_until_ms=NULL,updated_at=? WHERE id=?")
        .run(text(reason, "block reason"), new Date(at).toISOString(), batchID)
    })
  }
  private writeReport(batch: BatchRow, member: string | null, input: EvaluationReportInput, sources: EvaluationSourceRef[]): string {
    if (!Array.isArray(input.qualifications) || input.qualifications.length > 100) throw new Error("Invalid report qualifications")
    const qualifications = [...new Set(input.qualifications.map(item => text(item, "qualification", 2000)))].sort()
    const bodyJSON = canonical(input.body), dependencies = refs([...sources, ...input.dependencies])
    if (this.originals(batch, dependencies).length) throw new Error("Evaluation original source unavailable or changed")
    const slot = member === null ? "overall" : "member:" + member
    const sha256 = fingerprint({ batch_id: batch.id, member_key: member, body: JSON.parse(bodyJSON), qualifications, source_refs: dependencies })
    const existing = this.db.prepare("SELECT id,sha256 FROM learning_evaluation_reports WHERE batch_id=? AND slot=?").get(batch.id, slot) as { id: string; sha256: string } | undefined
    if (existing) {
      if (existing.sha256 !== sha256) throw new Error("Conflicting evaluation report replay")
      return existing.id
    }
    const id = randomUUID()
    this.db.prepare("INSERT INTO learning_evaluation_reports VALUES(?,?,?,?,?,?,?,?)").run(id, batch.id, member, slot, new Date(this.clock()).toISOString(), bodyJSON, canonical(qualifications), sha256)
    const insert = this.db.prepare("INSERT INTO learning_evaluation_dependencies VALUES(?,?,?)")
    for (const ref of dependencies) insert.run(id, sourceKey(ref), canonical(ref))
    return id
  }
  checkpoint(claim: EvaluationClaim, memberKey: string, input: EvaluationReportInput, at = this.clock()): string {
    return this.transaction(() => {
      const batch = this.claimed(claim, at)
      this.verifyMembership(batch)
      const member = this.db.prepare("SELECT * FROM learning_evaluation_members WHERE batch_id=? AND key=?").get(batch.id, text(memberKey, "member", 500)) as MemberRow | undefined
      if (!member) throw new Error("Evaluation member unavailable")
      const id = this.writeReport(batch, member.key, input, JSON.parse(member.source_refs))
      this.db.prepare("UPDATE learning_evaluation_members SET report_id=? WHERE batch_id=? AND key=?").run(id, batch.id, member.key)
      this.db.prepare("UPDATE learning_evaluation_batches SET updated_at=? WHERE id=?").run(new Date(at).toISOString(), batch.id)
      return id
    })
  }
  publish(claim: EvaluationClaim, input: EvaluationReportInput, at = this.clock()): string {
    return this.transaction(() => {
      const batch = this.claimed(claim, at), members = this.verifyMembership(batch)
      if (members.some(member => member.report_id === null)) throw new Error("Evaluation population is incomplete")
      const dependencies: EvaluationSourceRef[] = []
      for (const member of members) {
        const report = this.reportByID(member.report_id!, batch, member.key)
        if (report.availability !== "available") throw new Error("Evaluation member report is unavailable")
        dependencies.push(...JSON.parse(member.source_refs), ...report.source_refs)
      }
      const id = this.writeReport(batch, null, input, dependencies)
      this.db.prepare("UPDATE learning_evaluation_batches SET state='complete',blocked_reason=NULL,report_id=?,claim_token=NULL,worker_id=NULL,lease_until_ms=NULL,updated_at=? WHERE id=?").run(id, new Date(at).toISOString(), batch.id)
      return id
    })
  }
  invalidate(batchID: string, owner: string, reason: string): void {
    this.row(batchID, owner)
    this.db.prepare("INSERT INTO learning_evaluation_invalidations(batch_id,source_key,reason,recorded_at) VALUES(?,'boundary',?,?) ON CONFLICT(batch_id,source_key,reason) DO NOTHING")
      .run(batchID, text(reason, "invalidation reason"), new Date(this.clock()).toISOString())
  }
  invalidateSource(ref: EvaluationSourceRef, reason: string): void {
    const source = sourceKey(refs([ref])[0]!)
    this.db.prepare("INSERT INTO learning_evaluation_invalidations(batch_id,source_key,reason,recorded_at) SELECT DISTINCT r.batch_id,?,?,? FROM learning_evaluation_dependencies d JOIN learning_evaluation_reports r ON r.id=d.report_id WHERE d.source_key=? ON CONFLICT(batch_id,source_key,reason) DO NOTHING")
      .run(source, text(reason, "invalidation reason"), new Date(this.clock()).toISOString(), source)
  }
  get(batchID: string, owner: string): EvaluationBatch {
    const batch = this.row(batchID, text(owner, "owner", 200))
    const count = this.db.prepare("SELECT COUNT(*) AS total,COUNT(report_id) AS done FROM learning_evaluation_members WHERE batch_id=?").get(batchID) as { total: number; done: number }
    const invalidations = this.db.prepare("SELECT source_key,reason,recorded_at FROM learning_evaluation_invalidations WHERE batch_id=? ORDER BY sequence").all(batchID) as EvaluationBatch["invalidations"]
    let state: EvaluationBatch["state"] = batch.state
    if (state === "complete") {
      try {
        const members = this.verifyMembership(batch)
        for (const member of members) {
          if (!member.report_id || this.reportByID(member.report_id, batch, member.key).availability !== "available") throw new Error("Evaluation member report is unavailable")
        }
        if (count.total !== count.done || !batch.report_id || this.reportByID(batch.report_id, batch, null).availability !== "available") state = "incomplete"
        else if (invalidations.length) state = "stale"
      } catch { state = "incomplete" }
    }
    return { id: batch.id, sequence: batch.sequence, owner_session: batch.owner_session, scope_key: batch.scope_key, source_store_id: batch.source_store_id,
      boundary: JSON.parse(batch.boundary_json), method: JSON.parse(batch.method_json), membership_sha256: batch.membership_sha256,
      revision: batch.revision, previous_batch_id: batch.previous_batch_id, state, published_state: batch.state,
      blocked_reason: batch.blocked_reason, member_count: count.total, processed_count: count.done, report_id: batch.report_id,
      created_at: batch.created_at, updated_at: batch.updated_at, invalidations }
  }
  list(owner: string, input: { before?: number; limit?: number } = {}): { items: EvaluationBatch[]; next_before: number | null } {
    const take = integer(input.limit ?? 20, "page limit", 1, 100), before = integer(input.before ?? Number.MAX_SAFE_INTEGER, "cursor", 1)
    const rows = this.db.prepare("SELECT id,sequence FROM learning_evaluation_batches WHERE owner_session=? AND sequence<? ORDER BY sequence DESC LIMIT ?").all(text(owner, "owner", 200), before, take + 1) as Array<{ id: string; sequence: number }>
    const selected = rows.slice(0, take)
    return { items: selected.map(row => this.get(row.id, owner)), next_before: rows.length > take ? selected.at(-1)!.sequence : null }
  }
  members(batchID: string, owner: string, input: { after?: number; limit?: number; pending_only?: boolean } = {}) {
    this.row(batchID, owner)
    const take = integer(input.limit ?? 50, "page limit", 1, 100), after = integer(input.after ?? 0, "cursor")
    const rows = this.db.prepare("SELECT * FROM learning_evaluation_members WHERE batch_id=? AND ordinal>?" + (input.pending_only ? " AND report_id IS NULL" : "") + " ORDER BY ordinal LIMIT ?").all(batchID, after, take + 1) as MemberRow[]
    const selected = rows.slice(0, take)
    return { items: selected.map(row => ({ key: row.key, kind: row.kind, ordinal: row.ordinal, source_refs: JSON.parse(row.source_refs) as EvaluationSourceRef[], report_id: row.report_id })), next_after: rows.length > take ? selected.at(-1)!.ordinal : null }
  }
  reports(batchID: string, owner: string, input: { after?: number; limit?: number } = {}) {
    const batch = this.row(batchID, owner), page = this.members(batchID, owner, input)
    this.verifyMembership(batch)
    return { items: page.items.map(member => ({ ...member, report: member.report_id ? this.reportByID(member.report_id, batch, member.key) : null })), next_after: page.next_after }
  }
  report(batchID: string, owner: string, memberKey?: string): EvaluationReport | null {
    const batch = this.row(batchID, owner), members = this.verifyMembership(batch)
    if (memberKey === undefined && batch.report_id !== null) {
      // An overall report is not usable when any retained member receipt is missing or misattributed.
      // Source unavailability is represented separately by the overall report's dependency validation.
      for (const member of members) {
        if (!member.report_id) throw new Error("Evaluation member report unavailable")
        this.reportByID(member.report_id, batch, member.key)
      }
    }
    const id = memberKey === undefined ? batch.report_id : members.find(member => member.key === memberKey)?.report_id
    return id ? this.reportByID(id, batch, memberKey ?? null) : null
  }
  private reportByID(id: string, batch: BatchRow, expectedMemberKey: string | null): EvaluationReport {
    const row = this.db.prepare("SELECT * FROM learning_evaluation_reports WHERE id=? AND batch_id=?").get(id, batch.id) as ReportRow | undefined
    const expectedSlot = expectedMemberKey === null ? "overall" : "member:" + expectedMemberKey
    if (!row || row.member_key !== expectedMemberKey || row.slot !== expectedSlot) throw new Error("Evaluation report unavailable or misattributed")
    const dependencies = this.db.prepare("SELECT source_ref FROM learning_evaluation_dependencies WHERE report_id=?").all(id) as Array<{ source_ref: string }>
    const sourceRefs = refs(dependencies.map(ref => JSON.parse(ref.source_ref))), body = JSON.parse(row.body_json), qualifications = JSON.parse(row.qualifications_json) as string[]
    if (fingerprint({ batch_id: batch.id, member_key: row.member_key, body, qualifications, source_refs: sourceRefs }) !== row.sha256) throw new Error("Evaluation report integrity mismatch")
    const missing = this.originals(batch, sourceRefs)
    return { id: row.id, batch_id: batch.id, member_key: row.member_key, created_at: row.created_at, sha256: row.sha256,
      body: missing.length ? null : body, qualifications, source_refs: sourceRefs,
      availability: missing.length ? "source-unavailable" : "available", missing_sources: missing }
  }
}
