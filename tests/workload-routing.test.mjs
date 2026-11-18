import { test } from "node:test"
import assert from "node:assert/strict"
import { defaults, mergeConfig } from "../.test-build/config.js"
import { planModelRoutes } from "../.test-build/model-routing.js"
import { planWorkloadRoutes } from "../.test-build/workload-routing.js"

const route = (providerID, modelID, extra = {}) => ({
  providerID, modelID, enabled: true, tools: true, billing: "included", quota: "unknown",
  reasoning: ["low", "medium", "high"], ...extra,
})

function configured() {
  return mergeConfig(defaults(), {
    "model-routing": { enabled: true, "default-class": "standard",
      "default-reasoning": "medium", "provider-order": ["go", "openai"], "paid-fallback": false },
    "model-classes": {
      standard: { models: ["fast"] }, advanced: { models: ["sol"] },
      frontier: { models: ["astra"] },
    },
    agents: {
      architect: { roles: ["architecture", "planning"] },
      reviewer: { roles: ["assessment"] },
    },
    roles: {
      architecture: {
        "model-class": "standard", reasoning: "medium",
        "workload-tiers": {
          advanced: { "model-class": "advanced", reasoning: "high" },
          frontier: { "model-class": "frontier", reasoning: "high" },
        },
      },
      planning: { "model-class": "standard", reasoning: "medium" },
      assessment: {
        "model-class": "standard", reasoning: "high", "minimum-tier": "advanced",
        "workload-tiers": {
          advanced: { "model-class": "advanced", reasoning: "high" },
          frontier: { "model-class": "frontier", reasoning: "high" },
        },
      },
    },
  })
}

const inventory = [
  route("go", "fast"), route("go", "sol"), route("openai", "sol"),
  route("go", "astra"), route("openai", "astra"),
]
const assignment = (id, other = {}) => ({
  assignmentId: id, objectiveId: "objective-1", boundary: "new-assignment", riskFactors: [], ...other,
})

test("regular work reuses the agent policy and existing model-first route planner", () => {
  const c = configured()
  const regular = planWorkloadRoutes(c, "architect", inventory, assignment("normal"))
  assert.equal(regular.status, "ready")
  assert.equal(regular.decision.tier, "standard")
  assert.deepEqual(regular.decision.policy, { modelClass: "standard", reasoning: "medium" })
  assert.equal(regular.plan.selected.logicalModel, "fast")
  assert.equal(regular.plan.selected.providerID, "go")
  // The established agent-only planner is unchanged and shares no workload state.
  assert.equal(planModelRoutes(c, "architect", inventory).selected.logicalModel, "fast")
})

test("complex work escalates to its role-specific advanced class, preserving model/provider ordering", () => {
  const out = planWorkloadRoutes(configured(), "architect", [
    route("go", "fast"), route("go", "sol", { quota: "exhausted" }),
    route("openai", "sol"), route("go", "astra"),
  ], assignment("complex", { riskFactors: ["concurrency", "recovery"] }))
  assert.equal(out.status, "ready")
  assert.equal(out.decision.tier, "advanced")
  assert.equal(out.plan.selected.logicalModel, "sol")
  assert.equal(out.plan.selected.providerID, "openai")
  assert.equal(out.plan.selected.reasoning, "high")
})

test("authority/containment risks impose the frontier floor even over a cheap caller request", () => {
  const out = planWorkloadRoutes(configured(), "architect", inventory, assignment("sensitive", {
    requestedTier: "standard", riskFactors: ["authority", "containment"],
  }))
  assert.equal(out.status, "ready")
  assert.equal(out.decision.tier, "frontier")
  assert.equal(out.decision.requestedTier, "standard")
  assert.equal(out.plan.selected.logicalModel, "astra")
  assert.ok(out.decision.reasons.includes("risk:authority"))
  assert.ok(out.decision.reasons.includes("risk:containment"))
})

test("distinct assignments of one agent do not share an escalating tier or mutable configuration", () => {
  const c = configured()
  const before = structuredClone(c)
  const high = planWorkloadRoutes(c, "architect", inventory, assignment("high", {
    objectiveId: "origin-A", requestedTier: "frontier",
  }))
  const low = planWorkloadRoutes(c, "architect", inventory, assignment("low", {
    objectiveId: "origin-B",
  }))
  assert.equal(high.plan.selected.logicalModel, "astra")
  assert.equal(low.plan.selected.logicalModel, "fast")
  assert.equal(high.decision.assignmentId, "high")
  assert.equal(low.decision.assignmentId, "low")
  assert.deepEqual(c, before)
})

test("work without an eligible model at the mandated tier is unavailable, never downgraded", () => {
  const c = configured()
  const critical = assignment("no-frontier", { riskFactors: ["credentials"] })
  const noFrontier = planWorkloadRoutes(c, "architect", [route("go", "fast"), route("go", "sol")], critical)
  assert.equal(noFrontier.status, "unavailable")
  assert.equal(noFrontier.decision.tier, "frontier")
  assert.equal(noFrontier.plan.status, "unavailable")
  const noReasoning = planWorkloadRoutes(c, "architect",
    [route("go", "astra", { reasoning: ["medium"] })], critical)
  assert.equal(noReasoning.status, "unavailable")
  // Enabling the older explicit metered fallback never authorizes workload model selection.
  const paid = mergeConfig(c, { "model-routing": { "paid-fallback": true } })
  const noIncluded = planWorkloadRoutes(paid, "architect",
    [route("go", "astra", { billing: "metered" })], critical)
  assert.equal(noIncluded.status, "unavailable")
})

test("missing tier configuration fails unavailable; minimum reviewer tier cannot be silently relaxed", () => {
  const c = mergeConfig(configured(), {
    agents: { architect: { "workload-tiers": { frontier: null } } },
  })
  // A role's own tier is still available when the agent has no override.
  assert.equal(planWorkloadRoutes(c, "architect", inventory, assignment("frontier", {
    requestedTier: "frontier",
  })).status, "ready")
  const noTier = mergeConfig(defaults(), {
    "model-routing": { enabled: true, "default-class": "standard" },
    "model-classes": { standard: { models: ["fast"] } },
    agents: { coder: { roles: ["implementation"] } },
    roles: { implementation: { "model-class": "standard" } },
  })
  const p = planWorkloadRoutes(noTier, "coder", [route("go", "fast")],
    assignment("advanced-unconfigured", { requestedTier: "advanced" }))
  assert.equal(p.status, "unavailable")
  assert.equal(p.decision.tier, "advanced")
  const review = planWorkloadRoutes(configured(), "reviewer", inventory, assignment("review"))
  assert.equal(review.decision.tier, "advanced")
  assert.equal(review.plan.selected.logicalModel, "sol")
})

test("role tier conflicts fail closed unless the agent provides an explicit override", () => {
  const c = mergeConfig(configured(), {
    roles: { planning: { "workload-tiers": {
      advanced: { "model-class": "frontier", reasoning: "high" },
    } } },
  })
  assert.throws(() => planWorkloadRoutes(c, "architect", inventory, assignment("conflict", {
    requestedTier: "advanced",
  })), /conflicting role workload tier/)
  const fixed = mergeConfig(c, { agents: { architect: { "workload-tiers": {
    advanced: { "model-class": "advanced", reasoning: "high" },
  } } } })
  assert.equal(planWorkloadRoutes(fixed, "architect", inventory, assignment("fixed", {
    requestedTier: "advanced",
  })).plan.selected.logicalModel, "sol")
})

test("invalid tier declarations, malformed inputs and unsupported boundaries fail closed", () => {
  assert.throws(() => mergeConfig(defaults(), { roles: { architecture: {
    "workload-tiers": { unknown: { "model-class": "x", reasoning: "high" } },
  } }), /Unknown setting|invalid/)
  assert.throws(() => mergeConfig(defaults(), { roles: { architecture: {
    "workload-tiers": { advanced: { "model-class": "x", reasoning: "none" } },
  } }), /reasoning/)
  const c = configured()
  assert.throws(() => planWorkloadRoutes(c, "architect", inventory, assignment("bad", {
    riskFactors: ["unrecognized"],
  })), /risk factor/)
  assert.throws(() => planWorkloadRoutes(c, "architect", inventory, assignment("bad", {
    assignmentId: "../bad",
  })), /assignmentId/)
  const unsafe = planWorkloadRoutes(c, "architect", inventory, assignment("unsafe", {
    boundary: "continuation", requestedTier: "frontier",
  }))
  assert.equal(unsafe.status, "unavailable")
  assert.equal(unsafe.reason, "unsafe-boundary")
})

test("decision is bounded and reproducible after serializing its work identity", () => {
  const c = configured()
  const first = planWorkloadRoutes(c, "architect", inventory, assignment("stable-1", {
    objectiveId: "one-origin", riskFactors: ["recovery", "authority", "recovery"],
  }))
  const second = planWorkloadRoutes(c, "architect", inventory, assignment("stable-1", {
    objectiveId: "one-origin", riskFactors: ["authority", "recovery"],
  }))
  assert.equal(first.decision.id, second.decision.id)
  assert.deepEqual(first.decision, second.decision)
  assert.equal(first.decision.objectiveId, "one-origin")
  assert.ok(JSON.stringify(first.decision).length < 4096)
  assert.deepEqual(JSON.parse(JSON.stringify(first.decision)), first.decision)
})

test("routing-disabled and unknown agents leave previous behavior unchanged", () => {
  const disabled = planWorkloadRoutes(defaults(), "architect", inventory, assignment("disabled"))
  assert.equal(disabled.status, "disabled")
  assert.deepEqual(planModelRoutes(defaults(), "architect", inventory), {
    status: "disabled", candidates: [],
  })
  assert.equal(planWorkloadRoutes(configured(), "unknown", inventory, assignment("unknown")).status, "unavailable")
})
