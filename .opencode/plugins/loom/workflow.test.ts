import { describe, expect, test } from "bun:test"
import { buildSteps, preserveCompleted, runnable, type Workflow } from "./workflow"

describe("Loom routing DAG", () => {
  test("simple implementation routes directly to worker then reviewer", () => {
    const steps = buildSteps({
      humanFacing: false,
      behavioral: false,
      structural: false,
      externalUnknown: false,
      diagnostic: false,
      productOutcome: false,
    })

    expect(steps.map((step) => step.id)).toEqual(["worker", "review-implementation"])

    const workflow: Workflow = {
      id: "w",
      anchor: "anchor",
      createdBySession: "s",
      createdAt: "now",
      steps,
    }

    expect(runnable(workflow).map((step) => step.id)).toEqual(["worker"])
  })

  test("product change requires specialists, reviews, and two Critic boundaries", () => {
    const steps = buildSteps({
      humanFacing: true,
      behavioral: true,
      structural: true,
      externalUnknown: true,
      diagnostic: false,
      productOutcome: true,
    })

    expect(steps.map((step) => step.id)).toEqual([
      "research",
      "designer",
      "specifier",
      "review-think",
      "architect",
      "review-architecture",
      "critic-solution",
      "worker",
      "review-implementation",
      "critic-final",
    ])

    const workflow: Workflow = {
      id: "w",
      anchor: "anchor",
      createdBySession: "s",
      createdAt: "now",
      steps,
    }

    expect(runnable(workflow).map((step) => step.id).sort()).toEqual([
      "designer",
      "research",
      "specifier",
    ])
  })

  test("review cannot run before its producer dependencies complete", () => {
    const steps = buildSteps({
      humanFacing: true,
      behavioral: true,
      structural: false,
      externalUnknown: false,
      diagnostic: false,
      productOutcome: false,
    })
    const workflow: Workflow = {
      id: "w",
      anchor: "anchor",
      createdBySession: "s",
      createdAt: "now",
      steps,
    }

    expect(runnable(workflow).some((step) => step.id === "review-think")).toBe(false)

    for (const id of ["designer", "specifier"]) {
      const step = workflow.steps.find((candidate) => candidate.id === id)!
      step.status = "complete"
    }

    expect(runnable(workflow).map((step) => step.id)).toEqual(["review-think"])
  })

  test("route reclassification preserves valid completed diagnosis", () => {
    const previous = buildSteps({
      humanFacing: false,
      behavioral: false,
      structural: false,
      externalUnknown: false,
      diagnostic: true,
      productOutcome: false,
    })
    previous.find((step) => step.id === "diagnostic")!.status = "complete"
    previous.find((step) => step.id === "diagnostic")!.summary = "confirmed structural defect"

    const next = buildSteps({
      humanFacing: false,
      behavioral: false,
      structural: true,
      externalUnknown: false,
      diagnostic: true,
      productOutcome: false,
    })

    preserveCompleted(previous, next)

    expect(next.find((step) => step.id === "diagnostic")?.status).toBe("complete")
    expect(next.find((step) => step.id === "diagnostic")?.summary).toBe("confirmed structural defect")
  })
})
