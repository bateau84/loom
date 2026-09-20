import { Plugin } from "@opencode/plugin"
import {
  buildSteps,
  preserveSatisfied,
  finishStep,
  reopenFrom,
  runnable,
  type Effects,
  type Workflow,
} from "./workflow"
import {
  answerQuestion,
  blockingQuestionsForStep,
  raiseQuestion,
  reconcileQuestion,
  relevantQuestions,
  reopenQuestion,
  type OpenQuestion,
  type OQAuthority,
  type OQDisposition,
} from "./oq"
import {
  createClaim,
  safeInputSummary,
  type EvidenceClaim,
  type EvidenceKind,
  type EvidenceObservation,
} from "./evidence"
import {
  DEFAULT_LIMITS,
  hasMaterialProgress,
  newBudgetState,
  recordDispatch,
  type BudgetState,
  type ExecutionLimits,
  type ProgressSignal,
} from "./budget"
import { resourcesWithinScope, validateWriteScope, type TaskScope } from "./scope"

const loomAgents = new Set([
  "designer",
  "specifier",
  "architect",
  "reviewer",
  "critic",
  "worker",
  "research",
  "diagnostic",
])

function scopeKey(workflowId: string, stepId: string) {
  return `scope/${workflowId}/${stepId}`
}

function sessionStepKey(sessionID: string) {
  return `session-step/${sessionID}`
}

function budgetKey(workflowId: string) {
  return `budget/${workflowId}`
}

function limitsKey(workflowId: string) {
  return `limits/${workflowId}`
}

async function readBudget(ctx: any, workflowId: string): Promise<BudgetState> {
  return ((await ctx.storage.get(budgetKey(workflowId))) as BudgetState | undefined) ?? newBudgetState()
}

async function readLimits(ctx: any, workflowId: string): Promise<ExecutionLimits> {
  return ((await ctx.storage.get(limitsKey(workflowId))) as ExecutionLimits | undefined) ?? DEFAULT_LIMITS
}

function workflowKey(id: string) {
  return `workflow/${id}`
}

function sessionKey(id: string) {
  return `session/${id}`
}

function oqIndexKey(workflowId: string) {
  return `oq-index/${workflowId}`
}

function oqKey(workflowId: string, questionId: string) {
  return `oq/${workflowId}/${questionId}`
}

async function readWorkflow(ctx: any, id: string): Promise<Workflow | undefined> {
  return (await ctx.storage.get(workflowKey(id))) as Workflow | undefined
}

async function activeWorkflow(ctx: any, sessionID: string): Promise<Workflow | undefined> {
  const id = (await ctx.storage.get(sessionKey(sessionID))) as string | undefined
  return id ? readWorkflow(ctx, id) : undefined
}

async function readQuestions(ctx: any, workflowId: string): Promise<OpenQuestion[]> {
  const ids = ((await ctx.storage.get(oqIndexKey(workflowId))) as string[] | undefined) ?? []
  const questions = await Promise.all(
    ids.map((id) => ctx.storage.get(oqKey(workflowId, id)) as Promise<OpenQuestion | undefined>),
  )
  return questions.filter((question): question is OpenQuestion => Boolean(question))
}

async function saveQuestion(ctx: any, question: OpenQuestion) {
  await ctx.storage.set(oqKey(question.workflowId, question.id), question)
}

async function appendQuestion(ctx: any, question: OpenQuestion) {
  const key = oqIndexKey(question.workflowId)
  const ids = ((await ctx.storage.get(key)) as string[] | undefined) ?? []
  if (!ids.includes(question.id)) {
    await ctx.storage.set(key, [...ids, question.id])
  }
  await saveQuestion(ctx, question)
}

function questionState(questions: OpenQuestion[], workflow: Workflow) {
  const unresolved = questions.filter((question) => question.status !== "closed")
  const routes = unresolved
    .filter((question) => !question.answer)
    .map((question) => ({
      questionId: question.id,
      requiredAuthority: question.requiredAuthority,
      blocking: question.blocking,
    }))

  const reconcile = unresolved
    .filter((question) => Boolean(question.answer))
    .flatMap((question) =>
      question.consumerStepIds
        .filter((stepId) => !question.reconciliations[stepId])
        .map((stepId) => ({
          questionId: question.id,
          stepId,
          agent: workflow.steps.find((step) => step.id === stepId)?.agent,
        })),
    )

  return {
    unresolved: unresolved.map((question) => ({
      id: question.id,
      status: question.status,
      requiredAuthority: question.requiredAuthority,
      blocking: question.blocking,
      consumers: question.consumerStepIds,
    })),
    routes,
    reconcile,
  }
}


function evidenceKey(id: string) {
  return `evidence/${id}`
}

function sessionEvidencePrefix(sessionID: string) {
  return `evidence-session/${sessionID}/`
}

function stepEvidencePrefix(workflowId: string, stepId: string) {
  return `evidence-step/${workflowId}/${stepId}/`
}

function claimPrefix(workflowId: string, stepId: string) {
  return `evidence-claim/${workflowId}/${stepId}/`
}

async function digest(value: unknown) {
  const text = JSON.stringify(value) ?? String(value)
  const bytes = new TextEncoder().encode(text)
  const hash = await crypto.subtle.digest("SHA-256", bytes)
  return [...new Uint8Array(hash)].map((byte) => byte.toString(16).padStart(2, "0")).join("")
}

async function scanValues<T>(ctx: any, prefix: string): Promise<T[]> {
  const values: T[] = []
  let after: string | undefined

  do {
    const page = await ctx.storage.scan({ prefix, limit: 100, ...(after ? { after } : {}) })
    values.push(...page.entries.map((entry: { value: unknown }) => entry.value as T))
    after = page.next
  } while (after)

  return values
}

async function sessionObservations(ctx: any, sessionID: string): Promise<EvidenceObservation[]> {
  const ids = await scanValues<string>(ctx, sessionEvidencePrefix(sessionID))
  const records = await Promise.all(ids.map((id) => ctx.storage.get(evidenceKey(id))))
  return records.filter((record): record is EvidenceObservation => Boolean(record))
}

async function stepObservations(ctx: any, workflowId: string, stepId: string): Promise<EvidenceObservation[]> {
  const ids = await scanValues<string>(ctx, stepEvidencePrefix(workflowId, stepId))
  const records = await Promise.all(ids.map((id) => ctx.storage.get(evidenceKey(id))))
  return records.filter((record): record is EvidenceObservation => Boolean(record))
}

async function stepClaims(ctx: any, workflowId: string, stepId: string): Promise<EvidenceClaim[]> {
  return scanValues<EvidenceClaim>(ctx, claimPrefix(workflowId, stepId))
}

async function bindSessionEvidence(ctx: any, sessionID: string, workflowId: string, stepId: string) {
  const observations = await sessionObservations(ctx, sessionID)
  let bound = 0

  for (const observation of observations) {
    if (observation.workflowId && (observation.workflowId !== workflowId || observation.stepId !== stepId)) {
      continue
    }

    const next = { ...observation, workflowId, stepId }
    await ctx.storage.set(evidenceKey(observation.id), next)
    await ctx.storage.set(`${stepEvidencePrefix(workflowId, stepId)}${observation.id}`, observation.id)
    bound++
  }

  return bound
}

function toolEventKey(raw: any) {
  return String(raw.callID ?? raw.id ?? `${raw.sessionID ?? "unknown"}:${raw.tool ?? "unknown"}`)
}

const pendingToolInputs = new Map<string, unknown>()

export default Plugin.define({
  id: "loom",

  async setup(ctx) {
    await ctx.agent.transform((editor) => {
      if (editor.get("general")) editor.default("general")
    })

    await ctx.tool.transform((editor) => {
      editor.namespace({
        name: "loom",
        description: "Loom workflow control, shared questions, routing, and step state.",
      })

      editor.add({
        name: "start",
        description: "Start a Loom workflow for an accepted Anchor. General only.",
        input: {
          type: "object",
          properties: {
            anchor: { type: "string", description: "Repository path to the accepted Anchor." },
          },
          required: ["anchor"],
          additionalProperties: false,
        },
        options: { namespace: "loom" },
        execute: async (input, tool) => {
          if (tool.agent !== "general") {
            return { content: JSON.stringify({ error: "Only general may start a Loom workflow." }) }
          }

          const { anchor } = input as { anchor: string }
          const id = crypto.randomUUID()
          const workflow: Workflow = {
            id,
            anchor,
            createdBySession: tool.sessionID,
            createdAt: new Date().toISOString(),
            steps: [],
          }

          await ctx.storage.set(workflowKey(id), workflow)
          await ctx.storage.set(sessionKey(tool.sessionID), id)
          await ctx.storage.set(limitsKey(id), DEFAULT_LIMITS)
          await ctx.storage.set(budgetKey(id), newBudgetState())

          return { content: JSON.stringify({ workflowId: id, anchor, status: "started" }) }
        },
      })

      editor.add({
        name: "route",
        description:
          "Classify or reclassify accepted work and create the required Loom execution DAG. General only.",
        input: {
          type: "object",
          properties: {
            humanFacing: { type: "boolean" },
            behavioral: { type: "boolean" },
            structural: { type: "boolean" },
            externalUnknown: { type: "boolean" },
            diagnostic: { type: "boolean" },
            productOutcome: { type: "boolean" },
          },
          required: [
            "humanFacing",
            "behavioral",
            "structural",
            "externalUnknown",
            "diagnostic",
            "productOutcome",
          ],
          additionalProperties: false,
        },
        options: { namespace: "loom" },
        execute: async (input, tool) => {
          if (tool.agent !== "general") {
            return { content: JSON.stringify({ error: "Only general may route Loom workflows." }) }
          }

          const workflow = await activeWorkflow(ctx, tool.sessionID)
          if (!workflow) {
            return { content: JSON.stringify({ error: "No active Loom workflow. Call loom_start first." }) }
          }

          const implementationStarted = workflow.steps.some(
            (step) =>
              ["worker", "review-implementation", "critic-final"].includes(step.id) &&
              ["complete", "passed"].includes(step.status),
          )
          if (implementationStarted) {
            return {
              content: JSON.stringify({
                error:
                  "V0 route reclassification is only supported before implementation completion. Start a correction workflow for later reclassification.",
              }),
            }
          }

          const effects = input as Effects
          const next = buildSteps(effects)
          preserveSatisfied(workflow.steps, next)

          workflow.effects = effects
          workflow.steps = next
          await ctx.storage.set(workflowKey(workflow.id), workflow)

          const questions = await readQuestions(ctx, workflow.id)
          return {
            content: JSON.stringify({
              workflowId: workflow.id,
              steps: workflow.steps,
              runnable: runnable(workflow).map((step) => ({ id: step.id, agent: step.agent })),
              questions: questionState(questions, workflow),
            }),
          }
        },
      })

      editor.add({
        name: "status",
        description: "Inspect Loom workflow state, runnable steps, and unresolved shared questions.",
        input: {
          type: "object",
          properties: { workflowId: { type: "string" } },
          additionalProperties: false,
        },
        options: { namespace: "loom" },
        execute: async (input, tool) => {
          const requested = (input as { workflowId?: string }).workflowId
          const workflow = requested
            ? await readWorkflow(ctx, requested)
            : await activeWorkflow(ctx, tool.sessionID)

          if (!workflow) return { content: JSON.stringify({ error: "Workflow not found." }) }

          const questions = await readQuestions(ctx, workflow.id)
          const limits = await readLimits(ctx, workflow.id)
          const budget = await readBudget(ctx, workflow.id)
          return {
            content: JSON.stringify({
              workflow,
              runnable: runnable(workflow).map((step) => ({ id: step.id, agent: step.agent })),
              questions: questionState(questions, workflow),
              budget: { limits, state: budget },
            }),
          }
        },
      })

      editor.add({
        name: "complete",
        description:
          "Finish one Loom step. Work uses complete; Reviewer/Critic gates use pass or fail. Blocking OQs must be closed first.",
        input: {
          type: "object",
          properties: {
            workflowId: { type: "string" },
            stepId: { type: "string" },
            summary: { type: "string" },
            outcome: { type: "string", enum: ["complete", "pass", "fail"] },
          },
          required: ["workflowId", "stepId", "summary"],
          additionalProperties: false,
        },
        options: { namespace: "loom" },
        execute: async (input, tool) => {
          const { workflowId, stepId, summary, outcome } = input as {
            workflowId: string
            stepId: string
            summary: string
            outcome?: "complete" | "pass" | "fail"
          }

          const workflow = await readWorkflow(ctx, workflowId)
          if (!workflow) return { content: JSON.stringify({ error: "Workflow not found." }) }

          const questions = await readQuestions(ctx, workflowId)
          const blocking = blockingQuestionsForStep(questions, stepId)
          if (blocking.length > 0) {
            return {
              content: JSON.stringify({
                error: "Step has unresolved blocking questions.",
                questions: blocking.map((question) => ({
                  id: question.id,
                  status: question.status,
                  requiredAuthority: question.requiredAuthority,
                })),
              }),
            }
          }

          const step = workflow.steps.find((candidate) => candidate.id === stepId)
          if (!step) return { content: JSON.stringify({ error: "Step not found." }) }

          const resolvedOutcome = outcome ?? (step.kind === "work" ? "complete" : undefined)
          if (!resolvedOutcome) {
            return { content: JSON.stringify({ error: "Reviewer/Critic gate requires outcome pass or fail." }) }
          }

          try {
            finishStep(workflow, stepId, tool.agent, resolvedOutcome, summary)
          } catch (error) {
            return { content: JSON.stringify({ error: error instanceof Error ? error.message : String(error) }) }
          }

          const evidenceBound = await bindSessionEvidence(ctx, tool.sessionID, workflowId, stepId)
          await ctx.storage.set(workflowKey(workflow.id), workflow)

          return {
            content: JSON.stringify({
              finished: stepId,
              evidenceBound,
              outcome: resolvedOutcome,
              blocked: workflow.steps.filter((candidate) => candidate.status === "failed").map((candidate) => candidate.id),
              runnable: runnable(workflow).map((candidate) => ({ id: candidate.id, agent: candidate.agent })),
              questions: questionState(questions, workflow),
            }),
          }
        },
      })

      editor.add({
        name: "reopen",
        description:
          "Reopen one prior workflow step after failed review or new evidence. Resets only that step and downstream dependents. General only.",
        input: {
          type: "object",
          properties: {
            workflowId: { type: "string" },
            stepId: { type: "string" },
            reason: { type: "string" },
            newEvidence: { type: "boolean" },
            changedHypothesis: { type: "boolean" },
            changedStrategy: { type: "boolean" },
            reducedUnresolved: { type: "boolean" },
          },
          required: [
            "workflowId",
            "stepId",
            "reason",
            "newEvidence",
            "changedHypothesis",
            "changedStrategy",
            "reducedUnresolved",
          ],
          additionalProperties: false,
        },
        options: { namespace: "loom" },
        execute: async (input, tool) => {
          if (tool.agent !== "general") {
            return { content: JSON.stringify({ error: "Only general may reopen Loom steps." }) }
          }
          const value = input as {
            workflowId: string
            stepId: string
            reason: string
            newEvidence: boolean
            changedHypothesis: boolean
            changedStrategy: boolean
            reducedUnresolved: boolean
          }
          const { workflowId, stepId } = value
          const progress: ProgressSignal = {
            newEvidence: value.newEvidence,
            changedHypothesis: value.changedHypothesis,
            changedStrategy: value.changedStrategy,
            reducedUnresolved: value.reducedUnresolved,
          }
          if (!hasMaterialProgress(progress)) {
            return {
              content: JSON.stringify({
                error: "Reopen denied: repeated work must have new evidence, a changed hypothesis, a changed strategy, or a reduced unresolved set.",
              }),
            }
          }

          const workflow = await readWorkflow(ctx, workflowId)
          if (!workflow) return { content: JSON.stringify({ error: "Workflow not found." }) }

          try {
            const reset = reopenFrom(workflow, stepId)
            await ctx.storage.set(
              `progress/${workflowId}/${stepId}/${crypto.randomUUID()}`,
              { reason: value.reason, ...progress, at: new Date().toISOString() },
            )
            await ctx.storage.set(workflowKey(workflow.id), workflow)
            return {
              content: JSON.stringify({
                reopened: stepId,
                reset,
                runnable: runnable(workflow).map((candidate) => ({ id: candidate.id, agent: candidate.agent })),
              }),
            }
          } catch (error) {
            return { content: JSON.stringify({ error: error instanceof Error ? error.message : String(error) }) }
          }
        },
      })

      editor.add({
        name: "oq_raise",
        description:
          "Raise a shared workflow question. Blocking questions automatically make the raising step a required consumer.",
        input: {
          type: "object",
          properties: {
            workflowId: { type: "string" },
            stepId: { type: "string" },
            question: { type: "string" },
            requiredAuthority: {
              type: "string",
              enum: ["user", "designer", "specifier", "architect", "research", "diagnostic", "reviewer", "critic"],
            },
            blocking: { type: "boolean" },
            consumerStepIds: { type: "array", items: { type: "string" } },
            evidence: { type: "array", items: { type: "string" } },
          },
          required: ["workflowId", "stepId", "question", "requiredAuthority", "blocking"],
          additionalProperties: false,
        },
        options: { namespace: "loom" },
        execute: async (input, tool) => {
          const value = input as {
            workflowId: string
            stepId: string
            question: string
            requiredAuthority: OQAuthority
            blocking: boolean
            consumerStepIds?: string[]
            evidence?: string[]
          }
          const workflow = await readWorkflow(ctx, value.workflowId)
          if (!workflow) return { content: JSON.stringify({ error: "Workflow not found." }) }

          try {
            const question = raiseQuestion({
              id: crypto.randomUUID(),
              workflow,
              question: value.question,
              raisedByAgent: tool.agent,
              raisedByStepId: value.stepId,
              requiredAuthority: value.requiredAuthority,
              blocking: value.blocking,
              consumerStepIds: value.consumerStepIds,
              evidence: value.evidence,
              now: new Date().toISOString(),
            })
            await appendQuestion(ctx, question)
            await bindSessionEvidence(ctx, tool.sessionID, value.workflowId, value.stepId)
            return {
              content: JSON.stringify({
                question,
                routeTo: question.requiredAuthority,
              }),
            }
          } catch (error) {
            return { content: JSON.stringify({ error: error instanceof Error ? error.message : String(error) }) }
          }
        },
      })

      editor.add({
        name: "oq_list",
        description: "List shared questions relevant to the current agent or one assigned step.",
        input: {
          type: "object",
          properties: {
            workflowId: { type: "string" },
            stepId: { type: "string" },
          },
          required: ["workflowId"],
          additionalProperties: false,
        },
        options: { namespace: "loom" },
        execute: async (input, tool) => {
          const { workflowId, stepId } = input as { workflowId: string; stepId?: string }
          const workflow = await readWorkflow(ctx, workflowId)
          if (!workflow) return { content: JSON.stringify({ error: "Workflow not found." }) }

          const questions = await readQuestions(ctx, workflowId)
          return {
            content: JSON.stringify({
              questions: relevantQuestions(questions, workflow, tool.agent, stepId),
            }),
          }
        },
      })

      editor.add({
        name: "oq_answer",
        description:
          "Answer a shared question. Agent-owned questions require the named authority. User-owned answers are recorded by General with source=user.",
        input: {
          type: "object",
          properties: {
            workflowId: { type: "string" },
            questionId: { type: "string" },
            answer: { type: "string" },
            source: { type: "string", enum: ["agent", "user"] },
            evidence: { type: "array", items: { type: "string" } },
          },
          required: ["workflowId", "questionId", "answer", "source"],
          additionalProperties: false,
        },
        options: { namespace: "loom" },
        execute: async (input, tool) => {
          const value = input as {
            workflowId: string
            questionId: string
            answer: string
            source: "agent" | "user"
            evidence?: string[]
          }
          const question = (await ctx.storage.get(oqKey(value.workflowId, value.questionId))) as OpenQuestion | undefined
          if (!question) return { content: JSON.stringify({ error: "Question not found." }) }

          try {
            answerQuestion(
              question,
              tool.agent,
              value.source,
              value.answer,
              value.evidence ?? [],
              new Date().toISOString(),
            )
            await saveQuestion(ctx, question)
            return { content: JSON.stringify({ question }) }
          } catch (error) {
            return { content: JSON.stringify({ error: error instanceof Error ? error.message : String(error) }) }
          }
        },
      })

      editor.add({
        name: "oq_reconcile",
        description:
          "Record how one workflow step consumed an answered question. Late consumers may register themselves through reconciliation.",
        input: {
          type: "object",
          properties: {
            workflowId: { type: "string" },
            questionId: { type: "string" },
            stepId: { type: "string" },
            disposition: {
              type: "string",
              enum: ["incorporated", "unaffected", "explicitly-deferred"],
            },
            summary: { type: "string" },
          },
          required: ["workflowId", "questionId", "stepId", "disposition", "summary"],
          additionalProperties: false,
        },
        options: { namespace: "loom" },
        execute: async (input, tool) => {
          const value = input as {
            workflowId: string
            questionId: string
            stepId: string
            disposition: OQDisposition
            summary: string
          }
          const workflow = await readWorkflow(ctx, value.workflowId)
          const question = (await ctx.storage.get(oqKey(value.workflowId, value.questionId))) as OpenQuestion | undefined
          if (!workflow || !question) return { content: JSON.stringify({ error: "Workflow or question not found." }) }

          try {
            reconcileQuestion(
              question,
              workflow,
              value.stepId,
              tool.agent,
              value.disposition,
              value.summary,
              new Date().toISOString(),
            )
            await saveQuestion(ctx, question)
            return { content: JSON.stringify({ question }) }
          } catch (error) {
            return { content: JSON.stringify({ error: error instanceof Error ? error.message : String(error) }) }
          }
        },
      })

      editor.add({
        name: "oq_reopen",
        description:
          "Reopen a shared question when its answer is stale, conflicting, or new consumers require reconsideration. Answer preservation must be explicit.",
        input: {
          type: "object",
          properties: {
            workflowId: { type: "string" },
            questionId: { type: "string" },
            preserveAnswer: { type: "boolean" },
            reason: { type: "string" },
          },
          required: ["workflowId", "questionId", "preserveAnswer", "reason"],
          additionalProperties: false,
        },
        options: { namespace: "loom" },
        execute: async (input, tool) => {
          const value = input as {
            workflowId: string
            questionId: string
            preserveAnswer: boolean
            reason: string
          }
          const question = (await ctx.storage.get(oqKey(value.workflowId, value.questionId))) as OpenQuestion | undefined
          if (!question) return { content: JSON.stringify({ error: "Question not found." }) }

          try {
            reopenQuestion(
              question,
              tool.agent,
              value.preserveAnswer,
              value.reason,
              new Date().toISOString(),
            )
            await saveQuestion(ctx, question)
            return { content: JSON.stringify({ question }) }
          } catch (error) {
            return { content: JSON.stringify({ error: error instanceof Error ? error.message : String(error) }) }
          }
        },
      })

      editor.add({
        name: "evidence_observations",
        description: "List automatically observed non-Loom tool executions from the current session.",
        input: {
          type: "object",
          properties: {},
          additionalProperties: false,
        },
        options: { namespace: "loom" },
        execute: async (_input, tool) => {
          const observations = await sessionObservations(ctx, tool.sessionID)
          return { content: JSON.stringify({ observations }) }
        },
      })

      editor.add({
        name: "evidence_claim",
        description:
          "Create an evidence claim backed by observed tool events from this session. Verification claim kinds are checked against observed commands.",
        input: {
          type: "object",
          properties: {
            workflowId: { type: "string" },
            stepId: { type: "string" },
            kind: {
              type: "string",
              enum: ["test", "build", "lint", "security", "runtime", "integration", "product-acceptance", "other"],
            },
            statement: { type: "string" },
            observationIds: { type: "array", items: { type: "string" } },
          },
          required: ["workflowId", "stepId", "kind", "statement", "observationIds"],
          additionalProperties: false,
        },
        options: { namespace: "loom" },
        execute: async (input, tool) => {
          const value = input as {
            workflowId: string
            stepId: string
            kind: EvidenceKind
            statement: string
            observationIds: string[]
          }

          const workflow = await readWorkflow(ctx, value.workflowId)
          if (!workflow) return { content: JSON.stringify({ error: "Workflow not found." }) }

          const step = workflow.steps.find((candidate) => candidate.id === value.stepId)
          if (!step) return { content: JSON.stringify({ error: "Step not found." }) }
          if (step.agent !== tool.agent) {
            return { content: JSON.stringify({ error: `Step ${value.stepId} belongs to ${step.agent}, not ${tool.agent}.` }) }
          }

          const available = await sessionObservations(ctx, tool.sessionID)
          const byID = new Map(available.map((observation) => [observation.id, observation]))
          const observations = value.observationIds.map((id) => byID.get(id)).filter(Boolean) as EvidenceObservation[]

          if (observations.length !== value.observationIds.length) {
            return { content: JSON.stringify({ error: "Every evidence id must be an observed event from the current session." }) }
          }

          try {
            const claim = createClaim({
              id: crypto.randomUUID(),
              workflowId: value.workflowId,
              stepId: value.stepId,
              byAgent: tool.agent,
              kind: value.kind,
              statement: value.statement,
              observations,
              now: new Date().toISOString(),
            })

            for (const observation of observations) {
              const next = { ...observation, workflowId: value.workflowId, stepId: value.stepId }
              await ctx.storage.set(evidenceKey(observation.id), next)
              await ctx.storage.set(
                `${stepEvidencePrefix(value.workflowId, value.stepId)}${observation.id}`,
                observation.id,
              )
            }
            await ctx.storage.set(`${claimPrefix(value.workflowId, value.stepId)}${claim.id}`, claim)

            return { content: JSON.stringify({ claim }) }
          } catch (error) {
            return { content: JSON.stringify({ error: error instanceof Error ? error.message : String(error) }) }
          }
        },
      })

      editor.add({
        name: "evidence_list",
        description: "List observed evidence and evidence claims bound to one workflow step.",
        input: {
          type: "object",
          properties: {
            workflowId: { type: "string" },
            stepId: { type: "string" },
          },
          required: ["workflowId", "stepId"],
          additionalProperties: false,
        },
        options: { namespace: "loom" },
        execute: async (input) => {
          const { workflowId, stepId } = input as { workflowId: string; stepId: string }
          const observations = await stepObservations(ctx, workflowId, stepId)
          const claims = await stepClaims(ctx, workflowId, stepId)
          return { content: JSON.stringify({ observations, claims }) }
        },
      })
      editor.add({
        name: "budget_status",
        description: "Inspect Loom execution limits and current dispatch consumption.",
        input: {
          type: "object",
          properties: { workflowId: { type: "string" } },
          required: ["workflowId"],
          additionalProperties: false,
        },
        options: { namespace: "loom" },
        execute: async (input) => {
          const { workflowId } = input as { workflowId: string }
          const limits = await readLimits(ctx, workflowId)
          const state = await readBudget(ctx, workflowId)
          return { content: JSON.stringify({ limits, state }) }
        },
      })

      editor.add({
        name: "task_scope",
        description:
          "Declare the bounded writable surface for one Worker step. General only. Accepted authority documents cannot be delegated to Worker.",
        input: {
          type: "object",
          properties: {
            workflowId: { type: "string" },
            stepId: { type: "string" },
            write: { type: "array", items: { type: "string" } },
          },
          required: ["workflowId", "stepId", "write"],
          additionalProperties: false,
        },
        options: { namespace: "loom" },
        execute: async (input, tool) => {
          if (tool.agent !== "general") {
            return { content: JSON.stringify({ error: "Only general may define Worker task scope." }) }
          }

          const value = input as { workflowId: string; stepId: string; write: string[] }
          const workflow = await readWorkflow(ctx, value.workflowId)
          if (!workflow) return { content: JSON.stringify({ error: "Workflow not found." }) }

          const step = workflow.steps.find((candidate) => candidate.id === value.stepId)
          if (!step) return { content: JSON.stringify({ error: "Step not found." }) }
          if (step.agent !== "worker") {
            return { content: JSON.stringify({ error: "Task scope may only be assigned to Worker steps." }) }
          }
          if (step.status !== "pending") {
            return { content: JSON.stringify({ error: "Worker task scope cannot change after the step has finished." }) }
          }

          try {
            validateWriteScope(value.write)
          } catch (error) {
            return { content: JSON.stringify({ error: error instanceof Error ? error.message : String(error) }) }
          }

          const scope: TaskScope = {
            workflowId: value.workflowId,
            stepId: value.stepId,
            write: value.write,
          }
          await ctx.storage.set(scopeKey(value.workflowId, value.stepId), scope)
          return { content: JSON.stringify({ scope }) }
        },
      })

      editor.add({
        name: "attach",
        description:
          "Attach the current child session to its Loom workflow step. Worker must attach before editing; Loom then validates edit permissions against the declared task scope.",
        input: {
          type: "object",
          properties: {
            workflowId: { type: "string" },
            stepId: { type: "string" },
          },
          required: ["workflowId", "stepId"],
          additionalProperties: false,
        },
        options: { namespace: "loom" },
        execute: async (input, tool) => {
          const { workflowId, stepId } = input as { workflowId: string; stepId: string }
          const workflow = await readWorkflow(ctx, workflowId)
          if (!workflow) return { content: JSON.stringify({ error: "Workflow not found." }) }

          const step = workflow.steps.find((candidate) => candidate.id === stepId)
          if (!step) return { content: JSON.stringify({ error: "Step not found." }) }
          if (step.agent !== tool.agent) {
            return {
              content: JSON.stringify({
                error: `Step ${stepId} belongs to ${step.agent}, not ${tool.agent}.`,
              }),
            }
          }

          let scope: TaskScope | undefined
          if (tool.agent === "worker") {
            scope = (await ctx.storage.get(scopeKey(workflowId, stepId))) as TaskScope | undefined
            if (!scope) {
              return { content: JSON.stringify({ error: "Worker step has no declared task scope." }) }
            }

          }

          await ctx.storage.set(sessionKey(tool.sessionID), workflowId)
          await ctx.storage.set(sessionStepKey(tool.sessionID), stepId)

          return {
            content: JSON.stringify({
              attached: true,
              workflowId,
              stepId,
              ...(scope ? { write: scope.write } : {}),
            }),
          }
        },
      })

      editor.add({
        name: "scope_status",
        description: "Inspect the declared Worker write scope for one workflow step.",
        input: {
          type: "object",
          properties: {
            workflowId: { type: "string" },
            stepId: { type: "string" },
          },
          required: ["workflowId", "stepId"],
          additionalProperties: false,
        },
        options: { namespace: "loom" },
        execute: async (input) => {
          const { workflowId, stepId } = input as { workflowId: string; stepId: string }
          const scope = (await ctx.storage.get(scopeKey(workflowId, stepId))) as TaskScope | undefined
          return { content: JSON.stringify({ scope: scope ?? null }) }
        },
      })

    })

    await ctx.permission.hook("evaluate", async (event) => {
      if (event.agent === "worker" && event.action === "edit") {
        const workflowId = (await ctx.storage.get(sessionKey(event.sessionID))) as string | undefined
        const stepId = (await ctx.storage.get(sessionStepKey(event.sessionID))) as string | undefined
        if (!workflowId || !stepId) {
          event.effect = "deny"
          event.message = "Worker must call loom_attach before editing."
          return
        }

        const scope = (await ctx.storage.get(scopeKey(workflowId, stepId))) as TaskScope | undefined
        if (!scope) {
          event.effect = "deny"
          event.message = "Worker step has no declared task scope."
          return
        }

        if (!resourcesWithinScope(event.resources, scope.write)) {
          event.effect = "deny"
          event.message = "Worker edit is outside the declared Loom task scope."
        }
        return
      }

      if (event.agent !== "general" || event.action !== "subagent") return

      const target = event.resources.find((resource) => loomAgents.has(resource))
      if (!target) return

      const workflow = await activeWorkflow(ctx, event.sessionID)
      if (!workflow || workflow.steps.length === 0) {
        event.effect = "deny"
        event.message = "Start and route a Loom workflow before dispatching Loom subagents."
        return
      }

      const questions = await readQuestions(ctx, workflow.id)
      const openQuestion = questions.find(
        (question) =>
          question.status !== "closed" &&
          !question.answer &&
          question.requiredAuthority === target,
      )
      const runnableStep = runnable(workflow).find((step) => step.agent === target)

      if (!runnableStep && !openQuestion) {
        event.effect = "deny"
        event.message = `Agent ${target} is not runnable and has no unanswered OQ. Inspect loom_status.`
        return
      }

      if (target === "worker" && runnableStep) {
        const scope = (await ctx.storage.get(scopeKey(workflow.id, runnableStep.id))) as TaskScope | undefined
        if (!scope) {
          event.effect = "deny"
          event.message = `Worker step ${runnableStep.id} has no declared write scope. Call loom_task_scope first.`
          return
        }
      }

      const limits = await readLimits(ctx, workflow.id)
      const budget = await readBudget(ctx, workflow.id)
      const dispatchID = [
        event.sessionID,
        event.source?.messageID ?? "message",
        event.source?.id ?? "tool",
        target,
      ].join(":")
      const key = runnableStep ? `step:${runnableStep.id}` : `oq:${openQuestion!.id}`
      const recorded = recordDispatch({ state: budget, limits, dispatchID, key, agent: target })
      await ctx.storage.set(budgetKey(workflow.id), budget)

      if (!recorded.allowed) {
        event.effect = "deny"
        event.message = `Loom execution budget exhausted: ${recorded.reason}`
      }
    })

    await ctx.session.hook("retry", (event) => {
      if (event.attempt >= 1 + DEFAULT_LIMITS.maxProviderRetries) {
        event.decision = { retry: false }
      }
    })

    await ctx.tool.hook("execute.before", (event) => {
      const raw = event as any
      const tool = String(raw.tool ?? "")
      if (tool.startsWith("loom_") || tool.startsWith("loom.")) return
      pendingToolInputs.set(toolEventKey(raw), raw.input)
    })

    await ctx.tool.hook("execute.after", async (event) => {
      const raw = event as any
      const tool = String(raw.tool ?? "")
      if (!tool || tool.startsWith("loom_") || tool.startsWith("loom.")) return
      if (!raw.sessionID) return

      const key = toolEventKey(raw)
      const input = raw.input ?? pendingToolInputs.get(key)
      pendingToolInputs.delete(key)

      const summary = safeInputSummary(tool, input)
      const observation: EvidenceObservation = {
        id: crypto.randomUUID(),
        sessionID: String(raw.sessionID),
        ...(raw.agent ? { agent: String(raw.agent) } : {}),
        tool,
        status: raw.status === "error" ? "error" : "completed",
        observedAt: new Date().toISOString(),
        ...(input === undefined ? {} : { inputDigest: await digest(input) }),
        ...(raw.status === "completed" ? { resultDigest: await digest(raw.result) } : {}),
        ...(raw.status === "error" ? { error: String(raw.error?.message ?? raw.error ?? "tool error").slice(0, 1000) } : {}),
        ...summary,
      }

      await ctx.storage.set(evidenceKey(observation.id), observation)
      await ctx.storage.set(`${sessionEvidencePrefix(observation.sessionID)}${observation.id}`, observation.id)
    })
  },
})
