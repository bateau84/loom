import { constants } from "node:fs"
import { open, realpath, stat } from "node:fs/promises"
import { isAbsolute, relative, resolve, sep } from "node:path"

const MAX_EXPORT_BYTES = 16 * 1024 * 1024
const MAX_MESSAGES = 20000
const MAX_EVENTS = 60000
const MAX_TRACE_RESULT_BYTES = 256 * 1024

type Obj = Record<string, unknown>
const obj = (value: unknown): Obj => value !== null && typeof value === "object" && !Array.isArray(value) ? value as Obj : {}
const string = (value: unknown): string | undefined => typeof value === "string" ? value : undefined
const num = (value: unknown): number => typeof value === "number" && Number.isFinite(value) ? value : 0
/** Model-visible metadata is untrusted too; never echo arbitrary host/JSON fields. */
const small = (value: unknown, max = 120): string | undefined =>
  typeof value === "string" ? value.slice(0, max) : undefined
function sourceId(value: unknown, label: string): string {
  if (typeof value !== "string" || value.length === 0 || value.length > 120 ||
      !/^[A-Za-z0-9_.:-]+$/.test(value))
    throw new Error(`Trace ${label} identifier must be 1-120 safe characters`)
  return value
}

/** Best-effort credential masking for optional excerpts.
 * Full source text is never returned, and masking cannot detect every private value. */
function redactText(value: string): string {
  return value
    .replace(/-----BEGIN [^-]*PRIVATE KEY-----[\s\S]*?-----END [^-]*PRIVATE KEY-----/gi, "[REDACTED]")
    .replace(/\beyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{6,}\b/g, "[REDACTED]")
    .replace(/\b(?:sk-(?:proj-|svc-)?[A-Za-z0-9_-]{12,}|github_pat_[A-Za-z0-9_]{12,}|gh[pousr]_[A-Za-z0-9_]{12,}|xox[baprs]-[A-Za-z0-9_-]{12,}|AKIA[A-Z0-9]{16})\b/g, "[REDACTED]")
    .replace(/\b((?:Bearer|Basic)\s+)[^\s"',;]{8,}/gi, "$1[REDACTED]")
    .replace(/\b((?:api[_-]?key|auth(?:orization)?|access[_-]?token|secret|password|passwd|client[_-]?secret|private[_-]?key|[\w]+_TOKEN)\s*[:=]\s*["']?)[^\s"',;]{4,}/gi, "$1[REDACTED]")
    .replace(/\b[A-Za-z0-9_+/-]{48,}\b/g, "[REDACTED]")
}
const excerpt = (value: unknown, limit = 700): string | undefined =>
  typeof value === "string" ? redactText(value).slice(0, limit) : undefined
const local = (root: string, path: string) => path !== root && !relative(root, path).startsWith(".." + sep) &&
  relative(root, path) !== ".." && !isAbsolute(relative(root, path))

/** Read one explicitly supplied OpenCode export without accessing the host database or other projects.
 * The full untrusted transcript is never returned to the tool caller or stored in Loom. */
export async function readSessionExport(directory: string, path: string, sessionID: string, projectID: string, authorize: (canonicalPath: string) => Promise<void>, signal?: AbortSignal): Promise<{ messages: unknown[]; locationVerified: boolean }> {
  signal?.throwIfAborted()
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
  signal?.throwIfAborted()
  if (await realpath(candidate) !== canonical)
    throw new Error("Export path changed during permission approval")

  // Open the exact checked candidate, without following a final symlink.
  // Use the descriptor for both identity checks and a size-bounded read.
  // O_NONBLOCK prevents a replaced FIFO from hanging before descriptor stat.
  // It does not change reads from regular files; stat below rejects all other types.
  const file = await open(candidate, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0))
  let content: string
  try {
    signal?.throwIfAborted()
    if (!unchanged(await file.stat())) throw new Error("Export file changed during permission approval")
    if (await realpath(candidate) !== canonical) throw new Error("Export path changed during open")
    const buffer = Buffer.alloc(before.size + 1)
    let count = 0
    while (count < buffer.length) {
      signal?.throwIfAborted()
      const { bytesRead } = await file.read(buffer, count, buffer.length - count, count)
      if (bytesRead === 0) break
      count += bytesRead
    }
    signal?.throwIfAborted()
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
  // OpenCode 2.2.0 sanitize=true deliberately replaces the original
  // directory with this exact marker. Treat it as unknown location, not a
  // verified path; the native requested Session is separately location-checked.
  const redactedDirectory = `/[redacted:session-directory:${sessionID}]`
  const locationVerified = location.directory !== redactedDirectory
  if (locationVerified) {
    let exportedDirectory: string
    try { exportedDirectory = await realpath(location.directory) }
    catch { throw new Error("Export Session directory cannot be verified") }
    if (exportedDirectory !== root) throw new Error("Export belongs to a different Session location")
  }
  if (!Array.isArray(transfer.messages) || transfer.messages.length > MAX_MESSAGES)
    throw new Error("Export messages are absent or exceed the processing budget")
  signal?.throwIfAborted()
  return { messages: transfer.messages, locationVerified }
}

export type TimelineOptions = {
  sessionID: string
  source: "native-context" | "provided-export"
  cursor?: string
  limit?: number
  includeText?: boolean
  locationVerified?: boolean
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
  const id = sourceId(message.id, "source message")
  const time = obj(message.time)
  const created = time.created
  const base = { source_message_id: id,
    ...(typeof created === "number" && Number.isFinite(created)
      ? { created_at: created } : typeof created === "string" ? { created_at: small(created, 48) } : {}) }
  const type = string(message.type)
  if (type === "user") return { ...base, kind: "user_prompt",
    ...(includeText ? { text_excerpt: excerpt(message.text, 1100) } : { text_withheld: true }),
    ...(Array.isArray(message.skills) ? { requested_skills: message.skills.slice(0, 40)
      .map(x => obj(x).id).filter(x => x !== undefined).map(x => sourceId(x, "requested skill")) } : {}) }
  if (type === "assistant") {
    const agent = string(message.agent)
    if (partIndex === 0) {
      const model = obj(message.model)
      return { ...base, kind: "assistant_step", agent: small(agent),
        provider: small(model.providerID), model: small(model.id, 160),
        ...(typeof message.cost === "number" && Number.isFinite(message.cost) ? { cost_usd: message.cost } : {}),
        ...(message.error ? { reported_error: true } : {}),
        ...(message.retry && Number.isSafeInteger(obj(message.retry).attempt) ? { retry_attempt: obj(message.retry).attempt } : {}),
        ...(message.finish ? { finish_reason: small(message.finish, 40) } : {}),
        ...(message.tokens ? { tokens_input: num(obj(message.tokens).input), tokens_output: num(obj(message.tokens).output) } : {}) }
    }
    const content = Array.isArray(message.content) ? message.content : []
    const part = obj(content[partIndex - 1])
    if (part.type === "tool") {
      const state = obj(part.state)
      const status = small(state.status, 40) ?? "unknown"
      const name = small(part.name, 120) ?? "unknown"
      const input = obj(state.input)
      const dispatch = directDispatch(name, input)
      const opaque = !dispatch && opaqueExecutor(name)
      const prompt = string(input.prompt) ?? string(input.task) ?? string(input.instructions)
      const recipient = small(input.subagent_type) ?? small(input.agent) ?? small(input.to_agent)
      return { ...base, kind: dispatch ? "agent_dispatch" : opaque ? "opaque_tool" : "tool_call",
        tool: name, ...(part.id === undefined ? {} : { call_id: sourceId(part.id, "tool call") }),
        status, agent: small(agent),
        ...(recipient ? { recipient } : {}),
        ...(Object.keys(input).length ? { input_fields: Object.keys(input).slice(0, 30).map(x => x.slice(0, 64)) } : {}),
        ...(dispatch && prompt !== undefined ? (includeText
          ? { dispatch_prompt_excerpt: excerpt(prompt, 1600), prompt_truncated: prompt.length > 1600 }
          : { dispatch_prompt_withheld: true }) : {}),
        ...(opaque ? { delegation_visibility: "unknown-inner-calls" } : {}),
        ...(state.error ? { error_recorded: true } : {}) }
    }
    if (part.type === "text") return { ...base, kind: "assistant_text", agent: small(agent),
      ...(includeText ? { text_excerpt: excerpt(part.text, 1100) } : { text_withheld: true }) }
    if (part.type === "reasoning") return { ...base, kind: "reasoning_present", text_withheld: true }
    return { ...base, kind: "assistant_other_part", part_type: small(part.type, 48) }
  }
  if (type === "skill") return { ...base, kind: "skill_loaded", skill: small(message.skill), name: small(message.name) }
  if (type === "compaction") return { ...base, kind: "compaction", status: small(message.status, 40), reason: small(message.reason, 40) }
  if (type === "agent-switched") return { ...base, kind: "agent_switched", agent: small(message.agent), previous: small(message.previous) }
  if (type === "model-switched") {
    const model = obj(message.model)
    return { ...base, kind: "model_switched", provider: small(model.providerID), model: small(model.id, 160) }
  }
  if (type === "idle") return { ...base, kind: "turn_finished", outcome: small(message.outcome, 40) }
  if (type === "shell") return { ...base, kind: "shell", status: small(message.status, 40), exit: typeof message.exit === "number" && Number.isFinite(message.exit) ? message.exit : undefined,
    ...(includeText ? { command_excerpt: excerpt(message.command, 900) } : { command_withheld: true }) }
  if (type === "synthetic") return { ...base, kind: "synthetic_input",
    ...(includeText ? { text_excerpt: excerpt(message.text, 900) } : { text_withheld: true }) }
  return { ...base, kind: type === "system" ? "system_instruction" : "other", type: small(type, 48) }
}

export function traceTimeline(input: unknown, options: TimelineOptions) {
  if (!Array.isArray(input)) throw new Error("Native Session history must be an array")
  if (input.length > MAX_MESSAGES) throw new Error("Session message processing budget exceeded")
  const limit = options.limit ?? 25
  if (!isIndex(limit, 50) || limit < 1) throw new Error("Trace limit must be 1-50")
  if (options.includeText !== undefined && typeof options.includeText !== "boolean")
    throw new Error("include_text must be Boolean")
  sourceId(options.sessionID, "session")
  if (options.source !== "native-context" && options.source !== "provided-export")
    throw new Error("Invalid trace source")
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
  const locationVerified = options.source === "native-context" || options.locationVerified === true
  const result = {
    session_id: options.sessionID, source: options.source,
    coverage: options.source === "native-context"
      ? { full_history: false, delegation_complete: false, location_verified: true,
          detail: "Only the caller's post-compaction context. Earlier history, nested Code Mode tools and child Sessions are NOT included." }
      : { full_history: null, delegation_complete: false, location_verified: locationVerified,
          detail: locationVerified
            ? "Export declares matching Session/project, and its directory resolves to this project. Its completeness and authenticity are unverified."
            : "Export declares matching Session/project but OpenCode redacted the original directory. Source location, completeness and authenticity are unverified." },
    source_messages: input.length, metrics_scope: "page", metrics, tool_statuses: toolStatuses,
    events, next_cursor: next ? encodePosition(next) : null,
    total_events: next ? null : seen, text_included: options.includeText === true,
    note: "Bounded per-page projection with best-effort credential masking, not guaranteed secret removal. Tool output, raw inputs, skill contents, attachments and private reasoning are withheld. Unknown wrappers may hide delegation; follow child Sessions and Loom observations. Export JSON is reparsed on each page and cursors are not a consistent snapshot.",
  }
  if (Buffer.byteLength(JSON.stringify(result), "utf8") > MAX_TRACE_RESULT_BYTES)
    throw new Error("Trace output exceeds the 262144-byte page limit; reduce limit or disable include_text")
  return result
}
