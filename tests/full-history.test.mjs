import { test } from 'node:test'
import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Store } from '../.test-build/store.js'

const actor = session_id => ({ session_id, agent: 'same-agent' })
function fixture(t) {
  const db = new DatabaseSync(':memory:'); t.after(() => db.close())
  const store = new Store(db)
  const ask = (session, focus) => store.collaboration.ask(actor(session), focus, { question: 'Question?', to_agent: 'same-agent', blocking: false })
  const answer = (session, q) => store.collaboration.answer(actor(session), { question_id: q.id, answer: 'Answer by ' + session }).record
  return { db, store, ask, answer }
}
const ids = page => page.items.map(r => r.id)

test('Session history follows authored questions and answers, not advisory agent names', t => {
  const { store, ask, answer } = fixture(t)
  const q = ask('S'), first = answer('earlier', q), own = answer('S', q), later = answer('later', q)
  const other = ask('other'), before = answer('before', other), mine = answer('S', other), last = answer('last', other)
  const unrelated = ask('same-agent-other-session'); answer('someone', unrelated)
  const ordinary = store.observe(actor('S'), undefined, { tool: 'ordinary', question_id: unrelated.id })
  const expected = [q, first, own, later, other, before, mine, last, ordinary]
  const result = store.history.read({ session_id: 'S' })
  assert.deepEqual(ids(result), expected.map(r => r.id))
  assert.deepEqual(result.items.map(r => r.session_id), expected.map(r => r.session_id))
  assert.equal(result.next_cursor, null)
  assert.equal(store.selected('S'), undefined)
})

test('Action and exact removed-node history never widen to other work or unscoped conversations', t => {
  const { store, ask, answer } = fixture(t)
  const a = store.create('A', 'Goal', actor('owner')), b = store.create('B', 'Other', actor('owner'))
  store.savePlan(a.id, 0, [{ id: 'removed', kind: 'task', title: 'Old work' }, { id: 'other', kind: 'task', title: 'Other work' }])
  const scope = { action_id: a.id, node_id: 'removed' }
  const q = ask('owner', scope), reply = answer('different', q)
  const observation = store.observe(actor('captured'), scope, { tool: 'real metadata', question_id: q.id })
  const otherQ = ask('owner', { action_id: a.id, node_id: 'other' }), otherReply = answer('different', otherQ)
  const actionQ = ask('owner', { action_id: a.id }), actionReply = answer('different', actionQ)
  const unscoped = ask('owner'); answer('different', unscoped)
  const foreign = ask('owner', { action_id: b.id }); answer('different', foreign)
  store.savePlan(a.id, 1, [])
  assert.deepEqual(ids(store.history.read(scope)), [q, reply, observation].map(r => r.id))
  assert.deepEqual(ids(store.history.read({ action_id: a.id })), [q, reply, observation, otherQ, otherReply, actionQ, actionReply].map(r => r.id))
  assert.deepEqual(store.history.read({ action_id: a.id, node_id: 'never-existed' }).items, [])
  assert.throws(() => store.history.read({ action_id: 'missing' }), /Unknown Action/)
})

test('legacy notices, assignments, arbitrary references and inconsistent links never seed conversations', t => {
  const { store, ask, answer } = fixture(t)
  const a = store.create('A', 'Goal', actor('creator')), b = store.create('B', 'Other', actor('creator'))
  const scope = { action_id: a.id }
  const append = (kind, data, focus = scope) => store.append({ ...actor('S'), ...focus, kind, data })
  const q = ask('someone-else', scope), early = answer('earlier', q), late = answer('later', q)
  const notices = ['not-attempted', 'failed', 'admitted'].flatMap(phase => {
    const intent = append('delivery-intent', { destination_session_id: 'S', question_id: q.id, answer_id: early.id, transport: phase })
    const event = append('delivery-event', { intent_id: intent.id, phase, question_id: q.id })
    return [intent, event]
  })
  const assignment = append('assignment', { worker_session_id: 'S', primary_session_id: 'S', question_id: q.id })
  const arbitrary = append('result', { statement: 'See question', question_id: q.id, artifact_refs: [late.id], evidence_ids: [early.id] })
  const cross = append('answer', { question_id: q.id, statement: 'Inconsistent Action association' }, { action_id: b.id })
  const crossNode = append('answer', { question_id: q.id, statement: 'Inconsistent node association' }, { ...scope, node_id: 'different' })
  const expected = [...notices, assignment, arbitrary, cross, crossNode]
  assert.deepEqual(ids(store.history.read({ session_id: 'S' })), expected.map(r => r.id))
  assert.deepEqual(ids(store.history.read({ session_id: 'no-session' })), [])
  // Targeted delivery records authored by another Session also do not qualify S.
  store.append({ ...actor('SYSTEM'), ...scope, kind: 'delivery-intent', data: { destination_session_id: 'no-session', question_id: q.id } })
  assert.deepEqual(ids(store.history.read({ session_id: 'no-session' })), [])
  assert.deepEqual(ids(store.history.read({ action_id: b.id })), [cross.id])
})

test('unchanged history traverses once in ascending sequence across boundaries and preserves full content', t => {
  const { db, store, ask, answer } = fixture(t)
  const q = ask('other'), expected = [q]
  for (let i = 0; i < 53; i++) expected.push(answer(i === 24 ? 'S' : 'author-' + i, q))
  const full = '😀 漢字 <tag> & *markdown* \\ newline\n'.repeat(1000)
  const ordinary = store.observe(actor('S'), undefined, { full, artifact_refs: [q.id], input_digest: 'factual' })
  expected.push(ordinary)
  const raw = db.prepare('SELECT seq,data FROM ledger ORDER BY seq').all()
  for (const limit of [1, 2, 20, 50]) {
    let cursor, actual = [], pages = 0
    do {
      const page = store.history.read({ session_id: 'S', limit, ...(cursor ? { cursor } : {}) })
      actual.push(...page.items); cursor = page.next_cursor; pages++
    } while (cursor)
    assert.equal(pages, Math.ceil(expected.length / limit))
    assert.deepEqual(actual.map(r => r.id), expected.map(r => r.id))
    assert.equal(new Set(actual.map(r => r.id)).size, expected.length)
    assert.deepEqual(actual, raw.map(r => ({ sequence: r.seq, ...JSON.parse(r.data) })))
    assert.equal(actual.at(-1).data.full, full)
  }
  assert.equal(store.history.read({ session_id: 'S' }).items.length, 20)
})

test('scope/location/version bound cursors fail explicitly; unchanged file-store reopen remains readable', t => {
  const { store, ask, answer } = fixture(t)
  const q = ask('S'), reply = answer('other', q)
  const first = store.history.read({ session_id: 'S', limit: 1 }), cursor = first.next_cursor
  assert.ok(cursor)
  const mutate = patch => Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(cursor, 'base64url').toString()), ...patch })).toString('base64url')
  for (const value of ['', '***', 'a'.repeat(5000), mutate({ version: 'future' }), mutate({ after: -1 }), mutate({ after: 0.5 }), mutate({ unexpected: true }), mutate({ part: {} })])
    assert.throws(() => store.history.read({ session_id: 'S', cursor: value }), /cursor/)
  assert.throws(() => store.history.read({ session_id: 'other', cursor }), /cursor/)
  assert.throws(() => store.history.read({ session_id: 'S', cursor: null }), /cursor/)
  const otherDB = new DatabaseSync(':memory:'); t.after(() => otherDB.close())
  assert.throws(() => new Store(otherDB).history.read({ session_id: 'S', cursor }), /cursor/)
  assert.deepEqual(ids(new Store(store.captureScope()).history.read({ session_id: 'S', cursor })), [reply.id])
  const a = store.create('A', 'Goal', actor('creator'))
  store.savePlan(a.id, 0, [{ id: 'one', kind: 'task', title: 'One' }, { id: 'two', kind: 'task', title: 'Two' }])
  const n = { action_id: a.id, node_id: 'one' }, nodeQ = ask('S', n); answer('S', nodeQ)
  const nodeCursor = store.history.read({ ...n, limit: 1 }).next_cursor
  assert.throws(() => store.history.read({ action_id: a.id, cursor: nodeCursor }), /cursor/)
  assert.throws(() => store.history.read({ action_id: a.id, node_id: 'two', cursor: nodeCursor }), /cursor/)
  store.savePlan(a.id, 1, [])
  assert.equal(store.history.read({ ...n, cursor: nodeCursor }).items.length, 1)
  const directory = mkdtempSync(join(tmpdir(), 'history-reopen-')); t.after(() => rmSync(directory, { recursive: true, force: true }))
  const path = join(directory, 'store.sqlite'), fileDB = new DatabaseSync(path), fileStore = new Store(fileDB)
  const fq = fileStore.collaboration.ask(actor('file'), undefined, { question: 'File?', to_agent: 'other', blocking: false })
  const fa = fileStore.collaboration.answer(actor('other'), { question_id: fq.id, answer: 'Yes' }).record
  const savedCursor = fileStore.history.read({ session_id: 'file', limit: 1 }).next_cursor
  fileDB.close()
  const reopened = new DatabaseSync(path); t.after(() => reopened.close())
  assert.deepEqual(ids(new Store(reopened).history.read({ session_id: 'file', cursor: savedCursor })), [fa.id])
})

test('partial-record continuation repeats the same record until final advancement; changes fail without advancement', t => {
  const { db, store, ask, answer } = fixture(t)
  const q = ask('S'), a = answer('other', q), b = answer('later', q)
  const first = store.history.read({ session_id: 'S', limit: 1 })
  const partial = first.cursorWithin(q.id, 37)
  const part = store.history.read({ session_id: 'S', cursor: partial, limit: 1 })
  assert.deepEqual(ids(part), [q.id]); assert.equal(part.offset, 37)
  assert.equal(part.cursorWithin(q.id, 37), partial)
  assert.throws(() => part.cursorWithin(q.id, -1), /offset/)
  assert.throws(() => part.cursorAfter('not-on-page'), /record on this/)
  const rest = store.history.read({ session_id: 'S', cursor: part.cursorAfter(q.id) })
  assert.deepEqual(ids(rest), [a.id, b.id]); assert.equal(rest.offset, 0)
  const middle = rest.cursorWithin(b.id, 99)
  assert.deepEqual(ids(store.history.read({ session_id: 'S', cursor: middle })), [b.id])
  assert.equal(store.history.read({ session_id: 'S', cursor: rest.cursorAfter(b.id) }).next_cursor, null)
  // Same-user corruption is fault input, not a product-generated success fixture.
  db.prepare("UPDATE ledger SET data=json_set(data,'$.data.question','changed') WHERE id=?").run(q.id)
  assert.throws(() => store.history.read({ session_id: 'S', cursor: partial }), /changed.*cursor not advanced/)
  db.prepare('DELETE FROM ledger WHERE id=?').run(b.id)
  assert.throws(() => store.history.read({ session_id: 'S', cursor: middle }), /changed.*cursor not advanced/)
})

test('large admissible Unicode records retain full content through partial-position handoff', t => {
  const { store } = fixture(t)
  const full = '雪🙂<&'.repeat(20000)
  const large = store.observe(actor('S'), undefined, { text: full })
  const next = store.observe(actor('S'), undefined, { tool: 'next' })
  const first = store.history.read({ session_id: 'S', limit: 1 })
  assert.equal(first.items[0].data.text, full)
  const resumed = store.history.read({ session_id: 'S', cursor: first.cursorWithin(large.id, 10000), limit: 1 })
  assert.deepEqual(ids(resumed), [large.id]); assert.equal(resumed.offset, 10000)
  assert.equal(resumed.items[0].data.text, full)
  assert.deepEqual(ids(store.history.read({ session_id: 'S', cursor: resumed.cursorAfter(large.id) })), [next.id])
})

test('query validation uses explicit scope, never selection, and read traversal leaves state unchanged', t => {
  const { db, store, ask, answer } = fixture(t)
  const a = store.create('A', 'Goal', actor('S')), q = ask('S'); answer('other', q)
  for (const query of [{}, { node_id: 'x' }, { session_id: 'S', action_id: a.id }, { session_id: 'S', node_id: 'x' }, { session_id: '' },
    { action_id: null }, { session_id: 'S', after: 1 }, ...[0, 51, -1, 1.5, '1', null].map(limit => ({ session_id: 'S', limit }))])
    assert.throws(() => store.history.read(query))
  const before = { schema: db.prepare('SELECT * FROM sqlite_schema ORDER BY name').all(), focus: db.prepare('SELECT * FROM focus').all(), ledger: db.prepare('SELECT * FROM ledger').all() }
  const changes = db.prepare('SELECT total_changes() AS n').get().n
  let cursor
  do { cursor = store.history.read({ session_id: 'S', limit: 1, ...(cursor ? { cursor } : {}) }).next_cursor } while (cursor)
  assert.deepEqual(store.history.read({ action_id: a.id }).items, [])
  assert.deepEqual({ schema: db.prepare('SELECT * FROM sqlite_schema ORDER BY name').all(), focus: db.prepare('SELECT * FROM focus').all(), ledger: db.prepare('SELECT * FROM ledger').all() }, before)
  assert.equal(db.prepare('SELECT total_changes() AS n').get().n, changes)
  assert.deepEqual(store.selected('S'), { action_id: a.id })
})

test('hydration budgets reject oversized rows and sets before materializing bodies; retry uses the same position', t => {
  const db = new DatabaseSync(':memory:'); t.after(() => db.close())
  let bodyLoads = 0
  const wrapper = {
    exec: sql => db.exec(sql),
    prepare: sql => {
      const statement = db.prepare(sql)
      return { get: (...args) => statement.get(...args), run: (...args) => statement.run(...args), all: (...args) => {
        if (sql.includes('WITH wanted(seq,max_bytes)')) bodyLoads++
        return statement.all(...args)
      } }
    },
  }
  const store = new Store(wrapper)
  const first = store.observe(actor('S'), undefined, { tool: 'first' })
  for (let i = 0; i < 16; i++) store.observe(actor('S'), undefined, { text: '漢'.repeat(100000), index: i })
  const cursor = store.history.read({ session_id: 'S', limit: 1 }).next_cursor
  bodyLoads = 0
  assert.throws(() => store.history.read({ session_id: 'S', cursor }), /record set exceeds 4194304/)
  assert.equal(bodyLoads, 0)
  const retry = store.history.read({ session_id: 'S', cursor, limit: 10 })
  assert.equal(retry.items.length, 10); assert.equal(retry.items[0].data.index, 0)
  assert.equal(store.history.read({ session_id: 'S', cursor: retry.next_cursor, limit: 10 }).items.length, 6)
  const original = db.prepare('SELECT data FROM ledger WHERE id=?').get(first.id).data
  db.prepare("UPDATE ledger SET data=json_set(data,'$.data.tool',?) WHERE id=?").run('a'.repeat(400000), first.id)
  bodyLoads = 0
  assert.throws(() => store.history.read({ session_id: 'S', limit: 1 }), /byte allowance/)
  assert.equal(bodyLoads, 0)
  db.prepare('UPDATE ledger SET data=? WHERE id=?').run(original, first.id)
  assert.deepEqual(ids(store.history.read({ session_id: 'S', limit: 1 })), [first.id])
})

test('corrupt or unsupported stored records never produce a continuation or rewrite history', t => {
  const { db, store, ask, answer } = fixture(t)
  const q = ask('S'), a = answer('S', q)
  const page = store.history.read({ session_id: 'S', limit: 1 }), cursor = page.next_cursor
  const raw = db.prepare('SELECT data FROM ledger WHERE id=?').get(a.id).data
  for (const patch of [{ id: 'wrong' }, { agent: null }, { data: [] }, { sequence: 999 }, { session_id: 'wrong' }, { created_at: null }]) {
    const corrupted = JSON.stringify({ ...JSON.parse(raw), ...patch })
    db.prepare('UPDATE ledger SET data=? WHERE id=?').run(corrupted, a.id)
    assert.throws(() => store.history.read({ session_id: 'S', cursor }), /Corrupt or unsupported/)
    assert.equal(db.prepare('SELECT data FROM ledger WHERE id=?').get(a.id).data, corrupted)
  }
  db.prepare('UPDATE ledger SET data=? WHERE id=?').run(raw, a.id)
  assert.deepEqual(ids(store.history.read({ session_id: 'S', cursor })), [a.id])
  // Malformed JSON cannot normally pass SQLite expression indexes. Drop only
  // ledger expression indexes in this disposable corruption fixture to model it.
  const indexes = db.prepare("SELECT name,sql FROM sqlite_schema WHERE type='index' AND tbl_name='ledger'").all()
  for (const index of indexes) if (index.sql?.includes('json_extract')) db.exec(`DROP INDEX ${index.name}`)
  db.prepare('UPDATE ledger SET data=? WHERE id=?').run('{broken', a.id)
  assert.throws(() => store.history.read({ session_id: 'S', cursor }), /malformed JSON/)
  assert.equal(db.prepare('SELECT data FROM ledger WHERE id=?').get(a.id).data, '{broken')
})
