import { mkdir, readFile, writeFile } from "node:fs/promises"
import { join } from "node:path"

// Real host tool execution with a controlled delay. Only signal files are
// fixtures; workflow transitions, hooks, grants and evidence remain Loom's.
export default {
  id: "lifecycleprobe",
  async setup(ctx: any) {
    const directory = join(ctx.location.directory, ".lifecycle-probe")
    await mkdir(directory, { recursive: true })
    await writeFile(join(directory, "setup"), "ready")
    const eventTrace: Array<{ type?: string; properties?: unknown; data?: unknown }> = []
    const toolCalls = new Map<string, {
      sessionID: string
      messageID?: string
      callID: string
      tool: string
      beforeObserved: boolean
      afterStatus?: string
    }>()
    const controller = new AbortController()
    const wait = async (name: string) => {
      const deadline = Date.now() + 25_000
      while (Date.now() < deadline) {
        try { return JSON.parse(await readFile(join(directory, name), "utf8")) }
        catch (error: any) { if (error.code !== "ENOENT") throw error }
        await Bun.sleep(25)
      }
      throw new Error(`Lifecycle host fixture timed out waiting for ${name}`)
    }
    await ctx.tool.transform((editor: any) => {
      editor.namespace({ name: "lifecycleprobe", description: "Local host lifecycle test controls." })
      const add = (
        name: string,
        execute: (_input: unknown, tool: any) => Promise<unknown>,
        codemode = true,
      ) => editor.add({
        name, description: `Lifecycle test ${name}`,
        input: { type: "object", properties: {}, additionalProperties: false },
        options: { namespace: "lifecycleprobe", codemode },
        execute: async (input: unknown, tool: any) => ({ content: JSON.stringify(await execute(input, tool)) }),
      })
      add("delayed", async (_input, tool) => {
        await writeFile(join(directory, "started"), JSON.stringify({ sessionID: tool.sessionID }))
        await wait("release")
        return { marker: "old-delayed-result" }
      })
      add("replacementGrant", async () => wait("grant"))
      add("attached", async (_input, tool) => {
        await writeFile(join(directory, "attached"), JSON.stringify({ sessionID: tool.sessionID }))
        return { marker: "attached" }
      })
      add("normal", async () => ({ marker: "new-normal-result" }))
      add("hostProbe", async (_input, tool) => {
        await writeFile(join(directory, "host-probe-started.json"), JSON.stringify({ sessionID: tool.sessionID }))
        await wait("host-probe-release")
        return { marker: "real-host-tool-completed" }
      }, false)
    })

    await ctx.tool.hook("execute.before", async (event: any) => {
      if (!String(event.tool ?? "").includes("lifecycleprobe")) return
      const callID = String(event.callID ?? event.id ?? "")
      if (!callID || typeof event.sessionID !== "string") return
      const key = `${event.sessionID}\0${callID}`
      toolCalls.set(key, {
        sessionID: event.sessionID,
        ...(typeof event.messageID === "string" ? { messageID: event.messageID } : {}),
        callID,
        tool: String(event.tool),
        beforeObserved: true,
      })
      await writeFile(join(directory, "hook-before.json"), JSON.stringify({
        sessionID: event.sessionID, callID, tool: event.tool, messageID: event.messageID,
      }))
    })
    await ctx.tool.hook("execute.after", async (event: any) => {
      const key = `${String(event.sessionID ?? "")}\0${String(event.callID ?? event.id ?? "")}`
      const call = toolCalls.get(key)
      if (call) {
        call.afterStatus = event.status
        await writeFile(join(directory, "hook-after.json"), JSON.stringify({
          sessionID: call.sessionID, callID: call.callID, tool: call.tool, status: event.status,
          rawCallID: event.callID, id: event.id, messageID: event.messageID,
        }))
      }
    })

    const eventConsumer = (async () => {
      for await (const event of ctx.event.subscribe({ signal: controller.signal })) {
        eventTrace.push({
          type: event?.type,
          properties: event?.properties,
          data: event?.data,
        })
        if (eventTrace.length > 300) eventTrace.shift()
        await writeFile(join(directory, "event-trace.json"), JSON.stringify(eventTrace))
        const properties = event?.properties ?? event?.data
        const exactToolTerminal = event?.type === "session.tool.success" || event?.type === "session.tool.failed"
        if (!exactToolTerminal && event?.type !== "session.idle") continue
        const sessionID = properties?.sessionID
        if (typeof sessionID !== "string") continue
        const eventCallID = exactToolTerminal
          ? String(properties.id ?? properties.callID ?? "")
          : undefined
        const candidates = [...toolCalls.values()].filter((call) =>
          call.sessionID === sessionID && (!eventCallID || call.callID === eventCallID),
        )
        if (candidates.length !== 1) {
          if (exactToolTerminal) {
            await writeFile(join(directory, "quiescence-debug.json"), JSON.stringify({
              eventType: event.type, sessionID, eventCallID, candidates,
            }))
          }
          continue
        }
        const call = candidates[0]
        const messages = await ctx.session.context({ sessionID })
        const matches = messages.flatMap((message: any) =>
          (message.parts ?? []).filter((part: any) =>
            part.type === "tool" && (part.callID ?? part.id) === call.callID && part.tool === call.tool &&
            (!call.messageID || (part.messageID ?? message.id) === call.messageID),
          ),
        )
        const state = matches.length === 1 ? matches[0].state?.status : undefined
        if (exactToolTerminal) {
          await writeFile(join(directory, "quiescence-debug.json"), JSON.stringify({
            eventType: event.type, sessionID, eventCallID, call, messages: messages.slice(-5).map((message: any) => ({
              id: message.id,
              parts: (message.parts ?? []).map((part: any) => ({
                type: part.type, tool: part.tool, callID: part.callID, messageID: part.messageID,
                state: part.state?.status,
              })),
            })), matches, state,
          }))
        }
        await writeFile(join(directory, `quiescence-${sessionID}.json`), JSON.stringify({
          eventType: event.type,
          sessionID,
          callID: call.callID,
          tool: call.tool,
          beforeObserved: call.beforeObserved,
          afterStatus: call.afterStatus,
          matchingToolParts: matches.length,
          persistedState: state,
          quiescent: matches.length === 1 && (state === "completed" || state === "error"),
        }))
      }
    })()
    return async () => {
      controller.abort()
      await eventConsumer
    }
  },
}
