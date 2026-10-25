import { test, expect, spyOn } from "bun:test"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import plugin from "../src/plugin.js"

/** Real Loom setup with the native model-request registration boundary
 * simulated. The installed-host tests separately prove OpenCode dispatch
 * executes this guard when the real plugin is otherwise unable to start.
 */
test("failed quota and Action ledger initialization retain a deny hook; valid disabled config retains native behavior", async () => {
  const previous = { state: process.env.XDG_STATE_HOME, config: process.env.OPENCODE_CONFIG_DIR }
  const logged = spyOn(console, "error").mockImplementation(() => {})
  try {
    for (const failure of ["quota-corrupt", "action-ledger"] as const) {
      const project = await mkdtemp(join(tmpdir(), "loom-routing-startup-"))
      try {
        const stateHome = join(project, "private-state")
        process.env.XDG_STATE_HOME = stateHome
        process.env.OPENCODE_CONFIG_DIR = join(project, "config")
        await writeFile(join(project, ".loom.yaml"), JSON.stringify({
          "model-routing": { enabled: true, "default-class": "strong", "paid-fallback": false },
          "model-classes": { strong: { models: ["sol"] } },
          agents: { architect: { roles: ["architecture"] } },
          roles: { architecture: { "model-class": "strong", reasoning: "medium" } },
        }))
        if (failure === "quota-corrupt") {
          const quotaDir = join(stateHome, "loom", "quota-v1")
          await mkdir(quotaDir, { recursive: true, mode: 0o700 })
          await writeFile(join(quotaDir, "subscriptions.sqlite"), "corrupt", { mode: 0o600 })
        } else {
          const dir = join(stateHome, "loom")
          await mkdir(dir, { recursive: true, mode: 0o700 })
          await writeFile(join(dir, "actions-v1"), "not-a-directory")
        }
        const hooks = new Set<(event: any) => unknown>()
        const ctx: any = {
          location: { directory: project, project: { id: "routing-startup",
            canonical: project, directory: project } },
          session: { hook: async (name: string, callback: (event: any) => unknown) => {
            expect(name).toBe("model.request")
            hooks.add(callback)
            return { dispose: async () => { hooks.delete(callback) } }
          } },
          model: { list: async () => ({ data: [] }) },
          provider: { list: async () => ({ data: [] }) },
          integration: { connection: { active: async () => undefined } },
        }
        const cleanup = await (plugin as any).setup(ctx) as () => Promise<void>
        expect(typeof cleanup).toBe("function")
        expect(hooks.size).toBe(1)
        const guard = [...hooks][0]
        expect(() => guard({ agent: "architect", model: { providerID: "route-metered", id: "sol" } }))
          .toThrow(/LOOM_MODEL_ROUTING_STARTUP_FAILED/)
        await cleanup()
        expect(hooks.size).toBe(0)
      } finally { await rm(project, { recursive: true, force: true }) }
    }
    // A genuinely disabled, parseable policy must not convert the pre-existing
    // ledger startup error into a hidden active plugin. Its guard is removed,
    // and OpenCode retains its prior native execution behavior.
    const project = await mkdtemp(join(tmpdir(), "loom-routing-disabled-failure-"))
    try {
      const stateHome = join(project, "private-state")
      process.env.XDG_STATE_HOME = stateHome
      process.env.OPENCODE_CONFIG_DIR = join(project, "config")
      await writeFile(join(project, ".loom.yaml"), "model-routing:\n  enabled: false\n")
      const root = join(stateHome, "loom")
      await mkdir(root, { recursive: true })
      await writeFile(join(root, "actions-v1"), "not-a-directory")
      const hooks = new Set<(event: any) => unknown>()
      const ctx: any = { location: { directory: project,
        project: { id: "routing-disabled", canonical: project, directory: project } },
        session: { hook: async (_name: string, callback: (event: any) => unknown) => {
          hooks.add(callback)
          return { dispose: async () => { hooks.delete(callback) } }
        } },
      }
      await expect((plugin as any).setup(ctx)).rejects.toThrow(/Loom startup failed/)
      expect(hooks.size).toBe(0)
    } finally { await rm(project, { recursive: true, force: true }) }
  } finally {
    logged.mockRestore()
    if (previous.state === undefined) delete process.env.XDG_STATE_HOME
    else process.env.XDG_STATE_HOME = previous.state
    if (previous.config === undefined) delete process.env.OPENCODE_CONFIG_DIR
    else process.env.OPENCODE_CONFIG_DIR = previous.config
  }
})
