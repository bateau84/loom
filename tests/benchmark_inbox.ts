// Run explicitly: bun tests/benchmark_inbox.ts > /tmp/loom-inbox-benchmark.json
// No wall-clock CI assertions. Native tests check results, access paths and upgrade safety.
import { strict as assert } from "node:assert"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Database, type SQLQueryBindings } from "bun:sqlite"
import { Store } from "../src/store.js"
import { allInboxIDs, inboxFixture, inboxStore, type CapturedQuery, type InboxScope, type InboxState } from "./helpers/inbox-fixture.js"

const repetitions = 7
const measure = (run: () => unknown) => {
  run() // warm-up, no OS/shared cache eviction
  const milliseconds: number[] = []
  for (let i = 0; i < repetitions; i++) {
    const started = performance.now(); run(); milliseconds.push(performance.now() - started)
  }
  const sorted = [...milliseconds].sort((a, b) => a - b)
  return { median_ms: sorted[Math.floor(sorted.length / 2)], min_ms: sorted[0], max_ms: sorted.at(-1), samples_ms: milliseconds }
}
const root = mkdtempSync(join(tmpdir(), "loom-inbox-benchmark-"))
const reports: unknown[] = []
let environment: Record<string, unknown> | undefined
try {
  for (const scope of ["action", "session"] satisfies InboxScope[]) for (const history of [1000, 50000]) {
    const db = new Database(join(root, `${scope}-${history}.sqlite`))
    try {
      const { store, queries } = inboxStore(db), fixture = inboxFixture(db, store, history, scope)
      environment ??= {
        bun: Bun.version, platform: process.platform, arch: process.arch,
        sqlite: db.query("SELECT sqlite_version() AS version, sqlite_source_id() AS source_id").get(),
        compile_options: db.query("PRAGMA compile_options").all(),
        journal_mode: db.query("PRAGMA journal_mode").get(), synchronous: db.query("PRAGMA synchronous").get(),
        cache_size: db.query("PRAGMA cache_size").get(), page_size: db.query("PRAGMA page_size").get(),
      }
      const cases: Array<{ name: string; state: InboxState; recipient: string; after: number; query: CapturedQuery }> = []
      for (const state of ["open", "answered", "all"] as const) {
        for (const recipient of [fixture.target.session_id, "empty-recipient"]) {
          const page = store.collaboration.inbox(recipient, state, 0, 50)
          cases.push({ name: recipient === fixture.target.session_id ? state : `empty-${state}`, state, recipient, after: 0, query: queries.at(-1)! })
          if (page.next_after !== null) {
            store.collaboration.inbox(recipient, state, page.next_after, 50)
            cases.push({ name: `${state}-page-2`, state, recipient, after: page.next_after, query: queries.at(-1)! })
          }
        }
      }
      // This reproduces the reviewed head's candidate SQL and its exact lack of
      // destination index; all remaining indexes and stored bytes stay the same.
      const index = db.query("SELECT sql FROM sqlite_schema WHERE name='ledger_question_inbox'").get() as { sql: string }
      db.exec("DROP INDEX ledger_question_inbox")
      const runCandidates = (sql: string, parameters: unknown[]) => {
        const statement = db.query(sql), bindings = parameters as SQLQueryBindings[]
        const rows = statement.all(...bindings)
        const timing = measure(() => assert.deepEqual(statement.all(...bindings), rows))
        statement.finalize()
        return { rows, timing }
      }
      const baseline = cases.map(c => {
        const sql = c.query.sql.replace(" IN (q.id)", "=q.id")
        return { ...runCandidates(sql, c.query.parameters), plan: db.query("EXPLAIN QUERY PLAN " + sql).all(...c.query.parameters as SQLQueryBindings[]) }
      })
      const started = performance.now()
      new Store(db) // Real additive startup path, including transaction commit.
      const index_creation_ms = performance.now() - started
      assert.equal((db.query("SELECT sql FROM sqlite_schema WHERE name='ledger_question_inbox'").get() as { sql: string }).sql, index.sql)
      const comparisons = cases.map((c, i) => {
        const revised = runCandidates(c.query.sql, c.query.parameters)
        assert.deepEqual(revised.rows, baseline[i].rows)
        return { name: c.name, candidate_count: revised.rows.length, before: baseline[i].timing, after: revised.timing,
          before_plan: baseline[i].plan, after_plan: db.query("EXPLAIN QUERY PLAN " + c.query.sql).all(...c.query.parameters as SQLQueryBindings[]) }
      })
      const end_to_end = cases.map(c => ({ name: c.name, ...measure(() => {
        const page = store.collaboration.inbox(c.recipient, c.state, c.after, 50)
        assert.equal(page.items.length, Math.min(50, comparisons.find(result => result.name === c.name)!.candidate_count))
      }) }))
      for (const state of ["open", "answered", "all"] as const) {
        assert.deepEqual(allInboxIDs(store, fixture.target.session_id, state), fixture.expected[state])
        assert.deepEqual(allInboxIDs(store, "empty-recipient", state), [])
      }
      const index_pages = db.query("SELECT COUNT(*) AS pages,SUM(pgsize) AS bytes FROM dbstat WHERE name='ledger_question_inbox'").get()
      reports.push({ scope, unrelated_questions: history, unrelated_answers: history, target_questions: fixture.expected.all.length,
        target_open: fixture.expected.open.length, target_answered: fixture.expected.answered.length,
        index_creation_ms, index_pages, comparisons, end_to_end,
        correctness: "Every candidate row matches baseline; all pages equal independently retained producer IDs, without gaps or duplicates." })
    } finally { db.close() }
  }
  console.log(JSON.stringify({ environment, methodology: {
    repetitions, warmup: 1, measurement: "Fully consumed candidates (both revisions) and revised production inbox including full answer summaries.",
    storage: "Disposable file-backed WAL databases; one sequential process, default SQLite cache; synthetic unrelated threads precede target threads.",
    limits: "Local warm-cache qualification, not a cold-disk, concurrent-writer, percentile, host scheduling or global inbox latency guarantee.",
  }, reports }, null, 2))
} finally { rmSync(root, { recursive: true, force: true }) }
