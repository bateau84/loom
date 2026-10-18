import { test } from 'node:test'
import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { Store } from '../.test-build/store.js'
import { taskContext } from '../.test-build/context.js'
import { workReference } from '../.test-build/collaboration.js'
import { canonical, validatePlan, ProcessingBudget, ProcessingLimitError, PROCESSING_LIMITS } from '../.test-build/model.js'

const actor = { session_id: 'worker-session', agent: 'worker' }
const knownAction = { id: 'action', title: 'Guide', goal: 'Retain qualifications', state: 'active', revision: 1, created_at: '2026-10-15T00:00:00.000Z' }

function largeNodes() {
  const names = prefix => Array.from({ length: 50 }, (_, i) => `${prefix}${i}`);
  const nodes = [{ id: 'group', kind: 'phase', title: 'Group' }];
  for (let i = 0; i < 207; i++) nodes.push({
    id: `t${String(i).padStart(3, '0')}`, kind: 'task', title: `Task ${String(i).padStart(3, '0')}`, parent: 'group',
    criteria: names('c'), roles: names('r'), skills: names('s'),
  });
  nodes.push({ id: 'tail', kind: 'task', title: 'Tail', parent: 'group', criteria: names('c').slice(0, 46) });
  // Reconstruct the reported dimensions without relying on the unpublished original fixture.
  let remaining = 202717 - JSON.stringify(nodes).length;
  for (const node of nodes) {
    const extra = Math.min(remaining, 500 - node.title.length);
    node.title += 'x'.repeat(extra); remaining -= extra;
  }
  if (remaining !== 0) throw new Error('Fixture padding no longer fits valid titles');
  return nodes;
}


function fixture(t) {
  const db = new DatabaseSync(':memory:')
  t.after(() => db.close())
  const store = new Store(db), action = store.create('Guide', 'Retain qualifications', actor)
  const nodes = largeNodes(), admission = new ProcessingBudget(PROCESSING_LIMITS.planChars)
  assert.equal(canonical(nodes, admission).length, 202717)
  assert.equal(admission.values, 32763)
  const plan = store.savePlan(action.id, 0, nodes)
  const focus = { action_id: action.id, node_id: 'group' }
  const measured = new ProcessingBudget(PROCESSING_LIMITS.contextHashChars, PROCESSING_LIMITS.contextHashValues)
  workReference(action, plan, focus.node_id, measured)
  assert.equal(measured.values, 32983)
  assert.ok(measured.values > PROCESSING_LIMITS.values, 'normalization must cross the old verification limit')
  return { store, action, plan, focus }
}

for (const maxChars of [2000, 16000]) test(`returned large-Plan work_ref completes unchanged work at context budget ${maxChars}`, t => {
  const { store, action, plan, focus } = fixture(t)
  const context = taskContext(store, focus, maxChars, actor.agent)
  assert.ok(context.work_ref)
  assert.equal(context.work_ref_reason, undefined)
  assert.ok(JSON.stringify(context).length <= maxChars)
  const report = store.collaboration.complete(actor, { work_ref: context.work_ref, statement: 'Finished the retained work definition.' })
  assert.deepEqual(report.data.work_ref, context.work_ref)
  assert.equal(store.collaboration.progress(action.id, focus.node_id).items[0].state, 'reported-complete')
  assert.deepEqual(store.plan(action.id), plan)
  assert.equal(store.action(action.id).state, 'active')
})

test('large retained work_ref still verifies historical Action and Plan, not their replacements', t => {
  const { store, action, plan, focus } = fixture(t)
  const ref = taskContext(store, focus).work_ref
  assert.ok(ref)
  store.update(action.id, action.revision, { goal: 'A materially different goal' })
  store.savePlan(action.id, plan.revision, [plan.nodes[0]])
  const report = store.collaboration.complete(actor, { work_ref: ref, statement: 'Finished the earlier definition only.' })
  assert.deepEqual(report.data.work_ref, ref)
  assert.deepEqual(report.data.work_goal, { title: action.title, goal: action.goal })
  assert.equal(store.collaboration.progress(action.id, focus.node_id).items[0].state, 'needs-reconfirmation')
  assert.deepEqual(store.plan(action.id, ref.plan_revision), plan)
  assert.equal(store.plan(action.id).revision, 2)
})

test('large-work question association does not require a completion hash', t => {
  const { store, focus } = fixture(t)
  const ref = taskContext(store, focus).work_ref
  assert.ok(ref)
  const question = store.collaboration.ask(actor, focus, { question: 'Which qualification applies?', to_agent: 'research', blocking: false })
  assert.deepEqual(question.data.reference, { action_id: focus.action_id, kind: 'phase', id: focus.node_id })
  assert.equal(question.data.work_ref, undefined)
  assert.equal(store.selected(actor.session_id).node_id, undefined)
})

test('a forged large-work hash is rejected as a mismatch without appending a report', t => {
  const { store, action, focus } = fixture(t)
  const ref = taskContext(store, focus).work_ref
  assert.ok(ref)
  const before = store.records({ action_id: action.id })
  assert.throws(() => store.collaboration.complete(actor, {
    work_ref: { ...ref, hash: '0'.repeat(64) }, statement: 'Not a matching reference.',
  }), /work_ref does not match the recorded definition/)
  assert.deepEqual(store.records({ action_id: action.id }), before)
})

test('an explicitly supplied work-reference allowance remains shared and monotonically exhausted', () => {
  const plan = { revision: 1, nodes: largeNodes() }
  const measured = new ProcessingBudget(PROCESSING_LIMITS.contextHashChars, PROCESSING_LIMITS.contextHashValues)
  const ref = workReference(knownAction, plan, 'group', measured)
  const shared = new ProcessingBudget(measured.chars * 2, measured.values)
  assert.deepEqual(workReference(knownAction, plan, 'group', shared), ref)
  assert.equal(shared.values, measured.values)
  assert.throws(() => workReference(knownAction, plan, 'group', shared), ProcessingLimitError)
  const small = { revision: 1, nodes: [{ id: 'task', kind: 'task', title: 'Small work' }] }
  assert.throws(() => workReference(knownAction, small, 'task', shared), ProcessingLimitError)
})

test('work-reference defaults remain bounded without widening generic serialization limits', () => {
  const small = { revision: 1, nodes: [{ id: 'task', kind: 'task', title: 'Small work' }] }
  assert.throws(() => workReference({ ...knownAction, goal: 'x'.repeat(PROCESSING_LIMITS.contextHashChars) }, small, 'task'), ProcessingLimitError)
  // Internal helper probe, not a claim that this over-wide node passes Plan validation.
  const wide = { revision: 1, nodes: [{ ...small.nodes[0], criteria: Array(PROCESSING_LIMITS.contextHashValues).fill('x') }] }
  assert.throws(() => workReference(knownAction, wide, 'task'), ProcessingLimitError)
  assert.throws(() => workReference(knownAction, small, 'task', new ProcessingBudget(10, 10)), ProcessingLimitError)
  assert.equal(new ProcessingBudget().maxValues, 32768)
  assert.throws(() => canonical(Array(PROCESSING_LIMITS.values).fill(0)), ProcessingLimitError)
  assert.throws(() => validatePlan(wide.nodes))
})

test('compatible work-reference hashes retain their original complete canonical bytes', () => {
  const small = { revision: 1, nodes: [{ id: 'task', kind: 'task', title: 'Read findings', roles: ['worker'], criteria: ['Keep qualifications'] }] }
  // Captured from fc340b1; the large hash used its then-successful context allowance.
  assert.equal(workReference(knownAction, small, 'task').hash, 'b8a16f86b6bcd4422bb9c686aa69f802b56055337c7ee4c6cdb44436eaf21ee5')
  assert.equal(workReference(knownAction, { revision: 1, nodes: largeNodes() }, 'group').hash, 'fad958122b9417fa51180183910f3364540df4d3d4ecc60e680f070ea48fe389')
})
