/** Disposable public-interface bridge for fresh-agent usability exercises.
 * The participant receives only /start, /skill, /tools/<name> and /call.
 * Real plugin callbacks and stores; simulated native registration/permission host.
 * No production sources, native dispatch, models or private account state.
 *
 * LOOM_USABILITY_SOURCE_ROOT=/exact/checkout bun tests/tool-usability-reader.ts OUT [established|missing]
 */
import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { execFileSync } from "node:child_process"
import { mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises"
import { join, resolve } from "node:path"
import { pathToFileURL } from "node:url"

const output = resolve(process.argv[2] ?? "")
assert.ok(process.argv[2], "Supply a fresh report directory outside the repository")
const root = resolve(process.env.LOOM_USABILITY_SOURCE_ROOT ?? process.cwd())
const mode = process.argv[3] ?? "established"
assert.ok(["established", "missing"].includes(mode))
await mkdir(output, { recursive: false })
await mkdir(join(output, "responses"))
const transport = join(output, "transport")
await mkdir(transport)
await mkdir(join(transport, "inbox"))
await mkdir(join(transport, "outbox"))
const fixtures = await import(pathToFileURL(join(root, "tests/helpers/engineering-trajectory-fixture.ts")).href)
const fixture = mode === "established"
  ? await fixtures.engineeringTrajectoryFixture({ directory: join(output, "state"), records: 240 })
  : await fixtures.unplannedEngineeringTrajectoryFixture({ directory: join(output, "state"), records: 240, mode: "sparse" })
const host = fixture.f
const originalRows = new Map((fixture.db.query("SELECT id,data FROM ledger ORDER BY seq").all() as Array<{id: string; data: string}>)
  .map(row => [row.id, row.data]))
const permitted: Record<string, readonly string[]> = {
  history: ["read", "preview-population", "population", "population-source"],
  record: ["query"], objective: ["find", "read", "list", ...(mode === "missing" ? ["create", "link"] : [])],
  review: ["read", "work", "freeze-population"], plan: ["read"], action: ["list", "sessions"],
}
const sha = (value: string | Buffer) => createHash("sha256").update(value).digest("hex")
const sourcePaths = (await readdir(join(root, "src"), { recursive: true })).filter(path => path.endsWith(".ts") || path.endsWith("SKILL.md"))
const sourceHashes = Object.fromEntries(await Promise.all(sourcePaths.sort().map(async path => ["src/" + path, sha(await readFile(join(root, "src", path)))])))
type Step = { index: number; kind: "help" | "skill" | "tool"; name: string; input?: unknown; bytes: number; elapsed_ms: number; failed: boolean; response_sha256: string }
const report = { format: "loom-tool-usability/v1", source_head: execFileSync("git", ["-C", root, "rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
  source_sha256: sourceHashes, mode, fixture_records: fixture.totalRecords,
  qualification: fixture.setupQualification,
  bridge_sha256: sha(await readFile(import.meta.path)),
  steps: [] as Step[], source_originals_unchanged: null as boolean | null, cleanup: false }
const save = () => writeFile(join(output, "report.json"), JSON.stringify(report, null, 2) + "\n")
async function measured(kind: Step["kind"], name: string, input: unknown, callback: () => Promise<string>) {
  const start = Date.now()
  let content: string, failed = false
  try { content = await callback() }
  catch (error) { failed = true; content = JSON.stringify({ error: error instanceof Error ? error.message : String(error) }) }
  const index = report.steps.length + 1
  report.steps.push({ index, kind, name, ...(input === undefined ? {} : { input }), bytes: Buffer.byteLength(content, "utf8"),
    elapsed_ms: Date.now() - start, failed, response_sha256: sha(content) })
  await writeFile(join(output, "responses", String(index).padStart(3, "0") + ".txt"), content)
  await save()
  return new Response(content, { status: failed ? 422 : 200 })
}
async function handle(request: Request): Promise<Response> {
  const url = new URL(request.url)
  if (request.method === "GET" && url.pathname === "/start") return Response.json({
    action_id: fixture.action.id, question: fixture.question,
    qualification: "Synthetic history in an isolated store. Current reader owns the available review requests. Native source bodies and Evaluator execution are outside this exercise.",
    catalog: [...host.tools].map(([name, tool]: [string, any]) => ({ name: "loom_" + name, summary: tool.description.split("\n")[0] })),
    usage: "GET /skill for the bundled guide; GET /tools/<short-name> for registered tool description and JSON schema. POST /call with {tool:<short-name>,input:<arguments>}. Only the task-authorized listed operations may be used; returned tool requests retain their actual syntax.",
    permitted_operations: permitted,
  })
  if (request.method === "GET" && url.pathname === "/skill")
    return measured("skill", "loom", undefined, () => readFile(join(root, "src/skills/loom/SKILL.md"), "utf8"))
  if (request.method === "GET" && url.pathname.startsWith("/tools/")) {
    const name = url.pathname.slice(7), tool = host.tools.get(name)
    if (!tool) return new Response("Unknown tool", { status: 404 })
    return measured("help", name, undefined, async () => JSON.stringify({ name: "loom_" + name, description: tool.description, input: tool.input }))
  }
  if (request.method !== "POST" || url.pathname !== "/call") return new Response("Not found", { status: 404 })
  const raw = await request.text()
  if (Buffer.byteLength(raw) > 64000) return new Response("Request too large", { status: 413 })
  const body = JSON.parse(raw)
  if (typeof body?.tool !== "string" || !body.input || typeof body.input !== "object" || Array.isArray(body.input))
    return new Response("Expected {tool,input}", { status: 400 })
  const allowed = permitted[body.tool]
  if (!allowed || body.input.operation !== undefined && !allowed.includes(body.input.operation))
    return new Response("This isolated exercise does not authorize that operation", { status: 403 })
  // Missing operation intentionally reaches the real callback for recovery tests.
  return measured("tool", body.tool, body.input, async () => {
    const result = await host.tools.get(body.tool).execute(body.input, { sessionID: fixture.sessions.reader, agent: "author",
      messageID: "usability-reader", id: "usability-" + (report.steps.length + 1), signal: request.signal })
    assert.equal(typeof result.content, "string")
    return result.content
  })
}

// The existing file transport also works where executor localhost is isolated.
const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: handle })
const address = `http://127.0.0.1:${server.port}`
await writeFile(join(output, "bridge.json"), JSON.stringify({ address, transport, pid: process.pid }) + "\n")
await save()
console.log(JSON.stringify({ address, transport }))
let stopped = false, processing = false
const processed = new Set<string>()
const timer = setInterval(async () => {
  if (processing || stopped) return
  processing = true
  try {
    if (await Bun.file(join(output, "STOP")).exists()) { await stop(); return }
    for (const name of (await readdir(join(transport, "inbox"))).sort()) {
      if (!/^[a-zA-Z0-9_-]+\.json$/.test(name) || processed.has(name)) continue
      let response: Response
      try {
        const envelope = await readFile(join(transport, "inbox", name), "utf8")
        if (Buffer.byteLength(envelope) > 100000) throw new Error("Request envelope too large")
        const input = JSON.parse(envelope)
        if (!["GET", "POST"].includes(input.method) || typeof input.path !== "string") throw new Error("Invalid request envelope")
        response = await handle(new Request(address + input.path, { method: input.method,
          ...(input.method === "POST" ? { body: JSON.stringify(input.body) } : {}) }))
      } catch (error) { response = new Response(JSON.stringify({ transport_error: String(error) }), { status: 400 }) }
      const destination = join(transport, "outbox", name)
      await writeFile(destination + ".tmp", JSON.stringify({ status: response.status, content: await response.text() }))
      await rename(destination + ".tmp", destination)
      processed.add(name)
    }
  } finally { processing = false }
}, 50)
async function stop() {
  if (stopped) return
  stopped = true
  clearInterval(timer)
  server.stop(true)
  const rows = fixture.db.query("SELECT id,data FROM ledger ORDER BY seq").all() as Array<{id: string; data: string}>
  report.source_originals_unchanged = rows.length === originalRows.size && rows.every(row => originalRows.get(row.id) === row.data)
  try { await fixture.close() }
  finally { await rm(join(output, "state"), { recursive: true, force: true }); report.cleanup = true; await save() }
}
process.once("SIGTERM", () => { void stop() })
process.once("SIGINT", () => { void stop() })
