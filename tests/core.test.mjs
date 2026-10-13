import { test } from 'node:test'
import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { defaults, mergeConfig, loadConfig, configPaths } from '../.test-build/config.js'
import { registry, guidance, injectInstructions } from '../.test-build/agents.js'
import { Store } from '../.test-build/store.js'
import { validatePlan, canonical, subject } from '../.test-build/model.js'
import { taskContext, Observer } from '../.test-build/context.js'
const actor = { session_id: 'session-a', agent: 'custom-engineer' }
function fixture(t) { const db = new DatabaseSync(':memory:'); t.after(() => db.close()); return new Store(db) }
const task = (id, more = {}) => ({ id, kind: 'task', title: id, ...more })
const config = () => mergeConfig(defaults(), { agents: { custom: { roles: ['planning', 'qa'] } } })

test('defaults do not assume any agents', () => assert.deepEqual(defaults().agents, {}))
test('layered roles replace lists without losing other metadata', () => {
 const base = mergeConfig(defaults(), { agents: { custom: { roles: ['planning'], description: 'original' } } })
 const next = mergeConfig(base, { agents: { custom: { roles: ['qa'] } } })
 assert.deepEqual(next.agents.custom, { roles: ['qa'], description: 'original', enabled: true }); assert.deepEqual(base.agents.custom.roles, ['planning'])
})
test('explicit null removes an inherited agent', () => assert.equal(mergeConfig(config(), { agents: { custom: null } }).agents.custom, undefined))
test('config rejects unknown keys, versions, coercion and bad roles', () => {
 for (const value of [{ version: 2 }, { permissions: {} }, { instructions: { enabled: 'yes' } }, { agents: { a: { roles: 'qa' } } }, { agents: { a: { model: 'x' } } }, { context: { max_chars: NaN } }]) assert.throws(() => mergeConfig(defaults(), value))
})
test('prototype pollution keys are rejected', () => { assert.throws(() => mergeConfig(defaults(), JSON.parse('{"agents":{"__proto__":{"roles":["qa"]}}}'))); assert.equal({}.roles, undefined) })
test('custom roles extend the guidance without requiring special agent names', () => {
 const c = mergeConfig(defaults(), { agents: { analyst: { roles: ['incident'] } }, roles: { incident: { instructions: 'Record the known timeline.' } } })
 assert.match(guidance(c, 'analyst'), /known timeline/)
})
test('discovery reports missing configured agents but retains native agents', () => {
 const entries = registry(config(), [{ id: 'native', description: 'external' }])
 assert.equal(entries.find(a => a.id === 'custom').available, false); assert.equal(entries.find(a => a.id === 'native').configured, false)
})
test('guidance is based on roles, not names', () => { assert.match(guidance(config(), 'custom'), /Assess|Probe/); assert.equal(guidance(config(), 'planner'), undefined) })
test('unconfigured, empty-role, disabled agents and global opt-out receive no instructions', () => {
 assert.equal(guidance(defaults(), 'build'), undefined)
 for (const patch of [{ agents: { custom: { enabled: false } } }, { agents: { custom: { roles: [] } } }, { instructions: { enabled: false } }]) assert.equal(guidance(mergeConfig(config(), patch), 'custom'), undefined)
})
test('injection preserves native system parts and is idempotent across agent switches', () => {
 const native = { type: 'text', text: 'Original instructions' }; const parts = [native]
 injectInstructions(parts, config(), 'custom'); injectInstructions(parts, config(), 'custom'); assert.equal(parts.length, 2); assert.equal(parts[0], native)
 injectInstructions(parts, config(), 'unconfigured'); assert.deepEqual(parts, [native])
})
test('instruction budget reports omitted roles', () => {
 const c = mergeConfig(config(), { instructions: { max_chars: 2000 }, roles: { planning: { instructions: 'x'.repeat(4000) } } })
 const g = guidance(c, 'custom'); assert.ok(g.length <= 2000); assert.match(g, /omitted/)
})
test('config path precedence honors XDG and explicit OpenCode directory', () => {
 assert.deepEqual(configPaths('/repo', {}, '/home/test'), ['/home/test/.config/opencode/.loom.yaml','/repo/.loom.yaml','/repo/.loom.local.yaml'])
 assert.equal(configPaths('/repo',{ XDG_CONFIG_HOME:'/xdg' },'/home/test')[0], '/xdg/opencode/.loom.yaml')
 assert.equal(configPaths('/repo',{ OPENCODE_CONFIG_DIR:'/override', XDG_CONFIG_HOME:'/xdg' },'/home/test')[0], '/override/.loom.yaml')
 assert.throws(() => configPaths('/repo', { OPENCODE_CONFIG_DIR: 'relative' }))
})
test('config reload observes content changes and removal without a restart', async t => {
 const dir = await mkdtemp(join(tmpdir(),'loom-config-')); t.after(() => rm(dir, { recursive: true, force: true })); const path = join(dir,'.loom.yaml')
 // JSON is valid YAML; native.test.ts exercises the real Bun YAML decoder separately.
 await writeFile(path, JSON.stringify({ agents:{ a:{ roles:['planning'] } } })); assert.deepEqual((await loadConfig([path],JSON.parse)).config.agents.a.roles,['planning'])
 await writeFile(path, JSON.stringify({ agents:{ a:{ roles:['qa'] } } })); assert.deepEqual((await loadConfig([path],JSON.parse)).config.agents.a.roles,['qa'])
 await rm(path); assert.deepEqual((await loadConfig([path],JSON.parse)).config.agents,{})
})
test('invalid configuration disables injection and capture instead of applying partial configuration', async t => {
 const dir = await mkdtemp(join(tmpdir(),'loom-invalid-')); t.after(() => rm(dir,{recursive:true,force:true})); const a=join(dir,'a'),b=join(dir,'b')
 await writeFile(a,JSON.stringify({agents:{one:{roles:['qa']}}})); await writeFile(b,'broken yaml'); const s=await loadConfig([a,b],JSON.parse)
 assert.equal(s.errors.length,1); assert.deepEqual(s.config.agents,{}); assert.equal(s.config.ledger.capture,'off'); assert.equal(s.config.instructions.enabled,false)
})
test('oversized configuration is rejected before decoding', async t => {
 const dir=await mkdtemp(join(tmpdir(),'loom-limit-')); t.after(()=>rm(dir,{recursive:true,force:true})); const p=join(dir,'a'); await writeFile(p,'x'.repeat(70000)); let called=false
 assert.equal((await loadConfig([p],()=>{called=true})).errors.length,1); assert.equal(called,false)
})
test('canonical digest input is stable and valid JSON', () => { assert.equal(canonical({b:2,a:[1]}),'{"a":[1],"b":2}'); assert.deepEqual(JSON.parse(canonical({a:{b:true}})),{a:{b:true}}) })
test('simple plan can contain tasks only', () => assert.deepEqual(validatePlan([task('a')]),[task('a')]))
test('complete optional hierarchy is accepted', () => assert.equal(validatePlan([{id:'p',kind:'phase',title:'Phase'},{id:'w',kind:'wave',title:'Wave',parent:'p'},task('a',{parent:'w'}),{id:'s',kind:'subtask',title:'Subtask',parent:'a'}]).length,4))
test('plans reject duplicate IDs, dangling dependencies, reversed parents and cycles', () => {
 for (const nodes of [[task('a'),task('a')],[task('a',{depends_on:['missing']})],[task('a',{parent:'b'}),task('b')],[task('a',{depends_on:['b']}),task('b',{depends_on:['a']})]]) assert.throws(()=>validatePlan(nodes))
})
test('parent/dependency composition cycles are rejected', () => assert.throws(()=>validatePlan([{id:'p',kind:'phase',title:'p',depends_on:['a']},task('a',{parent:'p'})])))
test('unknown plan keys do not turn into hidden authority', () => assert.throws(()=>validatePlan([task('a',{permissions:'allow all'})])))
test('Action can exist with no plan and selects only its creator Session', t => {
 const s=fixture(t),a=s.create('Fix','Resolve the defect',actor); assert.equal(s.plan(a.id).revision,0); assert.equal(s.selected(actor.session_id).action_id,a.id); assert.equal(s.selected('other'),undefined)
})
test('Action edits use a revision check and do not infer completion from reviews', t => {
 const s=fixture(t),a=s.create('Fix','Goal',actor); s.update(a.id,1,{state:'paused'}); assert.throws(()=>s.update(a.id,1,{state:'completed'})); assert.equal(s.action(a.id).state,'paused')
})
test('plan history survives edits, and stale writers cannot overwrite it', t => {
 const s=fixture(t),a=s.create('Fix','Goal',actor); s.savePlan(a.id,0,[task('a')]); s.savePlan(a.id,1,[task('a'),task('b')]); assert.throws(()=>s.savePlan(a.id,1,[])); assert.equal(s.plan(a.id,1).nodes.length,1); assert.equal(s.plan(a.id).nodes.length,2)
})
test('unchanged tasks retain their contract match across unrelated plan changes', t => {
 const s=fixture(t),a=s.create('Fix','Goal',actor); s.savePlan(a.id,0,[task('a'),task('b')]); const f={action_id:a.id,node_id:'a'}
 const r=s.record(actor,f,{kind:'result',statement:'Implemented a'}); s.savePlan(a.id,1,[task('a'),task('b',{outcome:'changed'})]); assert.equal(s.contractMatch(r),true)
 s.savePlan(a.id,2,[task('a',{outcome:'different'}),task('b')]); assert.equal(s.contractMatch(r),false); assert.equal(s.records({action_id:a.id}).items[0].id,r.id)
})
test('dependency and parent changes affect consumer contract matching', t => {
 const s=fixture(t),a=s.create('Fix','Goal',actor),base=[task('a'),task('b',{depends_on:['a']})]; s.savePlan(a.id,0,base)
 const before=subject(a,s.plan(a.id),'b'); s.savePlan(a.id,1,[task('a',{outcome:'new'}),base[1]]); assert.notEqual(subject(a,s.plan(a.id),'b'),before)
})
test('removed task history remains accessible without being reassigned', t => {
 const s=fixture(t),a=s.create('Fix','Goal',actor); s.savePlan(a.id,0,[task('a')]); s.select(actor.session_id,{action_id:a.id,node_id:'a'}); const r=s.record(actor,s.selected(actor.session_id),{kind:'claim',statement:'Historical claim'}); s.savePlan(a.id,1,[])
 assert.equal(s.contractMatch(r),false); assert.throws(()=>taskContext(s,s.selected(actor.session_id))); assert.equal(s.records({action_id:a.id}).items.length,1)
})
test('claims cannot invent observations or refer to another Action', t => {
 const s=fixture(t),a=s.create('A','Goal',actor),b=s.create('B','Goal',actor),obs=s.observe(actor,{action_id:b.id},{phase:'finished'})
 assert.throws(()=>s.record(actor,{action_id:a.id},{kind:'observation',statement:'made up'})); assert.throws(()=>s.record(actor,{action_id:a.id},{kind:'claim',statement:'done',evidence_ids:['missing']})); assert.throws(()=>s.record(actor,{action_id:a.id},{kind:'claim',statement:'done',evidence_ids:[obs.id]}))
})
test('claims link observations without being promoted into verified facts', t => {
 const s=fixture(t),a=s.create('A','Goal',actor),f={action_id:a.id}; const obs=s.observe(actor,f,{status:'completed'}),r=s.record(actor,f,{kind:'claim',statement:'Tests passed',evidence_ids:[obs.id]})
 assert.deepEqual(r.data.evidence_ids,[obs.id]); assert.match(r.data.verification,/not independently validated/)
})
test('Assessment and QA remain separate append-only opinions', t => {
 const s=fixture(t),a=s.create('A','Goal',actor),f={action_id:a.id}; s.record(actor,f,{kind:'assessment',verdict:'pass',statement:'Looks correct'}); s.record({session_id:'review',agent:'independent'},f,{kind:'qa',verdict:'inconclusive',statement:'Missing a probe'})
 assert.deepEqual(s.records({action_id:a.id}).items.map(r=>r.kind),['assessment','qa']); assert.equal(s.action(a.id).state,'active'); assert.throws(()=>s.record(actor,f,{kind:'qa',statement:'no verdict'}))
})
test('observations retain start-time Action and Task after the Session switches work', t => {
 const s=fixture(t),a=s.create('A','Goal',actor),b=s.create('B','Goal',actor); s.select(actor.session_id,{action_id:a.id}); const o=new Observer(s),e={sessionID:actor.session_id,agent:actor.agent,messageID:'m',id:'c',tool:'shell',input:{command:'secret'}}
 o.before(e); s.select(actor.session_id,{action_id:b.id}); const r=o.after({...e,status:'completed',result:{output:'secret response'}})
 assert.equal(r.action_id,a.id); assert.equal(JSON.stringify(s.records({action_id:a.id})).includes('secret'),false); assert.equal(s.records({action_id:b.id}).items.length,0)
})
test('missing start never borrows current work attribution', t => {
 const s=fixture(t); s.create('A','Goal',actor); const r=new Observer(s).after({sessionID:actor.session_id,agent:actor.agent,messageID:'m',id:'c',tool:'shell',input:{},status:'error',error:{message:'failed'}})
 assert.equal(r.action_id,undefined); assert.match(r.data.attribution,/missing-start/)
})
test('a started but interrupted call is not a completed observation', t => {
 const s=fixture(t),a=s.create('Fix','Goal',actor),o=new Observer(s); const e={sessionID:actor.session_id,agent:actor.agent,messageID:'m',id:'c',tool:'read',input:{}}
 o.before(e); const rows=s.records({action_id:a.id}).items; assert.equal(rows.length,1); assert.equal(rows[0].data.phase,'started'); assert.equal(rows[0].data.status,undefined)
})
test('clearing selection leaves conversation independent of Actions', t => {
 const s=fixture(t); s.create('A','Goal',actor); s.select(actor.session_id); assert.equal(s.selected(actor.session_id),undefined); assert.equal(s.hasSelection(actor.session_id),true)
})
test('ledger pagination does not skip or repeat records', t => {
 const s=fixture(t),a=s.create('A','Goal',actor); for(let i=0;i<7;i++)s.observe(actor,{action_id:a.id},{n:i}); let after=0,seen=[]
 do {const page=s.records({action_id:a.id,after,limit:3});seen.push(...page.items.map(r=>r.id));after=page.next_after} while(after!==null)
 assert.equal(seen.length,7);assert.equal(new Set(seen).size,7)
})
test('separate project databases do not share Actions', t => { const a=fixture(t),b=fixture(t),action=a.create('A','Goal',actor);assert.throws(()=>b.action(action.id)) })
test('new instances share durable state without overwriting stale revisions', async t => {
 const dir=await mkdtemp(join(tmpdir(),'loom-shared-')),path=join(dir,'db'); const d1=new DatabaseSync(path),d2=new DatabaseSync(path); t.after(async()=>{d1.close();d2.close();await rm(dir,{recursive:true,force:true})})
 const s1=new Store(d1),s2=new Store(d2),a=s1.create('A','Goal',actor);s1.savePlan(a.id,0,[task('a')]);assert.equal(s2.plan(a.id).revision,1);assert.throws(()=>s2.savePlan(a.id,0,[task('b')]));assert.equal(s1.plan(a.id).nodes[0].id,'a')
})
test('unknown database schema is not overwritten', t => {
 const db=new DatabaseSync(':memory:');t.after(()=>db.close());db.exec('PRAGMA user_version=99');assert.throws(()=>new Store(db));assert.equal(db.prepare('PRAGMA user_version').get().user_version,99)
})
test('large context is explicitly bounded and never truncated into invalid JSON', t => {
 const s=fixture(t),a=s.create('A','g'.repeat(15000),actor);s.savePlan(a.id,0,[task('a',{context:'x'.repeat(8000)})]);const c=taskContext(s,{action_id:a.id,node_id:'a'},2000);assert.equal(c.truncated,true);assert.ok(JSON.stringify(c).length<=2000)
})
test('many long role names cannot exceed instruction budget', () => {
 const roles=Array.from({length:20},(_,i)=>`role-${i}-`+'x'.repeat(80));const c=mergeConfig(defaults(),{instructions:{max_chars:2000},agents:{custom:{roles}}});assert.ok(guidance(c,'custom').length<=2000)
})
test('context retrieves recent results instead of repeatedly showing only the first page', t => {
 const s=fixture(t),a=s.create('A','Goal',actor);s.savePlan(a.id,0,[task('a'),task('b')]);for(let i=0;i<80;i++)s.observe(actor,{action_id:a.id,node_id:'b'},{n:i});s.record(actor,{action_id:a.id,node_id:'a'},{kind:'result',statement:'Latest important result'})
 const c=taskContext(s,{action_id:a.id,node_id:'a'});assert.ok(JSON.stringify(c).includes('Latest important result'));assert.equal(c.records.length,1)
})
test('Task ledger queries and exact record lookup preserve historical retrieval', t => {
 const s=fixture(t),a=s.create('A','Goal',actor);s.savePlan(a.id,0,[task('a'),task('b')]);const r=s.record(actor,{action_id:a.id,node_id:'a'},{kind:'result',statement:'A result'});s.record(actor,{action_id:a.id,node_id:'b'},{kind:'result',statement:'B result'})
 assert.equal(s.records({action_id:a.id,node_id:'a'}).items.length,1);assert.equal(s.records({action_id:a.id,record_id:r.id}).items[0].id,r.id)
})
