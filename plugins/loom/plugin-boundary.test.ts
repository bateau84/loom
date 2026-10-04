import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test"
import { createHash } from "node:crypto"
import { execFile, spawn, spawnSync } from "node:child_process"
import { once } from "node:events"
import { promisify } from "node:util"
import { chmod, link, mkdir, mkdtemp, readFile, readdir, rm, stat, symlink, writeFile } from "node:fs/promises"
import { dirname, join } from "node:path"
import { tmpdir } from "node:os"
import { fileURLToPath } from "node:url"
import loomPlugin from "./index"
import { cancelWorkflow } from "./lifecycle"
import { deleteWorkflowRecords } from "./workflow-cleanup"
import { createWorkHierarchy, materializeWorkPlan, claimWorkflowWave, syncWorkTaskStatuses,
  completeWaveForTasks, releaseCancelledWorkflowClaims, reopenWaveForTasks, type WorkPlanTask } from "./work"
import { buildSidebarSnapshot } from "./sidebar"
import { prepareReportPromotion, publishPreparedReport, type ReportPromotionRecord } from "./reports"
import {
  RUNTIME_STATE_VERSION,
  createProjectStorage,
  createTransactionalStorage,
  resolveRuntimeIdentity,
  tryAcquireRuntimeLocks,
  type LoomRuntimeIdentity,
} from "./runtime"

const roots: string[] = []
setDefaultTimeout(30_000)

const execFileAsync = promisify(execFile)

async function git(root: string, args: string[]) {
  return execFileAsync("git", args, { cwd: root, encoding: "utf8" })
}

async function initializeGitFixture(root: string) {
  await git(root, ["init", "-q"])
  await git(root, ["config", "user.name", "Loom Test"])
  await git(root, ["config", "user.email", "loom-test@example.invalid"])
  await writeFile(
    join(root, ".git", "info", "exclude"),
    "state/\nruntime/\n.loom/\n",
  )
}


class MemoryStorage {
  values = new Map<string, unknown>()
  async get(key: string) { return this.values.get(key) }
  async set(key: string, value: unknown) { this.values.set(key, value); return value }
  async scan({ prefix, limit = 100, after = "" }: { prefix: string; limit?: number; after?: string }) {
    const all = [...this.values.entries()]
      .filter(([key]) => key.startsWith(prefix) && key > after)
      .sort(([a], [b]) => a.localeCompare(b))
    const selected = all.slice(0, limit)
    return {
      entries: selected.map(([key, value]) => ({ key, value })),
      next: all.length > selected.length ? selected.at(-1)?.[0] : undefined,
    }
  }
}

type RegisteredTool = {
  name: string
  input?: { properties?: { responder?: { enum?: string[] } } }
  options?: { namespace?: string; codemode?: boolean; permission?: string }
  execute: (input: unknown, tool: { agent: string; sessionID: string }) => Promise<{ content: string }>
}

async function harness(
  seed?: (storage: MemoryStorage, root: string, projectID: string) => void | Promise<void>,
  sessionInfo?: (sessionID: string, projectID: string) => { id: string; projectID?: string; parentID?: string },
  existing?: { root: string; storage: MemoryStorage },
  synthetic?: (input: Record<string, any>) => void | Promise<void>,
  agentList: (input?: { location?: { directory?: string } }) => {
    location: { directory: string }
    data: readonly { name: string; description?: string }[]
  } = (input) => ({ location: { directory: input?.location?.directory ?? "" }, data: [] }),
  sessionContext: (sessionID: string, projectID: string) => readonly unknown[] = () => [],
) {
  const root = existing?.root ?? await mkdtemp(join(tmpdir(), "loom-plugin-boundary-"))
  if (!existing) roots.push(root)
  await mkdir(join(root, "src"), { recursive: true })

  const previousState = process.env.XDG_STATE_HOME
  const previousRuntime = process.env.XDG_RUNTIME_DIR
  const previousOutput = process.env.LOOM_TOOL_OUTPUT
  process.env.XDG_STATE_HOME = join(root, "state")
  process.env.XDG_RUNTIME_DIR = join(root, "runtime")
  process.env.LOOM_TOOL_OUTPUT = "json"

  const registered = new Map<string, RegisteredTool>()
  const namespaces = new Map<string, string>()
  const sessionHooks = new Map<string, (event: any) => void | Promise<void>>()
  const permissionHooks = new Map<string, (event: any) => void | Promise<void>>()
  const toolHooks = new Map<string, (event: any) => void | Promise<void>>()
  const syntheticMessages: Array<Record<string, any>> = []
  const storage = existing?.storage ?? new MemoryStorage()
  const projectID = "opencode-project-a"
  await seed?.(storage, root, projectID)

  const ctx: any = {
    location: {
      directory: root,
      project: { canonical: root, id: projectID },
    },
    storage,
    rpc: { register: async () => ({}) },
    agent: {
      list: agentList,
      transform: async (fn: (editor: any) => unknown) =>
        fn({ get: () => undefined, default: () => {} }),
    },
    tool: {
      list: async () => [...registered.entries()].map(([id, definition]) => ({ ...definition, id })),
      transform: async (fn: (editor: any) => unknown) =>
        fn({
          namespace: (definition: { name: string; description: string }) =>
            namespaces.set(definition.name, definition.description),
          list: () =>
            [...registered.entries()].map(([id, definition]) => ({ ...definition, id })),
          add: (definition: RegisteredTool) => {
            const namespace = definition.options?.namespace
            const id = namespace ? `${namespace.replaceAll(".", "_")}_${definition.name}` : definition.name
            registered.set(id, definition)
          },
        }),
      hook: async (name: string, fn: (event: any) => void | Promise<void>) => {
        toolHooks.set(name, fn)
      },
    },
    permission: {
      hook: async (name: string, fn: (event: any) => void | Promise<void>) => {
        permissionHooks.set(name, fn)
      },
    },
    session: {
      get: async ({ sessionID }: { sessionID: string }) =>
        sessionInfo?.(sessionID, projectID) ?? {
          id: sessionID,
          projectID,
        },
      context: async ({ sessionID }: { sessionID: string }) =>
        sessionContext(sessionID, projectID),
      synthetic: async (input: Record<string, any>) => {
        syntheticMessages.push(input)
        await synthetic?.(input)
        return {
          id: `synthetic-${syntheticMessages.length}`,
          sessionID: input.sessionID,
        }
      },
      hook: async (name: string, callback: (event: any) => void | Promise<void>) => {
        sessionHooks.set(name, callback)
        return { dispose: async () => {} }
      },
    },
  }

  const runtime = await resolveRuntimeIdentity(root, ctx.storage)
  const durableStorage = createProjectStorage(
    await createTransactionalStorage(runtime),
    runtime.projectId,
  )

  await (loomPlugin as any).setup(ctx)

  const call = async (
    name: string,
    input: unknown,
    agent: string,
    sessionID: string,
  ) => {
    const tool = registered.get(name) ?? registered.get(`loom_${name}`)
    if (!tool) throw new Error(`Tool not registered: ${name}`)
    const result = await tool.execute(input, { agent, sessionID })
    return JSON.parse(result.content)
  }

  const callObserved = async (
    name: string,
    input: unknown,
    agent: string,
    sessionID: string,
    callID: string,
  ) => {
    const tool = registered.get(name) ?? registered.get(`loom_${name}`)
    if (!tool) throw new Error(`Tool not registered: ${name}`)
    const toolName = `loom_${name}`
    await toolHooks.get("execute.before")?.({
      tool: toolName,
      callID,
      sessionID,
      agent,
      input,
    })

    try {
      const result = await tool.execute(input, { agent, sessionID })
      await toolHooks.get("execute.after")?.({
        tool: toolName,
        callID,
        sessionID,
        agent,
        input,
        status: "completed",
        result: result.content,
      })
      return JSON.parse(result.content)
    } catch (error) {
      await toolHooks.get("execute.after")?.({
        tool: toolName,
        callID,
        sessionID,
        agent,
        input,
        status: "error",
        error,
      })
      throw error
    }
  }

  const restore = () => {
    if (previousState === undefined) delete process.env.XDG_STATE_HOME
    else process.env.XDG_STATE_HOME = previousState
    if (previousRuntime === undefined) delete process.env.XDG_RUNTIME_DIR
    else process.env.XDG_RUNTIME_DIR = previousRuntime
    if (previousOutput === undefined) delete process.env.LOOM_TOOL_OUTPUT
    else process.env.LOOM_TOOL_OUTPUT = previousOutput
  }

  return { root, storage, runtime, projectID, registered, namespaces, sessionHooks, permissionHooks, toolHooks, syntheticMessages, durableStorage, call, callObserved, restore }
}

function resumptionProcessEnvironment(
  projectRoot: string,
  input: {
    mode: string
    sessionID: string
    agent: string
    toolName: string
    surface?: "native" | "code"
    toolInput?: unknown
    workflowId?: string
    readyFile?: string
    releaseFile?: string
    sourceWorkflowId?: string
    targetWorkflowId?: string
    permissionEvent?: unknown
    legacyRecords?: Array<[string, unknown]>
  },
): Record<string, string> {
  const env: Record<string, string> = Object.fromEntries(
    Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined),
  )
  env.LOOM_RESUMPTION_FIXTURE_MODE = input.mode
  env.LOOM_RESUMPTION_PROJECT_ROOT = projectRoot
  env.LOOM_RESUMPTION_PROJECT_ID = "opencode-project-a"
  env.LOOM_RESUMPTION_SESSION_ID = input.sessionID
  env.LOOM_RESUMPTION_AGENT = input.agent
  env.LOOM_RESUMPTION_TOOL_NAME = input.toolName
  if (input.surface === "code") env.LOOM_RESUMPTION_SURFACE = "code"
  if (input.toolInput !== undefined) env.LOOM_RESUMPTION_INPUT = JSON.stringify(input.toolInput)
  if (input.workflowId) env.LOOM_RESUMPTION_WORKFLOW_ID = input.workflowId
  if (input.readyFile) env.LOOM_RESUMPTION_READY_FILE = input.readyFile
  if (input.releaseFile) env.LOOM_RESUMPTION_RELEASE_FILE = input.releaseFile
  if (input.sourceWorkflowId) env.LOOM_RESUMPTION_SOURCE_WORKFLOW_ID = input.sourceWorkflowId
  if (input.targetWorkflowId) env.LOOM_RESUMPTION_TARGET_WORKFLOW_ID = input.targetWorkflowId
  if (input.permissionEvent !== undefined) env.LOOM_RESUMPTION_EVENT = JSON.stringify(input.permissionEvent)
  if (input.legacyRecords !== undefined) env.LOOM_RESUMPTION_LEGACY_RECORDS = JSON.stringify(input.legacyRecords)
  return env
}

function spawnResumptionProcessFixture(
  projectRoot: string,
  input: Parameters<typeof resumptionProcessEnvironment>[1],
) {
  const fixture = fileURLToPath(new URL("./resumption-process-fixture.ts", import.meta.url))
  return Bun.spawn([process.execPath, "test", fixture], {
    cwd: projectRoot,
    env: resumptionProcessEnvironment(projectRoot, input),
    stdout: "pipe",
    stderr: "pipe",
  })
}

function startResumptionProcessFixture(
  projectRoot: string,
  input: Parameters<typeof resumptionProcessEnvironment>[1],
) {
  const fixture = fileURLToPath(new URL("./resumption-process-fixture.ts", import.meta.url))
  return Bun.spawn([process.execPath, "test", fixture], {
    cwd: projectRoot,
    env: resumptionProcessEnvironment(projectRoot, input),
    stdout: "pipe",
    stderr: "pipe",
  })
}

async function readResumptionProcessFixture(processFixture: ReturnType<typeof Bun.spawn>) {
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(processFixture.stdout as ReadableStream<Uint8Array>).text(),
    new Response(processFixture.stderr as ReadableStream<Uint8Array>).text(),
    processFixture.exited,
  ])
  if (exitCode !== 0) throw new Error(`Independent Loom fixture exited ${exitCode}: ${stderr}\n${stdout}`)
  const resultLine = stdout.split("\n").find((line) => line.startsWith("LOOM_RESUMPTION_RESULT:"))
  if (!resultLine) throw new Error(`Independent Loom fixture omitted its result: ${stdout}`)
  return JSON.parse(resultLine.slice("LOOM_RESUMPTION_RESULT:".length)) as Record<string, any>
}

function runResumptionProcessFixture(
  projectRoot: string,
  input: Parameters<typeof resumptionProcessEnvironment>[1],
) {
  const fixture = fileURLToPath(new URL("./resumption-process-fixture.ts", import.meta.url))
  const child = spawnSync(process.execPath, ["test", fixture], {
    cwd: projectRoot,
    env: resumptionProcessEnvironment(projectRoot, input),
    encoding: "utf8",
  })
  if (child.error) throw child.error
  if (child.status !== 0) {
    throw new Error(`Independent Loom process fixture failed (${child.status}): ${child.stderr}`)
  }
  const resultLine = child.stdout.split("\n").find((line) => line.startsWith("LOOM_RESUMPTION_RESULT:"))
  if (!resultLine) throw new Error(`Independent Loom process fixture omitted its result: ${child.stdout}`)
  return JSON.parse(resultLine.slice("LOOM_RESUMPTION_RESULT:".length)) as Record<string, any>
}

function runtimeLockPathForTest(runtime: LoomRuntimeIdentity, aggregate: string, resourceIdentity: string) {
  const hash = createHash("sha256").update(resourceIdentity).digest("hex")
  return join(
    runtime.runtimeRoot,
    "locks",
    runtime.installationId,
    runtime.projectId,
    aggregate,
    `${hash}.lock`,
  )
}

async function holdRuntimeLockForTest(runtime: LoomRuntimeIdentity, aggregate: string, resourceIdentity: string) {
  const lockPath = runtimeLockPathForTest(runtime, aggregate, resourceIdentity)
  await mkdir(dirname(lockPath), { recursive: true, mode: 0o700 })
  const proc = spawn("flock", ["-x", lockPath, "sh", "-c", "printf 'held\\n'; cat >/dev/null"], {
    stdio: ["pipe", "pipe", "pipe"],
  })
  let output = ""
  await new Promise<void>((resolve, reject) => {
    proc.stdout!.setEncoding("utf8")
    proc.stdout!.on("data", (chunk: string) => {
      output += chunk
      if (output.includes("held\n")) resolve()
    })
    proc.once("error", reject)
    proc.stderr!.on("data", (chunk) => reject(new Error(String(chunk))))
  })
  return { lockPath, proc }
}

async function acquireTestFlock(lockPath: string) {
  await mkdir(dirname(lockPath), { recursive: true, mode: 0o700 })
  const proc = spawn("flock", ["-x", lockPath, "sh", "-c", "printf 'locked\\n'; cat >/dev/null"], {
    stdio: ["pipe", "pipe", "pipe"],
  })
  let output = ""
  const ready = new Promise<void>((resolve, reject) => {
    proc.stdout!.setEncoding("utf8")
    proc.stdout!.on("data", (chunk: string) => {
      output += chunk
      if (output.includes("locked\n")) resolve()
    })
    proc.once("error", reject)
    proc.stderr!.on("data", (chunk) => reject(new Error(String(chunk))))
  })
  await ready
  return proc
}

async function waitForFlockUsers(lockPath: string, minimum: number) {
  const countWaiters = async (parentPid: number, visited = new Set<number>()): Promise<number> => {
    if (visited.has(parentPid)) return 0
    visited.add(parentPid)
    const childrenPath = `/proc/${parentPid}/task/${parentPid}/children`
    const childIds = (await readFile(childrenPath, "utf8").catch(() => ""))
      .trim().split(/\s+/).filter(Boolean).map(Number)
    let count = 0
    for (const childPid of childIds) {
      const command = await readFile(`/proc/${childPid}/cmdline`, "utf8").catch(() => "")
      if ((command.startsWith("flock\0") || command.includes("/flock\0")) && command.includes(lockPath)) count++
      count += await countWaiters(childPid, visited)
    }
    return count
  }
  for (let attempt = 0; attempt < 2_000; attempt++) {
    const count = await countWaiters(process.pid)
    if (count >= minimum) return
    await Bun.sleep(5)
  }
  throw new Error(`Did not observe ${minimum} independent flock processes for ${lockPath}.`)
}

async function waitForRuntimeLockUsers(
  runtime: LoomRuntimeIdentity,
  aggregate: string,
  resourceIdentity: string,
  minimum: number,
) {
  return waitForFlockUsers(runtimeLockPathForTest(runtime, aggregate, resourceIdentity), minimum)
}

afterEach(async () => {
  while (roots.length) await rm(roots.pop()!, { recursive: true, force: true })
})

describe("Loom registered plugin boundary", () => {
  test("attests only live setup metadata and the exact effective roster registration", async () => {
    let rosterCalls = 0
    const h = await harness(undefined, undefined, undefined, undefined, (input) => {
      rosterCalls++
      return { location: { directory: input?.location?.directory ?? "" }, data: [] }
    })
    try {
      expect(h.registered.has("loom_attestation")).toBe(true)
      expect(rosterCalls).toBe(0)
      const first = await h.call("attestation", {}, "general", "attestation-general")
      const second = await h.call("attestation", {}, "planner", "attestation-planner")
      expect(rosterCalls).toBe(0)
      expect(Object.keys(first)).toEqual(["provenance"])
      expect(first.provenance).toEqual({
        worktree: h.runtime.canonicalLocation,
        entrypoint: expect.stringMatching(/^file:/),
        buildFingerprint: expect.stringMatching(/^[a-f0-9]{64}$/),
        setupInstance: expect.stringMatching(/^[0-9a-f-]{36}$/),
        rosterRegistration: { id: "loom_roster", present: true },
      })
      expect(second.provenance.setupInstance).toBe(first.provenance.setupInstance)
      expect(Object.keys(first.provenance)).toEqual([
        "worktree", "entrypoint", "buildFingerprint", "setupInstance", "rosterRegistration",
      ])
      await expect(h.call("attestation", {}, "worker", "attestation-worker")).rejects.toThrow(/General and Planner/)

      h.registered.set("loom_roster", {
        ...h.registered.get("loom_roster")!,
        execute: async () => ({ content: "overridden" }),
      })
      await expect(h.call("attestation", {}, "general", "attestation-overridden")).rejects.toThrow(/unknown or was overridden/)
      expect(rosterCalls).toBe(0)
    } finally {
      h.restore()
    }
  })

  test("exposes a live, bounded host roster only to General and Planner", async () => {
    let roster: Array<{ name: string; description?: string; mode?: string; model?: string }> = [
      { name: "general", description: "Primary coordinator", mode: "primary", model: "secret-model" },
      { name: "planner", description: "Plans bounded work", mode: "subagent" },
    ];
    let calls = 0;
    let responseDirectoryOverride: string | undefined;
    const requestedLocations: string[] = [];
    const h = await harness(undefined, undefined, undefined, undefined, (input) => {
      calls += 1;
      const directory = input?.location?.directory ?? "";
      requestedLocations.push(directory);
      return { location: { directory: responseDirectoryOverride ?? directory }, data: roster };
    });
    try {
      expect(h.registered.has("loom_roster")).toBe(true);
      const first = await h.call("roster", {}, "general", "roster-general");
      expect(first).toMatchObject({
        agents: [
          { name: "general", description: "Primary coordinator" },
          { name: "planner", description: "Plans bounded work" },
        ],
        provenance: {
          plugin: "loom",
          worktree: h.runtime.canonicalLocation,
          entrypoint: expect.any(String),
          build: expect.stringMatching(/^[a-f0-9]{64}$/),
        },
      });
      expect(first.agents).toEqual([
        { name: "general", description: "Primary coordinator" },
        { name: "planner", description: "Plans bounded work" },
      ]);
      expect(Object.keys(first).sort()).toEqual(["agents", "provenance", "truncated"]);
      expect(JSON.stringify(first)).not.toContain("secret-model");
      expect(calls).toBe(1);
      expect(requestedLocations).toEqual([h.runtime.canonicalLocation]);

      roster = [{ name: "general", description: "Updated live description" }];
      const second = await h.call("roster", {}, "planner", "roster-planner");
      expect(second.agents).toEqual([{ name: "general", description: "Updated live description" }]);
      expect(calls).toBe(2);

      roster = Array.from({ length: 205 }, (_, index) => ({
        name: `${index}-${"n".repeat(200)}`,
        description: "d".repeat(2_100),
      }));
      const bounded = await h.call("roster", {}, "planner", "roster-bounded");
      expect(bounded.agents).toHaveLength(200);
      expect(bounded.truncated).toBe(true);
      expect(bounded.agents[0].name).toHaveLength(128);
      expect(bounded.agents[0].description).toHaveLength(2_000);

      responseDirectoryOverride = "/different-worktree";
      await expect(h.call("roster", {}, "planner", "roster-wrong-worktree")).rejects.toThrow(/different worktree/);
      expect(calls).toBe(4);
      await expect(h.call("roster", {}, "worker", "roster-worker")).rejects.toThrow(/General and Planner/);
      expect(calls).toBe(4);
    } finally {
      h.restore();
    }
  });

  test("registers equivalent Code Mode mirrors without removing native Loom tools", async () => {
    const { registered, namespaces, restore } = await harness()
    try {
      expect(namespaces.get("loom.code")).toContain("Code Mode mirrors")

      const native = registered.get("loom_start")
      const mirror = registered.get("loom_code_start")
      expect(native).toBeDefined()
      expect(mirror).toBeDefined()
      expect(native?.options).toMatchObject({ namespace: "loom", codemode: false })
      expect(mirror?.options).toMatchObject({
        namespace: "loom.code",
        codemode: true,
        permission: "loom_start",
      })
      expect(mirror?.execute).toBe(native?.execute)

      const nativeStatus = registered.get("loom_status")
      const mirrorStatus = registered.get("loom_code_status")
      expect(nativeStatus).toBeDefined()
      expect(mirrorStatus).toBeDefined()
      expect(mirrorStatus?.execute).toBe(nativeStatus?.execute)
      expect(mirrorStatus?.options?.permission).toBe("loom_status")
    } finally {
      restore()
    }
  })

  test("status derives dispatch, attachment, OQ, and completion readiness without conflating them", async () => {
    const h = await harness()
    try {
      const workflowId = "status-readiness-derived"
      const general = "status-readiness-general"
      const child = "status-readiness-worker"
      const now = new Date().toISOString()

      await h.durableStorage.set(`workflow/${workflowId}`, {
        id: workflowId,
        projectId: h.runtime.projectId,
        revision: 0,
        anchor: `task:${workflowId}`,
        createdBySession: general,
        createdAt: now,
        steps: [
          { id: "worker-open", agent: "worker", kind: "work", dependsOn: [], status: "pending", attempt: 0 },
          { id: "reviewer-budget", agent: "reviewer", kind: "gate", dependsOn: [], status: "pending", attempt: 0 },
          { id: "later", agent: "worker", kind: "work", dependsOn: ["worker-open"], status: "pending", attempt: 0 },
        ],
      })
      await h.durableStorage.set(`session/${general}`, workflowId)
      await h.durableStorage.set(`session/${child}`, workflowId)
      await h.durableStorage.set(`session-step/${child}`, "worker-open")
      await h.durableStorage.set(`session-step-attempt/${encodeURIComponent(child)}`, 0)
      await h.durableStorage.set(
        `step-session/${encodeURIComponent(workflowId)}/${encodeURIComponent("worker-open")}/0`,
        {
          schemaVersion: 1,
          workflowId,
          stepId: "worker-open",
          attempt: 0,
          sessionID: child,
          agent: "worker",
          attachedAt: now,
        },
      )
      await h.durableStorage.set(`limits/${workflowId}`, {
        maxTotalDispatches: 20,
        maxDispatchesPerStep: 3,
        maxReviewerDispatchesPerStep: 1,
        maxCriticDispatchesPerStep: 2,
        maxExtraDispatchesPerStep: 3,
        maxProviderRetries: 2,
      })
      await h.durableStorage.set(`budget/${workflowId}`, {
        totalDispatches: 1,
        byKey: { "step:reviewer-budget": 1 },
        seenDispatches: ["reviewer-budget-seed"],
      })
      await h.durableStorage.set("dispatch-grant/stale-worker-grant", {
        schemaVersion: 1,
        grantId: "stale-worker-grant",
        projectId: h.runtime.projectId,
        workflowId,
        stepId: "stale-worker",
        expectedAgent: "worker",
        issuingParentSessionId: general,
        createdAt: now,
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
      })
      await h.durableStorage.set(`oq-index/${workflowId}`, ["OQ-17"])
      await h.durableStorage.set(`oq/${workflowId}/OQ-17`, {
        id: "OQ-17",
        workflowId,
        question: "Which runtime observation contract is supported?",
        raisedByAgent: "worker",
        raisedByStepId: "worker-open",
        requiredAuthority: "user",
        blocking: true,
        consumerStepIds: ["worker-open"],
        evidence: [],
        status: "open",
        reconciliations: {},
        createdAt: now,
      })

      const status = await h.call("status", { workflowId }, "general", general)

      expect(status.readiness).toHaveLength(2)
      expect(status.readiness.find((step: any) => step.step === "worker-open")).toMatchObject({
        structurallyRunnable: true,
        dispatch: { state: "ready" },
        execution: { state: "unknown", evidence: "current_attachment" },
        completion: {
          eligible: false,
          constraints: [{
            source: "OQ-17",
            boundary: "completion",
            state: "awaiting_answer",
          }],
        },
      })
      expect(status.readiness.find((step: any) => step.step === "reviewer-budget")).toMatchObject({
        structurallyRunnable: true,
        dispatch: { state: "blocked" },
        execution: { state: "unknown" },
      })
      expect(status.userAttention).toEqual([{
        questionId: "OQ-17",
        question: "Which runtime observation contract is supported?",
        responder: "user",
        blocking: true,
        consumers: ["worker-open"],
        state: "awaiting_answer",
      }])
      expect(status.upcoming).toContainEqual({
        step: "later",
        agent: "worker",
        waitsFor: ["worker-open"],
      })

      const detailed = await h.call("status", { workflowId, detail: true }, "general", general)
      expect(detailed.dagRunnable).toEqual([
        { id: "worker-open", agent: "worker" },
        { id: "reviewer-budget", agent: "reviewer" },
      ])
      expect(detailed.runnable).toBeUndefined()

      await h.durableStorage.set(`oq-index/${workflowId}`, ["OQ-17", "OQ-18"])
      await h.durableStorage.set(`oq/${workflowId}/OQ-18`, {
        id: "OQ-18",
        workflowId,
        question: "Worker-owned peer question",
        raisedByAgent: "reviewer",
        raisedByStepId: "reviewer-budget",
        requiredAuthority: "worker",
        blocking: false,
        consumerStepIds: [],
        evidence: [],
        status: "open",
        reconciliations: {},
        createdAt: now,
      })

      const ambiguous = await h.call("status", { workflowId }, "general", general)
      expect(ambiguous.readiness.find((step: any) => step.step === "worker-open")?.dispatch).toMatchObject({
        state: "unknown",
      })
      expect(
        ambiguous.readiness.find((step: any) => step.step === "worker-open")?.dispatch.reason,
      ).toContain("Multiple current targets are owned by worker")
    } finally {
      h.restore()
    }
  })

  test("registers native and Code Mode coordinator resumption executors", async () => {
    const { registered, restore } = await harness()
    try {
      const native = registered.get("loom_resume")
      const mirror = registered.get("loom_code_resume")
      expect(native).toBeDefined()
      expect(mirror).toBeDefined()
      expect(native?.options).toMatchObject({ namespace: "loom", codemode: false })
      expect(mirror?.options).toMatchObject({ namespace: "loom.code", codemode: true })
      expect(mirror?.execute).toBe(native?.execute)
    } finally {
      restore()
    }
  })

  test("restores only the same General's binding and preserves admitted child authority", async () => {
    let announceQueued!: () => void
    const queuedContinuation = new Promise<void>((resolve) => { announceQueued = resolve })
    const h = await harness(undefined, undefined, undefined, () => {
      announceQueued()
    })
    const general = "resume-general"
    const child = "resume-child"
    const sourceId = "resume-source"
    const targetId = "resume-target"
    let workflowLockProcess: ReturnType<typeof spawn> | undefined
    const createdAt = new Date().toISOString()
    const source = {
      id: sourceId,
      projectId: h.runtime.projectId,
      revision: 0,
      anchor: "task:resume-source",
      createdBySession: general,
      createdAt,
      steps: [
        { id: "worker-work", agent: "worker", kind: "work", dependsOn: [], status: "pending", attempt: 0 },
        { id: "approval", agent: "reviewer", kind: "gate", dependsOn: ["worker-work"], status: "pending", attempt: 0 },
      ],
      verification: [],
    }
    const target = {
      id: targetId,
      projectId: h.runtime.projectId,
      revision: 7,
      anchor: "task:resume-target",
      createdBySession: general,
      createdAt,
      work: {
        objectiveId: "objective:task:resume-target",
        generation: 2,
        taskPlanRevision: 6,
        reviewedPlanRevision: 5,
        taskPlanFingerprint: "accepted-task-plan",
        reviewedPlanFingerprint: "reviewed-holistic-plan",
      },
      steps: [
        { id: "historic", agent: "worker", kind: "work", dependsOn: [], status: "complete", attempt: 1, summary: "Prior result" },
        { id: "pending", agent: "worker", kind: "work", dependsOn: [], status: "pending", attempt: 2 },
        { id: "independent-gate", agent: "reviewer", kind: "gate", dependsOn: ["historic"], status: "failed", attempt: 1, summary: "Keep failed gate" },
      ],
      verification: [{
        id: "independent-requirement",
        createdByStepId: "historic",
        createdByAgent: "worker",
        beforeStepId: "independent-gate",
        kind: "other",
        statement: "Remain open in the blocked target.",
        status: "open",
        createdAt,
      }],
    }
    const targetWork = {
      objectiveId: "objective:task:resume-target",
      anchor: target.anchor,
      title: "Resume target",
      objectiveStatus: "active",
      version: 9,
      generation: 2,
      workflowIds: [targetId],
      nodes: [
        { id: "historic-node", logicalId: "historic", type: "task", title: "Prior result", status: "complete", generation: 2, result: { workflowId: targetId, summary: "Retained task receipt", evidenceClaimIds: ["historic-claim"], completedAt: createdAt }, createdAt, updatedAt: createdAt },
        { id: "task-node", logicalId: "task", type: "task", title: "Task", status: "pending", generation: 2, createdAt, updatedAt: createdAt },
      ],
      plans: [{
        generation: 2,
        revision: 6,
        goal: "Preserve this accepted Plan",
        assumptions: ["assumption"],
        outOfScope: ["out of scope"],
        authorityRefs: ["anchor"],
        obligations: [],
        riskBoundaries: [],
        acceptanceCoverage: [],
        relationships: [],
        correctionRouting: [],
        phases: [],
      }],
      createdAt,
      updatedAt: createdAt,
    }
    const historicalEvidence = {
      id: "child-evidence",
      sessionID: child,
      agent: "worker",
      tool: "loom_stats",
      status: "completed",
      observedAt: createdAt,
      workflowId: targetId,
      stepId: "pending",
      resultDigest: "observed-result-digest",
      admission: {
        at: createdAt,
        workflowId: targetId,
        stepId: "pending",
        attachmentId: "child-attachment",
        agent: "worker",
        attempt: 2,
      },
    }
    const historicalClaim = {
      id: "historic-claim",
      workflowId: targetId,
      stepId: "pending",
      kind: "test",
      statement: "Retain prior evidence attribution",
      observationIds: [historicalEvidence.id],
      createdAt,
    }
    try {
      await h.durableStorage.set(`workflow/${sourceId}`, source)
      await h.durableStorage.set(`workflow/${targetId}`, target)
      await h.durableStorage.set(`work/${encodeURIComponent(targetWork.objectiveId)}`, targetWork)
      await h.durableStorage.set(`evidence/${historicalEvidence.id}`, historicalEvidence)
      await h.durableStorage.set(`evidence-session/${child}/${historicalEvidence.id}`, historicalEvidence.id)
      await h.durableStorage.set(`evidence-step/${targetId}/pending/${historicalEvidence.id}`, historicalEvidence.id)
      await h.durableStorage.set(`evidence-claim/${targetId}/pending/${historicalClaim.id}`, historicalClaim)
      await h.durableStorage.set(`session/${general}`, sourceId)
      await h.durableStorage.set(`session-attachment/${general}`, "source-attachment")
      await h.durableStorage.set(`session-step/${general}`, "stale-selector")
      await h.durableStorage.set(`session-step-attempt/${encodeURIComponent(general)}`, 0)
      await h.durableStorage.set(`session-oq/${general}`, "old-question")
      await h.durableStorage.set(`session-plan-review/${encodeURIComponent(general)}`, { workflowId: sourceId, generation: 3 })

      const sourceWorker = "resume-source-worker"
      const sourceReviewer = "resume-source-reviewer"
      await h.durableStorage.set(`session/${sourceWorker}`, sourceId)
      await h.durableStorage.set(`session-attachment/${sourceWorker}`, "source-worker-attachment")
      await h.durableStorage.set(`session-step/${sourceWorker}`, "worker-work")
      await h.durableStorage.set(`session-step-attempt/${encodeURIComponent(sourceWorker)}`, 0)
      const required = await h.call("verification", {
        action: "require",
        workflowId: sourceId,
        beforeStepId: "approval",
        kind: "other",
        statement: "Require observed proof before source completion.",
      }, "worker", sourceWorker)
      expect(required.error).toBeUndefined()
      const sourceObservation = await h.callObserved("stats", { paths: ["src"] },
        "worker", sourceWorker, "source-proof-observation")
      expect(sourceObservation.error).toBeUndefined()
      const sourceObservationLinks = await h.durableStorage.scan({
        prefix: `evidence-session/${sourceWorker}/`,
      })
      expect(sourceObservationLinks.entries).toHaveLength(1)
      const sourceObservationId = sourceObservationLinks.entries[0]?.value as string
      const proven = await h.call("verification", {
        action: "prove",
        workflowId: sourceId,
        requirementId: required.requirement.id,
        statement: "Proof was observed through the attached source Worker path.",
        observationIds: [sourceObservationId],
      }, "worker", sourceWorker)
      expect(proven.error).toBeUndefined()
      expect((await h.call("complete", {
        workflowId: sourceId,
        stepId: "worker-work",
        summary: "Source work completed with observed proof.",
      }, "worker", sourceWorker)).error).toBeUndefined()
      const reviewGrant = await h.call("dispatch_grant", {
        workflowId: sourceId,
        stepId: "approval",
      }, "general", general)
      expect(reviewGrant.error).toBeUndefined()
      expect((await h.call("attach", {
        grantId: reviewGrant.grantId,
        workflowId: sourceId,
        stepId: "approval",
      }, "reviewer", sourceReviewer)).error).toBeUndefined()
      expect((await h.call("complete", {
        workflowId: sourceId,
        stepId: "approval",
        summary: "Independent source gate passed after proof.",
        outcome: "pass",
      }, "reviewer", sourceReviewer)).error).toBeUndefined()
      const completedSource = await h.durableStorage.get(`workflow/${sourceId}`) as any
      expect(completedSource.steps).toMatchObject([
        { id: "worker-work", status: "complete" },
        { id: "approval", status: "passed" },
      ])
      expect(completedSource.verification).toMatchObject([
        { id: required.requirement.id, status: "satisfied", proof: { observationIds: [sourceObservationId] } },
      ])

      await h.durableStorage.set(`session/${child}`, targetId)
      await h.durableStorage.set(`session-attachment/${child}`, "child-attachment")
      await h.durableStorage.set(`session-step/${child}`, "pending")
      await h.durableStorage.set(`session-step-attempt/${encodeURIComponent(child)}`, 2)
      await h.durableStorage.set(`session-oq/${child}`, "target-question")
      await h.durableStorage.set(`step-session/${encodeURIComponent(targetId)}/pending/2`, {
        schemaVersion: 1,
        workflowId: targetId,
        stepId: "pending",
        attempt: 2,
        sessionID: child,
        agent: "worker",
        attachedAt: createdAt,
      })
      await h.durableStorage.set(`oq-index/${targetId}`, ["target-question"])
      await h.durableStorage.set(`oq/${targetId}/target-question`, {
        id: "target-question",
        workflowId: targetId,
        question: "Keep this admitted child continuation intact.",
        raisedByAgent: "general",
        raisedByStepId: "general",
        requiredAuthority: "worker",
        blocking: true,
        consumerStepIds: ["pending"],
        evidence: [],
        status: "open",
        reconciliations: {},
        createdAt,
      })
      const admittedGrant = {
        schemaVersion: 1,
        grantId: "admitted-target-grant",
        projectId: h.runtime.projectId,
        workflowId: targetId,
        stepId: "pending",
        expectedAgent: "worker",
        issuingParentSessionId: general,
        createdAt,
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
        admittedAt: createdAt,
        admittedDispatchId: "already-admitted",
      }
      await h.durableStorage.set(`dispatch-grant/${admittedGrant.grantId}`, admittedGrant)
      const retainedHistoricalGrants = [
        { grantId: "expired-target-grant", expiresAt: new Date(Date.now() - 1000).toISOString() },
        { grantId: "revoked-target-grant", expiresAt: new Date(Date.now() + 60_000).toISOString(), revokedAt: createdAt },
        { grantId: "consumed-target-grant", expiresAt: new Date(Date.now() + 60_000).toISOString(), consumedAt: createdAt, consumingSessionId: child },
      ].map((grant) => ({
        schemaVersion: 1,
        projectId: h.runtime.projectId,
        workflowId: targetId,
        stepId: "pending",
        expectedAgent: "worker",
        issuingParentSessionId: general,
        createdAt,
        ...grant,
      }))
      for (const grant of retainedHistoricalGrants) {
        await h.durableStorage.set(`dispatch-grant/${grant.grantId}`, grant)
      }
      const exhaustedBudget = {
        totalDispatches: 1,
        byKey: { pending: 1 },
        seenDispatches: ["prior"],
        grants: [],
      }
      const exhaustedLimits = {
        maxTotalDispatches: 1,
        maxDispatchesPerStep: 1,
        maxReviewerDispatchesPerStep: 1,
        maxCriticDispatchesPerStep: 1,
        maxExtraDispatchesPerStep: 1,
        maxProviderRetries: 0,
      }
      await h.durableStorage.set(`budget/${targetId}`, exhaustedBudget)
      await h.durableStorage.set(`limits/${targetId}`, exhaustedLimits)

      const beforeTarget = await h.durableStorage.get(`workflow/${targetId}`)
      const beforeWork = await h.durableStorage.get(`work/${encodeURIComponent(targetWork.objectiveId)}`)
      const beforeOq = await h.durableStorage.get(`oq/${targetId}/target-question`)
      const beforeEvidence = await h.durableStorage.get(`evidence/${historicalEvidence.id}`)
      const beforeEvidenceLink = await h.durableStorage.get(`evidence-session/${child}/${historicalEvidence.id}`)
      const beforeStepEvidence = await h.durableStorage.get(`evidence-step/${targetId}/pending/${historicalEvidence.id}`)
      const beforeClaim = await h.durableStorage.get(`evidence-claim/${targetId}/pending/${historicalClaim.id}`)
      const beforeGrant = await h.durableStorage.get(`dispatch-grant/${admittedGrant.grantId}`)
      const beforeHistoricalGrants = await Promise.all(retainedHistoricalGrants.map((grant) =>
        h.durableStorage.get(`dispatch-grant/${grant.grantId}`),
      ))
      const workflowLockHash = createHash("sha256").update(targetId).digest("hex")
      const workflowLockPath = join(
        h.runtime.runtimeRoot,
        "locks",
        h.runtime.installationId,
        h.runtime.projectId,
        "workflow",
        `${workflowLockHash}.lock`,
      )
      await mkdir(dirname(workflowLockPath), { recursive: true, mode: 0o700 })
      workflowLockProcess = spawn("flock", ["-x", workflowLockPath, "sh", "-c", "printf 'locked\\n'; cat >/dev/null"], {
        stdio: ["pipe", "pipe", "pipe"],
      })
      let workflowLockOutput = ""
      const workflowLockReady = new Promise<void>((resolve, reject) => {
        workflowLockProcess!.stdout!.setEncoding("utf8")
        workflowLockProcess!.stdout!.on("data", (chunk: string) => {
          workflowLockOutput += chunk
          if (workflowLockOutput.includes("locked\n")) resolve()
        })
        workflowLockProcess!.once("error", reject)
        workflowLockProcess!.stderr!.on("data", (chunk) => reject(new Error(String(chunk))))
      })
      await workflowLockReady

      const answering = h.call("oq_answer", {
        workflowId: targetId,
        questionId: "target-question",
        answer: "The admitted child is still authoritative.",
        source: "agent",
      }, "worker", child)
      const resuming = h.call("code_resume", {
        workflowId: targetId,
        fromWorkflowId: sourceId,
      }, "general", general)
      const waitForCoordinatorLease = async (sessionID: string) => {
        for (let attempt = 0; attempt < 100; attempt++) {
          const probe = await tryAcquireRuntimeLocks(h.runtime, [{
            aggregate: "session-coordinator",
            resourceIdentity: sessionID,
          }])
          if ("busyResource" in probe) return
          await probe.release()
          await Bun.sleep(10)
        }
        throw new Error(`Invocation did not acquire coordinator admission for ${sessionID}.`)
      }
      await Promise.all([waitForCoordinatorLease(general), waitForCoordinatorLease(child)])
      workflowLockProcess.stdin!.end()
      await once(workflowLockProcess, "exit")
      const result = await resuming
      await queuedContinuation

      expect(result).toMatchObject({
        status: "resumed",
        workflowId: targetId,
        fromWorkflowId: sourceId,
        changedOnlyCoordinatorAccess: true,
        workDispatched: false,
      })
      expect(await h.durableStorage.get(`session/${general}`)).toBe(targetId)
      expect(await h.durableStorage.get(`session-attachment/${general}`)).not.toBe("source-attachment")
      expect(await h.durableStorage.get(`session-step/${general}`)).toBe("")
      expect(await h.durableStorage.get(`session-step-attempt/${encodeURIComponent(general)}`)).toBeNull()
      expect(await h.durableStorage.get(`session-oq/${general}`)).toBe("")
      expect(await h.durableStorage.get(`session-plan-review/${encodeURIComponent(general)}`)).toBeNull()
      expect(await h.durableStorage.get(`workflow/${targetId}`)).toEqual({
        ...beforeTarget as Record<string, unknown>,
        revision: (beforeTarget as { revision: number }).revision + 1,
      })
      expect(await h.durableStorage.get(`work/${encodeURIComponent(targetWork.objectiveId)}`)).toEqual(beforeWork)
      expect(await h.durableStorage.get(`oq/${targetId}/target-question`)).toMatchObject({
        ...beforeOq as Record<string, unknown>,
        status: "answered",
        answer: { by: "worker", text: "The admitted child is still authoritative." },
      })
      expect(await h.durableStorage.get(`evidence/${historicalEvidence.id}`)).toEqual(beforeEvidence)
      expect(await h.durableStorage.get(`evidence-session/${child}/${historicalEvidence.id}`)).toEqual(beforeEvidenceLink)
      expect(await h.durableStorage.get(`evidence-step/${targetId}/pending/${historicalEvidence.id}`)).toEqual(beforeStepEvidence)
      expect(await h.durableStorage.get(`evidence-claim/${targetId}/pending/${historicalClaim.id}`)).toEqual(beforeClaim)
      expect(await h.durableStorage.get(`dispatch-grant/${admittedGrant.grantId}`)).toEqual(beforeGrant)
      expect(await Promise.all(retainedHistoricalGrants.map((grant) =>
        h.durableStorage.get(`dispatch-grant/${grant.grantId}`),
      ))).toEqual(beforeHistoricalGrants)
      expect(await h.durableStorage.get(`workflow/${sourceId}`)).toEqual(completedSource)
      expect(await h.durableStorage.get(`budget/${targetId}`)).toEqual(exhaustedBudget)
      expect(await h.durableStorage.get(`limits/${targetId}`)).toEqual(exhaustedLimits)
      expect(await h.durableStorage.get(`session/${child}`)).toBe(targetId)
      expect(await h.durableStorage.get(`session-attachment/${child}`)).toBe("child-attachment")
      expect(h.syntheticMessages).toHaveLength(1)
      expect(h.syntheticMessages[0]).toMatchObject({
        sessionID: child,
        metadata: { kind: "oq-answered", workflowId: targetId, questionId: "target-question", stepId: "pending", attempt: 2 },
      })
      expect(await h.durableStorage.get(`session-resumption/${encodeURIComponent(general)}`)).toMatchObject({
        coordinatorSessionId: general,
        sourceWorkflowId: sourceId,
        targetWorkflowId: targetId,
      })
      const audit = await h.durableStorage.get(`session-resumption/${encodeURIComponent(general)}`)
      const noOp = await h.call("resume", { workflowId: targetId, fromWorkflowId: targetId }, "general", general)
      expect(noOp).toMatchObject({ status: "already_current", changedOnlyCoordinatorAccess: false })
      expect(await h.durableStorage.get(`session-resumption/${encodeURIComponent(general)}`)).toEqual(audit)
      const childImpersonation = await h.call("resume", {
        workflowId: targetId,
        fromWorkflowId: targetId,
      }, "worker", general)
      expect(childImpersonation.error).toContain("Only general may restore coordinator workflow access")
      const status = await h.call("status", { detail: true }, "general", general)
      expect(status.workflow.id).toBe(targetId)
      expect(status.workflow.steps.find((step: any) => step.id === "historic")).toMatchObject({
        status: "complete",
        summary: "Prior result",
      })
      expect(status.workflow.steps.find((step: any) => step.id === "independent-gate")).toMatchObject({
        status: "failed",
        summary: "Keep failed gate",
      })
      const gateBypass = await h.call("complete", {
        workflowId: targetId,
        stepId: "independent-gate",
        summary: "Attempt to bypass the independent Reviewer gate.",
        outcome: "pass",
      }, "general", general)
      expect(gateBypass.error).toContain("exact attached workflow step")
      expect((await h.call("status", { detail: true }, "general", general)).workflow.steps.find((step: any) =>
        step.id === "independent-gate").status).toBe("failed")

      const staleGrantAttach = await h.call("attach", {
        grantId: "expired-target-grant",
        workflowId: targetId,
        stepId: "pending",
      }, "worker", "resume-expired-child")
      expect(staleGrantAttach.error).toContain("Dispatch grant has expired")
      expect(await h.durableStorage.get("session/resume-expired-child")).toBeUndefined()

      const freshGrant = await h.call("dispatch_grant", {
        workflowId: targetId,
        stepId: "pending",
      }, "general", general)
      expect(freshGrant.error).toBeUndefined()
      const exhaustedDispatch: any = {
        agent: "general",
        action: "subagent",
        resources: ["worker"],
        sessionID: general,
        source: { messageID: "resume-after-exhaustion", id: "resume-exhausted-dispatch" },
        effect: "allow",
        message: "",
      }
      await h.permissionHooks.get("evaluate")!(exhaustedDispatch)
      expect(exhaustedDispatch.effect).toBe("deny")
      expect(exhaustedDispatch.message).toContain("total dispatch limit 1 reached")
      expect(await h.durableStorage.get(`budget/${targetId}`)).toEqual(exhaustedBudget)
      const answered = await answering
      expect(answered.notifications.notified).toContain("pending")
    } finally {
      workflowLockProcess?.stdin?.end()
      if (workflowLockProcess && workflowLockProcess.exitCode === null) await once(workflowLockProcess, "exit")
      h.restore()
    }
  })

  test("continuation scheduling holds recipient workflow authority until send is admitted", async () => {
    let announceSend!: () => void
    let releaseSend!: () => void
    const sendEntered = new Promise<void>((resolve) => { announceSend = resolve })
    const sendBarrier = new Promise<void>((resolve) => { releaseSend = resolve })
    const h = await harness(undefined, undefined, undefined, async () => {
      announceSend()
      await sendBarrier
    })
    const general = "continuation-fence-general"
    const child = "continuation-fence-child"
    const workflowId = "continuation-fence-workflow"
    const stepId = "consumer"
    const questionId = "continuation-fence-question"
    const now = new Date().toISOString()
    try {
      const workflow = {
        id: workflowId,
        projectId: h.runtime.projectId,
        revision: 1,
        anchor: "task:continuation-fence",
        createdBySession: general,
        createdAt: now,
        steps: [{ id: stepId, agent: "worker", kind: "work", dependsOn: [], status: "pending", attempt: 0 }],
      }
      await h.durableStorage.set(`workflow/${workflowId}`, workflow)
      await h.durableStorage.set(`session/${general}`, workflowId)
      await h.durableStorage.set(`session-attachment/${general}`, "general-fence-attachment")
      await h.durableStorage.set(`session/${child}`, workflowId)
      await h.durableStorage.set(`session-attachment/${child}`, "child-fence-attachment")
      await h.durableStorage.set(`session-step/${child}`, stepId)
      await h.durableStorage.set(`session-step-attempt/${encodeURIComponent(child)}`, 0)
      await h.durableStorage.set(`session-oq/${child}`, questionId)
      await h.durableStorage.set(`step-session/${encodeURIComponent(workflowId)}/${stepId}/0`, {
        schemaVersion: 1,
        workflowId,
        stepId,
        attempt: 0,
        sessionID: child,
        agent: "worker",
        attachedAt: now,
      })
      await h.durableStorage.set(`oq-index/${workflowId}`, [questionId])
      await h.durableStorage.set(`oq/${workflowId}/${questionId}`, {
        id: questionId,
        workflowId,
        question: "The recipient must remain current until notification admission.",
        raisedByAgent: "general",
        raisedByStepId: "general",
        requiredAuthority: "worker",
        blocking: true,
        consumerStepIds: [stepId],
        evidence: [],
        status: "open",
        reconciliations: {},
        createdAt: now,
      })

      const answer = h.call("oq_answer", {
        workflowId,
        questionId,
        answer: "The recipient remains authorized through the send boundary.",
        source: "agent",
      }, "worker", child)
      await sendEntered
      const cancellation = startResumptionProcessFixture(h.root, {
        mode: "tool",
        sessionID: general,
        agent: "general",
        toolName: "cancel",
        toolInput: {
          workflowId,
          reason: "Exercise cancellation racing with an already validated continuation send.",
          confirmation: "Cancel this test-owned workflow after its notification is admitted.",
        },
      })
      await waitForRuntimeLockUsers(h.runtime, "workflow", workflowId, 2)
      expect((await h.durableStorage.get(`workflow/${workflowId}`) as any).cancellation).toBeUndefined()

      releaseSend()
      const [answered, cancelled] = await Promise.all([
        answer,
        readResumptionProcessFixture(cancellation),
      ])
      expect(answered.notifications.notified).toContain(stepId)
      expect(cancelled.cancelled).toBe(true)
      expect(h.syntheticMessages).toHaveLength(1)
      expect(h.syntheticMessages[0]).toMatchObject({
        sessionID: child,
        metadata: { workflowId, questionId, stepId, attempt: 0 },
      })
      expect((await h.durableStorage.get(`workflow/${workflowId}`) as any).cancellation).toBeDefined()
    } finally {
      releaseSend()
      h.restore()
    }
  })

  test("reopened consumer attempt is rejected when the answered OQ notification is validated", async () => {
    const h = await harness()
    const general = "continuation-reopen-general"
    const child = "continuation-reopen-child"
    const workflowId = "continuation-reopen-workflow"
    const stepId = "consumer"
    const questionId = "continuation-reopen-question"
    const now = new Date().toISOString()
    try {
      await h.durableStorage.set(`workflow/${workflowId}`, {
        id: workflowId,
        projectId: h.runtime.projectId,
        revision: 1,
        anchor: "task:continuation-reopen",
        createdBySession: general,
        createdAt: now,
        steps: [{ id: stepId, agent: "worker", kind: "work", dependsOn: [], status: "pending", attempt: 0 }],
      })
      await h.durableStorage.set(`session/${general}`, workflowId)
      await h.durableStorage.set(`session-attachment/${general}`, "reopen-general-attachment")
      await h.durableStorage.set(`session/${child}`, workflowId)
      await h.durableStorage.set(`session-attachment/${child}`, "reopen-child-attachment")
      await h.durableStorage.set(`session-step/${child}`, stepId)
      await h.durableStorage.set(`session-step-attempt/${encodeURIComponent(child)}`, 0)
      await h.durableStorage.set(`session-oq/${child}`, questionId)
      await h.durableStorage.set(`step-session/${encodeURIComponent(workflowId)}/${stepId}/0`, {
        schemaVersion: 1,
        workflowId,
        stepId,
        attempt: 0,
        sessionID: child,
        agent: "worker",
        attachedAt: now,
      })
      await h.durableStorage.set(`oq-index/${workflowId}`, [questionId])
      await h.durableStorage.set(`oq/${workflowId}/${questionId}`, {
        id: questionId,
        workflowId,
        question: "The OQ answer belongs to the original step attempt.",
        raisedByAgent: "general",
        raisedByStepId: "general",
        requiredAuthority: "worker",
        blocking: true,
        consumerStepIds: [stepId],
        evidence: [],
        status: "open",
        reconciliations: {},
        createdAt: now,
      })

      const reopened = await h.call("reopen", {
        workflowId,
        stepId,
        reason: "New evidence requires a fresh consumer attempt.",
        newEvidence: true,
        changedHypothesis: true,
        changedStrategy: false,
        reducedUnresolved: false,
      }, "general", general)
      expect(reopened.error).toBeUndefined()
      expect(reopened.reset).toContain(stepId)
      expect((await h.durableStorage.get(`workflow/${workflowId}`) as any).steps[0].attempt).toBe(1)

      const answered = await h.call("oq_answer", {
        workflowId,
        questionId,
        answer: "This answer must not resume the old attempt.",
        source: "agent",
      }, "worker", child)
      expect(answered.error).toBeUndefined()
      expect(answered.notifications).toEqual({ notified: [], failed: [] })
      expect(h.syntheticMessages).toHaveLength(0)
    } finally {
      h.restore()
    }
  })

  test("deleted and rebound OQ recipients are not steered by a delayed old continuation", async () => {
    const h = await harness()
    const general = "continuation-delete-general"
    const child = "continuation-delete-child"
    const oldWorkflow = "continuation-delete-old"
    const newWorkflow = "continuation-delete-new"
    const stepId = "consumer"
    const questionId = "delete-question"
    const now = new Date().toISOString()
    let stepLease: Awaited<ReturnType<typeof holdRuntimeLockForTest>> | undefined
    try {
      await h.durableStorage.set(`workflow/${oldWorkflow}`, {
        id: oldWorkflow,
        projectId: h.runtime.projectId,
        revision: 1,
        anchor: "task:continuation-delete-old",
        createdBySession: general,
        createdAt: now,
        steps: [{ id: stepId, agent: "worker", kind: "work", dependsOn: [], status: "pending", attempt: 0 }],
      })
      await h.durableStorage.set(`workflow/${newWorkflow}`, {
        id: newWorkflow,
        projectId: h.runtime.projectId,
        revision: 1,
        anchor: "task:continuation-delete-new",
        createdBySession: general,
        createdAt: now,
        steps: [{ id: "next", agent: "worker", kind: "work", dependsOn: [], status: "pending", attempt: 0 }],
      })
      await h.durableStorage.set(`session/${general}`, oldWorkflow)
      await h.durableStorage.set(`session-attachment/${general}`, "delete-general-attachment")
      await h.durableStorage.set(`session/${child}`, oldWorkflow)
      await h.durableStorage.set(`session-attachment/${child}`, "delete-child-attachment")
      await h.durableStorage.set(`session-step/${child}`, stepId)
      await h.durableStorage.set(`session-step-attempt/${encodeURIComponent(child)}`, 0)
      await h.durableStorage.set(`session-oq/${child}`, questionId)
      await h.durableStorage.set(`step-session/${encodeURIComponent(oldWorkflow)}/${stepId}/0`, {
        schemaVersion: 1,
        workflowId: oldWorkflow,
        stepId,
        attempt: 0,
        sessionID: child,
        agent: "worker",
        attachedAt: now,
      })
      await h.durableStorage.set(`oq-index/${oldWorkflow}`, [questionId])
      await h.durableStorage.set(`oq/${oldWorkflow}/${questionId}`, {
        id: questionId,
        workflowId: oldWorkflow,
        question: "Do not send a continuation after recipient deletion/rebind.",
        raisedByAgent: "general",
        raisedByStepId: "general",
        requiredAuthority: "worker",
        blocking: true,
        consumerStepIds: [stepId],
        evidence: [],
        status: "open",
        reconciliations: {},
        createdAt: now,
      })
      const rebindGrant = {
        schemaVersion: 1,
        grantId: "continuation-rebind-grant",
        projectId: h.runtime.projectId,
        workflowId: newWorkflow,
        stepId: "next",
        expectedAgent: "worker",
        issuingParentSessionId: general,
        createdAt: now,
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
      }
      await h.durableStorage.set(`dispatch-grant/${rebindGrant.grantId}`, rebindGrant)
      stepLease = await holdRuntimeLockForTest(h.runtime, "step-authority", `${oldWorkflow}:${stepId}`)

      const answering = h.call("oq_answer", {
        workflowId: oldWorkflow,
        questionId,
        answer: "The recipient is being removed before continuation admission.",
        source: "agent",
      }, "worker", child)
      await waitForRuntimeLockUsers(h.runtime, "step-authority", `${oldWorkflow}:${stepId}`, 2)
      expect((await h.durableStorage.get(`oq/${oldWorkflow}/${questionId}`) as any).answer.text)
        .toContain("removed before continuation")

      expect((await h.call("cancel", {
        workflowId: oldWorkflow,
        reason: "Remove the test-owned workflow before its consumer continuation is admitted.",
        confirmation: "Cancel this test-owned workflow after the OQ answer and before notification admission.",
      }, "general", general)).cancelled).toBe(true)
      const deleted = await deleteWorkflowRecords(h.durableStorage as any, h.runtime, {
        workflowIds: [oldWorkflow],
        reason: "Verify cleanup fences a continuation whose recipient has been deleted.",
      })
      expect(deleted.deleted).toContain(oldWorkflow)
      expect(await h.durableStorage.get(`session-deletion-fence/${child}`)).toBeDefined()
      expect(await h.durableStorage.get(`session/${child}`)).toBeUndefined()

      stepLease.proc.stdin!.end()
      await once(stepLease.proc, "exit")
      stepLease = undefined
      const answerResult = await answering
      expect(answerResult.notifications).toEqual({ notified: [], failed: [] })
      expect(h.syntheticMessages).toHaveLength(0)
      expect(runResumptionProcessFixture(h.root, {
        mode: "tool",
        sessionID: child,
        agent: "worker",
        toolName: "attach",
        toolInput: {
        workflowId: newWorkflow,
        stepId: "next",
        grantId: rebindGrant.grantId,
        },
      }).error).toBeUndefined()
      expect(await h.durableStorage.get(`session/${child}`)).toBe(newWorkflow)
    } finally {
      stepLease?.proc.stdin?.end()
      if (stepLease && stepLease.proc.exitCode === null) await once(stepLease.proc, "exit")
      h.restore()
    }
  })

  test("reopened recipient attempts do not receive an old OQ continuation", async () => {
    const h = await harness()
    const general = "continuation-reopen-general"
    const child = "continuation-reopen-child"
    const workflowId = "continuation-reopen-workflow"
    const stepId = "consumer"
    const questionId = "continuation-reopen-question"
    const now = new Date().toISOString()
    try {
      await h.durableStorage.set(`workflow/${workflowId}`, {
        id: workflowId,
        projectId: h.runtime.projectId,
        revision: 1,
        anchor: "task:continuation-reopen",
        createdBySession: general,
        createdAt: now,
        steps: [{ id: stepId, agent: "worker", kind: "work", dependsOn: [], status: "pending", attempt: 0 }],
      })
      await h.durableStorage.set(`session/${general}`, workflowId)
      await h.durableStorage.set(`session-attachment/${general}`, "reopen-general-attachment")
      await h.durableStorage.set(`session/${child}`, workflowId)
      await h.durableStorage.set(`session-attachment/${child}`, "reopen-child-attachment")
      await h.durableStorage.set(`session-step/${child}`, stepId)
      await h.durableStorage.set(`session-step-attempt/${encodeURIComponent(child)}`, 0)
      await h.durableStorage.set(`session-oq/${child}`, questionId)
      await h.durableStorage.set(`step-session/${encodeURIComponent(workflowId)}/${stepId}/0`, {
        schemaVersion: 1,
        workflowId,
        stepId,
        attempt: 0,
        sessionID: child,
        agent: "worker",
        attachedAt: now,
      })
      await h.durableStorage.set(`oq-index/${workflowId}`, [questionId])
      await h.durableStorage.set(`oq/${workflowId}/${questionId}`, {
        id: questionId,
        workflowId,
        question: "The OQ answer belongs to the original step attempt.",
        raisedByAgent: "general",
        raisedByStepId: "general",
        requiredAuthority: "worker",
        blocking: true,
        consumerStepIds: [stepId],
        evidence: [],
        status: "open",
        reconciliations: {},
        createdAt: now,
      })

      const reopened = await h.call("reopen", {
        workflowId,
        stepId,
        reason: "A new hypothesis requires a fresh consumer attempt.",
        newEvidence: true,
        changedHypothesis: true,
        changedStrategy: false,
        reducedUnresolved: false,
      }, "general", general)
      expect(reopened.error).toBeUndefined()
      expect(reopened.reset).toContain(stepId)
      expect((await h.durableStorage.get(`workflow/${workflowId}`) as any).steps[0].attempt).toBe(1)

      const answered = await h.call("oq_answer", {
        workflowId,
        questionId,
        answer: "The previous OQ now has an answer but its consumer attempt changed.",
        source: "agent",
      }, "worker", child)
      expect(answered.error).toBeUndefined()
      expect(answered.notifications).toEqual({ notified: [], failed: [] })
      expect(h.syntheticMessages).toHaveLength(0)
      expect((await h.durableStorage.get(`oq/${workflowId}/${questionId}`) as any).answer.text)
        .toContain("consumer attempt changed")
    } finally {
      h.restore()
    }
  })

  test("denies restoration when any page contains an unadmitted valid source grant", async () => {
    const h = await harness()
    const general = "resume-grant-general"
    const sourceId = "resume-grant-source"
    const targetId = "resume-grant-target"
    const createdAt = new Date().toISOString()
    try {
      await h.durableStorage.set(`workflow/${sourceId}`, {
        id: sourceId,
        projectId: h.runtime.projectId,
        revision: 1,
        anchor: "task:resume-grant-source",
        createdBySession: general,
        createdAt,
        steps: [{ id: "done", agent: "worker", kind: "work", dependsOn: [], status: "complete" }],
      })
      await h.durableStorage.set(`workflow/${targetId}`, {
        id: targetId,
        projectId: h.runtime.projectId,
        revision: 1,
        anchor: "task:resume-grant-target",
        createdBySession: general,
        createdAt,
        steps: [{ id: "pending", agent: "worker", kind: "work", dependsOn: [], status: "pending" }],
      })
      await h.durableStorage.set(`session/${general}`, sourceId)
      for (let index = 0; index < 105; index++) {
        await h.durableStorage.set(`dispatch-grant/unrelated-${String(index).padStart(3, "0")}`, {
          schemaVersion: 1,
          grantId: `unrelated-${String(index).padStart(3, "0")}`,
          projectId: h.runtime.projectId,
          workflowId: `other-${index}`,
          stepId: "step",
          expectedAgent: "worker",
          issuingParentSessionId: "someone-else",
          createdAt,
          expiresAt: new Date(Date.now() + 60_000).toISOString(),
        })
      }
      const unused = {
        schemaVersion: 1,
        grantId: "z-late-unadmitted",
        projectId: h.runtime.projectId,
        workflowId: sourceId,
        stepId: "done",
        expectedAgent: "worker",
        issuingParentSessionId: general,
        createdAt,
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
      }
      await h.durableStorage.set(`dispatch-grant/${unused.grantId}`, unused)

      const result = await h.call("resume", { workflowId: targetId, fromWorkflowId: sourceId }, "general", general)
      expect(result.error).toContain("unadmitted unused dispatch grant")
      expect(await h.durableStorage.get(`session/${general}`)).toBe(sourceId)
      expect(await h.durableStorage.get(`dispatch-grant/${unused.grantId}`)).toEqual(unused)
      expect(await h.durableStorage.get(`workflow/${targetId}`)).toMatchObject({ revision: 1 })
      expect(await h.durableStorage.get(`session-resumption/${encodeURIComponent(general)}`)).toBeUndefined()

      const expiredSourceGrant = { ...unused, expiresAt: new Date(Date.now() - 1000).toISOString() }
      const targetGrant = { ...unused, grantId: "target-unadmitted", workflowId: targetId }
      await h.durableStorage.set(`dispatch-grant/${unused.grantId}`, expiredSourceGrant)
      await h.durableStorage.set(`dispatch-grant/${targetGrant.grantId}`, targetGrant)
      const targetGrantResult = await h.call("resume", {
        workflowId: targetId,
        fromWorkflowId: sourceId,
      }, "general", general)
      expect(targetGrantResult.error).toContain("unadmitted unused dispatch grant")
      expect(await h.durableStorage.get(`session/${general}`)).toBe(sourceId)
      expect(await h.durableStorage.get(`dispatch-grant/${targetGrant.grantId}`)).toEqual(targetGrant)

      const malformed = { ...targetGrant, schemaVersion: 2 }
      await h.durableStorage.set(`dispatch-grant/${targetGrant.grantId}`, malformed)
      const malformedResult = await h.call("resume", {
        workflowId: targetId,
        fromWorkflowId: sourceId,
      }, "general", general)
      expect(malformedResult.error).toContain("Malformed relevant dispatch grant")
      expect(await h.durableStorage.get(`session/${general}`)).toBe(sourceId)
      expect(await h.durableStorage.get(`dispatch-grant/${targetGrant.grantId}`)).toEqual(malformed)
    } finally {
      h.restore()
    }
  })

  test("denies stale, incomplete, cancelled, deleted, foreign, and inconsistent restoration targets", async () => {
    const h = await harness()
    const owner = "resume-denial-owner"
    const createdAt = new Date().toISOString()
    const cases = [
      { name: "stale source", sourceId: "deny-stale-source", targetId: "deny-stale-target", current: "deny-other-source" },
      { name: "source key and id mismatch", sourceId: "deny-source-key-mismatch", targetId: "deny-source-key-target", source: { id: "wrong-source-id" } },
      { name: "target key and id mismatch", sourceId: "deny-target-key-source", targetId: "deny-target-key-mismatch", target: { id: "wrong-target-id" } },
      { name: "missing source record", sourceId: "deny-missing-source", targetId: "deny-missing-source-target", missingSource: true },
      { name: "missing target record", sourceId: "deny-missing-target-source", targetId: "deny-missing-target", missingTarget: true },
      { name: "malformed target steps", sourceId: "deny-malformed-source", targetId: "deny-malformed-target", target: { steps: null } },
      { name: "incomplete source", sourceId: "deny-incomplete-source", targetId: "deny-incomplete-target", sourceStatus: "pending" },
      { name: "cancelled source", sourceId: "deny-cancelled-source", targetId: "deny-cancelled-target", source: { cancellation: { at: createdAt } } },
      {
        name: "open source verification",
        sourceId: "deny-open-proof-source",
        targetId: "deny-open-proof-target",
        source: {
          steps: [
            { id: "done", agent: "worker", kind: "work", dependsOn: [], status: "complete" },
            { id: "gate", agent: "reviewer", kind: "gate", dependsOn: ["done"], status: "passed" },
          ],
          verification: [{ id: "open", createdByStepId: "done", createdByAgent: "worker", beforeStepId: "gate", kind: "other", statement: "Still open", status: "open", createdAt }],
        },
      },
      {
        name: "invalid source proof evidence",
        sourceId: "deny-invalid-proof-source",
        targetId: "deny-invalid-proof-target",
        source: {
          steps: [
            { id: "done", agent: "worker", kind: "work", dependsOn: [], status: "complete" },
            { id: "gate", agent: "reviewer", kind: "gate", dependsOn: ["done"], status: "passed" },
          ],
          verification: [{ id: "invalid-proof", createdByStepId: "done", createdByAgent: "worker", beforeStepId: "gate", kind: "other", statement: "Missing observed proof", status: "satisfied", createdAt, proof: { byAgent: "worker", stepId: "done", statement: "Forged proof", observationIds: ["missing-observation"], provedAt: createdAt } }],
        },
      },
      { name: "unresolved source blocking OQ", sourceId: "deny-unresolved-oq-source", targetId: "deny-unresolved-oq-target", sourceQuestion: true },
      { name: "cancelled target", sourceId: "deny-cancel-source", targetId: "deny-cancel-target", target: { cancellation: { at: createdAt } } },
      { name: "deleted target", sourceId: "deny-deleted-source", targetId: "deny-deleted-target", deleted: true },
      { name: "foreign creator", sourceId: "deny-foreign-source", targetId: "deny-foreign-target", target: { createdBySession: "other-general" } },
      { name: "foreign project", sourceId: "deny-project-source", targetId: "deny-project-target", target: { projectId: "other-project" } },
      { name: "missing creator provenance", sourceId: "deny-provenance-source", targetId: "deny-provenance-target", target: { createdBySession: undefined } },
      { name: "archived target", sourceId: "deny-archive-source", targetId: "deny-archive-target", target: { archived: true } },
      { name: "inconsistent Plan association", sourceId: "deny-plan-source", targetId: "deny-plan-target", target: { work: { objectiveId: "missing-objective", generation: 3 } } },
    ]
    try {
      for (const scenario of cases) {
        const source = {
          id: scenario.sourceId,
          projectId: h.runtime.projectId,
          revision: 1,
          anchor: `task:${scenario.sourceId}`,
          createdBySession: owner,
          createdAt,
          steps: [{ id: "done", agent: "worker", kind: "work", dependsOn: [], status: scenario.sourceStatus ?? "complete" }],
          ...scenario.source,
        }
        const target = {
          id: scenario.targetId,
          projectId: h.runtime.projectId,
          revision: 1,
          anchor: `task:${scenario.targetId}`,
          createdBySession: owner,
          createdAt,
          steps: [{ id: "pending", agent: "worker", kind: "work", dependsOn: [], status: "pending" }],
          ...scenario.target,
        }
        const current = scenario.current ?? scenario.sourceId
        if (!scenario.missingSource) await h.durableStorage.set(`workflow/${scenario.sourceId}`, source)
        if (!scenario.missingTarget) await h.durableStorage.set(`workflow/${scenario.targetId}`, target)
        await h.durableStorage.set(`session/${owner}`, current)
        if (scenario.deleted) {
          await h.durableStorage.set(`workflow-deletion/${scenario.targetId}`, {
            schemaVersion: 1, workflowId: scenario.targetId, projectId: h.runtime.projectId,
          })
        }
        if (scenario.sourceQuestion) {
          await h.durableStorage.set(`oq-index/${scenario.sourceId}`, ["unfinished-source-question"])
          await h.durableStorage.set(`oq/${scenario.sourceId}/unfinished-source-question`, {
            id: "unfinished-source-question",
            workflowId: scenario.sourceId,
            question: "The completed-looking source has an unresolved blocking OQ.",
            raisedByAgent: "general",
            raisedByStepId: "general",
            requiredAuthority: "worker",
            blocking: true,
            consumerStepIds: ["done"],
            evidence: [],
            status: "open",
            reconciliations: {},
            createdAt,
          })
        }
        const beforeTarget = await h.durableStorage.get(`workflow/${scenario.targetId}`)
        const result = await h.call("resume", {
          workflowId: scenario.targetId,
          fromWorkflowId: scenario.sourceId,
        }, "general", owner)
        expect(result.error, scenario.name).toBeDefined()
        expect(await h.durableStorage.get(`session/${owner}`), scenario.name).toBe(current)
        expect(await h.durableStorage.get(`workflow/${scenario.targetId}`), scenario.name).toEqual(beforeTarget)
        expect(await h.durableStorage.get(`session-resumption/${encodeURIComponent(owner)}`), scenario.name).toBeUndefined()
      }
    } finally {
      h.restore()
    }
  })

  test("rejects a captured parent dispatch admission after binding ABA across processes", async () => {
    const h = await harness()
    const session = "resume-aba-session"
    const workflowId = "resume-aba-workflow"
    let lockProcess: ReturnType<typeof spawn> | undefined
    try {
      await h.durableStorage.set(`workflow/${workflowId}`, {
        id: workflowId,
        projectId: h.runtime.projectId,
        revision: 1,
        anchor: "task:resume-aba",
        createdBySession: session,
        createdAt: new Date().toISOString(),
        steps: [{ id: "pending", agent: "worker", kind: "work", dependsOn: [], status: "pending" }],
      })
      await h.durableStorage.set(`session/${session}`, workflowId)
      await h.durableStorage.set(`session-attachment/${session}`, "attachment-before")
      const grant = {
        schemaVersion: 1,
        grantId: "aba-parent-grant",
        projectId: h.runtime.projectId,
        workflowId,
        stepId: "pending",
        expectedAgent: "worker",
        issuingParentSessionId: session,
        createdAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
      }
      await h.durableStorage.set(`dispatch-grant/${grant.grantId}`, grant)
      const lockHash = createHash("sha256").update(session).digest("hex")
      const lockPath = join(
        h.runtime.runtimeRoot,
        "locks",
        h.runtime.installationId,
        h.runtime.projectId,
        "session-coordinator",
        `${lockHash}.lock`,
      )
      await mkdir(dirname(lockPath), { recursive: true, mode: 0o700 })
      lockProcess = spawn("flock", ["-x", lockPath, "sh", "-c", "printf 'locked\\n'; cat >/dev/null"], {
        stdio: ["pipe", "pipe", "pipe"],
      })
      let output = ""
      const lockReady = new Promise<void>((resolve, reject) => {
        lockProcess!.stdout!.setEncoding("utf8")
        lockProcess!.stdout!.on("data", (chunk: string) => {
          output += chunk
          if (output.includes("locked\n")) resolve()
        })
        lockProcess!.once("error", reject)
        lockProcess!.stderr!.on("data", (chunk) => reject(new Error(String(chunk))))
      })
      await lockReady

      const event: any = {
        agent: "general",
        action: "subagent",
        resources: ["worker"],
        sessionID: session,
        source: { messageID: "message-before-rotation", id: "dispatch-before-rotation" },
        effect: "allow",
        message: "",
      }
      const invocation = h.permissionHooks.get("evaluate")!(event)
      await Bun.sleep(50)
      await h.durableStorage.set(`session/${session}`, "temporary-other-workflow")
      await h.durableStorage.set(`session/${session}`, workflowId)
      await h.durableStorage.set(`session-attachment/${session}`, "attachment-after-aba")
      lockProcess.stdin!.end()
      await once(lockProcess, "exit")

      await invocation
      expect(event.effect).toBe("deny")
      expect(event.message).toContain("attachment changed while this Loom invocation waited")
      expect(await h.durableStorage.get(`dispatch-grant/${grant.grantId}`)).toEqual(grant)
      expect(await h.durableStorage.get(`budget/${workflowId}`)).toBeUndefined()
    } finally {
      lockProcess?.stdin?.end()
      if (lockProcess && lockProcess.exitCode === null) await once(lockProcess, "exit")
      h.restore()
    }
  })

  test("independent child completion wins after permission selection and before dispatch commit", async () => {
    const h = await harness()
    const general = "dispatch-race-general"
    const child = "dispatch-race-worker"
    const workflowId = "dispatch-race-workflow"
    const readyFile = join(h.root, "permission-selected")
    const releaseFile = join(h.root, "permission-release")
    let permissionProcess: ReturnType<typeof Bun.spawn> | undefined
    try {
      const createdAt = new Date().toISOString()
      await h.durableStorage.set(`workflow/${workflowId}`, {
        id: workflowId,
        projectId: h.runtime.projectId,
        revision: 1,
        anchor: "task:dispatch-race",
        createdBySession: general,
        createdAt,
        steps: [{ id: "selected", agent: "worker", kind: "work", dependsOn: [], status: "pending", attempt: 0 }],
      })
      await h.durableStorage.set(`session/${general}`, workflowId)
      await h.durableStorage.set(`session-attachment/${general}`, "dispatch-race-general-attachment")
      const childGrant = await h.call("dispatch_grant", { workflowId, stepId: "selected" }, "general", general)
      expect(childGrant.error).toBeUndefined()
      expect((await h.call("attach", {
        grantId: childGrant.grantId,
        workflowId,
        stepId: "selected",
      }, "worker", child)).error).toBeUndefined()
      const parentGrant = await h.call("dispatch_grant", { workflowId, stepId: "selected" }, "general", general)
      expect(parentGrant.error).toBeUndefined()
      const beforeParentGrant = await h.durableStorage.get(`dispatch-grant/${parentGrant.grantId}`)
      const beforeBudget = await h.durableStorage.get(`budget/${workflowId}`)

      permissionProcess = Bun.spawn([
        process.execPath,
        "test",
        fileURLToPath(new URL("./resumption-process-fixture.ts", import.meta.url)),
      ], {
        cwd: h.root,
        env: resumptionProcessEnvironment(h.root, {
          mode: "permission-before-commit",
          sessionID: general,
          agent: "general",
          toolName: "permission",
          workflowId,
          readyFile,
          releaseFile,
          permissionEvent: {
            agent: "general",
            action: "subagent",
            resources: ["worker"],
            sessionID: general,
            source: { messageID: "selected-before-child-complete", id: "dispatch-race" },
            effect: "allow",
            message: "",
          },
        }),
        stdout: "pipe",
        stderr: "pipe",
      })
      const permissionOutput = new Response(permissionProcess.stdout as ReadableStream<Uint8Array>).text()
      const permissionError = new Response(permissionProcess.stderr as ReadableStream<Uint8Array>).text()
      const permissionExit = permissionProcess.exited
      const waitForBarrier = async () => {
        for (let attempt = 0; attempt < 1_000; attempt++) {
          try {
            await readFile(readyFile)
            return
          } catch (error: any) {
            if (error?.code !== "ENOENT") throw error
          }
          await Bun.sleep(5)
        }
        throw new Error("Parent permission process did not reach the selected-before-commit barrier.")
      }
      await waitForBarrier()

      const completed = runResumptionProcessFixture(h.root, {
        mode: "tool",
        sessionID: child,
        agent: "worker",
        toolName: "complete",
        toolInput: { workflowId, stepId: "selected", summary: "Competing child completed first." },
      })
      expect(completed.error).toBeUndefined()
      expect((await h.durableStorage.get(`workflow/${workflowId}`) as any).steps[0].status).toBe("complete")

      await writeFile(releaseFile, "allow permission commit revalidation")
      const [stdout, stderr, exitCode] = await Promise.all([permissionOutput, permissionError, permissionExit])
      expect(exitCode, stderr).toBe(0)
      const resultLine = stdout.split("\n").find((line) => line.startsWith("LOOM_RESUMPTION_RESULT:"))
      expect(resultLine).toBeDefined()
      const permissionResult = JSON.parse(resultLine!.slice("LOOM_RESUMPTION_RESULT:".length))
      expect(permissionResult.effect).toBe("deny")
      expect(permissionResult.message).toContain("Dispatch eligibility changed before admission")
      expect(await h.durableStorage.get(`dispatch-grant/${parentGrant.grantId}`)).toEqual(beforeParentGrant)
      expect(await h.durableStorage.get(`budget/${workflowId}`)).toEqual(beforeBudget)
    } finally {
      if (permissionProcess && permissionProcess.exitCode === null) {
        await writeFile(releaseFile, "cleanup")
        await permissionProcess.exited
      }
      h.restore()
    }
  })

  test("parent permission revalidates a selected step after an independent child completes it", async () => {
    const h = await harness()
    const general = "dispatch-race-general"
    const child = "dispatch-race-worker"
    const workflowId = "dispatch-race-workflow"
    const readyFile = join(h.root, "permission-selected")
    const releaseFile = join(h.root, "permission-release")
    let permissionProcess: ReturnType<typeof Bun.spawn> | undefined
    try {
      const createdAt = new Date().toISOString()
      await h.durableStorage.set(`workflow/${workflowId}`, {
        id: workflowId,
        projectId: h.runtime.projectId,
        revision: 1,
        anchor: "task:dispatch-race",
        createdBySession: general,
        createdAt,
        steps: [{ id: "selected", agent: "worker", kind: "work", dependsOn: [], status: "pending", attempt: 0 }],
      })
      await h.durableStorage.set(`session/${general}`, workflowId)
      await h.durableStorage.set(`session-attachment/${general}`, "dispatch-race-general-attachment")
      const childGrant = await h.call("dispatch_grant", { workflowId, stepId: "selected" }, "general", general)
      expect(childGrant.error).toBeUndefined()
      expect((await h.call("attach", {
        grantId: childGrant.grantId,
        workflowId,
        stepId: "selected",
      }, "worker", child)).error).toBeUndefined()
      const parentGrant = await h.call("dispatch_grant", { workflowId, stepId: "selected" }, "general", general)
      expect(parentGrant.error).toBeUndefined()
      const beforeParentGrant = await h.durableStorage.get(`dispatch-grant/${parentGrant.grantId}`)
      const beforeBudget = await h.durableStorage.get(`budget/${workflowId}`)

      permissionProcess = Bun.spawn([
        process.execPath,
        "test",
        fileURLToPath(new URL("./resumption-process-fixture.ts", import.meta.url)),
      ], {
        cwd: h.root,
        env: resumptionProcessEnvironment(h.root, {
          mode: "permission-before-commit",
          sessionID: general,
          agent: "general",
          toolName: "permission",
          workflowId,
          readyFile,
          releaseFile,
          permissionEvent: {
            agent: "general",
            action: "subagent",
            resources: ["worker"],
            sessionID: general,
            source: { messageID: "selected-before-child-complete", id: "dispatch-race" },
            effect: "allow",
            message: "",
          },
        }),
        stdout: "pipe",
        stderr: "pipe",
      })
      const permissionOutput = new Response(permissionProcess.stdout as ReadableStream<Uint8Array>).text()
      const permissionError = new Response(permissionProcess.stderr as ReadableStream<Uint8Array>).text()
      const exitCode = permissionProcess.exited
      const waitForFile = async (path: string) => {
        for (let attempt = 0; attempt < 1_000; attempt++) {
          try {
            await readFile(path)
            return
          } catch (error: any) {
            if (error?.code !== "ENOENT") throw error
          }
          await Bun.sleep(5)
        }
        throw new Error(`Process permission fixture did not reach its exact selection barrier: ${path}`)
      }
      await waitForFile(readyFile)

      const completed = runResumptionProcessFixture(h.root, {
        mode: "tool",
        sessionID: child,
        agent: "worker",
        toolName: "complete",
        toolInput: { workflowId, stepId: "selected", summary: "Competing child completed first." },
      })
      expect(completed.error).toBeUndefined()
      expect((await h.durableStorage.get(`workflow/${workflowId}`) as any).steps[0].status).toBe("complete")

      await writeFile(releaseFile, "resume admission checks current step")
      const [stdout, stderr, status] = await Promise.all([permissionOutput, permissionError, exitCode])
      expect(status, stderr).toBe(0)
      const resultLine = stdout.split("\n").find((line) => line.startsWith("LOOM_RESUMPTION_RESULT:"))
      expect(resultLine).toBeDefined()
      const permissionResult = JSON.parse(resultLine!.slice("LOOM_RESUMPTION_RESULT:".length))
      expect(permissionResult.effect).toBe("deny")
      expect(permissionResult.message).toContain("Dispatch eligibility changed before admission")
      expect(await h.durableStorage.get(`dispatch-grant/${parentGrant.grantId}`)).toEqual(beforeParentGrant)
      expect(await h.durableStorage.get(`budget/${workflowId}`)).toEqual(beforeBudget)
    } finally {
      if (permissionProcess && permissionProcess.exitCode === null) {
        await writeFile(releaseFile, "cleanup")
        await permissionProcess.exited
      }
      h.restore()
    }
  })

  test("parent Planner-OQ admission revalidates the pinned Plan revision after a concurrent amendment", async () => {
    const h = await harness()
    const general = "planner-oq-race-general"
    const planner = "planner-oq-race-planner"
    const readyFile = join(h.root, "planner-oq-selected")
    const releaseFile = join(h.root, "planner-oq-release")
    let permissionProcess: ReturnType<typeof Bun.spawn> | undefined
    try {
      const start = await h.call("start", { anchor: "docs/anchors/test/anchor.md" }, "general", general)
      const workflowId = String(start.workflowId)
      expect(start.error).toBeUndefined()
      expect((await h.call("route", {
        humanFacing: false,
        behavioral: false,
        structural: false,
        externalUnknown: false,
        diagnostic: false,
        productOutcome: true,
        implementationRequested: true,
        executionDepth: "objective",
        workLevel: "wave",
      }, "general", general)).error).toBeUndefined()
      const criticGrant = await h.call("dispatch_grant", { workflowId, stepId: "critic-solution" }, "general", general)
      const criticSession = "planner-oq-race-critic"
      expect((await h.call("attach", {
        workflowId, stepId: "critic-solution", grantId: criticGrant.grantId,
      }, "critic", criticSession)).error).toBeUndefined()
      expect((await h.call("complete", {
        workflowId, stepId: "critic-solution", outcome: "pass", summary: "Ready to plan",
      }, "critic", criticSession)).error).toBeUndefined()
      const planGrant = await h.call("dispatch_grant", { workflowId, stepId: "plan" }, "general", general)
      expect(planGrant.error).toBeUndefined()
      expect((await h.call("attach", {
        workflowId, stepId: "plan", grantId: planGrant.grantId,
      }, "planner", planner)).error).toBeUndefined()
      const planned = await h.call("work_plan", richWorkPlanInput(workflowId, [{
        id: "core",
        title: "Core",
        waves: [{ id: "first", title: "First", tasks: [
          richPlanTask("one", "One", "Retain a precise Plan revision for this Planner OQ."),
        ] }],
      }]), "planner", planner)
      expect(planned.error).toBeUndefined()
      const raised = await h.call("oq_raise", {
        workflowId,
        question: "Reconcile this Planner question against its captured Plan revision.",
        responder: "planner",
        blocking: false,
      }, "general", general)
      expect(raised.error).toBeUndefined()
      const objectiveId = String(planned.objectiveId)
      const initialWork = await h.durableStorage.get(`work/${encodeURIComponent(objectiveId)}`) as any
      const initialPlan = initialWork.plans.find((plan: any) => plan.generation === initialWork.generation)
      expect(raised.question.work.revision).toBe(initialPlan.revision)
      const grant = await h.call("dispatch_grant", {
        workflowId,
        questionId: raised.question.id,
      }, "general", general)
      expect(grant.error).toBeUndefined()
      const beforeGrant = await h.durableStorage.get(`dispatch-grant/${grant.grantId}`) as any
      const beforeBudget = await h.durableStorage.get(`budget/${workflowId}`)
      const beforeQuestion = await h.durableStorage.get(`oq/${workflowId}/${raised.question.id}`)

      permissionProcess = spawnResumptionProcessFixture(h.root, {
        mode: "permission-before-commit",
        sessionID: general,
        agent: "general",
        toolName: "permission",
        workflowId,
        readyFile,
        releaseFile,
        permissionEvent: {
          agent: "general",
          action: "subagent",
          resources: ["planner"],
          sessionID: general,
          source: { messageID: "plan-before-amendment", id: "planner-oq-race" },
          effect: "allow",
          message: "",
        },
      })
      const permissionOutput = new Response(permissionProcess.stdout as ReadableStream<Uint8Array>).text()
      const permissionError = new Response(permissionProcess.stderr as ReadableStream<Uint8Array>).text()
      const permissionExit = permissionProcess.exited
      for (let attempt = 0; attempt < 1_000; attempt++) {
        try {
          await readFile(readyFile)
          break
        } catch (error: any) {
          if (error?.code !== "ENOENT") throw error
          if (attempt === 999) throw new Error("Parent Planner-OQ admission did not reach its exact precommit barrier.")
          await Bun.sleep(5)
        }
      }

      const amended = await h.call("work_amend", {
        workflowId,
        expectedVersion: planned.version,
        reason: "Change the Plan after permission selected its older OQ context.",
        operations: [],
        planPatch: { goal: "The selected Planner OQ now references a prior Plan revision." },
      }, "planner", planner)
      expect(amended.error).toBeUndefined()
      expect(amended.revision).toBeGreaterThan(raised.question.work.revision)
      await writeFile(releaseFile, "revalidate the current Planner OQ Plan context")

      const [stdout, stderr, exitCode] = await Promise.all([permissionOutput, permissionError, permissionExit])
      expect(exitCode, stderr).toBe(0)
      const line = stdout.split("\n").find((entry) => entry.startsWith("LOOM_RESUMPTION_RESULT:"))
      expect(line).toBeDefined()
      const permissionResult = JSON.parse(line!.slice("LOOM_RESUMPTION_RESULT:".length))
      expect(permissionResult.effect).toBe("allow")
      const admittedGrant = await h.durableStorage.get(`dispatch-grant/${grant.grantId}`) as any
      expect(admittedGrant.admittedAt).toEqual(expect.any(String))
      expect(admittedGrant.admittedAt).not.toBe(beforeGrant.admittedAt)
      expect(await h.durableStorage.get(`budget/${workflowId}`)).not.toEqual(beforeBudget)
      expect(await h.durableStorage.get(`oq/${workflowId}/${raised.question.id}`)).toEqual(beforeQuestion)
      const historicalResponder = "planner-after-plan-amendment"
      const attachment = await h.call("attach", {
        workflowId,
        questionId: raised.question.id,
        grantId: grant.grantId,
      }, "planner", historicalResponder)
      expect(attachment.attached).toBe(true)
      expect(attachment.planContext).toMatchObject({
        generation: initialWork.generation,
        revision: initialPlan.revision,
      })
      expect((await h.call("oq_answer", {
        workflowId,
        questionId: raised.question.id,
        answer: "Answered from the pinned historical context; it grants no Plan mutation authority.",
        source: "agent",
      }, "planner", historicalResponder)).error).toBeUndefined()
    } finally {
      if (permissionProcess && permissionProcess.exitCode === null) {
        await writeFile(releaseFile, "cleanup")
        await permissionProcess.exited
      }
      h.restore()
    }
  })

  test("parent OQ admission denies after an independently authorized Plan invalidation", async () => {
    const h = await harness()
    const general = "plan-race-general"
    const planner = "plan-race-planner"
    const readyFile = join(h.root, "plan-permission-selected")
    const releaseFile = join(h.root, "plan-permission-release")
    let permissionProcess: ReturnType<typeof Bun.spawn> | undefined
    try {
      const start = await h.call("start", {
        anchor: "docs/anchors/test/anchor.md",
      }, "general", general)
      const workflowId = String(start.workflowId)
      expect(start.error).toBeUndefined()
      expect((await h.call("route", {
        humanFacing: false,
        behavioral: false,
        structural: false,
        externalUnknown: false,
        diagnostic: false,
        productOutcome: true,
        implementationRequested: true,
        executionDepth: "objective",
        workLevel: "wave",
      }, "general", general)).error).toBeUndefined()

      const criticGrant = await h.call("dispatch_grant", { workflowId, stepId: "critic-solution" }, "general", general)
      const criticSession = "plan-race-critic"
      expect((await h.call("attach", {
        workflowId, stepId: "critic-solution", grantId: criticGrant.grantId,
      }, "critic", criticSession)).error).toBeUndefined()
      expect((await h.call("complete", {
        workflowId, stepId: "critic-solution", outcome: "pass", summary: "Ready to plan",
      }, "critic", criticSession)).error).toBeUndefined()

      const plannerGrant = await h.call("dispatch_grant", { workflowId, stepId: "plan" }, "general", general)
      expect(plannerGrant.error).toBeUndefined()
      expect((await h.call("attach", {
        workflowId, stepId: "plan", grantId: plannerGrant.grantId,
      }, "planner", planner)).error).toBeUndefined()
      const planned = await h.call("work_plan", richWorkPlanInput(workflowId, [{
        id: "core",
        title: "Core",
        waves: [{ id: "first", title: "First", tasks: [
          richPlanTask("one", "One", "Retain an executable current Plan for the OQ."),
        ] }],
      }]), "planner", planner)
      expect(planned.error).toBeUndefined()
      const raised = await h.call("oq_raise", {
        workflowId,
        question: "Reconcile this Planner question against its captured Plan revision.",
        responder: "planner",
        blocking: false,
      }, "general", general)
      expect(raised.error).toBeUndefined()
      const questionId = raised.question.id
      const objectiveId = String(planned.objectiveId)
      const invalidationOq = await h.call("oq_raise", {
        workflowId,
        question: "The current Planner must authorize invalidation before replanning.",
        responder: "planner",
        blocking: false,
      }, "general", general)
      expect(invalidationOq.error).toBeUndefined()
      const invalidationGrant = await h.call("dispatch_grant", {
        workflowId,
        questionId: invalidationOq.question.id,
      }, "general", general)
      expect(invalidationGrant.error).toBeUndefined()
      const invalidatorSession = "plan-race-invalidator"
      expect((await h.call("attach", {
        workflowId,
        questionId: invalidationOq.question.id,
        grantId: invalidationGrant.grantId,
      }, "planner", invalidatorSession)).attached).toBe(true)
      const grant = await h.call("dispatch_grant", {
        workflowId, questionId,
      }, "general", general)
      expect(grant.error).toBeUndefined()
      const beforeGrant = await h.durableStorage.get(`dispatch-grant/${grant.grantId}`)
      const beforeBudget = await h.durableStorage.get(`budget/${workflowId}`)
      const beforeQuestion = await h.durableStorage.get(`oq/${workflowId}/${questionId}`)

      permissionProcess = Bun.spawn([
        process.execPath,
        "test",
        fileURLToPath(new URL("./resumption-process-fixture.ts", import.meta.url)),
      ], {
        cwd: h.root,
        env: resumptionProcessEnvironment(h.root, {
          mode: "permission-before-commit",
          sessionID: general,
          agent: "general",
          toolName: "permission",
          workflowId,
          readyFile,
          releaseFile,
          permissionEvent: {
            agent: "general",
            action: "subagent",
            resources: ["planner"],
            sessionID: general,
            source: { messageID: "plan-before-amend", id: "plan-race-dispatch" },
            effect: "allow",
            message: "",
          },
        }),
        stdout: "pipe",
        stderr: "pipe",
      })
      const permissionOutput = new Response(permissionProcess.stdout as ReadableStream<Uint8Array>).text()
      const permissionError = new Response(permissionProcess.stderr as ReadableStream<Uint8Array>).text()
      const permissionExit = permissionProcess.exited
      for (let attempt = 0; attempt < 1_000; attempt++) {
        try {
          await readFile(readyFile)
          break
        } catch (error: any) {
          if (error?.code !== "ENOENT") throw error
          if (attempt === 999) throw new Error("Parent Planner-OQ admission did not reach the precommit barrier.")
          await Bun.sleep(5)
        }
      }

      const invalidated = await h.call("work_invalidate", {
        workflowId,
        questionId: invalidationOq.question.id,
        expectedVersion: planned.version,
        reason: "Invalidate the current Plan while parent admission waits to commit.",
      }, "planner", invalidatorSession)
      expect(invalidated.error).toBeUndefined()
      expect(invalidated.invalidated).toBe(true)
      await writeFile(releaseFile, "revalidate the current Plan invalidation before grant admission")

      const [stdout, stderr, exitCode] = await Promise.all([permissionOutput, permissionError, permissionExit])
      expect(exitCode, stderr).toBe(0)
      const line = stdout.split("\n").find((entry) => entry.startsWith("LOOM_RESUMPTION_RESULT:"))
      expect(line).toBeDefined()
      const permissionResult = JSON.parse(line!.slice("LOOM_RESUMPTION_RESULT:".length))
      expect(permissionResult.effect).toBe("deny")
      expect(permissionResult.message).toContain("selected OQ Plan context is unavailable or invalidated")
      expect(await h.durableStorage.get(`dispatch-grant/${grant.grantId}`)).toEqual(beforeGrant)
      expect(await h.durableStorage.get(`budget/${workflowId}`)).toEqual(beforeBudget)
      expect(await h.durableStorage.get(`oq/${workflowId}/${questionId}`)).toEqual(beforeQuestion)
      const currentWork = await h.durableStorage.get(`work/${encodeURIComponent(objectiveId)}`) as any
      expect(currentWork.plans.find((plan: any) => plan.generation === currentWork.generation).invalidated)
        .toMatchObject({ by: "planner", reason: "Invalidate the current Plan while parent admission waits to commit." })
    } finally {
      if (permissionProcess && permissionProcess.exitCode === null) {
        await writeFile(releaseFile, "cleanup")
        await permissionProcess.exited
      }
      h.restore()
    }
  })

  test("registered resume crash and lost-response boundaries expose only old or new complete tuples", async () => {
    const h = await harness()
    const general = "resume-crash-general"
    const sourceId = "resume-crash-source"
    const targetId = "resume-crash-target"
    const createdAt = new Date().toISOString()
    try {
      const source = {
        id: sourceId,
        projectId: h.runtime.projectId,
        revision: 3,
        anchor: "task:resume-crash-source",
        createdBySession: general,
        createdAt,
        steps: [{ id: "done", agent: "worker", kind: "work", dependsOn: [], status: "complete" }],
      }
      const target = {
        id: targetId,
        projectId: h.runtime.projectId,
        revision: 5,
        anchor: "task:resume-crash-target",
        createdBySession: general,
        createdAt,
        steps: [{ id: "pending", agent: "worker", kind: "work", dependsOn: [], status: "pending", attempt: 3 }],
      }
      await h.durableStorage.set(`workflow/${sourceId}`, source)
      await h.durableStorage.set(`workflow/${targetId}`, target)
      await h.durableStorage.set(`session/${general}`, sourceId)
      await h.durableStorage.set(`session-attachment/${general}`, "before-crash")
      await h.durableStorage.set(`session-step/${general}`, "historic-selector")
      await h.durableStorage.set(`session-step-attempt/${encodeURIComponent(general)}`, 4)
      await h.durableStorage.set(`session-oq/${general}`, "historic-question")
      await h.durableStorage.set(`session-plan-review/${encodeURIComponent(general)}`, { workflowId: sourceId, generation: 9 })
      await h.durableStorage.set(`limits/${targetId}`, { maxTotalDispatches: 8 })
      await h.durableStorage.set(`budget/${targetId}`, { totalDispatches: 6, seenDispatches: ["prior"] })

      const crash = spawnResumptionProcessFixture(h.root, {
        mode: "resume-crash-after-binding-write",
        workflowId: targetId,
        sourceWorkflowId: sourceId,
        targetWorkflowId: targetId,
        sessionID: general,
        agent: "general",
        toolName: "resume",
        toolInput: { workflowId: targetId, fromWorkflowId: sourceId },
      })
      const crashStdout = new Response(crash.stdout).text()
      const crashStderr = new Response(crash.stderr).text()
      const crashExit = await crash.exited
      expect(crashExit, `${await crashStdout}\n${await crashStderr}`).toBe(87)
      expect(await h.durableStorage.get(`session/${general}`)).toBe(sourceId)
      expect(await h.durableStorage.get(`session-attachment/${general}`)).toBe("before-crash")
      expect(await h.durableStorage.get(`session-step/${general}`)).toBe("historic-selector")
      expect(await h.durableStorage.get(`session-step-attempt/${encodeURIComponent(general)}`)).toBe(4)
      expect(await h.durableStorage.get(`session-oq/${general}`)).toBe("historic-question")
      expect(await h.durableStorage.get(`session-plan-review/${encodeURIComponent(general)}`)).toEqual({ workflowId: sourceId, generation: 9 })
      expect(await h.durableStorage.get(`session-resumption/${encodeURIComponent(general)}`)).toBeUndefined()
      expect(await h.durableStorage.get(`workflow/${sourceId}`)).toEqual(source)
      expect(await h.durableStorage.get(`workflow/${targetId}`)).toEqual(target)
      expect(await h.durableStorage.get(`budget/${targetId}`)).toEqual({ totalDispatches: 6, seenDispatches: ["prior"] })
      expect(await h.durableStorage.get(`limits/${targetId}`)).toEqual({ maxTotalDispatches: 8 })

      const responseLost = spawnResumptionProcessFixture(h.root, {
        mode: "resume-response-loss",
        workflowId: targetId,
        sourceWorkflowId: sourceId,
        targetWorkflowId: targetId,
        sessionID: general,
        agent: "general",
        toolName: "resume",
        surface: "code",
        toolInput: { workflowId: targetId, fromWorkflowId: sourceId },
      })
      const lostStdout = new Response(responseLost.stdout).text()
      const lostStderr = new Response(responseLost.stderr).text()
      const lostExit = await responseLost.exited
      expect(lostExit, `${await lostStdout}\n${await lostStderr}`).toBe(86)
      expect(await h.durableStorage.get(`session/${general}`)).toBe(targetId)
      const committedAttachment = await h.durableStorage.get(`session-attachment/${general}`)
      expect(committedAttachment).not.toBe("before-crash")
      expect(await h.durableStorage.get(`session-step/${general}`)).toBe("")
      expect(await h.durableStorage.get(`session-step-attempt/${encodeURIComponent(general)}`)).toBeNull()
      expect(await h.durableStorage.get(`session-oq/${general}`)).toBe("")
      expect(await h.durableStorage.get(`session-plan-review/${encodeURIComponent(general)}`)).toBeNull()
      const provenance = await h.durableStorage.get(`session-resumption/${encodeURIComponent(general)}`)
      expect(provenance).toMatchObject({
        coordinatorSessionId: general,
        sourceWorkflowId: sourceId,
        targetWorkflowId: targetId,
      })
      expect(await h.durableStorage.get(`workflow/${sourceId}`)).toEqual(source)
      expect(await h.durableStorage.get(`workflow/${targetId}`)).toEqual(target)
      expect(await h.durableStorage.get(`budget/${targetId}`)).toEqual({ totalDispatches: 6, seenDispatches: ["prior"] })
      expect(await h.durableStorage.get(`limits/${targetId}`)).toEqual({ maxTotalDispatches: 8 })

      const retry = await h.call("resume", { workflowId: targetId, fromWorkflowId: targetId }, "general", general)
      expect(retry).toMatchObject({ status: "already_current", workDispatched: false })
      expect(await h.durableStorage.get(`session-attachment/${general}`)).toBe(committedAttachment)
      expect(await h.durableStorage.get(`session-resumption/${encodeURIComponent(general)}`)).toEqual(provenance)
    } finally {
      h.restore()
    }
  })

  test("independent native and Code Mode calls captured before rotation never retarget", async () => {
    const h = await harness()
    const createdAt = new Date().toISOString()
    try {
      for (const surface of ["native", "code"] as const) {
        const suffix = surface
        const general = `process-wait-${suffix}-general`
        const sourceId = `process-wait-${suffix}-source`
        const targetId = `process-wait-${suffix}-target`
        const readyFile = join(h.root, `process-wait-${suffix}-captured`)
        const releaseFile = join(h.root, `process-wait-${suffix}-release`)
        await h.durableStorage.set(`workflow/${sourceId}`, {
          id: sourceId,
          projectId: h.runtime.projectId,
          revision: 1,
          anchor: `task:${sourceId}`,
          createdBySession: general,
          createdAt,
          steps: [{ id: "done", agent: "worker", kind: "work", dependsOn: [], status: "complete" }],
        })
        await h.durableStorage.set(`workflow/${targetId}`, {
          id: targetId,
          projectId: h.runtime.projectId,
          revision: 1,
          anchor: `task:${targetId}`,
          createdBySession: general,
          createdAt,
          steps: [{ id: "pending", agent: "worker", kind: "work", dependsOn: [], status: "pending" }],
        })
        await h.durableStorage.set(`session/${general}`, sourceId)
        await h.durableStorage.set(`session-attachment/${general}`, `${suffix}-old-attachment`)
        await h.durableStorage.set(`session-step/${general}`, "stale-selector")
        await h.durableStorage.set(`session-step-attempt/${encodeURIComponent(general)}`, 3)
        await h.durableStorage.set(`session-oq/${general}`, "stale-question")

        const waiting = spawnResumptionProcessFixture(h.root, {
          mode: surface === "native" ? "wait-native" : "wait-codemode",
          sessionID: general,
          agent: "general",
          toolName: "status",
          surface,
          toolInput: { detail: true },
          readyFile,
          releaseFile,
        })
        for (let attempt = 0; attempt < 1_000; attempt++) {
          try {
            await readFile(readyFile)
            break
          } catch (error: any) {
            if (error?.code !== "ENOENT") throw error
            if (attempt === 999) throw new Error(`${surface} process did not acknowledge its pre-lease tuple.`)
            await Bun.sleep(5)
          }
        }

        const resumer = spawnResumptionProcessFixture(h.root, {
          mode: "tool",
          sessionID: general,
          agent: "general",
          toolName: "resume",
          surface: "code",
          toolInput: { workflowId: targetId, fromWorkflowId: sourceId },
        })
        expect((await readResumptionProcessFixture(resumer)).status).toBe("resumed")
        await writeFile(releaseFile, "allow the original captured call to revalidate")
        const stale = await readResumptionProcessFixture(waiting)
        expect(stale.thrown).toContain("attachment changed while this Loom invocation waited")
        expect(stale.workflow).toBeUndefined()
        expect(await h.durableStorage.get(`session/${general}`)).toBe(targetId)
        expect(await h.durableStorage.get(`session-attachment/${general}`)).not.toBe(`${surface}-old-attachment`)
        expect(await h.durableStorage.get(`session-step/${general}`)).toBe("")
        expect(await h.durableStorage.get(`session-step-attempt/${encodeURIComponent(general)}`)).toBeNull()
        expect(await h.durableStorage.get(`session-oq/${general}`)).toBe("")
      }
    } finally {
      h.restore()
    }
  })

  test("independent exact attach admission completes before resume rechecks an unused target grant", async () => {
    const h = await harness()
    const general = "attach-resume-general"
    const child = "attach-resume-child"
    const sourceId = "attach-resume-source"
    const targetId = "attach-resume-target"
    const readyFile = join(h.root, "attach-resume-waiting")
    const releaseFile = join(h.root, "attach-resume-release")
    let resumer: ReturnType<typeof Bun.spawn> | undefined
    try {
      const createdAt = new Date().toISOString()
      await h.durableStorage.set(`workflow/${sourceId}`, {
        id: sourceId,
        projectId: h.runtime.projectId,
        revision: 1,
        anchor: `task:${sourceId}`,
        createdBySession: general,
        createdAt,
        steps: [{ id: "done", agent: "worker", kind: "work", dependsOn: [], status: "complete" }],
      })
      await h.durableStorage.set(`workflow/${targetId}`, {
        id: targetId,
        projectId: h.runtime.projectId,
        revision: 1,
        anchor: `task:${targetId}`,
        createdBySession: general,
        createdAt,
        steps: [{ id: "pending", agent: "worker", kind: "work", dependsOn: [], status: "pending", attempt: 0 }],
      })
      await h.durableStorage.set(`session/${general}`, sourceId)
      await h.durableStorage.set(`session-attachment/${general}`, "attach-resume-source")
      const attachGrant = {
        schemaVersion: 1,
        grantId: "attach-resume-target-grant",
        projectId: h.runtime.projectId,
        workflowId: targetId,
        stepId: "pending",
        expectedAgent: "worker",
        issuingParentSessionId: general,
        createdAt,
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
      }
      await h.durableStorage.set(`dispatch-grant/${attachGrant.grantId}`, attachGrant)

      resumer = spawnResumptionProcessFixture(h.root, {
        mode: "resume-after-observation",
        sessionID: general,
        agent: "general",
        toolName: "resume",
        workflowId: targetId,
        sourceWorkflowId: sourceId,
        targetWorkflowId: targetId,
        toolInput: { workflowId: targetId, fromWorkflowId: sourceId },
        readyFile,
        releaseFile,
      })
      for (let attempt = 0; attempt < 1_000; attempt++) {
        try {
          await readFile(readyFile)
          break
        } catch (error: any) {
          if (error?.code !== "ENOENT") throw error
          if (attempt === 999) throw new Error("Independent resume process did not reach the post-observation/pre-lock barrier.")
          await Bun.sleep(5)
        }
      }

      const attached = runResumptionProcessFixture(h.root, {
        mode: "tool",
        sessionID: child,
        agent: "worker",
        toolName: "attach",
        toolInput: { workflowId: targetId, stepId: "pending", grantId: attachGrant.grantId },
      })
      expect(attached.error).toBeUndefined()
      expect(await h.durableStorage.get(`dispatch-grant/${attachGrant.grantId}`)).toMatchObject({
        consumedAt: expect.any(String),
        consumingSessionId: child,
      })
      await writeFile(releaseFile, "attach consumed the target grant before resume commit")
      expect((await readResumptionProcessFixture(resumer)).status).toBe("resumed")
      expect(await h.durableStorage.get(`session/${general}`)).toBe(targetId)
      expect(await h.durableStorage.get(`session/${child}`)).toBe(targetId)
      expect(await h.durableStorage.get(`session-step/${child}`)).toBe("pending")
      expect(await h.durableStorage.get(`session-step-attempt/${encodeURIComponent(child)}`)).toBe(0)
    } finally {
      if (resumer && resumer.exitCode === null) {
        await writeFile(releaseFile, "cleanup")
        await resumer.exited
      }
      h.restore()
    }
  })

  test("resume preserves an authorized Plan amendment that wins after target observation", async () => {
    const h = await waveLifecycleFixture("wave", true)
    const sourceId = "post-observation-plan-amend-source"
    const sourceIdPath = `workflow/${sourceId}`
    const readyFile = join(h.root, "post-observation-plan-amend-ready")
    const releaseFile = join(h.root, "post-observation-plan-amend-release")
    let resumer: ReturnType<typeof Bun.spawn> | undefined
    try {
      const raised = await h.call("oq_raise", {
        workflowId: h.workflowId,
        taskId: "two",
        question: "Amend only future Task two while preserving the claimed current Wave.",
        responder: "planner",
        blocking: false,
      }, "general", "parent")
      expect(raised.error).toBeUndefined()
      const grant = await h.call("dispatch_grant", {
        workflowId: h.workflowId,
        questionId: raised.question.id,
      }, "general", "parent")
      expect(grant.error).toBeUndefined()
      const plannerSession = "post-observation-plan-amend-planner"
      expect((await h.call("attach", {
        workflowId: h.workflowId,
        questionId: raised.question.id,
        grantId: grant.grantId,
      }, "planner", plannerSession)).attached).toBe(true)

      const source = {
        id: sourceId,
        projectId: h.runtime.projectId,
        revision: 1,
        anchor: `task:${sourceId}`,
        createdBySession: "parent",
        createdAt: new Date().toISOString(),
        steps: [{ id: "done", agent: "worker", kind: "work", dependsOn: [], status: "complete", attempt: 0 }],
      }
      await h.durableStorage.set(sourceIdPath, source)
      await h.durableStorage.set("session/parent", sourceId)
      await h.durableStorage.set("session-attachment/parent", "post-observation-plan-amend-source-attachment")
      await h.durableStorage.set("session-step/parent", "")
      await h.durableStorage.set("session-step-attempt/parent", null)
      await h.durableStorage.set("session-oq/parent", "")
      const workBefore = await h.work()
      const targetBefore = await h.workflow()
      const currentWaveBefore = workBefore.nodes.find((node: any) => node.type === "wave" && node.logicalId === "first")
      expect(currentWaveBefore.claimedByWorkflowId).toBe(h.workflowId)

      resumer = spawnResumptionProcessFixture(h.root, {
        mode: "resume-after-observation",
        sessionID: "parent",
        agent: "general",
        toolName: "resume",
        workflowId: h.workflowId,
        sourceWorkflowId: sourceId,
        targetWorkflowId: h.workflowId,
        toolInput: { workflowId: h.workflowId, fromWorkflowId: sourceId },
        readyFile,
        releaseFile,
      })
      for (let attempt = 0; attempt < 1_000; attempt++) {
        try {
          await readFile(readyFile)
          break
        } catch (error: any) {
          if (error?.code !== "ENOENT") throw error
          if (attempt === 999) throw new Error("Resume did not acknowledge the loaded target snapshot before locking.")
          await Bun.sleep(5)
        }
      }

      const amended = await h.call("work_amend", {
        workflowId: h.workflowId,
        questionId: raised.question.id,
        expectedVersion: workBefore.version,
        reason: "Change only the unclaimed future Wave after resume observed the target.",
        operations: [{
          action: "patch-task",
          taskId: "two",
          patch: { subtasks: ["Implement future Task two after current Wave review"] },
        }],
      }, "planner", plannerSession)
      expect(amended.error).toBeUndefined()
      expect(amended.taskPlanRefreshRequired).toBe(false)
      expect(amended.changedTaskIds).toContain("two")

      await writeFile(releaseFile, "commit resume after the independent Work amendment")
      expect((await readResumptionProcessFixture(resumer)).status).toBe("resumed")
      expect(await h.durableStorage.get("session/parent")).toBe(h.workflowId)
      const currentTarget = await h.workflow()
      const currentWork = await h.work()
      expect(currentTarget.work.objectiveId).toBe(targetBefore.work.objectiveId)
      expect(currentTarget.work.generation).toBe(targetBefore.work.generation)
      expect(currentTarget.work.taskPlanRevision).toBe(amended.revision)
      expect(currentTarget.steps).toEqual(targetBefore.steps)
      expect(currentTarget.steps.find((step: any) => step.id === "task:one").status).toBe("pending")
      expect(currentTarget.work.taskPlanRevision).toBe(amended.revision)
      expect(currentWork.plans.find((plan: any) => plan.generation === currentWork.generation).phases[0].waves[1].tasks[0].subtasks)
        .toEqual(["Implement future Task two after current Wave review"])
      const currentWaveAfter = currentWork.nodes.find((node: any) => node.type === "wave" && node.logicalId === "first")
      expect(currentWaveAfter.claimedByWorkflowId).toBe(h.workflowId)
      expect(currentWaveAfter.id).toBe(currentWaveBefore.id)
    } finally {
      if (resumer && resumer.exitCode === null) {
        await writeFile(releaseFile, "cleanup")
        await resumer.exited
      }
      h.restore()
    }
  })

  test("resume denies a target Plan-generation association replaced after its observation", async () => {
    const h = await waveLifecycleFixture("wave", false)
    const sourceId = "generation-race-source"
    const readyFile = join(h.root, "generation-race-observed")
    const releaseFile = join(h.root, "generation-race-release")
    let resumer: ReturnType<typeof Bun.spawn> | undefined
    try {
      const reopened = await h.call("reopen", {
        workflowId: h.workflowId,
        stepId: "plan",
        reason: "A new hypothesis requires replacing the unconsumed reviewed Plan generation.",
        newEvidence: true,
        changedHypothesis: true,
        changedStrategy: false,
        reducedUnresolved: false,
      }, "general", "parent")
      expect(reopened.error).toBeUndefined()
      expect(reopened.reset).toContain("review-plan")
      const plannerGrant = await h.call("dispatch_grant", {
        workflowId: h.workflowId,
        stepId: "plan",
      }, "general", "parent")
      expect(plannerGrant.error).toBeUndefined()
      const planner = "generation-race-planner"
      expect((await h.call("attach", {
        workflowId: h.workflowId,
        stepId: "plan",
        grantId: plannerGrant.grantId,
      }, "planner", planner)).attached).toBe(true)

      const originalWork = await h.work()
      const originalBinding = (await h.workflow()).work
      const source = {
        id: sourceId,
        projectId: h.runtime.projectId,
        revision: 1,
        anchor: `task:${sourceId}`,
        createdBySession: "parent",
        createdAt: new Date().toISOString(),
        steps: [{ id: "done", agent: "worker", kind: "work", dependsOn: [], status: "complete", attempt: 0 }],
      }
      await h.durableStorage.set(`workflow/${sourceId}`, source)
      await h.durableStorage.set("session/parent", sourceId)
      await h.durableStorage.set("session-attachment/parent", "generation-race-source-attachment")
      await h.durableStorage.set("session-step/parent", "")
      await h.durableStorage.set("session-step-attempt/parent", null)
      await h.durableStorage.set("session-oq/parent", "")

      resumer = spawnResumptionProcessFixture(h.root, {
        mode: "resume-after-observation",
        sessionID: "parent",
        agent: "general",
        toolName: "resume",
        workflowId: h.workflowId,
        sourceWorkflowId: sourceId,
        targetWorkflowId: h.workflowId,
        toolInput: { workflowId: h.workflowId, fromWorkflowId: sourceId },
        readyFile,
        releaseFile,
      })
      for (let attempt = 0; attempt < 1_000; attempt++) {
        try {
          await readFile(readyFile)
          break
        } catch (error: any) {
          if (error?.code !== "ENOENT") throw error
          if (attempt === 999) throw new Error("Resume did not observe source/target before acquiring workflow locks.")
          await Bun.sleep(5)
        }
      }

      const replaced = await h.call("work_plan", richWorkPlanInput(h.workflowId, [{
        id: "replacement",
        title: "Replacement",
        waves: [{ id: "fresh", title: "Fresh", tasks: [
          richPlanTask("replacement-task", "Replacement task", "A new generation supersedes the observed one."),
        ] }],
      }], {
        expectedVersion: originalWork.version,
        replaceReason: "The independent Planner replaces an unconsumed Plan generation after resume observation.",
      }), "planner", planner)
      expect(replaced.error).toBeUndefined()
      expect(replaced.generation).toBeGreaterThan(originalBinding.generation)
      const updatedTarget = await h.workflow()
      expect(updatedTarget.work.generation).toBe(replaced.generation)
      const updatedWork = await h.work()
      expect(updatedWork.generation).toBe(replaced.generation)
      expect(updatedTarget.work.objectiveId).toBe(originalBinding.objectiveId)

      await writeFile(releaseFile, "revalidate the changed target generation association")
      const denied = await readResumptionProcessFixture(resumer)
      expect(denied.status).not.toBe("resumed")
      expect(denied.error ?? denied.thrown).toContain("Plan association changed concurrently")
      expect(await h.durableStorage.get("session/parent")).toBe(sourceId)
      expect(await h.durableStorage.get("session-attachment/parent")).toBe("generation-race-source-attachment")
      expect(await h.durableStorage.get("session-step/parent")).toBe("")
      expect(await h.durableStorage.get("session-step-attempt/parent")).toBeNull()
      expect(await h.durableStorage.get("session-oq/parent")).toBe("")
      expect(await h.durableStorage.get(`session-resumption/${encodeURIComponent("parent")}`)).toBeUndefined()
      expect(await h.workflow()).toEqual(updatedTarget)
      expect(await h.work()).toEqual(updatedWork)
      expect((await h.durableStorage.get(`workflow/${sourceId}`))).toEqual(source)
    } finally {
      if (resumer && resumer.exitCode === null) {
        await writeFile(releaseFile, "cleanup")
        await resumer.exited
      }
      h.restore()
    }
  })

  test("independent start wins the coordinator lease before resume commit and leaves no mixed binding", async () => {
    const h = await harness()
    const general = "start-resume-general"
    const sourceId = "start-resume-source"
    const targetId = "start-resume-target"
    const readyFile = join(h.root, "start-resume-observed")
    const releaseFile = join(h.root, "start-resume-release")
    let resumer: ReturnType<typeof Bun.spawn> | undefined
    try {
      const createdAt = new Date().toISOString()
      await h.durableStorage.set(`workflow/${sourceId}`, {
        id: sourceId,
        projectId: h.runtime.projectId,
        revision: 1,
        anchor: `task:${sourceId}`,
        createdBySession: general,
        createdAt,
        steps: [{ id: "done", agent: "worker", kind: "work", dependsOn: [], status: "complete", attempt: 0 }],
      })
      await h.durableStorage.set(`workflow/${targetId}`, {
        id: targetId,
        projectId: h.runtime.projectId,
        revision: 1,
        anchor: `task:${targetId}`,
        createdBySession: general,
        createdAt,
        steps: [{ id: "pending", agent: "worker", kind: "work", dependsOn: [], status: "pending" }],
      })
      await h.durableStorage.set(`session/${general}`, sourceId)
      await h.durableStorage.set(`session-attachment/${general}`, "start-resume-source-attachment")

      resumer = spawnResumptionProcessFixture(h.root, {
        mode: "resume-before-coordinator-lease",
        sessionID: general,
        agent: "general",
        toolName: "resume",
        workflowId: targetId,
        sourceWorkflowId: sourceId,
        targetWorkflowId: targetId,
        toolInput: { workflowId: targetId, fromWorkflowId: sourceId },
        readyFile,
        releaseFile,
      })
      for (let attempt = 0; attempt < 1_000; attempt++) {
        try {
          await readFile(readyFile)
          break
        } catch (error: any) {
          if (error?.code !== "ENOENT") throw error
          if (attempt === 999) throw new Error("Resume process did not reach its coordinator-lease barrier.")
          await Bun.sleep(5)
        }
      }

      const started = runResumptionProcessFixture(h.root, {
        mode: "tool",
        sessionID: general,
        agent: "general",
        toolName: "start",
        toolInput: { request: "bounded competing start for the coordinator lease test" },
      })
      expect(started.status).toBe("started")
      expect(started.workflowId).not.toBe(targetId)
      expect(await h.durableStorage.get(`session/${general}`)).toBe(started.workflowId)

      await writeFile(releaseFile, "start committed before resume revalidation")
      const denied = await readResumptionProcessFixture(resumer)
      expect(denied.status).not.toBe("resumed")
      expect(denied.error ?? denied.thrown).toBeDefined()
      expect(await h.durableStorage.get(`session/${general}`)).toBe(started.workflowId)
      expect(await h.durableStorage.get(`session-resumption/${encodeURIComponent(general)}`)).toBeUndefined()
      expect(await h.durableStorage.get(`workflow/${targetId}`)).toMatchObject({ id: targetId, revision: 1 })
    } finally {
      if (resumer && resumer.exitCode === null) {
        await writeFile(releaseFile, "cleanup")
        await resumer.exited
      }
      h.restore()
    }
  })

  test("source reopen waits across resume and rejects its stale source tuple while target lifecycle remains available", async () => {
    const h = await harness()
    const general = "reopen-resume-general"
    const sourceId = "reopen-resume-source"
    const targetId = "reopen-resume-target"
    const createdAt = new Date().toISOString()
    const readyFile = join(h.root, "reopen-resume-post-observation")
    const releaseFile = join(h.root, "reopen-resume-release")
    let resumer: ReturnType<typeof Bun.spawn> | undefined
    let reopener: ReturnType<typeof Bun.spawn> | undefined
    try {
      await h.durableStorage.set(`workflow/${sourceId}`, {
        id: sourceId,
        projectId: h.runtime.projectId,
        revision: 2,
        anchor: `task:${sourceId}`,
        createdBySession: general,
        createdAt,
        steps: [{ id: "done", agent: "worker", kind: "work", dependsOn: [], status: "complete", attempt: 0 }],
      })
      await h.durableStorage.set(`workflow/${targetId}`, {
        id: targetId,
        projectId: h.runtime.projectId,
        revision: 4,
        anchor: `task:${targetId}`,
        createdBySession: general,
        createdAt,
        steps: [{ id: "pending", agent: "worker", kind: "work", dependsOn: [], status: "pending", attempt: 0 }],
      })
      await h.durableStorage.set(`session/${general}`, sourceId)
      await h.durableStorage.set(`session-attachment/${general}`, "reopen-resume-before")
      await h.durableStorage.set(`session-step/${general}`, "old-selector")
      await h.durableStorage.set(`session-step-attempt/${encodeURIComponent(general)}`, 0)

      resumer = spawnResumptionProcessFixture(h.root, {
        mode: "resume-after-observation",
        sessionID: general,
        agent: "general",
        toolName: "resume",
        workflowId: targetId,
        sourceWorkflowId: sourceId,
        targetWorkflowId: targetId,
        toolInput: { workflowId: targetId, fromWorkflowId: sourceId },
        readyFile,
        releaseFile,
      })
      for (let attempt = 0; attempt < 1_000; attempt++) {
        try {
          await readFile(readyFile)
          break
        } catch (error: any) {
          if (error?.code !== "ENOENT") throw error
          if (attempt === 999) throw new Error("Resume did not reach its acknowledged observation-to-lock barrier.")
          await Bun.sleep(5)
        }
      }

      reopener = spawnResumptionProcessFixture(h.root, {
        mode: "tool",
        sessionID: general,
        agent: "general",
        toolName: "reopen",
        toolInput: {
          workflowId: sourceId,
          stepId: "done",
          reason: "New evidence requires checking whether the source may be reopened.",
          newEvidence: true,
          changedHypothesis: false,
          changedStrategy: false,
          reducedUnresolved: false,
        },
      })
      await waitForRuntimeLockUsers(h.runtime, "session-coordinator", general, 2)
      expect((await h.durableStorage.get(`workflow/${sourceId}`) as any).steps[0]).toMatchObject({
        status: "complete",
        attempt: 0,
      })

      await writeFile(releaseFile, "commit resume before revalidating the queued source reopen")
      expect((await readResumptionProcessFixture(resumer)).status).toBe("resumed")
      const staleReopen = await readResumptionProcessFixture(reopener)
      expect(staleReopen.thrown).toContain("attachment changed while this Loom invocation waited")
      expect(await h.durableStorage.get(`session/${general}`)).toBe(targetId)
      expect((await h.durableStorage.get(`workflow/${sourceId}`) as any).steps[0]).toMatchObject({
        status: "complete",
        attempt: 0,
      })

      const targetReopen = await h.call("reopen", {
        workflowId: targetId,
        stepId: "pending",
        reason: "A new target-side evidence item merits the ordinary lifecycle operation after restoration.",
        newEvidence: true,
        changedHypothesis: false,
        changedStrategy: false,
        reducedUnresolved: false,
      }, "general", general)
      expect(targetReopen.error).toBeUndefined()
      expect((await h.durableStorage.get(`workflow/${targetId}`) as any).steps[0].attempt).toBe(1)
    } finally {
      if (resumer && resumer.exitCode === null) {
        await writeFile(releaseFile, "cleanup")
        await resumer.exited
      }
      if (reopener && reopener.exitCode === null) await reopener.exited
      h.restore()
    }
  })

  test("a production source reopen that wins the coordinator lease makes subsequent resume ineligible", async () => {
    const h = await harness()
    const general = "source-reopen-first-general"
    const sourceId = "source-reopen-first-source"
    const targetId = "source-reopen-first-target"
    const createdAt = new Date().toISOString()
    const readyFile = join(h.root, "source-reopen-first-selected")
    const releaseFile = join(h.root, "source-reopen-first-release")
    let reopener: ReturnType<typeof Bun.spawn> | undefined
    let resumer: ReturnType<typeof Bun.spawn> | undefined
    try {
      await h.durableStorage.set(`workflow/${sourceId}`, {
        id: sourceId,
        projectId: h.runtime.projectId,
        revision: 1,
        anchor: `task:${sourceId}`,
        createdBySession: general,
        createdAt,
        steps: [{ id: "done", agent: "worker", kind: "work", dependsOn: [], status: "complete", attempt: 0 }],
      })
      const target = {
        id: targetId,
        projectId: h.runtime.projectId,
        revision: 1,
        anchor: `task:${targetId}`,
        createdBySession: general,
        createdAt,
        steps: [{ id: "pending", agent: "worker", kind: "work", dependsOn: [], status: "pending", attempt: 0 }],
      }
      await h.durableStorage.set(`workflow/${targetId}`, target)
      await h.durableStorage.set(`session/${general}`, sourceId)
      await h.durableStorage.set(`session-attachment/${general}`, "source-reopen-first-attachment")
      await h.durableStorage.set(`session-step/${general}`, "")
      await h.durableStorage.set(`session-step-attempt/${encodeURIComponent(general)}`, null)

      reopener = spawnResumptionProcessFixture(h.root, {
        mode: "reopen-before-commit",
        sessionID: general,
        agent: "general",
        toolName: "reopen",
        workflowId: sourceId,
        toolInput: {
          workflowId: sourceId,
          stepId: "done",
          reason: "A changed hypothesis requires reopening the source before restoration admission.",
          newEvidence: true,
          changedHypothesis: true,
          changedStrategy: false,
          reducedUnresolved: false,
        },
        readyFile,
        releaseFile,
      })
      for (let attempt = 0; attempt < 1_000; attempt++) {
        try {
          await readFile(readyFile)
          break
        } catch (error: any) {
          if (error?.code !== "ENOENT") throw error
          if (attempt === 999) throw new Error("Registered source reopen did not reach its coordinator-fenced commit barrier.")
          await Bun.sleep(5)
        }
      }

      resumer = spawnResumptionProcessFixture(h.root, {
        mode: "tool",
        sessionID: general,
        agent: "general",
        toolName: "resume",
        workflowId: targetId,
        toolInput: { workflowId: targetId, fromWorkflowId: sourceId },
      })
      await waitForRuntimeLockUsers(h.runtime, "session-coordinator", general, 2)
      await writeFile(releaseFile, "let the source reopen commit before resume admission")

      const reopened = await readResumptionProcessFixture(reopener)
      expect(reopened.reopened).toBe("done")
      const denied = await readResumptionProcessFixture(resumer)
      expect(denied.status).not.toBe("resumed")
      expect(denied.error ?? denied.thrown).toContain("successfully completed current workflow")
      expect(await h.durableStorage.get(`session/${general}`)).toBe(sourceId)
      expect(await h.durableStorage.get(`session-attachment/${general}`)).toBe("source-reopen-first-attachment")
      expect(await h.durableStorage.get(`workflow/${sourceId}`)).toMatchObject({
        steps: [{ status: "pending", attempt: 1 }],
      })
      expect(await h.durableStorage.get(`workflow/${targetId}`)).toEqual(target)
      expect(await h.durableStorage.get(`session-resumption/${encodeURIComponent(general)}`)).toBeUndefined()
    } finally {
      if (reopener && reopener.exitCode === null) {
        await writeFile(releaseFile, "cleanup")
        await reopener.exited
      }
      if (resumer && resumer.exitCode === null) await resumer.exited
      h.restore()
    }
  })

  test("resume denies a target deleted by the independent production cleanup transaction", async () => {
    const h = await harness()
    const general = "delete-resume-general"
    const sourceId = "delete-resume-source"
    const targetId = "delete-resume-target"
    const createdAt = new Date().toISOString()
    const readyFile = join(h.root, "delete-resume-snapshots-loaded")
    const releaseFile = join(h.root, "delete-resume-release")
    let resumer: ReturnType<typeof Bun.spawn> | undefined
    try {
      await h.durableStorage.set(`workflow/${sourceId}`, {
        id: sourceId,
        projectId: h.runtime.projectId,
        revision: 1,
        anchor: `task:${sourceId}`,
        createdBySession: general,
        createdAt,
        steps: [{ id: "done", agent: "worker", kind: "work", dependsOn: [], status: "complete" }],
      })
      await h.durableStorage.set(`workflow/${targetId}`, {
        id: targetId,
        projectId: h.runtime.projectId,
        revision: 4,
        anchor: `task:${targetId}`,
        createdBySession: general,
        createdAt,
        steps: [{ id: "failed-gate", agent: "reviewer", kind: "gate", dependsOn: [], status: "failed" }],
      })
      await h.durableStorage.set(`session/${general}`, sourceId)
      await h.durableStorage.set(`session-attachment/${general}`, "delete-resume-source")

      resumer = spawnResumptionProcessFixture(h.root, {
        mode: "resume-after-observation",
        sessionID: general,
        agent: "general",
        toolName: "resume",
        workflowId: targetId,
        sourceWorkflowId: sourceId,
        targetWorkflowId: targetId,
        toolInput: { workflowId: targetId, fromWorkflowId: sourceId },
        readyFile,
        releaseFile,
      })
      for (let attempt = 0; attempt < 1_000; attempt++) {
        try {
          await readFile(readyFile)
          break
        } catch (error: any) {
          if (error?.code !== "ENOENT") throw error
          if (attempt === 999) throw new Error("Resume process did not acknowledge its source/target snapshot.")
          await Bun.sleep(5)
        }
      }

      const deletion = runResumptionProcessFixture(h.root, {
        mode: "delete-workflow",
        sessionID: general,
        agent: "general",
        toolName: "delete",
        toolInput: {
          workflowIds: [targetId],
          reason: "Delete the failed test target before resume revalidation commits.",
        },
      })
      expect(deletion.deleted).toEqual([targetId])
      expect(await h.durableStorage.get(`workflow/${targetId}`)).toBeUndefined()
      expect(await h.durableStorage.get(`workflow-deletion/${targetId}`)).toMatchObject({
        workflowId: targetId,
        projectId: h.runtime.projectId,
        status: "failed",
      })

      await writeFile(releaseFile, "revalidate after independent deletion")
      const resumeResult = await readResumptionProcessFixture(resumer)
      expect(resumeResult.error ?? resumeResult.thrown).toBeDefined()
      expect(resumeResult.status).not.toBe("resumed")
      expect(await h.durableStorage.get(`session/${general}`)).toBe(sourceId)
      expect(await h.durableStorage.get(`session-resumption/${encodeURIComponent(general)}`)).toBeUndefined()
    } finally {
      if (resumer && resumer.exitCode === null) {
        await writeFile(releaseFile, "cleanup")
        await resumer.exited
      }
      h.restore()
    }
  })

  test("resume revalidates target cancellation committed after its source and target observations", async () => {
    const h = await harness()
    const general = "cancel-resume-general"
    const sourceId = "cancel-resume-source"
    const targetId = "cancel-resume-target"
    const createdAt = new Date().toISOString()
    const readyFile = join(h.root, "cancel-resume-post-observation")
    const releaseFile = join(h.root, "cancel-resume-release")
    let resumer: ReturnType<typeof Bun.spawn> | undefined
    try {
      await h.durableStorage.set(`workflow/${sourceId}`, {
        id: sourceId,
        projectId: h.runtime.projectId,
        revision: 2,
        anchor: `task:${sourceId}`,
        createdBySession: general,
        createdAt,
        steps: [{ id: "done", agent: "worker", kind: "work", dependsOn: [], status: "complete", attempt: 0 }],
      })
      await h.durableStorage.set(`workflow/${targetId}`, {
        id: targetId,
        projectId: h.runtime.projectId,
        revision: 3,
        anchor: `task:${targetId}`,
        createdBySession: general,
        createdAt,
        steps: [{ id: "failed-gate", agent: "reviewer", kind: "gate", dependsOn: [], status: "failed" }],
      })
      await h.durableStorage.set(`session/${general}`, sourceId)
      await h.durableStorage.set(`session-attachment/${general}`, "cancel-resume-before")
      await h.durableStorage.set(`session-step/${general}`, "old-selector")
      await h.durableStorage.set(`session-step-attempt/${encodeURIComponent(general)}`, 2)
      await h.durableStorage.set(`session-oq/${general}`, "old-question")

      resumer = spawnResumptionProcessFixture(h.root, {
        mode: "resume-after-observation",
        sessionID: general,
        agent: "general",
        toolName: "resume",
        workflowId: targetId,
        sourceWorkflowId: sourceId,
        targetWorkflowId: targetId,
        toolInput: { workflowId: targetId, fromWorkflowId: sourceId },
        readyFile,
        releaseFile,
      })
      for (let attempt = 0; attempt < 1_000; attempt++) {
        try {
          await readFile(readyFile)
          break
        } catch (error: any) {
          if (error?.code !== "ENOENT") throw error
          if (attempt === 999) throw new Error("Resume did not acknowledge both workflow observations before its locks.")
          await Bun.sleep(5)
        }
      }

      const cancelled = runResumptionProcessFixture(h.root, {
        mode: "cancel-workflow",
        sessionID: general,
        agent: "general",
        toolName: "cancel",
        toolInput: {
          workflowId: targetId,
          reason: "Cancel the failed test target after resume observations and before its guarded commit.",
          confirmation: "Cancel this failed test workflow before the pending resume transition commits.",
        },
      })
      expect(cancelled.cancelled).toBe(true)
      expect((await h.durableStorage.get(`workflow/${targetId}`) as any).cancellation).toBeDefined()
      const bindingAfterCancellation = await h.durableStorage.get(`session/${general}`)
      const attachmentAfterCancellation = await h.durableStorage.get(`session-attachment/${general}`)
      const targetAfterCancellation = await h.durableStorage.get(`workflow/${targetId}`)

      await writeFile(releaseFile, "revalidate target cancellation after observation")
      const denied = await readResumptionProcessFixture(resumer)
      expect(denied.status).not.toBe("resumed")
      expect(denied.error ?? denied.thrown).toContain("cancelled")
      expect(await h.durableStorage.get(`session/${general}`)).toBe(bindingAfterCancellation)
      expect(await h.durableStorage.get(`session-attachment/${general}`)).toBe(attachmentAfterCancellation)
      expect(await h.durableStorage.get(`session-step/${general}`)).toBe("old-selector")
      expect(await h.durableStorage.get(`session-step-attempt/${encodeURIComponent(general)}`)).toBe(2)
      expect(await h.durableStorage.get(`session-oq/${general}`)).toBe("old-question")
      expect(await h.durableStorage.get(`session-resumption/${encodeURIComponent(general)}`)).toBeUndefined()
      expect(await h.durableStorage.get(`workflow/${targetId}`)).toEqual(targetAfterCancellation)
      expect((await h.durableStorage.get(`workflow/${sourceId}`) as any).steps[0]).toMatchObject({
        status: "complete",
        attempt: 0,
      })
    } finally {
      if (resumer && resumer.exitCode === null) {
        await writeFile(releaseFile, "cleanup")
        await resumer.exited
      }
      h.restore()
    }
  })

  test("legacy binding migration and resume cannot overwrite one another across processes", async () => {
    const h = await harness()
    const general = "legacy-resume-general"
    const sourceId = "legacy-resume-source"
    const targetId = "legacy-resume-target"
    const createdAt = new Date().toISOString()
    const migrationReady = join(h.root, "legacy-migration-captured")
    const migrationRelease = join(h.root, "legacy-migration-release")
    const resumeReady = join(h.root, "legacy-resume-captured")
    const resumeRelease = join(h.root, "legacy-resume-release")
    let externalLease: Awaited<ReturnType<typeof holdRuntimeLockForTest>> | undefined
    let migration: ReturnType<typeof Bun.spawn> | undefined
    let resume: ReturnType<typeof Bun.spawn> | undefined
    try {
      const source = {
        id: sourceId,
        projectId: h.runtime.projectId,
        revision: 1,
        anchor: "task:legacy-resume-source",
        createdBySession: general,
        createdAt,
        steps: [{ id: "done", agent: "worker", kind: "work", dependsOn: [], status: "complete" }],
      }
      await h.durableStorage.set(`workflow/${sourceId}`, source)
      await h.durableStorage.set(`workflow/${targetId}`, {
        id: targetId,
        projectId: h.runtime.projectId,
        revision: 1,
        anchor: "task:legacy-resume-target",
        createdBySession: general,
        createdAt,
        steps: [{ id: "pending", agent: "worker", kind: "work", dependsOn: [], status: "pending" }],
      })
      expect(await h.durableStorage.get(`session/${general}`)).toBeUndefined()
      externalLease = await holdRuntimeLockForTest(h.runtime, "session-coordinator", general)

      migration = spawnResumptionProcessFixture(h.root, {
        mode: "wait-native",
        sessionID: general,
        agent: "general",
        toolName: "status",
        toolInput: { detail: true },
        readyFile: migrationReady,
        releaseFile: migrationRelease,
        legacyRecords: [
          [`session/${general}`, sourceId],
          [`workflow/${sourceId}`, source],
        ],
      })
      resume = spawnResumptionProcessFixture(h.root, {
        mode: "wait-native",
        sessionID: general,
        agent: "general",
        toolName: "resume",
        toolInput: { workflowId: targetId, fromWorkflowId: sourceId },
        readyFile: resumeReady,
        releaseFile: resumeRelease,
      })
      const waitForFile = async (path: string) => {
        for (let attempt = 0; attempt < 1_000; attempt++) {
          try {
            await readFile(path)
            return
          } catch (error: any) {
            if (error?.code !== "ENOENT") throw error
            if (attempt === 999) throw new Error(`Process invocation did not reach its binding barrier: ${path}`)
            await Bun.sleep(5)
          }
        }
      }
      await Promise.all([waitForFile(migrationReady), waitForFile(resumeReady)])
      await writeFile(migrationRelease, "allow legacy migration to contend")
      await writeFile(resumeRelease, "allow resume to contend")
      await waitForRuntimeLockUsers(h.runtime, "session-coordinator", general, 3)
      externalLease.proc.stdin!.end()
      await once(externalLease.proc, "exit")
      externalLease = undefined

      const [migrationResult, resumeResult] = await Promise.all([
        readResumptionProcessFixture(migration),
        readResumptionProcessFixture(resume),
      ])
      expect(migrationResult.workflow.id).toBe(sourceId)
      expect(resumeResult.status).not.toBe("resumed")
      expect(resumeResult.thrown ?? resumeResult.error).toBeDefined()
      expect(await h.durableStorage.get(`session/${general}`)).toBe(sourceId)
      expect(await h.durableStorage.get(`session-resumption/${encodeURIComponent(general)}`)).toBeUndefined()

      const retried = await h.call("resume", {
        workflowId: targetId,
        fromWorkflowId: sourceId,
      }, "general", general)
      expect(retried.status).toBe("resumed")
      expect(await h.durableStorage.get(`session/${general}`)).toBe(targetId)
    } finally {
      externalLease?.proc.stdin?.end()
      if (externalLease && externalLease.proc.exitCode === null) await once(externalLease.proc, "exit")
      if (migration && migration.exitCode === null) {
        await writeFile(migrationRelease, "cleanup")
        await migration.exited
      }
      if (resume && resume.exitCode === null) {
        await writeFile(resumeRelease, "cleanup")
        await resume.exited
      }
      h.restore()
    }
  })

  test("native and Code Mode invocations captured before attachment rotation fail closed after resume", async () => {
    const h = await harness()
    const createdAt = new Date().toISOString()
    try {
      for (const surface of ["native", "code"] as const) {
        const suffix = surface
        const general = `waiting-${suffix}-general`
        const sourceId = `waiting-${suffix}-source`
        const targetId = `waiting-${suffix}-target`
        const readyFile = join(h.root, `waiting-${suffix}-captured`)
        const releaseFile = join(h.root, `waiting-${suffix}-release`)
        await h.durableStorage.set(`workflow/${sourceId}`, {
          id: sourceId,
          projectId: h.runtime.projectId,
          revision: 1,
          anchor: `task:${sourceId}`,
          createdBySession: general,
          createdAt,
          steps: [{ id: "done", agent: "worker", kind: "work", dependsOn: [], status: "complete" }],
        })
        await h.durableStorage.set(`workflow/${targetId}`, {
          id: targetId,
          projectId: h.runtime.projectId,
          revision: 2,
          anchor: `task:${targetId}`,
          createdBySession: general,
          createdAt,
          steps: [{ id: "pending", agent: "worker", kind: "work", dependsOn: [], status: "pending" }],
        })
        await h.durableStorage.set(`session/${general}`, sourceId)
        await h.durableStorage.set(`session-attachment/${general}`, `waiting-${suffix}-old-attachment`)
        await h.durableStorage.set(`session-step/${general}`, "old-selector")
        await h.durableStorage.set(`session-step-attempt/${encodeURIComponent(general)}`, 2)
        await h.durableStorage.set(`session-oq/${general}`, "old-question")

        const waiting = spawnResumptionProcessFixture(h.root, {
          mode: surface === "native" ? "wait-native" : "wait-codemode",
          sessionID: general,
          agent: "general",
          toolName: "status",
          surface,
          readyFile,
          releaseFile,
          toolInput: { detail: true },
        })
        for (let attempt = 0; attempt < 1_000; attempt++) {
          try {
            await readFile(readyFile)
            break
          } catch (error: any) {
            if (error?.code !== "ENOENT") throw error
            if (attempt === 999) throw new Error(`${surface} invocation did not acknowledge its captured tuple.`)
            await Bun.sleep(5)
          }
        }

        const resume = spawnResumptionProcessFixture(h.root, {
          mode: "tool",
          sessionID: general,
          agent: "general",
          toolName: "resume",
          surface: "code",
          toolInput: { workflowId: targetId, fromWorkflowId: sourceId },
        })
        const resumed = await readResumptionProcessFixture(resume)
        expect(resumed.status).toBe("resumed")
        await writeFile(releaseFile, "resume committed; allow captured caller to revalidate")
        const stale = await readResumptionProcessFixture(waiting)
        expect(stale.thrown).toContain("attachment changed while this Loom invocation waited")
        expect(await h.durableStorage.get(`session/${general}`)).toBe(targetId)
        expect(await h.durableStorage.get(`session-attachment/${general}`)).not.toBe(`waiting-${suffix}-old-attachment`)
        expect(await h.durableStorage.get(`session-step/${general}`)).toBe("")
        expect(await h.durableStorage.get(`session-step-attempt/${encodeURIComponent(general)}`)).toBeNull()
        expect(await h.durableStorage.get(`session-oq/${general}`)).toBe("")
      }
    } finally {
      h.restore()
    }
  })

  test("serializes competing current-session start and resume decisions across processes", async () => {
    const h = await harness()
    const session = "resume-competing-general"
    const sourceId = "resume-competing-source"
    const targetId = "resume-competing-target"
    let lockProcess: ReturnType<typeof spawn> | undefined
    try {
      const createdAt = new Date().toISOString()
      await h.durableStorage.set(`workflow/${sourceId}`, {
        id: sourceId,
        projectId: h.runtime.projectId,
        revision: 1,
        anchor: "task:resume-competing-source",
        createdBySession: session,
        createdAt,
        steps: [{ id: "done", agent: "worker", kind: "work", dependsOn: [], status: "complete" }],
      })
      await h.durableStorage.set(`workflow/${targetId}`, {
        id: targetId,
        projectId: h.runtime.projectId,
        revision: 1,
        anchor: "task:resume-competing-target",
        createdBySession: session,
        createdAt,
        steps: [{ id: "pending", agent: "worker", kind: "work", dependsOn: [], status: "pending" }],
      })
      await h.durableStorage.set(`session/${session}`, sourceId)
      await h.durableStorage.set(`session-attachment/${session}`, "competing-before")
      const lockHash = createHash("sha256").update(session).digest("hex")
      const lockPath = join(
        h.runtime.runtimeRoot,
        "locks",
        h.runtime.installationId,
        h.runtime.projectId,
        "session-coordinator",
        `${lockHash}.lock`,
      )
      await mkdir(dirname(lockPath), { recursive: true, mode: 0o700 })
      lockProcess = spawn("flock", ["-x", lockPath, "sh", "-c", "printf 'locked\\n'; cat >/dev/null"], {
        stdio: ["pipe", "pipe", "pipe"],
      })
      let output = ""
      const lockReady = new Promise<void>((resolve, reject) => {
        lockProcess!.stdout!.setEncoding("utf8")
        lockProcess!.stdout!.on("data", (chunk: string) => {
          output += chunk
          if (output.includes("locked\n")) resolve()
        })
        lockProcess!.once("error", reject)
        lockProcess!.stderr!.on("data", (chunk) => reject(new Error(String(chunk))))
      })
      await lockReady

      const resume = h.call("resume", {
        workflowId: targetId,
        fromWorkflowId: sourceId,
      }, "general", session)
      const start = h.call("start", { request: "Start a fresh independent workflow." }, "general", session)
      await Bun.sleep(50)
      lockProcess.stdin!.end()
      await once(lockProcess, "exit")
      const [resumeResult, startResult] = await Promise.allSettled([resume, start])
      const resumed = resumeResult.status === "fulfilled" && resumeResult.value.status === "resumed"
      const started = startResult.status === "fulfilled" && startResult.value.status === "started"
      expect(Number(resumed) + Number(started)).toBe(1)
      const loser = resumed ? startResult : resumeResult
      if (loser.status === "fulfilled") {
        expect(loser.value.error).toContain("attachment changed while this Loom invocation waited")
      } else {
        expect(String(loser.reason)).toContain("attachment changed while this Loom invocation waited")
      }
      const current = await h.durableStorage.get(`session/${session}`)
      expect(current).toBe(resumed ? targetId : startResult.status === "fulfilled" ? startResult.value.workflowId : undefined)
      expect(await h.durableStorage.get(`session-attachment/${session}`)).not.toBe("competing-before")
      expect(await h.durableStorage.get(`session-step/${session}`)).toBe("")
      expect(await h.durableStorage.get(`session-step-attempt/${encodeURIComponent(session)}`)).toBeNull()
      expect(await h.durableStorage.get(`session-oq/${session}`)).toBe("")
    } finally {
      lockProcess?.stdin?.end()
      if (lockProcess && lockProcess.exitCode === null) await once(lockProcess, "exit")
      h.restore()
    }
  })

  test("session context tells Code Mode models to call native Loom tools directly", async () => {
    const { sessionHooks, durableStorage, restore } = await harness()
    try {
      const hook = sessionHooks.get("context")
      expect(hook).toBeDefined()
      const event = { system: [] as Array<{ type: string; text: string }> }
      await hook!(event)
      expect(event.system).toHaveLength(1)
      expect(event.system[0]?.text).toContain("loom_*")
      expect(event.system[0]?.text).toContain("two equivalent OpenCode surfaces")
      expect(event.system[0]?.text).toContain("tools.loom.code.*")
      expect(event.system[0]?.text).toContain("do not fall back to shell/filesystem discovery")
      expect(event.system[0]?.text).toContain("dashboard-first")
      expect(event.system[0]?.text).toContain("does not depend on model prose")
      expect(event.system[0]?.text).toContain("stable workflow dashboard URL")
      expect(event.system[0]?.text).toContain("Desktop browser preview is optional")
      expect(event.system[0]?.text).toContain("do not invoke tools.browser.preview")

      await hook!({
        sessionID: "authorization-session",
        system: [],
        messages: [{
          id: "real-user-message",
          role: "user",
          content: [{ type: "text", text: "keep going with the existing worker" }],
        }],
      })
      expect(await durableStorage.get("session-user-message/authorization-session")).toMatchObject({
        messageId: "real-user-message",
        text: "keep going with the existing worker",
      })

      await hook!({
        sessionID: "authorization-session",
        system: [],
        messages: [
          {
            id: "real-user-message",
            role: "user",
            content: [{ type: "text", text: "keep going with the existing worker" }],
          },
          {
            id: "synthetic-compaction-continue",
            role: "user",
            content: [{
              type: "text",
              text: "Continue if you have next steps, or stop and ask for clarification if you are unsure how to proceed.",
              synthetic: true,
              metadata: { compaction_continue: true },
            }],
          },
        ],
      })
      expect(await durableStorage.get("session-user-message/authorization-session")).toMatchObject({
        messageId: "real-user-message",
        text: "keep going with the existing worker",
      })
    } finally {
      restore()
    }
  })

  test("legacy Objective compatibility action is Objective-scoped, conditional, and self-completing", async () => {
    const h = await harness()
    const generalSession = "upgrade-general"
    const workerSession = "upgrade-worker"
    const workflowId = "upgrade-workflow"
    const objectiveId = "objective:docs/anchors/upgrade/anchor.md"
    try {
      const workflow = {
        id: workflowId,
        projectId: h.runtime.projectId,
        revision: 1,
        anchor: "docs/anchors/upgrade/anchor.md",
        createdBySession: generalSession,
        createdAt: "before-holistic-plan",
        work: { objectiveId, generation: 1 },
        steps: [
          {
            id: "plan",
            agent: "planner",
            kind: "work",
            dependsOn: [],
            status: "pending",
          },
        ],
      }
      const work: any = {
        objectiveId,
        anchor: workflow.anchor,
        title: "Upgrade",
        objectiveStatus: "active",
        version: 3,
        generation: 1,
        workflowIds: [workflowId],
        nodes: [
          {
            id: "phase:1:legacy",
            logicalId: "legacy",
            type: "phase",
            title: "Legacy",
            status: "active",
            generation: 1,
            createdAt: "old",
            updatedAt: "old",
          },
          {
            id: "wave:1:legacy/wave",
            logicalId: "wave",
            type: "wave",
            title: "Legacy wave",
            status: "pending",
            generation: 1,
            parentId: "phase:1:legacy",
            createdAt: "old",
            updatedAt: "old",
          },
          {
            id: "task:1:legacy",
            logicalId: "legacy",
            type: "task",
            title: "Legacy task",
            objective: "Finish legacy work",
            status: "pending",
            generation: 1,
            parentId: "wave:1:legacy/wave",
            dependsOn: [],
            createdAt: "old",
            updatedAt: "old",
          },
          {
            id: "task:1:completed",
            logicalId: "completed",
            type: "task",
            title: "Completed legacy task",
            objective: "Preserve completed legacy work",
            status: "complete",
            generation: 1,
            parentId: "wave:1:legacy/wave",
            dependsOn: [],
            result: {
              workflowId: "legacy-reviewed-workflow",
              summary: "Completed legacy behavior is already proven.",
              evidenceClaimIds: ["claim-legacy-complete"],
              completedAt: "before-holistic-plan",
            },
            createdAt: "old",
            updatedAt: "old",
          },
        ],
        createdAt: "old",
        updatedAt: "old",
      }

      await h.durableStorage.set(`workflow/${workflowId}`, workflow)
      await h.durableStorage.set(`session/${generalSession}`, workflowId)
      await h.durableStorage.set(`session/${workerSession}`, workflowId)
      await h.durableStorage.set(`work/${encodeURIComponent(objectiveId)}`, work)

      const context = h.sessionHooks.get("context")!
      const generalEvent = { sessionID: generalSession, system: [] as Array<{ type: string; text: string }> }
      await context(generalEvent)
      expect(generalEvent.system).toHaveLength(2)
      expect(generalEvent.system[1]?.text).toContain("loom_upgrade_status")

      const workerEvent = { sessionID: workerSession, system: [] as Array<{ type: string; text: string }> }
      await context(workerEvent)
      expect(workerEvent.system).toHaveLength(1)

      const generalStatus = await h.call("upgrade_status", {}, "general", generalSession)
      expect(generalStatus).toMatchObject({
        runtimeVersion: RUNTIME_STATE_VERSION,
        objectiveId,
        generation: 1,
        actions: [{
          id: "holistic-plan-adoption-v1",
          scope: "objective",
          status: "ready",
          owner: "general",
        }],
      })
      const workerStatus = await h.call("upgrade_status", {}, "worker", workerSession)
      expect(workerStatus.actions).toHaveLength(1)

      await h.durableStorage.set(`workflow/${workflowId}`, {
        ...workflow,
        steps: workflow.steps.map((step: any) => ({ ...step, status: "complete" })),
      })
      const terminalGeneralEvent = {
        sessionID: generalSession,
        system: [] as Array<{ type: string; text: string }>,
      }
      await context(terminalGeneralEvent)
      expect(terminalGeneralEvent.system).toHaveLength(2)
      expect(terminalGeneralEvent.system[1]?.text).toContain("loom_upgrade_status")
      await h.durableStorage.set(`workflow/${workflowId}`, workflow)

      const plannerGrant = await h.call("dispatch_grant", {
        workflowId,
        stepId: "plan",
      }, "general", generalSession)
      expect(plannerGrant.error).toBeUndefined()
      const plannerSession = "upgrade-planner"
      const attached = await h.call("attach", {
        workflowId,
        stepId: "plan",
        grantId: plannerGrant.grantId,
      }, "planner", plannerSession)
      expect(attached.error).toBeUndefined()
      expect(attached.upgradeActions).toMatchObject([{
        id: "holistic-plan-adoption-v1",
        status: "ready",
        scope: "objective",
        objectiveId,
      }])

      const adoptedTask = {
        id: "remaining",
        title: "Remaining rich-plan work",
        objective: "Finish the remaining accepted Objective.",
        rationale: "This is the remaining implementation contribution after preserved legacy work.",
        dependsOn: [],
        authorityRefs: [workflow.anchor],
        constraints: ["Preserve the already-proven legacy behavior."],
        acceptanceCriteria: ["The remaining Objective behavior is complete."],
        subtasks: [],
        integration: ["Compose with the preserved completed legacy behavior."],
        verify: ["Run the assembled Objective acceptance path."],
      }
      const adopted = await h.call("work_plan", {
        workflowId,
        expectedVersion: work.version,
        replaceReason: "Adopt holistic Plan semantics at the safe planning boundary.",
        goal: "Deliver the accepted Objective.",
        assumptions: [],
        outOfScope: [],
        authorityRefs: [workflow.anchor],
        obligations: [
          {
            id: "legacy-complete",
            sourceRef: workflow.anchor,
            statement: "Preserve the already-proven legacy behavior.",
            disposition: "already-satisfied",
            taskIds: [],
            verification: ["claim-legacy-complete"],
          },
          {
            id: "remaining",
            sourceRef: workflow.anchor,
            statement: "Finish the remaining accepted Objective behavior.",
            disposition: "implement",
            taskIds: ["remaining"],
            verification: ["Run the assembled Objective acceptance path."],
          },
        ],
        riskBoundaries: [{
          id: "remaining-integration",
          title: "Legacy integration boundary",
          description: "Remaining work must preserve and compose with completed legacy behavior.",
          taskIds: ["remaining"],
        }],
        acceptanceCoverage: [{
          id: "objective-acceptance",
          title: "Accepted Objective",
          criterion: "The assembled Objective works with preserved legacy behavior.",
          taskIds: ["remaining"],
        }],
        relationships: [],
        correctionRouting: [{
          condition: "Remaining decomposition is incomplete",
          routeTo: "planner",
          taskId: "remaining",
        }],
        phases: [{
          id: "remaining",
          title: "Remaining work",
          objective: "Finish the remaining Objective.",
          waves: [{
            id: "delivery",
            title: "Delivery",
            objective: "Deliver the remaining implementation contribution.",
            constraints: ["Do not rerun already-proven legacy work solely for migration."],
            tasks: [adoptedTask],
          }],
        }],
      }, "planner", plannerSession)
      expect(adopted.error).toBeUndefined()
      expect(adopted.generation).toBe(2)

      const adoptedWork: any = await h.durableStorage.get(`work/${encodeURIComponent(objectiveId)}`)
      expect(adoptedWork.plans.at(-1)).toMatchObject({ generation: 2, revision: 1 })
      expect(adoptedWork.nodes.find((node: any) => node.id === "task:1:completed")).toMatchObject({
        status: "complete",
        result: {
          workflowId: "legacy-reviewed-workflow",
          evidenceClaimIds: ["claim-legacy-complete"],
        },
      })

      const afterGeneral = { sessionID: generalSession, system: [] as Array<{ type: string; text: string }> }
      await context(afterGeneral)
      expect(afterGeneral.system).toHaveLength(1)
      expect((await h.call("upgrade_status", {}, "general", generalSession)).actions).toEqual([])
      expect((await h.call("upgrade_status", {}, "worker", workerSession)).actions).toEqual([])
    } finally {
      h.restore()
    }
  })

  test("deferred holistic-Plan adoption does not block Task-linked peer OQs from a legacy Wave", async () => {
    const h = await harness()
    const generalSession = "legacy-oq-general"
    const workerSession = "legacy-oq-worker"
    const architectSession = "legacy-oq-architect"
    const workflowId = "legacy-oq-workflow"
    const objectiveId = "objective:docs/anchors/legacy-oq/anchor.md"
    try {
      const legacyTask = {
        id: "legacy-task",
        title: "Legacy runtime Task",
        objective: "Finish the admitted legacy runtime path.",
        dependsOn: [],
        write: ["src/**"],
        skills: [],
        verify: ["bun test"],
      }
      const workflow: any = {
        id: workflowId,
        projectId: h.runtime.projectId,
        revision: 1,
        anchor: "docs/anchors/legacy-oq/anchor.md",
        createdBySession: generalSession,
        createdAt: "before-holistic-plan",
        work: { objectiveId, generation: 1 },
        steps: [{
          id: "task:legacy-task",
          agent: "worker",
          kind: "work",
          dependsOn: [],
          status: "pending",
          task: legacyTask,
        }],
      }
      const work: any = {
        objectiveId,
        anchor: workflow.anchor,
        title: "Legacy OQ",
        objectiveStatus: "active",
        version: 3,
        generation: 1,
        workflowIds: [workflowId],
        nodes: [
          {
            id: "phase:1:legacy",
            logicalId: "legacy",
            type: "phase",
            title: "Legacy",
            status: "active",
            generation: 1,
            createdAt: "old",
            updatedAt: "old",
          },
          {
            id: "wave:1:legacy/wave",
            logicalId: "wave",
            type: "wave",
            title: "Legacy wave",
            status: "active",
            generation: 1,
            parentId: "phase:1:legacy",
            claimedByWorkflowId: workflowId,
            createdAt: "old",
            updatedAt: "old",
          },
          {
            id: "task:1:legacy-task",
            logicalId: "legacy-task",
            type: "task",
            title: "Legacy runtime Task",
            objective: "Finish the admitted legacy runtime path.",
            status: "active",
            generation: 1,
            parentId: "wave:1:legacy/wave",
            dependsOn: [],
            claimedByWorkflowId: workflowId,
            createdAt: "old",
            updatedAt: "old",
          },
        ],
        createdAt: "old",
        updatedAt: "old",
      }

      await h.durableStorage.set(`workflow/${workflowId}`, workflow)
      await h.durableStorage.set(`work/${encodeURIComponent(objectiveId)}`, work)
      await h.durableStorage.set(`session/${generalSession}`, workflowId)
      await h.durableStorage.set(`session/${workerSession}`, workflowId)
      await h.durableStorage.set(`session-step/${workerSession}`, "task:legacy-task")

      const raised = await h.call("oq_raise", {
        workflowId,
        stepId: "task:legacy-task",
        question: "Which accepted recovery mechanism applies to this legacy Task?",
        responder: "architect",
        blocking: false,
      }, "worker", workerSession)
      expect(raised.error).toBeUndefined()
      expect(raised.question.work).toEqual({
        objectiveId,
        generation: 1,
        taskId: "legacy-task",
      })

      // The non-blocking OQ may outlive adoption. Its generation-1 Task is
      // historical/superseded but remains the provenance for this question.
      work.generation = 2
      for (const node of work.nodes) {
        node.status = "superseded"
        node.supersededByGeneration = 2
      }
      work.plans = [{
        generation: 2,
        revision: 1,
        amendments: [],
        goal: "Adopt the rich Plan after the legacy Wave.",
        assumptions: [],
        outOfScope: [],
        authorityRefs: [workflow.anchor],
        obligations: [],
        riskBoundaries: [],
        acceptanceCoverage: [],
        relationships: [],
        correctionRouting: [],
        phases: [],
      }]
      await h.durableStorage.set(`work/${encodeURIComponent(objectiveId)}`, work)

      const grant = await h.call("dispatch_grant", {
        workflowId,
        questionId: raised.question.id,
      }, "general", generalSession)
      expect(grant.error).toBeUndefined()
      const attached = await h.call("attach", {
        workflowId,
        questionId: raised.question.id,
        grantId: grant.grantId,
      }, "architect", architectSession)
      expect(attached.error).toBeUndefined()
      expect(attached.planContext).toBeUndefined()
      expect(attached.legacyTaskContext).toMatchObject({
        taskId: "legacy-task",
        title: "Legacy runtime Task",
        objective: "Finish the admitted legacy runtime path.",
        status: "superseded",
        dependsOn: [],
      })
    } finally {
      h.restore()
    }
  })

  test("resumed pre-upgrade OpenCode session automatically reconciles its ongoing workflow", async () => {
    const sessionID = "resumed-general-session"
    const workflowId = "legacy-workflow"
    const { call, restore } = await harness(async (storage) => {
      await storage.set(`session/${sessionID}`, workflowId)
      await storage.set(`workflow/${workflowId}`, {
        id: workflowId,
        anchor: "docs/anchors/leash-v1/anchor.md",
        createdBySession: sessionID,
        createdAt: "before-project-scoping",
        steps: [
          {
            id: "worker",
            agent: "worker",
            kind: "work",
            dependsOn: [],
            status: "pending",
          },
        ],
      })
      await storage.set(`budget/${workflowId}`, {
        totalDispatches: 0,
        byKey: {},
        seenDispatches: [],
        grants: [],
      })
    })

    try {
      const status = await call(
        "status",
        { workflowId, detail: true },
        "general",
        sessionID,
      )
      expect(status.error).toBeUndefined()
      expect(status.workflow).toMatchObject({
        id: workflowId,
        revision: 0,
      })
      expect(typeof status.workflow.projectId).toBe("string")

      const duplicateStart = await call(
        "start",
        { anchor: "docs/anchors/leash-v1/anchor.md" },
        "general",
        sessionID,
      )
      expect(duplicateStart.error).toContain("still bound to an active workflow")
    } finally {
      restore()
    }
  })

  test("secondary pre-upgrade session resumes through an already canonical workflow", async () => {
    const primarySession = "old-general"
    const secondarySession = "old-planner"
    const workflowId = "legacy-workflow"
    const { call, restore } = await harness(
      async (storage) => {
        await storage.set(`session/${primarySession}`, workflowId)
        await storage.set(`session/${secondarySession}`, workflowId)
        await storage.set(`session-step/${secondarySession}`, "plan")
        await storage.set(`workflow/${workflowId}`, {
          id: workflowId,
          anchor: "docs/anchors/leash-v1/anchor.md",
          createdBySession: primarySession,
          createdAt: "before-project-scoping",
          steps: [
            { id: "plan", agent: "planner", kind: "work", dependsOn: [], status: "pending" },
          ],
        })
      },
      (sessionID, projectID) =>
        sessionID === secondarySession
          ? { id: sessionID }
          : { id: sessionID, projectID },
    )

    try {
      const primary = await call("status", { workflowId, detail: true }, "general", primarySession)
      expect(primary.error).toBeUndefined()
      expect(typeof primary.workflow.projectId).toBe("string")

      const secondary = await call("status", { workflowId, detail: true }, "planner", secondarySession)
      expect(secondary.error).toBeUndefined()
      expect(secondary.workflow).toMatchObject({
        id: workflowId,
        projectId: primary.workflow.projectId,
      })
    } finally {
      restore()
    }
  })

  test("controlled canonical rebind survives restart without consulting stale legacy workflow authority", async () => {
    const sessionID = "rebound-general"
    const first = await harness(async (storage) => {
      await storage.set(`session/${sessionID}`, "legacy-workflow-a")
      await storage.set("workflow/legacy-workflow-a", {
        id: "legacy-workflow-a",
        anchor: "docs/anchors/a.md",
        createdBySession: sessionID,
        createdAt: "before-project-scoping",
        steps: [
          {
            id: "worker",
            agent: "worker",
            kind: "work",
            dependsOn: [],
            status: "complete",
          },
        ],
      })
    })

    try {
      const admitted = await first.call(
        "status",
        { workflowId: "legacy-workflow-a", detail: true },
        "general",
        sessionID,
      )
      expect(admitted.error).toBeUndefined()

      const rebound = await first.call(
        "start",
        { anchor: "docs/anchors/b.md" },
        "general",
        sessionID,
      )
      expect(rebound.error).toBeUndefined()
      const workflowB = String(rebound.workflowId)
      expect(workflowB).not.toBe("legacy-workflow-a")

      // Compatibility storage remains historical at A and gains stale data that
      // must not participate after the canonical Loom-controlled rebind to B.
      await first.storage.set(`session-intent/${sessionID}`, "legacy-intent-a")
      await first.storage.set("intent/legacy-intent-a", {
        id: "legacy-intent-a",
        state: "accepted",
      })
      await first.storage.set(`work/${encodeURIComponent("objective-b")}`, {
        objectiveId: "objective-b",
        title: "stale compatibility work",
      })

      const second = await harness(
        undefined,
        undefined,
        { root: first.root, storage: first.storage },
      )
      try {
        const afterRestart = await second.call(
          "status",
          { workflowId: workflowB, detail: true },
          "general",
          sessionID,
        )
        expect(afterRestart.error).toBeUndefined()
        expect(afterRestart.workflow.id).toBe(workflowB)

        const runtime = await resolveRuntimeIdentity(first.root, first.storage as any)
        const scoped = createProjectStorage(
          await createTransactionalStorage(runtime),
          runtime.projectId,
        )
        expect(await scoped.get(`session/${sessionID}`)).toBe(workflowB)
        expect(await scoped.get(`session-intent/${sessionID}`)).toBeUndefined()
        expect(await scoped.get("intent/legacy-intent-a")).toBeUndefined()
        expect(await scoped.get(`work/${encodeURIComponent("objective-b")}`)).toBeUndefined()

        const receipts = await scoped.scan({
          prefix: "installation/upgrade-reconciliation/legacy-session-v0-to-runtime-v1/",
        })
        expect(receipts.entries).toHaveLength(1)
        expect(receipts.entries[0].value).toMatchObject({
          workflowId: "legacy-workflow-a",
          provenance: "opencode-session-continuity",
        })
      } finally {
        second.restore()
      }
    } finally {
      first.restore()
    }
  })

  test("fresh Worker and Reviewer sessions share one workflow only through grant attachment", async () => {
    const { call, restore } = await harness()
    try {
      const started = await call(
        "start",
        { anchor: "docs/anchors/test/anchor.md" },
        "general",
        "general-session",
      )
      expect(started.error).toBeUndefined()
      const workflowId = String(started.workflowId)

      const routed = await call(
        "route",
        {
          humanFacing: false,
          behavioral: false,
          structural: false,
          externalUnknown: false,
          diagnostic: false,
          productOutcome: false,
          implementationRequested: true,
          executionDepth: "task",
        },
        "general",
        "general-session",
      )
      expect(routed.error).toBeUndefined()
      expect(routed.now).toEqual([{ step: "worker", agent: "worker" }])

      const scoped = await call(
        "task_scope",
        { workflowId, stepId: "worker", write: ["src/**"] },
        "general",
        "general-session",
      )
      expect(scoped.error).toBeUndefined()
      expect(scoped).toMatchObject({
        acceptedAuthority: "docs/anchors/test/anchor.md",
        scopeSemantics: "starting-expectation-with-runtime-elevation",
      })
      expect(scoped.acceptedOutcome).toBeUndefined()
      expect(scoped.scopeNote).toContain("acceptedAuthority identifies the governing source")

      const workerGrant = await call(
        "dispatch_grant",
        { workflowId, stepId: "worker" },
        "general",
        "general-session",
      )
      expect(workerGrant.expectedAgent).toBe("worker")

      const attachedWorker = await call(
        "attach",
        { grantId: workerGrant.grantId, workflowId, stepId: "worker" },
        "worker",
        "worker-session",
      )
      expect(attachedWorker).toMatchObject({
        attached: true,
        workflowId,
        stepId: "worker",
        acceptedAuthority: "docs/anchors/test/anchor.md",
        write: ["src/**"],
        scopeSemantics: "starting-expectation-with-runtime-elevation",
      })
      expect(attachedWorker.acceptedOutcome).toBeUndefined()
      expect(attachedWorker.scopeNote).toContain("acceptedAuthority identifies the governing source")

      const workerStatus = await call(
        "status",
        { workflowId, detail: true },
        "worker",
        "worker-session",
      )
      expect(workerStatus.error).toBeUndefined()
      expect(workerStatus.workflow?.id ?? workerStatus.summary?.workflowId).toBe(workflowId)

      const completed = await call(
        "complete",
        { workflowId, stepId: "worker", summary: "implementation complete" },
        "worker",
        "worker-session",
      )
      expect(completed.error).toBeUndefined()
      expect(completed.dagRunnable).toEqual([{ id: "review-implementation", agent: "reviewer" }])

      const reviewerGrant = await call(
        "dispatch_grant",
        { workflowId, stepId: "review-implementation" },
        "general",
        "general-session",
      )
      expect(reviewerGrant.expectedAgent).toBe("reviewer")

      const attachedReviewer = await call(
        "attach",
        { grantId: reviewerGrant.grantId, workflowId, stepId: "review-implementation" },
        "reviewer",
        "reviewer-session",
      )
      expect(attachedReviewer).toMatchObject({
        attached: true,
        workflowId,
        stepId: "review-implementation",
      })

      const reviewerStatus = await call(
        "status",
        { workflowId, detail: true },
        "reviewer",
        "reviewer-session",
      )
      expect(reviewerStatus.error).toBeUndefined()
      expect(reviewerStatus.workflow.steps.find((step: any) => step.id === "worker").status).toBe("complete")

      const otherStarted = await call(
        "start",
        { anchor: "docs/anchors/other/anchor.md" },
        "general",
        "other-general-session",
      )
      expect(otherStarted.error).toBeUndefined()
      expect(otherStarted.workflowId).not.toBe(workflowId)

      const unrelated = await call(
        "status",
        { workflowId, detail: true },
        "general",
        "other-general-session",
      )
      expect(unrelated.error).toContain("Workflow not found")
    } finally {
      restore()
    }
  })

  test("concurrent promotions to one destination serialize to one durable winner", async () => {
    const sourceBody = `---
type: report critic
title: Concurrent Promotion
description: Report used to verify one-winner promotion serialization.
tags: [report, critic, concurrency]
---

# Concurrent Promotion

Verdict: retained
`

    const { root, callObserved, durableStorage, restore } = await harness(async (_storage, root) => {
      await mkdir(join(root, "ephemeral-reports", "critic"), { recursive: true })
      await writeFile(join(root, "ephemeral-reports", "critic", "concurrent.md"), sourceBody)
    })

    try {
      const input = {
        source: "ephemeral-reports/critic/concurrent.md",
        destination: "docs/reports/critic/concurrent.md",
        reason: "Retain concurrency evidence.",
      }
      const results = await Promise.allSettled([
        callObserved("report_promote", input, "general", "general-a", "promotion-a"),
        callObserved("report_promote", input, "general", "general-b", "promotion-b"),
      ])

      expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1)
      expect(results.filter((result) => result.status === "rejected")).toHaveLength(1)
      expect(
        await readFile(join(root, "docs", "reports", "critic", "concurrent.md"), "utf8"),
      ).toBe(sourceBody)

      const promotions = (await durableStorage.scan({ prefix: "report-promotion/", limit: 100 })).entries
        .map((entry: any) => entry.value)
        .filter((value: any) => value?.destination === "docs/reports/critic/concurrent.md")
      expect(promotions.filter((value: any) => value.status === "completed")).toHaveLength(1)
      expect(promotions.filter((value: any) => value.status === "failed")).toHaveLength(1)
    } finally {
      restore()
    }
  })

  test("startup reconciles a report published before its pending audit could finalize", async () => {
    const sourceBody = `---
type: report critic
title: Crash Recovery Gate
description: Durable report used to verify interrupted promotion recovery.
tags: [report, critic, recovery]
---

# Crash Recovery Gate

Verdict: FAIL
`

    const first = await harness()
    try {
      await mkdir(join(first.root, "ephemeral-reports", "critic"), { recursive: true })
      await writeFile(
        join(first.root, "ephemeral-reports", "critic", "crash-recovery.md"),
        sourceBody,
      )

      const id = "crash-after-publish"
      const prepared = await prepareReportPromotion(
        first.root,
        {
          source: "ephemeral-reports/critic/crash-recovery.md",
          destination: "docs/reports/critic/crash-recovery.md",
          reason: "Retain recovery evidence.",
        },
        id,
      )
      const pending: ReportPromotionRecord = {
        id,
        status: "pending",
        source: prepared.source,
        destination: prepared.destination,
        reason: prepared.reason,
        actor: "general",
        startedAt: new Date().toISOString(),
        sha256: prepared.sha256,
        bytes: prepared.bytes.byteLength,
        authority: "unchanged",
      }
      await first.durableStorage.set(`report-promotion/${id}`, pending)
      await publishPreparedReport(prepared)
    } finally {
      first.restore()
    }

    const second = await harness(undefined, undefined, {
      root: first.root,
      storage: first.storage,
    })
    try {
      const recovered = await second.durableStorage.get("report-promotion/crash-after-publish") as any
      expect(recovered).toMatchObject({
        status: "completed",
        recovered: true,
        source: "ephemeral-reports/critic/crash-recovery.md",
        destination: "docs/reports/critic/crash-recovery.md",
        reason: "Retain recovery evidence.",
        authority: "unchanged",
      })
      expect(
        await second.durableStorage.get(
          "report-promotion-destination/" +
            encodeURIComponent("docs/reports/critic/crash-recovery.md"),
        ),
      ).toBe("crash-after-publish")
      expect(
        await readFile(
          join(second.root, "docs", "reports", "critic", "crash-recovery.md"),
          "utf8",
        ),
      ).toBe(sourceBody)
    } finally {
      second.restore()
    }
  })

  test("durable report promotion is General-only and direct durable report edits are denied", async () => {
    const sourceBody = `---
type: report critic
title: Readiness Gate
description: Failed gate retained for audit.
tags: [report, critic, readiness]
---

# Readiness Gate

Verdict: FAIL
`

    const { root, call, callObserved, permissionHooks, durableStorage, restore } = await harness(async (_storage, root) => {
      await mkdir(join(root, "ephemeral-reports", "critic"), { recursive: true })
      await writeFile(join(root, "ephemeral-reports", "critic", "readiness.md"), sourceBody)
    })

    try {
      await expect(
        callObserved(
          "report_promote",
          {
            source: "ephemeral-reports/critic/readiness.md",
            destination: "docs/reports/critic/denied.md",
            reason: "Retain explicit audit evidence.",
          },
          "critic",
          "critic-session",
          "call-report-denied",
        ),
      ).rejects.toThrow("Only General")

      const deniedEvidence = (await durableStorage.scan({ prefix: "evidence/", limit: 100 })).entries
        .map((entry: any) => entry.value)
        .find((value: any) => value?.tool === "loom_report_promote" && value?.sessionID === "critic-session")
      expect(deniedEvidence).toMatchObject({
        tool: "loom_report_promote",
        status: "error",
        path: "ephemeral-reports/critic/readiness.md",
        destination: "docs/reports/critic/denied.md",
      })

      await expect(
        callObserved(
          "report_promote",
          {
            source: "ephemeral-reports/critic/missing.md",
            destination: "docs/reports/critic/missing.md",
            reason: "Retain missing audit evidence.",
          },
          "general",
          "failed-general-session",
          "call-report-failed",
        ),
      ).rejects.toThrow()

      const failedPromotion = (await durableStorage.scan({ prefix: "report-promotion/", limit: 100 })).entries
        .map((entry: any) => entry.value)
        .find((value: any) => value?.source === "ephemeral-reports/critic/missing.md")
      expect(failedPromotion).toMatchObject({
        status: "failed",
        destination: "docs/reports/critic/missing.md",
        reason: "Retain missing audit evidence.",
        actor: "general",
        authority: "unchanged",
      })
      expect(typeof failedPromotion.error).toBe("string")

      const failedEvidence = (await durableStorage.scan({ prefix: "evidence/", limit: 100 })).entries
        .map((entry: any) => entry.value)
        .find((value: any) => value?.tool === "loom_report_promote" && value?.sessionID === "failed-general-session")
      expect(failedEvidence).toMatchObject({
        status: "error",
        path: "ephemeral-reports/critic/missing.md",
        destination: "docs/reports/critic/missing.md",
        reason: "Retain missing audit evidence.",
      })

      const promoted = await callObserved(
        "report_promote",
        {
          source: "ephemeral-reports/critic/readiness.md",
          destination: "docs/reports/critic/readiness.md",
          reason: "Retain explicit audit evidence.",
        },
        "general",
        "general-session",
        "call-report-success",
      )
      expect(promoted).toMatchObject({
        promoted: true,
        sourceRetained: true,
        authority: "unchanged",
        actor: "general",
      })
      expect(typeof promoted.promotionId).toBe("string")
      expect(typeof promoted.promotedAt).toBe("string")

      const promotionRecord = await durableStorage.get(`report-promotion/${promoted.promotionId}`) as any
      expect(promotionRecord).toMatchObject({
        id: promoted.promotionId,
        status: "completed",
        source: "ephemeral-reports/critic/readiness.md",
        destination: "docs/reports/critic/readiness.md",
        reason: "Retain explicit audit evidence.",
        actor: "general",
        sha256: promoted.sha256,
        authority: "unchanged",
      })

      const successEvidence = (await durableStorage.scan({ prefix: "evidence/", limit: 100 })).entries
        .map((entry: any) => entry.value)
        .find((value: any) => value?.tool === "loom_report_promote" && value?.sessionID === "general-session")
      expect(successEvidence).toMatchObject({
        status: "completed",
        reportPromotion: {
          id: promoted.promotionId,
          source: "ephemeral-reports/critic/readiness.md",
          destination: "docs/reports/critic/readiness.md",
          reason: "Retain explicit audit evidence.",
          sha256: promoted.sha256,
          actor: "general",
          authority: "unchanged",
        },
      })
      expect(
        await readFile(join(root, "docs", "reports", "critic", "readiness.md"), "utf8"),
      ).toBe(sourceBody)
      expect(
        await readFile(join(root, "ephemeral-reports", "critic", "readiness.md"), "utf8"),
      ).toBe(sourceBody)

      const evaluate = permissionHooks.get("evaluate")
      expect(evaluate).toBeDefined()

      const crossRoleEdit: any = {
        agent: "reviewer",
        action: "edit",
        resources: ["ephemeral-reports/critic/readiness.md"],
        sessionID: "reviewer-session",
      }
      await evaluate!(crossRoleEdit)
      expect(crossRoleEdit.effect).toBe("deny")
      expect(crossRoleEdit.message).toContain("producer-scoped")

      const ownRoleEdit: any = {
        agent: "reviewer",
        action: "edit",
        resources: ["ephemeral-reports/reviewer/review.md"],
        sessionID: "reviewer-session",
      }
      await evaluate!(ownRoleEdit)
      expect(ownRoleEdit.effect).toBeUndefined()

      const ephemeralShell: any = {
        agent: "general",
        action: "shell",
        resources: ["sed -i s/FAIL/PASS/ ephemeral-reports/critic/readiness.md"],
        sessionID: "general-session",
      }
      await evaluate!(ephemeralShell)
      expect(ephemeralShell.effect).toBe("deny")
      expect(ephemeralShell.message).toContain("Shell access to ephemeral report storage is blocked")

      const directEdit: any = {
        agent: "designer",
        action: "edit",
        resources: ["docs/reports/designer/validation.md"],
        sessionID: "designer-session",
      }
      await evaluate!(directEdit)
      expect(directEdit.effect).toBe("deny")
      expect(directEdit.message).toContain("promotion-only")


      const directShell: any = {
        agent: "critic",
        action: "shell",
        resources: [
          "cp ephemeral-reports/critic/readiness.md docs/reports/critic/readiness-copy.md",
        ],
        sessionID: "critic-session",
      }
      await evaluate!(directShell)
      expect(directShell.effect).toBe("deny")
      expect(directShell.message).toContain("Shell access to durable report storage is blocked")
    } finally {
      restore()
    }
  })

  test("bounded request workflows start without an Anchor and stay shallow", async () => {
    const { call, restore } = await harness()
    try {
      const started = await call(
        "start",
        { request: "Debug the frontend-to-backend call and identify why it returns 401." },
        "general",
        "bounded-task-session",
      )
      expect(started.error).toBeUndefined()
      expect(started.request).toContain("frontend-to-backend")
      expect(String(started.anchor)).toStartWith("task:")

      const routed = await call(
        "route",
        {
          humanFacing: false,
          behavioral: false,
          structural: false,
          externalUnknown: false,
          diagnostic: true,
          productOutcome: false,
          implementationRequested: false,
          executionDepth: "task",
        },
        "general",
        "bounded-task-session",
      )
      expect(routed.error).toBeUndefined()
      expect(routed.path.map((step: { step: string }) => step.step)).toEqual([
        "diagnostic",
        "review-task",
      ])
      expect(routed.path.some((step: { agent: string }) => step.agent === "worker")).toBe(false)
      expect(routed.path.some((step: { agent: string }) => step.agent === "planner")).toBe(false)
      expect(routed.path.some((step: { agent: string }) => step.agent === "critic")).toBe(false)
      expect(routed.continuation).toEqual({
        next: [{ step: "diagnostic", agent: "diagnostic" }],
        implementationRequested: false,
        workerPresent: false,
        instruction:
          "Issue loom_dispatch_grant for the exact runnable step, dispatch that owner, then call loom_status immediately after the child returns.",
      })
    } finally {
      restore()
    }
  })


  test("Worker can dispatch without guessed scope and self-elevate discovered files", async () => {
    const h = await harness()
    try {
      const generalSession = "scope-before-grant-general"
      const workerSession = "scope-before-grant-worker"
      const started = await h.call(
        "start",
        { request: "Apply one bounded implementation change." },
        "general",
        generalSession,
      )
      expect(started.error).toBeUndefined()
      const workflowId = String(started.workflowId)

      expect((await h.call(
        "route",
        {
          humanFacing: false,
          behavioral: false,
          structural: false,
          externalUnknown: false,
          diagnostic: false,
          productOutcome: false,
          implementationRequested: true,
          executionDepth: "task",
        },
        "general",
        generalSession,
      )).error).toBeUndefined()

      const grant = await h.call(
        "dispatch_grant",
        { workflowId, stepId: "worker" },
        "general",
        generalSession,
      )
      expect(grant.error).toBeUndefined()
      expect(grant.expectedAgent).toBe("worker")

      const evaluate = h.permissionHooks.get("evaluate")!
      const dispatch: any = {
        agent: "general",
        action: "subagent",
        resources: ["worker"],
        sessionID: generalSession,
        source: {
          messageID: "scope-before-grant-message",
          id: "scope-before-grant-dispatch",
        },
      }
      await evaluate(dispatch)
      expect(dispatch.effect).not.toBe("deny")

      const attached = await h.call(
        "attach",
        { grantId: grant.grantId, workflowId, stepId: "worker" },
        "worker",
        workerSession,
      )
      expect(attached.attached).toBe(true)

      const beforeElevation: any = {
        agent: "worker",
        action: "edit",
        resources: ["src/discovered.ts"],
        sessionID: workerSession,
        effect: "ask",
      }
      await evaluate(beforeElevation)
      expect(beforeElevation.effect).toBe("deny")
      expect(beforeElevation.message).toContain("loom_scope_elevate")

      const elevated = await h.call(
        "scope_elevate",
        {
          workflowId,
          stepId: "worker",
          paths: ["src/**"],
          reason: "Implementation discovery located the affected source package.",
        },
        "worker",
        workerSession,
      )
      expect(elevated.error).toBeUndefined()
      expect(elevated.status).toBe("granted")
      expect(elevated.continue).toBe(true)
      expect(elevated.scopeAdded).toEqual(["src/**"])
      expect(elevated.elevation.crossesRoleDefault).toBe(true)

      const afterElevation: any = {
        ...beforeElevation,
        effect: "ask",
      }
      await evaluate(afterElevation)
      expect(afterElevation.effect).not.toBe("deny")

      const status = await h.call(
        "scope_status",
        { workflowId, stepId: "worker" },
        "worker",
        workerSession,
      )
      expect(status.effectiveWrite).toEqual(["src/**"])
      expect(status.elevations).toHaveLength(1)
      expect(status.elevations[0].reason).toContain("Implementation discovery")
    } finally {
      h.restore()
    }
  })

  test("symlink aliases into .git remain target-bound hard boundaries", async () => {
    const h = await harness()
    try {
      await initializeGitFixture(h.root)
      const generalSession = "scope-git-alias-general"
      const childSession = "scope-git-alias-worker"
      const started = await h.call(
        "start",
        { request: "Implement one bounded change without rewriting Git internals." },
        "general",
        generalSession,
      )
      const workflowId = String(started.workflowId)
      expect((await h.call(
        "route",
        {
          humanFacing: false,
          behavioral: false,
          structural: false,
          externalUnknown: false,
          diagnostic: false,
          productOutcome: false,
          implementationRequested: true,
          executionDepth: "task",
        },
        "general",
        generalSession,
      )).error).toBeUndefined()

      const grant = await h.call(
        "dispatch_grant",
        { workflowId, stepId: "worker" },
        "general",
        generalSession,
      )
      expect((await h.call(
        "attach",
        { grantId: grant.grantId, workflowId, stepId: "worker" },
        "worker",
        childSession,
      )).attached).toBe(true)

      const alias = join(h.root, "git-internal-alias")
      const gitConfig = join(h.root, ".git", "config")
      await symlink(gitConfig, alias)

      const requested = await h.call(
        "scope_elevate",
        {
          workflowId,
          stepId: "worker",
          paths: ["git-internal-alias"],
          reason: "Attempt to mutate Git internal state through an alias.",
        },
        "worker",
        childSession,
      )
      expect(requested.status).toBe("user_authorization_required")
      expect(requested.continue).toBe(false)
      expect(requested.hardBoundary.boundaryDetails[0]).toMatchObject({
        kind: "repository-internal-state",
        resolvedExistingTarget: gitConfig,
      })
      expect(
        requested.hardBoundary.question.questions[0].question,
      ).toContain(gitConfig)

      const questionEvent = {
        tool: "question",
        callID: "scope-git-alias-question",
        messageID: "scope-git-alias-question-message",
        sessionID: generalSession,
        agent: "general",
        input: requested.hardBoundary.question,
      }
      await h.toolHooks.get("execute.before")!(questionEvent)
      await h.toolHooks.get("execute.after")!({
        ...questionEvent,
        status: "completed",
        result: { metadata: { answers: [["Allow once"]] } },
      })
      expect((await h.call(
        "scope_authorize_once",
        { workflowId, requestId: requested.hardBoundary.requestId },
        "general",
        generalSession,
      )).authorized).toBe(true)

      const beforeRetarget: any = {
        agent: "worker",
        action: "edit",
        resources: [alias],
        sessionID: childSession,
        effect: "ask",
      }
      await h.permissionHooks.get("evaluate")!(beforeRetarget)
      expect(beforeRetarget.effect).toBe("allow")

      await rm(alias, { force: true })
      await symlink(join(h.root, ".git", "HEAD"), alias)

      const afterRetarget: any = {
        ...beforeRetarget,
        effect: "ask",
      }
      await h.permissionHooks.get("evaluate")!(afterRetarget)
      expect(afterRetarget.effect).toBe("deny")
      expect(afterRetarget.message).toContain("loom_scope_elevate")
    } finally {
      h.restore()
    }
  })

  test("Loom internal project state is a user-only hard boundary", async () => {
    const h = await harness()
    try {
      const generalSession = "scope-loom-state-general"
      const childSession = "scope-loom-state-worker"
      const started = await h.call(
        "start",
        { request: "Implement one bounded change without rewriting Loom identity." },
        "general",
        generalSession,
      )
      const workflowId = String(started.workflowId)
      expect((await h.call(
        "route",
        {
          humanFacing: false,
          behavioral: false,
          structural: false,
          externalUnknown: false,
          diagnostic: false,
          productOutcome: false,
          implementationRequested: true,
          executionDepth: "task",
        },
        "general",
        generalSession,
      )).error).toBeUndefined()

      const grant = await h.call(
        "dispatch_grant",
        { workflowId, stepId: "worker" },
        "general",
        generalSession,
      )
      expect((await h.call(
        "attach",
        { grantId: grant.grantId, workflowId, stepId: "worker" },
        "worker",
        childSession,
      )).attached).toBe(true)

      const requested = await h.call(
        "scope_elevate",
        {
          workflowId,
          stepId: "worker",
          paths: [".loom/project-id"],
          reason: "Attempt to change Loom project identity.",
        },
        "worker",
        childSession,
      )
      expect(requested.status).toBe("user_authorization_required")
      expect(requested.continue).toBe(false)
      expect(requested.hardBoundary.boundaryDetails[0]).toMatchObject({
        kind: "loom-internal-state",
      })
      expect(
        requested.hardBoundary.question.questions[0].question,
      ).toContain("Loom internal project state")
      expect(requested.hardBoundary.rememberChoiceAllowed).toBe(false)
    } finally {
      h.restore()
    }
  })

  test("hard-boundary scope elevation forces an exact non-remembered user decision", async () => {
    const h = await harness()
    try {
      const generalSession = "scope-boundary-general"
      const childSession = "scope-boundary-specifier"
      const started = await h.call(
        "start",
        { request: "Specify one behavior and update an explicitly approved external schema if required." },
        "general",
        generalSession,
      )
      const workflowId = String(started.workflowId)
      expect((await h.call(
        "route",
        {
          humanFacing: false,
          behavioral: true,
          structural: false,
          externalUnknown: false,
          diagnostic: false,
          productOutcome: false,
          implementationRequested: true,
          executionDepth: "change",
        },
        "general",
        generalSession,
      )).error).toBeUndefined()

      const grant = await h.call(
        "dispatch_grant",
        { workflowId, stepId: "specifier" },
        "general",
        generalSession,
      )
      expect((await h.call(
        "attach",
        { grantId: grant.grantId, workflowId, stepId: "specifier" },
        "specifier",
        childSession,
      )).attached).toBe(true)

      const externalRoot = await mkdtemp(join(tmpdir(), "loom-hard-boundary-"))
      roots.push(externalRoot)
      const external = join(externalRoot, "schema.json")
      const requested = await h.call(
        "scope_elevate",
        {
          workflowId,
          stepId: "specifier",
          paths: [external],
          reason: "The accepted contract consumes this external schema.",
        },
        "specifier",
        childSession,
      )
      expect(requested.error).toBeUndefined()
      expect(requested.status).toBe("user_authorization_required")
      expect(requested.continue).toBe(false)
      expect(requested.requiredAction).toContain("Return control to General immediately")
      expect(requested.hardBoundary.rememberChoiceAllowed).toBe(false)
      expect(
        requested.hardBoundary.question.questions[0].options.map(
          (option: any) => option.label,
        ),
      ).toEqual(["Allow once", "Deny"])
      expect(requested.hardBoundary.question.questions[0].question).toContain(
        "never remembered",
      )

      const repeated = await h.call(
        "scope_elevate",
        {
          workflowId,
          stepId: "specifier",
          paths: [external],
          reason: "The accepted contract consumes this external schema.",
        },
        "specifier",
        childSession,
      )
      expect(repeated.continue).toBe(false)
      expect(repeated.hardBoundary.requestId).toBe(
        requested.hardBoundary.requestId,
      )

      const questionEvent = {
        tool: "question",
        callID: "scope-boundary-question-call",
        messageID: "scope-boundary-question-message",
        sessionID: generalSession,
        agent: "general",
        input: requested.hardBoundary.question,
      }
      await h.toolHooks.get("execute.before")!(questionEvent)
      await h.toolHooks.get("execute.after")!({
        ...questionEvent,
        status: "completed",
        result: { metadata: { answers: [["Allow once"]] } },
      })

      const authorized = await h.call(
        "scope_authorize_once",
        {
          workflowId,
          requestId: requested.hardBoundary.requestId,
        },
        "general",
        generalSession,
      )
      expect(authorized.error).toBeUndefined()
      expect(authorized.authorized).toBe(true)
      expect(authorized.rememberChoiceAllowed).toBe(false)

      const allowed: any = {
        agent: "specifier",
        action: "edit",
        resources: [external],
        sessionID: childSession,
        effect: "ask",
      }
      await h.permissionHooks.get("evaluate")!(allowed)
      expect(allowed.effect).toBe("allow")

      const externalEdit = {
        tool: "edit",
        callID: "scope-boundary-external-edit",
        messageID: "scope-boundary-external-edit-message",
        sessionID: childSession,
        agent: "specifier",
        input: {
          filePath: external,
          oldString: "",
          newString: "approved\n",
        },
      }
      await h.toolHooks.get("execute.before")!(externalEdit)
      await writeFile(external, "approved\n")
      await h.toolHooks.get("execute.after")!({
        ...externalEdit,
        status: "completed",
        result: "updated",
      })
      expect(await readFile(external, "utf8")).toBe("approved\n")
      const ownership = await h.durableStorage.get(
        `git-session-ownership/${encodeURIComponent(childSession)}`,
      ) as any
      expect(ownership?.paths ?? []).not.toContain(external)

      const differentExternal: any = {
        ...allowed,
        resources: [join(externalRoot, "different-external.json")],
        effect: "ask",
      }
      await h.permissionHooks.get("evaluate")!(differentExternal)
      expect(differentExternal.effect).toBe("deny")
      expect(differentExternal.message).toContain("loom_scope_elevate")

      expect((await h.call(
        "complete",
        {
          workflowId,
          stepId: "specifier",
          summary: "Hard-boundary access was approved but no external mutation was needed.",
        },
        "specifier",
        childSession,
      )).error).toBeUndefined()

      const lateExternalEdit = {
        tool: "edit",
        callID: "scope-boundary-late-edit",
        messageID: "scope-boundary-late-edit-message",
        sessionID: childSession,
        agent: "specifier",
        input: {
          filePath: external,
          oldString: "",
          newString: "late\n",
        },
      }
      await expect(
        h.toolHooks.get("execute.before")!(lateExternalEdit),
      ).rejects.toThrow("Hard-boundary mutation is not authorized")
    } finally {
      h.restore()
    }
  })


  test("project-relative symlink escape is a user-only hard boundary", async () => {
    const h = await harness()
    try {
      const externalRoot = await mkdtemp(join(tmpdir(), "loom-scope-external-"))
      const replacementExternalRoot = await mkdtemp(
        join(tmpdir(), "loom-scope-external-replacement-"),
      )
      roots.push(externalRoot, replacementExternalRoot)
      const linkedExternal = join(h.root, "linked-external")
      await symlink(externalRoot, linkedExternal, "dir")

      const generalSession = "scope-symlink-general"
      const childSession = "scope-symlink-specifier"
      const started = await h.call(
        "start",
        { request: "Specify one behavior without escaping the current project." },
        "general",
        generalSession,
      )
      const workflowId = String(started.workflowId)
      expect((await h.call(
        "route",
        {
          humanFacing: false,
          behavioral: true,
          structural: false,
          externalUnknown: false,
          diagnostic: false,
          productOutcome: false,
          implementationRequested: true,
          executionDepth: "change",
        },
        "general",
        generalSession,
      )).error).toBeUndefined()

      const grant = await h.call(
        "dispatch_grant",
        { workflowId, stepId: "specifier" },
        "general",
        generalSession,
      )
      expect((await h.call(
        "attach",
        { grantId: grant.grantId, workflowId, stepId: "specifier" },
        "specifier",
        childSession,
      )).attached).toBe(true)

      const requested = await h.call(
        "scope_elevate",
        {
          workflowId,
          stepId: "specifier",
          paths: ["linked-external/**"],
          reason: "Discovery found a path that looks project-local but resolves through a symlink.",
        },
        "specifier",
        childSession,
      )
      expect(requested.error).toBeUndefined()
      expect(requested.status).toBe("user_authorization_required")
      expect(requested.continue).toBe(false)
      expect(requested.hardBoundary.rememberChoiceAllowed).toBe(false)
      expect(requested.hardBoundary.paths[0]).toContain("linked-external")
      expect(requested.hardBoundary.boundaryDetails[0]).toMatchObject({
        kind: "symlink-escape",
        resolvedExistingTarget: externalRoot,
      })
      expect(
        requested.hardBoundary.question.questions[0].question,
      ).toContain(externalRoot)
      expect(
        requested.hardBoundary.question.questions[0].question,
      ).toContain("symlink escape")

      const questionEvent = {
        tool: "question",
        callID: "scope-symlink-question-call",
        messageID: "scope-symlink-question-message",
        sessionID: generalSession,
        agent: "general",
        input: requested.hardBoundary.question,
      }
      await h.toolHooks.get("execute.before")!(questionEvent)
      await h.toolHooks.get("execute.after")!({
        ...questionEvent,
        status: "completed",
        result: { metadata: { answers: [["Allow once"]] } },
      })
      expect((await h.call(
        "scope_authorize_once",
        {
          workflowId,
          requestId: requested.hardBoundary.requestId,
        },
        "general",
        generalSession,
      )).authorized).toBe(true)

      const targetFile = join(linkedExternal, "schema.json")
      const beforeRetarget: any = {
        agent: "specifier",
        action: "edit",
        resources: [targetFile],
        sessionID: childSession,
        effect: "ask",
      }
      await h.permissionHooks.get("evaluate")!(beforeRetarget)
      expect(beforeRetarget.effect).toBe("allow")

      await rm(linkedExternal, { force: true })
      await symlink(replacementExternalRoot, linkedExternal, "dir")

      const afterRetarget: any = {
        ...beforeRetarget,
        effect: "ask",
      }
      await h.permissionHooks.get("evaluate")!(afterRetarget)
      expect(afterRetarget.effect).toBe("deny")
      expect(afterRetarget.message).toContain("loom_scope_elevate")
    } finally {
      h.restore()
    }
  })

  test("completed task implementation may escalate to Change and resets implementation work", async () => {
    const { call, restore } = await harness()
    try {
      const started = await call(
        "start",
        { request: "Fix the local 401 bug in the frontend request." },
        "general",
        "escalation-general",
      )
      expect(started.error).toBeUndefined()
      const workflowId = String(started.workflowId)

      const initial = await call(
        "route",
        {
          humanFacing: false,
          behavioral: false,
          structural: false,
          externalUnknown: false,
          diagnostic: false,
          productOutcome: true,
          implementationRequested: true,
          executionDepth: "task",
        },
        "general",
        "escalation-general",
      )
      expect(initial.error).toBeUndefined()

      await call(
        "task_scope",
        { workflowId, stepId: "worker", write: ["src/frontend/**"] },
        "general",
        "escalation-general",
      )
      const grant = await call(
        "dispatch_grant",
        { workflowId, stepId: "worker" },
        "general",
        "escalation-general",
      )
      await call(
        "attach",
        { grantId: grant.grantId, workflowId, stepId: "worker" },
        "worker",
        "escalation-worker",
      )
      const completed = await call(
        "complete",
        { workflowId, stepId: "worker", summary: "Found shared auth boundary across callers." },
        "worker",
        "escalation-worker",
      )
      expect(completed.error).toBeUndefined()

      const escalated = await call(
        "route",
        {
          humanFacing: false,
          behavioral: false,
          structural: true,
          externalUnknown: false,
          diagnostic: false,
          productOutcome: true,
          implementationRequested: true,
          executionDepth: "change",
        },
        "general",
        "escalation-general",
      )
      expect(escalated.error).toBeUndefined()
      expect(escalated.path.map((step: { step: string }) => step.step)).toEqual([
        "architect",
        "review-architecture",
        "worker",
        "review-implementation",
        "knowledge-sync",
      ])

      const status = await call(
        "status",
        { workflowId, detail: true },
        "general",
        "escalation-general",
      )
      expect(status.workflow.steps.find((step: any) => step.id === "worker").status).toBe("pending")
      expect(status.workflow.steps.find((step: any) => step.id === "architect").status).toBe("pending")

      const scope = await call(
        "scope_status",
        { workflowId, stepId: "worker" },
        "general",
        "escalation-general",
      )
      expect(scope.scope).toBeNull()
    } finally {
      restore()
    }
  })

  test("objective route rejects productOutcome=false instead of silently degrading", async () => {
    const { call, restore } = await harness()
    try {
      const started = await call(
        "start",
        { anchor: "docs/anchors/test/anchor.md" },
        "general",
        "invalid-objective-session",
      )
      expect(started.error).toBeUndefined()

      const routed = await call(
        "route",
        {
          humanFacing: false,
          behavioral: false,
          structural: false,
          externalUnknown: false,
          diagnostic: false,
          productOutcome: false,
          implementationRequested: true,
          executionDepth: "objective",
        },
        "general",
        "invalid-objective-session",
      )
      expect(routed.error).toContain("Objective execution depth requires productOutcome=true")
    } finally {
      restore()
    }
  })


  test("completed read-only Task may promote to an implementation Change", async () => {
    const { call, restore } = await harness()
    try {
      const started = await call(
        "start",
        { request: "Function-test the overlay and report findings only." },
        "general",
        "readonly-escalation-general",
      )
      expect(started.error).toBeUndefined()
      const workflowId = String(started.workflowId)

      const initial = await call(
        "route",
        {
          humanFacing: false,
          behavioral: false,
          structural: false,
          externalUnknown: false,
          diagnostic: false,
          productOutcome: false,
          implementationRequested: false,
          executionDepth: "task",
        },
        "general",
        "readonly-escalation-general",
      )
      expect(initial.path.map((step: { step: string }) => step.step)).toEqual(["review-task"])

      const reviewGrant = await call(
        "dispatch_grant",
        { workflowId, stepId: "review-task" },
        "general",
        "readonly-escalation-general",
      )
      await call(
        "attach",
        { grantId: reviewGrant.grantId, workflowId, stepId: "review-task" },
        "reviewer",
        "readonly-escalation-reviewer",
      )
      const reviewed = await call(
        "complete",
        {
          workflowId,
          stepId: "review-task",
          outcome: "pass",
          summary: "Finding: shared overlay focus semantics are undefined.",
        },
        "reviewer",
        "readonly-escalation-reviewer",
      )
      expect(reviewed.error).toBeUndefined()

      const escalated = await call(
        "route",
        {
          humanFacing: true,
          behavioral: true,
          structural: false,
          externalUnknown: false,
          diagnostic: false,
          productOutcome: true,
          implementationRequested: true,
          executionDepth: "change",
        },
        "general",
        "readonly-escalation-general",
      )
      expect(escalated.error).toBeUndefined()
      expect(escalated.path.map((step: { step: string }) => step.step)).toEqual([
        "designer",
        "specifier",
        "review-think",
        "worker",
        "review-implementation",
      ])
      expect(escalated.now.map((step: { step: string }) => step.step).sort()).toEqual([
        "designer",
        "specifier",
      ])
    } finally {
      restore()
    }
  })


  test("conversational Research and Diagnostic are technically non-mutating", async () => {
    const { permissionHooks, restore } = await harness()
    try {
      const evaluate = permissionHooks.get("evaluate")
      expect(evaluate).toBeDefined()

      for (const [agent, command] of [
        ["research", "git status"],
        ["diagnostic", "rg failure src"],
      ] as const) {
        const safeShell: any = {
          agent,
          action: "shell",
          resources: [command],
          sessionID: `conversation-${agent}`,
          effect: "allow",
        }
        await evaluate!(safeShell)
        expect(safeShell.effect).toBe("allow")
      }

      for (const agent of ["research", "diagnostic"] as const) {
        const mutatingShell: any = {
          agent,
          action: "shell",
          resources: ["rm -f src/app.ts"],
          sessionID: `conversation-${agent}`,
          effect: "allow",
        }
        await evaluate!(mutatingShell)
        expect(mutatingShell.effect).toBe("deny")
        expect(mutatingShell.message).toContain("read-only")

        const productEdit: any = {
          agent,
          action: "edit",
          resources: ["src/app.ts"],
          sessionID: `conversation-${agent}`,
          effect: "allow",
        }
        await evaluate!(productEdit)
        expect(productEdit.effect).toBe("deny")
        expect(productEdit.message).toContain("product/repository edits require governed execution")

        const ownReportEdit: any = {
          agent,
          action: "edit",
          resources: [`ephemeral-reports/${agent}/finding.md`],
          sessionID: `conversation-${agent}`,
          effect: "allow",
        }
        await evaluate!(ownReportEdit)
        expect(ownReportEdit.effect).toBe("allow")

        const otherReportEdit: any = {
          agent,
          action: "edit",
          resources: [
            `ephemeral-reports/${agent === "research" ? "diagnostic" : "research"}/finding.md`,
          ],
          sessionID: `conversation-${agent}`,
          effect: "allow",
        }
        await evaluate!(otherReportEdit)
        expect(otherReportEdit.effect).toBe("deny")
      }
    } finally {
      restore()
    }
  })

  test("derives low-ceremony shell capability from the current role", async () => {
    const { call, permissionHooks, toolHooks, restore } = await harness()
    try {
      const evaluate = permissionHooks.get("evaluate")
      expect(evaluate).toBeDefined()

      const diagnostic: any = {
        agent: "diagnostic",
        action: "shell",
        resources: ["go test ./..."],
        sessionID: "conversation-diagnostic-execute",
        effect: "ask",
      }
      await evaluate!(diagnostic)
      expect(diagnostic.effect).toBe("allow")

      const conversationalRun: any = {
        agent: "diagnostic",
        action: "shell",
        resources: ["go run ./cmd/debug"],
        sessionID: "conversation-diagnostic-execute",
        effect: "ask",
      }
      await evaluate!(conversationalRun)
      expect(conversationalRun.effect).toBe("deny")
      expect(conversationalRun.message).toContain("governed Diagnostic step")

      const started = await call(
        "start",
        { request: "Diagnose one bounded runtime failure." },
        "general",
        "diagnostic-execution-general",
      )
      const workflowId = String(started.workflowId)
      expect((await call(
        "route",
        {
          humanFacing: false,
          behavioral: false,
          structural: false,
          externalUnknown: false,
          diagnostic: true,
          productOutcome: false,
          implementationRequested: false,
          executionDepth: "task",
        },
        "general",
        "diagnostic-execution-general",
      )).error).toBeUndefined()
      const diagnosticGrant = await call(
        "dispatch_grant",
        { workflowId, stepId: "diagnostic" },
        "general",
        "diagnostic-execution-general",
      )
      expect((await call(
        "attach",
        {
          grantId: diagnosticGrant.grantId,
          workflowId,
          stepId: "diagnostic",
        },
        "diagnostic",
        "governed-diagnostic-execute",
      )).attached).toBe(true)

      const governedRun: any = {
        agent: "diagnostic",
        action: "shell",
        resources: ["go run ./cmd/debug"],
        sessionID: "governed-diagnostic-execute",
        effect: "ask",
      }
      await evaluate!(governedRun)
      expect(governedRun.effect).toBe("allow")

      const diagnosticCommitScratch: any = {
        agent: "diagnostic",
        action: "edit",
        resources: [
          "ephemeral-reports/diagnostic/commit-messages/diagnosis.md",
        ],
        sessionID: "governed-diagnostic-execute",
        effect: "ask",
      }
      await evaluate!(diagnosticCommitScratch)
      expect(diagnosticCommitScratch.effect).toBe("deny")
      expect(diagnosticCommitScratch.message).toContain(
        "role that can own the repository commit",
      )

      const designStarted = await call(
        "start",
        { request: "Define one bounded user-facing change." },
        "general",
        "designer-general",
      )
      const designWorkflowId = String(designStarted.workflowId)
      expect((await call(
        "route",
        {
          humanFacing: true,
          behavioral: false,
          structural: false,
          externalUnknown: false,
          diagnostic: false,
          productOutcome: true,
          implementationRequested: true,
          executionDepth: "change",
        },
        "general",
        "designer-general",
      )).error).toBeUndefined()
      const designGrant = await call(
        "dispatch_grant",
        { workflowId: designWorkflowId, stepId: "designer" },
        "general",
        "designer-general",
      )
      expect((await call(
        "attach",
        {
          grantId: designGrant.grantId,
          workflowId: designWorkflowId,
          stepId: "designer",
        },
        "designer",
        "designer-author",
      )).attached).toBe(true)

      const designerEdit: any = {
        agent: "designer",
        action: "edit",
        resources: ["docs/design/runtime.md"],
        sessionID: "designer-author",
        effect: "ask",
      }
      await evaluate!(designerEdit)
      expect(designerEdit.effect).not.toBe("deny")
      await toolHooks.get("execute.before")?.({
        tool: "edit",
        callID: "designer-edit",
        sessionID: "designer-author",
        agent: "designer",
        input: { filePath: "docs/design/runtime.md" },
      })
      await toolHooks.get("execute.after")?.({
        tool: "edit",
        callID: "designer-edit",
        sessionID: "designer-author",
        agent: "designer",
        input: { filePath: "docs/design/runtime.md" },
        status: "completed",
        result: "updated",
      })

      const designerAdd: any = {
        agent: "designer",
        action: "shell",
        resources: ["git add docs/design/runtime.md"],
        sessionID: "designer-author",
        effect: "ask",
      }
      await evaluate!(designerAdd)
      expect(designerAdd.effect).toBe("allow")

      const designerCommitMessageEdit: any = {
        agent: "designer",
        action: "edit",
        resources: [
          "ephemeral-reports/designer/commit-messages/runtime.md",
        ],
        sessionID: "designer-author",
        effect: "ask",
      }
      await evaluate!(designerCommitMessageEdit)
      expect(designerCommitMessageEdit.effect).toBe("allow")

      const crossRoleCommitMessageEdit: any = {
        agent: "designer",
        action: "edit",
        resources: [
          "ephemeral-reports/specifier/commit-messages/runtime.md",
        ],
        sessionID: "designer-author",
        effect: "ask",
      }
      await evaluate!(crossRoleCommitMessageEdit)
      expect(crossRoleCommitMessageEdit.effect).toBe("deny")

      const crossRoleCommitMessageShell: any = {
        agent: "designer",
        action: "shell",
        resources: [
          "git -c core.hooksPath=/dev/null commit -F ephemeral-reports/specifier/commit-messages/runtime.md",
        ],
        sessionID: "designer-author",
        effect: "ask",
      }
      await evaluate!(crossRoleCommitMessageShell)
      expect(crossRoleCommitMessageShell.effect).toBe("deny")
      expect(crossRoleCommitMessageShell.message).toContain(
        "current role's ephemeral-reports/<role>/commit-messages/",
      )

      const designerOutside: any = {
        agent: "designer",
        action: "shell",
        resources: ["git add docs/requirements/runtime.md"],
        sessionID: "designer-author",
        effect: "ask",
      }
      await evaluate!(designerOutside)
      expect(designerOutside.effect).toBe("deny")

      const generalEdit: any = {
        agent: "general",
        action: "edit",
        resources: ["docs/anchors/runtime.md"],
        sessionID: "general-author",
        effect: "allow",
      }
      await evaluate!(generalEdit)
      expect(generalEdit.effect).not.toBe("deny")
      await toolHooks.get("execute.before")?.({
        tool: "edit",
        callID: "general-anchor-edit",
        sessionID: "general-author",
        agent: "general",
        input: { filePath: "docs/anchors/runtime.md" },
      })
      await toolHooks.get("execute.after")?.({
        tool: "edit",
        callID: "general-anchor-edit",
        sessionID: "general-author",
        agent: "general",
        input: { filePath: "docs/anchors/runtime.md" },
        status: "completed",
        result: "updated",
      })

      const generalOwnedAdd: any = {
        agent: "general",
        action: "shell",
        resources: ["git add docs/anchors/runtime.md"],
        sessionID: "general-author",
        effect: "ask",
      }
      await evaluate!(generalOwnedAdd)
      expect(generalOwnedAdd.effect).toBe("allow")

      const generalUnknownAdd: any = {
        agent: "general",
        action: "shell",
        resources: ["git add docs/anchors/unknown.md"],
        sessionID: "general-author",
        effect: "ask",
      }
      await evaluate!(generalUnknownAdd)
      expect(generalUnknownAdd.effect).toBe("deny")
      expect(generalUnknownAdd.message).toContain("exact bytes previously admitted")

      const unattachedWorker: any = {
        agent: "worker",
        action: "shell",
        resources: ["go test ./..."],
        sessionID: "unattached-worker-shell",
        effect: "ask",
      }
      await evaluate!(unattachedWorker)
      expect(unattachedWorker.effect).toBe("deny")
      expect(unattachedWorker.message).toContain("loom_attach")
    } finally {
      restore()
    }
  })

  test("Specifier starts with General's best-known scope and can elevate without returning", async () => {
    const h = await harness()
    try {
      await initializeGitFixture(h.root)
      const generalSession = "specifier-scope-general"
      const authorSession = "specifier-scope-author"
      const started = await h.call(
        "start",
        { request: "Specify one bounded lifecycle meaning." },
        "general",
        generalSession,
      )
      const workflowId = String(started.workflowId)
      expect((await h.call(
        "route",
        {
          humanFacing: false,
          behavioral: true,
          structural: false,
          externalUnknown: false,
          diagnostic: false,
          productOutcome: false,
          implementationRequested: true,
          executionDepth: "change",
        },
        "general",
        generalSession,
      )).error).toBeUndefined()

      const write = [
        "docs/requirements/lifecycle/br-050.md",
        "docs/requirements/lifecycle/oc-025.md",
        "docs/requirements/lifecycle/index.md",
      ]
      const scoped = await h.call(
        "step_scope",
        { workflowId, stepId: "specifier", write },
        "general",
        generalSession,
      )
      expect(scoped.error).toBeUndefined()
      expect(scoped.scope.write).toEqual(write)
      expect(scoped.roleWriteDefault).toEqual(["docs/requirements/**"])
      expect(scoped.scopeSemantics).toBe(
        "starting-expectation-with-runtime-elevation",
      )

      const grant = await h.call(
        "dispatch_grant",
        { workflowId, stepId: "specifier" },
        "general",
        generalSession,
      )
      const attached = await h.call(
        "attach",
        { grantId: grant.grantId, workflowId, stepId: "specifier" },
        "specifier",
        authorSession,
      )
      expect(attached.attached).toBe(true)
      expect(attached.write).toEqual(write)
      expect(attached.scopeSemantics).toBe(
        "starting-expectation-with-runtime-elevation",
      )

      const evaluate = h.permissionHooks.get("evaluate")!
      const discoveredRequirement = "docs/requirements/lifecycle/unassigned.md"
      const discoveredCode = "src/escaped.ts"
      for (const path of [discoveredRequirement, discoveredCode]) {
        const denied: any = {
          agent: "specifier",
          action: "edit",
          resources: [path],
          sessionID: authorSession,
          effect: "ask",
        }
        await evaluate(denied)
        expect(denied.effect).toBe("deny")
        expect(denied.message).toContain("loom_scope_elevate")
      }

      const elevated = await h.call(
        "scope_elevate",
        {
          workflowId,
          stepId: "specifier",
          paths: [discoveredRequirement, discoveredCode],
          reason: "Specification discovery exposed one additional requirement artifact and its generated consumer.",
        },
        "specifier",
        authorSession,
      )
      expect(elevated.status).toBe("granted")
      expect(elevated.continue).toBe(true)
      expect(elevated.elevation.crossesRoleDefault).toBe(true)

      for (const path of [discoveredRequirement, discoveredCode]) {
        const allowed: any = {
          agent: "specifier",
          action: "edit",
          resources: [path],
          sessionID: authorSession,
          effect: "ask",
        }
        await evaluate(allowed)
        expect(allowed.effect).not.toBe("deny")
      }

      await mkdir(join(h.root, "docs", "requirements", "lifecycle"), {
        recursive: true,
      })
      const editEvent = {
        tool: "edit",
        callID: "specifier-owned-edit",
        messageID: "specifier-owned-message",
        sessionID: authorSession,
        agent: "specifier",
        input: {
          filePath: join(h.root, write[0]),
          oldString: "",
          newString: "owned\n",
        },
      }
      await h.toolHooks.get("execute.before")!(editEvent)
      await writeFile(join(h.root, write[0]), "owned\n")
      await h.toolHooks.get("execute.after")!({
        ...editEvent,
        status: "completed",
        result: "updated",
      })

      const stageCommand =
        `git -c core.hooksPath=/dev/null add -- ${write[0]} && ` +
        "git diff --cached --check && git diff --cached --stat && git diff --cached"
      const stagePermission: any = {
        agent: "specifier",
        action: "shell",
        resources: [stageCommand],
        sessionID: authorSession,
        effect: "ask",
      }
      await evaluate(stagePermission)
      expect(stagePermission.effect).toBe("allow")
      const stageEvent = {
        tool: "shell",
        callID: "specifier-stage",
        messageID: "specifier-stage-message",
        sessionID: authorSession,
        agent: "specifier",
        input: { command: stageCommand },
      }
      await h.toolHooks.get("execute.before")!(stageEvent)
      await git(h.root, ["add", write[0]])
      await h.toolHooks.get("execute.after")!({
        ...stageEvent,
        status: "error",
        error: new Error("git diff --cached --check found a staged problem"),
      })

      // The chained inspection failed after git add changed the index. Loom
      // should retain the provable staged fingerprint instead of forcing an
      // otherwise unnecessary restage before commit.
      const commitCommand =
        "git -c core.hooksPath=/dev/null commit -m 'test: scoped specifier artifact'"
      const commitPermission: any = {
        agent: "specifier",
        action: "shell",
        resources: [commitCommand],
        sessionID: authorSession,
        effect: "ask",
      }
      await evaluate(commitPermission)
      expect(commitPermission.effect).toBe("allow")
      const commitEvent = {
        tool: "shell",
        callID: "specifier-commit",
        messageID: "specifier-commit-message",
        sessionID: authorSession,
        agent: "specifier",
        input: { command: commitCommand },
      }
      await h.toolHooks.get("execute.before")!(commitEvent)
      await git(h.root, [
        "-c",
        "core.hooksPath=/dev/null",
        "commit",
        "-m",
        "test: scoped specifier artifact",
        "-q",
      ])
      await h.toolHooks.get("execute.after")!({
        ...commitEvent,
        status: "completed",
        result: "committed",
      })

      expect((await h.call(
        "complete",
        { workflowId, stepId: "specifier", summary: "requirements committed" },
        "specifier",
        authorSession,
      )).error).toBeUndefined()
      expect((await h.call(
        "reopen",
        {
          workflowId,
          stepId: "specifier",
          reason: "new requirement evidence",
          newEvidence: true,
          changedHypothesis: false,
          changedStrategy: false,
          reducedUnresolved: false,
        },
        "general",
        generalSession,
      )).error).toBeUndefined()

      const freshGrant = await h.call(
        "dispatch_grant",
        { workflowId, stepId: "specifier" },
        "general",
        generalSession,
      )
      expect((await h.call(
        "attach",
        { grantId: freshGrant.grantId, workflowId, stepId: "specifier" },
        "specifier",
        authorSession,
      )).attempt).toBe(1)

      await writeFile(join(h.root, write[0]), "dirty-in-attempt-1\n")
      const priorAttemptStage: any = {
        agent: "specifier",
        action: "shell",
        resources: [`git add ${write[0]}`],
        sessionID: authorSession,
        effect: "ask",
      }
      await evaluate(priorAttemptStage)
      expect(priorAttemptStage.effect).toBe("deny")
      expect(priorAttemptStage.message).toContain("current Loom step attempt")
    } finally {
      h.restore()
    }
  })

  test("Reviewer authority gates scope and commit acceptance bookkeeping", async () => {
    const h = await harness()
    try {
      await initializeGitFixture(h.root)
      const requirementPath = "docs/requirements/recovery.md"
      const logPath = "docs/requirements/CHANGELOG.md"
      await mkdir(join(h.root, "docs", "requirements"), { recursive: true })
      await writeFile(
        join(h.root, requirementPath),
        "# Recovery\n\n**Status:** proposed\n\nRecovery semantics remain producer-owned.\n",
      )
      await writeFile(join(h.root, logPath), "# Requirements changelog\n")
      await writeFile(join(h.root, "src", "app.ts"), "export const app = true\n")
      await git(h.root, ["add", requirementPath, logPath, "src/app.ts"])
      await git(h.root, ["commit", "-m", "test: reviewer bookkeeping fixture", "-q"])
      await writeFile(join(h.root, "src", "app.ts"), "export const app = false\n")

      const generalSession = "reviewer-bookkeeping-general"
      const specifierSession = "reviewer-bookkeeping-specifier"
      const reviewerSession = "reviewer-bookkeeping-reviewer"
      const started = await h.call(
        "start",
        { request: "Specify and independently accept one bounded requirement." },
        "general",
        generalSession,
      )
      const workflowId = String(started.workflowId)
      expect((await h.call(
        "route",
        {
          humanFacing: false,
          behavioral: true,
          structural: false,
          externalUnknown: false,
          diagnostic: false,
          productOutcome: false,
          implementationRequested: false,
          executionDepth: "change",
        },
        "general",
        generalSession,
      )).error).toBeUndefined()

      const specifierGrant = await h.call(
        "dispatch_grant",
        { workflowId, stepId: "specifier" },
        "general",
        generalSession,
      )
      expect((await h.call(
        "attach",
        {
          grantId: specifierGrant.grantId,
          workflowId,
          stepId: "specifier",
        },
        "specifier",
        specifierSession,
      )).attached).toBe(true)
      expect((await h.call(
        "complete",
        {
          workflowId,
          stepId: "specifier",
          summary: "requirement ready for independent review",
        },
        "specifier",
        specifierSession,
      )).error).toBeUndefined()

      const reviewerGrant = await h.call(
        "dispatch_grant",
        { workflowId, stepId: "review-think" },
        "general",
        generalSession,
      )
      expect((await h.call(
        "attach",
        {
          grantId: reviewerGrant.grantId,
          workflowId,
          stepId: "review-think",
        },
        "reviewer",
        reviewerSession,
      )).attached).toBe(true)

      const scope = await h.call(
        "scope_status",
        { workflowId, stepId: "review-think" },
        "reviewer",
        reviewerSession,
      )
      expect(scope.roleWriteDefault).toEqual(["ephemeral-reports/reviewer/**"])
      expect(scope.effectiveWrite).toEqual([
        "docs/requirements/**",
        "ephemeral-reports/reviewer/**",
      ])

      const evaluate = h.permissionHooks.get("evaluate")!
      for (const path of [requirementPath, logPath]) {
        const bookkeepingEdit: any = {
          agent: "reviewer",
          action: "edit",
          resources: [path],
          sessionID: reviewerSession,
          effect: "ask",
        }
        await evaluate(bookkeepingEdit)
        expect(bookkeepingEdit.effect).not.toBe("deny")
      }

      for (const path of [
        "docs/design/recovery.md",
        "docs/architecture/runtime.md",
        "src/app.ts",
      ]) {
        const outsideEdit: any = {
          agent: "reviewer",
          action: "edit",
          resources: [path],
          sessionID: reviewerSession,
          effect: "ask",
        }
        await evaluate(outsideEdit)
        expect(outsideEdit.effect).toBe("deny")
        expect(outsideEdit.message).toContain("current Loom write scope")
      }

      const escaped = await h.call(
        "scope_elevate",
        {
          workflowId,
          stepId: "review-think",
          paths: ["src/app.ts"],
          reason: "Attempt to turn an acceptance review into implementation.",
        },
        "reviewer",
        reviewerSession,
      )
      expect(escaped.error).toContain("independent/advisory role")
      expect(escaped.roleWriteDefault).toEqual(["ephemeral-reports/reviewer/**"])

      const inventedLogPath = "docs/requirements/acceptance.md"
      const inventedLogEdit = {
        tool: "edit",
        callID: "reviewer-invented-log-edit",
        messageID: "reviewer-invented-log-edit-message",
        sessionID: reviewerSession,
        agent: "reviewer",
        input: { filePath: inventedLogPath, oldString: "", newString: "" },
      }
      await h.toolHooks.get("execute.before")!(inventedLogEdit)
      await writeFile(join(h.root, inventedLogPath), "# Acceptance\n- invented history\n")
      await h.toolHooks.get("execute.after")!({
        ...inventedLogEdit,
        status: "completed",
        result: "created",
      })
      const inventedLogStageCommand =
        `git -c core.hooksPath=/dev/null add -- ${inventedLogPath}`
      const inventedLogStagePermission: any = {
        agent: "reviewer",
        action: "shell",
        resources: [inventedLogStageCommand],
        sessionID: reviewerSession,
        effect: "ask",
      }
      await evaluate(inventedLogStagePermission)
      expect(inventedLogStagePermission.effect).toBe("allow")
      const inventedLogStageEvent = {
        tool: "shell",
        callID: "reviewer-invented-log-stage",
        messageID: "reviewer-invented-log-stage-message",
        sessionID: reviewerSession,
        agent: "reviewer",
        input: { command: inventedLogStageCommand },
      }
      await h.toolHooks.get("execute.before")!(inventedLogStageEvent)
      await git(h.root, ["add", inventedLogPath])
      await h.toolHooks.get("execute.after")!({
        ...inventedLogStageEvent,
        status: "completed",
        result: "staged",
      })
      const inventedLogCommitCommand =
        "git -c core.hooksPath=/dev/null commit -m 'docs: invent acceptance history'"
      const inventedLogCommit: any = {
        agent: "reviewer",
        action: "shell",
        resources: [inventedLogCommitCommand],
        sessionID: reviewerSession,
        effect: "ask",
      }
      await evaluate(inventedLogCommit)
      expect(inventedLogCommit.effect).toBe("deny")
      expect(inventedLogCommit.message).toContain(
        "acceptance/change/decision history file",
      )
      await git(h.root, ["restore", "--staged", "--", inventedLogPath])
      await rm(join(h.root, inventedLogPath), { force: true })

      const substantiveEditEvent = {
        tool: "edit",
        callID: "reviewer-substantive-edit",
        messageID: "reviewer-substantive-edit-message",
        sessionID: reviewerSession,
        agent: "reviewer",
        input: { filePath: requirementPath, oldString: "", newString: "" },
      }
      await h.toolHooks.get("execute.before")!(substantiveEditEvent)
      await writeFile(
        join(h.root, requirementPath),
        "# Recovery\n\n**Status:** accepted\n\nReviewer rewrote substantive semantics.\n",
      )
      await h.toolHooks.get("execute.after")!({
        ...substantiveEditEvent,
        status: "completed",
        result: "updated",
      })
      const substantiveStageCommand =
        `git -c core.hooksPath=/dev/null add -- ${requirementPath}`
      const substantiveStagePermission: any = {
        agent: "reviewer",
        action: "shell",
        resources: [substantiveStageCommand],
        sessionID: reviewerSession,
        effect: "ask",
      }
      await evaluate(substantiveStagePermission)
      expect(substantiveStagePermission.effect).toBe("allow")
      const substantiveStageEvent = {
        tool: "shell",
        callID: "reviewer-substantive-stage",
        messageID: "reviewer-substantive-stage-message",
        sessionID: reviewerSession,
        agent: "reviewer",
        input: { command: substantiveStageCommand },
      }
      await h.toolHooks.get("execute.before")!(substantiveStageEvent)
      await git(h.root, ["add", requirementPath])
      await h.toolHooks.get("execute.after")!({
        ...substantiveStageEvent,
        status: "completed",
        result: "staged",
      })

      const blockedCommitCommand =
        "git -c core.hooksPath=/dev/null commit -m 'docs: rewrite reviewed requirement'"
      const blockedCommit: any = {
        agent: "reviewer",
        action: "shell",
        resources: [blockedCommitCommand],
        sessionID: reviewerSession,
        effect: "ask",
      }
      await evaluate(blockedCommit)
      expect(blockedCommit.effect).toBe("deny")
      expect(blockedCommit.message).toContain(
        "substantive document content remains producer-owned",
      )

      await git(h.root, ["restore", "--staged", "--", requirementPath])
      await writeFile(
        join(h.root, requirementPath),
        "# Recovery\n\n**Status:** proposed\n\nRecovery semantics remain producer-owned.\n",
      )

      for (const [path, content, callID] of [
        [
          requirementPath,
          "# Recovery\n\n**Status:** accepted\n\nRecovery semantics remain producer-owned.\n",
          "reviewer-status-edit",
        ],
        [logPath, "# Requirements changelog\n- recovery accepted\n", "reviewer-log-edit"],
      ] as const) {
        const editEvent = {
          tool: "edit",
          callID,
          messageID: callID + "-message",
          sessionID: reviewerSession,
          agent: "reviewer",
          input: { filePath: path, oldString: "", newString: content },
        }
        await h.toolHooks.get("execute.before")!(editEvent)
        await writeFile(join(h.root, path), content)
        await h.toolHooks.get("execute.after")!({
          ...editEvent,
          status: "completed",
          result: "updated",
        })
      }

      const dirtyPass = await h.call(
        "complete",
        {
          workflowId,
          stepId: "review-think",
          outcome: "pass",
          summary: "authority accepted",
        },
        "reviewer",
        reviewerSession,
      )
      expect(dirtyPass.error).toContain(
        "Cannot complete while this role has uncommitted changes",
      )
      expect(dirtyPass.error).toContain(requirementPath)
      expect(dirtyPass.error).toContain(logPath)

      for (const [path, callID] of [
        [requirementPath, "reviewer-status-stage"],
        [logPath, "reviewer-log-stage"],
      ] as const) {
        const command = `git -c core.hooksPath=/dev/null add -- ${path}`
        const permission: any = {
          agent: "reviewer",
          action: "shell",
          resources: [command],
          sessionID: reviewerSession,
          effect: "ask",
        }
        await evaluate(permission)
        expect(permission.effect).toBe("allow")
        const stageEvent = {
          tool: "shell",
          callID,
          messageID: callID + "-message",
          sessionID: reviewerSession,
          agent: "reviewer",
          input: { command },
        }
        await h.toolHooks.get("execute.before")!(stageEvent)
        await git(h.root, ["add", path])
        await h.toolHooks.get("execute.after")!({
          ...stageEvent,
          status: "completed",
          result: "staged",
        })
      }

      const commitCommand =
        "git -c core.hooksPath=/dev/null commit -m 'docs: record reviewed acceptance'"
      const commitPermission: any = {
        agent: "reviewer",
        action: "shell",
        resources: [commitCommand],
        sessionID: reviewerSession,
        effect: "ask",
      }
      await evaluate(commitPermission)
      expect(commitPermission.effect).toBe("allow")
      const commitEvent = {
        tool: "shell",
        callID: "reviewer-bookkeeping-commit",
        messageID: "reviewer-bookkeeping-commit-message",
        sessionID: reviewerSession,
        agent: "reviewer",
        input: { command: commitCommand },
      }
      await h.toolHooks.get("execute.before")!(commitEvent)
      await git(h.root, [
        "-c",
        "core.hooksPath=/dev/null",
        "commit",
        "-m",
        "docs: record reviewed acceptance",
        "-q",
      ])
      await h.toolHooks.get("execute.after")!({
        ...commitEvent,
        status: "completed",
        result: "committed",
      })

      expect((await h.call(
        "complete",
        {
          workflowId,
          stepId: "review-think",
          outcome: "pass",
          summary: "authority accepted and bookkeeping committed",
        },
        "reviewer",
        reviewerSession,
      )).error).toBeUndefined()

      expect((await git(h.root, ["status", "--porcelain"])).stdout).toBe(
        " M src/app.ts\n",
      )
    } finally {
      h.restore()
    }
  })

  test("Reviewer acceptance scope is recomputed after reroute", async () => {
    const h = await harness()
    try {
      const generalSession = "reviewer-reroute-general"
      const specifierSession = "reviewer-reroute-specifier"
      const reviewerSession = "reviewer-reroute-reviewer"
      const started = await h.call(
        "start",
        { request: "Specify one bounded requirement, then narrow the workflow." },
        "general",
        generalSession,
      )
      const workflowId = String(started.workflowId)
      expect((await h.call(
        "route",
        {
          humanFacing: false,
          behavioral: true,
          structural: false,
          externalUnknown: false,
          diagnostic: false,
          productOutcome: false,
          implementationRequested: false,
          executionDepth: "change",
        },
        "general",
        generalSession,
      )).error).toBeUndefined()

      const specifierGrant = await h.call(
        "dispatch_grant",
        { workflowId, stepId: "specifier" },
        "general",
        generalSession,
      )
      expect((await h.call(
        "attach",
        { grantId: specifierGrant.grantId, workflowId, stepId: "specifier" },
        "specifier",
        specifierSession,
      )).attached).toBe(true)
      expect((await h.call(
        "complete",
        { workflowId, stepId: "specifier", summary: "requirements complete" },
        "specifier",
        specifierSession,
      )).error).toBeUndefined()

      const firstReviewerGrant = await h.call(
        "dispatch_grant",
        { workflowId, stepId: "review-think" },
        "general",
        generalSession,
      )
      expect((await h.call(
        "attach",
        { grantId: firstReviewerGrant.grantId, workflowId, stepId: "review-think" },
        "reviewer",
        reviewerSession,
      )).attached).toBe(true)
      const firstScope = await h.call(
        "scope_status",
        { workflowId, stepId: "review-think" },
        "reviewer",
        reviewerSession,
      )
      expect(firstScope.effectiveWrite).toEqual([
        "docs/requirements/**",
        "ephemeral-reports/reviewer/**",
      ])

      expect((await h.call(
        "complete",
        {
          workflowId,
          stepId: "review-think",
          outcome: "pass",
          summary: "requirements accepted",
        },
        "reviewer",
        reviewerSession,
      )).error).toBeUndefined()

      expect((await h.call(
        "route",
        {
          humanFacing: false,
          behavioral: false,
          structural: false,
          externalUnknown: true,
          diagnostic: false,
          productOutcome: false,
          implementationRequested: false,
          executionDepth: "change",
        },
        "general",
        generalSession,
      )).error).toBeUndefined()

      const researchGrant = await h.call(
        "dispatch_grant",
        { workflowId, stepId: "research" },
        "general",
        generalSession,
      )
      expect((await h.call(
        "attach",
        { grantId: researchGrant.grantId, workflowId, stepId: "research" },
        "research",
        "reviewer-reroute-research",
      )).attached).toBe(true)
      expect((await h.call(
        "complete",
        { workflowId, stepId: "research", summary: "research complete" },
        "research",
        "reviewer-reroute-research",
      )).error).toBeUndefined()

      const secondReviewerGrant = await h.call(
        "dispatch_grant",
        { workflowId, stepId: "review-think" },
        "general",
        generalSession,
      )
      expect((await h.call(
        "attach",
        { grantId: secondReviewerGrant.grantId, workflowId, stepId: "review-think" },
        "reviewer",
        reviewerSession,
      )).attached).toBe(true)
      const narrowed = await h.call(
        "scope_status",
        { workflowId, stepId: "review-think" },
        "reviewer",
        reviewerSession,
      )
      expect(narrowed.effectiveWrite).toEqual([
        "ephemeral-reports/reviewer/**",
      ])

      const staleAuthorityEdit: any = {
        agent: "reviewer",
        action: "edit",
        resources: ["docs/requirements/recovery.md"],
        sessionID: reviewerSession,
        effect: "ask",
      }
      await h.permissionHooks.get("evaluate")!(staleAuthorityEdit)
      expect(staleAuthorityEdit.effect).toBe("deny")
      expect(staleAuthorityEdit.message).toContain("current Loom write scope")
    } finally {
      h.restore()
    }
  })

  test("implementation review remains read-only for authority documents", async () => {
    const h = await harness()
    try {
      const generalSession = "reviewer-readonly-general"
      const workerSession = "reviewer-readonly-worker"
      const reviewerSession = "reviewer-readonly-reviewer"
      const started = await h.call(
        "start",
        { request: "Implement one bounded settled change." },
        "general",
        generalSession,
      )
      const workflowId = String(started.workflowId)
      expect((await h.call(
        "route",
        {
          humanFacing: false,
          behavioral: false,
          structural: false,
          externalUnknown: false,
          diagnostic: false,
          productOutcome: false,
          implementationRequested: true,
          executionDepth: "task",
        },
        "general",
        generalSession,
      )).error).toBeUndefined()

      const workerGrant = await h.call(
        "dispatch_grant",
        { workflowId, stepId: "worker" },
        "general",
        generalSession,
      )
      expect((await h.call(
        "attach",
        { grantId: workerGrant.grantId, workflowId, stepId: "worker" },
        "worker",
        workerSession,
      )).attached).toBe(true)
      expect((await h.call(
        "complete",
        { workflowId, stepId: "worker", summary: "implementation ready for review" },
        "worker",
        workerSession,
      )).error).toBeUndefined()

      const reviewerGrant = await h.call(
        "dispatch_grant",
        { workflowId, stepId: "review-implementation" },
        "general",
        generalSession,
      )
      expect((await h.call(
        "attach",
        {
          grantId: reviewerGrant.grantId,
          workflowId,
          stepId: "review-implementation",
        },
        "reviewer",
        reviewerSession,
      )).attached).toBe(true)

      const scope = await h.call(
        "scope_status",
        { workflowId, stepId: "review-implementation" },
        "reviewer",
        reviewerSession,
      )
      expect(scope.roleWriteDefault).toEqual(["ephemeral-reports/reviewer/**"])
      expect(scope.effectiveWrite).toEqual(["ephemeral-reports/reviewer/**"])

      const authorityEdit: any = {
        agent: "reviewer",
        action: "edit",
        resources: ["docs/requirements/recovery.md"],
        sessionID: reviewerSession,
        effect: "ask",
      }
      await h.permissionHooks.get("evaluate")!(authorityEdit)
      expect(authorityEdit.effect).toBe("deny")
      expect(authorityEdit.message).toContain("current Loom write scope")
    } finally {
      h.restore()
    }
  })

  test("fresh same-attempt Specifier automatically inherits exact admitted-byte staging authority", async () => {
    const h = await harness()
    try {
      await initializeGitFixture(h.root)
      const generalSession = "specifier-adopt-general"
      const firstSession = "specifier-adopt-first"
      const freshSession = "specifier-adopt-fresh"
      const started = await h.call(
        "start",
        { request: "Specify bounded lifecycle artifacts across a fresh specialist dispatch." },
        "general",
        generalSession,
      )
      const workflowId = String(started.workflowId)
      expect((await h.call(
        "route",
        {
          humanFacing: false,
          behavioral: true,
          structural: false,
          externalUnknown: false,
          diagnostic: false,
          productOutcome: false,
          implementationRequested: true,
          executionDepth: "change",
        },
        "general",
        generalSession,
      )).error).toBeUndefined()

      const write = [
        "docs/requirements/lifecycle/br-050.md",
        "docs/requirements/lifecycle/oc-025.md",
        "docs/requirements/lifecycle/index.md",
      ]
      expect((await h.call(
        "step_scope",
        { workflowId, stepId: "specifier", write },
        "general",
        generalSession,
      )).error).toBeUndefined()

      const firstGrant = await h.call(
        "dispatch_grant",
        { workflowId, stepId: "specifier" },
        "general",
        generalSession,
      )
      expect((await h.call(
        "attach",
        { grantId: firstGrant.grantId, workflowId, stepId: "specifier" },
        "specifier",
        firstSession,
      )).attached).toBe(true)

      await mkdir(join(h.root, "docs", "requirements", "lifecycle"), {
        recursive: true,
      })
      for (const [index, path] of write.entries()) {
        const editEvent = {
          tool: "edit",
          callID: `specifier-adopt-edit-${index}`,
          messageID: `specifier-adopt-message-${index}`,
          sessionID: firstSession,
          agent: "specifier",
          input: {
            filePath: join(h.root, path),
            oldString: "",
            newString: `owned-${index}\n`,
          },
        }
        await h.toolHooks.get("execute.before")!(editEvent)
        await writeFile(join(h.root, path), `owned-${index}\n`)
        await h.toolHooks.get("execute.after")!({
          ...editEvent,
          status: "completed",
          result: "updated",
        })
      }

      const evaluate = h.permissionHooks.get("evaluate")!
      const firstStageCommand = `git add -- ${write[0]}`
      const firstStagePermission: any = {
        agent: "specifier",
        action: "shell",
        resources: [firstStageCommand],
        sessionID: firstSession,
        effect: "ask",
      }
      await evaluate(firstStagePermission)
      expect(firstStagePermission.effect).toBe("allow")
      const firstStageEvent = {
        tool: "shell",
        callID: "specifier-adopt-first-stage",
        messageID: "specifier-adopt-first-stage-message",
        sessionID: firstSession,
        agent: "specifier",
        input: { command: firstStageCommand },
      }
      await h.toolHooks.get("execute.before")!(firstStageEvent)
      await git(h.root, ["add", "--", write[0]])
      await h.toolHooks.get("execute.after")!({
        ...firstStageEvent,
        status: "completed",
        result: "staged",
      })

      const freshGrant = await h.call(
        "dispatch_grant",
        { workflowId, stepId: "specifier" },
        "general",
        generalSession,
      )
      const attached = await h.call(
        "attach",
        { grantId: freshGrant.grantId, workflowId, stepId: "specifier" },
        "specifier",
        freshSession,
      )
      expect(attached.attached).toBe(true)
      expect(attached.attempt).toBe(0)

      await h.durableStorage.set(
        `git-session-ownership/${encodeURIComponent(freshSession)}`,
        {
          schemaVersion: 3,
          paths: [],
          worktreeFingerprints: {},
          stagedFingerprints: {},
        },
      )

      const inheritedCommand = `git add -- ${write.slice(1).join(" ")}`
      const inherited: any = {
        agent: "specifier",
        action: "shell",
        resources: [inheritedCommand],
        sessionID: freshSession,
        effect: "ask",
      }
      await evaluate(inherited)
      expect(inherited.effect).toBe("allow")
      const inheritedEvent = {
        tool: "shell",
        callID: "specifier-adopt-fresh-stage",
        messageID: "specifier-adopt-fresh-stage-message",
        sessionID: freshSession,
        agent: "specifier",
        input: { command: inheritedCommand },
      }
      await h.toolHooks.get("execute.before")!(inheritedEvent)
      const adoptedOwnership = await h.durableStorage.get(
        `git-session-ownership/${encodeURIComponent(freshSession)}`,
      ) as any
      expect(adoptedOwnership.stagedFingerprints[write[0]]).toBeDefined()
      await git(h.root, ["add", "--", ...write.slice(1)])
      await h.toolHooks.get("execute.after")!({
        ...inheritedEvent,
        status: "completed",
        result: "staged",
      })

      await writeFile(join(h.root, write[1]), "changed-outside-admission\n")
      const changed: any = {
        agent: "specifier",
        action: "shell",
        resources: [`git add -- ${write[1]}`],
        sessionID: freshSession,
        effect: "ask",
      }
      await evaluate(changed)
      expect(changed.effect).toBe("deny")
      expect(changed.message).toContain("changed after")

      const unproven = "docs/requirements/lifecycle/unproven.md"
      const elevated = await h.call(
        "scope_elevate",
        {
          workflowId,
          stepId: "specifier",
          paths: [unproven],
          reason: "A newly discovered requirement artifact is needed.",
        },
        "specifier",
        freshSession,
      )
      expect(elevated.status).toBe("granted")
      expect(elevated.continue).toBe(true)
      await writeFile(join(h.root, unproven), "unproven\n")

      const noProvenance: any = {
        agent: "specifier",
        action: "shell",
        resources: [`git add -- ${unproven}`],
        sessionID: freshSession,
        effect: "ask",
      }
      await evaluate(noProvenance)
      expect(noProvenance.effect).toBe("deny")
      expect(noProvenance.message).toContain("exact bytes previously admitted")
    } finally {
      h.restore()
    }
  })

  test("same-attempt stale staged bytes cannot commit after a fresher admitted mutation", async () => {
    const h = await harness()
    try {
      await initializeGitFixture(h.root)
      const generalSession = "same-attempt-stale-general"
      const firstSession = "same-attempt-stale-first"
      const freshSession = "same-attempt-stale-fresh"
      const started = await h.call(
        "start",
        { request: "Specify one requirement across a redispatch." },
        "general",
        generalSession,
      )
      const workflowId = String(started.workflowId)
      expect((await h.call(
        "route",
        {
          humanFacing: false,
          behavioral: true,
          structural: false,
          externalUnknown: false,
          diagnostic: false,
          productOutcome: false,
          implementationRequested: true,
          executionDepth: "change",
        },
        "general",
        generalSession,
      )).error).toBeUndefined()

      const path = "docs/requirements/same-attempt.md"
      expect((await h.call(
        "step_scope",
        { workflowId, stepId: "specifier", write: [path] },
        "general",
        generalSession,
      )).error).toBeUndefined()

      const firstGrant = await h.call(
        "dispatch_grant",
        { workflowId, stepId: "specifier" },
        "general",
        generalSession,
      )
      expect((await h.call(
        "attach",
        { grantId: firstGrant.grantId, workflowId, stepId: "specifier" },
        "specifier",
        firstSession,
      )).attached).toBe(true)

      await mkdir(join(h.root, "docs", "requirements"), { recursive: true })
      const firstEdit = {
        tool: "edit",
        callID: "same-attempt-first-edit",
        messageID: "same-attempt-first-edit-message",
        sessionID: firstSession,
        agent: "specifier",
        input: {
          filePath: join(h.root, path),
          oldString: "",
          newString: "v1\n",
        },
      }
      await h.toolHooks.get("execute.before")!(firstEdit)
      await writeFile(join(h.root, path), "v1\n")
      await h.toolHooks.get("execute.after")!({
        ...firstEdit,
        status: "completed",
        result: "updated",
      })

      const stageCommand = `git add -- ${path}`
      const stageEvent = {
        tool: "shell",
        callID: "same-attempt-first-stage",
        messageID: "same-attempt-first-stage-message",
        sessionID: firstSession,
        agent: "specifier",
        input: { command: stageCommand },
      }
      const stagePermission: any = {
        agent: "specifier",
        action: "shell",
        resources: [stageCommand],
        sessionID: firstSession,
        effect: "ask",
      }
      await h.permissionHooks.get("evaluate")!(stagePermission)
      expect(stagePermission.effect).toBe("allow")
      await h.toolHooks.get("execute.before")!(stageEvent)
      await git(h.root, ["add", "--", path])
      await h.toolHooks.get("execute.after")!({
        ...stageEvent,
        status: "completed",
        result: "staged",
      })

      const freshGrant = await h.call(
        "dispatch_grant",
        { workflowId, stepId: "specifier" },
        "general",
        generalSession,
      )
      expect((await h.call(
        "attach",
        { grantId: freshGrant.grantId, workflowId, stepId: "specifier" },
        "specifier",
        freshSession,
      )).attached).toBe(true)

      const freshEdit = {
        tool: "edit",
        callID: "same-attempt-fresh-edit",
        messageID: "same-attempt-fresh-edit-message",
        sessionID: freshSession,
        agent: "specifier",
        input: {
          filePath: join(h.root, path),
          oldString: "v1\n",
          newString: "v2\n",
        },
      }
      await h.toolHooks.get("execute.before")!(freshEdit)
      await writeFile(join(h.root, path), "v2\n")
      await h.toolHooks.get("execute.after")!({
        ...freshEdit,
        status: "completed",
        result: "updated",
      })

      const commitCommand =
        "git -c core.hooksPath=/dev/null commit -m 'test: stale same-attempt bytes'"
      const staleCommit: any = {
        agent: "specifier",
        action: "shell",
        resources: [commitCommand],
        sessionID: firstSession,
        effect: "ask",
      }
      await h.permissionHooks.get("evaluate")!(staleCommit)
      expect(staleCommit.effect).toBe("deny")
      expect(staleCommit.message).toContain("newer unstaged worktree changes")
    } finally {
      h.restore()
    }
  })

  test("migrates matching legacy Git ownership without losing in-flight authorship", async () => {
    const h = await harness()
    try {
      await initializeGitFixture(h.root)
      const generalSession = "legacy-ownership-general"
      const childSession = "legacy-ownership-specifier"
      const started = await h.call(
        "start",
        { request: "Preserve one in-flight requirements artifact across runtime upgrade." },
        "general",
        generalSession,
      )
      const workflowId = String(started.workflowId)
      expect((await h.call(
        "route",
        {
          humanFacing: false,
          behavioral: true,
          structural: false,
          externalUnknown: false,
          diagnostic: false,
          productOutcome: false,
          implementationRequested: true,
          executionDepth: "change",
        },
        "general",
        generalSession,
      )).error).toBeUndefined()

      const path = "docs/requirements/lifecycle/br-legacy.md"
      expect((await h.call(
        "step_scope",
        { workflowId, stepId: "specifier", write: [path] },
        "general",
        generalSession,
      )).error).toBeUndefined()
      const grant = await h.call(
        "dispatch_grant",
        { workflowId, stepId: "specifier" },
        "general",
        generalSession,
      )
      expect((await h.call(
        "attach",
        { grantId: grant.grantId, workflowId, stepId: "specifier" },
        "specifier",
        childSession,
      )).attached).toBe(true)

      await mkdir(join(h.root, "docs", "requirements", "lifecycle"), { recursive: true })
      await writeFile(join(h.root, path), "legacy-owned\n")
      const attachmentId = await h.durableStorage.get(
        `session-attachment/${childSession}`,
      )
      const info = await stat(join(h.root, path))
      const hash = createHash("sha256")
        .update("file\0")
        .update(String(info.mode))
        .update("\0")
        .update(await readFile(join(h.root, path)))
        .digest("hex")
      await h.durableStorage.set(
        `git-session-ownership/${encodeURIComponent(childSession)}`,
        {
          schemaVersion: 2,
          attachmentId,
          paths: [path],
          worktreeFingerprints: { [path]: hash },
          stagedFingerprints: {},
        },
      )

      const stage: any = {
        agent: "specifier",
        action: "shell",
        resources: [`git add ${path}`],
        sessionID: childSession,
        effect: "ask",
      }
      await h.permissionHooks.get("evaluate")!(stage)
      expect(stage.effect).toBe("allow")

      const migrated = await h.durableStorage.get(
        `git-session-ownership/${encodeURIComponent(childSession)}`,
      ) as any
      expect(migrated).toMatchObject({
        schemaVersion: 3,
        paths: [path],
      })
      expect(migrated.authorityId).toContain(
        `step:${encodeURIComponent(workflowId)}:specifier:0`,
      )

      // Migration of a still-valid legacy ownership record also seeds the
      // step-attempt provenance ledger, so a fresh child can continue the
      // same pending step without user-authorized break-glass recovery.
      const freshSession = "legacy-ownership-specifier-fresh"
      const freshGrant = await h.call(
        "dispatch_grant",
        { workflowId, stepId: "specifier" },
        "general",
        generalSession,
      )
      expect((await h.call(
        "attach",
        { grantId: freshGrant.grantId, workflowId, stepId: "specifier" },
        "specifier",
        freshSession,
      )).attached).toBe(true)

      const freshStage: any = {
        agent: "specifier",
        action: "shell",
        resources: [`git add ${path}`],
        sessionID: freshSession,
        effect: "ask",
      }
      await h.permissionHooks.get("evaluate")!(freshStage)
      expect(freshStage.effect).toBe("allow")
    } finally {
      h.restore()
    }
  })

  test("General can recover lost same-attempt specialist Git authorship with exact user authority", async () => {
    const h = await harness()
    try {
      await initializeGitFixture(h.root)
      const generalSession = "specifier-recovery-general"
      const childSession = "specifier-recovery-author"
      const started = await h.call(
        "start",
        { request: "Recover one bounded requirements artifact after provenance loss." },
        "general",
        generalSession,
      )
      const workflowId = String(started.workflowId)
      expect((await h.call(
        "route",
        {
          humanFacing: false,
          behavioral: true,
          structural: false,
          externalUnknown: false,
          diagnostic: false,
          productOutcome: false,
          implementationRequested: true,
          executionDepth: "change",
        },
        "general",
        generalSession,
      )).error).toBeUndefined()

      const path = "docs/requirements/lifecycle/br-050.md"
      const secondPath = "docs/requirements/lifecycle/oc-025.md"
      expect((await h.call(
        "step_scope",
        { workflowId, stepId: "specifier", write: [path, secondPath] },
        "general",
        generalSession,
      )).error).toBeUndefined()
      const grant = await h.call(
        "dispatch_grant",
        { workflowId, stepId: "specifier" },
        "general",
        generalSession,
      )
      expect((await h.call(
        "attach",
        { grantId: grant.grantId, workflowId, stepId: "specifier" },
        "specifier",
        childSession,
      )).attached).toBe(true)

      await mkdir(join(h.root, "docs", "requirements", "lifecycle"), { recursive: true })
      const editEvent = {
        tool: "edit",
        callID: "specifier-recovery-edit",
        messageID: "specifier-recovery-edit-message",
        sessionID: childSession,
        agent: "specifier",
        input: { filePath: join(h.root, path), oldString: "", newString: "owned\n" },
      }
      await h.toolHooks.get("execute.before")!(editEvent)
      await writeFile(join(h.root, path), "owned\n")
      await h.toolHooks.get("execute.after")!({
        ...editEvent,
        status: "completed",
        result: "updated",
      })

      // Emulate the pre-fix guard having erased the session's ownership record
      // after a fresh attachment.
      await h.durableStorage.set(
        `git-session-ownership/${encodeURIComponent(childSession)}`,
        {
          schemaVersion: 2,
          attachmentId: "lost-attachment",
          paths: [],
          worktreeFingerprints: {},
          stagedFingerprints: {},
        },
      )
      // Session-cache loss alone is no longer a provenance failure: the same
      // step attempt can recover exact admitted bytes automatically. Simulate
      // the actual break-glass condition by deleting the durable admitted-byte
      // record as well.
      const provenanceKey = [
        "git-step-attempt-owned",
        encodeURIComponent(workflowId),
        encodeURIComponent("specifier"),
        "0",
        encodeURIComponent(path),
      ].join("/")
      expect(await h.durableStorage.delete?.(provenanceKey)).toBe(true)

      const evaluate = h.permissionHooks.get("evaluate")!
      const deniedStage: any = {
        agent: "specifier",
        action: "shell",
        resources: [`git add ${path}`],
        sessionID: childSession,
        effect: "ask",
      }
      await evaluate(deniedStage)
      expect(deniedStage.effect).toBe("deny")
      expect(deniedStage.message).toContain("exact bytes previously admitted")

      const confirmation = "Recover Git ownership for this exact Specifier file."
      await h.sessionHooks.get("context")!({
        sessionID: generalSession,
        system: [],
        messages: [{
          id: "git-recovery-user-message",
          role: "user",
          content: [{ type: "text", text: confirmation }],
        }],
      })

      const before = await readFile(join(h.root, path), "utf8")

      const wrongConfirmation = await h.call(
        "git_ownership_recover",
        {
          workflowId,
          stepId: "specifier",
          targetSessionId: childSession,
          paths: [path],
          reason: "Wrong confirmation must fail.",
          confirmation: "not the user's message",
        },
        "general",
        generalSession,
      )
      expect(wrongConfirmation.error).toContain("must match the latest observed user message exactly")

      const outsidePath = "docs/requirements/lifecycle/outside.md"
      await writeFile(join(h.root, outsidePath), "outside\n")
      const outsideScope = await h.call(
        "git_ownership_recover",
        {
          workflowId,
          stepId: "specifier",
          targetSessionId: childSession,
          paths: [outsidePath],
          reason: "Scope escape must fail.",
          confirmation,
        },
        "general",
        generalSession,
      )
      expect(outsideScope.error).toContain("current committable Loom write scope")

      const recovered = await h.call(
        "git_ownership_recover",
        {
          workflowId,
          stepId: "specifier",
          targetSessionId: childSession,
          paths: [path],
          reason: "Regression recovery for ownership erased by attachment rotation.",
          confirmation,
        },
        "general",
        generalSession,
      )
      expect(recovered.error).toBeUndefined()
      expect(recovered.recovered).toBe(true)
      expect(recovered.reusedAuthorization).toBe(false)
      expect(recovered.paths).toEqual([path])
      expect(recovered.authorityId).toContain(`step:${encodeURIComponent(workflowId)}:specifier:0`)
      expect(await readFile(join(h.root, path), "utf8")).toBe(before)
      expect((await git(h.root, ["diff", "--cached", "--name-only"])).stdout.trim()).toBe("")

      const allowedStage: any = {
        agent: "specifier",
        action: "shell",
        resources: [`git add ${path}`],
        sessionID: childSession,
        effect: "ask",
      }
      await evaluate(allowedStage)
      expect(allowedStage.effect).toBe("allow")

      const replay = await h.call(
        "git_ownership_recover",
        {
          workflowId,
          stepId: "specifier",
          targetSessionId: childSession,
          paths: [path],
          reason: "Idempotent retry.",
          confirmation,
        },
        "general",
        generalSession,
      )
      expect(replay.error).toBeUndefined()
      expect(replay.reusedAuthorization).toBe(true)

      await writeFile(join(h.root, secondPath), "second-owned\n")
      const differentRequest = await h.call(
        "git_ownership_recover",
        {
          workflowId,
          stepId: "specifier",
          targetSessionId: childSession,
          paths: [secondPath],
          reason: "One user message must not authorize a different recovery.",
          confirmation,
        },
        "general",
        generalSession,
      )
      expect(differentRequest.error).toContain("already used for a different Git ownership recovery")

      await writeFile(join(h.root, path), "changed-after-recovery\n")
      const changedReplay = await h.call(
        "git_ownership_recover",
        {
          workflowId,
          stepId: "specifier",
          targetSessionId: childSession,
          paths: [path],
          reason: "Must not adopt changed bytes.",
          confirmation,
        },
        "general",
        generalSession,
      )
      expect(changedReplay.error).toContain("changed after this user authorization")

      await writeFile(join(h.root, path), "owned\n")
      await git(h.root, ["add", path])
      const stagedRecovery = await h.call(
        "git_ownership_recover",
        {
          workflowId,
          stepId: "specifier",
          targetSessionId: childSession,
          paths: [path],
          reason: "Already-staged paths must not be adopted.",
          confirmation,
        },
        "general",
        generalSession,
      )
      expect(stagedRecovery.error).toContain("refuses already-staged paths")
    } finally {
      h.restore()
    }
  })

  test("recovered same-attempt provenance is stageable from a fresh Specifier session", async () => {
    const h = await harness()
    try {
      await initializeGitFixture(h.root)
      const generalSession = "specifier-recovered-redispatch-general"
      const authorSession = "specifier-recovered-redispatch-author"
      const freshSession = "specifier-recovered-redispatch-fresh"
      const started = await h.call(
        "start",
        { request: "Recover and commit stranded lifecycle requirements after a guard defect." },
        "general",
        generalSession,
      )
      const workflowId = String(started.workflowId)
      expect((await h.call(
        "route",
        {
          humanFacing: false,
          behavioral: true,
          structural: false,
          externalUnknown: false,
          diagnostic: false,
          productOutcome: false,
          implementationRequested: true,
          executionDepth: "change",
        },
        "general",
        generalSession,
      )).error).toBeUndefined()

      const write = [
        "docs/requirements/lifecycle/br-050.md",
        "docs/requirements/lifecycle/oc-025.md",
        "docs/requirements/lifecycle/index.md",
      ]
      expect((await h.call(
        "step_scope",
        { workflowId, stepId: "specifier", write },
        "general",
        generalSession,
      )).error).toBeUndefined()
      const initialGrant = await h.call(
        "dispatch_grant",
        { workflowId, stepId: "specifier" },
        "general",
        generalSession,
      )
      expect((await h.call(
        "attach",
        { grantId: initialGrant.grantId, workflowId, stepId: "specifier" },
        "specifier",
        authorSession,
      )).attached).toBe(true)

      await mkdir(join(h.root, "docs", "requirements", "lifecycle"), {
        recursive: true,
      })
      for (const [index, path] of write.entries()) {
        await writeFile(join(h.root, path), `stranded-${index}\n`)
      }

      const confirmation =
        "Recover these exact stranded Specifier requirement files."
      await h.sessionHooks.get("context")!({
        sessionID: generalSession,
        system: [],
        messages: [{
          id: "specifier-recovered-redispatch-user-message",
          role: "user",
          content: [{ type: "text", text: confirmation }],
        }],
      })
      const recovered = await h.call(
        "git_ownership_recover",
        {
          workflowId,
          stepId: "specifier",
          targetSessionId: authorSession,
          paths: write,
          reason: "Recover exact current fingerprints after the historical guard defect.",
          confirmation,
        },
        "general",
        generalSession,
      )
      expect(recovered.error).toBeUndefined()
      expect(recovered.recovered).toBe(true)

      const freshGrant = await h.call(
        "dispatch_grant",
        { workflowId, stepId: "specifier" },
        "general",
        generalSession,
      )
      expect((await h.call(
        "attach",
        { grantId: freshGrant.grantId, workflowId, stepId: "specifier" },
        "specifier",
        freshSession,
      )).attached).toBe(true)

      await h.durableStorage.set(
        `git-session-ownership/${encodeURIComponent(freshSession)}`,
        {
          schemaVersion: 3,
          paths: [],
          worktreeFingerprints: {},
          stagedFingerprints: {},
        },
      )

      const command = `git add -- ${write.join(" ")}`
      const permission: any = {
        agent: "specifier",
        action: "shell",
        resources: [command],
        sessionID: freshSession,
        effect: "ask",
      }
      await h.permissionHooks.get("evaluate")!(permission)
      expect(permission.effect).toBe("allow")

      await writeFile(join(h.root, write[0]), "changed-after-recovery\n")
      const changed: any = {
        agent: "specifier",
        action: "shell",
        resources: [`git add -- ${write[0]}`],
        sessionID: freshSession,
        effect: "ask",
      }
      await h.permissionHooks.get("evaluate")!(changed)
      expect(changed.effect).toBe("deny")
      expect(changed.message).toContain("changed after")
    } finally {
      h.restore()
    }
  })

  test("specialist completion rechecks repository cleanliness after an active mutation", async () => {
    const h = await harness()
    try {
      await initializeGitFixture(h.root)
      const started = await h.call(
        "start",
        { request: "Specify one bounded lifecycle meaning." },
        "general",
        "specifier-completion-general",
      )
      const workflowId = String(started.workflowId)
      expect((await h.call(
        "route",
        {
          humanFacing: false,
          behavioral: true,
          structural: false,
          externalUnknown: false,
          diagnostic: false,
          productOutcome: false,
          implementationRequested: true,
          executionDepth: "change",
        },
        "general",
        "specifier-completion-general",
      )).error).toBeUndefined()

      const path = "docs/requirements/lifecycle/racing-completion.md"
      expect((await h.call(
        "step_scope",
        { workflowId, stepId: "specifier", write: [path] },
        "general",
        "specifier-completion-general",
      )).error).toBeUndefined()
      const grant = await h.call(
        "dispatch_grant",
        { workflowId, stepId: "specifier" },
        "general",
        "specifier-completion-general",
      )
      expect((await h.call(
        "attach",
        { grantId: grant.grantId, workflowId, stepId: "specifier" },
        "specifier",
        "specifier-completion-author",
      )).attached).toBe(true)

      await mkdir(join(h.root, "docs", "requirements", "lifecycle"), { recursive: true })
      const editEvent = {
        tool: "edit",
        callID: "specifier-completion-active-edit",
        messageID: "specifier-completion-message",
        sessionID: "specifier-completion-author",
        agent: "specifier",
        input: {
          filePath: join(h.root, path),
          oldString: "",
          newString: "dirty\n",
        },
      }
      await h.toolHooks.get("execute.before")!(editEvent)

      let completionSettled = false
      const completionPromise = h.call(
        "complete",
        { workflowId, stepId: "specifier", summary: "must wait for active edit" },
        "specifier",
        "specifier-completion-author",
      ).then((result: any) => {
        completionSettled = true
        return result
      })
      await new Promise((resolve) => setTimeout(resolve, 30))
      expect(completionSettled).toBe(false)

      await writeFile(join(h.root, path), "dirty\n")
      await h.toolHooks.get("execute.after")!({
        ...editEvent,
        status: "completed",
        result: "updated",
      })

      const completion = await completionPromise
      expect(completion.error).toContain("uncommitted changes")
      expect(completion.error).toContain(path)
    } finally {
      h.restore()
    }
  })

  test("completed specialist step loses mutation authority until reopened", async () => {
    const h = await harness()
    try {
      await initializeGitFixture(h.root)
      const generalSession = "completed-authority-general"
      const childSession = "completed-authority-specifier"
      const started = await h.call(
        "start",
        { request: "Specify one bounded lifecycle behavior." },
        "general",
        generalSession,
      )
      const workflowId = String(started.workflowId)
      expect((await h.call(
        "route",
        {
          humanFacing: false,
          behavioral: true,
          structural: false,
          externalUnknown: false,
          diagnostic: false,
          productOutcome: false,
          implementationRequested: true,
          executionDepth: "change",
        },
        "general",
        generalSession,
      )).error).toBeUndefined()

      const grant = await h.call(
        "dispatch_grant",
        { workflowId, stepId: "specifier" },
        "general",
        generalSession,
      )
      expect((await h.call(
        "attach",
        { grantId: grant.grantId, workflowId, stepId: "specifier" },
        "specifier",
        childSession,
      )).attached).toBe(true)

      const evaluate = h.permissionHooks.get("evaluate")!
      const before: any = {
        agent: "specifier",
        action: "edit",
        resources: ["docs/requirements/post-complete.md"],
        sessionID: childSession,
        effect: "ask",
      }
      await evaluate(before)
      expect(before.effect).not.toBe("deny")

      expect((await h.call(
        "complete",
        {
          workflowId,
          stepId: "specifier",
          summary: "Specification step completed without repository mutation.",
        },
        "specifier",
        childSession,
      )).error).toBeUndefined()

      const after: any = { ...before, effect: "ask" }
      await evaluate(after)
      expect(after.effect).toBe("deny")
      expect(after.message).toContain("current runnable Loom step attempt")

      const elevation = await h.call(
        "scope_elevate",
        {
          workflowId,
          stepId: "specifier",
          paths: ["docs/requirements/after-complete.md"],
          reason: "Attempted late write after completion.",
        },
        "specifier",
        childSession,
      )
      expect(elevation.error).toContain("currently runnable pending step")

      const stage: any = {
        agent: "specifier",
        action: "shell",
        resources: ["git add docs/requirements/post-complete.md"],
        sessionID: childSession,
        effect: "ask",
      }
      await evaluate(stage)
      expect(stage.effect).toBe("deny")
      expect(stage.message).toContain("current runnable Loom step attempt")
    } finally {
      h.restore()
    }
  })

  test("reopened scoped Research cannot fall back to its broader report ceiling", async () => {
    const h = await harness()
    try {
      const started = await h.call(
        "start",
        { request: "Research one bounded external fact." },
        "general",
        "research-scope-general",
      )
      const workflowId = String(started.workflowId)
      expect((await h.call(
        "route",
        {
          humanFacing: false,
          behavioral: false,
          structural: false,
          externalUnknown: true,
          diagnostic: false,
          productOutcome: false,
          implementationRequested: false,
          executionDepth: "task",
        },
        "general",
        "research-scope-general",
      )).error).toBeUndefined()

      const assigned = "ephemeral-reports/research/assigned.md"
      const invalidProductScope = await h.call(
        "step_scope",
        {
          workflowId,
          stepId: "research",
          write: ["src/research-should-not-edit.ts"],
        },
        "general",
        "research-scope-general",
      )
      expect(invalidProductScope.error).toContain("independent/advisory role")

      expect((await h.call(
        "step_scope",
        { workflowId, stepId: "research", write: [assigned] },
        "general",
        "research-scope-general",
      )).error).toBeUndefined()

      const grant = await h.call(
        "dispatch_grant",
        { workflowId, stepId: "research" },
        "general",
        "research-scope-general",
      )
      expect((await h.call(
        "attach",
        { grantId: grant.grantId, workflowId, stepId: "research" },
        "research",
        "research-scope-author",
      )).attached).toBe(true)

      const evaluate = h.permissionHooks.get("evaluate")!
      const current: any = {
        agent: "research",
        action: "edit",
        resources: [assigned],
        sessionID: "research-scope-author",
        effect: "ask",
      }
      await evaluate(current)
      expect(current.effect).not.toBe("deny")

      const extraReport = "ephemeral-reports/research/other.md"
      const outsideAssigned: any = {
        agent: "research",
        action: "edit",
        resources: [extraReport],
        sessionID: "research-scope-author",
        effect: "ask",
      }
      await evaluate(outsideAssigned)
      expect(outsideAssigned.effect).toBe("deny")
      expect(outsideAssigned.message).toContain("loom_scope_elevate")

      const reportElevation = await h.call(
        "scope_elevate",
        {
          workflowId,
          stepId: "research",
          paths: [extraReport],
          reason: "The investigation needs a second role-owned report artifact.",
        },
        "research",
        "research-scope-author",
      )
      expect(reportElevation.error).toBeUndefined()
      expect(reportElevation.continue).toBe(true)

      outsideAssigned.effect = "ask"
      await evaluate(outsideAssigned)
      expect(outsideAssigned.effect).not.toBe("deny")

      const productElevation = await h.call(
        "scope_elevate",
        {
          workflowId,
          stepId: "research",
          paths: ["src/research-should-not-edit.ts"],
          reason: "Research should not become the implementation role.",
        },
        "research",
        "research-scope-author",
      )
      expect(productElevation.error).toContain("independent/advisory role")

      expect((await h.call(
        "reopen",
        {
          workflowId,
          stepId: "research",
          reason: "fresh source evidence",
          newEvidence: true,
          changedHypothesis: false,
          changedStrategy: false,
          reducedUnresolved: false,
        },
        "general",
        "research-scope-general",
      )).error).toBeUndefined()

      const stale: any = {
        agent: "research",
        action: "edit",
        resources: [extraReport],
        sessionID: "research-scope-author",
        effect: "ask",
      }
      await evaluate(stale)
      expect(stale.effect).toBe("deny")
      expect(stale.message).toContain("fresh attachment")

      const freshGrant = await h.call(
        "dispatch_grant",
        { workflowId, stepId: "research" },
        "general",
        "research-scope-general",
      )
      expect((await h.call(
        "attach",
        { grantId: freshGrant.grantId, workflowId, stepId: "research" },
        "research",
        "research-scope-author",
      )).attached).toBe(true)

      stale.effect = "ask"
      await evaluate(stale)
      expect(stale.effect).not.toBe("deny")
    } finally {
      h.restore()
    }
  })

  test("specialist scope and reopen transitions serialize with active mutation authority", async () => {
    const h = await harness()
    try {
      await initializeGitFixture(h.root)
      const started = await h.call(
        "start",
        { request: "Specify one bounded lifecycle meaning." },
        "general",
        "specifier-transition-general",
      )
      const workflowId = String(started.workflowId)
      expect((await h.call(
        "route",
        {
          humanFacing: false,
          behavioral: true,
          structural: false,
          externalUnknown: false,
          diagnostic: false,
          productOutcome: false,
          implementationRequested: true,
          executionDepth: "change",
        },
        "general",
        "specifier-transition-general",
      )).error).toBeUndefined()

      const firstPath = "docs/requirements/lifecycle/first.md"
      const secondPath = "docs/requirements/lifecycle/second.md"
      expect((await h.call(
        "step_scope",
        { workflowId, stepId: "specifier", write: [firstPath, secondPath] },
        "general",
        "specifier-transition-general",
      )).error).toBeUndefined()

      const grant = await h.call(
        "dispatch_grant",
        { workflowId, stepId: "specifier" },
        "general",
        "specifier-transition-general",
      )
      expect((await h.call(
        "attach",
        { grantId: grant.grantId, workflowId, stepId: "specifier" },
        "specifier",
        "specifier-transition-author",
      )).attached).toBe(true)

      const activeScopeEdit = {
        tool: "edit",
        callID: "specifier-scope-transition-active",
        messageID: "specifier-scope-transition-message",
        sessionID: "specifier-transition-author",
        agent: "specifier",
        input: {
          filePath: join(h.root, firstPath),
          oldString: "",
          newString: "active\n",
        },
      }
      await h.toolHooks.get("execute.before")!(activeScopeEdit)

      let scopeSettled = false
      const narrowPromise = h.call(
        "step_scope",
        { workflowId, stepId: "specifier", write: [secondPath] },
        "general",
        "specifier-transition-general",
      ).then((result: any) => {
        scopeSettled = true
        return result
      })
      await new Promise((resolve) => setTimeout(resolve, 30))
      expect(scopeSettled).toBe(false)

      await h.toolHooks.get("execute.after")!({
        ...activeScopeEdit,
        status: "error",
        error: new Error("synthetic stop after admission"),
      })
      expect((await narrowPromise).error).toBeUndefined()

      const activeReopenEdit = {
        tool: "edit",
        callID: "specifier-reopen-transition-active",
        messageID: "specifier-reopen-transition-message",
        sessionID: "specifier-transition-author",
        agent: "specifier",
        input: {
          filePath: join(h.root, secondPath),
          oldString: "",
          newString: "active\n",
        },
      }
      await h.toolHooks.get("execute.before")!(activeReopenEdit)

      let reopenSettled = false
      const reopenPromise = h.call(
        "reopen",
        {
          workflowId,
          stepId: "specifier",
          reason: "new requirement evidence",
          newEvidence: true,
          changedHypothesis: false,
          changedStrategy: false,
          reducedUnresolved: false,
        },
        "general",
        "specifier-transition-general",
      ).then((result: any) => {
        reopenSettled = true
        return result
      })
      await new Promise((resolve) => setTimeout(resolve, 30))
      expect(reopenSettled).toBe(false)

      await h.toolHooks.get("execute.after")!({
        ...activeReopenEdit,
        status: "error",
        error: new Error("synthetic stop before reopen"),
      })
      expect((await reopenPromise).error).toBeUndefined()

      const staleAttempt: any = {
        agent: "specifier",
        action: "edit",
        resources: [secondPath],
        sessionID: "specifier-transition-author",
        effect: "ask",
      }
      await h.permissionHooks.get("evaluate")!(staleAttempt)
      expect(staleAttempt.effect).toBe("deny")
      expect(staleAttempt.message).toContain("current runnable Loom step attempt")
    } finally {
      h.restore()
    }
  })

  test("narrowing a specialist step cannot hide its earlier admitted dirty artifact", async () => {
    const h = await harness()
    try {
      await initializeGitFixture(h.root)
      const started = await h.call(
        "start",
        { request: "Specify one bounded lifecycle meaning." },
        "general",
        "specifier-narrow-general",
      )
      const workflowId = String(started.workflowId)
      expect((await h.call(
        "route",
        {
          humanFacing: false,
          behavioral: true,
          structural: false,
          externalUnknown: false,
          diagnostic: false,
          productOutcome: false,
          implementationRequested: true,
          executionDepth: "change",
        },
        "general",
        "specifier-narrow-general",
      )).error).toBeUndefined()

      const grant = await h.call(
        "dispatch_grant",
        { workflowId, stepId: "specifier" },
        "general",
        "specifier-narrow-general",
      )
      expect(grant.error).toBeUndefined()
      expect((await h.call(
        "attach",
        { grantId: grant.grantId, workflowId, stepId: "specifier" },
        "specifier",
        "specifier-narrow-author",
      )).attached).toBe(true)

      const earlier = "docs/requirements/lifecycle/earlier.md"
      const later = "docs/requirements/lifecycle/later.md"
      await mkdir(join(h.root, "docs", "requirements", "lifecycle"), { recursive: true })

      const evaluate = h.permissionHooks.get("evaluate")!
      const earlierEdit: any = {
        agent: "specifier",
        action: "edit",
        resources: [earlier],
        sessionID: "specifier-narrow-author",
        effect: "ask",
      }
      await evaluate(earlierEdit)
      expect(earlierEdit.effect).not.toBe("deny")

      const racedEditEvent = {
        tool: "edit",
        callID: "specifier-raced-edit",
        messageID: "specifier-raced-message",
        sessionID: "specifier-narrow-author",
        agent: "specifier",
        input: { filePath: join(h.root, earlier), oldString: "", newString: "raced\n" },
      }

      const editEvent = {
        tool: "edit",
        callID: "specifier-earlier-edit",
        messageID: "specifier-earlier-message",
        sessionID: "specifier-narrow-author",
        agent: "specifier",
        input: { filePath: join(h.root, earlier), oldString: "", newString: "earlier\n" },
      }
      await h.toolHooks.get("execute.before")!(editEvent)
      await writeFile(join(h.root, earlier), "earlier\n")
      await h.toolHooks.get("execute.after")!({
        ...editEvent,
        status: "completed",
        result: "updated",
      })

      const narrowed = await h.call(
        "step_scope",
        { workflowId, stepId: "specifier", write: [later] },
        "general",
        "specifier-narrow-general",
      )
      expect(narrowed.error).toBeUndefined()

      await expect(
        h.toolHooks.get("execute.before")!(racedEditEvent),
      ).rejects.toThrow("outside the current Loom write scope")

      const staleStageEvent = {
        tool: "shell",
        callID: "specifier-narrow-stale-stage",
        messageID: "specifier-narrow-stale-stage-message",
        sessionID: "specifier-narrow-author",
        agent: "specifier",
        input: { command: `git add ${earlier}` },
      }
      await expect(
        h.toolHooks.get("execute.before")!(staleStageEvent),
      ).rejects.toThrow("outside the current committable Loom write scope")

      const completed = await h.call(
        "complete",
        { workflowId, stepId: "specifier", summary: "specifier work complete" },
        "specifier",
        "specifier-narrow-author",
      )
      expect(completed.error).toContain("uncommitted changes")
      expect(completed.error).toContain(earlier)
    } finally {
      h.restore()
    }
  })

  test("allows scoped repair of pre-existing dirty files without absorbing untouched changes", async () => {
    const h = await harness()
    try {
      await initializeGitFixture(h.root)
      await writeFile(join(h.root, "src", "preexisting.ts"), "pre-existing\n")
      await git(h.root, ["add", "src/preexisting.ts"])

      const started = await h.call(
        "start",
        { request: "Apply one bounded implementation change." },
        "general",
        "git-ownership-general",
      )
      expect(started.error).toBeUndefined()
      const workflowId = String(started.workflowId)

      const routed = await h.call(
        "route",
        {
          humanFacing: false,
          behavioral: false,
          structural: false,
          externalUnknown: false,
          diagnostic: false,
          productOutcome: false,
          implementationRequested: true,
          executionDepth: "task",
        },
        "general",
        "git-ownership-general",
      )
      expect(routed.error).toBeUndefined()

      expect((await h.call(
        "task_scope",
        { workflowId, stepId: "worker", write: ["src/**"] },
        "general",
        "git-ownership-general",
      )).error).toBeUndefined()

      const grant = await h.call(
        "dispatch_grant",
        { workflowId, stepId: "worker" },
        "general",
        "git-ownership-general",
      )
      expect((await h.call(
        "attach",
        { grantId: grant.grantId, workflowId, stepId: "worker" },
        "worker",
        "git-ownership-worker",
      )).attached).toBe(true)

      const evaluate = h.permissionHooks.get("evaluate")
      expect(evaluate).toBeDefined()

      await h.toolHooks.get("execute.before")?.({
        tool: "edit",
        callID: "delayed-old-edit",
        sessionID: "git-ownership-worker",
        agent: "worker",
        input: { filePath: join(h.root, "src", "delayed.ts") },
      })
      await h.durableStorage.set(
        "session-attachment/git-ownership-worker",
        "rotated-attachment",
      )
      await h.toolHooks.get("execute.after")?.({
        tool: "edit",
        callID: "delayed-old-edit",
        sessionID: "git-ownership-worker",
        agent: "worker",
        input: { filePath: join(h.root, "src", "delayed.ts") },
        status: "completed",
        result: "late result",
      })
      const delayedStage: any = {
        agent: "worker",
        action: "shell",
        resources: ["git add src/delayed.ts"],
        sessionID: "git-ownership-worker",
        effect: "ask",
      }
      await evaluate!(delayedStage)
      expect(delayedStage.effect).toBe("deny")
      expect(delayedStage.message).toContain("exact bytes previously admitted")

      const preExistingEdit: any = {
        agent: "worker",
        action: "edit",
        resources: ["src/preexisting.ts"],
        sessionID: "git-ownership-worker",
        effect: "allow",
      }
      await evaluate!(preExistingEdit)
      expect(preExistingEdit.effect).not.toBe("deny")

      const unknownCommit: any = {
        agent: "worker",
        action: "shell",
        resources: ["git -c core.hooksPath=/dev/null commit -m 'test: do not absorb'"],
        sessionID: "git-ownership-worker",
        effect: "ask",
      }
      await evaluate!(unknownCommit)
      expect(unknownCommit.effect).toBe("deny")
      expect(unknownCommit.message).toContain("staged paths were not authored")

      const repairEvent = {
        tool: "edit",
        callID: "repair-preexisting",
        sessionID: "git-ownership-worker",
        agent: "worker",
        input: { filePath: join(h.root, "src", "preexisting.ts") },
      }
      await h.toolHooks.get("execute.before")?.(repairEvent)
      await writeFile(join(h.root, "src", "preexisting.ts"), "repaired\n")
      await h.toolHooks.get("execute.after")?.({
        ...repairEvent,
        status: "completed",
        result: "repaired",
      })

      const repairedStage: any = {
        agent: "worker",
        action: "shell",
        resources: ["git add src/preexisting.ts"],
        sessionID: "git-ownership-worker",
        effect: "ask",
      }
      await evaluate!(repairedStage)
      expect(repairedStage.effect).toBe("allow")
      const repairedStageEvent = {
        tool: "shell",
        callID: "stage-repaired-preexisting",
        sessionID: "git-ownership-worker",
        agent: "worker",
        input: { command: "git add src/preexisting.ts" },
      }
      await h.toolHooks.get("execute.before")?.(repairedStageEvent)
      await git(h.root, ["add", "src/preexisting.ts"])
      await h.toolHooks.get("execute.after")?.({
        ...repairedStageEvent,
        status: "completed",
        result: "staged",
      })

      const repairedCommit: any = {
        agent: "worker",
        action: "shell",
        resources: [
          "git -c core.hooksPath=/dev/null commit -m 'test: repair preexisting'",
        ],
        sessionID: "git-ownership-worker",
        effect: "ask",
      }
      await evaluate!(repairedCommit)
      expect(repairedCommit.effect).toBe("allow")
      await git(h.root, [
        "-c",
        "core.hooksPath=/dev/null",
        "commit",
        "-m",
        "test: repair preexisting",
        "-q",
      ])

      const ownedEdit: any = {
        agent: "worker",
        action: "edit",
        resources: ["src/owned.ts"],
        sessionID: "git-ownership-worker",
        effect: "allow",
      }
      await evaluate!(ownedEdit)
      expect(ownedEdit.effect).not.toBe("deny")
      await h.toolHooks.get("execute.before")?.({
        tool: "edit",
        callID: "owned-edit",
        sessionID: "git-ownership-worker",
        agent: "worker",
        input: { filePath: join(h.root, "src", "owned.ts") },
      })
      await writeFile(join(h.root, "src", "owned.ts"), "owned\n")
      await h.toolHooks.get("execute.after")?.({
        tool: "edit",
        callID: "owned-edit",
        sessionID: "git-ownership-worker",
        agent: "worker",
        input: { filePath: join(h.root, "src", "owned.ts") },
        status: "completed",
        result: "updated",
      })

      await writeFile(join(h.root, "src", "owned.ts"), "foreign\n")

      const foreignEdit: any = {
        agent: "worker",
        action: "edit",
        resources: ["src/owned.ts"],
        sessionID: "git-ownership-worker",
        effect: "allow",
      }
      await evaluate!(foreignEdit)
      expect(foreignEdit.effect).not.toBe("deny")

      const foreignStage: any = {
        agent: "worker",
        action: "shell",
        resources: ["git add src/owned.ts"],
        sessionID: "git-ownership-worker",
        effect: "ask",
      }
      await evaluate!(foreignStage)
      expect(foreignStage.effect).toBe("deny")
      expect(foreignStage.message).toContain("changed after this step attempt")

      // Restore the exact content produced by the admitted Worker mutation.
      await writeFile(join(h.root, "src", "owned.ts"), "owned\n")
      await chmod(join(h.root, "src", "owned.ts"), 0o755)

      const foreignModeStage: any = {
        agent: "worker",
        action: "shell",
        resources: ["git add src/owned.ts"],
        sessionID: "git-ownership-worker",
        effect: "ask",
      }
      await evaluate!(foreignModeStage)
      expect(foreignModeStage.effect).toBe("deny")
      expect(foreignModeStage.message).toContain("changed after this step attempt")

      await chmod(join(h.root, "src", "owned.ts"), 0o644)

      const raceStagePermission: any = {
        agent: "worker",
        action: "shell",
        resources: ["git add src/owned.ts"],
        sessionID: "git-ownership-worker",
        effect: "ask",
      }
      await evaluate!(raceStagePermission)
      expect(raceStagePermission.effect).toBe("allow")
      await writeFile(join(h.root, "src", "owned.ts"), "changed-before-stage\n")
      await expect(
        h.toolHooks.get("execute.before")?.({
          tool: "shell",
          callID: "raced-stage",
          sessionID: "git-ownership-worker",
          agent: "worker",
          input: { command: "git add src/owned.ts" },
        }),
      ).rejects.toThrow("changed after this step attempt's last admitted mutation")
      await writeFile(join(h.root, "src", "owned.ts"), "owned\n")

      const incomplete = await h.call(
        "complete",
        { workflowId, stepId: "worker", summary: "implementation complete" },
        "worker",
        "git-ownership-worker",
      )
      expect(incomplete.error).toContain("uncommitted changes")
      expect(incomplete.error).toContain("src/owned.ts")

      const ownedStage: any = {
        agent: "worker",
        action: "shell",
        resources: ["git add src/owned.ts"],
        sessionID: "git-ownership-worker",
        effect: "ask",
      }
      await evaluate!(ownedStage)
      expect(ownedStage.effect).toBe("allow")
      const stageEvent = {
        tool: "shell",
        callID: "owned-stage",
        sessionID: "git-ownership-worker",
        agent: "worker",
        input: { command: "git add src/owned.ts" },
      }
      await h.toolHooks.get("execute.before")?.(stageEvent)
      await git(h.root, ["add", "src/owned.ts"])
      await h.toolHooks.get("execute.after")?.({
        ...stageEvent,
        status: "completed",
        result: "staged",
      })

      // Session-local staged fingerprints are a cache. If that entry is lost,
      // the same step attempt may re-establish it only from its durable byte
      // provenance and an index entry that still matches the admitted worktree.
      const ownershipKey = `git-session-ownership/${encodeURIComponent("git-ownership-worker")}`
      const ownershipBeforeRecovery = await h.durableStorage.get(ownershipKey) as any
      const admittedStageFingerprint = ownershipBeforeRecovery.stagedFingerprints["src/owned.ts"]
      delete ownershipBeforeRecovery.stagedFingerprints["src/owned.ts"]
      await h.durableStorage.set(ownershipKey, ownershipBeforeRecovery)

      const recoveredCommit: any = {
        agent: "worker",
        action: "shell",
        resources: [
          "git -c core.hooksPath=/dev/null commit -m 'test: recover staged fingerprint'",
        ],
        sessionID: "git-ownership-worker",
        effect: "ask",
      }
      await evaluate!(recoveredCommit)
      expect(recoveredCommit.effect).toBe("allow")
      const ownershipAfterRecovery = await h.durableStorage.get(ownershipKey) as any
      expect(ownershipAfterRecovery.stagedFingerprints["src/owned.ts"]).toBe(
        admittedStageFingerprint,
      )

      // Loss of the recovered cache entry still cannot bless subsequently
      // changed index content.
      delete ownershipAfterRecovery.stagedFingerprints["src/owned.ts"]
      await h.durableStorage.set(ownershipKey, ownershipAfterRecovery)
      await writeFile(join(h.root, "src", "owned.ts"), "foreign-index\n")
      await git(h.root, ["add", "src/owned.ts"])
      await writeFile(join(h.root, "src", "owned.ts"), "owned\n")

      const tamperedCommit: any = {
        agent: "worker",
        action: "shell",
        resources: [
          "git -c core.hooksPath=/dev/null commit -m 'test: tampered index'",
        ],
        sessionID: "git-ownership-worker",
        effect: "ask",
      }
      await evaluate!(tamperedCommit)
      expect(tamperedCommit.effect).toBe("deny")
      expect(tamperedCommit.message).toContain("staged content changed")

      const restageEvent = {
        tool: "shell",
        callID: "owned-restage",
        sessionID: "git-ownership-worker",
        agent: "worker",
        input: { command: "git add src/owned.ts" },
      }
      const restagePermission: any = {
        agent: "worker",
        action: "shell",
        resources: ["git add src/owned.ts"],
        sessionID: "git-ownership-worker",
        effect: "ask",
      }
      await evaluate!(restagePermission)
      expect(restagePermission.effect).toBe("allow")
      await h.toolHooks.get("execute.before")?.(restageEvent)
      await git(h.root, ["add", "src/owned.ts"])
      await h.toolHooks.get("execute.after")?.({
        ...restageEvent,
        status: "completed",
        result: "restaged",
      })

      const raceCommitPermission: any = {
        agent: "worker",
        action: "shell",
        resources: [
          "git -c core.hooksPath=/dev/null commit -m 'test: race fence'",
        ],
        sessionID: "git-ownership-worker",
        effect: "ask",
      }
      await evaluate!(raceCommitPermission)
      expect(raceCommitPermission.effect).toBe("allow")
      await writeFile(join(h.root, "src", "other.ts"), "other\n")
      await git(h.root, ["add", "src/other.ts"])
      await expect(
        h.toolHooks.get("execute.before")?.({
          tool: "shell",
          callID: "raced-commit",
          sessionID: "git-ownership-worker",
          agent: "worker",
          input: {
            command: "git -c core.hooksPath=/dev/null commit -m 'test: race fence'",
          },
        }),
      ).rejects.toThrow("staged paths were not authored")
      await git(h.root, ["rm", "--cached", "src/other.ts"])

      const hook = join(h.root, ".git", "hooks", "pre-commit")
      await writeFile(
        hook,
        "#!/bin/sh\nprintf 'hook-ran\\n' > src/hook-ran.ts\ngit add src/hook-ran.ts\n",
      )
      await chmod(hook, 0o755)

      const ownedCommit: any = {
        agent: "worker",
        action: "shell",
        resources: [
          "git -c core.hooksPath=/dev/null commit -m 'test: owned change'",
        ],
        sessionID: "git-ownership-worker",
        effect: "ask",
      }
      await evaluate!(ownedCommit)
      expect(ownedCommit.effect).toBe("allow")
      await git(h.root, [
        "-c",
        "core.hooksPath=/dev/null",
        "commit",
        "-m",
        "test: owned change",
        "-q",
      ])
      await expect(readFile(join(h.root, "src", "hook-ran.ts"), "utf8")).rejects.toThrow()

      const completed = await h.call(
        "complete",
        { workflowId, stepId: "worker", summary: "implementation complete" },
        "worker",
        "git-ownership-worker",
      )
      expect(completed.error).toBeUndefined()
    } finally {
      h.restore()
    }
  })

  test("overlapping Worker scopes stay authorized while same-file writes serialize", async () => {
    const h = await harness()
    try {
      await initializeGitFixture(h.root)
      const attachWorker = async (suffix: string) => {
        const generalSession = `overlap-general-${suffix}`
        const workerSession = `overlap-worker-${suffix}`
        const started = await h.call(
          "start",
          { request: `Apply overlapping implementation ${suffix}.` },
          "general",
          generalSession,
        )
        const workflowId = String(started.workflowId)
        expect(started.error).toBeUndefined()
        expect((await h.call(
          "route",
          {
            humanFacing: false,
            behavioral: false,
            structural: false,
            externalUnknown: false,
            diagnostic: false,
            productOutcome: false,
            implementationRequested: true,
            executionDepth: "task",
          },
          "general",
          generalSession,
        )).error).toBeUndefined()
        expect((await h.call(
          "task_scope",
          { workflowId, stepId: "worker", write: ["src/shared.ts"] },
          "general",
          generalSession,
        )).error).toBeUndefined()
        const grant = await h.call(
          "dispatch_grant",
          { workflowId, stepId: "worker" },
          "general",
          generalSession,
        )
        expect((await h.call(
          "attach",
          { grantId: grant.grantId, workflowId, stepId: "worker" },
          "worker",
          workerSession,
        )).attached).toBe(true)
        return workerSession
      }

      const workerA = await attachWorker("a")
      const workerB = await attachWorker("b")
      const evaluate = h.permissionHooks.get("evaluate")!

      for (const sessionID of [workerA, workerB]) {
        const permission: any = {
          agent: "worker",
          action: "edit",
          resources: ["src/shared.ts"],
          sessionID,
          effect: "allow",
        }
        await evaluate(permission)
        expect(permission.effect).not.toBe("deny")
      }

      const first = {
        tool: "edit",
        callID: "overlap-write-a",
        sessionID: workerA,
        agent: "worker",
        input: { filePath: join(h.root, "src", "shared.ts") },
      }
      const second = {
        tool: "edit",
        callID: "overlap-write-b",
        sessionID: workerB,
        agent: "worker",
        input: { filePath: join(h.root, "src", "shared.ts") },
      }

      await h.toolHooks.get("execute.before")?.(first)
      await expect(h.toolHooks.get("execute.before")?.(second))
        .rejects.toThrow(
          "src/shared.ts is locked for write by another agent. Try again later and re-read the file before retrying.",
        )

      await writeFile(join(h.root, "src", "shared.ts"), "a\n")
      await h.toolHooks.get("execute.after")?.({
        ...first,
        status: "completed",
        result: "a",
      })

      await expect(h.toolHooks.get("execute.before")?.(second)).resolves.toBeUndefined()
      await writeFile(join(h.root, "src", "shared.ts"), "b\n")
      await h.toolHooks.get("execute.after")?.({
        ...second,
        status: "completed",
        result: "b",
      })
    } finally {
      h.restore()
    }
  })

  test("serializes active writes across plugin instances without permanent ownership", async () => {
    const firstHarness = await harness(async (_storage, root) => {
      await initializeGitFixture(root)
    })
    let secondHarness: Awaited<ReturnType<typeof harness>> | undefined
    try {
      secondHarness = await harness(
        undefined,
        undefined,
        { root: firstHarness.root, storage: firstHarness.storage },
      )

      const first = {
        tool: "edit",
        callID: "active-write-a",
        sessionID: "write-lock-session-a",
        agent: "general",
        input: { filePath: join(firstHarness.root, "src", "shared.ts") },
      }
      const second = {
        tool: "edit",
        callID: "active-write-b",
        sessionID: "write-lock-session-b",
        agent: "general",
        input: { filePath: join(firstHarness.root, "src", "shared.ts") },
      }

      await firstHarness.toolHooks.get("execute.before")?.(first)

      await expect(
        firstHarness.toolHooks.get("execute.before")?.({
          tool: "edit",
          sessionID: "write-lock-no-call-id",
          agent: "general",
          input: { filePath: join(firstHarness.root, "src", "other-shared.ts") },
        }),
      ).rejects.toThrow(
        "could not establish a stable tool-call identity for write locking",
      )

      await expect(
        firstHarness.toolHooks.get("execute.before")?.(first),
      ).rejects.toThrow(
        "this tool-call identity is already performing a mutation",
      )

      await expect(
        secondHarness.toolHooks.get("execute.before")?.(second),
      ).rejects.toThrow(
        "src/shared.ts is locked for write by another agent. Try again later and re-read the file before retrying.",
      )

      await writeFile(join(firstHarness.root, "src", "shared.ts"), "first\n")
      await firstHarness.toolHooks.get("execute.after")?.({
        ...first,
        status: "completed",
        result: "first write",
      })

      await expect(
        secondHarness.toolHooks.get("execute.before")?.(second),
      ).resolves.toBeUndefined()
      await writeFile(join(firstHarness.root, "src", "shared.ts"), "second\n")
      await secondHarness.toolHooks.get("execute.after")?.({
        ...second,
        status: "completed",
        result: "second write",
      })

      const failed = {
        tool: "edit",
        callID: "active-write-error",
        sessionID: "write-lock-session-a",
        agent: "general",
        input: { filePath: join(firstHarness.root, "src", "failed.ts") },
      }
      await firstHarness.toolHooks.get("execute.before")?.(failed)
      await firstHarness.toolHooks.get("execute.after")?.({
        ...failed,
        status: "error",
        error: new Error("synthetic edit failure"),
      })
      await expect(
        secondHarness.toolHooks.get("execute.before")?.({
          ...failed,
          callID: "active-write-after-error",
          sessionID: "write-lock-session-b",
        }),
      ).resolves.toBeUndefined()
      await secondHarness.toolHooks.get("execute.after")?.({
        ...failed,
        callID: "active-write-after-error",
        sessionID: "write-lock-session-b",
        status: "completed",
        result: "retry completed",
      })

      expect(await readFile(join(firstHarness.root, "src", "shared.ts"), "utf8"))
        .toBe("second\n")
    } finally {
      secondHarness?.restore()
      firstHarness.restore()
    }
  })

  test("locks write, patch, gofmt, and Git index mutation surfaces", async () => {
    const firstHarness = await harness(async (_storage, root) => {
      await initializeGitFixture(root)
      await mkdir(join(root, "docs", "anchors"), { recursive: true })
      await writeFile(join(root, "src", "shared.go"), "package shared\n")
    })
    let secondHarness: Awaited<ReturnType<typeof harness>> | undefined
    try {
      secondHarness = await harness(
        undefined,
        undefined,
        { root: firstHarness.root, storage: firstHarness.storage },
      )

      const writeCall = {
        tool: "write",
        callID: "surface-write",
        sessionID: "surface-a",
        agent: "general",
        input: { filePath: join(firstHarness.root, "src", "shared.ts"), content: "a\n" },
      }
      const patchCall = {
        tool: "apply_patch",
        callID: "surface-patch",
        sessionID: "surface-b",
        agent: "general",
        input: {
          patchText:
            "*** Begin Patch\n*** Update File: src/shared.ts\n@@\n-a\n+b\n*** End Patch",
        },
      }
      await firstHarness.toolHooks.get("execute.before")?.(writeCall)
      await expect(secondHarness.toolHooks.get("execute.before")?.(patchCall))
        .rejects.toThrow("src/shared.ts is locked for write by another agent")
      await firstHarness.toolHooks.get("execute.after")?.({
        ...writeCall,
        status: "completed",
        result: "written",
      })

      const gofmtCall = {
        tool: "shell",
        callID: "surface-gofmt",
        sessionID: "surface-a",
        agent: "general",
        input: { command: "gofmt -w src/shared.go" },
      }
      const editGoCall = {
        tool: "edit",
        callID: "surface-edit-go",
        sessionID: "surface-b",
        agent: "general",
        input: { filePath: join(firstHarness.root, "src", "shared.go") },
      }
      await firstHarness.toolHooks.get("execute.before")?.(gofmtCall)
      await expect(secondHarness.toolHooks.get("execute.before")?.(editGoCall))
        .rejects.toThrow("src/shared.go is locked for write by another agent")
      await firstHarness.toolHooks.get("execute.after")?.({
        ...gofmtCall,
        status: "completed",
        result: "formatted",
      })

      const admitAnchor = async (
        h: Awaited<ReturnType<typeof harness>>,
        sessionID: string,
        name: string,
      ) => {
        const event = {
          tool: "edit",
          callID: `anchor-edit-${name}`,
          sessionID,
          agent: "general",
          input: { filePath: join(firstHarness.root, "docs", "anchors", `${name}.md`) },
        }
        await h.toolHooks.get("execute.before")?.(event)
        await writeFile(join(firstHarness.root, "docs", "anchors", `${name}.md`), `${name}\n`)
        await h.toolHooks.get("execute.after")?.({
          ...event,
          status: "completed",
          result: "updated",
        })
      }

      await admitAnchor(firstHarness, "surface-a", "a")
      await admitAnchor(secondHarness, "surface-b", "b")

      const addA = {
        tool: "shell",
        callID: "surface-add-a",
        sessionID: "surface-a",
        agent: "general",
        input: { command: "git add docs/anchors/a.md" },
      }
      const addB = {
        tool: "shell",
        callID: "surface-add-b",
        sessionID: "surface-b",
        agent: "general",
        input: { command: "git add docs/anchors/b.md" },
      }
      await firstHarness.toolHooks.get("execute.before")?.(addA)
      await expect(secondHarness.toolHooks.get("execute.before")?.(addB))
        .rejects.toThrow("repository index is locked by another agent")
      await firstHarness.toolHooks.get("execute.after")?.({
        ...addA,
        status: "error",
        error: new Error("synthetic staging stop"),
      })
      await expect(secondHarness.toolHooks.get("execute.before")?.(addB))
        .resolves.toBeUndefined()
      await secondHarness.toolHooks.get("execute.after")?.({
        ...addB,
        status: "error",
        error: new Error("synthetic staging stop"),
      })
    } finally {
      secondHarness?.restore()
      firstHarness.restore()
    }
  })

  test("keeps the shared Git index single-owner across Loom processes until staged work is committed", async () => {
    const firstHarness = await harness(async (_storage, root) => {
      await initializeGitFixture(root)
      await mkdir(join(root, "docs", "anchors"), { recursive: true })
    })
    let secondHarness: Awaited<ReturnType<typeof harness>> | undefined
    try {
      secondHarness = await harness(
        undefined,
        undefined,
        { root: firstHarness.root, storage: firstHarness.storage },
      )

      const admitAnchor = async (
        h: Awaited<ReturnType<typeof harness>>,
        sessionID: string,
        name: string,
      ) => {
        const event = {
          tool: "edit",
          callID: `shared-index-edit-${sessionID}-${name}`,
          sessionID,
          agent: "general",
          input: {
            filePath: join(firstHarness.root, "docs", "anchors", `${name}.md`),
            oldString: "",
            newString: `${name}\n`,
          },
        }
        await h.toolHooks.get("execute.before")!(event)
        await writeFile(join(firstHarness.root, "docs", "anchors", `${name}.md`), `${name}\n`)
        await h.toolHooks.get("execute.after")!({
          ...event,
          status: "completed",
          result: "updated",
        })
      }

      await admitAnchor(firstHarness, "index-owner-a", "a")
      await admitAnchor(firstHarness, "index-owner-a", "c")
      await admitAnchor(secondHarness, "index-owner-b", "b")

      const stage = async (
        h: Awaited<ReturnType<typeof harness>>,
        sessionID: string,
        name: string,
        callID: string,
      ) => {
        const event = {
          tool: "shell",
          callID,
          sessionID,
          agent: "general",
          input: { command: `git add docs/anchors/${name}.md` },
        }
        await h.toolHooks.get("execute.before")!(event)
        await git(firstHarness.root, ["add", `docs/anchors/${name}.md`])
        await h.toolHooks.get("execute.after")!({
          ...event,
          status: "completed",
          result: "staged",
        })
      }

      await stage(firstHarness, "index-owner-a", "a", "shared-index-stage-a")

      // The same Loom session can keep building one coherent staged commit.
      await stage(firstHarness, "index-owner-a", "c", "shared-index-stage-c")

      const blockedB = {
        tool: "shell",
        callID: "shared-index-stage-b",
        sessionID: "index-owner-b",
        agent: "general",
        input: { command: "git add docs/anchors/b.md" },
      }
      await expect(secondHarness.toolHooks.get("execute.before")!(blockedB))
        .rejects.toThrow("shared repository index already contains staged changes")

      const commitA = {
        tool: "shell",
        callID: "shared-index-commit-a",
        sessionID: "index-owner-a",
        agent: "general",
        input: {
          command:
            "git -c core.hooksPath=/dev/null commit -m 'test: first index owner'",
        },
      }
      await firstHarness.toolHooks.get("execute.before")!(commitA)
      await git(firstHarness.root, [
        "-c",
        "core.hooksPath=/dev/null",
        "commit",
        "-m",
        "test: first index owner",
        "-q",
      ])
      await firstHarness.toolHooks.get("execute.after")!({
        ...commitA,
        status: "completed",
        result: "committed",
      })
      const ownershipAfterCommit = await firstHarness.durableStorage.get(
        `git-session-ownership/${encodeURIComponent("index-owner-a")}`,
      ) as any
      expect(ownershipAfterCommit.stagedFingerprints).toEqual({})

      // Once the first owner's staged set is gone, the next process can
      // immediately take the shared index and publish normally.
      await stage(secondHarness, "index-owner-b", "b", "shared-index-stage-b")

      const commitB = {
        tool: "shell",
        callID: "shared-index-commit-b",
        sessionID: "index-owner-b",
        agent: "general",
        input: {
          command:
            "git -c core.hooksPath=/dev/null commit -m 'test: second index owner'",
        },
      }
      await secondHarness.toolHooks.get("execute.before")!(commitB)
      await git(firstHarness.root, [
        "-c",
        "core.hooksPath=/dev/null",
        "commit",
        "-m",
        "test: second index owner",
        "-q",
      ])
      await secondHarness.toolHooks.get("execute.after")!({
        ...commitB,
        status: "completed",
        result: "committed",
      })
    } finally {
      secondHarness?.restore()
      firstHarness.restore()
    }
  })

  test("does not claim staging when a failed chain never changed the index", async () => {
    const h = await harness()
    try {
      await initializeGitFixture(h.root)
      await mkdir(join(h.root, "docs", "anchors"), { recursive: true })

      const sessionID = "failed-stage-noop-owner"
      const path = "docs/anchors/noop.md"
      const editEvent = {
        tool: "edit",
        callID: "failed-stage-noop-edit",
        sessionID,
        agent: "general",
        input: {
          filePath: join(h.root, path),
          oldString: "",
          newString: "owned\n",
        },
      }
      await h.toolHooks.get("execute.before")!(editEvent)
      await writeFile(join(h.root, path), "owned\n")
      await h.toolHooks.get("execute.after")!({
        ...editEvent,
        status: "completed",
        result: "updated",
      })

      // Simulate an index entry that already existed before this Loom shell
      // call. The later shell failure must not cause Loom to claim it staged
      // those bytes itself.
      await git(h.root, ["add", path])

      const command = `git add ${path} && git diff --cached --check`
      const permission: any = {
        agent: "general",
        action: "shell",
        resources: [command],
        sessionID,
        effect: "ask",
      }
      await h.permissionHooks.get("evaluate")!(permission)
      expect(permission.effect).toBe("allow")

      const event = {
        tool: "shell",
        callID: "failed-stage-noop",
        sessionID,
        agent: "general",
        input: { command },
      }
      await h.toolHooks.get("execute.before")!(event)
      await h.toolHooks.get("execute.after")!({
        ...event,
        status: "error",
        error: new Error("synthetic failure before git add changed the index"),
      })

      const commit: any = {
        agent: "general",
        action: "shell",
        resources: [
          "git -c core.hooksPath=/dev/null commit -m 'test: must not adopt'",
        ],
        sessionID,
        effect: "ask",
      }
      await h.permissionHooks.get("evaluate")!(commit)
      expect(commit.effect).toBe("deny")
      expect(commit.message).toContain("staged content changed")
    } finally {
      h.restore()
    }
  })

  test("active workflows do not grant conversational Research or Diagnostic bypass", async () => {
    const { call, permissionHooks, restore } = await harness()
    try {
      const evaluate = permissionHooks.get("evaluate")
      expect(evaluate).toBeDefined()

      const unrouted = await call(
        "start",
        { request: "Track a bounded investigation." },
        "general",
        "active-unrouted-general",
      )
      expect(unrouted.error).toBeUndefined()

      const beforeRoute: any = {
        agent: "general",
        action: "subagent",
        resources: ["research"],
        sessionID: "active-unrouted-general",
        source: { messageID: "message", id: "call-unrouted-research" },
      }
      await evaluate!(beforeRoute)
      expect(beforeRoute.effect).toBe("deny")

      for (const target of ["research", "diagnostic"] as const) {
        const sessionID = `active-${target}-general`
        const started = await call(
          "start",
          { request: `Track governed ${target} work.` },
          "general",
          sessionID,
        )
        expect(started.error).toBeUndefined()
        const workflowId = String(started.workflowId)

        const routed = await call(
          "route",
          {
            humanFacing: false,
            behavioral: false,
            structural: false,
            externalUnknown: target === "research",
            diagnostic: target === "diagnostic",
            productOutcome: false,
            implementationRequested: false,
            executionDepth: "task",
          },
          "general",
          sessionID,
        )
        expect(routed.error).toBeUndefined()
        expect(routed.now).toContainEqual({ step: target, agent: target })

        const withoutGrant: any = {
          agent: "general",
          action: "subagent",
          resources: [target],
          sessionID,
          source: { messageID: "message", id: `call-${target}-without-grant` },
        }
        await evaluate!(withoutGrant)
        expect(withoutGrant.effect).toBe("deny")
        expect(withoutGrant.message).toContain("loom_dispatch_grant")

        const grant = await call(
          "dispatch_grant",
          { workflowId, stepId: target },
          "general",
          sessionID,
        )
        expect(grant.expectedAgent).toBe(target)

        const withGrant: any = {
          agent: "general",
          action: "subagent",
          resources: [target],
          sessionID,
          source: { messageID: "message", id: `call-${target}-with-grant` },
        }
        await evaluate!(withGrant)
        expect(withGrant.effect).not.toBe("deny")
      }
    } finally {
      restore()
    }
  })

  test("terminal workflow bindings return General to conversational investigation", async () => {
    const { call, permissionHooks, restore } = await harness()
    try {
      const evaluate = permissionHooks.get("evaluate")
      expect(evaluate).toBeDefined()
      const generalSession = "terminal-conversation-general"

      const started = await call(
        "start",
        { request: "Perform tracked read-only verification." },
        "general",
        generalSession,
      )
      expect(started.error).toBeUndefined()
      const workflowId = String(started.workflowId)

      const routed = await call(
        "route",
        {
          humanFacing: false,
          behavioral: false,
          structural: false,
          externalUnknown: false,
          diagnostic: false,
          productOutcome: false,
          implementationRequested: false,
          executionDepth: "task",
        },
        "general",
        generalSession,
      )
      expect(routed.now).toEqual([{ step: "review-task", agent: "reviewer" }])

      const grant = await call(
        "dispatch_grant",
        { workflowId, stepId: "review-task" },
        "general",
        generalSession,
      )
      await call(
        "attach",
        { grantId: grant.grantId, workflowId, stepId: "review-task" },
        "reviewer",
        "terminal-conversation-reviewer",
      )
      const completed = await call(
        "complete",
        {
          workflowId,
          stepId: "review-task",
          outcome: "pass",
          summary: "Tracked verification complete.",
        },
        "reviewer",
        "terminal-conversation-reviewer",
      )
      expect(completed.error).toBeUndefined()
      expect(completed.dagRunnable).toEqual([])

      for (const target of ["research", "diagnostic"] as const) {
        const conversational: any = {
          agent: "general",
          action: "subagent",
          resources: [target],
          sessionID: generalSession,
          source: { messageID: "later-message", id: `later-${target}` },
        }
        await evaluate!(conversational)
        expect(conversational.effect).not.toBe("deny")
      }

      for (const target of ["worker", "designer", "reviewer"] as const) {
        const governed: any = {
          agent: "general",
          action: "subagent",
          resources: [target],
          sessionID: generalSession,
          source: { messageID: "later-message", id: `later-${target}` },
        }
        await evaluate!(governed)
        expect(governed.effect).toBe("deny")
      }
    } finally {
      restore()
    }
  })

  test("conversational observations cannot be laundered into governed evidence", async () => {
    const { call, toolHooks, durableStorage, restore } = await harness()
    try {
      const diagnosticSession = "evidence-laundering-diagnostic"
      const generalSession = "evidence-laundering-general"

      const observeShell = async (callID: string, command: string) => {
        await toolHooks.get("execute.before")?.({
          tool: "shell",
          callID,
          sessionID: diagnosticSession,
          agent: "diagnostic",
          input: { command },
        })
        await toolHooks.get("execute.after")?.({
          tool: "shell",
          callID,
          sessionID: diagnosticSession,
          agent: "diagnostic",
          input: { command },
          status: "completed",
          result: "ok",
        })
        const records = (await durableStorage.scan({ prefix: "evidence/", limit: 1000 })).entries
          .map((entry: any) => entry.value)
          .filter((value: any) =>
            value?.sessionID === diagnosticSession &&
            value?.command === command
          )
        expect(records).toHaveLength(1)
        return records[0]
      }

      const conversational = await observeShell("pre-workflow", "git status")
      expect(conversational.workflowId).toBeUndefined()
      expect(conversational.stepId).toBeUndefined()

      const started = await call(
        "start",
        { request: "Track a governed diagnosis and independently review it." },
        "general",
        generalSession,
      )
      expect(started.error).toBeUndefined()
      const workflowId = String(started.workflowId)

      const routed = await call(
        "route",
        {
          humanFacing: false,
          behavioral: false,
          structural: false,
          externalUnknown: false,
          diagnostic: true,
          productOutcome: false,
          implementationRequested: false,
          executionDepth: "task",
        },
        "general",
        generalSession,
      )
      expect(routed.now).toContainEqual({ step: "diagnostic", agent: "diagnostic" })

      const grant = await call(
        "dispatch_grant",
        { workflowId, stepId: "diagnostic" },
        "general",
        generalSession,
      )
      await call(
        "attach",
        { grantId: grant.grantId, workflowId, stepId: "diagnostic" },
        "diagnostic",
        diagnosticSession,
      )

      const governed = await observeShell("post-attach", "rg failure src")
      expect(governed).toMatchObject({
        workflowId,
        stepId: "diagnostic",
      })

      const rejectedClaim = await call(
        "evidence_claim",
        {
          workflowId,
          stepId: "diagnostic",
          kind: "other",
          statement: "Conversational observation must not become governed proof.",
          observationIds: [conversational.id],
        },
        "diagnostic",
        diagnosticSession,
      )
      expect(rejectedClaim.error).toContain("captured while this session was attached")

      const acceptedClaim = await call(
        "evidence_claim",
        {
          workflowId,
          stepId: "diagnostic",
          kind: "other",
          statement: "Governed diagnostic observation.",
          observationIds: [governed.id],
        },
        "diagnostic",
        diagnosticSession,
      )
      expect(acceptedClaim.error).toBeUndefined()
      expect(acceptedClaim.claim.observationIds).toEqual([governed.id])

      const required = await call(
        "verification",
        {
          action: "require",
          workflowId,
          beforeStepId: "review-task",
          kind: "other",
          statement: "Reviewer must see governed diagnostic proof.",
        },
        "diagnostic",
        diagnosticSession,
      )
      expect(required.error).toBeUndefined()
      const requirementId = String(required.requirement.id)

      const rejectedProof = await call(
        "verification",
        {
          action: "prove",
          workflowId,
          requirementId,
          statement: "Old conversational result.",
          observationIds: [conversational.id],
        },
        "diagnostic",
        diagnosticSession,
      )
      expect(rejectedProof.error).toContain("captured while this session was attached")

      const acceptedProof = await call(
        "verification",
        {
          action: "prove",
          workflowId,
          requirementId,
          statement: "Governed diagnostic result.",
          observationIds: [governed.id],
        },
        "diagnostic",
        diagnosticSession,
      )
      expect(acceptedProof.error).toBeUndefined()
      expect(acceptedProof.proven).toBe(requirementId)

      const completed = await call(
        "complete",
        {
          workflowId,
          stepId: "diagnostic",
          summary: "Governed diagnosis complete.",
        },
        "diagnostic",
        diagnosticSession,
      )
      expect(completed.error).toBeUndefined()
      expect(completed.dagRunnable).toContainEqual({ id: "review-task", agent: "reviewer" })

      const afterCompletedStep = await observeShell("post-complete", "git status --short")
      expect(afterCompletedStep.workflowId).toBeUndefined()
      expect(afterCompletedStep.stepId).toBeUndefined()
    } finally {
      restore()
    }
  })

  test("failed terminal workflow bindings also return General to conversation", async () => {
    const { call, permissionHooks, restore } = await harness()
    try {
      const evaluate = permissionHooks.get("evaluate")
      expect(evaluate).toBeDefined()
      const generalSession = "failed-terminal-general"

      const started = await call(
        "start",
        { request: "Perform tracked verification that may fail." },
        "general",
        generalSession,
      )
      expect(started.error).toBeUndefined()
      const workflowId = String(started.workflowId)
      await call(
        "route",
        {
          humanFacing: false,
          behavioral: false,
          structural: false,
          externalUnknown: false,
          diagnostic: false,
          productOutcome: false,
          implementationRequested: false,
          executionDepth: "task",
        },
        "general",
        generalSession,
      )

      const grant = await call(
        "dispatch_grant",
        { workflowId, stepId: "review-task" },
        "general",
        generalSession,
      )
      await call(
        "attach",
        { grantId: grant.grantId, workflowId, stepId: "review-task" },
        "reviewer",
        "failed-terminal-reviewer",
      )
      const failed = await call(
        "complete",
        {
          workflowId,
          stepId: "review-task",
          outcome: "fail",
          summary: "Verification failed.",
        },
        "reviewer",
        "failed-terminal-reviewer",
      )
      expect(failed.error).toBeUndefined()

      for (const target of ["research", "diagnostic"] as const) {
        const event: any = {
          agent: "general",
          action: "subagent",
          resources: [target],
          sessionID: generalSession,
          effect: "allow",
          source: { messageID: "later-message", id: `failed-later-${target}` },
        }
        await evaluate!(event)
        expect(event.effect).toBe("allow")
      }

      const worker: any = {
        agent: "general",
        action: "subagent",
        resources: ["worker"],
        sessionID: generalSession,
        effect: "allow",
        source: { messageID: "later-message", id: "failed-later-worker" },
      }
      await evaluate!(worker)
      expect(worker.effect).toBe("deny")
    } finally {
      restore()
    }
  })

  test("conversation may dispatch Research or Diagnostic without a workflow", async () => {
    const { permissionHooks, restore } = await harness()
    try {
      const evaluate = permissionHooks.get("evaluate")
      expect(evaluate).toBeDefined()

      for (const target of ["research", "diagnostic"]) {
        const event: any = {
          agent: "general",
          action: "subagent",
          resources: [target],
          sessionID: `conversation-${target}`,
          source: { messageID: "message", id: `call-${target}` },
        }
        await evaluate!(event)
        expect(event.effect).toBe("allow")
      }
    } finally {
      restore()
    }
  })

  test("conversation still blocks governed Loom agents without a workflow", async () => {
    const { permissionHooks, restore } = await harness()
    try {
      const evaluate = permissionHooks.get("evaluate")
      expect(evaluate).toBeDefined()

      for (const target of ["worker", "designer", "specifier", "architect", "reviewer", "critic", "acceptance", "planner", "documenter"]) {
        const event: any = {
          agent: "general",
          action: "subagent",
          resources: [target],
          sessionID: `conversation-${target}`,
          source: { messageID: "message", id: `call-${target}` },
        }
        await evaluate!(event)
        expect(event.effect).toBe("deny")
        expect(event.message).toContain("Only conversational Research or Diagnostic")
      }
    } finally {
      restore()
    }
  })

})

// Exercise the real registered tools, durable SQLite state and grant attachments.
// External OKF discovery is represented by a host observation fixture only.

describe("dispatch grant target resolution", () => {
  test("uses exact same-agent grants, admits launches, and fails closed on true ambiguity", async () => {
    const h = await harness()
    try {
      const started = await h.call(
        "start",
        { request: "Exercise exact same-agent dispatch targeting." },
        "general",
        "parent",
      )
      const workflowId = started.workflowId as string
      expect((await h.call("route", {
        humanFacing: false,
        behavioral: false,
        structural: false,
        externalUnknown: false,
        diagnostic: false,
        productOutcome: true,
        implementationRequested: true,
        executionDepth: "task",
      }, "general", "parent")).error).toBeUndefined()

      const workflow: any = await h.durableStorage.get(`workflow/${workflowId}`)
      workflow.steps = [
        {
          id: "worker-a",
          agent: "worker",
          kind: "work",
          dependsOn: [],
          status: "pending",
        },
        {
          id: "worker-b",
          agent: "worker",
          kind: "work",
          dependsOn: [],
          status: "pending",
        },
        {
          id: "review-implementation",
          agent: "reviewer",
          kind: "gate",
          dependsOn: ["worker-a", "worker-b"],
          status: "pending",
        },
      ]
      await h.durableStorage.set(`workflow/${workflowId}`, workflow)
      await h.durableStorage.set(`scope/${workflowId}/worker-a`, {
        workflowId,
        stepId: "worker-a",
        write: ["src/a/**"],
      })
      await h.durableStorage.set(`scope/${workflowId}/worker-b`, {
        workflowId,
        stepId: "worker-b",
        write: ["src/b/**"],
      })

      const evaluate = h.permissionHooks.get("evaluate")
      expect(evaluate).toBeDefined()

      // Only B has an exact grant. Runnable ordering must not charge A.
      const grantB = await h.call(
        "dispatch_grant",
        { workflowId, stepId: "worker-b" },
        "general",
        "parent",
      )
      expect(grantB.error).toBeUndefined()

      // A different same-agent target is refused before it can create the
      // fail-closed ambiguity defended against below.
      const prematureA = await h.call(
        "dispatch_grant",
        { workflowId, stepId: "worker-a" },
        "general",
        "parent",
      )
      expect(prematureA.error).toContain("unadmitted worker dispatch grant already targets step worker-b")

      const dispatchB: any = {
        agent: "general",
        action: "subagent",
        resources: ["worker"],
        sessionID: "parent",
        source: { messageID: "same-agent-message-b", id: "same-agent-dispatch-b" },
        effect: "allow",
        message: "",
      }
      await evaluate!(dispatchB)
      expect(dispatchB.effect).not.toBe("deny")

      const afterB: any = await h.durableStorage.get(`budget/${workflowId}`)
      expect(afterB.byKey["step:worker-b"]).toBe(1)
      expect(afterB.byKey["step:worker-a"]).toBeUndefined()

      const storedB: any = await h.durableStorage.get(`dispatch-grant/${grantB.grantId}`)
      expect(storedB.admittedAt).toBeDefined()
      expect(storedB.admittedDispatchId).toContain("same-agent-dispatch-b")

      // An admitted B grant leaves the target-selection pool but remains
      // consumable by B's child. A can therefore launch in parallel.
      const grantA = await h.call(
        "dispatch_grant",
        { workflowId, stepId: "worker-a" },
        "general",
        "parent",
      )
      expect(grantA.error).toBeUndefined()

      const dispatchA: any = {
        agent: "general",
        action: "subagent",
        resources: ["worker"],
        sessionID: "parent",
        source: { messageID: "same-agent-message-a", id: "same-agent-dispatch-a" },
        effect: "allow",
        message: "",
      }
      await evaluate!(dispatchA)
      expect(dispatchA.effect).not.toBe("deny")

      const afterA: any = await h.durableStorage.get(`budget/${workflowId}`)
      expect(afterA.byKey["step:worker-a"]).toBe(1)
      expect(afterA.byKey["step:worker-b"]).toBe(1)

      expect((await h.call(
        "attach",
        { workflowId, stepId: "worker-b", grantId: grantB.grantId },
        "worker",
        "worker-b-child",
      )).attached).toBe(true)
      expect((await h.call(
        "attach",
        { workflowId, stepId: "worker-a", grantId: grantA.grantId },
        "worker",
        "worker-a-child",
      )).attached).toBe(true)

      // Normal tool use cannot create two unadmitted same-agent grants.
      // Seed a legacy/corrupt second grant directly to prove the permission
      // hook still fails closed if such state is encountered after upgrade.
      const grantA2 = await h.call(
        "dispatch_grant",
        { workflowId, stepId: "worker-a" },
        "general",
        "parent",
      )
      expect(grantA2.error).toBeUndefined()
      const storedA2: any = await h.durableStorage.get(`dispatch-grant/${grantA2.grantId}`)
      const legacyGrantB = {
        ...storedA2,
        grantId: "legacy-ambiguous-worker-b",
        stepId: "worker-b",
      }
      await h.durableStorage.set("dispatch-grant/legacy-ambiguous-worker-b", legacyGrantB)

      const ambiguous: any = {
        agent: "general",
        action: "subagent",
        resources: ["worker"],
        sessionID: "parent",
        source: { messageID: "same-agent-message-ambiguous", id: "same-agent-dispatch-ambiguous" },
        effect: "allow",
        message: "",
      }
      await evaluate!(ambiguous)
      expect(ambiguous.effect).toBe("deny")
      expect(ambiguous.message).toContain("Multiple usable dispatch grants")

      const afterAmbiguous: any = await h.durableStorage.get(`budget/${workflowId}`)
      expect(afterAmbiguous.byKey["step:worker-a"]).toBe(1)
      expect(afterAmbiguous.byKey["step:worker-b"]).toBe(1)
    } finally {
      h.restore()
    }
  })
})

function richPlanTask(id: string, title: string, objective: string, dependsOn: string[] = []): WorkPlanTask {
  return {
    id,
    title,
    objective,
    rationale: `${title} is required by the accepted test Objective.`,
    dependsOn,
    authorityRefs: ["docs/anchors/test/anchor.md"],
    constraints: [],
    acceptanceCriteria: [`${title} completes its accepted contribution.`],
    subtasks: [],
    integration: [],
    verify: ["bun test"],
    role: "worker",
    responsibility: "execute",
  }
}

function richPlanDefinition(phases: any[]) {
  return {
    goal: "Deliver the accepted test Objective.",
    assumptions: [],
    outOfScope: [],
    authorityRefs: ["docs/anchors/test/anchor.md"],
    obligations: [],
    riskBoundaries: [],
    acceptanceCoverage: [],
    relationships: [],
    correctionRouting: [],
    phases: phases.map((phase) => ({
      ...phase,
      objective: phase.objective ?? `Deliver ${phase.title}.`,
      waves: phase.waves.map((wave: any) => ({
        ...wave,
        objective: wave.objective ?? `Complete ${wave.title}.`,
        constraints: wave.constraints ?? [],
      })),
    })),
  }
}

function richWorkPlanInput(workflowId: string, phases: any[], extra: Record<string, unknown> = {}) {
  return { workflowId, ...richPlanDefinition(phases), ...extra }
}

async function waveLifecycleFixture(
  workLevel: "wave" | "objective" = "wave",
  includeFutureWave = false,
  taskRole = "worker",
  includeDependentWorker = false,
  taskResponsibility: "produce" | "execute" | "review" | "obtain-user-decision" = "execute",
  dependentRole = "worker",
  includeLastFutureWave = false,
) {
  const h = await harness()
  try {
    const { workflowId } = await h.call("start", { anchor: "docs/anchors/lifecycle/anchor.md" }, "general", "parent")
    const attach = async (stepId: string, agent: string, sessionID = `${stepId}-child`) => {
      const grant = await h.call("dispatch_grant", { workflowId, stepId }, "general", "parent")
      expect(grant.error).toBeUndefined()
      const result = await h.call("attach", { workflowId, stepId, grantId: grant.grantId }, agent, sessionID)
      expect(result.error).toBeUndefined()
      return sessionID
    }
    const finish = async (stepId: string, agent: string, outcome = "complete") => {
      const sessionID = await attach(stepId, agent)
      return h.call("complete", { workflowId, stepId, outcome, summary: "Lifecycle test fixture" }, agent, sessionID)
    }
    await h.call("route", {
      humanFacing: false, behavioral: false, structural: false, externalUnknown: false,
      diagnostic: false, productOutcome: true, implementationRequested: true,
      executionDepth: "objective", workLevel,
    }, "general", "parent")
    expect((await finish("critic-solution", "critic", "pass")).error).toBeUndefined()
    const planner = await attach("plan", "planner")
    const task: WorkPlanTask = { ...richPlanTask("one", "One", "Build one"), role: taskRole, responsibility: taskResponsibility }
    const future = richPlanTask("two", "Two", "Build two", ["one"])
    const dependentWorker: WorkPlanTask = {
      ...richPlanTask("dependent", "Dependent", "Consume independently reviewed work", ["one"]),
      role: dependentRole,
      responsibility: dependentRole === "reviewer" ? "review" : dependentRole === "user" ? "obtain-user-decision" : dependentRole === "worker" ? "execute" : "produce",
    }
    expect((await h.call("work_plan", richWorkPlanInput(workflowId, [
      {
        id: "core",
        title: "Core",
        waves: [
          { id: "first", title: "First", tasks: [task, ...(includeDependentWorker ? [dependentWorker] : [])] },
          ...(includeFutureWave ? [
            { id: "second", title: "Second", tasks: [future] },
            ...(includeLastFutureWave ? [{
              id: "last",
              title: "Last",
              tasks: [richPlanTask("three", "Three", "Build three without changing the active Wave.")],
            }] : []),
          ] : []),
        ],
      },
    ]), "planner", planner)).error).toBeUndefined()
    expect((await h.call("task_plan", {
      workflowId, tasks: [
        { ...task, write: taskResponsibility === "obtain-user-decision" ? [] : taskRole === "worker" ? ["src/**"] : ["docs/architecture/**"], skills: [] },
        ...(includeDependentWorker ? [{ ...dependentWorker, write: dependentRole === "user" ? [] : dependentRole === "worker" ? ["src/**"] : ["docs/architecture/**"], skills: [] }] : []),
      ],
    }, "planner", planner)).error).toBeUndefined()
    expect((await h.call("complete", { workflowId, stepId: "plan", summary: "Planned" }, "planner", planner)).error).toBeUndefined()
    const workflow = () => h.durableStorage.get(`workflow/${workflowId}`) as Promise<any>
    const workKey = `work/${encodeURIComponent((await workflow()).work.objectiveId)}`
    const work = () => h.durableStorage.get(workKey) as Promise<any>

    const beforePlanReview = await work()
    expect(beforePlanReview.nodes.find((node: any) => node.type === "wave" && node.logicalId === "first").claimedByWorkflowId).toBeUndefined()
    expect((await h.call("dispatch_grant", {
      workflowId,
      stepId: "task:one",
    }, "general", "parent")).error).toContain("not currently runnable")

    expect((await finish("review-plan", "reviewer", "pass")).error).toBeUndefined()
    const afterPlanReview = await work()
    expect(afterPlanReview.nodes.find((node: any) => node.type === "wave" && node.logicalId === "first").claimedByWorkflowId).toBe(workflowId)

    const finishKnowledge = async () => {
      const child = await attach("knowledge-sync", "documenter")
      const oldIds = new Set((await h.call("evidence_observations", { detail: true }, "documenter", child)).observations.map((item: any) => item.id))
      const discovery = { tool: "okf-mcp_list_docs", callID: crypto.randomUUID(), sessionID: child,
        agent: "documenter", input: {} }
      await h.toolHooks.get("execute.before")!(discovery)
      await h.toolHooks.get("execute.after")!({ ...discovery, status: "completed", result: [] })
      const observations = await h.call("evidence_observations", { detail: true }, "documenter", child)
      expect((await h.call("knowledge_record", {
        workflowId, changedDocs: [], unchangedReason: "The fixture has no documentation changes.",
        okfObservationIds: observations.observations.filter((item: any) => !oldIds.has(item.id)).map((item: any) => item.id),
      }, "documenter", child)).error).toBeUndefined()
      return h.call("complete", { workflowId, stepId: "knowledge-sync", summary: "Knowledge checked" }, "documenter", child)
    }
    return { ...h, workflowId, attach, finish, workflow, work, workKey, finishKnowledge }
  } catch (error) {
    h.restore()
    throw error
  }
}

test("status, grant issuance, and launch share reviewed planned dispatch admission", async () => {
  const h = await waveLifecycleFixture()
  try {
    const preexistingGrant = await h.call("dispatch_grant", {
      workflowId: h.workflowId,
      stepId: "task:one",
    }, "general", "parent")
    expect(preexistingGrant.error).toBeUndefined()

    const staleWorkflow = await h.workflow()
    expect(staleWorkflow.steps.find((step: any) => step.id === "review-plan").status).toBe("passed")
    expect(staleWorkflow.work.reviewedPlanRevision).toBeDefined()
    expect(staleWorkflow.work.reviewedPlanFingerprint).toBeDefined()

    delete staleWorkflow.work.reviewedPlanRevision
    delete staleWorkflow.work.reviewedPlanFingerprint
    await h.durableStorage.set(`workflow/${h.workflowId}`, staleWorkflow)

    const status = await h.call("status", { workflowId: h.workflowId }, "general", "parent")
    const readiness = status.readiness.find((step: any) => step.step === "task:one")
    expect(readiness).toMatchObject({
      structurallyRunnable: true,
      dispatch: { state: "blocked" },
    })
    expect(readiness.dispatch.reason).toContain("reviewed claimed-Wave contract")

    const newGrant = await h.call("dispatch_grant", {
      workflowId: h.workflowId,
      stepId: "task:one",
    }, "general", "parent")
    expect(newGrant.error).toContain("reviewed claimed-Wave contract")

    const permission: any = {
      agent: "general",
      action: "subagent",
      resources: ["worker"],
      sessionID: "parent",
      source: { messageID: "stale-reviewed-plan", id: "stale-reviewed-plan" },
      effect: "allow",
      message: "",
    }
    await h.permissionHooks.get("evaluate")!(permission)
    expect(permission.effect).toBe("deny")
    expect(permission.message).toContain("reviewed claimed-Wave contract")

    const storedGrant = await h.durableStorage.get(
      `dispatch-grant/${preexistingGrant.grantId}`,
    ) as any
    expect(storedGrant.admittedAt).toBeUndefined()
  } finally {
    h.restore()
  }
})

test("role-owned Task dispatch is exact and stays incomplete until its independent Wave review", async () => {
  const h = await waveLifecycleFixture("wave", false, "architect")
  try {
    const grant = await h.call("dispatch_grant", { workflowId: h.workflowId, stepId: "task:one" }, "general", "parent")
    expect(grant.error).toBeUndefined()
    const impostor = await h.call("attach", {
      workflowId: h.workflowId, stepId: "task:one", grantId: grant.grantId,
    }, "worker", "role-task-impostor")
    expect(impostor.error).toContain("architect")

    const architect = await h.attach("task:one", "architect", "role-task-architect")
    expect((await h.call("complete", {
      workflowId: h.workflowId, stepId: "task:one", summary: "Architecture contribution",
    }, "architect", architect)).error).toBeUndefined()
    expect((await h.workflow()).steps.some((step: any) => step.agent === "worker")).toBe(false)
    let work = await h.work()
    const workTask = work.nodes.find((node: any) => node.type === "task" && node.logicalId === "one")
    expect(workTask.status).toBe("pending")
    expect(workTask.result.summary).toBe("Architecture contribution")

    const reviewer = await h.attach("review-implementation", "reviewer", "role-task-reviewer")
    expect((await h.call("complete", {
      workflowId: h.workflowId, stepId: "review-implementation", outcome: "pass", summary: "Role output reviewed",
    }, "reviewer", reviewer)).error).toBeUndefined()
    work = await h.work()
    expect(work.nodes.find((node: any) => node.type === "task" && node.logicalId === "one").status).toBe("complete")
    const wave = work.nodes.find((node: any) => node.type === "wave" && node.logicalId === "first")
    expect(wave.status).toBe("complete")
    expect(wave.completion.bindingFingerprint).toMatch(/^[a-f0-9]{64}$/)

    const workflowKey = `workflow/${h.workflowId}`
    const completedWorkflow = await h.durableStorage.get(workflowKey) as any
    completedWorkflow.steps.find((step: any) => step.id === "task:one").agent = "designer"
    await h.durableStorage.set(workflowKey, completedWorkflow)
    const staleGraphReopen = await h.call("reopen", {
      workflowId: h.workflowId, stepId: "review-implementation", reason: "Test stale Task role graph receipt.",
      newEvidence: true, changedHypothesis: false, changedStrategy: false, reducedUnresolved: false,
    }, "general", "parent")
    expect(staleGraphReopen.error).toContain("does not match the current Task role/slot graph and independent gates")
    expect((await h.durableStorage.get(workflowKey) as any).steps.find((step: any) => step.id === "review-implementation").status).toBe("passed")
    expect((await h.work()).nodes.find((node: any) => node.type === "wave" && node.logicalId === "first").completion.bindingFingerprint).toBe(wave.completion.bindingFingerprint)
  } finally {
    h.restore()
  }
})

test("same-Wave specialist handoff blocks Worker consumption until its bound Reviewer gate passes", async () => {
  const h = await waveLifecycleFixture("wave", false, "architect", true)
  try {
    const workflow = await h.workflow()
    const dependent = workflow.steps.find((step: any) => step.id === "task:dependent")
    expect(dependent.agent).toBe("worker")
    expect(dependent.dependsOn).toContain("task-review:one")
    expect((await h.call("dispatch_grant", {
      workflowId: h.workflowId, stepId: "task:dependent",
    }, "general", "parent")).error).toContain("not currently runnable")

    const architect = await h.attach("task:one", "architect", "handoff-architect")
    expect((await h.call("complete", {
      workflowId: h.workflowId, stepId: "task:one", summary: "Specialist result",
    }, "architect", architect)).error).toBeUndefined()
    expect((await h.work()).nodes.find((node: any) => node.type === "task" && node.logicalId === "one").status).toBe("pending")
    expect((await h.call("dispatch_grant", {
      workflowId: h.workflowId, stepId: "task:dependent",
    }, "general", "parent")).error).toContain("not currently runnable")

    const reviewer = await h.attach("task-review:one", "reviewer", "handoff-reviewer")
    expect((await h.call("complete", {
      workflowId: h.workflowId, stepId: "task-review:one", outcome: "pass", summary: "Specialist result verified",
    }, "reviewer", reviewer)).error).toBeUndefined()
    expect((await h.work()).nodes.find((node: any) => node.type === "task" && node.logicalId === "one").status).toBe("complete")
    const worker = await h.attach("task:dependent", "worker", "handoff-worker")
    expect((await h.call("complete", {
      workflowId: h.workflowId, stepId: "task:dependent", summary: "Consumed reviewed result",
    }, "worker", worker)).error).toBeUndefined()
  } finally {
    h.restore()
  }
})

test("same-Wave Worker result is reviewed before a specialist-dependent Task is dispatched", async () => {
  const h = await waveLifecycleFixture("wave", false, "worker", true, "execute", "architect")
  try {
    const workflow = await h.workflow()
    const specialist = workflow.steps.find((step: any) => step.id === "task:dependent")
    expect(specialist.agent).toBe("architect")
    expect(specialist.dependsOn).toContain("task-review:one")
    expect((await h.call("dispatch_grant", {
      workflowId: h.workflowId, stepId: "task:dependent",
    }, "general", "parent")).error).toContain("not currently runnable")

    const worker = await h.attach("task:one", "worker", "worker-source")
    expect((await h.call("complete", {
      workflowId: h.workflowId, stepId: "task:one", summary: "Worker result awaiting independent review",
    }, "worker", worker)).error).toBeUndefined()
    expect((await h.call("dispatch_grant", {
      workflowId: h.workflowId, stepId: "task:dependent",
    }, "general", "parent")).error).toContain("not currently runnable")

    const reviewer = await h.attach("task-review:one", "reviewer", "worker-result-reviewer")
    expect((await h.call("complete", {
      workflowId: h.workflowId, stepId: "task-review:one", outcome: "pass", summary: "Worker result independently reviewed",
    }, "reviewer", reviewer)).error).toBeUndefined()
    expect((await h.work()).nodes.find((node: any) => node.type === "task" && node.logicalId === "one").status).toBe("complete")
    const architect = await h.attach("task:dependent", "architect", "worker-result-architect")
    expect((await h.call("complete", {
      workflowId: h.workflowId, stepId: "task:dependent", summary: "Specialist consumed reviewed Worker result",
    }, "architect", architect)).error).toBeUndefined()
  } finally {
    h.restore()
  }
})

test("user-owned decision waits resolve only from a blocking exact-task OQ recorded as user", async () => {
  const h = await waveLifecycleFixture("wave", false, "user", false, "obtain-user-decision")
  try {
    const before = await h.workflow()
    const wait = before.steps.find((step: any) => step.id === "task:one")
    expect(wait).toMatchObject({ agent: "user", kind: "wait", status: "waiting" })
    expect((await h.call("task_status", { workflowId: h.workflowId, taskId: "one" }, "general", "parent")).tasks[0]).toMatchObject({
      decisionWait: true, decisionReady: true, runnable: false,
    })
    expect((await h.call("dispatch_grant", {
      workflowId: h.workflowId, stepId: "task:one",
    }, "general", "parent")).error).toContain("not currently runnable")
    expect((await h.call("complete", {
      workflowId: h.workflowId, stepId: "task:one", summary: "General guesses for user",
    }, "general", "parent")).error).toContain("exact attached workflow step")

    const raised = await h.call("oq_raise", {
      workflowId: h.workflowId,
      taskId: "one",
      question: "Choose the accepted behavior for this Task.",
      responder: "user",
      blocking: true,
      consumerStepIds: ["task:one"],
    }, "general", "parent")
    expect(raised.error).toBeUndefined()
    expect(raised.question.work.stepAttempt).toBe(wait.attempt ?? 0)
    const answered = await h.call("oq_answer", {
      workflowId: h.workflowId, questionId: raised.question.id, answer: "The user-selected behavior.", source: "user",
    }, "general", "parent")
    expect(answered.error).toBeUndefined()
    expect(answered.question.status).toBe("closed")
    expect(answered.question.answer).toMatchObject({ by: "user", source: "user", text: "The user-selected behavior." })
    const after = await h.workflow()
    expect(after.steps.find((step: any) => step.id === "task:one").status).toBe("complete")
    const task = (await h.work()).nodes.find((node: any) => node.type === "task" && node.logicalId === "one")
    expect(task.status).toBe("complete")
    expect(task.result.summary).toBe("The user-selected behavior.")
    expect((await h.call("oq_reopen", {
      workflowId: h.workflowId, questionId: raised.question.id, preserveAnswer: false,
      reason: "A changed decision must reopen its dependent Task first.",
    }, "general", "parent")).error).toContain("Reopen the exact decision Task first")
  } finally {
    h.restore()
  }
})

test("Planner amendment schema accepts role corrections and role-owned Tasks in a new Phase", async () => {
  const h = await harness()
  try {
    const start = await h.call("start", { anchor: "docs/anchors/test/anchor.md" }, "general", "role-amend-general")
    const workflowId = String(start.workflowId)
    expect((await h.call("route", {
      humanFacing: false, behavioral: false, structural: false, externalUnknown: false,
      diagnostic: false, productOutcome: true, implementationRequested: true,
      executionDepth: "objective", workLevel: "wave",
    }, "general", "role-amend-general")).error).toBeUndefined()
    const grant = await h.call("dispatch_grant", { workflowId, stepId: "critic-solution" }, "general", "role-amend-general")
    const critic = await h.call("attach", { workflowId, stepId: "critic-solution", grantId: grant.grantId }, "critic", "role-amend-critic")
    expect(critic.error).toBeUndefined()
    expect((await h.call("complete", { workflowId, stepId: "critic-solution", outcome: "pass", summary: "ready" }, "critic", "role-amend-critic")).error).toBeUndefined()
    const plannerGrant = await h.call("dispatch_grant", { workflowId, stepId: "plan" }, "general", "role-amend-general")
    const planner = await h.call("attach", { workflowId, stepId: "plan", grantId: plannerGrant.grantId }, "planner", "role-amend-planner")
    expect(planner.error).toBeUndefined()
    const original = richPlanTask("existing", "Existing", "Existing owned contribution")
    const planned = await h.call("work_plan", richWorkPlanInput(workflowId, [{
      id: "core", title: "Core", waves: [{ id: "first", title: "First", tasks: [original] }],
    }]), "planner", "role-amend-planner")
    expect(planned.error).toBeUndefined()
    const added = richPlanTask("added", "Added", "New contribution in the amended Phase")
    const amended = await h.call("work_amend", {
      workflowId,
      expectedVersion: planned.version,
      reason: "Correct the accountable role and add a role-owned future Phase.",
      operations: [
        { action: "patch-task", taskId: "existing", patch: { role: "architect", responsibility: "produce" } },
        { action: "add-phase", phase: {
          id: "future", title: "Future", objective: "Continue with explicit ownership.", waves: [{
            id: "later", title: "Later", objective: "Deliver the later contribution.", constraints: [], tasks: [added],
          }],
        } },
      ],
    }, "planner", "role-amend-planner")
    expect(amended.error).toBeUndefined()
    const work = await h.durableStorage.get(`work/${encodeURIComponent(String(planned.objectiveId))}`) as any
    const currentPlan = work.plans.find((candidate: any) => candidate.generation === work.generation)
    expect(currentPlan.phases.find((phase: any) => phase.id === "core").waves[0].tasks[0]).toMatchObject({
      id: "existing", role: "architect", responsibility: "produce",
    })
    expect(currentPlan.phases.find((phase: any) => phase.id === "future").waves[0].tasks[0]).toMatchObject({
      id: "added", role: "worker", responsibility: "execute",
    })
  } finally {
    h.restore()
  }
})

test("planning-only Objective cannot complete or review an invalidated Plan", async () => {
  const h = await harness()
  try {
    const started = await h.call(
      "start",
      { anchor: "docs/anchors/test/anchor.md" },
      "general",
      "planning-only-invalidated-general",
    )
    const workflowId = String(started.workflowId)
    expect((await h.call("route", {
      humanFacing: false,
      behavioral: false,
      structural: false,
      externalUnknown: false,
      diagnostic: false,
      productOutcome: true,
      implementationRequested: false,
      executionDepth: "objective",
    }, "general", "planning-only-invalidated-general")).error).toBeUndefined()

    const attach = async (id: string, agent: string, sessionID: string) => {
      const grant = await h.call(
        "dispatch_grant",
        { workflowId, stepId: id },
        "general",
        "planning-only-invalidated-general",
      )
      expect(grant.error).toBeUndefined()
      const attached = await h.call(
        "attach",
        { workflowId, stepId: id, grantId: grant.grantId },
        agent,
        sessionID,
      )
      expect(attached.error).toBeUndefined()
      return attached
    }

    await attach("critic-solution", "critic", "planning-only-invalidated-critic")
    expect((await h.call("complete", {
      workflowId,
      stepId: "critic-solution",
      outcome: "pass",
      summary: "Planning premise ready.",
    }, "critic", "planning-only-invalidated-critic")).error).toBeUndefined()

    await attach("plan", "planner", "planning-only-invalidated-planner")
    const task = richPlanTask("first", "First capability", "Deliver first capability")
    const planned = await h.call("work_plan", richWorkPlanInput(workflowId, [{
      id: "delivery",
      title: "Delivery",
      waves: [{ id: "first-wave", title: "First wave", tasks: [task] }],
    }]), "planner", "planning-only-invalidated-planner")
    expect(planned.error).toBeUndefined()

    const invalidated = await h.call("work_invalidate", {
      workflowId,
      expectedVersion: planned.version,
      reason: "New evidence invalidates the decomposition before review.",
    }, "planner", "planning-only-invalidated-planner")
    expect(invalidated.error).toBeUndefined()

    const completion = await h.call("complete", {
      workflowId,
      stepId: "plan",
      summary: "Invalidated Plan must not be reviewable.",
    }, "planner", "planning-only-invalidated-planner")
    expect(completion.error).toContain("invalidated Plan")
  } finally {
    h.restore()
  }
})

test("fresh workflow adjudicates Critic over carried invalidation, replans, and gates all execution on gen2 review", async () => {
  const h = await waveLifecycleFixture()
  try {
    const oldWorkflowId = h.workflowId
    const oldWorkflow = await h.workflow()
    const oldCriticSummary = oldWorkflow.steps.find((step: any) => step.id === "critic-solution").summary
    const carriedAtStart = await h.work()
    const oldPlan = carriedAtStart.plans.find((plan: any) => plan.generation === 1)

    expect((await h.call("work_release", {
      workflowId: oldWorkflowId,
      reason: "Release the old unconsumed Wave before Plan invalidation.",
    }, "general", "parent")).error).toBeUndefined()
    const raised = await h.call("oq_raise", {
      workflowId: oldWorkflowId,
      stepId: "plan",
      question: "Invalidate the old Plan before starting a fresh planning workflow.",
      responder: "planner",
      blocking: false,
    }, "general", "parent")
    expect(raised.error).toBeUndefined()
    const oldOqGrant = await h.call("dispatch_grant", {
      workflowId: oldWorkflowId,
      questionId: raised.question.id,
    }, "general", "parent")
    expect(oldOqGrant.error).toBeUndefined()
    const oldPlanner = "planner-before-cancel"
    expect((await h.call("attach", {
      workflowId: oldWorkflowId,
      questionId: raised.question.id,
      grantId: oldOqGrant.grantId,
    }, "planner", oldPlanner)).attached).toBe(true)
    const invalidated = await h.call("work_invalidate", {
      workflowId: oldWorkflowId,
      questionId: raised.question.id,
      expectedVersion: (await h.work()).version,
      reason: "The first Objective Plan is invalidated and retained as history.",
    }, "planner", oldPlanner)
    expect(invalidated.error).toBeUndefined()
    expect((await h.call("cancel", cancellationRequest(oldWorkflowId), "general", "parent")).cancelled).toBe(true)

    const started = await h.call("start", {
      anchor: "docs/anchors/lifecycle/anchor.md",
    }, "general", "parent")
    const freshWorkflowId = String(started.workflowId)
    expect((await h.call("route", {
      humanFacing: false,
      behavioral: false,
      structural: false,
      externalUnknown: false,
      diagnostic: false,
      productOutcome: true,
      implementationRequested: true,
      executionDepth: "objective",
      workLevel: "wave",
    }, "general", "parent")).error).toBeUndefined()

    const freshCriticGrant = await h.call("dispatch_grant", {
      workflowId: freshWorkflowId,
      stepId: "critic-solution",
    }, "general", "parent")
    expect(freshCriticGrant.error).toBeUndefined()
    const freshCritic = "critic-fresh-workflow"
    expect((await h.call("attach", {
      workflowId: freshWorkflowId,
      stepId: "critic-solution",
      grantId: freshCriticGrant.grantId,
    }, "critic", freshCritic)).attached).toBe(true)
    expect((await h.call("complete", {
      workflowId: freshWorkflowId,
      stepId: "critic-solution",
      outcome: "pass",
      summary: "Fresh Critic adjudication proceeds while invalidated Plan remains historical.",
    }, "critic", freshCritic)).error).toBeUndefined()

    const carriedWork = await h.durableStorage.get(`work/${encodeURIComponent(carriedAtStart.objectiveId)}`) as any
    expect(carriedWork.generation).toBe(1)
    expect(carriedWork.plans.find((plan: any) => plan.generation === 1).invalidated.reason)
      .toBe("The first Objective Plan is invalidated and retained as history.")
    const invalidatedPlanHistory = structuredClone(
      carriedWork.plans.find((plan: any) => plan.generation === 1),
    )
    const plannerGrant = await h.call("dispatch_grant", {
      workflowId: freshWorkflowId,
      stepId: "plan",
    }, "general", "parent")
    expect(plannerGrant.error).toBeUndefined()
    const freshPlanner = "planner-fresh-workflow"
    expect((await h.call("attach", {
      workflowId: freshWorkflowId,
      stepId: "plan",
      grantId: plannerGrant.grantId,
    }, "planner", freshPlanner)).attached).toBe(true)

    const oldTask = oldPlan.phases[0].waves[0].tasks[0]
    const staleCompile = await h.call("task_plan", {
      workflowId: freshWorkflowId,
      tasks: [{ ...oldTask, write: ["src/**"], skills: [] }],
    }, "planner", freshPlanner)
    expect(staleCompile.error).toContain("invalidated")
    expect((await h.call("dispatch_grant", {
      workflowId: freshWorkflowId,
      stepId: "task:one",
    }, "general", "parent")).error).toContain("Step not found")
    expect(() => claimWorkflowWave(
      carriedWork,
      freshWorkflowId,
      1,
      [{ ...oldTask, write: ["src/**"], skills: [] }],
      false,
      new Date().toISOString(),
    )).toThrow("invalidated")

    const freshTask: WorkPlanTask = {
      ...richPlanTask("fresh-one", "Fresh One", "Deliver from a new semantic Plan generation"),
      role: "worker",
      responsibility: "execute",
    }
    const versionBeforeReplacement = carriedWork.version
    const replanned = await h.call("work_plan", richWorkPlanInput(freshWorkflowId, [{
      id: "fresh-delivery",
      title: "Fresh delivery",
      waves: [{ id: "fresh-wave", title: "Fresh wave", tasks: [freshTask] }],
    }], {
      expectedVersion: versionBeforeReplacement,
      replaceReason: "Create a fresh semantic generation after preserving invalidated history.",
    }), "planner", freshPlanner)
    expect(replanned.error).toBeUndefined()
    expect(replanned.generation).toBe(2)

    const generation2 = await h.durableStorage.get(`work/${encodeURIComponent(carriedAtStart.objectiveId)}`) as any
    expect(generation2.plans.find((plan: any) => plan.generation === 1)).toEqual(invalidatedPlanHistory)
    expect(generation2.plans.some((plan: any) => plan.generation === 2)).toBe(true)
    const newSemanticTask = generation2.plans.find((plan: any) => plan.generation === 2).phases[0].waves[0].tasks[0]
    expect((await h.call("task_plan", {
      workflowId: freshWorkflowId,
      tasks: [{ ...newSemanticTask, write: ["src/**"], skills: [] }],
    }, "planner", freshPlanner)).error).toBeUndefined()
    expect((await h.call("complete", {
      workflowId: freshWorkflowId,
      stepId: "plan",
      summary: "Generation 2 is compiled and ready for independent review.",
    }, "planner", freshPlanner)).error).toBeUndefined()
    expect((await h.call("dispatch_grant", {
      workflowId: freshWorkflowId,
      stepId: "task:fresh-one",
    }, "general", "parent")).error).toContain("not currently runnable")

    const reviewGrant = await h.call("dispatch_grant", {
      workflowId: freshWorkflowId,
      stepId: "review-plan",
    }, "general", "parent")
    expect(reviewGrant.error).toBeUndefined()
    const reviewer = "reviewer-fresh-workflow"
    expect((await h.call("attach", {
      workflowId: freshWorkflowId,
      stepId: "review-plan",
      grantId: reviewGrant.grantId,
    }, "reviewer", reviewer)).attached).toBe(true)
    expect((await h.call("complete", {
      workflowId: freshWorkflowId,
      stepId: "review-plan",
      outcome: "pass",
      summary: "Independent review approved only fresh generation 2.",
    }, "reviewer", reviewer)).error).toBeUndefined()
    expect((await h.work()).nodes.find((node: any) => node.logicalId === "fresh-wave" && node.type === "wave")
      .claimedByWorkflowId).toBe(freshWorkflowId)

    const taskGrant = await h.call("dispatch_grant", {
      workflowId: freshWorkflowId,
      stepId: "task:fresh-one",
    }, "general", "parent")
    expect(taskGrant.error).toBeUndefined()
    expect((await h.call("attach", {
      workflowId: freshWorkflowId,
      stepId: "task:fresh-one",
      grantId: taskGrant.grantId,
    }, "worker", "worker-fresh-generation")).attached).toBe(true)

    const historicalWorkflow = await h.durableStorage.get(`workflow/${oldWorkflowId}`) as any
    expect(historicalWorkflow.cancellation).toBeDefined()
    expect(historicalWorkflow.steps.find((step: any) => step.id === "critic-solution").summary)
      .toBe(oldCriticSummary)
  } finally {
    h.restore()
  }
})

test("planning-only Reviewer findings reopen Planner and require a fresh review", async () => {
  const h = await harness()
  try {
    const started = await h.call(
      "start",
      { anchor: "docs/anchors/test/anchor.md" },
      "general",
      "planning-only-repair-general",
    )
    const workflowId = String(started.workflowId)
    expect((await h.call("route", {
      humanFacing: false,
      behavioral: false,
      structural: false,
      externalUnknown: false,
      diagnostic: false,
      productOutcome: true,
      implementationRequested: false,
      executionDepth: "objective",
    }, "general", "planning-only-repair-general")).error).toBeUndefined()

    const attach = async (id: string, agent: string, sessionID: string) => {
      const grant = await h.call(
        "dispatch_grant",
        { workflowId, stepId: id },
        "general",
        "planning-only-repair-general",
      )
      expect(grant.error).toBeUndefined()
      const attached = await h.call(
        "attach",
        { workflowId, stepId: id, grantId: grant.grantId },
        agent,
        sessionID,
      )
      expect(attached.error).toBeUndefined()
      return attached
    }

    await attach("critic-solution", "critic", "planning-only-repair-critic")
    expect((await h.call("complete", {
      workflowId,
      stepId: "critic-solution",
      outcome: "pass",
      summary: "Planning premise ready.",
    }, "critic", "planning-only-repair-critic")).error).toBeUndefined()

    await attach("plan", "planner", "planning-only-repair-planner-1")
    const task = richPlanTask("first", "First capability", "Deliver first capability")
    expect((await h.call("work_plan", richWorkPlanInput(workflowId, [{
      id: "delivery",
      title: "Delivery",
      waves: [{ id: "first-wave", title: "First wave", tasks: [task] }],
    }]), "planner", "planning-only-repair-planner-1")).error).toBeUndefined()
    expect((await h.call("complete", {
      workflowId,
      stepId: "plan",
      summary: "Initial holistic Plan ready for review.",
    }, "planner", "planning-only-repair-planner-1")).error).toBeUndefined()

    const firstReview = await attach("review-plan", "reviewer", "planning-only-repair-reviewer-1")
    expect(firstReview.planContext.revision).toBe(1)
    expect((await h.call("complete", {
      workflowId,
      stepId: "review-plan",
      outcome: "fail",
      summary: "Acceptance proof is too weak; add a discriminating near-miss criterion.",
    }, "reviewer", "planning-only-repair-reviewer-1")).error).toBeUndefined()

    let workflow = await h.durableStorage.get(`workflow/${workflowId}`) as any
    expect(workflow.steps.find((step: any) => step.id === "review-plan").status).toBe("failed")
    expect(workflow.steps.some((step: any) => step.id.startsWith("task:"))).toBe(false)

    const reopened = await h.call("reopen", {
      workflowId,
      stepId: "plan",
      reason: "Reviewer found a concrete Plan acceptance-coverage defect.",
      newEvidence: true,
      changedHypothesis: false,
      changedStrategy: true,
      reducedUnresolved: false,
    }, "general", "planning-only-repair-general")
    expect(reopened.error).toBeUndefined()

    await attach("plan", "planner", "planning-only-repair-planner-2")
    workflow = await h.durableStorage.get(`workflow/${workflowId}`) as any
    const objectiveId = workflow.work.objectiveId
    const before = await h.durableStorage.get(
      `work/${encodeURIComponent(objectiveId)}`,
    ) as any
    const amended = await h.call("work_amend", {
      workflowId,
      expectedVersion: before.version,
      reason: "Close Reviewer finding with a discriminating near-miss criterion.",
      operations: [{
        action: "patch-task",
        taskId: "first",
        patch: {
          acceptanceCriteria: [
            "First capability completes its accepted contribution.",
            "The near-miss path is explicitly rejected by the planned verification.",
          ],
          subtasks: ["Implement First capability", "Exercise the near-miss path"],
        },
      }],
    }, "planner", "planning-only-repair-planner-2")
    expect(amended.error).toBeUndefined()
    expect(amended.revision).toBe(2)

    expect((await h.call("complete", {
      workflowId,
      stepId: "plan",
      summary: "Reviewer finding corrected in Plan revision 2.",
    }, "planner", "planning-only-repair-planner-2")).error).toBeUndefined()

    const secondReview = await attach("review-plan", "reviewer", "planning-only-repair-reviewer-2")
    expect(secondReview.planContext.revision).toBe(2)
    expect((await h.call("complete", {
      workflowId,
      stepId: "review-plan",
      outcome: "pass",
      summary: "Revised holistic Plan independently reviewed.",
    }, "reviewer", "planning-only-repair-reviewer-2")).error).toBeUndefined()

    workflow = await h.durableStorage.get(`workflow/${workflowId}`) as any
    expect(workflow.steps.every((step: any) => ["complete", "passed"].includes(step.status))).toBe(true)
    expect(workflow.work.reviewedPlanRevision).toBe(2)
    expect(workflow.work.reviewedPlanFingerprint).toBeDefined()
    const work = await h.durableStorage.get(
      `work/${encodeURIComponent(objectiveId)}`,
    ) as any
    expect(work.objectiveStatus).toBe("active")
    expect(work.nodes.filter((node: any) => node.type === "wave").every(
      (node: any) => node.claimedByWorkflowId === undefined,
    )).toBe(true)
  } finally {
    h.restore()
  }
})

test("planning-only Objective reviews a durable Plan without execution and later implementation reuses it", async () => {
  const h = await harness()
  try {
    const started = await h.call(
      "start",
      { anchor: "docs/anchors/test/anchor.md" },
      "general",
      "planning-only-general",
    )
    expect(started.error).toBeUndefined()
    const workflowId = String(started.workflowId)

    const routed = await h.call("route", {
      humanFacing: false,
      behavioral: false,
      structural: false,
      externalUnknown: false,
      diagnostic: false,
      productOutcome: true,
      implementationRequested: false,
      executionDepth: "objective",
    }, "general", "planning-only-general")
    expect(routed.error).toBeUndefined()

    let workflow = await h.durableStorage.get(`workflow/${workflowId}`) as any
    expect(workflow.effects.workLevel).toBe("objective")
    expect(workflow.effects.workLevelAuto).toBe(false)
    expect(workflow.steps.map((step: any) => step.id)).toEqual([
      "critic-solution",
      "plan",
      "review-plan",
    ])

    const attach = async (id: string, agent: string, sessionID: string) => {
      const grant = await h.call(
        "dispatch_grant",
        { workflowId, stepId: id },
        "general",
        "planning-only-general",
      )
      expect(grant.error).toBeUndefined()
      const attached = await h.call(
        "attach",
        { workflowId, stepId: id, grantId: grant.grantId },
        agent,
        sessionID,
      )
      expect(attached.error).toBeUndefined()
      return attached
    }

    await attach("critic-solution", "critic", "planning-only-critic")
    expect((await h.call("complete", {
      workflowId,
      stepId: "critic-solution",
      outcome: "pass",
      summary: "Planning premise is ready.",
    }, "critic", "planning-only-critic")).error).toBeUndefined()

    await attach("plan", "planner", "planning-only-planner")
    const first = richPlanTask("first", "First capability", "Deliver the first capability")
    const second = richPlanTask("second", "Second capability", "Deliver the second capability", ["first"])
    const planned = await h.call("work_plan", richWorkPlanInput(workflowId, [{
      id: "delivery",
      title: "Delivery",
      waves: [
        { id: "first-wave", title: "First wave", tasks: [first] },
        { id: "second-wave", title: "Second wave", tasks: [second] },
      ],
    }]), "planner", "planning-only-planner")
    expect(planned.error).toBeUndefined()

    const executableAttempt = await h.call("task_plan", {
      workflowId,
      tasks: [{ ...first, write: ["src/first/**"], skills: [] }],
    }, "planner", "planning-only-planner")
    expect(executableAttempt.error).toContain("Planning-only Objective workflows do not compile executable Worker Tasks")

    expect((await h.call("complete", {
      workflowId,
      stepId: "plan",
      summary: "Holistic Plan persisted without execution authority.",
    }, "planner", "planning-only-planner")).error).toBeUndefined()

    const reviewAttach = await attach("review-plan", "reviewer", "planning-only-reviewer")
    expect(reviewAttach.planContext.goal).toBe("Deliver the accepted test Objective.")
    expect(reviewAttach.planContext.planMap).toHaveLength(1)

    const semanticTask = await h.call("task_status", {
      workflowId,
      taskId: "first",
    }, "reviewer", "planning-only-reviewer")
    expect(semanticTask.error).toBeUndefined()
    expect(semanticTask.tasks).toHaveLength(1)
    expect(semanticTask.tasks[0].executable).toBe(false)
    expect(semanticTask.tasks[0].scopeStatus).toBe("deferred-until-implementation")
    expect(semanticTask.tasks[0].task).toMatchObject({
      id: "first",
      objective: "Deliver the first capability",
    })
    expect(semanticTask.tasks[0].task.write).toBeUndefined()

    expect((await h.call("complete", {
      workflowId,
      stepId: "review-plan",
      outcome: "pass",
      summary: "Holistic semantic Plan independently reviewed.",
    }, "reviewer", "planning-only-reviewer")).error).toBeUndefined()

    workflow = await h.durableStorage.get(`workflow/${workflowId}`) as any
    expect(workflow.steps.some((step: any) => step.id.startsWith("task:"))).toBe(false)
    expect(workflow.steps.every((step: any) => ["complete", "passed"].includes(step.status))).toBe(true)
    expect(workflow.work.reviewedPlanRevision).toBe(1)
    expect(workflow.work.reviewedPlanFingerprint).toBeDefined()

    const work = await h.durableStorage.get(
      `work/${encodeURIComponent(workflow.work.objectiveId)}`,
    ) as any
    expect(work.objectiveStatus).toBe("active")
    expect(work.nodes.filter((node: any) => node.type === "wave").every(
      (node: any) => node.claimedByWorkflowId === undefined,
    )).toBe(true)

    const execution = await h.call(
      "start",
      { anchor: "docs/anchors/test/anchor.md" },
      "general",
      "planning-only-general",
    )
    expect(execution.error).toBeUndefined()
    const executionWorkflowId = String(execution.workflowId)

    expect((await h.call("route", {
      humanFacing: false,
      behavioral: false,
      structural: false,
      externalUnknown: false,
      diagnostic: false,
      productOutcome: true,
      implementationRequested: true,
      executionDepth: "objective",
    }, "general", "planning-only-general")).error).toBeUndefined()

    const attachExecution = async (id: string, agent: string, sessionID: string) => {
      const grant = await h.call(
        "dispatch_grant",
        { workflowId: executionWorkflowId, stepId: id },
        "general",
        "planning-only-general",
      )
      expect(grant.error).toBeUndefined()
      const attached = await h.call(
        "attach",
        { workflowId: executionWorkflowId, stepId: id, grantId: grant.grantId },
        agent,
        sessionID,
      )
      expect(attached.error).toBeUndefined()
      return attached
    }

    await attachExecution("critic-solution", "critic", "planning-only-execution-critic")
    expect((await h.call("complete", {
      workflowId: executionWorkflowId,
      stepId: "critic-solution",
      outcome: "pass",
      summary: "Existing reviewed Plan remains suitable for implementation.",
    }, "critic", "planning-only-execution-critic")).error).toBeUndefined()

    await attachExecution("plan", "planner", "planning-only-execution-planner")
    const compiled = await h.call("task_plan", {
      workflowId: executionWorkflowId,
      tasks: [{ ...first, write: ["src/first/**"], skills: [] }],
    }, "planner", "planning-only-execution-planner")
    expect(compiled.error).toBeUndefined()
    expect(compiled.workLevel).toBe("wave")
    expect((await h.call("complete", {
      workflowId: executionWorkflowId,
      stepId: "plan",
      summary: "Reused persistent Plan and compiled the first executable Wave.",
    }, "planner", "planning-only-execution-planner")).error).toBeUndefined()

    await attachExecution("review-plan", "reviewer", "planning-only-execution-reviewer")
    expect((await h.call("complete", {
      workflowId: executionWorkflowId,
      stepId: "review-plan",
      outcome: "pass",
      summary: "Executable first Wave independently reviewed.",
    }, "reviewer", "planning-only-execution-reviewer")).error).toBeUndefined()

    const executionWorkflow = await h.durableStorage.get(
      `workflow/${executionWorkflowId}`,
    ) as any
    const executionWork = await h.durableStorage.get(
      `work/${encodeURIComponent(executionWorkflow.work.objectiveId)}`,
    ) as any
    expect(
      executionWork.nodes.find((node: any) => node.type === "wave" && node.logicalId === "first-wave")
        .claimedByWorkflowId,
    ).toBe(executionWorkflowId)
  } finally {
    h.restore()
  }
})

test("planning-only review refuses an unavailable specialist path in a later Wave", async () => {
  const h = await harness()
  try {
    const start = await h.call("start", { anchor: "docs/anchors/test/anchor.md" }, "general", "future-role-general")
    const workflowId = String(start.workflowId)
    expect((await h.call("route", {
      humanFacing: false, behavioral: false, structural: false, externalUnknown: false,
      diagnostic: false, productOutcome: true, implementationRequested: false, executionDepth: "objective",
    }, "general", "future-role-general")).error).toBeUndefined()
    const attach = async (stepId: string, agent: string, session: string) => {
      const grant = await h.call("dispatch_grant", { workflowId, stepId }, "general", "future-role-general")
      expect(grant.error).toBeUndefined()
      expect((await h.call("attach", { workflowId, stepId, grantId: grant.grantId }, agent, session)).error).toBeUndefined()
    }
    await attach("critic-solution", "critic", "future-role-critic")
    expect((await h.call("complete", { workflowId, stepId: "critic-solution", outcome: "pass", summary: "ready" }, "critic", "future-role-critic")).error).toBeUndefined()
    await attach("plan", "planner", "future-role-planner")
    const first = richPlanTask("first", "First", "First Wave contribution")
    const future = { ...richPlanTask("future", "Future", "Later specialist contribution", ["first"]), role: "future-specialist" }
    expect((await h.call("work_plan", richWorkPlanInput(workflowId, [{
      id: "phase", title: "Phase", waves: [
        { id: "first-wave", title: "First", tasks: [first] },
        { id: "later-wave", title: "Later", tasks: [future] },
      ],
    }]), "planner", "future-role-planner")).error).toBeUndefined()
    expect((await h.call("complete", { workflowId, stepId: "plan", summary: "planned" }, "planner", "future-role-planner")).error).toBeUndefined()
    await attach("review-plan", "reviewer", "future-role-reviewer")
    const review = await h.call("complete", {
      workflowId, stepId: "review-plan", outcome: "pass", summary: "review attempted",
    }, "reviewer", "future-role-reviewer")
    expect(review.error).toContain("Task future (obligations: none) in phase/later-wave")
    expect(review.error).toContain("future-specialist has no supported Task execution slot")
    const persisted = await h.durableStorage.get(`workflow/${workflowId}`) as any
    expect(persisted.steps.find((step: any) => step.id === "review-plan").status).toBe("pending")
  } finally {
    h.restore()
  }
})

test("reviewed-Objective path requires Planner ownership correction for persisted role-less legacy Tasks", async () => {
  const h = await harness()
  try {
    const start = await h.call("start", { anchor: "docs/anchors/test/anchor.md" }, "general", "legacy-role-general")
    const workflowId = String(start.workflowId)
    expect((await h.call("route", {
      humanFacing: false, behavioral: false, structural: false, externalUnknown: false,
      diagnostic: false, productOutcome: true, implementationRequested: false, executionDepth: "objective",
    }, "general", "legacy-role-general")).error).toBeUndefined()
    const attach = async (stepId: string, agent: string, session: string) => {
      const grant = await h.call("dispatch_grant", { workflowId, stepId }, "general", "legacy-role-general")
      expect(grant.error).toBeUndefined()
      expect((await h.call("attach", { workflowId, stepId, grantId: grant.grantId }, agent, session)).error).toBeUndefined()
    }
    await attach("critic-solution", "critic", "legacy-role-critic")
    expect((await h.call("complete", { workflowId, stepId: "critic-solution", outcome: "pass", summary: "ready" }, "critic", "legacy-role-critic")).error).toBeUndefined()
    await attach("plan", "planner", "legacy-role-planner")
    const task = richPlanTask("unowned", "Legacy contribution", "A persisted legacy Plan Task")
    expect((await h.call("work_plan", richWorkPlanInput(workflowId, [{
      id: "phase", title: "Phase", waves: [{ id: "wave", title: "Wave", tasks: [task] }],
    }]), "planner", "legacy-role-planner")).error).toBeUndefined()
    expect((await h.call("complete", { workflowId, stepId: "plan", summary: "saved" }, "planner", "legacy-role-planner")).error).toBeUndefined()

    const workflow = await h.durableStorage.get(`workflow/${workflowId}`) as any
    const workKey = `work/${encodeURIComponent(workflow.work.objectiveId)}`
    const work = await h.durableStorage.get(workKey) as any
    const snapshot = work.plans.find((candidate: any) => candidate.generation === work.generation)
    delete snapshot.phases[0].waves[0].tasks[0].role
    delete snapshot.phases[0].waves[0].tasks[0].responsibility
    await h.durableStorage.set(workKey, work)

    await attach("review-plan", "reviewer", "legacy-role-reviewer")
    const review = await h.call("complete", {
      workflowId, stepId: "review-plan", outcome: "pass", summary: "should refuse unowned legacy Task",
    }, "reviewer", "legacy-role-reviewer")
    expect(review.error).toContain("Task unowned (obligations: none) in phase/wave")
    expect(review.error).toContain("accountable role and responsibility are required")
    expect((await h.durableStorage.get(`workflow/${workflowId}`) as any).steps.find((step: any) => step.id === "review-plan").status).toBe("pending")
    expect((await h.durableStorage.get(workKey) as any).nodes.find((node: any) => node.type === "wave").claimedByWorkflowId).toBeUndefined()

    expect((await h.call("reopen", {
      workflowId, stepId: "plan", reason: "Assign the legacy Task's accountable role before reviewing it.",
      newEvidence: true, changedHypothesis: false, changedStrategy: false, reducedUnresolved: false,
    }, "general", "legacy-role-general")).error).toBeUndefined()
    await attach("plan", "planner", "legacy-role-planner-corrected")
    const latestWork = await h.durableStorage.get(workKey) as any
    const correction = await h.call("work_amend", {
      workflowId, expectedVersion: latestWork.version, reason: "Correct legacy Task ownership.",
      operations: [{ action: "patch-task", taskId: "unowned", patch: { role: "worker", responsibility: "execute" } }],
    }, "planner", "legacy-role-planner-corrected")
    expect(correction.error).toBeUndefined()
    expect((await h.call("complete", {
      workflowId, stepId: "plan", summary: "Legacy Plan ownership corrected.",
    }, "planner", "legacy-role-planner-corrected")).error).toBeUndefined()
    await attach("review-plan", "reviewer", "legacy-role-reviewer-corrected")
    expect((await h.call("complete", {
      workflowId, stepId: "review-plan", outcome: "pass", summary: "Corrected role assignment independently reviewed.",
    }, "reviewer", "legacy-role-reviewer-corrected")).error).toBeUndefined()
    const correctedWorkflow = await h.durableStorage.get(`workflow/${workflowId}`) as any
    expect(correctedWorkflow.steps.find((step: any) => step.id === "review-plan").status).toBe("passed")
  } finally {
    h.restore()
  }
})

test("legacy Objective workflow without review-plan cannot immediately claim a newly assigned Task Wave", async () => {
  const h = await harness()
  try {
    const start = await h.call("start", { anchor: "docs/anchors/test/anchor.md" }, "general", "legacy-gate-general")
    const workflowId = String(start.workflowId)
    expect((await h.call("route", {
      humanFacing: false, behavioral: false, structural: false, externalUnknown: false,
      diagnostic: false, productOutcome: true, implementationRequested: true,
      executionDepth: "objective", workLevel: "wave",
    }, "general", "legacy-gate-general")).error).toBeUndefined()
    const criticGrant = await h.call("dispatch_grant", { workflowId, stepId: "critic-solution" }, "general", "legacy-gate-general")
    expect((await h.call("attach", { workflowId, stepId: "critic-solution", grantId: criticGrant.grantId }, "critic", "legacy-gate-critic")).error).toBeUndefined()
    expect((await h.call("complete", { workflowId, stepId: "critic-solution", outcome: "pass", summary: "ready" }, "critic", "legacy-gate-critic")).error).toBeUndefined()
    const plannerGrant = await h.call("dispatch_grant", { workflowId, stepId: "plan" }, "general", "legacy-gate-general")
    expect((await h.call("attach", { workflowId, stepId: "plan", grantId: plannerGrant.grantId }, "planner", "legacy-gate-planner")).error).toBeUndefined()
    const task = richPlanTask("legacy", "Legacy", "Newly assigned legacy route task")
    expect((await h.call("work_plan", richWorkPlanInput(workflowId, [{
      id: "phase", title: "Phase", waves: [{ id: "wave", title: "Wave", tasks: [task] }],
    }]), "planner", "legacy-gate-planner")).error).toBeUndefined()
    const workflowKey = `workflow/${workflowId}`
    const legacyWorkflow = await h.durableStorage.get(workflowKey) as any
    legacyWorkflow.steps = legacyWorkflow.steps.filter((step: any) => step.id !== "review-plan")
    await h.durableStorage.set(workflowKey, legacyWorkflow)

    const attempted = await h.call("task_plan", {
      workflowId, tasks: [{ ...task, write: ["src/**"], skills: [] }],
    }, "planner", "legacy-gate-planner")
    expect(attempted.error).toContain("no independent review-plan gate and cannot admit Tasks")
    const after = await h.durableStorage.get(workflowKey) as any
    expect(after.steps.some((step: any) => step.id === "task:legacy")).toBe(false)
    const work = await h.durableStorage.get(`work/${encodeURIComponent(after.work.objectiveId)}`) as any
    expect(work.nodes.find((node: any) => node.type === "wave").claimedByWorkflowId).toBeUndefined()
  } finally {
    h.restore()
  }
})

test("legacy role-less Plan Task is rejected at Task-plan admission with no Worker Step or Wave claim", async () => {
  const h = await harness()
  try {
    const start = await h.call("start", { anchor: "docs/anchors/test/anchor.md" }, "general", "unowned-admission-general")
    const workflowId = String(start.workflowId)
    expect((await h.call("route", {
      humanFacing: false, behavioral: false, structural: false, externalUnknown: false,
      diagnostic: false, productOutcome: true, implementationRequested: true,
      executionDepth: "objective", workLevel: "wave",
    }, "general", "unowned-admission-general")).error).toBeUndefined()
    const criticGrant = await h.call("dispatch_grant", { workflowId, stepId: "critic-solution" }, "general", "unowned-admission-general")
    expect((await h.call("attach", { workflowId, stepId: "critic-solution", grantId: criticGrant.grantId }, "critic", "unowned-admission-critic")).error).toBeUndefined()
    expect((await h.call("complete", { workflowId, stepId: "critic-solution", outcome: "pass", summary: "ready" }, "critic", "unowned-admission-critic")).error).toBeUndefined()
    const plannerGrant = await h.call("dispatch_grant", { workflowId, stepId: "plan" }, "general", "unowned-admission-general")
    expect((await h.call("attach", { workflowId, stepId: "plan", grantId: plannerGrant.grantId }, "planner", "unowned-admission-planner")).error).toBeUndefined()
    const task = richPlanTask("legacy", "Legacy", "An existing role-less Plan Task")
    expect((await h.call("work_plan", richWorkPlanInput(workflowId, [{
      id: "phase", title: "Phase", waves: [{ id: "wave", title: "Wave", tasks: [task] }],
    }]), "planner", "unowned-admission-planner")).error).toBeUndefined()
    const workflowBefore = await h.durableStorage.get(`workflow/${workflowId}`) as any
    const workKey = `work/${encodeURIComponent(workflowBefore.work.objectiveId)}`
    const work = await h.durableStorage.get(workKey) as any
    const snapshot = work.plans.find((candidate: any) => candidate.generation === work.generation)
    delete snapshot.phases[0].waves[0].tasks[0].role
    delete snapshot.phases[0].waves[0].tasks[0].responsibility
    await h.durableStorage.set(workKey, work)

    const attempt = await h.call("task_plan", {
      workflowId, tasks: [{ ...task, write: ["src/**"], skills: [] }],
    }, "planner", "unowned-admission-planner")
    expect(attempt.error).toContain("Legacy Plan Task legacy has no accountable role/responsibility")
    const after = await h.durableStorage.get(`workflow/${workflowId}`) as any
    expect(after.steps.some((step: any) => step.id === "task:legacy")).toBe(false)
    const afterWork = await h.durableStorage.get(workKey) as any
    expect(afterWork.nodes.find((node: any) => node.type === "wave").claimedByWorkflowId).toBeUndefined()
  } finally {
    h.restore()
  }
})

test("Reviewer attachment keeps exact Wave contracts on-demand instead of injecting the full corpus", async () => {
  const h = await waveLifecycleFixture()
  try {
    expect((await h.finish("task:one", "worker")).error).toBeUndefined()
    const grant = await h.call("dispatch_grant", {
      workflowId: h.workflowId,
      stepId: "review-implementation",
    }, "general", "parent")
    expect(grant.error).toBeUndefined()
    const reviewerSession = "bounded-reviewer"
    const attached = await h.call("attach", {
      workflowId: h.workflowId,
      stepId: "review-implementation",
      grantId: grant.grantId,
    }, "reviewer", reviewerSession)
    expect(attached.error).toBeUndefined()
    expect(attached.planContext).toBeDefined()
    expect(attached.reviewTasks).toBeUndefined()

    const exact = await h.call("task_status", {
      workflowId: h.workflowId,
      taskId: "one",
    }, "reviewer", reviewerSession)
    expect(exact.error).toBeUndefined()
    expect(exact.tasks).toHaveLength(1)
    expect(exact.tasks[0].task).toMatchObject({
      id: "one",
      objective: "Build one",
      acceptanceCriteria: ["One completes its accepted contribution."],
    })
  } finally {
    h.restore()
  }
})

test("legacy Objective can dispatch an independent Plan assessment through Reviewer OQ", async () => {
  const h = await waveLifecycleFixture()
  try {
    const legacy = await h.workflow()
    legacy.steps = legacy.steps
      .filter((step: any) => step.id !== "review-plan")
      .map((step: any) =>
        step.id.startsWith("task:")
          ? { ...step, dependsOn: step.dependsOn.map((dependency: string) => dependency === "review-plan" ? "plan" : dependency) }
          : step
      )
    await h.durableStorage.set(`workflow/${h.workflowId}`, legacy)

    for (const skill of ["risk-driven-planning", "work-decomposition"]) {
      const id = `legacy-plan-skill-${skill}`
      await h.durableStorage.set(`evidence/${id}`, {
        id,
        tool: "skill",
        status: "completed",
        methodology: "practitioner",
        skill,
        observedAt: "2026-09-25T07:00:00.000Z",
        admission: { attempt: legacy.steps.find((step: any) => step.id === "plan")?.attempt ?? 0 },
      })
      await h.durableStorage.set(`evidence-step/${h.workflowId}/plan/${id}`, id)
    }

    const raised = await h.call("oq_raise", {
      workflowId: h.workflowId,
      question: "Independently assess the current persisted Plan and executable Wave contracts before further implementation.",
      responder: "reviewer",
      blocking: false,
    }, "general", "parent")
    expect(raised.error).toBeUndefined()

    const grant = await h.call("dispatch_grant", {
      workflowId: h.workflowId,
      questionId: raised.question.id,
    }, "general", "parent")
    expect(grant.error).toBeUndefined()

    const reviewer = "legacy-plan-assessment-reviewer"
    const attached = await h.call("attach", {
      workflowId: h.workflowId,
      questionId: raised.question.id,
      grantId: grant.grantId,
    }, "reviewer", reviewer)
    expect(attached.error).toBeUndefined()
    expect(attached.planContext).toBeDefined()
    expect(attached.producerSkills).toEqual([
      { skill: "risk-driven-planning", stepIds: ["plan"] },
      { skill: "work-decomposition", stepIds: ["plan"] },
    ])

    for (const skill of ["risk-driven-planning", "work-decomposition"]) {
      const event = {
        tool: "skill",
        callID: `legacy-reviewer-${skill}`,
        messageID: `legacy-reviewer-${skill}-message`,
        sessionID: reviewer,
        agent: "reviewer",
        input: { name: skill },
      }
      const result = { metadata: { metadata: { directory: `${process.cwd()}/skills/${skill}` } } }
      await h.toolHooks.get("execute.before")!(event)
      await h.toolHooks.get("execute.after")!({ ...event, status: "completed", result })
      const assessment = await h.callObserved(
        "assessment",
        { skill },
        "reviewer",
        reviewer,
        `legacy-assessment-${skill}`,
      )
      expect(assessment.error).toBeUndefined()
      expect(assessment.available).toBe(true)
      expect(assessment.producerSkills).toEqual(attached.producerSkills)
    }

    expect((await h.call("oq_answer", {
      workflowId: h.workflowId,
      questionId: raised.question.id,
      answer: "Assessment complete: repair the identified Plan defects before execution.",
      source: "agent",
    }, "reviewer", reviewer)).error).toBeUndefined()

    const after = await h.workflow()
    expect(after.cancellation).toBeUndefined()
    expect(after.steps.some((step: any) => step.id === "worker")).toBe(false)
    expect(after.steps.some((step: any) => step.id.startsWith("task:"))).toBe(true)
  } finally {
    h.restore()
  }
})

test("Planner keeps auto Objective routing Wave-scoped when multiple Waves remain", async () => {
  const h = await harness()
  try {
    const { workflowId } = await h.call("start", { anchor: "docs/anchors/auto-wave/anchor.md" }, "general", "parent")
    expect((await h.call("route", {
      humanFacing: false,
      behavioral: false,
      structural: false,
      externalUnknown: false,
      diagnostic: false,
      productOutcome: true,
      implementationRequested: true,
      executionDepth: "objective",
    }, "general", "parent")).error).toBeUndefined()

    let workflow = await h.durableStorage.get(`workflow/${workflowId}`) as any
    expect(workflow.effects.workLevel).toBe("wave")
    expect(workflow.effects.workLevelAuto).toBe(true)
    expect(workflow.steps.some((step: any) => step.id === "product-acceptance")).toBe(false)

    const attach = async (stepId: string, agent: string, sessionID: string) => {
      const grant = await h.call("dispatch_grant", { workflowId, stepId }, "general", "parent")
      expect(grant.error).toBeUndefined()
      const result = await h.call("attach", { workflowId, stepId, grantId: grant.grantId }, agent, sessionID)
      expect(result.error).toBeUndefined()
      return sessionID
    }

    const critic = await attach("critic-solution", "critic", "critic-auto-wave")
    expect((await h.call("complete", {
      workflowId,
      stepId: "critic-solution",
      outcome: "pass",
      summary: "Solution accepted for planning",
    }, "critic", critic)).error).toBeUndefined()

    const planner = await attach("plan", "planner", "planner-auto-wave")
    const task = richPlanTask("first-task", "First task", "Build the first Wave")
    const second = richPlanTask("second-task", "Second task", "Build the second Wave", ["first-task"])

    expect((await h.call("work_plan", richWorkPlanInput(workflowId, [{
        id: "delivery",
        title: "Delivery",
        waves: [
          { id: "first", title: "First", tasks: [task] },
          { id: "second", title: "Second", tasks: [second] },
        ],
      },
    ]), "planner", planner)).error).toBeUndefined()

    const before = await h.durableStorage.get(`workflow/${workflowId}`) as any
    const planAttempt = before.steps.find((step: any) => step.id === "plan").attempt ?? 0

    const result = await h.call("task_plan", {
      workflowId,
      tasks: [{
        ...task,
        write: ["src/first/**"],
        skills: [],
      }],
    }, "planner", planner)

    expect(result.error).toBeUndefined()
    expect(result.workLevel).toBe("wave")
    expect(result.workLevelAuto).toBe(true)
    expect(result.autoResolvedWorkLevel).toBe(false)

    workflow = await h.durableStorage.get(`workflow/${workflowId}`) as any
    expect(workflow.effects.workLevel).toBe("wave")
    expect(workflow.steps.find((step: any) => step.id === "plan").attempt ?? 0).toBe(planAttempt)
    expect(workflow.steps.some((step: any) => step.id === "product-acceptance")).toBe(false)
    expect(workflow.steps.some((step: any) => step.id === "review-product")).toBe(false)
    expect(workflow.steps.some((step: any) => step.id === "critic-final")).toBe(false)
    expect(workflow.steps.some((step: any) => step.id === "knowledge-sync")).toBe(true)
  } finally {
    h.restore()
  }
})

test("Planner upgrades auto Objective routing for the only remaining Wave", async () => {
  const h = await harness()
  try {
    const { workflowId } = await h.call("start", { anchor: "docs/anchors/auto-objective/anchor.md" }, "general", "parent")
    expect((await h.call("route", {
      humanFacing: true,
      behavioral: false,
      structural: false,
      externalUnknown: false,
      diagnostic: false,
      productOutcome: true,
      implementationRequested: true,
      executionDepth: "objective",
    }, "general", "parent")).error).toBeUndefined()

    const attach = async (stepId: string, agent: string, sessionID: string) => {
      const grant = await h.call("dispatch_grant", { workflowId, stepId }, "general", "parent")
      expect(grant.error).toBeUndefined()
      const result = await h.call("attach", { workflowId, stepId, grantId: grant.grantId }, agent, sessionID)
      expect(result.error).toBeUndefined()
      return sessionID
    }

    const designer = await attach("designer", "designer", "designer-auto-objective")
    expect((await h.call("complete", {
      workflowId,
      stepId: "designer",
      summary: "Design complete",
    }, "designer", designer)).error).toBeUndefined()

    const reviewThink = await attach("review-think", "reviewer", "review-auto-objective")
    expect((await h.call("complete", {
      workflowId,
      stepId: "review-think",
      outcome: "pass",
      summary: "Design reviewed",
    }, "reviewer", reviewThink)).error).toBeUndefined()

    const critic = await attach("critic-solution", "critic", "critic-auto-objective")
    expect((await h.call("complete", {
      workflowId,
      stepId: "critic-solution",
      outcome: "pass",
      summary: "Solution accepted for planning",
    }, "critic", critic)).error).toBeUndefined()

    const planner = await attach("plan", "planner", "planner-auto-objective")
    const task = richPlanTask("only-task", "Only task", "Build the product")

    expect((await h.call("work_plan", richWorkPlanInput(workflowId, [{
        id: "delivery",
        title: "Delivery",
        waves: [{ id: "only", title: "Only", tasks: [task] }],
      },
    ]), "planner", planner)).error).toBeUndefined()

    const before = await h.durableStorage.get(`workflow/${workflowId}`) as any
    const planAttempt = before.steps.find((step: any) => step.id === "plan").attempt ?? 0
    expect(before.effects.workLevel).toBe("wave")
    expect(before.steps.some((step: any) => step.id === "product-acceptance")).toBe(false)

    const result = await h.call("task_plan", {
      workflowId,
      tasks: [{
        ...task,
        write: ["src/product/**"],
        skills: [],
      }],
    }, "planner", planner)

    expect(result.error).toBeUndefined()
    expect(result.workLevel).toBe("objective")
    expect(result.workLevelAuto).toBe(true)
    expect(result.autoResolvedWorkLevel).toBe(true)

    const workflow = await h.durableStorage.get(`workflow/${workflowId}`) as any
    expect(workflow.effects.workLevel).toBe("objective")
    expect(workflow.steps.find((step: any) => step.id === "plan").attempt ?? 0).toBe(planAttempt)
    expect(workflow.steps.some((step: any) => step.id === "product-acceptance")).toBe(true)
    expect(workflow.steps.some((step: any) => step.id === "designer-validation")).toBe(true)
    expect(workflow.steps.some((step: any) => step.id === "review-product")).toBe(true)
    expect(workflow.steps.some((step: any) => step.id === "critic-final")).toBe(true)
  } finally {
    h.restore()
  }
})

const cancellationRequest = (workflowId: string) => ({
  workflowId, reason: "Replace the old plan without repeating completed work.",
  confirmation: "Abort that workflow and create a new one.",
})

describe("workflow lifecycle recovery", () => {
  test("a reviewed Wave can finish knowledge-sync and start the next workflow", async () => {
    const h = await waveLifecycleFixture()
    try {
      expect((await h.finish("task:one", "worker")).error).toBeUndefined()
      expect((await h.finish("review-implementation", "reviewer", "pass")).error).toBeUndefined()
      const completedWork = await h.work()
      expect(completedWork.nodes.find((node: any) => node.type === "wave").claimedByWorkflowId).toBeUndefined()
      expect((await h.finishKnowledge()).error).toBeUndefined()
      expect(await h.work()).toEqual(completedWork)
      const next = await h.call("start", { request: "Continue with the next bounded task." }, "general", "parent")
      expect(next.error).toBeUndefined()
      expect(next.workflowId).not.toBe(h.workflowId)
    } finally { h.restore() }
  })

  test("explicit cancellation after Wave completion preserves history and permits replacement", async () => {
    const h = await waveLifecycleFixture()
    try {
      await h.finish("task:one", "worker")
      await h.finish("review-implementation", "reviewer", "pass")
      const before = await h.workflow()
      const workBefore = await h.work()
      const grant = await h.call("dispatch_grant", { workflowId: h.workflowId, stepId: "knowledge-sync" }, "general", "parent")
      const result = await h.call("cancel", cancellationRequest(h.workflowId), "general", "parent")
      expect(result.cancelled).toBe(true)
      expect((await h.workflow()).steps).toEqual(before.steps)
      expect(await h.work()).toEqual(workBefore)
      expect((await h.call("status", { detail: true }, "general", "parent")).summary.state).toBe("cancelled")
      const stale = await h.call("attach", { workflowId: h.workflowId, stepId: "knowledge-sync", grantId: grant.grantId }, "documenter", "late-child")
      expect(stale.error).toMatch(/cancelled|revoked/)
      const next = await h.call("start", { request: "Create a replacement plan." }, "general", "parent")
      expect(next.error).toBeUndefined()
      const cancelled = await h.workflow()
      expect((await h.call("cancel", cancellationRequest(h.workflowId), "general", "parent")).cancelled).toBe(true)
      expect(await h.workflow()).toEqual(cancelled)
      expect(await h.durableStorage.get("session/parent")).toBe(next.workflowId)
    } finally { h.restore() }
  })

  test("cancellation works before routing and rejects unauthorized actors", async () => {
    const h = await harness()
    try {
      const { workflowId } = await h.call("start", { request: "A small task." }, "general", "parent")
      for (const [agent, session] of [["worker", "parent"], ["general", "unrelated"]]) {
        expect((await h.call("cancel", cancellationRequest(workflowId), agent!, session!)).error).toBeDefined()
      }
      expect((await h.call("cancel", { ...cancellationRequest(workflowId), confirmation: " " }, "general", "parent")).error).toBeDefined()
      expect((await h.call("cancel", cancellationRequest(workflowId), "general", "parent")).cancelled).toBe(true)
      expect((await h.call("start", { request: "Another task." }, "general", "parent")).error).toBeUndefined()
    } finally { h.restore() }
  })

  test("cancelled children lose edit/shell/tool authority and cannot complete late", async () => {
    const h = await waveLifecycleFixture()
    try {
      const child = await h.attach("task:one", "worker")
      expect((await h.call("cancel", cancellationRequest(h.workflowId), "general", "parent")).cancelled).toBe(true)
      const afterCancel = await h.workflow()
      for (const agent of ["worker", "documenter", "architect", "research"]) {
        for (const action of ["edit", "shell", "subagent"]) {
          const event = { agent, sessionID: child, action, resources: action === "shell" ? ["git status"] : ["src/a.ts"], effect: "allow", message: "" }
          await h.permissionHooks.get("evaluate")!(event)
          expect(event.effect).toBe("deny")
          expect(event.message).toContain("cancelled")
        }
      }
      await expect(h.toolHooks.get("execute.before")!({ tool: "mcp_mutate", sessionID: child, agent: "worker", input: {} })).rejects.toThrow("cancelled")
      expect((await h.call("complete", { workflowId: h.workflowId, stepId: "task:one", summary: "late" }, "worker", child)).error).toMatch(/cancelled/)
      expect(await h.workflow()).toEqual(afterCancel)
      expect((await h.work()).nodes.every((node: any) => !node.claimedByWorkflowId)).toBe(true)
      expect((await h.work()).objectiveStatus).toBe("active")
    } finally { h.restore() }
  })
})

test("Brainstorm is eligible for an exact OQ dispatch without becoming a Task producer", async () => {
  const h = await harness()
  try {
    expect(h.registered.get("loom_oq_raise")?.input?.properties?.responder?.enum).toContain("brainstorm")
    const { workflowId } = await h.call("start", { request: "Answer a bounded advisory question." }, "general", "parent")
    const raised = await h.call("oq_raise", {
      workflowId,
      question: "What alternatives and trade-offs should the accountable authority consider?",
      responder: "brainstorm",
      blocking: false,
    }, "general", "parent")
    expect(raised.error).toBeUndefined()
    expect(raised.question.responder).toBe("brainstorm")

    const unauthorized = { agent: "general", sessionID: "parent", action: "subagent", resources: ["brainstorm"], effect: "allow", message: "" }
    await h.permissionHooks.get("evaluate")!(unauthorized)
    expect(unauthorized.effect).toBe("deny")
    expect(unauthorized.message).toContain("loom_dispatch_grant")

    const grant = await h.call("dispatch_grant", { workflowId, questionId: raised.question.id }, "general", "parent")
    expect(grant.error).toBeUndefined()
    const authorized = { agent: "general", sessionID: "parent", action: "subagent", resources: ["brainstorm"], effect: "deny", message: "" }
    await h.permissionHooks.get("evaluate")!(authorized)
    expect(authorized.effect).toBe("allow")
    const brainstorm = "bounded-brainstorm-oq"
    expect((await h.call("attach", {
      workflowId, questionId: raised.question.id, grantId: grant.grantId,
    }, "brainstorm", brainstorm)).attached).toBe(true)
    expect((await h.call("oq_answer", {
      workflowId, questionId: raised.question.id,
      answer: "Consider option A for simplicity and option B for resilience; the trade-off is operational complexity.",
      source: "agent",
    }, "brainstorm", brainstorm)).error).toBeUndefined()

    const workflow = await h.durableStorage.get(`workflow/${workflowId}`) as any
    expect(workflow.steps.some((step: any) => step.agent === "worker" || step.agent === "brainstorm")).toBe(false)
    expect((await h.call("complete", {
      workflowId, stepId: "task:not-a-brainstorm-task", summary: "Advisory answer",
    }, "brainstorm", brainstorm)).error).toContain("exact attached workflow step")
  } finally {
    h.restore()
  }
})

test("Planner OQ may amend untouched future work without staling the active Wave DAG", async () => {
  const h = await waveLifecycleFixture("wave", true)
  try {
    const raised = await h.call("oq_raise", {
      workflowId: h.workflowId,
      taskId: "two",
      question: "Clarify the checklist for future Task two without disturbing current Task one.",
      responder: "planner",
      blocking: false,
    }, "general", "parent")
    expect(raised.error).toBeUndefined()
    expect(raised.question.responder).toBe("planner")

    const grant = await h.call("dispatch_grant", {
      workflowId: h.workflowId,
      questionId: raised.question.id,
    }, "general", "parent")
    expect(grant.error).toBeUndefined()
    const planner = "planner-future-amend"
    expect((await h.call("attach", {
      workflowId: h.workflowId,
      questionId: raised.question.id,
      grantId: grant.grantId,
    }, "planner", planner)).attached).toBe(true)

    const futureStatus = await h.call("work_status", {
      workflowId: h.workflowId,
      taskId: "two",
    }, "planner", planner)
    expect(futureStatus.error).toBeUndefined()
    expect(futureStatus.plan).toMatchObject({
      generation: 1,
      revision: 1,
      focus: {
        task: {
          id: "two",
          objective: "Build two",
          subtasks: [],
        },
      },
    })

    const nested = await h.call("oq_raise", {
      workflowId: h.workflowId,
      parentQuestionId: raised.question.id,
      question: "Does architecture impose any additional constraint on future Task two?",
      responder: "architect",
      blocking: false,
    }, "planner", planner)
    expect(nested.error).toBeUndefined()
    expect(nested.question).toMatchObject({
      responder: "architect",
      parentQuestionId: raised.question.id,
      work: { taskId: "two" },
    })

    const nestedGrant = await h.call("dispatch_grant", {
      workflowId: h.workflowId,
      questionId: nested.question.id,
    }, "general", "parent")
    expect(nestedGrant.error).toBeUndefined()

    const before = await h.work()
    const amended = await h.call("work_amend", {
      workflowId: h.workflowId,
      questionId: raised.question.id,
      expectedVersion: before.version,
      reason: "Clarify one future Task checklist.",
      operations: [{
        action: "patch-task",
        taskId: "two",
        patch: {
          subtasks: ["Implement Two", "Verify Two against One's completed interface"],
        },
      }],
    }, "planner", planner)
    expect(amended.error).toBeUndefined()
    expect(amended.taskPlanRefreshRequired).toBe(false)
    expect(amended.changedTaskIds).toContain("two")

    const oldRevision = await h.call("work_status", {
      workflowId: h.workflowId,
      taskId: "two",
      revision: 1,
    }, "planner", planner)
    expect(oldRevision.error).toBeUndefined()
    expect(oldRevision.plan.focus.task.subtasks).toEqual([])

    const currentRevision = await h.call("work_status", {
      workflowId: h.workflowId,
      taskId: "two",
    }, "planner", planner)
    expect(currentRevision.plan).toMatchObject({
      revision: 2,
      focus: {
        task: {
          subtasks: ["Implement Two", "Verify Two against One's completed interface"],
        },
      },
    })

    const afterFirstAmendment = await h.work()
    const staleMutation = await h.call("work_amend", {
      workflowId: h.workflowId,
      questionId: raised.question.id,
      expectedVersion: afterFirstAmendment.version,
      reason: "Attempt to mutate again from stale revision-1 OQ context.",
      operations: [{
        action: "patch-task",
        taskId: "two",
        patch: { subtasks: ["Stale rewrite"] },
      }],
    }, "planner", planner)
    expect(staleMutation.error).toContain("Task semantics changed after the question was raised")

    const architect = "architect-nested-oq"
    const architectPermission: any = {
      agent: "general",
      action: "subagent",
      resources: ["architect"],
      sessionID: "parent",
      source: { messageID: "retained-advisory-oq", id: "retained-advisory-oq" },
      effect: "deny",
      message: "",
    }
    await h.permissionHooks.get("evaluate")!(architectPermission)
    expect(architectPermission.effect).toBe("allow")
    const admittedNestedGrant = await h.durableStorage.get(`dispatch-grant/${nestedGrant.grantId}`) as any
    expect(admittedNestedGrant.admittedAt).toEqual(expect.any(String))
    const architectAttach = await h.call("attach", {
      workflowId: h.workflowId,
      questionId: nested.question.id,
      grantId: nestedGrant.grantId,
    }, "architect", architect)
    expect(architectAttach.attached).toBe(true)
    expect(architectAttach.planContext).toMatchObject({
      generation: 1,
      revision: 1,
      focus: {
        task: {
          id: "two",
          subtasks: [],
        },
      },
    })
    expect((await h.call("oq_answer", {
      workflowId: h.workflowId,
      questionId: nested.question.id,
      answer: "No additional architecture constraint applies.",
      source: "agent",
    }, "architect", architect)).error).toBeUndefined()

    expect((await h.call("oq_answer", {
      workflowId: h.workflowId,
      questionId: raised.question.id,
      answer: "Future Task two is amended; current Wave remains valid.",
      source: "agent",
    }, "planner", planner)).error).toBeUndefined()

    const currentGrant = await h.call("dispatch_grant", {
      workflowId: h.workflowId,
      stepId: "task:one",
    }, "general", "parent")
    expect(currentGrant.error).toBeUndefined()
    const currentStepPermission: any = {
      agent: "general",
      action: "subagent",
      resources: ["worker"],
      sessionID: "parent",
      source: { messageID: "unchanged-claimed-wave", id: "unchanged-claimed-wave" },
      effect: "deny",
      message: "",
    }
    await h.permissionHooks.get("evaluate")!(currentStepPermission)
    expect(currentStepPermission.effect).toBe("allow")
    const currentStepGrant = await h.durableStorage.get(`dispatch-grant/${currentGrant.grantId}`) as any
    expect(currentStepGrant.admittedAt).toEqual(expect.any(String))
    expect((await h.call("attach", {
      workflowId: h.workflowId,
      stepId: "task:one",
      grantId: currentGrant.grantId,
    }, "worker", "unchanged-claimed-wave-worker")).attached).toBe(true)
  } finally {
    h.restore()
  }
})

test("production permission and attachment preserve an unchanged Wave after non-final future-Wave reordering", async () => {
  const h = await waveLifecycleFixture("wave", true, "worker", false, "execute", "worker", true)
  try {
    const before = await h.work()
    const originalPlan = before.plans.find((candidate: any) => candidate.generation === before.generation)
    const middleWave = structuredClone(originalPlan.phases[0].waves.find((wave: any) => wave.id === "second"))
    const claimBefore = before.nodes.find((node: any) => node.type === "wave" && node.logicalId === "first")
    expect(claimBefore.claimedByWorkflowId).toBe(h.workflowId)

    const raised = await h.call("oq_raise", {
      workflowId: h.workflowId,
      taskId: "two",
      question: "Reorder only unclaimed future Waves without changing the current reviewed Wave.",
      responder: "planner",
      blocking: false,
    }, "general", "parent")
    expect(raised.error).toBeUndefined()
    const plannerGrant = await h.call("dispatch_grant", {
      workflowId: h.workflowId,
      questionId: raised.question.id,
    }, "general", "parent")
    expect(plannerGrant.error).toBeUndefined()
    const planner = "reorder-future-waves-planner"
    expect((await h.call("attach", {
      workflowId: h.workflowId,
      questionId: raised.question.id,
      grantId: plannerGrant.grantId,
    }, "planner", planner)).attached).toBe(true)

    const amended = await h.call("work_amend", {
      workflowId: h.workflowId,
      questionId: raised.question.id,
      expectedVersion: before.version,
      reason: "Exercise supported non-final future-Wave removal and reinsertion order.",
      operations: [
        { action: "remove-wave", phaseId: "core", waveId: "second" },
        { action: "add-wave", phaseId: "core", wave: middleWave },
      ],
    }, "planner", planner)
    expect(amended.error).toBeUndefined()
    expect(amended.taskPlanRefreshRequired).toBe(false)
    expect(amended.changedTaskIds).toEqual([])

    const afterAmendment = await h.work()
    expect(afterAmendment.plans.find((candidate: any) => candidate.generation === afterAmendment.generation)
      .phases[0].waves.map((wave: any) => wave.id)).toEqual(["first", "last", "second"])
    const claimAfterAmendment = afterAmendment.nodes.find((node: any) => node.type === "wave" && node.logicalId === "first")
    expect(claimAfterAmendment).toMatchObject({
      id: claimBefore.id,
      claimedByWorkflowId: h.workflowId,
      claimedAt: claimBefore.claimedAt,
    })

    const grant = await h.call("dispatch_grant", {
      workflowId: h.workflowId,
      stepId: "task:one",
    }, "general", "parent")
    expect(grant.error).toBeUndefined()
    const beforeBudget = await h.durableStorage.get(`budget/${h.workflowId}`)
    const permission: any = {
      agent: "general",
      action: "subagent",
      resources: ["worker"],
      sessionID: "parent",
      source: { messageID: "reviewed-wave-after-reorder", id: "reviewed-wave-after-reorder" },
      effect: "deny",
      message: "",
    }
    await h.permissionHooks.get("evaluate")!(permission)
    expect(permission.effect).toBe("allow")
    const admitted = await h.durableStorage.get(`dispatch-grant/${grant.grantId}`) as any
    expect(admitted.admittedAt).toEqual(expect.any(String))
    expect(await h.durableStorage.get(`budget/${h.workflowId}`)).not.toEqual(beforeBudget)

    const attached = await h.call("attach", {
      workflowId: h.workflowId,
      stepId: "task:one",
      grantId: grant.grantId,
    }, "worker", "reviewed-wave-reorder-worker")
    expect(attached.attached).toBe(true)
    expect(attached.planContext).toMatchObject({
      generation: afterAmendment.generation,
      focus: { task: { id: "one", objective: "Build one" } },
    })
    expect((await h.workflow()).steps.find((step: any) => step.id === "task:one").attempt).toBe(0)
  } finally {
    h.restore()
  }
})

test("reopening Plan after Worker execution does not release the consumed Wave claim", async () => {
  const h = await waveLifecycleFixture()
  try {
    const reviewed = await h.workflow()
    expect(reviewed.work.reviewedPlanRevision).toBe(1)
    expect(reviewed.work.reviewedPlanFingerprint).toBeDefined()

    expect((await h.finish("task:one", "worker")).error).toBeUndefined()

    expect((await h.call("reopen", {
      workflowId: h.workflowId,
      stepId: "plan",
      reason: "New evidence requires reassessing the consumed Plan.",
      newEvidence: true,
      changedHypothesis: false,
      changedStrategy: false,
      reducedUnresolved: false,
    }, "general", "parent")).error).toBeUndefined()

    const reopenedWorkflow = await h.workflow()
    expect(reopenedWorkflow.work.reviewedPlanRevision).toBeUndefined()
    expect(reopenedWorkflow.work.reviewedPlanFingerprint).toBeUndefined()

    const work = await h.work()
    expect(
      work.nodes.find((node: any) => node.type === "wave" && node.logicalId === "first")
        .claimedByWorkflowId,
    ).toBe(h.workflowId)
  } finally {
    h.restore()
  }
})

test("reopened Planner can surgically amend a current Task and must refresh the executable DAG", async () => {
  const h = await waveLifecycleFixture("wave", false, "worker", true, "execute", "user")
  try {
    expect((await h.call("reopen", {
      workflowId: h.workflowId,
      stepId: "plan",
      reason: "A bounded Task-local criterion is missing.",
      newEvidence: true,
      changedHypothesis: false,
      changedStrategy: false,
      reducedUnresolved: false,
    }, "general", "parent")).error).toBeUndefined()

    const releasedWork = await h.work()
    expect(releasedWork.nodes.find((node: any) => node.type === "wave" && node.logicalId === "first").claimedByWorkflowId).toBeUndefined()

    const planGrant = await h.call("dispatch_grant", {
      workflowId: h.workflowId,
      stepId: "plan",
    }, "general", "parent")
    expect(planGrant.error).toBeUndefined()
    const planner = "planner-amend"
    expect((await h.call("attach", {
      workflowId: h.workflowId,
      stepId: "plan",
      grantId: planGrant.grantId,
    }, "planner", planner)).attached).toBe(true)

    const before = await h.work()
    const amended = await h.call("work_amend", {
      workflowId: h.workflowId,
      expectedVersion: before.version,
      reason: "Reviewer found one missing Task-local near-miss criterion.",
      operations: [{
        action: "patch-task",
        taskId: "one",
        patch: {
          acceptanceCriteria: [
            "One completes its accepted contribution.",
            "The near-miss path is rejected.",
          ],
          subtasks: ["Implement One", "Verify the near-miss path"],
        },
      }],
    }, "planner", planner)
    expect(amended.error).toBeUndefined()
    expect(amended.taskPlanRefreshRequired).toBe(true)
    expect(amended.generation).toBe(1)
    expect(amended.revision).toBe(2)

    const prematureComplete = await h.call("complete", {
      workflowId: h.workflowId,
      stepId: "plan",
      summary: "Do not accept the stale executable Task DAG.",
    }, "planner", planner)
    expect(prematureComplete.error).toContain("stale against the current semantic Task/Wave contract")

    const current = await h.work()
    const semanticTasks = current.plans.at(-1).phases[0].waves[0].tasks
    expect((await h.call("task_plan", {
      workflowId: h.workflowId,
      tasks: semanticTasks.map((task: any) => ({ ...task, write: task.role === "user" ? [] : ["src/**"], skills: [] })),
    }, "planner", planner)).error).toBeUndefined()
    expect((await h.workflow()).steps.find((step: any) => step.id === "task:dependent"))
      .toMatchObject({ agent: "user", kind: "wait", status: "waiting" })
    expect((await h.call("complete", {
      workflowId: h.workflowId,
      stepId: "plan",
      summary: "Refreshed executable Task DAG from Plan revision 2.",
    }, "planner", planner)).error).toBeUndefined()

    const reviewGrant = await h.call("dispatch_grant", {
      workflowId: h.workflowId,
      stepId: "review-plan",
    }, "general", "parent")
    expect(reviewGrant.error).toBeUndefined()
    const reviewer = "reviewer-replan"
    expect((await h.call("attach", {
      workflowId: h.workflowId,
      stepId: "review-plan",
      grantId: reviewGrant.grantId,
    }, "reviewer", reviewer)).attached).toBe(true)
    expect((await h.call("complete", {
      workflowId: h.workflowId,
      stepId: "review-plan",
      outcome: "pass",
      summary: "Revised Plan and executable DAG are ready.",
    }, "reviewer", reviewer)).error).toBeUndefined()

    const refreshedGrant = await h.call("dispatch_grant", {
      workflowId: h.workflowId,
      stepId: "task:one",
    }, "general", "parent")
    expect(refreshedGrant.error).toBeUndefined()
    expect((await h.call("dispatch_grant", {
      workflowId: h.workflowId,
      stepId: "task:dependent",
    }, "general", "parent")).error).toContain("not currently runnable")
  } finally {
    h.restore()
  }
})

test("released invalidated Plan can recover through a fresh reviewed generation without executing stale Tasks", async () => {
  const h = await waveLifecycleFixture()
  try {
    expect((await h.call("reopen", {
      workflowId: h.workflowId,
      stepId: "plan",
      reason: "A material Plan correction is required before any Task was consumed.",
      newEvidence: true,
      changedHypothesis: false,
      changedStrategy: true,
      reducedUnresolved: false,
    }, "general", "parent")).error).toBeUndefined()

    const released = await h.work()
    expect(released.nodes.find((node: any) => node.type === "wave" && node.logicalId === "first").claimedByWorkflowId).toBeUndefined()
    const planner1 = "planner-invalidate-recovery-1"
    const planGrant1 = await h.call("dispatch_grant", { workflowId: h.workflowId, stepId: "plan" }, "general", "parent")
    expect(planGrant1.error).toBeUndefined()
    expect((await h.call("attach", { workflowId: h.workflowId, stepId: "plan", grantId: planGrant1.grantId }, "planner", planner1)).attached).toBe(true)

    const invalidated = await h.call("work_invalidate", {
      workflowId: h.workflowId,
      expectedVersion: released.version,
      reason: "The released, unconsumed decomposition is no longer valid.",
    }, "planner", planner1)
    expect(invalidated.error).toBeUndefined()
    const oldDagDenied = await h.call("dispatch_grant", { workflowId: h.workflowId, stepId: "task:one" }, "general", "parent")
    expect(oldDagDenied.error).toContain("not currently runnable")

    const reopened = await h.call("reopen", {
      workflowId: h.workflowId,
      stepId: "plan",
      reason: "Resume planning from the explicitly invalidated, unconsumed generation.",
      newEvidence: true,
      changedHypothesis: false,
      changedStrategy: true,
      reducedUnresolved: false,
    }, "general", "parent")
    expect(reopened.error).toBeUndefined()

    const planner2 = "planner-invalidate-recovery-2"
    const planGrant2 = await h.call("dispatch_grant", { workflowId: h.workflowId, stepId: "plan" }, "general", "parent")
    expect(planGrant2.error).toBeUndefined()
    expect((await h.call("attach", { workflowId: h.workflowId, stepId: "plan", grantId: planGrant2.grantId }, "planner", planner2)).attached).toBe(true)
    const beforeFreshPlan = await h.work()
    const oldPlan = beforeFreshPlan.plans.find((plan: any) => plan.generation === 1)
    const oldTask = oldPlan.phases[0].waves[0].tasks[0]
    const freshPlan = await h.call("work_plan", richWorkPlanInput(h.workflowId, [{
      id: "core", title: "Core", waves: [{ id: "first", title: "First", tasks: [{
        ...oldTask,
        acceptanceCriteria: [...oldTask.acceptanceCriteria, "The fresh generation is independently reviewed before dispatch."],
      }] }],
    }], { expectedVersion: beforeFreshPlan.version, replaceReason: "Replace the invalidated decomposition." }), "planner", planner2)
    expect(freshPlan.error).toBeUndefined()
    expect(freshPlan.generation).toBe(2)

    const freshWork = await h.work()
    const freshTask = freshWork.plans.find((plan: any) => plan.generation === 2).phases[0].waves[0].tasks[0]
    expect((await h.call("task_plan", {
      workflowId: h.workflowId,
      tasks: [{ ...freshTask, write: ["src/**"], skills: [] }],
    }, "planner", planner2)).error).toBeUndefined()
    expect((await h.call("complete", {
      workflowId: h.workflowId, stepId: "plan", summary: "Fresh Plan and executable DAG are ready for independent review.",
    }, "planner", planner2)).error).toBeUndefined()

    const beforeReviewDispatch = await h.call("dispatch_grant", { workflowId: h.workflowId, stepId: "task:one" }, "general", "parent")
    expect(beforeReviewDispatch.error).toContain("not currently runnable")
    const reviewer = "reviewer-invalidate-recovery"
    const reviewGrant = await h.call("dispatch_grant", { workflowId: h.workflowId, stepId: "review-plan" }, "general", "parent")
    expect(reviewGrant.error).toBeUndefined()
    expect((await h.call("attach", { workflowId: h.workflowId, stepId: "review-plan", grantId: reviewGrant.grantId }, "reviewer", reviewer)).attached).toBe(true)
    expect((await h.call("complete", {
      workflowId: h.workflowId, stepId: "review-plan", outcome: "pass", summary: "Fresh generation and DAG independently reviewed.",
    }, "reviewer", reviewer)).error).toBeUndefined()
    expect((await h.call("dispatch_grant", { workflowId: h.workflowId, stepId: "task:one" }, "general", "parent")).error).toBeUndefined()

    const history = await h.work()
    expect(history.plans.find((plan: any) => plan.generation === 1).invalidated.reason).toBe("The released, unconsumed decomposition is no longer valid.")
    expect(history.plans.some((plan: any) => plan.generation === 2)).toBe(true)
  } finally {
    h.restore()
  }
})

test("invalidated Plan blocks stale role-owned Task grants and attachments after Wave release", async () => {
  const h = await waveLifecycleFixture("wave", false, "architect")
  try {
    const staleGrant = await h.call("dispatch_grant", {
      workflowId: h.workflowId,
      stepId: "task:one",
    }, "general", "parent")
    expect(staleGrant.error).toBeUndefined()

    expect((await h.call("work_release", {
      workflowId: h.workflowId,
      reason: "Release the unconsumed Wave before revising its Plan.",
    }, "general", "parent")).error).toBeUndefined()

    const raised = await h.call("oq_raise", {
      workflowId: h.workflowId,
      stepId: "plan",
      question: "The current Plan must be invalidated before replanning.",
      responder: "planner",
      blocking: false,
    }, "general", "parent")
    expect(raised.error).toBeUndefined()
    const oqGrant = await h.call("dispatch_grant", {
      workflowId: h.workflowId,
      questionId: raised.question.id,
    }, "general", "parent")
    expect(oqGrant.error).toBeUndefined()
    const planner = "planner-role-task-invalidation"
    expect((await h.call("attach", {
      workflowId: h.workflowId,
      questionId: raised.question.id,
      grantId: oqGrant.grantId,
    }, "planner", planner)).attached).toBe(true)
    const invalidated = await h.call("work_invalidate", {
      workflowId: h.workflowId,
      questionId: raised.question.id,
      expectedVersion: (await h.work()).version,
      reason: "The released Plan no longer represents current evidence.",
    }, "planner", planner)
    expect(invalidated.error).toBeUndefined()

    const workflow = await h.workflow()
    expect(workflow.steps.find((step: any) => step.id === "review-plan").status).toBe("passed")
    expect(workflow.steps.find((step: any) => step.id === "task:one").status).toBe("pending")
    const deniedGrant = await h.call("dispatch_grant", {
      workflowId: h.workflowId,
      stepId: "task:one",
    }, "general", "parent")
    expect(deniedGrant.error ?? "").toContain("invalidated")

    const attached = await h.call("attach", {
      workflowId: h.workflowId,
      stepId: "task:one",
      grantId: staleGrant.grantId,
    }, "architect", "stale-role-task-child")
    expect(attached.error ?? "").toContain("invalidated")
  } finally {
    h.restore()
  }
})

test("invalidated Plan blocks stale handoff Reviewer gate grants and attachments after Wave release", async () => {
  const h = await waveLifecycleFixture("wave", false, "architect", true)
  try {
    expect((await h.finish("task:one", "architect")).error).toBeUndefined()
    const staleGateGrant = await h.call("dispatch_grant", {
      workflowId: h.workflowId,
      stepId: "task-review:one",
    }, "general", "parent")
    expect(staleGateGrant.error).toBeUndefined()

    expect((await h.call("work_release", {
      workflowId: h.workflowId,
      reason: "Release the unconsumed Wave before invalidating its Plan.",
    }, "general", "parent")).error).toBeUndefined()
    const raised = await h.call("oq_raise", {
      workflowId: h.workflowId,
      stepId: "plan",
      question: "Invalidate the released Plan before replanning.",
      responder: "planner",
      blocking: false,
    }, "general", "parent")
    expect(raised.error).toBeUndefined()
    const oqGrant = await h.call("dispatch_grant", {
      workflowId: h.workflowId,
      questionId: raised.question.id,
    }, "general", "parent")
    expect(oqGrant.error).toBeUndefined()
    const planner = "planner-stale-handoff-invalidation"
    expect((await h.call("attach", {
      workflowId: h.workflowId,
      questionId: raised.question.id,
      grantId: oqGrant.grantId,
    }, "planner", planner)).attached).toBe(true)
    expect((await h.call("work_invalidate", {
      workflowId: h.workflowId,
      questionId: raised.question.id,
      expectedVersion: (await h.work()).version,
      reason: "The released Plan is obsolete.",
    }, "planner", planner)).error).toBeUndefined()

    const workflow = await h.workflow()
    expect(workflow.steps.find((step: any) => step.id === "review-plan").status).toBe("passed")
    expect(workflow.steps.find((step: any) => step.id === "task-review:one").status).toBe("pending")
    const deniedGrant = await h.call("dispatch_grant", {
      workflowId: h.workflowId,
      stepId: "task-review:one",
    }, "general", "parent")
    expect(deniedGrant.error ?? "").toContain("invalidated")

    const attached = await h.call("attach", {
      workflowId: h.workflowId,
      stepId: "task-review:one",
      grantId: staleGateGrant.grantId,
    }, "reviewer", "stale-handoff-reviewer")
    expect(attached.error ?? "").toContain("invalidated")
  } finally {
    h.restore()
  }
})

test("invalidated Plan blocks stale implementation-review gate grants and attachments after Wave release", async () => {
  const h = await waveLifecycleFixture()
  try {
    expect((await h.finish("task:one", "worker")).error).toBeUndefined()
    const staleGateGrant = await h.call("dispatch_grant", {
      workflowId: h.workflowId,
      stepId: "review-implementation",
    }, "general", "parent")
    expect(staleGateGrant.error).toBeUndefined()

    expect((await h.call("work_release", {
      workflowId: h.workflowId,
      reason: "Release the completed-but-unreviewed Wave before invalidating its Plan.",
    }, "general", "parent")).error).toBeUndefined()
    const raised = await h.call("oq_raise", {
      workflowId: h.workflowId,
      stepId: "plan",
      question: "Invalidate the released Plan before implementation review.",
      responder: "planner",
      blocking: false,
    }, "general", "parent")
    expect(raised.error).toBeUndefined()
    const oqGrant = await h.call("dispatch_grant", {
      workflowId: h.workflowId,
      questionId: raised.question.id,
    }, "general", "parent")
    expect(oqGrant.error).toBeUndefined()
    const planner = "planner-stale-implementation-review"
    expect((await h.call("attach", {
      workflowId: h.workflowId,
      questionId: raised.question.id,
      grantId: oqGrant.grantId,
    }, "planner", planner)).attached).toBe(true)
    expect((await h.call("work_invalidate", {
      workflowId: h.workflowId,
      questionId: raised.question.id,
      expectedVersion: (await h.work()).version,
      reason: "The Plan changed before implementation review.",
    }, "planner", planner)).error).toBeUndefined()

    const workflow = await h.workflow()
    expect(workflow.steps.find((step: any) => step.id === "review-implementation").status).toBe("pending")
    expect((await h.call("dispatch_grant", {
      workflowId: h.workflowId,
      stepId: "review-implementation",
    }, "general", "parent")).error ?? "").toContain("invalidated")

    const attached = await h.call("attach", {
      workflowId: h.workflowId,
      stepId: "review-implementation",
      grantId: staleGateGrant.grantId,
    }, "reviewer", "stale-implementation-reviewer")
    expect(attached.error ?? "").toContain("invalidated")
  } finally {
    h.restore()
  }
})


const reopenRequest = (workflowId: string, stepId: string) => ({
  workflowId, stepId, reason: "New evidence invalidates this step.",
  newEvidence: true, changedHypothesis: false, changedStrategy: false, reducedUnresolved: false,
})

describe("workflow cancellation and reviewed-history boundaries", () => {
  test("whole-Objective gates can close after Wave review without reclaiming Tasks", async () => {
    const h = await waveLifecycleFixture("objective")
    try {
      await h.finish("task:one", "worker")
      await h.finish("review-implementation", "reviewer", "pass")
      expect((await h.finishKnowledge()).error).toBeUndefined()
      const child = await h.attach("product-acceptance", "acceptance")
      const scenario = { id: "behavior", title: "Fixture behavior", criteria: ["docs/anchors/lifecycle/anchor.md#success"] }
      expect((await h.call("pa_plan", { workflowId: h.workflowId, scenarios: [scenario] }, "acceptance", child)).error).toBeUndefined()
      const acceptanceCheck = { tool: "shell", callID: "acceptance-observation", sessionID: child, agent: "acceptance",
        input: { command: "bun test fixture" } }
      await h.toolHooks.get("execute.before")!(acceptanceCheck)
      await h.toolHooks.get("execute.after")!({ ...acceptanceCheck, status: "completed", result: "fixture passed" })
      const { observations } = await h.call("evidence_observations", { detail: true }, "acceptance", child)
      const { claim } = await h.call("evidence_claim", {
        workflowId: h.workflowId, stepId: "product-acceptance", kind: "product-acceptance",
        statement: "Host observation fixture for lifecycle control, not a live Product Acceptance run.",
        observationIds: observations.map((item: any) => item.id),
      }, "acceptance", child)
      expect((await h.call("pa_result", {
        workflowId: h.workflowId, scenarioId: "behavior", outcome: "passed", evidenceClaimIds: [claim.id], note: "Fixture",
      }, "acceptance", child)).error).toBeUndefined()
      expect((await h.call("complete", { workflowId: h.workflowId, stepId: "product-acceptance", outcome: "pass", summary: "Fixture" }, "acceptance", child)).error).toBeUndefined()
      expect((await h.finish("review-product", "reviewer", "pass")).error).toBeUndefined()
      expect((await h.finish("critic-final", "critic", "pass")).error).toBeUndefined()
      expect((await h.work()).objectiveStatus).toBe("complete")
      const before = await h.workflow()
      expect((await h.call("cancel", cancellationRequest(h.workflowId), "general", "parent")).terminal).toBe(true)
      expect(await h.workflow()).toEqual(before)
    } finally { h.restore() }
  })

  test("legacy completed Waves regain unique review provenance without repeating work", async () => {
    const h = await waveLifecycleFixture()
    try {
      await h.finish("task:one", "worker")
      await h.finish("review-implementation", "reviewer", "pass")
      const work = await h.work()
      const tasks = structuredClone(work.nodes.filter((node: any) => node.type === "task"))
      delete work.nodes.find((node: any) => node.type === "wave").completion
      await h.durableStorage.set(h.workKey, work)
      expect((await h.finishKnowledge()).error).toBeUndefined()
      const recovered = await h.work()
      expect(recovered.nodes.find((node: any) => node.type === "wave").completion).toMatchObject({
        workflowId: h.workflowId, provenance: "legacy-reviewed-workflow",
      })
      expect(recovered.nodes.filter((node: any) => node.type === "task")).toEqual(tasks)
    } finally { h.restore() }
  })

  test("ambiguous legacy receipts fail closed but still allow cancellation", async () => {
    const h = await waveLifecycleFixture()
    try {
      await h.finish("task:one", "worker")
      await h.finish("review-implementation", "reviewer", "pass")
      const work = await h.work()
      delete work.nodes.find((node: any) => node.type === "wave").completion
      const duplicate = { ...await h.workflow(), id: "ambiguous-other-workflow" }
      work.workflowIds.push(duplicate.id)
      await h.durableStorage.set(`workflow/${duplicate.id}`, duplicate)
      await h.durableStorage.set(h.workKey, work)
      expect((await h.finishKnowledge()).error).toContain("ambiguous")
      expect(await h.work()).toEqual(work)
      expect((await h.call("cancel", cancellationRequest(h.workflowId), "general", "parent")).cancelled).toBe(true)
      expect(await h.work()).toEqual(work)
    } finally { h.restore() }
  })

  test("reopening documentation does not reclaim reviewed work; implementation reopening does", async () => {
    const h = await waveLifecycleFixture()
    try {
      await h.finish("task:one", "worker")
      await h.finish("review-implementation", "reviewer", "pass")
      await h.finishKnowledge()
      const work = await h.work()
      expect((await h.call("reopen", reopenRequest(h.workflowId, "knowledge-sync"), "general", "parent")).error).toBeUndefined()
      expect(await h.work()).toEqual(work)
      expect((await h.finishKnowledge()).error).toBeUndefined()
      expect((await h.call("reopen", reopenRequest(h.workflowId, "task:one"), "general", "parent")).error).toBeUndefined()
      const reopened = await h.work()
      const wave = reopened.nodes.find((node: any) => node.type === "wave")
      expect(wave.claimedByWorkflowId).toBe(h.workflowId)
      expect(wave.completion).toBeUndefined()
      expect(reopened.nodes.find((node: any) => node.type === "task").status).toBe("pending")
      expect((await h.finish("task:one", "worker")).error).toBeUndefined()
      expect((await h.finish("review-implementation", "reviewer", "pass")).error).toBeUndefined()
      expect((await h.finishKnowledge()).error).toBeUndefined()
    } finally { h.restore() }
  })

  test("stale-generation cancellation keeps other workflow claims and statuses intact", async () => {
    const h = await waveLifecycleFixture()
    try {
      const workflow = await h.workflow()
      const work = await h.work()
      // Persisted crash/recovery fixture: a different workflow owns current work.
      for (const node of work.nodes) if (node.claimedByWorkflowId) node.claimedByWorkflowId = "other-workflow"
      workflow.work.generation--
      await h.durableStorage.set(`workflow/${h.workflowId}`, workflow)
      await h.durableStorage.set(h.workKey, work)
      expect((await h.call("cancel", cancellationRequest(h.workflowId), "general", "parent")).cancelled).toBe(true)
      expect(await h.work()).toEqual(work)
      expect((await h.call("start", { request: "A different bounded task." }, "general", "parent")).error).toBeUndefined()
    } finally { h.restore() }
  })

  test("cancellation reports foreign ownership rather than releasing it", async () => {
    const h = await waveLifecycleFixture()
    try {
      const work = await h.work()
      for (const node of work.nodes) if (node.claimedByWorkflowId) node.claimedByWorkflowId = "other-workflow"
      await h.durableStorage.set(h.workKey, work)
      const result = await h.call("cancel", cancellationRequest(h.workflowId), "general", "parent")
      expect(result.cancellation.releasedClaimIds).toEqual([])
      expect(result.cancellation.retainedForeignClaimIds).toHaveLength(2)
      expect(await h.work()).toEqual(work)
    } finally { h.restore() }
  })

  test("missing work state does not prevent an authorized cancellation", async () => {
    const h = await waveLifecycleFixture()
    try {
      await h.durableStorage.set(h.workKey, null)
      const result = await h.call("cancel", cancellationRequest(h.workflowId), "general", "parent")
      expect(result.cancelled).toBe(true)
      expect(result.cancellation.workMissing).toBe(true)
      expect((await h.call("start", { request: "Replan." }, "general", "parent")).error).toBeUndefined()
    } finally { h.restore() }
  })

  test("cancel/start survives restart and cannot reimport the stale legacy binding", async () => {
    const h = await waveLifecycleFixture()
    try {
      await h.finish("task:one", "worker")
      const child = await h.attach("review-implementation", "reviewer")
      await h.call("cancel", cancellationRequest(h.workflowId), "general", "parent")
      const next = await h.call("start", { request: "Replacement" }, "general", "parent")
      await h.storage.set("session/parent", h.workflowId)
      await h.storage.set(`workflow/${h.workflowId}`, await h.workflow())
      const resumed = await harness(undefined, undefined, { root: h.root, storage: h.storage })
      try {
        expect((await resumed.call("status", { detail: true }, "general", "parent")).workflow.id).toBe(next.workflowId)
        expect((await resumed.call("complete", { workflowId: h.workflowId, stepId: "review-implementation", summary: "late", outcome: "pass" }, "reviewer", child)).error).toContain("cancelled")
      } finally { resumed.restore() }
    } finally { h.restore() }
  })

  test("fault at the final cancellation write rolls back tombstone, claims and grants", async () => {
    const h = await waveLifecycleFixture()
    try {
      const grant = await h.call("dispatch_grant", { workflowId: h.workflowId, stepId: "task:one" }, "general", "parent")
      const before = await h.workflow()
      const work = await h.work()
      const grantBefore = await h.durableStorage.get(`dispatch-grant/${grant.grantId}`)
      const faulted = { ...h.durableStorage, set: async (key: string, value: unknown) => {
        if (key.startsWith("binding-release/")) throw new Error("Injected final-write failure")
        return h.durableStorage.set(key, value)
      } }
      await expect(cancelWorkflow(faulted, h.runtime, cancellationRequest(h.workflowId), { agent: "general", sessionID: "parent" })).rejects.toThrow("Injected")
      expect(await h.workflow()).toEqual(before)
      expect(await h.work()).toEqual(work)
      expect(await h.durableStorage.get(`dispatch-grant/${grant.grantId}`)).toEqual(grantBefore)
      expect((await h.call("cancel", cancellationRequest(h.workflowId), "general", "parent")).cancelled).toBe(true)
    } finally { h.restore() }
  })

  test("Code Mode cancellation shares native executor, preserves evidence and exposes no runnable work", async () => {
    const h = await waveLifecycleFixture()
    try {
      const child = await h.attach("task:one", "worker")
      await h.toolHooks.get("execute.after")!({ tool: "shell", sessionID: child, agent: "worker", callID: "observed", input: { command: "bun test" }, status: "completed", result: "passed" })
      const before = await h.call("evidence_observations", { detail: true }, "worker", child)
      expect(h.registered.get("loom_code_cancel")?.execute).toBe(h.registered.get("loom_cancel")?.execute)
      expect((await h.call("loom_code_cancel", cancellationRequest(h.workflowId), "general", "parent")).cancelled).toBe(true)
      expect(await h.call("evidence_observations", { detail: true }, "worker", child)).toEqual(before)
      expect((await h.call("loom_code_evidence_claim", {
        workflowId: h.workflowId, stepId: "task:one", kind: "test", statement: "late", observationIds: before.observations.map((item: any) => item.id),
      }, "worker", child)).error).toContain("cancelled")
      const sidebar = buildSidebarSnapshot(await h.workflow(), [], await h.work())
      expect(sidebar.state).toBe("cancelled")
      expect(sidebar.now).toEqual([])
      const status = await h.call("status", { detail: true }, "general", "parent")
      expect(status.dagRunnable).toEqual([])
      expect(status.summary.upcoming).toEqual([])
      // A pre-cancellation external tool may return; it is passive history, not new governed proof.
      await h.toolHooks.get("execute.after")!({ tool: "shell", sessionID: child, agent: "worker", callID: "late-observation", input: { command: "bun test" }, status: "completed", result: "late result" })
      const { observations } = await h.call("evidence_observations", { detail: true }, "worker", child)
      const late = observations.find((item: any) => !before.observations.some((prior: any) => prior.id === item.id))
      expect(late.workflowId).toBeUndefined()
    } finally { h.restore() }
  })

  test("concurrent cancellation and completion serialize without resurrecting execution", async () => {
    const h = await waveLifecycleFixture()
    try {
      const child = await h.attach("task:one", "worker")
      const [cancelled, completion] = await Promise.all([
        h.call("cancel", cancellationRequest(h.workflowId), "general", "parent"),
        h.call("complete", { workflowId: h.workflowId, stepId: "task:one", summary: "racing completion" }, "worker", child),
      ])
      expect(cancelled.cancelled).toBe(true)
      const final = await h.workflow()
      expect(final.cancellation).toBeDefined()
      expect(final.steps.find((step: any) => step.id === "task:one").status).toBe(completion.error ? "pending" : "complete")
      expect((await h.work()).nodes.every((node: any) => !node.claimedByWorkflowId)).toBe(true)
      expect((await h.call("complete", { workflowId: h.workflowId, stepId: "task:one", summary: "late again" }, "worker", child)).error).toContain("cancelled")
      expect(await h.workflow()).toEqual(final)
    } finally { h.restore() }
  })
})


describe("cancellation replay and grant boundaries", () => {
  test("revokes every pending grant across storage pages and leaves other workflows alone", async () => {
    const h = await waveLifecycleFixture()
    try {
      const original = await h.call("dispatch_grant", { workflowId: h.workflowId, stepId: "task:one" }, "general", "parent")
      const template: any = await h.durableStorage.get(`dispatch-grant/${original.grantId}`)
      for (let i = 0; i < 205; i++) {
        const id = `paged-${String(i).padStart(4, "0")}`
        await h.durableStorage.set(`dispatch-grant/${id}`, { ...template, grantId: id })
      }
      const foreign = { ...template, grantId: "foreign", workflowId: "foreign-workflow" }
      const consumed = { ...template, grantId: "consumed", consumedAt: "earlier", consumingSessionId: "child" }
      await h.durableStorage.set("dispatch-grant/foreign", foreign)
      await h.durableStorage.set("dispatch-grant/consumed", consumed)
      const result = await h.call("cancel", cancellationRequest(h.workflowId), "general", "parent")
      expect(result.cancellation.revokedGrantIds).toHaveLength(206)
      for (let i = 0; i < 205; i++) {
        expect((await h.durableStorage.get(`dispatch-grant/paged-${String(i).padStart(4, "0")}`) as any).revokedAt).toBe(result.cancellation.at)
      }
      expect(await h.durableStorage.get("dispatch-grant/foreign")).toEqual(foreign)
      expect(await h.durableStorage.get("dispatch-grant/consumed")).toEqual(consumed)
    } finally { h.restore() }
  })

  test("all workflow mutations reject cancellation, including OQ grants and a rebound parent", async () => {
    const h = await waveLifecycleFixture()
    try {
      await h.attach("task:one", "worker")
      await h.call("cancel", cancellationRequest(h.workflowId), "general", "parent")
      await h.call("start", { request: "Replacement" }, "general", "parent")
      const before = await h.workflow()
      for (const name of ["dispatch_grant", "oq_raise", "oq_answer", "oq_reconcile", "oq_reopen", "knowledge_record", "pa_plan", "pa_result", "task_scope", "reopen", "work_release", "task_plan", "work_plan", "budget_grant", "budget_continue"]) {
        const result = await h.call(name, { workflowId: h.workflowId }, "general", "parent")
        expect(result.error).toContain("cancelled")
      }
      expect((await h.call("attach", { workflowId: h.workflowId, questionId: "oq-old", grantId: "old-oq-grant" }, "research", "fresh-session")).error).toContain("cancelled")
      expect(await h.workflow()).toEqual(before)
    } finally { h.restore() }
  })

  test("a cancelled child can only be reused with a new exact grant", async () => {
    const h = await waveLifecycleFixture()
    try {
      const child = await h.attach("task:one", "worker")
      await h.call("cancel", cancellationRequest(h.workflowId), "general", "parent")
      const next = await h.call("start", { request: "Replacement bounded edit" }, "general", "parent")
      await h.call("route", { humanFacing: false, behavioral: false, structural: false, externalUnknown: false, diagnostic: false, productOutcome: true, implementationRequested: true, executionDepth: "task" }, "general", "parent")
      await h.call("task_scope", { workflowId: next.workflowId, stepId: "worker", write: ["src/**"] }, "general", "parent")
      const grant = await h.call("dispatch_grant", { workflowId: next.workflowId, stepId: "worker" }, "general", "parent")
      expect((await h.call("attach", { workflowId: next.workflowId, stepId: "worker", grantId: "invented" }, "worker", child)).error).toBeDefined()
      expect((await h.call("attach", { workflowId: next.workflowId, stepId: "worker", grantId: grant.grantId }, "worker", child)).attached).toBe(true)
      expect((await h.call("complete", { workflowId: next.workflowId, stepId: "worker", summary: "New scoped task completed" }, "worker", child)).error).toBeUndefined()
      expect((await h.workflow()).cancellation).toBeDefined()
    } finally { h.restore() }
  })
})


test("background governed step completion queues General while foreground completion stays quiet", async () => {
  const run = async (background: boolean) => {
    const generalSession = `background-return-general-${background}`
    const childSession = `background-return-worker-${background}`
    const h = await harness(
      undefined,
      (sessionID, projectID) =>
        sessionID === childSession
          ? { id: sessionID, projectID, parentID: generalSession }
          : { id: sessionID, projectID },
      undefined,
      undefined,
      undefined,
      (sessionID) =>
        sessionID === generalSession
          ? [
              {
                role: "assistant",
                parts: [{
                  type: "tool",
                  state: {
                    metadata: {
                      parentSessionId: generalSession,
                      sessionId: childSession,
                      model: { providerID: "test", modelID: "test" },
                      ...(!background ? { background: true, jobId: childSession } : {}),
                    },
                  },
                }],
              },
              {
                role: "assistant",
                parts: [{
                  type: "tool",
                  state: {
                    metadata: {
                      parentSessionId: generalSession,
                      sessionId: childSession,
                      model: { providerID: "test", modelID: "test" },
                      ...(background ? { background: true, jobId: childSession } : {}),
                    },
                  },
                }],
              },
            ]
          : [],
    )

    try {
      const started = await h.call(
        "start",
        { request: "Implement one bounded background-safe change." },
        "general",
        generalSession,
      )
      const workflowId = String(started.workflowId)
      expect((await h.call(
        "route",
        {
          humanFacing: false,
          behavioral: false,
          structural: false,
          externalUnknown: false,
          diagnostic: false,
          productOutcome: false,
          implementationRequested: true,
          executionDepth: "task",
        },
        "general",
        generalSession,
      )).error).toBeUndefined()

      const grant = await h.call(
        "dispatch_grant",
        { workflowId, stepId: "worker" },
        "general",
        generalSession,
      )
      expect((await h.call(
        "attach",
        { grantId: grant.grantId, workflowId, stepId: "worker" },
        "worker",
        childSession,
      )).attached).toBe(true)

      const completed = await h.call(
        "complete",
        {
          workflowId,
          stepId: "worker",
          summary: "Background-safe work finished.",
        },
        "worker",
        childSession,
      )
      expect(completed.error).toBeUndefined()
      return { h, workflowId, completed, generalSession, childSession }
    } catch (error) {
      h.restore()
      throw error
    }
  }

  const background = await run(true)
  try {
    expect(background.completed.coordinatorNotification).toEqual({
      notified: ["general"],
      failed: [],
    })
    expect(background.h.syntheticMessages).toHaveLength(1)
    expect(background.h.syntheticMessages[0]).toMatchObject({
      sessionID: background.generalSession,
      description: "Loom background child returned",
      delivery: "queue",
      resume: true,
      metadata: {
        source: "loom",
        kind: "background-child-return",
        workflowId: background.workflowId,
        childSessionID: background.childSession,
        agent: "worker",
        returnKind: "step-terminal",
        stepId: "worker",
        outcome: "complete",
      },
    })
  } finally {
    background.h.restore()
  }

  const foreground = await run(false)
  try {
    expect(foreground.completed.coordinatorNotification).toEqual({
      notified: [],
      failed: [],
    })
    expect(foreground.h.syntheticMessages).toEqual([])
  } finally {
    foreground.h.restore()
  }
})

test("background completion stays committed when the General return wake fails", async () => {
  const generalSession = "background-return-failure-general"
  const childSession = "background-return-failure-worker"
  const h = await harness(
    undefined,
    (sessionID, projectID) =>
      sessionID === childSession
        ? { id: sessionID, projectID, parentID: generalSession }
        : { id: sessionID, projectID },
    undefined,
    () => {
      throw new Error("background return wake unavailable")
    },
    undefined,
    (sessionID) =>
      sessionID === generalSession
        ? [{
            parts: [{
              type: "tool",
              state: {
                metadata: {
                  parentSessionId: generalSession,
                  sessionId: childSession,
                  model: { providerID: "test", modelID: "test" },
                  background: true,
                },
              },
            }],
          }]
        : [],
  )
  try {
    const started = await h.call(
      "start",
      { request: "Complete one bounded background task despite notification failure." },
      "general",
      generalSession,
    )
    const workflowId = String(started.workflowId)
    expect((await h.call(
      "route",
      {
        humanFacing: false,
        behavioral: false,
        structural: false,
        externalUnknown: false,
        diagnostic: false,
        productOutcome: false,
        implementationRequested: true,
        executionDepth: "task",
      },
      "general",
      generalSession,
    )).error).toBeUndefined()

    const grant = await h.call(
      "dispatch_grant",
      { workflowId, stepId: "worker" },
      "general",
      generalSession,
    )
    expect((await h.call(
      "attach",
      { grantId: grant.grantId, workflowId, stepId: "worker" },
      "worker",
      childSession,
    )).attached).toBe(true)

    const completed = await h.call(
      "complete",
      {
        workflowId,
        stepId: "worker",
        summary: "The authoritative background work is complete.",
      },
      "worker",
      childSession,
    )
    expect(completed.error).toBeUndefined()
    expect(completed.coordinatorNotification).toEqual({
      notified: [],
      failed: [{
        target: "general",
        error: "background return wake unavailable",
      }],
    })
    expect((await h.durableStorage.get(`workflow/${workflowId}`) as any)
      .steps.find((step: any) => step.id === "worker")?.status).toBe("complete")
  } finally {
    h.restore()
  }
})

test("background OQ responder queues General after persisting its answer", async () => {
  const generalSession = "background-oq-general"
  const childSession = "background-oq-architect"
  const h = await harness(
    undefined,
    (sessionID, projectID) =>
      sessionID === childSession
        ? { id: sessionID, projectID, parentID: generalSession }
        : { id: sessionID, projectID },
    undefined,
    undefined,
    undefined,
    (sessionID) =>
      sessionID === generalSession
        ? [{
            parts: [{
              type: "tool",
              state: {
                metadata: {
                  parentSessionId: generalSession,
                  sessionId: childSession,
                  model: { providerID: "test", modelID: "test" },
                  background: true,
                },
              },
            }],
          }]
        : [],
  )
  try {
    const started = await h.call(
      "start",
      { request: "Resolve one bounded architecture question." },
      "general",
      generalSession,
    )
    const workflowId = String(started.workflowId)
    expect((await h.call(
      "route",
      {
        humanFacing: false,
        behavioral: false,
        structural: true,
        externalUnknown: false,
        diagnostic: false,
        productOutcome: false,
        implementationRequested: false,
        executionDepth: "change",
      },
      "general",
      generalSession,
    )).error).toBeUndefined()

    const raised = await h.call(
      "oq_raise",
      {
        workflowId,
        question: "Which structural boundary owns this interface?",
        responder: "architect",
        blocking: false,
      },
      "general",
      generalSession,
    )
    expect(raised.error).toBeUndefined()

    const grant = await h.call(
      "dispatch_grant",
      { workflowId, questionId: raised.question.id },
      "general",
      generalSession,
    )
    expect((await h.call(
      "attach",
      { grantId: grant.grantId, workflowId, questionId: raised.question.id },
      "architect",
      childSession,
    )).attached).toBe(true)

    const answered = await h.call(
      "oq_answer",
      {
        workflowId,
        questionId: raised.question.id,
        answer: "The interface belongs to the runtime boundary.",
        source: "agent",
      },
      "architect",
      childSession,
    )
    expect(answered.error).toBeUndefined()
    expect(answered.coordinatorNotification).toEqual({
      notified: ["general"],
      failed: [],
    })
    expect(h.syntheticMessages.at(-1)).toMatchObject({
      sessionID: generalSession,
      delivery: "queue",
      resume: true,
      metadata: {
        kind: "background-child-return",
        workflowId,
        childSessionID: childSession,
        agent: "architect",
        returnKind: "oq-answered",
        questionId: raised.question.id,
      },
    })
  } finally {
    h.restore()
  }
})

test("background child hard scope boundary queues General before the child stops", async () => {
  const generalSession = "background-scope-general"
  const childSession = "background-scope-worker"
  const h = await harness(
    undefined,
    (sessionID, projectID) =>
      sessionID === childSession
        ? { id: sessionID, projectID, parentID: generalSession }
        : { id: sessionID, projectID },
    undefined,
    undefined,
    undefined,
    (sessionID) =>
      sessionID === generalSession
        ? [{
            parts: [{
              type: "tool",
              state: {
                metadata: {
                  parentSessionId: generalSession,
                  sessionId: childSession,
                  model: { providerID: "test", modelID: "test" },
                  background: true,
                },
              },
            }],
          }]
        : [],
  )
  try {
    const started = await h.call(
      "start",
      { request: "Implement one bounded change that discovers a hard boundary." },
      "general",
      generalSession,
    )
    const workflowId = String(started.workflowId)
    expect((await h.call(
      "route",
      {
        humanFacing: false,
        behavioral: false,
        structural: false,
        externalUnknown: false,
        diagnostic: false,
        productOutcome: false,
        implementationRequested: true,
        executionDepth: "task",
      },
      "general",
      generalSession,
    )).error).toBeUndefined()

    const grant = await h.call(
      "dispatch_grant",
      { workflowId, stepId: "worker" },
      "general",
      generalSession,
    )
    expect((await h.call(
      "attach",
      { grantId: grant.grantId, workflowId, stepId: "worker" },
      "worker",
      childSession,
    )).attached).toBe(true)

    const outside = join(dirname(h.root), "background-return-external.txt")
    const result = await h.call(
      "scope_elevate",
      {
        workflowId,
        stepId: "worker",
        paths: [outside],
        reason: "The implementation discovered one required path outside the current project.",
      },
      "worker",
      childSession,
    )
    expect(result.error).toBeUndefined()
    expect(result.status).toBe("user_authorization_required")
    expect(result.continue).toBe(false)
    expect(result.coordinatorNotification).toEqual({
      notified: ["general"],
      failed: [],
    })
    expect(h.syntheticMessages.at(-1)).toMatchObject({
      sessionID: generalSession,
      delivery: "queue",
      resume: true,
      metadata: {
        kind: "background-child-return",
        workflowId,
        childSessionID: childSession,
        agent: "worker",
        returnKind: "scope-boundary",
        stepId: "worker",
        requestId: result.hardBoundary.requestId,
      },
    })
  } finally {
    h.restore()
  }
})

test("blocking child OQ gently queues General for routing without steering an active turn", async () => {
  const h = await harness()
  try {
    const generalSession = "oq-raised-general"
    const childSession = "oq-raised-worker"
    const started = await h.call(
      "start",
      { request: "Implement one bounded change with cross-role clarification." },
      "general",
      generalSession,
    )
    const workflowId = String(started.workflowId)
    expect((await h.call(
      "route",
      {
        humanFacing: false,
        behavioral: false,
        structural: false,
        externalUnknown: false,
        diagnostic: false,
        productOutcome: false,
        implementationRequested: true,
        executionDepth: "task",
      },
      "general",
      generalSession,
    )).error).toBeUndefined()

    const grant = await h.call(
      "dispatch_grant",
      { workflowId, stepId: "worker" },
      "general",
      generalSession,
    )
    expect((await h.call(
      "attach",
      { grantId: grant.grantId, workflowId, stepId: "worker" },
      "worker",
      childSession,
    )).attached).toBe(true)

    const responders = ["general", "user", "architect"] as const
    const raised: any[] = []
    for (const responder of responders) {
      const question = `Blocking question for ${responder}.`
      const result = await h.call(
        "oq_raise",
        {
          workflowId,
          stepId: "worker",
          question,
          responder,
          blocking: true,
        },
        "worker",
        childSession,
      )
      expect(result.error).toBeUndefined()
      expect(result.notifications).toEqual({
        notified: ["general"],
        failed: [],
      })
      raised.push({ result, question, responder })
    }

    expect(h.syntheticMessages).toHaveLength(responders.length)
    for (const [index, entry] of raised.entries()) {
      const message = h.syntheticMessages[index]
      expect(message).toMatchObject({
        sessionID: generalSession,
        description: "Loom blocking OQ raised",
        delivery: "queue",
        resume: true,
        metadata: {
          source: "loom",
          kind: "oq-raised",
          workflowId,
          questionId: entry.result.question.id,
          responder: entry.responder,
          raisedByAgent: "worker",
        },
      })
      expect(String(message?.text)).toContain(entry.result.question.id)
      expect(String(message?.text)).toContain("loom_oq_list")
      expect(String(message?.text)).not.toContain(entry.question)
    }
  } finally {
    h.restore()
  }
})

test("non-blocking child OQ stays in shared state without waking General", async () => {
  const h = await harness()
  try {
    const generalSession = "oq-nonblocking-general"
    const childSession = "oq-nonblocking-worker"
    const started = await h.call(
      "start",
      { request: "Implement one bounded change with optional peer input." },
      "general",
      generalSession,
    )
    const workflowId = String(started.workflowId)
    expect((await h.call(
      "route",
      {
        humanFacing: false,
        behavioral: false,
        structural: false,
        externalUnknown: false,
        diagnostic: false,
        productOutcome: false,
        implementationRequested: true,
        executionDepth: "task",
      },
      "general",
      generalSession,
    )).error).toBeUndefined()

    const grant = await h.call(
      "dispatch_grant",
      { workflowId, stepId: "worker" },
      "general",
      generalSession,
    )
    expect((await h.call(
      "attach",
      { grantId: grant.grantId, workflowId, stepId: "worker" },
      "worker",
      childSession,
    )).attached).toBe(true)

    const raised = await h.call(
      "oq_raise",
      {
        workflowId,
        stepId: "worker",
        question: "Can Architect provide optional context later?",
        responder: "architect",
        blocking: false,
      },
      "worker",
      childSession,
    )
    expect(raised.error).toBeUndefined()
    expect(raised.notifications).toEqual({
      notified: [],
      failed: [],
    })
    expect(h.syntheticMessages).toEqual([])
    expect((await h.durableStorage.get(
      `oq/${workflowId}/${raised.question.id}`,
    ) as any).status).toBe("open")
  } finally {
    h.restore()
  }
})

test("blocking OQ remains durable when the queued General wake fails", async () => {
  const h = await harness(
    undefined,
    undefined,
    undefined,
    () => {
      throw new Error("queued wake unavailable")
    },
  )
  try {
    const generalSession = "oq-raised-failure-general"
    const childSession = "oq-raised-failure-worker"
    const started = await h.call(
      "start",
      { request: "Implement one bounded change after clarification." },
      "general",
      generalSession,
    )
    const workflowId = String(started.workflowId)
    expect((await h.call(
      "route",
      {
        humanFacing: false,
        behavioral: false,
        structural: false,
        externalUnknown: false,
        diagnostic: false,
        productOutcome: false,
        implementationRequested: true,
        executionDepth: "task",
      },
      "general",
      generalSession,
    )).error).toBeUndefined()

    const grant = await h.call(
      "dispatch_grant",
      { workflowId, stepId: "worker" },
      "general",
      generalSession,
    )
    expect((await h.call(
      "attach",
      { grantId: grant.grantId, workflowId, stepId: "worker" },
      "worker",
      childSession,
    )).attached).toBe(true)

    const raised = await h.call(
      "oq_raise",
      {
        workflowId,
        stepId: "worker",
        question: "Which architectural constraint owns this boundary?",
        responder: "architect",
        blocking: true,
      },
      "worker",
      childSession,
    )
    expect(raised.error).toBeUndefined()
    expect(raised.notifications).toEqual({
      notified: [],
      failed: [{
        target: "general",
        error: "queued wake unavailable",
      }],
    })
    expect((await h.durableStorage.get(
      `oq/${workflowId}/${raised.question.id}`,
    ) as any).status).toBe("open")
  } finally {
    h.restore()
  }
})


test("answered OQ steers only the latest attached consumer session", async () => {
  const h = await harness()
  try {
    const generalSession = "oq-notify-general"
    const firstSession = "oq-notify-first"
    const latestSession = "oq-notify-latest"
    const started = await h.call(
      "start",
      { request: "Specify one bounded lifecycle behavior." },
      "general",
      generalSession,
    )
    const workflowId = String(started.workflowId)
    expect((await h.call(
      "route",
      {
        humanFacing: false,
        behavioral: true,
        structural: false,
        externalUnknown: false,
        diagnostic: false,
        productOutcome: false,
        implementationRequested: true,
        executionDepth: "change",
      },
      "general",
      generalSession,
    )).error).toBeUndefined()

    const firstGrant = await h.call(
      "dispatch_grant",
      { workflowId, stepId: "specifier" },
      "general",
      generalSession,
    )
    expect((await h.call(
      "attach",
      { grantId: firstGrant.grantId, workflowId, stepId: "specifier" },
      "specifier",
      firstSession,
    )).attached).toBe(true)

    const latestGrant = await h.call(
      "dispatch_grant",
      { workflowId, stepId: "specifier" },
      "general",
      generalSession,
    )
    expect((await h.call(
      "attach",
      { grantId: latestGrant.grantId, workflowId, stepId: "specifier" },
      "specifier",
      latestSession,
    )).attached).toBe(true)

    const raised = await h.call(
      "oq_raise",
      {
        workflowId,
        stepId: "specifier",
        question: "Which lifecycle meaning should be normative?",
        responder: "user",
        blocking: true,
      },
      "specifier",
      latestSession,
    )
    expect(raised.error).toBeUndefined()

    const authoritativeAnswer = "Use the strict lifecycle meaning."
    const answered = await h.call(
      "oq_answer",
      {
        workflowId,
        questionId: raised.question.id,
        answer: authoritativeAnswer,
        source: "user",
      },
      "general",
      generalSession,
    )
    expect(answered.error).toBeUndefined()
    expect(answered.notifications).toEqual({
      notified: ["specifier"],
      failed: [],
    })

    const answerMessages = h.syntheticMessages.filter(
      (message) => message.metadata?.kind === "oq-answered",
    )
    expect(answerMessages).toHaveLength(1)
    expect(answerMessages[0]).toMatchObject({
      sessionID: latestSession,
      description: "Loom OQ answered",
      delivery: "steer",
      resume: true,
      metadata: {
        source: "loom",
        kind: "oq-answered",
        workflowId,
        questionId: raised.question.id,
        stepId: "specifier",
        attempt: 0,
      },
    })
    expect(String(answerMessages[0]?.text)).toContain(raised.question.id)
    expect(String(answerMessages[0]?.text)).toContain("loom_oq_list")
    expect(String(answerMessages[0]?.text)).toContain("loom_oq_reconcile")
    expect(String(answerMessages[0]?.text)).not.toContain(authoritativeAnswer)
    expect(answerMessages.some((message) => message.sessionID === firstSession)).toBe(false)

    const listed = await h.call(
      "oq_list",
      { workflowId, stepId: "specifier" },
      "specifier",
      latestSession,
    )
    expect(
      listed.questions.find((question: any) => question.id === raised.question.id)
        ?.answer?.text,
    ).toBe(authoritativeAnswer)
  } finally {
    h.restore()
  }
})

test("answered OQ stays durable when synthetic wake-up delivery fails", async () => {
  const h = await harness(
    undefined,
    undefined,
    undefined,
    () => {
      throw new Error("synthetic wake unavailable")
    },
  )
  try {
    const generalSession = "oq-notify-failure-general"
    const childSession = "oq-notify-failure-worker"
    const started = await h.call(
      "start",
      { request: "Implement one bounded change after user clarification." },
      "general",
      generalSession,
    )
    const workflowId = String(started.workflowId)
    expect((await h.call(
      "route",
      {
        humanFacing: false,
        behavioral: false,
        structural: false,
        externalUnknown: false,
        diagnostic: false,
        productOutcome: false,
        implementationRequested: true,
        executionDepth: "task",
      },
      "general",
      generalSession,
    )).error).toBeUndefined()

    const grant = await h.call(
      "dispatch_grant",
      { workflowId, stepId: "worker" },
      "general",
      generalSession,
    )
    expect((await h.call(
      "attach",
      { grantId: grant.grantId, workflowId, stepId: "worker" },
      "worker",
      childSession,
    )).attached).toBe(true)

    const raised = await h.call(
      "oq_raise",
      {
        workflowId,
        stepId: "worker",
        question: "Which user-selected mode should the implementation use?",
        responder: "user",
        blocking: true,
      },
      "worker",
      childSession,
    )
    expect(raised.error).toBeUndefined()

    const answer = "Use strict mode."
    const answered = await h.call(
      "oq_answer",
      {
        workflowId,
        questionId: raised.question.id,
        answer,
        source: "user",
      },
      "general",
      generalSession,
    )
    expect(answered.error).toBeUndefined()
    expect(answered.notifications.notified).toEqual([])
    expect(answered.notifications.failed).toEqual([
      {
        stepId: "worker",
        error: "synthetic wake unavailable",
      },
    ])

    const persisted = await h.durableStorage.get(
      `oq/${workflowId}/${raised.question.id}`,
    ) as any
    expect(persisted.status).toBe("answered")
    expect(persisted.answer.text).toBe(answer)
  } finally {
    h.restore()
  }
})

test("answered OQ never revives a consumer session from an older step attempt", async () => {
  const h = await harness()
  try {
    const generalSession = "oq-stale-general"
    const childSession = "oq-stale-child"
    const started = await h.call(
      "start",
      { request: "Specify one bounded lifecycle behavior." },
      "general",
      generalSession,
    )
    const workflowId = String(started.workflowId)
    expect((await h.call(
      "route",
      {
        humanFacing: false,
        behavioral: true,
        structural: false,
        externalUnknown: false,
        diagnostic: false,
        productOutcome: false,
        implementationRequested: true,
        executionDepth: "change",
      },
      "general",
      generalSession,
    )).error).toBeUndefined()

    const grant = await h.call(
      "dispatch_grant",
      { workflowId, stepId: "specifier" },
      "general",
      generalSession,
    )
    expect((await h.call(
      "attach",
      { grantId: grant.grantId, workflowId, stepId: "specifier" },
      "specifier",
      childSession,
    )).attached).toBe(true)

    const raised = await h.call(
      "oq_raise",
      {
        workflowId,
        stepId: "specifier",
        question: "Which lifecycle meaning should be normative?",
        responder: "user",
        blocking: true,
      },
      "specifier",
      childSession,
    )
    expect(raised.error).toBeUndefined()

    const reopened = await h.call(
      "reopen",
      {
        workflowId,
        stepId: "specifier",
        reason: "New evidence requires a fresh Specifier attempt before the answer arrives.",
        newEvidence: true,
        changedHypothesis: false,
        changedStrategy: false,
        reducedUnresolved: false,
      },
      "general",
      generalSession,
    )
    expect(reopened.error).toBeUndefined()

    const answered = await h.call(
      "oq_answer",
      {
        workflowId,
        questionId: raised.question.id,
        answer: "Use the strict lifecycle meaning.",
        source: "user",
      },
      "general",
      generalSession,
    )
    expect(answered.error).toBeUndefined()
    expect(answered.notifications).toEqual({
      notified: [],
      failed: [],
    })
    expect(h.syntheticMessages.filter(
      (message) => message.metadata?.kind === "oq-answered",
    )).toEqual([])

    const persisted = await h.durableStorage.get(
      `oq/${workflowId}/${raised.question.id}`,
    ) as any
    expect(persisted.answer.text).toBe("Use the strict lifecycle meaning.")
  } finally {
    h.restore()
  }
})


test("a legacy-only child cannot bypass cancellation through its first host tool", async () => {
  const h = await waveLifecycleFixture()
  try {
    const historical = await h.workflow()
    await h.storage.set(`workflow/${h.workflowId}`, historical)
    await h.storage.set("session/legacy-only-child", h.workflowId)
    await h.storage.set("session-step/legacy-only-child", "knowledge-sync")
    await h.call("cancel", cancellationRequest(h.workflowId), "general", "parent")
    await expect(h.toolHooks.get("execute.before")!({ tool: "mcp_write", sessionID: "legacy-only-child", agent: "documenter", input: {} })).rejects.toThrow("cancelled")
    expect((await h.workflow()).cancellation).toBeDefined()
    expect(await h.durableStorage.get("session/legacy-only-child")).toBe(h.workflowId)
  } finally { h.restore() }
})

describe("Reviewer recovery probes", () => {
  test("R1: Code Mode wrapper permits new exact attachment after cancellation", async () => {
    const h = await waveLifecycleFixture()
    try {
      const child = await h.attach("task:one", "worker")
      await h.call("cancel", cancellationRequest(h.workflowId), "general", "parent")
      const next = await h.call("start", { request: "Replacement bounded edit" }, "general", "parent")
      await h.call("route", { humanFacing: false, behavioral: false, structural: false, externalUnknown: false, diagnostic: false, productOutcome: true, implementationRequested: true, executionDepth: "task" }, "general", "parent")
      await h.call("task_scope", { workflowId: next.workflowId, stepId: "worker", write: ["src/**"] }, "general", "parent")
      const grant = await h.call("dispatch_grant", { workflowId: next.workflowId, stepId: "worker" }, "general", "parent")
      const args = { workflowId: next.workflowId, stepId: "worker", grantId: grant.grantId }
      // This is the execute wrapper used in scripts/opencode-host-integration.ts,
      // not a direct call to the mirror's registered executor.
      const event = { tool: "execute", id: "new-exact-attachment", messageID: "new-message", sessionID: child, agent: "worker", input: { code: `return await tools.loom.code.attach(${JSON.stringify(args)})` } }
      let rejection: string | undefined
      try { await h.toolHooks.get("execute.before")!(event) } catch (error) { rejection = String(error) }
      // Native attachment remains a positive control for the same grant.
      const native = await h.call("attach", args, "worker", child)
      expect(native.attached).toBe(true)
      expect(rejection).toBeUndefined()
    } finally { h.restore() }
  })

  test("R2: failed terminal cancellation leaves historical verdict but releases ownership", async () => {
    const h = await waveLifecycleFixture()
    try {
      await h.finish("task:one", "worker")
      await h.finish("review-implementation", "reviewer", "fail")
      const cancelled = await h.call("cancel", cancellationRequest(h.workflowId), "general", "parent")
      const work = await h.work()
      const claims = work.nodes.filter((n: any) => n.claimedByWorkflowId === h.workflowId)
      const next = await h.call("start", { anchor: "docs/anchors/lifecycle/anchor.md" }, "general", "parent")
      expect(next.error).toBeUndefined()
      expect((await h.call("route", {
        humanFacing: false, behavioral: false, structural: false, externalUnknown: false,
        diagnostic: false, productOutcome: true, implementationRequested: true,
        executionDepth: "objective", workLevel: "wave",
      }, "general", "parent")).error).toBeUndefined()
      const nextAttach = async (stepId: string, agent: string) => {
        const grant = await h.call("dispatch_grant", { workflowId: next.workflowId, stepId }, "general", "parent")
        expect(grant.error).toBeUndefined()
        const child = `replacement-${stepId}`
        expect((await h.call("attach", { workflowId: next.workflowId, stepId, grantId: grant.grantId }, agent, child)).attached).toBe(true)
        return child
      }
      const critic = await nextAttach("critic-solution", "critic")
      expect((await h.call("complete", { workflowId: next.workflowId, stepId: "critic-solution", outcome: "pass", summary: "Reviewed replacement" }, "critic", critic)).error).toBeUndefined()
      const planner = await nextAttach("plan", "planner")
      const replacementTask = richPlanTask("two", "Two", "Replacement work")
      const replacementPlan = await h.call("work_plan", richWorkPlanInput(next.workflowId, [
        { id: "core", title: "Core", waves: [{ id: "next", title: "Next", tasks: [replacementTask] }] },
      ], {
        expectedVersion: (await h.work()).version,
        replaceReason: "User requested replacing the failed plan",
      }), "planner", planner)
      const retry = await h.call("cancel", cancellationRequest(h.workflowId), "general", "parent")
      expect((await h.workflow()).steps.find((s: any) => s.id === "review-implementation").status).toBe("failed")
      expect(claims).toHaveLength(0)
      expect(replacementPlan.error).toBeUndefined()
    } finally { h.restore() }
  })
})

describe("Critic cross-boundary counterexamples", () => {
  test("C1: late results from cancelled work cannot become replacement-workflow proof", async () => {
    const h = await waveLifecycleFixture()
    try {
      const child = await h.attach("task:one", "worker")
      const normal = { tool: "shell", id: "normal-test", messageID: "normal-message", sessionID: child,
        agent: "worker", input: { command: "bun test src/normal-control.test.ts" } }
      await h.toolHooks.get("execute.before")!(normal)
      await h.toolHooks.get("execute.after")!({ ...normal, status: "completed", result: "normal control passed" })
      const normalRecord = (await h.durableStorage.scan({ prefix: "evidence/", limit: 100 })).entries.map((e: any) => e.value).find((e: any) => e.command === normal.input.command)
      expect(normalRecord.workflowId).toBe(h.workflowId)
      expect((await h.call("evidence_claim", { workflowId: h.workflowId, stepId: "task:one", kind: "test",
        statement: "Normal unchanged attachment control", observationIds: [normalRecord.id] }, "worker", child)).claim).toBeDefined()
      const old = { tool: "shell", id: "old-running-test", messageID: "old-message", sessionID: child,
        agent: "worker", input: { command: "bun test src/old-state.test.ts" } }
      const noRebind = { ...old, id: "old-no-rebind", input: { command: "bun test src/no-rebind-control.test.ts" } }
      await h.toolHooks.get("execute.before")!(old)
      await h.toolHooks.get("execute.before")!(noRebind)
      expect((await h.call("cancel", cancellationRequest(h.workflowId), "general", "parent")).cancelled).toBe(true)
      await h.toolHooks.get("execute.after")!({ ...noRebind, status: "completed", result: "no rebind control" })
      const passiveRecord = (await h.durableStorage.scan({ prefix: "evidence/", limit: 100 })).entries.map((e: any) => e.value).find((e: any) => e.command === noRebind.input.command)
      expect(passiveRecord.workflowId).toBeUndefined()
      const next = await h.call("start", { request: "Replacement bounded edit against new state" }, "general", "parent")
      await h.call("route", { humanFacing: false, behavioral: false, structural: false, externalUnknown: false, diagnostic: false, productOutcome: true, implementationRequested: true, executionDepth: "task" }, "general", "parent")
      await h.call("task_scope", { workflowId: next.workflowId, stepId: "worker", write: ["src/**"] }, "general", "parent")
      const grant = await h.call("dispatch_grant", { workflowId: next.workflowId, stepId: "worker" }, "general", "parent")
      expect((await h.call("attach", { workflowId: next.workflowId, stepId: "worker", grantId: grant.grantId }, "worker", child)).attached).toBe(true)
      // Host event fixture: the earlier operation finishes after the session is
      // legitimately reused. Only production attribution/claim logic is tested.
      await h.toolHooks.get("execute.after")!({ ...old, status: "completed", result: "old state passed" })
      const records = (await h.durableStorage.scan({ prefix: "evidence/", limit: 100 })).entries.map((e: any) => e.value)
      const result = records.find((e: any) => e.command === old.input.command)
      const claim = await h.call("evidence_claim", { workflowId: next.workflowId, stepId: "worker", kind: "test",
        statement: "Proof for replacement work", observationIds: [result.id] }, "worker", child)
      expect(result.workflowId).not.toBe(next.workflowId)
      expect(claim.error).toBeDefined()
    } finally { h.restore() }
  })

  test("C2: partial-Wave reopening respects consumers of every reviewed Task", () => {
    const now = "2026-09-23T12:00:00Z"
    const a = richPlanTask("a", "A", "Build A")
    const b = richPlanTask("b", "B", "Build B", ["a"])
    const c = richPlanTask("c", "C", "Consume A's reviewed Wave", ["a"])
    const spec = (task: typeof a, dependsOn = task.dependsOn) => ({ ...task, dependsOn, write: [`src/${task.id}.ts`], skills: [] })
    const work = createWorkHierarchy("docs/anchors/partial/anchor.md", "original", now)
    materializeWorkPlan(work, "original", richPlanDefinition([{ id: "core", title: "Core", waves: [
      { id: "first", title: "First", tasks: [a, b] }, { id: "consumer", title: "Consumer", tasks: [c] },
    ] }]), now)
    claimWorkflowWave(work, "original", 1, [spec(a), spec(b)], false, now)
    syncWorkTaskStatuses(work, "original", 1, [{ taskId: "a", complete: true }, { taskId: "b", complete: false }], now)
    releaseCancelledWorkflowClaims(work, "original", now)
    claimWorkflowWave(work, "replacement", 1, [spec(b, [])], false, now)
    syncWorkTaskStatuses(work, "replacement", 1, [{ taskId: "b", complete: true }], now)
    completeWaveForTasks(work, "replacement", 1, ["b"], now, "a".repeat(64))
    const withoutConsumer = structuredClone(work)
    expect(() => reopenWaveForTasks(withoutConsumer, "replacement", 1, ["b"], now)).not.toThrow()
    claimWorkflowWave(work, "downstream", 1, [spec(c, [])], false, now)
    const beforeRejectedReopen = structuredClone(work)
    let rejection: string | undefined
    try { reopenWaveForTasks(work, "replacement", 1, ["b"], now) } catch (error) { rejection = String(error) }
    expect(rejection).toMatch(/downstream|consumed/)
    expect(work).toEqual(beforeRejectedReopen)
  })
})

async function replacementTask(h: Awaited<ReturnType<typeof harness>>, sessionID = "parent") {
  const next = await h.call("start", { request: "Replacement bounded edit" }, "general", sessionID)
  expect(next.error).toBeUndefined()
  expect((await h.call("route", {
    humanFacing: false, behavioral: false, structural: false, externalUnknown: false,
    diagnostic: false, productOutcome: false, implementationRequested: true, executionDepth: "task",
  }, "general", sessionID)).error).toBeUndefined()
  expect((await h.call("task_scope", { workflowId: next.workflowId, stepId: "worker", write: ["src/**"] }, "general", sessionID)).error).toBeUndefined()
  const grant = await h.call("dispatch_grant", { workflowId: next.workflowId, stepId: "worker" }, "general", sessionID)
  expect(grant.error).toBeUndefined()
  return { workflowId: next.workflowId as string, stepId: "worker", grantId: grant.grantId as string }
}

const shellEvent = (sessionID: string, id: string, messageID = "message") => ({
  tool: "shell", id, messageID, sessionID, agent: "worker", input: { command: `bun test src/${id}.test.ts` },
})

async function eventRecord(h: Awaited<ReturnType<typeof harness>>, event: ReturnType<typeof shellEvent>) {
  const { observations } = await h.call("evidence_observations", { detail: true }, "worker", event.sessionID)
  return observations.filter((item: any) => item.command === event.input.command)
}

describe("cancellation recovery negative controls", () => {
  test("Code Mode exposes history and exact attachment, not arbitrary programs or mutations", async () => {
    const h = await waveLifecycleFixture()
    try {
      const child = await h.attach("task:one", "worker")
      await h.call("cancel", cancellationRequest(h.workflowId), "general", "parent")
      const args = await replacementTask(h)
      const check = (code: string) => h.toolHooks.get("execute.before")!({
        tool: "execute", id: crypto.randomUUID(), messageID: "recovery", sessionID: child, agent: "worker", input: { code },
      })
      const literal = JSON.stringify(args)
      for (const code of [
        `return await tools.loom.code.attach(${literal}); await tools.shell({})`,
        `return await tools.loom.code.attach({...${literal}})`,
        `return await tools.loom.code.attach(JSON.parse(${JSON.stringify(literal)}))`,
        `return await tools.loom.code.attach({"grantId": (() => { throw 0 })()})`,
        'return await tools.loom.code.attach({"__proto__": {"workflowId":"bad"}})',
        'return await tools.loom.code.verification({"action":"prove"})',
        'return await tools.loom.code.complete({})',
        'return await tools.loom.code.cancel({})',
        'return await tools.loom.code.report_promote({})',
        'return await tools.other.attach({})',
        'return await tools["loom"]["code"]["attach"]({})',
        'return search({query:"loom"})',
      ]) await expect(check(code)).rejects.toThrow("cancelled")
      for (const name of ["status", "work_status", "evidence_observations"]) {
        await check(`return await tools.loom.code.${name}({})`)
      }
      await check('return await tools.loom.code.verification({"action":"status"})')
      const bad = { ...args, grantId: "not-a-grant" }
      await check(`return await tools.loom.code.attach(${JSON.stringify(bad)})`)
      expect((await h.call("loom_code_attach", bad, "worker", child)).error).toBeDefined()
      expect(await h.durableStorage.get(`session/${child}`)).toBe(h.workflowId)
      await check(`return await tools.loom.code.attach(${literal})`)
      expect((await h.call("loom_code_attach", args, "worker", child)).attached).toBe(true)
      expect(await h.durableStorage.get(`session/${child}`)).toBe(args.workflowId)
      expect((await h.call("loom_code_attach", args, "worker", child)).error).toBeDefined()
    } finally { h.restore() }
  })

  test("failed-terminal cleanup works after rebinding and preserves the replacement and failed verdict", async () => {
    const h = await waveLifecycleFixture()
    try {
      await h.finish("task:one", "worker")
      const unused = await h.call("dispatch_grant", { workflowId: h.workflowId, stepId: "review-implementation" }, "general", "parent")
      await h.finish("review-implementation", "reviewer", "fail")
      const next = await replacementTask(h)
      const nextBefore = await h.durableStorage.get(`workflow/${next.workflowId}`)
      expect((await h.work()).nodes.some((n: any) => n.claimedByWorkflowId === h.workflowId)).toBe(true)
      const result = await h.call("cancel", cancellationRequest(h.workflowId), "general", "parent")
      expect(result.cancelled).toBe(true)
      expect(result.cancellation.revokedGrantIds).toContain(unused.grantId)
      expect((await h.work()).nodes.some((n: any) => n.claimedByWorkflowId === h.workflowId)).toBe(false)
      expect((await h.workflow()).steps.find((s: any) => s.id === "review-implementation").status).toBe("failed")
      expect(await h.durableStorage.get(`workflow/${next.workflowId}`)).toEqual(nextBefore)
      expect(await h.durableStorage.get("session/parent")).toBe(next.workflowId)
      expect((await h.call("cancel", cancellationRequest(h.workflowId), "general", "parent")).alreadyCancelled).toBe(true)
      expect((await h.call("attach", next, "worker", "replacement-worker")).attached).toBe(true)
    } finally { h.restore() }
  })
})

describe("admission-bound evidence negative controls", () => {
  test("unmatched, duplicate, changed-input and changed-agent returns remain passive", async () => {
    const h = await harness()
    try {
      const args = await replacementTask(h)
      const child = "worker-child"
      expect((await h.call("attach", args, "worker", child)).attached).toBe(true)
      const before = h.toolHooks.get("execute.before")!
      const after = h.toolHooks.get("execute.after")!
      const unmatched = shellEvent(child, "unmatched")
      await after({ ...unmatched, status: "completed", result: "after only" })
      expect((await eventRecord(h, unmatched))[0].workflowId).toBeUndefined()
      const duplicated = shellEvent(child, "duplicated")
      await Promise.all([before(duplicated), before(duplicated)])
      await after({ ...duplicated, status: "completed", result: "ambiguous" })
      expect((await eventRecord(h, duplicated))[0].workflowId).toBeUndefined()
      const changed = shellEvent(child, "changed")
      await before(changed)
      await after({ ...changed, input: { command: "bun test something-else" }, status: "completed", result: "changed" })
      const [changedRecord] = await eventRecord(h, changed)
      expect(changedRecord.workflowId).toBeUndefined()
      expect(changedRecord.unscopedReason).toBe("input-changed")
      const wrongActor = shellEvent(child, "wrong-actor")
      await before(wrongActor)
      await after({ ...wrongActor, agent: "reviewer", status: "completed", result: "wrong actor" })
      expect((await eventRecord(h, wrongActor))[0].workflowId).toBeUndefined()
      const normal = shellEvent(child, "normal")
      await before(normal)
      await after({ ...normal, status: "completed", result: "normal" })
      await after({ ...normal, status: "completed", result: "replay" })
      const records = await eventRecord(h, normal)
      expect(records.filter((r: any) => r.workflowId === args.workflowId)).toHaveLength(1)
      expect(records.filter((r: any) => !r.workflowId)).toHaveLength(1)
    } finally { h.restore() }
  })

  test("call IDs are isolated by session, message and tool", async () => {
    const h = await harness()
    try {
      const args = await replacementTask(h)
      expect((await h.call("attach", args, "worker", "one")).attached).toBe(true)
      const grant = await h.call("dispatch_grant", { workflowId: args.workflowId, stepId: "worker" }, "general", "parent")
      expect((await h.call("attach", { ...args, grantId: grant.grantId }, "worker", "two")).attached).toBe(true)
      const events = [shellEvent("one", "same"), shellEvent("two", "same"), shellEvent("one", "same", "another"),
        { ...shellEvent("one", "same"), tool: "bash" }]
      for (const event of events) await h.toolHooks.get("execute.before")!(event)
      for (const event of [...events].reverse()) await h.toolHooks.get("execute.after")!({ ...event, status: "completed", result: "ok" })
      const entries = (await h.durableStorage.scan({ prefix: "evidence/", limit: 100 })).entries
      expect(entries).toHaveLength(4)
      expect(entries.every((entry: any) => entry.value.workflowId === args.workflowId)).toBe(true)
      const epochs = new Set(entries.map((e: any) => e.value.admission.attachmentId))
      expect(epochs.size).toBe(2)
    } finally { h.restore() }
  })

  test("new grants for the same step and reopen attempts invalidate outstanding results", async () => {
    const h = await harness()
    try {
      const args = await replacementTask(h)
      const child = "same-child"
      expect((await h.call("attach", args, "worker", child)).attached).toBe(true)
      const event = shellEvent(child, "old-attachment")
      await h.toolHooks.get("execute.before")!(event)
      const grant = await h.call("dispatch_grant", { workflowId: args.workflowId, stepId: "worker" }, "general", "parent")
      expect((await h.call("attach", { ...args, grantId: grant.grantId }, "worker", child)).attached).toBe(true)
      await h.toolHooks.get("execute.after")!({ ...event, status: "completed", result: "old attachment" })
      expect((await eventRecord(h, event))[0].unscopedReason).toBe("attachment-changed")
      const oldAttempt = shellEvent(child, "old-attempt")
      const previouslyCompleted = shellEvent(child, "completed-old-attempt")
      await h.toolHooks.get("execute.before")!(oldAttempt)
      await h.toolHooks.get("execute.before")!(previouslyCompleted)
      await h.toolHooks.get("execute.after")!({ ...previouslyCompleted, status: "completed", result: "old attempt succeeded" })
      const [previousProof] = await eventRecord(h, previouslyCompleted)
      expect(previousProof.workflowId).toBe(args.workflowId)
      expect((await h.call("reopen", reopenRequest(args.workflowId, "worker"), "general", "parent")).error).toBeUndefined()
      await h.toolHooks.get("execute.after")!({ ...oldAttempt, status: "completed", result: "late old attempt" })
      expect((await eventRecord(h, oldAttempt))[0].unscopedReason).toBe("step-changed")
      expect((await h.call("evidence_claim", {
        workflowId: args.workflowId, stepId: "worker", kind: "test", statement: "Old attempt cannot prove new work",
        observationIds: [previousProof.id],
      }, "worker", child)).error).toBeDefined()
      const fresh = shellEvent(child, "fresh-attempt")
      await h.toolHooks.get("execute.before")!(fresh)
      await h.toolHooks.get("execute.after")!({ ...fresh, status: "completed", result: "new attempt" })
      expect((await eventRecord(h, fresh))[0].workflowId).toBe(args.workflowId)
    } finally { h.restore() }
  })

  test("a restarted observer cannot invent a missing admission", async () => {
    const h = await harness()
    try {
      const args = await replacementTask(h)
      expect((await h.call("attach", args, "worker", "child")).attached).toBe(true)
      const event = shellEvent("child", "before-restart")
      await h.toolHooks.get("execute.before")!(event)
      const restarted = await harness(undefined, undefined, { root: h.root, storage: h.storage })
      try {
        await restarted.toolHooks.get("execute.after")!({ ...event, status: "completed", result: "unknown admission" })
        expect((await eventRecord(restarted, event))[0].workflowId).toBeUndefined()
        const fresh = shellEvent("child", "after-restart")
        await restarted.toolHooks.get("execute.before")!(fresh)
        await restarted.toolHooks.get("execute.after")!({ ...fresh, status: "completed", result: "newly observed" })
        expect((await eventRecord(restarted, fresh))[0].workflowId).toBe(args.workflowId)
      } finally { restarted.restore() }
    } finally { h.restore() }
  })
})


describe("proof-consumer and full-Wave negative controls", () => {
  test("late OKF discovery cannot validate replacement knowledge; fresh discovery can", async () => {
    const h = await waveLifecycleFixture()
    try {
      await h.finish("task:one", "worker")
      await h.finish("review-implementation", "reviewer", "pass")
      const child = await h.attach("knowledge-sync", "documenter")
      const old = { tool: "okf-mcp_list_docs", id: "delayed-discovery", messageID: "old-message",
        sessionID: child, agent: "documenter", input: {} }
      await h.toolHooks.get("execute.before")!(old)
      expect((await h.call("cancel", cancellationRequest(h.workflowId), "general", "parent")).cancelled).toBe(true)
      const next = await h.call("start", { request: "Update bounded architecture and its living documentation" }, "general", "parent")
      expect(next.error).toBeUndefined()
      expect((await h.call("route", { humanFacing: false, behavioral: false, structural: true,
        externalUnknown: false, diagnostic: false, productOutcome: false,
        implementationRequested: true, executionDepth: "change" }, "general", "parent")).error).toBeUndefined()
      const attach = async (stepId: string, agent: string, sessionID = `new-${stepId}`) => {
        const grant = await h.call("dispatch_grant", { workflowId: next.workflowId, stepId }, "general", "parent")
        expect(grant.error).toBeUndefined()
        expect((await h.call("attach", { workflowId: next.workflowId, stepId, grantId: grant.grantId }, agent, sessionID)).attached).toBe(true)
        return sessionID
      }
      for (const [stepId, agent, outcome] of [["architect", "architect", "complete"],
        ["review-architecture", "reviewer", "pass"], ["worker", "worker", "complete"],
        ["review-implementation", "reviewer", "pass"]]) {
        if (agent === "worker") expect((await h.call("task_scope", {
          workflowId: next.workflowId, stepId, write: ["src/**"],
        }, "general", "parent")).error).toBeUndefined()
        const session = await attach(stepId!, agent!)
        expect((await h.call("complete", { workflowId: next.workflowId, stepId, outcome, summary: "Controlled fixture" }, agent!, session)).error).toBeUndefined()
      }
      await attach("knowledge-sync", "documenter", child)
      await h.toolHooks.get("execute.after")!({ ...old, status: "completed", result: [] })
      const all = await h.call("evidence_observations", { detail: true }, "documenter", child)
      const stale = all.observations.find((item: any) => item.tool === old.tool)
      expect(stale.admission.workflowId).toBe(h.workflowId)
      expect(stale.workflowId).toBeUndefined()
      const input = { workflowId: next.workflowId, changedDocs: [], unchangedReason: "Observed documentation state is accurate.", okfObservationIds: [stale.id] }
      expect((await h.call("knowledge_record", input, "documenter", child)).error).toContain("admitted")
      expect((await h.call("knowledge_status", { workflowId: next.workflowId }, "documenter", child)).report).toBeNull()
      const fresh = { ...old, id: "new-discovery", messageID: "new-message" }
      await h.toolHooks.get("execute.before")!(fresh)
      await h.toolHooks.get("execute.after")!({ ...fresh, status: "completed", result: [] })
      const current = (await h.call("evidence_observations", { detail: true }, "documenter", child)).observations.find((item: any) => item.workflowId === next.workflowId)
      expect((await h.call("knowledge_record", { ...input, okfObservationIds: [current.id] }, "documenter", child)).report.valid).toBe(true)
      expect((await h.call("complete", { workflowId: next.workflowId, stepId: "knowledge-sync", summary: "Fresh discovery used" }, "documenter", child)).error).toBeUndefined()
    } finally { h.restore() }
  })

  test("full-Wave invalidation preserves completed consumers and allows unrelated claims", () => {
    const now = "2026-09-23T12:00:00Z"
    const a = richPlanTask("a", "A", "Build A")
    const b = richPlanTask("b", "B", "Build B", ["a"])
    const c = richPlanTask("c", "C", "Consume A", ["a"])
    const d = richPlanTask("d", "D", "Consume C", ["c"])
    const u = richPlanTask("u", "U", "Unrelated work")
    const spec = (task: typeof a, dependsOn = task.dependsOn) => ({ ...task, dependsOn, write: [`src/${task.id}.ts`], skills: [] })
    const work = createWorkHierarchy("docs/anchors/partial/anchor.md", "original", now)
    materializeWorkPlan(work, "original", richPlanDefinition([{ id: "core", title: "Core", waves: [
      { id: "first", title: "First", tasks: [a, b] }, { id: "second", title: "Second", tasks: [c] },
      { id: "third", title: "Third", tasks: [d] }, { id: "unrelated", title: "Unrelated", tasks: [u] },
    ] }]), now)
    claimWorkflowWave(work, "original", 1, [spec(a), spec(b)], false, now)
    syncWorkTaskStatuses(work, "original", 1, [{ taskId: "a", complete: true }], now)
    releaseCancelledWorkflowClaims(work, "original", now)
    claimWorkflowWave(work, "replacement", 1, [spec(b, [])], false, now)
    syncWorkTaskStatuses(work, "replacement", 1, [{ taskId: "b", complete: true }], now)
    completeWaveForTasks(work, "replacement", 1, ["b"], now, "a".repeat(64))
    claimWorkflowWave(work, "unrelated", 1, [spec(u)], false, now)
    const unrelatedControl = structuredClone(work)
    expect(() => reopenWaveForTasks(unrelatedControl, "replacement", 1, ["b"], now)).not.toThrow()
    expect(unrelatedControl.nodes.find(node => node.logicalId === "u")?.claimedByWorkflowId).toBe("unrelated")
    claimWorkflowWave(work, "consumer", 1, [spec(c, [])], false, now)
    syncWorkTaskStatuses(work, "consumer", 1, [{ taskId: "c", complete: true }], now)
    completeWaveForTasks(work, "consumer", 1, ["c"], now, "a".repeat(64))
    const beforeCompletedConsumer = structuredClone(work)
    expect(() => reopenWaveForTasks(work, "replacement", 1, ["b"], now)).toThrow("downstream")
    expect(work).toEqual(beforeCompletedConsumer)
    claimWorkflowWave(work, "transitive-consumer", 1, [spec(d, [])], false, now)
    const beforeTransitiveConsumer = structuredClone(work)
    expect(() => reopenWaveForTasks(work, "replacement", 1, ["b"], now)).toThrow("downstream")
    expect(work).toEqual(beforeTransitiveConsumer)
  })
})

describe("re-review proof-history attacks", () => {
  test("legacy scoped observations survive upgrade but cannot prove a reopened attempt", async () => {
    const h = await harness()
    try {
      const args = await replacementTask(h)
      expect((await h.call("attach", args, "worker", "legacy-child")).attached).toBe(true)
      const record = { id: "legacy-proof", sessionID: "legacy-child", agent: "worker", tool: "shell",
        workflowId: args.workflowId, stepId: "worker", status: "completed", command: "bun test fixture", observedAt: "2026-09-23T00:00:00Z" }
      await h.durableStorage.set("evidence/legacy-proof", record)
      await h.durableStorage.set("evidence-session/legacy-child/legacy-proof", record.id)
      const input = { workflowId: args.workflowId, stepId: "worker", kind: "test", statement: "Legacy observed history", observationIds: [record.id] }
      expect((await h.call("evidence_claim", input, "worker", "legacy-child")).claim).toBeDefined()
      expect((await h.call("reopen", reopenRequest(args.workflowId, "worker"), "general", "parent")).error).toBeUndefined()
      expect((await h.call("evidence_claim", input, "worker", "legacy-child")).error).toBeDefined()
      expect(await h.durableStorage.get("evidence/legacy-proof")).toEqual(record)
    } finally { h.restore() }
  })

  test("previously minted acceptance claims cannot bypass reopened attempt checks", async () => {
    const h = await waveLifecycleFixture("objective")
    try {
      await h.finish("task:one", "worker")
      await h.finish("review-implementation", "reviewer", "pass")
      const child = await h.attach("product-acceptance", "acceptance")
      expect((await h.call("pa_plan", { workflowId: h.workflowId, scenarios: [
        { id: "scenario", title: "Controlled lifecycle check", criteria: ["preserve proof origin"] },
      ] }, "acceptance", child)).error).toBeUndefined()
      const claim = async (id: string) => {
        const event = { tool: "shell", id, messageID: id, sessionID: child, agent: "acceptance", input: { command: `bun test ${id}` } }
        await h.toolHooks.get("execute.before")!(event)
        await h.toolHooks.get("execute.after")!({ ...event, status: "completed", result: "Controlled fixture" })
        const observation = (await h.call("evidence_observations", { detail: true }, "acceptance", child)).observations.find((r: any) => r.command === event.input.command)
        const result = await h.call("evidence_claim", { workflowId: h.workflowId, stepId: "product-acceptance", kind: "product-acceptance",
          statement: "Controlled fixture, not actual application acceptance", observationIds: [observation.id] }, "acceptance", child)
        expect(result.error).toBeUndefined()
        return result.claim
      }
      const oldClaim = await claim("first-attempt")
      const input = { workflowId: h.workflowId, scenarioId: "scenario", outcome: "passed", note: "Controlled fixture", evidenceClaimIds: [oldClaim.id] }
      expect((await h.call("pa_result", input, "acceptance", child)).error).toBeUndefined()
      expect((await h.call("reopen", reopenRequest(h.workflowId, "product-acceptance"), "general", "parent")).error).toBeUndefined()
      expect((await h.call("pa_result", input, "acceptance", child)).error).toBeDefined()
      const freshClaim = await claim("second-attempt")
      expect((await h.call("pa_result", { ...input, evidenceClaimIds: [freshClaim.id] }, "acceptance", child)).scenario.outcome).toBe("passed")
    } finally { h.restore() }
  })
})

describe("Skill methodology evidence lifecycle", () => {
  test("Plan review verdict is fenced to the exact reviewed Plan revision", async () => {
    const h = await harness()
    try {
      const started = await h.call("start", { anchor: "docs/anchors/plan-review-revision/anchor.md" }, "general", "plan-review-revision-general")
      const workflowId = String(started.workflowId)
      expect((await h.call("route", {
        humanFacing: false,
        behavioral: false,
        structural: false,
        externalUnknown: false,
        diagnostic: false,
        productOutcome: true,
        implementationRequested: true,
        executionDepth: "objective",
        workLevel: "wave",
      }, "general", "plan-review-revision-general")).error).toBeUndefined()

      const attach = async (stepId: string, agent: string, sessionID: string) => {
        const grant = await h.call("dispatch_grant", { workflowId, stepId }, "general", "plan-review-revision-general")
        expect(grant.error).toBeUndefined()
        const attached = await h.call("attach", { workflowId, stepId, grantId: grant.grantId }, agent, sessionID)
        expect(attached.error).toBeUndefined()
        return attached
      }

      await attach("critic-solution", "critic", "plan-review-revision-critic")
      expect((await h.call("complete", {
        workflowId,
        stepId: "critic-solution",
        outcome: "pass",
        summary: "Solution ready for planning",
      }, "critic", "plan-review-revision-critic")).error).toBeUndefined()

      await attach("plan", "planner", "plan-review-revision-planner")
      const first = richPlanTask("first-task", "First task", "Build first")
      const future = richPlanTask("future-task", "Future task", "Build future", ["first-task"])
      expect((await h.call("work_plan", richWorkPlanInput(workflowId, [{
        id: "core",
        title: "Core",
        waves: [
          { id: "first", title: "First", tasks: [first] },
          { id: "future", title: "Future", tasks: [future] },
        ],
      }]), "planner", "plan-review-revision-planner")).error).toBeUndefined()
      expect((await h.call("task_plan", {
        workflowId,
        tasks: [{ ...first, write: ["src/first/**"], skills: [] }],
      }, "planner", "plan-review-revision-planner")).error).toBeUndefined()
      expect((await h.call("complete", {
        workflowId,
        stepId: "plan",
        summary: "Revision 1 compiled",
      }, "planner", "plan-review-revision-planner")).error).toBeUndefined()

      const firstReviewer = "plan-review-revision-reviewer-1"
      const firstAttach = await attach("review-plan", "reviewer", firstReviewer)
      expect(firstAttach.planContext.revision).toBe(1)

      const raised = await h.call("oq_raise", {
        workflowId,
        question: "Clarify the future Wave checklist without changing the current Wave.",
        responder: "planner",
        blocking: false,
      }, "general", "plan-review-revision-general")
      expect(raised.error).toBeUndefined()
      const plannerGrant = await h.call("dispatch_grant", {
        workflowId,
        questionId: raised.question.id,
      }, "general", "plan-review-revision-general")
      expect(plannerGrant.error).toBeUndefined()
      const oqPlanner = "plan-review-revision-oq-planner"
      expect((await h.call("attach", {
        workflowId,
        questionId: raised.question.id,
        grantId: plannerGrant.grantId,
      }, "planner", oqPlanner)).error).toBeUndefined()

      const objectiveId = (await h.durableStorage.get(`workflow/${workflowId}`) as any).work.objectiveId
      const before = await h.durableStorage.get(`work/${encodeURIComponent(objectiveId)}`) as any
      const amended = await h.call("work_amend", {
        workflowId,
        questionId: raised.question.id,
        expectedVersion: before.version,
        reason: "Clarify untouched future work while the current Wave is under review.",
        operations: [{
          action: "patch-task",
          taskId: "future-task",
          patch: { subtasks: ["Exercise the future recovery path"] },
        }],
      }, "planner", oqPlanner)
      expect(amended.error).toBeUndefined()
      expect(amended.revision).toBe(2)
      expect(amended.taskPlanRefreshRequired).toBe(false)

      const staleVerdict = await h.call("complete", {
        workflowId,
        stepId: "review-plan",
        outcome: "pass",
        summary: "Verdict based on revision 1",
      }, "reviewer", firstReviewer)
      expect(staleVerdict.error).toContain("changed after Reviewer attachment")

      const freshReviewer = "plan-review-revision-reviewer-2"
      const freshAttach = await attach("review-plan", "reviewer", freshReviewer)
      expect(freshAttach.planContext.revision).toBe(2)
      expect((await h.call("complete", {
        workflowId,
        stepId: "review-plan",
        outcome: "pass",
        summary: "Revision 2 independently reviewed",
      }, "reviewer", freshReviewer)).error).toBeUndefined()
    } finally {
      h.restore()
    }
  })

  test("Plan review verdict is fenced to the exact executable Task DAG", async () => {
    const h = await harness()
    try {
      const started = await h.call("start", { anchor: "docs/anchors/plan-review-dag/anchor.md" }, "general", "plan-review-dag-general")
      const workflowId = String(started.workflowId)
      expect((await h.call("route", {
        humanFacing: false,
        behavioral: false,
        structural: false,
        externalUnknown: false,
        diagnostic: false,
        productOutcome: true,
        implementationRequested: true,
        executionDepth: "objective",
        workLevel: "wave",
      }, "general", "plan-review-dag-general")).error).toBeUndefined()

      const attach = async (stepId: string, agent: string, sessionID: string) => {
        const grant = await h.call("dispatch_grant", { workflowId, stepId }, "general", "plan-review-dag-general")
        expect(grant.error).toBeUndefined()
        const attached = await h.call("attach", { workflowId, stepId, grantId: grant.grantId }, agent, sessionID)
        expect(attached.error).toBeUndefined()
        return attached
      }

      await attach("critic-solution", "critic", "plan-review-dag-critic")
      expect((await h.call("complete", {
        workflowId,
        stepId: "critic-solution",
        outcome: "pass",
        summary: "Solution ready for planning",
      }, "critic", "plan-review-dag-critic")).error).toBeUndefined()

      await attach("plan", "planner", "plan-review-dag-planner-1")
      const task = richPlanTask("scope-task", "Scope task", "Build the bounded scope")
      expect((await h.call("work_plan", richWorkPlanInput(workflowId, [{
        id: "core",
        title: "Core",
        waves: [{ id: "first", title: "First", tasks: [task] }],
      }]), "planner", "plan-review-dag-planner-1")).error).toBeUndefined()
      expect((await h.call("task_plan", {
        workflowId,
        tasks: [{ ...task, write: ["src/narrow/**"], skills: [] }],
      }, "planner", "plan-review-dag-planner-1")).error).toBeUndefined()
      expect((await h.call("complete", {
        workflowId,
        stepId: "plan",
        summary: "Executable scope compiled",
      }, "planner", "plan-review-dag-planner-1")).error).toBeUndefined()

      const staleReviewer = "plan-review-dag-reviewer-1"
      expect((await attach("review-plan", "reviewer", staleReviewer)).planContext.revision).toBe(1)

      expect((await h.call("reopen", {
        workflowId,
        stepId: "plan",
        reason: "Executable write scope needs correction without changing semantic Plan meaning.",
        newEvidence: true,
        changedHypothesis: false,
        changedStrategy: true,
        reducedUnresolved: false,
      }, "general", "plan-review-dag-general")).error).toBeUndefined()

      await attach("plan", "planner", "plan-review-dag-planner-2")
      expect((await h.call("task_plan", {
        workflowId,
        tasks: [{ ...task, write: ["src/correct/**"], skills: [] }],
      }, "planner", "plan-review-dag-planner-2")).error).toBeUndefined()
      expect((await h.call("complete", {
        workflowId,
        stepId: "plan",
        summary: "Corrected executable scope compiled",
      }, "planner", "plan-review-dag-planner-2")).error).toBeUndefined()

      const staleVerdict = await h.call("complete", {
        workflowId,
        stepId: "review-plan",
        outcome: "pass",
        summary: "Verdict from the old executable scope",
      }, "reviewer", staleReviewer)
      expect(staleVerdict.error).toContain("changed after Reviewer attachment")

      const freshReviewer = "plan-review-dag-reviewer-2"
      await attach("review-plan", "reviewer", freshReviewer)
      const exact = await h.call("task_status", {
        workflowId,
        taskId: "scope-task",
      }, "reviewer", freshReviewer)
      expect(exact.tasks[0].task.write).toEqual(["src/correct/**"])
      expect((await h.call("complete", {
        workflowId,
        stepId: "review-plan",
        outcome: "pass",
        summary: "Corrected executable scope independently reviewed",
      }, "reviewer", freshReviewer)).error).toBeUndefined()
    } finally {
      h.restore()
    }
  })

  test("reopening Plan invalidates an attached Plan-review attempt even when content is unchanged", async () => {
    const h = await harness()
    try {
      const started = await h.call("start", { anchor: "docs/anchors/plan-review-attempt/anchor.md" }, "general", "plan-review-attempt-general")
      const workflowId = String(started.workflowId)
      expect((await h.call("route", {
        humanFacing: false,
        behavioral: false,
        structural: false,
        externalUnknown: false,
        diagnostic: false,
        productOutcome: true,
        implementationRequested: true,
        executionDepth: "objective",
        workLevel: "wave",
      }, "general", "plan-review-attempt-general")).error).toBeUndefined()

      const attach = async (stepId: string, agent: string, sessionID: string) => {
        const grant = await h.call("dispatch_grant", { workflowId, stepId }, "general", "plan-review-attempt-general")
        expect(grant.error).toBeUndefined()
        const attached = await h.call("attach", { workflowId, stepId, grantId: grant.grantId }, agent, sessionID)
        expect(attached.error).toBeUndefined()
        return attached
      }

      await attach("critic-solution", "critic", "plan-review-attempt-critic")
      expect((await h.call("complete", {
        workflowId,
        stepId: "critic-solution",
        outcome: "pass",
        summary: "Solution ready for planning",
      }, "critic", "plan-review-attempt-critic")).error).toBeUndefined()

      const task = richPlanTask("attempt-task", "Attempt task", "Build the bounded task")
      await attach("plan", "planner", "plan-review-attempt-planner-1")
      expect((await h.call("work_plan", richWorkPlanInput(workflowId, [{
        id: "core",
        title: "Core",
        waves: [{ id: "first", title: "First", tasks: [task] }],
      }]), "planner", "plan-review-attempt-planner-1")).error).toBeUndefined()
      expect((await h.call("task_plan", {
        workflowId,
        tasks: [{ ...task, write: ["src/**"], skills: [] }],
      }, "planner", "plan-review-attempt-planner-1")).error).toBeUndefined()
      expect((await h.call("complete", {
        workflowId,
        stepId: "plan",
        summary: "Plan compiled",
      }, "planner", "plan-review-attempt-planner-1")).error).toBeUndefined()

      const staleReviewer = "plan-review-attempt-reviewer-1"
      await attach("review-plan", "reviewer", staleReviewer)

      expect((await h.call("reopen", {
        workflowId,
        stepId: "plan",
        reason: "Re-evaluate the same Plan with fresh review evidence.",
        newEvidence: true,
        changedHypothesis: false,
        changedStrategy: false,
        reducedUnresolved: false,
      }, "general", "plan-review-attempt-general")).error).toBeUndefined()

      await attach("plan", "planner", "plan-review-attempt-planner-2")
      expect((await h.call("task_plan", {
        workflowId,
        tasks: [{ ...task, write: ["src/**"], skills: [] }],
      }, "planner", "plan-review-attempt-planner-2")).error).toBeUndefined()
      expect((await h.call("complete", {
        workflowId,
        stepId: "plan",
        summary: "Same Plan recompiled",
      }, "planner", "plan-review-attempt-planner-2")).error).toBeUndefined()

      const staleVerdict = await h.call("complete", {
        workflowId,
        stepId: "review-plan",
        outcome: "pass",
        summary: "Old attachment must not satisfy the reopened review.",
      }, "reviewer", staleReviewer)
      expect(staleVerdict.error).toContain("Plan review attempt")

      const freshReviewer = "plan-review-attempt-reviewer-2"
      await attach("review-plan", "reviewer", freshReviewer)
      expect((await h.call("complete", {
        workflowId,
        stepId: "review-plan",
        outcome: "pass",
        summary: "Fresh review attempt passed.",
      }, "reviewer", freshReviewer)).error).toBeUndefined()
    } finally {
      h.restore()
    }
  })

  test("Plan review inherits Planner methodology and can load its assessments", async () => {
    const h = await harness()
    try {
      const started = await h.call("start", { anchor: "docs/anchors/plan-review-skills/anchor.md" }, "general", "plan-review-general")
      const workflowId = String(started.workflowId)
      expect((await h.call("route", {
        humanFacing: false,
        behavioral: false,
        structural: false,
        externalUnknown: false,
        diagnostic: false,
        productOutcome: true,
        implementationRequested: true,
        executionDepth: "objective",
        workLevel: "wave",
      }, "general", "plan-review-general")).error).toBeUndefined()

      const attach = async (stepId: string, agent: string, sessionID: string) => {
        const grant = await h.call("dispatch_grant", { workflowId, stepId }, "general", "plan-review-general")
        expect(grant.error).toBeUndefined()
        const attached = await h.call("attach", { workflowId, stepId, grantId: grant.grantId }, agent, sessionID)
        expect(attached.error).toBeUndefined()
        return attached
      }

      await attach("critic-solution", "critic", "plan-review-critic")
      expect((await h.call("complete", {
        workflowId,
        stepId: "critic-solution",
        outcome: "pass",
        summary: "Solution ready for planning",
      }, "critic", "plan-review-critic")).error).toBeUndefined()

      await attach("plan", "planner", "plan-review-planner")
      for (const skill of ["risk-driven-planning", "work-decomposition"]) {
        const event = {
          tool: "skill",
          callID: `planner-${skill}`,
          messageID: `planner-${skill}-message`,
          sessionID: "plan-review-planner",
          agent: "planner",
          input: { name: skill },
        }
        const result = { metadata: { metadata: { directory: `${process.cwd()}/skills/${skill}` } } }
        await h.toolHooks.get("execute.before")!(event)
        await h.toolHooks.get("execute.after")!({ ...event, status: "completed", result })
      }

      const task = richPlanTask("reviewed-task", "Reviewed task", "Deliver the reviewed task")
      expect((await h.call("work_plan", richWorkPlanInput(workflowId, [{
        id: "core",
        title: "Core",
        waves: [{ id: "first", title: "First", tasks: [task] }],
      }]), "planner", "plan-review-planner")).error).toBeUndefined()
      expect((await h.call("task_plan", {
        workflowId,
        tasks: [{ ...task, write: ["src/**"], skills: [] }],
      }, "planner", "plan-review-planner")).error).toBeUndefined()
      expect((await h.call("complete", {
        workflowId,
        stepId: "plan",
        summary: "Plan compiled for independent review",
      }, "planner", "plan-review-planner")).error).toBeUndefined()

      const attached = await attach("review-plan", "reviewer", "plan-review-reviewer")
      expect(attached.producerSkills).toEqual([
        { skill: "risk-driven-planning", stepIds: ["plan"] },
        { skill: "work-decomposition", stepIds: ["plan"] },
      ])

      for (const skill of ["risk-driven-planning", "work-decomposition"]) {
        const event = {
          tool: "skill",
          callID: `reviewer-${skill}`,
          messageID: `reviewer-${skill}-message`,
          sessionID: "plan-review-reviewer",
          agent: "reviewer",
          input: { name: skill },
        }
        const result = { metadata: { metadata: { directory: `${process.cwd()}/skills/${skill}` } } }
        await h.toolHooks.get("execute.before")!(event)
        await h.toolHooks.get("execute.after")!({ ...event, status: "completed", result })
        const assessment = await h.callObserved("assessment", { skill }, "reviewer", "plan-review-reviewer", `assessment-${skill}`)
        expect(assessment.available).toBe(true)
      }

      const exact = await h.call("task_status", {
        workflowId,
        taskId: "reviewed-task",
      }, "reviewer", "plan-review-reviewer")
      expect(exact.tasks[0].task.write).toEqual(["src/**"])
      expect((await h.call("complete", {
        workflowId,
        stepId: "review-plan",
        outcome: "pass",
        summary: "Plan and executable scope independently reviewed",
      }, "reviewer", "plan-review-reviewer")).error).toBeUndefined()
    } finally {
      h.restore()
    }
  })

  test("producer skill loads become Reviewer facts and assessment evidence", async () => {
    const h=await harness(); try {
      const started=await h.call("start",{anchor:"docs/anchors/skill-evidence/anchor.md"},"general","skill-general"); const workflowId=String(started.workflowId)
      await h.call("route",{humanFacing:false,behavioral:false,structural:false,externalUnknown:false,diagnostic:false,productOutcome:false,implementationRequested:true,executionDepth:"task"},"general","skill-general")
      await h.call("task_scope",{workflowId,stepId:"worker",write:["src/**"]},"general","skill-general")
      const wg=await h.call("dispatch_grant",{workflowId,stepId:"worker"},"general","skill-general"); expect((await h.call("attach",{grantId:wg.grantId,workflowId,stepId:"worker"},"worker","skill-worker")).attached).toBe(true)
      const skillResult={metadata:{metadata:{directory:`${process.cwd()}/skills/software-engineering`}}}; const ev={tool:"skill",callID:"skill-load",messageID:"worker-message",sessionID:"skill-worker",agent:"worker",input:{name:"software-engineering"}}; await h.toolHooks.get("execute.before")!(ev); await h.toolHooks.get("execute.after")!({...ev,status:"completed",result:skillResult})
      expect((await h.call("complete",{workflowId,stepId:"worker",summary:"done"},"worker","skill-worker")).error).toBeUndefined()
      const rg=await h.call("dispatch_grant",{workflowId,stepId:"review-implementation"},"general","skill-general"); const attached=await h.call("attach",{grantId:rg.grantId,workflowId,stepId:"review-implementation"},"reviewer","skill-reviewer"); expect(attached.producerSkills).toEqual([{skill:"software-engineering",stepIds:["worker"]}])
      const reviewerSkill={tool:"skill",callID:"reviewer-skill-load",messageID:"reviewer-message",sessionID:"skill-reviewer",agent:"reviewer",input:{name:"software-engineering"}}; await h.toolHooks.get("execute.before")!(reviewerSkill); await h.toolHooks.get("execute.after")!({...reviewerSkill,status:"completed",result:skillResult})
      const assessment=await h.callObserved("assessment",{skill:"software-engineering"},"reviewer","skill-reviewer","assessment-load"); expect(assessment.available).toBe(true); expect(assessment.content).toContain("## Review criteria")
      expect((await h.call("assessment",{skill:"golang-concurrency"},"reviewer","skill-reviewer")).error).toContain("not observed")
      expect((await h.call("qa",{skill:"software-engineering"},"reviewer","skill-reviewer")).error).toContain("reserved for critic")
      const sessionBeforeComplete=await h.durableStorage.scan({prefix:"evidence-session/skill-reviewer/"}); const sessionRecords=await Promise.all(sessionBeforeComplete.entries.map(async(entry:any)=>h.durableStorage.get(`evidence/${entry.value}`))); expect(sessionRecords.filter((record:any)=>record?.methodology==="assessment")).toHaveLength(1)
      expect((await h.call("complete",{workflowId,stepId:"review-implementation",outcome:"pass",summary:"reviewed"},"reviewer","skill-reviewer")).error).toBeUndefined()
      const bound=await h.durableStorage.scan({prefix:`evidence-step/${workflowId}/review-implementation/`}); const records=await Promise.all(bound.entries.map(async(entry:any)=>h.durableStorage.get(`evidence/${entry.value}`))); expect(records).toContainEqual(expect.objectContaining({tool:"loom_assessment",skill:"software-engineering",methodology:"assessment",workflowId,stepId:"review-implementation",status:"completed"}))
    } finally { h.restore() }
  })
  test("Critic QA loader is role-specific for standalone QA", async () => { const h=await harness(); try {
    const skillResult={metadata:{metadata:{directory:`${process.cwd()}/skills/software-engineering`}}}; const nativeSkill={tool:"skill",callID:"critic-skill-load",messageID:"critic-message",sessionID:"standalone-critic",agent:"critic",input:{name:"software-engineering"}}; await h.toolHooks.get("execute.before")!(nativeSkill); await h.toolHooks.get("execute.after")!({...nativeSkill,status:"completed",result:skillResult})
    const qa=await h.callObserved("qa",{skill:"software-engineering"},"critic","standalone-critic","qa-load"); expect(qa.available).toBe(true); expect(qa.content).toContain("## QA criteria"); expect((await h.call("assessment",{skill:"software-engineering"},"critic","standalone-critic")).error).toContain("reserved for reviewer")
  } finally { h.restore() } })
  test("rejected companions do not create successful methodology evidence", async () => { const h=await harness(); try {
    await h.callObserved("assessment",{skill:"software-engineering"},"critic","standalone-critic","assessment-rejected")
    const page=await h.durableStorage.scan({prefix:"evidence-session/standalone-critic/"}); const records=await Promise.all(page.entries.map(async(entry:any)=>h.durableStorage.get(`evidence/${entry.value}`)))
    expect(records.filter((record:any)=>record?.methodology==="assessment")).toHaveLength(0)
  } finally { h.restore() } })
  test("Diagnostic sandbox tools require current Diagnostic attempt provenance", async () => {
    const h = await harness()
    try {
      const unattached = await h.call(
        "diagnostic_sandbox_start",
        { image: "local/toolchain:test", network: "none" },
        "diagnostic",
        "sandbox-unattached",
      )
      expect(unattached.error).toContain("require attachment")

      const generalSession = "sandbox-provenance-general"
      const diagnosticSession = "sandbox-provenance-diagnostic"
      const started = await h.call(
        "start",
        { request: "Diagnose one bounded causal failure." },
        "general",
        generalSession,
      )
      const workflowId = String(started.workflowId)
      expect((await h.call(
        "route",
        {
          humanFacing: false,
          behavioral: false,
          structural: false,
          externalUnknown: false,
          diagnostic: true,
          productOutcome: false,
          implementationRequested: false,
          executionDepth: "task",
        },
        "general",
        generalSession,
      )).error).toBeUndefined()

      const grant = await h.call(
        "dispatch_grant",
        { workflowId, stepId: "diagnostic" },
        "general",
        generalSession,
      )
      expect((await h.call(
        "attach",
        { grantId: grant.grantId, workflowId, stepId: "diagnostic" },
        "diagnostic",
        diagnosticSession,
      )).attached).toBe(true)

      const staleId = "77777777-7777-4777-8777-777777777777"
      await h.durableStorage.set(
        `diagnostic-sandbox/${encodeURIComponent(diagnosticSession)}`,
        {
          schemaVersion: 1,
          id: staleId,
          sessionId: diagnosticSession,
          workflowId: "older-workflow",
          stepId: "diagnostic",
          attempt: 0,
          projectId: h.runtime.projectId,
          rootPath: "/not-used",
          workspacePath: "/not-used/workspace",
          baselineGitPath: "/not-used/baseline.git",
          image: "local/toolchain:test",
          engine: "docker",
          network: "none",
          createdAt: "2026-09-27T00:00:00.000Z",
          materialized: true,
          active: true,
        },
      )

      const staleExec = await h.call(
        "diagnostic_sandbox_exec",
        { sandboxId: staleId, command: "true" },
        "diagnostic",
        diagnosticSession,
      )
      expect(staleExec.error).toContain("older or different step attempt")

      const staleDiff = await h.call(
        "diagnostic_sandbox_diff",
        { sandboxId: staleId },
        "diagnostic",
        diagnosticSession,
      )
      expect(staleDiff.error).toContain("older or different step attempt")
    } finally {
      h.restore()
    }
  })


  test("inner Diagnostic sandbox tool errors are failed evidence", async () => {
    const h = await harness()
    try {
      const sessionID = "diagnostic-inner-error-evidence"
      const event = {
        tool: "loom_diagnostic_sandbox_diff",
        callID: "diagnostic-inner-error-call",
        messageID: "diagnostic-inner-error-message",
        sessionID,
        agent: "diagnostic",
        input: { sandboxId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb" },
      }
      await h.toolHooks.get("execute.before")!(event)
      await h.toolHooks.get("execute.after")!({
        ...event,
        status: "completed",
        result: JSON.stringify({ error: "sandbox baseline unreadable" }),
      })

      const evidence = await h.call(
        "evidence_observations",
        { detail: true },
        "diagnostic",
        sessionID,
      )
      expect(evidence.observations).toHaveLength(1)
      expect(evidence.observations[0]).toMatchObject({
        tool: "loom_diagnostic_sandbox_diff",
        status: "error",
        error: "sandbox baseline unreadable",
      })
    } finally {
      h.restore()
    }
  })

  test("Code Mode Diagnostic sandbox executions remain evidence-observed", async () => {
    const h = await harness()
    try {
      const sessionID = "code-mode-diagnostic-evidence"
      const sandboxId = "88888888-8888-4888-8888-888888888888"

      for (const [tool, callID] of [
        ["loom_code_diagnostic_sandbox_exec", "code-mode-diag-underscore"],
        ["loom.code.diagnostic_sandbox_exec", "code-mode-diag-dot"],
      ] as const) {
        const event = {
          tool,
          callID,
          messageID: "code-mode-diag-message",
          sessionID,
          agent: "diagnostic",
          input: {
            sandboxId,
            command: "printf causal-proof",
          },
        }
        await h.toolHooks.get("execute.before")!(event)
        await h.toolHooks.get("execute.after")!({
          ...event,
          status: "completed",
          result: JSON.stringify({
            sandboxId,
            ok: true,
            exitCode: 0,
            signal: null,
            timedOut: false,
            stdout: "causal-proof",
            stderr: "",
          }),
        })
      }

      const evidence = await h.call(
        "evidence_observations",
        { detail: true },
        "diagnostic",
        sessionID,
      )
      expect(evidence.observations).toHaveLength(2)
      for (const observation of evidence.observations) {
        expect(observation).toMatchObject({
          status: "completed",
          command: "printf causal-proof",
          diagnosticSandbox: {
            id: sandboxId,
            ok: true,
            exitCode: 0,
            signal: null,
            timedOut: false,
          },
        })
      }
      expect(evidence.observations.map((item: any) => item.tool).sort()).toEqual([
        "loom.code.diagnostic_sandbox_exec",
        "loom_code_diagnostic_sandbox_exec",
      ])
    } finally {
      h.restore()
    }
  })

  test("Diagnostic completion fails closed on stale workflow sandbox cleanup", async () => {
    const h = await harness()
    try {
      const generalSession = "sandbox-cleanup-general"
      const diagnosticSession = "sandbox-cleanup-current"
      const staleSession = "sandbox-cleanup-stale"
      const started = await h.call(
        "start",
        { request: "Diagnose one bounded causal failure." },
        "general",
        generalSession,
      )
      const workflowId = String(started.workflowId)
      expect((await h.call(
        "route",
        {
          humanFacing: false,
          behavioral: false,
          structural: false,
          externalUnknown: false,
          diagnostic: true,
          productOutcome: false,
          implementationRequested: false,
          executionDepth: "task",
        },
        "general",
        generalSession,
      )).error).toBeUndefined()

      const grant = await h.call(
        "dispatch_grant",
        { workflowId, stepId: "diagnostic" },
        "general",
        generalSession,
      )
      expect((await h.call(
        "attach",
        { grantId: grant.grantId, workflowId, stepId: "diagnostic" },
        "diagnostic",
        diagnosticSession,
      )).attached).toBe(true)

      await h.durableStorage.set(
        `diagnostic-sandbox/${encodeURIComponent(staleSession)}`,
        {
          schemaVersion: 1,
          id: "invalid-stale-sandbox-id",
          sessionId: staleSession,
          workflowId,
          stepId: "diagnostic",
          attempt: 0,
          projectId: h.runtime.projectId,
          rootPath: "/not-used",
          workspacePath: "/not-used/workspace",
          baselineGitPath: "/not-used/baseline.git",
          image: "local/toolchain:test",
          engine: "docker",
          network: "none",
          createdAt: "2026-09-27T00:00:00.000Z",
          materialized: true,
          active: true,
        },
      )

      const completion = await h.call(
        "complete",
        {
          workflowId,
          stepId: "diagnostic",
          summary: "Diagnosis is complete.",
        },
        "diagnostic",
        diagnosticSession,
      )
      expect(completion.error).toContain(
        "every active experiment sandbox for this workflow",
      )
      expect(
        (await h.durableStorage.get(`workflow/${workflowId}`) as any)
          .steps.find((step: any) => step.id === "diagnostic").status,
      ).not.toBe("complete")
    } finally {
      h.restore()
    }
  })


  test("Diagnostic completion recovers a preregistered sandbox after creation-process death", async () => {
    const h = await harness()
    try {
      const generalSession = "sandbox-crash-general"
      const diagnosticSession = "sandbox-crash-diagnostic"
      const started = await h.call(
        "start",
        { request: "Diagnose one bounded causal failure." },
        "general",
        generalSession,
      )
      const workflowId = String(started.workflowId)
      expect((await h.call(
        "route",
        {
          humanFacing: false,
          behavioral: false,
          structural: false,
          externalUnknown: false,
          diagnostic: true,
          productOutcome: false,
          implementationRequested: false,
          executionDepth: "task",
        },
        "general",
        generalSession,
      )).error).toBeUndefined()

      const grant = await h.call(
        "dispatch_grant",
        { workflowId, stepId: "diagnostic" },
        "general",
        generalSession,
      )
      expect((await h.call(
        "attach",
        { grantId: grant.grantId, workflowId, stepId: "diagnostic" },
        "diagnostic",
        diagnosticSession,
      )).attached).toBe(true)

      const sandboxId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
      const rootPath = join(
        h.runtime.runtimeRoot,
        "diagnostic-sandboxes",
        h.runtime.projectId,
        sandboxId,
      )
      const workspacePath = join(rootPath, "workspace")
      await mkdir(workspacePath, { recursive: true })
      await writeFile(join(workspacePath, "project-secret.txt"), "copied-before-crash\n")
      const key = `diagnostic-sandbox/${encodeURIComponent(diagnosticSession)}`
      await h.durableStorage.set(key, {
        schemaVersion: 1,
        id: sandboxId,
        sessionId: diagnosticSession,
        workflowId,
        stepId: "diagnostic",
        attempt: 0,
        projectId: h.runtime.projectId,
        rootPath,
        workspacePath,
        baselineGitPath: join(rootPath, "baseline.git"),
        image: "local/toolchain:test",
        engine: "docker",
        network: "none",
        createdAt: "2026-09-27T00:00:00.000Z",
        materialized: false,
        active: true,
      })

      const completion = await h.call(
        "complete",
        {
          workflowId,
          stepId: "diagnostic",
          summary: "Diagnosis is complete after recovering the interrupted sandbox.",
        },
        "diagnostic",
        diagnosticSession,
      )
      expect(completion.error).toBeUndefined()
      await expect(stat(rootPath)).rejects.toThrow()
      expect(await h.durableStorage.get(key)).toMatchObject({
        id: sandboxId,
        materialized: false,
        active: false,
      })
    } finally {
      h.restore()
    }
  })


  test("file-backed commit messages require current role-authored unchanged scratch bytes", async () => {
    const h = await harness(async (_storage, root) => {
      await initializeGitFixture(root)
      await mkdir(join(root, "docs", "requirements"), { recursive: true })
    })
    try {
      const generalSession = "commit-file-general"
      const childSession = "commit-file-specifier"
      const started = await h.call(
        "start",
        { request: "Specify one bounded behavior and commit the resulting requirement." },
        "general",
        generalSession,
      )
      const workflowId = String(started.workflowId)
      expect((await h.call(
        "route",
        {
          humanFacing: false,
          behavioral: true,
          structural: false,
          externalUnknown: false,
          diagnostic: false,
          productOutcome: false,
          implementationRequested: true,
          executionDepth: "change",
        },
        "general",
        generalSession,
      )).error).toBeUndefined()

      const grant = await h.call(
        "dispatch_grant",
        { workflowId, stepId: "specifier" },
        "general",
        generalSession,
      )
      expect((await h.call(
        "attach",
        { grantId: grant.grantId, workflowId, stepId: "specifier" },
        "specifier",
        childSession,
      )).attached).toBe(true)

      const productPath = "docs/requirements/runtime.md"
      const productBody = "# Runtime\n\nThe committed requirement is scoped.\n"
      const productPermission: any = {
        agent: "specifier",
        action: "edit",
        resources: [productPath],
        sessionID: childSession,
        effect: "ask",
      }
      await h.permissionHooks.get("evaluate")!(productPermission)
      expect(productPermission.effect).not.toBe("deny")

      const productWrite = {
        tool: "write",
        callID: "commit-file-product-write",
        messageID: "commit-file-product-write-message",
        sessionID: childSession,
        agent: "specifier",
        input: { filePath: productPath, content: productBody },
      }
      await h.toolHooks.get("execute.before")!(productWrite)
      await writeFile(join(h.root, productPath), productBody)
      await h.toolHooks.get("execute.after")!({
        ...productWrite,
        status: "completed",
        result: "written",
      })

      const stageCommand = `git add -- ${productPath}`
      const stagePermission: any = {
        agent: "specifier",
        action: "shell",
        resources: [stageCommand],
        sessionID: childSession,
        effect: "ask",
      }
      await h.permissionHooks.get("evaluate")!(stagePermission)
      expect(stagePermission.effect).toBe("allow")
      const stageEvent = {
        tool: "shell",
        callID: "commit-file-stage",
        messageID: "commit-file-stage-message",
        sessionID: childSession,
        agent: "specifier",
        input: { command: stageCommand },
      }
      await h.toolHooks.get("execute.before")!(stageEvent)
      await git(h.root, ["add", "--", productPath])
      await h.toolHooks.get("execute.after")!({
        ...stageEvent,
        status: "completed",
        result: "staged",
      })

      const scratchPath =
        "ephemeral-reports/specifier/commit-messages/runtime.md"
      const longMessage = [
        "docs(runtime): define scoped commit messages",
        "",
        "### Background",
        "Loom accepts long Markdown commit messages without shell redirection.",
        "",
        "### Verification",
        "The plugin boundary exercised the real file-backed Git commit path.",
        "",
      ].join("\n")

      await mkdir(join(h.root, "ephemeral-reports", "specifier", "commit-messages"), {
        recursive: true,
      })
      await writeFile(join(h.root, scratchPath), "foreign pre-existing message\n")

      const scratchPermission: any = {
        agent: "specifier",
        action: "edit",
        resources: [scratchPath],
        sessionID: childSession,
        effect: "ask",
      }
      await h.permissionHooks.get("evaluate")!(scratchPermission)
      expect(scratchPermission.effect).toBe("allow")
      await expect(
        h.toolHooks.get("execute.before")!({
          tool: "write",
          callID: "commit-file-preexisting-write",
          messageID: "commit-file-preexisting-write-message",
          sessionID: childSession,
          agent: "specifier",
          input: { filePath: scratchPath, content: longMessage },
        }),
      ).rejects.toThrow("already exists but was not authored")

      const commitCommand =
        `git -c core.hooksPath=/dev/null commit -F ${scratchPath}`
      const commitPermission: any = {
        agent: "specifier",
        action: "shell",
        resources: [commitCommand],
        sessionID: childSession,
        effect: "ask",
      }
      await h.permissionHooks.get("evaluate")!(commitPermission)
      expect(commitPermission.effect).toBe("allow")

      await expect(
        h.toolHooks.get("execute.before")!({
          tool: "shell",
          callID: "commit-file-unowned",
          messageID: "commit-file-unowned-message",
          sessionID: childSession,
          agent: "specifier",
          input: { command: commitCommand },
        }),
      ).rejects.toThrow("was not authored by this current role/session")

      await rm(join(h.root, scratchPath), { force: true })
      const hardlinkSource = join(h.root, "hardlink-source.md")
      await writeFile(hardlinkSource, "hardlink sentinel\n")
      await link(hardlinkSource, join(h.root, scratchPath))
      await expect(
        h.toolHooks.get("execute.before")!({
          tool: "write",
          callID: "commit-file-hardlink",
          messageID: "commit-file-hardlink-message",
          sessionID: childSession,
          agent: "specifier",
          input: { filePath: scratchPath, content: longMessage },
        }),
      ).rejects.toThrow("single-link regular file")
      expect(await readFile(hardlinkSource, "utf8")).toBe("hardlink sentinel\n")
      await rm(join(h.root, scratchPath), { force: true })
      await rm(hardlinkSource, { force: true })

      await symlink(join(h.root, productPath), join(h.root, scratchPath))
      await expect(
        h.toolHooks.get("execute.before")!({
          tool: "write",
          callID: "commit-file-symlink",
          messageID: "commit-file-symlink-message",
          sessionID: childSession,
          agent: "specifier",
          input: { filePath: scratchPath, content: longMessage },
        }),
      ).rejects.toThrow("regular file")
      await rm(join(h.root, scratchPath), { force: true })

      const writeScratch = async (callID: string, content: string) => {
        const event = {
          tool: "write",
          callID,
          messageID: `${callID}-message`,
          sessionID: childSession,
          agent: "specifier",
          input: { filePath: scratchPath, content },
        }
        await h.toolHooks.get("execute.before")!(event)
        await writeFile(join(h.root, scratchPath), content)
        await h.toolHooks.get("execute.after")!({
          ...event,
          status: "completed",
          result: "written",
        })
      }

      await writeScratch("commit-file-owned", longMessage)
      await writeFile(join(h.root, scratchPath), longMessage + "tampered\n")
      await expect(
        h.toolHooks.get("execute.before")!({
          tool: "shell",
          callID: "commit-file-changed",
          messageID: "commit-file-changed-message",
          sessionID: childSession,
          agent: "specifier",
          input: { command: commitCommand },
        }),
      ).rejects.toThrow("changed after this role/session last wrote it")

      await writeScratch("commit-file-restored", longMessage)
      const commitEvent = {
        tool: "shell",
        callID: "commit-file-success",
        messageID: "commit-file-success-message",
        sessionID: childSession,
        agent: "specifier",
        input: { command: commitCommand },
      }
      await h.toolHooks.get("execute.before")!(commitEvent)

      await expect(
        h.toolHooks.get("execute.before")!({
          tool: "write",
          callID: "commit-file-concurrent-rewrite",
          messageID: "commit-file-concurrent-rewrite-message",
          sessionID: childSession,
          agent: "specifier",
          input: { filePath: scratchPath, content: longMessage + "raced\n" },
        }),
      ).rejects.toThrow("locked for write by another agent")

      await git(h.root, [
        "-c",
        "core.hooksPath=/dev/null",
        "commit",
        "-F",
        scratchPath,
        "-q",
      ])
      await h.toolHooks.get("execute.after")!({
        ...commitEvent,
        status: "completed",
        result: "committed",
      })

      const committed = await git(h.root, ["log", "-1", "--pretty=%B"])
      expect(committed.stdout.trim()).toBe(longMessage.trim())
      await expect(stat(join(h.root, scratchPath))).rejects.toThrow()

      await expect(
        h.toolHooks.get("execute.before")!({
          tool: "shell",
          callID: "commit-file-reuse",
          messageID: "commit-file-reuse-message",
          sessionID: childSession,
          agent: "specifier",
          input: { command: commitCommand },
        }),
      ).rejects.toThrow("must exist as a single-link regular file")
    } finally {
      h.restore()
    }
  })

})
