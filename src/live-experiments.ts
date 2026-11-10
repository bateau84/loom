import { createHash, randomUUID } from "node:crypto"
import type { Actor } from "./model.js"
import type { SQL } from "./store.js"

// Exact-host, additive instruction entries only. This is not skill/agent replacement.
// A context or model.request hook is pre-provider evidence, NOT a provider receipt.
export const LIVE_ENTRY_KEY = "loom.live-instruction.v1"
const HOST_VERSION = "2.2.6"
const sha = (text: string) => createHash("sha256").update(text, "utf8").digest("hex")
const text = (raw: unknown, name: string, max: number) => {
  if (typeof raw !== "string" || !raw.trim() || raw.length > max) throw new Error(`Invalid ${name}: expected 1-${max} characters`)
  return raw
}
const id = (raw: unknown, name: string) => {
  const value = text(raw, name, 120)
  if (!/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,119}$/.test(value)) throw new Error(`Invalid ${name}`)
  return value
}
const utc = () => new Date().toISOString()
const unwrapped = (raw: unknown): unknown =>
  raw && typeof raw === "object" && !Array.isArray(raw) && "data" in raw ? (raw as { data: unknown }).data : raw

export type ExperimentHost = {
  version: string
  agent: string
  sessionID: string
  // Returns a fresh native agent system snapshot; missing identity is not qualified.
  source: () => Promise<string>
  list: () => Promise<unknown>
  put: (value: string) => Promise<void>
  remove: () => Promise<void>
}
export type StartExperiment = {
  objective_id: string
  candidate_id: string
  authorization_ref: string
  eligibility: string
  evaluation_criteria: string
  preserved_guarantees: string
  budget_requests: number
  expires_at: string
  authorize: boolean
}

type TrialRow = {
  id: string; objective_id: string; candidate_id: string
  session_id: string; agent: string; baseline_sha256: string
  candidate_sha256: string; status: string; budget_requests: number
  preflight_count: number; context_count: number; expires_at: string
  authorization_ref: string; eligibility: string; evaluation_criteria: string
  preserved_guarantees: string; created_at: string; stopped_at: string | null
}
type CandidateRow = {
  id: string; status: string; target_kind: string; target_id: string
  base_sha256: string; candidate_sha256: string; content: string; hypothesis: string
}

/** Durable admission, model-boundary preflight and withdrawal for a single native Session.
 * Never treats missing SDK receipts, an agent report or assignment as exposure proof.
 * One trial ever per Session prevents reuse of a previously exposed Session as control. */
export class SessionExperiments {
  constructor(private db: SQL) {
    db.exec(`CREATE TABLE IF NOT EXISTS learning_live_experiments (
      id TEXT PRIMARY KEY, objective_id TEXT NOT NULL REFERENCES learning_objectives(id),
      candidate_id TEXT NOT NULL REFERENCES learning_candidates(id),
      session_id TEXT NOT NULL UNIQUE, agent TEXT NOT NULL,
      baseline_sha256 TEXT NOT NULL, candidate_sha256 TEXT NOT NULL,
      authorization_ref TEXT NOT NULL, eligibility TEXT NOT NULL,
      evaluation_criteria TEXT NOT NULL, preserved_guarantees TEXT NOT NULL,
      budget_requests INTEGER NOT NULL CHECK(budget_requests BETWEEN 1 AND 8),
      preflight_count INTEGER NOT NULL DEFAULT 0, context_count INTEGER NOT NULL DEFAULT 0,
      expires_at TEXT NOT NULL, status TEXT NOT NULL,
      created_at TEXT NOT NULL, stopped_at TEXT
    );
    CREATE INDEX IF NOT EXISTS learning_live_by_candidate ON learning_live_experiments(candidate_id,status);
    CREATE TABLE IF NOT EXISTS learning_live_events (
      seq INTEGER PRIMARY KEY AUTOINCREMENT,
      experiment_id TEXT NOT NULL REFERENCES learning_live_experiments(id),
      at TEXT NOT NULL, kind TEXT NOT NULL, detail TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS learning_live_event_order ON learning_live_events(experiment_id,seq);`)
  }

  private transaction<T>(fn: () => T): T {
    this.db.exec("BEGIN IMMEDIATE")
    try { const result = fn(); this.db.exec("COMMIT"); return result }
    catch (error) { this.db.exec("ROLLBACK"); throw error }
  }
  private row(sessionID: string) {
    return this.db.prepare("SELECT * FROM learning_live_experiments WHERE session_id=?").get(sessionID) as TrialRow | undefined
  }
  private event(trialID: string, kind: string, detail: string) {
    const count = this.db.prepare("SELECT COUNT(*) AS n FROM learning_live_events WHERE experiment_id=?")
      .get(trialID) as { n: number }
    if (count.n >= 64) throw new Error("LOOM_LIVE_EVENT_LIMIT: preserve existing history and stop the trial")
    this.db.prepare("INSERT INTO learning_live_events(experiment_id,at,kind,detail) VALUES(?,?,?,?)")
      .run(trialID, utc(), kind, detail)
  }
  private candidate(candidateID: string): CandidateRow {
    const result = this.db.prepare("SELECT id,status,target_kind,target_id,base_sha256,candidate_sha256,content,hypothesis FROM learning_candidates WHERE id=?")
      .get(id(candidateID, "candidate_id")) as CandidateRow | undefined
    if (!result) throw new Error("Unknown provisional instruction candidate")
    if (sha(result.content) !== result.candidate_sha256) throw new Error("LOOM_LIVE_CANDIDATE_DRIFT: candidate bytes changed")
    if (result.status !== "proposed") throw new Error("LOOM_LIVE_CANDIDATE_RETIRED: candidate is unavailable")
    return result
  }
  private assertHost(host: ExperimentHost, row?: TrialRow) {
    if (host.version !== HOST_VERSION) throw new Error("LOOM_LIVE_HOST_UNQUALIFIED: exact OpenCode 2.2.6 required")
    if (!host.sessionID || (row && (row.session_id !== host.sessionID || row.agent !== host.agent)))
      throw new Error("LOOM_LIVE_SCOPE_DRIFT: native Session or agent differs from enrollment")
  }
  private entries(raw: unknown): Array<{ key: string; value: unknown }> {
    const entries = unwrapped(raw)
    if (!Array.isArray(entries) || entries.length > 256 || entries.some(e => !e || typeof e !== "object" || typeof e.key !== "string"))
      throw new Error("LOOM_LIVE_ENTRY_READBACK_UNAVAILABLE: unsupported native instruction entries")
    return entries
  }
  private async ownValue(host: ExperimentHost): Promise<unknown> {
    const matches = this.entries(await host.list()).filter(e => e.key === LIVE_ENTRY_KEY)
    if (matches.length > 1) throw new Error("LOOM_LIVE_ENTRY_AMBIGUOUS: multiple keys")
    return matches.length ? matches[0]!.value : undefined
  }
  private async current(host: ExperimentHost, row: TrialRow) {
    this.assertHost(host, row)
    const candidate = this.candidate(row.candidate_id)
    if (candidate.target_kind !== "agent" || candidate.target_id !== host.agent ||
        candidate.candidate_sha256 !== row.candidate_sha256 ||
        candidate.base_sha256 !== row.baseline_sha256 ||
        sha(await host.source()) !== row.baseline_sha256)
      throw new Error("LOOM_LIVE_SOURCE_DRIFT: agent, baseline or candidate changed; no qualified request")
    return candidate
  }
  private eligibleObjective(objectiveID: string, sessionID: string) {
    const row = this.db.prepare(`SELECT 1 FROM learning_objective_links
      WHERE objective_id=? AND source_session_id=? AND source_type IN ('native-message','native-call')
        AND verification='native-context' AND confidence='supported'
        AND phase IN ('request','coordination','dispatch','continuation','corrective-dispatch') LIMIT 1`)
      .get(objectiveID, sessionID)
    if (!row) throw new Error("LOOM_LIVE_OBJECTIVE_UNBOUND: the same Session must have an explicitly linked, verified source for this objective")
  }
  /** The caller must be the enrolled native Session; no arbitrary target Session IDs. */
  async start(actor: Actor, input: StartExperiment, host: ExperimentHost, permission: () => Promise<void>) {
    if (input.authorize !== true) throw new Error("LOOM_LIVE_NOT_AUTHORIZED: explicit opt-in required")
    this.assertHost(host)
    if (actor.session_id !== host.sessionID || actor.agent !== host.agent)
      throw new Error("LOOM_LIVE_SCOPE_DRIFT: a Session can enroll only itself")
    if (/review|critic|evaluat|assess|(^|[-_])qa($|[-_])/i.test(actor.agent))
      throw new Error("LOOM_LIVE_INDEPENDENCE: independent evaluators/reviewers are excluded")
    const objective = id(input.objective_id, "objective_id")
    const eligibility = text(input.eligibility, "eligibility", 1000)
    const criteria = text(input.evaluation_criteria, "evaluation_criteria", 2000)
    const guarantees = text(input.preserved_guarantees, "preserved_guarantees", 2000)
    const authorization = text(input.authorization_ref, "authorization_ref", 300)
    if (!Number.isSafeInteger(input.budget_requests) || input.budget_requests < 1 || input.budget_requests > 8)
      throw new Error("LOOM_LIVE_BUDGET_INVALID: 1-8 primary native requests required")
    const expiry = Date.parse(input.expires_at)
    if (!Number.isFinite(expiry) || expiry <= Date.now() || expiry > Date.now() + 3600000)
      throw new Error("LOOM_LIVE_EXPIRY_INVALID: future deadline within one hour required")
    if (this.row(host.sessionID)) throw new Error("LOOM_LIVE_SESSION_USED: a trial or its history already owns this Session")
    this.eligibleObjective(objective, host.sessionID)
    let candidate = this.candidate(input.candidate_id)
    if (candidate.target_kind !== "agent" || candidate.target_id !== actor.agent)
      throw new Error("LOOM_LIVE_ROUTE_UNQUALIFIED: only additive agent-system context for this native agent is supported")
    if (sha(await host.source()) !== candidate.base_sha256)
      throw new Error("LOOM_LIVE_SOURCE_DRIFT: native agent system does not match proposed baseline")
    if (await this.ownValue(host) !== undefined)
      throw new Error("LOOM_LIVE_ENTRY_OCCUPIED: never overwrite a pre-existing instruction entry")
    // Native permission is required in addition to caller-supplied opt-in. It
    // must run before any durable reservation or instruction mutation.
    await permission()
    this.assertHost(host)
    this.eligibleObjective(objective, host.sessionID)
    candidate = this.candidate(input.candidate_id)
    if (sha(await host.source()) !== candidate.base_sha256)
      throw new Error("LOOM_LIVE_SOURCE_DRIFT: source changed during native permission approval")
    if (await this.ownValue(host) !== undefined) throw new Error("LOOM_LIVE_ENTRY_OCCUPIED")
    const trialID = randomUUID(), now = utc()
    this.transaction(() => {
      if (this.row(host.sessionID)) throw new Error("LOOM_LIVE_SESSION_USED")
      this.db.prepare(`INSERT INTO learning_live_experiments
        (id,objective_id,candidate_id,session_id,agent,baseline_sha256,candidate_sha256,authorization_ref,
         eligibility,evaluation_criteria,preserved_guarantees,budget_requests,expires_at,status,created_at)
        VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(trialID,objective,candidate.id,host.sessionID,host.agent,
        candidate.base_sha256,candidate.candidate_sha256,authorization,eligibility,criteria,guarantees,
        input.budget_requests,new Date(expiry).toISOString(),"installing",now)
      this.event(trialID, "authorized-reserved", "Native permission passed; no provider exposure certified")
    })
    try {
      await host.put(candidate.content)
      if (await this.ownValue(host) !== candidate.content) throw new Error("LOOM_LIVE_ASSIGNMENT_READBACK_MISMATCH")
      this.transaction(() => {
        this.db.prepare("UPDATE learning_live_experiments SET status='assigned' WHERE id=? AND status='installing'")
          .run(trialID)
        this.event(trialID, "native-entry-readback", "Candidate SHA-256 verified at native Session-entry storage; NOT provider exposure")
      })
    } catch (error) {
      // A timed-out PUT can still have committed. Never label this as a clean
      // unexposed control or automatically overwrite a possibly changed key.
      this.transaction(() => {
        this.db.prepare("UPDATE learning_live_experiments SET status='recovery-required' WHERE id=?").run(trialID)
        this.event(trialID, "assignment-uncertain", "Native write/readback failed; explicit stop and reconciliation required")
      })
      throw error
    }
    return { experiment_id: trialID, status: "assigned", candidate_sha256: candidate.candidate_sha256,
      source_sha256: candidate.base_sha256, entry_key: LIVE_ENTRY_KEY,
      assignment: "native Session entry readback", exposure: "NOT_VERIFIED", provider_receipt: null,
      note: "Assignment is not a trial outcome or evidence of model consumption; the additive entry does not replace native agent/skill instructions." }
  }
  /** Reject every unqualified tool route while the trial may still be active.
   * Only this Session's own inspection/withdrawal remains available; tools and
   * direct reads are NOT part of the installed provider-isolation qualification. */
  guardTool(sessionID: string, tool: string, input: unknown) {
    const row = this.row(sessionID)
    if (!row || row.status === "stopped") return
    const fields = input && typeof input === "object" && !Array.isArray(input)
      ? input as {operation?:unknown} : {}
    if (/^loom[._]tweak$/.test(tool) && ["live-read","live-stop"].includes(String(fields.operation))) return
    throw new Error("LOOM_LIVE_TOOL_ROUTE_UNQUALIFIED: stop the Session experiment before other native/model tools")
  }
  /** Context-stage observation is useful for diagnosing omissions, never a receipt. */
  onContext(host: Pick<ExperimentHost,"sessionID"|"agent"|"version">, system: Array<{ type: string; text: string }>) {
    const row = this.row(host.sessionID)
    if (!row || !["assigned","possible-exposure"].includes(row.status)) return
    this.assertHost(host as ExperimentHost,row)
    const candidate = this.candidate(row.candidate_id)
    const expected = `<context key="${LIVE_ENTRY_KEY}">\n${candidate.content}\n</context>`
    const parts = system.filter(p => p?.type === "text" && typeof p.text === "string").map(p => p.text)
    if (!parts.some(p => p.includes(expected))) {
      this.transaction(() => this.event(row.id,"context-gap","Candidate missing at pre-provider context stage"))
      throw new Error("LOOM_LIVE_CONTEXT_GAP: candidate missing from native Session system context")
    }
    this.transaction(() => {
      this.db.prepare("UPDATE learning_live_experiments SET context_count=context_count+1,status='possible-exposure' WHERE id=?")
        .run(row.id)
      this.event(row.id,"context-stage",sha(parts.join("\n")) + " (pre-provider only, NOT a model-input receipt)")
    })
  }
  async beforeRequest(host: ExperimentHost, kind: string) {
    const row = this.row(host.sessionID)
    if (!row) return
    if (["stopped","stop-uncertain"].includes(row.status)) {
      // Withdrawal never removes past instruction exposure. Do not claim control.
      if (await this.ownValue(host) !== undefined)
        throw new Error("LOOM_LIVE_WITHDRAWAL_UNCERTAIN: inactive Session still has experiment entry")
      return
    }
    if (!["assigned","possible-exposure"].includes(row.status))
      throw new Error("LOOM_LIVE_RECOVERY_REQUIRED: incomplete assignment, stop this Session trial")
    if (kind !== "primary") throw new Error("LOOM_LIVE_ROUTE_UNQUALIFIED: only primary model requests are eligible")
    if (Date.now() >= Date.parse(row.expires_at)) throw new Error("LOOM_LIVE_EXPIRED: withdraw the experiment before continuing")
    if (row.preflight_count >= row.budget_requests) throw new Error("LOOM_LIVE_BUDGET_EXHAUSTED: withdraw the experiment")
    const candidate = await this.current(host,row)
    if (await this.ownValue(host) !== candidate.content)
      throw new Error("LOOM_LIVE_ENTRY_DRIFT: native instruction entry changed or vanished")
    this.transaction(() => {
      this.db.prepare("UPDATE learning_live_experiments SET preflight_count=preflight_count+1,status='possible-exposure' WHERE id=? AND preflight_count<?")
        .run(row.id,row.budget_requests)
      this.event(row.id,"primary-pretransport", "Native request reached pre-transport hook; provider delivery NOT certified")
    })
  }
  async stop(actor: Actor, host: ExperimentHost) {
    const row = this.row(actor.session_id)
    if (!row) throw new Error("LOOM_LIVE_NO_TRIAL: no trial exists for calling Session")
    if (host.sessionID !== actor.session_id || host.agent !== actor.agent) throw new Error("LOOM_LIVE_SCOPE_DRIFT")
    this.assertHost(host,row)
    if (row.status === "stopped") return this.read(actor.session_id)
    try {
      const value = await this.ownValue(host)
      if (value !== undefined) {
        // Never delete a key that another producer has replaced.
        const candidate = this.db.prepare("SELECT content FROM learning_candidates WHERE id=?").get(row.candidate_id) as { content: string }
        if (value !== candidate.content) throw new Error("LOOM_LIVE_ENTRY_DRIFT: refusing to delete another value")
        await host.remove()
      }
      if (await this.ownValue(host) !== undefined) throw new Error("LOOM_LIVE_WITHDRAWAL_UNCERTAIN: native entry survived removal")
      this.transaction(() => {
        this.db.prepare("UPDATE learning_live_experiments SET status='stopped', stopped_at=? WHERE id=?").run(utc(),row.id)
        this.event(row.id, "native-entry-removed", "Readback empty; prior model context/history is NOT cleansed")
      })
    } catch (error) {
      this.transaction(() => {
        this.db.prepare("UPDATE learning_live_experiments SET status='stop-uncertain' WHERE id=?").run(row.id)
        this.event(row.id,"withdrawal-uncertain","Native removal/readback failed; original Session is not a clean control")
      })
      throw error
    }
    return this.read(actor.session_id)
  }
  assertRetirable(candidateID: string) {
    const row = this.db.prepare(`SELECT id FROM learning_live_experiments
      WHERE candidate_id=? AND status IN ('installing','assigned','possible-exposure','recovery-required','stop-uncertain') LIMIT 1`)
      .get(candidateID)
    if (row) throw new Error("LOOM_LIVE_ACTIVE: stop/reconcile active or uncertain experimental Session before retiring candidate")
  }
  read(sessionID: string) {
    const row = this.row(sessionID)
    if (!row) return { status: "inactive", default: "no assignment; ordinary work unchanged" }
    const events = this.db.prepare(`SELECT seq,at,kind,detail FROM learning_live_events WHERE experiment_id=?
      ORDER BY seq DESC LIMIT 20`).all(row.id)
    return { ...row, events, entry_key: LIVE_ENTRY_KEY,
      observed_provider_receipts: 0, exposure_verification: "unknown: native context/model.request hooks are pre-provider, not actual provider input",
      control_eligible: false, objective_effectiveness: "not-evaluated",
      note: row.status === "stopped"
        ? "Entry removed, but historic model inputs may still contain candidate; do not reuse as control."
        : "Treat as partial or possible exposure until independently verified. Missing provider receipts do not certify treatment." }
  }
}
