import type { OpenQuestion } from "./oq"
import { plannedTaskSteps, runnable, type Workflow } from "./workflow"
import type { LoomSidebarSnapshot, LoomSidebarTaskStatus } from "./rpc"

export function buildSidebarSnapshot(
  workflow?: Workflow,
  questions: OpenQuestion[] = [],
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

  return {
    active: true,
    workflowId: workflow.id,
    state,
    progress: {
      finished: finished.length,
      total: workflow.steps.length,
      failed: failed.length,
    },
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
