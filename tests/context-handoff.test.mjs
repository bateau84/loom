import { test } from 'node:test'
import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { Store } from '../.test-build/store.js'
import { resolveContextSelection, workContext } from '../.test-build/work-context.js'

const actor = { session_id: 'writer', agent: 'author' }
function create(store) {
  const action = store.create('Handoff', 'Preserve work without inheriting opinions', actor)
  store.savePlan(action.id, 0, [
    { id: 'research', kind: 'task', title: 'Investigate' },
    { id: 'work', kind: 'task', title: 'Implement', depends_on: ['research'] },
  ])
  const source = { action_id: action.id, node_id: 'research' }
  const result = store.record(actor, source, { kind: 'result', statement: 'At abc123: parser verified. ' + 'Details. '.repeat(100) + 'Real provider remains UNPROVEN.' })
  return { action, source, result, target: { action_id: action.id, node_id: 'work' } }
}

test('view and exact handoff identity survive a real database reopen', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'loom-handoff-'))
  let db
  try {
    const path = join(directory, 'ledger.sqlite')
    db = new DatabaseSync(path)
    let store = new Store(db)
    const { result, target } = create(store)
    workContext(store, { ...target, context_mode: 'independent' }, 16000, 'reviewer', { selectForSession: 'review' })
    workContext(store, { ...target, handoff_id: result.id }, 16000, 'coder', { selectForSession: 'next' })
    db.close(); db = new DatabaseSync(path); store = new Store(db)
    assert.equal(store.selected('review').context_mode, 'independent')
    assert.deepEqual(workContext(store, store.selected('review')).records, [])
    assert.equal(workContext(store, store.selected('next')).handoff.record_id, result.id)
    const exact = store.records({ action_id: target.action_id, record_id: result.id }).items[0]
    assert.match(exact.data.statement, /provider remains UNPROVEN/)
    assert.equal(exact.session_id, actor.session_id)
    assert.equal(exact.node_id, 'research')
  } finally { db?.close(); await rm(directory, { recursive: true, force: true }) }
})

test('old dependency handoff stays discoverable despite newer results and changed contracts', t => {
  const db = new DatabaseSync(':memory:'); t.after(() => db.close())
  const store = new Store(db), { result, source, target, action } = create(store)
  for (let i = 0; i < 60; i++) store.record(actor, source, { kind: 'result', statement: `Later result ${i}` })
  store.savePlan(action.id, 1, [
    { id: 'research', kind: 'task', title: 'Changed research', criteria: ['Additional required evidence'] },
    { id: 'work', kind: 'task', title: 'Implement', depends_on: ['research'] },
  ])
  const out = workContext(store, { ...target, handoff_id: result.id }, 2000)
  assert.equal(out.handoff.record_id, result.id)
  assert.equal(out.handoff.source_node_id, 'research')
  assert.match(out.handoff_note, /not proof/)
  assert.ok(JSON.stringify(out).length <= 2000)
  assert.equal(store.records({ action_id: action.id, record_id: result.id }).items[0].data.statement, result.data.statement)
})

test('failed write leaves persisted view unchanged and invalid pins make no write', t => {
  const db = new DatabaseSync(':memory:'); t.after(() => db.close())
  const store = new Store(db), { target, result } = create(store)
  store.select('review', target)
  const before = store.selected('review')
  assert.throws(() => workContext(store, { ...target, handoff_id: 'absent' }, 16000, 'reviewer', { selectForSession: 'review' }))
  assert.deepEqual(store.selected('review'), before)
  db.exec("CREATE TRIGGER fail_selection BEFORE UPDATE ON focus BEGIN SELECT RAISE(ABORT,'selection failed'); END")
  const out = workContext(store, resolveContextSelection({ mode: 'independent' }, () => store.selected('review')), 2000, 'reviewer', { selectForSession: 'review' })
  assert.equal(out.selection.status, 'save-failed')
  assert.deepEqual(out.selection.persisted, before)
  assert.deepEqual(store.selected('review'), before)
  assert.equal(store.records({ action_id: target.action_id, record_id: result.id }).items[0].id, result.id)
})
