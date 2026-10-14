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

test("Plan search help explains intent and every declared node field", async () => {
  const f = await registeredLoom()
  try {
    const tool = f.tools.get("plan")
    const node = tool.input.properties.nodes.items
    expect(node.required).toEqual(["id", "kind", "title"])
    expect(Object.keys(node.properties).sort()).toEqual(["agent", "context", "criteria", "depends_on", "id", "kind", "outcome", "parent", "roles", "skills", "title"])
    for (const field of Object.keys(node.properties)) expect(tool.description).toContain(field)
    for (const text of [
      "Plan is not a scheduler", "Nodes are a flat list", "Optional fields:",
      "criteria: list of observable completion conditions", "context: constraints, background, qualifications and references",
      "siblings do not automatically depend on each other", "These do not dispatch agents or load skills",
      "Saving does not dispatch, enforce execution order or mark tasks complete",
      "Action and Plan revisions are separate", "not activity logs or whole fetched documents",
      "The Plan says what should happen; the ledger remembers what was found or done",
    ]) expect(tool.description).toContain(text)
  } finally { await f.close() }
})

test("three-task example preserves intent, revisions and ledger history across full replacement", async () => {
  const f = await registeredLoom()
  try {
    const { result: action } = await f.invoke("action", TOOL_EXAMPLES.action[0])
    // Read the example from the registered help, as an agent receives it in search.
    const examples = f.tools.get("plan").description.split("\n").filter((s: string) => s.startsWith("{")).map((s: string) => JSON.parse(s))
    const input = { ...examples.find((e: any) => e.operation === "save"), action_id: action.id }
    const first = (await f.invoke("plan", input)).result
    expect(first.nodes).toEqual(input.nodes)
    expect(first.nodes.map((n: any) => n.id)).toEqual(["research", "explain", "review"])
    expect(first.nodes[1].depends_on).toEqual(["research"])
    expect(first.nodes[2].depends_on).toEqual(["explain"])
    expect((await f.invoke("record", { operation: "query", action_id: action.id })).result.items).toEqual([])
    expect((await f.invoke("action", { operation: "list" })).result.items[0].state).toBe("active")
    const { result: record } = await f.invoke("record", {
      operation: "add", action_id: action.id, node_id: "research", kind: "result",
      statement: "Fixture conclusion only; this does not establish a real investigation.",
    })
    const nodes = [{ id: "explain", kind: "task", title: "A revised standalone explanation" }]
    expect((await f.invoke("plan", { operation: "save", action_id: action.id, expected_revision: first.revision, nodes })).result.nodes).toEqual(nodes)
    expect((await f.invoke("plan", { operation: "read", action_id: action.id, revision: 1 })).result.nodes).toEqual(input.nodes)
    expect((await f.invoke("record", { operation: "query", action_id: action.id, record_id: record.id })).result.items[0].id).toBe(record.id)
    await expect(f.invoke("plan", { ...input, expected_revision: 1 })).rejects.toThrow("Plan changed")
    expect((await f.invoke("plan", { operation: "read", action_id: action.id })).result.revision).toBe(2)
  } finally { await f.close() }
})

test("optional hierarchy groups siblings without inventing dependencies or completing work", async () => {
  const f = await registeredLoom()
  try {
    const { result: action } = await f.invoke("action", TOOL_EXAMPLES.action[0])
    const nodes = [
      { id: "phase", kind: "phase", title: "Configuration improvements" },
      { id: "research", kind: "task", title: "Research behavior", parent: "phase", agent: "investigator", roles: ["research"], skills: ["fixture-skill"], outcome: "Findings", criteria: ["Cite observed behavior"], context: "Preserve qualifications." },
      { id: "explain", kind: "task", title: "Write guide", parent: "phase" },
    ]
    expect((await f.invoke("plan", { operation: "save", action_id: action.id, expected_revision: 0, nodes })).result.nodes).toEqual(nodes)
    const { result: context } = await f.invoke("context", { action_id: action.id, node_id: "explain" })
    expect(context.task.depends_on).toBeUndefined()
    expect(context.related_tasks.map((n: any) => n.id)).toEqual(["phase"])
    expect(context.records).toEqual([])
    expect((await f.invoke("action", { operation: "list" })).result.items[0].state).toBe("active")
  } finally { await f.close() }
})

test("Plan rejects missing required and invented lifecycle fields without writing a revision", async () => {
  const f = await registeredLoom()
  try {
    const { result: action } = await f.invoke("action", TOOL_EXAMPLES.action[0])
    const node = { id: "task", kind: "task", title: "Intent only" }
    for (const field of ["status", "completed", "permissions"]) {
      await expect(f.invoke("plan", { operation: "save", action_id: action.id, expected_revision: 0, nodes: [{ ...node, [field]: "invented" }] })).rejects.toThrow(`Unknown plan node field: ${field}`)
    }
    for (const field of ["id", "kind", "title"]) {
      const incomplete: Record<string, string> = { ...node }
      delete incomplete[field]
      await expect(f.invoke("plan", { operation: "save", action_id: action.id, expected_revision: 0, nodes: [incomplete] })).rejects.toThrow()
    }
    expect((await f.invoke("plan", { operation: "read", action_id: action.id })).result).toEqual({ revision: 0, nodes: [] })
  } finally { await f.close() }
})
