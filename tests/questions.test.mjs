import { test } from 'node:test'
import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Worker } from 'node:worker_threads'
import { Store } from '../.test-build/store.js'

const asker = { session_id: 'asker', agent: 'author' }, respondent = { session_id: 'respondent', agent: 'investigator' }
const questionInput = { question: 'Which commit?', to_agent: 'investigator', blocking: true }
const answerInput = question_id => ({ question_id, answer: 'This committed answer.' })
function fixture(t) {
  const db = new DatabaseSync(':memory:'); t.after(() => db.close())
  const store = new Store(db)
  return { db, store, c: store.collaboration }
}

test('only first new blocking answer gets ephemeral postcommit eligibility, including without Action', t => {
  const { db, store, c } = fixture(t)
  for (const blocking of [true, false]) {
    const q = c.ask(asker, undefined, { ...questionInput, blocking })
    const first = c.answer(respondent, answerInput(q.id))
    assert.deepEqual(first.resume, blocking ? { question_id: q.id, answer_id: first.record.id, asking_session_id: 'asker' } : undefined)
    assert.equal(first.record.action_id, undefined)
    assert.equal(first.record.node_id, undefined)
    assert.equal(c.answer(respondent, answerInput(q.id)).resume, undefined)
    const raw = db.prepare("SELECT data FROM ledger WHERE id=?").get(first.record.id).data
    assert.equal(raw.includes('resume'), false)
    const fresh = new Store(db)
    assert.equal(fresh.collaboration.answer(respondent, answerInput(q.id)).resume, undefined)
    assert.deepEqual(c.thread(q.id).answers.map(a => a.data.answer), Array(3).fill('This committed answer.'))
    assert.equal(store.selected(asker.session_id), undefined)
  }
})

test('ANY historical answer counts; legacy questions never acquire blocking semantics', t => {
  const { store, c } = fixture(t)
  // Explicit synthetic historical inputs for the decision boundary. The separate
  // frozen-producer preservation suite proves real old-API history compatibility.
  for (const data of [
    { statement: 'Legacy question', respondent: 'investigator' },
    { statement: 'Historical unknown consent', blocking: true },
    { format: 'loom-question/v1', ...questionInput },
  ]) {
    const q = data.format ? c.ask(asker, undefined, questionInput) : store.append({ ...asker, kind: 'question', data })
    if (data.format) store.append({ ...respondent, kind: 'answer', data: { question_id: q.id, statement: 'Old format answer counts too' } })
    assert.equal(c.answer(respondent, answerInput(q.id)).resume, undefined)
    assert.equal(c.answer(respondent, answerInput(q.id)).resume, undefined)
    assert.deepEqual(c.thread(q.id).question.data, data.format ? JSON.parse(JSON.stringify(q.data)) : data)
  }
})

test('append refusal and genuine deferred foreign-key COMMIT failure produce no handoff or committed answer', t => {
  const { db, store, c } = fixture(t)
  const q = c.ask(asker, undefined, questionInput)
  db.exec("CREATE TRIGGER refuse_answer BEFORE INSERT ON ledger WHEN NEW.kind='answer' BEGIN SELECT RAISE(ABORT,'refused'); END")
  let handoff
  assert.throws(() => { handoff = c.answer(respondent, answerInput(q.id)) }, /refused/)
  assert.equal(handoff, undefined); assert.equal(c.thread(q.id).answers.length, 0)
  db.exec('DROP TRIGGER refuse_answer; CREATE TABLE parent(id INTEGER PRIMARY KEY); CREATE TABLE deferred_child(id INTEGER REFERENCES parent(id) DEFERRABLE INITIALLY DEFERRED);')
  db.exec("CREATE TRIGGER fail_commit AFTER INSERT ON ledger WHEN NEW.kind='answer' BEGIN INSERT INTO deferred_child(id) VALUES(999); END")
  assert.throws(() => { handoff = c.answer(respondent, answerInput(q.id)) }, /FOREIGN KEY/)
  assert.equal(handoff, undefined); assert.equal(c.thread(q.id).answers.length, 0)
  assert.equal(db.prepare('SELECT count(*) AS n FROM deferred_child').get().n, 0)
  db.exec('DROP TRIGGER fail_commit')
  const committed = c.answer(respondent, answerInput(q.id))
  assert.equal(committed.resume.answer_id, committed.record.id)
  assert.equal(store.records({ session_id: respondent.session_id }).items.length, 1)
})

test('explicit references are associations, selected scope fills only omissions, removed nodes still accept answers', t => {
  const { store, c } = fixture(t)
  const action = store.create('A', 'Goal', asker)
  const nodes = ['phase', 'wave', 'task', 'subtask'].map(kind => ({ id: kind, kind, title: kind }))
  store.savePlan(action.id, 0, nodes)
  for (const n of [{ id: action.id, kind: 'action' }, ...nodes]) {
    const q = c.ask(asker, { action_id: action.id, node_id: 'task' }, { ...questionInput, reference: { action_id: action.id, kind: n.kind, id: n.id } })
    assert.equal(q.action_id, action.id); assert.equal(q.node_id, n.kind === 'action' ? undefined : n.id)
    assert.equal(q.data.work_ref, undefined)
  }
  const q = c.ask(asker, { action_id: action.id, node_id: 'task' }, questionInput)
  assert.deepEqual(q.data.reference, { action_id: action.id, kind: 'task', id: 'task' })
  store.savePlan(action.id, 1, [])
  const other = store.create('Other', 'Other', respondent), before = store.selected('respondent')
  const response = c.answer(respondent, answerInput(q.id))
  assert.equal(response.record.node_id, 'task'); assert.equal(response.record.action_id, action.id)
  assert.deepEqual(store.selected('respondent'), before)
  assert.equal(c.questions({ action_id: other.id, state: 'all' }).items.length, 0)
})

test('simultaneous real SQLite writers grant only one committed firstness result', async t => {
  const dir = mkdtempSync(join(tmpdir(), 'loom-answer-race-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  const path = join(dir, 'ledger.sqlite'), db = new DatabaseSync(path)
  t.after(() => db.close())
  const store = new Store(db), q = store.collaboration.ask(asker, undefined, questionInput)
  const barrier = new SharedArrayBuffer(4)
  const program = `const { parentPort, workerData: d } = require('node:worker_threads'); const { DatabaseSync } = require('node:sqlite');
    (async () => { const { Store } = await import(d.module); const db = new DatabaseSync(d.path);
      try { const c = new Store(db).collaboration; parentPort.postMessage({ready:true}); Atomics.wait(new Int32Array(d.barrier),0,0);
        const commit=c.answer({session_id:d.session,agent:'investigator'},{question_id:d.question,answer:'Concurrent '+d.session});
        parentPort.postMessage({commit}); } finally {db.close()} })().catch(e=>{throw e})`
  const workers = [0, 1, 2, 3].map(i => new Worker(program, { eval: true, workerData: { path, barrier, question: q.id, session: 'writer' + i, module: new URL('../.test-build/store.js', import.meta.url).href } }))
  t.after(async () => { await Promise.all(workers.map(w => w.terminate())) })
  const ready = [], results = []
  for (const w of workers) {
    ready.push(new Promise((resolve, reject) => { w.on('error', reject); w.on('message', m => { if (m.ready) resolve() }) }))
    results.push(new Promise((resolve, reject) => { w.on('error', reject); w.on('message', m => { if (m.commit) resolve(m.commit) }) }))
  }
  await Promise.all(ready)
  Atomics.store(new Int32Array(barrier), 0, 1); Atomics.notify(new Int32Array(barrier), 0)
  const commits = await Promise.all(results), eligible = commits.filter(c => c.resume)
  assert.equal(eligible.length, 1)
  const history = store.collaboration.thread(q.id).answers
  assert.equal(history.length, 4)
  assert.equal(eligible[0].resume.answer_id, history[0].id)
  assert.equal(new Set(history.map(a => a.session_id)).size, 4)
})
