/** Isolated qualification only. Runs production Loom with real public ctx I/O;
 * wrappers inject boundary failures, never fabricate receipts or submit notices. */
import { Plugin } from "@opencode/plugin"
import { Database } from "bun:sqlite"
import { appendFileSync, readFileSync, existsSync } from "node:fs"
import { join, resolve } from "node:path"
import { randomUUID } from "node:crypto"
import loom from "../../server.js"
import { digest } from "../../src/model.js"
import { observeRequest, observeResponse } from "../handback/request-oracle.mjs"

const provider="sender-fixture", providerPackage="aisdk:"+new URL("../handback/provider.mjs",import.meta.url).href
const usage={inputTokens:{total:1,noCache:1,cacheRead:0,cacheWrite:0},outputTokens:{total:1,text:1,reasoning:0}}
const value=(r:any)=>JSON.parse(typeof r.content==="string"?r.content:r.content.filter((x:any)=>x.type==="text").map((x:any)=>x.text).join("\n")).result

export default Plugin.define({id:"loom.sender.qualification",async setup(ctx){
  const root=process.env.LOOM_SENDER_QUALIFICATION
  if(!root || !root.startsWith("/tmp/opencode/") || resolve(ctx.location.directory)!==resolve(join(root,"project")))throw new Error("Requires isolated sender project")
  const options=JSON.parse(readFileSync(join(root,"case.json"),"utf8")), db=new Database(join(root,"fixture.sqlite"))
  db.exec("PRAGMA journal_mode=WAL; PRAGMA busy_timeout=2000; CREATE TABLE IF NOT EXISTS fixture(key TEXT PRIMARY KEY,data TEXT)")
  const prior=db.query("SELECT data FROM fixture WHERE key='state'").get() as any
  const state:any=prior?JSON.parse(prior.data):{requests:[],nativeInputs:[],answers:0,completions:0,coordinations:0,redelegations:0,primaryPages:[],workerPages:[]}
  let closed=false
  const save=()=>db.query("INSERT INTO fixture VALUES('state',?) ON CONFLICT(key) DO UPDATE SET data=excluded.data").run(JSON.stringify(state))
  const audit=(type:string,data:any={})=>{appendFileSync(join(root,"audit.ndjson"),JSON.stringify({type,...data})+"\n");save()}
  const require=(ok:unknown,why:string)=>{if(!ok)throw new Error(why)}
  const control=()=>JSON.parse(readFileSync(join(root,"control.json"),"utf8"))
  const wait=async(condition:()=>boolean)=>{for(let i=0;i<1600;i++){if(closed)throw new Error("Disposed");if(condition())return;await new Promise(r=>setTimeout(r,25))}throw new Error("Fixture barrier timeout")}
  const filename=join(process.env.XDG_STATE_HOME!,"loom/actions-v1",digest({project:ctx.location.project.id,canonical:ctx.location.project.canonical}),"ledger.sqlite")
  const ledger=()=>new Database(filename)
  // Boundary-only fault wrappers. Production PrimarySender owns every call and exact request.
  const production=await loom.setup({...ctx,event:{subscribe:async function*(input){
    for await(const event of ctx.event.subscribe(input)){
      if(event.type==="session.inbox.enqueued" && (event.data.item as any)?.payload?.metadata?.format==="loom-primary-answer-input/v1")audit("actual-native-enqueued",{event})
      if(["context","context-startup","context-compacted","context-read-error","receipt-failure"].includes(options.mode) && event.type.startsWith("session.inbox."))continue
      yield event
    }
  }},session:{...ctx.session,
    synthetic:async(input,requestOptions)=>{
      state.nativeInputs.push(input);audit("actual-synthetic-entry",{input})
      if(options.mode==="receipt-failure"){
        const l=ledger();try{l.exec("CREATE TRIGGER IF NOT EXISTS refuse_receipt BEFORE INSERT ON ledger WHEN NEW.kind='delivery-event' AND json_extract(NEW.data,'$.data.phase')='admitted' BEGIN SELECT RAISE(ABORT,'injected receipt commit failure'); END")}finally{l.close()}
      }
      const receipt=await ctx.session.synthetic(input,requestOptions)
      audit("actual-synthetic-ack",{receipt})
      if(["context","context-startup","context-compacted","context-read-error","event"].includes(options.mode))throw new Error("Injected ACK loss AFTER actual admission")
      return receipt
    },
    context:async(input,requestOptions)=>{
      const messages=await ctx.session.context(input,requestOptions)
      audit("actual-plugin-context",{sessionID:input.sessionID,synthetics:messages.filter(m=>m.type==="synthetic")})
      if(options.mode==="context-read-error")throw new Error("Injected unavailable context response")
      return messages
    },
  }})
  const regs:Array<{dispose():Promise<void>}>=[]
  const execute=(code:string)=>({tool:"execute",input:{code}})
  const call=(name:string,input:any)=>execute(`return await tools.loom.${name}(${JSON.stringify(input)})`)
  const fullThread=(role:string)=>{
    const pages=role==="primary"?state.primaryPages:state.workerPages,last=pages.at(-1)
    return !last || last.next_after!==null?call("record",{operation:"query",view:"thread",question_id:state.question.id,after:last?.next_after??0,limit:1}):undefined
  }
  const script=async(role:string,prompt:any):Promise<any>=>{
    const text=JSON.stringify(prompt)
    if(role==="primary"){
      if(!state.searchRead)return execute('const r=await search({query:"tools.loom.record"}); const t=r.items.find(x=>x.path==="tools.loom.record"); for(const s of ["authorize-continuation","withdraw-continuation","retry-delivery","admission-uncertain","attempt_limit"]) if(!t?.description.includes(s))throw new Error("SENDER_SCHEMA_HELP missing "+s); for(const s of ["continuation","attempt_after","attempt_limit"])if(!t.signature.includes(s))throw new Error("SENDER_SCHEMA_HELP signature "+s); return "SENDER_SCHEMA_HELP_OK"')
      if(!state.action)return execute('const a=JSON.parse(await tools.loom.action({operation:"create",title:"Sender qualification",goal:"Use a qualified answer and retrieve explicit completion"})).result; await tools.loom.plan({operation:"save",action_id:a.id,expected_revision:0,nodes:[{id:"work",kind:"task",title:"Original work"}]});return a.id')
      if(!state.originalReturned)return {tool:"subagent",input:{agent:"sender-worker",description:"Ask and yield",prompt:`Select Action ${state.action.id}, node work; ask Research and yield.`}}
      if(!state.assignment)return call("record",{operation:"assign",assignment_id:options.assignment,question_id:state.question.id,worker_session_id:state.worker,work_ref:state.ref})
      if(state.answers<2)return call("record",{operation:"answer",question_id:state.question.id,statement:state.answers===0?"Conflicting preliminary answer; unsupported outside this fixture.":"Qualification: preliminary answer is NOT applicable. Read the later source."})
      if(options.mode!=="default" && !state.authorization)return call("record",{operation:"authorize-continuation",assignment_id:options.assignment,continuation:"primary-native/v1"})
      if(!state.researchReturned)return {tool:"subagent",input:{agent:"sender-research",background:true,description:"Qualified answer",prompt:`Answer exact question ${state.question.id} after the isolation barrier.`}}
      const match=text.match(/\[Loom primary-native\/v1\]\\n(\{.*?\})\\nRead the exact/)
      if(!state.notice && match){try{state.notice=JSON.parse(match[1].replaceAll('\\"','"'));audit("primary-notice-in-provider-input",{notice:state.notice})}catch{}}
      // Native prompt serialization may quote JSON. Extract from individual text parts instead.
      if(!state.notice)for(const m of prompt??[])if(m.role==="user")for(const p of typeof m.content==="string"?[{type:"text",text:m.content}]:m.content){
        if(p.type!=="text")continue;const x=p.text.match(/\[Loom primary-native\/v1\]\n([^\n]+)/);if(x){state.notice=JSON.parse(x[1]);audit("primary-notice-in-provider-input",{notice:state.notice})}
      }
      if(!state.notice)return {text:"PRIMARY_WAITING"}
      require(state.notice.intent_payload.worker_session_id===state.worker,"Wrong notice Worker")
      require(JSON.stringify(state.notice.intent_payload.work_ref)===JSON.stringify(state.ref) || digest(state.notice.intent_payload.work_ref)===digest(state.ref),"Original ref changed")
      if(options.mode==="withdrawn-notice" && !state.withdrawal)return call("record",{operation:"withdraw-continuation",assignment_id:options.assignment,statement:"Explicitly withdraw before native redelegation"})
      if(!state.associationRead)return call("record",{operation:"query",view:"assignments",assignment_id:options.assignment})
      if(!state.deliveryRead)return call("record",{operation:"query",view:"deliveries",delivery_id:state.notice.delivery_id,attempt_limit:2})
      if(state.withdrawn)return {text:"PRIMARY_WITHDRAWN"}
      if(!state.completion){
        const next=fullThread("primary");if(next)return next
        require(text.includes(options.marker) && text.includes("NOT applicable") && text.includes("only for this fixture"),"Primary skipped full conflicting/qualified thread")
        if(!state.rechecked)return call("record",{operation:"query",view:"assignments",assignment_id:options.assignment})
        return {tool:"subagent",input:{agent:"sender-worker",sessionID:state.worker,description:"Native answer continuation",prompt:`Continue assignment ${options.assignment} with retained original work_ref ${JSON.stringify(state.ref)}. Retrieve every page of question ${state.question.id} and explicitly complete this original work.`}}
      }
      if(!state.completionRead)return call("record",{operation:"query",action_id:state.action.id,record_id:state.completion.id})
      if(!state.coordinations){require(text.includes(state.completion.id) && text.includes(options.marker),"Primary lacks exact completion results");return call("record",{operation:"add",action_id:state.action.id,kind:"result",statement:`PRIMARY_NEXT_COORDINATING_ACTION using ${state.completion.id}`})}
      if(!["context-startup","context-compacted"].includes(options.mode) && !state.retry)return call("record",{operation:"retry-delivery",delivery_id:state.notice.delivery_id})
      return {text:"PRIMARY_COORDINATION_FINISHED"}
    }
    if(role==="worker"){
      if(!state.ref)return call("context",{action_id:state.action.id,node_id:"work"})
      if(!state.question)return call("record",{operation:"ask",action_id:state.action.id,node_id:"work",respondent:"sender-research",statement:"What is the qualified marker?"})
      if(!state.originalReturned)return {text:"WORKER_ASKED_AND_YIELDED"}
      const next=fullThread("worker");if(next)return next
      require(text.includes(options.marker)&&text.includes("NOT applicable")&&text.includes("only for this fixture"),"Worker skipped full thread")
      if(!state.completion)return call("record",{operation:"complete",assignment_id:options.assignment,work_ref:state.ref,statement:`${options.marker}; valid only for this fixture. Original work finished.`})
      return {text:`WORKER_FINISHED completion=${state.completion.id}`}
    }
    if(role==="research"){
      await wait(()=>control().releaseAnswer===true)
      if(state.answers<3)return call("record",{operation:"answer",question_id:state.question.id,statement:`${options.marker}; valid only for this fixture, not a general conclusion.`,artifact_refs:["fixture:qualified-source"]})
      await wait(()=>control().releaseResearch===true)
      return {text:"RESEARCH_FINISHED"}
    }
    throw new Error("Unexpected role")
  }
  const model=(role:string)=>({specificationVersion:"v3",provider,modelId:role,supportedUrls:{},doGenerate:async()=>{throw new Error("Unexpected generation")},doStream:async(input:any)=>{
    try{
      observeRequest(state,role,input.prompt);state.requests.push(role);audit("provider-entry",{role,prompt:input.prompt,oracle:state.request_oracle})
      require(state.requests.length<100,"Request ceiling")
      const response=await script(role,input.prompt);observeResponse(state,role,response);audit("provider-response",{role,response})
      const events:any[]=[{type:"stream-start",warnings:[]}]
      if(response.tool)events.push({type:"tool-call",toolCallId:randomUUID(),toolName:response.tool,input:JSON.stringify(response.input)})
      else events.push({type:"text-start",id:"text"},{type:"text-delta",id:"text",delta:response.text},{type:"text-end",id:"text"})
      events.push({type:"finish",finishReason:{unified:response.tool?"tool-calls":"stop",raw:response.tool?"tool_calls":"stop"},usage})
      return {stream:new ReadableStream({start(c){for(const e of events)c.enqueue(e);c.close()}})}
    }catch(error){if(!closed){state.failure=String(error);audit("failure")};throw error}
  }})
  try{
    regs.push(await ctx.provider.transform(editor=>{
      for(const p of editor.list())editor.remove(p.provider.id)
      editor.add({info:{id:provider,name:"Local scripted sender fixture",activation:"enabled",package:providerPackage} as any,
        models:["primary","worker","research"].map(id=>({id,modelID:id,providerID:provider,name:id,package:providerPackage,capabilities:{tools:true,input:["text"],output:["text"]},variants:[],time:{released:0},cost:[],status:"active",enabled:true,limit:{context:200000,output:1000}})) as any})
    }))
    regs.push(await ctx.aisdk.hook("sdk",event=>{require(event.model.providerID===provider,"External inference forbidden");event.sdk={languageModel:(id:string)=>model(id)}}))
    regs.push(await ctx.session.hook("model.request",event=>require(event.model.providerID===provider,"External model forbidden")))
    regs.push(await ctx.session.hook("title",event=>{event.result="Sender qualification"}))
    regs.push(await ctx.session.hook("compaction",event=>{event.result={summary:"Qualification completed; prior source notice is outside the active history window."}}))
    regs.push(await ctx.tool.hook("execute.before",event=>{
      const input=event.input as any
      if(event.tool==="subagent" && typeof input?.sessionID==="string" && input.sessionID===state.worker){state.redelegations++;audit("native-redelegation-entry",{primary:event.sessionID,worker:input.sessionID,prompt:input.prompt})}
    }))
    regs.push(await ctx.tool.hook("execute.after",event=>{
      const e=event as any,input=e.input
      if(e.status!=="completed"){state.failure=`Tool failed ${e.tool}: ${e.error?.message}`;audit("tool-failed");return}
      if(e.tool==="execute" && input.code?.includes("SENDER_SCHEMA_HELP")){
        require(JSON.stringify(e.result).includes("SENDER_SCHEMA_HELP_OK"),"Full search-visible sender schema/help not established")
        state.searchRead=true;audit("actual-search-help-qualified")
      }
      if(e.tool==="subagent"){
        const output=e.result.output
        if(input.agent==="sender-worker" && !input.sessionID){require(output.status==="completed","Original call did not return");state.originalReturned=true;state.worker=output.sessionID;state.primary=e.sessionID;audit("original-returned")}
        else if(input.agent==="sender-worker"){state.nativeReturn=output;audit("native-completion-return")}
        else if(input.agent==="sender-research"){state.researchReturned=true;state.research=output.sessionID;audit("research-started")}
      }
      if(!/^loom[_.]/.test(e.tool))return
      const name=e.tool.replace(/^loom[_.]/,""),r=value(e.result);audit("loom-result",{name,input,result:r,session:e.sessionID,agent:e.agent})
      if(name==="action"&&input.operation==="create")state.action=r
      if(name==="context"&&e.agent==="sender-worker")state.ref=r.work_ref
      if(name==="record"){
        if(input.operation==="ask")state.question=r
        if(input.operation==="assign")state.assignment=r
        if(input.operation==="authorize-continuation")state.authorization=r
        if(input.operation==="withdraw-continuation")state.withdrawal=r
        if(input.operation==="answer"){
          state.answers++;if(e.agent==="sender-research")state.answer=r
          if(options.mode==="receipt-failure" && e.agent==="sender-research"){const l=ledger();try{l.exec("DROP TRIGGER IF EXISTS refuse_receipt")}finally{l.close()}}
        }
        if(input.view==="assignments"){
          const a=r.items[0];require(a.data.worker_session_id===state.worker && digest(a.data.work_ref)===digest(state.ref),"Wrong association read")
          state.withdrawn=a.continuation.state==="withdrawn"
          if(state.associationRead)state.rechecked=true;state.associationRead=true
        }
        if(input.view==="deliveries")state.deliveryRead=r
        if(input.view==="thread")(e.agent==="sender-primary"?state.primaryPages:state.workerPages).push(r)
        if(input.operation==="complete"){state.completions++;state.completion=r;audit("explicit-completion")}
        if(typeof state.completion?.id==="string" && input.record_id===state.completion.id && input.operation==="query"){require(r.items.some((x:any)=>x.id===state.completion.id),"Exact completion missing");state.completionRead=true}
        if(input.operation==="add"){require(state.completionRead,"Coordination before exact completion retrieval");state.coordinations++;audit("actual-coordination")}
        if(input.operation==="retry-delivery")state.retry=r
      }
      save()
    }))
    audit("ready")
  }catch(error){closed=true;await Promise.allSettled(regs.map(r=>r.dispose()));await production?.();db.close();throw error}
  return async()=>{closed=true;await Promise.allSettled(regs.map(r=>r.dispose()));await production?.();db.close()}
}})
