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

const sensitiveKeys = new Set(["apikey", "api_key", "api-key", "token", "password", "secret", "authorization", "proxy-authorization"])

/** Read one quoted token, including JSON escapes and YAML doubled single quotes. */
function quotedToken(value: string, start: number) {
  const quote = value[start]
  let text = ""
  let end = start + 1
  while (end < value.length) {
    const char = value[end++]
    if (char === quote) {
      if (quote === "'" && value[end] === "'") { text += quote; end++; continue }
      return { text, end }
    }
    if (char === "\\" && end < value.length) {
      if (value[end] === "u" && /^[0-9a-f]{4}$/i.test(value.slice(end + 1, end + 5))) {
        text += String.fromCharCode(parseInt(value.slice(end + 1, end + 5), 16)); end += 5
      } else { text += value[end++] }
    } else { text += char }
  }
  // An unterminated credential value must not leak its remaining tail.
  return { text, end }
}

/** Linear token scanning: recognize keys, then remove complete values before shortening. */
function redactAssignments(value: string, depth = 0) {
  const parts: string[] = []
  let offset = 0
  let index = 0
  while (index < value.length) {
    const tokenStart = index
    const quote = value[index] === '"' || value[index] === "'" ? value[index] : undefined
    let key: string
    if (value[index] === '"' || value[index] === "'") {
      const token = quotedToken(value, index)
      key = token.text; index = token.end
    } else if (/[a-z_]/i.test(value[index])) {
      const start = index++
      while (index < value.length && /[a-z0-9_-]/i.test(value[index])) index++
      key = value.slice(start, index)
    } else { index++; continue }
    if (!sensitiveKeys.has(key.toLowerCase())) {
      if (quote) {
        // Logs may contain JSON serialized inside a quoted string. Do not expose its
        // encoded credential value just because the outer token is not itself a key.
        const nested = depth < 2 ? redactAssignments(key, depth + 1)
          : key.includes(String.fromCharCode(92)) ? '[Encoded text omitted]' : key
        if (nested !== key) {
          parts.push(value.slice(offset, tokenStart), quote + '[REDACTED]' + quote)
          offset = index
        }
      }
      continue
    }
    let start = index
    while (start < value.length && /\s/.test(value[start])) start++
    if (value[start] !== ":" && value[start] !== "=") continue
    start++
    while (start < value.length && /\s/.test(value[start])) start++
    let end = start
    if (value[start] === '"' || value[start] === "'") end = quotedToken(value, start).end
    else if (value[start] === "|" || value[start] === ">") end = value.length
    else while (end < value.length && !/[\r\n,;}\]]/.test(value[end])) end++
    parts.push(value.slice(offset, start), "[REDACTED]")
    offset = end; index = end
  }
  return parts.join("") + value.slice(offset)
}

/** Defense in depth for authored summaries, not a guarantee that arbitrary text is secret-free. */
export function dashboardText(value: string | undefined): DashboardText {
  if (!value) return { text: "Description not recorded", truncated: false }
  if (value.length > 16_000) return { text: "Long description omitted. Inspect it in Loom.", truncated: true }
  const cleaned = redactCommand(redactAssignments(value
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
