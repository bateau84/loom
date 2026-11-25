import { expect, spyOn, test } from "bun:test"
import { writeFile } from "node:fs/promises"
import { join } from "node:path"
import { Store } from "../src/store.js"
import { registeredLoom } from "./helpers/registered-loom.js"

type Registered = Awaited<ReturnType<typeof registeredLoom>>
const participants = ["participant_0", "participant_1", "participant_2", "participant_3"]
const sourceSession = "historical_parent"
const sourceMessage = "message_dispatches"
const outputText = "Original controlled coarse: FAIL; windows: PASS; watcher cause unproven"
const toolPart = (id: string, child = "child_target", text = outputText) => ({
  type: "tool", id, name: "subagent", state: { status: "completed",
    input: { prompt: "PRIVATE_DISPATCH_PROMPT", quoted_revision: "shared-revision" },
    content: [{ type: "text", text }], metadata: { sessionID: child, private: "PRIVATE_NATIVE_METADATA" } },
})
const message = (parts: unknown[]) => ({ id: sourceMessage, type: "assistant", time: { created: 7 }, content: parts })
function session(f: Registered, id: string, parentID?: string) {
  const value = { id, agent: "author", projectID: "tool-help", location: { directory: f.directory },
    ...(parentID ? { parentID } : {}), time: { created: 1, updated: 2 }, title: "PRIVATE_SESSION_TITLE" }
  f.sessions.set(id, value)
  return value
}
async function exported(f: Registered, messages: unknown[], id = sourceSession, path = "approved-history.json") {
  session(f, id)
  await writeFile(join(f.directory, path), JSON.stringify({ info: { id, projectID: "tool-help", location: { directory: f.directory } }, messages }))
  return path
}
function execute(f: Registered, name: string, input: unknown, signal: AbortSignal, sessionID = "s") {
  return f.tools.get(name).execute(input, { sessionID, agent: "author", messageID: "message", id: "tool-call", signal })
}
function pages(f: Registered, parent: string, children: Array<Record<string, unknown>>, size = 50) {
  f.nativePages.clear()
  for (let offset = 0; offset < children.length || offset === 0; offset += size) {
    f.nativePages.set(offset === 0 ? "" : `${parent}:${offset}`, { data: children.slice(offset, offset + size),
      cursor: { next: offset + size < children.length ? `${parent}:${offset + size}` : null } })
  }
}

async function trajectory(large = false) {
  const f = await registeredLoom()
  try {
    session(f, "s"); session(f, sourceSession)
    const ids = [...participants, ...Array.from({ length: large ? 257 : 1 }, (_, n) => "unrelated_" + n)]
    const children = ids.map(id => session(f, id, sourceSession))
    const action = (await f.invoke("action", { operation: "create", title: "Restore freshness", goal: "Investigate and correct one test" }, sourceSession)).result
    for (let revision = 0; revision < 6; revision++) await f.invoke("plan", { operation: "save", action_id: action.id, expected_revision: revision,
      nodes: [{ id: "restore", kind: "task", title: "Restore-freshness correction " + revision }] }, sourceSession)
    const descriptions = [
      { session: participants[0]!, kind: "concern", statement: "Original coarse failure; windows passed. The indexed row and watcher timing are not established." },
      { session: participants[0]!, kind: "result", statement: "The unchanged-code rerun passed both subtests. The first attempt remains a failure." },
      { session: participants[1]!, kind: "result", statement: "The correction distinguishes the old indexed row from a controlled replacement." },
      { session: participants[2]!, kind: "assessment", statement: "Both named subtests passed on the corrected head; this is the scoped verification." },
      { session: participants[3]!, kind: "qa", statement: "The merged tree matches the correction. Race success is suite-level; watcher-first remains unproven." },
    ]
    const records: any[] = []
    for (const [n, item] of descriptions.entries()) records.push((await f.invoke("record", { operation: "add", action_id: action.id,
      kind: item.kind, statement: item.statement, evidence_ids: [], artifact_refs: [`https://example.test/controlled-artifact-${n}`],
      ...(["assessment", "qa"].includes(item.kind) ? { verdict: "pass" } : {}) }, item.session)).result)
    for (const id of ids.slice(4)) for (let n = 0; n < (large ? 3 : 1); n++) await f.invoke("record", { operation: "add", action_id: action.id,
      kind: "result", statement: "Separate engineering work at shared-revision; no evidence of participation in the selected correction. " + n }, id)
    const elsewhere = (await f.invoke("action", { operation: "create", title: "Other Action", goal: "Unrelated work" })).result
    const otherRecord = (await f.invoke("record", { operation: "add", action_id: elsewhere.id,
      kind: "result", statement: "Same author, unrelated Action" }, participants[0]!)).result
    const native = [message(ids.map((id, n) => toolPart("dispatch_" + n, id))),
      ...Array.from({ length: large ? 3363 : 1 }, (_, n) => ({ id: "message_history_" + n, type: "user", text: "PRIVATE_HISTORICAL_MESSAGE" }))]
    const exportPath = await exported(f, native)
    pages(f, sourceSession, children)
    f.permissionRequests.length = 0; f.sessionReads.length = 0; f.nativeListRequests.length = 0
    return { f, action, children, records, otherRecord, native, exportPath, ids }
  } catch (error) { await f.close(); throw error }
}

test("registered historical investigation resolves four native dispatch references and five authored records without focus or assignment", async () => {
  const { f, action, records, otherRecord, exportPath } = await trajectory()
  try {
    const inventory = (await f.invoke("trace", { operation: "parts", session_id: sourceSession, export_path: exportPath,
      match: "participant_", match_fields: ["dispatch"] })).result
    expect(inventory.items).toHaveLength(4)
    expect(inventory.namespace).toMatchObject({ project_id: "tool-help", native_store_identity: "unavailable" })
    const resolved: string[] = []
    for (const item of inventory.items) {
      const original = (await f.invoke("trace", { operation: "source", session_id: sourceSession, export_path: exportPath,
        message_id: item.message_id, part_id: item.part_id, part_sha256: item.part_sha256,
        source_sha256: inventory.source_sha256, fields: ["dispatch", "status"] })).result
      expect(original.fields.status).toBe("completed")
      expect(original.fields.dispatch.source_field).toBe("state.metadata.sessionID")
      resolved.push(original.fields.dispatch.session_id)
      for (const hidden of ["PRIVATE_DISPATCH_PROMPT", "PRIVATE_NATIVE_METADATA", outputText]) expect(JSON.stringify(original)).not.toContain(hidden)
    }
    expect(resolved).toEqual(participants)
    const selected: any[] = []
    for (const id of resolved) {
      const projection = (await f.invoke("record", { operation: "query", action_id: action.id, source_session_id: id,
        projection: "metadata", record_kinds: ["concern", "result", "assessment", "qa"] })).result
      expect(typeof projection.source_store_id).toBe("string")
      selected.push(...projection.items)
    }
    expect(selected.map(item => item.id)).toEqual(records.map(item => item.id))
    expect(selected.every(item => !("data" in item) && item.evidence_count === 0)).toBe(true)
    expect(selected.some(item => item.id === otherRecord.id)).toBe(false)
    for (const original of records) {
      expect(JSON.stringify(selected)).not.toContain(original.data.statement)
      const approved = (await f.invoke("record", { operation: "query", action_id: action.id, source_session_id: original.session_id,
        record_id: original.id, projection: "fields", fields: ["statement", "verdict"] })).result
      expect(approved.items[0].data.statement).toBe(original.data.statement)
      expect(Object.keys(approved.items[0].data).every(field => ["statement", "verdict"].includes(field))).toBe(true)
      const legacy = (await f.invoke("record", { operation: "query", action_id: action.id, record_id: original.id })).result
      expect(legacy.items[0]).toMatchObject(original)
      expect(legacy).not.toHaveProperty("projection")
    }
    for (const id of participants.slice(0, 2)) expect((await f.invoke("context", { mode: "independent" }, id)).result.selected).toBeNull()
    const revisionMatch = (await f.invoke("trace", { operation: "parts", session_id: sourceSession, export_path: exportPath, match: "shared-revision" })).result
    expect(revisionMatch.items).toEqual([])
    expect(f.nativeInputs).toEqual([]); expect(f.sessionCreates).toEqual([]); expect(f.sessionPrompts).toEqual([])
  } finally { await f.close() }
})

test("registered discovery denial precedes source lookup, native enumeration and ledger retrieval", async () => {
  const f = await registeredLoom(), reads = spyOn(Store.prototype, "records")
  try {
    f.sessions.set("protected", new Error("PRIVATE_SOURCE_LOOKUP"))
    f.permission.beforeReturn = async () => { throw new Error("fixture discovery denied") }
    for (const [name, input] of [
      ["record", { operation: "query", projection: "metadata", source_session_id: "protected" }],
      ["trace", { operation: "children", access: "historical", session_id: "protected" }],
      ["trace", { operation: "parts", session_id: "protected", export_path: "not-opened.json" }],
    ] as const) await expect(f.invoke(name, input)).rejects.toThrow("fixture discovery denied")
    expect(f.sessionReads).not.toContain("protected")
    expect(f.nativeListRequests).toEqual([])
    expect(reads).not.toHaveBeenCalled()
    expect(f.permissionRequests.every(request => request.action === "read" && request.resources.length === 1
      && request.resources[0] === "loom:evidence:discover:session:protected")).toBe(true)
  } finally { reads.mockRestore(); await f.close() }
})

test("registered source-unavailable errors do not disclose native lookup failures after allowed discovery", async () => {
  const f = await registeredLoom()
  try {
    f.sessions.set("protected", new Error("PRIVATE_EXISTENCE_AND_STORAGE_DETAILS"))
    await expect(f.invoke("trace", { operation: "children", access: "historical", session_id: "protected" }))
      .rejects.toThrow("Evidence source unavailable in the authorized scope")
    expect(f.nativeListRequests).toEqual([])
  } finally { await f.close() }
})

test("registered exact record projection finishes with one complete discovery, inspection and recipient disclosure union", async () => {
  const f = await registeredLoom()
  try {
    const record = (await f.invoke("record", { operation: "add", session_only: true, kind: "result", statement: "Original" })).result
    await f.invoke("record", { operation: "query", source_session_id: "s", record_id: record.id, projection: "fields", fields: ["statement", "verdict"] })
    const scope = `session:s:record:${record.id}`, final = f.permissionRequests.at(-1)
    expect(new Set(final.resources)).toEqual(new Set([
      `loom:evidence:discover:${scope}`,
      `loom:evidence:inspect:${scope}:view:record-statement`, `loom:evidence:inspect:${scope}:view:record-verdict`,
      `loom:evidence:disclose:${scope}:view:record-statement:recipient:s`, `loom:evidence:disclose:${scope}:view:record-verdict:recipient:s`,
    ]))
    expect(final).toMatchObject({ action: "read", sessionID: "s", agent: "author", source: { type: "tool", messageID: "message", id: "tool-call" },
      metadata: { purpose: "historical-engineering-evidence", recipient_session_id: "s" } })
    expect(final).not.toHaveProperty("save")
    expect(f.permissionRequests[0].resources).toEqual([`loom:evidence:discover:${scope}`])
  } finally { await f.close() }
})

test("disclosure denial precedes native source inspection and export source release rechecks the file resource with the exact tuple", async () => {
  const f = await registeredLoom(), contextReads = spyOn(f.nativeContexts, "get")
  try {
    f.nativeContexts.set("s", { data: [message([toolPart("part_one")])] })
    f.permission.beforeReturn = async () => {
      if (f.permissionRequests.at(-1).resources.some((resource: string) => resource.includes(":disclose:"))) throw new Error("fixture disclosure denied")
    }
    await expect(f.invoke("trace", { operation: "parts" })).rejects.toThrow("fixture disclosure denied")
    expect(contextReads).not.toHaveBeenCalled()
    f.permission.beforeReturn = undefined; f.permissionRequests.length = 0
    const path = await exported(f, [message([toolPart("part_one")])])
    const result = (await f.invoke("trace", { operation: "source", session_id: sourceSession, export_path: path,
      message_id: sourceMessage, part_id: "part_one", fields: ["dispatch", "status"] })).result
    expect(result.fields.dispatch.session_id).toBe("child_target")
    const scope = `session:${sourceSession}:message:${sourceMessage}:part:part_one`
    expect(new Set(f.permissionRequests.at(-1).resources)).toEqual(new Set([
      `loom:evidence:discover:${scope}`, join(f.directory, path),
      `loom:evidence:inspect:${scope}:view:native-dispatch`, `loom:evidence:inspect:${scope}:view:native-status`,
      `loom:evidence:disclose:${scope}:view:native-dispatch:recipient:s`, `loom:evidence:disclose:${scope}:view:native-status:recipient:s`,
    ]))
  } finally { contextReads.mockRestore(); await f.close() }
})

test("a saved historical continuation cannot bypass later discovery revocation", async () => {
  const f = await registeredLoom()
  try {
    session(f, sourceSession)
    pages(f, sourceSession, [session(f, "child_one", sourceSession), session(f, "child_two", sourceSession)], 1)
    const first = (await f.invoke("trace", { operation: "children", access: "historical", session_id: sourceSession, limit: 1 })).result
    const before = f.nativeListRequests.length
    f.permission.beforeReturn = async () => { throw new Error("fixture source permission withdrawn") }
    await expect(f.invoke("trace", { operation: "children", access: "historical", session_id: sourceSession, limit: 1,
      cursor: first.next_cursor })).rejects.toThrow("fixture source permission withdrawn")
    expect(f.nativeListRequests).toHaveLength(before)
  } finally { await f.close() }
})

test("revocation before the final ledger release rejects the whole selected response", async () => {
  const f = await registeredLoom()
  try {
    const record = (await f.invoke("record", { operation: "add", session_only: true, kind: "result", statement: "MUST_NOT_BE_RETURNED" })).result
    f.permission.beforeReturn = async () => {
      if (f.permissionRequests.length === 3) throw new Error("fixture permission revoked")
    }
    await expect(f.invoke("record", { operation: "query", source_session_id: "s", record_id: record.id,
      projection: "fields", fields: ["statement", "artifact_refs"] })).rejects.toThrow("fixture permission revoked")
    expect(f.permissionRequests).toHaveLength(3)
    expect(f.nativeInputs).toEqual([])
  } finally { await f.close() }
})

test("revocation during awaited native multi-part retrieval prevents a later response and retains the complete permission union", async () => {
  const f = await registeredLoom()
  const originalGet = f.nativeContexts.get.bind(f.nativeContexts)
  let entered!: () => void, resolveContext!: (value: unknown) => void
  const started = new Promise<void>(resolve => { entered = resolve })
  f.nativeContexts.set("s", new Promise(resolve => { resolveContext = resolve }))
  const get = spyOn(f.nativeContexts, "get").mockImplementation(key => { entered(); return originalGet(key) })
  try {
    let revoked = false
    f.permission.beforeReturn = async () => { if (revoked) throw new Error("fixture permission revoked during source read") }
    const pending = f.invoke("trace", { operation: "parts", limit: 2 })
    await started
    revoked = true
    resolveContext({ data: [message([toolPart("part_one"), toolPart("part_two")])] })
    await expect(pending).rejects.toThrow("fixture permission revoked during source read")
    expect(f.permissionRequests.at(-1).resources).toEqual([
      "loom:evidence:discover:session:s", "loom:evidence:disclose:session:s:view:native-parts:recipient:s",
    ])
  } finally { get.mockRestore(); await f.close() }
})

test("cancellation during the final permission await cannot return an already assembled evidence page", async () => {
  const f = await registeredLoom(), controller = new AbortController()
  try {
    f.nativeContexts.set("s", { data: [message([toolPart("part_one")])] })
    f.permission.beforeReturn = async () => { if (f.permissionRequests.length === 3) controller.abort(new Error("fixture cancelled")) }
    await expect(execute(f, "trace", { operation: "parts" }, controller.signal)).rejects.toThrow("fixture cancelled")
    expect(f.permissionRequests).toHaveLength(3)
  } finally { await f.close() }
})

test("historical child discovery rejects mixed-location rows and foreign-scope cursors without scan counts", async () => {
  const f = await registeredLoom()
  try {
    session(f, sourceSession); session(f, "other_parent")
    const first = session(f, "first", sourceSession), second = session(f, "second", sourceSession)
    pages(f, sourceSession, [first, second], 1)
    const found = (await f.invoke("trace", { operation: "children", access: "historical", session_id: sourceSession, limit: 1 })).result
    expect(found.sessions[0]).toMatchObject({ id: "first", parent_id: sourceSession, relationship: "native-parentage", objective_participation: "not-established" })
    expect(found).not.toHaveProperty("scanned")
    expect(JSON.stringify(found)).not.toContain("PRIVATE_SESSION_TITLE")
    const before = f.nativeListRequests.length
    await expect(f.invoke("trace", { operation: "children", access: "historical", session_id: "other_parent", limit: 1, cursor: found.next_cursor }))
      .rejects.toThrow("cursor does not match")
    expect(f.nativeListRequests).toHaveLength(before)
    await expect(f.invoke("trace", { operation: "children", access: "historical", session_id: sourceSession, limit: 1, cursor: found.next_cursor }, "other_reader"))
      .rejects.toThrow("cursor does not match")
    for (const foreign of [{ ...second, projectID: "foreign" }, { ...second, parentID: "other_parent" },
      { ...second, location: { directory: f.directory, workspaceID: "foreign" } }]) {
      pages(f, sourceSession, [first, foreign], 50)
      await expect(f.invoke("trace", { operation: "children", access: "historical", session_id: sourceSession, limit: 50 }))
        .rejects.toThrow("inventory unavailable in the authorized scope")
    }
  } finally { await f.close() }
})

test("own native output resolves the exact tuple and part pin, preserving source identity and later-change gaps", async () => {
  const f = await registeredLoom()
  try {
    const native = [message([toolPart("part_exact"), toolPart("part_adjacent", "another_child", "OTHER_OUTPUT")])]
    f.nativeContexts.set("s", { data: native })
    const inventory = (await f.invoke("trace", { operation: "parts" })).result
    const pin = inventory.items[0].part_sha256
    const query = { operation: "source", message_id: sourceMessage, part_id: "part_exact", part_sha256: pin, fields: ["output"] }
    const original = (await f.invoke("trace", query)).result
    expect(original).toMatchObject({ status: "resolved", identity: { session_id: "s", message_id: sourceMessage, part_id: "part_exact" },
      fields: { output: [{ type: "text", text: outputText }] }, coverage: { full_history: false, authenticity: "native-context" } })
    expect(original).not.toHaveProperty("result_id")
    for (const hidden of ["PRIVATE_DISPATCH_PROMPT", "PRIVATE_NATIVE_METADATA", "OTHER_OUTPUT"]) expect(JSON.stringify(original)).not.toContain(hidden)
    const scope = `session:s:message:${sourceMessage}:part:part_exact`
    expect(new Set(f.permissionRequests.at(-1).resources)).toEqual(new Set([
      `loom:evidence:discover:${scope}`, `loom:evidence:inspect:${scope}:view:native-output`,
      `loom:evidence:disclose:${scope}:view:native-output:recipient:s`,
    ]))
    f.nativeContexts.set("s", { data: [...native, { id: "later", type: "user", text: "later context" }] })
    expect((await f.invoke("trace", query)).result.status).toBe("resolved")
    expect((await f.invoke("trace", { ...query, source_sha256: inventory.source_sha256 })).result)
      .toMatchObject({ status: "changed", fields: {}, gaps: [{ field: "output", reason: "source-changed" }] })
    f.nativeContexts.set("s", { data: [message([toolPart("part_exact", "child_target", "CHANGED_OUTPUT")])] })
    expect((await f.invoke("trace", query)).result).toMatchObject({ status: "changed", fields: {}, gaps: [{ field: "output", reason: "part-changed" }] })
    expect((await f.invoke("trace", { ...query, part_id: "missing" })).result).toMatchObject({ status: "missing", fields: {} })
  } finally { await f.close() }
})

test("exact native-source grants cannot alias delimiter-shaped message and part identifiers", async () => {
  const f = await registeredLoom(), contextReads = spyOn(f.nativeContexts, "get")
  try {
    const allowed = { message_id: "msg_a", part_id: "part_b:part:part_c" }
    const other = { message_id: "msg_a:part:part_b", part_id: "part_c" }
    const ordinary = { message_id: "msg_normal", part_id: "part_normal" }
    f.nativeContexts.set("s", { data: [
      { ...message([toolPart(allowed.part_id, "child_allowed", "ALLOWED_EXACT_OUTPUT")]), id: allowed.message_id },
      { ...message([toolPart(other.part_id, "child_other", "OTHER_EXACT_OUTPUT")]), id: other.message_id },
      { ...message([toolPart(ordinary.part_id, "child_normal", "ORDINARY_OUTPUT")]), id: ordinary.message_id },
    ] })
    const query = { operation: "source", ...allowed, fields: ["output"] }
    await f.invoke("trace", query)
    const grants = new Set<string>(f.permissionRequests.at(-1).resources)
    f.permission.beforeReturn = async () => {
      if (f.permissionRequests.at(-1).resources.some((resource: string) => !grants.has(resource)))
        throw new Error("fixture exact source grant denied")
    }
    expect((await f.invoke("trace", query)).result.fields.output).toEqual([{ type: "text", text: "ALLOWED_EXACT_OUTPUT" }])
    contextReads.mockClear()
    await expect(f.invoke("trace", { ...query, ...other })).rejects.toThrow("fixture exact source grant denied")
    expect(contextReads).not.toHaveBeenCalled()
    const scope = "session:s:message:msg_a:part:part_b%3Apart%3Apart_c"
    expect(grants).toEqual(new Set([
      `loom:evidence:discover:${scope}`, `loom:evidence:inspect:${scope}:view:native-output`,
      `loom:evidence:disclose:${scope}:view:native-output:recipient:s`,
    ]))
    f.permission.beforeReturn = undefined
    await f.invoke("trace", { ...query, ...ordinary })
    const ordinaryGrants = new Set<string>(f.permissionRequests.at(-1).resources)
    f.permission.beforeReturn = async () => {
      if (f.permissionRequests.at(-1).resources.some((resource: string) => !ordinaryGrants.has(resource)))
        throw new Error("fixture ordinary source grant denied")
    }
    expect((await f.invoke("trace", { ...query, ...ordinary })).result.fields.output)
      .toEqual([{ type: "text", text: "ORDINARY_OUTPUT" }])
  } finally { contextReads.mockRestore(); await f.close() }
})

test("source Session inventory grants cannot alias exact-record grants across a delimiter boundary", async () => {
  const f = await registeredLoom()
  try {
    const other = (await f.invoke("record", { operation: "add", session_only: true, kind: "result", statement: "OTHER_RECORD" })).result
    const selectedSession = `s:record:${other.id}`
    const allowed = (await f.invoke("record", { operation: "add", session_only: true, kind: "result", statement: "ALLOWED_RECORD" }, selectedSession)).result
    const query = { operation: "query", source_session_id: selectedSession, projection: "metadata" }
    await f.invoke("record", query)
    const grants = new Set<string>(f.permissionRequests.at(-1).resources)
    f.permission.beforeReturn = async () => {
      if (f.permissionRequests.at(-1).resources.some((resource: string) => !grants.has(resource)))
        throw new Error("fixture exact Session grant denied")
    }
    expect((await f.invoke("record", query)).result.items.map((item: any) => item.id)).toEqual([allowed.id])
    await expect(f.invoke("record", { ...query, source_session_id: "s", record_id: other.id }))
      .rejects.toThrow("fixture exact Session grant denied")
    const scope = `session:s%3Arecord%3A${other.id}`
    expect(grants).toEqual(new Set([
      `loom:evidence:discover:${scope}`, `loom:evidence:disclose:${scope}:view:record-metadata:recipient:s`,
    ]))
  } finally { await f.close() }
})

test("cross-Session and export raw fields or raw matching remain unsupported even under native allow", async () => {
  const f = await registeredLoom()
  try {
    session(f, sourceSession)
    for (const scope of [{ session_id: sourceSession }, { session_id: sourceSession, export_path: "not-opened.json" }, { export_path: "not-opened.json" }]) {
      for (const field of ["input", "output", "error"]) await expect(f.invoke("trace", { operation: "source", ...scope,
        message_id: sourceMessage, part_id: "part", fields: ["status", field] })).rejects.toThrow("unsupported-source-release")
      for (const field of ["input", "output"]) await expect(f.invoke("trace", { operation: "parts", ...scope,
        match: "PRIVATE", match_fields: [field] })).rejects.toThrow("unsupported-source-release")
    }
    expect(f.nativeInputs).toEqual([])
  } finally { await f.close() }
})

test("registered literal matching defaults to structural fields; explicit own-context matching never returns the searched body", async () => {
  const f = await registeredLoom()
  try {
    f.nativeContexts.set("s", { data: [message([toolPart("part_one", "child_target"), toolPart("part_two", "other_child", "OTHER_OUTPUT")])] })
    for (const match of ["PRIVATE_DISPATCH_PROMPT", "PRIVATE_NATIVE_METADATA", outputText, "state.metadata.sessionID"]) {
      expect((await f.invoke("trace", { operation: "parts", match })).result.items).toEqual([])
    }
    const structural = (await f.invoke("trace", { operation: "parts", match: "child_target" })).result
    expect(structural.items.map((item: any) => item.part_id)).toEqual(["part_one"])
    expect(structural.matching.fields).toEqual(["dispatch", "status", "tool"])
    expect(JSON.stringify(structural)).not.toContain("child_target")
    const exact = (await f.invoke("trace", { operation: "parts", match: outputText, match_fields: ["output"] })).result
    expect(exact.items.map((item: any) => item.part_id)).toEqual(["part_one"])
    expect(JSON.stringify(exact)).not.toContain(outputText)
    expect(f.permissionRequests.at(-1).resources).toContain("loom:evidence:inspect:session:s:view:native-output")
  } finally { await f.close() }
})

test("registered cursor reuse refuses changed native and exported sources; source reads preserve missing and redacted fields", async () => {
  const f = await registeredLoom()
  try {
    const initial = [message([toolPart("part_one"), toolPart("part_two")])]
    f.nativeContexts.set("s", { data: initial })
    const first = (await f.invoke("trace", { operation: "parts", limit: 1 })).result
    f.nativeContexts.set("s", { data: [...initial, { id: "new_message", type: "user", text: "changed" }] })
    await expect(f.invoke("trace", { operation: "parts", limit: 1, cursor: first.next_cursor })).rejects.toThrow("source or filters changed")
    const path = await exported(f, initial)
    const exportedFirst = (await f.invoke("trace", { operation: "parts", session_id: sourceSession, export_path: path, limit: 1 })).result
    await exported(f, [message([toolPart("part_one", "changed_child"), toolPart("part_two")])], sourceSession, path)
    await expect(f.invoke("trace", { operation: "parts", session_id: sourceSession, export_path: path, limit: 1,
      cursor: exportedFirst.next_cursor })).rejects.toThrow("source or filters changed")
    f.nativeContexts.set("s", { data: [message([
      { type: "tool", id: "redacted", name: "shell", state: { status: "completed", content: [{ type: "text", text: "[redacted:tool-output:msg]" }], metadata: { redacted: "tool-metadata:msg" } } },
      { type: "tool", id: "running", name: "shell", state: { status: "running", input: {} } },
    ])] })
    expect((await f.invoke("trace", { operation: "source", message_id: sourceMessage, part_id: "redacted", fields: ["output", "dispatch", "status"] })).result)
      .toMatchObject({ status: "partial", fields: { status: "completed" }, gaps: [{ field: "output", reason: "redacted" }, { field: "dispatch", reason: "redacted" }] })
    expect((await f.invoke("trace", { operation: "source", message_id: sourceMessage, part_id: "running", fields: ["output"] })).result)
      .toMatchObject({ status: "partial", fields: {}, gaps: [{ field: "output", reason: "field-missing" }] })
  } finally { await f.close() }
})

test("registered large-tree traversal and equivalent selected-record coverage produce reproducible usability measurements", async () => {
  const { f, action, children, records, exportPath } = await trajectory(true)
  try {
    type Measure = { tool_calls: number; response_bytes: number; response_characters: number; elapsed_ms: number;
      repeated_envelope_bytes: number; redundant_requests: number; returned_records: number; exposed_implementation_details: number }
    const metric = (): Measure => ({ tool_calls: 0, response_bytes: 0, response_characters: 0, elapsed_ms: 0,
      repeated_envelope_bytes: 0, redundant_requests: 0, returned_records: 0, exposed_implementation_details: 0 })
    const seen = new WeakMap<Measure, Set<string>>()
    async function measured(m: Measure, name: string, input: Record<string, unknown>) {
      const key = JSON.stringify([name, input]), previous = seen.get(m) ?? new Set<string>()
      if (previous.has(key)) m.redundant_requests++
      previous.add(key); seen.set(m, previous)
      const started = performance.now(), response = await f.invoke(name, input), text = JSON.stringify(response)
      m.tool_calls++; m.elapsed_ms += performance.now() - started
      m.response_bytes += Buffer.byteLength(text); m.response_characters += text.length
      if (text.includes(f.directory) || /ledger\.sqlite|SELECT .* FROM|learning\.sqlite/.test(text)) m.exposed_implementation_details++
      const { items: _items, sessions: _sessions, ...envelope } = response.result
      m.repeated_envelope_bytes += Buffer.byteLength(JSON.stringify(envelope))
      m.returned_records += response.result.items?.length ?? response.result.sessions?.length ?? 0
      return response.result
    }
    const structure = metric(), allChildren: string[] = []
    let cursor: string | undefined
    do {
      const page = await measured(structure, "trace", { operation: "children", access: "historical", session_id: sourceSession,
        limit: 50, ...(cursor ? { cursor } : {}) })
      expect(page).not.toHaveProperty("scanned")
      allChildren.push(...page.sessions.map((item: any) => item.id)); cursor = page.next_cursor ?? undefined
    } while (cursor)
    expect(allChildren).toEqual(children.map(child => child.id))
    expect(new Set(allChildren).size).toBe(261)
    const grandchildren = Array.from({ length: 3 }, (_, n) => session(f, "grandchild_" + n, participants[0]!))
    pages(f, participants[0]!, grandchildren)
    const grand = await measured(structure, "trace", { operation: "children", access: "historical", session_id: participants[0], limit: 50 })
    expect(grand.sessions.map((item: any) => item.id)).toEqual(grandchildren.map(child => child.id))
    const nativeSelection = metric(), selectedDispatches = metric()
    const nativePage = await measured(nativeSelection, "trace", { operation: "parts", session_id: sourceSession,
      export_path: exportPath, match: "participant_", match_fields: ["dispatch"], limit: 50 })
    expect(nativePage.source_messages).toBe(3364)
    expect(nativePage.tool_parts).toBe(261)
    expect(nativePage.items).toHaveLength(4)
    const selectedSessions: string[] = []
    for (const item of nativePage.items) {
      const source = await measured(selectedDispatches, "trace", { operation: "source", session_id: sourceSession, export_path: exportPath,
        message_id: item.message_id, part_id: item.part_id, part_sha256: item.part_sha256,
        source_sha256: nativePage.source_sha256, fields: ["dispatch"] })
      selectedSessions.push(source.fields.dispatch.session_id)
    }
    expect(selectedSessions).toEqual(participants)
    const legacyInventory = metric(), selectedMetadata = metric(), wantedSessions = new Set(selectedSessions)
    const legacySelected: string[] = []
    let after: number | undefined
    do {
      const page = await measured(legacyInventory, "record", { operation: "query", action_id: action.id, limit: 50, ...(after ? { after } : {}) })
      legacySelected.push(...page.items.filter((item: any) => wantedSessions.has(item.session_id)).map((item: any) => item.id))
      after = page.next_after ?? undefined
    } while (after !== undefined)
    const projected: string[] = []
    for (const id of selectedSessions) {
      const page = await measured(selectedMetadata, "record", { operation: "query", action_id: action.id, source_session_id: id,
        projection: "metadata", record_kinds: ["concern", "result", "assessment", "qa"], limit: 50 })
      projected.push(...page.items.map((item: any) => item.id))
      expect(page.next_after).toBeNull()
    }
    expect(legacySelected).toEqual(records.map(record => record.id))
    expect(projected).toEqual(legacySelected)
    const exactLegacy = metric(), exactFields = metric()
    for (const record of records) {
      const old = await measured(exactLegacy, "record", { operation: "query", action_id: action.id, record_id: record.id })
      const selected = await measured(exactFields, "record", { operation: "query", action_id: action.id, record_id: record.id,
        projection: "fields", fields: ["statement", "artifact_refs"] })
      expect(selected.items[0].data).toEqual({ statement: old.items[0].data.statement, artifact_refs: old.items[0].data.artifact_refs })
    }
    const results = { format: "loom-historical-evidence-usability/v1", measured_at: new Date().toISOString(),
      boundary: "Actual registered plugin and Store; simulated native API and permission host, not installed OpenCode or model inference",
      fixture: { direct_children: 261, grandchildren: 3, normalized_parent_messages: 3364,
        selected_sessions: 4, selected_records: 5, action_records: 776, plan_revisions: 6 },
      measures: { structure, native_part_selection: nativeSelection, exact_dispatch_references: selectedDispatches,
        legacy_whole_action_then_filter: legacyInventory, selected_metadata: selectedMetadata,
        existing_exact_id: exactLegacy, selected_exact_fields: exactFields },
      limits: ["Single controlled run; elapsed time is environment-dependent, not a latency target or production benchmark",
        "Both inventory paths start with the same four approved Session IDs, not known record IDs; each discovers the same five record identities/metadata. Legacy retrieval includes unrelated records and statement excerpts",
        "Exact lookup comparison obtains the same requested statement/artifact fields; baseline already supports exact record IDs",
        "Counts exclude fixture construction, permission RPCs and caller-authored selection reasoning; no SQL investigation baseline or token savings claimed",
        "repeated_envelope_bytes is measured non-item response material across calls, not tokenizer or model-context accounting"] }
    for (const m of Object.values(results.measures)) {
      expect(m.redundant_requests).toBe(0)
      expect(m.exposed_implementation_details).toBe(0)
    }
    const path = process.env.LOOM_EVIDENCE_MEASUREMENTS_PATH
    if (path) await writeFile(path, JSON.stringify(results, null, 2) + "\n")
    expect(f.nativeInputs).toEqual([]); expect(f.sessionCreates).toEqual([]); expect(f.sessionPrompts).toEqual([])
  } finally { await f.close() }
}, 20_000)
