import { canonical, digest, ProcessingBudget, PROCESSING_LIMITS, uid } from "./model.js"
import type { SQL, Store } from "./store.js"
import type { EvaluationMember, EvaluationSourceRef } from "./evaluation-store.js"
import { evaluationFrontier, evaluationInvocationActivity, evaluationSessionActivity, evaluationTarget, type EvaluationTarget } from "./evaluation-subject.js"

export type LearningSource = { ref: EvaluationSourceRef; value: Record<string, unknown>; sequence: number }
export type LearningFrontier = { ledger: number; objectives: number; objective_links: number; review_requests: number; review_relationships: number }
export const EMPTY_LEARNING_FRONTIER: LearningFrontier = Object.freeze({ ledger: 0, objectives: 0, objective_links: 0, review_requests: 0, review_relationships: 0 })
export const SOURCE_LIMIT = 20000
const snapshotBudget = () => new ProcessingBudget(8 * 1024 * 1024, 1000000)
const guarded = `CASE WHEN typeof(data)='text' AND octet_length(data)<=${PROCESSING_LIMITS.recordChars * 3} THEN data END AS data`
// Preparation metadata is audit material, not another engineering objective.
// Exclusion also withholds dependencies on such rows in historical reports.
const engineeringReview = (column: string) => `CASE WHEN typeof(${column})='text' AND octet_length(${column})<=${PROCESSING_LIMITS.recordChars * 3} AND json_valid(${column}) THEN json_extract(${column},'$.extensions.classification') END IS NOT 'evaluator-preparation'`

/** Read originals, never copies in the derived store. The caller supplies native read authority. */
export class LearningSources {
  constructor(private readonly store: Store, private readonly actionDB: SQL, private readonly learningDB: SQL) {}
  get namespace() { return this.store.reviews.storeID }
  isEvaluationSession(session: string): boolean { return evaluationSessionActivity(this.learningDB, uid(session)) }
  classificationBoundary(session: string): number {
    uid(session)
    const exists = (name: string) => !!this.learningDB.prepare("SELECT 1 FROM sqlite_schema WHERE type='table' AND name=?").get(name)
    const activities = exists("learning_subject_activities") ? (this.learningDB.prepare("SELECT COALESCE(MAX(sequence),0) AS n FROM learning_subject_activities WHERE session_id=? AND call_id IS NOT NULL").get(session) as { n: number }).n : 0
    const subjects = exists("learning_subject_subjects") ? (this.learningDB.prepare("SELECT COALESCE(MAX(rowid),0) AS n FROM learning_subject_subjects WHERE json_extract(data_json,'$.origin.kind')='native-invocation' AND json_extract(data_json,'$.origin.invocation.session_id')=?").get(session) as { n: number }).n : 0
    const result = activities + subjects
    if (!Number.isSafeInteger(result)) throw new Error("Evaluation activity frontier exceeds processing limit")
    return result
  }

  /** Owner maxima only; no history hydration. Each database contributes its own
   * insertion boundary. This is not a claim of an atomic cross-store timestamp. */
  captureFrontier(session: string): LearningFrontier {
    uid(session, "learning Session")
    const max = (db: SQL, sql: string) => (db.prepare(sql).get(session) as { n: number }).n
    return { ledger: max(this.actionDB, "SELECT COALESCE(MAX(seq),0) AS n FROM ledger WHERE session_id=?"),
      objectives: max(this.learningDB, "SELECT COALESCE(MAX(rowid),0) AS n FROM learning_objectives WHERE author_session=?"),
      objective_links: max(this.learningDB, "SELECT COALESCE(MAX(l.sequence),0) AS n FROM learning_objective_links l JOIN learning_objectives o ON o.id=l.objective_id WHERE l.author_session=? AND l.author_session=o.author_session"),
      review_requests: max(this.actionDB, "SELECT COALESCE(MAX(rowid),0) AS n FROM review_requests WHERE requester_session=?"),
      review_relationships: max(this.actionDB, "SELECT COALESCE(MAX(r.sequence),0) AS n FROM review_relationships r JOIN review_requests q ON q.request_id=r.request_id WHERE q.requester_session=?") }
  }

  targetFrontier(input: EvaluationTarget): LearningFrontier {
    const target = evaluationTarget(input)
    const max = (db: SQL, sql: string, ...args: unknown[]) => (db.prepare(sql).get(...args) as { n: number }).n
    let ledger: number
    if (target.kind === "session" || target.kind === "action") {
      if (target.kind === "action") this.store.action(target.id)
      ledger = max(this.actionDB, `SELECT COALESCE(MAX(seq),0) AS n FROM ledger WHERE ${target.kind}_id=?`, target.id)
    } else {
      if (!this.learningDB.prepare("SELECT 1 FROM learning_objectives WHERE id=?").get(target.id)) throw new Error("Evaluation objective unavailable")
      const rows = this.learningDB.prepare("SELECT source_id FROM learning_objective_links WHERE objective_id=? AND source_type='ledger-record' ORDER BY sequence LIMIT ?")
        .all(target.id, SOURCE_LIMIT + 1) as Array<{ source_id: string }>
      if (rows.length > SOURCE_LIMIT) throw new Error("Evaluation subject exceeds source limit")
      const ids = rows.map(row => row.source_id)
      const global = max(this.actionDB, "SELECT COALESCE(MAX(seq),0) AS n FROM ledger")
      const selected = this.store.engineeringHistory.objectiveEvidenceSources(ids, global)
      ledger = max(this.actionDB, "SELECT COALESCE(MAX(seq),0) AS n FROM ledger WHERE id IN (SELECT value FROM json_each(?))", JSON.stringify(selected))
    }
    return { ledger, objectives: max(this.learningDB, "SELECT COALESCE(MAX(rowid),0) AS n FROM learning_objectives"),
      objective_links: max(this.learningDB, "SELECT COALESCE(MAX(sequence),0) AS n FROM learning_objective_links"),
      review_requests: max(this.actionDB, "SELECT COALESCE(MAX(rowid),0) AS n FROM review_requests"),
      review_relationships: max(this.actionDB, "SELECT COALESCE(MAX(sequence),0) AS n FROM review_relationships") }
  }

  recordedCompletion(input: EvaluationTarget, id: string): LearningSource {
    const target = evaluationTarget(input), row = this.actionDB.prepare("SELECT session_id,action_id,kind FROM ledger WHERE id=?")
      .get(uid(id)) as { session_id: string; action_id: string | null; kind: string } | undefined
    if (!row || row.kind !== "completion" || target.kind === "session" && row.session_id !== target.id
      || target.kind === "action" && row.action_id !== target.id
      || target.kind === "objective" && !this.learningDB.prepare("SELECT 1 FROM learning_objective_links WHERE objective_id=? AND source_type='ledger-record' AND source_id=? LIMIT 1").get(target.id, id))
      throw new Error("Recorded completion is unavailable in the selected subject")
    const source = this.ledger(row.session_id, id)
    if (!source || this.isEvaluation(source.ref)) throw new Error("Engineering completion original unavailable")
    return source
  }

  /** Exact owner-resolved tuple only. A different call in the same message is
   * independent. A later purpose receipt invalidates an earlier derived read. */
  isEvaluation(ref: EvaluationSourceRef): boolean {
    if (!ref.session_id) return false
    if (evaluationSessionActivity(this.learningDB, ref.session_id)) return true
    if (ref.kind === "native-call" && ref.message_id)
      return evaluationInvocationActivity(this.learningDB, { session_id: ref.session_id, message_id: ref.message_id, call_id: ref.id })
    if (ref.kind !== "ledger-record") return false
    const source = this.ledger(ref.session_id, ref.id)
    if (!source || source.ref.revision !== ref.revision || source.ref.sha256 !== ref.sha256) return false
    const data = source.value.data
    if (!data || typeof data !== "object" || Array.isArray(data)) return false
    const fields = data as Record<string, unknown>
    return typeof fields.message_id === "string" && typeof fields.call_id === "string"
      ? evaluationInvocationActivity(this.learningDB, { session_id: ref.session_id, message_id: fields.message_id, call_id: fields.call_id }) : false
  }

  /** Select only new original-owner positions. At most limit owner rows are
   * examined; exclusions still advance their owner's processed position. Owner
   * interleaving prevents one busy source family from starving the others. */
  selectIncrement(session: string, afterInput: LearningFrontier, upperInput: LearningFrontier, limit = 128) {
    uid(session); const after = evaluationFrontier(afterInput), upper = evaluationFrontier(upperInput), through = { ...after }
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 1000) throw new Error("Invalid incremental source limit")
    for (const key of Object.keys(upper) as Array<keyof LearningFrontier>) if (after[key] > upper[key]) throw new Error("Increment cursor exceeds source boundary")
    type Candidate = { id: string; sequence: number; kind: string; excluded?: number }
    const queues: Record<keyof LearningFrontier, Candidate[]> = {
      ledger: this.actionDB.prepare("SELECT id,seq AS sequence,'ledger-record' AS kind FROM ledger WHERE session_id=? AND seq>? AND seq<=? ORDER BY seq LIMIT ?").all(session, after.ledger, upper.ledger, limit + 1) as Candidate[],
      objectives: this.learningDB.prepare("SELECT id,rowid AS sequence,'objective' AS kind FROM learning_objectives WHERE author_session=? AND rowid>? AND rowid<=? ORDER BY rowid LIMIT ?").all(session, after.objectives, upper.objectives, limit + 1) as Candidate[],
      objective_links: this.learningDB.prepare("SELECT CAST(l.sequence AS TEXT) AS id,l.sequence,'objective-link' AS kind FROM learning_objective_links l JOIN learning_objectives o ON o.id=l.objective_id WHERE l.author_session=? AND l.author_session=o.author_session AND l.sequence>? AND l.sequence<=? ORDER BY l.sequence LIMIT ?").all(session, after.objective_links, upper.objective_links, limit + 1) as Candidate[],
      review_requests: this.actionDB.prepare(`SELECT request_id AS id,rowid AS sequence,'review-request' AS kind,NOT (${engineeringReview("data")}) AS excluded FROM review_requests WHERE requester_session=? AND rowid>? AND rowid<=? ORDER BY rowid LIMIT ?`).all(session, after.review_requests, upper.review_requests, limit + 1) as Candidate[],
      review_relationships: this.actionDB.prepare(`SELECT r.id,r.sequence,'review-relationship' AS kind,NOT (${engineeringReview("q.data")}) AS excluded FROM review_relationships r JOIN review_requests q ON q.request_id=r.request_id WHERE q.requester_session=? AND r.sequence>? AND r.sequence<=? ORDER BY r.sequence LIMIT ?`).all(session, after.review_relationships, upper.review_relationships, limit + 1) as Candidate[],
    }
    const positions: LearningFrontier = { ...EMPTY_LEARNING_FRONTIER }, selected: EvaluationSourceRef[] = [], budget = snapshotBudget()
    let examined = 0, excluded = 0
    const keys = Object.keys(queues) as Array<keyof LearningFrontier>
    while (examined < limit) {
      let advanced = false
      for (const key of keys) {
        if (examined >= limit) break
        const candidate = queues[key][positions[key]]
        if (!candidate) continue
        positions[key]++; examined++; advanced = true; through[key] = candidate.sequence
        if (candidate.excluded || evaluationSessionActivity(this.learningDB, session)) { excluded++; continue }
        const source = candidate.kind === "ledger-record" ? this.ledger(session, candidate.id)
          : candidate.kind === "objective" || candidate.kind === "objective-link" ? this.objectiveSource(session, candidate.kind, candidate.id)
          : this.reviewSource(session, candidate.kind as "review-request" | "review-relationship", candidate.id)
        if (!source) throw new Error("Increment original unavailable")
        if (this.isEvaluation(source.ref)) { excluded++; continue }
        canonical(source.value, budget); selected.push(source.ref)
      }
      if (!advanced) break
    }
    for (const key of keys) if (positions[key] >= queues[key].length) through[key] = upper[key]
    const members: EvaluationMember[] = []
    for (let start = 0; start < selected.length; start += 32) members.push({ key: "increment:" + session + ":" + start, kind: "session", source_refs: selected.slice(start, start + 32) })
    return { members, through, upper, eligible: selected.length, excluded, examined, more: keys.some(key => through[key] < upper[key]) }
  }

  /** Enumeration is queue metadata, not permission to inspect another Session's sources. */
  sessions(after = "", limit = 100): string[] {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 200) throw new Error("Invalid learning discovery limit")
    const ledger = (this.actionDB.prepare("SELECT DISTINCT session_id FROM ledger WHERE session_id>? ORDER BY session_id LIMIT ?")
      .all(after, limit) as Array<{ session_id: string }>).map(row => row.session_id)
    const objectives = (this.learningDB.prepare("SELECT DISTINCT author_session FROM learning_objectives WHERE author_session>? ORDER BY author_session LIMIT ?")
      .all(after, limit) as Array<{ author_session: string }>).map(row => row.author_session)
    const reviews = (this.actionDB.prepare(`SELECT DISTINCT requester_session FROM review_requests WHERE requester_session>? AND ${engineeringReview("data")} ORDER BY requester_session LIMIT ?`)
      .all(after, limit) as Array<{ requester_session: string }>).map(row => row.requester_session)
    return [...new Set([...ledger, ...objectives, ...reviews])].sort().slice(0, limit)
  }

  private ledger(session: string, id: string): LearningSource | null {
    const row = this.actionDB.prepare(`SELECT seq,${guarded} FROM ledger WHERE id=? AND session_id=?`)
      .get(id, session) as { seq: number; data: string | null } | undefined
    if (!row) return null
    if (typeof row.data !== "string" || row.data.length > PROCESSING_LIMITS.recordChars) throw new Error("Learning source exceeds processing limit")
    const value = JSON.parse(row.data) as Record<string, unknown>
    if (value.id !== id || value.session_id !== session) throw new Error("Learning source identity mismatch")
    return { ref: { kind: "ledger-record", id, session_id: session, revision: String(row.seq), sha256: digest(value), required: true }, value, sequence: row.seq }
  }

  resolve(ref: EvaluationSourceRef, namespace: string): LearningSource | null {
    if (namespace !== this.namespace || !ref.session_id) return null
    const source = ref.kind === "ledger-record" ? this.ledger(ref.session_id, ref.id)
      : ref.kind === "objective" || ref.kind === "objective-link" ? this.objectiveSource(ref.session_id, ref.kind, ref.id)
      : ref.kind === "review-request" || ref.kind === "review-relationship" ? this.reviewSource(ref.session_id, ref.kind, ref.id) : null
    return source && source.ref.sha256 === ref.sha256 && source.ref.revision === ref.revision && !this.isEvaluation(ref) ? source : null
  }

  /** Original-owner lookup for an already authorized retrospective selection.
   * This is deliberately separate from Stage 3's calling-Session population.
   * It supplies bytes/identity, never permission or a recipient release grant. */
  retrospectiveOriginal(kind: string, id: string, sourceSession: string, requester: string): LearningSource | null {
    if (kind === "ledger-record") return this.ledger(sourceSession, id)
    if (kind === "review-request" || kind === "review-relationship") {
      if (sourceSession !== requester) throw new Error("Retrospective source unavailable")
      return this.reviewSource(sourceSession, kind, id)
    }
    if (kind !== "objective" && kind !== "objective-link") return null
    const row = (kind === "objective"
      ? this.learningDB.prepare("SELECT rowid AS sequence,* FROM learning_objectives WHERE id=? AND author_session=?").get(id, sourceSession)
      : this.learningDB.prepare("SELECT l.* FROM learning_objective_links l JOIN learning_objectives o ON o.id=l.objective_id WHERE l.sequence=? AND l.author_session=?").get(id, sourceSession)) as Record<string, unknown> | undefined
    if (!row) return null
    if (kind === "objective-link" && row.relation === null) delete row.relation
    const sequence = Number(row.sequence)
    if (!Number.isSafeInteger(sequence) || sequence < 1) throw new Error("Retrospective source unavailable")
    return { ref: { kind, id, session_id: sourceSession, revision: String(sequence), sha256: digest(row), required: true }, value: row, sequence }
  }

  private objectiveSource(session: string, kind: "objective" | "objective-link", id: string): LearningSource | null {
    // A file-read permission does not turn another Session's authored index into
    // this worker's source population. Both parent and link authors must match.
    const row = (kind === "objective"
      ? this.learningDB.prepare("SELECT rowid AS sequence,* FROM learning_objectives WHERE id=? AND author_session=?").get(id, session)
      : this.learningDB.prepare("SELECT l.* FROM learning_objective_links l JOIN learning_objectives o ON o.id=l.objective_id WHERE l.sequence=? AND l.author_session=? AND o.author_session=?").get(id, session, session)) as Record<string, unknown> | undefined
    if (!row) return null
    // The additive ObjectiveIndex column adds no meaning to historical links
    // when absent. Preserve their exact pre-migration canonical source bytes,
    // so a completed Stage 3 batch does not lose otherwise unchanged originals.
    // Explicit typed relations remain part of a new source's identity.
    if (kind === "objective-link" && row.relation === null) delete row.relation
    const sequence = Number(row.sequence)
    return { ref: { kind, id, session_id: session, revision: String(sequence), sha256: digest(row), required: true }, value: row, sequence }
  }

  private reviewSource(session: string, kind: "review-request" | "review-relationship", id: string): LearningSource | null {
    const row = (kind === "review-request"
      ? this.actionDB.prepare(`SELECT rowid AS sequence,request_id FROM review_requests WHERE request_id=? AND requester_session=? AND ${engineeringReview("data")}`).get(id, session)
      : this.actionDB.prepare(`SELECT r.sequence,r.request_id FROM review_relationships r JOIN review_requests q ON q.request_id=r.request_id WHERE r.id=? AND q.requester_session=? AND ${engineeringReview("q.data")}`).get(id, session)) as { sequence: number; request_id: string } | undefined
    if (!row) return null
    const value = this.store.reviews.evaluationSource({ session_id: session, agent: "learning-source-reader" }, row.request_id, kind === "review-relationship" ? id : undefined)
    return { ref: { kind, id, session_id: session, revision: String(row.sequence), sha256: digest(value, snapshotBudget()), required: true }, value, sequence: row.sequence }
  }

  /** Freeze the entire permitted population or fail; a safety cap is never a successful prefix. */
  snapshot(session: string): { members: EvaluationMember[]; boundary: Record<string, number | string> } {
    uid(session, "learning Session")
    const connections = [...new Set([this.actionDB, this.learningDB])], opened: SQL[] = []
    try {
      // Separate read snapshots form a vector boundary, not a cross-database
      // atomic snapshot. Publication and every reader revalidate original hashes.
      for (const db of connections) { db.exec("BEGIN"); opened.push(db) }
      const rows = this.actionDB.prepare("SELECT id,seq FROM ledger WHERE session_id=? ORDER BY seq LIMIT ?")
        .all(session, SOURCE_LIMIT + 1) as Array<{ id: string; seq: number }>
      if (rows.length > SOURCE_LIMIT) throw new Error("Learning population exceeds processing limit; no prefix was published")
      const budget = snapshotBudget(), sources: EvaluationSourceRef[] = [], members: EvaluationMember[] = []
      let count = 0
      const admit = (source: LearningSource | null) => {
        if (!source) throw new Error("Original learning source unavailable while freezing")
        if (++count > SOURCE_LIMIT) throw new Error("Learning population exceeds processing limit; no prefix was published")
        canonical(source.value, budget)
        return source.ref
      }
      const group = (key: string, kind: EvaluationMember["kind"], refs: EvaluationSourceRef[]) => {
        for (let start = 0; start < refs.length; start += 32) members.push({ key: key + ":" + start, kind, source_refs: refs.slice(start, start + 32) })
      }
      for (const row of rows) sources.push(admit(this.ledger(session, row.id)))
      group("session:" + session, "session", sources)
      const objectives = this.learningDB.prepare("SELECT rowid AS sequence,id FROM learning_objectives WHERE author_session=? ORDER BY rowid LIMIT ?")
        .all(session, SOURCE_LIMIT + 1) as Array<{ id: string; sequence: number }>
      let linkBoundary = 0
      for (const objective of objectives) {
        const refs = [admit(this.objectiveSource(session, "objective", objective.id))]
        const links = this.learningDB.prepare("SELECT sequence,source_type,source_id,source_session_id FROM learning_objective_links WHERE objective_id=? AND author_session=? ORDER BY sequence LIMIT ?")
          .all(objective.id, session, SOURCE_LIMIT + 1) as Array<{ sequence: number; source_type: string; source_id: string; source_session_id: string | null }>
        for (const link of links) {
          refs.push(admit(this.objectiveSource(session, "objective-link", String(link.sequence))))
          linkBoundary = Math.max(linkBoundary, link.sequence)
          if (link.source_type === "ledger-record" && link.source_session_id === session) refs.push(admit(this.ledger(session, link.source_id)))
        }
        group("objective:" + objective.id, "objective", refs)
      }
      const reviews = this.actionDB.prepare(`SELECT rowid AS sequence,request_id FROM review_requests WHERE requester_session=? AND ${engineeringReview("data")} ORDER BY rowid LIMIT ?`)
        .all(session, SOURCE_LIMIT + 1) as Array<{ request_id: string; sequence: number }>
      let relationshipBoundary = 0
      for (const review of reviews) {
        const refs = [admit(this.reviewSource(session, "review-request", review.request_id))]
        const relationships = this.actionDB.prepare("SELECT id,sequence FROM review_relationships WHERE request_id=? ORDER BY sequence LIMIT ?")
          .all(review.request_id, SOURCE_LIMIT + 1) as Array<{ id: string; sequence: number }>
        for (const relationship of relationships) {
          const source = this.reviewSource(session, "review-relationship", relationship.id)!
          refs.push(admit(source))
          refs.push(admit(this.ledger(session, String(source.value.source_record_id))))
          relationshipBoundary = Math.max(relationshipBoundary, relationship.sequence)
        }
        group("review:" + review.request_id, "session", refs)
      }
      for (const db of opened.reverse()) db.exec("COMMIT")
      const eligible = members.map(member => ({ ...member, source_refs: member.source_refs.filter(ref => !this.isEvaluation(ref)) })).filter(member => member.source_refs.length)
      return { members: eligible, boundary: { ledger: rows.at(-1)?.seq ?? 0, objectives: objectives.at(-1)?.sequence ?? 0, objective_links: linkBoundary, review_requests: reviews.at(-1)?.sequence ?? 0, review_relationships: relationshipBoundary } }
    } catch (error) { for (const db of opened.reverse()) { try { db.exec("ROLLBACK") } catch {} } throw error }
  }
}
