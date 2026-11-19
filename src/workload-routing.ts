import { digest } from "./model.js"
import type { Config, WorkloadTier } from "./config.js"
import {
  planModelRoutes, resolveWorkloadTierPolicy, type ModelPlan, type ModelPolicy, type RouteInventory,
} from "./model-routing.js"

/**
 * Provider-free, explicitly invoked policy. No hook invokes this at runtime, and
 * its record cannot authorize billing, spending, permissions, or a Session switch.
 */
export type WorkloadRisk = "complex" | "authority" | "containment" | "credentials"
  | "concurrency" | "persistence" | "recovery"
export type WorkloadBoundary = "new-assignment" | "safe-next-phase" | "continuation"
export type WorkloadAssessment = {
  /** Explicitly assessed low risk differs from absent or uncertain assessment. */
  status: "assessed" | "uncertain"
  confidence: "high" | "medium" | "low"
  /** Source correlation only. Model-authored text is not proof of authority. */
  sourceRef: string
}
export type WorkloadQuality = {
  minimumTier: WorkloadTier
  minimumReasoning: "low" | "medium" | "high"
  /** This obligation is carried, NOT fulfilled by choosing a different model. */
  independence: "required" | "not-required"
}
export type WorkloadAssignment = {
  assignmentId: string
  /** Correlates corrective attempts; separate assignment IDs do not prove independent objectives. */
  objectiveId: string
  boundary: WorkloadBoundary
  riskFactors: readonly WorkloadRisk[]
  assessment?: WorkloadAssessment
  quality?: WorkloadQuality
  /** This policy-only milestone accepts included-only routing, never paid authorization. */
  spending: "included-only"
  /** Preferences may raise reasoning; they cannot lower accepted quality floors. */
  requestedTier?: WorkloadTier
  requestedReasoning?: "low" | "medium" | "high"
}

export type WorkloadDecision = {
  id: string
  schema: "loom.workload-route/v1"
  assignmentId: string
  objectiveId: string
  agentId: string
  boundary: WorkloadBoundary
  requestedTier: WorkloadTier
  requestedReasoning: "low" | "medium" | "high" | null
  tier: WorkloadTier
  assessment: WorkloadAssessment
  quality: WorkloadQuality
  spending: "included-only"
  riskFactors: WorkloadRisk[]
  reasons: string[]
  policyVersion: string
  policy: ModelPolicy | null
  route: { providerID: string; modelID: string; accountID?: string; reasoning: string; billing: "included" | "metered" } | null
}
export type WorkloadResult =
  | { status: "disabled" }
  | { status: "unavailable"; reason: string; decision?: WorkloadDecision; plan?: ModelPlan }
  | { status: "ready"; decision: WorkloadDecision; plan: Extract<ModelPlan, { status: "ready" }> }

const rank: Record<WorkloadTier, number> = { standard: 0, advanced: 1, frontier: 2 }
const risks: Record<WorkloadRisk, WorkloadTier> = {
  complex: "advanced",
  concurrency: "advanced",
  persistence: "advanced",
  recovery: "advanced",
  authority: "frontier",
  containment: "frontier",
  credentials: "frontier",
}
const ID = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,119}$/
const effortRank = { low: 0, medium: 1, high: 2 } as const
type Effort = keyof typeof effortRank
function reasoning(value: unknown, label: string): Effort {
  if (value !== "low" && value !== "medium" && value !== "high")
    throw new Error(`LOOM_WORKLOAD_INVALID: ${label} must be low, medium or high`)
  return value
}
function stronger(first: Effort, second: Effort): Effort {
  return effortRank[first] >= effortRank[second] ? first : second
}

function tier(value: unknown, label: string): WorkloadTier {
  if (value !== "standard" && value !== "advanced" && value !== "frontier")
    throw new Error(`LOOM_WORKLOAD_INVALID: ${label} must be standard, advanced or frontier`)
  return value
}
function greater(first: WorkloadTier, second: WorkloadTier): WorkloadTier {
  return rank[first] >= rank[second] ? first : second
}
function validate(assignment: WorkloadAssignment): { requested: WorkloadTier; riskFactors: WorkloadRisk[] } {
  if (!assignment || typeof assignment !== "object" || Array.isArray(assignment))
    throw new Error("LOOM_WORKLOAD_INVALID: assignment must be a mapping")
  for (const id of ["assignmentId", "objectiveId"] as const) {
    if (typeof assignment[id] !== "string" || !ID.test(assignment[id]))
      throw new Error(`LOOM_WORKLOAD_INVALID: ${id} must be a simple 1-120 character ID`)
  }
  if (!["new-assignment", "safe-next-phase", "continuation"].includes(assignment.boundary))
    throw new Error("LOOM_WORKLOAD_INVALID: unsupported boundary")
  if (!Array.isArray(assignment.riskFactors) || assignment.riskFactors.length > 16)
    throw new Error("LOOM_WORKLOAD_INVALID: risk factors must be a bounded array")
  for (const factor of assignment.riskFactors)
    if (typeof factor !== "string" || !Object.hasOwn(risks, factor))
      throw new Error("LOOM_WORKLOAD_INVALID: unsupported risk factor")
  if (assignment.spending !== "included-only")
    throw new Error("LOOM_WORKLOAD_INVALID: spending must be included-only")
  if (assignment.requestedReasoning !== undefined)
    reasoning(assignment.requestedReasoning, "requestedReasoning")
  const assessment = assignment.assessment
  if (assessment !== undefined) {
    if (!assessment || (assessment.status !== "assessed" && assessment.status !== "uncertain")
      || !["low", "medium", "high"].includes(assessment.confidence)
      || typeof assessment.sourceRef !== "string" || !ID.test(assessment.sourceRef))
      throw new Error("LOOM_WORKLOAD_INVALID: assessment requires status, confidence and a bounded sourceRef")
  }
  const quality = assignment.quality
  if (quality !== undefined) {
    if (!quality || (quality.independence !== "required" && quality.independence !== "not-required"))
      throw new Error("LOOM_WORKLOAD_INVALID: quality independence must be declared")
    tier(quality.minimumTier, "quality.minimumTier")
    reasoning(quality.minimumReasoning, "quality.minimumReasoning")
  }
  const requested = tier(assignment.requestedTier ?? "standard", "requestedTier")
  return { requested, riskFactors: [...new Set(assignment.riskFactors)].sort() as WorkloadRisk[] }
}

function decision(
  assignment: WorkloadAssignment, agentId: string, requestedTier: WorkloadTier,
  selected: WorkloadTier, factors: WorkloadRisk[], reasons: string[],
  policy: ModelPolicy | undefined, policyVersion: string, plan?: ModelPlan,
): WorkloadDecision {
  const route = plan?.status === "ready" ? {
    providerID: plan.selected.providerID,
    modelID: plan.selected.modelID,
    ...(plan.selected.accountID ? { accountID: plan.selected.accountID } : {}),
    reasoning: plan.selected.reasoning,
    billing: plan.selected.billing,
  } : null
  const payload = {
    schema: "loom.workload-route/v1" as const,
    assignmentId: assignment.assignmentId,
    objectiveId: assignment.objectiveId,
    agentId,
    boundary: assignment.boundary,
    requestedTier,
    requestedReasoning: assignment.requestedReasoning ?? null,
    tier: selected,
    assessment: assignment.assessment!,
    quality: assignment.quality!,
    spending: "included-only" as const,
    riskFactors: factors,
    reasons,
    policyVersion,
    policy: policy ?? null,
    route,
  }
  // Bound the emitted record independently of opaque native inventory strings.
  // The receipt is deliberately small enough for review and later persistence.
  // Stable for the same exact inputs and route. A digest is correlation, NOT a
  // host-attested decision, trusted origin, account guarantee, or retained receipt.
  const record = { id: digest(payload), ...payload }
  if (Buffer.byteLength(JSON.stringify(record), "utf8") > 4096)
    throw new Error("LOOM_WORKLOAD_LIMIT: decision exceeds 4096 bytes")
  return record
}

/**
 * Select a bounded workload tier at a declared new-work boundary. This pure
 * function cannot authenticate the caller's risk/source or enforce whether
 * the boundary is genuinely new. The future native adapter must do both.
 */
export function planWorkloadRoutes(
  config: Config, agentId: string, inventory: readonly RouteInventory[], assignment: WorkloadAssignment,
): WorkloadResult {
  const { requested, riskFactors } = validate(assignment)
  if (!config.modelRouting.enabled) return { status: "disabled" }
  const agent = config.agents[agentId]
  if (!agent || !agent.enabled)
    return { status: "unavailable", reason: "agent-unavailable" }
  // Absent and low-confidence assessments are NOT assessed low risk. A caller
  // can claim a sourceRef here, but the native host must authenticate it later.
  if (!assignment.assessment || assignment.assessment.status !== "assessed"
    || assignment.assessment.confidence !== "high")
    return { status: "unavailable", reason: "assessment-unverified" }
  if (!assignment.quality) return { status: "unavailable", reason: "quality-constraints-missing" }
  const policyVersion = digest({
    routing: config.modelRouting, modelClasses: config.modelClasses,
    modelAliases: config.modelAliases, agent, roles: agent.roles.map(id => [id, config.roles[id]]),
  })
  let floor: WorkloadTier = "standard"
  for (const roleID of agent.roles) floor = greater(floor, config.roles[roleID]?.minimumTier ?? "standard")
  floor = greater(floor, agent.minimumTier ?? "standard")
  for (const factor of riskFactors) floor = greater(floor, risks[factor])
  floor = greater(floor, assignment.quality.minimumTier)
  const selected = greater(requested, floor)
  const reasons = [
    ...riskFactors.map(factor => `risk:${factor}`),
    ...(floor !== "standard" ? [`minimum:${floor}`] : []),
    ...(requested !== "standard" ? [`requested:${requested}`] : []),
    ...(assignment.quality.independence === "required" ? ["independent-review-required"] : []),
  ]

  if (assignment.boundary === "continuation") return {
    status: "unavailable",
    reason: "unsafe-boundary",
    decision: decision(assignment, agentId, requested, selected, riskFactors, reasons, undefined, policyVersion),
  }

  const selectedPolicy = resolveWorkloadTierPolicy(config, agentId, selected)
  const policy = selectedPolicy ? {
    ...selectedPolicy,
    reasoning: stronger(
      stronger(selectedPolicy.reasoning, assignment.quality.minimumReasoning),
      assignment.requestedReasoning ?? "low"),
  } : undefined
  if (!policy) return {
    status: "unavailable",
    reason: "tier-unconfigured",
    decision: decision(assignment, agentId, requested, selected, riskFactors, reasons, undefined, policyVersion),
  }

  // A workload assessment is never an explicit authorization to spend. Keep
  // this policy-only path included-only even if the legacy route config permits
  // metered candidates; real billing admission is separately BLOCKED (#206).
  const includedOnly = config.modelRouting.paidFallback
    ? { ...config, modelRouting: { ...config.modelRouting, paidFallback: false } } : config
  // The legacy agent-only router tolerates absent variant evidence. Workload
  // selection does not: an explicit capability tier requires proven reasoning.
  const proven = inventory.filter(candidate =>
    Array.isArray(candidate.reasoning) && candidate.reasoning.includes(policy.reasoning))
  const plan = planModelRoutes(includedOnly, agentId, proven, policy)
  const record = decision(assignment, agentId, requested, selected, riskFactors, reasons, policy, policyVersion, plan)
  if (plan.status !== "ready") return {
    status: "unavailable", reason: "route-unavailable", decision: record, plan,
  }
  return { status: "ready", decision: record, plan }
}
