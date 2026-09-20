export type StepStatus = "pending" | "complete"

export type Step = {
  id: string
  agent: string
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

export function runnable(workflow: Workflow) {
  const done = new Set(workflow.steps.filter((step) => step.status === "complete").map((step) => step.id))
  return workflow.steps.filter(
    (step) => step.status === "pending" && step.dependsOn.every((dependency) => done.has(dependency)),
  )
}

export function buildSteps(effects: Effects): Step[] {
  const steps: Step[] = []
  const think: string[] = []

  if (effects.diagnostic) {
    steps.push({ id: "diagnostic", agent: "diagnostic", dependsOn: [], status: "pending" })
    think.push("diagnostic")
  }
  if (effects.externalUnknown) {
    steps.push({ id: "research", agent: "research", dependsOn: [], status: "pending" })
    think.push("research")
  }
  if (effects.humanFacing) {
    steps.push({ id: "designer", agent: "designer", dependsOn: [], status: "pending" })
    think.push("designer")
  }
  if (effects.behavioral) {
    steps.push({ id: "specifier", agent: "specifier", dependsOn: [], status: "pending" })
    think.push("specifier")
  }

  let lastThink: string[] = [...think]

  if (think.length > 0) {
    steps.push({ id: "review-think", agent: "reviewer", dependsOn: [...think], status: "pending" })
    lastThink = ["review-think"]
  }

  if (effects.structural) {
    steps.push({ id: "architect", agent: "architect", dependsOn: [...lastThink], status: "pending" })
    steps.push({
      id: "review-architecture",
      agent: "reviewer",
      dependsOn: ["architect"],
      status: "pending",
    })
    lastThink = ["review-architecture"]
  }

  if (effects.productOutcome) {
    steps.push({
      id: "critic-solution",
      agent: "critic",
      dependsOn: [...lastThink],
      status: "pending",
    })
    lastThink = ["critic-solution"]
  }

  steps.push({ id: "worker", agent: "worker", dependsOn: [...lastThink], status: "pending" })
  steps.push({
    id: "review-implementation",
    agent: "reviewer",
    dependsOn: ["worker"],
    status: "pending",
  })

  if (effects.productOutcome) {
    steps.push({
      id: "critic-final",
      agent: "critic",
      dependsOn: ["review-implementation"],
      status: "pending",
    })
  }

  return steps
}

export function preserveCompleted(previous: Step[], next: Step[]) {
  const byID = new Map(previous.map((step) => [step.id, step]))

  for (const step of next) {
    const old = byID.get(step.id)
    if (old?.agent === step.agent && old.status === "complete") {
      step.status = "complete"
      step.summary = old.summary
    }
  }
}
