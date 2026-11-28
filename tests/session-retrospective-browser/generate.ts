import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { execFileSync } from "node:child_process"
import { mkdir, readFile, writeFile } from "node:fs/promises"
import { join, resolve } from "node:path"
import { canonical, digest } from "../../src/model.js"
import type { RetrospectiveManifest } from "../../src/retrospective-contract.js"
import type { EvaluatorSourceIndexRef } from "../../src/evaluator-interpretation.js"
import { registeredLoom } from "../helpers/registered-loom.js"
import { openState } from "../helpers/evaluator-execution-fixture.js"
import { publicationFixture } from "../helpers/evaluator-publication-fixture.js"
import { observeSourceReads } from "./source-read-metrics.js"

// Controlled ordinary Session, not a user's private historical conversation.
// The pages below come from actual registered callbacks and source owners.
assert.ok(process.argv[2], "Usage: bun generate.ts FRESH_OUTPUT_DIRECTORY")
const output = resolve(process.argv[2]!)
await mkdir(output, { recursive: false })
const directory = join(output, "fixture-state")
await mkdir(directory)
const head = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim()
if (process.env.EXPECT_HEAD) assert.equal(head, process.env.EXPECT_HEAD)
const sha256 = (value: string) => createHash("sha256").update(value).digest("hex")
const owner = "ordinary-waybar-session", actor = { session_id: owner, agent: "author" }
const started = performance.now(), initialResources = process.resourceUsage()
const log: Array<Record<string, unknown>> = []
const manifest = { format: "loom-session-retrospective-browser-fixtures/v1", head, generated_at: new Date().toISOString(),
  producer: "Registered Loom callbacks and SQLite owners; simulated registration/permission host; scripted S5 fixture authority",
  source_sha256: {} as Record<string, string>, fixtures: [] as Array<Record<string, unknown>>,
  boundaries: {} as Record<string, unknown>, resources: {} as Record<string, unknown>,
  limitations: ["Controlled Session fixture, not recovered private historical work.", "Scripted interpretation tests S5 publication/readback; it does not qualify model reasoning.",
    "Automated navigation does not establish human or screen-reader comprehension.", "No production model execution authority is granted."] }
for (const path of ["src/plugin.ts", "src/learning.ts", "src/evaluation-subject.ts", "src/automatic-learning.ts", "src/learning-sources.ts",
  "src/retrospective-populations.ts", "src/retrospective-contract.ts", "src/evaluation-store.ts", "src/evaluator-interpretation-view.ts",
  "src/engineering-history-dashboard.ts", "src/retrospective-source-view.ts", "src/incremental-learning-view.ts",
  "tests/helpers/registered-loom.ts", "tests/helpers/evaluator-publication-fixture.ts", "tests/session-retrospective-browser/generate.ts",
  "tests/session-retrospective-browser/read.ts", "tests/session-retrospective-browser/source-read-metrics.ts", "tests/session-retrospective-browser/qualify.mjs"])
  manifest.source_sha256[path] = sha256(await readFile(path, "utf8"))

const ownerReads = observeSourceReads()
const f = await registeredLoom([], { directory })
const state = openState(join(directory, "state", "loom", "actions-v1", digest({ project: "tool-help", canonical: directory })))
let call = 0
async function execute(tool: string, request: Record<string, unknown>, format?: "json" | "html" | "markdown") {
  const id = "browser-call-" + ++call, start = performance.now(), args = format ? { ...request, response_format: format } : request
  try {
    const response = await f.tools.get(tool).execute(args, { sessionID: owner, agent: "author", messageID: id, id, signal: new AbortController().signal })
    assert.equal(typeof response.content, "string")
    const disclosure = f.permissionRequests.at(-1)?.metadata?.view_sha256
    if (tool === "history" || tool === "insights") assert.equal(disclosure, sha256(response.content), "Final permission binds exact returned bytes")
    log.push({ tool, operation: args.operation, format: format ?? "json", elapsed_ms: performance.now() - start,
      returned_bytes: Buffer.byteLength(response.content), ok: true })
    return { content: response.content as string, disclosure }
  } catch (error) {
    log.push({ tool, operation: args.operation, format: format ?? "json", elapsed_ms: performance.now() - start, returned_bytes: 0, ok: false, error: String(error) })
    throw error
  }
}
const json = async (tool: string, request: Record<string, unknown>) => JSON.parse((await execute(tool, request)).content).result
async function save(name: string, tool: string, request: Record<string, unknown>, options: Record<string, unknown> = {}) {
  const responses = { json: await execute(tool, request, "json"), html: await execute(tool, request, "html"), markdown: await execute(tool, request, "markdown") }
  for (const [format, response] of Object.entries(responses)) {
    assert.ok(Buffer.byteLength(response.content) <= 262144)
    await writeFile(join(output, name + (format === "markdown" ? ".md" : "." + format)), response.content)
  }
  const view = JSON.parse(responses.json.content).result
  manifest.fixtures.push({ name, tool, request, view_format: view.format, ...options,
    json: name + ".json", html: name + ".html", markdown: name + ".md",
    sha256: Object.fromEntries(Object.entries(responses).map(([key, value]) => [key, sha256(value.content)])),
    disclosure_sha256: Object.fromEntries(Object.entries(responses).map(([key, value]) => [key, value.disclosure])) })
  return view
}
const record = async (kind: string, statement: string, verdict?: string) => json("record", { operation: "add", session_only: true, kind, statement, ...(verdict ? { verdict } : {}) })
const count = (table: string, derived = false) => {
  const db = derived ? state.derived : state.ledger
  return db.query("SELECT 1 FROM sqlite_schema WHERE type='table' AND name=?").get(table)
    ? db.query(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number } : { n: 0 }
}
const noPrerequisites = () => ({ actions: count("actions").n, plans: count("plans").n, objectives: count("learning_objectives", true).n })
const populationState = () => ({ ...noPrerequisites(), subjects: count("learning_subject_subjects", true).n,
  populations: count("learning_retrospective_populations", true).n, ledger: count("ledger").n })
async function increment() {
  let result = await state.learning.automatic.run(owner, async () => {}, new AbortController().signal, { incremental: true, max_sources: 128 })
  for (let n = 0; result.state === "pending" && n < 20; n++)
    result = await state.learning.automatic.run(owner, async () => {}, new AbortController().signal, { incremental: true, max_sources: 128 })
  assert.equal(result.state, "complete")
  assert.ok(result.batch_id)
  return result
}
let published: ReturnType<typeof publicationFixture> | undefined
try {
  const original = await record("claim", "Intent: investigate why the Waybar network widget remains disconnected while Wi-Fi works. Preserve unrelated bar configuration.")
  const failed = await record("result", "Restarting Waybar did not restore the network label. The disconnected icon persisted.")
  const concern = await record("concern", "Ethernet was not retested. A Wi-Fi-only result cannot establish all network interfaces work.")
  const first = await increment()
  const beforeRepeat = count("learning_evaluation_reports", true).n
  const repeated = await increment()
  assert.equal(first.batch_id, repeated.batch_id)
  assert.equal(count("learning_evaluation_reports", true).n, beforeRepeat)

  const corrected = await record("result", "Correction: the widget was bound to the wrong interface. Updating that binding restored the Wi-Fi label.")
  const passed = await record("qa", "Reported verification: reconnecting Wi-Fi restored the expected label. Ethernet remains outside the check.", "pass")
  const abandoned = await record("result", "Aborted alternative: polling the network command was abandoned after a timeout; no polling change was retained.")
  const second = await increment()
  assert.notEqual(second.batch_id, first.batch_id)
  const secondBody = state.learning.automatic.incrementReport(owner, second.batch_id!).body!
  assert.equal(secondBody.new_sources, 3)
  assert.equal(secondBody.retained.concerns[0]!.source.id, concern.id)
  assert.equal(secondBody.previous?.batch_id, first.batch_id)
  const originalIDs = [original, failed, concern, corrected, passed, abandoned].map(record => record.id)
  assert.deepEqual(noPrerequisites(), { actions: 0, plans: 0, objectives: 0 })
  await save("learning-progress", "insights", { operation: "learning-progress", limit: 5 })
  const report = await save("learning-latest", "insights", { operation: "learning-report", batch_id: second.batch_id })
  const retained = report.body.retained.concerns[0]
  assert.equal(retained.inspect.batch_id, first.batch_id)
  await save("learning-earlier-original", "insights", retained.inspect)

  const question = "Explain the Waybar investigation, the failed restart, the corrected interface and the limits of the reported verification."
  const previewRequest = { operation: "preview-population", selection: { target: { kind: "session", id: owner }, question }, limit: 20 }
  const beforePreview = populationState()
  const preview = await save("session-preview", "history", previewRequest)
  assert.deepEqual(populationState(), beforePreview, "Read-only preview does not require a domain mutation")
  assert.equal(preview.manifest.format, "loom-retrospective-population/v2")
  assert.equal(preview.member_count, 6)
  assert.equal(preview.freeze, null)
  const previewOriginal = preview.items.find((item: any) => item.source.id === concern.id)
  assert.ok(previewOriginal?.inspect)
  await save("preview-original", "history", previewOriginal.inspect)
  assert.deepEqual(populationState(), beforePreview, "Original inspection before establishment also preserves domain state")

  // Opt into operational capture after proving the pure preview path. Keep
  // the existing scheduler's opportunity window outside this scripted journey;
  // the explicit deterministic increments above are its controlled checkpoints.
  await writeFile(join(directory, ".loom.yaml"), "agents: {}\ninstructions: {enabled: false}\nledger: {capture: automatic}\nlearning: {coalesce-ms: 60000}\n")
  const established = await json("review", preview.establish)
  const subject = established.subject
  const concurrent = await record("result", "Later continuation: a new Ethernet check was requested after the retrospective boundary; no result is yet recorded.")
  const resumed = await save("learning-resumed", "insights", { operation: "learning-progress", limit: 5 })
  assert.equal(resumed.state, "pending", "Resumed engineering work becomes pending without declaring the earlier Session complete")
  const boundedPreview = await save("established-preview", "history", { ...established.preview, limit: 20 })
  assert.deepEqual(boundedPreview.items.map((item: any) => item.source.id).sort(), originalIDs.slice().sort())
  await assert.rejects(() => json("history", { ...boundedPreview.items[0].inspect, member_key: "unavailable-member" }), /unavailable/i)
  const frozen = await json("review", boundedPreview.freeze)
  const frozenRequest = { operation: "population", population_id: frozen.population_id, manifest_sha256: frozen.manifest_sha256, limit: 20 }
  const frozenView = await save("session-frozen", "history", frozenRequest)
  assert.equal(frozenView.member_count, 6)
  assert.ok(!frozenView.items.some((item: any) => item.source.id === concurrent.id))
  const membershipBefore = canonical(frozenView.items.map((item: any) => ({ key: item.key, source: item.source })))

  const protectedPopulation = state.learning.automatic.history.retrospectivePopulation(frozen.population_id, owner)
  assert.equal(protectedPopulation.manifest_sha256, frozen.manifest_sha256)
  published = publicationFixture(state, actor, { manifest: protectedPopulation.manifest as RetrospectiveManifest })
  const key = (id: string) => {
    const member = published!.population.manifest.members.find(member => member.source.id === id)
    assert.ok(member)
    return member.key
  }
  const ref = (id: string): EvaluatorSourceIndexRef => ({ member_key: key(id), source_index: 0 })
  const interpretation = published.interpretation
  interpretation.conclusion = { kind: "no-change", statement: "The reported recovery is scoped to Wi-Fi. Preserve the interface correction and retain Ethernet as an unresolved verification limit.",
    limitations: ["This is a controlled scripted interpretation of authored records, not independent verification or production model qualification."] }
  interpretation.trajectory = [
    [original.id, "The author set a narrow scope: restore the Waybar network label and preserve unrelated configuration."],
    [failed.id, "A restart was attempted and reported ineffective."],
    [concern.id, "The author retained an explicit gap: Ethernet had not been retested."],
    [corrected.id, "The author corrected the interface binding and reported Wi-Fi recovery."],
    [passed.id, "Reported verification covered Wi-Fi reconnection only."],
    [abandoned.id, "A polling alternative was aborted after a timeout and was not retained."],
  ].map(([id, statement], index) => ({ event_id: "step-" + index, statement: statement!, members: [key(id!)], supporting: [ref(id!)], limitations: ["Authored record; order does not establish causation."] }))
  interpretation.claims = [{ claim_id: "scoped-recovery", kind: "interpretation", category: "recovery", basis: "supported",
    statement: "The evidence supports a reported Wi-Fi recovery, with an unresolved Ethernet coverage limit.",
    members: [key(corrected.id), key(passed.id), key(concern.id)], supporting: [ref(corrected.id), ref(passed.id)], contradicting: [ref(concern.id)],
    limitations: ["Missing Ethernet verification limits the scope; it does not contradict the reported Wi-Fi pass."], applicability: ["This controlled Session and the recorded cutoff only."], recommendation: null }]
  interpretation.review_coverage = [{ review_id: "wifi-check", requested: ["Reconnect Wi-Fi and inspect the network label"], covered: ["Reported Wi-Fi reconnection pass"],
    members: [key(passed.id)], supporting: [ref(passed.id)], limitations: ["Ethernet was not tested; reviewer independence is unknown."] }]
  interpretation.gaps = [{ member_key: key(concern.id), kind: "coverage", reason: "No Ethernet verification is present before this cutoff." }]
  const executeAuthority = published.authority.execute.bind(published.authority)
  published.authority.execute = async (admission, readSource, signal) => {
    for (const member of published!.population.manifest.members) if (member.key !== published!.base.source!.memberKey) {
      await readSource(member.key, 0)
      published!.retrieved.push({ member_key: member.key, source_index: 0, receipt_id: "controlled-delivery-" + (published!.retrieved.length + 1),
        boundary: "native-tool-result", source_sha256: member.source.sha256! })
    }
    return executeAuthority(admission, readSource, signal)
  }
  const execution = await published.execute()
  const publication = await published.publish()
  await save("evaluation-report", "insights", { operation: "evaluation-interpretation", batch_id: published.prepared.batch_id })
  await save("evaluation-sources", "insights", { operation: "evaluation-interpretation", batch_id: published.prepared.batch_id, section: "sources", limit: 20 })
  const afterEvaluation = await json("history", frozenRequest)
  assert.equal(canonical(afterEvaluation.items.map((item: any) => ({ key: item.key, source: item.source }))), membershipBefore)
  assert.deepEqual(noPrerequisites(), { actions: 0, plans: 0, objectives: 0 })
  const audit = await json("history", established.audit)
  assert.ok(audit.items.some((item: any) => item.outcome === "failed" || item.data?.outcome === "failed"), "Failed supported retrieval is retained in the learning audit")
  assert.equal(f.sessionCreates.length, 0)
  assert.equal(f.sessionPrompts.length, 0)
  assert.equal(f.nativeInputs.length, 0)
  assert.equal(f.nativeListRequests.length, 0)
  manifest.boundaries = { subject, originals: originalIDs, concurrent_append: concurrent.id,
    no_prerequisites: noPrerequisites(), preview_before: beforePreview, preview_unchanged: true,
    population_id: frozen.population_id, manifest_sha256: frozen.manifest_sha256, frozen_member_ids: afterEvaluation.items.map((item: any) => item.source.id),
    membership_unchanged_after_evaluation: true, failed_retrieval_audit: audit,
    increments: { first: first.batch_id, second: second.batch_id, repeated: repeated.batch_id,
      second_new_sources: secondBody.new_sources, earlier_concern_origin: retained.inspect }, execution, publication }
  await writeFile(join(output, "reader-context.json"), JSON.stringify({ directory, session_id: owner }, null, 2))
  await writeFile(join(output, "PUBLIC-HELP.md"), "# Registered tool help\n\n" + ["history", "insights"].map(name => "## " + name + "\n\n" + f.tools.get(name).description + "\n").join("\n"))
  await writeFile(join(output, "START-HERE.md"), "# Controlled ordinary Session retrospective\n\nStart with `session-preview.html`, `evaluation-report.html`, `learning-progress.html` and `learning-resumed.html`. Each is exact output from the registered Loom interface. Saved pages describe their recorded read boundary; they do not update themselves. This controlled fixture is not a recovered private historical conversation.\n\nUse only supported requests shown by the pages and PUBLIC-HELP.md. From the repository, run:\n\n    bun tests/session-retrospective-browser/read.ts FIXTURE_DIRECTORY TOOL REQUEST_JSON\n\nTOOL is history or insights. REQUEST_JSON is one JSON object copied from the page, passed as one quoted argument. The fresh-reader wrapper allows at most 20 items per page; omit limit for its default of 5. Responses are bounded and authorization is checked by the registered callback. No database or implementation inspection is needed. Reads are logged in reader-log.jsonl for cost review.\n\nThe subject owner also returned this read-only audit request:\n\n```json\n" + JSON.stringify(established.audit, null, 2) + "\n```\n\nQuestions: What was attempted? What was corrected? What remains unverified? Does caught-up mean complete? Which earlier original supports the retained concern? Did later continuation or failed evaluation retrieval enter the original frozen subject? Identify what this fixture cannot establish.\n\nFor an independent comprehension assessment, use only these public pages, tool help and the bounded reader. Do not read fixture-state, manifest.json, reader-context.json, the generator, tests or implementation files. Explain any unanswered question instead of filling it in from the fixture setup.\n")
} finally {
  published?.close()
  state.close()
  await f.close()
  const resource = process.resourceUsage()
  manifest.resources = { elapsed_ms: performance.now() - started, max_rss_kib: resource.maxRSS, user_cpu_microseconds: resource.userCPUTime - initialResources.userCPUTime,
    system_cpu_microseconds: resource.systemCPUTime - initialResources.systemCPUTime, public_calls: log.length,
    returned_bytes: log.reduce((total, row) => total + Number(row.returned_bytes), 0), failed_public_calls: log.filter(row => !row.ok).length,
    native_history_enumerations: f.nativeListRequests.length, native_model_creates: f.sessionCreates.length,
    native_model_prompts: f.sessionPrompts.length, native_context_injections: f.nativeInputs.length, original_owner_reads: ownerReads.snapshot(), log }
  ownerReads.close()
  await writeFile(join(output, "manifest.json"), JSON.stringify(manifest, null, 2))
}
console.log(JSON.stringify({ output, fixtures: manifest.fixtures.length, resources: { ...manifest.resources, log: undefined } }))
