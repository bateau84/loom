import { createHash } from "node:crypto"
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
  attempt?: number
  summary?: string
  task?: TaskSpec
}

export type WorkLevel = "objective" | "wave"
export type ExecutionDepth = "task" | "change" | "objective"

export type Effects = {
  humanFacing: boolean
  behavioral: boolean
  structural: boolean
  externalUnknown: boolean
  diagnostic: boolean
  productOutcome: boolean
  implementationRequested?: boolean
  workLevel?: WorkLevel
  /** Internal: workLevel was omitted by General and is resolved from persistent work after planning. */
  workLevelAuto?: boolean
  executionDepth?: ExecutionDepth
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

export type WorkflowCancellation = {
  at: string
  byAgent: "general"
  bySessionId: string
  reason: string
  confirmation: string
  releasedClaimIds: string[]
  retainedForeignClaimIds: string[]
  workMissing: boolean
  revokedGrantIds: string[]
}

export class WorkflowCancelledError extends Error {
  constructor(workflowId: string) {
    super(`Workflow ${workflowId} is cancelled. Start a new workflow; cancelled execution cannot resume.`)
    this.name = "WorkflowCancelledError"
  }
}

export function assertWorkflowNotCancelled(workflow: Workflow) {
  if (workflow.cancellation) throw new WorkflowCancelledError(workflow.id)
}

export type Workflow = {
  id: string
  projectId: string
  revision: number
  anchor: string
  request?: string
  createdBySession: string
  createdAt: string
  cancellation?: WorkflowCancellation
  effects?: Effects
  work?: {
    objectiveId: string
    generation: number
    /** Plan revision visible when this executable Task DAG was compiled (display/audit only). */
    taskPlanRevision?: number
    /** Semantic fingerprint of this workflow's exact Task/Wave contracts. */
    taskPlanFingerprint?: string
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
  if (workflow.cancellation) return []
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

export function resolveExecutionDepth(effects: Effects): ExecutionDepth {
  const requested = effects.executionDepth ?? (effects.productOutcome ? "objective" : "change")
  const implementationRequested = effects.implementationRequested ?? true

  if (requested === "objective" && !effects.productOutcome) {
    throw new Error("Objective execution depth requires productOutcome=true.")
  }
  if (requested === "objective" && !implementationRequested) {
    throw new Error("Objective execution depth requires implementationRequested=true.")
  }

  // Task depth is intentionally shallow. If the route says new user-facing,
  // behavioral, or structural authority is actually unresolved, the work has
  // already earned Change depth and must not bypass that authority.
  if (
    requested === "task" &&
    (effects.humanFacing || effects.behavioral || effects.structural)
  ) {
    return "change"
  }

  return requested
}

export function executionDepthRank(depth: ExecutionDepth) {
  return depth === "task" ? 0 : depth === "change" ? 1 : 2
}

export function buildSteps(effects: Effects): Step[] {
  const steps: Step[] = []
  const think: string[] = []
  const executionDepth = resolveExecutionDepth(effects)
  const implementationRequested = effects.implementationRequested ?? true
  const workLevel: WorkLevel = effects.workLevel ?? "objective"
  const objectiveClosure =
    executionDepth === "objective" &&
    effects.productOutcome &&
    workLevel === "objective"

  // Small, already-bounded work gets the shortest safe path. Diagnosis and
  // bounded research are allowed without turning the request into a product
  // lifecycle. Read-only Tasks end at Reviewer; mutation Tasks use Worker
  // followed by independent implementation review.
  if (executionDepth === "task") {
    if (effects.diagnostic) {
      steps.push(work("diagnostic", "diagnostic"))
      think.push("diagnostic")
    }
    if (effects.externalUnknown) {
      steps.push(work("research", "research"))
      think.push("research")
    }

    if (!implementationRequested) {
      steps.push(gate("review-task", "reviewer", think))
      return steps
    }

    steps.push(work("worker", "worker", think))
    steps.push(gate("review-implementation", "reviewer", ["worker"]))
    return steps
  }

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

  // Change depth is for substantial but still bounded work. It uses only the
  // authority earned by the evidence. Read-only Change work stops after the
  // relevant independent authority review; mutation work then implements.
  if (executionDepth === "change") {
    if (!implementationRequested) {
      if (steps.length === 0) {
        steps.push(gate("review-task", "reviewer"))
      }
      return steps
    }

    steps.push(work("worker", "worker", lastThink))
    steps.push(gate("review-implementation", "reviewer", ["worker"]))

    if (effects.structural) {
      steps.push(work("knowledge-sync", "documenter", ["review-implementation"]))
    }
    return steps
  }

  // Objective depth preserves the full product lifecycle. Planner first
  // compiles the persistent semantic Plan plus one executable Wave DAG.
  // Reviewer then independently checks that Plan/DAG before any Wave claim
  // or Worker can become runnable.
  steps.push(gate("critic-solution", "critic", lastThink))
  lastThink = ["critic-solution"]
  steps.push(work("plan", "planner", lastThink))
  steps.push(gate("review-plan", "reviewer", ["plan"]))
  steps.push(gate("review-implementation", "reviewer", ["review-plan"]))

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
    if (old) step.attempt = (old.attempt ?? 0) + 1
    const sameDependencies =
      old?.dependsOn.length === step.dependsOn.length &&
      old.dependsOn.every((dependency, index) => dependency === step.dependsOn[index])

    if (
      old?.agent === step.agent &&
      old.kind === step.kind &&
      sameDependencies &&
      satisfied(old)
    ) {
      step.attempt = old.attempt
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
  assertWorkflowNotCancelled(workflow)
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
  assertWorkflowNotCancelled(workflow)
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
      step.attempt = (step.attempt ?? 0) + 1
      step.status = "pending"
      delete step.summary
    }
  }

  return [...affected]
}


export function plannedTaskSteps(workflow: Workflow) {
  return workflow.steps.filter((step) => step.id.startsWith("task:") && step.task)
}

export function executableTaskPlanFingerprint(workflow: Workflow) {
  const tasks = plannedTaskSteps(workflow)
    .map((step) => ({
      stepId: step.id,
      dependsOn: [...step.dependsOn],
      task: step.task,
    }))
    .sort((a, b) => a.stepId.localeCompare(b.stepId))
  if (tasks.length === 0) return undefined
  return createHash("sha256").update(JSON.stringify(tasks)).digest("hex")
}

export function applyTaskPlan(workflow: Workflow, tasks: TaskSpec[]) {
  const plan = workflow.steps.find((step) => step.id === "plan")
  if (!plan) throw new Error("Workflow has no planning step.")
  if (plan.status !== "pending") throw new Error("Planning step must be pending before replacing the task graph.")

  const existing = plannedTaskSteps(workflow)
  if (existing.some((step) => step.status !== "pending")) {
    throw new Error("Task graph cannot change after task execution has started.")
  }

  // New Objective workflows place an independent Plan review between
  // planning and execution. Legacy/in-flight workflows may not have that
  // gate yet, so retain their historical dependency on plan.
  const executionGateId = workflow.steps.some((step) => step.id === "review-plan")
    ? "review-plan"
    : "plan"
  const taskSteps: Step[] = tasks.map((task) => ({
    id: taskStepId(task.id),
    agent: "worker",
    kind: "work",
    dependsOn: [executionGateId, ...task.dependsOn.map(taskStepId)],
    status: "pending",
    task,
    attempt: (existing.find((step) => step.id === taskStepId(task.id))?.attempt ?? -1) + 1,
  }))

  const withoutTasks = workflow.steps.filter((step) => !step.id.startsWith("task:"))
  const insertionIndex = withoutTasks.findIndex((step) => step.id === executionGateId)
  workflow.steps = [
    ...withoutTasks.slice(0, insertionIndex + 1),
    ...taskSteps,
    ...withoutTasks.slice(insertionIndex + 1),
  ]

  const review = workflow.steps.find((step) => step.id === "review-implementation")
  if (!review) throw new Error("Workflow has no implementation review step.")
  review.dependsOn = taskSteps.map((step) => step.id)

  return taskSteps
}
