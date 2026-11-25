/** Installed native provider mechanics only. No production dispatch registration,
 * no operator authority, no genuine Evaluator, no real account or provider I/O.
 */
import { Plugin } from "@opencode/plugin"
import { createHash } from "node:crypto"
import { existsSync } from "node:fs"
import { join, resolve } from "node:path"
import { FixtureStore, MODEL, PROVIDER, RESULT } from "./fixture-store.js"

const providerPackage = "aisdk:" + new URL("./provider.mjs", import.meta.url).href
const sha = (text: string) => createHash("sha256").update(text).digest("hex")
const usage = { inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 1, text: 1, reasoning: 0 } }

export default Plugin.define({
  id: "loom.evaluator.execution.fixture",
  async setup(ctx) {
    const root = process.env.LOOM_EXECUTION_FIXTURE
    if (!root || resolve(ctx.location.directory) !== resolve(join(root, "project")))
      throw new Error("Private evaluator execution fixture location required")
    const store = new FixtureStore(root), stop = new AbortController()
    const registrations: Array<{ dispose(): Promise<void> }> = []
    const observer = (async () => {
      try {
        for await (const event of ctx.event.subscribe({ signal: stop.signal })) {
          if (event.type.startsWith("session.execution.") || event.type.startsWith("session.step.")
            || event.type === "session.created" || event.type.startsWith("session.inbox.")) {
            // Synthetic test corpus only; nevertheless retain IDs/lifecycle, never prompt/tool bodies.
            const data = event.data as Record<string, unknown>
            store.event("native-event", { type: event.type, session_id: data.sessionID,
              message_id: data.assistantMessageID ?? data.inboxID, reason: data.reason ?? null,
              finish: data.finish ?? null })
          }
        }
      } catch { if (!stop.signal.aborted) store.event("observer-failure", {}) }
    })()
    const model = (id: string) => ({
      specificationVersion: "v3", provider: PROVIDER, modelId: id, supportedUrls: {},
      doGenerate: async () => { throw new Error("No nonstreaming fixture requests are authorized") },
      doStream: async (input: any) => {
        const headers = new Headers(input.headers)
        const session = headers.get("x-opencode-session-id") ?? ""
        const users = input.prompt.filter((message: any) => message.role === "user")
        const content = users.at(-1)?.content
        const text = typeof content === "string" ? content : Array.isArray(content)
          ? content.filter((part: any) => part.type === "text").map((part: any) => part.text).join("\n") : ""
        const admitted = store.claim(session, { model: id,
          agent: headers.get("x-loom-fixture-agent") ?? "", kind: headers.get("x-loom-fixture-kind") ?? "",
          prompt_sha256: sha(text) })
        if (!admitted) throw new Error("Fixture provider admission denied")
        if (admitted.mode === "hold") {
          store.event("provider-held", { issue_key: admitted.issue_key, session_id: session })
          const deadline = Date.now() + 30000
          while (!existsSync(join(root, "release-" + admitted.input_id))) {
            if (stop.signal.aborted || input.abortSignal?.aborted) throw new Error("Fixture provider interrupted after admission")
            if (Date.now() >= deadline) throw new Error("Fixture provider barrier timed out after admission")
            await new Promise(done => setTimeout(done, 25))
          }
        }
        store.event("provider-returned", { issue_key: admitted.issue_key, session_id: session, result_sha256: sha(RESULT) })
        const events = [{ type: "stream-start", warnings: [] }, { type: "text-start", id: "result" },
          { type: "text-delta", id: "result", delta: RESULT }, { type: "text-end", id: "result" },
          { type: "finish", finishReason: { unified: "stop", raw: "stop" }, usage }]
        return { stream: new ReadableStream({ start(controller) {
          for (const event of events) controller.enqueue(event)
          controller.close()
        } }) }
      },
    })
    try {
      registrations.push(await ctx.provider.transform(editor => {
        for (const item of editor.list()) editor.remove(item.provider.id)
        editor.add({ info: { id: PROVIDER, name: "Local Evaluator execution mechanics", activation: "enabled", package: providerPackage } as any,
          models: [MODEL].map(id => ({ id, modelID: id, providerID: PROVIDER, name: id, package: providerPackage,
            capabilities: { tools: false, input: ["text"], output: ["text"] }, variants: [], time: { released: 0 },
            cost: [], status: "active", enabled: true, limit: { context: 200000, output: 1000 } })) as any })
      }))
      registrations.push(await ctx.aisdk.hook("sdk", event => {
        if (event.model.providerID !== PROVIDER) throw new Error("External provider forbidden in fixture")
        event.sdk = { languageModel: (id: string) => model(id) }
      }))
      registrations.push(await ctx.session.hook("title", event => { event.result = "Restricted execution mechanics" }))
      registrations.push(await ctx.session.hook("model.request", event => {
        if (event.model.providerID !== PROVIDER) throw new Error("External model request forbidden")
        event.headers["x-loom-fixture-agent"] = event.agent
        event.headers["x-loom-fixture-kind"] = event.kind
        store.event("model-request", { session_id: event.sessionID, agent: event.agent,
          kind: event.kind, provider_id: event.model.providerID, model_id: event.model.id })
      }))
      registrations.push(await ctx.session.hook("retry", event => {
        event.decision = { retry: false }
        store.event("retry-denied", { session_id: event.sessionID })
      }))
      store.event("fixture-ready", { host_version: ctx.app.version })
    } catch (error) {
      stop.abort(); await observer
      await Promise.allSettled(registrations.map(item => item.dispose())); store.close(); throw error
    }
    return async () => {
      stop.abort(); await observer
      await Promise.allSettled(registrations.map(item => item.dispose())); store.close()
    }
  },
})
