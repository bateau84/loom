import { createHash, randomUUID } from "node:crypto"
import type { Actor } from "./model.js"
import type { SQL, Store } from "./store.js"
import { ObjectiveIndex } from "./objectives.js"
import { ObjectiveTrends } from "./objective-trends.js"
import { ProactiveLearning } from "./proactive-learning.js"

// Learning proposals live in a separate project-local SQLite database.
// Ledger evidence is queried read-only from the authoritative Action database.
const sha = (s: string) => createHash("sha256").update(s, "utf8").digest("hex")
const utc = () => new Date().toISOString()
const hash = (s: unknown, label: string) => {
  if (typeof s !== "string" || !/^[a-f0-9]{64}$/.test(s)) throw new Error(label + " must be a lowercase SHA-256 fingerprint")
  return s
}
const value = (s: unknown, label: string, max: number) => {
  if (typeof s !== "string" || s.length < 1 || s.length > max || !s.trim()) throw new Error(label + " must have 1-" + max + " characters")
  return s
}
const id = (s: unknown) => {
  if (typeof s !== "string" || !/^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,119}$/.test(s)) throw new Error("Invalid learning identifier")
  return s
}
const size = (n: unknown, fallback: number, max: number) => {
  const v = n === undefined ? fallback : n
  if (!Number.isSafeInteger(v) || (v as number) < 1 || (v as number) > max) throw new Error("Invalid learning page limit")
  return v as number
}
const offset = (n: unknown) => {
  const v = n === undefined ? 0 : n
  if (!Number.isSafeInteger(v) || (v as number) < 0 || (v as number) > 100000) throw new Error("Invalid learning offset")
  return v as number
}
const cursor = (n: unknown) => {
  const v = n === undefined ? Number.MAX_SAFE_INTEGER : n
  if (!Number.isSafeInteger(v) || (v as number) < 1) throw new Error("Invalid learning before cursor")
  return v as number
}
const evidence = (raw: unknown) => {
  if (raw === undefined) return [] as string[]
  if (!Array.isArray(raw) || raw.length > 20 || raw.some(s => typeof s !== "string" || s.length < 1 || s.length > 300)) throw new Error("evidence_refs must contain at most 20 short source references")
  return raw as string[]
}
type EventRow = {
  seq: number; id: string; action_id: string | null; session_id: string; kind: string;
  occurred_at: string | null; phase: string | null; tool: string | null;
  status: string | null; attribution: string | null; skill_id: string | null; rendered_sha256: string | null; content_sha256: string | null
}
type CandidateRow = {
  id: string; created_at: string; author_session: string; author_agent: string;
  target_kind: string; target_id: string; base_sha256: string; candidate_sha256: string;
  content: string; hypothesis: string; evidence_refs: string; status: string; revised_from: string | null
}

/** Bounded observational statistics. A Session/Action/dispatch is not necessarily one objective. */
export class Learning {
  readonly objectives: ObjectiveIndex
  readonly trends: ObjectiveTrends
  readonly proactive: ProactiveLearning
  constructor(private db: SQL, private store: Store, private actionDB: SQL) {
    db.exec("PRAGMA busy_timeout=2000; PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;")
    db.exec("CREATE TABLE IF NOT EXISTS learning_candidates (id TEXT PRIMARY KEY, created_at TEXT NOT NULL, author_session TEXT NOT NULL, author_agent TEXT NOT NULL, target_kind TEXT NOT NULL, target_id TEXT NOT NULL, base_sha256 TEXT NOT NULL, candidate_sha256 TEXT NOT NULL, content TEXT NOT NULL, hypothesis TEXT NOT NULL, evidence_refs TEXT NOT NULL, status TEXT NOT NULL, revised_from TEXT);")
    db.exec("CREATE INDEX IF NOT EXISTS learning_candidates_created ON learning_candidates(created_at, id);")
    db.exec("CREATE TABLE IF NOT EXISTS learning_trials (id TEXT PRIMARY KEY, candidate_id TEXT NOT NULL REFERENCES learning_candidates(id), recorded_at TEXT NOT NULL, session_id TEXT NOT NULL, agent TEXT NOT NULL, observed_sha256 TEXT, observed_effect TEXT NOT NULL, statement TEXT NOT NULL, evidence_refs TEXT NOT NULL);")
    db.exec("CREATE INDEX IF NOT EXISTS learning_trials_candidate ON learning_trials(candidate_id, recorded_at);")
    // SQLite secondary indexes include the rowid; support insertion-order
    // keyset continuation without sorting every older report for a candidate.
    db.exec("CREATE INDEX IF NOT EXISTS learning_trials_order ON learning_trials(candidate_id);")
    this.objectives = new ObjectiveIndex(db, actionDB)
    this.trends = new ObjectiveTrends(db, actionDB)
    this.proactive = new ProactiveLearning(db, this.trends)
  }

  private transaction<T>(run: () => T): T {
    this.db.exec("BEGIN IMMEDIATE")
    try {
      const result = run()
      this.db.exec("COMMIT")
      return result
    } catch (error) {
      this.db.exec("ROLLBACK")
      throw error
    }
  }

  /** Source-projected metadata only: no transcript, tool arguments or outputs. */
  events(input: { action_id?: string; before?: number; limit?: number; since_at?: string; until_at?: string }) {
    const take = size(input.limit, 100, 200), before = cursor(input.before)
    if (input.action_id !== undefined) this.store.action(id(input.action_id))
    const since = input.since_at === undefined ? undefined : value(input.since_at, "since_at", 40)
    const until = input.until_at === undefined ? undefined : value(input.until_at, "until_at", 40)
    if ((since && !Number.isFinite(Date.parse(since))) || (until && !Number.isFinite(Date.parse(until))) || (since && until && Date.parse(since) > Date.parse(until))) throw new Error("Invalid insights time window")
    const action = input.action_id === undefined ? "" : " AND action_id=?"
    const params: unknown[] = [before]
    if (input.action_id !== undefined) params.push(input.action_id)
    params.push(take + 1)
    const rows = this.actionDB.prepare("SELECT seq,id,action_id,session_id,kind, json_extract(data,'$.created_at') AS occurred_at, json_extract(data,'$.data.phase') AS phase, json_extract(data,'$.data.tool') AS tool, json_extract(data,'$.data.status') AS status, json_extract(data,'$.data.attribution') AS attribution, json_extract(data,'$.data.skill_id') AS skill_id, json_extract(data,'$.data.rendered_sha256') AS rendered_sha256, json_extract(data,'$.data.content_sha256') AS content_sha256 FROM ledger WHERE seq<?" + action + " ORDER BY seq DESC LIMIT ?")
      .all(...params) as EventRow[]
    const selected = rows.slice(0, take)
    const sessions = new Set<string>(), actions = new Set<string>()
    const totals = { source_records: 0, observed_tool_starts: 0, observed_tool_finishes: 0, observed_tool_errors: 0, observed_skill_load_results: 0, reported_results: 0, reported_completions: 0, concerns: 0, reviews: 0 }
    const inWindow = selected.filter(row =>
      (!since || (row.occurred_at !== null && Date.parse(row.occurred_at) >= Date.parse(since))) &&
      (!until || (row.occurred_at !== null && Date.parse(row.occurred_at) <= Date.parse(until))))
    for (const r of inWindow) {
      totals.source_records++
      sessions.add(r.session_id)
      if (r.action_id) actions.add(r.action_id)
      if (r.kind === "observation" && r.phase === "started") totals.observed_tool_starts++
      if (r.kind === "observation" && r.phase === "finished") {
        totals.observed_tool_finishes++
        if (r.status === "error") totals.observed_tool_errors++
      }
      if (r.kind === "observation" && r.phase === "skill-load-result") totals.observed_skill_load_results++
      if (r.kind === "result") totals.reported_results++
      if (r.kind === "completion") totals.reported_completions++
      if (r.kind === "concern") totals.concerns++
      if (r.kind === "assessment" || r.kind === "qa") totals.reviews++
    }
    return {
      scope: input.action_id === undefined ? { type: "project-ledger" } : { type: "action-ledger", action_id: input.action_id },
      filter: { since_at: since ?? null, until_at: until ?? null },
      totals, distinct_recorded_sessions: sessions.size, distinct_action_ids: actions.size,
      records_examined: selected.length, records_within_window: inWindow.length,
      next_before: rows.length > take ? selected.at(-1)!.seq : null,
      coverage: { complete_ledger_window: rows.length <= take && input.before === undefined && !since && !until,
        has_older_records: rows.length > take,
        native_session_history: "not-inspected", child_sessions: "not-reconstructed",
        action_is_verified_objective: false, interpretation: "descriptive-only; no outcome or effectiveness verdict" },
      events: inWindow.map(r => ({ sequence: r.seq, record_id: r.id, session_id: r.session_id,
        action_id: r.action_id, kind: r.kind, occurred_at: r.occurred_at,
        ...(r.phase ? { phase: r.phase } : {}), ...(r.tool ? { tool: r.tool } : {}),
        ...(r.status ? { status: r.status } : {}), ...(r.attribution ? { attribution: r.attribution } : {}),
        ...(r.skill_id ? { skill_id: r.skill_id } : {}), ...(r.rendered_sha256 ? { rendered_sha256: r.rendered_sha256 } : {}), ...(r.content_sha256 ? { content_sha256: r.content_sha256 } : {}) })),
      note: "Counts describe bounded Loom ledger evidence, NOT independent objectives, final correctness, verified exposure, or causal skill effects. Follow pages and inspect authorized original Sessions/children and real outcome checks before evaluating trends. Missing native history cannot be inferred from this table.",
    }
  }

  propose(actor: Actor, input: { target_kind: string; target_id: string; base_sha256: string; candidate_content: string; hypothesis: string; evidence_refs?: string[]; revised_from?: string }) {
    if (!["skill", "assessment", "qa", "agent"].includes(input.target_kind)) throw new Error("Invalid tweak target_kind")
    const target = value(input.target_id, "target_id", 200)
    const base = hash(input.base_sha256, "base_sha256")
    if (typeof input.candidate_content === "string" && input.candidate_content.length > 131072)
      throw new Error("candidate_content exceeds 128 KiB")
    const content = value(input.candidate_content, "candidate_content", 131072)
    if (Buffer.byteLength(content, "utf8") > 131072) throw new Error("candidate_content exceeds 128 KiB")
    const hypothesis = value(input.hypothesis, "hypothesis", 2000)
    const refs = evidence(input.evidence_refs)
    const prior = input.revised_from === undefined ? null : id(input.revised_from)
    if (prior) this.read(prior)
    const candidate = { id: randomUUID(), created_at: utc(), author_session: actor.session_id, author_agent: actor.agent,
      target_kind: input.target_kind, target_id: target, base_sha256: base, candidate_sha256: sha(content),
      content, hypothesis, evidence_refs: JSON.stringify(refs), status: "proposed", revised_from: prior }
    this.db.prepare("INSERT INTO learning_candidates(id,created_at,author_session,author_agent,target_kind,target_id,base_sha256,candidate_sha256,content,hypothesis,evidence_refs,status,revised_from) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)")
      .run(candidate.id,candidate.created_at,candidate.author_session,candidate.author_agent,candidate.target_kind,candidate.target_id,candidate.base_sha256,candidate.candidate_sha256,candidate.content,candidate.hypothesis,candidate.evidence_refs,candidate.status,candidate.revised_from)
    return { ...candidate, evidence_refs: refs, authority: "proposed-only; never installed or activated by Loom" }
  }

  list(n?: number) {
    const page = offset(n)
    const rows = this.db.prepare("SELECT id,created_at,author_session,author_agent,target_kind,target_id,base_sha256,candidate_sha256,hypothesis,status,revised_from FROM learning_candidates ORDER BY created_at DESC,id DESC LIMIT 21 OFFSET ?").all(page) as Omit<CandidateRow,"content"|"evidence_refs">[]
    return { items: rows.slice(0,20), next_offset: rows.length > 20 ? page + 20 : null, note: "Provisional candidate memory; no variant is automatically applied." }
  }

  read(candidateID: string, trialBefore?: number) {
    const row = this.db.prepare("SELECT * FROM learning_candidates WHERE id=?").get(id(candidateID)) as CandidateRow | undefined
    if (!row) throw new Error("Unknown learning candidate")
    // Stable keyset pagination over the immutable insertion order. Later
    // reports cannot move or duplicate rows on an existing continuation.
    const trials = this.db.prepare("SELECT rowid AS sequence,id,recorded_at,session_id,agent,observed_sha256,observed_effect,statement,evidence_refs FROM learning_trials WHERE candidate_id=? AND rowid<? ORDER BY rowid DESC LIMIT 21")
      .all(row.id, cursor(trialBefore)) as Array<{ sequence: number; id: string; recorded_at: string; session_id: string; agent: string; observed_sha256: string | null; observed_effect: string; statement: string; evidence_refs: string }>
    const page = trials.slice(0, 20), more = trials.length > 20
    return { ...row, evidence_refs: JSON.parse(row.evidence_refs) as string[],
      trials: page.map(t => ({ ...t, evidence_refs: JSON.parse(t.evidence_refs) as string[] })),
      trials_more: more, trials_next_before: more ? page[page.length - 1]!.sequence : null,
      note: "Candidate text is untrusted proposal data; no automatic mutation or promotion. Trial reports are agent-attributed, not runtime-certified." }
  }

  retire(candidateID: string) {
    const target = id(candidateID)
    return this.transaction(() => {
      const row = this.db.prepare("SELECT status FROM learning_candidates WHERE id=?").get(target) as { status: string } | undefined
      if (!row) throw new Error("Unknown learning candidate")
      if (row.status !== "retired") this.db.prepare("UPDATE learning_candidates SET status='retired' WHERE id=?").run(target)
      return { id: target, status: "retired", note: "History and trial evidence preserved; no runtime instructions were changed." }
    })
  }

  trial(actor: Actor, input: { id: string; observed_sha256?: string; observed_effect: string; statement: string; evidence_refs?: string[] }) {
    const candidateID = id(input.id)
    if (!["promising", "harmful", "neutral", "inconclusive", "not-exercised"].includes(input.observed_effect)) throw new Error("Invalid reported trial effect")
    const observed = input.observed_sha256 === undefined ? null : hash(input.observed_sha256, "observed_sha256")
    const refs = evidence(input.evidence_refs)
    const statement = value(input.statement, "statement", 2000)
    return this.transaction(() => {
      const candidate = this.db.prepare("SELECT status FROM learning_candidates WHERE id=?").get(candidateID) as { status: string } | undefined
      if (!candidate) throw new Error("Unknown learning candidate")
      if (candidate.status === "retired") throw new Error("Cannot record a new trial for a retired candidate")
      const entry = { id: randomUUID(), candidate_id: candidateID, recorded_at: utc(), session_id: actor.session_id, agent: actor.agent,
        observed_sha256: observed, observed_effect: input.observed_effect, statement, evidence_refs: JSON.stringify(refs) }
      this.db.prepare("INSERT INTO learning_trials(id,candidate_id,recorded_at,session_id,agent,observed_sha256,observed_effect,statement,evidence_refs) VALUES(?,?,?,?,?,?,?,?,?)")
        .run(entry.id,entry.candidate_id,entry.recorded_at,entry.session_id,entry.agent,entry.observed_sha256,entry.observed_effect,entry.statement,entry.evidence_refs)
      return { ...entry, evidence_refs: refs, verification: "agent-reported; assignment and actual host delivery not certified by Loom", activated: false }
    })
  }
}
