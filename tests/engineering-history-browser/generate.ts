import assert from "node:assert/strict"
import { Database } from "bun:sqlite"
import { createHash } from "node:crypto"
import { execFileSync } from "node:child_process"
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { dirname, join, resolve } from "node:path"
import type { EngineeringHistoryQuery, EngineeringHistoryView } from "../../src/engineering-history.js"
import type { RetrospectivePopulationView } from "../../src/retrospective-populations.js"
import { digest } from "../../src/model.js"
import { Store } from "../../src/store.js"
import { engineeringHistoryScenario, type RegisteredHistoryFixture } from "../helpers/engineering-history-scenarios.js"
import { engineeringTrajectoryFixture, unplannedEngineeringTrajectoryFixture } from "../helpers/engineering-trajectory-fixture.js"
import { registeredLoom } from "../helpers/registered-loom.js"

assert.ok(process.argv[2], "Usage: bun generate.ts FRESH_OUTPUT_DIRECTORY")
const output = resolve(process.argv[2]!)
await mkdir(output, { recursive: false })
const state = await mkdtemp(join(dirname(output), "loom-history-browser-state-"))
const sha256 = (value: string) => createHash("sha256").update(value).digest("hex")
const head = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim()
if (process.env.EXPECT_HEAD) assert.equal(head, process.env.EXPECT_HEAD)
const manifest = { format: "loom-engineering-history-browser-fixtures/v1", head,
  generated_at: new Date().toISOString(), producer: "Actual registered history callback and Store; simulated native registration/permission owner",
  source_sha256: {} as Record<string, string>, fixtures: [] as Array<Record<string, unknown>>,
  boundaries: [] as Array<Record<string, unknown>> }
for (const path of ["src/engineering-history.ts", "src/engineering-history-dashboard.ts", "src/plugin.ts",
  "tests/helpers/registered-loom.ts", "tests/helpers/engineering-history-scenarios.ts", "tests/engineering-history-browser/generate.ts",
  "tests/helpers/engineering-trajectory-fixture.ts", "src/engineering-trajectories.ts", "src/objectives.ts", "src/review-requests.ts",
  "src/retrospective-contract.ts", "src/retrospective-populations.ts", "src/evaluation-store.ts", "src/evaluator-preparation.ts", "src/learning-sources.ts",
  "tests/engineering-history-browser/qualify.mjs", ".github/workflows/engineering-history-browser.yml"])
  manifest.source_sha256[path] = sha256(await readFile(path, "utf8"))

const execute = async (f: RegisteredHistoryFixture, query: EngineeringHistoryQuery, response_format: "json" | "html" | "markdown", reader = "browser-fixture-reader") => {
  const response = await f.tools.get("history").execute({ operation: "read", ...query, response_format }, {
    sessionID: reader, agent: "author", messageID: "browser-history-read", id: "browser-history-read",
    signal: new AbortController().signal,
  })
  assert.equal(typeof response.content, "string")
  const disclosure = f.permissionRequests.at(-1)
  assert.equal(disclosure.metadata.view_sha256, sha256(response.content), "Final permission binds the exact response bytes")
  return { content: response.content as string, disclosure: disclosure.metadata.view_sha256 as string }
}
const records = (view: EngineeringHistoryView) => [...new Map([...view.highlights, ...view.records].map(record => [record.ref, record])).values()]
async function save(f: RegisteredHistoryFixture, name: string, query: EngineeringHistoryQuery,
  options: { dense?: boolean; hostile_text?: string[]; reader_session?: string } = {}) {
  // Freeze the append boundary before comparing the three public formats.
  const initial = JSON.parse((await execute(f, query, "json", options.reader_session)).content).result as EngineeringHistoryView
  assert.equal(initial.format, "loom-engineering-history/v1")
  const request = initial.navigation.repeat
  const render = async (format: "json" | "html" | "markdown") => {
    try { return await execute(f, request, format, options.reader_session) }
    catch (cause) { throw new Error(`Registered browser fixture ${name} failed for ${format}`, { cause }) }
  }
  const json = await render("json"), html = await render("html"), markdown = await render("markdown")
  const view = JSON.parse(json.content).result as EngineeringHistoryView
  assert.equal(view.boundary.observed_through, request.through)
  const included = records(view)
  if (view.mode === "connections") {
    assert.ok(view.connections.context?.record_refs.length, "A connection page retains real selected source references")
    assert.ok(view.connections.objectives.length + view.connections.reviews.length + view.relationships.length,
      "A connection page includes an actual owner or relationship")
    assert.deepEqual([view.records, view.highlights, view.branches], [[], [], []], "Connection pages omit repeated record bodies and overview")
    assert.ok(view.navigation.repeat.connection_cursor, "Connection pages retain their opaque ready cursor")
  } else assert.ok(included.length, "Record scenes must include real source records")
  for (const forbidden of ["PRIVATE_RAW_NATIVE_INPUT", "PRIVATE_RAW_NATIVE_RESULT", "PRIVATE_AGENT_INSTRUCTIONS"])
    for (const response of [json, html, markdown]) assert.ok(!response.content.includes(forbidden), `No raw private body: ${forbidden}`)
  const branches = [...new Map([...view.ancestors, ...(view.selected_branch ? [view.selected_branch] : []),
    ...view.branches, ...view.related_branches].map(branch => [branch.ref, branch])).values()]
  const history_requests: object[] = [...branches.map(branch => ({ operation: "read", ...branch.expand })),
    ...included.map(record => ({ operation: "read", ...record.expand })),
    ...included.map(record => ({ operation: "read", ...record.trajectory })),
    ...view.connections.objectives.map(item => ({ operation: "read", ...item.expand })),
    ...[...view.connections.objectives, ...view.connections.reviews].map(item => ({ operation: "read", ...item.details })),
    { operation: "read", ...view.navigation.repeat }]
  if (view.navigation.next_records) history_requests.push({ operation: "read", ...view.navigation.next_records })
  if (view.navigation.next_branches) history_requests.push({ operation: "read", ...view.navigation.next_branches })
  if (view.navigation.next_connections) history_requests.push({ operation: "read", ...view.navigation.next_connections })
  if (view.navigation.next_relationships) history_requests.push({ operation: "read", ...view.navigation.next_relationships })
  if (view.connections.context) history_requests.push({ operation: "read", ...view.connections.context.read })
  for (const [extension, response] of Object.entries({ json, html, markdown }))
    await writeFile(join(output, `${name}.${extension === "markdown" ? "md" : extension}`), response.content)
  manifest.fixtures.push({ name, request: { operation: "read", ...request }, ...options,
    json: `${name}.json`, html: `${name}.html`, markdown: `${name}.md`,
    sha256: { json: sha256(json.content), html: sha256(html.content), markdown: sha256(markdown.content) },
    disclosure_sha256: { json: json.disclosure, html: html.disclosure, markdown: markdown.disclosure },
    required_text: [view.store_id, view.boundary.membership, ...view.coverage.gaps.map(gap => gap.detail),
      ...view.connections.objectives.map(item => item.objective.label),
      ...view.connections.reviews.flatMap(item => [item.request.mandate.question, ...item.request.mandate.exclusions])],
    owner_sources: [...view.connections.objectives, ...view.connections.reviews].map(item => ({ ref: item.ref, ...item.source })),
    sources: included.map(record => ({ ref: record.ref, record_id: record.source.record_id, sha256: record.source.sha256 })),
    history_requests,
  })
  return view
}

async function savePopulation(f: RegisteredHistoryFixture, name: string, query: Record<string, unknown>,
  options: { reader_session: string; hostile_text?: string[] }) {
  const render = async (request: Record<string, unknown>, response_format: "json" | "html" | "markdown") => {
    const response = await f.tools.get("history").execute({ ...request, response_format }, {
      sessionID: options.reader_session, agent: "author", messageID: "browser-population-read", id: "browser-population-read",
      signal: new AbortController().signal,
    })
    assert.equal(typeof response.content, "string")
    const disclosure = f.permissionRequests.at(-1)
    assert.equal(disclosure.metadata.view_sha256, sha256(response.content), "Population disclosure binds the exact response bytes")
    return { content: response.content as string, disclosure: disclosure.metadata.view_sha256 as string }
  }
  const initial = JSON.parse((await render(query, "json")).content).result as RetrospectivePopulationView
  assert.equal(initial.format, "loom-retrospective-population-view/v1")
  const request = initial.navigation.repeat
  const json = await render(request, "json"), html = await render(request, "html"), markdown = await render(request, "markdown")
  const view = JSON.parse(json.content).result as RetrospectivePopulationView
  assert.equal(view.manifest_sha256, initial.manifest_sha256)
  assert.deepEqual(view.manifest, initial.manifest)
  assert.equal(view.manifest.coverage.objective_count, 1)
  assert.equal(view.manifest.coverage.complete_selected_membership, true)
  assert.ok(view.items.length)
  assert.equal(new Set(view.items.map(item => item.key)).size, view.items.length)
  for (const forbidden of ["SYNTHETIC_PRIVATE_COMMAND", "SYNTHETIC_PRIVATE_OUTPUT", "FOREIGN_PRIVATE_REVIEW_MANDATE"])
    for (const response of [json, html, markdown]) assert.ok(!response.content.includes(forbidden), `No protected original: ${forbidden}`)
  for (const [extension, response] of Object.entries({ json, html, markdown }))
    await writeFile(join(output, `${name}.${extension === "markdown" ? "md" : extension}`), response.content)
  const population_requests = [view.navigation.repeat, ...(view.navigation.next ? [view.navigation.next] : []),
    ...(view.freeze ? [view.freeze] : []), ...view.items.flatMap(item => item.inspect ? [item.inspect] : [])]
  manifest.fixtures.push({ name, request, ...options, view_format: view.format,
    json: `${name}.json`, html: `${name}.html`, markdown: `${name}.md`,
    sha256: { json: sha256(json.content), html: sha256(html.content), markdown: sha256(markdown.content) },
    disclosure_sha256: { json: json.disclosure, html: html.disclosure, markdown: markdown.disclosure },
    required_text: [view.manifest_sha256, view.manifest.source_store_id, ...view.manifest.qualifications],
    sources: view.items.map(item => ({ key: item.key, ...item.source, permitted_view: item.permitted_view })),
    population_requests,
  })
  return view
}

try {
  for (const planned of [true, false]) {
    const name = planned ? "planned" : "unplanned"
    const scenario = await engineeringHistoryScenario({ planned, directory: join(state, name) })
    try {
      const overview = await save(scenario.f, `${name}-overview`, { action_id: scenario.action.id })
      assert.ok(!records(overview).some(record => record.source.record_id === scenario.records.originalFailure.id),
        "The old target must be absent from the default overview")
      // Selection comes only from the known question text. Fixture IDs are used
      // below as assertions, never as discovery inputs.
      const discovery = await save(scenario.f, `${name}-discovery`, { action_id: scenario.action.id, match: scenario.search })
      for (const original of Object.values(scenario.records))
        assert.ok(discovery.records.some(record => record.source.record_id === original.id), "Discovery retains each relevant authored record")
      const firstFailure = discovery.records.find(record => record.excerpt?.includes("original /coarse"))
      assert.ok(firstFailure, "Use discovered prose to select the original failure")
      assert.equal(firstFailure.source.record_id, scenario.records.originalFailure.id)
      const selected = await save(scenario.f, `${name}-selected`, firstFailure.expand)
      assert.equal(selected.selected_branch?.ref, firstFailure.branch_ref, "A record exposes its exact work-group expansion")
      // A subject fingerprint is deliberately not promoted into an exact Plan
      // revision. Follow an explicitly qualified related historical binding to
      // exercise saved Plan ancestry, instead of inventing it for the finding.
      let hierarchy = selected
      if (planned) {
        const historical = selected.related_branches.find(branch => branch.kind === "historical-work")
        assert.ok(historical, "Historical comparison comes from a returned, qualified relation")
        hierarchy = await save(scenario.f, `${name}-historical`, historical.expand)
      }
      const ancestor = hierarchy.ancestors.at(-1)
      assert.ok(ancestor, "Selected work exposes its recorded parent path")
      if (!planned) {
        // Record the actual default-page outcome before qualifying an explicit
        // five-record page. A bounded rejection is not reported as browser proof.
        const query = { ...ancestor.expand, limit: 20 }
        try {
          const response = await execute(scenario.f, query, "html")
          assert.ok(Buffer.byteLength(response.content) <= 262144)
          manifest.boundaries.push({ name: "unplanned-parent-default-page", query, status: "rendered-within-bound",
            bytes: Buffer.byteLength(response.content), sha256: sha256(response.content) })
        } catch (error) {
          assert.match(String(error), /(?:History|Evidence) response exceeds 262144 bytes/)
          manifest.boundaries.push({ name: "unplanned-parent-default-page", query, status: "bounded-rejection", error: String(error) })
        }
      }
      const children = await save(scenario.f, `${name}-children`, { ...ancestor.expand, limit: 5 })
      assert.ok(children.branches.some(child => child.parent_ref === ancestor.ref), "Parent expansion returns children")
      if (children.coverage.next_after !== null) {
        const continuation = await save(scenario.f, `${name}-children-next`, { ...ancestor.expand,
          through: children.boundary.observed_through, ...children.selection, limit: children.coverage.page_limit,
          after: children.coverage.next_after })
        assert.equal(continuation.coverage.page_limit, 5)
        assert.equal(continuation.selected_branch?.ref, ancestor.ref)
        assert.equal(continuation.boundary.observed_through, children.boundary.observed_through)
        assert.ok(continuation.records.every(record => record.sequence > children.coverage.next_after!))
      }
      await save(scenario.f, `${name}-original`, { ...discovery.scope, record_id: firstFailure.source.record_id,
        through: discovery.boundary.observed_through })
    } finally { await scenario.close() }
  }

  const trajectory = await engineeringTrajectoryFixture({ records: 24000, directory: join(state, "trajectory") })
  try {
    const owner = { reader_session: trajectory.sessions.reader }
    const discovery = await save(trajectory.f, "trajectory-discovery", { action_id: trajectory.action.id, match: trajectory.search }, owner)
    assert.equal(discovery.records.length, 1, "The vocabulary-varied fixture has one initial match")
    const seed = discovery.records[0]!
    const connected = await save(trajectory.f, "trajectory-connected", seed.trajectory, owner)
    assert.equal(connected.mode, "trajectory")
    assert.equal(connected.records.length, 20)
    assert.equal(connected.connections.reviews.length, 2)
    assert.ok(!connected.records.some(record => record.source.record_id === trajectory.unrelated.id))
    const page = await save(trajectory.f, "trajectory-page", { ...seed.trajectory, limit: 5 }, owner)
    assert.ok(page.navigation.next_records)
    const continued = await save(trajectory.f, "trajectory-page-next", page.navigation.next_records, owner)
    assert.equal(continued.navigation.repeat.record_id, seed.source.record_id)
    assert.equal(continued.navigation.repeat.related, true)
    assert.deepEqual(continued.boundary.owners, page.boundary.owners)
    assert.equal(continued.boundary.owner_version, page.boundary.owner_version)

    // The same registered history owners now supply the bounded evaluation
    // population. Question text stays untrusted in each shared representation.
    await trajectory.f.invoke("objective", { operation: "link", objective_id: trajectory.objective.id,
      phase: "coverage-gap", gap_reason: "missing-source", source_type: "external-ref",
      source_id: "https://example.test/controlled/ci/a1/attempt/1", confidence: "uncertain",
      note: "Original CI bytes remain unavailable with their external owner; the reported failure remains distinct." }, owner.reader_session)
    const hostile = '</style><script>globalThis.__loomHostileExecuted=true</script><img src="https://hostile.invalid/leak">'
    const populationOptions = { ...owner, hostile_text: [hostile] }
    const preview = await savePopulation(trajectory.f, "population-preview", { operation: "preview-population",
      selection: { objective_id: trajectory.objective.id,
        question: `${trajectory.question} Literal qualification text: ${hostile} ${"long-source-token-".repeat(80)}` }, limit: 7 }, populationOptions)
    assert.ok(preview.navigation.next, "The selection preview requires bounded continuation")
    assert.equal(preview.population_id, null)
    assert.ok(preview.freeze)
    const previewNext = await savePopulation(trajectory.f, "population-preview-next", preview.navigation.next, populationOptions)
    assert.equal(previewNext.manifest_sha256, preview.manifest_sha256)
    assert.deepEqual(previewNext.manifest, preview.manifest)
    assert.equal(previewNext.items[0]!.ordinal, preview.items.length + 1)
    const frozen = (await trajectory.f.invoke("review", preview.freeze, owner.reader_session)).result
    assert.equal(frozen.manifest_sha256, preview.manifest_sha256)
    const populationRequest = { operation: "population", population_id: frozen.population_id, manifest_sha256: frozen.manifest_sha256 }
    const first = await savePopulation(trajectory.f, "population-frozen", { ...populationRequest, limit: 20 }, populationOptions)
    assert.ok(first.navigation.next, "Frozen membership exceeds one bounded page")
    const populationMembers = [...first.items], populationPages = ["population-frozen"]
    let next: Record<string, unknown> | null = first.navigation.next
    while (next) {
      assert.ok(populationPages.length < 30, "Frozen continuation must terminate")
      const name = populationPages.length === 1 ? "population-frozen-next" : `population-frozen-next-${populationPages.length}`
      const following = await savePopulation(trajectory.f, name, next, populationOptions)
      assert.equal(following.population_id, first.population_id)
      assert.equal(following.manifest_sha256, first.manifest_sha256)
      assert.deepEqual(following.manifest, first.manifest)
      assert.equal(following.items[0]!.ordinal, populationMembers.length + 1)
      populationMembers.push(...following.items); populationPages.push(name); next = following.navigation.next
    }
    assert.equal(populationMembers.length, first.member_count, "Every frozen member is reconstructed through bounded reads")
    assert.equal(new Set(populationMembers.map(item => item.key)).size, first.member_count)
    assert.equal(populationMembers.filter(item => item.source.kind === "objective").length, 1)
    assert.ok(!populationMembers.some(item => item.source.id === trajectory.unrelated.id))
    for (const record of [trajectory.records.finding, trajectory.records.rerun, trajectory.records.correction, trajectory.records.recheck])
      assert.ok(populationMembers.some(item => item.source.kind === "ledger-record" && item.source.id === record.id
        && item.source.sha256 === digest(record)), "Distinct engineering evidence retains its exact original version")
    assert.ok(populationMembers.some(item => item.availability !== "available"), "Unavailable original sources remain explicit")
    manifest.boundaries.push({ name: "frozen-population-complete-bounded-readback", status: "reconstructed",
      population_id: first.population_id, manifest_sha256: first.manifest_sha256, member_count: first.member_count,
      objective_count: 1, pages: populationPages, source_keys: populationMembers.map(item => item.key) })

    // Missing current originals do not remove the selected member or replace
    // its frozen hash. This changes only the controlled fixture after freezing.
    const missingMember = populationMembers.find(item => item.source.id === trajectory.records.finding.id)!
    trajectory.db.prepare("DELETE FROM ledger WHERE id=?").run(trajectory.records.finding.id)
    const missing = await savePopulation(trajectory.f, "population-frozen-missing", { ...populationRequest,
      after: missingMember.ordinal - 1, limit: 1 }, populationOptions)
    assert.equal(missing.manifest_sha256, first.manifest_sha256)
    assert.equal(missing.items[0]!.key, missingMember.key)
    assert.equal(missing.items[0]!.source.sha256, missingMember.source.sha256)
    assert.equal(missing.items[0]!.availability, "available")
    assert.equal(missing.items[0]!.current.status, "missing")
  } finally { await trajectory.close() }

  // Bound rendering cost with a modest connected population, while retaining
  // overlapping objectives, reused Sessions and enough reviews for pagination.
  const fanout = await unplannedEngineeringTrajectoryFixture({ mode: "connected", records: 500,
    directory: join(state, "connections") })
  try {
    const owner = { reader_session: fanout.sessions.reader }
    const discovery = JSON.parse((await execute(fanout.f, { action_id: fanout.action.id,
      match: "Initial reading", record_kinds: ["assessment"] }, "json", owner.reader_session)).content).result as EngineeringHistoryView
    assert.equal(discovery.records.length, 1, "Discover the multiply reviewed interpretation from its recorded wording")
    const seed = discovery.records[0]!
    const source = await save(fanout.f, "connections-source", { ...discovery.navigation.repeat,
      record_id: seed.source.record_id, match: undefined, record_kinds: undefined, limit: 1 }, owner)
    assert.equal(source.records[0]?.source.record_id, seed.source.record_id)
    assert.ok(source.navigation.next_connections, "Review fan-out requires a group continuation")
    assert.ok(source.navigation.next_relationships, "The selected interpretation requires an edge continuation")
    const groups = await save(fanout.f, "connections-groups", source.navigation.next_connections, owner)
    const edges = await save(fanout.f, "connections-edges", source.navigation.next_relationships, owner)
    assert.equal(groups.connections.coverage.page, "groups")
    assert.equal(edges.connections.coverage.page, "relationships")
    assert.deepEqual(groups.relationships, [], "Owner pagination does not repeat graph edges")
    assert.equal(new Set([...source.relationships, ...edges.relationships].map(edge => JSON.stringify(edge))).size,
      source.relationships.length + edges.relationships.length, "Edge continuation excludes the first-page edges")
    const review = source.connections.reviews[0]
    assert.ok(review, "The discovered interpretation exposes its review owner")
    const details = await save(fanout.f, "connections-review", review.details, owner)
    assert.equal(details.connections.coverage.page, "review-relationships")
    assert.ok(details.navigation.next_connections, "The original review evidence needs its own bounded continuation")
    const nextDetails = await save(fanout.f, "connections-review-next", details.navigation.next_connections, owner)
    assert.equal(nextDetails.connections.reviews[0]?.request.request_id, review.request.request_id)
    const firstIDs = details.connections.reviews.flatMap(item => item.relationships.map(relation => relation.id))
    const nextIDs = nextDetails.connections.reviews.flatMap(item => item.relationships.map(relation => relation.id))
    assert.ok(firstIDs.length && nextIDs.length)
    assert.equal(new Set([...firstIDs, ...nextIDs]).size, firstIDs.length + nextIDs.length)
    for (const page of [groups, edges, details, nextDetails]) {
      assert.deepEqual(page.connections.context?.read, source.navigation.repeat)
      assert.deepEqual(page.connections.context?.record_refs, [seed.ref])
      assert.deepEqual(page.boundary.owners, source.boundary.owners)
      assert.equal(page.boundary.owner_version, source.boundary.owner_version)
      assert.equal(page.boundary.observed_through, source.boundary.observed_through)
    }
  } finally { await fanout.close() }

  // Supplemental dense/hostile material is stored through the same registered
  // product and read back by loom_history. It does not replace the shared cases.
  const directory = join(state, "dense")
  await mkdir(directory)
  const f = await registeredLoom([], { directory })
  let db: Database | undefined
  try {
    const hostile = '</style><script>globalThis.__loomHostileExecuted=true</script><img src="https://hostile.invalid/leak">'
    const action = (await f.invoke("action", { operation: "create", title: "Dense hostile-source qualification",
      goal: `${hostile}\n${"long-source-token-".repeat(180)}` }, "dense-author")).result
    db = new Database(join(directory, "state", "loom", "actions-v1", digest({ project: "tool-help", canonical: directory }), "ledger.sqlite"))
    const store = new Store(db), focus = { action_id: action.id }
    const observations = Array.from({ length: 20 }, (_, index) => store.observe({ session_id: "dense-worker", agent: "author" },
      focus, { phase: "started", tool: "shell", message_id: "dense-message", call_id: `dense-call-${index}` }))
    for (const item of [{ kind: "assessment", verdict: "fail" }, { kind: "concern" }, { kind: "qa", verdict: "inconclusive" },
      { kind: "result" }, { kind: "assessment", verdict: "pass" }] as const) {
      for (let index = 0; index < 2; index++) await f.invoke("record", { operation: "add", ...focus, ...item,
        statement: `Dense evidence ${item.kind} ${index}: ${hostile}`, evidence_ids: observations.map(record => record.id) }, "dense-reviewer")
    }
    const dense = await save(f, "dense-hostile", focus, { dense: true, hostile_text: [hostile] })
    assert.ok(dense.relationships.length >= 100)
  } finally { db?.close(true); await f.close() }
  await writeFile(join(output, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n")
  console.log(`Generated ${manifest.fixtures.length} registered-tool browser fixtures at ${output}`)
} finally {
  await rm(state, { recursive: true, force: true })
}
