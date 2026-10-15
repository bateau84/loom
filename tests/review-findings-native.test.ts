import { test, expect } from "bun:test"
import { Error as ToolError } from "@opencode/plugin/promise/tool"
import { Database } from "bun:sqlite"
import { readdir, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { digest, PROCESSING_LIMITS } from "../src/model.js"
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
