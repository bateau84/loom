import { Plugin } from "@opencode/plugin"
import { Database } from "bun:sqlite"
import { createHash, randomUUID } from "node:crypto"
import { decodeConfigYaml } from "./config-parser.js"
import { mkdir, open, realpath } from "node:fs/promises"
import { homedir } from "node:os"
import { isAbsolute, join } from "node:path"
import { configPaths, loadConfig } from "./config.js"
import { resolveModelPolicy } from "./model-routing.js"
import { registerModelRouting } from "./model-routing-adapter.js"
import { configLoadStatus } from "./config-admission.js"
import { injectInstructions, registry, roleDescriptions, type NativeAgent } from "./agents.js"
import { Observer } from "./context.js"
import { resolveContextSelection, workContext } from "./work-context.js"
import { digest, PROCESSING_LIMITS, type Actor, type Focus } from "./model.js"
import { renderFullHistory } from "./history-renderer.js"
import { fullThreadMarkdown } from "./response-format.js"
import { Store } from "./store.js"
import { Learning } from "./learning.js"
import { QUESTION_DISPATCH, questionRecipient } from "./collaboration.js"
import { questionRoute, sendQuestion, type NativeModel, type QuestionRoute } from "./question-routing.js"
import { resumeAnswer } from "./answer-resume.js"
import { TOOL_HELP, LOOM_NAMESPACE_HELP } from "./tool-help.js"
import { readSessionExport, traceTimeline } from "./session-trace.js"

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
const bindInput = { question_id: str, respondent_session_id: str }
const specs = [
  { name: "agents", description: TOOL_HELP.agents, input: obj({}) },
  { name: "trace", description: TOOL_HELP.trace, input: obj({ operation: choice("timeline", "children"),
      session_id: str, export_path: { type: "string", minLength: 1, maxLength: 4096 },
      include_text: { type: "boolean" }, limit: { type: "integer", minimum: 1, maximum: 50 },
      cursor: { type: "string", minLength: 1, maxLength: 4096 } }, ["operation"]) },
  { name: "insights", description: TOOL_HELP.insights, input: obj({ operation: choice("action", "window"), action_id: str, before: { type: "integer", minimum: 1 }, limit: { type: "integer", minimum: 1, maximum: 200 }, since_at: str, until_at: str }, ["operation"]) },
  { name: "tweak", description: TOOL_HELP.tweak, input: obj({ operation: choice("propose", "list", "read", "retire", "trial"), id: str, target_kind: choice("skill", "assessment", "qa", "agent"), target_id: str, base_sha256: str, candidate_content: str, hypothesis: str, evidence_refs: { type: "array", items: str, maxItems: 20 }, revised_from: str, trial_before: { type: "integer", minimum: 1 }, observed_sha256: str, observed_effect: choice("promising", "harmful", "neutral", "inconclusive", "not-exercised"), statement: str, offset: { type: "integer", minimum: 0 } }, ["operation"]) },
  { name: "action", description: TOOL_HELP.action, input: obj({ operation: choice("list", "create", "update", "sessions"), action_id: str, title: str, goal: str, state: choice("active", "paused", "completed", "cancelled"), expected_revision: num, offset: num, archived: { type: "boolean" }, cursor: { type: "string", minLength: 1, maxLength: 4096 }, limit: { type: "integer", minimum: 1, maximum: 50 } }, ["operation"]) },
  { name: "plan", description: TOOL_HELP.plan, input: obj({ operation: choice("read", "save"), action_id: str, revision: num, expected_revision: num, nodes: { type: "array", maxItems: 300, items: obj({ id: str, kind: choice("phase", "wave", "task", "subtask"), title: str, parent: str, depends_on: list, outcome: str, context: str, criteria: list, skills: list, roles: list, agent: str }, ["id", "kind", "title"]) } }, ["operation", "action_id"]) },
  { name: "context", description: TOOL_HELP.context, input: obj({ action_id: str, node_id: str, clear: { type: "boolean" }, mode: choice("continuation", "independent"), handoff_id: { type: ["string", "null"] } }) },
  { name: "record", description: TOOL_HELP.record, input: { ...obj({ operation: choice("add", "query", "complete", "reopen", "ask", "answer", "bind-respondent"), view: choice("ledger", "progress", "questions", "thread", "full_thread"), response_format: choice("markdown", "json"), session_id: str, cursor: str, work_ref: workRefInput, ...askInput, ...answerInput, ...bindInput, respondent: str, question_state: choice("open", "answered", "all"), offset: num, action_id: str, node_id: str, kind: choice("claim", "result", "concern", "assessment", "qa"), statement: str, evidence_ids: list, artifact_refs: list, verdict: choice("pass", "fail", "inconclusive"), record_id: str, session_only: { type: "boolean" }, after: num, limit: { type: "integer", minimum: 1, maximum: 50 } }, ["operation"]),
    allOf: [
      { if: { properties: { operation: { const: "ask" } } }, then: {
          ...obj({ operation: { const: "ask" }, ...askInput }, ["operation", "question", "blocking"]),
          oneOf: [{ required: ["to_agent"], not: { required: ["recipient"] } }, { required: ["recipient"], not: { required: ["to_agent"] } }],
        } },
      { if: { properties: { operation: { const: "answer" } } }, then: obj({ operation: { const: "answer" }, ...answerInput }, ["operation", "question_id", "answer"]) },
        { if: { properties: { operation: { const: "bind-respondent" } } }, then:
          obj({ operation: { const: "bind-respondent" }, ...bindInput },
            ["operation", "question_id", "respondent_session_id"]) },
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
    // A real OpenCode host may keep running after plugin setup fails.
    // Register an early pre-transport deny hook BEFORE quota/ledger I/O on
    // any versioned native host. No host/SDK profile is currently qualified
    // for managed routing; unknown future versions must not fail open.
    // Versionless partial test hosts retain their historical setup behavior.
    const guardedHost = typeof ctx.app?.version === "string" && ctx.app.version.length > 0
    let startupDispatch: "deny" | "delegated" | "disabled" = "deny"
    let startupDenial = "LOOM_MODEL_ROUTING_STARTUP_BLOCKED: routing has not completed initialization"
    const startupGuard = guardedHost ? await ctx.session.hook("model.request", () => {
      if (startupDispatch === "deny") throw new Error(startupDenial)
    }) : undefined
    let startupGuardDisposed = false
    const disposeStartupGuard = async () => {
      if (startupGuardDisposed) return
      startupGuardDisposed = true
      await startupGuard?.dispose()
    }
    try {
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
    let db: Database | undefined, learningDB: Database | undefined
    let store: Store, observer: Observer, learning: Learning | undefined
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
    // Learning history is optional; corruption must never remove the healthy
    // Action tools, observation capture or the independently guarded routing path.
    let learningStage = "learning-database-file", learningFailure: string | undefined
    try {
      const learningPath = join(state, "learning.sqlite")
      const learningHandle = await open(learningPath, "a", 0o600)
      await learningHandle.close()
      learningStage = "learning-database-open"
      learningDB = new Database(await realpath(learningPath))
      learningStage = "learning-initialization"
      learning = new Learning(learningDB, store, db)
    } catch (error) {
      learningFailure = learningStage
      console.warn(`Loom optional learning unavailable (${learningStage}): ${error instanceof Error ? error.message : String(error)}`)
      try { learningDB?.close() } catch { /* Keep the original learning failure. */ }
      learningDB = undefined
      learning = undefined
    }
    const learningStatus = () => learning
      ? { available: true, storage: "separate-project-sqlite", automatic_mutation: false }
      : { available: false, stage: learningFailure ?? "unavailable", automatic_mutation: false,
          note: "Existing Action/record/trace tools and native execution remain available; learning evidence is preserved for operator repair" }
    const requiredLearning = () => {
      if (!learning) throw new Error(`LOOM_LEARNING_UNAVAILABLE: learning subsystem failed at ${learningFailure ?? "unknown"}; existing Action history is still available`)
      return learning
    }
    const database = db, learningDatabase = learningDB
    // Scoped to one live plugin instance; never recover a dispatch token from untrusted history.
    const awaitingNativePrompt = new Map<string, { question: string; parent: string; agent: string; bound?: string }>()
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
    const checkedSession = async (sessionID: string) => {
      const session = payload(unwrapped(await ctx.session.get({ sessionID })))
      if (session.id !== sessionID || !await sessionIsLocal(session))
        throw new Error("Session is not in this Loom project/workspace/location")
      return session
    }
    // Same-project Sessions are not automatically one user's work. Child discovery
    // is restricted to the caller's bounded native parent/child tree.
    const familyRoot = async (sessionID: string): Promise<string> => {
      const visited = new Set<string>()
      let current = sessionID
      for (let depth = 0; depth < 32; depth++) {
        if (visited.has(current)) throw new Error("Session ancestry cycle")
        visited.add(current)
        const session = await checkedSession(current)
        if (typeof session.parentID !== "string") return current
        current = session.parentID
      }
      throw new Error("Session ancestry exceeds 32 ancestors")
    }
    const focusFor = (input: Record<string, unknown>, session: string): Focus | undefined => {
      if (input.action_id !== undefined) return { action_id: String(input.action_id), ...(input.node_id !== undefined ? { node_id: String(input.node_id) } : {}) }
      if (input.node_id !== undefined) throw new Error("node_id requires action_id")
      const saved = store.selected(session)
      return saved ? { action_id: saved.action_id, ...(saved.node_id === undefined ? {} : { node_id: saved.node_id }) } : undefined
    }
    let routingStatus: "disabled" | "not-connected" | "initial-only" | "blocked-config" = "not-connected"
    try {
      const routing = await registerModelRouting(ctx, () => getConfig(), disposers, lifetime.signal)
      routingStatus = routing.status
      // Native subagent owns depth and permission checks. Its prompt hook supplies
      // the exact child identity BEFORE OpenCode can admit that child's input.
      disposers.push(await ctx.session.hook("prompt", async event => {
        const token = /(?:^|\n)Loom OQ dispatch token: ([0-9a-f-]{36})(?:\n|$)/.exec(event.prompt.text)?.[1]
        const pending = token ? awaitingNativePrompt.get(token) : undefined
        if (!pending) return
        if (pending.bound) throw new Error("OQ recipient has already been bound")
        const child = payload(unwrapped(await ctx.session.get({ sessionID: event.sessionID })))
        if (child.id !== event.sessionID || child.parentID !== pending.parent ||
            child.agent !== pending.agent || !await sessionIsLocal(child))
          throw new Error("Native OQ prompt recipient is not the intended local child")
        store.collaboration.bindRespondent(pending.question, event.sessionID, pending.agent)
        pending.bound = event.sessionID
      }))
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
                const modelPolicies = snapshot.config.modelRouting.enabled
                  ? Object.fromEntries(entries.filter(a => a.configured && a.enabled).map(a => [a.id, resolveModelPolicy(snapshot.config, a.id)]))
                  : undefined
                result = {
                  agents: entries, role_descriptions: roleDescriptions(snapshot.config), config_loads: configLoadStatus(),
                  evidence: { capture: snapshot.config.ledger.capture, ...observer.status() },
                  learning: learningStatus(),
                  config_sources: snapshot.sources, errors: snapshot.errors,
                  warnings: entries.filter(a => a.configured && !a.available).map(a => `Configured agent is unavailable: ${a.id}`),
                  ...(modelPolicies || routing.status === "blocked-config" ? {
                    ...(modelPolicies ? { model_policy_preview: modelPolicies } : {}),
                    model_routing_runtime: routing.status,
                    model_routing_selected: routing.selected,
                    model_routing_unavailable_agents: routing.unavailable,
                    model_routing_note: routing.status === "blocked-config"
                      ? "Configuration is unreadable: native model requests are blocked before transport until config repair and plugin restart. Valid disabled routing is unaffected."
                      : routing.status === "initial-only"
                      ? "Native 2.1.4 agent selection only. Only verified included routes (or explicitly opted-in verified metered routes) are dispatched. No live provider failover; unavailable routes fail closed."
                      : "Policy preview only: Loom does not yet route native provider requests in this host. No model-routing adapter is installed.",
                  } : {}),
                }; break
              }
              case "trace": {
                if ("offset" in input) throw new Error("Trace offset is not supported; follow next_cursor instead")
                const targetID = input.session_id === undefined ? actor.session_id : String(input.session_id)
                await checkedSession(targetID)
                if (input.operation === "timeline") {
                  // The 2.2.0 plugin SDK provides no target-Session read authority API.
                  // Do not silently expose another native Session's private context.
                  if (targetID !== actor.session_id && input.export_path === undefined)
                    throw new Error("Another Session's native context is not authorized; supply a project-local export with explicit native read permission")
                  const traceSource = input.export_path === undefined
                    ? { messages: unwrapped(await ctx.session.context({ sessionID: targetID })), locationVerified: true }
                    : await readSessionExport(directory, String(input.export_path), targetID, ctx.location.project.id, async canonicalPath => {
                        await ctx.permission.assert({
                          action: "read", resources: [canonicalPath], sessionID: actor.session_id,
                          agent: actor.agent,
                          source: { type: "tool", messageID: toolContext.messageID, id: toolContext.id },
                        })
                        if (!await owns(targetID)) throw new Error("Source Session moved during export permission approval")
                        toolContext.signal.throwIfAborted()
                      }, toolContext.signal)
                  toolContext.signal.throwIfAborted()
                  if (!await owns(targetID)) throw new Error("Source Session moved during trace read")
                  result = traceTimeline(traceSource.messages, {
                    sessionID: targetID,
                    source: input.export_path === undefined ? "native-context" : "provided-export",
                    locationVerified: traceSource.locationVerified,
                    cursor: input.cursor as string | undefined, limit: input.limit as number | undefined,
                    includeText: input.include_text as boolean | undefined,
                  })
                } else if (input.operation === "children") {
                  if (input.export_path !== undefined || input.include_text !== undefined)
                    throw new Error("children does not accept export_path or include_text")
                  if (await familyRoot(actor.session_id) !== await familyRoot(targetID))
                    throw new Error("Cannot enumerate unrelated Session family")
                  const native = payload(await ctx.session.list({
                    project: ctx.location.project.id, directory, parentID: targetID,
                    limit: input.limit as number | undefined ?? 20,
                    ...(input.cursor !== undefined ? { cursor: String(input.cursor) } : {}),
                  }))
                  if (!Array.isArray(native.data)) throw new Error("Native Session list did not return a data array")
                  const cursors = payload(native.cursor)
                  const sessions: Array<Record<string, unknown>> = []
                  for (const raw of native.data) {
                    const child = payload(raw)
                    if (typeof child.id !== "string" || child.parentID !== targetID || !await sessionIsLocal(child)) continue
                    sessions.push({ id: child.id, parent_id: targetID,
                      ...(typeof child.title === "string" ? { title: child.title } : {}) })
                  }
                  if (!await owns(targetID)) throw new Error("Source Session moved during child inventory")
                  result = { parent_session_id: targetID, sessions,
                    scanned: native.data.length, matched: sessions.length,
                    next_cursor: typeof cursors.next === "string" ? cursors.next : null,
                    note: "Only direct children in this local project/workspace. Follow next_cursor and inspect relevant descendants individually. Empty results and successful delegation claims are not proof that no other work occurred." }
                } else throw new Error("Unknown trace operation")
                break
              }
              case "insights":
                if (input.operation === "action") {
                  const actionID = input.action_id === undefined ? store.selected(actor.session_id)?.action_id : String(input.action_id)
                  if (!actionID) throw new Error("Insights action view requires explicit or selected action_id")
                  result = requiredLearning().events({ action_id: actionID, before: input.before as number | undefined, limit: input.limit as number | undefined,
                    since_at: input.since_at as string | undefined, until_at: input.until_at as string | undefined })
                } else if (input.operation === "window") {
                  if (input.action_id !== undefined) throw new Error("Window insights cannot use action_id")
                  result = requiredLearning().events({ before: input.before as number | undefined, limit: input.limit as number | undefined,
                    since_at: input.since_at as string | undefined, until_at: input.until_at as string | undefined })
                } else throw new Error("Unknown insights operation")
                break
              case "tweak":
                if (input.operation === "propose") result = requiredLearning().propose(actor, {
                  target_kind: input.target_kind as string, target_id: input.target_id as string,
                  base_sha256: input.base_sha256 as string, candidate_content: input.candidate_content as string,
                  hypothesis: input.hypothesis as string, evidence_refs: input.evidence_refs as string[] | undefined,
                  revised_from: input.revised_from as string | undefined })
                else if (input.operation === "list") result = requiredLearning().list(input.offset as number | undefined)
                else if (input.operation === "read") result = requiredLearning().read(String(input.id), input.trial_before as number | undefined)
                else if (input.operation === "retire") result = requiredLearning().retire(String(input.id))
                else if (input.operation === "trial") result = requiredLearning().trial(actor, { id: String(input.id),
                  observed_sha256: input.observed_sha256 as string | undefined,
                  observed_effect: input.observed_effect as string, statement: input.statement as string,
                  evidence_refs: input.evidence_refs as string[] | undefined })
                else throw new Error("Unknown tweak operation")
                break
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
                const identityScoped = ["complete", "answer", "bind-respondent"].includes(String(input.operation))
                  || (input.operation === "query" && input.view === "thread")
                const focus = identityScoped || input.session_only || (input.operation === "ask" && input.reference !== undefined) ? undefined : focusFor(input, actor.session_id)
                if (input.operation === "bind-respondent") {
                  const question = store.collaboration.thread(String(input.question_id)).question
                  if (question.data.format !== "loom-question/v2" ||
                      typeof question.data.expected_agent !== "string" ||
                      typeof question.data.expected_parent_session !== "string")
                    throw new Error("This question is not routed for forwarded-specialist binding; answer it directly if addressed to the dispatcher, or delegate a specialist without binding if you are consulting one")
                  if (question.data.expected_parent_session !== actor.session_id)
                    throw new Error("Only the question's dispatching Session can bind this forwarded specialist")
                  const receiverID = String(input.respondent_session_id) as Parameters<typeof ctx.session.get>[0]["sessionID"]
                  const receiver = payload(unwrapped(await ctx.session.get({ sessionID: receiverID })))
                  if (receiver.id !== receiverID || receiver.parentID !== actor.session_id ||
                      receiver.agent !== question.data.expected_agent || !await sessionIsLocal(receiver))
                    throw new Error("Respondent must be the intended native specialist child of this dispatching Session")
                  result = store.collaboration.bindRespondent(question.id, receiverID,
                    receiver.agent as string, actor.session_id)
                  break
                }
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
                  // The model-request guard is authoritative. A typed
                  // OQ must not spawn a native child (or wake a parent) when
                  // this host cannot dispatch a verified managed model.
                  const routingUnqualified = (startupGuard !== undefined && startupDispatch === "deny") ||
                    routingStatus === "blocked-config" ||
                    (snapshot.config.modelRouting.enabled && routingStatus !== "initial-only")
                  const plannedRoute: QuestionRoute = snapshot.errors.length
                    ? { mode: "manual", reason: "loom-config-unavailable" }
                    : questionRoute(recipient, snapshot.config, roster, asking)
                  let route: QuestionRoute = routingUnqualified && plannedRoute.mode !== "manual"
                    ? { mode: "manual", reason: "model-routing-host-unqualified" }
                    : plannedRoute
                  if (route.mode === "notify" && route.session && !await owns(route.session))
                    route = { mode: "manual", reason: "parent-not-local" }
                  const { operation: _askOperation, ...askFields } = input
                  const stored = store.collaboration.ask(actor, focus, askFields, {
                    ...(route.expected_agent ? { expected_agent: route.expected_agent } : {}),
                    ...(route.expected_session ? { expected_session: route.expected_session } : {}),
                    ...(route.expected_parent_session ? { expected_parent_session: route.expected_parent_session } : {}),
                  })
                  const dispatch = await sendQuestion(store, stored, route, {
                    delegate: async (agent, parentID, questionID, prompt, background) => {
                      const native = (await ctx.tool.list()).find(info => info.name === "subagent")
                      if (!native) throw new Error("OpenCode native subagent tool unavailable; no direct child creation")
                      const token = randomUUID()
                      const pending: { question: string; parent: string; agent: string; bound?: string } =
                        { question: questionID, parent: parentID, agent }
                      awaitingNativePrompt.set(token, pending)
                      try {
                        // Invoking the native tool preserves the effective depth limit,
                        // native permission checks, and model selection semantics.
                        const result = await native.execute({
                          agent, description: `Resolve Loom OQ ${questionID}`,
                          prompt: `Loom OQ dispatch token: ${token}\n${prompt}`, background,
                        }, toolContext)
                        const output = payload(result.output)
                        if (typeof output.sessionID !== "string" || pending.bound !== output.sessionID ||
                            !["running", "completed"].includes(String(output.status)))
                          throw new Error("Native subagent completion did not match the verified pre-admission binding")
                        return { sessionID: output.sessionID, status: output.status as "running" | "completed" }
                      } finally {
                        awaitingNativePrompt.delete(token)
                      }
                    },
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
            if (spec.name === "trace" && Buffer.byteLength(content, "utf8") > 262144)
              throw new Error("Trace response exceeds the 262144-byte limit; reduce limit or disable include_text")
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
            // Native skill loader result: provenance hint, not proof of model use.
            // Never store the skill body, original tool output or a claim of final delivery.
            if (record && record.data.attribution === "captured-at-start" && event.tool === "skill" && event.status === "completed") {
              const input = event.input && typeof event.input === "object" && !Array.isArray(event.input) ? event.input as Record<string, unknown> : {}
              const output = event.result as { content?: unknown }
              if (typeof input.id === "string" && input.id.length > 0 && input.id.length <= 200 &&
                  typeof output.content === "string" && Buffer.byteLength(output.content, "utf8") <= 131072) {
                const registry = unwrapped(await ctx.skill.list())
                const registered = Array.isArray(registry) ? registry.filter(s =>
                  !!s && typeof s === "object" && (s as { id?: unknown }).id === input.id) : []
                const current = registered.length === 1 ? registered[0] as { content?: unknown } : undefined
                const registeredText = typeof current?.content === "string" ? current.content : undefined
                store.observe({ session_id: event.sessionID, agent: event.agent },
                  record.action_id ? { action_id: record.action_id, ...(record.node_id ? { node_id: record.node_id } : {}) } : undefined,
                  { phase: "skill-load-result", skill_id: input.id, call_id: event.id,
                    rendered_sha256: createHash("sha256").update(output.content, "utf8").digest("hex"),
                    ...(registeredText ? { registry_content_sha256: createHash("sha256").update(registeredText, "utf8").digest("hex"),
                      registered_content_present: output.content.includes(registeredText.trim()) } : {}),
                    observation: "completed native skill tool result; registry sampled afterward; not proof of final model exposure or application" },
                  record.fingerprint)
              }
            }
          }
        } catch (error) { warn(error) }
      }))
    } catch (error) {
      lifetime.abort()
      await Promise.allSettled(disposers.map(d => d.dispose()))
      try { learningDatabase?.close() } finally { database.close() }
      throw error
    }
    // The early guard remains restrictive until the entire plugin initialized.
    // A valid, explicitly disabled policy removes it; a guarded runtime
    // delegates to the fully registered model.request hook. Unknown hosts
    // and partial runtimes remain denied instead of falling through.
    if (routingStatus === "disabled") {
      startupDispatch = "disabled"
      await disposeStartupGuard()
    } else if (routingStatus === "initial-only" || routingStatus === "blocked-config") {
      startupDispatch = "delegated"
    } else {
      // A capable real host with no working adapter must not silently fall
      // through to its global model. Incomplete legacy mocks have no early
      // guard and retain their existing setup behavior.
      startupDenial = "LOOM_MODEL_ROUTING_HOST_UNQUALIFIED: no proven native request guard"
    }
    return async () => {
      startupDispatch = "deny"
      lifetime.abort()
      await Promise.allSettled(disposers.map(d => d.dispose()))
      try { learningDatabase?.close() } finally { database.close() }
      await disposeStartupGuard()
    }
    } catch (error) {
      startupDispatch = "deny"
      startupDenial = "LOOM_MODEL_ROUTING_STARTUP_FAILED: plugin initialization failed; native dispatch blocked"
      // If the host does not expose the qualified early guard, we cannot
      // truthfully retain protection. Preserve the original startup failure.
      if (!startupGuard) throw error
      // Preserve pre-existing startup failure reporting and native fallback
      // when routing was demonstrably disabled by a successfully loaded config.
      // Unreadable config is NEVER interpreted as deliberate disabling.
      let safelyDisabled = false
      try {
        const root = await realpath(ctx.location.directory)
        const snapshot = await loadConfig(configPaths(root), decodeConfigYaml)
        safelyDisabled = snapshot.errors.length === 0 && !snapshot.config.modelRouting.enabled
      } catch { /* Unknown routing intent stays denied. */ }
      if (safelyDisabled) {
        startupDispatch = "disabled"
        await disposeStartupGuard()
        throw error
      }
      console.error("Loom startup failed; keeping native model dispatch denied:", error instanceof Error ? error.message : String(error))
      // Resolving setup retains the installed deny hook. Throwing would let
      // OpenCode unload that hook and continue with an unguarded global model.
      return async () => { startupDispatch = "deny"; await disposeStartupGuard() }
    }
  },
})
