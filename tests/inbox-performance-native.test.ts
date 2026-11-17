import { expect, test } from "bun:test"
import { Database } from "bun:sqlite"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Store } from "../src/store.js"
import { snapshot } from "./fixtures/baseline-c9ffcfa/oracle.js"
import { allInboxIDs, inboxFixture, inboxStore, type InboxState } from "./helpers/inbox-fixture.js"

test("inbox narrows recipient and answer keys while preserving mixed-scope pagination", () => {
  const db = new Database(":memory:")
  try {
    const { store, queries } = inboxStore(db)
    const fixture = inboxFixture(db, store, 1000, "mixed")
    for (const state of ["open", "answered", "all"] as const) {
      expect(allInboxIDs(store, fixture.target.session_id, state, 23)).toEqual(fixture.expected[state])
      expect(store.collaboration.inbox("empty-recipient", state).items).toEqual([])
    }
    const query = queries.find(query => query.sql.includes("NOT EXISTS"))!
    const plan = db.query("EXPLAIN QUERY PLAN " + query.sql).all(...query.parameters as [number, string, number]) as { detail: string }[]
    expect(plan.some(row => row.detail.includes("ledger_question_inbox") && row.detail.includes("<expr>=?") && row.detail.includes("seq>?"))).toBe(true)
    expect(plan.some(row => row.detail.includes("ledger_answers") && row.detail.includes("action_id=?") && row.detail.includes("<expr>=?"))).toBe(true)
    expect(plan.some(row => row.detail.includes("TEMP B-TREE"))).toBe(false)
    const select = store.collaboration.inbox(fixture.target.session_id, "answered", 0, 1)
    expect(select.items[0].answer?.session_id).toBe(fixture.target.session_id)
    expect(select.items[0].answer?.statement).toBe("Answer 0")
  } finally { db.close() }
})

test("inbox answer lookup preserves null scope, Action scope, format and exact destination", () => {
  const db = new Database(":memory:"), store = new Store(db)
  try {
    const author = { session_id: "asker", agent: "general" }, target = { session_id: "target", agent: "general" }
    const action = store.create("Action", "Action", author)
    const questions = [undefined, { action_id: action.id }].map(focus => store.collaboration.ask(author, focus,
      { question: "Question?", session_id: target.session_id, blocking: false }, { expected_session: target.session_id }))
    for (const q of questions) store.append({ ...target, ...(q.action_id ? {} : { action_id: action.id }), kind: "answer",
      data: { question_id: q.id, answer: "Wrong stored scope cannot answer this question" } })
    store.append({ ...author, kind: "question", data: { format: "loom-question/v1", expected_session: target.session_id, question: "Legacy" } })
    store.collaboration.ask(author, undefined, { question: "Other recipient", session_id: "target-other", blocking: false }, { expected_session: "target-other" })
    expect(store.collaboration.inbox(target.session_id).items.map(q => q.question_id)).toEqual(questions.map(q => q.id))
    expect(store.collaboration.inbox(target.session_id, "answered").items).toEqual([])
    for (const q of questions) store.collaboration.answer(target, { question_id: q.id, answer: "Correct scope" })
    expect(store.collaboration.inbox(target.session_id).items).toEqual([])
    const answered = store.collaboration.inbox(target.session_id, "answered")
    expect(answered.items.map(q => q.question_id)).toEqual(questions.map(q => q.id))
    expect(answered.items.every(q => q.answer?.statement === "Correct scope")).toBe(true)
  } finally { db.close() }
})

test("inbox index upgrades a populated v2 database additively and survives file reopen", () => {
  const directory = mkdtempSync(join(tmpdir(), "loom-inbox-index-")), filename = join(directory, "ledger.sqlite")
  let db = new Database(filename)
  try {
    const store = new Store(db), fixture = inboxFixture(db, store, 30, "mixed")
    db.exec("DROP INDEX ledger_question_inbox") // Exact pre-index v2 schema, with production-created threads.
    const before = snapshot(db)
    db.close(); db = new Database(filename)
    for (let reopen = 0; reopen < 2; reopen++) {
      const next = new Store(db), after = snapshot(db)
      expect(after.tables).toEqual(before.tables)
      expect(after.user_version).toBe(before.user_version)
      expect(after.schema.filter(row => row.name !== "ledger_question_inbox")).toEqual(before.schema)
      expect(after.schema.filter(row => row.name === "ledger_question_inbox")).toHaveLength(1)
      for (const state of ["open", "answered", "all"] satisfies InboxState[])
        expect(allInboxIDs(next, fixture.target.session_id, state)).toEqual(fixture.expected[state])
      expect(db.query("PRAGMA integrity_check").get()).toEqual({ integrity_check: "ok" })
      expect(db.query("PRAGMA foreign_key_check").all()).toEqual([])
      if (reopen === 0) { db.close(); db = new Database(filename) }
    }
    db.exec("DROP INDEX ledger_question_inbox") // Rollback needs no data conversion.
    expect(snapshot(db)).toEqual(before)
  } finally { db.close(); rmSync(directory, { recursive: true, force: true }) }
})

test("interrupted inbox index creation rolls back schema and stored history", () => {
  const db = new Database(":memory:")
  try {
    const store = new Store(db)
    store.collaboration.ask({ session_id: "asker", agent: "general" }, undefined,
      { question: "Persist me", session_id: "target", blocking: false }, { expected_session: "target" })
    db.exec("DROP INDEX ledger_question_inbox")
    const before = snapshot(db)
    expect(() => new Store({
      prepare: sql => db.prepare(sql),
      exec: sql => {
        db.exec(sql)
        if (sql.includes("CREATE INDEX IF NOT EXISTS ledger_question_inbox")) throw new Error("interrupted index creation")
      },
    })).toThrow("interrupted index creation")
    expect(snapshot(db)).toEqual(before)
    expect(new Store(db).collaboration.inbox("target").items).toHaveLength(1)
  } finally { db.close() }
})
