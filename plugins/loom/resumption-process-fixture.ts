import { expect, mock, setDefaultTimeout, test } from "bun:test"
import { readFile, writeFile } from "node:fs/promises"

class FixtureStorage {
  private readonly values = new Map<string, unknown>()

  async get(key: string) {
    return this.values.get(key)
  }

  async set(key: string, value: unknown) {
    this.values.set(key, value)
    return value
  }

  async scan({ prefix, limit = 100, after = "" }: { prefix: string; limit?: number; after?: string }) {
    const all = [...this.values.entries()]
      .filter(([key]) => key.startsWith(prefix) && key > after)
      .sort(([left], [right]) => left.localeCompare(right))
    const selected = all.slice(0, limit)
    return {
      entries: selected.map(([key, value]) => ({ key, value })),
      next: all.length > selected.length ? selected.at(-1)?.[0] : undefined,
    }
  }
}

async function waitForFile(path: string) {
  for (let attempt = 0; attempt < 20_000; attempt++) {
    try {
      await readFile(path)
      return
    } catch (error: any) {
      if (error?.code !== "ENOENT") throw error
    }
    await Bun.sleep(5)
  }
  throw new Error(`Process fixture did not receive its explicit release barrier: ${path}`)
}

const mode = process.env.LOOM_RESUMPTION_FIXTURE_MODE
setDefaultTimeout(30_000)

test("production Loom process fixture executes an actual registered tool", async () => {
  if (!mode) throw new Error("Fixture must be launched with LOOM_RESUMPTION_FIXTURE_MODE.")
  const projectRoot = process.env.LOOM_RESUMPTION_PROJECT_ROOT
  const sessionID = process.env.LOOM_RESUMPTION_SESSION_ID
  const agent = process.env.LOOM_RESUMPTION_AGENT
  const input = JSON.parse(process.env.LOOM_RESUMPTION_INPUT ?? "{}") as unknown
  if (!projectRoot || !sessionID || !agent) throw new Error("Process fixture identity inputs are incomplete.")

  const actualRuntime = await import("./runtime")
  const originalWithRuntimeLock = actualRuntime.withRuntimeLock
  const originalWithRuntimeAdvisoryLock = actualRuntime.withRuntimeAdvisoryLock
  const originalWithRuntimeLocks = actualRuntime.withRuntimeLocks
  const originalCreateTransactionalStorage = actualRuntime.createTransactionalStorage
  let barrierUsed = false
  const instrumentedRuntime = {
    ...actualRuntime,
    withRuntimeLock: async (
      runtime: Parameters<typeof actualRuntime.withRuntimeLock>[0],
      aggregate: string,
      resourceIdentity: string,
      fn: () => Promise<unknown>,
    ) => {
      if (mode === "permission-before-commit" && aggregate === "workflow" &&
          resourceIdentity === process.env.LOOM_RESUMPTION_WORKFLOW_ID && !barrierUsed) {
        barrierUsed = true
        await writeFile(process.env.LOOM_RESUMPTION_READY_FILE!, "selected-before-commit")
        await waitForFile(process.env.LOOM_RESUMPTION_RELEASE_FILE!)
      }
      return originalWithRuntimeLock(runtime, aggregate, resourceIdentity, fn)
    },
    withRuntimeAdvisoryLock: async (
      runtime: Parameters<typeof actualRuntime.withRuntimeAdvisoryLock>[0],
      aggregate: string,
      resourceIdentity: string,
      fn: () => Promise<unknown>,
    ) => {
      if ((mode === "wait-native" || mode === "wait-codemode") &&
          aggregate === "session-coordinator" && resourceIdentity === sessionID && !barrierUsed) {
        barrierUsed = true
        await writeFile(process.env.LOOM_RESUMPTION_READY_FILE!, "captured-before-lease")
        await waitForFile(process.env.LOOM_RESUMPTION_RELEASE_FILE!)
      }
      if (mode === "resume-before-coordinator-lease" &&
          aggregate === "session-coordinator" && resourceIdentity === sessionID && !barrierUsed) {
        barrierUsed = true
        await writeFile(process.env.LOOM_RESUMPTION_READY_FILE!, "captured-before-coordinator-lease")
        await waitForFile(process.env.LOOM_RESUMPTION_RELEASE_FILE!)
      }
      return originalWithRuntimeAdvisoryLock(runtime, aggregate, resourceIdentity, fn)
    },
    withRuntimeLocks: async (
      runtime: Parameters<typeof actualRuntime.withRuntimeLocks>[0],
      resources: Parameters<typeof actualRuntime.withRuntimeLocks>[1],
      fn: () => Promise<unknown>,
    ) => {
      if (mode === "permission-before-commit" && !barrierUsed &&
          resources.some((resource) => resource.aggregate === "workflow" &&
            resource.resourceIdentity === process.env.LOOM_RESUMPTION_WORKFLOW_ID)) {
        barrierUsed = true
        await writeFile(process.env.LOOM_RESUMPTION_READY_FILE!, "selected-before-commit")
        await waitForFile(process.env.LOOM_RESUMPTION_RELEASE_FILE!)
      }
      if (mode === "resume-after-observation" && !barrierUsed &&
          resources.some((resource) => resource.aggregate === "workflow" &&
            resource.resourceIdentity === process.env.LOOM_RESUMPTION_SOURCE_WORKFLOW_ID) &&
          resources.some((resource) => resource.aggregate === "workflow" &&
            resource.resourceIdentity === process.env.LOOM_RESUMPTION_TARGET_WORKFLOW_ID)) {
        barrierUsed = true
        await writeFile(process.env.LOOM_RESUMPTION_READY_FILE!, "source-target-snapshots-loaded-before-locks")
        await waitForFile(process.env.LOOM_RESUMPTION_RELEASE_FILE!)
      }
      const result = await originalWithRuntimeLocks(runtime, resources, fn)
      const sourceId = process.env.LOOM_RESUMPTION_SOURCE_WORKFLOW_ID
      const targetId = process.env.LOOM_RESUMPTION_TARGET_WORKFLOW_ID
      if (mode === "resume-response-loss" && sourceId && targetId &&
          resources.some((resource) => resource.aggregate === "workflow" && resource.resourceIdentity === sourceId) &&
          resources.some((resource) => resource.aggregate === "workflow" && resource.resourceIdentity === targetId) &&
          (result as { status?: string } | undefined)?.status === "resumed") {
        process.exit(86)
      }
      return result
    },
    createTransactionalStorage: async (runtime: Parameters<typeof actualRuntime.createTransactionalStorage>[0]) => {
      const store = await originalCreateTransactionalStorage(runtime)
      if (mode === "resume-crash-after-binding-write") {
        const originalSet = store.set.bind(store)
        store.set = async (key, value) => {
          const result = await originalSet(key, value)
          if (key.endsWith(`/session/${sessionID}`)) process.exit(87)
          return result
        }
      }
      return store
    },
  }
  mock.module("./runtime", () => instrumentedRuntime)
  mock.module("./dashboard-lifecycle", () => ({
    ensureDashboardServerLifecycle: async () => undefined,
  }))
  mock.module("./dashboard", () => ({
    createDashboardPublisher: () => ({
      trigger: () => undefined,
      startHeartbeat: () => () => undefined,
      publish: async () => undefined,
      generation: 0,
      lastError: undefined,
    }),
    runtimeInstanceIsLive: async () => false,
  }))

  const { default: loomPlugin } = await import("./index")
  const registered = new Map<string, any>()
  const permissionHooks = new Map<string, (event: any) => Promise<void> | void>()
  const ctx: any = {
    location: {
      directory: projectRoot,
      project: { canonical: projectRoot, id: process.env.LOOM_RESUMPTION_PROJECT_ID ?? "resume-process-project" },
    },
    storage: new FixtureStorage(),
    rpc: { register: async () => ({}) },
    agent: {
      list: async () => ({ location: { directory: projectRoot }, data: [] }),
      transform: async (fn: (editor: any) => unknown) => fn({ get: () => undefined, default: () => undefined }),
    },
    tool: {
      list: async () => [...registered.entries()].map(([id, definition]) => ({ ...definition, id })),
      transform: async (fn: (editor: any) => unknown) => fn({
        namespace: () => undefined,
        list: () => [...registered.entries()].map(([id, definition]) => ({ ...definition, id })),
        add: (definition: any) => {
          const namespace = definition.options?.namespace
          const id = namespace ? `${namespace.replaceAll(".", "_")}_${definition.name}` : definition.name
          registered.set(id, definition)
        },
      }),
      hook: async () => undefined,
    },
    permission: {
      hook: async (name: string, callback: (event: any) => Promise<void> | void) => permissionHooks.set(name, callback),
    },
    session: {
      get: async ({ sessionID: id }: { sessionID: string }) => ({
        id,
        projectID: process.env.LOOM_RESUMPTION_PROJECT_ID ?? "resume-process-project",
      }),
      synthetic: async (signal: Record<string, unknown>) => ({ id: "fixture-synthetic", sessionID: signal.sessionID }),
      hook: async () => ({ dispose: async () => undefined }),
    },
  }

  await (loomPlugin as any).setup(ctx)
  const legacyStorage = ctx.storage as FixtureStorage
  const legacyRecords = JSON.parse(process.env.LOOM_RESUMPTION_LEGACY_RECORDS ?? "[]") as Array<[string, unknown]>
  for (const [key, value] of legacyRecords) await legacyStorage.set(key, value)
  let result: unknown
  if (mode === "permission-before-commit") {
    const event = JSON.parse(process.env.LOOM_RESUMPTION_EVENT ?? "{}") as Record<string, unknown>
    await permissionHooks.get("evaluate")!(event)
    result = event
  } else if (mode === "delete-workflow") {
    const runtime = await actualRuntime.resolveRuntimeIdentity(projectRoot, legacyStorage)
    const raw = await actualRuntime.createTransactionalStorage(runtime)
    const storage = actualRuntime.createProjectStorage(raw, runtime.projectId, {
      expectedRuntimeVersion: actualRuntime.RUNTIME_STATE_VERSION,
    })
    const { deleteWorkflowRecords } = await import("./workflow-cleanup")
    result = await deleteWorkflowRecords(storage, runtime, JSON.parse(process.env.LOOM_RESUMPTION_INPUT ?? "{}"))
  } else if (mode === "cancel-workflow") {
    const runtime = await actualRuntime.resolveRuntimeIdentity(projectRoot, legacyStorage)
    const raw = await actualRuntime.createTransactionalStorage(runtime)
    const storage = actualRuntime.createProjectStorage(raw, runtime.projectId, {
      expectedRuntimeVersion: actualRuntime.RUNTIME_STATE_VERSION,
    })
    const { cancelWorkflow } = await import("./lifecycle")
    result = await cancelWorkflow(
      storage,
      runtime,
      input as { workflowId: string; reason: string; confirmation: string },
      { agent, sessionID },
    )
  } else {
    const toolName = process.env.LOOM_RESUMPTION_TOOL_NAME ?? ""
    const surface = process.env.LOOM_RESUMPTION_SURFACE === "code" ? "loom_code_" : "loom_"
    const tool = registered.get(`${surface}${toolName}`)
    if (!tool) throw new Error(`Fixture Loom tool is not registered: ${surface}${toolName}`)
    try {
      const output = await tool.execute(input, { agent, sessionID })
      try {
        result = JSON.parse(output.content)
      } catch {
        result = output.content
      }
    } catch (error) {
      result = { thrown: error instanceof Error ? error.message : String(error) }
    }
  }

  expect(result).toBeDefined()
  process.stdout.write(`LOOM_RESUMPTION_RESULT:${JSON.stringify(result)}\n`)
}, 30_000)
