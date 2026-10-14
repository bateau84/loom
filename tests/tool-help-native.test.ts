import { test, expect } from "bun:test"
import { TOOL_HELP, TOOL_EXAMPLES, LOOM_NAMESPACE_HELP, type LoomToolName } from "../src/tool-help.js"
import { registeredLoom } from "./helpers/registered-loom.js"

for (const name of Object.keys(TOOL_HELP) as LoomToolName[]) test(`registered ${name} tool carries complete search help without role injection`, async () => {
  const fixture = await registeredLoom()
  try {
    expect([...fixture.tools.keys()].sort()).toEqual(["action", "agents", "context", "plan", "record"])
    expect(fixture.namespaces.get("loom").description).toBe(LOOM_NAMESPACE_HELP)
    const tool = fixture.tools.get(name)
    expect(tool.description).toBe(TOOL_HELP[name])
    expect(tool.options).toEqual({ namespace: "loom", codemode: true })
    expect(tool.description.split("\n")[0].length).toBeLessThanOrEqual(120)
    expect(tool.description.length).toBeLessThanOrEqual(3600)
    for (const section of ["Usage:", "Returns:", "Caution:", "Examples (JSON inputs"]) expect(tool.description).toContain(section)
    expect(tool.description).not.toContain("docs/tools.md")
    const inputs = tool.description.split("\n").filter((s: string) => s.startsWith("{")).map((s: string) => JSON.parse(s))
    expect(inputs).toEqual(TOOL_EXAMPLES[name])
    for (const input of inputs) {
      for (const required of tool.input.required) expect(Object.hasOwn(input, required)).toBe(true)
      for (const key of Object.keys(input)) expect(Object.hasOwn(tool.input.properties, key)).toBe(true)
    }
  } finally { await fixture.close() }
})

test("registered help examples run against the actual callbacks and explain dependency filtering", async () => {
  const f = await registeredLoom()
  try {
    const roster = await f.invoke("agents", TOOL_EXAMPLES.agents[0])
    expect(roster.result.agents).toHaveLength(2)
    expect(roster.result.agents.every((a: any) => !a.configured)).toBe(true)
    const { result: action } = await f.invoke("action", TOOL_EXAMPLES.action[0])
    const replace = (input: unknown) => JSON.parse(JSON.stringify(input).replaceAll("ACTION_ID", action.id))
    expect((await f.invoke("action", TOOL_EXAMPLES.action[1])).result.items[0].id).toBe(action.id)
    expect((await f.invoke("action", replace(TOOL_EXAMPLES.action[2]))).result.revision).toBe(2)
    expect((await f.invoke("plan", replace(TOOL_EXAMPLES.plan[0]))).result.revision).toBe(0)
    expect((await f.invoke("plan", replace(TOOL_EXAMPLES.plan[1]))).result.revision).toBe(1)
    expect((await f.invoke("context", TOOL_EXAMPLES.context[1], "fresh")).result.selected).toBeNull()
    const { result: finding } = await f.invoke("record", {
      ...replace(TOOL_EXAMPLES.record[0]), statement: "Fixture-only conclusion; not a real repository finding.",
    }, "research-session")
    expect((await f.invoke("context", replace(TOOL_EXAMPLES.context[0]), "worker-session")).result.task.id).toBe("explain")
    // A record ID alone inherits the worker node, so it does not find Research history.
    expect((await f.invoke("record", { operation: "query", record_id: finding.id }, "worker-session")).result.items).toEqual([])
    const full = replace(TOOL_EXAMPLES.record[1]); full.record_id = finding.id
    expect((await f.invoke("record", full, "worker-session")).result.items[0].id).toBe(finding.id)
    expect((await f.invoke("record", TOOL_EXAMPLES.record[2], "worker-session")).result.items).toEqual([])
    const qa = await f.invoke("record", { ...replace(TOOL_EXAMPLES.record[3]), statement: "Fixture-only review; real investigation was not performed." }, "worker-session")
    expect(qa.result.data.verdict).toBe("inconclusive")
    expect((await f.invoke("context", TOOL_EXAMPLES.context[2], "worker-session")).result.selected).toBeNull()
    expect((await f.invoke("context", TOOL_EXAMPLES.context[1], "worker-session")).result.selected).toBeNull()
  } finally { await f.close() }
})

test("discovery help keeps truthful current errors and scope boundaries visible", () => {
  expect(TOOL_HELP.context).toContain("if saving fails, this call can throw after reading")
  expect(TOOL_HELP.context).toContain("contract_match:null is unknown")
  expect(TOOL_HELP.record).toContain("explicit action_id without node_id searches the whole Action")
  expect(TOOL_HELP.record).toContain("query only, incompatible with work IDs")
  expect(TOOL_HELP.record).toContain("next_after as after")
  expect(TOOL_HELP.plan).toContain("complete nodes list")
  expect(TOOL_HELP.action).toContain("not a Plan revision")
})
