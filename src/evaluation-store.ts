import { randomUUID } from "node:crypto"
import { canonical, digest, ProcessingBudget, uid, type Actor } from "./model.js"
import type { SQL } from "./store.js"
import { evaluatorMethod, parseEvaluatorMethod, type EvaluatorMethodManifest } from "./evaluator-method.js"
import { assertEvaluatorReceiptProgress, evaluatorEnrollmentKey, parseEvaluatorAdmission, parseEvaluatorReceipt,
  type EvaluatorExecutionAdmission, type EvaluatorExecutionReceipt } from "./evaluator-execution-contract.js"
import { parseRetrospectiveManifest, retrospectiveBudget, retrospectiveDigest, RETROSPECTIVE_LIMITS,
  type RetrospectiveManifest, type RetrospectivePopulation, type RetrospectiveSources } from "./retrospective-contract.js"
import { evaluatorInterpretationID, evaluatorMemberInterpretationID, evaluatorPriorReports,
  evaluatorInterpretationOriginals, EVALUATOR_INTERPRETATION_LIMITS, INTERPRETATION_QUALIFICATIONS,
  validateEvaluatorPublication, type EvaluatorPublication } from "./evaluator-publication.js"

export type EvaluationSourceRef = { kind: string; id: string; session_id?: string; message_id?: string; revision?: string; sha256?: string; required: boolean }
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
export type EvaluatorPreparationRecord = {
  batch_id: string; request_id: string; requester: Actor; method: EvaluatorMethodManifest;
  data: unknown; sha256: string; created_at: string;
}
/** Local idempotency only; this key never attests a native execution. */
export const evaluatorRequestID = (batch: Pick<EvaluationBatch, "id" | "source_store_id" | "method">) => "evaluator-" + digest({
  format: "loom-evaluation-request-key/v1", batch_id: batch.id, source_store_id: batch.source_store_id, method: batch.method, slot: "overall",
})

export const EVALUATOR_COLUMNS = {
  schema: ["singleton", "version"],
  methods: ["id", "manifest_json", "manifest_sha256", "instruction_sha256"],
  requests: ["batch_id", "slot", "method_id", "request_id", "data_json", "sha256", "created_at"],
} as const

export const RETROSPECTIVE_COLUMNS = {
  schema: ["singleton", "version"],
  populations: ["id", "owner_session", "owner_agent", "source_store_id", "manifest_sha256", "header_json", "contributors_json", "contains_private_reviews", "member_count", "metadata_sha256", "created_at"],
  members: ["population_id", "key", "ordinal", "data_json"],
} as const
type RetrospectiveRow = {
  id: string; owner_session: string; owner_agent: string; source_store_id: string; manifest_sha256: string;
  header_json: string; contributors_json: string; contains_private_reviews: number; member_count: number;
  metadata_sha256: string; created_at: string;
}
const retrospectiveID = (owner: string, sourceStoreID: string, manifestSHA: string) => "retrospective-" + digest({
  format: "loom-retrospective-identity/v1", owner_session: owner, source_store_id: sourceStoreID, manifest_sha256: manifestSHA,
})

export type EvaluatorExecutionRecord = { admission: EvaluatorExecutionAdmission; receipts: EvaluatorExecutionReceipt[] }
/** Internal structural read. Current source/disclosure authority belongs to the
 * asynchronous interpretation service; this object must never be exposed raw. */
export type EvaluatorInterpretationRecord = {
  report: EvaluationReport & { body: EvaluatorPublication }; batch: EvaluationBatch;
  population: RetrospectivePopulation; populations: RetrospectivePopulation[];
}
const interpretationPopulationSnapshot = () => ({ populations: new Map<string, RetrospectivePopulation>(),
  originals: new Set<string>(), dependencies: new Set<string>() })
export const EXECUTION_COLUMNS = {
  schema: ["singleton", "version"],
  admissions: ["batch_id", "request_id", "attempt_id", "authority_id", "reservation_id", "semantic_key", "data_json", "sha256"],
  receipts: ["batch_id", "sequence", "authority_id", "receipt_id", "data_json", "sha256"],
} as const
const EXECUTION_RECEIPTS = 1024

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
const sourceKey = (ref: EvaluationSourceRef) => fingerprint({ kind: ref.kind, id: ref.id, session_id: ref.session_id,
  ...(ref.message_id === undefined ? {} : { message_id: ref.message_id }), revision: ref.revision, sha256: ref.sha256 })
const refs = (input: EvaluationSourceRef[]): EvaluationSourceRef[] => {
  if (!Array.isArray(input) || input.length > 100000) throw new Error("Invalid evaluation source population")
  const found = new Map<string, EvaluationSourceRef>()
  for (const value of input) {
    if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).some(k => !["kind", "id", "session_id", "message_id", "revision", "sha256", "required"].includes(k)) || typeof value.required !== "boolean") throw new Error("Invalid evaluation source")
    const ref: EvaluationSourceRef = { kind: text(value.kind, "source kind", 100), id: text(value.id, "source ID", 1000), required: value.required }
    if (value.session_id !== undefined) ref.session_id = text(value.session_id, "source Session", 200)
    if (value.message_id !== undefined) {
      if (ref.kind !== "native-call" || !ref.session_id) throw new Error("Invalid native call source identity")
      ref.message_id = text(value.message_id, "source message", 200)
    }
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

  private transaction<T>(run: () => T, mode: "read" | "write" = "write"): T {
    this.db.exec(mode === "read" ? "BEGIN" : "BEGIN IMMEDIATE")
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

  /** Selection metadata belongs to this owner, separately from processing batches.
   * There are no source bodies, source grants or evaluator execution states here. */
  private retrospectiveSchema(create: boolean): boolean {
    const tables = this.db.prepare("SELECT name FROM sqlite_schema WHERE type='table' AND name GLOB 'learning_retrospective_*'").all() as Array<{ name: string }>
    if (!tables.length) {
      if (!create) return false
      this.db.exec(`
        CREATE TABLE learning_retrospective_schema(singleton INTEGER PRIMARY KEY CHECK(singleton=1), version INTEGER NOT NULL CHECK(version=1));
        CREATE TABLE learning_retrospective_populations(
          id TEXT PRIMARY KEY, owner_session TEXT NOT NULL, owner_agent TEXT NOT NULL, source_store_id TEXT NOT NULL,
          manifest_sha256 TEXT NOT NULL, header_json TEXT NOT NULL, contributors_json TEXT NOT NULL,
          contains_private_reviews INTEGER NOT NULL CHECK(contains_private_reviews IN (0,1)),
          member_count INTEGER NOT NULL CHECK(member_count>0), metadata_sha256 TEXT NOT NULL, created_at TEXT NOT NULL,
          UNIQUE(owner_session,manifest_sha256));
        CREATE TABLE learning_retrospective_members(
          population_id TEXT NOT NULL REFERENCES learning_retrospective_populations(id), key TEXT NOT NULL,
          ordinal INTEGER NOT NULL CHECK(ordinal>0), data_json TEXT NOT NULL,
          PRIMARY KEY(population_id,key), UNIQUE(population_id,ordinal));
        INSERT INTO learning_retrospective_schema VALUES(1,1);
      `)
      return true
    }
    for (const [name, required] of Object.entries(RETROSPECTIVE_COLUMNS)) {
      const columns = this.db.prepare(`PRAGMA table_info(learning_retrospective_${name})`).all() as Array<{ name: string }>
      if (required.some(column => !columns.some(actual => actual.name === column))) throw new Error("Retrospective population schema is incomplete")
    }
    const markers = this.db.prepare("SELECT singleton,version FROM learning_retrospective_schema").all() as Array<{ singleton: number; version: number }>
    if (markers.length !== 1 || markers[0]?.singleton !== 1 || markers[0]?.version !== 1) throw new Error("Unsupported retrospective population schema")
    return true
  }

  private retrospectiveMetadata(row: Omit<RetrospectiveRow, "header_json">): RetrospectiveSources {
    const contributors: unknown = JSON.parse(row.contributors_json)
    if (!Array.isArray(contributors) || contributors.length > RETROSPECTIVE_LIMITS.contributors
      || contributors.some(value => typeof value !== "string") || new Set(contributors).size !== contributors.length
      || ![0, 1].includes(row.contains_private_reviews)) throw new Error("Retrospective population metadata integrity mismatch")
    const sources: RetrospectiveSources = { population_id: uid(row.id), manifest_sha256: hash(row.manifest_sha256),
      owner_session: uid(row.owner_session), source_store_id: uid(row.source_store_id),
      contributors: contributors.map(value => uid(value)), contains_private_reviews: row.contains_private_reviews === 1,
      member_count: integer(row.member_count, "retrospective member count", 1, RETROSPECTIVE_LIMITS.members) }
    const frozenBy = { session_id: sources.owner_session, agent: text(row.owner_agent, "retrospective author", 200) }
    if (sources.population_id !== retrospectiveID(sources.owner_session, sources.source_store_id, sources.manifest_sha256)
      || digest({ ...sources, frozen_by: frozenBy, created_at: row.created_at }) !== row.metadata_sha256 || !Number.isFinite(Date.parse(row.created_at)))
      throw new Error("Retrospective population metadata integrity mismatch")
    return sources
  }

  /** Metadata-only permission preflight. An omitted owner does not grant access:
   * the async source owner must authorize every contributor before body loading. */
  retrospectiveSources(id: string, owner?: string): RetrospectiveSources {
    uid(id, "population_id")
    if (!this.retrospectiveSchema(false)) throw new Error("Retrospective population unavailable")
    const row = this.db.prepare(`SELECT id,owner_session,owner_agent,source_store_id,manifest_sha256,
      CASE WHEN typeof(contributors_json)='text' AND octet_length(contributors_json)<=786432 THEN contributors_json END AS contributors_json,
      contains_private_reviews,member_count,metadata_sha256,created_at
      FROM learning_retrospective_populations WHERE id=?`).get(id) as Omit<RetrospectiveRow, "header_json"> | undefined
    if (!row || owner !== undefined && row.owner_session !== owner || typeof row.contributors_json !== "string")
      throw new Error("Retrospective population unavailable")
    return this.retrospectiveMetadata(row)
  }

  findRetrospective(manifestSHA: string, owner: string): RetrospectiveSources | null {
    hash(manifestSHA); uid(owner)
    if (!this.retrospectiveSchema(false)) return null
    const row = this.db.prepare("SELECT id FROM learning_retrospective_populations WHERE owner_session=? AND manifest_sha256=?")
      .get(owner, manifestSHA) as { id: string } | undefined
    return row ? this.retrospectiveSources(row.id, owner) : null
  }

  /** Immutable manifest reconstruction. Current source availability is separate;
   * callers perform asynchronous original and disclosure checks on every read. */
  retrospectivePopulation(id: string, owner?: string): RetrospectivePopulation {
    const sources = this.retrospectiveSources(id, owner)
    const size = this.db.prepare(`SELECT COUNT(*) AS count,SUM(length(data_json)) AS chars,
      SUM(CASE WHEN typeof(data_json)='text' THEN 0 ELSE 1 END) AS invalid
      FROM learning_retrospective_members WHERE population_id=?`).get(id) as { count: number; chars: number | null; invalid: number | null }
    if (size.count !== sources.member_count || size.invalid || (size.chars ?? 0) > RETROSPECTIVE_LIMITS.chars)
      throw new Error("Retrospective frozen membership is incomplete or oversized")
    const row = this.db.prepare(`SELECT owner_agent,created_at,
      CASE WHEN typeof(header_json)='text' AND octet_length(header_json)<=100663296 THEN header_json END AS header_json
      FROM learning_retrospective_populations WHERE id=?`).get(id) as Pick<RetrospectiveRow, "owner_agent" | "created_at" | "header_json"> | undefined
    if (!row || typeof row.header_json !== "string") throw new Error("Retrospective population unavailable")
    const rows = this.db.prepare(`SELECT key,ordinal,
      CASE WHEN typeof(data_json)='text' AND octet_length(data_json)<=100663296 THEN data_json END AS data_json
      FROM learning_retrospective_members WHERE population_id=? ORDER BY ordinal LIMIT ?`)
      .all(id, RETROSPECTIVE_LIMITS.members + 1) as Array<{ key: string; ordinal: number; data_json: string | null }>
    if (rows.length !== sources.member_count || rows.some((member, index) => member.ordinal !== index + 1 || typeof member.data_json !== "string"))
      throw new Error("Retrospective frozen membership is incomplete")
    // Charge aggregate retained bytes before parsing any member bodies.
    const readBudget = retrospectiveBudget()
    readBudget.take(row.header_json.length)
    for (const member of rows) readBudget.take(member.data_json!.length)
    const header: unknown = JSON.parse(row.header_json)
    if (!header || typeof header !== "object" || Array.isArray(header) || "members" in header) throw new Error("Invalid retrospective manifest header")
    const manifest = parseRetrospectiveManifest({ ...header, members: rows.map(member => JSON.parse(member.data_json!)) })
    if (retrospectiveDigest(manifest) !== sources.manifest_sha256 || manifest.source_store_id !== sources.source_store_id
      || canonical(manifest.contributors) !== canonical(sources.contributors)
      || manifest.members.some((member, index) => member.key !== rows[index]?.key)
      || manifest.members.some(member => ["review-request", "review-relationship"].includes(member.source.kind)) !== sources.contains_private_reviews)
      throw new Error("Retrospective population integrity mismatch")
    return { population_id: id, manifest_sha256: sources.manifest_sha256, owner_session: sources.owner_session,
      frozen_by: { session_id: sources.owner_session, agent: text(row.owner_agent, "retrospective author", 200) },
      created_at: row.created_at, manifest }
  }

  freezeRetrospective(actor: Actor, input: unknown): RetrospectivePopulation {
    const owner = uid(actor.session_id), agent = text(actor.agent, "retrospective author", 200)
    const manifest = parseRetrospectiveManifest(input), sha256 = retrospectiveDigest(manifest)
    const id = retrospectiveID(owner, manifest.source_store_id, sha256)
    const { members, ...header } = manifest
    const metadata: RetrospectiveSources = { population_id: id, manifest_sha256: sha256, source_store_id: manifest.source_store_id,
      owner_session: owner, contributors: manifest.contributors, member_count: members.length,
      contains_private_reviews: members.some(member => ["review-request", "review-relationship"].includes(member.source.kind)) }
    this.transaction(() => {
      this.retrospectiveSchema(true)
      const existing = this.findRetrospective(sha256, owner)
      if (existing) {
        if (existing.population_id !== id) throw new Error("Retrospective population identity conflict")
        this.retrospectivePopulation(id, owner)
        return
      }
      const createdAt = new Date(this.clock()).toISOString()
      this.db.prepare("INSERT INTO learning_retrospective_populations VALUES(?,?,?,?,?,?,?,?,?,?,?)").run(id, owner, agent,
        manifest.source_store_id, sha256, canonical(header, retrospectiveBudget()), canonical(manifest.contributors),
        Number(metadata.contains_private_reviews), members.length, digest({ ...metadata, frozen_by: { session_id: owner, agent }, created_at: createdAt }), createdAt)
      const insert = this.db.prepare("INSERT INTO learning_retrospective_members VALUES(?,?,?,?)")
      members.forEach((member, index) => insert.run(id, member.key, index + 1, canonical(member, retrospectiveBudget())))
    })
    return this.retrospectivePopulation(id, owner)
  }

  /** Optional preparation metadata is initialized only by explicit preparation.
   * A damaged extension blocks that operation without disabling Stage 3. */
  private evaluatorSchema(create: boolean): boolean {
    const existing = this.db.prepare("SELECT name FROM sqlite_schema WHERE type='table' AND name GLOB 'learning_evaluator_*'").all() as Array<{ name: string }>
    if (!existing.length) {
      if (!create) return false
      this.db.exec(`
        CREATE TABLE learning_evaluator_schema(singleton INTEGER PRIMARY KEY CHECK(singleton=1), version INTEGER NOT NULL CHECK(version=1));
        CREATE TABLE learning_evaluator_methods(id TEXT PRIMARY KEY, manifest_json TEXT NOT NULL, manifest_sha256 TEXT NOT NULL, instruction_sha256 TEXT NOT NULL);
        CREATE TABLE learning_evaluator_requests(
          batch_id TEXT NOT NULL REFERENCES learning_evaluation_batches(id), slot TEXT NOT NULL CHECK(slot='overall'),
          method_id TEXT NOT NULL REFERENCES learning_evaluator_methods(id), request_id TEXT NOT NULL UNIQUE,
          data_json TEXT NOT NULL, sha256 TEXT NOT NULL, created_at TEXT NOT NULL,
          PRIMARY KEY(batch_id,slot,method_id));
        INSERT INTO learning_evaluator_schema VALUES(1,1);
      `)
      return true
    }
    for (const [name, required] of Object.entries(EVALUATOR_COLUMNS)) {
      const columns = this.db.prepare(`PRAGMA table_info(learning_evaluator_${name})`).all() as Array<{ name: string }>
      if (required.some(column => !columns.some(actual => actual.name === column))) throw new Error("Evaluator preparation schema is incomplete")
    }
    const markers = this.db.prepare("SELECT singleton,version FROM learning_evaluator_schema").all() as Array<{ singleton: number; version: number }>
    if (markers.length !== 1 || markers[0]?.singleton !== 1 || markers[0]?.version !== 1) throw new Error("Unsupported evaluator preparation schema")
    return true
  }

  /** Complete original membership, with no foreign or optional-source bypass. */
  preparationPopulation(batchID: string, owner: string): { batch: EvaluationBatch; members: EvaluationMember[] } {
    const batch = this.row(batchID, owner), rows = this.verifyMembership(batch)
    const members = rows.map(row => ({ key: row.key, kind: row.kind, source_refs: refs(JSON.parse(row.source_refs)) }))
    const sources = members.flatMap(member => member.source_refs)
    if (sources.some(ref => ref.session_id !== owner || !ref.required) || this.originals(batch, sources).length)
      throw new Error("Evaluator preparation unavailable")
    return { batch: this.get(batchID, owner), members }
  }

  /** The new route validates persisted membership only. Source-owner and current
   * investigator checks are asynchronous service obligations, never this callback. */
  frozenPreparationPopulation(batchID: string, owner: string): { batch: EvaluationBatch; members: EvaluationMember[] } {
    const batch = this.row(batchID, owner)
    if (batch.scope_key !== "evaluator-preparation/retrospective") throw new Error("Retrospective preparation unavailable")
    const rows = this.verifyMembership(batch)
    return { batch: this.get(batchID, owner), members: rows.map(row => ({ key: row.key, kind: row.kind, source_refs: refs(JSON.parse(row.source_refs)) })) }
  }

  /** One immutable overall slot. The builder is pure; no cross-store writes run
   * until the mapping and its original requester have committed. */
  prepareEvaluatorRequest(batchID: string, owner: string, input: unknown, requester: Actor,
    build: (requestID: string, originalRequester: Actor) => unknown): EvaluatorPreparationRecord {
    const manifest = parseEvaluatorMethod(input), method = evaluatorMethod(manifest)
    const origin = { session_id: uid(requester.session_id), agent: text(requester.agent, "requester agent", 200) }
    if (origin.session_id !== owner) throw new Error("Evaluator preparation unavailable")
    return this.transaction(() => {
      const batch = this.row(batchID, owner)
      if (canonical(JSON.parse(batch.method_json)) !== canonical(method)
        || !["evaluator-preparation/calling-session", "evaluator-preparation/retrospective"].includes(batch.scope_key))
        throw new Error("Evaluator preparation method or scope mismatch")
      const mappedBefore = batch.blocked_reason === "evaluator-request-mapped" || batch.blocked_reason === "evaluator-dispatch-unavailable" || batch.report_id !== null
      if (!this.evaluatorSchema(false) && mappedBefore) throw new Error("Evaluator preparation mapping lost; restore required")
      this.evaluatorSchema(true)
      const prior = this.readEvaluatorRequest(batchID, owner)
      if (prior) {
        if (canonical(prior.method) !== canonical(manifest) || encoded(prior.data) !== encoded(build(prior.request_id, prior.requester)))
          throw new Error("Evaluator preparation immutable slot conflict")
        return prior
      }
      if (mappedBefore) throw new Error("Evaluator preparation mapping lost; restore required")
      const savedMethod = this.db.prepare("SELECT manifest_json FROM learning_evaluator_methods WHERE id=?").get(method.id) as { manifest_json: string } | undefined
      if (savedMethod && savedMethod.manifest_json !== canonical(manifest)) throw new Error("Evaluator method identity conflict")
      if (!savedMethod) this.db.prepare("INSERT INTO learning_evaluator_methods VALUES(?,?,?,?)")
        .run(method.id, canonical(manifest), digest(manifest), method.instruction_sha256)
      const requestID = evaluatorRequestID({ id: batch.id, source_store_id: batch.source_store_id, method }), data = build(requestID, origin), now = new Date(this.clock()).toISOString()
      const envelope = { requester: origin, data }, json = canonical(envelope, new ProcessingBudget(131072)), sha256 = digest(envelope)
      this.db.prepare("INSERT INTO learning_evaluator_requests(batch_id,slot,method_id,request_id,data_json,sha256,created_at) VALUES(?,'overall',?,?,?,?,?)")
        .run(batchID, method.id, requestID, json, sha256, now)
      this.db.prepare("UPDATE learning_evaluation_batches SET blocked_reason='evaluator-request-mapped' WHERE id=?").run(batchID)
      return { batch_id: batchID, request_id: requestID, requester: origin, method: manifest, data, sha256, created_at: now }
    })
  }

  readEvaluatorRequest(batchID: string, owner: string): EvaluatorPreparationRecord | null {
    const batch = this.row(batchID, owner)
    if (!this.evaluatorSchema(false)) return null
    const row = this.db.prepare(`SELECT batch_id,slot,method_id,request_id,sha256,created_at,
      CASE WHEN typeof(data_json)='text' AND octet_length(data_json)<=393216 THEN data_json END AS data_json
      FROM learning_evaluator_requests WHERE batch_id=? AND slot='overall'`).get(batchID) as {
        batch_id: string; slot: string; method_id: string; request_id: string; data_json: string | null; sha256: string; created_at: string;
      } | undefined
    if (!row) return null
    const methodRow = this.db.prepare(`SELECT manifest_sha256,instruction_sha256,
      CASE WHEN typeof(manifest_json)='text' AND octet_length(manifest_json)<=98304 THEN manifest_json END AS manifest_json
      FROM learning_evaluator_methods WHERE id=?`).get(row.method_id) as { manifest_json: string | null; manifest_sha256: string; instruction_sha256: string } | undefined
    if (!row.data_json || row.data_json.length > 131072 || !methodRow?.manifest_json) throw new Error("Evaluator preparation unavailable")
    const manifest = parseEvaluatorMethod(JSON.parse(methodRow.manifest_json)), method = evaluatorMethod(manifest)
    if (method.id !== row.method_id || digest(manifest) !== methodRow.manifest_sha256 || method.instruction_sha256 !== methodRow.instruction_sha256
      || canonical(JSON.parse(batch.method_json)) !== canonical(method)) throw new Error("Evaluator method integrity mismatch")
    const envelope: unknown = JSON.parse(row.data_json)
    if (!envelope || typeof envelope !== "object" || Array.isArray(envelope) || Object.keys(envelope).sort().join() !== "data,requester"
      || !("requester" in envelope) || !envelope.requester || typeof envelope.requester !== "object" || Array.isArray(envelope.requester)
      || Object.keys(envelope.requester).sort().join() !== "agent,session_id"
      || !("session_id" in envelope.requester) || !("agent" in envelope.requester) || !("data" in envelope)) throw new Error("Invalid evaluator preparation record")
    const requester = { session_id: uid(envelope.requester.session_id), agent: text(envelope.requester.agent, "requester agent", 200) }
    if (requester.session_id !== owner || digest(envelope) !== row.sha256 || !Number.isFinite(Date.parse(row.created_at))
      || row.request_id !== evaluatorRequestID({ id: batch.id, source_store_id: batch.source_store_id, method })) throw new Error("Evaluator preparation integrity mismatch")
    return { batch_id: row.batch_id, request_id: uid(row.request_id), requester, method: manifest, data: envelope.data, sha256: row.sha256, created_at: row.created_at }
  }

  /** Mirrors qualified-owner records; no authority, spend pool or effect permit
   * is created here. A lost/older local mirror must be reconciled externally. */
  private executionSchema(create: boolean): boolean {
    const tables = this.db.prepare("SELECT name FROM sqlite_schema WHERE type='table' AND name GLOB 'learning_execution_*'").all() as Array<{ name: string }>
    const columns = this.db.prepare("PRAGMA table_info(learning_evaluator_requests)").all() as Array<{ name: string }>
    const hasMarker = columns.some(row => row.name === "execution_admission_sha256")
    if (!tables.length) {
      if (hasMarker && this.db.prepare("SELECT 1 FROM learning_evaluator_requests WHERE execution_admission_sha256 IS NOT NULL LIMIT 1").get())
        throw new Error("Evaluator execution mirror lost; authority reconciliation required")
      if (!create) return false
      if (!hasMarker) this.db.exec("ALTER TABLE learning_evaluator_requests ADD COLUMN execution_admission_sha256 TEXT")
      this.db.exec(`
        CREATE TABLE learning_execution_schema(singleton INTEGER PRIMARY KEY CHECK(singleton=1), version INTEGER NOT NULL CHECK(version=1));
        CREATE TABLE learning_execution_admissions(
          batch_id TEXT PRIMARY KEY REFERENCES learning_evaluation_batches(id),
          request_id TEXT NOT NULL UNIQUE REFERENCES learning_evaluator_requests(request_id), attempt_id TEXT NOT NULL UNIQUE,
          authority_id TEXT NOT NULL, reservation_id TEXT NOT NULL, semantic_key TEXT NOT NULL UNIQUE,
          data_json TEXT NOT NULL, sha256 TEXT NOT NULL, UNIQUE(authority_id,reservation_id));
        CREATE TABLE learning_execution_receipts(
          batch_id TEXT NOT NULL REFERENCES learning_execution_admissions(batch_id), sequence INTEGER NOT NULL CHECK(sequence>0),
          authority_id TEXT NOT NULL, receipt_id TEXT NOT NULL, data_json TEXT NOT NULL, sha256 TEXT NOT NULL,
          PRIMARY KEY(batch_id,sequence), UNIQUE(authority_id,receipt_id));
        INSERT INTO learning_execution_schema VALUES(1,1);
      `)
      return true
    }
    if (!hasMarker) throw new Error("Evaluator execution enrollment marker is missing")
    for (const [name, required] of Object.entries(EXECUTION_COLUMNS)) {
      const actual = this.db.prepare(`PRAGMA table_info(learning_execution_${name})`).all() as Array<{ name: string }>
      if (required.some(column => !actual.some(row => row.name === column))) throw new Error(`Evaluator execution schema is incomplete: ${name}`)
    }
    const markers = this.db.prepare("SELECT singleton,version FROM learning_execution_schema").all() as Array<{ singleton: number; version: number }>
    if (markers.length !== 1 || markers[0]?.singleton !== 1 || markers[0]?.version !== 1) throw new Error("Unsupported evaluator execution schema")
    return true
  }

  private executionBinding(batchID: string, owner: string, admission: EvaluatorExecutionAdmission): EvaluatorPreparationRecord {
    const batch = this.row(batchID, owner), prepared = this.readEvaluatorRequest(batchID, owner), subject = admission.grant.subject
    if (!prepared || !prepared.data || typeof prepared.data !== "object" || Array.isArray(prepared.data)
        || !("manifest_sha256" in prepared.data) || subject.batch_id !== batchID || subject.owner_session !== owner
        || subject.request_id !== prepared.request_id || subject.source_store_id !== batch.source_store_id
        || subject.manifest_sha256 !== prepared.data.manifest_sha256 || canonical(admission.grant.method) !== canonical(prepared.method))
      throw new Error("Evaluator execution preparation binding mismatch")
    const data = prepared.data as Record<string, unknown>
    if (batch.scope_key === "evaluator-preparation/retrospective") {
      if (!subject.source || data.format !== "loom-evaluation-request/v2" || data.source_scope !== "frozen-retrospective-population"
          || canonical(data.source) !== canonical(subject.source)) throw new Error("Evaluator execution population binding mismatch")
      const population = this.retrospectivePopulation(subject.source.population_id, owner)
      const frozen = this.frozenPreparationPopulation(batchID, owner)
      const members: EvaluationMember[] = population.manifest.members.map(member => ({ key: member.key, kind: "objective", source_refs: [member.source] }))
      const boundary = { retrospective_population: population.population_id, retrospective_manifest: population.manifest_sha256,
        preparation_budget_policy: digest(data.budget_policy) }
      const manifest = { format: "loom-evaluation-manifest/v2", batch_id: batchID, source: subject.source,
        source_store_id: batch.source_store_id, boundary, method: frozen.batch.method,
        membership_sha256: frozen.batch.membership_sha256, member_count: members.length,
        member_count_unit: "deduplicated-evidence-sources", objective_count: 1 }
      if (population.manifest_sha256 !== subject.source.manifest_sha256 || population.manifest.source_store_id !== batch.source_store_id
          || canonical(frozen.batch.boundary) !== canonical(boundary)
          || encoded(frozen.members) !== encoded(members)
          || digest({ ...manifest, members }, retrospectiveBudget()) !== subject.manifest_sha256
          || subject.semantic_key !== evaluatorEnrollmentKey({ source_store_id: batch.source_store_id, owner_session: owner,
            boundary, membership_sha256: frozen.batch.membership_sha256, method: data.method, source_policy: data.source_policy,
            route_policy: data.route_policy, budget_policy: data.budget_policy, source: subject.source }))
        throw new Error("Evaluator execution population integrity mismatch")
    } else if (subject.source || data.format !== "loom-evaluation-request/v1" || batch.scope_key !== "evaluator-preparation/calling-session") {
      throw new Error("Evaluator execution source kind mismatch")
    }
    // The ReviewIssues owner checks attempt identity and the authority adapter
    // checks semantic enrollment. This store cannot certify either relationship.
    return prepared
  }

  private executionRecord(batchID: string, owner: string): EvaluatorExecutionRecord | null {
    this.row(batchID, owner)
    if (!this.readEvaluatorRequest(batchID, owner)) throw new Error("Evaluator execution preparation unavailable")
    if (!this.executionSchema(false)) return null
    const marker = this.db.prepare("SELECT execution_admission_sha256 AS sha256 FROM learning_evaluator_requests WHERE batch_id=?").get(batchID) as { sha256: unknown }
    const row = this.db.prepare(`SELECT batch_id,request_id,attempt_id,authority_id,reservation_id,semantic_key,sha256,
      CASE WHEN typeof(data_json)='text' AND octet_length(data_json)<=196608 THEN data_json END AS data_json
      FROM learning_execution_admissions WHERE batch_id=?`).get(batchID) as {
        batch_id: string; request_id: string; attempt_id: string; authority_id: string; reservation_id: string;
        semantic_key: string; sha256: string; data_json: string | null;
      } | undefined
    if (!row) {
      if (marker.sha256 !== null) throw new Error("Evaluator execution mirror lost; authority reconciliation required")
      return null
    }
    if (!row.data_json || row.data_json.length > 65536) throw new Error("Evaluator execution admission unavailable")
    const admission = parseEvaluatorAdmission(JSON.parse(row.data_json)), subject = admission.grant.subject
    this.executionBinding(batchID, owner, admission)
    if (digest(admission) !== row.sha256 || marker.sha256 !== row.sha256 || row.batch_id !== subject.batch_id
        || row.request_id !== subject.request_id || row.attempt_id !== subject.attempt_id || row.authority_id !== admission.grant.authority_id
        || row.reservation_id !== admission.reservation_id || row.semantic_key !== subject.semantic_key)
      throw new Error("Evaluator execution admission integrity mismatch")
    const rows = this.db.prepare(`SELECT sequence,authority_id,receipt_id,sha256,
      CASE WHEN typeof(data_json)='text' AND octet_length(data_json)<=196608 THEN data_json END AS data_json
      FROM learning_execution_receipts WHERE batch_id=? ORDER BY sequence LIMIT ?`).all(batchID, EXECUTION_RECEIPTS + 1) as Array<{
        sequence: number; authority_id: string; receipt_id: string; sha256: string; data_json: string | null;
      }>
    if (rows.length > EXECUTION_RECEIPTS) throw new Error("Evaluator execution receipt limit exceeded")
    const receipts: EvaluatorExecutionReceipt[] = []
    for (const item of rows) {
      if (!item.data_json || item.data_json.length > 65536) throw new Error("Evaluator execution receipt unavailable")
      const receipt = parseEvaluatorReceipt(JSON.parse(item.data_json), admission)
      if (digest(receipt) !== item.sha256 || receipt.sequence !== item.sequence || receipt.authority_id !== item.authority_id || receipt.receipt_id !== item.receipt_id)
        throw new Error("Evaluator execution receipt integrity mismatch")
      for (const previous of receipts) assertEvaluatorReceiptProgress(previous, receipt)
      receipts.push(receipt)
    }
    return { admission, receipts }
  }

  /** Reconciliation may continue after source revocation. This internal mirror
   * does not authorize disclosure; the execution consumer rechecks that gate. */
  readExecution(batchID: string, owner: string): EvaluatorExecutionRecord | null {
    return this.transaction(() => this.executionRecord(batchID, owner))
  }

  saveExecutionAdmission(batchID: string, owner: string, input: unknown): EvaluatorExecutionAdmission {
    const admission = parseEvaluatorAdmission(input), json = canonical(admission), sha256 = digest(admission)
    return this.transaction(() => {
      this.executionBinding(batchID, owner, admission)
      this.executionSchema(true)
      const previous = this.executionRecord(batchID, owner)
      if (previous) {
        if (canonical(previous.admission) !== json) throw new Error("Evaluator execution immutable admission conflict")
        return previous.admission
      }
      const subject = admission.grant.subject
      this.db.prepare("INSERT INTO learning_execution_admissions VALUES(?,?,?,?,?,?,?,?)")
        .run(batchID, subject.request_id, subject.attempt_id, admission.grant.authority_id, admission.reservation_id, subject.semantic_key, json, sha256)
      this.db.prepare("UPDATE learning_evaluator_requests SET execution_admission_sha256=? WHERE batch_id=?").run(sha256, batchID)
      return admission
    })
  }

  appendExecutionReceipt(batchID: string, owner: string, input: unknown): EvaluatorExecutionRecord {
    return this.transaction(() => {
      const current = this.executionRecord(batchID, owner)
      if (!current) throw new Error("Evaluator execution admission unavailable")
      const receipt = parseEvaluatorReceipt(input, current.admission), json = canonical(receipt), sha256 = digest(receipt)
      const replay = current.receipts.find(item => item.receipt_id === receipt.receipt_id || item.sequence === receipt.sequence)
      if (replay) {
        if (canonical(replay) !== json) throw new Error("Evaluator execution receipt identity conflict")
        return current
      }
      for (const previous of current.receipts) assertEvaluatorReceiptProgress(previous, receipt)
      if (current.receipts.length >= EXECUTION_RECEIPTS) throw new Error("Evaluator execution receipt limit exceeded")
      this.db.prepare("INSERT INTO learning_execution_receipts VALUES(?,?,?,?,?,?)")
        .run(batchID, receipt.sequence, receipt.authority_id, receipt.receipt_id, json, sha256)
      return { admission: current.admission, receipts: [...current.receipts, receipt] }
    })
  }

  /** Metadata selectors only. The service authorizes before returning even a
   * report identity, source gap, count, checksum or continuation cursor. */
  evaluatorInterpretationSource(batchID: string, owner: string): RetrospectiveSources {
    const batch = this.row(batchID, owner)
    if (batch.scope_key !== "evaluator-preparation/retrospective") throw new Error("Evaluator interpretation unavailable")
    const boundary = JSON.parse(batch.boundary_json)
    const metadata = this.retrospectiveSources(boundary.retrospective_population, owner)
    if (metadata.manifest_sha256 !== boundary.retrospective_manifest || metadata.source_store_id !== batch.source_store_id)
      throw new Error("Evaluator interpretation population mismatch")
    return metadata
  }
  evaluatorInterpretationCandidates(owner: string, input: { before?: number; limit?: number } = {}) {
    const before = integer(input.before ?? Number.MAX_SAFE_INTEGER, "cursor", 1), take = integer(input.limit ?? 20, "page limit", 1, 100)
    const rows = this.db.prepare("SELECT id,sequence FROM learning_evaluation_batches WHERE owner_session=? AND scope_key='evaluator-preparation/retrospective' AND report_id IS NOT NULL AND sequence<? ORDER BY sequence DESC LIMIT ?")
      .all(text(owner, "owner", 200), before, take) as Array<{ id: string; sequence: number }>
    // A full page carries a continuation derived only from its authorized last
    // row. It makes no assertion about another (possibly protected) report.
    return { items: rows, next_before: rows.length === take ? rows.at(-1)!.sequence : null }
  }
  evaluatorInterpretationBatch(reportID: string, owner: string): string {
    const row = this.db.prepare("SELECT r.batch_id FROM learning_evaluation_reports r JOIN learning_evaluation_batches b ON b.id=r.batch_id WHERE r.id=? AND r.slot='overall' AND b.owner_session=?")
      .get(text(reportID, "report ID", 200), text(owner, "owner", 200)) as { batch_id: string } | undefined
    if (!row) throw new Error("Evaluator interpretation unavailable")
    return row.batch_id
  }

  private structuralReport(id: string, batch: BatchRow, member: string | null): EvaluationReport {
    const row = this.db.prepare(`SELECT id,batch_id,member_key,slot,created_at,qualifications_json,sha256,
      CASE WHEN typeof(body_json)='text' AND octet_length(body_json)<=100663296 THEN body_json END AS body_json
      FROM learning_evaluation_reports WHERE id=? AND batch_id=?`).get(id, batch.id) as ReportRow | undefined
    if (!row?.body_json || row.body_json.length > 33554432 || row.member_key !== member
      || row.slot !== (member === null ? "overall" : "member:" + member)) throw new Error("Evaluator interpretation report unavailable")
    const dependencies = this.db.prepare("SELECT source_key,source_ref FROM learning_evaluation_dependencies WHERE report_id=? LIMIT 100001")
      .all(id) as Array<{ source_key: string; source_ref: string }>
    if (dependencies.length > 100000) throw new Error("Evaluator interpretation dependency limit exceeded")
    const sourceRefs = refs(dependencies.map(item => {
      const ref = JSON.parse(item.source_ref) as EvaluationSourceRef
      if (sourceKey(ref) !== item.source_key) throw new Error("Evaluator interpretation dependency identity mismatch")
      return ref
    }))
    const body: unknown = JSON.parse(row.body_json), qualifications = JSON.parse(row.qualifications_json) as string[]
    if (sourceRefs.length !== dependencies.length
      || fingerprint({ batch_id: batch.id, member_key: member, body, qualifications, source_refs: sourceRefs }) !== row.sha256)
      throw new Error("Evaluator interpretation integrity mismatch")
    return { id, batch_id: batch.id, member_key: member, created_at: row.created_at, sha256: row.sha256, body,
      qualifications, source_refs: sourceRefs, availability: "available", missing_sources: [] }
  }

  private interpretationDependencies(body: EvaluatorPublication, population: RetrospectivePopulation, owner: string,
    visiting: Set<string>, checked: Map<string, EvaluatorInterpretationRecord>, populationCache = interpretationPopulationSnapshot()) {
    const dependencies = population.manifest.members.map(member => member.source), populations = new Map([[population.population_id, population]])
    for (const reference of evaluatorPriorReports(body.interpretation)) {
      const row = this.db.prepare("SELECT batch_id FROM learning_evaluation_reports WHERE id=? AND slot='overall'").get(reference.report_id) as { batch_id: string } | undefined
      if (!row) throw new Error("Prior evaluator interpretation unavailable")
      const prior = this.interpretationRecord(row.batch_id, owner, visiting, checked, populationCache)
      if (!prior || prior.report.id !== reference.report_id || prior.report.sha256 !== reference.report_sha256
        || prior.batch.source_store_id !== population.manifest.source_store_id
        || prior.population.manifest.selection.objective_id !== population.manifest.selection.objective_id)
        throw new Error("Prior evaluator interpretation scope or identity mismatch")
      for (const claim of body.interpretation.claims) for (const link of claim.recommendation?.prior_recommendations ?? []) {
        if (link.report_id === reference.report_id && !prior.report.body.interpretation.claims.some(old => old.claim_id === link.claim_id && old.recommendation))
          throw new Error("Prior evaluator recommendation unavailable")
      }
      dependencies.push(...prior.report.source_refs)
      for (const item of prior.populations) populations.set(item.population_id, item)
    }
    const selected = [...populations.values()]
    evaluatorInterpretationOriginals(selected)
    return { dependencies: refs(dependencies), populations: selected }
  }
  private interpretationRecord(batchID: string, owner: string, visiting = new Set<string>(), checked = new Map<string, EvaluatorInterpretationRecord>(),
    populationCache = interpretationPopulationSnapshot()): EvaluatorInterpretationRecord | null {
    if (visiting.has(batchID)) throw new Error("Cyclic evaluator interpretation history")
    const known = checked.get(batchID)
    if (known) return known
    if (checked.size + visiting.size >= EVALUATOR_INTERPRETATION_LIMITS.reports) throw new Error("Evaluator interpretation history exceeds 32 reports")
    const batch = this.row(batchID, owner), members = this.verifyMembership(batch)
    if (batch.scope_key !== "evaluator-preparation/retrospective") throw new Error("Evaluator interpretation unavailable")
    if (!batch.report_id) {
      if (batch.state === "complete" || members.some(member => member.report_id)) throw new Error("Evaluator interpretation publication is incomplete")
      return null
    }
    if (batch.state !== "complete") throw new Error("Evaluator interpretation publication is incomplete")
    const execution = this.executionRecord(batchID, owner), receipt = execution?.receipts.at(-1)
    if (!execution || !receipt || !execution.admission.grant.subject.source) throw new Error("Evaluator interpretation execution unavailable")
    const populationID = execution.admission.grant.subject.source.population_id
    let population = populationCache.populations.get(populationID)
    if (!population) {
      population = this.retrospectivePopulation(populationID, owner)
      evaluatorInterpretationOriginals([population], populationCache)
      populationCache.populations.set(populationID, population)
    }
    const report = this.structuralReport(batch.report_id, batch, null)
    const body = validateEvaluatorPublication(report.body, execution.admission, receipt, population)
    if (report.id !== evaluatorInterpretationID(body.binding) || encoded(report.qualifications) !== encoded(INTERPRETATION_QUALIFICATIONS))
      throw new Error("Evaluator interpretation identity mismatch")
    visiting.add(batchID)
    const linked = this.interpretationDependencies(body, population, owner, visiting, checked, populationCache)
    if (encoded(report.source_refs) !== encoded(linked.dependencies)) throw new Error("Evaluator interpretation dependency union mismatch")
    for (const link of body.interpretation.prior_interpretations) {
      const prior = this.db.prepare("SELECT batch_id FROM learning_evaluation_reports WHERE id=?").get(link.report_id) as { batch_id: string }
      if (!this.db.prepare("SELECT 1 FROM learning_evaluation_invalidations WHERE batch_id=? AND source_key=? AND reason=?")
        .get(prior.batch_id, report.id, "interpretation-" + link.relation)) throw new Error("Evaluator interpretation revision marker unavailable")
    }
    for (const member of members) {
      const id = evaluatorMemberInterpretationID(report.id, member.key)
      if (member.report_id !== id) throw new Error("Evaluator interpretation member checkpoint unavailable")
      const checkpoint = this.structuralReport(id, batch, member.key)
      if (encoded(checkpoint.body) !== encoded({ format: "loom-evaluator-member/v1", report_id: report.id, report_sha256: report.sha256, member_key: member.key })
        || encoded(checkpoint.qualifications) !== encoded(INTERPRETATION_QUALIFICATIONS)
        || encoded(checkpoint.source_refs) !== encoded(refs(JSON.parse(member.source_refs)))) throw new Error("Evaluator interpretation member checkpoint mismatch")
    }
    const count = this.db.prepare("SELECT COUNT(*) AS count FROM learning_evaluation_reports WHERE batch_id=?").get(batchID) as { count: number }
    if (count.count !== members.length + 1) throw new Error("Evaluator interpretation report population mismatch")
    visiting.delete(batchID)
    const result = { report: { ...report, body }, batch: this.get(batchID, owner), population, populations: linked.populations }
    checked.set(batchID, result)
    return result
  }
  readEvaluatorInterpretation(batchID: string, owner: string): EvaluatorInterpretationRecord | null {
    return this.readEvaluatorInterpretations([batchID], owner)[0]!
  }
  /** One structural snapshot for a bounded list. Immutable populations are
   * hydrated once, never reused across an asynchronous boundary. Each report's
   * recursive history still has its own complete 32-report admission check. */
  readEvaluatorInterpretations(batchIDs: string[], owner: string): Array<EvaluatorInterpretationRecord | null> {
    if (batchIDs.length > 100) throw new Error("Evaluator interpretation read exceeds 100 reports")
    return this.transaction(() => {
      const populations = interpretationPopulationSnapshot()
      return batchIDs.map(batchID => this.interpretationRecord(batchID, owner, new Set(), new Map(), populations))
    }, "read")
  }

  /** Publish through the existing evaluation/report/dependency owners in one
   * transaction. No claim, reservation or native execution is created here.
   * The execution consumer has just rechecked current disclosure authority. */
  publishEvaluatorInterpretation(batchID: string, owner: string, input: EvaluatorPublication): EvaluatorInterpretationRecord {
    return this.transaction(() => {
      const batch = this.row(batchID, owner), execution = this.executionRecord(batchID, owner), receipt = execution?.receipts.at(-1)
      if (!execution || !receipt || !execution.admission.grant.subject.source || batch.scope_key !== "evaluator-preparation/retrospective")
        throw new Error("Evaluator interpretation execution unavailable")
      const population = this.retrospectivePopulation(execution.admission.grant.subject.source.population_id, owner)
      const body = validateEvaluatorPublication(input, execution.admission, receipt, population), id = evaluatorInterpretationID(body.binding)
      const existing = this.interpretationRecord(batchID, owner)
      if (existing) {
        if (existing.report.id !== id || encoded(existing.report.body) !== encoded(body)) throw new Error("Conflicting evaluator interpretation replay")
        return existing
      }
      if (batch.state === "processing" && (batch.lease_until_ms ?? 0) > this.clock()) throw new Error("Evaluation has an active claim")
      const members = this.verifyMembership(batch), linked = this.interpretationDependencies(body, population, owner, new Set([batchID]), new Map())
      const write = (reportID: string, member: string | null, value: unknown, dependencies = linked.dependencies) => {
        const sha256 = fingerprint({ batch_id: batchID, member_key: member, body: value, qualifications: INTERPRETATION_QUALIFICATIONS, source_refs: dependencies })
        this.db.prepare("INSERT INTO learning_evaluation_reports VALUES(?,?,?,?,?,?,?,?)").run(reportID, batchID, member,
          member === null ? "overall" : "member:" + member, new Date(this.clock()).toISOString(), encoded(value), encoded(INTERPRETATION_QUALIFICATIONS), sha256)
        const insert = this.db.prepare("INSERT INTO learning_evaluation_dependencies VALUES(?,?,?)")
        for (const ref of dependencies) insert.run(reportID, sourceKey(ref), canonical(ref))
        return sha256
      }
      const sha256 = write(id, null, body)
      for (const member of members) {
        const checkpoint = evaluatorMemberInterpretationID(id, member.key)
        // A checkpoint records membership completion, not an independent
        // interpretation. Its authenticated parent retains the full protection
        // union, avoiding quadratic copies. No checkpoint reader is public.
        write(checkpoint, member.key, { format: "loom-evaluator-member/v1", report_id: id, report_sha256: sha256, member_key: member.key }, refs(JSON.parse(member.source_refs)))
        this.db.prepare("UPDATE learning_evaluation_members SET report_id=? WHERE batch_id=? AND key=?").run(checkpoint, batchID, member.key)
      }
      this.db.prepare("UPDATE learning_evaluation_batches SET state='complete',blocked_reason=NULL,report_id=?,claim_token=NULL,worker_id=NULL,lease_until_ms=NULL,updated_at=? WHERE id=?")
        .run(id, new Date(this.clock()).toISOString(), batchID)
      for (const link of body.interpretation.prior_interpretations) {
        const prior = this.db.prepare("SELECT batch_id FROM learning_evaluation_reports WHERE id=?").get(link.report_id) as { batch_id: string }
        this.db.prepare("INSERT INTO learning_evaluation_invalidations(batch_id,source_key,reason,recorded_at) VALUES(?,?,?,?) ON CONFLICT(batch_id,source_key,reason) DO NOTHING")
          .run(prior.batch_id, id, "interpretation-" + link.relation, new Date(this.clock()).toISOString())
      }
      return this.interpretationRecord(batchID, owner)!
    })
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
      const id = ["evaluator-preparation/calling-session", "evaluator-preparation/retrospective"].includes(scope) ? "eval-preparation-" + identity : randomUUID(), now = new Date(this.clock()).toISOString()
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
        // Retrospective originals have asynchronous source owners. This metadata
        // read checks structure only; the dedicated S5 service authorizes the
        // whole dependency union before exposing any dependent content.
        const structural = batch.scope_key === "evaluator-preparation/retrospective"
        for (const member of members) {
          if (!member.report_id || (structural ? this.structuralReport(member.report_id, batch, member.key)
            : this.reportByID(member.report_id, batch, member.key)).availability !== "available") throw new Error("Evaluation member report is unavailable")
        }
        if (count.total !== count.done || !batch.report_id || (structural ? this.structuralReport(batch.report_id, batch, null)
          : this.reportByID(batch.report_id, batch, null)).availability !== "available") state = "incomplete"
        else if (invalidations.length) state = "stale"
      } catch { state = "incomplete" }
    }
    return { id: batch.id, sequence: batch.sequence, owner_session: batch.owner_session, scope_key: batch.scope_key, source_store_id: batch.source_store_id,
      boundary: JSON.parse(batch.boundary_json), method: JSON.parse(batch.method_json), membership_sha256: batch.membership_sha256,
      revision: batch.revision, previous_batch_id: batch.previous_batch_id, state, published_state: batch.state,
      blocked_reason: batch.blocked_reason, member_count: count.total, processed_count: count.done, report_id: batch.report_id,
      created_at: batch.created_at, updated_at: batch.updated_at, invalidations }
  }
  nextUnfinished(owner: string, scope: string): EvaluationBatch | null {
    const row = this.db.prepare("SELECT id FROM learning_evaluation_batches WHERE owner_session=? AND scope_key=? AND state IN ('pending','processing') ORDER BY sequence LIMIT 1")
      .get(text(owner, "owner", 200), text(scope, "scope", 200)) as { id: string } | undefined
    return row ? this.get(row.id, owner) : null
  }
  list(owner: string, input: { before?: number; limit?: number; exclude_scope?: string | string[] } = {}): { items: EvaluationBatch[]; next_before: number | null } {
    const take = integer(input.limit ?? 20, "page limit", 1, 100), before = integer(input.before ?? Number.MAX_SAFE_INTEGER, "cursor", 1)
    const excluded = input.exclude_scope === undefined ? [] : Array.isArray(input.exclude_scope) ? input.exclude_scope : [input.exclude_scope]
    if (excluded.length > 20) throw new Error("Invalid evaluation excluded scopes")
    const args = [text(owner, "owner", 200), before, ...excluded.map(scope => text(scope, "excluded scope", 200)), take + 1]
    const rows = this.db.prepare("SELECT id,sequence FROM learning_evaluation_batches WHERE owner_session=? AND sequence<?"
      + (excluded.length ? ` AND scope_key NOT IN (${excluded.map(() => "?").join(",")})` : "") + " ORDER BY sequence DESC LIMIT ?").all(...args) as Array<{ id: string; sequence: number }>
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
    if (batch.scope_key === "evaluator-preparation/retrospective") throw new Error("Use the authorized Evaluator interpretation reader")
    this.verifyMembership(batch)
    return { items: page.items.map(member => ({ ...member, report: member.report_id ? this.reportByID(member.report_id, batch, member.key) : null })), next_after: page.next_after }
  }
  report(batchID: string, owner: string, memberKey?: string): EvaluationReport | null {
    const batch = this.row(batchID, owner), members = this.verifyMembership(batch)
    if (batch.scope_key === "evaluator-preparation/retrospective") throw new Error("Use the authorized Evaluator interpretation reader")
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
