import type { Database } from "bun:sqlite"
import { Store, type SQL } from "../../src/store.js"

export type InboxState = "open" | "answered" | "all"
export type InboxScope = "action" | "session" | "mixed"
export type CapturedQuery = { sql: string; parameters: unknown[] }

/** Observe the real candidate statement without replacing the store or driver. */
export function inboxStore(db: Database) {
  const queries: CapturedQuery[] = []
  const connection: SQL = {
    exec: sql => db.exec(sql),
    prepare: sql => {
      const statement = db.prepare(sql)
      return {
        get: (...parameters) => statement.get(...parameters),
        run: (...parameters) => statement.run(...parameters),
        all: (...parameters) => {
          if (sql.startsWith("SELECT q.seq,octet_length(q.data) AS data_bytes FROM ledger q"))
            queries.push({ sql, parameters })
          return statement.all(...parameters)
        },
      }
    },
  }
  return { store: new Store(connection), queries }
}

/** Synthetic load is appended in one transaction. Target threads use public
 * Collaboration.ask/answer so pagination expectations come from real producers. */
export function inboxFixture(db: Database, store: Store, history: number, scope: InboxScope) {
  const author = { session_id: "fixture-asker", agent: "general" }
  const target = { session_id: "fixture-recipient", agent: "general" }
  const actions = [store.create("First", "First Action", author), store.create("Second", "Second Action", author)]
  const association = (i: number) => scope === "session" || scope === "mixed" && i % 3 === 0
    ? undefined : { action_id: actions[scope === "mixed" ? i % 2 : 0].id }
  db.transaction(() => {
    for (let i = 0; i < history; i++) {
      const linked = association(i)
      const q = store.append({ ...author, ...linked, kind: "question", data: {
        format: "loom-question/v2", expected_session: "unrelated-recipient", question: `Unrelated ${i}`, blocking: false,
      } })
      store.append({ session_id: "unrelated-recipient", agent: "general", ...linked, kind: "answer",
        data: { format: "loom-answer/v2", question_id: q.id, answer: "Unrelated answer" } })
    }
  })()
  const expected: Record<InboxState, string[]> = { all: [], open: [], answered: [] }
  for (let i = 0; i < 155; i++) {
    const q = store.collaboration.ask(author, association(i), {
      question: `Target ${i}`, session_id: target.session_id, blocking: false,
    }, { expected_session: target.session_id })
    expected.all.push(q.id)
    if (i % 2 === 0) {
      store.collaboration.answer(target, { question_id: q.id, answer: `Answer ${i}` })
      expected.answered.push(q.id)
    } else expected.open.push(q.id)
  }
  return { expected, target, actions }
}

export function allInboxIDs(store: Store, session: string, state: InboxState, limit = 50) {
  const ids: string[] = []
  let after = 0
  while (true) {
    const page = store.collaboration.inbox(session, state, after, limit)
    ids.push(...page.items.map(item => item.question_id))
    if (page.next_after === null) return ids
    if (page.next_after <= after) throw new Error("Inbox cursor did not advance")
    after = page.next_after
  }
}
