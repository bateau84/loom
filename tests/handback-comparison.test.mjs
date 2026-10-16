import { test } from 'node:test'
import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { HandbackExperiment } from './handback/bridge.mjs'
import { observeRequest, observeResponse, isCompletionRead } from './handback/request-oracle.mjs'

const user = text => ({ role: 'user', content: [{ type: 'text', text }] })
const notice = user('Answer recorded for question q1. Read the authoritative thread.')

test('normal repeated history and tool steps do not count as duplicated inputs', () => {
  const state = {}
  for (let i = 0; i < 3; i++) observeRequest(state, 'worker', [notice])
  observeResponse(state, 'worker', { text: 'WORKER_FINISHED completion=c1' })
  assert.deepEqual(state.request_oracle.violations, [])
  assert.equal(state.request_oracle.counts.worker, 3)
})
for (const role of ['primary', 'worker']) test(`raw extra ${role} request is detected even when the script emits no work`, () => {
  const state = { completions: 1, coordinations: 1 }
  observeResponse(state, role, { text: role === 'worker' ? 'WORKER_FINISHED completion=c1' : 'PRIMARY_COORDINATION_FINISHED' })
  observeRequest(state, role, [notice])
  // Existing provider guard would return text and leave these write counts unchanged.
  assert.equal(state.completions, 1); assert.equal(state.coordinations, 1)
  assert.equal(state.request_oracle.violations[0].kind, 'request-after-terminal')
})
test('two actionable inputs in the same model step are detected', () => {
  const state = {}
  observeRequest(state, 'worker', [notice, notice])
  assert.equal(state.request_oracle.violations[0].kind, 'duplicate-actionable-input')
})
test('production primary notice header also detects duplicate actionable inputs before script guards', () => {
  const state = {}
  const input = user('[Loom primary-native/v1]\n{"delivery_id":"delivery"}')
  observeRequest(state, 'primary', [input, input])
  assert.equal(state.request_oracle.violations[0].kind, 'duplicate-actionable-input')
})
test('quoted notices in a tool or assistant result are not new actionable inputs', () => {
  const state = {}
  observeRequest(state, 'worker', [notice, { ...notice, role: 'assistant' }, { ...notice, role: 'tool' }])
  assert.deepEqual(state.request_oracle.violations, [])
})
test('a yield is not terminal completion', () => {
  const state = {}
  observeResponse(state, 'worker', { text: 'WORKER_ASKED_AND_YIELDED' })
  observeRequest(state, 'worker', [notice])
  assert.deepEqual(state.request_oracle.violations, [])
})
test('request oracle survives serialization and a fresh fixture instance', () => {
  const state = {}
  observeResponse(state, 'primary', { text: 'PRIMARY_COORDINATION_FINISHED' })
  const restored = JSON.parse(JSON.stringify(state))
  observeRequest(restored, 'primary', [])
  assert.equal(restored.request_oracle.violations.length, 1)
})

function fixture(t) {
  const db = new DatabaseSync(':memory:'); t.after(() => db.close())
  const bridge = new HandbackExperiment(db)
  const ref = { action_id: 'a', node_id: 'n', action_revision: 1, plan_revision: 1, hash: 'f'.repeat(64) }
  bridge.track({ id: 'work', primary: 'primary', worker: 'worker', original_returned: true, work_ref: ref })
  const report = { id: 'c', kind: 'completion', session_id: 'worker', action_id: 'a', node_id: 'n', data: { work_ref: ref } }
  return { bridge, ref, report }
}
// These characterize KNOWN experiment defects, not passing production contracts.
test('characterization: equivalent reference field order is refused by the reviewed selector', t => {
  const { bridge, ref, report } = fixture(t)
  bridge.resumeAfterAnswer('work', 'answer')
  report.data.work_ref = Object.fromEntries(Object.entries(ref).reverse())
  assert.deepEqual(report.data.work_ref, ref)
  assert.equal(bridge.offer('work', report).state, 'wrong-completion')
})
test('characterization: marking resume before a failed admission suppresses the next attempt', t => {
  const { bridge } = fixture(t)
  assert.equal(bridge.resumeAfterAnswer('work', 'answer'), true)
  // No native submission occurs: equivalent to a failure before host admission.
  assert.equal(bridge.resumeAfterAnswer('work', 'answer'), false)
  assert.equal(bridge.get('work').resumed, true)
})
test('characterization: native ownership has no primary or generation argument and remains sticky', t => {
  const { bridge, report } = fixture(t)
  bridge.nativeOwns('work')
  bridge.resumeAfterAnswer('work', 'answer')
  assert.equal(bridge.offer('work', report).state, 'native-owned')
  assert.equal(bridge.get('work').return_owner, 'native')
})

test('answer-thread queries with absent or different completion IDs are not completion reads', () => {
  assert.equal(isCompletionRead({ operation: 'query', view: 'thread', question_id: 'q' }, undefined), false)
  assert.equal(isCompletionRead({ operation: 'query' }, {}), false)
  assert.equal(isCompletionRead({ operation: 'query', record_id: '' }, { id: '' }), false)
  assert.equal(isCompletionRead({ operation: 'query', record_id: 'other' }, { id: 'c' }), false)
})
test('completion read requires the actual saved record ID and a query', () => {
  assert.equal(isCompletionRead({ operation: 'query', record_id: 'c' }, { id: 'c' }), true)
  assert.equal(isCompletionRead({ operation: 'add', record_id: 'c' }, { id: 'c' }), false)
})
