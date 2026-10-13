import { test } from 'node:test'
import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { Store } from '../.test-build/store.js'
import { Observer } from '../.test-build/context.js'
import { digest } from '../.test-build/model.js'

const actor = { session_id: 'session-a', agent: 'engineer' }
const call = (extra = {}) => ({ sessionID: actor.session_id, agent: actor.agent, messageID: 'message', id: 'outer-code-mode-call', tool: 'read', input: { path: 'a' }, ...extra })
const end = (e, result = { content: 'output' }) => ({ ...e, status: 'completed', result })
function fixture(t) {
  const db = new DatabaseSync(':memory:')
  t.after(() => db.close())
  const store = new Store(db), observer = new Observer(store)
  const action = store.create('Investigate', 'Find the cause', actor)
  return { db, store, observer, action }
}
function unpaired(r, reason) {
  assert.equal(r.action_id, undefined)
  assert.equal(r.node_id, undefined)
  assert.equal(r.data.start_id, undefined)
  assert.match(r.data.attribution, reason)
}

test('overlapping Code Mode calls retain both starts and cannot cross-pair out of order', t => {
  const { store, observer, action } = fixture(t)
  const a = call(), b = call({ input: { path: 'b' } })
  observer.before(a); observer.before(b)
  unpaired(observer.after(end(b, 'B')), /ambiguous/)
  unpaired(observer.after(end(a, 'A')), /ambiguous/)
  const records = store.records({ session_id: actor.session_id }).items
  assert.equal(records.length, 4)
  assert.equal(records.filter(r => r.data.phase === 'started').length, 2)
  assert.deepEqual(records.filter(r => r.data.phase === 'finished').map(r => r.data.result_digest), [digest('B'), digest('A')])
  assert.equal(store.records({ action_id: action.id }).items.length, 2)
})

test('identical input is not a unique invocation identity', t => {
  const { observer } = fixture(t)
  observer.before(call()); observer.before(call())
  unpaired(observer.after(end(call(), 'second result')), /ambiguous/)
  unpaired(observer.after(end(call(), 'first result')), /ambiguous/)
})

test('repeated before delivery is indistinguishable from a second invocation', t => {
  const { observer, store } = fixture(t), e = call()
  observer.before(e); observer.before(e)
  assert.equal(store.records({ session_id: actor.session_id }).items.length, 2)
  unpaired(observer.after(end(e)), /ambiguous/)
})

test('overlap across a Task/Action switch does not give either finish the current scope', t => {
  const { observer, store, action } = fixture(t), a = call()
  observer.before(a)
  const other = store.create('Other', 'Different work', actor), b = call({ input: { path: 'b' } })
  observer.before(b)
  const last = store.create('Third', 'Current work', actor)
  unpaired(observer.after(end(b)), /ambiguous/)
  unpaired(observer.after(end(a)), /ambiguous/)
  assert.equal(store.records({ action_id: action.id }).items.length, 1)
  assert.equal(store.records({ action_id: other.id }).items.length, 1)
  assert.equal(store.records({ action_id: last.id }).items.length, 0)
})

test('single start preserves original Action and Task after replan and Session switch', t => {
  const { observer, store, action } = fixture(t)
  store.savePlan(action.id, 0, [{ id: 't', kind: 'task', title: 'Task' }])
  store.select(actor.session_id, { action_id: action.id, node_id: 't' })
  const e = call(); observer.before(e)
  const start = store.records({ action_id: action.id }).items[0]
  store.savePlan(action.id, 1, [])
  store.create('Other', 'New task', actor)
  const finish = observer.after(end(e))
  assert.equal(finish.action_id, action.id)
  assert.equal(finish.node_id, 't')
  assert.equal(finish.fingerprint, start.fingerprint)
  assert.equal(finish.data.start_id, start.id)
  assert.equal(store.contractMatch(finish), false)
})

test('a failed completion insert can retry against its original saved start', t => {
  const { observer, store, db, action } = fixture(t), e = call()
  observer.before(e)
  db.exec(`CREATE TRIGGER fail_finish BEFORE INSERT ON ledger
    WHEN json_extract(NEW.data,'$.data.phase')='finished'
    BEGIN SELECT RAISE(ABORT, 'temporary write failure'); END;`)
  assert.throws(() => observer.after(end(e)), /temporary write failure/)
  store.create('Other', 'Switched while storage was failing', actor)
  db.exec('DROP TRIGGER fail_finish')
  const finish = observer.after(end(e))
  assert.equal(finish.action_id, action.id)
  assert.equal(finish.data.attribution, 'captured-at-start')
  assert.equal(store.records({ action_id: action.id }).items.length, 2)
})

test('a failed completion digest leaves the start recoverable', t => {
  const { observer, action } = fixture(t), e = call(), circular = {}
  circular.self = circular
  observer.before(e)
  assert.throws(() => observer.after(end(e, circular)))
  assert.equal(observer.after(end(e)).action_id, action.id)
})

test('failed start capture disables pairing instead of letting a sibling borrow the start', t => {
  const { observer, store, db } = fixture(t), e = call()
  observer.before(e)
  db.exec(`CREATE TRIGGER fail_start BEFORE INSERT ON ledger
    WHEN json_extract(NEW.data,'$.data.phase')='started'
    BEGIN SELECT RAISE(ABORT, 'start write failure'); END;`)
  assert.throws(() => observer.before(call()), /start write failure/)
  db.exec('DROP TRIGGER fail_start')
  unpaired(observer.after(end(e)), /capture-gap/)
  // Unrelated native work and new start capture can still proceed.
  const next = call({ id: 'new' }); observer.before(next)
  unpaired(observer.after(end(next)), /capture-gap/)
  assert.equal(store.records({ session_id: actor.session_id }).items.length, 4)
})

test('capture disabled during an overlapping call creates an explicit pairing gap', t => {
  const { observer } = fixture(t), e = call()
  observer.before(e)
  observer.skip(call())
  unpaired(observer.after(end(call())), /capture-gap/)
  unpaired(observer.after(end(e)), /capture-gap/)
})

test('capture disabled for unrelated work does not poison a saved in-flight call', t => {
  const { observer, action } = fixture(t), e = call()
  observer.before(e)
  observer.skip(call({ id: 'not-captured' }))
  assert.equal(observer.after(end(e)).action_id, action.id)
})

test('more than 1024 interrupted calls do not exhaust later capture', t => {
  const { observer, store, db, action } = fixture(t)
  for (let i = 0; i < 1100; i++) observer.before(call({ id: `interrupted-${i}` }))
  const next = call({ id: 'next' }); observer.before(next)
  assert.equal(observer.after(end(next)).action_id, action.id)
  assert.equal(db.prepare("SELECT count(*) AS n FROM ledger").get().n, 1102)
  assert.equal(store.records({ action_id: action.id }).items[0].data.phase, 'started')
  assert.equal(store.records({ action_id: action.id }).items[0].data.status, undefined)
})

test('reused host keys stay ambiguous after another completion or an interrupted sibling', t => {
  const { observer } = fixture(t), a = call(), b = call({ input: { path: 'b' } })
  observer.before(a); observer.before(b)
  unpaired(observer.after(end(b)), /ambiguous/)
  const next = call({ input: { path: 'next' } }); observer.before(next)
  unpaired(observer.after(end(a)), /ambiguous/)
  unpaired(observer.after(end(next)), /ambiguous/)
})

test('sequential reuse is conservative and does not relink a late duplicate', t => {
  const { observer, action } = fixture(t), e = call()
  observer.before(e); assert.equal(observer.after(end(e)).action_id, action.id)
  observer.before(call())
  unpaired(observer.after(end(e)), /ambiguous/)
})

test('a duplicate completion never attaches to the same start twice', t => {
  const { observer, action } = fixture(t), e = call()
  observer.before(e); assert.equal(observer.after(end(e)).action_id, action.id)
  unpaired(observer.after(end(e)), /already-finished/)
})

test('missing or changed inputs and changed actors are not paired', t => {
  const { observer } = fixture(t), e = call()
  observer.before(e)
  unpaired(observer.after(end({ ...e, input: { path: 'different' } })), /input-mismatch/)
  const other = call({ id: 'other' }); observer.before(other)
  unpaired(observer.after(end({ ...other, agent: 'another-agent' })), /actor-mismatch/)
})

test('missing starts and completed calls before starts cannot acquire later work', t => {
  const { observer } = fixture(t), e = call()
  unpaired(observer.after(end(e)), /missing-start/)
  observer.before(e)
  unpaired(observer.after(end(e)), /already-finished/)
})

test('new Observer generation retains history but does not claim restart continuity', t => {
  const { store, observer, action } = fixture(t), e = call()
  observer.before(e)
  const restarted = new Observer(store)
  unpaired(restarted.after(end(e)), /observer-restarted/)
  const fresh = call({ id: 'new-call' }); restarted.before(fresh)
  assert.equal(restarted.after(end(fresh)).action_id, action.id)
})

test('actual database reopen retains interrupted starts without an in-memory backlog', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'loom-observer-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  const path = join(dir, 'db'), first = new DatabaseSync(path), store = new Store(first)
  const action = store.create('A', 'Goal', actor), e = call()
  new Observer(store).before(e); first.close()
  const reopened = new DatabaseSync(path); t.after(() => reopened.close())
  const restored = new Store(reopened), next = new Observer(restored)
  unpaired(next.after(end(e)), /observer-restarted/)
  assert.equal(restored.records({ action_id: action.id }).items.length, 1)
})

test('two database connections cannot both attach a finish to one start', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'loom-observer-shared-')), path = join(dir, 'db')
  const d1 = new DatabaseSync(path), d2 = new DatabaseSync(path)
  t.after(async () => { d1.close(); d2.close(); await rm(dir, { recursive: true, force: true }) })
  const s1 = new Store(d1), s2 = new Store(d2), o1 = new Observer(s1), o2 = new Observer(s2)
  s1.create('A', 'Goal', actor); const e = call()
  o1.before(e); o2.before(call())
  unpaired(o2.after(end(e)), /ambiguous/)
  unpaired(o1.after(end(e)), /ambiguous/)
})

test('session and message namespaces separate otherwise identical calls', t => {
  const { observer, store, action } = fixture(t)
  const events = [call(), call({ messageID: 'other-message' }), call({ sessionID: 'other-session' }), call({ tool: 'write' })]
  store.select('other-session', { action_id: action.id })
  for (const e of events) observer.before(e)
  for (const e of events.toReversed()) assert.equal(observer.after(end(e)).action_id, action.id)
})

test('observations never persist raw tool inputs or results', t => {
  const { observer, store } = fixture(t), e = call({ input: { token: 'VERY-PRIVATE-INPUT' } })
  observer.before(e); observer.after(end(e, { password: 'VERY-PRIVATE-OUTPUT' }))
  const json = JSON.stringify(store.records({ session_id: actor.session_id }))
  assert.ok(!json.includes('VERY-PRIVATE'))
})
