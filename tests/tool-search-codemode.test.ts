import { test, expect } from "bun:test"
import { createRequire } from "node:module"
import { readFile } from "node:fs/promises"
import { join } from "node:path"
import { pathToFileURL } from "node:url"
import { registeredLoom } from "./helpers/registered-loom.js"

// Isolated exact upstream test dependency; not a new Loom runtime dependency.
const root = process.env.LOOM_CODEMODE_ROOT
if (!root) throw new Error("Set LOOM_CODEMODE_ROOT to an isolated npm prefix containing @opencode/codemode@2.0.29; see docs/tool-discovery.md")
const packageRoot = join(root, "node_modules/@opencode/codemode")
const metadata = JSON.parse(await readFile(join(packageRoot, "package.json"), "utf8"))
if (metadata.version !== "2.0.29") throw new Error(`Expected Code Mode 2.0.29, found ${metadata.version}`)
// Test the published compiled implementation, not the source-manifest export.
// The pinned build emits src/index.ts to dist/index.js; a missing build is fatal.
const entry = join(packageRoot, "dist/index.js")
const { CodeMode, Namespace, Tool, toolError } = await import(pathToFileURL(entry).href)
const effectReq = createRequire(entry)
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

test("Plan search carries the field guide and complete three-task example, not just a signature", async () => {
  await withSearch(async (search, f) => {
    const result = await search({ query: "tools.loom.plan" })
    expect(result.items).toHaveLength(1)
    const help = result.items[0].description
    expect(help).toBe(f.tools.get("plan").description)
    for (const text of ["Plan is not a scheduler", "Nodes are a flat list", "criteria: list of observable completion conditions", "siblings do not automatically depend on each other", "Action and Plan revisions are separate", "whole current list, not a patch", "ledger remembers what was found or done"]) expect(help).toContain(text)
    const examples = help.split("\n").filter((s: string) => s.startsWith("{")).map((s: string) => JSON.parse(s))
    const save = examples.find((e: any) => e.operation === "save")
    expect(save.expected_revision).toBe(0)
    expect(save.nodes).toHaveLength(3)
    expect(save.nodes[1].depends_on).toEqual([save.nodes[0].id])
    expect(save.nodes[2].depends_on).toEqual([save.nodes[1].id])
    const discovery = await search({ namespace: "loom", query: "acceptance criteria intended work", limit: 5 })
    expect(discovery.items.some((item: any) => item.path === "tools.loom.plan" && item.description === help)).toBe(true)
  })
})


test("actual Code Mode allSettled preserves an independent write and exposes the failed write", async () => {
  const f = await registeredLoom()
  try {
    const action = (await f.invoke("action", { operation: "create", title: "Independent calls", goal: "Keep successful work visible" })).result
    const tools = Object.fromEntries([...f.tools].map(([name, tool]) => [name, Tool.make({
      description: tool.description, input: tool.input, output: { type: "string" },
      execute: (input: unknown) => Effect.tryPromise({
        try: async () => JSON.stringify(await f.invoke(name, input)),
        catch: (error: unknown) => toolError(error instanceof Error ? error.message : String(error)),
      }),
    })]))
    const runtime = CodeMode.make({ tools: { loom: Namespace.make({ description: f.namespaces.get("loom").description, tools }) } })
    const bad = { operation: "add", action_id: "missing-action", kind: "result", statement: "This must not be saved" }
    const good = { operation: "add", action_id: action.id, kind: "result", statement: "Successful independent work remains available" }
    const result = await Effect.runPromise(runtime.execute(`
      const outcomes = await Promise.allSettled([
        tools.loom.record(${JSON.stringify(bad)}),
        tools.loom.record(${JSON.stringify(good)})
      ]);
      return outcomes.map(outcome => outcome.status === "fulfilled"
        ? {status: outcome.status, record_id: JSON.parse(outcome.value).result.id}
        : {status: outcome.status});
    `))
    expect(result.ok).toBe(true)
    expect(result.value[0].status).toBe("rejected")
    expect(result.value[1].status).toBe("fulfilled")
    const saved = (await f.invoke("record", { operation: "query", action_id: action.id })).result.items
    expect(saved).toHaveLength(1)
    expect(saved[0].id).toBe(result.value[1].record_id)
    expect(saved[0].data.statement).toBe(good.statement)
  } finally { await f.close() }
})
