import { test, expect } from "bun:test"
import { Database } from "bun:sqlite"
import { readdir, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { registeredLoom } from "./helpers/registered-loom.js"
import { PROCESSING_LIMITS } from "../src/model.js"
import { defaults, mergeConfig } from "../src/config.js"
import { guidance } from "../src/agents.js"
import { readFileSync } from "node:fs"

async function fixture() {
  const f = await registeredLoom()
  try {
    const action = (await f.invoke("action", { operation: "create", title: "Concern acceptance", goal: "Preserve uncertainty honestly" }, "writer")).result
    await f.invoke("plan", { operation: "save", action_id: action.id, expected_revision: 0, nodes: [
      { id: "research", kind: "task", title: "Investigate" },
      { id: "work", kind: "task", title: "Implement", depends_on: ["research"] },
    ] })
    await f.invoke("context", { action_id: action.id, node_id: "research" }, "writer")
    await writeFile(join(f.directory, ".loom.yaml"), "agents: {}\ninstructions: {enabled: false}\nledger: {capture: automatic}\n")
    const event = { sessionID: "writer", agent: "investigator", messageID: "message", id: "read-source", tool: "read", input: { path: "fixture-source" } }
    await f.hooks.get("execute.before")(event)
    await f.hooks.get("execute.after")({ ...event, status: "completed", result: { content: "Fixture source" } })
    const observations = (await f.invoke("record", { operation: "query", session_only: true }, "writer")).result.items
    const observation = observations.find((r: any) => r.kind === "observation" && r.data.phase === "finished")
    expect(observation).toBeDefined()
    const add = (extra = {}) => f.invoke("record", { operation: "add", kind: "concern", statement: "Suspected incompatibility; scope remains unknown.", evidence_ids: [observation.id], artifact_refs: ["fixture://source-unverified"], ...extra }, "writer", "investigator")
    return { ...f, action, observation, add }
  } catch (error) { await f.close(); throw error }
}

test("registered concern preserves identity, origin, task and existing evidence across fresh reads", async () => {
  const f = await fixture()
  try {
    expect(f.tools.get("record").input.properties.kind.enum).toContain("concern")
    const concern = (await f.add()).result
    expect(concern).toMatchObject({ kind: "concern", action_id: f.action.id, node_id: "research", session_id: "writer", agent: "investigator",
      data: { statement: "Suspected incompatibility; scope remains unknown.", evidence_ids: [f.observation.id], artifact_refs: ["fixture://source-unverified"], verification: "agent-reported; not independently validated by Loom" } })
    expect(concern.id).toBeString(); expect(concern.created_at).toBeString()
    const exact = (await f.invoke("record", { operation: "query", action_id: f.action.id, record_id: concern.id }, "fresh-reader")).result.items[0]
    expect(exact).toMatchObject(concern)
    const root = join(f.directory, "state", "loom", "actions-v1")
    const db = new Database(join(root, (await readdir(root))[0], "ledger.sqlite"), { readonly: true })
    try {
      const row = db.query("SELECT data FROM ledger WHERE id=?").get(concern.id) as { data: string }
      expect(JSON.parse(row.data)).toEqual(concern)
    } finally { db.close() }
  } finally { await f.close() }
})

test("concerns participate in dependency context and Action/Session full history without mandatory delivery", async () => {
  const f = await fixture()
  try {
    const concerns = []
    for (let i = 0; i < 3; i++) concerns.push((await f.add({ statement: `Suspected dependency issue ${i}; not confirmed.` })).result)
    const existing = (await f.add({ kind: "result", statement: "Existing result stays visible." })).result
    const context = (await f.invoke("context", { action_id: f.action.id, node_id: "work" }, "reader")).result
    expect(context.records.some((r: any) => r.id === existing.id)).toBe(true)
    expect(context.records.filter((r: any) => r.kind === "concern").map((r: any) => r.id)).toEqual([concerns[2].id, concerns[1].id])
    expect(context.ledger_has_more).toBe(true)
    expect(context.retrieval.conclusion_limit).toBe(48)
    const session = (await f.invoke("record", { operation: "query", session_only: true }, "writer")).result
    expect(session.items.filter((r: any) => r.kind === "concern")).toHaveLength(3)
    for (const scope of [{ action_id: f.action.id }, { action_id: f.action.id, node_id: "research" }, { session_id: "writer" }]) {
      let cursor: string | null = null, markdown = "", pages = 0
      do {
        const page: { markdown: string; next_cursor: string | null } = (await f.invoke("record", { operation: "query", view: "full_thread", ...scope, limit: 1, ...(cursor ? { cursor } : {}) }, "reader")).result
        markdown += page.markdown; cursor = page.next_cursor; pages++
        expect(pages).toBeLessThan(20)
      } while (cursor)
      for (const concern of concerns) {
        expect(markdown).toContain(`Record ${concern.id} — concern`)
        expect(markdown).toContain(concern.data.statement)
      }
      expect(markdown).toContain(f.observation.id)
      expect(markdown).toContain('"agent":"investigator","session_id":"writer"')
    }
  } finally { await f.close() }
})

test("concerns reject bad inputs and invalid evidence while allowing Session-only records", async () => {
  const f = await fixture()
  try {
    const concern = (await f.add()).result
    const other = (await f.invoke("action", { operation: "create", title: "Other", goal: "Different evidence scope" }, "other")).result
    await f.invoke("context", { action_id: other.id }, "writer")
    const event = { sessionID: "writer", agent: "investigator", messageID: "message", id: "other-read", tool: "read", input: {} }
    await f.hooks.get("execute.before")(event)
    const wrongAction = (await f.invoke("record", { operation: "query", action_id: other.id })).result.items[0]
    await f.invoke("context", { action_id: f.action.id, node_id: "research" }, "writer")
    const before = (await f.invoke("record", { operation: "query", action_id: f.action.id })).result
    const invalid = [
      { action_id: "nonexistent-action" }, { action_id: f.action.id, node_id: "absent" }, { node_id: "research" },
      { evidence_ids: ["nonexistent-observation"] }, { evidence_ids: [wrongAction.id] }, { evidence_ids: [concern.id] },
      { evidence_ids: "not-a-list" }, { statement: " " }, { statement: 1 },
      { statement: "x".repeat(PROCESSING_LIMITS.recordChars + 1) }, { artifact_refs: [1] },
    ]
    for (const input of invalid) {
      await expect(f.add(input)).rejects.toThrow()
      expect((await f.invoke("record", { operation: "query", action_id: f.action.id })).result).toEqual(before)
    }
    const unscoped = (await f.invoke("record", { operation: "add", kind: "concern", statement: "No association" }, "unselected")).result
    expect(unscoped.action_id).toBeUndefined()
    expect((await f.invoke("record", { operation: "query", session_only: true }, "unselected")).result.items.map((r: any) => r.id)).toContain(unscoped.id)
    // Existing kinds reject concern IDs as evidence too, and still require review verdicts.
    await expect(f.add({ kind: "claim", evidence_ids: [concern.id] })).rejects.toThrow("existing observation")
    await expect(f.add({ kind: "assessment" })).rejects.toThrow("Review verdict")
  } finally { await f.close() }
})

test("consolidation cites two immutable originals from a different selected task and never changes progress", async () => {
  const f = await fixture()
  try {
    const progress = () => f.invoke("record", { operation: "query", view: "progress", action_id: f.action.id })
    const before = (await progress()).result
    const suspected = (await f.add()).result
    const confirmed = (await f.add({ statement: "Confirmed fixture mismatch: observed format differs. Outside this task; documented, not resolved." })).result
    await f.invoke("context", { action_id: f.action.id, node_id: "work" }, "critic")
    const statement = `Pattern: suspected compatibility risk at Action ${f.action.id} record ${suspected.id}; confirmed fixture mismatch at Action ${f.action.id} record ${confirmed.id}. Neither is resolved by consolidation.`
    const assessment = (await f.invoke("record", { operation: "add", kind: "assessment", statement, verdict: "inconclusive" }, "critic", "reviewer")).result
    expect(assessment.node_id).toBe("work")
    for (const original of [suspected, confirmed]) {
      // Selection-only lookup is intentionally filtered; the documented exact lookup is not.
      expect((await f.invoke("record", { operation: "query", record_id: original.id }, "critic")).result.items).toEqual([])
      const full = (await f.invoke("record", { operation: "query", action_id: original.action_id, record_id: original.id }, "critic")).result.items[0]
      const { sequence: _sequence, ...stored } = full
      expect(stored).toEqual(original)
      expect(assessment.data.statement).toContain(`Action ${full.action_id} record ${full.id}`)
    }
    // Action-only concerns are also valid; no task, verdict or new lifecycle fields required.
    expect((await f.add({ action_id: f.action.id, evidence_ids: [] })).result.node_id).toBeUndefined()
    expect((await progress()).result).toEqual(before)
    expect((await f.invoke("action", { operation: "list" })).result.items[0].state).toBe("active")
    expect(f.nativeInputs).toEqual([])
    expect(f.tools.size).toBe(8)
  } finally { await f.close() }
})

test("bounded concern excerpts disclose truncation and exact lookup retains all qualifications", async () => {
  const f = await fixture()
  try {
    await writeFile(join(f.directory, ".loom.yaml"), "agents: {}\ninstructions: {enabled: false}\nledger: {capture: off}\ncontext: {max_chars: 2000}\n")
    const statement = "Suspected only. " + "details ".repeat(1500) + "Final qualification: no confirmed defect."
    const concern = (await f.add({ statement })).result
    const context = (await f.invoke("context", { action_id: f.action.id, node_id: "work" }, "reader")).result
    expect(JSON.stringify({ result: context }).length).toBeLessThanOrEqual(2000)
    expect(context.truncated).toBe(true)
    expect(context.records.find((r: any) => r.id === concern.id)).toMatchObject({ kind: "concern", truncated: true })
    const full = (await f.invoke("record", { operation: "query", action_id: f.action.id, record_id: concern.id }, "reader")).result.items[0]
    expect(full.data.statement).toBe(statement)
  } finally { await f.close() }
})

test("shipped guidance assigns capture, routing and traceable consolidation without assuming native IDs", async () => {
  const config = mergeConfig(defaults(), { agents: {
    builder: { roles: ["implementation"] }, router: { roles: ["coordination"] }, challenger: { roles: ["qa"] },
  } })
  for (const id of ["builder", "router", "challenger"]) {
    const text = guidance(config, id)!
    for (const phrase of ["Every agent", "kind concern", "suspected", "confirmed", "not resolved"]) expect(text).toContain(phrase)
  }
  expect(guidance(config, "router")).toContain("General")
  expect(guidance(config, "router")).toContain("route blockers")
  expect(guidance(config, "challenger")).toContain("critic")
  expect(guidance(config, "challenger")).toContain("source Action and concern record IDs")
  const f = await registeredLoom()
  try {
    const help = f.tools.get("record").description
    expect(help.length).toBeLessThanOrEqual(10000)
    for (const text of [help, readFileSync(new URL("../src/skills/loom/SKILL.md", import.meta.url), "utf8")]) {
      for (const phrase of ["concern", "Every agent", "General", "critic", "suspected", "confirmed", "not resolved", "record_id"]) expect(text).toContain(phrase)
    }
  } finally { await f.close() }
})
