/** Installed native provider mechanics only. No production dispatch registration,
 * no operator authority, no genuine Evaluator, no real account or provider I/O.
 */
import { Plugin } from "@opencode/plugin"
import { createHash } from "node:crypto"
import { existsSync, readFileSync } from "node:fs"
import { join, resolve } from "node:path"
import { FixtureStore, MODEL, PROVIDER, RESULT, SOURCE_TOOL } from "./fixture-store.js"
import { scriptedInterpretation } from "./interpretation.js"

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
    const retrospective = JSON.parse(readFileSync(join(root, "policy.json"), "utf8")).preparation_source === "retrospective"
    const registrations: Array<{ dispose(): Promise<void> }> = []
    const observer = (async () => {
      try {
        for await (const event of ctx.event.subscribe({ signal: stop.signal })) {
          if (event.type.startsWith("session.execution.") || event.type.startsWith("session.step.")
            || event.type === "session.created" || event.type.startsWith("session.inbox.") || event.type.startsWith("session.tool.")) {
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
        const sourceResults = input.prompt.filter((message: any) => message.role === "tool")
          .flatMap((message: any) => Array.isArray(message.content) ? message.content : [])
          .filter((part: any) => part.type === "tool-result" && part.toolName === SOURCE_TOOL)
        const result = sourceResults.length === 1 ? sourceResults[0] : undefined
        const sourceText = result?.output?.type === "text" && typeof result.output.value === "string" ? result.output.value : undefined
        if (result) store.event("provider-source-observed", { session_id: session,
          bytes: sourceText === undefined ? null : Buffer.byteLength(sourceText),
          sha256: sourceText === undefined ? null : sha(sourceText), call_id: result.toolCallId,
          output_type: result.output?.type ?? null, output_keys: Object.keys(result.output ?? {}),
          output_bytes: Buffer.byteLength(JSON.stringify(result.output)),
          output_sha256: sha(JSON.stringify(result.output)),
          content_texts: result.output?.type === "content" && Array.isArray(result.output.value)
            ? result.output.value.filter((part: any) => part.type === "text" && typeof part.text === "string")
              .map((part: any) => ({ bytes: Buffer.byteLength(part.text), sha256: sha(part.text) })) : [] })
        const admitted = store.claim(session, { model: id,
          agent: headers.get("x-loom-fixture-agent") ?? "", kind: headers.get("x-loom-fixture-kind") ?? "",
          prompt_sha256: sha(text), ...(sourceText === undefined ? {} : {
            source_result_sha256: sha(sourceText), source_tool_id: result.toolCallId }) })
        if (!admitted) throw new Error("Fixture provider admission denied")
        const retrieve = admitted.request_limit === 2 && admitted.sends === 0
        if (!retrieve && admitted.mode === "hold") {
          store.event("provider-held", { issue_key: admitted.issue_key, session_id: session })
          const deadline = Date.now() + 30000
          while (!existsSync(join(root, "release-" + admitted.input_id))) {
            if (stop.signal.aborted || input.abortSignal?.aborted) throw new Error("Fixture provider interrupted after admission")
            if (Date.now() >= deadline) throw new Error("Fixture provider barrier timed out after admission")
            await new Promise(done => setTimeout(done, 25))
          }
        }
        const policy = JSON.parse(readFileSync(join(root, "policy.json"), "utf8"))
        const response = !retrieve && policy.interpretation_mode
          ? scriptedInterpretation(sourceText!, policy.interpretation_mode, policy.prior_report) : RESULT
        store.event(retrieve ? "provider-requested-source" : "provider-returned", { issue_key: admitted.issue_key,
          session_id: session, ...(retrieve ? {} : { result_sha256: sha(response),
            ...(sourceText === undefined ? {} : { source_result_sha256: sha(sourceText), source_bytes: Buffer.byteLength(sourceText) }) }) })
        const events: unknown[] = [{ type: "stream-start", warnings: [] }]
        if (retrieve) events.push({ type: "tool-call", toolCallId: "call_eval_" + admitted.issue_key.slice(0, 32),
          toolName: SOURCE_TOOL, input: "{}" })
        else events.push({ type: "text-start", id: "result" }, { type: "text-delta", id: "result", delta: response },
          { type: "text-end", id: "result" })
        events.push({ type: "finish", finishReason: { unified: retrieve ? "tool-calls" : "stop",
          raw: retrieve ? "tool_calls" : "stop" }, usage })
        return { stream: new ReadableStream({ start(controller) {
          for (const event of events) controller.enqueue(event)
          controller.close()
        } }) }
      },
    })
    try {
      if (retrospective) registrations.push(await ctx.tool.transform(editor => {
        editor.add({ name: SOURCE_TOOL, description: "Retrieve this controlled execution's exact permitted frozen evidence.",
          input: { type: "object", properties: {}, additionalProperties: false }, options: { codemode: false },
          execute: async (_input, context) => {
            const row = store.recipient(context.sessionID)
            if (!row || row.request_limit !== 2 || !row.enabled || row.revoked || row.sends !== 1
              || row.source_delivery_count || context.agent !== "evaluator"
              || context.id !== "call_eval_" + row.issue_key.slice(0, 32)) throw new Error("Fixture native source recipient denied")
            const endpoint = JSON.parse(readFileSync(join(root, "source-callback-" + row.issue_key + ".json"), "utf8"))
            const url = new URL(endpoint.url)
            if (url.hostname !== "127.0.0.1" || url.protocol !== "http:" || url.pathname !== "/source")
              throw new Error("Fixture source callback escaped loopback")
            const request = () => fetch(url, { method: "POST", redirect: "error", signal: context.signal,
              headers: { authorization: "Bearer " + endpoint.token, "content-type": "application/json" },
              body: JSON.stringify({ session_id: context.sessionID, agent: context.agent,
                call_id: context.id, message_id: context.messageID }) })
            const probe = JSON.parse(readFileSync(join(root, "policy.json"), "utf8")).duplicate_source_probe === true
            const responses = await Promise.all(probe ? [request(), request()] : [request()])
            if (probe) {
              if (responses.filter(response => response.ok).length !== 1
                || responses.filter(response => response.status === 403).length !== 1)
                throw new Error("Fixture accepted a concurrent duplicate source callback")
              store.event("duplicate-source-callback-denied", { issue_key: row.issue_key, session_id: context.sessionID,
                call_id: context.id })
            }
            const response = responses.find(response => response.ok) ?? responses[0]!
            if (!response.ok) throw new Error("Fixture native source read denied")
            const body = await response.text()
            if (Buffer.byteLength(body) > 180000) throw new Error("Fixture source response exceeded bound")
            const value = JSON.parse(body)
            if (value.recipient.session_id !== context.sessionID || value.subject.semantic_key !== row.issue_key)
              throw new Error("Fixture native source response binding mismatch")
            context.signal.throwIfAborted()
            store.db.transaction(() => {
              const current = store.recipient(context.sessionID)
              const policy = JSON.parse(readFileSync(join(root, "policy.json"), "utf8"))
              if (!current || !current.enabled || current.revoked || current.sends !== 1 || current.source_delivery_count
                || !policy.enabled || !policy.source_enabled) throw new Error("Fixture source release revoked")
              store.db.query("UPDATE fixture_enrollments SET source_delivery_count=1,source_delivery_sha256=? WHERE issue_key=?")
                .run(sha(body), row.issue_key)
              store.event("native-source-tool-returned", { issue_key: row.issue_key, session_id: context.sessionID,
                agent: context.agent, call_id: context.id, message_id: context.messageID,
                member_count: value.originals.length, sha256: sha(body), bytes: Buffer.byteLength(body) })
            }).immediate()
            return { content: body }
          },
        })
      }))
      registrations.push(await ctx.provider.transform(editor => {
        for (const item of editor.list()) editor.remove(item.provider.id)
        editor.add({ info: { id: PROVIDER, name: "Local Evaluator execution mechanics", activation: "enabled", package: providerPackage } as any,
          models: [MODEL].map(id => ({ id, modelID: id, providerID: PROVIDER, name: id, package: providerPackage,
            capabilities: { tools: retrospective, input: ["text"], output: ["text"] }, variants: [], time: { released: 0 },
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
