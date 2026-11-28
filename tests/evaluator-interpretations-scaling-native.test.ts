import { expect, test } from "bun:test"
import { createHash } from "node:crypto"
import { appendFileSync } from "node:fs"
import { join } from "node:path"
import { digest } from "../src/model.js"
import { registeredLoom } from "./helpers/registered-loom.js"
import { openState } from "./helpers/evaluator-execution-fixture.js"
import { publicationFixture } from "./helpers/evaluator-publication-fixture.js"
import { expectInterpretationUnavailable } from "./helpers/evaluator-public-failure.js"

function expectedResources(path: string, populations: Array<ReturnType<typeof publicationFixture>["population"]>) {
  const expected = new Set([join(path, "ledger.sqlite"), join(path, "learning.sqlite")])
  const scope = (name: string, views: string[]) => {
    expected.add("loom:evidence:discover:" + name)
    for (const view of views) {
      expected.add(`loom:evidence:inspect:${name}:view:${view}`)
      expected.add(`loom:evidence:disclose:${name}:view:${view}:recipient:owner`)
    }
  }
  scope("session:owner", ["engineering-history", "retrospective-population"])
  for (const population of populations) {
    scope("population:" + encodeURIComponent(population.population_id), ["retrospective-population"])
    for (const member of population.manifest.members)
      scope("session:owner:record:" + encodeURIComponent(member.source.id), ["record-full"])
  }
  return expected
}

async function fixture(members: number, gaps = false) {
  const host = await registeredLoom()
  const path = join(host.directory, "state", "loom", "actions-v1", digest({ project: "tool-help", canonical: host.directory }))
  const state = openState(path)
  const controlled = publicationFixture(state, { session_id: "owner", agent: "author" }, { members, gaps,
    authorityPath: join(host.directory, "authority.sqlite") })
  try {
    await controlled.execute()
    const report = await controlled.publish()
    const expected = expectedResources(path, [controlled.population])
    const read = (input: Record<string, unknown>) => host.tools.get("insights").execute({
      operation: "evaluation-interpretation", batch_id: report.batch_id, ...input,
    }, { sessionID: "owner", agent: "author", messageID: "scaling-message", id: "scaling-call", signal: new AbortController().signal })
    return { host, state, controlled, report, expected, read,
      async close() { host.permission.beforeReturn = undefined; controlled.close(); state.close(); await host.close() } }
  } catch (error) { controlled.close(); state.close(); await host.close(); throw error }
}

type Fixture = Awaited<ReturnType<typeof fixture>>

/** Measure the registered production callback, not a direct service reader.
 * The native permission owner is simulated with zero delay. Discard its captured
 * request arrays so retained test logs cannot create artificial quadratic memory.
 * Latency includes this instrumentation; sampled memory is not an allocator peak.
 */
async function measure(f: Fixture, name: string, input: Record<string, unknown>, budget?: { members: number; calls: number; resources: number }) {
  f.host.permissionRequests.length = 0
  Bun.gc(true)
  const before = process.memoryUsage(), highWaterBefore = process.resourceUsage().maxRSS
  let calls = 0, visits = 0, largest = 0, heapPeak = before.heapUsed, rssPeak = before.rss
  let final: any
  const sample = () => {
    const current = process.memoryUsage()
    heapPeak = Math.max(heapPeak, current.heapUsed); rssPeak = Math.max(rssPeak, current.rss)
  }
  f.host.permission.beforeReturn = async () => {
    const request = f.host.permissionRequests.pop()
    calls++; visits += request.resources?.length ?? 0; largest = Math.max(largest, request.resources?.length ?? 0)
    if (request.metadata?.view_sha256) final = request
    if (calls % 64 === 0 || request.metadata?.view_sha256) sample()
  }
  const started = performance.now()
  let output: { content: string }
  try { output = await f.read(input) }
  finally { f.host.permission.beforeReturn = undefined }
  const elapsed = performance.now() - started
  sample()
  const after = process.memoryUsage()
  const metrics = { name, members: budget?.members ?? f.controlled.population.manifest.members.length, elapsed_ms: elapsed,
    permission_calls: calls, cumulative_resource_visits: visits, maximum_resources: largest, final_union_count: final?.resources?.length,
    response_bytes: Buffer.byteLength(output.content), heap_before: before.heapUsed, heap_after: after.heapUsed,
    sampled_heap_peak: heapPeak, sampled_heap_growth: heapPeak - before.heapUsed,
    rss_before: before.rss, rss_after: after.rss, sampled_rss_peak: rssPeak, sampled_rss_growth: rssPeak - before.rss,
    process_rss_high_water_before_kib: highWaterBefore, process_rss_high_water_after_kib: process.resourceUsage().maxRSS }
  if (process.env.LOOM_S5_REGISTERED_METRICS) appendFileSync(process.env.LOOM_S5_REGISTERED_METRICS,
    JSON.stringify({ format: "loom-s5-registered-reader-measurement/v1", ...metrics }) + "\n")
  expect(calls).toBeLessThanOrEqual(budget?.calls ?? 16)
  expect(visits).toBeLessThanOrEqual(budget?.resources ?? metrics.members * 12 + 128)
  expect(final?.metadata?.view_sha256).toBe(createHash("sha256").update(output.content).digest("hex"))
  expect(new Set(final.resources)).toEqual(f.expected)
  expect(f.host.permissionRequests).toHaveLength(0)
  return { ...output, metrics }
}

test("registered readers exhaust more than 500 members with bounded linear permission work and exact final disclosure", async () => {
  const smaller = await fixture(257)
  let reference: Awaited<ReturnType<typeof measure>>["metrics"]
  try { reference = (await measure(smaller, "overview-257", { section: "overview" })).metrics }
  finally { await smaller.close() }
  const f = await fixture(517)
  try {
    const overview = await measure(f, "overview-517", { section: "overview" })
    // Twice the members must not restore a quadratic resource-assertion loop.
    expect(overview.metrics.cumulative_resource_visits).toBeLessThanOrEqual(reference.cumulative_resource_visits * 2.2)
    expect(overview.metrics.permission_calls).toBeLessThanOrEqual(reference.permission_calls + 4)
    const keys = new Set<string>(), pages = []
    let next: Record<string, unknown> | null = { section: "sources", limit: 100 }
    while (next) {
      const measured = await measure(f, "sources-" + (pages.length + 1), next)
      const page = JSON.parse(measured.content).result
      expect(page.report_id).toBe(f.report.report_id); expect(page.report_sha256).toBe(f.report.report_sha256)
      expect(page.coverage.from).toBe(keys.size)
      for (const source of page.items) {
        expect(keys.has(source.member_key)).toBe(false); keys.add(source.member_key)
        expect(source.selected).toBe(true)
        expect(source.inspect.population_id).toBe(f.controlled.population.population_id)
      }
      expect(page.coverage.to).toBe(keys.size)
      pages.push(measured.metrics)
      next = page.navigation.next
      expect(pages.length).toBeLessThan(20)
    }
    expect(keys.size).toBe(517); expect(pages.length).toBeGreaterThan(1)
    for (const response_format of ["markdown", "html"])
      await measure(f, response_format, { section: "claims", limit: 2, response_format })
    expect(f.controlled.base.counts()).toEqual({ reservations: 1, consumed: 1, execute_calls: 1, effects: 1 })
    expect(f.host.sessionCreates).toEqual([]); expect(f.host.sessionPrompts).toEqual([]); expect(f.host.nativeInputs).toEqual([])
    console.log("S5 registered reader measurements", JSON.stringify({
      permission_owner: "zero-delay simulated native authority", memory: "sampled at every 64 assertions and read boundaries; process high-water is cumulative",
      reference, overview: overview.metrics, source_pages: pages.length,
      source_elapsed_ms: pages.reduce((sum, page) => sum + page.elapsed_ms, 0),
      source_permission_calls: pages.map(page => page.permission_calls),
      source_resource_visits: pages.map(page => page.cumulative_resource_visits),
      maximum_sampled_heap_growth: Math.max(...pages.map(page => page.sampled_heap_growth)),
      maximum_sampled_rss_growth: Math.max(...pages.map(page => page.sampled_rss_growth)),
    }))
  } finally { await f.close() }
}, 60000)

test("large registered continuations recheck uncited sources and the exact final response instead of retaining grants", async () => {
  const f = await fixture(517, true)
  try {
    const first = JSON.parse((await measure(f, "denial-first", { section: "sources", limit: 2 })).content).result
    expect(first.navigation.next).not.toBeNull()
    const uncited = f.controlled.population.manifest.members.find(member => member.availability === "available"
      && member.key !== f.controlled.retrieved[0]!.member_key)!
    expect(uncited.key).not.toBe(f.controlled.retrieved[0]!.member_key)
    const resource = `loom:evidence:disclose:session:owner:record:${encodeURIComponent(uncited.source.id)}:view:record-full:recipient:owner`
    f.host.permission.beforeReturn = async () => {
      if (f.host.permissionRequests.at(-1)?.resources?.includes(resource)) throw new Error("Uncited large source denied")
    }
    await expectInterpretationUnavailable(f.read(first.navigation.next))
    const frozenGap = f.controlled.population.manifest.members.find(member => member.availability !== "available")!
    expect(frozenGap).toBeDefined()
    const gapResource = `loom:evidence:disclose:session:owner:record:${encodeURIComponent(frozenGap.source.id)}:view:record-full:recipient:owner`
    f.host.permission.beforeReturn = async () => {
      if (f.host.permissionRequests.at(-1)?.resources?.includes(gapResource)) throw new Error("Frozen gap source denied")
    }
    for (const input of [{ section: "overview" }, first.navigation.next,
      { section: "claims", response_format: "markdown" }, { section: "claims", response_format: "html" }])
      await expectInterpretationUnavailable(f.read(input))
    await expectInterpretationUnavailable(f.host.invoke("insights", { operation: "evaluation-interpretations", limit: 1 }, "owner"))
    f.host.permission.beforeReturn = async () => {
      if (f.host.permissionRequests.at(-1)?.metadata?.view_sha256) throw new Error("Final large response denied")
    }
    await expectInterpretationUnavailable(f.read({ section: "claims", response_format: "html" }))
    let relocated = false
    f.host.permission.beforeReturn = async () => {
      const request = f.host.permissionRequests.at(-1)
      if (!request?.metadata?.view_sha256 && request?.resources?.length === f.expected.size) {
        relocated = true
        f.host.sessions.set("owner", { id: "owner", projectID: "tool-help", location: { directory: "/different-project" } })
      }
    }
    await expectInterpretationUnavailable(f.read({ section: "overview" }))
    expect(relocated).toBe(true)
    f.host.sessions.delete("owner")
    f.host.permission.beforeReturn = undefined
    f.state.ledger.query("DELETE FROM ledger WHERE id=?").run(uncited.source.id)
    await expectInterpretationUnavailable(f.read(first.navigation.next))
    expect(f.state.learning.automatic.history.readEvaluatorInterpretation(f.report.batch_id, "owner")!.report.id).toBe(f.report.report_id)
    expect(f.controlled.base.counts().effects).toBe(1)
  } finally { await f.close() }
}, 60000)

test("registered report lists keep permission work linear across 20 populations and 520 members", async () => {
  const f = await fixture(26)
  const controlled = [f.controlled], reports = [f.report]
  try {
    for (let index = 1; index < 20; index++) {
      const next = publicationFixture(f.state, { session_id: "owner", agent: "author" }, { members: 26,
        authorityPath: join(f.host.directory, "list-authority-" + index + ".sqlite") })
      controlled.push(next)
      await next.execute(); reports.push(await next.publish())
    }
    const results = []
    for (const count of [10, 20]) {
      const selected = controlled.slice(-count)
      const expected = expectedResources(f.state.path, selected.map(item => item.population))
      const reader = { ...f, expected, read: (input: Record<string, unknown>) => f.host.tools.get("insights").execute({
        operation: "evaluation-interpretations", ...input,
      }, { sessionID: "owner", agent: "author", messageID: "list-scaling", id: "list-scaling", signal: new AbortController().signal }) }
      const measured = await measure(reader, "list-populations-" + count, { limit: count }, {
        members: count * 26, calls: 4 * count + 8, resources: 4 * expected.size + 2 * count,
      })
      const page = JSON.parse(measured.content).result
      expect(page.items).toHaveLength(count)
      expect(new Set(page.items.map((item: any) => item.report_id))).toEqual(new Set(reports.slice(-count).map(report => report.report_id)))
      results.push(measured.metrics)
    }
    expect(results[1]!.cumulative_resource_visits).toBeLessThanOrEqual(results[0]!.cumulative_resource_visits * 2.2)
    expect(results[1]!.permission_calls).toBeLessThanOrEqual(results[0]!.permission_calls * 2 + 4)
    // Denial on one uncited source in the oldest included population withholds
    // the entire list, including counts and its continuation.
    const member = controlled[0]!.population.manifest.members.find(item => item.key !== controlled[0]!.retrieved[0]!.member_key)!
    const resource = `loom:evidence:disclose:session:owner:record:${encodeURIComponent(member.source.id)}:view:record-full:recipient:owner`
    f.host.permission.beforeReturn = async () => {
      if (f.host.permissionRequests.at(-1)?.resources?.includes(resource))
        throw Object.assign(new Error("Hidden list population count=20"), { count: 20, cursor: "hidden-continuation" })
    }
    await expectInterpretationUnavailable(f.host.invoke("insights", { operation: "evaluation-interpretations", limit: 20 }, "owner"))
    for (const item of controlled) expect(item.base.counts().effects).toBe(1)
    expect(f.host.sessionCreates).toEqual([]); expect(f.host.sessionPrompts).toEqual([])
    console.log("S5 registered multi-population measurements", JSON.stringify({
      permission_owner: "zero-delay simulated native authority", memory: "sampled maxima, not process peak bounds", results,
    }))
  } finally {
    f.host.permission.beforeReturn = undefined
    for (const item of controlled.slice(1)) item.close()
    await f.close()
  }
}, 60000)
