import { canonical, digest, ProcessingBudget } from "./model.js"
import type { EvaluationMethod } from "./evaluation-store.js"

export type EvaluatorContentRef = { locator: string; sha256: string }
export type EvaluatorPolicyRef = { id: string; revision: string; sha256: string }
export type EvaluatorMethodManifest = {
  format: "loom-evaluator-method/v1"
  evaluator: { agent: "evaluator"; definition: EvaluatorContentRef }
  audit_skill: { skill: "agent-run-audit"; definition: EvaluatorContentRef }
  rubric: EvaluatorContentRef
  instruction_bundle: EvaluatorContentRef
  result_format: "loom-evaluator-interpretation/v1"
  model: { provider_id: string; model_id: string; settings: EvaluatorContentRef }
  adapter: { id: string; version: string; profile: EvaluatorPolicyRef }
  source_policy: EvaluatorPolicyRef
  route_policy: EvaluatorPolicyRef
}

// These bounds count canonical JSON characters, not bytes, tokens or model cost.
const budget = () => new ProcessingBudget(32768, 256)

function object(value: unknown, keys: string[], label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)
      || ![Object.prototype, null].includes(Object.getPrototypeOf(value)))
    throw new Error(`Invalid evaluator ${label}: expected a plain object`)
  for (const key of Reflect.ownKeys(value)) {
    const field = Object.getOwnPropertyDescriptor(value, key)
    if (typeof key !== "string" || !keys.includes(key) || !field?.enumerable || !("value" in field))
      throw new Error(`Invalid evaluator ${label}: unsupported field`)
  }
  for (const key of keys) if (!Object.hasOwn(value, key)) throw new Error(`Invalid evaluator ${label}: ${key} is required`)
  return value as Record<string, unknown>
}

function text(value: unknown, label: string, maximum = 200): string {
  if (typeof value !== "string" || !value.trim() || value.length > maximum || /[\u0000-\u001f\u007f]/.test(value))
    throw new Error(`Invalid evaluator ${label}`)
  return value
}

function hash(value: unknown): string {
  if (typeof value !== "string" || !/^[a-f0-9]{64}$/.test(value)) throw new Error("Invalid evaluator SHA-256")
  return value
}

function content(value: unknown): EvaluatorContentRef {
  const ref = object(value, ["locator", "sha256"], "content reference")
  return { locator: text(ref.locator, "content locator", 2000), sha256: hash(ref.sha256) }
}

function policy(value: unknown): EvaluatorPolicyRef {
  const ref = object(value, ["id", "revision", "sha256"], "policy reference")
  return { id: text(ref.id, "policy ID"), revision: text(ref.revision, "policy revision"), sha256: hash(ref.sha256) }
}

/** A declared reference does not prove policy authority, availability or approval. */
export function parseEvaluatorPolicy(input: unknown): EvaluatorPolicyRef {
  canonical(input, budget())
  return policy(input)
}

/** Validate declared inputs only. No content is fetched and no effective exposure is attested. */
export function parseEvaluatorMethod(input: unknown): EvaluatorMethodManifest {
  canonical(input, budget())
  const value = object(input, ["format", "evaluator", "audit_skill", "rubric", "instruction_bundle", "result_format",
    "model", "adapter", "source_policy", "route_policy"], "method manifest")
  if (value.format !== "loom-evaluator-method/v1" || value.result_format !== "loom-evaluator-interpretation/v1")
    throw new Error("Unsupported evaluator method or result format")
  const evaluator = object(value.evaluator, ["agent", "definition"], "agent")
  const skill = object(value.audit_skill, ["skill", "definition"], "audit skill")
  if (evaluator.agent !== "evaluator" || skill.skill !== "agent-run-audit")
    throw new Error("Unsupported Evaluator agent or Agent Run Audit skill")
  const model = object(value.model, ["provider_id", "model_id", "settings"], "model")
  const adapter = object(value.adapter, ["id", "version", "profile"], "adapter")
  return {
    format: "loom-evaluator-method/v1",
    evaluator: { agent: "evaluator", definition: content(evaluator.definition) },
    audit_skill: { skill: "agent-run-audit", definition: content(skill.definition) },
    rubric: content(value.rubric),
    instruction_bundle: content(value.instruction_bundle),
    result_format: "loom-evaluator-interpretation/v1",
    model: { provider_id: text(model.provider_id, "provider ID"), model_id: text(model.model_id, "model ID"), settings: content(model.settings) },
    adapter: { id: text(adapter.id, "adapter ID"), version: text(adapter.version, "adapter version"), profile: policy(adapter.profile) },
    source_policy: policy(value.source_policy),
    route_policy: policy(value.route_policy),
  }
}

/** Local identity of declared inputs; admission must establish the effective method separately. */
export function evaluatorMethod(input: EvaluatorMethodManifest): EvaluationMethod {
  const manifest = parseEvaluatorMethod(input)
  return { id: "evaluator/v1/" + digest(manifest, budget()), instruction_sha256: manifest.instruction_bundle.sha256 }
}
