import { Plugin } from "@opencode/plugin"

type StepStatus = "pending" | "complete"

type Step = {
  id: string
  agent: string
  dependsOn: string[]
  status: StepStatus
  summary?: string
}

type Effects = {
  humanFacing: boolean
  behavioral: boolean
  structural: boolean
  externalUnknown: boolean
  diagnostic: boolean
  productOutcome: boolean
}

type Workflow = {
  id: string
  anchor: string
  createdBySession: string
  createdAt: string
  effects?: Effects
  steps: Step[]
}

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

function runnable(workflow: Workflow) {
  const done = new Set(workflow.steps.filter((step) => step.status === "complete").map((step) => step.id))
  return workflow.steps.filter(
    (step) => step.status === "pending" && step.dependsOn.every((dependency) => done.has(dependency)),
  )
}

function buildSteps(effects: Effects): Step[] {
  const steps: Step[] = []
  const think: string[] = []

  if (effects.diagnostic) {
    steps.push({ id: "diagnostic", agent: "diagnostic", dependsOn: [], status: "pending" })
    think.push("diagnostic")
  }
  if (effects.externalUnknown) {
    steps.push({ id: "research", agent: "research", dependsOn: [], status: "pending" })
    think.push("research")
  }
  if (effects.humanFacing) {
    steps.push({ id: "designer", agent: "designer", dependsOn: [], status: "pending" })
    think.push("designer")
  }
  if (effects.behavioral) {
    steps.push({ id: "specifier", agent: "specifier", dependsOn: [], status: "pending" })
    think.push("specifier")
  }

  let lastThink: string[] = [...think]

  if (think.length > 0) {
    steps.push({ id: "review-think", agent: "reviewer", dependsOn: [...think], status: "pending" })
    lastThink = ["review-think"]
  }

  if (effects.structural) {
    steps.push({ id: "architect", agent: "architect", dependsOn: [...lastThink], status: "pending" })
    steps.push({
      id: "review-architecture",
      agent: "reviewer",
      dependsOn: ["architect"],
      status: "pending",
    })
    lastThink = ["review-architecture"]
  }

  if (effects.productOutcome) {
    steps.push({
      id: "critic-solution",
      agent: "critic",
      dependsOn: [...lastThink],
      status: "pending",
    })
    lastThink = ["critic-solution"]
  }

  steps.push({ id: "worker", agent: "worker", dependsOn: [...lastThink], status: "pending" })
  steps.push({
    id: "review-implementation",
    agent: "reviewer",
    dependsOn: ["worker"],
    status: "pending",
  })

  if (effects.productOutcome) {
    steps.push({
      id: "critic-final",
      agent: "critic",
      dependsOn: ["review-implementation"],
      status: "pending",
    })
  }

  return steps
}

function preserveCompleted(previous: Step[], next: Step[]) {
  const byID = new Map(previous.map((step) => [step.id, step]))

  for (const step of next) {
    const old = byID.get(step.id)
    if (old?.agent === step.agent && old.status === "complete") {
      step.status = "complete"
      step.summary = old.summary
    }
  }
}

async function readWorkflow(ctx: any, id: string): Promise<Workflow | undefined> {
  return (await ctx.storage.get(workflowKey(id))) as Workflow | undefined
}

async function activeWorkflow(ctx: any, sessionID: string): Promise<Workflow | undefined> {
  const id = (await ctx.storage.get(sessionKey(sessionID))) as string | undefined
  return id ? readWorkflow(ctx, id) : undefined
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
        description: "Loom workflow control: start, route, inspect, and complete workflow steps.",
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
          "Classify or reclassify the accepted work and create the required Loom execution DAG. General only. Reclassification is allowed before implementation completes and preserves valid completed steps.",
        input: {
          type: "object",
          properties: {
            humanFacing: { type: "boolean" },
            behavioral: { type: "boolean" },
            structural: { type: "boolean" },
            externalUnknown: { type: "boolean" },
            diagnostic: { type: "boolean" },
            productOutcome: {
              type: "boolean",
              description: "True for non-trivial product work requiring holistic solution and final Critic review.",
            },
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
              step.status === "complete",
          )
          if (implementationStarted) {
            return {
              content: JSON.stringify({
                error:
                  "V0 route reclassification is only supported before implementation completion. Start a new correction workflow for later reclassification.",
              }),
            }
          }

          const effects = input as Effects
          const next = buildSteps(effects)
          preserveCompleted(workflow.steps, next)

          workflow.effects = effects
          workflow.steps = next
          await ctx.storage.set(workflowKey(workflow.id), workflow)

          return {
            content: JSON.stringify({
              workflowId: workflow.id,
              steps: workflow.steps,
              runnable: runnable(workflow).map((step) => ({ id: step.id, agent: step.agent })),
            }),
          }
        },
      })

      editor.add({
        name: "status",
        description: "Inspect Loom workflow state and currently runnable steps.",
        input: {
          type: "object",
          properties: {
            workflowId: { type: "string" },
          },
          additionalProperties: false,
        },
        options: { namespace: "loom" },
        execute: async (input, tool) => {
          const requested = (input as { workflowId?: string }).workflowId
          const workflow = requested
            ? await readWorkflow(ctx, requested)
            : await activeWorkflow(ctx, tool.sessionID)

          if (!workflow) {
            return { content: JSON.stringify({ error: "Workflow not found." }) }
          }

          return {
            content: JSON.stringify({
              workflow,
              runnable: runnable(workflow).map((step) => ({ id: step.id, agent: step.agent })),
            }),
          }
        },
      })

      editor.add({
        name: "complete",
        description:
          "Complete one Loom workflow step. The current OpenCode agent must match the step's assigned agent and all dependencies must already be complete.",
        input: {
          type: "object",
          properties: {
            workflowId: { type: "string" },
            stepId: { type: "string" },
            summary: { type: "string", description: "Short result/evidence summary." },
          },
          required: ["workflowId", "stepId", "summary"],
          additionalProperties: false,
        },
        options: { namespace: "loom" },
        execute: async (input, tool) => {
          const { workflowId, stepId, summary } = input as {
            workflowId: string
            stepId: string
            summary: string
          }

          const workflow = await readWorkflow(ctx, workflowId)
          if (!workflow) return { content: JSON.stringify({ error: "Workflow not found." }) }

          const step = workflow.steps.find((candidate) => candidate.id === stepId)
          if (!step) return { content: JSON.stringify({ error: "Step not found." }) }

          if (step.agent !== tool.agent) {
            return {
              content: JSON.stringify({
                error: `Step ${stepId} belongs to ${step.agent}, not ${tool.agent}.`,
              }),
            }
          }

          const done = new Set(
            workflow.steps.filter((candidate) => candidate.status === "complete").map((candidate) => candidate.id),
          )
          const missing = step.dependsOn.filter((dependency) => !done.has(dependency))
          if (missing.length > 0) {
            return { content: JSON.stringify({ error: "Dependencies incomplete.", missing }) }
          }

          step.status = "complete"
          step.summary = summary
          await ctx.storage.set(workflowKey(workflow.id), workflow)

          return {
            content: JSON.stringify({
              completed: stepId,
              runnable: runnable(workflow).map((candidate) => ({
                id: candidate.id,
                agent: candidate.agent,
              })),
            }),
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

      const allowed = runnable(workflow).some((step) => step.agent === target)
      if (!allowed) {
        event.effect = "deny"
        event.message = `Agent ${target} is not runnable. Inspect loom_status for current prerequisites.`
      }
    })
  },
})
