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
  execute: (input: unknown, tool: { agent: string; sessionID: string; messageID?: string }) => Promise<any>
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
      let contextHook: ((event: any) => Promise<void> | void) | undefined
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
          hook: async (name: string, hook: (event: any) => Promise<void> | void) => {
            if (name === "context") contextHook = hook
          },
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
      const budgetStatusTool = registeredTools.get("budget_status")
      const dispatchGrantTool = registeredTools.get("dispatch_grant")
      const attachTool = registeredTools.get("attach")
      expect(grantTool).toBeDefined()
      expect(continuationTool).toBeDefined()
      expect(budgetStatusTool).toBeDefined()
      expect(dispatchGrantTool).toBeDefined()
      expect(attachTool).toBeDefined()
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

      expect(contextHook).toBeDefined()
      await contextHook!({
        sessionID,
        system: [],
        messages: [{
          id: "user-budget-continuation-1",
          role: "user",
          content: [{ type: "text", text: "keep going with the existing Critic" }],
        }],
      })

      const mismatchedConfirmation = await continuationTool!.execute(
        {
          workflowId,
          stepId,
          reason: "The user explicitly wants the unfinished governed work to continue.",
          confirmation: "give it ten more attempts",
        },
        { agent: "general", sessionID, messageID: "assistant-budget-mismatch" },
      )
      expect(mismatchedConfirmation.content).toContain("match the latest observed user message")

      const continuationResult = await continuationTool!.execute(
        {
          workflowId,
          stepId,
          reason: "The user explicitly wants the unfinished governed work to continue.",
          confirmation: "keep going with the existing Critic",
        },
        { agent: "general", sessionID, messageID: "assistant-budget-continuation" },
      )
      expect(continuationResult.content).not.toContain('"error"')

      const persistedAfterContinuation = await storage.get(budgetKey) as BudgetState
      expect(persistedAfterContinuation.continuations).toHaveLength(1)
      expect(persistedAfterContinuation.byKey[dispatchKey]).toBe(3)

      const continuedStatus = await budgetStatusTool!.execute(
        { workflowId },
        { agent: "general", sessionID },
      )
      expect(continuedStatus.content).toContain("**Max Total Dispatches:** 41")

      const resumedGrant = await dispatchGrantTool!.execute(
        { workflowId, stepId },
        { agent: "general", sessionID },
      )
      expect(resumedGrant.content).not.toContain("## Error")
      const grantMatch = resumedGrant.content.match(/\*\*Grant ID:\*\*\s+`([^`]+)`/)
      expect(grantMatch).not.toBeNull()

      const resumedEvent = {
        agent: "general",
        action: "subagent",
        resources: ["critic"],
        sessionID,
        source: { messageID: "message-5", id: "dispatch-5" },
        effect: "allow",
        message: "",
      }
      await evaluatePermission!(resumedEvent)
      expect(resumedEvent.effect).not.toBe("deny")

      const attached = await attachTool!.execute(
        { workflowId, stepId, grantId: grantMatch![1] },
        { agent: "critic", sessionID: "critic-resumed-session" },
      )
      expect(attached.content).not.toContain("## Error")

      const persistedAfterResume = await storage.get(budgetKey) as BudgetState
      expect(persistedAfterResume.byKey[dispatchKey]).toBe(4)
      expect(persistedAfterResume.continuations?.[0]?.usedDispatches).toBe(1)
      expect(persistedAfterResume.continuations?.[0]?.authorizationUserMessageId).toBe(
        "user-budget-continuation-1",
      )

      const reusedUserTurn = await continuationTool!.execute(
        {
          workflowId,
          stepId,
          reason: "The same user turn must not mint another exceptional retry.",
          confirmation: "keep going with the existing Critic",
        },
        { agent: "general", sessionID, messageID: "assistant-budget-reuse" },
      )
      expect(reusedUserTurn.content).toContain("already authorized")
    } finally {
      if (previousState === undefined) delete process.env.XDG_STATE_HOME
      else process.env.XDG_STATE_HOME = previousState
      if (previousRuntime === undefined) delete process.env.XDG_RUNTIME_DIR
      else process.env.XDG_RUNTIME_DIR = previousRuntime
      await rm(root, { recursive: true, force: true })
    }
  })
})
