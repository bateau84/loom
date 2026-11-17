import { test, expect, spyOn } from "bun:test"
import { Store } from "../src/store.js"
import { writeFile } from "node:fs/promises"
import { join } from "node:path"
import { registeredLoom } from "./helpers/registered-loom.js"

test("explicit cross-Session OQ keeps the real author, associates the destination Action and wakes the original asker", async () => {
  const f = await registeredLoom()
  try {
    f.sessions.set("general-b", { id: "general-b", agent: "general",
      projectID: "tool-help", location: { directory: f.directory } })
    const target = (await f.invoke("action", { operation: "create", title: "Other Action",
      goal: "Recipient's work" }, "general-b", "general")).result
    const own = (await f.invoke("action", { operation: "create", title: "Origin Action",
      goal: "Asker's work" }, "general-a", "general")).result
    const q = (await f.invoke("record", { operation: "ask", question: "Which boundary belongs in Action B?",
      session_id: "general-b", action_id: target.id, blocking: true }, "general-a", "general")).result

    expect(q).toMatchObject({ kind: "question", session_id: "general-a", agent: "general",
      action_id: target.id, data: { format: "loom-question/v2", expected_session: "general-b" },
      dispatch: { status: "admission-observed", target_session_id: "general-b" } })
    expect(q.action_id).not.toBe(own.id)
    expect((await f.invoke("context", {}, "general-a", "general")).result.action.id).toBe(own.id)
    expect(f.nativeInputs.some((n: any) => n.sessionID === "general-b" &&
      n.metadata?.question_id === q.id)).toBe(true)
    await expect(f.invoke("record", { operation: "answer", question_id: q.id, answer: "Impersonation" },
      "general-c", "general")).rejects.toThrow("Answering Session")

    const a = (await f.invoke("record", { operation: "answer", question_id: q.id,
      answer: "The boundary belongs in B" }, "general-b", "general")).result
    expect(a).toMatchObject({ session_id: "general-b", agent: "general", action_id: target.id,
      data: { question_id: q.id, answer: "The boundary belongs in B" },
      resume: { asking_session_id: "general-a", attempted: true } })
    expect(f.nativeInputs.some((n: any) => n.metadata?.format === "loom-answer-notice/v1" &&
      n.sessionID === "general-a")).toBe(true)
    const thread = (await f.invoke("record", { operation: "query", view: "thread", question_id: q.id },
      "general-b", "general")).result
    expect(thread.answers.map((r: any) => r.id)).toEqual([a.id])
  } finally { await f.close() }
})

test("cross-Session inbox spans Action and Session-only questions without selecting the sender's work", async () => {
  const f = await registeredLoom()
  try {
    const target = (await f.invoke("action", { operation: "create", title: "Target",
      goal: "Cross-session review" }, "author", "author")).result
    const actionQ = (await f.invoke("record", { operation: "ask", session_id: "recipient",
      action_id: target.id, question: "Action-linked?", blocking: false }, "author", "author")).result
    const sessionQ = (await f.invoke("record", { operation: "ask", session_id: "recipient",
      question: "Session-only?", blocking: false }, "unselected", "author")).result
    const mine = (await f.invoke("record", { operation: "ask", session_id: "other",
      question: "Not yours?", blocking: false }, "unselected", "author")).result
    const first = (await f.invoke("record", { operation: "query", view: "inbox", limit: 1 },
      "recipient", "general")).result
    expect(first.items.map((q: any) => q.question_id)).toEqual([actionQ.id])
    expect(first.next_after).not.toBeNull()
    const next = (await f.invoke("record", { operation: "query", view: "inbox",
      after: first.next_after, limit: 10 }, "recipient", "general")).result
    expect(next.items.map((q: any) => q.question_id)).toEqual([sessionQ.id])
    expect([...first.items, ...next.items].some((q: any) => q.question_id === mine.id)).toBe(false)
    expect((await f.invoke("context", {}, "recipient", "general")).result.selected).toBeNull()
    await f.invoke("record", { operation: "answer", question_id: actionQ.id, answer: "Done" },
      "recipient", "general")
    const open = (await f.invoke("record", { operation: "query", view: "inbox" },
      "recipient", "general")).result
    expect(open.items.map((q: any) => q.question_id)).toEqual([sessionQ.id])
    const all = (await f.invoke("record", { operation: "query", view: "inbox", question_state: "all" },
      "recipient", "general")).result
    expect(all.items.map((q: any) => q.question_id)).toEqual([actionQ.id, sessionQ.id])
  } finally { await f.close() }
})

test("explicit Session addressing rejects nonexistent, foreign and conflicting destinations without writing", async () => {
  const f = await registeredLoom()
  try {
    f.sessions.set("foreign", { id: "foreign", agent: "general", projectID: "another-project",
      location: { directory: f.directory } })
    f.sessions.set("missing", new Error("Session does not exist"))
    f.sessions.set("wrong-directory", { id: "wrong-directory", agent: "general",
      projectID: "tool-help", location: { directory: "/tmp/foreign-project" } })
    const action = (await f.invoke("action", { operation: "create", title: "Valid",
      goal: "Allow explicit action association" }, "asker", "general")).result
    const base = { operation: "ask", question: "Can we proceed?", blocking: true }
    const forbidden = [
      { ...base, session_id: "foreign" },
      { ...base, session_id: "missing" },
      { ...base, session_id: "asker" },
      { ...base, session_id: "wrong-directory" },
      { ...base, session_id: "peer", recipient: { kind: "user" } },
      { ...base, session_id: "peer", to_agent: "general" },
      { ...base, session_id: "peer", action_id: "nonexistent" },
      { ...base, session_id: "peer", action_id: action.id,
        reference: { action_id: action.id, kind: "action", id: action.id } },
    ]
    for (const request of forbidden)
      await expect(f.invoke("record", request, "asker", "general")).rejects.toThrow()
    const ledger = (await f.invoke("record", { operation: "query", session_only: true },
      "asker", "general")).result.items
    expect(ledger.filter((r: any) => r.kind === "question")).toHaveLength(0)
  } finally { await f.close() }
})

test("multi-choice cross-Session answers select an original label without spawning a child", async () => {
  const f = await registeredLoom()
  try {
    const q = (await f.invoke("record", {
      operation: "ask", question: "A or B?", session_id: "peer", blocking: false,
      answer_type: "multi-choice",
      choices: [{ id: "A", answer: "Keep stable" }, { id: "B", answer: "Change deliberately" }],
    }, "asker", "general")).result
    expect(q.data).toMatchObject({ format: "loom-question/v2", expected_session: "peer",
      answer_type: "multi-choice" })
    expect(f.sessionCreates).toHaveLength(0)
    await expect(f.invoke("record", { operation: "answer", question_id: q.id, choice_id: "B" },
      "other", "general")).rejects.toThrow("Session")
    await expect(f.invoke("record", { operation: "answer", question_id: q.id, choice_id: "C" },
      "peer", "general")).rejects.toThrow("Unknown choice_id")
    const answer = (await f.invoke("record", { operation: "answer", question_id: q.id, choice_id: "B" },
      "peer", "general")).result
    expect(answer.data).toMatchObject({ choice_id: "B", answer: "Change deliberately" })
    expect(answer.resume).toBeUndefined()
  } finally { await f.close() }
})

test("failed native peer delivery preserves the authorized question for inbox recovery, with no retry", async () => {
  const f = await registeredLoom()
  try {
    f.nativeSynthetic.error = new Error("native notice unavailable after initiation")
    const q = (await f.invoke("record", {
      operation: "ask", question: "Can peer recover this?", session_id: "peer", blocking: true,
    }, "asker", "general")).result
    expect(q.dispatch).toMatchObject({ status: "outcome-unknown",
      reason: "native-operation-failed-or-unconfirmed", attempted: true })
    expect(f.nativeInputs).toHaveLength(1)
    const inbox = (await f.invoke("record", { operation: "query", view: "inbox" },
      "peer", "general")).result
    expect(inbox.items.map((item: any) => item.question_id)).toEqual([q.id])
    f.nativeSynthetic.error = undefined
    const answer = (await f.invoke("record", { operation: "answer", question_id: q.id,
      answer: "Recovered through inbox" }, "peer", "general")).result
    expect(answer.resume).toMatchObject({ asking_session_id: "asker", attempted: true })
    expect(f.nativeInputs).toHaveLength(2)
    const all = (await f.invoke("record", { operation: "query", view: "inbox",
      question_state: "all" }, "peer", "general")).result
    expect(all.items[0].state).toBe("answered")
  } finally { await f.close() }
})

test("explicit Action association works without another Session and does not change selection", async () => {
  const f = await registeredLoom()
  try {
    const first = (await f.invoke("action", { operation: "create", title: "Origin",
      goal: "Origin scope" }, "asker", "general")).result
    const second = (await f.invoke("action", { operation: "create", title: "Destination",
      goal: "Destination scope" }, "peer", "general")).result
    const q = (await f.invoke("record", { operation: "ask", question: "Is the other Action relevant?",
      recipient: { kind: "user" }, action_id: second.id, blocking: false },
      "asker", "general")).result
    expect(q).toMatchObject({ session_id: "asker", action_id: second.id,
      data: { format: "loom-question/v2", expected_session: "asker" } })
    expect((await f.invoke("context", {}, "asker", "general")).result.action.id).toBe(first.id)
  } finally { await f.close() }
})

test("guarded model routing withholds peer native notice without losing exact answer ownership", async () => {
  const f = await registeredLoom()
  try {
    await writeFile(join(f.directory, ".loom.yaml"), [
      "model-routing:",
      "  enabled: true",
      "  default-class: verified",
      "model-classes:",
      "  verified:",
      "    models: [sample-model]",
      "instructions: {enabled: false}",
      "ledger: {capture: off}",
      "",
    ].join("\n"))
    const q = (await f.invoke("record", {
      operation: "ask", question: "Does managed routing allow a peer notice?",
      session_id: "peer", blocking: true,
    }, "asker", "general")).result
    expect(q.dispatch).toMatchObject({ status: "not-attempted", attempted: false,
      reason: "model-routing-host-unqualified" })
    expect(q.data.expected_session).toBe("peer")
    expect(f.nativeInputs).toHaveLength(0)
    await expect(f.invoke("record", { operation: "answer", question_id: q.id,
      answer: "Wrong Session" }, "other", "general")).rejects.toThrow("Session")
  } finally { await f.close() }
})

test("inbox never reads or changes a broken saved Action selection", async () => {
  const f = await registeredLoom()
  try {
    const q = (await f.invoke("record", { operation: "ask", question: "Recover from selection trouble?",
      session_id: "peer", blocking: false }, "asker", "general")).result
    const selected = spyOn(Store.prototype, "selected").mockImplementation(() => {
      throw new Error("Saved selection is unavailable")
    })
    try {
      const inbox = (await f.invoke("record", { operation: "query", view: "inbox" },
        "peer", "general")).result
      expect(inbox.items.map((item: any) => item.question_id)).toEqual([q.id])
    } finally { selected.mockRestore() }
  } finally { await f.close() }
})
