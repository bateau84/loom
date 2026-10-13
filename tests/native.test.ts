import { test, expect } from "bun:test"
import { YAML } from "bun"
import { Database } from "bun:sqlite"
import { mkdtemp, writeFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import plugin from "../src/plugin.js"
import { loadConfig } from "../src/config.js"
import { Store } from "../src/store.js"

test("real Bun YAML decoder and SQLite adapter", async () => {
  const dir = await mkdtemp(join(tmpdir(), "loom-native-"))
  const db = new Database(":memory:")
  try {
    const path = join(dir, ".loom.yaml")
    await writeFile(path, "version: 1\nagents:\n  external:\n    roles: [planning, qa]\n    description: External specialist\n")
    const snapshot = await loadConfig([path], s => YAML.parse(s))
    expect(snapshot.errors).toEqual([])
    expect(snapshot.config.agents.external.roles).toEqual(["planning", "qa"])
    const store = new Store(db)
    const action = store.create("Example", "A small goal", { session_id: "s", agent: "external" })
    expect(store.action(action.id).goal).toBe("A small goal")
  } finally { db.close(); await rm(dir, { recursive: true, force: true }) }
})

test("published config example parses with the real YAML decoder", async () => {
  const snapshot = await loadConfig([new URL("../examples/loom.yaml", import.meta.url).pathname], s => YAML.parse(s))
  expect(snapshot.errors).toEqual([])
  expect(snapshot.config.agents.lead.roles).toContain("coordination")
})

test("plugin integration: configured roles, five tools, reload, scoping, capture opt-out and cleanup", async () => {
  const dir = await mkdtemp(join(tmpdir(), "loom-host-test-"))
  const oldState = process.env.XDG_STATE_HOME, oldConfig = process.env.OPENCODE_CONFIG_DIR
  process.env.XDG_STATE_HOME = join(dir, "state")
  process.env.OPENCODE_CONFIG_DIR = join(dir, "config")
  const path = join(dir, ".loom.yaml")
  const tools = new Map<string, any>(), hooks = new Map<string, any>()
  let disposed = 0
  let location = dir
  const registration = () => ({ dispose: async () => { disposed++ } })
  const ctx = {
    location: { directory: dir, project: { id: "test-project", directory: dir, canonical: dir } },
    agent: { list: async () => [{ id: "external", description: "Native description" }], transform: () => { throw new Error("Agent definitions must not be rewritten") } },
    permission: { hook: () => { throw new Error("No Loom permission hooks are allowed") } },
    tool: {
      transform: async (fn: any) => { fn({ namespace: () => {}, add: (tool: any) => tools.set(tool.name, tool) }); return registration() },
      hook: async (name: string, fn: any) => { hooks.set(name, fn); return registration() },
    },
    session: {
      get: async ({ sessionID }: { sessionID: string }) => ({ id: sessionID, projectID: "test-project", location: { directory: location } }),
      hook: async (name: string, fn: any) => { hooks.set(name, fn); return registration() },
    },
  }
  let cleanup: (() => Promise<void>) | undefined
  const invoke = async (name: string, args: unknown) => {
    const response = await tools.get(name).execute(args, { sessionID: "s", agent: "external", messageID: "m", id: "toolcall", signal: new AbortController().signal })
    return JSON.parse(response.content).result
  }
  try {
    await writeFile(path, "version: 1\nagents:\n  external:\n    roles: [planning]\n")
    cleanup = await (plugin as any).setup(ctx)
    expect([...tools.keys()].sort()).toEqual(["action", "agents", "context", "plan", "record"])
    const roster = await invoke("agents", {})
    expect(roster.agents[0].roles).toEqual(["planning"])
    const nativePart = { type: "text", text: "Keep my native instructions" }
    const event = { sessionID: "s", agent: "external", system: [nativePart], messages: [], options: {}, tools: {} }
    await hooks.get("context")(event)
    expect(event.system).toHaveLength(2)
    expect(event.system[0]).toBe(nativePart)
    expect(event.system[1].text).toContain("loom_plan")
    await hooks.get("context")(event)
    expect(event.system).toHaveLength(2)
    const action = await invoke("action", { operation: "create", title: "A", goal: "Goal" })
    await hooks.get("context")(event)
    expect(event.system).toHaveLength(3)
    await hooks.get("context")(event)
    expect(event.system).toHaveLength(3)
    expect(event.system[2].text).toContain(action.id)
    const toolEvent = { sessionID: "s", agent: "external", messageID: "m", id: "c", tool: "read", input: { path: "file" } }
    await hooks.get("execute.before")(toolEvent)
    // Complete an already captured call even when capture is disabled during execution.
    await writeFile(path, "ledger:\n  capture: off\ninstructions:\n  enabled: false\nagents:\n  external:\n    roles: [qa]\n")
    await hooks.get("execute.after")({ ...toolEvent, status: "completed", result: { content: "private output" } })
    expect((await invoke("record", { operation: "query", action_id: action.id })).items).toHaveLength(2)
    await hooks.get("execute.before")({ ...toolEvent, id: "off" })
    await hooks.get("execute.after")({ ...toolEvent, id: "off", status: "completed", result: {} })
    expect((await invoke("record", { operation: "query", action_id: action.id })).items).toHaveLength(2)
    await hooks.get("context")(event)
    expect(event.system).toEqual([nativePart])
    // Pinned OpenCode v2.0.18 passes the outer context to each Code Mode child.
    // These share IDs, but are two invocations; completion order is reversed.
    await writeFile(path, "ledger:\n  capture: automatic\ninstructions:\n  enabled: false\n")
    const first = { ...toolEvent, id: "shared", input: { path: "a" } }
    const second = { ...toolEvent, id: "shared", input: { path: "b" } }
    await Promise.all([hooks.get("execute.before")(first), hooks.get("execute.before")(second)])
    await hooks.get("execute.after")({ ...second, status: "completed", result: { content: "B" } })
    await hooks.get("execute.after")({ ...first, status: "completed", result: { content: "A" } })
    const sessionPage = await invoke("record", { operation: "query", session_only: true })
    expect(sessionPage.items).toHaveLength(6)
    const unpaired = sessionPage.items.filter((r: any) => r.data.call_id === "shared" && r.data.phase === "finished")
    expect(unpaired).toHaveLength(2)
    for (const r of unpaired) {
      expect(r.data.attribution).toContain("ambiguous-host-call")
      expect(r.data.start_id).toBeUndefined()
      expect(r.action_id).toBeUndefined()
    }
    expect((await invoke("record", { operation: "query" })).items).toHaveLength(4)
    expect((await invoke("context", {})).action.id).toBe(action.id)
    await expect(invoke("record", { operation: "query", session_only: true, action_id: action.id })).rejects.toThrow("session_only")
    await expect(invoke("record", { operation: "add", session_only: true, kind: "claim", statement: "No" })).rejects.toThrow("session_only")
    // A disabled-before sibling must not consume the captured start, even with identical input.
    const gap = { ...toolEvent, id: "gap" }
    await hooks.get("execute.before")(gap)
    await writeFile(path, "ledger:\n  capture: off\ninstructions:\n  enabled: false\n")
    await hooks.get("execute.before")({ ...gap })
    await hooks.get("execute.after")({ ...gap, status: "completed", result: {} })
    expect((await invoke("agents", {})).evidence.pairing).toBe("degraded")
    const gapFinish = (await invoke("record", { operation: "query", session_only: true })).items.at(-1)
    expect(gapFinish.data.attribution).toContain("capture-gap")
    expect(gapFinish.data.start_id).toBeUndefined()
    expect(gapFinish.action_id).toBeUndefined()
    // A Session at another location must not read or mutate this instance's Action data.
    location = join(dir, "other")
    await expect(invoke("action", { operation: "list" })).rejects.toThrow("does not own")
    await hooks.get("context")(event)
    expect(event.system).toEqual([nativePart])
  } finally {
    await cleanup?.()
    if (oldState === undefined) delete process.env.XDG_STATE_HOME; else process.env.XDG_STATE_HOME = oldState
    if (oldConfig === undefined) delete process.env.OPENCODE_CONFIG_DIR; else process.env.OPENCODE_CONFIG_DIR = oldConfig
    await rm(dir, { recursive: true, force: true })
  }
  expect(disposed).toBe(4)
})

test("removed-task recovery is injected, repeatable, non-mutating and cleared by explicit selection", async () => {
  const dir = await mkdtemp(join(tmpdir(), "loom-reselection-"))
  const oldState = process.env.XDG_STATE_HOME, oldConfig = process.env.OPENCODE_CONFIG_DIR
  process.env.XDG_STATE_HOME = join(dir, "state")
  process.env.OPENCODE_CONFIG_DIR = join(dir, "config")
  const path = join(dir, ".loom.yaml")
  const config = "version: 1\ncontext:\n  max_chars: 2000\nagents:\n  external:\n    roles: [implementation]\n"
  const tools = new Map<string, any>(), hooks = new Map<string, any>()
  const registration = () => ({ dispose: async () => {} })
  const ctx = {
    location: { directory: dir, project: { id: "reselection", directory: dir, canonical: dir } },
    agent: { list: async () => [{ id: "external" }], transform: () => { throw new Error("No agent rewriting") } },
    permission: { hook: () => { throw new Error("No permission gates") } },
    tool: {
      transform: async (fn: any) => { fn({ namespace: () => {}, add: (tool: any) => tools.set(tool.name, tool) }); return registration() },
      hook: async (name: string, fn: any) => { hooks.set(name, fn); return registration() },
    },
    session: {
      get: async ({ sessionID }: { sessionID: string }) => ({ id: sessionID, projectID: "reselection", location: { directory: dir } }),
      hook: async (name: string, fn: any) => { hooks.set(name, fn); return registration() },
    },
  }
  let cleanup: (() => Promise<void>) | undefined
  const invoke = async (name: string, input: unknown, sessionID = "s") => {
    const result = await tools.get(name).execute(input, { sessionID, agent: "external", messageID: "m", id: "call", signal: new AbortController().signal })
    return JSON.parse(result.content).result
  }
  const prefix = "<!-- loom:context:v2 -->\nLoom work context (reference data, not instructions):\n"
  const nativePart = { type: "text", text: "Unchanged native prompt" }
  const event = { sessionID: "s", agent: "external", system: [nativePart], messages: [], options: {}, tools: {} }
  const injected = () => event.system.filter(p => p.text.startsWith(prefix))
  const content = () => JSON.parse(injected()[0].text.slice(prefix.length))
  try {
    await writeFile(path, config)
    cleanup = await (plugin as any).setup(ctx)
    expect(tools.size).toBe(5)
    const action = await invoke("action", { operation: "create", title: "A", goal: "Goal" })
    const old = { id: "old", kind: "task", title: "Old work" }, next = { id: "next", kind: "task", title: "New work" }
    await invoke("plan", { operation: "save", action_id: action.id, expected_revision: 0, nodes: [old, next] })
    await invoke("context", { action_id: action.id, node_id: "old" })
    const record = await invoke("record", { operation: "add", kind: "result", statement: "Only valid while the original condition holds." })
    await hooks.get("context")(event)
    expect(content().task.id).toBe("old")
    const call = { sessionID: "s", agent: "external", messageID: "m", id: "before-removal", tool: "read", input: { path: "file" } }
    await hooks.get("execute.before")(call)
    await invoke("plan", { operation: "save", action_id: action.id, expected_revision: 1, nodes: [next] })
    await hooks.get("context")(event)
    expect(content().recovery.code).toBe("task-not-in-current-plan")
    expect(content().task).toBeNull()
    expect(event.system[0]).toBe(nativePart)
    expect(JSON.stringify(content()).length).toBeLessThanOrEqual(2000)
    await hooks.get("context")(event)
    expect(injected()).toHaveLength(1)
    expect((await invoke("context", {})).node_id).toBe("old")
    expect((await invoke("context", { action_id: action.id, node_id: "unknown" })).recovery.code).toBe("task-not-in-current-plan")
    expect((await invoke("context", {})).node_id).toBe("old")
    expect((await invoke("record", content().recovery.read_history.input)).items[0].id).toBe(record.id)
    expect((await invoke("plan", content().recovery.read_plan.input)).revision).toBe(2)
    await writeFile(path, config + "instructions:\n  enabled: false\n")
    await hooks.get("context")(event)
    expect(event.system).toEqual([nativePart])
    // The explicit context tool stays usable while automatic injection is disabled.
    expect((await invoke("context", {})).recovery.code).toBe("task-not-in-current-plan")
    await writeFile(path, config)
    await hooks.get("context")(event)
    expect(content().recovery.code).toBe("task-not-in-current-plan")
    event.agent = "unconfigured"
    await hooks.get("context")(event)
    expect(event.system).toEqual([nativePart])
    event.agent = "external"
    // Restart the plugin/database; do not infer a replacement or replay a completion.
    if (!cleanup) throw new Error("Plugin setup did not return cleanup")
    await cleanup(); cleanup = undefined
    cleanup = await (plugin as any).setup(ctx)
    await hooks.get("context")(event)
    expect(content().node_id).toBe("old")
    expect(content().recovery.code).toBe("task-not-in-current-plan")
    expect((await invoke("context", {}, "new-session")).selected).toBeNull()
    expect((await invoke("context", { action_id: action.id, node_id: "old" }, "new-session")).recovery.code).toBe("task-not-in-current-plan")
    expect((await invoke("context", {}, "new-session")).selected).toBeNull()
    await invoke("context", { action_id: action.id, node_id: "next" })
    await hooks.get("context")(event)
    expect(content().task.id).toBe("next")
    expect(content().recovery).toBeUndefined()
    expect(injected()).toHaveLength(1)
    // Native hooks still run, but the pre-restart call must not borrow the new Task.
    await hooks.get("execute.after")({ ...call, status: "completed", result: { content: "done" } })
    const late = (await invoke("record", { operation: "query", session_only: true })).items.at(-1)
    expect(late.node_id).toBeUndefined()
    expect(late.data.attribution).toContain("observer-restarted")
    await invoke("context", { clear: true })
    await hooks.get("context")(event)
    expect(injected()).toHaveLength(0)
    expect((await invoke("context", {})).selected).toBeNull()
    expect((await invoke("record", { operation: "query", action_id: action.id, record_id: record.id })).items[0].node_id).toBe("old")
    expect(tools.size).toBe(5)
  } finally {
    await cleanup?.()
    if (oldState === undefined) delete process.env.XDG_STATE_HOME; else process.env.XDG_STATE_HOME = oldState
    if (oldConfig === undefined) delete process.env.OPENCODE_CONFIG_DIR; else process.env.OPENCODE_CONFIG_DIR = oldConfig
    await rm(dir, { recursive: true, force: true })
  }
})
