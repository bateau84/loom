/** Opt-in, bounded observation for one operator-selected Evaluator audit.
 * No model calls, tool registration, prompt changes, raw text or credentials.
 * Local receipts are evidence for review, never human/billing attestation.
 */
import { Plugin } from "@opencode/plugin"
import { createHash, randomUUID } from "node:crypto"
import { constants, closeSync, fstatSync, fsyncSync, lstatSync, openSync, readFileSync, realpathSync, writeSync } from "node:fs"
import { join } from "node:path"
import { configPaths, loadConfig } from "../../src/config.js"
import { decodeConfigYaml } from "../../src/config-parser.js"
import { canonical } from "../../src/model.js"

type Obj = Record<string, unknown>
const object = (value: unknown): Obj => value !== null && typeof value === "object" && !Array.isArray(value) ? value as Obj : {}
const identifier = (value: unknown): string | undefined => typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,159}$/.test(value) ? value : undefined
const digest = (value: string) => createHash("sha256").update(value).digest("hex")
function resultText(value: unknown): string | undefined {
  const content = object(value).content
  if (typeof content === "string" && Buffer.byteLength(content) <= 262144) return content
  if (!Array.isArray(content) || content.length > 64) return undefined
  const text = content.filter(part => object(part).type === "text").map(part => object(part).text).filter((part): part is string => typeof part === "string").join("\n")
  return Buffer.byteLength(text) <= 262144 ? text : undefined
}

/** Projection owns the privacy boundary: only enumerated IDs, hashes and counts. */
export function projectReceipt(tool: string, inputValue: unknown, resultValue: unknown): Obj | undefined {
  const input = object(inputValue)
  if (tool === "skill" && input.id === "agent-run-audit") {
    const text = resultText(resultValue)
    return text === undefined ? undefined : { kind: "skill", skill: "agent-run-audit", delivered_result_sha256: digest(text) }
  }
  if (tool === "subagent" && input.agent === "evaluator") {
    const child = identifier(object(object(resultValue).output).sessionID)
    return child ? { kind: "delegation", child_session_id: child } : undefined
  }
  const text = resultText(resultValue)
  if (!text) return undefined
  let result: Obj
  try { result = object(object(JSON.parse(text)).result) } catch { return undefined }
  if (["loom_record", "loom.record"].includes(tool)) {
    const operation = input.operation
    let record: Obj
    if (operation === "add" && input.kind === "result") record = result
    else if (operation === "query" && identifier(input.record_id) && Array.isArray(result.items) && result.items.length === 1) record = object(result.items[0])
    else return undefined
    const id = identifier(record.id), action = identifier(record.action_id), writer = identifier(record.session_id), agent = identifier(record.agent)
    if (!id || !action || !writer || !agent || record.kind !== "result" || object(record.data).truncated === true ||
        typeof object(record.data).statement !== "string" || !Array.isArray(object(record.data).artifact_refs) ||
        (operation === "query" && (id !== input.record_id || (input.action_id !== undefined && action !== input.action_id)))) return undefined
    // Public queries add a pagination sequence that is not part of the stored
    // immutable record returned by add. Validate and exclude only that field.
    if (operation === "query" && (!Number.isSafeInteger(record.sequence) || Number(record.sequence) < 1)) return undefined
    if (operation === "add" && record.sequence !== undefined) return undefined
    const { sequence: _sequence, ...immutableRecord } = record
    return { kind: operation === "add" ? "record-write" : "record-read", record_id: id, action_id: action,
      writer_session_id: writer, writer_agent: agent, record_sha256: digest(canonical(immutableRecord)),
      source_refs_sha256: digest(canonical(object(record.data).artifact_refs)), source_ref_count: (object(record.data).artifact_refs as unknown[]).length }
  }
  if (["loom_trace", "loom.trace"].includes(tool) && input.operation === "timeline") {
    const session = identifier(result.session_id)
    if (!session || !["provided-export", "native-context"].includes(String(result.source)) || !Array.isArray(result.events)) return undefined
    const cursor = input.cursor, next = result.next_cursor
    if ((cursor !== undefined && typeof cursor !== "string") || (next !== undefined && next !== null && typeof next !== "string")) return undefined
    return { kind: "trace", source_session_id: session, source: result.source, event_count: result.events.length,
      cursor_sha256: typeof cursor === "string" ? digest(cursor) : null,
      next_cursor_sha256: typeof next === "string" ? digest(next) : null }
  }
  return undefined
}

export default Plugin.define({
  id: "loom.evaluator.qualification.observer",
  async setup(ctx) {
    const settingsPath = process.env.LOOM_EVALUATOR_OBSERVER
    if (!settingsPath) return
    // Explicit operator-owned settings are a collection scope, not an attestation.
    const settingsFD = openSync(settingsPath, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK)
    let settings: Obj
    try {
      const stat = fstatSync(settingsFD)
      if (!stat.isFile() || stat.size > 8192 || (stat.mode & 0o077) !== 0) throw new Error("Private observer settings required")
      settings = object(JSON.parse(readFileSync(settingsFD, "utf8")))
    } finally { closeSync(settingsFD) }
    const auditSession = identifier(settings.audit_session_id), recoverySession = identifier(settings.recovery_session_id)
    if (settings.format !== "loom-evaluator-observer/v1" || !auditSession || (settings.recovery_session_id !== undefined && !recoverySession) ||
        typeof settings.project_directory !== "string" || typeof settings.receipt_directory !== "string") throw new Error("Invalid observer scope")
    const directory = realpathSync(ctx.location.directory)
    if (directory !== realpathSync(settings.project_directory)) return
    const output = lstatSync(settings.receipt_directory)
    if (!output.isDirectory() || output.isSymbolicLink() || (output.mode & 0o077) !== 0) throw new Error("Private receipt directory required")
    const configuredPaths = configPaths(directory)
    const capture = async () => {
      const config = await loadConfig(configuredPaths, decodeConfigYaml)
      return config.errors.length === 0 && config.config.ledger.capture === "automatic"
    }
    if (!await capture()) return
    const instance = randomUUID()
    const fd = openSync(join(settings.receipt_directory, instance + ".ndjson"), constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600)
    let sequence = 0, bytes = 0, stopped = false, closed = false
    const emit = (type: string, data: Obj) => {
      if (stopped || closed) return
      const limited = sequence >= 510 || bytes >= 1000000
      const line = JSON.stringify({ format: "loom-evaluator-observer/v1", instance, sequence: ++sequence,
        type: limited ? "limit" : type, data: limited ? {} : data }) + "\n"
      try {
        if (writeSync(fd, line) !== Buffer.byteLength(line)) { stopped = true; return }
        fsyncSync(fd); bytes += Buffer.byteLength(line)
        if (limited) stopped = true
      } catch { stopped = true } // Never make a completed tool fail because observation failed.
    }
    const guarded = async (work: () => Promise<void>) => {
      if (closed || stopped) return
      try { if (await capture()) await work() } catch {
        try { if (await capture()) emit("observation-gap", {}) } catch { /* No capture after failed opt-out check. */ }
      }
    }
    const emitCaptured = async (type: string, data: Obj) => {
      // Scope lookup may wait on the host. Respect an opt-out made while it was
      // pending; nothing awaits between this final check and the private write.
      if (await capture()) emit(type, data)
    }
    const mayBeSelected = (session: string, agent: string) => session === auditSession || session === recoverySession || agent === "evaluator"
    const scope = async (sessionID: string, agent: string): Promise<Obj | undefined> => {
      if (sessionID !== auditSession && sessionID !== recoverySession && agent !== "evaluator") return undefined
      const raw = await ctx.session.get({ sessionID: sessionID as Parameters<typeof ctx.session.get>[0]["sessionID"] })
      const info = object(object(raw).data ?? raw)
      if (info.projectID !== ctx.location.project.id || object(info.location).directory !== directory) return undefined
      if (sessionID === auditSession || sessionID === recoverySession || (agent === "evaluator" && info.parentID === auditSession && info.agent === "evaluator"))
        return { session_id: sessionID, agent, parent_session_id: identifier(info.parentID) ?? null }
      return undefined
    }
    const registrations: Array<{ dispose(): Promise<void> }> = []
    emit("ready", { audit_session_id: auditSession, recovery_session_id: recoverySession ?? null,
      host_version: ctx.app.version, bun_version: process.versions.bun ?? "unknown", scope: "one-audit-and-recovery" })
    try {
      registrations.push(await ctx.session.hook("model.request", event => {
        if (!mayBeSelected(event.sessionID, event.agent)) return
        return guarded(async () => {
        const owned = await scope(event.sessionID, event.agent)
        if (!owned) return
        await emitCaptured("model-request", { ...owned, provider_id: identifier(event.model.providerID) ?? "unavailable",
          model_id: identifier(event.model.id) ?? "unavailable" })
        })
      }))
      registrations.push(await ctx.tool.hook("execute.after", event => {
        if (!mayBeSelected(event.sessionID, event.agent) || !["skill", "subagent", "loom_record", "loom.record", "loom_trace", "loom.trace"].includes(event.tool)) return
        return guarded(async () => {
        const owned = await scope(event.sessionID, event.agent)
        if (!owned) return
        const call = identifier(event.id), message = identifier(event.messageID)
        if (!call || !message) { await emitCaptured("observation-gap", {}); return }
        if (event.status !== "completed") { await emitCaptured("tool-failure", { ...owned, call_id: call, message_id: message, tool: event.tool }); return }
        const receipt = projectReceipt(event.tool, event.input, event.result)
        if (receipt) await emitCaptured("tool", { ...owned, call_id: call, message_id: message, ...receipt })
        })
      }))
    } catch {
      await Promise.allSettled(registrations.map(item => item.dispose()))
      try { if (await capture()) emit("observation-gap", {}) } catch { /* Respect a concurrent capture opt-out. */ }
      closed = true
      try { closeSync(fd) } catch { /* Observation failure never changes Session behavior. */ }
      return
    }
    return async () => {
      await Promise.allSettled(registrations.map(item => item.dispose()))
      try { if (await capture()) emit("closed", {}) } catch { /* No capture after failed opt-out check. */ }
      closed = true
      try { closeSync(fd) } catch { /* Observation failure never changes Session behavior. */ }
    }
  },
})
