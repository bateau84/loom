import { expect, test } from "bun:test"
import { canonical, digest, ProcessingLimitError } from "../src/model.js"
import { evaluatorMethod, parseEvaluatorMethod, parseEvaluatorPolicy, type EvaluatorMethodManifest } from "../src/evaluator-method.js"

function fixture(): EvaluatorMethodManifest {
  const ref = (locator: string) => ({ locator, sha256: "a".repeat(64) })
  const policy = (id: string) => ({ id, revision: "revision-1", sha256: "b".repeat(64) })
  return {
    format: "loom-evaluator-method/v1",
    evaluator: { agent: "evaluator", definition: ref("agents/evaluator.md@immutable-1") },
    audit_skill: { skill: "agent-run-audit", definition: ref("skills/agent-run-audit/SKILL.md@immutable-1") },
    rubric: ref("audit/rubric@immutable-1"),
    instruction_bundle: ref("audit/instruction-bundle@immutable-1"),
    result_format: "loom-evaluator-interpretation/v1",
    model: { provider_id: "scripted-provider", model_id: "fixture-only", settings: ref("model/settings@immutable-1") },
    adapter: { id: "unqualified-fixture", version: "1", profile: policy("profile") },
    source_policy: policy("same-session"),
    route_policy: policy("no-model-effects"),
  }
}

function mapping(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid test fixture path")
  return value as Record<string, unknown>
}

function parent(input: unknown, path: string[]): Record<string, unknown> {
  let current = mapping(input)
  for (const key of path.slice(0, -1)) current = mapping(current[key])
  return current
}

const leaves = [
  "evaluator.definition.locator", "evaluator.definition.sha256",
  "audit_skill.definition.locator", "audit_skill.definition.sha256",
  "rubric.locator", "rubric.sha256", "instruction_bundle.locator", "instruction_bundle.sha256",
  "model.provider_id", "model.model_id", "model.settings.locator", "model.settings.sha256",
  "adapter.id", "adapter.version", "adapter.profile.id", "adapter.profile.revision", "adapter.profile.sha256",
  "source_policy.id", "source_policy.revision", "source_policy.sha256",
  "route_policy.id", "route_policy.revision", "route_policy.sha256",
]

test("the versioned declared manifest uses the existing two-field method identity", () => {
  const input = fixture(), parsed = parseEvaluatorMethod(input), method = evaluatorMethod(parsed)
  expect(parsed).toEqual(input)
  expect(method).toEqual({ id: "evaluator/v1/" + digest(input), instruction_sha256: input.instruction_bundle.sha256 })
  expect(Object.keys(method)).toEqual(["id", "instruction_sha256"])
  expect(method).not.toHaveProperty("qualified")
  expect(parsed).not.toHaveProperty("effective_exposure")
})

test.each(leaves)("method identity changes when %s changes", field => {
  const before = fixture(), after = structuredClone(before), path = field.split("."), key = path.at(-1)!
  const container = parent(after, path), previous = container[key]
  if (typeof previous !== "string") throw new Error("Expected string leaf")
  container[key] = key === "sha256" ? "c".repeat(64) : previous + "-changed"
  expect(evaluatorMethod(after).id).not.toBe(evaluatorMethod(before).id)
  expect(evaluatorMethod(after).instruction_sha256).toBe(field === "instruction_bundle.sha256" ? "c".repeat(64) : before.instruction_bundle.sha256)
})

test("parsing copies nested inputs and preserves exact declared text", () => {
  const input = fixture()
  input.rubric.locator = "  immutable/Å/é/e\u0301  "
  const parsed = parseEvaluatorMethod(input)
  expect(parsed.rubric.locator).toBe("  immutable/Å/é/e\u0301  ")
  input.evaluator.definition.sha256 = "c".repeat(64)
  input.adapter.profile.revision = "later"
  expect(parsed.evaluator.definition.sha256).toBe("a".repeat(64))
  expect(parsed.adapter.profile.revision).toBe("revision-1")
  parsed.route_policy.id = "changed-copy"
  expect(input.route_policy.id).toBe("no-model-effects")
  const policyInput = { id: " policy ", revision: "revision-1", sha256: "b".repeat(64) }
  const policy = parseEvaluatorPolicy(policyInput)
  policyInput.revision = "later"
  expect(policy).toEqual({ id: " policy ", revision: "revision-1", sha256: "b".repeat(64) })
})

test("object key order does not change canonical identity", () => {
  const input = fixture()
  const reversed = Object.fromEntries(Object.entries(input).reverse())
  const parsed = parseEvaluatorMethod(reversed)
  expect(canonical(parsed)).toBe(canonical(input))
  expect(evaluatorMethod(parsed)).toEqual(evaluatorMethod(input))
})

const required = ["format", "evaluator", "audit_skill", "rubric", "instruction_bundle", "result_format", "model", "adapter", "source_policy", "route_policy",
  "evaluator.agent", "evaluator.definition", "audit_skill.skill", "audit_skill.definition", "model.settings", "adapter.profile", ...leaves]

test.each(required)("missing authoritative field %s rejects the manifest", field => {
  const input = fixture(), path = field.split(".")
  delete parent(input, path)[path.at(-1)!]
  expect(() => parseEvaluatorMethod(input)).toThrow()
})

const objects = ["", "evaluator", "evaluator.definition", "audit_skill", "audit_skill.definition", "rubric", "instruction_bundle",
  "model", "model.settings", "adapter", "adapter.profile", "source_policy", "route_policy"]

test.each(objects)("unknown authoritative fields in %s reject the manifest", field => {
  const input = fixture(), path = field ? field.split(".") : []
  const container = path.length ? mapping(parent(input, path)[path.at(-1)!]) : mapping(input)
  container.qualified = true
  expect(() => parseEvaluatorMethod(input)).toThrow("unsupported field")
})

test.each([
  ["format", "loom-evaluator-method/v2"],
  ["result_format", "loom-evaluator-interpretation/v2"],
  ["evaluator.agent", "reviewer"],
  ["audit_skill.skill", "retrospective"],
])("unsupported discriminator %s rejects before a method can be identified", (field, replacement) => {
  const input = fixture(), path = field.split(".")
  parent(input, path)[path.at(-1)!] = replacement
  expect(() => parseEvaluatorMethod(input)).toThrow("Unsupported")
})

test("references reject malformed hashes, sizes and credential-shaped settings", () => {
  for (const invalid of [null, false, {}, "A".repeat(64), "a".repeat(63), "a".repeat(65), "g".repeat(64)]) {
    const input = fixture()
    mapping(input.rubric).sha256 = invalid
    expect(() => parseEvaluatorMethod(input)).toThrow("SHA-256")
  }
  for (const invalid of [null, 7, "", " ", "file\u0000ref", "file\nref", "x".repeat(2001)]) {
    const input = fixture()
    mapping(input.rubric).locator = invalid
    expect(() => parseEvaluatorMethod(input)).toThrow("content locator")
  }
  for (const invalid of [null, "", "\t", "x".repeat(201)])
    expect(() => parseEvaluatorPolicy({ id: "policy", revision: invalid, sha256: "b".repeat(64) })).toThrow("policy revision")
  expect(() => parseEvaluatorMethod({ ...fixture(), model: { provider_id: "fixture", model_id: "fixture", settings: { api_key: "not-a-credential" } } })).toThrow()
  expect(() => parseEvaluatorMethod({ ...fixture(), route_policy: { ...fixture().route_policy, approved: true } })).toThrow("unsupported field")
})

test("plain-data validation rejects getters, prototypes, hidden authority, cycles and oversize input", () => {
  let invoked = false
  const getter = Object.defineProperty(fixture(), "format", { enumerable: true, get() { invoked = true; return "loom-evaluator-method/v1" } })
  expect(() => parseEvaluatorMethod(getter)).toThrow("accessors")
  expect(invoked).toBe(false)
  expect(() => parseEvaluatorMethod(Object.create(fixture()))).toThrow("plain mappings")
  const hidden = Object.defineProperty(fixture(), "approved", { value: true, enumerable: false })
  expect(() => parseEvaluatorMethod(hidden)).toThrow("unsupported field")
  const symbol = Object.assign(fixture(), { [Symbol("approval")]: true })
  expect(() => parseEvaluatorMethod(symbol)).toThrow("unsupported field")
  const cycle: Record<string, unknown> = { ...fixture() }
  cycle.self = cycle
  expect(() => parseEvaluatorMethod(cycle)).toThrow("cyclic")
  expect(() => parseEvaluatorMethod({ ...fixture(), extra: "x".repeat(32768) })).toThrow(ProcessingLimitError)
  const omitted = { ...fixture(), extra: undefined }
  expect(() => parseEvaluatorMethod(omitted)).toThrow("unsupported field")
})

test("a null-prototype JSON mapping is accepted and copied into the supported shape", () => {
  const input = Object.assign(Object.create(null), fixture())
  expect(parseEvaluatorMethod(input)).toEqual(fixture())
})
