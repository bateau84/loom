import { describe, expect, test } from "bun:test"
import loomPlugin from "./index"
import {
  DEFAULT_LIMITS,
  newBudgetState,
  recordDispatch,
  type BudgetState,
} from "./budget"
import type { Workflow } from "./workflow"

type RegisteredTool = {
  name: string
  execute: (input: unknown, tool: { agent: string; sessionID: string }) => Promise<unknown>
}

describe("Loom budget recovery plugin integration", () => {
  test("grant persists and permits exactly one additional Critic dispatch", async () => {
    const values = new Map<string, unknown>()
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

    const ctx = {
      location: { directory: "/tmp/loom-budget-integration" },
      storage: {
        get: async (key: string) => values.get(key),
        set: async (key: string, value: unknown) => {
          values.set(key, value)
        },
        scan: async () => ({ entries: [], next: undefined }),
      },
      rpc: {
        register: async () => {},
      },
      agent: {
        transform: async (apply: (editor: { get: (name: string) => unknown; default: (name: string) => void }) => void) => {
          apply({
            get: () => undefined,
            default: () => {},
          })
        },
      },
      tool: {
        transform: async (
          apply: (editor: {
            namespace: (input: unknown) => void
            add: (tool: RegisteredTool) => void
          }) => void,
        ) => {
          apply({
            namespace: () => {},
            add: (tool) => registeredTools.set(tool.name, tool),
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
        hook: async () => {},
      },
    }

    await (loomPlugin as any).setup(ctx)

    const workflowId = "wf-budget-integration"
    const sessionID = "general-session"
    const stepId = "critic-solution"
    const budgetKey = `budget/${workflowId}`
    const dispatchKey = `step:${stepId}`

    const workflow: Workflow = {
      id: workflowId,
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

    values.set(`workflow/${workflowId}`, workflow)
    values.set(`session/${sessionID}`, workflowId)
    values.set(`limits/${workflowId}`, DEFAULT_LIMITS)
    values.set(budgetKey, budget)

    const grantTool = registeredTools.get("budget_grant")
    expect(grantTool).toBeDefined()
    expect(evaluatePermission).toBeDefined()

    await grantTool!.execute(
      {
        workflowId,
        stepId,
        reason: "The corrected architecture is new material evidence for another Critic pass.",
        progress: {
          newEvidence: true,
          changedHypothesis: false,
          changedStrategy: false,
          reducedUnresolved: true,
        },
      },
      { agent: "general", sessionID },
    )

    const persistedAfterGrant = values.get(budgetKey) as BudgetState
    expect(persistedAfterGrant.grants).toHaveLength(1)
    expect(persistedAfterGrant.byKey[dispatchKey]).toBe(2)

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

    const persistedAfterDispatch = values.get(budgetKey) as BudgetState
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
  })
})
