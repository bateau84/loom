import { constants } from "node:fs"
import { open, realpath } from "node:fs/promises"
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
  // Native permission is required even for a file under this project. Approval can yield;
  // recheck both the path and the Session identity after it returns.
  await authorize(canonical)
  if (await realpath(candidate) !== canonical) throw new Error("Export path changed during permission approval")
  // Avoid following the final component if it changes between validation and opening.
  const file = await open(canonical, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0))
  let content: string
  try {
    const stat = await file.stat()
    if (!stat.isFile() || stat.size < 1 || stat.size > MAX_EXPORT_BYTES) throw new Error("Export must be a regular JSON file of 1-16777216 bytes")
    content = await file.readFile({ encoding: "utf8" })
    if (Buffer.byteLength(content) > MAX_EXPORT_BYTES) throw new Error("Export exceeded the byte budget")
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
  offset?: number
  limit?: number
  includeText?: boolean
}
export function traceTimeline(input: unknown, options: TimelineOptions) {
  if (!Array.isArray(input)) throw new Error("Native Session history must be an array")
  if (input.length > MAX_MESSAGES) throw new Error("Session message processing budget exceeded")
  const offset = options.offset ?? 0
  const limit = options.limit ?? 25
  if (!Number.isSafeInteger(offset) || offset < 0 || offset > MAX_EVENTS ||
      !Number.isSafeInteger(limit) || limit < 1 || limit > 50)
    throw new Error("Trace offset must be 0-60000; limit must be 1-50")
  if (options.includeText !== undefined && typeof options.includeText !== "boolean")
    throw new Error("include_text must be Boolean")
  type Entry = Obj & { kind: string; source_message_id: string; created_at?: unknown }
  const events: Entry[] = []
  const toolStatuses: Record<string, { completed: number; error: number; in_progress: number }> = Object.create(null)
  const metrics = { messages: input.length, user_prompts: 0, assistant_steps: 0, tool_calls: 0,
    tool_errors: 0, dispatches: 0, skills_loaded: 0, compactions: 0, cost_usd: 0, tokens_input: 0, tokens_output: 0 }
  const add = (event: Entry) => {
    if (events.length >= MAX_EVENTS) throw new Error("Session trace event processing budget exceeded")
    events.push(event)
  }
  for (const raw of input) {
    const msg = obj(raw)
    const type = string(msg.type) ?? "unknown"
    const id = string(msg.id) ?? "unknown"
    const time = obj(msg.time)
    const base = { source_message_id: id, ...(time.created !== undefined ? { created_at: time.created } : {}) }
    if (type === "user") {
      metrics.user_prompts++
      add({ ...base, kind: "user_prompt", ...(options.includeText ? { text_excerpt: excerpt(msg.text, 1100) } : { text_withheld: true }),
        ...(Array.isArray(msg.skills) ? { requested_skills: msg.skills.filter(x => typeof x === "string").slice(0, 40) } : {}) })
      continue
    }
    if (type === "assistant") {
      metrics.assistant_steps++
      const model = obj(msg.model), tokens = obj(msg.tokens)
      metrics.cost_usd += num(msg.cost)
      metrics.tokens_input += num(tokens.input)
      metrics.tokens_output += num(tokens.output)
      const agent = string(msg.agent)
      add({ ...base, kind: "assistant_step", agent, provider: string(model.providerID), model: string(model.id),
        ...(typeof msg.cost === "number" ? { cost_usd: msg.cost } : {}),
        ...(msg.error ? { reported_error: true } : {}),
        ...(msg.retry ? { retry_attempt: obj(msg.retry).attempt } : {}),
        ...(msg.finish ? { finish_reason: string(msg.finish) } : {}) })
      for (const rawPart of Array.isArray(msg.content) ? msg.content : []) {
        const part = obj(rawPart)
        if (part.type === "tool") {
          metrics.tool_calls++
          const state = obj(part.state)
          const status = string(state.status) ?? "unknown"
          if (status === "error") metrics.tool_errors++
          const name = string(part.name) ?? "unknown"
          if (Object.keys(toolStatuses).length < 80 || toolStatuses[name]) {
            const counts = toolStatuses[name] ?? (toolStatuses[name] = { completed: 0, error: 0, in_progress: 0 })
            if (status === "completed") counts.completed++
            else if (status === "error") counts.error++
            else counts.in_progress++
          }
          const argumentsObject = obj(state.input)
          const dispatch = /^(task|delegate|dispatch|spawn_agent|subagent)$/i.test(name) ||
            typeof argumentsObject.subagent_type === "string"
          if (dispatch) metrics.dispatches++
          const prompt = string(argumentsObject.prompt) ?? string(argumentsObject.task) ?? string(argumentsObject.instructions)
          const recipient = string(argumentsObject.subagent_type) ?? string(argumentsObject.agent) ?? string(argumentsObject.to_agent)
          add({ ...base, kind: dispatch ? "agent_dispatch" : "tool_call", tool: name, call_id: string(part.id),
            status, agent, ...(recipient ? { recipient } : {}),
            ...(Object.keys(argumentsObject).length ? { input_fields: Object.keys(argumentsObject).slice(0, 30) } : {}),
            ...(dispatch && prompt !== undefined ? (options.includeText
              ? { dispatch_prompt_excerpt: excerpt(prompt, 1600), prompt_truncated: prompt.length > 1600 }
              : { dispatch_prompt_withheld: true }) : {}),
            ...(state.error ? { error_recorded: true } : {}),
          })
        } else if (part.type === "text") {
          add({ ...base, kind: "assistant_text", agent,
            ...(options.includeText ? { text_excerpt: excerpt(part.text, 1100) } : { text_withheld: true }) })
        } else if (part.type === "reasoning") {
          // Never project private model reasoning, even in include_text mode.
          add({ ...base, kind: "reasoning_present", text_withheld: true })
        }
      }
      continue
    }
    if (type === "skill") {
      metrics.skills_loaded++
      add({ ...base, kind: "skill_loaded", skill: string(msg.skill), name: string(msg.name) })
    } else if (type === "compaction") {
      metrics.compactions++
      add({ ...base, kind: "compaction", status: string(msg.status), reason: string(msg.reason) })
    } else if (type === "agent-switched") {
      add({ ...base, kind: "agent_switched", agent: string(msg.agent), previous: string(msg.previous) })
    } else if (type === "model-switched") {
      const model = obj(msg.model)
      add({ ...base, kind: "model_switched", provider: string(model.providerID), model: string(model.id) })
    } else if (type === "idle") {
      add({ ...base, kind: "turn_finished", outcome: string(msg.outcome) })
    } else if (type === "shell") {
      add({ ...base, kind: "shell", status: string(msg.status), exit: msg.exit,
        ...(options.includeText ? { command_excerpt: excerpt(msg.command, 900) } : { command_withheld: true }) })
    } else if (type === "synthetic") {
      add({ ...base, kind: "synthetic_input",
        ...(options.includeText ? { text_excerpt: excerpt(msg.text, 900) } : { text_withheld: true }) })
    } else {
      add({ ...base, kind: type === "system" ? "system_instruction" : "other", type })
    }
  }
  metrics.cost_usd = Math.round(metrics.cost_usd * 1e6) / 1e6
  return {
    session_id: options.sessionID,
    source: options.source,
    coverage: options.source === "native-context"
      ? { full_history: false, detail: "Only active messages after the latest completed compaction. Earlier history and child Sessions are NOT included." }
      : { full_history: null, detail: "Provided export matches the requested Session identity and location but completeness/integrity cannot be established. It may be sanitized, stale or incomplete. Child Sessions are NOT included." },
    metrics, tool_statuses: toolStatuses,
    offset, events: events.slice(offset, offset + limit),
    next_offset: offset + limit < events.length ? offset + limit : null,
    total_events: events.length, text_included: options.includeText === true,
    note: "Read-only, bounded projection. Tool output, raw tool inputs, skill contents, attachments and private reasoning are never returned. Original message/call IDs are evidence pointers, not proof of causality. Follow next_offset and inspect relevant child Sessions independently.",
  }
}
