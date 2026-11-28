import { expect, spyOn, test } from "bun:test"
import { writeFile } from "node:fs/promises"
import { join } from "node:path"
import { Observer } from "../src/context.js"
import { EvaluationSubjects } from "../src/evaluation-subject.js"
import { LearningSources } from "../src/learning-sources.js"
import { digest, type LedgerRecord } from "../src/model.js"
import { registeredLoom } from "./helpers/registered-loom.js"
import { method, openState } from "./helpers/evaluator-execution-fixture.js"

/** Real registered callbacks and both SQLite owners; only the native registration
 * host is simulated. No inference or native-history crawler is involved. */
async function fixture() {
  const config = (capture: "off" | "automatic") =>
    `agents: {}\ninstructions: {enabled: false}\nledger: {capture: ${capture}}\nlearning: {coalesce-ms: 60000}\n`
  const f = await registeredLoom([], { beforeSetup: directory => writeFile(join(directory, ".loom.yaml"), config("off")) })
  const state = openState(join(f.directory, "state", "loom", "actions-v1", digest({ project: "tool-help", canonical: f.directory })))
  const actor = { session_id: "s", agent: "author" }
  for (const [id, agent] of [["s", "author"], ["reader", "investigator"]])
    f.sessions.set(id!, { id, agent, projectID: "tool-help", location: { directory: f.directory } })
  const record = (statement: string, kind: "result" | "concern" = "result") => state.store.record(actor, undefined, { kind, statement })
  const run = async () => {
    let result = await state.learning.automatic.run(actor.session_id, async () => {}, new AbortController().signal, { incremental: true })
    for (let attempt = 0; result.state === "pending" && attempt < 10; attempt++)
      result = await state.learning.automatic.run(actor.session_id, async () => {}, new AbortController().signal, { incremental: true })
    expect(result.state).toBe("complete")
    expect(result.batch_id).toBeString()
    return result.batch_id!
  }
  const automaticCapture = () => writeFile(join(f.directory, ".loom.yaml"), config("automatic"))
  const preview = () => f.invoke("history", { operation: "preview-population", selection: {
    target: { kind: "session", id: actor.session_id }, question: "Explain the original engineering attempt and its limitations." } })
  const rows = () => (state.ledger.query("SELECT data FROM ledger ORDER BY seq").all() as Array<{ data: string }>)
    .map(row => JSON.parse(row.data) as LedgerRecord)
  // Observe the initial disabled startup drain before enabling audit capture.
  // Native hooks then use the configured 60s coalescing window, so background
  // processing cannot add unrelated source reads to this foreground contract.
  const deadline = Date.now() + 4000
  try {
    while ((await f.invoke("insights", { operation: "evaluation-status" })).result.queued) {
      if (Date.now() >= deadline) throw new Error("Disabled startup drain did not settle")
      await new Promise(resolve => setTimeout(resolve, 10))
    }
  } catch (error) { state.close(); await f.close(); throw error }
  return { f, state, actor, record, run, automaticCapture, preview, rows,
    async close() { state.close(); await f.close() } }
}

test("public learning-source resolves only the selected original, including its final revalidation", async () => {
  const t = await fixture()
  try {
    const selected = t.record("Selected engineering original"), other = t.record("Unrelated original must not be read")
    const batch = await t.run(), frozen = t.state.learning.automatic.history.frozenIncrement(batch, "s")
    const member = frozen.members.find(item => item.source_refs.some(ref => ref.id === selected.id))!
    const sourceIndex = member.source_refs.findIndex(ref => ref.id === selected.id)
    const resolve = spyOn(LearningSources.prototype, "resolve")
    t.f.permission.beforeReturn = async () => {
      if (t.f.permissionRequests.at(-1).resources.some((resource: string) => resource.includes(":record:" + other.id)))
        throw new Error("Unselected original denied")
    }
    try {
      const response = (await t.f.invoke("insights", { operation: "learning-source", batch_id: batch,
        member_key: member.key, source_index: sourceIndex })).result
      expect(response).toMatchObject({ availability: "available", source: { id: selected.id }, value: { data: { statement: selected.data.statement } } })
      expect(resolve.mock.calls.length).toBeGreaterThan(0)
      expect([...new Set(resolve.mock.calls.map(([ref]) => ref.id))]).toEqual([selected.id])
      expect(t.f.permissionRequests.some(request => request.resources.some((resource: string) => resource.includes(":record:" + other.id)))).toBe(false)
      expect(t.f.nativeListRequests).toHaveLength(0)
    } finally { resolve.mockRestore(); t.f.permission.beforeReturn = undefined }
  } finally { await t.close() }
})

test.each(["summary", "concerns", "progress"] as const)("public %s authorizes retained earlier originals before reading any source", async section => {
  const t = await fixture()
  try {
    const retained = t.record("Earlier unresolved finding that remains private", "concern")
    await t.run()
    t.record("Later verification does not clear the earlier finding")
    const batch = await t.run()
    const resolve = spyOn(LearningSources.prototype, "resolve")
    let denied = false
    t.f.permission.beforeReturn = async () => {
      if (t.f.permissionRequests.at(-1).resources.some((resource: string) => resource.includes(":record:" + retained.id))) {
        denied = true
        throw new Error("Retained original denied")
      }
    }
    try {
      await expect(t.f.invoke("insights", section === "progress" ? { operation: "learning-progress" }
        : { operation: "learning-report", batch_id: batch, section })).rejects.toThrow("Retained original denied")
      expect(denied).toBe(true)
      expect(resolve).not.toHaveBeenCalled()
    } finally { resolve.mockRestore(); t.f.permission.beforeReturn = undefined }
  } finally { await t.close() }
})

test("all legacy evaluation readers and preparation reject incremental batches before resolving originals", async () => {
  const t = await fixture()
  try {
    const privateOriginal = t.record("Incremental concern is unavailable through a legacy route", "concern")
    const batch = await t.run(), frozen = t.state.learning.automatic.history.frozenIncrement(batch, "s")
    const member = frozen.members[0]!, report = t.state.learning.automatic.history.report(batch, "s")!
    await t.automaticCapture()
    const inputs = [
      { operation: "evaluation", batch_id: batch },
      { operation: "evaluation-members", batch_id: batch },
      { operation: "evaluation-sources", batch_id: batch, member_key: member.key },
      { operation: "evaluation-observations", batch_id: batch, member_key: member.key, report_id: report.id },
      { operation: "evaluation-preparation", batch_id: batch },
      { operation: "evaluation-preparation-members", batch_id: batch, request_id: "unissued", manifest_sha256: "a".repeat(64) },
      { operation: "evaluation-preparation-source", batch_id: batch, request_id: "unissued", manifest_sha256: "a".repeat(64), member_key: member.key, source_index: 0 },
      { operation: "evaluation-admission", batch_id: batch, request_id: "unissued", manifest_sha256: "a".repeat(64), attempt_id: "unissued" },
    ]
    const resolve = spyOn(LearningSources.prototype, "resolve")
    t.f.permission.beforeReturn = async () => {
      if (t.f.permissionRequests.at(-1).resources.some((resource: string) => resource.includes(":record:" + privateOriginal.id)))
        throw new Error("Exact original denied")
    }
    try {
      for (const input of inputs) {
        await expect(t.f.invoke("insights", input)).rejects.toThrow(/authorized learning-|Evaluator preparation unavailable/)
        expect(resolve).not.toHaveBeenCalled()
      }
      await expect(t.f.invoke("review", { operation: "prepare-evaluation", batch_id: batch, method: method(), budget_policy: null }))
        .rejects.toThrow(/incremental|unavailable/i)
      expect((await t.f.invoke("insights", { operation: "evaluations" })).result.items).toEqual([])
      expect(resolve).not.toHaveBeenCalled()
      expect(t.f.sessionCreates).toHaveLength(0)
      expect(t.f.sessionPrompts).toHaveLength(0)
    } finally { resolve.mockRestore(); t.f.permission.beforeReturn = undefined }
  } finally { await t.close() }
})

test("empty and original previews still render when both optional audit writes and wrapper hints fail", async () => {
  const t = await fixture()
  const domain = () => ({ ledger: t.state.ledger.query("SELECT id,data FROM ledger ORDER BY seq").all(),
    tables: t.state.derived.query("SELECT name FROM sqlite_schema WHERE type='table' ORDER BY name").all(),
    objectives: t.state.derived.query("SELECT id FROM learning_objectives").all(), actions: t.state.ledger.query("SELECT id FROM actions").all() })
  try {
    await t.automaticCapture()
    const activity = spyOn(EvaluationSubjects.prototype, "recordActivity").mockImplementation(() => { throw new Error("Audit disk unavailable") })
    const hint = spyOn(Observer.prototype, "noteLearningInvocation").mockImplementation(() => { throw new Error("Learning wrapper continuity capacity reached") })
    try {
      const before = domain(), empty = (await t.preview()).result
      expect(empty).toMatchObject({ member_count: 0, freeze: null })
      expect(empty.freeze_unavailable).toContain("No eligible evidence")
      expect(domain()).toEqual(before)
      const original = t.record("Visible engineering source despite audit unavailability"), populated = domain()
      const view = (await t.preview()).result
      expect(view.items.map((item: { source: { id: string } }) => item.source.id)).toEqual([original.id])
      const html = await t.f.tools.get("history").execute({ ...view.navigation.repeat, response_format: "html" },
        { sessionID: "s", agent: "author", messageID: "message", id: "tool-call", signal: new AbortController().signal })
      expect(html.content).toContain("Session evidence foundation")
      expect(html.content).toContain("Visible engineering source despite audit unavailability")
      const response = await t.f.tools.get("history").execute({ ...view.items[0].inspect, response_format: "html" },
        { sessionID: "s", agent: "author", messageID: "message", id: "tool-call", signal: new AbortController().signal })
      expect(response.content).toContain("<!doctype html>")
      expect(response.content).toContain("Visible engineering source despite audit unavailability")
      expect(domain()).toEqual(populated)
      expect(activity).toHaveBeenCalled()
      expect(hint).toHaveBeenCalled()
    } finally { hint.mockRestore(); activity.mockRestore() }
  } finally { await t.close() }
})

test("an established empty Session subject offers a readable preview without an impossible freeze request", async () => {
  const t = await fixture()
  try {
    const established = (await t.f.invoke("review", { operation: "establish-subject", target: { kind: "session", id: "s" },
      question: "Inspect this empty historical boundary." })).result
    const preview = (await t.f.invoke("history", established.preview)).result
    expect(preview.manifest.selection.subject_id).toBe(established.subject.subject_id)
    expect(preview).toMatchObject({ member_count: 0, freeze: null })
    expect(preview.freeze_unavailable).toContain("No eligible evidence")
    await expect(t.f.invoke("review", { operation: "freeze-population", selection: preview.manifest.selection,
      preview_sha256: preview.manifest_sha256 })).rejects.toThrow("No eligible evidence")
    expect(t.state.derived.query("SELECT name FROM sqlite_schema WHERE type='table' AND name='learning_retrospective_populations'").all()).toEqual([])
  } finally { await t.close() }
})

async function mixedCalls(t: Awaited<ReturnType<typeof fixture>>) {
  await t.automaticCapture()
  const outer = { sessionID: "s", agent: "author", messageID: "message", id: "tool-call", tool: "codemode",
    input: { code: "await shell(); await loom.history();" } }
  const inner = { ...outer, tool: "shell", input: { command: "inspect-waybar" } }
  await t.f.hooks.get("execute.before")(outer)
  await t.f.hooks.get("execute.before")(inner)
  await t.f.hooks.get("execute.after")({ ...inner, status: "error", error: { message: "Engineering command was aborted" } })
  const recorded = t.rows()
  expect(recorded).toHaveLength(3)
  expect(recorded.every(record => record.data.message_id === outer.messageID && record.data.call_id === outer.id)).toBe(true)
  return { outer, wrapper: recorded[0]!, engineering: recorded.slice(1) }
}

test("a retrospective read excludes the Code Mode wrapper but retains engineering siblings with the same native IDs", async () => {
  const t = await fixture()
  try {
    const calls = await mixedCalls(t), batch = await t.run()
    const persisted = t.state.derived.query("SELECT source_refs FROM learning_evaluation_members ORDER BY ordinal").all()
    expect(t.state.learning.automatic.history.report(batch, "s")!.availability).toBe("available")
    const preview = (await t.preview()).result
    expect(preview.items.map((item: { source: { id: string } }) => item.source.id).sort())
      .toEqual(calls.engineering.map(record => record.id).sort())
    expect(t.state.learning.automatic.history.report(batch, "s")).toMatchObject({ availability: "source-unavailable", body: null })
    expect(t.state.derived.query("SELECT source_refs FROM learning_evaluation_members ORDER BY ordinal").all()).toEqual(persisted)
    expect(t.rows()).toEqual([calls.wrapper, ...calls.engineering])
  } finally { await t.close() }
})

test("late wrapper completion preserves history and withdraws its earlier interpretation after a failed preview audit", async () => {
  const t = await fixture()
  try {
    const calls = await mixedCalls(t), batch = await t.run()
    const reports = t.state.derived.query("SELECT id,body_json FROM learning_evaluation_reports ORDER BY id").all()
    const membership = t.state.derived.query("SELECT source_refs FROM learning_evaluation_members ORDER BY ordinal").all()
    const activity = spyOn(EvaluationSubjects.prototype, "recordActivity").mockImplementation(() => { throw new Error("Preview audit unavailable") })
    try { await t.preview() } finally { activity.mockRestore() }
    expect(t.state.learning.automatic.history.report(batch, "s")!.availability).toBe("available")
    await t.f.hooks.get("execute.after")({ ...calls.outer, status: "completed", result: { content: "Preview rendered" } })
    const rows = t.rows()
    expect(rows.slice(0, 3)).toEqual([calls.wrapper, ...calls.engineering])
    expect(rows.at(-1)!.data).toMatchObject({ tool: "codemode", start_id: calls.wrapper.id,
      attribution: "captured-at-start", learning_purpose: "contains-evaluation" })
    expect(t.state.learning.automatic.history.report(batch, "s")).toMatchObject({ availability: "source-unavailable", body: null })
    expect(t.state.derived.query("SELECT id,body_json FROM learning_evaluation_reports ORDER BY id").all()).toEqual(reports)
    expect(t.state.derived.query("SELECT source_refs FROM learning_evaluation_members ORDER BY ordinal").all()).toEqual(membership)
    expect(t.state.learning.automatic.sources.snapshot("s").members.flatMap(member => member.source_refs.map(ref => ref.id)).sort())
      .toEqual(calls.engineering.map(record => record.id).sort())
  } finally { await t.close() }
})

test("authorized population reads keep another owner's subject separate from the reader's activity audit", async () => {
  const t = await fixture()
  try {
    const original = t.record("Historical engineering source shared with an authorized investigator")
    const established = (await t.f.invoke("review", { operation: "establish-subject", target: { kind: "session", id: "s" }, question: "Inspect the historical work." })).result
    const preview = (await t.f.invoke("history", established.preview)).result
    const frozen = (await t.f.invoke("review", preview.freeze)).result
    await t.automaticCapture()
    const view = (await t.f.invoke("history", { operation: "population", population_id: frozen.population_id,
      manifest_sha256: frozen.manifest_sha256 }, "reader", "investigator")).result
    expect(view.owner_session).toBe("s")
    expect(view.items.map((item: { source: { id: string } }) => item.source.id)).toEqual([original.id])
    const rows = t.state.derived.query("SELECT data_json FROM learning_subject_activities WHERE session_id='reader' ORDER BY sequence").all() as Array<{ data_json: string }>
    expect(rows.length).toBeGreaterThan(0)
    for (const row of rows) expect(JSON.parse(row.data_json).subject_id).toBeNull()
    expect(JSON.parse(rows.at(-1)!.data_json)).toMatchObject({ outcome: "succeeded", actor: { session_id: "reader" } })
  } finally { await t.close() }
})
