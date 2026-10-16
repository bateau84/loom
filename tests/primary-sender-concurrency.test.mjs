import {test} from 'node:test'
import assert from 'node:assert/strict'
import {DatabaseSync} from 'node:sqlite'
import {Worker} from 'node:worker_threads'
import {mkdtempSync,rmSync} from 'node:fs'
import {join} from 'node:path'
import {Store} from '../.test-build/store.js'
import {workReference} from '../.test-build/collaboration.js'

const actor={session_id:'primary',agent:'primary'}
const authorize={operation:'authorize-continuation',assignment_id:'assignment',continuation:'primary-native/v1'}
const program=`const {parentPort,workerData}=require('node:worker_threads');const {DatabaseSync}=require('node:sqlite');
 (async()=>{const {Store}=await import(workerData.module);const db=new DatabaseSync(workerData.path);let armed=false;
 const sql={prepare:s=>db.prepare(s),exec:s=>{if(armed&&s==='BEGIN IMMEDIATE')parentPort.postMessage({type:'entering'});
 if(armed&&s==='COMMIT'&&workerData.hold){parentPort.postMessage({type:'held'});Atomics.wait(new Int32Array(workerData.barrier),0,0);if(workerData.rollback)throw new Error('injected commit failure')};return db.exec(s)}};
 const c=new Store(sql).collaboration;parentPort.postMessage({type:'ready'});parentPort.once('message',()=>{armed=true;try{
 parentPort.postMessage({type:'result',result:c.execute(workerData.actor,workerData.input)})}catch(e){parentPort.postMessage({type:'result',error:e.message})}finally{db.close();parentPort.close()}})})().catch(e=>{throw e})`

for(const order of ['authorization-first','answer-first','authorization-rollback','withdrawal-first','answer-before-withdrawal'])test(`real concurrent SQL writers serialize ${order}`,async t=>{
  const root=mkdtempSync('/tmp/opencode/loom-sender-race-');t.after(()=>rmSync(root,{recursive:true,force:true}))
  const path=join(root,'db.sqlite'),db=new DatabaseSync(path);t.after(()=>db.close())
  const store=new Store(db),c=store.collaboration,a=store.create('Race','Serialize consent',actor),p=store.savePlan(a.id,0,[{id:'work',kind:'task',title:'Work'}])
  c.assign(actor,{assignment_id:'assignment',worker_session_id:'worker',work_ref:workReference(a,p,'work')})
  const q=c.ask({session_id:'worker',agent:'worker'},undefined,{assignment_id:'assignment',statement:'Question',respondent:'research'})
  const answer={operation:'answer',question_id:q.id,statement:'Qualified answer'}
  const withdrawal={operation:'withdraw-continuation',assignment_id:'assignment',statement:'Withdraw'}
  if(order.includes('withdraw'))c.execute(actor,authorize)
  const first=order==='answer-first'||order==='answer-before-withdrawal'?answer:order==='withdrawal-first'?withdrawal:authorize
  const second=order==='answer-first'?authorize:order==='answer-before-withdrawal'?withdrawal:answer
  const barrier=new SharedArrayBuffer(4)
  const spawn=(input,hold)=>{
    const w=new Worker(program,{eval:true,workerData:{path,module:new URL('../.test-build/store.js',import.meta.url).href,actor,input,hold,barrier,rollback:order==='authorization-rollback'&&hold}})
    t.after(()=>w.terminate())
    const messages=[],waiting=new Map();w.on('message',m=>{messages.push(m);waiting.get(m.type)?.(m)})
    const take=type=>new Promise((resolve,reject)=>{const m=messages.find(m=>m.type===type);if(m)resolve(m);else waiting.set(type,resolve);w.on('error',reject)})
    return {w,take}
  }
  const x=spawn(first,true),y=spawn(second,false)
  await Promise.all([x.take('ready'),y.take('ready')]);x.w.postMessage('run');await x.take('held')
  y.w.postMessage('run');await y.take('entering')
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM ledger WHERE kind='answer'").get().n,0,'uncommitted answer leaked')
  Atomics.store(new Int32Array(barrier),0,1);Atomics.notify(new Int32Array(barrier),0)
  const [xr,yr]=await Promise.all([x.take('result'),y.take('result')])
  if(order==='authorization-rollback')assert.match(xr.error,/commit failure/);else assert.equal(xr.error,undefined)
  assert.equal(yr.error,undefined)
  const intent=c.coordinationRecords(actor,'deliveries').items[0]
  assert.equal(intent.data.automatic_continuation,['authorization-first','answer-before-withdrawal'].includes(order))
  assert.equal(c.thread(q.id).answers.length,1)
  if(order.includes('withdraw'))assert.equal(c.coordinationRecords(actor,'assignments').items[0].continuation.state,'withdrawn')
})
