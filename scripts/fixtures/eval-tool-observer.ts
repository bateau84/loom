import { appendFile, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { Plugin } from "@opencode/plugin"

const SCHEMA = "loom-eval-tool-observer/v1"
const EVENT_LIMIT = 512
const FIELD_BYTES_LIMIT = 64_000
const TOTAL_BYTES_LIMIT = 2_000_000

export function parseCredentialInventory(raw: string): string[] | null {
  try {
    const policy = JSON.parse(raw) as Record<string, unknown>
    const sources = policy.sources
    const sourceNames = ["auth", "config", "config_root", "credential_seed", "env", "models"]
    const sourceStates = new Set(["complete", "incomplete", "not_selected"])
    const sourcesValid = !!sources && typeof sources === "object" && !Array.isArray(sources) &&
      Object.keys(sources).sort().join(",") === sourceNames.join(",") &&
      Object.values(sources).every((state) => typeof state === "string" && sourceStates.has(state))
    const complete = sourcesValid && Object.values(sources as Record<string, string>)
      .every((state) => state === "complete" || state === "not_selected")
    if (policy.schema !== "loom-eval-credential-inventory/v1" ||
        policy.policy_version !== "source-path-roles/v1" || !sourcesValid || policy.complete !== complete ||
        policy.complete !== true ||
        !Array.isArray(policy.values) || policy.values.some((value) => typeof value !== "string" || !value) ||
        Object.keys(policy).sort().join(",") !== "complete,policy_version,schema,sources,values") return null
    return [...new Set(policy.values as string[])]
  } catch {
    return null
  }
}

function sensitiveKey(name: string): boolean {
  const normalized = name.replace(/([A-Z]+)([A-Z][a-z])/g, "$1_$2")
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2").toLowerCase().match(/[a-z0-9]+/g)?.join("_") ?? ""
  return normalized === "key" || normalized === "apikey" || normalized.endsWith("_key") ||
    normalized === "token" || normalized === "access_token" || normalized === "refresh_token" ||
    ["secret", "password", "credential", "authorization", "cookie"].some((word) =>
      normalized === word || normalized.endsWith(`_${word}`))
}

export function eventContainsCredential(value: unknown, secrets: string[]): boolean {
  return containsPattern(value, credentialPatterns(secrets))
}

function credentialPatterns(secrets: string[]): Set<string> {
  const patterns = new Set<string>()
  for (const secret of secrets) {
    let frontier = new Set([secret])
    patterns.add(secret)
    for (let depth = 0; depth < 3; depth += 1) {
      const next = new Set<string>()
      for (const current of frontier) {
        const encoded = JSON.stringify(current).slice(1, -1)
        if (encoded && !patterns.has(encoded)) next.add(encoded)
        patterns.add(encoded)
      }
      frontier = next
    }
  }
  return patterns
}

function containsPattern(value: unknown, patterns: Set<string>): boolean {
  if (typeof value === "string") return [...patterns].some((secret) => secret && value.includes(secret))
  if (Array.isArray(value)) return value.some((item) => containsPattern(item, patterns))
  if (value && typeof value === "object") {
    return Object.entries(value).some(([key, item]) =>
      sensitiveKey(key) || containsPattern(key, patterns) || containsPattern(item, patterns))
  }
  return false
}

function jsonValue(value: unknown): unknown {
  if (value instanceof Error) {
    return { name: value.name, message: value.message }
  }
  if (Array.isArray(value)) return value.map(jsonValue)
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, jsonValue(item)]))
  }
  return value
}

export default Plugin.define({
  id: "loom.eval-tool-observer",
  async setup(ctx) {
    const rawPolicy = process.env.OPENCODE_EVAL_REDACTION_VALUES ?? ""
    delete process.env.OPENCODE_EVAL_REDACTION_VALUES
    const secrets = parseCredentialInventory(rawPolicy)
    if (secrets === null) return
    const patterns = credentialPatterns(secrets)
    const path = join(ctx.location.directory, ".loom-eval-tool-observer.jsonl")
    const registrations = await ctx.tool.list()
    const registrationIDs = new Set(registrations.map((tool) => tool.id))
    const active = new Map<string, Map<string, { tool: string; call_id: string; hook_id: string; registered_tool: string; session_id: string; agent: string; message_id: string }>>()
    const inFlight = new Map<string, string[]>()
    let sequence = 0
    let eventCount = 0
    let bytes = 0
    let complete = true
    let pending = Promise.resolve()

    await writeFile(path, JSON.stringify({ kind: "header", schema: SCHEMA }) + "\n")

    const emit = async (record: Record<string, unknown>) => {
      if (!complete || eventCount >= EVENT_LIMIT) {
        complete = false
        return
      }
      if (containsPattern(record, patterns)) {
        complete = false
        return
      }
      let line: string
      try {
        line = JSON.stringify({ ...record, sequence: ++sequence }) + "\n"
      } catch {
        complete = false
        return
      }
      const size = new TextEncoder().encode(line).byteLength
      if (size > FIELD_BYTES_LIMIT || bytes + size > TOTAL_BYTES_LIMIT) {
        complete = false
        return
      }
      eventCount += 1
      bytes += size
      pending = pending.then(() => appendFile(path, line)).catch(() => {
        complete = false
      })
      await pending
    }

    const beforeRegistration = await ctx.tool.hook("execute.before", async (event) => {
      try {
        const currentTools = await ctx.tool.list()
        const registered = currentTools.find((tool) => tool.id === event.tool)?.id ??
          (event.tool === "execute" ? "execute" : undefined)
        if (!registered) complete = false
        else registrationIDs.add(registered)
        const scope = `${event.sessionID}\u0000${event.agent}\u0000${event.messageID}`
        const pairingKey = `${scope}\u0000${event.id}`
        const hookID = String(sequence + 1)
        const pending = inFlight.get(pairingKey) ?? []
        if (pending.length !== 0) complete = false
        pending.push(hookID)
        inFlight.set(pairingKey, pending)
        let parents = active.get(scope)
        if (!parents) {
          parents = new Map()
          active.set(scope, parents)
        }
        const parentCandidates = [...parents.values()]
        const parent = parentCandidates.length === 1 && event.tool !== "execute"
          ? parentCandidates[0]
          : undefined
        const ambiguous = parentCandidates.length > 1 && event.tool !== "execute"
        if (ambiguous) complete = false
        await emit({
          kind: "before",
          registered_tool: registered,
          hook_id: hookID,
          tool: event.tool,
          call_id: event.id,
          session_id: event.sessionID,
          agent: event.agent,
          message_id: event.messageID,
          input: jsonValue(event.input),
          parent: parent ?? null,
          ...(ambiguous ? { parent_ambiguous: true } : {}),
        })
        if (event.tool === "execute") {
          parents.set(event.id, {
            tool: event.tool,
            call_id: event.id,
            hook_id: hookID,
            registered_tool: registered ?? event.tool,
            session_id: event.sessionID,
            agent: event.agent,
            message_id: event.messageID,
          })
        }
      } catch {
        complete = false
      }
    })

    const afterRegistration = await ctx.tool.hook("execute.after", async (event) => {
      try {
        const scope = `${event.sessionID}\u0000${event.agent}\u0000${event.messageID}`
        const currentTools = await ctx.tool.list()
        const registered = currentTools.find((tool) => tool.id === event.tool)?.id ??
          (event.tool === "execute" ? "execute" : undefined)
        if (!registered) complete = false
        else registrationIDs.add(registered)
        const pairingKey = `${scope}\u0000${event.id}`
        const pending = inFlight.get(pairingKey) ?? []
        const hookID = pending.length === 1 ? pending[0] : undefined
        if (pending.length !== 1) complete = false
        inFlight.delete(pairingKey)
        await emit({
          kind: "after",
          registered_tool: registered,
          hook_id: hookID ?? null,
          tool: event.tool,
          call_id: event.id,
          session_id: event.sessionID,
          agent: event.agent,
          message_id: event.messageID,
          input: jsonValue(event.input),
          status: event.status,
          ...(event.status === "completed"
            ? { result: jsonValue(event.result) }
            : { error: jsonValue(event.error) }),
        })
        if (event.tool === "execute") {
          const parents = active.get(scope)
          parents?.delete(event.id)
          if (parents?.size === 0) active.delete(scope)
        }
      } catch {
        complete = false
      }
    })

    return async () => {
      await pending
      try {
        await appendFile(path, JSON.stringify({
          kind: "footer",
          schema: SCHEMA,
          complete: complete && active.size === 0,
          event_count: eventCount,
          registration_ids: [...registrationIDs].sort(),
        }) + "\n")
      } catch {
        // Missing or incomplete observer output is non-evidence to the harness.
      }
      await beforeRegistration.dispose()
      await afterRegistration.dispose()
    }
  },
})
