import { test, expect } from "bun:test"
import { Database } from "bun:sqlite"
import { readFileSync } from "node:fs"
import { Store } from "../src/store.js"
import type { HistoryQuery, HistoryRecord } from "../src/history.js"
import { hydrate, snapshot, populate, type Snapshot } from "./fixtures/baseline-c9ffcfa/oracle.js"

function rows(db: Database): HistoryRecord[] {
  return (db.query("SELECT seq,data FROM ledger ORDER BY seq").all() as { seq: number; data: string }[])
    .map(row => ({ sequence: row.seq, ...JSON.parse(row.data) }))
}
// Independent in-memory enumeration over complete raw fixture input, not the
// selector's SQL, sampled context, delivery projection or returned memberships.
function expected(all: HistoryRecord[], scope: HistoryQuery) {
  const owned = (r: HistoryRecord) => scope.session_id !== undefined ? r.session_id === scope.session_id
    : r.action_id === scope.action_id && (scope.node_id === undefined || r.node_id === scope.node_id)
  const same = (a: HistoryRecord, q: HistoryRecord) => a.action_id === q.action_id && a.node_id === q.node_id
  const included = new Set(all.filter(owned).map(r => r.id))
  for (const q of all.filter(r => r.kind === "question")) {
    const answers = all.filter(a => a.kind === "answer" && a.data.question_id === q.id && same(a, q))
    if (owned(q) || answers.some(owned)) for (const r of [q, ...answers]) included.add(r.id)
  }
  return all.filter(r => included.has(r.id))
}
function traverse(store: Store, query: HistoryQuery) {
  const result: HistoryRecord[] = []
  let cursor: string | null = null
  do {
    const page = store.history.read({ ...query, ...(cursor ? { cursor } : {}) })
    expect(page.offset).toBe(0)
    result.push(...page.items); cursor = page.next_cursor
  } while (cursor)
  expect(new Set(result.map(r => r.id)).size).toBe(result.length)
  return result
}

test("frozen populated historical history is complete, attributed and unchanged across read/restart", () => {
  const db = new Database(":memory:")
  try {
    const frozen = JSON.parse(readFileSync(new URL("./fixtures/baseline-c9ffcfa/snapshot.json", import.meta.url), "utf8")) as Snapshot
    hydrate(db, frozen)
    const all = rows(db), sessions = [...new Set(all.map(r => r.session_id))]
    const actions = [...new Set(all.flatMap(r => r.action_id === undefined ? [] : [r.action_id]))]
    expect(all).toHaveLength(44)
    for (let restart = 0; restart < 2; restart++) {
      const store = new Store(db)
      for (const session_id of [...sessions, "researcher", "unrelated-same-agent-session"]) {
        const scope = { session_id }
        expect(traverse(store, { ...scope, limit: 2 })).toEqual(expected(all, scope))
      }
      for (const action_id of actions) {
        expect(traverse(store, { action_id, limit: 3 })).toEqual(expected(all, { action_id }))
        for (const node_id of ["work", "research", "removed", "reopened", "absent"]) {
          const scope = { action_id, node_id }
          expect(traverse(store, { ...scope, limit: 1 })).toEqual(expected(all, scope))
        }
      }
      const primary = traverse(store, { session_id: "synthetic-primary" })
      // Assignments and positive/uncertain/stored notices are not addressing of
      // their original questions. Primary only authored the no-Plan question.
      expect(primary.filter(r => r.kind === "question")).toHaveLength(1)
      expect(primary.some(r => r.kind === "answer")).toBe(false)
      expect(snapshot(db)).toEqual(frozen)
    }
  } finally { db.close() }
})

test("frozen producer plus real new unscoped and historical answers match an independent membership oracle", () => {
  const db = new Database(":memory:")
  try {
    const old = populate(db), store = new Store(db)
    const actor = (session_id: string) => ({ session_id, agent: "researcher" })
    const q = store.collaboration.ask(actor("new-session"), undefined, { question: "No Action required", to_agent: "researcher", blocking: false })
    store.collaboration.answer(actor("other-author"), { question_id: q.id, answer: "Earlier answer" })
    store.collaboration.answer(actor("synthetic-primary"), { question_id: q.id, answer: "Primary answers without selecting" })
    store.collaboration.answer(actor("later-author"), { question_id: q.id, answer: "Later answer", context_attachments: ["fixture://pointer-only"] })
    const legacyAnswer = store.collaboration.answer(actor("synthetic-primary"), { question_id: old.question.id, answer: "Now an actual answer relationship" })
    expect(legacyAnswer.resume).toBeUndefined()
    const unrelated = store.collaboration.ask(actor("unrelated"), undefined, { question: "Not a reference expansion", to_agent: "researcher", blocking: false })
    store.observe(actor("new-session"), undefined, { question_id: unrelated.id, tool: "ordinary authored metadata", input_digest: "not a raw body" })
    const all = rows(db), before = snapshot(db)
    for (const session_id of ["new-session", "synthetic-primary", "synthetic-worker", "synthetic-research-a", "later-author", "researcher", "no-session"]) {
      for (const limit of [1, 20, 50]) expect(traverse(store, { session_id, limit })).toEqual(expected(all, { session_id }))
    }
    for (const scope of [{ action_id: old.action.id }, { action_id: old.action.id, node_id: "removed" }, { action_id: old.noPlan.id }]) {
      expect(traverse(store, { ...scope, limit: 2 })).toEqual(expected(all, scope))
      expect(traverse(store, scope).some(r => r.id === q.id)).toBe(false)
    }
    const primary = traverse(store, { session_id: "synthetic-primary" })
    expect(primary.filter(r => r.kind === "answer" && r.data.question_id === old.question.id)).toHaveLength(7)
    expect(primary.find(r => r.id === q.id)?.action_id).toBeUndefined()
    expect(primary.find(r => r.id === old.question.id)?.session_id).toBe("synthetic-worker")
    expect(snapshot(db)).toEqual(before)
  } finally { db.close() }
})
