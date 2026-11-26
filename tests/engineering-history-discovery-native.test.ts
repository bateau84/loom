import { expect, spyOn, test } from "bun:test"
import { EngineeringHistory } from "../src/engineering-history.js"
import { registeredLoom } from "./helpers/registered-loom.js"

type Fixture = Awaited<ReturnType<typeof registeredLoom>>
const execute = (f: Fixture, query: unknown) => f.tools.get("history").execute(query,
  { sessionID: "reader", agent: "author", messageID: "discovery", id: "discovery-call", signal: new AbortController().signal })

test("registered history advertises bounded selective discovery to the host", async () => {
  const f = await registeredLoom()
  try {
    const tool = f.tools.get("history")
    expect(tool.input.properties.match).toEqual({ type: "string", minLength: 1, maxLength: 200 })
    expect(tool.input.properties.record_kinds).toMatchObject({ type: "array", minItems: 1, uniqueItems: true })
    expect(tool.input.properties.record_kinds.items.enum).toContain("observation")
    expect(tool.input.properties.verdict.enum).toEqual(["pass", "fail", "inconclusive"])
    expect(tool.input.properties.plan_revision).toEqual({ type: "integer", minimum: 1 })
    expect(tool.input.properties.has_gaps).toEqual({ type: "boolean" })
    for (const key of ["source_session_id", "node_id"]) expect(tool.input.properties[key].type).toBe("string")
    expect(tool.description).toContain("match")
    expect(tool.description).toContain("before")
    expect(tool.description).toContain("literal")
  } finally { await f.close() }
})

test("selective history never uses matching records to narrow the contributing Session grants", async () => {
  const f = await registeredLoom()
  try {
    const { result: action } = await f.invoke("action", { operation: "create", title: "Authorized discovery", goal: "Find a specific failure" })
    await f.invoke("record", { operation: "add", action_id: action.id, kind: "concern", statement: "needle finding" }, "matching")
    await f.invoke("record", { operation: "add", action_id: action.id, kind: "result", statement: "PRIVATE_NONMATCHING_SOURCE" }, "excluded")
    const project = spyOn(EngineeringHistory.prototype, "read")
    try {
      f.permission.beforeReturn = async () => {
        if (f.permissionRequests.at(-1).resources.includes("loom:evidence:inspect:session:excluded:view:engineering-history"))
          throw new Error("excluded contributor denied")
      }
      for (const response_format of ["json", "markdown", "html"]) {
        await expect(execute(f, { operation: "read", action_id: action.id, match: "needle",
          record_kinds: ["concern"], source_session_id: "matching", response_format })).rejects.toThrow("excluded contributor denied")
      }
      expect(project).not.toHaveBeenCalled()
    } finally { project.mockRestore() }
  } finally { await f.close() }
})

test("selective history returns only matching authored records and preserves exact original permission requests", async () => {
  const f = await registeredLoom()
  try {
    const { result: action } = await f.invoke("action", { operation: "create", title: "Literal discovery", goal: "Find a literal historical finding" })
    const { result: target } = await f.invoke("record", { operation: "add", action_id: action.id, kind: "assessment",
      statement: "Failure contains 100%_literal text; a later check is still incomplete.", verdict: "inconclusive" }, "target")
    await f.invoke("record", { operation: "add", action_id: action.id, kind: "assessment",
      statement: "100Xliteral would match an unsafe LIKE wildcard", verdict: "pass" }, "other")
    const view = JSON.parse((await execute(f, { operation: "read", action_id: action.id, match: "100%_LITERAL",
      record_kinds: ["assessment"], verdict: "inconclusive", source_session_id: "target", limit: 1 })).content).result
    expect(view.mode).toBe("discovery")
    expect(view.coverage.matching_records).toBe(1)
    expect(view.records.map((r: any) => r.source.record_id)).toEqual([target.id])
    expect(view.records[0].source.query).toEqual({ operation: "query", action_id: action.id,
      source_session_id: "target", record_id: target.id })
    expect(view.records[0].verification).toBe("authored claim; not independently verified")
    expect(f.permissionRequests.at(-1).resources).toContain("loom:evidence:disclose:session:other:view:engineering-history:recipient:reader")
  } finally { await f.close() }
})
