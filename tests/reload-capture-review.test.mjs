import { test } from 'node:test'
import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { mkdtempSync, rmSync, copyFileSync, writeFileSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { randomUUID } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { Store } from '../.test-build/store.js'
import { Observer, taskContext, taskContextOrRecovery } from '../.test-build/context.js'

const actor = { session_id: 's', agent: 'worker' }
const event = (extra = {}) => ({ sessionID: 's', agent: 'worker', messageID: 'm', id: 'call', tool: 'read', input: { path: 'identical' }, ...extra })
const finish = (e, result = 'result') => ({ ...e, status: 'completed', result: { content: result } })
function memory(t) { const db = new DatabaseSync(':memory:'); t.after(() => db.close()); return { db, store: new Store(db) } }
function disk(t) {
  const dir = mkdtempSync(join(tmpdir(), 'loom-reload-review-')); const path = join(dir, 'ledger.sqlite')
  t.after(() => rmSync(dir, { recursive: true, force: true })); return { dir, path }
}
function actions(store) {
  const a = store.create('Research', 'Find the facts', actor), b = store.create('Implementation', 'Use the findings', actor)
  store.savePlan(a.id, 0, [{ id: 'research', kind: 'task', title: 'Research' }])
  store.savePlan(b.id, 0, [{ id: 'worker', kind: 'task', title: 'Worker' }])
  store.select('s', { action_id: a.id, node_id: 'research' })
  return { a, b }
}
function unpaired(record) {
  assert.ok(record); assert.notEqual(record.data.attribution, 'captured-at-start')
  assert.equal(record.data.start_id, undefined); assert.equal(record.action_id, undefined)
  assert.equal(record.node_id, undefined); assert.equal(record.fingerprint, undefined)
}
function failLedgerWrites(db) {
  let failing = false
  return {
    setFailure: value => { failing = value },
    sql: { exec: sql => db.exec(sql), prepare: sql => {
      const stmt = db.prepare(sql)
      return { get: (...p) => stmt.get(...p), all: (...p) => stmt.all(...p), run: (...p) => {
        if (failing && sql.startsWith('INSERT INTO ledger')) throw new Error('injected disk write failure')
        return stmt.run(...p)
      } }
    } },
  }
}

for (const failure of ['disabled', 'failed']) test(`${failure} start plus replacement, identical input, changed Task and reversed completions stays unpaired`, t => {
  const { db, store: original } = memory(t), fault = failLedgerWrites(db)
  const store = failure === 'failed' ? new Store(fault.sql) : original
  const { b } = actions(store), old = new Observer(store), e = event()
  if (failure === 'disabled') old.skip(e)
  else { fault.setFailure(true); assert.throws(() => old.before(e), /injected/); fault.setFailure(false) }
  assert.equal(store.records({ session_id: 's' }).items.length, 0)
  const replacement = new Observer(store)
  store.select('s', { action_id: b.id, node_id: 'worker' })
  replacement.before({ ...e, input: { path: 'identical' } })
  unpaired(replacement.after(finish(e, 'older call finishes first')))
  unpaired(replacement.after(finish(e, 'newer call finishes second')))
  assert.equal(replacement.status().pairing, 'degraded')
})

test('a live replacement sees a failure reported later by the old observer', t => {
  const { store } = memory(t); const { b } = actions(store)
  const old = new Observer(store), replacement = new Observer(store), e = event()
  store.select('s', { action_id: b.id, node_id: 'worker' }); replacement.before(e)
  old.captureGap(); unpaired(replacement.after(finish(e)))
})

test('skipped-before uncertainty survives re-evaluating the Observer module', async t => {
  const { store } = memory(t); actions(store); new Observer(store).skip(event())
  const { Observer: Reloaded } = await import(`../.test-build/context.js?reload=${randomUUID()}`)
  assert.notEqual(Reloaded, Observer)
  const replacement = new Reloaded(store); replacement.before(event())
  unpaired(replacement.after(finish(event())))
})

for (const failure of ['disabled', 'failed']) test(`${failure} capture survives a new module graph and closed/reopened file database`, async t => {
  const { dir, path } = disk(t); let db = new DatabaseSync(path)
  const fault = failLedgerWrites(db), oldStore = new Store(fault.sql), { b } = actions(oldStore)
  const old = new Observer(oldStore), e = event()
  if (failure === 'disabled') old.skip(e)
  else { fault.setFailure(true); assert.throws(() => old.before(e), /injected/); fault.setFailure(false) }
  db.close()
  writeFileSync(join(dir, 'package.json'), '{"type":"module"}')
  for (const name of ['context', 'store', 'model', 'collaboration']) copyFileSync(new URL(`../.test-build/${name}.js`, import.meta.url), join(dir, name + '.js'))
  const { Observer: ReloadedObserver } = await import(pathToFileURL(join(dir, 'context.js')).href)
  const { Store: ReloadedStore } = await import(pathToFileURL(join(dir, 'store.js')).href)
  db = new DatabaseSync(path)
  try {
    const newStore = new ReloadedStore(db), replacement = new ReloadedObserver(newStore)
    newStore.select('s', { action_id: b.id, node_id: 'worker' }); replacement.before(e)
    unpaired(replacement.after(finish(e, 'older'))); unpaired(replacement.after(finish(e, 'newer')))
  } finally { db.close() }
})

test('two connections and a symlink alias share gap state for the same file', t => {
  const { dir, path } = disk(t), db1 = new DatabaseSync(path)
  const s1 = new Store(db1); new Observer(s1).skip(event())
  const alias = join(dir, 'alias.sqlite'); symlinkSync(path, alias)
  const db2 = new DatabaseSync(alias)
  try { const s2 = new Store(db2), observer = new Observer(s2); observer.before(event()); unpaired(observer.after(finish(event()))) }
  finally { db1.close(); db2.close() }
})

test('unrelated databases do not inherit another project capture gap', t => {
  const { store: s1 } = memory(t), { store: s2 } = memory(t)
  new Observer(s1).captureGap(); const observer = new Observer(s2)
  const start = observer.before(event()), end = observer.after(finish(event()))
  assert.equal(end.data.start_id, start.id); assert.equal(observer.status().pairing, 'available')
})

test('same-process connection reopen is not a reset; a fresh host can pair a distinct new key', t => {
  const { path } = disk(t); const db = new DatabaseSync(path), store = new Store(db)
  const old = new Observer(store); old.before(event()); old.captureGap(); db.close()
  const child = spawnSync(process.execPath, ['--input-type=module', '-e', `
    import {DatabaseSync} from 'node:sqlite';
    import {Store} from ${JSON.stringify(new URL('../.test-build/store.js', import.meta.url).href)};
    import {Observer} from ${JSON.stringify(new URL('../.test-build/context.js', import.meta.url).href)};
    const db=new DatabaseSync(${JSON.stringify(path)}), o=new Observer(new Store(db));
    const e=${JSON.stringify(event({ id: 'fresh-key' }))}; const s=o.before(e);
    const f=o.after({...e,status:'completed',result:{}});
    console.log(JSON.stringify({paired:f.data.start_id===s.id})); db.close();
  `], { encoding: 'utf8', timeout: 10000 })
  assert.equal(child.status, 0, child.stderr); assert.equal(JSON.parse(child.stdout).paired, true)
})

test('historical captured keys remain unpaired across observer replacement', t => {
  const { store } = memory(t); const old = new Observer(store), e = event()
  old.before(e); const replacement = new Observer(store); unpaired(replacement.after(finish(e)))
  const distinct = event({ id: 'different' }); const start = replacement.before(distinct)
  assert.equal(replacement.after(finish(distinct)).data.start_id, start.id)
})

test('settled historical keys do not make capture-off calls eligible or persist them', t => {
  const { store } = memory(t), observer = new Observer(store), e = event()
  observer.before(e); observer.after(finish(e)); const before = store.records({ session_id: 's' }).items
  observer.skip(e); assert.equal(observer.has(e), false)
  assert.equal(observer.after(finish(e, 'disabled-call'), false), undefined)
  assert.deepEqual(store.records({ session_id: 's' }).items, before)
})

test('capture-off allows only a provably paired finish of captured in-flight work', t => {
  const { store } = memory(t), observer = new Observer(store), e = event()
  const start = observer.before(e); assert.equal(observer.has(e), true)
  const end = observer.after(finish(e), false)
  assert.equal(end.data.start_id, start.id); assert.equal(observer.has(e), false)
  assert.equal(store.records({ session_id: 's' }).items.length, 2)
})

test('capture-off records neither new starts nor unpaired disabled siblings', t => {
  const { store } = memory(t), observer = new Observer(store), e = event()
  observer.before(e); observer.skip({ ...e }); const before = store.records({ session_id: 's' }).items
  assert.equal(observer.after(finish(e), false), undefined)
  assert.deepEqual(store.records({ session_id: 's' }).items, before)
  // Capture back on may diagnose the gap, but cannot claim the disabled call's origin.
  unpaired(observer.after(finish(e)))
})

test('capture-off does not record ambiguous overlapping completions', t => {
  const { store } = memory(t), observer = new Observer(store), e = event()
  observer.before(e); observer.before({ ...e }); assert.equal(observer.has(e), false)
  assert.equal(observer.after(finish(e), false), undefined)
  assert.equal(store.records({ session_id: 's' }).items.length, 2)
})

test('capture-off ignores missing-start and post-replacement completion records', t => {
  const { store } = memory(t), e = event(), first = new Observer(store)
  assert.equal(first.after(finish(e), false), undefined)
  first.before(e); const replacement = new Observer(store)
  assert.equal(replacement.after(finish(e), false), undefined)
  assert.equal(store.records({ session_id: 's' }).items.length, 1)
})

test('a failed completion insert remains retryable while capture is off', t => {
  const { db } = memory(t), fault = failLedgerWrites(db), store = new Store(fault.sql), observer = new Observer(store), e = event()
  const start = observer.before(e); fault.setFailure(true)
  assert.throws(() => observer.after(finish(e), false), /injected/)
  fault.setFailure(false); assert.equal(observer.has(e), true)
  assert.equal(observer.after(finish(e), false).data.start_id, start.id)
})

test('skipping unrelated work does not stop an already captured unambiguous finish', t => {
  const { store } = memory(t), observer = new Observer(store), e = event()
  const start = observer.before(e); observer.skip(event({ id: 'off-call' }))
  assert.equal(observer.after(finish(e), false).data.start_id, start.id)
})

test('capture-off checks eligibility before touching an otherwise unserializable result', t => {
  const { store } = memory(t), observer = new Observer(store), e = event()
  observer.before(e); observer.after(finish(e)); const circular = {}; circular.self = circular
  assert.equal(observer.after({ ...finish(e), result: circular }, false), undefined)
})

test('capture-off finish rechecks settlement within its write transaction', t => {
  const { db, store } = memory(t), observer = new Observer(store), e = event()
  observer.before(e); assert.equal(observer.has(e), true)
  observer.after(finish(e))
  // Stale eligibility cannot force a diagnostic write once the start has settled.
  const saved = store.records({ session_id: 's' }).items[0]
  assert.equal(store.finishObservation(actor, { ...saved.data, phase: 'finished', status: 'completed' }, true, false), undefined)
  assert.equal(Number(db.prepare('SELECT COUNT(*) AS n FROM ledger').get().n), 2)
})

for (const prefix of ['\u0001', '\u0000', '\u001f', '\\', '"']) test(`JSON-expanded prefix ${JSON.stringify(prefix)} retains a conclusion at the minimum budget`, t => {
  const { store } = memory(t), action = store.create('A', 'goal '.repeat(2000), actor)
  const statement = prefix.repeat(120) + ' Important qualification: this is unverified. '.repeat(60) + 'END'
  const record = store.record(actor, { action_id: action.id }, { kind: 'result', statement })
  const context = taskContext(store, { action_id: action.id }, 2000)
  const brief = context.records.find(r => r.id === record.id)
  assert.ok(brief, 'conclusion must not disappear solely due to JSON expansion')
  assert.equal(brief.truncated, true); assert.ok(brief.data.statement.length > 0)
  assert.ok(statement.startsWith(brief.data.statement)); assert.ok(JSON.stringify(context).length <= 2000)
  assert.match(context.note, /qualifications/)
  assert.equal(store.records({ action_id: action.id, record_id: record.id }).items[0].data.statement, statement)
})

test('escaped local and dependency results both retain IDs and source prefixes', t => {
  const { store } = memory(t), action = store.create('A', 'Goal '.repeat(2000), actor)
  store.savePlan(action.id, 0, [{ id: 'r', kind: 'task', title: 'Research' }, { id: 'w', kind: 'task', title: 'Worker', depends_on: ['r'] }])
  const ids = ['w', 'r'].map(node_id => store.record(actor, { action_id: action.id, node_id }, { kind: 'result', statement: '\u0001'.repeat(100) + node_id.repeat(300) }).id)
  const context = taskContext(store, { action_id: action.id, node_id: 'w' }, 2000)
  for (const id of ids) assert.ok(context.records.some(r => r.id === id))
  assert.ok(JSON.stringify(context).length <= 2000)
})

test('small complete conclusions and removed-task recovery keep their existing behavior', t => {
  const { store } = memory(t), action = store.create('A', 'Goal', actor)
  store.record(actor, { action_id: action.id }, { kind: 'result', statement: 'Done with the stated caveat.' })
  assert.equal(taskContext(store, { action_id: action.id }).records[0].data.statement, 'Done with the stated caveat.')
  assert.equal(taskContextOrRecovery(store, { action_id: action.id, node_id: 'missing' }).recovery.code, 'task-not-in-current-plan')
})
