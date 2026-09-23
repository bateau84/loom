import { createHash } from "node:crypto"
import { chmod, mkdir, open, readFile, readdir, rename, unlink } from "node:fs/promises"
import { basename, dirname, isAbsolute, join } from "node:path"
import { homedir } from "node:os"
import { acceptanceReadiness, type AcceptancePlan } from "./acceptance"
import type { BudgetState, ExecutionLimits } from "./budget"
import { buildDashboardWorkflowContext, type DashboardWorkflowContext } from "./dashboard-context"
import type { KnowledgeReport } from "./knowledge"
import type { OpenQuestion } from "./oq"
import type { LoomRuntimeIdentity, RawStorage } from "./runtime"
import { runnable, type Step, type Workflow } from "./workflow"
import type { WorkHierarchy, WorkNode, WorkNodeStatus } from "./work"

export const DASHBOARD_SCHEMA_VERSION = 1
export const DEFAULT_DASHBOARD_LEASE_MS = 90_000
export const DEFAULT_DASHBOARD_HEARTBEAT_MS = 30_000

export type StepSummary = Pick<Step, "id" | "agent" | "kind" | "status"> & {
  label?: string
}

export type ProgressSummary = {
  complete: number
  total: number
  blocked?: number
  active?: number
  failed?: number
}

export type WorkTaskProjectionV1 = {
  taskId: string
  title: string
  status: WorkNodeStatus
  claimedByWorkflowId?: string
}

export type WorkWaveProjectionV1 = {
  waveId: string
  title?: string
  status: WorkNodeStatus
  tasks: WorkTaskProjectionV1[]
}

export type WorkPhaseProjectionV1 = {
  phaseId: string
  title?: string
  status: WorkNodeStatus
  waves: WorkWaveProjectionV1[]
}

export type WorkObjectiveProjectionV1 = {
  objectiveId: string
  anchor?: string
  title?: string
  status: WorkNodeStatus
  workVersion: number
  generation: number
  stateDigest: string
  phases: WorkPhaseProjectionV1[]
}

export type WorkflowProjectionV1 = {
  workflowId: string
  workflowRevision: number
  stateDigest: string
  workScope?: {
    objectiveId: string
    generation: number
    phaseId?: string
    waveId?: string
    taskIds?: string[]
  }
  anchor?: string
  executionStage?: string
  status: "active" | "blocked" | "failed" | "complete" | "cancelled"
  currentSteps: StepSummary[]
  runnableSteps: StepSummary[]
  hierarchyProgress?: {
    objective?: ProgressSummary
    phases?: ProgressSummary
    waves?: ProgressSummary
    tasks?: ProgressSummary
  }
  openOqCount: number
  openVerificationCount: number
  budget: {
    used?: number
    limit?: number
    exhausted: boolean
  }
  productAcceptance?: {
    status: string
    passed?: number
    failed?: number
    unproven?: number
  }
  knowledgeSync?: {
    valid: boolean
    updatedAt?: string
  }
  recentActivityAt: string
  participatingSessionIds: string[]
  activeAgent?: string
  activeSessionId?: string
  context?: DashboardWorkflowContext
}

export type ProjectSnapshotV1 = {
  schemaVersion: 1
  installationId: string
  instanceId: string
  projectId: string
  generation: number
  generatedAt: string
  leaseExpiresAt: string
  project: {
    displayName?: string
    canonicalLocation: string
  }
  projectionWindow: {
    workflowsTruncated: boolean
    completedObjectivesTruncated: boolean
  }
  workObjectives: WorkObjectiveProjectionV1[]
  workflows: WorkflowProjectionV1[]
  enrichment?: {
    status: "available" | "partial" | "unavailable"
    sourceSchema?: string
    errorSummary?: string
    sessions: unknown[]
  }
}

export type InstanceManifestV1 = {
  schemaVersion: 1
  installationId: string
  instanceId: string
  processId?: number
  startedAt: string
  generatedAt: string
  leaseExpiresAt: string
  projects: string[]
}

export type PublisherRecord = {
  manifest: InstanceManifestV1
  snapshot: ProjectSnapshotV1
}

export type AggregatedParticipant = {
  installationId: string
  instanceId: string
  live: boolean
  workflowRevision: number
  generation: number
  leaseExpiresAt: string
}

export type AggregatedWorkflow = {
  projectId: string
  workflowId: string
  workflowRevision: number
  consistency: "ok" | "conflict"
  sourceFreshness: "live" | "stale-source"
  participants: AggregatedParticipant[]
  projection?: WorkflowProjectionV1
  conflictCandidates?: WorkflowProjectionV1[]
}

export type AggregatedWorkObjective = {
  objectiveId: string
  workVersion: number
  consistency: "ok" | "conflict"
  sourceFreshness: "live" | "stale-source"
  projection?: WorkObjectiveProjectionV1
  conflictCandidates?: WorkObjectiveProjectionV1[]
}

export type FleetProject = {
  projectId: string
  displayName?: string
  canonicalLocation: string
  workflows: AggregatedWorkflow[]
  workObjectives: AggregatedWorkObjective[]
}

export type FleetSnapshot = {
  generatedAt: string
  projects: FleetProject[]
}

type PublisherOptions = {
  leaseMs?: number
  maxWorkflows?: number
  maxObjectives?: number
}

function sortedObject(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortedObject)
  if (!value || typeof value !== "object") return value
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([, child]) => child !== undefined)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, child]) => [key, sortedObject(child)]),
  )
}

export function canonicalJson(value: unknown) {
  return JSON.stringify(sortedObject(value))
}

export function projectionDigest(value: unknown) {
  return createHash("sha256").update(canonicalJson(value)).digest("hex")
}

async function scanEntries(storage: RawStorage, prefix: string, max = 5000) {
  const entries: Array<{ key: string; value: unknown }> = []
  let after: string | undefined
  do {
    const page = await storage.scan({ prefix, limit: Math.min(200, max - entries.length), ...(after ? { after } : {}) })
    entries.push(...(page.entries ?? []))
    after = page.next
  } while (after && entries.length < max)
  return entries.slice(0, max)
}

function parseSessionId(key: string) {
  const marker = "/session/"
  const index = key.lastIndexOf(marker)
  if (index >= 0) return key.slice(index + marker.length)
  return key.startsWith("session/") ? key.slice("session/".length) : key
}

function summary(step: Step): StepSummary {
  return {
    id: step.id,
    agent: step.agent,
    kind: step.kind,
    status: step.status,
    ...(step.task?.title ? { label: step.task.title } : {}),
  }
}

function workflowStatus(workflow: Workflow) {
  if (workflow.cancellation) return "cancelled" as const
  if (workflow.steps.some((step) => step.status === "failed")) return "failed" as const
  const pending = workflow.steps.filter((step) => step.status === "pending")
  if (pending.length === 0) return "complete" as const
  if (runnable(workflow).length === 0) return "blocked" as const
  return "active" as const
}

function progress(nodes: WorkNode[]): ProgressSummary {
  const total = nodes.length
  const complete = nodes.filter((node) => node.status === "complete").length
  const blocked = nodes.filter((node) => node.status === "blocked").length
  const active = nodes.filter((node) => node.status === "active").length
  return {
    complete,
    total,
    ...(blocked ? { blocked } : {}),
    ...(active ? { active } : {}),
  }
}

function hierarchyProgress(work?: WorkHierarchy) {
  if (!work) return undefined
  const nodes = work.nodes.filter((node) => node.generation === work.generation)
  return {
    objective: {
      complete: work.objectiveStatus === "complete" ? 1 : 0,
      total: 1,
      ...(work.objectiveStatus === "blocked" ? { blocked: 1 } : {}),
      ...(work.objectiveStatus === "active" ? { active: 1 } : {}),
    },
    phases: progress(nodes.filter((node) => node.type === "phase")),
    waves: progress(nodes.filter((node) => node.type === "wave")),
    tasks: progress(nodes.filter((node) => node.type === "task")),
  }
}

function workScope(workflow: Workflow, work?: WorkHierarchy) {
  if (!workflow.work) return undefined
  if (!work || work.generation !== workflow.work.generation) {
    return {
      objectiveId: workflow.work.objectiveId,
      generation: workflow.work.generation,
    }
  }
  const nodes = work.nodes.filter((node) => node.generation === work.generation)
  const tasks = nodes.filter(
    (node) => node.type === "task" && node.claimedByWorkflowId === workflow.id,
  )
  const wave = tasks.length
    ? nodes.find((node) => node.type === "wave" && node.id === tasks[0].parentId)
    : undefined
  const phase = wave
    ? nodes.find((node) => node.type === "phase" && node.id === wave.parentId)
    : undefined
  return {
    objectiveId: workflow.work.objectiveId,
    generation: workflow.work.generation,
    ...(phase ? { phaseId: phase.logicalId } : {}),
    ...(wave ? { waveId: wave.logicalId } : {}),
    ...(tasks.length ? { taskIds: tasks.map((task) => task.logicalId).sort() } : {}),
  }
}

function latestTimestamp(values: Array<string | undefined>, fallback: string) {
  return values.filter((value): value is string => Boolean(value)).sort().at(-1) ?? fallback
}

function projectWork(work: WorkHierarchy): WorkObjectiveProjectionV1 {
  const nodes = work.nodes.filter((node) => node.generation === work.generation)
  const phases = nodes
    .filter((node) => node.type === "phase")
    .map((phase) => ({
      phaseId: phase.logicalId,
      title: phase.title,
      status: phase.status,
      waves: nodes
        .filter((node) => node.type === "wave" && node.parentId === phase.id)
        .map((wave) => ({
          waveId: wave.logicalId,
          title: wave.title,
          status: wave.status,
          tasks: nodes
            .filter((node) => node.type === "task" && node.parentId === wave.id)
            .map((task) => ({
              taskId: task.logicalId,
              title: task.title,
              status: task.status,
              ...(task.claimedByWorkflowId
                ? { claimedByWorkflowId: task.claimedByWorkflowId }
                : {}),
            })),
        })),
    }))
  const body = {
    objectiveId: work.objectiveId,
    anchor: work.anchor,
    title: work.title,
    status: work.objectiveStatus,
    workVersion: work.version,
    generation: work.generation,
    phases,
  }
  return { ...body, stateDigest: projectionDigest(body) }
}

async function workflowProjection(
  storage: RawStorage,
  workflow: Workflow,
  work: WorkHierarchy | undefined,
  sessionEntries: Array<{ key: string; value: unknown }>,
): Promise<WorkflowProjectionV1> {
  const [questions, budget, limits, acceptance, knowledge] = await Promise.all([
    scanEntries(storage, `oq/${workflow.id}/`, 1000),
    storage.get(`budget/${workflow.id}`) as Promise<BudgetState | undefined>,
    storage.get(`limits/${workflow.id}`) as Promise<ExecutionLimits | undefined>,
    storage.get(`acceptance/${workflow.id}`) as Promise<AcceptancePlan | undefined>,
    storage.get(`knowledge/${workflow.id}`) as Promise<KnowledgeReport | undefined>,
  ])
  const ready = runnable(workflow)
  const participants = sessionEntries
    .filter((entry) => entry.value === workflow.id)
    .map((entry) => parseSessionId(entry.key))
    .sort()
  const scenarios = acceptance?.scenarios ?? []
  const questionValues = questions
    .map((entry) => entry.value as OpenQuestion)
    .filter((question): question is OpenQuestion => Boolean(question?.id) && question.workflowId === workflow.id)
  const recentActivityAt = latestTimestamp(
    [
      workflow.createdAt,
      workflow.cancellation?.at,
      work?.updatedAt,
      knowledge?.recordedAt,
      ...scenarios.map((scenario) => scenario.recordedAt),
      ...questionValues.flatMap((question) => [
        question.createdAt,
        question.answer?.at,
        question.reopened?.at,
        ...Object.values(question.reconciliations ?? {}).map((reconciliation) => reconciliation.at),
      ]),
      ...(workflow.verification ?? []).flatMap((requirement) => [
        requirement.createdAt,
        requirement.proof?.provedAt,
      ]),
      ...(budget?.grants ?? []).map((grant) => grant.grantedAt),
    ],
    workflow.createdAt,
  )
  const body = {
    workflowId: workflow.id,
    workflowRevision: workflow.revision,
    ...(workflow.work ? { workScope: workScope(workflow, work) } : {}),
    anchor: workflow.anchor,
    ...(ready[0] ? { executionStage: `${ready[0].agent}:${ready[0].id}` } : {}),
    status: workflowStatus(workflow),
    currentSteps: ready.map(summary),
    runnableSteps: ready.map(summary),
    ...(work ? { hierarchyProgress: hierarchyProgress(work) } : {}),
    openOqCount: questionValues.filter((question) => question.status !== "closed").length,
    openVerificationCount: (workflow.verification ?? []).filter(
      (requirement) => requirement.status === "open",
    ).length,
    budget: {
      ...(budget ? { used: budget.totalDispatches } : {}),
      ...(limits ? { limit: limits.maxTotalDispatches } : {}),
      exhausted: Boolean(budget?.exhausted),
    },
    ...(acceptance
      ? {
          productAcceptance: {
            status: acceptanceReadiness(acceptance),
            passed: scenarios.filter((scenario) => scenario.outcome === "passed").length,
            failed: scenarios.filter((scenario) => scenario.outcome === "failed").length,
            unproven: scenarios.filter((scenario) => scenario.outcome === "unproven").length,
          },
        }
      : {}),
    ...(knowledge
      ? { knowledgeSync: { valid: knowledge.valid, updatedAt: knowledge.recordedAt } }
      : {}),
    recentActivityAt,
    participatingSessionIds: participants,
    ...(ready[0] ? { activeAgent: ready[0].agent } : {}),
    ...(participants[0] ? { activeSessionId: participants[0] } : {}),
    context: buildDashboardWorkflowContext(workflow, questionValues, participants, questions.length >= 1000),
  }
  return { ...body, stateDigest: projectionDigest(body) }
}

export async function buildProjectSnapshot(
  storage: RawStorage,
  runtime: LoomRuntimeIdentity,
  generation: number,
  options: PublisherOptions = {},
  now = new Date(),
): Promise<ProjectSnapshotV1> {
  const maxWorkflows = options.maxWorkflows ?? 100
  const maxObjectives = options.maxObjectives ?? 50
  const generatedAt = now.toISOString()
  const leaseExpiresAt = new Date(now.getTime() + (options.leaseMs ?? DEFAULT_DASHBOARD_LEASE_MS)).toISOString()
  const [workflowEntries, workEntries, sessionEntries] = await Promise.all([
    scanEntries(storage, "workflow/", Math.max(maxWorkflows * 4, 200)),
    scanEntries(storage, "work/", Math.max(maxObjectives * 4, 100)),
    scanEntries(storage, "session/", 5000),
  ])
  const workById = new Map(
    workEntries
      .map((entry) => entry.value as WorkHierarchy)
      .filter((work) => Boolean(work?.objectiveId))
      .map((work) => [work.objectiveId, work] as const),
  )
  const allWorkflows = workflowEntries
    .map((entry) => entry.value as Workflow)
    .filter((workflow) => Boolean(workflow?.id))
    .sort((a, b) => b.revision - a.revision || a.id.localeCompare(b.id))

  const claimedWorkflowIds = new Set(
    [...workById.values()].flatMap((work) =>
      work.nodes
        .filter(
          (node) =>
            node.generation === work.generation &&
            typeof node.claimedByWorkflowId === "string",
        )
        .map((node) => node.claimedByWorkflowId!),
    ),
  )
  const requiredWorkflows = allWorkflows.filter(
    (workflow) =>
      !["complete", "cancelled"].includes(workflowStatus(workflow)) ||
      claimedWorkflowIds.has(workflow.id),
  )
  const requiredWorkflowIds = new Set(requiredWorkflows.map((workflow) => workflow.id))
  const recentTerminalWorkflows = allWorkflows.filter(
    (workflow) => !requiredWorkflowIds.has(workflow.id),
  )
  const selectedWorkflows = [
    ...requiredWorkflows,
    ...recentTerminalWorkflows.slice(0, Math.max(0, maxWorkflows - requiredWorkflows.length)),
  ]
  const workflows = await Promise.all(
    selectedWorkflows.map((workflow) =>
      workflowProjection(
        storage,
        workflow,
        workflow.work ? workById.get(workflow.work.objectiveId) : undefined,
        sessionEntries,
      ),
    ),
  )

  const allObjectives = [...workById.values()]
    .sort((a, b) => b.version - a.version || a.objectiveId.localeCompare(b.objectiveId))
  const requiredObjectives = allObjectives.filter(
    (work) =>
      !["complete", "cancelled", "superseded"].includes(work.objectiveStatus),
  )
  const requiredObjectiveIds = new Set(requiredObjectives.map((work) => work.objectiveId))
  const recentTerminalObjectives = allObjectives.filter(
    (work) => !requiredObjectiveIds.has(work.objectiveId),
  )
  const selectedObjectiveRecords = [
    ...requiredObjectives,
    ...recentTerminalObjectives.slice(0, Math.max(0, maxObjectives - requiredObjectives.length)),
  ]
  const selectedObjectives = selectedObjectiveRecords.map(projectWork)
  return {
    schemaVersion: 1,
    installationId: runtime.installationId,
    instanceId: runtime.instanceId,
    projectId: runtime.projectId,
    generation,
    generatedAt,
    leaseExpiresAt,
    project: {
      displayName: basename(runtime.canonicalLocation),
      canonicalLocation: runtime.canonicalLocation,
    },
    projectionWindow: {
      workflowsTruncated: allWorkflows.length > selectedWorkflows.length,
      completedObjectivesTruncated: allObjectives.length > selectedObjectives.length,
    },
    workObjectives: selectedObjectives,
    workflows,
  }
}

async function syncDirectory(path: string) {
  const handle = await open(path, "r")
  try {
    await handle.sync()
  } finally {
    await handle.close()
  }
}

async function atomicWriteJson(path: string, value: unknown) {
  const directory = dirname(path)
  await mkdir(directory, { recursive: true, mode: 0o700 })
  await chmod(directory, 0o700)
  const temp = `${path}.tmp-${process.pid}-${crypto.randomUUID()}`
  const handle = await open(temp, "wx", 0o600)
  let replaced = false
  try {
    await handle.writeFile(JSON.stringify(value, null, 2) + "\n", "utf8")
    await handle.sync()
  } finally {
    await handle.close()
  }
  try {
    await rename(temp, path)
    replaced = true
    await syncDirectory(directory)
  } finally {
    if (!replaced) await unlink(temp).catch(() => {})
  }
}

export function createDashboardPublisher(
  storage: RawStorage,
  runtime: LoomRuntimeIdentity,
  options: PublisherOptions = {},
) {
  const startedAt = new Date().toISOString()
  let generation = 0
  let queue: Promise<ProjectSnapshotV1 | undefined> = Promise.resolve(undefined)
  let lastError: string | undefined

  const publishOnce = async () => {
    generation += 1
    const snapshot = await buildProjectSnapshot(storage, runtime, generation, options)
    const root = join(
      runtime.runtimeRoot,
      "instances",
      runtime.installationId,
      runtime.instanceId,
    )
    const projectPath = join(root, "projects", `${runtime.projectId}.json`)
    const manifest: InstanceManifestV1 = {
      schemaVersion: 1,
      installationId: runtime.installationId,
      instanceId: runtime.instanceId,
      processId: process.pid,
      startedAt,
      generatedAt: snapshot.generatedAt,
      leaseExpiresAt: snapshot.leaseExpiresAt,
      projects: [runtime.projectId],
    }
    await atomicWriteJson(projectPath, snapshot)
    await atomicWriteJson(join(root, "manifest.json"), manifest)
    lastError = undefined
    return snapshot
  }

  const publish = () => {
    const next = queue.then(publishOnce, publishOnce)
    queue = next.catch((error) => {
      lastError = error instanceof Error ? error.message : String(error)
      return undefined
    })
    return next
  }

  const trigger = () => {
    void publish().catch((error) => {
      lastError = error instanceof Error ? error.message : String(error)
    })
  }

  const startHeartbeat = (heartbeatMs = DEFAULT_DASHBOARD_HEARTBEAT_MS) => {
    const timer = setInterval(trigger, heartbeatMs)
    ;(timer as any).unref?.()
    return () => clearInterval(timer)
  }

  return {
    publish,
    trigger,
    startHeartbeat,
    get generation() {
      return generation
    },
    get lastError() {
      return lastError
    },
  }
}

function live(record: PublisherRecord, nowMs: number) {
  return (
    Date.parse(record.manifest.leaseExpiresAt) > nowMs &&
    Date.parse(record.snapshot.leaseExpiresAt) > nowMs
  )
}

function aggregateWork(
  records: PublisherRecord[],
  objectiveId: string,
  nowMs: number,
): AggregatedWorkObjective | undefined {
  const values = records
    .flatMap((record) =>
      record.snapshot.workObjectives
        .filter((objective) => objective.objectiveId === objectiveId)
        .map((objective) => ({ objective, record })),
    )
  if (values.length === 0) return undefined
  const highest = Math.max(...values.map((value) => value.objective.workVersion))
  const candidates = values.filter((value) => value.objective.workVersion === highest)
  const conflict = new Set(candidates.map((value) => value.objective.stateDigest)).size > 1
  const sourceFreshness = candidates.some((value) => live(value.record, nowMs))
    ? "live" as const
    : "stale-source" as const
  if (conflict) {
    return {
      objectiveId,
      workVersion: highest,
      consistency: "conflict",
      sourceFreshness,
      conflictCandidates: candidates.map((value) => value.objective),
    }
  }
  const chosen = candidates.find((value) => live(value.record, nowMs)) ?? candidates[0]
  return {
    objectiveId,
    workVersion: highest,
    consistency: "ok",
    sourceFreshness,
    projection: chosen.objective,
  }
}

function aggregateWorkflow(
  records: PublisherRecord[],
  projectId: string,
  workflowId: string,
  nowMs: number,
): AggregatedWorkflow | undefined {
  const values = records
    .flatMap((record) =>
      record.snapshot.workflows
        .filter((workflow) => workflow.workflowId === workflowId)
        .map((workflow) => ({ workflow, record })),
    )
  if (values.length === 0) return undefined
  const highest = Math.max(...values.map((value) => value.workflow.workflowRevision))
  const candidates = values.filter((value) => value.workflow.workflowRevision === highest)
  const conflict = new Set(candidates.map((value) => value.workflow.stateDigest)).size > 1
  const sourceFreshness = candidates.some((value) => live(value.record, nowMs))
    ? "live" as const
    : "stale-source" as const
  const participants = values
    .map(({ workflow, record }) => ({
      installationId: record.manifest.installationId,
      instanceId: record.manifest.instanceId,
      live: live(record, nowMs),
      workflowRevision: workflow.workflowRevision,
      generation: record.snapshot.generation,
      leaseExpiresAt: record.snapshot.leaseExpiresAt,
    }))
    .sort((a, b) => a.instanceId.localeCompare(b.instanceId))

  if (conflict) {
    return {
      projectId,
      workflowId,
      workflowRevision: highest,
      consistency: "conflict",
      sourceFreshness,
      participants,
      conflictCandidates: candidates.map((value) => value.workflow),
    }
  }

  const chosen = candidates.find((value) => live(value.record, nowMs)) ?? candidates[0]
  return {
    projectId,
    workflowId,
    workflowRevision: highest,
    consistency: "ok",
    sourceFreshness,
    participants,
    projection: chosen.workflow,
  }
}

const severity = (workflow: AggregatedWorkflow) => {
  if (workflow.consistency === "conflict") return 0
  const projection = workflow.projection
  if (projection?.status === "failed") return 1
  if (projection?.status === "blocked") return 2
  if (workflow.sourceFreshness === "stale-source") return 3
  if (projection?.status === "active") return 4
  return 5
}

function aggregatedRecentActivity(workflow: AggregatedWorkflow) {
  return workflow.projection?.recentActivityAt ??
    workflow.conflictCandidates?.map((candidate) => candidate.recentActivityAt).sort().at(-1) ??
    ""
}

export function aggregateFleet(records: PublisherRecord[], now = new Date()): FleetSnapshot {
  const nowMs = now.getTime()
  const byProject = new Map<string, PublisherRecord[]>()
  for (const record of records) {
    if (record.manifest.schemaVersion !== 1 || record.snapshot.schemaVersion !== 1) continue
    if (
      record.manifest.installationId !== record.snapshot.installationId ||
      record.manifest.instanceId !== record.snapshot.instanceId ||
      record.snapshot.projectId === ""
    ) {
      continue
    }
    const list = byProject.get(record.snapshot.projectId) ?? []
    list.push(record)
    byProject.set(record.snapshot.projectId, list)
  }

  const projects: FleetProject[] = []
  for (const [projectId, projectRecords] of byProject) {
    const workflowIds = new Set(
      projectRecords.flatMap((record) => record.snapshot.workflows.map((workflow) => workflow.workflowId)),
    )
    const objectiveIds = new Set(
      projectRecords.flatMap((record) =>
        record.snapshot.workObjectives.map((objective) => objective.objectiveId),
      ),
    )
    const latestRecord = [...projectRecords].sort(
      (a, b) => Date.parse(b.snapshot.generatedAt) - Date.parse(a.snapshot.generatedAt),
    )[0]
    const workflows = [...workflowIds]
      .map((workflowId) => aggregateWorkflow(projectRecords, projectId, workflowId, nowMs))
      .filter((workflow): workflow is AggregatedWorkflow => Boolean(workflow))
      .sort((a, b) => severity(a) - severity(b) || aggregatedRecentActivity(b).localeCompare(aggregatedRecentActivity(a)))
    const workObjectives = [...objectiveIds]
      .map((objectiveId) => aggregateWork(projectRecords, objectiveId, nowMs))
      .filter((objective): objective is AggregatedWorkObjective => Boolean(objective))
    projects.push({
      projectId,
      displayName: latestRecord.snapshot.project.displayName,
      canonicalLocation: latestRecord.snapshot.project.canonicalLocation,
      workflows,
      workObjectives,
    })
  }

  projects.sort((a, b) => {
    const aSeverity = a.workflows[0] ? severity(a.workflows[0]) : 9
    const bSeverity = b.workflows[0] ? severity(b.workflows[0]) : 9
    return aSeverity - bSeverity || (a.displayName ?? a.projectId).localeCompare(b.displayName ?? b.projectId)
  })
  return { generatedAt: now.toISOString(), projects }
}

async function readJson<T>(path: string): Promise<T | undefined> {
  try {
    return JSON.parse(await readFile(path, "utf8")) as T
  } catch (error: any) {
    if (error?.code === "ENOENT") return undefined
    return undefined
  }
}

export async function readPublisherRecords(runtimeRoot: string): Promise<PublisherRecord[]> {
  const instancesRoot = join(runtimeRoot, "instances")
  let installations
  try {
    installations = await readdir(instancesRoot, { withFileTypes: true })
  } catch {
    return []
  }
  const records: PublisherRecord[] = []
  for (const installation of installations) {
    if (!installation.isDirectory()) continue
    const installationRoot = join(instancesRoot, installation.name)
    let instances
    try {
      instances = await readdir(installationRoot, { withFileTypes: true })
    } catch {
      continue
    }
    for (const instance of instances) {
      if (!instance.isDirectory()) continue
      const instanceRoot = join(installationRoot, instance.name)
      const manifest = await readJson<InstanceManifestV1>(join(instanceRoot, "manifest.json"))
      if (!manifest || manifest.schemaVersion !== 1) continue
      for (const projectId of manifest.projects) {
        const snapshot = await readJson<ProjectSnapshotV1>(
          join(instanceRoot, "projects", `${projectId}.json`),
        )
        if (!snapshot || snapshot.schemaVersion !== 1) continue
        records.push({ manifest, snapshot })
      }
    }
  }
  return records
}

export async function aggregateFleetFromDisk(runtimeRoot: string, now = new Date()) {
  return aggregateFleet(await readPublisherRecords(runtimeRoot), now)
}

export async function resolveDashboardRuntimeRoot() {
  const stateBase = process.env.XDG_STATE_HOME || join(homedir(), ".local", "state")
  const stateRoot = join(stateBase, "loom")
  const record = await readJson<{ schemaVersion: number; runtimeRoot: string }>(
    join(stateRoot, "runtime-root.json"),
  )
  if (record?.schemaVersion === 1 && typeof record.runtimeRoot === "string" && isAbsolute(record.runtimeRoot)) {
    return record.runtimeRoot
  }
  return join(stateRoot, "runtime")
}
