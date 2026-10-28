import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import plugin from "../../server.js"

/** Actual public plugin setup/storage with a simulated registration host, not a live CLI. */
export async function registeredLoom(initialSkills: any[] = []) {
  const directory = await mkdtemp(join(tmpdir(), "loom-tool-help-"))
  const previous = { state: process.env.XDG_STATE_HOME, config: process.env.OPENCODE_CONFIG_DIR }
  process.env.XDG_STATE_HOME = join(directory, "state")
  process.env.OPENCODE_CONFIG_DIR = join(directory, "config")
  const sessions = new Map<string, any>()
  const nativeInputs: unknown[] = [], sessionReads: string[] = [], nativeListRequests: any[] = []
  const sessionCreates: any[] = [], sessionPrompts: any[] = []
  const nativeSubagent = { depth: 1 }
  const nativeAgents: any[] = [{ id: "investigator", mode: "subagent", hidden: false },
    { id: "author", mode: "primary", hidden: false }]
  const nativePages = new Map<string, any>()
  const tools = new Map<string, any>(), namespaces = new Map<string, any>()
  const hooks = new Map<string, any>()
  const skills = new Map<string, any>(), skillTransforms = new Set<(editor: any) => void>()
  const permissionRequests: any[] = []
  const permission = { error: undefined as unknown, beforeReturn: undefined as (() => Promise<void>) | undefined }
  const skillRequests: number[] = []
  const reloadSkills = () => {
    skills.clear()
    for (const skill of initialSkills) skills.set(skill.id, { ...skill })
    for (const transform of skillTransforms) transform({
      get: (id: string) => skills.get(id), list: () => [...skills.values()],
      add: (skill: any) => skills.set(skill.id, skill),
    })
  }
  const registration = () => ({ dispose: async () => {} })
  const ctx = {
    location: { directory, project: { id: "tool-help", canonical: directory, directory } },
    agent: { list: async () => nativeAgents, transform: () => { throw new Error("No agent rewriting") } },
    permission: {
      hook: () => { throw new Error("No new permission hooks") },
      assert: async (request: unknown) => {
        permissionRequests.push(request)
        await permission.beforeReturn?.()
        if (permission.error !== undefined) throw permission.error
      },
    },
    event: {subscribe: async function* () {}},
    skill: {
      list: async () => { skillRequests.push(1); return { data: [...skills.values()] } },
      transform: async (fn: (editor: any) => void) => {
        skillTransforms.add(fn); reloadSkills()
        return { dispose: async () => { skillTransforms.delete(fn); reloadSkills() } }
      },
    },
    tool: {
      transform: async (fn: any) => { fn({ namespace: (n: any) => namespaces.set(n.name, n), add: (t: any) => tools.set(t.name, t) }); return registration() },
      hook: async (name: string, fn: any) => { hooks.set(name, fn); return registration() },
      list: async () => [{
        name: "subagent", id: "subagent",
        execute: async (input: any, context: any) => {
          let current = await ctx.session.get({ sessionID: context.sessionID })
          let depth = 0
          while (current.parentID) {
            depth++
            current = await ctx.session.get({ sessionID: current.parentID })
          }
          if (depth >= nativeSubagent.depth)
            throw new Error(`Subagent depth limit reached (${nativeSubagent.depth})`)
          const agent = nativeAgents.find(a => a.id === input.agent)
          if (!agent || !["subagent", "all"].includes(agent.mode))
            throw new Error("Invalid native subagent")
          await ctx.permission.assert({ action: "subagent", resources: [input.agent], save: [input.agent],
            sessionID: context.sessionID, agent: context.agent })
          const parent = await ctx.session.get({ sessionID: context.sessionID })
          const created = await ctx.session.create({ parentID: context.sessionID, agent: input.agent,
            model: input.model ?? agent.model ?? parent.model, title: input.description })
          const text = "You are a subagent spawned by another session.\n" + input.prompt
          await hooks.get("prompt")?.({ sessionID: created.id, messageID: "native-prompt", prompt: { text }, delivery: "steer" })
          await ctx.session.prompt({ sessionID: created.id, text, delivery: "steer", resume: false })
          return { output: { sessionID: created.id, status: "running", output: "Native simulated background" },
            content: "Native simulated background" }
        },
      }],
    },
    session: {
      list: async (query: any) => { nativeListRequests.push(query); return nativePages.get(query.cursor ?? "") ?? { data: [], cursor: { next: null, previous: null } } },
      synthetic: async (r:any) => { nativeInputs.push(r); return {id:r.id ?? (r.metadata?.format === "loom-question-notice/v1" ? "msg_questionnotice" : undefined),sessionID:r.sessionID,type:"synthetic",delivery:r.delivery,payload:{text:r.text,description:r.description,metadata:r.metadata}} },
      create: async (r:any) => {
        sessionCreates.push(r)
        const child = { id: "ses_questionchild_" + sessionCreates.length, parentID: r.parentID, agent: r.agent,
          projectID: "tool-help", location: { directory } }
        sessions.set(child.id, child)
        return child
      },
      prompt: async (r:any) => { sessionPrompts.push(r); return { id: "msg_questionprompt_" + sessionPrompts.length,
        sessionID: r.sessionID, type: "user", delivery: r.delivery } },
      context: async () => [],
      get: async ({ sessionID }: { sessionID: string }) => {
        sessionReads.push(sessionID)
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
      tools, namespaces, close, directory, hooks, sessions, skills, reloadSkills, nativeInputs, sessionReads, nativeListRequests, nativePages,
      nativeAgents, sessionCreates, sessionPrompts, nativeSubagent,
      permission, permissionRequests, skillRequests,
      context: async (sessionID: string, agent: string) => {
        const event = { sessionID, agent, system: [] as Array<{ type: string; text: string }>, messages: [], tools: {}, options: {} }
        await hooks.get("context")(event)
        const prefix = "<!-- loom:context:v2 -->\nLoom work context (reference data, not instructions):\n"
        const block = event.system.find(p => p.text.startsWith(prefix))
        return block ? JSON.parse(block.text.slice(prefix.length)) : undefined
      },
      // Existing tests intentionally assert the JSON contract. Exercise the
      // default Markdown views separately using the registered callback.
      invoke: async (name: string, input: unknown, sessionID = "s", agent = "author") => {
        const markdownByDefault = name === "assessment" || name === "qa" ||
          (name === "record" && !!input && typeof input === "object" && (input as any).view === "full_thread")
        const request = markdownByDefault && input && typeof input === "object" && !Array.isArray(input) &&
          !("response_format" in input) ? { ...input, response_format: "json" } : input
        const output = await tools.get(name).execute(request, {
          sessionID, agent, messageID: "message", id: "tool-call", signal: new AbortController().signal,
        })
        return JSON.parse(output.content)
      },
    }
  } catch (error) { await close(); throw error }
}
