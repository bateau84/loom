import { expect, test } from "bun:test"
import { Database } from "bun:sqlite"
import { join } from "node:path"
import { writeFile } from "node:fs/promises"
import { digest } from "../src/model.js"
import type { EvaluatorMethodManifest } from "../src/evaluator-method.js"
import { registeredLoom } from "./helpers/registered-loom.js"

type Host = Awaited<ReturnType<typeof registeredLoom>>
const invoke = async (host: Host, tool: string, input: unknown) => (await host.invoke(tool, input, "owner")).result
const query = (population: any) => ({ operation: "population", population_id: population.population_id,
  manifest_sha256: population.manifest_sha256 })
const sourceQuery = (population: any, member: any) => ({ ...query(population), operation: "population-source", member_key: member.key })
const descriptor = ({ current: _current, ordinal: _ordinal, inspect: _inspect, ...member }: any) => member

function method(): EvaluatorMethodManifest {
  const content = (name: string) => ({ locator: "fixture://original-limits/" + name, sha256: digest(name) })
  const policy = (name: string) => ({ id: name, revision: "1", sha256: digest(name) })
  return { format: "loom-evaluator-method/v1", evaluator: { agent: "evaluator", definition: content("evaluator") },
    audit_skill: { skill: "agent-run-audit", definition: content("agent-run-audit") }, rubric: content("rubric"),
    instruction_bundle: content("bundle"), result_format: "loom-evaluator-interpretation/v1",
    model: { provider_id: "unqualified-fixture", model_id: "never-dispatched", settings: content("settings") },
    adapter: { id: "unqualified", version: "1", profile: policy("profile") }, source_policy: policy("source"), route_policy: policy("route") }
}

async function members(host: Host, first: any) {
  let page = first
  const result = [...page.items]
  while (page.navigation.next) {
    expect(result.length).toBeLessThan(first.member_count)
    page = await invoke(host, "history", page.navigation.next)
    expect(page.manifest_sha256).toBe(first.manifest_sha256)
    expect(page.manifest).toEqual(first.manifest)
    expect(page.member_count).toBe(first.member_count)
    result.push(...page.items)
  }
  expect(result).toHaveLength(first.member_count)
  expect(new Set(result.map((member: any) => member.key)).size).toBe(first.member_count)
  return result
}

function populations(host: Host) {
  const root = join(host.directory, "state", "loom", "actions-v1", digest({ project: "tool-help", canonical: host.directory }))
  const db = new Database(join(root, "learning.sqlite"), { readonly: true })
  try {
    const rows = (name: string) => db.query("SELECT name FROM sqlite_schema WHERE type='table' AND name=?").get(name)
      ? db.query(`SELECT * FROM ${name} ORDER BY rowid`).all() : []
    return { headers: rows("learning_retrospective_populations"), members: rows("learning_retrospective_members") }
  } finally { db.close() }
}

async function selection(host: Host, count: number) {
  const context = Array.from({ length: count }, (_, index) => ({ id: "original-" + index, type: "user", text: "Original user request " + index }))
  host.nativeContexts.set("owner", { data: context })
  const record = await invoke(host, "record", { operation: "add", session_only: true, kind: "concern", statement: "Controlled source-capacity selection." })
  const objective = await invoke(host, "objective", { operation: "create", label: "Bounded original selection",
    source_type: "ledger-record", source_id: record.id })
  for (const message of context) await invoke(host, "objective", { operation: "link", objective_id: objective.id,
    phase: "request", source_type: "native-message", source_id: message.id })
  return { context, objective, selection: { objective_id: objective.id, question: "Inspect these exact controlled originals." } }
}

function countReads(host: Host) {
  const get = host.nativeContexts.get.bind(host.nativeContexts)
  const calls = { count: 0, beforeRead: undefined as ((count: number) => void) | undefined }
  host.nativeContexts.get = session => { calls.count++; calls.beforeRead?.(calls.count); return get(session) }
  return calls
}

test("native processing gaps preserve complete frozen membership, pins and continuation through registered readers", async () => {
  const host = await registeredLoom([], { beforeSetup: directory => writeFile(join(directory, ".loom.yaml"),
    "agents: {}\ninstructions: {enabled: false}\nledger: {capture: automatic}\n") })
  try {
    const selected = await selection(host, 2)
    const preview = await invoke(host, "history", { operation: "preview-population", selection: selected.selection })
    const population = await invoke(host, "review", preview.freeze)
    const originalMembers = await members(host, population), stored = populations(host)
    const original = originalMembers.find(member => member.source.id === "original-0")
    expect(original.current.status).toBe("available")
    const valid = selected.context.map(message => ({ ...message }))
    const limits = [
      () => [{ ...valid[0], text: "OVERSIZED_ORIGINAL_" + "ø".repeat(140000) }, valid[1]],
      () => [...valid, { id: "unrelated", type: "user", text: "UNRELATED_OVERSIZED_" + "x".repeat(17 * 1024 * 1024) }],
      () => [...valid, ...Array.from({ length: 20000 }, (_, index) => ({ id: "unrelated-" + index, type: "user", text: "small" }))],
    ]
    for (const context of limits) {
      host.nativeContexts.set("owner", { data: context() })
      const first = await invoke(host, "history", { ...query(population), limit: 1 })
      expect(first.navigation.next).not.toBeNull()
      const all = await members(host, first)
      expect(all.map(descriptor)).toEqual(originalMembers.map(descriptor))
      const current = all.find(member => member.key === original.key)
      expect(current.current).toMatchObject({ status: "unresolved", gap: { code: "native-source-processing-limit" } })
      const read = await invoke(host, "history", sourceQuery(population, original))
      expect(read).toMatchObject({ status: "unresolved", source: original.source, gap: current.current.gap })
      expect(read).not.toHaveProperty("value")
      expect(JSON.stringify(read)).not.toMatch(/OVERSIZED_ORIGINAL_|UNRELATED_OVERSIZED_/)
      expect(populations(host)).toEqual(stored)
    }
    // Every presentation reads the same authorized gap and original descriptor.
    const after = originalMembers.findIndex(member => member.key === original.key)
    for (const response_format of ["markdown", "html"]) {
      const output = await host.tools.get("history").execute({ ...query(population), after, limit: 1, response_format },
        { sessionID: "owner", agent: "author", messageID: "gap", id: "gap", signal: new AbortController().signal })
      expect(output.content).toContain("native-source-processing-limit")
      expect(output.content).toContain(original.key)
      expect(output.content).toContain(population.manifest_sha256)
      expect(output.content).not.toContain("UNRELATED_OVERSIZED_")
    }
    // A source gap does not waive preparation's original-source requirement.
    await expect(invoke(host, "review", { operation: "prepare-evaluation", population_id: population.population_id,
      manifest_sha256: population.manifest_sha256, method: method(), budget_policy: null })).rejects.toThrow("Retrospective preparation source unavailable or changed")
    expect(populations(host)).toEqual(stored)
    host.nativeContexts.set("owner", { data: valid })
    expect((await invoke(host, "history", sourceQuery(population, original))).status).toBe("available")
  } finally { await host.close() }
})

test("native tool-part count gaps preserve a frozen population instead of suppressing its page", async () => {
  const host = await registeredLoom()
  try {
    const selected = await selection(host, 1)
    const tool = { type: "tool", id: "part", name: "shell", state: { status: "completed", input: { command: "controlled" }, content: "original" } }
    const message = { id: "assistant", type: "assistant", content: [tool] }
    host.nativeContexts.set("owner", { data: [...selected.context, message] })
    await invoke(host, "objective", { operation: "link", objective_id: selected.objective.id, phase: "verification", assessment: "pass",
      source_type: "native-call", source_id: tool.id, source_message_id: message.id })
    const preview = await invoke(host, "history", { operation: "preview-population", selection: selected.selection })
    const population = await invoke(host, "review", preview.freeze), originalMembers = await members(host, population)
    host.nativeContexts.set("owner", { data: [...selected.context, { ...message,
      content: [tool, ...Array.from({ length: 60000 }, () => ({ type: "text", text: "small" }))] }] })
    const all = await members(host, await invoke(host, "history", { ...query(population), limit: 1 }))
    expect(all.map(descriptor)).toEqual(originalMembers.map(descriptor))
    const part = all.find(member => member.source.kind === "native-call")
    expect(part.current).toMatchObject({ status: "unresolved", gap: { code: "native-source-processing-limit" } })
    expect(await invoke(host, "history", sourceQuery(population, part))).toMatchObject({ status: "unresolved", gap: part.current.gap })
  } finally { await host.close() }
})

test("native gaps do not mask invalid source identities, authorization denial or in-flight cancellation", async () => {
  const host = await registeredLoom()
  try {
    const selected = await selection(host, 1)
    const preview = await invoke(host, "history", { operation: "preview-population", selection: selected.selection })
    const population = await invoke(host, "review", preview.freeze)
    const original = (await members(host, population)).find(member => member.source.kind === "native-message")
    const read = sourceQuery(population, original)
    for (const context of [null, {}, [null], [...selected.context, ...selected.context]]) {
      host.nativeContexts.set("owner", { data: context })
      await expect(invoke(host, "history", read)).rejects.toThrow()
    }
    host.nativeContexts.set("owner", { data: [...selected.context, { id: "large", type: "user", text: "x".repeat(17 * 1024 * 1024) }] })
    host.permission.error = new Error("native source denied")
    await expect(invoke(host, "history", { ...query(population), limit: 1 })).rejects.toThrow("native source denied")
    host.permission.error = undefined
    const abort = new AbortController(), calls = countReads(host)
    calls.beforeRead = () => abort.abort(new Error("native original cancelled during retrieval"))
    await expect(host.tools.get("history").execute(read,
      { sessionID: "owner", agent: "author", messageID: "cancel", id: "cancel", signal: abort.signal })).rejects.toThrow("cancelled during retrieval")
  } finally { await host.close() }
})

for (const count of [53, 54, 55, 65]) test(`registered original admission preserves preview/freeze capacity at ${count} owner attempts`, async () => {
  const host = await registeredLoom()
  try {
    const selected = await selection(host, count), calls = countReads(host)
    const input = { operation: "preview-population", selection: selected.selection, limit: 1 }
    if (count > 54) {
      const before = populations(host)
      await expect(invoke(host, "history", input)).rejects.toThrow("selection exceeds 54 native/external resolution attempts")
      expect(calls.count).toBe(54)
      expect(populations(host)).toEqual(before)
      expect(before.headers).toHaveLength(0)
      return
    }
    const preview = await invoke(host, "history", input)
    expect(calls.count).toBeGreaterThanOrEqual(count)
    expect(calls.count).toBeLessThanOrEqual(count + 1)
    expect(populations(host).headers).toHaveLength(0)
    calls.count = 0
    const population = await invoke(host, "review", preview.freeze)
    expect(calls.count).toBeGreaterThanOrEqual(count * 2)
    expect(calls.count).toBeLessThanOrEqual(128)
    expect(population.manifest_sha256).toBe(preview.manifest_sha256)
    expect(population.items.length).toBeLessThanOrEqual(20)
    expect(population.navigation.next).not.toBeNull()
    expect(populations(host).headers).toHaveLength(1)
    const all = await members(host, population)
    const originals = all.filter(member => member.source.kind === "native-message")
    expect(originals).toHaveLength(count)
    expect(originals.every(member => member.current.status === "available")).toBe(true)
    calls.count = 0
    const replay = await invoke(host, "review", preview.freeze)
    expect(replay.population_id).toBe(population.population_id)
    expect(replay.manifest_sha256).toBe(population.manifest_sha256)
    expect(calls.count).toBeLessThanOrEqual(20)
    expect(populations(host).headers).toHaveLength(1)
  } finally { await host.close() }
})

test("selection admission counts repeated original associations before member deduplication", async () => {
  const host = await registeredLoom()
  try {
    const selected = await selection(host, 54)
    await invoke(host, "objective", { operation: "link", objective_id: selected.objective.id,
      phase: "requirement-change", source_type: "native-message", source_id: selected.context[0]!.id, note: "Second explicit association to the same original." })
    const calls = countReads(host), before = populations(host)
    await expect(invoke(host, "history", { operation: "preview-population", selection: selected.selection, limit: 1 }))
      .rejects.toThrow("selection exceeds 54 native/external resolution attempts")
    expect(calls.count).toBe(54)
    expect(populations(host)).toEqual(before)
  } finally { await host.close() }
})

test("admitted freeze revalidates originals after reconstruction and before publication", async () => {
  const host = await registeredLoom()
  try {
    const selected = await selection(host, 54), calls = countReads(host)
    const preview = await invoke(host, "history", { operation: "preview-population", selection: selected.selection, limit: 50 })
    expect(calls.count).toBeLessThanOrEqual(104)
    const before = populations(host)
    calls.count = 0
    calls.beforeRead = count => {
      if (count === 55) for (const original of selected.context) original.text = "Changed between reconstruction and fresh source validation."
    }
    await expect(invoke(host, "review", preview.freeze)).rejects.toThrow("Retrospective preparation source unavailable or changed")
    expect(calls.count).toBe(55)
    expect(populations(host)).toEqual(before)
    expect(before.headers).toHaveLength(0)
  } finally { await host.close() }
})

test("admitted freeze rejects native authorization revoked before fresh validation without publication", async () => {
  const host = await registeredLoom()
  try {
    const selected = await selection(host, 54), calls = countReads(host)
    const preview = await invoke(host, "history", { operation: "preview-population", selection: selected.selection, limit: 1 })
    const before = populations(host)
    calls.count = 0
    let denied = false
    host.permission.beforeReturn = async () => {
      const request = host.permissionRequests.at(-1)
      if (calls.count === 54 && request.resources.some((resource: string) =>
        resource.startsWith("loom:evidence:inspect:session:owner:message:") && resource.endsWith(":view:native-user-text"))) {
        denied = true
        host.permission.error = new Error("Native source grant revoked before fresh validation")
      }
    }
    await expect(invoke(host, "review", preview.freeze)).rejects.toThrow("Native source grant revoked before fresh validation")
    expect(denied).toBe(true)
    expect(calls.count).toBe(54)
    expect(populations(host)).toEqual(before)
    expect(before.headers).toHaveLength(0)
  } finally { await host.close() }
})
