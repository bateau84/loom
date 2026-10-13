import { appendFile, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { Plugin } from "@opencode/plugin"

const NATIVE_SCHEMA = "opencode-native-observation/v2"
const LOCAL_SCHEMA = "opencode-local-observation/v1"
const EVENT_LIMIT = 4096
const BYTE_LIMIT = 3_900_000
const RECORD_BYTES_LIMIT = 64_000
const OMIT_OPAQUE_PAYLOADS = "omit-opaque-payloads/v1"
const SYNTHETIC_FIXTURE_PAYLOADS = "synthetic-secret-free-fixture/v1"

type HookContext = {
  hook(name: string, callback: (event: Readonly<Record<string, unknown>>) => void | Promise<void>): Promise<{ dispose(): Promise<void> }>
}

function secretPatterns(secrets: string[]): { exact: Set<string> } {
  const exact = new Set<string>()
  for (const secret of secrets) {
    let frontier = new Set([secret])
    exact.add(secret)
    for (let depth = 0; depth < 3; depth += 1) {
      const next = new Set<string>()
      for (const value of frontier) {
        for (const asciiOnly of [false, true]) {
          const encoded = JSON.stringify(value).slice(1, -1)
          const escaped = asciiOnly ? encoded.replace(/[\u007f-\uffff]/g, (char) => `\\u${char.charCodeAt(0).toString(16).padStart(4, "0")}`) : encoded
          if (escaped && !exact.has(escaped)) next.add(escaped)
          exact.add(escaped)
        }
      }
      frontier = next
    }
  }
  return { exact }
}

export function parseCredentialInventoryPolicy(raw: string): string[] | null {
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
    if (!policy || policy.schema !== "loom-eval-credential-inventory/v1" ||
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
  const words = name
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1_$2")
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .toLowerCase()
    .match(/[a-z0-9]+/g) ?? []
  const normalized = words.join("_")
  return normalized === "key" || normalized === "apikey" || normalized.endsWith("_key") ||
    normalized === "token" || normalized === "access_token" || normalized === "refresh_token" ||
    ["secret", "password", "credential", "authorization", "cookie"].some((word) =>
      normalized === word || normalized.endsWith(`_${word}`))
}

function containsSensitive(
  value: unknown,
  patterns: ReturnType<typeof secretPatterns>,
  key = "",
  clippedValue = false,
  eventRoot = false,
): boolean {
  if (sensitiveKey(key)) return true
  if (typeof value === "string") {
    if (!(eventRoot && key === "schema")) {
      for (const secret of patterns.exact) if (secret && value.includes(secret)) return true
    }
    if (clippedValue) {
      // Do not approximate arbitrary substrings with sampled fragment lengths.
      // Omit a payload whose complete string is a known credential prefix or
      // suffix for any length; embedded upstream clipping is separately marked
      // unattested by the diagnostic schema because this hook has no truncation flag.
      for (const secret of patterns.exact) {
        if (value.length < secret.length && (secret.startsWith(value) || secret.endsWith(value))) return true
      }
    }
    return false
  }
  if (Array.isArray(value)) return value.some((item) => containsSensitive(item, patterns, "", clippedValue))
  if (value && typeof value === "object") {
    return Object.entries(value).some(([name, item]) => {
      const isPotentiallyClippedPayload = clippedValue || ["input", "result", "error", "output", "content", "text", "message", "value"].includes(name)
      const runtimeSchemaField = eventRoot && name === "schema"
      return (!runtimeSchemaField && containsSensitive(name, patterns)) ||
        containsSensitive(item, patterns, name, isPotentiallyClippedPayload, runtimeSchemaField)
    })
  }
  return false
}

export function observerMustOmitEvent(event: unknown, redactionValues: string[]): boolean {
  return containsSensitive(event, secretPatterns(redactionValues), "", false, true)
}

function eventHasUnknownFields(event: unknown, schema: string): boolean {
  if (!event || typeof event !== "object" || Array.isArray(event)) return true
  const kind = (event as Record<string, unknown>).kind
  if (typeof kind !== "string") return true
  const common = ["schema", "sequence", "actor", "observer_failures", "kind"]
  const fields: Record<string, Record<string, string[]>> = {
    [NATIVE_SCHEMA]: {
      call_start: ["invocation_id", "call_id", "tool", "mode", "parent", "input", "boundary"],
      call_end: ["invocation_id", "call_id", "boundary", "unavailable_fields", "outcome", "result", "error", "error_representation"],
    },
    [LOCAL_SCHEMA]: {
      parent_start: ["parent", "boundary", "mode"],
      parent_end: ["parent", "admitted", "dispatched", "terminals", "missing_terminals", "unsupported_dispatches", "unavailable_fields", "scope", "evidence_eligible"],
      call_start: ["parent", "invocation_id", "tool", "catalog_path", "input", "boundary"],
      call_end: ["parent", "invocation_id", "dispatched", "boundary", "outcome", "result", "error", "error_representation"],
    },
  }
  const allowedFields = fields[schema]?.[kind]
  if (!allowedFields) return true
  const keys = new Set([...common, ...allowedFields])
  if (Object.keys(event).some((key) => !keys.has(key))) return true

  const value = event as Record<string, unknown>
  const nonemptyString = (item: unknown): boolean => typeof item === "string" && item.length > 0
  const counter = (item: unknown): boolean => Number.isSafeInteger(item) && typeof item === "number" && item >= 0
  const stringFields = (object: unknown, names: string[]): boolean =>
    !!object && typeof object === "object" && !Array.isArray(object) &&
    names.every((name) => nonemptyString((object as Record<string, unknown>)[name]))
  if (!nonemptyString(value.schema) || !nonemptyString(value.kind) ||
      !counter(value.sequence) || !counter(value.observer_failures) ||
      !stringFields(value.actor, ["agent", "session_id", "message_id"])) return true
  const optionalCounters = ["unavailable_fields", "admitted", "terminals",
    "missing_terminals", "unsupported_dispatches"]
  if (optionalCounters.some((name) => Object.hasOwn(value, name) && !counter(value[name]))) return true
  const optionalStrings = ["invocation_id", "call_id", "tool", "catalog_path", "mode", "boundary",
    "outcome", "error_representation", "scope"]
  if (optionalStrings.some((name) => Object.hasOwn(value, name) && !nonemptyString(value[name]))) return true
  if ((Object.hasOwn(value, "dispatched") &&
       (schema === LOCAL_SCHEMA && value.kind === "parent_end" ? !counter(value.dispatched) : typeof value.dispatched !== "boolean")) ||
      (Object.hasOwn(value, "evidence_eligible") && typeof value.evidence_eligible !== "boolean")) return true
  if (schema === NATIVE_SCHEMA && value.kind === "call_start" && value.parent !== null) return true
  if (schema === LOCAL_SCHEMA && value.parent === undefined) return true

  const identityObjects: Record<string, string[]> = {
    actor: ["agent", "session_id", "message_id"],
    parent: ["invocation_id", "session_id", "message_id", "call_id"],
  }
  const invalidIdentity = Object.entries(identityObjects).some(([name, expected]) => {
    const object = value[name]
    if (object === undefined) return false
    if (name === "parent" && object === null && schema === NATIVE_SCHEMA && kind === "call_start") return false
    return !object || typeof object !== "object" || Array.isArray(object) ||
      Object.keys(object).length !== expected.length ||
      Object.keys(object).some((key) => !expected.includes(key)) ||
      expected.some((key) => typeof (object as Record<string, unknown>)[key] !== "string" ||
        !(object as Record<string, string>)[key])
  })
  if (invalidIdentity) return true

  const stringFieldsByKind: Record<string, string[]> = {
    call_start: schema === NATIVE_SCHEMA
      ? ["invocation_id", "call_id", "tool"]
      : ["invocation_id", "tool", "catalog_path"],
  }
  if (stringFieldsByKind[kind]?.some((name) => !nonemptyString(value[name]))) return true

  if (value.kind === "call_start") {
    return schema === NATIVE_SCHEMA
      ? value.mode !== "native" || value.boundary !== "executable-input"
      : value.boundary !== "executable-input"
  }
  if (value.kind === "call_end") {
    if (schema === NATIVE_SCHEMA) {
      return !nonemptyString(value.invocation_id) || !nonemptyString(value.call_id) ||
        value.boundary !== "session-tool-terminal" || !counter(value.unavailable_fields) ||
        !["returned", "threw"].includes(String(value.outcome)) ||
        (value.outcome === "threw" && !nonemptyString(value.error_representation))
    }
    return !nonemptyString(value.invocation_id) || value.boundary !== "codemode-json-return" ||
      value.dispatched !== true || !["returned", "threw", "interrupted"].includes(String(value.outcome)) ||
      (value.outcome === "threw" && !nonemptyString(value.error_representation))
  }
  if (schema === LOCAL_SCHEMA && value.kind === "parent_start") {
    return value.boundary !== "codemode-engine" || value.mode !== "code_mode"
  }
  if (schema === LOCAL_SCHEMA && value.kind === "parent_end") {
    return !["admitted", "dispatched", "terminals", "missing_terminals", "unsupported_dispatches", "unavailable_fields"]
      .every((name) => counter(value[name])) || value.scope !== "one-codemode-engine-invocation" ||
      value.evidence_eligible !== false
  }
  return true
}

function omissionReasonWithPatterns(
  event: Readonly<Record<string, unknown>>,
  patterns: ReturnType<typeof secretPatterns>,
  payloadPolicy: string,
): string | null {
  if (payloadPolicy !== OMIT_OPAQUE_PAYLOADS && payloadPolicy !== SYNTHETIC_FIXTURE_PAYLOADS) {
    return "unknown_payload_policy"
  }
  if (containsSensitive(event, patterns, "", false, true)) return "sensitive_value"
  const schema = event.schema
  if (typeof schema !== "string" || ![NATIVE_SCHEMA, LOCAL_SCHEMA].includes(schema) ||
      eventHasUnknownFields(event, schema)) return "unsupported_event_field"
  if (payloadPolicy === OMIT_OPAQUE_PAYLOADS &&
      (event.kind === "call_start" || event.kind === "call_end")) return "opaque_payload_unverified"
  return null
}

export function observerOmissionReason(
  event: Readonly<Record<string, unknown>>,
  redactionValues: string[],
  payloadPolicy: string,
): string | null {
  return omissionReasonWithPatterns(event, secretPatterns(redactionValues), payloadPolicy)
}

export default Plugin.define({
  id: "loom.normal-invoke-observer",
  async setup(ctx) {
    if (process.env.OPENCODE_EVAL_HOST_OBSERVATIONS !== "1" || process.env.OPENCODE_EVAL_OBSERVATIONS !== "1") {
      return
    }
    const hooks = ctx.tool as unknown as HookContext
    const path = join(ctx.location.directory, ".loom-normal-invoke-diagnostic.jsonl")
    const requestedPolicy = process.env.OPENCODE_EVAL_NORMAL_OBSERVATION_PAYLOAD_POLICY ?? OMIT_OPAQUE_PAYLOADS
    const payloadPolicy = requestedPolicy === SYNTHETIC_FIXTURE_PAYLOADS
      ? SYNTHETIC_FIXTURE_PAYLOADS
      : OMIT_OPAQUE_PAYLOADS
    const rawPolicy = process.env.OPENCODE_EVAL_REDACTION_VALUES ?? ""
    delete process.env.OPENCODE_EVAL_REDACTION_VALUES
    const secrets = parseCredentialInventoryPolicy(rawPolicy)
    if (secrets === null) return
    const redactionPatterns = secretPatterns(secrets)
    let count = 0
    let bytes = 0
    let complete = true
    let omittedEvents = 0
    let pending = Promise.resolve()

    async function emit(schema: string, event: Readonly<Record<string, unknown>>) {
      if (!complete || count >= EVENT_LIMIT) {
        complete = false
        return
      }
      let line: string
      try {
        const omissionReason = omissionReasonWithPatterns(event, redactionPatterns, payloadPolicy)
        if (omissionReason) {
          omittedEvents += 1
          line = JSON.stringify({ schema, payload_policy: payloadPolicy, diagnostic_only: true,
            evidence_eligible: false, event_omitted: true, omission_reason: omissionReason }) + "\n"
        } else {
          line = JSON.stringify({ schema, payload_policy: payloadPolicy, diagnostic_only: true,
            evidence_eligible: false, event }) + "\n"
        }
      } catch {
        complete = false
        return
      }
      let size = new TextEncoder().encode(line).byteLength
      if (size > RECORD_BYTES_LIMIT) {
        omittedEvents += 1
        line = JSON.stringify({ schema, payload_policy: payloadPolicy, diagnostic_only: true, evidence_eligible: false,
          event_omitted: true, omission_reason: "oversized_event" }) + "\n"
        size = new TextEncoder().encode(line).byteLength
      }
      if (bytes + new TextEncoder().encode(line).byteLength > BYTE_LIMIT) {
        complete = false
        return
      }
      count += 1
      bytes += size
      pending = pending.then(() => appendFile(path, line)).catch(() => { complete = false })
      await pending
    }

    await writeFile(path, JSON.stringify({ kind: "header", schema: "loom-normal-invoke-diagnostic/v1",
      payload_policy: payloadPolicy, diagnostic_only: true, evidence_eligible: false }) + "\n")
    const registrations = [
      await hooks.hook("execute.native-observed", async (event) => emit(NATIVE_SCHEMA, event)),
      await hooks.hook("execute.observed", async (event) => emit(LOCAL_SCHEMA, event)),
    ]
    return async () => {
      await pending
      try {
        await appendFile(path, JSON.stringify({ kind: "footer", schema: "loom-normal-invoke-diagnostic/v1",
          payload_policy: payloadPolicy, event_count: count, omitted_events: omittedEvents,
          writes_complete: complete, diagnostic_only: true, evidence_eligible: false }) + "\n")
      } catch {
        // A missing footer makes the diagnostic capture unusable.
      }
      await Promise.all(registrations.map((registration) => registration.dispose()))
    }
  },
})
