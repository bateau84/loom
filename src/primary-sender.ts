import { randomUUID } from "node:crypto"
import type { Context } from "@opencode/plugin/promise/plugin"
import { canonical, digest, uid, ProcessingBudget, ProcessingLimitError, PROCESSING_LIMITS, type LedgerRecord, type Actor } from "./model.js"
import { checkedRef, sameRef, type WorkRef } from "./collaboration.js"
import type { Store, SQL } from "./store.js"

const policy = "loom-primary-native-sender/v1"
const renderer = "loom-primary-answer-input/v1"
const eventFormat = "loom-primary-delivery-event/v1"
const paragraph = "Read the exact assignment and delivery through loom_record query views assignments and deliveries, then the full authoritative question thread, following next_after pages. Check whether continuation was withdrawn or this assignment already completed or is already running. An answer is a response, not approval. If continuation is still appropriate, use native subagent delegation to the exact recorded Worker Session with the retained original work_ref. Do not directly resume Worker, recreate the answer to retry delivery, duplicate ongoing work, or treat a native run ending as assignment completion. Recheck withdrawal before re-delegation. Retrieve the exact explicit completion and its results before the next coordinating action."
type Row = { intent_id: string; intent_seq: number; assignment_id: string; bucket: string; version: number; phase: string; attempt_id: string | null;
  binding_record_id: string | null; latest_event_id: string | null; receipt_id: string | null; started: number; native_cancel_event_id: string | null }
type Saved = LedgerRecord & {sequence:number}
export type NativeRequest = {sessionID:string;id:string;text:string;description:string;metadata:Record<string,string>;resume:true;delivery:"steer"}
type Binding = {record:Saved;request:NativeRequest;envelope_digest:string}
export type DeliveryStatus = {eligibility:string;reason:string;transport:"not-attempted"|"preparing"|"admission-uncertain"|"admitted"|"needs-attention";
  latest_attempt_id?:string;latest_event_id?:string;receipt_id?:string;withdrawal_id?:string;native_cancel_event_id?:string}
const object = (value:unknown):Record<string,unknown> => {
  if (!value || typeof value!=="object" || Array.isArray(value)) throw new Error("invalid saved delivery object")
  return value as Record<string,unknown>
}
const equal = (a:unknown,b:unknown) => canonical(a) === canonical(b)
const message = (error:unknown) => error instanceof Error ? error.message : String(error)

/** Durable, indexed local fence. All methods are synchronous; no transaction crosses host I/O. */
export class DeliveryState {
  constructor(private store:Store, private db:SQL, private projectScope="") {
    db.exec(`CREATE TABLE IF NOT EXISTS primary_deliveries (
      intent_id TEXT PRIMARY KEY REFERENCES ledger(id), intent_seq INTEGER NOT NULL, assignment_id TEXT NOT NULL, bucket TEXT NOT NULL,
      version INTEGER NOT NULL DEFAULT 0, phase TEXT NOT NULL DEFAULT 'pending', attempt_id TEXT,
      binding_record_id TEXT, latest_event_id TEXT, receipt_id TEXT, started INTEGER NOT NULL DEFAULT 0, native_cancel_event_id TEXT);
      CREATE INDEX IF NOT EXISTS primary_delivery_bucket ON primary_deliveries(bucket,intent_seq);
      CREATE INDEX IF NOT EXISTS primary_delivery_assignment ON primary_deliveries(assignment_id,intent_seq);
      CREATE INDEX IF NOT EXISTS primary_delivery_events ON ledger(json_extract(data,'$.data.intent_id'),seq) WHERE kind='delivery-event';
      CREATE UNIQUE INDEX IF NOT EXISTS primary_delivery_binding ON ledger(json_extract(data,'$.data.intent_id'))
        WHERE kind='delivery-event' AND json_extract(data,'$.data.phase')='bound';
      CREATE UNIQUE INDEX IF NOT EXISTS primary_delivery_native ON ledger(json_extract(data,'$.data.native_request.id'))
        WHERE kind='delivery-event' AND json_extract(data,'$.data.phase')='bound';`)
  }
  private atomic<T>(run:()=>T):T {
    this.db.exec("BEGIN IMMEDIATE")
    try {const value=run();this.db.exec("COMMIT");return value} catch(error){this.db.exec("ROLLBACK");throw error}
  }
  load(id:string, allowance={bytes:0}):Saved {
    const rows=this.db.prepare("SELECT seq,octet_length(data) AS data_bytes FROM ledger WHERE id=?").all(uid(id)) as {seq:number;data_bytes:number}[]
    for(const r of rows) {allowance.bytes+=r.data_bytes;if(allowance.bytes>4194304)throw new ProcessingLimitError("collaboration read exceeds 4 MiB")}
    const result=this.store.hydrateLedger(rows)[0]
    if(!result)throw new Error(`Unknown delivery record: ${id}`)
    return result
  }
  private row(id:string):Row|undefined {return this.db.prepare("SELECT * FROM primary_deliveries WHERE intent_id=?").get(id) as Row|undefined}
  /** Only invoked with the source answer+intent transaction, never backfills historical intents. */
  enqueue(intent:LedgerRecord) {
    this.db.prepare("INSERT INTO primary_deliveries(intent_id,intent_seq,assignment_id,bucket) SELECT id,seq,?,'pending' FROM ledger WHERE id=?").run(intent.data.assignment_id,intent.id)
  }
  /** Inside the withdrawal transaction. Transport facts remain intact and independently visible. */
  withdraw(assignmentID:string) {
    this.db.prepare("UPDATE primary_deliveries SET bucket=CASE WHEN receipt_id IS NOT NULL THEN 'done' ELSE 'suppressed' END,version=version+1 WHERE assignment_id=?").run(assignmentID)
    return this.db.prepare(`SELECT COALESCE(SUM(receipt_id IS NOT NULL),0) AS admitted, COALESCE(SUM(receipt_id IS NULL AND started=1),0) AS possibly_admitted,
      COALESCE(SUM(started=0 AND receipt_id IS NULL),0) AS suppressed_before_send FROM primary_deliveries WHERE assignment_id=?`).get(assignmentID)
  }
  private related(kind:string,assignmentID:unknown,allowance:{bytes:number}) {
    const row=this.db.prepare("SELECT id FROM ledger WHERE kind=? AND json_extract(data,'$.data.assignment_id')=?").get(kind,assignmentID) as {id:string}|undefined
    return row?this.load(row.id,allowance):undefined
  }
  private inspect(id:string,allowance={bytes:0}) {
    const intent=this.load(id,allowance)
    if(intent.id!==id || intent.kind!=="delivery-intent")throw new Error("delivery_id must identify a delivery intent")
    const d=intent.data, row=this.row(id)
    const assignment=this.related("assignment",d.assignment_id,allowance)
    const withdrawal=this.related("continuation-withdrawal",d.assignment_id,allowance)
    let eligibility="eligible",reason="authorized-pending",binding:Binding|undefined
    try {
      if(d.automatic_continuation!==true){eligibility="stored-only";reason="automatic-continuation-not-authorized"}
      else if(d.sender_policy!==policy || object(d.payload).format!=="loom-answer-notice/v1") {eligibility="unsupported";reason="unsupported-sender-policy-or-payload"}
      else {
        if(!assignment)throw new Error("missing-assignment")
        const a=assignment.data, p=object(d.payload), ref=checkedRef(a.work_ref as WorkRef)
        const auth=this.load(uid(d.authorization_id),allowance), ad=auth.data
        if(auth.kind!=="continuation-authorization" || ad.format!=="loom-primary-continuation-authorization/v1" || ad.mode!=="primary-native/v1"){
          eligibility="unsupported";reason="unsupported-authorization"
        } else {
          const question=this.load(uid(d.question_id),allowance),answer=this.load(uid(d.answer_id),allowance)
          if(assignment.session_id!==a.primary_session_id || a.primary_session_id===a.worker_session_id || a.assignment_id!==d.assignment_id
            || (row && (row.intent_seq!==intent.sequence || row.assignment_id!==a.assignment_id))
            || assignment.action_id!==ref.action_id || assignment.node_id!==ref.node_id
            || auth.sequence>=intent.sequence || assignment.sequence>=auth.sequence || question.sequence>=answer.sequence || answer.sequence>=intent.sequence
            || auth.session_id!==a.primary_session_id || auth.action_id!==assignment.action_id || auth.node_id!==assignment.node_id
            || ad.assignment_id!==a.assignment_id || ad.assignment_record_id!==assignment.id || ad.primary_session_id!==a.primary_session_id
            || ad.worker_session_id!==a.worker_session_id || !sameRef(checkedRef(ad.work_ref as WorkRef),ref)
            || question.kind!=="question" || question.session_id!==a.worker_session_id || question.action_id!==ref.action_id || question.node_id!==ref.node_id
            || !sameRef(checkedRef(question.data.work_ref as WorkRef),ref)
            || (question.data.assignment_id===undefined ? a.question_id!==question.id : question.data.assignment_id!==a.assignment_id)
            || answer.kind!=="answer" || answer.data.question_id!==question.id || answer.data.assignment_id!==a.assignment_id
            || intent.session_id!==answer.session_id || intent.agent!==answer.agent
            || answer.action_id!==ref.action_id || answer.node_id!==ref.node_id || intent.action_id!==ref.action_id || intent.node_id!==ref.node_id
            || d.destination_session_id!==a.primary_session_id || !equal(p,{format:"loom-answer-notice/v1",assignment_id:a.assignment_id,
              primary_session_id:a.primary_session_id,worker_session_id:a.worker_session_id,question_id:question.id,answer_id:answer.id,work_ref:ref,
              thread_query:{operation:"query",view:"thread",question_id:question.id,action_id:question.action_id}}))throw new Error("inconsistent-delivery-links")
        }
      }
      if(eligibility==="eligible" && row?.binding_record_id)binding=this.binding(row,intent,allowance)
    }catch(error){
      if(error instanceof ProcessingLimitError)throw error // An omitted/unreadable body is not an eligibility decision.
      reason=message(error);eligibility=reason.startsWith("unsupported-")?"unsupported":"invalid"
    }
    if(withdrawal){eligibility="withdrawn";reason="continuation-withdrawn"}
    else if(row?.native_cancel_event_id){eligibility="native-cancelled";reason="native-input-cancelled"}
    return {intent,assignment,withdrawal,row,eligibility,reason,binding}
  }
  status(id:string,allowance?:{bytes:number}):DeliveryStatus {
    const s=this.inspect(id,allowance),r=s.row
    const latest = r?.latest_event_id ? this.load(r.latest_event_id,allowance).data : undefined
    return {eligibility:s.eligibility,reason:s.eligibility!=="eligible"?s.reason:r?.receipt_id?"positive-native-admission":typeof latest?.reason==="string"?latest.reason:r?.started?"send-started-admission-not-yet-proven":s.reason,
      transport:r?.receipt_id?"admitted":r?.started?"admission-uncertain":r?.phase==="preflight-failed"?"needs-attention":r?.phase==="preparing" && s.eligibility==="eligible"?"preparing":"not-attempted",
      ...(r?.attempt_id?{latest_attempt_id:r.attempt_id}:{}),...(r?.latest_event_id?{latest_event_id:r.latest_event_id}:{}),
      ...(r?.receipt_id?{receipt_id:r.receipt_id}:{}),...(s.withdrawal?{withdrawal_id:s.withdrawal.id}:{}),...(r?.native_cancel_event_id?{native_cancel_event_id:r.native_cancel_event_id}:{})}
  }
  private append(intent:Saved,phase:string,data:Record<string,unknown>) {
    const r=this.store.append({session_id:String(intent.data.destination_session_id),agent:"loom-primary-sender",action_id:intent.action_id,node_id:intent.node_id,kind:"delivery-event",
      data:{format:eventFormat,intent_id:intent.id,assignment_id:intent.data.assignment_id,phase,...data}})
    return r
  }
  private nativeID(intentID:string) {return "msg_loom_"+digest({format:policy,project_scope:this.projectScope,intent_id:intentID}).slice(0,40)}
  /** Validate the supported frozen v1 format against the already-checked source chain.
   * A self-digest is integrity metadata, never authority to choose route or payload.
   * This never replaces/rerenders a stored request for transport. */
  private binding(row:Row,intent:Saved,allowance?:{bytes:number}):Binding {
    if(!row.binding_record_id)throw new Error("missing-envelope-binding")
    const record=this.load(row.binding_record_id,allowance),d=record.data,request=object(d.native_request)
    if(d.format!==eventFormat || d.renderer_version!==renderer)throw new Error("unsupported-envelope-version")
    if(record.id!==row.binding_record_id || record.kind!=="delivery-event" || d.phase!=="bound" || d.intent_id!==row.intent_id
      || Object.keys(request).sort().join(",")!=="delivery,description,id,metadata,resume,sessionID,text"
      || typeof request.sessionID!=="string" || typeof request.id!=="string" || typeof request.text!=="string"
      || request.description!=="Loom answer available" || request.resume!==true || request.delivery!=="steer"
      || d.envelope_digest!==digest(request))throw new Error("invalid-envelope-binding")
    const metadata=object(request.metadata)
    const payload_digest=digest(intent.data.payload),authorization_id=uid(intent.data.authorization_id)
    if(record.sequence<=intent.sequence || record.session_id!==intent.data.destination_session_id || record.agent!=="loom-primary-sender"
      || record.action_id!==intent.action_id || record.node_id!==intent.node_id || d.assignment_id!==intent.data.assignment_id
      || d.authorization_id!==authorization_id || d.payload_digest!==payload_digest
      || request.sessionID!==intent.data.destination_session_id || request.id!==this.nativeID(intent.id)
      || !equal(metadata,{source:"loom",format:renderer,delivery_id:intent.id,assignment_id:intent.data.assignment_id,authorization_id,payload_digest}))
      throw new Error("inconsistent-envelope-source")
    // Check the versioned notice's source identity and fixed v1 instruction, not a
    // future renderer's output. The saved text/metadata/ID remain the bytes sent.
    const lines=request.text.split("\n")
    if(lines.length!==3 || lines[0]!=="[Loom primary-native/v1]" || lines[2]!==paragraph
      || !equal(JSON.parse(lines[1]),{delivery_id:intent.id,authorization_id,intent_payload:intent.data.payload}))
      throw new Error("inconsistent-envelope-notice")
    if(Object.values(metadata).some(v=>typeof v!=="string"))throw new Error("invalid-envelope-metadata")
    return {record,request:{sessionID:request.sessionID,id:request.id,text:request.text,description:request.description,
      metadata:metadata as Record<string,string>,resume:true,delivery:"steer"},envelope_digest:String(d.envelope_digest)}
  }
  claim(id:string,recover=false):{attempt_id:string;binding:Binding}|undefined {
    return this.atomic(()=>{
      const s=this.inspect(id)
      if(s.eligibility!=="eligible"){
        if(s.row)this.db.prepare("UPDATE primary_deliveries SET bucket='suppressed' WHERE intent_id=? AND receipt_id IS NULL").run(id)
        return undefined
      }
      if(!s.row || s.row.receipt_id || s.row.started || (s.row.phase==="preparing" && !recover))return undefined
      let row=s.row
      if(!row.binding_record_id){
        const payload_digest=digest(s.intent.data.payload),authorization_id=uid(s.intent.data.authorization_id)
        const request:NativeRequest={sessionID:uid(s.intent.data.destination_session_id),id:this.nativeID(id),
          text:"[Loom primary-native/v1]\n"+canonical({delivery_id:id,authorization_id,intent_payload:s.intent.data.payload})+"\n"+paragraph,
          description:"Loom answer available",metadata:{source:"loom",format:renderer,delivery_id:id,assignment_id:uid(s.intent.data.assignment_id),authorization_id,payload_digest},resume:true,delivery:"steer"}
        const bound=this.append(s.intent,"bound",{authorization_id,renderer_version:renderer,native_request:request,payload_digest,envelope_digest:digest(request)})
        this.db.prepare("UPDATE primary_deliveries SET binding_record_id=? WHERE intent_id=?").run(bound.id,id)
        row={...row,binding_record_id:bound.id}
      }
      const attempt_id=randomUUID(),binding=s.binding ?? this.binding(row,s.intent)
      if(row.phase==="preparing")this.append(s.intent,"superseded",{binding_record_id:binding.record.id,attempt_id:row.attempt_id,old_token:row.attempt_id,new_token:attempt_id})
      const preparing=this.append(s.intent,"preparing",{binding_record_id:binding.record.id,attempt_id})
      this.db.prepare("UPDATE primary_deliveries SET version=version+1,phase='preparing',bucket='pending',attempt_id=?,latest_event_id=? WHERE intent_id=? AND version=?")
        .run(attempt_id,preparing.id,id,row.version)
      return {attempt_id,binding}
    })
  }
  start(id:string,token:string):boolean {
    return this.atomic(()=>{
      const s=this.inspect(id),r=s.row
      if(!r || r.attempt_id!==token || r.phase!=="preparing" || r.started || r.receipt_id)return false
      if(s.eligibility!=="eligible"){
        const e=this.append(s.intent,"withdrawn-before-send",{binding_record_id:r.binding_record_id,attempt_id:token,reason:s.reason})
        this.db.prepare("UPDATE primary_deliveries SET phase='withdrawn-before-send',bucket='suppressed',version=version+1,latest_event_id=? WHERE intent_id=?").run(e.id,id)
        return false
      }
      const e=this.append(s.intent,"send-started",{binding_record_id:r.binding_record_id,attempt_id:token})
      this.db.prepare("UPDATE primary_deliveries SET phase='send-started',started=1,bucket='uncertain',version=version+1,latest_event_id=? WHERE intent_id=?").run(e.id,id)
      return true
    })
  }
  failure(id:string,token:string,phase:"preflight-failed"|"admission-uncertain"|"withdrawn-before-send",reason:string) {
    this.atomic(()=>{
      const r=this.row(id);if(!r)return
      const intent=this.load(id),e=this.append(intent,phase,{binding_record_id:r.binding_record_id,attempt_id:token,reason:reason.slice(0,500)})
      if(r.attempt_id!==token)return // A superseded owner's failure is history, never current authority.
      this.db.prepare("UPDATE primary_deliveries SET phase=?,bucket=?,version=version+1,latest_event_id=? WHERE intent_id=?")
        .run(phase,r.receipt_id?"done":r.bucket==="suppressed"?"suppressed":phase==="preflight-failed"?"attention":phase==="withdrawn-before-send"?"suppressed":"uncertain",e.id,id)
    })
  }
  request(id:string) {return this.inspect(id).binding}
  positive(id:string,kind:"ACK"|"live-enqueued"|"context-promoted",evidence:unknown,evidenceRef:Record<string,unknown>):boolean {
    return this.atomic(()=>{
      const s=this.inspect(id),r=s.row,b=s.binding
      if(!r || !r.started || !b)return false
      const item=object(evidence),request=b.request
      const nativeID=kind==="live-enqueued"?evidenceRef.native_id:item.id
      const sessionID=kind==="live-enqueued"?evidenceRef.destination_session_id:item.sessionID
      if(nativeID!==request.id || item.type!=="synthetic")return false
      const body=kind==="context-promoted"?item:object(item.payload)
      if(kind!=="context-promoted" && (sessionID!==request.sessionID || item.delivery!==request.delivery))return false
      if(body.text!==request.text || body.description!==request.description || !equal(body.metadata,request.metadata))return false
      if(r.receipt_id)return true
      const e=this.append(this.load(id),"admitted",{binding_record_id:r.binding_record_id,attempt_id:r.attempt_id,evidence_kind:kind,
        native_id:request.id,destination_session_id:request.sessionID,envelope_digest:b.envelope_digest,evidence_ref:evidenceRef})
      this.db.prepare("UPDATE primary_deliveries SET receipt_id=?,latest_event_id=?,phase='admitted',bucket='done',version=version+1 WHERE intent_id=?").run(e.id,e.id,id)
      return true
    })
  }
  observe(event:unknown) {
    const e=object(event),data=object(e.data),nativeID=data.inboxID
    if(typeof nativeID!=="string")return
    const row=this.db.prepare("SELECT id AS binding_id,json_extract(data,'$.data.intent_id') AS id FROM ledger WHERE kind='delivery-event' AND json_extract(data,'$.data.phase')='bound' AND json_extract(data,'$.data.native_request.id')=?").get(nativeID) as {id:string;binding_id:string}|undefined
    if(!row || this.row(row.id)?.binding_record_id!==row.binding_id)return
    const b=this.request(row.id);if(!b || data.sessionID!==b.request.sessionID)return
    if(e.type==="session.inbox.enqueued")this.positive(row.id,"live-enqueued",data.item,{event_id:e.id,durable:e.durable,native_id:nativeID,destination_session_id:data.sessionID})
    else if(e.type==="session.inbox.cancelled" || e.type==="session.inbox.delivered")this.atomic(()=>{
      const r=this.row(row.id);if(!r)return
      const cancelled=e.type==="session.inbox.cancelled"
      const observation=this.append(this.load(row.id),cancelled?"native-cancelled":"native-delivered",{binding_record_id:r.binding_record_id,attempt_id:r.attempt_id,native_id:nativeID,evidence_ref:{event_id:e.id,durable:e.durable}})
      if(cancelled)this.db.prepare("UPDATE primary_deliveries SET native_cancel_event_id=?,bucket=?,version=version+1 WHERE intent_id=?").run(observation.id,r.receipt_id?"done":"suppressed",row.id)
    })
  }
  startup():string[] {
    const ids=(bucket:string)=>this.db.prepare("SELECT intent_id FROM primary_deliveries WHERE bucket=? ORDER BY intent_seq LIMIT 20").all(bucket) as {intent_id:string}[]
    const pending=ids("pending"),uncertain=ids("uncertain")
    const selected=[...pending.slice(0,10),...uncertain.slice(0,10)]
    selected.push(...pending.slice(10,10+20-selected.length))
    selected.push(...uncertain.slice(10,10+20-selected.length))
    return [...new Set(selected.map(r=>r.intent_id))]
  }
  history(id:string,after=0,limit=20,allowance={bytes:0}) {
    if(!Number.isSafeInteger(after)||after<0||!Number.isSafeInteger(limit)||limit<1||limit>50)throw new Error("Invalid attempt page")
    const rows=this.db.prepare("SELECT id,seq FROM ledger WHERE kind='delivery-event' AND json_extract(data,'$.data.intent_id')=? AND seq>? ORDER BY seq LIMIT ?").all(id,after,limit+1) as {id:string;seq:number}[]
    return {items:rows.slice(0,limit).map(r=>this.load(r.id,allowance)),next_after:rows.length>limit?rows[limit-1].seq:null}
  }
  retryIdentity(actor:Actor,id:string) {
    const s=this.inspect(uid(id))
    if(!s.assignment || s.assignment.data.primary_session_id!==actor.session_id || s.intent.data.destination_session_id!==actor.session_id)throw new Error("Only the exact saved primary Session may retry delivery")
    return {answer_id:s.intent.data.answer_id,question_id:s.intent.data.question_id,assignment_id:s.intent.data.assignment_id,intent_id:id,destination_session_id:s.intent.data.destination_session_id}
  }
}

type Host = Pick<Context["session"],"get"|"synthetic"|"context">
/** One attempt/reconciliation opportunity. Never replays a possibly-entered native call. */
export class PrimarySender {
  private active = new Set<Promise<DeliveryStatus>>()
  constructor(private state:DeliveryState,private host:Host,private local:(session:Awaited<ReturnType<Host["get"]>>)=>Promise<boolean>,
    private lifetime:AbortSignal=new AbortController().signal,private warn:(error:unknown)=>void=console.warn) {}
  private async reconcile(id:string,signal:AbortSignal) {
    const binding=this.state.request(id)
    if(!binding)return
    try {
      const session=await this.host.get({sessionID:binding.request.sessionID},{signal})
      if(session.id!==binding.request.sessionID || !await this.local(session))throw new Error("primary-location-mismatch")
      const current=this.state.status(id)
      if(current.eligibility!=="eligible" || current.receipt_id)return
      const context=await this.host.context({sessionID:binding.request.sessionID},{signal})
      const budget=new ProcessingBudget(PROCESSING_LIMITS.recordChars*3)
      for(const item of context){
        budget.take(0,1)
        if(item.type!=="synthetic" || item.id!==binding.request.id)continue
        canonical(item,budget)
        if(this.state.positive(id,"context-promoted",item,{context_message_id:item.id}))return
      }
      this.state.failure(id,this.state.status(id).latest_attempt_id ?? "unknown","admission-uncertain","context-no-positive-match; absence does not prove nonadmission")
    }catch(error){this.state.failure(id,this.state.status(id).latest_attempt_id ?? "unknown","admission-uncertain","context-unavailable: "+message(error))}
  }
  attempt(id:string,recover=false,callerSignal?:AbortSignal):Promise<DeliveryStatus> {
    const job = this.perform(id,recover,callerSignal).finally(()=>this.active.delete(job))
    this.active.add(job)
    return job
  }
  async settled() {await Promise.allSettled([...this.active])}
  private async perform(id:string,recover=false,callerSignal?:AbortSignal):Promise<DeliveryStatus> {
    const signal=callerSignal?AbortSignal.any([this.lifetime,callerSignal]):this.lifetime
    try {
      const initial=this.state.status(id)
      if(initial.receipt_id || initial.eligibility!=="eligible")return initial
      if(initial.transport==="admission-uncertain") {await this.reconcile(id,signal);return this.state.status(id)}
      const claim=this.state.claim(id,recover)
      if(!claim)return this.state.status(id)
      const {attempt_id,binding}=claim
      try {
        signal.throwIfAborted()
        const session=await this.host.get({sessionID:binding.request.sessionID},{signal})
        if(session.id!==binding.request.sessionID || !await this.local(session))throw new Error("primary-location-mismatch")
        signal.throwIfAborted()
      }catch(error){this.state.failure(id,attempt_id,"preflight-failed",message(error));return this.state.status(id)}
      if(!this.state.start(id,attempt_id))return this.state.status(id)
      try {
        const current=this.state.status(id)
        if(current.eligibility!=="eligible"){
          this.state.failure(id,attempt_id,current.eligibility==="withdrawn"?"withdrawn-before-send":"admission-uncertain",current.reason);return this.state.status(id)
        }
        signal.throwIfAborted()
        const ack=await this.host.synthetic(binding.request,{signal})
        if(!this.state.positive(id,"ACK",ack,{native_id:binding.request.id}))throw new Error("native-ack-mismatch")
      }catch(error){this.state.failure(id,attempt_id,"admission-uncertain",message(error))}
    }catch(error){this.warn(canonical({component:"loom-primary-sender",intent_id:id,error:message(error)}))}
    try {return this.state.status(id)} catch(error){
      this.warn(canonical({component:"loom-primary-sender",intent_id:id,error:"delivery-state-unavailable"}))
      return {eligibility:"invalid",reason:"delivery-state-unavailable; saved answer is separate from transport",transport:"admission-uncertain"}
    }
  }
  async startup() {for(const id of this.state.startup()){if(this.lifetime.aborted)return;await this.attempt(id,true)}}
}
