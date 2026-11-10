import { test, expect } from "bun:test"
import { registeredLoom } from "./helpers/registered-loom.js"

const hour = 60 * 60 * 1000
const message = (id: string, at: number) => ({
  id, type: "user", text: "Fixture request; no private transcript retention",
  time: { created: at },
})

test("trend windows count whole objectives, not attempts or ledger pages, and freeze population and observations", async () => {
  const host = await registeredLoom()
  try {
    const start = Date.now() - 72 * hour
    const messages: any[] = []
    host.nativeContexts.set("parent", { data: messages })
    const objectiveIDs: string[] = []
    for (let n = 0; n < 26; n++) {
      messages.push(message("request-" + n, start + n * 1000))
      const created = (await host.invoke("objective", {
        operation: "create", source_type: "native-message", source_id: "request-" + n,
        label: "Independent goal " + n, unit_key: n % 2 ? "feature" : "repair",
      }, "parent")).result
      objectiveIDs.push(created.id)
    }
    const action = (await host.invoke("action", {
      operation: "create", title: "Runtime verification", goal: "Check real requested outcomes",
    }, "parent")).result
    const qa = async (verdict: "pass" | "fail", label: string) =>
      (await host.invoke("record", {
        operation: "add", kind: "qa", action_id: action.id, verdict, statement: label,
      }, "parent")).result
    const link = async (objective_id: string, phase: string, record: any, assessment: string, related_sequence?: number) =>
      (await host.invoke("objective", { operation: "link", objective_id, phase,
        source_type: "ledger-record", source_id: record.id, assessment,
        ...(related_sequence ? { related_sequence } : {}),
      }, "parent")).result

    const fail = await qa("fail", "First delivered runtime check failed")
    const failed = await link(objectiveIDs[0]!, "verification", fail, "fail")
    const corrective = await host.invoke("objective", { operation: "link", objective_id: objectiveIDs[0],
      phase: "corrective-dispatch", source_type: "external-ref",
      source_id: "https://github.com/bateau84/loom/pull/217", related_sequence: failed.sequence,
      note: "Explicit correction after runtime check; not an inferred tool error",
    }, "parent")
    expect(corrective.result.phase).toBe("corrective-dispatch")
    const passed = await qa("pass", "Eventual runtime scenario passed")
    await link(objectiveIDs[0]!, "verification", passed, "pass")
    await link(objectiveIDs[0]!, "outcome", passed, "pass")
    await link(objectiveIDs[1]!, "verification", fail, "fail") // shared incident evidence, not two independent incidents
    await link(objectiveIDs[1]!, "outcome", fail, "fail")
    await link(objectiveIDs[2]!, "outcome", passed, "pass")
    const continuation = await host.invoke("objective", { operation: "link",
      objective_id: objectiveIDs[0], phase: "continuation", source_type: "external-ref",
      source_id: "https://github.com/bateau84/loom/issues/1", related_sequence: 1,
    }, "parent")
    const duplicate = await host.invoke("objective", { operation: "link",
      objective_id: objectiveIDs[0], phase: "continuation", source_type: "external-ref",
      source_id: "https://github.com/bateau84/loom/issues/1", related_sequence: 1,
    }, "parent")
    expect(duplicate.result.sequence).toBe(continuation.result.sequence)

    const query = { operation: "compare", population: "all-linked", since_at: new Date(start - hour).toISOString(),
      until_at: new Date(start + hour).toISOString(), as_of_at: new Date(Date.now() + hour).toISOString(),
      group_by: "unit-key", limit: 7 }
    const first = (await host.invoke("trends", query)).result
    expect(first.population.eligible_objectives).toBe(26)
    expect(first.metrics.reported_pass).toBe(2)
    expect(first.metrics.reported_fail).toBe(1)
    expect(first.metrics.unknown_or_incomplete).toBe(23)
    expect(first.metrics.with_documented_correction).toBe(1)
    expect(first.metrics.reported_recovery).toBe(1)
    expect(first.metrics.verification_failures).toBe(2)
    expect(first.correlation.shared_failure_sources).toBe(1)
    expect(first.correlation.affected_objectives).toBe(2)
    expect(first.groups.map((g: any) => [g.key, g.metrics.eligible_objectives]))
      .toEqual([["feature", 13], ["repair", 13]])
    expect(first.next_cursor).toBeTruthy()
    expect(first.items).toHaveLength(7)

    // New rows inside the original source-time window and a newly filed failed check
    // must not change this selected population or its earlier observation cutoff.
    messages.push(message("request-later", start + 27000))
    await host.invoke("objective", { operation: "create", source_type: "native-message",
      source_id: "request-later", label: "Later indexed objective" }, "parent")
    const later = await qa("fail", "Appended after comparison snapshot")
    await link(objectiveIDs[0]!, "verification", later, "fail")

    const seen: string[] = first.items.map((x: any) => x.objective_id)
    let cursor = first.next_cursor
    while (cursor) {
      const page = (await host.invoke("trends", { ...query, cursor })).result
      expect(page.population.eligible_objectives).toBe(26)
      expect(page.metrics.verification_failures).toBe(2)
      seen.push(...page.items.map((x: any) => x.objective_id))
      cursor = page.next_cursor
    }
    expect(seen).toHaveLength(26)
    expect(new Set(seen).size).toBe(26)
    expect(new Set(seen)).toEqual(new Set(objectiveIDs))
    const updated = (await host.invoke("trends", query)).result
    expect(updated.population.eligible_objectives).toBe(27)
    expect(updated.metrics.verification_failures).toBe(3)
    expect(first.items.find((x: any) => x.objective_id === objectiveIDs[0])
      .evidence.verification_fails.total).toBe(1)
    expect(updated.items.find((x: any) => x.objective_id === objectiveIDs[0])
      .evidence.verification_fails.total).toBe(2)
  } finally { await host.close() }
})

test("known and unknown evidence, reporting cutoff, absent dimensions and selected population stay explicit", async () => {
  const host = await registeredLoom()
  try {
    const start = Date.now() - 24 * hour
    const messages: any[] = [message("root-a", start), message("root-b", start + 1000)]
    host.nativeContexts.set("parent", { data: messages })
    const a = (await host.invoke("objective", {
      operation: "create", source_type: "native-message", source_id: "root-a", label: "A",
    }, "parent")).result
    const b = (await host.invoke("objective", {
      operation: "create", source_type: "native-message", source_id: "root-b", label: "B",
    }, "parent")).result
    await host.invoke("objective", { operation: "create",
      source_type: "external-ref", source_id: "https://github.com/bateau84/loom/pull/222",
      label: "Cannot locate start from declared source",
    }, "parent")
    const action = (await host.invoke("action", {
      operation: "create", title: "Checks", goal: "Capture explicit outcomes",
    }, "parent")).result
    const record = (await host.invoke("record", { operation: "add", kind: "qa",
      action_id: action.id, statement: "Author reported a failed check", verdict: "fail",
    }, "parent")).result
    await host.invoke("objective", { operation: "link", objective_id: a.id,
      phase: "verification", source_type: "ledger-record", source_id: record.id, assessment: "fail",
    }, "parent")
    const scope = { operation: "compare", population: "selected", objective_ids: [a.id, b.id],
      since_at: new Date(start - hour).toISOString(), until_at: new Date(start + hour).toISOString(),
      as_of_at: new Date(Date.now() + hour).toISOString(), group_by: "model" }
    const data = (await host.invoke("trends", scope)).result
    expect(data.population.eligible_objectives).toBe(2)
    expect(data.metrics.unknown_or_incomplete).toBe(2)
    expect(data.metrics.verification_failures).toBe(1)
    expect(data.metrics.reported_fail).toBe(0) // verification is not final outcome
    expect(data.groups).toHaveLength(1)
    expect(data.groups[0].key).toBe("unavailable")
    expect(data.unavailable_dimensions.model).toBeTruthy()
    expect(data.unavailable_dimensions.provider).toBeTruthy()
    expect(data.unavailable_dimensions.work_type).toBeTruthy()
    expect(data.unavailable_dimensions.actual_instruction_exposure).toBeTruthy()
    expect(data.items.find((x: any) => x.objective_id === a.id).evidence.verification_fails.total).toBe(1)
    expect(data.items.find((x: any) => x.objective_id === a.id).outcome).toBe("unknown")
    expect(data.items.every((x: any) => x.original_sources_readable_via === "loom_objective read")).toBe(true)
    await expect(host.invoke("trends", { ...scope, until_at: scope.since_at }))
      .rejects.toThrow()
    await expect(host.invoke("trends", { ...scope, cursor: "not-a-cursor" })).rejects.toThrow()
    const tooOld = { ...scope, as_of_at: new Date(start + 2 * hour).toISOString() }
    expect((await host.invoke("trends", tooOld)).result.population.eligible_objectives).toBe(0)
  } finally { await host.close() }
})
