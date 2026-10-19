import { test } from 'node:test'
import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { Store } from '../.test-build/store.js'
import { Observer } from '../.test-build/context.js'

test('a start skipped before capture is enabled cannot borrow a later identical start', t => {
  const db = new DatabaseSync(':memory:'); t.after(() => db.close())
  const store = new Store(db), observer = new Observer(store)
  store.create('A', 'Goal', { session_id: 's', agent: 'engineer' })
  const old = { sessionID: 's', agent: 'engineer', messageID: 'm', id: 'outer', tool: 'read', input: { path: 'a' } }
  const newer = { ...old }
  observer.skip(old)
  observer.before(newer)
  for (const e of [old, newer]) {
    const r = observer.after({ ...e, status: 'completed', result: 'output' })
    assert.equal(r.action_id, undefined)
    assert.equal(r.data.start_id, undefined)
    assert.match(r.data.attribution, /capture-gap|already-finished/)
  }
  assert.equal(observer.status().pairing, 'degraded')
})
