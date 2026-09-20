import type { EvidenceClaim } from "./evidence"

export type AcceptanceOutcome = "pending" | "passed" | "failed" | "unproven"

export type AcceptanceScenario = {
  id: string
  title: string
  criteria: string[]
  outcome: AcceptanceOutcome
  evidenceClaimIds: string[]
  note?: string
  recordedBy?: string
  recordedAt?: string
}

export type AcceptancePlan = {
  workflowId: string
  createdBy: string
  createdAt: string
  scenarios: AcceptanceScenario[]
}

export function createAcceptancePlan(input: {
  workflowId: string
  createdBy: string
  scenarios: Array<{ id: string; title: string; criteria: string[] }>
  now: string
}): AcceptancePlan {
  if (input.scenarios.length === 0) {
    throw new Error("Product Acceptance requires at least one scenario.")
  }

  const ids = input.scenarios.map((scenario) => scenario.id)
  if (new Set(ids).size !== ids.length) {
    throw new Error("Product Acceptance scenario ids must be unique.")
  }

  const scenarios = input.scenarios.map((scenario) => {
    if (!scenario.id.trim() || !scenario.title.trim()) {
      throw new Error("Product Acceptance scenario id and title are required.")
    }
    const criteria = [...new Set(scenario.criteria.map((item) => item.trim()).filter(Boolean))]
    if (criteria.length === 0) {
      throw new Error(`Scenario ${scenario.id} must map to at least one accepted criterion.`)
    }

    return {
      id: scenario.id,
      title: scenario.title,
      criteria,
      outcome: "pending" as const,
      evidenceClaimIds: [],
    }
  })

  return {
    workflowId: input.workflowId,
    createdBy: input.createdBy,
    createdAt: input.now,
    scenarios,
  }
}

export function acceptanceReadiness(plan: AcceptancePlan) {
  if (plan.scenarios.some((scenario) => scenario.outcome === "failed")) return "failed" as const
  if (plan.scenarios.some((scenario) => scenario.outcome === "unproven")) return "unproven" as const
  if (plan.scenarios.some((scenario) => scenario.outcome === "pending")) return "pending" as const
  return "passed" as const
}

export function recordAcceptanceResult(input: {
  plan: AcceptancePlan
  scenarioId: string
  outcome: Exclude<AcceptanceOutcome, "pending">
  claims: EvidenceClaim[]
  byAgent: string
  note: string
  now: string
}) {
  const scenario = input.plan.scenarios.find((candidate) => candidate.id === input.scenarioId)
  if (!scenario) throw new Error("Product Acceptance scenario not found.")

  if (scenario.outcome !== "pending") {
    throw new Error("Product Acceptance scenario already has a result; reopen/reset before replacing it.")
  }

  if (input.outcome === "passed") {
    if (input.claims.length === 0) {
      throw new Error("Passing Product Acceptance requires observed evidence claims.")
    }
    if (input.claims.some((claim) => claim.kind !== "product-acceptance")) {
      throw new Error("Passing Product Acceptance requires product-acceptance evidence claims.")
    }
    if (input.claims.some((claim) => claim.workflowId !== input.plan.workflowId)) {
      throw new Error("Product Acceptance evidence must belong to the same workflow.")
    }
    if (input.claims.some((claim) => claim.stepId !== "product-acceptance")) {
      throw new Error("Product Acceptance evidence must be produced by the product-acceptance step.")
    }
  }

  scenario.outcome = input.outcome
  scenario.evidenceClaimIds = [...new Set(input.claims.map((claim) => claim.id))]
  scenario.note = input.note
  scenario.recordedBy = input.byAgent
  scenario.recordedAt = input.now
  return scenario
}

export function resetAcceptance(plan: AcceptancePlan) {
  for (const scenario of plan.scenarios) {
    scenario.outcome = "pending"
    scenario.evidenceClaimIds = []
    delete scenario.note
    delete scenario.recordedBy
    delete scenario.recordedAt
  }
  return plan
}
