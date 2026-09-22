import type { OpenQuestion } from "./oq"
import { plannedTaskSteps, runnable, type Workflow } from "./workflow"
import { workTree, type WorkHierarchy } from "./work"
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
    pending.length === 0
      ? "complete"
      : failed.length > 0 && ready.length === 0
        ? "blocked"
        : "active"

  let work: LoomSidebarWork | undefined
  if (hierarchy) {
    const tree = workTree(hierarchy)
    work = {
      ...tree,
      phases: tree.phases.map((phase) => ({
        ...phase,
        waves: phase.waves.map((wave) => ({
          ...wave,
          tasks: wave.tasks.map((task) => ({
            ...task,
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
