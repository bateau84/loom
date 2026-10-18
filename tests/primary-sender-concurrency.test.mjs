import { test } from 'node:test'
import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Worker } from 'node:worker_threads'
import { Store } from '../.test-build/store.js'

test('independent concurrent retired-operation attempts cannot create work or delivery state', async t => {
  const dir = mkdtempSync(join(tmpdir(), 'loom-retired-race-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  const path = join(dir, 'ledger.sqlite'), db = new DatabaseSync(path)
  t.after(() => db.close())
  new Store(db)
  const barrier = new SharedArrayBuffer(4)
  const program = `const { parentPort, workerData } = require('node:worker_threads'); const { DatabaseSync } = require('node:sqlite');
    (async () => { const { Store } = await import(workerData.module); const db = new DatabaseSync(workerData.path);
      try { const c = new Store(db).collaboration; parentPort.postMessage({ready:true}); Atomics.wait(new Int32Array(workerData.barrier),0,0);
        const errors=[]; for(const operation of ['assign','authorize-continuation','withdraw-continuation','retry-delivery']) {
          try { c.execute({session_id:'primary',agent:'author'},{operation,assignment_id:'old',delivery_id:'old'}); errors.push('unexpected success') }
          catch(e) {errors.push(e.message)}
        } parentPort.postMessage({errors});
      } finally {db.close()} })().catch(e => {throw e})`
  const workers = [0, 1].map(() => new Worker(program, { eval: true, workerData: { path, barrier, module: new URL('../.test-build/store.js', import.meta.url).href } }))
  t.after(async () => { await Promise.all(workers.map(w => w.terminate())) })
  const results = workers.map(w => new Promise((resolve, reject) => { w.on('error', reject); w.on('message', m => { if (m.errors) resolve(m.errors) }) }))
  await Promise.all(workers.map(w => new Promise((resolve, reject) => { w.on('error', reject); w.on('message', m => { if (m.ready) resolve() }) })))
  Atomics.store(new Int32Array(barrier), 0, 1); Atomics.notify(new Int32Array(barrier), 0)
  for (const errors of await Promise.all(results)) assert.deepEqual(errors, Array(4).fill('Unknown collaboration operation/view'))
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM ledger').get().n, 0)
  assert.equal(db.prepare("SELECT name FROM sqlite_schema WHERE name='primary_deliveries'").get(), undefined)
})
