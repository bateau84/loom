import { redactCommand } from "./evidence"
import type { OpenQuestion } from "./oq"
import type { Step, Workflow } from "./workflow"

export type DashboardText = { text: string; truncated: boolean }
export type DashboardStepContext = Pick<Step, "id" | "agent" | "kind" | "status"> & {
  label?: string
  reportedResult?: DashboardText
}

/** Optional, bounded context from the same workflow read as the count projection. */
export type DashboardWorkflowContext = {
  version: 1
  request?: DashboardText
  coordinatorSessionId?: string
  steps: DashboardStepContext[]
  questions: Array<{
    id: string
    description: DashboardText
    status: "open" | "answered"
    requiredAuthority: string
    blocking: boolean
  }>
  verification: Array<{
    id: string
    description: DashboardText
    kind: string
    requestedBy: string
    beforeStep?: DashboardStepContext
  }>
  truncated: { steps: boolean; questions: boolean; verification: boolean }
  questionCountIsLowerBound: boolean
}

export const DASHBOARD_CONTEXT_ITEMS = 24
export const DASHBOARD_CONTEXT_STEPS = 100
export const DASHBOARD_CONTEXT_TEXT = 600

/** Linear scanning avoids ambiguous repeated regex branches on hostile escape sequences. */
function redactQuotedAssignments(value: string) {
  const prefix = /((?:["']?(?:api[_-]?key|token|password|secret)["']?)\s*[:=]\s*)(["'])/gi
  let result = ""
  let offset = 0
  let match: RegExpExecArray | null
  while ((match = prefix.exec(value)) !== null) {
    let end = prefix.lastIndex
    while (end < value.length) {
      if (value[end] === "\\") { end += 2; continue }
      if (value[end++] === match[2]) break
    }
    end = Math.min(end, value.length)
    result += value.slice(offset, match.index) + match[1] + "[REDACTED]"
    offset = end
    prefix.lastIndex = end
  }
  return result + value.slice(offset)
}

/** Defense in depth for authored summaries, not a guarantee that arbitrary text is secret-free. */
export function dashboardText(value: string | undefined): DashboardText {
  if (!value) return { text: "Description not recorded", truncated: false }
  if (value.length > 16_000) return { text: "Long description omitted. Inspect it in Loom.", truncated: true }
  const cleaned = redactCommand(redactQuotedAssignments(value
    .replace(/-----BEGIN [^-]*PRIVATE KEY-----[\s\S]*?(?:-----END [^-]*PRIVATE KEY-----|$)/g, "[PRIVATE KEY REDACTED]"))
    .replace(/(authorization\s*:\s*(?:bearer|basic)\s+)[^\s]+/gi, "$1[REDACTED]")
    .replace(/(https?:\/\/)[^\s/@]+:[^\s/@]+@/gi, "$1[REDACTED]@")
    .replace(/\b(?:gh[pousr]_[A-Za-z0-9_]{16,}|github_pat_[A-Za-z0-9_]{16,}|sk-[A-Za-z0-9_-]{16,})\b/g, "[REDACTED]"))
    .replace(/[\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]/g, " ")
    .replace(/\s+/g, " ").trim()
  const points = Array.from(cleaned)
  return {
    text: points.slice(0, DASHBOARD_CONTEXT_TEXT).join("") || "Description not recorded",
    truncated: points.length > DASHBOARD_CONTEXT_TEXT,
  }
}

function stepContext(step: Step): DashboardStepContext {
  return {
    id: step.id, agent: step.agent, kind: step.kind, status: step.status,
    ...(step.task?.title ? { label: dashboardText(step.task.title).text } : {}),
    ...(step.status === "failed" && step.summary ? { reportedResult: dashboardText(step.summary) } : {}),
  }
}

export function buildDashboardWorkflowContext(
  workflow: Workflow,
  questions: OpenQuestion[],
  participatingSessionIds: string[],
  questionScanLimited = false,
): DashboardWorkflowContext {
  const nonClosed = questions.filter((q) => q.workflowId === workflow.id && (q.status === "open" || q.status === "answered"))
    .sort((a, b) => Number(b.blocking) - Number(a.blocking) || Number(a.status === "answered") - Number(b.status === "answered") || a.id.localeCompare(b.id))
  const verification = (workflow.verification ?? []).filter((item) => item.status === "open")
    .sort((a, b) => a.id.localeCompare(b.id))
  const steps = workflow.steps.slice().sort((a, b) => Number(b.status === "failed") - Number(a.status === "failed"))
  return {
    version: 1,
    ...(workflow.request ? { request: dashboardText(workflow.request) } : {}),
    ...(participatingSessionIds.includes(workflow.createdBySession) ? { coordinatorSessionId: workflow.createdBySession } : {}),
    steps: steps.slice(0, DASHBOARD_CONTEXT_STEPS).map(stepContext),
    questions: nonClosed.slice(0, DASHBOARD_CONTEXT_ITEMS).map((question) => ({
      id: question.id,
      description: dashboardText(question.question),
      status: question.status as "open" | "answered",
      requiredAuthority: question.requiredAuthority,
      blocking: question.blocking,
    })),
    verification: verification.slice(0, DASHBOARD_CONTEXT_ITEMS).map((item) => {
      const before = workflow.steps.find((step) => step.id === item.beforeStepId)
      return {
        id: item.id,
        description: dashboardText(item.statement),
        kind: item.kind,
        requestedBy: item.createdByAgent,
        ...(before ? { beforeStep: stepContext(before) } : {}),
      }
    }),
    truncated: {
      steps: steps.length > DASHBOARD_CONTEXT_STEPS,
      questions: nonClosed.length > DASHBOARD_CONTEXT_ITEMS || questionScanLimited,
      verification: verification.length > DASHBOARD_CONTEXT_ITEMS,
    },
    questionCountIsLowerBound: questionScanLimited,
  }
}
