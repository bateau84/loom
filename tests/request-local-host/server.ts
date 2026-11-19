/** Installed native request-local selection mechanics; not billing evidence.
 * All providers are in-memory. The harness, not generated model text, supplies
 * a private persisted Session-ID -> assignment map. No real account is used.
 */
import { Model, Plugin, Provider } from "@opencode/plugin"
import { APICallError } from "@ai-sdk/provider"
import { appendFileSync, readFileSync } from "node:fs"
import { join, resolve } from "node:path"
import { pathToFileURL } from "node:url"
import { randomUUID } from "node:crypto"

type Case = {
  name: string
  tier?: "standard" | "advanced" | "frontier"
  scenario?: "text" | "tool"
  nativeTitle?: boolean
  titleRejectPreferred?: boolean
  overrideModel?: string
  provider?: string
  billing?: "included" | "unknown" | "metered"
  uncertain?: boolean
  lateModel?: string
  exhaustAfterResolve?: boolean
  retryKind?: "primary" | "generate" | "compaction"
  /** Fixture-only eligibility change between native transport attempts. */
  exhaustAfterFirstTransport?: boolean
  concurrent?: boolean
}
const providerID = "request-local"
const providerPackage = "aisdk:" + new URL("./provider.mjs", import.meta.url).href
const usage = {
  inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 1, text: 1, reasoning: 0 },
}

export default Plugin.define({
  id: "loom.request-local.fixture",
  async setup(ctx) {
    const root = process.env.LOOM_REQUEST_LOCAL_FIXTURE
    const plugin = process.env.LOOM_REQUEST_LOCAL_PLUGIN
    if (!root || !plugin || resolve(ctx.location.directory) !== resolve(join(root, "project")))
      throw new Error("Private request-local fixture root/project and installed package are required")
    const { registerRequestLocalModelSelectionCandidate } = await import(
      pathToFileURL(join(plugin, "src/request-local-model-routing.ts")).href)
    const { defaults, mergeConfig } = await import(pathToFileURL(join(plugin, "src/config.ts")).href)
    const audit = (type: string, data: Record<string, unknown>) => {
      appendFileSync(join(root, "request-local-events.ndjson"), JSON.stringify({ type, data }) + "\n")
    }
    const cases = (): Record<string, Case> => JSON.parse(readFileSync(join(root, "cases.json"), "utf8"))
    const one = (sessionID: string): Case => {
      const entry = cases()[sessionID]
      if (!entry) throw new Error("REQUEST_LOCAL_FIXTURE_UNBOUND_SESSION")
      return entry
    }
    const exhausted = new Set<string>()
    const failedOnce = new Set<string>()
    const retryAllowed = new Set<string>()
    const titleResolves = new Map<string, number>()
    const overlap: Array<() => void> = []
    const rendezvous = () => new Promise<void>((done, fail) => {
      const timer = setTimeout(() => fail(new Error("REQUEST_LOCAL_FIXTURE_NO_CONCURRENT_TRANSPORT")), 5000)
      overlap.push(() => { clearTimeout(timer); done() })
      if (overlap.length === 2) {
        audit("concurrent-transports", { count: 2 })
        for (const release of overlap.splice(0)) release()
      }
    })
    const regs: Array<{ dispose(): Promise<void> }> = []
    const lifetime = new AbortController()
    const eventRef = (event: { sessionID: string; agent: string; kind: string; model: { providerID: string; id: string; variant?: string } }) => ({
      sessionID: event.sessionID, agent: event.agent, kind: event.kind,
      providerID: event.model.providerID, modelID: event.model.id, variant: event.model.variant ?? null,
    })
    const transport = (id: string, input: any, mode: "stream" | "generate") => {
      const headers = new Headers(input.headers)
      const sessionID = headers.get("x-loom-fixture-session")
      const kind = headers.get("x-loom-fixture-kind")
      if (!sessionID || !kind) throw new Error("REQUEST_LOCAL_FIXTURE_MISSING_NATIVE_HEADERS")
      const c = one(sessionID)
      const afterTool = input.prompt.some((item: any) => item.role === "tool" ||
        (Array.isArray(item.content) && item.content.some((part: any) => part.type === "tool-result")))
      audit("transport", { sessionID, kind, providerID, modelID: id, mode,
        variant: headers.get("x-loom-fixture-variant"), afterTool })
      if (c.retryKind === kind && !failedOnce.has(sessionID + ":" + kind)) {
        failedOnce.add(sessionID + ":" + kind)
        audit("transport-failure", { sessionID, kind, modelID: id })
        if (c.exhaustAfterFirstTransport) {
          // Represents a policy/quota change after one physical provider
          // attempt. No native request callback runs for prepared retries.
          exhausted.add(sessionID)
          audit("eligibility-changed", { sessionID, kind, status: "exhausted", when: "after-first-send" })
        }
        throw new APICallError({ message: "REQUEST_LOCAL_FIXTURE_RETRY", url: "http://127.0.0.1/never-sent",
          requestBodyValues: {}, statusCode: 503, isRetryable: true })
      }
      return { c, kind, afterTool }
    }
    const language = (id: string) => ({
      specificationVersion: "v3", provider: providerID, modelId: id, supportedUrls: {},
      doGenerate: async (input: any) => {
        transport(id, input, "generate")
        return { content: [{ type: "text", text: "REQUEST_LOCAL_GENERATE_OK" }],
          finishReason: { unified: "stop", raw: "stop" }, usage, warnings: [] }
      },
      doStream: async (input: any) => {
        const { c, kind, afterTool } = transport(id, input, "stream")
        if (c.concurrent && kind === "primary") await rendezvous()
        const tool = c.scenario === "tool" && kind === "primary" && !afterTool
        const events: any[] = [{ type: "stream-start", warnings: [] }]
        if (tool) {
          events.push({ type: "tool-call", toolCallId: randomUUID(), toolName: "execute",
            input: JSON.stringify({ code: "return search({namespace:'loom',limit:2}).items.length" }) })
        } else {
          const text = kind === "compaction"
            ? "## Objective\n- Qualify local request selection.\n\n## Work State\n### Completed\n- Native fixture request completed.\n\n## Next Move\n1. Continue without repeating tools."
            : kind === "generate" ? "REQUEST_LOCAL_GENERATE_OK" : "REQUEST_LOCAL_FIXTURE_OK"
          events.push({ type: "text-start", id: "message" }, { type: "text-delta", id: "message", delta: text },
            { type: "text-end", id: "message" })
        }
        events.push({ type: "finish", finishReason: { unified: tool ? "tool-calls" : "stop",
          raw: tool ? "tool_calls" : "stop" }, usage })
        return { stream: new ReadableStream({ start(controller) {
          for (const event of events) controller.enqueue(event)
          controller.close()
        } }) }
      },
    })
    try {
      regs.push(await ctx.provider.transform(editor => {
        for (const item of editor.list()) editor.remove(item.provider.id)
        editor.add({
          info: { id: providerID, name: "Local request resolver fixture", activation: "enabled",
            package: providerPackage } as any,
          models: ["default", "fast", "sol", "astra", "limited"].map(id => ({
            id, modelID: id, providerID, name: "Local " + id, package: providerPackage,
            capabilities: { tools: true, input: ["text"], output: ["text"] },
            variants: (id === "limited" ? ["medium"] : ["medium", "high"]).map(variant => ({
              id: variant, headers: { "x-loom-fixture-variant": variant },
            })),
            time: { released: 0 }, cost: [], enabled: true, status: "active",
            limit: { context: 200000, output: 1000 },
          })) as any,
        })
      }))
      regs.push(await ctx.aisdk.hook("sdk", event => {
        if (event.model.providerID !== providerID) throw new Error("REQUEST_LOCAL_FIXTURE_REFUSED_NONLOCAL_PROVIDER")
        event.sdk = { languageModel: language }
      }))
      regs.push(await ctx.session.hook("experimental.model.resolve", event => audit("resolve-input", eventRef(event))))
      regs.push(await ctx.session.hook("model.request", event => {
        audit("request-input", eventRef(event))
        event.headers["x-loom-fixture-session"] = event.sessionID
        event.headers["x-loom-fixture-kind"] = event.kind
      }))
      await registerRequestLocalModelSelectionCandidate(ctx, async (input: { sessionID: string; agent: string; kind: string }) => {
        const c = one(input.sessionID)
        const chosenProvider = c.provider ?? providerID
        const config = mergeConfig(defaults(), {
          "model-routing": { enabled: true, "default-class": "standard", "default-reasoning": "medium", "paid-fallback": false },
          "model-classes": { standard: { models: [c.overrideModel ?? "fast"] },
            advanced: { models: [c.overrideModel ?? "sol"] }, frontier: { models: [c.overrideModel ?? "astra"] } },
          agents: { architect: { roles: ["architecture"] } },
          roles: { architecture: { "model-class": "standard", reasoning: "medium", "workload-tiers": {
            advanced: { "model-class": "advanced", reasoning: "high" },
            frontier: { "model-class": "frontier", reasoning: "high" },
          } } },
        })
        // The included label below is fixture-owned planner input, not an account
        // attestation. No production entrypoint consumes it or this loader.
        const inventory = ["fast", "sol", "astra", ...(c.overrideModel ? [c.overrideModel] : [])]
          .map(modelID => ({ providerID: chosenProvider, modelID, enabled: true, tools: true,
            billing: c.billing ?? "included", quota: exhausted.has(input.sessionID) ? "exhausted" : "unknown",
            reasoning: ["medium", "high"] }))
        return { snapshot: { config, errors: [], sources: ["private-fixture-policy"] }, inventory,
          assignment: { assignmentId: c.name, objectiveId: "fixture-" + c.name,
            boundary: "new-assignment", riskFactors: [],
            assessment: { status: c.uncertain ? "uncertain" : "assessed", confidence: "high", sourceRef: "private-fixture" },
            quality: { minimumTier: "standard", minimumReasoning: "medium", independence: "not-required" },
            spending: "included-only", requestedTier: c.tier ?? "standard" } }
      }, regs, lifetime.signal)
      regs.push(await ctx.session.hook("experimental.model.resolve", event => {
        const c = one(event.sessionID)
        audit("resolve-output", eventRef(event))
        if (c.exhaustAfterResolve) exhausted.add(event.sessionID)
        if (event.kind === "title") {
          const count = (titleResolves.get(event.sessionID) ?? 0) + 1
          titleResolves.set(event.sessionID, count)
          if (c.titleRejectPreferred && count === 2) {
            // The host can try a preferred title model and fall back to the
            // first resolved choice. Fail only that speculative second path.
            event.model = { providerID: Provider.ID.make("unavailable-title-provider"),
              id: Model.ID.make("rejected"), variant: Model.VariantID.make("medium") }
            audit("title-preferred-rejected", { sessionID: event.sessionID, kind: "title", count })
          }
        }
        if (c.lateModel) {
          event.model = { providerID: Provider.ID.make(providerID), id: Model.ID.make(c.lateModel),
            variant: Model.VariantID.make("medium") }
          audit("late-resolver-change", eventRef(event))
        }
      }))
      regs.push(await ctx.session.hook("model.request", event => audit("request-approved", eventRef(event))))
      regs.push(await ctx.session.hook("title", event => {
        if (!one(event.sessionID).nativeTitle) event.result = "Local request selection fixture"
      }))
      regs.push(await ctx.session.hook("retry", event => {
        audit("retry", { sessionID: event.sessionID, agent: event.agent, attempt: event.attempt,
          providerID: event.model.providerID, modelID: event.model.id })
        // The first host retry advertises next-attempt ordinal 2. Count one
        // fixture retry decision; never reinterpret that ordinal as identity.
        const permit = Boolean(one(event.sessionID).retryKind) && !retryAllowed.has(event.sessionID)
        if (permit) retryAllowed.add(event.sessionID)
        event.decision = permit ? { retry: true, delay: 1 } : { retry: false }
      }))
      regs.push(await ctx.tool.hook("execute.before", event => {
        audit("tool-before", { sessionID: event.sessionID, tool: event.tool })
      }))
      regs.push(await ctx.tool.hook("execute.after", event => {
        audit("tool-after", { sessionID: event.sessionID, tool: event.tool, status: event.status })
      }))
      audit("fixture-ready", { hostVersion: ctx.app.version, candidate: "installed-package", liveBillingQualified: false })
    } catch (error) {
      lifetime.abort()
      await Promise.allSettled(regs.map(r => r.dispose()))
      throw error
    }
    return async () => {
      lifetime.abort()
      await Promise.allSettled(regs.map(r => r.dispose()))
    }
  },
})
