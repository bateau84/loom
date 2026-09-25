import type { OpenQuestion } from "./oq"
import { plannedTaskSteps, planningOnlyObjective, runnable, type Workflow } from "./workflow"
import { workPlanContext, workTree, type WorkHierarchy } from "./work"
import type {
  LoomSidebarSnapshot,
  LoomSidebarTaskStatus,
  LoomSidebarWork,
} from "./rpc"

export function buildSidebarSnapshot(
  workflow?: Workflow,
  questions: OpenQuestion[] = [],
  hierarchy?: WorkHierarchy,
  statusUrl?: string,
): LoomSidebarSnapshot {
  if (!workflow) {
    return {
      active: false,
      workflowId: "",
      state: "idle",
      progress: { finished: 0, total: 0, failed: 0 },
      tasks: [],
      now: [],
      openQuestions: 0,
      openVerification: 0,
    }
  }

  const ready = runnable(workflow)
  const readyIDs = new Set(ready.map((step) => step.id))
  const readyTaskIDs = new Set(
    ready.filter((step) => step.task).map((step) => step.task!.id),
  )
  const failed = workflow.steps.filter((step) => step.status === "failed")
  const pending = workflow.steps.filter((step) => step.status === "pending")
  const finished = workflow.steps.filter((step) =>
    ["complete", "passed", "failed"].includes(step.status),
  )

  const state: LoomSidebarSnapshot["state"] =
    workflow.cancellation ? "cancelled" :
    pending.length === 0
      ? "complete"
      : failed.length > 0 && ready.length === 0
        ? "blocked"
        : "active"

  let work: LoomSidebarWork | undefined
  if (hierarchy) {
    const tree = workTree(hierarchy)
    const plan = workPlanContext(hierarchy, undefined, "full")
    const planPhase = (phaseId: string) => plan?.planMap?.find((phase) => phase.id === phaseId)
    const planWave = (phaseId: string, waveId: string) =>
      planPhase(phaseId)?.waves.find((wave) => wave.id === waveId)
    const planTask = (taskId: string) =>
      plan?.planMap?.flatMap((phase) => phase.waves.flatMap((wave) => wave.tasks)).find((task) => task.id === taskId)
    const openOqsForTask = (taskId: string) =>
      questions.filter(
        (question) =>
          question.status !== "closed" &&
          question.work?.objectiveId === hierarchy.objectiveId &&
          question.work?.generation === hierarchy.generation &&
          (question.work?.revision === undefined || question.work.revision === plan?.revision) &&
          question.work?.taskId === taskId,
      ).length

    work = {
      ...tree,
      ...(plan
        ? {
            plan: {
              revision: plan.revision,
              goal: plan.goal.length > 72 ? plan.goal.slice(0, 69) + "…" : plan.goal,
              ...(plan.invalidated ? { invalidated: true } : {}),
            },
          }
        : {}),
      phases: tree.phases.map((phase) => ({
        ...phase,
        ...(planPhase(phase.id)?.objective ? { objective: planPhase(phase.id)!.objective } : {}),
        waves: phase.waves.map((wave) => ({
          ...wave,
          ...(planWave(phase.id, wave.id)?.objective
            ? { objective: planWave(phase.id, wave.id)!.objective }
            : {}),
          tasks: wave.tasks.map((task) => ({
            ...task,
            ...(planTask(task.id)?.objective ? { objective: planTask(task.id)!.objective } : {}),
            ...(openOqsForTask(task.id) ? { openQuestions: openOqsForTask(task.id) } : {}),
            status:
              task.status === "complete"
                ? "complete"
                : readyTaskIDs.has(task.id)
                  ? "runnable"
                  : "pending",
          })),
        })),
      })),
    }
  }

  return {
    active: true,
    workflowId: workflow.id,
    state,
    ...(planningOnlyObjective(workflow.effects) ? { planningOnly: true } : {}),
    progress: {
      finished: finished.length,
      total: workflow.steps.length,
      failed: failed.length,
    },
    ...(work ? { work } : {}),
    ...(statusUrl ? { statusUrl } : {}),
    tasks: plannedTaskSteps(workflow).map((step) => {
      let status: LoomSidebarTaskStatus = "pending"
      if (step.status === "failed") status = "failed"
      else if (step.status === "complete") status = "complete"
      else if (readyIDs.has(step.id)) status = "runnable"

      return {
        id: step.task!.id,
        title: step.task!.title,
        status,
      }
    }),
    now: ready.map((step) => ({
      id: step.id,
      label: step.task?.title ?? step.id,
      agent: step.agent,
      kind: step.kind,
    })),
    openQuestions: questions.filter((question) => question.status !== "closed").length,
    openVerification: (workflow.verification ?? []).filter(
      (requirement) => requirement.status === "open",
    ).length,
  }
}

export function selectSidebarTasks(
  tasks: LoomSidebarSnapshot["tasks"],
  maxRows = 12,
) {
  if (tasks.length <= maxRows) return tasks

  const important = new Set(
    tasks
      .filter((task) => task.status === "runnable" || task.status === "failed")
      .map((task) => task.id),
  )
  let ordinarySlots = Math.max(0, maxRows - important.size)

  return tasks.filter((task) => {
    if (important.has(task.id)) return true
    if (ordinarySlots <= 0) return false
    ordinarySlots--
    return true
  })
}
