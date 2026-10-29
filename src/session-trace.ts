import { constants } from "node:fs"
import { open, realpath, stat } from "node:fs/promises"
import { isAbsolute, relative, resolve, sep } from "node:path"

const MAX_EXPORT_BYTES = 16 * 1024 * 1024
const MAX_MESSAGES = 20000
const MAX_EVENTS = 60000

type Obj = Record<string, unknown>
const obj = (value: unknown): Obj => value !== null && typeof value === "object" && !Array.isArray(value) ? value as Obj : {}
const string = (value: unknown): string | undefined => typeof value === "string" ? value : undefined
const num = (value: unknown): number => typeof value === "number" && Number.isFinite(value) ? value : 0
const excerpt = (value: unknown, limit = 700): string | undefined => typeof value === "string" ? value.slice(0, limit) : undefined
const local = (root: string, path: string) => path !== root && !relative(root, path).startsWith(".." + sep) &&
  relative(root, path) !== ".." && !isAbsolute(relative(root, path))

/** Read one explicitly supplied OpenCode export without accessing the host database or other projects.
 * The full untrusted transcript is never returned to the tool caller or stored in Loom. */
export async function readSessionExport(directory: string, path: string, sessionID: string, projectID: string, authorize: (canonicalPath: string) => Promise<void>): Promise<unknown[]> {
  if (typeof path !== "string" || !path || path.length > 4096 || isAbsolute(path) || path.includes("\0"))
    throw new Error("export_path must be a relative path under the current project")
  const root = await realpath(directory)
  const candidate = resolve(root, path)
  if (!local(root, candidate)) throw new Error("Export must stay within the current project")
  const canonical = await realpath(candidate)
  if (!local(root, canonical)) throw new Error("Export resolves outside the current project")

  // Approval can suspend execution. Pin file identity and metadata before approval:
  // path equality alone does not detect same-path replacement or in-place writes.
  const before = await stat(canonical)
  if (!before.isFile() || before.size < 1 || before.size > MAX_EXPORT_BYTES)
    throw new Error("Export must be a regular JSON file of 1-16777216 bytes")
  const unchanged = (now: typeof before) =>
    now.isFile() && now.dev === before.dev && now.ino === before.ino &&
    now.size === before.size && now.mtimeMs === before.mtimeMs && now.ctimeMs === before.ctimeMs

  await authorize(canonical)
  if (await realpath(candidate) !== canonical)
    throw new Error("Export path changed during permission approval")

  // Open the exact checked candidate, without following a final symlink.
  // Use the descriptor for both identity checks and a size-bounded read.
  const file = await open(candidate, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0))
  let content: string
  try {
    if (!unchanged(await file.stat())) throw new Error("Export file changed during permission approval")
    if (await realpath(candidate) !== canonical) throw new Error("Export path changed during open")
    const buffer = Buffer.alloc(before.size + 1)
    let count = 0
    while (count < buffer.length) {
      const { bytesRead } = await file.read(buffer, count, buffer.length - count, count)
      if (bytesRead === 0) break
      count += bytesRead
    }
    if (count !== before.size || !unchanged(await file.stat()))
      throw new Error("Export file changed during reading")
    content = buffer.subarray(0, count).toString("utf8")
  } finally { await file.close() }

  let raw: unknown
  try { raw = JSON.parse(content) } catch { throw new Error("Export is not valid JSON") }
  const top = obj(raw)
  const transfer = obj(top.data ?? raw)
  const info = obj(transfer.info)
  if (info.id !== sessionID || info.projectID !== projectID)
    throw new Error("Export identity does not match this project's requested Session")
  const location = obj(info.location)
  if (typeof location.directory !== "string")
    throw new Error("Export Session location is missing")
  let exportedDirectory: string
  try { exportedDirectory = await realpath(location.directory) } catch { throw new Error("Export Session directory cannot be verified") }
  if (exportedDirectory !== root) throw new Error("Export belongs to a different Session location")
  if (!Array.isArray(transfer.messages) || transfer.messages.length > MAX_MESSAGES)
    throw new Error("Export messages are absent or exceed the processing budget")
  return transfer.messages
}

export type TimelineOptions = {
  sessionID: string
  source: "native-context" | "provided-export"
  cursor?: string
  limit?: number
  includeText?: boolean
}

type Event = Obj & { kind: string; source_message_id: string; created_at?: number | string }
type Position = { version: 1; session_id: string; source: TimelineOptions["source"]; message: number; part: number; seen: number }
const isIndex = (x: unknown, max: number): x is number => Number.isSafeInteger(x) && (x as number) >= 0 && (x as number) <= max
const encodePosition = (value: Position) => Buffer.from(JSON.stringify(value)).toString("base64url")
function decodePosition(encoded: string, options: TimelineOptions): Position {
  if (typeof encoded !== "string" || encoded.length > 4096 || !/^[A-Za-z0-9_-]+$/.test(encoded))
    throw new Error("Invalid trace cursor")
  let data: Obj
  try { data = obj(JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"))) }
  catch { throw new Error("Invalid trace cursor") }
  if (data.version !== 1 || data.session_id !== options.sessionID || data.source !== options.source ||
    !isIndex(data.message, MAX_MESSAGES) || !isIndex(data.part, MAX_EVENTS) || !isIndex(data.seen, MAX_EVENTS))
    throw new Error("Trace cursor does not match this Session/source or exceeds limits")
  return data as Position
}

const toolBase = (name: string) => name.split(/[.:/]/).at(-1) ?? name
const directDispatch = (name: string, input: Obj) =>
  /^(task|delegate|dispatch|spawn_agent|subagent|run_agent)$/i.test(toolBase(name)) ||
  typeof input.subagent_type === "string" || typeof input.to_agent === "string"
const opaqueExecutor = (name: string) =>
  /^(functions\.exec|execute|code|codemode|execute_code|multi_tool_use\.parallel|batch_tools|batch|parallel)$/i.test(name) ||
  /^(codemode|execute_code|multi_tool_use)$/i.test(toolBase(name))

/**
 * Project one event. Cursor positions are native message index and (for assistant)
 * content index. No raw tool arguments, tool outputs or provider reasoning leave Loom.
 * A tool wrapper may hide delegated calls: flag the limitation, do not guess activity.
 */
function projectEvent(message: Obj, partIndex: number, includeText: boolean): Event {
  const id = string(message.id)
  if (!id) throw new Error("Native Session message is missing its source ID")
  const time = obj(message.time)
  const created = time.created
  const base = { source_message_id: id,
    ...(typeof created === "number" || typeof created === "string" ? { created_at: created } : {}) }
  const type = string(message.type)
  if (type === "user") return { ...base, kind: "user_prompt",
    ...(includeText ? { text_excerpt: excerpt(message.text, 1100) } : { text_withheld: true }),
    ...(Array.isArray(message.skills) ? { requested_skills: message.skills.filter(x => typeof x === "string").slice(0, 40) } : {}) }
  if (type === "assistant") {
    const agent = string(message.agent)
    if (partIndex === 0) {
      const model = obj(message.model)
      return { ...base, kind: "assistant_step", agent,
        provider: string(model.providerID), model: string(model.id),
        ...(typeof message.cost === "number" ? { cost_usd: message.cost } : {}),
        ...(message.error ? { reported_error: true } : {}),
        ...(message.retry ? { retry_attempt: obj(message.retry).attempt } : {}),
        ...(message.finish ? { finish_reason: string(message.finish) } : {}),
        ...(message.tokens ? { tokens_input: num(obj(message.tokens).input), tokens_output: num(obj(message.tokens).output) } : {}) }
    }
    const content = Array.isArray(message.content) ? message.content : []
    const part = obj(content[partIndex - 1])
    if (part.type === "tool") {
      const state = obj(part.state)
      const status = string(state.status) ?? "unknown"
      const name = string(part.name) ?? "unknown"
      const input = obj(state.input)
      const dispatch = directDispatch(name, input)
      const opaque = !dispatch && opaqueExecutor(name)
      const prompt = string(input.prompt) ?? string(input.task) ?? string(input.instructions)
      const recipient = string(input.subagent_type) ?? string(input.agent) ?? string(input.to_agent)
      return { ...base, kind: dispatch ? "agent_dispatch" : opaque ? "opaque_tool" : "tool_call",
        tool: name, call_id: string(part.id), status, agent,
        ...(recipient ? { recipient } : {}),
        ...(Object.keys(input).length ? { input_fields: Object.keys(input).slice(0, 30) } : {}),
        ...(dispatch && prompt !== undefined ? (includeText
          ? { dispatch_prompt_excerpt: excerpt(prompt, 1600), prompt_truncated: prompt.length > 1600 }
          : { dispatch_prompt_withheld: true }) : {}),
        ...(opaque ? { delegation_visibility: "unknown-inner-calls" } : {}),
        ...(state.error ? { error_recorded: true } : {}) }
    }
    if (part.type === "text") return { ...base, kind: "assistant_text", agent,
      ...(includeText ? { text_excerpt: excerpt(part.text, 1100) } : { text_withheld: true }) }
    if (part.type === "reasoning") return { ...base, kind: "reasoning_present", text_withheld: true }
    return { ...base, kind: "assistant_other_part", part_type: string(part.type) }
  }
  if (type === "skill") return { ...base, kind: "skill_loaded", skill: string(message.skill), name: string(message.name) }
  if (type === "compaction") return { ...base, kind: "compaction", status: string(message.status), reason: string(message.reason) }
  if (type === "agent-switched") return { ...base, kind: "agent_switched", agent: string(message.agent), previous: string(message.previous) }
  if (type === "model-switched") {
    const model = obj(message.model)
    return { ...base, kind: "model_switched", provider: string(model.providerID), model: string(model.id) }
  }
  if (type === "idle") return { ...base, kind: "turn_finished", outcome: string(message.outcome) }
  if (type === "shell") return { ...base, kind: "shell", status: string(message.status), exit: message.exit,
    ...(includeText ? { command_excerpt: excerpt(message.command, 900) } : { command_withheld: true }) }
  if (type === "synthetic") return { ...base, kind: "synthetic_input",
    ...(includeText ? { text_excerpt: excerpt(message.text, 900) } : { text_withheld: true }) }
  return { ...base, kind: type === "system" ? "system_instruction" : "other", type }
}

export function traceTimeline(input: unknown, options: TimelineOptions) {
  if (!Array.isArray(input)) throw new Error("Native Session history must be an array")
  if (input.length > MAX_MESSAGES) throw new Error("Session message processing budget exceeded")
  const limit = options.limit ?? 25
  if (!isIndex(limit, 50) || limit < 1) throw new Error("Trace limit must be 1-50")
  if (options.includeText !== undefined && typeof options.includeText !== "boolean")
    throw new Error("include_text must be Boolean")
  const initial: Position = options.cursor === undefined
    ? { version: 1, session_id: options.sessionID, source: options.source, message: 0, part: 0, seen: 0 }
    : decodePosition(options.cursor, options)
  if (initial.message >= input.length && (initial.message !== input.length || initial.part !== 0))
    throw new Error("Trace cursor is outside the source messages")

  const events: Event[] = []
  const metrics = { user_prompts: 0, assistant_steps: 0, tool_calls: 0, tool_errors: 0,
    dispatches: 0, opaque_tools: 0, skills_loaded: 0, compactions: 0,
    cost_usd: 0, tokens_input: 0, tokens_output: 0 }
  const toolStatuses: Record<string, { completed: number; error: number; in_progress: number }> = Object.create(null)
  let seen = initial.seen
  let next: Position | null = null
  for (let i = initial.message; i < input.length && !next; i++) {
    const msg = obj(input[i])
    const count = msg.type === "assistant" && Array.isArray(msg.content) ? 1 + msg.content.length : 1
    const start = i === initial.message ? initial.part : 0
    if (start >= count) throw new Error("Trace cursor has invalid message part")
    for (let part = start; part < count; part++) {
      if (events.length === limit) {
        next = { ...initial, message: i, part, seen }
        break
      }
      if (seen >= MAX_EVENTS) throw new Error("Session trace event processing budget exceeded")
      const event = projectEvent(msg, part, options.includeText === true)
      events.push(event); seen++
      if (event.kind === "user_prompt") metrics.user_prompts++
      if (event.kind === "assistant_step") {
        metrics.assistant_steps++
        metrics.cost_usd += num(event.cost_usd)
        metrics.tokens_input += num(event.tokens_input)
        metrics.tokens_output += num(event.tokens_output)
      }
      if (["agent_dispatch", "opaque_tool", "tool_call"].includes(event.kind)) {
        metrics.tool_calls++
        if (event.kind === "agent_dispatch") metrics.dispatches++
        if (event.kind === "opaque_tool") metrics.opaque_tools++
        if (event.status === "error") metrics.tool_errors++
        const name = string(event.tool) ?? "unknown"
        if (Object.keys(toolStatuses).length < 80 || toolStatuses[name]) {
          const entry = toolStatuses[name] ?? (toolStatuses[name] = { completed: 0, error: 0, in_progress: 0 })
          if (event.status === "completed") entry.completed++
          else if (event.status === "error") entry.error++
          else entry.in_progress++
        }
      }
      if (event.kind === "skill_loaded") metrics.skills_loaded++
      if (event.kind === "compaction") metrics.compactions++
    }
  }
  metrics.cost_usd = Math.round(metrics.cost_usd * 1e6) / 1e6
  return {
    session_id: options.sessionID, source: options.source,
    coverage: options.source === "native-context"
      ? { full_history: false, delegation_complete: false,
          detail: "Only active messages after the latest completed compaction. Earlier history, nested Code Mode tools and child Sessions are NOT included." }
      : { full_history: null, delegation_complete: false,
          detail: "Provided export identity and location match, but completeness/integrity are unverified. Nested Code Mode tools and child Sessions are NOT included." },
    source_messages: input.length, metrics_scope: "page", metrics, tool_statuses: toolStatuses,
    events, next_cursor: next ? encodePosition(next) : null,
    total_events: next ? null : seen, text_included: options.includeText === true,
    note: "Bounded per-page projection. Tool output, raw inputs, skill contents, attachments and private reasoning are withheld. Unknown wrappers may hide delegation; follow native child Sessions and Loom observations. An export JSON file is reparsed on each page; the cursor is not a consistent snapshot.",
  }
}
