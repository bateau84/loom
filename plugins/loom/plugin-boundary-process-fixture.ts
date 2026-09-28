import { execFile } from "node:child_process"
import { promisify } from "node:util"
import { join } from "node:path"
import loomPlugin from "./index"

const execFileAsync = promisify(execFile)

class MemoryStorage {
  values = new Map<string, unknown>()
  async get(key: string) { return this.values.get(key) }
  async set(key: string, value: unknown) { this.values.set(key, value); return value }
  async scan({ prefix, limit = 100, after = "" }: { prefix: string; limit?: number; after?: string }) {
    const entries = [...this.values.entries()]
      .filter(([key]) => key.startsWith(prefix) && key > after)
      .sort(([a], [b]) => a.localeCompare(b))
      .slice(0, limit)
    return { entries: entries.map(([key, value]) => ({ key, value })), next: undefined }
  }
}

const [phase, root, workflowId, sessionID, ...extra] = process.argv.slice(2)
if (!phase || !root || !sessionID) throw new Error("phase, project root and session ID are required")

const waitForFile = async (path: string) => {
  const deadline = Date.now() + 20_000
  while (Date.now() < deadline) {
    try { return await (await import("node:fs/promises")).readFile(path, "utf8") }
    catch (error: any) { if (error?.code !== "ENOENT") throw error }
    await Bun.sleep(20)
  }
  throw new Error(`process fixture timed out waiting for ${path}`)
}

const registered = new Map<string, any>()
const toolHooks = new Map<string, (event: any) => void | Promise<void>>()
const permissionHooks = new Map<string, (event: any) => void | Promise<void>>()
const projectID = "opencode-project-a"
const ctx: any = {
  location: { directory: root, project: { canonical: root, id: projectID } },
  storage: new MemoryStorage(),
  rpc: { register: async () => ({}) },
  agent: { transform: async (fn: (editor: any) => unknown) => fn({ get: () => undefined, default: () => {} }) },
  tool: {
    transform: async (fn: (editor: any) => unknown) => fn({
      namespace: () => {},
      list: () => [...registered.entries()].map(([id, definition]) => ({ ...definition, id })),
      add: (definition: any) => {
        const namespace = definition.options?.namespace
        const id = namespace ? `${namespace.replaceAll(".", "_")}_${definition.name}` : definition.name
        registered.set(id, definition)
      },
    }),
    hook: async (name: string, fn: (event: any) => void | Promise<void>) => { toolHooks.set(name, fn) },
  },
  permission: { hook: async (name: string, fn: (event: any) => void | Promise<void>) => { permissionHooks.set(name, fn) } },
  session: {
    get: async ({ sessionID: id }: { sessionID: string }) => ({ id, projectID }),
    hook: async () => ({ dispose: async () => {} }),
  },
}

const call = async (name: string, input: unknown, agent: string, targetSessionID: string) => {
  const tool = registered.get(name) ?? registered.get(`loom_${name}`)
  if (!tool) throw new Error(`Tool not registered: ${name}`)
  const result = await tool.execute(input, { agent, sessionID: targetSessionID })
  return JSON.parse(result.content)
}

const runObserved = async (event: any, execute: () => Promise<void>, status: "completed" | "error" = "completed") => {
  await toolHooks.get("execute.before")?.(event)
  try {
    await execute()
    await toolHooks.get("execute.after")?.({ ...event, status, result: "process fixture result" })
  } catch (error) {
    await toolHooks.get("execute.after")?.({ ...event, status: "error", error })
    throw error
  }
}

const cleanup = await (loomPlugin as any).setup(ctx) as (() => Promise<void>) | undefined
try {
  if (phase === "prepare") {
    const generalSessionID = `delta-process-general-${sessionID}`
    const started = await call("start", { request: "Exercise owned-delta replay after process restart." }, "general", generalSessionID)
    const id = String(started.workflowId)
    const route = await call("route", {
      humanFacing: false, behavioral: false, structural: false, externalUnknown: false,
      diagnostic: false, productOutcome: false, implementationRequested: true, executionDepth: "task",
    }, "general", generalSessionID)
    if (route.error) throw new Error(String(route.error))
    const scope = await call("task_scope", { workflowId: id, stepId: "worker", write: ["src/shared.ts"] }, "general", generalSessionID)
    if (scope.error) throw new Error(String(scope.error))
    const grant = await call("dispatch_grant", { workflowId: id, stepId: "worker" }, "general", generalSessionID)
    const attached = await call("attach", { grantId: grant.grantId, workflowId: id, stepId: "worker" }, "worker", sessionID)
    if (!attached.attached) throw new Error(`worker attachment failed: ${JSON.stringify(attached)}`)

    const mutation = {
      tool: "edit", callID: "owned-delta-process-edit", messageID: "owned-delta-process-message",
      sessionID, agent: "worker", input: { filePath: join(root, "src", "shared.ts") },
    }
    await runObserved(mutation, async () => {
      await import("node:fs/promises").then(({ writeFile }) => writeFile(
        join(root, "src", "shared.ts"),
        "alpha\nforeign\nseparator\nnew\nomega\n",
      ))
    })
    process.stdout.write(JSON.stringify({ workflowId: id, sessionID, generalSessionID }) + "\n")
  } else if (phase === "prepare-abandoned") {
    const generalSessionID = `abandoned-delta-general-${sessionID}`
    const started = await call("start", { request: "Exercise owner-death fallback for missing mutation receipt." }, "general", generalSessionID)
    const id = String(started.workflowId)
    const route = await call("route", {
      humanFacing: false, behavioral: false, structural: false, externalUnknown: false,
      diagnostic: false, productOutcome: false, implementationRequested: true, executionDepth: "task",
    }, "general", generalSessionID)
    if (route.error) throw new Error(String(route.error))
    const scope = await call("task_scope", { workflowId: id, stepId: "worker", write: ["src/shared.ts"] }, "general", generalSessionID)
    if (scope.error) throw new Error(String(scope.error))
    const firstGrant = await call("dispatch_grant", { workflowId: id, stepId: "worker" }, "general", generalSessionID)
    const attached = await call("attach", { grantId: firstGrant.grantId, workflowId: id, stepId: "worker" }, "worker", sessionID)
    if (!attached.attached) throw new Error(`first worker attachment failed: ${JSON.stringify(attached)}`)

    const mutation = {
      tool: "edit", callID: "abandoned-delta-edit", messageID: "abandoned-delta-message",
      sessionID, agent: "worker", input: { filePath: join(root, "src", "shared.ts") },
    }
    await toolHooks.get("execute.before")?.(mutation)
    await (await import("node:fs/promises")).writeFile(
      join(root, "src", "shared.ts"),
      "alpha\nforeign\nseparator\nabandoned\nomega\n",
    )
    const result = {
      workflowId: id,
      generalSessionID,
      firstWorkerSessionID: sessionID,
    }
    await new Promise<void>((resolve) => process.stdout.write(JSON.stringify(result) + "\n", resolve))
    // Deliberately skip execute.after. Process death must release the flock
    // keeper without creating a delta receipt for the abandoned bytes.
    process.exit(0)
  } else if (phase === "retry-abandoned") {
    if (!workflowId) throw new Error("retry-abandoned requires workflow ID")
    const [generalSessionID] = extra
    if (!generalSessionID) throw new Error("retry-abandoned requires General session")
    const reopened = await call("reopen", {
      workflowId,
      stepId: "worker",
      reason: "recover after verified owner-process death",
      newEvidence: true,
      changedHypothesis: false,
      changedStrategy: false,
      reducedUnresolved: false,
    }, "general", generalSessionID)
    if (reopened.error) throw new Error(`could not reopen abandoned worker attempt: ${String(reopened.error)}`)
    const retryGrant = await call("dispatch_grant", { workflowId, stepId: "worker" }, "general", generalSessionID)
    const attached = await call("attach", { grantId: retryGrant.grantId, workflowId, stepId: "worker" }, "worker", sessionID)
    if (!attached.attached) throw new Error(`retry worker attachment failed: ${JSON.stringify(attached)}`)

    const stageCommand = "git add -- src/shared.ts"
    const stagePermission: any = { agent: "worker", action: "shell", resources: [stageCommand], sessionID }
    await permissionHooks.get("evaluate")!(stagePermission)
    let stageDenied = stagePermission.effect !== "allow"
    let stageError = stageDenied ? String(stagePermission.message ?? "stage permission denied") : undefined
    if (!stageDenied) {
      const stage = {
        tool: "shell", callID: "abandoned-delta-retry-stage", messageID: "abandoned-delta-retry-stage-message",
        sessionID, agent: "worker", input: { command: stageCommand },
      }
      try {
        await runObserved(stage, () => execFileAsync("git", ["add", "--", "src/shared.ts"], { cwd: root }).then(() => {}))
      } catch (error) {
        stageDenied = true
        stageError = error instanceof Error ? error.message : String(error)
      }
    }

    const commitCommand = "git -c core.hooksPath=/dev/null commit -m 'test: reject abandoned delta adoption'"
    const commitPermission: any = { agent: "worker", action: "shell", resources: [commitCommand], sessionID }
    await permissionHooks.get("evaluate")!(commitPermission)
    const head = await execFileAsync("git", ["show", "HEAD:src/shared.ts"], { cwd: root, encoding: "utf8" })
    const index = await execFileAsync("git", ["show", ":src/shared.ts"], { cwd: root, encoding: "utf8" })
    process.stdout.write(JSON.stringify({
      attached: true,
      attempt: attached.attempt,
      stageDenied,
      ...(stageError ? { stageError } : {}),
      commitEffect: commitPermission.effect,
      commitMessage: commitPermission.message,
      head: head.stdout,
      index: index.stdout,
    }) + "\n")
  } else if (phase === "hold") {
    if (!workflowId) throw new Error("hold phase requires workflow ID")
    const [startedFile, releaseFile] = extra
    if (!startedFile || !releaseFile) throw new Error("hold phase requires started and release signal files")
    const event = {
      tool: "edit", callID: "process-reopen-held-edit", messageID: "process-reopen-held-message",
      sessionID, agent: "worker", input: { filePath: join(root, "src", "shared.ts") },
    }
    await toolHooks.get("execute.before")?.(event)
    await (await import("node:fs/promises")).writeFile(startedFile, "held")
    await waitForFile(releaseFile)
    await toolHooks.get("execute.after")?.({
      ...event, status: "error", error: new Error("process fixture released without mutation"),
    })
    process.stdout.write(JSON.stringify({ released: true }) + "\n")
  } else if (phase === "reopen") {
    if (!workflowId) throw new Error("reopen phase requires workflow ID")
    const [startedFile] = extra
    if (!startedFile) throw new Error("reopen phase requires a started signal path")
    await (await import("node:fs/promises")).writeFile(startedFile, "reopening")
    const result = await call("reopen", {
      workflowId, stepId: "worker", reason: "independent process reopen race",
      newEvidence: true, changedHypothesis: false, changedStrategy: false, reducedUnresolved: false,
    }, "general", sessionID)
    process.stdout.write(JSON.stringify(result) + "\n")
  } else if (phase === "stale-stage") {
    if (!workflowId) throw new Error("stale-stage phase requires workflow ID")
    const command = "git add -- src/shared.ts"
    try {
      await toolHooks.get("execute.before")?.({
        tool: "shell", callID: "process-reopen-stale-stage", messageID: "process-reopen-stale-stage-message",
        sessionID, agent: "worker", input: { command },
      })
      process.stdout.write(JSON.stringify({ denied: false }) + "\n")
    } catch (error) {
      process.stdout.write(JSON.stringify({ denied: true, error: error instanceof Error ? error.message : String(error) }) + "\n")
    }
  } else if (phase === "publish") {
    if (!workflowId) throw new Error("publish phase requires workflow ID")
    const stageCommand = "git add -- src/shared.ts"
    const stagePermission: any = { agent: "worker", action: "shell", resources: [stageCommand], sessionID }
    await permissionHooks.get("evaluate")!(stagePermission)
    if (stagePermission.effect !== "allow") throw new Error(`stage denied: ${stagePermission.message}`)
    const stage = {
      tool: "shell", callID: "owned-delta-process-stage", messageID: "owned-delta-process-stage-message",
      sessionID, agent: "worker", input: { command: stageCommand },
    }
    await runObserved(stage, () => execFileAsync("git", ["add", "--", "src/shared.ts"], { cwd: root }).then(() => {}))
    const staged = await execFileAsync("git", ["show", ":src/shared.ts"], { cwd: root, encoding: "utf8" })
    if (staged.stdout !== "alpha\nseparator\nnew\nomega\n") throw new Error("restart replay staged bytes other than the owned projection")

    const commitCommand = "git -c core.hooksPath=/dev/null commit -m 'test: replay owned delta after process restart'"
    const commitPermission: any = { agent: "worker", action: "shell", resources: [commitCommand], sessionID }
    await permissionHooks.get("evaluate")!(commitPermission)
    if (commitPermission.effect !== "allow") throw new Error(`commit denied: ${commitPermission.message}`)
    const commit = {
      tool: "shell", callID: "owned-delta-process-commit", messageID: "owned-delta-process-commit-message",
      sessionID, agent: "worker", input: { command: commitCommand },
    }
    await runObserved(commit, () => execFileAsync("git", ["-c", "core.hooksPath=/dev/null", "commit", "-m", "test: replay owned delta after process restart"], { cwd: root }).then(() => {}))
    const completed = await call("complete", { workflowId, stepId: "worker", summary: "replayed durable owned delta after a new process" }, "worker", sessionID)
    if (completed.error) throw new Error(String(completed.error))
    process.stdout.write(JSON.stringify({ completed: true }) + "\n")
  } else {
    throw new Error(`unknown phase: ${phase}`)
  }
} finally {
  await cleanup?.()
}
