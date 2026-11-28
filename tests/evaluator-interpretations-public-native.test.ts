import { expect, test } from "bun:test"
import { join } from "node:path"
import { digest } from "../src/model.js"
import { EvaluatorInterpretations } from "../src/evaluator-interpretations.js"
import { registeredLoom } from "./helpers/registered-loom.js"
import { openState } from "./helpers/evaluator-execution-fixture.js"
import { publicationFixture } from "./helpers/evaluator-publication-fixture.js"

async function fixture() {
  const host = await registeredLoom()
  const path = join(host.directory, "state", "loom", "actions-v1", digest({ project: "tool-help", canonical: host.directory }))
  const state = openState(path), controlled = publicationFixture(state, { session_id: "owner", agent: "author" }, { claims: 37, authorityPath: join(host.directory, "authority.sqlite") })
  try {
    await controlled.execute()
    const report = await controlled.publish()
    const read = async (input: Record<string, unknown>, session = "owner") =>
      (await host.invoke("insights", { operation: "evaluation-interpretation", batch_id: controlled.prepared.batch_id, ...input }, session)).result
    const render = (format: "html" | "markdown", section = "claims") => host.tools.get("insights").execute({
      operation: "evaluation-interpretation", batch_id: controlled.prepared.batch_id, section, limit: 2, response_format: format,
    }, { sessionID: "owner", agent: "author", messageID: "report-message", id: "report-call", signal: new AbortController().signal })
    return { host, state, controlled, report, read, render, async close() { controlled.close(); state.close(); await host.close() } }
  } catch (error) { controlled.close(); state.close(); await host.close(); throw error }
}

test("registered S5 readers expose every conclusion with exact evidence navigation and no inference capability", async () => {
  const f = await fixture()
  try {
    const original = f.controlled.base.counts()
    let page = await f.read({ section: "claims", limit: 6 }), count = 0, pages = 0
    const claims: string[] = []
    do {
      pages++
      expect(page.report_id).toBe(f.report.report_id)
      expect(page.report_sha256).toBe(f.report.report_sha256)
      expect(page.coverage.from).toBe(count)
      claims.push(...page.items.map((item: any) => item.claim_id)); count += page.items.length
      expect(page.coverage.to).toBe(count)
      expect(page.navigation.sections.every((item: any) => item.operation === "evaluation-interpretation" && item.batch_id === f.report.batch_id)).toBe(true)
      expect(JSON.stringify(page)).not.toContain("original_result_text")
      if (!page.navigation.next) break
      page = await f.read(page.navigation.next)
    } while (pages < 30)
    expect(pages).toBeGreaterThan(1); expect(count).toBe(37); expect(new Set(claims).size).toBe(37)
    const sources = await f.read({ section: "sources" })
    expect(sources.items).toHaveLength(3)
    expect(sources.items.filter((source: any) => source.retrieved && source.cited)).toHaveLength(1)
    expect(sources.items.filter((source: any) => source.selected && !source.retrieved && !source.cited)).toHaveLength(2)
    const originalSource = (await f.host.invoke("history", sources.items.find((source: any) => source.cited).inspect, "owner")).result
    expect(originalSource.status).toBe("available")
    expect(JSON.stringify(originalSource)).toContain("Controlled original")
    const list = (await f.host.invoke("insights", { operation: "evaluation-interpretations", limit: 1 }, "owner")).result
    expect(list.items[0].report_id).toBe(f.report.report_id)
    expect((await f.read(list.items[0].inspect)).report_sha256).toBe(f.report.report_sha256)
    for (const format of ["html", "markdown"] as const) {
      const result = await f.render(format)
      expect(result.content).toContain("Preserve the stated verification scope")
      expect(Buffer.byteLength(result.content)).toBeLessThanOrEqual(262144)
      expect(result.content).not.toContain("original_result_text")
    }
    expect(f.controlled.base.counts()).toEqual(original)
    expect(f.host.sessionCreates).toEqual([]); expect(f.host.sessionPrompts).toEqual([]); expect(f.host.nativeInputs).toEqual([])
    await expect(f.host.invoke("insights", { operation: "evaluation", batch_id: f.report.batch_id }, "owner")).rejects.toThrow()
    await expect(f.host.invoke("insights", { operation: "evaluation-observations", batch_id: f.report.batch_id, member_key: f.controlled.population.manifest.members[0]!.key, report_id: f.report.report_id }, "owner")).rejects.toThrow()
  } finally { await f.close() }
})

test("metadata, lists, pages and human views require the uncited source disclosure union", async () => {
  const f = await fixture()
  try {
    const uncited = f.controlled.population.manifest.members[1]!.source
    f.host.permission.beforeReturn = async () => {
      const request = f.host.permissionRequests.at(-1)
      if (request.resources?.some((resource: string) => resource.includes(`:record:${uncited.id}:`) && resource.includes(":disclose:") && resource.includes(":view:record-full:")))
        throw new Error("Uncited source disclosure denied")
    }
    for (const run of [() => f.read({ section: "overview" }), () => f.read({ section: "sources", limit: 1 }),
      () => f.host.invoke("insights", { operation: "evaluation-interpretations" }, "owner"), () => f.render("markdown"), () => f.render("html")])
      await expect(run()).rejects.toThrow("Uncited source disclosure denied")
    expect(f.controlled.base.counts().effects).toBe(1)
  } finally { f.host.permission.beforeReturn = undefined; await f.close() }
})

test("current loss of an uncited original withholds the entire retained interpretation", async () => {
  const f = await fixture()
  try {
    const member = f.controlled.population.manifest.members[1]!
    f.state.ledger.query("DELETE FROM ledger WHERE id=?").run(member.source.id)
    for (const run of [() => f.read({}), () => f.read({ section: "gaps" }),
      () => f.host.invoke("insights", { operation: "evaluation-interpretations" }, "owner"), () => f.render("html")])
      await expect(run()).rejects.toThrow("source unavailable or changed")
    const saved = f.state.learning.automatic.history.readEvaluatorInterpretation(f.report.batch_id, "owner")
    expect(saved!.report.id).toBe(f.report.report_id)
    expect(saved!.report.body.interpretation.claims).toHaveLength(37)
  } finally { await f.close() }
})

test("final serialized-response authorization can deny both human representations", async () => {
  const f = await fixture()
  try {
    f.host.permission.beforeReturn = async () => {
      if (f.host.permissionRequests.at(-1)?.metadata?.view_sha256) throw new Error("Final report disclosure revoked")
    }
    for (const format of ["html", "markdown"] as const) await expect(f.render(format)).rejects.toThrow("Final report disclosure revoked")
    expect(f.controlled.base.counts().effects).toBe(1)
  } finally { f.host.permission.beforeReturn = undefined; await f.close() }
})

test("foreign owners, mixed fields and a forged continuation cannot disclose S5 content", async () => {
  const f = await fixture()
  try {
    await expect(f.read({}, "foreign")).rejects.toThrow()
    const page = await f.read({ section: "claims", limit: 1 })
    await expect(f.read({ ...page.navigation.next, report_sha256: "f".repeat(64) })).rejects.toThrow("identity changed")
    await expect(f.read({ ...page.navigation.next, section: "sources" })).rejects.toThrow("cursor")
    await expect(f.read({ original_result_text: "caller-import" })).rejects.toThrow("Invalid evaluator interpretation read")
    await expect(f.read({ authority: true })).rejects.toThrow("Invalid evaluator interpretation read")
    await expect(f.host.invoke("insights", { operation: "evaluation-status", section: "claims" }, "owner")).rejects.toThrow("Interpretation fields")
    for (const operation of ["publish-evaluation", "import-interpretation", "execute-evaluation"])
      await expect(f.host.invoke("insights", { operation, batch_id: f.report.batch_id }, "owner")).rejects.toThrow()
    expect(f.controlled.base.counts().effects).toBe(1)
  } finally { await f.close() }
})

test("an older report does not disclose the existence of a later restricted interpretation", async () => {
  const f = await fixture()
  const later = publicationFixture(f.state, { session_id: "owner", agent: "author" }, { authorityPath: join(f.host.directory, "later-authority.sqlite") })
  try {
    const before = await f.read({ section: "overview" })
    later.interpretation.prior_interpretations.push({ report_id: f.report.report_id, report_sha256: f.report.report_sha256,
      relation: "contests", reason: "Controlled later evidence limits the earlier conclusion." })
    await later.execute()
    const revised = await later.publish()
    const withoutUnion = new EvaluatorInterpretations(f.state.learning.automatic.history, f.state.learning.populations,
      { authorize: later.authorize, resolve: later.resolve })
    await expect(withoutUnion.read(later.actor, { operation: "evaluation-interpretation", batch_id: revised.batch_id }))
      .rejects.toThrow("union authority unavailable")
    expect(f.state.learning.automatic.history.get(f.report.batch_id, "owner").state).toBe("stale")
    f.host.permission.beforeReturn = async () => {
      if (f.host.permissionRequests.at(-1)?.resources?.some((resource: string) => resource.includes("population:" + later.population.population_id)))
        throw new Error("Later interpretation source denied")
    }
    const after = await f.read({ section: "overview" })
    expect(after).toEqual(before)
    expect(after.revision_status).toBe("not-assessed-by-this-view")
    await expect(f.read({ batch_id: revised.batch_id })).rejects.toThrow("Later interpretation source denied")
    await expect(f.host.invoke("insights", { operation: "evaluation-interpretations" }, "owner")).rejects.toThrow("Later interpretation source denied")
  } finally { later.close(); f.host.permission.beforeReturn = undefined; await f.close() }
})
