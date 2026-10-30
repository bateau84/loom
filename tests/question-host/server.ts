/** External model fixture and PASSIVE traces only. No Loom implementation,
 * ToolContext fabrication, policy bridge, synthetic call, or native admission substitute. */
import { Plugin } from "@opencode/plugin"
import { appendFileSync, readFileSync } from "node:fs"
import { join, resolve } from "node:path"
import { randomUUID } from "node:crypto"

const provider = "question-fixture"
const providerPackage = "aisdk:" + new URL("./provider.mjs", import.meta.url).href
const usage = { inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 }, outputTokens: { total: 1, text: 1, reasoning: 0 } }

export default Plugin.define({
  id: "loom.question.fixture",
  async setup(ctx) {
    const root = process.env.LOOM_QUESTION_FIXTURE
    if (!root || resolve(ctx.location.directory) !== resolve(join(root, "project"))) throw new Error("Private question fixture location required")
    const audit = (type: string, data: unknown) => appendFileSync(join(root, "audit.ndjson"), JSON.stringify({ type, at: Date.now(), data }) + "\n")
    const issued = new Set<string>()
    const policyChecks = new Set<string>()
    const stop = new AbortController()
    const observer = (async () => {
      try {
        for await (const event of ctx.event.subscribe({ signal: stop.signal })) {
          if (event.type.startsWith("session.inbox.") || event.type.startsWith("session.compaction.") || event.type === "session.synthetic" || event.type.startsWith("permission.")) audit("native-event", event)
        }
      } catch (error) { if (!stop.signal.aborted) audit("observer-failure", String(error)) }
    })()
    const regs: Array<{ dispose(): Promise<void> }> = []
    const model = (role: string) => ({
      specificationVersion: "v3", provider, modelId: role, supportedUrls: {},
      doGenerate: async () => { throw new Error("Unexpected non-streaming model request") },
      doStream: async (input: any) => {
        audit("provider-request", { role, prompt: input.prompt, tools: input.tools })
        const users = input.prompt.filter((m: any) => m.role === "user").map((m: any) =>
          typeof m.content === "string" ? m.content : m.content.filter((p: any) => p.type === "text").map((p: any) => p.text).join("\n"))
        const text = users.join("\n")
        const ids = [...text.matchAll(/LOOM_HARNESS_JOB:([a-f0-9]+)/g)].map(m => m[1])
        const id = ids.at(-1)
        const jobs = JSON.parse(readFileSync(join(root, "jobs.json"), "utf8"))
        const code = id && !issued.has(id) ? jobs[id]?.code : undefined
        const nativeEdit = id && !issued.has(id) && jobs[id]?.nativeEdit === true
        if (code || nativeEdit) issued.add(id!)
        if (id && ((code && jobs[id]?.hold === "before") || (!code && jobs[id]?.hold === "after"))) {
          audit("provider-held", { role, job: id, phase: jobs[id].hold })
          for (let i = 0; ; i++) {
            if (stop.signal.aborted) throw new Error("Fixture disposed")
            if (i >= 1200) throw new Error("Local provider barrier timed out")
            if (!JSON.parse(readFileSync(join(root, "jobs.json"), "utf8"))[id]?.hold) break
            await new Promise(r => setTimeout(r, 25))
          }
        }
        // A resume notice requests authoritative retrieval, not answer authority.
        // Observe every provider request before the script guard; no-op output
        // cannot hide duplicate admission/continuation in the Python oracle.
        const notice = /Loom records: question ([^;]+); answer ([^.]+)\./g
        const notices = users.flatMap((s: string) => [...s.matchAll(notice)].map(m => ({ question: m[1], answer: m[2] })))
        audit("provider-inputs", { role, job: id, notices })
        const latest = notices.at(-1)
        const checkPolicy = role === "switched" && latest && !policyChecks.has(latest.answer)
        if (checkPolicy) policyChecks.add(latest.answer)
        const events: any[] = [{ type: "stream-start", warnings: [] }]
        if (code) {
          events.push({ type: "tool-call", toolCallId: randomUUID(), toolName: "execute", input: JSON.stringify({ code }) })
        } else if (nativeEdit) {
          events.push({ type: "tool-call", toolCallId: randomUUID(), toolName: "edit",
            input: JSON.stringify({ path: "permission-gate.txt", oldString: "prototype", newString: "safe" }) })
        } else if (checkPolicy) {
          // Two real negative controls: the omitted shell tool must not dispatch, and the
          // still-advertised native skill tool must honor the switched agent's deny-all policy.
          events.push({ type: "tool-call", toolCallId: randomUUID(), toolName: "shell",
            input: JSON.stringify({ command: "printf NATIVE_POLICY_MUST_DENY", description: "Harmless native deny countercheck" }) })
          events.push({ type: "tool-call", toolCallId: randomUUID(), toolName: "skill",
            input: JSON.stringify({ id: "loom" }) })
        } else {
          const summary = text.includes("You MUST use this format for your response") && text.includes("## Objective")
          events.push({ type: "text-start", id: "text" },
            { type: "text-delta", id: "text", delta: summary
              ? "## Objective\n- Verify context continuity across a native compaction.\n\n## Work State\n### Completed\n- Captured tool evidence.\n\n## Next Move\n1. Check the current Action selection and ledger."
              : "HARNESS_IDLE" },
            { type: "text-end", id: "text" })
        }
        events.push({ type: "finish", finishReason: { unified: code || nativeEdit || checkPolicy ? "tool-calls" : "stop", raw: code || nativeEdit || checkPolicy ? "tool_calls" : "stop" }, usage })
        return { stream: new ReadableStream({ start(c) { for (const e of events) c.enqueue(e); c.close() } }) }
      },
    })
    try {
      regs.push(await ctx.provider.transform(editor => {
        for (const p of editor.list()) editor.remove(p.provider.id)
        editor.add({ info: { id: provider, name: "Private scripted question fixture", activation: "enabled", package: providerPackage } as any,
          models: ["asker", "respondent", "reader", "switched"].map(id => ({ id, modelID: id, providerID: provider, name: id, package: providerPackage,
            capabilities: { tools: true, input: ["text"], output: ["text"] }, variants: [], time: { released: 0 }, cost: [], status: "active", enabled: true, limit: { context: 200000, output: 1000 } })) as any })
      }))
      regs.push(await ctx.aisdk.hook("sdk", event => {
        if (event.model.providerID !== provider) throw new Error("External provider forbidden")
        event.sdk = { languageModel: (id: string) => model(id) }
      }))
      regs.push(await ctx.session.hook("title", event => { event.result = "Private question qualification" }))
      regs.push(await ctx.session.hook("model.request", event => {
        if (event.model.providerID !== provider) throw new Error("External model request forbidden")
        audit("model-request", event)
      }))
      regs.push(await ctx.session.hook("prompt", event => { audit("prompt", event) }))
      regs.push(await ctx.tool.hook("execute.before", event => { audit("tool-before", event) }))
      regs.push(await ctx.tool.hook("execute.after", event => { audit("tool-after", event) }))
      audit("ready", { location: ctx.location })
    } catch (error) {
      stop.abort(); await observer; await Promise.allSettled(regs.map(r => r.dispose())); throw error
    }
    return async () => { stop.abort(); await observer; await Promise.allSettled(regs.map(r => r.dispose())) }
  },
})
