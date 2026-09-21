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
