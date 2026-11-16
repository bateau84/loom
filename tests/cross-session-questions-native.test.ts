import { test, expect } from "bun:test"
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
    f.sessions.set("wrong-directory", { id: "wrong-directory", agent: "general",
      projectID: "tool-help", location: { directory: "/tmp/foreign-project" } })
    const action = (await f.invoke("action", { operation: "create", title: "Valid",
      goal: "Allow explicit action association" }, "asker", "general")).result
    const base = { operation: "ask", question: "Can we proceed?", blocking: true }
    const forbidden = [
      { ...base, session_id: "foreign" },
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
