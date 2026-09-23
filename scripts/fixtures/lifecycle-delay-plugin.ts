import { readFile, writeFile } from "node:fs/promises"
import { join } from "node:path"

// Real host tool execution with a controlled delay. Only signal files are
// fixtures; workflow transitions, hooks, grants and evidence remain Loom's.
export default {
  id: "lifecycleprobe",
  async setup(ctx: any) {
    const directory = join(ctx.location.directory, ".lifecycle-probe")
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
  },
}
