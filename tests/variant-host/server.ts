/** Disposable OpenCode 2.2.6 provider-side instruction delivery probe.
 * This fixture never registers a skill, changes an agent, or alters Loom.
 * It records only hashes, harmless marker presence, native linkage and request kind.
 */
import { Plugin } from "@opencode/plugin"
import { createHash } from "node:crypto"
import { appendFileSync, readFileSync } from "node:fs"
import { join, resolve } from "node:path"

const providerID = "variant-fixture"
const packageURL = "aisdk:" + new URL("./provider.mjs", import.meta.url).href
const marker = "LOOM_VARIANT_TEST_ONLY_V1"
const key = "loom.variant.test"
const hash = (value: string) => createHash("sha256").update(value, "utf8").digest("hex")
const usage = {
  inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 1, text: 1, reasoning: 0 },
}

export default Plugin.define({
  id: "loom.variant.qualification.fixture",
  async setup(ctx) {
    const root = process.env.LOOM_VARIANT_FIXTURE_ROOT
    if (!root || resolve(ctx.location.directory) !== resolve(join(root, "project")))
      throw new Error("Variant fixture must run only in its disposable project")
    const audit = (type: string, data: Record<string, unknown>) => {
      // A failed receipt is an error, never a clean provider delivery.
      appendFileSync(join(root, "variant-events.ndjson"), JSON.stringify({ type, data }) + "\n")
    }
    const model = (id: string) => ({
      specificationVersion: "v3",
      provider: providerID,
      modelId: id,
      supportedUrls: {},
      doGenerate: async () => { throw new Error("Unexpected unobserved nonstreaming request") },
      doStream: async (input: any) => {
        const prompt = Array.isArray(input.prompt) ? input.prompt : []
        const text = (part: any) => typeof part?.content === "string" ? part.content :
          Array.isArray(part?.content) ? part.content.map((value: any) =>
            typeof value?.text === "string" ? value.text : "").join("\n") : ""
        const system = prompt.filter((part: any) => part?.role === "system").map(text).join("\n")
        const userText = prompt.filter((part: any) => part?.role === "user").map(text).join("\n")
        const cases = [...userText.matchAll(/VARIANT_CASE:([a-z0-9-]+)/g)]
        const testCase = cases.at(-1)?.[1] ?? null
        const match = system.match(/<context key="loom\.variant\.test">\n([\s\S]*?)\n<\/context>/)
        const payload = {
          testCase, model: id, effective_sha256: hash(system),
          candidate_sha256: match ? hash(match[1]) : null,
          entry_seen: match !== null, marker_seen: system.includes(marker),
          system_bytes: Buffer.byteLength(system, "utf8"),
          user_marker_seen: userText.includes(marker),
        }
        audit("provider-request", payload)
        // Concurrency proof: both requests must reach the actual model boundary
        // before the harness releases either. A stalled or broken barrier fails.
        const deadline = Date.now() + 30000
        while (true) {
          const barrier = JSON.parse(readFileSync(join(root, "variant-barrier.json"), "utf8"))
          if (barrier.release === true) break
          if (Date.now() > deadline) throw new Error("Variant provider barrier timed out")
          await new Promise(done => setTimeout(done, 25))
        }
        const contextText = JSON.stringify(prompt)
        const output = contextText.includes("You MUST use this format for your response") && contextText.includes("## Objective")
          ? "## Objective\n- Qualify a local instruction boundary.\n\n## Work State\n### Completed\n- Native request observed.\n\n## Next Move\n1. Continue the fixture."
          : "VARIANT_FIXTURE_OK"
        const events: any[] = [
          { type: "stream-start", warnings: [] },
          { type: "text-start", id: "text" },
          { type: "text-delta", id: "text", delta: output },
          { type: "text-end", id: "text" },
          { type: "finish", finishReason: { unified: "stop", raw: "stop" }, usage },
        ]
        return { stream: new ReadableStream({
          start(controller) { for (const event of events) controller.enqueue(event); controller.close() },
        }) }
      },
    })
    const disposers: Array<{ dispose(): Promise<void> }> = []
    try {
      disposers.push(await ctx.provider.transform(editor => {
        // Only this disposable host is used. No network provider may remain.
        for (const existing of editor.list()) editor.remove(existing.provider.id)
        editor.add({
          info: { id: providerID, name: "Disposable instruction-variant observer",
            activation: "enabled", package: packageURL } as any,
          models: [{
            id: "scripted", modelID: "scripted", providerID, name: "Scripted observer",
            package: packageURL, capabilities: { tools: true, input: ["text"], output: ["text"] },
            variants: [], time: { released: 0 }, cost: [], status: "active", enabled: true,
            limit: { context: 200000, output: 1000 },
          }] as any,
        })
      }))
      disposers.push(await ctx.aisdk.hook("sdk", event => {
        if (event.model.providerID !== providerID) throw new Error("External provider is forbidden")
        event.sdk = { languageModel: (id: string) => model(id) }
      }))
      disposers.push(await ctx.session.hook("title", event => { event.result = "Disposable variant fixture" }))
      disposers.push(await ctx.session.hook("model.request", event => {
        if (event.model.providerID !== providerID) throw new Error("Non-fixture request is forbidden")
        audit("native-request", {
          sessionID: event.sessionID, agent: event.agent, kind: event.kind,
          model: event.model.id, providerID: event.model.providerID,
        })
      }))
      disposers.push(await ctx.session.hook("context", event => {
        // Earlier-than-provider evidence, never treated as the final payload.
        audit("context-hook", {
          sessionID: event.sessionID, agent: event.agent,
          stage_sha256: hash(event.system.map(part => part.text).join("\n")),
        })
      }))
      audit("fixture-ready", { host: ctx.app.version, providerID, key })
    } catch (error) {
      await Promise.allSettled(disposers.map(disposer => disposer.dispose()))
      throw error
    }
    return async () => { await Promise.allSettled(disposers.map(disposer => disposer.dispose())) }
  },
})
