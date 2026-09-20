export type ExecutionLimits = {
  maxTotalDispatches: number
  maxDispatchesPerStep: number
  maxReviewerDispatchesPerStep: number
  maxCriticDispatchesPerStep: number
  maxProviderRetries: number
}

export type BudgetState = {
  totalDispatches: number
  byKey: Record<string, number>
  seenDispatches: string[]
  exhausted?: string
}

export const DEFAULT_LIMITS: ExecutionLimits = {
  maxTotalDispatches: 40,
  maxDispatchesPerStep: 3,
  maxReviewerDispatchesPerStep: 3,
  maxCriticDispatchesPerStep: 2,
  maxProviderRetries: 2,
}

export function newBudgetState(): BudgetState {
  return {
    totalDispatches: 0,
    byKey: {},
    seenDispatches: [],
  }
}

function stepLimit(agent: string, limits: ExecutionLimits) {
  if (agent === "critic") return limits.maxCriticDispatchesPerStep
  if (agent === "reviewer") return limits.maxReviewerDispatchesPerStep
  return limits.maxDispatchesPerStep
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
  const max = stepLimit(agent, limits)

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

export type ProgressSignal = {
  newEvidence: boolean
  changedHypothesis: boolean
  changedStrategy: boolean
  reducedUnresolved: boolean
}

export function hasMaterialProgress(signal: ProgressSignal) {
  return (
    signal.newEvidence ||
    signal.changedHypothesis ||
    signal.changedStrategy ||
    signal.reducedUnresolved
  )
}
