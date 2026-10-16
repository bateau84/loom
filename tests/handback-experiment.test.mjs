import { test } from 'node:test'
import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { HandbackExperiment } from './handback/bridge.mjs'

const ref = { action_id: 'action', node_id: 'work', action_revision: 1, plan_revision: 1, hash: 'a'.repeat(64) }
const assignment = { id: 'assignment', primary: 'primary', worker: 'worker', work_ref: ref, original_returned: true }
const report = { id: 'completion', kind: 'completion', session_id: 'worker', action_id: 'action', node_id: 'work', data: { work_ref: ref } }
function fixture(t) {
  const db = new DatabaseSync(':memory:'); t.after(() => db.close())
  const bridge = new HandbackExperiment(db); bridge.track(assignment); return { bridge, db }
}

test('late assignment completion selects its original primary, independent of idle state', t => {
  const { bridge } = fixture(t); assert.equal(bridge.resumeAfterAnswer('assignment', 'answer'), true)
  const offered = bridge.offer('assignment', report)
  assert.equal(offered.state, 'claimed'); assert.equal(offered.payload.sessionID, 'primary')
  assert.equal(offered.payload.resume, true); assert.equal(offered.payload.delivery, 'steer')
  assert.match(offered.payload.text, /authoritative record/)
})
for (const state of ['original-owned','newer-owned','unknown']) test(`${state} return does not produce a competing handback`, t => {
  const { bridge } = fixture(t); bridge.resumeAfterAnswer('assignment', 'answer')
  if (state === 'unknown') { const a = bridge.get('assignment'); a.return_owner = 'unknown'; bridge.put(a) }
  else bridge.nativeOwns('assignment')
  assert.equal(bridge.offer('assignment', report).state, 'native-owned'); assert.deepEqual(bridge.attempts('assignment'), [])
})
test('normal background delegation is never considered a returned foreground call', t => {
  const { bridge } = fixture(t); bridge.track({ ...assignment, id: 'background', original_returned: false })
  assert.equal(bridge.resumeAfterAnswer('background', 'answer'), false)
  assert.equal(bridge.offer('background', report).state, 'native-owned')
})
test('cancellation before answer does not restart the assignment', t => {
  const { bridge } = fixture(t); bridge.cancel('assignment')
  assert.equal(bridge.resumeAfterAnswer('assignment','answer'), false)
  assert.equal(bridge.offer('assignment',report).state,'cancelled')
})
for (const change of ['cancel','native']) test(`${change} between claim and submission is rechecked`, t => {
  const { bridge } = fixture(t); bridge.resumeAfterAnswer('assignment','answer'); bridge.offer('assignment',report)
  if (change === 'cancel') bridge.cancel('assignment'); else bridge.nativeOwns('assignment')
  assert.equal(bridge.beginSend('assignment'),false)
})
for (const change of ['session','work','revision','kind']) test(`wrong ${change} cannot hand back an assignment`, t => {
  const { bridge } = fixture(t); bridge.resumeAfterAnswer('assignment','answer'); const r = structuredClone(report)
  if (change === 'session') r.session_id='other-worker'
  if (change === 'work') r.data.work_ref.hash='b'.repeat(64)
  if (change === 'revision') r.data.work_ref.plan_revision=2
  if (change === 'kind') r.kind='result'
  assert.equal(bridge.offer('assignment',r).state,'wrong-completion')
})
test('unrelated background work does not block a useful assignment return', t => {
  const { bridge } = fixture(t)
  bridge.track({...assignment,id:'other',worker:'other-worker',original_returned:false})
  bridge.resumeAfterAnswer('assignment','answer'); assert.equal(bridge.offer('assignment',report).state,'claimed')
})
test('uncertain acknowledgement preserves immutable payload and does not automatically resend', t => {
  const { bridge } = fixture(t); bridge.resumeAfterAnswer('assignment','answer')
  const first=bridge.offer('assignment',report); assert.equal(bridge.beginSend('assignment'),true)
  bridge.outcome('assignment','uncertain'); assert.equal(bridge.offer('assignment',report).state,'uncertain')
  assert.equal(bridge.beginSend('assignment'),false)
  for (const a of bridge.attempts('assignment')) assert.deepEqual(a.payload,first.payload)
  bridge.consumed('assignment','primary','completion'); assert.equal(bridge.get('assignment').handback,'consumed')
})
test('an accepted notice is not proof of consumption and cannot be retargeted', t => {
  const { bridge } = fixture(t); bridge.resumeAfterAnswer('assignment','answer'); bridge.offer('assignment',report)
  bridge.beginSend('assignment'); bridge.outcome('assignment','admitted')
  assert.equal(bridge.get('assignment').handback,'admitted')
  assert.throws(()=>bridge.track({...assignment,primary:'other'}),/already registered/)
  assert.throws(()=>bridge.consumed('assignment','other','completion'),/matching/)
})
test('two file-backed connections cannot claim the same completion twice; restart preserves uncertainty', t => {
  const dir=mkdtempSync(join(tmpdir(),'loom-handback-')); const path=join(dir,'bridge.sqlite')
  const aDB=new DatabaseSync(path),bDB=new DatabaseSync(path)
  try {
    const a=new HandbackExperiment(aDB),b=new HandbackExperiment(bDB); a.track(assignment); a.resumeAfterAnswer('assignment','answer')
    assert.ok(a.offer('assignment',report).payload); assert.equal(b.offer('assignment',report).payload,undefined)
    assert.equal(b.beginSend('assignment'),true); assert.equal(a.beginSend('assignment'),false)
    b.outcome('assignment','uncertain')
  } finally { aDB.close();bDB.close() }
  const reopened=new DatabaseSync(path)
  try { const b=new HandbackExperiment(reopened); assert.equal(b.offer('assignment',report).state,'uncertain'); assert.equal(b.attempts('assignment').length,3) }
  finally { reopened.close();rmSync(dir,{recursive:true,force:true}) }
})
test('a refused claim write leaves no partial intent or attempt', t => {
  const { bridge,db } = fixture(t); bridge.resumeAfterAnswer('assignment','answer')
  db.exec("CREATE TRIGGER refuse BEFORE INSERT ON bridge_attempts BEGIN SELECT RAISE(ABORT,'refused'); END")
  assert.throws(()=>bridge.offer('assignment',report),/refused/)
  assert.equal(bridge.get('assignment').handback,'not-requested'); assert.deepEqual(bridge.attempts('assignment'),[])
})
