import { test, expect } from "bun:test"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createHash } from "node:crypto"
import { Database } from "bun:sqlite"
import { digest } from "../src/model.js"
import { registeredLoom } from "./helpers/registered-loom.js"

const config = (capture: "automatic" | "off") => async (directory: string) =>
  writeFile(join(directory, ".loom.yaml"),
    "agents: {}\ninstructions: {enabled: false}\nledger: {capture: " + capture + "}\n")

type Host = Awaited<ReturnType<typeof registeredLoom>>
async function objectiveWithCorrection(host: Host, n: number) {
  const request = (await host.invoke("record", { operation: "add", session_only: true,
    kind: "result", statement: "Original goal " + n + ": private source text stays in ledger only" })).result
  const objective = (await host.invoke("objective", {
    operation: "create", label: "Independent supported goal " + n,
    source_type: "ledger-record", source_id: request.id,
  })).result
  const read = (await host.invoke("objective", {
    operation: "read", objective_id: objective.id,
  })).result
  const related_sequence = read.entries[0].sequence
  const failure = (await host.invoke("record", { operation: "add", session_only: true,
    kind: "result", statement: "Runtime failed for goal " + n })).result
  await host.invoke("objective", { operation: "link",
    objective_id: objective.id, source_type: "ledger-record",
    source_id: failure.id, phase: "verification", assessment: "fail" })
  const rework = (await host.invoke("record", { operation: "add", session_only: true,
    kind: "result", statement: "Correction for original goal " + n })).result
  await host.invoke("objective", { operation: "link",
    objective_id: objective.id, source_type: "ledger-record",
    source_id: rework.id, phase: "corrective-dispatch", related_sequence })
  const passed = (await host.invoke("record", { operation: "add", session_only: true,
    kind: "result", statement: "Confirmed pass for goal " + n })).result
  await host.invoke("objective", { operation: "link",
    objective_id: objective.id, source_type: "ledger-record",
    source_id: passed.id, phase: "verification", assessment: "pass" })
  const outcome = (await host.invoke("record", { operation: "add", session_only: true,
    kind: "result", statement: "Reported final outcome for goal " + n })).result
  const result = (await host.invoke("objective", { operation: "link",
    objective_id: objective.id, source_type: "ledger-record",
    source_id: outcome.id, phase: "outcome", assessment: "pass" })).result
  return { objective, result }
}

test("historical findings stay read-only across outcomes, restart and capture-off", async () => {
  const directory = await mkdtemp(join(tmpdir(), "loom-historical-findings-"))
  let host: Host | undefined
  try {
    host = await registeredLoom([], { directory, versionedHost: true,
      beforeSetup: config("automatic") })
    const objectiveIDs: string[] = []
    for (let i = 1; i <= 3; i++) {
      const observed = await objectiveWithCorrection(host, i)
      objectiveIDs.push(observed.objective.id)
      expect(observed.result.new_learning_findings).toBeUndefined()
    }
    const at=new Date(Date.now()+1000).toISOString()
    const trends=(await host.invoke("trends", {operation:"compare",population:"all-linked",
      since_at:new Date(Date.now()-86400000).toISOString(),
      until_at:at,as_of_at:at,limit:20})).result
    expect(trends.metrics.with_documented_correction).toBe(3)
    expect(trends.population.origin_independence.status).toBe("unqualified")
    expect((await host.invoke("insights", {operation:"findings"})).result.items).toEqual([])

    // Simulate previously persisted observation-only findings from an earlier
    // installation. Retrieval must preserve both positive and corrective claims
    // without certifying them or generating replacements.
    const root=join(directory,"state","loom","actions-v1",
      digest({project:"tool-help",canonical:directory}))
    const learning=new Database(join(root,"learning.sqlite"))
    try {
      const insert=learning.prepare(`INSERT INTO learning_findings
        (signature,kind,group_key,created_at,since_at,until_at,population,
          matching_objectives,source_refs,interpretation,next_action,uncertainty)
        VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`)
      for(let i=0;i<2;i++) {
        const signature=createHash("sha256").update("historical hypothesis "+i).digest("hex")
        insert.run(signature,i === 0 ? "recurring-correction" : "retained-practice","historical-unqualified",
          new Date(Date.now()+i).toISOString(),new Date(Date.now()-86400000).toISOString(),
          at,3,3,JSON.stringify([{objective_id:objectiveIDs[i]!,
            source_type:"ledger-record",source_id:"historical-test-record"}]),
          "Historical hypotheses are not independence certification",
          "Re-audit original Sessions before action","Authored and not certified")
      }
    } finally { learning.close() }

    const first=(await host.invoke("insights", {operation:"findings"})).result
    expect(first.items).toHaveLength(2)
    expect(first.items.map((item: any) => item.kind).sort())
      .toEqual(["recurring-correction", "retained-practice"])
    expect(first.independent_pattern_qualification.status).toBe("unqualified")
    await host.close();host=undefined

    host=await registeredLoom([], {directory,versionedHost:true,
      beforeSetup:config("automatic")})
    const restored=(await host.invoke("insights", {operation:"findings"})).result
    expect(restored.items.map((x:any)=>x.signature)).toEqual(first.items.map((x:any)=>x.signature))
    const next=await objectiveWithCorrection(host,4)
    expect(next.result.new_learning_findings).toBeUndefined()
    const paged=(await host.invoke("insights",{operation:"findings",limit:1})).result
    expect(paged.items).toHaveLength(1)
    expect(paged.next_cursor).not.toBeNull()
    // A backdated concurrent append would enter page two without the rowid
    // high-water bound. A newest-first append would not test that protection.
    const appended = new Database(join(root,"learning.sqlite"))
    try {
      appended.prepare(`INSERT INTO learning_findings
        SELECT ?,kind,group_key,?,since_at,until_at,population,
          matching_objectives,source_refs,interpretation,next_action,uncertainty
        FROM learning_findings LIMIT 1`).run(
          createHash("sha256").update("concurrent historical import").digest("hex"),
          new Date(Date.now()-3600000).toISOString())
    } finally { appended.close() }
    const page2=(await host.invoke("insights",{operation:"findings",limit:1,
      finding_cursor:paged.next_cursor})).result
    expect(page2.items).toHaveLength(1)
    expect(page2.next_cursor).toBeNull()
    expect(page2.snapshot_max_rowid).toBe(paged.snapshot_max_rowid)
    expect([paged.items[0].signature,page2.items[0].signature])
      .toEqual(first.items.map((item: any) => item.signature))
    expect((await host.invoke("insights",{operation:"findings"})).result.items).toHaveLength(3)
    await expect(host.invoke("insights",{operation:"findings",
      finding_cursor:"not-a-real-cursor"})).rejects.toThrow("Invalid findings cursor")
    await host.close();host=undefined

    host=await registeredLoom([], {directory,versionedHost:true,
      beforeSetup:config("off")})
    for(let i=5;i<=7;i++) {
      const item=await objectiveWithCorrection(host,i)
      expect(item.result.new_learning_findings).toBeUndefined()
    }
    const final=(await host.invoke("insights",{operation:"findings"})).result
    expect(final.items).toHaveLength(3)
    await expect(host.invoke("insights",{operation:"findings",limit:21}))
      .rejects.toThrow("Findings limit")
    host.sessions.set("foreign", { id:"foreign", projectID:"another-project",
      location:{directory} })
    await expect(host.invoke("insights",{operation:"findings"},"foreign"))
      .rejects.toThrow("does not own")
    await expect(host.invoke("tweak",{operation:"live-start"}))
      .rejects.toThrow("Unknown tweak operation")

    // A malformed archived finding makes its explicit read fail. No reader or
    // analysis is invoked by the ordinary objective outcome path.
    const damaged = new Database(join(root,"learning.sqlite"))
    try { damaged.exec("UPDATE learning_findings SET source_refs='invalid-json'") }
    finally { damaged.close() }
    await expect(host.invoke("insights",{operation:"findings"})).rejects.toThrow()
    const ordinary = await objectiveWithCorrection(host,8)
    expect(ordinary.result.new_learning_findings).toBeUndefined()
    expect((await host.invoke("objective",{operation:"read",objective_id:ordinary.objective.id}))
      .result.entries.some((entry: any) => entry.phase === "outcome")).toBe(true)
  } finally {
    await host?.close()
    await rm(directory,{recursive:true,force:true})
  }
})
