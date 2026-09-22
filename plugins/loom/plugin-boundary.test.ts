import { afterEach, describe, expect, test } from "bun:test"
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"
import loomPlugin from "./index"
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

  return { root, storage, projectID, registered, namespaces, sessionHooks, permissionHooks, toolHooks, durableStorage, call, callObserved, restore }
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
    const { sessionHooks, restore } = await harness()
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
        write: ["src/**"],
      })

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
        }
        await evaluate!(safeShell)
        expect(safeShell.effect).not.toBe("deny")
      }

      for (const agent of ["research", "diagnostic"] as const) {
        const mutatingShell: any = {
          agent,
          action: "shell",
          resources: ["rm -f src/app.ts"],
          sessionID: `conversation-${agent}`,
        }
        await evaluate!(mutatingShell)
        expect(mutatingShell.effect).toBe("deny")
        expect(mutatingShell.message).toContain("read-only")

        const productEdit: any = {
          agent,
          action: "edit",
          resources: ["src/app.ts"],
          sessionID: `conversation-${agent}`,
        }
        await evaluate!(productEdit)
        expect(productEdit.effect).toBe("deny")
        expect(productEdit.message).toContain("product/repository edits require governed execution")

        const ownReportEdit: any = {
          agent,
          action: "edit",
          resources: [`ephemeral-reports/${agent}/finding.md`],
          sessionID: `conversation-${agent}`,
        }
        await evaluate!(ownReportEdit)
        expect(ownReportEdit.effect).not.toBe("deny")

        const otherReportEdit: any = {
          agent,
          action: "edit",
          resources: [
            `ephemeral-reports/${agent === "research" ? "diagnostic" : "research"}/finding.md`,
          ],
          sessionID: `conversation-${agent}`,
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
