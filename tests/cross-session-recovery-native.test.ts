import { expect, test } from "bun:test"
import { Database } from "bun:sqlite"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import plugin from "../server.js"
import { digest } from "../src/model.js"

// Component evidence: real public registration, producer, SQLite and readers;
// only native Session lookup, permission and input admission are simulated.
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "loom-peer-recovery-"))
  const previous = { state: process.env.XDG_STATE_HOME, config: process.env.OPENCODE_CONFIG_DIR }
  process.env.XDG_STATE_HOME = join(root, "state")
  process.env.OPENCODE_CONFIG_DIR = join(root, "config")
  const project = { id: "peer-recovery", canonical: root, directory: root }
  const filename = join(root, "state", "loom", "actions-v1", digest({ project: project.id, canonical: root }), "ledger.sqlite")
  const tools = new Map<string, any>(), inputs: any[] = [], permissions: unknown[] = []
  let beforeLookup: ((id: string) => Promise<void>) | undefined
  let admissionError: Error | undefined, dispose: (() => Promise<void>) | undefined
  let verifier: Database | undefined, starts = 0
  const registration = async () => ({ dispose: async () => {} })
  const ctx = {
    location: { directory: root, project },
    skill: { transform: async (fn: any) => { fn({ get: () => undefined, add() {} }); return registration() } },
    tool: { transform: async (fn: any) => { fn({ namespace() {}, add: (tool: any) => tools.set(tool.name, tool) }); return registration() }, hook: registration },
    permission: { assert: async (request: unknown) => { permissions.push(request) } },
    session: {
      hook: registration,
      get: async ({ sessionID }: { sessionID: string }) => {
        await beforeLookup?.(sessionID)
        return { id: sessionID, agent: "general", projectID: project.id, location: { directory: root } }
      },
      synthetic: async (input: any) => {
        inputs.push(input)
        if (admissionError) throw admissionError
        return { id: "native-admission-" + inputs.length, sessionID: input.sessionID, type: "synthetic", delivery: input.delivery }
      },
    },
  }
  const stop = async () => {
    const cleanup = dispose
    dispose = undefined
    try { await cleanup?.() }
    finally { verifier?.close(); verifier = undefined }
  }
  const start = async () => {
    tools.clear()
    dispose = await (plugin as any).setup(ctx)
    verifier = new Database(filename, { readonly: true })
    starts++
  }
  const close = async () => {
    try { await stop() }
    finally {
      if (previous.state === undefined) delete process.env.XDG_STATE_HOME; else process.env.XDG_STATE_HOME = previous.state
      if (previous.config === undefined) delete process.env.OPENCODE_CONFIG_DIR; else process.env.OPENCODE_CONFIG_DIR = previous.config
      await rm(root, { recursive: true, force: true })
    }
  }
  try {
    await writeFile(join(root, ".loom.yaml"), "agents: {}\ninstructions: {enabled: false}\nledger: {capture: off}\n")
    await start()
    const invoke = async (name: string, input: unknown, sessionID: string, signal = new AbortController().signal) =>
      JSON.parse((await tools.get(name).execute(input, {
        sessionID, agent: "general", messageID: "message", id: "tool-call", signal,
      })).content).result
    return {
      inputs, permissions, invoke, close,
      restart: async () => { await stop(); await start() },
      get starts() { return starts },
      get db() { if (!verifier) throw new Error("Verifier closed"); return verifier },
      onLookup: (fn: typeof beforeLookup) => { beforeLookup = fn },
      failAdmission: (error?: Error) => { admissionError = error },
      ask: (extra: Record<string, unknown> = {}) => invoke("record", {
        operation: "ask", question: "Cross-Session recovery question", session_id: "peer", blocking: true, ...extra,
      }, "asker"),
      inbox: (state = "open", session = "peer") => invoke("record", { operation: "query", view: "inbox", question_state: state }, session),
      thread: (id: string) => invoke("record", { operation: "query", view: "thread", question_id: id }, "peer"),
      answer: (id: string, signal?: AbortSignal, session = "peer") => invoke("record", {
        operation: "answer", question_id: id, answer: "Persisted exact-Session answer",
      }, session, signal),
    }
  } catch (error) { await close(); throw error }
}

test("persisted cross-Session questions survive a complete plugin/database reopen and retain exact inbox and answer ownership", async () => {
  const f = await fixture()
  try {
    const action = await f.invoke("action", { operation: "create", title: "Recipient work", goal: "Recover the existing question" }, "peer")
    f.failAdmission(new Error("Transport lost after possible native admission"))
    const linked = await f.ask({ action_id: action.id })
    const unlinked = await f.ask({ blocking: false })
    expect(linked.dispatch).toMatchObject({ status: "outcome-unknown", attempted: true })
    expect(unlinked.action_id).toBeUndefined()
    const original = f.db.query("SELECT data FROM ledger WHERE id=?").get(linked.id)
    expect(f.inputs).toHaveLength(2)

    await f.restart()
    expect(f.starts).toBe(2)
    // Startup and all read paths must not replay either uncertain notice.
    expect((await f.inbox()).items.map((item: any) => item.question_id)).toEqual([linked.id, unlinked.id])
    expect((await f.inbox("all", "other-general")).items).toEqual([])
    expect((await f.thread(linked.id)).question).toMatchObject({
      id: linked.id, session_id: "asker", agent: "general", action_id: action.id,
      data: { format: "loom-question/v2", expected_session: "peer" },
    })
    expect(f.db.query("SELECT data FROM ledger WHERE id=?").get(linked.id)).toEqual(original)
    expect(f.inputs).toHaveLength(2)
    await expect(f.answer(linked.id, undefined, "other-general")).rejects.toThrow("Answering Session")
    expect((await f.thread(linked.id)).answers).toEqual([])

    f.failAdmission()
    const answer = await f.answer(linked.id)
    expect(answer).toMatchObject({ session_id: "peer", agent: "general", action_id: action.id,
      data: { question_id: linked.id, answer: "Persisted exact-Session answer" },
      resume: { status: "admission-observed", attempted: true, asking_session_id: "asker" } })
    expect(f.inputs).toHaveLength(3)
    expect(f.inputs[2]).toMatchObject({ sessionID: "asker", metadata: {
      format: "loom-answer-notice/v1", question_id: linked.id, answer_id: answer.id,
    } })
    expect((await f.inbox()).items.map((item: any) => item.question_id)).toEqual([unlinked.id])
    expect((await f.inbox("answered")).items.map((item: any) => item.question_id)).toEqual([linked.id])

    await f.restart()
    expect((await f.thread(linked.id)).answers.map((item: any) => item.id)).toEqual([answer.id])
    expect(f.db.query("SELECT data FROM ledger WHERE id=?").get(linked.id)).toEqual(original)
    expect(f.inputs).toHaveLength(3)
  } finally { await f.close() }
})

for (const interruption of ["caller", "plugin"] as const) {
  test(`cross-Session ${interruption} interruption after answer commit loses resume eligibility without replay after restart`, async () => {
    const f = await fixture(), controller = new AbortController()
    try {
      const question = await f.ask()
      expect(question.dispatch).toMatchObject({ status: "admission-observed", attempted: true })
      expect(f.inputs).toHaveLength(1)
      let committedBeforeInterruption: { id: string; data: string } | undefined
      f.onLookup(async session => {
        if (session !== "asker") return
        // This external lookup is the resume preflight, after the actual
        // production answer transaction committed. No injected ledger row.
        committedBeforeInterruption = f.db.query(
          "SELECT id,data FROM ledger WHERE kind='answer' AND json_extract(data,'$.data.question_id')=?",
        ).get(question.id) as { id: string; data: string } | undefined
        expect(committedBeforeInterruption).toBeDefined()
        f.onLookup(undefined)
        if (interruption === "caller") controller.abort()
        else await f.restart()
      })
      const answer = await f.answer(question.id, controller.signal)
      expect(answer.id).toBe(committedBeforeInterruption!.id)
      expect(answer.resume).toMatchObject({ status: "not-attempted", attempted: false,
        reason: "caller-or-plugin-interrupted", annotation: { status: interruption === "caller" ? "stored" : "failed" } })
      expect(f.inputs).toHaveLength(1)

      await f.restart()
      expect((await f.inbox()).items).toEqual([])
      expect((await f.inbox("answered")).items).toMatchObject([{ question_id: question.id, state: "answered" }])
      expect((await f.thread(question.id)).answers.map((item: any) => item.id)).toEqual([answer.id])
      expect(f.db.query("SELECT id,data FROM ledger WHERE id=?").get(answer.id)).toEqual(committedBeforeInterruption)
      expect(JSON.parse(committedBeforeInterruption!.data).resume).toBeUndefined()
      expect(f.inputs).toHaveLength(1)

      // A later authorized answer is still accepted, but cannot inherit the
      // first committed answer's lost, immediate-only resume handoff.
      expect((await f.answer(question.id)).resume).toBeUndefined()
      await f.restart()
      expect((await f.thread(question.id)).answers).toHaveLength(2)
      expect(f.inputs).toHaveLength(1)
      const outcomes = f.db.query("SELECT data FROM ledger WHERE kind='result' AND json_extract(data,'$.data.format')='loom-answer-resume/v1'").all()
      expect(outcomes).toHaveLength(interruption === "caller" ? 1 : 0)
    } finally { await f.close() }
  })
}
