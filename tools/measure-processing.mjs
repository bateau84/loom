#!/usr/bin/env node
// Run after `bun run test:core`. Real Store/SQLite/model/context; no inference.
import { performance } from 'node:perf_hooks'
import { cpus } from 'node:os'
import { DatabaseSync } from 'node:sqlite'
import { Store } from '../.test-build/store.js'
import { taskContext } from '../.test-build/context.js'
import { validatePlan, digest, subject } from '../.test-build/model.js'

const db = new DatabaseSync(':memory:')
try {
  const store = new Store(db), actor = { session_id: 'measurement', agent: 'worker' }
  const action = store.create('Large plan', 'Preserve and retrieve meaningful conclusions', actor)
  const nodes = Array.from({ length: 300 }, (_, i) => ({ id: `n${i}`, kind: 'task', title: `Task ${i}`,
    context: 'x'.repeat(650), depends_on: i ? [`n${i-1}`] : [] }))
  const plan = store.savePlan(action.id, 0, nodes)
  for (let i=270; i<300; i++) store.record(actor, { action_id: action.id, node_id: `n${i}` }, {
    kind: 'result', statement: `Conclusion ${i}: ` + 'Retain the conditions and confirm the source. '.repeat(20) })
  for (let i=0; i<1000; i++) store.observe(actor, { action_id: action.id, node_id: 'n299' }, { phase: 'finished', tool: 'read', status: 'completed', n: i })
  const excessive = Array.from({ length: 40 }, (_, i) => ({ id: `e${i}`, kind: 'task', title: 'Task', context: 'x'.repeat(8000) }))
  const oversized = 'x'.repeat(1024*1024+1)
  const attempt = fn => { try { fn(); return { accepted: true } } catch (error) { return { accepted: false, code: error.code ?? error.name } } }
  const cases = [
    ['validate_300_tasks', () => ({ nodes: validatePlan(nodes).length })],
    ['read_stored_plan', () => ({ revision: store.plan(action.id).revision })],
    ['fingerprint_300_task_closure', () => ({ digest: subject(action, plan, 'n299') })],
    ...[2000, 64000].map(budget => [`context_${budget}_chars`, () => {
      const view = taskContext(store, { action_id: action.id, node_id: 'n299' }, budget)
      return { output_chars: JSON.stringify(view).length, records: view.records.length,
        contract_checks_omitted: view.retrieval.contract_checks_omitted ?? 0, truncated: view.truncated }
    }]),
    ['oversize_plan', () => attempt(() => validatePlan(excessive))],
    ['oversize_digest', () => attempt(() => digest(oversized))],
  ]
  const observations = []
  for (const [name, run] of cases) {
    run() // One warm-up, not counted.
    const elapsed = []; let result
    for (let i=0; i<10; i++) { const start=performance.now(); result=run(); elapsed.push(performance.now()-start) }
    elapsed.sort((a,b) => a-b)
    observations.push({ name, iterations: elapsed.length, median_ms: Number(elapsed[5].toFixed(3)), max_ms: Number(elapsed.at(-1).toFixed(3)), result })
  }
  const original=JSON.stringify; let calls=0, total=0, largest=0
  JSON.stringify=(...args) => { const text=original(...args); calls++; total+=text?.length??0; largest=Math.max(largest,text?.length??0); return text }
  try { taskContext(store, { action_id: action.id, node_id: 'n299' }, 2000) } finally { JSON.stringify=original }
  console.log(JSON.stringify({ runtime: { node: process.version, sqlite: db.prepare('SELECT sqlite_version() AS version').get().version,
      platform: process.platform, arch: process.arch, cpu: cpus()[0]?.model },
    fixture: { nodes: 300, serialized_node_chars: JSON.stringify(nodes).length, conclusions: 30, observations: 1000 },
    cases: observations, compact_native_stringify: { calls, total_chars: total, largest_chars: largest },
    note: 'Local warm measurements, not wall-clock guarantees, independent review, or installed-host acceptance. Input allocation and fixture writes are outside each timed case.' }, null, 2))
} finally { db.close() }
