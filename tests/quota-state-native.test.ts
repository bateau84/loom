import { test, expect } from "bun:test"
import { Database } from "bun:sqlite"
import { openSharedQuotaState, type QuotaIdentity, type QuotaScope } from "../src/quota-state.js"
import { mkdtemp, readFile, rm, symlink, writeFile, chmod } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { spawn, spawnSync } from "node:child_process"

const route = (accountID = "acct-a", providerID = "opencode-go", modelID = "sol"): QuotaIdentity =>
  ({ providerID, accountID, modelID })
const worker = new URL("./fixtures/quota-worker.ts", import.meta.url).pathname
async function fixture(fn: (path: string) => Promise<void>) {
  const dir = await mkdtemp(join(tmpdir(), "loom-quota-"))
  try { await fn(join(dir, "subscription.sqlite")) } finally { await rm(dir, { recursive: true, force: true }) }
}
function runWorker(command: string, path: string, account = "account-a") {
  const p = spawnSync(process.execPath, [worker, command, path, account], { encoding: "utf8", timeout: 12000 })
  if (p.status !== 0) throw new Error(`Worker failed: ${p.stderr} ${p.error}`)
  return JSON.parse(p.stdout.trim()) as Record<string, unknown>
}
function parallelWorkers(command: string, path: string, accounts: string[]) {
  return Promise.all(accounts.map(account => new Promise<Record<string, unknown>>((resolve, reject) => {
    const p = spawn(process.execPath, [worker, command, path, account], { stdio: ["ignore", "pipe", "pipe"] })
    let output = "", error = ""
    p.stdout.setEncoding("utf8").on("data", chunk => { output += chunk })
    p.stderr.setEncoding("utf8").on("data", chunk => { error += chunk })
    p.on("error", reject)
    p.on("close", code => code === 0 ? resolve(JSON.parse(output.trim())) : reject(new Error(`Worker ${code}: ${error}`)))
  })))
}

test("independent processes read one process's exhaustion and retain account isolation", async () => fixture(async path => {
  expect(runWorker("exhaust", path).changed).toBe(true)
  expect(runWorker("read", path).reason).toBe("exhausted")
  expect(runWorker("read", path, "another-account").eligible).toBe(true)
  const store = await openSharedQuotaState({ path })
  try {
    expect(store.eligibility(route("account-a", "other-provider", "gpt-6.1-sol")).eligible).toBe(true)
    expect(store.eligibility(route("account-a", "opencode-go", "another-model")).eligible).toBe(true)
  } finally { store.close() }
}))

test("reported account scope applies to all models of that account, not other accounts", async () => fixture(async path => {
  const store = await openSharedQuotaState({ path })
  try {
    const a = route()
    expect(store.recordProviderQuota(a, store.observe(a), { scope: "account", scopeVerified: true, remaining: 0, resetAt: Date.now() + 60_000 })).toBe(true)
    expect(store.eligibility(route("acct-a", "opencode-go", "other-model")).reason).toBe("exhausted")
    expect(store.eligibility(route("acct-b")).eligible).toBe(true)
    expect(store.eligibility(route("acct-a", "other-provider")).eligible).toBe(true)
    expect(() => store.recordProviderQuota(route("acct-b"), store.observe(route("acct-b")),
      { scope: "provider", remaining: 0 })).toThrow(/verified evidence/)
  } finally { store.close() }
}))

test("throttling, overload, exhausted, auth and ordinary errors have distinct behavior", async () => fixture(async path => {
  let clock = 1_000_000
  const store = await openSharedQuotaState({ path, now: () => clock })
  try {
    const a = route("throttled")
    const permit = store.reserve(a).permit!
    expect(store.recordFailure(a, permit, { kind: "throttled", retryAfterMs: 2000 })).toBe(true)
    expect(store.eligibility(a).reason).toBe("throttled")
    clock += 2001
    expect(store.eligibility(a).reason).toBe("probe-due")
    const probe = store.reserve(a)
    expect(probe.permit?.probeToken).toBeTruthy()
    expect(store.reserve(a).eligible).toBe(false)
    store.recordSuccess(a, probe.permit!)
    expect(store.eligibility(a).eligible).toBe(true)
    expect(store.eligibility(a).quota).toBe("unknown")
    const b = route("overloaded")
    expect(store.recordFailure(b, store.reserve(b).permit!, { kind: "overloaded" })).toBe(true)
    expect(store.eligibility(b).reason).toBe("overloaded")
    const c = route("exhausted")
    expect(store.recordFailure(c, store.reserve(c).permit!, { kind: "exhausted" })).toBe(true)
    expect(store.eligibility(c).reason).toBe("exhausted")
    const d = route("auth")
    expect(store.recordFailure(d, store.reserve(d).permit!, { kind: "authentication" })).toBe(true)
    clock += 365 * 24 * 60 * 60_000
    expect(store.eligibility(d).reason).toBe("authentication")
    const confirmed = store.observe(d)
    expect(store.recordAuthenticationRecovered(d, confirmed)).toBe(true)
    expect(store.eligibility(d).eligible).toBe(true)
    const e = route("ordinary-error")
    expect(store.recordFailure(e, store.reserve(e).permit!, { kind: "request-error" })).toBe(false)
    expect(store.eligibility(e).eligible).toBe(true)
  } finally { store.close() }
}))

test("stale success, stale quota and stale failure cannot undo newer exhaustion/recovery", async () => fixture(async path => {
  let clock = 1_000_000
  const store = await openSharedQuotaState({ path, now: () => clock })
  try {
    const a = route()
    const old = store.reserve(a).permit!
    const concurrent = store.reserve(a).permit!
    store.recordFailure(a, concurrent, { kind: "exhausted", retryAfterMs: 1000 })
    store.recordSuccess(a, old, { remaining: 8 })
    expect(store.recordProviderQuota(a, old, { remaining: 99 })).toBe(false)
    expect(store.eligibility(a).reason).toBe("exhausted")
    clock += 1001
    const probe = store.reserve(a).permit!
    expect(probe.probeToken).toBeTruthy()
    store.recordSuccess(a, probe)
    expect(store.eligibility(a).eligible).toBe(true)
    expect(store.recordFailure(a, old, { kind: "exhausted" })).toBe(false)
    expect(store.eligibility(a).eligible).toBe(true)
  } finally { store.close() }
}))

test("provider-reported positive quota safely clears a current block without inventing a reset", async () => fixture(async path => {
  const store = await openSharedQuotaState({ path })
  try {
    const a = route()
    store.recordFailure(a, store.reserve(a).permit!, { kind: "exhausted" })
    expect(store.eligibility(a).eligible).toBe(false)
    expect(store.recordProviderQuota(a, store.observe(a), { remaining: 3 })).toBe(true)
    expect(store.eligibility(a)).toMatchObject({ eligible: true, quota: "available", confidence: "provider" })
    store.recordProviderQuota(a, store.observe(a), { remaining: 0 })
    expect(store.eligibility(a).reason).toBe("exhausted")
  } finally { store.close() }
}))

test("inventory never upgrades unknown billing, including after positive usage", async () => fixture(async path => {
  const store = await openSharedQuotaState({ path })
  try {
    const r = route()
    store.recordProviderQuota(r, store.observe(r), { remaining: 5 })
    const inventory = store.inventory([
      { ...r, billing: "unknown", enabled: true, tools: true },
      { ...route("paid"), billing: "metered", enabled: true, tools: true },
    ])
    expect(inventory[0].quota).toBe("available")
    expect(inventory[0].billing).toBe("unknown")
    expect(inventory[1].billing).toBe("metered")
  } finally { store.close() }
}))

test("multiple simultaneous independent processes preserve every account's updates", async () => fixture(async path => {
  const accounts = Array.from({ length: 8 }, (_, i) => `account-${i}`)
  const results = await parallelWorkers("exhaust", path, accounts)
  expect(results.every(r => r.changed === true)).toBe(true)
  for (const account of accounts) expect(runWorker("read", path, account).reason).toBe("exhausted")
}))

test("only one concurrent process can claim the expired route's probe", async () => fixture(async path => {
  runWorker("exhaust-short", path)
  await Bun.sleep(1300)
  const results = await parallelWorkers("probe", path, Array(6).fill("account-a"))
  expect(results.filter(r => r.eligible === true)).toHaveLength(1)
  expect(results.filter(r => r.probe === true)).toHaveLength(1)
}))

test("restarts, corrupt DB, symlinks, unsafe permissions and invalid signals fail predictably", async () => fixture(async path => {
  let store = await openSharedQuotaState({ path })
  const a = route("account-person@example.test")
  try {
    store.recordFailure(a, store.reserve(a).permit!, { kind: "exhausted" })
    expect(() => store.recordFailure(a, store.observe(a), { kind: "throttled", retryAfterMs: -2 })).toThrow()
    expect(() => store.recordProviderQuota(a, store.observe(a), { remaining: -1 })).toThrow()
  } finally { store.close() }
  store = await openSharedQuotaState({ path })
  expect(store.eligibility(a).reason).toBe("exhausted")
  store.close()
  const bytes = await readFile(path)
  expect(bytes.includes(Buffer.from("account-person@example.test"))).toBe(false)
  const tampered = new Database(path)
  try { tampered.exec("DROP TABLE quota") } finally { tampered.close() }
  await expect(openSharedQuotaState({ path })).rejects.toThrow(/missing the quota table/)
  await writeFile(path, "not-sqlite", { mode: 0o600 })
  await expect(openSharedQuotaState({ path })).rejects.toThrow()
  await rm(path)
  const other = join(path + "-other")
  await writeFile(other, "not-sqlite")
  await symlink(other, path)
  await expect(openSharedQuotaState({ path })).rejects.toThrow(/regular file|symlink/)
  await rm(path)
  await chmod(other, 0o644)
  await expect(openSharedQuotaState({ path: other })).rejects.toThrow(/private regular file/)
}))