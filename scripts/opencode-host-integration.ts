import { runLifecycleHostScenarios } from "./lifecycle-host-scenarios"
import { createServer } from "node:net"
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises"
import { join, resolve } from "node:path"
import { tmpdir } from "node:os"
import { aggregateFleetFromDisk, readPublisherRecords } from "../plugins/loom/dashboard"

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
      const prompt = latestUserPrompt(messages)
      state.prompts.push(prompt)
      const latestUserIndex = messages.findLastIndex((message: any) => message?.role === "user")
      const turnMessages = latestUserIndex >= 0 ? messages.slice(latestUserIndex + 1) : messages
      const results = toolResults(turnMessages)
      const action = chooseMockAction(prompt, results, state)
      const model = String(body.model ?? "mock")
      const content = action ? null : "integration sequence complete"
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
  predicate: () => boolean,
  label: string,
  debug?: () => unknown,
  timeoutMs = 15_000,
) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (predicate()) return
    await Bun.sleep(100)
  }
  const detail = debug ? `\nDebug: ${JSON.stringify(debug(), null, 2)}` : ""
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

type DashboardHandle = {
  baseUrl: string
  proc: ReturnType<typeof Bun.spawn>
  stdout: Promise<string>
  stderr: Promise<string>
}

async function startDashboardProcess(sharedState: string): Promise<DashboardHandle> {
  let port = await freePort()
  while (port === 4318) port = await freePort()
  const baseUrl = `http://127.0.0.1:${port}`
  const env = processEnv({
    XDG_STATE_HOME: sharedState,
    LOOM_DASHBOARD_PORT: String(port),
    LOOM_DASHBOARD_URL: undefined,
  })
  const proc = Bun.spawn(
    ["bun", "dashboard/server.ts"],
    { cwd: root, env, stdout: "pipe", stderr: "pipe" },
  )
  const stdout = new Response(proc.stdout).text()
  const stderr = new Response(proc.stderr).text()
  try {
    await waitFor(`${baseUrl}/health`, "")
    const endpointPath = join(sharedState, "loom", "dashboard-endpoint.json")
    const deadline = Date.now() + 10_000
    while (Date.now() < deadline) {
      try {
        const record = JSON.parse(await readFile(endpointPath, "utf8"))
        if (record?.baseUrl === baseUrl && Date.parse(record.leaseExpiresAt) > Date.now()) {
          return { baseUrl, proc, stdout, stderr }
        }
      } catch {}
      await Bun.sleep(100)
    }
    throw new Error("Dashboard endpoint lease was not published")
  } catch (error) {
    proc.kill()
    const logs = await Promise.all([stdout, stderr])
    throw new Error(`${error instanceof Error ? error.message : String(error)}\nstdout:\n${logs[0]}\nstderr:\n${logs[1]}`)
  }
}

async function stopDashboard(handle: DashboardHandle) {
  if (handle.proc.exitCode === null) handle.proc.kill("SIGTERM")
  await Promise.race([
    handle.proc.exited,
    Bun.sleep(5_000).then(() => {
      if (handle.proc.exitCode === null) handle.proc.kill("SIGKILL")
    }),
  ])
  await Promise.allSettled([handle.stdout, handle.stderr])
}

type ServerHandle = {
  project: string
  baseUrl: string
  proc: ReturnType<typeof Bun.spawn>
  stdout: Promise<string>
  stderr: Promise<string>
  authorization: string
}

async function startServer(
  base: string,
  project: string,
  sharedState: string,
  runtimeDir: string | undefined,
  name: string,
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
    OPENCODE_SERVER_USERNAME: "opencode",
    OPENCODE_SERVER_PASSWORD: password,
    LOOM_TOOL_OUTPUT: "json",
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
  return { project, baseUrl, proc, stdout, stderr, authorization }
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

const base = await mkdtemp(join(tmpdir(), "loom-opencode-host-"))
const sharedState = join(base, "shared-state")
const runtimeA = join(base, "runtime-a")
const runtimeB = join(base, "runtime-b")
const servers: ServerHandle[] = []
let dashboard: DashboardHandle | undefined
const mock = await startMockProvider()

try {
  const [projectA, projectB] = await Promise.all([
    createProject(base, "project-a", mock.baseUrl),
    createProject(base, "project-b", mock.baseUrl),
  ])

  const serverA = await startServer(base, projectA, sharedState, runtimeA, "server-a")
  servers.push(serverA)
  const serverAPeer = await startServer(base, projectA, sharedState, runtimeB, "server-a-peer")
  servers.push(serverAPeer)
  const serverB = await startServer(base, projectB, sharedState, runtimeB, "server-b")
  servers.push(serverB)

  dashboard = await startDashboardProcess(sharedState)

  const sessionA = await jsonRequestAny(
    [`${serverA.baseUrl}/api/session`, `${serverA.baseUrl}/session`],
    serverA.authorization,
    {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(sessionCreateBody("Loom integration A", "general")),
    },
  )
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

  const sidebarA = await jsonRequest(`${serverA.baseUrl}/api/rpc/loom.control/sidebar`, serverA.authorization, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ input: { sessionID: sessionA.id } }),
  })
  const sidebarB = await jsonRequest(`${serverB.baseUrl}/api/rpc/loom.control/sidebar`, serverB.authorization, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ input: { sessionID: sessionB.id } }),
  })
  const outputA = sidebarA?.output ?? sidebarA
  const outputB = sidebarB?.output ?? sidebarB
  if (outputA?.active !== false || outputB?.active !== false) {
    throw new Error("Fresh OpenCode sessions did not receive idle Loom RPC state")
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
  console.log(` - shared non-default dashboard endpoint reached from sidebar: ${reviewerStatusUrl}`)
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
  if (dashboard) await stopDashboard(dashboard)
  mock.server.stop(true)
  await rm(base, { recursive: true, force: true })
}
