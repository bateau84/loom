import { test, expect } from "bun:test"
import { writeFile } from "node:fs/promises"
import { join } from "node:path"
import { TOOL_EXAMPLES } from "../src/tool-help.js"
import { registeredLoom } from "./helpers/registered-loom.js"

test("advertised question example contacts the configured specialist, without an Action", async () => {
  const f = await registeredLoom([], { beforeSetup: async directory => {
    await writeFile(join(directory, ".loom.yaml"), "agents:\n  investigator:\n    roles: [research]\ninstructions:\n  enabled: false\nledger:\n  capture: off\n")
  } })
  try {
    const example = TOOL_EXAMPLES.record.find(e => e.operation === "ask" && "reference" in e)!
    const { reference: _reference, ...input } = example
    const question = (await f.invoke("record", input, "asker")).result
    expect(question.dispatch.status).toBe("admission-observed")
    expect(question.dispatch.target_agent).toBe("investigator")
    expect(f.sessionCreates).toHaveLength(1)
    expect(question.action_id).toBeUndefined()
    expect(question.data.recipient).toEqual({ kind: "role", id: "research" })
    const answer = (await f.invoke("record", { operation: "answer", question_id: question.id,
      answer: "The exception does apply." }, question.dispatch.target_session_id, "investigator")).result
    expect(answer.data.answer).toBe("The exception does apply.")
    expect(answer.continuation).toBeUndefined() // this advertised example is nonblocking
  } finally { await f.close() }
})

test("configured context teaches routed questions without changing opt-outs or native tools", async () => {
  const f = await registeredLoom([], { beforeSetup: async directory => {
    await writeFile(join(directory, ".loom.yaml"), "agents:\n  author:\n    roles: [implementation]\ninstructions:\n  max_chars: 2000\nledger:\n  capture: off\n")
  } })
  try {
    const event = { sessionID: "s", agent: "author", system: [{ type: "text", text: "Native instructions" }], messages: [] }
    await f.hooks.get("context")(event)
    const guidance = event.system.find(part => part.text.startsWith("<!-- loom:runtime:v2 -->"))?.text
    expect(guidance).toBeDefined()
    expect(guidance).toContain("loom_record operation=ask")
    expect(guidance).toContain("explicit blocking")
    expect(guidance).toContain("do not manufacture OQs")
    expect(guidance!.length).toBeLessThanOrEqual(2000)
    expect(f.nativeInputs).toHaveLength(0)
    expect(f.sessionCreates).toHaveLength(0)
    expect(event.system[0].text).toBe("Native instructions")
    const absent = { sessionID: "unconfigured", agent: "unconfigured", system: [], messages: [] }
    await f.hooks.get("context")(absent)
    expect(absent.system.some((part: any) => part.text?.startsWith("<!-- loom:runtime:v2 -->"))).toBe(false)
  } finally { await f.close() }
})

test("every advertised ask executes in its labelled Session context and accepts the intended respondent", async () => {
  const f = await registeredLoom([], { beforeSetup: async directory => {
    await writeFile(join(directory, ".loom.yaml"), "agents: {investigator: {roles: [research]}}\ninstructions: {enabled: false}\nledger: {capture: off}\n")
  } })
  try {
    const action = (await f.invoke("action", { operation: "create", title: "Example inputs", goal: "Execute advertised questions" }, "setup")).result
    await f.invoke("plan", { operation: "save", action_id: action.id, expected_revision: 0,
      nodes: [{ id: "explain", kind: "task", title: "Explain" }] }, "setup")
    const lines = f.tools.get("record").description.split("\n") as string[]
    let count = 0, primaryChoices = 0, childDispatchers = 0
    for (const [index, line] of lines.entries()) {
      if (!line.startsWith("{")) continue
      const example = JSON.parse(line)
      if (example.operation !== "ask") continue
      const context = lines[index - 1]
      expect(["Ask example context: primary Session.",
        "Ask example context: child Session only."]).toContain(context)
      const child = context.includes("child Session only")
      const session = `example-${count++}`
      const parent = `${session}-parent`
      f.sessions.set(session, { id: session, agent: "author", ...(child ? { parentID: parent } : {}),
        projectID: "tool-help", location: { directory: f.directory } })
      const input = JSON.parse(line.replaceAll("ACTION_ID", action.id))
      const q = (await f.invoke("record", input, session)).result
      expect(q.dispatch.status).toBe("admission-observed")
      const respondent = child ? parent : q.dispatch.target_session_id
      const agent = child ? "author" : "investigator"
      const response = q.data.answer_type === "multi-choice"
        ? { choice_id: q.data.choices[0].id, reason: "Fixture evidence, not real evaluation." }
        : { answer: "Fixture answer with its limitations." }
      const answer = (await f.invoke("record", { operation: "answer", question_id: q.id, ...response }, respondent, agent)).result
      const thread = (await f.invoke("record", { operation: "query", view: "thread", question_id: q.id }, session)).result
      expect(thread.answers.map((a: any) => a.id)).toEqual([answer.id])
      expect(answer.session_id).toBe(respondent)
      expect(answer.agent).toBe(agent)
      if (!child && q.data.answer_type === "multi-choice") primaryChoices++
      if (child && q.data.recipient.kind === "dispatcher") childDispatchers++
    }
    expect(count).toBe(TOOL_EXAMPLES.record.filter(e => e.operation === "ask").length)
    expect(primaryChoices).toBeGreaterThan(0)
    expect(childDispatchers).toBeGreaterThan(0)
  } finally { await f.close() }
})
