import { test, expect } from "bun:test"
import { Database } from "bun:sqlite"
import { Store } from "../src/store.js"
import { workReference } from "../src/collaboration.js"
import { PrimarySender, DeliveryState } from "../src/primary-sender.js"
import { mkdtempSync, rmSync, readFileSync } from "node:fs"
import { createHash } from "node:crypto"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { registeredLoom } from "./helpers/registered-loom.js"
import { digest } from "../src/model.js"
import { legacyDeliveryDDL, legacyFixture, savedRows } from "./helpers/legacy-delivery.js"
import historicalSource from "./fixtures/historical-3f08da9/provenance.json" with { type: "json" }

test("observed empty legacy delivery projection initializes and repeatedly reopens without changing history or creating work", async () => {
  const dir = mkdtempSync(join(tmpdir(), "ALP08-legacy-")), filename = join(dir, "synthetic.sqlite")
  let db = new Database(filename)
  try {
    const f = legacyFixture(db), before = savedRows(db), meaning = f.meaning(f.store)
    expect(db.query("PRAGMA table_info(primary_deliveries)").all().map((c: any) => c.name)).toEqual([
      "intent_id", "intent_seq", "bucket", "version", "phase", "attempt_id",
      "binding_record_id", "latest_event_id", "receipt_id", "started", "native_cancel_event_id",
    ])
    expect(db.query("SELECT count(*) AS n FROM ledger WHERE kind IN ('assignment','continuation-authorization','continuation-withdrawal','answer','delivery-intent','delivery-event')").get()).toEqual({ n: 0 })
    expect(before.actions).toHaveLength(2); expect(before.plans).toHaveLength(4)
    expect(before.action_versions).toHaveLength(1); expect(before.ledger.length).toBeGreaterThan(5)
    expect(meaning.selected).toEqual({ action_id: f.action.id, node_id: "work" })
    expect(meaning.progress.items[0]).toMatchObject({ state: "open", current_node: true, reported_by: "worker" })
    expect(meaning.progress.note).toContain("not independent acceptance")
    expect(meaning.thread.question.data.work_ref).toEqual(f.ref)
    expect(meaning.thread.note).toContain("not resolution, approval or permission")
    expect(meaning.ref.action_revision).toBe(2); expect(meaning.ref.plan_revision).toBe(2)
    db.close()
    for (let reopen = 0; reopen < 3; reopen++) {
      db = new Database(filename)
      const store = new Store(db), b = boundary()
      expect(store.delivery.startup()).toEqual([])
      expect(db.query("PRAGMA table_info(primary_deliveries)").all().find((c: any) => c.name === "assignment_id")).toMatchObject({ type: "TEXT", notnull: 1, dflt_value: null })
      expect(db.query("PRAGMA index_info(primary_delivery_assignment)").all().map((c: any) => c.name)).toEqual(["assignment_id", "intent_seq"])
      await b.sender(store.delivery).startup()
      expect(b.calls).toEqual([])
      expect(savedRows(db)).toEqual(before)
      for (const row of db.query("SELECT seq,octet_length(data) AS data_bytes,data FROM ledger ORDER BY seq").all() as { seq: number; data_bytes: number; data: string }[]) {
        expect(store.hydrateLedger([row])).toEqual([{ sequence: row.seq, ...JSON.parse(row.data) }])
      }
      expect(store.action(f.other.id)).toEqual(f.other)
      expect(f.meaning(store)).toEqual(meaning)
      expect(db.query("PRAGMA foreign_key_check").all()).toEqual([])
      expect(db.query("PRAGMA integrity_check").get()).toEqual({ integrity_check: "ok" })
      expect(db.query("PRAGMA user_version").get()).toEqual({ user_version: 1 })
      expect(db.query("PRAGMA application_id").get()).toEqual({ application_id: 0 })
      db.close()
    }
  } finally { db.close(); rmSync(dir, { recursive: true, force: true }) }
})

for (const scenario of ["nonempty-legacy", "masked-legacy-index", "masked-missing-column", "extra-column", "changed-default", "changed-nullability", "missing-reference", "unobserved-column-order", "token-boundary", "literal-case", "legacy-trigger", "legacy-unique-index", "current-wrong-index"]) {
  test(`incompatible delivery schema ${scenario} rejects explicitly without changing any rows or schema`, () => {
    const db = new Database(":memory:")
    try {
      const f = legacyFixture(db)
      if (scenario === "nonempty-legacy") db.exec("INSERT INTO primary_deliveries(intent_id,intent_seq,bucket) SELECT id,seq,'uncertain' FROM ledger ORDER BY seq LIMIT 1")
      if (scenario === "masked-missing-column") db.exec("DROP TABLE primary_deliveries; CREATE TABLE primary_deliveries (intent_id TEXT PRIMARY KEY, intent_seq INTEGER, bucket TEXT)")
      if (scenario.startsWith("masked-")) db.exec("CREATE INDEX primary_delivery_assignment ON primary_deliveries(bucket,intent_seq)")
      if (scenario === "extra-column") db.exec("ALTER TABLE primary_deliveries ADD COLUMN unknown TEXT")
      if (scenario === "changed-default") db.exec("DROP TABLE primary_deliveries;" + legacyDeliveryDDL.replace("DEFAULT 'pending'", "DEFAULT 'done'"))
      if (scenario === "changed-nullability") db.exec("DROP TABLE primary_deliveries;" + legacyDeliveryDDL.replace("started INTEGER NOT NULL", "started INTEGER"))
      if (scenario === "missing-reference") db.exec("DROP TABLE primary_deliveries;" + legacyDeliveryDDL.replace(" REFERENCES ledger(id)", ""))
      if (scenario === "unobserved-column-order") db.exec("DROP TABLE primary_deliveries;" + legacyDeliveryDDL.replace("started INTEGER NOT NULL DEFAULT 0, native_cancel_event_id TEXT", "native_cancel_event_id TEXT, started INTEGER NOT NULL DEFAULT 0"))
      if (scenario === "token-boundary") db.exec("DROP TABLE primary_deliveries;" + legacyDeliveryDDL.replace("version INTEGER NOT NULL DEFAULT 0", "versionINTEGER NOTNULLDEFAULT0"))
      if (scenario === "literal-case") db.exec("DROP TABLE primary_deliveries;" + legacyDeliveryDDL.replace("'pending'", "'PENDING'"))
      if (scenario === "legacy-trigger") db.exec("CREATE TRIGGER unknown_delivery AFTER INSERT ON primary_deliveries BEGIN UPDATE primary_deliveries SET started=1; END")
      if (scenario === "legacy-unique-index") db.exec("CREATE UNIQUE INDEX unknown_delivery ON primary_deliveries(bucket)")
      if (scenario === "current-wrong-index") {
        new Store(db)
        db.exec("DROP INDEX primary_delivery_assignment; CREATE INDEX primary_delivery_assignment ON primary_deliveries(bucket,intent_seq)")
      }
      // Force some otherwise-normal initialization DDL to be needed before rejection.
      db.exec("DROP INDEX ledger_action; PRAGMA user_version=0")
      const rows = savedRows(db), schema = db.query("SELECT * FROM sqlite_schema ORDER BY name").all()
      const version = db.query("PRAGMA schema_version").get(), meaning = f.meaning(f.store)
      for (let attempt = 0; attempt < 2; attempt++) {
        expect(() => new Store(db)).toThrow("Unsupported primary_deliveries schema")
        expect(() => new Store(db)).toThrow("preserve a backup")
        expect(savedRows(db)).toEqual(rows)
        expect(db.query("SELECT * FROM sqlite_schema ORDER BY name").all()).toEqual(schema)
        expect(db.query("PRAGMA schema_version").get()).toEqual(version)
        expect(db.query("PRAGMA user_version").get()).toEqual({ user_version: 0 })
        expect(f.meaning(f.store)).toEqual(meaning)
      }
    } finally { db.close() }
  })
}

test("an injected later driver failure rolls back the empty legacy upgrade as well as earlier DDL", () => {
  const db = new Database(":memory:")
  try {
    legacyFixture(db)
    db.exec("DROP INDEX ledger_action")
    const rows = savedRows(db), schema = db.query("SELECT * FROM sqlite_schema ORDER BY name").all(), version = db.query("PRAGMA schema_version").get()
    const driver = { prepare: (sql: string) => db.prepare(sql), exec: (sql: string) => {
      if (sql.startsWith("CREATE TABLE IF NOT EXISTS action_versions")) {
        expect(db.query("PRAGMA table_info(primary_deliveries)").all()).toHaveLength(12)
        throw new Error("synthetic late initialization driver failure")
      }
      return db.exec(sql)
    } }
    expect(() => new Store(driver)).toThrow("synthetic late initialization driver failure")
    expect(savedRows(db)).toEqual(rows)
    expect(db.query("SELECT * FROM sqlite_schema ORDER BY name").all()).toEqual(schema)
    expect(db.query("PRAGMA schema_version").get()).toEqual(version)
  } finally { db.close() }
})

test("empty legacy upgrade never turns historical flags without authorization into startup consent", async () => {
  const f = fixture(), b = boundary()
  try {
    const falseID = f.answer().delivery.intent_id!, missingID = f.answer().delivery.intent_id!, trueID = f.answer().delivery.intent_id!
    f.db.prepare("UPDATE ledger SET data=json_remove(data,'$.data.automatic_continuation') WHERE id=?").run(missingID)
    f.db.prepare("UPDATE ledger SET data=json_set(data,'$.data.automatic_continuation',json('true'),'$.data.sender_policy','loom-primary-native-sender/v1') WHERE id=?").run(trueID)
    f.db.exec("DROP TABLE primary_deliveries;" + legacyDeliveryDDL)
    const before = savedRows(f.db)
    const hostIO: string[] = []
    b.host.get = async () => { hostIO.push("get"); throw new Error("No historical Session lookup") }
    b.host.context = async () => { hostIO.push("context"); throw new Error("No historical Session context") }
    for (let reopen = 0; reopen < 3; reopen++) {
      const store = new Store(f.db, "scope")
      for (const id of [falseID, missingID]) expect(store.delivery.status(id)).toMatchObject({ eligibility: "stored-only", reason: "automatic-continuation-not-authorized", transport: "not-attempted" })
      expect(store.delivery.status(trueID)).toMatchObject({ eligibility: "invalid", transport: "not-attempted" })
      expect(store.delivery.startup()).toEqual([])
      await b.sender(store.delivery).startup()
      expect(b.calls).toEqual([]); expect(hostIO).toEqual([])
      expect(savedRows(f.db)).toEqual(before)
    }
    expect(f.db.query("SELECT count(*) AS n FROM ledger WHERE kind='continuation-authorization'").get()).toEqual({ n: 0 })
    // Only a new explicit authorization and subsequent answer may enter the queue.
    b.host.get = async ({ sessionID }: { sessionID: string }) => ({ id: sessionID })
    const store = new Store(f.db, "scope")
    f.authorize()
    const newID = f.answer().delivery.intent_id!
    expect(store.delivery.startup()).toEqual([newID])
    expect((await b.sender(store.delivery).attempt(newID)).transport).toBe("admitted")
    expect(b.calls).toHaveLength(1)
    expect(b.calls[0].metadata.delivery_id).toBe(newID)
    const populated = savedRows(f.db), reloaded = new Store(f.db, "scope")
    await b.sender(reloaded.delivery).startup()
    expect(b.calls).toHaveLength(1)
    expect(savedRows(f.db)).toEqual(populated)
    for (const id of [falseID, missingID]) expect(reloaded.delivery.status(id).eligibility).toBe("stored-only")
    expect(reloaded.delivery.status(trueID).eligibility).toBe("invalid")
  } finally { f.db.close() }
})

function fixture(filename=":memory:") {
  const db = new Database(filename), store = new Store(db,"scope"), c = store.collaboration
  const primary = { session_id: "primary", agent: "coordinator" }, worker = { session_id: "worker", agent: "worker" }
  const action = store.create("Sender", "Preserve qualified work", primary)
  const plan = store.savePlan(action.id, 0, [{id:"work",kind:"task",title:"Work"}])
  const ref = workReference(action, plan, "work")
  c.assign(primary, {assignment_id:"assignment",worker_session_id:"worker",work_ref:ref})
  const question = c.ask(worker, undefined, {assignment_id:"assignment",respondent:"research",statement:"Qualified answer?"})
  const authorize = () => c.execute(primary, {operation:"authorize-continuation",assignment_id:"assignment",continuation:"primary-native/v1"}) as any
  const answer = () => c.answer({session_id:"research",agent:"research"}, {question_id:question.id,statement:"Only under these conditions."})
  return {db,store,c,primary,worker,ref,question,authorize,answer}
}
function boundary() {
  const calls:any[] = [], context:any[] = []
  const host:any = {get:async({sessionID}:any)=>({id:sessionID}),context:async()=>context,synthetic:async(request:any)=>{
    calls.push(request);return ack(request)
  }}
  return {host,calls,context,sender:(state:DeliveryState)=>new PrimarySender(state,host,async()=>true,undefined,()=>{})}
}
const ack = (r:any) => ({id:r.id,sessionID:r.sessionID,time:{created:0},type:"synthetic",delivery:r.delivery,payload:{text:r.text,description:r.description,metadata:r.metadata}})
const withdraw = (f:ReturnType<typeof fixture>) => f.c.execute(f.primary,{operation:"withdraw-continuation",assignment_id:"assignment",statement:"Explicitly withdrawn"}) as any
const fresh = (f:ReturnType<typeof fixture>) => { f.authorize();return f.answer().delivery.intent_id! }

test("a self-digested binding cannot select Worker instead of the authorized primary, before ANY host I/O",async()=>{
  const f=fixture(),b=boundary(),io:string[]=[]
  try {
    const id=fresh(f),claim=f.store.delivery.claim(id)!,record=claim.binding.record
    const request=record.data.native_request as any
    request.sessionID="worker";record.data.envelope_digest=digest(request)
    f.db.query("UPDATE ledger SET data=? WHERE id=?").run(JSON.stringify(record),record.id)
    b.host.get=async()=>{io.push("get");return {id:"worker"}}
    b.host.context=async()=>{io.push("context");return []}
    const result=await b.sender(f.store.delivery).attempt(id,true)
    expect(result.eligibility).toBe("invalid")
    expect(io).toEqual([]);expect(b.calls).toEqual([])
    expect(f.c.thread(f.question.id).answers).toHaveLength(1)
  }finally{f.db.close()}
})

const malformedBindings = ["destination-worker","destination-other-primary","native-id","metadata-authorization","metadata-assignment","metadata-delivery",
  "metadata-payload","metadata-source","metadata-format","bound-authorization","bound-assignment","bound-intent","bound-payload",
  "bound-action","bound-node","bound-session","bound-agent","bound-id","bound-sequence","notice-delivery","notice-authorization",
  "notice-source-answer","notice-worker","notice-ref","notice-instruction","intent-session","intent-agent","answer-session","answer-agent","projection-assignment"]
function malformedBinding(f:ReturnType<typeof fixture>,id:string,change:string) {
  const record=f.store.delivery.request(id)!.record,request=record.data.native_request as any
  const save=(r:any)=>f.db.query("UPDATE ledger SET data=? WHERE id=?").run(JSON.stringify(r),r.id)
  if(change.startsWith("destination-"))request.sessionID=change==="destination-worker"?"worker":"other-primary"
  if(change==="native-id")request.id="msg_loom_"+"f".repeat(40)
  const metadata:Record<string,string>={authorization:"authorization_id",assignment:"assignment_id",delivery:"delivery_id",payload:"payload_digest",source:"source",format:"format"}
  if(change.startsWith("metadata-"))request.metadata[metadata[change.slice(9)]]="different"
  const fields:Record<string,string>={authorization:"authorization_id",assignment:"assignment_id",intent:"intent_id",payload:"payload_digest"}
  if(change.startsWith("bound-") && fields[change.slice(6)])record.data[fields[change.slice(6)]]="different"
  if(change==="bound-action")record.action_id="different"
  if(change==="bound-node")record.node_id="different"
  if(change==="bound-session")record.session_id="worker"
  if(change==="bound-agent")record.agent="research"
  if(change==="bound-sequence")record.sequence=1
  if(change.startsWith("notice-")){
    const lines=request.text.split("\n"),notice=JSON.parse(lines[1])
    if(change==="notice-delivery")notice.delivery_id="different"
    if(change==="notice-authorization")notice.authorization_id="different"
    if(change==="notice-source-answer")notice.intent_payload.answer_id="different"
    if(change==="notice-worker")notice.intent_payload.worker_session_id="different"
    if(change==="notice-ref")notice.intent_payload.work_ref.hash="f".repeat(64)
    if(change==="notice-instruction")lines[2]="Directly resume Worker instead."
    lines[1]=JSON.stringify(notice);request.text=lines.join("\n")
  }
  record.data.envelope_digest=digest(request)
  if(change==="bound-id"){
    const original=record.id;record.id="different"
    f.db.query("UPDATE ledger SET data=? WHERE id=?").run(JSON.stringify(record),original)
  }else save(record)
  if(change.startsWith("intent-")){
    const intent=f.store.delivery.load(id)
    if(change==="intent-session")intent.session_id="worker";else intent.agent="different"
    save(intent)
  }
  if(change.startsWith("answer-")){
    const answer=f.store.delivery.load(String(f.store.delivery.load(id).data.answer_id))
    if(change==="answer-session")answer.session_id="worker";else answer.agent="different"
    save(answer)
  }
  if(change==="projection-assignment")f.db.query("UPDATE primary_deliveries SET assignment_id='different' WHERE intent_id=?").run(id)
  return request
}

for(const phase of ["preparing","send-started"])for(const change of malformedBindings)test(`malformed ${change} at ${phase} cannot authorize host I/O or receipt`,async()=>{
  const f=fixture(),b=boundary(),io:string[]=[]
  try {
    const id=fresh(f),claim=f.store.delivery.claim(id)!
    if(phase==="send-started")expect(f.store.delivery.start(id,claim.attempt_id)).toBe(true)
    const malformed=malformedBinding(f,id,change)
    b.host.get=async()=>{io.push("get");return {id:malformed.sessionID}}
    b.host.context=async()=>{io.push("context");return []}
    const sender=b.sender(f.store.delivery)
    expect((await sender.attempt(id,true)).eligibility).toBe("invalid")
    await sender.startup()
    expect(io).toEqual([]);expect(b.calls).toEqual([])
    expect(f.store.delivery.positive(id,"ACK",ack(malformed),{native_id:malformed.id})).toBe(false)
    f.store.delivery.observe({id:"event",type:"session.inbox.enqueued",durable:{seq:1},data:{sessionID:malformed.sessionID,inboxID:malformed.id,item:{type:"synthetic",delivery:malformed.delivery,payload:ack(malformed).payload}}})
    expect(f.store.delivery.status(id).receipt_id).toBeUndefined()
    expect(f.store.delivery.history(id,0,50).items.some(e=>e.data.phase==="admitted")).toBe(false)
    expect(f.db.query("SELECT COUNT(*) AS n FROM ledger WHERE kind IN ('answer','delivery-intent')").get()).toEqual({n:2})
  }finally{f.db.close()}
})

test("valid frozen binding survives reload and field ordering without rewriting its bytes or identity",async()=>{
  const f=fixture(),b=boundary()
  try {
    const id=fresh(f),bound=f.store.delivery.claim(id)!.binding.record
    const original=bound.data.native_request as any
    const reordered={...bound,data:{...bound.data,native_request:Object.fromEntries(Object.entries(original).reverse())}}
    f.db.query("UPDATE ledger SET data=? WHERE id=?").run(JSON.stringify(reordered),bound.id)
    const before=f.db.query("SELECT data FROM ledger WHERE id=?").get(bound.id)
    const reloaded=new Store(f.db,"scope")
    expect((await b.sender(reloaded.delivery).attempt(id,true)).transport).toBe("admitted")
    expect(b.calls).toEqual([original])
    expect(f.db.query("SELECT data FROM ledger WHERE id=?").get(bound.id)).toEqual(before)
    expect(f.store.delivery.history(id,0,50).items.filter(e=>e.data.phase==="bound")).toHaveLength(1)
  }finally{f.db.close()}
})

for(const stage of ["preflight","after-marker","reconcile-preflight"])test(`binding invalidated during ${stage} is rechecked before subsequent host I/O`,async()=>{
  const f=fixture(),b=boundary(),lookups:string[]=[],contexts:string[]=[]
  try {
    const id=fresh(f),claim=f.store.delivery.claim(id)!
    if(stage==="reconcile-preflight")f.store.delivery.start(id,claim.attempt_id)
    b.host.get=async({sessionID}:any)=>{lookups.push(sessionID);if(stage!=="after-marker")malformedBinding(f,id,"destination-worker");return {id:sessionID}}
    b.host.context=async({sessionID}:any)=>{contexts.push(sessionID);return []}
    if(stage==="after-marker"){
      const start=f.store.delivery.start.bind(f.store.delivery)
      f.store.delivery.start=(id,token)=>{const ok=start(id,token);if(ok)malformedBinding(f,id,"destination-worker");return ok}
    }
    const result=await b.sender(f.store.delivery).attempt(id,true)
    expect(result.eligibility).toBe("invalid")
    expect(lookups).toEqual(["primary"]);expect(contexts).toEqual([]);expect(b.calls).toEqual([])
  }finally{f.db.close()}
})

test("authorization is prospective, exact-primary and idempotent; historical intents stay false", () => {
  const f = fixture()
  try {
    const old = f.answer()
    expect(old.delivery.transport).toBe("not-attempted")
    expect(() => f.c.execute(f.worker, {operation:"authorize-continuation",assignment_id:"assignment",continuation:"primary-native/v1"})).toThrow("primary")
    const auth = f.authorize()
    expect(f.authorize().id).toBe(auth.id)
    const fresh = f.answer()
    const intents = f.c.coordinationRecords(f.primary,"deliveries").items
    expect(intents.find(i=>i.id===old.delivery.intent_id)?.data.automatic_continuation).toBe(false)
    expect(intents.find(i=>i.id===fresh.delivery.intent_id)?.data).toMatchObject({automatic_continuation:true,authorization_id:auth.id,sender_policy:"loom-primary-native-sender/v1"})
  } finally { f.db.close() }
})

test("database actually produced by accepted 3f08da9 reopens without historical consent or byte changes",async()=>{
  const root=mkdtempSync(join(tmpdir(),"loom-legacy-")),filename=join(root,"ledger.sqlite"),b=boundary()
  const hostIO:string[]=[]
  b.host.get=async()=>{hostIO.push("get");throw new Error("No historical Session lookup")}
  b.host.context=async()=>{hostIO.push("context");throw new Error("No historical Session context")}
  let db:Database|undefined
  try {
    // Check the frozen implementation before executing it; never substitute current Store.
    expect(historicalSource.commit).toBe("3f08da989c6c64aa94f797732201441119f88180")
    expect(historicalSource.files.map(file=>file.path)).toEqual(["store.ts","collaboration.ts","model.ts"])
    for(const file of historicalSource.files) {
      const bytes=readFileSync(new URL(`./fixtures/historical-3f08da9/${file.path}`,import.meta.url))
      expect(createHash("sha256").update(bytes).digest("hex")).toBe(file.sha256)
      expect(createHash("sha1").update(`blob ${bytes.length}\0`).update(bytes).digest("hex")).toBe(file.git_blob)
    }
    const {Store:Old}=await import("./fixtures/historical-3f08da9/store.js"),{workReference:oldRef}=await import("./fixtures/historical-3f08da9/collaboration.js")
    db=new Database(filename)
    const oldDB=db,old=new Old(oldDB),primary={session_id:"primary",agent:"primary"},worker={session_id:"worker",agent:"worker"}
    const a=old.create("Legacy","Stored only",primary),p=old.savePlan(a.id,0,[{id:"work",kind:"task",title:"Work"}]),ref=oldRef(a,p,"work")
    old.collaboration.assign(primary,{assignment_id:"assignment",worker_session_id:"worker",work_ref:ref})
    const q=old.collaboration.ask(worker,undefined,{assignment_id:"assignment",statement:"Question",respondent:"research"})
    const answer=old.collaboration.answer({session_id:"research",agent:"research"},{question_id:q.id,statement:"Legacy answer"})
    const intentID=answer.delivery.intent_id
    if(!intentID)throw new Error("Historical answer did not create a delivery intent")
    const intentSQL="SELECT data,CAST(data AS BLOB) AS bytes FROM ledger WHERE id=?"
    const before=oldDB.query<{data:string;bytes:Uint8Array},[string]>(intentSQL).get(intentID)
    if(!before)throw new Error("Historical delivery intent was not persisted")
    // These must be facts of the old writer, before current initialization runs.
    expect(oldDB.query("PRAGMA user_version").get()).toEqual({user_version:1})
    expect(oldDB.query("SELECT name FROM sqlite_schema WHERE type='table' ORDER BY name").all()).toEqual(
      ["action_versions","actions","focus","ledger","plans","sqlite_sequence"].map(name=>({name})))
    expect(oldDB.query<{name:string},[]>("PRAGMA table_info(ledger)").all().map(column=>column.name)).toEqual(
      ["seq","id","action_id","session_id","kind","data"])
    expect(JSON.parse(before.data)).toMatchObject({kind:"delivery-intent",data:{automatic_continuation:false,
      reason:"transport-not-implemented",transport:"not-attempted",state:"stored-for-session",
      assignment_id:"assignment",question_id:q.id,answer_id:answer.id,destination_session_id:"primary"}})
    expect(oldDB.query("SELECT count(*) AS n FROM ledger WHERE kind='continuation-authorization'").get()).toEqual({n:0})
    oldDB.close();db=new Database(filename)
    const store=new Store(db,"upgraded-scope")
    expect(store.delivery.status(intentID).eligibility).toBe("stored-only")
    store.collaboration.execute(primary,{operation:"authorize-continuation",assignment_id:"assignment",continuation:"primary-native/v1"})
    expect(db.query("SELECT count(*) AS n FROM ledger WHERE kind='continuation-authorization'").get()).toEqual({n:1})
    expect(store.delivery.startup()).toEqual([])
    await b.sender(store.delivery).startup()
    expect((await b.sender(store.delivery).attempt(intentID,true)).eligibility).toBe("stored-only")
    expect(db.query(intentSQL).get(intentID)).toEqual(before)
    expect(db.query("SELECT COUNT(*) AS n FROM primary_deliveries").get()).toEqual({n:0})
    expect(b.calls).toHaveLength(0)
    expect(hostIO).toEqual([])
  }finally{db?.close();rmSync(root,{recursive:true,force:true})}
})

for(const source of ["answer","delivery-intent","queue"])test(`authorized ${source} write refusal rolls back source, intent and startup index`,()=>{
  const f=fixture()
  try {
    f.authorize()
    f.db.exec(source==="queue"?"CREATE TRIGGER refuse_queue BEFORE INSERT ON primary_deliveries BEGIN SELECT RAISE(ABORT,'refused'); END":`CREATE TRIGGER refuse_source BEFORE INSERT ON ledger WHEN NEW.kind='${source}' BEGIN SELECT RAISE(ABORT,'refused'); END`)
    expect(()=>f.answer()).toThrow("refused")
    expect(f.c.thread(f.question.id).answers).toHaveLength(0)
    expect(f.c.coordinationRecords(f.primary,"deliveries").items).toHaveLength(0)
    expect(f.store.delivery.startup()).toEqual([])
  }finally{f.db.close()}
})

for(const action of ["abort","withdraw"])test(`live owner observes ${action} after marker and abstains before actual native call`,async()=>{
  const f=fixture(),b=boundary(),controller=new AbortController()
  try {
    const id=fresh(f),original=f.store.delivery.start.bind(f.store.delivery)
    f.store.delivery.start=(id,token)=>{const started=original(id,token);if(started){if(action==="abort")controller.abort();else withdraw(f)}return started}
    const result=await b.sender(f.store.delivery).attempt(id,false,controller.signal)
    expect(result.transport).toBe("admission-uncertain")
    expect(result.eligibility).toBe(action==="abort"?"eligible":"withdrawn")
    expect(b.calls).toHaveLength(0)
  }finally{f.db.close()}
})

test("late malformed ACK/error never downgrades matching enqueued receipt",async()=>{
  const f=fixture(),b=boundary()
  try {
    const id=fresh(f)
    b.host.synthetic=async(r:any)=>{b.calls.push(r);f.store.delivery.observe({id:"enqueued",type:"session.inbox.enqueued",durable:{seq:2},data:{sessionID:r.sessionID,inboxID:r.id,item:{type:"synthetic",payload:ack(r).payload,delivery:r.delivery}}});return {...ack(r),id:"wrong"}}
    expect((await b.sender(f.store.delivery).attempt(id)).transport).toBe("admitted")
    expect(f.store.delivery.history(id,0,50).items.some(e=>e.data.phase==="admission-uncertain")).toBe(true)
    expect(b.calls).toHaveLength(1)
  }finally{f.db.close()}
})

test("unknown bound renderer is visibly unsupported and never grants another native call",async()=>{
  const f=fixture(),b=boundary()
  try {
    const id=fresh(f),claim=f.store.delivery.claim(id)!,record=claim.binding.record
    record.data.renderer_version="future/v2"
    f.db.query("UPDATE ledger SET data=? WHERE id=?").run(JSON.stringify(record),record.id)
    expect(await b.sender(f.store.delivery).attempt(id,true)).toMatchObject({eligibility:"unsupported",reason:"unsupported-envelope-version"})
    expect(b.calls).toHaveLength(0)
  }finally{f.db.close()}
})

for(const phase of ["source","receipt"])test(`${phase} COMMIT failure rolls back its entire transaction, not the other outcome`,async()=>{
  const f=fixture(),b=boundary()
  try {
    f.authorize()
    let fail=false
    const sql={prepare:(s:string)=>f.db.prepare(s),exec:(s:string)=>{if(s==="COMMIT"&&fail){fail=false;throw new Error("injected commit failure")}return f.db.exec(s)}}
    const store=new Store(sql,"scope")
    if(phase==="source"){
      fail=true
      expect(()=>store.collaboration.answer({session_id:"research",agent:"research"},{question_id:f.question.id,statement:"Not committed"})).toThrow("commit failure")
      expect(f.c.thread(f.question.id).answers).toHaveLength(0)
      expect(f.store.delivery.startup()).toEqual([])
    }else{
      const id=f.answer().delivery.intent_id!
      b.host.synthetic=async(r:any)=>{b.calls.push(r);fail=true;return ack(r)}
      expect((await b.sender(store.delivery).attempt(id)).transport).toBe("admission-uncertain")
      expect(store.delivery.history(id,0,50).items.some(e=>e.data.phase==="admitted")).toBe(false)
      expect(f.c.thread(f.question.id).answers).toHaveLength(1)
      await b.sender(store.delivery).attempt(id,true);expect(b.calls).toHaveLength(1)
    }
  }finally{f.db.close()}
})

for(const field of ["id","sessionID","type","delivery","text","description","metadata"])test(`conflicting ACK ${field} remains uncertain without a new native ID or replay`,async()=>{
  const f=fixture(),b=boundary()
  try {
    const id=fresh(f)
    b.host.synthetic=async(r:any)=>{
      b.calls.push(r);const result:any=ack(r)
      if(["text","description","metadata"].includes(field))result.payload[field]=field==="metadata"?{source:"other"}:"different"
      else result[field]="different"
      return result
    }
    const sender=b.sender(f.store.delivery)
    expect((await sender.attempt(id)).transport).toBe("admission-uncertain")
    await sender.attempt(id,true);await sender.startup()
    expect(b.calls).toHaveLength(1)
  }finally{f.db.close()}
})

test("status/history share response reservations; unreadable evidence fails instead of inventing eligibility",()=>{
  const f=fixture()
  try {
    const id=fresh(f)
    for(let i=0;i<43;i++)f.store.append({...f.primary,kind:"delivery-event",data:{format:"loom-primary-delivery-event/v1",intent_id:id,phase:"preparing",diagnostic:"x".repeat(100000)}})
    expect(()=>f.c.coordinationRecords(f.primary,"deliveries",0,20,id,0,50)).toThrow("4 MiB")
    expect(f.c.coordinationRecords(f.primary,"deliveries",0,20,id,0,2).attempts?.items).toHaveLength(2)
    const auth=f.authorize();auth.data.extra="x".repeat(400000)
    f.db.query("UPDATE ledger SET data=? WHERE id=?").run(JSON.stringify(auth),auth.id)
    expect(()=>f.c.coordinationRecords(f.primary,"deliveries",0,20,id)).toThrow("limit")
    expect(f.db.query("SELECT COUNT(*) AS n FROM ledger WHERE kind='answer'").get()).toEqual({n:1})
  }finally{f.db.close()}
})

test("irreversible withdrawal before authorization/answer never retrofits consent",async()=>{
  const f=fixture(),b=boundary()
  try {
    const first=withdraw(f);expect(withdraw(f).id).toBe(first.id)
    expect(()=>f.authorize()).toThrow("withdrawn")
    const id=f.answer().delivery.intent_id!
    expect(await b.sender(f.store.delivery).attempt(id,true)).toMatchObject({eligibility:"withdrawn",transport:"not-attempted"})
    expect(b.calls).toHaveLength(0)
  }finally{f.db.close()}
})

for(const mutation of ["missing-true","missing-auth","missing-policy","unknown-policy","unknown-payload","unknown-auth","wrong-primary","wrong-ref","wrong-worker","late-auth","wrong-answer","wrong-question"])test(`inconsistent ${mutation} is unsendable`,async()=>{
  const f=fixture(),b=boundary()
  try {
    const id=fresh(f),intent=f.store.delivery.load(id),auth=f.authorize()
    if(mutation==="missing-true")delete intent.data.automatic_continuation
    if(mutation==="missing-auth")delete intent.data.authorization_id
    if(mutation==="missing-policy")delete intent.data.sender_policy
    if(mutation==="unknown-policy")intent.data.sender_policy="future/v2"
    if(mutation==="unknown-payload")(intent.data.payload as any).format="future/v2"
    if(mutation==="wrong-primary")intent.data.destination_session_id="foreign"
    if(mutation==="wrong-ref")(intent.data.payload as any).work_ref.hash="e".repeat(64)
    if(mutation==="wrong-worker")(intent.data.payload as any).worker_session_id="other"
    if(mutation==="wrong-answer")intent.data.answer_id=f.question.id
    if(mutation==="wrong-question")intent.data.question_id=id
    if(mutation==="unknown-auth") {auth.data.format="future/v2";f.db.prepare("UPDATE ledger SET data=? WHERE id=?").run(JSON.stringify(auth),auth.id)}
    if(mutation==="late-auth")f.db.prepare("UPDATE ledger SET seq=seq+10000 WHERE id=?").run(auth.id)
    f.db.prepare("UPDATE ledger SET data=? WHERE id=?").run(JSON.stringify(intent),id)
    expect((await b.sender(f.store.delivery).attempt(id,true)).eligibility).not.toBe("eligible")
    expect(b.calls).toHaveLength(0)
  }finally{f.db.close()}
})

for(const phase of ["bound","preparing","send-started","admitted"])test(`refused ${phase} preserves exchange; no unsafe replay`,async()=>{
  const f=fixture(),b=boundary()
  try {
    const id=fresh(f)
    f.db.exec(`CREATE TRIGGER refuse_phase BEFORE INSERT ON ledger WHEN NEW.kind='delivery-event' AND json_extract(NEW.data,'$.data.phase')='${phase}' BEGIN SELECT RAISE(ABORT,'phase refused'); END`)
    const sender=b.sender(f.store.delivery),status=await sender.attempt(id)
    expect(f.c.thread(f.question.id).answers).toHaveLength(1)
    expect(b.calls).toHaveLength(phase==="admitted"?1:0)
    expect(status.transport).toBe(phase==="admitted"?"admission-uncertain":phase==="send-started"?"preparing":"not-attempted")
    f.db.exec("DROP TRIGGER refuse_phase")
    await sender.attempt(id,true)
    expect(b.calls).toHaveLength(1) // after receipt failure this reconciles only, never repeats native I/O
    expect(f.c.thread(f.question.id).answers).toHaveLength(1)
  }finally{f.db.close()}
})

test("preflight failure is retryable without another answer; exact destination cannot be guessed",async()=>{
  const f=fixture(),b=boundary()
  try {
    const id=fresh(f),sender=b.sender(f.store.delivery)
    for(const fault of ["deleted","moved","foreign","wrong-id"]){
      b.host.get=async()=>{if(fault==="deleted")throw new Error("deleted");return {id:fault==="wrong-id"?"other":"primary"}}
      const s=new PrimarySender(f.store.delivery,b.host,async()=>fault==="wrong-id",undefined,()=>{})
      expect((await s.attempt(id,true)).transport).toBe("needs-attention")
      expect(b.calls).toHaveLength(0)
    }
    b.host.get=async({sessionID}:any)=>({id:sessionID})
    expect((await sender.attempt(id,true)).transport).toBe("admitted")
    expect(b.calls[0].sessionID).toBe("primary")
    expect(f.c.thread(f.question.id).answers).toHaveLength(1)
  }finally{f.db.close()}
})

test("two real connections compete during preflight; superseded PREPARING owner cannot call",async()=>{
  const root=mkdtempSync(join(tmpdir(),"loom-sender-")),f=fixture(join(root,"ledger.sqlite")),db2=new Database(join(root,"ledger.sqlite")),other=new Store(db2,"scope"),b=boundary()
  try {
    const id=fresh(f),release=Promise.withResolvers<void>(),entered=Promise.withResolvers<void>()
    b.host.get=async({sessionID}:any)=>{entered.resolve();await release.promise;return {id:sessionID}}
    const old=b.sender(f.store.delivery).attempt(id);await entered.promise
    // Ordinary contender must not take over an active claim.
    expect((await b.sender(other.delivery).attempt(id)).transport).toBe("preparing")
    const replacement=other.delivery.claim(id,true)!
    expect(replacement).toBeDefined();expect(other.delivery.start(id,replacement.attempt_id)).toBe(true)
    // Simulate replacement's public boundary once, not a second sender-owned attempt.
    b.calls.push(replacement.binding.request);other.delivery.positive(id,"ACK",ack(replacement.binding.request),{native_id:replacement.binding.request.id})
    release.resolve();await old
    expect(b.calls).toHaveLength(1)
    expect(f.store.delivery.status(id).transport).toBe("admitted")
    const history=f.store.delivery.history(id,0,50).items
    expect(history.filter(r=>r.data.phase==="preparing")).toHaveLength(2)
    expect(history.filter(r=>r.data.phase==="superseded")).toHaveLength(1)
    expect(history.filter(r=>r.data.phase==="send-started")).toHaveLength(1)
  }finally{db2.close();f.db.close();rmSync(root,{recursive:true,force:true})}
})

test("two plugin owners at actual send boundary make only one native call",async()=>{
  const root=mkdtempSync(join(tmpdir(),"loom-sender-")),f=fixture(join(root,"ledger.sqlite")),db2=new Database(join(root,"ledger.sqlite")),other=new Store(db2,"scope"),b=boundary()
  try {
    const id=fresh(f),release=Promise.withResolvers<void>(),entered=Promise.withResolvers<void>()
    b.host.synthetic=async(r:any)=>{b.calls.push(r);entered.resolve();await release.promise;return ack(r)}
    const first=b.sender(f.store.delivery).attempt(id);await entered.promise
    expect((await b.sender(other.delivery).attempt(id,true)).transport).toBe("admission-uncertain")
    release.resolve();await first
    expect(b.calls).toHaveLength(1)
    expect(other.delivery.status(id).transport).toBe("admitted")
  }finally{db2.close();f.db.close();rmSync(root,{recursive:true,force:true})}
})

for(const stage of ["before-claim","preparing","send-started"])test(`reopen after ${stage} preserves binding and conservative uncertainty`,async()=>{
  const root=mkdtempSync(join(tmpdir(),"loom-sender-")),filename=join(root,"ledger.sqlite"),f=fixture(filename),b=boundary()
  let reopened:Database|undefined
  try {
    const id=fresh(f),claim=stage==="before-claim"?undefined:f.store.delivery.claim(id)
    if(stage==="send-started")f.store.delivery.start(id,claim!.attempt_id)
    const before=claim?.binding.record
    f.db.close();reopened=new Database(filename)
    // A renderer upgrade must reuse frozen bytes, but cannot change the project
    // namespace: production derives that scope from the same saved host project.
    const store=new Store(reopened,"scope")
    await b.sender(store.delivery).startup();await b.sender(store.delivery).attempt(id,true)
    expect(b.calls).toHaveLength(stage==="send-started"?0:1)
    expect(store.delivery.status(id).transport).toBe(stage==="send-started"?"admission-uncertain":"admitted")
    if(before)expect(store.delivery.request(id)?.record).toEqual(before)
  }finally{reopened?.close();if(!reopened)f.db.close();rmSync(root,{recursive:true,force:true})}
})

for(const recovery of ["context","event","absent","compacted","read-error","wrong-payload"])test(`lost ACK: ${recovery} is positive-only, with no new synthetic`,async()=>{
  const f=fixture(),b=boundary()
  try {
    const id=fresh(f),sender=b.sender(f.store.delivery)
    b.host.synthetic=async(r:any)=>{
      b.calls.push(r)
      if(recovery==="context")b.context.push({id:r.id,type:"synthetic",text:r.text,description:r.description,metadata:r.metadata})
      if(recovery==="wrong-payload")b.context.push({id:r.id,type:"synthetic",text:"wrong",description:r.description,metadata:r.metadata})
      if(recovery==="event")f.store.delivery.observe({id:"event-1",type:"session.inbox.enqueued",durable:{seq:20},data:{sessionID:r.sessionID,inboxID:r.id,item:{type:"synthetic",delivery:r.delivery,payload:ack(r).payload}}})
      throw new Error("ACK lost after admission")
    }
    if(recovery==="read-error")b.host.context=async()=>{throw new Error("unavailable")}
    await sender.attempt(id);await sender.startup();const result=await sender.attempt(id,true)
    expect(result.transport).toBe(["context","event"].includes(recovery)?"admitted":"admission-uncertain")
    expect(b.calls).toHaveLength(1)
  }finally{f.db.close()}
})

for(const stage of ["pending","preparing","preflight","send-started","during-call","before-receipt","after-receipt"])test(`withdrawal at ${stage} retains history and truthful transport`,async()=>{
  const f=fixture(),b=boundary()
  try {
    const id=fresh(f),sender=b.sender(f.store.delivery)
    if(stage==="pending")withdraw(f)
    if(stage==="preparing"){f.store.delivery.claim(id);withdraw(f)}
    if(stage==="preflight")b.host.get=async({sessionID}:any)=>{withdraw(f);return {id:sessionID}}
    if(stage==="send-started"){const claim=f.store.delivery.claim(id)!;f.store.delivery.start(id,claim.attempt_id);expect(withdraw(f).delivery_disposition.possibly_admitted).toBe(1)}
    if(stage==="during-call" || stage==="before-receipt")b.host.synthetic=async(r:any)=>{b.calls.push(r);expect(withdraw(f).delivery_disposition.possibly_admitted).toBe(1);if(stage==="during-call")throw new Error("uncertain");return ack(r)}
    await sender.attempt(id,true)
    if(stage==="after-receipt")expect(withdraw(f).delivery_disposition.admitted).toBe(1)
    await sender.startup();const status=await sender.attempt(id,true)
    expect(status.eligibility).toBe("withdrawn")
    expect(b.calls).toHaveLength(["during-call","before-receipt","after-receipt"].includes(stage)?1:0)
    expect(status.transport).toBe(["before-receipt","after-receipt"].includes(stage)?"admitted":["send-started","during-call"].includes(stage)?"admission-uncertain":"not-attempted")
    expect(f.c.thread(f.question.id).answers).toHaveLength(1)
  }finally{f.db.close()}
})

test("abort after marker is uncertain, not withdrawal; native cancellation suppresses without inventing a receipt",async()=>{
  const f=fixture(),b=boundary()
  try {
    const id=fresh(f),claim=f.store.delivery.claim(id)!,controller=new AbortController()
    f.store.delivery.start(id,claim.attempt_id);controller.abort()
    await b.sender(f.store.delivery).attempt(id,true,controller.signal)
    expect(f.store.delivery.status(id).eligibility).toBe("eligible")
    f.store.delivery.observe({id:"cancel",type:"session.inbox.cancelled",durable:{seq:1},data:{sessionID:"primary",inboxID:claim.binding.request.id}})
    expect(await b.sender(f.store.delivery).attempt(id,true)).toMatchObject({eligibility:"native-cancelled",transport:"admission-uncertain"})
    expect(b.calls).toHaveLength(0)
  }finally{f.db.close()}
})

test("startup uses indexed distinct 10+10 transferable slots, never scans false history or loops",async()=>{
  const f=fixture(),b=boundary()
  try {
    for(let i=0;i<60;i++)f.answer()
    f.authorize()
    const ids=Array.from({length:45},()=>f.answer().delivery.intent_id!)
    for(const id of ids.slice(0,15)){const claim=f.store.delivery.claim(id)!;f.store.delivery.start(id,claim.attempt_id)}
    expect(f.store.delivery.startup()).toHaveLength(20)
    expect(new Set(f.store.delivery.startup()).size).toBe(20)
    let reads=0;b.host.context=async()=>{reads++;return []}
    await b.sender(f.store.delivery).startup()
    expect(b.calls).toHaveLength(10);expect(reads).toBe(10)
    expect(f.db.query("EXPLAIN QUERY PLAN SELECT intent_id FROM primary_deliveries WHERE bucket='pending' ORDER BY intent_seq LIMIT 20").all().some((r:any)=>r.detail.includes("primary_delivery_bucket"))).toBe(true)
    expect(f.db.query("SELECT COUNT(*) AS n FROM primary_deliveries").get()).toEqual({n:45})
  }finally{f.db.close()}
})

test("registered production tools expose exact operations, saved/send separation and bounded attempt history",async()=>{
  const f=await registeredLoom()
  try {
    f.sessions.set("worker",{id:"worker",parentID:"primary",projectID:"tool-help",location:{directory:f.directory}})
    const action=(await f.invoke("action",{operation:"create",title:"Sender",goal:"Qualify"},"primary")).result
    await f.invoke("plan",{operation:"save",action_id:action.id,expected_revision:0,nodes:[{id:"work",kind:"task",title:"Work"}]},"primary")
    const ref=(await f.invoke("context",{action_id:action.id,node_id:"work"},"worker")).result.work_ref
    await f.invoke("record",{operation:"assign",assignment_id:"assignment",worker_session_id:"worker",work_ref:ref},"primary")
    await f.invoke("record",{operation:"authorize-continuation",assignment_id:"assignment",continuation:"primary-native/v1"},"primary")
    const q=(await f.invoke("record",{operation:"ask",assignment_id:"assignment",statement:"Qualified?",respondent:"research"},"worker")).result
    const a=(await f.invoke("record",{operation:"answer",question_id:q.id,statement:"Only in this case"},"research")).result
    expect(a.id).toBeDefined();expect(a.delivery.transport).toBe("admitted")
    const id=a.delivery.intent_id
    const retry=(await f.invoke("record",{operation:"retry-delivery",delivery_id:id},"primary")).result
    expect(retry.answer_id).toBe(a.id);expect(retry.delivery_status.transport).toBe("admitted")
    await expect(f.invoke("record",{operation:"retry-delivery",delivery_id:id},"worker")).rejects.toThrow("primary")
    const read=(await f.invoke("record",{operation:"query",view:"deliveries",delivery_id:id,attempt_limit:2},"primary")).result
    expect(read.attempts.items).toHaveLength(2);expect(read.attempts.next_after).toBeNumber()
    await expect(f.invoke("record",{operation:"query",view:"deliveries",attempt_after:0},"primary")).rejects.toThrow("exact")
    expect(f.tools.size).toBe(5)
  }finally{await f.close()}
})

test("production sender binds exact immutable input once; retries never recreate the answer or wake a receipt", async () => {
  const f = fixture(), calls: any[] = []
  try {
    f.authorize(); const answer = f.answer(), id = answer.delivery.intent_id!
    const state = new DeliveryState(f.store,f.db,"scope")
    const host = {get:async({sessionID}:any)=>({id:sessionID}), context:async()=>[], synthetic:async(request:any)=>{
      calls.push(request);return {id:request.id,sessionID:request.sessionID,type:"synthetic",delivery:request.delivery,payload:{text:request.text,description:request.description,metadata:request.metadata}}
    }}
    const sender = new PrimarySender(state,host as any,async()=>true)
    expect((await sender.attempt(id)).transport).toBe("admitted")
    expect((await sender.attempt(id,true)).transport).toBe("admitted")
    expect(calls).toHaveLength(1)
    expect(calls[0]).toMatchObject({sessionID:"primary",resume:true,delivery:"steer",description:"Loom answer available"})
    expect(calls[0].text).not.toContain("Only under these conditions.")
    expect(f.c.thread(f.question.id).answers).toHaveLength(1)
  } finally { f.db.close() }
})
