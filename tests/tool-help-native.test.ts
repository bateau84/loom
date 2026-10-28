import { test, expect } from "bun:test"
import { writeFile } from "node:fs/promises"
import { join } from "node:path"
import { TOOL_HELP, TOOL_EXAMPLES, LOOM_NAMESPACE_HELP, type LoomToolName } from "../src/tool-help.js"
import { registeredLoom } from "./helpers/registered-loom.js"

for (const name of Object.keys(TOOL_HELP) as LoomToolName[]) test(`registered ${name} tool carries complete search help without role injection`, async () => {
  const fixture = await registeredLoom()
  try {
    expect([...fixture.tools.keys()].sort()).toEqual(["action", "agents", "assessment", "context", "plan", "qa", "record"])
    expect(fixture.namespaces.get("loom").description).toBe(LOOM_NAMESPACE_HELP)
    const tool = fixture.tools.get(name)
    expect(tool.description).toBe(TOOL_HELP[name])
    expect(tool.options).toEqual({ namespace: "loom", codemode: true })
    expect(tool.description.split("\n")[0].length).toBeLessThanOrEqual(120)
    expect(tool.description.length).toBeLessThanOrEqual(name === "record" ? 10000 : 3600)
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
    expect(roster.result.role_descriptions).toEqual({})
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
  expect(TOOL_HELP.agents).toContain("role_descriptions")
  expect(TOOL_HELP.agents).toContain("automatic matching")
  expect(TOOL_HELP.context).toContain("selection.status=save-failed")
  expect(TOOL_HELP.context).toContain('persisted="unknown"')
  expect(TOOL_HELP.context).toContain("Failed clear still throws")
  expect(TOOL_HELP.context).not.toContain("CURRENT LIMITATION")
  expect(TOOL_HELP.context).toContain("contract_match:null is unknown")
  expect(TOOL_HELP.record).toContain("explicit action_id without node_id searches the whole Action")
  expect(TOOL_HELP.record).toContain("ledger query or any add, incompatible with work IDs")
  expect(TOOL_HELP.record).toContain("session_only:true forces this scope")
  expect(TOOL_HELP.context).toContain("mode=independent returns a Session-only withheld-history view")
  expect(TOOL_HELP.record).toContain("next_after as after")
  expect(TOOL_HELP.plan).toContain("complete nodes list")
  expect(TOOL_HELP.action).toContain("not a Plan revision")
})

test("canonical collaboration help matches conditional schemas and rejects aliases", async () => {
  const f = await registeredLoom()
  try {
    const tool = f.tools.get("record")
    for (const [operation, required, allowed] of [
      ["ask", ["operation", "question", "blocking"], ["operation", "question", "to_agent", "recipient", "blocking", "context", "context_attachments", "reference"]],
      ["answer", ["operation", "question_id", "answer"], ["operation", "question_id", "answer", "context_attachments"]],
    ] as const) {
      const schema = tool.input.allOf.find((s: any) => s.if.properties.operation?.const === operation).then
      expect(schema.required).toEqual(required)
      expect(Object.keys(schema.properties).sort()).toEqual([...allowed].sort())
      expect(schema.additionalProperties).toBe(false)
      expect(schema.properties.context_attachments).toEqual(tool.input.properties.context_attachments)
      expect(schema.properties).not.toHaveProperty("attachments")
    }
    const examples = TOOL_EXAMPLES.record
    const ask = examples.find(e => e.operation === "ask" && "reference" in e)!
    const answer = examples.find(e => e.operation === "answer")!
    expect(ask).toHaveProperty("context_attachments")
    expect(answer).toHaveProperty("context_attachments")
    const { reference: _reference, ...unscoped } = ask
    const question = (await f.invoke("record", unscoped, "asker")).result
    expect(question.data.context_attachments).toEqual(ask.context_attachments)
    expect(question.action_id).toBeUndefined()
    expect(question.dispatch).toEqual({ status: "not-attempted", reason: "policy-capability-unavailable" })
    const answered = (await f.invoke("record", { ...answer, question_id: question.id }, "respondent")).result
    expect(answered.data.context_attachments).toEqual(answer.context_attachments)
    expect(answered.session_id).toBe("respondent")
    for (const input of [unscoped, { ...answer, question_id: question.id }]) {
      const { context_attachments: _canonical, ...withoutCanonical } = input
      for (const invalid of [{ ...withoutCanonical, attachments: [] }, { ...input, attachments: [] }])
        await expect(f.invoke("record", invalid)).rejects.toThrow("attachments is not supported")
    }
    for (const text of ["FIRST committed", "legacy", "single", "No retries", "not an atomic lease", "not perpetual", "No recursive evidence expansion"]) expect(tool.description).toContain(text)
    expect(tool.input.properties.operation.enum).toEqual(["add", "query", "complete", "reopen", "ask", "answer", "bind-respondent"])
    expect(tool.input.properties.view.enum).toEqual(["ledger", "progress", "questions", "thread", "full_thread"])
    const history = (await f.invoke("record", { operation: "query", view: "full_thread", session_id: "asker", limit: 1 })).result
    expect(history.format).toBe("loom-full-thread/v1")
    expect(history.markdown).toContain(question.id)
    expect(history.next_cursor).not.toBeNull()
    const next = (await f.invoke("record", { operation: "query", view: "full_thread", session_id: "asker", cursor: history.next_cursor })).result
    expect(next.markdown).toContain(answered.id)
    expect(next.next_cursor).toBeNull()
  } finally { await f.close() }
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


test("search-visible help explains awaited writes and independent-call failure handling", async () => {
  const f = await registeredLoom()
  try {
    expect(f.tools.size).toBe(7)
    for (const tool of f.tools.values()) {
      expect(tool.description).toContain("Await writes before using IDs or ending Code Mode")
      expect(tool.description).toContain("Promise.allSettled and inspect every outcome")
      expect(tool.description).toContain("sequence dependent calls")
    }
  } finally { await f.close() }
})

test("Loom context injection preserves host generation options and native tool definitions", async () => {
  const f = await registeredLoom()
  try {
    await writeFile(join(f.directory, ".loom.yaml"), "agents: {author: {roles: [implementation]}}\n")
    const action = (await f.invoke("action", { operation: "create", title: "Host defaults", goal: "Keep native generation settings" })).result
    const options = { maxTokens: 4096, temperature: 0.2 }
    const nativeTools = { native: { description: "Native tool", input: { type: "object" } } }
    const native = { type: "text", text: "Existing system instructions" }
    const event = { sessionID: "s", agent: "author", system: [native], messages: [], options, tools: nativeTools }
    await f.hooks.get("context")(event)
    expect(event.options).toBe(options)
    expect(event.options).toEqual({ maxTokens: 4096, temperature: 0.2 })
    expect(event.tools).toBe(nativeTools)
    expect(event.system[0]).toBe(native)
    expect(event.system.some(part => part.text.includes(action.id))).toBe(true)
  } finally { await f.close() }
})


test("native Session discovery is scoped, paged, read-only, and includes archive state", async () => {
  const f = await registeredLoom()
  try {
    const action = (await f.invoke("action", { operation: "create", title: "Browse", goal: "See local participants" }, "owner")).result
    await f.invoke("context", { action_id: action.id }, "worker")
    await f.invoke("record", { operation: "add", kind: "result", statement: "Worker contributed" }, "worker")
    await f.invoke("context", { clear: true }, "worker")
    const local = (id: string, extra: any = {}) => ({
      id, projectID: "tool-help", location: { directory: f.directory },
      time: { created: 1, ...extra.time }, title: id, ...extra,
    })
    f.nativePages.set("", {
      data: [
        local("owner"), local("outsider", { projectID: "another-project" }),
        local("moved", { location: { directory: f.directory + "/other" } }),
      ],
      cursor: { next: "next-page", previous: null },
    })
    f.nativePages.set("next-page", {
      data: [local("worker", { time: { archived: 100 } }), local("unlinked")],
      cursor: { next: null, previous: "previous-page" },
    })
    const first = (await f.invoke("action", { operation: "sessions", action_id: action.id, limit: 3 })).result
    expect(first.sessions.map((s: any) => s.id)).toEqual(["owner"])
    expect(first.scanned).toBe(3)
    expect(first.next_cursor).toBe("next-page")
    expect(first.sessions[0].selection.action_id).toBe(action.id)
    expect(first.sessions[0].has_recorded_activity).toBe(false)
    const next = (await f.invoke("action", {
      operation: "sessions", action_id: action.id, cursor: first.next_cursor, limit: 3, archived: true,
    })).result
    expect(next.sessions.map((s: any) => s.id)).toEqual(["worker"])
    expect(next.sessions[0].selection).toBeUndefined()
    expect(next.sessions[0].has_recorded_activity).toBe(true)
    expect(next.sessions[0].archived).toBe(true)
    expect(next.next_cursor).toBeNull()
    expect(f.nativeListRequests).toEqual([
      { project: "tool-help", directory: f.directory, limit: 3 },
      { project: "tool-help", directory: f.directory, limit: 3, cursor: "next-page", archived: true },
    ])
    expect((await f.invoke("context", {}, "worker")).result.selected).toBeNull()
    expect((await f.invoke("context", {}, "owner")).result.action.id).toBe(action.id)
    expect(f.nativeInputs).toHaveLength(0)
    await expect(f.invoke("action", { operation: "sessions", action_id: "nonexistent" })).rejects.toThrow("Unknown Action")
    expect(f.nativeListRequests).toHaveLength(2)
    f.nativePages.set("broken", { data: "not-an-array", cursor: { next: null } })
    await expect(f.invoke("action", { operation: "sessions", cursor: "broken" })).rejects.toThrow("data array")
  } finally { await f.close() }
})
