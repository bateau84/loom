import { describe, expect, test } from "bun:test"
import { mkdir, mkdtemp, rm } from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"
import loomPlugin from "./index"
import {
  DEFAULT_LIMITS,
  newBudgetState,
  recordDispatch,
  type BudgetState,
} from "./budget"
import {
  createProjectStorage,
  createTransactionalStorage,
  resolveRuntimeIdentity,
} from "./runtime"
import type { Workflow } from "./workflow"

type RegisteredTool = {
  name: string
  options?: { namespace?: string; codemode?: boolean; permission?: string }
  execute: (input: unknown, tool: { agent: string; sessionID: string }) => Promise<any>
}

describe("Loom budget recovery plugin integration", () => {
  test("grant persists and permits exactly one additional Critic dispatch", async () => {
    const root = await mkdtemp(join(tmpdir(), "loom-budget-integration-"))
    const project = join(root, "project")
    const previousState = process.env.XDG_STATE_HOME
    const previousRuntime = process.env.XDG_RUNTIME_DIR
    process.env.XDG_STATE_HOME = join(root, "state")
    process.env.XDG_RUNTIME_DIR = join(root, "runtime")
    await mkdir(project, { recursive: true })

    try {
      const legacyValues = new Map<string, unknown>()
      const registeredTools = new Map<string, RegisteredTool>()
      let evaluatePermission:
        | ((event: {
            agent: string
            action: string
            resources: string[]
            sessionID: string
            source?: { messageID?: string; id?: string }
            effect?: string
            message?: string
          }) => Promise<void>)
        | undefined

      const opencodeProjectId = "opencode-budget-project"
      const ctx: any = {
        location: {
          directory: project,
          project: {
            canonical: project,
            id: opencodeProjectId,
          },
        },
        storage: {
          get: async (key: string) => legacyValues.get(key),
          set: async (key: string, value: unknown) => {
            legacyValues.set(key, structuredClone(value))
          },
          scan: async ({ prefix }: { prefix: string }) => ({
            entries: [...legacyValues.entries()]
              .filter(([key]) => key.startsWith(prefix))
              .map(([key, value]) => ({ key, value })),
            next: undefined,
          }),
        },
        rpc: {
          register: async () => {},
        },
        agent: {
          transform: async (apply: (editor: { get: (name: string) => unknown; default: (name: string) => void }) => void) => {
            await apply({
              get: () => undefined,
              default: () => {},
            })
          },
        },
        tool: {
          transform: async (
            apply: (editor: {
              namespace: (input: unknown) => void
              list: () => Array<RegisteredTool & { id: string }>
              add: (tool: RegisteredTool) => void
            }) => void,
          ) => {
            await apply({
              namespace: () => {},
              list: () =>
                [...registeredTools.entries()].map(([key, tool]) => ({
                  ...tool,
                  id: tool.options?.namespace
                    ? `${tool.options.namespace.replaceAll(".", "_")}_${tool.name}`
                    : key,
                })),
              add: (tool) => {
                const key = tool.options?.namespace === "loom.code"
                  ? `loom_code_${tool.name}`
                  : tool.name
                registeredTools.set(key, tool)
              },
            })
          },
          hook: async () => {},
        },
        permission: {
          hook: async (name: string, hook: typeof evaluatePermission) => {
            if (name === "evaluate") evaluatePermission = hook
          },
        },
        session: {
          get: async ({ sessionID }: { sessionID: string }) => ({
            id: sessionID,
            projectID: opencodeProjectId,
          }),
          hook: async () => {},
        },
      }

      await (loomPlugin as any).setup(ctx)

      const runtime = await resolveRuntimeIdentity(project, ctx.storage)
      const storage = createProjectStorage(
        await createTransactionalStorage(runtime),
        runtime.projectId,
      )

      const workflowId = "wf-budget-integration"
      const sessionID = "general-session"
      const stepId = "critic-solution"
      const budgetKey = `budget/${workflowId}`
      const dispatchKey = `step:${stepId}`

      const workflow: Workflow = {
        id: workflowId,
        projectId: runtime.projectId,
        revision: 0,
        anchor: "docs/anchors/test/anchor.md",
        createdBySession: sessionID,
        createdAt: "now",
        steps: [
          {
            id: stepId,
            agent: "critic",
            kind: "gate",
            dependsOn: [],
            status: "pending",
          },
        ],
      }

      const budget = newBudgetState()
      for (const dispatchID of ["critic-1", "critic-2"]) {
        expect(
          recordDispatch({
            state: budget,
            limits: DEFAULT_LIMITS,
            dispatchID,
            key: dispatchKey,
            agent: "critic",
          }).allowed,
        ).toBe(true)
      }

      await storage.set(`workflow/${workflowId}`, workflow)
      await storage.set(`session/${sessionID}`, workflowId)
      await storage.set(`session-step/${sessionID}`, "")
      await storage.set(`session-oq/${sessionID}`, "")
      await storage.set(`limits/${workflowId}`, DEFAULT_LIMITS)
      await storage.set(budgetKey, budget)

      const grantTool = registeredTools.get("budget_grant")
      const continuationTool = registeredTools.get("budget_continue")
      const dispatchGrantTool = registeredTools.get("dispatch_grant")
      expect(grantTool).toBeDefined()
      expect(continuationTool).toBeDefined()
      expect(dispatchGrantTool).toBeDefined()
      expect(evaluatePermission).toBeDefined()

      const grantResult = await grantTool!.execute(
        {
          workflowId,
          stepId,
          reason: "The corrected architecture is new material evidence for another Critic pass.",
          evidence: ["docs/architecture/example.md#corrected-dependency-registration"],
          progress: {
            newEvidence: true,
            changedHypothesis: false,
            changedStrategy: false,
            reducedUnresolved: true,
          },
        },
        { agent: "general", sessionID },
      )
      expect(grantResult.content).not.toContain('"error"')

      const persistedAfterGrant = await storage.get(budgetKey) as BudgetState
      expect(persistedAfterGrant.grants).toHaveLength(1)
      expect(persistedAfterGrant.byKey[dispatchKey]).toBe(2)

      const dispatchGrant = await dispatchGrantTool!.execute(
        { workflowId, stepId },
        { agent: "general", sessionID },
      )
      expect(dispatchGrant.content).toContain("Expected Agent:** critic")

      const allowedEvent = {
        agent: "general",
        action: "subagent",
        resources: ["critic"],
        sessionID,
        source: { messageID: "message-3", id: "dispatch-3" },
        effect: "allow",
      }
      await evaluatePermission!(allowedEvent)
      expect(allowedEvent.effect).not.toBe("deny")

      const persistedAfterDispatch = await storage.get(budgetKey) as BudgetState
      expect(persistedAfterDispatch.byKey[dispatchKey]).toBe(3)

      const deniedEvent = {
        agent: "general",
        action: "subagent",
        resources: ["critic"],
        sessionID,
        source: { messageID: "message-4", id: "dispatch-4" },
        effect: "allow",
        message: "",
      }
      await evaluatePermission!(deniedEvent)
      expect(deniedEvent.effect).toBe("deny")
      expect(deniedEvent.message).toContain("dispatch limit 3 reached")

      const continuationResult = await continuationTool!.execute(
        {
          workflowId,
          stepId,
          reason: "The user explicitly wants the unfinished governed work to continue.",
          confirmation: "keep going and give it two more attempts",
          additionalDispatches: 2,
        },
        { agent: "general", sessionID },
      )
      expect(continuationResult.content).not.toContain('"error"')

      const persistedAfterContinuation = await storage.get(budgetKey) as BudgetState
      expect(persistedAfterContinuation.continuations).toHaveLength(1)
      expect(persistedAfterContinuation.byKey[dispatchKey]).toBe(3)
      expect(
        recordDispatch({
          state: persistedAfterContinuation,
          limits: DEFAULT_LIMITS,
          dispatchID: "critic-4-after-user-continuation",
          key: dispatchKey,
          agent: "critic",
        }).allowed,
      ).toBe(true)
      expect(
        recordDispatch({
          state: persistedAfterContinuation,
          limits: DEFAULT_LIMITS,
          dispatchID: "critic-5-after-user-continuation",
          key: dispatchKey,
          agent: "critic",
        }).allowed,
      ).toBe(true)
      expect(
        recordDispatch({
          state: persistedAfterContinuation,
          limits: DEFAULT_LIMITS,
          dispatchID: "critic-6-after-user-continuation",
          key: dispatchKey,
          agent: "critic",
        }).allowed,
      ).toBe(false)
    } finally {
      if (previousState === undefined) delete process.env.XDG_STATE_HOME
      else process.env.XDG_STATE_HOME = previousState
      if (previousRuntime === undefined) delete process.env.XDG_RUNTIME_DIR
      else process.env.XDG_RUNTIME_DIR = previousRuntime
      await rm(root, { recursive: true, force: true })
    }
  })
})
