import { test } from 'node:test'
import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Store } from '../.test-build/store.js'
import { taskContext, taskContextOrRecovery } from '../.test-build/context.js'
import { workReference } from '../.test-build/collaboration.js'
import { ProcessingBudget, ProcessingLimitError } from '../.test-build/model.js'
const worker = { session_id: 'worker-session', agent: 'worker' }, research = { session_id: 'research-session', agent: 'research' }
const task = (id, extra = {}) => ({ id, kind: 'task', title: id, ...extra })
function fixture(t, db = new DatabaseSync(':memory:')) {
  t.after(() => db.close()); const store = new Store(db), c = store.collaboration
  const action = store.create('Document configuration', 'Accurate guide with qualifications', worker)
  const nodes = [task('research'), task('worker', { depends_on: ['research'] }), task('other')]
  store.savePlan(action.id, 0, nodes)
  const focus = { action_id: action.id, node_id: 'worker' }
  store.select(worker.session_id, focus); store.select(research.session_id, { action_id: action.id, node_id: 'research' })
  return { store, c, action, focus, nodes, db }
}
const context = f => taskContext(f.store, f.focus, 16000, worker.agent)
const complete = f => f.c.complete(worker, { work_ref: context(f).work_ref, statement: 'Finished the work I was assigned.' })
const state = (f, node = 'worker') => f.c.progress(f.action.id, node).items[0].state
const ask = f => f.c.ask(worker, f.focus, { statement: 'Does this apply to empty configuration?', respondent: 'research', background: 'Need the exception, not only the default.' })
const answer = (f, q) => f.c.answer(research, { question_id: q.id, statement: 'Only for explicit settings. Empty files preserve defaults.', artifact_refs: ['fixture://config/empty-case'] })

test('decisive flow: ask, answer, use original work, replan, reopen and recover on a reopened database', t => {
  const dir = mkdtempSync(join(tmpdir(), 'loom-thread-')); t.after(() => rmSync(dir, { recursive: true, force: true }))
  const path = join(dir, 'ledger.sqlite'), db = new DatabaseSync(path), f = fixture(t, db)
  const initial = context(f), before = f.store.selected(research.session_id), q = ask(f), response = answer(f, q)
  assert.deepEqual(f.store.selected(research.session_id), before)
  const received = context(f); assert.equal(received.questions[0].state, 'answered')
  assert.match(received.questions[0].answer.statement, /Empty files preserve defaults/)
  const report = f.c.complete(worker, { work_ref: initial.work_ref, statement: 'Used the qualified answer.' })
  assert.equal(state(f), 'reported-complete')
  f.store.savePlan(f.action.id, 1, f.nodes.map(n => n.id === 'worker' ? { ...n, criteria: ['Include additional error cases'] } : n))
  assert.equal(state(f), 'needs-reconfirmation')
  const reopened = f.c.reopen(worker, f.focus, 'Need the additional error cases.')
  assert.equal(state(f), 'open'); assert.equal(reopened.data.previous_report_id, report.id)
  // New database connection, Store and Session; no old conversation supplied.
  const freshDb = new DatabaseSync(path); t.after(() => freshDb.close()); const fresh = new Store(freshDb)
  assert.equal(fresh.selected('fresh'), undefined)
  const recovered = taskContext(fresh, f.focus, 16000, 'worker')
  assert.equal(recovered.progress.find(p => p.node_id === 'worker').state, 'open')
  assert.equal(recovered.questions[0].question_id, q.id)
  const thread = fresh.collaboration.thread(q.id)
  assert.equal(thread.answers[0].id, response.id); assert.deepEqual(thread.answers[0].data.artifact_refs, ['fixture://config/empty-case'])
  assert.equal(fresh.records({ action_id: f.action.id, record_id: report.id }).items[0].data.work_ref.plan_revision, 1)
})

test('completion cannot silently replace the worked-against goal with the latest goal', t => {
  const f = fixture(t), old = context(f).work_ref
  f.store.update(f.action.id, 1, { goal: 'A different goal' })
  const report = f.c.complete(worker, { work_ref: old, statement: 'Finished the old goal.' })
  assert.deepEqual(report.data.work_ref, old); assert.equal(state(f), 'needs-reconfirmation')
  assert.equal(report.data.work_ref.action_revision, 1)
})

test('completion cannot silently replace the worked-against Plan with the latest Plan', t => {
  const f = fixture(t), old = context(f).work_ref
  f.store.savePlan(f.action.id, 1, f.nodes.map(n => n.id === 'worker' ? { ...n, outcome: 'Different output' } : n))
  const report = f.c.complete(worker, { work_ref: old, statement: 'Finished old output.' })
  assert.equal(report.data.work_ref.plan_revision, 1); assert.equal(state(f), 'needs-reconfirmation')
})

test('unrelated replanning retains completion and its traceable original revision', t => {
  const f = fixture(t), report = complete(f)
  f.store.savePlan(f.action.id, 1, f.nodes.map(n => n.id === 'other' ? { ...n, outcome: 'Unrelated change' } : n))
  assert.equal(state(f), 'reported-complete')
  assert.equal(f.c.progress(f.action.id, 'worker').items[0].work_ref.plan_revision, 1)
  assert.equal(context(f).work_ref.plan_revision, 2); assert.equal(context(f).work_ref.hash, report.data.work_ref.hash)
})

for (const kind of ['phase', 'wave', 'task', 'subtask']) test(`${kind} uses the same completion and explicit reopen capability`, t => {
  const f = fixture(t); f.store.savePlan(f.action.id, 1, [{ id: 'node', kind, title: 'Assigned work' }])
  const ref = taskContext(f.store, { action_id: f.action.id, node_id: 'node' }).work_ref
  f.c.complete(worker, { work_ref: ref, statement: 'Finished.' }); assert.equal(state(f, 'node'), 'reported-complete')
  f.c.reopen(worker, { action_id: f.action.id, node_id: 'node' }, 'Another pass.'); assert.equal(state(f, 'node'), 'open')
})

test('new child reconfirms its completed group, without invalidating its completed sibling', t => {
  const f = fixture(t), nodes = [{ id: 'phase', kind: 'phase', title: 'Group' }, task('a', { parent: 'phase' }), task('b', { parent: 'phase' })]
  f.store.savePlan(f.action.id, 1, nodes)
  for (const id of ['phase', 'a']) f.c.complete(worker, { work_ref: taskContext(f.store, { action_id: f.action.id, node_id: id }).work_ref, statement: 'Finished.' })
  f.store.savePlan(f.action.id, 2, [...nodes, task('new', { parent: 'phase' })])
  assert.equal(state(f, 'phase'), 'needs-reconfirmation'); assert.equal(state(f, 'a'), 'reported-complete')
})

test('changed nested child invalidates its group but not unrelated groups', t => {
  const f = fixture(t), nodes = [{ id: 'p', kind: 'phase', title: 'P' }, { id: 'w', kind: 'wave', title: 'W', parent: 'p' }, task('a', { parent: 'w' }), { id: 'other', kind: 'phase', title: 'Other' }]
  f.store.savePlan(f.action.id, 1, nodes)
  for (const node_id of ['p', 'other']) f.c.complete(worker, { work_ref: taskContext(f.store, { action_id: f.action.id, node_id }).work_ref, statement: 'Finished.' })
  f.store.savePlan(f.action.id, 2, nodes.map(n => n.id === 'a' ? { ...n, context: 'New constraint' } : n))
  assert.equal(state(f, 'p'), 'needs-reconfirmation'); assert.equal(state(f, 'other'), 'reported-complete')
})

test('task subtasks and dependency-group contents participate in work identity', t => {
  const f = fixture(t), nodes = [task('parent'), { id: 'child', kind: 'subtask', title: 'Child', parent: 'parent' }, task('consumer', { depends_on: ['parent'] })]
  f.store.savePlan(f.action.id, 1, nodes)
  for (const node_id of ['parent', 'consumer']) f.c.complete(worker, { work_ref: taskContext(f.store, { action_id: f.action.id, node_id }).work_ref, statement: 'Finished.' })
  f.store.savePlan(f.action.id, 2, [...nodes, { id: 'child2', kind: 'subtask', title: 'Child2', parent: 'parent' }])
  assert.equal(state(f, 'parent'), 'needs-reconfirmation'); assert.equal(state(f, 'consumer'), 'needs-reconfirmation')
})

test('Plan-list and dependency-list ordering alone do not change work meaning', t => {
  const f = fixture(t), nodes = [task('research'), task('other'), task('worker', { depends_on: ['research', 'other'] })]
  f.store.savePlan(f.action.id, 1, nodes); complete(f)
  f.store.savePlan(f.action.id, 2, [...nodes].reverse().map(n => n.id === 'worker' ? { ...n, depends_on: ['other', 'research'] } : n))
  assert.equal(state(f), 'reported-complete')
})

test('completion does not complete parent, child, dependent or Action', t => {
  const f = fixture(t), nodes = [{ id: 'p', kind: 'phase', title: 'P' }, task('worker', { parent: 'p' }), { id: 'sub', kind: 'subtask', title: 'S', parent: 'worker' }, task('after', { depends_on: ['worker'] })]
  f.store.savePlan(f.action.id, 1, nodes); complete(f)
  for (const id of ['p', 'sub', 'after']) assert.equal(state(f, id), 'open')
  assert.equal(f.store.action(f.action.id).state, 'active')
})

test('a completed report can coexist with a failed QA verdict and open questions', t => {
  const f = fixture(t); ask(f); f.store.record(research, f.focus, { kind: 'qa', verdict: 'fail', statement: 'Needs investigation.' }); complete(f)
  assert.equal(state(f), 'reported-complete'); assert.equal(context(f).questions[0].state, 'open')
  assert.ok(context(f).records.some(r => r.data.verdict === 'fail'))
})

test('missing, forged, cross-node and unavailable-revision work references fail without writes', t => {
  const f = fixture(t), ref = context(f).work_ref, before = f.store.records({ action_id: f.action.id }).items
  for (const work_ref of [undefined, { ...ref, hash: '0'.repeat(64) }, { ...ref, node_id: 'research' }, { ...ref, action_revision: 99 }, { ...ref, plan_revision: 99 }])
    assert.throws(() => f.c.complete(worker, { work_ref, statement: 'Not supported.' }))
  assert.deepEqual(f.store.records({ action_id: f.action.id }).items, before)
})

test('a completion may record removed historical work without making it current again', t => {
  const f = fixture(t), ref = context(f).work_ref; f.store.savePlan(f.action.id, 1, [task('research')])
  f.c.complete(worker, { work_ref: ref, statement: 'Old assignment finished.' })
  assert.equal(state(f), 'needs-reconfirmation'); assert.equal(f.store.plan(f.action.id).nodes.length, 1)
  f.c.reopen(worker, f.focus, 'Explicitly open historical work.'); assert.equal(state(f), 'open')
})

test('failed completion append preserves history and allows a retry', t => {
  const f = fixture(t), ref = context(f).work_ref
  f.db.exec("CREATE TRIGGER deny_completion BEFORE INSERT ON ledger WHEN NEW.kind='completion' BEGIN SELECT RAISE(ABORT,'refused'); END;")
  assert.throws(() => f.c.complete(worker, { work_ref: ref, statement: 'Finished.' }), /refused/)
  assert.equal(state(f), 'open'); f.db.exec('DROP TRIGGER deny_completion'); complete(f); assert.equal(state(f), 'reported-complete')
})

test('failed Action update rolls back the archived definition as well', t => {
  const f = fixture(t)
  f.db.exec("CREATE TRIGGER deny_action BEFORE UPDATE ON actions BEGIN SELECT RAISE(ABORT,'refused'); END;")
  assert.throws(() => f.store.update(f.action.id, 1, { goal: 'Change' }), /refused/)
  assert.equal(f.db.prepare('SELECT COUNT(*) n FROM action_versions').get().n, 0)
  assert.equal(f.store.action(f.action.id).revision, 1)
})

test('Action progress labels do not invalidate an unchanged work definition', t => {
  const f = fixture(t); complete(f); f.store.update(f.action.id, 1, { state: 'paused' }); assert.equal(state(f), 'reported-complete')
})

test('reopening appends history and a later explicit report can close the same definition', t => {
  const f = fixture(t), first = complete(f), reopened = f.c.reopen(worker, f.focus, 'Revisit it.'), last = complete(f)
  assert.equal(reopened.data.previous_report_id, first.id); assert.notEqual(first.id, last.id)
  assert.deepEqual(f.store.records({ action_id: f.action.id }).items.map(r => r.kind), ['completion', 'reopen', 'completion'])
})

test('question addressing is advisory; recorded actual author is not impersonated', t => {
  const f = fixture(t), q = ask(f), a = f.c.answer({ session_id: 's2', agent: 'another-expert' }, { question_id: q.id, statement: 'A response, not a resolution.' })
  assert.equal(a.agent, 'another-expert'); assert.equal(f.c.thread(q.id).question.data.respondent, 'research')
  assert.equal(f.c.questions({ action_id: f.action.id, state: 'answered' }).items[0].state, 'answered')
})

test('answering an Action-only question preserves scope and does not need selection', t => {
  const f = fixture(t), q = f.c.ask(worker, { action_id: f.action.id }, { statement: 'General question?', respondent: 'user' })
  const a = f.c.answer({ session_id: 'fresh', agent: 'user-reply' }, { question_id: q.id, statement: 'General response.' })
  assert.equal(a.node_id, undefined); assert.equal(f.store.hasSelection('fresh'), false)
})

test('removed tasks keep questions and accept answers without rebinding', t => {
  const f = fixture(t), q = ask(f); f.store.savePlan(f.action.id, 1, [task('research')]); answer(f, q)
  const thread = f.c.thread(q.id); assert.equal(thread.answers[0].node_id, 'worker')
  const recovery = taskContextOrRecovery(f.store, f.focus, 2000, 'worker')
  assert.equal(recovery.recovery.code, 'task-not-in-current-plan'); assert.equal(recovery.questions[0].question_id, q.id)
  assert.ok(JSON.stringify(recovery).length <= 2000)
})

test('wrong-Action and unknown-question answers fail without selection or ledger changes', t => {
  const f = fixture(t), q = ask(f), other = f.store.create('B', 'Other', research), before = f.store.records({ session_id: research.session_id }).items
  assert.throws(() => f.c.answer(research, { question_id: q.id, action_id: other.id, statement: 'Wrong scope.' }), /another Action/)
  assert.throws(() => f.c.answer(research, { question_id: 'absent', statement: 'Unknown.' }), /Unknown question/)
  assert.deepEqual(f.store.records({ session_id: research.session_id }).items, before)
  assert.equal(f.store.selected(research.session_id).action_id, other.id)
})

test('qualified and conflicting answers remain complete, distinct and paged', t => {
  const f = fixture(t), q = ask(f), first = answer(f, q)
  const second = f.c.answer(research, { question_id: q.id, statement: 'Conflicting response with a material qualification at the end.' })
  const page = f.c.thread(q.id, 0, 1)
  assert.equal(page.answers[0].id, first.id); assert.ok(page.next_after)
  const next = f.c.thread(q.id, page.next_after, 1); assert.equal(next.answers[0].id, second.id); assert.equal(next.next_after, null)
  assert.match(next.note, /not resolution, approval or permission/)
  assert.equal(f.c.questions({ action_id: f.action.id, state: 'answered' }).items[0].answers_have_more, true)
})

test('failed answer append leaves the question open', t => {
  const f = fixture(t), q = ask(f)
  f.db.exec("CREATE TRIGGER deny_answer BEFORE INSERT ON ledger WHEN NEW.kind='answer' BEGIN SELECT RAISE(ABORT,'refused'); END;")
  assert.throws(() => answer(f, q), /refused/)
  assert.equal(f.c.questions({ action_id: f.action.id }).items[0].state, 'open')
})

test('old open questions survive observation noise and newer answered threads', t => {
  const f = fixture(t), old = ask(f)
  for (let i = 0; i < 80; i++) f.store.observe(worker, f.focus, { phase: 'finished' })
  for (let i = 0; i < 12; i++) answer(f, ask(f))
  assert.equal(context(f).questions[0].question_id, old.id); assert.equal(context(f).questions[0].state, 'open')
  assert.equal(f.c.questions({ action_id: f.action.id }).items.length, 1)
})

test('recipient context includes incoming questions without selecting the asker task', t => {
  const f = fixture(t), q = ask(f)
  const own = { action_id: f.action.id, node_id: 'research' }
  assert.ok(taskContext(f.store, own, 16000, 'research').questions.some(x => x.question_id === q.id))
  assert.ok(!taskContext(f.store, own, 16000, 'unrelated-agent').questions.some(x => x.question_id === q.id))
  assert.deepEqual(f.store.selected(research.session_id), own)
})

test('recipient queries cannot leak questions from another Action', t => {
  const f = fixture(t), q = ask(f), other = f.store.create('Other', 'Other goal', research)
  assert.equal(f.c.questions({ action_id: other.id, respondent: 'research' }).items.length, 0)
  assert.equal(taskContext(f.store, { action_id: other.id }, 16000, 'research').questions.length, 0)
  assert.throws(() => f.c.thread(q.id, 0, 20, other.id), /another Action/)
})

test('question pages expose every pending question and explicit context omissions', t => {
  const f = fixture(t), ids = Array.from({ length: 12 }, () => ask(f).id), seen = []; let after = 0
  do { const p = f.c.questions({ action_id: f.action.id, limit: 3, after }); seen.push(...p.items.map(q => q.question_id)); after = p.next_after } while (after !== null)
  assert.deepEqual(seen, ids); const ctx = context(f); assert.equal(ctx.questions.length, 6); assert.equal(ctx.collaboration_has_more, true)
})

test('compact context retains a qualified answer excerpt and exact lookup at 2000 characters', t => {
  const f = fixture(t), q = ask(f); const a = answer(f, q)
  f.store.update(f.action.id, 1, { goal: 'Long goal '.repeat(1000) })
  const ctx = taskContext(f.store, f.focus, 2000, 'worker'); assert.ok(JSON.stringify(ctx).length <= 2000)
  assert.equal(ctx.questions[0].question_id, q.id); assert.equal(ctx.questions[0].answer.record_id, a.id)
  assert.equal(ctx.questions[0].excerpted, true); assert.match(ctx.note, /qualifications/)
  assert.equal(f.c.thread(q.id).answers[0].data.statement, a.data.statement)
})

test('context reads have no ledger or selection side effects', t => {
  const f = fixture(t); ask(f); complete(f); const rows = f.store.records({ action_id: f.action.id }).items, focus = f.store.selected(worker.session_id)
  context(f); context(f); assert.deepEqual(f.store.records({ action_id: f.action.id }).items, rows); assert.deepEqual(f.store.selected(worker.session_id), focus)
})

test('unknown questions, invalid pagination and oversized writes preserve data', t => {
  const f = fixture(t), before = f.store.records({ action_id: f.action.id }).items
  assert.throws(() => f.c.ask(worker, f.focus, { statement: 'x'.repeat(16001), respondent: 'research' }))
  assert.throws(() => f.c.questions({ action_id: f.action.id, state: 'resolved' }))
  assert.throws(() => f.c.thread('unknown')); assert.throws(() => f.c.progress(f.action.id, undefined, 0, 51))
  assert.deepEqual(f.store.records({ action_id: f.action.id }).items, before)
})

test('a failed work hash is never replaced by a prefix or an apparently completed comparison', t => {
  const f = fixture(t); assert.throws(() => workReference(f.action, f.store.plan(f.action.id), 'worker', new ProcessingBudget(10)), ProcessingLimitError)
  const nodes = Array.from({ length: 80 }, (_, i) => task('t' + i, { context: 'x'.repeat(1500) }))
  f.store.savePlan(f.action.id, 1, [{ id: 'p', kind: 'phase', title: 'P' }, ...nodes.map(n => ({ ...n, parent: 'p' }))])
  for (const n of nodes.slice(0, 20)) f.c.complete(worker, { work_ref: taskContext(f.store, { action_id: f.action.id, node_id: n.id }).work_ref, statement: 'Done.' })
  // Every task includes its own text and the parent contract, not sibling bodies.
  assert.ok(f.c.progress(f.action.id, undefined, 0, 50).items.every(p => p.state !== 'needs-reconfirmation'))
})

test('two connections preserve Action versions needed by a late report', t => {
  const dir = mkdtempSync(join(tmpdir(), 'loom-versions-')); t.after(() => rmSync(dir, { recursive: true, force: true }))
  const path = join(dir, 'db'), f = fixture(t, new DatabaseSync(path)), ref = context(f).work_ref
  const db2 = new DatabaseSync(path); t.after(() => db2.close()); const s2 = new Store(db2)
  s2.update(f.action.id, 1, { goal: 'Changed by another connection' })
  f.c.complete(worker, { work_ref: ref, statement: 'Original assignment done.' })
  assert.equal(state(f), 'needs-reconfirmation')
})

test('an old question answered now becomes a recent answered thread', t => {
  const f = fixture(t), old = ask(f)
  for (let i = 0; i < 8; i++) answer(f, ask(f))
  answer(f, old)
  assert.equal(context(f).questions[0].question_id, old.id)
})

test('progress hash exhaustion is explicitly unknown, never a false mismatch', t => {
  const f = fixture(t), nodes = [
    ...Array.from({ length: 20 }, (_, i) => task('use' + i, { depends_on: ['group'] })),
    { id: 'group', kind: 'phase', title: 'Shared input' },
    ...Array.from({ length: 75 }, (_, i) => task('input' + i, { parent: 'group', context: 'x'.repeat(1800) })),
  ]
  const plan = f.store.savePlan(f.action.id, 1, nodes)
  for (const node of nodes.slice(0, 20)) f.c.complete(worker, { work_ref: workReference(f.action, plan, node.id), statement: 'Done.' })
  const progress = f.c.progress(f.action.id, undefined, 0, 20)
  assert.ok(progress.items.some(p => p.state === 'reported-complete'))
  assert.ok(progress.items.some(p => p.state === 'validity-unknown' && p.reason === 'processing-limit'))
  assert.ok(progress.items.every(p => p.state !== 'needs-reconfirmation'))
})

test('combined question transfers are bounded before loading a large body set', t => {
  const f = fixture(t), refs = Array.from({ length: 48 }, () => 'x'.repeat(2000))
  for (let i = 0; i < 45; i++) f.c.ask(worker, f.focus, { statement: 'Question ' + i, respondent: 'research', artifact_refs: refs })
  assert.throws(() => f.c.questions({ action_id: f.action.id, limit: 50 }), /4 MiB/)
  assert.equal(f.c.questions({ action_id: f.action.id, limit: 1 }).items.length, 1)
  assert.equal(f.db.prepare("SELECT COUNT(*) n FROM ledger WHERE kind='question'").get().n, 45)
})

test('minimum output budget handles long node IDs and escaped question text', t => {
  const f = fixture(t), node_id = 'n'.repeat(120)
  f.store.savePlan(f.action.id, 1, [task(node_id)])
  f.focus = { action_id: f.action.id, node_id }
  f.c.ask(worker, f.focus, { statement: '\u0001'.repeat(150) + 'Still a question', respondent: 'research' })
  const ctx = taskContext(f.store, f.focus, 2000, 'worker')
  assert.ok(JSON.stringify(ctx).length <= 2000)
  assert.ok(ctx.questions.length > 0 || ctx.omitted.questions > 0)
  assert.ok(ctx.work_ref || ctx.work_ref_reason)
})

test('new operation routing rejects ambiguous fields and never substitutes selection for work_ref', t => {
  const f = fixture(t), ref = context(f).work_ref
  assert.throws(() => f.c.execute(worker, { operation: 'complete', statement: 'Missing reference' }, f.focus), /work_ref/)
  assert.throws(() => f.c.execute(worker, { operation: 'complete', work_ref: ref, node_id: 'other', statement: 'Mismatched' }, f.focus), /disagrees/)
  const q = ask(f)
  assert.throws(() => f.c.execute(research, { operation: 'answer', question_id: q.id, node_id: 'other', statement: 'Wrong' }), /not supported/)
  assert.throws(() => f.c.execute(research, { operation: 'query', view: 'thread', question_id: q.id, session_only: true }), /not supported/)
  const response = f.c.execute(research, { operation: 'answer', question_id: q.id, statement: 'A qualified response.' })
  assert.equal(response.node_id, f.focus.node_id)
  assert.equal(f.c.execute(worker, { operation: 'query', view: 'thread', question_id: q.id }).answers[0].id, response.id)
})

test('question context and progress retain the read snapshot across a concurrent update', t => {
  const dir = mkdtempSync(join(tmpdir(), 'loom-collab-snapshot-')); t.after(() => rmSync(dir, { recursive: true, force: true }))
  const path = join(dir, 'db'), db = new DatabaseSync(path), f = fixture(t, db), before = context(f).work_ref
  complete(f); const q = ask(f)
  const otherDb = new DatabaseSync(path); t.after(() => otherDb.close()); const other = new Store(otherDb)
  let changed = false
  const wrapped = { exec: sql => db.exec(sql), prepare: sql => {
    const prepared = db.prepare(sql)
    const wrap = name => (...args) => {
      if (!changed && sql.includes("q.kind='question'")) { changed = true; other.update(f.action.id, 1, { goal: 'Concurrent new goal' }) }
      return prepared[name](...args)
    }
    return { get: wrap('get'), all: wrap('all'), run: wrap('run') }
  } }
  const reader = new Store(wrapped), got = taskContext(reader, f.focus)
  assert.equal(changed, true); assert.deepEqual(got.work_ref, before)
  assert.equal(got.progress.find(p => p.node_id === 'worker').state, 'reported-complete')
  assert.equal(got.questions[0].question_id, q.id)
  assert.equal(other.action(f.action.id).goal, 'Concurrent new goal')
})
