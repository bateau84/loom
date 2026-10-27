import { Plugin } from "@opencode/plugin"
import { Database } from "bun:sqlite"
import { decodeConfigYaml } from "./config-parser.js"
import { mkdir, open, realpath } from "node:fs/promises"
import { homedir } from "node:os"
import { isAbsolute, join } from "node:path"
import { configPaths, loadConfig } from "./config.js"
import { configLoadStatus } from "./config-admission.js"
import { injectInstructions, registry, roleDescriptions, type NativeAgent } from "./agents.js"
import { Observer } from "./context.js"
import { resolveContextSelection, workContext } from "./work-context.js"
import { digest, PROCESSING_LIMITS, type Actor, type Focus } from "./model.js"
import { renderFullHistory } from "./history-renderer.js"
import { fullThreadMarkdown } from "./response-format.js"
import { Store } from "./store.js"
import { QUESTION_DISPATCH, questionRecipient } from "./collaboration.js"
import { questionRoute, sendQuestion, type NativeModel, type QuestionRoute } from "./question-routing.js"
import { resumeAnswer } from "./answer-resume.js"
import { TOOL_HELP, LOOM_NAMESPACE_HELP } from "./tool-help.js"

function payload(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Expected an object")
  return value as Record<string, unknown>
}
function unwrapped(value: unknown): unknown {
  if (value && typeof value === "object" && "data" in value) return (value as { data: unknown }).data
  return value
}
/** Bound diagnostic JSON before reserving it, leaving room for useful context and
 * selection/readback outcomes. All failing sources remain visible as prefixes. */
function contextConfigDiagnostics(errors: string[], maxChars: number): { config_errors?: string[]; config_errors_excerpted?: true } {
  if (!errors.length) return {}
  const allowance = Math.floor(maxChars / 8)
  if (JSON.stringify({ config_errors: errors }).length <= allowance) return { config_errors: errors }
  const diagnostics = { config_errors: errors.map(() => ""), config_errors_excerpted: true as const }
  let low = 0, high = allowance
  while (low < high) {
    const middle = Math.ceil((low + high) / 2)
    diagnostics.config_errors = errors.map(error => error.slice(0, middle))
    if (JSON.stringify(diagnostics).length <= allowance) low = middle
    else high = middle - 1
  }
  diagnostics.config_errors = errors.map(error => error.slice(0, low))
  return diagnostics
}
function nativeModel(value: unknown): NativeModel | undefined {
  if (value === undefined || value === null) return undefined
  const ref = payload(value)
  if (typeof ref.providerID !== "string" || !ref.providerID ||
      typeof ref.id !== "string" || !ref.id ||
      (ref.variant !== undefined && (typeof ref.variant !== "string" || !ref.variant)))
    throw new Error("OpenCode returned an invalid native model reference")
  return { providerID: ref.providerID, id: ref.id,
    ...(typeof ref.variant === "string" ? { variant: ref.variant } : {}) }
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
const workRefInput = obj({ action_id: str, node_id: str, action_revision: { type: "integer", minimum: 1 }, plan_revision: { type: "integer", minimum: 1 }, hash: str },
  ["action_id", "node_id", "action_revision", "plan_revision", "hash"])
const contextAttachments = { type: "array", items: { type: "string", maxLength: 2000 }, maxItems: 50 }
const recipientInput = obj({ kind: choice("agent", "role", "dispatcher", "user"), id: str }, ["kind"])
const askInput = { question: str, to_agent: str, recipient: recipientInput, blocking: { type: "boolean" }, context: str, context_attachments: contextAttachments,
  reference: obj({ action_id: str, kind: choice("action", "phase", "wave", "task", "subtask"), id: str }, ["action_id", "kind", "id"]) }
const answerInput = { question_id: str, answer: str, context_attachments: contextAttachments }
const specs = [
  { name: "agents", description: TOOL_HELP.agents, input: obj({}) },
  { name: "action", description: TOOL_HELP.action, input: obj({ operation: choice("list", "create", "update", "sessions"), action_id: str, title: str, goal: str, state: choice("active", "paused", "completed", "cancelled"), expected_revision: num, offset: num, archived: { type: "boolean" }, cursor: { type: "string", minLength: 1, maxLength: 4096 }, limit: { type: "integer", minimum: 1, maximum: 50 } }, ["operation"]) },
  { name: "plan", description: TOOL_HELP.plan, input: obj({ operation: choice("read", "save"), action_id: str, revision: num, expected_revision: num, nodes: { type: "array", maxItems: 300, items: obj({ id: str, kind: choice("phase", "wave", "task", "subtask"), title: str, parent: str, depends_on: list, outcome: str, context: str, criteria: list, skills: list, roles: list, agent: str }, ["id", "kind", "title"]) } }, ["operation", "action_id"]) },
  { name: "context", description: TOOL_HELP.context, input: obj({ action_id: str, node_id: str, clear: { type: "boolean" }, mode: choice("continuation", "independent"), handoff_id: { type: ["string", "null"] } }) },
  { name: "record", description: TOOL_HELP.record, input: { ...obj({ operation: choice("add", "query", "complete", "reopen", "ask", "answer"), view: choice("ledger", "progress", "questions", "thread", "full_thread"), response_format: choice("markdown", "json"), session_id: str, cursor: str, work_ref: workRefInput, ...askInput, ...answerInput, respondent: str, question_state: choice("open", "answered", "all"), offset: num, action_id: str, node_id: str, kind: choice("claim", "result", "concern", "assessment", "qa"), statement: str, evidence_ids: list, artifact_refs: list, verdict: choice("pass", "fail", "inconclusive"), record_id: str, session_only: { type: "boolean" }, after: num, limit: { type: "integer", minimum: 1, maximum: 50 } }, ["operation"]),
    allOf: [
      { if: { properties: { operation: { const: "ask" } } }, then: {
          ...obj({ operation: { const: "ask" }, ...askInput }, ["operation", "question", "blocking"]),
          oneOf: [{ required: ["to_agent"], not: { required: ["recipient"] } }, { required: ["recipient"], not: { required: ["to_agent"] } }],
        } },
      { if: { properties: { operation: { const: "answer" } } }, then: obj({ operation: { const: "answer" }, ...answerInput }, ["operation", "question_id", "answer"]) },
      { if: { properties: { view: { const: "full_thread" } }, required: ["view"] }, then: {
        ...obj({ operation: { const: "query" }, view: { const: "full_thread" }, action_id: str, node_id: str, session_id: str, cursor: str, response_format: choice("markdown", "json"),
          limit: { type: "integer", minimum: 1, maximum: 50 } }, ["operation", "view"]),
        oneOf: [{ required: ["action_id"], not: { required: ["session_id"] } }, { required: ["session_id"], not: { anyOf: [{ required: ["action_id"] }, { required: ["node_id"] }] } }],
      } },
    ] } },
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
    const projectScope = digest({ project: ctx.location.project.id, canonical: ctx.location.project.canonical })
    const state = join(stateHome, "loom", "actions-v1", projectScope)
    let filename = join(state, "ledger.sqlite")
    let stage = "state-directory"
    let db: Database | undefined
    let store: Store, observer: Observer
    try {
      await mkdir(state, { recursive: true, mode: 0o700 })
      stage = "database-file"
      const handle = await open(filename, "a", 0o600); await handle.close()
      stage = "database-path"
      filename = await realpath(filename)
      stage = "database-open"
      db = new Database(filename)
      stage = "store-initialization"
      store = new Store(db, projectScope)
      stage = "observer-initialization"
      observer = new Observer(store)
    } catch (error) {
      // Cleanup must not replace the initialization cause. No recovery or retry here.
      try { db?.close() } catch { /* Preserve the primary failure. */ }
      throw new Error(`Loom startup failed (stage=${stage}, database=${JSON.stringify(filename)}): ${error instanceof Error ? error.message : String(error)}`, { cause: error })
    }
    const database = db
    const disposers: Array<{ dispose(): Promise<void> }> = []
    let lastWarning = ""
    const warn = (error: unknown) => {
      const message = `Loom: ${error instanceof Error ? error.message : String(error)}`
      if (message !== lastWarning) { console.warn(message); lastWarning = message }
    }
    // A plugin instance's location is not necessarily the location of all server events.
    const sessionIsLocal = async (session: Record<string, unknown>) => {
      const location = payload(session.location)
      if (session.projectID !== ctx.location.project.id || typeof location.directory !== "string" || location.workspaceID !== ctx.location.workspaceID) return false
      try { return await realpath(location.directory) === directory } catch { return false }
    }
    const owns = async (sessionID: Parameters<typeof ctx.session.get>[0]["sessionID"]) =>
      sessionIsLocal(payload(unwrapped(await ctx.session.get({ sessionID }))))
    const focusFor = (input: Record<string, unknown>, session: string): Focus | undefined => {
      if (input.action_id !== undefined) return { action_id: String(input.action_id), ...(input.node_id !== undefined ? { node_id: String(input.node_id) } : {}) }
      if (input.node_id !== undefined) throw new Error("node_id requires action_id")
      const saved = store.selected(session)
      return saved ? { action_id: saved.action_id, ...(saved.node_id === undefined ? {} : { node_id: saved.node_id }) } : undefined
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
            const diagnostics = spec.name === "context" ? contextConfigDiagnostics(snapshot.errors, snapshot.config.context.max_chars)
              : snapshot.errors.length ? { config_errors: snapshot.errors } : {}
            let result: unknown
            switch (spec.name) {
              case "agents": {
                const entries = registry(snapshot.config, agents(await ctx.agent.list()))
                result = { agents: entries, role_descriptions: roleDescriptions(snapshot.config), config_loads: configLoadStatus(), evidence: { capture: snapshot.config.ledger.capture, ...observer.status() }, config_sources: snapshot.sources, errors: snapshot.errors, warnings: entries.filter(a => a.configured && !a.available).map(a => `Configured agent is unavailable: ${a.id}`) }; break
              }
              case "action":
                if (input.operation === "list") result = store.list(input.offset as number | undefined)
                else if (input.operation === "create") result = store.create(input.title as string, input.goal as string, actor)
                else if (input.operation === "update") result = store.update(String(input.action_id), Number(input.expected_revision), { title: input.title as string | undefined, goal: input.goal as string | undefined, state: input.state as Parameters<Store["update"]>[2]["state"] })
                else if (input.operation === "sessions") {
                  // The native inventory is a read-only, bounded page. It is not
                  // authorization to dispatch, attach, interrupt or archive Sessions.
                  const actionID = input.action_id === undefined ? undefined : String(input.action_id)
                  if (actionID !== undefined) store.action(actionID)
                  const native = payload(await ctx.session.list({
                    project: ctx.location.project.id,
                    directory,
                    limit: input.limit as number | undefined ?? 20,
                    ...(input.cursor !== undefined ? { cursor: String(input.cursor) } : {}),
                    ...(input.archived !== undefined ? { archived: input.archived as boolean } : {}),
                  }))
                  if (!Array.isArray(native.data)) throw new Error("Native Session list did not return a data array")
                  const cursors = payload(native.cursor)
                  const sessions: Array<Record<string, unknown>> = []
                  for (const raw of native.data) {
                    const session = payload(raw)
                    if (typeof session.id !== "string" || !await sessionIsLocal(session)) continue
                    const selected = store.selected(session.id)
                    const hasRecordedActivity = actionID === undefined ? false : store.hasActionActivity(actionID, session.id)
                    if (actionID !== undefined && selected?.action_id !== actionID && !hasRecordedActivity) continue
                    const time = session.time && typeof session.time === "object" && !Array.isArray(session.time)
                      ? session.time as Record<string, unknown> : {}
                    sessions.push({
                      id: session.id,
                      ...(typeof session.title === "string" ? { title: session.title } : {}),
                      ...(typeof session.parentID === "string" ? { parent_id: session.parentID } : {}),
                      archived: time.archived !== undefined && time.archived !== null,
                      ...(selected ? { selection: selected } : {}),
                      ...(actionID !== undefined ? { has_recorded_activity: hasRecordedActivity } : {}),
                    })
                  }
                  result = {
                    sessions, scanned: native.data.length, matched: sessions.length,
                    next_cursor: typeof cursors.next === "string" ? cursors.next : null,
                    note: "Read-only native Session inventory page. A selection, Plan revision or ledger record does not prove execution, task completion, or recipient contact. Follow next_cursor; filtered/empty pages do not prove absence.",
                  }
                }
                else throw new Error("Unknown Action operation")
                break
              case "plan":
                if (input.operation === "read") result = store.plan(String(input.action_id), input.revision as number | undefined)
                else if (input.operation === "save") result = store.savePlan(String(input.action_id), Number(input.expected_revision), input.nodes, actor)
                else throw new Error("Unknown plan operation")
                break
              case "context": {
                if (input.clear) { if (input.action_id !== undefined || input.node_id !== undefined || input.mode !== undefined || input.handoff_id !== undefined) throw new Error("clear cannot be combined with work IDs or context options"); store.select(actor.session_id); result = { selected: null }; break }
                // Clearing is navigation, not a read of the possibly damaged selection.
                const focus = resolveContextSelection(input, () => store.selected(actor.session_id))
                if (!focus) {
                  result = input.mode === "independent"
                    ? { selected: null, context_mode: "independent", history_withheld: true, records: [], progress: [], questions: [],
                      selection_unchanged: true,
                      note: "No Action selected: no Loom work history was read and no work selection was saved. This Session-only independent view does not erase native messages, prior conversation, or explicitly queried history." }
                    : { selected: null, note: "No Action selected. Ordinary conversation needs no Action." }
                  break
                }
                const envelopeChars = JSON.stringify({ result: null, ...diagnostics }).length - 4
                result = workContext(store, focus, snapshot.config.context.max_chars, actor.agent, {
                  ...(input.action_id !== undefined || input.mode !== undefined || input.handoff_id !== undefined ? { selectForSession: actor.session_id } : {}), envelopeChars,
                })
                break
              }
              case "record": {
                if (input.response_format !== undefined) {
                  if (input.response_format !== "markdown" && input.response_format !== "json") throw new Error("response_format must be markdown or json")
                  if (input.operation !== "query" || input.view !== "full_thread") throw new Error("response_format is only supported for full_thread queries")
                }
                // Reject retired protocol fields even when a caller bypasses schema validation.
                if (["assign", "authorize-continuation", "withdraw-continuation", "retry-delivery"].includes(String(input.operation))
                  || ["assignments", "deliveries"].includes(String(input.view))) throw new Error("Assignment/delivery operation or view is retired; history remains in the ledger")
                for (const field of ["assignment_id", "worker_session_id", "delivery_id", "continuation", "attempt_after", "attempt_limit"])
                  if (field in input) throw new Error(`${field} is not supported; assignment/delivery protocol is retired`)
                if (input.view === "full_thread") {
                  if (input.operation !== "query") throw new Error("full_thread requires query")
                  const { operation: _operation, view: _view, response_format: _responseFormat, ...query } = input
                  result = renderFullHistory(store.history.read(query))
                  break
                }
                if ("session_id" in input || "cursor" in input) throw new Error("session_id and cursor are full_thread query options only")
                if (input.session_only && (input.action_id !== undefined || input.node_id !== undefined ||
                    (input.operation !== "query" && input.operation !== "add")))
                  throw new Error("session_only is a query option or Session-scoped add option and cannot be combined with work IDs")
                // Explicit work/thread identity must not depend on saved selection.
                const identityScoped = ["complete", "answer"].includes(String(input.operation))
                  || (input.operation === "query" && input.view === "thread")
                const focus = identityScoped || input.session_only || (input.operation === "ask" && input.reference !== undefined) ? undefined : focusFor(input, actor.session_id)
                if (input.operation === "answer") {
                  const { operation: _operation, ...answer } = input
                  const original = store.collaboration.thread(String(input.question_id)).question
                  let verifiedParent: string | undefined
                  if (original.data.format === "loom-question/v2" &&
                      typeof original.data.expected_parent_session === "string") {
                    const candidate = payload(unwrapped(await ctx.session.get({ sessionID: actor.session_id })))
                    if (candidate.id !== actor.session_id ||
                        candidate.parentID !== original.data.expected_parent_session ||
                        candidate.agent !== actor.agent || !await sessionIsLocal(candidate) ||
                        !await owns(candidate.parentID as Parameters<typeof ctx.session.get>[0]["sessionID"]))
                      throw new Error("Answering Session is not a verified child of the dispatching Session")
                    verifiedParent = candidate.parentID as string
                  }
                  const committed = store.collaboration.answer(actor, answer, verifiedParent)
                  result = await resumeAnswer(store, committed, async sessionID => {
                    const target = payload(unwrapped(await ctx.session.get({ sessionID })))
                    return target.id === sessionID && await sessionIsLocal(target)
                  }, notice => ctx.session.synthetic(notice), AbortSignal.any([toolContext.signal, lifetime.signal]))
                  break
                }
                if (input.operation === "ask") {
                  if (input.recipient === undefined) {
                    result = { ...store.collaboration.execute(actor, input, focus) as object, dispatch: QUESTION_DISPATCH,
                      guidance: input.blocking === true
                        ? "Recipient not contacted. Manual/native handling is required. If manual handling has been arranged, you may naturally yield for a response; blocking intent does not force a wait."
                        : "Recipient not contacted. Manual/native handling is required; continue your work and retrieve answers later." }
                    break
                  }
                  const recipient = questionRecipient(input.recipient)
                  const asker = payload(unwrapped(await ctx.session.get({ sessionID: actor.session_id })))
                  if (asker.id !== actor.session_id || !await sessionIsLocal(asker))
                    throw new Error("Cannot route a question from an unverified local Session")
                  // The native registry carries execution mode; the Loom config carries responsibility.
                  const all = unwrapped(await ctx.agent.list())
                  if (!Array.isArray(all)) throw new Error("OpenCode returned an unsupported agent registry shape")
                  const roster = all.map(raw => {
                    const a = payload(raw)
                    if (typeof a.id !== "string" || typeof a.mode !== "string")
                      throw new Error("OpenCode agent registry lacks an ID or mode")
                    return { id: a.id, mode: a.mode, hidden: a.hidden === true, model: nativeModel(a.model) }
                  })
                  const asking = { id: actor.session_id,
                    ...(typeof asker.parentID === "string" ? { parentID: asker.parentID } : {}),
                    model: nativeModel(asker.model) }
                  let route: QuestionRoute = snapshot.errors.length
                    ? { mode: "manual", reason: "loom-config-unavailable" }
                    : questionRoute(recipient, snapshot.config, roster, asking)
                  if (route.mode === "notify" && route.session && !await owns(route.session))
                    route = { mode: "manual", reason: "parent-not-local" }
                  const { operation: _askOperation, ...askFields } = input
                  const stored = store.collaboration.ask(actor, focus, askFields, {
                    ...(route.expected_agent ? { expected_agent: route.expected_agent } : {}),
                    ...(route.expected_session ? { expected_session: route.expected_session } : {}),
                    ...(route.expected_parent_session ? { expected_parent_session: route.expected_parent_session } : {}),
                  })
                  // Use the SAME permission action as OpenCode's built-in subagent tool.
                  // Denial must reject the tool call, not be turned into a successful dispatch result.
                  if (route.mode === "delegate" && route.agent) {
                    await ctx.permission.assert({ action: "subagent", resources: [route.agent], save: [route.agent],
                      sessionID: actor.session_id, agent: actor.agent,
                      source: { type: "tool", messageID: toolContext.messageID, id: toolContext.id } })
                  }
                  const dispatch = await sendQuestion(store, stored, route, {
                    create: async (agent, parentID, title, model) => {
                      const child = payload(unwrapped(await ctx.session.create({
                        parentID: parentID as NonNullable<Parameters<typeof ctx.session.create>[0]>["parentID"],
                        agent: agent as NonNullable<Parameters<typeof ctx.session.create>[0]>["agent"], title,
                        ...(model ? { model: model as NonNullable<Parameters<typeof ctx.session.create>[0]>["model"] } : {}),
                      })))
                      if (!await sessionIsLocal(child)) throw new Error("Created child is not in the local project")
                      return child
                    },
                    prompt: (sessionID, text) => ctx.session.prompt({ sessionID: sessionID as Parameters<typeof ctx.session.prompt>[0]["sessionID"],
                      text, resume: true, delivery: "steer" }),
                    synthetic: (sessionID, text, metadata) => ctx.session.synthetic({
                      sessionID: sessionID as Parameters<typeof ctx.session.synthetic>[0]["sessionID"],
                      text, metadata, description: "Loom Open Question", resume: true, delivery: "steer",
                    }),
                  }, AbortSignal.any([toolContext.signal, lifetime.signal]))
                  result = { ...stored, dispatch,
                    guidance: dispatch.status === "admission-observed"
                      ? "Native input admitted; recipient execution/answer is not guaranteed. Read the question thread for a real answer; blocking is advisory."
                      : recipient.kind === "user" && route.mode === "manual"
                        ? "Ask the user using native interaction; record the actual user decision with its source. No user was contacted by Loom."
                        : "Automatic delivery was not confirmed. Inspect the dispatch result and use native handling; do not assume the question was answered." }
                  break
                }
                if (["complete", "reopen"].includes(String(input.operation)) || (input.operation === "query" && input.view !== undefined && input.view !== "ledger")) {
                  result = store.collaboration.execute(actor, input, focus)
                  break
                }
                if (input.operation === "query") result = store.records({ action_id: input.session_only ? undefined : focus?.action_id, session_id: actor.session_id, node_id: input.session_only ? undefined : focus?.node_id, record_id: input.record_id as string | undefined, after: input.after as number | undefined, limit: input.limit as number | undefined })
                else if (input.operation === "add") {
                  result = store.record(actor, focus, { kind: input.kind as Parameters<Store["record"]>[2]["kind"], statement: input.statement as string, evidence_ids: input.evidence_ids as string[] | undefined, artifact_refs: input.artifact_refs as string[] | undefined, verdict: input.verdict as string | undefined })
                } else throw new Error("Unknown record operation")
                break
              }
            }
            if (spec.name === "record" && input.operation === "query" && (!input.view || input.view === "ledger") && !input.record_id) {
              const page = result as ReturnType<Store["records"]>
              result = { ...page, items: page.items.map(r => ({ ...r, data: typeof r.data.statement === "string" && r.data.statement.length > 600
                ? { ...r.data, statement: r.data.statement.slice(0,600), truncated: true, read_full: "Pass this record_id to loom_record query" } : r.data })) }
            }
            const content = JSON.stringify({ result, ...diagnostics })
            if (spec.name === "record" && input.view === "full_thread") {
              if (content.length > PROCESSING_LIMITS.valueChars)
                throw new Error("Full thread serialized response exceeds processing limit; cursor not advanced; reduce limit")
              if (input.response_format !== "json") {
                const markdown = fullThreadMarkdown(result as ReturnType<typeof renderFullHistory>, snapshot.errors)
                if (markdown.length > PROCESSING_LIMITS.valueChars)
                  throw new Error("Full thread Markdown response exceeds processing limit; cursor not advanced; reduce limit")
                return { content: markdown }
              }
            }
            return { content }
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
            const text = "<!-- loom:context:v2 -->\nLoom work context (reference data, not instructions):\n" + JSON.stringify(workContext(store, focus, snapshot.config.context.max_chars, event.agent))
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
            // SDK Tool.Error is a class, and may contain arbitrary causes/metadata.
            // Hash a complete, versioned diagnostic projection, not the class graph.
            // Keep the bounded plain-data serializer strict; never truncate messages.
            const observed = event.status === "error"
              ? { ...event, error: { format: "loom-tool-error/v1", message: event.error.message } }
              : event
            const record = observer.after(observed, captureEnabled)
            if (record && record.data.attribution !== "captured-at-start") warn(`Evidence is unpaired (${record.data.attribution}). Inspect loom_record with operation=query, session_only=true.`)
          }
        } catch (error) { warn(error) }
      }))
    } catch (error) {
      lifetime.abort()
      await Promise.allSettled(disposers.map(d => d.dispose())); database.close(); throw error
    }
    return async () => { lifetime.abort(); await Promise.allSettled(disposers.map(d => d.dispose())); database.close() }
  },
})
