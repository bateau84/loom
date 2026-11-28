/** Public operation envelopes. Keep required/allowed fields together so discovery
 * and direct callback calls agree even when the host only renders flat inputs.
 * Source values and authorization stay with their existing owners. */
type OperationContract = { required: readonly string[]; fields: readonly string[]; hint: string }
const contract = (required: readonly string[], fields: readonly string[], hint: string): OperationContract =>
  ({ required, fields: ["operation", ...fields], hint })
const sourceFields = ["source_type", "source_id", "source_session_id", "source_message_id"]
const contracts: Readonly<Record<string, Readonly<Record<string, OperationContract>>>> = {
  history: {
    read: contract([], ["action_id", "session_id", "objective_id", "branch_ref", "record_id", "related", "match", "record_kinds", "verdict",
      "source_session_id", "node_id", "plan_revision", "has_gaps", "after", "through", "branch_offset", "limit", "owner_boundary", "owner_version", "connection_cursor", "response_format"],
    "Use exactly one action_id, session_id or objective_id. Copy returned navigation requests for continuation."),
    "preview-population": contract(["selection"], ["selection", "after", "limit", "response_format"],
      "Put objective_id and question inside selection. Obtain the objective ID from loom_objective find/list or an authorized create; omit boundaries on the first preview."),
    population: contract(["population_id", "manifest_sha256"], ["population_id", "manifest_sha256", "after", "limit", "response_format"],
      "Use population_id and manifest_sha256 returned by freeze-population; copy the returned next request."),
    "population-source": contract(["population_id", "manifest_sha256", "member_key"], ["population_id", "manifest_sha256", "member_key", "source_offset", "source_limit", "response_format"],
      "Copy member.inspect or navigation.next; verify original fragments. Source references do not grant access."),
  },
  objective: {
    list: contract([], ["offset"], "List authored objective IDs; this is not text search. Follow next_offset if needed."),
    read: contract(["objective_id"], ["objective_id", "cursor", "limit"], "Use an ID returned by find, list or create."),
    find: contract(["source_type", "source_id"], [...sourceFields, "offset"],
      "Exact-source lookup, not label or text search. Use loom_history read with match for text discovery, or objective list when the source is unknown."),
    create: contract(["source_type", "source_id", "label"], [...sourceFields, "export_path", "label", "unit_key"],
      "Author a source-linked objective only when authorized. The returned id is the objective_id for later calls."),
    link: contract(["objective_id", "phase", "source_type", "source_id"], [...sourceFields, "objective_id", "phase", "export_path", "confidence", "assessment", "related_sequence", "relation", "gap_reason", "note"],
      "Append an attributed source relationship to an existing objective; phase determines assessment and related_sequence requirements."),
  },
}

// Simple prerequisites for the rest of the operation surface. Conditional
// requirements avoid repeating large optional shapes in discovery signatures;
// the existing owners continue to validate values, scope and state.
const operationRequirements: Readonly<Record<string, Readonly<Record<string, readonly string[]>>>> = {
  action: { create: ["title", "goal"], update: ["action_id", "expected_revision"] },
  plan: { save: ["expected_revision", "nodes"] },
  trace: { source: ["message_id", "part_id", "fields"] },
  tweak: { propose: ["target_kind", "target_id", "base_sha256", "candidate_content", "hypothesis"],
    read: ["id"], retire: ["id"], trial: ["id", "observed_effect", "statement"] },
  insights: {
    evaluation: ["batch_id"], "evaluation-members": ["batch_id"], "evaluation-sources": ["batch_id"],
    "evaluation-observations": ["batch_id", "member_key", "report_id"], "evaluation-preparation": ["batch_id"],
    "evaluation-preparation-members": ["batch_id", "request_id", "manifest_sha256"],
    "evaluation-preparation-source": ["batch_id", "request_id", "manifest_sha256", "member_key", "source_index"],
    "evaluation-admission": ["batch_id", "request_id", "manifest_sha256", "attempt_id"],
    "evaluation-interpretation": ["batch_id"],
  },
}

const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value)
const absent = (...fields: string[]) => ({ not: { anyOf: fields.map(field => ({ required: [field] })) } })
const depends = (field: string, ...required: string[]) => ({ if: { required: [field] }, then: { required } })
const selected = (field: string, value: string | boolean) => ({ properties: { [field]: { const: value } }, required: [field] })
const phaseAssessment = (phases: string[], assessments: string[]) => ({
  if: { properties: { phase: { enum: phases } }, required: ["phase"] },
  then: { required: ["assessment"], properties: { assessment: { enum: assessments } } },
})

function combinations(name: string, operation: string): Record<string, unknown>[] {
  // Keep conditional checks on the operation envelope, not the nested
  // property shape imported by Effect. Full JSON Schema and the source
  // owners still enforce both dependencies.
  if (name === "history" && operation === "preview-population") return [
    ...[["owner_boundary", "through"], ["owner_version", "owner_boundary"]].map(([field, prerequisite]) => ({
      if: { properties: { selection: { required: [field] } } },
      then: { properties: { selection: { required: [prerequisite] } } },
    })),
  ]
  if (name === "history" && operation === "read") return [
    { oneOf: ["action_id", "session_id", "objective_id"].map(field => ({ required: [field] })) },
    { not: { required: ["record_id", "branch_ref"] } },
    depends("after", "through"), depends("owner_boundary", "through"), depends("owner_version", "owner_boundary"),
    { if: { required: ["after"], not: selected("related", true) }, then: {
      ...absent("record_id"),
      anyOf: ["branch_ref", "objective_id", "match", "record_kinds", "verdict", "source_session_id", "node_id", "plan_revision", "has_gaps"]
        .map(field => ({ required: [field] })),
    } },
    depends("connection_cursor", "through"),
    { if: { properties: { branch_offset: { minimum: 1 } }, required: ["branch_offset"] }, then: { required: ["through"] } },
    { if: { required: ["branch_offset"] }, then: absent("record_id") },
    { if: selected("related", true), then: {
      anyOf: [{ required: ["record_id"] }, { required: ["objective_id"] }],
      ...absent("branch_ref", "match", "record_kinds", "verdict", "source_session_id", "node_id", "plan_revision", "has_gaps"),
    } },
  ]
  if (name !== "objective" || !["find", "create", "link"].includes(operation)) return []
  const native = { properties: { source_type: { enum: ["native-message", "native-call"] } }, required: ["source_type"] }
  const rules: Record<string, unknown>[] = [
    { if: selected("source_type", "native-call"), then: { required: ["source_message_id"] } },
    { if: selected("source_type", "native-message"), then: absent("source_message_id") },
    { if: { properties: { source_type: { enum: ["external-ref", "unavailable"] } }, required: ["source_type"] },
      then: absent("source_session_id", "source_message_id", "export_path") },
    { if: selected("source_type", "ledger-record"), then: operation === "find"
      ? absent("source_message_id") : absent("source_session_id", "source_message_id", "export_path") },
  ]
  if (operation === "find") rules.push({ if: native, then: { required: ["source_session_id"] } })
  if (operation === "create") rules.push({ not: selected("source_type", "unavailable") })
  if (operation === "link") rules.push(
    phaseAssessment(["handback"], ["reported-done", "reported-failed", "inconclusive"]),
    phaseAssessment(["verification", "outcome"], ["pass", "fail", "inconclusive"]),
    phaseAssessment(["link-correction"], ["confirm", "reject"]),
    { if: { properties: { phase: { enum: ["request", "coordination", "dispatch", "corrective-dispatch", "continuation", "planned-increment", "requirement-change", "environment-failure", "coverage-gap"] } }, required: ["phase"] }, then: absent("assessment") },
    { if: { properties: { phase: { enum: ["link-correction", "continuation", "corrective-dispatch"] } }, required: ["phase"] }, then: { required: ["related_sequence"] } },
    { if: selected("phase", "coverage-gap"), then: { required: ["gap_reason"] }, else: absent("gap_reason") },
    { if: selected("source_type", "unavailable"), then: { properties: { phase: { const: "coverage-gap" } } } },
    { if: selected("confidence", "uncertain"), then: { required: ["note"] } },
    { if: { required: ["relation"] }, then: { required: ["related_sequence"], properties: { source_type: { const: "ledger-record" } }, not: selected("phase", "link-correction") } },
  )
  return rules
}

/** Do not use additionalProperties:false in an operation alternative: the host
 * can strip unknown fields before Loom can reject a forged authority claim.
 * propertyNames expresses the same closed envelope without destructive decoding.
 * Hosts that omit this JSON Schema keyword still reach runtime validation. */
export function operationInputSchema(name: string, input: Record<string, unknown>): Record<string, unknown> {
  const operations = contracts[name]
  if (!operations) {
    const requirements: Record<string, unknown>[] = Object.entries(operationRequirements[name] ?? {}).map(([operation, required]) => ({
      if: selected("operation", operation), then: { required },
    }))
    if (name === "context") requirements.push(
      depends("node_id", "action_id"),
      { if: selected("clear", true), then: absent("action_id", "node_id", "mode", "handoff_id") },
      { if: selected("mode", "independent"), then: { properties: { handoff_id: { type: "null" } } } },
    )
    if (name === "trends") requirements.push({
      if: selected("population", "selected"), then: { required: ["objective_ids"], properties: { objective_ids: { minItems: 1 } } },
      else: { properties: { objective_ids: { maxItems: 0 } } },
    })
    return requirements.length ? { ...input, allOf: [...(input.allOf as unknown[] ?? []), ...requirements] } : input
  }
  const properties = input.properties as Record<string, unknown>
  return {
    ...input, additionalProperties: true,
    oneOf: Object.entries(operations).map(([operation, rule]) => ({
      // Optional field types live once in the root. Repeat only requirements so
      // Code Mode can render the discriminated alternatives without duplicating
      // every selector and boundary in the public callable signature.
      type: "object", properties: Object.fromEntries(["operation", ...rule.required].map(field => [field,
        field === "operation" ? { const: operation, description: rule.hint } : properties[field]])),
      required: ["operation", ...rule.required], additionalProperties: true,
      propertyNames: { enum: rule.fields },
      ...(combinations(name, operation).length ? { allOf: combinations(name, operation) } : {}),
    })),
  }
}

/** Only request syntax is diagnosed here. Never inspect stored identities or
 * echo caller-supplied keys/values into a public validation error. */
export function validateOperationInput(name: string, input: Record<string, unknown>, schema: Record<string, unknown>): void {
  const properties = schema.properties as Record<string, unknown>
  const operationSchema = properties.operation as { enum?: string[] } | undefined
  if (operationSchema && input.operation === undefined)
    throw new Error(`loom_${name} requires operation. Choose: ${operationSchema.enum?.join(", ")}.`)
  const operations = contracts[name]
  if (!operations) return
  const operation = typeof input.operation === "string" ? input.operation : ""
  const rule = Object.hasOwn(operations, operation) ? operations[operation] : undefined
  if (!rule) throw new Error(`Unsupported ${name} operation. Choose: ${Object.keys(operations).join(", ")}.`)
  const missing = rule.required.filter(key => input[key] === undefined)
  if (missing.length) throw new Error(`loom_${name} ${operation} requires ${missing.join(", ")}. ${rule.hint}`)
  if (Object.keys(input).some(key => !rule.fields.includes(key)))
    throw new Error(`Unsupported ${name} operation field. ${rule.hint} Allowed fields: ${rule.fields.join(", ")}.`)
  if (name === "history" && operation === "preview-population" && !object(input.selection))
    throw new Error("loom_history preview-population requires selection: {objective_id, question}. Start without boundary fields; use the returned selection for continuation.")
}
