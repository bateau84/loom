/** A deterministic LOCAL V2 provider fixture. Not a router, quota source or auth mock.
 * It registers only scripted providers and records native transport/tool events.
 * Every model implementation is in memory; network provider requests are prohibited.
 */
import { Plugin } from "@opencode/plugin"
import { appendFileSync, readFileSync } from "node:fs"
import { resolve, join } from "node:path"
import { randomUUID } from "node:crypto"

const routes = [
  { id: "route-primary", models: ["sol", "astra"], price: false },
  { id: "route-secondary", models: ["sol"], price: false },
  { id: "route-metered", models: ["sol"], price: true },
] as const
const valid = new Set<string>(routes.map(r => r.id))
const providerPackage = "aisdk:" + new URL("./provider.mjs", import.meta.url).href
const usage = {
  inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 1, text: 1, reasoning: 0 },
}
type Scenario = { kind: "text" | "tool" | "pre-output-error" | "partial-error" }

export default Plugin.define({
  id: "loom.routing.acceptance.fixture",
  async setup(ctx) {
    const root = process.env.LOOM_ROUTING_FIXTURE
    if (!root || resolve(ctx.location.directory) !== resolve(join(root, "project")))
      throw new Error("Private routing fixture root/project is required")
    const audit = (type: string, data: Record<string, unknown> = {}) => {
      // Intentionally omit prompts, headers, auth objects, connection IDs and tool inputs.
      appendFileSync(join(root, "routing-events.ndjson"), JSON.stringify({ type, data }) + "\n")
    }
    const scenario = (): Scenario => JSON.parse(readFileSync(join(root, "scenario.json"), "utf8"))
    const streamModel = (providerID: string, modelID: string) => ({
      specificationVersion: "v3",
      provider: providerID,
      modelId: modelID,
      supportedUrls: {},
      doGenerate: async () => { throw new Error("Unexpected non-streaming routing fixture request") },
      doStream: async (input: any) => {
        const kind = scenario().kind
        // A real native tool result, not a fixture-issued boolean, is required
        // before moving from tool to text. Replayed tool calls stay observable.
        const afterTool = Array.isArray(input.prompt) && input.prompt.some((item: any) =>
          item.role === "tool" || (Array.isArray(item.content) &&
            item.content.some((part: any) => part.type === "tool-result")))
        audit("provider-request", { providerID, modelID, kind, afterTool: Boolean(afterTool) })
        if (kind === "pre-output-error") throw new Error("ROUTING_FIXTURE_BEFORE_OUTPUT")
        const events: any[] = [{ type: "stream-start", warnings: [] }]
        const tool = kind === "tool" && !afterTool
        if (tool) {
          events.push({ type: "tool-call", toolCallId: randomUUID(), toolName: "execute",
            input: JSON.stringify({ code: "return search({namespace:'loom',limit:2}).items.length" }) })
        } else {
          events.push({ type: "text-start", id: "message" },
            { type: "text-delta", id: "message", delta: "ROUTING_FIXTURE_OK" },
            { type: "text-end", id: "message" })
        }
        if (kind !== "partial-error") {
          events.push({ type: "finish",
            finishReason: { unified: tool ? "tool-calls" : "stop", raw: tool ? "tool_calls" : "stop" }, usage })
        }
        return { stream: new ReadableStream({
          start(controller) {
            for (const event of events) controller.enqueue(event)
            if (kind === "partial-error") controller.error(new Error("ROUTING_FIXTURE_AFTER_OUTPUT"))
            else controller.close()
          },
        }) }
      },
    })
    const registrations: Array<{ dispose(): Promise<void> }> = []
    try {
      registrations.push(await ctx.provider.transform(editor => {
        for (const item of editor.list()) editor.remove(item.provider.id)
        for (const route of routes) {
          editor.add({
            info: { id: route.id, name: "Local " + route.id, activation: "enabled",
              package: providerPackage } as any,
            models: route.models.map(id => ({
              id, modelID: id, providerID: route.id, name: "Local " + id,
              package: providerPackage,
              capabilities: { tools: true, input: ["text"], output: ["text"] },
              variants: [{ id: "medium", settings: { reasoningEffort: "medium" } }],
              time: { released: 0 },
              cost: route.price ? [{ input: 5, output: 5 }] : [],
              status: "active", enabled: true,
              limit: { context: 200000, output: 1000 },
            })) as any,
          })
        }
      }))
      registrations.push(await ctx.aisdk.hook("sdk", event => {
        if (!valid.has(event.model.providerID))
          throw new Error("Routing fixture refused nonlocal provider transport")
        const providerID = event.model.providerID
        event.sdk = { languageModel: (id: string) => streamModel(providerID, id) }
      }))
      registrations.push(await ctx.session.hook("title", event => {
        event.result = "Local routing acceptance fixture"
      }))
      registrations.push(await ctx.session.hook("model.request", event => {
        audit("model-request", { providerID: event.model.providerID,
          modelID: event.model.id, agent: event.agent, kind: event.kind,
          sessionID: event.sessionID, reasoning: event.model.variant ?? null })
      }))
      registrations.push(await ctx.tool.hook("execute.before", event => {
        audit("tool-before", { sessionID: event.sessionID, tool: event.tool })
      }))
      registrations.push(await ctx.tool.hook("execute.after", event => {
        audit("tool-after", { sessionID: event.sessionID, tool: event.tool,
          status: event.status })
      }))
      audit("fixture-ready", { providerIDs: routes.map(r => r.id) })
    } catch (error) {
      await Promise.allSettled(registrations.map(r => r.dispose()))
      throw error
    }
    return async () => { await Promise.allSettled(registrations.map(r => r.dispose())) }
  },
})
