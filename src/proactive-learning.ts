import { createHash } from "node:crypto"
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

const sha = (s: string) => createHash("sha256").update(s).digest("hex")
const earliest = (end: number) => new Date(end - 90 * 86400000).toISOString()
const description = {
  "recurring-correction": {
    interpretation: "At least three source-linked objectives record corrective redispatch; this is an investigation opportunity, not three independent failures or proof of one cause.",
    next_action: "Ask Evaluator to inspect the original objectives, failed verification, successful corrections and protected decisions before proposing changes.",
  },
  "retained-practice": {
    interpretation: "At least three objectives share one exact observed instruction fingerprint and have authored passes without documented correction. This is a positive association, not evidence of causal improvement.",
    next_action: "Ask Evaluator to inspect original outcomes and effective safeguards; retaining the existing practice may be preferable to changing it.",
  },
} as const

/** Bounded, append-only notice history. Objective evidence remains in its
 * original project-local databases and is never copied into prompt text. */
export class ProactiveLearning {
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

  /** Called only at an explicitly linked final outcome boundary, and only
   * when automatic capture is enabled. A single objective never emits a trend.
   * Failure to analyze does not roll back the already-authored objective. */
  consider(now = new Date().toISOString()): Notice[] {
    const end = Date.parse(now)
    if (!Number.isFinite(end)) throw new Error("Invalid reporting clock")
    const start = earliest(end)
    const count = this.db.prepare("SELECT COUNT(*) AS n FROM learning_objectives").get() as { n: number }
    if (count.n < 3) return [] // Avoid invoking trend reconstruction for an anecdote.
    const compared = this.trends.compare({
      operation: "compare", population: "all-linked",
      since_at: start, until_at: now, as_of_at: now,
      group_by: "instruction-fingerprint", limit: 20,
    })
    if (compared.population.eligible_objectives < 3) return []
    const candidates: Array<{ kind: Kind; group: string; count: number;
      sources: Source[] }> = []
    const rows = compared.items
    const refs = (selected: typeof rows) => selected.slice(0, 8).map(point => ({
      objective_id: point.objective_id,
      source_type: point.origin.source_type,
      source_id: point.origin.source_id,
    }))
    const correction = compared.metrics.with_documented_correction
    const corrected = rows.filter(point => point.metrics.with_documented_correction > 0)
    if (correction >= 3 && corrected.length >= 3)
      candidates.push({ kind: "recurring-correction", group: "all-explicit-objectives",
        count: correction, sources: refs(corrected) })
    for (const group of compared.groups) {
      if (group.key === "not-observed" || group.key === "multiple-observations") continue
      const positive = group.metrics.reported_pass_without_correction
      if (positive < 3 || group.metrics.unknown_or_incomplete > 0 ||
          group.metrics.with_documented_correction > 0) continue
      const selected = rows.filter(point => point.dimensions.instruction_fingerprint === group.key &&
        point.metrics.reported_pass_without_correction > 0)
      if (selected.length < 3) continue // No source-linked examples: never fabricate them.
      candidates.push({ kind: "retained-practice", group: group.key,
        count: positive, sources: refs(selected) })
    }
    const result: Notice[] = []
    for (const candidate of candidates.slice(0, 3)) {
      // Immutable source identities plus a three-objective milestone. Repeated
      // scrutiny of unchanged evidence cannot keep notifying the operator.
      const signature = sha(JSON.stringify([candidate.kind,candidate.group,
        Math.floor(candidate.count / 3),candidate.sources.slice(0,3).map(x => x.objective_id)]))
      if (this.db.prepare("SELECT 1 FROM learning_findings WHERE signature=?").get(signature)) continue
      const existing = this.db.prepare("SELECT COUNT(*) AS n FROM learning_findings").get() as { n: number }
      if (existing.n >= 2048) break // bounded memory, preserve older records
      const message = description[candidate.kind]
      const notice: Notice = {
        signature,kind:candidate.kind,group_key:candidate.group,created_at:now,
        since_at:start,until_at:now,
        population:compared.population.eligible_objectives,
        matching_objectives:candidate.count,source_refs:candidate.sources,
        interpretation:message.interpretation,next_action:message.next_action,
        uncertainty:"Authored outcomes are not host-certified correctness; linked objective IDs may still share causes. Model, host, task and observer mix are incomplete. Correlation does not establish causation.",
      }
      const write = this.db.prepare(`INSERT OR IGNORE INTO learning_findings
        (signature,kind,group_key,created_at,since_at,until_at,population,
         matching_objectives,source_refs,interpretation,next_action,uncertainty)
        VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`).run(
        notice.signature,notice.kind,notice.group_key,notice.created_at,
        notice.since_at,notice.until_at,notice.population,notice.matching_objectives,
        JSON.stringify(notice.source_refs),notice.interpretation,notice.next_action,
        notice.uncertainty,
      ) as { changes: number }
      // Concurrent objective completions can race after the lookup. Emit only
      // the winning INSERT; the other process observes an unchanged finding.
      if (write.changes === 1) result.push(notice)
    }
    return result
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
      interpretation: "Observational, source-linked prompts for Evaluator; never approval or automatic instruction promotion.",
      retention: "Append-only bounded to 2048 deduplicated findings per project; oldest findings are preserved.",
    }
  }
}
