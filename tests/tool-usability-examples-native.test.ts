import { expect, test } from "bun:test"
import { loomSkill } from "../src/skill.js"
import { TOOL_EXAMPLES, TOOL_HELP } from "../src/tool-help.js"
import { registeredLoom } from "./helpers/registered-loom.js"

const example = <T extends { operation: string }>(items: readonly T[], operation: string) => {
  const input = items.find(input => input.operation === operation)
  if (!input) throw new Error("Published example missing: " + operation)
  return input
}
const substitute = (input: unknown, values: Record<string, string>) => JSON.parse(JSON.stringify(input, (_key, value) =>
  typeof value === "string" && Object.hasOwn(values, value) ? values[value] : value))

test("published retrospective examples discover actual IDs and freeze/inspect without an Action Plan or source inspection", async () => {
  const f = await registeredLoom()
  const call = async (name: string, input: unknown, session = "s") => (await f.invoke(name, input, session)).result
  try {
    // Static historical prerequisites use the same public write operations.
    // This fixture authorizes new retrospective associations and the reviewed
    // selection only; it is not real user consent or an Evaluator execution.
    const action = await call("action", TOOL_EXAMPLES.action[0])
    const failure = await call("record", { operation: "add", action_id: action.id, kind: "concern",
      statement: "Controlled fixture timeout; no live incident or external verification." })
    const correction = await call("record", { operation: "add", action_id: action.id, kind: "result",
      statement: "Controlled correction for the cited concern; authored outcome only." })
    const values: Record<string, string> = { ACTION_ID: action.id, RECORD_ID: failure.id, GOAL_KEY: "controlled-goal" }
    const discoveryInput = TOOL_EXAMPLES.history.find(input => input.operation === "read" && "match" in input)!
    const discovered = await call("history", substitute(discoveryInput, values))
    expect(discovered.records).toHaveLength(1)
    const original = await call("record", discovered.records[0].source.query)
    expect(original.items[0]).toMatchObject(failure)

    // Exercise the exact inline find/preview examples shipped in the guide.
    const { content } = await loomSkill()
    const findInput = JSON.parse(content.match(/`(\{"operation":"find",[^`]+\})`/)![1]!)
    const previewInput = JSON.parse(content.match(/`(\{"operation":"preview-population",[^`]+\})`/)![1]!)
    const missing = await call("objective", substitute(findInput, values))
    expect(missing.items).toEqual([])
    // Missing authored objective does not prevent reading the original.
    expect((await call("record", discovered.records[0].source.query)).items[0].id).toBe(failure.id)

    const objective = await call("objective", substitute(example(TOOL_EXAMPLES.objective, "create"), values))
    expect(objective.id).toBeString()
    expect(objective.existing).toBe(false)
    values.OBJECTIVE_ID = objective.id
    const found = await call("objective", substitute(findInput, values))
    expect(found.items.map((item: { id: string }) => item.id)).toEqual([objective.id])
    const linkExample = TOOL_EXAMPLES.objective.find(input => input.operation === "link" && input.phase === "coordination")!
    await call("objective", substitute(linkExample, { ...values, RECORD_ID: correction.id }))
    const connected = await call("history", { operation: "read", objective_id: found.items[0].id, record_id: failure.id, related: true })
    expect(connected.records.some((record: any) => record.source.record_id === correction.id)).toBe(true)

    const preview = await call("history", { ...substitute(previewInput, values), limit: 2 })
    expect(preview.state).toBe("preview")
    expect(preview.population_id).toBeNull()
    expect(preview.execution_permit).toBeNull()
    const selected: any[] = [...preview.items]
    for (let next = preview.navigation.next; next;) {
      const page = await call("history", next)
      expect(page.freeze).toEqual(preview.freeze)
      expect(page.manifest_sha256).toBe(preview.manifest_sha256)
      selected.push(...page.items)
      next = page.navigation.next
    }
    expect(selected).toHaveLength(preview.member_count)
    expect(selected.filter(member => member.source.kind === "ledger-record").map(member => member.source.id).sort())
      .toEqual([failure.id, correction.id].sort())

    // The fixture's approval is applied only after the exact membership is
    // inspected. The public request is copied, not rebuilt from partial pins.
    const frozen = await call("review", preview.freeze)
    expect(frozen.state).toBe("frozen")
    expect(frozen.manifest_sha256).toBe(preview.manifest_sha256)
    expect(frozen.execution_permit).toBeNull()
    const member = frozen.items.find((item: any) => item.source.id === failure.id && item.source.kind === "ledger-record")
    expect(member).toBeDefined()
    const inspected = await call("history", member.inspect)
    expect(inspected.status).toBe("available")
    expect(inspected.value).toEqual(failure)
    // Ledger-only populations can be read across Sessions with authority.
    // Permission denial, rather than Session inequality, is the boundary here.
    expect((await call("history", member.inspect, "different-requester")).value).toEqual(failure)
    f.permission.error = new Error("Controlled source access denial")
    await expect(call("history", member.inspect)).rejects.toThrow("Controlled source access denial")
    f.permission.error = undefined
    expect((await call("plan", { operation: "read", action_id: action.id })).revision).toBe(0)
    expect(f.sessionCreates).toEqual([])
    expect(f.sessionPrompts).toEqual([])
    expect(f.nativeInputs).toEqual([])
  } finally { await f.close() }
})

test("progressive guidance keeps operation intent and placeholder provenance within existing budgets", async () => {
  const { content } = await loomSkill()
  expect(content.length).toBeLessThanOrEqual(12000)
  // Existing per-tool ceilings still apply. This aggregate ceiling prevents
  // moving prose between descriptions from silently growing the whole surface.
  expect(Object.values(TOOL_HELP).reduce((total, value) => total + value.length, 0)).toBeLessThanOrEqual(44000)
  for (const help of Object.values(TOOL_HELP)) expect(help).toContain("placeholders")
  expect(TOOL_HELP.objective).toContain("find is not a text search")
  expect(TOOL_HELP.objective).toContain("create: result.id")
  expect(TOOL_HELP.history).toContain("Always supply operation")
  expect(TOOL_HELP.history).toContain("Omit boundaries initially")
  expect(TOOL_HELP.history).toContain("History boundary versions are not preview versions")
  expect(content).toContain("Do not copy history pins")
  expect(TOOL_HELP.review).toContain("No approval Boolean or execution operation")
  expect(content).toContain("performance.now()")
  expect(content).toContain("Date.now()")
  expect(content).toContain("do not claim token savings from bytes")
})
