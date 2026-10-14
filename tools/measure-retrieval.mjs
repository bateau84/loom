// Retrieval-only measurement: no models, tool execution, contract hashing or timing gate.
import { DatabaseSync } from 'node:sqlite'
import { performance } from 'node:perf_hooks'
import { pathToFileURL } from 'node:url'
import { resolve } from 'node:path'
const moduleURL = process.argv[2] ? pathToFileURL(resolve(process.argv[2])).href : new URL('../.test-build/store.js', import.meta.url).href
const { Store } = await import(moduleURL)
const actor = { session_id: 'fixture', agent: 'fixture' }
const reports = []
for (const history of [1000, 10000, 50000]) {
  const db = new DatabaseSync(':memory:')
  let measure = false, calls = []
  const sql = { exec: text => db.exec(text), prepare: text => {
    const statement = db.prepare(text)
    const read = (operation, params) => {
      const value = statement[operation](...params)
      if (measure) {
        const rows = Array.isArray(value) ? value : value ? [value] : []
        calls.push({ sql: text, params, rows: rows.length, bodies: rows.filter(r => typeof r.data === 'string').map(r => Buffer.byteLength(r.data)) })
      }
      return value
    }
    return { get: (...p) => read('get', p), all: (...p) => read('all', p), run: (...p) => statement.run(...p) }
  } }
  try {
    const store = new Store(sql), action = store.create('Fixture', 'Recover the prior result', actor)
    store.savePlan(action.id, 0, [{ id: 'dep', kind: 'task', title: 'Research' }, { id: 'work', kind: 'task', title: 'Worker', depends_on: ['dep'] }])
    const insert = db.prepare('INSERT INTO ledger(id,action_id,session_id,kind,data) VALUES(?,?,?,?,?)')
    const add = (id, kind, node_id) => insert.run(id, action.id, actor.session_id, kind, JSON.stringify({ id, kind, node_id, action_id: action.id, ...actor, created_at: 'fixture', data: { statement: `${id} with a retained qualification.` } }))
    db.exec('BEGIN')
    for (const scope of ['work', 'dep']) for (const kind of ['result', 'claim', 'assessment', 'qa']) for (let n = 0; n < 3; n++) add(`${scope}-${kind}-${n}`, kind, scope)
    for (let n = 0; n < 16; n++) add(`relevant-${n}`, 'observation', n % 2 ? 'work' : 'dep')
    for (let n = 0; n < history; n++) add(`noise-${n}`, 'observation', 'unrelated')
    db.exec('COMMIT')
    const read = () => store.contextSnapshot(action.id, () => store.contextRecords(action.id, ['work', 'dep']))
    for (let i = 0; i < 5; i++) read()
    const times = []
    for (let i = 0; i < 20; i++) { const start = performance.now(); read(); times.push(performance.now() - start) }
    times.sort((a, b) => a - b)
    measure = true; const result = read(); measure = false
    const ledgerReads = calls.filter(c => /\b(?:FROM|JOIN) ledger\b/i.test(c.sql))
    const queryPlans = [...new Set(ledgerReads.filter(c => /^SELECT /.test(c.sql)).flatMap(c => db.prepare('EXPLAIN QUERY PLAN ' + c.sql).all(...c.params).map(r => r.detail)))]
    reports.push({ unrelated_observations: history, median_ms: +((times[9] + times[10]) / 2).toFixed(3), max_ms: +times.at(-1).toFixed(3),
      ledger_returned_rows: ledgerReads.reduce((n,c) => n + c.rows, 0), ledger_bodies: ledgerReads.reduce((n,c) => n + c.bodies.length, 0),
      ledger_body_bytes: ledgerReads.flatMap(c => c.bodies).reduce((a,b) => a+b,0),
      selected_record_ids: [...result.conclusions, ...result.observations].map(r => r.id), query_plans: queryPlans })
  } finally { db.close() }
}
const version = new DatabaseSync(':memory:')
try {
  console.log(JSON.stringify({ node: process.version, sqlite: version.prepare('SELECT sqlite_version() AS v').get().v, platform: process.platform, arch: process.arch,
    fixture: 'two relevant Tasks; 24 conclusions; 16 relevant observations; later unrelated observations', warmups: 5, iterations: 20, reports }, null, 2))
} finally { version.close() }
