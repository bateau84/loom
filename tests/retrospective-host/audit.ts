/** Passive audit for QA-B on installed OpenCode 2.2.0.
 * Does NOT provide models, synthesize Sessions or intercept production decisions.
 * Never stores model prompt text, raw tool inputs/outputs, HTTP headers or auth.
 */
import { Plugin } from "@opencode/plugin"
import { appendFileSync, openSync, closeSync, realpathSync } from "node:fs"
import { join, resolve } from "node:path"

type Obj = Record<string, unknown>
const object = (x: unknown): Obj => x !== null && typeof x === "object" && !Array.isArray(x) ? x as Obj : {}
const str = (x: unknown): string | undefined => typeof x === "string" ? x.slice(0, 256) : undefined
const isTrace = (name: string) => name === "loom_trace" || name === "loom.trace"

function traceResult(result: unknown): Obj {
  const data = object(result)
  const content = data.content
  let text: string | undefined
  if (typeof content === "string") text = content
  if (Array.isArray(content)) text = content.filter(x => object(x).type === "text")
    .map(x => object(x).text).filter((x): x is string => typeof x === "string").join("\n")
  if (!text || text.length > 262144) return { parse: "missing-or-oversized" }
  try {
    const outer = object(JSON.parse(text))
    const trace = object(outer.result)
    const events = Array.isArray(trace.events) ? trace.events : []
    return {
      parse: "ok", source: str(trace.source), session_id: str(trace.session_id),
      coverage: object(trace.coverage), next_cursor: str(trace.next_cursor),
      event_ids: events.slice(0, 50).map(x => str(object(x).source_message_id)),
      event_kinds: events.slice(0, 50).map(x => str(object(x).kind)),
      child_ids: Array.isArray(trace.sessions) ? trace.sessions.slice(0, 50).map(x => str(object(x).id)) : [],
    }
  } catch { return { parse: "invalid-json" } }
}

export default Plugin.define({
  id: "loom.retrospective.qab.audit",
  async setup(ctx) {
    const root = process.env.LOOM_QAB_ROOT
    if (!root || realpathSync(ctx.location.directory) !== resolve(root, "project"))
      throw new Error("QA-B audit must run only in its disposable private project")
    const file = join(root, "audit.ndjson")
    // Create a file under the already-private directory without relying on umask.
    const fd = openSync(file, "a", 0o600)
    closeSync(fd)
    const audit = (type: string, data: Obj) =>
      appendFileSync(file, JSON.stringify({ type, at: Date.now(), data }) + "\n")
    const registrations: Array<{ dispose(): Promise<void> }> = []
    try {
      registrations.push(await ctx.session.hook("model.request", event => {
        audit("model-request", {
          sessionID: event.sessionID, agent: event.agent, kind: event.kind,
          providerID: event.model.providerID, modelID: event.model.id,
        })
      }))
      registrations.push(await ctx.tool.hook("execute.before", event => {
        const input = object(event.input)
        audit("tool-before", {
          sessionID: event.sessionID, agent: event.agent, messageID: event.messageID,
          callID: event.id, tool: event.tool,
          ...(isTrace(event.tool) ? { trace: {
            operation: str(input.operation), session_id: str(input.session_id),
            export_path: str(input.export_path), include_text: input.include_text === true,
            cursor: str(input.cursor), limit: input.limit,
          } } : {}),
          ...(event.tool === "read" ? { read_path:
            str(input.filePath) ?? str(input.path) ?? str(input.file) } : {}),
        })
      }))
      registrations.push(await ctx.tool.hook("execute.after", event => {
        audit("tool-after", {
          sessionID: event.sessionID, agent: event.agent, messageID: event.messageID,
          callID: event.id, tool: event.tool, status: event.status,
          ...(isTrace(event.tool) && event.status === "completed"
            ? { trace_result: traceResult(event.result) } : {}),
          ...(event.status === "error" ? { error_recorded: true,
            error_type: str(object(event.error).type) ?? str(object(event.error).code),
            // Never copy raw error messages: they can contain private source text.
          } : {}),
        })
      }))
      audit("ready", { plugin: "loom.retrospective.qab.audit", location: ctx.location.directory })
    } catch (error) {
      await Promise.allSettled(registrations.map(r => r.dispose()))
      throw error
    }
    return async () => { await Promise.allSettled(registrations.map(r => r.dispose())) }
  },
})
