/** Component observation tests; the host surface is simulated, never a real audit. */
import { expect, test } from "bun:test"
import { mkdtemp, mkdir, writeFile, readdir, readFile, readlink, stat, rm } from "node:fs/promises"
import { closeSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import observer, { projectReceipt } from "../tools/evaluator-observer/server.js"

const record = { id: "record_1", action_id: "action_1", session_id: "evaluator_1", agent: "evaluator", kind: "result",
  created_at: "2026-11-11T00:00:00Z", data: { statement: "PRIVATE audit facts and uncertainty", artifact_refs: ["PRIVATE source reference"] } }
const wrapped = (result: unknown) => ({ content: JSON.stringify({ result }) })

test("observer hashes exact public records and rejects mismatched query or truncation", () => {
  const write = projectReceipt("loom.record", { operation: "add", kind: "result" }, wrapped(record))
  const read = projectReceipt("loom_record", { operation: "query", record_id: record.id, action_id: record.action_id }, wrapped({ items: [{ sequence: 42, ...record }] }))
  expect(write?.record_sha256).toEqual(read?.record_sha256)
  expect(JSON.stringify(write)).not.toContain("PRIVATE")
  expect(projectReceipt("loom.record", { operation: "query", record_id: "other" }, wrapped({ items: [{ sequence: 42, ...record }] }))).toBeUndefined()
  expect(projectReceipt("loom.record", { operation: "query", record_id: record.id }, wrapped({ items: [{ sequence: 42, ...record, data: { ...record.data, truncated: true } }] }))).toBeUndefined()
  expect(projectReceipt("loom.record", { operation: "query", record_id: record.id }, wrapped({ items: [record] }))).toBeUndefined()
  const changed = projectReceipt("loom.record", { operation: "add", kind: "result" }, wrapped({ ...record, data: { ...record.data, statement: "changed" } }))
  expect(changed?.record_sha256).not.toEqual(write?.record_sha256)
  expect(projectReceipt("loom.record", { operation: "add", kind: "result" }, wrapped({ status: "PASS" }))).toBeUndefined()
})

test("observer preserves tool result identity without copying skill, trace or subagent text", () => {
  const skill = projectReceipt("skill", { id: "agent-run-audit" }, { content: "PRIVATE skill" })
  expect(skill?.delivered_result_sha256).toMatch(/^[a-f0-9]{64}$/)
  const trace = projectReceipt("loom_trace", { operation: "timeline", cursor: "PRIVATE cursor" }, wrapped({
    session_id: "source_1", source: "provided-export", events: [{ text: "PRIVATE source" }], next_cursor: "PRIVATE next" }))
  expect(trace?.event_count).toBe(1)
  expect(trace?.next_cursor_sha256).toMatch(/^[a-f0-9]{64}$/)
  expect(projectReceipt("subagent", { agent: "evaluator" }, { output: { sessionID: "evaluator_1", output: "PRIVATE handback" } }))
    .toEqual({ kind: "delegation", child_session_id: "evaluator_1" })
  expect(JSON.stringify([skill, trace])).not.toContain("PRIVATE")
  expect(projectReceipt("execute", {}, { content: "PASS all qualification checks" })).toBeUndefined()
})

async function fixture(capture: "automatic" | "off" = "automatic", beforeHook?: (root: string) => Promise<void>) {
  const root = await mkdtemp(join(tmpdir(), "loom-evaluator-observer-"))
  const previous = { observer: process.env.LOOM_EVALUATOR_OBSERVER, config: process.env.OPENCODE_CONFIG_DIR }
  const receipts = join(root, "receipts"), settings = join(root, "observer.json")
  await mkdir(receipts, { mode: 0o700 })
  await writeFile(settings, JSON.stringify({ format: "loom-evaluator-observer/v1", project_directory: root,
    receipt_directory: receipts, audit_session_id: "general_1", recovery_session_id: "reader_1" }), { mode: 0o600 })
  await writeFile(join(root, ".loom.yaml"), `ledger: {capture: ${capture}}\n`)
  process.env.LOOM_EVALUATOR_OBSERVER = settings
  process.env.OPENCODE_CONFIG_DIR = join(root, "config")
  const hooks = new Map<string, (event: any) => Promise<void>>()
  let nativeReads = 0
  let beforeRead: (() => Promise<void>) | undefined
  const context = { app: { version: "2.2.6" }, location: { directory: root, project: { id: "project_1" } },
    session: { get: async ({ sessionID }: { sessionID: string }) => {
      nativeReads++
      await beforeRead?.()
      return { id: sessionID, projectID: "project_1", location: { directory: root },
        agent: sessionID === "general_1" ? "general" : "evaluator",
        parentID: sessionID === "evaluator_1" ? "general_1" : "other_parent" }
    }, hook: async (name: string, handler: (event: any) => Promise<void>) => { await beforeHook?.(root); hooks.set(name, handler); return { dispose: async () => {} } } },
    tool: { hook: async (name: string, handler: (event: any) => Promise<void>) => { hooks.set(name, handler); return { dispose: async () => {} } } } }
  const dispose = await (observer as any).setup(context)
  return { root, receipts, hooks, nativeReads: () => nativeReads,
    beforeRead: (work: () => Promise<void>) => { beforeRead = work },
    rows: async () => (await Promise.all((await readdir(receipts)).map(file => readFile(join(receipts, file), "utf8")))).join("").trim().split("\n").filter(Boolean).map(line => JSON.parse(line)),
    close: async () => { try { await dispose?.() } finally {
      if (previous.observer === undefined) delete process.env.LOOM_EVALUATOR_OBSERVER; else process.env.LOOM_EVALUATOR_OBSERVER = previous.observer
      if (previous.config === undefined) delete process.env.OPENCODE_CONFIG_DIR; else process.env.OPENCODE_CONFIG_DIR = previous.config
      await rm(root, { recursive: true, force: true })
    } } }
}

const toolEvent = (sessionID = "evaluator_1", agent = "evaluator") => ({ sessionID, agent, id: "call_1", messageID: "message_1",
  tool: "loom.record", status: "completed", input: { operation: "add", kind: "result" }, result: wrapped(record) })

test("observer scopes native descendants and leaves unrelated ordinary Sessions without native reads", async () => {
  const host = await fixture()
  try {
    await host.hooks.get("execute.after")!(toolEvent("ordinary", "coder"))
    expect(host.nativeReads()).toBe(0)
    await host.hooks.get("execute.after")!(toolEvent("unrelated_evaluator", "evaluator"))
    expect((await host.rows()).filter(row => row.type === "tool")).toHaveLength(0)
    await host.hooks.get("execute.after")!(toolEvent())
    const rows = await host.rows()
    expect(rows.filter(row => row.type === "tool")).toHaveLength(1)
    expect(rows[1].data.parent_session_id).toBe("general_1")
    expect(JSON.stringify(rows)).not.toContain("PRIVATE")
    expect((await stat(join(host.receipts, (await readdir(host.receipts))[0]!))).mode & 0o777).toBe(0o600)
  } finally { await host.close() }
})

test("capture off registers no observer and later opt-out suppresses new receipts", async () => {
  const disabled = await fixture("off")
  try { expect(disabled.hooks.size).toBe(0); expect(await disabled.rows()).toEqual([]) }
  finally { await disabled.close() }
  const host = await fixture()
  try {
    const before = await host.rows()
    await writeFile(join(host.root, ".loom.yaml"), "ledger: {capture: off}\n")
    await host.hooks.get("execute.after")!(toolEvent())
    expect(await host.rows()).toEqual(before)
  } finally { await host.close() }
})

test("observation I/O failure cannot reject a completed tool", async () => {
  const host = await fixture()
  try {
    // Kernel-level fault in the observer's one private descriptor, not a fake
    // successful sink. The real write must encounter EBADF and stay isolated.
    const pathname = join(host.receipts, (await readdir(host.receipts))[0]!)
    let closed = false
    for (const descriptor of await readdir("/proc/self/fd")) {
      let target: string
      try { target = await readlink("/proc/self/fd/" + descriptor) } catch { continue }
      if (target === pathname) { closeSync(Number(descriptor)); closed = true; break }
    }
    expect(closed).toBe(true)
    await expect(host.hooks.get("execute.after")!(toolEvent())).resolves.toBeUndefined()
    const rows = await host.rows()
    expect(rows.some(row => row.type === "tool")).toBe(false)
  } finally { await host.close() }
})

test("capture opt-out during pending native scope lookup suppresses the receipt", async () => {
  const host = await fixture()
  try {
    let entered!: () => void, release!: () => void
    const waiting = new Promise<void>(resolve => { entered = resolve })
    const pending = new Promise<void>(resolve => { release = resolve })
    host.beforeRead(async () => { entered(); await pending })
    const before = await host.rows()
    const writing = host.hooks.get("execute.after")!(toolEvent())
    await waiting
    await writeFile(join(host.root, ".loom.yaml"), "ledger: {capture: off}\n")
    release()
    await writing
    expect(await host.rows()).toEqual(before)
  } finally { await host.close() }
})

test("capture opt-out during failed hook registration suppresses setup diagnostics", async () => {
  let entered!: () => void, release!: () => void, root = ""
  const waiting = new Promise<void>(resolve => { entered = resolve })
  const pending = new Promise<void>(resolve => { release = resolve })
  const creating = fixture("automatic", async directory => { root = directory; entered(); await pending; throw new Error("fixture registration failure") })
  await waiting
  await writeFile(join(root, ".loom.yaml"), "ledger: {capture: off}\n")
  release()
  const host = await creating
  try {
    expect((await host.rows()).map(row => row.type)).toEqual(["ready"])
    expect(host.hooks.size).toBe(0)
  } finally { await host.close() }
})
