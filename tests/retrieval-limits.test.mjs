import { test } from 'node:test'
import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { Store } from '../.test-build/store.js'
import { PROCESSING_LIMITS as L } from '../.test-build/model.js'
const actor = { session_id: 's', agent: 'worker' }
function tracked(db) {
  const reads = []
  const remember = (sql, params, value) => {
    const rows = Array.isArray(value) ? value : value ? [value] : []
    reads.push({ sql, params, rows: rows.length, bodies: rows.filter(r => typeof r.data === 'string').map(r => Buffer.byteLength(r.data)) })
    return value
  }
  return { reads, sql: { exec: sql => db.exec(sql), prepare: sql => {
    const stmt = db.prepare(sql)
    return { get: (...p) => remember(sql, p, stmt.get(...p)), all: (...p) => remember(sql, p, stmt.all(...p)), run: (...p) => stmt.run(...p) }
  } } }
}
function fixture(t) {
  const db = new DatabaseSync(':memory:'); t.after(() => db.close())
  const adapter = tracked(db), store = new Store(adapter.sql)
  const action = store.create('A', 'Goal', actor)
  adapter.reads.length = 0
  return { db, store, action, ...adapter }
}
function oldRow(db, action, id, kind = 'result', node_id, text = 'Important result') {
  const value = { id, action_id: action.id, node_id, kind, ...actor, created_at: 'fixture', data: { statement: text } }
  db.prepare('INSERT INTO ledger(id,action_id,session_id,kind,data) VALUES(?,?,?,?,?)').run(id, action.id, actor.session_id, kind, JSON.stringify(value))
  return value
}
const ledgerBodies = reads => reads.filter(r => /\b(?:FROM|JOIN) ledger\b/i.test(r.sql)).flatMap(r => r.bodies)

test('oversized stored Plan never crosses the SQLite-to-JavaScript text boundary', t => {
  const { db, store, action, reads } = fixture(t)
  const body = JSON.stringify({ revision: 1, nodes: [], padding: 'x'.repeat(L.storedPlanChars * 3 + 1) })
  db.prepare('INSERT INTO plans VALUES(?,?,?)').run(action.id, 1, body)
  assert.throws(() => store.plan(action.id), /processing limit/)
  assert.deepEqual(reads.filter(r => /FROM plans\b/.test(r.sql)).flatMap(r => r.bodies), [])
  assert.equal(db.prepare('SELECT data FROM plans').get().data, body)
})

test('Plan snapshot refuses oversized text without calling its consumer', t => {
  const { db, store, action, reads } = fixture(t)
  db.prepare('INSERT INTO plans VALUES(?,?,?)').run(action.id, 1, ' '.repeat(L.storedPlanChars * 3 + 1))
  let consumed = false
  assert.throws(() => store.contextSnapshot(action.id, () => { consumed = true }), /processing limit/)
  assert.equal(consumed, false)
  assert.deepEqual(reads.filter(r => /FROM plans\b/.test(r.sql)).flatMap(r => r.bodies), [])
  assert.equal(store.savePlan(action.id, 1, []).revision, 2)
})

for (const method of ['action', 'list', 'selected']) test(`${method} guards oversized stored text before materialization`, t => {
  const { db, store, action, reads } = fixture(t)
  const big = JSON.stringify({ pad: 'x'.repeat(L.recordChars * 3 + 1) })
  if (method === 'selected') db.prepare('UPDATE focus SET data=? WHERE session_id=?').run(big, 's')
  else db.prepare('UPDATE actions SET data=? WHERE id=?').run(big, action.id)
  assert.throws(() => method === 'action' ? store.action(action.id) : method === 'list' ? store.list() : store.selected('s'), /processing limit/)
  assert.equal(reads.flatMap(r => r.bodies).length, 0)
})

test('existence-only selection check does not materialize its stored body', t => {
  const { db, store, reads } = fixture(t)
  db.prepare('UPDATE focus SET data=?').run('x'.repeat(L.recordChars * 4))
  assert.equal(store.hasSelection('s'), true)
  assert.deepEqual(reads.flatMap(r => r.bodies), [])
})

test('oversized ledger record is not fetched or silently skipped', t => {
  const { db, store, action, reads } = fixture(t)
  oldRow(db, action, 'huge', 'result', undefined, 'x'.repeat(L.recordChars * 3 + 1))
  assert.throws(() => store.records({ action_id: action.id }), /processing limit/)
  assert.deepEqual(ledgerBodies(reads), [])
  assert.throws(() => store.records({ action_id: action.id, record_id: 'huge' }), /processing limit/)
  assert.equal(db.prepare('SELECT count(*) n FROM ledger').get().n, 1)
})

test('page lookahead transfers no body and remains the next explicit page', t => {
  const { db, store, action, reads } = fixture(t)
  oldRow(db, action, 'first')
  oldRow(db, action, 'huge', 'result', undefined, 'x'.repeat(L.recordChars * 4))
  const page = store.records({ action_id: action.id, limit: 1 })
  assert.equal(page.items[0].id, 'first'); assert.notEqual(page.next_after, null)
  assert.equal(ledgerBodies(reads).length, 1)
  assert.ok(ledgerBodies(reads)[0] < 1000)
  assert.throws(() => store.records({ action_id: action.id, after: page.next_after, limit: 1 }), /processing limit/)
})

test('multi-byte records retain the existing UTF-16 admission boundary', t => {
  const { db, store, action } = fixture(t)
  const value = oldRow(db, action, 'unicode', 'result', undefined, '漢'.repeat(90000))
  assert.equal(store.records({ action_id: action.id, record_id: value.id }).items[0].data.statement, value.data.statement)
})

test('record set budget is checked before body hydration; smaller pages remain readable', t => {
  const { db, store, action, reads } = fixture(t)
  for (let i = 0; i < 20; i++) oldRow(db, action, `large-${i}`, 'result', undefined, '漢'.repeat(90000))
  assert.throws(() => store.records({ action_id: action.id, limit: 20 }), /record set.*limit|record set.*exceed/)
  assert.deepEqual(ledgerBodies(reads), [])
  const page = store.records({ action_id: action.id, limit: 2 })
  assert.deepEqual(page.items.map(r => r.id), ['large-0', 'large-1'])
  assert.equal(store.records({ action_id: action.id, after: page.next_after, limit: 2 }).items[0].id, 'large-2')
})

test('context only hydrates its final sample, not per-bucket lookahead or discarded conclusions', t => {
  const { db, store, action, reads } = fixture(t)
  const ids = Array.from({ length: 20 }, (_, i) => `t${i}`)
  const kinds = ['result', 'qa', 'assessment', 'claim']
  for (const scope of [undefined, ...ids]) for (const kind of kinds) for (let i = 0; i < 3; i++) oldRow(db, action, `${scope}-${kind}-${i}`, kind, scope)
  for (let i = 0; i < 80; i++) oldRow(db, action, `obs-${i}`, 'observation', ids[i % ids.length])
  const sample = store.contextSnapshot(action.id, () => store.contextRecords(action.id, ids))
  assert.equal(sample.conclusions.length, 48); assert.equal(sample.observations.length, 8)
  assert.equal(sample.scopes_omitted, 5); assert.equal(sample.has_more, true)
  assert.equal(ledgerBodies(reads).length, 56)
  assert.equal(sample.conclusions[0].id, 't0-result-2')
  assert.equal(sample.conclusions[1].id, 'undefined-result-2')
  assert.equal(sample.conclusions[2].id, 't1-result-2')
  assert.deepEqual(sample.observations.map(r => r.id), Array.from({ length: 8 }, (_, i) => `obs-${79-i}`))
})

test('oversized conclusion lookahead is not loaded but omission remains explicit', t => {
  const { db, store, action, reads } = fixture(t)
  oldRow(db, action, 'old-huge', 'result', 't', 'x'.repeat(L.recordChars * 4))
  oldRow(db, action, 'middle', 'result', 't'); oldRow(db, action, 'new', 'result', 't')
  const sample = store.contextRecords(action.id, ['t'])
  assert.deepEqual(sample.conclusions.map(r => r.id), ['new', 'middle'])
  assert.equal(sample.has_more, true)
  assert.equal(ledgerBodies(reads).length, 2)
  assert.throws(() => store.records({ action_id: action.id, record_id: 'old-huge' }), /processing limit/)
})

test('record_id still respects Action, Session, node and after filters', t => {
  const { db, store, action } = fixture(t)
  oldRow(db, action, 'target', 'result', 't')
  const other = store.create('B', 'Other', actor)
  assert.equal(store.records({ action_id: other.id, record_id: 'target' }).items.length, 0)
  assert.equal(store.records({ session_id: 'other', record_id: 'target' }).items.length, 0)
  assert.equal(store.records({ action_id: action.id, record_id: 'target', node_id: 'wrong' }).items.length, 0)
  assert.equal(store.records({ action_id: action.id, record_id: 'target', after: 1 }).items.length, 0)
})

test('context scope count is bounded before querying or traversing caller lists', t => {
  const { store, action, reads } = fixture(t)
  assert.throws(() => store.contextRecords(action.id, Array(301).fill('t')), /processing limit/)
  assert.equal(reads.length, 0)
})

test('selected oversized conclusion still fails context without dropping it', t => {
  const { db, store, action, reads } = fixture(t)
  oldRow(db, action, 'huge', 'qa', 't', 'x'.repeat(L.recordChars * 4))
  assert.throws(() => store.contextSnapshot(action.id, () => store.contextRecords(action.id, ['t'])), /processing limit/)
  assert.deepEqual(ledgerBodies(reads), [])
  assert.equal(store.create('Next', 'Transaction was released', actor).state, 'active')
})

test('new body growth between metadata and hydration cannot exceed its reserved size', t => {
  const { db, action } = fixture(t)
  oldRow(db, action, 'target')
  const adapter = tracked(db)
  let changed = false
  const sql = { exec: q => adapter.sql.exec(q), prepare: q => {
    const stmt = adapter.sql.prepare(q)
    return { ...stmt, all: (...p) => {
      const rows = stmt.all(...p)
      if (!changed && /SELECT seq,octet_length\(data\).* FROM ledger/.test(q)) {
        changed = true
        const value = { id: 'target', action_id: action.id, kind: 'result', ...actor, data: { statement: 'x'.repeat(L.recordChars * 4) } }
        db.prepare('UPDATE ledger SET data=? WHERE id=?').run(JSON.stringify(value), 'target')
      }
      return rows
    } }
  } }
  const store = new Store(sql)
  assert.throws(() => store.records({ action_id: action.id }), /processing limit/)
  assert.equal(changed, true)
  assert.deepEqual(ledgerBodies(adapter.reads), [])
})

test('context hydration retains its snapshot across a writer between metadata and bodies', t => {
  // A file-backed competing writer tests the actual snapshot, not a planted result.
  const dir = mkdtempSync(join(tmpdir(), 'loom-hydration-snapshot-'))
  const path = join(dir, 'db'), first = new DatabaseSync(path), second = new DatabaseSync(path)
  t.after(() => { first.close(); second.close(); rmSync(dir, { recursive: true, force: true }) })
  const writer = new Store(second), action = writer.create('A', 'Old goal', actor)
  const initial = writer.record(actor, { action_id: action.id }, { kind: 'result', statement: 'Before snapshot' })
  let changed = false
  const reader = new Store({ exec: sql => first.exec(sql), prepare: sql => {
    const stmt = first.prepare(sql)
    return { get: (...p) => stmt.get(...p), run: (...p) => stmt.run(...p), all: (...p) => {
      const rows = stmt.all(...p)
      if (!changed && /SELECT seq,octet_length\(data\).* FROM ledger/.test(sql)) {
        changed = true
        writer.record(actor, { action_id: action.id }, { kind: 'result', statement: 'After snapshot' })
        writer.update(action.id, 1, { goal: 'New goal' })
      }
      return rows
    } }
  } })
  const value = reader.contextSnapshot(action.id, a => ({ goal: a.goal, sample: reader.contextRecords(action.id) }))
  assert.equal(changed, true); assert.equal(value.goal, 'Old goal')
  assert.deepEqual(value.sample.conclusions.map(r => r.id), [initial.id])
  assert.equal(reader.contextRecords(action.id).conclusions.length, 2)
})

test('metadata lookups use ordered scope indexes instead of scanning unrelated history', t => {
  const { db, store, action, reads } = fixture(t)
  oldRow(db, action, 'target', 'observation', 't')
  db.exec('BEGIN')
  for (let i = 0; i < 2000; i++) oldRow(db, action, `noise-${i}`, 'claim', 'unrelated')
  db.exec('COMMIT')
  reads.length = 0
  assert.equal(store.contextRecords(action.id, ['t']).observations[0].id, 'target')
  assert.equal(store.records({ action_id: action.id, node_id: 't' }).items[0].id, 'target')
  assert.equal(store.records({ session_id: 's', node_id: 't' }).items[0].id, 'target')
  const metadata = reads.filter(r => /^SELECT seq,octet_length/.test(r.sql))
  assert.ok(metadata.length > 0)
  for (const r of metadata) {
    const plan = db.prepare('EXPLAIN QUERY PLAN ' + r.sql).all(...r.params).map(x => x.detail).join('\n')
    assert.match(plan, /SEARCH ledger USING INDEX/)
    assert.doesNotMatch(plan, /SCAN ledger|TEMP B-TREE/)
    assert.ok(r.rows <= 51)
  }
})

test('observation merge retains unscoped rows and matches global top eight across all relevant scopes', t => {
  const { db, store, action } = fixture(t)
  for (let i = 0; i < 100; i++) oldRow(db, action, `obs-${i}`, 'observation', i % 3 === 0 ? undefined : i % 3 === 1 ? 'local' : 'upstream')
  for (let i = 0; i < 100; i++) oldRow(db, action, `ignored-${i}`, 'observation', 'unrelated')
  const value = store.contextRecords(action.id, ['local', 'upstream', 'local'])
  assert.deepEqual(value.observations.map(r => r.id), Array.from({ length: 8 }, (_, i) => `obs-${99-i}`))
  assert.equal(value.has_more, true)
  const all = store.contextRecords(action.id)
  assert.deepEqual(all.observations.map(r => r.id), Array.from({ length: 8 }, (_, i) => `ignored-${99-i}`))
})

test('existing databases gain retrieval indexes without changing recorded bytes', t => {
  const { db, store, action } = fixture(t)
  oldRow(db, action, 'historical')
  const bytes = db.prepare('SELECT data FROM ledger').get().data
  for (const name of ['ledger_action_node', 'ledger_session_node', 'ledger_observation_action', 'ledger_observation_scope']) db.exec(`DROP INDEX IF EXISTS ${name}`)
  new Store(db)
  const indexes = db.prepare("SELECT name FROM sqlite_schema WHERE type='index'").all().map(r => r.name)
  for (const name of ['ledger_action_node', 'ledger_session_node', 'ledger_observation_action', 'ledger_observation_scope']) assert.ok(indexes.includes(name))
  assert.equal(db.prepare('SELECT data FROM ledger').get().data, bytes)
  assert.equal(db.prepare('PRAGMA user_version').get().user_version, 1)
  assert.equal(store.records({ action_id: action.id }).items[0].id, 'historical')
})
