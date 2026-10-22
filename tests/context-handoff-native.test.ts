import { test, expect } from "bun:test"
import { writeFile } from "node:fs/promises"
import { join } from "node:path"
import { registeredLoom } from "./helpers/registered-loom.js"
import { TOOL_HELP } from "../src/tool-help.js"

async function fixture() {
  const f = await registeredLoom()
  try {
    const action = (await f.invoke("action", { operation: "create", title: "Fresh handoff", goal: "Preserve work without inherited review opinions" }, "writer")).result
    await f.invoke("plan", { operation: "save", action_id: action.id, expected_revision: 0, nodes: [
      { id: "research", kind: "task", title: "Find facts" },
      { id: "work", kind: "task", title: "Implement", depends_on: ["research"] },
    ] })
    const result = (await f.invoke("record", { operation: "add", action_id: action.id, node_id: "research", kind: "result",
      statement: "PINNED-SOURCE: abc123. " + "Details. ".repeat(150) + "UNVERIFIED provider compatibility." }, "writer")).result
    await f.invoke("record", { operation: "add", action_id: action.id, node_id: "work", kind: "assessment", verdict: "pass", statement: "PRIOR-VERDICT-SENTINEL" }, "writer")
    const question = (await f.invoke("record", { operation: "ask", question: "PRIOR-QUESTION-SENTINEL", to_agent: "investigator", blocking: false,
      reference: { action_id: action.id, kind: "task", id: "work" } }, "writer")).result
    expect(question).toMatchObject({ action_id: action.id, kind: "question", data: { question: "PRIOR-QUESTION-SENTINEL" } })
    await writeFile(join(f.directory, ".loom.yaml"), "agents: {investigator: {enabled: true}}\ninstructions: {enabled: true}\ncontext: {max_chars: 2000}\nledger: {capture: off}\n")
    return { ...f, action, result, question }
  } catch (error) { await f.close(); throw error }
}

test("registered context mode persists through reads, reselection and automatic injection", async () => {
  const f = await fixture()
  try {
    const tool = f.tools.get("context")
    expect(tool.input.properties.mode.enum).toEqual(["continuation", "independent"])
    expect(tool.input.properties.handoff_id.type).toEqual(["string", "null"])
    expect(tool.description).toBe(TOOL_HELP.context)
    expect(tool.description.length).toBeLessThanOrEqual(3600)
    const first = await f.invoke("context", { action_id: f.action.id, node_id: "work", mode: "independent" }, "review", "investigator")
    expect(first.result.history_withheld).toBe(true)
    expect(JSON.stringify(first).length).toBeLessThanOrEqual(2000)
    for (const input of [{}, { action_id: f.action.id, node_id: "work" }]) {
      const next = await f.invoke("context", input, "review", "investigator")
      expect(next.result.context_mode).toBe("independent")
      expect(JSON.stringify(next)).not.toContain("PRIOR-VERDICT-SENTINEL")
      expect(JSON.stringify(next)).not.toContain("PRIOR-QUESTION-SENTINEL")
    }
    const automatic = await f.context("review", "investigator")
    expect(automatic.context_mode).toBe("independent")
    expect(automatic.records).toEqual([])
    expect(automatic.questions).toEqual([])
    await f.invoke("record", { operation: "add", kind: "assessment", verdict: "inconclusive", statement: "Own observations recorded before reconciliation." }, "review", "investigator")
    await f.invoke("context", { mode: "continuation" }, "review", "investigator")
    expect((await f.context("review", "investigator")).context_mode).toBe("continuation")
    const history = (await f.invoke("record", { operation: "query", action_id: f.action.id }, "review")).result.items
    expect(history.some((r: any) => r.data.statement === "PRIOR-VERDICT-SENTINEL")).toBe(true)
    // Reconcile a known question by immutable ID rather than assuming it is on
    // the first history page. The view neither deletes findings nor resolves them.
    const thread = (await f.invoke("record", { operation: "query", view: "thread", action_id: f.action.id, question_id: f.question.id }, "review")).result
    expect(thread.question).toMatchObject({ id: f.question.id, action_id: f.action.id, node_id: "work", kind: "question", data: { question: "PRIOR-QUESTION-SENTINEL" } })
    expect(thread.answers).toEqual([])
  } finally { await f.close() }
})

test("registered handoff pointer survives sampling and reads the full dependency record", async () => {
  const f = await fixture()
  try {
    for (let i = 0; i < 8; i++) await f.invoke("record", { operation: "add", action_id: f.action.id, node_id: "research", kind: "result", statement: `Newer ${i}` }, "writer")
    const response = await f.invoke("context", { action_id: f.action.id, node_id: "work", handoff_id: f.result.id }, "next")
    expect(response.result.handoff).toEqual({ record_id: f.result.id, source_node_id: "research" })
    expect(JSON.stringify(response).length).toBeLessThanOrEqual(2000)
    const exact = (await f.invoke("record", { operation: "query", action_id: f.action.id, record_id: f.result.id }, "next")).result.items[0]
    expect(exact).toMatchObject(f.result)
    expect(exact.data.statement).toContain("UNVERIFIED provider compatibility.")
    expect((await f.invoke("context", {}, "next")).result.handoff.record_id).toBe(f.result.id)
    expect((await f.invoke("context", { handoff_id: null }, "next")).result.handoff).toBeUndefined()
    await expect(f.invoke("context", { mode: "independent", handoff_id: f.result.id }, "next")).rejects.toThrow("cannot include")
    await expect(f.invoke("context", { handoff_id: "absent" }, "next")).rejects.toThrow("existing result")
    await expect(f.invoke("context", { clear: true, mode: "independent" }, "next")).rejects.toThrow("cannot be combined")
    expect((await f.invoke("context", { clear: true }, "next")).result.selected).toBeNull()
  } finally { await f.close() }
})

test("independent missing-task recovery does not reintroduce prior question history", async () => {
  const f = await fixture()
  try {
    await f.invoke("context", { action_id: f.action.id, node_id: "work", mode: "independent" }, "review", "investigator")
    await f.invoke("plan", { operation: "save", action_id: f.action.id, expected_revision: 1, nodes: [
      { id: "research", kind: "task", title: "Find facts" },
    ] })
    const automatic = await f.context("review", "investigator")
    expect(automatic.recovery.code).toBe("task-not-in-current-plan")
    expect(automatic.selection_unchanged).toBe(true)
    expect(automatic.context_mode).toBe("independent")
    expect(JSON.stringify(automatic)).not.toContain("PRIOR-QUESTION-SENTINEL")
    expect(JSON.stringify(automatic)).not.toContain("PRIOR-VERDICT-SENTINEL")
  } finally { await f.close() }
})
