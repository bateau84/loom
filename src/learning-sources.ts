import { canonical, digest, ProcessingBudget, PROCESSING_LIMITS, uid } from "./model.js"
import type { SQL, Store } from "./store.js"
import type { EvaluationMember, EvaluationSourceRef } from "./evaluation-store.js"

export type LearningSource = { ref: EvaluationSourceRef; value: Record<string, unknown>; sequence: number }
export const SOURCE_LIMIT = 20000
const snapshotBudget = () => new ProcessingBudget(8 * 1024 * 1024, 1000000)
const guarded = `CASE WHEN typeof(data)='text' AND octet_length(data)<=${PROCESSING_LIMITS.recordChars * 3} THEN data END AS data`

/** Read originals, never copies in the derived store. The caller supplies native read authority. */
export class LearningSources {
  constructor(private readonly store: Store, private readonly actionDB: SQL, private readonly learningDB: SQL) {}
  get namespace() { return this.store.reviews.storeID }

  /** Enumeration is queue metadata, not permission to inspect another Session's sources. */
  sessions(after = "", limit = 100): string[] {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 200) throw new Error("Invalid learning discovery limit")
    const ledger = (this.actionDB.prepare("SELECT DISTINCT session_id FROM ledger WHERE session_id>? ORDER BY session_id LIMIT ?")
      .all(after, limit) as Array<{ session_id: string }>).map(row => row.session_id)
    const objectives = (this.learningDB.prepare("SELECT DISTINCT author_session FROM learning_objectives WHERE author_session>? ORDER BY author_session LIMIT ?")
      .all(after, limit) as Array<{ author_session: string }>).map(row => row.author_session)
    const reviews = (this.actionDB.prepare("SELECT DISTINCT requester_session FROM review_requests WHERE requester_session>? ORDER BY requester_session LIMIT ?")
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
    return source && source.ref.sha256 === ref.sha256 && source.ref.revision === ref.revision ? source : null
  }

  private objectiveSource(session: string, kind: "objective" | "objective-link", id: string): LearningSource | null {
    // A file-read permission does not turn another Session's authored index into
    // this worker's source population. Both parent and link authors must match.
    const row = (kind === "objective"
      ? this.learningDB.prepare("SELECT rowid AS sequence,* FROM learning_objectives WHERE id=? AND author_session=?").get(id, session)
      : this.learningDB.prepare("SELECT l.* FROM learning_objective_links l JOIN learning_objectives o ON o.id=l.objective_id WHERE l.sequence=? AND l.author_session=? AND o.author_session=?").get(id, session, session)) as Record<string, unknown> | undefined
    if (!row) return null
    const sequence = Number(row.sequence)
    return { ref: { kind, id, session_id: session, revision: String(sequence), sha256: digest(row), required: true }, value: row, sequence }
  }

  private reviewSource(session: string, kind: "review-request" | "review-relationship", id: string): LearningSource | null {
    const row = (kind === "review-request"
      ? this.actionDB.prepare("SELECT rowid AS sequence,request_id FROM review_requests WHERE request_id=? AND requester_session=?").get(id, session)
      : this.actionDB.prepare("SELECT r.sequence,r.request_id FROM review_relationships r JOIN review_requests q ON q.request_id=r.request_id WHERE r.id=? AND q.requester_session=?").get(id, session)) as { sequence: number; request_id: string } | undefined
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
      const reviews = this.actionDB.prepare("SELECT rowid AS sequence,request_id FROM review_requests WHERE requester_session=? ORDER BY rowid LIMIT ?")
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
      return { members, boundary: { ledger: rows.at(-1)?.seq ?? 0, objectives: objectives.at(-1)?.sequence ?? 0, objective_links: linkBoundary, review_requests: reviews.at(-1)?.sequence ?? 0, review_relationships: relationshipBoundary } }
    } catch (error) { for (const db of opened.reverse()) { try { db.exec("ROLLBACK") } catch {} } throw error }
  }
}
