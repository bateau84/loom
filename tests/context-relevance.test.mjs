import { test } from 'node:test'
import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { Store } from '../.test-build/store.js'
import { taskContext } from '../.test-build/context.js'

const actor = { session_id: 'producer', agent: 'external-engineer' }
const task = (id, extra = {}) => ({ id, kind: 'task', title: id, ...extra })
function setup(t, nodes = [task('work')]) {
  const db = new DatabaseSync(':memory:')
  t.after(() => db.close())
  const store = new Store(db), action = store.create('Action', 'Deliver the stated outcome', actor)
  if (nodes.length) store.savePlan(action.id, 0, nodes)
  return { db, store, action, focus: { action_id: action.id, node_id: nodes.length ? 'work' : undefined } }
}
const record = (s, f, kind, statement, extra = {}) => s.record(actor, f, { kind, statement, ...extra })
function noise(s, f, count = 80) { for (let i = 0; i < count; i++) s.observe(actor, f, { phase: 'finished', status: 'completed', tool: 'read', n: i }) }
const includes = (context, id) => context.records?.some(r => r.id === id)

test('an important Task result survives 80 later observations', t => {
  const { store: s, focus: f } = setup(t)
  const r = record(s, f, 'result', 'Login now rejects expired sessions.')
  noise(s, f)
  const c = taskContext(s, f)
  assert.ok(includes(c, r.id), 'routine observations displaced the result')
  assert.match(JSON.stringify(c), /rejects expired sessions/)
  assert.equal(c.ledger_has_more, true)
})

test('dependency conclusions survive observations from the selected Task and dependency', t => {
  const { store: s, focus: f } = setup(t, [task('dependency'), task('work', { depends_on: ['dependency'] })])
  const upstream = record(s, { action_id: f.action_id, node_id: 'dependency' }, 'result', 'Use token version 2; version 1 is incompatible.')
  const local = record(s, f, 'claim', 'Implementation uses token version 2.')
  noise(s, f); noise(s, { action_id: f.action_id, node_id: 'dependency' })
  const c = taskContext(s, f)
  assert.ok(includes(c, upstream.id)); assert.ok(includes(c, local.id))
})

test('many new Task conclusions do not crowd out a dependency result', t => {
  const { store: s, focus: f } = setup(t, [task('dependency'), task('work', { depends_on: ['dependency'] })])
  const upstream = record(s, { action_id: f.action_id, node_id: 'dependency' }, 'result', 'Compatibility rule from the dependency.')
  for (let i = 0; i < 60; i++) record(s, f, 'result', `Local update ${i}`)
  assert.ok(includes(taskContext(s, f), upstream.id))
})

test('Action conclusions and parent context are considered without unrelated sibling records', t => {
  const nodes = [{ id: 'phase', kind: 'phase', title: 'Shared phase' }, task('work', { parent: 'phase' }), task('sibling')]
  const { store: s, focus: f } = setup(t, nodes)
  const top = record(s, { action_id: f.action_id }, 'claim', 'Do not change the public API.')
  const parent = record(s, { action_id: f.action_id, node_id: 'phase' }, 'result', 'The common interface has been agreed.')
  const unrelated = record(s, { action_id: f.action_id, node_id: 'sibling' }, 'result', 'Unrelated result')
  noise(s, f)
  const c = taskContext(s, f)
  assert.ok(includes(c, top.id)); assert.ok(includes(c, parent.id)); assert.ok(!includes(c, unrelated.id))
})

test('Assessment and QA are not displaced by many claims', t => {
  const { store: s, focus: f } = setup(t)
  const assessment = record(s, f, 'assessment', 'Missing a required behavior.', { verdict: 'fail' })
  const qa = record(s, f, 'qa', 'Restart recovery remains untested.', { verdict: 'inconclusive' })
  for (let i = 0; i < 70; i++) record(s, f, 'claim', `Claim ${i}`)
  const c = taskContext(s, f)
  assert.ok(includes(c, assessment.id)); assert.ok(includes(c, qa.id))
  assert.match(JSON.stringify(c), /inconclusive/)
})

test('recent conflicting review results remain distinct, with no inferred resolution', t => {
  const { store: s, focus: f } = setup(t)
  const failed = record(s, f, 'qa', 'A restart loses the result.', { verdict: 'fail' })
  const passed = record(s, f, 'qa', 'The tested restart path passed.', { verdict: 'pass' })
  noise(s, f)
  const c = taskContext(s, f)
  assert.ok(includes(c, failed.id)); assert.ok(includes(c, passed.id))
  assert.equal(s.action(f.action_id).state, 'active')
})

test('oversized context retains conclusion text and dependency meaning, not just IDs', t => {
  const { store: s, focus: f } = setup(t, [task('dependency'), task('work', { depends_on: ['dependency'], context: 'x'.repeat(8000) })])
  const upstream = record(s, { action_id: f.action_id, node_id: 'dependency' }, 'result', 'Dependency requires token version 2.')
  const local = record(s, f, 'result', 'Login now rejects expired sessions. ' + 'detail '.repeat(1000))
  noise(s, f)
  const c = taskContext(s, f, 2000), text = JSON.stringify(c)
  assert.ok(text.length <= 2000); assert.equal(c.truncated, true)
  assert.ok(includes(c, local.id)); assert.ok(includes(c, upstream.id))
  assert.match(text, /Login now rejects/); assert.match(text, /Dependency requires/)
  assert.match(text, /record_id/)
})

test('budget applies to escaped JSON, preserving valid JSON and readable statements', t => {
  const { store: s, focus: f } = setup(t, [task('work', { context: '\u0001'.repeat(8000) })])
  const r = record(s, f, 'result', 'Readable conclusion. ' + '\u0001"\\'.repeat(1000))
  const c = taskContext(s, f, 2000), text = JSON.stringify(c)
  assert.ok(text.length <= 2000); assert.deepEqual(JSON.parse(text), c)
  assert.ok(includes(c, r.id)); assert.match(text, /Readable conclusion/)
})

test('prefix summaries flag omitted text and preserve original full records', t => {
  const { store: s, focus: f } = setup(t)
  const statement = ('The actual conclusion. ' + 'details '.repeat(1800)).trim()
  const r = record(s, f, 'result', statement)
  const c = taskContext(s, f, 2000), summary = c.records?.find(x => x.id === r.id)
  assert.ok(summary?.data.statement?.startsWith('The actual conclusion.'))
  assert.equal(summary?.truncated, true)
  assert.equal(s.records({ action_id: f.action_id, record_id: r.id }).items[0].data.statement, statement)
})

test('a new Session can recover the same conclusions without needing the old conversation', t => {
  const { store: s, focus: f } = setup(t)
  const r = record(s, f, 'result', 'Retained useful result.')
  noise(s, f)
  s.select('fresh-session', f)
  assert.ok(includes(taskContext(s, s.selected('fresh-session')), r.id))
  assert.deepEqual(s.selected(actor.session_id), { action_id: f.action_id })
})

test('Action-only context works without a plan and keeps explicit conclusions', t => {
  const { store: s, focus: f } = setup(t, [])
  const r = record(s, f, 'claim', 'Investigate stale DNS entries next.')
  noise(s, f)
  const c = taskContext(s, f)
  assert.ok(includes(c, r.id)); assert.equal(c.task, null); assert.equal(c.plan_revision, 0)
})

test('changed contracts remain visible as historical rather than silently becoming current', t => {
  const { store: s, focus: f } = setup(t)
  const r = record(s, f, 'result', 'Result from the previous contract.')
  s.savePlan(f.action_id, 1, [task('work', { outcome: 'Changed scope' })])
  noise(s, f)
  assert.equal(taskContext(s, f).records.find(x => x.id === r.id)?.contract_match, false)
})

test('repeated context reads neither mutate history nor change selection', t => {
  const { store: s, focus: f } = setup(t)
  record(s, f, 'result', 'Stable result.')
  const before = s.records({ action_id: f.action_id }), selected = s.selected(actor.session_id)
  assert.deepEqual(taskContext(s, f), taskContext(s, f))
  assert.deepEqual(s.records({ action_id: f.action_id }), before)
  assert.deepEqual(s.selected(actor.session_id), selected)
})

test('wide dependency sets report scopes omitted by the retrieval cap', t => {
  const deps = Array.from({ length: 25 }, (_, i) => task(`dep-${i}`))
  const { store: s, focus: f } = setup(t, [...deps, task('work', { depends_on: deps.map(d => d.id) })])
  for (const d of deps) record(s, { action_id: f.action_id, node_id: d.id }, 'result', `${d.id} outcome`)
  const c = taskContext(s, f)
  assert.ok(c.retrieval.scopes_omitted > 0)
  assert.equal(c.ledger_has_more, true)
  assert.match(c.note, /omitted/i)
})

test('context uses one Action/Plan/ledger read snapshot across a competing writer', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'loom-context-snapshot-'))
  const db1 = new DatabaseSync(join(dir, 'state.sqlite')), db2 = new DatabaseSync(join(dir, 'state.sqlite'))
  t.after(async () => { db1.close(); db2.close(); await rm(dir, { recursive: true, force: true }) })
  const writer = new Store(db2)
  let interleave = false, fired = false
  const reader = new Store({
    exec: sql => db1.exec(sql),
    prepare: sql => {
      const stmt = db1.prepare(sql)
      return {
        all: (...p) => stmt.all(...p), run: (...p) => stmt.run(...p),
        get: (...p) => {
          const row = stmt.get(...p)
          if (interleave && !fired && sql.includes('SELECT data FROM actions')) {
            fired = true
            writer.update(action.id, 1, { goal: 'New goal' })
            writer.savePlan(action.id, 1, [task('work', { outcome: 'New outcome' })])
            record(writer, f, 'result', 'Result published after the snapshot.')
          }
          return row
        },
      }
    },
  })
  const action = writer.create('Action', 'Old goal', actor)
  writer.savePlan(action.id, 0, [task('work', { outcome: 'Old outcome' })])
  const f = { action_id: action.id, node_id: 'work' }
  const r = record(writer, f, 'result', 'Original result')
  interleave = true
  const c = taskContext(reader, f)
  assert.ok(fired); assert.equal(c.action.goal, 'Old goal'); assert.equal(c.task.outcome, 'Old outcome')
  assert.equal(c.plan_revision, 1); assert.equal(c.records.find(x => x.id === r.id).contract_match, true)
  assert.ok(!JSON.stringify(c).includes('Result published after the snapshot'))
  assert.equal(taskContext(reader, f).action.goal, 'New goal')
})

test('a failed context read releases its read transaction', t => {
  const { store: s, focus: f } = setup(t)
  s.savePlan(f.action_id, 1, [])
  assert.throws(() => taskContext(s, f), /removed/)
  assert.equal(s.create('Another', 'Native work is not gated', actor).state, 'active')
})

test('per-kind sampling reports omitted older conclusions instead of pretending completeness', t => {
  const { store: s, focus: f } = setup(t)
  const rows = Array.from({ length: 8 }, (_, i) => record(s, f, 'result', `Result ${i}`))
  const c = taskContext(s, f)
  assert.ok(includes(c, rows[7].id)); assert.ok(includes(c, rows[6].id))
  assert.ok(!includes(c, rows[0].id)); assert.equal(c.ledger_has_more, true)
  assert.equal(s.records({ action_id: f.action_id, record_id: rows[0].id }).items.length, 1)
})

test('Action context with a plan can retrieve child conclusions', t => {
  const { store: s, focus: f } = setup(t)
  const r = record(s, f, 'result', 'Child result visible at the Action level.')
  noise(s, f)
  const c = taskContext(s, { action_id: f.action_id })
  assert.ok(includes(c, r.id)); assert.equal(c.task, null)
})

test('one plan read serves all record contract comparisons in the same context', t => {
  const db = new DatabaseSync(':memory:'); t.after(() => db.close())
  let planReads = 0
  const s = new Store({ exec: sql => db.exec(sql), prepare: sql => {
    if (sql.includes('SELECT data FROM plans')) planReads++
    return db.prepare(sql)
  } })
  const a = s.create('A', 'Goal', actor), f = { action_id: a.id, node_id: 'work' }
  s.savePlan(a.id, 0, [task('work')])
  for (const kind of ['result', 'claim', 'assessment', 'qa']) {
    record(s, f, kind, 'A useful statement.', kind === 'assessment' || kind === 'qa' ? { verdict: 'inconclusive' } : {})
  }
  planReads = 0
  taskContext(s, f)
  assert.equal(planReads, 1)
})

test('invalid direct context budgets fail clearly', t => {
  const { store: s, focus: f } = setup(t)
  for (const budget of [0, 1999, 64001, NaN, 2000.5]) assert.throws(() => taskContext(s, f, budget), /budget/)
})

test('many escaped statements still fit the configured output limit without rewriting history', t => {
  const { store: s, focus: f } = setup(t)
  for (const kind of ['result', 'qa', 'assessment', 'claim']) {
    for (let i = 0; i < 2; i++) record(s, f, kind, `Known ${kind} result ${i}. ` + '\u0001\\"'.repeat(1000), kind === 'assessment' || kind === 'qa' ? { verdict: 'fail' } : {})
  }
  for (const budget of [2000, 4000, 16000, 64000]) {
    const c = taskContext(s, f, budget)
    assert.ok(JSON.stringify(c).length <= budget)
    assert.ok(c.records.some(r => r.data?.statement?.startsWith('Known result')))
  }
  assert.equal(s.records({ action_id: f.action_id }).items.length, 8)
})

test('important buckets use an index that excludes routine observation rows', t => {
  const { db, store: s, focus: f } = setup(t)
  noise(s, f, 1000)
  const plan = db.prepare(`EXPLAIN QUERY PLAN SELECT seq,data FROM ledger WHERE action_id=?
    AND kind<>'observation' AND kind=? AND json_extract(data,'$.node_id') IS ? ORDER BY seq DESC LIMIT 3`)
    .all(f.action_id, 'result', f.node_id)
  assert.ok(plan.some(row => /USING INDEX ledger_context_scope/.test(row.detail)))
})
