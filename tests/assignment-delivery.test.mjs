import { test } from 'node:test'
import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Worker } from 'node:worker_threads'
import { Store } from '../.test-build/store.js'
import { workReference } from '../.test-build/collaboration.js'
import { canonical, PROCESSING_LIMITS, ProcessingLimitError } from '../.test-build/model.js'

const primary = { session_id: 'primary', agent: 'general' }, worker = { session_id: 'worker', agent: 'worker' }, research = { session_id: 'research', agent: 'research' }
const task = id => ({id, kind:'task', title:id})
function fixture(t, database = new DatabaseSync(':memory:'), sql = database) {
  t.after(() => database.close())
  const store = new Store(sql), c = store.collaboration, action = store.create('Guide','Keep qualifications',primary)
  store.savePlan(action.id,0,[task('work'),task('other')])
  const focus = {action_id:action.id,node_id:'work'}, ref = workReference(action,store.plan(action.id),'work')
  const input = {assignment_id:'assignment',worker_session_id:worker.session_id,work_ref:ref}
  return {store,c,db:database,action,focus,ref,input}
}
const rows = (f,kind) => f.db.prepare('SELECT data FROM ledger'+(kind?' WHERE kind=?':'')+' ORDER BY seq').all(...(kind?[kind]:[])).map(r=>JSON.parse(r.data))
const register = f => f.c.assign(primary,f.input)
const ask = f => f.c.execute(worker,{operation:'ask',assignment_id:'assignment',statement:'Does this hold?',respondent:'research'})
const answer = (f,q) => f.c.answer(research,{question_id:q.id,statement:'Only for empty files.',artifact_refs:['fixture:source']})
const notices = (f,actor=primary) => f.c.coordinationRecords(actor,'deliveries').items

test('atomic assigned answer stores a separate immutable intent with exact route and authoritative query',t=>{
  const f=fixture(t); register(f); const q=ask(f), a=answer(f,q), n=notices(f)[0]
  assert.equal(n.id,a.delivery.intent_id);assert.equal(n.kind,'delivery-intent');assert.equal(n.data.destination_session_id,'primary')
  assert.equal(n.data.answer_id,a.id);assert.equal(n.data.question_id,q.id);assert.equal(n.data.assignment_id,'assignment')
  assert.deepEqual(n.data.payload.work_ref,f.ref);assert.equal(n.data.payload.worker_session_id,'worker')
  assert.deepEqual(n.data.payload.thread_query,{operation:'query',view:'thread',action_id:f.action.id,question_id:q.id})
  assert.equal(a.delivery.state,'stored-for-session');assert.equal(a.delivery.transport,'not-attempted')
  assert.equal(a.delivery.reason,'automatic-continuation-not-authorized');assert.equal(n.data.automatic_continuation,false)
  assert.equal(n.session_id,'research');assert.equal(rows(f,'answer')[0].delivery,undefined)
  assert.equal(rows(f,'answer')[0].data.delivery,undefined);assert.equal(rows(f,'answer')[0].data.assignment_id,'assignment')
  assert.ok(!JSON.stringify(n).includes('Only for empty files'));assert.equal(n.data.payload.resume,undefined)
})

test('stable assignment registration retries preserve identity across JSON property order and another connection',t=>{
  const dir=mkdtempSync(join(tmpdir(),'loom-assignment-'));t.after(()=>rmSync(dir,{recursive:true,force:true}))
  const file=join(dir,'db.sqlite'),f=fixture(t,new DatabaseSync(file));const first=register(f)
  const other=new DatabaseSync(file);t.after(()=>other.close());const c=new Store(other).collaboration
  const reordered=Object.fromEntries(Object.entries(f.ref).reverse())
  const second=c.assign(primary,{...f.input,work_ref:reordered})
  assert.equal(second.id,first.id);assert.deepEqual(second.data,first.data);assert.equal(rows(f,'assignment').length,1)
  c.complete(worker,{work_ref:reordered,assignment_id:'assignment',statement:'Original work finished.'})
  assert.equal(rows(f,'completion')[0].data.assignment_id,'assignment')
})
for(const change of ['primary','worker','reference','question']) test(`stable ID cannot silently change its ${change}`,t=>{
  const f=fixture(t);register(f);const before=rows(f);const input=structuredClone(f.input);let actor=primary
  if(change==='primary')actor={...primary,session_id:'other-primary'}
  if(change==='worker')input.worker_session_id='other-worker'
  if(change==='reference')input.work_ref.hash='0'.repeat(64)
  if(change==='question')input.question_id='other-question'
  assert.throws(()=>f.c.assign(actor,input),/already binds/);assert.deepEqual(rows(f),before)
})
test('registration rejects forged or unavailable historical work without creating an assignment',t=>{
  const f=fixture(t)
  for(const ref of [{...f.ref,hash:'0'.repeat(64)},{...f.ref,plan_revision:99},{...f.ref,action_revision:99}])
    assert.throws(()=>f.c.assign(primary,{...f.input,work_ref:ref}))
  assert.equal(rows(f,'assignment').length,0)
})
test('historical registration and assigned question keep original work even after goal edits and task removal',t=>{
  const f=fixture(t);f.store.update(f.action.id,1,{goal:'New goal'});f.store.savePlan(f.action.id,1,[task('other')])
  register(f);const q=ask(f),a=answer(f,q)
  assert.deepEqual(q.data.work_ref,f.ref);assert.equal(q.data.plan_revision,1)
  assert.deepEqual(notices(f)[0].data.payload.work_ref,f.ref);assert.equal(a.node_id,'work')
  f.c.complete(worker,{...f.input,statement:'Finished historical work.'})
  assert.equal(rows(f,'completion')[0].data.work_goal.goal,'Keep qualifications')
})
test('unrelated replanning never upgrades the traceable assignment reference',t=>{
  const f=fixture(t);register(f);f.store.savePlan(f.action.id,1,[task('work'),{...task('other'),outcome:'Different sibling'}])
  const newer=workReference(f.action,f.store.plan(f.action.id),'work');assert.equal(newer.hash,f.ref.hash)
  assert.deepEqual(ask(f).data.work_ref,f.ref)
  assert.throws(()=>f.c.complete(worker,{work_ref:newer,assignment_id:'assignment',statement:'Borrowed revision'}),/original reference/)
  f.c.complete(worker,{work_ref:f.ref,assignment_id:'assignment',statement:'Retained revision'})
  assert.equal(f.c.progress(f.action.id,'work').items[0].state,'reported-complete')
})
test('explicit link to an already-asked unanswered question supports registration after native delegation returns',t=>{
  const f=fixture(t),q=f.c.ask(worker,f.focus,{statement:'Asked before return',respondent:'research'}),before=rows(f,'question')
  f.c.assign(primary,{...f.input,question_id:q.id});const a=answer(f,q)
  assert.equal(a.delivery.destination_session_id,'primary');assert.deepEqual(rows(f,'question'),before)
  assert.equal(f.c.thread(q.id).answers[0].id,a.id)
})
test('two explicit assignments cannot claim the same pre-existing question',t=>{
  const f=fixture(t),q=f.c.ask(worker,f.focus,{statement:'Asked',respondent:'research'})
  f.c.assign(primary,{...f.input,question_id:q.id})
  assert.throws(()=>f.c.assign(primary,{...f.input,assignment_id:'different',question_id:q.id}),/UNIQUE/)
  assert.equal(rows(f,'assignment').length,1)
})
test('late registration after an answer refuses retroactive delivery and preserves the exchange',t=>{
  const f=fixture(t),q=f.c.ask(worker,f.focus,{statement:'Already asked',respondent:'research'}),a=answer(f,q)
  assert.equal(a.delivery.state,'not-requested');const before=rows(f)
  assert.throws(()=>f.c.assign(primary,{...f.input,question_id:q.id}),/already answered/)
  assert.deepEqual(rows(f),before);assert.equal(notices(f).length,0)
})
test('pre-existing question binding verifies Worker, scope and exact reference',t=>{
  const f=fixture(t);const q=f.c.ask(research,f.focus,{statement:'Different asker',respondent:'worker'})
  assert.throws(()=>f.c.assign(primary,{...f.input,question_id:q.id}),/does not match/)
  assert.equal(rows(f,'assignment').length,0)
})
test('reused Worker and task IDs never infer an assignment or primary',t=>{
  const f=fixture(t);register(f)
  f.c.assign({...primary,session_id:'second-primary'},{...f.input,assignment_id:'second'})
  const assigned=f.c.execute(worker,{operation:'ask',assignment_id:'second',statement:'Second',respondent:'research'})
  answer(f,assigned);assert.equal(notices(f).length,0);assert.equal(notices(f,{...primary,session_id:'second-primary'}).length,1)
  const unassigned=f.c.ask(worker,f.focus,{statement:'No association',respondent:'research'})
  assert.equal(answer(f,unassigned).delivery.state,'not-requested');assert.equal(rows(f,'delivery-intent').length,1)
})
test('other agents cannot associate questions or completion merely by knowing the assignment ID',t=>{
  const f=fixture(t);register(f)
  assert.throws(()=>f.c.execute(research,{operation:'ask',assignment_id:'assignment',statement:'Wrong Worker',respondent:'user'}),/assigned Worker/)
  assert.throws(()=>f.c.complete(primary,{assignment_id:'assignment',work_ref:f.ref,statement:'Wrong author'}),/assigned Worker/)
  assert.equal(rows(f,'question').length,0);assert.equal(rows(f,'completion').length,0)
})
test('conflicting explicit scope fails instead of falling back to assignment or selection',t=>{
  const f=fixture(t);register(f)
  assert.throws(()=>f.c.execute(worker,{operation:'ask',assignment_id:'assignment',statement:'Wrong',respondent:'research'},
    {action_id:f.action.id,node_id:'other'}),/scope disagrees/)
})
for(const phase of ['answer','delivery-intent']) test(`refused ${phase} write rolls back the complete answer/intent pair`,t=>{
  const f=fixture(t);register(f);const q=ask(f),before=rows(f)
  f.db.exec(`CREATE TRIGGER refuse BEFORE INSERT ON ledger WHEN NEW.kind='${phase}' BEGIN SELECT RAISE(ABORT,'injected refusal'); END`)
  assert.throws(()=>answer(f,q),/refusal/);assert.deepEqual(rows(f),before)
  f.db.exec('DROP TRIGGER refuse');answer(f,q)
  assert.equal(rows(f,'answer').length,1);assert.equal(rows(f,'delivery-intent').length,1)
})
test('a failed commit rolls back answer and intent and permits a later explicit retry',t=>{
  const db=new DatabaseSync(':memory:');let fail=false
  const f=fixture(t,db,{prepare:s=>db.prepare(s),exec:s=>{if(fail&&s==='COMMIT')throw new Error('commit refused');return db.exec(s)}})
  register(f);const q=ask(f),before=rows(f);fail=true
  assert.throws(()=>answer(f,q),/commit refused/);assert.deepEqual(rows(f),before)
  fail=false;answer(f,q);assert.equal(notices(f).length,1)
})
test('competing reader sees neither record between answer and intent; both become visible after commit',t=>{
  const dir=mkdtempSync(join(tmpdir(),'loom-atomic-'));t.after(()=>rmSync(dir,{recursive:true,force:true}))
  const path=join(dir,'ledger.sqlite'),db=new DatabaseSync(path);let observer,inspected=false
  const sql={exec:s=>db.exec(s),prepare:s=>{const p=db.prepare(s);return {get:(...a)=>p.get(...a),all:(...a)=>p.all(...a),run:(...a)=>{
    if(observer&&s.startsWith('INSERT INTO ledger')&&a[3]==='delivery-intent') {
      inspected=true;assert.equal(observer.prepare("SELECT COUNT(*) AS n FROM ledger WHERE kind IN ('answer','delivery-intent')").get().n,0)
      assert.throws(()=>observer.exec('BEGIN IMMEDIATE'),/locked/)
    }
    return p.run(...a)
  }}}}
  const f=fixture(t,db,sql);register(f);const q=ask(f)
  observer=new DatabaseSync(path);t.after(()=>observer.close());observer.exec('PRAGMA busy_timeout=0')
  answer(f,q);assert.equal(inspected,true)
  assert.equal(observer.prepare("SELECT COUNT(*) AS n FROM ledger WHERE kind IN ('answer','delivery-intent')").get().n,2)
})
test('independent worker-thread connections serialize concurrent registration of the same exact assignment',async t=>{
  const dir=mkdtempSync(join(tmpdir(),'loom-register-'));t.after(()=>rmSync(dir,{recursive:true,force:true}))
  const path=join(dir,'ledger.sqlite'),f=fixture(t,new DatabaseSync(path)),barrier=new SharedArrayBuffer(4)
  const program=`const {parentPort,workerData}=require('node:worker_threads');const {DatabaseSync}=require('node:sqlite');
    (async()=>{const {Store}=await import(workerData.module);const db=new DatabaseSync(workerData.path);const c=new Store(db).collaboration;
      parentPort.postMessage({ready:true});Atomics.wait(new Int32Array(workerData.barrier),0,0);
      try{parentPort.postMessage({id:c.assign(workerData.actor,workerData.input).id})}finally{db.close()}})().catch(e=>{throw e})`
  const ws=[0,1].map(()=>new Worker(program,{eval:true,workerData:{path,barrier,actor:primary,input:f.input,module:new URL('../.test-build/store.js',import.meta.url).href}}))
  t.after(async()=>{await Promise.all(ws.map(w=>w.terminate()))})
  const ids=ws.map(w=>new Promise((resolve,reject)=>{w.on('error',reject);w.on('message',m=>{if(m.id)resolve(m.id)})}))
  await Promise.all(ws.map(w=>new Promise((resolve,reject)=>{w.on('error',reject);w.on('message',m=>{if(m.ready)resolve()})})))
  Atomics.store(new Int32Array(barrier),0,1);Atomics.notify(new Int32Array(barrier),0)
  const results=await Promise.all(ids);assert.equal(results[0],results[1]);assert.equal(rows(f,'assignment').length,1)
})
test('multiple qualified answers create distinct linked intents, not an overwritten answer or a resumption flag',t=>{
  const f=fixture(t);register(f);const q=ask(f),a=answer(f,q),b=answer(f,q)
  assert.notEqual(a.delivery.intent_id,b.delivery.intent_id);assert.notEqual(a.id,b.id)
  assert.equal(f.c.thread(q.id).answers.length,2);assert.equal(notices(f).length,2)
  assert.equal(rows(f,'assignment')[0].data.resumed,undefined)
})
test('Session-wide pages remain accessible with absent, different and corrupt selection and current Action',t=>{
  const f=fixture(t);register(f);const q=ask(f);answer(f,q)
  f.store.select('primary');assert.equal(notices(f).length,1)
  f.store.create('Different','Different',primary);assert.equal(notices(f).length,1)
  f.db.prepare("UPDATE focus SET data='{bad' WHERE session_id=?").run('primary')
  f.db.prepare("UPDATE actions SET data='{bad' WHERE id=?").run(f.action.id)
  assert.equal(f.c.execute(primary,{operation:'query',view:'deliveries'}).items.length,1)
  assert.equal(f.c.execute(primary,{operation:'query',view:'assignments'}).items.length,1)
  assert.equal(f.c.execute(primary,{operation:'query',view:'assignments',assignment_id:'assignment'}).items.length,1)
  assert.equal(notices(f,worker).length,0)
})
test('exact intent reads and paging include original scopes and never inherit a different Action',t=>{
  const f=fixture(t);register(f);const q=ask(f);for(let i=0;i<3;i++)answer(f,q)
  let after=0;const ids=[]
  do{const p=f.c.execute(primary,{operation:'query',view:'deliveries',after,limit:1});ids.push(...p.items.map(r=>r.id));after=p.next_after}while(after!==null)
  assert.equal(new Set(ids).size,3)
  assert.equal(f.c.execute(primary,{operation:'query',view:'deliveries',delivery_id:ids[1]}).items[0].id,ids[1])
  assert.equal(f.c.execute(research,{operation:'query',view:'deliveries',delivery_id:ids[1]}).items.length,0)
})
test('assignment paging merges primary and Worker associations without duplicates',t=>{
  const f=fixture(t);register(f)
  f.c.assign(worker,{...f.input,assignment_id:'child-work',worker_session_id:'grandchild'})
  const p=f.c.coordinationRecords(worker,'assignments',0,1),p2=f.c.coordinationRecords(worker,'assignments',p.next_after,1)
  assert.equal(p.items[0].data.assignment_id,'assignment');assert.equal(p2.items[0].data.assignment_id,'child-work');assert.equal(p2.next_after,null)
})
test('restart preserves assignment, answer, intent, exact payload and response-only delivery separation',t=>{
  const dir=mkdtempSync(join(tmpdir(),'loom-stored-notice-'));t.after(()=>rmSync(dir,{recursive:true,force:true}))
  const file=join(dir,'db.sqlite'),f=fixture(t,new DatabaseSync(file));register(f);const q=ask(f),a=answer(f,q),n=notices(f)[0]
  const db=new DatabaseSync(file);t.after(()=>db.close());const c=new Store(db).collaboration
  const saved=c.coordinationRecords(primary,'deliveries').items[0];assert.equal(canonical(saved),canonical(n))
  assert.equal(c.thread(q.id).answers[0].id,a.id);assert.equal(c.thread(q.id).answers[0].delivery,undefined)
})
test('new indexed queries reject oversized stored bodies before materializing them, preserving history',t=>{
  const f=fixture(t);register(f);const q=ask(f);answer(f,q)
  f.db.prepare("UPDATE ledger SET data=json_set(data,'$.extra',?) WHERE kind='delivery-intent'").run('x'.repeat(PROCESSING_LIMITS.recordChars*3))
  assert.throws(()=>notices(f),ProcessingLimitError);assert.equal(rows(f,'answer').length,1)
})
test('invalid new-operation fields are rejected; record add cannot forge an assignment or intent',t=>{
  const f=fixture(t)
  for(const view of ['assignments','deliveries']){
    assert.throws(()=>f.c.execute(primary,{operation:'query',view,action_id:f.action.id}),/not supported/)
    assert.throws(()=>f.c.execute(primary,{operation:'query',view,limit:51}),/Invalid/)
  }
  assert.throws(()=>f.c.execute(primary,{operation:'assign',...f.input,resume:true}),/not supported/)
  for(const kind of ['assignment','delivery-intent'])assert.throws(()=>f.store.record(primary,f.focus,{kind,statement:'Forge'}))
})
