import { writeFile } from "node:fs/promises"
import { registeredLoom } from "./registered-loom.js"

/** Export real registration schemas and observed callback outcomes to the external
 * Draft 2020-12 validator. Static expectations represent public syntax contracts;
 * they are not copied from the schema or a mocked callback result. All state is
 * synthetic and disposable. No native dispatch or real provider is involved. */
const output = process.argv[2]
if (!output) throw new Error("Provide a JSON report path")
const f = await registeredLoom()
try {
  const action = (await f.invoke("action", { operation: "create", title: "Schema fixture", goal: "Check public syntax" })).result
  const record = (await f.invoke("record", { operation: "add", action_id: action.id, kind: "result", statement: "Original fixture result" })).result
  const create = { operation: "create", source_type: "ledger-record", source_id: record.id, label: "Schema fixture objective" }
  const objective = (await f.invoke("objective", create)).result
  const preview = { operation: "preview-population", selection: { objective_id: objective.id, question: "Inspect the result" } }
  const page = (await f.invoke("history", preview)).result
  const candidate = (await f.invoke("tweak", { operation: "propose", target_kind: "skill", target_id: "fixture",
    base_sha256: "a".repeat(64), candidate_content: "Synthetic proposal; never installed", hypothesis: "Test syntax" })).result
  const read = { operation: "read", action_id: action.id }
  const link = { operation: "link", objective_id: objective.id, source_type: "ledger-record", source_id: record.id }
  const cases: Array<{ tool: string; input: unknown; expected: boolean }> = []
  const add = (tool: string, expected: boolean, ...inputs: unknown[]) => inputs.forEach(input => cases.push({ tool, input, expected }))
  add("history", true, read, preview, { ...read, related: true, record_id: record.id })
  add("history", false,
    {}, { operation: "bad" }, { ...read, session_id: "s" }, { ...read, related: true },
    { ...read, related: true, record_id: record.id, match: "result" },
    { ...read, record_id: record.id, branch_ref: "branch" }, { ...read, match: "result", after: 0 },
    { ...read, owner_version: "a".repeat(64) },
    { ...read, owner_boundary: { objective_links: 0, review_requests: 0, review_relationships: 0 } },
    { ...read, branch_offset: 1 }, { ...read, record_id: record.id, branch_offset: 0 },
    { operation: "preview-population", objective_id: objective.id, question: "Question" },
    { operation: "preview-population", selection: { question: "Question" } },
    { ...preview, selection: { ...preview.selection, owner_boundary: { objective_links: 0 } } },
    { operation: "population", population_id: "example" },
    { operation: "population-source", population_id: "example", manifest_sha256: "a".repeat(64) },
  )
  // The fingerprint is real: this negative isolates the missing pinned selection,
  // not an earlier missing-fingerprint failure. Freeze uses the returned request.
  add("review", false, { operation: "freeze-population", selection: preview.selection, preview_sha256: page.freeze.preview_sha256 })
  add("review", true, page.freeze)
  add("objective", true,
    { operation: "list" }, create, { operation: "read", objective_id: objective.id },
    { operation: "find", source_type: "ledger-record", source_id: record.id },
    { ...link, phase: "verification", assessment: "pass" },
  )
  add("objective", false,
    {}, { operation: "find", label: "text" },
    { operation: "find", source_type: "ledger-record", source_id: record.id, label: "text" },
    { operation: "list", label: "text" }, { operation: "read" }, { ...create, label: undefined }, { ...create, source_session_id: "s" },
    { operation: "find", source_type: "native-message", source_id: "message" },
    { operation: "find", source_type: "native-call", source_id: "call", source_session_id: "s" },
    { operation: "find", source_type: "external-ref", source_id: "https://example.org/issue", source_session_id: "s" },
    { ...link, phase: "verification" }, { ...link, phase: "coordination", assessment: "pass" },
    { ...link, phase: "continuation" }, { ...link, phase: "coordination", confidence: "uncertain" },
    { ...link, phase: "coverage-gap" }, { ...link, phase: "coordination", gap_reason: "unknown" },
  )
  const query = { operation: "query", action_id: action.id, record_id: record.id, projection: "fields", fields: ["statement"] }
  add("record", true, query, { operation: "query", action_id: action.id, record_id: record.id, response_format: "json" })
  add("record", false,
    { ...query, record_id: undefined }, { ...query, fields: undefined }, { ...query, projection: undefined },
    { operation: "add", kind: "qa", statement: "No verdict" },
    { operation: "add", kind: "result", statement: "Not a formatted write", response_format: "json" },
    { operation: "query", session_only: true, action_id: action.id }, { operation: "complete", statement: "No reference" },
  )
  add("action", true, { operation: "list" }, { operation: "create", title: "Separate goal", goal: "Synthetic test only" })
  add("action", false,
    { operation: "create", title: "Missing goal" }, { operation: "create", goal: "Missing title" },
    { operation: "update", action_id: action.id, title: "Missing revision" }, { operation: "update", expected_revision: 1 },
  )
  add("plan", true, { operation: "read", action_id: action.id }, { operation: "save", action_id: action.id, expected_revision: 0, nodes: [] })
  add("plan", false,
    { operation: "read" }, { operation: "save", action_id: action.id, nodes: [] },
    { operation: "save", action_id: action.id, expected_revision: 1 },
  )
  add("trace", true, { operation: "timeline" })
  add("trace", false,
    { operation: "source", fields: ["status"] }, { operation: "source", message_id: "message", fields: ["status"] },
    { operation: "source", message_id: "message", part_id: "part" },
  )
  add("tweak", true, { operation: "list" }, { operation: "read", id: candidate.id })
  add("tweak", false,
    { operation: "propose", target_kind: "skill", target_id: "fixture", base_sha256: "a".repeat(64), candidate_content: "Missing hypothesis" },
    { operation: "read" }, { operation: "retire" },
    { operation: "trial", id: candidate.id, statement: "Missing effect" },
    { operation: "trial", id: candidate.id, observed_effect: "inconclusive" },
  )
  add("insights", true, { operation: "window" }, { operation: "evaluation-status" })
  add("insights", false, ...["evaluation", "evaluation-members", "evaluation-sources", "evaluation-observations", "evaluation-preparation",
    "evaluation-preparation-members", "evaluation-preparation-source", "evaluation-admission"].map(operation => ({ operation })))
  add("context", true, {}, { mode: "independent" })
  add("context", false, { node_id: "missing-action" }, { clear: true, action_id: action.id }, { mode: "independent", handoff_id: record.id })
  const trends = { operation: "compare", since_at: "2026-01-01T00:00:00.000Z", until_at: "2026-02-01T00:00:00.000Z", as_of_at: "2026-03-01T00:00:00.000Z" }
  add("trends", true, { ...trends, population: "all-linked" })
  add("trends", false, { ...trends, population: "selected" }, { ...trends, population: "all-linked", objective_ids: [objective.id] })
  add("agents", true, {})
  const results = []
  for (const c of cases) {
    const input = JSON.parse(JSON.stringify(c.input))
    try { await f.invoke(c.tool, input); results.push({ ...c, input, runtime_ok: true }) }
    catch (error) { results.push({ ...c, input, runtime_ok: false, error: error instanceof Error ? error.message : String(error) }) }
  }
  await writeFile(output, JSON.stringify({ format: "loom-tool-schema-contracts/v1",
    schemas: Object.fromEntries([...f.tools].map(([name, tool]) => [name, tool.input])), cases: results,
    native_effects: { creates: f.sessionCreates.length, prompts: f.sessionPrompts.length, notices: f.nativeInputs.length },
  }))
} finally { await f.close() }
