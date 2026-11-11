import { expect, spyOn, test } from "bun:test"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import server from "../server.js"
import { digest } from "../src/model.js"

test("public entrypoint arms the native deny hook before optional registration failures", async () => {
  const root = await mkdtemp(join(tmpdir(), "loom-206-server-"))
  const previous = process.env.XDG_STATE_HOME
  const warnings = spyOn(console, "warn").mockImplementation(() => {})
  const errors = spyOn(console, "error").mockImplementation(() => {})
  const hooks = new Set<(event: unknown) => void>()
  const order: string[] = []
  try {
    process.env.XDG_STATE_HOME = join(root, "state")
    await mkdir(join(root, "state", "loom"), { recursive: true })
    // A real core startup failure causes it to retain the already-installed
    // fail-closed hook. This does not simulate a provider billing attestation.
    await writeFile(join(root, "state", "loom", "actions-v1"), "not-a-directory")
    await writeFile(join(root, ".loom.yaml"), JSON.stringify({
      "model-routing": { enabled: true, "default-class": "strong", "paid-fallback": false },
      "model-classes": { strong: { models: ["example"] } },
      agents: { architect: { roles: ["architecture"] } },
      roles: { architecture: { "model-class": "strong", reasoning: "medium" } },
    }))
    const ctx: any = {
      app: { version: "2.2.6" },
      location: { directory: root, project: { id: "qualification-206", canonical: root, directory: root } },
      session: { hook: async (name: string, callback: (event: unknown) => void) => {
        expect(name).toBe("model.request")
        order.push("native-deny-hook")
        hooks.add(callback)
        return { dispose: async () => { hooks.delete(callback) } }
      } },
      skill: { transform: async () => {
        order.push("optional-skill")
        expect(hooks.size).toBe(1)
        throw new Error("synthetic skill registration failed")
      } },
      tool: { transform: async () => {
        order.push("optional-review")
        expect(hooks.size).toBe(1)
        throw new Error("synthetic review registration failed")
      } },
    }
    const cleanup = await (server as any).setup(ctx) as () => Promise<void>
    expect(order).toEqual(["native-deny-hook", "optional-skill", "optional-review"])
    expect(hooks.size).toBe(1)
    expect(() => [...hooks][0]({ sessionID: "local", agent: "architect",
      model: { providerID: "paid-default", id: "example" }, kind: "primary" }))
      .toThrow(/LOOM_MODEL_ROUTING_STARTUP_FAILED/)
    expect(warnings.mock.calls.map(call => String(call[0]))).toEqual([
      expect.stringContaining("native skill registration unavailable"),
      expect.stringContaining("review companion registration unavailable"),
    ])
    await cleanup()
    expect(hooks.size).toBe(0)
  } finally {
    warnings.mockRestore()
    errors.mockRestore()
    if (previous === undefined) delete process.env.XDG_STATE_HOME
    else process.env.XDG_STATE_HOME = previous
    await rm(root, { recursive: true, force: true })
  }
})

test("missing native hook-registration capability is not misreported as guarded", async () => {
  let optionalCalled = false
  const ctx: any = {
    app: { version: "2.2.6" },
    session: { hook: async () => { throw new Error("synthetic native hook unavailable") } },
    skill: { transform: async () => { optionalCalled = true } },
  }
  await expect((server as any).setup(ctx)).rejects.toThrow("synthetic native hook unavailable")
  expect(optionalCalled).toBe(false)
  // No plugin hook can protect a host that rejects hook registration or
  // never loads the plugin. Only host/provider-side no-paid enforcement can.
})


/**
 * Healthy core with replayable native transforms, not a mocked core result.
 * A registry rebuild invokes the SAME callbacks that server.setup registered.
 * The installed 2.2.6 host test separately exercises native State.group.
 */
async function liveCoreFixture(options: { corruptLearning?: boolean } = {}) {
  const root = await mkdtemp(join(tmpdir(), "loom-206-replay-"))
  const previous = { state: process.env.XDG_STATE_HOME, config: process.env.OPENCODE_CONFIG_DIR }
  process.env.XDG_STATE_HOME = join(root, "private-state")
  process.env.OPENCODE_CONFIG_DIR = join(root, "private-config")
  if (options.corruptLearning) {
    const projectScope = digest({ project: "replay-206", canonical: root })
    await mkdir(join(root, "private-state", "loom", "actions-v1", projectScope, "learning.sqlite"), { recursive: true })
  }
  await writeFile(join(root, ".loom.yaml"), JSON.stringify({
    "model-routing": { enabled: true, "default-class": "strong", "paid-fallback": false },
    "model-classes": { strong: { models: ["example"] } },
    agents: { architect: { roles: ["architecture"] } },
    roles: { architecture: { "model-class": "strong", reasoning: "medium" } },
  }))
  const hooks = new Map<string, (event?: any) => void>()
  const modelRequestHooks = new Set<(event: unknown) => unknown>()
  const skills = new Map<string, unknown>()
  const tools = new Map<string, unknown>()
  const skillTransforms: Array<(editor: any) => void> = []
  const toolTransforms: Array<(editor: any) => void> = []
  const disposed: string[] = []
  let fault: "skill" | "review" | undefined
  let opaqueReviewError = false
  let coreDisposalError: Error | undefined
  let reviewDisposalError: Error | undefined
  let skillDisposalError: Error | undefined
  const skillEditor = () => ({
    get: (id: string) => {
      if (fault === "skill") throw new Error("REPLAY_SKILL_EDITOR_FAILURE")
      return skills.get(id)
    },
    add: (value: any) => skills.set(value.id, value),
  })
  const toolEditor = (owner: number) => ({
    add: (value: any) => {
      if (owner > 0 && fault === "review") {
        if (opaqueReviewError) throw Object.create(null)
        throw new Error("REPLAY_REVIEW_EDITOR_FAILURE")
      }
      tools.set(value.name, value)
    },
    namespace: () => {},
  })
  const ctx: any = {
    app: { version: "2.2.6" },
    location: { directory: root, project: { id: "replay-206", canonical: root, directory: root } },
    model: { list: async () => ({ data: [] }) },
    provider: { list: async () => ({ data: [] }) },
    integration: { connection: { active: async () => undefined } },
    session: { hook: async (name: string, fn: any) => {
      // OpenCode composes multiple handlers for the same native hook. A Map
      // keyed only by name incorrectly overwrites the core deny handler once
      // Session trial isolation also installs a model.request guard.
      if (name === "model.request") {
        modelRequestHooks.add(fn)
        hooks.set(name, (event: any) => {
          for (const callback of modelRequestHooks) callback(event)
        })
      } else hooks.set(name, fn)
      return { dispose: async () => {
        disposed.push("session:" + name)
        if (name === "model.request") {
          modelRequestHooks.delete(fn)
          if (modelRequestHooks.size === 0) hooks.delete(name)
        } else hooks.delete(name)
        if (name === "model.request" && coreDisposalError) throw coreDisposalError
      } }
    } },
    skill: { transform: async (fn: (editor: any) => void) => {
      skillTransforms.push(fn)
      fn(skillEditor())
      return { dispose: async () => {
        disposed.push("skill")
        if (skillDisposalError) throw skillDisposalError
        skillTransforms.splice(skillTransforms.indexOf(fn), 1)
      } }
    } },
    tool: {
      transform: async (fn: (editor: any) => void) => {
        const owner = toolTransforms.length
        toolTransforms.push(fn)
        fn(toolEditor(owner))
        return { dispose: async () => {
          disposed.push("tool:" + owner)
          if (owner > 0 && reviewDisposalError) throw reviewDisposalError
          toolTransforms.splice(toolTransforms.indexOf(fn), 1)
        } }
      },
      hook: async (name: string) => ({
        dispose: async () => { disposed.push("tool-hook:" + name) },
      }),
    },
  }
  let cleanup: (() => Promise<void>) | undefined
  try { cleanup = await (server as any).setup(ctx) as () => Promise<void> }
  catch (error) {
    if (previous.state === undefined) delete process.env.XDG_STATE_HOME
    else process.env.XDG_STATE_HOME = previous.state
    if (previous.config === undefined) delete process.env.OPENCODE_CONFIG_DIR
    else process.env.OPENCODE_CONFIG_DIR = previous.config
    await rm(root, { recursive: true, force: true })
    throw error
  }
  return {
    hooks, skills, tools, disposed,
    arm: (next: "skill" | "review") => { fault = next },
    useOpaqueReviewError: () => { opaqueReviewError = true },
    rebuild: () => {
      skills.clear()
      for (const apply of skillTransforms) apply(skillEditor())
      tools.clear()
      for (const [owner, apply] of toolTransforms.entries()) apply(toolEditor(owner))
    },
    setCleanupErrors: (errors: { core: Error; review: Error; skill: Error }) => {
      coreDisposalError = errors.core
      reviewDisposalError = errors.review
      skillDisposalError = errors.skill
    },
    shutdown: async () => {
      try { await cleanup?.() }
      finally {
        if (previous.state === undefined) delete process.env.XDG_STATE_HOME
        else process.env.XDG_STATE_HOME = previous.state
        if (previous.config === undefined) delete process.env.OPENCODE_CONFIG_DIR
        else process.env.OPENCODE_CONFIG_DIR = previous.config
        await rm(root, { recursive: true, force: true })
      }
    },
  }
}

for (const kind of ["skill", "review"] as const) {
  test("healthy core retains a deny hook when optional " + kind + " transform fails on deferred replay", async () => {
    const f = await liveCoreFixture()
    const warning = spyOn(console, "warn").mockImplementation(() => {})
    try {
      expect(f.hooks.has("model.request")).toBe(true)
      expect(f.skills.has("loom")).toBe(true)
      expect(f.tools.has("assessment")).toBe(true)
      expect(f.tools.has("qa")).toBe(true)
      // This is a deferred callback invocation after core succeeded.
      f.arm(kind)
      expect(() => f.rebuild()).not.toThrow()
      expect(() => f.hooks.get("model.request")!()).toThrow(/LOOM_MODEL_ROUTING_HOST_UNQUALIFIED/)
      expect(warning.mock.calls.some(call => String(call[0]).includes("Loom:"))).toBe(true)
    } finally {
      warning.mockRestore()
      await f.shutdown()
    }
    expect(f.hooks.has("model.request")).toBe(false)
  })
}

test("cleanup keeps the first core failure and still attempts review and skill cleanup", async () => {
  const f = await liveCoreFixture()
  const warning = spyOn(console, "warn").mockImplementation(() => {})
  const core = new Error("PRIMARY_CORE_CLEANUP_FAILURE")
  const review = new Error("SECONDARY_REVIEW_CLEANUP_FAILURE")
  const skill = new Error("SECONDARY_SKILL_CLEANUP_FAILURE")
  f.setCleanupErrors({ core, review, skill })
  try {
    await expect(f.shutdown()).rejects.toBe(core)
    expect(f.disposed).toContain("tool:1")
    expect(f.disposed).toContain("skill")
    expect(warning.mock.calls.map(call => String(call[0])).join(" ")).toContain("secondary cleanup failure")
  } finally {
    warning.mockRestore()
  }
})


test("replay diagnostics that cannot be stringified or logged do not disable core guard", async () => {
  const f = await liveCoreFixture()
  const logger = spyOn(console, "warn").mockImplementation(() => {
    throw new Error("SYNTHETIC_LOGGER_FAILURE")
  })
  try {
    f.arm("review")
    f.useOpaqueReviewError()
    // A callback must not propagate even a hostile thrown value or a logger failure.
    expect(() => f.rebuild()).not.toThrow()
    expect(() => f.hooks.get("model.request")!()).toThrow(/LOOM_MODEL_ROUTING_HOST_UNQUALIFIED/)
  } finally {
    logger.mockRestore()
    await f.shutdown()
  }
})

test("throwing optional learning warning preserves healthy Action tools and installed routing denial", async () => {
  const logger = spyOn(console, "warn").mockImplementation(() => {
    throw new Error("FAULT_INJECTED_WARNING_SINK")
  })
  let f: Awaited<ReturnType<typeof liveCoreFixture>> | undefined
  try {
    f = await liveCoreFixture({ corruptLearning: true })
    expect(f.tools.has("action")).toBe(true)
    expect(f.tools.has("insights")).toBe(true)
    expect(f.hooks.has("model.request")).toBe(true)
    expect(() => f!.hooks.get("model.request")!()).toThrow(/LOOM_MODEL_ROUTING_HOST_UNQUALIFIED/)
  } finally {
    logger.mockRestore()
    await f?.shutdown()
  }
})

test("throwing startup error sink cannot unload an installed native deny guard", async () => {
  const root = await mkdtemp(join(tmpdir(), "loom-206-diagnostic-"))
  const previous = process.env.XDG_STATE_HOME
  const logger = spyOn(console, "error").mockImplementation(() => {
    throw new Error("FAULT_INJECTED_ERROR_SINK")
  })
  const hooks = new Set<() => void>()
  try {
    process.env.XDG_STATE_HOME = join(root, "state")
    await mkdir(join(root, "state", "loom"), { recursive: true })
    await writeFile(join(root, "state", "loom", "actions-v1"), "not-a-directory")
    await writeFile(join(root, ".loom.yaml"), JSON.stringify({
      "model-routing": { enabled: true, "default-class": "strong", "paid-fallback": false },
      "model-classes": { strong: { models: ["example"] } },
      agents: { architect: { roles: ["architecture"] } },
      roles: { architecture: { "model-class": "strong", reasoning: "medium" } },
    }))
    const ctx: any = {
      app: { version: "2.2.6" },
      location: { directory: root, project: { id: "diagnostic-206", canonical: root, directory: root } },
      session: { hook: async (_name: string, fn: () => void) => {
        hooks.add(fn)
        return { dispose: async () => { hooks.delete(fn) } }
      } },
      skill: { transform: async () => { throw new Error("optional skill unavailable") } },
      tool: { transform: async () => { throw new Error("optional tools unavailable") } },
    }
    const cleanup = await (server as any).setup(ctx) as () => Promise<void>
    expect(logger).toHaveBeenCalled()
    expect(hooks.size).toBe(1)
    expect(() => [...hooks][0]!()).toThrow(/LOOM_MODEL_ROUTING_STARTUP_FAILED/)
    await cleanup()
    expect(hooks.size).toBe(0)
  } finally {
    logger.mockRestore()
    if (previous === undefined) delete process.env.XDG_STATE_HOME
    else process.env.XDG_STATE_HOME = previous
    await rm(root, { recursive: true, force: true })
  }
})
