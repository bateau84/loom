import type { OpenQuestion } from "./oq"
import { runnable, type Workflow } from "./workflow"

export type ExecutionLimits = {
  maxTotalDispatches: number
  maxDispatchesPerStep: number
  maxReviewerDispatchesPerStep: number
  maxCriticDispatchesPerStep: number
  maxExtraDispatchesPerStep: number
  maxProviderRetries: number
}

export type ProgressSignal = {
  newEvidence: boolean
  changedHypothesis: boolean
  changedStrategy: boolean
  reducedUnresolved: boolean
}

export type BudgetGrant = {
  key: string
  agent: string
  grantedBy: string
  reason: string
  progress: ProgressSignal
  grantedAt: string
}

export type BudgetState = {
  totalDispatches: number
  byKey: Record<string, number>
  seenDispatches: string[]
  grants?: BudgetGrant[]
  exhausted?: string
}

export const DEFAULT_LIMITS: ExecutionLimits = {
  maxTotalDispatches: 40,
  maxDispatchesPerStep: 3,
  maxReviewerDispatchesPerStep: 3,
  maxCriticDispatchesPerStep: 2,
  maxExtraDispatchesPerStep: 3,
  maxProviderRetries: 2,
}

export function newBudgetState(): BudgetState {
  return {
    totalDispatches: 0,
    byKey: {},
    seenDispatches: [],
    grants: [],
  }
}

function baseStepLimit(agent: string, limits: ExecutionLimits) {
  if (agent === "critic") return limits.maxCriticDispatchesPerStep
  if (agent === "reviewer") return limits.maxReviewerDispatchesPerStep
  return limits.maxDispatchesPerStep
}

function grantsForKey(state: BudgetState, key: string) {
  return (state.grants ?? []).filter((grant) => grant.key === key).length
}

export function effectiveStepLimit(
  state: BudgetState,
  key: string,
  agent: string,
  limits: ExecutionLimits,
) {
  return baseStepLimit(agent, limits) + grantsForKey(state, key)
}

export function recordDispatch(input: {
  state: BudgetState
  limits: ExecutionLimits
  dispatchID: string
  key: string
  agent: string
}) {
  const { state, limits, dispatchID, key, agent } = input

  if (state.seenDispatches.includes(dispatchID)) {
    return { allowed: true, duplicate: true, state }
  }

  if (state.totalDispatches >= limits.maxTotalDispatches) {
    state.exhausted = `total dispatch limit ${limits.maxTotalDispatches} reached`
    return { allowed: false, duplicate: false, reason: state.exhausted, state }
  }

  const current = state.byKey[key] ?? 0
  const max = effectiveStepLimit(state, key, agent, limits)

  if (current >= max) {
    state.exhausted = `dispatch limit ${max} reached for ${key}`
    return { allowed: false, duplicate: false, reason: state.exhausted, state }
  }

  state.totalDispatches++
  state.byKey[key] = current + 1
  state.seenDispatches.push(dispatchID)
  delete state.exhausted

  return { allowed: true, duplicate: false, state }
}

export type ExtraDispatchGrantResult =
  | {
      allowed: true
      grant: BudgetGrant
      previousLimit: number
      newLimit: number
      state: BudgetState
    }
  | {
      allowed: false
      reason: string
      state: BudgetState
    }

export function grantExtraDispatch(input: {
  state: BudgetState
  limits: ExecutionLimits
  key: string
  agent: string
  grantedBy: string
  reason: string
  progress: ProgressSignal
  now: string
}): ExtraDispatchGrantResult {
  const { state, limits, key, agent, grantedBy, reason, progress, now } = input
  const used = state.byKey[key] ?? 0
  const currentLimit = effectiveStepLimit(state, key, agent, limits)
  const grants = grantsForKey(state, key)

  if (!reason.trim()) {
    return { allowed: false, reason: "Budget grant requires a concrete reason.", state }
  }

  if (!hasMaterialProgress(progress)) {
    return {
      allowed: false,
      reason:
        "Budget grant requires material progress: new evidence, changed hypothesis, changed strategy, or reduced unresolved work.",
      state,
    }
  }

  if (state.totalDispatches >= limits.maxTotalDispatches) {
    state.exhausted = `total dispatch limit ${limits.maxTotalDispatches} reached`
    return { allowed: false, reason: state.exhausted, state }
  }

  if (used < currentLimit) {
    return {
      allowed: false,
      reason: `Target still has dispatch capacity: ${used}/${currentLimit} used.`,
      state,
    }
  }

  if (grants >= limits.maxExtraDispatchesPerStep) {
    state.exhausted = `extra dispatch grant limit ${limits.maxExtraDispatchesPerStep} reached for ${key}`
    return { allowed: false, reason: state.exhausted, state }
  }

  const grant: BudgetGrant = {
    key,
    agent,
    grantedBy,
    reason: reason.trim(),
    progress,
    grantedAt: now,
  }
  if (!state.grants) state.grants = []
  state.grants.push(grant)
  delete state.exhausted

  return {
    allowed: true,
    grant,
    previousLimit: currentLimit,
    newLimit: currentLimit + 1,
    state,
  }
}

export type BudgetGrantTarget =
  | {
      kind: "step"
      id: string
      key: string
      agent: string
      stepKind: "work" | "gate"
    }
  | {
      kind: "question"
      id: string
      key: string
      agent: string
    }

export type ResolveBudgetGrantTargetResult =
  | { target: BudgetGrantTarget; reason?: undefined }
  | { target?: undefined; reason: string }

export type WorkflowDispatchGrantResult =
  | {
      allowed: true
      target: BudgetGrantTarget
      grant: BudgetGrant
      previousLimit: number
      newLimit: number
      state: BudgetState
    }
  | {
      allowed: false
      reason: string
      state: BudgetState
    }

export function resolveBudgetGrantTarget(input: {
  workflow: Workflow
  questions: OpenQuestion[]
  stepId?: string
  questionId?: string
}): ResolveBudgetGrantTargetResult {
  const { workflow, questions, stepId, questionId } = input
  const targetCount = Number(Boolean(stepId)) + Number(Boolean(questionId))

  if (targetCount !== 1) {
    return {
      target: undefined,
      reason: "Budget grant requires exactly one target: stepId or questionId.",
    }
  }

  if (stepId) {
    const step = workflow.steps.find((candidate) => candidate.id === stepId)
    if (!step) return { target: undefined, reason: "Step not found." }
    if (step.status !== "pending") {
      return {
        target: undefined,
        reason: "Budget grants apply only to pending steps. Reopen failed work or gates before granting another dispatch.",
      }
    }
    if (!runnable(workflow).some((candidate) => candidate.id === step.id)) {
      return {
        target: undefined,
        reason: "Budget grants apply only when the exhausted step is currently runnable.",
      }
    }

    const target: BudgetGrantTarget = {
      kind: "step",
      id: step.id,
      key: `step:${step.id}`,
      agent: step.agent,
      stepKind: step.kind,
    }
    return { target }
  }

  const question = questions.find((candidate) => candidate.id === questionId)
  if (!question) return { target: undefined, reason: "Question not found." }
  if (question.workflowId !== workflow.id) {
    return { target: undefined, reason: "Question does not belong to this workflow." }
  }
  if (question.requiredAuthority === "user") {
    return { target: undefined, reason: "User-owned questions do not have agent dispatch budgets." }
  }
  if (question.status === "closed" || question.answer) {
    return { target: undefined, reason: "Budget grants apply only to unanswered agent-owned questions." }
  }

  const target: BudgetGrantTarget = {
    kind: "question",
    id: question.id,
    key: `oq:${question.id}`,
    agent: question.requiredAuthority,
  }
  return { target }
}

export function grantWorkflowDispatchBudget(input: {
  state: BudgetState
  limits: ExecutionLimits
  workflow: Workflow
  questions: OpenQuestion[]
  stepId?: string
  questionId?: string
  grantedBy: string
  reason: string
  progress: ProgressSignal
  now: string
}): WorkflowDispatchGrantResult {
  const { state, limits, workflow, questions, stepId, questionId, grantedBy, reason, progress, now } = input

  if (grantedBy !== "general") {
    return {
      allowed: false,
      reason: "Only general may grant extra Loom dispatch budget.",
      state,
    }
  }

  const resolved = resolveBudgetGrantTarget({ workflow, questions, stepId, questionId })
  if (!resolved.target) {
    return { allowed: false, reason: resolved.reason, state }
  }

  const result = grantExtraDispatch({
    state,
    limits,
    key: resolved.target.key,
    agent: resolved.target.agent,
    grantedBy,
    reason,
    progress,
    now,
  })

  if (!result.allowed) return result

  return {
    allowed: true,
    target: resolved.target,
    grant: result.grant,
    previousLimit: result.previousLimit,
    newLimit: result.newLimit,
    state,
  }
}

export function hasMaterialProgress(signal: ProgressSignal) {
  return (
    signal.newEvidence ||
    signal.changedHypothesis ||
    signal.changedStrategy ||
    signal.reducedUnresolved
  )
}
