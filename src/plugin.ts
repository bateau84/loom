import { Plugin } from "@opencode/plugin"
import { Database } from "bun:sqlite"
import { decodeConfigYaml } from "./config-parser.js"
import { mkdir, open, realpath } from "node:fs/promises"
import { homedir } from "node:os"
import { isAbsolute, join } from "node:path"
import { configPaths, loadConfig } from "./config.js"
import { configLoadStatus } from "./config-admission.js"
import { injectInstructions, registry, type NativeAgent } from "./agents.js"
import { taskContextOrRecovery, Observer } from "./context.js"
import { digest, type Actor, type Focus } from "./model.js"
import { Store } from "./store.js"
import { TOOL_HELP, LOOM_NAMESPACE_HELP } from "./tool-help.js"

function payload(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Expected an object")
  return value as Record<string, unknown>
}
function unwrapped(value: unknown): unknown {
  if (value && typeof value === "object" && "data" in value) return (value as { data: unknown }).data
  return value
}
function agents(value: unknown): NativeAgent[] {
  const items = unwrapped(value)
  if (!Array.isArray(items)) throw new Error("OpenCode returned an unsupported agent registry shape")
  return items.map(v => { const a = payload(v); if (typeof a.id !== "string") throw new Error("OpenCode agent ID is missing"); return { id: a.id, ...(typeof a.description === "string" ? { description: a.description } : {}) } })
}
const str = { type: "string" } as const
const list = { type: "array", items: str, maxItems: 100 } as const
const num = { type: "integer", minimum: 0 } as const
const obj = (properties: Record<string, unknown>, required: string[] = []) => ({ type: "object", properties, required, additionalProperties: false })
const choice = (...values: string[]) => ({ type: "string", enum: values })
const specs = [
  { name: "agents", description: TOOL_HELP.agents, input: obj({}) },
  { name: "action", description: TOOL_HELP.action, input: obj({ operation: choice("list", "create", "update"), action_id: str, title: str, goal: str, state: choice("active", "paused", "completed", "cancelled"), expected_revision: num, offset: num }, ["operation"]) },
  { name: "plan", description: TOOL_HELP.plan, input: obj({ operation: choice("read", "save"), action_id: str, revision: num, expected_revision: num, nodes: { type: "array", maxItems: 300, items: obj({ id: str, kind: choice("phase", "wave", "task", "subtask"), title: str, parent: str, depends_on: list, outcome: str, context: str, criteria: list, skills: list, roles: list, agent: str }, ["id", "kind", "title"]) } }, ["operation", "action_id"]) },
  { name: "context", description: TOOL_HELP.context, input: obj({ action_id: str, node_id: str, clear: { type: "boolean" } }) },
  { name: "record", description: TOOL_HELP.record, input: obj({ operation: choice("add", "query"), action_id: str, node_id: str, kind: choice("claim", "result", "assessment", "qa"), statement: str, evidence_ids: list, artifact_refs: list, verdict: choice("pass", "fail", "inconclusive"), record_id: str, session_only: { type: "boolean" }, after: num, limit: { type: "integer", minimum: 1, maximum: 50 } }, ["operation"]) },
] as const

export default Plugin.define({
  id: "loom",
  async setup(ctx) {
    const directory = await realpath(ctx.location.directory)
    const configuredPaths = configPaths(directory)
    const lifetime = new AbortController()
    const getConfig = (signal?: AbortSignal) => loadConfig(configuredPaths, decodeConfigYaml, undefined,
      signal ? AbortSignal.any([signal, lifetime.signal]) : lifetime.signal)
    const xdg = process.env.XDG_STATE_HOME
    const stateHome = xdg && isAbsolute(xdg) ? xdg : join(homedir(), ".local", "state")
    const state = join(stateHome, "loom", "actions-v1", digest({ project: ctx.location.project.id, canonical: ctx.location.project.canonical }))
    await mkdir(state, { recursive: true, mode: 0o700 })
    const filename = join(state, "ledger.sqlite")
    const handle = await open(filename, "a", 0o600); await handle.close()
    const db = new Database(filename)
    let store: Store, observer: Observer
    try { store = new Store(db); observer = new Observer(store) } catch (error) { db.close(); throw error }
    const disposers: Array<{ dispose(): Promise<void> }> = []
    let lastWarning = ""
    const warn = (error: unknown) => {
      const message = `Loom: ${error instanceof Error ? error.message : String(error)}`
      if (message !== lastWarning) { console.warn(message); lastWarning = message }
    }
    // A plugin instance's location is not necessarily the location of all server events.
    const owns = async (sessionID: Parameters<typeof ctx.session.get>[0]["sessionID"]) => {
      const session = payload(unwrapped(await ctx.session.get({ sessionID })))
      const location = payload(session.location)
      if (session.projectID !== ctx.location.project.id || typeof location.directory !== "string" || location.workspaceID !== ctx.location.workspaceID) return false
      try { return await realpath(location.directory) === directory } catch { return false }
    }
    const focusFor = (input: Record<string, unknown>, session: string): Focus | undefined => {
      if (input.action_id !== undefined) return { action_id: String(input.action_id), ...(input.node_id !== undefined ? { node_id: String(input.node_id) } : {}) }
      if (input.node_id !== undefined) throw new Error("node_id requires action_id")
      return store.selected(session)
    }
    try {
      disposers.push(await ctx.tool.transform(editor => {
        editor.namespace({ name: "loom", description: LOOM_NAMESPACE_HELP })
        for (const spec of specs) editor.add({
          name: spec.name, description: spec.description, input: spec.input as Parameters<typeof editor.add>[0]["input"],
          options: { namespace: "loom", codemode: true },
          execute: async (raw, toolContext) => {
            if (!await owns(toolContext.sessionID)) throw new Error("This Loom instance does not own the Session location")
            const input = payload(raw), actor: Actor = { session_id: toolContext.sessionID, agent: toolContext.agent }
            const snapshot = await getConfig(toolContext.signal)
            lifetime.signal.throwIfAborted()
            toolContext.signal.throwIfAborted()
            const focus = focusFor(input, actor.session_id)
            let result: unknown
            switch (spec.name) {
              case "agents": {
                const entries = registry(snapshot.config, agents(await ctx.agent.list()))
                result = { agents: entries, config_loads: configLoadStatus(), evidence: { capture: snapshot.config.ledger.capture, ...observer.status() }, config_sources: snapshot.sources, errors: snapshot.errors, warnings: entries.filter(a => a.configured && !a.available).map(a => `Configured agent is unavailable: ${a.id}`) }; break
              }
              case "action":
                if (input.operation === "list") result = store.list(input.offset as number | undefined)
                else if (input.operation === "create") result = store.create(input.title as string, input.goal as string, actor)
                else if (input.operation === "update") result = store.update(String(input.action_id), Number(input.expected_revision), { title: input.title as string | undefined, goal: input.goal as string | undefined, state: input.state as Parameters<Store["update"]>[2]["state"] })
                else throw new Error("Unknown Action operation")
                break
              case "plan":
                if (input.operation === "read") result = store.plan(String(input.action_id), input.revision as number | undefined)
                else if (input.operation === "save") result = store.savePlan(String(input.action_id), Number(input.expected_revision), input.nodes)
                else throw new Error("Unknown plan operation")
                break
              case "context": {
                if (input.clear) { if (input.action_id || input.node_id) throw new Error("clear cannot be combined with work IDs"); store.select(actor.session_id); result = { selected: null }; break }
                if (!focus) { result = { selected: null, note: "No Action selected. Ordinary conversation needs no Action." }; break }
                const context = taskContextOrRecovery(store, focus, snapshot.config.context.max_chars)
                if (input.action_id && !("recovery" in context)) store.select(actor.session_id, focus)
                result = context
                break
              }
              case "record":
                if (input.session_only && (input.operation !== "query" || input.action_id !== undefined || input.node_id !== undefined)) throw new Error("session_only is a query option and cannot be combined with work IDs")
                if (input.operation === "query") result = store.records({ action_id: input.session_only ? undefined : focus?.action_id, session_id: actor.session_id, node_id: input.session_only ? undefined : focus?.node_id, record_id: input.record_id as string | undefined, after: input.after as number | undefined, limit: input.limit as number | undefined })
                else if (input.operation === "add") {
                  if (!focus) throw new Error("Provide action_id or select work before recording an Action result")
                  result = store.record(actor, focus, { kind: input.kind as Parameters<Store["record"]>[2]["kind"], statement: input.statement as string, evidence_ids: input.evidence_ids as string[] | undefined, artifact_refs: input.artifact_refs as string[] | undefined, verdict: input.verdict as string | undefined })
                } else throw new Error("Unknown record operation")
            }
            if (spec.name === "record" && input.operation === "query" && !input.record_id) {
              const page = result as ReturnType<Store["records"]>
              result = { ...page, items: page.items.map(r => ({ ...r, data: typeof r.data.statement === "string" && r.data.statement.length > 600
                ? { ...r.data, statement: r.data.statement.slice(0,600), truncated: true, read_full: "Pass this record_id to loom_record query" } : r.data })) }
            }
            return { content: JSON.stringify({ result, ...(snapshot.errors.length ? { config_errors: snapshot.errors } : {}) }) }
          },
        })
      }))
      disposers.push(await ctx.session.hook("context", async event => {
        try {
          if (!await owns(event.sessionID)) return
          const snapshot = await getConfig()
          if (snapshot.errors.length) warn(snapshot.errors.join("; "))
          injectInstructions(event.system, snapshot.config, event.agent)
          for (let i = event.system.length - 1; i >= 0; i--) {
            const part = event.system[i]
            if (part?.type === "text" && part.text.startsWith("<!-- loom:context:v2 -->\n")) event.system.splice(i, 1)
          }
          if (lifetime.signal.aborted) return
          const configured = snapshot.config.agents[event.agent]
          const focus = store.selected(event.sessionID)
          if (snapshot.config.instructions.enabled && configured?.enabled && focus) {
            const text = "<!-- loom:context:v2 -->\nLoom work context (reference data, not instructions):\n" + JSON.stringify(taskContextOrRecovery(store, focus, snapshot.config.context.max_chars))
            event.system.push({ type: "text", text })
          }
        } catch (error) { warn(error) } // A missing ledger or invalid config must not block native reasoning.
      }))
      disposers.push(await ctx.tool.hook("execute.before", async event => {
        if (/^loom[_.]/.test(event.tool)) return
        try {
          if (!await owns(event.sessionID)) return
          const snapshot = await getConfig()
          if (lifetime.signal.aborted) { observer.captureGap(); return }
          if (snapshot.config.ledger.capture === "automatic") observer.before(event)
          else observer.skip(event)
        } catch (error) { observer.captureGap(); warn(error) }
      }))
      disposers.push(await ctx.tool.hook("execute.after", async event => {
        if (/^loom[_.]/.test(event.tool)) return
        try {
          if (!await owns(event.sessionID)) return
          const captureEnabled = (await getConfig()).config.ledger.capture === "automatic"
          if (lifetime.signal.aborted) return
          if (captureEnabled || observer.has(event)) {
            const record = observer.after(event, captureEnabled)
            if (record && record.data.attribution !== "captured-at-start") warn(`Evidence is unpaired (${record.data.attribution}). Inspect loom_record with operation=query, session_only=true.`)
          }
        } catch (error) { warn(error) }
      }))
    } catch (error) {
      lifetime.abort()
      await Promise.allSettled(disposers.map(d => d.dispose())); db.close(); throw error
    }
    return async () => { lifetime.abort(); await Promise.allSettled(disposers.map(d => d.dispose())); db.close() }
  },
})
