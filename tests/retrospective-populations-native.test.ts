import { expect, spyOn, test } from "bun:test"
import { createHash } from "node:crypto"
import { writeFile } from "node:fs/promises"
import { Database } from "bun:sqlite"
import { join } from "node:path"
import { canonical, digest, type LedgerRecord } from "../src/model.js"
import type { EvaluatorMethodManifest } from "../src/evaluator-method.js"
import { LearningSources } from "../src/learning-sources.js"
import { Store } from "../src/store.js"
import { registeredLoom } from "./helpers/registered-loom.js"
import { engineeringTrajectoryFixture } from "./helpers/engineering-trajectory-fixture.js"

type Host = Awaited<ReturnType<typeof registeredLoom>>
type Member = { key: string; ordinal: number; source: { kind: string; id: string; session_id?: string; message_id?: string; revision?: string; sha256?: string };
  permitted_view: string; availability: string; basis: unknown[]; historical_scope: unknown; qualifications: string[]; current: { status: string } }
type Page = { format: string; state: string; population_id?: string; manifest_sha256: string; manifest: any; member_count: number; items: Member[];
  navigation: { next: Record<string, unknown> | null }; freeze: Record<string, unknown> }
const hash = (value: string) => createHash("sha256").update(value).digest("hex")
const execute = (f: Host, tool: string, input: unknown, session = "owner", signal = new AbortController().signal) =>
  f.tools.get(tool).execute(input, { sessionID: session, agent: "author", messageID: "population-read", id: "population-call", signal })
const invoke = async (f: Host, tool: string, input: unknown, session = "owner") =>
  (await f.invoke(tool, input, session)).result
const ledgerMembers = (members: Member[]) => members.filter(member => member.source.kind === "ledger-record")
const ledgerIDs = (members: Member[]) => ledgerMembers(members).map(member => member.source.id).sort()
const frozenQuery = (frozen: Page) => ({ operation: "population", population_id: frozen.population_id, manifest_sha256: frozen.manifest_sha256 })
const retained = (members: Member[]) => members.map(({ current: _current, ordinal: _ordinal, ...member }) => member)
function method(): EvaluatorMethodManifest {
  const content = (name: string) => ({ locator: "fixture://retrospective/" + name, sha256: digest(name) })
  const policy = (name: string) => ({ id: name, revision: "1", sha256: digest(name) })
  return { format: "loom-evaluator-method/v1", evaluator: { agent: "evaluator", definition: content("evaluator") },
    audit_skill: { skill: "agent-run-audit", definition: content("agent-run-audit") }, rubric: content("rubric"),
    instruction_bundle: content("bundle"), result_format: "loom-evaluator-interpretation/v1",
    model: { provider_id: "unqualified-fixture", model_id: "never-dispatched", settings: content("settings") },
    adapter: { id: "unqualified", version: "1", profile: policy("profile") }, source_policy: policy("source"), route_policy: policy("route") }
}

async function exhaust(f: Host, first: Page, session = "owner") {
  const pages = [first], items = [...first.items], seen = new Set(items.map(member => member.key))
  let next = first.navigation.next
  while (next) {
    expect(pages.length).toBeLessThan(150)
    const page = await invoke(f, "history", next, session) as Page
    expect(page.manifest_sha256).toBe(first.manifest_sha256)
    expect(page.manifest).toEqual(first.manifest)
    expect(page.member_count).toBe(first.member_count)
    expect(page.state).toBe(first.state)
    for (const member of page.items) {
      expect(member.ordinal).toBe(items.length + 1)
      expect(seen.has(member.key)).toBe(false)
      seen.add(member.key); items.push(member)
    }
    pages.push(page); next = page.navigation.next
  }
  expect(items[0]?.ordinal).toBe(1)
  expect(items.length).toBe(first.member_count)
  return { pages, items }
}

function state(f: Host) {
  const root = join(f.directory, "state", "loom", "actions-v1", digest({ project: "tool-help", canonical: f.directory }))
  return Object.fromEntries(["ledger.sqlite", "learning.sqlite"].map(name => {
    const db = new Database(join(root, name), { readonly: true })
    try {
      const names = (db.query("SELECT name FROM sqlite_schema WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all() as { name: string }[]).map(row => row.name)
      return [name, digest(names.map(table => ({ table, rows: db.query('SELECT * FROM "' + table + '" ORDER BY rowid').all() })))]
    } finally { db.close() }
  }))
}

async function unplanned(count = 31) {
  const f = await registeredLoom()
  try {
    const action = await invoke(f, "action", { operation: "create", title: "Large unplanned Action", goal: "Keep independent objectives separate" })
    const records: LedgerRecord[] = []
    for (let i = 0; i < count; i++) records.push(await invoke(f, "record", { operation: "add", action_id: action.id, kind: i ? "result" : "concern",
      statement: i ? `Selected correction evidence ${i}; authored claim only.` : "Original failure, historical cause unproven.",
      evidence_ids: [], artifact_refs: [] }, i % 2 ? "worker-a" : "worker-b"))
    const objective = await invoke(f, "objective", { operation: "create", source_type: "ledger-record", source_id: records[0]!.id,
      label: "One bounded correction" })
    for (const record of records) await invoke(f, "objective", { operation: "link", objective_id: objective.id,
      phase: "coordination", source_type: "ledger-record", source_id: record.id })
    const unrelated = await invoke(f, "record", { operation: "add", action_id: action.id, kind: "result", statement: "PRIVATE_UNRELATED_OBJECTIVE_ONLY" }, "other-worker")
    const other = await invoke(f, "objective", { operation: "create", source_type: "ledger-record", source_id: unrelated.id,
      label: "Separate exporter objective" })
    await invoke(f, "objective", { operation: "link", objective_id: other.id, phase: "coordination",
      source_type: "ledger-record", source_id: records[0]!.id, note: "Shared evidence does not merge the two goals." })
    // The same record is deliberately linked twice to the selected goal. Its
    // two bases are retained while its exact evidence identity appears once.
    await invoke(f, "objective", { operation: "link", objective_id: objective.id, phase: "coverage-gap",
      source_type: "ledger-record", source_id: records[0]!.id, gap_reason: "missing-source", note: "Native original ordering was not captured." })
    for (let i = 0; i < 105; i++) await invoke(f, "record", { operation: "add", action_id: action.id,
      kind: "result", statement: "Independent unrelated Action activity " + i }, "noise")
    return { f, action, objective, records, unrelated, other, selection: { objective_id: objective.id,
      question: "Explain this bounded correction and its missing original evidence." } }
  } catch (error) { await f.close(); throw error }
}

test("registered population preview is read-only, bounded, deduplicated and excludes connected independent goals", async () => {
  const fixture = await unplanned(), { f, selection } = fixture
  try {
    const before = state(f)
    const first = await invoke(f, "history", { operation: "preview-population", selection, limit: 5 }) as Page
    expect(first).toMatchObject({ format: "loom-retrospective-population-view/v1", state: "preview" })
    expect(first.freeze).toMatchObject({ operation: "freeze-population", preview_sha256: first.manifest_sha256 })
    const { pages, items } = await exhaust(f, first)
    expect(pages.length).toBeGreaterThan(1)
    expect(ledgerIDs(items)).toEqual(fixture.records.map(record => record.id).sort())
    expect(items.filter(member => member.source.kind === "objective").map(member => member.source.id)).toEqual([fixture.objective.id])
    expect(ledgerMembers(items).every(member => (member.historical_scope as { work_ref: unknown }).work_ref === null)).toBe(true)
    expect(items.find(member => member.source.id === fixture.records[0]!.id)!.basis.length).toBeGreaterThan(1)
    expect(JSON.stringify({ first, items })).not.toContain(fixture.other.id)
    expect(JSON.stringify({ first, items })).not.toContain("PRIVATE_UNRELATED_OBJECTIVE_ONLY")
    for (const record of fixture.records) {
      const member = ledgerMembers(items).find(item => item.source.id === record.id)!
      expect(member.source).toMatchObject({ session_id: record.session_id, sha256: digest(record) })
      expect(member.permitted_view).toBe("record-full")
      expect(member.current.status).toBe("available")
    }
    expect(state(f)).toEqual(before)
    expect(f.sessionCreates).toEqual([]); expect(f.sessionPrompts).toEqual([]); expect(f.nativeInputs).toEqual([])
  } finally { await f.close() }
})

test("native calls sharing a call ID retain distinct message identities through frozen preparation", async () => {
  const f = await registeredLoom([], { beforeSetup: directory => writeFile(join(directory, ".loom.yaml"),
    "agents: {}\ninstructions: {enabled: false}\nledger: {capture: automatic}\n") })
  try {
    const record = await invoke(f, "record", { operation: "add", kind: "result", statement: "Controlled selected original", session_only: true })
    const objective = await invoke(f, "objective", { operation: "create", source_type: "ledger-record", source_id: record.id,
      label: "Retain both native source identities" })
    f.nativeContexts.set("owner", { data: ["message-a", "message-b"].map(id => ({ id, type: "assistant", agent: "author", time: { created: 10 },
      content: [{ type: "tool", id: "reused-call", name: "task", state: { status: "completed", input: { subagent_type: "coder", prompt: "Controlled" } } }] })) })
    for (const source_message_id of ["message-a", "message-b"]) await invoke(f, "objective", { operation: "link", objective_id: objective.id,
      phase: "dispatch", source_type: "native-call", source_id: "reused-call", source_message_id })
    const preview = await invoke(f, "history", { operation: "preview-population", selection: { objective_id: objective.id,
      question: "Inspect the distinct calls without claiming native originals are resolved." }, limit: 50 }) as Page
    const frozen = await invoke(f, "review", preview.freeze) as Page
    const native = (await exhaust(f, frozen)).items.filter(member => member.source.kind === "native-call")
    expect(native).toHaveLength(2)
    expect(new Set(native.map(member => member.key)).size).toBe(2)
    expect(native.map(member => member.source.message_id).sort()).toEqual(["message-a", "message-b"])
    for (const member of native) {
      expect(member.source).toMatchObject({ kind: "native-call", session_id: "owner", id: "reused-call" })
      expect(member.availability).toBe("unsupported")
      expect(member.current.status).toBe("unsupported")
    }
    const prepared = await invoke(f, "review", { operation: "prepare-evaluation", population_id: frozen.population_id,
      manifest_sha256: frozen.manifest_sha256, method: method(), budget_policy: null })
    const read = await invoke(f, "insights", { operation: "evaluation-preparation-members", batch_id: prepared.batch_id,
      request_id: prepared.request_id, manifest_sha256: prepared.manifest_sha256, limit: 50 })
    for (const member of native) expect(read.items.find((item: { key: string }) => item.key === member.key).source_refs).toEqual([member.source])
    expect(f.sessionCreates).toEqual([]); expect(f.sessionPrompts).toEqual([]); expect(f.nativeInputs).toEqual([])
  } finally { await f.close() }
})

test("later record pages exhaust dense relationship continuations without losing or duplicating ledger basis", async () => {
  const f = await registeredLoom()
  try {
    const action = await invoke(f, "action", { operation: "create", title: "Dense later page", goal: "Retain every selected relationship" })
    const records: LedgerRecord[] = [], links: Array<{ sequence: number }> = []
    const db = new Database(join(f.directory, "state", "loom", "actions-v1", digest({ project: "tool-help", canonical: f.directory }), "ledger.sqlite"))
    try {
      const store = new Store(db)
      for (let i = 0; i < 30; i++) records.push(i >= 20 && i < 25
        ? store.append({ action_id: action.id, session_id: "owner", agent: "author", kind: "observation", data: {
          phase: "finished", status: "completed", tool: "shell", call_id: "controlled-" + i, attribution: "unavailable" } })
        : await invoke(f, "record", { operation: "add", action_id: action.id, kind: "result", statement: "Controlled source " + i,
          evidence_ids: i >= 25 ? [records[20]!.id] : [] }))
    } finally { db.close() }
    const objective = await invoke(f, "objective", { operation: "create", source_type: "ledger-record", source_id: records[0]!.id,
      label: "One selected dense objective" })
    for (const record of records) links.push(await invoke(f, "objective", { operation: "link", objective_id: objective.id,
      phase: "coordination", source_type: "ledger-record", source_id: record.id }))
    for (let from = 25; from < 30; from++) for (let to = 20; to < 25; to++)
      for (const phase of ["request", "dispatch", "planned-increment", "requirement-change", "environment-failure"])
        await invoke(f, "objective", { operation: "link", objective_id: objective.id, phase, source_type: "ledger-record",
          source_id: records[from]!.id, related_sequence: links[to]!.sequence, relation: "supports" })
    const history = await invoke(f, "history", { operation: "read", objective_id: objective.id, limit: 20 })
    const later = await invoke(f, "history", { operation: "read", ...history.navigation.next_records })
    expect(later.records).toHaveLength(10)
    expect(later.navigation.next_relationships).not.toBeNull()
    const preview = await invoke(f, "history", { operation: "preview-population", selection: { objective_id: objective.id,
      question: "Preserve the five observed-source citations behind the dense later page." }, limit: 50 }) as Page
    const frozen = await invoke(f, "review", preview.freeze) as Page
    const items = (await exhaust(f, frozen)).items
    type Basis = { kind: string; relationship?: { kind: string; from: string; to: string; target: string; provenance?: { owner: string } } }
    const citations = new Set<string>()
    for (const member of ledgerMembers(items)) {
      const edges = (member.basis as Basis[]).filter(basis => basis.kind === "history-relationship" && basis.relationship?.provenance?.owner === "ledger")
      const keys = edges.map(basis => canonical(basis.relationship))
      expect(new Set(keys).size).toBe(keys.length)
      for (const basis of edges) {
        expect(basis.relationship!.target).toBe("included")
        citations.add(canonical([basis.relationship!.from, basis.relationship!.to, basis.relationship!.kind]))
      }
    }
    expect(citations.size).toBe(5)
    expect(ledgerIDs(items)).toEqual(records.map(record => record.id).sort())
    expect(items.flatMap(member => member.qualifications).some(qualification => qualification.includes("returned continuations are exhausted"))).toBe(true)
    expect(frozen.manifest.coverage.complete_selected_membership).toBe(true)
  } finally { await f.close() }
})

test("planned reference population retains distinct failure, rerun, correction and scoped verification originals", async () => {
  const fixture = await engineeringTrajectoryFixture({ records: 1200 })
  try {
    const first = await invoke(fixture.f, "history", { operation: "preview-population", selection: {
      objective_id: fixture.objective.id, question: fixture.question }, limit: 7 }, fixture.sessions.reader) as Page
    const { items } = await exhaust(fixture.f, first, fixture.sessions.reader)
    const originals = [...Object.values(fixture.records), ...Object.values(fixture.observations).flatMap(pair => [pair.start, pair.finish])]
    expect(ledgerIDs(items)).toEqual(originals.map(record => record.id).sort())
    expect(ledgerIDs(items)).not.toContain(fixture.unrelated.id)
    const frozen = await invoke(fixture.f, "review", first.freeze, fixture.sessions.reader) as Page
    expect(frozen.state).toBe("frozen")
    await expect(execute(fixture.f, "history", frozenQuery(frozen), "other-investigator")).rejects.toThrow("unavailable")
    for (const record of [fixture.records.finding, fixture.records.rerun, fixture.records.correction,
      fixture.records.recheck, fixture.records.releaseAcceptance]) {
      const member = items.find(item => item.source.kind === "ledger-record" && item.source.id === record.id)!
      const original = await invoke(fixture.f, "history", { operation: "population-source", population_id: frozen.population_id,
        manifest_sha256: frozen.manifest_sha256, member_key: member.key }, fixture.sessions.reader)
      expect(original.status).toBe("available")
      expect(original.value).toEqual(record)
      expect(member.source.sha256).toBe(digest(record))
    }
    expect(items.some(member => member.source.kind === "review-request" && member.source.id === fixture.reviews.scoped.request_id)).toBe(true)
    expect(JSON.stringify({ first, items })).not.toContain(fixture.reviews.foreign.request_id)
    expect(JSON.stringify({ first, items })).not.toContain("FOREIGN_PRIVATE_REVIEW_MANDATE")
    const work = ledgerMembers(items).map(member => member.historical_scope).filter(Boolean)
    expect(JSON.stringify(work)).toContain(fixture.work.original.node_id)
    expect(JSON.stringify(work)).toContain(fixture.work.corrected.node_id)
    expect(fixture.f.sessionCreates).toEqual([]); expect(fixture.f.sessionPrompts).toEqual([])
  } finally { await fixture.close() }
})

test("registered retrospective preparation retains its distinct source and canonical issue without an execution permit", async () => {
  const fixture = await engineeringTrajectoryFixture({ records: 240 }), { f, sessions } = fixture
  try {
    const preview = await invoke(f, "history", { operation: "preview-population", selection: {
      objective_id: fixture.objective.id, question: fixture.question } }, sessions.reader) as Page
    const frozen = await invoke(f, "review", preview.freeze, sessions.reader) as Page
    const frozenMembers = (await exhaust(f, await invoke(f, "history", { ...frozenQuery(frozen), limit: 5 }, sessions.reader), sessions.reader)).items
    const stage3Inventory = await invoke(f, "insights", { operation: "evaluations", limit: 1 }, sessions.reader)
    const selection = { operation: "prepare-evaluation", population_id: frozen.population_id,
      manifest_sha256: frozen.manifest_sha256, method: method(), budget_policy: null }
    const prepared = await invoke(f, "review", selection, sessions.reader)
    const replay = await invoke(f, "review", selection, sessions.reader)
    expect(replay).toEqual(prepared)
    const source = { kind: "retrospective-population", format: "loom-retrospective-population/v1",
      population_id: frozen.population_id, manifest_sha256: frozen.manifest_sha256 }
    expect(prepared).toMatchObject({ state: "prepared", mode: "preparation-only", automatic_model_calls: false,
      budget_reservation: null, interpretation: null, policy_authority: "not-established",
      request: { format: "loom-evaluation-request/v2", source, source_scope: "frozen-retrospective-population" },
      manifest: { format: "loom-evaluation-manifest/v2", source, member_count_unit: "deduplicated-evidence-sources", objective_count: 1 },
      issue: { attempt: { state: "prepared", claimant_id: null, native_outcome: "not-issued" } } })
    expect(prepared.request).not.toHaveProperty("source_batch_id")
    expect(await invoke(f, "insights", { operation: "evaluations", limit: 1 }, sessions.reader)).toEqual(stage3Inventory)
    for (const operation of ["evaluation", "evaluation-members", "evaluation-sources", "evaluation-observations"])
      await expect(execute(f, "insights", { operation, batch_id: prepared.batch_id }, sessions.reader)).rejects.toThrow("unavailable")
    const reread = await invoke(f, "insights", { operation: "evaluation-preparation", batch_id: prepared.batch_id }, sessions.reader)
    expect(reread).toEqual(prepared)
    const members: Array<{ key: string; ordinal: number; source_refs: unknown[] }> = []
    let after = 0
    for (;;) {
      const page = await invoke(f, "insights", { operation: "evaluation-preparation-members", batch_id: prepared.batch_id,
        request_id: prepared.request_id, manifest_sha256: prepared.manifest_sha256, after, limit: 6 }, sessions.reader)
      for (const member of page.items) { expect(member.ordinal).toBe(members.length + 1); members.push(member) }
      if (page.next_after === null) break
      expect(page.next_after).toBeGreaterThan(after); after = page.next_after
    }
    expect(members.length).toBe(frozen.member_count)
    expect(new Set(members.map(member => member.key)).size).toBe(members.length)
    expect(members.map(member => member.key).sort()).toEqual(frozenMembers.map(member => member.key).sort())
    for (const member of members) expect(member.source_refs).toEqual([frozenMembers.find(item => item.key === member.key)!.source])
    const sourceMember = frozenMembers.find(member => member.source.kind === "ledger-record" && member.source.id === fixture.records.finding.id)!
    const sourceQuery = { operation: "evaluation-preparation-source", batch_id: prepared.batch_id, request_id: prepared.request_id,
      manifest_sha256: prepared.manifest_sha256, member_key: sourceMember.key, source_index: 0 }
    expect(await invoke(f, "insights", sourceQuery, sessions.reader)).toMatchObject({ source: sourceMember.source,
      status: "available", value: fixture.records.finding, native_evaluator_retrieval: "not-established" })
    const admission = await invoke(f, "insights", { operation: "evaluation-admission", batch_id: prepared.batch_id,
      request_id: prepared.request_id, manifest_sha256: prepared.manifest_sha256, attempt_id: prepared.issue.attempt.attempt_id }, sessions.reader)
    expect(admission).toMatchObject({ mode: "assessment-only", state: "blocked", effect_permit: null,
      automatic_model_calls: false, dispatch_enabled: false, budget_reservation: null })
    await expect(execute(f, "review", selection, "other-investigator")).rejects.toThrow()
    await expect(execute(f, "review", { ...selection, batch_id: prepared.batch_id }, sessions.reader)).rejects.toThrow()
    for (const query of [{ operation: "evaluation-preparation", batch_id: prepared.batch_id }, sourceQuery])
      await expect(execute(f, "insights", query, "other-investigator")).rejects.toThrow("unavailable")
    const claimant = "controlled-prior-consumer"
    const claimed = fixture.store.reviews.claimIssue({ session_id: sessions.reader, agent: "author" },
      { request_id: prepared.request_id, kind: "initial" }, claimant)
    expect(claimed.status).toBe("claimed-now")
    const consumed = await invoke(f, "review", selection, sessions.reader)
    expect(consumed.request_id).toBe(prepared.request_id)
    expect(consumed.issue.attempt).toEqual(claimed.attempt)
    expect(consumed.issue.attempt.native_outcome).toBe("unknown")
    const queries = [
      { operation: "evaluation-preparation", batch_id: prepared.batch_id },
      { operation: "evaluation-preparation-members", batch_id: prepared.batch_id, request_id: prepared.request_id,
        manifest_sha256: prepared.manifest_sha256, after: 0, limit: 1 }, sourceQuery,
      { operation: "evaluation-admission", batch_id: prepared.batch_id, request_id: prepared.request_id,
        manifest_sha256: prepared.manifest_sha256, attempt_id: prepared.issue.attempt.attempt_id },
    ]
    f.permission.beforeReturn = async () => {
      if (f.permissionRequests.at(-1).resources.some((resource: string) => resource.includes(":inspect:session:" + sessions.ci + ":")))
        throw new Error("population contributor permission revoked")
    }
    for (const query of queries) await expect(execute(f, "insights", query, sessions.reader)).rejects.toThrow("permission revoked")
    await expect(execute(f, "review", selection, sessions.reader)).rejects.toThrow("permission revoked")
    for (const operation of ["read", "issue", "prepare", "work"])
      await expect(execute(f, "review", { operation, request_id: prepared.request_id,
        ...(operation === "work" ? { member_id: "evaluation-manifest" } : {}) }, sessions.reader)).rejects.toThrow("permission revoked")
    const { requester: _requester, ...review } = prepared.request.review_request
    const stripped = { ...review }; delete stripped.extensions
    f.nativeAgents.push({ id: "evaluator", mode: "subagent", hidden: false })
    for (const request of [review, stripped]) {
      await expect(execute(f, "review", { operation: "freeze", request }, sessions.reader)).rejects.toThrow("permission revoked")
      await expect(execute(f, "record", { operation: "ask", question: request.mandate.question, recipient: { kind: "agent", id: "evaluator" },
        blocking: true, review: request }, sessions.reader)).rejects.toThrow("permission revoked")
    }
    f.permission.beforeReturn = undefined
    fixture.db.prepare("UPDATE ledger SET data=json_set(data,'$.data.statement',?) WHERE id=?")
      .run("CHANGED_AFTER_PREPARATION_MUST_NOT_BE_SUBSTITUTED", fixture.records.finding.id)
    for (const query of queries) await expect(execute(f, "insights", query, sessions.reader)).rejects.toThrow("source unavailable or changed")
    await expect(execute(f, "review", selection, sessions.reader)).rejects.toThrow("source unavailable or changed")
    expect(f.sessionCreates).toEqual([]); expect(f.sessionPrompts).toEqual([]); expect(f.nativeInputs).toEqual([])
  } finally { await fixture.close() }
})

test("explicit exclusions retain their reason without silently broadening the chosen objective", async () => {
  const fixture = await unplanned(6), { f } = fixture
  try {
    const exclusion = { record_id: fixture.records[5]!.id, reason: "Outside this question: separate later deployment check." }
    const first = await invoke(f, "history", { operation: "preview-population", selection: {
      ...fixture.selection, exclusions: [exclusion] }, limit: 4 }) as Page
    const { items } = await exhaust(f, first)
    expect(first.manifest.selection.exclusions).toEqual([exclusion])
    expect(ledgerIDs(items)).toEqual(fixture.records.slice(0, 5).map(record => record.id).sort())
    expect(first.freeze.selection).toMatchObject({ exclusions: [exclusion] })
    const frozen = await invoke(f, "review", first.freeze) as Page
    expect(frozen.manifest.selection.exclusions).toEqual([exclusion])
    await expect(execute(f, "review", { ...first.freeze, preview_sha256: "f".repeat(64) })).rejects.toThrow()
  } finally { await f.close() }
})

test("late records, associations and current Plan changes cannot rewrite the frozen selection", async () => {
  const fixture = await unplanned(7), { f } = fixture
  try {
    const preview = await invoke(f, "history", { operation: "preview-population", selection: fixture.selection, limit: 5 }) as Page
    const frozen = await invoke(f, "review", preview.freeze) as Page
    const before = await exhaust(f, await invoke(f, "history", { ...frozenQuery(frozen), limit: 5 }))
    const late = await invoke(f, "record", { operation: "add", action_id: fixture.action.id, kind: "concern", statement: "LATE_COUNTEREVIDENCE" }, "later-worker")
    for (const record of [late, fixture.unrelated]) await invoke(f, "objective", { operation: "link", objective_id: fixture.objective.id,
      phase: "coordination", source_type: "ledger-record", source_id: record.id })
    await invoke(f, "plan", { operation: "save", action_id: fixture.action.id, expected_revision: 0,
      nodes: [{ id: "new-plan", kind: "task", title: "New Plan cannot rewrite prior unplanned history" }] })
    const after = await exhaust(f, await invoke(f, "history", { ...frozenQuery(frozen), limit: 3 }))
    expect(after.pages[0]!.manifest).toEqual(before.pages[0]!.manifest)
    expect(retained(after.items)).toEqual(retained(before.items))
    expect(ledgerIDs(after.items)).not.toContain(late.id)
    expect(ledgerIDs(after.items)).not.toContain(fixture.unrelated.id)
    expect(ledgerMembers(after.items).every(member => (member.historical_scope as { work_ref: unknown }).work_ref === null)).toBe(true)
    const fresh = await exhaust(f, await invoke(f, "history", { operation: "preview-population", selection: fixture.selection, limit: 5 }))
    expect(ledgerIDs(fresh.items)).toEqual([...fixture.records.map(record => record.id), late.id, fixture.unrelated.id].sort())
    expect(fresh.pages[0]!.manifest_sha256).not.toBe(frozen.manifest_sha256)
  } finally { await f.close() }
})

test("changed and missing originals stay explicit without replacing frozen identities or bytes", async () => {
  const fixture = await unplanned(4), { f } = fixture
  const root = join(f.directory, "state", "loom", "actions-v1", digest({ project: "tool-help", canonical: f.directory }))
  const db = new Database(join(root, "ledger.sqlite"))
  try {
    const preview = await invoke(f, "history", { operation: "preview-population", selection: fixture.selection }) as Page
    const frozen = await invoke(f, "review", preview.freeze) as Page
    const original = await exhaust(f, await invoke(f, "history", frozenQuery(frozen)))
    const changed = fixture.records[1]!, missing = fixture.records[2]!
    db.prepare("UPDATE ledger SET data=? WHERE id=?").run(canonical({ ...changed, data: { ...changed.data, statement: "PRIVATE_REPLACEMENT_BYTES" } }), changed.id)
    db.prepare("DELETE FROM ledger WHERE id=?").run(missing.id)
    const reread = await exhaust(f, await invoke(f, "history", frozenQuery(frozen)))
    expect(retained(reread.items)).toEqual(retained(original.items))
    for (const [record, status] of [[changed, "changed"], [missing, "missing"]] as const) {
      const member = reread.items.find(item => item.source.kind === "ledger-record" && item.source.id === record.id)!
      expect(member.source.sha256).toBe(digest(record))
      expect(member.current.status).toBe(status)
      const source = await invoke(f, "history", { operation: "population-source", population_id: frozen.population_id,
        manifest_sha256: frozen.manifest_sha256, member_key: member.key })
      expect(source.status).toBe(status)
      expect(source.value).toBeUndefined()
      expect(JSON.stringify(source)).not.toContain("PRIVATE_REPLACEMENT_BYTES")
    }
  } finally { db.close(); await f.close() }
})

test("sources absent before selection and unsupported external originals remain explicit frozen gaps", async () => {
  const fixture = await unplanned(4), { f } = fixture
  const root = join(f.directory, "state", "loom", "actions-v1", digest({ project: "tool-help", canonical: f.directory }))
  const db = new Database(join(root, "ledger.sqlite"))
  try {
    const external = "https://example.test/controlled/ci/a1/attempt/1"
    await invoke(f, "objective", { operation: "link", objective_id: fixture.objective.id, phase: "coordination",
      source_type: "external-ref", source_id: external, confidence: "uncertain", note: "Original CI content remains with its external owner." })
    db.prepare("DELETE FROM ledger WHERE id=?").run(fixture.records[1]!.id)
    const preview = await invoke(f, "history", { operation: "preview-population", selection: fixture.selection, limit: 3 }) as Page
    const selected = await exhaust(f, preview)
    const missing = selected.items.find(item => item.source.kind === "ledger-record" && item.source.id === fixture.records[1]!.id)!
    expect(missing).toMatchObject({ availability: "missing", current: { status: "missing" } })
    expect(missing.source.sha256).toBeUndefined()
    const unresolved = selected.items.find(item => item.source.kind === "external-ref" && item.source.id === external)!
    expect(unresolved).toMatchObject({ availability: "unsupported", current: { status: "unsupported" }, permitted_view: "reference-only" })
    expect(unresolved.source.sha256).toBeUndefined()
    const frozen = await invoke(f, "review", preview.freeze) as Page
    for (const member of [missing, unresolved]) {
      const source = await invoke(f, "history", { operation: "population-source", population_id: frozen.population_id,
        manifest_sha256: frozen.manifest_sha256, member_key: member.key })
      expect(source.status).toBe(member.current.status)
      expect(source.value).toBeUndefined()
    }
    expect(f.nativeListRequests).toEqual([])
    expect(f.sessionCreates).toEqual([]); expect(f.sessionPrompts).toEqual([])
  } finally { db.close(); await f.close() }
})

test("another authorized investigator reads the same frozen public evidence without becoming its owner", async () => {
  const fixture = await unplanned(5), { f } = fixture
  try {
    const preview = await invoke(f, "history", { operation: "preview-population", selection: fixture.selection, limit: 4 }) as Page
    const frozen = await invoke(f, "review", preview.freeze) as Page
    const owner = await exhaust(f, await invoke(f, "history", { ...frozenQuery(frozen), limit: 3 }))
    const other = await exhaust(f, await invoke(f, "history", { ...frozenQuery(frozen), limit: 4 }, "second-investigator"), "second-investigator")
    expect(other.pages[0]!.manifest_sha256).toBe(owner.pages[0]!.manifest_sha256)
    expect(retained(other.items)).toEqual(retained(owner.items))
    expect(f.permissionRequests.at(-1).resources.some((resource: string) => resource.includes(":recipient:second-investigator"))).toBe(true)
    const member = other.items.find(item => item.source.kind === "ledger-record")!
    const source = await invoke(f, "history", { operation: "population-source", population_id: frozen.population_id,
      manifest_sha256: frozen.manifest_sha256, member_key: member.key }, "second-investigator")
    expect(source.status).toBe("available")
    expect(source.receiving_session).toBe("second-investigator")
    expect(source.value.session_id).toBe(member.source.session_id)
  } finally { await f.close() }
})

for (const response_format of ["json", "markdown", "html"]) test(`population ${response_format} preserves exact identities and final disclosure byte hash`, async () => {
  const fixture = await unplanned(4), { f } = fixture
  try {
    const preview = await invoke(f, "history", { operation: "preview-population", selection: fixture.selection }) as Page
    const frozen = await invoke(f, "review", preview.freeze) as Page
    const raw = await execute(f, "history", { ...frozenQuery(frozen), response_format })
    expect(raw.content).toContain(frozen.population_id)
    expect(raw.content).toContain(frozen.manifest_sha256)
    for (const item of frozen.items) { expect(raw.content).toContain(item.key); expect(raw.content).toContain(item.source.id) }
    expect(f.permissionRequests.at(-1).metadata.view_sha256).toBe(hash(raw.content))
    expect(Buffer.byteLength(raw.content)).toBeLessThanOrEqual(262144)
    if (response_format === "html") { expect(raw.content).toContain("default-src 'none'"); expect(raw.content).not.toContain("<script") }
    f.permission.beforeReturn = async () => {
      if (f.permissionRequests.at(-1).metadata?.view_sha256) throw new Error("final population disclosure denied")
    }
    await expect(execute(f, "history", { ...frozenQuery(frozen), response_format })).rejects.toThrow("final population disclosure denied")
  } finally { await f.close() }
})

test("population source and contributor permission denials cannot disclose membership or originals", async () => {
  const fixture = await unplanned(5), { f } = fixture
  try {
    const preview = await invoke(f, "history", { operation: "preview-population", selection: fixture.selection }) as Page
    const frozen = await invoke(f, "review", preview.freeze) as Page
    f.permission.beforeReturn = async () => {
      if (f.permissionRequests.at(-1).resources.some((resource: string) => resource.includes("session:worker-a") && resource.includes(":inspect:")))
        throw new Error("controlled source denial")
    }
    for (const query of [{ operation: "preview-population", selection: fixture.selection }, frozenQuery(frozen)]) {
      for (const response_format of ["json", "markdown", "html"]) {
        let error: unknown
        try { await execute(f, "history", { ...query, response_format }) } catch (caught) { error = caught }
        expect(error).toBeInstanceOf(Error)
        expect((error as Error).message).toContain("controlled source denial")
        expect((error as Error).message).not.toContain(fixture.records[1]!.id)
        expect((error as Error).message).not.toContain(fixture.records[1]!.data.statement)
      }
    }
    f.permission.beforeReturn = undefined
    const member = frozen.items.find(item => item.source.kind === "ledger-record")!
    f.permission.beforeReturn = async () => {
      if (f.permissionRequests.at(-1).resources.some((resource: string) => resource.includes(":view:record-full")))
        throw new Error("exact original denied")
    }
    await expect(execute(f, "history", { operation: "population-source", population_id: frozen.population_id,
      manifest_sha256: frozen.manifest_sha256, member_key: member.key })).rejects.toThrow("exact original denied")
  } finally { await f.close() }
})

test("population exact originals preserve native source Session location checks before and during awaited reads", async () => {
  const fixture = await unplanned(4), { f } = fixture
  try {
    const preview = await invoke(f, "history", { operation: "preview-population", selection: fixture.selection }) as Page
    const frozen = await invoke(f, "review", preview.freeze) as Page
    const selected = await exhaust(f, await invoke(f, "history", frozenQuery(frozen)))
    const original = fixture.records[1]!, member = selected.items.find(item => item.source.kind === "ledger-record" && item.source.id === original.id)!
    const query = { operation: "population-source", population_id: frozen.population_id,
      manifest_sha256: frozen.manifest_sha256, member_key: member.key }
    const foreign = { id: original.session_id, projectID: "foreign-project", location: { directory: f.directory } }
    for (const unavailable of [foreign, new Error("PRIVATE_NATIVE_SOURCE_LOCATION")]) {
      f.sessions.set(original.session_id, unavailable)
      await expect(execute(f, "record", { operation: "query", action_id: fixture.action.id,
        source_session_id: original.session_id, record_id: original.id })).rejects.toThrow("Evidence source unavailable")
      await expect(execute(f, "history", query)).rejects.toThrow("Evidence source unavailable")
      f.sessions.delete(original.session_id)
    }
    let changed = false
    f.permission.beforeReturn = async () => {
      if (!changed && !f.permissionRequests.at(-1).metadata?.view_sha256 && f.permissionRequests.at(-1).resources.some((resource: string) =>
        resource.includes(":record:" + original.id + ":view:record-full"))) {
        changed = true; f.sessions.set(original.session_id, foreign)
      }
    }
    await expect(execute(f, "history", query)).rejects.toThrow("Evidence source unavailable")
    expect(changed).toBe(true)
    f.permission.beforeReturn = undefined; f.sessions.delete(original.session_id)
    // Change after the real source owner returns, before the shared final source
    // recheck. This does not claim an atomic host-policy/return fence.
    const read = LearningSources.prototype.retrospectiveOriginal
    const spy = spyOn(LearningSources.prototype, "retrospectiveOriginal").mockImplementation(function(this: LearningSources, ...args) {
      const result = read.apply(this, args)
      if (args[0] === "ledger-record" && args[1] === original.id) f.sessions.set(original.session_id, foreign)
      return result
    })
    try { await expect(execute(f, "history", query)).rejects.toThrow("Evidence source unavailable") }
    finally { spy.mockRestore(); f.sessions.delete(original.session_id) }
    expect(f.sessionCreates).toEqual([]); expect(f.sessionPrompts).toEqual([])
  } finally { f.permission.beforeReturn = undefined; await f.close() }
})

test("population requests reject forged authority, wrong identity and unpinned freeze", async () => {
  const fixture = await unplanned(3), { f } = fixture
  try {
    const preview = await invoke(f, "history", { operation: "preview-population", selection: fixture.selection }) as Page
    const frozen = await invoke(f, "review", preview.freeze) as Page
    for (const input of [
      { operation: "preview-population", selection: fixture.selection, recipient_session_id: "foreign" },
      { ...frozenQuery(frozen), approved: true },
      { ...frozenQuery(frozen), manifest_sha256: "f".repeat(64) },
      { ...frozenQuery(frozen), population_id: "another-population" },
      { operation: "population-source", population_id: frozen.population_id, manifest_sha256: frozen.manifest_sha256, member_key: "foreign" },
    ]) await expect(execute(f, "history", input)).rejects.toThrow()
    await expect(execute(f, "review", { operation: "freeze-population", selection: fixture.selection, preview_sha256: preview.manifest_sha256 })).rejects.toThrow()
    expect(f.sessionCreates).toEqual([]); expect(f.sessionPrompts).toEqual([]); expect(f.nativeInputs).toEqual([])
  } finally { await f.close() }
})

test("freeze awaits source permission and cancellation cannot create a durable population", async () => {
  const fixture = await unplanned(3), { f } = fixture
  try {
    const preview = await invoke(f, "history", { operation: "preview-population", selection: fixture.selection }) as Page
    const before = state(f), controller = new AbortController()
    let release!: () => void, reached!: () => void, held = false, settled = false
    const gate = new Promise<void>(resolve => { release = resolve }), waiting = new Promise<void>(resolve => { reached = resolve })
    f.permission.beforeReturn = async () => {
      if (!held && f.permissionRequests.at(-1).resources.some((resource: string) => resource.includes(":inspect:") && resource.includes("worker-a"))) {
        held = true; reached(); await gate
      }
    }
    const operation = execute(f, "review", preview.freeze, "owner", controller.signal).then(
      (value: unknown) => { settled = true; return { value, error: undefined } }, (error: unknown) => { settled = true; return { value: undefined, error } })
    await waiting
    expect(settled).toBe(false)
    expect(state(f)).toEqual(before)
    controller.abort(new Error("cancelled while resolving source")); release()
    const result = await operation
    expect(result.error).toBeDefined()
    expect(state(f)).toEqual(before)
    expect(f.sessionCreates).toEqual([]); expect(f.sessionPrompts).toEqual([])
  } finally { await f.close() }
})
