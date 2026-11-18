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
export type WorkloadAssignment = {
  assignmentId: string
  /** Correlates corrective attempts; separate assignment IDs do not prove independent objectives. */
  objectiveId: string
  boundary: WorkloadBoundary
  riskFactors: readonly WorkloadRisk[]
  /** A preference, not billing or model permission authority. */
  requestedTier?: WorkloadTier
}

export type WorkloadDecision = {
  id: string
  schema: "loom.workload-route/v1"
  assignmentId: string
  objectiveId: string
  agentId: string
  boundary: WorkloadBoundary
  requestedTier: WorkloadTier
  tier: WorkloadTier
  riskFactors: WorkloadRisk[]
  reasons: string[]
  policy: ModelPolicy | null
  route: { providerID: string; modelID: string; reasoning: string; billing: "included" | "metered" } | null
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
  const requested = tier(assignment.requestedTier ?? "standard", "requestedTier")
  return { requested, riskFactors: [...new Set(assignment.riskFactors)].sort() as WorkloadRisk[] }
}

function decision(
  assignment: WorkloadAssignment, agentId: string, requestedTier: WorkloadTier,
  selected: WorkloadTier, factors: WorkloadRisk[], reasons: string[],
  policy: ModelPolicy | undefined, plan?: ModelPlan,
): WorkloadDecision {
  const route = plan?.status === "ready" ? {
    providerID: plan.selected.providerID,
    modelID: plan.selected.modelID,
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
    tier: selected,
    riskFactors: factors,
    reasons,
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

  let floor: WorkloadTier = "standard"
  for (const roleID of agent.roles) floor = greater(floor, config.roles[roleID]?.minimumTier ?? "standard")
  floor = greater(floor, agent.minimumTier ?? "standard")
  for (const factor of riskFactors) floor = greater(floor, risks[factor])
  const selected = greater(requested, floor)
  const reasons = [
    ...riskFactors.map(factor => `risk:${factor}`),
    ...(floor !== "standard" ? [`minimum:${floor}`] : []),
    ...(requested !== "standard" ? [`requested:${requested}`] : []),
  ]

  if (assignment.boundary === "continuation") return {
    status: "unavailable",
    reason: "unsafe-boundary",
    decision: decision(assignment, agentId, requested, selected, riskFactors, reasons, undefined),
  }

  const policy = resolveWorkloadTierPolicy(config, agentId, selected)
  if (!policy) return {
    status: "unavailable",
    reason: "tier-unconfigured",
    decision: decision(assignment, agentId, requested, selected, riskFactors, reasons, undefined),
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
  const record = decision(assignment, agentId, requested, selected, riskFactors, reasons, policy, plan)
  if (plan.status !== "ready") return {
    status: "unavailable", reason: "route-unavailable", decision: record, plan,
  }
  return { status: "ready", decision: record, plan }
}
