import { test, expect } from "bun:test"
import { Database } from "bun:sqlite"
import { writeFile, readdir } from "node:fs/promises"
import { join } from "node:path"
import { registeredLoom } from "./helpers/registered-loom.js"
import { TOOL_HELP } from "../src/tool-help.js"

const nodes = [
  { id: "research", kind: "task", title: "Research" },
  { id: "worker", kind: "task", title: "Worker", depends_on: ["research"] },
]

test("registered collaboration flow: separate agents, injection, reconfirmation and fresh Session", async () => {
  const f = await registeredLoom()
  try {
    await writeFile(join(f.directory, ".loom.yaml"), "agents:\n  author:\n    roles: [implementation]\n  investigator:\n    roles: [research]\nledger: {capture: off}\n")
    expect(f.tools.size).toBe(5)
    const invoke = async (name: string, input: unknown, session = "worker", agent = "author") => (await f.invoke(name, input, session, agent)).result
    const action = await invoke("action", { operation: "create", title: "Fixture task", goal: "Use a qualified response" })
    await invoke("plan", { operation: "save", action_id: action.id, expected_revision: 0, nodes })
    const initial = await invoke("context", { action_id: action.id, node_id: "worker" })
    await invoke("context", { action_id: action.id, node_id: "research" }, "research", "investigator")
    const question = await invoke("record", { operation: "ask", to_agent: "investigator", question: "Does the fixture include empty files?", blocking: false })
    const incoming = await f.context("research", "investigator")
    expect(incoming.task.id).toBe("research")
    expect(incoming.questions[0].question_id).toBe(question.id)
    const response = await invoke("record", { operation: "answer", question_id: question.id,
      answer: "Fixture-only response: empty files retain defaults; not a real repository finding.", context_attachments: ["fixture://empty-file"] }, "research", "investigator")
    expect(response.agent).toBe("investigator")
    expect(response.node_id).toBe("worker")
    expect((await invoke("context", {}, "research", "investigator")).task.id).toBe("research")
    const received = await f.context("worker", "author")
    expect(received.questions[0].answer.record_id).toBe(response.id)
    expect(received.questions[0].state).toBe("answered")
    const thread = await invoke("record", { operation: "query", view: "thread", question_id: question.id }, "research", "investigator")
    expect(thread.answers[0].data.context_attachments).toEqual(["fixture://empty-file"])
    const report = await invoke("record", { operation: "complete", work_ref: initial.work_ref, statement: "Fixture work finished." })
    expect((await f.context("worker", "author")).progress[0].state).toBe("reported-complete")
    await invoke("plan", { operation: "save", action_id: action.id, expected_revision: 1,
      nodes: nodes.map(n => n.id === "worker" ? { ...n, criteria: ["Cover another case"] } : n) })
    expect((await f.context("worker", "author")).progress[0].state).toBe("needs-reconfirmation")
    await invoke("record", { operation: "reopen", statement: "Need the additional case." })
    const fresh = await invoke("context", { action_id: action.id, node_id: "worker" }, "fresh")
    expect(fresh.progress[0].state).toBe("open")
    expect(fresh.questions[0].question_id).toBe(question.id)
    expect((await invoke("record", { operation: "query", action_id: action.id, record_id: report.id })).items[0].data.work_ref.plan_revision).toBe(1)
    expect((await invoke("action", { operation: "list" })).items[0].state).toBe("active")
    expect(f.tools.size).toBe(5)
  } finally { await f.close() }
})

test("question identity bypasses unrelated and unreadable selection; wrong explicit scope is rejected", async () => {
  const f = await registeredLoom()
  let db: Database | undefined
  try {
    const action = (await f.invoke("action", { operation: "create", title: "A", goal: "A" })).result
    const question = (await f.invoke("record", { operation: "ask", question: "Question?", to_agent: "investigator", blocking: false })).result
    const other = (await f.invoke("action", { operation: "create", title: "B", goal: "B" }, "research", "investigator")).result
    await expect(f.invoke("record", { operation: "answer", question_id: question.id, action_id: other.id, answer: "Wrong Action" }, "research", "investigator")).rejects.toThrow("not supported")
    const root = join(f.directory, "state", "loom", "actions-v1")
    db = new Database(join(root, (await readdir(root))[0], "ledger.sqlite"))
    db.prepare("UPDATE focus SET data=? WHERE session_id=?").run("broken JSON", "research")
    const result = (await f.invoke("record", { operation: "answer", question_id: question.id, answer: "Response despite unrelated broken selection." }, "research", "investigator")).result
    expect(result.action_id).toBe(action.id)
    expect((await f.invoke("record", { operation: "query", view: "thread", question_id: question.id }, "research", "investigator")).result.answers[0].id).toBe(result.id)
    expect(db.prepare("SELECT data FROM focus WHERE session_id=?").get("research")).toEqual({ data: "broken JSON" })
  } finally { db?.close(); await f.close() }
})

test("completion cannot borrow current selection and rejects incomplete work references", async () => {
  const f = await registeredLoom()
  try {
    const action = (await f.invoke("action", { operation: "create", title: "A", goal: "Original" })).result
    await f.invoke("plan", { operation: "save", action_id: action.id, expected_revision: 0, nodes })
    const worked = (await f.invoke("context", { action_id: action.id, node_id: "worker" })).result
    await f.invoke("action", { operation: "update", action_id: action.id, expected_revision: 1, goal: "Different goal" })
    await f.invoke("context", { action_id: action.id, node_id: "research" })
    await expect(f.invoke("record", { operation: "complete", statement: "Missing identity" })).rejects.toThrow("work_ref")
    const completed = (await f.invoke("record", { operation: "complete", work_ref: worked.work_ref, statement: "Original work finished" })).result
    expect(completed.node_id).toBe("worker")
    expect(completed.data.work_goal.goal).toBe("Original")
    expect((await f.invoke("context", {})).result.task.id).toBe("research")
    const progress = (await f.invoke("record", { operation: "query", view: "progress", action_id: action.id, node_id: "worker" })).result
    expect(progress.items[0].state).toBe("needs-reconfirmation")
  } finally { await f.close() }
})

test("search-visible documentation covers new operations, meaning, scope and retrieval without a sixth tool", async () => {
  const f = await registeredLoom()
  try {
    const record = f.tools.get("record")
    expect(record.description).toBe(TOOL_HELP.record)
    expect(record.input.properties.operation.enum).toEqual(["add", "query", "complete", "reopen", "ask", "answer"])
    for (const required of ["work_ref", "question_id", "respondent", "view"]) expect(record.input.properties[required]).toBeDefined()
    for (const phrase of ["BEFORE doing the work", "no parent/Action cascade", "NOT resolution/approval/permission", "does not require or change selection", "needs-reconfirmation", "validity-unknown"]) expect(record.description).toContain(phrase)
    expect(TOOL_HELP.context).toContain("this read does not dispatch or resume")
    expect(TOOL_HELP.context).toContain("separate best-effort exact-asker resume path")
    expect(f.tools.size).toBe(5)
  } finally { await f.close() }
})
