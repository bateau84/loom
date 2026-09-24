import { afterEach, describe, expect, test } from "bun:test"
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
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
        expect(event.effect).toBeUndefined()
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

async function waveLifecycleFixture(workLevel: "wave" | "objective" = "wave") {
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
    const task = { id: "one", title: "One", objective: "Build one", dependsOn: [] }
    expect((await h.call("work_plan", {
      workflowId, phases: [{ id: "core", title: "Core", waves: [{ id: "first", title: "First", tasks: [task] }] }],
    }, "planner", planner)).error).toBeUndefined()
    expect((await h.call("task_plan", {
      workflowId, tasks: [{ ...task, write: ["src/**"], skills: [], verify: ["bun test"] }],
    }, "planner", planner)).error).toBeUndefined()
    expect((await h.call("complete", { workflowId, stepId: "plan", summary: "Planned" }, "planner", planner)).error).toBeUndefined()
    const workflow = () => h.durableStorage.get(`workflow/${workflowId}`) as Promise<any>
    const workKey = `work/${encodeURIComponent((await workflow()).work.objectiveId)}`
    const work = () => h.durableStorage.get(workKey) as Promise<any>
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
    const task = { id: "first-task", title: "First task", objective: "Build the first Wave", dependsOn: [] as string[] }
    const second = { id: "second-task", title: "Second task", objective: "Build the second Wave", dependsOn: ["first-task"] }

    expect((await h.call("work_plan", {
      workflowId,
      phases: [{
        id: "delivery",
        title: "Delivery",
        waves: [
          { id: "first", title: "First", tasks: [task] },
          { id: "second", title: "Second", tasks: [second] },
        ],
      }],
    }, "planner", planner)).error).toBeUndefined()

    const before = await h.durableStorage.get(`workflow/${workflowId}`) as any
    const planAttempt = before.steps.find((step: any) => step.id === "plan").attempt ?? 0

    const result = await h.call("task_plan", {
      workflowId,
      tasks: [{
        ...task,
        write: ["src/first/**"],
        skills: [],
        verify: ["bun test"],
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
    const task = { id: "only-task", title: "Only task", objective: "Build the product", dependsOn: [] as string[] }

    expect((await h.call("work_plan", {
      workflowId,
      phases: [{
        id: "delivery",
        title: "Delivery",
        waves: [{ id: "only", title: "Only", tasks: [task] }],
      }],
    }, "planner", planner)).error).toBeUndefined()

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
        verify: ["bun test"],
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
      const replacementPlan = await h.call("work_plan", {
        workflowId: next.workflowId, expectedVersion: (await h.work()).version,
        replaceReason: "User requested replacing the failed plan",
        phases: [{ id: "core", title: "Core", waves: [{ id: "next", title: "Next", tasks: [
          { id: "two", title: "Two", objective: "Replacement work", dependsOn: [] },
        ] }] }],
      }, "planner", planner)
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
    const a = { id: "a", title: "A", objective: "Build A", dependsOn: [] as string[] }
    const b = { id: "b", title: "B", objective: "Build B", dependsOn: ["a"] }
    const c = { id: "c", title: "C", objective: "Consume A's reviewed Wave", dependsOn: ["a"] }
    const spec = (task: typeof a, dependsOn = task.dependsOn) => ({ ...task, dependsOn, write: [`src/${task.id}.ts`], skills: [], verify: ["bun test"] })
    const work = createWorkHierarchy("docs/anchors/partial/anchor.md", "original", now)
    materializeWorkPlan(work, "original", [{ id: "core", title: "Core", waves: [
      { id: "first", title: "First", tasks: [a, b] }, { id: "consumer", title: "Consumer", tasks: [c] },
    ] }], now)
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
    const a = { id: "a", title: "A", objective: "Build A", dependsOn: [] as string[] }
    const b = { id: "b", title: "B", objective: "Build B", dependsOn: ["a"] }
    const c = { id: "c", title: "C", objective: "Consume A", dependsOn: ["a"] }
    const d = { id: "d", title: "D", objective: "Consume C", dependsOn: ["c"] }
    const u = { id: "u", title: "U", objective: "Unrelated work", dependsOn: [] as string[] }
    const spec = (task: typeof a, dependsOn = task.dependsOn) => ({ ...task, dependsOn, write: [`src/${task.id}.ts`], skills: [], verify: ["bun test"] })
    const work = createWorkHierarchy("docs/anchors/partial/anchor.md", "original", now)
    materializeWorkPlan(work, "original", [{ id: "core", title: "Core", waves: [
      { id: "first", title: "First", tasks: [a, b] }, { id: "second", title: "Second", tasks: [c] },
      { id: "third", title: "Third", tasks: [d] }, { id: "unrelated", title: "Unrelated", tasks: [u] },
    ] }], now)
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
