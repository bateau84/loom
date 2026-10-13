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
