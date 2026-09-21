import { taskStepId, type TaskSpec } from "./tasks"
import type { EvidenceKind } from "./evidence"

export type StepKind = "work" | "gate"
export type StepStatus = "pending" | "complete" | "passed" | "failed"

export type Step = {
  id: string
  agent: string
  kind: StepKind
  dependsOn: string[]
  status: StepStatus
  summary?: string
  task?: TaskSpec
}

export type WorkLevel = "objective" | "wave"

export type Effects = {
  humanFacing: boolean
  behavioral: boolean
  structural: boolean
  externalUnknown: boolean
  diagnostic: boolean
  productOutcome: boolean
  workLevel?: WorkLevel
}

export type VerificationRequirementStatus = "open" | "satisfied" | "superseded"

export type VerificationRequirement = {
  id: string
  createdByStepId: string
  createdByAgent: string
  beforeStepId: string
  kind: EvidenceKind
  statement: string
  status: VerificationRequirementStatus
  createdAt: string
  proof?: {
    byAgent: string
    stepId?: string
    statement: string
    observationIds: string[]
    provedAt: string
  }
}

export type Workflow = {
  id: string
  anchor: string
  createdBySession: string
  createdAt: string
  effects?: Effects
  work?: {
    objectiveId: string
    generation: number
  }
  steps: Step[]
  verification?: VerificationRequirement[]
}

export function satisfied(step: Step) {
  return step.kind === "gate" ? step.status === "passed" : step.status === "complete"
}

function stepDependsOn(workflow: Workflow, targetId: string, sourceId: string, seen = new Set<string>()): boolean {
  if (targetId === sourceId) return true
  if (seen.has(targetId)) return false
  seen.add(targetId)

  const target = workflow.steps.find((step) => step.id === targetId)
  if (!target) return false
  return target.dependsOn.some((dependency) => stepDependsOn(workflow, dependency, sourceId, seen))
}

function verificationList(workflow: Workflow) {
  if (!workflow.verification) workflow.verification = []
  return workflow.verification
}

export function openVerificationRequirements(workflow: Workflow, beforeStepId?: string) {
  return verificationList(workflow).filter(
    (requirement) =>
      requirement.status === "open" &&
      (beforeStepId === undefined || requirement.beforeStepId === beforeStepId),
  )
}

export function addVerificationRequirement(
  workflow: Workflow,
  input: {
    id: string
    createdByStepId: string
    createdByAgent: string
    beforeStepId: string
    kind: EvidenceKind
    statement: string
    now: string
  },
) {
  const creator = workflow.steps.find((step) => step.id === input.createdByStepId)
  if (!creator) throw new Error("Verification creator step not found.")
  if (creator.agent !== input.createdByAgent) {
    throw new Error(`Step ${input.createdByStepId} belongs to ${creator.agent}, not ${input.createdByAgent}.`)
  }

  const gate = workflow.steps.find((step) => step.id === input.beforeStepId)
  if (!gate) throw new Error("Verification target gate not found.")
  if (gate.kind !== "gate") throw new Error("Verification requirements must target a gate.")
  if (!stepDependsOn(workflow, input.beforeStepId, input.createdByStepId)) {
    throw new Error("Verification target gate must be downstream of the creating step.")
  }

  const existing = verificationList(workflow).find(
    (requirement) =>
      requirement.status !== "superseded" &&
      requirement.createdByStepId === input.createdByStepId &&
      requirement.beforeStepId === input.beforeStepId &&
      requirement.kind === input.kind &&
      requirement.statement === input.statement,
  )
  if (existing) return existing

  const requirement: VerificationRequirement = {
    id: input.id,
    createdByStepId: input.createdByStepId,
    createdByAgent: input.createdByAgent,
    beforeStepId: input.beforeStepId,
    kind: input.kind,
    statement: input.statement,
    status: "open",
    createdAt: input.now,
  }
  verificationList(workflow).push(requirement)
  return requirement
}

export function proveVerificationRequirement(
  workflow: Workflow,
  requirementId: string,
  proof: NonNullable<VerificationRequirement["proof"]>,
) {
  const requirement = verificationList(workflow).find((candidate) => candidate.id === requirementId)
  if (!requirement) throw new Error("Verification requirement not found.")
  if (requirement.status === "superseded") throw new Error("Verification requirement is superseded.")

  requirement.status = "satisfied"
  requirement.proof = proof
  return requirement
}

export function reconcileVerificationAfterRoute(workflow: Workflow) {
  const stepIds = new Set(workflow.steps.map((step) => step.id))
  for (const requirement of verificationList(workflow)) {
    if (
      requirement.status !== "superseded" &&
      (!stepIds.has(requirement.createdByStepId) || !stepIds.has(requirement.beforeStepId))
    ) {
      requirement.status = "superseded"
      delete requirement.proof
    }
  }
}

export function resetVerificationAfterReopen(workflow: Workflow, resetStepIds: string[]) {
  const reset = new Set(resetStepIds)
  for (const requirement of verificationList(workflow)) {
    if (reset.has(requirement.createdByStepId)) {
      requirement.status = "superseded"
      delete requirement.proof
      continue
    }

    if (
      requirement.status === "satisfied" &&
      (reset.has(requirement.beforeStepId) || (requirement.proof?.stepId && reset.has(requirement.proof.stepId)))
    ) {
      requirement.status = "open"
      delete requirement.proof
    }
  }
}

export function runnable(workflow: Workflow) {
  const done = new Set(workflow.steps.filter(satisfied).map((step) => step.id))
  return workflow.steps.filter(
    (step) => step.status === "pending" && step.dependsOn.every((dependency) => done.has(dependency)),
  )
}

function work(id: string, agent: string, dependsOn: string[] = []): Step {
  return { id, agent, kind: "work", dependsOn, status: "pending" }
}

function gate(id: string, agent: string, dependsOn: string[] = []): Step {
  return { id, agent, kind: "gate", dependsOn, status: "pending" }
}

export function buildSteps(effects: Effects): Step[] {
  const steps: Step[] = []
  const think: string[] = []
  const workLevel: WorkLevel = effects.workLevel ?? "objective"
  const objectiveClosure = effects.productOutcome && workLevel === "objective"

  if (effects.diagnostic) {
    steps.push(work("diagnostic", "diagnostic"))
    think.push("diagnostic")
  }
  if (effects.externalUnknown) {
    steps.push(work("research", "research"))
    think.push("research")
  }
  if (effects.humanFacing) {
    steps.push(work("designer", "designer"))
    think.push("designer")
  }
  if (effects.behavioral) {
    steps.push(work("specifier", "specifier"))
    think.push("specifier")
  }

  let lastThink = [...think]

  if (think.length > 0) {
    steps.push(gate("review-think", "reviewer", think))
    lastThink = ["review-think"]
  }

  if (effects.structural) {
    steps.push(work("architect", "architect", lastThink))
    steps.push(gate("review-architecture", "reviewer", ["architect"]))
    lastThink = ["review-architecture"]
  }

  if (effects.productOutcome) {
    steps.push(gate("critic-solution", "critic", lastThink))
    lastThink = ["critic-solution"]
  }

  if (effects.productOutcome) {
    steps.push(work("plan", "planner", lastThink))
    steps.push(gate("review-implementation", "reviewer", ["plan"]))
  } else {
    steps.push(work("worker", "worker", lastThink))
    steps.push(gate("review-implementation", "reviewer", ["worker"]))
  }

  if (effects.productOutcome || effects.structural) {
    steps.push(work("knowledge-sync", "documenter", ["review-implementation"]))
  }

  if (objectiveClosure) {
    steps.push(gate("product-acceptance", "acceptance", ["review-implementation"]))
    const productReviewDeps = ["product-acceptance", "knowledge-sync"]

    if (effects.humanFacing) {
      steps.push(gate("designer-validation", "designer", ["review-implementation"]))
      productReviewDeps.push("designer-validation")
    }

    steps.push(gate("review-product", "reviewer", productReviewDeps))
    steps.push(gate("critic-final", "critic", ["review-product"]))
  }

  return steps
}

export function preserveSatisfied(previous: Step[], next: Step[]) {
  const byID = new Map(previous.map((step) => [step.id, step]))

  for (const step of next) {
    const old = byID.get(step.id)
    if (old?.agent === step.agent && old.kind === step.kind && satisfied(old)) {
      step.status = old.status
      step.summary = old.summary
    }
  }
}

export function finishStep(
  workflow: Workflow,
  stepId: string,
  agent: string,
  outcome: "complete" | "pass" | "fail",
  summary: string,
) {
  const step = workflow.steps.find((candidate) => candidate.id === stepId)
  if (!step) throw new Error("Step not found.")
  if (step.agent !== agent) throw new Error(`Step ${stepId} belongs to ${step.agent}, not ${agent}.`)

  const available = runnable(workflow).some((candidate) => candidate.id === stepId)
  if (!available) throw new Error("Step is not currently runnable.")

  if (step.kind === "gate") {
    if (outcome === "complete") throw new Error("Gate steps require pass or fail.")
    if (outcome === "pass") {
      const missing = openVerificationRequirements(workflow, stepId)
      if (missing.length > 0) {
        throw new Error(
          `Gate ${stepId} has unsatisfied verification requirements: ${missing
            .map((requirement) => `${requirement.id} (${requirement.kind}: ${requirement.statement})`)
            .join("; ")}`,
        )
      }
    }
    step.status = outcome === "pass" ? "passed" : "failed"
  } else {
    if (outcome !== "complete") throw new Error("Work steps require complete.")
    step.status = "complete"
  }

  step.summary = summary
  return step
}

export function reopenFrom(workflow: Workflow, stepId: string) {
  const target = workflow.steps.find((step) => step.id === stepId)
  if (!target) throw new Error("Step not found.")

  const affected = new Set([stepId])
  let changed = true

  while (changed) {
    changed = false
    for (const step of workflow.steps) {
      if (!affected.has(step.id) && step.dependsOn.some((dependency) => affected.has(dependency))) {
        affected.add(step.id)
        changed = true
      }
    }
  }

  for (const step of workflow.steps) {
    if (affected.has(step.id)) {
      step.status = "pending"
      delete step.summary
    }
  }

  return [...affected]
}


export function plannedTaskSteps(workflow: Workflow) {
  return workflow.steps.filter((step) => step.id.startsWith("task:") && step.task)
}

export function applyTaskPlan(workflow: Workflow, tasks: TaskSpec[]) {
  const plan = workflow.steps.find((step) => step.id === "plan")
  if (!plan) throw new Error("Workflow has no planning step.")
  if (plan.status !== "pending") throw new Error("Planning step must be pending before replacing the task graph.")

  const existing = plannedTaskSteps(workflow)
  if (existing.some((step) => step.status !== "pending")) {
    throw new Error("Task graph cannot change after task execution has started.")
  }

  const taskSteps: Step[] = tasks.map((task) => ({
    id: taskStepId(task.id),
    agent: "worker",
    kind: "work",
    dependsOn: ["plan", ...task.dependsOn.map(taskStepId)],
    status: "pending",
    task,
  }))

  const withoutTasks = workflow.steps.filter((step) => !step.id.startsWith("task:"))
  const planIndex = withoutTasks.findIndex((step) => step.id === "plan")
  workflow.steps = [
    ...withoutTasks.slice(0, planIndex + 1),
    ...taskSteps,
    ...withoutTasks.slice(planIndex + 1),
  ]

  const review = workflow.steps.find((step) => step.id === "review-implementation")
  if (!review) throw new Error("Workflow has no implementation review step.")
  review.dependsOn = taskSteps.map((step) => step.id)

  return taskSteps
}
