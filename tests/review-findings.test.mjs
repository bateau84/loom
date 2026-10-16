import { test } from 'node:test'
import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { mkdtemp, open, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Store } from '../.test-build/store.js'
import { Observer, taskContext } from '../.test-build/context.js'
import { loadConfig } from '../.test-build/config.js'
import { digest } from '../.test-build/model.js'

const actor = { session_id: 'worker', agent: 'author' }
function fixture(t) {
  const db = new DatabaseSync(':memory:'); t.after(() => db.close())
  const store = new Store(db), action = store.create('Review regressions', 'Preserve qualifications', actor)
  return { db, store, action }
}

test('parent criteria changes invalidate child completion without affecting another group', t => {
  const { store, action } = fixture(t)
  const nodes = [
    { id: 'phase', kind: 'phase', title: 'Parent', criteria: ['Preserve source qualifications'] },
    { id: 'wave', kind: 'wave', title: 'Intermediate group', parent: 'phase' },
    { id: 'child', kind: 'task', title: 'Child', parent: 'wave' },
    { id: 'elsewhere', kind: 'phase', title: 'Independent group' },
    { id: 'independent', kind: 'task', title: 'Independent task', parent: 'elsewhere' },
  ]
  store.savePlan(action.id, 0, nodes)
  const refs = new Map()
  for (const node_id of ['child', 'independent']) {
    const ref = taskContext(store, { action_id: action.id, node_id }).work_ref
    assert.ok(ref); refs.set(node_id, ref)
    store.collaboration.complete(actor, { work_ref: ref, statement: 'Performed the original work.' })
  }
  store.savePlan(action.id, 1, nodes.map(n => n.id === 'phase' ? { ...n, criteria: ['Preserve sources AND document every exception'] } : n))
  const child = store.collaboration.progress(action.id, 'child').items[0]
  assert.equal(child.state, 'needs-reconfirmation')
  assert.deepEqual(child.work_ref, refs.get('child'))
  assert.notEqual(taskContext(store, { action_id: action.id, node_id: 'child' }).work_ref.hash, refs.get('child').hash)
  assert.equal(store.collaboration.progress(action.id, 'independent').items[0].state, 'reported-complete')
  assert.equal(store.action(action.id).state, 'active')
})

for (const withStart of [true, false]) test(`failed finish persists error status (${withStart ? 'paired' : 'missing start'})`, t => {
  const { db, store, action } = fixture(t), observer = new Observer(store)
  const event = { sessionID: actor.session_id, agent: actor.agent, messageID: 'message', id: 'failed-call', tool: 'read', input: { path: 'missing' } }
  const error = { message: 'Fixture failure, not an interrupted call' }
  const start = withStart ? observer.before(event) : undefined
  const finish = observer.after({ ...event, status: 'error', error })
  const persisted = JSON.parse(db.prepare('SELECT data FROM ledger WHERE id=?').get(finish.id).data)
  assert.equal(persisted.data.phase, 'finished')
  assert.equal(persisted.data.status, 'error')
  assert.equal(persisted.data.result_digest, digest(error))
  assert.equal(persisted.data.start_id, start?.id)
  assert.equal(persisted.action_id, withStart ? action.id : undefined)
  assert.equal(db.prepare("SELECT count(*) AS n FROM ledger WHERE json_extract(data,'$.data.status')='completed'").get().n, 0)
})

test('change-time-only edit rejects configuration before decoding with unchanged size and mtime', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'loom-ctime-review-')); t.after(() => rm(dir, { recursive: true, force: true }))
  const path = join(dir, '.loom.yaml'), source = '{"agents":{"a":{"roles":["qa"]}}}'
  await writeFile(path, source)
  let stats = 0, closes = 0, decodes = 0
  const observed = []
  const opener = async (name, flags) => {
    const file = await open(name, flags)
    return {
      stat: async options => {
        const value = await file.stat(options)
        // Deterministic metadata-only interleaving. Real file reads stay unchanged;
        // this seam changes ctime only, independent of filesystem timestamp resolution.
        if (++stats === 2) value.ctimeNs += 1n
        observed.push({ size: value.size, mtimeNs: value.mtimeNs, ctimeNs: value.ctimeNs })
        return value
      },
      read: (...args) => file.read(...args),
      close: async () => { closes++; await file.close() },
    }
  }
  const result = await loadConfig([path], text => { decodes++; return JSON.parse(text) }, opener)
  assert.equal(stats, 2)
  assert.equal(observed[0].size, observed[1].size)
  assert.equal(observed[0].mtimeNs, observed[1].mtimeNs)
  assert.notEqual(observed[0].ctimeNs, observed[1].ctimeNs)
  assert.equal(decodes, 0)
  assert.equal(closes, 1)
  assert.equal(result.errors.length, 1)
  assert.match(result.errors[0], /changed while being read/)
  assert.equal(result.config.instructions.enabled, false)
  assert.equal(result.config.ledger.capture, 'off')
  assert.deepEqual(result.config.agents, {})
  // No poisoned queue state or cached failure after this independent metadata check.
  assert.equal((await loadConfig([path], JSON.parse)).errors.length, 0)
})
