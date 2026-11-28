import { test, expect, spyOn } from "bun:test"
import { Database } from "bun:sqlite"
import { writeFile } from "node:fs/promises"
import { join } from "node:path"
import { registeredLoom } from "./helpers/registered-loom.js"
import type { EvaluatorMethodManifest } from "../src/evaluator-method.js"
import { AutomaticLearning } from "../src/automatic-learning.js"
import { TOOL_EXAMPLES } from "../src/tool-help.js"

function method(): EvaluatorMethodManifest {
  const ref = (name: string) => ({ locator: "fixture://" + name, sha256: "a".repeat(64) })
  const policy = (id: string) => ({ id, revision: "1", sha256: "b".repeat(64) })
  return { format: "loom-evaluator-method/v1", evaluator: { agent: "evaluator", definition: ref("evaluator") },
    audit_skill: { skill: "agent-run-audit", definition: ref("audit") }, rubric: ref("rubric"), instruction_bundle: ref("bundle"),
    result_format: "loom-evaluator-interpretation/v1", model: { provider_id: "synthetic-unqualified", model_id: "no-model", settings: ref("settings") },
    adapter: { id: "unqualified", version: "1", profile: policy("profile") }, source_policy: policy("sources"), route_policy: policy("route") }
}
// This suite preserves the v1 complete-population preparation contract.
const config = (capture: string) => `agents: {}\ninstructions: {enabled: false}\nledger: {capture: ${capture}}\nlearning: {incremental: false}\n`
async function fixture() {
  const f = await registeredLoom([], { beforeSetup: directory => writeFile(join(directory, ".loom.yaml"), config("automatic")) })
  f.sessions.set("s", { id: "s", agent: "author", projectID: "tool-help", location: { directory: f.directory } })
  f.sessions.set("foreign", { id: "foreign", agent: "author", projectID: "tool-help", location: { directory: f.directory } })
  f.nativeAgents.push({ id: "evaluator", mode: "subagent", hidden: false })
  const original = (await f.invoke("record", { operation: "add", session_only: true, kind: "result", statement: "Authorized original record" })).result
  let batch: { id: string } | undefined
  const deadline = Date.now() + 4_000
  while (Date.now() < deadline && !batch) {
    const listing = (await f.invoke("insights", { operation: "evaluations" })).result
    batch = listing.items.find((item: { state: string }) => item.state === "complete")
    if (!batch) await new Promise(resolve => setImmediate(resolve))
  }
  if (!batch) { await f.close(); throw new Error("Stage 3 did not publish original source") }
  return { f, original, input: { operation: "prepare-evaluation", batch_id: batch.id, method: method(), budget_policy: null } }
}
function queries(prepared: Record<string, any>) {
  return [
    { operation: "evaluation-preparation", batch_id: prepared.batch_id },
    { operation: "evaluation-preparation-members", batch_id: prepared.batch_id, request_id: prepared.request_id, manifest_sha256: prepared.manifest_sha256, after: 0, limit: 1 },
    { operation: "evaluation-preparation-source", batch_id: prepared.batch_id, request_id: prepared.request_id, manifest_sha256: prepared.manifest_sha256, member_key: "session:s:0", source_index: 0 },
    admissionQuery(prepared),
  ]
}
function admissionQuery(prepared: Record<string, any>) {
  return { operation: "evaluation-admission", batch_id: prepared.batch_id, request_id: prepared.request_id,
    manifest_sha256: prepared.manifest_sha256, attempt_id: prepared.issue.attempt.attempt_id }
}
function replays(prepared: Record<string, any>) {
  const { requester: _requester, ...review } = prepared.request.review_request
  const stripped = { ...review }; delete stripped.extensions
  return [
    ["review", { operation: "freeze", request: review }],
    ["review", { operation: "freeze", request: stripped }],
    ["record", { operation: "ask", question: review.mandate.question, recipient: { kind: "agent", id: "evaluator" }, blocking: true, review }],
    ["record", { operation: "ask", question: review.mandate.question, recipient: { kind: "agent", id: "evaluator" }, blocking: true, review: stripped }],
  ] as const
}

test("registered preparation returns exact original source and leaves all Stage3 readers and list cursors unchanged", async () => {
  const { f, original, input } = await fixture()
  try {
    const listing = (await f.invoke("insights", { operation: "evaluations", limit: 1 })).result
    const before = (await f.invoke("insights", { operation: "evaluation", batch_id: input.batch_id })).result
    const prepared = (await f.invoke("review", input)).result
    expect(prepared).toMatchObject({ state: "prepared", mode: "preparation-only", interpretation: null,
      budget_reservation: null, method_binding: "declared-not-admitted", automatic_model_calls: false })
    expect((await f.invoke("review", input)).result).toEqual(prepared)
    expect((await f.invoke("insights", { operation: "evaluations", limit: 1 })).result).toEqual(listing)
    expect((await f.invoke("insights", { operation: "evaluation", batch_id: input.batch_id })).result).toEqual(before)
    const [detail, page, source] = queries(prepared)
    expect((await f.invoke("insights", detail)).result).toEqual(prepared)
    expect((await f.invoke("insights", page)).result.items).toHaveLength(1)
    expect((await f.invoke("insights", source)).result).toMatchObject({ source: { id: original.id }, value: original,
      coverage: "existing-stored-record", native_evaluator_retrieval: "not-established" })
    for (const operation of ["evaluation", "evaluation-members", "evaluation-sources", "evaluation-observations"])
      await expect(f.invoke("insights", { operation, batch_id: prepared.batch_id })).rejects.toThrow("unavailable")
    expect(f.sessionCreates).toHaveLength(0)
    expect(f.sessionPrompts).toHaveLength(0)
    expect(f.nativeInputs).toHaveLength(0)
  } finally { await f.close() }
})

test("new readers reject foreign owners and revoked learning permission also fences both legacy review replay paths", async () => {
  const { f, input } = await fixture()
  try {
    const prepared = (await f.invoke("review", input)).result
    for (const query of queries(prepared)) await expect(f.invoke("insights", query, "foreign")).rejects.toThrow("unavailable")
    await expect(f.invoke("review", input, "foreign")).rejects.toThrow("unavailable")
    // Only learning access is revoked: the earlier ledger-only replay path must not pass.
    f.permission.beforeReturn = async () => {
      if (f.permissionRequests.at(-1).resources.some((path: string) => path.endsWith("learning.sqlite"))) throw new Error("learning permission revoked")
    }
    for (const query of queries(prepared)) await expect(f.invoke("insights", query)).rejects.toThrow("permission revoked")
    for (const operation of ["read", "issue", "prepare", "work"]) await expect(f.invoke("review", { operation,
      request_id: prepared.review_request_id, ...(operation === "work" ? { member_id: "evaluation-manifest" } : {}) })).rejects.toThrow("permission revoked")
    for (const [name, replay] of replays(prepared)) await expect(f.invoke(name, replay)).rejects.toThrow("permission revoked")
    expect(f.sessionCreates).toHaveLength(0)
    expect(f.sessionPrompts).toHaveLength(0)
  } finally { f.permission.beforeReturn = undefined; await f.close() }
})

test.each(["settled", "outstanding"] as const)("changed original with %s drain withholds preparation and excludes it across list pages", async (mode) => {
  let release!: () => void
  let reached!: () => void
  const gate = new Promise<void>(resolve => { release = resolve })
  const blocked = new Promise<void>(resolve => { reached = resolve })
  const run = AutomaticLearning.prototype.run
  const spy = spyOn(AutomaticLearning.prototype, "run").mockImplementation(async function (this: AutomaticLearning, ...args) {
    const result = await run.apply(this, args)
    if (mode === "outstanding" && result.state === "complete" && !result.replayed) {
      reached()
      await gate
    }
    return result
  })
  let f: Awaited<ReturnType<typeof fixture>>["f"] | undefined
  try {
    const fixtureResult = await fixture()
    f = fixtureResult.f
    const { original, input } = fixtureResult
    if (mode === "outstanding") await blocked
    const waitForIdle = async () => {
      const deadline = Date.now() + 4_000
      while (Date.now() < deadline) {
        const status = (await f!.invoke("insights", { operation: "evaluation-status" })).result
        if (!status.queued && status.opportunity?.state === "idle") return
        await new Promise(resolve => setImmediate(resolve))
      }
      throw new Error("Stage 3 drain did not settle")
    }
    if (mode === "settled") await waitForIdle()
    const prepared = (await f.invoke("review", input)).result
    const ledger = f.permissionRequests.flatMap(request => request.resources).find((path: string) => path.endsWith("ledger.sqlite"))
    const db = new Database(ledger)
    try { db.query("UPDATE ledger SET data=json_set(data,'$.data.statement',?) WHERE id=?").run("Changed original", original.id) } finally { db.close() }
    for (const query of queries(prepared)) await expect(f.invoke("insights", query)).rejects.toThrow("unavailable")
    for (const [name, replay] of replays(prepared)) await expect(f.invoke(name, replay)).rejects.toThrow("unavailable")
    release()
    await waitForIdle()
    const ids: string[] = []
    let before: number | undefined
    const cursors = new Set<number>()
    do {
      const listing = (await f.invoke("insights", { operation: "evaluations", limit: 1, ...(before === undefined ? {} : { before }) })).result
      ids.push(...listing.items.map((item: { id: string }) => item.id))
      before = listing.next_before ?? undefined
      if (before !== undefined) {
        expect(cursors.has(before)).toBe(false)
        cursors.add(before)
      }
    } while (before !== undefined)
    expect(ids).toContain(input.batch_id)
    expect(ids).not.toContain(prepared.batch_id)
    expect(new Set(ids).size).toBe(ids.length)
  } finally { release(); try { if (f) await f.close() } finally { spy.mockRestore() } }
})

test("prepared page identity and source positions reject forged authority, ambiguous and out-of-range requests", async () => {
  const { f, input } = await fixture()
  try {
    const prepared = (await f.invoke("review", input)).result
    const [, page, source] = queries(prepared)
    for (const invalid of [{ ...page, request_id: "wrong" }, { ...page, manifest_sha256: "0".repeat(64) },
      { ...page, after: -1 }, { ...page, after: 1000 }, { ...page, limit: 101 },
      { ...source, source_index: -1 }, { ...source, source_index: 999 }, { ...source, member_key: "foreign" },
      { ...page, qualified: true }]) await expect(f.invoke("insights", invalid)).rejects.toThrow()
    await expect(f.invoke("review", { ...input, method: { ...method(), host_qualified: true } })).rejects.toThrow()
    expect((await f.invoke("review", input)).result.request_id).toBe(prepared.request_id)
    expect(f.sessionPrompts).toHaveLength(0)
  } finally { await f.close() }
})

test("capture opt-out during permission resolution stops explicit preparation before any mapping or review write", async () => {
  const { f, input } = await fixture()
  let toggled = false
  try {
    f.permission.beforeReturn = async () => {
      if (!toggled && f.permissionRequests.at(-1).resources.some((path: string) => path.endsWith("learning.sqlite"))) {
        toggled = true
        await writeFile(join(f.directory, ".loom.yaml"), config("off"))
      }
    }
    await expect(f.invoke("review", input)).rejects.toThrow("requires enabled")
    expect(toggled).toBe(true)
    f.permission.beforeReturn = undefined
    const path = f.permissionRequests.flatMap(request => request.resources).find((path: string) => path.endsWith("learning.sqlite"))
    const db = new Database(path)
    try { expect(db.query("SELECT name FROM sqlite_schema WHERE name GLOB 'learning_evaluator_*'").all()).toEqual([]) } finally { db.close() }
    expect(f.sessionPrompts).toHaveLength(0)
  } finally { f.permission.beforeReturn = undefined; await f.close() }
})

test("registered admission example explains missing authority without claiming an issue or changing Stage 3", async () => {
  const { f, input } = await fixture()
  try {
    const prepared = (await f.invoke("review", input)).result
    const stage3 = (await f.invoke("insights", { operation: "evaluation", batch_id: input.batch_id })).result
    const example = TOOL_EXAMPLES.insights.find(item => item.operation === "evaluation-admission")
    expect(example).toBeDefined()
    const query = JSON.parse(JSON.stringify(example).replaceAll("BATCH_ID", prepared.batch_id)
      .replaceAll("REQUEST_ID", prepared.request_id).replaceAll("MANIFEST_SHA256", prepared.manifest_sha256)
      .replaceAll("ATTEMPT_ID", prepared.issue.attempt.attempt_id))
    const assessment = (await f.invoke("insights", query)).result
    expect(assessment).toMatchObject({ format: "loom-evaluation-admission-assessment/v1", state: "blocked", mode: "assessment-only",
      request_id: prepared.request_id, source_store_id: prepared.manifest.source_store_id, method_id: prepared.method_id,
      local_issue: { intent: prepared.issue.intent, attempt: prepared.issue.attempt },
      dispatch_enabled: false, automatic_model_calls: false, effect_permit: null, budget_reservation: null,
      budget_accounting: "not-established", native_effect_identity: "not-established", source_processing: "enabled",
      recovery: { state: "qualification-required", restore_reconciliation: "unsupported" },
      qualifications: { reader_access_is_recipient_authority: false, local_state_proves_native_nonexecution: false } })
    expect(assessment.blockers).toContainEqual({ capability: "budget", state: "missing", reason: "budget-policy-missing" })
    expect(assessment.blockers.map((item: { capability: string }) => item.capability)).toEqual([
      "effective-method", "recipient", "recipient-source-access", "model-provider-account", "budget", "budget-reservation", "native-reconciliation",
    ])
    const repeated = await Promise.all(Array.from({ length: 4 }, () => f.invoke("insights", query)))
    for (const read of repeated) expect(read.result).toEqual(assessment)
    expect((await f.invoke("insights", { operation: "evaluation-preparation", batch_id: prepared.batch_id })).result).toEqual(prepared)
    expect((await f.invoke("insights", { operation: "evaluation", batch_id: input.batch_id })).result).toEqual(stage3)
    expect(f.tools.get("insights").description).toContain("evaluation-admission")
    expect(f.sessionCreates).toHaveLength(0); expect(f.sessionPrompts).toHaveLength(0); expect(f.nativeInputs).toHaveLength(0)
  } finally { await f.close() }
})

test("admission accepts selectors only and never upgrades declared budget, model or policy references", async () => {
  const { f, input } = await fixture()
  try {
    const prepared = (await f.invoke("review", { ...input, budget_policy: { id: "claimed-authorized-budget", revision: "1", sha256: "c".repeat(64) } })).result
    const query = admissionQuery(prepared)
    for (const invalid of [
      { ...query, request_id: "other-request" }, { ...query, manifest_sha256: "f".repeat(64) }, { ...query, attempt_id: "other-attempt" },
      { ...query, qualified: true }, { ...query, authority: { granted: true } }, { ...query, recipient: { session_id: "s" } },
      { ...query, account_id: "included-account" }, { ...query, budget_reservation: "reservation" }, { ...query, claimant_id: "worker" },
      { ...query, authorization_ref: "approval" }, { ...query, dispatch: true }, { ...query, now_ms: Number.MAX_SAFE_INTEGER },
    ]) await expect(f.invoke("insights", invalid)).rejects.toThrow()
    for (const field of ["request_id", "manifest_sha256", "attempt_id"] as const) {
      const missing: Record<string, unknown> = { ...query }; delete missing[field]
      await expect(f.invoke("insights", missing)).rejects.toThrow("identity mismatch")
    }
    await expect(f.invoke("insights", { operation: "window", attempt_id: query.attempt_id })).rejects.toThrow("Evaluation fields")
    const assessment = (await f.invoke("insights", query)).result
    expect(assessment.blockers).toContainEqual({ capability: "budget", state: "unsupported", reason: "declared-budget-policy-is-not-authority" })
    expect(assessment.effect_permit).toBeNull(); expect(assessment.budget_reservation).toBeNull()
    expect(assessment.local_issue.attempt).toEqual(prepared.issue.attempt)
    for (const [name, replay] of replays(prepared).filter(([name]) => name === "record"))
      expect((await f.invoke(name, replay)).result.dispatch).toMatchObject({ status: "not-attempted", attempted: false })
    expect(f.sessionCreates).toHaveLength(0); expect(f.sessionPrompts).toHaveLength(0); expect(f.nativeInputs).toHaveLength(0)
  } finally { await f.close() }
})

test.each(["off", "invalid"] as const)("admission rechecks %s configuration after authorization but preserves authorized historical reads", async mode => {
  const { f, input } = await fixture()
  try {
    const prepared = (await f.invoke("review", input)).result
    let changed = false
    f.permission.beforeReturn = async () => {
      const permission = f.permissionRequests.at(-1)
      if (!changed && permission.source?.type === "tool" && permission.resources.some((path: string) => path.endsWith("learning.sqlite"))) {
        changed = true
        await writeFile(join(f.directory, ".loom.yaml"), mode === "off" ? config("off") : "ledger: [invalid\n")
      }
    }
    const assessment = (await f.invoke("insights", admissionQuery(prepared))).result
    expect(changed).toBe(true)
    expect(assessment.source_processing).toBe("disabled")
    expect(assessment.blockers).toContainEqual({ capability: "source-processing", state: "blocked", reason: "source-processing-disabled" })
    expect(assessment.effect_permit).toBeNull()
    expect((await f.invoke("insights", { operation: "evaluation-preparation", batch_id: prepared.batch_id })).result).toEqual(prepared)
    expect((await f.invoke("action", { operation: "create", title: "Ordinary work", goal: "Still usable" })).result.id).toBeTruthy()
    expect(f.sessionCreates).toHaveLength(0); expect(f.sessionPrompts).toHaveLength(0)
  } finally { f.permission.beforeReturn = undefined; await f.close() }
})
