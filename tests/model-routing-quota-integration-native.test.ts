import { test, expect } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { spawnSync } from "node:child_process"
import { defaults, mergeConfig } from "../src/config.js"
import { registerModelRouting } from "../src/model-routing-adapter.js"
import { openSharedQuotaState, type QuotaIdentity } from "../src/quota-state.js"
import { classifiedNativeFailure } from "../src/model-routing-shared-quota.js"
import type { RouteEligibilitySource } from "../src/model-routing-runtime.js"

const worker = new URL("./fixtures/quota-worker.ts", import.meta.url).pathname
const go = (accountID = "account-a"): QuotaIdentity =>
  ({ providerID: "opencode-go", accountID, modelID: "sol" })
const model = (providerID: string, id = "sol") => ({
  id, modelID: id, providerID, enabled: true, status: "active",
  name: id, capabilities: { tools: true, input: ["text"], output: ["text"] },
  variants: [{ id: "medium", settings: { reasoningEffort: "medium" } }],
  time: { released: 0 }, cost: [], limit: { context: 128000, output: 4096 },
})
const policy = () => mergeConfig(defaults(), {
  "model-routing": {
    enabled: true, "default-class": "strong", "default-reasoning": "medium",
    "provider-order": ["opencode-go", "openai"], "paid-fallback": false,
  },
  "model-classes": { strong: { models: ["sol", "astra"] } },
  agents: { architect: { roles: ["architecture"] } },
  roles: { architecture: { "model-class": "strong", reasoning: "medium" } },
})
const attest: RouteEligibilitySource = {
  async inspect({ providerID, modelID, connectionID }) {
    // Test-only billing attestation; real integrations must obtain this
    // independently from native provider/account billing evidence.
    return { providerID, modelID, connectionID,
      billing: "included", verified: true, quota: "unknown" }
  },
}
function fixture(accountGo = "account-a", billing: RouteEligibilitySource = attest) {
  const agents: Record<string, any> = { architect: {}, unmanaged: {} }
  const hooks = new Map<string, (e: any) => any>()
  const accountMap = new Map([
    ["opencode-go", { type: "credential", method: "oauth", id: accountGo }],
    ["openai", { type: "credential", method: "oauth", id: "openai-secondary" }],
  ])
  const ctx: any = {
    app: { name: "opencode", version: "2.1.4", channel: "stable" },
    model: { list: async () => ({ data: [
      model("opencode-go"), model("openai"), model("opencode-go", "astra"),
    ] }) },
    provider: { list: async () => ({ data: [
      { id: "opencode-go", integrationID: "opencode-go" },
      { id: "openai", integrationID: "openai" },
    ] }) },
    integration: { connection: { active: async (providerID: string) => accountMap.get(providerID) } },
    agent: { transform: async (fn: any) => {
      fn({ get: (id: string) => agents[id], update: (id: string, edit: any) => edit(agents[id]) })
      return { dispose: async () => {} }
    } },
    session: {
      get: async () => ({ data: { agent: "architect" } }),
      hook: async (name: string, fn: any) => { hooks.set(name, fn); return { dispose: async () => hooks.delete(name) } },
    },
    event: { subscribe: async function* ({ signal }: { signal: AbortSignal }) {
      // A real OpenCode event stream remains live until cancellation.
      // Returning immediately would simulate a lost terminal-event feed.
      await new Promise<void>(resolve => {
        if (signal.aborted) resolve()
        else signal.addEventListener("abort", () => resolve(), { once: true })
      })
    } },
  }
  return { ctx, hooks, agents, billing,
    config: async () => ({ config: policy(), errors: [], sources: [] }) }
}
const request = (modelID = "sol", providerID = "opencode-go") => ({
  kind: "primary", agent: "architect", sessionID: "sess_quota_1",
  model: { id: modelID, providerID, variant: "medium" }, headers: {},
})
async function withState(callback: (path: string) => Promise<void>) {
  const dir = await mkdtemp(join(tmpdir(), "loom-routing-integration-"))
  try { await callback(join(dir, "state.sqlite")) }
  finally { await rm(dir, { recursive: true, force: true }) }
}
function workerExhaust(path: string, account = "account-a") {
  const child = spawnSync(process.execPath, [worker, "exhaust", path, account, "sol"],
    { encoding: "utf8", timeout: 15000 })
  if (child.status !== 0) throw new Error("Quota worker failed: " + child.stderr)
  expect(JSON.parse(child.stdout).changed).toBe(true)
}

test("process B starts after process A exhausted preferred model: choose SAME model at next provider", async () => withState(async path => {
  workerExhaust(path)
  const store = await openSharedQuotaState({ path })
  try {
    const f = fixture()
    const disposers: Array<{dispose(): Promise<void>}> = []
    const selection = await registerModelRouting(f.ctx, f.config, disposers,
      new AbortController().signal, f.billing, store)
    expect(selection.status).toBe("initial-only")
    expect(selection.selected.architect).toEqual({
      provider_id: "openai", model_id: "sol", reasoning: "medium", billing: "included",
    })
    expect(f.agents.architect.model).toEqual({ providerID: "openai", id: "sol", variant: "medium" })
    await f.hooks.get("model.request")!(request("sol", "openai"))
    await expect(f.hooks.get("model.request")!(request("astra", "opencode-go")))
      .rejects.toThrow("MISMATCH")
    for (const d of disposers) await d.dispose()
  } finally { store.close() }
}))

test("running process uses initial model, other process exhausts it: deny, never switch or replay", async () => withState(async path => {
  const store = await openSharedQuotaState({ path })
  try {
    const f = fixture()
    await registerModelRouting(f.ctx, f.config, [], new AbortController().signal, f.billing, store)
    expect(f.agents.architect.model).toEqual({ providerID: "opencode-go", id: "sol", variant: "medium" })
    workerExhaust(path)
    await expect(f.hooks.get("model.request")!(request())).rejects.toThrow("QUOTA_UNAVAILABLE")
    expect(f.agents.architect.model.providerID).toBe("opencode-go")
    // A separate new process (or a restarted plugin) can plan a new route.
    const other = await openSharedQuotaState({ path })
    try {
      const g = fixture()
      const result = await registerModelRouting(g.ctx, g.config, [], new AbortController().signal, g.billing, other)
      expect(result.selected.architect.provider_id).toBe("openai")
    } finally { other.close() }
  } finally { store.close() }
}))

test("two accounts on same native provider remain isolated; inactive accounts are not invented", async () => withState(async path => {
  workerExhaust(path)
  const shared = await openSharedQuotaState({ path })
  try {
    expect(shared.eligibility(go("account-a")).eligible).toBe(false)
    expect(shared.eligibility(go("account-b")).eligible).toBe(true)
    const available = fixture("account-b")
    const planned = await registerModelRouting(available.ctx, available.config, [],
      new AbortController().signal, available.billing, shared)
    expect(planned.selected.architect.provider_id).toBe("opencode-go")
    await available.hooks.get("model.request")!(request())
    const unavailable = fixture("account-a")
    const replanned = await registerModelRouting(unavailable.ctx, unavailable.config, [],
      new AbortController().signal, unavailable.billing, shared)
    expect(replanned.selected.architect.provider_id).toBe("openai")
  } finally { shared.close() }
}))

test("only real normalized provider failures update shared quota; retry does not switch models", async () => withState(async path => {
  const store = await openSharedQuotaState({ path })
  try {
    const f = fixture()
    await registerModelRouting(f.ctx, f.config, [], new AbortController().signal, f.billing, store)
    await f.hooks.get("model.request")!(request())
    expect(store.eligibility(go()).quota).toBe("unknown")
    const noEvidence = { ...request(), error: { type: "provider.invalid-request", status: 400 },
      attempt: 2, decision: { retry: true, delay: 0 } }
    await f.hooks.get("retry")!(noEvidence)
    expect(store.eligibility(go()).eligible).toBe(true)
    expect(noEvidence.decision.retry).toBe(true)
    const observed = { ...request(), error: { type: "provider.quota", status: 429 },
      attempt: 2, decision: { retry: true, delay: 0 } }
    await f.hooks.get("retry")!(observed)
    expect((observed.decision as { retry: boolean }).retry).toBe(false)
    const secondProcess = await openSharedQuotaState({ path })
    try {
      expect(secondProcess.eligibility(go()).reason).toBe("exhausted")
      expect(secondProcess.eligibility(go("different")).eligible).toBe(true)
    } finally { secondProcess.close() }
  } finally { store.close() }
}))

test("rate-limit throttling and authentication are distinct; no quota evidence from success-shaped responses", async () => withState(async path => {
  const store = await openSharedQuotaState({ path })
  try {
    expect(classifiedNativeFailure({ type: "provider.rate-limit", status: 429 })?.kind).toBe("throttled")
    expect(classifiedNativeFailure({ type: "provider.auth", status: 401 })?.kind).toBe("authentication")
    // A model-level 403 does not establish account-wide credential expiry.
    expect(classifiedNativeFailure({ type: "provider.auth", status: 403 })).toBeUndefined()
    expect(classifiedNativeFailure({ type: "provider.rate-limit", status: 429,
      retryAfterMs: 3_600_000 })).toEqual({ kind: "throttled", retryAfterMs: 3_600_000 })
    expect(classifiedNativeFailure({ type: "provider.auth" })).toBeUndefined()
    expect(classifiedNativeFailure({ type: "provider.internal", status: 500 })).toBeUndefined()
    expect(classifiedNativeFailure({ type: "provider.transport" })).toBeUndefined()
    const f = fixture()
    await registerModelRouting(f.ctx, f.config, [], new AbortController().signal, f.billing, store)
    await f.hooks.get("model.request")!(request())
    // No callback reports a completed stream/step with an authoritative
    // route+account identity, so this adapter does NOT call recordSuccess().
    expect(store.eligibility(go())).toMatchObject({ eligible: true, quota: "unknown" })
    const failed = { ...request(), error: { type: "provider.rate-limit", status: 429 },
      attempt: 2, decision: { retry: true, delay: 10 } }
    await f.hooks.get("retry")!(failed)
    expect(store.eligibility(go()).reason).toBe("throttled")
  } finally { store.close() }
}))

test("unknown billing never becomes included even with positive shared quota", async () => withState(async path => {
  const store = await openSharedQuotaState({ path })
  try {
    const r = go()
    store.recordProviderQuota(r, store.observe(r), { remaining: 5 })
    const unknown: RouteEligibilitySource = { inspect: async (input) =>
      ({ ...input, billing: "unknown", verified: false, quota: "available" }) }
    const f = fixture("account-a", unknown)
    const selection = await registerModelRouting(f.ctx, f.config, [], new AbortController().signal, f.billing, store)
    expect(selection.unavailable).toContain("architect")
    await expect(f.hooks.get("model.request")!(request())).rejects.toThrow("UNAVAILABLE")
  } finally { store.close() }
}))

test("environment variable name is not treated as verified account identity", async () => withState(async path => {
  const store = await openSharedQuotaState({ path })
  try {
    const f = fixture()
    f.ctx.integration.connection.active = async () => ({ type: "env", name: "API_KEY" })
    const result = await registerModelRouting(f.ctx, f.config, [], new AbortController().signal, f.billing, store)
    expect(result.unavailable).toContain("architect")
  } finally { store.close() }
}))


test("native Retry-After delays reach the shared quota store and affect another process", async () => withState(async path => {
  let now = 5_000_000
  const store = await openSharedQuotaState({ path, now: () => now })
  try {
    const f = fixture()
    await registerModelRouting(f.ctx, f.config, [], new AbortController().signal, f.billing, store)
    await f.hooks.get("model.request")!(request())
    const failure = { ...request(), error: { type: "provider.rate-limit", status: 429,
      retryAfterMs: 3_600_000 }, attempt: 2, decision: { retry: true, delay: 0 } }
    await f.hooks.get("retry")!(failure)
    expect(failure.decision.retry).toBe(false)
    const second = await openSharedQuotaState({ path, now: () => now })
    try {
      expect(second.eligibility(go()).reason).toBe("throttled")
      expect(second.eligibility(go()).retryAt).toBe(now + 3_600_000)
      now += 60_000
      expect(second.eligibility(go()).eligible).toBe(false)
    } finally { second.close() }
  } finally { store.close() }
}))

test("native HTTP 403 on one model cannot indefinitely block another model on the same account", async () => withState(async path => {
  const store = await openSharedQuotaState({ path })
  try {
    const f = fixture()
    await registerModelRouting(f.ctx, f.config, [], new AbortController().signal, f.billing, store)
    await f.hooks.get("model.request")!(request())
    const denied = { ...request(), error: { type: "provider.auth", status: 403 },
      attempt: 1, decision: { retry: true, delay: 0 } }
    await f.hooks.get("retry")!(denied)
    expect(store.eligibility(go()).eligible).toBe(true)
    expect(store.eligibility({ ...go(), modelID: "astra" }).eligible).toBe(true)
    expect(denied.decision.retry).toBe(true)
  } finally { store.close() }
}))


test("delayed execution A terminal event cannot discard execution B's quota reservation", async () => withState(async path => {
  const store = await openSharedQuotaState({ path })
  const controller = new AbortController()
  try {
    const f = fixture()
    let deliver!: () => void
    let processed!: () => void
    const received = new Promise<void>(resolve => { processed = resolve })
    f.ctx.event.subscribe = async function* ({ signal }: { signal: AbortSignal }) {
      await new Promise<void>(resolve => {
        deliver = resolve
        signal.addEventListener("abort", () => resolve(), { once: true })
      })
      if (signal.aborted) return
      // A's completion arrives only AFTER B has obtained a new reservation.
      yield { type: "session.execution.succeeded", data: { sessionID: "sess_quota_1" } }
      processed() // for-await handler finished processing the preceding event
      await new Promise<void>(resolve => {
        signal.addEventListener("abort", () => resolve(), { once: true })
      })
    }
    await registerModelRouting(f.ctx, f.config, [], controller.signal, f.billing, store)
    const hook = f.hooks.get("model.request")!
    await hook(request()) // execution A
    await hook(request()) // execution B, same native Session/model
    // Wait for the actual event subscriber to become ready, then release A.
    for (let i = 0; i < 50 && !deliver; i++) await Bun.sleep(1)
    expect(deliver).toBeFunction()
    deliver()
    await received
    const failed = { ...request(), error: { type: "provider.rate-limit", status: 429 },
      attempt: 1, decision: { retry: true, delay: 0 } }
    await f.hooks.get("retry")!(failed)
    expect(failed.decision.retry).toBe(false)
    expect(store.eligibility(go()).reason).toBe("throttled")
  } finally {
    controller.abort()
    store.close()
  }
}))


test("auxiliary account changes cannot contaminate retained primary quota evidence", async () => withState(async path => {
  const store = await openSharedQuotaState({ path })
  try {
    const f = fixture()
    await registerModelRouting(f.ctx, f.config, [], new AbortController().signal, f.billing, store)
    const dispatch = f.hooks.get("model.request")!
    const retry = f.hooks.get("retry")!
    await dispatch(request()) // a managed primary request was reserved for account A

    // The active OpenCode credentials change to account B while a managed
    // compaction request asks for the very same provider/model and Session.
    // Its failure must never be charged against A's earlier reservation.
    f.ctx.integration.connection.active = async (providerID: string) =>
      ({ type: "credential", method: "oauth",
        id: providerID === "opencode-go" ? "account-b" : "openai-secondary" })
    await expect(dispatch({ ...request(), kind: "compaction" })).rejects.toThrow("LOOM_MODEL_ROUTE_AFFINITY")
    expect(store.eligibility(go("account-a")).eligible).toBe(true)
    expect(store.eligibility(go("account-b")).eligible).toBe(true)

    // Same-account compaction remains permitted, but its native retry lacks
    // the kind/attempt identifier needed for dependable quota attribution.
    f.ctx.integration.connection.active = async (providerID: string) =>
      ({ type: "credential", method: "oauth",
        id: providerID === "opencode-go" ? "account-a" : "openai-secondary" })
    await dispatch({ ...request(), kind: "compaction" })
    const auxiliaryFailure = { ...request(), error: { type: "provider.rate-limit", status: 429 },
      attempt: 1, decision: { retry: true, delay: 0 } }
    await retry(auxiliaryFailure)
    expect(auxiliaryFailure.decision.retry).toBe(true)
    expect(store.eligibility(go("account-a")).eligible).toBe(true)

    // A new primary reservation after the auxiliary request is identifiable
    // and its own failure is still recorded against account A.
    await dispatch(request())
    const primaryFailure = { ...request(), error: { type: "provider.rate-limit", status: 429 },
      attempt: 2, decision: { retry: true, delay: 0 } }
    await retry(primaryFailure)
    expect(primaryFailure.decision.retry).toBe(false)
    expect(store.eligibility(go("account-a")).reason).toBe("throttled")
    expect(store.eligibility(go("account-b")).eligible).toBe(true)
  } finally { store.close() }
}))

test("512 distinct Sessions admit repeated agent requests, reject 513th and recover after deletion", async () => withState(async path => {
  const store = await openSharedQuotaState({ path })
  const controller = new AbortController()
  try {
    const f = fixture()
    f.agents.coder = {}
    f.config = async () => ({
      config: mergeConfig(policy(), { agents: { coder: { roles: ["architecture"] } } }),
      errors: [], sources: [],
    })
    let releaseDeletion: () => void = () => { throw new Error("Subscriber not ready") }
    let deletionProcessed: () => void = () => {}
    const processed = new Promise<void>(resolve => { deletionProcessed = () => resolve() })
    f.ctx.event.subscribe = async function* ({ signal }: { signal: AbortSignal }) {
      await new Promise<void>(resolve => {
        releaseDeletion = () => resolve()
        if (signal.aborted) resolve()
        else signal.addEventListener("abort", () => resolve(), { once: true })
      })
      if (signal.aborted) return
      yield { type: "session.deleted", data: { sessionID: "tracked-0" } }
      deletionProcessed()
      await new Promise<void>(resolve => {
        if (signal.aborted) resolve()
        else signal.addEventListener("abort", () => resolve(), { once: true })
      })
    }
    const runtime = await registerModelRouting(
      f.ctx, f.config, [], controller.signal, f.billing, store,
    )
    expect(runtime.selected.architect.provider_id).toBe("opencode-go")
    expect(runtime.selected.coder.provider_id).toBe("opencode-go")
    const dispatch = f.hooks.get("model.request")!
    for (let i = 0; i < 512; i++) {
      const event = { ...request(), sessionID: "tracked-" + i }
      await dispatch(event)
      // A second configured agent in the SAME Session must not consume an
      // additional distinct-Session slot.
      if (i % 2 === 0) await dispatch({ ...event, agent: "coder" })
    }
    const blocked = { ...request(), sessionID: "tracked-512" }
    await expect(dispatch(blocked)).rejects.toThrow("LOOM_MODEL_ROUTING_STATE_LIMIT")
    releaseDeletion()
    await processed
    await expect(dispatch(blocked)).resolves.toBeUndefined()
  } finally { controller.abort(); store.close() }
}))
