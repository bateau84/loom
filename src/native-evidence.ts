import { createHash } from "node:crypto"
import { canonical, ProcessingBudget, uid } from "./model.js"

const MAX_SOURCE_BYTES = 16 * 1024 * 1024
const MAX_MESSAGES = 20000
const MAX_PARTS = 60000
const MAX_OUTPUT_BYTES = 256 * 1024
const MAX_VALUES = 1000000

type Obj = Record<string, unknown>
type NativeEvidenceSourceKind = "native-context" | "provided-export"
export type NativeEvidenceField = "input" | "output" | "dispatch" | "status" | "error"
export type NativeEvidenceMatchField = "tool" | "status" | "dispatch" | "input" | "output"
type Availability = "available" | "missing" | "redacted"
type CommonOptions = {
  sessionID: string
  source: NativeEvidenceSourceKind
  sourceSha256: string
  locationVerified?: boolean
}
export type NativeEvidencePartsOptions = CommonOptions & {
  cursor?: string
  limit?: number
  match?: string
  matchFields?: NativeEvidenceMatchField[]
  tool?: string
  messageID?: string
}
export type NativeEvidenceSourceOptions = CommonOptions & {
  messageID: string
  partID: string
  fields: NativeEvidenceField[]
  expectedSha256?: string
  expectedPartSha256?: string
}
type Part = { messageID: string; value: Obj; messageCreatedAt?: number }
type Source = { parts: Part[]; messageCount: number; messagesSha256: string; bytes: number }
type FieldValue = { availability: Availability; value?: unknown; bytes: number }

const mapping = (value: unknown): Obj | undefined => value !== null && typeof value === "object" && !Array.isArray(value)
  ? value as Obj : undefined
const hash = (value: string) => createHash("sha256").update(value).digest("hex")
const sha256 = (value: unknown, label: string): string => {
  if (typeof value !== "string" || !/^[a-f0-9]{64}$/.test(value)) throw new Error(`Invalid native evidence ${label}`)
  return value
}
function serialized(value: unknown, maxBytes = MAX_SOURCE_BYTES): string {
  const result = canonical(value, new ProcessingBudget(maxBytes, MAX_VALUES))
  if (Buffer.byteLength(result, "utf8") > maxBytes) throw new Error("Native evidence exceeds byte processing limit")
  return result
}
function encodedMessages(messages: unknown): string {
  if (!Array.isArray(messages) || messages.length > MAX_MESSAGES)
    throw new Error("Native evidence requires at most 20000 normalized messages")
  return serialized(messages)
}

/** A bounded digest of the normalized native messages, not a proof of authenticity. */
export const nativeEvidenceDigest = (messages: unknown): string => hash(encodedMessages(messages))

/** OpenCode owns inline/split storage normalization. Consume its public v2 content shape only. */
function inspect(messages: unknown): Source {
  const encoded = encodedMessages(messages)
  const source = messages as unknown[]
  const messageIDs = new Set<string>(), parts: Part[] = []
  let partCount = 0
  for (const raw of source) {
    const message = mapping(raw)
    if (!message) throw new Error("Invalid normalized native message")
    const messageID = uid(message.id, "native evidence message id")
    if (messageIDs.has(messageID)) throw new Error("Ambiguous native evidence message identity")
    messageIDs.add(messageID)
    if (message.type !== "assistant") continue
    if (!Array.isArray(message.content)) throw new Error("Native assistant message has no normalized content")
    partCount += message.content.length
    if (partCount > MAX_PARTS) throw new Error("Native evidence exceeds 60000 content parts")
    const identities = new Set<string>()
    const time = mapping(message.time)
    const messageCreatedAt = typeof time?.created === "number" && Number.isFinite(time.created) && time.created >= 0
      ? time.created : undefined
    for (const rawPart of message.content) {
      const part = mapping(rawPart)
      if (!part) throw new Error("Invalid normalized native content part")
      if (part.type !== "tool") continue
      const partID = uid(part.id, "native evidence part id")
      if (identities.has(partID)) throw new Error("Ambiguous native evidence part identity")
      identities.add(partID)
      const state = mapping(part.state)
      if (typeof part.name !== "string" || !part.name || part.name.length > 120 || !state)
        throw new Error("Invalid normalized native tool part")
      if (typeof state.status !== "string" || !["streaming", "running", "completed", "error"].includes(state.status))
        throw new Error("Invalid normalized native tool status")
      parts.push({ messageID, value: part, ...(messageCreatedAt !== undefined ? { messageCreatedAt } : {}) })
    }
  }
  return { parts, messageCount: source.length, messagesSha256: hash(encoded), bytes: Buffer.byteLength(encoded, "utf8") }
}

function common(options: CommonOptions) {
  uid(options.sessionID, "native evidence Session id")
  sha256(options.sourceSha256, "source sha256")
  if (options.source !== "native-context" && options.source !== "provided-export")
    throw new Error("Invalid native evidence source")
  if (options.locationVerified !== undefined && typeof options.locationVerified !== "boolean")
    throw new Error("Invalid native evidence location verification")
}

function sourceView(source: Source, options: CommonOptions) {
  return {
    session_id: options.sessionID,
    source: options.source,
    source_sha256: options.sourceSha256,
    messages_sha256: source.messagesSha256,
    normalized_source_bytes: source.bytes,
    coverage: options.source === "native-context"
      ? { full_history: false, authenticity: "native-context", location_verified: true,
          detail: "Only the caller's post-compaction context; earlier messages and child Session content are not included." }
      : { full_history: null, authenticity: "provided-export-unverified", location_verified: options.locationVerified === true,
          detail: "The supplied export declares this Session. Its authenticity and completeness are unverified; a digest only pins the supplied bytes." },
  }
}

// Recognize the native export sanitizer's exact marker forms. Do not treat a
// marker as the requested original, or match identifiers within removed content.
function redacted(value: unknown): boolean {
  if (typeof value === "string") return /^\[redacted:[^\]\r\n]+\]$/.test(value)
  if (Array.isArray(value)) return value.some(redacted)
  const object = mapping(value)
  if (!object) return false
  if (Object.keys(object).length === 1 && typeof object.redacted === "string") return true
  return Object.values(object).some(redacted)
}
function field(part: Part, name: NativeEvidenceField): FieldValue {
  const state = mapping(part.value.state)!
  let value: unknown
  if (name === "input") value = state.input
  else if (name === "output") value = state.content
  else if (name === "status") value = state.status
  else if (name === "error") value = state.error
  else {
    const metadata = mapping(state.metadata)
    if (metadata && Object.keys(metadata).length === 1 && typeof metadata.redacted === "string")
      return { availability: "redacted", bytes: 0 }
    if (typeof metadata?.sessionID === "string") {
      if (redacted(metadata.sessionID)) return { availability: "redacted", bytes: 0 }
      value = { session_id: uid(metadata.sessionID, "native dispatch Session id"), source_field: "state.metadata.sessionID" }
    }
  }
  if (value === undefined) return { availability: "missing", bytes: 0 }
  if (redacted(value)) return { availability: "redacted", bytes: 0 }
  return { availability: "available", value, bytes: Buffer.byteLength(serialized(value), "utf8") }
}
const FIELDS: NativeEvidenceField[] = ["input", "output", "dispatch", "status", "error"]
function metadata(part: Part, sessionID: string) {
  const fields = Object.fromEntries(FIELDS.map(name => {
    const f = field(part, name)
    return [name, { availability: f.availability, bytes: f.bytes }]
  }))
  const state = mapping(part.value.state)!
  const encoded = serialized(part.value)
  const time = mapping(part.value.time)
  const createdAt = typeof time?.created === "number" && Number.isFinite(time.created) && time.created >= 0
    ? time.created : undefined
  return {
    session_id: sessionID,
    message_id: part.messageID,
    part_id: part.value.id as string,
    tool: part.value.name as string,
    status: typeof state.status === "string" && ["streaming", "running", "completed", "error"].includes(state.status)
      ? state.status : "unknown",
    ...(createdAt !== undefined ? { created_at: createdAt } : {}),
    ...(part.messageCreatedAt !== undefined ? { message_created_at: part.messageCreatedAt } : {}),
    part_sha256: hash(encoded),
    normalized_part_bytes: Buffer.byteLength(encoded, "utf8"),
    fields,
  }
}

function output<T>(value: T): T {
  serialized(value, MAX_OUTPUT_BYTES)
  return value
}

function partsOptions(options: NativeEvidencePartsOptions) {
  const limit = options.limit ?? 25
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 50) throw new Error("Native evidence limit must be 1-50")
  if (options.messageID !== undefined) uid(options.messageID, "native evidence message id")
  if (options.tool !== undefined && (typeof options.tool !== "string" || !options.tool || options.tool.length > 120))
    throw new Error("Native evidence tool filter must be 1-120 characters")
  if (options.match !== undefined && (typeof options.match !== "string" || !options.match || options.match.length > 256))
    throw new Error("Native evidence literal match must be 1-256 characters")
  if (options.match === undefined && options.matchFields !== undefined)
    throw new Error("Native evidence matchFields requires match")
  const matchFields = options.match === undefined ? [] : options.matchFields ?? ["tool", "status", "dispatch"]
  if (!Array.isArray(matchFields) || matchFields.length > 5 || (options.match !== undefined && matchFields.length === 0)
    || matchFields.some(name => !["tool", "status", "dispatch", "input", "output"].includes(name))
    || new Set(matchFields).size !== matchFields.length)
    throw new Error("Native evidence match fields must select tool, status, dispatch, input, or output once")
  return { limit, matchFields: [...matchFields].sort() as NativeEvidenceMatchField[] }
}

/** Metadata-only inventory/matching. Permission checks belong to the caller and source owner. */
export function nativeEvidenceParts(messages: unknown, options: NativeEvidencePartsOptions) {
  common(options)
  const { limit, matchFields } = partsOptions(options)
  const source = inspect(messages)
  const scope = hash(serialized({ session: options.sessionID, source: options.source, sourceSha256: options.sourceSha256,
    messagesSha256: source.messagesSha256, locationVerified: options.locationVerified === true,
    match: options.match ?? null, matchFields, tool: options.tool ?? null, message: options.messageID ?? null }))
  let start = 0
  if (options.cursor !== undefined) {
    if (typeof options.cursor !== "string" || options.cursor.length > 512 || !/^[A-Za-z0-9_-]+$/.test(options.cursor))
      throw new Error("Invalid native evidence cursor")
    let cursor: Obj | undefined
    try { cursor = mapping(JSON.parse(Buffer.from(options.cursor, "base64url").toString("utf8"))) }
    catch { throw new Error("Invalid native evidence cursor") }
    if (!cursor || cursor.version !== 1 || cursor.scope !== scope || !Number.isSafeInteger(cursor.index)
      || (cursor.index as number) < 0 || (cursor.index as number) > source.parts.length)
      throw new Error("Native evidence cursor source or filters changed")
    start = cursor.index as number
  }
  const items: ReturnType<typeof metadata>[] = []
  let index = start, scanned = 0
  for (; index < source.parts.length; index++) {
    if (items.length === limit) break
    const part = source.parts[index]!
    scanned++
    if (options.messageID !== undefined && part.messageID !== options.messageID) continue
    if (options.tool !== undefined && part.value.name !== options.tool) continue
    if (options.match !== undefined && !matchFields.some(name => {
      if (name === "tool") return (part.value.name as string).includes(options.match!)
      const f = field(part, name)
      if (f.availability !== "available") return false
      if (name === "dispatch") return (mapping(f.value)!.session_id as string).includes(options.match!)
      if (name === "status") return (f.value as string).includes(options.match!)
      return serialized(f.value).includes(options.match!)
    })) continue
    items.push(metadata(part, options.sessionID))
  }
  return output({
    format: "loom-native-evidence-parts/v1",
    ...sourceView(source, options),
    source_messages: source.messageCount,
    tool_parts: source.parts.length,
    items,
    scanned,
    next_cursor: index < source.parts.length
      ? Buffer.from(JSON.stringify({ version: 1, scope, index })).toString("base64url") : null,
    matching: options.match === undefined ? null : { mode: "case-sensitive-literal", fields: matchFields,
      body_representation: "input/output use JSON; structural fields use only tool name, status, or dispatch Session ID" },
    note: "Metadata only. Matching selects identities, not evidence support or objective membership. Follow next_cursor until null; each page pins the source and filters.",
  })
}

/** Resolve an exact native tool part's explicitly selected fields; no substitution or excerpts. */
export function nativeEvidenceSource(messages: unknown, options: NativeEvidenceSourceOptions) {
  common(options)
  uid(options.messageID, "native evidence message id")
  uid(options.partID, "native evidence part id")
  if (!Array.isArray(options.fields) || options.fields.length < 1 || options.fields.length > FIELDS.length
    || options.fields.some(name => !FIELDS.includes(name)) || new Set(options.fields).size !== options.fields.length)
    throw new Error("Native evidence fields must select input, output, dispatch, status, or error once")
  if (options.expectedSha256 !== undefined) sha256(options.expectedSha256, "expected sha256")
  if (options.expectedPartSha256 !== undefined) sha256(options.expectedPartSha256, "expected part sha256")
  const source = inspect(messages)
  const identity = { session_id: options.sessionID, message_id: options.messageID, part_id: options.partID }
  const base = { format: "loom-native-evidence-source/v1", ...sourceView(source, options), identity }
  if (options.expectedSha256 !== undefined && options.expectedSha256 !== options.sourceSha256)
    return output({ ...base, status: "changed" as const, fields: {}, gaps: options.fields.map(name => ({ field: name, reason: "source-changed" })) })
  const part = source.parts.find(item => item.messageID === options.messageID && item.value.id === options.partID)
  if (!part) return output({ ...base, status: "missing" as const, fields: {}, gaps: options.fields.map(name => ({ field: name, reason: "source-missing" })) })
  if (options.expectedPartSha256 !== undefined && options.expectedPartSha256 !== hash(serialized(part.value)))
    return output({ ...base, status: "changed" as const, fields: {}, gaps: options.fields.map(name => ({ field: name, reason: "part-changed" })) })
  const values: Record<string, unknown> = {}, gaps: Array<{ field: NativeEvidenceField; reason: string }> = []
  for (const name of options.fields) {
    const f = field(part, name)
    if (f.availability === "available") values[name] = f.value
    else gaps.push({ field: name, reason: f.availability === "redacted" ? "redacted" : "field-missing" })
  }
  return output({ ...base, status: gaps.length ? "partial" as const : "resolved" as const,
    part: metadata(part, options.sessionID), fields: values, gaps,
    note: "Approved field projection of the exact stored native tool part. Output is state.content, not a separate result. Dispatch is a stored metadata Session reference; it does not attest Loom assignment, native admission, or objective participation.",
  })
}
