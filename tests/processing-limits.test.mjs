import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { DatabaseSync } from 'node:sqlite'
import { Store } from '../.test-build/store.js'
import { Observer, taskContext, taskContextOrRecovery } from '../.test-build/context.js'
import * as model from '../.test-build/model.js'

const { canonical, digest, subject, validatePlan } = model
const actor = { session_id: 'processing', agent: 'worker' }
const node = (id, extra = {}) => ({ id, kind: 'task', title: id, ...extra })
function fixture(t) {
  const db = new DatabaseSync(':memory:'); t.after(() => db.close())
  const store = new Store(db), action = store.create('Bounded work', 'Preserve useful history', actor)
  return { db, store, action }
}
function limited(fn) { assert.throws(fn, error => error?.code === 'LOOM_PROCESSING_LIMIT') }
function previousCanonical(v) {
  if (Array.isArray(v)) return `[${v.map(previousCanonical).join(',')}]`
  if (v && typeof v === 'object') return '{' + Object.entries(v).filter(([,v]) => v !== undefined).sort(([a],[b]) => a.localeCompare(b)).map(([k,v]) => `${JSON.stringify(k)}:${previousCanonical(v)}`).join(',') + '}'
  return JSON.stringify(v) ?? 'null'
}

test('aggregate plan text is refused before cloning despite valid individual fields', () => {
  const input = Array.from({ length: 40 }, (_, i) => node(`n${i}`, { context: 'x'.repeat(8000) }))
  limited(() => validatePlan(input))
})
test('plan expansion from JSON escapes counts toward the aggregate cap', () => {
  const input = Array.from({ length: 12 }, (_, i) => node(`n${i}`, { context: '\u0001'.repeat(5000) }))
  limited(() => validatePlan(input))
})
test('300 normal tasks remain supported and the caller input is not mutated', () => {
  const input = Array.from({ length: 300 }, (_, i) => node(`n${i}`, { context: 'x'.repeat(500), depends_on: i ? [`n${i-1}`] : [] }))
  assert.equal(validatePlan(input).length, 300)
  assert.notEqual(validatePlan(input)[0], input[0])
})
test('oversized scalar values never produce a prefix digest', () => limited(() => digest('x'.repeat(1024 * 1024 + 1))))
test('serialization refuses excessive depth with a named limit, not a stack overflow', () => {
  let value = 'leaf'; for (let i = 0; i < 60; i++) value = { value }
  limited(() => canonical(value))
})
test('serialization charges every occurrence of aliased subtrees', () => {
  let value = 'leaf'; for (let i = 0; i < 18; i++) value = [value, value]
  limited(() => canonical(value))
})
test('too many scalar visits are rejected even when the output could fit', () => limited(() => canonical(Array(40000).fill(0))))
test('cycles and getters are rejected without invoking user-defined accessors', () => {
  const cyclic = {}; cyclic.self = cyclic
  limited(() => canonical(cyclic))
  let calls = 0
  const getter = Object.defineProperty({}, 'value', { enumerable: true, get() { calls++; return 'hidden' } })
  limited(() => canonical(getter)); assert.equal(calls, 0)
})
test('supported canonical bytes and SHA-256 stay compatible with existing evidence', () => {
  const corpus = [null, undefined, true, 0, -0, 1.2, NaN, 'hello', '\u0001\n"\\', '\ud800', '日本語🙂', [1, undefined, null], { z: 0, a: 2, ignored: undefined }, { A: { c: ['x', 1] }, 'é': false }]
  for (const value of corpus) {
    const expected = previousCanonical(value)
    assert.equal(canonical(value), expected)
    assert.equal(digest(value), createHash('sha256').update(expected).digest('hex'))
  }
})
test('rejected plan writes leave the previous revision and history intact', t => {
  const { store, action } = fixture(t); store.savePlan(action.id, 0, [node('first')])
  const result = store.record(actor, { action_id: action.id, node_id: 'first' }, { kind: 'result', statement: 'Saved conclusion' })
  limited(() => store.savePlan(action.id, 1, Array.from({ length: 40 }, (_, i) => node(`n${i}`, { context: 'x'.repeat(8000) }))))
  assert.equal(store.plan(action.id).revision, 1)
  assert.equal(store.records({ action_id: action.id, record_id: result.id }).items[0].data.statement, 'Saved conclusion')
})
test('old oversized plan reads fail before JSON.parse and are not task-removal notices', t => {
  const { db, store, action } = fixture(t)
  db.prepare('INSERT INTO plans(action_id,revision,data) VALUES(?,?,?)').run(action.id, 1, 'x'.repeat(600000))
  limited(() => store.plan(action.id))
  limited(() => taskContextOrRecovery(store, { action_id: action.id, node_id: 'old' }))
  assert.equal(store.update(action.id, 1, { title: 'Still usable' }).revision, 2)
})
test('a bounded new plan can replace an unreadably large legacy revision without deleting it', t => {
  const { db, store, action } = fixture(t)
  const data = JSON.stringify({ revision: 1, nodes: [node('old', { context: 'x'.repeat(600000) })] })
  db.prepare('INSERT INTO plans(action_id,revision,data) VALUES(?,?,?)').run(action.id, 1, data)
  assert.equal(store.savePlan(action.id, 1, [node('small')]).revision, 2)
  assert.equal(db.prepare('SELECT data FROM plans WHERE revision=1').get().data, data)
  limited(() => store.plan(action.id, 1))
})
test('oversized stored ledger rows fail visibly and are not silently shortened', t => {
  const { db, store, action } = fixture(t)
  const data = JSON.stringify({ id: 'legacy', ...actor, action_id: action.id, kind: 'result', data: { statement: 'x'.repeat(140000) } })
  db.prepare('INSERT INTO ledger(id,action_id,session_id,kind,data) VALUES(?,?,?,?,?)').run('legacy', action.id, actor.session_id, 'result', data)
  limited(() => store.records({ action_id: action.id }))
  assert.equal(db.prepare('SELECT data FROM ledger WHERE id=?').get('legacy').data, data)
})
test('a too-large ledger append is rolled back without manufacturing a truncated claim', t => {
  const { store, action } = fixture(t)
  limited(() => store.record(actor, { action_id: action.id }, { kind: 'claim', statement: 'x'.repeat(16000), artifact_refs: Array(50).fill('\u0001'.repeat(1800)) }))
  assert.equal(store.records({ action_id: action.id }).items.length, 0)
})
test('input-size capture failure degrades pairing and writes neither raw data nor a partial hash', t => {
  const { store, action } = fixture(t), observer = new Observer(store)
  const e = { sessionID: actor.session_id, agent: actor.agent, messageID: 'm', id: 'c', tool: 'read', input: 'x'.repeat(1024*1024+1) }
  limited(() => observer.before(e)); assert.equal(observer.status().pairing, 'degraded')
  assert.equal(store.records({ action_id: action.id }).items.length, 0)
})
test('output-size capture failure leaves the original start for a valid retry', t => {
  const { store, action } = fixture(t), observer = new Observer(store)
  const e = { sessionID: actor.session_id, agent: actor.agent, messageID: 'm', id: 'c', tool: 'read', input: {} }
  const start = observer.before(e)
  limited(() => observer.after({ ...e, status: 'completed', result: 'x'.repeat(1024*1024+1) }))
  assert.equal(store.records({ action_id: action.id }).items.length, 1)
  assert.equal(observer.after({ ...e, status: 'completed', result: 'bounded retry' }).data.start_id, start.id)
})
test('context hash exhaustion reports unknown rather than a false mismatch', t => {
  const { store, action } = fixture(t)
  const nodes = Array.from({ length: 40 }, (_, i) => node(`n${i}`, { context: 'x'.repeat(6000), depends_on: i ? [`n${i-1}`] : [] }))
  store.savePlan(action.id, 0, nodes)
  for (let i=0; i<40; i++) store.record(actor, { action_id: action.id, node_id: `n${i}` }, { kind: 'result', statement: `Conclusion ${i}` })
  const view = taskContext(store, { action_id: action.id, node_id: 'n39' }, 64000)
  assert.ok(view.retrieval.contract_checks_omitted > 0)
  const unavailable = view.records.filter(r => r.contract_match_reason === 'processing-limit')
  assert.ok(unavailable.length > 0)
  for (const record of unavailable) assert.equal(record.contract_match, null)
  assert.ok(JSON.stringify(view).length <= 64000)
})
test('large-plan compact rendering never serializes a giant whole candidate', t => {
  const { store, action } = fixture(t)
  const nodes = Array.from({ length: 300 }, (_, i) => node(`n${i}`, { context: 'x'.repeat(650), depends_on: i ? [`n${i-1}`] : [] }))
  store.savePlan(action.id, 0, nodes)
  const conclusion = store.record(actor, { action_id: action.id, node_id: 'n298' }, { kind: 'result', statement: 'Dependency finding still matters.' })
  const original = JSON.stringify; let maximum=0, aggregate=0
  JSON.stringify = (...args) => { const text=original(...args); maximum=Math.max(maximum, text?.length??0); aggregate+=text?.length??0; return text }
  let view
  try { view=taskContext(store, { action_id: action.id, node_id: 'n299' }, 2000) } finally { JSON.stringify=original }
  assert.ok(maximum < 65536, `largest native serialization was ${maximum}`)
  assert.ok(aggregate < 1024*1024, `total native serialization was ${aggregate}`)
  assert.ok(view.records.some(r => r.id === conclusion.id))
  assert.ok(original(view).length <= 2000)
})

test('exact scalar allowance and escape expansion use serialized character counts', () => {
  const chars = 1024*1024
  assert.equal(canonical('x'.repeat(chars-2)).length, chars)
  limited(() => canonical('x'.repeat(chars-1)))
  limited(() => canonical('\u0001'.repeat(Math.ceil(chars/6))))
})
test('a shared operation allowance stays exhausted and cannot restart on a smaller value', () => {
  assert.equal(typeof model.ProcessingBudget, 'function')
  const budget = new model.ProcessingBudget(12, 100)
  assert.equal(canonical('first', budget), '"first"')
  limited(() => canonical('second', budget))
  limited(() => canonical(0, budget))
})
test('known contract matches remain true even when later uncached checks exceed their allowance', t => {
  const { store, action } = fixture(t)
  const nodes = Array.from({ length: 40 }, (_, i) => node(`n${i}`, { context: 'x'.repeat(6000), depends_on: i ? [`n${i-1}`] : [] }))
  store.savePlan(action.id, 0, nodes)
  for (let i=0; i<40; i++) store.record(actor, { action_id: action.id, node_id: `n${i}` }, { kind: 'result', statement: `Result ${i}` })
  const view = taskContext(store, { action_id: action.id, node_id: 'n39' }, 64000)
  assert.ok(view.records.some(r => r.contract_match === true))
  assert.ok(view.records.some(r => r.contract_match === null && r.contract_match_reason === 'processing-limit'))
  assert.ok(!view.records.some(r => r.contract_match === false))
})
test('ordinary seeded nested data retain canonical byte identity', () => {
  let seed = 123456789
  const next = () => (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0)
  function data(depth) {
    if (!depth) return [null, undefined, true, '\u001f🙂"', next()/1000][next()%5]
    if (next()%2) return Array.from({ length: 3 }, () => data(depth-1))
    return { z: data(depth-1), b: data(depth-1), a: data(depth-1) }
  }
  for (let i=0; i<100; i++) {
    const value=data(3), expected=previousCanonical(value)
    assert.equal(canonical(value), expected)
    assert.equal(digest(value), createHash('sha256').update(expected).digest('hex'))
  }
})
