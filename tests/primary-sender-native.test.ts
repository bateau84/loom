import { test, expect, spyOn } from "bun:test"
import { Database } from "bun:sqlite"
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createHash } from "node:crypto"
import plugin from "../src/plugin.js"
import { Store } from "../src/store.js"
import { Collaboration } from "../src/collaboration.js"
import { savedRows } from "./helpers/legacy-delivery.js"
import { digest } from "../src/model.js"
import { hydrate, snapshot, type Snapshot, type populate } from "./fixtures/baseline-c9ffcfa/oracle.js"

test("frozen 3f08da9 history still reopens byte-exactly without creating consent or delivery machinery", async () => {
  const provenance = JSON.parse(await readFile(new URL("./fixtures/historical-3f08da9/provenance.json", import.meta.url), "utf8"))
  expect(provenance.commit).toBe("3f08da989c6c64aa94f797732201441119f88180")
  expect(provenance.files.map((file: any) => file.path)).toEqual(["store.ts", "collaboration.ts", "model.ts"])
  for (const file of provenance.files) {
    const bytes = await readFile(new URL(`./fixtures/historical-3f08da9/${file.path}`, import.meta.url))
    expect(createHash("sha256").update(bytes).digest("hex")).toBe(file.sha256)
    expect(createHash("sha1").update(`blob ${bytes.length}\0`).update(bytes).digest("hex")).toBe(file.git_blob)
  }
  const { Store: Old } = await import("./fixtures/historical-3f08da9/store.js")
  const { workReference } = await import("./fixtures/historical-3f08da9/collaboration.js")
  const db = new Database(":memory:")
  try {
    const old = new Old(db), primary = { session_id: "primary", agent: "primary" }, worker = { session_id: "worker", agent: "worker" }
    const action = old.create("Legacy", "Stored only", primary), plan = old.savePlan(action.id, 0, [{ id: "work", kind: "task", title: "Work" }])
    old.collaboration.assign(primary, { assignment_id: "assignment", worker_session_id: "worker", work_ref: workReference(action, plan, "work") })
    const question = old.collaboration.ask(worker, undefined, { assignment_id: "assignment", statement: "Question", respondent: "research" })
    const answer = old.collaboration.answer({ session_id: "research", agent: "research" }, { question_id: question.id, statement: "Legacy answer" })
    const before = snapshot(db)
    expect(before.tables.primary_deliveries).toBeUndefined()
    for (let restart = 0; restart < 2; restart++) {
      const store = new Store(db)
      expect(store.collaboration.thread(question.id).answers[0].id).toBe(answer.id)
      expect(() => store.collaboration.execute(primary, { operation: "authorize-continuation", assignment_id: "assignment", continuation: "primary-native/v1" })).toThrow()
      expect(snapshot(db).tables).toEqual(before.tables)
      expect(store).not.toHaveProperty("delivery")
    }
  } finally { db.close() }
})

// The old sender's positive transport/retry/reconciliation contracts are retired,
// not renamed as current capabilities. This proves the replacement: no machinery
// runs against meaningful frozen historical inputs, including authorized pending
// and send-started projections. The registration host is a boundary double;
// installed-native acceptance remains a separate gate.
test("populated startup, reads, rejected retired calls and legacy answers never contact native delivery APIs", async () => {
  const commits = spyOn(Collaboration.prototype, "answer") // Pass-through observation of real registered legacy answer commits.
  const root = await mkdtemp(join(tmpdir(), "loom-retired-sender-"))
  const previous = { state: process.env.XDG_STATE_HOME, config: process.env.OPENCODE_CONFIG_DIR }
  const saved = JSON.parse(await readFile(new URL("./fixtures/baseline-c9ffcfa/snapshot.json", import.meta.url), "utf8")) as Snapshot
  const ids = JSON.parse(await readFile(new URL("./fixtures/baseline-c9ffcfa/ids.json", import.meta.url), "utf8")) as ReturnType<typeof populate>
  const project = { id: "retirement", canonical: root, directory: root }
  const state = join(root, "state", "loom", "actions-v1", digest({ project: project.id, canonical: project.canonical }))
  let db: Database | undefined, dispose: (() => Promise<void>) | undefined
  const native: string[] = [], lookups: string[] = [], tools = new Map<string, any>()
  const forbidden = (name: string) => async () => { native.push(name); throw new Error(`Retired native activity: ${name}`) }
  const ctx = {
    location: { directory: root, project },
    tool: {
      transform: async (fn: any) => { fn({ namespace() {}, add: (tool: any) => tools.set(tool.name, tool) }); return { dispose: async () => {} } },
      hook: async () => ({ dispose: async () => {} }),
    },
    session: {
      get: async ({ sessionID }: { sessionID: string }) => { lookups.push(sessionID); return { id: sessionID, projectID: project.id, location: { directory: root } } },
      hook: async () => ({ dispose: async () => {} }),
      synthetic: forbidden("synthetic"), context: forbidden("context"), create: forbidden("create"), prompt: forbidden("prompt"),
    },
    permission: { ask: forbidden("permission") },
    event: { subscribe: async function* () { native.push("subscribe"); throw new Error("No delivery admission observer") } },
  }
  const invoke = async (input: unknown) => JSON.parse((await tools.get("record").execute(input, {
    sessionID: "current-caller", agent: "respondent", signal: new AbortController().signal,
  })).content).result
  try {
    process.env.XDG_STATE_HOME = join(root, "state"); process.env.OPENCODE_CONFIG_DIR = join(root, "config")
    await writeFile(join(root, ".loom.yaml"), "agents: {}\ninstructions: {enabled: false}\nledger: {capture: off}\n")
    await mkdir(state, { recursive: true })
    const filename = join(state, "ledger.sqlite")
    db = new Database(filename); hydrate(db, saved)
    const rawBefore = savedRows(db)
    for (let restart = 0; restart < 2; restart++) {
      dispose = await (plugin as any).setup(ctx)
      expect(snapshot(db)).toEqual(saved)
      expect(savedRows(db)).toEqual(rawBefore)
      // Raw ledger is the historical interface, without live status reinterpretation.
      for (const row of db.query("SELECT id FROM ledger WHERE action_id IS NOT NULL ORDER BY seq").all() as { id: string }[]) {
        const result = await invoke({ operation: "query", action_id: (db.query("SELECT action_id FROM ledger WHERE id=?").get(row.id) as {action_id: string}).action_id, record_id: row.id })
        expect(result.items[0].id).toBe(row.id)
      }
      const thread = await invoke({ operation: "query", view: "thread", question_id: ids.question.id })
      expect(thread.question.data).toEqual(ids.question.data)
      for (const operation of ["assign", "authorize-continuation", "withdraw-continuation", "retry-delivery"])
        await expect(invoke({ operation, assignment_id: "synthetic-pending-assignment", delivery_id: ids.activePending.delivery.intent_id })).rejects.toThrow("retired")
      for (const view of ["assignments", "deliveries"])
        await expect(invoke({ operation: "query", view })).rejects.toThrow("retired")
      expect(snapshot(db)).toEqual(saved)
      expect(savedRows(db)).toEqual(rawBefore)
      await dispose?.(); dispose = undefined
      expect(native).toEqual([])
    }
    dispose = await (plugin as any).setup(ctx)
    const before = snapshot(db)
    db.exec("CREATE TRIGGER refuse_answer BEFORE INSERT ON ledger WHEN NEW.kind='answer' BEGIN SELECT RAISE(ABORT,'answer refused'); END")
    await expect(invoke({ operation: "answer", question_id: ids.pendingQuestion.id, answer: "Must roll back" })).rejects.toThrow("answer refused")
    db.exec("DROP TRIGGER refuse_answer")
    expect(snapshot(db)).toEqual(before)
    // Legacy authorization/false/missing consent is never operative, even on a
    // fresh answer to a formerly assigned question. No new intent/event/queue.
    for (const question of [ids.question, ids.pendingQuestion]) {
      const answer = await invoke({ operation: "answer", question_id: question.id, answer: "New historical response; not execution authority" })
      const commit = commits.mock.results.at(-1)?.value
      if (!commit || typeof commit !== "object") throw new Error("Registered answer did not return a commit result")
      expect(commit).not.toHaveProperty("resume")
      expect(answer).not.toHaveProperty("delivery")
      expect(answer.data).not.toHaveProperty("assignment_id")
      expect(answer).toMatchObject({ session_id: "current-caller", agent: "respondent", action_id: question.action_id, node_id: question.node_id })
    }
    const after = snapshot(db)
    expect(after.tables.primary_deliveries).toEqual(before.tables.primary_deliveries)
    expect(after.tables.ledger.slice(0, before.tables.ledger.length)).toEqual(before.tables.ledger)
    expect(after.tables.ledger.length).toBe(before.tables.ledger.length + 2)
    expect(db.query("SELECT COUNT(*) AS n FROM ledger WHERE kind='answer'").get()).toEqual({
      n: before.tables.ledger.filter((row: any) => row.kind === "answer").length + 2,
    })
    expect(native).toEqual([])
    expect(lookups.every(id => id === "current-caller")).toBe(true)
    await dispose?.(); dispose = undefined
    dispose = await (plugin as any).setup(ctx)
    expect(snapshot(db)).toEqual(after)
    expect(native).toEqual([])
  } finally {
    commits.mockRestore()
    await dispose?.(); db?.close()
    if (previous.state === undefined) delete process.env.XDG_STATE_HOME; else process.env.XDG_STATE_HOME = previous.state
    if (previous.config === undefined) delete process.env.OPENCODE_CONFIG_DIR; else process.env.OPENCODE_CONFIG_DIR = previous.config
    await rm(root, { recursive: true, force: true })
  }
})
