import type * as OpenCodePlugin from "@opencode/plugin"
import {
  addVerificationRequirement,
  applyTaskPlan,
  buildSteps,
  plannedTaskSteps,
  preserveSatisfied,
  finishStep,
  openVerificationRequirements,
  proveVerificationRequirement,
  reconcileVerificationAfterRoute,
  reopenFrom,
  resetVerificationAfterReopen,
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
  observationsSupportKind,
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
import { shellResourcesAllowed } from "./shell"
import {
  heuristicsForEpisodes,
  proposeHeuristic,
  rankEpisodes,
  rankHeuristics,
  removeEpisodeSupport,
  retireEpisode,
  reviewHeuristic,
  type Episode,
  type Heuristic,
} from "./learning"
import {
  episodeIdFromRememberInput,
  episodeRecallPayload,
  rememberedMemoryId,
} from "./synabun"
import {
  acceptanceReadiness,
  createAcceptancePlan,
  recordAcceptanceResult,
  resetAcceptance,
  type AcceptancePlan,
} from "./acceptance"
import { taskStepId, validateTaskPlan, type TaskSpec } from "./tasks"
import {
  createKnowledgeReport,
  invalidateKnowledgeReport,
  type KnowledgeReport,
} from "./knowledge"
import {
  acceptIntent,
  askIntentQuestion,
  prepareIntentDraft,
  reopenIntent,
  resolveIntentQuestion,
  startIntent,
  type IntentDecisionSource,
  type IntentSession,
} from "./intent"

const loomAgents = new Set([
  "designer",
  "specifier",
  "architect",
  "reviewer",
  "critic",
  "acceptance",
  "planner",
  "documenter",
  "worker",
  "research",
  "diagnostic",
])

function intentKey(id: string) {
  return `intent/${id}`
}

function sessionIntentKey(sessionID: string) {
  return `session-intent/${sessionID}`
}

async function readIntent(ctx: any, id: string): Promise<IntentSession | undefined> {
  return (await ctx.storage.get(intentKey(id))) as IntentSession | undefined
}

async function activeIntent(ctx: any, sessionID: string): Promise<IntentSession | undefined> {
  const id = (await ctx.storage.get(sessionIntentKey(sessionID))) as string | undefined
  return id ? readIntent(ctx, id) : undefined
}

function episodeKey(id: string) {
  return `episode/${id}`
}

function claimIdKey(id: string) {
  return `evidence-claim-id/${id}`
}

function heuristicKey(id: string) {
  return `heuristic/${id}`
}

function acceptanceKey(workflowId: string) {
  return `acceptance/${workflowId}`
}

function knowledgeKey(workflowId: string) {
  return `knowledge/${workflowId}`
}

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

const loomPlugin: Parameters<typeof OpenCodePlugin.Plugin.define>[0] = {
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
        name: "intent_start",
        description:
          "Start Loom intent shaping from a fuzzy product idea. General only. Use before an accepted Anchor exists.",
        input: {
          type: "object",
          properties: {
            seed: { type: "string" },
          },
          required: ["seed"],
          additionalProperties: false,
        },
        options: { namespace: "loom", codemode: false },
        execute: async (input, tool) => {
          if (tool.agent !== "general") {
            return { content: JSON.stringify({ error: "Only general may run Loom intent shaping." }) }
          }

          const existing = await activeIntent(ctx, tool.sessionID)
          if (existing && existing.state !== "accepted") {
            return { content: JSON.stringify({ error: "An active intent interview already exists.", intent: existing }) }
          }

          try {
            const session = startIntent((input as { seed: string }).seed, new Date().toISOString())
            await ctx.storage.set(intentKey(session.id), session)
            await ctx.storage.set(sessionIntentKey(tool.sessionID), session.id)
            return { content: JSON.stringify({ intent: session }) }
          } catch (error) {
            return { content: JSON.stringify({ error: error instanceof Error ? error.message : String(error) }) }
          }
        },
      })

      editor.add({
        name: "intent_status",
        description: "Inspect the active Loom intent interview or one explicit intent id.",
        input: {
          type: "object",
          properties: {
            intentId: { type: "string" },
          },
          additionalProperties: false,
        },
        options: { namespace: "loom", codemode: false },
        execute: async (input, tool) => {
          const requested = (input as { intentId?: string }).intentId
          const session = requested ? await readIntent(ctx, requested) : await activeIntent(ctx, tool.sessionID)
          return { content: JSON.stringify({ intent: session ?? null }) }
        },
      })

      editor.add({
        name: "intent_question",
        description:
          "Register exactly one user-owned interview question with Loom's recommended answer and rationale. General only.",
        input: {
          type: "object",
          properties: {
            branch: { type: "string" },
            question: { type: "string" },
            recommendation: { type: "string" },
            why: { type: "string" },
          },
          required: ["branch", "question", "recommendation", "why"],
          additionalProperties: false,
        },
        options: { namespace: "loom", codemode: false },
        execute: async (input, tool) => {
          if (tool.agent !== "general") {
            return { content: JSON.stringify({ error: "Only general may ask Loom intent questions." }) }
          }
          const session = await activeIntent(ctx, tool.sessionID)
          if (!session) return { content: JSON.stringify({ error: "No active intent interview." }) }

          const value = input as { branch: string; question: string; recommendation: string; why: string }
          try {
            const openQuestion = askIntentQuestion({
              session,
              ...value,
              now: new Date().toISOString(),
            })
            await ctx.storage.set(intentKey(session.id), session)
            return { content: JSON.stringify({ intentId: session.id, openQuestion }) }
          } catch (error) {
            return { content: JSON.stringify({ error: error instanceof Error ? error.message : String(error) }) }
          }
        },
      })

      editor.add({
        name: "intent_resolve",
        description:
          "Resolve the current intent branch from the exact user answer or from repository/research evidence. General only.",
        input: {
          type: "object",
          properties: {
            resolution: { type: "string" },
            source: { type: "string", enum: ["user", "repository", "research"] },
            evidence: { type: "array", items: { type: "string" } },
          },
          required: ["resolution", "source"],
          additionalProperties: false,
        },
        options: { namespace: "loom", codemode: false },
        execute: async (input, tool) => {
          if (tool.agent !== "general") {
            return { content: JSON.stringify({ error: "Only general may resolve Loom intent branches." }) }
          }
          const session = await activeIntent(ctx, tool.sessionID)
          if (!session) return { content: JSON.stringify({ error: "No active intent interview." }) }

          const value = input as {
            resolution: string
            source: IntentDecisionSource
            evidence?: string[]
          }
          try {
            const decision = resolveIntentQuestion({
              session,
              resolution: value.resolution,
              source: value.source,
              evidence: value.evidence,
              now: new Date().toISOString(),
            })
            await ctx.storage.set(intentKey(session.id), session)
            return { content: JSON.stringify({ intentId: session.id, decision }) }
          } catch (error) {
            return { content: JSON.stringify({ error: error instanceof Error ? error.message : String(error) }) }
          }
        },
      })

      editor.add({
        name: "intent_prepare",
        description:
          "Mark the interview draft-ready after goal, observable success, scope, exclusions, user-owned decisions, and context are sufficiently resolved.",
        input: {
          type: "object",
          properties: {
            goal: { type: "string" },
            success: { type: "array", items: { type: "string" } },
            scope: { type: "array", items: { type: "string" } },
            exclusions: { type: "array", items: { type: "string" } },
            userOwned: { type: "array", items: { type: "string" } },
            context: { type: "array", items: { type: "string" } },
          },
          required: ["goal", "success", "scope", "exclusions", "userOwned", "context"],
          additionalProperties: false,
        },
        options: { namespace: "loom", codemode: false },
        execute: async (input, tool) => {
          if (tool.agent !== "general") {
            return { content: JSON.stringify({ error: "Only general may prepare a Loom Anchor draft." }) }
          }
          const session = await activeIntent(ctx, tool.sessionID)
          if (!session) return { content: JSON.stringify({ error: "No active intent interview." }) }

          const value = input as {
            goal: string
            success: string[]
            scope: string[]
            exclusions: string[]
            userOwned: string[]
            context: string[]
          }
          try {
            const draft = prepareIntentDraft({
              session,
              ...value,
              now: new Date().toISOString(),
            })
            await ctx.storage.set(intentKey(session.id), session)
            return { content: JSON.stringify({ intentId: session.id, draft }) }
          } catch (error) {
            return { content: JSON.stringify({ error: error instanceof Error ? error.message : String(error) }) }
          }
        },
      })

      editor.add({
        name: "intent_reopen",
        description: "Return a draft-ready intent to interviewing after the user requests a correction. General only.",
        input: {
          type: "object",
          properties: {},
          additionalProperties: false,
        },
        options: { namespace: "loom", codemode: false },
        execute: async (_input, tool) => {
          if (tool.agent !== "general") {
            return { content: JSON.stringify({ error: "Only general may reopen Loom intent." }) }
          }
          const session = await activeIntent(ctx, tool.sessionID)
          if (!session) return { content: JSON.stringify({ error: "No active intent interview." }) }
          try {
            reopenIntent(session)
            await ctx.storage.set(intentKey(session.id), session)
            return { content: JSON.stringify({ intent: session }) }
          } catch (error) {
            return { content: JSON.stringify({ error: error instanceof Error ? error.message : String(error) }) }
          }
        },
      })

      editor.add({
        name: "intent_accept",
        description:
          "Record the explicit user acceptance boundary for a completed Anchor. General only; provide the exact user confirmation text.",
        input: {
          type: "object",
          properties: {
            anchorPath: { type: "string" },
            confirmation: { type: "string" },
          },
          required: ["anchorPath", "confirmation"],
          additionalProperties: false,
        },
        options: { namespace: "loom", codemode: false },
        execute: async (input, tool) => {
          if (tool.agent !== "general") {
            return { content: JSON.stringify({ error: "Only general may record Anchor acceptance." }) }
          }
          const session = await activeIntent(ctx, tool.sessionID)
          if (!session) return { content: JSON.stringify({ error: "No active intent interview." }) }

          const value = input as { anchorPath: string; confirmation: string }
          if (!value.anchorPath.replaceAll("\\", "/").startsWith("docs/anchors/")) {
            return { content: JSON.stringify({ error: "Accepted Anchor must live under docs/anchors/**." }) }
          }

          try {
            const accepted = acceptIntent({
              session,
              anchorPath: value.anchorPath,
              confirmation: value.confirmation,
              now: new Date().toISOString(),
            })
            await ctx.storage.set(intentKey(session.id), session)
            return {
              content: JSON.stringify({
                intentId: session.id,
                accepted,
                next: {
                  tool: "loom_start",
                  anchor: accepted.path,
                  continueAutomatically: true,
                },
              }),
            }
          } catch (error) {
            return { content: JSON.stringify({ error: error instanceof Error ? error.message : String(error) }) }
          }
        },
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
        options: { namespace: "loom", codemode: false },
        execute: async (input, tool) => {
          if (tool.agent !== "general") {
            return { content: JSON.stringify({ error: "Only general may start a Loom workflow." }) }
          }

          const { anchor } = input as { anchor: string }
          const intent = await activeIntent(ctx, tool.sessionID)
          if (intent && intent.state !== "accepted") {
            return {
              content: JSON.stringify({
                error: "Cannot start autonomous execution while intent shaping is unresolved.",
                intentState: intent.state,
              }),
            }
          }
          if (intent?.acceptedAnchor && intent.acceptedAnchor.path !== anchor) {
            return {
              content: JSON.stringify({
                error: "Workflow Anchor does not match the accepted intent Anchor.",
                acceptedAnchor: intent.acceptedAnchor.path,
              }),
            }
          }

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
          if (intent?.acceptedAnchor?.path === anchor) {
            await ctx.storage.set(sessionIntentKey(tool.sessionID), "")
          }
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
        options: { namespace: "loom", codemode: false },
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
              (
                ["worker", "plan", "review-implementation", "critic-final"].includes(step.id) ||
                step.id.startsWith("task:")
              ) &&
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
        options: { namespace: "loom", codemode: false },
        execute: async (input, tool) => {
          const requested = (input as { workflowId?: string }).workflowId
          const workflow = requested
            ? await readWorkflow(ctx, requested)
            : await activeWorkflow(ctx, tool.sessionID)

          if (!workflow) return { content: JSON.stringify({ error: "Workflow not found." }) }

          const questions = await readQuestions(ctx, workflow.id)
          const limits = await readLimits(ctx, workflow.id)
          const budget = await readBudget(ctx, workflow.id)
          const acceptance = (await ctx.storage.get(acceptanceKey(workflow.id))) as AcceptancePlan | undefined
          const knowledge = (await ctx.storage.get(knowledgeKey(workflow.id))) as KnowledgeReport | undefined
          return {
            content: JSON.stringify({
              workflow,
              runnable: runnable(workflow).map((step) => ({ id: step.id, agent: step.agent })),
              questions: questionState(questions, workflow),
              budget: { limits, state: budget },
              acceptance: acceptance
                ? { plan: acceptance, readiness: acceptanceReadiness(acceptance) }
                : null,
              knowledge: knowledge ?? null,
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
        options: { namespace: "loom", codemode: false },
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
            return { content: JSON.stringify({ error: "Gate step requires outcome pass or fail." }) }
          }

          if (stepId === "plan" && plannedTaskSteps(workflow).length === 0) {
            return { content: JSON.stringify({ error: "Planning step cannot complete before a validated task graph exists." }) }
          }

          if (stepId === "knowledge-sync") {
            const report = (await ctx.storage.get(knowledgeKey(workflowId))) as KnowledgeReport | undefined
            if (!report?.valid) {
              return { content: JSON.stringify({ error: "Knowledge sync cannot complete without a valid OKF-verified knowledge report." }) }
            }
          }

          if (stepId === "product-acceptance") {
            const plan = (await ctx.storage.get(acceptanceKey(workflowId))) as AcceptancePlan | undefined
            if (!plan) {
              return { content: JSON.stringify({ error: "Product Acceptance plan is missing." }) }
            }
            const readiness = acceptanceReadiness(plan)
            if (readiness === "pending") {
              return { content: JSON.stringify({ error: "Product Acceptance still has pending scenarios.", readiness }) }
            }
            if (resolvedOutcome === "pass" && readiness !== "passed") {
              return { content: JSON.stringify({ error: "Product Acceptance cannot PASS unless every scenario passed.", readiness }) }
            }
            if (resolvedOutcome === "fail" && readiness === "passed") {
              return { content: JSON.stringify({ error: "Product Acceptance cannot FAIL when every scenario passed.", readiness }) }
            }
          }

          if (stepId === "review-product" && resolvedOutcome === "pass") {
            const plan = (await ctx.storage.get(acceptanceKey(workflowId))) as AcceptancePlan | undefined
            if (!plan || acceptanceReadiness(plan) !== "passed") {
              return { content: JSON.stringify({ error: "Product review cannot PASS without passed Product Acceptance." }) }
            }
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
        options: { namespace: "loom", codemode: false },
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

            if (reset.includes("product-acceptance")) {
              const acceptance = (await ctx.storage.get(acceptanceKey(workflowId))) as AcceptancePlan | undefined
              if (acceptance) {
                resetAcceptance(acceptance)
                await ctx.storage.set(acceptanceKey(workflowId), acceptance)
              }
            }

            if (reset.includes("knowledge-sync")) {
              const knowledge = (await ctx.storage.get(knowledgeKey(workflowId))) as KnowledgeReport | undefined
              if (knowledge) {
                invalidateKnowledgeReport(knowledge)
                await ctx.storage.set(knowledgeKey(workflowId), knowledge)
              }
            }

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
        options: { namespace: "loom", codemode: false },
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
        options: { namespace: "loom", codemode: false },
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
        options: { namespace: "loom", codemode: false },
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
        options: { namespace: "loom", codemode: false },
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
        options: { namespace: "loom", codemode: false },
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
        options: { namespace: "loom", codemode: false },
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
        options: { namespace: "loom", codemode: false },
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
            await ctx.storage.set(claimIdKey(claim.id), claim)

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
        options: { namespace: "loom", codemode: false },
        execute: async (input) => {
          const { workflowId, stepId } = input as { workflowId: string; stepId: string }
          const observations = await stepObservations(ctx, workflowId, stepId)
          const claims = await stepClaims(ctx, workflowId, stepId)
          return { content: JSON.stringify({ observations, claims }) }
        },
      })


      editor.add({
        name: "knowledge_record",
        description:
          "Record the current living-documentation outcome for knowledge-sync. Requires observed successful OKF-MCP discovery/verification from this Documenter session.",
        input: {
          type: "object",
          properties: {
            workflowId: { type: "string" },
            changedDocs: { type: "array", items: { type: "string" } },
            unchangedReason: { type: "string" },
            okfObservationIds: { type: "array", items: { type: "string" } },
          },
          required: ["workflowId", "changedDocs", "okfObservationIds"],
          additionalProperties: false,
        },
        options: { namespace: "loom", codemode: false },
        execute: async (input, tool) => {
          if (tool.agent !== "documenter") {
            return { content: JSON.stringify({ error: "Only documenter may record knowledge-sync results." }) }
          }

          const value = input as {
            workflowId: string
            changedDocs: string[]
            unchangedReason?: string
            okfObservationIds: string[]
          }

          const workflow = await readWorkflow(ctx, value.workflowId)
          if (!workflow) return { content: JSON.stringify({ error: "Workflow not found." }) }

          const attachedWorkflow = (await ctx.storage.get(sessionKey(tool.sessionID))) as string | undefined
          const attachedStep = (await ctx.storage.get(sessionStepKey(tool.sessionID))) as string | undefined
          if (attachedWorkflow !== value.workflowId || attachedStep !== "knowledge-sync") {
            return { content: JSON.stringify({ error: "Documenter must attach to this workflow's knowledge-sync step first." }) }
          }

          const available = await sessionObservations(ctx, tool.sessionID)
          const byID = new Map(available.map((observation) => [observation.id, observation]))
          const observations = value.okfObservationIds
            .map((id) => byID.get(id))
            .filter((observation): observation is EvidenceObservation => Boolean(observation))

          if (observations.length !== value.okfObservationIds.length) {
            return { content: JSON.stringify({ error: "Every OKF observation id must belong to the current Documenter session." }) }
          }

          try {
            const report = createKnowledgeReport({
              workflowId: value.workflowId,
              changedDocs: value.changedDocs,
              unchangedReason: value.unchangedReason,
              observations,
              recordedBy: tool.agent,
              now: new Date().toISOString(),
            })
            await ctx.storage.set(knowledgeKey(value.workflowId), report)
            return { content: JSON.stringify({ report }) }
          } catch (error) {
            return { content: JSON.stringify({ error: error instanceof Error ? error.message : String(error) }) }
          }
        },
      })

      editor.add({
        name: "knowledge_status",
        description: "Inspect the current workflow's living-documentation report.",
        input: {
          type: "object",
          properties: { workflowId: { type: "string" } },
          required: ["workflowId"],
          additionalProperties: false,
        },
        options: { namespace: "loom", codemode: false },
        execute: async (input) => {
          const { workflowId } = input as { workflowId: string }
          const report = (await ctx.storage.get(knowledgeKey(workflowId))) as KnowledgeReport | undefined
          return { content: JSON.stringify({ report: report ?? null }) }
        },
      })

      editor.add({
        name: "pa_plan",
        description:
          "Create or replace the current Product Acceptance scenario plan before results are recorded. Scenarios must map to accepted Anchor/requirement criteria.",
        input: {
          type: "object",
          properties: {
            workflowId: { type: "string" },
            scenarios: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  id: { type: "string" },
                  title: { type: "string" },
                  criteria: { type: "array", items: { type: "string" } },
                },
                required: ["id", "title", "criteria"],
                additionalProperties: false,
              },
            },
          },
          required: ["workflowId", "scenarios"],
          additionalProperties: false,
        },
        options: { namespace: "loom", codemode: false },
        execute: async (input, tool) => {
          if (!["acceptance", "specifier", "reviewer"].includes(tool.agent)) {
            return { content: JSON.stringify({ error: "Only acceptance, specifier, or reviewer may define Product Acceptance scenarios." }) }
          }

          const value = input as {
            workflowId: string
            scenarios: Array<{ id: string; title: string; criteria: string[] }>
          }
          const workflow = await readWorkflow(ctx, value.workflowId)
          if (!workflow) return { content: JSON.stringify({ error: "Workflow not found." }) }
          if (!workflow.steps.some((step) => step.id === "product-acceptance")) {
            return { content: JSON.stringify({ error: "Workflow does not require Product Acceptance." }) }
          }

          const existing = (await ctx.storage.get(acceptanceKey(value.workflowId))) as AcceptancePlan | undefined
          if (existing?.scenarios.some((scenario) => scenario.outcome !== "pending")) {
            return { content: JSON.stringify({ error: "Product Acceptance plan cannot change after results exist; reopen/reset first." }) }
          }

          try {
            const plan = createAcceptancePlan({
              workflowId: value.workflowId,
              createdBy: tool.agent,
              scenarios: value.scenarios,
              now: new Date().toISOString(),
            })
            await ctx.storage.set(acceptanceKey(value.workflowId), plan)
            return { content: JSON.stringify({ plan, readiness: acceptanceReadiness(plan) }) }
          } catch (error) {
            return { content: JSON.stringify({ error: error instanceof Error ? error.message : String(error) }) }
          }
        },
      })

      editor.add({
        name: "pa_status",
        description: "Inspect Product Acceptance scenarios, results, evidence references, and readiness.",
        input: {
          type: "object",
          properties: { workflowId: { type: "string" } },
          required: ["workflowId"],
          additionalProperties: false,
        },
        options: { namespace: "loom", codemode: false },
        execute: async (input) => {
          const { workflowId } = input as { workflowId: string }
          const plan = (await ctx.storage.get(acceptanceKey(workflowId))) as AcceptancePlan | undefined
          return {
            content: JSON.stringify({
              plan: plan ?? null,
              readiness: plan ? acceptanceReadiness(plan) : "missing",
            }),
          }
        },
      })

      editor.add({
        name: "pa_result",
        description:
          "Record one immutable Product Acceptance scenario result for the current attempt. PASS requires product-acceptance evidence claims from the Product Acceptance step.",
        input: {
          type: "object",
          properties: {
            workflowId: { type: "string" },
            scenarioId: { type: "string" },
            outcome: { type: "string", enum: ["passed", "failed", "unproven"] },
            evidenceClaimIds: { type: "array", items: { type: "string" } },
            note: { type: "string" },
          },
          required: ["workflowId", "scenarioId", "outcome", "evidenceClaimIds", "note"],
          additionalProperties: false,
        },
        options: { namespace: "loom", codemode: false },
        execute: async (input, tool) => {
          if (tool.agent !== "acceptance") {
            return { content: JSON.stringify({ error: "Only acceptance may record Product Acceptance results." }) }
          }

          const value = input as {
            workflowId: string
            scenarioId: string
            outcome: "passed" | "failed" | "unproven"
            evidenceClaimIds: string[]
            note: string
          }
          const plan = (await ctx.storage.get(acceptanceKey(value.workflowId))) as AcceptancePlan | undefined
          if (!plan) return { content: JSON.stringify({ error: "Product Acceptance plan not found." }) }

          const records = await Promise.all(
            value.evidenceClaimIds.map((id) => ctx.storage.get(claimIdKey(id)) as Promise<EvidenceClaim | undefined>),
          )
          const claims = records.filter((claim): claim is EvidenceClaim => Boolean(claim))
          if (claims.length !== value.evidenceClaimIds.length) {
            return { content: JSON.stringify({ error: "Every Product Acceptance evidence claim id must exist." }) }
          }
          if (claims.some((claim) => claim.byAgent !== "acceptance")) {
            return { content: JSON.stringify({ error: "Product Acceptance evidence claims must be produced by acceptance." }) }
          }

          try {
            const scenario = recordAcceptanceResult({
              plan,
              scenarioId: value.scenarioId,
              outcome: value.outcome,
              claims,
              byAgent: tool.agent,
              note: value.note,
              now: new Date().toISOString(),
            })
            await ctx.storage.set(acceptanceKey(value.workflowId), plan)
            return {
              content: JSON.stringify({
                scenario,
                readiness: acceptanceReadiness(plan),
              }),
            }
          } catch (error) {
            return { content: JSON.stringify({ error: error instanceof Error ? error.message : String(error) }) }
          }
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
        options: { namespace: "loom", codemode: false },
        execute: async (input) => {
          const { workflowId } = input as { workflowId: string }
          const limits = await readLimits(ctx, workflowId)
          const state = await readBudget(ctx, workflowId)
          return { content: JSON.stringify({ limits, state }) }
        },
      })


      editor.add({
        name: "task_plan",
        description:
          "Create or replace the bounded Worker task DAG for a product workflow. Planner only. Tasks become real workflow steps with immutable write scopes.",
        input: {
          type: "object",
          properties: {
            workflowId: { type: "string" },
            tasks: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  id: { type: "string" },
                  title: { type: "string" },
                  objective: { type: "string" },
                  dependsOn: { type: "array", items: { type: "string" } },
                  write: { type: "array", items: { type: "string" } },
                  skills: { type: "array", items: { type: "string" } },
                  verify: { type: "array", items: { type: "string" } },
                },
                required: ["id", "title", "objective", "dependsOn", "write", "skills", "verify"],
                additionalProperties: false,
              },
            },
          },
          required: ["workflowId", "tasks"],
          additionalProperties: false,
        },
        options: { namespace: "loom", codemode: false },
        execute: async (input, tool) => {
          if (tool.agent !== "planner") {
            return { content: JSON.stringify({ error: "Only planner may define the Worker task graph." }) }
          }

          const value = input as { workflowId: string; tasks: TaskSpec[] }
          const workflow = await readWorkflow(ctx, value.workflowId)
          if (!workflow) return { content: JSON.stringify({ error: "Workflow not found." }) }

          const planStep = workflow.steps.find((step) => step.id === "plan")
          if (!planStep) return { content: JSON.stringify({ error: "Workflow has no planning step." }) }
          if (!runnable(workflow).some((step) => step.id === "plan")) {
            return { content: JSON.stringify({ error: "Planning step is not currently runnable." }) }
          }

          try {
            const tasks = validateTaskPlan(value.tasks)
            const steps = applyTaskPlan(workflow, tasks)

            for (const step of steps) {
              const scope: TaskScope = {
                workflowId: value.workflowId,
                stepId: step.id,
                write: step.task!.write,
              }
              await ctx.storage.set(scopeKey(value.workflowId, step.id), scope)
            }

            await ctx.storage.set(workflowKey(workflow.id), workflow)
            return {
              content: JSON.stringify({
                tasks: steps.map((step) => ({
                  stepId: step.id,
                  task: step.task,
                  dependsOn: step.dependsOn,
                })),
              }),
            }
          } catch (error) {
            return { content: JSON.stringify({ error: error instanceof Error ? error.message : String(error) }) }
          }
        },
      })

      editor.add({
        name: "task_status",
        description: "Inspect planned Worker tasks, status, dependencies, scopes, skills, and currently runnable tasks.",
        input: {
          type: "object",
          properties: { workflowId: { type: "string" } },
          required: ["workflowId"],
          additionalProperties: false,
        },
        options: { namespace: "loom", codemode: false },
        execute: async (input) => {
          const { workflowId } = input as { workflowId: string }
          const workflow = await readWorkflow(ctx, workflowId)
          if (!workflow) return { content: JSON.stringify({ error: "Workflow not found." }) }
          const tasks = plannedTaskSteps(workflow)
          const runnableIDs = new Set(runnable(workflow).map((step) => step.id))
          return {
            content: JSON.stringify({
              tasks: tasks.map((step) => ({
                stepId: step.id,
                status: step.status,
                runnable: runnableIDs.has(step.id),
                dependsOn: step.dependsOn,
                task: step.task,
              })),
            }),
          }
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
        options: { namespace: "loom", codemode: false },
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
          if (step.task) {
            return { content: JSON.stringify({ error: "Planned task scope is immutable; reopen the planning step to change it." }) }
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
        options: { namespace: "loom", codemode: false },
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

          if (!runnable(workflow).some((candidate) => candidate.id === stepId)) {
            return { content: JSON.stringify({ error: "Step is not currently runnable; dependencies or prior gates are incomplete." }) }
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
              ...(step.task ? { task: step.task } : {}),
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
        options: { namespace: "loom", codemode: false },
        execute: async (input) => {
          const { workflowId, stepId } = input as { workflowId: string; stepId: string }
          const scope = (await ctx.storage.get(scopeKey(workflowId, stepId))) as TaskScope | undefined
          return { content: JSON.stringify({ scope: scope ?? null }) }
        },
      })

      editor.add({
        name: "learn_record",
        description:
          "Record one evidence-backed episodic lesson from current work. Learning is advisory and never becomes product authority.",
        input: {
          type: "object",
          properties: {
            subject: { type: "string" },
            lesson: { type: "string" },
            evidenceRefs: { type: "array", items: { type: "string" } },
            tags: { type: "array", items: { type: "string" } },
            workflowId: { type: "string" },
          },
          required: ["subject", "lesson", "evidenceRefs", "tags"],
          additionalProperties: false,
        },
        options: { namespace: "loom", codemode: false },
        execute: async (input, tool) => {
          const value = input as {
            subject: string
            lesson: string
            evidenceRefs: string[]
            tags: string[]
            workflowId?: string
          }

          if (value.evidenceRefs.length === 0) {
            return { content: JSON.stringify({ error: "A durable learning episode needs at least one evidence reference." }) }
          }

          const checked = await Promise.all(
            value.evidenceRefs.map(async (id) => ({
              id,
              exists: Boolean(
                (await ctx.storage.get(evidenceKey(id))) ||
                (await ctx.storage.get(claimIdKey(id))),
              ),
            })),
          )
          const missing = checked.filter((entry) => !entry.exists).map((entry) => entry.id)
          if (missing.length > 0) {
            return { content: JSON.stringify({ error: "Every learning evidence reference must exist in the Loom evidence ledger.", missing }) }
          }

          const episode: Episode = {
            id: crypto.randomUUID(),
            project: ctx.location.project.canonical,
            ...(value.workflowId ? { workflowId: value.workflowId } : {}),
            subject: value.subject,
            lesson: value.lesson,
            evidenceRefs: [...new Set(value.evidenceRefs)],
            tags: [...new Set(value.tags.map((tag) => tag.toLowerCase()))],
            createdBy: tool.agent,
            createdAt: new Date().toISOString(),
            status: "active",
            synabun: { status: "pending" },
          }

          await ctx.storage.set(episodeKey(episode.id), episode)
          return {
            content: JSON.stringify({
              episode,
              synabunRemember: episodeRecallPayload(episode),
            }),
          }
        },
      })

      editor.add({
        name: "learn_query",
        description:
          "Local lexical fallback for canonical Loom learning records. Prefer SynaBun_recall for semantic recall, then verify recalled Loom ids with loom_learn_get.",
        input: {
          type: "object",
          properties: {
            query: { type: "string" },
            projectOnly: { type: "boolean" },
            limit: { type: "number" },
          },
          required: ["query"],
          additionalProperties: false,
        },
        options: { namespace: "loom", codemode: false },
        execute: async (input) => {
          const value = input as { query: string; projectOnly?: boolean; limit?: number }
          const limit = Math.max(1, Math.min(value.limit ?? 10, 25))

          let episodes = await scanValues<Episode>(ctx, "episode/")
          if (value.projectOnly) {
            episodes = episodes.filter((episode) => episode.project === ctx.location.project.canonical)
          }
          const heuristics = await scanValues<Heuristic>(ctx, "heuristic/")

          return {
            content: JSON.stringify({
              advisory: true,
              semantic: false,
              episodes: rankEpisodes(value.query, episodes).slice(0, limit).map((entry) => entry.value),
              heuristics: rankHeuristics(value.query, heuristics).slice(0, limit).map((entry) => entry.value),
            }),
          }
        },
      })


      editor.add({
        name: "learn_get",
        description:
          "Resolve exact canonical Loom learning records after semantic recall. Retired records are returned with their current status so stale SynaBun hits cannot silently govern work.",
        input: {
          type: "object",
          properties: {
            episodeIds: { type: "array", items: { type: "string" } },
            heuristicIds: { type: "array", items: { type: "string" } },
          },
          additionalProperties: false,
        },
        options: { namespace: "loom", codemode: false },
        execute: async (input) => {
          const value = input as { episodeIds?: string[]; heuristicIds?: string[] }
          const episodeIds = [...new Set(value.episodeIds ?? [])]
          const heuristicIds = [...new Set(value.heuristicIds ?? [])]

          const episodeRecords = await Promise.all(
            episodeIds.map((id) => ctx.storage.get(episodeKey(id)) as Promise<Episode | undefined>),
          )
          const episodes = episodeRecords.filter((episode): episode is Episode => Boolean(episode))

          const heuristicRecords = await Promise.all(
            heuristicIds.map((id) => ctx.storage.get(heuristicKey(id)) as Promise<Heuristic | undefined>),
          )
          const direct = heuristicRecords.filter((heuristic): heuristic is Heuristic => Boolean(heuristic))
          const allHeuristics = await scanValues<Heuristic>(ctx, "heuristic/")
          const related = heuristicsForEpisodes(episodeIds, allHeuristics)
          const heuristics = [...new Map([...direct, ...related].map((item) => [item.id, item])).values()]

          return {
            content: JSON.stringify({
              authoritative: false,
              canonical: true,
              episodes,
              heuristics,
            }),
          }
        },
      })

      editor.add({
        name: "learn_retire",
        description:
          "Retire a stale or contradicted episodic lesson. Reviewer or Critic only. Retired lessons remain auditable but are excluded from normal recall.",
        input: {
          type: "object",
          properties: {
            episodeId: { type: "string" },
            reason: { type: "string" },
          },
          required: ["episodeId", "reason"],
          additionalProperties: false,
        },
        options: { namespace: "loom", codemode: false },
        execute: async (input, tool) => {
          if (tool.agent !== "reviewer" && tool.agent !== "critic") {
            return { content: JSON.stringify({ error: "Only reviewer or critic may retire learning episodes." }) }
          }

          const value = input as { episodeId: string; reason: string }
          const episode = (await ctx.storage.get(episodeKey(value.episodeId))) as Episode | undefined
          if (!episode) return { content: JSON.stringify({ error: "Episode not found." }) }

          try {
            retireEpisode({
              episode,
              reviewer: tool.agent,
              reason: value.reason,
              now: new Date().toISOString(),
            })
            await ctx.storage.set(episodeKey(episode.id), episode)

            const heuristics = await scanValues<Heuristic>(ctx, "heuristic/")
            const affected: Heuristic[] = []
            for (const heuristic of heuristics) {
              if (removeEpisodeSupport(heuristic, episode.id)) {
                await ctx.storage.set(heuristicKey(heuristic.id), heuristic)
                affected.push(heuristic)
              }
            }

            return {
              content: JSON.stringify({
                episode,
                affectedHeuristics: affected,
                ...(episode.synabun.memoryId
                  ? { synabunForget: { memory_id: episode.synabun.memoryId } }
                  : {}),
              }),
            }
          } catch (error) {
            return { content: JSON.stringify({ error: error instanceof Error ? error.message : String(error) }) }
          }
        },
      })


      editor.add({
        name: "learn_unsynced",
        description:
          "List active canonical learning episodes whose SynaBun semantic copy is pending or failed.",
        input: {
          type: "object",
          properties: {
            limit: { type: "number" },
          },
          additionalProperties: false,
        },
        options: { namespace: "loom", codemode: false },
        execute: async (input) => {
          const value = input as { limit?: number }
          const limit = Math.max(1, Math.min(value.limit ?? 25, 100))
          const episodes = await scanValues<Episode>(ctx, "episode/")
          const unsynced = episodes
            .filter((episode) => episode.status === "active" && episode.synabun.status !== "synced")
            .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
            .slice(0, limit)
            .map((episode) => ({
              episode,
              synabunRemember: episodeRecallPayload(episode),
            }))

          return { content: JSON.stringify({ unsynced }) }
        },
      })

      editor.add({
        name: "heuristic_propose",
        description:
          "Propose a reusable heuristic from one or more recorded episodes. New heuristics are always provisional.",
        input: {
          type: "object",
          properties: {
            statement: { type: "string" },
            scope: { type: "string" },
            episodeIds: { type: "array", items: { type: "string" } },
          },
          required: ["statement", "scope", "episodeIds"],
          additionalProperties: false,
        },
        options: { namespace: "loom", codemode: false },
        execute: async (input, tool) => {
          const value = input as { statement: string; scope: string; episodeIds: string[] }
          const records = await Promise.all(
            value.episodeIds.map((id) => ctx.storage.get(episodeKey(id)) as Promise<Episode | undefined>),
          )
          const episodes = records.filter((episode): episode is Episode => Boolean(episode))

          if (episodes.length !== value.episodeIds.length) {
            return { content: JSON.stringify({ error: "Every supporting episode id must exist." }) }
          }

          try {
            const heuristic = proposeHeuristic({
              id: crypto.randomUUID(),
              statement: value.statement,
              scope: value.scope,
              proposedBy: tool.agent,
              episodes,
              now: new Date().toISOString(),
            })
            await ctx.storage.set(heuristicKey(heuristic.id), heuristic)
            return { content: JSON.stringify({ heuristic }) }
          } catch (error) {
            return { content: JSON.stringify({ error: error instanceof Error ? error.message : String(error) }) }
          }
        },
      })

      editor.add({
        name: "heuristic_review",
        description:
          "Validate or retire a heuristic. Only Reviewer or Critic may do this; validation requires repeated supporting episodes.",
        input: {
          type: "object",
          properties: {
            heuristicId: { type: "string" },
            action: { type: "string", enum: ["validate", "retire"] },
            episodeIds: { type: "array", items: { type: "string" } },
            note: { type: "string" },
          },
          required: ["heuristicId", "action", "episodeIds", "note"],
          additionalProperties: false,
        },
        options: { namespace: "loom", codemode: false },
        execute: async (input, tool) => {
          if (tool.agent !== "reviewer" && tool.agent !== "critic") {
            return { content: JSON.stringify({ error: "Only reviewer or critic may validate or retire heuristics." }) }
          }

          const value = input as {
            heuristicId: string
            action: "validate" | "retire"
            episodeIds: string[]
            note: string
          }
          const heuristic = (await ctx.storage.get(heuristicKey(value.heuristicId))) as Heuristic | undefined
          if (!heuristic) return { content: JSON.stringify({ error: "Heuristic not found." }) }

          const records = await Promise.all(
            value.episodeIds.map((id) => ctx.storage.get(episodeKey(id)) as Promise<Episode | undefined>),
          )
          const episodes = records.filter((episode): episode is Episode => Boolean(episode))
          if (episodes.length !== value.episodeIds.length) {
            return { content: JSON.stringify({ error: "Every review episode id must exist." }) }
          }

          try {
            reviewHeuristic({
              heuristic,
              reviewer: tool.agent,
              action: value.action,
              episodes,
              note: value.note,
              now: new Date().toISOString(),
            })
            await ctx.storage.set(heuristicKey(heuristic.id), heuristic)
            return { content: JSON.stringify({ heuristic }) }
          } catch (error) {
            return { content: JSON.stringify({ error: error instanceof Error ? error.message : String(error) }) }
          }
        },
      })

    })

    await ctx.permission.hook("evaluate", async (event) => {
      if (event.agent === "worker" && event.action === "shell") {
        if (!shellResourcesAllowed(event.resources)) {
          event.effect = "deny"
          event.message = "Worker shell is limited to Loom's inspection and verification allowlist. Use scoped edit tools for source mutation."
        }
        return
      }

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

      if (tool.toLowerCase().includes("synabun") && /(?:^|_)remember$/i.test(tool)) {
        const episodeId = episodeIdFromRememberInput(input)
        if (episodeId) {
          const episode = (await ctx.storage.get(episodeKey(episodeId))) as Episode | undefined
          if (episode) {
            if (raw.status === "error") {
              episode.synabun = { ...episode.synabun, status: "failed" }
            } else {
              const memoryId = rememberedMemoryId(raw.result)
              if (memoryId) {
                episode.synabun = {
                  status: "synced",
                  memoryId,
                  syncedAt: new Date().toISOString(),
                }
              }
            }
            await ctx.storage.set(episodeKey(episode.id), episode)
          }
        }
      }

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
}

export default loomPlugin
