import { test, expect } from "bun:test"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
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

test("proactive corrections require three whole objectives, not three Coder handbacks, and deduplicate across restart", async () => {
  const directory = await mkdtemp(join(tmpdir(), "loom-proactive-findings-"))
  let host: Host | undefined
  try {
    host = await registeredLoom([], { directory, versionedHost: true,
      beforeSetup: config("automatic") })
    const sources = []
    for (let i = 1; i <= 3; i++) {
      const observed = await objectiveWithCorrection(host, i)
      sources.push(observed.objective.id)
      if (i < 3) expect(observed.result.new_learning_findings).toBeUndefined()
      else {
        expect(observed.result.new_learning_findings).toHaveLength(1)
        expect(observed.result.new_learning_findings[0].kind).toBe("recurring-correction")
        expect(observed.result.new_learning_findings[0].matching_objectives).toBe(3)
      }
    }
    const first = (await host.invoke("insights", { operation: "findings" })).result
    expect(first.items).toHaveLength(1)
    expect(first.items[0].source_refs.map((x: any) => x.objective_id)).toEqual(sources)
    expect(first.items[0].interpretation).toContain("not three independent failures")
    expect(first.items[0].uncertainty).toContain("Correlation")
    expect(JSON.stringify(first)).not.toContain("private source text stays in ledger only")
    const fourth = await objectiveWithCorrection(host, 4)
    expect(fourth.result.new_learning_findings).toBeUndefined()
    expect((await host.invoke("insights", { operation: "findings" })).result.items).toHaveLength(1)
    await host.close(); host = undefined

    host = await registeredLoom([], { directory, versionedHost: true,
      beforeSetup: config("automatic") })
    const persisted = (await host.invoke("insights", { operation: "findings" })).result
    expect(persisted.items).toHaveLength(1)
    expect(persisted.items[0].signature).toBe(first.items[0].signature)
    const fifth = await objectiveWithCorrection(host, 5)
    expect(fifth.result.new_learning_findings).toBeUndefined()
    const sixth = await objectiveWithCorrection(host, 6)
    expect(sixth.result.new_learning_findings).toHaveLength(1)
    expect((await host.invoke("insights", { operation: "findings" })).result.items).toHaveLength(2)
    await host.close(); host = undefined

    // Disabling ordinary capture suppresses all automatic findings even for
    // explicitly authored outcomes. Existing sources remain manually readable.
    host = await registeredLoom([], { directory, versionedHost: true,
      beforeSetup: config("off") })
    for (let i = 7; i <= 9; i++) {
      const outcome = await objectiveWithCorrection(host, i)
      expect(outcome.result.new_learning_findings).toBeUndefined()
    }
    expect((await host.invoke("insights", { operation: "findings" })).result.items).toHaveLength(2)
    await expect(host.invoke("insights", { operation: "findings", limit: 21 }))
      .rejects.toThrow("Findings limit")
  } finally {
    await host?.close()
    await rm(directory, { recursive: true, force: true })
  }
})
