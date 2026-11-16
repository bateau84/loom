import { test, expect } from "bun:test"
import { Database } from "bun:sqlite"
import { writeFile } from "node:fs/promises"
import { join } from "node:path"
import { registeredLoom } from "./helpers/registered-loom.js"
import type { EvaluatorMethodManifest } from "../src/evaluator-method.js"

function method(): EvaluatorMethodManifest {
  const ref = (name: string) => ({ locator: "fixture://" + name, sha256: "a".repeat(64) })
  const policy = (id: string) => ({ id, revision: "1", sha256: "b".repeat(64) })
  return { format: "loom-evaluator-method/v1", evaluator: { agent: "evaluator", definition: ref("evaluator") },
    audit_skill: { skill: "agent-run-audit", definition: ref("audit") }, rubric: ref("rubric"), instruction_bundle: ref("bundle"),
    result_format: "loom-evaluator-interpretation/v1", model: { provider_id: "synthetic-unqualified", model_id: "no-model", settings: ref("settings") },
    adapter: { id: "unqualified", version: "1", profile: policy("profile") }, source_policy: policy("sources"), route_policy: policy("route") }
}
const config = (capture: string) => `agents: {}\ninstructions: {enabled: false}\nledger: {capture: ${capture}}\n`
async function fixture() {
  const f = await registeredLoom([], { beforeSetup: directory => writeFile(join(directory, ".loom.yaml"), config("automatic")) })
  f.sessions.set("s", { id: "s", agent: "author", projectID: "tool-help", location: { directory: f.directory } })
  f.sessions.set("foreign", { id: "foreign", agent: "author", projectID: "tool-help", location: { directory: f.directory } })
  f.nativeAgents.push({ id: "evaluator", mode: "subagent", hidden: false })
  const original = (await f.invoke("record", { operation: "add", session_only: true, kind: "result", statement: "Authorized original record" })).result
  let batch: { id: string } | undefined
  for (let i = 0; i < 100 && !batch; i++) {
    const listing = (await f.invoke("insights", { operation: "evaluations" })).result
    batch = listing.items.find((item: { state: string }) => item.state === "complete")
    if (!batch) await new Promise(resolve => setTimeout(resolve, 5))
  }
  if (!batch) { await f.close(); throw new Error("Stage 3 did not publish original source") }
  return { f, original, input: { operation: "prepare-evaluation", batch_id: batch.id, method: method(), budget_policy: null } }
}
function queries(prepared: Record<string, any>) {
  return [
    { operation: "evaluation-preparation", batch_id: prepared.batch_id },
    { operation: "evaluation-preparation-members", batch_id: prepared.batch_id, request_id: prepared.request_id, manifest_sha256: prepared.manifest_sha256, after: 0, limit: 1 },
    { operation: "evaluation-preparation-source", batch_id: prepared.batch_id, request_id: prepared.request_id, manifest_sha256: prepared.manifest_sha256, member_key: "session:s:0", source_index: 0 },
  ]
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

test("changed original withholds preparation through new readers and legacy review replay without leaking list cursor", async () => {
  const { f, original, input } = await fixture()
  try {
    const prepared = (await f.invoke("review", input)).result
    const ledger = f.permissionRequests.flatMap(request => request.resources).find((path: string) => path.endsWith("ledger.sqlite"))
    const db = new Database(ledger)
    try { db.query("UPDATE ledger SET data=json_set(data,'$.data.statement',?) WHERE id=?").run("Changed original", original.id) } finally { db.close() }
    for (const query of queries(prepared)) await expect(f.invoke("insights", query)).rejects.toThrow("unavailable")
    for (const [name, replay] of replays(prepared)) await expect(f.invoke(name, replay)).rejects.toThrow("unavailable")
    const listing = (await f.invoke("insights", { operation: "evaluations", limit: 1 })).result
    expect(listing.items.map((item: { id: string }) => item.id)).toEqual([input.batch_id])
    expect(listing.next_before).toBeNull()
  } finally { await f.close() }
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
