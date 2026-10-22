import { test, expect } from "bun:test"
import { registeredLoom } from "./helpers/registered-loom.js"
import { Database } from "bun:sqlite"
import { readdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { Store } from "../src/store.js"
import { PROCESSING_LIMITS } from "../src/model.js"
import { renderFullHistory } from "../src/history-renderer.js"
import { populate, snapshot } from "./fixtures/baseline-c9ffcfa/oracle.js"
import plugin from "../server.js"

// Independently recover the labelled JSON representation, not renderer helpers.
function parts(markdown: string) {
  const result: Array<{ id: string; part: number; total: number; start: number; end: number; length: number; text: string }> = []
  const pattern = /## Record (\S+) — [^\n]+\n\n(?:[^\n]+\n\n)*?Part (\d+)\/(\d+); representation UTF-16 range \[(\d+), (\d+)\) of (\d+)\.[^\n]*\n\n((?:    [^\n]*\n)+)/g
  for (const m of markdown.matchAll(pattern)) result.push({ id: m[1], part: +m[2], total: +m[3], start: +m[4], end: +m[5], length: +m[6],
    text: m[7].slice(0, -1).split("\n").map(line => line.slice(4)).join("\n") })
  return result
}
async function openRegisteredDB(f: Awaited<ReturnType<typeof registeredLoom>>) {
  const root = join(f.directory, "state", "loom", "actions-v1")
  return new Database(join(root, (await readdir(root))[0], "ledger.sqlite"))
}

test("registered full_thread reads explicit other-Session conversations without selection or re-attribution", async () => {
  const f = await registeredLoom()
  try {
    const q = (await f.invoke("record", { operation: "ask", question: "# <script> & ``` 😀\n[link](bad)", to_agent: "investigator", blocking: false,
      context_attachments: ["fixture://question"] }, "asker", "author")).result
    const a = (await f.invoke("record", { operation: "answer", question_id: q.id, answer: "Response, not permission", context_attachments: ["fixture://answer"] }, "other", "investigator")).result
    const before = (await f.invoke("context", {}, "reader")).result
    const response = await f.invoke("record", { operation: "query", view: "full_thread", session_id: "asker" }, "reader")
    expect(response.result.format).toBe("loom-full-thread/v1")
    expect(response.result.next_cursor).toBeNull()
    const text = response.result.markdown
    expect(text).toContain(q.id); expect(text).toContain(a.id)
    expect(text).toContain('"session_id": "other"')
    expect(text).toContain('"agent": "investigator"')
    expect(text).toContain("fixture://question"); expect(text).toContain("fixture://answer")
    expect(text).toContain("response, not resolution")
    expect(text).not.toMatch(/^# <script>/m)
    expect((await f.invoke("context", {}, "reader")).result).toEqual(before)
    expect(f.tools.size).toBe(7)
    expect(f.tools.get("record").input.properties.view.enum).toContain("full_thread")
  } finally { await f.close() }
})

test("registered oversized Unicode/control text traverses labelled parts exactly once and rejects invalid cursors", async () => {
  const f = await registeredLoom()
  let db: Database | undefined
  try {
    const question = ("😀漢字é e\u0301 # [x](bad) <tag> ``` \\ \t\r\n\u001b\u202e\u2066".repeat(220))
    const q = (await f.invoke("record", { operation: "ask", question, context: question.slice(0, 4000),
      context_attachments: Array.from({ length: 40 }, (_, i) => `fixture://${i}/` + "😀".repeat(740)), to_agent: "investigator", blocking: false }, "asker")).result
    const a = (await f.invoke("record", { operation: "answer", question_id: q.id, answer: "Final direct answer" }, "other")).result
    const scope = { operation: "query", view: "full_thread", session_id: "asker", limit: 1 }
    let cursor: string | undefined, joined = "", previousEnd = 0, pages = 0, firstCursor = ""
    const complete: string[] = []
    do {
      const page = await f.invoke("record", { ...scope, ...(cursor ? { cursor } : {}) }, "reader")
      expect(JSON.stringify(page).length).toBeLessThanOrEqual(PROCESSING_LIMITS.valueChars)
      const chunks = parts(page.result.markdown)
      expect(chunks).toHaveLength(1)
      const p = chunks[0]
      expect(page.result.markdown).toContain('"session_id":"' + (p.id === q.id ? "asker" : "other") + '"')
      expect(p.text.length).toBe(p.end - p.start)
      expect(p.start).toBe(previousEnd)
      expect(p.text).not.toMatch(/^[\udc00-\udfff]|[\ud800-\udbff]$/u)
      expect(page.result.markdown).not.toContain("\u202e")
      joined += p.text; previousEnd = p.end
      if (p.part === p.total) {
        const record = JSON.parse(joined)
        expect(record.id).toBe(p.id)
        if (record.id === q.id) expect(record.data.question).toBe(question)
        complete.push(record.id); joined = ""; previousEnd = 0
      } else {
        expect(page.result.markdown).toContain("record not advanced")
        const position = JSON.parse(Buffer.from(page.result.next_cursor, "base64url").toString())
        expect(position.part.id).toBe(q.id)
        expect(position.after).toBe(0)
      }
      cursor = page.result.next_cursor ?? undefined
      if (pages++ === 0) firstCursor = cursor!
      expect(pages).toBeLessThan(100)
    } while (cursor)
    expect(pages).toBeGreaterThan(10)
    expect(complete).toEqual([q.id, a.id])
    expect(joined).toBe("")
    const unchanged = await f.invoke("record", { ...scope, cursor: firstCursor }, "reader")
    expect(await f.invoke("record", { ...scope, cursor: firstCursor }, "reader")).toEqual(unchanged)
    const position = JSON.parse(Buffer.from(firstCursor, "base64url").toString())
    for (const offset of [1, 8191, 999999, -1, 1.5]) {
      const forged = Buffer.from(JSON.stringify({ ...position, part: { ...position.part, offset } })).toString("base64url")
      await expect(f.invoke("record", { ...scope, cursor: forged }, "reader")).rejects.toThrow()
    }
    for (const input of [{ ...scope, session_id: "other", cursor: firstCursor }, { ...scope, cursor: "broken" },
      { ...scope, cursor: Buffer.from(JSON.stringify({ ...position, version: "other" })).toString("base64url") }])
      await expect(f.invoke("record", input, "reader")).rejects.toThrow()
    db = await openRegisteredDB(f)
    db.exec("UPDATE ledger SET data='{}' WHERE id='" + q.id + "'") // Explicit corruption fault, not upstream-produced state.
    await expect(f.invoke("record", { ...scope, cursor: firstCursor }, "reader")).rejects.toThrow()
  } finally { db?.close(); await f.close() }
})

test("registered scope/schema validation rejects retired and unrelated fields without selection fallback", async () => {
  const f = await registeredLoom()
  try {
    const action = (await f.invoke("action", { operation: "create", title: "A", goal: "G" })).result
    const schema = f.tools.get("record").input
    expect(JSON.parse(JSON.stringify(schema)).properties.view.enum).toEqual(["ledger", "progress", "questions", "thread", "full_thread"])
    const full = schema.allOf.find((s: any) => s.if.properties.view?.const === "full_thread").then
    expect(full.additionalProperties).toBe(false)
    expect(full.properties.operation.const).toBe("query")
    expect(Object.keys(full.properties).sort()).toEqual(["action_id", "cursor", "limit", "node_id", "operation", "session_id", "view"])
    for (const op of schema.allOf.slice(0, 2)) {
      expect(op.then.properties.context_attachments).toBeDefined()
      expect(op.then.properties.attachments).toBeUndefined()
    }
    for (const input of [{}, { node_id: "task" }, { action_id: action.id, session_id: "s" }, { session_id: "s", node_id: "task" },
      { session_only: true }, { action_id: action.id, after: 0 }, { action_id: action.id, record_id: "x" }, { action_id: action.id, offset: 0 },
      { session_id: "s", limit: null }, { session_id: "s", limit: 0 }, { session_id: "s", limit: 51 },
      { session_id: "s", attachments: [] }, { session_id: "s", context_attachments: [] }])
      await expect(f.invoke("record", { operation: "query", view: "full_thread", ...input })).rejects.toThrow()
    for (const view of ["assignments", "deliveries"]) await expect(f.invoke("record", { operation: "query", view })).rejects.toThrow("retired")
    for (const operation of ["assign", "authorize-continuation", "withdraw-continuation", "retry-delivery"])
      await expect(f.invoke("record", { operation })).rejects.toThrow("retired")
    for (const operation of ["add", "ask", "answer", "complete", "reopen"])
      await expect(f.invoke("record", { operation, view: "full_thread", session_id: "s" })).rejects.toThrow()
    await expect(f.invoke("record", { operation: "query", cursor: "x" })).rejects.toThrow("full_thread")
    expect((await f.invoke("record", { operation: "query", view: "full_thread", action_id: action.id, node_id: "removed" })).result.markdown).toContain("No eligible")
  } finally { await f.close() }
})

test("registered full statements after an earlier record continue without advancing or duplicating it; default pages are bounded", async () => {
  const f = await registeredLoom()
  try {
    const action = (await f.invoke("action", { operation: "create", title: "Statements", goal: "Full read" }, "writer")).result
    const records: any[] = []
    for (const statement of ["First", "\u001b".repeat(16000), ...Array.from({ length: 50 }, (_, i) => `Short ${i}`)])
      records.push((await f.invoke("record", { operation: "add", action_id: action.id, kind: "result", statement }, "writer")).result)
    const first = (await f.invoke("record", { operation: "query", view: "full_thread", action_id: action.id })).result
    expect(parts(first.markdown).map(p => p.id)).toEqual([records[0].id, records[1].id])
    const position = JSON.parse(Buffer.from(first.next_cursor, "base64url").toString())
    expect(position.part.id).toBe(records[1].id)
    let cursor: string | undefined, afterLarge: string | undefined, joined = "", pageCount = 0, maxChars = 0
    const actual: any[] = []
    do {
      const envelope = await f.invoke("record", { operation: "query", view: "full_thread", action_id: action.id, limit: 1, ...(cursor ? { cursor } : {}) })
      maxChars = Math.max(maxChars, JSON.stringify(envelope).length)
      expect(JSON.stringify(envelope).length).toBeLessThanOrEqual(PROCESSING_LIMITS.valueChars)
      const chunks = parts(envelope.result.markdown)
      expect(chunks.length).toBeLessThanOrEqual(20)
      for (const p of chunks) {
        joined += p.text
        if (p.part === p.total) {
          actual.push(JSON.parse(joined)); joined = ""
          if (p.id === records[1].id) afterLarge = envelope.result.next_cursor
        }
      }
      cursor = envelope.result.next_cursor ?? undefined
      expect(++pageCount).toBeLessThan(100)
    } while (cursor)
    expect(actual.map(r => r.id)).toEqual(records.map(r => r.id))
    expect(actual.map(r => r.data.statement)).toEqual(records.map(r => r.data.statement))
    expect(maxChars).toBeGreaterThan(8192)
    const defaultPage = (await f.invoke("record", { operation: "query", view: "full_thread", action_id: action.id, cursor: afterLarge })).result
    expect(parts(defaultPage.markdown)).toHaveLength(20)
    const lastPage = (await f.invoke("record", { operation: "query", view: "full_thread", action_id: action.id, limit: 50,
      cursor: afterLarge })).result
    expect(parts(lastPage.markdown)).toHaveLength(50)
    expect(lastPage.next_cursor).toBeNull()
  } finally { await f.close() }
})

test("renderer refuses even in-range non-boundary offsets and emits only real stored observation metadata", () => {
  const db = new Database(":memory:")
  try {
    const store = new Store(db)
    const r = store.observe({ session_id: "s", agent: "true-author" }, undefined,
      { tool: "<script>\n# untrusted", phase: "finished", status: "error", output_digest: "reference-only", nested: { body: "not a synthesized raw output" } })
    const page = store.history.read({ session_id: "s" })
    expect(() => renderFullHistory({ ...page, offset: 1 })).toThrow("representation offset")
    const rendered = renderFullHistory(page)
    const body = JSON.parse(parts(rendered.markdown)[0].text)
    expect(body).toEqual({ ...r, sequence: page.items[0].sequence })
    expect(body.data.output).toBeUndefined()
    expect(rendered.markdown).toContain("unavailable raw tool bodies are not reconstructed")
  } finally { db.close() }
})

test("real frozen producer plus registered new writes render full mixed history and independent membership oracle", async () => {
  const f = await registeredLoom()
  const db = await openRegisteredDB(f)
  try {
    const old = populate(db)
    const q = (await f.invoke("record", { operation: "ask", question: "New question", to_agent: "investigator", blocking: false,
      reference: { action_id: old.action.id, kind: "action", id: old.action.id } }, "new-author")).result
    await f.invoke("record", { operation: "answer", question_id: q.id, answer: "Direct new answer" }, "new-responder")
    await f.invoke("record", { operation: "answer", question_id: old.question.id, answer: "A genuine historical answer relationship" }, "new-responder")
    const before = snapshot(db)
    const all = (db.query("SELECT seq,data FROM ledger ORDER BY seq").all() as { seq: number; data: string }[]).map(r => ({ ...JSON.parse(r.data), sequence: r.seq }))
    for (const scope of [{ action_id: old.action.id }, { action_id: old.action.id, node_id: "removed" }, { action_id: old.action.id, node_id: "work" },
      { session_id: "new-responder" }, { session_id: "synthetic-primary" }, { session_id: "synthetic-worker" }, { session_id: "researcher" }]) {
      const own = (r: any) => "session_id" in scope ? r.session_id === scope.session_id : r.action_id === scope.action_id && (!("node_id" in scope) || r.node_id === scope.node_id)
      const ids = new Set(all.filter(own).map(r => r.id))
      for (const question of all.filter(r => r.kind === "question")) {
        const answers = all.filter(r => r.kind === "answer" && r.data.question_id === question.id && r.action_id === question.action_id && r.node_id === question.node_id)
        if (own(question) || answers.some(own)) for (const r of [question, ...answers]) ids.add(r.id)
      }
      const expected = all.filter(r => ids.has(r.id)), actual: any[] = []
      let cursor: string | undefined, joined = ""
      do {
        const result = (await f.invoke("record", { operation: "query", view: "full_thread", ...scope, limit: 2, ...(cursor ? { cursor } : {}) }, "reader")).result
        for (const p of parts(result.markdown)) {
          joined += p.text
          if (p.part === p.total) { actual.push(JSON.parse(joined)); joined = "" }
        }
        cursor = result.next_cursor ?? undefined
      } while (cursor)
      expect(actual).toEqual(expected)
      expect(new Set(actual.map(r => r.id)).size).toBe(actual.length)
    }
    const actionPage = (await f.invoke("record", { operation: "query", view: "full_thread", action_id: old.action.id, limit: 50 })).result
    expect(actionPage.markdown).toContain("Historical legacy record")
    expect(actionPage.markdown).toContain("agent-reported, not independent acceptance")
    expect(actionPage.markdown).toContain("Stored observation metadata only")
    expect(actionPage.markdown).toContain("work_ref")
    expect(actionPage.markdown).toContain("evidence_ids")
    expect(actionPage.markdown).toContain("artifact_refs")
    expect(snapshot(db)).toEqual(before)
  } finally { db.close(); await f.close() }
})

test("full_thread registered reads use only caller ownership lookup, no target native reads or execution", async () => {
  const directory = await mkdtemp(join(tmpdir(), "full-thread-native-")), tools = new Map<string, any>(), lookups: string[] = [], calls: string[] = []
  const previous = { state: process.env.XDG_STATE_HOME, config: process.env.OPENCODE_CONFIG_DIR }
  const forbidden = (name: string) => async () => { calls.push(name); throw new Error(`Forbidden native ${name}`) }
  const registration = async () => ({ dispose: async () => {} })
  const ctx = { location: { directory, project: { id: "thread", canonical: directory } },
    skill: { transform: async (fn: any) => { fn({ get() {}, add() {} }); return registration() } },
    tool: { transform: async (fn: any) => { fn({ namespace() {}, add: (t: any) => tools.set(t.name, t) }); return registration() }, hook: registration },
    session: { get: async ({ sessionID }: any) => { lookups.push(sessionID); return { projectID: "thread", location: { directory } } }, hook: registration,
      context: forbidden("context"), synthetic: forbidden("synthetic"), create: forbidden("create"), prompt: forbidden("prompt") },
    agent: { list: forbidden("agent-list"), execute: forbidden("executor") }, permission: { ask: forbidden("permission") } }
  let dispose: (() => Promise<void>) | undefined
  try {
    process.env.XDG_STATE_HOME = join(directory, "state"); process.env.OPENCODE_CONFIG_DIR = join(directory, "config")
    await writeFile(join(directory, ".loom.yaml"), "agents: {}\ninstructions: {enabled: false}\nledger: {capture: off}\n")
    dispose = await (plugin as any).setup(ctx)
    const invoke = async (input: any) => JSON.parse((await tools.get("record").execute(input, { sessionID: "reader", agent: "author", signal: new AbortController().signal })).content)
    for (let restart = 0; restart < 2; restart++) {
      await invoke({ operation: "query", view: "full_thread", session_id: "other-session" })
      await expect(invoke({ operation: "query", view: "full_thread", session_id: "other-session", cursor: "invalid" })).rejects.toThrow()
      if (!restart) { await dispose!(); dispose = await (plugin as any).setup(ctx) }
    }
    expect(calls).toEqual([])
    expect(lookups).toEqual(["reader", "reader", "reader", "reader"])
  } finally {
    await dispose?.()
    for (const [key, value] of [["XDG_STATE_HOME", previous.state], ["OPENCODE_CONFIG_DIR", previous.config]]) {
      if (value === undefined) delete process.env[key!]; else process.env[key!] = value
    }
    await rm(directory, { recursive: true, force: true })
  }
})
