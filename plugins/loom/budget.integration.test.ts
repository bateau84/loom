import { describe, expect, test } from "bun:test"
import { mkdir, mkdtemp, rm } from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"
import loomPlugin, { budgetContinuationQuestionInput } from "./index"
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
      let executeBefore: ((event: any) => Promise<void> | void) | undefined
      let executeAfter: ((event: any) => Promise<void> | void) | undefined
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
          hook: async (name: string, hook: (event: any) => Promise<void> | void) => {
            if (name === "execute.before") executeBefore = hook
            if (name === "execute.after") executeAfter = hook
          },
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
      const reviewerStepId = "reviewer-solution"
      const budgetKey = `budget/${workflowId}`
      const dispatchKey = `step:${stepId}`
      const reviewerDispatchKey = `step:${reviewerStepId}`
      const blockedTargetKey = (targetStepId: string) =>
        `budget-continuation-blocked/${encodeURIComponent(sessionID)}/${encodeURIComponent(workflowId)}/step/${encodeURIComponent(targetStepId)}`
      const BUDGET_ALLOW_FOR_TEST = "Allow +1 dispatch"

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
          {
            id: reviewerStepId,
            agent: "reviewer",
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
      for (const dispatchID of ["reviewer-1", "reviewer-2", "reviewer-3"]) {
        expect(
          recordDispatch({
            state: budget,
            limits: DEFAULT_LIMITS,
            dispatchID,
            key: reviewerDispatchKey,
            agent: "reviewer",
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
      expect(executeBefore).toBeDefined()
      expect(executeAfter).toBeDefined()

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

      const deniedDispatchGrant = await dispatchGrantTool!.execute(
        { workflowId, stepId },
        { agent: "general", sessionID },
      )
      expect(deniedDispatchGrant.content).not.toContain("## Error")
      const deniedGrantMatch = deniedDispatchGrant.content.match(/\*\*Grant ID:\*\*\s+`([^`]+)`/)
      expect(deniedGrantMatch).not.toBeNull()

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
      expect((await storage.get(`dispatch-grant/${deniedGrantMatch![1]}`) as any).admittedAt).toBeDefined()

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
      expect(await storage.get(
        `budget-continuation-user-message/${encodeURIComponent(sessionID)}/${encodeURIComponent("user-budget-continuation-1")}`,
      )).toMatchObject({
        workflowId,
        userMessageId: "user-budget-continuation-1",
      })
      expect((await storage.get(blockedTargetKey(stepId)) as any)?.resolvedAt).toBeDefined()

      let staleMessageDenialQuestionError = ""
      try {
        await executeBefore!({
          tool: "question",
          sessionID,
          agent: "general",
          callID: "budget-question-after-message-continuation",
          input: budgetContinuationQuestionInput({ agent: "critic", stepId }),
        })
      } catch (error) {
        staleMessageDenialQuestionError = error instanceof Error ? error.message : String(error)
      }
      expect(staleMessageDenialQuestionError).toContain(
        "reserved for the exact current Loom budget approval question",
      )

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

      const questionDeniedGrant = await dispatchGrantTool!.execute(
        { workflowId, stepId },
        { agent: "general", sessionID },
      )
      expect(questionDeniedGrant.content).not.toContain("## Error")

      const questionDeniedEvent = {
        agent: "general",
        action: "subagent",
        resources: ["critic"],
        sessionID,
        source: { messageID: "message-6", id: "dispatch-6" },
        effect: "allow",
        message: "",
      }
      await evaluatePermission!(questionDeniedEvent)
      expect(questionDeniedEvent.effect).toBe("deny")
      expect(questionDeniedEvent.message).toContain("Allow +1 dispatch")

      const blockedAfterDenial = await storage.get(blockedTargetKey(stepId)) as {
        denialId: string
        approvalRef: string
      }
      const approvalQuestion = budgetContinuationQuestionInput({
        agent: "critic",
        stepId,
        approvalRef: blockedAfterDenial.approvalRef,
      })
      const nearMatchQuestion = structuredClone(approvalQuestion)
      nearMatchQuestion.questions[0].question = "Can Loom have one more dispatch?"

      let arbitraryQuestionError = ""
      try {
        await executeBefore!({
          tool: "question",
          sessionID,
          agent: "general",
          callID: "budget-question-near-match",
          input: nearMatchQuestion,
        })
      } catch (error) {
        arbitraryQuestionError = error instanceof Error ? error.message : String(error)
      }
      expect(arbitraryQuestionError).toContain("reserved for the exact current Loom budget approval question")

      const unscopedQuestion = await continuationTool!.execute(
        { workflowId, stepId, reason: "A lookalike question must not authorize continuation." },
        { agent: "general", sessionID, messageID: "assistant-budget-question-near-match" },
      )
      expect(unscopedQuestion.content).toContain("No user decision exists for the current budget denial")

      const canonical = approvalQuestion.questions[0]
      const reorderedQuestion = {
        questions: [{
          options: canonical.options,
          multiple: canonical.multiple,
          question: canonical.question,
          custom: true,
          header: canonical.header,
        }],
      }

      const crashResidue = await storage.get(blockedTargetKey(stepId)) as Record<string, unknown>
      await storage.set(blockedTargetKey(stepId), {
        ...crashResidue,
        questionStartedAt: "2026-09-24T18:00:00.000Z",
        questionOwnerInstanceId: "dead-runtime-instance",
      })
      await executeBefore!({
        tool: "question",
        sessionID,
        agent: "general",
        callID: "budget-question-restart-reclaim",
        input: reorderedQuestion,
      })
      const reclaimed = await storage.get(blockedTargetKey(stepId)) as {
        denialId: string
        questionOwnerInstanceId?: string
      }
      expect(reclaimed.denialId).toBe(blockedAfterDenial.denialId)
      expect(reclaimed.questionOwnerInstanceId).toBeTruthy()
      expect(reclaimed.questionOwnerInstanceId).not.toBe("dead-runtime-instance")
      await executeAfter!({
        tool: "question",
        sessionID,
        agent: "general",
        callID: "budget-question-restart-reclaim",
        input: reorderedQuestion,
        status: "completed",
        result: { metadata: { answers: [[]] } },
      })
      expect(await storage.get(blockedTargetKey(stepId))).not.toHaveProperty("questionStartedAt")
      expect(await storage.get(blockedTargetKey(stepId))).not.toHaveProperty("questionOwnerInstanceId")

      const malformedAnswers: Array<{ id: string; answers: unknown }> = [
        { id: "multi-choice", answers: [[BUDGET_ALLOW_FOR_TEST, "Stop here"]] },
        { id: "multiple-questions", answers: [[BUDGET_ALLOW_FOR_TEST], [BUDGET_ALLOW_FOR_TEST]] },
        { id: "empty-choice", answers: [[]] },
        { id: "non-array-choice", answers: [BUDGET_ALLOW_FOR_TEST] },
      ]
      for (const malformed of malformedAnswers) {
        const callID = `budget-question-${malformed.id}`
        await executeBefore!({
          tool: "question",
          sessionID,
          agent: "general",
          callID,
          input: reorderedQuestion,
        })
        if (malformed.id === "multi-choice") {
          let duplicateQuestionError = ""
          try {
            await executeBefore!({
              tool: "question",
              sessionID,
              agent: "general",
              callID: "budget-question-duplicate-in-flight",
              input: reorderedQuestion,
            })
          } catch (error) {
            duplicateQuestionError = error instanceof Error ? error.message : String(error)
          }
          expect(duplicateQuestionError).toContain("already active")
        }
        await executeAfter!({
          tool: "question",
          sessionID,
          agent: "general",
          callID,
          input: reorderedQuestion,
          status: "completed",
          result: { metadata: { answers: malformed.answers } },
        })
        const ambiguous = await continuationTool!.execute(
          { workflowId, stepId, reason: "Malformed or ambiguous answers must not authorize continuation." },
          { agent: "general", sessionID, messageID: `assistant-${callID}` },
        )
        expect(ambiguous.content).toContain("No user decision exists for the current budget denial")
      }

      await executeBefore!({
        tool: "question",
        sessionID,
        agent: "general",
        callID: "budget-question-custom",
        input: reorderedQuestion,
      })
      await executeAfter!({
        tool: "question",
        sessionID,
        agent: "general",
        callID: "budget-question-custom",
        input: reorderedQuestion,
        status: "completed",
        result: { metadata: { answers: [["Maybe later"]] } },
      })

      const customAnswer = await continuationTool!.execute(
        { workflowId, stepId, reason: "Custom answers must not authorize continuation." },
        { agent: "general", sessionID, messageID: "assistant-budget-question-custom" },
      )
      expect(customAnswer.content).toContain('Only "Allow +1 dispatch" authorizes')
      expect(customAnswer.content).toContain('"Maybe later"')
      expect((await storage.get(blockedTargetKey(stepId)) as any)?.resolvedAt).toBeDefined()

      let declinedQuestionError = ""
      try {
        await executeBefore!({
          tool: "question",
          sessionID,
          agent: "general",
          callID: "budget-question-after-decline",
          input: reorderedQuestion,
        })
      } catch (error) {
        declinedQuestionError = error instanceof Error ? error.message : String(error)
      }
      expect(declinedQuestionError).toContain("reserved for the exact current Loom budget approval question")

      const freshApprovalGrant = await dispatchGrantTool!.execute(
        { workflowId, stepId },
        { agent: "general", sessionID },
      )
      expect(freshApprovalGrant.content).not.toContain("## Error")
      const freshApprovalEvent = {
        agent: "general",
        action: "subagent",
        resources: ["critic"],
        sessionID,
        source: { messageID: "message-6b", id: "dispatch-6b" },
        effect: "allow",
        message: "",
      }
      await evaluatePermission!(freshApprovalEvent)
      expect(freshApprovalEvent.effect).toBe("deny")

      const approvedBlocked = await storage.get(blockedTargetKey(stepId)) as {
        denialId: string
        approvalRef: string
      }
      expect(approvedBlocked.denialId).not.toBe(blockedAfterDenial.denialId)
      expect(approvedBlocked.approvalRef).not.toBe(blockedAfterDenial.approvalRef)
      const approvedQuestion = budgetContinuationQuestionInput({
        agent: "critic",
        stepId,
        approvalRef: approvedBlocked.approvalRef,
      })
      const approvedCanonical = approvedQuestion.questions[0]
      const approvedReorderedQuestion = {
        questions: [{
          options: approvedCanonical.options,
          multiple: approvedCanonical.multiple,
          question: approvedCanonical.question,
          custom: true,
          header: approvedCanonical.header,
        }],
      }

      await executeBefore!({
        tool: "question",
        sessionID,
        agent: "general",
        callID: "budget-question-1",
        input: approvedReorderedQuestion,
      })
      await executeAfter!({
        tool: "question",
        sessionID,
        agent: "general",
        callID: "budget-question-1",
        input: approvedReorderedQuestion,
        status: "completed",
        result: { metadata: { answers: [[approvedQuestion.questions[0].options[0].label]] } },
      })

      const questionContinuation = await continuationTool!.execute(
        {
          workflowId,
          stepId,
          reason: "The user approved one additional dispatch in the OpenCode question UI.",
        },
        { agent: "general", sessionID, messageID: "assistant-budget-question" },
      )
      expect(questionContinuation.content).not.toContain('"error"')
      expect(questionContinuation.content).toContain("**Authorization Source:** question")

      const persistedAfterQuestion = await storage.get(budgetKey) as BudgetState
      expect(persistedAfterQuestion.continuations).toHaveLength(2)
      expect(persistedAfterQuestion.continuations?.[1]).toMatchObject({
        authorizationId: `question-denial:${approvedBlocked.denialId}`,
        authorizationSource: "question",
        authorizationQuestionCallId: "budget-question-1",
        authorizationDenialId: approvedBlocked.denialId,
      })
      expect(persistedAfterQuestion.continuations?.[1]?.authorizationUserMessageId).toBeUndefined()
      expect((await storage.get(blockedTargetKey(stepId)) as any)?.resolvedAt).toBeDefined()

      const questionResumedGrant = await dispatchGrantTool!.execute(
        { workflowId, stepId },
        { agent: "general", sessionID },
      )
      expect(questionResumedGrant.content).not.toContain("## Error")

      const questionResumedEvent = {
        agent: "general",
        action: "subagent",
        resources: ["critic"],
        sessionID,
        source: { messageID: "message-7", id: "dispatch-7" },
        effect: "allow",
        message: "",
      }
      await evaluatePermission!(questionResumedEvent)
      expect(questionResumedEvent.effect).not.toBe("deny")

      const persistedAfterQuestionDispatch = await storage.get(budgetKey) as BudgetState
      expect(persistedAfterQuestionDispatch.byKey[dispatchKey]).toBe(5)
      expect(persistedAfterQuestionDispatch.continuations?.[1]?.usedDispatches).toBe(1)

      const reusedQuestion = await continuationTool!.execute(
        { workflowId, stepId, reason: "One question approval must never mint a second continuation." },
        { agent: "general", sessionID, messageID: "assistant-budget-question-reuse" },
      )
      expect(reusedQuestion.content).toContain("already authorized")

      let lingeringQuestionError = ""
      try {
        await executeBefore!({
          tool: "question",
          sessionID,
          agent: "general",
          callID: "budget-question-after-resolution",
          input: approvedReorderedQuestion,
        })
      } catch (error) {
        lingeringQuestionError = error instanceof Error ? error.message : String(error)
      }
      expect(lingeringQuestionError).toContain("reserved for the exact current Loom budget approval question")

      const parallelCriticGrant = await dispatchGrantTool!.execute(
        { workflowId, stepId },
        { agent: "general", sessionID },
      )
      expect(parallelCriticGrant.content).not.toContain("## Error")
      const parallelCriticEvent = {
        agent: "general",
        action: "subagent",
        resources: ["critic"],
        sessionID,
        source: { messageID: "message-8", id: "dispatch-8" },
        effect: "allow",
        message: "",
      }
      await evaluatePermission!(parallelCriticEvent)
      expect(parallelCriticEvent.effect).toBe("deny")

      const parallelReviewerGrant = await dispatchGrantTool!.execute(
        { workflowId, stepId: reviewerStepId },
        { agent: "general", sessionID },
      )
      expect(parallelReviewerGrant.content).not.toContain("## Error")
      const parallelReviewerEvent = {
        agent: "general",
        action: "subagent",
        resources: ["reviewer"],
        sessionID,
        source: { messageID: "message-9", id: "dispatch-9" },
        effect: "allow",
        message: "",
      }
      await evaluatePermission!(parallelReviewerEvent)
      expect(parallelReviewerEvent.effect).toBe("deny")

      const criticBlocked = await storage.get(blockedTargetKey(stepId)) as {
        denialId: string
        approvalRef: string
      }
      const reviewerBlocked = await storage.get(blockedTargetKey(reviewerStepId)) as {
        denialId: string
        approvalRef: string
      }
      expect(criticBlocked.denialId).not.toBe(reviewerBlocked.denialId)
      expect(criticBlocked.approvalRef).not.toBe(reviewerBlocked.approvalRef)

      const parallelCriticQuestion = budgetContinuationQuestionInput({
        agent: "critic",
        stepId,
        approvalRef: criticBlocked.approvalRef,
      })
      const parallelReviewerQuestion = budgetContinuationQuestionInput({
        agent: "reviewer",
        stepId: reviewerStepId,
        approvalRef: reviewerBlocked.approvalRef,
      })

      await executeBefore!({
        tool: "question",
        sessionID,
        agent: "general",
        callID: "parallel-critic-question",
        input: parallelCriticQuestion,
      })
      await executeBefore!({
        tool: "question",
        sessionID,
        agent: "general",
        callID: "parallel-reviewer-question",
        input: parallelReviewerQuestion,
      })

      await executeAfter!({
        tool: "question",
        sessionID,
        agent: "general",
        callID: "parallel-reviewer-question",
        input: parallelReviewerQuestion,
        status: "completed",
        result: { metadata: { answers: [[parallelReviewerQuestion.questions[0].options[0].label]] } },
      })
      await executeAfter!({
        tool: "question",
        sessionID,
        agent: "general",
        callID: "parallel-critic-question",
        input: parallelCriticQuestion,
        status: "completed",
        result: { metadata: { answers: [[parallelCriticQuestion.questions[0].options[0].label]] } },
      })

      const reviewerContinuation = await continuationTool!.execute(
        {
          workflowId,
          stepId: reviewerStepId,
          reason: "Reviewer parallel denial was explicitly approved.",
        },
        { agent: "general", sessionID, messageID: "assistant-parallel-reviewer" },
      )
      const criticContinuation = await continuationTool!.execute(
        {
          workflowId,
          stepId,
          reason: "Critic parallel denial was explicitly approved.",
        },
        { agent: "general", sessionID, messageID: "assistant-parallel-critic" },
      )
      expect(reviewerContinuation.content).not.toContain("## Error")
      expect(criticContinuation.content).not.toContain("## Error")

      const persistedParallel = await storage.get(budgetKey) as BudgetState
      expect(persistedParallel.continuations?.slice(-2)).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            key: reviewerDispatchKey,
            authorizationId: `question-denial:${reviewerBlocked.denialId}`,
          }),
          expect.objectContaining({
            key: dispatchKey,
            authorizationId: `question-denial:${criticBlocked.denialId}`,
          }),
        ]),
      )
    } finally {
      if (previousState === undefined) delete process.env.XDG_STATE_HOME
      else process.env.XDG_STATE_HOME = previousState
      if (previousRuntime === undefined) delete process.env.XDG_RUNTIME_DIR
      else process.env.XDG_RUNTIME_DIR = previousRuntime
      await rm(root, { recursive: true, force: true })
    }
  })
})
