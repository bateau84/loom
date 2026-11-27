/** TEST-ONLY authority for a zero-cost, in-process provider.
 * This database is intentionally outside the restored Loom store pair. Its
 * grants and counters say nothing about a real provider account or billing.
 */
import { Database } from "bun:sqlite"
import { join } from "node:path"
import { readFileSync } from "node:fs"
import { createHash } from "node:crypto"
import { isDeepStrictEqual } from "node:util"

export const PROVIDER = "evaluator-execution-fixture"
export const MODEL = "audit"
export const ACCOUNT = "local-fixture-account"
export const RESULT = "SCRIPTED_EVALUATOR_MECHANICS_RESULT; genuine reasoning is UNPROVEN."
export const SOURCE_TOOL = "evaluator_evidence"

export type Enrollment = {
  issue_key: string; session_id: string; input_id: string; binding_sha256: string;
  pool_key: string; prompt_sha256: string; mode: "complete" | "hold" | "reject";
  expires_at_ms: number; enabled: number; consumed: number; revoked: number;
  sends: number; denied_sends: number;
  request_limit: number; source_delivery_sha256: string | null; source_delivery_count: number;
}

export class FixtureStore {
  readonly db: Database
  constructor(readonly root: string) {
    this.db = new Database(join(root, "fixture-authority.sqlite"), { create: true })
    this.db.exec("PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000")
    this.db.exec(`CREATE TABLE IF NOT EXISTS fixture_pools (
      pool_key TEXT PRIMARY KEY, capacity INTEGER NOT NULL, reserved INTEGER NOT NULL DEFAULT 0,
      consumed INTEGER NOT NULL DEFAULT 0);
      CREATE TABLE IF NOT EXISTS fixture_grants (
      semantic_key TEXT PRIMARY KEY, grant_json TEXT NOT NULL, admission_json TEXT,
      receipt_json TEXT);
      CREATE TABLE IF NOT EXISTS fixture_enrollments (
      issue_key TEXT PRIMARY KEY, session_id TEXT UNIQUE NOT NULL, input_id TEXT UNIQUE NOT NULL,
      binding_sha256 TEXT NOT NULL, pool_key TEXT NOT NULL, prompt_sha256 TEXT NOT NULL,
      mode TEXT NOT NULL, expires_at_ms INTEGER NOT NULL, enabled INTEGER NOT NULL DEFAULT 0,
      consumed INTEGER NOT NULL DEFAULT 0, revoked INTEGER NOT NULL DEFAULT 0,
      sends INTEGER NOT NULL DEFAULT 0, denied_sends INTEGER NOT NULL DEFAULT 0,
      request_limit INTEGER NOT NULL DEFAULT 1, source_delivery_sha256 TEXT,
      source_delivery_count INTEGER NOT NULL DEFAULT 0);
      CREATE TABLE IF NOT EXISTS fixture_events (
      sequence INTEGER PRIMARY KEY AUTOINCREMENT, type TEXT NOT NULL, data TEXT NOT NULL);`)
  }
  event(type: string, data: unknown) {
    this.db.query("INSERT INTO fixture_events(type,data) VALUES (?,?)").run(type, JSON.stringify(data))
  }
  enrollment(issue: string): Enrollment | null {
    return this.db.query("SELECT * FROM fixture_enrollments WHERE issue_key=?").get(issue) as Enrollment | null
  }
  recipient(session: string): Enrollment | null {
    return this.db.query("SELECT * FROM fixture_enrollments WHERE session_id=?").get(session) as Enrollment | null
  }
  /** Own actual local provider invocation admission, including host retries. */
  claim(session: string, input: { model: string; agent: string; kind: string; prompt_sha256: string;
    source_result_sha256?: string; source_tool_id?: string }) {
    return this.db.transaction(() => {
      const row = this.recipient(session)
      const pool = row ? this.db.query("SELECT capacity,consumed FROM fixture_pools WHERE pool_key=?")
        .get(row.pool_key) as { capacity: number; consumed: number } | null : null
      const policy = JSON.parse(readFileSync(join(this.root, "policy.json"), "utf8"))
      const saved = row ? this.db.query("SELECT grant_json FROM fixture_grants WHERE semantic_key=?")
        .get(row.issue_key) as { grant_json: string } | null : null
      const grant = saved ? JSON.parse(saved.grant_json) : null
      const configuration = createHash("sha256").update(readFileSync(join(this.root, "config/opencode/opencode.json"))).digest("hex")
      const stagePermitted = row && (row.sends === 0 ? input.source_result_sha256 === undefined
        : row.request_limit === 2 && row.sends === 1 && row.source_delivery_count === 1
          && input.source_result_sha256 === row.source_delivery_sha256
          && input.source_tool_id === "call_eval_" + row.issue_key.slice(0, 32))
      const denied = !row || !pool || !row.enabled || row.revoked || row.sends >= row.request_limit || !stagePermitted
        || !grant || !policy.enabled || policy.source_enabled === false || policy.account !== ACCOUNT
        || policy.expires_at !== grant.expires_at || !isDeepStrictEqual(policy.method, grant.method)
        || configuration !== policy.configuration_sha256
        || row.expires_at_ms <= Date.now() || input.model !== MODEL || input.agent !== "evaluator"
        || input.kind !== "primary" || input.prompt_sha256 !== row.prompt_sha256
        || pool.consumed >= pool.capacity || row.mode === "reject"
      this.event("provider-attempt", { session_id: session, model_id: input.model, agent: input.agent,
        kind: input.kind, admitted: !denied, issue_key: row?.issue_key ?? null })
      if (denied) {
        if (row) this.db.query("UPDATE fixture_enrollments SET denied_sends=denied_sends+1 WHERE issue_key=?").run(row.issue_key)
        return null
      }
      this.db.query("UPDATE fixture_pools SET consumed=consumed+1 WHERE pool_key=?").run(row.pool_key)
      this.db.query("UPDATE fixture_enrollments SET consumed=1,sends=sends+1 WHERE issue_key=?").run(row.issue_key)
      this.event("provider-admitted", { issue_key: row.issue_key, session_id: row.session_id,
        provider_id: PROVIDER, model_id: MODEL, account_id: ACCOUNT, local_units: 1, request_number: row.sends + 1 })
      return row
    }).immediate()
  }
  close() { this.db.close() }
}
