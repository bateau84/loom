import type * as OpenCodePlugin from "@opencode/plugin"
import { RUNTIME_STATE_VERSION, consumeDispatchGrantLocked, createProjectStorage, createTransactionalStorage, ensureRuntimeStateVersion, findUsableDispatchGrant, importLegacyPluginStorage, issueDispatchGrantLocked, migrateLegacySessionState, resolveRuntimeIdentity, sessionBoundToOq, sessionBoundToStep, sessionBoundToWorkflow, withRuntimeAdvisoryLock, withRuntimeLock, withRuntimeLocks, type LoomRuntimeIdentity } from "./runtime"
import { LoomRpc } from "./rpc"
import { buildSidebarSnapshot } from "./sidebar"
import { renderToolOutput } from "./presentation"
import { createDashboardPublisher } from "./dashboard"
import {
  addVerificationRequirement,
  applyTaskPlan,
  buildSteps,
  plannedTaskSteps,
  preserveSatisfied,
  finishStep,
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
  grantWorkflowDispatchBudget,
  hasMaterialProgress,
  newBudgetState,
  recordDispatch,
  type BudgetState,
  type ExecutionLimits,
  type ProgressSignal,
} from "./budget"
import { resourceMatchesScope, resourcesWithinScope, validateWriteScope, type TaskScope } from "./scope"
import { shellResourcesAllowed } from "./shell"
import { prepareReportPromotion, publishPreparedReport, reconcilePendingReportPromotion, type ReportPromotionInput, type ReportPromotionRecord } from "./reports"
import {
  findPaths,
  grepText,
  selectText,
  statPaths,
  type FindOptions,
  type GrepOptions,
  type SelectOptions,
  type StatsOptions,
} from "./inspection"
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
  assertWaveClaimForTasks,
  assertWorkGeneration,
  attachWorkflowToWork,
  claimWorkflowWave,
  completeObjective,
  completeWaveForTasks,
  createWorkHierarchy,
  materializeWorkPlan,
  nextRunnableWaves,
  objectiveIdForAnchor,
  releaseWorkflowWave,
  reopenWaveForTasks,
  syncWorkTaskStatuses,
  workTree,
  type WorkHierarchy,
  type WorkPlanPhase,
} from "./work"
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

const reportProducerAgents = new Set([
  "general",
  "reviewer",
  "critic",
  "designer",
  "acceptance",
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

async function activeIntent(
  ctx: any,
  sessionID: string,
  ensureLegacy?: (sessionID: string) => Promise<void>,
): Promise<IntentSession | undefined> {
  await ensureLegacy?.(sessionID)
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

function reportPromotionKey(id: string) {
  return `report-promotion/${id}`
}

function reportPromotionDestinationKey(destination: string) {
  const normalized = destination.trim().replaceAll("\\", "/").replace(/^\.\//, "")
  return `report-promotion-destination/${encodeURIComponent(normalized)}`
}

async function recoverPendingReportPromotions(
  ctx: any,
  runtime: LoomRuntimeIdentity,
  projectDirectory: string,
) {
  let after: string | undefined
  let recovered = 0
  let failed = 0

  do {
    const page = await ctx.storage.scan({
      prefix: "report-promotion/",
      limit: 100,
      ...(after ? { after } : {}),
    })

    for (const entry of page.entries) {
      const observed = entry.value as ReportPromotionRecord
      if (!observed || observed.status !== "pending") continue

      await withRuntimeAdvisoryLock(
        runtime,
        "report-promotion",
        reportPromotionDestinationKey(observed.destination),
        async () => {
          const record = (await ctx.storage.get(
            reportPromotionKey(observed.id),
          )) as ReportPromotionRecord | undefined
          if (!record || record.status !== "pending") return

          let next: ReportPromotionRecord
          try {
            next = await reconcilePendingReportPromotion(projectDirectory, record)
          } catch (error) {
            next = {
              ...record,
              status: "failed",
              failedAt: new Date().toISOString(),
              error: `Recovery failed: ${error instanceof Error ? error.message : String(error)}`.slice(0, 1000),
            }
          }

          if (next.status === "pending") return
          if (next.status === "completed") {
            await ctx.storage.set(reportPromotionDestinationKey(next.destination), next.id)
            recovered += 1
          } else {
            failed += 1
          }
          await ctx.storage.set(reportPromotionKey(record.id), next)
        },
      )
    }

    after = page.next
  } while (after)

  return { recovered, failed }
}

function scopeKey(workflowId: string, stepId: string) {
  return `scope/${workflowId}/${stepId}`
}

function sessionStepKey(sessionID: string) {
  return `session-step/${sessionID}`
}

function sessionOqKey(sessionID: string) {
  return `session-oq/${sessionID}`
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
  const stored = (await ctx.storage.get(limitsKey(workflowId))) as Partial<ExecutionLimits> | undefined
  return { ...DEFAULT_LIMITS, ...(stored ?? {}) }
}

function workflowKey(id: string) {
  return `workflow/${id}`
}

function workKey(objectiveId: string) {
  return `work/${encodeURIComponent(objectiveId)}`
}

async function withWorkLock<T>(
  runtime: LoomRuntimeIdentity,
  objectiveId: string,
  fn: () => Promise<T>,
): Promise<T> {
  return withRuntimeLock(runtime, "work", objectiveId, fn)
}

async function withWorkflowWorkLocks<T>(
  runtime: LoomRuntimeIdentity,
  workflowId: string,
  objectiveId: string,
  fn: () => Promise<T>,
): Promise<T> {
  return withRuntimeLocks(
    runtime,
    [
      { aggregate: "workflow", resourceIdentity: workflowId },
      { aggregate: "work", resourceIdentity: objectiveId },
    ],
    fn,
  )
}

async function readWork(ctx: any, objectiveId: string): Promise<WorkHierarchy | undefined> {
  return (await ctx.storage.get(workKey(objectiveId))) as WorkHierarchy | undefined
}

async function ensureWorkForWorkflow(ctx: any, runtime: LoomRuntimeIdentity, workflow: Workflow): Promise<WorkHierarchy> {
  const objectiveId = objectiveIdForAnchor(workflow.anchor)
  return withWorkLock(runtime, objectiveId, async () => {
    const now = new Date().toISOString()
    const existing = await readWork(ctx, objectiveId)
    const work = existing ?? createWorkHierarchy(workflow.anchor, workflow.id, now)
    attachWorkflowToWork(work, workflow.id, now)
    await ctx.storage.set(workKey(objectiveId), work)
    workflow.work = { objectiveId, generation: work.generation }
    return work
  })
}

function sessionKey(id: string) {
  return `session/${id}`
}

function bindingReleaseKey(workflowId: string, sessionID: string) {
  return `binding-release/${workflowId}/${sessionID}`
}

function workflowBindingTerminal(workflow: Workflow) {
  if (workflow.steps.length === 0) return false
  if (workflow.steps.every((step) => ["complete", "passed", "failed"].includes(step.status))) {
    return true
  }
  return (
    runnable(workflow).length === 0 &&
    workflow.steps.some((step) => step.status === "failed")
  )
}

async function assertSessionRebindingAllowedLocked(
  ctx: any,
  sessionID: string,
  observedBinding: string | undefined,
  nextWorkflowId: string,
) {
  const currentBinding = (await ctx.storage.get(sessionKey(sessionID))) as string | undefined
  if (currentBinding !== observedBinding) {
    throw new Error("Session workflow binding changed concurrently; retry the Loom transition.")
  }
  if (!currentBinding || currentBinding === nextWorkflowId) return currentBinding

  const previous = await readWorkflow(ctx, currentBinding)
  if (!previous) throw new Error("Current session workflow binding points to missing state.")
  const released = await ctx.storage.get(bindingReleaseKey(currentBinding, sessionID))
  if (!workflowBindingTerminal(previous) && !released) {
    throw new Error(
      "Session is still bound to an active workflow. Complete/fail it or explicitly release the binding before switching workflows.",
    )
  }
  return currentBinding
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

async function validateWorkflowMutationLocked(
  ctx: any,
  runtime: LoomRuntimeIdentity,
  workflow: Workflow,
): Promise<Workflow> {
  const current = await readWorkflow(ctx, workflow.id)
  if (!current) throw new Error("Workflow disappeared before mutation commit.")
  if (current.projectId !== runtime.projectId) {
    throw new Error("Workflow belongs to another project.")
  }
  if (current.revision !== workflow.revision) {
    throw new Error(
      `Stale workflow revision: expected ${workflow.revision}, current ${current.revision}.`,
    )
  }
  return current
}

async function persistWorkflowMutationLocked(
  ctx: any,
  runtime: LoomRuntimeIdentity,
  workflow: Workflow,
): Promise<Workflow> {
  const current = await validateWorkflowMutationLocked(ctx, runtime, workflow)
  workflow.revision = current.revision + 1
  await ctx.storage.set(workflowKey(workflow.id), workflow)
  return workflow
}

async function persistWorkflowMutation(
  ctx: any,
  runtime: LoomRuntimeIdentity,
  workflow: Workflow,
): Promise<Workflow> {
  return withRuntimeLock(runtime, "workflow", workflow.id, async () =>
    persistWorkflowMutationLocked(ctx, runtime, workflow),
  )
}

async function bumpWorkflowRevisionLocked(
  ctx: any,
  runtime: LoomRuntimeIdentity,
  workflowId: string,
): Promise<Workflow> {
  const current = await readWorkflow(ctx, workflowId)
  if (!current) throw new Error("Workflow disappeared during guarded mutation.")
  if (current.projectId !== runtime.projectId) throw new Error("Workflow belongs to another project.")
  current.revision += 1
  await ctx.storage.set(workflowKey(current.id), current)
  return current
}

async function activeWorkflow(
  ctx: any,
  sessionID: string,
  ensureLegacy?: (sessionID: string) => Promise<void>,
): Promise<Workflow | undefined> {
  await ensureLegacy?.(sessionID)
  const id = (await ctx.storage.get(sessionKey(sessionID))) as string | undefined
  return id ? readWorkflow(ctx, id) : undefined
}

async function readBoundWorkflow(
  ctx: any,
  sessionID: string,
  workflowId: string,
  ensureLegacy?: (sessionID: string) => Promise<void>,
): Promise<Workflow | undefined> {
  await ensureLegacy?.(sessionID)
  if (!(await sessionBoundToWorkflow(ctx.storage as any, sessionID, workflowId))) return undefined
  return readWorkflow(ctx, workflowId)
}

async function exactStepBinding(ctx: any, sessionID: string, workflowId: string, stepId: string) {
  return sessionBoundToStep(ctx.storage as any, sessionID, workflowId, stepId)
}

async function exactOqBinding(ctx: any, sessionID: string, workflowId: string, questionId: string) {
  return sessionBoundToOq(ctx.storage as any, sessionID, workflowId, questionId)
}

async function assertWorkerWorkClaim(ctx: any, workflowId: string, stepId: string) {
  const workflow = await readWorkflow(ctx, workflowId)
  if (!workflow) throw new Error("Workflow not found.")
  const step = workflow.steps.find((candidate) => candidate.id === stepId)
  if (!step) throw new Error("Step not found.")
  if (!step.task || !workflow.work) return

  const work = await readWork(ctx, workflow.work.objectiveId)
  if (!work) throw new Error("Persistent work hierarchy not found.")
  assertWaveClaimForTasks(
    work,
    workflow.id,
    workflow.work.generation,
    plannedTaskSteps(workflow).map((taskStep) => taskStep.task!.id),
  )
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


function clippedSummary(value?: string, max = 180) {
  if (!value) return undefined
  const normalized = value.replace(/\s+/g, " ").trim()
  return normalized.length <= max ? normalized : normalized.slice(0, max - 1) + "…"
}

function compactQuestions(questions: OpenQuestion[], workflow: Workflow) {
  const state = questionState(questions, workflow)
  return {
    open: state.unresolved.length,
    routes: state.routes,
    reconcile: state.reconcile,
  }
}

function compactVerification(workflow: Workflow) {
  const requirements = workflow.verification ?? []
  return {
    open: requirements
      .filter((requirement) => requirement.status === "open")
      .map((requirement) => ({
        id: requirement.id,
        before: requirement.beforeStepId,
        kind: requirement.kind,
        statement: clippedSummary(requirement.statement, 140),
      })),
    satisfied: requirements.filter((requirement) => requirement.status === "satisfied").length,
  }
}

function compactWorkflowState(
  workflow: Workflow,
  questions: OpenQuestion[],
  budget: BudgetState,
  limits: ExecutionLimits,
  acceptance?: AcceptancePlan,
  knowledge?: KnowledgeReport,
) {
  const ready = runnable(workflow)
  const finished = workflow.steps.filter((step) => ["complete", "passed", "failed"].includes(step.status))
  const failed = workflow.steps.filter((step) => step.status === "failed")
  const pending = workflow.steps.filter((step) => step.status === "pending")
  const readyIds = new Set(ready.map((step) => step.id))
  const blockedPending = pending.filter((step) => !readyIds.has(step.id))

  const state =
    failed.length > 0 && ready.length === 0
      ? "blocked"
      : pending.length === 0
        ? "complete"
        : "active"

  return {
    workflowId: workflow.id,
    state,
    progress: {
      finished: finished.length,
      total: workflow.steps.length,
      failed: failed.length,
    },
    now: ready.map((step) => ({ step: step.id, agent: step.agent, kind: step.kind })),
    recent: finished.slice(-5).map((step) => ({
      step: step.id,
      agent: step.agent,
      status: step.status,
      ...(step.summary ? { summary: clippedSummary(step.summary) } : {}),
    })),
    upcoming: blockedPending.slice(0, 6).map((step) => ({
      step: step.id,
      agent: step.agent,
      waitsFor: step.dependsOn.filter(
        (dependency) =>
          !workflow.steps.some(
            (candidate) =>
              candidate.id === dependency && ["complete", "passed"].includes(candidate.status),
          ),
      ),
    })),
    questions: compactQuestions(questions, workflow),
    verification: compactVerification(workflow),
    budget: {
      dispatches: budget.totalDispatches,
      maxDispatches: limits.maxTotalDispatches,
      ...(budget.exhausted ? { exhausted: budget.exhausted } : {}),
    },
    acceptance: acceptance ? acceptanceReadiness(acceptance) : null,
    knowledge: knowledge ? { valid: knowledge.valid } : null,
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

const evidenceObservedLoomToolNames = new Set(["find", "grep", "select", "stats", "report_promote"])

function isLoomToolName(tool: string) {
  return tool.startsWith("loom_") || tool.startsWith("loom.")
}

function isEvidenceObservedLoomToolName(tool: string) {
  if (!isLoomToolName(tool)) return false
  const leaf = tool.replace(/^loom[._]/, "")
  return evidenceObservedLoomToolNames.has(leaf)
}

function skipLoomEvidence(tool: string) {
  return isLoomToolName(tool) && !isEvidenceObservedLoomToolName(tool)
}

const loomPlugin: Parameters<typeof OpenCodePlugin.Plugin.define>[0] = {
  id: "loom",

  async setup(ctx) {
    const legacyStorage = ctx.storage as any
    const runtime = await resolveRuntimeIdentity(ctx.location.project.canonical, legacyStorage)
    const rawStorage = await createTransactionalStorage(runtime)
    await ensureRuntimeStateVersion(rawStorage, runtime)
    await importLegacyPluginStorage(legacyStorage, rawStorage, runtime)
    await rawStorage.set("installation/id", runtime.installationId)
    await rawStorage.set(`installation/projects/${runtime.projectId}`, {
      projectId: runtime.projectId,
      canonicalLocation: runtime.canonicalLocation,
      identitySource: runtime.identitySource,
      markerLocation: runtime.markerLocation,
      lastSeenAt: new Date().toISOString(),
    })

    const scopedStorage = createProjectStorage(rawStorage, runtime.projectId, {
      expectedRuntimeVersion: RUNTIME_STATE_VERSION,
    })
    ctx = new Proxy(ctx, {
      get(target, property, receiver) {
        if (property === "storage") return scopedStorage
        return Reflect.get(target, property, receiver)
      },
    }) as typeof ctx

    await recoverPendingReportPromotions(ctx, runtime, ctx.location.directory)

    const dashboardPublisher = createDashboardPublisher(scopedStorage, runtime)
    dashboardPublisher.trigger()
    dashboardPublisher.startHeartbeat()

    const legacyCheckedSessions = new Set<string>()
    const ensureLegacySession = async (sessionID: string) => {
      if (legacyCheckedSessions.has(sessionID)) return
      const session = await ctx.session.get({ sessionID })
      const sessionProjectId =
        typeof session.projectID === "string" ? session.projectID : ""
      const currentProjectId =
        typeof ctx.location.project.id === "string" ? ctx.location.project.id : ""
      const resumeProof =
        typeof session.id === "string" &&
        session.id === sessionID &&
        sessionProjectId.length > 0 &&
        currentProjectId.length > 0
          ? {
              kind: "opencode-host-session" as const,
              sessionId: session.id,
              projectId: sessionProjectId,
            }
          : undefined
      await migrateLegacySessionState(legacyStorage, scopedStorage, runtime, {
        sessionId: sessionID,
        sessionProjectId,
        currentProjectId,
        ...(resumeProof ? { resumeProof } : {}),
      })
      legacyCheckedSessions.add(sessionID)
    }

    await ctx.rpc.register(LoomRpc, {
      sidebar: async (input) => {
        const { sessionID } = input as { sessionID: string }
        const workflow = await activeWorkflow(ctx, sessionID, ensureLegacySession)
        const questions = workflow ? await readQuestions(ctx, workflow.id) : []
        const work = workflow?.work ? await readWork(ctx, workflow.work.objectiveId) : undefined
        return buildSidebarSnapshot(workflow, questions, work)
      },
    })

    await ctx.agent.transform((editor) => {
      if (editor.get("general")) editor.default("general")
    })

    await ctx.tool.transform((editor) => {
      editor.namespace({
        name: "loom",
        description: "Loom workflow control, shared questions, routing, step state, and bounded project inspection.",
      })


      editor.add({
        name: "find",
        description:
          "Read-only project file discovery. Structured replacement for find/sort/head-style shell pipelines; paths cannot escape the project.",
        input: {
          type: "object",
          properties: {
            path: { type: "string", description: "Project-relative starting path. Defaults to the project root." },
            minDepth: { type: "number", description: "Minimum depth to return, 0-12." },
            maxDepth: { type: "number", description: "Maximum traversal depth, 0-12." },
            type: { type: "string", enum: ["file", "directory", "symlink"] },
            name: { type: "string", description: "Simple * and ? basename glob." },
            sort: { type: "string", enum: ["path", "name", "size", "mtime"] },
            order: { type: "string", enum: ["asc", "desc"] },
            limit: { type: "number", description: "Maximum returned entries; hard-capped at 500." },
            includeHidden: { type: "boolean" },
          },
          additionalProperties: false,
        },
        options: { namespace: "loom", codemode: false },
        execute: async (input) => ({
          content: renderToolOutput(await findPaths(ctx.location.directory, input as FindOptions)),
        }),
      })

      editor.add({
        name: "grep",
        description:
          "Read-only bounded literal text search across project files. Structured replacement for grep -F / rg -F plus sort/head; supports context lines without arbitrary regex execution.",
        input: {
          type: "object",
          properties: {
            path: { type: "string", description: "Project-relative file or directory. Defaults to the project root." },
            pattern: { type: "string" },
            caseSensitive: { type: "boolean" },
            glob: { type: "string", description: "Simple * and ? file/path glob." },
            context: { type: "number", description: "Context lines before and after each match, 0-5." },
            maxDepth: { type: "number", description: "Maximum directory traversal depth, 0-12." },
            includeHidden: { type: "boolean" },
            sort: { type: "string", enum: ["path", "line"] },
            order: { type: "string", enum: ["asc", "desc"] },
            limit: { type: "number", description: "Maximum returned matches; hard-capped at 500." },
          },
          required: ["pattern"],
          additionalProperties: false,
        },
        options: { namespace: "loom", codemode: false },
        execute: async (input) => ({
          content: renderToolOutput(await grepText(ctx.location.directory, input as GrepOptions)),
        }),
      })

      editor.add({
        name: "select",
        description:
          "Read-only field filtering/projection for line-oriented text. Structured replacement for common awk/cut/sort/uniq/head/tail jobs without executing a programming language.",
        input: {
          type: "object",
          properties: {
            path: { type: "string", description: "Project-relative text file." },
            delimiter: {
              type: "string",
              description: "whitespace (default), tab, comma, or a literal delimiter up to 8 characters.",
            },
            where: {
              type: "object",
              properties: {
                field: { type: "number", description: "1-based field index." },
                op: {
                  type: "string",
                  enum: ["eq", "neq", "contains", "startsWith", "endsWith", "gt", "gte", "lt", "lte"],
                },
                value: { type: "string" },
              },
              required: ["field", "op", "value"],
              additionalProperties: false,
            },
            fields: {
              type: "array",
              items: { type: "number" },
              description: "1-based fields to return. Omit to return all fields.",
            },
            sort: {
              type: "object",
              properties: {
                field: { type: "number", description: "1-based field index." },
                order: { type: "string", enum: ["asc", "desc"] },
                numeric: { type: "boolean" },
              },
              required: ["field"],
              additionalProperties: false,
            },
            unique: { type: "boolean" },
            from: { type: "string", enum: ["start", "end"], description: "Use end for tail-style output." },
            limit: { type: "number", description: "Maximum returned rows; hard-capped at 500." },
            skipBlank: { type: "boolean" },
          },
          required: ["path"],
          additionalProperties: false,
        },
        options: { namespace: "loom", codemode: false },
        execute: async (input) => ({
          content: renderToolOutput(await selectText(ctx.location.directory, input as SelectOptions)),
        }),
      })

      editor.add({
        name: "stats",
        description:
          "Read-only project file metadata and optional line counts. Structured replacement for common stat/wc inspection.",
        input: {
          type: "object",
          properties: {
            paths: {
              type: "array",
              items: { type: "string" },
              description: "Project-relative paths; at most 100 per call.",
            },
            lineCount: { type: "boolean" },
          },
          required: ["paths"],
          additionalProperties: false,
        },
        options: { namespace: "loom", codemode: false },
        execute: async (input) => ({
          content: renderToolOutput(await statPaths(ctx.location.directory, input as StatsOptions)),
        }),
      })

      editor.add({
        name: "report_promote",
        description:
          "Promote one OKF-compliant ephemeral Markdown report unchanged into docs/reports. General only; promotion preserves source and authority and never overwrites.",
        input: {
          type: "object",
          properties: {
            source: {
              type: "string",
              description: "Project-relative source under ephemeral-reports/.",
            },
            destination: {
              type: "string",
              description: "Project-relative destination under docs/reports/.",
            },
            reason: {
              type: "string",
              description: "Why the report itself has lasting documentary, audit, historical, or compliance value.",
            },
          },
          required: ["source", "destination", "reason"],
          additionalProperties: false,
        },
        options: { namespace: "loom", codemode: false },
        execute: async (input, tool) => {
          if (tool.agent !== "general") {
            throw new Error("Only General may promote durable reports.")
          }

          const value = input as ReportPromotionInput
          return withRuntimeAdvisoryLock(
            runtime,
            "report-promotion",
            reportPromotionDestinationKey(value.destination),
            async () => {
              const promotionId = crypto.randomUUID()
              const startedAt = new Date().toISOString()

              let prepared
              try {
                prepared = await prepareReportPromotion(ctx.location.directory, value, promotionId)
              } catch (error) {
                const message = error instanceof Error ? error.message : String(error)
                await ctx.storage.set(reportPromotionKey(promotionId), {
                  id: promotionId,
                  status: "failed",
                  source: value.source,
                  destination: value.destination,
                  reason: value.reason,
                  actor: tool.agent,
                  startedAt,
                  failedAt: new Date().toISOString(),
                  authority: "unchanged",
                  error: message.slice(0, 1000),
                } satisfies ReportPromotionRecord)
                throw error
              }

              const pending: ReportPromotionRecord = {
                id: promotionId,
                status: "pending",
                source: prepared.source,
                destination: prepared.destination,
                reason: prepared.reason,
                actor: tool.agent,
                startedAt,
                sha256: prepared.sha256,
                bytes: prepared.bytes.byteLength,
                authority: "unchanged",
              }
              await ctx.storage.set(reportPromotionKey(promotionId), pending)

              try {
                const promoted = await publishPreparedReport(prepared)
                const promotedAt = new Date().toISOString()
                const record: ReportPromotionRecord = {
                  ...pending,
                  status: "completed",
                  promotedAt,
                }
                await ctx.storage.set(reportPromotionDestinationKey(promoted.destination), promotionId)
                await ctx.storage.set(reportPromotionKey(promotionId), record)

                return {
                  content: renderToolOutput({
                    ...promoted,
                    promotionId,
                    actor: tool.agent,
                    promotedAt,
                  }),
                }
              } catch (error) {
                const reconciled = await reconcilePendingReportPromotion(
                  ctx.location.directory,
                  pending,
                )
                if (reconciled.status === "completed") {
                  await ctx.storage.set(
                    reportPromotionDestinationKey(reconciled.destination),
                    promotionId,
                  )
                }
                await ctx.storage.set(reportPromotionKey(promotionId), reconciled)
                throw error
              }
            },
          )
        },
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
            return { content: renderToolOutput({ error: "Only general may run Loom intent shaping." }) }
          }

          const existing = await activeIntent(ctx, tool.sessionID, ensureLegacySession)
          if (existing && existing.state !== "accepted") {
            return { content: renderToolOutput({ error: "An active intent interview already exists.", intent: existing }) }
          }

          try {
            const session = startIntent((input as { seed: string }).seed, new Date().toISOString())
            await ctx.storage.set(intentKey(session.id), session)
            await ctx.storage.set(sessionIntentKey(tool.sessionID), session.id)
            return { content: renderToolOutput({ intent: session }) }
          } catch (error) {
            return { content: renderToolOutput({ error: error instanceof Error ? error.message : String(error) }) }
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
          await ensureLegacySession(tool.sessionID)
          const session = requested ? await readIntent(ctx, requested) : await activeIntent(ctx, tool.sessionID, ensureLegacySession)
          return { content: renderToolOutput({ intent: session ?? null }) }
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
            return { content: renderToolOutput({ error: "Only general may ask Loom intent questions." }) }
          }
          const session = await activeIntent(ctx, tool.sessionID, ensureLegacySession)
          if (!session) return { content: renderToolOutput({ error: "No active intent interview." }) }

          const value = input as { branch: string; question: string; recommendation: string; why: string }
          try {
            const openQuestion = askIntentQuestion({
              session,
              ...value,
              now: new Date().toISOString(),
            })
            await ctx.storage.set(intentKey(session.id), session)
            return { content: renderToolOutput({ intentId: session.id, openQuestion }) }
          } catch (error) {
            return { content: renderToolOutput({ error: error instanceof Error ? error.message : String(error) }) }
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
            return { content: renderToolOutput({ error: "Only general may resolve Loom intent branches." }) }
          }
          const session = await activeIntent(ctx, tool.sessionID, ensureLegacySession)
          if (!session) return { content: renderToolOutput({ error: "No active intent interview." }) }

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
            return { content: renderToolOutput({ intentId: session.id, decision }) }
          } catch (error) {
            return { content: renderToolOutput({ error: error instanceof Error ? error.message : String(error) }) }
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
            return { content: renderToolOutput({ error: "Only general may prepare a Loom Anchor draft." }) }
          }
          const session = await activeIntent(ctx, tool.sessionID, ensureLegacySession)
          if (!session) return { content: renderToolOutput({ error: "No active intent interview." }) }

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
            return { content: renderToolOutput({ intentId: session.id, draft }) }
          } catch (error) {
            return { content: renderToolOutput({ error: error instanceof Error ? error.message : String(error) }) }
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
            return { content: renderToolOutput({ error: "Only general may reopen Loom intent." }) }
          }
          const session = await activeIntent(ctx, tool.sessionID, ensureLegacySession)
          if (!session) return { content: renderToolOutput({ error: "No active intent interview." }) }
          try {
            reopenIntent(session)
            await ctx.storage.set(intentKey(session.id), session)
            return { content: renderToolOutput({ intent: session }) }
          } catch (error) {
            return { content: renderToolOutput({ error: error instanceof Error ? error.message : String(error) }) }
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
            return { content: renderToolOutput({ error: "Only general may record Anchor acceptance." }) }
          }
          const session = await activeIntent(ctx, tool.sessionID, ensureLegacySession)
          if (!session) return { content: renderToolOutput({ error: "No active intent interview." }) }

          const value = input as { anchorPath: string; confirmation: string }
          if (!value.anchorPath.replaceAll("\\", "/").startsWith("docs/anchors/")) {
            return { content: renderToolOutput({ error: "Accepted Anchor must live under docs/anchors/**." }) }
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
              content: renderToolOutput({
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
            return { content: renderToolOutput({ error: error instanceof Error ? error.message : String(error) }) }
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
            return { content: renderToolOutput({ error: "Only general may start a Loom workflow." }) }
          }

          const { anchor } = input as { anchor: string }
          const intent = await activeIntent(ctx, tool.sessionID, ensureLegacySession)
          if (intent && intent.state !== "accepted") {
            return {
              content: renderToolOutput({
                error: "Cannot start autonomous execution while intent shaping is unresolved.",
                intentState: intent.state,
              }),
            }
          }
          if (intent?.acceptedAnchor && intent.acceptedAnchor.path !== anchor) {
            return {
              content: renderToolOutput({
                error: "Workflow Anchor does not match the accepted intent Anchor.",
                acceptedAnchor: intent.acceptedAnchor.path,
              }),
            }
          }

          const id = crypto.randomUUID()
          const workflow: Workflow = {
            id,
            projectId: runtime.projectId,
            revision: 0,
            anchor,
            createdBySession: tool.sessionID,
            createdAt: new Date().toISOString(),
            steps: [],
          }

          const existingObjectiveId = objectiveIdForAnchor(anchor)
          const observedBinding = (await ctx.storage.get(sessionKey(tool.sessionID))) as string | undefined
          const resources = [
            { aggregate: "workflow", resourceIdentity: id },
            { aggregate: "work", resourceIdentity: existingObjectiveId },
            ...(observedBinding && observedBinding !== id
              ? [{ aggregate: "workflow", resourceIdentity: observedBinding }]
              : []),
          ]

          try {
            await withRuntimeLocks(runtime, resources, async () => {
              const previousBinding = await assertSessionRebindingAllowedLocked(
                ctx,
                tool.sessionID,
                observedBinding,
                id,
              )

              const current = await readWork(ctx, existingObjectiveId)
              if (current) {
                attachWorkflowToWork(current, workflow.id, new Date().toISOString())
                await ctx.storage.set(workKey(current.objectiveId), current)
                workflow.work = {
                  objectiveId: current.objectiveId,
                  generation: current.generation,
                }
              }

              await ctx.storage.set(workflowKey(id), workflow)
              await ctx.storage.set(sessionKey(tool.sessionID), id)
              await ctx.storage.set(sessionStepKey(tool.sessionID), "")
              await ctx.storage.set(sessionOqKey(tool.sessionID), "")
              if (intent?.acceptedAnchor?.path === anchor) {
                await ctx.storage.set(sessionIntentKey(tool.sessionID), "")
              }
              await ctx.storage.set(limitsKey(id), DEFAULT_LIMITS)
              await ctx.storage.set(budgetKey(id), newBudgetState())

              if (previousBinding && previousBinding !== id) {
                await bumpWorkflowRevisionLocked(ctx, runtime, previousBinding)
              }
            })
          } catch (error) {
            return { content: renderToolOutput({ error: error instanceof Error ? error.message : String(error) }) }
          }

          return { content: renderToolOutput({ workflowId: id, anchor, status: "started" }) }
        },
      })

      editor.add({
        name: "route",
        description:
          "Classify or reclassify accepted work and create the required Loom execution DAG. General only.",
        input: {
          type: "object",
          properties: {
            humanFacing: {
              type: "boolean",
              description: "True when the accepted work changes human-facing interaction, visible state, recovery, or subjective experience.",
            },
            behavioral: {
              type: "boolean",
              description: "True when observable product behavior or guarantees need new semantic authority.",
            },
            structural: {
              type: "boolean",
              description:
                "True only when an unresolved structural/design decision requires Architect authority. Mechanical config/schema/file-shape conversion with a fully determined mapping is not structural=true by itself.",
            },
            externalUnknown: {
              type: "boolean",
              description: "True when current external facts or documentation must be researched before implementation.",
            },
            diagnostic: {
              type: "boolean",
              description: "True when a fault/root cause is unknown and diagnosis is required.",
            },
            productOutcome: {
              type: "boolean",
              description: "True for product work that requires Planner decomposition.",
            },
            workLevel: {
              type: "string",
              enum: ["objective", "wave"],
              description:
                "Objective runs may close whole-product Product Acceptance. Wave runs execute one bounded Wave and leave the parent Objective active. Defaults to objective.",
            },
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
            return { content: renderToolOutput({ error: "Only general may route Loom workflows." }) }
          }

          const workflow = await activeWorkflow(ctx, tool.sessionID, ensureLegacySession)
          if (!workflow) {
            return { content: renderToolOutput({ error: "No active Loom workflow. Call loom_start first." }) }
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
              content: renderToolOutput({
                error:
                  "V0 route reclassification is only supported before implementation completion. Start a correction workflow for later reclassification.",
              }),
            }
          }

          const rawEffects = input as Effects
          const effects: Effects = {
            ...rawEffects,
            ...(rawEffects.productOutcome
              ? { workLevel: rawEffects.workLevel ?? "objective" }
              : {}),
          }

          const applyRouteMutation = () => {
            const next = buildSteps(effects)
            preserveSatisfied(workflow.steps, next)
            workflow.effects = effects
            workflow.steps = next
            reconcileVerificationAfterRoute(workflow)
          }

          if (effects.productOutcome) {
            const objectiveId = objectiveIdForAnchor(workflow.anchor)
            await withWorkflowWorkLocks(runtime, workflow.id, objectiveId, async () => {
              await validateWorkflowMutationLocked(ctx, runtime, workflow)
              const now = new Date().toISOString()
              const existing = await readWork(ctx, objectiveId)
              const work = existing ?? createWorkHierarchy(workflow.anchor, workflow.id, now)
              attachWorkflowToWork(work, workflow.id, now)
              await ctx.storage.set(workKey(objectiveId), work)
              workflow.work = { objectiveId, generation: work.generation }
              applyRouteMutation()
              await persistWorkflowMutationLocked(ctx, runtime, workflow)
            })
          } else {
            applyRouteMutation()
            await persistWorkflowMutation(ctx, runtime, workflow)
          }

          const questions = await readQuestions(ctx, workflow.id)
          return {
            content: renderToolOutput({
              workflowId: workflow.id,
              path: workflow.steps.map((step) => ({
                step: step.id,
                agent: step.agent,
                kind: step.kind,
                waitsFor: step.dependsOn,
              })),
              now: runnable(workflow).map((step) => ({ step: step.id, agent: step.agent })),
              questions: compactQuestions(questions, workflow),
            }),
          }
        },
      })

      editor.add({
        name: "status",
        description: "Inspect Loom progress, current/next work, blockers, OQs, verification, and budget. Compact by default; detail=true returns internals.",
        input: {
          type: "object",
          properties: {
            workflowId: { type: "string" },
            detail: {
              type: "boolean",
              description: "Return full workflow internals. Default false returns a compact progress/next-step view.",
            },
          },
          additionalProperties: false,
        },
        options: { namespace: "loom", codemode: false },
        execute: async (input, tool) => {
          const requested = (input as { workflowId?: string; detail?: boolean }).workflowId
          const workflow = requested
            ? await readBoundWorkflow(ctx, tool.sessionID, requested, ensureLegacySession)
            : await activeWorkflow(ctx, tool.sessionID, ensureLegacySession)

          if (!workflow) return { content: renderToolOutput({ error: "Workflow not found." }) }

          const questions = await readQuestions(ctx, workflow.id)
          const limits = await readLimits(ctx, workflow.id)
          const budget = await readBudget(ctx, workflow.id)
          const acceptance = (await ctx.storage.get(acceptanceKey(workflow.id))) as AcceptancePlan | undefined
          const knowledge = (await ctx.storage.get(knowledgeKey(workflow.id))) as KnowledgeReport | undefined
          const work = workflow.work ? await readWork(ctx, workflow.work.objectiveId) : undefined
          const detail = Boolean((input as { detail?: boolean }).detail)
          const workSummary = work
            ? { tree: workTree(work), nextRunnableWaves: nextRunnableWaves(work), version: work.version }
            : null

          if (!detail) {
            return {
              content: renderToolOutput({
                ...compactWorkflowState(workflow, questions, budget, limits, acceptance, knowledge),
                work: workSummary,
              }),
            }
          }

          return {
            content: renderToolOutput({
              summary: {
                ...compactWorkflowState(workflow, questions, budget, limits, acceptance, knowledge),
                work: workSummary,
              },
              workflow,
              runnable: runnable(workflow).map((step) => ({ id: step.id, agent: step.agent })),
              questions: questionState(questions, workflow),
              verification: workflow.verification ?? [],
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

          const workflow = await readBoundWorkflow(ctx, tool.sessionID, workflowId, ensureLegacySession)
          if (!workflow) return { content: renderToolOutput({ error: "Workflow not found or current session is not bound to it." }) }
          if (!(await exactStepBinding(ctx, tool.sessionID, workflowId, stepId))) {
            return { content: renderToolOutput({ error: "Step completion requires the exact attached workflow step." }) }
          }

          const questions = await readQuestions(ctx, workflowId)
          const blocking = blockingQuestionsForStep(questions, stepId)
          if (blocking.length > 0) {
            return {
              content: renderToolOutput({
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
          if (!step) return { content: renderToolOutput({ error: "Step not found." }) }

          const resolvedOutcome = outcome ?? (step.kind === "work" ? "complete" : undefined)
          if (!resolvedOutcome) {
            return { content: renderToolOutput({ error: "Gate step requires outcome pass or fail." }) }
          }

          if (stepId === "plan" && plannedTaskSteps(workflow).length === 0) {
            return { content: renderToolOutput({ error: "Planning step cannot complete before a validated task graph exists." }) }
          }

          if (stepId === "knowledge-sync") {
            const report = (await ctx.storage.get(knowledgeKey(workflowId))) as KnowledgeReport | undefined
            if (!report?.valid) {
              return { content: renderToolOutput({ error: "Knowledge sync cannot complete without a valid OKF-verified knowledge report." }) }
            }
          }

          if (stepId === "product-acceptance") {
            const plan = (await ctx.storage.get(acceptanceKey(workflowId))) as AcceptancePlan | undefined
            if (!plan) {
              return { content: renderToolOutput({ error: "Product Acceptance plan is missing." }) }
            }
            const readiness = acceptanceReadiness(plan)
            if (readiness === "pending") {
              return { content: renderToolOutput({ error: "Product Acceptance still has pending scenarios.", readiness }) }
            }
            if (resolvedOutcome === "pass" && readiness !== "passed") {
              return { content: renderToolOutput({ error: "Product Acceptance cannot PASS unless every scenario passed.", readiness }) }
            }
            if (resolvedOutcome === "fail" && readiness === "passed") {
              return { content: renderToolOutput({ error: "Product Acceptance cannot FAIL when every scenario passed.", readiness }) }
            }
          }

          if (stepId === "review-product" && resolvedOutcome === "pass") {
            const plan = (await ctx.storage.get(acceptanceKey(workflowId))) as AcceptancePlan | undefined
            if (!plan || acceptanceReadiness(plan) !== "passed") {
              return { content: renderToolOutput({ error: "Product review cannot PASS without passed Product Acceptance." }) }
            }
          }

          let evidenceBound = 0
          const commitCompletion = async () => {
            await validateWorkflowMutationLocked(ctx, runtime, workflow)

            const currentQuestions = await readQuestions(ctx, workflowId)
            const currentBlocking = blockingQuestionsForStep(currentQuestions, stepId)
            if (currentBlocking.length > 0) {
              throw new Error("Step has unresolved blocking questions.")
            }

            finishStep(workflow, stepId, tool.agent, resolvedOutcome, summary)
            evidenceBound = await bindSessionEvidence(ctx, tool.sessionID, workflowId, stepId)

            if (workflow.work) {
              const work = await readWork(ctx, workflow.work.objectiveId)
              if (!work) throw new Error("Persistent work hierarchy not found.")

              assertWorkGeneration(work, workflow.work.generation)
              const taskIds = plannedTaskSteps(workflow).map((taskStep) => taskStep.task!.id)
              if (taskIds.length > 0) {
                assertWaveClaimForTasks(
                  work,
                  workflow.id,
                  workflow.work.generation,
                  taskIds,
                )
              }

              const now = new Date().toISOString()
              syncWorkTaskStatuses(
                work,
                workflow.id,
                workflow.work.generation,
                plannedTaskSteps(workflow).map((taskStep) => ({
                  taskId: taskStep.task!.id,
                  complete: taskStep.status === "complete",
                })),
                now,
              )

              if (
                stepId === "review-implementation" &&
                resolvedOutcome === "pass" &&
                taskIds.length > 0
              ) {
                completeWaveForTasks(
                  work,
                  workflow.id,
                  workflow.work.generation,
                  taskIds,
                  now,
                )
              }

              if (
                stepId === "critic-final" &&
                resolvedOutcome === "pass" &&
                (workflow.effects?.workLevel ?? "objective") === "objective"
              ) {
                completeObjective(work, workflow.work.generation, now)
              }

              await ctx.storage.set(workKey(work.objectiveId), work)
            }

            await persistWorkflowMutationLocked(ctx, runtime, workflow)
          }

          try {
            if (workflow.work) {
              await withWorkflowWorkLocks(
                runtime,
                workflow.id,
                workflow.work.objectiveId,
                commitCompletion,
              )
            } else {
              await withRuntimeLock(runtime, "workflow", workflow.id, commitCompletion)
            }
          } catch (error) {
            return { content: renderToolOutput({ error: error instanceof Error ? error.message : String(error) }) }
          }

          return {
            content: renderToolOutput({
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
            return { content: renderToolOutput({ error: "Only general may reopen Loom steps." }) }
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
              content: renderToolOutput({
                error: "Reopen denied: repeated work must have new evidence, a changed hypothesis, a changed strategy, or a reduced unresolved set.",
              }),
            }
          }

          const workflow = await readBoundWorkflow(ctx, tool.sessionID, workflowId, ensureLegacySession)
          if (!workflow) return { content: renderToolOutput({ error: "Workflow not found." }) }

          try {
            let reset: string[] = []
            const commitReopen = async () => {
              await validateWorkflowMutationLocked(ctx, runtime, workflow)

              let work: WorkHierarchy | undefined
              if (workflow.work) {
                work = await readWork(ctx, workflow.work.objectiveId)
                if (!work) throw new Error("Persistent work hierarchy not found.")
                assertWorkGeneration(work, workflow.work.generation)
                const taskIds = plannedTaskSteps(workflow).map((taskStep) => taskStep.task!.id)
                if (taskIds.length > 0) {
                  assertWaveClaimForTasks(
                    work,
                    workflow.id,
                    workflow.work.generation,
                    taskIds,
                  )
                }
              }

              reset = reopenFrom(workflow, stepId)
              resetVerificationAfterReopen(workflow, reset)

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

              const now = new Date().toISOString()
              await ctx.storage.set(
                `progress/${workflowId}/${stepId}/${crypto.randomUUID()}`,
                { reason: value.reason, ...progress, at: now },
              )

              if (work && workflow.work) {
                const taskIds = plannedTaskSteps(workflow).map((taskStep) => taskStep.task!.id)
                syncWorkTaskStatuses(
                  work,
                  workflow.id,
                  workflow.work.generation,
                  plannedTaskSteps(workflow).map((taskStep) => ({
                    taskId: taskStep.task!.id,
                    complete: taskStep.status === "complete",
                  })),
                  now,
                )
                if (reset.includes("review-implementation") && taskIds.length > 0) {
                  reopenWaveForTasks(
                    work,
                    workflow.id,
                    workflow.work.generation,
                    taskIds,
                    now,
                  )
                }
                await ctx.storage.set(workKey(work.objectiveId), work)
              }

              await persistWorkflowMutationLocked(ctx, runtime, workflow)
            }

            if (workflow.work) {
              await withWorkflowWorkLocks(
                runtime,
                workflow.id,
                workflow.work.objectiveId,
                commitReopen,
              )
            } else {
              await withRuntimeLock(runtime, "workflow", workflow.id, commitReopen)
            }

            return {
              content: renderToolOutput({
                reopened: stepId,
                reset,
                runnable: runnable(workflow).map((candidate) => ({ id: candidate.id, agent: candidate.agent })),
              }),
            }
          } catch (error) {
            return { content: renderToolOutput({ error: error instanceof Error ? error.message : String(error) }) }
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
          const workflow = await readBoundWorkflow(ctx, tool.sessionID, value.workflowId, ensureLegacySession)
          if (!workflow) return { content: renderToolOutput({ error: "Workflow not found or current session is not bound to it." }) }
          if (!(await exactStepBinding(ctx, tool.sessionID, value.workflowId, value.stepId))) {
            return { content: renderToolOutput({ error: "Raising a workflow OQ requires the exact attached workflow step." }) }
          }

          try {
            const question = await withRuntimeLock(runtime, "workflow", value.workflowId, async () => {
              const current = await readWorkflow(ctx, value.workflowId)
              if (!current) throw new Error("Workflow not found.")
              const created = raiseQuestion({
                id: crypto.randomUUID(),
                workflow: current,
                question: value.question,
                raisedByAgent: tool.agent,
                raisedByStepId: value.stepId,
                requiredAuthority: value.requiredAuthority,
                blocking: value.blocking,
                consumerStepIds: value.consumerStepIds,
                evidence: value.evidence,
                now: new Date().toISOString(),
              })
              await appendQuestion(ctx, created)
              await bumpWorkflowRevisionLocked(ctx, runtime, value.workflowId)
              return created
            })
            await bindSessionEvidence(ctx, tool.sessionID, value.workflowId, value.stepId)
            return {
              content: renderToolOutput({
                question,
                routeTo: question.requiredAuthority,
              }),
            }
          } catch (error) {
            return { content: renderToolOutput({ error: error instanceof Error ? error.message : String(error) }) }
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
          const workflow = await readBoundWorkflow(ctx, tool.sessionID, workflowId, ensureLegacySession)
          if (!workflow) return { content: renderToolOutput({ error: "Workflow not found." }) }

          const questions = await readQuestions(ctx, workflowId)
          return {
            content: renderToolOutput({
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
          const workflow = await readBoundWorkflow(ctx, tool.sessionID, value.workflowId, ensureLegacySession)
          if (!workflow) return { content: renderToolOutput({ error: "Workflow not found or current session is not bound to it." }) }

          if (value.source === "agent" && !(await exactOqBinding(ctx, tool.sessionID, value.workflowId, value.questionId))) {
            return { content: renderToolOutput({ error: "Agent OQ answers require the exact OQ dispatch-grant attachment." }) }
          }

          try {
            const question = await withRuntimeLock(runtime, "workflow", value.workflowId, async () => {
              const current = (await ctx.storage.get(oqKey(value.workflowId, value.questionId))) as OpenQuestion | undefined
              if (!current) throw new Error("Question not found.")
              answerQuestion(
                current,
                tool.agent,
                value.source,
                value.answer,
                value.evidence ?? [],
                new Date().toISOString(),
              )
              await saveQuestion(ctx, current)
              await bumpWorkflowRevisionLocked(ctx, runtime, value.workflowId)
              return current
            })
            return { content: renderToolOutput({ question }) }
          } catch (error) {
            return { content: renderToolOutput({ error: error instanceof Error ? error.message : String(error) }) }
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
          const workflow = await readBoundWorkflow(ctx, tool.sessionID, value.workflowId, ensureLegacySession)
          if (!(await exactStepBinding(ctx, tool.sessionID, value.workflowId, value.stepId))) {
            return { content: renderToolOutput({ error: "OQ reconciliation requires the exact attached workflow step." }) }
          }
          if (!workflow) return { content: renderToolOutput({ error: "Workflow not found." }) }

          try {
            const question = await withRuntimeLock(runtime, "workflow", value.workflowId, async () => {
              const currentWorkflow = await readWorkflow(ctx, value.workflowId)
              const currentQuestion = (await ctx.storage.get(oqKey(value.workflowId, value.questionId))) as OpenQuestion | undefined
              if (!currentWorkflow || !currentQuestion) throw new Error("Workflow or question not found.")
              reconcileQuestion(
                currentQuestion,
                currentWorkflow,
                value.stepId,
                tool.agent,
                value.disposition,
                value.summary,
                new Date().toISOString(),
              )
              await saveQuestion(ctx, currentQuestion)
              await bumpWorkflowRevisionLocked(ctx, runtime, value.workflowId)
              return currentQuestion
            })
            return { content: renderToolOutput({ question }) }
          } catch (error) {
            return { content: renderToolOutput({ error: error instanceof Error ? error.message : String(error) }) }
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
          const workflow = await readBoundWorkflow(ctx, tool.sessionID, value.workflowId, ensureLegacySession)
          if (!workflow) return { content: renderToolOutput({ error: "Workflow not found or current session is not bound to it." }) }

          try {
            const question = await withRuntimeLock(runtime, "workflow", value.workflowId, async () => {
              const current = (await ctx.storage.get(oqKey(value.workflowId, value.questionId))) as OpenQuestion | undefined
              if (!current) throw new Error("Question not found.")
              reopenQuestion(
                current,
                tool.agent,
                value.preserveAnswer,
                value.reason,
                new Date().toISOString(),
              )
              await saveQuestion(ctx, current)
              await bumpWorkflowRevisionLocked(ctx, runtime, value.workflowId)
              return current
            })
            return { content: renderToolOutput({ question }) }
          } catch (error) {
            return { content: renderToolOutput({ error: error instanceof Error ? error.message : String(error) }) }
          }
        },
      })

      editor.add({
        name: "verification",
        description:
          "Manage load-bearing Loom verification. action=status inspects requirements; action=require persists a specialist-owned requirement; action=prove satisfies one with observed current-session evidence.",
        input: {
          type: "object",
          properties: {
            action: { type: "string", enum: ["status", "require", "prove"] },
            workflowId: { type: "string" },
            beforeStepId: {
              type: "string",
              description: "For require: downstream gate that must not PASS before proof exists.",
            },
            kind: {
              type: "string",
              enum: ["test", "build", "lint", "security", "runtime", "integration", "product-acceptance", "other"],
            },
            statement: { type: "string" },
            requirementId: { type: "string" },
            observationIds: { type: "array", items: { type: "string" } },
            detail: { type: "boolean" },
          },
          required: ["action"],
          additionalProperties: false,
        },
        options: { namespace: "loom", codemode: false },
        execute: async (input, tool) => {
          const value = input as {
            action: "status" | "require" | "prove"
            workflowId?: string
            beforeStepId?: string
            kind?: EvidenceKind
            statement?: string
            requirementId?: string
            observationIds?: string[]
            detail?: boolean
          }

          const workflow = value.workflowId
            ? await readBoundWorkflow(ctx, tool.sessionID, value.workflowId, ensureLegacySession)
            : await activeWorkflow(ctx, tool.sessionID, ensureLegacySession)
          if (!workflow) return { content: renderToolOutput({ error: "Workflow not found." }) }

          if (value.action === "status") {
            return {
              content: renderToolOutput(
                value.detail
                  ? { verification: workflow.verification ?? [] }
                  : { verification: compactVerification(workflow) },
              ),
            }
          }

          if (!value.workflowId) {
            return { content: renderToolOutput({ error: "workflowId is required for verification mutations." }) }
          }

          if (value.action === "require") {
            if (!value.beforeStepId || !value.kind || !value.statement?.trim()) {
              return {
                content: renderToolOutput({
                  error: "require needs beforeStepId, kind, and a non-empty statement.",
                }),
              }
            }

            const attachedWorkflow = (await ctx.storage.get(sessionKey(tool.sessionID))) as string | undefined
            const attachedStep = (await ctx.storage.get(sessionStepKey(tool.sessionID))) as string | undefined
            if (attachedWorkflow !== value.workflowId || !attachedStep) {
              return {
                content: renderToolOutput({
                  error: "Verification requirements must be created from a specialist session attached to its current Loom step.",
                }),
              }
            }

            const current = workflow.steps.find((step) => step.id === attachedStep)
            if (!current || current.agent !== tool.agent) {
              return { content: renderToolOutput({ error: "Current attached step does not belong to this agent." }) }
            }
            if (!runnable(workflow).some((step) => step.id === attachedStep)) {
              return { content: renderToolOutput({ error: "Current attached step is not runnable." }) }
            }

            try {
              const requirement = addVerificationRequirement(workflow, {
                id: crypto.randomUUID(),
                createdByStepId: attachedStep,
                createdByAgent: tool.agent,
                beforeStepId: value.beforeStepId,
                kind: value.kind,
                statement: value.statement,
                now: new Date().toISOString(),
              })
              await persistWorkflowMutation(ctx, runtime, workflow)
              return {
                content: renderToolOutput({
                  requirement: {
                    id: requirement.id,
                    kind: requirement.kind,
                    before: requirement.beforeStepId,
                    status: requirement.status,
                    statement: requirement.statement,
                  },
                }),
              }
            } catch (error) {
              return { content: renderToolOutput({ error: error instanceof Error ? error.message : String(error) }) }
            }
          }

          if (!value.requirementId || !value.statement?.trim() || !Array.isArray(value.observationIds)) {
            return {
              content: renderToolOutput({
                error: "prove needs requirementId, statement, and observationIds.",
              }),
            }
          }

          const attachedWorkflow = (await ctx.storage.get(sessionKey(tool.sessionID))) as string | undefined
          if (attachedWorkflow !== value.workflowId) {
            return { content: renderToolOutput({ error: "Current session is not attached to this workflow." }) }
          }

          const requirement = (workflow.verification ?? []).find(
            (candidate) => candidate.id === value.requirementId,
          )
          if (!requirement) return { content: renderToolOutput({ error: "Verification requirement not found." }) }

          const available = await sessionObservations(ctx, tool.sessionID)
          const byID = new Map(available.map((observation) => [observation.id, observation]))
          const observations = value.observationIds
            .map((id) => byID.get(id))
            .filter((observation): observation is EvidenceObservation => Boolean(observation))

          if (observations.length !== value.observationIds.length) {
            return { content: renderToolOutput({ error: "Every proof id must be an observed event from the current session." }) }
          }
          if (!observationsSupportKind(requirement.kind, observations)) {
            return {
              content: renderToolOutput({
                error: `Observed evidence does not support verification kind ${requirement.kind}.`,
              }),
            }
          }

          const attachedStep = (await ctx.storage.get(sessionStepKey(tool.sessionID))) as string | undefined
          try {
            const proven = proveVerificationRequirement(workflow, requirement.id, {
              byAgent: tool.agent,
              ...(attachedStep ? { stepId: attachedStep } : {}),
              statement: value.statement,
              observationIds: observations.map((observation) => observation.id),
              provedAt: new Date().toISOString(),
            })
            await persistWorkflowMutation(ctx, runtime, workflow)
            return {
              content: renderToolOutput({
                proven: proven.id,
                kind: proven.kind,
                before: proven.beforeStepId,
                by: proven.proof?.byAgent,
                observations: proven.proof?.observationIds.length ?? 0,
              }),
            }
          } catch (error) {
            return { content: renderToolOutput({ error: error instanceof Error ? error.message : String(error) }) }
          }
        },
      })

      editor.add({
        name: "evidence_observations",
        description: "List automatically observed non-Loom tool executions from the current session.",
        input: {
          type: "object",
          properties: {
            limit: {
              type: "number",
              description: "Maximum recent observations to show in compact mode. Default 12, maximum 100.",
            },
            detail: {
              type: "boolean",
              description: "Return full observation records instead of the compact recent view.",
            },
          },
          additionalProperties: false,
        },
        options: { namespace: "loom", codemode: false },
        execute: async (input, tool) => {
          const observations = await sessionObservations(ctx, tool.sessionID)
          const value = input as { limit?: number; detail?: boolean }
          if (value.detail) return { content: renderToolOutput({ observations }) }

          const limit = Math.max(1, Math.min(100, Math.floor(value.limit ?? 12)))
          const recent = observations.slice(-limit).map((observation) => ({
            id: observation.id,
            tool: observation.tool,
            status: observation.status,
            at: observation.observedAt,
            ...(observation.command ? { command: clippedSummary(observation.command, 180) } : {}),
            ...(observation.path ? { path: observation.path } : {}),
            ...(observation.destination ? { destination: observation.destination } : {}),
            ...(observation.reason ? { reason: clippedSummary(observation.reason, 180) } : {}),
            ...(observation.reportPromotion ? { promotion: observation.reportPromotion } : {}),
          }))
          return {
            content: renderToolOutput({
              count: observations.length,
              showing: recent.length,
              observations: recent,
            }),
          }
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

          const workflow = await readBoundWorkflow(ctx, tool.sessionID, value.workflowId, ensureLegacySession)
          if (!workflow) return { content: renderToolOutput({ error: "Workflow not found." }) }

          const step = workflow.steps.find((candidate) => candidate.id === value.stepId)
          if (!step) return { content: renderToolOutput({ error: "Step not found." }) }
          if (step.agent !== tool.agent) {
            return { content: renderToolOutput({ error: `Step ${value.stepId} belongs to ${step.agent}, not ${tool.agent}.` }) }
          }

          const available = await sessionObservations(ctx, tool.sessionID)
          const byID = new Map(available.map((observation) => [observation.id, observation]))
          const observations = value.observationIds.map((id) => byID.get(id)).filter(Boolean) as EvidenceObservation[]

          if (observations.length !== value.observationIds.length) {
            return { content: renderToolOutput({ error: "Every evidence id must be an observed event from the current session." }) }
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

            await withRuntimeLock(runtime, "workflow", value.workflowId, async () => {
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
              await bumpWorkflowRevisionLocked(ctx, runtime, value.workflowId)
            })

            return { content: renderToolOutput({ claim }) }
          } catch (error) {
            return { content: renderToolOutput({ error: error instanceof Error ? error.message : String(error) }) }
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
        execute: async (input, tool) => {
          const { workflowId, stepId } = input as { workflowId: string; stepId: string }
          if (!(await readBoundWorkflow(ctx, tool.sessionID, workflowId, ensureLegacySession))) {
            return { content: renderToolOutput({ error: "Workflow not found or current session is not bound to it." }) }
          }
          const observations = await stepObservations(ctx, workflowId, stepId)
          const claims = await stepClaims(ctx, workflowId, stepId)
          return { content: renderToolOutput({ observations, claims }) }
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
            return { content: renderToolOutput({ error: "Only documenter may record knowledge-sync results." }) }
          }

          const value = input as {
            workflowId: string
            changedDocs: string[]
            unchangedReason?: string
            okfObservationIds: string[]
          }

          const workflow = await readBoundWorkflow(ctx, tool.sessionID, value.workflowId, ensureLegacySession)
          if (!workflow) return { content: renderToolOutput({ error: "Workflow not found." }) }

          const attachedWorkflow = (await ctx.storage.get(sessionKey(tool.sessionID))) as string | undefined
          const attachedStep = (await ctx.storage.get(sessionStepKey(tool.sessionID))) as string | undefined
          if (attachedWorkflow !== value.workflowId || attachedStep !== "knowledge-sync") {
            return { content: renderToolOutput({ error: "Documenter must attach to this workflow's knowledge-sync step first." }) }
          }

          const available = await sessionObservations(ctx, tool.sessionID)
          const byID = new Map(available.map((observation) => [observation.id, observation]))
          const observations = value.okfObservationIds
            .map((id) => byID.get(id))
            .filter((observation): observation is EvidenceObservation => Boolean(observation))

          if (observations.length !== value.okfObservationIds.length) {
            return { content: renderToolOutput({ error: "Every OKF observation id must belong to the current Documenter session." }) }
          }

          try {
            const report = await withRuntimeLock(runtime, "workflow", value.workflowId, async () => {
              const currentWorkflow = await readWorkflow(ctx, value.workflowId)
              if (!currentWorkflow) throw new Error("Workflow not found.")
              if (currentWorkflow.projectId !== runtime.projectId) {
                throw new Error("Workflow belongs to another project.")
              }
              const next = createKnowledgeReport({
                workflowId: value.workflowId,
                changedDocs: value.changedDocs,
                unchangedReason: value.unchangedReason,
                observations,
                recordedBy: tool.agent,
                now: new Date().toISOString(),
              })
              await ctx.storage.set(knowledgeKey(value.workflowId), next)
              await bumpWorkflowRevisionLocked(ctx, runtime, value.workflowId)
              return next
            })
            return { content: renderToolOutput({ report }) }
          } catch (error) {
            return { content: renderToolOutput({ error: error instanceof Error ? error.message : String(error) }) }
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
        execute: async (input, tool) => {
          const { workflowId } = input as { workflowId: string }
          if (!(await readBoundWorkflow(ctx, tool.sessionID, workflowId, ensureLegacySession))) {
            return { content: renderToolOutput({ error: "Workflow not found or current session is not bound to it." }) }
          }
          const report = (await ctx.storage.get(knowledgeKey(workflowId))) as KnowledgeReport | undefined
          return { content: renderToolOutput({ report: report ?? null }) }
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
            return { content: renderToolOutput({ error: "Only acceptance, specifier, or reviewer may define Product Acceptance scenarios." }) }
          }

          const value = input as {
            workflowId: string
            scenarios: Array<{ id: string; title: string; criteria: string[] }>
          }
          const workflow = await readBoundWorkflow(ctx, tool.sessionID, value.workflowId, ensureLegacySession)
          if (!workflow) return { content: renderToolOutput({ error: "Workflow not found." }) }
          if (!workflow.steps.some((step) => step.id === "product-acceptance")) {
            return { content: renderToolOutput({ error: "Workflow does not require Product Acceptance." }) }
          }

          try {
            const plan = await withRuntimeLock(runtime, "workflow", value.workflowId, async () => {
              const currentWorkflow = await readWorkflow(ctx, value.workflowId)
              if (!currentWorkflow) throw new Error("Workflow not found.")
              if (currentWorkflow.projectId !== runtime.projectId) {
                throw new Error("Workflow belongs to another project.")
              }

              const existing = (await ctx.storage.get(acceptanceKey(value.workflowId))) as AcceptancePlan | undefined
              if (existing?.scenarios.some((scenario) => scenario.outcome !== "pending")) {
                throw new Error("Product Acceptance plan cannot change after results exist; reopen/reset first.")
              }

              const next = createAcceptancePlan({
                workflowId: value.workflowId,
                createdBy: tool.agent,
                scenarios: value.scenarios,
                now: new Date().toISOString(),
              })
              await ctx.storage.set(acceptanceKey(value.workflowId), next)
              await bumpWorkflowRevisionLocked(ctx, runtime, value.workflowId)
              return next
            })
            return { content: renderToolOutput({ plan, readiness: acceptanceReadiness(plan) }) }
          } catch (error) {
            return { content: renderToolOutput({ error: error instanceof Error ? error.message : String(error) }) }
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
        execute: async (input, tool) => {
          const { workflowId } = input as { workflowId: string }
          if (!(await readBoundWorkflow(ctx, tool.sessionID, workflowId, ensureLegacySession))) {
            return { content: renderToolOutput({ error: "Workflow not found or current session is not bound to it." }) }
          }
          const plan = (await ctx.storage.get(acceptanceKey(workflowId))) as AcceptancePlan | undefined
          return {
            content: renderToolOutput({
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
            return { content: renderToolOutput({ error: "Only acceptance may record Product Acceptance results." }) }
          }

          const value = input as {
            workflowId: string
            scenarioId: string
            outcome: "passed" | "failed" | "unproven"
            evidenceClaimIds: string[]
            note: string
          }
          if (!(await readBoundWorkflow(ctx, tool.sessionID, value.workflowId, ensureLegacySession))) {
            return { content: renderToolOutput({ error: "Workflow not found or current session is not bound to it." }) }
          }
          if (!(await exactStepBinding(ctx, tool.sessionID, value.workflowId, "product-acceptance"))) {
            return { content: renderToolOutput({ error: "Product Acceptance results require the exact product-acceptance attachment." }) }
          }

          try {
            const result = await withRuntimeLock(runtime, "workflow", value.workflowId, async () => {
              const plan = (await ctx.storage.get(acceptanceKey(value.workflowId))) as AcceptancePlan | undefined
              if (!plan) throw new Error("Product Acceptance plan not found.")

              const records = await Promise.all(
                value.evidenceClaimIds.map((id) => ctx.storage.get(claimIdKey(id)) as Promise<EvidenceClaim | undefined>),
              )
              const claims = records.filter((claim): claim is EvidenceClaim => Boolean(claim))
              if (claims.length !== value.evidenceClaimIds.length) {
                throw new Error("Every Product Acceptance evidence claim id must exist.")
              }
              if (claims.some((claim) => claim.byAgent !== "acceptance")) {
                throw new Error("Product Acceptance evidence claims must be produced by acceptance.")
              }

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
              await bumpWorkflowRevisionLocked(ctx, runtime, value.workflowId)
              return { scenario, readiness: acceptanceReadiness(plan) }
            })
            return {
              content: renderToolOutput(result),
            }
          } catch (error) {
            return { content: renderToolOutput({ error: error instanceof Error ? error.message : String(error) }) }
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
        execute: async (input, tool) => {
          const { workflowId } = input as { workflowId: string }
          if (!(await readBoundWorkflow(ctx, tool.sessionID, workflowId, ensureLegacySession))) {
            return { content: renderToolOutput({ error: "Workflow not found or current session is not bound to it." }) }
          }
          const limits = await readLimits(ctx, workflowId)
          const state = await readBudget(ctx, workflowId)
          return { content: renderToolOutput({ limits, state }) }
        },
      })


      editor.add({
        name: "budget_grant",
        description:
          "Grant exactly one extra dispatch to an exhausted runnable workflow step or unanswered agent-owned OQ after material progress. General only; dispatch history and the workflow-wide total limit are preserved.",
        input: {
          type: "object",
          properties: {
            workflowId: { type: "string" },
            stepId: { type: "string" },
            questionId: { type: "string" },
            reason: { type: "string" },
            evidence: { type: "array", items: { type: "string" } },
            progress: {
              type: "object",
              properties: {
                newEvidence: { type: "boolean" },
                changedHypothesis: { type: "boolean" },
                changedStrategy: { type: "boolean" },
                reducedUnresolved: { type: "boolean" },
              },
              required: [
                "newEvidence",
                "changedHypothesis",
                "changedStrategy",
                "reducedUnresolved",
              ],
              additionalProperties: false,
            },
          },
          required: ["workflowId", "reason", "progress"],
          additionalProperties: false,
        },
        options: { namespace: "loom", codemode: false },
        execute: async (input, tool) => {
          if (tool.agent !== "general") {
            return { content: renderToolOutput({ error: "Only general may grant extra Loom dispatch budget." }) }
          }

          const value = input as {
            workflowId: string
            stepId?: string
            questionId?: string
            reason: string
            evidence?: string[]
            progress: ProgressSignal
          }

          if (!(await readBoundWorkflow(ctx, tool.sessionID, value.workflowId, ensureLegacySession))) {
            return { content: renderToolOutput({ error: "Workflow not found or current session is not bound to it." }) }
          }

          const mutation = await withRuntimeLock(runtime, "workflow", value.workflowId, async () => {
            const workflow = await readBoundWorkflow(
              ctx,
              tool.sessionID,
              value.workflowId,
              ensureLegacySession,
            )
            if (!workflow) throw new Error("Workflow not found or current session is not bound to it.")

            const questions = await readQuestions(ctx, value.workflowId)
            const limits = await readLimits(ctx, value.workflowId)
            const state = await readBudget(ctx, value.workflowId)
            const result = grantWorkflowDispatchBudget({
              state,
              limits,
              workflow,
              questions,
              stepId: value.stepId,
              questionId: value.questionId,
              grantedBy: tool.agent,
              reason: value.reason,
              progress: value.progress,
              evidence: value.evidence,
              now: new Date().toISOString(),
            })

            if (result.allowed) {
              await ctx.storage.set(budgetKey(value.workflowId), state)
              await bumpWorkflowRevisionLocked(ctx, runtime, value.workflowId)
            }
            return { limits, state, result }
          })

          if (!mutation.result.allowed) {
            return {
              content: renderToolOutput({
                error: mutation.result.reason,
                target: {
                  stepId: value.stepId,
                  questionId: value.questionId,
                },
                limits: mutation.limits,
              }),
            }
          }

          return {
            content: renderToolOutput({
              granted: true,
              target: mutation.result.target,
              used: mutation.state.byKey[mutation.result.target.key] ?? 0,
              previousLimit: mutation.result.previousLimit,
              newLimit: mutation.result.newLimit,
              grant: mutation.result.grant,
              workflowDispatches: {
                used: mutation.state.totalDispatches,
                limit: mutation.limits.maxTotalDispatches,
              },
            }),
          }
        },
      })


      editor.add({
        name: "work_plan",
        description:
          "Create or replace the persistent Objective/Phase/Wave/Task plan for the accepted product Objective. Planner only. Replacing an existing generation requires its exact current version and a reason.",
        input: {
          type: "object",
          properties: {
            workflowId: { type: "string" },
            expectedVersion: { type: "number" },
            replaceReason: { type: "string" },
            phases: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  id: { type: "string" },
                  title: { type: "string" },
                  waves: {
                    type: "array",
                    items: {
                      type: "object",
                      properties: {
                        id: { type: "string" },
                        title: { type: "string" },
                        tasks: {
                          type: "array",
                          items: {
                            type: "object",
                            properties: {
                              id: { type: "string" },
                              title: { type: "string" },
                              objective: { type: "string" },
                              dependsOn: { type: "array", items: { type: "string" } },
                            },
                            required: ["id", "title", "objective", "dependsOn"],
                            additionalProperties: false,
                          },
                        },
                      },
                      required: ["id", "title", "tasks"],
                      additionalProperties: false,
                    },
                  },
                },
                required: ["id", "title", "waves"],
                additionalProperties: false,
              },
            },
          },
          required: ["workflowId", "phases"],
          additionalProperties: false,
        },
        options: { namespace: "loom", codemode: false },
        execute: async (input, tool) => {
          if (tool.agent !== "planner") {
            return { content: renderToolOutput({ error: "Only planner may define the persistent work plan." }) }
          }

          const value = input as {
            workflowId: string
            expectedVersion?: number
            replaceReason?: string
            phases: WorkPlanPhase[]
          }
          const workflow = await readBoundWorkflow(ctx, tool.sessionID, value.workflowId, ensureLegacySession)
          if (!workflow) return { content: renderToolOutput({ error: "Workflow not found." }) }

          const planStep = workflow.steps.find((step) => step.id === "plan")
          if (!planStep) return { content: renderToolOutput({ error: "Workflow has no planning step." }) }
          if (!runnable(workflow).some((step) => step.id === "plan")) {
            return { content: renderToolOutput({ error: "Planning step is not currently runnable." }) }
          }

          try {
            const objectiveId = workflow.work?.objectiveId ?? objectiveIdForAnchor(workflow.anchor)
            const result = await withWorkflowWorkLocks(runtime, workflow.id, objectiveId, async () => {
              await validateWorkflowMutationLocked(ctx, runtime, workflow)
              const now = new Date().toISOString()
              let work = await readWork(ctx, objectiveId)
              if (!work) {
                work = createWorkHierarchy(workflow.anchor, workflow.id, now)
                attachWorkflowToWork(work, workflow.id, now)
              }

              if (work.generation > 0) {
                if (value.expectedVersion === undefined) {
                  throw new Error(
                    "Replacing an existing work-plan generation requires expectedVersion from loom_work_status.",
                  )
                }
                if (value.expectedVersion !== work.version) {
                  throw new Error(
                    `Stale work-plan version: expected ${value.expectedVersion}, current ${work.version}.`,
                  )
                }
                if (!value.replaceReason?.trim()) {
                  throw new Error("Replacing an existing work-plan generation requires replaceReason.")
                }
              }

              materializeWorkPlan(work, workflow.id, value.phases, now)
              await ctx.storage.set(workKey(work.objectiveId), work)
              workflow.work = { objectiveId: work.objectiveId, generation: work.generation }
              await persistWorkflowMutationLocked(ctx, runtime, workflow)
              return work
            })

            return {
              content: renderToolOutput({
                objectiveId: result.objectiveId,
                version: result.version,
                generation: result.generation,
                tree: workTree(result),
                nextRunnableWaves: nextRunnableWaves(result),
              }),
            }
          } catch (error) {
            return { content: renderToolOutput({ error: error instanceof Error ? error.message : String(error) }) }
          }
        },
      })

      editor.add({
        name: "work_status",
        description:
          "Inspect persistent Objective/Phase/Wave/Task progress and the next dependency-eligible Waves. Uses the current workflow when no id is supplied.",
        input: {
          type: "object",
          properties: {
            workflowId: { type: "string" },
            objectiveId: { type: "string" },
          },
          additionalProperties: false,
        },
        options: { namespace: "loom", codemode: false },
        execute: async (input, tool) => {
          const value = input as { workflowId?: string; objectiveId?: string }
          let objectiveId = value.objectiveId

          if (!objectiveId) {
            const workflow = value.workflowId
              ? await readBoundWorkflow(ctx, tool.sessionID, value.workflowId, ensureLegacySession)
              : await activeWorkflow(ctx, tool.sessionID, ensureLegacySession)
            objectiveId = workflow?.work?.objectiveId
          }

          if (!objectiveId) {
            return { content: renderToolOutput({ error: "No persistent work Objective is attached." }) }
          }

          if (value.objectiveId) {
            const active = await activeWorkflow(ctx, tool.sessionID, ensureLegacySession)
            if (!active?.work || active.work.objectiveId !== value.objectiveId) {
              return { content: renderToolOutput({ error: "Current session is not bound to a workflow for this Objective." }) }
            }
          }

          const work = await readWork(ctx, objectiveId)
          if (!work) return { content: renderToolOutput({ error: "Persistent work Objective not found." }) }

          return {
            content: renderToolOutput({
              objectiveId: work.objectiveId,
              version: work.version,
              generation: work.generation,
              tree: workTree(work),
              nextRunnableWaves: nextRunnableWaves(work),
            }),
          }
        },
      })


      editor.add({
        name: "work_release",
        description:
          "Release this workflow's persistent Wave claim when abandoning or recovering bounded work. General only; completed Wave history is unchanged.",
        input: {
          type: "object",
          properties: {
            workflowId: { type: "string" },
            reason: { type: "string" },
          },
          required: ["workflowId", "reason"],
          additionalProperties: false,
        },
        options: { namespace: "loom", codemode: false },
        execute: async (input, tool) => {
          if (tool.agent !== "general") {
            return { content: renderToolOutput({ error: "Only general may release a Loom Wave claim." }) }
          }

          const value = input as { workflowId: string; reason: string }
          if (!value.reason.trim()) {
            return { content: renderToolOutput({ error: "Wave claim release requires a concrete reason." }) }
          }

          const workflow = await readBoundWorkflow(ctx, tool.sessionID, value.workflowId, ensureLegacySession)
          if (!workflow?.work) {
            return { content: renderToolOutput({ error: "Workflow has no persistent work claim." }) }
          }

          const taskIds = plannedTaskSteps(workflow).map((taskStep) => taskStep.task!.id)
          if (taskIds.length === 0) {
            return { content: renderToolOutput({ error: "Workflow has no planned Wave Tasks to release." }) }
          }

          try {
            await withWorkflowWorkLocks(
              runtime,
              workflow.id,
              workflow.work.objectiveId,
              async () => {
                await validateWorkflowMutationLocked(ctx, runtime, workflow)
                const work = await readWork(ctx, workflow.work!.objectiveId)
                if (!work) throw new Error("Persistent work hierarchy not found.")
                assertWorkGeneration(work, workflow.work!.generation)
                assertWaveClaimForTasks(
                  work,
                  workflow.id,
                  workflow.work!.generation,
                  taskIds,
                )

                const now = new Date().toISOString()
                releaseWorkflowWave(
                  work,
                  workflow.id,
                  workflow.work!.generation,
                  taskIds,
                  now,
                )
                await ctx.storage.set(workKey(work.objectiveId), work)
                await ctx.storage.set(
                  `work-release/${workflow.id}/${crypto.randomUUID()}`,
                  { reason: value.reason, at: now, by: tool.agent },
                )
                await ctx.storage.set(
                  bindingReleaseKey(workflow.id, tool.sessionID),
                  { reason: value.reason, at: now, by: tool.agent },
                )
                await persistWorkflowMutationLocked(ctx, runtime, workflow)
              },
            )

            return { content: renderToolOutput({ released: true, workflowId: workflow.id, reason: value.reason }) }
          } catch (error) {
            return { content: renderToolOutput({ error: error instanceof Error ? error.message : String(error) }) }
          }
        },
      })


      editor.add({
        name: "task_plan",
        description:
          "Create the bounded Worker DAG for exactly one remaining runnable Wave from the persistent work plan. Planner only. Tasks become real workflow steps with immutable write scopes.",
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
            return { content: renderToolOutput({ error: "Only planner may define the Worker task graph." }) }
          }

          const value = input as { workflowId: string; tasks: TaskSpec[] }
          const workflow = await readBoundWorkflow(ctx, tool.sessionID, value.workflowId, ensureLegacySession)
          if (!workflow) return { content: renderToolOutput({ error: "Workflow not found." }) }

          const planStep = workflow.steps.find((step) => step.id === "plan")
          if (!planStep) return { content: renderToolOutput({ error: "Workflow has no planning step." }) }
          if (!runnable(workflow).some((step) => step.id === "plan")) {
            return { content: renderToolOutput({ error: "Planning step is not currently runnable." }) }
          }

          try {
            const tasks = validateTaskPlan(value.tasks)
            if (!workflow.work) {
              throw new Error("Persistent work plan is missing. Call loom_work_plan before loom_task_plan.")
            }

            const claimed = await withWorkflowWorkLocks(
              runtime,
              workflow.id,
              workflow.work.objectiveId,
              async () => {
                await validateWorkflowMutationLocked(ctx, runtime, workflow)
                const work = await readWork(ctx, workflow.work!.objectiveId)
                if (!work) throw new Error("Persistent work hierarchy not found.")

                assertWorkGeneration(work, workflow.work!.generation)
                const steps = applyTaskPlan(workflow, tasks)
                const wave = claimWorkflowWave(
                  work,
                  workflow.id,
                  workflow.work!.generation,
                  tasks,
                  (workflow.effects?.workLevel ?? "objective") === "objective",
                  new Date().toISOString(),
                )

                for (const step of steps) {
                  const scope: TaskScope = {
                    workflowId: value.workflowId,
                    stepId: step.id,
                    write: step.task!.write,
                  }
                  await ctx.storage.set(scopeKey(value.workflowId, step.id), scope)
                }

                await ctx.storage.set(workKey(work.objectiveId), work)
                await persistWorkflowMutationLocked(ctx, runtime, workflow)

                const persisted = await readWork(ctx, work.objectiveId)
                if (!persisted) throw new Error("Persistent work hierarchy disappeared after claim.")
                assertWaveClaimForTasks(
                  persisted,
                  workflow.id,
                  workflow.work!.generation,
                  tasks.map((task) => task.id),
                )
                return { work: persisted, wave, steps }
              },
            )
            const steps = claimed.steps
            return {
              content: renderToolOutput({
                wave: { id: claimed.wave.logicalId, title: claimed.wave.title },
                generation: claimed.work.generation,
                tasks: steps.map((step) => ({
                  stepId: step.id,
                  task: step.task,
                  dependsOn: step.dependsOn,
                })),
              }),
            }
          } catch (error) {
            return { content: renderToolOutput({ error: error instanceof Error ? error.message : String(error) }) }
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
        execute: async (input, tool) => {
          const { workflowId } = input as { workflowId: string }
          const workflow = await readBoundWorkflow(ctx, tool.sessionID, workflowId, ensureLegacySession)
          if (!workflow) return { content: renderToolOutput({ error: "Workflow not found." }) }
          const tasks = plannedTaskSteps(workflow)
          const runnableIDs = new Set(runnable(workflow).map((step) => step.id))
          return {
            content: renderToolOutput({
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
            return { content: renderToolOutput({ error: "Only general may define Worker task scope." }) }
          }

          const value = input as { workflowId: string; stepId: string; write: string[] }
          const workflow = await readBoundWorkflow(ctx, tool.sessionID, value.workflowId, ensureLegacySession)
          if (!workflow) return { content: renderToolOutput({ error: "Workflow not found." }) }

          const step = workflow.steps.find((candidate) => candidate.id === value.stepId)
          if (!step) return { content: renderToolOutput({ error: "Step not found." }) }
          if (step.agent !== "worker") {
            return { content: renderToolOutput({ error: "Task scope may only be assigned to Worker steps." }) }
          }
          if (step.task) {
            return { content: renderToolOutput({ error: "Planned task scope is immutable; reopen the planning step to change it." }) }
          }
          if (step.status !== "pending") {
            return { content: renderToolOutput({ error: "Worker task scope cannot change after the step has finished." }) }
          }

          try {
            validateWriteScope(value.write)
          } catch (error) {
            return { content: renderToolOutput({ error: error instanceof Error ? error.message : String(error) }) }
          }

          const scope: TaskScope = {
            workflowId: value.workflowId,
            stepId: value.stepId,
            write: value.write,
          }
          await withRuntimeLock(runtime, "workflow", value.workflowId, async () => {
            await ctx.storage.set(scopeKey(value.workflowId, value.stepId), scope)
            await bumpWorkflowRevisionLocked(ctx, runtime, value.workflowId)
          })
          return { content: renderToolOutput({ scope }) }
        },
      })

      editor.add({
        name: "dispatch_grant",
        description:
          "Issue one short-lived, single-use attachment grant for an exact runnable workflow step or unanswered OQ. General only; pass the returned grantId to the child session.",
        input: {
          type: "object",
          properties: {
            workflowId: { type: "string" },
            stepId: { type: "string" },
            questionId: { type: "string" },
          },
          required: ["workflowId"],
          additionalProperties: false,
        },
        options: { namespace: "loom", codemode: false },
        execute: async (input, tool) => {
          if (tool.agent !== "general") {
            return { content: renderToolOutput({ error: "Only general may issue dispatch grants." }) }
          }

          const value = input as { workflowId: string; stepId?: string; questionId?: string }
          if (Boolean(value.stepId) === Boolean(value.questionId)) {
            return { content: renderToolOutput({ error: "Provide exactly one of stepId or questionId." }) }
          }

          const active = await activeWorkflow(ctx, tool.sessionID, ensureLegacySession)
          if (!active || active.id !== value.workflowId) {
            return { content: renderToolOutput({ error: "General is not bound to this workflow." }) }
          }

          let expectedAgent: string
          if (value.stepId) {
            const step = active.steps.find((candidate) => candidate.id === value.stepId)
            if (!step) return { content: renderToolOutput({ error: "Step not found." }) }
            if (!runnable(active).some((candidate) => candidate.id === step.id)) {
              return { content: renderToolOutput({ error: "Step is not currently runnable." }) }
            }
            expectedAgent = step.agent
          } else {
            const question = (await ctx.storage.get(
              oqKey(value.workflowId, value.questionId!),
            )) as OpenQuestion | undefined
            if (!question || question.status === "closed" || question.answer) {
              return { content: renderToolOutput({ error: "Question is not an unanswered active OQ." }) }
            }
            if (question.requiredAuthority === "user") {
              return { content: renderToolOutput({ error: "User-owned OQs are not dispatched to child agents." }) }
            }
            expectedAgent = question.requiredAuthority
          }

          try {
            const grant = await withRuntimeLock(runtime, "workflow", value.workflowId, async () => {
              const currentBinding = (await ctx.storage.get(sessionKey(tool.sessionID))) as string | undefined
              if (currentBinding !== value.workflowId) {
                throw new Error("General is no longer bound to this workflow.")
              }
              const current = await readWorkflow(ctx, value.workflowId)
              if (!current) throw new Error("Workflow not found.")

              if (value.stepId) {
                const step = current.steps.find((candidate) => candidate.id === value.stepId)
                if (!step || step.agent !== expectedAgent) {
                  throw new Error("Dispatch target changed before grant issuance.")
                }
                if (!runnable(current).some((candidate) => candidate.id === value.stepId)) {
                  throw new Error("Step is no longer runnable.")
                }
              } else {
                const question = (await ctx.storage.get(
                  oqKey(value.workflowId, value.questionId!),
                )) as OpenQuestion | undefined
                if (
                  !question ||
                  question.status === "closed" ||
                  question.answer ||
                  question.requiredAuthority !== expectedAgent
                ) {
                  throw new Error("OQ dispatch target changed before grant issuance.")
                }
              }

              const created = await issueDispatchGrantLocked(ctx.storage as any, runtime, {
                workflowId: value.workflowId,
                ...(value.stepId ? { stepId: value.stepId } : { oqId: value.questionId! }),
                expectedAgent,
                issuingParentSessionId: tool.sessionID,
              })
              await bumpWorkflowRevisionLocked(ctx, runtime, value.workflowId)
              return created
            })
            return {
              content: renderToolOutput({
                grantId: grant.grantId,
                workflowId: grant.workflowId,
                ...(grant.stepId ? { stepId: grant.stepId } : { questionId: grant.oqId }),
                expectedAgent: grant.expectedAgent,
                expiresAt: grant.expiresAt,
              }),
            }
          } catch (error) {
            return { content: renderToolOutput({ error: error instanceof Error ? error.message : String(error) }) }
          }
        },
      })

      editor.add({
        name: "attach",
        description:
          "Consume a General-issued one-use grant and attach the current child session to its exact Loom workflow step or OQ.",
        input: {
          type: "object",
          properties: {
            grantId: { type: "string" },
            workflowId: { type: "string" },
            stepId: { type: "string" },
            questionId: { type: "string" },
          },
          required: ["grantId", "workflowId"],
          additionalProperties: false,
        },
        options: { namespace: "loom", codemode: false },
        execute: async (input, tool) => {
          const value = input as {
            grantId: string
            workflowId: string
            stepId?: string
            questionId?: string
          }
          if (Boolean(value.stepId) === Boolean(value.questionId)) {
            return { content: renderToolOutput({ error: "Provide exactly one of stepId or questionId." }) }
          }

          const targetSnapshot = await readWorkflow(ctx, value.workflowId)
          if (!targetSnapshot) return { content: renderToolOutput({ error: "Workflow not found." }) }
          if (targetSnapshot.projectId !== runtime.projectId) {
            return { content: renderToolOutput({ error: "Workflow belongs to another project." }) }
          }

          const observedBinding = (await ctx.storage.get(sessionKey(tool.sessionID))) as string | undefined
          const resources = [
            { aggregate: "workflow", resourceIdentity: value.workflowId },
            ...(observedBinding && observedBinding !== value.workflowId
              ? [{ aggregate: "workflow", resourceIdentity: observedBinding }]
              : []),
            ...(tool.agent === "worker" && value.stepId && targetSnapshot.work
              ? [{ aggregate: "work", resourceIdentity: targetSnapshot.work.objectiveId }]
              : []),
          ]

          let scope: TaskScope | undefined
          let task: TaskSpec | undefined

          try {
            await withRuntimeLocks(runtime, resources, async () => {
              const previousBinding = await assertSessionRebindingAllowedLocked(
                ctx,
                tool.sessionID,
                observedBinding,
                value.workflowId,
              )
              const workflow = await readWorkflow(ctx, value.workflowId)
              if (!workflow) throw new Error("Workflow not found.")
              if (workflow.projectId !== runtime.projectId) {
                throw new Error("Workflow belongs to another project.")
              }

              if (value.stepId) {
                const step = workflow.steps.find((candidate) => candidate.id === value.stepId)
                if (!step) throw new Error("Step not found.")
                if (step.agent !== tool.agent) {
                  throw new Error(`Step ${value.stepId} belongs to ${step.agent}, not ${tool.agent}.`)
                }
                if (!runnable(workflow).some((candidate) => candidate.id === value.stepId)) {
                  throw new Error("Step is not currently runnable; dependencies or prior gates are incomplete.")
                }

                task = step.task
                if (tool.agent === "worker") {
                  scope = (await ctx.storage.get(scopeKey(value.workflowId, value.stepId))) as TaskScope | undefined
                  if (!scope) throw new Error("Worker step has no declared task scope.")

                  if (step.task && workflow.work) {
                    if (targetSnapshot.work?.objectiveId !== workflow.work.objectiveId) {
                      throw new Error("Workflow work binding changed concurrently; retry attachment.")
                    }
                    const work = await readWork(ctx, workflow.work.objectiveId)
                    if (!work) throw new Error("Persistent work hierarchy not found.")
                    assertWaveClaimForTasks(
                      work,
                      workflow.id,
                      workflow.work.generation,
                      plannedTaskSteps(workflow).map((taskStep) => taskStep.task!.id),
                    )
                  }
                }
              } else {
                const question = (await ctx.storage.get(
                  oqKey(value.workflowId, value.questionId!),
                )) as OpenQuestion | undefined
                if (!question || question.status === "closed" || question.answer) {
                  throw new Error("Question is not an unanswered active OQ.")
                }
                if (question.requiredAuthority !== tool.agent) {
                  throw new Error(`Question requires ${question.requiredAuthority}, not ${tool.agent}.`)
                }
              }

              await consumeDispatchGrantLocked(ctx.storage as any, runtime, {
                grantId: value.grantId,
                workflowId: value.workflowId,
                ...(value.stepId ? { stepId: value.stepId } : { oqId: value.questionId! }),
                expectedAgent: tool.agent,
                consumingSessionId: tool.sessionID,
              })

              await ctx.storage.set(sessionKey(tool.sessionID), value.workflowId)
              await ctx.storage.set(sessionStepKey(tool.sessionID), value.stepId ?? "")
              await ctx.storage.set(sessionOqKey(tool.sessionID), value.questionId ?? "")
              await bumpWorkflowRevisionLocked(ctx, runtime, value.workflowId)
              if (previousBinding && previousBinding !== value.workflowId) {
                await bumpWorkflowRevisionLocked(ctx, runtime, previousBinding)
              }
            })
          } catch (error) {
            return { content: renderToolOutput({ error: error instanceof Error ? error.message : String(error) }) }
          }

          return {
            content: renderToolOutput({
              attached: true,
              workflowId: value.workflowId,
              ...(value.stepId ? { stepId: value.stepId } : { questionId: value.questionId }),
              ...(scope ? { write: scope.write } : {}),
              ...(task ? { task } : {}),
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
        execute: async (input, tool) => {
          const { workflowId, stepId } = input as { workflowId: string; stepId: string }
          if (!(await readBoundWorkflow(ctx, tool.sessionID, workflowId, ensureLegacySession))) {
            return { content: renderToolOutput({ error: "Workflow not found or current session is not bound to it." }) }
          }
          const scope = (await ctx.storage.get(scopeKey(workflowId, stepId))) as TaskScope | undefined
          return { content: renderToolOutput({ scope: scope ?? null }) }
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
            return { content: renderToolOutput({ error: "A durable learning episode needs at least one evidence reference." }) }
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
            return { content: renderToolOutput({ error: "Every learning evidence reference must exist in the Loom evidence ledger.", missing }) }
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
            content: renderToolOutput({
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
            content: renderToolOutput({
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
            content: renderToolOutput({
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
            return { content: renderToolOutput({ error: "Only reviewer or critic may retire learning episodes." }) }
          }

          const value = input as { episodeId: string; reason: string }
          const episode = (await ctx.storage.get(episodeKey(value.episodeId))) as Episode | undefined
          if (!episode) return { content: renderToolOutput({ error: "Episode not found." }) }

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
              content: renderToolOutput({
                episode,
                affectedHeuristics: affected,
                ...(episode.synabun.memoryId
                  ? { synabunForget: { memory_id: episode.synabun.memoryId } }
                  : {}),
              }),
            }
          } catch (error) {
            return { content: renderToolOutput({ error: error instanceof Error ? error.message : String(error) }) }
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

          return { content: renderToolOutput({ unsynced }) }
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
            return { content: renderToolOutput({ error: "Every supporting episode id must exist." }) }
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
            return { content: renderToolOutput({ heuristic }) }
          } catch (error) {
            return { content: renderToolOutput({ error: error instanceof Error ? error.message : String(error) }) }
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
            return { content: renderToolOutput({ error: "Only reviewer or critic may validate or retire heuristics." }) }
          }

          const value = input as {
            heuristicId: string
            action: "validate" | "retire"
            episodeIds: string[]
            note: string
          }
          const heuristic = (await ctx.storage.get(heuristicKey(value.heuristicId))) as Heuristic | undefined
          if (!heuristic) return { content: renderToolOutput({ error: "Heuristic not found." }) }

          const records = await Promise.all(
            value.episodeIds.map((id) => ctx.storage.get(episodeKey(id)) as Promise<Episode | undefined>),
          )
          const episodes = records.filter((episode): episode is Episode => Boolean(episode))
          if (episodes.length !== value.episodeIds.length) {
            return { content: renderToolOutput({ error: "Every review episode id must exist." }) }
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
            return { content: renderToolOutput({ heuristic }) }
          } catch (error) {
            return { content: renderToolOutput({ error: error instanceof Error ? error.message : String(error) }) }
          }
        },
      })

    })

    await ctx.permission.hook("evaluate", async (event) => {
      if (event.action === "edit") {
        const reportResources = event.resources.filter((resource) =>
          resourceMatchesScope(resource, "ephemeral-reports/**"),
        )
        const reportAgent = typeof event.agent === "string" ? event.agent : ""
        if (
          reportResources.length > 0 &&
          (
            !reportProducerAgents.has(reportAgent) ||
            !resourcesWithinScope(reportResources, [`ephemeral-reports/${reportAgent}/**`])
          )
        ) {
          event.effect = "deny"
          event.message =
            "Ephemeral report mutation is producer-scoped. Each report-producing role may edit only its own ephemeral-reports/<role>/ namespace."
          return
        }
      }

      if (
        event.action === "edit" &&
        event.resources.some((resource) => resourceMatchesScope(resource, "docs/reports/**"))
      ) {
        event.effect = "deny"
        event.message =
          "Durable reports are promotion-only. Write operational reports under ephemeral-reports/ and use loom_report_promote when the report itself deserves durable retention."
        return
      }

      if (
        event.action === "shell" &&
        event.resources.some((resource) => resource.replaceAll("\\", "/").includes("docs/reports"))
      ) {
        event.effect = "deny"
        event.message =
          "Shell access to durable report storage is blocked. Use OKF-MCP to inspect reports and loom_report_promote for durable retention."
        return
      }

      if (
        event.action === "shell" &&
        event.resources.some((resource) => resource.replaceAll("\\", "/").includes("ephemeral-reports"))
      ) {
        event.effect = "deny"
        event.message =
          "Shell access to ephemeral report storage is blocked. Use role-scoped edit permissions for report creation and OKF-MCP for discovery/read."
        return
      }

      if (event.agent === "worker" && event.action === "shell") {
        const workflowId = (await ctx.storage.get(sessionKey(event.sessionID))) as string | undefined
        const stepId = (await ctx.storage.get(sessionStepKey(event.sessionID))) as string | undefined

        if (workflowId && stepId) {
          try {
            await assertWorkerWorkClaim(ctx, workflowId, stepId)
          } catch (error) {
            event.effect = "deny"
            event.message = error instanceof Error ? error.message : String(error)
            return
          }
        }

        if (shellResourcesAllowed(event.resources)) return

        const scope =
          workflowId && stepId
            ? ((await ctx.storage.get(scopeKey(workflowId, stepId))) as TaskScope | undefined)
            : undefined

        if (!scope || !shellResourcesAllowed(event.resources, scope.write)) {
          event.effect = "deny"
          event.message =
            "Worker shell is limited to Loom's inspection/verification commands plus explicitly supported scope-aware mutations inside the task write scope."
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

        try {
          await assertWorkerWorkClaim(ctx, workflowId, stepId)
        } catch (error) {
          event.effect = "deny"
          event.message = error instanceof Error ? error.message : String(error)
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

      const workflow = await activeWorkflow(ctx, event.sessionID, ensureLegacySession)
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

      const pendingGrant = await findUsableDispatchGrant(ctx.storage as any, runtime, {
        workflowId: workflow.id,
        ...(runnableStep ? { stepId: runnableStep.id } : { oqId: openQuestion!.id }),
        expectedAgent: target,
        issuingParentSessionId: event.sessionID,
      })
      if (!pendingGrant) {
        event.effect = "deny"
        event.message = `Issue loom_dispatch_grant for the exact ${runnableStep ? `step ${runnableStep.id}` : `OQ ${openQuestion!.id}`} before dispatching ${target}, and pass its grantId to the child.`
        return
      }

      const dispatchID = [
        event.sessionID,
        event.source?.messageID ?? "message",
        event.source?.id ?? "tool",
        target,
      ].join(":")
      const key = runnableStep ? `step:${runnableStep.id}` : `oq:${openQuestion!.id}`
      const recorded = await withRuntimeLock(runtime, "workflow", workflow.id, async () => {
        const limits = await readLimits(ctx, workflow.id)
        const budget = await readBudget(ctx, workflow.id)
        const result = recordDispatch({ state: budget, limits, dispatchID, key, agent: target })
        if (result.allowed) {
          await ctx.storage.set(budgetKey(workflow.id), budget)
          await bumpWorkflowRevisionLocked(ctx, runtime, workflow.id)
          dashboardPublisher.trigger()
        }
        return result
      })

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
      if (skipLoomEvidence(tool)) return
      pendingToolInputs.set(toolEventKey(raw), raw.input)
    })

    await ctx.tool.hook("execute.after", async (event) => {
      const raw = event as any
      const tool = String(raw.tool ?? "")
      if (!tool) return

      // Dashboard publication is read-only and failure-isolated. Trigger after
      // Loom/control activity before evidence filtering so control-plane state
      // changes become visible without turning projection into a dependency.
      dashboardPublisher.trigger()

      if (skipLoomEvidence(tool)) return
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
      let reportPromotion: EvidenceObservation["reportPromotion"]
      const loomTool = tool.replace(/^loom[._]/, "")
      if (
        raw.status === "completed" &&
        loomTool === "report_promote" &&
        input &&
        typeof input === "object" &&
        typeof (input as Record<string, unknown>).destination === "string"
      ) {
        const promotionId = (await ctx.storage.get(
          reportPromotionDestinationKey(String((input as Record<string, unknown>).destination)),
        )) as string | undefined
        const record = promotionId
          ? ((await ctx.storage.get(reportPromotionKey(promotionId))) as ReportPromotionRecord | undefined)
          : undefined
        if (
          record?.status === "completed" &&
          record.sha256 &&
          record.promotedAt
        ) {
          reportPromotion = {
            id: record.id,
            source: record.source,
            destination: record.destination,
            reason: record.reason,
            sha256: record.sha256,
            actor: record.actor,
            promotedAt: record.promotedAt,
            authority: "unchanged",
          }
        }
      }

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
        ...(reportPromotion ? { reportPromotion } : {}),
      }

      await ctx.storage.set(evidenceKey(observation.id), observation)
      await ctx.storage.set(`${sessionEvidencePrefix(observation.sessionID)}${observation.id}`, observation.id)
    })
  },
}

export default loomPlugin
