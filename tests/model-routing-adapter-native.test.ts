import { describe, expect, test } from "bun:test"
import { registerModelRouting } from "../src/model-routing-adapter.js"
import { defaults, mergeConfig } from "../src/config.js"

const MODEL = {
  id: "test-sol", modelID: "test-sol", providerID: "openai", name: "Test Sol",
  enabled: true, capabilities: { tools: true, input: ["text"], output: ["text"] },
  variants: [{ id: "medium", settings: { reasoningEffort: "medium" } }],
  time: { released: 0 }, cost: [], status: "active", limit: { context: 100000, output: 8000 },
}
const PROVIDER = {
  id: "openai", name: "OpenAI", activation: "enabled", package: "@opencode/ai/providers/openai",
  settings: { baseURL: "https://chatgpt.com/backend-api/codex" },
  headers: { originator: "opencode", "x-codex-beta-features": "remote_compaction_v2" },
}
const ACCOUNT = { type: "credential", id: "opaque-native-chatgpt-account", method: "oauth" }
const fakeQuota = {
  eligibility: () => ({ eligible: true, quota: "unknown" as const, confidence: "unknown" as const }),
  reserve: () => ({ eligible: true, quota: "unknown" as const, confidence: "unknown" as const,
    permit: { routeKey: "synthetic-test-only",
      revisions: { provider: 0, "provider-model": 0, account: 0, "account-model": 0 } } }),
  recordFailure: () => true,
  recordSuccess: () => {},
}
function policy(enabled = true) {
  return mergeConfig(defaults(), {
    "model-routing": { enabled, "default-class": "strong", "default-reasoning": "medium", "paid-fallback": false },
    "model-classes": { strong: { models: ["test-sol"] } },
    agents: { architect: { roles: ["architecture"] } },
    roles: { architecture: { "model-class": "strong", reasoning: "medium" } },
  })
}
function host(c = policy()) {
  const agents: Record<string, { model?: { providerID: string; id: string; variant?: string } }> = {
    architect: {}, unmanaged: {},
  }
  const hooks = new Map<string, (event: any) => Promise<void> | void>()
  let models = [structuredClone(MODEL)]
  let providers = [structuredClone(PROVIDER)]
  let connection: any = { ...ACCOUNT }
  let sessionAgent = "architect"
  let modelReads = 0
  const ctx: any = {
    app: { name: "opencode", version: "2.1.4", channel: "stable" },
    model: { list: async () => { modelReads++; return { data: models } } },
    provider: { list: async () => ({ data: providers }) },
    integration: { connection: { active: async () => connection } },
    agent: { transform: async (apply: any) => {
      apply({
        get: (id: string) => agents[id],
        update: (id: string, fn: any) => fn(agents[id]),
      })
      return { dispose: async () => {} }
    } },
    session: { get: async () => ({ data: { agent: sessionAgent } }),
      hook: async (name: string, callback: any) => {
      hooks.set(name, callback)
      return { dispose: async () => hooks.delete(name) }
    } },
    event: { subscribe: async function* ({ signal }: { signal: AbortSignal }) {
      // A real OpenCode event stream remains live until cancellation.
      // Returning immediately would simulate a lost terminal-event feed.
      await new Promise<void>(resolve => {
        if (signal.aborted) resolve()
        else signal.addEventListener("abort", () => resolve(), { once: true })
      })
    } },
  }
  const load = async () => ({ config: c, errors: [], sources: [] })
  return { ctx, agents, hooks, load, setConnection: (value: any) => { connection = value },
    setModels: (value: any[]) => { models = value }, setProviders: (value: any[]) => { providers = value },
    setSessionAgent: (value: string) => { sessionAgent = value },
    get modelReads() { return modelReads } }
}
const dispatch = (agent = "architect", model = { providerID: "openai", id: "test-sol", variant: "medium" },
  kind = "primary") => ({ sessionID: "sess_1", agent, model, kind, headers: {} })

describe("native 2.1.4 adapter boundary (mocked host callbacks, not installed-host proof)", () => {
  test("role selects native Agent.Info.model with verified billing and reasoning", async () => {
    const f = host()
    const registrations: Array<{ dispose(): Promise<void> }> = []
    const runtime = await registerModelRouting(f.ctx, f.load, registrations, new AbortController().signal, undefined, fakeQuota)
    expect(runtime.status).toBe("initial-only")
    expect(runtime.selected.architect).toEqual({
      provider_id: "openai", model_id: "test-sol", reasoning: "medium", billing: "included",
    })
    expect(f.agents.architect.model).toEqual({ providerID: "openai", id: "test-sol", variant: "medium" })
    expect(f.agents.unmanaged.model).toBeUndefined()
    const hook = f.hooks.get("model.request")!
    await hook(dispatch())
    expect(f.modelReads).toBeGreaterThan(1)
    for (const r of registrations) await r.dispose()
  })

  test("native global fallback, unknown/metered billing and wrong reasoning are rejected before provider requests", async () => {
    const f = host()
    await registerModelRouting(f.ctx, f.load, [], new AbortController().signal, undefined, fakeQuota)
    const hook = f.hooks.get("model.request")!
    await expect(hook(dispatch("architect", { providerID: "paid", id: "fallback", variant: "medium" }))).rejects.toThrow("MISMATCH")
    await expect(hook(dispatch("architect", { providerID: "openai", id: "test-sol", variant: "low" }))).rejects.toThrow("MISMATCH")
    f.setConnection({ type: "credential", id: "api-key-account", method: "key" })
    await expect(hook(dispatch())).rejects.toThrow("UNAVAILABLE")
    f.setConnection({ ...ACCOUNT })
    f.setModels([{ ...MODEL, cost: [ { input: 1, output: 2 } ] }])
    await expect(hook(dispatch())).rejects.toThrow("UNAVAILABLE")
    // An unrelated agent's *primary* model selection remains native.
    await expect(hook(dispatch("unmanaged", { providerID: "any", id: "native", variant: "none" }))).resolves.toBeUndefined()
  })

  test("provider/account stays pinned through primary continuations, never replayed", async () => {
    const f = host()
    await registerModelRouting(f.ctx, f.load, [], new AbortController().signal, undefined, fakeQuota)
    const hook = f.hooks.get("model.request")!
    await hook(dispatch())
    await hook(dispatch())
    f.setConnection({ ...ACCOUNT, id: "different-chatgpt-account" })
    await expect(hook(dispatch())).rejects.toThrow("AFFINITY")
  })

  test("missing native billing attestation blocks global default instead of silently charging", async () => {
    const f = host()
    f.setConnection({ ...ACCOUNT, method: "key" })
    const runtime = await registerModelRouting(f.ctx, f.load, [], new AbortController().signal, undefined, fakeQuota)
    expect(runtime.unavailable).toContain("architect")
    expect(f.agents.architect.model).toBeUndefined()
    await expect(f.hooks.get("model.request")!(dispatch())).rejects.toThrow("UNAVAILABLE")
  })

  test("auxiliary native model requests do not bypass paid-fallback false", async () => {
    const f = host()
    await registerModelRouting(f.ctx, f.load, [], new AbortController().signal, undefined, fakeQuota)
    const hook = f.hooks.get("model.request")!
    await expect(hook(dispatch("title", { providerID: "global-paid", id: "model", variant: "medium" }, "title")))
      .rejects.toThrow("UNAVAILABLE")
    await expect(hook(dispatch("title", { providerID: "openai", id: "test-sol", variant: "medium" }, "title")))
      .resolves.toBeUndefined()
    f.setSessionAgent("unmanaged")
    await expect(hook(dispatch("title", { providerID: "global-paid", id: "model", variant: "medium" }, "title")))
      .resolves.toBeUndefined()
  })

  test("disabled routing leaves native agents and all hooks untouched", async () => {
    const f = host(policy(false))
    const runtime = await registerModelRouting(f.ctx, f.load, [], new AbortController().signal, undefined, fakeQuota)
    expect(runtime.status).toBe("disabled")
    expect(f.agents.architect.model).toBeUndefined()
    expect(f.hooks.size).toBe(0)
  })

  test("host 2.1.1 does not falsely advertise native initial routing", async () => {
    const f = host()
    f.ctx.app.version = "2.1.1"
    const runtime = await registerModelRouting(f.ctx, f.load, [], new AbortController().signal, undefined, fakeQuota)
    expect(runtime.status).toBe("not-connected")
    await expect(f.hooks.get("model.request")!(dispatch("architect",
      { providerID: "native-default", id: "other", variant: "medium" }))).rejects.toThrow("MISMATCH")
  })

  test("configuration change fails closed until plugin restart", async () => {
    const f = host()
    let c = policy()
    const load = async () => ({ config: c, errors: [], sources: [] })
    await registerModelRouting(f.ctx, load, [], new AbortController().signal, undefined, fakeQuota)
    c = mergeConfig(c, { "model-routing": { "paid-fallback": true } })
    await expect(f.hooks.get("model.request")!(dispatch())).rejects.toThrow("RESTART_REQUIRED")
  })
})


test("unreadable layered config blocks native model dispatch instead of disabling the billing guard", async () => {
  const f = host()
  const load = async () => ({
    config: defaults(), errors: ["project/.loom.yaml: invalid YAML after enabled routing layer"],
    sources: ["user/.loom.yaml", "project/.loom.yaml"],
  })
  const runtime = await registerModelRouting(f.ctx, load, [], new AbortController().signal, undefined, fakeQuota)
  expect(runtime.status).toBe("blocked-config")
  expect(f.hooks.has("model.request")).toBe(true)
  expect(() => f.hooks.get("model.request")!(dispatch())).toThrow("LOOM_MODEL_ROUTING_CONFIG_UNREADABLE")
  expect(f.agents.architect.model).toBeUndefined()
})

test("lost native terminal-event subscription blocks further managed requests and rejects account switches", async () => {
  const f = host()
  f.ctx.event.subscribe = async function* () {
    throw new Error("test-only native event-stream disconnect")
  }
  const registrations: Array<{ dispose(): Promise<void> }> = []
  await registerModelRouting(f.ctx, f.load, registrations, new AbortController().signal, undefined, fakeQuota)
  await Bun.sleep(0)
  await expect(f.hooks.get("model.request")!(dispatch())).rejects.toThrow("LOOM_MODEL_ROUTING_EVENTS_UNAVAILABLE")
  for (const registration of registrations) await registration.dispose()
})


test("unqualified 2.2.0 host never installs live managed routing; valid disabled policy remains native", async () => {
  const managed = host()
  managed.ctx.app.version = "2.2.0"
  const runtime = await registerModelRouting(managed.ctx, managed.load, [], new AbortController().signal, undefined, fakeQuota)
  expect(runtime.status).toBe("not-connected")
  expect(managed.hooks.size).toBe(0)
  expect(managed.agents.architect.model).toBeUndefined()

  const disabled = host(policy(false))
  disabled.ctx.app.version = "2.2.0"
  const baseline = await registerModelRouting(disabled.ctx, disabled.load, [], new AbortController().signal, undefined, fakeQuota)
  expect(baseline.status).toBe("disabled")
  expect(disabled.hooks.size).toBe(0)
})
