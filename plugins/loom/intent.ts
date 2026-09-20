export type IntentState = "interviewing" | "draft-ready" | "accepted"

export type IntentDecisionSource = "user" | "repository" | "research"

export type IntentDecision = {
  id: string
  branch: string
  question: string
  recommendation: string
  resolution: string
  source: IntentDecisionSource
  evidence: string[]
  recordedAt: string
}

export type IntentSession = {
  id: string
  seed: string
  createdAt: string
  state: IntentState
  openQuestion?: {
    branch: string
    question: string
    recommendation: string
    why: string
    askedAt: string
  }
  decisions: IntentDecision[]
  draft?: {
    goal: string
    success: string[]
    scope: string[]
    exclusions: string[]
    userOwned: string[]
    context: string[]
    preparedAt: string
  }
  acceptedAnchor?: {
    path: string
    acceptedAt: string
  }
}

export function startIntent(seed: string, now: string): IntentSession {
  if (!seed.trim()) throw new Error("Intent seed is required.")
  return {
    id: crypto.randomUUID(),
    seed: seed.trim(),
    createdAt: now,
    state: "interviewing",
    decisions: [],
  }
}

export function askIntentQuestion(input: {
  session: IntentSession
  branch: string
  question: string
  recommendation: string
  why: string
  now: string
}) {
  if (input.session.state !== "interviewing") {
    throw new Error("Intent interview is not active.")
  }
  if (input.session.openQuestion) {
    throw new Error("Resolve the current intent question before asking another.")
  }

  for (const [name, value] of Object.entries({
    branch: input.branch,
    question: input.question,
    recommendation: input.recommendation,
    why: input.why,
  })) {
    if (!value.trim()) throw new Error(`Intent question ${name} is required.`)
  }

  input.session.openQuestion = {
    branch: input.branch.trim(),
    question: input.question.trim(),
    recommendation: input.recommendation.trim(),
    why: input.why.trim(),
    askedAt: input.now,
  }

  return input.session.openQuestion
}

export function resolveIntentQuestion(input: {
  session: IntentSession
  resolution: string
  source: IntentDecisionSource
  evidence?: string[]
  now: string
}) {
  if (!input.session.openQuestion) {
    throw new Error("No open intent question.")
  }
  if (!input.resolution.trim()) throw new Error("Intent resolution is required.")

  if (input.source !== "user" && (input.evidence?.length ?? 0) === 0) {
    throw new Error("Repository/research resolutions require evidence references.")
  }

  const open = input.session.openQuestion
  const decision: IntentDecision = {
    id: crypto.randomUUID(),
    branch: open.branch,
    question: open.question,
    recommendation: open.recommendation,
    resolution: input.resolution.trim(),
    source: input.source,
    evidence: [...new Set(input.evidence ?? [])],
    recordedAt: input.now,
  }

  input.session.decisions.push(decision)
  delete input.session.openQuestion
  return decision
}

export function prepareIntentDraft(input: {
  session: IntentSession
  goal: string
  success: string[]
  scope: string[]
  exclusions: string[]
  userOwned: string[]
  context: string[]
  now: string
}) {
  if (input.session.state !== "interviewing") {
    throw new Error("Intent interview is not active.")
  }
  if (input.session.openQuestion) {
    throw new Error("Cannot prepare Anchor while an intent question is unresolved.")
  }

  const goal = input.goal.trim()
  if (!goal) throw new Error("Anchor goal is required.")

  const normalize = (values: string[]) => [...new Set(values.map((value) => value.trim()).filter(Boolean))]
  const success = normalize(input.success)
  const scope = normalize(input.scope)
  const exclusions = normalize(input.exclusions)
  const userOwned = normalize(input.userOwned)
  const context = normalize(input.context)

  if (success.length === 0) {
    throw new Error("Anchor draft needs at least one observable success criterion.")
  }
  if (scope.length === 0) {
    throw new Error("Anchor draft needs an explicit scope.")
  }
  if (exclusions.length === 0) {
    throw new Error("Anchor draft needs at least one explicit exclusion/boundary.")
  }

  input.session.draft = {
    goal,
    success,
    scope,
    exclusions,
    userOwned,
    context,
    preparedAt: input.now,
  }
  input.session.state = "draft-ready"
  return input.session.draft
}

export function reopenIntent(session: IntentSession) {
  if (session.state === "accepted") {
    throw new Error("Accepted intent cannot be reopened without a new intent session.")
  }
  session.state = "interviewing"
  delete session.draft
  delete session.openQuestion
  return session
}

export function acceptIntent(input: {
  session: IntentSession
  anchorPath: string
  now: string
}) {
  if (input.session.state !== "draft-ready" || !input.session.draft) {
    throw new Error("Intent must have a prepared Anchor draft before acceptance.")
  }
  if (!input.anchorPath.trim()) throw new Error("Accepted Anchor path is required.")

  input.session.state = "accepted"
  input.session.acceptedAnchor = {
    path: input.anchorPath.trim(),
    acceptedAt: input.now,
  }
  return input.session.acceptedAnchor
}
