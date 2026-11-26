import { expect, spyOn, test } from "bun:test"
import { createHash } from "node:crypto"
import { Database } from "bun:sqlite"
import { mkdir, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { EngineeringHistory } from "../src/engineering-history.js"
import { Store } from "../src/store.js"
import { digest } from "../src/model.js"
import { registeredLoom } from "./helpers/registered-loom.js"

type Fixture = Awaited<ReturnType<typeof registeredLoom>>
const execute = (f: Fixture, input: unknown, sessionID = "reader") => f.tools.get("history").execute(input,
  { sessionID, agent: "author", messageID: "history-read", id: "history-call", signal: new AbortController().signal })
const openFixtureStore = (f: Fixture) => {
  const db = new Database(join(f.directory, "state", "loom", "actions-v1",
    digest({ project: "tool-help", canonical: f.directory }), "ledger.sqlite"))
  return { db, store: new Store(db) }
}

async function trajectory(unrelated = 0) {
  const f = await registeredLoom()
  try {
    const action = (await f.invoke("action", { operation: "create", title: "Restore freshness", goal: "Investigate the original failure and scoped correction" })).result
    const records = []
    for (const item of [
      { session: "initial", kind: "concern", statement: "Original coarse failure; watcher-first cause remains unproven." },
      { session: "initial", kind: "result", statement: "Unchanged-code rerun passed. This did not verify the later correction." },
      { session: "correction", kind: "result", statement: "Corrected the fixture on a distinct revision." },
      { session: "subtests", kind: "assessment", statement: "Both named subtests passed on the corrected head; this is a scoped recheck.", verdict: "pass" },
      { session: "suite", kind: "qa", statement: "Separate suite-level race result passed; historical cause remains unproven.", verdict: "pass" },
    ]) records.push((await f.invoke("record", { operation: "add", action_id: action.id, kind: item.kind,
      statement: item.statement, ...(item.verdict ? { verdict: item.verdict } : {}),
      artifact_refs: ["https://example.test/controlled-source"], evidence_ids: [] }, item.session)).result)
    for (let n = 0; n < unrelated; n++) for (let i = 0; i < 3; i++) await f.invoke("record", {
      operation: "add", action_id: action.id, kind: "claim", statement: `Unrelated branch ${n}, activity ${i}`,
    }, "unrelated_" + n)
    f.permissionRequests.length = 0
    return { f, action, records }
  } catch (error) { await f.close(); throw error }
}

test("registered history starts at an Action, selects relevant branches and resolves exact stored originals", async () => {
  const { f, action, records } = await trajectory(257)
  try {
    const view = (await f.invoke("history", { operation: "read", action_id: action.id }, "reader")).result
    expect(view.totals.records).toBe(776)
    expect(view.totals.sessions).toBe(261)
    expect(view.totals.concerns).toBe(1)
    expect(view.totals.verified_outcomes).toBeNull()
    expect(view.totals.native_dispatches).toBeNull()
    expect(view.coverage.branches_omitted).toBeGreaterThan(0)
    expect(view.intended_plan).toBeNull()
    const concern = view.highlights.find((r: any) => r.kind === "concern")
    expect(concern.excerpt).toContain("cause remains unproven")
    const selected = (await f.invoke("history", { operation: "read", ...concern.expand }, "reader")).result
    expect(selected.records.map((r: any) => r.source.record_id)).toContain(concern.source.record_id)
    const sourceSession = selected.ancestors.find((branch: any) => branch.kind === "session")
    expect(sourceSession).toBeDefined()
    const expanded = (await f.invoke("history", { operation: "read", ...sourceSession.expand }, "reader")).result
    expect(expanded.records.map((r: any) => r.source.record_id).sort()).toEqual(records.slice(0, 2).map(r => r.id).sort())
    expect(expanded.records.every((r: any) => r.meaning === "authored")).toBe(true)
    expect(expanded.records.map((r: any) => r.excerpt).join(" ")).toContain("did not verify the later correction")
    const original = (await f.invoke("record", concern.source.query, "reader")).result
    expect(original.items[0]).toMatchObject(records[0])
    expect(f.nativeListRequests).toEqual([])
    expect(f.sessionCreates).toEqual([])
    expect(f.sessionPrompts).toEqual([])
    expect(f.nativeInputs).toEqual([])
  } finally { await f.close() }
})

test("Session-only history does not expand Action or Plan content through a stored link", async () => {
  const { f, action } = await trajectory()
  try {
    await f.invoke("plan", { operation: "save", action_id: action.id, expected_revision: 0,
      nodes: [{ id: "secret-plan", kind: "task", title: "PRIVATE_PLAN_CONTENT" }] })
    const view = (await f.invoke("history", { operation: "read", session_id: "initial" }, "reader")).result
    expect(view.intended_plan).toBeNull()
    expect(view.intent.goal).toBeNull()
    expect(JSON.stringify(view)).not.toContain("PRIVATE_PLAN_CONTENT")
    expect(JSON.stringify(view)).not.toContain(action.goal)
    expect(view.totals.records).toBe(2)
  } finally { await f.close() }
})

test("history rejects forged authority, ambiguous scope and unsupported operations", async () => {
  const { f, action } = await trajectory()
  try {
    for (const input of [
      { operation: "read" },
      { operation: "read", action_id: action.id, session_id: "initial" },
      { operation: "freeze", action_id: action.id },
      { operation: "read", action_id: action.id, recipient_session_id: "other" },
      { operation: "read", action_id: action.id, approved: true },
      { operation: "read", action_id: action.id, response_format: "raw" },
    ]) await expect(execute(f, input)).rejects.toThrow()
    expect(f.permissionRequests).toEqual([])
  } finally { await f.close() }
})

test("initial discovery denial prevents metadata preflight and projection", async () => {
  const { f, action } = await trajectory()
  const preflight = spyOn(EngineeringHistory.prototype, "authorizationSessions")
  const read = spyOn(EngineeringHistory.prototype, "read")
  try {
    f.permission.error = new Error("controlled denial")
    await expect(execute(f, { operation: "read", action_id: action.id })).rejects.toThrow("controlled denial")
    expect(preflight).not.toHaveBeenCalled()
    expect(read).not.toHaveBeenCalled()
  } finally { preflight.mockRestore(); read.mockRestore(); await f.close() }
})

test("contributing Session denial withholds the complete derived Action view before body inspection", async () => {
  const { f, action } = await trajectory()
  const read = spyOn(EngineeringHistory.prototype, "read")
  try {
    f.permission.beforeReturn = async () => {
      if (f.permissionRequests.at(-1).resources.includes("loom:evidence:inspect:session:initial:view:engineering-history"))
        throw new Error("source Session denied")
    }
    for (const response_format of ["json", "markdown", "html"]) await expect(execute(f,
      { operation: "read", action_id: action.id, response_format })).rejects.toThrow("source Session denied")
    expect(read).not.toHaveBeenCalled()
  } finally { read.mockRestore(); await f.close() }
})

for (const response_format of ["json", "markdown", "html"]) {
  test(`history ${response_format} final decision hashes exactly returned bytes and rejects final denial`, async () => {
    const { f, action } = await trajectory()
    try {
      const response = await execute(f, { operation: "read", action_id: action.id, response_format })
      const final = f.permissionRequests.at(-1)
      expect(final.metadata.view_sha256).toBe(createHash("sha256").update(response.content).digest("hex"))
      expect(final.resources).toContain("loom:evidence:disclose:session:initial:view:engineering-history:recipient:reader")
      if (response_format === "json") expect(JSON.parse(response.content).result.format).toBe("loom-engineering-history/v1")
      if (response_format === "html") expect(response.content).toContain("<details")
      f.permission.beforeReturn = async () => {
        if (f.permissionRequests.at(-1).metadata?.view_sha256) throw new Error("final read denied")
      }
      await expect(execute(f, { operation: "read", action_id: action.id, response_format })).rejects.toThrow("final read denied")
    } finally { await f.close() }
  })
}

test("contributor added during permission wait cannot be inspected under prior grants", async () => {
  const { f, action } = await trajectory()
  const read = spyOn(EngineeringHistory.prototype, "read")
  try {
    let added = false
    f.permission.beforeReturn = async () => {
      if (!added && f.permissionRequests.at(-1).resources.includes("loom:evidence:inspect:session:initial:view:engineering-history")) {
        added = true
        await f.invoke("record", { operation: "add", action_id: action.id, kind: "concern", statement: "PRIVATE_NEW_SOURCE" }, "new-source")
      }
    }
    await expect(execute(f, { operation: "read", action_id: action.id })).rejects.toThrow("membership changed")
    expect(read).not.toHaveBeenCalled()
  } finally { read.mockRestore(); await f.close() }
})

test("evidence resource components cannot alias a different Session or recipient", async () => {
  const { f, action } = await trajectory()
  try {
    await f.invoke("record", { operation: "add", action_id: action.id, kind: "concern", statement: "Encoded identity" }, "source:view:other")
    await execute(f, { operation: "read", action_id: action.id }, "reader:other")
    const final = f.permissionRequests.at(-1)
    expect(final.resources).toContain("loom:evidence:disclose:session:source%3Aview%3Aother:view:engineering-history:recipient:reader%3Aother")
    expect(final.resources.some((resource: string) => resource.includes("session:source:view:other"))).toBe(false)
  } finally { await f.close() }
})

test("a history reference cannot grant exact original record retrieval", async () => {
  const { f, action } = await trajectory()
  try {
    const view = (await f.invoke("history", { operation: "read", action_id: action.id }, "reader")).result
    const concern = view.highlights.find((record: any) => record.kind === "concern")
    expect(concern.source.query.source_session_id).toBe("initial")
    f.permission.beforeReturn = async () => {
      if (f.permissionRequests.at(-1).resources.some((resource: string) => resource.includes(":view:record-full")))
        throw new Error("original source denied")
    }
    await expect(f.invoke("record", concern.source.query, "reader")).rejects.toThrow("original source denied")
  } finally { await f.close() }
})

test("pre-authorization contributor limits return no protected count or threshold", async () => {
  const f = await registeredLoom(), { db, store } = openFixtureStore(f)
  try {
    const action = store.create("Protected scope", "Read only when all source grants exist", { session_id: "owner", agent: "author" })
    for (let i = 0; i < 2001; i++) store.record({ session_id: "private_" + i, agent: "author" }, { action_id: action.id },
      { kind: "claim", statement: "Protected contributor" })
    f.permission.beforeReturn = async () => {
      if (f.permissionRequests.at(-1).resources.some((resource: string) => resource.includes(":session:private_")))
        throw new Error("Contributor denied")
    }
    let failure: unknown
    try { await execute(f, { operation: "read", action_id: action.id }) } catch (error) { failure = error }
    expect(failure).toBeInstanceOf(Error)
    expect((failure as Error).message).toBe("Engineering history scope unavailable")
    expect((failure as Error).message).not.toMatch(/2000|2001|count|exceed|private_|threshold/)
    expect(f.permissionRequests).toHaveLength(3)
    expect(f.permissionRequests[2].resources.some((resource: string) => resource.endsWith("ledger.sqlite"))).toBe(true)
  } finally { db.close(); await f.close() }
})

test("a minimum-page dense overview remains available in all three formats without relaxing the response cap", async () => {
  const f = await registeredLoom(), { db, store } = openFixtureStore(f)
  try {
    const author = { session_id: "source", agent: "author" }
    const action = store.create("Dense citations", "Review observed work. ".repeat(700), author), focus = { action_id: action.id }
    const observations = Array.from({ length: 20 }, () => store.observe(author, focus, { tool: "shell", phase: "started" }))
    for (const item of [
      { kind: "assessment", verdict: "fail" }, { kind: "concern" }, { kind: "qa", verdict: "inconclusive" },
      { kind: "result" }, { kind: "assessment", verdict: "pass" },
    ] as const) for (let i = 0; i < 2; i++) store.record(author, focus, { ...item,
      statement: `A ${item.kind} with exact observation citations. `.repeat(18), evidence_ids: observations.map(record => record.id) })
    for (let i = 0; i < 2; i++) store.observe(author, focus, { tool: "shell", phase: "finished", status: "error" })
    const json = await execute(f, { operation: "read", action_id: action.id, limit: 1 })
    const view = JSON.parse(json.content).result
    expect(view.totals.records).toBe(32)
    expect(view.totals.reported_failures).toBe(2)
    expect(view.totals.observed_tool_errors).toBe(2)
    for (const response_format of ["markdown", "html"]) {
      const response = await execute(f, { operation: "read", action_id: action.id, limit: 1, response_format })
      expect(Buffer.byteLength(response.content)).toBeLessThanOrEqual(262144)
      for (const record of view.highlights) expect(response.content).toContain(record.source.record_id)
      expect(f.permissionRequests.at(-1).metadata.view_sha256).toBe(createHash("sha256").update(response.content).digest("hex"))
    }
    expect(Buffer.byteLength(json.content)).toBeLessThanOrEqual(262144)
  } finally { db.close(); await f.close() }
})

test("the original single-concern fixture admits an optimized two-call record baseline", async () => {
  const { f, action, records } = await trajectory(257)
  try {
    const run = async (name: string, input: unknown, metric: { calls: number; bytes: number; ms: number }) => {
      const start = performance.now()
      const response = await f.tools.get(name).execute(input, { sessionID: "reader", agent: "author",
        messageID: "measurement", id: "measurement-call", signal: new AbortController().signal })
      metric.ms += performance.now() - start; metric.calls++; metric.bytes += Buffer.byteLength(response.content)
      return JSON.parse(response.content).result
    }
    // Equivalent need: identify every record in the branch containing the coarse
    // failure and retrieve those exact stored records. Neither path starts with
    // the branch, source Session or record IDs.
    // #251 already supports kind and source-Session filters. A baseline that
    // enumerates all 776 records unfairly handicaps that existing interface.
    const legacy = { calls: 0, bytes: 0, ms: 0 }
    const concerns = await run("record", { operation: "query", action_id: action.id,
      record_kinds: ["concern"], limit: 50 }, legacy)
    const legacyConcern = concerns.items.find((record: any) => record.data.statement.includes("coarse"))
    expect(legacyConcern).toBeDefined()
    const selectedSource = await run("record", { operation: "query", action_id: action.id,
      source_session_id: legacyConcern.session_id, limit: 50 }, legacy)
    expect(selectedSource.next_after).toBeNull()
    const legacyBranch: any[] = selectedSource.items
    const progressive = { calls: 0, bytes: 0, ms: 0 }
    const overview = await run("history", { operation: "read", action_id: action.id }, progressive)
    const concern = overview.highlights.find((record: any) => record.kind === "concern" && record.excerpt.includes("coarse"))
    // The new path can use the same efficient existing bulk source query once
    // its overview reveals the contributor. Do not handicap either route with
    // avoidable hierarchy traversal or one exact-read call per record.
    const originals = await run("record", { operation: "query", action_id: action.id,
      source_session_id: concern.source.session_id, limit: 50 }, progressive)
    expect(originals.next_after).toBeNull()
    const exact: any[] = originals.items
    expect(exact.map(record => record.id).sort()).toEqual(legacyBranch.map(record => record.id).sort())
    expect(exact.map(record => record.data)).toEqual(legacyBranch.map(record => record.data))
    expect(exact.map(record => record.id).sort()).toEqual(records.slice(0, 2).map(record => record.id).sort())
    expect(legacy.calls).toBe(2)
    expect(progressive.calls).toBe(2)
    const measurement = {
      scope: "counterexample to the old all-record baseline; controlled registered tools and simulated native permission/Session owner; 776 records, 261 source Sessions",
      information_need: "find coarse failure branch from Action identity, retrieve both exact originals",
      legacy, progressive, selection_correct: true, exhaustive_client_enumeration: { legacy: false, progressive: false },
      selected_original_record_ids: exact.map(record => record.id),
      qualification: "The old interface is already efficient for this favorable single-concern fixture. No speed or comprehension claim follows.",
      excludes: "fixture setup, real host/network latency, model reasoning, tokens and production performance",
    }
    if (process.env.LOOM_HISTORY_MEASURE_DIR) {
      await mkdir(process.env.LOOM_HISTORY_MEASURE_DIR, { recursive: true })
      await writeFile(join(process.env.LOOM_HISTORY_MEASURE_DIR, "single-concern-counterexample.json"), JSON.stringify(measurement, null, 2) + "\n")
    }
    if (process.env.LOOM_HISTORY_MEASURE === "1") console.log("ENGINEERING_HISTORY_MEASUREMENT " + JSON.stringify(measurement))
  } finally { await f.close() }
})
