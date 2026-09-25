import { runLifecycleHostScenarios } from "./lifecycle-host-scenarios"
import { createServer } from "node:net"
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises"
import { join, resolve } from "node:path"
import { tmpdir } from "node:os"
import { aggregateFleetFromDisk, readPublisherRecords } from "../plugins/loom/dashboard"
import { DEFAULT_LIMITS, type BudgetState } from "../plugins/loom/budget"
import { budgetContinuationQuestionInput } from "../plugins/loom/index"
import { createProjectStorage, createTransactionalStorage, resolveRuntimeIdentity } from "../plugins/loom/runtime"
import type { Workflow } from "../plugins/loom/workflow"

const root = resolve(import.meta.dir, "..")

function processEnv(overrides: Record<string, string | undefined>) {
  const env: Record<string, string> = {}
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined) env[key] = value
  }
  for (const [key, value] of Object.entries(overrides)) {
    if (value === undefined) delete env[key]
    else env[key] = value
  }
  return env
}

async function freePort() {
  return new Promise<number>((resolvePort, reject) => {
    const server = createServer()
    server.once("error", reject)
    server.listen(0, "127.0.0.1", () => {
      const address = server.address()
      if (!address || typeof address === "string") {
        server.close()
        reject(new Error("Unable to allocate integration port"))
        return
      }
      const port = address.port
      server.close((error) => error ? reject(error) : resolvePort(port))
    })
  })
}

async function waitFor(url: string, authorization: string, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs
  let last: unknown
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url, { headers: { authorization } })
      if (response.ok) return response
      last = new Error(`${response.status} ${response.statusText}`)
    } catch (error) {
      last = error
    }
    await Bun.sleep(150)
  }
  throw new Error(`Timed out waiting for ${url}: ${last instanceof Error ? last.message : String(last)}`)
}

async function jsonRequest(url: string, authorization: string, init?: RequestInit) {
  const headers = new Headers(init?.headers)
  headers.set("authorization", authorization)
  const response = await fetch(url, { ...init, headers })
  const body = await response.text()
  if (!response.ok) {
    throw new Error(`${init?.method ?? "GET"} ${url} failed: ${response.status} ${body.slice(0, 500)}`)
  }
  try {
    const data = JSON.parse(body)
    return (data as any)?.data ?? data
  } catch {
    throw new Error(`${init?.method ?? "GET"} ${url} returned non-JSON ${response.headers.get("content-type") ?? "content"}: ${body.slice(0, 200)}`)
  }
}


async function jsonRequestAny(
  urls: string[],
  authorization: string,
  init?: RequestInit,
) {
  const failures: string[] = []
  for (const url of urls) {
    try {
      return await jsonRequest(url, authorization, init)
    } catch (error) {
      failures.push(error instanceof Error ? error.message : String(error))
    }
  }
  throw new Error(`No compatible OpenCode API route succeeded:\n${failures.join("\n")}`)
}

async function waitForFile(path: string, timeoutMs = 15_000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      return await readFile(path, "utf8")
    } catch {
      await Bun.sleep(100)
    }
  }
  throw new Error(`Timed out waiting for ${path}`)
}


const UPGRADE_WORKFLOW_ID = "legacy-upgrade-workflow"

type MockProviderState = {
  programs: Map<string, { code: string; done: boolean; result?: unknown }>
  workflowId?: string
  workerGrantId?: string
  reviewerGrantId?: string
  workerAttached: boolean
  workerCompleted: boolean
  reviewerAttached: boolean
  reviewerSawWorkerComplete: boolean
  reviewerCompleted: boolean
  generalSawPeerReviewComplete: boolean
  unrelatedRejected: boolean
  crossProjectRejected: boolean
  upgradeSecondarySessionId?: string
  upgradeSeeded: boolean
  upgradePrimaryResumed: boolean
  upgradeSecondaryResumed: boolean
  statusPreviewRequested: boolean
  statusPreviewFallbackObserved: boolean
  sawNativeLoomToolGuidance: boolean
  codeModeLoomStatusObserved: boolean
  codeModeLoomSearchObserved: boolean
  statusArtifactPath?: string
  statusWebUrl?: string
  requests: string[]
  prompts: string[]
  unrelatedStatus?: unknown
  crossProjectStatus?: unknown
  budgetWorkflowId?: string
  budgetStepId?: string
  budgetQuestion?: ReturnType<typeof budgetContinuationQuestionInput>
  budgetQuestionObserved: boolean
  budgetContinuationObserved: boolean
  budgetDispatchGrantId?: string
  budgetSubagentObserved: boolean
  budgetWorkerAttached: boolean
  budgetWorkerCompleted: boolean
  budgetRestartQuestionObserved: boolean
  tuiBudgetPhase: number
  tuiBudgetParentSessionId?: string
  subagentToolSchema?: unknown
  tuiBudgetRouting: Array<{
    phase: number
    affinity?: string
    parentHeader?: string
    hasLoomAttach: boolean
    hasSubagent: boolean
    tools?: string[]
  }>
  tuiBudgetResolvedSubagentRules?: unknown
  tuiBudgetSubagentResult?: unknown
  tuiBudgetInitialGrantObserved: boolean
  tuiBudgetDenialObserved: boolean
  tuiBudgetApprovalObserved: boolean
}

function openAiMessageText(content: unknown) {
  if (typeof content === "string") return content
  if (!Array.isArray(content)) return ""
  return content
    .map((part: any) => typeof part === "string" ? part : part?.text ?? "")
    .filter(Boolean)
    .join("\n")
}

function parseToolContent(content: unknown) {
  const text = openAiMessageText(content).trim()
  if (!text) return undefined
  try {
    return JSON.parse(text)
  } catch {
    const start = text.indexOf("{")
    const end = text.lastIndexOf("}")
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(text.slice(start, end + 1))
      } catch {}
    }
    return text
  }
}

function toolResults(messages: any[]) {
  const names = new Map<string, string>()
  const results = new Map<string, unknown>()
  for (const message of messages) {
    if (message?.role === "assistant" && Array.isArray(message.tool_calls)) {
      for (const call of message.tool_calls) {
        if (call?.id && call?.function?.name) names.set(String(call.id), String(call.function.name))
      }
    }
    if (message?.role === "tool") {
      const name = names.get(String(message.tool_call_id ?? "")) ?? String(message.name ?? "")
      if (name) results.set(name, parseToolContent(message.content))
    }
  }
  return results
}

function latestUserPrompt(messages: any[]) {
  return [...messages]
    .reverse()
    .find((message) => message?.role === "user")
    ? openAiMessageText([...messages].reverse().find((message) => message?.role === "user")!.content)
    : ""
}

function chatPayload(model: string, content: string | null, tool?: { name: string; args: unknown }) {
  const created = Math.floor(Date.now() / 1000)
  const callId = `call_${crypto.randomUUID().replaceAll("-", "")}`
  const message = tool
    ? {
        role: "assistant",
        content: null,
        tool_calls: [{
          id: callId,
          type: "function",
          function: { name: tool.name, arguments: JSON.stringify(tool.args) },
        }],
      }
    : { role: "assistant", content: content ?? "ok" }
  return {
    id: `chatcmpl_${crypto.randomUUID().replaceAll("-", "")}`,
    object: "chat.completion",
    created,
    model,
    choices: [{
      index: 0,
      message,
      finish_reason: tool ? "tool_calls" : "stop",
    }],
    usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
  }
}

function streamingPayload(model: string, content: string | null, tool?: { name: string; args: unknown }) {
  const created = Math.floor(Date.now() / 1000)
  const id = `chatcmpl_${crypto.randomUUID().replaceAll("-", "")}`
  const callId = `call_${crypto.randomUUID().replaceAll("-", "")}`
  const firstDelta = tool
    ? {
        role: "assistant",
        tool_calls: [{
          index: 0,
          id: callId,
          type: "function",
          function: { name: tool.name, arguments: JSON.stringify(tool.args) },
        }],
      }
    : { role: "assistant", content: content ?? "ok" }
  const chunks = [
    {
      id,
      object: "chat.completion.chunk",
      created,
      model,
      choices: [{ index: 0, delta: firstDelta, finish_reason: null }],
    },
    {
      id,
      object: "chat.completion.chunk",
      created,
      model,
      choices: [{ index: 0, delta: {}, finish_reason: tool ? "tool_calls" : "stop" }],
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
    },
  ]
  return chunks.map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`).join("") + "data: [DONE]\n\n"
}

function toolRejected(value: unknown) {
  if (value && typeof value === "object" && typeof (value as any).error === "string") return true
  const text = typeof value === "string" ? value : JSON.stringify(value ?? "")
  return /Workflow not found|not bound|another project|error/i.test(text)
}

function subagentAction(
  state: MockProviderState,
  agent: string,
  prompt: string,
  description: string,
) {
  const schema = state.subagentToolSchema as any
  const properties = schema?.properties && typeof schema.properties === "object"
    ? schema.properties as Record<string, unknown>
    : {}
  const required = Array.isArray(schema?.required) ? schema.required.map(String) : []
  const supported = new Set(Object.keys(properties))
  const args: Record<string, unknown> = {}

  if (supported.has("agent")) args.agent = agent
  else if (supported.has("subagent_type")) args.subagent_type = agent
  else throw new Error("Real Loom subagent tool exposes no supported agent selector")

  if (supported.has("prompt")) args.prompt = prompt
  else throw new Error("Real Loom subagent tool exposes no prompt argument")

  if (supported.has("background")) args.background = false
  if (supported.has("description")) args.description = description

  const missing = required.filter((key) => args[key] === undefined)
  if (missing.length) {
    throw new Error(`Real Loom subagent tool has unsupported required arguments: ${missing.join(", ")}`)
  }
  return { name: "subagent", args }
}

function chooseMockAction(prompt: string, results: Map<string, unknown>, state: MockProviderState) {
  const program = state.programs.get(prompt)
  if (program) {
    if (!results.has("execute")) return { name: "execute", args: { code: program.code } }
    program.result = results.get("execute")
    program.done = true
    return null
  }
  const startResult = results.get("loom_start") as any
  const grantResult = results.get("loom_dispatch_grant") as any
  if (grantResult?.grantId && grantResult?.expectedAgent === "worker") state.workerGrantId = String(grantResult.grantId)
  if (grantResult?.grantId && grantResult?.expectedAgent === "reviewer") state.reviewerGrantId = String(grantResult.grantId)

  if (prompt.includes("LOOM_INTEGRATION_BUDGET_QUESTION")) {
    if (!state.budgetWorkflowId || !state.budgetStepId || !state.budgetQuestion) {
      throw new Error("Budget continuation host fixture was not initialized")
    }
    const continuation = results.get("loom_budget_continue") as any
    if (continuation?.continued === true) state.budgetContinuationObserved = true
    const grant = results.get("loom_dispatch_grant") as any
    if (grant?.grantId && grant?.expectedAgent === "worker") {
      state.budgetDispatchGrantId = String(grant.grantId)
    }
    const subagent = results.get("subagent")
    if (subagent !== undefined && !toolRejected(subagent)) state.budgetSubagentObserved = true

    if (!results.has("question")) return { name: "question", args: state.budgetQuestion }
    if (!results.has("loom_budget_continue")) {
      return {
        name: "loom_budget_continue",
        args: {
          workflowId: state.budgetWorkflowId,
          stepId: state.budgetStepId,
          reason: "The user approved one additional dispatch through the real OpenCode question interaction.",
        },
      }
    }
    if (!results.has("loom_status")) {
      return { name: "loom_status", args: { workflowId: state.budgetWorkflowId, detail: true } }
    }
    if (!results.has("loom_dispatch_grant")) {
      return {
        name: "loom_dispatch_grant",
        args: { workflowId: state.budgetWorkflowId, stepId: state.budgetStepId },
      }
    }
    if (!results.has("subagent")) {
      return subagentAction(
        state,
        "worker",
        "LOOM_INTEGRATION_BUDGET_WORKER",
        "Resume budget worker",
      )
    }
    return null
  }

  if (prompt.includes("LOOM_INTEGRATION_BUDGET_WORKER")) {
    const attach = results.get("loom_attach") as any
    if (results.has("loom_attach") && attach?.attached !== true) {
      throw new Error("Real TUI recovery Worker attach failed: " + JSON.stringify(attach))
    }
    if (attach?.attached) state.budgetWorkerAttached = true
    const complete = results.get("loom_complete") as any
    if (results.has("loom_complete") && complete?.error) {
      throw new Error("Real TUI recovery Worker completion failed: " + JSON.stringify(complete))
    }
    if (complete && !complete.error) state.budgetWorkerCompleted = true
    if (!state.budgetWorkflowId || !state.budgetStepId || !state.budgetDispatchGrantId) {
      throw new Error("Budget Worker continuation fixture was not initialized")
    }
    if (!results.has("loom_attach")) {
      return {
        name: "loom_attach",
        args: {
          grantId: state.budgetDispatchGrantId,
          workflowId: state.budgetWorkflowId,
          stepId: state.budgetStepId,
        },
      }
    }
    if (!results.has("loom_status")) {
      return { name: "loom_status", args: { workflowId: state.budgetWorkflowId, detail: true } }
    }
    if (!results.has("loom_complete")) {
      return {
        name: "loom_complete",
        args: {
          workflowId: state.budgetWorkflowId,
          stepId: state.budgetStepId,
          summary: "real-host budget continuation Worker complete",
        },
      }
    }
    return null
  }

  if (prompt.includes("LOOM_INTEGRATION_BUDGET_RESTART")) {
    if (!state.budgetQuestion) throw new Error("Budget restart question fixture was not initialized")
    if (!results.has("question")) return { name: "question", args: state.budgetQuestion }
    state.budgetRestartQuestionObserved = true
    return null
  }

  if (prompt.includes("LOOM_TUI_BUDGET_ACCEPTANCE")) {
    if (!state.budgetWorkflowId || !state.budgetStepId) {
      throw new Error("TUI budget acceptance fixture was not initialized")
    }

    if (state.tuiBudgetPhase === 0) {
      state.tuiBudgetPhase = 1
      return {
        name: "loom_dispatch_grant",
        args: { workflowId: state.budgetWorkflowId, stepId: state.budgetStepId },
      }
    }

    if (state.tuiBudgetPhase === 1) {
      if (!state.tuiBudgetInitialGrantObserved) {
        throw new Error("TUI budget fixture did not observe its initial durable dispatch grant")
      }
      state.tuiBudgetPhase = 2
      return subagentAction(
        state,
        "worker",
        "LOOM_TUI_BUDGET_DENIED_WORKER",
        "Budget exhaustion probe",
      )
    }

    if (state.tuiBudgetPhase === 2) {
      if (!state.tuiBudgetDenialObserved || !state.budgetQuestion) {
        throw new Error("Real TUI Worker denial has not reached durable Loom state yet")
      }
      state.tuiBudgetPhase = 3
      return { name: "question", args: state.budgetQuestion }
    }

    if (state.tuiBudgetPhase === 3) {
      if (!state.tuiBudgetApprovalObserved) {
        throw new Error("Real TUI answer did not persist an approved Loom budget decision")
      }
      state.tuiBudgetPhase = 4
      return {
        name: "loom_budget_continue",
        args: {
          workflowId: state.budgetWorkflowId,
          stepId: state.budgetStepId,
          reason: "The user approved one additional dispatch in the real OpenCode TUI.",
        },
      }
    }

    if (state.tuiBudgetPhase === 4) {
      if (!state.budgetContinuationObserved) {
        throw new Error("Real TUI answer did not produce durable question-authorized Loom continuation")
      }
      state.tuiBudgetPhase = 5
      return { name: "loom_status", args: { workflowId: state.budgetWorkflowId, detail: true } }
    }

    if (state.tuiBudgetPhase === 5) {
      state.tuiBudgetPhase = 6
      return {
        name: "loom_dispatch_grant",
        args: { workflowId: state.budgetWorkflowId, stepId: state.budgetStepId },
      }
    }

    if (state.tuiBudgetPhase === 6) {
      if (!state.budgetDispatchGrantId) {
        throw new Error("Real TUI continuation did not produce a fresh durable Worker dispatch grant")
      }
      state.tuiBudgetPhase = 7
      return subagentAction(
        state,
        "worker",
        "LOOM_INTEGRATION_BUDGET_WORKER",
        "Resume budget worker",
      )
    }

    if (state.tuiBudgetPhase === 7) {
      if (results.has("subagent")) state.tuiBudgetSubagentResult = results.get("subagent")
      if (!state.budgetSubagentObserved || !state.budgetWorkerAttached || !state.budgetWorkerCompleted) {
        return null
      }
      state.tuiBudgetPhase = 8
      return null
    }

    return null
  }

  if (prompt.includes("LOOM_INTEGRATION_GENERAL_START")) {
    if (startResult?.workflowId) state.workflowId = String(startResult.workflowId)
    if (!results.has("loom_start")) {
      return { name: "loom_start", args: { anchor: "docs/anchors/shared-name/anchor.md" } }
    }
    if (!results.has("loom_route")) {
      return {
        name: "loom_route",
        args: {
          humanFacing: false,
          behavioral: false,
          structural: false,
          externalUnknown: false,
          diagnostic: false,
          productOutcome: false,
          implementationRequested: true,
          executionDepth: "task",
        },
      }
    }
    if (!results.has("loom_task_scope")) {
      return {
        name: "loom_task_scope",
        args: { workflowId: state.workflowId, stepId: "worker", write: ["src/**"] },
      }
    }
    if (!results.has("loom_dispatch_grant")) {
      return {
        name: "loom_dispatch_grant",
        args: { workflowId: state.workflowId, stepId: "worker" },
      }
    }
    return null
  }

  if (prompt.includes("LOOM_INTEGRATION_WORKER")) {
    const attach = results.get("loom_attach") as any
    if (attach?.attached) state.workerAttached = true
    const complete = results.get("loom_complete") as any
    if (complete && !complete.error) state.workerCompleted = true
    if (!results.has("loom_attach")) {
      return {
        name: "loom_attach",
        args: { grantId: state.workerGrantId, workflowId: state.workflowId, stepId: "worker" },
      }
    }
    if (!results.has("loom_status")) {
      return { name: "loom_status", args: { workflowId: state.workflowId, detail: true } }
    }
    if (!results.has("loom_complete")) {
      return {
        name: "loom_complete",
        args: { workflowId: state.workflowId, stepId: "worker", summary: "real-host worker complete" },
      }
    }
    return null
  }

  if (prompt.includes("LOOM_INTEGRATION_REVIEW_GRANT")) {
    if (!results.has("loom_dispatch_grant")) {
      return {
        name: "loom_dispatch_grant",
        args: { workflowId: state.workflowId, stepId: "review-implementation" },
      }
    }
    return null
  }

  if (prompt.includes("LOOM_INTEGRATION_REVIEWER")) {
    const attach = results.get("loom_attach") as any
    if (attach?.attached) state.reviewerAttached = true
    const status = results.get("loom_status") as any
    if (status?.workflow?.steps?.some((step: any) => step.id === "worker" && step.status === "complete")) {
      state.reviewerSawWorkerComplete = true
    }
    const complete = results.get("loom_complete") as any
    if (complete && !complete.error) state.reviewerCompleted = true
    if (!results.has("loom_attach")) {
      return {
        name: "loom_attach",
        args: { grantId: state.reviewerGrantId, workflowId: state.workflowId, stepId: "review-implementation" },
      }
    }
    if (!results.has("loom_status")) {
      return { name: "loom_status", args: { workflowId: state.workflowId, detail: true } }
    }
    if (!results.has("loom_complete")) {
      return {
        name: "loom_complete",
        args: {
          workflowId: state.workflowId,
          stepId: "review-implementation",
          outcome: "pass",
          summary: "real-host peer-process review passed",
        },
      }
    }
    return null
  }

  if (prompt.includes("LOOM_INTEGRATION_VERIFY_PEER_REVIEW")) {
    const status = results.get("loom_status") as any
    if (status?.workflow?.steps?.some(
      (step: any) => step.id === "review-implementation" && step.status === "passed",
    )) {
      state.generalSawPeerReviewComplete = true
    }
    if (!results.has("loom_status")) {
      return { name: "loom_status", args: { workflowId: state.workflowId, detail: true } }
    }
    return null
  }

  if (prompt.includes("LOOM_INTEGRATION_OTHER_WORKFLOW")) {
    if (!results.has("loom_start")) {
      return { name: "loom_start", args: { anchor: "docs/anchors/other/anchor.md" } }
    }
    const status = results.get("loom_status") as any
    if (status !== undefined) state.unrelatedStatus = status
    if (toolRejected(status)) state.unrelatedRejected = true
    if (!results.has("loom_status")) {
      return { name: "loom_status", args: { workflowId: state.workflowId, detail: true } }
    }
    return null
  }

  if (prompt.includes("LOOM_INTEGRATION_CROSS_PROJECT")) {
    const status = results.get("loom_status") as any
    if (status !== undefined) state.crossProjectStatus = status
    if (toolRejected(status)) state.crossProjectRejected = true
    if (!results.has("loom_status")) {
      return { name: "loom_status", args: { workflowId: state.workflowId, detail: true } }
    }
    return null
  }

  if (prompt.includes("LOOM_INTEGRATION_CODEMODE_SEARCH")) {
    const executed = results.get("execute") as any
    const items = Array.isArray(executed?.items) ? executed.items : []
    const paths = items.map((item: any) => String(item?.path ?? ""))
    if (paths.includes("tools.loom.code.status") && paths.includes("tools.loom.code.start")) {
      state.codeModeLoomSearchObserved = true
    }
    if (!results.has("execute")) {
      return {
        name: "execute",
        args: {
          code: 'return search({ query: "", namespace: "tools.loom.code", limit: 100 })',
        },
      }
    }
    return null
  }

  if (prompt.includes("LOOM_INTEGRATION_CODEMODE_LOOM")) {
    const executed = results.get("execute") as any
    const candidate = executed?.workflow ?? executed?.summary ?? executed
    if (candidate?.id === state.workflowId || candidate?.workflowId === state.workflowId) {
      state.codeModeLoomStatusObserved = true
    }
    if (!results.has("execute")) {
      return {
        name: "execute",
        args: {
          code: `return await tools.loom.code.status({ workflowId: ${JSON.stringify(state.workflowId)}, detail: true })`,
        },
      }
    }
    return null
  }

  if (prompt.includes("LOOM_INTEGRATION_STATUS_PREVIEW")) {
    const status = results.get("loom_status") as any
    const path = status?.presentation?.path
    const webUrl = status?.presentation?.webUrl
    if (typeof path === "string" && path) state.statusArtifactPath = path
    if (typeof webUrl === "string" && webUrl) state.statusWebUrl = webUrl
    if (!results.has("loom_status")) {
      return { name: "loom_status", args: { workflowId: state.workflowId } }
    }
    if (!state.statusWebUrl?.startsWith("http://127.0.0.1:")) {
      throw new Error("loom_status did not expose the browser-safe web presentation URL")
    }
    if (state.statusArtifactPath && !results.has("execute")) {
      const code = status?.presentation?.desktopPreview?.code
      if (typeof code !== "string" || !code.includes("tools.browser.preview")) {
        throw new Error("loom_status did not provide the optional Desktop browser preview program")
      }
      if (!code.includes("browser-disconnected") || !code.includes("retry: false")) {
        throw new Error("loom_status browser preview program did not include the soft-fallback contract")
      }
      return { name: "execute", args: { code } }
    }
    if (results.has("execute")) {
      state.statusPreviewRequested = true
      if (prompt.includes("LOOM_INTEGRATION_STATUS_PREVIEW_DISCONNECTED")) {
        const executeResult = JSON.stringify(results.get("execute") ?? "")
        state.statusPreviewFallbackObserved =
          executeResult.includes("browser-disconnected") &&
          executeResult.includes("unavailable")
      }
    }
    return null
  }

  if (prompt.includes("LOOM_INTEGRATION_LEGACY_SEED")) {
    const seeded = results.get("loom_legacy_seed") as any
    if (seeded?.seeded) state.upgradeSeeded = true
    if (!results.has("loom_legacy_seed")) {
      if (!state.upgradeSecondarySessionId) throw new Error("Upgrade secondary session ID is not initialized")
      return { name: "loom_legacy_seed", args: { workflowId: UPGRADE_WORKFLOW_ID, secondarySessionId: state.upgradeSecondarySessionId } }
    }
    return null
  }

  if (prompt.includes("LOOM_INTEGRATION_UPGRADE_PRIMARY")) {
    const status = results.get("loom_status") as any
    if (status?.workflow?.id === UPGRADE_WORKFLOW_ID && !status?.error) state.upgradePrimaryResumed = true
    if (!results.has("loom_status")) return { name: "loom_status", args: { workflowId: UPGRADE_WORKFLOW_ID, detail: true } }
    return null
  }

  if (prompt.includes("LOOM_INTEGRATION_UPGRADE_SECONDARY")) {
    const status = results.get("loom_status") as any
    if (status?.workflow?.id === UPGRADE_WORKFLOW_ID && !status?.error) state.upgradeSecondaryResumed = true
    if (!results.has("loom_status")) return { name: "loom_status", args: { workflowId: UPGRADE_WORKFLOW_ID, detail: true } }
    return null
  }

  return null
}

async function startMockProvider() {
  const state: MockProviderState = {
    programs: new Map(),
    workerAttached: false,
    workerCompleted: false,
    reviewerAttached: false,
    reviewerSawWorkerComplete: false,
    reviewerCompleted: false,
    generalSawPeerReviewComplete: false,
    unrelatedRejected: false,
    crossProjectRejected: false,
    upgradeSeeded: false,
    upgradePrimaryResumed: false,
    upgradeSecondaryResumed: false,
    statusPreviewRequested: false,
    statusPreviewFallbackObserved: false,
    sawNativeLoomToolGuidance: false,
    codeModeLoomStatusObserved: false,
    codeModeLoomSearchObserved: false,
    budgetQuestionObserved: false,
    budgetContinuationObserved: false,
    budgetSubagentObserved: false,
    budgetWorkerAttached: false,
    budgetWorkerCompleted: false,
    budgetRestartQuestionObserved: false,
    tuiBudgetPhase: 0,
    tuiBudgetRouting: [],
    tuiBudgetInitialGrantObserved: false,
    tuiBudgetDenialObserved: false,
    tuiBudgetApprovalObserved: false,
    requests: [],
    prompts: [],
  }
  const port = await freePort()
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port,
    async fetch(request) {
      const url = new URL(request.url)
      state.requests.push(`${request.method} ${url.pathname}`)
      if (request.method === "GET" && url.pathname.endsWith("/models")) {
        return Response.json({ object: "list", data: [{ id: "gpt-4.1-mini", object: "model" }] })
      }
      if (request.method !== "POST" || !url.pathname.endsWith("/chat/completions")) {
        return new Response("not found", { status: 404 })
      }
      const body = await request.json() as any
      const messages = Array.isArray(body.messages) ? body.messages : []
      if (messages.some((message: any) =>
        message?.role === "system" &&
        openAiMessageText(message.content).includes("two equivalent OpenCode surfaces") &&
        openAiMessageText(message.content).includes("tools.loom.code.*")
      )) {
        state.sawNativeLoomToolGuidance = true
      }
      const delegatedBudgetWorkerPrompt = [...messages]
        .reverse()
        .map((message: any) => openAiMessageText(message?.content))
        .find((text: string) => text.includes("LOOM_INTEGRATION_BUDGET_WORKER"))
      const sessionAffinity = request.headers.get("x-session-affinity")
      const parentSessionHeader = request.headers.get("x-parent-session-id")
      const requestTools = Array.isArray(body.tools) ? body.tools : []
      const subagentTool = requestTools.find((item: any) =>
        String(item?.function?.name ?? item?.name ?? "") === "subagent"
      )
      if (subagentTool) {
        state.subagentToolSchema =
          subagentTool?.function?.parameters ??
          subagentTool?.parameters ??
          subagentTool?.input_schema ??
          subagentTool?.inputSchema
      }
      const requestToolNames = new Set(
        requestTools
          .map((item: any) => String(item?.function?.name ?? item?.name ?? ""))
          .filter(Boolean),
      )
      if (state.tuiBudgetPhase >= 6 && state.tuiBudgetPhase <= 7 && state.tuiBudgetRouting.length < 20) {
        state.tuiBudgetRouting.push({
          phase: state.tuiBudgetPhase,
          ...(sessionAffinity ? { affinity: sessionAffinity } : {}),
          ...(parentSessionHeader ? { parentHeader: parentSessionHeader } : {}),
          hasLoomAttach: requestToolNames.has("loom_attach"),
          hasSubagent: requestToolNames.has("subagent"),
          tools: [...requestToolNames].sort(),
        })
      }
      const recoveryWorkerRequest =
        state.tuiBudgetPhase === 7 &&
        Boolean(sessionAffinity) &&
        Boolean(state.tuiBudgetParentSessionId) &&
        sessionAffinity !== state.tuiBudgetParentSessionId &&
        requestToolNames.has("loom_attach") &&
        !(state.budgetSubagentObserved && state.budgetWorkerAttached && state.budgetWorkerCompleted)
      const prompt =
        recoveryWorkerRequest
          ? "LOOM_INTEGRATION_BUDGET_WORKER"
          : delegatedBudgetWorkerPrompt ?? latestUserPrompt(messages)
      state.prompts.push(prompt)
      const latestUserIndex = messages.findLastIndex((message: any) => message?.role === "user")
      const turnMessages = latestUserIndex >= 0 ? messages.slice(latestUserIndex + 1) : messages
      const results = toolResults(turnMessages)
      if (prompt.includes("LOOM_TUI_BUDGET_ACCEPTANCE")) {
        const deadline = Date.now() + 3_000
        if (state.tuiBudgetPhase === 1) {
          while (!state.tuiBudgetInitialGrantObserved && Date.now() < deadline) {
            await Bun.sleep(20)
          }
        }
        if (state.tuiBudgetPhase === 2) {
          while (!state.tuiBudgetDenialObserved && Date.now() < deadline) {
            await Bun.sleep(20)
          }
        }
        if (state.tuiBudgetPhase === 3) {
          while (!state.tuiBudgetApprovalObserved && Date.now() < deadline) {
            await Bun.sleep(20)
          }
        }
        if (state.tuiBudgetPhase === 4) {
          while (!state.budgetContinuationObserved && Date.now() < deadline) {
            await Bun.sleep(20)
          }
        }
        if (state.tuiBudgetPhase === 6) {
          while (!state.budgetDispatchGrantId && Date.now() < deadline) {
            await Bun.sleep(20)
          }
        }
        if (state.tuiBudgetPhase === 7) {
          while (!state.budgetWorkerCompleted && Date.now() < deadline) {
            await Bun.sleep(20)
          }
        }
      }
      const action = chooseMockAction(prompt, results, state)
      const model = String(body.model ?? "mock")
      const content = action
        ? null
        : prompt.includes("LOOM_TUI_BUDGET_ACCEPTANCE") && state.tuiBudgetPhase >= 8
          ? "LOOM_TUI_BUDGET_ACCEPTANCE_DONE"
          : "integration sequence complete"
      if (body.stream) {
        return new Response(streamingPayload(model, content, action ?? undefined), {
          headers: { "content-type": "text/event-stream", "cache-control": "no-cache" },
        })
      }
      return Response.json(chatPayload(model, content, action ?? undefined))
    },
  })
  return {
    state,
    server,
    baseUrl: `http://127.0.0.1:${server.port}`,
  }
}

async function sendPrompt(
  handle: ServerHandle,
  sessionId: string,
  text: string,
) {
  const failures: string[] = []
  try {
    return await jsonRequest(
      `${handle.baseUrl}/api/session/${sessionId}/prompt`,
      handle.authorization,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text }),
      },
    )
  } catch (error) {
    failures.push(error instanceof Error ? error.message : String(error))
  }
  try {
    return await jsonRequest(
      `${handle.baseUrl}/session/${sessionId}/message`,
      handle.authorization,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ parts: [{ type: "text", text }] }),
      },
    )
  } catch (error) {
    failures.push(error instanceof Error ? error.message : String(error))
  }
  throw new Error(`No compatible OpenCode prompt route succeeded:\n${failures.join("\n")}`)
}

async function waitForCondition(
  predicate: () => boolean | Promise<boolean>,
  label: string,
  debug?: () => unknown | Promise<unknown>,
  timeoutMs = 15_000,
) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (await predicate()) return
    await Bun.sleep(100)
  }
  const observed = debug ? await debug() : undefined
  const detail = debug ? `\nDebug: ${JSON.stringify(observed, null, 2)}` : ""
  throw new Error(`Timed out waiting for ${label}${detail}`)
}


type FakeBrowserState = {
  attached: boolean
  previewPath?: string
  commands: number
  error?: string
}

function rpcUrl(handle: ServerHandle, rpcID: string, method: string) {
  const url = new URL(`/api/rpc/${encodeURIComponent(rpcID)}/${encodeURIComponent(method)}`, handle.baseUrl)
  url.searchParams.set("location[directory]", handle.project)
  return url.toString()
}

async function rpcCall(handle: ServerHandle, rpcID: string, method: string, input: unknown) {
  const value = await jsonRequest(rpcUrl(handle, rpcID, method), handle.authorization, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ input }),
  })
  return value?.output ?? value
}

async function* serverEvents(handle: ServerHandle, signal: AbortSignal, onConnected?: () => void) {
  const response = await fetch(`${handle.baseUrl}/api/event`, {
    headers: { authorization: handle.authorization },
    signal,
  })
  if (!response.ok || !response.body) {
    throw new Error(`Unable to subscribe to OpenCode events: ${response.status} ${response.statusText}`)
  }
  onConnected?.()

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ""
  try {
    while (!signal.aborted) {
      const next = await reader.read()
      if (next.done) break
      buffer += decoder.decode(next.value, { stream: true })
      while (true) {
        const boundary = buffer.indexOf("\n\n")
        if (boundary < 0) break
        const frame = buffer.slice(0, boundary)
        buffer = buffer.slice(boundary + 2)
        const data = frame
          .split("\n")
          .filter((line) => line.startsWith("data:"))
          .map((line) => line.slice(5).trim())
          .join("\n")
        if (!data) continue
        yield JSON.parse(data)
      }
    }
  } finally {
    reader.releaseLock()
  }
}

async function startFakeBrowser(handle: ServerHandle, sessionID: string) {
  const connectionID = `loom-integration-${crypto.randomUUID()}`
  const controller = new AbortController()
  const state: FakeBrowserState = { attached: false, commands: 0 }

  let resolveEventsReady!: () => void
  const eventsReady = new Promise<void>((resolve) => {
    resolveEventsReady = resolve
  })
  const events = (async () => {
    try {
      for await (const event of serverEvents(handle, controller.signal, resolveEventsReady)) {
        if (event?.type !== "rpc.experimental.browser.control") continue
        const data = event.data
        if (!data || data.connectionID !== connectionID) continue

        if (data.type === "attached") {
          state.attached = true
          await rpcCall(handle, "experimental.browser", "state", {
            sessionID,
            connectionID,
            state: { tabs: [], focusedTabID: null },
          })
          continue
        }

        if (data.type !== "command") continue
        const command = await rpcCall(handle, "experimental.browser", "command", {
          sessionID,
          connectionID,
          requestID: data.requestID,
        })
        state.commands++
        const action = command?.action
        if (action?.type === "preview" && typeof action.path === "string") {
          state.previewPath = action.path
        }

        await rpcCall(handle, "experimental.browser", "result", {
          sessionID,
          connectionID,
          requestID: data.requestID,
          outcome: {
            type: "success",
            result: {
              value: action?.type === "preview" ? { path: action.path } : {},
              files: [],
            },
          },
        })
      }
    } catch (error) {
      if (!controller.signal.aborted) state.error = error instanceof Error ? error.message : String(error)
    }
  })()

  await Promise.race([
    eventsReady,
    Bun.sleep(5_000).then(() => {
      throw new Error("Timed out waiting for OpenCode event stream before browser attach")
    }),
  ])

  // The attach request is intentionally long-lived; it resolves only when the browser disconnects.
  const attach = fetch(rpcUrl(handle, "experimental.browser", "attach"), {
    method: "POST",
    headers: {
      authorization: handle.authorization,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      input: { sessionID, connectionID, version: 4 },
    }),
    signal: controller.signal,
  }).then(async (response) => {
    if (!response.ok) throw new Error(`Browser attach failed: ${response.status} ${await response.text()}`)
    await response.text()
  }).catch((error) => {
    if (!controller.signal.aborted) state.error = error instanceof Error ? error.message : String(error)
  })

  await waitForCondition(
    () => state.attached || Boolean(state.error),
    "fake OpenCode desktop browser attachment",
    () => state,
  )
  if (state.error) throw new Error(state.error)

  return {
    state,
    close: async () => {
      controller.abort()
      await Promise.allSettled([events, attach])
    },
  }
}

async function createProject(base: string, name: string, mockBaseUrl: string) {
  const project = join(base, name)
  const pluginDir = join(project, ".opencode", "plugins")
  const agentDir = join(project, ".opencode", "agents")
  await mkdir(pluginDir, { recursive: true })
  await mkdir(agentDir, { recursive: true })
  await mkdir(join(project, "docs", "anchors", "shared-name"), { recursive: true })
  await writeFile(
    join(project, "docs", "anchors", "shared-name", "anchor.md"),
    "# Integration Anchor\n",
    "utf8",
  )
  await symlink(join(root, "plugins", "loom"), join(pluginDir, "loom"), "dir")
  if (name === "project-a") {
    await symlink(join(root, "scripts", "fixtures", "lifecycle-delay-plugin.ts"), join(pluginDir, "lifecycle-delay-plugin.ts"), "file")
  }
  for (const agent of ["general", "worker", "reviewer", "planner"]) {
    await symlink(join(root, "agents", `${agent}.md`), join(agentDir, `${agent}.md`), "file")
  }
  await writeFile(
    join(project, "opencode.json"),
    JSON.stringify({
      "$schema": "https://opencode.ai/config.json",
      plugins: ["./.opencode/plugins/loom", ...(name === "project-a" ? ["./.opencode/plugins/lifecycle-delay-plugin.ts"] : [])],
      model: "loommock/mock",
      enabled_providers: ["loommock"],
      permission: { browser: "allow" },
      provider: {
        loommock: {
          npm: "@ai-sdk/openai-compatible",
          name: "Loom integration mock",
          options: {
            baseURL: `${mockBaseUrl}/v1`,
            apiKey: "loom-integration-test",
          },
          models: {
            mock: {
              name: "Loom integration mock",
              limit: { context: 1_000_000, output: 32_768 },
            },
          },
        },
      },
    }, null, 2) + "\n",
    "utf8",
  )
  return project
}


const TUI_BUDGET_PROJECT_ID = "00000000-0000-4000-8000-000000000068"
const TUI_BUDGET_WORKFLOW_ID = "tui-budget-continuation"
const TUI_BUDGET_STEP_ID = "worker"

async function prepareTuiBudgetProject(project: string) {
  await mkdir(join(project, ".loom"), { recursive: true })
  await writeFile(
    join(project, ".loom", "project-id"),
    JSON.stringify({ schemaVersion: 1, projectId: TUI_BUDGET_PROJECT_ID }) + "\n",
    "utf8",
  )

  const configPath = join(project, "opencode.json")
  const config = JSON.parse(await readFile(configPath, "utf8"))
  config.default_agent = "general"
  await writeFile(configPath, JSON.stringify(config, null, 2) + "\n", "utf8")
}

async function seedTuiBudgetAcceptanceState(
  project: string,
  stateHome: string,
  runtimeDir: string,
  sessionID: string,
) {
  const { runtime, storage } = await openHostProjectStorage(project, stateHome, runtimeDir)
  const now = new Date().toISOString()
  const workflow: Workflow = {
    id: TUI_BUDGET_WORKFLOW_ID,
    projectId: runtime.projectId,
    revision: 0,
    anchor: "task:" + TUI_BUDGET_WORKFLOW_ID,
    request: "Resume the existing Worker only after explicit budget approval.",
    createdBySession: sessionID,
    createdAt: now,
    steps: [{
      id: TUI_BUDGET_STEP_ID,
      agent: "worker",
      kind: "work",
      dependsOn: [],
      status: "pending",
    }],
  }
  const budget: BudgetState = {
    totalDispatches: 3,
    byKey: { ["step:" + TUI_BUDGET_STEP_ID]: 3 },
    seenDispatches: ["tui-seed-1", "tui-seed-2", "tui-seed-3"],
    grants: [],
  }

  await storage.set("workflow/" + TUI_BUDGET_WORKFLOW_ID, workflow)
  await storage.set("session/" + sessionID, TUI_BUDGET_WORKFLOW_ID)
  await storage.set("session-step/" + sessionID, "")
  await storage.set("session-oq/" + sessionID, "")
  await storage.set("limits/" + TUI_BUDGET_WORKFLOW_ID, DEFAULT_LIMITS)
  await storage.set("budget/" + TUI_BUDGET_WORKFLOW_ID, budget)
  await storage.set("scope/" + TUI_BUDGET_WORKFLOW_ID + "/" + TUI_BUDGET_STEP_ID, {
    workflowId: TUI_BUDGET_WORKFLOW_ID,
    stepId: TUI_BUDGET_STEP_ID,
    write: ["scratch/**"],
  })
  return { runtime, storage }
}

async function runTuiBudgetAcceptance(
  base: string,
  project: string,
  stateHome: string,
  runtimeDir: string,
  mock: { state: MockProviderState },
) {
  mock.state.budgetWorkflowId = TUI_BUDGET_WORKFLOW_ID
  mock.state.budgetStepId = TUI_BUDGET_STEP_ID
  mock.state.budgetQuestion = undefined
  mock.state.budgetQuestionObserved = false
  mock.state.budgetContinuationObserved = false
  mock.state.budgetDispatchGrantId = undefined
  mock.state.budgetSubagentObserved = false
  mock.state.budgetWorkerAttached = false
  mock.state.budgetWorkerCompleted = false
  mock.state.tuiBudgetPhase = 0
  mock.state.tuiBudgetParentSessionId = undefined
  mock.state.tuiBudgetRouting = []
  mock.state.tuiBudgetResolvedSubagentRules = undefined
  mock.state.tuiBudgetSubagentResult = undefined
  mock.state.tuiBudgetInitialGrantObserved = false
  mock.state.tuiBudgetDenialObserved = false
  mock.state.tuiBudgetApprovalObserved = false

  const tuiServer = await startServer(
    base,
    project,
    stateHome,
    runtimeDir,
    "tui-budget-server",
  )
  const tuiSession = await jsonRequestAny(
    [`${tuiServer.baseUrl}/api/session`, `${tuiServer.baseUrl}/session`],
    tuiServer.authorization,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(sessionCreateBody("Loom TUI budget acceptance", "general")),
    },
  )
  if (!tuiSession?.id) {
    await stop(tuiServer)
    throw new Error("OpenCode did not create the real TUI budget acceptance session")
  }
  mock.state.tuiBudgetParentSessionId = String(tuiSession.id)

  const agentList = await jsonRequest(
    `${tuiServer.baseUrl}/api/agent`,
    tuiServer.authorization,
  )
  const agents = Array.isArray(agentList) ? agentList : Array.isArray(agentList?.data) ? agentList.data : []
  const resolvedGeneral = agents.find((agent: any) => String(agent?.id ?? agent?.name ?? "") === "general")
  const resolvedPermissions = resolvedGeneral?.permissions ?? resolvedGeneral?.permission ?? []
  mock.state.tuiBudgetResolvedSubagentRules = Array.isArray(resolvedPermissions)
    ? resolvedPermissions.filter((rule: any) =>
        String(rule?.action ?? "") === "subagent" || String(rule?.permission ?? "") === "subagent"
      )
    : resolvedPermissions

  const { storage: tuiStorage } = await seedTuiBudgetAcceptanceState(
    project,
    stateHome,
    runtimeDir,
    tuiSession.id,
  )

  let durableWatchError: unknown
  const durableWatch = (async () => {
    const deadline = Date.now() + 50_000
    let initialGrantId: string | undefined
    while (Date.now() < deadline) {
      const grants = (await tuiStorage.scan({
        prefix: "dispatch-grant/",
        limit: 100,
      })).entries
        .map((entry: any) => entry.value as any)
        .filter((grant: any) =>
          grant?.workflowId === TUI_BUDGET_WORKFLOW_ID &&
          grant?.stepId === TUI_BUDGET_STEP_ID &&
          grant?.expectedAgent === "worker"
        )

      if (!initialGrantId && grants[0]?.grantId) {
        initialGrantId = String(grants[0].grantId)
        mock.state.tuiBudgetInitialGrantObserved = true
      }
      const freshGrant = initialGrantId
        ? grants.find((grant: any) => grant?.grantId && String(grant.grantId) !== initialGrantId)
        : undefined
      if (freshGrant?.grantId) {
        mock.state.budgetDispatchGrantId = String(freshGrant.grantId)
      }

      const blocked = (await tuiStorage.scan({
        prefix: "budget-continuation-blocked/",
        limit: 100,
      })).entries
        .map((entry: any) => entry.value as any)
        .find((value: any) =>
          value?.workflowId === TUI_BUDGET_WORKFLOW_ID &&
          value?.stepId === TUI_BUDGET_STEP_ID &&
          !value?.resolvedAt &&
          typeof value?.approvalRef === "string"
        )
      if (blocked && !mock.state.tuiBudgetDenialObserved) {
        mock.state.budgetQuestion = budgetContinuationQuestionInput({
          agent: "worker",
          stepId: TUI_BUDGET_STEP_ID,
          approvalRef: blocked.approvalRef,
        })
        mock.state.tuiBudgetDenialObserved = true
      }

      const decisions = (await tuiStorage.scan({
        prefix: "budget-continuation-question-decision/",
        limit: 100,
      })).entries
        .map((entry: any) => entry.value as any)
        .filter((decision: any) =>
          decision?.workflowId === TUI_BUDGET_WORKFLOW_ID &&
          decision?.stepId === TUI_BUDGET_STEP_ID &&
          decision?.approved === true &&
          decision?.answer === "Allow +1 dispatch"
        )
      if (decisions.length > 0) {
        mock.state.tuiBudgetApprovalObserved = true
      }

      const budget = await tuiStorage.get("budget/" + TUI_BUDGET_WORKFLOW_ID) as BudgetState | undefined
      if (
        budget?.continuations?.some((continuation) =>
          continuation.key === "step:" + TUI_BUDGET_STEP_ID &&
          continuation.authorizationSource === "question" &&
          continuation.requestedDispatches === 1
        )
      ) {
        mock.state.budgetContinuationObserved = true
      }

      if (freshGrant?.consumedAt) {
        mock.state.budgetSubagentObserved = true
        mock.state.budgetWorkerAttached = true
      }
      const workflow = await tuiStorage.get("workflow/" + TUI_BUDGET_WORKFLOW_ID) as Workflow | undefined
      if (workflow?.steps.find((step) => step.id === TUI_BUDGET_STEP_ID)?.status === "complete") {
        mock.state.budgetWorkerCompleted = true
      }

      if (
        mock.state.tuiBudgetInitialGrantObserved &&
        mock.state.tuiBudgetDenialObserved &&
        mock.state.tuiBudgetApprovalObserved &&
        mock.state.budgetContinuationObserved &&
        mock.state.budgetDispatchGrantId &&
        mock.state.budgetSubagentObserved &&
        mock.state.budgetWorkerAttached &&
        mock.state.budgetWorkerCompleted
      ) {
        return
      }
      await Bun.sleep(25)
    }
    throw new Error(
      "Timed out waiting for durable TUI budget grant/denial/recovery state: " +
      JSON.stringify({
        initialGrant: mock.state.tuiBudgetInitialGrantObserved,
        denial: mock.state.tuiBudgetDenialObserved,
        approval: mock.state.tuiBudgetApprovalObserved,
        continuation: mock.state.budgetContinuationObserved,
        freshGrant: mock.state.budgetDispatchGrantId,
        attached: mock.state.budgetWorkerAttached,
        completed: mock.state.budgetWorkerCompleted,
      }),
    )
  })().catch((error) => {
    durableWatchError = error
  })

  const isolated = join(base, "opencode", "tui-budget")
  await mkdir(isolated, { recursive: true })
  const env = processEnv({
    XDG_CONFIG_HOME: join(isolated, "config"),
    XDG_DATA_HOME: join(isolated, "data"),
    XDG_CACHE_HOME: join(isolated, "cache"),
    XDG_STATE_HOME: stateHome,
    XDG_RUNTIME_DIR: runtimeDir,
    OPENCODE_DB: join(isolated, "opencode.db"),
    OPENCODE_DISABLE_AUTOUPDATE: "1",
    OPENCODE_ENABLE_QUESTION_TOOL: "1",
    LOOM_TOOL_OUTPUT: "json",
    TERM: "xterm-256color",
  })
  const proc = Bun.spawn(
    [
      "python3",
      join(root, "scripts", "tui-budget-acceptance.py"),
      project,
      "LOOM_TUI_BUDGET_ACCEPTANCE",
      tuiServer.baseUrl,
      tuiSession.id,
      tuiServer.password,
    ],
    { cwd: root, env, stdout: "pipe", stderr: "pipe" },
  )
  const stdout = new Response(proc.stdout).text()
  const stderr = new Response(proc.stderr).text()

  const completed = await Promise.race([
    proc.exited.then((code) => ({ type: "exit" as const, code })),
    Bun.sleep(65_000).then(() => ({ type: "timeout" as const, code: -1 })),
  ])
  if (completed.type === "timeout" && proc.exitCode === null) proc.kill("SIGKILL")
  const [out, err] = await Promise.all([stdout, stderr])
  await durableWatch
  await stop(tuiServer)
  if (completed.type === "timeout" || completed.code !== 0 || durableWatchError) {
    throw new Error(
      `Real TUI budget acceptance failed (${completed.type === "timeout" ? "timeout" : "exit " + completed.code}).` +
      `\nstate:\n${JSON.stringify(mock.state)}` +
      `\ndurable-watch:\n${durableWatchError instanceof Error ? durableWatchError.message : String(durableWatchError ?? "ok")}` +
      `\nstdout:\n${out}\nstderr:\n${err}`,
    )
  }

  if (
    !mock.state.tuiBudgetDenialObserved ||
    !mock.state.budgetContinuationObserved ||
    !mock.state.budgetDispatchGrantId ||
    !mock.state.budgetSubagentObserved ||
    !mock.state.budgetWorkerAttached ||
    !mock.state.budgetWorkerCompleted
  ) {
    throw new Error("Real TUI budget acceptance did not complete the assembled same-target recovery: " + JSON.stringify(mock.state))
  }

  const { storage } = await openHostProjectStorage(project, stateHome, runtimeDir)
  const budget = await storage.get("budget/" + TUI_BUDGET_WORKFLOW_ID) as BudgetState
  const workflow = await storage.get("workflow/" + TUI_BUDGET_WORKFLOW_ID) as Workflow
  const continuation = budget.continuations?.at(-1)
  if (
    continuation?.authorizationSource !== "question" ||
    continuation?.requestedDispatches !== 1 ||
    continuation?.usedDispatches !== 1 ||
    budget.byKey["step:" + TUI_BUDGET_STEP_ID] !== 4 ||
    workflow.steps.find((step) => step.id === TUI_BUDGET_STEP_ID)?.status !== "complete"
  ) {
    throw new Error(
      "Real TUI budget acceptance ended in unexpected Loom state: " +
      JSON.stringify({ continuation, budget, step: workflow.steps.find((step) => step.id === TUI_BUDGET_STEP_ID) }),
    )
  }
}

async function updateProjectPluginList(project: string, plugins: string[]) {
  const path = join(project, "opencode.json")
  const config = JSON.parse(await readFile(path, "utf8"))
  config.plugins = plugins
  await writeFile(path, JSON.stringify(config, null, 2) + "\n", "utf8")
}

async function installLegacyUpgradePlugin(project: string) {
  const pluginDir = join(project, ".opencode", "plugins")
  await rm(join(pluginDir, "loom"), { recursive: true, force: true })
  const legacyPath = join(pluginDir, "loom-legacy.ts")
  await writeFile(legacyPath, `
const legacyLoomPlugin = {
  id: "loom",
  async setup(ctx) {
    await ctx.tool.transform(async (editor) => {
      editor.namespace({ name: "loom", description: "Legacy Loom integration fixture for host restart verification." })
      editor.add({
        name: "legacy_seed",
        description: "Seed pre-project-epoch Loom state for restart verification.",
        input: {
          type: "object",
          properties: { workflowId: { type: "string" }, secondarySessionId: { type: "string" } },
          required: ["workflowId", "secondarySessionId"],
          additionalProperties: false,
        },
        options: { namespace: "loom", codemode: false },
        execute: async (input, tool) => {
          const workflowId = String(input.workflowId)
          const secondarySessionId = String(input.secondarySessionId)
          await ctx.storage.set("session/" + tool.sessionID, workflowId)
          await ctx.storage.set("session/" + secondarySessionId, workflowId)
          await ctx.storage.set("session-step/" + secondarySessionId, "plan")
          await ctx.storage.set("workflow/" + workflowId, {
            id: workflowId,
            anchor: "docs/anchors/shared-name/anchor.md",
            createdBySession: tool.sessionID,
            createdAt: "pre-upgrade-host-fixture",
            steps: [{ id: "plan", agent: "planner", kind: "work", dependsOn: [], status: "pending" }],
          })
          await ctx.storage.set("budget/" + workflowId, { totalDispatches: 0, byKey: {}, seenDispatches: [], grants: [] })
          return { content: JSON.stringify({ seeded: true, workflowId, primarySessionId: tool.sessionID, secondarySessionId }) }
        },
      })
    })
  },
}
export default legacyLoomPlugin
`.trimStart(), "utf8")
  await updateProjectPluginList(project, ["./.opencode/plugins/loom-legacy.ts"])
}

async function installCurrentLoomPlugin(project: string) {
  const pluginDir = join(project, ".opencode", "plugins")
  await rm(join(pluginDir, "loom-legacy.ts"), { force: true })
  await rm(join(pluginDir, "loom"), { recursive: true, force: true })
  await symlink(join(root, "plugins", "loom"), join(pluginDir, "loom"), "dir")
  await updateProjectPluginList(project, ["./.opencode/plugins/loom"])
}

type DashboardEndpoint = {
  baseUrl: string
  processId: number
}

async function waitForAutoStartedDashboard(
  sharedState: string,
  port: number,
  expectedProcessId: number,
): Promise<DashboardEndpoint> {
  const baseUrl = `http://127.0.0.1:${port}`
  await waitFor(`${baseUrl}/health`, "")
  const endpointPath = join(sharedState, "loom", "dashboard-endpoint.json")
  const deadline = Date.now() + 10_000
  while (Date.now() < deadline) {
    try {
      const record = JSON.parse(await readFile(endpointPath, "utf8"))
      if (
        record?.baseUrl === baseUrl &&
        record?.processId === expectedProcessId &&
        Date.parse(record.leaseExpiresAt) > Date.now()
      ) {
        return { baseUrl, processId: record.processId }
      }
    } catch {}
    await Bun.sleep(100)
  }
  throw new Error(
    `OpenCode-started Loom dashboard did not publish the expected live endpoint ${baseUrl} from process ${expectedProcessId}`,
  )
}

type ServerHandle = {
  project: string
  baseUrl: string
  proc: ReturnType<typeof Bun.spawn>
  stdout: Promise<string>
  stderr: Promise<string>
  authorization: string
  password: string
}

async function startServer(
  base: string,
  project: string,
  sharedState: string,
  runtimeDir: string | undefined,
  name: string,
  dashboardPort: number | false = false,
): Promise<ServerHandle> {
  const port = await freePort()
  const isolated = join(base, "opencode", name)
  await mkdir(isolated, { recursive: true })
  const password = `loom-integration-${name}`
  const authorization = `Basic ${Buffer.from(`opencode:${password}`).toString("base64")}`
  const env = processEnv({
    XDG_CONFIG_HOME: join(isolated, "config"),
    XDG_DATA_HOME: join(isolated, "data"),
    XDG_CACHE_HOME: join(isolated, "cache"),
    XDG_STATE_HOME: sharedState,
    XDG_RUNTIME_DIR: runtimeDir,
    OPENCODE_DB: join(isolated, "opencode.db"),
    OPENCODE_DISABLE_AUTOUPDATE: "1",
    OPENCODE_ENABLE_QUESTION_TOOL: "1",
    OPENCODE_SERVER_USERNAME: "opencode",
    OPENCODE_SERVER_PASSWORD: password,
    LOOM_TOOL_OUTPUT: "json",
    LOOM_DASHBOARD_AUTOSTART: dashboardPort === false ? "0" : undefined,
    LOOM_DASHBOARD_PORT: dashboardPort === false ? undefined : String(dashboardPort),
    LOOM_DASHBOARD_URL: undefined,
  })
  const proc = Bun.spawn(
    ["opencode", "serve", "--hostname", "127.0.0.1", "--port", String(port)],
    { cwd: project, env, stdout: "pipe", stderr: "pipe" },
  )
  const stdout = new Response(proc.stdout).text()
  const stderr = new Response(proc.stderr).text()
  const baseUrl = `http://127.0.0.1:${port}`
  try {
    await waitFor(`${baseUrl}/global/health`, authorization)
  } catch (error) {
    proc.kill()
    const logs = await Promise.all([stdout, stderr])
    throw new Error(`${error instanceof Error ? error.message : String(error)}\nstdout:\n${logs[0]}\nstderr:\n${logs[1]}`)
  }
  return { project, baseUrl, proc, stdout, stderr, authorization, password }
}

function sessionCreateBody(
  title: string,
  agent: "general" | "worker" | "reviewer" | "planner",
  parentID?: string,
) {
  return {
    title,
    agent,
    model: { providerID: "loommock", id: "mock" },
    ...(parentID ? { parentID } : {}),
  }
}

async function stop(handle: ServerHandle) {
  if (handle.proc.exitCode === null) handle.proc.kill("SIGTERM")
  await Promise.race([
    handle.proc.exited,
    Bun.sleep(5_000).then(() => {
      if (handle.proc.exitCode === null) handle.proc.kill("SIGKILL")
    }),
  ])
  await Promise.allSettled([handle.stdout, handle.stderr])
}

async function crash(handle: ServerHandle) {
  if (handle.proc.exitCode === null) handle.proc.kill("SIGKILL")
  await handle.proc.exited
  await Promise.allSettled([handle.stdout, handle.stderr])
}

async function openHostProjectStorage(project: string, sharedState: string, runtimeDir: string) {
  const previousState = process.env.XDG_STATE_HOME
  const previousRuntime = process.env.XDG_RUNTIME_DIR
  process.env.XDG_STATE_HOME = sharedState
  process.env.XDG_RUNTIME_DIR = runtimeDir
  try {
    const bootstrap = {
      get: async (_key: string) => undefined,
      set: async (_key: string, value: unknown) => value,
      scan: async () => ({ entries: [], next: undefined }),
    }
    const runtime = await resolveRuntimeIdentity(project, bootstrap as any)
    const storage = createProjectStorage(await createTransactionalStorage(runtime), runtime.projectId)
    return { runtime, storage }
  } finally {
    if (previousState === undefined) delete process.env.XDG_STATE_HOME
    else process.env.XDG_STATE_HOME = previousState
    if (previousRuntime === undefined) delete process.env.XDG_RUNTIME_DIR
    else process.env.XDG_RUNTIME_DIR = previousRuntime
  }
}

async function seedBudgetContinuationHostFixture(
  project: string,
  sharedState: string,
  runtimeDir: string,
  sessionID: string,
) {
  const { runtime, storage } = await openHostProjectStorage(project, sharedState, runtimeDir)
  const workflowId = `host-budget-${crypto.randomUUID()}`
  const stepId = "worker"
  const denialId = `host-denial-${crypto.randomUUID()}`
  const approvalRef = crypto.randomUUID().replaceAll("-", "").slice(0, 16)
  const workflow: Workflow = {
    id: workflowId,
    projectId: runtime.projectId,
    revision: 0,
    anchor: "docs/anchors/host-budget/anchor.md",
    createdBySession: sessionID,
    createdAt: new Date().toISOString(),
    steps: [{ id: stepId, agent: "worker", kind: "work", dependsOn: [], status: "pending" }],
  }
  const dispatchKey = `step:${stepId}`
  const budget: BudgetState = {
    totalDispatches: DEFAULT_LIMITS.maxDispatchesPerStep,
    byKey: { [dispatchKey]: DEFAULT_LIMITS.maxDispatchesPerStep },
    seenDispatches: Array.from(
      { length: DEFAULT_LIMITS.maxDispatchesPerStep },
      (_, index) => `host-seed-${index + 1}`,
    ),
    grants: [],
  }

  await storage.set(`workflow/${workflowId}`, workflow)
  await storage.set(`session/${sessionID}`, workflowId)
  await storage.set(`session-step/${sessionID}`, "")
  await storage.set(`session-oq/${sessionID}`, "")
  await storage.set(`limits/${workflowId}`, DEFAULT_LIMITS)
  await storage.set(`budget/${workflowId}`, budget)
  await storage.set(`scope/${workflowId}/${stepId}`, {
    workflowId,
    stepId,
    write: ["scratch/**"],
  })
  await storage.set(
    `budget-continuation-blocked/${encodeURIComponent(sessionID)}/${encodeURIComponent(workflowId)}/step/${encodeURIComponent(stepId)}`,
    {
      workflowId,
      agent: "worker",
      stepId,
      denialId,
      approvalRef,
      reason: `dispatch limit ${DEFAULT_LIMITS.maxDispatchesPerStep} reached`,
      blockedAt: new Date().toISOString(),
    },
  )

  return { storage, workflowId, stepId, denialId, approvalRef }
}

async function waitForSessionToolPart(
  handle: ServerHandle,
  sessionID: string,
  toolName: string,
  timeoutMs = 15_000,
) {
  const deadline = Date.now() + timeoutMs
  let last: unknown
  while (Date.now() < deadline) {
    try {
      const value = await jsonRequestAny(
        [
          `${handle.baseUrl}/api/session/${encodeURIComponent(sessionID)}/message`,
          `${handle.baseUrl}/session/${encodeURIComponent(sessionID)}/message`,
        ],
        handle.authorization,
      )
      const messages = Array.isArray(value)
        ? value
        : Array.isArray(value?.messages)
          ? value.messages
          : Array.isArray(value?.data)
            ? value.data
            : []
      last = messages
      for (const message of [...messages].reverse()) {
        const parts = Array.isArray(message?.parts)
          ? message.parts
          : Array.isArray(message?.content)
            ? message.content
            : []
        const part = [...parts].reverse().find((candidate: any) =>
          candidate?.type === "tool" &&
          String(candidate?.tool ?? candidate?.name ?? "") === toolName
        )
        if (part) return part
      }
    } catch (error) {
      last = error
    }
    await Bun.sleep(100)
  }
  throw new Error(
    "Timed out waiting for real OpenCode " + toolName + " tool part: " +
      (last instanceof Error ? last.message : JSON.stringify(last)),
  )
}
const base = await mkdtemp(join(tmpdir(), "loom-opencode-host-"))
const sharedState = join(base, "shared-state")
const runtimeA = join(base, "runtime-a")
const runtimeB = join(base, "runtime-b")
const servers: ServerHandle[] = []
const mock = await startMockProvider()

try {
  const [projectA, projectB, projectTuiBudget, projectRestartBudget] = await Promise.all([
    createProject(base, "project-a", mock.baseUrl),
    createProject(base, "project-b", mock.baseUrl),
    createProject(base, "project-tui-budget", mock.baseUrl),
    createProject(base, "project-restart-budget", mock.baseUrl),
  ])
  await prepareTuiBudgetProject(projectTuiBudget)

  let dashboardPort = await freePort()
  while (dashboardPort === 4318) dashboardPort = await freePort()

  const serverA = await startServer(base, projectA, sharedState, runtimeA, "server-a", dashboardPort)
  servers.push(serverA)

  // Global server health and raw session creation do not imply Loom plugin
  // activation. The first real Loom RPC activates setup; that setup must own
  // the dashboard without a separate bun run dashboard process.
  const sessionA = await jsonRequestAny(
    [`${serverA.baseUrl}/api/session`, `${serverA.baseUrl}/session`],
    serverA.authorization,
    {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(sessionCreateBody("Loom integration A", "general")),
    },
  )
  const sidebarA = await jsonRequest(`${serverA.baseUrl}/api/rpc/loom.control/sidebar`, serverA.authorization, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ input: { sessionID: sessionA.id } }),
  })
  const outputA = sidebarA?.output ?? sidebarA
  if (outputA?.active !== false) {
    throw new Error("Fresh OpenCode session did not receive idle Loom RPC state")
  }

  const dashboard = await waitForAutoStartedDashboard(sharedState, dashboardPort, serverA.proc.pid)

  const serverAPeer = await startServer(base, projectA, sharedState, runtimeB, "server-a-peer", dashboardPort)
  servers.push(serverAPeer)
  const serverB = await startServer(base, projectB, sharedState, runtimeB, "server-b", dashboardPort)
  servers.push(serverB)

  const sessionB = await jsonRequestAny(
    [`${serverB.baseUrl}/api/session`, `${serverB.baseUrl}/session`],
    serverB.authorization,
    {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(sessionCreateBody("Loom integration B", "general")),
    },
  )

  if (!sessionA?.id || !sessionB?.id || sessionA.id === sessionB.id) {
    throw new Error("OpenCode did not create distinct real sessions")
  }

  const sidebarB = await jsonRequest(`${serverB.baseUrl}/api/rpc/loom.control/sidebar`, serverB.authorization, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ input: { sessionID: sessionB.id } }),
  })
  const outputB = sidebarB?.output ?? sidebarB
  if (outputB?.active !== false) {
    throw new Error("Fresh second OpenCode session did not receive idle Loom RPC state")
  }


  await sendPrompt(serverA, sessionA.id, "LOOM_INTEGRATION_GENERAL_START")
  await waitForCondition(
    () => Boolean(mock.state.workflowId && mock.state.workerGrantId),
    "real OpenCode General start/route/grant sequence",
    () => mock.state,
  )

  const workerSession = await jsonRequestAny(
    [`${serverA.baseUrl}/api/session`, `${serverA.baseUrl}/session`],
    serverA.authorization,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(sessionCreateBody("Loom integration Worker", "worker", sessionA.id)),
    },
  )
  await sendPrompt(serverA, workerSession.id, "LOOM_INTEGRATION_WORKER")
  await waitForCondition(
    () => mock.state.workerAttached && mock.state.workerCompleted,
    "fresh real Worker attach/status/complete sequence",
    () => mock.state,
  )

  await sendPrompt(serverA, sessionA.id, "LOOM_INTEGRATION_REVIEW_GRANT")
  await waitForCondition(
    () => Boolean(mock.state.reviewerGrantId),
    "real OpenCode Reviewer grant issuance",
    () => mock.state,
  )

  const reviewerSession = await jsonRequestAny(
    [`${serverAPeer.baseUrl}/api/session`, `${serverAPeer.baseUrl}/session`],
    serverAPeer.authorization,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(sessionCreateBody("Loom integration Reviewer peer", "reviewer")),
    },
  )
  await sendPrompt(serverAPeer, reviewerSession.id, "LOOM_INTEGRATION_REVIEWER")
  await waitForCondition(
    () =>
      mock.state.reviewerAttached &&
      mock.state.reviewerSawWorkerComplete &&
      mock.state.reviewerCompleted,
    "fresh peer-process Reviewer attach/read/complete sequence",
    () => mock.state,
  )

  await sendPrompt(serverA, sessionA.id, "LOOM_INTEGRATION_VERIFY_PEER_REVIEW")
  await waitForCondition(
    () => mock.state.generalSawPeerReviewComplete,
    "origin process observing peer-process Reviewer mutation",
    () => mock.state,
  )

  await sendPrompt(serverA, sessionA.id, "LOOM_INTEGRATION_STATUS_PREVIEW_DISCONNECTED")
  await waitForCondition(
    () => mock.state.statusPreviewFallbackObserved,
    "loom_status browser preview soft fallback without a desktop browser",
    () => mock.state,
  )

  mock.state.statusPreviewRequested = false
  if (!mock.state.sawNativeLoomToolGuidance) {
    throw new Error("Loom native-tool routing guidance did not reach the real OpenCode provider context")
  }

  await sendPrompt(serverA, sessionA.id, "LOOM_INTEGRATION_CODEMODE_SEARCH")
  await waitForCondition(
    () => mock.state.codeModeLoomSearchObserved,
    "Loom Code Mode mirrors discoverable through search",
    () => mock.state,
  )

  await sendPrompt(serverA, sessionA.id, "LOOM_INTEGRATION_CODEMODE_LOOM")
  await waitForCondition(
    () => mock.state.codeModeLoomStatusObserved,
    "Loom status through real OpenCode Code Mode mirror",
    () => mock.state,
  )

  const browser = await startFakeBrowser(serverA, sessionA.id)
  try {
    await sendPrompt(serverA, sessionA.id, "LOOM_INTEGRATION_STATUS_PREVIEW")
    await waitForCondition(
      () =>
        mock.state.statusPreviewRequested &&
        Boolean(mock.state.statusArtifactPath) &&
        Boolean(mock.state.statusWebUrl) &&
        browser.state.previewPath === mock.state.statusArtifactPath,
      "loom_status artifact handoff through real OpenCode browser.preview",
      () => ({ mock: mock.state, browser: browser.state }),
    )
    if (!mock.state.statusArtifactPath) throw new Error("loom_status did not expose an artifact path")
    const statusArtifact = await readFile(mock.state.statusArtifactPath, "utf8")
    if (!statusArtifact.includes("Loom workflow status")) {
      throw new Error("Previewed Loom status artifact did not contain the expected interactive document")
    }
  } finally {
    await browser.close()
  }

  const budgetSession = await jsonRequestAny(
    [`${serverA.baseUrl}/api/session`, `${serverA.baseUrl}/session`],
    serverA.authorization,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(sessionCreateBody("Loom interactive budget continuation", "general")),
    },
  )
  if (!budgetSession?.id) throw new Error("OpenCode did not create the budget continuation session")

  const budgetFixture = await seedBudgetContinuationHostFixture(
    projectA,
    sharedState,
    runtimeA,
    budgetSession.id,
  )
  mock.state.budgetWorkflowId = budgetFixture.workflowId
  mock.state.budgetStepId = budgetFixture.stepId
  mock.state.budgetQuestion = budgetContinuationQuestionInput({
    agent: "worker",
    stepId: budgetFixture.stepId,
    approvalRef: budgetFixture.approvalRef,
  })

  let budgetPromptError: unknown
  void sendPrompt(
    serverA,
    budgetSession.id,
    "LOOM_INTEGRATION_BUDGET_QUESTION",
  ).catch((error) => {
    budgetPromptError = error
  })

  const questionPart = await waitForSessionToolPart(serverA, budgetSession.id, "question")
  if (budgetPromptError) throw budgetPromptError
  const questionInput = questionPart?.state?.input ?? questionPart?.input
  if (questionPart?.state?.status === "error") {
    const error = questionPart.state.error
    throw new Error(
      "Real OpenCode question tool failed: " +
        (typeof error === "string" ? error : JSON.stringify(error ?? "unknown error")),
    )
  }
  if (
    questionInput?.questions?.[0]?.header !== mock.state.budgetQuestion.questions[0].header ||
    questionInput?.questions?.[0]?.question !== mock.state.budgetQuestion.questions[0].question ||
    questionInput?.questions?.[0]?.options?.[0]?.label !==
      mock.state.budgetQuestion.questions[0].options[0].label
  ) {
    throw new Error(
      "Real OpenCode question tool part did not preserve the Loom budget prompt: " + JSON.stringify(questionPart),
    )
  }
  mock.state.budgetQuestionObserved = true

  // OpenCode serve 2.0.15 has no advertised question-reply or abort API for
  // this interaction. The real-host proof therefore stops once the question
  // tool is admitted, decoded, persisted, and blocked awaiting user input.
  // The harness-owned server finalizer terminates the blocked request. The
  // plugin integration test proves answer -> authorization -> one dispatch.

  const tuiState = join(base, "tui-budget-state")
  const tuiRuntime = join(base, "tui-budget-runtime")
  await runTuiBudgetAcceptance(base, projectTuiBudget, tuiState, tuiRuntime, mock)

  const restartState = join(base, "restart-budget-state")
  const restartRuntime = join(base, "restart-budget-runtime")
  const restartServer = await startServer(
    base,
    projectRestartBudget,
    restartState,
    restartRuntime,
    "budget-restart",
  )
  servers.push(restartServer)
  const restartSession = await jsonRequestAny(
    [`${restartServer.baseUrl}/api/session`, `${restartServer.baseUrl}/session`],
    restartServer.authorization,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(sessionCreateBody("Loom budget restart recovery", "general")),
    },
  )
  if (!restartSession?.id) throw new Error("OpenCode did not create the restart budget session")
  const restartFixture = await seedBudgetContinuationHostFixture(
    projectRestartBudget,
    restartState,
    restartRuntime,
    restartSession.id,
  )
  mock.state.budgetWorkflowId = restartFixture.workflowId
  mock.state.budgetStepId = restartFixture.stepId
  mock.state.budgetQuestion = budgetContinuationQuestionInput({
    agent: "worker",
    stepId: restartFixture.stepId,
    approvalRef: restartFixture.approvalRef,
  })
  const restartPrompt1 = sendPrompt(
    restartServer,
    restartSession.id,
    "LOOM_INTEGRATION_BUDGET_RESTART",
  ).catch(() => undefined)
  const restartQuestion1 = await waitForSessionToolPart(restartServer, restartSession.id, "question")
  if (restartQuestion1?.state?.status === "error") {
    throw new Error("Initial real restart budget question failed before crash")
  }
  const restartBlockedKey =
    `budget-continuation-blocked/${encodeURIComponent(restartSession.id)}/${encodeURIComponent(restartFixture.workflowId)}/step/${encodeURIComponent(restartFixture.stepId)}`
  const beforeCrash = await restartFixture.storage.get(restartBlockedKey) as {
    questionOwnerInstanceId?: string
    questionStartedAt?: string
  }
  if (!beforeCrash.questionOwnerInstanceId || !beforeCrash.questionStartedAt) {
    throw new Error("Initial real budget question did not persist its runtime owner")
  }

  await crash(restartServer)
  await restartPrompt1

  const restartedServer = await startServer(
    base,
    projectRestartBudget,
    restartState,
    restartRuntime,
    "budget-restart",
  )
  servers.push(restartedServer)
  const restartPrompt2 = sendPrompt(
    restartedServer,
    restartSession.id,
    "LOOM_INTEGRATION_BUDGET_RESTART",
  ).catch(() => undefined)

  await waitForCondition(
    async () => {
      const current = await restartFixture.storage.get(restartBlockedKey) as {
        questionOwnerInstanceId?: string
        questionStartedAt?: string
      } | undefined
      return Boolean(
        current?.questionOwnerInstanceId &&
        current.questionOwnerInstanceId !== beforeCrash.questionOwnerInstanceId &&
        current.questionStartedAt,
      )
    },
    "restarted OpenCode host reclaiming orphaned budget question",
    async () => restartFixture.storage.get(restartBlockedKey),
    20_000,
  )
  const restartQuestion2 = await waitForSessionToolPart(restartedServer, restartSession.id, "question")
  const restartInput2 = restartQuestion2?.state?.input ?? restartQuestion2?.input
  if (
    restartQuestion2?.state?.status === "error" ||
    restartInput2?.questions?.[0]?.header !== mock.state.budgetQuestion.questions[0].header
  ) {
    throw new Error("Restarted OpenCode host did not render the reclaimed canonical budget question")
  }
  void restartPrompt2
  const unrelatedSession = await jsonRequestAny(
    [`${serverA.baseUrl}/api/session`, `${serverA.baseUrl}/session`],
    serverA.authorization,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(sessionCreateBody("Loom unrelated workflow", "general")),
    },
  )
  await sendPrompt(serverA, unrelatedSession.id, "LOOM_INTEGRATION_OTHER_WORKFLOW")
  await waitForCondition(
    () => mock.state.unrelatedRejected,
    "same-project unrelated-workflow rejection",
    () => mock.state,
  )

  await sendPrompt(serverB, sessionB.id, "LOOM_INTEGRATION_CROSS_PROJECT")
  await waitForCondition(
    () => mock.state.crossProjectRejected,
    "cross-project workflow selector rejection",
    () => mock.state,
  )

  const reviewerSidebar = await jsonRequest(
    `${serverAPeer.baseUrl}/api/rpc/loom.control/sidebar`,
    serverAPeer.authorization,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ input: { sessionID: reviewerSession.id } }),
    },
  )
  const reviewerOutput = reviewerSidebar?.output ?? reviewerSidebar
  if (reviewerOutput?.workflowId !== mock.state.workflowId && reviewerOutput?.workflow?.id !== mock.state.workflowId) {
    throw new Error("Reviewer session RPC did not remain bound to the shared workflow")
  }
  const reviewerStatusUrl = reviewerOutput?.statusUrl
  if (
    typeof reviewerStatusUrl !== "string" ||
    !reviewerStatusUrl.startsWith(`${dashboard.baseUrl}/#/project/`) ||
    !reviewerStatusUrl.endsWith(`/workflow/${encodeURIComponent(String(mock.state.workflowId))}`)
  ) {
    throw new Error(`Reviewer sidebar did not expose the active dashboard workflow URL: ${String(reviewerStatusUrl)}`)
  }
  const dashboardReachability = await fetch(reviewerStatusUrl)
  if (!dashboardReachability.ok) {
    throw new Error(`Sidebar dashboard URL did not reach the running dashboard: ${dashboardReachability.status}`)
  }

  const runtimeRecord = JSON.parse(
    await waitForFile(join(sharedState, "loom", "runtime-root.json")),
  ) as { schemaVersion: number; runtimeRoot: string }
  if (runtimeRecord.schemaVersion !== 1) throw new Error("Unexpected Loom runtime-root schema")
  if (runtimeRecord.runtimeRoot !== join(runtimeA, "loom")) {
    throw new Error(`Second OpenCode process did not honor first installation lock root: ${runtimeRecord.runtimeRoot}`)
  }

  const deadline = Date.now() + 15_000
  let records = await readPublisherRecords(runtimeRecord.runtimeRoot)
  while (records.length < 3 && Date.now() < deadline) {
    await Bun.sleep(150)
    records = await readPublisherRecords(runtimeRecord.runtimeRoot)
  }
  if (records.length < 3) {
    throw new Error(`Expected three Loom publisher records from real OpenCode processes, observed ${records.length}`)
  }

  const fleet = await aggregateFleetFromDisk(runtimeRecord.runtimeRoot)
  if (fleet.projects.length !== 2) {
    throw new Error(`Expected two compartmentalized projects in dashboard fleet, observed ${fleet.projects.length}`)
  }
  const locations = new Set(fleet.projects.map((project) => project.canonicalLocation))
  if (!locations.has(projectA) || !locations.has(projectB)) {
    throw new Error(`Dashboard projection lost real OpenCode project identity: ${[...locations].join(", ")}`)
  }
  if (new Set(fleet.projects.map((project) => project.projectId)).size !== 2) {
    throw new Error("Two real OpenCode projects received the same Loom project epoch")
  }
  const projectedA = fleet.projects.find((project) => project.canonicalLocation === projectA)
  if (!projectedA) throw new Error("Dashboard fleet did not include project A")
  const expectedReviewerStatusUrl =
    `${dashboard.baseUrl}/#/project/${encodeURIComponent(projectedA.projectId)}/workflow/${encodeURIComponent(String(mock.state.workflowId))}`
  if (reviewerStatusUrl !== expectedReviewerStatusUrl) {
    throw new Error(
      `Reviewer sidebar dashboard URL did not match the projected project/workflow identity: ${reviewerStatusUrl} !== ${expectedReviewerStatusUrl}`,
    )
  }


  const upgradeProject = await createProject(base, "project-upgrade-restart", mock.baseUrl)
  await installLegacyUpgradePlugin(upgradeProject)
  const upgradeState = join(base, "upgrade-shared-state")
  const upgradeRuntime = join(base, "upgrade-runtime")

  const legacyHost = await startServer(base, upgradeProject, upgradeState, upgradeRuntime, "upgrade-host")
  servers.push(legacyHost)

  const upgradePrimary = await jsonRequestAny(
    [`${legacyHost.baseUrl}/api/session`, `${legacyHost.baseUrl}/session`],
    legacyHost.authorization,
    { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(sessionCreateBody("Pre-upgrade General", "general")) },
  )
  const upgradeSecondary = await jsonRequestAny(
    [`${legacyHost.baseUrl}/api/session`, `${legacyHost.baseUrl}/session`],
    legacyHost.authorization,
    { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(sessionCreateBody("Pre-upgrade Planner", "planner", upgradePrimary.id)) },
  )
  if (!upgradePrimary?.id || !upgradeSecondary?.id) throw new Error("OpenCode did not persist pre-upgrade sessions")

  mock.state.upgradeSecondarySessionId = upgradeSecondary.id
  await sendPrompt(legacyHost, upgradePrimary.id, "LOOM_INTEGRATION_LEGACY_SEED")
  await waitForCondition(() => mock.state.upgradeSeeded, "pre-upgrade Loom fixture persisting legacy workflow bindings", () => mock.state)

  await stop(legacyHost)
  await installCurrentLoomPlugin(upgradeProject)

  const restartedHost = await startServer(base, upgradeProject, upgradeState, upgradeRuntime, "upgrade-host")
  servers.push(restartedHost)

  await sendPrompt(restartedHost, upgradePrimary.id, "LOOM_INTEGRATION_UPGRADE_PRIMARY")
  await waitForCondition(() => mock.state.upgradePrimaryResumed, "same real OpenCode session reconciling after Loom upgrade", () => mock.state)
  await sendPrompt(restartedHost, upgradeSecondary.id, "LOOM_INTEGRATION_UPGRADE_SECONDARY")
  await waitForCondition(() => mock.state.upgradeSecondaryResumed, "secondary persisted session reconciling through admitted workflow", () => mock.state)

  const resumedPrimarySidebar = await jsonRequest(
    `${restartedHost.baseUrl}/api/rpc/loom.control/sidebar`, restartedHost.authorization,
    { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ input: { sessionID: upgradePrimary.id } }) },
  )
  const resumedSecondarySidebar = await jsonRequest(
    `${restartedHost.baseUrl}/api/rpc/loom.control/sidebar`, restartedHost.authorization,
    { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ input: { sessionID: upgradeSecondary.id } }) },
  )
  const resumedPrimaryOutput = resumedPrimarySidebar?.output ?? resumedPrimarySidebar
  const resumedSecondaryOutput = resumedSecondarySidebar?.output ?? resumedSecondarySidebar
  if (resumedPrimaryOutput?.workflowId !== UPGRADE_WORKFLOW_ID || resumedSecondaryOutput?.workflowId !== UPGRADE_WORKFLOW_ID) {
    throw new Error("Restarted real OpenCode sessions did not reconcile to the legacy workflow")
  }

  await runLifecycleHostScenarios({
    project: projectA,
    create: async (agent, parent) => {
      const session = await jsonRequestAny([`${serverA.baseUrl}/api/session`, `${serverA.baseUrl}/session`], serverA.authorization, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify(sessionCreateBody("Loom lifecycle regression", agent, parent)),
      })
      if (!session?.id) throw new Error("Lifecycle scenario could not create a real session")
      return session.id
    },
    run: async (sessionID, code) => {
      const prompt = `LOOM_PROGRAM_${crypto.randomUUID()}`
      const program: { code: string; done: boolean; result?: unknown } = { code, done: false }
      mock.state.programs.set(prompt, program)
      try {
        await sendPrompt(serverA, sessionID, prompt)
        await waitForCondition(() => program.done, "lifecycle host program", () => program, 30_000)
        return program.result
      } finally { mock.state.programs.delete(prompt) }
    },
  })

  console.log("PASS OpenCode host integration")
  console.log(` - workflow: ${mock.state.workflowId}`)
  console.log(` - worker/reviewer attached: ${mock.state.workerAttached}/${mock.state.reviewerAttached}`)
  console.log(` - peer-process review completed + observed by origin: ${mock.state.reviewerCompleted}/${mock.state.generalSawPeerReviewComplete}`)
  console.log(` - real OpenCode budget question tool state observed: ${mock.state.budgetQuestionObserved}`)
  console.log(` - real TUI budget approval resumed/completed exact Worker: ${mock.state.budgetContinuationObserved}/${mock.state.budgetWorkerCompleted}`)
  console.log(" - crashed budget-question owner reclaimed by restarted OpenCode host: true")
  console.log(` - OpenCode auto-started dashboard endpoint reached from sidebar: ${reviewerStatusUrl}`)
  console.log(` - disconnected browser degraded cleanly: ${mock.state.statusPreviewFallbackObserved}`)
  console.log(` - native Loom tool guidance reached provider context: ${mock.state.sawNativeLoomToolGuidance}`)
  console.log(` - Loom Code Mode mirrors discoverable: ${mock.state.codeModeLoomSearchObserved}`)
  console.log(` - Loom Code Mode mirror executed: ${mock.state.codeModeLoomStatusObserved}`)
  console.log(` - status artifact previewed through browser RPC: ${mock.state.statusPreviewRequested} · ${mock.state.statusArtifactPath}`)
  console.log(` - same-workflow read + unrelated/cross-project rejection: ${mock.state.reviewerSawWorkerComplete}/${mock.state.unrelatedRejected}/${mock.state.crossProjectRejected}`)
  console.log(` - sessions: ${sessionA.id}, ${sessionB.id}`)
  console.log(` - shared Loom runtime root: ${runtimeRecord.runtimeRoot}`)
  console.log(` - projected projects: ${fleet.projects.map((project) => project.projectId).join(", ")}`)
  console.log(` - restart reconciliation: ${mock.state.upgradePrimaryResumed}/${mock.state.upgradeSecondaryResumed}`)
  console.log(` - resumed session IDs: ${upgradePrimary.id}, ${upgradeSecondary.id}`)
} finally {
  await Promise.allSettled(servers.map(stop))
  mock.server.stop(true)
  await rm(base, { recursive: true, force: true })
}
