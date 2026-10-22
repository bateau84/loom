import { test, expect } from "bun:test"
import { Database } from "bun:sqlite"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import plugin from "../server.js"
import { digest } from "../src/model.js"
import { Store } from "../src/store.js"
import { RESUME_WAIT_MS } from "../src/answer-resume.js"

// Component evidence: real registered callbacks/SQLite/adapter, simulated native boundary.
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "loom-resume-"))
  const previous = { state: process.env.XDG_STATE_HOME, config: process.env.OPENCODE_CONFIG_DIR }
  process.env.XDG_STATE_HOME = join(root, "state"); process.env.OPENCODE_CONFIG_DIR = join(root, "config")
  await writeFile(join(root, ".loom.yaml"), "agents: {}\ninstructions: {enabled: false}\nledger: {capture: off}\n")
  const tools = new Map<string, any>(), calls: any[] = [], lookups: string[] = []
  const project = { id: "resume", canonical: root, directory: root }
  const target = { id: "asker", projectID: project.id, location: { directory: root }, agent: "original", model: { id: "current" }, permissions: ["native-only"] }
  let lookup: (id: string) => Promise<unknown> = async id => ({ ...target, id })
  let send: (input: any) => Promise<unknown> = async input => ({ id: "native-ack", sessionID: input.sessionID, type: "synthetic", delivery: input.delivery })
  const registration = async () => ({ dispose: async () => {} })
  const ctx = {
    location: { directory: root, project },
    skill: { transform: async (fn: any) => { fn({ get: () => undefined, add() {} }); return registration() } },
    tool: { transform: async (fn: any) => { fn({ namespace() {}, add: (t: any) => tools.set(t.name, t) }); return registration() }, hook: registration },
    session: { get: async ({ sessionID }: any) => { lookups.push(sessionID); return lookup(sessionID) }, hook: registration,
      synthetic: async (...args: any[]) => { calls.push(args); return send(args[0]) } },
  }
  let dispose = await (plugin as any).setup(ctx)
  const db = new Database(join(root, "state", "loom", "actions-v1", digest({ project: project.id, canonical: root }), "ledger.sqlite"))
  const invoke = async (input: unknown, sessionID = "asker", signal = new AbortController().signal) => {
    const args = input && typeof input === "object" && (input as any).view === "full_thread"
      ? { ...input, response_format: "json" } : input
    return JSON.parse((await tools.get("record").execute(args, { sessionID, agent: sessionID === "asker" ? "original" : "respondent", signal })).content).result
  }
  return { root, db, calls, lookups, target, invoke,
    lookup: (fn: typeof lookup) => { lookup = fn }, send: (fn: typeof send) => { send = fn },
    ask: (blocking = true) => invoke({ operation: "ask", question: "Stored question", to_agent: "recipient", blocking }),
    answer: (id: string, signal?: AbortSignal) => invoke({ operation: "answer", question_id: id, answer: "PRIVATE ANSWER BODY" }, "respondent", signal),
    reload: async () => { await dispose(); dispose = await (plugin as any).setup(ctx) },
    close: async () => { await dispose(); db.close();
      if (previous.state === undefined) delete process.env.XDG_STATE_HOME; else process.env.XDG_STATE_HOME = previous.state
      if (previous.config === undefined) delete process.env.OPENCODE_CONFIG_DIR; else process.env.OPENCODE_CONFIG_DIR = previous.config
      await rm(root, { recursive: true, force: true }) },
  }
}

test("first committed blocking answer admits exactly one IDs-only exact-asker notice without changing current authority", async () => {
  const f = await fixture()
  try {
    const q = await f.ask()
    f.target.agent = "switched"; f.target.model = { id: "after-switch" }
    const before = JSON.stringify(f.target)
    expect(f.calls).toHaveLength(0)
    const a = await f.answer(q.id)
    expect(f.calls).toHaveLength(1)
    expect(f.calls[0]).toHaveLength(1)
    const notice = f.calls[0][0]
    expect(notice).toMatchObject({ sessionID: "asker", resume: true, delivery: "steer" })
    expect(Object.keys(notice).sort()).toEqual(["delivery", "description", "metadata", "resume", "sessionID", "text"])
    expect(notice.text).toContain(q.id); expect(notice.text).toContain(a.id)
    expect(notice.text).not.toContain("PRIVATE ANSWER BODY")
    expect(notice.text).toContain("retrieve")
    expect(JSON.stringify(f.target)).toBe(before)
    expect(a).toMatchObject({ session_id: "respondent", agent: "respondent", resume: { status: "admission-observed", attempted: true, annotation: { status: "stored" } } })
    const annotation = f.db.query("SELECT data FROM ledger WHERE id=?").get(a.resume.annotation.id) as any
    expect(JSON.parse(annotation.data)).toMatchObject({ agent: "system", session_id: "respondent", kind: "result", data: { format: "loom-answer-resume/v1", question_id: q.id, answer_id: a.id } })
    const history = await f.invoke({ operation: "query", view: "full_thread", session_id: "respondent" })
    expect(history.markdown).toContain("loom-answer-resume/v1")
    expect(history.markdown).toContain("system")
    const saved = f.db.query("SELECT data FROM ledger WHERE id=?").get(a.id) as any
    expect(JSON.parse(saved.data).resume).toBeUndefined()
    await f.answer(q.id); await f.reload()
    await f.invoke({ operation: "query", view: "thread", question_id: q.id })
    await f.answer(q.id)
    expect(f.calls).toHaveLength(1)
  } finally { await f.close() }
})

test("concurrent registered answers have one firstness winner; nonblocking and committed crash-loss never transfer eligibility", async () => {
  const f = await fixture()
  try {
    const q = await f.ask()
    const answers = await Promise.all(Array.from({ length: 6 }, () => f.answer(q.id)))
    expect(f.calls).toHaveLength(1)
    expect(answers.filter(a => a.resume)).toHaveLength(1)
    expect(answers.find(a => a.resume).id).toBe(f.calls[0][0].metadata.answer_id)
    const nonblocking = await f.ask(false)
    expect((await f.answer(nonblocking.id)).resume).toBeUndefined()
    const lost = await f.ask()
    // Crash-point model: actual commit succeeds but its ephemeral result is dropped.
    const stored = new Store(f.db).collaboration.answer({ session_id: "crashed", agent: "respondent" }, { question_id: lost.id, answer: "Stored before crash" })
    expect(stored.resume).toBeDefined()
    await f.reload()
    expect((await f.answer(lost.id)).resume).toBeUndefined()
    await f.invoke({ operation: "query", view: "full_thread", session_id: "asker" })
    expect(f.calls).toHaveLength(1)
    expect(f.db.query("SELECT COUNT(*) n FROM ledger WHERE kind='answer'").get()).toEqual({ n: 9 })
  } finally { await f.close() }
})

test("answer append and COMMIT failure contact nobody; outcome append failure preserves both answer and native admission", async () => {
  const f = await fixture()
  try {
    const q = await f.ask()
    f.db.exec("CREATE TRIGGER refuse_answer BEFORE INSERT ON ledger WHEN NEW.kind='answer' BEGIN SELECT RAISE(ABORT,'append refused'); END")
    await expect(f.answer(q.id)).rejects.toThrow("append refused")
    expect(f.calls).toHaveLength(0)
    f.db.exec("DROP TRIGGER refuse_answer; CREATE TABLE p(id INTEGER PRIMARY KEY); CREATE TABLE c(id INTEGER REFERENCES p(id) DEFERRABLE INITIALLY DEFERRED); CREATE TRIGGER refuse_commit AFTER INSERT ON ledger WHEN NEW.kind='answer' BEGIN INSERT INTO c VALUES(999); END")
    await expect(f.answer(q.id)).rejects.toThrow("FOREIGN KEY")
    expect(f.calls).toHaveLength(0)
    expect(f.db.query("SELECT COUNT(*) n FROM ledger WHERE kind='answer'").get()).toEqual({ n: 0 })
    f.db.exec("DROP TRIGGER refuse_commit; CREATE TRIGGER refuse_outcome BEFORE INSERT ON ledger WHEN NEW.kind='result' BEGIN SELECT RAISE(ABORT,'outcome refused'); END")
    const a = await f.answer(q.id)
    expect(a.resume).toMatchObject({ status: "admission-observed", annotation: { status: "failed", error: "outcome refused" } })
    expect(f.calls).toHaveLength(1)
    expect((await f.invoke({ operation: "query", view: "thread", question_id: q.id })).answers[0].id).toBe(a.id)
    expect((await f.answer(q.id)).resume).toBeUndefined()
    expect(f.calls).toHaveLength(1)
  } finally { await f.close() }
})

test("missing, inaccessible, wrong-ID and moved targets fail closed without fallback or later transfer", async () => {
  const f = await fixture()
  try {
    for (const variant of ["missing", "inaccessible", "wrong-id", "directory", "project", "workspace", "malformed"]) {
      const q = await f.ask()
      f.lookup(async id => {
        if (id !== "asker") return { ...f.target, id }
        if (["missing", "inaccessible"].includes(variant)) throw new Error(variant)
        if (variant === "wrong-id") return { ...f.target, id: "other" }
        if (variant === "malformed") return { id }
        if (variant === "directory") return { ...f.target, location: { directory: "/no/such/location" } }
        if (variant === "project") return { ...f.target, projectID: "other" }
        return { ...f.target, location: { directory: f.root, workspaceID: "other" } }
      })
      const a = await f.answer(q.id)
      expect(a.resume).toMatchObject({ status: "not-attempted", attempted: false, annotation: { status: "stored" } })
      f.lookup(async id => ({ ...f.target, id }))
      expect((await f.answer(q.id)).resume).toBeUndefined()
    }
    expect(f.calls).toHaveLength(0)
    expect(f.lookups.every(id => ["asker", "respondent"].includes(id))).toBe(true)
  } finally { await f.close() }
})

test("native explicit rejection, transport uncertainty and malformed acknowledgement retain the answer and prohibit retry", async () => {
  const f = await fixture()
  try {
    for (const variant of ["reject", "network", "ack"]) {
      const q = await f.ask()
      f.send(async () => {
        if (variant === "reject") throw { _tag: "UnauthorizedError" }
        if (variant === "network") throw new Error("connection lost after possible admission")
        return { id: "wrong", sessionID: "other", type: "synthetic" }
      })
      const a = await f.answer(q.id)
      expect(a.resume.status).toBe(variant === "reject" ? "failed" : "outcome-unknown")
      expect(a.resume.attempted).toBe(true)
      await f.answer(q.id); await f.reload()
      await f.invoke({ operation: "query", view: "thread", question_id: q.id })
    }
    expect(f.calls).toHaveLength(3)
  } finally { await f.close() }
})

test("caller interruption bounds waiting, never cancels already-started admission, and late completion changes no stored outcome", async () => {
  const f = await fixture()
  let resolve!: (value: unknown) => void
  try {
    const q = await f.ask(), controller = new AbortController()
    f.send(() => { controller.abort(); return new Promise(r => { resolve = r }) })
    const a = await f.answer(q.id, controller.signal)
    expect(a.resume).toMatchObject({ status: "outcome-unknown", attempted: true, reason: "caller-or-plugin-interrupted" })
    resolve({ id: "late", sessionID: "asker", type: "synthetic" })
    await Promise.resolve(); await Promise.resolve()
    const annotation = f.db.query("SELECT data FROM ledger WHERE id=?").get(a.resume.annotation.id) as any
    expect(JSON.parse(annotation.data).data.status).toBe("outcome-unknown")
    await f.answer(q.id); await f.reload()
    expect(f.calls).toHaveLength(1)
  } finally { await f.close() }
})

test("caller and plugin interruption after commit but before admission lose eligibility without starting native input", async () => {
  const f = await fixture()
  try {
    for (const shutdown of [false, true]) {
      const q = await f.ask(), controller = new AbortController()
      let shutdownDone: Promise<void> | undefined
      f.lookup(async id => {
        if (id === "asker") {
          if (shutdown) await (shutdownDone = f.reload())
          else controller.abort()
        }
        return { ...f.target, id }
      })
      const a = await f.answer(q.id, controller.signal)
      await shutdownDone
      expect(a.resume).toMatchObject({ status: "not-attempted", attempted: false, reason: "caller-or-plugin-interrupted" })
      expect(a.resume.annotation.status).toBe(shutdown ? "failed" : "stored")
      f.lookup(async id => ({ ...f.target, id }))
      expect((await f.answer(q.id)).resume).toBeUndefined()
      expect((await f.invoke({ operation: "query", view: "thread", question_id: q.id })).answers[0].id).toBe(a.id)
    }
    expect(f.calls).toHaveLength(0)
  } finally { await f.close() }
})

test("deadline bounds both preflight and admission waits, with zero late preflight send and no replay", async () => {
  const f = await fixture()
  let resolveLookup!: (value: unknown) => void, resolveSend!: (value: unknown) => void
  try {
    const q = await f.ask()
    f.lookup(id => id === "asker" ? new Promise(r => { resolveLookup = r }) : Promise.resolve({ ...f.target, id }))
    const a = await f.answer(q.id)
    expect(a.resume).toMatchObject({ status: "not-attempted", attempted: false, reason: "wait-deadline-exceeded" })
    resolveLookup(f.target)
    await Promise.resolve(); await Promise.resolve()
    expect(f.calls).toHaveLength(0)
    f.lookup(async id => ({ ...f.target, id }))
    const next = await f.ask()
    f.send(() => new Promise(r => { resolveSend = r }))
    const b = await f.answer(next.id)
    expect(b.resume).toMatchObject({ status: "outcome-unknown", attempted: true, reason: "wait-deadline-exceeded" })
    resolveSend({ id: "late", sessionID: "asker", type: "synthetic" })
    await f.answer(q.id); await f.answer(next.id); await f.reload()
    expect(f.calls).toHaveLength(1)
    expect(RESUME_WAIT_MS).toBe(5000)
  } finally { await f.close() }
}, 20000)
