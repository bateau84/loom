import { test, expect } from "bun:test"
import { createHash } from "node:crypto"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { registeredLoom } from "./helpers/registered-loom.js"
import { LIVE_ENTRY_KEY } from "../src/live-experiments.js"

const sha = (s: string) => createHash("sha256").update(s).digest("hex")
const baseline = "You are the normal native author agent."
const candidateText = "Experimental additive instruction: cite the actual executable verification."
const expires = () => new Date(Date.now() + 180000).toISOString()
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
  current.data.push({ id: "human-request-id-1", type:"user",
    text: `LOOM-TRIAL-APPROVE candidate=${proposal.id} objective=${obj.id} budget=2`,
    time: { created: Date.now() } })
  return { obj, proposal }
}
const call = (host: Host, operation: string, fields: Record<string, unknown> = {}, sessionID = "parent", agent = "author") =>
  host.invoke("tweak", { ...fields, operation: "live-" + operation }, sessionID, agent)

test("an explicitly authorized objective-linked candidate is assigned to only its native Session; assignment is not exposure", async () => {
  const host = await registeredLoom([], { versionedHost: true })
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
  const host = await registeredLoom([], { versionedHost: true })
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
  const host = await registeredLoom([], { versionedHost: true })
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
    let h = await registeredLoom([], { directory, versionedHost: true })
    const { obj, proposal } = await prepare(h)
    await call(h,"start",startInput(obj.id,proposal.id))
    // Partial admission is durable even if the plugin unloads before the request.
    h.instructionEntries.get("parent")!.set(LIVE_ENTRY_KEY, candidateText)
    await h.close()
    h = await registeredLoom([], { directory, versionedHost: true })
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

test("retiring an active candidate is denied until a verified withdrawal", async () => {
  const h = await registeredLoom([], { versionedHost: true })
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
