import { expect, test } from "bun:test"
import { createHash } from "node:crypto"
import { execFileSync } from "node:child_process"
import { mkdir, readFile, writeFile } from "node:fs/promises"
import { join, resolve } from "node:path"
import { pathToFileURL } from "node:url"
import { canonical, type LedgerRecord } from "../src/model.js"
import type { EngineeringHistoryQuery, EngineeringHistoryView } from "../src/engineering-history.js"
import { engineeringTrajectoryFixture } from "./helpers/engineering-trajectory-fixture.js"
import type { registeredLoom } from "./helpers/registered-loom.js"

type Fixture = Awaited<ReturnType<typeof engineeringTrajectoryFixture>>
type Host = Awaited<ReturnType<typeof registeredLoom>>
type Step = { tool: string; input: Record<string, unknown>; bytes: number; elapsed_ms: number; sha256: string }
type Metric = { calls: number; bytes: number; elapsed_ms: number; steps: Step[] }
const metric = (): Metric => ({ calls: 0, bytes: 0, elapsed_ms: 0, steps: [] })
const hash = (value: string) => createHash("sha256").update(value).digest("hex")
const ledgerIDs = (view: EngineeringHistoryView) => view.records.map(record => record.source.record_id)
const expectedOriginals = (fixture: Fixture) => [...Object.values(fixture.records),
  ...Object.values(fixture.observations).flatMap(pair => [pair.start, pair.finish])]
const exact = (record: LedgerRecord) => canonical({ id: record.id, action_id: record.action_id, node_id: record.node_id,
  session_id: record.session_id, agent: record.agent, created_at: record.created_at, kind: record.kind,
  fingerprint: record.fingerprint, data: record.data })
const sortedOriginals = (records: LedgerRecord[]) => records.map(exact).sort()
const readHistory = async (fixture: Fixture, query: EngineeringHistoryQuery, session = fixture.sessions.reader) =>
  (await fixture.f.invoke("history", { operation: "read", ...query }, session)).result as EngineeringHistoryView
const discover = (fixture: Fixture) => readHistory(fixture, { action_id: fixture.action.id, match: fixture.search })

function measured(host: Host, session: string, measurement: Metric) {
  return async (tool: string, input: Record<string, unknown>) => {
    const start = performance.now()
    const response = await host.tools.get(tool).execute(input, { sessionID: session, agent: "author",
      messageID: "controlled-measurement", id: "controlled-read", signal: new AbortController().signal })
    const elapsed_ms = performance.now() - start, bytes = Buffer.byteLength(response.content, "utf8")
    measurement.calls++; measurement.bytes += bytes; measurement.elapsed_ms += elapsed_ms
    measurement.steps.push({ tool, input, bytes, elapsed_ms, sha256: hash(response.content) })
    return JSON.parse(response.content).result
  }
}

test("registered record discovery follows vocabulary-varied findings, corrections, rechecks and originals", async () => {
  const fixture = await engineeringTrajectoryFixture({ records: 240 })
  try {
    const discovery = await discover(fixture)
    expect(discovery.records).toHaveLength(1)
    expect(discovery.records[0]!.source.record_id).toBe(fixture.records.finding.id)
    expect(discovery.records[0]!.trajectory).not.toHaveProperty("match")
    const view = await readHistory(fixture, discovery.records[0]!.trajectory)
    expect(view.mode).toBe("trajectory")
    expect(ledgerIDs(view).sort()).toEqual(expectedOriginals(fixture).map(record => record.id).sort())
    expect(ledgerIDs(view)).not.toContain(fixture.unrelated.id)
    expect(view.highlights).toEqual([])
    expect(view.intended_plan).toBeNull()
    expect(view.branches).toEqual([])
    expect(view.relationships.map(item => item.kind)).toEqual(expect.arrayContaining([
      "supports", "contests", "addresses", "assesses", "supersedes", "requested-recheck-target", "paired-observation", "cites-observation",
    ]))
    expect(fixture.links.correction.relation).toBe("addresses")
    expect(fixture.records.finding.data.evidence_ids).toEqual([])
    const objective = view.connections.objectives.find(item => item.objective.id === fixture.objective.id)!
    const earlier = objective.links.find(link => link.source_id === fixture.records.initialInterpretation.id)!
    expect(earlier.confidence).toBe("uncertain")
    expect(earlier.current_relationship).toBe("rejected")
    expect(view.records.find(record => record.source.record_id === fixture.records.initialInterpretation.id)!.excerpt)
      .toContain("may be a stale-index defect")
    expect(view.records.find(record => record.source.record_id === fixture.records.laterInterpretation.id)!.excerpt)
      .toContain("original CI cause remains unproven")
    const review = view.connections.reviews.find(item => item.request.request_id === fixture.reviews.scoped.request_id)!
    expect(review.request.rechecks).toEqual([{ request_id: fixture.reviews.original.request_id,
      finding_ids: [fixture.relationships.correction.id] }])
    expect(review.request.mandate.exclusions).toContain("complete issue 182 release acceptance")
    expect(review.request.members[0]!.work_ref).toEqual(fixture.work.corrected)
    expect(review.relationships.every(item => item.review_binding.status === "unknown")).toBe(true)
    expect(view.totals.verified_outcomes).toBeNull()
    expect(view.totals.native_dispatches).toBeNull()
    for (const source of expectedOriginals(fixture)) {
      const result = (await fixture.f.invoke("record", { operation: "query", action_id: fixture.action.id,
        record_id: source.id }, fixture.sessions.reader)).result.items[0]
      expect(exact(result)).toBe(exact(source))
    }
    expect(fixture.f.sessionCreates).toEqual([])
    expect(fixture.f.sessionPrompts).toEqual([])
  } finally { await fixture.close() }
})

test("trajectory continuation pins scope, seed, selectors and owner append fences", async () => {
  const fixture = await engineeringTrajectoryFixture({ records: 240 })
  try {
    const discovery = await discover(fixture)
    const first = await readHistory(fixture, { ...discovery.records[0]!.trajectory, limit: 5 })
    expect(first.navigation.next_records).not.toBeNull()
    const bound = first.boundary.owners, version = first.boundary.owner_version
    // The original exists below the ledger boundary, but this association is new.
    await fixture.f.invoke("objective", { operation: "link", objective_id: fixture.objective.id,
      phase: "coordination", source_type: "ledger-record", source_id: fixture.unrelated.id,
      related_sequence: fixture.links.finding.sequence, relation: "contests",
      note: "New retrospective candidate appended after the investigator's navigation boundary.", confidence: "uncertain" }, fixture.sessions.reader)
    const ids = ledgerIDs(first)
    let next = first.navigation.next_records
    while (next) {
      expect(next.action_id).toBe(fixture.action.id)
      expect(next.record_id).toBe(discovery.records[0]!.source.record_id)
      expect(next.related).toBe(true)
      expect(next.through).toBe(first.boundary.observed_through)
      expect(next.owner_boundary).toEqual(bound)
      expect(next.owner_version).toBe(version)
      expect(next.limit).toBe(5)
      expect(next).not.toHaveProperty("match")
      const page = await readHistory(fixture, next)
      ids.push(...ledgerIDs(page)); next = page.navigation.next_records
    }
    expect(new Set(ids).size).toBe(ids.length)
    expect(ids.sort()).toEqual(expectedOriginals(fixture).map(record => record.id).sort())
    expect(ids).not.toContain(fixture.unrelated.id)
    const fresh = await readHistory(fixture, { action_id: fixture.action.id, record_id: fixture.records.finding.id, related: true, limit: 50 })
    expect(ledgerIDs(fresh)).toContain(fixture.unrelated.id)
  } finally { await fixture.close() }
})

test("objective roots and another investigator retain the existing review-owner boundary", async () => {
  const fixture = await engineeringTrajectoryFixture({ records: 240 })
  try {
    const objective = await readHistory(fixture, { objective_id: fixture.objective.id, related: true, limit: 50 })
    expect(objective.scope).toEqual({ objective_id: fixture.objective.id })
    expect(ledgerIDs(objective)).toEqual(expect.arrayContaining(Object.values(fixture.records).map(record => record.id)))
    expect(ledgerIDs(objective)).not.toContain(fixture.unrelated.id)
    const stranger = await readHistory(fixture, { action_id: fixture.action.id, record_id: fixture.records.finding.id, related: true }, "another-investigator")
    expect(stranger.connections.reviews).toEqual([])
    expect(JSON.stringify(stranger)).not.toContain("FOREIGN_PRIVATE_REVIEW_MANDATE")
    expect(JSON.stringify(stranger)).not.toContain(fixture.reviews.foreign.request_id)
    for (const format of ["json", "markdown", "html"]) {
      const response = await fixture.f.tools.get("history").execute({ operation: "read", ...stranger.navigation.repeat, response_format: format }, {
        sessionID: "another-investigator", agent: "author", messageID: "reader", id: "reader", signal: new AbortController().signal,
      })
      expect(response.content).not.toContain(fixture.reviews.scoped.mandate.question)
      expect(response.content).not.toContain("FOREIGN_PRIVATE_REVIEW_MANDATE")
      expect(response.content).not.toContain(fixture.reviews.foreign.request_id)
    }
  } finally { await fixture.close() }
})

test("registered JSON, Markdown and HTML preserve focused trajectory identities, scope and ready navigation", async () => {
  const fixture = await engineeringTrajectoryFixture({ records: 240 })
  try {
    const discovery = await discover(fixture), view = await readHistory(fixture, discovery.records[0]!.trajectory)
    const responses: Record<string, string> = {}
    for (const format of ["json", "markdown", "html"]) {
      const result = await fixture.f.tools.get("history").execute({ operation: "read", ...view.navigation.repeat, response_format: format }, {
        sessionID: fixture.sessions.reader, agent: "author", messageID: "reader", id: "reader", signal: new AbortController().signal,
      })
      responses[format] = result.content
      expect(fixture.f.permissionRequests.at(-1).metadata.view_sha256).toBe(hash(result.content))
      expect(Buffer.byteLength(result.content, "utf8")).toBeLessThanOrEqual(262144)
      for (const record of view.records) {
        expect(result.content).toContain(record.ref)
        expect(result.content).toContain(record.source.sha256)
      }
      expect(result.content).not.toContain("SYNTHETIC_PRIVATE_COMMAND")
      expect(result.content).not.toContain("SYNTHETIC_PRIVATE_OUTPUT")
      expect(result.content).not.toContain("FOREIGN_PRIVATE_REVIEW_MANDATE")
    }
    const html = responses.html!, markdown = responses.markdown!
    expect(html).toContain("Exact requested scope and recheck targets")
    expect(html).toContain("Observed and authored evidence scope")
    expect(html).toContain("complete issue 182 release acceptance")
    expect(html).not.toContain("<h3>Intended Plan</h3>")
    expect(html).not.toContain("<h3>Significant recorded work</h3>")
    expect(markdown).not.toContain("### Intended Plan")
    expect(markdown).not.toContain("### Significant recorded work")
    const requests = [...html.matchAll(/<pre><code>([\s\S]*?)<\/code><\/pre>/g)].flatMap(match => {
      try { return [JSON.parse(match[1]!.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&"))] } catch { return [] }
    })
    const markdownRequests = [...markdown.matchAll(/(?:^|\n)((?:    [^\n]*\n)+)/g)].flatMap(match => {
      try { return [JSON.parse(match[1]!.split("\n").map(line => line.slice(4)).join("\n"))] } catch { return [] }
    })
    for (const query of [view.navigation.repeat, ...view.records.map(record => record.trajectory),
      ...view.records.map(record => record.expand), ...view.connections.objectives.map(objective => objective.expand)]) {
      expect(requests.some(request => canonical(request) === canonical({ operation: "read", ...query }))).toBe(true)
      expect(markdownRequests.some(request => canonical(request) === canonical({ operation: "read", ...query }))).toBe(true)
    }
    const next = await readHistory(fixture, { ...view.navigation.repeat, limit: 5 })
    const nextResponse = await fixture.f.tools.get("history").execute({ operation: "read", ...next.navigation.repeat, response_format: "markdown" }, {
      sessionID: fixture.sessions.reader, agent: "author", messageID: "reader", id: "reader", signal: new AbortController().signal,
    })
    expect(nextResponse.content).toContain(JSON.stringify({ operation: "read", ...next.navigation.next_records }, null, 2).split("\n").map(line => "    " + line).join("\n"))
  } finally { await fixture.close() }
})

test("24,000-record controlled trajectory measures actual selective callbacks and exact selected originals", async () => {
  const fixture = await engineeringTrajectoryFixture()
  let baselineHost: Host | undefined
  try {
    const current = metric(), read = measured(fixture.f, fixture.sessions.reader, current)
    const discovery = await read("history", { operation: "read", action_id: fixture.action.id, match: fixture.search }) as EngineeringHistoryView
    expect(discovery.totals.records).toBe(24000)
    expect(discovery.records).toHaveLength(1)
    const trajectory = await read("history", { operation: "read", ...discovery.records[0]!.trajectory }) as EngineeringHistoryView
    const selected = new Set(ledgerIDs(trajectory)), currentOriginals: LedgerRecord[] = []
    for (const session of new Set(trajectory.records.map(record => record.source.session_id))) {
      const page = await read("record", { operation: "query", action_id: fixture.action.id, source_session_id: session, limit: 50 })
      expect(page.next_after).toBeNull()
      currentOriginals.push(...page.items.filter((record: LedgerRecord) => selected.has(record.id)))
    }
    expect(sortedOriginals(currentOriginals)).toEqual(sortedOriginals(expectedOriginals(fixture)))
    expect(current.calls).toBe(6)
    let baseline: Metric | null = null
    if (process.env.LOOM_TRAJECTORY_BASELINE_ROOT) {
      const root = resolve(process.env.LOOM_TRAJECTORY_BASELINE_ROOT)
      expect(execFileSync("git", ["-C", root, "rev-parse", "HEAD"], { encoding: "utf8" }).trim())
        .toBe("d0ff85ee09e5209058206a594f44338e088f3c10")
      execFileSync("git", ["-C", root, "diff", "--exit-code", "HEAD", "--", "src", "tests/helpers/registered-loom.ts"], { stdio: "pipe" })
      const module = await import(pathToFileURL(join(root, "tests/helpers/registered-loom.ts")).href)
      baselineHost = await module.registeredLoom([], { directory: fixture.directory, beforeSetup: async (directory: string) => {
        await writeFile(join(directory, ".loom.yaml"), "agents: {}\ninstructions: {enabled: false}\nledger: {capture: automatic}\n")
      } }) as Host
      baseline = metric()
      const oldRead = measured(baselineHost, fixture.sessions.reader, baseline)
      const found = await oldRead("history", { operation: "read", action_id: fixture.action.id, match: fixture.search })
      expect(found.records).toHaveLength(1)
      const objectives = await oldRead("objective", { operation: "find", source_type: "ledger-record", source_id: found.records[0].source.record_id })
      expect(objectives.items).toHaveLength(1)
      const objective = await oldRead("objective", { operation: "read", objective_id: objectives.items[0].id, limit: 50 })
      expect(objective.next_cursor).toBeNull()
      const sourceIDs = new Set<string>(objective.entries.filter((entry: any) => entry.source_type === "ledger-record").map((entry: any) => entry.source_id))
      const allSources: LedgerRecord[] = []
      for (const session of new Set<string>(objective.entries.map((entry: any) => entry.source_session_id).filter(Boolean))) {
        const page = await oldRead("record", { operation: "query", action_id: fixture.action.id, source_session_id: session, limit: 50 })
        expect(page.next_after).toBeNull(); allSources.push(...page.items)
      }
      // Follow only actual source citations and captured pairing, never shared
      // words, timestamps, Session identity or revision equality.
      for (let changed = true; changed;) {
        changed = false
        for (const record of allSources) if (sourceIDs.has(record.id)) {
          const linked = [...(Array.isArray(record.data.evidence_ids) ? record.data.evidence_ids : []),
            ...(typeof record.data.start_id === "string" ? [record.data.start_id] : [])]
          for (const id of linked) if (typeof id === "string" && !sourceIDs.has(id)) { sourceIDs.add(id); changed = true }
        }
      }
      const originals = allSources.filter(record => sourceIDs.has(record.id))
      const reviewIDs = new Set(originals.flatMap(record => Array.isArray(record.data.artifact_refs)
        ? record.data.artifact_refs.filter((value): value is string => typeof value === "string" && value.startsWith("loom-review://")).map(value => value.slice("loom-review://".length)) : []))
      const reviews = []
      for (const request_id of reviewIDs) reviews.push(await oldRead("review", { operation: "read", request_id, limit: 50 }))
      expect(reviews.map(review => review.request.request_id).sort()).toEqual(trajectory.connections.reviews.map(review => review.request.request_id).sort())
      expect(sortedOriginals(originals)).toEqual(sortedOriginals(currentOriginals))
      expect(baseline.calls).toBe(9)
    }
    const source_sha256 = Object.fromEntries(await Promise.all(["src/engineering-history.ts", "src/engineering-trajectories.ts",
      "src/objectives.ts", "src/review-requests.ts", "src/plugin.ts", "tests/helpers/registered-loom.ts",
      "tests/helpers/engineering-trajectory-fixture.ts", "tests/engineering-history-trajectories-native.test.ts"]
      .map(async path => [path, hash(await readFile(path, "utf8"))])))
    const result = { format: "loom-engineering-trajectory-measurement/v1", records: 24000, selected_originals: currentOriginals.length,
      source_head: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(), source_sha256,
      question: fixture.question, current, baseline, baseline_revision: baseline ? "d0ff85ee09e5209058206a594f44338e088f3c10" : null,
      selection_correct: true, full_action_enumeration: false, exact_originals_equal: baseline ? true : null,
      remaining_manual_correlation: "Both paths still require reading claims and evidence scope. The baseline joins objective sequences, source citations and review identifiers; the trajectory supplies those qualified relationships.",
      qualification: "Controlled scripted registered-tool measurement; simulated native registration/permission owner. No private operator reproduction or unfamiliar-agent comprehension claim.",
      excludes: ["fixture setup", "assertions", "live host/network", "model reasoning", "tokens", "production performance"] }
    if (process.env.LOOM_HISTORY_MEASURE_DIR) {
      await mkdir(process.env.LOOM_HISTORY_MEASURE_DIR, { recursive: true })
      await writeFile(join(process.env.LOOM_HISTORY_MEASURE_DIR, "trajectories.json"), JSON.stringify(result, null, 2) + "\n")
    }
    if (process.env.LOOM_HISTORY_MEASURE === "1") console.log("ENGINEERING_TRAJECTORY_MEASUREMENT " + JSON.stringify({ ...result,
      current: { ...current, steps: undefined }, baseline: baseline ? { ...baseline, steps: undefined } : null }))
  } finally { await baselineHost?.close(); await fixture.close() }
})
