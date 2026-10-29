import { test, expect } from "bun:test"
import { mkdtemp, writeFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import plugin from "../src/plugin.js"
import { loadConfig } from "../src/config.js"
import { configLoadStatus } from "../src/config-admission.js"

const deferred = () => {
  let resolve!: () => void
  const promise = new Promise<void>(done => { resolve = done })
  return { promise, resolve }
}
const tick = () => new Promise<void>(done => setTimeout(done, 5))
async function until(check: () => boolean) {
  for (let i = 0; i < 400; i++) { if (check()) return; await tick() }
  throw new Error("Expected admission state did not arrive")
}
function holdLoad() {
  const entered = deferred(), release = deferred()
  const promise = loadConfig(["held-test-read"], JSON.parse, async () => {
    entered.resolve(); await release.promise
    return {
      stat: async () => ({ size: 2n, mtimeNs: 0n, ctimeNs: 0n, isFile: () => true }),
      read: async (buffer, offset, _length, position) => {
        if (position) return { bytesRead: 0 }
        buffer.write("{}", offset); return { bytesRead: 2 }
      },
      close: async () => {},
    }
  })
  return { entered: entered.promise, promise, release: release.resolve }
}
async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), "loom-queue-host-"))
  const previousState = process.env.XDG_STATE_HOME, previousConfig = process.env.OPENCODE_CONFIG_DIR
  process.env.XDG_STATE_HOME = join(directory, "state")
  process.env.OPENCODE_CONFIG_DIR = join(directory, "config")
  const tools = new Map<string, any>(), hooks = new Map<string, any>()
  const register = async (name: string, callback: any) => {
    hooks.set(name, callback)
    return { dispose: async () => { if (hooks.get(name) === callback) hooks.delete(name) } }
  }
  const ctx = {
    location: { directory, project: { id: "admission-test", canonical: directory, directory } },
    agent: { list: async () => [{ id: "external" }] },
    session: { get: async ({ sessionID }: any) => ({ id: sessionID, projectID: "admission-test", location: { directory } }), hook: register },
    tool: { hook: register, transform: async (edit: any) => {
      const added = new Map<string, any>()
      edit({ namespace: () => {}, add: (tool: any) => { tools.set(tool.name, tool); added.set(tool.name, tool) } })
      return { dispose: async () => { for (const [name, tool] of added) if (tools.get(name) === tool) tools.delete(name) } }
    } },
  }
  const config = join(directory, ".loom.yaml")
  let cleanup: (() => Promise<void>) | undefined
  const start = async () => { cleanup = await (plugin as any).setup(ctx) }
  const stop = async () => { const old = cleanup; cleanup = undefined; await old?.() }
  const invoke = async (name: string, input: unknown, signal = new AbortController().signal) => {
    const output = await tools.get(name).execute(input, { sessionID: "s", agent: "external", messageID: "m", id: "c", signal })
    return JSON.parse(output.content)
  }
  const close = async () => {
    await stop()
    if (previousState === undefined) delete process.env.XDG_STATE_HOME; else process.env.XDG_STATE_HOME = previousState
    if (previousConfig === undefined) delete process.env.OPENCODE_CONFIG_DIR; else process.env.OPENCODE_CONFIG_DIR = previousConfig
    await rm(directory, { recursive: true, force: true })
  }
  try {
    await writeFile(config, "agents:\n  external:\n    roles: [implementation]\n")
    await start()
    return { directory, tools, hooks, invoke, start, stop, close }
  } catch (error) { await close(); throw error }
}

test("configuration overflow removes stale injection, exposes diagnostics and keeps evidence conservative", async () => {
  const f = await fixture(); let hold: ReturnType<typeof holdLoad> | undefined
  let waiting: ReturnType<typeof loadConfig>[] = []
  try {
    const action = (await f.invoke("action", { operation: "create", title: "A", goal: "remember this" })).result
    const native = { type: "text", text: "native instructions" }
    const model = { sessionID: "s", agent: "external", system: [native], messages: [], options: {}, tools: {} }
    await f.hooks.get("context")(model); expect(model.system.length).toBe(3)
    hold = holdLoad(); await hold.entered
    waiting = Array.from({ length: 8 }, () => loadConfig([], JSON.parse))
    await f.hooks.get("context")(model)
    expect(model.system).toEqual([native])
    const diagnostics = await f.invoke("agents", {})
    expect(diagnostics.result.config_loads.active).toBe(1)
    expect(diagnostics.result.config_loads.waiting).toBe(8)
    expect(diagnostics.result.errors.join(" ")).toContain("LOOM_CONFIG_LOAD_OVERFLOW")
    const call = { sessionID: "s", agent: "external", messageID: "m", id: "gap", tool: "read", input: { path: "same" } }
    await f.hooks.get("execute.before")(call) // This start is skipped, not invented later.
    hold.release(); await hold.promise; await Promise.all(waiting)
    await f.hooks.get("execute.before")({ ...call })
    await f.hooks.get("execute.after")({ ...call, status: "completed", result: { content: "old result" } })
    const records = (await f.invoke("record", { operation: "query", session_only: true })).result.items
    const end = records.find((r: any) => r.data.phase === "finished")
    expect(end.data.attribution).toContain("capture-gap")
    expect(end.data.start_id).toBeUndefined(); expect(end.action_id).toBeUndefined()
    expect((await f.invoke("context", {})).result.action.id).toBe(action.id)
    expect(f.tools.size).toBe(6)
    await f.hooks.get("context")(model); expect(model.system.length).toBe(3)
  } finally { hold?.release(); await hold?.promise; await Promise.all(waiting); await f.close() }
})

test("cancelled queued tool invocation releases capacity and cannot mutate an Action afterward", async () => {
  const f = await fixture(), hold = holdLoad(); const controller = new AbortController()
  try {
    await hold.entered
    const request = f.invoke("action", { operation: "create", title: "must not exist", goal: "cancelled" }, controller.signal)
      .then(() => ({ rejected: false }), () => ({ rejected: true }))
    await until(() => configLoadStatus().waiting === 1)
    controller.abort()
    expect((await request).rejected).toBe(true)
    expect(configLoadStatus().waiting).toBe(0); expect(configLoadStatus().active).toBe(1)
    hold.release(); await hold.promise
    expect((await f.invoke("action", { operation: "list" })).result.items).toEqual([])
  } finally { controller.abort(); hold.release(); await hold.promise; await f.close() }
})

test("disposal cancels old queued hooks without resetting admission for a replacement plugin", async () => {
  const f = await fixture(); let hold: ReturnType<typeof holdLoad> | undefined
  try {
    const native = { type: "text", text: "native" }
    const event = { sessionID: "s", agent: "external", system: [native], messages: [], options: {}, tools: {} }
    await f.hooks.get("context")(event); expect(event.system.length).toBe(2)
    hold = holdLoad(); await hold.entered
    const oldContext = f.hooks.get("context")(event)
    await until(() => configLoadStatus().waiting === 1)
    await f.stop(); await oldContext
    expect(configLoadStatus().waiting).toBe(0); expect(configLoadStatus().active).toBe(1)
    expect(event.system).toEqual([native])
    await f.start()
    const newer = f.hooks.get("context")(event)
    await until(() => configLoadStatus().waiting === 1)
    expect(configLoadStatus().active).toBe(1)
    hold.release(); await hold.promise; await newer
    expect(event.system.length).toBe(2); expect(f.tools.size).toBe(6)
  } finally { hold?.release(); await hold?.promise; await f.close() }
})
