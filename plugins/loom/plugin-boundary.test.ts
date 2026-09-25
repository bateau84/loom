import { afterEach, describe, expect, test } from "bun:test"
import { execFile } from "node:child_process"
import { promisify } from "node:util"
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"
import loomPlugin from "./index"
import { cancelWorkflow } from "./lifecycle"
import { createWorkHierarchy, materializeWorkPlan, claimWorkflowWave, syncWorkTaskStatuses,
  completeWaveForTasks, releaseCancelledWorkflowClaims, reopenWaveForTasks } from "./work"
import { buildSidebarSnapshot } from "./sidebar"
import { prepareReportPromotion, publishPreparedReport, type ReportPromotionRecord } from "./reports"
import {
  createProjectStorage,
  createTransactionalStorage,
  resolveRuntimeIdentity,
} from "./runtime"

const roots: string[] = []

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
  options?: { namespace?: string; codemode?: boolean; permission?: string }
  execute: (input: unknown, tool: { agent: string; sessionID: string }) => Promise<{ content: string }>
}

async function harness(
  seed?: (storage: MemoryStorage, root: string, projectID: string) => void | Promise<void>,
  sessionInfo?: (sessionID: string, projectID: string) => { id: string; projectID?: string },
  existing?: { root: string; storage: MemoryStorage },
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
      transform: async (fn: (editor: any) => unknown) =>
        fn({ get: () => undefined, default: () => {} }),
    },
    tool: {
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

  return { root, storage, runtime, projectID, registered, namespaces, sessionHooks, permissionHooks, toolHooks, durableStorage, call, callObserved, restore }
}

afterEach(async () => {
  while (roots.length) await rm(roots.pop()!, { recursive: true, force: true })
})

describe("Loom registered plugin boundary", () => {
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
        runtimeVersion: 4,
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
        scopeSemantics: "mutation-boundary-only",
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
        scopeSemantics: "mutation-boundary-only",
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
      expect(completed.runnable).toEqual([{ id: "review-implementation", agent: "reviewer" }])

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


  test("Worker dispatch grant requires declared task scope", async () => {
    const h = await harness()
    try {
      const started = await h.call(
        "start",
        { request: "Apply one bounded implementation change." },
        "general",
        "scope-before-grant-general",
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
        "scope-before-grant-general",
      )
      expect(routed.error).toBeUndefined()

      const unscoped = await h.call(
        "dispatch_grant",
        { workflowId, stepId: "worker" },
        "general",
        "scope-before-grant-general",
      )
      expect(unscoped.error).toContain("no declared write scope")

      const scope = await h.call(
        "task_scope",
        { workflowId, stepId: "worker", write: ["src/**"] },
        "general",
        "scope-before-grant-general",
      )
      expect(scope.error).toBeUndefined()
      expect(scope.acceptedOutcome).toBe("Apply one bounded implementation change.")
      expect(scope.acceptedAuthority).toMatch(/^task:/)
      expect(scope.scopeSemantics).toBe("mutation-boundary-only")

      const scoped = await h.call(
        "dispatch_grant",
        { workflowId, stepId: "worker" },
        "general",
        "scope-before-grant-general",
      )
      expect(scoped.error).toBeUndefined()
      expect(scoped.expectedAgent).toBe("worker")
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
      expect(generalUnknownAdd.message).toContain("stage only files authored")

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
      expect(delayedStage.message).toContain("stage only files authored")

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
      expect(foreignStage.message).toContain("changed after this task")

      await git(h.root, ["add", "src/owned.ts"])
      await git(h.root, [
        "-c",
        "core.hooksPath=/dev/null",
        "commit",
        "-m",
        "test: foreign overlapping write",
        "-q",
      ])
      const changedAfterCommit = await h.call(
        "complete",
        { workflowId, stepId: "worker", summary: "implementation complete" },
        "worker",
        "git-ownership-worker",
      )
      expect(changedAfterCommit.error).toContain(
        "changed after this role's last admitted mutation",
      )
      expect(changedAfterCommit.error).toContain("src/owned.ts")

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
      expect(foreignModeStage.message).toContain("changed after this task")

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
      ).rejects.toThrow("changed after this role/task's last admitted mutation")
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
        "src/shared.ts is locked for write by another agent. Try again later.",
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
      expect(completed.runnable).toEqual([])

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
      expect(completed.runnable).toContainEqual({ id: "review-task", agent: "reviewer" })

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

function richPlanTask(id: string, title: string, objective: string, dependsOn: string[] = []) {
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
    const task = richPlanTask("one", "One", "Build one")
    const future = richPlanTask("two", "Two", "Build two", ["one"])
    expect((await h.call("work_plan", richWorkPlanInput(workflowId, [
      {
        id: "core",
        title: "Core",
        waves: [
          { id: "first", title: "First", tasks: [task] },
          ...(includeFutureWave ? [{ id: "second", title: "Second", tasks: [future] }] : []),
        ],
      },
    ]), "planner", planner)).error).toBeUndefined()
    expect((await h.call("task_plan", {
      workflowId, tasks: [{ ...task, write: ["src/**"], skills: [] }],
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
  const h = await waveLifecycleFixture()
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
    const semanticTask = current.plans.at(-1).phases[0].waves[0].tasks[0]
    expect((await h.call("task_plan", {
      workflowId: h.workflowId,
      tasks: [{ ...semanticTask, write: ["src/**"], skills: [] }],
    }, "planner", planner)).error).toBeUndefined()
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
      expect(status.runnable).toEqual([])
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
    completeWaveForTasks(work, "replacement", 1, ["b"], now)
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
    completeWaveForTasks(work, "replacement", 1, ["b"], now)
    claimWorkflowWave(work, "unrelated", 1, [spec(u)], false, now)
    const unrelatedControl = structuredClone(work)
    expect(() => reopenWaveForTasks(unrelatedControl, "replacement", 1, ["b"], now)).not.toThrow()
    expect(unrelatedControl.nodes.find(node => node.logicalId === "u")?.claimedByWorkflowId).toBe("unrelated")
    claimWorkflowWave(work, "consumer", 1, [spec(c, [])], false, now)
    syncWorkTaskStatuses(work, "consumer", 1, [{ taskId: "c", complete: true }], now)
    completeWaveForTasks(work, "consumer", 1, ["c"], now)
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
})
