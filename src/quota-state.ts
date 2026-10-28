/**
 * Machine-local, cross-process subscription state. This is not Loom's Action
 * ledger and never stores provider credentials or request/response contents.
 * The OpenCode adapter owns discovery, authentication, dispatch and retries.
 */
import { Database } from "bun:sqlite"
import { createHash, randomUUID } from "node:crypto"
import { constants } from "node:fs"
import { lstat, mkdir, open, realpath } from "node:fs/promises"
import { homedir } from "node:os"
import { dirname, isAbsolute, join } from "node:path"
import type { RouteInventory } from "./model-routing.js"

export type QuotaIdentity = { providerID: string; accountID: string; modelID: string }
export type QuotaScope = "account-model" | "account" | "provider-model" | "provider"
export type QuotaBlock = "exhausted" | "throttled" | "overloaded" | "authentication"
export type QuotaReport = {
  scope?: QuotaScope
  /** Provider-reported remaining subscription requests/units, NOT output tokens. */
  remaining: number
  resetAt?: number // Unix milliseconds, from the provider, if actually reported
  scopeVerified?: true // mandatory when a provider-wide or cross-model scope is used
}
export type QuotaFailure = {
  kind: QuotaBlock | "request-error"
  scope?: QuotaScope
  scopeVerified?: true // mandatory for anything broader than account-model, except auth
  retryAfterMs?: number // trusted normalized Retry-After, not a fabricated reset
  resetAt?: number // trusted provider reset timestamp, if available
}
export type VerifiedRoute = Omit<RouteInventory, "quota"> & QuotaIdentity
export type QuotaPermit = Readonly<{
  routeKey: string
  revisions: Readonly<Record<QuotaScope, number>>
  probeToken?: string
}>
export type QuotaEligibility = {
  eligible: boolean
  quota: "available" | "unknown" | "exhausted"
  reason?: QuotaBlock | "probe-due"
  retryAt?: number // present only when a real expiry or local cooldown is known
  confidence: "provider" | "observed" | "unknown"
}
export type QuotaReservation = QuotaEligibility & { permit?: QuotaPermit }

type State = "available" | "unknown" | QuotaBlock
type Evidence = "provider" | "observed" | "unknown"
type Row = {
  state: State
  evidence: Evidence
  revision: number
  until_ms: number | null
  lease_until_ms: number | null
  lease_token: string | null
  remaining: number | null
  failures: number
  updated_ms: number
  last_success_ms: number | null
  /** Last explicit release revision. Earlier in-flight failures cannot undo recovery. */
  release_revision: number
}
const SCOPES: readonly QuotaScope[] = ["provider", "provider-model", "account", "account-model"]
const DEFAULTS: Record<"exhausted" | "throttled" | "overloaded", number> = {
  exhausted: 15 * 60_000, throttled: 30_000, overloaded: 15_000,
}
const PROBE_MS = 60_000
const MAX_DELAY_MS = 90 * 24 * 60 * 60_000
const STATUS_SQL = `INSERT INTO quota (id,state,evidence,revision,until_ms,lease_until_ms,lease_token,remaining,failures,updated_ms,last_success_ms,release_revision)
  VALUES (?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET
  state=excluded.state,evidence=excluded.evidence,revision=excluded.revision,
  until_ms=excluded.until_ms,lease_until_ms=excluded.lease_until_ms,
  lease_token=excluded.lease_token,remaining=excluded.remaining,failures=excluded.failures,
  updated_ms=excluded.updated_ms,last_success_ms=excluded.last_success_ms,
  release_revision=excluded.release_revision`

function identity(value: QuotaIdentity): QuotaIdentity {
  for (const key of ["providerID", "accountID", "modelID"] as const) {
    const s = value[key]
    // IDs must be stable, non-secret identifiers supplied by the authenticated
    // host. Do not accept arbitrary logs, tokens or request contents as IDs.
    if (typeof s !== "string" || !/^[a-zA-Z0-9][a-zA-Z0-9_.:/@+-]{0,199}$/.test(s)) {
      throw new Error(`Invalid quota ${key}: expected a stable opaque identifier`)
    }
  }
  return value
}
function scopeKey(route: QuotaIdentity, scope: QuotaScope): string {
  const { providerID, accountID, modelID } = identity(route)
  return createHash("sha256").update(JSON.stringify([
    providerID, scope.includes("account") ? accountID : null,
    scope.includes("model") ? modelID : null, scope,
  ])).digest("hex")
}
function routeKey(route: QuotaIdentity): string {
  return createHash("sha256").update(JSON.stringify([route.providerID, route.accountID, route.modelID])).digest("hex")
}
function timestamp(value: number | undefined, now: number): number | undefined {
  if (value === undefined) return undefined
  if (!Number.isSafeInteger(value) || value < 0 || value > now + MAX_DELAY_MS) throw new Error("Invalid provider reset timestamp")
  return value
}
function delay(value: number | undefined): number | undefined {
  if (value === undefined) return undefined
  if (!Number.isSafeInteger(value) || value < 0 || value > MAX_DELAY_MS) throw new Error("Invalid provider retry delay")
  return value
}
function scopeOf(value: { scope?: QuotaScope; scopeVerified?: true }, fallback: QuotaScope): QuotaScope {
  const scope = value.scope ?? fallback
  if (!SCOPES.includes(scope)) throw new Error("Unknown quota scope")
  if (scope !== "account-model" && scope !== "account" && value.scopeVerified !== true) {
    throw new Error("Provider-wide quota scope requires verified evidence")
  }
  if (scope === "account" && fallback !== "account" && value.scopeVerified !== true) {
    throw new Error("Account-wide quota scope requires verified evidence")
  }
  return scope
}
function empty(now: number): Row {
  return { state: "unknown", evidence: "unknown", revision: 0, until_ms: null,
    lease_until_ms: null, lease_token: null, remaining: null, failures: 0,
    updated_ms: now, last_success_ms: null, release_revision: 0 }
}
function isBlock(state: State): state is QuotaBlock {
  return state === "exhausted" || state === "throttled" ||
    state === "overloaded" || state === "authentication"
}
const BLOCK_STRENGTH: Record<QuotaBlock, number> = {
  overloaded: 1, throttled: 2, exhausted: 3, authentication: 4,
}
const validTime = (value: unknown): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 0
const optionalTime = (value: unknown): value is number | null =>
  value === null || validTime(value)

function validateRow(row: Row): Row {
  const leasePair = (row.lease_until_ms === null) === (row.lease_token === null)
  if (!["unknown", "available", "exhausted", "throttled", "overloaded", "authentication"].includes(row.state) ||
    !["provider", "observed", "unknown"].includes(row.evidence) ||
    !validTime(row.revision) || !validTime(row.release_revision) ||
    row.release_revision > row.revision ||
    !Number.isSafeInteger(row.failures) || row.failures < 0 || row.failures > 16 ||
    !optionalTime(row.until_ms) || !optionalTime(row.lease_until_ms) ||
    !optionalTime(row.last_success_ms) || !validTime(row.updated_ms) ||
    (row.remaining !== null && (!validTime(row.remaining))) ||
    // A provider-certified available state cannot simultaneously carry zero
    // remaining allowance. SQLite quick_check does not enforce this relation.
    (row.state === "available" && row.evidence === "provider" &&
      (row.remaining === null || row.remaining === 0)) ||
    !leasePair ||
    (row.lease_token !== null && (typeof row.lease_token !== "string" ||
      !/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(row.lease_token))) ||
    (isBlock(row.state) && row.state !== "authentication" && row.until_ms === null) ||
    (row.state === "authentication" && row.until_ms !== null) ||
    (!isBlock(row.state) && (row.until_ms !== null || row.lease_token !== null)) ||
    (row.state === "authentication" && row.lease_token !== null)) {
    throw new Error("Invalid shared quota state; refusing routing")
  }
  return row
}

/** Failure permits from concurrent requests remain valid within one recovery epoch.
 * Stronger negative evidence can extend an existing block; stale success and
 * any failure predating an explicit recovery are still rejected.
 */
function mayApplyNegative(row: Row, permit: QuotaPermit, scope: QuotaScope): boolean {
  const revision = permit.revisions[scope]
  return validTime(revision) && revision >= row.release_revision &&
    revision <= row.revision && (revision === row.revision || isBlock(row.state))
}
function blockUpdate(row: Row, kind: QuotaBlock, until: number | null,
  evidence: Evidence, now: number): Row {
  const former = isBlock(row.state) ? row.state : undefined
  const state = former && BLOCK_STRENGTH[former] > BLOCK_STRENGTH[kind] ? former : kind
  const deadline = state === "authentication" ? null :
    Math.max(until ?? 0, former && row.state !== "authentication" ? row.until_ms ?? 0 : 0)
  return { ...row, state,
    evidence: evidence === "provider" || row.evidence === "provider" ? "provider" : "observed",
    until_ms: deadline, lease_until_ms: null, lease_token: null, remaining: null,
    failures: Math.min(row.failures + 1, 16), revision: row.revision + 1, updated_ms: now }
}

export function defaultQuotaPath(): string {
  const xdg = process.env.XDG_STATE_HOME
  const root = xdg && isAbsolute(xdg) ? xdg : join(homedir(), ".local", "state")
  return join(root, "loom", "quota-v1", "subscriptions.sqlite")
}

/** Open a separate, user-private SQLite file; a damaged DB is never silently reset. */
export async function openSharedQuotaState(options: { path?: string; now?: () => number } = {}): Promise<SharedQuotaState> {
  const filename = options.path ?? defaultQuotaPath()
  if (!isAbsolute(filename)) throw new Error("Shared quota database path must be absolute")
  const dir = dirname(filename)
  await mkdir(dir, { recursive: true, mode: 0o700 })
  const ds = await lstat(dir)
  if (!ds.isDirectory() || (ds.mode & 0o077) !== 0 || (process.getuid && ds.uid !== process.getuid())) {
    throw new Error("Shared quota directory must be private and owned by the current user")
  }
  let created = false
  try {
    const f = await open(filename, constants.O_CREAT | constants.O_EXCL | constants.O_RDWR | (constants.O_NOFOLLOW ?? 0), 0o600)
    created = true
    await f.close()
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e
  }
  let fs = await lstat(filename)
  // Another process may observe the zero-byte file between O_EXCL and
  // SQLite initialization. Wait briefly, but never silently repair an
  // abandoned or corrupt empty DB from an earlier process.
  for (let i = 0; !created && fs.size === 0 && i < 30; i++) {
    await new Promise(resolve => setTimeout(resolve, 100))
    fs = await lstat(filename)
  }
  if (!fs.isFile() || (fs.mode & 0o077) !== 0 || (process.getuid && fs.uid !== process.getuid())) {
    throw new Error("Shared quota database must be a private regular file owned by the current user")
  }
  if (!created) {
    if (fs.size < 100) throw new Error("Existing shared quota database is incomplete or corrupt")
    const f = await open(filename, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0))
    try {
      const header = Buffer.alloc(16)
      const { bytesRead } = await f.read(header, 0, 16, 0)
      if (bytesRead !== 16 || header.toString("utf8") !== "SQLite format 3\0") {
        throw new Error("Existing shared quota database has an invalid SQLite header")
      }
    } finally { await f.close() }
  }
  const canonical = await realpath(filename)
  if (canonical !== filename) throw new Error("Shared quota database may not be a symlink")
  const db = new Database(filename)
  try {
    db.exec("PRAGMA busy_timeout=5000; PRAGMA journal_mode=WAL;")
    const check = db.prepare("PRAGMA quick_check").get() as { quick_check?: string } | null
    if (check?.quick_check !== "ok") throw new Error("Shared quota database is corrupt")
    db.exec("BEGIN IMMEDIATE")
    try {
      const row = db.prepare("PRAGMA user_version").get() as { user_version: number }
      if (![0, 1, 2].includes(row.user_version)) throw new Error("Unsupported shared quota schema version")
      if (row.user_version === 0 && !created) throw new Error("Existing shared quota database was never initialized")
      if (row.user_version >= 1 && !db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='quota'").get()) {
        throw new Error("Existing shared quota database is missing the quota table")
      }
      db.exec(`CREATE TABLE IF NOT EXISTS quota (
        id TEXT PRIMARY KEY NOT NULL CHECK(length(id)=64),
        state TEXT NOT NULL CHECK(state IN ('available','unknown','exhausted','throttled','overloaded','authentication')),
        evidence TEXT NOT NULL CHECK(evidence IN ('provider','observed','unknown')),
        revision INTEGER NOT NULL CHECK(revision>=0),
        until_ms INTEGER, lease_until_ms INTEGER, lease_token TEXT,
        remaining INTEGER, failures INTEGER NOT NULL CHECK(failures>=0),
        updated_ms INTEGER NOT NULL, last_success_ms INTEGER,
        release_revision INTEGER NOT NULL DEFAULT 0 CHECK(release_revision>=0)
      );`)
      if (row.user_version === 1) {
        const columns = db.prepare("PRAGMA table_info(quota)").all() as Array<{ name: string }>
        if (!columns.some(column => column.name === "release_revision")) {
          db.exec("ALTER TABLE quota ADD COLUMN release_revision INTEGER NOT NULL DEFAULT 0 CHECK(release_revision>=0)")
        }
      }
      db.exec("PRAGMA user_version=2")
      db.exec("COMMIT")
    } catch (e) { db.exec("ROLLBACK"); throw e }
    return new SharedQuotaState(db, options.now ?? Date.now)
  } catch (e) { db.close(); throw e }
}

export class SharedQuotaState {
  constructor(private readonly db: Database, private readonly clock: () => number = Date.now) {}
  close(): void { this.db.close() }
  private now(): number {
    const n = this.clock()
    if (!Number.isSafeInteger(n) || n < 0) throw new Error("Invalid quota state clock")
    return n
  }
  private transaction<T>(fn: () => T): T {
    this.db.exec("BEGIN IMMEDIATE")
    try { const value = fn(); this.db.exec("COMMIT"); return value }
    catch (e) { this.db.exec("ROLLBACK"); throw e }
  }
  private read(key: string, now: number): Row {
    const row = this.db.prepare("SELECT state,evidence,revision,until_ms,lease_until_ms,lease_token,remaining,failures,updated_ms,last_success_ms,release_revision FROM quota WHERE id=?").get(key) as Row | null
    return row ? validateRow(row) : empty(now)
  }
  private put(key: string, row: Row): void {
    this.db.prepare(STATUS_SQL).run(key, row.state, row.evidence, row.revision,
      row.until_ms, row.lease_until_ms, row.lease_token, row.remaining,
      row.failures, row.updated_ms, row.last_success_ms, row.release_revision)
  }
  private entries(route: QuotaIdentity, now: number): Array<{ scope: QuotaScope; key: string; row: Row }> {
    return SCOPES.map(scope => { const key = scopeKey(route, scope); return { scope, key, row: this.read(key, now) } })
  }
  private decide(entries: ReturnType<SharedQuotaState["entries"]>, now: number): QuotaEligibility {
    let due = false
    let available = false
    for (const { row } of entries) {
      if (row.state === "available" && row.evidence === "provider") available = true
      if (!["exhausted", "throttled", "overloaded", "authentication"].includes(row.state)) continue
      if (row.lease_until_ms !== null && row.lease_until_ms > now) {
        return { eligible: false, quota: "exhausted", reason: row.state as QuotaBlock,
          retryAt: row.lease_until_ms, confidence: row.evidence }
      }
      if (row.state === "authentication" || row.until_ms === null || row.until_ms > now) {
        return { eligible: false, quota: "exhausted", reason: row.state as QuotaBlock,
          ...(row.until_ms !== null ? { retryAt: row.until_ms } : {}), confidence: row.evidence }
      }
      due = true
    }
    return { eligible: true, quota: due ? "unknown" : available ? "available" : "unknown",
      ...(due ? { reason: "probe-due" as const } : {}), confidence: available && !due ? "provider" : "unknown" }
  }
  /** Read-only. An expired block is probe-due, not proof that quota was reset. */
  eligibility(route: QuotaIdentity): QuotaEligibility {
    identity(route)
    const now = this.now()
    return this.decide(this.entries(route, now), now)
  }
  /** Capture a revision before a direct provider quota poll or auth refresh. */
  observe(route: QuotaIdentity): QuotaPermit {
    identity(route)
    const now = this.now()
    return { routeKey: routeKey(route), revisions: Object.fromEntries(this.entries(route, now)
      .map(e => [e.scope, e.row.revision])) as Record<QuotaScope, number> }
  }
  /**
   * Mandatory immediately before adapter dispatch. An expired block gets one
   * shared 60-second probe lease; other processes cannot claim that probe.
   */
  reserve(route: QuotaIdentity): QuotaReservation {
    identity(route)
    return this.transaction(() => {
      const now = this.now()
      const entries = this.entries(route, now)
      const decision = this.decide(entries, now)
      if (!decision.eligible) return decision
      const probe = decision.reason === "probe-due" ? randomUUID() : undefined
      if (probe) {
        for (const { key, row } of entries) {
          if (!["exhausted", "throttled", "overloaded"].includes(row.state) ||
            row.until_ms === null || row.until_ms > now) continue
          this.put(key, { ...row, revision: row.revision + 1,
            lease_until_ms: now + PROBE_MS, lease_token: probe, updated_ms: now })
          row.revision++
        }
      }
      return { ...decision, permit: { routeKey: routeKey(route), revisions: Object.fromEntries(entries
        .map(e => [e.scope, e.row.revision])) as Record<QuotaScope, number>, ...(probe ? { probeToken: probe } : {}) } }
    })
  }
  /**
   * A transient error never becomes quota exhaustion. Unknown reset times use
   * bounded local retry cooldowns, never a made-up provider reset timestamp.
   */
  recordFailure(route: QuotaIdentity, permit: QuotaPermit, failure: QuotaFailure): boolean {
    identity(route)
    const kind = failure.kind
    if (kind === "request-error") return false
    if (!["exhausted", "throttled", "overloaded", "authentication"].includes(failure.kind)) throw new Error("Invalid quota failure")
    const scope = scopeOf(failure, kind === "authentication" ? "account" : "account-model")
    if (permit.routeKey !== routeKey(route)) throw new Error("Quota permit does not match route")
    return this.transaction(() => {
      const now = this.now()
      const explicitReset = timestamp(failure.resetAt, now)
      const retry = delay(failure.retryAfterMs)
      const key = scopeKey(route, scope)
      const row = this.read(key, now)
      if (!mayApplyNegative(row, permit, scope)) return false
      const failures = Math.min(row.failures + 1, 16)
      const fallback = DEFAULTS[kind as keyof typeof DEFAULTS] ?? 0
      const backoff = Math.min(MAX_DELAY_MS, fallback * 2 ** Math.min(failures - 1, 5))
      // Both native Retry-After and a reset time are lower bounds when supplied.
      // Local exponential cooldown is used only when neither was supplied.
      const until = kind === "authentication" ? null
        : Math.max(now + 1000, explicitReset ?? 0,
          retry === undefined ? 0 : now + retry,
          explicitReset === undefined && retry === undefined ? now + backoff : 0)
      this.put(key, blockUpdate(row, kind, until,
        explicitReset !== undefined || retry !== undefined ? "provider" : "observed", now))
      return true
    })
  }
  /** Provider report is an independent observation; stale observations cannot erase new failures. */
  recordProviderQuota(route: QuotaIdentity, permit: QuotaPermit, report: QuotaReport): boolean {
    identity(route)
    const scope = scopeOf(report, "account-model")
    if (permit.routeKey !== routeKey(route)) throw new Error("Quota permit does not match route")
    return this.transaction(() => this.applyReport(route, permit, report, scope, this.now()))
  }
  private applyReport(route: QuotaIdentity, permit: QuotaPermit, report: QuotaReport, scope: QuotaScope, now: number): boolean {
    const remaining = report.remaining
    if (!Number.isSafeInteger(remaining) || remaining < 0) throw new Error("Provider quota remaining must be a non-negative integer")
    const reset = timestamp(report.resetAt, now)
    const key = scopeKey(route, scope)
    const row = this.read(key, now)
    if (remaining > 0) {
      // A quota/balance report is NOT proof that authentication recovered.
      // Account-wide HTTP 401 blocks can only be lifted by the dedicated,
      // separately verified recordAuthenticationRecovered() operation. This
      // also applies when the positive report is for another quota scope.
      if (this.read(scopeKey(route, "account"), now).state === "authentication") return false
      // Positive observations must match the exact revision; a stale report
      // must never erase a later block.
      if (row.revision !== permit.revisions[scope]) return false
      this.put(key, { ...row, state: "available", evidence: "provider", revision: row.revision + 1,
        release_revision: row.revision + 1, until_ms: null, lease_until_ms: null,
        lease_token: null, remaining, failures: 0, updated_ms: now })
    } else {
      // Provider-confirmed zero is negative evidence. Concurrent throttle
      // reports cannot discard it unless an actual recovery has occurred.
      if (!mayApplyNegative(row, permit, scope)) return false
      const failures = Math.min(row.failures + 1, 16)
      this.put(key, { ...blockUpdate(row, "exhausted",
        Math.max(now + 1000, reset ?? now + DEFAULTS.exhausted * 2 ** Math.min(failures - 1, 5)),
        "provider", now), remaining: 0 })
    }
    return true
  }
  /**
   * Success without a quota header proves only this request worked, not a
   * numeric balance. It clears a block ONLY for the current probe owner.
   */
  recordSuccess(route: QuotaIdentity, permit: QuotaPermit, report?: QuotaReport): void {
    identity(route)
    if (permit.routeKey !== routeKey(route)) throw new Error("Quota permit does not match route")
    const scope = report ? scopeOf(report, "account-model") : undefined
    this.transaction(() => {
      const now = this.now()
      // Do not promote an old in-flight success over an exhaustion update.
      const key = scopeKey(route, "account-model")
      const heartbeat = this.read(key, now)
      if (heartbeat.revision === permit.revisions["account-model"]) {
        this.put(key, { ...heartbeat, last_success_ms: now })
      }
      if (report && scope) this.applyReport(route, permit, report, scope, now)
      if (permit.probeToken) {
        for (const s of SCOPES) {
          if (s === scope) continue // report already supplies stronger evidence
          const scopedKey = scopeKey(route, s)
          const row = this.read(scopedKey, now)
          if (row.lease_token === permit.probeToken && row.revision === permit.revisions[s]) {
            this.put(scopedKey, { ...row, state: "unknown", evidence: "observed",
              revision: row.revision + 1, release_revision: row.revision + 1,
              until_ms: null, lease_until_ms: null, lease_token: null,
              remaining: null, failures: 0, updated_ms: now, last_success_ms: now })
          }
        }
      }
    })
  }
  /** Only call after OpenCode confirms replacement/refresh of account credentials. */
  recordAuthenticationRecovered(route: QuotaIdentity, observation: QuotaPermit): boolean {
    identity(route)
    if (observation.routeKey !== routeKey(route)) throw new Error("Quota permit does not match route")
    return this.transaction(() => {
      const now = this.now()
      const key = scopeKey(route, "account")
      const row = this.read(key, now)
      if (row.state !== "authentication" || row.revision !== observation.revisions.account) return false
      this.put(key, { ...row, state: "unknown", evidence: "observed", revision: row.revision + 1,
        release_revision: row.revision + 1, until_ms: null, lease_until_ms: null,
        lease_token: null, remaining: null, failures: 0, updated_ms: now })
      return true
    })
  }
  /** Keep verified billing unchanged; quota state must never authorize spending. */
  inventory(routes: readonly VerifiedRoute[]): Array<RouteInventory & { accountID: string }> {
    return routes.map(route => ({ ...route, quota: this.eligibility(route).quota }))
  }
}