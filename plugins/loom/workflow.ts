export type StepKind = "work" | "gate"
export type StepStatus = "pending" | "complete" | "passed" | "failed"

export type Step = {
  id: string
  agent: string
  kind: StepKind
  dependsOn: string[]
  status: StepStatus
  summary?: string
}

export type Effects = {
  humanFacing: boolean
  behavioral: boolean
  structural: boolean
  externalUnknown: boolean
  diagnostic: boolean
  productOutcome: boolean
}

export type Workflow = {
  id: string
  anchor: string
  createdBySession: string
  createdAt: string
  effects?: Effects
  steps: Step[]
}

export function satisfied(step: Step) {
  return step.kind === "gate" ? step.status === "passed" : step.status === "complete"
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

  steps.push(work("worker", "worker", lastThink))
  steps.push(gate("review-implementation", "reviewer", ["worker"]))

  if (effects.productOutcome) {
    steps.push(gate("critic-final", "critic", ["review-implementation"]))
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
