import { createHash, randomUUID } from "node:crypto"
import { lstat, mkdir, readFile, readlink, realpath, unlink } from "node:fs/promises"
import { dirname, isAbsolute, join, relative, resolve } from "node:path"
import { execFile } from "node:child_process"
import { promisify } from "node:util"
import { captureEvidenceAdmission, observationCallKey, persistEvidenceObservation, sessionAttachmentKey, type EvidenceAdmission } from "./evidence-admission"
import type * as OpenCodePlugin from "@opencode/plugin"
import { RUNTIME_STATE_VERSION, admitDispatchGrantLocked, consumeDispatchGrantLocked, createProjectStorage, createTransactionalStorage, ensureRuntimeStateVersion, findUsableDispatchGrant, importLegacyPluginStorage, issueDispatchGrantLocked, migrateLegacySessionState, resolveRuntimeIdentity, sessionBoundToOq, sessionBoundToStep, sessionBoundToWorkflow, tryAcquireRuntimeLocks, withRuntimeAdvisoryLock, withRuntimeLock, withRuntimeLocks, type LoomRuntimeIdentity } from "./runtime"
import { LoomRpc } from "./rpc"
import { assertLoomToolAdmission, assertCancelledChildToolAdmission, cancelWorkflow, ensureCompletedWaveHistory, workflowBindingTerminal, type CancelWorkflowInput } from "./lifecycle"
import { buildSidebarSnapshot } from "./sidebar"
import { renderToolOutput } from "./presentation"
import {
  buildStatusView,
  clippedSummary,
  dashboardWorkflowUrl,
  compactQuestions,
  compactVerification,
  renderStatusMarkdown,
  statusPresentation,
  writeStatusArtifact,
} from "./status-view"
import { createDashboardPublisher, runtimeInstanceIsLive } from "./dashboard"
import { ensureDashboardServerLifecycle } from "./dashboard-lifecycle"
import {
  objectiveUpgradeActions,
  upgradeCompatibilityNotice,
} from "./upgrade-actions"

export const LOOM_NATIVE_TOOL_GUIDANCE =
  "Loom control-plane tools are available through two equivalent OpenCode surfaces: native loom_* tools and Code Mode mirrors under tools.loom.code.*. Use either surface directly according to the active tool paradigm. If using Code Mode, search for Loom tools and invoke the returned tools.loom.code.* signatures; do not fall back to shell/filesystem discovery for Loom commands. Reviewer/Critic methodology uses a two-part contract: load practitioner guidance with OpenCode's native skill tool, then consume the role companion through loom_assessment or loom_qa; a plain ASSESSMENT.md/QA.md read is artifact inspection, not methodology loading. Interactive status is dashboard-first and does not depend on model prose: the Loom sidebar exposes a stable workflow dashboard URL, while loom_status may also return presentation metadata. Desktop browser preview is optional metadata only; do not invoke tools.browser.preview merely because presentation metadata exists. When a role owns a repository commit, load git-commit-discipline before committing so the commit remains coherent and reviewable. Loom admits bounded role commits through `git -c core.hooksPath=/dev/null commit -m ...`; long Markdown messages may instead use `git -c core.hooksPath=/dev/null commit -F ephemeral-reports/<role>/commit-messages/<name>.md`. Compose that scratch file with edit/write tools, never shell redirection. Plain `git commit` is intentionally denied so repository hooks cannot change the staged scope after Loom validates it. Runtime write scope is discoverable: an attached child that needs additional project-local files calls loom_scope_elevate and continues immediately when granted. If any Loom tool returns continue=false, the child MUST stop its current turn and return control immediately; it must not retry the blocked mutation or continue assuming authority will arrive later."
import {
  assertWorkflowNotCancelled,
  WorkflowCancelledError,
  addVerificationRequirement,
  applyTaskPlan,
  buildSteps,
  executableTaskPlanFingerprint,
  planningOnlyObjective,
  resolveExecutionDepth,
  executionDepthRank,
  plannedTaskSteps,
  preserveSatisfied,
  finishStep,
  proveVerificationRequirement,
  reconcileVerificationAfterRoute,
  reopenFrom,
  resetVerificationAfterReopen,
  runnable,
  satisfied,
  type Effects,
  type Workflow,
} from "./workflow"
import {
  answerQuestion,
  blockingQuestionsForStep,
  raiseQuestion,
  reconcileQuestion,
  reconcileUserDecisionQuestion,
  relevantQuestions,
  reopenQuestion,
  type OpenQuestion,
  type OQAuthority,
  type OQDisposition,
} from "./oq"
import {
  createClaim,
  observationsSupportKind,
  observationMatchesStep,
  safeInputSummary,
  safeResultError,
  safeResultSummary,
  type EvidenceClaim,
  type EvidenceKind,
  type EvidenceObservation,
} from "./evidence"
import {
  DEFAULT_LIMITS,
  continueWorkflowDispatchBudget,
  effectiveTotalDispatchLimit,
  grantWorkflowDispatchBudget,
  hasMaterialProgress,
  newBudgetState,
  recordDispatch,
  type BudgetState,
  type ExecutionLimits,
  type ProgressSignal,
} from "./budget"
import {
  absoluteResourceMatchesScope,
  committableWriteScope,
  mergeWriteScope,
  resourceMatchesScope,
  resourcesWithinScope,
  validateScopeElevation,
  type ScopeElevation,
  type TaskScope,
} from "./scope"
import {
  allocateDiagnosticSandbox,
  destroyDiagnosticSandbox,
  diffDiagnosticSandbox,
  executeDiagnosticSandbox,
  materializeDiagnosticSandbox,
  resolveDiagnosticSandboxRuntime,
  type DiagnosticSandboxNetwork,
  type DiagnosticSandboxRecord,
} from "./diagnostic-sandbox"
import {
  authorGitShellResourcesAllowed,
  commitMessageScratchPath,
  diagnosticExecutionShellResourcesAllowed,
  gitCommitMessageFile,
  diagnosticShellResourcesAllowed,
  isAllowedGitCommit,
  isGitAuthoringShellCommand,
  scopedGitAddTargets,
  scopedGofmtWriteTargets,
  shellResourcesAllowed,
  workerShellResourcesAllowed,
} from "./shell"
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
import { loadSkillCompanion, type SkillCompanionKind } from "./methodology"
import { LOOM_AGENT_ROLES, taskStepId, validateTaskPlan, type TaskSpec } from "./tasks"
import {
  amendWorkPlan,
  assertInvalidatedPlanReopenable,
  assertWaveClaimForTasks,
  assertWorkGeneration,
  attachWorkflowToWork,
  claimWorkflowWave,
  completeObjective,
  completeWaveForTasks,
  createWorkHierarchy,
  invalidateWorkPlan,
  materializeWorkPlan,
  nextRunnableWaves,
  objectiveWorkLevel,
  objectiveIdForAnchor,
  releaseWorkflowWave,
  reopenWaveForTasks,
  syncWorkTaskStatuses,
  workPlanContext,
  workPlanSemanticFingerprint,
  taskSemanticFingerprintAtRevision,
  validateWorkflowWave,
  validatePlanRoleFeasibility,
  workflowTaskSemanticFingerprint,
  workTree,
  type WorkHierarchy,
  type WorkPlanAmendOperation,
  type WorkPlanDefinition,
  type WorkPlanTopLevelPatch,
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

// Brainstorm is an available OQ responder, but deliberately remains outside
// LOOM_AGENT_ROLES so this does not make Brainstorm a planned Task recipient.
const loomAgents = new Set<string>([...LOOM_AGENT_ROLES, "brainstorm"])

function plannedTaskSatisfied(workflow: Workflow, step: Workflow["steps"][number]) {
  const task = step.task
  if (!task) return false
  if (!task.role || !task.responsibility) return false
  if (task.responsibility === "obtain-user-decision") return step.kind === "wait" && step.status === "complete"
  if (step.kind === "gate") return step.status === "passed"
  if (step.status !== "complete") return false
  const handoffGate = workflow.steps.find((candidate) => candidate.id === `task-review:${task.id}`)
  if (handoffGate) return handoffGate.status === "passed"
  return workflow.steps.some((candidate) => candidate.id === "review-implementation" && candidate.status === "passed")
}

function assertPlannedTaskAdmission(
  workflow: Workflow,
  work: WorkHierarchy | undefined,
  step: Workflow["steps"][number],
) {
  const taskSteps = plannedTaskSteps(workflow)
  const taskIds = taskSteps.map((taskStep) => taskStep.task!.id)
  const compiledTaskStepIds = new Set(taskSteps.map((taskStep) => taskStep.id))
  const handoffGateIds = new Set(
    workflow.steps
      .filter((candidate) => candidate.id.startsWith("task-review:"))
      .map((candidate) => candidate.id),
  )
  const handoffTaskId = step.id.startsWith("task-review:")
    ? step.id.slice("task-review:".length)
    : undefined
  const compiledImplementationReview =
    step.id === "review-implementation" &&
    step.kind === "gate" &&
    taskIds.length > 0 &&
    step.dependsOn.some((dependency) =>
      compiledTaskStepIds.has(dependency) || handoffGateIds.has(dependency),
    )
  if ((!step.task && !handoffTaskId && !compiledImplementationReview) || step.kind === "wait") return
  if (!workflow.work || !work) {
    throw new Error("Task admission denied: persistent Plan and Wave binding are required.")
  }
  if (
    handoffTaskId &&
    !workflow.steps.some((candidate) => candidate.id === `task:${handoffTaskId}` && candidate.task)
  ) {
    throw new Error("Task admission denied: handoff Reviewer gate has no current planned Task.")
  }
  const generation = workflow.work.generation
  if (work.generation !== generation) {
    throw new Error("Task admission denied: workflow is bound to a stale Plan generation.")
  }
  const plan = workPlanContext(work, undefined, "focused", generation)
  if (!plan || plan.invalidated) {
    throw new Error("Task admission denied: current Plan generation is missing or invalidated.")
  }
  const reviewPlan = workflow.steps.find((candidate) => candidate.id === "review-plan")
  if (!reviewPlan || reviewPlan.status !== "passed") {
    throw new Error("Task admission denied: current Plan requires independent review-plan PASS.")
  }

  const currentFingerprint = workflowTaskSemanticFingerprint(work, taskIds, generation)
  if (!currentFingerprint || workflow.work.taskPlanFingerprint !== currentFingerprint) {
    throw new Error("Task admission denied: compiled Task DAG is stale against the current Plan generation.")
  }
  assertWaveClaimForTasks(work, workflow.id, generation, taskIds)
}

const reportProducerAgents = new Set([
  "general",
  "reviewer",
  "critic",
  "designer",
  "acceptance",
  "research",
  "diagnostic",
])

const execFileAsync = promisify(execFile)

const artifactWriteDefaults: Record<string, string[]> = {
  designer: ["docs/design/**", "ephemeral-reports/designer/**"],
  specifier: ["docs/requirements/**"],
  architect: ["docs/architecture/**", "docs/dependencies/**"],
  reviewer: ["ephemeral-reports/reviewer/**"],
  critic: ["ephemeral-reports/critic/**"],
  acceptance: ["ephemeral-reports/acceptance/**"],
  documenter: ["docs/system/**", "docs/user/**", "README.md"],
  research: ["ephemeral-reports/research/**"],
  diagnostic: ["ephemeral-reports/diagnostic/**"],
}

// These roles produce mutable repository artifacts as part of their assigned
// professional work. Independent/advisory roles remain bounded to their own
// output surface even though that surface can still be narrowed and re-expanded.
const productScopeElevatingAgents = new Set([
  "designer",
  "specifier",
  "architect",
  "documenter",
  "worker",
])

const generalGitWriteScope = ["docs/anchors/**"]

const repositoryCommitAgents = new Set([
  "designer",
  "specifier",
  "architect",
  "reviewer",
  "documenter",
  "worker",
])

function roleCanOwnRepositoryCommit(agent: string) {
  return agent === "general" || repositoryCommitAgents.has(agent)
}

function roleCommitMessagePath(agent: string, resource: string) {
  if (!roleCanOwnRepositoryCommit(agent)) return false
  const normalized = commitMessageScratchPath(resource)
  return Boolean(
    normalized &&
    normalized.startsWith(`ephemeral-reports/${agent}/commit-messages/`),
  )
}

async function prepareCommitMessageScratchPath(
  projectDirectory: string,
  agent: string,
  resource: string,
) {
  const normalized = commitMessageScratchPath(resource)
  if (!normalized || !roleCommitMessagePath(agent, normalized)) {
    throw new Error(
      "Commit-message scratch path must be a .md file inside the current commit-owning role's ephemeral-reports/<role>/commit-messages/ namespace.",
    )
  }

  const parentPaths = [
    "ephemeral-reports",
    `ephemeral-reports/${agent}`,
    `ephemeral-reports/${agent}/commit-messages`,
  ]
  for (const path of parentPaths) {
    try {
      const info = await lstat(join(projectDirectory, path))
      if (info.isSymbolicLink() || !info.isDirectory()) {
        throw new Error(
          `Commit-message scratch parent must be a real directory, not a symlink or other file: ${path}`,
        )
      }
    } catch (error: any) {
      if (error?.code !== "ENOENT") throw error
    }
  }

  await mkdir(
    join(projectDirectory, `ephemeral-reports/${agent}/commit-messages`),
    { recursive: true },
  )

  for (const path of parentPaths) {
    const info = await lstat(join(projectDirectory, path))
    if (info.isSymbolicLink() || !info.isDirectory()) {
      throw new Error(
        `Commit-message scratch parent must remain a real directory: ${path}`,
      )
    }
  }

  try {
    const info = await lstat(join(projectDirectory, normalized))
    if (info.isSymbolicLink() || !info.isFile() || info.nlink !== 1) {
      throw new Error(
        "Commit-message scratch file must be a single-link regular file, not a symlink, hardlink, or other file type.",
      )
    }
  } catch (error: any) {
    if (error?.code !== "ENOENT") throw error
  }

  return normalized
}

async function assertOwnedCommitMessageFile(
  ctx: any,
  sessionID: string,
  projectDirectory: string,
  agent: string,
  resource: string,
) {
  const normalized = await prepareCommitMessageScratchPath(
    projectDirectory,
    agent,
    resource,
  )
  const info = await lstat(join(projectDirectory, normalized)).catch(
    (error: any) => {
      if (error?.code === "ENOENT") return undefined
      throw error
    },
  )
  if (!info?.isFile() || info.isSymbolicLink() || info.nlink !== 1) {
    throw new Error(
      "Git commit message file must exist as a single-link regular file written by this current role/session.",
    )
  }

  const ownership = await gitSessionOwnership(ctx, sessionID)
  const expected = ownership.worktreeFingerprints[normalized]
  if (!ownership.paths.includes(normalized) || !expected) {
    throw new Error(
      "Git commit message file was not authored by this current role/session.",
    )
  }
  const actual = await worktreeFingerprint(projectDirectory, normalized)
  if (actual !== expected) {
    throw new Error(
      "Git commit message file changed after this role/session last wrote it.",
    )
  }
}

async function consumeCommitMessageFile(
  ctx: any,
  sessionID: string,
  projectDirectory: string,
  resource: string,
) {
  const normalized = commitMessageScratchPath(resource)
  if (!normalized) return

  const ownership = await gitSessionOwnership(ctx, sessionID)
  ownership.paths = ownership.paths.filter((path) => path !== normalized)
  delete ownership.worktreeFingerprints[normalized]
  delete ownership.stagedFingerprints[normalized]
  await ctx.storage.set(gitSessionOwnershipKey(sessionID), ownership)

  try {
    await unlink(join(projectDirectory, normalized))
  } catch (error: any) {
    if (error?.code !== "ENOENT") {
      // The commit already succeeded. Invalidated ownership is the correctness
      // boundary; any leftover ignored scratch file must be rewritten before reuse.
    }
  }
}

function shellUsesOwnedCommitMessageFile(
  resources: readonly string[],
  agent: string,
) {
  if (resources.length === 0) return false
  return resources.every((command) => {
    const file = gitCommitMessageFile(command)
    return Boolean(file && roleCommitMessagePath(agent, file))
  })
}

function reviewerAcceptanceWriteScope(step: Workflow["steps"][number]) {
  const write = [...(artifactWriteDefaults.reviewer ?? [])]
  if (step.id === "review-think") {
    if (step.dependsOn.includes("designer")) write.unshift("docs/design/**")
    if (step.dependsOn.includes("specifier")) write.unshift("docs/requirements/**")
  } else if (
    step.id === "review-architecture" &&
    step.dependsOn.includes("architect")
  ) {
    write.unshift("docs/architecture/**")
  }
  return [...new Set(write)]
}

function reviewerOwnsAcceptanceBookkeeping(
  step: Workflow["steps"][number],
) {
  return reviewerAcceptanceWriteScope(step).some(
    (path) => !path.startsWith("ephemeral-reports/"),
  )
}

type GitSessionOwnership = {
  schemaVersion: 3
  authorityId?: string
  paths: string[]
  worktreeFingerprints: Record<string, string>
  stagedFingerprints: Record<string, string>
}

type LegacyGitSessionOwnership = {
  schemaVersion: 2
  attachmentId?: string
  paths: string[]
  worktreeFingerprints: Record<string, string>
  stagedFingerprints: Record<string, string>
}

type GitOwnershipBinding = {
  workflowId: string
  stepId: string
  attempt: number
  authorityId: string
}

type GitStepAttemptOwnedPath = {
  schemaVersion: 1
  authorityId: string
  workflowId: string
  stepId: string
  attempt: number
  path: string
  fingerprint: string
  sourceSessionId: string
}

function gitSessionOwnershipKey(sessionID: string) {
  return `git-session-ownership/${encodeURIComponent(sessionID)}`
}

function gitStepAttemptOwnedPathKey(
  workflowId: string,
  stepId: string,
  attempt: number,
  path: string,
) {
  return [
    "git-step-attempt-owned",
    encodeURIComponent(workflowId),
    encodeURIComponent(stepId),
    String(attempt),
    encodeURIComponent(safeOwnedRepoPath(path)),
  ].join("/")
}

function normalizeRepoPath(value: string) {
  return value.replaceAll("\\", "/").replace(/^\.\//, "").replace(/\/$/, "")
}

function safeOwnedRepoPath(value: string) {
  const normalized = normalizeRepoPath(value)
  if (
    !normalized ||
    normalized.startsWith("/") ||
    normalized.split("/").includes("..")
  ) {
    throw new Error("Owned repository path must be project-relative: " + value)
  }
  return normalized
}

async function worktreeFingerprint(projectDirectory: string, value: string) {
  const path = safeOwnedRepoPath(value)
  const absolute = join(projectDirectory, path)
  try {
    const info = await lstat(absolute)
    const hash = createHash("sha256")
    if (info.isSymbolicLink()) {
      return hash
        .update("symlink\0")
        .update(String(info.mode))
        .update("\0")
        .update(await readlink(absolute))
        .digest("hex")
    }
    if (info.isFile()) {
      return hash
        .update("file\0")
        .update(String(info.mode))
        .update("\0")
        .update(await readFile(absolute))
        .digest("hex")
    }
    return hash
      .update("other\0")
      .update(String(info.mode))
      .update("\0")
      .update(String(info.size))
      .digest("hex")
  } catch (error: any) {
    if (error?.code === "ENOENT") return "missing"
    throw error
  }
}

async function stagedFingerprint(projectDirectory: string, value: string) {
  const path = safeOwnedRepoPath(value)
  const { stdout } = await execFileAsync(
    "git",
    ["ls-files", "-s", "--", path],
    { cwd: projectDirectory, encoding: "utf8" },
  )
  const content = String(stdout)
  return content
    ? createHash("sha256").update(content).digest("hex")
    : "missing"
}

async function gitCommandPaths(projectDirectory: string, args: string[]) {
  const { stdout } = await execFileAsync("git", args, {
    cwd: projectDirectory,
    encoding: "utf8",
  })
  return String(stdout).split("\0").filter(Boolean).map(normalizeRepoPath)
}

async function projectHasGitWorktree(projectDirectory: string) {
  try {
    const { stdout } = await execFileAsync(
      "git",
      ["rev-parse", "--is-inside-work-tree"],
      { cwd: projectDirectory, encoding: "utf8" },
    )
    return String(stdout).trim() === "true"
  } catch (error: any) {
    const detail = [
      error?.message,
      error?.stderr,
      error?.stdout,
    ].filter(Boolean).join("\n")
    if (/not a git repository/i.test(detail)) return false
    throw error
  }
}

async function projectDirtyPaths(projectDirectory: string) {
  const [unstaged, staged, untracked] = await Promise.all([
    gitCommandPaths(projectDirectory, ["diff", "--no-renames", "--name-only", "-z"]),
    gitCommandPaths(projectDirectory, ["diff", "--cached", "--no-renames", "--name-only", "-z"]),
    gitCommandPaths(projectDirectory, ["ls-files", "--others", "--exclude-standard", "-z"]),
  ])
  return [...new Set([...unstaged, ...staged, ...untracked])].sort()
}

function mutationLockIdentity(path: string) {
  if (isAbsolute(path)) {
    return `hard-boundary:${resolve(path).replaceAll("\\", "/")}`
  }
  return safeOwnedRepoPath(path)
}

function toolMutationLockPaths(
  tool: string,
  input: unknown,
  projectDirectory: string,
) {
  const paths = successfulMutationPaths(tool, input, projectDirectory)
  if ((tool === "shell" || tool === "bash") && input && typeof input === "object") {
    const command = (input as any).command
    if (typeof command === "string") {
      paths.push(...(scopedGitAddTargets(command) ?? []))
      const messageFile = gitCommitMessageFile(command)
      if (messageFile) paths.push(messageFile)
    }
  }
  return [...new Set(paths.map(mutationLockIdentity))].sort()
}

function toolNeedsGitIndexLock(tool: string, input: unknown) {
  if ((tool !== "shell" && tool !== "bash") || !input || typeof input !== "object") {
    return false
  }
  const command = (input as any).command
  if (typeof command !== "string") return false
  return Boolean(scopedGitAddTargets(command)) || isAllowedGitCommit(command)
}

function writeLockError(paths: readonly string[]) {
  if (paths.length === 1) {
    return `Write blocked: ${paths[0]} is locked for write by another agent. Try again later and re-read the file before retrying.`
  }
  return (
    "Write blocked: these files are locked for write by another agent: " +
    paths.join(", ") +
    ". Try again later and re-read the files before retrying."
  )
}

async function gitSessionOwnershipBinding(
  ctx: any,
  sessionID: string,
): Promise<GitOwnershipBinding | undefined> {
  const [workflowId, stepId, attempt] = await Promise.all([
    ctx.storage.get(sessionKey(sessionID)),
    ctx.storage.get(sessionStepKey(sessionID)),
    ctx.storage.get(sessionStepAttemptKey(sessionID)),
  ])
  if (
    typeof workflowId === "string" &&
    workflowId &&
    typeof stepId === "string" &&
    stepId &&
    Number.isSafeInteger(attempt)
  ) {
    return {
      workflowId,
      stepId,
      attempt: Number(attempt),
      authorityId: `step:${encodeURIComponent(workflowId)}:${encodeURIComponent(stepId)}:${attempt}`,
    }
  }
  return undefined
}

async function gitSessionOwnershipAuthority(
  ctx: any,
  sessionID: string,
): Promise<string | undefined> {
  return (await gitSessionOwnershipBinding(ctx, sessionID))?.authorityId
}

async function recordGitStepAttemptOwnedFingerprints(
  ctx: any,
  binding: GitOwnershipBinding,
  sourceSessionId: string,
  fingerprints: Record<string, string>,
) {
  await Promise.all(
    Object.entries(fingerprints).map(([path, fingerprint]) =>
      ctx.storage.set(
        gitStepAttemptOwnedPathKey(
          binding.workflowId,
          binding.stepId,
          binding.attempt,
          path,
        ),
        {
          schemaVersion: 1,
          authorityId: binding.authorityId,
          workflowId: binding.workflowId,
          stepId: binding.stepId,
          attempt: binding.attempt,
          path,
          fingerprint,
          sourceSessionId,
        } satisfies GitStepAttemptOwnedPath,
      ),
    ),
  )
}

async function gitSessionOwnership(
  ctx: any,
  sessionID: string,
): Promise<GitSessionOwnership> {
  const key = gitSessionOwnershipKey(sessionID)
  const [binding, attachmentId] = await Promise.all([
    gitSessionOwnershipBinding(ctx, sessionID),
    ctx.storage.get(sessionAttachmentKey(sessionID)),
  ])
  const authorityId = binding?.authorityId
  const existing = (await ctx.storage.get(key)) as
    | GitSessionOwnership
    | LegacyGitSessionOwnership
    | undefined
  if (
    existing?.schemaVersion === 3 &&
    existing.authorityId === authorityId
  ) return existing

  if (
    existing?.schemaVersion === 2 &&
    existing.attachmentId === attachmentId
  ) {
    const migrated: GitSessionOwnership = {
      schemaVersion: 3,
      ...(authorityId ? { authorityId } : {}),
      paths: [...existing.paths],
      worktreeFingerprints: { ...existing.worktreeFingerprints },
      stagedFingerprints: { ...existing.stagedFingerprints },
    }
    await ctx.storage.set(key, migrated)
    if (binding) {
      const fingerprints = Object.fromEntries(
        migrated.paths
          .filter((path) => typeof migrated.worktreeFingerprints[path] === "string")
          .map((path) => [path, migrated.worktreeFingerprints[path]]),
      )
      if (Object.keys(fingerprints).length > 0) {
        await recordGitStepAttemptOwnedFingerprints(
          ctx,
          binding,
          sessionID,
          fingerprints,
        )
      }
    }
    return migrated
  }

  const ownership: GitSessionOwnership = {
    schemaVersion: 3,
    ...(authorityId ? { authorityId } : {}),
    paths: [],
    worktreeFingerprints: {},
    stagedFingerprints: {},
  }
  await ctx.storage.set(key, ownership)
  return ownership
}

async function recordGitSessionOwnership(
  ctx: any,
  sessionID: string,
  projectDirectory: string,
  paths: readonly string[],
  recordAttemptProvenance = true,
) {
  if (paths.length === 0) return
  const [ownership, binding] = await Promise.all([
    gitSessionOwnership(ctx, sessionID),
    gitSessionOwnershipBinding(ctx, sessionID),
  ])
  const normalized = [...new Set(paths.map(safeOwnedRepoPath))]
  const fingerprints = Object.fromEntries(
    await Promise.all(
      normalized.map(async (path) => [
        path,
        await worktreeFingerprint(projectDirectory, path),
      ] as const),
    ),
  )
  ownership.paths = [...new Set([...ownership.paths, ...normalized])].sort()
  for (const [path, fingerprint] of Object.entries(fingerprints)) {
    ownership.worktreeFingerprints[path] = fingerprint
    delete ownership.stagedFingerprints[path]
  }
  await ctx.storage.set(gitSessionOwnershipKey(sessionID), ownership)
  if (binding && recordAttemptProvenance) {
    await recordGitStepAttemptOwnedFingerprints(
      ctx,
      binding,
      sessionID,
      fingerprints,
    )
  }
}

async function recordGitSessionStaging(
  ctx: any,
  sessionID: string,
  projectDirectory: string,
  paths: readonly string[],
) {
  if (paths.length === 0) return
  const ownership = await gitSessionOwnership(ctx, sessionID)
  const normalized = [...new Set(paths.map(safeOwnedRepoPath))]
  const fingerprints = await Promise.all(
    normalized.map(async (path) => [path, await stagedFingerprint(projectDirectory, path)] as const),
  )
  for (const [path, fingerprint] of fingerprints) {
    ownership.stagedFingerprints[path] = fingerprint
  }
  await ctx.storage.set(gitSessionOwnershipKey(sessionID), ownership)
}

async function clearGitSessionStaging(
  ctx: any,
  sessionID: string,
) {
  const ownership = await gitSessionOwnership(ctx, sessionID)
  if (Object.keys(ownership.stagedFingerprints).length === 0) return
  ownership.stagedFingerprints = {}
  await ctx.storage.set(gitSessionOwnershipKey(sessionID), ownership)
}

async function resolveGitStagingOwnership(
  ctx: any,
  sessionID: string,
  projectDirectory: string,
  paths: readonly string[],
) {
  const [ownership, binding] = await Promise.all([
    gitSessionOwnership(ctx, sessionID),
    gitSessionOwnershipBinding(ctx, sessionID),
  ])
  const normalized = [...new Set(paths.map(safeOwnedRepoPath))]
  const unowned: string[] = []
  const changed: string[] = []
  let restored = false

  for (const path of normalized) {
    const current = await worktreeFingerprint(projectDirectory, path)
    const ownsPath = ownership.paths.includes(path)
    if (ownsPath && ownership.worktreeFingerprints[path] === current) continue

    const provenance = binding
      ? (await ctx.storage.get(
          gitStepAttemptOwnedPathKey(
            binding.workflowId,
            binding.stepId,
            binding.attempt,
            path,
          ),
        )) as GitStepAttemptOwnedPath | undefined
      : undefined
    const validProvenance =
      provenance?.schemaVersion === 1 &&
      provenance.authorityId === binding?.authorityId &&
      provenance.workflowId === binding?.workflowId &&
      provenance.stepId === binding?.stepId &&
      provenance.attempt === binding?.attempt &&
      provenance.path === path

    if (validProvenance && provenance.fingerprint === current) {
      ownership.paths = [...new Set([...ownership.paths, path])].sort()
      ownership.worktreeFingerprints[path] = current
      delete ownership.stagedFingerprints[path]
      restored = true
      continue
    }

    if (validProvenance || ownsPath) changed.push(path)
    else unowned.push(path)
  }

  if (restored) {
    await ctx.storage.set(gitSessionOwnershipKey(sessionID), ownership)
  }

  return { ownership, unowned, changed }
}

async function changedOwnedPaths(
  ownership: GitSessionOwnership,
  projectDirectory: string,
  paths: readonly string[],
) {
  const changed: string[] = []
  for (const raw of paths) {
    const path = safeOwnedRepoPath(raw)
    const expected = ownership.worktreeFingerprints[path]
    if (!expected || expected !== await worktreeFingerprint(projectDirectory, path)) {
      changed.push(path)
    }
  }
  return changed
}

function projectRelativeMutationPath(projectDirectory: string, value: string) {
  const normalized = value.replaceAll("\\", "/").replace(/^\.\//, "")
  const project = projectDirectory.replaceAll("\\", "/").replace(/\/$/, "")
  if (normalized === project) return undefined
  if (normalized.startsWith(project + "/")) return normalized.slice(project.length + 1)
  if (normalized.startsWith("/")) return resolve(normalized).replaceAll("\\", "/")
  return normalizeRepoPath(normalized)
}

function patchMutationPaths(input: unknown) {
  const patchText =
    input && typeof input === "object" && typeof (input as any).patchText === "string"
      ? String((input as any).patchText)
      : ""
  if (!patchText) return []

  const paths: string[] = []
  for (const line of patchText.split(/\r?\n/)) {
    const match = line.match(/^\*\*\* (?:Add|Update|Delete) File: (.+)$/)
    if (match?.[1]) paths.push(normalizeRepoPath(match[1].trim()))
    const move = line.match(/^\*\*\* Move to: (.+)$/)
    if (move?.[1]) paths.push(normalizeRepoPath(move[1].trim()))
  }
  return [...new Set(paths.filter(Boolean))]
}

function successfulMutationPaths(
  tool: string,
  input: unknown,
  projectDirectory: string,
) {
  if (!input || typeof input !== "object") return []

  if (tool === "edit" || tool === "write") {
    const summary = safeInputSummary(tool, input)
    const path =
      typeof summary.path === "string"
        ? projectRelativeMutationPath(projectDirectory, summary.path)
        : undefined
    return path ? [path] : []
  }

  if (tool === "patch" || tool === "apply_patch") {
    return patchMutationPaths(input)
  }

  if (tool === "shell" || tool === "bash") {
    const command = (input as any).command
    return typeof command === "string"
      ? (scopedGofmtWriteTargets(command) ?? [])
      : []
  }

  return []
}

async function stagedGitPaths(projectDirectory: string) {
  return gitCommandPaths(
    projectDirectory,
    ["diff", "--cached", "--no-renames", "--name-only", "-z"],
  )
}

type GitStageSnapshot = Record<string, string>

async function gitStageSnapshot(
  projectDirectory: string,
  paths: readonly string[],
): Promise<GitStageSnapshot> {
  const normalized = [...new Set(paths.map(safeOwnedRepoPath))]
  if (normalized.length === 0) return {}

  const staged = new Set(await stagedGitPaths(projectDirectory))
  const entries = await Promise.all(
    normalized
      .filter((path) => staged.has(path))
      .map(async (path) => [
        path,
        await stagedFingerprint(projectDirectory, path),
      ] as const),
  )
  return Object.fromEntries(entries)
}

async function gitIndexMatchesWorktree(
  projectDirectory: string,
  path: string,
) {
  try {
    await execFileAsync(
      "git",
      ["diff", "--quiet", "--no-ext-diff", "--", safeOwnedRepoPath(path)],
      { cwd: projectDirectory, encoding: "utf8" },
    )
    return true
  } catch (error: any) {
    if (Number(error?.code) === 1) return false
    throw error
  }
}

async function changedStagedTargetsSince(
  projectDirectory: string,
  paths: readonly string[],
  before: GitStageSnapshot,
) {
  const after = await gitStageSnapshot(projectDirectory, paths)
  const changed: string[] = []
  for (const raw of paths) {
    const path = safeOwnedRepoPath(raw)
    const next = after[path]
    if (next === undefined || before[path] === next) continue
    if (await gitIndexMatchesWorktree(projectDirectory, path)) {
      changed.push(path)
    }
  }
  return changed
}

async function gitIndexConflictError(
  ctx: any,
  sessionID: string,
  projectDirectory: string,
  addTargets: readonly string[],
) {
  const staged = await stagedGitPaths(projectDirectory)
  if (staged.length === 0) return undefined

  const requested = new Set(addTargets.map(safeOwnedRepoPath))
  const [ownership, binding] = await Promise.all([
    gitSessionOwnership(ctx, sessionID),
    gitSessionOwnershipBinding(ctx, sessionID),
  ])
  const conflicts: string[] = []
  let adopted = false

  for (const raw of staged) {
    const path = safeOwnedRepoPath(raw)

    // An explicit restage is allowed to replace whatever is currently in the
    // shared index for that exact path. The worktree bytes are provenance-
    // checked separately before the command runs.
    if (requested.has(path)) continue

    const actual = await stagedFingerprint(projectDirectory, path)
    const expected = ownership.stagedFingerprints[path]
    if (expected && expected === actual) continue

    // Session-local Git state is only a cache. A fresh child attached to the
    // same step attempt may inherit an already-staged entry when both durable
    // step-attempt provenance and the current worktree prove those exact bytes.
    if (binding) {
      const provenance = (await ctx.storage.get(
        gitStepAttemptOwnedPathKey(
          binding.workflowId,
          binding.stepId,
          binding.attempt,
          path,
        ),
      )) as GitStepAttemptOwnedPath | undefined
      const current = await worktreeFingerprint(projectDirectory, path)
      if (
        provenance?.schemaVersion === 1 &&
        provenance.authorityId === binding.authorityId &&
        provenance.workflowId === binding.workflowId &&
        provenance.stepId === binding.stepId &&
        provenance.attempt === binding.attempt &&
        provenance.path === path &&
        provenance.fingerprint === current &&
        await gitIndexMatchesWorktree(projectDirectory, path)
      ) {
        ownership.paths = [...new Set([...ownership.paths, path])].sort()
        ownership.worktreeFingerprints[path] = current
        ownership.stagedFingerprints[path] = actual
        adopted = true
        continue
      }
    }

    conflicts.push(path)
  }

  if (adopted) {
    await ctx.storage.set(gitSessionOwnershipKey(sessionID), ownership)
  }
  if (conflicts.length === 0) return undefined
  return (
    "Git staging denied: the shared repository index already contains staged " +
    "changes owned by another Loom session or an external actor: " +
    conflicts.join(", ") +
    ". Finish or clear those staged changes before staging different files. " +
    "This prevents two agents from contaminating each other's commits."
  )
}

async function recordGitSessionStagingResult(
  ctx: any,
  sessionID: string,
  projectDirectory: string,
  paths: readonly string[],
  status: string,
  before?: GitStageSnapshot,
) {
  if (paths.length === 0) return

  if (status === "completed") {
    await recordGitSessionStaging(
      ctx,
      sessionID,
      projectDirectory,
      paths,
    )
    return
  }

  // A shell chain can fail after git add already changed the index (for
  // example, git diff --cached --check finding whitespace errors). Preserve
  // only staging changes we can prove happened during this exact tool call and
  // whose staged bytes now match the admitted worktree bytes.
  if (status !== "error" || !before) return
  try {
    const changed = await changedStagedTargetsSince(
      projectDirectory,
      paths,
      before,
    )
    if (changed.length > 0) {
      await recordGitSessionStaging(
        ctx,
        sessionID,
        projectDirectory,
        changed,
      )
    }
  } catch {
    // Best-effort recovery must never replace the original shell failure.
  }
}

function reviewerAcceptanceLogPath(path: string) {
  const normalized = normalizeRepoPath(path)
  return /(?:^|\/)(?:changelog|history|changes|acceptance(?:[-_]?log)?|decision(?:s|[-_]?log)?|reviews?)\.md$/i.test(
    normalized,
  )
}

async function trackedAtHead(projectDirectory: string, path: string) {
  try {
    await execFileAsync(
      "git",
      ["cat-file", "-e", `HEAD:${safeOwnedRepoPath(path)}`],
      { cwd: projectDirectory, encoding: "utf8" },
    )
    return true
  } catch {
    return false
  }
}

function reviewerAcceptanceMetadataLine(line: string) {
  const value = line.trim()
  if (!value) return true
  return (
    /^(?:\*\*)?status\s*:(?:\*\*)?/i.test(value) ||
    /^(?:\*\*)?(?:accepted|acceptance|reviewed?)(?:[-_ ](?:at|by|date|commit|reviewer))?\s*:(?:\*\*)?/i.test(value)
  )
}

async function reviewerAcceptanceCommitError(
  projectDirectory: string,
  staged: readonly string[],
) {
  for (const raw of staged) {
    const path = normalizeRepoPath(raw)
    const { stdout } = await execFileAsync(
      "git",
      ["diff", "--cached", "--unified=0", "--no-renames", "--", path],
      { cwd: projectDirectory, encoding: "utf8" },
    )
    const changed = String(stdout)
      .split("\n")
      .filter(
        (line) =>
          (line.startsWith("+") || line.startsWith("-")) &&
          !line.startsWith("+++") &&
          !line.startsWith("---"),
      )

    if (reviewerAcceptanceLogPath(path)) {
      if (!(await trackedAtHead(projectDirectory, path))) {
        return (
          "Git commit denied: Reviewer may append only to an existing " +
          `repository acceptance/change/decision history file; ${path} is new.`
        )
      }
      const removed = changed.filter((line) => line.startsWith("-"))
      if (removed.length > 0) {
        return (
          "Git commit denied: Reviewer acceptance history is append-only; " +
          `${path} removes or rewrites existing history.`
        )
      }
      continue
    }

    const invalid = changed
      .map((line) => line.slice(1))
      .filter((line) => !reviewerAcceptanceMetadataLine(line))
    if (invalid.length > 0) {
      return (
        "Git commit denied: Reviewer acceptance bookkeeping may change only " +
        `lifecycle/acceptance metadata in ${path}; substantive document content remains producer-owned.`
      )
    }
  }
  return undefined
}

async function reviewerAcceptanceStagedCommitError(
  ctx: any,
  sessionID: string,
  projectDirectory: string,
) {
  const workflowId = (await ctx.storage.get(
    sessionKey(sessionID),
  )) as string | undefined
  const stepId = (await ctx.storage.get(
    sessionStepKey(sessionID),
  )) as string | undefined
  if (!workflowId || !stepId) return undefined

  const workflow = await readWorkflow(ctx, workflowId)
  const step = workflow?.steps.find((candidate) => candidate.id === stepId)
  if (
    !step ||
    step.agent !== "reviewer" ||
    !reviewerOwnsAcceptanceBookkeeping(step)
  ) {
    return undefined
  }

  const staged = await stagedGitPaths(projectDirectory)
  return reviewerAcceptanceCommitError(projectDirectory, staged)
}

async function commitScopeError(
  ctx: any,
  sessionID: string,
  projectDirectory: string,
  writeScope: string[],
  requireExplicitOwnership = true,
) {
  try {
    const [ownership, binding, staged] = await Promise.all([
      gitSessionOwnership(ctx, sessionID),
      gitSessionOwnershipBinding(ctx, sessionID),
      stagedGitPaths(projectDirectory),
    ])
    if (staged.length === 0) return "Git commit denied: no staged repository changes."
    const outside = staged.filter((path) => !resourcesWithinScope([path], writeScope))
    if (outside.length > 0) {
      return `Git commit denied: staged changes outside the current role/task write scope: ${outside.join(", ")}`
    }
    if (requireExplicitOwnership) {
      const unowned = staged.filter(
        (path) => !ownership.paths.includes(normalizeRepoPath(path)),
      )
      if (unowned.length > 0) {
        return `Git commit denied: staged paths were not authored by this role/session: ${unowned.join(", ")}`
      }

      const changedIndex: string[] = []
      let recoveredStagedFingerprint = false
      for (const raw of staged) {
        const path = normalizeRepoPath(raw)
        const expected = ownership.stagedFingerprints[path]
        const actual = await stagedFingerprint(projectDirectory, path)
        if (expected === actual) continue

        // A missing session-local fingerprint may be recovered only when the
        // current step attempt independently proves the exact worktree bytes
        // and the staged index still matches those bytes. Never treat a
        // changed saved fingerprint as cache loss: it is stale provenance.
        if (!expected && binding) {
          const provenance = (await ctx.storage.get(
            gitStepAttemptOwnedPathKey(
              binding.workflowId,
              binding.stepId,
              binding.attempt,
              path,
            ),
          )) as GitStepAttemptOwnedPath | undefined
          const current = await worktreeFingerprint(projectDirectory, path)
          if (
            provenance?.schemaVersion === 1 &&
            provenance.authorityId === binding.authorityId &&
            provenance.workflowId === binding.workflowId &&
            provenance.stepId === binding.stepId &&
            provenance.attempt === binding.attempt &&
            provenance.path === path &&
            provenance.fingerprint === current &&
            await gitIndexMatchesWorktree(projectDirectory, path)
          ) {
            ownership.stagedFingerprints[path] = actual
            recoveredStagedFingerprint = true
            continue
          }
        }
        changedIndex.push(path)
      }
      if (recoveredStagedFingerprint) {
        await ctx.storage.set(gitSessionOwnershipKey(sessionID), ownership)
      }
      if (changedIndex.length > 0) {
        return `Git commit denied: staged content changed after this role/session staged it: ${changedIndex.join(", ")}`
      }

      const unstagedAfterStage = await gitCommandPaths(
        projectDirectory,
        ["diff", "--no-renames", "--name-only", "-z", "--", ...staged],
      )
      if (unstagedAfterStage.length > 0) {
        return (
          "Git commit denied: these staged paths have newer unstaged worktree changes; " +
          "stage the latest admitted bytes before committing: " +
          unstagedAfterStage.join(", ")
        )
      }

      if (binding) {
        const staleProvenance: string[] = []
        for (const raw of staged) {
          const path = normalizeRepoPath(raw)
          const provenance = (await ctx.storage.get(
            gitStepAttemptOwnedPathKey(
              binding.workflowId,
              binding.stepId,
              binding.attempt,
              path,
            ),
          )) as GitStepAttemptOwnedPath | undefined
          const current = await worktreeFingerprint(projectDirectory, path)
          if (
            provenance?.schemaVersion !== 1 ||
            provenance.authorityId !== binding.authorityId ||
            provenance.fingerprint !== current
          ) {
            staleProvenance.push(path)
          }
        }
        if (staleProvenance.length > 0) {
          return (
            "Git commit denied: staged paths no longer match the latest admitted " +
            "bytes for this Loom step attempt: " +
            staleProvenance.join(", ")
          )
        }
      }
    }
    return undefined
  } catch (error) {
    return `Git commit denied: Loom could not verify the staged change scope: ${error instanceof Error ? error.message : String(error)}`
  }
}

async function uncommittedOwnedChangesError(
  ctx: any,
  sessionID: string,
  projectDirectory: string,
  writeScope: string[],
) {
  let dirty: string[]
  try {
    if (!await projectHasGitWorktree(projectDirectory)) return undefined
    dirty = await projectDirtyPaths(projectDirectory)
  } catch (error) {
    return `Cannot verify repository completion state: ${error instanceof Error ? error.message : String(error)}`
  }

  const [ownership, binding] = await Promise.all([
    gitSessionOwnership(ctx, sessionID),
    gitSessionOwnershipBinding(ctx, sessionID),
  ])
  const dirtyOwned: string[] = []
  for (const raw of dirty) {
    const path = normalizeRepoPath(raw)

    // Child completion is step-attempt based. Once Loom admitted bytes for the
    // current attempt, later scope narrowing must not make those dirty bytes
    // disappear from the completion fence.
    if (binding) {
      const provenance = (await ctx.storage.get(
        gitStepAttemptOwnedPathKey(
          binding.workflowId,
          binding.stepId,
          binding.attempt,
          path,
        ),
      )) as GitStepAttemptOwnedPath | undefined
      if (
        provenance?.schemaVersion === 1 &&
        provenance.authorityId === binding.authorityId
      ) {
        dirtyOwned.push(path)
      }
      continue
    }

    // General has no step-attempt authority id, so retain the existing bounded
    // scope check for its session-local ownership.
    if (
      ownership.paths.includes(path) &&
      resourcesWithinScope([path], writeScope)
    ) {
      dirtyOwned.push(path)
    }
  }
  if (dirtyOwned.length === 0) return undefined

  return (
    "Cannot complete while this role has uncommitted changes from its admitted mutations: " +
    dirtyOwned.join(", ") +
    ". Commit these admitted changes before completing."
  )
}

function intentKey(id: string) {
  return `intent/${id}`
}

function sessionIntentKey(sessionID: string) {
  return `session-intent/${sessionID}`
}

type ObservedUserMessage = {
  messageId: string
  text: string
  observedAt: string
}

function sessionUserMessageKey(sessionID: string) {
  return `session-user-message/${sessionID}`
}

function continuationAuthorizationUseKey(sessionID: string, userMessageId: string) {
  return `budget-continuation-user-message/${encodeURIComponent(sessionID)}/${encodeURIComponent(userMessageId)}`
}

function gitOwnershipRecoveryAuthorizationKey(sessionID: string, userMessageId: string) {
  return `git-ownership-recovery-user-message/${encodeURIComponent(sessionID)}/${encodeURIComponent(userMessageId)}`
}

function continuationQuestionAuthorizationUseKey(sessionID: string, denialId: string) {
  return `budget-continuation-question/${encodeURIComponent(sessionID)}/${encodeURIComponent(denialId)}`
}

type BudgetContinuationQuestionTarget = {
  agent: string
  stepId?: string
  questionId?: string
  approvalRef?: string
}
type BudgetBlockedTarget = BudgetContinuationQuestionTarget & {
  workflowId: string
  denialId: string
  approvalRef: string
  reason: string
  blockedAt: string
  questionStartedAt?: string
  questionOwnerInstanceId?: string
  resolvedAt?: string
}
type BudgetQuestionDecision = BudgetContinuationQuestionTarget & {
  workflowId: string
  denialId: string
  callID?: string
  answer: string
  approved: boolean
  decidedAt: string
}

const BUDGET_CONTINUATION_ALLOW = "Allow +1 dispatch"
const BUDGET_CONTINUATION_STOP = "Stop here"

function sessionBudgetBlockedTargetPrefix(sessionID: string) {
  return `budget-continuation-blocked/${encodeURIComponent(sessionID)}/`
}

function budgetContinuationTargetKey(
  sessionID: string,
  workflowId: string,
  target: { stepId?: string; questionId?: string },
) {
  const stepId = target.stepId?.trim()
  const questionId = target.questionId?.trim()
  if (Boolean(stepId) === Boolean(questionId)) return undefined
  const kind = stepId ? "step" : "oq"
  const id = stepId ?? questionId!
  return (
    sessionBudgetBlockedTargetPrefix(sessionID) +
    `${encodeURIComponent(workflowId)}/${kind}/${encodeURIComponent(id)}`
  )
}

function sessionBudgetQuestionDecisionKey(sessionID: string, denialId: string) {
  return `budget-continuation-question-decision/${encodeURIComponent(sessionID)}/${encodeURIComponent(denialId)}`
}

async function matchingActiveBudgetBlockedTargets(ctx: any, sessionID: string, input: unknown) {
  const activeWorkflowId = (await ctx.storage.get(sessionKey(sessionID))) as string | undefined
  if (!activeWorkflowId) return []

  const matches: BudgetBlockedTarget[] = []
  let after: string | undefined
  do {
    const page = await ctx.storage.scan({
      prefix: sessionBudgetBlockedTargetPrefix(sessionID),
      limit: 100,
      ...(after ? { after } : {}),
    })
    for (const entry of page.entries) {
      const blocked = entry.value as BudgetBlockedTarget
      if (!blocked?.denialId || blocked.resolvedAt || blocked.workflowId !== activeWorkflowId) continue
      if (matchesBudgetContinuationQuestion(input, blocked)) matches.push(blocked)
    }
    after = page.next
  } while (after)
  return matches
}

export function budgetContinuationQuestionInput(target: BudgetContinuationQuestionTarget) {
  const label = target.stepId
    ? `${target.agent} step "${target.stepId}"`
    : target.questionId
      ? `${target.agent} OQ "${target.questionId}"`
      : `${target.agent} target`
  return {
    questions: [{
      header: target.approvalRef ? `Budget ${target.approvalRef}` : "Dispatch budget",
      question: `Loom has exhausted the dispatch budget for ${label}, but work remains. Choose "${BUDGET_CONTINUATION_ALLOW}" to approve exactly one additional dispatch. "${BUDGET_CONTINUATION_STOP}" or any custom answer grants no additional capacity.`,
      options: [
        { label: BUDGET_CONTINUATION_ALLOW, description: "Continue this exact blocked target once." },
        { label: BUDGET_CONTINUATION_STOP, description: "Keep current progress and stop without adding dispatch capacity." },
      ],
      multiple: false,
    }],
  }
}

function toolHookInput(raw: any) {
  if (raw?.input !== undefined) return raw.input

  const args = raw?.args
  if (args && typeof args.update === "function") {
    let observed: unknown
    args.update((current: unknown) => {
      observed = current
      return current
    })
    return observed
  }

  return args
}

function matchesBudgetContinuationQuestion(input: unknown, target: BudgetContinuationQuestionTarget) {
  const actual = (input as any)?.questions
  const expected = budgetContinuationQuestionInput(target).questions[0]
  if (!Array.isArray(actual) || actual.length !== 1) return false
  const question = actual[0]
  if (
    question?.header !== expected.header ||
    question?.question !== expected.question ||
    question?.multiple === true
  ) return false
  if (!Array.isArray(question?.options) || question.options.length !== expected.options.length) return false
  return expected.options.every((option, index) =>
    question.options[index]?.label === option.label &&
    question.options[index]?.description === option.description
  )
}

type BudgetQuestionDecisionValue = {
  answer: string
  approved: boolean
}

function budgetQuestionDecision(result: unknown): BudgetQuestionDecisionValue | undefined {
  let value = result as any
  if (typeof value === "string") {
    try { value = JSON.parse(value) } catch { return undefined }
  }
  const answers = value?.metadata?.answers ?? value?.result?.metadata?.answers ?? value?.answers
  if (!Array.isArray(answers) || answers.length !== 1) return undefined
  const selected = answers[0]
  if (!Array.isArray(selected) || selected.length !== 1 || typeof selected[0] !== "string") {
    return undefined
  }
  const answer = selected[0]
  if (!answer) return undefined
  return {
    answer,
    approved: answer === BUDGET_CONTINUATION_ALLOW,
  }
}


type ScopeBoundaryDetail = {
  path: string
  kind:
    | "outside-current-project"
    | "repository-internal-state"
    | "loom-internal-state"
    | "symlink-escape"
  resolvedExistingTarget?: string
}

type ScopeBoundaryRequest = {
  requestId: string
  approvalRef: string
  workflowId: string
  stepId: string
  attempt: number
  agent: string
  requestedBySessionId: string
  generalSessionId: string
  paths: string[]
  boundaryDetails?: ScopeBoundaryDetail[]
  reason: string
  requestedAt: string
  questionStartedAt?: string
  questionOwnerInstanceId?: string
  resolvedAt?: string
}

type ScopeBoundaryDecision = {
  requestId: string
  callID?: string
  answer: string
  approved: boolean
  decidedAt: string
}

type ScopeBoundaryAuthorization = {
  requestId: string
  workflowId: string
  stepId: string
  attempt: number
  agent: string
  patterns: string[]
  boundaryDetails: ScopeBoundaryDetail[]
  authorizedAt: string
  authorizedBySessionId: string
  lastUsedAt?: string
  usedBySessionIds?: string[]
}

const SCOPE_BOUNDARY_ALLOW = "Allow once"
const SCOPE_BOUNDARY_DENY = "Deny"

function scopeBoundaryRequestPrefix(generalSessionId: string) {
  return `scope-boundary-request/${encodeURIComponent(generalSessionId)}/`
}

function scopeBoundaryRequestKey(generalSessionId: string, requestId: string) {
  return scopeBoundaryRequestPrefix(generalSessionId) + encodeURIComponent(requestId)
}

function scopeBoundaryDecisionKey(generalSessionId: string, requestId: string) {
  return `scope-boundary-question-decision/${encodeURIComponent(generalSessionId)}/${encodeURIComponent(requestId)}`
}

function scopeBoundaryAuthorizationPrefix(
  workflowId: string,
  stepId: string,
  attempt: number,
) {
  return [
    "scope-boundary-authorization",
    encodeURIComponent(workflowId),
    encodeURIComponent(stepId),
    String(attempt),
  ].join("/") + "/"
}

function scopeBoundaryAuthorizationKey(
  workflowId: string,
  stepId: string,
  attempt: number,
  requestId: string,
) {
  return scopeBoundaryAuthorizationPrefix(workflowId, stepId, attempt) +
    encodeURIComponent(requestId)
}

async function nearestExistingRealPath(path: string) {
  let candidate = path
  while (true) {
    try {
      return await realpath(candidate)
    } catch (error: any) {
      if (error?.code !== "ENOENT" && error?.code !== "ENOTDIR") throw error
      const parent = dirname(candidate)
      if (parent === candidate) throw error
      candidate = parent
    }
  }
}

function pathBeforeGlob(path: string) {
  const normalized = path.replaceAll("\\", "/")
  const wildcard = normalized.search(/[*?\[\]{}]/)
  if (wildcard < 0) return path
  const prefix = normalized.slice(0, wildcard)
  const boundary = prefix.lastIndexOf("/")
  if (boundary < 0) return "."
  return prefix.slice(0, boundary) || "/"
}

async function classifyScopeTarget(projectDirectory: string, raw: string) {
  const requested = raw.trim()
  if (!requested) throw new Error("Scope elevation paths must not be empty.")

  const absolute = resolve(projectDirectory, requested)
  const projectRelative = relative(projectDirectory, absolute).replaceAll("\\", "/")
  const outside =
    projectRelative === ".." ||
    projectRelative.startsWith("../") ||
    isAbsolute(projectRelative)

  if (outside) {
    return {
      kind: "hard-boundary" as const,
      path: absolute.replaceAll("\\", "/"),
      reason: "outside-current-project",
    }
  }

  if (!projectRelative || projectRelative === ".") {
    throw new Error(
      "Repository-root scope elevation is too broad; request a concrete file or folder.",
    )
  }

  const path = normalizeRepoPath(projectRelative)
  if (path === ".git" || path.startsWith(".git/")) {
    return {
      kind: "hard-boundary" as const,
      path: absolute.replaceAll("\\", "/"),
      reason: "repository-internal-state",
    }
  }
  if (path === ".loom" || path.startsWith(".loom/")) {
    return {
      kind: "hard-boundary" as const,
      path: absolute.replaceAll("\\", "/"),
      reason: "loom-internal-state",
    }
  }

  const [realProjectRoot, realExistingTarget] = await Promise.all([
    realpath(projectDirectory).catch(() => resolve(projectDirectory)),
    nearestExistingRealPath(
      resolve(projectDirectory, pathBeforeGlob(requested)),
    ),
  ])
  const realRelative = relative(realProjectRoot, realExistingTarget)
  if (
    realRelative === ".." ||
    realRelative.startsWith("../") ||
    isAbsolute(realRelative)
  ) {
    return {
      kind: "hard-boundary" as const,
      path: absolute.replaceAll("\\", "/"),
      reason: "symlink-escape",
      resolvedExistingTarget: realExistingTarget.replaceAll("\\", "/"),
    }
  }

  const normalizedRealRelative = realRelative.replaceAll("\\", "/")
  if (
    normalizedRealRelative === ".git" ||
    normalizedRealRelative.startsWith(".git/")
  ) {
    return {
      kind: "hard-boundary" as const,
      path: absolute.replaceAll("\\", "/"),
      reason: "repository-internal-state",
      resolvedExistingTarget: realExistingTarget.replaceAll("\\", "/"),
    }
  }
  if (
    normalizedRealRelative === ".loom" ||
    normalizedRealRelative.startsWith(".loom/")
  ) {
    return {
      kind: "hard-boundary" as const,
      path: absolute.replaceAll("\\", "/"),
      reason: "loom-internal-state",
      resolvedExistingTarget: realExistingTarget.replaceAll("\\", "/"),
    }
  }

  return { kind: "project" as const, path }
}

export function scopeBoundaryQuestionInput(target: {
  approvalRef: string
  agent: string
  paths: string[]
  boundaryDetails?: ScopeBoundaryDetail[]
  reason: string
}) {
  const boundarySummary = (target.boundaryDetails?.length
    ? target.boundaryDetails
    : target.paths.map((path) => ({
        path,
        kind: "outside-current-project" as const,
      })))
    .map((detail) => {
      if (detail.kind === "symlink-escape") {
        return `${detail.path} (symlink escape; existing path resolves outside the project${detail.resolvedExistingTarget ? ` via ${detail.resolvedExistingTarget}` : ""})`
      }
      if (detail.kind === "repository-internal-state") {
        return `${detail.path} (repository-internal .git state${detail.resolvedExistingTarget ? ` via ${detail.resolvedExistingTarget}` : ""})`
      }
      if (detail.kind === "loom-internal-state") {
        return `${detail.path} (Loom internal project state${detail.resolvedExistingTarget ? ` via ${detail.resolvedExistingTarget}` : ""})`
      }
      return `${detail.path} (outside the current project)`
    })
    .join(", ")

  return {
    questions: [{
      header: `Scope ${target.approvalRef}`,
      question:
        `${target.agent} requested one-time write access across Loom's hard boundary for: ${boundarySummary}. Reason: ${target.reason}. Choose "${SCOPE_BOUNDARY_ALLOW}" to authorize exactly this request for the current step attempt. This decision is never remembered. "${SCOPE_BOUNDARY_DENY}" or any custom answer grants no access.`,
      options: [
        {
          label: SCOPE_BOUNDARY_ALLOW,
          description: "Authorize these exact hard-boundary path patterns once for the current step attempt.",
        },
        {
          label: SCOPE_BOUNDARY_DENY,
          description: "Do not authorize the requested hard-boundary access.",
        },
      ],
      multiple: false,
    }],
  }
}

function matchesScopeBoundaryQuestion(input: unknown, target: ScopeBoundaryRequest) {
  const actual = (input as any)?.questions
  const expected = scopeBoundaryQuestionInput(target).questions[0]
  if (!Array.isArray(actual) || actual.length !== 1) return false
  const question = actual[0]
  if (
    question?.header !== expected.header ||
    question?.question !== expected.question ||
    question?.multiple === true
  ) return false
  if (!Array.isArray(question?.options) || question.options.length !== expected.options.length) return false
  return expected.options.every((option, index) =>
    question.options[index]?.label === option.label &&
    question.options[index]?.description === option.description
  )
}

function scopeBoundaryQuestionDecision(result: unknown) {
  let value = result as any
  if (typeof value === "string") {
    try { value = JSON.parse(value) } catch { return undefined }
  }
  const answers = value?.metadata?.answers ?? value?.result?.metadata?.answers ?? value?.answers
  if (!Array.isArray(answers) || answers.length !== 1) return undefined
  const selected = answers[0]
  if (!Array.isArray(selected) || selected.length !== 1 || typeof selected[0] !== "string") {
    return undefined
  }
  const answer = selected[0]
  if (!answer) return undefined
  return { answer, approved: answer === SCOPE_BOUNDARY_ALLOW }
}

async function matchingActiveScopeBoundaryRequests(
  ctx: any,
  generalSessionId: string,
  input: unknown,
) {
  const activeWorkflowId = (await ctx.storage.get(
    sessionKey(generalSessionId),
  )) as string | undefined
  if (!activeWorkflowId) return []

  const matches: ScopeBoundaryRequest[] = []
  let after: string | undefined
  do {
    const page = await ctx.storage.scan({
      prefix: scopeBoundaryRequestPrefix(generalSessionId),
      limit: 100,
      ...(after ? { after } : {}),
    })
    for (const entry of page.entries) {
      const request = entry.value as ScopeBoundaryRequest
      if (
        !request?.requestId ||
        request.resolvedAt ||
        request.workflowId !== activeWorkflowId
      ) continue
      if (matchesScopeBoundaryQuestion(input, request)) matches.push(request)
    }
    after = page.next
  } while (after)
  return matches
}

function resolvedTargetWithinApprovedRoot(
  currentResolvedTarget: string,
  approvedResolvedTarget: string,
) {
  const current = resolve(currentResolvedTarget)
  const approved = resolve(approvedResolvedTarget)
  const rel = relative(approved, current)
  return (
    rel === "" ||
    (rel !== ".." && !rel.startsWith("../") && !isAbsolute(rel))
  )
}

async function boundaryAuthorizationCoversResources(
  projectDirectory: string,
  authorization: ScopeBoundaryAuthorization,
  resources: readonly string[],
) {
  const canonical = resources.map((resource) =>
    resolve(projectDirectory, resource).replaceAll("\\", "/"),
  )
  if (
    !canonical.every((resource) =>
      authorization.patterns.some((pattern) =>
        absoluteResourceMatchesScope(resource, pattern),
      ),
    )
  ) {
    return false
  }

  for (const resource of canonical) {
    const detail = authorization.boundaryDetails.find((candidate) =>
      absoluteResourceMatchesScope(resource, candidate.path),
    )
    if (!detail) return false

    const current = await classifyScopeTarget(projectDirectory, resource)
    if (
      current.kind !== "hard-boundary" ||
      current.reason !== detail.kind
    ) {
      return false
    }

    if (detail.resolvedExistingTarget) {
      if (
        !("resolvedExistingTarget" in current) ||
        !current.resolvedExistingTarget ||
        !resolvedTargetWithinApprovedRoot(
          current.resolvedExistingTarget,
          detail.resolvedExistingTarget,
        )
      ) {
        return false
      }
    }
  }

  return true
}

async function useScopeBoundaryAuthorization(
  ctx: any,
  runtime: LoomRuntimeIdentity,
  projectDirectory: string,
  sessionID: string,
  agent: string,
  resources: readonly string[],
) {
  const binding = await gitSessionOwnershipBinding(ctx, sessionID)
  if (
    !binding ||
    !(await exactRunnableStepAttemptBinding(
      ctx,
      sessionID,
      binding.workflowId,
      binding.stepId,
    ))
  ) return false

  const canonical = resources.map((resource) =>
    resolve(projectDirectory, resource).replaceAll("\\", "/"),
  )
  let after: string | undefined
  const candidates: Array<{ key: string; value: ScopeBoundaryAuthorization }> = []
  do {
    const page = await ctx.storage.scan({
      prefix: scopeBoundaryAuthorizationPrefix(
        binding.workflowId,
        binding.stepId,
        binding.attempt,
      ),
      limit: 100,
      ...(after ? { after } : {}),
    })
    for (const entry of page.entries) {
      const authorization = entry.value as ScopeBoundaryAuthorization
      if (
        authorization?.requestId &&
        authorization.agent === agent &&
        authorization.workflowId === binding.workflowId &&
        authorization.stepId === binding.stepId &&
        authorization.attempt === binding.attempt &&
        await boundaryAuthorizationCoversResources(
          projectDirectory,
          authorization,
          canonical,
        )
      ) {
        candidates.push({ key: entry.key, value: authorization })
      }
    }
    after = page.next
  } while (after)

  if (candidates.length !== 1) return false
  const candidate = candidates[0]
  await withRuntimeLock(
    runtime,
    "scope-boundary-authorization",
    candidate.value.requestId,
    async () => {
      const current = (await ctx.storage.get(
        candidate.key,
      )) as ScopeBoundaryAuthorization | undefined
      if (
        !current ||
        current.workflowId !== binding.workflowId ||
        current.stepId !== binding.stepId ||
        current.attempt !== binding.attempt ||
        current.agent !== agent ||
        !(await boundaryAuthorizationCoversResources(
          projectDirectory,
          current,
          canonical,
        ))
      ) {
        throw new Error("Hard-boundary authorization became stale.")
      }

      await ctx.storage.set(candidate.key, {
        ...current,
        lastUsedAt: new Date().toISOString(),
        usedBySessionIds: [
          ...new Set([...(current.usedBySessionIds ?? []), sessionID]),
        ].sort(),
      } satisfies ScopeBoundaryAuthorization)
    },
  )
  return true
}

async function scopeBoundaryMutationWasAuthorized(
  ctx: any,
  projectDirectory: string,
  sessionID: string,
  agent: string,
  resources: readonly string[],
) {
  const binding = await gitSessionOwnershipBinding(ctx, sessionID)
  if (
    !binding ||
    !(await exactRunnableStepAttemptBinding(
      ctx,
      sessionID,
      binding.workflowId,
      binding.stepId,
    ))
  ) return false
  const canonical = resources.map((resource) =>
    resolve(projectDirectory, resource).replaceAll("\\", "/"),
  )
  let after: string | undefined
  do {
    const page = await ctx.storage.scan({
      prefix: scopeBoundaryAuthorizationPrefix(
        binding.workflowId,
        binding.stepId,
        binding.attempt,
      ),
      limit: 100,
      ...(after ? { after } : {}),
    })
    for (const entry of page.entries) {
      const authorization = entry.value as ScopeBoundaryAuthorization
      if (
        authorization?.requestId &&
        authorization.agent === agent &&
        authorization.workflowId === binding.workflowId &&
        authorization.stepId === binding.stepId &&
        authorization.attempt === binding.attempt &&
        await boundaryAuthorizationCoversResources(
          projectDirectory,
          authorization,
          canonical,
        )
      ) {
        return true
      }
    }
    after = page.next
  } while (after)
  return false
}

function latestObservedUserMessage(messages: unknown): Omit<ObservedUserMessage, "observedAt"> | undefined {
  if (!Array.isArray(messages)) return undefined

  for (let index = messages.length - 1; index >= 0; index--) {
    const message = messages[index] as any
    const role = message?.role ?? message?.info?.role
    if (role !== "user") continue

    const messageId = String(message?.id ?? message?.messageID ?? message?.info?.id ?? "").trim()
    const content = message?.content ?? message?.parts
    const parts = Array.isArray(content) ? content : []
    const text = typeof content === "string"
      ? content.trim()
      : parts
          .filter((part) => part?.type === "text" && typeof part?.text === "string")
          .map((part) => String(part.text))
          .join("\n")
          .trim()

    const controlMessage =
      message?.synthetic === true ||
      message?.metadata?.compaction_continue === true ||
      parts.some(
        (part) =>
          part?.type === "compaction" ||
          part?.synthetic === true ||
          part?.metadata?.compaction_continue === true,
      ) ||
      text === "Continue if you have next steps, or stop and ask for clarification if you are unsure how to proceed." ||
      text === "What did we do so far?"

    if (controlMessage) continue
    if (messageId && text) return { messageId, text }
  }

  return undefined
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

function sessionStepAttemptKey(sessionID: string) {
  return `session-step-attempt/${encodeURIComponent(sessionID)}`
}

type StepSessionBinding = {
  schemaVersion: 1
  workflowId: string
  stepId: string
  attempt: number
  sessionID: string
  agent: string
  attachedAt: string
}

function stepSessionBindingKey(workflowId: string, stepId: string, attempt: number) {
  return [
    "step-session",
    encodeURIComponent(workflowId),
    encodeURIComponent(stepId),
    String(attempt),
  ].join("/")
}

function sessionOqKey(sessionID: string) {
  return `session-oq/${sessionID}`
}

function sessionPlanReviewKey(sessionID: string) {
  return `session-plan-review/${encodeURIComponent(sessionID)}`
}

type PlanReviewBinding = {
  workflowId: string
  generation: number
  revision: number
  planFingerprint: string
  executableFingerprint?: string
  attempt: number
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

function stepAuthorityResource(workflowId: string, stepId: string) {
  return {
    aggregate: "step-authority",
    resourceIdentity: `${workflowId}:${stepId}`,
  }
}

function workflowStepAuthorityResources(workflow: Workflow) {
  return workflow.steps.map((step) => stepAuthorityResource(workflow.id, step.id))
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

function diagnosticSandboxSessionKey(sessionID: string) {
  return `diagnostic-sandbox/${encodeURIComponent(sessionID)}`
}

function bindingReleaseKey(workflowId: string, sessionID: string) {
  return `binding-release/${workflowId}/${sessionID}`
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
  assertWorkflowNotCancelled(current)
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
  allowCancelledBindingTransition = false,
): Promise<Workflow> {
  const current = await readWorkflow(ctx, workflowId)
  if (!current) throw new Error("Workflow disappeared during guarded mutation.")
  if (current.projectId !== runtime.projectId) throw new Error("Workflow belongs to another project.")
  if (!allowCancelledBindingTransition) assertWorkflowNotCancelled(current)
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

async function exactStepAttemptBinding(
  ctx: any,
  sessionID: string,
  workflowId: string,
  stepId: string,
) {
  if (!(await exactStepBinding(ctx, sessionID, workflowId, stepId))) return false
  const attachedAttempt = await ctx.storage.get(sessionStepAttemptKey(sessionID))
  if (!Number.isSafeInteger(attachedAttempt)) return false
  const workflow = await readWorkflow(ctx, workflowId)
  const step = workflow?.steps.find((candidate) => candidate.id === stepId)
  return Boolean(step) && attachedAttempt === (step!.attempt ?? 0)
}

async function exactRunnableStepAttemptBinding(
  ctx: any,
  sessionID: string,
  workflowId: string,
  stepId: string,
) {
  if (!(await exactStepAttemptBinding(ctx, sessionID, workflowId, stepId))) {
    return false
  }
  const workflow = await readWorkflow(ctx, workflowId)
  const step = workflow?.steps.find((candidate) => candidate.id === stepId)
  return Boolean(
    workflow &&
    step &&
    step.status === "pending" &&
    runnable(workflow).some((candidate) => candidate.id === stepId),
  )
}

async function exactOqBinding(ctx: any, sessionID: string, workflowId: string, questionId: string) {
  return sessionBoundToOq(ctx.storage as any, sessionID, workflowId, questionId)
}

async function assertWorkerWorkClaim(ctx: any, workflowId: string, stepId: string) {
  const workflow = await readWorkflow(ctx, workflowId)
  if (!workflow) throw new Error("Workflow not found.")
  assertWorkflowNotCancelled(workflow)
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

function questionView(question: OpenQuestion) {
  const { requiredAuthority, ...rest } = question
  return { ...rest, responder: requiredAuthority }
}

function questionState(questions: OpenQuestion[], workflow: Workflow) {
  const unresolved = questions.filter((question) => question.status !== "closed")
  const routes = unresolved
    .filter((question) => !question.answer)
    .map((question) => ({
      questionId: question.id,
      responder: question.requiredAuthority,
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
      responder: question.requiredAuthority,
      blocking: question.blocking,
      consumers: question.consumerStepIds,
    })),
    routes,
    reconcile,
  }
}

async function notifyAnsweredQuestionConsumers(
  ctx: any,
  runtime: LoomRuntimeIdentity,
  question: OpenQuestion,
) {
  const notified: string[] = []
  const failed: Array<{ stepId: string; error: string }> = []

  for (const stepId of question.consumerStepIds) {
    try {
      const delivered = await withRuntimeLocks(
        runtime,
        [stepAuthorityResource(question.workflowId, stepId)],
        async () => {
          const [workflow, currentQuestion] = await Promise.all([
            readWorkflow(ctx, question.workflowId),
            ctx.storage.get(oqKey(question.workflowId, question.id)) as Promise<OpenQuestion | undefined>,
          ])
          if (
            !workflow ||
            workflow.cancellation ||
            !currentQuestion?.answer ||
            currentQuestion.reconciliations[stepId]
          ) {
            return false
          }

          const step = workflow.steps.find((candidate) => candidate.id === stepId)
          if (
            !step ||
            step.status !== "pending" ||
            !runnable(workflow).some((candidate) => candidate.id === stepId)
          ) {
            return false
          }

          const attempt = step.attempt ?? 0
          const binding = (await ctx.storage.get(
            stepSessionBindingKey(question.workflowId, stepId, attempt),
          )) as StepSessionBinding | undefined
          if (
            !binding ||
            binding.schemaVersion !== 1 ||
            binding.workflowId !== question.workflowId ||
            binding.stepId !== stepId ||
            binding.attempt !== attempt ||
            binding.agent !== step.agent ||
            !(await exactStepAttemptBinding(
              ctx,
              binding.sessionID,
              question.workflowId,
              stepId,
            ))
          ) {
            return false
          }

          await ctx.session.synthetic({
            sessionID: binding.sessionID,
            text:
              `Loom OQ ${question.id} has been answered. Re-read the persisted OQ with loom_oq_list for workflow ${question.workflowId}, incorporate it into step ${stepId}, then call loom_oq_reconcile before completing that step. The persisted OQ state is authoritative; this notification intentionally contains no answer content.`,
            description: "Loom OQ answered",
            metadata: {
              source: "loom",
              kind: "oq-answered",
              workflowId: question.workflowId,
              questionId: question.id,
              stepId,
              attempt,
            },
            delivery: "steer",
            resume: true,
          })
          return true
        },
      )
      if (delivered) notified.push(stepId)
    } catch (error) {
      failed.push({
        stepId,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }

  return { notified, failed }
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

type ObservedProducerSkill = { skill: string; stepIds: string[] }

function upstreamDependencyStepIds(workflow: Workflow, targetStepId: string) {
  const seen = new Set<string>()
  const visit = (stepId: string) => {
    const step = workflow.steps.find((candidate) => candidate.id === stepId)
    if (!step) return
    for (const dependency of step.dependsOn) {
      if (seen.has(dependency)) continue
      seen.add(dependency)
      visit(dependency)
    }
  }
  visit(targetStepId)
  return seen
}

async function observedSkillsForStepIds(
  ctx: any,
  workflow: Workflow,
  stepIds: Set<string>,
): Promise<ObservedProducerSkill[]> {
  const bySkill = new Map<string, Set<string>>()
  for (const step of workflow.steps) {
    if (!stepIds.has(step.id) || step.agent === "reviewer" || step.agent === "critic") continue
    const observations = await stepObservations(ctx, workflow.id, step.id)
    for (const observation of observations) {
      if (
        observation.status !== "completed" ||
        observation.methodology !== "practitioner" ||
        !observation.skill ||
        observation.admission?.attempt !== (step.attempt ?? 0)
      ) continue
      const steps = bySkill.get(observation.skill) ?? new Set<string>()
      steps.add(step.id)
      bySkill.set(observation.skill, steps)
    }
  }
  return [...bySkill.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([skill, producerStepIds]) => ({ skill, stepIds: [...producerStepIds] }))
}

async function observedProducerSkills(ctx: any, workflow: Workflow, targetStepId: string): Promise<ObservedProducerSkill[]> {
  return observedSkillsForStepIds(ctx, workflow, upstreamDependencyStepIds(workflow, targetStepId))
}

async function observedQuestionProducerSkills(
  ctx: any,
  workflow: Workflow,
  question: OpenQuestion,
): Promise<ObservedProducerSkill[]> {
  if (!question.work) return []
  if (
    question.work.taskId &&
    workflow.steps.some((step) => step.id === taskStepId(question.work!.taskId!))
  ) {
    return observedProducerSkills(ctx, workflow, taskStepId(question.work.taskId))
  }
  if (workflow.steps.some((step) => step.id === "plan")) {
    return observedSkillsForStepIds(ctx, workflow, new Set(["plan"]))
  }
  return []
}

async function attachedMethodologyContext(ctx: any, sessionID: string, agent: string) {
  const workflowId = (await ctx.storage.get(sessionKey(sessionID))) as string | undefined
  if (!workflowId) return undefined
  const workflow = await readWorkflow(ctx, workflowId)
  if (!workflow) return undefined

  const stepId = (await ctx.storage.get(sessionStepKey(sessionID))) as string | undefined
  if (stepId) {
    const step = workflow.steps.find((candidate) => candidate.id === stepId)
    if (!step || step.agent !== agent || !(await exactStepBinding(ctx, sessionID, workflowId, stepId))) return undefined
    return { workflowId, stepId, producerSkills: await observedProducerSkills(ctx, workflow, stepId) }
  }

  const questionId = (await ctx.storage.get(sessionOqKey(sessionID))) as string | undefined
  if (!questionId || !(await exactOqBinding(ctx, sessionID, workflowId, questionId))) return undefined
  const question = (await ctx.storage.get(oqKey(workflowId, questionId))) as OpenQuestion | undefined
  if (
    !question ||
    question.status === "closed" ||
    question.requiredAuthority !== agent
  ) return undefined
  return {
    workflowId,
    questionId,
    producerSkills: await observedQuestionProducerSkills(ctx, workflow, question),
  }
}

async function currentSessionSkillDirectory(ctx: any, sessionID: string, skill: string) {
  const observations = await sessionObservations(ctx, sessionID)
  const loaded = observations
    .filter(
      (observation) =>
        observation.tool === "skill" &&
        observation.status === "completed" &&
        observation.methodology === "practitioner" &&
        observation.skill === skill &&
        typeof observation.skillDirectory === "string" &&
        observation.skillDirectory,
    )
    .sort((a, b) => b.observedAt.localeCompare(a.observedAt))[0]
  return loaded?.skillDirectory
}

async function bindSessionEvidence(ctx: any, sessionID: string, workflowId: string, stepId: string) {
  const observations = await sessionObservations(ctx, sessionID)
  let bound = 0

  for (const observation of observations) {
    // Evidence scope was fixed at admission and checked at return. Never upgrade
    // passive/conversational history into governed workflow proof here.
    if (observation.workflowId !== workflowId || observation.stepId !== stepId) continue

    await ctx.storage.set(`${stepEvidencePrefix(workflowId, stepId)}${observation.id}`, observation.id)
    bound++
  }

  return bound
}

const evidenceObservedLoomToolNames = new Set([
  "find",
  "grep",
  "select",
  "stats",
  "report_promote",
  "diagnostic_sandbox_exec",
  "diagnostic_sandbox_diff",
])

function isLoomToolName(tool: string) {
  return tool.startsWith("loom_") || tool.startsWith("loom.")
}

function loomToolLeaf(tool: string) {
  return tool.replace(/^loom[._](?:code[._])?/, "")
}

function isEvidenceObservedLoomToolName(tool: string) {
  if (!isLoomToolName(tool)) return false
  return evidenceObservedLoomToolNames.has(loomToolLeaf(tool))
}

function skipLoomEvidence(tool: string) {
  return isLoomToolName(tool) && !isEvidenceObservedLoomToolName(tool)
}

const loomPlugin: Parameters<typeof OpenCodePlugin.Plugin.define>[0] = {
  id: "loom",

  async setup(ctx) {
    const pluginBuild = createHash("sha256").update(await readFile(new URL(import.meta.url))).digest("hex")
    const setupInstance = randomUUID()
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
    await ensureDashboardServerLifecycle()

    // Per-plugin-instance, bounded pending observations. Missing/evicted before
    // events remain passive; they are never reconstructed from a later binding.
    const pendingObservations = new Map<string, {
      ambiguous: boolean
      ready: boolean
      inputDigest?: string
      summary?: ReturnType<typeof safeInputSummary>
      admission?: EvidenceAdmission
      gitStageBefore?: GitStageSnapshot
    }>()
    const activeGitWriteCalls = new Map<
      string,
      { paths: string[]; release: () => Promise<void> }
    >()

    const acquireGitWriteLocks = async (
      raw: any,
      paths: readonly string[],
      lockGitIndex: boolean,
    ) => {
      const normalized = [...new Set(paths)].sort()
      const sessionID = typeof raw.sessionID === "string" ? raw.sessionID : ""
      const workflowId = sessionID
        ? (await ctx.storage.get(sessionKey(sessionID))) as string | undefined
        : undefined
      const stepId = sessionID
        ? (await ctx.storage.get(sessionStepKey(sessionID))) as string | undefined
        : undefined
      const stepAuthority =
        workflowId && stepId && raw.agent !== "general"
          ? { aggregate: "step-authority", resourceIdentity: `${workflowId}:${stepId}` }
          : undefined
      if (normalized.length === 0 && !lockGitIndex && !stepAuthority) return
      const executionKey = observationCallKey(raw)
      if (!executionKey) {
        throw new Error("Write blocked: Loom could not establish a stable tool-call identity for write locking.")
      }
      if (activeGitWriteCalls.has(executionKey)) {
        throw new Error(
          "Write blocked: this tool-call identity is already performing a mutation. Try again later.",
        )
      }

      const acquired = await tryAcquireRuntimeLocks(
        runtime,
        [
          ...normalized.map((path) => ({
            aggregate: "file-write",
            resourceIdentity: path,
            ...(path.startsWith("hard-boundary:")
              ? { scope: "installation" as const }
              : {}),
          })),
          ...(lockGitIndex
            ? [{
                aggregate: "git-index",
                resourceIdentity: "__repository_index__",
              }]
            : []),
          ...(stepAuthority ? [stepAuthority] : []),
        ],
      )
      if ("busyResource" in acquired) {
        if (acquired.busyResource === "__repository_index__") {
          throw new Error(
            "Git operation blocked: repository index is locked by another agent. Try again later.",
          )
        }
        throw new Error(writeLockError([acquired.busyResource]))
      }

      activeGitWriteCalls.set(executionKey, {
        paths: normalized,
        release: acquired.release,
      })
    }

    const releaseGitWriteLocks = async (raw: any) => {
      const executionKey = observationCallKey(raw)
      if (!executionKey) return
      const active = activeGitWriteCalls.get(executionKey)
      if (!active) return
      try {
        await active.release()
      } finally {
        activeGitWriteCalls.delete(executionKey)
      }
    }

    const revalidateDirectMutationUnderLock = async (
      raw: any,
      directMutationPaths: string[],
    ) => {
      if (directMutationPaths.length === 0 || !raw.sessionID) return

      const sessionID = String(raw.sessionID)
      const workflowId = (await ctx.storage.get(
        sessionKey(sessionID),
      )) as string | undefined
      const stepId = (await ctx.storage.get(
        sessionStepKey(sessionID),
      )) as string | undefined

      if (!raw.agent) return
      const agent = String(raw.agent)

      const commitMessagePaths = directMutationPaths.filter((path) =>
        roleCommitMessagePath(agent, path),
      )
      if (agent === "general" && commitMessagePaths.length === 0) return
      if (agent !== "general" && !loomAgents.has(agent)) return
      if (
        commitMessagePaths.length > 0 &&
        commitMessagePaths.length !== directMutationPaths.length
      ) {
        throw new Error(
          "Do not mix commit-message scratch writes with product mutations in one tool call.",
        )
      }

      const classifiedMutationPaths = await Promise.all(
        directMutationPaths.map(async (path) => ({
          path,
          classification: await classifyScopeTarget(
            ctx.location.directory,
            path,
          ),
        })),
      )
      const hardBoundaryPaths = classifiedMutationPaths
        .filter(
          (entry) => entry.classification.kind === "hard-boundary",
        )
        .map((entry) => entry.path)
      if (hardBoundaryPaths.length > 0) {
        if (hardBoundaryPaths.length !== directMutationPaths.length) {
          throw new Error(
            "Do not mix project-local and hard-boundary writes in one mutation.",
          )
        }
        if (
          await scopeBoundaryMutationWasAuthorized(
            ctx,
            ctx.location.directory,
            sessionID,
            agent,
            hardBoundaryPaths,
          )
        ) {
          return
        }
        throw new Error(
          "Hard-boundary mutation is not authorized for this current step attempt.",
        )
      }

      if (agent !== "general") {
        if (
          !workflowId ||
          !stepId ||
          !(await exactRunnableStepAttemptBinding(ctx, sessionID, workflowId, stepId))
        ) {
          throw new Error(
            `${agent} mutation requires the exact attached current runnable Loom step attempt.`,
          )
        }
        if (agent === "worker") {
          await assertWorkerWorkClaim(ctx, workflowId, stepId)
        }
      }

      const declaredScope =
        workflowId && stepId && agent !== "general"
          ? ((await ctx.storage.get(scopeKey(workflowId, stepId))) as TaskScope | undefined)
          : undefined
      const effectiveWriteScope =
        agent === "general"
          ? generalGitWriteScope
          : declaredScope?.write.length
            ? declaredScope.write
            : (artifactWriteDefaults[agent] ?? [])

      if (commitMessagePaths.length > 0) {
        if (committableWriteScope(effectiveWriteScope).length === 0) {
          throw new Error(
            "Commit-message scratch writes require a current role/step with committable repository scope.",
          )
        }
        await assertCommitMessageScratchWriteTarget(
          raw,
          commitMessagePaths,
        )
        return
      }
      if (
        effectiveWriteScope.length === 0 ||
        !resourcesWithinScope(directMutationPaths, effectiveWriteScope)
      ) {
        throw new Error(
          `${agent} mutation is outside the current Loom write scope. Call loom_scope_elevate for the additional project-local paths before retrying.`,
        )
      }
    }

    const assertCommitMessageScratchWriteTarget = async (
      raw: any,
      paths: readonly string[],
    ) => {
      if (paths.length === 0) return
      const sessionID = String(raw.sessionID ?? "")
      const agent = String(raw.agent ?? "")
      const ownership = await gitSessionOwnership(ctx, sessionID)

      for (const rawPath of paths) {
        const path = await prepareCommitMessageScratchPath(
          ctx.location.directory,
          agent,
          rawPath,
        )
        const absolute = join(ctx.location.directory, path)
        const info = await lstat(absolute).catch((error: any) => {
          if (error?.code === "ENOENT") return undefined
          throw error
        })
        if (!info) continue
        if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1) {
          throw new Error(
            "Commit-message scratch write target must be a single-link regular file.",
          )
        }

        if (!ownership.paths.includes(path)) {
          throw new Error(
            "Commit-message scratch write target already exists but was not authored by this current role/session.",
          )
        }
      }
    }

    const revalidateGitMutationUnderLock = async (raw: any) => {
      const tool = String(raw.tool ?? "")
      if ((tool !== "shell" && tool !== "bash") || !raw.input || typeof raw.input !== "object") {
        return
      }
      const command = (raw.input as any).command
      if (typeof command !== "string") return

      const agent = String(raw.agent ?? "")
      const commitMessageFile = gitCommitMessageFile(command)
      if (commitMessageFile) {
        if (!roleCommitMessagePath(agent, commitMessageFile)) {
          throw new Error(
            "Git commit message file must be inside the current commit-owning role's ephemeral-reports/<role>/commit-messages/ namespace.",
          )
        }
        await assertOwnedCommitMessageFile(
          ctx,
          String(raw.sessionID ?? ""),
          ctx.location.directory,
          agent,
          commitMessageFile,
        )
      }
      if (agent !== "general" && loomAgents.has(agent)) {
        const sessionID = String(raw.sessionID ?? "")
        const workflowId = (await ctx.storage.get(sessionKey(sessionID))) as string | undefined
        const stepId = (await ctx.storage.get(sessionStepKey(sessionID))) as string | undefined
        if (
          !workflowId ||
          !stepId ||
          !(await exactRunnableStepAttemptBinding(ctx, sessionID, workflowId, stepId))
        ) {
          throw new Error(
            "Git authoring requires the role's exact current runnable Loom step attempt.",
          )
        }
      }

      let writeScope: string[] =
        raw.agent === "general"
          ? generalGitWriteScope
          : (artifactWriteDefaults[String(raw.agent ?? "")] ?? [])
      const workflowId = (await ctx.storage.get(
        sessionKey(String(raw.sessionID)),
      )) as string | undefined
      const stepId = (await ctx.storage.get(
        sessionStepKey(String(raw.sessionID)),
      )) as string | undefined
      if (workflowId && stepId && raw.agent !== "general") {
        const scope = (await ctx.storage.get(
          scopeKey(workflowId, stepId),
        )) as TaskScope | undefined
        if (scope?.write.length) writeScope = scope.write
      }
      writeScope = committableWriteScope(writeScope)

      const addTargets = scopedGitAddTargets(command) ?? []
      if (addTargets.length > 0) {
        if (
          writeScope.length === 0 ||
          !resourcesWithinScope(addTargets, writeScope)
        ) {
          throw new Error(
            "Git staging denied: targets are outside the current committable Loom write scope. Re-elevate the needed project-local path before staging.",
          )
        }
        const indexConflict = await gitIndexConflictError(
          ctx,
          String(raw.sessionID),
          ctx.location.directory,
          addTargets,
        )
        if (indexConflict) throw new Error(indexConflict)

        const stage = await resolveGitStagingOwnership(
          ctx,
          String(raw.sessionID),
          ctx.location.directory,
          addTargets,
        )
        if (stage.unowned.length > 0) {
          throw new Error(
            "Git staging denied: stage only exact bytes previously admitted by this current Loom step attempt: " +
            stage.unowned.join(", "),
          )
        }
        if (stage.changed.length > 0) {
          throw new Error(
            "Git staging denied: these files changed after this step attempt's last admitted mutation: " +
            stage.changed.join(", "),
          )
        }
      }

      if (!isAllowedGitCommit(command)) return
      if (!writeScope.length) {
        throw new Error(
          "Git commit denied: the current step has no committable Loom write scope.",
        )
      }
      const error = await commitScopeError(
        ctx,
        String(raw.sessionID),
        ctx.location.directory,
        writeScope,
        true,
      )
      if (error) throw new Error(error)
      if (String(raw.agent ?? "") === "reviewer") {
        const acceptanceError = await reviewerAcceptanceStagedCommitError(
          ctx,
          String(raw.sessionID),
          ctx.location.directory,
        )
        if (acceptanceError) throw new Error(acceptanceError)
      }
    }
    const legacyCheckedSessions = new Set<string>()
    const ensureLegacySession = async (sessionID: string) => {
      if (legacyCheckedSessions.has(sessionID)) return
      if (await scopedStorage.get(`session-deletion-fence/${sessionID}`) !== undefined) {
        legacyCheckedSessions.add(sessionID)
        return
      }
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

    // A resumed pre-epoch child can first return through a host/MCP tool rather
    // than loom_attach. Admit its existing legacy binding before checking the
    // cancellation fence, but do not perform host lookups for fresh sessions.
    const ensureLegacyCancellationBoundary = async (sessionID: string) => {
      if (await scopedStorage.get(sessionKey(sessionID)) !== undefined) return
      if (await scopedStorage.get(`session-deletion-fence/${sessionID}`) !== undefined) return
      if (await legacyStorage.get(sessionKey(sessionID)) !== undefined) {
        await ensureLegacySession(sessionID)
      }
    }

    const cleanupDiagnosticSandboxesForWorkflow = async (workflowId: string) => {
      const destroyed: string[] = []
      const errors: Array<{ sandboxId: string; error: string }> = []
      let after: string | undefined
      do {
        const page = await ctx.storage.scan({
          prefix: "diagnostic-sandbox/",
          limit: 100,
          ...(after ? { after } : {}),
        })
        for (const entry of page.entries) {
          const observed = entry.value as DiagnosticSandboxRecord | undefined
          if (!observed?.active || observed.workflowId !== workflowId) continue
          try {
            await withRuntimeAdvisoryLock(
              runtime,
              "diagnostic-sandbox-instance",
              observed.id,
              async () => {
                const sandbox = (await ctx.storage.get(entry.key)) as DiagnosticSandboxRecord | undefined
                if (!sandbox?.active || sandbox.id !== observed.id || sandbox.workflowId !== workflowId) return
                await destroyDiagnosticSandbox(sandbox)
                await ctx.storage.set(entry.key, sandbox)
                destroyed.push(sandbox.id)
              },
            )
          } catch (error) {
            errors.push({
              sandboxId: observed.id,
              error: error instanceof Error ? error.message : String(error),
            })
          }
        }
        after = page.next
      } while (after)
      return { destroyed, errors }
    }

    await ctx.rpc.register(LoomRpc, {
      sidebar: async (input) => {
        const { sessionID } = input as { sessionID: string }
        const workflow = await activeWorkflow(ctx, sessionID, ensureLegacySession)
        const questions = workflow ? await readQuestions(ctx, workflow.id) : []
        const work = workflow?.work ? await readWork(ctx, workflow.work.objectiveId) : undefined
        return buildSidebarSnapshot(
          workflow,
          questions,
          work,
          workflow ? await dashboardWorkflowUrl(runtime, workflow.id) : undefined,
        )
      },
    })

    await ctx.agent.transform((editor) => {
      if (editor.get("general")) editor.default("general")
    })

    await ctx.tool.transform((editor) => {
      let expectedRosterRegistration: unknown
      const addLoomTool: typeof editor.add = (definition) => {
        const execute = definition.execute
        const registeredExecute = async (input: Parameters<typeof execute>[0], tool: Parameters<typeof execute>[1]) => {
          try {
            await ensureLegacyCancellationBoundary(tool.sessionID)
            await assertLoomToolAdmission(ctx.storage as any, definition.name, input, tool)
            return await execute(input, tool)
          } catch (error) {
            if (!(error instanceof WorkflowCancelledError)) throw error
            return { content: renderToolOutput({ error: error.message }) }
          }
        }
        if (definition.name === "roster") expectedRosterRegistration = registeredExecute
        editor.add({
          ...definition,
          execute: registeredExecute,
        })
      }

      editor.namespace({
        name: "loom",
        description: "Loom workflow control, shared questions, routing, step state, and bounded project inspection.",
      })


      addLoomTool({
        name: "attestation",
        description:
          "Read-only metadata attestation for this live Loom plugin setup instance. Reports bounded provenance and roster-tool registration identity only; never invokes or returns roster data.",
        input: {
          type: "object",
          properties: {},
          additionalProperties: false,
        },
        options: { namespace: "loom", codemode: false },
        execute: async (_input, tool) => {
          if (tool.agent !== "general" && tool.agent !== "planner") {
            throw new Error("The live plugin attestation is available only to General and Planner.")
          }

          const registrations = await ctx.tool.list()
          const rosterRegistrations = registrations.filter(({ id }) => id === "loom_roster")
          if (
            !expectedRosterRegistration ||
            rosterRegistrations.length !== 1 ||
            rosterRegistrations[0]?.execute !== expectedRosterRegistration
          ) {
            throw new Error("The effective production roster registration is unknown or was overridden.")
          }

          return {
            content: renderToolOutput({
              provenance: {
                worktree: runtime.canonicalLocation,
                entrypoint: import.meta.url,
                buildFingerprint: pluginBuild,
                setupInstance,
                rosterRegistration: { id: "loom_roster", present: true },
              },
            }),
          }
        },
      })

      addLoomTool({
        name: "roster",
        description:
          "Read-only live OpenCode agent names and descriptions. Available only to General and Planner; this is discovery, not execution authority.",
        input: {
          type: "object",
          properties: {},
          additionalProperties: false,
        },
        options: { namespace: "loom", codemode: false },
        execute: async (_input, tool) => {
          if (tool.agent !== "general" && tool.agent !== "planner") {
            throw new Error("The live host roster is available only to General and Planner.")
          }

          const roster = await ctx.agent.list({
            location: { directory: runtime.canonicalLocation },
          })
          if (roster.location.directory !== runtime.canonicalLocation) {
            throw new Error("OpenCode returned an agent roster for a different worktree.")
          }
          const agents = roster.data
          const maxAgents = 200
          const maxNameLength = 128
          const maxDescriptionLength = 2_000
          return {
            content: renderToolOutput({
              agents: agents.slice(0, maxAgents).map(({ name, description }) => ({
                name: name.slice(0, maxNameLength),
                description: typeof description === "string"
                  ? description.slice(0, maxDescriptionLength)
                  : "",
              })),
              truncated: agents.length > maxAgents,
              provenance: {
                plugin: "loom",
                worktree: runtime.canonicalLocation,
                entrypoint: import.meta.url,
                build: pluginBuild,
              },
            }),
          }
        },
      })

      addLoomTool({
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

      addLoomTool({
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

      addLoomTool({
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

      addLoomTool({
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

      addLoomTool({
        name: "diagnostic_sandbox_start",
        description:
          "Diagnostic-only governed experiment sandbox. Snapshot the current working directory into Loom runtime storage, give that copy full read/write access inside an ephemeral OCI container, and optionally use host networking. The real project and its Git/Loom metadata are never mounted into the container.",
        input: {
          type: "object",
          properties: {
            image: {
              type: "string",
              description:
                "Locally available OCI image for the experiment. Loom never pulls it implicitly; prefer a project-declared/toolchain-matching trusted image so reproduction conditions are explicit.",
            },
            network: {
              type: "string",
              enum: ["none", "host"],
              description:
                "Container network mode. Use host only when the hypothesis requires access to host/local network services.",
            },
          },
          required: ["image", "network"],
          additionalProperties: false,
        },
        options: { namespace: "loom", codemode: false },
        execute: async (input, tool) => {
          if (tool.agent !== "diagnostic") {
            return { content: renderToolOutput({ error: "Only Diagnostic may create a diagnostic experiment sandbox." }) }
          }

          const workflowId = (await ctx.storage.get(sessionKey(tool.sessionID))) as string | undefined
          const stepId = (await ctx.storage.get(sessionStepKey(tool.sessionID))) as string | undefined
          if (
            !workflowId ||
            !stepId ||
            !(await exactRunnableStepAttemptBinding(ctx, tool.sessionID, workflowId, stepId))
          ) {
            return {
              content: renderToolOutput({
                error:
                  "Diagnostic sandbox experiments require attachment to the exact current runnable Diagnostic step attempt.",
              }),
            }
          }

          const workflow = await readWorkflow(ctx, workflowId)
          const step = workflow?.steps.find((candidate) => candidate.id === stepId)
          if (!step || step.agent !== "diagnostic") {
            return { content: renderToolOutput({ error: "Current attached step is not owned by Diagnostic." }) }
          }

          return withRuntimeAdvisoryLock(
            runtime,
            "diagnostic-sandbox",
            tool.sessionID,
            async () => {
              const key = diagnosticSandboxSessionKey(tool.sessionID)
              const existing = (await ctx.storage.get(key)) as DiagnosticSandboxRecord | undefined
              if (existing?.active) {
                return {
                  content: renderToolOutput({
                    error: "This Diagnostic session already has an active experiment sandbox. Reuse or destroy it before creating another.",
                    sandboxId: existing.id,
                  }),
                }
              }

              const value = input as { image: string; network: DiagnosticSandboxNetwork }
              let sandbox: DiagnosticSandboxRecord | undefined
              try {
                const resolvedRuntime = await resolveDiagnosticSandboxRuntime(
                  value.image,
                )
                sandbox = allocateDiagnosticSandbox({
                  runtimeRoot: runtime.runtimeRoot,
                  projectId: runtime.projectId,
                  sessionId: tool.sessionID,
                  workflowId,
                  stepId,
                  attempt: step.attempt ?? 0,
                  image: resolvedRuntime.reference,
                  imageId: resolvedRuntime.id,
                  network: value.network,
                  engine: resolvedRuntime.engine,
                })

                const registered = await withRuntimeLock(
                  runtime,
                  "workflow",
                  workflowId,
                  async () => {
                    if (!(await exactRunnableStepAttemptBinding(
                      ctx,
                      tool.sessionID,
                      workflowId,
                      stepId,
                    ))) return false
                    await ctx.storage.set(key, sandbox!)
                    return true
                  },
                )
                if (!registered) {
                  return {
                    content: renderToolOutput({
                      error:
                        "Diagnostic step changed before sandbox creation began. Attach to the current attempt before creating a new sandbox.",
                    }),
                  }
                }

                return withRuntimeAdvisoryLock(
                  runtime,
                  "diagnostic-sandbox-instance",
                  sandbox.id,
                  async () => {
                    const current = (await ctx.storage.get(key)) as DiagnosticSandboxRecord | undefined
                    if (!current?.active || current.id !== sandbox!.id) {
                      return {
                        content: renderToolOutput({
                          error:
                            "Diagnostic sandbox creation was cancelled before project bytes were copied.",
                        }),
                      }
                    }

                    try {
                      await materializeDiagnosticSandbox(current, ctx.location.directory)
                      await ctx.storage.set(key, current)
                    } catch (error) {
                      current.active = false
                      current.destroyedAt = new Date().toISOString()
                      await ctx.storage.set(key, current).catch(() => undefined)
                      throw error
                    }

                    if (!(await exactRunnableStepAttemptBinding(
                      ctx,
                      tool.sessionID,
                      workflowId,
                      stepId,
                    ))) {
                      try {
                        await destroyDiagnosticSandbox(current)
                        await ctx.storage.set(key, current)
                      } catch (cleanupError) {
                        await ctx.storage.set(key, current).catch(() => undefined)
                        throw new Error(
                          "Diagnostic step changed while the sandbox snapshot was being created, and sandbox cleanup failed: " +
                          (cleanupError instanceof Error ? cleanupError.message : String(cleanupError)),
                        )
                      }
                      throw new Error(
                        "Diagnostic step changed while the sandbox snapshot was being created. Attach to the current attempt before creating a new sandbox.",
                      )
                    }

                    return {
                      content: renderToolOutput({
                        sandboxId: current.id,
                        snapshotTree: current.snapshotTree,
                        snapshotDigest: current.snapshotDigest,
                        image: current.image,
                        imageId: current.imageId,
                        engine: current.engine,
                        network: current.network,
                        projectSnapshot: "current working-directory bytes at sandbox creation",
                        writable: true,
                        realProjectMounted: false,
                        hostEnvironmentInherited: false,
                      }),
                    }
                  },
                )
              } catch (error) {
                return { content: renderToolOutput({ error: error instanceof Error ? error.message : String(error) }) }
              }
            },
          )
        },
      })

      addLoomTool({
        name: "diagnostic_sandbox_exec",
        description:
          "Run one hypothesis experiment inside the current Diagnostic sandbox. Mutations persist only in the sandbox copy between calls. Command failure is returned as diagnostic evidence rather than applied to the real project.",
        input: {
          type: "object",
          properties: {
            sandboxId: { type: "string" },
            command: { type: "string" },
            timeoutSeconds: {
              type: "number",
              description: "Experiment timeout in seconds, 1-600. Defaults to 120.",
            },
          },
          required: ["sandboxId", "command"],
          additionalProperties: false,
        },
        options: { namespace: "loom", codemode: false },
        execute: async (input, tool) => {
          if (tool.agent !== "diagnostic") {
            return { content: renderToolOutput({ error: "Only Diagnostic may execute diagnostic sandbox experiments." }) }
          }
          const value = input as { sandboxId: string; command: string; timeoutSeconds?: number }
          const sandbox = (await ctx.storage.get(
            diagnosticSandboxSessionKey(tool.sessionID),
          )) as DiagnosticSandboxRecord | undefined
          if (!sandbox?.active || sandbox.id !== value.sandboxId) {
            return { content: renderToolOutput({ error: "Active Diagnostic sandbox not found for this session." }) }
          }

          return withRuntimeAdvisoryLock(
            runtime,
            "diagnostic-sandbox-instance",
            sandbox.id,
            async () => {
              const currentSandbox = (await ctx.storage.get(
                diagnosticSandboxSessionKey(tool.sessionID),
              )) as DiagnosticSandboxRecord | undefined
              if (!currentSandbox?.active || currentSandbox.id !== value.sandboxId) {
                return { content: renderToolOutput({ error: "Active Diagnostic sandbox not found for this session." }) }
              }

              const workflowId = (await ctx.storage.get(sessionKey(tool.sessionID))) as string | undefined
              const stepId = (await ctx.storage.get(sessionStepKey(tool.sessionID))) as string | undefined
              const workflow = workflowId ? await readWorkflow(ctx, workflowId) : undefined
              const step = workflow?.steps.find((candidate) => candidate.id === stepId)
              if (
                !workflowId ||
                !stepId ||
                workflowId !== currentSandbox.workflowId ||
                stepId !== currentSandbox.stepId ||
                (step?.attempt ?? -1) !== currentSandbox.attempt ||
                !(await exactRunnableStepAttemptBinding(ctx, tool.sessionID, workflowId, stepId))
              ) {
                return {
                  content: renderToolOutput({
                    error:
                      "Diagnostic sandbox belongs to an older or different step attempt. Destroy it and attach to current diagnosis before further experiments.",
                  }),
                }
              }

              const result = await executeDiagnosticSandbox(currentSandbox, {
                command: value.command,
                timeoutSeconds: value.timeoutSeconds,
              })
              return { content: renderToolOutput(result) }
            },
          )
        },
      })

      addLoomTool({
        name: "diagnostic_sandbox_diff",
        description:
          "Inspect the experiment delta against the sandbox's private creation-time Git baseline. This never reads or mutates the real project's Git index.",
        input: {
          type: "object",
          properties: {
            sandboxId: { type: "string" },
            includePatch: { type: "boolean" },
          },
          required: ["sandboxId"],
          additionalProperties: false,
        },
        options: { namespace: "loom", codemode: false },
        execute: async (input, tool) => {
          if (tool.agent !== "diagnostic") {
            return { content: renderToolOutput({ error: "Only Diagnostic may inspect a diagnostic sandbox." }) }
          }
          const value = input as { sandboxId: string; includePatch?: boolean }
          const sandbox = (await ctx.storage.get(
            diagnosticSandboxSessionKey(tool.sessionID),
          )) as DiagnosticSandboxRecord | undefined
          if (!sandbox?.active || sandbox.id !== value.sandboxId) {
            return { content: renderToolOutput({ error: "Active Diagnostic sandbox not found for this session." }) }
          }

          return withRuntimeAdvisoryLock(
            runtime,
            "diagnostic-sandbox-instance",
            sandbox.id,
            async () => {
              const currentSandbox = (await ctx.storage.get(
                diagnosticSandboxSessionKey(tool.sessionID),
              )) as DiagnosticSandboxRecord | undefined
              if (!currentSandbox?.active || currentSandbox.id !== value.sandboxId) {
                return { content: renderToolOutput({ error: "Active Diagnostic sandbox not found for this session." }) }
              }

              const workflowId = (await ctx.storage.get(sessionKey(tool.sessionID))) as string | undefined
              const stepId = (await ctx.storage.get(sessionStepKey(tool.sessionID))) as string | undefined
              const workflow = workflowId ? await readWorkflow(ctx, workflowId) : undefined
              const step = workflow?.steps.find((candidate) => candidate.id === stepId)
              if (
                !workflowId ||
                !stepId ||
                workflowId !== currentSandbox.workflowId ||
                stepId !== currentSandbox.stepId ||
                (step?.attempt ?? -1) !== currentSandbox.attempt ||
                !(await exactRunnableStepAttemptBinding(ctx, tool.sessionID, workflowId, stepId))
              ) {
                return {
                  content: renderToolOutput({
                    error:
                      "Diagnostic sandbox belongs to an older or different step attempt. Historical sandbox evidence cannot be rebound into the current diagnosis.",
                  }),
                }
              }

              try {
                return {
                  content: renderToolOutput(await diffDiagnosticSandbox(currentSandbox, Boolean(value.includePatch))),
                }
              } catch (error) {
                return { content: renderToolOutput({ error: error instanceof Error ? error.message : String(error) }) }
              }
            },
          )
        },
      })

      addLoomTool({
        name: "diagnostic_sandbox_destroy",
        description:
          "Destroy this Diagnostic session's disposable experiment sandbox. Cleanup remains allowed after cancellation/reopen because sandbox bytes never carry product authority.",
        input: {
          type: "object",
          properties: {
            sandboxId: { type: "string" },
          },
          required: ["sandboxId"],
          additionalProperties: false,
        },
        options: { namespace: "loom", codemode: false },
        execute: async (input, tool) => {
          if (tool.agent !== "diagnostic") {
            return { content: renderToolOutput({ error: "Only Diagnostic may destroy a diagnostic sandbox." }) }
          }
          const value = input as { sandboxId: string }
          const key = diagnosticSandboxSessionKey(tool.sessionID)
          const sandbox = (await ctx.storage.get(key)) as DiagnosticSandboxRecord | undefined
          if (!sandbox || sandbox.id !== value.sandboxId) {
            return { content: renderToolOutput({ error: "Diagnostic sandbox not found for this session." }) }
          }
          return withRuntimeAdvisoryLock(
            runtime,
            "diagnostic-sandbox-instance",
            sandbox.id,
            async () => {
              const current = (await ctx.storage.get(key)) as DiagnosticSandboxRecord | undefined
              if (!current || current.id !== value.sandboxId) {
                return { content: renderToolOutput({ error: "Diagnostic sandbox not found for this session." }) }
              }
              if (!current.active) {
                return { content: renderToolOutput({ sandboxId: current.id, destroyed: true, alreadyDestroyed: true }) }
              }
              try {
                const result = await destroyDiagnosticSandbox(current)
                await ctx.storage.set(key, current)
                return { content: renderToolOutput(result) }
              } catch (error) {
                return { content: renderToolOutput({ error: error instanceof Error ? error.message : String(error) }) }
              }
            },
          )
        },
      })

      addLoomTool({
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

      addLoomTool({
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

      addLoomTool({
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

      addLoomTool({
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

      addLoomTool({
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

      addLoomTool({
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

      addLoomTool({
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

      addLoomTool({
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

      const loadMethodologyForRole = async (
        kind: SkillCompanionKind,
        expectedAgent: "reviewer" | "critic",
        input: unknown,
        tool: { agent: string; sessionID: string },
      ) => {
        const toolName = kind === "assessment" ? "assessment" : "qa"
        if (tool.agent !== expectedAgent) {
          return { content: renderToolOutput({ error: `loom_${toolName} is reserved for ${expectedAgent}.` }) }
        }
        const skill = String((input as { skill?: string } | undefined)?.skill ?? "").trim()
        if (!skill) return { content: renderToolOutput({ error: "Skill is required." }) }

        try {
          const attached = await attachedMethodologyContext(ctx, tool.sessionID, tool.agent)
          if (attached && !attached.producerSkills.some((entry) => entry.skill === skill)) {
            return {
              content: renderToolOutput({
                error: `Skill ${skill} was not observed in upstream producer work for this gate.`,
                producerSkills: attached.producerSkills,
              }),
            }
          }

          const skillDirectory = await currentSessionSkillDirectory(ctx, tool.sessionID, skill)
          if (!skillDirectory) {
            return {
              content: renderToolOutput({
                error: `Load ${skill} with OpenCode's native skill tool before loom_${toolName}.`,
              }),
            }
          }

          const companion = await loadSkillCompanion(skill, kind, skillDirectory)
          if (companion.available) {
            const admission = await captureEvidenceAdmission(ctx.storage as any, runtime, tool.sessionID, tool.agent)
            await persistEvidenceObservation(
              ctx.storage as any,
              runtime,
              {
                id: crypto.randomUUID(),
                sessionID: tool.sessionID,
                agent: tool.agent,
                tool: kind === "assessment" ? "loom_assessment" : "loom_qa",
                status: "completed",
                observedAt: new Date().toISOString(),
                skill: companion.skill,
                methodology: kind,
                path: companion.path,
                resultDigest: await digest({
                  skill: companion.skill,
                  methodology: kind,
                  path: companion.path,
                  sha256: companion.sha256,
                }),
              },
              admission,
            )
          }

          return { content: renderToolOutput({ ...companion, ...(attached ?? {}) }) }
        } catch (error) {
          return { content: renderToolOutput({ error: error instanceof Error ? error.message : String(error) }) }
        }
      }

      addLoomTool({
        name: "assessment",
        description:
          "Reviewer companion loader. After OpenCode's native skill load, call this to consume ASSESSMENT.md as Reviewer methodology. Works standalone and in attached gates; attached gates may request only skills actually observed upstream.",
        input: {
          type: "object",
          properties: { skill: { type: "string" } },
          required: ["skill"],
          additionalProperties: false,
        },
        options: { namespace: "loom", codemode: false },
        execute: async (input, tool) => loadMethodologyForRole("assessment", "reviewer", input, tool),
      })

      addLoomTool({
        name: "qa",
        description:
          "Critic companion loader. After OpenCode's native skill load, call this to consume QA.md as Critic methodology. Works standalone and in attached gates; attached gates may request only skills actually observed upstream.",
        input: {
          type: "object",
          properties: { skill: { type: "string" } },
          required: ["skill"],
          additionalProperties: false,
        },
        options: { namespace: "loom", codemode: false },
        execute: async (input, tool) => loadMethodologyForRole("qa", "critic", input, tool),
      })

      addLoomTool({
        name: "start",
        description: "Start governed Loom execution for an accepted Anchor or a bounded committed task. Ordinary conversation/investigation does not require this tool. General only.",
        input: {
          type: "object",
          properties: {
            anchor: { type: "string", description: "Repository path to the accepted Anchor." },
            request: {
              type: "string",
              description:
                "Bounded committed execution request when no new product intent or Anchor is needed. Do not use for ordinary conversational research/diagnosis/review. Provide exactly one of anchor or request.",
            },
          },
          additionalProperties: false,
        },
        options: { namespace: "loom", codemode: false },
        execute: async (input, tool) => {
          if (tool.agent !== "general") {
            return { content: renderToolOutput({ error: "Only general may start a Loom workflow." }) }
          }

          const { anchor, request } = input as { anchor?: string; request?: string }
          if (Boolean(anchor) === Boolean(request)) {
            return {
              content: renderToolOutput({
                error: "Provide exactly one of anchor or request.",
              }),
            }
          }

          const intent = await activeIntent(ctx, tool.sessionID, ensureLegacySession)
          if (intent && intent.state !== "accepted") {
            return {
              content: renderToolOutput({
                error: "Cannot start autonomous execution while intent shaping is unresolved.",
                intentState: intent.state,
              }),
            }
          }
          if (
            intent?.acceptedAnchor &&
            (!anchor || intent.acceptedAnchor.path !== anchor)
          ) {
            return {
              content: renderToolOutput({
                error: "Workflow Anchor does not match the accepted intent Anchor.",
                acceptedAnchor: intent.acceptedAnchor.path,
              }),
            }
          }

          const id = crypto.randomUUID()
          const workflowAnchor = anchor ?? `task:${id}`
          const workflow: Workflow = {
            id,
            projectId: runtime.projectId,
            revision: 0,
            anchor: workflowAnchor,
            ...(request ? { request } : {}),
            createdBySession: tool.sessionID,
            createdAt: new Date().toISOString(),
            steps: [],
          }

          const existingObjectiveId = objectiveIdForAnchor(workflowAnchor)
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

              const current = request ? undefined : await readWork(ctx, existingObjectiveId)
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
              await ctx.storage.set(sessionAttachmentKey(tool.sessionID), crypto.randomUUID())
              await ctx.storage.set(sessionStepKey(tool.sessionID), "")
              await ctx.storage.set(sessionStepAttemptKey(tool.sessionID), null)
              await ctx.storage.set(sessionOqKey(tool.sessionID), "")
              if (intent?.acceptedAnchor?.path === anchor) {
                await ctx.storage.set(sessionIntentKey(tool.sessionID), "")
              }
              await ctx.storage.set(limitsKey(id), DEFAULT_LIMITS)
              await ctx.storage.set(budgetKey(id), newBudgetState())

              if (previousBinding && previousBinding !== id) {
                await bumpWorkflowRevisionLocked(ctx, runtime, previousBinding, true)
              }
            })
          } catch (error) {
            return { content: renderToolOutput({ error: error instanceof Error ? error.message : String(error) }) }
          }

          return {
            content: renderToolOutput({
              workflowId: id,
              anchor: workflowAnchor,
              ...(request ? { request } : {}),
              status: "started",
            }),
          }
        },
      })

      addLoomTool({
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
              description:
                "True when the request is scoped to an accepted product Objective or its delivery. Objective depth requires this to be true; with implementationRequested=false the requested workflow outcome may be the reviewed holistic Plan rather than delivered implementation.",
            },
            implementationRequested: {
              type: "boolean",
              description:
                "True when this workflow is authorized to compile and execute product implementation/Worker work. False for inspect, test, diagnose, verify, review-only work, or an Objective request whose desired outcome is a reviewed holistic Plan without implementation.",
            },
            executionDepth: {
              type: "string",
              enum: ["task", "change", "objective"],
              description:
                "Proportional workflow depth. task = smallest bounded path; change = earned specialist/architecture authority plus direct implementation/review; objective = whole-Objective governance, ending at reviewed planning when implementationRequested=false or continuing through delivery when true. Start shallow and escalate only on material evidence.",
            },
            workLevel: {
              type: "string",
              enum: ["objective", "wave"],
              description:
                "Optional Objective-scope override. When omitted, Loom starts conservatively at Wave scope and resolves Wave vs Objective closure automatically from Planner's persistent work plan.",
            },
          },
          required: [
            "humanFacing",
            "behavioral",
            "structural",
            "externalUnknown",
            "diagnostic",
            "productOutcome",
            "implementationRequested",
            "executionDepth",
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

          const rawEffects = input as Effects
          let resolvedDepth: ReturnType<typeof resolveExecutionDepth>
          try {
            resolvedDepth = resolveExecutionDepth(rawEffects)
          } catch (error) {
            return {
              content: renderToolOutput({
                error: error instanceof Error ? error.message : String(error),
              }),
            }
          }

          if (workflow.request && resolvedDepth === "objective") {
            return {
              content: renderToolOutput({
                error:
                  "Objective-depth execution requires an accepted Anchor. Complete the bounded task or shape/accept product intent, then start an Anchor-backed objective workflow.",
              }),
            }
          }

          const implementationStarted = workflow.steps.some(
            (step) =>
              (
                ["worker", "plan", "review-implementation", "review-task", "critic-final"].includes(step.id) ||
                step.id.startsWith("task:")
              ) &&
              ["complete", "passed"].includes(step.status),
          )
          const currentDepth = workflow.effects
            ? resolveExecutionDepth(workflow.effects)
            : undefined
          const deeper =
            currentDepth !== undefined &&
            executionDepthRank(resolvedDepth) > executionDepthRank(currentDepth)

          if (implementationStarted && !deeper) {
            return {
              content: renderToolOutput({
                error:
                  "Route reclassification after completed execution is only allowed when escalating to a deeper execution depth.",
              }),
            }
          }

          const planningOnly =
            resolvedDepth === "objective" &&
            rawEffects.productOutcome &&
            rawEffects.implementationRequested === false
          const autoWorkLevel =
            resolvedDepth === "objective" &&
            rawEffects.productOutcome &&
            !planningOnly &&
            rawEffects.workLevel === undefined
          const effects: Effects = {
            ...rawEffects,
            executionDepth: resolvedDepth,
            ...(resolvedDepth === "objective" && rawEffects.productOutcome
              ? planningOnly
                ? {
                    // Planning-only means the whole Objective Plan is the
                    // requested outcome; execution Wave selection happens only
                    // in a later implementation workflow.
                    workLevel: "objective",
                    workLevelAuto: false,
                  }
                : {
                    workLevel: rawEffects.workLevel ?? "wave",
                    workLevelAuto: autoWorkLevel,
                  }
              : { workLevel: undefined, workLevelAuto: undefined }),
          }

          const applyRouteMutation = () => {
            const next = buildSteps(effects)
            preserveSatisfied(workflow.steps, next)

            // Escalation preserves discovery/authority evidence but never treats
            // previously completed implementation as satisfying newly widened work.
            if (deeper) {
              for (const step of next) {
                if (
                  step.id === "worker" ||
                  step.id === "review-implementation" ||
                  step.id === "review-task" ||
                  step.id === "plan" ||
                  step.id.startsWith("task:") ||
                  ["knowledge-sync", "product-acceptance", "designer-validation", "review-product", "critic-final"].includes(step.id)
                ) {
                  step.status = "pending"
                  delete step.summary
                }
              }
            }

            workflow.effects = effects
            workflow.steps = next
            reconcileVerificationAfterRoute(workflow)
          }

          const invalidateEscalatedWorkerScope = async () => {
            if (deeper && workflow.steps.some((step) => step.id === "worker")) {
              // null is an intentional durable tombstone: Worker dispatch treats
              // it as no declared scope and General must issue a fresh bounded scope.
              await ctx.storage.set(scopeKey(workflow.id, "worker"), null)
            }
          }

          const routeResources = [
            ...workflowStepAuthorityResources(workflow),
            { aggregate: "workflow", resourceIdentity: workflow.id },
          ]
          if (effects.productOutcome && effects.executionDepth === "objective") {
            const objectiveId = objectiveIdForAnchor(workflow.anchor)
            await withRuntimeLocks(
              runtime,
              [
                ...routeResources,
                { aggregate: "work", resourceIdentity: objectiveId },
              ],
              async () => {
                await validateWorkflowMutationLocked(ctx, runtime, workflow)
                const now = new Date().toISOString()
                const existing = await readWork(ctx, objectiveId)
                const work = existing ?? createWorkHierarchy(workflow.anchor, workflow.id, now)
                attachWorkflowToWork(work, workflow.id, now)
                await ctx.storage.set(workKey(objectiveId), work)
                workflow.work = { objectiveId, generation: work.generation }
                applyRouteMutation()
                await invalidateEscalatedWorkerScope()
                await persistWorkflowMutationLocked(ctx, runtime, workflow)
              },
            )
          } else {
            await withRuntimeLocks(runtime, routeResources, async () => {
              await validateWorkflowMutationLocked(ctx, runtime, workflow)
              applyRouteMutation()
              await invalidateEscalatedWorkerScope()
              await persistWorkflowMutationLocked(ctx, runtime, workflow)
            })
          }

          const questions = await readQuestions(ctx, workflow.id)
          const now = runnable(workflow).map((step) => ({ step: step.id, agent: step.agent }))
          return {
            content: renderToolOutput({
              workflowId: workflow.id,
              path: workflow.steps.map((step) => ({
                step: step.id,
                agent: step.agent,
                kind: step.kind,
                waitsFor: step.dependsOn,
              })),
              now,
              continuation: {
                next: now,
                implementationRequested: effects.implementationRequested ?? true,
                workerPresent: workflow.steps.some((step) => step.agent === "worker"),
                instruction:
                  now.length > 0
                    ? "Issue loom_dispatch_grant for the exact runnable step, dispatch that owner, then call loom_status immediately after the child returns."
                    : "No workflow step is currently runnable; inspect questions/blockers before taking any other action.",
              },
              questions: compactQuestions(questions, workflow),
            }),
          }
        },
      })

      addLoomTool({
        name: "status",
        description: "Inspect Loom progress, current/next work, blockers, OQs, verification, and budget. Compact by default; detail=true returns internals. Interactive status is available independently through Loom's stable dashboard workflow URL exposed in the sidebar; the tool also returns browser-safe presentation metadata as a convenience. OpenCode Desktop browser preview is optional metadata only and must not be invoked merely because presentation metadata exists. Presentation availability never blocks or alters Loom workflow state.",
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
          const scopeRecords = (
            await Promise.all(
              workflow.steps.map(async (step) => ({
                step,
                scope: (await ctx.storage.get(
                  scopeKey(workflow.id, step.id),
                )) as TaskScope | undefined,
              })),
            )
          )
          const scopeElevations = scopeRecords
            .flatMap(({ step, scope }) =>
              (scope?.elevations ?? []).map((elevation) => ({
                stepId: step.id,
                agent: step.agent,
                ...elevation,
              })),
            )
            .sort((left, right) =>
              left.elevatedAt.localeCompare(right.elevatedAt),
            )

          const pendingHardBoundaries: ScopeBoundaryRequest[] = []
          let boundaryAfter: string | undefined
          do {
            const page = await ctx.storage.scan({
              prefix: scopeBoundaryRequestPrefix(workflow.createdBySession),
              limit: 100,
              ...(boundaryAfter ? { after: boundaryAfter } : {}),
            })
            for (const entry of page.entries) {
              const request = entry.value as ScopeBoundaryRequest
              if (
                request?.workflowId === workflow.id &&
                !request.resolvedAt
              ) {
                pendingHardBoundaries.push(request)
              }
            }
            boundaryAfter = page.next
          } while (boundaryAfter)

          const view = buildStatusView(
            workflow,
            questions,
            budget,
            limits,
            acceptance,
            knowledge,
            work,
          )
          const artifact = await writeStatusArtifact(runtime, view).catch(() => undefined)
          const presentation = statusPresentation(artifact)
          let compact = renderStatusMarkdown(view, artifact)
          if (scopeElevations.length > 0 || pendingHardBoundaries.length > 0) {
            const lines = ["", "### Scope activity"]
            for (const elevation of scopeElevations.slice(-8)) {
              lines.push(
                `- **${elevation.agent}** · \`${elevation.stepId}\` · +${elevation.paths.join(", ")}${elevation.crossesRoleDefault ? " · crossed role default" : ""} · ${elevation.reason}`,
              )
            }
            for (const request of pendingHardBoundaries.slice(0, 4)) {
              lines.push(
                `- **USER DECISION REQUIRED** · \`${request.stepId}\` · ${request.paths.join(", ")} · child returned control`,
              )
            }
            compact += "\n" + lines.join("\n")
          }
          const scopeActivity = {
            elevations: scopeElevations,
            pendingHardBoundaries: pendingHardBoundaries.map((request) => ({
              requestId: request.requestId,
              approvalRef: request.approvalRef,
              stepId: request.stepId,
              agent: request.agent,
              paths: request.paths,
              reason: request.reason,
              requestedAt: request.requestedAt,
              continue: false,
              rememberChoiceAllowed: false,
            })),
          }
          const metadata = {
            loom: {
              kind: "workflow-status",
              workflowId: workflow.id,
              state: view.state,
              ...(presentation ? { presentation } : {}),
            },
          }

          if (!detail) {
            if (process.env.LOOM_TOOL_OUTPUT === "json") {
              return {
                content: renderToolOutput(
                  {
                    ...view,
                    scopeActivity,
                    ...(presentation ? { presentation } : {}),
                  },
                  "json",
                ),
                metadata,
              }
            }
            return { content: compact, metadata }
          }

          return {
            content: renderToolOutput({
              summary: view,
              workflow,
              runnable: runnable(workflow).map((step) => ({ id: step.id, agent: step.agent })),
              questions: questionState(questions, workflow),
              verification: workflow.verification ?? [],
              budget: { limits, state: budget },
              acceptance: acceptance
                ? { plan: acceptance, readiness: acceptanceReadiness(acceptance) }
                : null,
              knowledge: knowledge ?? null,
              scopeActivity,
            }),
            metadata,
          }
        },
      })

      addLoomTool({
        name: "complete",
        description:
          "Finish one Loom step. Work uses complete; Reviewer/Critic gates use pass or fail. Blocking OQs must be answered and reconciled by this step first.",
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
          if (
            stepId !== "review-plan" &&
            tool.agent !== "general" &&
            loomAgents.has(String(tool.agent)) &&
            !(await exactStepAttemptBinding(ctx, tool.sessionID, workflowId, stepId))
          ) {
            return {
              content: renderToolOutput({
                error: "Step completion requires a fresh attachment to the current step attempt.",
              }),
            }
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
                  responder: question.requiredAuthority,
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

          const planningOnly = planningOnlyObjective(workflow.effects)
          const plannedTasks = plannedTaskSteps(workflow)
          if (planningOnly && plannedTasks.length > 0) {
            return {
              content: renderToolOutput({
                error:
                  "Planning-only Objective workflows may not contain an executable Worker DAG. Start a later implementation workflow to compile executable Tasks.",
              }),
            }
          }
          if (stepId === "plan" && plannedTasks.length === 0) {
            if (!planningOnly) {
              return { content: renderToolOutput({ error: "Planning step cannot complete before a validated task graph exists." }) }
            }
            if (!workflow.work) {
              return { content: renderToolOutput({ error: "Planning-only Objective cannot complete before a persistent holistic Plan exists." }) }
            }
            const work = await readWork(ctx, workflow.work.objectiveId)
            const plan = work
              ? workPlanContext(work, undefined, "focused", workflow.work.generation)
              : null
            if (!plan) {
              return { content: renderToolOutput({ error: "Planning-only Objective cannot complete before a persistent holistic Plan exists." }) }
            }
            if (plan.invalidated) {
              return { content: renderToolOutput({ error: "Planning-only Objective cannot complete from an invalidated Plan. Create a fresh Plan generation first." }) }
            }
          }
          if ((stepId === "plan" || stepId === "review-plan") && workflow.work && plannedTasks.length > 0) {
            const work = await readWork(ctx, workflow.work.objectiveId)
            const taskIds = plannedTasks.map((taskStep) => taskStep.task!.id)
            const currentFingerprint = work
              ? workflowTaskSemanticFingerprint(work, taskIds, workflow.work.generation)
              : undefined
            if (
              currentFingerprint &&
              workflow.work.taskPlanFingerprint !== currentFingerprint
            ) {
              return {
                content: renderToolOutput({
                  error:
                    "Executable Task DAG is stale against the current semantic Task/Wave contract. Re-run loom_task_plan before completing planning or Plan review.",
                }),
              }
            }
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
            if (
              stepId !== "review-plan" &&
              tool.agent !== "general" &&
              loomAgents.has(String(tool.agent)) &&
              !(await exactStepAttemptBinding(ctx, tool.sessionID, workflowId, stepId))
            ) {
              throw new Error(
                "Step completion requires a fresh attachment to the current step attempt.",
              )
            }
            await validateWorkflowMutationLocked(ctx, runtime, workflow)

            const currentStep = workflow.steps.find(
              (candidate) => candidate.id === stepId,
            )
            const reviewerAcceptanceVerdict =
              tool.agent === "reviewer" &&
              (resolvedOutcome === "pass" || resolvedOutcome === "fail") &&
              Boolean(
                currentStep &&
                reviewerOwnsAcceptanceBookkeeping(currentStep),
              )
            if (resolvedOutcome === "complete" || reviewerAcceptanceVerdict) {
              let ownedWriteScope: string[]
              if (tool.agent === "general") {
                ownedWriteScope = generalGitWriteScope
              } else {
                const declaredScope = (await ctx.storage.get(
                  scopeKey(workflowId, stepId),
                )) as TaskScope | undefined
                ownedWriteScope = declaredScope?.write.length
                  ? declaredScope.write
                  : (artifactWriteDefaults[tool.agent] ?? [])
              }
              ownedWriteScope = committableWriteScope(ownedWriteScope)
              if (ownedWriteScope.length) {
                const repositoryError = await uncommittedOwnedChangesError(
                  ctx,
                  tool.sessionID,
                  ctx.location.directory,
                  ownedWriteScope,
                )
                if (repositoryError) throw new Error(repositoryError)
              }
            }

            const currentQuestions = await readQuestions(ctx, workflowId)
            const currentBlocking = blockingQuestionsForStep(currentQuestions, stepId)
            if (currentBlocking.length > 0) {
              throw new Error("Step has unresolved blocking questions.")
            }

            if (tool.agent === "diagnostic" && resolvedOutcome === "complete") {
              const cleanup = await cleanupDiagnosticSandboxesForWorkflow(workflowId)
              if (cleanup.errors.length > 0) {
                throw new Error(
                  "Diagnostic completion requires every active experiment sandbox for this workflow to be destroyed. Cleanup failed for: " +
                  cleanup.errors.map((entry) => entry.sandboxId).join(", "),
                )
              }
            }

            const reviewedWave = workflow.steps.some((candidate) => candidate.id === "review-implementation" && candidate.status === "passed")
            let acceptedPlanReview: PlanReviewBinding | undefined

            if (stepId === "review-plan") {
              if (!workflow.work) throw new Error("Plan review requires a persistent Objective Plan.")
              const binding = (await ctx.storage.get(sessionPlanReviewKey(tool.sessionID))) as PlanReviewBinding | undefined
              const currentWork = await readWork(ctx, workflow.work.objectiveId)
              const currentPlan = currentWork
                ? workPlanContext(currentWork, undefined, "focused", workflow.work.generation)
                : null
              if (currentPlan?.invalidated) {
                throw new Error("Plan review cannot PASS or FAIL an invalidated Plan. Create a fresh Plan generation first.")
              }
              const planFingerprint = currentWork
                ? workPlanSemanticFingerprint(currentWork, workflow.work.generation)
                : undefined
              const executableFingerprint = executableTaskPlanFingerprint(workflow)
              const currentReviewStep = workflow.steps.find((candidate) => candidate.id === "review-plan")
              const executableRequired = !planningOnlyObjective(workflow.effects)
              if (
                !binding ||
                binding.workflowId !== workflow.id ||
                binding.generation !== workflow.work.generation ||
                binding.revision !== currentPlan?.revision ||
                !planFingerprint ||
                binding.planFingerprint !== planFingerprint ||
                binding.attempt !== (currentReviewStep?.attempt ?? 0) ||
                (executableRequired &&
                  (!executableFingerprint || binding.executableFingerprint !== executableFingerprint)) ||
                (!executableRequired &&
                  (executableFingerprint !== undefined || binding.executableFingerprint !== undefined))
              ) {
                throw new Error(
                  "Plan review attempt, Plan, or executable Task DAG changed after Reviewer attachment. Attach a fresh review-plan attempt before recording a verdict.",
                )
              }
              acceptedPlanReview = binding
              if (resolvedOutcome === "pass") {
                const snapshot = currentWork?.plans?.find((candidate) => candidate.generation === workflow.work!.generation)
                if (!snapshot) throw new Error("Plan role feasibility cannot be checked without the current semantic Plan.")
                validatePlanRoleFeasibility(snapshot)
              }
            }

            finishStep(workflow, stepId, tool.agent, resolvedOutcome, summary)
            if (
              stepId === "review-plan" &&
              resolvedOutcome === "pass" &&
              workflow.work &&
              acceptedPlanReview
            ) {
              workflow.work.reviewedPlanRevision = acceptedPlanReview.revision
              workflow.work.reviewedPlanFingerprint = acceptedPlanReview.planFingerprint
            }
            evidenceBound = await bindSessionEvidence(ctx, tool.sessionID, workflowId, stepId)
            const completedTaskClaims =
              step.task && (step.status === "complete" || step.status === "passed")
                ? await stepClaims(ctx, workflowId, stepId)
                : []

            if (workflow.work) {
              const work = await readWork(ctx, workflow.work.objectiveId)
              if (!work) throw new Error("Persistent work hierarchy not found.")

              const taskSteps = plannedTaskSteps(workflow)
              const currentPlan = workPlanContext(
                work,
                undefined,
                "focused",
                workflow.work.generation,
              )
              const preplanningCriticAdjudication =
                stepId === "critic-solution" &&
                taskSteps.length === 0 &&
                work.generation === workflow.work.generation &&
                currentPlan?.invalidated
              // A fresh workflow's Critic must be able to adjudicate before its
              // Planner replaces a carried invalidated Plan. This exception is
              // deliberately limited to the preplanning gate: all planning,
              // review, compilation, and execution paths retain generation checks.
              if (!preplanningCriticAdjudication) {
                assertWorkGeneration(work, workflow.work.generation)
              }
              const taskIds = taskSteps.map((taskStep) => taskStep.task!.id)
              const now = new Date().toISOString()
              const hasPlanReview = workflow.steps.some((candidate) => candidate.id === "review-plan")
              const preExecutionPlanStep =
                hasPlanReview && (stepId === "plan" || stepId === "review-plan")

              if (
                stepId === "review-plan" &&
                resolvedOutcome === "pass" &&
                taskIds.length > 0
              ) {
                // The executable DAG exists before review so Reviewer can inspect
                // exact write/verification scopes, but execution authority begins
                // only after independent Plan review passes.
                claimWorkflowWave(
                  work,
                  workflow.id,
                  workflow.work.generation,
                  taskSteps.map((taskStep) => taskStep.task!),
                  (workflow.effects?.workLevel ?? "objective") === "objective",
                  now,
                )
              }

              if (taskIds.length > 0 && reviewedWave) {
                // Wave review ended the execution lease. Later gates/documentation
                // consume its receipt; they must not re-sync or reclaim Tasks.
                await ensureCompletedWaveHistory(ctx.storage as any, work, workflow)
              } else if (taskIds.length > 0 && !preExecutionPlanStep) {
                assertWaveClaimForTasks(work, workflow.id, workflow.work.generation, taskIds)
                syncWorkTaskStatuses(
                  work, workflow.id, workflow.work.generation,
                  taskSteps.map((taskStep) => ({
                    taskId: taskStep.task!.id,
                    complete: plannedTaskSatisfied(workflow, taskStep),
                    ...(taskStep.id === stepId && (taskStep.status === "complete" || taskStep.status === "passed")
                      ? {
                          result: {
                            workflowId,
                            ...(taskStep.summary ? { summary: taskStep.summary } : {}),
                            evidenceClaimIds: completedTaskClaims.map((claim) => claim.id),
                            completedAt: now,
                          },
                        }
                      : {}),
                  })),
                  now,
                )
              }

              if (
                stepId === "review-implementation" &&
                resolvedOutcome === "pass" &&
                taskIds.length > 0
              ) {
                const bindingFingerprint = executableTaskPlanFingerprint(workflow)
                if (!bindingFingerprint) throw new Error("Reviewed Wave receipt requires its admitted Task role/slot graph fingerprint.")
                completeWaveForTasks(
                  work,
                  workflow.id,
                  workflow.work.generation,
                  taskIds,
                  now,
                  bindingFingerprint,
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
            await withRuntimeLocks(
              runtime,
              [
                stepAuthorityResource(workflow.id, stepId),
                { aggregate: "workflow", resourceIdentity: workflow.id },
                ...(workflow.work
                  ? [{ aggregate: "work", resourceIdentity: workflow.work.objectiveId }]
                  : []),
              ],
              commitCompletion,
            )
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

      addLoomTool({
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
            let hadPlanReviewClaim = false
            let hadTaskExecution = false
            let invalidatedPlanRecovery = false
            const commitReopen = async () => {
              await validateWorkflowMutationLocked(ctx, runtime, workflow)

              let work: WorkHierarchy | undefined
              if (workflow.work) {
                work = await readWork(ctx, workflow.work.objectiveId)
                if (!work) throw new Error("Persistent work hierarchy not found.")
                const currentPlan = workPlanContext(work, undefined, "focused", workflow.work.generation)
                if (currentPlan?.invalidated) {
                  invalidatedPlanRecovery = true
                  if (stepId !== "plan") {
                    throw new Error("Only planning can reopen an invalidated Plan generation.")
                  }
                  assertInvalidatedPlanReopenable(work, workflow.work.generation)
                  if (plannedTaskSteps(workflow).some((taskStep) => taskStep.status !== "pending")) {
                    throw new Error("Invalidated Plan cannot be reopened after Task execution has started.")
                  }
                } else {
                  assertWorkGeneration(work, workflow.work.generation)
                }
                const currentTaskSteps = plannedTaskSteps(workflow)
                const taskIds = currentTaskSteps.map((taskStep) => taskStep.task!.id)
                hadTaskExecution = currentTaskSteps.some((taskStep) => taskStep.status === "complete")
                if (taskIds.length > 0) {
                  const reviewed = workflow.steps.some((candidate) => candidate.id === "review-implementation" && candidate.status === "passed")
                  const hasPlanReview = workflow.steps.some((candidate) => candidate.id === "review-plan")
                  const planReviewed =
                    !hasPlanReview ||
                    workflow.steps.some((candidate) => candidate.id === "review-plan" && candidate.status === "passed")
                  if (reviewed) await ensureCompletedWaveHistory(ctx.storage as any, work, workflow)
                  else if (planReviewed && !invalidatedPlanRecovery) {
                    assertWaveClaimForTasks(work, workflow.id, workflow.work.generation, taskIds)
                    hadPlanReviewClaim = hasPlanReview
                  }
                }
              }

              reset = reopenFrom(workflow, stepId)
              resetVerificationAfterReopen(workflow, reset)
              if (workflow.work && reset.includes("review-plan")) {
                delete workflow.work.reviewedPlanRevision
                delete workflow.work.reviewedPlanFingerprint
              }

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
                const taskSteps = plannedTaskSteps(workflow)
                const taskIds = taskSteps.map((taskStep) => taskStep.task!.id)
                const expectedBindingFingerprint = taskSteps.every((taskStep) => taskStep.task?.role && taskStep.task.responsibility)
                  ? executableTaskPlanFingerprint(workflow)
                  : undefined
                const hasPlanReview = workflow.steps.some((candidate) => candidate.id === "review-plan")
                const planReviewedAfterReset =
                  !hasPlanReview ||
                  workflow.steps.some((candidate) => candidate.id === "review-plan" && candidate.status === "passed")

                // Reopening planning after a passed Plan review but before Worker
                // execution releases the mechanically acquired Wave claim so
                // Planner can safely amend/recompile the unconsumed contract.
                if (
                  hadPlanReviewClaim &&
                  reset.includes("review-plan") &&
                  taskIds.length > 0 &&
                  !hadTaskExecution
                ) {
                  releaseWorkflowWave(work, workflow.id, workflow.work.generation, taskIds, now)
                } else if (
                  !invalidatedPlanRecovery &&
                  reset.includes("review-implementation") &&
                  taskIds.length > 0
                ) {
                  reopenWaveForTasks(work, workflow.id, workflow.work.generation, taskIds, now, expectedBindingFingerprint)
                }

                // Documentation-only reopening does not resurrect the Wave lease.
                // Before Plan review passes there is intentionally no Wave claim
                // and therefore no runtime Task status to synchronize.
                if (
                  taskIds.length > 0 &&
                  !invalidatedPlanRecovery &&
                  planReviewedAfterReset &&
                  !workflow.steps.some((candidate) => candidate.id === "review-implementation" && candidate.status === "passed")
                ) {
                  syncWorkTaskStatuses(
                    work, workflow.id, workflow.work.generation,
                    taskSteps.map((taskStep) => ({ taskId: taskStep.task!.id, complete: plannedTaskSatisfied(workflow, taskStep) })),
                    now,
                  )
                }
                await ctx.storage.set(workKey(work.objectiveId), work)
              }

              await persistWorkflowMutationLocked(ctx, runtime, workflow)
            }

            await withRuntimeLocks(
              runtime,
              [
                ...workflowStepAuthorityResources(workflow),
                { aggregate: "workflow", resourceIdentity: workflow.id },
                ...(workflow.work
                  ? [{ aggregate: "work", resourceIdentity: workflow.work.objectiveId }]
                  : []),
              ],
              commitReopen,
            )

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

      addLoomTool({
        name: "oq_raise",
        description:
          "Raise a shared peer OQ to any Loom role or the user. For a user-owned Plan Task wait, General raises a blocking OQ with its exact taskId and sole Task consumerStepId; only the actual user answer recorded with source=user resolves that wait. Other planned Task questions inherit their exact Task context. Ask the role that owns or can best answer the specific question; an OQ answer does not substitute for an independent gate.",
        input: {
          type: "object",
          properties: {
            workflowId: { type: "string" },
            stepId: { type: "string" },
            parentQuestionId: { type: "string" },
            taskId: { type: "string" },
            question: { type: "string" },
            responder: {
              type: "string",
              enum: [
                "user",
                "general",
                "brainstorm",
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
              ],
            },
            blocking: { type: "boolean" },
            consumerStepIds: { type: "array", items: { type: "string" } },
            evidence: { type: "array", items: { type: "string" } },
          },
          required: ["workflowId", "question", "responder", "blocking"],
          additionalProperties: false,
        },
        options: { namespace: "loom", codemode: false },
        execute: async (input, tool) => {
          const value = input as {
            workflowId: string
            stepId?: string
            parentQuestionId?: string
            taskId?: string
            question: string
            responder: OQAuthority
            blocking: boolean
            consumerStepIds?: string[]
            evidence?: string[]
          }
          const workflow = await readBoundWorkflow(ctx, tool.sessionID, value.workflowId, ensureLegacySession)
          if (!workflow) return { content: renderToolOutput({ error: "Workflow not found or current session is not bound to it." }) }

          let raisedByStepId: string
          let parentQuestion: OpenQuestion | undefined
          if (tool.agent === "general") {
            raisedByStepId = "general"
          } else if (value.stepId && await exactStepBinding(ctx, tool.sessionID, value.workflowId, value.stepId)) {
            raisedByStepId = value.stepId
          } else if (
            value.parentQuestionId &&
            await exactOqBinding(ctx, tool.sessionID, value.workflowId, value.parentQuestionId)
          ) {
            parentQuestion = (await ctx.storage.get(
              oqKey(value.workflowId, value.parentQuestionId),
            )) as OpenQuestion | undefined
            if (!parentQuestion || parentQuestion.requiredAuthority !== tool.agent) {
              return {
                content: renderToolOutput({
                  error: "Nested OQ raise requires the exact parent OQ attachment for this responder.",
                }),
              }
            }
            raisedByStepId = parentQuestion.raisedByStepId
          } else {
            return {
              content: renderToolOutput({
                error:
                  "Child-agent OQ raises require either the exact attached workflow step or exact parent OQ attachment.",
              }),
            }
          }

          try {
            const question = await withRuntimeLock(runtime, "workflow", value.workflowId, async () => {
              const current = await readWorkflow(ctx, value.workflowId)
              if (!current) throw new Error("Workflow not found.")
              const inferredTaskId = value.stepId
                ? current.steps.find((step) => step.id === value.stepId)?.task?.id
                : parentQuestion?.work?.taskId
              const requestedTaskId = value.taskId?.trim()
              if (inferredTaskId && requestedTaskId && inferredTaskId !== requestedTaskId) {
                throw new Error(`OQ taskId ${requestedTaskId} does not match the attached Task ${inferredTaskId}.`)
              }
              const correlatedTaskId = inferredTaskId ?? requestedTaskId
              let decisionStepAttempt: number | undefined
              if (value.responder === "user" && requestedTaskId) {
                const decisionStep = current.steps.find((candidate) => candidate.task?.id === requestedTaskId)
                if (decisionStep?.task?.responsibility === "obtain-user-decision") {
                  if (decisionStep.kind !== "wait" || decisionStep.agent !== "user" || decisionStep.status !== "waiting") {
                    throw new Error(`User decision Task ${requestedTaskId} is not an unresolved user-owned wait.`)
                  }
                  if (!value.blocking || JSON.stringify([...(value.consumerStepIds ?? [])].sort()) !== JSON.stringify([decisionStep.id])) {
                    throw new Error("User decision OQ must be blocking and name only its exact Task wait as consumer.")
                  }
                  if (!decisionStep.dependsOn.every((dependency) => {
                    const upstream = current.steps.find((candidate) => candidate.id === dependency)
                    return upstream && satisfied(upstream)
                  })) {
                    throw new Error(`User decision Task ${requestedTaskId} is waiting for its planned dependencies.`)
                  }
                  if (decisionStep.agent !== "user" || decisionStep.task.role !== "user") {
                    throw new Error("User-owned decision Task is not bound to the non-agent user wait slot.")
                  }
                  decisionStepAttempt = decisionStep.attempt ?? 0
                }
              }
              const userDecisionConsumers = (value.consumerStepIds ?? []).filter((stepId) => {
                const consumer = current.steps.find((step) => step.id === stepId)
                return consumer?.kind === "wait" && consumer.task?.responsibility === "obtain-user-decision"
              })
              if (userDecisionConsumers.length > 0 &&
                  (!requestedTaskId || decisionStepAttempt === undefined || userDecisionConsumers.length !== 1 ||
                    userDecisionConsumers[0] !== `task:${requestedTaskId}`)) {
                throw new Error("A user-decision Task consumer must be raised with its exact taskId and wait attempt.")
              }
              if (requestedTaskId && !current.work) {
                throw new Error("OQ taskId requires a persistent Objective Plan.")
              }
              let correlatedPlanRevision = parentQuestion?.work?.revision
              const correlatedWorkBinding = parentQuestion?.work ?? current.work
              if (correlatedWorkBinding) {
                const work = await readWork(ctx, correlatedWorkBinding.objectiveId)
                const context = work
                  ? workPlanContext(
                      work,
                      correlatedTaskId,
                      "focused",
                      correlatedWorkBinding.generation,
                      correlatedPlanRevision,
                    )
                  : null
                const decisionTaskContract = context?.focus?.task
                if (decisionStepAttempt !== undefined &&
                    (!decisionTaskContract || decisionTaskContract.role !== "user" || decisionTaskContract.responsibility !== "obtain-user-decision")) {
                  throw new Error("User-decision OQ does not match the current semantic Plan Task owner/responsibility.")
                }
                if (correlatedTaskId && !context?.focus?.task) {
                  const legacyTask = work?.nodes.find(
                    (node) =>
                      node.generation === correlatedWorkBinding.generation &&
                      node.type === "task" &&
                      node.logicalId === correlatedTaskId,
                  )
                  if (!legacyTask || correlatedPlanRevision !== undefined) {
                    throw new Error(`OQ taskId ${correlatedTaskId} is not part of the correlated Plan revision.`)
                  }
                }
                if (correlatedPlanRevision === undefined && context) {
                  correlatedPlanRevision = context.revision
                }
              }

              const created = raiseQuestion({
                id: crypto.randomUUID(),
                workflow: current,
                question: value.question,
                raisedByAgent: tool.agent,
                raisedByStepId,
                ...(parentQuestion ? { parentQuestionId: parentQuestion.id } : {}),
                requiredAuthority: value.responder,
                blocking: value.blocking,
                consumerStepIds:
                  value.consumerStepIds ??
                  (parentQuestion ? [...parentQuestion.consumerStepIds] : undefined),
                evidence: value.evidence,
                ...((parentQuestion?.work ?? current.work)
                  ? {
                      work: {
                        objectiveId: (parentQuestion?.work ?? current.work)!.objectiveId,
                        generation: (parentQuestion?.work ?? current.work)!.generation,
                        ...(correlatedPlanRevision !== undefined ? { revision: correlatedPlanRevision } : {}),
                        ...(correlatedTaskId ? { taskId: correlatedTaskId } : {}),
                        ...(decisionStepAttempt !== undefined ? { stepAttempt: decisionStepAttempt } : {}),
                      },
                    }
                  : {}),
                now: new Date().toISOString(),
              })
              await appendQuestion(ctx, created)
              await bumpWorkflowRevisionLocked(ctx, runtime, value.workflowId)
              return created
            })
            if (tool.agent !== "general" && value.stepId) {
              await bindSessionEvidence(ctx, tool.sessionID, value.workflowId, value.stepId)
            }
            return {
              content: renderToolOutput({
                question: questionView(question),
                routeTo: question.requiredAuthority,
              }),
            }
          } catch (error) {
            return { content: renderToolOutput({ error: error instanceof Error ? error.message : String(error) }) }
          }
        },
      })

      addLoomTool({
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
              questions: relevantQuestions(questions, workflow, tool.agent, stepId).map(questionView),
            }),
          }
        },
      })

      addLoomTool({
        name: "oq_answer",
        description:
          "Answer a shared question as its named responder role. Any Loom role may be an OQ responder. Reviewer/Critic OQ answers are not gate verdicts. User-owned answers are recorded by General with source=user. Answering also attempts runtime continuation of each still-current consumer. `notifications.notified` means that consumer has a Loom continuation signal scheduled; `notifications.failed` records delivery errors. A still-current affected consumer omitted from both arrays tells the answer caller that no signal was scheduled for it. General must not issue a parallel continuation merely because an answer succeeded, and missing notification output after another responder or a coordinator restart is not proof of failure. Recover only after re-checking current state and positive evidence that no signal was scheduled, host/session evidence confirms a reported delivery error did not deliver, or a notified child turn ended/failed unreconciled; an ambiguous delivery error is not automatic retry authority. A child responder returning to General should include the `notifications` outcome in its handoff when available so partial delivery can be recovered without guesswork.",
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

          if (
            value.source === "agent" &&
            tool.agent !== "general" &&
            !(await exactOqBinding(ctx, tool.sessionID, value.workflowId, value.questionId))
          ) {
            return { content: renderToolOutput({ error: "Child-agent OQ answers require the exact OQ dispatch-grant attachment." }) }
          }

          try {
            const recordAnswer = async () => {
              const currentWorkflow = await readWorkflow(ctx, value.workflowId)
              const currentQuestion = (await ctx.storage.get(oqKey(value.workflowId, value.questionId))) as OpenQuestion | undefined
              if (!currentWorkflow || !currentQuestion) throw new Error("Workflow or question not found.")
              const now = new Date().toISOString()
              const taskId = currentQuestion.work?.taskId
              let decisionStep: Workflow["steps"][number] | undefined
              let work: WorkHierarchy | undefined
              if (currentQuestion.work?.stepAttempt !== undefined) {
                if (value.source !== "user" || tool.agent !== "general" || currentQuestion.requiredAuthority !== "user") {
                  throw new Error("A user-decision Task can only resolve from its exact recorded user-owned OQ answer.")
                }
                if (!taskId || !currentWorkflow.work || currentWorkflow.work.objectiveId !== currentQuestion.work.objectiveId ||
                    currentWorkflow.work.generation !== currentQuestion.work.generation) {
                  throw new Error("User-decision OQ belongs to a stale or different Objective generation.")
                }
                const stepId = taskStepId(taskId)
                decisionStep = currentWorkflow.steps.find((candidate) => candidate.id === stepId)
                if (!decisionStep || decisionStep.kind !== "wait" || decisionStep.agent !== "user" ||
                    decisionStep.status !== "waiting" || decisionStep.attempt !== currentQuestion.work.stepAttempt ||
                    decisionStep.task?.id !== taskId || decisionStep.task.role !== "user" ||
                    decisionStep.task.responsibility !== "obtain-user-decision" ||
                    !currentQuestion.blocking || JSON.stringify(currentQuestion.consumerStepIds) !== JSON.stringify([stepId])) {
                  throw new Error("User-decision OQ is not bound to the exact current wait Task attempt.")
                }
                if (!decisionStep.dependsOn.every((dependency) => {
                  const upstream = currentWorkflow.steps.find((candidate) => candidate.id === dependency)
                  return upstream && satisfied(upstream)
                })) {
                  throw new Error("User-decision Task dependencies are no longer satisfied.")
                }
                work = await readWork(ctx, currentWorkflow.work.objectiveId)
                const plan = work
                  ? workPlanContext(work, undefined, "focused", currentWorkflow.work.generation)
                  : null
                const taskContext = work
                  ? workPlanContext(work, taskId, "focused", currentWorkflow.work.generation)
                  : null
                if (!work || !plan || !taskContext?.focus?.task || plan.revision !== currentQuestion.work.revision ||
                    taskContext.focus.task.role !== "user" || taskContext.focus.task.responsibility !== "obtain-user-decision") {
                  throw new Error("User-decision OQ Plan revision is stale; reopen planning and issue a fresh decision wait.")
                }
                assertWorkGeneration(work, currentWorkflow.work.generation)
                assertWaveClaimForTasks(
                  work,
                  currentWorkflow.id,
                  currentWorkflow.work.generation,
                  plannedTaskSteps(currentWorkflow).map((candidate) => candidate.task!.id),
                )
              }

              answerQuestion(
                currentQuestion,
                tool.agent,
                value.source,
                value.answer,
                value.evidence ?? [],
                now,
              )
              if (decisionStep && work && taskId) {
                decisionStep.status = "complete"
                decisionStep.summary = value.answer
                reconcileUserDecisionQuestion(currentQuestion, decisionStep.id, now)
                syncWorkTaskStatuses(
                  work,
                  currentWorkflow.id,
                  currentWorkflow.work!.generation,
                  [{
                    taskId,
                    complete: true,
                    result: {
                      workflowId: currentWorkflow.id,
                      summary: value.answer,
                      evidenceClaimIds: [],
                      completedAt: now,
                    },
                  }],
                  now,
                )
                await ctx.storage.set(workKey(work.objectiveId), work)
                await saveQuestion(ctx, currentQuestion)
                await persistWorkflowMutationLocked(ctx, runtime, currentWorkflow)
              } else {
                await saveQuestion(ctx, currentQuestion)
                await bumpWorkflowRevisionLocked(ctx, runtime, value.workflowId)
              }
              return currentQuestion
            }
            const question = workflow.work
              ? await withWorkflowWorkLocks(runtime, value.workflowId, workflow.work.objectiveId, recordAnswer)
              : await withRuntimeLock(runtime, "workflow", value.workflowId, recordAnswer)
            const notifications = await notifyAnsweredQuestionConsumers(
              ctx,
              runtime,
              question,
            )
            return {
              content: renderToolOutput({
                question: questionView(question),
                notifications,
              }),
            }
          } catch (error) {
            return { content: renderToolOutput({ error: error instanceof Error ? error.message : String(error) }) }
          }
        },
      })

      addLoomTool({
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
            return { content: renderToolOutput({ question: questionView(question) }) }
          } catch (error) {
            return { content: renderToolOutput({ error: error instanceof Error ? error.message : String(error) }) }
          }
        },
      })

      addLoomTool({
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
              const currentWorkflow = await readWorkflow(ctx, value.workflowId)
              const current = (await ctx.storage.get(oqKey(value.workflowId, value.questionId))) as OpenQuestion | undefined
              if (!current || !currentWorkflow) throw new Error("Workflow or question not found.")
              if (current.work?.stepAttempt !== undefined) {
                if (current.requiredAuthority !== "user" || !current.work.taskId || !currentWorkflow.work ||
                    currentWorkflow.work.objectiveId !== current.work.objectiveId ||
                    currentWorkflow.work.generation !== current.work.generation) {
                  throw new Error("User-decision OQ is not bound to the current Objective generation.")
                }
                const decisionStep = currentWorkflow.steps.find((candidate) => candidate.id === taskStepId(current.work!.taskId!))
                if (!decisionStep || decisionStep.kind !== "wait" || decisionStep.agent !== "user" ||
                    decisionStep.task?.responsibility !== "obtain-user-decision") {
                  throw new Error("The exact user-decision wait Task no longer exists.")
                }
                if (decisionStep.status === "complete") {
                  throw new Error("Reopen the exact decision Task first so downstream work and satisfaction are invalidated.")
                }
                if (decisionStep.status !== "waiting" || value.preserveAnswer) {
                  throw new Error("A reopened user-decision Task requires a waiting attempt and must discard its prior answer.")
                }
                const work = await readWork(ctx, currentWorkflow.work.objectiveId)
                const plan = work ? workPlanContext(work, undefined, "focused", currentWorkflow.work.generation) : null
                if (!plan || plan.revision !== current.work.revision) {
                  throw new Error("User-decision OQ Plan revision is stale; create a fresh Plan decision question.")
                }
                current.work.stepAttempt = decisionStep.attempt ?? 0
              }
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
            return { content: renderToolOutput({ question: questionView(question) }) }
          } catch (error) {
            return { content: renderToolOutput({ error: error instanceof Error ? error.message : String(error) }) }
          }
        },
      })

      addLoomTool({
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
          const attachedStep = (await ctx.storage.get(sessionStepKey(tool.sessionID))) as string | undefined
          if (attachedWorkflow !== value.workflowId || !attachedStep) {
            return {
              content: renderToolOutput({
                error: "Verification proof requires a session attached to an exact workflow step.",
              }),
            }
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
          if (
            observations.some(
              (observation) =>
                !observationMatchesStep(observation, workflow, attachedStep),
            )
          ) {
            return {
              content: renderToolOutput({
                error:
                  "Verification proof may only use observations captured while this session was attached to the current workflow step.",
              }),
            }
          }
          if (!observationsSupportKind(requirement.kind, observations)) {
            return {
              content: renderToolOutput({
                error: `Observed evidence does not support verification kind ${requirement.kind}.`,
              }),
            }
          }

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

      addLoomTool({
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

      addLoomTool({
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
          if (
            observations.some(
              (observation) =>
                !observationMatchesStep(observation, workflow, value.stepId),
            )
          ) {
            return {
              content: renderToolOutput({
                error:
                  "Evidence claims may only use observations captured while this session was attached to the claimed workflow step.",
              }),
            }
          }

          try {
            const claim = createClaim({
              attempt: step.attempt ?? 0,
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
              const current = await readWorkflow(ctx, value.workflowId)
              if (!current || !(await exactStepBinding(ctx, tool.sessionID, value.workflowId, value.stepId)) ||
                  observations.some((observation) => !observationMatchesStep(observation, current, value.stepId))) {
                throw new Error("Evidence attachment/attempt changed before claim commit.")
              }
              assertWorkflowNotCancelled(current)
              for (const observation of observations) {
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

      addLoomTool({
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


      addLoomTool({
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
          if (observations.some((observation) => !observationMatchesStep(observation, workflow, "knowledge-sync"))) {
            return { content: renderToolOutput({ error: "Knowledge proof must be admitted to this workflow's current knowledge-sync attempt." }) }
          }

          try {
            const report = await withRuntimeLock(runtime, "workflow", value.workflowId, async () => {
              const currentWorkflow = await readWorkflow(ctx, value.workflowId)
              if (!currentWorkflow) throw new Error("Workflow not found.")
              if (currentWorkflow.projectId !== runtime.projectId) {
                throw new Error("Workflow belongs to another project.")
              }
              if (!(await exactStepBinding(ctx, tool.sessionID, value.workflowId, "knowledge-sync")) ||
                  observations.some((observation) => !observationMatchesStep(observation, currentWorkflow, "knowledge-sync"))) {
                throw new Error("Knowledge attachment/attempt changed before proof commit.")
              }
              assertWorkflowNotCancelled(currentWorkflow)
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

      addLoomTool({
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

      addLoomTool({
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

      addLoomTool({
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

      addLoomTool({
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
              const current = await readWorkflow(ctx, value.workflowId)
              if (!current || !(await exactStepBinding(ctx, tool.sessionID, value.workflowId, "product-acceptance"))) {
                throw new Error("Product Acceptance attachment changed before result commit.")
              }
              assertWorkflowNotCancelled(current)
              const attempt = current.steps.find((step) => step.id === "product-acceptance")?.attempt ?? 0
              if (value.outcome === "passed" && claims.some((claim) => (claim.attempt ?? 0) !== attempt)) {
                throw new Error("Product Acceptance claims must belong to the current step attempt.")
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

      addLoomTool({
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
          return {
            content: renderToolOutput({
              limits,
              state,
              effective: { maxTotalDispatches: effectiveTotalDispatchLimit(state, limits) },
            }),
          }
        },
      })


      addLoomTool({
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
                limit: effectiveTotalDispatchLimit(mutation.state, mutation.limits),
              },
            }),
          }
        },
      })


      addLoomTool({
        name: "budget_continue",
        description:
          "Immediately continue one exhausted exact target after explicit user approval. Interactive approval comes from the exact OpenCode budget question recorded for the current denial; message-driven/headless recovery may instead supply the exact latest user message as confirmation. Each approval is single-use and adds exactly one target-reserved dispatch. General only; preserves attempts, evidence, workflow identity, independent gates, and automatic grant history.",
        input: {
          type: "object",
          properties: {
            workflowId: { type: "string" },
            stepId: { type: "string" },
            questionId: { type: "string" },
            reason: { type: "string" },
            confirmation: {
              type: "string",
              description: "Optional exact latest user message authorizing one more bounded dispatch. Omit after an approved Loom budget question.",
            },
          },
          required: ["workflowId", "reason"],
          additionalProperties: false,
        },
        options: { namespace: "loom", codemode: false },
        execute: async (input, tool) => {
          if (tool.agent !== "general") {
            return {
              content: renderToolOutput({
                error: "Only general may record user-authorized Loom budget continuation.",
              }),
            }
          }

          const value = input as {
            workflowId: string
            stepId?: string
            questionId?: string
            reason: string
            confirmation?: string
          }

          type ContinuationAuthorization = {
            source: "user-message" | "question"
            id: string
            confirmation: string
            useKey: string
            lockAggregate: string
            lockIdentity: string
            userMessageId?: string
            questionCallId?: string
            denialId?: string
            record: Record<string, unknown>
          }

          let authorization: ContinuationAuthorization
          if (typeof value.confirmation === "string" && value.confirmation.trim()) {
            const observedUserMessage = (await ctx.storage.get(
              sessionUserMessageKey(tool.sessionID),
            )) as ObservedUserMessage | undefined
            if (!observedUserMessage) {
              return { content: renderToolOutput({ error: "No current observed user message is available to authorize budget continuation." }) }
            }
            if (value.confirmation.trim() !== observedUserMessage.text.trim()) {
              return {
                content: renderToolOutput({
                  error: "Budget continuation confirmation must match the latest observed user message exactly.",
                  authorizationUserMessageId: observedUserMessage.messageId,
                }),
              }
            }
            authorization = {
              source: "user-message",
              id: observedUserMessage.messageId,
              confirmation: observedUserMessage.text,
              useKey: continuationAuthorizationUseKey(tool.sessionID, observedUserMessage.messageId),
              lockAggregate: "budget-continuation-user-message",
              lockIdentity: `${tool.sessionID}:${observedUserMessage.messageId}`,
              userMessageId: observedUserMessage.messageId,
              record: { userMessageId: observedUserMessage.messageId, confirmation: observedUserMessage.text },
            }
          } else {
            const blockedKey = budgetContinuationTargetKey(
              tool.sessionID,
              value.workflowId,
              { stepId: value.stepId, questionId: value.questionId },
            )
            if (!blockedKey) {
              return {
                content: renderToolOutput({
                  error: "Budget continuation requires exactly one stepId or questionId.",
                }),
              }
            }
            const blocked = (await ctx.storage.get(blockedKey)) as BudgetBlockedTarget | undefined
            if (!blocked) {
              return { content: renderToolOutput({ error: "No current budget-blocked target is available." }) }
            }
            const decision = (await ctx.storage.get(
              sessionBudgetQuestionDecisionKey(tool.sessionID, blocked.denialId),
            )) as BudgetQuestionDecision | undefined
            if (!decision || decision.denialId !== blocked.denialId) {
              return {
                content: renderToolOutput({
                  error: "No user decision exists for the current budget denial. Ask the exact OpenCode budget question first.",
                  expectedQuestion: budgetContinuationQuestionInput(blocked),
                }),
              }
            }
            if (!decision.approved) {
              const error = decision.answer === BUDGET_CONTINUATION_STOP
                ? "The user chose Stop here; no additional dispatch capacity was authorized."
                : `Only "${BUDGET_CONTINUATION_ALLOW}" authorizes an additional dispatch; "${decision.answer}" did not.`
              return { content: renderToolOutput({ error }) }
            }
            const targetMatches = blocked.workflowId === value.workflowId && (blocked.stepId
              ? blocked.stepId === value.stepId && !value.questionId
              : blocked.questionId === value.questionId && !value.stepId)
            if (!targetMatches) {
              return {
                content: renderToolOutput({
                  error: "The approved budget question is reserved for a different exact target.",
                  approvedTarget: { workflowId: blocked.workflowId, stepId: blocked.stepId, questionId: blocked.questionId },
                }),
              }
            }
            authorization = {
              source: "question",
              id: `question-denial:${decision.denialId}`,
              confirmation: decision.answer,
              useKey: continuationQuestionAuthorizationUseKey(tool.sessionID, decision.denialId),
              lockAggregate: "budget-continuation-question",
              lockIdentity: `${tool.sessionID}:${decision.denialId}`,
              ...(decision.callID ? { questionCallId: decision.callID } : {}),
              denialId: decision.denialId,
              record: {
                ...(decision.callID ? { questionCallID: decision.callID } : {}),
                approvalRef: decision.approvalRef,
                answer: decision.answer,
                denialId: decision.denialId,
                blockedTargetKey: blockedKey,
              },
            }
          }

          if (!(await readBoundWorkflow(ctx, tool.sessionID, value.workflowId, ensureLegacySession))) {
            return { content: renderToolOutput({ error: "Workflow not found or current session is not bound to it." }) }
          }
          const mutation = await withRuntimeLocks(runtime, [
            { aggregate: "workflow", resourceIdentity: value.workflowId },
            {
              aggregate: authorization.lockAggregate,
              resourceIdentity: authorization.lockIdentity,
            },
          ], async () => {
            if (await ctx.storage.get(authorization.useKey)) {
              const state = await readBudget(ctx, value.workflowId)
              return {
                state,
                result: {
                  allowed: false as const,
                  reason: `This ${authorization.source === "question" ? "question approval" : "observed user message"} has already authorized a Loom budget continuation.`,
                  state,
                },
              }
            }

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
            const result = continueWorkflowDispatchBudget({
              state,
              limits,
              workflow,
              questions,
              stepId: value.stepId,
              questionId: value.questionId,
              grantedBy: tool.agent,
              reason: value.reason,
              confirmation: authorization.confirmation,
              authorizationId: authorization.id,
              authorizationSource: authorization.source,
              ...(authorization.userMessageId
                ? { authorizationUserMessageId: authorization.userMessageId }
                : {}),
              ...(authorization.questionCallId
                ? { authorizationQuestionCallId: authorization.questionCallId }
                : {}),
              ...(authorization.denialId
                ? { authorizationDenialId: authorization.denialId }
                : {}),
              now: new Date().toISOString(),
            })

            if (result.allowed) {
              await ctx.storage.set(budgetKey(value.workflowId), state)
              const usedAt = new Date().toISOString()
              await ctx.storage.set(authorization.useKey, {
                workflowId: value.workflowId,
                target: result.target,
                authorizationSource: authorization.source,
                authorizationId: authorization.id,
                ...authorization.record,
                usedAt,
              })
              const blockedKey = budgetContinuationTargetKey(
                tool.sessionID,
                value.workflowId,
                { stepId: value.stepId, questionId: value.questionId },
              )
              if (blockedKey) {
                const currentBlocked = (await ctx.storage.get(blockedKey)) as BudgetBlockedTarget | undefined
                const sameQuestionDenial =
                  authorization.source !== "question" ||
                  currentBlocked?.denialId === authorization.denialId
                if (currentBlocked && !currentBlocked.resolvedAt && sameQuestionDenial) {
                  await ctx.storage.set(blockedKey, { ...currentBlocked, resolvedAt: usedAt })
                }
              }
              await bumpWorkflowRevisionLocked(ctx, runtime, value.workflowId)
            }
            return { state, result }
          })

          if (!mutation.result.allowed) {
            return {
              content: renderToolOutput({
                error: mutation.result.reason,
                target: {
                  stepId: value.stepId,
                  questionId: value.questionId,
                },
              }),
            }
          }

          return {
            content: renderToolOutput({
              continued: true,
              target: mutation.result.target,
              authorizationSource: authorization.source,
              used: mutation.state.byKey[mutation.result.target.key] ?? 0,
              requestedDispatches: mutation.result.continuation.requestedDispatches,
              stepDispatches: {
                previousLimit: mutation.result.previousStepLimit,
                newLimit: mutation.result.newStepLimit,
              },
              workflowDispatches: {
                used: mutation.state.totalDispatches,
                previousLimit: mutation.result.previousWorkflowLimit,
                newLimit: mutation.result.newWorkflowLimit,
              },
              continuation: mutation.result.continuation,
            }),
          }
        },
      })


      addLoomTool({
        name: "work_plan",
        description:
          "Create or replace the persistent holistic Plan for the accepted Objective, including accountable role and responsibility for every Task. Planner only. Replacing an existing generation requires its exact current version and a reason.",
        input: {
          type: "object",
          properties: {
            workflowId: { type: "string" },
            expectedVersion: { type: "number" },
            replaceReason: { type: "string" },
            goal: { type: "string" },
            assumptions: { type: "array", items: { type: "string" } },
            outOfScope: { type: "array", items: { type: "string" } },
            authorityRefs: { type: "array", items: { type: "string" } },
            obligations: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  id: { type: "string" },
                  sourceRef: { type: "string" },
                  statement: { type: "string" },
                  disposition: {
                    type: "string",
                    enum: ["implement", "already-satisfied", "authorized-defer", "out-of-scope", "blocked"],
                  },
                  taskIds: { type: "array", items: { type: "string" } },
                  verification: { type: "array", items: { type: "string" } },
                  dispositionAuthorityRef: { type: "string" },
                },
                required: ["id", "sourceRef", "statement", "disposition", "taskIds", "verification"],
                additionalProperties: false,
              },
            },
            riskBoundaries: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  id: { type: "string" },
                  title: { type: "string" },
                  description: { type: "string" },
                  taskIds: { type: "array", items: { type: "string" } },
                },
                required: ["id", "title", "description", "taskIds"],
                additionalProperties: false,
              },
            },
            acceptanceCoverage: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  id: { type: "string" },
                  title: { type: "string" },
                  criterion: { type: "string" },
                  taskIds: { type: "array", items: { type: "string" } },
                },
                required: ["id", "title", "criterion", "taskIds"],
                additionalProperties: false,
              },
            },
            relationships: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  summary: { type: "string" },
                  taskIds: { type: "array", items: { type: "string" } },
                },
                required: ["summary", "taskIds"],
                additionalProperties: false,
              },
            },
            correctionRouting: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  condition: { type: "string" },
                  routeTo: { type: "string" },
                  taskId: { type: "string" },
                },
                required: ["condition", "routeTo"],
                additionalProperties: false,
              },
            },
            phases: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  id: { type: "string" },
                  title: { type: "string" },
                  objective: { type: "string" },
                  waves: {
                    type: "array",
                    items: {
                      type: "object",
                      properties: {
                        id: { type: "string" },
                        title: { type: "string" },
                        objective: { type: "string" },
                        constraints: { type: "array", items: { type: "string" } },
                        tasks: {
                          type: "array",
                          items: {
                            type: "object",
                            properties: {
                              id: { type: "string" },
                              title: { type: "string" },
                              objective: { type: "string" },
                              rationale: { type: "string" },
                              dependsOn: { type: "array", items: { type: "string" } },
                              authorityRefs: { type: "array", items: { type: "string" } },
                              constraints: { type: "array", items: { type: "string" } },
                              acceptanceCriteria: { type: "array", items: { type: "string" } },
                              subtasks: { type: "array", items: { type: "string" } },
                              integration: { type: "array", items: { type: "string" } },
                              verify: { type: "array", items: { type: "string" } },
                              role: { type: "string" },
                              responsibility: { type: "string", enum: ["produce", "execute", "review", "obtain-user-decision"] },
                            },
                            required: [
                              "id",
                              "title",
                              "objective",
                              "rationale",
                              "dependsOn",
                              "authorityRefs",
                              "constraints",
                              "acceptanceCriteria",
                              "subtasks",
                              "integration",
                              "verify",
                              "role",
                              "responsibility",
                            ],
                            additionalProperties: false,
                          },
                        },
                      },
                      required: ["id", "title", "objective", "constraints", "tasks"],
                      additionalProperties: false,
                    },
                  },
                },
                required: ["id", "title", "objective", "waves"],
                additionalProperties: false,
              },
            },
          },
          required: [
            "workflowId",
            "goal",
            "assumptions",
            "outOfScope",
            "authorityRefs",
            "obligations",
            "riskBoundaries",
            "acceptanceCoverage",
            "relationships",
            "correctionRouting",
            "phases",
          ],
          additionalProperties: false,
        },
        options: { namespace: "loom", codemode: false },
        execute: async (input, tool) => {
          if (tool.agent !== "planner") {
            return { content: renderToolOutput({ error: "Only planner may define the persistent work plan." }) }
          }

          const value = input as WorkPlanDefinition & {
            workflowId: string
            expectedVersion?: number
            replaceReason?: string
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

              materializeWorkPlan(
                work,
                workflow.id,
                {
                  goal: value.goal,
                  assumptions: value.assumptions,
                  outOfScope: value.outOfScope,
                  authorityRefs: value.authorityRefs,
                  obligations: value.obligations,
                  riskBoundaries: value.riskBoundaries,
                  acceptanceCoverage: value.acceptanceCoverage,
                  relationships: value.relationships,
                  correctionRouting: value.correctionRouting,
                  phases: value.phases,
                },
                now,
              )
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
                plan: workPlanContext(result, undefined, "full"),
                nextRunnableWaves: nextRunnableWaves(result),
              }),
            }
          } catch (error) {
            return { content: renderToolOutput({ error: error instanceof Error ? error.message : String(error) }) }
          }
        },
      })

      addLoomTool({
        name: "work_amend",
        description:
          "Atomically amend a bounded part of the current Plan generation without replacing the whole Plan. Planner only. Pending/unclaimed Tasks may be edited/added/removed; completed semantic contracts cannot be rewritten. Supports local Phase/Wave/Task/subtask changes plus matching Plan metadata updates.",
        input: {
          type: "object",
          properties: {
            workflowId: { type: "string" },
            questionId: { type: "string" },
            expectedVersion: { type: "number" },
            reason: { type: "string" },
            planPatch: {
              type: "object",
              properties: {
                goal: { type: "string" },
                assumptions: { type: "array", items: { type: "string" } },
                outOfScope: { type: "array", items: { type: "string" } },
                authorityRefs: { type: "array", items: { type: "string" } },
                obligations: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      id: { type: "string" },
                      sourceRef: { type: "string" },
                      statement: { type: "string" },
                      disposition: {
                        type: "string",
                        enum: ["implement", "already-satisfied", "authorized-defer", "out-of-scope", "blocked"],
                      },
                      taskIds: { type: "array", items: { type: "string" } },
                      verification: { type: "array", items: { type: "string" } },
                      dispositionAuthorityRef: { type: "string" },
                    },
                    required: ["id", "sourceRef", "statement", "disposition", "taskIds", "verification"],
                    additionalProperties: false,
                  },
                },
                riskBoundaries: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      id: { type: "string" },
                      title: { type: "string" },
                      description: { type: "string" },
                      taskIds: { type: "array", items: { type: "string" } },
                    },
                    required: ["id", "title", "description", "taskIds"],
                    additionalProperties: false,
                  },
                },
                acceptanceCoverage: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      id: { type: "string" },
                      title: { type: "string" },
                      criterion: { type: "string" },
                      taskIds: { type: "array", items: { type: "string" } },
                    },
                    required: ["id", "title", "criterion", "taskIds"],
                    additionalProperties: false,
                  },
                },
                relationships: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      summary: { type: "string" },
                      taskIds: { type: "array", items: { type: "string" } },
                    },
                    required: ["summary", "taskIds"],
                    additionalProperties: false,
                  },
                },
                correctionRouting: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      condition: { type: "string" },
                      routeTo: { type: "string" },
                      taskId: { type: "string" },
                    },
                    required: ["condition", "routeTo"],
                    additionalProperties: false,
                  },
                },
              },
              additionalProperties: false,
            },
            operations: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  action: {
                    type: "string",
                    enum: [
                      "patch-phase",
                      "patch-wave",
                      "patch-task",
                      "add-phase",
                      "remove-phase",
                      "add-wave",
                      "remove-wave",
                      "add-task",
                      "remove-task",
                    ],
                  },
                  phaseId: { type: "string" },
                  waveId: { type: "string" },
                  taskId: { type: "string" },
                  patch: {
                    type: "object",
                    properties: {
                      title: { type: "string" },
                      objective: { type: "string" },
                      rationale: { type: "string" },
                      dependsOn: { type: "array", items: { type: "string" } },
                      authorityRefs: { type: "array", items: { type: "string" } },
                      constraints: { type: "array", items: { type: "string" } },
                      acceptanceCriteria: { type: "array", items: { type: "string" } },
                      subtasks: { type: "array", items: { type: "string" } },
                      integration: { type: "array", items: { type: "string" } },
                      verify: { type: "array", items: { type: "string" } },
                      role: { type: "string" },
                      responsibility: { type: "string", enum: ["produce", "execute", "review", "obtain-user-decision"] },
                    },
                    additionalProperties: false,
                  },
                  task: {
                    type: "object",
                    properties: {
                  id: { type: "string" },
                  title: { type: "string" },
                  objective: { type: "string" },
                  rationale: { type: "string" },
                  dependsOn: { type: "array", items: { type: "string" } },
                  authorityRefs: { type: "array", items: { type: "string" } },
                  constraints: { type: "array", items: { type: "string" } },
                  acceptanceCriteria: { type: "array", items: { type: "string" } },
                  subtasks: { type: "array", items: { type: "string" } },
                  integration: { type: "array", items: { type: "string" } },
                  verify: { type: "array", items: { type: "string" } },
                  role: { type: "string" },
                  responsibility: { type: "string", enum: ["produce", "execute", "review", "obtain-user-decision"] },
                },
                    required: [
                      "id", "title", "objective", "rationale", "dependsOn", "authorityRefs",
                      "constraints", "acceptanceCriteria", "subtasks", "integration",
                      "verify", "role", "responsibility",
                    ],
                    additionalProperties: false,
                  },
                  wave: {
                    type: "object",
                    properties: {
                      id: { type: "string" },
                      title: { type: "string" },
                      objective: { type: "string" },
                      constraints: { type: "array", items: { type: "string" } },
                      tasks: {
                        type: "array",
                        items: {
                          type: "object",
                          properties: {
                  id: { type: "string" },
                  title: { type: "string" },
                  objective: { type: "string" },
                  rationale: { type: "string" },
                  dependsOn: { type: "array", items: { type: "string" } },
                  authorityRefs: { type: "array", items: { type: "string" } },
                  constraints: { type: "array", items: { type: "string" } },
                  acceptanceCriteria: { type: "array", items: { type: "string" } },
                  subtasks: { type: "array", items: { type: "string" } },
                  integration: { type: "array", items: { type: "string" } },
                  verify: { type: "array", items: { type: "string" } },
                  role: { type: "string" },
                  responsibility: { type: "string", enum: ["produce", "execute", "review", "obtain-user-decision"] },
                },
                          required: [
                            "id", "title", "objective", "rationale", "dependsOn", "authorityRefs",
                            "constraints", "acceptanceCriteria", "subtasks", "integration",
                            "verify", "role", "responsibility",
                          ],
                          additionalProperties: false,
                        },
                      },
                    },
                    required: ["id", "title", "objective", "constraints", "tasks"],
                    additionalProperties: false,
                  },
                  phase: {
                    type: "object",
                    properties: {
                      id: { type: "string" },
                      title: { type: "string" },
                      objective: { type: "string" },
                      waves: {
                        type: "array",
                        items: {
                          type: "object",
                          properties: {
                            id: { type: "string" },
                            title: { type: "string" },
                            objective: { type: "string" },
                            constraints: { type: "array", items: { type: "string" } },
                            tasks: {
                              type: "array",
                              items: {
                                type: "object",
                                properties: {
                  id: { type: "string" },
                  title: { type: "string" },
                  objective: { type: "string" },
                  rationale: { type: "string" },
                  dependsOn: { type: "array", items: { type: "string" } },
                  authorityRefs: { type: "array", items: { type: "string" } },
                  constraints: { type: "array", items: { type: "string" } },
                  acceptanceCriteria: { type: "array", items: { type: "string" } },
                                  subtasks: { type: "array", items: { type: "string" } },
                                  integration: { type: "array", items: { type: "string" } },
                                  verify: { type: "array", items: { type: "string" } },
                                  role: { type: "string" },
                                  responsibility: { type: "string", enum: ["produce", "execute", "review", "obtain-user-decision"] },
                                },
                                required: [
                                  "id", "title", "objective", "rationale", "dependsOn", "authorityRefs",
                                  "constraints", "acceptanceCriteria", "subtasks", "integration",
                                  "verify", "role", "responsibility",
                                ],
                                additionalProperties: false,
                              },
                            },
                          },
                          required: ["id", "title", "objective", "constraints", "tasks"],
                          additionalProperties: false,
                        },
                      },
                    },
                    required: ["id", "title", "objective", "waves"],
                    additionalProperties: false,
                  },
                },
                required: ["action"],
                additionalProperties: false,
              },
            },
          },
          required: ["workflowId", "expectedVersion", "reason", "operations"],
          additionalProperties: false,
        },
        options: { namespace: "loom", codemode: false },
        execute: async (input, tool) => {
          if (tool.agent !== "planner") {
            return { content: renderToolOutput({ error: "Only planner may amend the persistent Plan." }) }
          }
          const value = input as {
            workflowId: string
            questionId?: string
            expectedVersion: number
            reason: string
            operations: WorkPlanAmendOperation[]
            planPatch?: WorkPlanTopLevelPatch
          }
          const workflow = await readBoundWorkflow(ctx, tool.sessionID, value.workflowId, ensureLegacySession)
          if (!workflow?.work) {
            return { content: renderToolOutput({ error: "Workflow has no persistent Plan to amend." }) }
          }
          const attachedPlanStep =
            (await exactStepBinding(ctx, tool.sessionID, workflow.id, "plan")) &&
            runnable(workflow).some((step) => step.id === "plan")
          let attachedPlannerOq = false
          let plannerQuestion: OpenQuestion | undefined
          if (value.questionId) {
            plannerQuestion = (await ctx.storage.get(
              oqKey(workflow.id, value.questionId),
            )) as OpenQuestion | undefined
            attachedPlannerOq =
              Boolean(plannerQuestion) &&
              plannerQuestion!.requiredAuthority === "planner" &&
              (await exactOqBinding(ctx, tool.sessionID, workflow.id, value.questionId))
          }
          if (!attachedPlanStep && !attachedPlannerOq) {
            return {
              content: renderToolOutput({
                error:
                  "Plan amendment requires either the runnable attached plan step or an exact Planner OQ attachment. Use a Planner OQ for bounded mid-plan repair; reopen plan for full replanning.",
              }),
            }
          }

          try {
            const result = await withWorkflowWorkLocks(
              runtime,
              workflow.id,
              workflow.work.objectiveId,
              async () => {
                await validateWorkflowMutationLocked(ctx, runtime, workflow)
                const work = await readWork(ctx, workflow.work!.objectiveId)
                if (!work) throw new Error("Persistent work hierarchy not found.")
                if (work.generation !== workflow.work!.generation) {
                  throw new Error("Workflow is bound to a stale Plan generation.")
                }
                if (plannerQuestion?.work) {
                  if (
                    plannerQuestion.work.objectiveId !== work.objectiveId ||
                    plannerQuestion.work.generation !== work.generation
                  ) {
                    throw new Error(
                      "Planner OQ belongs to an older Objective/Plan generation. Reconcile it and use a current planning boundary before mutation.",
                    )
                  }
                  const latestPlan = workPlanContext(work, undefined, "focused", work.generation)
                  if (plannerQuestion.work.revision === undefined) {
                    if (latestPlan) {
                      throw new Error(
                        "Legacy Planner OQ has no rich Plan revision and cannot mutate the adopted Plan. Use a fresh current Planner boundary.",
                      )
                    }
                  } else if (plannerQuestion.work.taskId) {
                    const historicalFingerprint = taskSemanticFingerprintAtRevision(
                      work,
                      plannerQuestion.work.taskId,
                      work.generation,
                      plannerQuestion.work.revision,
                    )
                    const currentFingerprint = taskSemanticFingerprintAtRevision(
                      work,
                      plannerQuestion.work.taskId,
                      work.generation,
                    )
                    if (
                      !historicalFingerprint ||
                      !currentFingerprint ||
                      historicalFingerprint !== currentFingerprint
                    ) {
                      throw new Error(
                        "Planner OQ Task semantics changed after the question was raised. Reconcile the historical OQ and raise a fresh Planner question before mutation.",
                      )
                    }
                  } else if (latestPlan?.revision !== plannerQuestion.work.revision) {
                    throw new Error(
                      "Planner OQ refers to an older Plan revision. Reconcile it and use a fresh current Planner boundary before Plan-wide mutation.",
                    )
                  }
                }
                const currentTaskIds = plannedTaskSteps(workflow).map((step) => step.task!.id)
                const priorFingerprint =
                  currentTaskIds.length > 0
                    ? workflowTaskSemanticFingerprint(
                        work,
                        currentTaskIds,
                        workflow.work!.generation,
                      )
                    : undefined
                const amended = amendWorkPlan(
                  work,
                  {
                    expectedVersion: value.expectedVersion,
                    reason: value.reason,
                    by: tool.agent,
                    operations: value.operations,
                    planPatch: value.planPatch,
                  },
                  new Date().toISOString(),
                )
                const currentFingerprint =
                  currentTaskIds.length > 0
                    ? workflowTaskSemanticFingerprint(
                        work,
                        currentTaskIds,
                        workflow.work!.generation,
                      )
                    : undefined
                const taskPlanRefreshRequired =
                  Boolean(priorFingerprint && currentFingerprint && priorFingerprint !== currentFingerprint)
                if (workflow.work && currentTaskIds.length > 0 && !taskPlanRefreshRequired) {
                  workflow.work.taskPlanRevision = amended.plan.revision
                  workflow.work.taskPlanFingerprint = currentFingerprint
                }
                await ctx.storage.set(workKey(work.objectiveId), work)
                await persistWorkflowMutationLocked(ctx, runtime, workflow)
                return { ...amended, taskPlanRefreshRequired }
              },
            )

            return {
              content: renderToolOutput({
                amended: true,
                objectiveId: result.hierarchy.objectiveId,
                version: result.hierarchy.version,
                generation: result.hierarchy.generation,
                revision: result.plan.revision,
                amendment: result.amendment,
                changedTaskIds: result.changedTaskIds,
                changedWaveKeys: result.changedWaveKeys,
                taskPlanRefreshRequired: result.taskPlanRefreshRequired,
                tree: workTree(result.hierarchy),
                plan: workPlanContext(result.hierarchy, undefined, "full"),
                nextRunnableWaves: nextRunnableWaves(result.hierarchy),
              }),
            }
          } catch (error) {
            return { content: renderToolOutput({ error: error instanceof Error ? error.message : String(error) }) }
          }
        },
      })

      addLoomTool({
        name: "work_invalidate",
        description:
          "Invalidate the current Plan generation so it cannot execute further. Planner only; callable from a reopened plan step or exact Planner OQ. Live claims must be released first. Existing history is preserved; General then reopens planning and loom_work_plan creates a fresh generation.",
        input: {
          type: "object",
          properties: {
            workflowId: { type: "string" },
            questionId: { type: "string" },
            expectedVersion: { type: "number" },
            reason: { type: "string" },
          },
          required: ["workflowId", "expectedVersion", "reason"],
          additionalProperties: false,
        },
        options: { namespace: "loom", codemode: false },
        execute: async (input, tool) => {
          if (tool.agent !== "planner") {
            return { content: renderToolOutput({ error: "Only planner may invalidate the persistent Plan." }) }
          }
          const value = input as { workflowId: string; questionId?: string; expectedVersion: number; reason: string }
          const workflow = await readBoundWorkflow(ctx, tool.sessionID, value.workflowId, ensureLegacySession)
          if (!workflow?.work) {
            return { content: renderToolOutput({ error: "Workflow has no persistent Plan to invalidate." }) }
          }
          const attachedPlanStep =
            (await exactStepBinding(ctx, tool.sessionID, workflow.id, "plan")) &&
            runnable(workflow).some((step) => step.id === "plan")
          let attachedPlannerOq = false
          let plannerQuestion: OpenQuestion | undefined
          if (value.questionId) {
            plannerQuestion = (await ctx.storage.get(
              oqKey(workflow.id, value.questionId),
            )) as OpenQuestion | undefined
            attachedPlannerOq =
              Boolean(plannerQuestion) &&
              plannerQuestion!.requiredAuthority === "planner" &&
              (await exactOqBinding(ctx, tool.sessionID, workflow.id, value.questionId))
          }
          if (!attachedPlanStep && !attachedPlannerOq) {
            return {
              content: renderToolOutput({
                error:
                  "Plan invalidation requires either the runnable attached plan step or an exact Planner OQ attachment. Release/cancel live claims before invalidating.",
              }),
            }
          }

          try {
            const result = await withWorkflowWorkLocks(
              runtime,
              workflow.id,
              workflow.work.objectiveId,
              async () => {
                await validateWorkflowMutationLocked(ctx, runtime, workflow)
                const work = await readWork(ctx, workflow.work!.objectiveId)
                if (!work) throw new Error("Persistent work hierarchy not found.")
                if (work.generation !== workflow.work!.generation) {
                  throw new Error("Workflow is bound to a stale Plan generation.")
                }
                if (plannerQuestion?.work) {
                  const latestPlan = workPlanContext(work, undefined, "focused", work.generation)
                  if (
                    plannerQuestion.work.objectiveId !== work.objectiveId ||
                    plannerQuestion.work.generation !== work.generation ||
                    plannerQuestion.work.revision === undefined ||
                    plannerQuestion.work.revision !== latestPlan?.revision
                  ) {
                    throw new Error(
                      "Plan invalidation cannot be authorized from a stale or legacy Planner OQ. Reconcile it and use the current plan step or a fresh Planner OQ.",
                    )
                  }
                }
                const invalidated = invalidateWorkPlan(
                  work,
                  {
                    expectedVersion: value.expectedVersion,
                    reason: value.reason,
                    by: tool.agent,
                  },
                  new Date().toISOString(),
                )
                delete workflow.work!.taskPlanRevision
                delete workflow.work!.taskPlanFingerprint
                delete workflow.work!.reviewedPlanRevision
                delete workflow.work!.reviewedPlanFingerprint
                await ctx.storage.set(workKey(work.objectiveId), work)
                await persistWorkflowMutationLocked(ctx, runtime, workflow)
                return invalidated
              },
            )

            return {
              content: renderToolOutput({
                invalidated: true,
                objectiveId: result.hierarchy.objectiveId,
                version: result.hierarchy.version,
                generation: result.hierarchy.generation,
                revision: result.plan.revision,
                plan: workPlanContext(result.hierarchy, undefined, "full"),
                next: "Create a fresh Plan generation with loom_work_plan.",
              }),
            }
          } catch (error) {
            return { content: renderToolOutput({ error: error instanceof Error ? error.message : String(error) }) }
          }
        },
      })

      addLoomTool({
        name: "upgrade_status",
        description:
          "Inspect state-derived Loom compatibility actions for the current Objective after an upgrade. Read-only. Actions disappear automatically when authoritative state satisfies the new invariant; there is no acknowledgement/complete call.",
        input: {
          type: "object",
          properties: {
            workflowId: { type: "string" },
            objectiveId: { type: "string" },
            taskId: { type: "string" },
            revision: { type: "number" },
          },
          additionalProperties: false,
        },
        options: { namespace: "loom", codemode: false },
        execute: async (input, tool) => {
          const value = input as {
            workflowId?: string
            objectiveId?: string
            taskId?: string
            revision?: number
          }
          if (value.revision !== undefined && !value.taskId) {
            return {
              content: renderToolOutput({
                error: "Plan revision selection requires taskId; whole-Plan status always uses the latest revision.",
              }),
            }
          }
          let objectiveId = value.objectiveId

          if (!objectiveId) {
            const workflow = value.workflowId
              ? await readBoundWorkflow(ctx, tool.sessionID, value.workflowId, ensureLegacySession)
              : await activeWorkflow(ctx, tool.sessionID, ensureLegacySession)
            objectiveId = workflow?.work?.objectiveId
          }

          if (!objectiveId) {
            return {
              content: renderToolOutput({
                runtimeVersion: RUNTIME_STATE_VERSION,
                upgradeState: "current",
                actions: [],
              }),
            }
          }

          if (value.objectiveId) {
            const active = await activeWorkflow(ctx, tool.sessionID, ensureLegacySession)
            if (!active?.work || active.work.objectiveId !== value.objectiveId) {
              return {
                content: renderToolOutput({
                  error: "Current session is not bound to a workflow for this Objective.",
                }),
              }
            }
          }

          const work = await readWork(ctx, objectiveId)
          if (!work) {
            return {
              content: renderToolOutput({
                error: "Persistent work Objective not found.",
              }),
            }
          }

          const actions = objectiveUpgradeActions(work)
          return {
            content: renderToolOutput({
              runtimeVersion: RUNTIME_STATE_VERSION,
              upgradeState: actions.length > 0 ? "action-required" : "current",
              objectiveId: work.objectiveId,
              generation: work.generation,
              actions,
            }),
          }
        },
      })

      addLoomTool({
        name: "work_status",
        description:
          "Inspect persistent Objective progress and the bounded current holistic Plan. Pass taskId to retrieve one exact persistent Plan Task contract (including future Waves) without loading the whole rich Plan; revision optionally selects an immutable revision in the current generation.",
        input: {
          type: "object",
          properties: {
            workflowId: { type: "string" },
            objectiveId: { type: "string" },
            taskId: { type: "string" },
            revision: { type: "number" },
          },
          additionalProperties: false,
        },
        options: { namespace: "loom", codemode: false },
        execute: async (input, tool) => {
          const value = input as {
            workflowId?: string
            objectiveId?: string
            taskId?: string
            revision?: number
          }
          if (value.revision !== undefined && !value.taskId) {
            return {
              content: renderToolOutput({
                error: "Plan revision selection requires taskId; whole-Plan status always uses the latest revision.",
              }),
            }
          }
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

          const plan = value.taskId
            ? workPlanContext(
                work,
                value.taskId,
                "focused",
                work.generation,
                value.revision,
              )
            : workPlanContext(work, undefined, "full")
          if (value.taskId && !plan?.focus?.task) {
            return {
              content: renderToolOutput({
                error:
                  value.revision === undefined
                    ? `Persistent Plan Task ${value.taskId} not found in the current generation.`
                    : `Persistent Plan Task ${value.taskId} not found in current generation revision ${value.revision}.`,
              }),
            }
          }

          return {
            content: renderToolOutput({
              objectiveId: work.objectiveId,
              version: work.version,
              generation: work.generation,
              tree: workTree(work),
              plan,
              nextRunnableWaves: nextRunnableWaves(work),
            }),
          }
        },
      })


      addLoomTool({
        name: "cancel",
        description: "Cancel this workflow after an explicit user instruction. Preserve completed work/evidence, revoke further execution and permit a replacement. General owner only; safe to retry. Does not undo already-running external tools.",
        input: {
          type: "object",
          properties: {
            workflowId: { type: "string" },
            reason: { type: "string" },
            confirmation: { type: "string", description: "Exact explicit user instruction authorizing cancellation; not a model inference." },
          },
          required: ["workflowId", "reason", "confirmation"],
          additionalProperties: false,
        },
        options: { namespace: "loom", codemode: false },
        execute: async (input, tool) => {
          try {
            await ensureLegacySession(tool.sessionID)
            const cancelled = await cancelWorkflow(ctx.storage as any, runtime, input as CancelWorkflowInput, tool)
            const cleanup = await cleanupDiagnosticSandboxesForWorkflow((input as CancelWorkflowInput).workflowId)
            return { content: renderToolOutput({ ...cancelled, diagnosticSandboxCleanup: cleanup }) }
          } catch (error) {
            return { content: renderToolOutput({ error: error instanceof Error ? error.message : String(error) }) }
          }
        },
      })

      addLoomTool({
        name: "work_release",
        description:
          "Release a live persistent Wave claim. This is not workflow cancellation; use loom_cancel for user-authorized abort/replacement, including already-completed Waves. General only.",
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


      addLoomTool({
        name: "task_plan",
        description:
          "Compile exactly one runnable Wave using each Task's persistent accountable role and responsibility. Planner only. Executable semantics must match the persistent Plan; new workflows do not claim or authorize the Wave until independent review-plan passes.",
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
                  rationale: { type: "string" },
                  dependsOn: { type: "array", items: { type: "string" } },
                  authorityRefs: { type: "array", items: { type: "string" } },
                  constraints: { type: "array", items: { type: "string" } },
                  acceptanceCriteria: { type: "array", items: { type: "string" } },
                  subtasks: { type: "array", items: { type: "string" } },
                  integration: { type: "array", items: { type: "string" } },
                  write: { type: "array", items: { type: "string" } },
                  skills: { type: "array", items: { type: "string" } },
                  verify: { type: "array", items: { type: "string" } },
                  role: { type: "string" },
                  responsibility: { type: "string", enum: ["produce", "execute", "review", "obtain-user-decision"] },
                },
                required: [
                  "id",
                  "title",
                  "objective",
                  "rationale",
                  "dependsOn",
                  "authorityRefs",
                  "constraints",
                  "acceptanceCriteria",
                  "subtasks",
                  "integration",
                  "write",
                  "skills",
                  "verify",
                  "role",
                  "responsibility",
                ],
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
          if (planningOnlyObjective(workflow.effects)) {
            return {
              content: renderToolOutput({
                error:
                  "Planning-only Objective workflows do not compile executable Worker Tasks. Complete and review the persistent holistic Plan; start a later implementation workflow to call loom_task_plan.",
              }),
            }
          }

          const planStep = workflow.steps.find((step) => step.id === "plan")
          if (!planStep) return { content: renderToolOutput({ error: "Workflow has no planning step." }) }
          if (!workflow.steps.some((step) => step.id === "review-plan" && step.agent === "reviewer" && step.kind === "gate")) {
            return {
              content: renderToolOutput({
                error: "This legacy workflow has no independent review-plan gate and cannot admit Tasks. Re-route through a current Objective workflow so Planner correction and Reviewer review precede Wave claim.",
              }),
            }
          }
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

                let autoResolvedWorkLevel = false
                if (
                  workflow.effects &&
                  resolveExecutionDepth(workflow.effects) === "objective" &&
                  workflow.effects.productOutcome &&
                  workflow.effects.workLevelAuto
                ) {
                  const desiredWorkLevel = objectiveWorkLevel(work)
                  if (workflow.effects.workLevel !== desiredWorkLevel) {
                    const effects: Effects = { ...workflow.effects, workLevel: desiredWorkLevel }
                    const currentById = new Map(workflow.steps.map((step) => [step.id, step]))
                    const next = buildSteps(effects).map((step) => {
                      const current = currentById.get(step.id)
                      if (
                        current &&
                        current.agent === step.agent &&
                        current.kind === step.kind &&
                        JSON.stringify(current.dependsOn) === JSON.stringify(step.dependsOn)
                      ) {
                        return {
                          ...step,
                          status: current.status,
                          attempt: current.attempt,
                          ...(current.summary ? { summary: current.summary } : {}),
                        }
                      }
                      return step
                    })
                    workflow.effects = effects
                    workflow.steps = next
                    reconcileVerificationAfterRoute(workflow)
                    autoResolvedWorkLevel = true
                  }
                }

                const steps = applyTaskPlan(workflow, tasks)
                const currentPlan = workPlanContext(work, undefined, "full", workflow.work!.generation)
                if (!currentPlan) throw new Error("Persistent semantic Plan snapshot not found.")
                workflow.work!.taskPlanRevision = currentPlan.revision
                workflow.work!.taskPlanFingerprint = workflowTaskSemanticFingerprint(
                  work,
                  tasks.map((task) => task.id),
                  workflow.work!.generation,
                )
                const wave = validateWorkflowWave(
                  work,
                  tasks,
                  (workflow.effects?.workLevel ?? "objective") === "objective",
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
                if (!persisted) throw new Error("Persistent work hierarchy disappeared after task-plan compilation.")
                validateWorkflowWave(
                  persisted,
                  tasks,
                  (workflow.effects?.workLevel ?? "objective") === "objective",
                )
                return {
                  work: persisted,
                  wave,
                  steps,
                  planReviewRequired: true,
                  workLevel: workflow.effects?.workLevel ?? "objective",
                  workLevelAuto: Boolean(workflow.effects?.workLevelAuto),
                  autoResolvedWorkLevel,
                }
              },
            )
            const steps = claimed.steps
            return {
              content: renderToolOutput({
                wave: { id: claimed.wave.logicalId, title: claimed.wave.title },
                generation: claimed.work.generation,
                planReviewRequired: claimed.planReviewRequired,
                workLevel: claimed.workLevel,
                workLevelAuto: claimed.workLevelAuto,
                autoResolvedWorkLevel: claimed.autoResolvedWorkLevel,
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

      addLoomTool({
        name: "task_status",
        description:
          "Inspect exact Task contracts and runtime status, including whether a user-decision wait is ready for its exact OQ path. Executable workflows return compiled role-owned Tasks. Planning-only Objectives may retrieve one exact semantic Plan Task by taskId before executable scopes exist; use planContext for the bounded Plan map.",
        input: {
          type: "object",
          properties: {
            workflowId: { type: "string" },
            taskId: { type: "string" },
          },
          required: ["workflowId"],
          additionalProperties: false,
        },
        options: { namespace: "loom", codemode: false },
        execute: async (input, tool) => {
          const { workflowId, taskId } = input as { workflowId: string; taskId?: string }
          const workflow = await readBoundWorkflow(ctx, tool.sessionID, workflowId, ensureLegacySession)
          if (!workflow) return { content: renderToolOutput({ error: "Workflow not found." }) }
          const allTasks = plannedTaskSteps(workflow)
          const tasks = taskId
            ? allTasks.filter((step) => step.task?.id === taskId)
            : allTasks

          if (tasks.length === 0 && planningOnlyObjective(workflow.effects)) {
            if (!taskId) {
              return {
                content: renderToolOutput({
                  error:
                    "Planning-only Objective has no executable Wave corpus. Use attached planContext to choose a Task, then pass taskId for its exact semantic contract.",
                }),
              }
            }
            if (!workflow.work) {
              return { content: renderToolOutput({ error: "Persistent Objective Plan not found." }) }
            }
            const work = await readWork(ctx, workflow.work.objectiveId)
            const context = work
              ? workPlanContext(work, taskId, "focused", workflow.work.generation)
              : null
            if (!context?.focus?.task) {
              return { content: renderToolOutput({ error: `Planned Task ${taskId} not found.` }) }
            }
            return {
              content: renderToolOutput({
                tasks: [{
                  status: context.focus.status ?? "pending",
                  runnable: false,
                  dependsOn: context.focus.task.dependsOn,
                  task: context.focus.task,
                  executable: false,
                  scopeStatus: "deferred-until-implementation",
                }],
              }),
            }
          }

          if (taskId && tasks.length === 0) {
            return { content: renderToolOutput({ error: `Planned Task ${taskId} not found.` }) }
          }
          const runnableIDs = new Set(runnable(workflow).map((step) => step.id))
          return {
            content: renderToolOutput({
              tasks: tasks.map((step) => ({
                stepId: step.id,
                status: step.status,
                runnable: runnableIDs.has(step.id),
                ...(step.kind === "wait" && step.task?.responsibility === "obtain-user-decision"
                  ? {
                      decisionWait: true,
                      decisionReady: step.dependsOn.every((dependency) => {
                        const upstream = workflow.steps.find((candidate) => candidate.id === dependency)
                        return upstream && satisfied(upstream)
                      }),
                    }
                  : {}),
                dependsOn: step.dependsOn,
                task: step.task,
                executable: true,
              })),
            }),
          }
        },
      })

      const setStepWriteScope = async (input: unknown, tool: any) => {
        if (tool.agent !== "general") {
          return { content: renderToolOutput({ error: "Only general may define a step write scope." }) }
        }

        const value = input as { workflowId: string; stepId: string; write: string[] }
        const workflow = await readBoundWorkflow(ctx, tool.sessionID, value.workflowId, ensureLegacySession)
        if (!workflow) return { content: renderToolOutput({ error: "Workflow not found." }) }

        try {
          const result = await withRuntimeLocks(
            runtime,
            [
              { aggregate: "workflow", resourceIdentity: value.workflowId },
              stepAuthorityResource(value.workflowId, value.stepId),
            ],
            async () => {
            const currentBinding = (await ctx.storage.get(sessionKey(tool.sessionID))) as string | undefined
            if (currentBinding !== value.workflowId) {
              throw new Error("General is no longer bound to this workflow.")
            }
            const current = await readWorkflow(ctx, value.workflowId)
            if (!current) throw new Error("Workflow not found.")

            const step = current.steps.find((candidate) => candidate.id === value.stepId)
            if (!step) throw new Error("Step not found.")
            if (step.kind === "wait" || step.agent === "user") {
              throw new Error("User-decision wait steps are non-agent and cannot receive an agent write scope.")
            }
            if (step.status !== "pending") {
              throw new Error("Step write scope cannot change after the step has finished.")
            }

            if (step.agent === "worker" && step.task) {
              throw new Error(
                "Planned Task write scope is the starting expectation from the accepted Plan. " +
                "Do not rewrite the Plan to follow implementation discovery; let the attached Worker call loom_scope_elevate instead.",
              )
            }
            validateScopeElevation(value.write)
            const roleWriteDefault = artifactWriteDefaults[step.agent]
            if (!productScopeElevatingAgents.has(step.agent)) {
              if (
                !roleWriteDefault?.length ||
                !resourcesWithinScope(value.write, roleWriteDefault)
              ) {
                throw new Error(
                  `${step.agent} is an independent/advisory role and its declared write scope must remain inside its role-owned output surface: ${roleWriteDefault?.join(", ") || "<none>"}.`,
                )
              }
            }
            const previous = (await ctx.storage.get(
              scopeKey(value.workflowId, value.stepId),
            )) as TaskScope | undefined

            const scope: TaskScope = {
              workflowId: value.workflowId,
              stepId: value.stepId,
              write: [...new Set(value.write)],
              ...(previous?.elevations?.length
                ? { elevations: previous.elevations }
                : {}),
            }
            await ctx.storage.set(scopeKey(value.workflowId, value.stepId), scope)
            await bumpWorkflowRevisionLocked(ctx, runtime, value.workflowId)
            return { current, step, scope, roleWriteDefault }
          },
          )

          return {
            content: renderToolOutput({
              scope: result.scope,
              agent: result.step.agent,
              ...(result.roleWriteDefault
                ? { roleWriteDefault: result.roleWriteDefault }
                : {}),
              ...(result.current.request ? { acceptedOutcome: result.current.request } : {}),
              acceptedAuthority: result.current.anchor,
              scopeSemantics: "starting-expectation-with-runtime-elevation",
              scopeNote:
                "The write list is General's current expected mutation surface, not a claim that every required file is known up front. " +
                "acceptedAuthority identifies the governing source. The attached agent may call loom_scope_elevate when implementation/discovery reveals additional project-local paths; each elevation is recorded. " +
                "Hard-boundary elevation returns continue=false and requires an explicit one-time user decision before work may resume.",
            }),
          }
        } catch (error) {
          return { content: renderToolOutput({ error: error instanceof Error ? error.message : String(error) }) }
        }
      }

      const stepWriteScopeInput = {
        type: "object",
        properties: {
          workflowId: { type: "string" },
          stepId: { type: "string" },
          write: { type: "array", items: { type: "string" } },
        },
        required: ["workflowId", "stepId", "write"],
        additionalProperties: false,
      } as const

      addLoomTool({
        name: "step_scope",
        description:
          "Declare or narrow General's bounded starting write expectation for one pending workflow step. General only. This need not predict every file the child will discover; attached agents may expand project-local scope with loom_scope_elevate and Loom records every elevation.",
        input: stepWriteScopeInput,
        options: { namespace: "loom", codemode: false },
        execute: setStepWriteScope,
      })

      addLoomTool({
        name: "task_scope",
        description:
          "Compatibility alias for loom_step_scope. The declared write list is a starting expectation; attached agents may expand it at runtime with loom_scope_elevate.",
        input: stepWriteScopeInput,
        options: { namespace: "loom", codemode: false },
        execute: setStepWriteScope,
      })

      addLoomTool({
        name: "dispatch_grant",
        description:
          "Issue one short-lived, single-use attachment grant for an exact runnable workflow step or unanswered OQ. General only. A Worker may be dispatched without a predeclared file list so it can inspect first and call loom_scope_elevate when it discovers the actual mutation surface. Pass the returned grantId to the child session.",
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
            if (question.requiredAuthority === "general") {
              return {
                content: renderToolOutput({
                  error: "General-owned OQs are answered directly by the bound General session with loom_oq_answer.",
                }),
              }
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
                if (
                  (step.task ||
                    step.id.startsWith("task-review:") ||
                    (step.id === "review-implementation" && plannedTaskSteps(current).length > 0)) &&
                  step.kind !== "wait"
                ) {
                  const work = current.work
                    ? await readWork(ctx, current.work.objectiveId)
                    : undefined
                  assertPlannedTaskAdmission(current, work, step)
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

              // Prevent General from accidentally creating the fail-closed
              // ambiguity that the permission hook must defend against.
              // Multiple grants for the same exact target remain valid because
              // they carry the same budget identity and lifecycle recovery uses
              // them for independent child attachments. A different outstanding
              // target for the same role must be launched/admitted first.
              const currentQuestions = await readQuestions(ctx, value.workflowId)
              const outstanding: Array<{
                kind: "step" | "question"
                id: string
                grant: NonNullable<Awaited<ReturnType<typeof findUsableDispatchGrant>>>
              }> = []

              for (const step of runnable(current).filter((candidate) => candidate.agent === expectedAgent)) {
                const existing = await findUsableDispatchGrant(ctx.storage as any, runtime, {
                  workflowId: value.workflowId,
                  stepId: step.id,
                  expectedAgent,
                  issuingParentSessionId: tool.sessionID,
                })
                if (existing) outstanding.push({ kind: "step", id: step.id, grant: existing })
              }

              for (const question of currentQuestions.filter(
                (candidate) =>
                  candidate.status !== "closed" &&
                  !candidate.answer &&
                  candidate.requiredAuthority === expectedAgent,
              )) {
                const existing = await findUsableDispatchGrant(ctx.storage as any, runtime, {
                  workflowId: value.workflowId,
                  oqId: question.id,
                  expectedAgent,
                  issuingParentSessionId: tool.sessionID,
                })
                if (existing) outstanding.push({ kind: "question", id: question.id, grant: existing })
              }

              const requestedKind = value.stepId ? "step" : "question"
              const requestedId = value.stepId ?? value.questionId!
              const conflicting = outstanding.filter(
                (candidate) => candidate.kind !== requestedKind || candidate.id !== requestedId,
              )

              if (conflicting.length > 0) {
                const existing = conflicting[0]
                throw new Error(
                  `An unadmitted ${expectedAgent} dispatch grant already targets ${existing.kind} ${existing.id}. Dispatch/admit that target before issuing a grant for another same-agent target.`,
                )
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

      addLoomTool({
        name: "attach",
        description:
          "Consume a General-issued one-use grant and attach the current child session to its exact Loom workflow step or OQ, including the relevant Task/holistic Plan context when available.",
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
          const observedStepId = (await ctx.storage.get(
            sessionStepKey(tool.sessionID),
          )) as string | undefined
          const resources = [
            ...(value.stepId
              ? [stepAuthorityResource(value.workflowId, value.stepId)]
              : []),
            ...(observedBinding && observedStepId
              ? [stepAuthorityResource(observedBinding, observedStepId)]
              : []),
            { aggregate: "workflow", resourceIdentity: value.workflowId },
            ...(observedBinding && observedBinding !== value.workflowId
              ? [{ aggregate: "workflow", resourceIdentity: observedBinding }]
              : []),
            ...(targetSnapshot.work
              ? [{ aggregate: "work", resourceIdentity: targetSnapshot.work.objectiveId }]
              : []),
          ]

          let scope: TaskScope | undefined
          let task: TaskSpec | undefined
          let taskOutcome: string | undefined
          let stepAttempt: number | undefined
          let acceptedOutcome: string | undefined
          let acceptedAuthority: string | undefined
          let planContext: ReturnType<typeof workPlanContext> | undefined
          let planFingerprint: string | undefined
          let legacyTaskContext:
            | {
                taskId: string
                title: string
                objective?: string
                status: string
                dependsOn: string[]
                result?: {
                  workflowId: string
                  summary?: string
                  evidenceClaimIds: string[]
                  evidenceClaimsOmitted?: number
                  completedAt: string
                }
              }
            | undefined
          let upgradeActions: ReturnType<typeof objectiveUpgradeActions> | undefined

          try {
            await withRuntimeLocks(runtime, resources, async () => {
              const currentObservedStepId = (await ctx.storage.get(
                sessionStepKey(tool.sessionID),
              )) as string | undefined
              if (currentObservedStepId !== observedStepId) {
                throw new Error(
                  "Session step attachment changed concurrently; retry the Loom attachment.",
                )
              }
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

              assertWorkflowNotCancelled(workflow)
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
                taskOutcome = step.task?.objective
                stepAttempt = step.attempt ?? 0
                acceptedOutcome = workflow.request
                acceptedAuthority = workflow.anchor

                let work: WorkHierarchy | undefined
                if (workflow.work) {
                  if (targetSnapshot.work?.objectiveId !== workflow.work.objectiveId) {
                    throw new Error("Workflow work binding changed concurrently; retry attachment.")
                  }
                  work = await readWork(ctx, workflow.work.objectiveId)
                  if (!work) throw new Error("Persistent work hierarchy not found.")
                  planContext =
                    workPlanContext(
                      work,
                      step.task?.id,
                      tool.agent === "reviewer" || tool.agent === "critic" ? "full" : "focused",
                      workflow.work.generation,
                    ) ?? undefined
                  if (value.stepId === "review-plan") {
                    planFingerprint = workPlanSemanticFingerprint(work, workflow.work.generation)
                  }
                  if (tool.agent === "planner") {
                    const pending = objectiveUpgradeActions(work)
                    if (pending.length > 0) upgradeActions = pending
                  }
                }

                scope = (await ctx.storage.get(
                  scopeKey(value.workflowId, value.stepId),
                )) as TaskScope | undefined
                if (tool.agent === "reviewer") {
                  // Reviewer mutation authority is derived from the exact
                  // current gate shape, not inherited from a prior attempt.
                  // Recompute it on every fresh attachment so reopen/reroute
                  // cannot retain stale acceptance-write authority.
                  scope = {
                    workflowId: value.workflowId,
                    stepId: value.stepId,
                    write: reviewerAcceptanceWriteScope(step),
                  }
                  await ctx.storage.set(
                    scopeKey(value.workflowId, value.stepId),
                    scope,
                  )
                }

                if (
                  (step.task ||
                    step.id.startsWith("task-review:") ||
                    (step.id === "review-implementation" && plannedTaskSteps(workflow).length > 0)) &&
                  step.kind !== "wait"
                ) {
                  assertPlannedTaskAdmission(workflow, work, step)
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

                acceptedOutcome = workflow.request
                acceptedAuthority = workflow.anchor
                const workBinding = question.work ?? workflow.work
                if (workBinding) {
                  const work = await readWork(ctx, workBinding.objectiveId)
                  if (work) {
                    planContext =
                      workPlanContext(
                        work,
                        question.work?.taskId,
                        "focused",
                        workBinding.generation,
                        question.work?.revision,
                      ) ?? undefined
                    if (!planContext && question.work?.taskId) {
                      const legacyTask = work.nodes.find(
                        (node) =>
                          node.generation === workBinding.generation &&
                          node.type === "task" &&
                          node.logicalId === question.work!.taskId,
                      )
                      if (legacyTask) {
                        const evidenceClaimIds = legacyTask.result?.evidenceClaimIds ?? []
                        legacyTaskContext = {
                          taskId: legacyTask.logicalId,
                          title: clippedSummary(legacyTask.title, 320) ?? legacyTask.logicalId,
                          ...(legacyTask.objective
                            ? { objective: clippedSummary(legacyTask.objective, 320) }
                            : {}),
                          status: legacyTask.status,
                          dependsOn: [...(legacyTask.dependsOn ?? [])].slice(0, 24),
                          ...(legacyTask.result
                            ? {
                                result: {
                                  workflowId: legacyTask.result.workflowId,
                                  ...(legacyTask.result.summary
                                    ? { summary: clippedSummary(legacyTask.result.summary, 320) }
                                    : {}),
                                  evidenceClaimIds: evidenceClaimIds.slice(0, 12),
                                  ...(evidenceClaimIds.length > 12
                                    ? { evidenceClaimsOmitted: evidenceClaimIds.length - 12 }
                                    : {}),
                                  completedAt: legacyTask.result.completedAt,
                                },
                              }
                            : {}),
                        }
                      }
                    }
                    if (tool.agent === "planner") {
                      const pending = objectiveUpgradeActions(work)
                      if (pending.length > 0) upgradeActions = pending
                    }
                  }
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
              await scopedStorage.delete?.(`session-deletion-fence/${tool.sessionID}`)
              await ctx.storage.set(sessionAttachmentKey(tool.sessionID), crypto.randomUUID())
              await ctx.storage.set(sessionStepKey(tool.sessionID), value.stepId ?? "")
              await ctx.storage.set(
                sessionStepAttemptKey(tool.sessionID),
                value.stepId ? (stepAttempt ?? 0) : null,
              )
              if (value.stepId) {
                await ctx.storage.set(
                  stepSessionBindingKey(
                    value.workflowId,
                    value.stepId,
                    stepAttempt ?? 0,
                  ),
                  {
                    schemaVersion: 1,
                    workflowId: value.workflowId,
                    stepId: value.stepId,
                    attempt: stepAttempt ?? 0,
                    sessionID: tool.sessionID,
                    agent: tool.agent,
                    attachedAt: new Date().toISOString(),
                  } satisfies StepSessionBinding,
                )
              }
              await ctx.storage.set(sessionOqKey(tool.sessionID), value.questionId ?? "")
              if (value.stepId === "review-plan" && planContext) {
                const planningOnly = planningOnlyObjective(workflow.effects)
                const executableFingerprint = executableTaskPlanFingerprint(workflow)
                if (!planFingerprint) {
                  throw new Error("Plan review requires a current persistent Plan fingerprint.")
                }
                if (!planningOnly && !executableFingerprint) {
                  throw new Error("Execution Plan review requires a compiled executable Task DAG.")
                }
                if (planningOnly && executableFingerprint) {
                  throw new Error("Planning-only Objective review must not contain an executable Worker DAG.")
                }
                await ctx.storage.set(sessionPlanReviewKey(tool.sessionID), {
                  workflowId: value.workflowId,
                  generation: planContext.generation,
                  revision: planContext.revision,
                  planFingerprint,
                  ...(executableFingerprint ? { executableFingerprint } : {}),
                  attempt: stepAttempt ?? 0,
                } satisfies PlanReviewBinding)
              } else {
                await ctx.storage.set(sessionPlanReviewKey(tool.sessionID), null)
              }
              await bumpWorkflowRevisionLocked(ctx, runtime, value.workflowId)
              if (previousBinding && previousBinding !== value.workflowId) {
                await bumpWorkflowRevisionLocked(ctx, runtime, previousBinding, true)
              }
            })
          } catch (error) {
            return { content: renderToolOutput({ error: error instanceof Error ? error.message : String(error) }) }
          }

          let producerSkills: ObservedProducerSkill[] | undefined
          if (tool.agent === "reviewer" || tool.agent === "critic") {
            const current = await readWorkflow(ctx, value.workflowId)
            if (current && value.stepId) {
              producerSkills = await observedProducerSkills(ctx, current, value.stepId)
            } else if (current && value.questionId) {
              const question = (await ctx.storage.get(
                oqKey(value.workflowId, value.questionId),
              )) as OpenQuestion | undefined
              if (question?.work) {
                producerSkills = await observedQuestionProducerSkills(ctx, current, question)
              }
            }
          }

          return {
            content: renderToolOutput({
              attached: true,
              workflowId: value.workflowId,
              ...(value.stepId
                ? { stepId: value.stepId, attempt: stepAttempt ?? 0 }
                : { questionId: value.questionId }),
              ...(acceptedOutcome ? { acceptedOutcome } : {}),
              ...(taskOutcome ? { taskOutcome } : {}),
              ...(acceptedAuthority ? { acceptedAuthority } : {}),
              ...(planContext ? { planContext } : {}),
              ...(legacyTaskContext ? { legacyTaskContext } : {}),
              ...(upgradeActions?.length ? { upgradeActions } : {}),
              ...(scope ? {
                write: scope.write,
                scopeSemantics: "starting-expectation-with-runtime-elevation",
                scopeNote: taskOutcome
                  ? "The attached write scope is the current mutation surface, not a prediction that every needed file is already known. taskOutcome is the bounded completion target and planContext preserves the parent goal, accepted authority, constraints, acceptance criteria, integration, dependencies, risks, and downstream acceptance context. Discover freely; call loom_scope_elevate before mutating additional project-local paths. Same-attempt admitted bytes are automatically commit-authorized across redispatch."
                  : acceptedOutcome
                    ? "The attached write scope is the current mutation surface, not a prediction that every needed file is already known. acceptedOutcome is the bounded completion target and acceptedAuthority is its governing source. Discover freely; call loom_scope_elevate before mutating additional project-local paths. Same-attempt admitted bytes are automatically commit-authorized across redispatch."
                    : "The attached write scope is the current mutation surface, not a prediction that every needed file is already known. acceptedAuthority identifies the governing source. Discover freely; call loom_scope_elevate before mutating additional project-local paths. Same-attempt admitted bytes are automatically commit-authorized across redispatch.",
              } : {}),
              ...(task ? { task } : {}),
              ...(producerSkills ? { producerSkills } : {}),
            }),
          }
        },
      })

      addLoomTool({
        name: "scope_status",
        description:
          "Inspect one workflow step's current effective write scope, General's declared starting expectation, and durable self-elevation history.",
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
          const workflow = await readBoundWorkflow(ctx, tool.sessionID, workflowId, ensureLegacySession)
          if (!workflow) {
            return { content: renderToolOutput({ error: "Workflow not found or current session is not bound to it." }) }
          }
          const step = workflow.steps.find((candidate) => candidate.id === stepId)
          if (!step) return { content: renderToolOutput({ error: "Step not found." }) }
          const scope = (await ctx.storage.get(scopeKey(workflowId, stepId))) as TaskScope | undefined
          const roleWriteDefault = artifactWriteDefaults[step.agent] ?? []
          const effectiveWrite = scope?.write.length ? scope.write : roleWriteDefault
          return {
            content: renderToolOutput({
              scope: scope ?? null,
              agent: step.agent,
              roleWriteDefault,
              effectiveWrite,
              elevations: scope?.elevations ?? [],
              scopeSemantics: "starting-expectation-with-runtime-elevation",
            }),
          }
        },
      })

      addLoomTool({
        name: "scope_elevate",
        description:
          "Expand the current attached child step's write scope when discovery reveals additional files or folders. Project-local elevation is immediate, durable, and traceable; the child continues in the same session. Hard-boundary paths (outside the current project or repository-internal .git state) cannot self-authorize: this tool returns continue=false plus an exact user question payload. When continue=false, STOP the current child turn immediately and return control to General; do not retry the write or continue assuming access will arrive later.",
        input: {
          type: "object",
          properties: {
            workflowId: { type: "string" },
            stepId: { type: "string" },
            paths: { type: "array", items: { type: "string" } },
            reason: {
              type: "string",
              description: "Why the newly discovered paths are required for the assigned step.",
            },
          },
          required: ["workflowId", "stepId", "paths", "reason"],
          additionalProperties: false,
        },
        options: { namespace: "loom", codemode: false },
        execute: async (input, tool) => {
          if (tool.agent === "general") {
            return {
              content: renderToolOutput({
                error:
                  "General defines starting scope with loom_step_scope. Runtime self-elevation belongs to the attached child that discovered the additional mutation surface.",
              }),
            }
          }

          const value = input as {
            workflowId: string
            stepId: string
            paths: string[]
            reason: string
          }
          const reason = value.reason.trim()
          if (!reason) {
            return {
              content: renderToolOutput({
                error: "Scope elevation requires a non-empty reason for the audit trail.",
              }),
            }
          }

          let classified: Awaited<ReturnType<typeof classifyScopeTarget>>[]
          try {
            classified = await Promise.all(
              value.paths.map((path) =>
                classifyScopeTarget(ctx.location.directory, path),
              ),
            )
          } catch (error) {
            return {
              content: renderToolOutput({
                error: error instanceof Error ? error.message : String(error),
              }),
            }
          }
          const projectPaths = [
            ...new Set(
              classified
                .filter((entry) => entry.kind === "project")
                .map((entry) => entry.path),
            ),
          ].sort()
          const hardBoundaryClassifications = classified.filter(
            (entry) => entry.kind === "hard-boundary",
          )
          const hardBoundaryPaths = [
            ...new Set(
              hardBoundaryClassifications.map((entry) => entry.path),
            ),
          ].sort()
          const hardBoundaryDetails: ScopeBoundaryDetail[] =
            hardBoundaryClassifications.map(
              (entry): ScopeBoundaryDetail => ({
                path: entry.path,
                kind: entry.reason as ScopeBoundaryDetail["kind"],
                ...("resolvedExistingTarget" in entry &&
                entry.resolvedExistingTarget
                  ? { resolvedExistingTarget: entry.resolvedExistingTarget }
                  : {}),
              }),
            )

          const roleWriteDefault = artifactWriteDefaults[tool.agent] ?? []
          if (!productScopeElevatingAgents.has(tool.agent)) {
            const outsideRoleOutput =
              hardBoundaryPaths.length > 0 ||
              projectPaths.some(
                (path) =>
                  !resourcesWithinScope([path], roleWriteDefault),
              )
            if (outsideRoleOutput) {
              return {
                content: renderToolOutput({
                  error:
                    `${tool.agent} is an independent/advisory role and cannot self-elevate into product or hard-boundary mutation authority. Keep writes inside its role-owned output surface or return the implementation work to a producing role.`,
                  roleWriteDefault,
                }),
              }
            }
          }

          try {
            if (projectPaths.length > 0) validateScopeElevation(projectPaths)

            const result = await withRuntimeLocks(
              runtime,
              [
                { aggregate: "workflow", resourceIdentity: value.workflowId },
                stepAuthorityResource(value.workflowId, value.stepId),
              ],
              async () => {
                const binding = await gitSessionOwnershipBinding(ctx, tool.sessionID)
                if (
                  !binding ||
                  binding.workflowId !== value.workflowId ||
                  binding.stepId !== value.stepId ||
                  !(await exactStepAttemptBinding(
                    ctx,
                    tool.sessionID,
                    value.workflowId,
                    value.stepId,
                  ))
                ) {
                  throw new Error(
                    "Scope elevation requires this child session to be attached to the exact current Loom step attempt.",
                  )
                }

                const workflow = await readWorkflow(ctx, value.workflowId)
                if (!workflow) throw new Error("Workflow not found.")
                const step = workflow.steps.find(
                  (candidate) => candidate.id === value.stepId,
                )
                if (!step || step.agent !== tool.agent) {
                  throw new Error(
                    `Step ${value.stepId} belongs to ${step?.agent ?? "another role"}, not ${tool.agent}.`,
                  )
                }
                if (
                  step.status !== "pending" ||
                  !runnable(workflow).some(
                    (candidate) => candidate.id === value.stepId,
                  )
                ) {
                  throw new Error(
                    "Scope elevation requires the exact currently runnable pending step.",
                  )
                }

                const existing = (await ctx.storage.get(
                  scopeKey(value.workflowId, value.stepId),
                )) as TaskScope | undefined
                const currentWrite = existing?.write.length
                  ? existing.write
                  : roleWriteDefault
                let scope = existing
                let elevation: ScopeElevation | undefined

                if (projectPaths.length > 0) {
                  const crossesRoleDefault =
                    roleWriteDefault.length === 0 ||
                    !resourcesWithinScope(projectPaths, roleWriteDefault)
                  elevation = {
                    id: crypto.randomUUID(),
                    attempt: binding.attempt,
                    byAgent: tool.agent,
                    bySessionId: tool.sessionID,
                    paths: projectPaths,
                    reason,
                    elevatedAt: new Date().toISOString(),
                    ...(crossesRoleDefault ? { crossesRoleDefault: true } : {}),
                  }
                  scope = {
                    workflowId: value.workflowId,
                    stepId: value.stepId,
                    write: mergeWriteScope(currentWrite, projectPaths),
                    elevations: [...(existing?.elevations ?? []), elevation],
                  }
                  await ctx.storage.set(
                    scopeKey(value.workflowId, value.stepId),
                    scope,
                  )
                }

                let boundaryRequest: ScopeBoundaryRequest | undefined
                if (hardBoundaryPaths.length > 0) {
                  let after: string | undefined
                  do {
                    const page = await ctx.storage.scan({
                      prefix: scopeBoundaryRequestPrefix(
                        workflow.createdBySession,
                      ),
                      limit: 100,
                      ...(after ? { after } : {}),
                    })
                    for (const entry of page.entries) {
                      const candidate = entry.value as ScopeBoundaryRequest
                      if (
                        !candidate?.resolvedAt &&
                        candidate.workflowId === value.workflowId &&
                        candidate.stepId === value.stepId &&
                        candidate.attempt === binding.attempt &&
                        candidate.agent === tool.agent &&
                        candidate.requestedBySessionId === tool.sessionID &&
                        candidate.reason === reason &&
                        JSON.stringify(candidate.paths) ===
                          JSON.stringify(hardBoundaryPaths)
                      ) {
                        boundaryRequest = candidate
                        break
                      }
                    }
                    if (boundaryRequest) break
                    after = page.next
                  } while (after)

                  if (!boundaryRequest) {
                    const requestId = crypto.randomUUID()
                    boundaryRequest = {
                      requestId,
                      approvalRef: crypto.randomUUID().replaceAll("-", "").slice(0, 16),
                      workflowId: value.workflowId,
                      stepId: value.stepId,
                      attempt: binding.attempt,
                      agent: tool.agent,
                      requestedBySessionId: tool.sessionID,
                      generalSessionId: workflow.createdBySession,
                      paths: hardBoundaryPaths,
                      boundaryDetails: hardBoundaryDetails,
                      reason,
                      requestedAt: new Date().toISOString(),
                    }
                    await ctx.storage.set(
                      scopeBoundaryRequestKey(
                        boundaryRequest.generalSessionId,
                        requestId,
                      ),
                      boundaryRequest,
                    )
                  }
                }

                if (projectPaths.length > 0 || boundaryRequest) {
                  await bumpWorkflowRevisionLocked(
                    ctx,
                    runtime,
                    value.workflowId,
                  )
                }

                return { scope, elevation, boundaryRequest, roleWriteDefault }
              },
            )

            if (result.boundaryRequest) {
              const question = scopeBoundaryQuestionInput(result.boundaryRequest)
              return {
                content: renderToolOutput({
                  status: "user_authorization_required",
                  continue: false,
                  workflowId: value.workflowId,
                  stepId: value.stepId,
                  ...(projectPaths.length > 0
                    ? {
                        grantedProjectPaths: projectPaths,
                        effectiveWrite: result.scope?.write ?? result.roleWriteDefault,
                        elevation: result.elevation,
                      }
                    : {}),
                  hardBoundary: {
                    requestId: result.boundaryRequest.requestId,
                    approvalRef: result.boundaryRequest.approvalRef,
                    paths: result.boundaryRequest.paths,
                    boundaryDetails: result.boundaryRequest.boundaryDetails ?? [],
                    reason,
                    question,
                    rememberChoiceAllowed: false,
                  },
                  requiredAction:
                    "Return control to General immediately. Do not continue this child turn, retry the blocked mutation, or assume access has been granted. General must ask the user with the exact supplied question payload; after an Allow once decision, General calls loom_scope_authorize_once and then resumes/redispatches this same step attempt.",
                }),
              }
            }

            return {
              content: renderToolOutput({
                status: "granted",
                continue: true,
                workflowId: value.workflowId,
                stepId: value.stepId,
                scopeAdded: projectPaths,
                effectiveWrite: result.scope?.write ?? result.roleWriteDefault,
                elevation: result.elevation,
                note:
                  "Project-local scope elevation is active immediately and recorded. Continue the current step; no General round-trip is required.",
              }),
            }
          } catch (error) {
            return {
              content: renderToolOutput({
                error: error instanceof Error ? error.message : String(error),
              }),
            }
          }
        },
      })

      addLoomTool({
        name: "scope_authorize_once",
        description:
          "General only. Consume an approved exact Loom hard-boundary question and authorize those exact paths for the current step attempt. The approval never carries into another attempt/workflow and is never remembered or generalized; resume/redispatch the child only after this tool reports authorized=true.",
        input: {
          type: "object",
          properties: {
            workflowId: { type: "string" },
            requestId: { type: "string" },
          },
          required: ["workflowId", "requestId"],
          additionalProperties: false,
        },
        options: { namespace: "loom", codemode: false },
        execute: async (input, tool) => {
          if (tool.agent !== "general") {
            return {
              content: renderToolOutput({
                error: "Only General may consume user-approved hard-boundary scope authorization.",
              }),
            }
          }
          const value = input as { workflowId: string; requestId: string }
          const requestKey = scopeBoundaryRequestKey(
            tool.sessionID,
            value.requestId,
          )
          const observed = (await ctx.storage.get(
            requestKey,
          )) as ScopeBoundaryRequest | undefined
          if (!observed || observed.workflowId !== value.workflowId) {
            return {
              content: renderToolOutput({
                error: "Hard-boundary scope request not found for this General session/workflow.",
              }),
            }
          }
          const decision = (await ctx.storage.get(
            scopeBoundaryDecisionKey(tool.sessionID, value.requestId),
          )) as ScopeBoundaryDecision | undefined
          if (!decision?.approved) {
            return {
              content: renderToolOutput({
                error:
                  "No approved hard-boundary decision is recorded. Ask the user with the exact question payload from loom_scope_elevate; only an explicit Allow once decision authorizes access.",
                question: scopeBoundaryQuestionInput(observed),
                continue: false,
                rememberChoiceAllowed: false,
              }),
            }
          }

          try {
            const authorization = await withRuntimeLocks(
              runtime,
              [
                { aggregate: "workflow", resourceIdentity: value.workflowId },
                stepAuthorityResource(value.workflowId, observed.stepId),
                {
                  aggregate: "scope-boundary-authorization",
                  resourceIdentity: value.requestId,
                },
              ],
              async () => {
                const currentBinding = (await ctx.storage.get(
                  sessionKey(tool.sessionID),
                )) as string | undefined
                if (currentBinding !== value.workflowId) {
                  throw new Error("General is no longer bound to this workflow.")
                }
                const request = (await ctx.storage.get(
                  requestKey,
                )) as ScopeBoundaryRequest | undefined
                if (!request || request.resolvedAt) {
                  throw new Error("Hard-boundary scope request is no longer active.")
                }
                const latestDecision = (await ctx.storage.get(
                  scopeBoundaryDecisionKey(tool.sessionID, value.requestId),
                )) as ScopeBoundaryDecision | undefined
                if (!latestDecision?.approved) {
                  throw new Error("Hard-boundary user approval is missing or changed.")
                }

                const workflow = await readWorkflow(ctx, value.workflowId)
                if (!workflow) throw new Error("Workflow not found.")
                const step = workflow.steps.find(
                  (candidate) => candidate.id === request.stepId,
                )
                if (
                  !step ||
                  step.agent !== request.agent ||
                  step.status !== "pending" ||
                  (step.attempt ?? 0) !== request.attempt ||
                  !runnable(workflow).some(
                    (candidate) => candidate.id === request.stepId,
                  )
                ) {
                  throw new Error(
                    "Hard-boundary approval is stale because the target step/attempt changed.",
                  )
                }

                const record: ScopeBoundaryAuthorization = {
                  requestId: request.requestId,
                  workflowId: request.workflowId,
                  stepId: request.stepId,
                  attempt: request.attempt,
                  agent: request.agent,
                  patterns: request.paths,
                  boundaryDetails: request.boundaryDetails ?? [],
                  authorizedAt: new Date().toISOString(),
                  authorizedBySessionId: tool.sessionID,
                }
                await ctx.storage.set(
                  scopeBoundaryAuthorizationKey(
                    request.workflowId,
                    request.stepId,
                    request.attempt,
                    request.requestId,
                  ),
                  record,
                )
                await ctx.storage.set(requestKey, {
                  ...request,
                  resolvedAt: record.authorizedAt,
                } satisfies ScopeBoundaryRequest)
                await bumpWorkflowRevisionLocked(
                  ctx,
                  runtime,
                  value.workflowId,
                )
                return record
              },
            )

            return {
              content: renderToolOutput({
                authorized: true,
                continueChild: true,
                requestId: authorization.requestId,
                workflowId: authorization.workflowId,
                stepId: authorization.stepId,
                attempt: authorization.attempt,
                paths: authorization.patterns,
                rememberChoiceAllowed: false,
                requiredAction:
                  "Resume or redispatch the authorized child on this same step attempt. The authorization remains limited to these exact path patterns and expires with this step attempt; it is never remembered.",
              }),
            }
          } catch (error) {
            return {
              content: renderToolOutput({
                error: error instanceof Error ? error.message : String(error),
              }),
            }
          }
        },
      })

      addLoomTool({
        name: "git_ownership_recover",
        description:
          "Recover lost Git authorship provenance for exact current dirty bytes after a guard/runtime defect. General only and requires the exact latest user message as authorization. This does not edit, stage, or commit files; it adopts only current fingerprints for the target session's exact current step attempt inside its declared specialist scope.",
        input: {
          type: "object",
          properties: {
            workflowId: { type: "string" },
            stepId: { type: "string" },
            targetSessionId: { type: "string" },
            paths: { type: "array", items: { type: "string" } },
            reason: { type: "string" },
            confirmation: {
              type: "string",
              description: "Exact latest real user message explicitly authorizing recovery of these current files.",
            },
          },
          required: ["workflowId", "stepId", "targetSessionId", "paths", "reason", "confirmation"],
          additionalProperties: false,
        },
        options: { namespace: "loom", codemode: false },
        execute: async (input, tool) => {
          if (tool.agent !== "general") {
            return { content: renderToolOutput({ error: "Only general may recover Git authorship provenance." }) }
          }

          const value = input as {
            workflowId: string
            stepId: string
            targetSessionId: string
            paths: string[]
            reason: string
            confirmation: string
          }
          const observedUserMessage = (await ctx.storage.get(
            sessionUserMessageKey(tool.sessionID),
          )) as ObservedUserMessage | undefined
          if (!observedUserMessage) {
            return { content: renderToolOutput({ error: "No current observed user message is available to authorize Git ownership recovery." }) }
          }
          if (value.confirmation.trim() !== observedUserMessage.text.trim()) {
            return {
              content: renderToolOutput({
                error: "Git ownership recovery confirmation must match the latest observed user message exactly.",
                authorizationUserMessageId: observedUserMessage.messageId,
              }),
            }
          }

          let normalized: string[]
          try {
            normalized = [...new Set(value.paths.map(safeOwnedRepoPath))].sort()
            if (normalized.length === 0) throw new Error("Git ownership recovery paths must not be empty.")
          } catch (error) {
            return { content: renderToolOutput({ error: error instanceof Error ? error.message : String(error) }) }
          }

          const recoveryKey = gitOwnershipRecoveryAuthorizationKey(
            tool.sessionID,
            observedUserMessage.messageId,
          )
          const resources = [
            { aggregate: "workflow", resourceIdentity: value.workflowId },
            stepAuthorityResource(value.workflowId, value.stepId),
            { aggregate: "git-index", resourceIdentity: "__repository_index__" },
            {
              aggregate: "git-ownership-recovery",
              resourceIdentity: `${tool.sessionID}:${observedUserMessage.messageId}`,
            },
            ...normalized.map((path) => ({
              aggregate: "file-write",
              resourceIdentity: path,
            })),
          ]

          try {
            const recovered = await withRuntimeLocks(runtime, resources, async () => {
              const latestUserMessage = (await ctx.storage.get(
                sessionUserMessageKey(tool.sessionID),
              )) as ObservedUserMessage | undefined
              if (
                !latestUserMessage ||
                latestUserMessage.messageId !== observedUserMessage.messageId ||
                latestUserMessage.text.trim() !== value.confirmation.trim()
              ) {
                throw new Error("User authorization changed before Git ownership recovery could commit.")
              }

              const currentBinding = (await ctx.storage.get(sessionKey(tool.sessionID))) as string | undefined
              if (currentBinding !== value.workflowId) {
                throw new Error("General is no longer bound to this workflow.")
              }
              const workflow = await readWorkflow(ctx, value.workflowId)
              if (!workflow) throw new Error("Workflow not found.")
              const step = workflow.steps.find((candidate) => candidate.id === value.stepId)
              if (!step || step.status !== "pending" || !runnable(workflow).some((candidate) => candidate.id === step.id)) {
                throw new Error("Git ownership recovery requires the exact currently runnable pending step.")
              }

              const scope = (await ctx.storage.get(
                scopeKey(value.workflowId, value.stepId),
              )) as TaskScope | undefined
              const effectiveWrite = committableWriteScope(
                scope?.write.length
                  ? scope.write
                  : (artifactWriteDefaults[step.agent] ?? []),
              )
              if (
                effectiveWrite.length === 0 ||
                !resourcesWithinScope(normalized, effectiveWrite)
              ) {
                throw new Error(
                  "Git ownership recovery paths must all be inside the step's current committable Loom write scope.",
                )
              }
              if (!(await exactStepAttemptBinding(
                ctx,
                value.targetSessionId,
                value.workflowId,
                value.stepId,
              ))) {
                throw new Error("Target session is not attached to the exact current Loom step attempt.")
              }

              const staged = new Set(await stagedGitPaths(ctx.location.directory))
              const alreadyStaged = normalized.filter((path) => staged.has(path))
              if (alreadyStaged.length > 0) {
                throw new Error(
                  "Git ownership recovery refuses already-staged paths: " + alreadyStaged.join(", "),
                )
              }
              const dirty = new Set(await projectDirtyPaths(ctx.location.directory))
              const notDirty = normalized.filter((path) => !dirty.has(path))
              if (notDirty.length > 0) {
                throw new Error(
                  "Git ownership recovery requires current uncommitted changes for every path: " + notDirty.join(", "),
                )
              }

              const currentFingerprints = Object.fromEntries(
                await Promise.all(
                  normalized.map(async (path) => [
                    path,
                    await worktreeFingerprint(ctx.location.directory, path),
                  ] as const),
                ),
              )
              const prior = (await ctx.storage.get(recoveryKey)) as
                | {
                    workflowId: string
                    stepId: string
                    targetSessionId: string
                    paths: string[]
                    fingerprints: Record<string, string>
                    userMessageId: string
                    recoveredAt: string
                    reason: string
                  }
                | undefined

              if (prior) {
                const sameRequest =
                  prior.workflowId === value.workflowId &&
                  prior.stepId === value.stepId &&
                  prior.targetSessionId === value.targetSessionId &&
                  JSON.stringify(prior.paths) === JSON.stringify(normalized)
                if (!sameRequest) {
                  throw new Error("This user authorization was already used for a different Git ownership recovery.")
                }
                const changed = normalized.filter(
                  (path) => prior.fingerprints[path] !== currentFingerprints[path],
                )
                if (changed.length > 0) {
                  throw new Error(
                    "Recovered files changed after this user authorization: " + changed.join(", "),
                  )
                }
              } else {
                await ctx.storage.set(recoveryKey, {
                  workflowId: value.workflowId,
                  stepId: value.stepId,
                  targetSessionId: value.targetSessionId,
                  paths: normalized,
                  fingerprints: currentFingerprints,
                  userMessageId: observedUserMessage.messageId,
                  recoveredAt: new Date().toISOString(),
                  reason: value.reason,
                })
              }

              const ownership = await gitSessionOwnership(ctx, value.targetSessionId)
              ownership.paths = [...new Set([...ownership.paths, ...normalized])].sort()
              for (const path of normalized) {
                ownership.worktreeFingerprints[path] = currentFingerprints[path]
                delete ownership.stagedFingerprints[path]
              }
              await ctx.storage.set(
                gitSessionOwnershipKey(value.targetSessionId),
                ownership,
              )
              const recoveredBinding = await gitSessionOwnershipBinding(
                ctx,
                value.targetSessionId,
              )
              if (
                !recoveredBinding ||
                recoveredBinding.workflowId !== value.workflowId ||
                recoveredBinding.stepId !== value.stepId ||
                recoveredBinding.authorityId !== ownership.authorityId
              ) {
                throw new Error(
                  "Target session Git ownership authority changed before recovery could publish same-attempt provenance.",
                )
              }
              await recordGitStepAttemptOwnedFingerprints(
                ctx,
                recoveredBinding,
                value.targetSessionId,
                currentFingerprints,
              )
              return {
                paths: normalized,
                fingerprints: currentFingerprints,
                authorityId: ownership.authorityId,
                reusedAuthorization: Boolean(prior),
              }
            })

            return {
              content: renderToolOutput({
                recovered: true,
                workflowId: value.workflowId,
                stepId: value.stepId,
                targetSessionId: value.targetSessionId,
                authorizationUserMessageId: observedUserMessage.messageId,
                ...recovered,
                note: "Recovered authorship adopts the exact current uncommitted bytes; it does not assert that historical provenance survived the earlier guard defect.",
              }),
            }
          } catch (error) {
            return { content: renderToolOutput({ error: error instanceof Error ? error.message : String(error) }) }
          }
        },
      })

      addLoomTool({
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

      addLoomTool({
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


      addLoomTool({
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

      addLoomTool({
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


      addLoomTool({
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

      addLoomTool({
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

      addLoomTool({
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

      editor.namespace({
        name: "loom.code",
        description: "Code Mode mirrors of Loom control-plane tools. Same schemas, executors, authority, and workflow semantics as native loom_* tools.",
      })
      const nativeLoomTools = editor
        .list()
        .filter((tool) => tool.options?.namespace === "loom" && tool.options?.codemode === false)
      for (const tool of nativeLoomTools) {
        const { id: nativeId, ...definition } = tool
        editor.add({
          ...definition,
          options: {
            namespace: "loom.code",
            codemode: true,
            permission: tool.options?.permission ?? nativeId,
          },
        })
      }

    })

    const evaluatePermission = async (event: any) => {
      const delegationAction = event.action === "subagent"
      if (event.action === "edit" || event.action === "shell" || delegationAction) {
        await ensureLegacyCancellationBoundary(event.sessionID)
      }
      if (event.action === "edit" || event.action === "shell" || delegationAction) {
        const bound = await activeWorkflow(ctx, event.sessionID, ensureLegacySession)
        if (bound?.cancellation && bound.createdBySession !== event.sessionID) {
          event.effect = "deny"
          event.message = new WorkflowCancelledError(bound.id).message
          return
        }
      }
      if (event.action === "edit") {
        const classified = await Promise.all(
          event.resources.map((resource: string) =>
            classifyScopeTarget(ctx.location.directory, resource),
          ),
        )
        const hardBoundary = classified.filter(
          (entry) => entry.kind === "hard-boundary",
        )
        if (hardBoundary.length > 0) {
          if (hardBoundary.length !== classified.length) {
            event.effect = "deny"
            event.message =
              "Do not mix project-local and hard-boundary writes in one mutation. Split the mutation, call loom_scope_elevate for the hard-boundary path(s), and obey continue=false if returned."
            return
          }
          const agent = String(event.agent ?? "")
          if (agent === "general" || !loomAgents.has(agent)) {
            event.effect = "deny"
            event.message =
              "Hard-boundary writes require an explicit one-time user authorization tied to an attached child step; they are never remembered."
            return
          }
          const authorized = await useScopeBoundaryAuthorization(
            ctx,
            runtime,
            ctx.location.directory,
            event.sessionID,
            agent,
            event.resources,
          )
          if (!authorized) {
            event.effect = "deny"
            event.message =
              "Hard-boundary write denied. Call loom_scope_elevate with the exact requested path(s) and reason. If it returns continue=false, return control to General immediately; General must present the exact user approval menu before this step may resume."
            return
          }
          event.effect = "allow"
          return
        }
      }
      if (event.action === "edit") {
        const reportResources = event.resources.filter((resource: string) =>
          resourceMatchesScope(resource, "ephemeral-reports/**"),
        )
        const reportAgent = typeof event.agent === "string" ? event.agent : ""
        const commitMessageResources = reportResources.filter((resource: string) =>
          Boolean(commitMessageScratchPath(resource)),
        )
        if (commitMessageResources.length > 0) {
          if (commitMessageResources.length !== event.resources.length) {
            event.effect = "deny"
            event.message =
              "Do not mix commit-message scratch writes with other report or product mutations."
            return
          }
          if (
            !roleCanOwnRepositoryCommit(reportAgent) ||
            !commitMessageResources.every((resource: string) =>
              roleCommitMessagePath(reportAgent, resource),
            )
          ) {
            event.effect = "deny"
            event.message =
              "Commit-message scratch is available only to a role that can own the repository commit, inside that role's own namespace."
            return
          }
          if (reportAgent !== "general") {
            const workflowId = (await ctx.storage.get(
              sessionKey(event.sessionID),
            )) as string | undefined
            const stepId = (await ctx.storage.get(
              sessionStepKey(event.sessionID),
            )) as string | undefined
            if (
              !workflowId ||
              !stepId ||
              !(await exactRunnableStepAttemptBinding(
                ctx,
                event.sessionID,
                workflowId,
                stepId,
              ))
            ) {
              event.effect = "deny"
              event.message =
                "Commit-message scratch writes require the role's exact current runnable Loom step attempt."
              return
            }
            const declaredScope = (await ctx.storage.get(
              scopeKey(workflowId, stepId),
            )) as TaskScope | undefined
            const effectiveWrite = declaredScope?.write.length
              ? declaredScope.write
              : (artifactWriteDefaults[reportAgent] ?? [])
            if (committableWriteScope(effectiveWrite).length === 0) {
              event.effect = "deny"
              event.message =
                "Commit-message scratch writes require a current role/step with committable repository scope."
              return
            }
          }
          event.effect = "allow"
          return
        }
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
        if (
          reportResources.length > 0 &&
          reportResources.length === event.resources.length
        ) {
          // Ephemeral reports remain non-committable, but governed child steps
          // still honor their current write surface. Conversation-only report
          // producers (and General's own report namespace) keep the broader
          // role-owned report surface because no step scope exists there.
          if (reportAgent === "general") return

          const workflow = await activeWorkflow(
            ctx,
            event.sessionID,
            ensureLegacySession,
          )
          if (!workflow || workflowBindingTerminal(workflow)) return

          const attachedStepId = (await ctx.storage.get(
            sessionStepKey(event.sessionID),
          )) as string | undefined
          if (
            !attachedStepId ||
            !(await exactRunnableStepAttemptBinding(
              ctx,
              event.sessionID,
              workflow.id,
              attachedStepId,
            ))
          ) {
            event.effect = "deny"
            event.message =
              "Ephemeral report mutation requires a fresh attachment to the current runnable Loom step attempt."
            return
          }

          const declaredScope = (await ctx.storage.get(
            scopeKey(workflow.id, attachedStepId),
          )) as TaskScope | undefined
          const effectiveWrite = declaredScope?.write.length
            ? declaredScope.write
            : (artifactWriteDefaults[reportAgent] ?? [])
          if (
            effectiveWrite.length === 0 ||
            !resourcesWithinScope(reportResources, effectiveWrite)
          ) {
            event.effect = "deny"
            event.message =
              "Ephemeral report mutation is outside the current Loom write scope. Call loom_scope_elevate for the additional role-owned report path before retrying."
            return
          }
          return
        }
      }

      if (
        event.action === "edit" &&
        event.resources.some((resource: string) => resourceMatchesScope(resource, "docs/reports/**"))
      ) {
        event.effect = "deny"
        event.message =
          "Durable reports are promotion-only. Write operational reports under ephemeral-reports/ and use loom_report_promote when the report itself deserves durable retention."
        return
      }

      if (
        event.action === "shell" &&
        event.resources.some((resource: string) => resource.replaceAll("\\", "/").includes("docs/reports"))
      ) {
        event.effect = "deny"
        event.message =
          "Shell access to durable report storage is blocked. Use OKF-MCP to inspect reports and loom_report_promote for durable retention."
        return
      }

      if (
        event.action === "shell" &&
        event.resources.some((resource: string) => resource.replaceAll("\\", "/").includes("ephemeral-reports"))
      ) {
        const agent = String(event.agent ?? "")
        if (!shellUsesOwnedCommitMessageFile(event.resources, agent)) {
          event.effect = "deny"
          event.message =
            "Shell access to ephemeral report storage is blocked. The only exception is a hookless git commit using -F with the current role's ephemeral-reports/<role>/commit-messages/ scratch file."
          return
        }
      }

      if (event.action === "shell") {
        const gitAuthoring = event.resources.some((resource: string) =>
          isGitAuthoringShellCommand(resource),
        )
        const agent = String(event.agent ?? "")
        if (
          gitAuthoring &&
          (agent === "general" || loomAgents.has(agent))
        ) {
          let authorScope: string[]
          if (agent === "general") {
            authorScope = generalGitWriteScope
          } else {
            const workflowId = (await ctx.storage.get(
              sessionKey(event.sessionID),
            )) as string | undefined
            const stepId = (await ctx.storage.get(
              sessionStepKey(event.sessionID),
            )) as string | undefined
            if (
              !workflowId ||
              !stepId ||
              !(await exactRunnableStepAttemptBinding(
                ctx,
                event.sessionID,
                workflowId,
                stepId,
              ))
            ) {
              event.effect = "deny"
              event.message =
                "Git authoring requires the role's exact current runnable Loom step attempt."
              return
            }
            if (agent === "worker") {
              try {
                await assertWorkerWorkClaim(ctx, workflowId, stepId)
              } catch (error) {
                event.effect = "deny"
                event.message =
                  error instanceof Error ? error.message : String(error)
                return
              }
            }
            const declaredScope = (await ctx.storage.get(
              scopeKey(workflowId, stepId),
            )) as TaskScope | undefined
            authorScope = declaredScope?.write.length
              ? declaredScope.write
              : (artifactWriteDefaults[agent] ?? [])
          }

          authorScope = committableWriteScope(authorScope)
          if (authorScope.length === 0) {
            event.effect = "deny"
            event.message =
              "This step has no committable product write scope. Ephemeral report paths are intentionally non-committable; call loom_scope_elevate before Git authoring if product files are required."
            return
          }

          if (!authorGitShellResourcesAllowed(event.resources, authorScope)) {
            event.effect = "deny"
            event.message =
              "Git authoring is limited to explicit files inside the current committable Loom write scope; broad staging and other Git mutations remain blocked."
            return
          }
          const addTargets = event.resources.flatMap(
            (resource: string) => scopedGitAddTargets(resource) ?? [],
          )
          const stage = await resolveGitStagingOwnership(
            ctx,
            event.sessionID,
            ctx.location.directory,
            addTargets,
          )
          if (stage.unowned.length > 0) {
            event.effect = "deny"
            event.message =
              "Git staging denied: stage only exact bytes previously admitted by this current Loom step attempt: " +
              stage.unowned.join(", ")
            return
          }
          if (stage.changed.length > 0) {
            event.effect = "deny"
            event.message =
              "Git staging denied: these files changed after this step attempt's last admitted mutation: " +
              stage.changed.join(", ")
            return
          }
          if (
            event.resources.some((resource: string) =>
              isAllowedGitCommit(resource),
            )
          ) {
            const error = await commitScopeError(
              ctx,
              event.sessionID,
              ctx.location.directory,
              authorScope,
              true,
            )
            if (error) {
              event.effect = "deny"
              event.message = error
              return
            }
            if (agent === "reviewer") {
              const acceptanceError = await reviewerAcceptanceStagedCommitError(
                ctx,
                event.sessionID,
                ctx.location.directory,
              )
              if (acceptanceError) {
                event.effect = "deny"
                event.message = acceptanceError
                return
              }
            }
          }
          event.effect = "allow"
          return
        }
      }

      if (event.agent === "diagnostic" && event.action === "shell") {
        if (diagnosticShellResourcesAllowed(event.resources)) {
          event.effect = "allow"
          return
        }

        const workflowId = (await ctx.storage.get(
          sessionKey(event.sessionID),
        )) as string | undefined
        const stepId = (await ctx.storage.get(
          sessionStepKey(event.sessionID),
        )) as string | undefined
        const attached =
          Boolean(workflowId && stepId) &&
          await exactStepBinding(ctx, event.sessionID, workflowId!, stepId!)

        if (
          attached &&
          diagnosticExecutionShellResourcesAllowed(event.resources)
        ) {
          event.effect = "allow"
          return
        }

        event.effect = "deny"
        event.message =
          "Conversational Diagnostic shell is read-only. Arbitrary project execution is available only after attachment to a governed Diagnostic step; repository and delivery mutation remain denied."
        return
      }

      if (
        (event.agent === "research" || event.agent === "diagnostic") &&
        (event.action === "shell" || event.action === "edit")
      ) {
        const workflow = await activeWorkflow(ctx, event.sessionID, ensureLegacySession)
        const attachedStepId = (await ctx.storage.get(
          sessionStepKey(event.sessionID),
        )) as string | undefined

        // A reopened/rerouted governed step invalidates the old attachment
        // before any conversation-first exception is considered. Otherwise a
        // stale Research/Diagnostic child could fall back to its conversational
        // report surface instead of obtaining a fresh exact attempt grant.
        if (
          workflow &&
          attachedStepId &&
          !(await exactRunnableStepAttemptBinding(
            ctx,
            event.sessionID,
            workflow.id,
            attachedStepId,
          ))
        ) {
          event.effect = "deny"
          event.message =
            "Research/Diagnostic mutation requires a fresh attachment to the current runnable Loom step attempt."
          return
        }

        const conversational = !workflow || workflowBindingTerminal(workflow)

        if (conversational && event.action === "shell") {
          if (!shellResourcesAllowed(event.resources)) {
            event.effect = "deny"
            event.message =
              "Conversational Research/Diagnostic shell access is read-only: use Loom's safe inspection/verification commands and do not mutate product state."
          }
          return
        }

        if (conversational && event.action === "edit") {
          const reportScope = `ephemeral-reports/${event.agent}/**`
          if (
            event.resources.length > 0 &&
            event.resources.every((resource: string) => resourceMatchesScope(resource, reportScope))
          ) {
            return
          }
          event.effect = "deny"
          event.message =
            `Conversational ${event.agent} may only edit its own ${reportScope} report namespace; product/repository edits require governed execution.`
          return
        }
      }

      if (
        event.action === "edit" &&
        event.agent !== "general" &&
        event.agent !== "worker" &&
        loomAgents.has(String(event.agent ?? ""))
      ) {
        const agent = String(event.agent)
        const workflowId = (await ctx.storage.get(
          sessionKey(event.sessionID),
        )) as string | undefined
        const stepId = (await ctx.storage.get(
          sessionStepKey(event.sessionID),
        )) as string | undefined
        if (
          !workflowId ||
          !stepId ||
          !(await exactRunnableStepAttemptBinding(
            ctx,
            event.sessionID,
            workflowId,
            stepId,
          ))
        ) {
          event.effect = "deny"
          event.message =
            "Specialist mutation requires a fresh attachment to the exact current runnable Loom step attempt."
          return
        }

        const declaredScope = (await ctx.storage.get(
          scopeKey(workflowId, stepId),
        )) as TaskScope | undefined
        const effectiveWrite = declaredScope?.write.length
          ? declaredScope.write
          : (artifactWriteDefaults[agent] ?? [])
        if (
          effectiveWrite.length === 0 ||
          !resourcesWithinScope(event.resources, effectiveWrite)
        ) {
          event.effect = "deny"
          event.message =
            "Specialist edit is outside the current Loom write scope. Call loom_scope_elevate for the additional project-local path(s) before retrying. If that tool returns continue=false, return control immediately."
          return
        }
        return
      }

      if (event.agent === "worker" && event.action === "shell") {
        const workflowId = (await ctx.storage.get(sessionKey(event.sessionID))) as string | undefined
        const stepId = (await ctx.storage.get(sessionStepKey(event.sessionID))) as string | undefined
        if (!workflowId || !stepId) {
          event.effect = "deny"
          event.message = "Worker must call loom_attach before using shell execution."
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
        if (!workerShellResourcesAllowed(event.resources, scope?.write ?? [])) {
          event.effect = "deny"
          event.message =
            "Worker shell is limited to inspection, build/test/run, safe delivery operations, and writes already inside the current Loom scope. Call loom_scope_elevate before retrying a newly discovered project-local write target."
          return
        }

        const addTargets = event.resources.flatMap(
          (resource: string) => scopedGitAddTargets(resource) ?? [],
        )
        const ownership = await gitSessionOwnership(ctx, event.sessionID)
        if (
          addTargets.some(
            (target: string) =>
              !ownership.paths.includes(normalizeRepoPath(target)),
          )
        ) {
          event.effect = "deny"
          event.message =
            "Worker Git staging denied: stage only files authored by this task/session."
          return
        }

        const changedOwned = await changedOwnedPaths(
          ownership,
          ctx.location.directory,
          addTargets.filter((target: string) =>
            ownership.paths.includes(normalizeRepoPath(target)),
          ),
        )
        if (changedOwned.length > 0) {
          event.effect = "deny"
          event.message =
            "Worker mutation denied: these files changed after this task's last admitted mutation: " +
            changedOwned.join(", ")
          return
        }

        if (event.resources.some((resource: string) => isAllowedGitCommit(resource))) {
          if (!scope) {
            event.effect = "deny"
            event.message = "Worker Git commit requires a declared Loom task write scope."
            return
          }
          const error = await commitScopeError(
            ctx,
            event.sessionID,
            ctx.location.directory,
            scope.write,
          )
          if (error) {
            event.effect = "deny"
            event.message = error
            return
          }
        }

        event.effect = "allow"
        return
      }

      if (event.agent === "worker" && event.action === "edit") {
        const workflowId = (await ctx.storage.get(sessionKey(event.sessionID))) as string | undefined
        const stepId = (await ctx.storage.get(sessionStepKey(event.sessionID))) as string | undefined
        if (
          !workflowId ||
          !stepId ||
          !(await exactRunnableStepAttemptBinding(
            ctx,
            event.sessionID,
            workflowId,
            stepId,
          ))
        ) {
          event.effect = "deny"
          event.message =
            "Worker mutation requires the exact current runnable Loom step attempt; attach again after reopen/reroute."
          return
        }

        try {
          await assertWorkerWorkClaim(ctx, workflowId, stepId)
        } catch (error) {
          event.effect = "deny"
          event.message = error instanceof Error ? error.message : String(error)
          return
        }

        const scope = (await ctx.storage.get(
          scopeKey(workflowId, stepId),
        )) as TaskScope | undefined
        if (
          !scope?.write.length ||
          !resourcesWithinScope(event.resources, scope.write)
        ) {
          event.effect = "deny"
          event.message =
            "Worker edit is outside the current Loom write scope. Call loom_scope_elevate for the additional project-local path(s) before retrying. If that tool returns continue=false, return control immediately."
          return
        }
        return
      }

      if (event.agent !== "general" || !delegationAction) return

      const target = event.resources.find((resource: string) => loomAgents.has(resource))
      if (!target) return

      const workflow = await activeWorkflow(ctx, event.sessionID, ensureLegacySession)
      if (!workflow || workflowBindingTerminal(workflow)) {
        if (target === "research" || target === "diagnostic") {
          // Conversation-first boundary: a fresh session, or a session whose
          // previous workflow is terminal, may use Research/Diagnostic as
          // advisory non-mutating capabilities without reviving governed state.
          event.effect = "allow"
          return
        }
        event.effect = "deny"
        event.message =
          "Only conversational Research or Diagnostic may run without an active Loom workflow. Start and route governed execution before dispatching other Loom subagents."
        return
      }

      const questions = await readQuestions(ctx, workflow.id)
      const runnableSteps = runnable(workflow).filter((step) => step.agent === target)
      const openQuestions = questions.filter(
        (question) =>
          question.status !== "closed" &&
          !question.answer &&
          question.requiredAuthority === target,
      )

      if (runnableSteps.length === 0 && openQuestions.length === 0) {
        event.effect = "deny"
        event.message = `Agent ${target} is not runnable and has no unanswered OQ. Inspect loom_status.`
        return
      }

      const grantedTargets: Array<
        | { kind: "step"; step: (typeof runnableSteps)[number]; grant: NonNullable<Awaited<ReturnType<typeof findUsableDispatchGrant>>> }
        | { kind: "question"; question: (typeof openQuestions)[number]; grant: NonNullable<Awaited<ReturnType<typeof findUsableDispatchGrant>>> }
      > = []

      for (const step of runnableSteps) {
        const grant = await findUsableDispatchGrant(ctx.storage as any, runtime, {
          workflowId: workflow.id,
          stepId: step.id,
          expectedAgent: target,
          issuingParentSessionId: event.sessionID,
        })
        if (grant) grantedTargets.push({ kind: "step", step, grant })
      }

      for (const question of openQuestions) {
        const grant = await findUsableDispatchGrant(ctx.storage as any, runtime, {
          workflowId: workflow.id,
          oqId: question.id,
          expectedAgent: target,
          issuingParentSessionId: event.sessionID,
        })
        if (grant) grantedTargets.push({ kind: "question", question, grant })
      }

      if (grantedTargets.length === 0) {
        event.effect = "deny"
        event.message =
          `Issue loom_dispatch_grant for exactly one runnable ${target} step/OQ immediately before dispatch, then pass that grantId to the child.`
        return
      }

      if (grantedTargets.length > 1) {
        event.effect = "deny"
        event.message =
          `Multiple usable dispatch grants exist for ${target}; the dispatch target is ambiguous. Dispatch one exact granted target at a time.`
        return
      }

      const grantedTarget = grantedTargets[0]
      const runnableStep = grantedTarget.kind === "step" ? grantedTarget.step : undefined
      const openQuestion = grantedTarget.kind === "question" ? grantedTarget.question : undefined

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
        try {
          // Admission consumes the exact launch credential even when the
          // budget later denies this launch. That prevents a failed
          // pre-continuation grant from becoming stale authority after the
          // budget is extended.
          await admitDispatchGrantLocked(ctx.storage as any, runtime, {
            grantId: grantedTarget.grant.grantId,
            workflowId: workflow.id,
            ...(runnableStep ? { stepId: runnableStep.id } : { oqId: openQuestion!.id }),
            expectedAgent: target,
            issuingParentSessionId: event.sessionID,
            dispatchId: dispatchID,
          })
        } catch (error) {
          return {
            allowed: false as const,
            duplicate: false as const,
            reason: `Dispatch grant admission failed: ${error instanceof Error ? error.message : String(error)}`,
            state: budget,
          }
        }

        const result = recordDispatch({ state: budget, limits, dispatchID, key, agent: target })
        if (result.allowed) {
          await ctx.storage.set(budgetKey(workflow.id), budget)
          await bumpWorkflowRevisionLocked(ctx, runtime, workflow.id)
          dashboardPublisher.trigger()
        }
        return result
      })

      if (!recorded.allowed) {
        const reason = recorded.reason ?? "Unknown dispatch denial."
        event.effect = "deny"
        if (reason.startsWith("Dispatch grant admission failed:")) {
          event.message = `${reason} Issue a fresh exact loom_dispatch_grant before retrying.`
        } else {
          const blocked: BudgetBlockedTarget = {
            workflowId: workflow.id,
            agent: target,
            denialId: dispatchID,
            approvalRef: crypto.randomUUID().replaceAll("-", "").slice(0, 16),
            reason,
            blockedAt: new Date().toISOString(),
            ...(runnableStep ? { stepId: runnableStep.id } : { questionId: openQuestion!.id }),
          }
          const blockedKey = budgetContinuationTargetKey(
            event.sessionID,
            workflow.id,
            { stepId: blocked.stepId, questionId: blocked.questionId },
          )
          if (!blockedKey) throw new Error("Budget denial did not resolve to one exact target.")
          await ctx.storage.set(blockedKey, blocked)
          const question = budgetContinuationQuestionInput(blocked)
          event.message =
            `Loom execution budget exhausted: ${reason}. Preserve this workflow and exact target; do not duplicate the task or workflow. ` +
            `Ask the user with OpenCode\'s question tool using this exact payload: ${JSON.stringify(question)}. ` +
            `If they choose "${BUDGET_CONTINUATION_ALLOW}", call loom_budget_continue for this same target without confirmation. ` +
            `If they choose "${BUDGET_CONTINUATION_STOP}" or dismiss the question, stop at the resumable boundary.`
        }
        return
      }

      event.effect = "allow"
    }

    await ctx.permission.hook("evaluate", evaluatePermission)

    await ctx.session.hook("context", async (event) => {
      const raw = event as any
      const sessionID = typeof raw.sessionID === "string" ? raw.sessionID : ""
      const latestUser = latestObservedUserMessage(raw.messages)
      if (sessionID && latestUser) {
        await ctx.storage.set(sessionUserMessageKey(sessionID), {
          ...latestUser,
          observedAt: new Date().toISOString(),
        } satisfies ObservedUserMessage)
      }
      event.system.push({ type: "text", text: LOOM_NATIVE_TOOL_GUIDANCE })

      // Compatibility guidance is deliberately conditional and tiny. Detailed
      // one-shot migration instructions live behind loom_upgrade_status.
      if (sessionID) {
        try {
          const workflow = await activeWorkflow(ctx, sessionID, ensureLegacySession)
          if (
            !workflow ||
            workflow.createdBySession !== sessionID ||
            !workflow.work
          ) {
            return
          }
          const workBinding = workflow.work
          const work = await readWork(ctx, workBinding.objectiveId)
          const notice = upgradeCompatibilityNotice(objectiveUpgradeActions(work))
          if (notice) event.system.push({ type: "text", text: notice })
        } catch {
          // Dashboard/tool status remains the explicit inspection path. A
          // presentation-only notification must never block context assembly.
        }
      }
    })

    await ctx.session.hook("retry", (event) => {
      if (event.attempt >= 1 + DEFAULT_LIMITS.maxProviderRetries) {
        event.decision = { retry: false }
      }
    })

    await ctx.tool.hook("execute.before", async (event) => {
      const raw = event as any
      const tool = String(raw.tool ?? "")
      if (raw.sessionID) {
        await ensureLegacyCancellationBoundary(String(raw.sessionID))
        await assertCancelledChildToolAdmission(ctx.storage as any, tool, raw.input, String(raw.sessionID))
      }
      const mutationLockPaths = toolMutationLockPaths(
        tool,
        raw.input,
        ctx.location.directory,
      )
      const lockGitIndex = toolNeedsGitIndexLock(tool, raw.input)
      const directMutationPaths = successfulMutationPaths(
        tool,
        raw.input,
        ctx.location.directory,
      )

      await revalidateDirectMutationUnderLock(raw, directMutationPaths)

      if (tool === "question") {
        const sessionID = String(raw.sessionID ?? "").trim()
        if (!sessionID) {
          throw new Error("OpenCode question tool is reserved for admitted Loom General interactions.")
        }
        await dashboardPublisher.publish()

        const input = toolHookInput(raw)
        const [budgetMatches, scopeMatches] = await Promise.all([
          matchingActiveBudgetBlockedTargets(ctx, sessionID, input),
          matchingActiveScopeBoundaryRequests(ctx, sessionID, input),
        ])
        const totalMatches = budgetMatches.length + scopeMatches.length
        if (totalMatches !== 1) {
          throw new Error(
            totalMatches === 0
              ? "OpenCode question tool is reserved for the exact current Loom budget approval question or scope approval question."
              : "OpenCode question tool matched multiple active Loom approvals; refusing ambiguous user authority.",
          )
        }

        if (scopeMatches.length === 1) {
          const request = scopeMatches[0]
          const requestKey = scopeBoundaryRequestKey(sessionID, request.requestId)
          await withRuntimeLock(
            runtime,
            "scope-boundary-question-admission",
            `${sessionID}:${request.requestId}`,
            async () => {
              const current = (await ctx.storage.get(
                requestKey,
              )) as ScopeBoundaryRequest | undefined
              if (
                !current ||
                current.resolvedAt ||
                !matchesScopeBoundaryQuestion(input, current)
              ) {
                throw new Error("OpenCode scope-boundary question became stale before admission.")
              }
              if (current.questionStartedAt) {
                const sameOwner =
                  current.questionOwnerInstanceId === runtime.instanceId
                const ownerLive = current.questionOwnerInstanceId
                  ? await runtimeInstanceIsLive(
                      runtime,
                      current.questionOwnerInstanceId,
                    )
                  : false
                if (sameOwner || ownerLive) {
                  throw new Error(
                    "This Loom scope-boundary approval question is already active.",
                  )
                }
              }
              await ctx.storage.set(requestKey, {
                ...current,
                questionStartedAt: new Date().toISOString(),
                questionOwnerInstanceId: runtime.instanceId,
              } satisfies ScopeBoundaryRequest)
            },
          )
        } else {
          const blocked = budgetMatches[0]
          const blockedKey = budgetContinuationTargetKey(
            sessionID,
            blocked.workflowId,
            { stepId: blocked.stepId, questionId: blocked.questionId },
          )
          if (!blockedKey) {
            throw new Error("Budget question admission lost its exact target.")
          }
          await withRuntimeLock(
            runtime,
            "budget-continuation-question-admission",
            `${sessionID}:${blocked.denialId}`,
            async () => {
              const current = (await ctx.storage.get(
                blockedKey,
              )) as BudgetBlockedTarget | undefined
              if (
                !current ||
                current.denialId !== blocked.denialId ||
                current.resolvedAt ||
                !matchesBudgetContinuationQuestion(input, current)
              ) {
                throw new Error(
                  "OpenCode budget question became stale before admission.",
                )
              }
              if (current.questionStartedAt) {
                const sameOwner =
                  current.questionOwnerInstanceId === runtime.instanceId
                const ownerLive = current.questionOwnerInstanceId
                  ? await runtimeInstanceIsLive(
                      runtime,
                      current.questionOwnerInstanceId,
                    )
                  : false
                if (sameOwner || ownerLive) {
                  throw new Error(
                    "This Loom budget approval question is already active.",
                  )
                }
              }
              await ctx.storage.set(blockedKey, {
                ...current,
                questionStartedAt: new Date().toISOString(),
                questionOwnerInstanceId: runtime.instanceId,
              })
            },
          )
        }
      }
      const key = observationCallKey(raw)
      const mutationNeedsLock = mutationLockPaths.length > 0 || lockGitIndex
      if (mutationNeedsLock && !key) {
        throw new Error(
          "Write blocked: Loom could not establish a stable tool-call identity for write locking.",
        )
      }
      if (skipLoomEvidence(tool)) return
      if (!key) return
      // A duplicate in-flight identifier is ambiguous. Read-only evidence may
      // remain passive, but a second mutation must fail closed rather than
      // sharing the first call's lock identity.
      if (pendingObservations.has(key)) {
        pendingObservations.get(key)!.ambiguous = true
        if (mutationNeedsLock) {
          throw new Error(
            "Write blocked: this tool-call identity is already performing a mutation. Try again later.",
          )
        }
        return
      }
      // Reserve the key before awaiting storage so concurrent before events do
      // not overwrite each other's admission.
      const pending: {
        ambiguous: boolean; ready: boolean; inputDigest?: string
        summary?: ReturnType<typeof safeInputSummary>; admission?: EvidenceAdmission
        gitStageBefore?: GitStageSnapshot
      } = { ambiguous: false, ready: false }
      pendingObservations.set(key, pending)
      if (pendingObservations.size > 1024) pendingObservations.delete(pendingObservations.keys().next().value!)
      pending.admission = await captureEvidenceAdmission(ctx.storage as any, runtime, String(raw.sessionID), String(raw.agent ?? ""))
      pending.inputDigest = raw.input === undefined ? undefined : await digest(raw.input)
      pending.summary = safeInputSummary(tool, raw.input)
      pending.ready = true

      if (mutationNeedsLock) {
        try {
          await acquireGitWriteLocks(raw, mutationLockPaths, lockGitIndex)
          await revalidateDirectMutationUnderLock(raw, directMutationPaths)
          if (lockGitIndex) {
            await revalidateGitMutationUnderLock(raw)
            const command =
              raw.input && typeof raw.input === "object"
                ? (raw.input as any).command
                : undefined
            const addTargets =
              typeof command === "string"
                ? (scopedGitAddTargets(command) ?? [])
                : []
            if (addTargets.length > 0) {
              pending.gitStageBefore = await gitStageSnapshot(
                ctx.location.directory,
                addTargets,
              )
            }
          }
        } catch (error) {
          await releaseGitWriteLocks(raw)
          pendingObservations.delete(key)
          throw error
        }
      }
    })

    await ctx.tool.hook("execute.after", async (event) => {
      const raw = event as any
      const tool = String(raw.tool ?? "")
      if (!tool) return

      try {
      if (tool === "question" && raw.sessionID) {
        const sessionID = String(raw.sessionID)
        const input = toolHookInput(raw)
        const [budgetMatches, scopeMatches] = await Promise.all([
          matchingActiveBudgetBlockedTargets(ctx, sessionID, input),
          matchingActiveScopeBoundaryRequests(ctx, sessionID, input),
        ])

        if (scopeMatches.length === 1 && budgetMatches.length === 0) {
          const request = scopeMatches[0]
          const requestKey = scopeBoundaryRequestKey(
            sessionID,
            request.requestId,
          )
          if (raw.status === "error") {
            await withRuntimeLock(
              runtime,
              "scope-boundary-question-admission",
              `${sessionID}:${request.requestId}`,
              async () => {
                const current = (await ctx.storage.get(
                  requestKey,
                )) as ScopeBoundaryRequest | undefined
                if (current?.requestId === request.requestId && !current.resolvedAt) {
                  const {
                    questionStartedAt: _questionStartedAt,
                    questionOwnerInstanceId: _questionOwnerInstanceId,
                    ...retryable
                  } = current
                  await ctx.storage.set(requestKey, retryable)
                }
              },
            )
          } else {
            const decision = scopeBoundaryQuestionDecision(
              raw.result ??
                (raw.metadata ? { metadata: raw.metadata } : raw.output),
            )
            if (decision) {
              const callID = String(raw.callID ?? "").trim()
              const decidedAt = new Date().toISOString()
              await ctx.storage.set(
                scopeBoundaryDecisionKey(sessionID, request.requestId),
                {
                  requestId: request.requestId,
                  ...(callID ? { callID } : {}),
                  answer: decision.answer,
                  approved: decision.approved,
                  decidedAt,
                } satisfies ScopeBoundaryDecision,
              )
              if (!decision.approved) {
                await ctx.storage.set(requestKey, {
                  ...request,
                  resolvedAt: decidedAt,
                } satisfies ScopeBoundaryRequest)
              }
            } else {
              await withRuntimeLock(
                runtime,
                "scope-boundary-question-admission",
                `${sessionID}:${request.requestId}`,
                async () => {
                  const current = (await ctx.storage.get(
                    requestKey,
                  )) as ScopeBoundaryRequest | undefined
                  if (current?.requestId === request.requestId && !current.resolvedAt) {
                    const {
                      questionStartedAt: _questionStartedAt,
                      questionOwnerInstanceId: _questionOwnerInstanceId,
                      ...retryable
                    } = current
                    await ctx.storage.set(requestKey, retryable)
                  }
                },
              )
            }
          }
        } else if (budgetMatches.length === 1 && scopeMatches.length === 0) {
          const blocked = budgetMatches[0]
          const blockedKey = budgetContinuationTargetKey(
            sessionID,
            blocked.workflowId,
            { stepId: blocked.stepId, questionId: blocked.questionId },
          )
          if (blockedKey && raw.status === "error") {
            await withRuntimeLock(
              runtime,
              "budget-continuation-question-admission",
              `${sessionID}:${blocked.denialId}`,
              async () => {
                const current = (await ctx.storage.get(
                  blockedKey,
                )) as BudgetBlockedTarget | undefined
                if (
                  current?.denialId === blocked.denialId &&
                  !current.resolvedAt
                ) {
                  await ctx.storage.set(blockedKey, {
                    ...current,
                    resolvedAt: new Date().toISOString(),
                  })
                }
              },
            )
          } else if (raw.status !== "error") {
            const decision = budgetQuestionDecision(
              raw.result ??
                (raw.metadata ? { metadata: raw.metadata } : raw.output),
            )
            if (decision) {
              const callID = String(raw.callID ?? "").trim()
              const decidedAt = new Date().toISOString()
              await ctx.storage.set(
                sessionBudgetQuestionDecisionKey(
                  sessionID,
                  blocked.denialId,
                ),
                {
                  workflowId: blocked.workflowId,
                  agent: blocked.agent,
                  ...(blocked.stepId ? { stepId: blocked.stepId } : {}),
                  ...(blocked.questionId
                    ? { questionId: blocked.questionId }
                    : {}),
                  approvalRef: blocked.approvalRef,
                  denialId: blocked.denialId,
                  ...(callID ? { callID } : {}),
                  answer: decision.answer,
                  approved: decision.approved,
                  decidedAt,
                } satisfies BudgetQuestionDecision,
              )
              if (!decision.approved && blockedKey) {
                await ctx.storage.set(blockedKey, {
                  ...blocked,
                  resolvedAt: decidedAt,
                })
              }
            } else if (blockedKey) {
              await withRuntimeLock(
                runtime,
                "budget-continuation-question-admission",
                `${sessionID}:${blocked.denialId}`,
                async () => {
                  const current = (await ctx.storage.get(
                    blockedKey,
                  )) as BudgetBlockedTarget | undefined
                  if (
                    current?.denialId === blocked.denialId &&
                    !current.resolvedAt
                  ) {
                    const {
                      questionStartedAt: _questionStartedAt,
                      questionOwnerInstanceId: _questionOwnerInstanceId,
                      ...retryable
                    } = current
                    await ctx.storage.set(blockedKey, retryable)
                  }
                },
              )
            }
          }
        }
      }

      // Dashboard publication is read-only and failure-isolated. Trigger after
      // Loom/control activity before evidence filtering so control-plane state
      // changes become visible without turning projection into a dependency.
      dashboardPublisher.trigger()

      if (skipLoomEvidence(tool)) return
      if (!raw.sessionID) return

      const key = observationCallKey(raw)
      const matched = key ? pendingObservations.get(key) : undefined
      if (key) pendingObservations.delete(key)
      const pending = matched?.ready && !matched.ambiguous ? matched : undefined
      const input = raw.input
      const inputDigest = input === undefined ? undefined : await digest(input)
      const eventMatches = Boolean(pending) && inputDigest === pending!.inputDigest

      if (
        raw.agent === "general" &&
        eventMatches
      ) {
        const generalScope = generalGitWriteScope
        const sessionID = String(raw.sessionID)

        if (raw.status === "completed") {
          const mutationPaths = successfulMutationPaths(
            tool,
            input,
            ctx.location.directory,
          )
          const owned = mutationPaths.filter(
            (path) =>
              !isAbsolute(path) &&
              resourcesWithinScope([path], generalScope),
          )
          if (owned.length > 0) {
            await recordGitSessionOwnership(
              ctx,
              sessionID,
              ctx.location.directory,
              owned,
            )
          }
          const commitMessageOwned = mutationPaths.filter((path) =>
            roleCommitMessagePath("general", path),
          )
          if (commitMessageOwned.length > 0) {
            await recordGitSessionOwnership(
              ctx,
              sessionID,
              ctx.location.directory,
              commitMessageOwned,
              false,
            )
          }
        }

        if (tool === "shell" || tool === "bash") {
          const command =
            input && typeof input === "object"
              ? (input as any).command
              : undefined
          const staged =
            typeof command === "string"
              ? (scopedGitAddTargets(command) ?? []).filter((path) =>
                  resourcesWithinScope([path], generalScope),
                )
              : []
          await recordGitSessionStagingResult(
            ctx,
            sessionID,
            ctx.location.directory,
            staged,
            String(raw.status ?? ""),
            pending?.gitStageBefore,
          )
          if (
            raw.status === "completed" &&
            typeof command === "string" &&
            isAllowedGitCommit(command)
          ) {
            await clearGitSessionStaging(ctx, sessionID)
            const messageFile = gitCommitMessageFile(command)
            if (messageFile) {
              await consumeCommitMessageFile(
                ctx,
                sessionID,
                ctx.location.directory,
                messageFile,
              )
            }
          }
        }
      }

      if (
        raw.agent &&
        eventMatches &&
        pending?.admission
      ) {
        const admission = pending.admission
        const sessionID = String(raw.sessionID)
        const currentWorkflowId = await ctx.storage.get(sessionKey(sessionID))
        const currentStepId = await ctx.storage.get(sessionStepKey(sessionID))
        const currentAttachmentId = await ctx.storage.get(
          sessionAttachmentKey(sessionID),
        )
        const currentWorkflow =
          currentWorkflowId === admission.workflowId
            ? await readWorkflow(ctx, admission.workflowId)
            : undefined
        const currentStep = currentWorkflow?.steps.find(
          (step) => step.id === admission.stepId,
        )
        const sameExecutionAuthority =
          currentWorkflowId === admission.workflowId &&
          currentStepId === admission.stepId &&
          currentAttachmentId === admission.attachmentId &&
          raw.agent === admission.agent &&
          (currentStep?.attempt ?? 0) === admission.attempt

        if (sameExecutionAuthority) {
          const declaredScope = (await ctx.storage.get(
            scopeKey(admission.workflowId, admission.stepId),
          )) as TaskScope | undefined
          const defaultScope =
            artifactWriteDefaults[String(raw.agent)] ?? []
          const writeScope = committableWriteScope(
            declaredScope?.write.length
              ? declaredScope.write
              : defaultScope,
          )

          if (raw.status === "completed") {
            const commitMessageOwned = successfulMutationPaths(
              tool,
              input,
              ctx.location.directory,
            ).filter((path) =>
              roleCommitMessagePath(String(raw.agent), path),
            )
            if (commitMessageOwned.length > 0) {
              await recordGitSessionOwnership(
                ctx,
                sessionID,
                ctx.location.directory,
                commitMessageOwned,
                false,
              )
            }
          }

          if (writeScope.length) {
            if (raw.status === "completed") {
              const owned = successfulMutationPaths(
                tool,
                input,
                ctx.location.directory,
              ).filter(
                (path) =>
                  !isAbsolute(path) &&
                  resourcesWithinScope([path], writeScope!),
              )
              if (owned.length > 0) {
                await recordGitSessionOwnership(
                  ctx,
                  sessionID,
                  ctx.location.directory,
                  owned,
                )
              }
            }

            if (tool === "shell" || tool === "bash") {
              const command =
                input && typeof input === "object"
                  ? (input as any).command
                  : undefined
              const staged =
                typeof command === "string"
                  ? (scopedGitAddTargets(command) ?? []).filter((path) =>
                      resourcesWithinScope([path], writeScope!),
                    )
                  : []
              await recordGitSessionStagingResult(
                ctx,
                sessionID,
                ctx.location.directory,
                staged,
                String(raw.status ?? ""),
                pending.gitStageBefore,
              )
              if (
                raw.status === "completed" &&
                typeof command === "string" &&
                isAllowedGitCommit(command)
              ) {
                await clearGitSessionStaging(ctx, sessionID)
                const messageFile = gitCommitMessageFile(command)
                if (messageFile) {
                  await consumeCommitMessageFile(
                    ctx,
                    sessionID,
                    ctx.location.directory,
                    messageFile,
                  )
                }
              }
            }
          }
        }
      }

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

      const summary = pending?.summary ?? safeInputSummary(tool, input)
      const returnedResult = raw.result ?? raw.output
      const reportedError =
        raw.status === "completed" ? safeResultError(returnedResult) : undefined
      const resultSummary =
        raw.status === "completed" && !reportedError ? safeResultSummary(tool, returnedResult) : {}
      let reportPromotion: EvidenceObservation["reportPromotion"]
      const loomTool = loomToolLeaf(tool)
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
        status: raw.status === "error" || reportedError ? "error" : "completed",
        observedAt: new Date().toISOString(),
        ...((pending?.inputDigest ?? inputDigest) === undefined ? {} : { inputDigest: pending?.inputDigest ?? inputDigest }),
        ...(raw.status === "completed" ? { resultDigest: await digest(raw.result) } : {}),
        ...(raw.status === "error"
          ? { error: String(raw.error?.message ?? raw.error ?? "tool error").slice(0, 1000) }
          : reportedError
            ? { error: reportedError }
            : {}),
        ...summary,
        ...resultSummary,
        ...(reportPromotion ? { reportPromotion } : {}),
        ...(!eventMatches && pending ? { unscopedReason: "input-changed" } : {}),
      }

      await persistEvidenceObservation(ctx.storage as any, runtime, observation, pending?.admission)
      } finally {
        await releaseGitWriteLocks(raw)
      }
    })
  },
}

export default loomPlugin
