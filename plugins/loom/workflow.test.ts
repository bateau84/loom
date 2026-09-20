import { describe, expect, test } from "bun:test"
import {
  buildSteps,
  finishStep,
  preserveSatisfied,
  reopenFrom,
  runnable,
  type Workflow,
} from "./workflow"

function workflow(steps: ReturnType<typeof buildSteps>): Workflow {
  return { id: "w", anchor: "anchor", createdBySession: "s", createdAt: "now", steps }
}

describe("Loom routing DAG", () => {
  test("simple implementation routes directly to worker then reviewer", () => {
    const w = workflow(buildSteps({
      humanFacing: false,
      behavioral: false,
      structural: false,
      externalUnknown: false,
      diagnostic: false,
      productOutcome: false,
    }))

    expect(w.steps.map((step) => step.id)).toEqual(["worker", "review-implementation"])
    expect(runnable(w).map((step) => step.id)).toEqual(["worker"])
  })

  test("product change requires specialists, reviews, and two Critic boundaries", () => {
    const w = workflow(buildSteps({
      humanFacing: true,
      behavioral: true,
      structural: true,
      externalUnknown: true,
      diagnostic: false,
      productOutcome: true,
    }))

    expect(w.steps.map((step) => step.id)).toEqual([
      "research",
      "designer",
      "specifier",
      "review-think",
      "architect",
      "review-architecture",
      "critic-solution",
      "worker",
      "review-implementation",
      "product-acceptance",
      "designer-validation",
      "review-product",
      "critic-final",
    ])
    expect(runnable(w).map((step) => step.id).sort()).toEqual(["designer", "research", "specifier"])
  })

  test("Product Acceptance and designer validation precede final product review", () => {
    const w = workflow(buildSteps({
      humanFacing: true,
      behavioral: false,
      structural: false,
      externalUnknown: false,
      diagnostic: false,
      productOutcome: true,
    }))

    finishStep(w, "designer", "designer", "complete", "design done")
    finishStep(w, "review-think", "reviewer", "pass", "think pass")
    finishStep(w, "critic-solution", "critic", "pass", "solution pass")
    finishStep(w, "worker", "worker", "complete", "built")
    finishStep(w, "review-implementation", "reviewer", "pass", "implementation pass")

    expect(runnable(w).map((step) => step.id).sort()).toEqual([
      "designer-validation",
      "product-acceptance",
    ])
  })

  test("failed review blocks downstream work", () => {
    const w = workflow(buildSteps({
      humanFacing: true,
      behavioral: true,
      structural: true,
      externalUnknown: false,
      diagnostic: false,
      productOutcome: false,
    }))

    finishStep(w, "designer", "designer", "complete", "done")
    finishStep(w, "specifier", "specifier", "complete", "done")
    finishStep(w, "review-think", "reviewer", "fail", "specifier gap")

    expect(runnable(w)).toHaveLength(0)
    expect(w.steps.find((step) => step.id === "architect")?.status).toBe("pending")
  })

  test("reopen resets only the target and its downstream dependents", () => {
    const w = workflow(buildSteps({
      humanFacing: true,
      behavioral: true,
      structural: true,
      externalUnknown: false,
      diagnostic: false,
      productOutcome: false,
    }))

    finishStep(w, "designer", "designer", "complete", "done")
    finishStep(w, "specifier", "specifier", "complete", "done")
    finishStep(w, "review-think", "reviewer", "fail", "specifier gap")

    const affected = reopenFrom(w, "specifier")
    expect(affected).toContain("specifier")
    expect(affected).toContain("review-think")
    expect(affected).toContain("architect")
    expect(w.steps.find((step) => step.id === "designer")?.status).toBe("complete")
    expect(runnable(w).map((step) => step.id)).toEqual(["specifier"])
  })

  test("route reclassification preserves satisfied diagnosis", () => {
    const previous = buildSteps({
      humanFacing: false,
      behavioral: false,
      structural: false,
      externalUnknown: false,
      diagnostic: true,
      productOutcome: false,
    })
    const old = workflow(previous)
    finishStep(old, "diagnostic", "diagnostic", "complete", "confirmed structural defect")

    const next = buildSteps({
      humanFacing: false,
      behavioral: false,
      structural: true,
      externalUnknown: false,
      diagnostic: true,
      productOutcome: false,
    })

    preserveSatisfied(previous, next)

    expect(next.find((step) => step.id === "diagnostic")?.status).toBe("complete")
    expect(next.find((step) => step.id === "diagnostic")?.summary).toBe("confirmed structural defect")
  })
})
