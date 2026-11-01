import { expect, spyOn, test } from "bun:test"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import server from "../server.js"

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
      app: { version: "2.2.0" },
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
    app: { version: "2.2.0" },
    session: { hook: async () => { throw new Error("synthetic native hook unavailable") } },
    skill: { transform: async () => { optionalCalled = true } },
  }
  await expect((server as any).setup(ctx)).rejects.toThrow("synthetic native hook unavailable")
  expect(optionalCalled).toBe(false)
  // No plugin hook can protect a host that rejects hook registration or
  // never loads the plugin. Only host/provider-side no-paid enforcement can.
})
