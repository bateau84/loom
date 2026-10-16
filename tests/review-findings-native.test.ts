import { test, expect, spyOn } from "bun:test"
import { Error as ToolError } from "@opencode/plugin/promise/tool"
import { Database } from "bun:sqlite"
import { readdir, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { digest, PROCESSING_LIMITS } from "../src/model.js"
import { Store } from "../src/store.js"
import { registeredLoom } from "./helpers/registered-loom.js"

async function fixture() {
  const f = await registeredLoom()
  let db: Database | undefined
  try {
    const action = (await f.invoke("action", { operation: "create", title: "Original", goal: "Preserve recovery" })).result
    await f.invoke("plan", { operation: "save", action_id: action.id, expected_revision: 0, nodes: [{ id: "task", kind: "task", title: "Original task" }] })
    await f.invoke("context", { action_id: action.id, node_id: "task" })
    const finding = (await f.invoke("record", { operation: "add", kind: "result", statement: "Existing history must survive selection damage." })).result
    const root = join(f.directory, "state", "loom", "actions-v1")
    db = new Database(join(root, (await readdir(root))[0], "ledger.sqlite"))
    const database = db
    const history = () => database.prepare("SELECT data FROM ledger ORDER BY seq").all().map((r: any) => JSON.parse(r.data))
    const corrupt = () => database.prepare("UPDATE focus SET data=? WHERE session_id=?").run("{broken selection", "s")
    const selection = () => (database.prepare("SELECT data FROM focus WHERE session_id=?").get("s") as { data: string }).data
    return { ...f, action, finding, db: database, history, corrupt, selection,
      close: async () => { database.close(); await f.close() },
      capture: (enabled: boolean) => writeFile(join(f.directory, ".loom.yaml"), `agents: {}\ninstructions: {enabled: false}\nledger: {capture: ${enabled ? "automatic" : "off"}}\n`),
    }
  } catch (error) { db?.close(); await f.close(); throw error }
}
const call = (id = "native-error") => ({ sessionID: "s", agent: "author", messageID: "message", id, tool: "read", input: { path: "missing-file" } })

for (const captureOff of [false, true]) test(`SDK Tool.Error records a failed finish with ${captureOff ? 'in-flight capture-off' : 'automatic capture'}`, async () => {
  const f = await fixture()
  try {
    await f.capture(true)
    const event = call(), message = "PRIVATE fixture failure message"
    const error = new ToolError({ message, error: new Error("PRIVATE nested cause"), metadata: { exitCode: 1, secret: "PRIVATE metadata" } })
    expect(error).toBeInstanceOf(ToolError)
    expect(() => digest(error)).toThrow() // The generic serializer must stay strict.
    await f.hooks.get("execute.before")(event)
    const start = f.history().find((r: any) => r.data.phase === "started")
    await f.invoke("action", { operation: "create", title: "Other", goal: "Switched work" })
    if (captureOff) await f.capture(false)
    await f.hooks.get("execute.after")({ ...event, status: "error", error })
    const finishes = f.history().filter((r: any) => r.data.phase === "finished")
    expect(finishes).toHaveLength(1)
    const finish = finishes[0]
    expect(finish.data.status).toBe("error")
    expect(finish.data.attribution).toBe("captured-at-start")
    expect(finish.data.start_id).toBe(start.id)
    expect(finish.action_id).toBe(f.action.id)
    expect(finish.node_id).toBe("task")
    expect(finish.data.result_digest).toBe(digest({ format: "loom-tool-error/v1", message }))
    expect(JSON.stringify(f.history())).not.toContain("PRIVATE")
    expect(error.message).toBe(message) // The hook must not modify the host error.
  } finally { await f.close() }
})

test("failed native completion-write retains its start and retries as error, not success", async () => {
  const f = await fixture()
  try {
    await f.capture(true); const event = call("retry"), error = new ToolError({ message: "Fixture failed" })
    await f.hooks.get("execute.before")(event)
    const start = f.history().find((r: any) => r.data.phase === "started")
    f.db.exec("CREATE TRIGGER refuse_finish BEFORE INSERT ON ledger WHEN json_extract(NEW.data,'$.data.phase')='finished' BEGIN SELECT RAISE(ABORT,'injected finish refusal'); END")
    await f.hooks.get("execute.after")({ ...event, status: "error", error })
    expect(f.history().filter((r: any) => r.data.phase === "finished")).toHaveLength(0)
    f.db.exec("DROP TRIGGER refuse_finish")
    await f.hooks.get("execute.after")({ ...event, status: "error", error })
    const finish = f.history().find((r: any) => r.data.phase === "finished")
    expect(finish.data.start_id).toBe(start.id)
    expect(finish.data.status).toBe("error")
  } finally { await f.close() }
})

test("error projection neither traverses optional causes/metadata nor truncates an oversized message", async () => {
  const f = await fixture()
  try {
    await f.capture(true)
    const event = call("bounded"), circular: any = {}; circular.self = circular
    const large = new ToolError({ message: "x".repeat(PROCESSING_LIMITS.valueChars + 1), error: new Error("cause"), metadata: circular })
    await f.hooks.get("execute.before")(event)
    await f.hooks.get("execute.after")({ ...event, status: "error", error: large })
    expect(f.history().filter((r: any) => r.data.phase === "finished")).toHaveLength(0)
    const small = new ToolError({ message: "Bounded fixture error", error: new Error("cause"), metadata: circular })
    await f.hooks.get("execute.after")({ ...event, status: "error", error: small })
    const finish = f.history().find((r: any) => r.data.phase === "finished")
    expect(finish.data.status).toBe("error")
    expect(finish.data.result_digest).toBe(digest({ format: "loom-tool-error/v1", message: small.message }))
  } finally { await f.close() }
})

test("successful native output keeps its original complete digest and success status", async () => {
  const f = await fixture()
  try {
    await f.capture(true); const event = call("success"), result = { content: "Complete fixture output", metadata: { lines: 2 } }
    await f.hooks.get("execute.before")(event)
    await f.hooks.get("execute.after")({ ...event, status: "completed", result })
    const finish = f.history().find((r: any) => r.data.phase === "finished")
    expect(finish.data.status).toBe("completed")
    expect(finish.data.result_digest).toBe(digest(result))
  } finally { await f.close() }
})

test("unreadable selection does not block discovery, Action listing, Plan or Session-only history", async () => {
  const f = await fixture()
  try {
    f.corrupt(); const before = f.history()
    const discovery = await f.invoke("agents", {}).then(
      value => ({ error: null, value: value.result }),
      error => ({ error: String(error), value: undefined }),
    )
    expect(discovery.error).toBeNull()
    expect(discovery.value?.agents).toHaveLength(2)
    expect((await f.invoke("action", { operation: "list" })).result.items[0].id).toBe(f.action.id)
    expect((await f.invoke("plan", { operation: "read", action_id: f.action.id })).result.nodes[0].id).toBe("task")
    expect((await f.invoke("record", { operation: "query", session_only: true })).result.items[0].id).toBe(f.finding.id)
    expect((await f.invoke("record", { operation: "query", action_id: f.action.id, record_id: f.finding.id })).result.items[0].id).toBe(f.finding.id)
    expect(f.selection()).toBe("{broken selection")
    expect(f.history()).toEqual(before)
    expect(f.tools.size).toBe(5)
  } finally { await f.close() }
})

test("explicit Action update and create do not require readable previous selection", async () => {
  const f = await fixture()
  try {
    f.corrupt(); const before = f.history()
    const update = (await f.invoke("action", { operation: "update", action_id: f.action.id, expected_revision: 1, title: "Updated" })).result
    expect(update.revision).toBe(2); expect(f.selection()).toBe("{broken selection")
    const created = (await f.invoke("action", { operation: "create", title: "New action", goal: "Explicitly selected new work" })).result
    expect(created.id).not.toBe(f.action.id)
    expect(JSON.parse(f.selection())).toEqual({ action_id: created.id })
    expect(f.history()).toEqual(before)
  } finally { await f.close() }
})

test("clearing unreadable selection succeeds without deleting history or selecting replacement work", async () => {
  const f = await fixture()
  try {
    f.corrupt(); const before = f.history()
    expect((await f.invoke("context", { clear: true })).result).toEqual({ selected: null })
    expect(f.selection()).toBe("null")
    expect((await f.invoke("context", {})).result.selected).toBeNull()
    expect(f.history()).toEqual(before)
  } finally { await f.close() }
})

test("failed clear and failed Action creation report write failure and preserve damaged selection", async () => {
  const f = await fixture()
  try {
    f.corrupt(); const before = f.history()
    f.db.exec("CREATE TRIGGER refuse_selection BEFORE INSERT ON focus BEGIN SELECT RAISE(ABORT,'injected selection write refusal'); END")
    await expect(f.invoke("context", { clear: true })).rejects.toThrow("injected selection write refusal")
    await expect(f.invoke("action", { operation: "create", title: "Must roll back", goal: "No false success" })).rejects.toThrow("injected selection write refusal")
    expect(f.selection()).toBe("{broken selection")
    expect((await f.invoke("action", { operation: "list" })).result.items).toHaveLength(1)
    expect(f.history()).toEqual(before)
    f.db.exec("DROP TRIGGER refuse_selection")
    expect((await f.invoke("context", { clear: true })).result.selected).toBeNull()
  } finally { await f.close() }
})

test("context read survives selection-save failure and automatic context follows the persisted task", async () => {
  const f = await fixture()
  const select = spyOn(Store.prototype, "select") // Observe real writes; do not replace storage behavior.
  try {
    await f.invoke("plan", { operation: "save", action_id: f.action.id, expected_revision: 1, nodes: [
      { id: "task", kind: "task", title: "Original task" },
      { id: "requested", kind: "task", title: "Requested task", outcome: "Useful retrieved contract" },
    ] })
    const requested = { action_id: f.action.id, node_id: "requested" }
    const worked = (await f.invoke("context", requested)).result
    const completion = (await f.invoke("record", { operation: "complete", work_ref: worked.work_ref, statement: "Fixture completion without assignment" })).result
    await f.invoke("context", { action_id: f.action.id, node_id: "task" })
    const question = (await f.invoke("record", { operation: "ask", ...requested, respondent: "author", statement: "Retain this question?" })).result
    const before = f.history(), saved = f.selection()
    await writeFile(join(f.directory, ".loom.yaml"), "agents: {author: {roles: [implementation]}}\ninstructions: {enabled: true}\nledger: {capture: off}\n")
    f.db.exec("CREATE TRIGGER refuse_selection BEFORE INSERT ON focus BEGIN SELECT RAISE(ABORT,'injected selection write refusal'); END")
    select.mockClear()
    const result = (await f.invoke("context", requested)).result
    expect(select).toHaveBeenCalledTimes(1)
    expect(result.task.id).toBe("requested")
    expect(result.task.outcome).toBe("Useful retrieved contract")
    expect(result.work_ref.node_id).toBe("requested")
    expect(result.work_ref).toEqual(worked.work_ref)
    expect(result.progress.some((p: any) => p.report_id === completion.id && p.state === "reported-complete")).toBe(true)
    expect(result.questions.some((q: any) => q.question_id === question.id)).toBe(true)
    expect(result.recovery).toBeUndefined()
    expect(result.selection).toMatchObject({ status: "save-failed", persisted: { action_id: f.action.id, node_id: "task" } })
    expect(result.selection.error).toContain("injected selection write refusal")
    expect(result.selection.warning).toContain("Context was read")
    expect(f.selection()).toBe(saved)
    expect((await f.invoke("context", {})).result.task.id).toBe("task")
    expect((await f.context("s", "author")).task.id).toBe("task")
    expect(f.history()).toEqual(before)
    expect(f.tools.size).toBe(5)
  } finally { select.mockRestore(); await f.close() }
})

for (const previous of ["fresh", "cleared"] as const) for (const task of [false, true]) test(`failed selection save keeps useful ${task ? "task" : "Action"} context in a ${previous} Session`, async () => {
  const f = await fixture()
  try {
    if (previous === "cleared") await f.invoke("context", { clear: true }, "reader")
    const before = f.history()
    await writeFile(join(f.directory, ".loom.yaml"), "agents: {author: {roles: [implementation]}}\ninstructions: {enabled: true}\nledger: {capture: off}\n")
    f.db.exec("CREATE TRIGGER refuse_selection BEFORE INSERT ON focus BEGIN SELECT RAISE(ABORT,'injected selection write refusal'); END")
    const result = (await f.invoke("context", { action_id: f.action.id, ...(task ? { node_id: "task" } : {}) }, "reader")).result
    expect(result.action.id).toBe(f.action.id)
    expect(result.action.title).toBe("Original")
    if (task) { expect(result.task.id).toBe("task"); expect(result.work_ref.node_id).toBe("task") }
    else expect(result.task).toBeNull()
    expect(result.records.some((r: any) => r.id === f.finding.id)).toBe(true)
    expect(result.selection).toMatchObject({ status: "save-failed", persisted: null })
    expect(result.selection.error).toContain("injected selection write refusal")
    expect(result.selection.read_error).toBeUndefined()
    expect((await f.invoke("context", {}, "reader")).result.selected).toBeNull()
    expect(await f.context("reader", "author")).toBeUndefined()
    expect(f.db.prepare("SELECT data FROM focus WHERE session_id='reader'").get()).toEqual(previous === "fresh" ? null : { data: "null" })
    expect(f.history()).toEqual(before)
  } finally { await f.close() }
})

test("failed selection save reports unknown persisted selection when it cannot be read", async () => {
  const f = await fixture()
  try {
    f.corrupt(); const before = f.history()
    f.db.exec("CREATE TRIGGER refuse_selection BEFORE INSERT ON focus BEGIN SELECT RAISE(ABORT,'injected selection write refusal'); END")
    const result = (await f.invoke("context", { action_id: f.action.id, node_id: "task" })).result
    expect(result.task.id).toBe("task")
    expect(result.work_ref.node_id).toBe("task")
    expect(result.selection).toMatchObject({ status: "save-failed", persisted: "unknown" })
    expect(result.selection.error).toContain("injected selection write refusal")
    expect(result.selection.read_error).toBeString()
    expect(result.selection.read_error.length).toBeGreaterThan(0)
    expect(f.selection()).toBe("{broken selection")
    await expect(f.invoke("context", {})).rejects.toThrow()
    expect(f.history()).toEqual(before)
  } finally { await f.close() }
})

test("context read survives unavailable selection storage without inventing a saved reference", async () => {
  const f = await fixture()
  try {
    const before = f.history()
    f.db.exec("DROP TABLE focus")
    const result = (await f.invoke("context", { action_id: f.action.id, node_id: "task" })).result
    expect(result.task.id).toBe("task")
    expect(result.selection).toMatchObject({ status: "save-failed", persisted: "unknown" })
    expect(result.selection.error).toContain("no such table: focus")
    expect(result.selection.read_error).toContain("no such table: focus")
    await expect(f.invoke("context", { clear: true })).rejects.toThrow("no such table: focus")
    expect(f.history()).toEqual(before)
  } finally { await f.close() }
})

test("context validation, missing task recovery and storage read errors remain distinct from selection-save failure", async () => {
  const f = await fixture()
  const select = spyOn(Store.prototype, "select")
  try {
    const saved = f.selection(), before = f.history()
    f.db.exec("CREATE TRIGGER refuse_selection BEFORE INSERT ON focus BEGIN SELECT RAISE(ABORT,'injected selection write refusal'); END")
    await expect(f.invoke("context", { node_id: "task" })).rejects.toThrow("node_id requires action_id")
    await expect(f.invoke("context", { action_id: "" })).rejects.toThrow("id must be a simple identifier")
    await expect(f.invoke("context", { action_id: "not-found" })).rejects.toThrow("Unknown Action")
    const missing = (await f.invoke("context", { action_id: f.action.id, node_id: "not-found" })).result
    expect(missing.recovery.code).toBe("task-not-in-current-plan")
    expect(missing.selection).toBeUndefined()
    expect(missing.selection_unchanged).toBe(true)
    f.db.prepare("UPDATE plans SET data=? WHERE action_id=?").run("{broken plan", f.action.id)
    await expect(f.invoke("context", { action_id: f.action.id, node_id: "task" })).rejects.toThrow()
    expect(select).not.toHaveBeenCalled()
    expect(f.selection()).toBe(saved)
    expect(f.history()).toEqual(before)
  } finally { select.mockRestore(); await f.close() }
})

test("selection-dependent operations still expose corruption instead of treating it as no selection", async () => {
  const f = await fixture()
  try {
    f.corrupt(); const before = f.history()
    await expect(f.invoke("context", {})).rejects.toThrow()
    await expect(f.invoke("record", { operation: "add", kind: "claim", statement: "Do not invent a scope" })).rejects.toThrow()
    await expect(f.invoke("record", { operation: "query" })).rejects.toThrow()
    expect(f.selection()).toBe("{broken selection"); expect(f.history()).toEqual(before)
    const explicit = (await f.invoke("context", { action_id: f.action.id, node_id: "task" })).result
    expect(explicit.task.id).toBe("task")
  } finally { await f.close() }
})

test("recovery paths retain explicit scope validation when selection is unreadable", async () => {
  const f = await fixture()
  try {
    f.corrupt()
    await expect(f.invoke("context", { clear: true, node_id: "task" })).rejects.toThrow("clear cannot be combined")
    await expect(f.invoke("record", { operation: "query", session_only: true, action_id: f.action.id })).rejects.toThrow("session_only is a query option")
    expect(f.selection()).toBe("{broken selection")
    expect((await f.invoke("record", { operation: "query", session_only: true }, "unrelated-session")).result.items).toEqual([])
  } finally { await f.close() }
})
