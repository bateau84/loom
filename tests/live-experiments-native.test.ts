import { test, expect } from "bun:test"
import { createHash } from "node:crypto"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Database } from "bun:sqlite"
import { digest } from "../src/model.js"
import { registeredLoom } from "./helpers/registered-loom.js"
import { LIVE_ENTRY_KEY, SessionExperiments } from "../src/live-experiments.js"

const sha = (s: string) => createHash("sha256").update(s).digest("hex")
const baseline = "You are the normal native author agent."
const candidateText = "Experimental additive instruction: cite the actual executable verification."
// Approval binds the exact expiry; never recompute the digest across calls.
const sharedExpiry = new Date(Date.now() + 360000).toISOString()
const expires = () => sharedExpiry
const startInput = (objective_id: string, candidate_id: string, overrides: Record<string,unknown> = {}) => ({
  operation: "start", objective_id, candidate_id, authorize: true,
  authorization_ref: "human-request-id-1",
  eligibility: "Exact native author Session for original objective, with unsupported tool and skill delivery excluded",
  evaluation_criteria: "Report independent runtime correctness, corrections and counterexamples",
  preserved_guarantees: "No registry edits, no paid fallback, native permission required and independent reviews unchanged",
  budget_requests: 2, expires_at: expires(), ...overrides,
})
type Host = Awaited<ReturnType<typeof registeredLoom>>
async function prepare(host: Host, sessionID = "parent", agent = "author") {
  const native = host.nativeAgents.find(a => a.id === agent)
  if (!native) host.nativeAgents.push({ id: agent, mode: "primary", hidden: false, system: baseline })
  else native.system = baseline
  host.sessions.set(sessionID, {
    id: sessionID, agent, projectID: "tool-help", location: { directory: host.directory },
  })
  host.nativeContexts.set(sessionID, { data: [{
    id: "req-" + sessionID, type: "user", text: "Do the explicit, bounded engineering work",
    time: { created: Date.now() },
  }] })
  const obj = (await host.invoke("objective", {
    operation: "create", source_type: "native-message", source_id: "req-" + sessionID,
    label: "One real engineering goal",
  }, sessionID, agent)).result
  const proposal = (await host.invoke("tweak", {
    operation: "propose", target_kind: "agent", target_id: agent,
    base_sha256: sha(baseline), candidate_content: candidateText,
    hypothesis: "Reduce repeated runtime corrections for a comparable objective",
    evidence_refs: ["source:prior-objectives"],
  }, sessionID, agent)).result
  const current = host.nativeContexts.get(sessionID) as { data: Array<Record<string,unknown>> }
  const learningDB=new Database(join(host.directory, "state", "loom", "actions-v1",
    digest({ project:"tool-help",canonical:host.directory }), "learning.sqlite"))
  let approvalLine: string
  try {
    approvalLine=new SessionExperiments(learningDB).approvalBinding(
      {session_id:sessionID,agent},startInput(obj.id,proposal.id)).approval_line
  } finally { learningDB.close() }
  current.data.push({ id: "human-request-id-1", type:"user",
    text:approvalLine, time: { created: Date.now() } })
  return { obj, proposal }
}
const call = (host: Host, operation: string, fields: Record<string, unknown> = {}, sessionID = "parent", agent = "author") =>
  host.invoke("tweak", { ...fields, operation: "live-" + operation }, sessionID, agent)

test("an explicitly authorized objective-linked candidate is assigned to only its native Session; assignment is not exposure", async () => {
  const host = await registeredLoom([], { versionedHost: true, approvalProof:"synthetic" })
  try {
    const { obj, proposal } = await prepare(host)
    host.sessions.set("control", { id: "control", agent: "author", projectID: "tool-help", location: { directory: host.directory } })
    const assigned = (await call(host, "start", startInput(obj.id, proposal.id))).result
    expect(assigned.status).toBe("assigned")
    expect(assigned.exposure).toBe("NOT_VERIFIED")
    expect(assigned.provider_receipt).toBeNull()
    expect(host.instructionEntries.get("parent")?.get(LIVE_ENTRY_KEY)).toBe(candidateText)
    expect(host.instructionEntries.get("control")?.has(LIVE_ENTRY_KEY)).not.toBe(true)
    expect(host.nativeInstructionWrites).toHaveLength(1)
    expect(host.permissionRequests.some((p: any) => p.action === "loom-live-instruction-experiment")).toBe(true)
    const stored = (await call(host, "read")).result
    expect(stored.objective_id).toBe(obj.id)
    expect(stored.candidate_sha256).toBe(sha(candidateText))
    expect(stored.observed_provider_receipts).toBe(0)
    expect(stored.exposure_verification).toContain("pre-provider")
    expect(stored.events.some((e: any) => e.kind === "native-entry-readback")).toBe(true)
    const unassigned = (await call(host, "read", {}, "control")).result
    expect(unassigned.status).toBe("inactive")
    await expect(call(host,"start",startInput(obj.id,proposal.id))).rejects.toThrow("SESSION_USED")
  } finally { await host.close() }
})

test("native context and request hooks record only pre-provider evidence; budget and unqualified routes fail closed", async () => {
  const host = await registeredLoom([], { versionedHost: true, approvalProof:"synthetic" })
  try {
    const { obj, proposal } = await prepare(host)
    await call(host, "start", startInput(obj.id, proposal.id))
    await expect(host.hooks.get("execute.before")({
      sessionID: "parent",agent: "author",tool: "read",input:{path:"AGENTS.md"},id:"tool1",
    })).rejects.toThrow("TOOL_ROUTE_UNQUALIFIED")
    await expect(host.hooks.get("execute.before")({
      sessionID: "parent",agent: "author",tool: "skill",input:{id:"software-engineering"},id:"tool2",
    })).rejects.toThrow("TOOL_ROUTE_UNQUALIFIED")
    await expect(host.hooks.get("execute.before")({
      sessionID: "parent",agent: "author",tool: "execute",
      input:{code:'return await tools.loom.tweak({"operation":"live-stop"}); await tools.shell({command:"echo unsafe"})'},id:"tool3",
    })).rejects.toThrow("TOOL_ROUTE_UNQUALIFIED")
    await host.hooks.get("execute.before")({
      sessionID: "parent",agent: "author",tool: "execute",
      input:{code:'return await tools.loom.tweak({"operation":"live-read"})'},id:"tool4",
    })
    const context = { sessionID: "parent", agent: "author",
      system: [{ type:"text", text: `<context key="${LIVE_ENTRY_KEY}">\n${candidateText}\n</context>` }],
      messages: [], tools: {}, options: {} }
    await host.hooks.get("context")(context)
    // The exact 2.2.6 host can render native entries after this early hook.
    // Missing here must remain an explicitly unverified stage, not abort a
    // request whose final provider input is tested by installed acceptance.
    await host.hooks.get("context")({ ...context, system: [] })
    const staged = (await call(host, "read")).result
    expect(staged.events.some((e: any) => e.kind === "context-stage-unobserved")).toBe(true)
    expect(staged.observed_provider_receipts).toBe(0)
    const native = { sessionID: "parent", agent: "author", kind: "primary",
      model: { providerID: "fixture", id: "scripted" } }
    await host.hooks.get("model.request")(native)
    expect((await call(host, "read")).result.preflight_count).toBe(1)
    expect((await call(host, "read")).result.context_count).toBe(1)
    expect((await call(host, "read")).result.observed_provider_receipts).toBe(0)
    await expect(host.hooks.get("model.request")({...native,kind:"compaction"})).rejects.toThrow("ROUTE_UNQUALIFIED")
    await host.hooks.get("model.request")(native)
    await expect(host.hooks.get("model.request")(native)).rejects.toThrow("BUDGET_EXHAUSTED")
    const stopped = (await call(host, "stop")).result
    expect(stopped.status).toBe("stopped")
    expect(stopped.control_eligible).toBe(false)
    expect(host.instructionEntries.get("parent")?.has(LIVE_ENTRY_KEY)).not.toBe(true)
    await expect(call(host,"start",startInput(obj.id,proposal.id))).rejects.toThrow("SESSION_USED")
  } finally { await host.close() }
})

test("source drift, native denial and inherited/unknown objective never write instruction entries", async () => {
  const host = await registeredLoom([], { versionedHost: true, approvalProof:"synthetic" })
  try {
    const { obj, proposal } = await prepare(host)
    const control = "child"
    host.sessions.set(control, { id: control, agent: "author", parentID: "parent",
      projectID: "tool-help", location: { directory: host.directory } })
    // A second, independent native user approval is still not a source-linked
    // objective. No implicit child inheritance of authorization or treatment.
    host.nativeContexts.set(control,{data:[{
      id:"human-request-id-1",type:"user",
      text:`LOOM-TRIAL-APPROVE candidate=${proposal.id} objective=${obj.id} budget=2`,
      time:{created:Date.now()},
    }]})
    await expect(call(host,"start",startInput(obj.id,proposal.id),control)).rejects.toThrow("OBJECTIVE_UNBOUND")
    await expect(call(host,"start",startInput(obj.id,proposal.id,{authorize:false}))).rejects.toThrow("NOT_AUTHORIZED")
    host.permission.error = new Error("Native user denied")
    await expect(call(host,"start",startInput(obj.id,proposal.id))).rejects.toThrow("Native user denied")
    host.permission.error = undefined
    expect(host.nativeInstructionWrites).toHaveLength(0)
    host.nativeAgents.find(a => a.id === "author")!.system = "Changed canonical native source"
    await expect(call(host,"start",startInput(obj.id,proposal.id))).rejects.toThrow("SOURCE_DRIFT")
    expect(host.nativeInstructionWrites).toHaveLength(0)
  } finally { await host.close() }
})

test("a stopped or crashed trial retains history across plugin restart and cannot become a clean control", async () => {
  const directory = await mkdtemp(join(tmpdir(), "loom-live-restart-"))
  try {
    let h = await registeredLoom([], { directory, versionedHost: true, approvalProof:"synthetic" })
    const { obj, proposal } = await prepare(h)
    await call(h,"start",startInput(obj.id,proposal.id))
    // Partial admission is durable even if the plugin unloads before the request.
    h.instructionEntries.get("parent")!.set(LIVE_ENTRY_KEY, candidateText)
    await h.close()
    h = await registeredLoom([], { directory, versionedHost: true, approvalProof:"synthetic" })
    try {
      await prepare(h)
      // Native entry storage is owned by OpenCode, not the Loom database.
      // Rehydrate the fixture's native entry as an actual restarted host would.
      h.instructionEntries.set("parent",new Map([[LIVE_ENTRY_KEY,candidateText]]))
      const previous = (await call(h,"read")).result
      expect(previous.status).toBe("assigned")
      expect(previous.events.length).toBeGreaterThanOrEqual(2)
      const stopped = (await call(h,"stop")).result
      expect(stopped.status).toBe("stopped")
      expect(stopped.control_eligible).toBe(false)
      expect(stopped.events.some((e:any)=>e.kind === "native-entry-removed")).toBe(true)
    } finally { await h.close() }
  } finally { await rm(directory,{recursive:true,force:true}) }
})

test("orphaned native instruction entry cannot run after learning history is lost", async () => {
  const host = await registeredLoom([], { versionedHost: true, approvalProof:"synthetic" })
  try {
    host.sessions.set("orphan", {
      id: "orphan", agent: "author", projectID: "tool-help",
      location: { directory: host.directory },
    })
    host.instructionEntries.set("orphan", new Map([[LIVE_ENTRY_KEY, candidateText]]))
    await expect(host.hooks.get("model.request")({
      sessionID: "orphan", agent: "author", kind: "primary",
      model: { providerID: "fixture", id: "scripted" },
    })).rejects.toThrow("LOOM_LIVE_ORPHAN_ENTRY")
    expect(host.instructionEntries.get("orphan")?.has(LIVE_ENTRY_KEY)).toBe(true)
  } finally { await host.close() }
})

test("unqualified host version cannot activate a native entry or reserve an experiment", async () => {
  const host = await registeredLoom()
  try {
    const { obj, proposal } = await prepare(host)
    await expect(call(host, "start", startInput(obj.id, proposal.id))).rejects.toThrow("HOST_UNQUALIFIED")
    expect(host.nativeInstructionWrites).toHaveLength(0)
    expect((await call(host, "read")).result.status).toBe("inactive")
  } finally { await host.close() }
})

test("active native source drift blocks request before transport and preserves explicit withdrawal", async () => {
  const host = await registeredLoom([], { versionedHost: true, approvalProof:"synthetic" })
  try {
    const { obj, proposal } = await prepare(host)
    await call(host, "start", startInput(obj.id, proposal.id))
    host.nativeAgents.find(a => a.id === "author")!.system = "Changed native agent system after enrollment."
    await expect(host.hooks.get("model.request")({
      sessionID: "parent", agent: "author", kind: "primary",
      model: { providerID: "fixture", id: "scripted" },
    })).rejects.toThrow("SOURCE_DRIFT")
    expect((await call(host, "read")).result.preflight_count).toBe(0)
    expect(host.instructionEntries.get("parent")?.get(LIVE_ENTRY_KEY)).toBe(candidateText)
    const stopped = (await call(host, "stop")).result
    expect(stopped.status).toBe("stopped")
    expect(stopped.control_eligible).toBe(false)
    expect(host.instructionEntries.get("parent")?.has(LIVE_ENTRY_KEY)).not.toBe(true)
  } finally { await host.close() }
})

test("audit saturation remains bounded, records omissions and never traps explicit withdrawal", async () => {
  const h = await registeredLoom([], { versionedHost: true, approvalProof:"synthetic" })
  try {
    const { obj, proposal } = await prepare(h)
    await call(h, "start", startInput(obj.id, proposal.id))
    const context = { sessionID: "parent", agent: "author",
      system: [{ type: "text",
        text: `<context key="${LIVE_ENTRY_KEY}">\n${candidateText}\n</context>` }],
      messages: [], tools: {}, options: {} }
    for (let i = 0; i < 70; i++) await h.hooks.get("context")(context)
    const full = (await call(h, "read")).result
    expect(full.omitted_event_count).toBeGreaterThan(0)
    expect(full.audit_history_complete).toBe(false)
    expect(full.note).toContain("history is incomplete")
    const stopped = (await call(h, "stop")).result
    expect(stopped.status).toBe("stopped")
    expect(stopped.omitted_event_count).toBeGreaterThan(full.omitted_event_count)
    expect(stopped.control_eligible).toBe(false)
    expect(h.instructionEntries.get("parent")?.has(LIVE_ENTRY_KEY)).not.toBe(true)
    const persisted = new Database(join(h.directory, "state", "loom", "actions-v1",
      digest({ project: "tool-help", canonical: h.directory }), "learning.sqlite"))
    try {
      expect((persisted.query("SELECT COUNT(*) AS n FROM learning_live_events").get() as {n:number}).n).toBe(64)
    } finally { persisted.close() }
  } finally { await h.close() }
})

test("a repeated stop does not claim success after its previously withdrawn entry reappears", async () => {
  const h = await registeredLoom([], { versionedHost: true, approvalProof:"synthetic" })
  try {
    const { obj, proposal } = await prepare(h)
    await call(h, "start", startInput(obj.id, proposal.id))
    await call(h, "stop")
    h.instructionEntries.get("parent")!.set(LIVE_ENTRY_KEY, candidateText)
    await expect(call(h, "stop")).rejects.toThrow("WITHDRAWAL_UNCERTAIN")
    await expect(h.hooks.get("model.request")({
      sessionID: "parent", agent: "author", kind: "primary",
      model: { providerID: "fixture", id: "scripted" },
    })).rejects.toThrow("WITHDRAWAL_UNCERTAIN")
  } finally { await h.close() }
})

test("retiring an active candidate is denied until a verified withdrawal", async () => {
  const h = await registeredLoom([], { versionedHost: true, approvalProof:"synthetic" })
  try {
    const {obj,proposal} = await prepare(h)
    await call(h,"start",startInput(obj.id,proposal.id))
    await expect(h.invoke("tweak",{operation:"retire",id:proposal.id},"parent","author"))
      .rejects.toThrow("LOOM_LIVE_ACTIVE")
    await call(h,"stop")
    const retired = (await h.invoke("tweak",{operation:"retire",id:proposal.id},"parent","author")).result
    expect(retired.status).toBe("retired")
  } finally { await h.close() }
})

test("agent-authored user-role approval and native auto-allow do not prove direct human approval", async () => {
  const h=await registeredLoom([], {versionedHost:true,approvalProof:"missing"})
  try {
    const {obj,proposal}=await prepare(h)
    const source=(h.nativeContexts.get("parent") as {data:Array<{type:string;text:string}>}).data
    expect(source.some(x=>x.type==="user" && x.text.startsWith("LOOM-TRIAL-APPROVE"))).toBe(true)
    await expect(call(h,"start",startInput(obj.id,proposal.id)))
      .rejects.toThrow("LOOM_LIVE_HUMAN_PROVENANCE_UNQUALIFIED")
    expect(h.nativeInstructionWrites).toHaveLength(0)
    expect(h.permissionRequests).toHaveLength(0)
    expect((await call(h,"read")).result.status).toBe("inactive")
  } finally { await h.close() }
})

test("trusted approval denial blocks candidate write even if user-role text exactly matches", async () => {
  const h=await registeredLoom([], {versionedHost:true,approvalProof:"denied"})
  try {
    const {obj,proposal}=await prepare(h)
    await expect(call(h,"start",startInput(obj.id,proposal.id)))
      .rejects.toThrow("LOOM_LIVE_HUMAN_PROVENANCE_UNQUALIFIED")
    expect(h.nativeInstructionWrites).toHaveLength(0)
    expect(h.permissionRequests).toHaveLength(0)
  } finally {await h.close()}
})

test("approval digest binds candidate content, objective, Session and budget", async () => {
  const h=await registeredLoom([], {versionedHost:true,approvalProof:"synthetic"})
  try {
    const {obj,proposal}=await prepare(h)
    const db=new Database(join(h.directory,"state","loom","actions-v1",
      digest({project:"tool-help",canonical:h.directory}),"learning.sqlite"))
    try {
      const e=new SessionExperiments(db)
      const approved=e.approvalBinding({session_id:"parent",agent:"author"},startInput(obj.id,proposal.id))
      expect(approved.approval_line).toContain("sha256="+sha(candidateText))
      expect(approved.approval_line).toContain("session=parent")
      expect(e.approvalBinding({session_id:"parent",agent:"author"},startInput(obj.id,proposal.id,{budget_requests:3})).approval_sha256)
        .not.toBe(approved.approval_sha256)
      expect(e.approvalBinding({session_id:"some-other-session",agent:"author"},startInput(obj.id,proposal.id)).approval_sha256)
        .not.toBe(approved.approval_sha256)
    } finally {db.close()}
    await expect(call(h,"start",startInput(obj.id,proposal.id,{budget_requests:3})))
      .rejects.toThrow("LOOM_LIVE_NOT_AUTHORIZED")
    expect(h.nativeInstructionWrites).toHaveLength(0)
  } finally {await h.close()}
})

test("orchestrator-authored task message in native child user role cannot enroll without provenance", async () => {
  const h=await registeredLoom([], {versionedHost:true,approvalProof:"missing"})
  try {
    const {proposal}=await prepare(h)
    h.sessions.set("child",{id:"child",parentID:"parent",agent:"author",
      projectID:"tool-help",location:{directory:h.directory}})
    h.nativeContexts.set("child",{data:[{id:"req-child",type:"user",
      text:"Task: implement a correction",time:{created:Date.now()}}]})
    const obj=(await h.invoke("objective",{
      operation:"create",source_type:"native-message",source_id:"req-child",
      label:"Child local objective",
    },"child","author")).result
    const db=new Database(join(h.directory,"state","loom","actions-v1",
      digest({project:"tool-help",canonical:h.directory}),"learning.sqlite"))
    let line:string
    try {line=new SessionExperiments(db).approvalBinding(
      {session_id:"child",agent:"author"},startInput(obj.id,proposal.id)).approval_line
    } finally {db.close()}
    ;(h.nativeContexts.get("child") as {data:any[]}).data.push({
      id:"human-request-id-1",type:"user",text:line,time:{created:Date.now()},
    })
    await expect(call(h,"start",startInput(obj.id,proposal.id),"child","author"))
      .rejects.toThrow("LOOM_LIVE_HUMAN_PROVENANCE_UNQUALIFIED")
    expect(h.nativeInstructionWrites).toHaveLength(0)
    expect((await call(h,"read",{},"child","author")).result.status).toBe("inactive")
  } finally {await h.close()}
})

test("stop during asynchronous native install never claims clean withdrawal; later reconciliation removes entry", async () => {
  const h=await registeredLoom([], {versionedHost:true,approvalProof:"synthetic"})
  let release!:()=>void, entered!:()=>void
  const blocked=new Promise<void>(resolve=>release=resolve)
  const started=new Promise<void>(resolve=>entered=resolve)
  try {
    const {obj,proposal}=await prepare(h)
    h.instructionControl.beforePut=async()=>{entered();await blocked}
    const pending=call(h,"start",startInput(obj.id,proposal.id))
    await started
    await expect(call(h,"stop")).rejects.toThrow("LOOM_LIVE_INFLIGHT_ASSIGNMENT")
    expect((await call(h,"read")).result.status).toBe("stop-uncertain")
    await expect(h.hooks.get("model.request")({
      sessionID:"parent",agent:"author",kind:"primary",
      model:{providerID:"fixture",id:"scripted"},
    })).rejects.toThrow("LOOM_LIVE_WITHDRAWAL_UNCERTAIN")
    release()
    await expect(pending).rejects.toThrow("LOOM_LIVE_ASSIGNMENT_RACE")
    expect((await call(h,"read")).result.status).toBe("recovery-required")
    expect(h.instructionEntries.get("parent")?.get(LIVE_ENTRY_KEY)).toBe(candidateText)
    const stopped=(await call(h,"stop")).result
    expect(stopped.status).toBe("stopped")
    expect(stopped.control_eligible).toBe(false)
    expect(h.instructionEntries.get("parent")?.has(LIVE_ENTRY_KEY)).not.toBe(true)
  } finally {release?.();await h.close()}
})

test("two concurrent starts for one Session reserve at most one trial and one native entry", async () => {
  const h=await registeredLoom([], {versionedHost:true,approvalProof:"synthetic"})
  try {
    const {obj,proposal}=await prepare(h)
    let waiting=0, release!:()=>void, both!:()=>void
    const barrier=new Promise<void>(resolve=>release=resolve)
    const reached=new Promise<void>(resolve=>both=resolve)
    h.permission.beforeReturn=async()=>{
      waiting++
      if(waiting===2)both()
      await barrier
    }
    const first=call(h,"start",startInput(obj.id,proposal.id))
    const second=call(h,"start",startInput(obj.id,proposal.id))
    await reached
    release()
    const settled=await Promise.allSettled([first,second])
    expect(settled.filter(x=>x.status==="fulfilled")).toHaveLength(1)
    expect(settled.filter(x=>x.status==="rejected")).toHaveLength(1)
    expect(String((settled.find(x=>x.status==="rejected") as PromiseRejectedResult).reason))
      .toContain("LOOM_LIVE_SESSION_USED")
    expect(h.nativeInstructionWrites).toHaveLength(1)
    await call(h,"stop")
  } finally {await h.close()}
})
