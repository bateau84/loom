import assert from "node:assert/strict"
import { appendFile, readFile } from "node:fs/promises"
import { join, resolve } from "node:path"
import { registeredLoom } from "../helpers/registered-loom.js"
import { observeSourceReads } from "./source-read-metrics.js"

// Fresh-reader entry point: public bounded read-only tools, no storage API.
assert.ok(process.argv[2] && process.argv[3] && process.argv[4], "Usage: bun read.ts FIXTURE_DIRECTORY history|insights REQUEST_JSON")
const output = resolve(process.argv[2]!), tool = process.argv[3]!, request = JSON.parse(process.argv[4]!)
assert.ok(request && typeof request === "object" && !Array.isArray(request))
const operations: Record<string, string[]> = {
  history: ["read", "subject", "subject-activities", "preview-population", "preview-source", "population", "population-source"],
  insights: ["learning-progress", "learning-report", "learning-source", "evaluation-interpretation", "evaluation-prior-source"],
}
assert.ok(operations[tool]?.includes(request.operation), "Only supported read-only history and insights operations are available")
if (request.limit === undefined && !request.operation.includes("source") && request.operation !== "subject") request.limit = 5
const pageLimit = tool === "history" ? 50 : request.operation === "learning-progress" ? 20 : 100
if (request.limit !== undefined) assert.ok(Number.isInteger(request.limit) && request.limit > 0 && request.limit <= pageLimit, "Page exceeds this public operation's documented limit")
if (request.source_limit !== undefined) assert.ok(Number.isInteger(request.source_limit) && request.source_limit >= 2 && request.source_limit <= 32768, "Source fragment limit is 32768")
if (!["subject", "subject-activities"].includes(request.operation)) {
  request.response_format ??= "json"
  assert.ok(["json", "html", "markdown"].includes(request.response_format))
}
const config = JSON.parse(await readFile(join(output, "reader-context.json"), "utf8"))
const ownerReads = observeSourceReads()
const f = await registeredLoom([], { directory: config.directory })
const started = performance.now(), id = "fresh-reader-" + crypto.randomUUID()
let bytes = 0, ok = false, failure: string | undefined
try {
  const response = await f.tools.get(tool).execute(request, { sessionID: config.session_id, agent: "author", messageID: id, id, signal: new AbortController().signal })
  bytes = Buffer.byteLength(response.content)
  assert.ok(bytes <= 262144)
  ok = true
  process.stdout.write(response.content + "\n")
} catch (error) { failure = String(error); throw error }
finally {
  await f.close()
  await appendFile(join(output, "reader-log.jsonl"), JSON.stringify({ at: new Date().toISOString(), tool, request,
    elapsed_ms: performance.now() - started, returned_bytes: bytes, max_rss_kib: process.resourceUsage().maxRSS, ok, error: failure,
    native_history_enumerations: f.nativeListRequests.length, native_model_prompts: f.sessionPrompts.length,
    native_context_injections: f.nativeInputs.length, original_owner_reads: ownerReads.snapshot() }) + "\n")
  ownerReads.close()
}
