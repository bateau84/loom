import { test, expect } from "bun:test"
import { registeredLoom } from "./helpers/registered-loom.js"

const request = () => ({ operation: "ask", question: "Which local store?", blocking: true,
  recipient: { kind: "agent", id: "investigator" }, answer_type: "multi-choice",
  choices: [{ id: "A", answer: "JSON files" }, { id: "B", answer: "SQLite" }] })

test("registered structured ask/answer preserves native routing, identity and full readback", async () => {
  const f = await registeredLoom()
  try {
    const schema = f.tools.get("record").input
    expect(schema.properties.answer_type.enum).toEqual(["text", "multi-choice"])
    expect(schema.properties.choices.items.required).toEqual(["id", "answer"])
    const q = (await f.invoke("record", request(), "asker")).result
    expect(q.dispatch.status).toBe("admission-observed")
    expect(q.dispatch.native_status).toBe("completed")
    expect(f.sessionCreates).toHaveLength(1)
    const child = q.dispatch.target_session_id
    const inputs = f.nativeInputs.length
    await expect(f.invoke("record", { operation: "answer", question_id: q.id, choice_id: "B" }, "sibling", "investigator"))
      .rejects.toThrow("Session does not match")
    await expect(f.invoke("record", { operation: "answer", question_id: q.id, choice_id: "missing" }, child, "investigator"))
      .rejects.toThrow("Unknown choice_id")
    expect((await f.invoke("record", { operation: "query", view: "thread", question_id: q.id })).result.answers).toHaveLength(0)
    const a = (await f.invoke("record", { operation: "answer", question_id: q.id, choice_id: "B", reason: "Fits the agreed constraints." }, child, "investigator")).result
    expect(a.data.choice_id).toBe("B")
    expect(a.data.answer).toBe("SQLite")
    expect(a.data.reason).toBe("Fits the agreed constraints.")
    expect(a.continuation.owner).toBe("native-subagent-execution")
    expect(a.resume).toBeUndefined()
    expect(f.nativeInputs).toHaveLength(inputs)
    expect(f.sessionCreates).toHaveLength(1)
    const thread = (await f.invoke("record", { operation: "query", view: "thread", question_id: q.id })).result
    expect(thread.question.data.choices).toEqual(request().choices)
    expect(thread.answers[0].data).toEqual(a.data)
    const history = (await f.invoke("record", { operation: "query", view: "full_thread", session_id: "asker" })).result
    const data = [...history.markdown.matchAll(/^      "data": (.*),$/gm)].map((match: any) => JSON.parse(match[1]))
    expect(data.find(d => d.answer_type === "multi-choice").choices).toEqual(request().choices)
    expect(data.find(d => d.choice_id === "B")).toEqual(a.data)
  } finally { await f.close() }
})

test("forwarded structured question requires its bound sibling and preserves first abstention wake", async () => {
  const f = await registeredLoom()
  try {
    f.sessions.set("worker", { id: "worker", parentID: "parent", agent: "author", projectID: "tool-help", location: { directory: f.directory } })
    const q = (await f.invoke("record", request(), "worker")).result
    expect(q.dispatch.reason).toBe("native-parent-notice-admitted")
    expect(f.sessionCreates).toHaveLength(0)
    f.sessions.set("chosen", { id: "chosen", parentID: "parent", agent: "investigator", projectID: "tool-help", location: { directory: f.directory } })
    f.sessions.set("other", { id: "other", parentID: "parent", agent: "investigator", projectID: "tool-help", location: { directory: f.directory } })
    await f.invoke("record", { operation: "bind-respondent", question_id: q.id, respondent_session_id: "chosen" }, "parent")
    await expect(f.invoke("record", { operation: "answer", question_id: q.id, choice_id: "A" }, "other", "investigator")).rejects.toThrow("Session does not match")
    const before = f.nativeInputs.length
    const a = (await f.invoke("record", { operation: "answer", question_id: q.id, status: "cannot-select", reason: "Both options lack required evidence." }, "chosen", "investigator")).result
    expect(a.data.status).toBe("cannot-select")
    expect(a.resume.attempted).toBe(true)
    expect(f.nativeInputs).toHaveLength(before + 1)
    expect((f.nativeInputs.at(-1) as any).sessionID).toBe("worker")
    const later = (await f.invoke("record", { operation: "answer", question_id: q.id, choice_id: "A" }, "chosen", "investigator")).result
    expect(later.resume).toBeUndefined()
    expect(f.nativeInputs).toHaveLength(before + 1)
    const thread = (await f.invoke("record", { operation: "query", view: "thread", question_id: q.id })).result
    expect(thread.answers.map((answer: any) => answer.id)).toEqual([a.id, later.id])
  } finally { await f.close() }
})

test("invalid structured asks fail before ledger append or native contact", async () => {
  const f = await registeredLoom()
  try {
    await expect(f.invoke("record", { ...request(), choices: [{ id: "A", answer: "one" }, { id: "A", answer: "two" }] }, "asker")).rejects.toThrow("Duplicate choice ID")
    expect(f.sessionCreates).toHaveLength(0)
    expect(f.nativeInputs).toHaveLength(0)
    expect((await f.invoke("record", { operation: "query", session_only: true }, "asker")).result.items).toHaveLength(0)
  } finally { await f.close() }
})
