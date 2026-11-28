import { canonical, digest, ProcessingBudget, uid, type Actor } from "./model.js"
import type { SQL } from "./store.js"
import type { EvaluationSourceRef } from "./evaluation-store.js"
import type { LearningFrontier, LearningSources } from "./learning-sources.js"
import { parseEvaluatorAdmission } from "./evaluator-execution-contract.js"

export type EvaluationTarget = { kind: "session" | "action" | "objective"; id: string }
export type EvaluationInvocation = { session_id: string; message_id: string; call_id: string }
export type EvaluationCutoff = { kind: "point-in-time" } | { kind: "recorded-completion"; record: EvaluationSourceRef }
export type EvaluationSubjectInput = { target: EvaluationTarget; question: string;
  cutoff?: { kind: "point-in-time" } | { kind: "recorded-completion"; record_id: string } }
export type EvaluationSubjectOrigin = { kind: "native-invocation"; invocation: EvaluationInvocation }
  | { kind: "automatic-checkpoint"; method: { id: string; instruction_sha256: string }; after: LearningFrontier }
  | { kind: "explicit-selection" }
export type EvaluationSubjectProposal = {
  format: "loom-evaluation-subject/v1"; source_store_id: string; owner_session: string; established_by: Actor;
  target: EvaluationTarget; question: string; cutoff: EvaluationCutoff; through: LearningFrontier;
  /** Comparable source-namespace ceilings, distinct from Session work cursors.
   * Omitted only on older immutable subjects; their domain remains conservative. */
  namespace_frontier?: LearningFrontier;
  origin: EvaluationSubjectOrigin;
}
export type EvaluationSubject = EvaluationSubjectProposal & { subject_id: string; sha256: string; created_at: string }
export const SUBJECT_COLUMNS = Object.freeze({
  schema: ["singleton", "version"],
  subjects: ["id", "owner_session", "source_store_id", "data_json", "sha256"],
  activities: ["sequence", "subject_id", "session_id", "message_id", "call_id", "data_json", "sha256"],
  descendants: ["session_id", "parent_session_id", "data_json", "sha256"],
})
const phases = ["preparation", "evidence-retrieval", "research", "evaluation", "publication", "review"] as const
export type EvaluationActivityPhase = typeof phases[number]
export type EvaluationActivityInput = { subject_id?: string; actor: Actor; invocation?: EvaluationInvocation;
  phase: EvaluationActivityPhase; outcome: "started" | "succeeded" | "failed" | "denied" | "cancelled";
  returned_bytes?: number; elapsed_ms?: number; detail?: string }
export type EvaluationDescendant = { kind: "native-invocation-descendant"; parent: EvaluationInvocation; child_session_id: string; native_parent_session_id: string }
  | { kind: "native-session-descendant"; parent: null; child_session_id: string; native_parent_session_id: string }
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value)
const bounded = (value: unknown, name: string, max = 8000) => {
  if (typeof value !== "string" || !value.trim() || value.length > max || /[\u0000-\u001f]/.test(value)) throw new Error(`Invalid evaluation ${name}`)
  return value
}
const hash = (value: unknown) => {
  if (typeof value !== "string" || !/^[a-f0-9]{64}$/.test(value)) throw new Error("Invalid evaluation fingerprint")
  return value
}
const number = (value: unknown) => {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) throw new Error("Invalid evaluation boundary")
  return value
}
export function evaluationTarget(value: unknown): EvaluationTarget {
  if (!object(value) || Object.keys(value).sort().join() !== "id,kind" || !["session", "action", "objective"].includes(String(value.kind)))
    throw new Error("Invalid evaluation target")
  return { kind: value.kind as EvaluationTarget["kind"], id: uid(value.id, "evaluation target") }
}
export function evaluationFrontier(value: unknown): LearningFrontier {
  if (!object(value) || Object.keys(value).sort().join() !== "ledger,objective_links,objectives,review_relationships,review_requests")
    throw new Error("Invalid evaluation frontier")
  return { ledger: number(value.ledger), objectives: number(value.objectives), objective_links: number(value.objective_links),
    review_requests: number(value.review_requests), review_relationships: number(value.review_relationships) }
}
function invocation(value: EvaluationInvocation): EvaluationInvocation {
  if (!object(value) || Object.keys(value).sort().join() !== "call_id,message_id,session_id") throw new Error("Invalid evaluation invocation")
  return { session_id: uid(value.session_id), message_id: uid(value.message_id), call_id: uid(value.call_id) }
}
export function parseEvaluationSubject(input: unknown): EvaluationSubject {
  if (!object(input) || Object.keys(input).filter(key => key !== "namespace_frontier").sort().join() !== "created_at,cutoff,established_by,format,origin,owner_session,question,sha256,source_store_id,subject_id,target,through"
    || input.format !== "loom-evaluation-subject/v1" || !object(input.established_by)
    || Object.keys(input.established_by).sort().join() !== "agent,session_id" || !object(input.origin) || !object(input.cutoff))
    throw new Error("Invalid evaluation subject")
  const owner = uid(input.owner_session), target = evaluationTarget(input.target), through = evaluationFrontier(input.through)
  const namespace = input.namespace_frontier === undefined ? undefined : evaluationFrontier(input.namespace_frontier)
  if (namespace && (Object.keys(through) as Array<keyof LearningFrontier>).some(key => through[key] > namespace[key]))
    throw new Error("Evaluation subject exceeds namespace frontier")
  if (namespace && target.kind !== "session" && canonical(namespace) !== canonical(through)) throw new Error("Evaluation subject namespace domain mismatch")
  const author = { session_id: uid(input.established_by.session_id), agent: bounded(input.established_by.agent, "author", 200) }
  if (author.session_id !== owner) throw new Error("Evaluation subject author mismatch")
  let origin: EvaluationSubjectOrigin, cutoff: EvaluationCutoff
  if (input.origin.kind === "explicit-selection" && Object.keys(input.origin).join() === "kind") origin = { kind: "explicit-selection" }
  else if (input.origin.kind === "native-invocation" && Object.keys(input.origin).sort().join() === "invocation,kind" && object(input.origin.invocation)) {
    const call = invocation(input.origin.invocation as EvaluationInvocation)
    if (call.session_id !== owner) throw new Error("Evaluation subject origin mismatch")
    origin = { kind: "native-invocation", invocation: call }
  } else if (input.origin.kind === "automatic-checkpoint" && Object.keys(input.origin).sort().join() === "after,kind,method"
    && object(input.origin.method) && Object.keys(input.origin.method).sort().join() === "id,instruction_sha256") {
    const after = evaluationFrontier(input.origin.after)
    if (target.kind !== "session" || target.id !== owner || (Object.keys(after) as Array<keyof LearningFrontier>).some(key => after[key] > through[key]))
      throw new Error("Evaluation checkpoint subject mismatch")
    origin = { kind: "automatic-checkpoint", after, method: { id: bounded(input.origin.method.id, "method", 200), instruction_sha256: hash(input.origin.method.instruction_sha256) } }
  } else throw new Error("Invalid evaluation subject origin")
  if (input.cutoff.kind === "point-in-time" && Object.keys(input.cutoff).join() === "kind") cutoff = { kind: "point-in-time" }
  else if (input.cutoff.kind === "recorded-completion" && Object.keys(input.cutoff).sort().join() === "kind,record" && object(input.cutoff.record)) {
    const ref = input.cutoff.record
    if (Object.keys(ref).sort().join() !== "id,kind,required,revision,session_id,sha256" || ref.kind !== "ledger-record" || ref.required !== true
      || typeof ref.revision !== "string" || !/^[1-9][0-9]*$/.test(ref.revision) || Number(ref.revision) !== through.ledger)
      throw new Error("Invalid evaluation completion original")
    cutoff = { kind: "recorded-completion", record: { kind: "ledger-record", id: uid(ref.id), session_id: uid(ref.session_id), required: true,
      revision: ref.revision, sha256: hash(ref.sha256) } }
    if (target.kind === "session" && target.id !== cutoff.record.session_id) throw new Error("Evaluation completion Session mismatch")
  } else throw new Error("Invalid evaluation subject cutoff")
  if (namespace && cutoff.kind === "recorded-completion" && namespace.ledger !== through.ledger)
    throw new Error("Evaluation namespace exceeds recorded completion")
  const proposal: EvaluationSubjectProposal = { format: "loom-evaluation-subject/v1", source_store_id: uid(input.source_store_id), owner_session: owner,
    established_by: author, target, question: bounded(input.question, "question"), cutoff, through, origin,
    ...(namespace ? { namespace_frontier: namespace } : {}) }
  const subject_id = uid(input.subject_id), created_at = bounded(input.created_at, "creation time", 64)
  if (!Number.isFinite(Date.parse(created_at)) || subject_id !== "subject-" + digest(proposal)) throw new Error("Evaluation subject identity mismatch")
  const value = { ...proposal, subject_id, created_at }, sha256 = hash(input.sha256)
  if (sha256 !== digest(value)) throw new Error("Evaluation subject integrity mismatch")
  return { ...value, sha256 }
}
function exists(db: SQL, name: string) { return !!db.prepare("SELECT 1 FROM sqlite_schema WHERE type='table' AND name=?").get(name) }
function stored(value: unknown, expected: string): Record<string, unknown> {
  if (typeof value !== "string" || value.length > 32768) throw new Error("Evaluation activity is unavailable")
  const parsed: unknown = JSON.parse(value)
  if (!object(parsed) || digest(parsed) !== expected) throw new Error("Evaluation activity integrity mismatch")
  return parsed
}

/** Trusted, existing admission identity. A role name is never a purpose signal. */
function admittedSession(db: SQL, session: string): boolean {
  if (!exists(db, "learning_execution_admissions")) return false
  const rows = db.prepare(`SELECT data_json,sha256 FROM learning_execution_admissions
    WHERE json_valid(data_json) AND json_extract(data_json,'$.grant.recipient.session_id')=? LIMIT 2`).all(session) as Array<{ data_json: string; sha256: string }>
  for (const row of rows) {
    const admission = parseEvaluatorAdmission(stored(row.data_json, row.sha256))
    if (admission.grant.recipient.session_id === session) return true
  }
  return false
}
export function evaluationInvocationActivity(db: SQL, input: EvaluationInvocation): boolean {
  const call = invocation(input)
  if (exists(db, "learning_subject_subjects")) {
    const boundary = db.prepare(`SELECT data_json,sha256 FROM learning_subject_subjects
      WHERE json_extract(data_json,'$.origin.kind')='native-invocation'
        AND json_extract(data_json,'$.origin.invocation.session_id')=?
        AND json_extract(data_json,'$.origin.invocation.message_id')=?
        AND json_extract(data_json,'$.origin.invocation.call_id')=? LIMIT 1`).get(call.session_id, call.message_id, call.call_id) as { data_json: string; sha256: string } | undefined
    if (boundary) {
      const value = stored(boundary.data_json, boundary.sha256)
      if (!object(value.origin) || value.origin.kind !== "native-invocation" || canonical(value.origin.invocation) !== canonical(call)) throw new Error("Evaluation origin integrity mismatch")
      return true
    }
  }
  if (!exists(db, "learning_subject_activities")) return false
  const row = db.prepare(`SELECT data_json,sha256 FROM learning_subject_activities
    WHERE session_id=? AND message_id=? AND call_id=? ORDER BY sequence LIMIT 1`).get(call.session_id, call.message_id, call.call_id) as { data_json: string; sha256: string } | undefined
  if (!row) return false
  const value = stored(row.data_json, row.sha256)
  if (canonical(value.invocation) !== canonical(call) || !phases.includes(value.phase as EvaluationActivityPhase))
    throw new Error("Evaluation invocation integrity mismatch")
  return true
}
export function evaluationSessionActivity(db: SQL, session: string, seen = new Set<string>()): boolean {
  uid(session)
  if (admittedSession(db, session)) return true
  if (!exists(db, "learning_subject_descendants")) return false
  if (seen.has(session) || seen.size >= 64) throw new Error("Evaluation ancestry unavailable")
  seen.add(session)
  const row = db.prepare("SELECT parent_session_id,data_json,sha256 FROM learning_subject_descendants WHERE session_id=?")
    .get(session) as { parent_session_id: string; data_json: string; sha256: string } | undefined
  if (!row) return false
  const value = stored(row.data_json, row.sha256)
  if (value.child_session_id !== session || value.native_parent_session_id !== row.parent_session_id)
    throw new Error("Evaluation descendant integrity mismatch")
  if (value.kind === "native-session-descendant" && value.parent === null)
    return evaluationSessionActivity(db, row.parent_session_id, seen)
  if (value.kind !== "native-invocation-descendant" || !object(value.parent)) throw new Error("Evaluation descendant provenance unavailable")
  const parent = invocation(value.parent as EvaluationInvocation)
  if (parent.session_id !== row.parent_session_id) throw new Error("Evaluation descendant parent mismatch")
  return evaluationInvocationActivity(db, parent) || evaluationSessionActivity(db, parent.session_id, seen)
}

/** Immutable boundaries and bounded activity audit in the existing EvaluationStore
 * database. Construction and proposal reads perform no writes. Native ancestry
 * is supplied only by the trusted host integration, never by agent-name inference. */
export class EvaluationSubjects {
  constructor(private readonly db: SQL, private readonly sources: LearningSources, private readonly clock: () => number = Date.now) {}

  private schema(create: boolean): boolean {
    const rows = this.db.prepare("SELECT name FROM sqlite_schema WHERE type='table' AND name GLOB 'learning_subject_*'").all() as Array<{ name: string }>
    if (!rows.length) {
      if (!create) return false
      this.db.exec(`
        CREATE TABLE learning_subject_schema(singleton INTEGER PRIMARY KEY CHECK(singleton=1),version INTEGER NOT NULL CHECK(version=1));
        CREATE TABLE learning_subject_subjects(id TEXT PRIMARY KEY,owner_session TEXT NOT NULL,source_store_id TEXT NOT NULL,data_json TEXT NOT NULL,sha256 TEXT NOT NULL);
        CREATE INDEX learning_subject_origin ON learning_subject_subjects(json_extract(data_json,'$.origin.invocation.session_id'),json_extract(data_json,'$.origin.invocation.message_id'),json_extract(data_json,'$.origin.invocation.call_id'));
        CREATE TABLE learning_subject_activities(sequence INTEGER PRIMARY KEY AUTOINCREMENT,subject_id TEXT,session_id TEXT NOT NULL,message_id TEXT,call_id TEXT,data_json TEXT NOT NULL,sha256 TEXT NOT NULL);
        CREATE INDEX learning_subject_invocation ON learning_subject_activities(session_id,message_id,call_id);
        CREATE INDEX learning_subject_audit ON learning_subject_activities(subject_id,sequence);
        CREATE TABLE learning_subject_descendants(session_id TEXT PRIMARY KEY,parent_session_id TEXT NOT NULL,data_json TEXT NOT NULL,sha256 TEXT NOT NULL);
        INSERT INTO learning_subject_schema VALUES(1,1);
      `)
      return true
    }
    for (const [table, required] of Object.entries(SUBJECT_COLUMNS)) {
      const columns = this.db.prepare(`PRAGMA table_info(learning_subject_${table})`).all() as Array<{ name: string }>
      if (required.some(name => !columns.some(column => column.name === name))) throw new Error("Evaluation subject schema incomplete")
    }
    const versions = this.db.prepare("SELECT singleton,version FROM learning_subject_schema").all() as Array<{ singleton: number; version: number }>
    if (versions.length !== 1 || versions[0]?.singleton !== 1 || versions[0]?.version !== 1) throw new Error("Unsupported evaluation subject schema")
    return true
  }

  propose(actor: Actor, input: EvaluationSubjectInput, origin?: EvaluationInvocation): EvaluationSubjectProposal {
    const target = evaluationTarget(input.target), captured = this.sources.captureNamespaceFrontier(), through = this.sources.targetFrontier(target, captured)
    let cutoff: EvaluationCutoff = { kind: "point-in-time" }
    if (input.cutoff?.kind === "recorded-completion") {
      const source = this.sources.recordedCompletion(target, uid(input.cutoff.record_id))
      through.ledger = source.sequence
      cutoff = { kind: "recorded-completion", record: source.ref }
    } else if (input.cutoff !== undefined && input.cutoff.kind !== "point-in-time") throw new Error("Invalid evaluation cutoff")
    const author = { session_id: uid(actor.session_id), agent: bounded(actor.agent, "author", 200) }
    if (origin && origin.session_id !== author.session_id) throw new Error("Evaluation invocation actor mismatch")
    const namespace = target.kind === "session" ? this.sources.namespaceThrough(target.id, through,
      { ...captured, ...(cutoff.kind === "recorded-completion" ? { ledger: through.ledger } : {}) }) : { ...through }
    return { format: "loom-evaluation-subject/v1", source_store_id: this.sources.namespace, owner_session: author.session_id,
      established_by: author, target, question: bounded(input.question, "question"), cutoff, through, namespace_frontier: namespace,
      origin: origin ? { kind: "native-invocation", invocation: invocation(origin) } : { kind: "explicit-selection" } }
  }

  private save(proposal: EvaluationSubjectProposal): EvaluationSubject {
    const subject_id = "subject-" + digest(proposal)
    this.db.exec("BEGIN IMMEDIATE")
    try {
      this.schema(true)
      const existing = this.db.prepare("SELECT 1 FROM learning_subject_subjects WHERE id=?").get(subject_id)
      if (!existing) {
        const value = { ...proposal, subject_id, created_at: new Date(this.clock()).toISOString() }, sha256 = digest(value)
        this.db.prepare("INSERT INTO learning_subject_subjects VALUES(?,?,?,?,?)").run(subject_id, proposal.owner_session, proposal.source_store_id, canonical(value), sha256)
      }
      const saved = this.read(subject_id, proposal.owner_session)
      const { subject_id: _id, sha256: _sha, created_at: _time, ...actual } = saved
      if (canonical(actual) !== canonical(proposal)) throw new Error("Evaluation subject immutable identity conflict")
      this.db.exec("COMMIT")
      return saved
    } catch (error) { this.db.exec("ROLLBACK"); throw error }
  }

  establish(actor: Actor, input: EvaluationSubjectInput, origin?: EvaluationInvocation): EvaluationSubject {
    return this.save(this.propose(actor, input, origin))
  }

  establishAutomatic(session: string, method: { id: string; instruction_sha256: string }, after: LearningFrontier, through?: LearningFrontier,
    namespaceFrontier?: LearningFrontier): EvaluationSubject {
    uid(session, "learning Session")
    const current = this.sources.captureFrontier(session)
    const processed = through === undefined ? current : evaluationFrontier(through)
    const currentNamespace = this.sources.captureNamespaceFrontier()
    const captured = namespaceFrontier === undefined ? currentNamespace : evaluationFrontier(namespaceFrontier)
    for (const key of Object.keys(captured) as Array<keyof LearningFrontier>)
      if (captured[key] > currentNamespace[key]) throw new Error("Pinned namespace exceeds current source frontier")
    const namespace = this.sources.namespaceThrough(session, processed, captured)
    if (namespaceFrontier !== undefined && canonical(namespace) !== canonical(captured))
      throw new Error("Pinned namespace frontier includes unprocessed Session evidence")
    const proposal: EvaluationSubjectProposal = { format: "loom-evaluation-subject/v1", source_store_id: this.sources.namespace, owner_session: session,
      established_by: { session_id: session, agent: "automatic-learning" }, target: { kind: "session", id: session },
      question: "Describe new eligible engineering evidence while retaining unresolved earlier work.", cutoff: { kind: "point-in-time" },
      through: processed, namespace_frontier: namespace,
      origin: { kind: "automatic-checkpoint", method: { id: bounded(method.id, "method", 200), instruction_sha256: hash(method.instruction_sha256) },
        after: evaluationFrontier(after) } }
    for (const key of Object.keys(after) as Array<keyof LearningFrontier>)
      if (after[key] > proposal.through[key] || proposal.through[key] > current[key]) throw new Error("Evaluation checkpoint exceeds source frontier")
    return this.save(proposal)
  }

  read(id: string, owner: string, expectedSHA?: string): EvaluationSubject {
    uid(id); uid(owner)
    if (!this.schema(false)) throw new Error("Evaluation subject unavailable")
    const row = this.db.prepare("SELECT owner_session,source_store_id,data_json,sha256 FROM learning_subject_subjects WHERE id=? AND owner_session=?")
      .get(id, owner) as { owner_session: string; source_store_id: string; data_json: string; sha256: string } | undefined
    if (!row || row.source_store_id !== this.sources.namespace) throw new Error("Evaluation subject unavailable")
    const value = stored(row.data_json, row.sha256) as unknown as Omit<EvaluationSubject, "sha256">
    if (expectedSHA !== undefined && hash(expectedSHA) !== row.sha256 || value.subject_id !== id || value.owner_session !== owner
      || value.source_store_id !== row.source_store_id || value.format !== "loom-evaluation-subject/v1" || !Number.isFinite(Date.parse(value.created_at)))
      throw new Error("Evaluation subject integrity mismatch")
    evaluationTarget(value.target); evaluationFrontier(value.through)
    const { subject_id: _id, created_at: _time, ...proposal } = value
    if ("subject-" + digest(proposal) !== id) throw new Error("Evaluation subject identity mismatch")
    return parseEvaluationSubject({ ...value, sha256: row.sha256 })
  }

  recordActivity(input: EvaluationActivityInput): number {
    const actor = { session_id: uid(input.actor.session_id), agent: bounded(input.actor.agent, "actor", 200) }
    const call = input.invocation ? invocation(input.invocation) : null
    if (call && call.session_id !== actor.session_id || !phases.includes(input.phase)
      || !["started", "succeeded", "failed", "denied", "cancelled"].includes(input.outcome)) throw new Error("Invalid evaluation activity")
    if (input.subject_id) this.read(input.subject_id, actor.session_id)
    const value = { actor, subject_id: input.subject_id ?? null, invocation: call, phase: input.phase, outcome: input.outcome,
      returned_bytes: input.returned_bytes === undefined ? null : number(input.returned_bytes),
      elapsed_ms: input.elapsed_ms === undefined ? null : number(input.elapsed_ms),
      detail: input.detail === undefined ? null : bounded(input.detail, "activity detail", 2000), recorded_at: new Date(this.clock()).toISOString() }
    this.schema(true)
    this.db.prepare("INSERT INTO learning_subject_activities(subject_id,session_id,message_id,call_id,data_json,sha256) VALUES(?,?,?,?,?,?)")
      .run(input.subject_id ?? null, actor.session_id, call?.message_id ?? null, call?.call_id ?? null, canonical(value), digest(value))
    return (this.db.prepare("SELECT last_insert_rowid() AS id").get() as { id: number }).id
  }

  /** Call only after a trusted native event establishes the child's actual parent.
   * The asserted parent must already be an admitted learning Session or an exact
   * audited learning invocation. Shared agent names do not establish ancestry. */
  registerDescendant(input: { parent: EvaluationInvocation; child_session_id: string; native_parent_session_id: string }): void {
    const parent = invocation(input.parent), child = uid(input.child_session_id), nativeParent = uid(input.native_parent_session_id)
    if (parent.session_id !== nativeParent || child === nativeParent
      || !evaluationInvocationActivity(this.db, parent) && !evaluationSessionActivity(this.db, nativeParent)) throw new Error("Learning descendant parent is unestablished")
    const value: EvaluationDescendant = { kind: "native-invocation-descendant", parent, child_session_id: child, native_parent_session_id: nativeParent }
    this.saveDescendant(value)
  }

  registerSessionDescendant(input: { child_session_id: string; native_parent_session_id: string }): void {
    const child = uid(input.child_session_id), parent = uid(input.native_parent_session_id)
    if (child === parent || !evaluationSessionActivity(this.db, parent)) throw new Error("Learning descendant parent is unestablished")
    this.saveDescendant({ kind: "native-session-descendant", parent: null, child_session_id: child, native_parent_session_id: parent })
  }

  private saveDescendant(value: EvaluationDescendant): void {
    const child = value.child_session_id, nativeParent = value.native_parent_session_id
    this.schema(true)
    const row = this.db.prepare("SELECT data_json,sha256 FROM learning_subject_descendants WHERE session_id=?").get(child) as { data_json: string; sha256: string } | undefined
    if (row) {
      if (canonical(stored(row.data_json, row.sha256)) !== canonical(value)) throw new Error("Learning descendant immutable parent conflict")
      return
    }
    this.db.prepare("INSERT INTO learning_subject_descendants VALUES(?,?,?,?)").run(child, nativeParent, canonical(value), digest(value))
  }

  activities(id: string, owner: string, input: { after?: number; limit?: number } = {}) {
    const subject = this.read(id, owner), after = number(input.after ?? 0), limit = number(input.limit ?? 20)
    if (limit < 1 || limit > 50) throw new Error("Invalid evaluation audit page")
    const rows = this.db.prepare("SELECT sequence,data_json,sha256 FROM learning_subject_activities WHERE subject_id=? AND sequence>? ORDER BY sequence LIMIT ?")
      .all(id, after, limit + 1) as Array<{ sequence: number; data_json: string; sha256: string }>
    const budget = new ProcessingBudget(180000), items = rows.slice(0, limit).map(row => {
      budget.take(row.data_json.length); return { sequence: row.sequence, ...stored(row.data_json, row.sha256) }
    })
    const next = rows.length > limit ? items.at(-1)!.sequence : null
    const request = { operation: "subject-activities", subject_id: id, subject_sha256: subject.sha256, limit }
    return { subject_id: id, subject_sha256: subject.sha256, items, next_after: next,
      navigation: { repeat: { ...request, after }, next: next === null ? null : { ...request, after: next } },
      qualification: "Learning activity is audit material outside the original engineering subject. Missing native provenance remains unknown." }
  }
}
