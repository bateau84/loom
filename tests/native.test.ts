import { test, expect, spyOn } from "bun:test"
import { YAML } from "bun"
import { Database } from "bun:sqlite"
import { mkdir, mkdtemp, writeFile, rm, readdir, realpath, symlink } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import plugin from "../src/plugin.js"
import entrypoint from "../server.js"
import { loadConfig } from "../src/config.js"
import { Store } from "../src/store.js"
import { digest } from "../src/model.js"
import { legacyFixture, legacyDeliveryDDL, savedRows } from "./helpers/legacy-delivery.js"

for (const scenario of ["missing-column", "unsupported-version", "healthy", "empty-legacy", "nonempty-legacy", "masked-index"] as const) test(scenario !== "unsupported-version"
  ? `${scenario} startup still registers seven tools and closes its private database on disposal`
  : `startup ${scenario} identifies the resolved database and known stage, preserves cause and closes before tools`, async () => {
  const healthy = scenario !== "unsupported-version"
  await mkdir(new URL("../.test-build/", import.meta.url), { recursive: true })
  const dir = await mkdtemp(join(import.meta.dir, "../.test-build/startup-"))
  const previous = { state: process.env.XDG_STATE_HOME, config: process.env.OPENCODE_CONFIG_DIR }
  const stateHome = join(dir, "actual-state"), alias = join(dir, "state-alias")
  await mkdir(stateHome); await symlink(stateHome, alias)
  const project = { id: "startup-test", canonical: dir, directory: dir }
  const state = join(stateHome, "loom", "actions-v1", digest({ project: project.id, canonical: project.canonical }))
  await mkdir(state, { recursive: true })
  const filename = join(state, "ledger.sqlite"), db = new Database(filename)
  const store = new Store(db)
  const actor = { session_id: "private-session", agent: "author" }
  const action = store.create("Private action", "Not diagnostic output", actor)
  store.record(actor, { action_id: action.id }, { kind: "claim", statement: "PRIVATE-RECORD-CONTENT" })
  if (scenario === "empty-legacy" || scenario === "nonempty-legacy") legacyFixture(db)
  else db.exec(legacyDeliveryDDL)
  if (scenario === "nonempty-legacy") db.exec("INSERT INTO primary_deliveries(intent_id,intent_seq,bucket) SELECT id,seq,'uncertain' FROM ledger ORDER BY seq LIMIT 1")
  if (scenario === "missing-column" || scenario === "masked-index") db.exec("DROP TABLE primary_deliveries; CREATE TABLE primary_deliveries (intent_id TEXT PRIMARY KEY, intent_seq INTEGER, bucket TEXT)")
  if (scenario === "masked-index") db.exec("CREATE INDEX primary_delivery_assignment ON primary_deliveries(bucket,intent_seq)")
  if (scenario === "unsupported-version") db.exec("PRAGMA user_version=42")
  const history = db.query("SELECT data FROM ledger ORDER BY seq").all()
  const allRows = savedRows(db), schema = db.query("SELECT * FROM sqlite_schema ORDER BY name").all(), schemaVersion = db.query("PRAGMA schema_version").get()
  db.close()
  const registrations: string[] = [], tools: string[] = [], closed: Database[] = []
  let skillDisposals = 0
  const hostIO: string[] = []
  const originalClose = Database.prototype.close
  const close = spyOn(Database.prototype, "close").mockImplementation(function(this: Database, ...args: Parameters<Database["close"]>) {
    closed.push(this); return originalClose.apply(this, args)
  })
  const ctx = {
    location: { directory: dir, project },
    skill: { transform: async (fn: any) => {
      registrations.push("skill")
      fn({ get: () => undefined, add: () => {} })
      return { dispose: async () => { skillDisposals++ } }
    } },
    tool: {
      transform: async (fn: any) => {
        registrations.push("tool")
        fn({ namespace: () => {}, add: (tool: { name: string }) => tools.push(tool.name) })
        return { dispose: async () => {} }
      },
      hook: async () => ({ dispose: async () => {} }),
    },
    session: { hook: async () => ({ dispose: async () => {} }),
      get: async () => { hostIO.push("get"); throw new Error("Startup must not look up a Session") },
      context: async () => { hostIO.push("context"); return [] },
      synthetic: async () => { hostIO.push("synthetic"); throw new Error("Startup must not deliver") } },
    event: { subscribe: async function* () { registrations.push("event") } },
  }
  let cleanup: (() => void | Promise<void>) | undefined
  try {
    process.env.XDG_STATE_HOME = alias
    process.env.OPENCODE_CONFIG_DIR = join(dir, "config")
    let failure: unknown
    try { cleanup = await entrypoint.setup(ctx as unknown as Parameters<typeof entrypoint.setup>[0]) || undefined }
    catch (error) { failure = error }
    if (healthy) {
      expect(failure).toBeUndefined()
      expect(tools.sort()).toEqual(["action", "agents", "assessment", "context", "plan", "qa", "record"])
       expect(registrations.sort()).toEqual(["skill", "tool", "tool"])
      expect(closed).toHaveLength(0)
      if (!cleanup) throw new Error("Healthy startup must return cleanup")
      await cleanup(); cleanup = undefined
    } else {
      expect(failure).toBeInstanceOf(Error)
      if (!(failure instanceof Error)) throw new Error("Expected initialization failure")
      expect(failure.message).toContain(await realpath(filename))
      expect(failure.message).not.toContain(alias)
      expect(failure.message).toContain("stage=store-initialization")
      expect(failure.cause).toBeInstanceOf(Error)
      if (!(failure.cause instanceof Error)) throw new Error("Expected original SQLite cause")
      expect(failure.message).toContain(failure.cause.message)
      expect(failure.cause.message).toContain("Unsupported Loom Action database version")
      expect(`${failure.message}\n${failure.stack}\n${failure.cause.stack}`).not.toContain("PRIVATE-RECORD-CONTENT")
      expect(registrations).toEqual(["skill"])
      expect(tools).toEqual([])
    }
    expect(closed).toHaveLength(1)
    expect(skillDisposals).toBe(1)
    expect(hostIO).toEqual([])
    expect(() => closed[0].query("SELECT 1")).toThrow()
    close.mockRestore()
    const after = new Database(filename)
    try {
      expect(after.query("SELECT data FROM ledger ORDER BY seq").all()).toEqual(history)
      expect(savedRows(after)).toEqual(allRows)
      // No empty-projection migration or schema interpretation after retirement.
      expect(after.query("SELECT * FROM sqlite_schema ORDER BY name").all()).toEqual(schema)
      expect(after.query("PRAGMA schema_version").get()).toEqual(schemaVersion)
      expect(after.query("PRAGMA table_info(primary_deliveries)").all().some((column: any) => column.name === "assignment_id")).toBe(false)
      expect(after.query("PRAGMA user_version").get()).toEqual({ user_version: scenario === "unsupported-version" ? 42 : 1 })
    } finally { after.close() }
  } finally {
    await cleanup?.()
    close.mockRestore()
    if (previous.state === undefined) delete process.env.XDG_STATE_HOME; else process.env.XDG_STATE_HOME = previous.state
    if (previous.config === undefined) delete process.env.OPENCODE_CONFIG_DIR; else process.env.OPENCODE_CONFIG_DIR = previous.config
    await rm(dir, { recursive: true, force: true })
  }
})

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
  expect(snapshot.config.roles.planning.description).toContain("Breaks complex work")
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
    await writeFile(path, "version: 1\nagents:\n  external:\n    roles: [planning]\nroles:\n  planning:\n    description: Plans and delegates work\n  unassigned:\n    description: Future specialization\n")
    cleanup = await (plugin as any).setup(ctx)
    expect([...tools.keys()].sort()).toEqual(["action", "agents", "context", "plan", "record"])
    const roster = await invoke("agents", {})
    expect(roster.agents[0].roles).toEqual(["planning"])
    expect(roster.agents[0].description).toBe("Native description")
    expect(roster.role_descriptions).toEqual({ planning: "Plans and delegates work", unassigned: "Future specialization" })
    const nativePart = { type: "text", text: "Keep my native instructions" }
    const event = { sessionID: "s", agent: "external", system: [nativePart], messages: [], options: {}, tools: {} }
    await hooks.get("context")(event)
    expect(event.system).toHaveLength(2)
    expect(event.system[0]).toBe(nativePart)
    expect(event.system[1].text).toContain("loom_plan")
    expect(event.system[1].text).not.toContain("Plans and delegates work")
    await hooks.get("context")(event)
    expect(event.system).toHaveLength(2)
    const action = await invoke("action", { operation: "create", title: "A", goal: "Goal" })
    await hooks.get("context")(event)
    expect(event.system).toHaveLength(3)
    await hooks.get("context")(event)
    expect(event.system).toHaveLength(3)
    expect(event.system[2].text).toContain(action.id)
    // Simulate a new context assembly after compaction, preserving the host's
    // system parts. This is a hook regression, NOT installed-host compaction proof.
    const rebuilt = { ...event, system: [...event.system], messages: [] }
    await hooks.get("context")(rebuilt)
    expect(rebuilt.system).toHaveLength(3)
    expect(rebuilt.system[0]).toBe(nativePart)
    expect(rebuilt.system.filter((p: any) => p.text.startsWith("<!-- loom:context:v2 -->"))).toHaveLength(1)
    expect(rebuilt.system.filter((p: any) => p.text.startsWith("<!-- loom:runtime:v2 -->"))).toHaveLength(1)
    const toolEvent = { sessionID: "s", agent: "external", messageID: "m", id: "c", tool: "read", input: { path: "file" } }
    await hooks.get("execute.before")(toolEvent)
    // Complete an already captured call even when capture is disabled during execution.
    await writeFile(path, "ledger:\n  capture: off\ninstructions:\n  enabled: false\nagents:\n  external:\n    roles: [qa]\nroles:\n  qa:\n    description: Probes failures and regressions\n")
    expect((await invoke("agents", {})).role_descriptions).toEqual({ qa: "Probes failures and regressions" })
    expect((await invoke("agents", {})).agents[0].roles).toEqual(["qa"])
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
    const sessionClaim = await invoke("record", { operation: "add", session_only: true, kind: "claim", statement: "No" })
    expect(sessionClaim.action_id).toBeUndefined()
    expect((await invoke("record", { operation: "query", action_id: action.id })).items).toHaveLength(4)
    expect((await invoke("record", { operation: "query", session_only: true })).items.map((r: any) => r.id)).toContain(sessionClaim.id)
    // A disabled-before sibling must not consume the captured start, even with identical input.
    const gap = { ...toolEvent, id: "gap" }
    await hooks.get("execute.before")(gap)
    await writeFile(path, "ledger:\n  capture: off\ninstructions:\n  enabled: false\n")
    await hooks.get("execute.before")({ ...gap })
    const beforeDisabledFinish = (await invoke("record", { operation: "query", session_only: true })).items
    await hooks.get("execute.after")({ ...gap, status: "completed", result: {} })
    expect((await invoke("agents", {})).evidence.pairing).toBe("degraded")
    expect((await invoke("record", { operation: "query", session_only: true })).items).toEqual(beforeDisabledFinish)
    // The gap may be diagnosed when capture is enabled again, never while off.
    await writeFile(path, "ledger:\n  capture: automatic\ninstructions:\n  enabled: false\n")
    await hooks.get("execute.after")({ ...gap, status: "completed", result: {} })
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
  expect(disposed).toBe(5)
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

for (const gapKind of ["off", "write-failure"] as const) test(`registered plugin replacement retains ${gapKind} gap and respects capture-off`, async () => {
  const dir = await mkdtemp(join(tmpdir(), "loom-hot-gap-"))
  const oldState = process.env.XDG_STATE_HOME, oldConfig = process.env.OPENCODE_CONFIG_DIR
  process.env.XDG_STATE_HOME = join(dir, "state")
  process.env.OPENCODE_CONFIG_DIR = join(dir, "config")
  const path = join(dir, ".loom.yaml")
  const tools = new Map<string, any>(), hooks = new Map<string, any>()
  const hook = async (name: string, fn: any) => {
    hooks.set(name, fn)
    return { dispose: async () => { if (hooks.get(name) === fn) hooks.delete(name) } }
  }
  const ctx = {
    location: { directory: dir, project: { id: "hot-gap", directory: dir, canonical: dir } },
    agent: { list: async () => [{ id: "external" }], transform: () => { throw new Error("No agent rewriting") } },
    permission: { hook: () => { throw new Error("No permission gates") } },
    tool: {
      transform: async (fn: any) => {
        const added = new Map<string, any>()
        fn({ namespace: () => {}, add: (tool: any) => { tools.set(tool.name, tool); added.set(tool.name, tool) } })
        return { dispose: async () => { for (const [name, tool] of added) if (tools.get(name) === tool) tools.delete(name) } }
      },
      hook,
    },
    session: {
      get: async ({ sessionID }: { sessionID: string }) => ({ id: sessionID, projectID: "hot-gap", location: { directory: dir } }),
      hook,
    },
  }
  let cleanup: (() => Promise<void>) | undefined
  let inspection: Database | undefined
  const invoke = async (name: string, input: unknown) => {
    const output = await tools.get(name).execute(input, { sessionID: "s", agent: "external", messageID: "m", id: "call", signal: new AbortController().signal })
    return JSON.parse(output.content).result
  }
  const records = () => invoke("record", { operation: "query", session_only: true })
  const configure = (capture: string) => writeFile(path, `ledger:\n  capture: ${capture}\nagents:\n  external:\n    roles: [implementation]\n`)
  const call = { sessionID: "s", agent: "external", messageID: "m", id: "identical", tool: "read", input: { path: "same" } }
  try {
    await configure("automatic")
    cleanup = await (plugin as any).setup(ctx)
    const action = await invoke("action", { operation: "create", title: "A", goal: "Goal" })
    await invoke("plan", { operation: "save", action_id: action.id, expected_revision: 0,
      nodes: [{ id: "old", kind: "task", title: "Research" }, { id: "new", kind: "task", title: "Worker" }] })
    await invoke("context", { action_id: action.id, node_id: "old" })
    // Settle a distinct captured key, then show that capture-off does not reuse it.
    const settled = { ...call, id: "settled" }
    await hooks.get("execute.before")(settled)
    await hooks.get("execute.after")({ ...settled, status: "completed", result: { content: "captured" } })
    const baseline = (await records()).items
    if (gapKind === "off") {
      await configure("off")
      await hooks.get("execute.before")({ ...settled })
      await hooks.get("execute.after")({ ...settled, status: "completed", result: { content: "disabled" } })
      expect((await records()).items).toEqual(baseline)
    }

    // For the failure variant, force an actual SQLite insert failure in the plugin.
    if (gapKind === "write-failure") {
      await configure("automatic")
      const root = join(dir, "state", "loom", "actions-v1")
      const names = await readdir(root)
      expect(names).toHaveLength(1)
      inspection = new Database(join(root, names[0], "ledger.sqlite"))
      inspection.exec("CREATE TRIGGER fail_capture BEFORE INSERT ON ledger BEGIN SELECT RAISE(ABORT, 'injected start failure'); END;")
    }
    await hooks.get("execute.before")(call)
    expect((await records()).items).toEqual(baseline)
    if (inspection) { inspection.exec("DROP TRIGGER fail_capture"); inspection.close(); inspection = undefined }
    // Dispose all registrations and storage, then use only the replacement hooks.
    if (!cleanup) throw new Error("Plugin setup did not return cleanup")
    await cleanup(); cleanup = undefined
    expect(hooks.size).toBe(0)
    await configure("automatic")
    cleanup = await (plugin as any).setup(ctx)
    expect(tools.size).toBe(5)
    await invoke("context", { action_id: action.id, node_id: "new" })
    await hooks.get("execute.before")({ ...call, input: { path: "same" } })
    await hooks.get("execute.after")({ ...call, status: "completed", result: { content: "older finishes first" } })
    await hooks.get("execute.after")({ ...call, status: "completed", result: { content: "newer finishes second" } })
    const ends = (await records()).items.filter((r: any) => r.data.call_id === "identical" && r.data.phase === "finished")
    expect(ends).toHaveLength(2)
    for (const end of ends) {
      expect(end.data.attribution).not.toBe("captured-at-start")
      expect(end.data.start_id).toBeUndefined()
      expect(end.action_id).toBeUndefined()
      expect(end.node_id).toBeUndefined()
    }
    expect((await invoke("agents", {})).evidence.pairing).toBe("degraded")
    expect((await invoke("context", {})).task.id).toBe("new")
    // Native execution callbacks remain usable; capture-off appends no diagnostics.
    await configure("off")
    const saved = (await records()).items
    await hooks.get("execute.before")({ ...call })
    await hooks.get("execute.after")({ ...call, status: "completed", result: { content: "off again" } })
    expect((await records()).items).toEqual(saved)
  } finally {
    inspection?.close()
    await cleanup?.()
    if (oldState === undefined) delete process.env.XDG_STATE_HOME; else process.env.XDG_STATE_HOME = oldState
    if (oldConfig === undefined) delete process.env.OPENCODE_CONFIG_DIR; else process.env.OPENCODE_CONFIG_DIR = oldConfig
    await rm(dir, { recursive: true, force: true })
  }
})
