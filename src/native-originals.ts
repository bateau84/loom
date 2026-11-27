import { canonical, digest, ProcessingBudget, ProcessingLimitError, uid } from "./model.js"
import type { EvaluationSourceRef } from "./evaluation-store.js"
import { nativeEvidenceDigest, nativeEvidenceSource, type NativeEvidenceField } from "./native-evidence.js"
import type { RetrospectiveSourceRequest, RetrospectiveSourceResolution } from "./retrospective-populations.js"

const MAX_SOURCE_BYTES = 16 * 1024 * 1024
const MAX_OUTPUT_BYTES = 256 * 1024
const MAX_VALUES = 1000000
const CALL_FIELDS: NativeEvidenceField[] = ["input", "output", "error", "status", "dispatch"]
export type NativeOriginalNamespace = { source_store_id: string; project_id: string; workspace_id: string | null }
export type NativeOriginalDescriptor = {
  source_store_id: string; source: EvaluationSourceRef;
  permitted_view: "native-call-fields-v1" | "native-user-text-v1";
}
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value)
const bounded = (value: unknown, bytes: number) => {
  const encoded = canonical(value, new ProcessingBudget(bytes, MAX_VALUES))
  if (Buffer.byteLength(encoded, "utf8") > bytes) throw new ProcessingLimitError("Native original exceeds byte processing limit")
  return encoded
}
const fingerprint = (value: unknown) => digest(value, new ProcessingBudget(MAX_SOURCE_BYTES, MAX_VALUES))

/** Only a descriptor proposal. It is neither an access grant nor a native-store identity. */
export function nativeOriginalDescriptor(source: EvaluationSourceRef, sourceStoreID: string): NativeOriginalDescriptor | null {
  if (source.kind !== "native-call" && source.kind !== "native-message") return null
  uid(sourceStoreID, "native reference store")
  uid(source.session_id, "native source Session")
  uid(source.id, "native source identity")
  if (source.kind === "native-call") uid(source.message_id, "native source message")
  else if (source.message_id !== undefined) throw new Error("Invalid native message source identity")
  return { source_store_id: sourceStoreID, source: { ...source },
    permitted_view: source.kind === "native-call" ? "native-call-fields-v1" : "native-user-text-v1" }
}

/** A pure projection of the current caller's supported native context. The
 * registered owner supplies that exact context after inspection/disclosure
 * authorization and rechecks authorization before return. This function does
 * not authorize IO, exported history, another Session, or another recipient. */
export function resolveNativeOriginal(request: RetrospectiveSourceRequest, messages: unknown,
  namespace: NativeOriginalNamespace): RetrospectiveSourceResolution {
  const descriptor = nativeOriginalDescriptor(request.source, namespace.source_store_id)
  if (!descriptor) return { ...request, status: "unsupported", gap: { code: "unsupported-native-source", detail: "This source kind has no current-context original view." } }
  if (request.source_store_id !== namespace.source_store_id || request.permitted_view !== descriptor.permitted_view
    || request.source.session_id !== request.recipient_session_id)
    throw new Error("Native original unavailable in the authorized scope")
  uid(namespace.project_id, "native project")
  if (namespace.workspace_id !== null) uid(namespace.workspace_id, "native workspace")
  try {
    return projectNativeOriginal(request, messages, namespace, descriptor)
  } catch (error) {
    // Availability can change without invalidating the immutable membership.
    // Only finite processing capacity becomes a source gap. Malformed source
    // data, identity bindings and caller authorization must still fail closed.
    if (!(error instanceof ProcessingLimitError) || error.kind !== "capacity") throw error
    return { ...request, status: "unresolved", gap: { code: "native-source-processing-limit",
      detail: "The current native context or selected original exceeds a processing limit. No original content was returned; frozen membership and source pins remain unchanged." } }
  }
}

function projectNativeOriginal(request: RetrospectiveSourceRequest, messages: unknown,
  namespace: NativeOriginalNamespace, descriptor: NativeOriginalDescriptor): RetrospectiveSourceResolution {
  // Reuse the existing finite normalized-context budget. Its digest is useful
  // only while reading; never put it in a member version or stable projection.
  const contextSha256 = nativeEvidenceDigest(messages)
  const sourceNamespace = { loom_reference_store_id: namespace.source_store_id,
    project_id: namespace.project_id, workspace_id: namespace.workspace_id, native_store_identity: "unavailable" }
  const coverage = { full_history: false, source: "caller-current-native-context",
    native_store_identity: "unavailable", representation: "original-field-projection",
    detail: "Only this caller's post-compaction context; no earlier or other-Session content is implied. The Loom reference namespace does not identify the native store." }
  const missing = (): RetrospectiveSourceResolution => ({ ...request, status: "missing",
    gap: { code: "native-context-missing", detail: "The exact selected identity is absent from the caller's current context; earlier history, deletion and compaction are not distinguished." } })
  const changed = (): RetrospectiveSourceResolution => ({ ...request, status: "changed",
    gap: { code: "native-view-changed", detail: "The selected native source version or permitted projection no longer matches the frozen reference." } })
  let value: Record<string, unknown>, revision: string
  if (request.source.kind === "native-call") {
    const original = nativeEvidenceSource(messages, { sessionID: request.source.session_id!, source: "native-context",
      sourceSha256: contextSha256, messageID: request.source.message_id!, partID: request.source.id,
      fields: CALL_FIELDS })
    if (original.status === "missing" || !("part" in original)) return missing()
    revision = "sha256:" + original.part.part_sha256
    value = { format: "loom-native-original/v1", namespace: sourceNamespace, identity: original.identity,
      revision: { kind: "normalized-native-part-sha256", value: original.part.part_sha256 },
      permitted_view: descriptor.permitted_view, resolution: original.status, fields: original.fields, gaps: original.gaps,
      coverage: { ...coverage, selected_fields: [...CALL_FIELDS], complete_selected_fields: original.gaps.length === 0,
        invocation_provenance: "not-established", effective_instructions_and_configuration: "not-observed-by-this-view" } }
  } else {
    const seen = new Set<string>()
    let selected: Record<string, unknown> | undefined
    for (const raw of messages as unknown[]) {
      if (!object(raw)) throw new Error("Invalid normalized native message")
      const id = uid(raw.id, "native source message")
      if (seen.has(id)) throw new Error("Ambiguous native message identity")
      seen.add(id)
      if (id === request.source.id) selected = raw
    }
    if (!selected) return missing()
    if (selected.type !== "user") return { ...request, status: "unsupported", gap: {
      code: "unsupported-native-message-type", detail: "This permitted view reads native user-message text only; other message types and hidden reasoning are not selected." } }
    if (typeof selected.text !== "string") return { ...request, status: "missing", gap: {
      code: "native-user-text-missing", detail: "The exact native user message has no original text field in the supported representation." } }
    if (/^\[redacted:[^\]\r\n]+\]$/.test(selected.text)) return { ...request, status: "unsupported", gap: {
      code: "redaction-marker-unverified", detail: "The selected text is a redaction-shaped marker; original text and sanitizer provenance are unavailable." } }
    bounded(selected, MAX_SOURCE_BYTES)
    const messageSha256 = fingerprint(selected)
    revision = "sha256:" + messageSha256
    value = { format: "loom-native-original/v1", namespace: sourceNamespace,
      identity: { session_id: request.source.session_id, message_id: request.source.id },
      revision: { kind: "normalized-native-message-sha256", value: messageSha256 },
      permitted_view: descriptor.permitted_view, resolution: "resolved", fields: { text: selected.text }, gaps: [],
      coverage: { ...coverage, selected_fields: ["text"], complete_selected_fields: true,
        excluded_views: ["attachments", "metadata", "instructions", "configuration", "reasoning"],
        human_origin_and_admission_provenance: "not-established" } }
  }
  // Freeze the returned projection in memory as well: the caller's decoded
  // context objects must not remain aliases that can change after hashing.
  value = JSON.parse(bounded(value, MAX_OUTPUT_BYTES)) as Record<string, unknown>
  const sha256 = fingerprint(value)
  if (request.source.revision !== undefined && request.source.revision !== revision
    || request.source.sha256 !== undefined && request.source.sha256 !== sha256) return changed()
  return { ...request, source: { ...request.source, revision, sha256 }, status: "available", value }
}
