import { test, expect } from "bun:test"
import { Schema, SchemaRepresentation } from "effect"
import { registeredLoom } from "./helpers/registered-loom.js"
import { TOOL_EXAMPLES } from "../src/tool-help.js"

// This independent decoder supports object envelopes, required fields and
// propertyNames. It rejects active JSON Schema if/then/not, so this check does
// not claim to execute the full conditional schema. The actual callbacks below
// exercise the corresponding public combinations, including protected failures.
function envelopeAccepts(schema: any, operation: string, input: unknown): boolean {
  const variant = schema.oneOf.find((candidate: any) => candidate.properties.operation.const === operation)
  const { allOf: _conditionalRules, ...envelope } = variant
  return Schema.is(SchemaRepresentation.fromJsonSchemaDocument({
    dialect: "draft-2020-12", schema: envelope, definitions: {},
  }, { patterns: "apply" }))(input)
}

test("all registered operation tools explain an omitted operation without inspecting a target", async () => {
  const f = await registeredLoom()
  try {
    for (const [name, tool] of f.tools) {
      if (!tool.input.required?.includes("operation")) continue
      const before = f.permissionRequests.length
      await expect(f.invoke(name, {})).rejects.toThrow(`loom_${name} requires operation. Choose:`)
      expect(f.permissionRequests.length).toBe(before)
    }
    expect((await f.invoke("objective", { operation: "list" })).result.items).toEqual([])
    expect(f.sessionCreates).toEqual([])
  } finally { await f.close() }
})

test("public history/objective operation envelopes and callbacks reject the same malformed requests", async () => {
  const f = await registeredLoom()
  try {
    const cases: Array<[string, string, Record<string, unknown>, string]> = [
      ["history", "preview-population", { operation: "preview-population", objective_id: "example-is-not-an-id", question: "Investigate" }, "inside selection"],
      ["history", "population", { operation: "population", population_id: "unknown" }, "manifest_sha256"],
      ["history", "population-source", { operation: "population-source", population_id: "unknown", manifest_sha256: "a".repeat(64) }, "member_key"],
      ["objective", "find", { operation: "find", label: "A phrase" }, "not label or text search"],
      ["objective", "read", { operation: "read" }, "objective_id"],
      ["objective", "create", { operation: "create", source_type: "ledger-record", source_id: "unknown" }, "label"],
      ["objective", "link", { operation: "link", objective_id: "unknown", source_type: "ledger-record", source_id: "unknown" }, "phase"],
      ["objective", "list", { operation: "list", private_source_location: "do-not-echo" }, "Allowed fields: operation, offset"],
    ]
    for (const [name, operation, input, diagnostic] of cases) {
      expect(envelopeAccepts(f.tools.get(name).input, operation, input)).toBe(false)
      await expect(f.invoke(name, input)).rejects.toThrow(diagnostic)
    }
    expect((await f.invoke("objective", { operation: "list" })).result.items).toEqual([])
    expect(f.nativeInputs).toEqual([])
    expect(f.sessionCreates).toEqual([])
  } finally { await f.close() }
})

test("valid source-derived IDs pass published envelopes and execute through the registered callbacks", async () => {
  const f = await registeredLoom()
  try {
    const action = (await f.invoke("action", { operation: "create", title: "Contract fixture", goal: "Inspect a synthetic correction" })).result
    const record = (await f.invoke("record", { operation: "add", action_id: action.id, kind: "result", statement: "Synthetic original result" })).result
    const create = { operation: "create", source_type: "ledger-record", source_id: record.id, label: "Synthetic goal" }
    expect(envelopeAccepts(f.tools.get("objective").input, "create", create)).toBe(true)
    const objective = (await f.invoke("objective", create)).result
    const find = { operation: "find", source_type: "ledger-record", source_id: record.id }
    expect(envelopeAccepts(f.tools.get("objective").input, "find", find)).toBe(true)
    expect((await f.invoke("objective", find)).result.items.map((item: any) => item.id)).toEqual([objective.id])
    const read = { operation: "read", objective_id: objective.id }
    expect(envelopeAccepts(f.tools.get("history").input, "read", read)).toBe(true)
    const history = (await f.invoke("history", read)).result
    expect(history.scope).toEqual({ objective_id: objective.id })
    const preview = { operation: "preview-population", selection: { objective_id: objective.id, question: "What does the original result establish?" } }
    expect(envelopeAccepts(f.tools.get("history").input, "preview-population", preview)).toBe(true)
    await expect(f.invoke("history", { ...preview, selection: { ...preview.selection,
      through: history.boundary.observed_through, owner_boundary: history.boundary.owners, owner_version: history.boundary.owner_version } }))
      .rejects.toThrow("boundaries came from a different view")
    const result = (await f.invoke("history", preview)).result
    expect(result.freeze.selection).toMatchObject({ objective_id: objective.id, question: preview.selection.question })
    expect(result.freeze.selection.through).toBeNumber()
    expect(result.freeze.selection.owner_boundary).toHaveProperty("objective_links")
    expect(result.freeze.selection.owner_boundary).toHaveProperty("review_requests")
    expect(result.freeze.selection.owner_boundary).toHaveProperty("review_relationships")
    expect(result.freeze.selection.owner_version).toMatch(/^[a-f0-9]{64}$/)
    const pinned = { ...preview, selection: result.freeze.selection }
    expect(envelopeAccepts(f.tools.get("history").input, "preview-population", pinned)).toBe(true)
    expect((await f.invoke("history", pinned)).result.manifest_sha256).toBe(result.manifest_sha256)
    for (const field of ["through", "owner_boundary"]) {
      const selection = { ...result.freeze.selection }
      delete selection[field]
      await expect(f.invoke("history", { ...preview, selection })).rejects.toThrow()
    }
  } finally { await f.close() }
})

test("freeze schema distinguishes the complete pinned selection from the first preview request", async () => {
  const f = await registeredLoom()
  try {
    const schema = f.tools.get("review").input.oneOf.find((branch: any) => branch.properties.operation.const === "freeze-population")
    const accepts = Schema.is(SchemaRepresentation.fromJsonSchemaDocument({
      dialect: "draft-2020-12", schema, definitions: {},
    }, { patterns: "apply" }))
    const first = { operation: "freeze-population", selection: { objective_id: "unknown", question: "Synthetic question" }, preview_sha256: "a".repeat(64) }
    expect(accepts(first)).toBe(false)
    await expect(f.invoke("review", first)).rejects.toThrow("Copy preview.freeze unchanged after approval")
    const pinned = { ...first, selection: { ...first.selection, through: 0,
      owner_boundary: { objective_links: 0, review_requests: 0, review_relationships: 0 }, owner_version: "b".repeat(64) } }
    expect(accepts(pinned)).toBe(true)
    // Schema validity never proves an existing objective or source authorization.
    await expect(f.invoke("review", pinned)).rejects.toThrow("Engineering history scope unavailable")
    expect((await f.invoke("objective", { operation: "list" })).result.items).toEqual([])
  } finally { await f.close() }
})

test("published review request imports without nested conditionals and keeps historical semantics", async () => {
  const f = await registeredLoom()
  try {
    const historical = TOOL_EXAMPLES.review[0]
    const schema = f.tools.get("review").input.oneOf.find((branch: any) => branch.properties.operation.const === "freeze")
    const accepts = Schema.is(SchemaRepresentation.fromJsonSchemaDocument({
      dialect: "draft-2020-12", schema, definitions: {},
    }, { patterns: "apply" }))
    expect(accepts(historical)).toBe(true)
    const frozen = (await f.invoke("review", historical)).result
    const original = (await f.invoke("review", { operation: "read", request_id: frozen.request_id })).result.request
    expect(original.work_revision_policy).toBe("frozen-historical")
    expect(original.mandate.currentness).toBeUndefined()
    const invalid = { ...historical, request: { ...historical.request, request_id: "invalid-policy",
      work_revision_policy: "current-at-issue-claim" } }
    await expect(f.invoke("review", invalid)).rejects.toThrow("work_revision_policy must follow")
    expect(f.sessionCreates).toEqual([])
    expect(f.nativeInputs).toEqual([])
  } finally { await f.close() }
})

test("record schema publishes exact field projection prerequisites and callbacks enforce them", async () => {
  const f = await registeredLoom()
  try {
    const schema = f.tools.get("record").input
    const projectionRule = schema.allOf.find((rule: any) => rule.if.properties?.projection?.const === "fields")
    expect(projectionRule.then.required).toEqual(["record_id", "fields"])
    const fieldsRule = schema.allOf.find((rule: any) => rule.if.required?.length === 1 && rule.if.required[0] === "fields")
    expect(fieldsRule.then).toEqual({ properties: { projection: { const: "fields" } }, required: ["projection"] })
    const original = (await f.invoke("record", { operation: "add", kind: "result", statement: "Exact original statement" })).result
    const query = { operation: "query", source_session_id: "s", record_id: original.id, projection: "fields", fields: ["statement"] }
    expect((await f.invoke("record", query)).result.items[0].data).toEqual({ statement: "Exact original statement" })
    await expect(f.invoke("record", { ...query, record_id: undefined })).rejects.toThrow("exact record_id")
    await expect(f.invoke("record", { ...query, fields: undefined })).rejects.toThrow("distinct supported fields")
    await expect(f.invoke("record", { ...query, projection: undefined })).rejects.toThrow("fields requires projection=fields")
    await expect(f.invoke("record", { ...query, operation: "add" })).rejects.toThrow("require a ledger query")
  } finally { await f.close() }
})

test("validation guidance neither echoes untrusted fields nor bypasses source permissions", async () => {
  const f = await registeredLoom()
  try {
    const secret = "private-location-and-body-sentinel"
    for (const input of [
      { operation: "find", source_type: "ledger-record", source_id: secret, [secret]: secret },
      { operation: secret, source_id: secret },
    ]) {
      let failure: unknown
      try { await f.invoke("objective", input) } catch (error) { failure = error }
      expect(failure).toBeInstanceOf(Error)
      expect(String(failure)).not.toContain(secret)
    }
    await expect(f.invoke("history", { operation: "preview-population", selection: { objective_id: secret, question: "Question", owner_boundary: { objective_links: 0 } } }))
      .rejects.toThrow("objective_links, review_requests and review_relationships")
    for (const [selection, diagnostic] of [
      [{ objective_id: "unknown", question: "Question", mode: "invented-policy" }, "Only mode:explicit-objective is supported"],
      [{ objective_id: "unknown", question: "Question\n" }, "without control characters"],
      [{ objective_id: "unknown", question: "Question", exclusions: [{ record_id: "record", reason: "Reason" }, { record_id: "record", reason: "Again" }] }, "Include each excluded record_id once"],
    ] as const) await expect(f.invoke("history", { operation: "preview-population", selection })).rejects.toThrow(diagnostic)
    const action = (await f.invoke("action", { operation: "create", title: "Permission fixture", goal: "Keep authorization separate" })).result
    f.permission.error = new Error("Native read denied")
    await expect(f.invoke("history", { operation: "read", action_id: action.id })).rejects.toThrow("Native read denied")
    expect(f.nativeInputs).toEqual([])
    expect(f.sessionCreates).toEqual([])
  } finally { await f.close() }
})
