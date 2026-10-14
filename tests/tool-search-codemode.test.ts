import { test, expect } from "bun:test"
import { createRequire } from "node:module"
import { readFile } from "node:fs/promises"
import { join } from "node:path"
import { pathToFileURL } from "node:url"
import { registeredLoom } from "./helpers/registered-loom.js"

// Isolated exact upstream test dependency; not a new Loom runtime dependency.
const root = process.env.LOOM_CODEMODE_ROOT
if (!root) throw new Error("Set LOOM_CODEMODE_ROOT to an isolated npm prefix containing @opencode/codemode@2.0.18; see docs/tool-discovery.md")
const req = createRequire(join(root, "package.json"))
const metadata = JSON.parse(await readFile(join(root, "node_modules/@opencode/codemode/package.json"), "utf8"))
if (metadata.version !== "2.0.18") throw new Error(`Expected Code Mode 2.0.18, found ${metadata.version}`)
const { CodeMode, Namespace, Tool } = await import(pathToFileURL(req.resolve("@opencode/codemode")).href)
const effectReq = createRequire(req.resolve("@opencode/codemode"))
const { Effect } = await import(pathToFileURL(effectReq.resolve("effect")).href)

async function withSearch(run: (search: (input: unknown) => Promise<any>, f: Awaited<ReturnType<typeof registeredLoom>>) => Promise<void>) {
  const f = await registeredLoom()
  try {
    const tools = Object.fromEntries([...f.tools].map(([name, tool]) => [name, Tool.make({
      description: tool.description, input: tool.input, output: { type: "string" },
      execute: () => Effect.die(new Error("Discovery must not execute a Loom tool")),
    })]))
    // This is the actual pinned search implementation, fed registrations from the
    // real plugin. Host registration is simulated; no model or live CLI is used.
    const runtime = CodeMode.make({ tools: { loom: Namespace.make({ description: f.namespaces.get("loom").description, tools }) } })
    const search = async (input: unknown) => {
      const result = await Effect.runPromise(runtime.execute(`return await search(${JSON.stringify(input)})`))
      expect(result.ok).toBe(true)
      expect(result.truncated).not.toBe(true)
      expect(result.toolCalls).toEqual([{ name: "search" }])
      return result.value
    }
    await run(search, f)
  } finally { await f.close() }
}

test("actual Code Mode search returns each full registered description and callable signature", async () => {
  await withSearch(async (search, f) => {
    for (const [name, registration] of f.tools) {
      const result = await search({ query: `tools.loom.${name}` })
      expect(result.items).toHaveLength(1)
      expect(result.items[0].path).toBe(`tools.loom.${name}`)
      expect(result.items[0].description).toBe(registration.description)
      expect(result.items[0].signature).toContain(`tools.loom.${name}(`)
      for (const key of Object.keys(registration.input.properties)) expect(result.items[0].signature).toContain(key)
    }
  })
})

test("namespace search carries all five manuals without file reads, selected work or injected roles", async () => {
  await withSearch(async (search, f) => {
    const result = await search({ namespace: "loom", limit: 5 })
    expect(result.items).toHaveLength(5)
    expect(result.remaining).toBe(0)
    for (const item of result.items) {
      const name = item.path.split(".").at(-1)
      expect(item.description).toBe(f.tools.get(name).description)
      expect(item.description).toContain("Examples (JSON inputs")
    }
  })
})

test("task-language discovery finds record and recovery help, including the dependency filter warning", async () => {
  await withSearch(async search => {
    const records = await search({ namespace: "loom", query: "dependency history QA", limit: 5 })
    const record = records.items.find((item: any) => item.path === "tools.loom.record")
    expect(record?.description).toContain("explicit action_id without node_id searches the whole Action")
    const recovery = await search({ namespace: "loom", query: "recover handoff restart", limit: 5 })
    expect(recovery.items.some((item: any) => item.path === "tools.loom.context" && item.description.includes("task-not-in-current-plan"))).toBe(true)
  })
})
