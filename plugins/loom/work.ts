import { createHash } from "node:crypto"
import {
  MAX_TASKS,
  MAX_TASK_CONTEXT_ITEMS,
  MAX_TASK_TEXT_LENGTH,
  type TaskSpec,
} from "./tasks"

export const MAX_WORK_ID_LENGTH = 96
export const MAX_WORK_PHASES = 32
export const MAX_WORK_WAVES = 128
export const MAX_WORK_TASKS = 256
export const MAX_WORK_OBLIGATIONS = 128
export const MAX_WORK_RISK_BOUNDARIES = 64
export const MAX_WORK_ACCEPTANCE_COVERAGE = 64
export const MAX_WORK_RELATIONSHIPS = 64
export const MAX_WORK_CORRECTION_ROUTES = 64

export type WorkNodeStatus =
  | "pending"
  | "active"
  | "blocked"
  | "complete"
  | "cancelled"
  | "superseded"

export type WorkPlanTask = {
  id: string
  title: string
  /** Bounded contribution owned by this Task, not the parent accepted Objective. */
  objective: string
  /** Why the Task exists and which plan gap it closes. */
  rationale: string
  dependsOn: string[]
  authorityRefs: string[]
  constraints: string[]
  acceptanceCriteria: string[]
  /** Non-executable local checklist retained as context, never workflow nodes. */
  subtasks: string[]
  integration: string[]
  verify: string[]
}

export type WorkPlanObligationDisposition =
  | "implement"
  | "already-satisfied"
  | "authorized-defer"
  | "out-of-scope"
  | "blocked"

export type WorkPlanObligation = {
  id: string
  sourceRef: string
  statement: string
  disposition: WorkPlanObligationDisposition
  taskIds: string[]
  verification: string[]
  /** Required when accepted authority explicitly permits defer/out-of-scope treatment. */
  dispositionAuthorityRef?: string
}

export type WorkPlanRiskBoundary = {
  id: string
  title: string
  description: string
  taskIds: string[]
}

export type WorkPlanAcceptanceCoverage = {
  id: string
  title: string
  /** Accepted whole-product criterion/outcome to cover; not an executable PA scenario. */
  criterion: string
  taskIds: string[]
}

export type WorkPlanRelationship = {
  summary: string
  taskIds: string[]
}

export type WorkPlanCorrectionRoute = {
  condition: string
  routeTo: string
  taskId?: string
}

export type WorkPlanWave = {
  id: string
  title: string
  objective: string
  constraints: string[]
  tasks: WorkPlanTask[]
}

export type WorkPlanPhase = {
  id: string
  title: string
  objective: string
  waves: WorkPlanWave[]
}

export type WorkPlanDefinition = {
  goal: string
  assumptions: string[]
  outOfScope: string[]
  authorityRefs: string[]
  obligations: WorkPlanObligation[]
  riskBoundaries: WorkPlanRiskBoundary[]
  acceptanceCoverage: WorkPlanAcceptanceCoverage[]
  relationships: WorkPlanRelationship[]
  correctionRouting: WorkPlanCorrectionRoute[]
  phases: WorkPlanPhase[]
}

export type WorkPlanAmendmentRecord = {
  revision: number
  by: string
  reason: string
  operations: string[]
  at: string
  /** Internal inverse delta used to reconstruct immutable earlier revisions without copying the whole Plan. */
  inverseOperations?: WorkPlanAmendOperation[]
  /** Previous values for top-level fields changed by this revision. */
  inversePlanPatch?: WorkPlanTopLevelPatch
}

export type WorkPlanSnapshot = WorkPlanDefinition & {
  generation: number
  revision: number
  amendments: WorkPlanAmendmentRecord[]
  invalidated?: {
    by: string
    reason: string
    at: string
  }
}

export type WorkPlanTaskPatch = Partial<Omit<WorkPlanTask, "id">>
export type WorkPlanWavePatch = Partial<Pick<WorkPlanWave, "title" | "objective" | "constraints">>
export type WorkPlanPhasePatch = Partial<Pick<WorkPlanPhase, "title" | "objective">>
export type WorkPlanTopLevelPatch = Partial<
  Pick<
    WorkPlanDefinition,
    | "goal"
    | "assumptions"
    | "outOfScope"
    | "authorityRefs"
    | "obligations"
    | "riskBoundaries"
    | "acceptanceCoverage"
    | "relationships"
    | "correctionRouting"
  >
>

export type WorkPlanAmendOperation =
  | { action: "patch-phase"; phaseId: string; patch: WorkPlanPhasePatch }
  | { action: "patch-wave"; phaseId: string; waveId: string; patch: WorkPlanWavePatch }
  | { action: "patch-task"; taskId: string; patch: WorkPlanTaskPatch }
  | { action: "add-phase"; phase: WorkPlanPhase }
  | { action: "remove-phase"; phaseId: string }
  | { action: "add-wave"; phaseId: string; wave: WorkPlanWave }
  | { action: "remove-wave"; phaseId: string; waveId: string }
  | { action: "add-task"; phaseId: string; waveId: string; task: WorkPlanTask }
  | { action: "remove-task"; taskId: string }

export type WaveCompletion = {
  workflowId: string
  generation: number
  taskIds: string[]
  reviewedTaskIds: string[]
  at: string
  provenance: "implementation-review" | "legacy-reviewed-workflow"
}

export type WorkNode = {
  id: string
  logicalId: string
  type: "phase" | "wave" | "task"
  title: string
  status: WorkNodeStatus
  generation: number
  parentId?: string
  objective?: string
  dependsOn?: string[]
  supersededByGeneration?: number
  claimedByWorkflowId?: string
  claimedAt?: string
  completion?: WaveCompletion
  result?: {
    workflowId: string
    summary?: string
    evidenceClaimIds: string[]
    completedAt: string
  }
  createdAt: string
  updatedAt: string
}

export type WorkHierarchy = {
  objectiveId: string
  anchor: string
  title: string
  objectiveStatus: WorkNodeStatus
  version: number
  generation: number
  workflowIds: string[]
  nodes: WorkNode[]
  /** Current semantic Plan snapshot per generation plus bounded inverse deltas for prior revisions. */
  plans?: WorkPlanSnapshot[]
  createdAt: string
  updatedAt: string
}

export type WorkProgress = {
  finished: number
  total: number
}

export type WorkTreeTask = {
  id: string
  title: string
  status: WorkNodeStatus
}

export type WorkTreeWave = {
  id: string
  title: string
  status: WorkNodeStatus
  progress: WorkProgress
  tasks: WorkTreeTask[]
}

export type WorkTreePhase = {
  id: string
  title: string
  status: WorkNodeStatus
  progress: WorkProgress
  waves: WorkTreeWave[]
}

export type WorkTree = {
  objective: {
    id: string
    title: string
    status: WorkNodeStatus
    progress: WorkProgress
  }
  generation: number
  phases: WorkTreePhase[]
}

function normalizedId(value: string, kind: string) {
  const id = value.trim()
  if (!/^[a-z0-9][a-z0-9-]*$/.test(id)) {
    throw new Error(`Invalid ${kind} id ${value}; use lowercase letters, numbers, and hyphens.`)
  }
  if (id.length > MAX_WORK_ID_LENGTH) {
    throw new Error(`${kind} id exceeds maximum of ${MAX_WORK_ID_LENGTH} characters.`)
  }
  return id
}

function nonEmpty(value: string, label: string) {
  const text = value.trim()
  if (!text) throw new Error(`${label} is required.`)
  if (text.length > MAX_TASK_TEXT_LENGTH) {
    throw new Error(`${label} exceeds maximum of ${MAX_TASK_TEXT_LENGTH} characters.`)
  }
  return text
}

function normalizedTextList(
  values: string[],
  label: string,
  requireOne = false,
  maxItems = MAX_TASK_CONTEXT_ITEMS,
) {
  const normalized = [...new Set(values.map((item) => item.trim()).filter(Boolean))]
  for (const item of normalized) {
    if (item.length > MAX_TASK_TEXT_LENGTH) {
      throw new Error(`${label} contains a value exceeding ${MAX_TASK_TEXT_LENGTH} characters.`)
    }
  }
  if (requireOne && normalized.length === 0) throw new Error(`${label} requires at least one value.`)
  if (normalized.length > maxItems) throw new Error(`${label} exceeds maximum of ${maxItems} values.`)
  return normalized
}

function normalizeReferencedTaskIds(values: string[], taskIds: Set<string>, label: string) {
  const normalized = normalizedTextList(values, label, false, MAX_WORK_TASKS)
  for (const taskId of normalized) {
    if (!taskIds.has(taskId)) throw new Error(`${label} references unknown Task ${taskId}.`)
  }
  return normalized
}

export function objectiveIdForAnchor(anchor: string) {
  return `objective:${anchor.replaceAll("\\", "/").trim()}`
}

export function objectiveTitleForAnchor(anchor: string) {
  const parts = anchor.replaceAll("\\", "/").split("/").filter(Boolean)
  const file = parts.at(-1) ?? anchor
  const raw = file === "anchor.md" && parts.length > 1 ? parts.at(-2)! : file.replace(/\.[^.]+$/, "")
  return raw.replace(/[-_]+/g, " ").trim() || "Objective"
}

export function createWorkHierarchy(anchor: string, workflowId: string, now: string): WorkHierarchy {
  const normalizedAnchor = anchor.replaceAll("\\", "/").trim()
  if (!normalizedAnchor) throw new Error("Objective Anchor is required.")

  return {
    objectiveId: objectiveIdForAnchor(normalizedAnchor),
    anchor: normalizedAnchor,
    title: objectiveTitleForAnchor(normalizedAnchor),
    objectiveStatus: "active",
    version: 1,
    generation: 0,
    workflowIds: [workflowId],
    nodes: [],
    createdAt: now,
    updatedAt: now,
  }
}

export function attachWorkflowToWork(hierarchy: WorkHierarchy, workflowId: string, now: string) {
  if (!hierarchy.workflowIds.includes(workflowId)) {
    hierarchy.workflowIds.push(workflowId)
    hierarchy.version++
    hierarchy.updatedAt = now
  }
  return hierarchy
}

function validateWorkPlanPhases(phases: WorkPlanPhase[]) {
  if (phases.length === 0) throw new Error("Work plan requires at least one Phase.")
  if (phases.length > MAX_WORK_PHASES) {
    throw new Error(`Work plan exceeds maximum of ${MAX_WORK_PHASES} Phases.`)
  }

  const normalized: WorkPlanPhase[] = []
  const phaseIds = new Set<string>()
  const waveKeys = new Set<string>()
  const taskIds = new Set<string>()
  let waveCount = 0
  let taskCount = 0

  for (const phaseInput of phases) {
    const phaseId = normalizedId(phaseInput.id, "Phase")
    if (phaseIds.has(phaseId)) throw new Error(`Duplicate Phase id: ${phaseId}`)
    phaseIds.add(phaseId)

    if (phaseInput.waves.length === 0) throw new Error(`Phase ${phaseId} requires at least one Wave.`)

    const waves: WorkPlanWave[] = []
    for (const waveInput of phaseInput.waves) {
      const waveId = normalizedId(waveInput.id, "Wave")
      const waveKey = `${phaseId}/${waveId}`
      if (waveKeys.has(waveKey)) throw new Error(`Duplicate Wave id in Phase ${phaseId}: ${waveId}`)
      waveKeys.add(waveKey)
      waveCount++

      if (waveInput.tasks.length === 0) throw new Error(`Wave ${waveKey} requires at least one Task.`)
      if (waveInput.tasks.length > MAX_TASKS) {
        throw new Error(`Wave ${waveKey} exceeds executable maximum of ${MAX_TASKS} Tasks.`)
      }

      const tasks: WorkPlanTask[] = []
      for (const taskInput of waveInput.tasks) {
        const taskId = normalizedId(taskInput.id, "Task")
        if (taskIds.has(taskId)) throw new Error(`Work Task ids must be globally unique: ${taskId}`)
        taskIds.add(taskId)
        taskCount++

        tasks.push({
          id: taskId,
          title: nonEmpty(taskInput.title, `Task ${taskId} title`),
          objective: nonEmpty(taskInput.objective, `Task ${taskId} objective`),
          rationale: nonEmpty(taskInput.rationale, `Task ${taskId} rationale`),
          dependsOn: (() => {
            const dependencies = [...new Set(taskInput.dependsOn.map((item) => normalizedId(item, "Task dependency")))]
            if (dependencies.length > MAX_TASK_CONTEXT_ITEMS) {
              throw new Error(`Task ${taskId} dependencies exceed maximum of ${MAX_TASK_CONTEXT_ITEMS} values.`)
            }
            return dependencies
          })(),
          authorityRefs: normalizedTextList(taskInput.authorityRefs, `Task ${taskId} authorityRefs`, true),
          constraints: normalizedTextList(taskInput.constraints, `Task ${taskId} constraints`),
          acceptanceCriteria: normalizedTextList(taskInput.acceptanceCriteria, `Task ${taskId} acceptanceCriteria`, true),
          subtasks: normalizedTextList(taskInput.subtasks, `Task ${taskId} subtasks`),
          integration: normalizedTextList(taskInput.integration, `Task ${taskId} integration`),
          verify: normalizedTextList(taskInput.verify, `Task ${taskId} verify`, true),
        })
      }

      waves.push({
        id: waveId,
        title: nonEmpty(waveInput.title, `Wave ${waveKey} title`),
        objective: nonEmpty(waveInput.objective, `Wave ${waveKey} objective`),
        constraints: normalizedTextList(waveInput.constraints, `Wave ${waveKey} constraints`),
        tasks,
      })
    }

    normalized.push({
      id: phaseId,
      title: nonEmpty(phaseInput.title, `Phase ${phaseId} title`),
      objective: nonEmpty(phaseInput.objective, `Phase ${phaseId} objective`),
      waves,
    })
  }

  if (waveCount > MAX_WORK_WAVES) {
    throw new Error(`Work plan exceeds maximum of ${MAX_WORK_WAVES} Waves.`)
  }
  if (taskCount > MAX_WORK_TASKS) {
    throw new Error(`Work plan exceeds maximum of ${MAX_WORK_TASKS} Tasks.`)
  }

  const byTask = new Map(
    normalized.flatMap((phase) =>
      phase.waves.flatMap((wave) => wave.tasks.map((task) => [task.id, task] as const)),
    ),
  )

  for (const task of byTask.values()) {
    for (const dependency of task.dependsOn) {
      if (!byTask.has(dependency)) {
        throw new Error(`Work Task ${task.id} depends on unknown Task ${dependency}.`)
      }
      if (dependency === task.id) throw new Error(`Work Task ${task.id} cannot depend on itself.`)
    }
  }

  const visiting = new Set<string>()
  const visited = new Set<string>()
  const visit = (id: string) => {
    if (visited.has(id)) return
    if (visiting.has(id)) throw new Error(`Work Task dependency cycle includes ${id}.`)
    visiting.add(id)
    for (const dep of byTask.get(id)!.dependsOn) visit(dep)
    visiting.delete(id)
    visited.add(id)
  }
  for (const id of byTask.keys()) visit(id)

  return normalized
}

export function validateWorkPlan(input: WorkPlanDefinition): WorkPlanDefinition {
  const phases = validateWorkPlanPhases(input.phases)
  const taskIds = new Set(
    phases.flatMap((phase) => phase.waves.flatMap((wave) => wave.tasks.map((task) => task.id))),
  )

  const planAuthorityRefs = normalizedTextList(input.authorityRefs, "Plan authorityRefs", true, 64)
  for (const task of phases.flatMap((phase) => phase.waves.flatMap((wave) => wave.tasks))) {
    for (const authorityRef of task.authorityRefs) {
      if (!planAuthorityRefs.includes(authorityRef)) {
        throw new Error(`Task ${task.id} authority reference is not declared by the parent Plan: ${authorityRef}.`)
      }
    }
  }

  if (input.obligations.length > MAX_WORK_OBLIGATIONS) {
    throw new Error(`Plan obligations exceed maximum of ${MAX_WORK_OBLIGATIONS}.`)
  }
  const obligationIds = new Set<string>()
  const obligations = input.obligations.map((obligation) => {
    const id = normalizedId(obligation.id, "obligation")
    if (obligationIds.has(id)) throw new Error(`Duplicate obligation id: ${id}`)
    obligationIds.add(id)

    const disposition = obligation.disposition
    if (!["implement", "already-satisfied", "authorized-defer", "out-of-scope", "blocked"].includes(disposition)) {
      throw new Error(`Obligation ${id} has invalid disposition ${disposition}.`)
    }

    const taskRefs = normalizeReferencedTaskIds(obligation.taskIds, taskIds, `Obligation ${id}`)
    const verification = normalizedTextList(
      obligation.verification,
      `Obligation ${id} verification`,
      disposition === "implement" || disposition === "already-satisfied",
    )

    if (disposition === "implement" && taskRefs.length === 0) {
      throw new Error(`Implemented obligation ${id} requires at least one owning Task.`)
    }
    if (
      (disposition === "authorized-defer" || disposition === "out-of-scope") &&
      !obligation.dispositionAuthorityRef?.trim()
    ) {
      throw new Error(`Obligation ${id} ${disposition} requires dispositionAuthorityRef.`)
    }

    const sourceRef = nonEmpty(obligation.sourceRef, `Obligation ${id} sourceRef`)
    if (!planAuthorityRefs.includes(sourceRef)) {
      throw new Error(`Obligation ${id} sourceRef is not declared by the parent Plan: ${sourceRef}.`)
    }
    const dispositionAuthorityRef = obligation.dispositionAuthorityRef?.trim()
    if (dispositionAuthorityRef && !planAuthorityRefs.includes(dispositionAuthorityRef)) {
      throw new Error(
        `Obligation ${id} disposition authority is not declared by the parent Plan: ${dispositionAuthorityRef}.`,
      )
    }

    return {
      id,
      sourceRef,
      statement: nonEmpty(obligation.statement, `Obligation ${id} statement`),
      disposition,
      taskIds: taskRefs,
      verification,
      ...(dispositionAuthorityRef ? { dispositionAuthorityRef } : {}),
    }
  })

  if (input.riskBoundaries.length > MAX_WORK_RISK_BOUNDARIES) {
    throw new Error(`Plan risk boundaries exceed maximum of ${MAX_WORK_RISK_BOUNDARIES}.`)
  }
  const riskIds = new Set<string>()
  const riskBoundaries = input.riskBoundaries.map((risk) => {
    const id = normalizedId(risk.id, "risk boundary")
    if (riskIds.has(id)) throw new Error(`Duplicate risk boundary id: ${id}`)
    riskIds.add(id)
    const taskRefs = normalizeReferencedTaskIds(risk.taskIds, taskIds, `Risk boundary ${id}`)
    if (taskRefs.length === 0) {
      throw new Error(`Risk boundary ${id} requires at least one owning Task.`)
    }
    return {
      id,
      title: nonEmpty(risk.title, `Risk boundary ${id} title`),
      description: nonEmpty(risk.description, `Risk boundary ${id} description`),
      taskIds: taskRefs,
    }
  })

  if (input.acceptanceCoverage.length > MAX_WORK_ACCEPTANCE_COVERAGE) {
    throw new Error(`Plan acceptance coverage exceeds maximum of ${MAX_WORK_ACCEPTANCE_COVERAGE}.`)
  }
  const acceptanceIds = new Set<string>()
  const acceptanceCoverage = input.acceptanceCoverage.map((coverage) => {
    const id = normalizedId(coverage.id, "acceptance coverage")
    if (acceptanceIds.has(id)) throw new Error(`Duplicate acceptance coverage id: ${id}`)
    acceptanceIds.add(id)
    const taskRefs = normalizeReferencedTaskIds(
      coverage.taskIds,
      taskIds,
      `Acceptance coverage ${id}`,
    )
    if (taskRefs.length === 0) {
      throw new Error(`Acceptance coverage ${id} requires at least one owning Task.`)
    }
    return {
      id,
      title: nonEmpty(coverage.title, `Acceptance coverage ${id} title`),
      criterion: nonEmpty(coverage.criterion, `Acceptance coverage ${id} criterion`),
      taskIds: taskRefs,
    }
  })

  if (input.relationships.length > MAX_WORK_RELATIONSHIPS) {
    throw new Error(`Plan relationships exceed maximum of ${MAX_WORK_RELATIONSHIPS}.`)
  }
  const relationships = input.relationships.map((relationship, index) => {
    const taskRefs = normalizeReferencedTaskIds(
      relationship.taskIds,
      taskIds,
      `Relationship ${index + 1}`,
    )
    if (taskRefs.length < 2) {
      throw new Error(`Relationship ${index + 1} must reference at least two Tasks.`)
    }
    return {
      summary: nonEmpty(relationship.summary, `Relationship ${index + 1} summary`),
      taskIds: taskRefs,
    }
  })

  if (input.correctionRouting.length > MAX_WORK_CORRECTION_ROUTES) {
    throw new Error(`Plan correction routes exceed maximum of ${MAX_WORK_CORRECTION_ROUTES}.`)
  }
  const correctionRouting = input.correctionRouting.map((route, index) => ({
    condition: nonEmpty(route.condition, `Correction route ${index + 1} condition`),
    routeTo: nonEmpty(route.routeTo, `Correction route ${index + 1} routeTo`),
    ...(route.taskId
      ? { taskId: normalizeReferencedTaskIds([route.taskId], taskIds, `Correction route ${index + 1}`)[0] }
      : {}),
  }))

  return {
    goal: nonEmpty(input.goal, "Plan goal"),
    assumptions: normalizedTextList(input.assumptions, "Plan assumptions", false, 64),
    outOfScope: normalizedTextList(input.outOfScope, "Plan outOfScope", false, 64),
    authorityRefs: planAuthorityRefs,
    obligations,
    riskBoundaries,
    acceptanceCoverage,
    relationships,
    correctionRouting,
    phases,
  }
}

function phaseNodeId(generation: number, phaseId: string) {
  return `phase:${generation}:${phaseId}`
}

function waveNodeId(generation: number, phaseId: string, waveId: string) {
  return `wave:${generation}:${phaseId}/${waveId}`
}

function taskNodeId(generation: number, taskId: string) {
  return `task:${generation}:${taskId}`
}

export function materializeWorkPlan(
  hierarchy: WorkHierarchy,
  workflowId: string,
  planInput: WorkPlanDefinition,
  now: string,
) {
  const plan = validateWorkPlan(planInput)
  const phases = plan.phases

  if (
    hierarchy.generation > 0 &&
    hierarchy.nodes.some(
      (node) =>
        node.generation === hierarchy.generation &&
        Boolean(node.claimedByWorkflowId),
    )
  ) {
    throw new Error(
      "Cannot replace the active work-plan generation while a Wave is claimed. Release/finish the claimed workflow first.",
    )
  }

  const nextGeneration = hierarchy.generation + 1

  for (const node of hierarchy.nodes) {
    if (
      node.generation === hierarchy.generation &&
      node.status !== "complete" &&
      node.status !== "cancelled" &&
      node.status !== "superseded"
    ) {
      node.status = "superseded"
      node.supersededByGeneration = nextGeneration
      node.updatedAt = now
    }
  }

  const nodes: WorkNode[] = []

  for (const phase of phases) {
    const phaseId = phaseNodeId(nextGeneration, phase.id)
    nodes.push({
      id: phaseId,
      logicalId: phase.id,
      type: "phase",
      title: phase.title,
      status: "pending",
      generation: nextGeneration,
      createdAt: now,
      updatedAt: now,
    })

    for (const wave of phase.waves) {
      const waveId = waveNodeId(nextGeneration, phase.id, wave.id)
      nodes.push({
        id: waveId,
        logicalId: wave.id,
        type: "wave",
        title: wave.title,
        status: "pending",
        generation: nextGeneration,
        parentId: phaseId,
        createdAt: now,
        updatedAt: now,
      })

      for (const task of wave.tasks) {
        nodes.push({
          id: taskNodeId(nextGeneration, task.id),
          logicalId: task.id,
          type: "task",
          title: task.title,
          objective: task.objective,
          status: "pending",
          generation: nextGeneration,
          parentId: waveId,
          dependsOn: [...task.dependsOn],
          createdAt: now,
          updatedAt: now,
        })
      }
    }
  }

  hierarchy.nodes.push(...nodes)
  hierarchy.plans ??= []
  hierarchy.plans.push({
    ...plan,
    generation: nextGeneration,
    revision: 1,
    amendments: [],
  })
  hierarchy.generation = nextGeneration
  hierarchy.objectiveStatus = "active"
  hierarchy.version++
  hierarchy.updatedAt = now
  attachWorkflowToWork(hierarchy, workflowId, now)
  return hierarchy
}

export function assertWorkGeneration(hierarchy: WorkHierarchy, generation: number) {
  if (generation !== hierarchy.generation) {
    throw new Error(
      `Stale workflow generation: workflow=${generation}, current=${hierarchy.generation}. Reconcile/replan before mutating persistent work.`,
    )
  }
  const currentPlan = planSnapshot(hierarchy, generation)
  if (currentPlan?.invalidated) {
    throw new Error(
      `Work-plan generation ${generation} is invalidated: ${currentPlan.invalidated.reason}. Start a new Plan generation before continuing execution.`,
    )
  }
}

function activeNodes(hierarchy: WorkHierarchy) {
  const currentPlan = planSnapshot(hierarchy, hierarchy.generation)
  if (currentPlan?.invalidated) return []
  return hierarchy.nodes.filter(
    (node) => node.generation === hierarchy.generation && node.status !== "superseded",
  )
}

function activeTaskMap(hierarchy: WorkHierarchy) {
  return new Map(
    activeNodes(hierarchy)
      .filter((node) => node.type === "task")
      .map((node) => [node.logicalId, node]),
  )
}

function taskDescendants(hierarchy: WorkHierarchy, parentId?: string) {
  const nodes = activeNodes(hierarchy)
  if (!parentId) return nodes.filter((node) => node.type === "task")

  const children = nodes.filter((node) => node.parentId === parentId)
  const waveIds =
    children.length > 0 && children[0]?.type === "wave"
      ? new Set(children.map((node) => node.id))
      : new Set([parentId])

  return nodes.filter((node) => node.type === "task" && node.parentId && waveIds.has(node.parentId))
}

function progressFor(hierarchy: WorkHierarchy, parentId?: string): WorkProgress {
  const tasks = taskDescendants(hierarchy, parentId)
  return {
    finished: tasks.filter((task) => task.status === "complete").length,
    total: tasks.length,
  }
}

function applyInverseOperation(plan: WorkPlanDefinition, operation: WorkPlanAmendOperation) {
  if (operation.action === "patch-phase") {
    const phase = findPlanPhase(plan, operation.phaseId)
    if (phase) Object.assign(phase, structuredClone(operation.patch))
    return
  }
  if (operation.action === "patch-wave") {
    const wave = findPlanWave(plan, operation.phaseId, operation.waveId)
    if (wave) Object.assign(wave, structuredClone(operation.patch))
    return
  }
  if (operation.action === "patch-task") {
    const located = findPlanTask(plan, operation.taskId)
    if (located) Object.assign(located.task, structuredClone(operation.patch))
    return
  }
  if (operation.action === "add-phase") {
    plan.phases.push(structuredClone(operation.phase))
    return
  }
  if (operation.action === "remove-phase") {
    plan.phases = plan.phases.filter((phase) => phase.id !== operation.phaseId)
    return
  }
  if (operation.action === "add-wave") {
    const phase = findPlanPhase(plan, operation.phaseId)
    if (phase) phase.waves.push(structuredClone(operation.wave))
    return
  }
  if (operation.action === "remove-wave") {
    const phase = findPlanPhase(plan, operation.phaseId)
    if (phase) phase.waves = phase.waves.filter((wave) => wave.id !== operation.waveId)
    return
  }
  if (operation.action === "add-task") {
    const wave = findPlanWave(plan, operation.phaseId, operation.waveId)
    if (wave) wave.tasks.push(structuredClone(operation.task))
    return
  }
  const located = findPlanTask(plan, operation.taskId)
  if (located) located.wave.tasks = located.wave.tasks.filter((task) => task.id !== operation.taskId)
}

function historicalPlanSnapshot(current: WorkPlanSnapshot, revision: number) {
  if (revision < 1 || revision > current.revision) return undefined
  if (revision === current.revision) return current

  const definition: WorkPlanDefinition = structuredClone({
    goal: current.goal,
    assumptions: current.assumptions,
    outOfScope: current.outOfScope,
    authorityRefs: current.authorityRefs,
    obligations: current.obligations,
    riskBoundaries: current.riskBoundaries,
    acceptanceCoverage: current.acceptanceCoverage,
    relationships: current.relationships,
    correctionRouting: current.correctionRouting,
    phases: current.phases,
  })

  const amendments = [...(current.amendments ?? [])]
    .filter((amendment) => amendment.revision > revision)
    .sort((a, b) => b.revision - a.revision)

  for (const amendment of amendments) {
    for (const operation of amendment.inverseOperations ?? []) {
      applyInverseOperation(definition, operation)
    }
    if (amendment.inversePlanPatch) {
      Object.assign(definition, structuredClone(amendment.inversePlanPatch))
    }
  }

  return {
    ...definition,
    generation: current.generation,
    revision,
    amendments: (current.amendments ?? []).filter((amendment) => amendment.revision <= revision),
  } satisfies WorkPlanSnapshot
}

function planSnapshot(
  hierarchy: WorkHierarchy,
  generation = hierarchy.generation,
  revision?: number,
) {
  const candidates = (hierarchy.plans ?? [])
    .filter((plan) => plan.generation === generation)
    .sort((a, b) => (b.revision ?? 1) - (a.revision ?? 1))
  const current = candidates[0]
  if (!current) return undefined
  if (revision === undefined) return current

  // Compatibility with early rich-Plan builds that persisted a full snapshot
  // for every revision. New state keeps only the latest snapshot plus deltas.
  const materialized = candidates.find((plan) => (plan.revision ?? 1) === revision)
  return materialized ?? historicalPlanSnapshot(current, revision)
}

function plannedTask(snapshot: WorkPlanSnapshot | undefined, taskId: string) {
  return snapshot?.phases
    .flatMap((phase) => phase.waves.flatMap((wave) => wave.tasks))
    .find((task) => task.id === taskId)
}

const PLAN_CONTEXT_TEXT_LIMIT = 320
const PLAN_CONTEXT_LIST_LIMIT = 4
const PLAN_CONTEXT_DEPENDENT_LIMIT = 24
const PLAN_CONTEXT_EVIDENCE_LIMIT = 12
const PLAN_CONTEXT_TASK_ID_LIMIT = 32
const PLAN_CONTEXT_MAP_TEXT_LIMIT = 160

function contextText(value: string, max = PLAN_CONTEXT_TEXT_LIMIT) {
  const normalized = value.replace(/\s+/g, " ").trim()
  return normalized.length <= max
    ? normalized
    : normalized.slice(0, Math.max(0, max - 16)) + "… [truncated]"
}

function contextList(values: string[], limit = PLAN_CONTEXT_LIST_LIMIT) {
  const selected = values.slice(0, limit).map(contextText)
  if (values.length > limit) selected.push(`[${values.length - limit} additional item(s) omitted]`)
  return selected
}

function contextTaskIds(taskIds: string[]) {
  return {
    taskIds: taskIds.slice(0, PLAN_CONTEXT_TASK_ID_LIMIT),
    ...(taskIds.length > PLAN_CONTEXT_TASK_ID_LIMIT
      ? { taskIdsOmitted: taskIds.length - PLAN_CONTEXT_TASK_ID_LIMIT }
      : {}),
  }
}

function contextResult(result: WorkNode["result"] | undefined) {
  if (!result) return undefined
  return {
    workflowId: result.workflowId,
    ...(result.summary ? { summary: contextText(result.summary) } : {}),
    evidenceClaimIds: result.evidenceClaimIds.slice(0, PLAN_CONTEXT_EVIDENCE_LIMIT),
    ...(result.evidenceClaimIds.length > PLAN_CONTEXT_EVIDENCE_LIMIT
      ? { evidenceClaimsOmitted: result.evidenceClaimIds.length - PLAN_CONTEXT_EVIDENCE_LIMIT }
      : {}),
    completedAt: result.completedAt,
  }
}

export function workPlanContext(
  hierarchy: WorkHierarchy,
  taskId?: string,
  mode: "focused" | "full" = "focused",
  generation = hierarchy.generation,
  revision?: number,
) {
  const snapshot = planSnapshot(hierarchy, generation, revision)
  if (!snapshot) return null

  const task = taskId ? plannedTask(snapshot, taskId) : undefined
  const phase = taskId
    ? snapshot.phases.find((candidate) =>
        candidate.waves.some((wave) => wave.tasks.some((item) => item.id === taskId)),
      )
    : undefined
  const wave = phase?.waves.find((candidate) => candidate.tasks.some((item) => item.id === taskId))
  const allTasks = snapshot.phases.flatMap((candidate) =>
    candidate.waves.flatMap((candidateWave) => candidateWave.tasks),
  )
  const taskNodes = new Map(
    hierarchy.nodes
      .filter((node) => node.generation === generation && node.type === "task")
      .map((node) => [node.logicalId, node]),
  )
  const dependencies = task
    ? task.dependsOn.map((dependency) => plannedTask(snapshot, dependency)).filter(Boolean)
    : []
  const dependents = task
    ? allTasks.filter((candidate) => candidate.dependsOn.includes(task.id))
    : []

  const relevantRelationships = task
    ? snapshot.relationships.filter((relationship) => relationship.taskIds.includes(task.id))
    : snapshot.relationships

  return {
    generation: snapshot.generation,
    revision: snapshot.revision ?? 1,
    amendments: (snapshot.amendments ?? []).slice(-20).map((amendment) => ({
      revision: amendment.revision,
      by: amendment.by,
      reason: contextText(amendment.reason),
      operations: amendment.operations.slice(0, 16),
      at: amendment.at,
    })),
    ...(snapshot.invalidated
      ? {
          invalidated: {
            ...snapshot.invalidated,
            reason: contextText(snapshot.invalidated.reason),
          },
        }
      : {}),
    goal: contextText(snapshot.goal),
    assumptions: contextList(snapshot.assumptions, 16),
    outOfScope: contextList(snapshot.outOfScope, 16),
    authorityRefs: snapshot.authorityRefs.slice(0, 32),
    obligations: (mode === "full" || !task
      ? snapshot.obligations
      : snapshot.obligations.filter((obligation) => obligation.taskIds.includes(task.id))
    ).map((obligation) => ({
      ...obligation,
      ...contextTaskIds(obligation.taskIds),
      statement: contextText(obligation.statement),
      verification: contextList(obligation.verification),
    })),
    planMap: snapshot.phases.map((candidate) => ({
      id: candidate.id,
      title: contextText(candidate.title, PLAN_CONTEXT_MAP_TEXT_LIMIT),
      objective: contextText(candidate.objective, PLAN_CONTEXT_MAP_TEXT_LIMIT),
      waves: candidate.waves.map((candidateWave) => ({
        id: candidateWave.id,
        title: contextText(candidateWave.title, PLAN_CONTEXT_MAP_TEXT_LIMIT),
        objective: contextText(candidateWave.objective, PLAN_CONTEXT_MAP_TEXT_LIMIT),
        constraints: contextList(candidateWave.constraints),
        tasks: candidateWave.tasks.map((candidateTask) => ({
          id: candidateTask.id,
          title: contextText(candidateTask.title, PLAN_CONTEXT_MAP_TEXT_LIMIT),
          objective: contextText(candidateTask.objective, PLAN_CONTEXT_MAP_TEXT_LIMIT),
          status: taskNodes.get(candidateTask.id)?.status,
          result: contextResult(taskNodes.get(candidateTask.id)?.result),
        })),
      })),
    })),
    riskBoundaries: (mode === "full" || !task
      ? snapshot.riskBoundaries
      : snapshot.riskBoundaries.filter((risk) => risk.taskIds.includes(task.id))
    ).map((risk) => ({
      ...risk,
      ...contextTaskIds(risk.taskIds),
      title: contextText(risk.title),
      description: contextText(risk.description),
    })),
    acceptanceCoverage: (mode === "full" || !task
      ? snapshot.acceptanceCoverage
      : snapshot.acceptanceCoverage.filter((coverage) => coverage.taskIds.includes(task.id))
    ).map((coverage) => ({
      ...coverage,
      ...contextTaskIds(coverage.taskIds),
      title: contextText(coverage.title),
      criterion: contextText(coverage.criterion),
    })),
    relationships: relevantRelationships.map((relationship) => ({
      ...relationship,
      ...contextTaskIds(relationship.taskIds),
      summary: contextText(relationship.summary),
    })),
    correctionRouting: (mode === "full" || !task
      ? snapshot.correctionRouting
      : snapshot.correctionRouting.filter((route) => !route.taskId || route.taskId === task.id)
    ).map((route) => ({
      ...route,
      condition: contextText(route.condition),
      routeTo: contextText(route.routeTo),
    })),
    projection: {
      bounded: true,
      textLimit: PLAN_CONTEXT_TEXT_LIMIT,
      listLimit: PLAN_CONTEXT_LIST_LIMIT,
      taskIdLimit: PLAN_CONTEXT_TASK_ID_LIMIT,
      mapTextLimit: PLAN_CONTEXT_MAP_TEXT_LIMIT,
      amendmentsOmitted: Math.max(0, (snapshot.amendments ?? []).length - 20),
      authorityRefsOmitted: Math.max(0, snapshot.authorityRefs.length - 32),
    },
    ...(task
      ? {
          focus: {
            phase: phase ? { id: phase.id, title: phase.title, objective: phase.objective } : undefined,
            wave: wave ? { id: wave.id, title: wave.title, objective: wave.objective, constraints: wave.constraints } : undefined,
            task,
            status: taskNodes.get(task.id)?.status,
            result: contextResult(taskNodes.get(task.id)?.result),
            dependencies: dependencies.map((dependency) => ({
              id: dependency!.id,
              title: contextText(dependency!.title),
              objective: contextText(dependency!.objective),
              integration: contextList(dependency!.integration),
              status: taskNodes.get(dependency!.id)?.status,
              result: contextResult(taskNodes.get(dependency!.id)?.result),
            })),
            dependents: dependents.slice(0, PLAN_CONTEXT_DEPENDENT_LIMIT).map((dependent) => ({
              id: dependent.id,
              title: contextText(dependent.title),
              objective: contextText(dependent.objective),
              integration: contextList(dependent.integration),
              status: taskNodes.get(dependent.id)?.status,
              result: contextResult(taskNodes.get(dependent.id)?.result),
            })),
            dependentsOmitted: Math.max(0, dependents.length - PLAN_CONTEXT_DEPENDENT_LIMIT),
          },
        }
      : {}),
  }
}


function currentPlan(hierarchy: WorkHierarchy) {
  return planSnapshot(hierarchy, hierarchy.generation)
}

function currentGenerationNodes(hierarchy: WorkHierarchy) {
  return hierarchy.nodes.filter((node) => node.generation === hierarchy.generation)
}

function phaseNode(hierarchy: WorkHierarchy, phaseId: string) {
  return currentGenerationNodes(hierarchy).find(
    (node) => node.type === "phase" && node.logicalId === phaseId && node.status !== "superseded",
  )
}

function waveNode(hierarchy: WorkHierarchy, phaseId: string, waveId: string) {
  const phase = phaseNode(hierarchy, phaseId)
  return phase
    ? currentGenerationNodes(hierarchy).find(
        (node) =>
          node.type === "wave" &&
          node.logicalId === waveId &&
          node.parentId === phase.id &&
          node.status !== "superseded",
      )
    : undefined
}

function taskNode(hierarchy: WorkHierarchy, taskId: string) {
  return currentGenerationNodes(hierarchy).find(
    (node) => node.type === "task" && node.logicalId === taskId && node.status !== "superseded",
  )
}

function taskNodesUnder(hierarchy: WorkHierarchy, parent: WorkNode) {
  const nodes = currentGenerationNodes(hierarchy)
  if (parent.type === "wave") {
    return nodes.filter(
      (node) => node.type === "task" && node.parentId === parent.id && node.status !== "superseded",
    )
  }
  if (parent.type === "phase") {
    const waveIds = new Set(
      nodes
        .filter(
          (node) => node.type === "wave" && node.parentId === parent.id && node.status !== "superseded",
        )
        .map((node) => node.id),
    )
    return nodes.filter(
      (node) =>
        node.type === "task" &&
        Boolean(node.parentId) &&
        waveIds.has(node.parentId!) &&
        node.status !== "superseded",
    )
  }
  return [parent]
}

function assertNoClaim(nodes: WorkNode[], label: string) {
  const claimed = nodes.find((node) => node.claimedByWorkflowId)
  if (claimed) {
    throw new Error(
      `${label} cannot be amended while ${claimed.type} ${claimed.logicalId} is claimed by workflow ${claimed.claimedByWorkflowId}.`,
    )
  }
}

function assertSemanticNodeMutable(hierarchy: WorkHierarchy, node: WorkNode | undefined, label: string) {
  if (!node) throw new Error(`${label} not found in the current Plan generation.`)
  const affected = node.type === "task" ? [node] : [node, ...taskNodesUnder(hierarchy, node)]
  assertNoClaim(affected, label)
  const completed = affected.find((candidate) => candidate.status === "complete")
  if (completed) {
    throw new Error(
      `${label} cannot rewrite semantic context already consumed by completed Task ${completed.logicalId}. Create a new Plan generation for that change.`,
    )
  }
}

function findPlanTask(plan: WorkPlanDefinition, taskId: string) {
  for (const phase of plan.phases) {
    for (const wave of phase.waves) {
      const task = wave.tasks.find((candidate) => candidate.id === taskId)
      if (task) return { phase, wave, task }
    }
  }
  return undefined
}

function findPlanPhase(plan: WorkPlanDefinition, phaseId: string) {
  return plan.phases.find((phase) => phase.id === phaseId)
}

function findPlanWave(plan: WorkPlanDefinition, phaseId: string, waveId: string) {
  return findPlanPhase(plan, phaseId)?.waves.find((wave) => wave.id === waveId)
}

function protectedTaskIds(hierarchy: WorkHierarchy) {
  return new Set(
    currentGenerationNodes(hierarchy)
      .filter(
        (node) =>
          node.type === "task" &&
          (node.status === "complete" || Boolean(node.claimedByWorkflowId)),
      )
      .map((node) => node.logicalId),
  )
}

function planTaskSemanticFingerprint(plan: WorkPlanDefinition, taskId: string) {
  const located = findPlanTask(plan, taskId)
  if (!located) return undefined
  return JSON.stringify({
    goal: plan.goal,
    assumptions: plan.assumptions,
    outOfScope: plan.outOfScope,
    authorityRefs: plan.authorityRefs,
    phase: { id: located.phase.id, title: located.phase.title, objective: located.phase.objective },
    wave: {
      id: located.wave.id,
      title: located.wave.title,
      objective: located.wave.objective,
      constraints: located.wave.constraints,
    },
    task: located.task,
    obligations: plan.obligations.filter((item) => item.taskIds.includes(taskId)),
    risks: plan.riskBoundaries.filter((item) => item.taskIds.includes(taskId)),
    acceptanceCoverage: plan.acceptanceCoverage.filter((item) => item.taskIds.includes(taskId)),
    relationships: plan.relationships.filter((item) => item.taskIds.includes(taskId)),
    correctionRouting: plan.correctionRouting.filter((item) => !item.taskId || item.taskId === taskId),
  })
}

export function taskSemanticFingerprintAtRevision(
  hierarchy: WorkHierarchy,
  taskId: string,
  generation = hierarchy.generation,
  revision?: number,
) {
  const snapshot = planSnapshot(hierarchy, generation, revision)
  return snapshot ? planTaskSemanticFingerprint(snapshot, taskId) : undefined
}

export function workflowTaskSemanticFingerprint(
  hierarchy: WorkHierarchy,
  taskIds: string[],
  generation = hierarchy.generation,
) {
  const snapshot = planSnapshot(hierarchy, generation)
  if (!snapshot || taskIds.length === 0) return undefined
  const selected = [...new Set(taskIds)].sort()
  const fingerprints = selected.map((taskId) => {
    const value = planTaskSemanticFingerprint(snapshot, taskId)
    if (!value) throw new Error(`Task ${taskId} has no semantic Plan contract.`)
    return value
  })
  const waveShapes = snapshot.phases.flatMap((phase) =>
    phase.waves
      .filter((wave) => wave.tasks.some((task) => selected.includes(task.id)))
      .map((wave) => ({
        phaseId: phase.id,
        waveId: wave.id,
        taskIds: wave.tasks.map((task) => task.id),
      })),
  )
  return createHash("sha256")
    .update(JSON.stringify({ fingerprints, waveShapes }))
    .digest("hex")
}

function planWaveFingerprint(plan: WorkPlanDefinition, phaseId: string, waveId: string) {
  const wave = findPlanWave(plan, phaseId, waveId)
  return wave ? JSON.stringify(wave.tasks.map((task) => task.id)) : undefined
}

function planTaskIds(plan: WorkPlanDefinition) {
  return plan.phases.flatMap((phase) => phase.waves.flatMap((wave) => wave.tasks.map((task) => task.id)))
}

function planWaveKeys(plan: WorkPlanDefinition) {
  return plan.phases.flatMap((phase) => phase.waves.map((wave) => `${phase.id}/${wave.id}`))
}

function assertPlanPatchDoesNotRewriteCompletedWork(
  hierarchy: WorkHierarchy,
  before: WorkPlanSnapshot,
  after: WorkPlanDefinition,
  patch?: WorkPlanTopLevelPatch,
) {
  if (!patch) return
  const protectedTasks = protectedTaskIds(hierarchy)
  if (protectedTasks.size === 0) return

  if (
    patch.goal !== undefined ||
    patch.assumptions !== undefined ||
    patch.outOfScope !== undefined ||
    patch.authorityRefs !== undefined
  ) {
    throw new Error(
      "Plan goal/assumption/scope/authority changes while Tasks are claimed or complete require a new Plan generation.",
    )
  }

  const oldObligations = before.obligations ?? []
  const newObligations = after.obligations
  for (const taskId of protectedTasks) {
    const oldOwned = oldObligations.filter((item) => item.taskIds.includes(taskId))
    const newOwned = newObligations.filter((item) => item.taskIds.includes(taskId))
    if (JSON.stringify(oldOwned) !== JSON.stringify(newOwned)) {
      throw new Error(
        `Plan amendment would rewrite obligation ownership for claimed/completed Task ${taskId}; release/replan or create a new Plan generation.`,
      )
    }

    const oldRisks = before.riskBoundaries.filter((item) => item.taskIds.includes(taskId))
    const newRisks = after.riskBoundaries.filter((item) => item.taskIds.includes(taskId))
    if (JSON.stringify(oldRisks) !== JSON.stringify(newRisks)) {
      throw new Error(
        `Plan amendment would rewrite risk boundaries already consumed by claimed/completed Task ${taskId}.`,
      )
    }

    const oldAcceptance = before.acceptanceCoverage.filter((item) => item.taskIds.includes(taskId))
    const newAcceptance = after.acceptanceCoverage.filter((item) => item.taskIds.includes(taskId))
    if (JSON.stringify(oldAcceptance) !== JSON.stringify(newAcceptance)) {
      throw new Error(
        `Plan amendment would rewrite acceptance coverage already consumed by claimed/completed Task ${taskId}.`,
      )
    }

    const oldRelationships = before.relationships.filter((item) => item.taskIds.includes(taskId))
    const newRelationships = after.relationships.filter((item) => item.taskIds.includes(taskId))
    if (JSON.stringify(oldRelationships) !== JSON.stringify(newRelationships)) {
      throw new Error(
        `Plan amendment would rewrite relationships for claimed/completed Task ${taskId}; release/replan or create a new Plan generation.`,
      )
    }

    const oldCorrectionRouting = before.correctionRouting.filter(
      (item) => !item.taskId || item.taskId === taskId,
    )
    const newCorrectionRouting = after.correctionRouting.filter(
      (item) => !item.taskId || item.taskId === taskId,
    )
    if (JSON.stringify(oldCorrectionRouting) !== JSON.stringify(newCorrectionRouting)) {
      throw new Error(
        `Plan amendment would rewrite correction routing for claimed/completed Task ${taskId}; release/replan or create a new Plan generation.`,
      )
    }
  }
}

function syncCurrentPlanNodes(
  hierarchy: WorkHierarchy,
  plan: WorkPlanDefinition,
  now: string,
) {
  const represented = new Set<string>()
  const nodes = currentGenerationNodes(hierarchy)
  const generation = hierarchy.generation

  const materialize = (
    id: string,
    type: WorkNode["type"],
    logicalId: string,
    title: string,
    parentId?: string,
    objective?: string,
    dependsOn?: string[],
  ) => {
    represented.add(id)
    const existing = nodes.find((node) => node.id === id)
    if (existing?.status === "superseded") {
      throw new Error(
        `Plan amendment cannot reuse removed ${type} id ${logicalId} inside generation ${generation}; use a new id or Plan generation.`,
      )
    }
    if (existing) {
      existing.title = title
      existing.parentId = parentId
      existing.objective = objective
      existing.dependsOn = dependsOn
      existing.updatedAt = now
      return existing
    }
    const created: WorkNode = {
      id,
      logicalId,
      type,
      title,
      status: "pending",
      generation,
      ...(parentId ? { parentId } : {}),
      ...(objective ? { objective } : {}),
      ...(dependsOn ? { dependsOn } : {}),
      createdAt: now,
      updatedAt: now,
    }
    hierarchy.nodes.push(created)
    return created
  }

  for (const phase of plan.phases) {
    const phaseId = phaseNodeId(generation, phase.id)
    materialize(phaseId, "phase", phase.id, phase.title, undefined, phase.objective)
    for (const wave of phase.waves) {
      const waveId = waveNodeId(generation, phase.id, wave.id)
      materialize(waveId, "wave", wave.id, wave.title, phaseId, wave.objective)
      for (const task of wave.tasks) {
        const id = taskNodeId(generation, task.id)
        materialize(id, "task", task.id, task.title, waveId, task.objective, [...task.dependsOn])
      }
    }
  }

  for (const node of nodes) {
    if (node.status === "superseded" || represented.has(node.id)) continue
    if (node.claimedByWorkflowId || node.status === "complete") {
      throw new Error(
        `Plan amendment attempted to remove protected ${node.type} ${node.logicalId}.`,
      )
    }
    node.status = "superseded"
    node.updatedAt = now
  }

  recomputeRollup(hierarchy, now)
}

function assertPatchKeys(
  patch: Record<string, unknown> | undefined,
  allowed: string[],
  label: string,
) {
  if (!patch || Object.keys(patch).length === 0) throw new Error(`${label} requires a non-empty patch.`)
  const unexpected = Object.keys(patch).filter((key) => !allowed.includes(key))
  if (unexpected.length) {
    throw new Error(`${label} does not accept fields: ${unexpected.join(", ")}.`)
  }
}

function assertAmendOperationShape(operation: WorkPlanAmendOperation) {
  if (operation.action === "patch-phase") {
    if (!operation.phaseId) throw new Error("patch-phase requires phaseId.")
    assertPatchKeys(operation.patch as Record<string, unknown>, ["title", "objective"], "patch-phase")
    return
  }
  if (operation.action === "patch-wave") {
    if (!operation.phaseId || !operation.waveId) throw new Error("patch-wave requires phaseId and waveId.")
    assertPatchKeys(
      operation.patch as Record<string, unknown>,
      ["title", "objective", "constraints"],
      "patch-wave",
    )
    return
  }
  if (operation.action === "patch-task") {
    if (!operation.taskId) throw new Error("patch-task requires taskId.")
    assertPatchKeys(
      operation.patch as Record<string, unknown>,
      [
        "title", "objective", "rationale", "dependsOn", "authorityRefs", "constraints",
        "acceptanceCriteria", "subtasks", "integration", "verify",
      ],
      "patch-task",
    )
    return
  }
  if (operation.action === "add-phase" && !operation.phase) throw new Error("add-phase requires phase.")
  if (operation.action === "remove-phase" && !operation.phaseId) throw new Error("remove-phase requires phaseId.")
  if (operation.action === "add-wave" && (!operation.phaseId || !operation.wave)) {
    throw new Error("add-wave requires phaseId and wave.")
  }
  if (operation.action === "remove-wave" && (!operation.phaseId || !operation.waveId)) {
    throw new Error("remove-wave requires phaseId and waveId.")
  }
  if (operation.action === "add-task" && (!operation.phaseId || !operation.waveId || !operation.task)) {
    throw new Error("add-task requires phaseId, waveId, and task.")
  }
  if (operation.action === "remove-task" && !operation.taskId) throw new Error("remove-task requires taskId.")
}

function operationLabel(operation: WorkPlanAmendOperation) {
  if (operation.action === "patch-phase" || operation.action === "remove-phase") {
    return `${operation.action}:${operation.phaseId}`
  }
  if (
    operation.action === "patch-wave" ||
    operation.action === "remove-wave" ||
    operation.action === "add-wave"
  ) {
    return `${operation.action}:${operation.phaseId}/${operation.action === "add-wave" ? operation.wave.id : operation.waveId}`
  }
  if (operation.action === "patch-task" || operation.action === "remove-task") {
    return `${operation.action}:${operation.taskId}`
  }
  if (operation.action === "add-task") return `add-task:${operation.task.id}`
  return `add-phase:${operation.phase.id}`
}

export function amendWorkPlan(
  hierarchy: WorkHierarchy,
  input: {
    expectedVersion: number
    reason: string
    by: string
    operations: WorkPlanAmendOperation[]
    planPatch?: WorkPlanTopLevelPatch
  },
  now: string,
) {
  if (input.expectedVersion !== hierarchy.version) {
    throw new Error(
      `Stale work version: expected=${input.expectedVersion}, current=${hierarchy.version}.`,
    )
  }
  const reason = nonEmpty(input.reason, "Plan amendment reason")
  if (input.operations.length > 16) throw new Error("Plan amendment exceeds maximum of 16 local operations.")
  if (input.operations.length === 0 && !input.planPatch) {
    throw new Error("Plan amendment requires at least one local operation or Plan metadata patch.")
  }

  const snapshot = currentPlan(hierarchy)
  if (!snapshot) throw new Error("Current Plan snapshot is missing.")
  if (snapshot.invalidated) throw new Error("Cannot amend an invalidated Plan; create a new generation.")

  const beforePlan: WorkPlanDefinition = {
    goal: snapshot.goal,
    assumptions: snapshot.assumptions,
    outOfScope: snapshot.outOfScope,
    authorityRefs: snapshot.authorityRefs,
    obligations: snapshot.obligations,
    riskBoundaries: snapshot.riskBoundaries,
    acceptanceCoverage: snapshot.acceptanceCoverage,
    relationships: snapshot.relationships,
    correctionRouting: snapshot.correctionRouting,
    phases: snapshot.phases,
  }
  const beforeTaskFingerprints = new Map(
    planTaskIds(beforePlan).map((taskId) => [taskId, planTaskSemanticFingerprint(beforePlan, taskId)]),
  )
  const beforeWaveFingerprints = new Map(
    planWaveKeys(beforePlan).map((key) => {
      const [phaseId, waveId] = key.split("/", 2)
      return [key, planWaveFingerprint(beforePlan, phaseId, waveId)]
    }),
  )

  const draft: WorkPlanDefinition = structuredClone({
    goal: snapshot.goal,
    assumptions: snapshot.assumptions,
    outOfScope: snapshot.outOfScope,
    authorityRefs: snapshot.authorityRefs,
    obligations: snapshot.obligations,
    riskBoundaries: snapshot.riskBoundaries,
    acceptanceCoverage: snapshot.acceptanceCoverage,
    relationships: snapshot.relationships,
    correctionRouting: snapshot.correctionRouting,
    phases: snapshot.phases,
  })

  const inversePlanPatch = input.planPatch
    ? Object.fromEntries(
        Object.keys(input.planPatch).map((key) => [
          key,
          structuredClone((draft as unknown as Record<string, unknown>)[key]),
        ]),
      ) as WorkPlanTopLevelPatch
    : undefined
  if (input.planPatch) Object.assign(draft, structuredClone(input.planPatch))

  const inverseOperations: WorkPlanAmendOperation[] = []
  for (const operation of input.operations) {
    assertAmendOperationShape(operation)
    if (operation.action === "patch-phase") {
      const phase = findPlanPhase(draft, operation.phaseId)
      if (phase) {
        inverseOperations.unshift({
          action: "patch-phase",
          phaseId: operation.phaseId,
          patch: Object.fromEntries(
            Object.keys(operation.patch).map((key) => [
              key,
              structuredClone((phase as unknown as Record<string, unknown>)[key]),
            ]),
          ) as WorkPlanPhasePatch,
        })
      }
      assertSemanticNodeMutable(hierarchy, phaseNode(hierarchy, operation.phaseId), `Phase ${operation.phaseId}`)
      if (!phase) throw new Error(`Phase ${operation.phaseId} not found.`)
      Object.assign(phase, structuredClone(operation.patch))
      continue
    }

    if (operation.action === "patch-wave") {
      const wave = findPlanWave(draft, operation.phaseId, operation.waveId)
      if (wave) {
        inverseOperations.unshift({
          action: "patch-wave",
          phaseId: operation.phaseId,
          waveId: operation.waveId,
          patch: Object.fromEntries(
            Object.keys(operation.patch).map((key) => [
              key,
              structuredClone((wave as unknown as Record<string, unknown>)[key]),
            ]),
          ) as WorkPlanWavePatch,
        })
      }
      assertSemanticNodeMutable(
        hierarchy,
        waveNode(hierarchy, operation.phaseId, operation.waveId),
        `Wave ${operation.phaseId}/${operation.waveId}`,
      )
      if (!wave) throw new Error(`Wave ${operation.phaseId}/${operation.waveId} not found.`)
      Object.assign(wave, structuredClone(operation.patch))
      continue
    }

    if (operation.action === "patch-task") {
      const located = findPlanTask(draft, operation.taskId)
      if (located) {
        inverseOperations.unshift({
          action: "patch-task",
          taskId: operation.taskId,
          patch: Object.fromEntries(
            Object.keys(operation.patch).map((key) => [
              key,
              structuredClone((located.task as unknown as Record<string, unknown>)[key]),
            ]),
          ) as WorkPlanTaskPatch,
        })
      }
      assertSemanticNodeMutable(hierarchy, taskNode(hierarchy, operation.taskId), `Task ${operation.taskId}`)
      if (!located) throw new Error(`Task ${operation.taskId} not found.`)
      Object.assign(located.task, structuredClone(operation.patch))
      continue
    }

    if (operation.action === "add-phase") {
      inverseOperations.unshift({ action: "remove-phase", phaseId: operation.phase.id })
      if (findPlanPhase(draft, operation.phase.id)) throw new Error(`Phase ${operation.phase.id} already exists.`)
      draft.phases.push(structuredClone(operation.phase))
      continue
    }

    if (operation.action === "remove-phase") {
      const existingPhase = findPlanPhase(draft, operation.phaseId)
      if (existingPhase) {
        inverseOperations.unshift({ action: "add-phase", phase: structuredClone(existingPhase) })
      }
      const node = phaseNode(hierarchy, operation.phaseId)
      if (!node) throw new Error(`Phase ${operation.phaseId} not found.`)
      const affected = [node, ...taskNodesUnder(hierarchy, node)]
      assertNoClaim(affected, `Phase ${operation.phaseId}`)
      if (affected.some((candidate) => candidate.status === "complete")) {
        throw new Error(`Phase ${operation.phaseId} contains completed work and cannot be removed in-place.`)
      }
      draft.phases = draft.phases.filter((phase) => phase.id !== operation.phaseId)
      continue
    }

    if (operation.action === "add-wave") {
      inverseOperations.unshift({
        action: "remove-wave",
        phaseId: operation.phaseId,
        waveId: operation.wave.id,
      })
      const phase = findPlanPhase(draft, operation.phaseId)
      if (!phase) throw new Error(`Phase ${operation.phaseId} not found.`)
      const parentNode = phaseNode(hierarchy, operation.phaseId)
      if (parentNode?.status === "complete") {
        throw new Error(`Completed Phase ${operation.phaseId} cannot receive a new Wave in-place.`)
      }
      if (phase.waves.some((wave) => wave.id === operation.wave.id)) {
        throw new Error(`Wave ${operation.phaseId}/${operation.wave.id} already exists.`)
      }
      phase.waves.push(structuredClone(operation.wave))
      continue
    }

    if (operation.action === "remove-wave") {
      const phase = findPlanPhase(draft, operation.phaseId)
      const existingWave = findPlanWave(draft, operation.phaseId, operation.waveId)
      if (existingWave) {
        inverseOperations.unshift({
          action: "add-wave",
          phaseId: operation.phaseId,
          wave: structuredClone(existingWave),
        })
      }
      const node = waveNode(hierarchy, operation.phaseId, operation.waveId)
      if (!phase || !node) throw new Error(`Wave ${operation.phaseId}/${operation.waveId} not found.`)
      const affected = [node, ...taskNodesUnder(hierarchy, node)]
      assertNoClaim(affected, `Wave ${operation.phaseId}/${operation.waveId}`)
      if (affected.some((candidate) => candidate.status === "complete")) {
        throw new Error(`Wave ${operation.phaseId}/${operation.waveId} contains completed work and cannot be removed in-place.`)
      }
      phase.waves = phase.waves.filter((wave) => wave.id !== operation.waveId)
      continue
    }

    if (operation.action === "add-task") {
      inverseOperations.unshift({
        action: "remove-task",
        taskId: operation.task.id,
      })
      const wave = findPlanWave(draft, operation.phaseId, operation.waveId)
      if (!wave) throw new Error(`Wave ${operation.phaseId}/${operation.waveId} not found.`)
      const parentNode = waveNode(hierarchy, operation.phaseId, operation.waveId)
      if (!parentNode) throw new Error(`Wave ${operation.phaseId}/${operation.waveId} is not materialized.`)
      if (parentNode.status === "complete") {
        throw new Error(`Reviewed-complete Wave ${operation.phaseId}/${operation.waveId} cannot receive a new Task in-place.`)
      }
      assertNoClaim([parentNode, ...taskNodesUnder(hierarchy, parentNode)], `Wave ${operation.phaseId}/${operation.waveId}`)
      if (findPlanTask(draft, operation.task.id)) throw new Error(`Task ${operation.task.id} already exists.`)
      wave.tasks.push(structuredClone(operation.task))
      continue
    }

    if (operation.action === "remove-task") {
      const located = findPlanTask(draft, operation.taskId)
      if (located) {
        inverseOperations.unshift({
          action: "add-task",
          phaseId: located.phase.id,
          waveId: located.wave.id,
          task: structuredClone(located.task),
        })
      }
      const node = taskNode(hierarchy, operation.taskId)
      if (!located || !node) throw new Error(`Task ${operation.taskId} not found.`)
      assertNoClaim([node], `Task ${operation.taskId}`)
      if (node.status === "complete") {
        throw new Error(`Completed Task ${operation.taskId} cannot be removed in-place.`)
      }
      located.wave.tasks = located.wave.tasks.filter((task) => task.id !== operation.taskId)
      continue
    }
  }

  const validated = validateWorkPlan(draft)
  assertPlanPatchDoesNotRewriteCompletedWork(hierarchy, snapshot, validated, input.planPatch)

  const allTaskIds = new Set([...beforeTaskFingerprints.keys(), ...planTaskIds(validated)])
  const changedTaskIds = [...allTaskIds].filter(
    (taskId) =>
      beforeTaskFingerprints.get(taskId) !== planTaskSemanticFingerprint(validated, taskId),
  )
  const allWaveKeys = new Set([...beforeWaveFingerprints.keys(), ...planWaveKeys(validated)])
  const changedWaveKeys = [...allWaveKeys].filter((key) => {
    const [phaseId, waveId] = key.split("/", 2)
    return beforeWaveFingerprints.get(key) !== planWaveFingerprint(validated, phaseId, waveId)
  })

  syncCurrentPlanNodes(hierarchy, validated, now)

  const nextRevision = (snapshot.revision ?? 1) + 1
  const amendment: WorkPlanAmendmentRecord = {
    revision: nextRevision,
    by: nonEmpty(input.by, "Plan amendment actor"),
    reason,
    operations: [
      ...input.operations.map(operationLabel),
      ...(input.planPatch ? ["patch-plan-metadata"] : []),
    ],
    at: now,
    ...(inverseOperations.length > 0
      ? { inverseOperations: structuredClone(inverseOperations) }
      : {}),
    ...(inversePlanPatch ? { inversePlanPatch: structuredClone(inversePlanPatch) } : {}),
  }
  const updated: WorkPlanSnapshot = {
    ...validated,
    generation: snapshot.generation,
    revision: nextRevision,
    amendments: [...(snapshot.amendments ?? []), amendment],
  }
  const generationPlans = hierarchy.plans!.filter(
    (plan) => plan.generation === hierarchy.generation,
  )
  const planIndex = hierarchy.plans!.indexOf(snapshot)
  if (generationPlans.length > 1) {
    // Compatibility with early rich-Plan builds that stored one full snapshot
    // per revision. Preserve those exact historical snapshots while new
    // revisions transition to delta-backed history.
    hierarchy.plans!.push(updated)
  } else {
    hierarchy.plans![planIndex] = updated
  }
  hierarchy.version++
  hierarchy.updatedAt = now
  return { hierarchy, plan: updated, amendment, changedTaskIds, changedWaveKeys }
}

export function invalidateWorkPlan(
  hierarchy: WorkHierarchy,
  input: { expectedVersion: number; reason: string; by: string },
  now: string,
) {
  if (input.expectedVersion !== hierarchy.version) {
    throw new Error(
      `Stale work version: expected=${input.expectedVersion}, current=${hierarchy.version}.`,
    )
  }
  const snapshot = currentPlan(hierarchy)
  if (!snapshot) throw new Error("Current Plan snapshot is missing.")
  if (snapshot.invalidated) return { hierarchy, plan: snapshot }

  const nodes = currentGenerationNodes(hierarchy)
  assertNoClaim(nodes, "Plan")
  const updated: WorkPlanSnapshot = {
    ...structuredClone(snapshot),
    invalidated: {
      by: nonEmpty(input.by, "Plan invalidation actor"),
      reason: nonEmpty(input.reason, "Plan invalidation reason"),
      at: now,
    },
  }
  const planIndex = hierarchy.plans!.indexOf(snapshot)
  hierarchy.plans![planIndex] = updated
  hierarchy.version++
  hierarchy.objectiveStatus = "active"
  hierarchy.updatedAt = now
  return { hierarchy, plan: updated }
}

export function workTree(hierarchy: WorkHierarchy): WorkTree {
  const nodes = activeNodes(hierarchy)
  const phases = nodes.filter((node) => node.type === "phase")

  return {
    objective: {
      id: hierarchy.objectiveId,
      title: hierarchy.title,
      status: hierarchy.objectiveStatus,
      progress: progressFor(hierarchy),
    },
    generation: hierarchy.generation,
    phases: phases.map((phase) => {
      const waves = nodes.filter((node) => node.type === "wave" && node.parentId === phase.id)
      return {
        id: phase.logicalId,
        title: phase.title,
        status: phase.status,
        progress: progressFor(hierarchy, phase.id),
        waves: waves.map((wave) => ({
          id: wave.logicalId,
          title: wave.title,
          status: wave.status,
          progress: progressFor(hierarchy, wave.id),
          tasks: nodes
            .filter((node) => node.type === "task" && node.parentId === wave.id)
            .map((task) => ({
              id: task.logicalId,
              title: task.title,
              status: task.status,
            })),
        })),
      }
    }),
  }
}

function recomputeRollup(hierarchy: WorkHierarchy, now: string) {
  const nodes = activeNodes(hierarchy)
  const waves = nodes.filter((node) => node.type === "wave")
  for (const wave of waves) {
    const tasks = nodes.filter((node) => node.type === "task" && node.parentId === wave.id)
    const allTasksComplete = tasks.length > 0 && tasks.every((task) => task.status === "complete")
    const started =
      Boolean(wave.claimedByWorkflowId) ||
      tasks.some((task) => task.status === "complete" || task.status === "active")

    // Task completion makes a Wave reviewable, not complete. Wave completion is
    // an explicit transition after review-implementation passes.
    let next: WorkNodeStatus
    if (wave.status === "complete" && allTasksComplete) next = "complete"
    else next = started ? "active" : "pending"

    if (wave.status !== next) {
      wave.status = next
      wave.updatedAt = now
    }
  }

  const phases = nodes.filter((node) => node.type === "phase")
  for (const phase of phases) {
    const childWaves = waves.filter((wave) => wave.parentId === phase.id)
    const complete = childWaves.length > 0 && childWaves.every((wave) => wave.status === "complete")
    const started = childWaves.some((wave) => wave.status === "complete" || wave.status === "active")
    const next: WorkNodeStatus = complete ? "complete" : started ? "active" : "pending"
    if (phase.status !== next) {
      phase.status = next
      phase.updatedAt = now
    }
  }

  if (
    hierarchy.objectiveStatus === "complete" &&
    phases.some((phase) => phase.status !== "complete")
  ) {
    hierarchy.objectiveStatus = "active"
  }
}

export function syncWorkTaskStatuses(
  hierarchy: WorkHierarchy,
  workflowId: string,
  generation: number,
  statuses: Array<{
    taskId: string
    complete: boolean
    result?: {
      workflowId: string
      summary?: string
      evidenceClaimIds: string[]
      completedAt: string
    }
  }>,
  now: string,
) {
  assertWorkGeneration(hierarchy, generation)
  const tasks = activeTaskMap(hierarchy)
  let changed = false

  for (const entry of statuses) {
    const task = tasks.get(entry.taskId)
    if (!task) continue
    if (task.claimedByWorkflowId !== workflowId) {
      throw new Error(
        `Workflow ${workflowId} does not own Task ${entry.taskId}; claimed by ${task.claimedByWorkflowId ?? "nobody"}.`,
      )
    }
    const next: WorkNodeStatus = entry.complete ? "complete" : "pending"
    if (!entry.complete && task.result) {
      delete task.result
      changed = true
    }
    if (entry.complete && entry.result && JSON.stringify(task.result) !== JSON.stringify(entry.result)) {
      task.result = entry.result
      changed = true
    }
    if (task.status !== next) {
      task.status = next
      task.updatedAt = now
      changed = true
    }
  }

  recomputeRollup(hierarchy, now)
  if (changed) {
    hierarchy.version++
    hierarchy.updatedAt = now
  }
  return hierarchy
}

export function completeWaveForTasks(
  hierarchy: WorkHierarchy,
  workflowId: string,
  generation: number,
  taskIds: string[],
  now: string,
) {
  assertWorkGeneration(hierarchy, generation)
  const tasks = activeTaskMap(hierarchy)
  const selected = taskIds.map((id) => tasks.get(id))
  if (selected.some((task) => !task)) throw new Error("Wave completion references unknown Task.")
  const parentIds = new Set(selected.map((task) => task!.parentId))
  if (parentIds.size !== 1) throw new Error("Wave completion Tasks must belong to exactly one Wave.")

  const waveId = [...parentIds][0]!
  const wave = activeNodes(hierarchy).find((node) => node.id === waveId && node.type === "wave")
  if (!wave) throw new Error("Wave not found.")
  if (wave.claimedByWorkflowId !== workflowId) {
    throw new Error(
      `Workflow ${workflowId} does not own Wave ${wave.logicalId}; claimed by ${wave.claimedByWorkflowId ?? "nobody"}.`,
    )
  }

  const waveTasks = activeNodes(hierarchy).filter(
    (node) => node.type === "task" && node.parentId === wave.id,
  )
  if (waveTasks.some((task) => task.status !== "complete")) {
    throw new Error("Wave cannot complete before every Task is complete.")
  }
  // A replacement workflow may execute only the remaining Tasks. Previously
  // completed, unclaimed Tasks stay historical inputs to the assembled review.
  if (selected.some((task) => task!.claimedByWorkflowId !== workflowId) ||
      waveTasks.some((task) => task.claimedByWorkflowId && task.claimedByWorkflowId !== workflowId)) {
    throw new Error("Wave cannot complete because one or more Tasks have conflicting ownership.")
  }

  wave.completion = {
    workflowId, generation, taskIds: [...taskIds].sort(),
    reviewedTaskIds: waveTasks.map((task) => task.logicalId).sort(),
    at: now, provenance: "implementation-review",
  }
  wave.status = "complete"
  delete wave.claimedByWorkflowId
  delete wave.claimedAt
  for (const task of waveTasks) {
    if (task.claimedByWorkflowId !== workflowId) continue
    delete task.claimedByWorkflowId
    delete task.claimedAt
    task.updatedAt = now
  }
  wave.updatedAt = now
  recomputeRollup(hierarchy, now)
  hierarchy.version++
  hierarchy.updatedAt = now
  return hierarchy
}

export function reopenWaveForTasks(
  hierarchy: WorkHierarchy,
  workflowId: string,
  generation: number,
  taskIds: string[],
  now: string,
) {
  assertWorkGeneration(hierarchy, generation)
  const tasks = activeTaskMap(hierarchy)
  const selected = taskIds.map((id) => tasks.get(id))
  if (selected.some((task) => !task)) return hierarchy
  const parentIds = new Set(selected.map((task) => task!.parentId))
  if (parentIds.size !== 1) return hierarchy

  const waveId = [...parentIds][0]!
  const wave = activeNodes(hierarchy).find((node) => node.id === waveId && node.type === "wave")
  if (!wave || wave.status !== "complete") return hierarchy
  assertCompletedWaveForTasks(hierarchy, workflowId, generation, taskIds)

  // Reopening invalidates the whole assembled Wave receipt, not just the
  // Tasks this (possibly partial-recovery) workflow executed. Admission of a
  // downstream Task depended on that whole Wave having passed review.
  const dependentIds = new Set(activeNodes(hierarchy)
    .filter((node) => node.type === "task" && node.parentId === wave.id)
    .map((node) => node.logicalId))
  let changed = true
  while (changed) {
    changed = false
    for (const task of activeNodes(hierarchy).filter((node) => node.type === "task")) {
      if (!dependentIds.has(task.logicalId) && task.dependsOn?.some((id) => dependentIds.has(id))) {
        dependentIds.add(task.logicalId)
        changed = true
      }
    }
  }
  if (activeNodes(hierarchy).some((node) => node.type === "task" && node.parentId !== wave.id &&
      dependentIds.has(node.logicalId) && (node.status === "complete" || node.claimedByWorkflowId))) {
    throw new Error("Cannot reopen a Wave already consumed by downstream work; cancel/replan the affected work explicitly.")
  }

  delete wave.completion
  wave.claimedByWorkflowId = workflowId
  wave.claimedAt = now
  for (const task of selected) {
    task!.claimedByWorkflowId = workflowId
    task!.claimedAt = now
    task!.updatedAt = now
  }
  wave.status = "active"
  wave.updatedAt = now
  recomputeRollup(hierarchy, now)
  hierarchy.version++
  hierarchy.updatedAt = now
  return hierarchy
}

export function completeObjective(hierarchy: WorkHierarchy, generation: number, now: string) {
  assertWorkGeneration(hierarchy, generation)
  const phases = activeNodes(hierarchy).filter((node) => node.type === "phase")
  if (phases.length === 0) throw new Error("Objective has no active work plan.")
  if (phases.some((phase) => phase.status !== "complete")) {
    throw new Error("Objective cannot complete while active Phases remain incomplete.")
  }

  const blockedObligations =
    currentPlan(hierarchy)?.obligations.filter((obligation) => obligation.disposition === "blocked") ?? []
  if (blockedObligations.length > 0) {
    throw new Error(
      `Objective cannot complete while Plan obligations remain blocked: ${blockedObligations.map((obligation) => obligation.id).join(", ")}.`,
    )
  }

  if (hierarchy.objectiveStatus !== "complete") {
    hierarchy.objectiveStatus = "complete"
    hierarchy.version++
    hierarchy.updatedAt = now
  }
  return hierarchy
}

/** Validate reviewed history without resurrecting an execution claim. */
export function assertCompletedWaveForTasks(
  hierarchy: WorkHierarchy,
  workflowId: string,
  generation: number,
  taskIds: string[],
) {
  assertWorkGeneration(hierarchy, generation)
  const tasks = activeTaskMap(hierarchy)
  const selected = taskIds.map((id) => tasks.get(id))
  if (!taskIds.length || new Set(taskIds).size !== taskIds.length || selected.some((task) => !task)) {
    throw new Error("Completed Wave references invalid Tasks.")
  }
  const parents = new Set(selected.map((task) => task!.parentId))
  const wave = parents.size === 1
    ? activeNodes(hierarchy).find((node) => node.id === selected[0]!.parentId && node.type === "wave")
    : undefined
  if (!wave || wave.status !== "complete" || wave.claimedByWorkflowId) {
    throw new Error("Workflow has no unclaimed completed Wave history.")
  }
  const all = activeNodes(hierarchy).filter((node) => node.type === "task" && node.parentId === wave.id)
  const receipt = wave.completion
  if (!receipt || receipt.workflowId !== workflowId || receipt.generation !== generation ||
      JSON.stringify([...receipt.taskIds].sort()) !== JSON.stringify([...taskIds].sort()) ||
      JSON.stringify([...receipt.reviewedTaskIds].sort()) !== JSON.stringify(all.map((task) => task.logicalId).sort()) ||
      all.some((task) => task.status !== "complete" || task.claimedByWorkflowId)) {
    throw new Error("Completed Wave history does not prove this workflow's implementation review.")
  }
  return wave
}

/** Cancellation releases only this workflow's claims, including stale generations. */
export function releaseCancelledWorkflowClaims(hierarchy: WorkHierarchy, workflowId: string, now: string) {
  const released: string[] = []
  for (const node of hierarchy.nodes) {
    if (node.claimedByWorkflowId !== workflowId) continue
    delete node.claimedByWorkflowId
    delete node.claimedAt
    // Completion/evidence records are never rewritten by cancellation.
    if (node.status !== "complete") node.updatedAt = now
    released.push(node.id)
  }
  if (released.length) {
    recomputeRollup(hierarchy, now)
    hierarchy.version++
    hierarchy.updatedAt = now
  }
  return released
}

export function assertWaveClaimForTasks(
  hierarchy: WorkHierarchy,
  workflowId: string,
  generation: number,
  taskIds: string[],
) {
  assertWorkGeneration(hierarchy, generation)
  const tasks = activeTaskMap(hierarchy)
  const selected = taskIds.map((id) => tasks.get(id))
  if (selected.some((task) => !task)) {
    throw new Error("Workflow references Tasks outside the current work generation.")
  }

  const parentIds = new Set(selected.map((task) => task!.parentId))
  if (parentIds.size !== 1) throw new Error("Workflow Tasks must belong to exactly one Wave.")

  const waveId = [...parentIds][0]!
  const wave = activeNodes(hierarchy).find((node) => node.id === waveId && node.type === "wave")
  if (!wave) throw new Error("Wave not found.")
  if (wave.claimedByWorkflowId !== workflowId) {
    throw new Error(
      `Wave ${wave.logicalId} is claimed by ${wave.claimedByWorkflowId ?? "nobody"}, not ${workflowId}.`,
    )
  }
  if (selected.some((task) => task!.claimedByWorkflowId !== workflowId)) {
    throw new Error("One or more workflow Tasks are not claimed by this workflow.")
  }
  return wave
}

export function claimWorkflowWave(
  hierarchy: WorkHierarchy,
  workflowId: string,
  generation: number,
  tasks: TaskSpec[],
  objectiveClosure: boolean,
  now: string,
) {
  assertWorkGeneration(hierarchy, generation)
  const wave = validateWorkflowWave(hierarchy, tasks, objectiveClosure)
  const taskMap = activeTaskMap(hierarchy)
  const selected = tasks.map((task) => taskMap.get(task.id)!)

  if (wave.claimedByWorkflowId && wave.claimedByWorkflowId !== workflowId) {
    throw new Error(
      `Wave ${wave.logicalId} is already claimed by workflow ${wave.claimedByWorkflowId}.`,
    )
  }
  const conflicting = selected.find(
    (task) => task.claimedByWorkflowId && task.claimedByWorkflowId !== workflowId,
  )
  if (conflicting) {
    throw new Error(
      `Task ${conflicting.logicalId} is already claimed by workflow ${conflicting.claimedByWorkflowId}.`,
    )
  }

  wave.claimedByWorkflowId = workflowId
  wave.claimedAt = now
  wave.status = "active"
  wave.updatedAt = now
  for (const task of selected) {
    task.claimedByWorkflowId = workflowId
    task.claimedAt = now
    task.updatedAt = now
  }

  recomputeRollup(hierarchy, now)
  hierarchy.version++
  hierarchy.updatedAt = now
  return wave
}

export function releaseWorkflowWave(
  hierarchy: WorkHierarchy,
  workflowId: string,
  generation: number,
  taskIds: string[],
  now: string,
) {
  const wave = assertWaveClaimForTasks(hierarchy, workflowId, generation, taskIds)
  const tasks = activeTaskMap(hierarchy)

  delete wave.claimedByWorkflowId
  delete wave.claimedAt
  wave.updatedAt = now

  for (const taskId of taskIds) {
    const task = tasks.get(taskId)!
    delete task.claimedByWorkflowId
    delete task.claimedAt
    task.updatedAt = now
  }

  recomputeRollup(hierarchy, now)
  hierarchy.version++
  hierarchy.updatedAt = now
  return hierarchy
}

export function objectiveWorkLevel(hierarchy: WorkHierarchy): "wave" | "objective" {
  const remainingWaves = activeNodes(hierarchy).filter(
    (node) =>
      node.type === "wave" &&
      node.status !== "complete" &&
      node.status !== "cancelled",
  )
  return remainingWaves.length > 1 ? "wave" : "objective"
}

export function validateWorkflowWave(
  hierarchy: WorkHierarchy,
  tasks: TaskSpec[],
  objectiveClosure: boolean,
) {
  if (hierarchy.generation <= 0) throw new Error("Persistent work plan is missing.")

  const taskMap = activeTaskMap(hierarchy)
  const selected = new Set(tasks.map((task) => task.id))

  for (const task of tasks) {
    const workTask = taskMap.get(task.id)
    if (!workTask) throw new Error(`Workflow Task ${task.id} is not in the current work-plan generation.`)
    if (workTask.status === "complete") throw new Error(`Workflow Task ${task.id} is already complete.`)
    if (workTask.claimedByWorkflowId && workTask.claimedByWorkflowId !== "") {
      throw new Error(
        `Workflow Task ${task.id} is already claimed by workflow ${workTask.claimedByWorkflowId}.`,
      )
    }
    if (task.title.trim() !== workTask.title) {
      throw new Error(`Workflow Task ${task.id} title differs from the persistent work plan.`)
    }
    if (task.objective.trim() !== workTask.objective) {
      throw new Error(`Workflow Task ${task.id} objective differs from the persistent work plan.`)
    }

    const contract = plannedTask(planSnapshot(hierarchy), task.id)
    if (!contract) throw new Error(`Workflow Task ${task.id} has no persistent semantic contract.`)
    const exactFields: Array<[string, unknown, unknown]> = [
      ["rationale", task.rationale ?? "", contract.rationale],
      ["authorityRefs", task.authorityRefs ?? [], contract.authorityRefs],
      ["constraints", task.constraints ?? [], contract.constraints],
      ["acceptanceCriteria", task.acceptanceCriteria ?? [], contract.acceptanceCriteria],
      ["subtasks", task.subtasks ?? [], contract.subtasks],
      ["integration", task.integration ?? [], contract.integration],
      ["verify", task.verify, contract.verify],
    ]
    for (const [field, actual, expected] of exactFields) {
      if (JSON.stringify(actual) !== JSON.stringify(expected)) {
        throw new Error(`Workflow Task ${task.id} ${field} differs from the persistent work plan.`)
      }
    }
  }

  const parentIds = new Set(tasks.map((task) => taskMap.get(task.id)!.parentId))
  if (parentIds.size !== 1) {
    throw new Error("A bounded workflow task plan must execute Tasks from exactly one Wave.")
  }

  const waveId = [...parentIds][0]!
  const waveTasks = [...taskMap.values()].filter((task) => task.parentId === waveId)
  const remainingWaveTasks = waveTasks.filter((task) => task.status !== "complete")

  if (
    remainingWaveTasks.some((task) => !selected.has(task.logicalId)) ||
    [...selected].some((id) => !remainingWaveTasks.some((task) => task.logicalId === id))
  ) {
    throw new Error("Workflow task plan must contain exactly the remaining Tasks in its selected Wave.")
  }

  for (const task of remainingWaveTasks) {
    for (const dependency of task.dependsOn ?? []) {
      const dep = taskMap.get(dependency)
      if (!dep) throw new Error(`Work Task ${task.logicalId} depends on missing Task ${dependency}.`)
      if (dep.parentId !== waveId) {
        const dependencyWave = activeNodes(hierarchy).find(
          (node) => node.id === dep.parentId && node.type === "wave",
        )
        if (dep.status !== "complete" || dependencyWave?.status !== "complete") {
          throw new Error(
            `Wave is not runnable: Task ${task.logicalId} waits for incomplete reviewed external Task ${dependency}.`,
          )
        }
      }
    }

    const expectedLocal = (task.dependsOn ?? []).filter((dependency) => selected.has(dependency)).sort()
    const actualLocal = [...new Set(tasks.find((candidate) => candidate.id === task.logicalId)!.dependsOn)].sort()
    if (JSON.stringify(expectedLocal) !== JSON.stringify(actualLocal)) {
      throw new Error(
        `Workflow Task ${task.logicalId} dependencies must match current-Wave work-plan dependencies.`,
      )
    }
  }

  if (objectiveClosure && objectiveWorkLevel(hierarchy) === "wave") {
    throw new Error(
      "Objective-scoped workflow may execute only the final remaining Wave.",
    )
  }

  return activeNodes(hierarchy).find((node) => node.id === waveId)!
}

export function nextRunnableWaves(hierarchy: WorkHierarchy) {
  const nodes = activeNodes(hierarchy)
  const tasks = activeTaskMap(hierarchy)
  return nodes
    .filter(
      (node) =>
        node.type === "wave" &&
        node.status !== "complete" &&
        node.status !== "cancelled" &&
        !node.claimedByWorkflowId,
    )
    .filter((wave) =>
      nodes.some(
        (node) => node.type === "task" && node.parentId === wave.id && node.status !== "complete",
      ),
    )
    .filter((wave) =>
      nodes
        .filter((node) => node.type === "task" && node.parentId === wave.id && node.status !== "complete")
        .every((task) =>
          (task.dependsOn ?? []).every((dependency) => {
            const dep = tasks.get(dependency)
            if (!dep) return false
            if (dep.parentId === wave.id) return true
            const dependencyWave = nodes.find(
              (node) => node.id === dep.parentId && node.type === "wave",
            )
            return dep.status === "complete" && dependencyWave?.status === "complete"
          }),
        ),
    )
    .map((wave) => ({
      id: wave.logicalId,
      title: wave.title,
      phaseId: nodes.find((node) => node.id === wave.parentId)?.logicalId ?? "",
      progress: progressFor(hierarchy, wave.id),
    }))
}
