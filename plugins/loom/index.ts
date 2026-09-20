import { Plugin } from "@opencode/plugin"
import {
  buildSteps,
  preserveSatisfied,
  finishStep,
  reopenFrom,
  runnable,
  type Effects,
  type Workflow,
} from "./workflow"
import {
  answerQuestion,
  blockingQuestionsForStep,
  raiseQuestion,
  reconcileQuestion,
  relevantQuestions,
  reopenQuestion,
  type OpenQuestion,
  type OQAuthority,
  type OQDisposition,
} from "./oq"

const loomAgents = new Set([
  "designer",
  "specifier",
  "architect",
  "reviewer",
  "critic",
  "worker",
  "research",
  "diagnostic",
])

function workflowKey(id: string) {
  return `workflow/${id}`
}

function sessionKey(id: string) {
  return `session/${id}`
}

function oqIndexKey(workflowId: string) {
  return `oq-index/${workflowId}`
}

function oqKey(workflowId: string, questionId: string) {
  return `oq/${workflowId}/${questionId}`
}

async function readWorkflow(ctx: any, id: string): Promise<Workflow | undefined> {
  return (await ctx.storage.get(workflowKey(id))) as Workflow | undefined
}

async function activeWorkflow(ctx: any, sessionID: string): Promise<Workflow | undefined> {
  const id = (await ctx.storage.get(sessionKey(sessionID))) as string | undefined
  return id ? readWorkflow(ctx, id) : undefined
}

async function readQuestions(ctx: any, workflowId: string): Promise<OpenQuestion[]> {
  const ids = ((await ctx.storage.get(oqIndexKey(workflowId))) as string[] | undefined) ?? []
  const questions = await Promise.all(
    ids.map((id) => ctx.storage.get(oqKey(workflowId, id)) as Promise<OpenQuestion | undefined>),
  )
  return questions.filter((question): question is OpenQuestion => Boolean(question))
}

async function saveQuestion(ctx: any, question: OpenQuestion) {
  await ctx.storage.set(oqKey(question.workflowId, question.id), question)
}

async function appendQuestion(ctx: any, question: OpenQuestion) {
  const key = oqIndexKey(question.workflowId)
  const ids = ((await ctx.storage.get(key)) as string[] | undefined) ?? []
  if (!ids.includes(question.id)) {
    await ctx.storage.set(key, [...ids, question.id])
  }
  await saveQuestion(ctx, question)
}

function questionState(questions: OpenQuestion[], workflow: Workflow) {
  const unresolved = questions.filter((question) => question.status !== "closed")
  const routes = unresolved
    .filter((question) => !question.answer)
    .map((question) => ({
      questionId: question.id,
      requiredAuthority: question.requiredAuthority,
      blocking: question.blocking,
    }))

  const reconcile = unresolved
    .filter((question) => Boolean(question.answer))
    .flatMap((question) =>
      question.consumerStepIds
        .filter((stepId) => !question.reconciliations[stepId])
        .map((stepId) => ({
          questionId: question.id,
          stepId,
          agent: workflow.steps.find((step) => step.id === stepId)?.agent,
        })),
    )

  return {
    unresolved: unresolved.map((question) => ({
      id: question.id,
      status: question.status,
      requiredAuthority: question.requiredAuthority,
      blocking: question.blocking,
      consumers: question.consumerStepIds,
    })),
    routes,
    reconcile,
  }
}

export default Plugin.define({
  id: "loom",

  async setup(ctx) {
    await ctx.agent.transform((editor) => {
      if (editor.get("general")) editor.default("general")
    })

    await ctx.tool.transform((editor) => {
      editor.namespace({
        name: "loom",
        description: "Loom workflow control, shared questions, routing, and step state.",
      })

      editor.add({
        name: "start",
        description: "Start a Loom workflow for an accepted Anchor. General only.",
        input: {
          type: "object",
          properties: {
            anchor: { type: "string", description: "Repository path to the accepted Anchor." },
          },
          required: ["anchor"],
          additionalProperties: false,
        },
        options: { namespace: "loom" },
        execute: async (input, tool) => {
          if (tool.agent !== "general") {
            return { content: JSON.stringify({ error: "Only general may start a Loom workflow." }) }
          }

          const { anchor } = input as { anchor: string }
          const id = crypto.randomUUID()
          const workflow: Workflow = {
            id,
            anchor,
            createdBySession: tool.sessionID,
            createdAt: new Date().toISOString(),
            steps: [],
          }

          await ctx.storage.set(workflowKey(id), workflow)
          await ctx.storage.set(sessionKey(tool.sessionID), id)

          return { content: JSON.stringify({ workflowId: id, anchor, status: "started" }) }
        },
      })

      editor.add({
        name: "route",
        description:
          "Classify or reclassify accepted work and create the required Loom execution DAG. General only.",
        input: {
          type: "object",
          properties: {
            humanFacing: { type: "boolean" },
            behavioral: { type: "boolean" },
            structural: { type: "boolean" },
            externalUnknown: { type: "boolean" },
            diagnostic: { type: "boolean" },
            productOutcome: { type: "boolean" },
          },
          required: [
            "humanFacing",
            "behavioral",
            "structural",
            "externalUnknown",
            "diagnostic",
            "productOutcome",
          ],
          additionalProperties: false,
        },
        options: { namespace: "loom" },
        execute: async (input, tool) => {
          if (tool.agent !== "general") {
            return { content: JSON.stringify({ error: "Only general may route Loom workflows." }) }
          }

          const workflow = await activeWorkflow(ctx, tool.sessionID)
          if (!workflow) {
            return { content: JSON.stringify({ error: "No active Loom workflow. Call loom_start first." }) }
          }

          const implementationStarted = workflow.steps.some(
            (step) =>
              ["worker", "review-implementation", "critic-final"].includes(step.id) &&
              ["complete", "passed"].includes(step.status),
          )
          if (implementationStarted) {
            return {
              content: JSON.stringify({
                error:
                  "V0 route reclassification is only supported before implementation completion. Start a correction workflow for later reclassification.",
              }),
            }
          }

          const effects = input as Effects
          const next = buildSteps(effects)
          preserveSatisfied(workflow.steps, next)

          workflow.effects = effects
          workflow.steps = next
          await ctx.storage.set(workflowKey(workflow.id), workflow)

          const questions = await readQuestions(ctx, workflow.id)
          return {
            content: JSON.stringify({
              workflowId: workflow.id,
              steps: workflow.steps,
              runnable: runnable(workflow).map((step) => ({ id: step.id, agent: step.agent })),
              questions: questionState(questions, workflow),
            }),
          }
        },
      })

      editor.add({
        name: "status",
        description: "Inspect Loom workflow state, runnable steps, and unresolved shared questions.",
        input: {
          type: "object",
          properties: { workflowId: { type: "string" } },
          additionalProperties: false,
        },
        options: { namespace: "loom" },
        execute: async (input, tool) => {
          const requested = (input as { workflowId?: string }).workflowId
          const workflow = requested
            ? await readWorkflow(ctx, requested)
            : await activeWorkflow(ctx, tool.sessionID)

          if (!workflow) return { content: JSON.stringify({ error: "Workflow not found." }) }

          const questions = await readQuestions(ctx, workflow.id)
          return {
            content: JSON.stringify({
              workflow,
              runnable: runnable(workflow).map((step) => ({ id: step.id, agent: step.agent })),
              questions: questionState(questions, workflow),
            }),
          }
        },
      })

      editor.add({
        name: "complete",
        description:
          "Finish one Loom step. Work uses complete; Reviewer/Critic gates use pass or fail. Blocking OQs must be closed first.",
        input: {
          type: "object",
          properties: {
            workflowId: { type: "string" },
            stepId: { type: "string" },
            summary: { type: "string" },
            outcome: { type: "string", enum: ["complete", "pass", "fail"] },
          },
          required: ["workflowId", "stepId", "summary"],
          additionalProperties: false,
        },
        options: { namespace: "loom" },
        execute: async (input, tool) => {
          const { workflowId, stepId, summary, outcome } = input as {
            workflowId: string
            stepId: string
            summary: string
            outcome?: "complete" | "pass" | "fail"
          }

          const workflow = await readWorkflow(ctx, workflowId)
          if (!workflow) return { content: JSON.stringify({ error: "Workflow not found." }) }

          const questions = await readQuestions(ctx, workflowId)
          const blocking = blockingQuestionsForStep(questions, stepId)
          if (blocking.length > 0) {
            return {
              content: JSON.stringify({
                error: "Step has unresolved blocking questions.",
                questions: blocking.map((question) => ({
                  id: question.id,
                  status: question.status,
                  requiredAuthority: question.requiredAuthority,
                })),
              }),
            }
          }

          const step = workflow.steps.find((candidate) => candidate.id === stepId)
          if (!step) return { content: JSON.stringify({ error: "Step not found." }) }

          const resolvedOutcome = outcome ?? (step.kind === "work" ? "complete" : undefined)
          if (!resolvedOutcome) {
            return { content: JSON.stringify({ error: "Reviewer/Critic gate requires outcome pass or fail." }) }
          }

          try {
            finishStep(workflow, stepId, tool.agent, resolvedOutcome, summary)
          } catch (error) {
            return { content: JSON.stringify({ error: error instanceof Error ? error.message : String(error) }) }
          }

          await ctx.storage.set(workflowKey(workflow.id), workflow)

          return {
            content: JSON.stringify({
              finished: stepId,
              outcome: resolvedOutcome,
              blocked: workflow.steps.filter((candidate) => candidate.status === "failed").map((candidate) => candidate.id),
              runnable: runnable(workflow).map((candidate) => ({ id: candidate.id, agent: candidate.agent })),
              questions: questionState(questions, workflow),
            }),
          }
        },
      })

      editor.add({
        name: "reopen",
        description:
          "Reopen one prior workflow step after failed review or new evidence. Resets only that step and downstream dependents. General only.",
        input: {
          type: "object",
          properties: {
            workflowId: { type: "string" },
            stepId: { type: "string" },
          },
          required: ["workflowId", "stepId"],
          additionalProperties: false,
        },
        options: { namespace: "loom" },
        execute: async (input, tool) => {
          if (tool.agent !== "general") {
            return { content: JSON.stringify({ error: "Only general may reopen Loom steps." }) }
          }
          const { workflowId, stepId } = input as { workflowId: string; stepId: string }
          const workflow = await readWorkflow(ctx, workflowId)
          if (!workflow) return { content: JSON.stringify({ error: "Workflow not found." }) }

          try {
            const reset = reopenFrom(workflow, stepId)
            await ctx.storage.set(workflowKey(workflow.id), workflow)
            return {
              content: JSON.stringify({
                reopened: stepId,
                reset,
                runnable: runnable(workflow).map((candidate) => ({ id: candidate.id, agent: candidate.agent })),
              }),
            }
          } catch (error) {
            return { content: JSON.stringify({ error: error instanceof Error ? error.message : String(error) }) }
          }
        },
      })

      editor.add({
        name: "oq_raise",
        description:
          "Raise a shared workflow question. Blocking questions automatically make the raising step a required consumer.",
        input: {
          type: "object",
          properties: {
            workflowId: { type: "string" },
            stepId: { type: "string" },
            question: { type: "string" },
            requiredAuthority: {
              type: "string",
              enum: ["user", "designer", "specifier", "architect", "research", "diagnostic", "reviewer", "critic"],
            },
            blocking: { type: "boolean" },
            consumerStepIds: { type: "array", items: { type: "string" } },
            evidence: { type: "array", items: { type: "string" } },
          },
          required: ["workflowId", "stepId", "question", "requiredAuthority", "blocking"],
          additionalProperties: false,
        },
        options: { namespace: "loom" },
        execute: async (input, tool) => {
          const value = input as {
            workflowId: string
            stepId: string
            question: string
            requiredAuthority: OQAuthority
            blocking: boolean
            consumerStepIds?: string[]
            evidence?: string[]
          }
          const workflow = await readWorkflow(ctx, value.workflowId)
          if (!workflow) return { content: JSON.stringify({ error: "Workflow not found." }) }

          try {
            const question = raiseQuestion({
              id: crypto.randomUUID(),
              workflow,
              question: value.question,
              raisedByAgent: tool.agent,
              raisedByStepId: value.stepId,
              requiredAuthority: value.requiredAuthority,
              blocking: value.blocking,
              consumerStepIds: value.consumerStepIds,
              evidence: value.evidence,
              now: new Date().toISOString(),
            })
            await appendQuestion(ctx, question)
            return {
              content: JSON.stringify({
                question,
                routeTo: question.requiredAuthority,
              }),
            }
          } catch (error) {
            return { content: JSON.stringify({ error: error instanceof Error ? error.message : String(error) }) }
          }
        },
      })

      editor.add({
        name: "oq_list",
        description: "List shared questions relevant to the current agent or one assigned step.",
        input: {
          type: "object",
          properties: {
            workflowId: { type: "string" },
            stepId: { type: "string" },
          },
          required: ["workflowId"],
          additionalProperties: false,
        },
        options: { namespace: "loom" },
        execute: async (input, tool) => {
          const { workflowId, stepId } = input as { workflowId: string; stepId?: string }
          const workflow = await readWorkflow(ctx, workflowId)
          if (!workflow) return { content: JSON.stringify({ error: "Workflow not found." }) }

          const questions = await readQuestions(ctx, workflowId)
          return {
            content: JSON.stringify({
              questions: relevantQuestions(questions, workflow, tool.agent, stepId),
            }),
          }
        },
      })

      editor.add({
        name: "oq_answer",
        description:
          "Answer a shared question. Agent-owned questions require the named authority. User-owned answers are recorded by General with source=user.",
        input: {
          type: "object",
          properties: {
            workflowId: { type: "string" },
            questionId: { type: "string" },
            answer: { type: "string" },
            source: { type: "string", enum: ["agent", "user"] },
            evidence: { type: "array", items: { type: "string" } },
          },
          required: ["workflowId", "questionId", "answer", "source"],
          additionalProperties: false,
        },
        options: { namespace: "loom" },
        execute: async (input, tool) => {
          const value = input as {
            workflowId: string
            questionId: string
            answer: string
            source: "agent" | "user"
            evidence?: string[]
          }
          const question = (await ctx.storage.get(oqKey(value.workflowId, value.questionId))) as OpenQuestion | undefined
          if (!question) return { content: JSON.stringify({ error: "Question not found." }) }

          try {
            answerQuestion(
              question,
              tool.agent,
              value.source,
              value.answer,
              value.evidence ?? [],
              new Date().toISOString(),
            )
            await saveQuestion(ctx, question)
            return { content: JSON.stringify({ question }) }
          } catch (error) {
            return { content: JSON.stringify({ error: error instanceof Error ? error.message : String(error) }) }
          }
        },
      })

      editor.add({
        name: "oq_reconcile",
        description:
          "Record how one workflow step consumed an answered question. Late consumers may register themselves through reconciliation.",
        input: {
          type: "object",
          properties: {
            workflowId: { type: "string" },
            questionId: { type: "string" },
            stepId: { type: "string" },
            disposition: {
              type: "string",
              enum: ["incorporated", "unaffected", "explicitly-deferred"],
            },
            summary: { type: "string" },
          },
          required: ["workflowId", "questionId", "stepId", "disposition", "summary"],
          additionalProperties: false,
        },
        options: { namespace: "loom" },
        execute: async (input, tool) => {
          const value = input as {
            workflowId: string
            questionId: string
            stepId: string
            disposition: OQDisposition
            summary: string
          }
          const workflow = await readWorkflow(ctx, value.workflowId)
          const question = (await ctx.storage.get(oqKey(value.workflowId, value.questionId))) as OpenQuestion | undefined
          if (!workflow || !question) return { content: JSON.stringify({ error: "Workflow or question not found." }) }

          try {
            reconcileQuestion(
              question,
              workflow,
              value.stepId,
              tool.agent,
              value.disposition,
              value.summary,
              new Date().toISOString(),
            )
            await saveQuestion(ctx, question)
            return { content: JSON.stringify({ question }) }
          } catch (error) {
            return { content: JSON.stringify({ error: error instanceof Error ? error.message : String(error) }) }
          }
        },
      })

      editor.add({
        name: "oq_reopen",
        description:
          "Reopen a shared question when its answer is stale, conflicting, or new consumers require reconsideration. Answer preservation must be explicit.",
        input: {
          type: "object",
          properties: {
            workflowId: { type: "string" },
            questionId: { type: "string" },
            preserveAnswer: { type: "boolean" },
            reason: { type: "string" },
          },
          required: ["workflowId", "questionId", "preserveAnswer", "reason"],
          additionalProperties: false,
        },
        options: { namespace: "loom" },
        execute: async (input, tool) => {
          const value = input as {
            workflowId: string
            questionId: string
            preserveAnswer: boolean
            reason: string
          }
          const question = (await ctx.storage.get(oqKey(value.workflowId, value.questionId))) as OpenQuestion | undefined
          if (!question) return { content: JSON.stringify({ error: "Question not found." }) }

          try {
            reopenQuestion(
              question,
              tool.agent,
              value.preserveAnswer,
              value.reason,
              new Date().toISOString(),
            )
            await saveQuestion(ctx, question)
            return { content: JSON.stringify({ question }) }
          } catch (error) {
            return { content: JSON.stringify({ error: error instanceof Error ? error.message : String(error) }) }
          }
        },
      })
    })

    await ctx.permission.hook("evaluate", async (event) => {
      if (event.agent !== "general" || event.action !== "subagent") return

      const target = event.resources.find((resource) => loomAgents.has(resource))
      if (!target) return

      const workflow = await activeWorkflow(ctx, event.sessionID)
      if (!workflow || workflow.steps.length === 0) {
        event.effect = "deny"
        event.message = "Start and route a Loom workflow before dispatching Loom subagents."
        return
      }

      const questions = await readQuestions(ctx, workflow.id)
      const requiredForQuestion = questions.some(
        (question) =>
          question.status !== "closed" &&
          !question.answer &&
          question.requiredAuthority === target,
      )
      const requiredForStep = runnable(workflow).some((step) => step.agent === target)

      if (!requiredForStep && !requiredForQuestion) {
        event.effect = "deny"
        event.message = `Agent ${target} is not runnable and has no unanswered OQ. Inspect loom_status.`
      }
    })
  },
})
