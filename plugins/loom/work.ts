import type { TaskSpec } from "./tasks"

export const MAX_WORK_PHASES = 32
export const MAX_WORK_WAVES = 128
export const MAX_WORK_TASKS = 256

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
  objective: string
  dependsOn: string[]
}

export type WorkPlanWave = {
  id: string
  title: string
  tasks: WorkPlanTask[]
}

export type WorkPlanPhase = {
  id: string
  title: string
  waves: WorkPlanWave[]
}

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
  return id
}

function nonEmpty(value: string, label: string) {
  const text = value.trim()
  if (!text) throw new Error(`${label} is required.`)
  return text
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

export function validateWorkPlan(phases: WorkPlanPhase[]) {
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
          dependsOn: [...new Set(taskInput.dependsOn.map((item) => normalizedId(item, "Task dependency")))],
        })
      }

      waves.push({
        id: waveId,
        title: nonEmpty(waveInput.title, `Wave ${waveKey} title`),
        tasks,
      })
    }

    normalized.push({
      id: phaseId,
      title: nonEmpty(phaseInput.title, `Phase ${phaseId} title`),
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
  phaseInputs: WorkPlanPhase[],
  now: string,
) {
  const phases = validateWorkPlan(phaseInputs)

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
}

function activeNodes(hierarchy: WorkHierarchy) {
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
  statuses: Array<{ taskId: string; complete: boolean }>,
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
