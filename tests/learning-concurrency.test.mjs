import { test } from 'node:test'
import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { Worker } from 'node:worker_threads'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { Learning } from '../.test-build/learning.js'
import { Store } from '../.test-build/store.js'

const actor = { session_id: 'parent', agent: 'evaluator' }
const hash = text => createHash('sha256').update(text).digest('hex')
const WAIT_MS = 10000

function release(shared) {
  const gate = new Int32Array(shared)
  Atomics.store(gate, 0, 1)
  Atomics.notify(gate, 0)
}

// Executed by a real Node worker. The wrapper delegates every SQL statement to
// the real file-backed connection; it only gates after an actual status read.
async function learningWorker() {
  const { parentPort, workerData: input } = require('node:worker_threads')
  const { DatabaseSync } = require('node:sqlite')
  const { Learning } = await import(input.learningModule)
  const { Store } = await import(input.storeModule)
  function awaitGate(shared, name) {
    const gate = new Int32Array(shared)
    Atomics.wait(gate, 0, 0, 10000)
    if (Atomics.load(gate, 0) !== 1) throw new Error('Timed out at ' + name)
  }
  const actionDB = new DatabaseSync(':memory:')
  const db = new DatabaseSync(input.path)
  try {
    const store = new Store(actionDB)
    let paused = false
    const sql = {
      exec: statement => db.exec(statement),
      prepare: statement => {
        const query = db.prepare(statement)
        if (!input.holdStatusRead || statement !== 'SELECT status FROM learning_candidates WHERE id=?') return query
        return {
          get(...args) {
            const row = query.get(...args)
            if (!paused) {
              paused = true
              parentPort.postMessage({ phase: 'status-read', status: row?.status })
              awaitGate(input.pauseGate, 'status-read gate')
            }
            return row
          },
          all: (...args) => query.all(...args),
          run: (...args) => query.run(...args),
        }
      },
    }
    const learning = new Learning(sql, store, actionDB)
    function readback() {
      return {
        status: db.prepare('SELECT status FROM learning_candidates WHERE id=?').get(input.candidateId).status,
        trialCount: db.prepare('SELECT COUNT(*) AS count FROM learning_trials WHERE candidate_id=?').get(input.candidateId).count,
      }
    }
    function attempt(phase) {
      let result, error
      try {
        result = input.operation === 'trial'
          ? learning.trial({ session_id: 'worker-' + input.operation, agent: 'evaluator' }, {
              id: input.candidateId, observed_effect: 'neutral', statement: 'Concurrent worker report',
              evidence_refs: ['source:concurrent-worker'],
            })
          : learning.retire(input.candidateId)
      } catch (caught) {
        error = { message: caught.message, code: caught.code ?? null }
      }
      parentPort.postMessage({ phase, result, error, readback: readback() })
    }
    parentPort.postMessage({ phase: 'ready' })
    awaitGate(input.startGate, 'start gate')
    attempt('first')
    if (input.retry) {
      awaitGate(input.retryGate, 'retry gate')
      attempt('retry')
      // Same connection remains writable after BUSY and after a rejected trial.
      const reused = learning.retire(input.candidateId)
      parentPort.postMessage({ phase: 'reuse', result: reused, readback: readback() })
    }
  } finally {
    db.close()
    actionDB.close()
  }
}

function fixture(t) {
  const dir = mkdtempSync(join(tmpdir(), 'loom-learning-race-'))
  const path = join(dir, 'learning.sqlite')
  const actionDB = new DatabaseSync(':memory:')
  const db = new DatabaseSync(path)
  const store = new Store(actionDB)
  const learning = new Learning(db, store, actionDB)
  const candidate = learning.propose(actor, { target_kind: 'skill', target_id: 'reviewer',
    base_sha256: hash('original instructions'), candidate_content: 'Proposed revised instructions',
    hypothesis: 'Retain successful and unsuccessful reports', evidence_refs: ['source:original'] })
  const previous = learning.trial(actor, { id: candidate.id, observed_effect: 'harmful',
    statement: 'Earlier negative evidence', evidence_refs: ['source:older-trial'] })
  const children = []
  const gates = []
  t.after(async () => {
    for (const gate of gates) release(gate)
    await Promise.all(children.map(child => child.terminate()))
    db.close()
    actionDB.close()
    rmSync(dir, { recursive: true, force: true })
  })
  function spawn(operation, holdStatusRead, retry) {
    const startGate = new SharedArrayBuffer(4)
    const pauseGate = new SharedArrayBuffer(4)
    const retryGate = new SharedArrayBuffer(4)
    gates.push(startGate, pauseGate, retryGate)
    const child = new Worker('(' + learningWorker.toString() + ')().catch(error => { throw error })', {
      eval: true,
      workerData: { path, operation, candidateId: candidate.id, holdStatusRead, retry,
        startGate, pauseGate, retryGate,
        learningModule: new URL('../.test-build/learning.js', import.meta.url).href,
        storeModule: new URL('../.test-build/store.js', import.meta.url).href },
    })
    children.push(child)
    const messages = new Map()
    const waiters = new Map()
    let failure
    function fail(error) {
      failure = error
      for (const waiter of waiters.values()) {
        clearTimeout(waiter.timer)
        waiter.reject(error)
      }
      waiters.clear()
    }
    child.on('message', message => {
      messages.set(message.phase, message)
      const waiter = waiters.get(message.phase)
      if (waiter) {
        clearTimeout(waiter.timer)
        waiters.delete(message.phase)
        waiter.resolve(message)
      }
    })
    child.on('error', fail)
    child.on('exit', code => {
      if (code !== 0 && !failure) fail(new Error('Learning worker exited with code ' + code))
    })
    return {
      start: () => release(startGate),
      resume: () => release(pauseGate),
      retry: () => release(retryGate),
      wait(phase) {
        if (messages.has(phase)) return Promise.resolve(messages.get(phase))
        if (failure) return Promise.reject(failure)
        return new Promise((resolve, reject) => {
          const timer = setTimeout(() => {
            waiters.delete(phase)
            reject(new Error('Timed out waiting for worker ' + operation + ': ' + phase))
          }, WAIT_MS)
          waiters.set(phase, { resolve, reject, timer })
        })
      },
    }
  }
  function persisted() {
    return {
      candidate: db.prepare('SELECT id,status,base_sha256,candidate_sha256,evidence_refs FROM learning_candidates WHERE id=?').get(candidate.id),
      trials: db.prepare('SELECT id,statement,observed_effect,evidence_refs FROM learning_trials WHERE candidate_id=? ORDER BY rowid').all(candidate.id),
    }
  }
  return { learning, candidate, previous, spawn, persisted }
}

for (const firstOperation of ['trial', 'retire']) {
  test('learning concurrent ' + firstOperation + '-first admission serializes and preserves history', { timeout: 20000 }, async t => {
    const f = fixture(t)
    const secondOperation = firstOperation === 'trial' ? 'retire' : 'trial'
    const first = f.spawn(firstOperation, true, false)
    const second = f.spawn(secondOperation, false, true)
    await Promise.all([first.wait('ready'), second.wait('ready')])

    first.start()
    assert.equal((await first.wait('status-read')).status, 'proposed')
    second.start()
    // The first writer holds its actual SQLite reservation while the second
    // reaches the real busy timeout. No guessed sleep chooses the winner.
    const contested = await second.wait('first')
    first.resume()
    const committed = await first.wait('first')
    second.retry()
    const retried = await second.wait('retry')
    const reused = await second.wait('reuse')
    const rows = f.persisted()

    // With trial serialization removed, retirement commits while the trial is
    // paused on a stale status read, then that trial can be inserted afterward.
    if (firstOperation === 'trial') {
      assert.equal(Boolean(contested.result?.status === 'retired' && committed.result?.id), false,
        'a new trial must not be admitted after retirement took effect')
    }
    assert.match(contested.error?.message ?? '', /busy|locked/i)
    assert.equal(typeof contested.readback.trialCount, 'number', 'BUSY leaves the connection readable')
    assert.equal(contested.readback.status, 'proposed')
    assert.equal(committed.error, undefined)
    assert.equal(rows.candidate.status, 'retired')
    assert.equal(rows.candidate.base_sha256, f.candidate.base_sha256)
    assert.equal(rows.candidate.candidate_sha256, f.candidate.candidate_sha256)
    assert.equal(rows.candidate.evidence_refs, JSON.stringify(['source:original']))
    assert.equal(rows.trials[0].id, f.previous.id)
    assert.equal(rows.trials[0].statement, 'Earlier negative evidence')
    assert.equal(rows.trials[0].observed_effect, 'harmful')
    assert.equal(rows.trials[0].evidence_refs, JSON.stringify(['source:older-trial']))
    assert.equal(reused.result.status, 'retired', 'the conflicting/rejected worker can still write')
    assert.equal(reused.readback.status, 'retired')

    if (firstOperation === 'trial') {
      assert.equal(retried.result?.status, 'retired')
      assert.deepEqual(rows.trials.map(row => row.id), [f.previous.id, committed.result.id])
      assert.equal(rows.trials[1].statement, 'Concurrent worker report')
    } else {
      assert.equal(committed.result?.status, 'retired')
      assert.match(retried.error?.message ?? '', /retired candidate/i)
      assert.deepEqual(rows.trials.map(row => row.id), [f.previous.id])
    }
    assert.throws(() => f.learning.trial(actor, { id: f.candidate.id,
      observed_effect: 'promising', statement: 'Disallowed after retirement' }), /retired candidate/)
    assert.deepEqual(f.persisted().trials.map(row => row.id), rows.trials.map(row => row.id))
  })
}
