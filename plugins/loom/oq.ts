import type { Workflow } from "./workflow"

export type OQAuthority =
  | "user"
  | "designer"
  | "specifier"
  | "architect"
  | "research"
  | "diagnostic"
  | "reviewer"
  | "critic"

export type OQDisposition = "incorporated" | "unaffected" | "explicitly-deferred"
export type OQStatus = "open" | "answered" | "closed"

export type OQAnswer = {
  by: string
  source: "agent" | "user"
  text: string
  evidence: string[]
  at: string
}

export type OQReconciliation = {
  stepId: string
  byAgent: string
  disposition: OQDisposition
  summary: string
  at: string
}

export type OpenQuestion = {
  id: string
  workflowId: string
  question: string
  raisedByAgent: string
  raisedByStepId: string
  requiredAuthority: OQAuthority
  blocking: boolean
  consumerStepIds: string[]
  evidence: string[]
  status: OQStatus
  answer?: OQAnswer
  reconciliations: Record<string, OQReconciliation>
  createdAt: string
  reopened?: {
    by: string
    reason: string
    preservedAnswer: boolean
    at: string
  }
}

export type RaiseQuestionInput = {
  id: string
  workflow: Workflow
  question: string
  raisedByAgent: string
  raisedByStepId: string
  requiredAuthority: OQAuthority
  blocking: boolean
  consumerStepIds?: string[]
  evidence?: string[]
  now: string
}

function stepAgent(workflow: Workflow, stepId: string) {
  return workflow.steps.find((step) => step.id === stepId)?.agent
}

export function raiseQuestion(input: RaiseQuestionInput): OpenQuestion {
  const owner = stepAgent(input.workflow, input.raisedByStepId)
  if (!owner) throw new Error("Raising step not found.")
  if (owner !== input.raisedByAgent) {
    throw new Error(`Step ${input.raisedByStepId} belongs to ${owner}, not ${input.raisedByAgent}.`)
  }

  const consumers = new Set(input.consumerStepIds ?? [])
  if (input.blocking) consumers.add(input.raisedByStepId)

  for (const stepId of consumers) {
    if (!stepAgent(input.workflow, stepId)) {
      throw new Error(`Consumer step ${stepId} not found.`)
    }
  }

  return {
    id: input.id,
    workflowId: input.workflow.id,
    question: input.question,
    raisedByAgent: input.raisedByAgent,
    raisedByStepId: input.raisedByStepId,
    requiredAuthority: input.requiredAuthority,
    blocking: input.blocking,
    consumerStepIds: [...consumers],
    evidence: input.evidence ?? [],
    status: "open",
    reconciliations: {},
    createdAt: input.now,
  }
}

export function answerQuestion(
  question: OpenQuestion,
  actor: string,
  source: "agent" | "user",
  text: string,
  evidence: string[],
  now: string,
) {
  if (question.answer) throw new Error("Question already has an answer. Reopen it before replacing the answer.")

  if (question.requiredAuthority === "user") {
    if (actor !== "general" || source !== "user") {
      throw new Error("User-owned question may only be recorded by general with source=user.")
    }
  } else {
    if (source !== "agent" || actor !== question.requiredAuthority) {
      throw new Error(`Question requires ${question.requiredAuthority} authority.`)
    }
  }

  question.answer = { by: question.requiredAuthority === "user" ? "user" : actor, source, text, evidence, at: now }
  question.status = question.consumerStepIds.length === 0 ? "closed" : "answered"
  return question
}

export function reconcileQuestion(
  question: OpenQuestion,
  workflow: Workflow,
  stepId: string,
  actor: string,
  disposition: OQDisposition,
  summary: string,
  now: string,
) {
  if (!question.answer) throw new Error("Question must be answered before reconciliation.")

  const owner = stepAgent(workflow, stepId)
  if (!owner) throw new Error("Consumer step not found.")
  if (owner !== actor) throw new Error(`Step ${stepId} belongs to ${owner}, not ${actor}.`)

  if (!question.consumerStepIds.includes(stepId)) {
    question.consumerStepIds.push(stepId)
  }

  question.reconciliations[stepId] = {
    stepId,
    byAgent: actor,
    disposition,
    summary,
    at: now,
  }

  const allReconciled = question.consumerStepIds.every((consumer) => question.reconciliations[consumer])
  question.status = allReconciled ? "closed" : "answered"
  return question
}

export function reopenQuestion(
  question: OpenQuestion,
  actor: string,
  preserveAnswer: boolean,
  reason: string,
  now: string,
) {
  const mayReopen =
    actor === "general" ||
    actor === question.raisedByAgent ||
    actor === question.requiredAuthority ||
    Object.values(question.reconciliations).some((entry) => entry.byAgent === actor)

  if (!mayReopen) throw new Error("Agent is not authorized to reopen this question.")

  question.reconciliations = {}
  if (!preserveAnswer) delete question.answer
  question.status = preserveAnswer && question.answer ? "answered" : "open"
  question.reopened = { by: actor, reason, preservedAnswer: preserveAnswer, at: now }
  return question
}

export function blockingQuestionsForStep(questions: OpenQuestion[], stepId: string) {
  return questions.filter(
    (question) =>
      question.blocking &&
      question.consumerStepIds.includes(stepId) &&
      question.status !== "closed",
  )
}

export function relevantQuestions(
  questions: OpenQuestion[],
  workflow: Workflow,
  agent: string,
  stepId?: string,
) {
  if (agent === "general") return questions

  return questions.filter((question) => {
    if (question.requiredAuthority === agent || question.raisedByAgent === agent) return true
    return question.consumerStepIds.some((consumer) => {
      if (stepId && consumer === stepId) return true
      return stepAgent(workflow, consumer) === agent
    })
  })
}
