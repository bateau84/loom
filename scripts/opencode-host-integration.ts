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


type MockProviderState = {
  workflowId?: string
  workerGrantId?: string
  reviewerGrantId?: string
  workerAttached: boolean
  workerCompleted: boolean
  reviewerAttached: boolean
  reviewerSawWorkerComplete: boolean
  unrelatedRejected: boolean
  crossProjectRejected: boolean
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
    if (!results.has("loom_attach")) {
      return {
        name: "loom_attach",
        args: { grantId: state.reviewerGrantId, workflowId: state.workflowId, stepId: "review-implementation" },
      }
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

  return null
}

async function startMockProvider() {
  const state: MockProviderState = {
    workerAttached: false,
    workerCompleted: false,
    reviewerAttached: false,
    reviewerSawWorkerComplete: false,
    unrelatedRejected: false,
    crossProjectRejected: false,
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
  for (const agent of ["general", "worker", "reviewer"]) {
    await symlink(join(root, "agents", `${agent}.md`), join(agentDir, `${agent}.md`), "file")
  }
  await writeFile(
    join(project, "opencode.json"),
    JSON.stringify({
      "$schema": "https://opencode.ai/config.json",
      plugins: ["./.opencode/plugins/loom"],
      model: "loommock/mock",
      enabled_providers: ["loommock"],
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
  agent: "general" | "worker" | "reviewer",
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
const mock = await startMockProvider()

try {
  const [projectA, projectB] = await Promise.all([
    createProject(base, "project-a", mock.baseUrl),
    createProject(base, "project-b", mock.baseUrl),
  ])

  const serverA = await startServer(base, projectA, sharedState, runtimeA, "server-a")
  servers.push(serverA)
  const serverB = await startServer(base, projectB, sharedState, runtimeB, "server-b")
  servers.push(serverB)

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
    [`${serverA.baseUrl}/api/session`, `${serverA.baseUrl}/session`],
    serverA.authorization,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(sessionCreateBody("Loom integration Reviewer", "reviewer", sessionA.id)),
    },
  )
  await sendPrompt(serverA, reviewerSession.id, "LOOM_INTEGRATION_REVIEWER")
  await waitForCondition(
    () => mock.state.reviewerAttached && mock.state.reviewerSawWorkerComplete,
    "fresh real Reviewer attach and same-workflow read",
    () => mock.state,
  )

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
    `${serverA.baseUrl}/api/rpc/loom.control/sidebar`,
    serverA.authorization,
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

  const runtimeRecord = JSON.parse(
    await waitForFile(join(sharedState, "loom", "runtime-root.json")),
  ) as { schemaVersion: number; runtimeRoot: string }
  if (runtimeRecord.schemaVersion !== 1) throw new Error("Unexpected Loom runtime-root schema")
  if (runtimeRecord.runtimeRoot !== join(runtimeA, "loom")) {
    throw new Error(`Second OpenCode process did not honor first installation lock root: ${runtimeRecord.runtimeRoot}`)
  }

  const deadline = Date.now() + 15_000
  let records = await readPublisherRecords(runtimeRecord.runtimeRoot)
  while (records.length < 2 && Date.now() < deadline) {
    await Bun.sleep(150)
    records = await readPublisherRecords(runtimeRecord.runtimeRoot)
  }
  if (records.length < 2) {
    throw new Error(`Expected two Loom publisher records from real OpenCode processes, observed ${records.length}`)
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

  console.log("PASS OpenCode host integration")
  console.log(` - workflow: ${mock.state.workflowId}`)
  console.log(` - worker/reviewer attached: ${mock.state.workerAttached}/${mock.state.reviewerAttached}`)
  console.log(` - same-workflow read + unrelated/cross-project rejection: ${mock.state.reviewerSawWorkerComplete}/${mock.state.unrelatedRejected}/${mock.state.crossProjectRejected}`)
  console.log(` - sessions: ${sessionA.id}, ${sessionB.id}`)
  console.log(` - shared Loom runtime root: ${runtimeRecord.runtimeRoot}`)
  console.log(` - projected projects: ${fleet.projects.map((project) => project.projectId).join(", ")}`)
} finally {
  await Promise.allSettled(servers.map(stop))
  mock.server.stop(true)
  await rm(base, { recursive: true, force: true })
}
