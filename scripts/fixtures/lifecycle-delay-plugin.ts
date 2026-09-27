import { readFile, writeFile } from "node:fs/promises"
import { join } from "node:path"

// Real host tool execution with a controlled delay. Only signal files are
// fixtures; workflow transitions, hooks, grants and evidence remain Loom's.
export default {
  id: "lifecycleprobe",
  async setup(ctx: any) {
    const directory = join(ctx.location.directory, ".lifecycle-probe")
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
      const add = (name: string, execute: (_input: unknown, tool: any) => Promise<unknown>) => editor.add({
        name, description: `Lifecycle test ${name}`,
        input: { type: "object", properties: {}, additionalProperties: false },
        options: { namespace: "lifecycleprobe", codemode: true },
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
    })

    await ctx.tool.hook("execute.before", (event: any) => {
      if (!String(event.tool ?? "").includes("lifecycleprobe")) return
      const callID = String(event.callID ?? "")
      if (!callID || typeof event.sessionID !== "string") return
      const key = `${event.sessionID}\0${callID}`
      toolCalls.set(key, {
        sessionID: event.sessionID,
        ...(typeof event.messageID === "string" ? { messageID: event.messageID } : {}),
        callID,
        tool: String(event.tool),
        beforeObserved: true,
      })
    })
    await ctx.tool.hook("execute.after", (event: any) => {
      const key = `${String(event.sessionID ?? "")}\0${String(event.callID ?? "")}`
      const call = toolCalls.get(key)
      if (call) call.afterStatus = event.status
    })

    const eventConsumer = (async () => {
      for await (const event of ctx.event.subscribe({ signal: controller.signal })) {
        if (event?.type !== "session.idle") continue
        const sessionID = event.properties?.sessionID
        if (typeof sessionID !== "string") continue
        const candidates = [...toolCalls.values()].filter((call) => call.sessionID === sessionID)
        const call = candidates.at(-1)
        if (!call) continue
        const messages = await ctx.session.context({ sessionID })
        const matches = messages.flatMap((message: any) =>
          (message.parts ?? []).filter((part: any) =>
            part.type === "tool" && part.callID === call.callID && part.tool === call.tool &&
            (!call.messageID || (part.messageID ?? message.id) === call.messageID),
          ),
        )
        const state = matches.length === 1 ? matches[0].state?.status : undefined
        await writeFile(join(directory, `quiescence-${sessionID}.json`), JSON.stringify({
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
