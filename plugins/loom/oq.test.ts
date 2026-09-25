import { describe, expect, test } from "bun:test"
import {
  answerQuestion,
  blockingQuestionsForStep,
  raiseQuestion,
  reconcileQuestion,
  reopenQuestion,
} from "./oq"
import { buildSteps, type Workflow } from "./workflow"

function workflow(): Workflow {
  return {
    id: "w",
    projectId: "project-test",
    revision: 0,
    anchor: "anchor",
    createdBySession: "s",
    createdAt: "now",
    steps: buildSteps({
      humanFacing: false,
      behavioral: true,
      structural: true,
      externalUnknown: false,
      diagnostic: false,
      productOutcome: false,
    }),
  }
}

describe("Loom shared OQ board", () => {
  test("blocking question automatically makes the raising step a consumer", () => {
    const w = workflow()
    const q = raiseQuestion({
      id: "q1",
      workflow: w,
      question: "What consistency must this operation guarantee?",
      raisedByAgent: "specifier",
      raisedByStepId: "specifier",
      requiredAuthority: "architect",
      blocking: true,
      now: "now",
    })

    expect(q.consumerStepIds).toEqual(["specifier"])
    expect(blockingQuestionsForStep([q], "specifier")).toHaveLength(1)
  })

  test("preserves stable Plan/Task correlation on the question", () => {
    const q = raiseQuestion({
      id: "q-plan",
      workflow: workflow(),
      question: "Which lifecycle guarantee applies here?",
      raisedByAgent: "specifier",
      raisedByStepId: "specifier",
      requiredAuthority: "architect",
      blocking: true,
      work: {
        objectiveId: "objective:docs/anchors/product/anchor.md",
        generation: 3,
        revision: 2,
        taskId: "runtime-recovery",
      },
      now: "now",
    })

    expect(q.work).toEqual({
      objectiveId: "objective:docs/anchors/product/anchor.md",
      generation: 3,
      revision: 2,
      taskId: "runtime-recovery",
    })
  })

  test("any Loom role may be the named OQ responder without turning the answer into a gate verdict", () => {
    for (const requiredAuthority of ["planner", "worker", "reviewer", "critic", "documenter", "acceptance"] as const) {
      const q = raiseQuestion({
        id: `q-${requiredAuthority}`,
        workflow: workflow(),
        question: "Answer the narrow role-owned question.",
        raisedByAgent: "specifier",
        raisedByStepId: "specifier",
        requiredAuthority,
        blocking: true,
        now: "now",
      })
      expect(q.requiredAuthority).toBe(requiredAuthority)
      expect(() => answerQuestion(q, requiredAuthority, "agent", "bounded answer", [], "later")).not.toThrow()
      expect(q.answer?.by).toBe(requiredAuthority)
    }
  })

  test("General may raise a coordinator OQ when blocking consumers are explicit", () => {
    const w = workflow()
    const q = raiseQuestion({
      id: "q-general",
      workflow: w,
      question: "Does Planner need to split this work?",
      raisedByAgent: "general",
      raisedByStepId: "general",
      requiredAuthority: "planner",
      blocking: true,
      consumerStepIds: ["specifier"],
      now: "now",
    })
    expect(q.raisedByAgent).toBe("general")
    expect(q.consumerStepIds).toEqual(["specifier"])

    expect(() => raiseQuestion({
      id: "q-general-bad",
      workflow: w,
      question: "Blocking but affects nothing.",
      raisedByAgent: "general",
      raisedByStepId: "general",
      requiredAuthority: "planner",
      blocking: true,
      now: "now",
    })).toThrow("must name at least one affected consumer")
  })

  test("an OQ responder may raise a nested peer OQ with inherited consumers", () => {
    const w = workflow()
    const parent = raiseQuestion({
      id: "q-parent",
      workflow: w,
      question: "Does the plan dependency still hold?",
      raisedByAgent: "specifier",
      raisedByStepId: "specifier",
      requiredAuthority: "planner",
      blocking: true,
      work: {
        objectiveId: "objective:docs/anchors/product/anchor.md",
        generation: 2,
        revision: 4,
        taskId: "runtime",
      },
      now: "now",
    })

    const child = raiseQuestion({
      id: "q-child",
      workflow: w,
      question: "Does architecture still require this interface?",
      raisedByAgent: "planner",
      raisedByStepId: parent.raisedByStepId,
      parentQuestionId: parent.id,
      requiredAuthority: "architect",
      blocking: true,
      consumerStepIds: parent.consumerStepIds,
      work: parent.work,
      now: "later",
    })

    expect(child.parentQuestionId).toBe(parent.id)
    expect(child.consumerStepIds).toEqual(parent.consumerStepIds)
    expect(child.work).toEqual(parent.work)
    expect(child.requiredAuthority).toBe("architect")
  })

  test("only required authority can answer", () => {
    const q = raiseQuestion({
      id: "q1",
      workflow: workflow(),
      question: "Which structural owner handles this?",
      raisedByAgent: "specifier",
      raisedByStepId: "specifier",
      requiredAuthority: "architect",
      blocking: true,
      now: "now",
    })

    expect(() => answerQuestion(q, "designer", "agent", "x", [], "later")).toThrow()
    answerQuestion(q, "architect", "agent", "architecture answer", [], "later")
    expect(q.status).toBe("answered")
  })

  test("answer is not closure until consumers reconcile", () => {
    const w = workflow()
    const q = raiseQuestion({
      id: "q1",
      workflow: w,
      question: "Question",
      raisedByAgent: "specifier",
      raisedByStepId: "specifier",
      requiredAuthority: "architect",
      blocking: true,
      consumerStepIds: ["architect"],
      now: "now",
    })

    answerQuestion(q, "architect", "agent", "answer", [], "later")
    expect(q.status).toBe("answered")

    reconcileQuestion(q, w, "specifier", "specifier", "incorporated", "updated requirement", "t2")
    expect(q.status).toBe("answered")

    reconcileQuestion(q, w, "architect", "architect", "unaffected", "already matches", "t3")
    expect(q.status).toBe("closed")
    expect(blockingQuestionsForStep([q], "specifier")).toHaveLength(0)
  })

  test("user-owned answer can only be recorded by general as user source", () => {
    const q = raiseQuestion({
      id: "q1",
      workflow: workflow(),
      question: "Which subjective behavior do you prefer?",
      raisedByAgent: "specifier",
      raisedByStepId: "specifier",
      requiredAuthority: "user",
      blocking: true,
      now: "now",
    })

    expect(() => answerQuestion(q, "general", "agent", "guess", [], "later")).toThrow()
    answerQuestion(q, "general", "user", "user chose A", [], "later")
    expect(q.answer?.by).toBe("user")
  })

  test("reopen can invalidate a stale answer and clears reconciliation", () => {
    const w = workflow()
    const q = raiseQuestion({
      id: "q1",
      workflow: w,
      question: "Question",
      raisedByAgent: "specifier",
      raisedByStepId: "specifier",
      requiredAuthority: "architect",
      blocking: true,
      now: "now",
    })
    answerQuestion(q, "architect", "agent", "answer", [], "t1")
    reconcileQuestion(q, w, "specifier", "specifier", "incorporated", "done", "t2")
    expect(q.status).toBe("closed")

    reopenQuestion(q, "specifier", false, "source changed", "t3")
    expect(q.status).toBe("open")
    expect(q.answer).toBeUndefined()
    expect(q.reconciliations).toEqual({})
  })
})
