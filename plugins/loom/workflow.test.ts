import { describe, expect, test } from "bun:test"
import {
  addVerificationRequirement,
  applyTaskPlan,
  buildSteps,
  finishStep,
  openVerificationRequirements,
  preserveSatisfied,
  proveVerificationRequirement,
  reopenFrom,
  resetVerificationAfterReopen,
  runnable,
  type Workflow,
} from "./workflow"

function workflow(steps: ReturnType<typeof buildSteps>): Workflow {
  return { id: "w", projectId: "project-test", revision: 0, anchor: "anchor", createdBySession: "s", createdAt: "now", steps }
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
      "plan",
      "review-implementation",
      "knowledge-sync",
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
    applyTaskPlan(w, [
      {
        id: "backend",
        title: "Backend",
        objective: "Build backend",
        dependsOn: [],
        write: ["internal/backend/**"],
        skills: ["golang"],
        verify: ["go test ./..."],
      },
      {
        id: "ui",
        title: "UI",
        objective: "Build UI",
        dependsOn: [],
        write: ["web/**"],
        skills: ["frontend"],
        verify: ["bun test"],
      },
    ])
    finishStep(w, "plan", "planner", "complete", "plan ready")
    expect(runnable(w).map((step) => step.id).sort()).toEqual(["task:backend", "task:ui"])
    finishStep(w, "task:backend", "worker", "complete", "backend built")
    finishStep(w, "task:ui", "worker", "complete", "ui built")
    finishStep(w, "review-implementation", "reviewer", "pass", "implementation pass")

    expect(runnable(w).map((step) => step.id).sort()).toEqual([
      "designer-validation",
      "knowledge-sync",
      "product-acceptance",
    ])
  })

  test("planned Worker dependencies become real workflow dependencies", () => {
    const w = workflow(buildSteps({
      humanFacing: false,
      behavioral: false,
      structural: false,
      externalUnknown: false,
      diagnostic: false,
      productOutcome: true,
    }))

    finishStep(w, "critic-solution", "critic", "pass", "solution pass")
    applyTaskPlan(w, [
      {
        id: "db",
        title: "Database",
        objective: "Create persistence",
        dependsOn: [],
        write: ["internal/db/**"],
        skills: ["database"],
        verify: ["go test ./..."],
      },
      {
        id: "api",
        title: "API",
        objective: "Build API",
        dependsOn: ["db"],
        write: ["internal/api/**"],
        skills: ["golang"],
        verify: ["go test ./..."],
      },
    ])
    finishStep(w, "plan", "planner", "complete", "plan ready")

    expect(runnable(w).map((step) => step.id)).toEqual(["task:db"])
    finishStep(w, "task:db", "worker", "complete", "db done")
    expect(runnable(w).map((step) => step.id)).toEqual(["task:api"])
  })

  test("structural maintenance receives knowledge sync even without full product acceptance", () => {
    const w = workflow(buildSteps({
      humanFacing: false,
      behavioral: false,
      structural: true,
      externalUnknown: false,
      diagnostic: false,
      productOutcome: false,
    }))

    finishStep(w, "architect", "architect", "complete", "architecture updated")
    finishStep(w, "review-architecture", "reviewer", "pass", "architecture pass")
    finishStep(w, "worker", "worker", "complete", "implementation done")
    finishStep(w, "review-implementation", "reviewer", "pass", "implementation pass")

    expect(runnable(w).map((step) => step.id)).toEqual(["knowledge-sync"])
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

  test("verification requirements mechanically block a downstream gate until proven", () => {
    const w = workflow(buildSteps({
      humanFacing: false,
      behavioral: false,
      structural: true,
      externalUnknown: false,
      diagnostic: false,
      productOutcome: false,
    }))

    const requirement = addVerificationRequirement(w, {
      id: "vr-runtime",
      createdByStepId: "architect",
      createdByAgent: "architect",
      beforeStepId: "review-implementation",
      kind: "runtime",
      statement: "OpenCode V2 loads the migrated plugin and exposes Loom tools",
      now: "now",
    })

    finishStep(w, "architect", "architect", "complete", "architecture done")
    finishStep(w, "review-architecture", "reviewer", "pass", "architecture pass")
    finishStep(w, "worker", "worker", "complete", "migration done")

    expect(() =>
      finishStep(w, "review-implementation", "reviewer", "pass", "looks good"),
    ).toThrow("unsatisfied verification requirements")

    proveVerificationRequirement(w, requirement.id, {
      byAgent: "reviewer",
      stepId: "review-implementation",
      statement: "Observed isolated V2 startup with Loom tools loaded",
      observationIds: ["obs-runtime"],
      provedAt: "later",
    })

    expect(openVerificationRequirements(w, "review-implementation")).toHaveLength(0)
    finishStep(w, "review-implementation", "reviewer", "pass", "runtime proof present")
    expect(w.steps.find((step) => step.id === "review-implementation")?.status).toBe("passed")
  })

  test("reopening downstream work invalidates proof while reopening its creator supersedes the requirement", () => {
    const w = workflow(buildSteps({
      humanFacing: false,
      behavioral: false,
      structural: true,
      externalUnknown: false,
      diagnostic: false,
      productOutcome: false,
    }))

    const requirement = addVerificationRequirement(w, {
      id: "vr-test",
      createdByStepId: "architect",
      createdByAgent: "architect",
      beforeStepId: "review-implementation",
      kind: "test",
      statement: "Migration tests pass",
      now: "now",
    })
    proveVerificationRequirement(w, requirement.id, {
      byAgent: "worker",
      stepId: "worker",
      statement: "Tests passed",
      observationIds: ["obs-test"],
      provedAt: "later",
    })

    const resetWorker = reopenFrom(w, "worker")
    resetVerificationAfterReopen(w, resetWorker)
    expect(requirement.status).toBe("open")
    expect(requirement.proof).toBeUndefined()

    const resetArchitect = reopenFrom(w, "architect")
    resetVerificationAfterReopen(w, resetArchitect)
    expect(requirement.status).toBe("superseded")
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

  test("bounded Wave workflow omits Objective Product Acceptance and final Critic", () => {
    const w = workflow(buildSteps({
      humanFacing: false,
      behavioral: false,
      structural: false,
      externalUnknown: false,
      diagnostic: false,
      productOutcome: true,
      workLevel: "wave",
    }))

    expect(w.steps.map((step) => step.id)).toEqual([
      "critic-solution",
      "plan",
      "review-implementation",
      "knowledge-sync",
    ])
  })

})
