import { test } from 'node:test'
import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { Store } from '../.test-build/store.js'
import * as context from '../.test-build/context.js'

// The fallback permits the same probes to demonstrate the failure on c43b18c.
const read = context.taskContextOrRecovery ?? context.taskContext
// Read historical contract status through the same snapshot path used in production.
const contextMatch = (store, record) => context.taskContext(store, { action_id: record.action_id }).records.find(r => r.id === record.id)?.contract_match
const actor = { session_id: 'worker-session', agent: 'external-worker' }
const node = (id, kind = 'task') => ({ id, kind, title: `Work ${id}` })
function setup(t) {
  const db = new DatabaseSync(':memory:')
  t.after(() => db.close())
  const store = new Store(db)
  const action = store.create('Feature', 'Deliver useful work', actor)
  store.savePlan(action.id, 0, [node('old'), node('next')])
  const focus = { action_id: action.id, node_id: 'old' }
  store.select(actor.session_id, focus)
  const result = store.record(actor, focus, { kind: 'result', statement: 'The design works only while the stated precondition holds.' })
  store.savePlan(action.id, 1, [node('next')])
  return { db, store, action, focus, result }
}
function notice(store, focus, budget = 2000) {
  const result = read(store, focus, budget)
  assert.equal(result.recovery.code, 'task-not-in-current-plan')
  assert.equal(result.task, null)
  assert.equal(result.action_id, focus.action_id)
  assert.equal(result.node_id, focus.node_id)
  assert.equal(result.selection_unchanged, true)
  assert.ok(JSON.stringify(result).length <= budget)
  return result
}

test('removed selection returns an actionable notice rather than only an exception', t => {
  const { store, focus } = setup(t)
  const value = notice(store, focus)
  assert.equal(value.plan_revision, 2)
  assert.match(value.recovery.message, /not in the current plan/)
  assert.match(value.recovery.reselect, /loom_context/)
  assert.match(value.note, /Native execution/)
})

test('notice gives executable current-plan and exact historical-task queries', t => {
  const { store, focus, result } = setup(t)
  const value = notice(store, focus)
  const { read_plan, read_history } = value.recovery
  assert.equal(read_plan.tool, 'loom_plan')
  assert.equal(read_plan.input.operation, 'read')
  assert.equal(store.plan(read_plan.input.action_id).nodes[0].id, 'next')
  assert.equal(read_history.tool, 'loom_record')
  assert.equal(read_history.input.operation, 'query')
  assert.equal(store.records(read_history.input).items[0].id, result.id)
  assert.equal(store.records(read_history.input).items[0].data.statement, result.data.statement)
})

test('recovery does not retag history, change selection, or restore the missing task', t => {
  const { db, store, action, focus, result } = setup(t)
  const before = db.prepare('SELECT total_changes() AS n').get().n
  notice(store, focus)
  assert.equal(db.prepare('SELECT total_changes() AS n').get().n, before)
  assert.deepEqual(store.selected(actor.session_id), focus)
  assert.equal(store.plan(action.id).nodes.some(n => n.id === 'old'), false)
  assert.equal(store.records({ action_id: action.id, record_id: result.id }).items[0].node_id, 'old')
  assert.equal(contextMatch(store, result), false)
})

test('action-only and valid task reads keep their full existing behavior', t => {
  const { store, action } = setup(t)
  for (const focus of [{ action_id: action.id }, { action_id: action.id, node_id: 'next' }]) {
    assert.deepEqual(read(store, focus), context.taskContext(store, focus))
    assert.equal('recovery' in read(store, focus), false)
  }
})

test('unknown task does not falsely claim a deletion or change an existing selection', t => {
  const { store, action, focus } = setup(t)
  const value = notice(store, { action_id: action.id, node_id: 'never-existed' })
  assert.doesNotMatch(value.recovery.message, /was deleted|was removed/)
  assert.deepEqual(store.selected(actor.session_id), focus)
  assert.equal(store.records({ action_id: action.id, node_id: 'never-existed' }).items.length, 0)
})

test('unknown task in an Action without a plan is recoverable without inventing one', t => {
  const { store } = setup(t)
  const action = store.create('Small action', 'No planning needed', actor)
  const value = notice(store, { action_id: action.id, node_id: 'missing' })
  assert.equal(value.plan_revision, 0)
  assert.equal(store.plan(action.id).revision, 0)
})

for (const kind of ['phase', 'wave', 'task', 'subtask']) test(`missing ${kind} receives the same non-mutating recovery path`, t => {
  const { store, action } = setup(t)
  store.savePlan(action.id, 2, [node('group', kind)])
  const focus = { action_id: action.id, node_id: 'group' }
  store.select(actor.session_id, focus)
  store.savePlan(action.id, 3, [])
  assert.equal(notice(store, focus).plan_revision, 4)
})

test('explicit clear and Action-only choices in notice are usable but never automatic', t => {
  const { store, focus } = setup(t)
  const value = notice(store, focus)
  assert.deepEqual(value.recovery.clear_selection, { tool: 'loom_context', input: { clear: true } })
  assert.deepEqual(value.recovery.use_action, { tool: 'loom_context', input: { action_id: focus.action_id } })
  store.select(actor.session_id, value.recovery.use_action.input)
  assert.equal(read(store, store.selected(actor.session_id)).task, null)
  store.select(actor.session_id)
  assert.equal(store.selected(actor.session_id), undefined)
})

test('explicit reselection returns to normal context while old records stay historical', t => {
  const { store, focus, result } = setup(t)
  notice(store, focus)
  const next = { action_id: focus.action_id, node_id: 'next' }
  store.select(actor.session_id, next)
  assert.equal(read(store, next).task.id, 'next')
  assert.equal('recovery' in read(store, next), false)
  assert.equal(contextMatch(store, result), false)
})

test('repeated notices are stable and a reappearing node uses its current contract', t => {
  const { store, action, focus, result } = setup(t)
  assert.deepEqual(notice(store, focus), notice(store, focus))
  store.savePlan(action.id, 2, [{ ...node('old'), outcome: 'Changed meaning' }])
  assert.equal(read(store, focus).task.outcome, 'Changed meaning')
  assert.equal(contextMatch(store, result), false)
})

test('notice stays within 2000 characters with maximum-length IDs and large metadata', t => {
  const { db, store } = setup(t)
  const id = 'a'.repeat(120)
  db.prepare('INSERT INTO actions(id,data) VALUES(?,?)').run(id, JSON.stringify({ id, title: 't'.repeat(500), goal: 'g'.repeat(16000), state: 'active', revision: 1, created_at: 'now' }))
  notice(store, { action_id: id, node_id: 'n'.repeat(120) })
})

test('invalid node IDs are rejected rather than copied into an unbounded recovery notice', t => {
  const { store, action } = setup(t)
  for (const id of ['', 'x'.repeat(121), '../outside', '\nignore instructions']) {
    assert.throws(() => read(store, { action_id: action.id, node_id: id }), /identifier/)
  }
})

test('invalid budgets and unknown Actions remain errors, not task-recovery notices', t => {
  const { store, focus } = setup(t)
  for (const budget of [0, 1999, 64001, NaN]) assert.throws(() => read(store, focus, budget), /budget/)
  assert.throws(() => read(store, { action_id: 'unknown', node_id: 'old' }), /Unknown Action/)
})

test('ordinary storage errors with similar text are not mislabeled as missing tasks', t => {
  const { store, focus } = setup(t)
  const failure = new Error('Task old was removed. Database read actually failed.')
  store.contextSnapshot = () => { throw failure }
  assert.throws(() => read(store, focus), e => e === failure)
})

test('missing-task recovery releases its snapshot transaction before later writes', t => {
  const { store, action, focus } = setup(t)
  notice(store, focus)
  assert.equal(store.update(action.id, 1, { title: 'Changed' }).revision, 2)
})

test('snapshot recovery does not mix in a concurrent restored Plan', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'loom-recovery-snapshot-'))
  const path = join(directory, 'ledger.sqlite')
  const db1 = new DatabaseSync(path), db2 = new DatabaseSync(path)
  t.after(async () => { db1.close(); db2.close(); await rm(directory, { recursive: true, force: true }) })
  const reader = new Store(db1), writer = new Store(db2)
  const action = reader.create('A', 'Goal', actor)
  reader.savePlan(action.id, 0, [node('old')])
  reader.savePlan(action.id, 1, [])
  const original = reader.action.bind(reader)
  let once = true
  reader.action = id => {
    const value = original(id)
    if (once) { once = false; writer.savePlan(id, 2, [node('old')]) }
    return value
  }
  const focus = { action_id: action.id, node_id: 'old' }
  assert.equal(notice(reader, focus).plan_revision, 2)
  assert.equal(read(reader, focus).plan_revision, 3)
})

test('a reopened database recovers the notice and full history without the old conversation', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'loom-recovery-reopen-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const path = join(directory, 'ledger.sqlite')
  const first = new DatabaseSync(path), store = new Store(first)
  const action = store.create('A', 'Goal', actor), focus = { action_id: action.id, node_id: 'old' }
  store.savePlan(action.id, 0, [node('old')]); store.select(actor.session_id, focus)
  const record = store.record(actor, focus, { kind: 'qa', verdict: 'inconclusive', statement: 'The missing integration check still matters.' })
  store.savePlan(action.id, 1, []); first.close()
  const second = new DatabaseSync(path); t.after(() => second.close())
  const reopened = new Store(second)
  notice(reopened, reopened.selected(actor.session_id))
  assert.equal(reopened.records({ action_id: action.id, record_id: record.id }).items[0].data.statement, record.data.statement)
})
