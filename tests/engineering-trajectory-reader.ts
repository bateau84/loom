/** Bridge for a controlled unfamiliar investigator. The participant receives
 * only /start, /tools/<name> and /read; setup/source/oracle files are withheld.
 * LOOM_TRAJECTORY_MODE=sparse adds separately measured retrospective authoring
 * through /phase and /write. This is not a production service or workflow.
 *
 * bun tests/engineering-trajectory-reader.ts FRESH_REPORT_DIRECTORY [ROWS]
 * Optional LOOM_TRAJECTORY_BASELINE_ROOT selects exact main d0ff85e callbacks
 * over the same seeded synthetic stores, for a separate baseline investigation.
 */
import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { execFileSync } from "node:child_process"
import { mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises"
import { join, resolve } from "node:path"
import { pathToFileURL } from "node:url"
import { engineeringTrajectoryFixture, unplannedEngineeringTrajectoryFixture } from "./helpers/engineering-trajectory-fixture.js"
import type { registeredLoom } from "./helpers/registered-loom.js"

assert.ok(process.argv[2], "Supply a fresh report directory outside the repository")
const output = resolve(process.argv[2]!)
await mkdir(output, { recursive: false })
await mkdir(join(output, "responses"))
const transport = join(output, "transport")
await mkdir(transport)
await mkdir(join(transport, "inbox"))
await mkdir(join(transport, "outbox"))
const mode = process.env.LOOM_TRAJECTORY_MODE ?? "established"
assert.ok(["established", "sparse", "connected"].includes(mode), "Unknown trajectory qualification mode")
const fixtureOptions = { directory: join(output, "state"), records: Number(process.argv[3] ?? 24000) }
const fixture = mode === "established" ? await engineeringTrajectoryFixture(fixtureOptions)
  : await unplannedEngineeringTrajectoryFixture({ ...fixtureOptions, mode: mode === "sparse" ? "sparse" : "connected" })
const originalSourceBytes = new Map((fixture.db.query("SELECT id,data FROM ledger ORDER BY seq").all() as Array<{ id: string; data: string }>).map(row => [row.id, row.data]))
let baseline: Awaited<ReturnType<typeof registeredLoom>> | undefined
let sourceRoot = process.cwd()
if (process.env.LOOM_TRAJECTORY_BASELINE_ROOT) {
  const root = resolve(process.env.LOOM_TRAJECTORY_BASELINE_ROOT)
  assert.equal(execFileSync("git", ["-C", root, "rev-parse", "HEAD"], { encoding: "utf8" }).trim(), "d0ff85ee09e5209058206a594f44338e088f3c10")
  execFileSync("git", ["-C", root, "diff", "--exit-code", "HEAD", "--", "src", "tests/helpers/registered-loom.ts"], { stdio: "pipe" })
  sourceRoot = root
  const module = await import(pathToFileURL(join(root, "tests/helpers/registered-loom.ts")).href)
  baseline = await module.registeredLoom([], { directory: fixture.directory, beforeSetup: async (directory: string) => {
    await writeFile(join(directory, ".loom.yaml"), "agents: {}\ninstructions: {enabled: false}\nledger: {capture: automatic}\n")
  } })
}
const host = baseline ?? fixture.f
const allowed: Record<string, readonly string[]> = { history: ["read"], record: ["query"], objective: ["find", "read", "list"],
  review: ["read", "work", "issue"], plan: ["read"], action: ["read", "list"] }
const writes: Record<string, readonly string[]> = mode === "sparse" && !baseline ? { objective: ["create", "link"] } : {}
type Phase = "discovery" | "association" | "navigation"
let phase: Phase = mode === "sparse" ? "discovery" : "navigation"
const head = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim()
const hashes = async (root: string, paths: string[]) => Object.fromEntries(await Promise.all(paths.sort().map(async path =>
  [path, createHash("sha256").update(await readFile(join(root, path))).digest("hex")])))
const sourcePaths = (await readdir(join(sourceRoot, "src"), { recursive: true })).filter(path => path.endsWith(".ts")).map(path => "src/" + path)
const source_sha256 = await hashes(sourceRoot, [...sourcePaths, "tests/helpers/registered-loom.ts"])
const qualification_sha256 = await hashes(process.cwd(), ["tests/helpers/engineering-trajectory-fixture.ts", "tests/engineering-trajectory-reader.ts", "tests/engineering-trajectory-reader-client.py"])
const report = { format: "loom-unfamiliar-trajectory-investigation/v1", source_head: head,
  source_sha256, qualification_sha256,
  route: baseline ? "exact-main-baseline" : "candidate", baseline_head: baseline ? "d0ff85ee09e5209058206a594f44338e088f3c10" : null,
  action_id: fixture.action.id, question: fixture.question, fixture_records: fixture.totalRecords, fixture_mode: mode,
  initial_associations: mode === "sparse" ? { objectives: 0, reviews: 0 } : "authored during fixture setup",
  qualification: fixture.setupQualification, calls: 0, response_bytes: 0, callback_elapsed_ms: 0,
  write_calls: 0, write_request_bytes: 0, write_response_bytes: 0, write_callback_elapsed_ms: 0,
  write_steps: [] as Array<Record<string, unknown>>,
  phase_transitions: [{ phase, after_reads: 0, after_writes: 0, after_help: 0 }] as Array<{ phase: Phase; after_reads: number; after_writes: number; after_help: number }>,
  discovery_calls: 0, discovery_response_bytes: 0, discovery_steps: [] as Array<Record<string, unknown>>,
  steps: [] as Array<Record<string, unknown>>, tracked_source_originals: originalSourceBytes.size,
  source_originals_unchanged: null as boolean | null, cleanup: false }
const save = () => writeFile(join(output, "report.json"), JSON.stringify(report, null, 2) + "\n")
let queue: Promise<void> = Promise.resolve()
async function handle(request: Request) {
  const url = new URL(request.url)
  if (request.method === "GET" && url.pathname === "/start") return Response.json({ action_id: fixture.action.id,
    question: fixture.question, qualification: "Controlled synthetic history. Tools execute in the existing review requester's authorized Session. No private operator originals or native review execution are available.",
    tools: Object.keys(allowed), phase,
    instructions: "GET /tools/<name> for actual registered help/schema. POST /read with {tool,input}. No IDs other than the Action are supplied.",
    ...(mode === "sparse" ? { retrospective: Object.keys(writes).length ?
      "Begin by investigating the existing originals. When ready, POST /phase {phase:'association'}; /write permits only actual objective create/link operations. Associations must be attributed retrospective interpretations, not invented native provenance or historical review membership. POST /phase {phase:'navigation'} ends authoring. Reads, writes and help are measured by phase; original ledger records remain immutable."
      : "This baseline route permits discovery reads only; it does not author candidate-only typed associations." } : {}) })
  if (request.method === "GET" && url.pathname.startsWith("/tools/")) {
    const name = url.pathname.slice("/tools/".length)
    if (!allowed[name]) return new Response("Unknown reader", { status: 404 })
    const index = ++report.discovery_calls
    const tool = host.tools.get(name)
    const content = JSON.stringify({ name: "loom_" + name, description: tool.description, input: tool.input, allowed_operations: allowed[name],
      ...(writes[name] ? { retrospective_authoring_operations: writes[name], authoring_phase: "association" } : {}) })
    const bytes = Buffer.byteLength(content, "utf8")
    report.discovery_response_bytes += bytes
    report.discovery_steps.push({ index, phase, tool: name, bytes, response_sha256: createHash("sha256").update(content).digest("hex") })
    await writeFile(join(output, "responses", `help-${String(index).padStart(3, "0")}.json`), content)
    await save()
    return new Response(content, { headers: { "content-type": "application/json; charset=utf-8" } })
  }
  if (request.method !== "POST" || !["/read", "/write", "/phase"].includes(url.pathname)) return new Response("Not found", { status: 404 })
  const text = await request.text()
  if (Buffer.byteLength(text) > 64000) return new Response("Reader request too large", { status: 413 })
  let parsed: unknown
  try { parsed = JSON.parse(text) } catch { return new Response("Invalid JSON", { status: 400 }) }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return new Response("Expected request object", { status: 400 })
  if (url.pathname === "/phase") {
    const next = "phase" in parsed ? parsed.phase : undefined
    await queue
    if (!Object.keys(writes).length || !(phase === "discovery" && next === "association" || phase === "association" && next === "navigation"))
      return new Response("Only discovery → association → navigation is permitted on the sparse candidate route", { status: 403 })
    phase = next
    report.phase_transitions.push({ phase, after_reads: report.calls, after_writes: report.write_calls, after_help: report.discovery_calls })
    await save()
    return Response.json({ phase, note: "This measurement boundary does not alter any evidence or source permissions." })
  }
  if (!("tool" in parsed) || typeof parsed.tool !== "string" || !("input" in parsed) || !parsed.input || typeof parsed.input !== "object" || Array.isArray(parsed.input))
    return new Response("Expected {tool,input}", { status: 400 })
  const body = { tool: parsed.tool, input: parsed.input as Record<string, unknown> }
  const writing = url.pathname === "/write"
  if (!(writing ? phase === "association" && writes[body.tool]?.includes(String(body.input.operation))
    : allowed[body.tool]?.includes(String(body.input.operation))))
    return new Response("Only the advertised operations in their measured phase are permitted", { status: 403 })
  const previous = queue
  let release!: () => void
  queue = new Promise<void>(resolve => { release = resolve })
  await previous
  try {
    if (writing && phase !== "association") return new Response("Retrospective authoring has ended", { status: 403 })
    const index = writing ? ++report.write_calls : ++report.calls, started = performance.now(), measuredPhase = phase
    let content: string, callbackError = false
    try {
      const result = await host.tools.get(body.tool).execute(body.input, { sessionID: fixture.sessions.reader, agent: "author",
        messageID: "unfamiliar-reader", id: `unfamiliar-${writing ? "write" : "read"}-${index}`, signal: request.signal })
      assert.equal(typeof result.content, "string"); content = result.content
    } catch (error) { callbackError = true; content = JSON.stringify({ callback_error: String(error) }) }
    const elapsed_ms = performance.now() - started, bytes = Buffer.byteLength(content, "utf8")
    const step = { index, phase: measuredPhase, tool: body.tool, input: body.input, bytes, elapsed_ms, callback_error: callbackError,
      response_sha256: createHash("sha256").update(content).digest("hex") }
    if (writing) {
      report.write_request_bytes += Buffer.byteLength(text, "utf8"); report.write_response_bytes += bytes; report.write_callback_elapsed_ms += elapsed_ms
      report.write_steps.push(step)
    } else { report.response_bytes += bytes; report.callback_elapsed_ms += elapsed_ms; report.steps.push(step) }
    await writeFile(join(output, "responses", `${writing ? "write-" : ""}${String(index).padStart(3, "0")}.txt`), content)
    await save()
    return new Response(content, { status: callbackError ? 422 : 200,
      headers: { "content-type": body.input.response_format === "html" ? "text/html; charset=utf-8" : "text/plain; charset=utf-8" } })
  } finally { release() }
}
const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: handle })
const address = `http://127.0.0.1:${server.port}`
await writeFile(join(output, "bridge.json"), JSON.stringify({ address, transport, pid: process.pid, route: report.route }) + "\n")
await save()
console.log(JSON.stringify({ address, transport, output, route: report.route }))
let stopped = false
let processing = false
const processed = new Set<string>()
// Some qualification executors isolate localhost by process namespace. This
// transport invokes the identical handler over shared disposable files; the
// participant receives only this directory, never fixture state or oracles.
const timer = setInterval(async () => {
  if (processing || stopped) return
  processing = true
  try {
    if (await Bun.file(join(output, "STOP")).exists()) { void stop(); return }
    for (const name of (await readdir(join(transport, "inbox"))).sort()) {
      if (!/^[a-zA-Z0-9_-]+\.json$/.test(name) || processed.has(name)) continue
      const path = join(transport, "inbox", name)
      const body = await readFile(path, "utf8")
      let response: Response
      try {
        if (Buffer.byteLength(body) > 100000) throw new Error("Request envelope too large")
        const input = JSON.parse(body)
        if (!["GET", "POST"].includes(input.method) || typeof input.path !== "string") throw new Error("Invalid request envelope")
        response = await handle(new Request(address + input.path, { method: input.method,
          ...(input.method === "POST" ? { body: JSON.stringify(input.body) } : {}) }))
      } catch (error) { response = new Response(JSON.stringify({ transport_error: String(error) }), { status: 400 }) }
      const result = { status: response.status, content: await response.text() }
      const destination = join(transport, "outbox", name)
      await writeFile(destination + ".tmp", JSON.stringify(result))
      await rename(destination + ".tmp", destination)
      processed.add(name)
    }
  } finally { processing = false }
}, 50)
const stop = async () => {
  if (stopped) return
  stopped = true
  clearInterval(timer)
  server.stop(true)
  await queue
  try {
    const rows = fixture.db.query("SELECT id,data FROM ledger ORDER BY seq").all() as Array<{ id: string; data: string }>
    report.source_originals_unchanged = rows.length === report.tracked_source_originals
      && rows.every(row => originalSourceBytes.get(row.id) === row.data)
  }
  finally {
    try { try { await baseline?.close() } finally { await fixture.close() } }
    finally { await rm(join(output, "state"), { recursive: true, force: true }); report.cleanup = true; await save() }
  }
}
process.once("SIGTERM", () => { void stop() })
process.once("SIGINT", () => { void stop() })
