import { expect, test } from "bun:test"
import { nativeEvidenceDigest, nativeEvidenceParts, nativeEvidenceSource } from "../src/native-evidence.js"

const tool = (id: string, input: unknown = { command: "verify scoped-subtest" }, text = "scoped-subtest passed") => ({
  type: "tool", id, name: "shell", state: { status: "completed", input,
    content: [{ type: "text", text }], metadata: { secret: "unrequested metadata", sessionID: "child_one" } },
})
const history = () => [
  { id: "msg_user", type: "user", text: "unrequested user body" },
  { id: "msg_work", type: "assistant", time: { created: 123 }, content: [
    { type: "reasoning", text: "unrequested private reasoning" },
    tool("part_first"),
    { type: "text", text: "unrequested assistant body" },
    tool("part_second", { command: "unrelated" }, "unrelated output"),
  ] },
]
const source = (messages: unknown) => ({
  sessionID: "parent", source: "provided-export" as const, sourceSha256: nativeEvidenceDigest(messages), locationVerified: true,
})

test("native evidence inventory exposes exact identities and availability without original bodies", () => {
  const messages = history(), result = nativeEvidenceParts(messages, source(messages))
  expect(result.items.map(item => [item.message_id, item.part_id])).toEqual([
    ["msg_work", "part_first"], ["msg_work", "part_second"],
  ])
  expect(result).toMatchObject({ source_messages: 2, tool_parts: 2, scanned: 2, next_cursor: null,
    coverage: { full_history: null, authenticity: "provided-export-unverified", location_verified: true } })
  expect(result.items[0]).toMatchObject({ message_created_at: 123, tool: "shell", status: "completed",
    fields: { input: { availability: "available" }, output: { availability: "available" },
      dispatch: { availability: "available" }, error: { availability: "missing" } } })
  const text = JSON.stringify(result)
  for (const hidden of ["unrequested user body", "unrequested private reasoning", "unrequested assistant body",
    "verify scoped-subtest", "scoped-subtest passed", "unrequested metadata", "unrelated output", "child_one"])
    expect(text).not.toContain(hidden)
})

test("part timestamps retain their own time and label message time separately", () => {
  const messages = [{ id: "msg_timing", type: "assistant", time: { created: 100 }, content: [
    { ...tool("first"), time: { created: 120 } },
    { ...tool("second"), time: { created: 140 } },
    { ...tool("invalid"), time: { created: -1 } },
    tool("missing"),
  ] }]
  const result = nativeEvidenceParts(messages, source(messages))
  expect(result.items[0]).toMatchObject({ created_at: 120, message_created_at: 100 })
  expect(result.items[1]).toMatchObject({ created_at: 140, message_created_at: 100 })
  expect(result.items[2]).not.toHaveProperty("created_at")
  expect(result.items[3]).not.toHaveProperty("created_at")
})

test("exact native part read returns only the selected original fields, with separate source pins", () => {
  const messages = history(), options = source(messages)
  const result = nativeEvidenceSource(messages, { ...options, messageID: "msg_work", partID: "part_first", fields: ["output"] })
  expect(result).toMatchObject({ status: "resolved", identity: { session_id: "parent", message_id: "msg_work", part_id: "part_first" },
    source_sha256: options.sourceSha256, fields: { output: [{ type: "text", text: "scoped-subtest passed" }] }, gaps: [] })
  expect(Object.keys(result.fields)).toEqual(["output"])
  for (const hidden of ["verify scoped-subtest", "unrequested private reasoning", "unrequested metadata", "unrelated output"])
    expect(JSON.stringify(result)).not.toContain(hidden)
  const dispatch = nativeEvidenceSource(messages, { ...options, messageID: "msg_work", partID: "part_first", fields: ["dispatch", "status"] })
  expect(dispatch.fields).toEqual({ dispatch: { session_id: "child_one", source_field: "state.metadata.sessionID" }, status: "completed" })
  expect(JSON.stringify(dispatch)).not.toContain("unrequested metadata")
  const context = nativeEvidenceParts(messages, { ...options, source: "native-context" })
  expect(context.coverage).toMatchObject({ full_history: false, authenticity: "native-context" })
})

test("exact source envelope carries references and selected fields without inventory disclosure", () => {
  const part = { ...tool("part_selected"), name: "UNSELECTED_TOOL_NAME", time: { created: 12345 } }
  const messages = [{ id: "msg_selected", type: "assistant", time: { created: 12300 }, content: [part] }]
  const options = source(messages)
  const inventory = nativeEvidenceParts(messages, options)
  const result = nativeEvidenceSource(messages, { ...options, messageID: "msg_selected", partID: "part_selected", fields: ["dispatch"] })
  const encoded = JSON.stringify(result), returned = JSON.parse(encoded)
  expect(Object.keys(returned).sort()).toEqual([
    "coverage", "fields", "format", "gaps", "identity", "messages_sha256", "note", "part", "session_id", "source", "source_sha256", "status",
  ])
  expect(returned.part).toEqual({ part_sha256: inventory.items[0]!.part_sha256 })
  expect(returned.fields).toEqual({ dispatch: { session_id: "child_one", source_field: "state.metadata.sessionID" } })
  expect(returned.status).toBe("resolved")
  for (const hidden of ["completed", "UNSELECTED_TOOL_NAME", "verify scoped-subtest", "scoped-subtest passed", "unrequested metadata",
    '"created_at"', '"message_created_at"', '"normalized_source_bytes"', '"normalized_part_bytes"', '"availability"', '"bytes"'])
    expect(encoded).not.toContain(hidden)
  expect(inventory.items[0]).toMatchObject({ status: "completed", tool: "UNSELECTED_TOOL_NAME", created_at: 12345, message_created_at: 12300 })
  expect(inventory.normalized_source_bytes).toBeGreaterThan(0)
  const selectedStatus = nativeEvidenceSource(messages, { ...options, messageID: "msg_selected", partID: "part_selected", fields: ["status"] })
  expect(selectedStatus.fields).toEqual({ status: "completed" })
  expect("part" in selectedStatus ? selectedStatus.part : undefined).toEqual(returned.part)
  for (const absent of [
    nativeEvidenceSource(messages, { ...options, messageID: "msg_selected", partID: "absent", fields: ["dispatch"] }),
    nativeEvidenceSource(messages, { ...options, messageID: "msg_selected", partID: "part_selected", fields: ["dispatch"], expectedSha256: "0".repeat(64) }),
  ]) {
    expect(absent).not.toHaveProperty("normalized_source_bytes")
    expect(absent).not.toHaveProperty("part")
  }
})

test("matching is bounded, case-sensitive and selects identities without leaking inspected values", () => {
  const messages = history(), options = source(messages)
  const found = nativeEvidenceParts(messages, { ...options, match: "scoped-subtest", matchFields: ["output"], tool: "shell", messageID: "msg_work" })
  expect(found.items.map(item => item.part_id)).toEqual(["part_first"])
  expect(found.matching).toMatchObject({ mode: "case-sensitive-literal", fields: ["output"] })
  expect(JSON.stringify(found)).not.toContain("scoped-subtest")
  expect(nativeEvidenceParts(messages, { ...options, match: "SCOPED-SUBTEST" }).items).toEqual([])
  expect(nativeEvidenceParts(messages, { ...options, match: "verify", matchFields: ["output"] }).items).toEqual([])
  expect(nativeEvidenceParts(messages, { ...options, match: "verify", matchFields: ["input"] }).items).toHaveLength(1)
  expect(nativeEvidenceParts(messages, { ...options, match: "unrequested private reasoning" }).items).toEqual([])
  expect(() => nativeEvidenceParts(messages, { ...options, match: "x".repeat(257) })).toThrow("1-256")
  expect(() => nativeEvidenceParts(messages, { ...options, matchFields: ["input"] })).toThrow("requires match")
  expect(() => nativeEvidenceParts(messages, { ...options, match: "x", matchFields: ["input", "input"] })).toThrow("once")
  expect(() => nativeEvidenceParts(messages, { ...options, match: "x", matchFields: ["reasoning"] as any })).toThrow("match fields must select")
})

test("default matching inspects only structural projections and raw body matching requires explicit fields", () => {
  const messages = history(), options = source(messages)
  for (const match of ["verify scoped-subtest", "scoped-subtest passed", "unrequested metadata", "unrequested private reasoning", "state.metadata.sessionID", "session_id"])
    expect(nativeEvidenceParts(messages, { ...options, match }).items).toEqual([])
  for (const match of ["shell", "completed", "child_one"])
    expect(nativeEvidenceParts(messages, { ...options, match }).items).toHaveLength(2)
  const found = nativeEvidenceParts(messages, { ...options, match: "child_one" })
  expect(found.matching?.fields).toEqual(["dispatch", "status", "tool"])
  expect(JSON.stringify(found)).not.toContain("child_one")
  expect(nativeEvidenceParts(messages, { ...options, match: "shell", matchFields: ["dispatch"] }).items).toEqual([])
  expect(nativeEvidenceParts(messages, { ...options, match: "child_one", matchFields: ["status"] }).items).toEqual([])
  const own = { ...options, source: "native-context" as const }
  expect(nativeEvidenceParts(messages, { ...own, match: "verify scoped-subtest", matchFields: ["input"] }).items.map(item => item.part_id))
    .toEqual(["part_first"])
  expect(nativeEvidenceParts(messages, { ...own, match: "scoped-subtest passed", matchFields: ["output"] }).items.map(item => item.part_id))
    .toEqual(["part_first"])
  expect(nativeEvidenceSource(messages, { ...own, messageID: "msg_work", partID: "part_first", fields: ["input", "output"] }).fields)
    .toEqual({ input: { command: "verify scoped-subtest" }, output: [{ type: "text", text: "scoped-subtest passed" }] })
  const malformed = [{ id: "msg_work", type: "assistant", content: [{ ...tool("part_bad"), state: { status: "body in malformed status" } }] }]
  expect(() => nativeEvidenceParts(malformed, { ...options, match: "body" })).toThrow("Invalid normalized native tool status")
})

test("cursor traversal is complete and rejects append, reorder, source and filter changes", () => {
  const messages = [{ id: "msg_many", type: "assistant", content: Array.from({ length: 137 }, (_, n) => tool("part_" + n)) }]
  const options = source(messages), identities: string[] = []
  let cursor: string | undefined
  let pages = 0
  do {
    const result = nativeEvidenceParts(messages, { ...options, limit: 50, cursor })
    identities.push(...result.items.map(item => item.part_id))
    cursor = result.next_cursor ?? undefined
    pages++
  } while (cursor)
  expect(pages).toBe(3)
  expect(identities).toEqual(Array.from({ length: 137 }, (_, n) => "part_" + n))
  const first = nativeEvidenceParts(messages, { ...options, limit: 1 })
  expect(first.next_cursor).not.toBeNull()
  for (const changed of [
    [{ ...messages[0], content: [...messages[0]!.content, tool("part_new")] }],
    [{ ...messages[0], content: [...messages[0]!.content].reverse() }],
    [{ ...messages[0], content: [tool("part_0", {}, "changed original"), ...messages[0]!.content.slice(1)] }],
  ]) expect(() => nativeEvidenceParts(changed, { ...options, cursor: first.next_cursor! })).toThrow("source or filters changed")
  for (const change of [{ sourceSha256: "a".repeat(64) }, { sessionID: "other" }, { tool: "subagent" }, { match: "verify" }, { source: "native-context" as const }])
    expect(() => nativeEvidenceParts(messages, { ...options, ...change, cursor: first.next_cursor! })).toThrow("source or filters changed")
  expect(() => nativeEvidenceParts(messages, { ...options, cursor: "not-json" })).toThrow("Invalid native evidence cursor")
})

test("original failure, unchanged rerun and correction remain distinct parts without an interpreted diagnosis", () => {
  const messages = [{ id: "msg_verification", type: "assistant", content: [
    tool("part_failure", { run: "run_1", attempt: 1, revision: "old" }, "coarse: FAIL; windows: PASS"),
    tool("part_rerun", { run: "run_1", attempt: 2, revision: "old" }, "coarse: PASS; windows: PASS"),
    tool("part_correction", { run: "run_2", attempt: 1, revision: "corrected" }, "coarse: PASS; windows: PASS"),
    tool("part_race", { job: "race_1", revision: "corrected" }, "suite: PASS"),
  ] }]
  const options = source(messages)
  const parts = nativeEvidenceParts(messages, options)
  expect(parts.items).toHaveLength(4)
  expect(new Set(parts.items.map(item => item.part_sha256)).size).toBe(4)
  const failure = nativeEvidenceSource(messages, { ...options, messageID: "msg_verification", partID: "part_failure", fields: ["input", "output"] })
  expect(failure.fields).toEqual({ input: { run: "run_1", attempt: 1, revision: "old" }, output: [{ type: "text", text: "coarse: FAIL; windows: PASS" }] })
  const unavailable = nativeEvidenceSource(messages, { ...options, messageID: "msg_verification", partID: "missing_original", fields: ["output"] })
  expect(unavailable).toMatchObject({ status: "missing", fields: {}, gaps: [{ field: "output", reason: "source-missing" }] })
  expect(JSON.stringify(parts)).not.toContain("watcher")
})

test("exact part pin tolerates appended context but rejects changed or missing original parts", () => {
  const messages = history(), initial = { ...source(messages), source: "native-context" as const }
  const partSha256 = nativeEvidenceParts(messages, initial).items[0]!.part_sha256
  const appended = [...messages, { id: "msg_later", type: "user", text: "new context unrelated to the original part" }]
  const options = { ...source(appended), source: "native-context" as const,
    messageID: "msg_work", partID: "part_first", fields: ["output"] as const, expectedPartSha256: partSha256 }
  const read = nativeEvidenceSource(appended, { ...options, fields: ["output"] })
  expect(read).toMatchObject({ status: "resolved", fields: { output: [{ type: "text", text: "scoped-subtest passed" }] },
    part: { part_sha256: partSha256 } })
  const strictSnapshot = nativeEvidenceSource(appended, { ...options, fields: ["output"], expectedSha256: initial.sourceSha256 })
  expect(strictSnapshot).toMatchObject({ status: "changed", fields: {}, gaps: [{ field: "output", reason: "source-changed" }] })
  const changed = [{ id: "msg_work", type: "assistant", content: [tool("part_first", {}, "changed original")] }]
  expect(nativeEvidenceSource(changed, { ...options, ...source(changed), fields: ["output"] }))
    .toMatchObject({ status: "changed", fields: {}, gaps: [{ field: "output", reason: "part-changed" }] })
  const absent = [{ id: "msg_work", type: "assistant", content: [tool("part_elsewhere")] }]
  expect(nativeEvidenceSource(absent, { ...options, ...source(absent), fields: ["output"] }))
    .toMatchObject({ status: "missing", fields: {}, gaps: [{ field: "output", reason: "source-missing" }] })
  expect(() => nativeEvidenceSource(appended, { ...options, fields: ["output"], expectedPartSha256: "invalid" }))
    .toThrow("expected part sha256")
})

test("unverified redaction markers and missing fields are explicit gaps, never substituted originals or matches", () => {
  const redacted = { ...tool("part_redacted"), state: { status: "completed", input: { redacted: "tool-input:msg_work" },
    content: [{ type: "text", text: "[redacted:tool-output:msg_work]" }], metadata: { redacted: "tool-metadata:msg_work" } } }
  const messages = [{ id: "msg_work", type: "assistant", content: [redacted, { type: "tool", id: "part_running", name: "shell", state: { status: "running", input: {}, metadata: {} } }] }]
  const options = source(messages)
  const result = nativeEvidenceSource(messages, { ...options, messageID: "msg_work", partID: "part_redacted", fields: ["input", "output", "dispatch", "status"] })
  expect(result).toMatchObject({ status: "partial", fields: { status: "completed" }, gaps: [
    { field: "input", reason: "redaction-marker-unverified" }, { field: "output", reason: "redaction-marker-unverified" }, { field: "dispatch", reason: "redaction-marker-unverified" },
  ] })
  expect(nativeEvidenceParts(messages, { ...options, match: "msg_work" }).items).toEqual([])
  const running = nativeEvidenceSource(messages, { ...options, messageID: "msg_work", partID: "part_running", fields: ["output"] })
  expect(running).toMatchObject({ status: "partial", fields: {}, gaps: [{ field: "output", reason: "field-missing" }] })
  const changed = nativeEvidenceSource(messages, { ...options, messageID: "msg_work", partID: "part_redacted", fields: ["status"], expectedSha256: "b".repeat(64) })
  expect(changed).toMatchObject({ status: "changed", fields: {}, gaps: [{ field: "status", reason: "source-changed" }] })
})

test("literal marker-shaped values remain uncertain in native context and supplied exports", () => {
  const inputs = ["[redacted:literal-input]", { redacted: "literal-input" }, { nested: [{ redacted: "literal-input" }] }]
  for (const kind of ["native-context", "provided-export"] as const) for (const input of inputs) {
    const messages = [{ id: "msg_literal", type: "assistant", content: [{ ...tool("part_literal"), state: {
      status: "completed", input, content: [{ type: "text", text: "[redacted:literal-output]" }],
      error: "[redacted:literal-error]", metadata: { sessionID: "child_one" },
    } }] }]
    const options = { ...source(messages), source: kind }
    const result = nativeEvidenceSource(messages, { ...options, messageID: "msg_literal", partID: "part_literal", fields: ["input", "output", "error"] })
    expect(result).toMatchObject({ status: "partial", fields: {}, gaps: [
      { field: "input", reason: "redaction-marker-unverified" },
      { field: "output", reason: "redaction-marker-unverified" },
      { field: "error", reason: "redaction-marker-unverified" },
    ] })
    const inventory = nativeEvidenceParts(messages, options)
    for (const name of ["input", "output", "error"]) {
      expect(inventory.items[0]!.fields[name]).toEqual({ availability: "redaction-marker-unverified" })
    }
    expect(nativeEvidenceParts(messages, { ...options, match: "literal", matchFields: ["input", "output"] }).items).toEqual([])
    expect(JSON.stringify(result)).not.toContain('"reason":"redacted"')
  }
})

test("duplicate native identities fail instead of choosing a replacement; tuple remains Session/message/part", () => {
  const messages = history(), options = source(messages)
  expect(() => nativeEvidenceParts([...messages, messages[0]], options)).toThrow("Ambiguous native evidence message")
  const duplicate = [{ id: "msg_work", type: "assistant", content: [tool("part_same"), tool("part_same")] }]
  expect(() => nativeEvidenceParts(duplicate, source(duplicate))).toThrow("Ambiguous native evidence part")
  expect(() => nativeEvidenceSource(duplicate, { ...source(duplicate), messageID: "msg_work", partID: "part_same", fields: ["output"] })).toThrow("Ambiguous native evidence part")
  const separate = [{ id: "msg_one", type: "assistant", content: [tool("part_same")] },
    { id: "msg_two", type: "assistant", content: [tool("part_same", {}, "second original")] }]
  const found = nativeEvidenceSource(separate, { ...source(separate), messageID: "msg_two", partID: "part_same", fields: ["output"] })
  expect(found.fields).toEqual({ output: [{ type: "text", text: "second original" }] })
  expect(() => nativeEvidenceSource(messages, { ...options, messageID: "msg_work", partID: "part_first", fields: ["reasoning"] as any })).toThrow("fields must select")
})

test("processing bounds reject oversized originals instead of returning a digest or clipped replacement", () => {
  const messages = [{ id: "msg_large", type: "assistant", content: [tool("part_large", {}, "x".repeat(256 * 1024))] }]
  const options = source(messages)
  expect(nativeEvidenceParts(messages, options).items[0]?.fields.output.bytes).toBeGreaterThan(256 * 1024)
  expect(() => nativeEvidenceSource(messages, { ...options, messageID: "msg_large", partID: "part_large", fields: ["output"] })).toThrow()
  expect(() => nativeEvidenceParts(Array.from({ length: 20001 }, (_, n) => ({ type: "idle", id: "msg_" + n })), options)).toThrow("20000")
  const parts = [{ id: "msg_parts", type: "assistant", content: Array.from({ length: 60001 }, () => ({ type: "text", text: "" })) }]
  expect(() => nativeEvidenceParts(parts, options)).toThrow("60000")
  expect(() => nativeEvidenceDigest([{ id: "msg_too_large", type: "user", text: "x".repeat(16 * 1024 * 1024) }])).toThrow()
  expect(() => nativeEvidenceParts(history(), { ...options, limit: 51 })).toThrow("1-50")
  expect(() => nativeEvidenceParts(history(), { ...options, sourceSha256: "not-a-digest" })).toThrow("source sha256")
})
