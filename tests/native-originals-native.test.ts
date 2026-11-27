import { expect, test } from "bun:test"
import { digest } from "../src/model.js"
import { nativeOriginalDescriptor, resolveNativeOriginal } from "../src/native-originals.js"
import type { RetrospectiveSourceRequest } from "../src/retrospective-populations.js"

const namespace = { source_store_id: "paired-loom-store", project_id: "project", workspace_id: null }
const call = (id: string, text = "named-subtest passed") => ({ type: "tool", id, name: "shell",
  state: { status: "completed", input: { command: "go test -run named-subtest" }, content: [{ type: "text", text }],
    metadata: { sessionID: "native-child", hidden: "UNSELECTED_METADATA" } } })
const messages = () => [
  { id: "user", type: "user", text: "Original engineering request", files: [{ data: "UNSELECTED_ATTACHMENT" }],
    metadata: { provenance: "UNSELECTED_ORIGIN_CLAIM" } },
  { id: "correction", type: "user", text: "Correction: only the named subtest" },
  { id: "assistant", type: "assistant", content: [
    { type: "reasoning", text: "HIDDEN_REASONING" }, call("call"),
    { type: "text", text: "UNSELECTED_ASSISTANT_TEXT" },
  ] },
]
function request(kind: "native-call" | "native-message" = "native-call", id = kind === "native-call" ? "call" : "user"): RetrospectiveSourceRequest {
  const descriptor = nativeOriginalDescriptor({ kind, id, session_id: "current", required: true,
    ...(kind === "native-call" ? { message_id: "assistant" } : {}) }, namespace.source_store_id)!
  return { ...descriptor, recipient_session_id: "current", purpose: "preview" }
}

test("current native originals preserve exact fields, tuple, namespace limitations and independent view digest", () => {
  const result = resolveNativeOriginal(request(), messages(), namespace)
  expect(result.status).toBe("available")
  expect(result.source.revision).toMatch(/^sha256:[0-9a-f]{64}$/)
  expect(result.source.sha256).toBe(digest(result.value))
  expect(result.value).toMatchObject({ permitted_view: "native-call-fields-v1", resolution: "partial",
    identity: { session_id: "current", message_id: "assistant", part_id: "call" },
    namespace: { loom_reference_store_id: "paired-loom-store", project_id: "project", workspace_id: null, native_store_identity: "unavailable" },
    fields: { input: { command: "go test -run named-subtest" }, output: [{ type: "text", text: "named-subtest passed" }],
      status: "completed", dispatch: { session_id: "native-child", source_field: "state.metadata.sessionID" } },
    gaps: [{ field: "error", reason: "field-missing" }],
    coverage: { full_history: false, representation: "original-field-projection", complete_selected_fields: false, invocation_provenance: "not-established" } })
  const serialized = JSON.stringify(result)
  for (const absent of ["HIDDEN_REASONING", "UNSELECTED_METADATA", "UNSELECTED_ASSISTANT_TEXT", "Original engineering request", "UNSELECTED_ATTACHMENT", "messages_sha256", "source_sha256"])
    expect(serialized).not.toContain(absent)
})

test("appending unrelated native context does not alter a frozen original version or projection", () => {
  const original = resolveNativeOriginal(request(), messages(), namespace)
  const frozen = { ...request(), source: original.source, purpose: "inspect" as const }
  const appended = [...messages(), { id: "later", type: "user", text: "Unrelated later request" }]
  const reread = resolveNativeOriginal(frozen, appended, namespace)
  expect(reread.status).toBe("available")
  expect(reread.source).toEqual(original.source)
  expect(reread.value).toEqual(original.value)
  const user = resolveNativeOriginal(request("native-message"), messages(), namespace)
  expect(resolveNativeOriginal({ ...request("native-message"), source: user.source }, appended, namespace)).toEqual(user)
})

test("actual changed originals never return replacement bytes under a frozen identity", () => {
  const original = resolveNativeOriginal(request(), messages(), namespace)
  const changed = messages()
  changed[2] = { id: "assistant", type: "assistant", content: [call("call", "NEWER_RESULT_MUST_NOT_BE_RETURNED")] }
  const result = resolveNativeOriginal({ ...request(), source: original.source }, changed, namespace)
  expect(result).toMatchObject({ status: "changed", gap: { code: "native-view-changed" } })
  expect(result).not.toHaveProperty("value")
  expect(JSON.stringify(result)).not.toContain("NEWER_RESULT_MUST_NOT_BE_RETURNED")
  expect(resolveNativeOriginal({ ...request(), source: { ...original.source, sha256: "0".repeat(64) } }, messages(), namespace).status).toBe("changed")
})

test("resolved bytes cannot change through mutable aliases to the supplied native context", () => {
  const originalPart = call("call"), context = [{ id: "assistant", type: "assistant", content: [originalPart] }]
  const result = resolveNativeOriginal(request(), context, namespace)
  originalPart.state.content[0]!.text = "MUTATED_AFTER_RESOLUTION"
  originalPart.state.input.command = "MUTATED_COMMAND"
  expect(result.source.sha256).toBe(digest(result.value))
  expect(JSON.stringify(result.value)).not.toContain("MUTATED_")
})

test("source-owner binding refuses wrong recipient, Session, namespace and view before reading content", () => {
  for (const bad of [
    { ...request(), recipient_session_id: "different-recipient" },
    { ...request(), source: { ...request().source, session_id: "different-source" } },
    { ...request(), source_store_id: "another-store" },
    { ...request(), permitted_view: "raw-full-history" },
  ]) expect(() => resolveNativeOriginal(bad, null, namespace)).toThrow("authorized scope")
})

test("the exact message and part identity cannot substitute an adjacent tool call", () => {
  const samePartDifferentMessage = [...messages(), { id: "other-message", type: "assistant", content: [call("call", "OTHER_MESSAGE_RESULT")] }]
  const source = resolveNativeOriginal(request(), samePartDifferentMessage, namespace)
  expect(JSON.stringify(source)).not.toContain("OTHER_MESSAGE_RESULT")
  for (const patch of [{ id: "absent" }, { message_id: "absent" }]) {
    const result = resolveNativeOriginal({ ...request(), source: { ...request().source, ...patch } }, samePartDifferentMessage, namespace)
    expect(result).toMatchObject({ status: "missing", gap: { code: "native-context-missing" } })
    expect(result).not.toHaveProperty("value")
  }
})

test("ambiguous normalized message or part identities cannot be certified", () => {
  expect(() => resolveNativeOriginal(request(), [...messages(), { id: "assistant", type: "assistant", content: [call("another")] }], namespace)).toThrow("Ambiguous")
  expect(() => resolveNativeOriginal(request(), [{ id: "assistant", type: "assistant", content: [call("call"), call("call")] }], namespace)).toThrow("Ambiguous")
  expect(() => resolveNativeOriginal(request("native-message"), [{ id: "user", type: "user", text: "A" }, { id: "user", type: "user", text: "B" }], namespace)).toThrow("Ambiguous")
})

test("native user text preserves original corrections without exposing attachments or claiming human provenance", () => {
  const original = resolveNativeOriginal(request("native-message"), messages(), namespace)
  expect(original.value).toMatchObject({ permitted_view: "native-user-text-v1", resolution: "resolved",
    identity: { session_id: "current", message_id: "user" }, fields: { text: "Original engineering request" },
    coverage: { selected_fields: ["text"], full_history: false, complete_selected_fields: true,
      human_origin_and_admission_provenance: "not-established" } })
  for (const absent of ["UNSELECTED_ATTACHMENT", "UNSELECTED_ORIGIN_CLAIM", "HIDDEN_REASONING", "UNSELECTED_ASSISTANT_TEXT"])
    expect(JSON.stringify(original)).not.toContain(absent)
  expect(resolveNativeOriginal(request("native-message", "correction"), messages(), namespace).value?.fields).toEqual({ text: "Correction: only the named subtest" })
})

test("native message replacement, compaction loss and unsupported message types stay separate", () => {
  const original = resolveNativeOriginal(request("native-message"), messages(), namespace)
  const replacement = [{ id: "user", type: "user", text: "Replacement" }]
  expect(resolveNativeOriginal({ ...request("native-message"), source: original.source }, replacement, namespace).status).toBe("changed")
  expect(resolveNativeOriginal({ ...request("native-message"), source: original.source }, [], namespace)).toMatchObject({ status: "missing", gap: { code: "native-context-missing" } })
  expect(resolveNativeOriginal(request("native-message", "assistant"), messages(), namespace)).toMatchObject({ status: "unsupported", gap: { code: "unsupported-native-message-type" } })
  expect(resolveNativeOriginal(request("native-message"), [{ id: "user", type: "user" }], namespace)).toMatchObject({ status: "missing", gap: { code: "native-user-text-missing" } })
})

test("redaction-shaped sources remain withheld and are never silently classified as complete originals", () => {
  const redacted = [{ id: "user", type: "user", text: "[redacted:user-text]" }]
  expect(resolveNativeOriginal(request("native-message"), redacted, namespace)).toMatchObject({ status: "unsupported", gap: { code: "redaction-marker-unverified" } })
  const input = [{ id: "assistant", type: "assistant", content: [{ type: "tool", id: "call", name: "skill",
    state: { status: "completed", input: { redacted: "tool-input" }, content: "[redacted:tool-output]" } }] }]
  const result = resolveNativeOriginal(request(), input, namespace)
  expect(result.value).toMatchObject({ resolution: "partial", fields: { status: "completed" },
    coverage: { complete_selected_fields: false } })
  expect((result.value?.gaps as Array<{ reason: string }>).filter(gap => gap.reason === "redaction-marker-unverified")).toHaveLength(2)
  expect(JSON.stringify(result.value?.fields)).not.toContain("redacted")
})

test("tool errors and observed skill contents retain their exact original field values", () => {
  const failure = [{ id: "assistant", type: "assistant", content: [{ type: "tool", id: "call", name: "skill",
    state: { status: "error", input: { name: "reviewer" }, error: "Exact observed loader error", content: [{ type: "text", text: "Observed skill revision content" }] } }] }]
  const result = resolveNativeOriginal(request(), failure, namespace)
  expect(result.value?.fields).toMatchObject({ input: { name: "reviewer" }, error: "Exact observed loader error",
    output: [{ type: "text", text: "Observed skill revision content" }], status: "error" })
  expect(result.value?.coverage).toMatchObject({ effective_instructions_and_configuration: "not-observed-by-this-view" })
})

test("oversized UTF-8 originals and oversized context fail rather than return an excerpt", () => {
  expect(() => resolveNativeOriginal(request("native-message"), [{ id: "user", type: "user", text: "ø".repeat(140000) }], namespace)).toThrow("processing limit")
  expect(() => resolveNativeOriginal(request(), [{ id: "assistant", type: "assistant", content: [call("call", "ø".repeat(140000))] }], namespace)).toThrow("processing limit")
  expect(() => resolveNativeOriginal(request("native-message"), [{ id: "user", type: "user", text: "x".repeat(17 * 1024 * 1024) }], namespace)).toThrow()
})

test("source descriptor does not promote other references or create native message identity", () => {
  expect(nativeOriginalDescriptor({ kind: "external-ref", id: "quoted-sha", required: true }, namespace.source_store_id)).toBeNull()
  expect(() => nativeOriginalDescriptor({ kind: "native-call", id: "call", session_id: "current", required: true }, namespace.source_store_id)).toThrow()
  expect(() => nativeOriginalDescriptor({ kind: "native-message", id: "user", session_id: "current", message_id: "other", required: true }, namespace.source_store_id)).toThrow()
})
