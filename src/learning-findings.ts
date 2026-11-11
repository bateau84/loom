import type { SQL } from "./store.js"
import type { ObjectiveTrends } from "./objective-trends.js"

// Deterministic, evidence-linked prompts to investigate, never model verdicts.
// No scheduler, model requests, native instruction writes, or global promotion.
type Kind = "recurring-correction" | "retained-practice"
type Source = { objective_id: string; source_type: string; source_id: string }
type Notice = {
  signature: string; kind: Kind; group_key: string
  created_at: string; since_at: string; until_at: string
  population: number; matching_objectives: number
  source_refs: Source[]; interpretation: string; next_action: string
  uncertainty: string
}
type Row = Omit<Notice, "source_refs"> & { source_refs: string }

/** Read-only access to historical findings. No outcome hook, analysis,
 * new notice generation or instruction mutation is registered. */
export class HistoricalFindings {
  constructor(private db: SQL, private trends: ObjectiveTrends) {
    db.exec(`CREATE TABLE IF NOT EXISTS learning_findings (
      signature TEXT PRIMARY KEY, kind TEXT NOT NULL, group_key TEXT NOT NULL,
      created_at TEXT NOT NULL, since_at TEXT NOT NULL, until_at TEXT NOT NULL,
      population INTEGER NOT NULL, matching_objectives INTEGER NOT NULL,
      source_refs TEXT NOT NULL, interpretation TEXT NOT NULL,
      next_action TEXT NOT NULL, uncertainty TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS learning_findings_recent ON learning_findings(created_at DESC,signature);`)
  }

  /** Keyset cursor with an insertion high-water mark, not an unstable offset.
   * Concurrent appended findings are excluded from the original report page set. */
  list(limit = 20, cursor?: string) {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 20)
      throw new Error("Findings limit must be 1–20")
    const highWater = (this.db.prepare("SELECT COALESCE(MAX(rowid),0) AS n FROM learning_findings")
      .get() as { n: number }).n
    let high = highWater, at: string | undefined, id: string | undefined
    if (cursor !== undefined) {
      if (typeof cursor !== "string" || cursor.length > 512 || !/^[a-zA-Z0-9_-]+$/.test(cursor))
        throw new Error("Invalid findings cursor")
      let decoded: unknown
      try { decoded = JSON.parse(Buffer.from(cursor,"base64url").toString("utf8")) }
      catch { throw new Error("Invalid findings cursor") }
      if (!decoded || typeof decoded !== "object" || Array.isArray(decoded))
        throw new Error("Invalid findings cursor")
      const pos = decoded as { v?: unknown; max?: unknown; at?: unknown; id?: unknown }
      if (pos.v !== 1 || !Number.isSafeInteger(pos.max) ||
          (pos.max as number) < 0 || (pos.max as number) > highWater ||
          typeof pos.at !== "string" || !Number.isFinite(Date.parse(pos.at)) ||
          typeof pos.id !== "string" || !/^[0-9a-f]{64}$/.test(pos.id) ||
          Object.keys(pos).sort().join(",") !== "at,id,max,v")
        throw new Error("Invalid findings cursor or stale snapshot")
      high = pos.max as number
      at = pos.at; id = pos.id
    }
    const filter = at === undefined ? "" :
      " AND (created_at<? OR (created_at=? AND signature<?))"
    const args: unknown[] = [high]
    if (at !== undefined) args.push(at,at,id)
    args.push(limit+1)
    const rows = this.db.prepare(`SELECT * FROM learning_findings WHERE rowid<=?` +
      filter + ` ORDER BY created_at DESC, signature DESC LIMIT ?`).all(...args) as Row[]
    const page = rows.slice(0,limit)
    const last = page.at(-1)
    const next_cursor = rows.length > limit && last
      ? Buffer.from(JSON.stringify({ v:1,max:high,at:last.created_at,id:last.signature }))
        .toString("base64url")
      : null
    return {
      items: page.map(row => ({ ...row, source_refs: JSON.parse(row.source_refs) as Source[] })),
      next_cursor, snapshot_max_rowid: high,
      interpretation: "Historical observational prompts only; existing notices are not independent-origin certification, approval or automatic instruction promotion.",
      independent_pattern_qualification: this.trends.originIndependenceQualification(),
      retention: "Historical findings are preserved unchanged; this release creates no new findings.",
    }
  }
}
