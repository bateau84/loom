import { canonical, digest, ProcessingBudget, PROCESSING_LIMITS, uid } from "./model.js"
import type { SQL, Store } from "./store.js"
import type { EvaluationMember, EvaluationSourceRef } from "./evaluation-store.js"

export type LearningSource = { ref: EvaluationSourceRef; value: Record<string, unknown>; sequence: number }
export const SOURCE_LIMIT = 20000
const snapshotBudget = () => new ProcessingBudget(8 * 1024 * 1024, 1000000)
const guarded = `CASE WHEN typeof(data)='text' AND octet_length(data)<=${PROCESSING_LIMITS.recordChars * 3} THEN data END AS data`

/** Read originals, never copies in the derived store. The caller supplies native read authority. */
export class LearningSources {
  constructor(private readonly store: Store, private readonly actionDB: SQL) {}
  get namespace() { return this.store.reviews.storeID }

  /** Enumeration is queue metadata, not permission to inspect another Session's sources. */
  sessions(after = "", limit = 100): string[] {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 200) throw new Error("Invalid learning discovery limit")
    return (this.actionDB.prepare("SELECT DISTINCT session_id FROM ledger WHERE session_id>? ORDER BY session_id LIMIT ?")
      .all(after, limit) as Array<{ session_id: string }>).map(row => row.session_id)
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
    if (namespace !== this.namespace || !ref.session_id || ref.kind !== "ledger-record") return null
    const source = this.ledger(ref.session_id, ref.id)
    return source && source.ref.sha256 === ref.sha256 && source.ref.revision === ref.revision ? source : null
  }

  /** Freeze the entire permitted population or fail; a safety cap is never a successful prefix. */
  snapshot(session: string): { members: EvaluationMember[]; boundary: Record<string, number | string> } {
    uid(session, "learning Session")
    this.actionDB.exec("BEGIN")
    try {
      const rows = this.actionDB.prepare("SELECT id,seq FROM ledger WHERE session_id=? ORDER BY seq LIMIT ?")
        .all(session, SOURCE_LIMIT + 1) as Array<{ id: string; seq: number }>
      if (rows.length > SOURCE_LIMIT) throw new Error("Learning population exceeds processing limit; no prefix was published")
      const budget = snapshotBudget(), sources: EvaluationSourceRef[] = []
      for (const row of rows) {
        const source = this.ledger(session, row.id)
        if (!source) throw new Error("Learning source disappeared while freezing")
        canonical(source.value, budget)
        sources.push(source.ref)
      }
      const members: EvaluationMember[] = []
      for (let start = 0; start < sources.length; start += 32) {
        const selected = sources.slice(start, start + 32)
        members.push({ key: `session:${session}:${selected[0]!.revision}`, kind: "session", source_refs: selected })
      }
      this.actionDB.exec("COMMIT")
      return { members, boundary: { ledger: rows.at(-1)?.seq ?? 0 } }
    } catch (error) { try { this.actionDB.exec("ROLLBACK") } catch {} throw error }
  }
}
