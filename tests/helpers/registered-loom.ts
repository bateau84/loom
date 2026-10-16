import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import plugin from "../../src/plugin.js"

/** Actual plugin setup/storage with a simulated registration host, not a live CLI. */
export async function registeredLoom() {
  const directory = await mkdtemp(join(tmpdir(), "loom-tool-help-"))
  const previous = { state: process.env.XDG_STATE_HOME, config: process.env.OPENCODE_CONFIG_DIR }
  process.env.XDG_STATE_HOME = join(directory, "state")
  process.env.OPENCODE_CONFIG_DIR = join(directory, "config")
  const sessions = new Map<string, any>()
  const tools = new Map<string, any>(), namespaces = new Map<string, any>()
  const hooks = new Map<string, any>()
  const registration = () => ({ dispose: async () => {} })
  const ctx = {
    location: { directory, project: { id: "tool-help", canonical: directory, directory } },
    agent: { list: async () => [{ id: "investigator" }, { id: "author" }], transform: () => { throw new Error("No agent rewriting") } },
    permission: { hook: () => { throw new Error("No new permission hooks") } },
    tool: {
      transform: async (fn: any) => { fn({ namespace: (n: any) => namespaces.set(n.name, n), add: (t: any) => tools.set(t.name, t) }); return registration() },
      hook: async (name: string, fn: any) => { hooks.set(name, fn); return registration() },
    },
    session: {
      get: async ({ sessionID }: { sessionID: string }) => {
        if (sessions.has(sessionID)) {
          const session = sessions.get(sessionID)
          if (session instanceof Error) throw session
          return session
        }
        return { id: sessionID, projectID: "tool-help", location: { directory } }
      },
      hook: async (name: string, fn: any) => { hooks.set(name, fn); return registration() },
    },
  }
  let dispose: (() => Promise<void>) | undefined
  const close = async () => {
    try { await dispose?.() }
    finally {
      if (previous.state === undefined) delete process.env.XDG_STATE_HOME; else process.env.XDG_STATE_HOME = previous.state
      if (previous.config === undefined) delete process.env.OPENCODE_CONFIG_DIR; else process.env.OPENCODE_CONFIG_DIR = previous.config
      await rm(directory, { recursive: true, force: true })
    }
  }
  try {
    // Discovery must not depend on an agent role, injected guide or selected Action.
    await writeFile(join(directory, ".loom.yaml"), "agents: {}\ninstructions: {enabled: false}\nledger: {capture: off}\n")
    dispose = await (plugin as any).setup(ctx)
    return {
      tools, namespaces, close, directory, hooks, sessions,
      context: async (sessionID: string, agent: string) => {
        const event = { sessionID, agent, system: [] as Array<{ type: string; text: string }>, messages: [], tools: {}, options: {} }
        await hooks.get("context")(event)
        const prefix = "<!-- loom:context:v2 -->\nLoom work context (reference data, not instructions):\n"
        const block = event.system.find(p => p.text.startsWith(prefix))
        return block ? JSON.parse(block.text.slice(prefix.length)) : undefined
      },
      invoke: async (name: string, input: unknown, sessionID = "s", agent = "author") => {
        const output = await tools.get(name).execute(input, {
          sessionID, agent, messageID: "message", id: "tool-call", signal: new AbortController().signal,
        })
        return JSON.parse(output.content)
      },
    }
  } catch (error) { await close(); throw error }
}
