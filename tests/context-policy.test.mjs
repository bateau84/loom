import { test } from 'node:test'
import assert from 'node:assert/strict'
import { contextSelection, resolveContextSelection, workContext } from '../.test-build/work-context.js'

const focus = { action_id: 'action', node_id: 'work' }
const independent = { ...focus, context_mode: 'independent' }
const result = { id: 'handoff-old', action_id: 'action', node_id: 'research', kind: 'result', agent: 'researcher', session_id: 'source', created_at: '2026-01-01T00:00:00Z', data: { statement: 'Revision abc123; compatibility remains unverified.' } }
// Unit fixture: history reads can be forbidden to detect attempted leakage, not
// merely missing output. Real Store and registered-host tests cover integration.
function fixture({ forbidHistory = false, large = false } = {}) {
  let saved, saves = 0, historyReads = 0
  const records = [result]
  const long = large ? '\u0000"\\'.repeat(2000) : ''
  const action = { id: 'action', title: 'Useful work' + long, goal: 'Deliver the requested outcome' + long, revision: 1, state: 'completed' }
  const plan = { revision: 1, nodes: [
    { id: 'research', kind: 'task', title: 'Find facts', outcome: 'Known compatibility', criteria: ['Use current sources'] },
    { id: 'work', kind: 'task', title: 'Implement', outcome: 'Correct outcome' + long, context: long, criteria: ['Real evidence' + long], depends_on: ['research'] },
  ] }
  const history = () => { historyReads++; if (forbidHistory) throw new Error('History must not be read') }
  const store = {
    contextSnapshot(id, read) { if (id !== action.id) throw new Error('Unknown Action'); return read(action, plan) },
    contextRecords() { history(); return { conclusions: records.slice(-2), observations: [], has_more: records.length > 2, scopes_omitted: 0 } },
    collaboration: { context() { history(); return { work_ref: null, progress: [{ node_id: 'work', state: 'reported-complete', report_id: 'prior-pass' }], questions: [{ question_id: 'q', asked_by: 'critic', asking_session_id: 'prior', state: 'answered', question: 'PRIOR-OPINION', answer: { record_id: 'a', author: 'author', session_id: 'prior', statement: 'PRIOR-ANSWER' } }], has_more: false, note: 'Reported, not certified.' } } },
    records(query) { history(); assert.equal(query.node_id, undefined); return { items: records.filter(r => r.action_id === query.action_id && r.id === query.record_id), next_after: null } },
    select(session, value) { saves++; saved = structuredClone(value) },
    selected() { return saved },
  }
  return { store, action, plan, records, get saved() { return saved }, get saves() { return saves }, get historyReads() { return historyReads } }
}

test('legacy selections retain default shape and explicit mode survives reselection', () => {
  assert.deepEqual(resolveContextSelection({}, () => focus), focus)
  assert.deepEqual(resolveContextSelection(focus, () => independent), independent)
  assert.equal(resolveContextSelection({ action_id: 'other' }, () => independent).context_mode, 'independent')
  assert.equal(resolveContextSelection({ mode: 'continuation' }, () => independent).context_mode, 'continuation')
})

test('pins persist only for the same work and clear explicitly or for independent context', () => {
  const saved = { ...focus, handoff_id: 'handoff-old' }
  assert.equal(resolveContextSelection({}, () => saved).handoff_id, 'handoff-old')
  assert.equal(resolveContextSelection({ ...focus, node_id: 'next' }, () => saved).handoff_id, undefined)
  assert.equal(resolveContextSelection({ handoff_id: null }, () => saved).handoff_id, undefined)
  assert.equal(resolveContextSelection({ mode: 'independent' }, () => saved).handoff_id, undefined)
  assert.throws(() => resolveContextSelection({ mode: 'independent', handoff_id: 'handoff-old' }, () => saved), /cannot include/)
})

test('bad options are rejected and explicit navigation can recover corrupt selection safely', () => {
  for (const input of [{ mode: 'blind' }, { mode: null }, { handoff_id: 2 }, { node_id: 'work' }, { action_id: null }])
    assert.throws(() => resolveContextSelection(input, () => focus))
  assert.throws(() => contextSelection({ ...focus, context_mode: 'unknown' }))
  assert.throws(() => resolveContextSelection({ mode: 'independent' }, () => undefined), /Select work/)
  assert.equal(resolveContextSelection({}, () => undefined), undefined)
  const broken = () => { throw new Error('corrupt selection') }
  assert.throws(() => resolveContextSelection({}, broken), /corrupt/)
  assert.equal(resolveContextSelection(focus, broken).context_mode, 'independent')
  assert.equal(resolveContextSelection({ ...focus, mode: 'continuation' }, broken).context_mode, 'continuation')
})

test('independent view does not even read history and preserves needed contracts', () => {
  const f = fixture({ forbidHistory: true })
  const out = workContext(f.store, independent, 16000, 'reviewer', { selectForSession: 'fresh' })
  assert.equal(out.context_mode, 'independent')
  assert.equal(out.history_withheld, true)
  assert.deepEqual(out.records, []); assert.deepEqual(out.progress, []); assert.deepEqual(out.questions, [])
  assert.equal(out.action.goal, f.action.goal)
  assert.equal(out.action.state, undefined, 'reported completion must not be injected')
  assert.equal(out.task.id, 'work')
  assert.equal(out.work_ref.node_id, 'work')
  assert.match(out.work_ref.hash, /^[a-f0-9]{64}$/)
  assert.equal(out.read_plan.input.action_id, 'action')
  assert.equal(out.related_tasks[0].id, 'research')
  assert.deepEqual(f.saved, independent)
  assert.equal(f.historyReads, 0)
  assert.match(out.note, /reconcile earlier findings/)
})

test('compact independent view stays bounded with escaped text and outer diagnostics', () => {
  const f = fixture({ forbidHistory: true, large: true })
  const out = workContext(f.store, independent, 2000, 'reviewer', { envelopeChars: 250 })
  assert.equal(out.truncated, true)
  assert.ok(JSON.stringify(out).length <= 1750)
  assert.equal(out.task.id, 'work')
  assert.match(out.note, /excerpted/)
  assert.equal(f.historyReads, 0)
})

test('missing task recovery in independent mode never adds questions or progress', () => {
  const f = fixture({ forbidHistory: true })
  const out = workContext(f.store, { ...independent, node_id: 'removed' }, 2000, 'reviewer', { selectForSession: 'fresh' })
  assert.equal(out.recovery.code, 'task-not-in-current-plan')
  assert.equal(out.selection_unchanged, true)
  assert.equal(out.context_mode, 'independent')
  assert.ok(JSON.stringify(out).length <= 2000)
  assert.equal(f.saves, 0); assert.equal(f.historyReads, 0)
})

test('failed independent selection is explicit and retains the old view', () => {
  const f = fixture({ forbidHistory: true, large: true })
  f.store.select('reviewer', focus)
  f.store.select = () => { throw new Error('\u0000'.repeat(2000)) }
  const out = workContext(f.store, independent, 2000, 'reviewer', { selectForSession: 'reviewer' })
  assert.equal(out.selection.status, 'save-failed')
  assert.deepEqual(out.selection.persisted, focus)
  assert.match(out.selection.warning, /NOT saved/)
  assert.deepEqual(f.saved, focus)
  assert.ok(JSON.stringify(out).length <= 2000)
})

test('returning to continuation exposes earlier findings without changing them', () => {
  const f = fixture()
  const before = JSON.stringify(f.records)
  workContext(f.store, independent, 16000, 'reviewer', { selectForSession: 'reviewer' })
  const next = resolveContextSelection({ mode: 'continuation' }, () => f.saved)
  const out = workContext(f.store, next, 16000, 'reviewer', { selectForSession: 'reviewer' })
  assert.equal(out.context_mode, 'continuation')
  assert.equal(out.records[0].id, result.id)
  assert.equal(out.questions[0].question, 'PRIOR-OPINION')
  assert.equal(JSON.stringify(f.records), before)
})

test('an old handoff pointer survives newer sampled results and minimum budget', () => {
  const f = fixture({ large: true })
  for (let i = 0; i < 20; i++) f.records.push({ ...result, id: `new-${i}`, data: { statement: 'Latest result ' + 'x'.repeat(3000) } })
  const selected = { ...focus, handoff_id: result.id }
  const out = workContext(f.store, selected, 2000, 'coder', { selectForSession: 'fresh', envelopeChars: 12 })
  assert.equal(out.handoff.record_id, result.id)
  assert.equal(out.handoff.source_node_id, 'research')
  assert.equal(f.saved.handoff_id, result.id)
  assert.ok(JSON.stringify(out).length <= 1988)
  assert.match(out.handoff_note, /without node_id/)
  assert.equal(f.store.records({ action_id: 'action', record_id: out.handoff.record_id }).items[0].data.statement, result.data.statement)
})

test('wrong-kind, missing, and cross-Action pins never save selection', () => {
  for (const record of [undefined, { ...result, kind: 'assessment' }, { ...result, action_id: 'other' }]) {
    const f = fixture()
    f.records.splice(0, f.records.length, ...(record ? [record] : []))
    assert.throws(() => workContext(f.store, { ...focus, handoff_id: result.id }, 16000, 'coder', { selectForSession: 'fresh' }), /existing result/)
    assert.equal(f.saves, 0)
  }
})

test('legacy default behavior is still continuation and does not certify results', () => {
  const f = fixture()
  const out = workContext(f.store, focus)
  assert.equal(out.context_mode, 'continuation')
  assert.equal(out.records[0].id, result.id)
  assert.match(out.note, /agent-reported/)
  assert.equal(f.saves, 0)
})

test('unknown Action and invalid budgets fail rather than inventing recovery', () => {
  const f = fixture({ forbidHistory: true })
  assert.throws(() => workContext(f.store, { ...independent, action_id: 'missing' }), /Unknown Action/)
  for (const n of [0, 1999, 64001, NaN, 2.5]) assert.throws(() => workContext(f.store, independent, n), /Context budget/)
  assert.equal(f.saves, 0)
})
