import { test } from 'node:test'
import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Store } from '../.test-build/store.js'
import { Observer } from '../.test-build/context.js'
import { workReference } from '../.test-build/collaboration.js'

const actor = { session_id: 'source-session', agent: 'worker' }
const event = (extra = {}) => ({ sessionID: actor.session_id, agent: actor.agent, messageID: 'native-message', id: 'native-call', tool: 'read', input: { path: 'original' }, ...extra })
const finish = e => ({ ...e, status: 'completed', result: { output: 'result' } })
function memory(t) {
  const db = new DatabaseSync(':memory:')
  t.after(() => db.close())
  const store = new Store(db)
  return { db, store, observer: new Observer(store) }
}
function work(store, title = 'Original') {
  const action = store.create(title, `${title} goal`, actor)
  const plan = store.savePlan(action.id, 0, [
    { id: 'wave', kind: 'wave', title: 'Review whole wave' },
    { id: 'task', kind: 'task', title: 'Original Task', parent: 'wave', criteria: ['Original acceptance'] },
    { id: 'other', kind: 'task', title: 'Other Task' },
  ])
  store.select(actor.session_id, { action_id: action.id, node_id: 'task' })
  return { action, plan, ref: workReference(action, plan, 'task') }
}

test('automatic start and late finish retain the historical WorkRef across replan, Action edit and database reopen', t => {
  const directory = mkdtempSync(join(tmpdir(), 'loom-observed-work-')), path = join(directory, 'state.sqlite')
  t.after(() => rmSync(directory, { recursive: true, force: true }))
  const db = new DatabaseSync(path), store = new Store(db), observer = new Observer(store)
  const { action, plan, ref } = work(store), e = event()
  const start = observer.before(e)
  assert.deepEqual(start.data.work_scope, { status: 'established', work_ref: ref })
  store.savePlan(action.id, plan.revision, [{ id: 'replacement', kind: 'task', title: 'New contract B' }])
  store.update(action.id, action.revision, { title: 'Changed Action', goal: 'Changed goal B' })
  const other = work(store, 'Selected later')
  const result = observer.after(finish(e))
  assert.deepEqual(result.data.work_scope, start.data.work_scope)
  assert.equal(result.data.start_id, start.id)
  assert.equal(result.action_id, action.id)
  assert.equal(result.node_id, 'task')
  assert.notEqual(result.action_id, other.action.id)
  assert.equal(result.fingerprint, start.fingerprint)
  db.close()

  const reopened = new DatabaseSync(path)
  try {
    const restored = new Store(reopened)
    const history = restored.history.read({ action_id: action.id }).items
    assert.equal(history.length, 2)
    assert.deepEqual(history.map(r => r.data.work_scope), [start.data.work_scope, start.data.work_scope])
    assert.deepEqual(restored.plan(action.id, ref.plan_revision), plan)
    // This existing public report path verifies both the historical Action and Plan,
    // proving the ref was not merely preserved as an opaque, unreconstructible hash.
    const report = restored.collaboration.complete(actor, { work_ref: ref, statement: 'Report against original contract A.' })
    assert.deepEqual(report.data.work_goal, { title: action.title, goal: action.goal })
    assert.equal(restored.records({ action_id: action.id, record_id: result.id }).items[0].data.work_scope.work_ref.hash, ref.hash)
  } finally { reopened.close() }
})

test('a group start freezes the exact group WorkRef including its original descendants', t => {
  const { store, observer } = memory(t), { action, plan } = work(store)
  store.select(actor.session_id, { action_id: action.id, node_id: 'wave' })
  const e = event(), start = observer.before(e), original = workReference(action, plan, 'wave')
  assert.deepEqual(start.data.work_scope, { status: 'established', work_ref: original })
  const next = store.savePlan(action.id, plan.revision, plan.nodes.map(n => n.id === 'task' ? { ...n, criteria: ['Different acceptance B'] } : n))
  assert.notEqual(workReference(action, next, 'wave').hash, original.hash)
  assert.deepEqual(observer.after(finish(e)).data.work_scope, start.data.work_scope)
})

test('unselected work, Action-only selection and removed selected Task retain distinct explicit states', t => {
  const { store, observer } = memory(t)
  const unselected = observer.before(event({ id: 'unselected' }))
  assert.deepEqual(unselected.data.work_scope, { status: 'unscoped' })
  const action = store.create('Action only', 'No Task selected', actor)
  const actionOnly = observer.before(event({ id: 'action-only' }))
  assert.equal(actionOnly.action_id, action.id)
  assert.equal(actionOnly.data.work_scope.status, 'unknown')
  assert.equal(actionOnly.data.work_scope.reason, 'not-observed')
  assert.match(actionOnly.data.work_scope.detail, /no Task or group WorkRef/)
  store.savePlan(action.id, 0, [{ id: 'task', kind: 'task', title: 'Removed later' }])
  store.select(actor.session_id, { action_id: action.id, node_id: 'task' })
  store.savePlan(action.id, 1, [])
  const removed = observer.before(event({ id: 'removed-task' }))
  assert.equal(removed.node_id, 'task')
  assert.equal(removed.data.work_scope.status, 'unknown')
  assert.equal(removed.data.work_scope.reason, 'source-missing')
  assert.equal(removed.fingerprint, undefined)
})

test('an unpaired finish cannot borrow the current WorkRef or claim positively unscoped work', t => {
  const { store, observer } = memory(t)
  work(store)
  const result = observer.after(finish(event()))
  assert.equal(result.action_id, undefined)
  assert.equal(result.data.work_scope.status, 'unknown')
  assert.equal(result.data.work_scope.reason, 'not-observed')
  assert.match(result.data.work_scope.detail, /missing-start/)
  assert.equal(result.data.work_scope.work_ref, undefined)
})

test('overlapping reused native keys preserve ambiguous candidates without selecting by input or completion order', t => {
  const { store, observer } = memory(t), first = work(store, 'First')
  const e = event(), a = observer.before(e)
  const second = work(store, 'Second'), b = observer.before(e)
  for (const result of [observer.after(finish(e)), observer.after(finish(e))]) {
    assert.equal(result.action_id, undefined)
    assert.equal(result.data.start_id, undefined)
    assert.deepEqual(result.data.work_scope, { status: 'ambiguous', candidates: [first.ref, second.ref], observation_ids: [a.id, b.id] })
  }
})

test('one shared WorkRef does not turn two starts into one established attempt', t => {
  const { store, observer } = memory(t), { ref } = work(store), e = event()
  const a = observer.before(e), b = observer.before(e), result = observer.after(finish(e))
  assert.deepEqual(result.data.work_scope, { status: 'ambiguous', candidates: [ref], observation_ids: [a.id, b.id] })
  assert.equal(result.data.start_id, undefined)
})

test('observer replacement preserves the original frozen start while making a late finish explicitly unknown', t => {
  const { store, observer } = memory(t), { ref } = work(store), e = event()
  const start = observer.before(e)
  work(store, 'Current')
  const late = new Observer(store).after(finish(e))
  assert.equal(late.data.work_scope.status, 'unknown')
  assert.match(late.data.work_scope.detail, /observer-restarted/)
  assert.equal(late.action_id, undefined)
  assert.deepEqual(store.records({ session_id: actor.session_id, record_id: start.id }).items[0].data.work_scope, { status: 'established', work_ref: ref })
})

test('capture-off completes only an already paired start and preserves its historical scope without new payload capture', t => {
  const { store, observer } = memory(t), { action, plan, ref } = work(store)
  const e = event({ input: { secret: 'PRIVATE-INPUT-NEVER-CAPTURED' } })
  const start = observer.before(e)
  store.savePlan(action.id, plan.revision, [])
  const result = observer.after({ ...finish(e), result: 'PRIVATE-OUTPUT-NEVER-CAPTURED' }, false)
  assert.equal(result.data.start_id, start.id)
  assert.deepEqual(result.data.work_scope, { status: 'established', work_ref: ref })
  assert.equal(observer.after(finish(event({ id: 'disabled-new-call' })), false), undefined)
  const records = store.history.read({ session_id: actor.session_id }).items
  assert.equal(records.length, 2)
  assert.ok(!JSON.stringify(records).includes('PRIVATE-'))
})

for (const scope of [undefined, { status: 'future-policy', work_ref: {} }, { status: 'established', work_ref: { hash: 'invalid' } }]) {
  test(`legacy or unsupported start scope ${JSON.stringify(scope)} cannot be upgraded using current selection`, t => {
    const { db, store, observer } = memory(t)
    work(store)
    const e = event(), start = observer.before(e)
    // Simulate existing persisted history without editing its native start fields.
    if (scope === undefined) delete start.data.work_scope
    else start.data.work_scope = scope
    db.prepare('UPDATE ledger SET data=? WHERE id=?').run(JSON.stringify(start), start.id)
    work(store, 'Current')
    const result = observer.after(finish(e))
    assert.equal(result.data.start_id, start.id)
    assert.equal(result.data.work_scope.status, 'unknown')
    assert.equal(result.data.work_scope.reason, 'history-unavailable')
    assert.equal(result.data.work_scope.work_ref, undefined)
    const persistedStart = store.records({ session_id: actor.session_id, record_id: start.id }).items[0]
    assert.deepEqual(persistedStart.data.work_scope, scope)
  })
}
