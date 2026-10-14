import { test } from 'node:test'
import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Store } from '../.test-build/store.js'
import { subject } from '../.test-build/model.js'

const actor = { session_id: 's', agent: 'worker' }
const task = id => ({ id, kind: 'task', title: id })

function fixture(t) {
  const dir = mkdtempSync(join(tmpdir(), 'loom-read-consistency-'))
  const path = join(dir, 'ledger.sqlite')
  const db = new DatabaseSync(path), other = new DatabaseSync(path)
  const interleave = { beforeRun: undefined, afterGet: undefined, afterAll: undefined, beforeExec: undefined }
  // The seam controls interleaving only. Every read/write still uses actual SQLite.
  const sql = {
    exec: text => { interleave.beforeExec?.(text); return db.exec(text) },
    prepare: text => {
      const statement = db.prepare(text)
      return {
        get: (...args) => { const row = statement.get(...args); interleave.afterGet?.(text); return row },
        all: (...args) => { const rows = statement.all(...args); interleave.afterAll?.(text); return rows },
        run: (...args) => { interleave.beforeRun?.(text); return statement.run(...args) },
      }
    },
  }
  const store = new Store(sql), writer = new Store(other)
  other.exec('PRAGMA busy_timeout=0')
  t.after(() => { db.close(); other.close(); rmSync(dir, { recursive: true, force: true }) })
  const action = store.create('Action', 'Original goal', actor)
  store.savePlan(action.id, 0, [task('old'), task('next')])
  store.select(actor.session_id, { action_id: action.id, node_id: 'old' })
  return { db, other, interleave, store, writer, action }
}

test('selection cannot save a node removed between validation and its write', t => {
  const { interleave, store, writer, action } = fixture(t)
  let attempted = false, committed = false
  interleave.beforeRun = text => {
    if (attempted || !text.startsWith('INSERT INTO focus')) return
    attempted = true
    try { writer.savePlan(action.id, 1, [task('old')]); committed = true }
    catch (error) { assert.match(error.message, /locked|busy/i) }
  }
  store.select(actor.session_id, { action_id: action.id, node_id: 'next' })
  assert.equal(attempted, true)
  assert.equal(committed, false, 'the competing removal must not commit before the validated selection is saved')
  assert.equal(writer.plan(action.id).nodes.some(n => n.id === 'next'), true)
  assert.deepEqual(writer.selected(actor.session_id), { action_id: action.id, node_id: 'next' })
})

test('removal committed before selection is rejected without changing prior focus', t => {
  const { store, writer, action } = fixture(t)
  writer.savePlan(action.id, 1, [task('old')])
  assert.throws(() => store.select(actor.session_id, { action_id: action.id, node_id: 'next' }), /Unknown or removed node/)
  assert.deepEqual(store.selected(actor.session_id), { action_id: action.id, node_id: 'old' })
  assert.throws(() => store.select('fresh-session', { action_id: action.id, node_id: 'next' }), /Unknown or removed node/)
  assert.equal(store.hasSelection('fresh-session'), false)
})

test('removal committed after selection remains allowed and preserves history', t => {
  const { store, writer, action } = fixture(t)
  const focus = { action_id: action.id, node_id: 'next' }
  store.select(actor.session_id, focus)
  const result = store.record(actor, focus, { kind: 'result', statement: 'Historical result' })
  writer.savePlan(action.id, 1, [task('old')])
  assert.deepEqual(store.selected(actor.session_id), focus)
  assert.deepEqual(store.records({ action_id: action.id, record_id: result.id }).items[0].data, result.data)
  const start = store.startObservation(actor, { phase: 'started' })
  assert.equal(start.node_id, 'next')
  assert.equal(start.fingerprint, undefined, 'historical selection does not supply a current contract')
  assert.throws(() => store.record(actor, focus, { kind: 'result', statement: 'No current contract' }), /Unknown or removed node/)
})

test('a context snapshot is not a lease authorizing a later selection', t => {
  const { store, writer, action } = fixture(t)
  const snapshot = store.contextSnapshot(action.id, (a, p) => ({ action: a, plan: p }))
  assert.equal(snapshot.plan.nodes.some(n => n.id === 'next'), true)
  writer.savePlan(action.id, 1, [task('old')])
  assert.throws(() => store.select(actor.session_id, { action_id: action.id, node_id: 'next' }), /Unknown or removed node/)
  assert.equal(snapshot.plan.revision, 1, 'returned information remains a snapshot of its earlier read')
  assert.equal(store.selected(actor.session_id).node_id, 'old')
})

test('Action-only selection needs existence, not a plan or contract fingerprint', t => {
  const { interleave, store, action } = fixture(t)
  interleave.afterGet = text => { assert.equal(text.includes('FROM plans'), false, 'Action-only selection must not load a plan') }
  store.select(actor.session_id, { action_id: action.id })
  assert.deepEqual(store.selected(actor.session_id), { action_id: action.id })
  interleave.afterGet = undefined
  const withoutPlan = store.create('Unplanned', 'Small work', actor)
  store.select('other-session', { action_id: withoutPlan.id })
  assert.deepEqual(store.selected('other-session'), { action_id: withoutPlan.id })
})

test('invalid references preserve selection and release the transaction', t => {
  const { store, writer, action } = fixture(t)
  const prior = store.selected(actor.session_id)
  for (const focus of [
    { action_id: 'unknown' },
    { action_id: action.id, node_id: '' },
    { action_id: action.id, node_id: '../invalid' },
    { action_id: action.id, node_id: 'missing' },
  ]) {
    assert.throws(() => store.select(actor.session_id, focus))
    assert.deepEqual(store.selected(actor.session_id), prior)
  }
  writer.update(action.id, 1, { goal: 'Writer can proceed after rejected selections' })
})

test('clear needs no current contract and remains explicit', t => {
  const { store, writer, action } = fixture(t)
  writer.savePlan(action.id, 1, [])
  store.select(actor.session_id)
  assert.equal(store.selected(actor.session_id), undefined)
  assert.equal(store.hasSelection(actor.session_id), true)
})

test('a failed selection write rolls back and permits a later writer', t => {
  const { db, store, writer, action } = fixture(t)
  db.exec("CREATE TRIGGER reject_focus BEFORE UPDATE ON focus BEGIN SELECT RAISE(ABORT, 'selection write failed'); END")
  assert.throws(() => store.select(actor.session_id, { action_id: action.id, node_id: 'next' }), /selection write failed/)
  assert.equal(store.selected(actor.session_id).node_id, 'old')
  writer.update(action.id, 1, { goal: 'No leaked transaction' })
  db.exec('DROP TRIGGER reject_focus')
  store.select(actor.session_id, { action_id: action.id, node_id: 'next' })
})

test('a failed selection commit restores the prior focus and releases its lock', t => {
  const { interleave, store, writer, action } = fixture(t)
  interleave.beforeExec = text => {
    if (text === 'COMMIT') { interleave.beforeExec = undefined; throw new Error('injected commit failure') }
  }
  assert.throws(() => store.select(actor.session_id, { action_id: action.id, node_id: 'next' }), /injected commit failure/)
  assert.equal(store.selected(actor.session_id).node_id, 'old')
  writer.update(action.id, 1, { goal: 'Lock released after rollback' })
})

test('Action creation and initial selection keep their existing single-transaction behavior', t => {
  const { db, store, writer, action } = fixture(t)
  db.exec("CREATE TRIGGER reject_new_focus BEFORE INSERT ON focus BEGIN SELECT RAISE(ABORT, 'cannot save initial selection'); END")
  assert.throws(() => store.create('Must roll back', 'Goal', { ...actor, session_id: 'new' }), /cannot save initial selection/)
  assert.equal(writer.list().items.length, 1)
  assert.equal(store.hasSelection('new'), false)
  assert.equal(store.selected(actor.session_id).action_id, action.id)
  db.exec('DROP TRIGGER reject_new_focus')
  const next = store.create('Valid creation', 'Goal', { ...actor, session_id: 'new' })
  assert.equal(writer.selected('new').action_id, next.id)
})

for (const operation of ['start', 'result']) test(`${operation} fingerprint capture cannot combine a concurrent new goal with earlier reads`, t => {
  const { interleave, store, writer, action } = fixture(t)
  const fingerprint = subject(action, store.plan(action.id), 'old')
  let attempted = false, committed = false
  interleave.afterGet = text => {
    if (attempted || !text.includes('FROM actions WHERE')) return
    attempted = true
    try { writer.update(action.id, 1, { goal: 'Concurrent replacement goal' }); committed = true }
    catch (error) { assert.match(error.message, /locked|busy/i) }
  }
  const record = operation === 'start'
    ? store.startObservation(actor, { phase: 'started' })
    : store.record(actor, { action_id: action.id, node_id: 'old' }, { kind: 'result', statement: 'Observed work' })
  assert.equal(attempted, true)
  assert.equal(committed, false)
  assert.equal(record.fingerprint, fingerprint)
  interleave.afterGet = undefined
  writer.update(action.id, 1, { goal: 'Later goal is allowed' })
  assert.equal(store.records({ action_id: action.id, record_id: record.id }).items[0].fingerprint, fingerprint)
})

test('unfinished-start eligibility may become stale; finish pairing still checks one transaction', t => {
  const { interleave, store, writer } = fixture(t)
  const data = { phase: 'started', correlation_key: 'group', observer_epoch: 'epoch', input_digest: 'same' }
  store.startObservation(actor, data)
  let inserted = false
  interleave.afterAll = text => {
    if (inserted || !text.includes("kind='observation'")) return
    inserted = true
    writer.startObservation(actor, data)
  }
  assert.equal(store.hasUnfinishedObservationStart('group'), true, 'eligibility is deliberately only a hint')
  assert.equal(inserted, true)
  interleave.afterAll = undefined
  const before = store.records({ session_id: actor.session_id }).items.length
  assert.equal(store.finishObservation(actor, { ...data, phase: 'finished' }, true, false), undefined)
  assert.equal(store.records({ session_id: actor.session_id }).items.length, before)
  const result = store.finishObservation(actor, { ...data, phase: 'finished' }, true)
  assert.match(result.data.attribution, /ambiguous-host-call/)
  assert.equal(result.data.start_id, undefined)
})

test('ledger pages can include later appends without claiming a cross-page snapshot', t => {
  const { store, writer, action } = fixture(t)
  const focus = { action_id: action.id, node_id: 'old' }
  const first = store.record(actor, focus, { kind: 'claim', statement: 'First' })
  const second = store.record(actor, focus, { kind: 'claim', statement: 'Second' })
  const page = store.records({ action_id: action.id, limit: 1 })
  const third = writer.record(actor, focus, { kind: 'result', statement: 'Appended after the first page' })
  const next = store.records({ action_id: action.id, after: page.next_after })
  assert.deepEqual(page.items.map(r => r.id), [first.id])
  assert.deepEqual(next.items.map(r => r.id), [second.id, third.id])
})
