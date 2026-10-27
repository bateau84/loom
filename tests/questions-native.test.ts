import { test, expect, spyOn } from "bun:test"
import { Database } from "bun:sqlite"
import { mkdtemp, mkdir, readdir, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { registeredLoom } from "./helpers/registered-loom.js"
import { Store } from "../src/store.js"
import plugin from "../server.js"
import { digest } from "../src/model.js"
import { Collaboration } from "../src/collaboration.js"

test("registered unscoped questions persist actual attribution, absent association and fail-closed dispatch", async () => {
  const f = await registeredLoom()
  const answerSpy = spyOn(Collaboration.prototype, "answer") // Observe the real synchronous commit result, without replacing it.
  let db: Database | undefined
  try {
    const q = (await f.invoke("record", { operation: "ask", question: "Which boundary?", to_agent: "investigator", blocking: true,
      context: "No selected work", context_attachments: ["fixture://context"] }, "asker", "author")).result
    expect(q).toMatchObject({ session_id: "asker", agent: "author", data: { format: "loom-question/v1", question: "Which boundary?", blocking: true,
      context_attachments: ["fixture://context"] }, dispatch: { status: "not-attempted", reason: "policy-capability-unavailable" } })
    expect(q.action_id).toBeUndefined(); expect(q.node_id).toBeUndefined()
    expect(q.guidance).toContain("not contacted")
    expect((await f.invoke("context", {}, "asker")).result.selected).toBeNull()
    const action = (await f.invoke("action", { operation: "create", title: "Unrelated", goal: "Remain unrelated" }, "respondent")).result
    const before = (await f.invoke("context", {}, "respondent")).result
    const a = (await f.invoke("record", { operation: "answer", question_id: q.id, answer: "The commit boundary.",
      context_attachments: ["fixture://answer"] }, "respondent", "investigator")).result
    expect(a).toMatchObject({ agent: "investigator", session_id: "respondent", data: { format: "loom-answer/v1", answer: "The commit boundary.", context_attachments: ["fixture://answer"] } })
    const committed = answerSpy.mock.results[0].value
    if (!committed || typeof committed !== "object" || !("resume" in committed)) throw new Error("Registered first answer did not return eligibility")
    expect(committed.resume).toEqual({ question_id: q.id, answer_id: a.id, asking_session_id: "asker" })
    expect(a.action_id).toBeUndefined(); expect(a.node_id).toBeUndefined()
    expect(a.resume).toMatchObject({ status: "outcome-unknown", attempted: true, reason: "unsupported-native-ack" })
    expect((await f.invoke("context", {}, "respondent")).result).toEqual(before)
    expect((await f.invoke("record", { operation: "query", action_id: action.id }, "respondent")).result.items).toEqual([])
    const root = join(f.directory, "state", "loom", "actions-v1")
    db = new Database(join(root, (await readdir(root))[0], "ledger.sqlite"))
    const reopened = new Store(db)
    expect(reopened.selected("asker")).toBeUndefined()
    expect(reopened.records({ session_id: "asker" }).items[0].id).toBe(q.id)
    const thread = reopened.collaboration.thread(q.id)
    expect(thread.answers.map(r => r.id)).toEqual([a.id])
    expect(thread.question.data).toEqual(q.data)
    const second = reopened.collaboration.answer({ session_id: "fresh", agent: "other" }, { question_id: q.id, answer: "Later response" })
    expect(second.resume).toBeUndefined()
    expect(reopened.collaboration.thread(q.id).answers.length).toBe(2)
  } finally { answerSpy.mockRestore(); db?.close(); await f.close() }
})

test("registered schema and callbacks require canonical fields and reject aliases, forged identity and malformed input", async () => {
  const f = await registeredLoom()
  try {
    const schema = f.tools.get("record").input
    expect(schema.additionalProperties).toBe(false)
    const ask = schema.allOf.find((s: any) => s.if.properties.operation.const === "ask").then
    const answer = schema.allOf.find((s: any) => s.if.properties.operation.const === "answer").then
    expect(ask.required).toEqual(["operation", "question", "blocking"])
    expect(ask.oneOf).toEqual([{ required: ["to_agent"], not: { required: ["recipient"] } },
      { required: ["recipient"], not: { required: ["to_agent"] } }])
    expect(answer.required).toEqual(["operation", "question_id", "answer"])
    expect(ask.properties.blocking).toEqual({ type: "boolean" })
    for (const operation of [ask, answer]) {
      expect(operation.additionalProperties).toBe(false)
      expect(operation.properties.context_attachments.type).toBe("array")
      for (const alias of ["attachments", "statement", "artifact_refs", "background", "agent", "session_id", "action_id", "node_id"])
        expect(operation.properties[alias]).toBeUndefined()
    }
    const valid = { operation: "ask", question: "Question?", to_agent: "investigator", blocking: false }
    for (const required of ["question", "blocking"]) {
      const input: any = { ...valid }; delete input[required]
      await expect(f.invoke("record", input)).rejects.toThrow()
    }
    for (const invalid of [{ question: "" }, { question: 42 }, { to_agent: [] }, { blocking: "false" }, { blocking: null },
      { context: false }, { context_attachments: "ref" }, { context_attachments: [42] }, { context_attachments: Array(51).fill("x") }])
      await expect(f.invoke("record", { ...valid, ...invalid })).rejects.toThrow()
    for (const field of ["attachments", "statement", "background", "artifact_refs", "agent", "session_id", "asking_session_id", "author", "action_id", "node_id", "work_ref"]) {
      await expect(f.invoke("record", { ...valid, [field]: "forged" })).rejects.toThrow()
      if (field === "attachments") await expect(f.invoke("record", { ...valid, context_attachments: ["canonical"], attachments: ["alias"] })).rejects.toThrow()
    }
    const q = (await f.invoke("record", { ...valid, context_attachments: ["fixture://question"] })).result
    for (const input of [{}, { answer: 42 }, { answer: "" }, { answer: "Valid", attachments: [] },
      { answer: "Valid", attachments: [], context_attachments: [] }, { statement: "old" }, { answer: "Valid", artifact_refs: [] },
      { answer: "Valid", context_attachments: [42] }, { answer: "Valid", session_id: "forged" }])
      await expect(f.invoke("record", { operation: "answer", question_id: q.id, ...input })).rejects.toThrow()
    await expect(f.invoke("record", { operation: "answer", answer: "Missing ID" })).rejects.toThrow()
    await expect(f.invoke("record", { operation: "answer", question_id: "orphan", answer: "Unknown ID" })).rejects.toThrow("Unknown question")
    const a = (await f.invoke("record", { operation: "answer", question_id: q.id, answer: "Valid", context_attachments: ["fixture://answer"] })).result
    expect(a.data.context_attachments).toEqual(["fixture://answer"])
    expect((await f.invoke("record", { operation: "query", view: "thread", question_id: q.id })).result.answers).toHaveLength(1)
  } finally { await f.close() }
})

test("registered explicit references override only omitted association, validate kinds, and survive removed nodes", async () => {
  const f = await registeredLoom()
  try {
    const action = (await f.invoke("action", { operation: "create", title: "A", goal: "Goal" })).result
    const nodes = ["phase", "wave", "task", "subtask"].map(kind => ({ id: kind, kind, title: kind }))
    await f.invoke("plan", { operation: "save", action_id: action.id, expected_revision: 0, nodes })
    await f.invoke("context", { action_id: action.id, node_id: "task" })
    const valid = { operation: "ask", question: "Question?", to_agent: "investigator", blocking: false }
    const q = (await f.invoke("record", valid)).result
    expect(q.data.reference).toEqual({ action_id: action.id, kind: "task", id: "task" })
    for (const n of [{ kind: "action", id: action.id }, ...nodes]) {
      const explicit = (await f.invoke("record", { ...valid, reference: { action_id: action.id, kind: n.kind, id: n.id } })).result
      expect(explicit.node_id).toBe(n.kind === "action" ? undefined : n.id)
      expect(explicit.data.work_ref).toBeUndefined()
    }
    const before = (await f.invoke("record", { operation: "query", action_id: action.id })).result
    for (const reference of [null, [], "bad", {}, { action_id: action.id, kind: "action", id: "wrong" },
      { action_id: "absent", kind: "action", id: "absent" }, { action_id: action.id, kind: "task", id: "phase" },
      { action_id: action.id, kind: "task", id: "missing" }, { action_id: action.id, kind: "other", id: "task" },
      { action_id: action.id, kind: "task", id: "task", extra: true }])
      await expect(f.invoke("record", { ...valid, reference })).rejects.toThrow()
    expect((await f.invoke("record", { operation: "query", action_id: action.id })).result).toEqual(before)
    await f.invoke("plan", { operation: "save", action_id: action.id, expected_revision: 1, nodes: [] })
    await f.invoke("context", { clear: true })
    const answer = (await f.invoke("record", { operation: "answer", question_id: q.id, answer: "After removal" }, "unselected", "investigator")).result
    expect(answer).toMatchObject({ action_id: action.id, node_id: "task", session_id: "unselected", agent: "investigator" })
    expect((await f.invoke("context", {}, "unselected")).result.selected).toBeNull()
  } finally { await f.close() }
})

test("registered asks and failed commits never contact native APIs; only first blocking answer attempts resume, never restart", async () => {
  const root = await mkdtemp(join(tmpdir(), "loom-question-noio-"))
  const previous = { state: process.env.XDG_STATE_HOME, config: process.env.OPENCODE_CONFIG_DIR }
  const project = { id: "questions", canonical: root, directory: root }
  const state = join(root, "state", "loom", "actions-v1", digest({ project: project.id, canonical: project.canonical }))
  const calls: string[] = [], lookups: string[] = [], tools = new Map<string, any>()
  const forbidden = (name: string) => async () => { calls.push(name); throw new Error(`Unexpected native ${name}`) }
  const ctx = {
    location: { directory: root, project },
    skill: { transform: async (fn: any) => { fn({ get: () => undefined, add() {} }); return { dispose: async () => {} } } },
    tool: { transform: async (fn: any) => { fn({ namespace() {}, add: (tool: any) => tools.set(tool.name, tool) }); return { dispose: async () => {} } }, hook: async () => ({ dispose: async () => {} }) },
    session: { get: async ({ sessionID }: { sessionID: string }) => { lookups.push(sessionID); return { id: sessionID, projectID: project.id, location: { directory: root } } },
      hook: async () => ({ dispose: async () => {} }), synthetic: forbidden("synthetic"), context: forbidden("context"), create: forbidden("create"), prompt: forbidden("prompt") },
    permission: { ask: forbidden("permission") },
    agent: { list: forbidden("agent-list"), execute: forbidden("executor") },
    event: { subscribe: async function* () { calls.push("subscribe"); throw new Error("Unexpected native subscription") } },
  }
  let db: Database | undefined, dispose: (() => Promise<void>) | undefined
  const invoke = async (input: unknown, sessionID = "asker", agent = "author") => JSON.parse((await tools.get("record").execute(input, {
    sessionID, agent, signal: new AbortController().signal,
  })).content).result
  try {
    process.env.XDG_STATE_HOME = join(root, "state"); process.env.OPENCODE_CONFIG_DIR = join(root, "config")
    await writeFile(join(root, ".loom.yaml"), "agents: {}\ninstructions: {enabled: false}\nledger: {capture: off}\n")
    await mkdir(state, { recursive: true })
    dispose = await (plugin as any).setup(ctx)
    db = new Database(join(state, "ledger.sqlite"))
    for (const blocking of [true, false]) {
      const before = calls.length
      const q = await invoke({ operation: "ask", question: "No contact?", to_agent: "recipient", blocking })
      expect(calls).toHaveLength(before)
      expect(q.dispatch).toEqual({ status: "not-attempted", reason: "policy-capability-unavailable" })
      expect(q.guidance).toContain("not contacted")
      if (blocking) expect(q.guidance).toContain("If manual handling has been arranged")
      db.exec("CREATE TABLE IF NOT EXISTS p(id INTEGER PRIMARY KEY); CREATE TABLE IF NOT EXISTS c(id INTEGER REFERENCES p(id) DEFERRABLE INITIALLY DEFERRED)")
      db.exec("CREATE TRIGGER refuse_commit AFTER INSERT ON ledger WHEN NEW.kind='answer' BEGIN INSERT INTO c VALUES(999); END")
      await expect(invoke({ operation: "answer", question_id: q.id, answer: "Fails commit" }, "respondent", "investigator")).rejects.toThrow("FOREIGN KEY")
      expect(calls).toHaveLength(before)
      expect((await invoke({ operation: "query", view: "thread", question_id: q.id })).answers).toHaveLength(0)
      db.exec("DROP TRIGGER refuse_commit")
      await invoke({ operation: "answer", question_id: q.id, answer: "First" }, "respondent", "investigator")
      await invoke({ operation: "answer", question_id: q.id, answer: "Later" }, "respondent", "investigator")
      await dispose?.(); dispose = await (plugin as any).setup(ctx)
      expect((await invoke({ operation: "query", view: "thread", question_id: q.id })).answers).toHaveLength(2)
      expect(calls).toEqual(["synthetic"])
    }
    db.exec("CREATE TRIGGER refuse_ask BEFORE INSERT ON ledger WHEN NEW.kind='question' BEGIN SELECT RAISE(ABORT,'ask refused'); END")
    await expect(invoke({ operation: "ask", question: "Not saved", to_agent: "recipient", blocking: true })).rejects.toThrow("ask refused")
    expect(calls).toEqual(["synthetic"])
    expect(lookups.every(id => ["asker", "respondent"].includes(id))).toBe(true)
  } finally {
    await dispose?.(); db?.close()
    if (previous.state === undefined) delete process.env.XDG_STATE_HOME; else process.env.XDG_STATE_HOME = previous.state
    if (previous.config === undefined) delete process.env.OPENCODE_CONFIG_DIR; else process.env.OPENCODE_CONFIG_DIR = previous.config
    await rm(root, { recursive: true, force: true })
  }
})

test("typed OQ delegates to one eligible agent and only that native agent can answer", async () => {
  const f = await registeredLoom()
  try {
    const q = (await f.invoke("record", { operation: "ask", question: "Which API boundary?", recipient: { kind: "agent", id: "investigator" }, blocking: true }, "asker", "author")).result
    expect(q.data).toMatchObject({ format: "loom-question/v2", recipient: { kind: "agent", id: "investigator" }, expected_agent: "investigator" })
    expect(q.dispatch).toMatchObject({ status: "admission-observed", reason: "native-prompt-admitted", target_agent: "investigator", attempted: true })
    expect(f.permissionRequests[0]).toMatchObject({ action: "subagent", resources: ["investigator"], sessionID: "asker", agent: "author" })
    expect(f.sessionCreates).toHaveLength(1)
    expect(f.sessionCreates[0]).toMatchObject({ agent: "investigator", parentID: "asker" })
    expect(f.sessionPrompts[0]).toMatchObject({ sessionID: "ses_questionchild_1", resume: true, delivery: "steer" })
    expect(f.sessionPrompts[0].text).toContain(q.id)
    await expect(f.invoke("record", { operation: "answer", question_id: q.id, answer: "Unqualified guess" }, "someone-else", "author")).rejects.toThrow("intended respondent")
    const threadBefore = (await f.invoke("record", { operation: "query", view: "thread", question_id: q.id })).result
    expect(threadBefore.answers).toHaveLength(0)
    const a = (await f.invoke("record", { operation: "answer", question_id: q.id, answer: "Verified via code" }, "ses_questionchild_1", "investigator")).result
    expect(a.data.format).toBe("loom-answer/v2")
    expect(a.resume).toMatchObject({ attempted: true, asking_session_id: "asker" })
    const threadAfter = (await f.invoke("record", { operation: "query", view: "thread", question_id: q.id })).result
    expect(threadAfter.answers).toHaveLength(1)
  } finally { await f.close() }
})

test("role OQs fail closed for ambiguous candidates and never bypass explicit subagent permission denial", async () => {
  const f = await registeredLoom()
  try {
    await writeFile(join(f.directory, ".loom.yaml"), "agents:\n  investigator: {roles: [research]}\ninstructions: {enabled: false}\nledger: {capture: off}\n")
    const q = (await f.invoke("record", { operation: "ask", question: "Who knows?", recipient: { kind: "role", id: "research" }, blocking: false }, "asker", "author")).result
    expect(q.data.expected_agent).toBe("investigator")
    expect(q.dispatch.status).toBe("admission-observed")
    f.nativeAgents.push({ id: "second-researcher", mode: "subagent" })
    await writeFile(join(f.directory, ".loom.yaml"), "agents:\n  investigator: {roles: [research]}\n  second-researcher: {roles: [research]}\ninstructions: {enabled: false}\nledger: {capture: off}\n")
    const ambiguous = (await f.invoke("record", { operation: "ask", question: "Another?", recipient: { kind: "role", id: "research" }, blocking: true }, "asker", "author")).result
    expect(ambiguous.dispatch).toMatchObject({ status: "not-attempted", reason: "ambiguous-role", attempted: false })
    expect(f.sessionCreates).toHaveLength(1)
    await expect(f.invoke("record", { operation: "answer", question_id: ambiguous.id, answer: "Guessed", }, "ses_questionchild_1", "investigator")).rejects.toThrow("no authorized respondent")
    f.permission.error = new Error("denied by native policy")
    await expect(f.invoke("record", { operation: "ask", question: "Denied?", recipient: { kind: "agent", id: "investigator" }, blocking: true }, "asker", "author")).rejects.toThrow("denied by native policy")
    expect(f.sessionCreates).toHaveLength(1)
    expect(f.sessionPrompts).toHaveLength(1)
  } finally { await f.close() }
})

test("child questions notify the exact dispatching Session; top-level user question needs native interaction", async () => {
  const f = await registeredLoom()
  try {
    f.sessions.set("child", { id: "child", parentID: "primary", agent: "author", projectID: "tool-help", location: { directory: f.directory } })
    f.sessions.set("primary", { id: "primary", agent: "author", projectID: "tool-help", location: { directory: f.directory } })
    const q = (await f.invoke("record", { operation: "ask", question: "Choose interface?", recipient: { kind: "dispatcher" }, blocking: true }, "child", "author")).result
    expect(q.dispatch).toMatchObject({ status: "admission-observed", reason: "native-parent-notice-admitted", target_session_id: "primary" })
    expect(f.nativeInputs).toHaveLength(1)
    expect((f.nativeInputs[0] as any).sessionID).toBe("primary")
    await expect(f.invoke("record", { operation: "answer", question_id: q.id, answer: "wrong Session" }, "child", "author")).rejects.toThrow("Answering Session")
    const answer = (await f.invoke("record", { operation: "answer", question_id: q.id, answer: "Explicit decision" }, "primary", "author")).result
    expect(answer.data.format).toBe("loom-answer/v2")
    const user = (await f.invoke("record", { operation: "ask", question: "What does the user prefer?", recipient: { kind: "user" }, blocking: true }, "primary", "author")).result
    expect(user.dispatch).toMatchObject({ status: "not-attempted", reason: "ask-user-in-primary-session" })
    expect(user.guidance).toContain("Ask the user")
    expect(f.sessionCreates).toHaveLength(0)
  } finally { await f.close() }
})

test("typed OQ recipient contract rejects malformed or competing destinations", async () => {
  const f = await registeredLoom()
  try {
    const base = { operation: "ask", question: "Boundary?", blocking: true }
    for (const input of [
      { ...base }, { ...base, recipient: { kind: "role" } },
      { ...base, recipient: { kind: "user", id: "someone" } },
      { ...base, recipient: { kind: "agent", id: "" } },
      { ...base, recipient: { kind: "role", id: "research", extra: true } },
      { ...base, recipient: { kind: "agent", id: "investigator" }, to_agent: "investigator" },
    ]) await expect(f.invoke("record", input)).rejects.toThrow()
    const q = (await f.invoke("record", { ...base, recipient: { kind: "agent", id: "investigator" } })).result
    expect(q.data.format).toBe("loom-question/v2")
  } finally { await f.close() }
})
