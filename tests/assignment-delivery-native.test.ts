import { test, expect } from "bun:test"
import { Database } from "bun:sqlite"
import { readdir } from "node:fs/promises"
import { join } from "node:path"
import { registeredLoom } from "./helpers/registered-loom.js"
import { TOOL_HELP, TOOL_EXAMPLES } from "../src/tool-help.js"

async function fixture() {
  const f = await registeredLoom()
  try {
    f.sessions.set("worker", { id: "worker", parentID: "primary", projectID: "tool-help", location: { directory: f.directory } })
    const action = (await f.invoke("action", {operation:"create",title:"Guide",goal:"Qualified guide"}, "primary")).result
    await f.invoke("plan", {operation:"save",action_id:action.id,expected_revision:0,nodes:[{id:"work",kind:"task",title:"Work"}]},"primary")
    const ref = (await f.invoke("context", {action_id:action.id,node_id:"work"},"worker")).result.work_ref
    const input = {operation:"assign",assignment_id:"assignment",worker_session_id:"worker",work_ref:ref}
    const root = join(f.directory,"state/loom/actions-v1"), db = new Database(join(root,(await readdir(root))[0],"ledger.sqlite"))
    return {...f, action, ref, input, db, close: async()=>{db.close();await f.close()}}
  } catch(error) {await f.close();throw error}
}

test("registered assignment and atomic answer/intents work without valid selection or any native sending API",async()=>{
  const f = await fixture()
  try {
    const association = (await f.invoke("record",f.input,"primary")).result
    expect(association.data.primary_session_id).toBe("primary")
    expect(association.data.worker_session_id).toBe("worker")
    f.db.prepare("UPDATE focus SET data='{broken' WHERE session_id=?").run("worker")
    f.db.prepare("UPDATE focus SET data='{broken' WHERE session_id=?").run("primary")
    const q = (await f.invoke("record",{operation:"ask",assignment_id:"assignment",respondent:"investigator",statement:"Question"},"worker")).result
    // No lookup of a saved destination is needed to preserve the answer.
    f.sessions.set("primary", new Error("Destination offline"))
    const a = (await f.invoke("record",{operation:"answer",question_id:q.id,statement:"Only in this case."},"research","investigator")).result
    expect(a.delivery.state).toBe("stored-for-session");expect(a.delivery.transport).toBe("not-attempted")
    f.sessions.delete("primary")
    const page = (await f.invoke("record",{operation:"query",view:"deliveries"},"primary")).result
    expect(page.items).toHaveLength(1);expect(page.items[0].id).toBe(a.delivery.intent_id)
    expect(page.items[0].data.payload.work_ref).toEqual(f.ref)
    expect((await f.invoke("record",{operation:"query",view:"assignments"},"worker")).result.items[0].id).toBe(association.id)
    expect(f.tools.size).toBe(5)
    expect(f.db.prepare("SELECT data FROM focus WHERE session_id='primary'").get()).toEqual({data:"{broken"})
  } finally {await f.close()}
})
for (const fault of ["parent","project","location","identity","missing"]) test(`registered assignment rejects wrong ${fault} before saving`,async()=>{
  const f = await fixture()
  try {
    const child = {...f.sessions.get("worker")}
    if(fault==="parent")child.parentID="other-primary"
    if(fault==="project")child.projectID="other-project"
    if(fault==="location")child.location={directory:f.directory,workspaceID:"other-workspace"}
    if(fault==="identity")child.id="other-worker"
    f.sessions.set("worker",fault==="missing"?new Error("Missing child"):child)
    await expect(f.invoke("record",f.input,"primary")).rejects.toThrow()
    expect(f.db.prepare("SELECT COUNT(*) AS n FROM ledger WHERE kind='assignment'").get()).toEqual({n:0})
  } finally {await f.close()}
})
test("registered assign binds the existing question and does not allow another Session to report for that Worker",async()=>{
  const f = await fixture()
  try {
    const q = (await f.invoke("record",{operation:"ask",statement:"Before registration",respondent:"investigator"},"worker")).result
    await f.invoke("record",{...f.input,question_id:q.id},"primary")
    const a = (await f.invoke("record",{operation:"answer",question_id:q.id,statement:"Qualified response"},"research")).result
    expect(a.delivery.destination_session_id).toBe("primary")
    await expect(f.invoke("record",{operation:"ask",assignment_id:"assignment",statement:"Impersonation",respondent:"research"},"other")).rejects.toThrow("assigned Worker")
    const report = (await f.invoke("record",{operation:"complete",assignment_id:"assignment",work_ref:f.ref,statement:"Done"},"worker")).result
    expect(report.data.assignment_id).toBe("assignment")
    expect((await f.invoke("record",{operation:"query",view:"deliveries"},"primary")).result.items).toHaveLength(1) // completion never nudges
  } finally {await f.close()}
})
test("registered answer reports no successful save when intent persistence fails",async()=>{
  const f = await fixture()
  try {
    await f.invoke("record",f.input,"primary")
    const q = (await f.invoke("record",{operation:"ask",assignment_id:"assignment",statement:"Question",respondent:"research"},"worker")).result
    f.db.exec("CREATE TRIGGER refuse_intent BEFORE INSERT ON ledger WHEN NEW.kind='delivery-intent' BEGIN SELECT RAISE(ABORT,'intent refused'); END")
    await expect(f.invoke("record",{operation:"answer",question_id:q.id,statement:"Not saved"},"research")).rejects.toThrow("intent refused")
    expect((await f.invoke("record",{operation:"query",view:"thread",question_id:q.id},"research")).result.answers).toHaveLength(0)
    expect((await f.invoke("record",{operation:"query",view:"deliveries"},"primary")).result.items).toHaveLength(0)
  } finally {await f.close()}
})
test("new search-visible example inputs execute and advertise stored-only delivery accurately",async()=>{
  const f = await fixture()
  try {
    const tool = f.tools.get("record")
    expect(tool.description).toBe(TOOL_HELP.record)
    for(const phrase of ["assign:","query view=assignments","view=deliveries","original reference without selection","not-attempted","commit together","do not repeat answer","native child"])expect(tool.description).toContain(phrase)
    for(const key of ["assignment_id","worker_session_id","delivery_id"])expect(tool.input.properties[key]).toBeDefined()
    const association = {...TOOL_EXAMPLES.record[11],assignment_id:"guide-worker-1",worker_session_id:"worker",work_ref:f.ref}
    const q = (await f.invoke("record",{operation:"ask",statement:"Before return",respondent:"research"},"worker")).result
    await f.invoke("record",{...association,question_id:q.id},"primary")
    const second = (await f.invoke("record",TOOL_EXAMPLES.record[12],"worker")).result
    await f.invoke("record",{operation:"answer",question_id:second.id,statement:"Qualified"},"research")
    expect((await f.invoke("record",TOOL_EXAMPLES.record[13],"primary")).result.items).toHaveLength(1)
    expect((await f.invoke("record",TOOL_EXAMPLES.record[14],"worker")).result.items).toHaveLength(1)
  } finally {await f.close()}
})

test("cancellation during child lookup prevents an assignment write",async()=>{
  const f=await fixture(), controller=new AbortController()
  try {
    f.sessions.set("worker", {id:"worker",projectID:"tool-help",location:{directory:f.directory},get parentID(){controller.abort();return "primary"}})
    await expect(f.tools.get("record").execute(f.input,{sessionID:"primary",agent:"author",messageID:"m",id:"call",signal:controller.signal})).rejects.toThrow()
    expect(f.db.prepare("SELECT COUNT(*) AS n FROM ledger WHERE kind='assignment'").get()).toEqual({n:0})
  } finally {await f.close()}
})
