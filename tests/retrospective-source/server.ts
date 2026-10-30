/** Scripted SOURCE model for QA-B. Installed OpenCode executes every actual
 * native tool and persists original Session/tool results. This fixture cannot
 * forge their outcomes, cannot inject Loom tools, and never intercepts real models.
 */
import { Plugin } from "@opencode/plugin"
import { randomUUID } from "node:crypto"
import { realpathSync } from "node:fs"
import { resolve } from "node:path"

const provider = "qab-source"
const providerPackage = "aisdk:" + new URL("./provider.mjs", import.meta.url).href
const usage = { inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 1, text: 1, reasoning: 0 } }

function toText(content: unknown): string {
  if (typeof content === "string") return content
  if (!Array.isArray(content)) return ""
  return content.filter(x => x && typeof x === "object" && x.type === "text")
    .map(x => x.text).filter((x): x is string => typeof x === "string").join("\n")
}

export default Plugin.define({
  id: "loom.retrospective.qab.source",
  async setup(ctx) {
    const root = process.env.LOOM_QAB_ROOT
    if (!root || realpathSync(ctx.location.directory) !== resolve(root, "project"))
      throw new Error("Source provider requires the disposable QA-B project")
    const issued = new Map<string, number>()
    const model = () => ({
      specificationVersion: "v3" as const, provider, modelId: "scripted", supportedUrls: {},
      doGenerate: async () => { throw new Error("Unexpected non-streaming source request") },
      doStream: async (input: any) => {
        const user = [...(input.prompt ?? [])].reverse().find((m: any) => m.role === "user")
        const phase = /QA_B_SOURCE_PHASE:([a-z-]+)/.exec(toText(user?.content))?.[1]
        if (!phase) throw new Error("Source prompt lacks a phase marker")
        const count = issued.get(phase) ?? 0
        issued.set(phase, count + 1)
        const call = (toolName: string, args: object) =>
          ({ type: "tool-call", toolCallId: randomUUID(), toolName, input: JSON.stringify(args) })
        const events: any[] = [{ type: "stream-start", warnings: [] }]
        if ((phase === "worker-fail" || phase === "worker-retry") && count === 0) {
          events.push(call("edit", { path: "settings.json", oldString: "prototype", newString: "safe" }))
        } else if ((phase === "worker-retry" && count === 1) || (phase === "worker-verify" && count === 0)) {
          events.push(call("shell", { command: "python3 test_settings.py",
            description: "Verify synthetic settings privacy" }))
        } else {
          const prose: Record<string, string> = {
            coordinator: "Assigned settings update; telemetry must stay disabled.",
            "worker-fail": "Native edit attempted; recorded OpenCode tool result is authoritative.",
            "worker-retry": "Retried native edit and ran test_settings.py; inspect original results.",
            reviewer: "Privacy validation was missing initially; test_settings.py must check disabled telemetry.",
            "user-correction": "Correction noted; keep telemetry disabled and validate privacy.",
            "worker-verify": "Verified by running test_settings.py; inspect recorded native test result.",
          }
          if (!prose[phase]) throw new Error("Unknown QA-B source phase")
          events.push({ type: "text-start", id: "answer" },
            { type: "text-delta", id: "answer", delta: prose[phase] },
            { type: "text-end", id: "answer" })
        }
        const called = events.some(e => e.type === "tool-call")
        events.push({ type: "finish", finishReason: {
          unified: called ? "tool-calls" : "stop", raw: called ? "tool_calls" : "stop",
        }, usage })
        return { stream: new ReadableStream({ start(c) { for (const e of events) c.enqueue(e); c.close() } }) }
      },
    })
    const registrations: Array<{ dispose(): Promise<void> }> = []
    try {
      registrations.push(await ctx.provider.transform(editor => {
        // Existing real provider stays available, unmodified.
        editor.add({ info: { id: provider, name: "Private QA-B native source",
          activation: "enabled", package: providerPackage } as any,
          models: [{ id: "scripted", modelID: "scripted", providerID: provider,
            name: "Scripted source", package: providerPackage,
            capabilities: { tools: true, input: ["text"], output: ["text"] },
            variants: [], time: { released: 0 }, cost: [], status: "active",
            enabled: true, limit: { context: 200000, output: 1000 } }] as any })
      }))
      registrations.push(await ctx.aisdk.hook("sdk", event => {
        if (event.model.providerID === provider) event.sdk = { languageModel: () => model() }
      }))
    } catch (error) {
      await Promise.allSettled(registrations.map(r => r.dispose()))
      throw error
    }
    return async () => { await Promise.allSettled(registrations.map(r => r.dispose())) }
  },
})
