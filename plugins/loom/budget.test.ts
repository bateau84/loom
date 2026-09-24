import { describe, expect, test } from "bun:test"
import {
  DEFAULT_LIMITS,
  continueWorkflowDispatchBudget,
  grantExtraDispatch,
  grantWorkflowDispatchBudget,
  hasMaterialProgress,
  newBudgetState,
  recordDispatch,
} from "./budget"

describe("Loom progress and dispatch budgets", () => {
  test("dispatch ids are idempotent", () => {
    const state = newBudgetState()

    recordDispatch({
      state,
      limits: DEFAULT_LIMITS,
      dispatchID: "d1",
      key: "worker",
      agent: "worker",
    })
    recordDispatch({
      state,
      limits: DEFAULT_LIMITS,
      dispatchID: "d1",
      key: "worker",
      agent: "worker",
    })

    expect(state.totalDispatches).toBe(1)
    expect(state.byKey.worker).toBe(1)
  })

  test("per-step dispatches are bounded", () => {
    const state = newBudgetState()

    for (const id of ["d1", "d2", "d3"]) {
      expect(
        recordDispatch({
          state,
          limits: DEFAULT_LIMITS,
          dispatchID: id,
          key: "worker",
          agent: "worker",
        }).allowed,
      ).toBe(true)
    }

    expect(
      recordDispatch({
        state,
        limits: DEFAULT_LIMITS,
        dispatchID: "d4",
        key: "worker",
        agent: "worker",
      }).allowed,
    ).toBe(false)
  })

  test("Critic is more tightly bounded", () => {
    const state = newBudgetState()

    for (const id of ["c1", "c2"]) {
      expect(
        recordDispatch({
          state,
          limits: DEFAULT_LIMITS,
          dispatchID: id,
          key: "critic-final",
          agent: "architect",
        }).allowed,
      ).toBe(true)
    }

    expect(
      recordDispatch({
        state,
        limits: DEFAULT_LIMITS,
        dispatchID: "c3",
        key: "critic-final",
        agent: "critic",
      }).allowed,
    ).toBe(false)
  })

  test("workflow grant policy accepts exhausted runnable gates and rejects non-General grants", () => {
    const workflow = {
      id: "wf-gate",
      projectId: "project-test",
      revision: 0,
      anchor: "docs/anchors/test/anchor.md",
      createdBySession: "session",
      createdAt: "now",
      steps: [
        {
          id: "critic-solution",
          agent: "critic",
          kind: "gate" as const,
          dependsOn: [],
          status: "pending" as const,
        },
      ],
    }
    const state = newBudgetState()
    const key = "step:critic-solution"

    for (const id of ["c1", "c2"]) {
      expect(
        recordDispatch({
          state,
          limits: DEFAULT_LIMITS,
          dispatchID: id,
          key,
          agent: "critic",
        }).allowed,
      ).toBe(true)
    }

    expect(
      grantWorkflowDispatchBudget({
        state,
        limits: DEFAULT_LIMITS,
        workflow,
        questions: [],
        stepId: "critic-solution",
        grantedBy: "critic",
        reason: "Self extension must not be allowed.",
        progress: {
          newEvidence: true,
          changedHypothesis: false,
          changedStrategy: false,
          reducedUnresolved: false,
        },
        now: "now",
      }).allowed,
    ).toBe(false)

    const insufficient = grantWorkflowDispatchBudget({
      state,
      limits: DEFAULT_LIMITS,
      workflow,
      questions: [],
      stepId: "critic-solution",
      grantedBy: "general",
      reason: "Architecture correction reduced the unresolved set.",
      progress: {
        newEvidence: false,
        changedHypothesis: false,
        changedStrategy: false,
        reducedUnresolved: true,
      },
      now: "now",
    })
    expect(insufficient.allowed).toBe(false)

    const unrecordedEvidence = grantWorkflowDispatchBudget({
      state,
      limits: DEFAULT_LIMITS,
      workflow,
      questions: [],
      stepId: "critic-solution",
      grantedBy: "general",
      reason: "The corrected architecture is new material evidence for another Critic pass.",
      progress: {
        newEvidence: true,
        changedHypothesis: false,
        changedStrategy: false,
        reducedUnresolved: true,
      },
      now: "now",
    })
    expect(unrecordedEvidence.allowed).toBe(false)

    const grant = grantWorkflowDispatchBudget({
      state,
      limits: DEFAULT_LIMITS,
      workflow,
      questions: [],
      stepId: "critic-solution",
      grantedBy: "general",
      reason: "The corrected architecture is new material evidence for another Critic pass.",
      evidence: ["docs/architecture/example.md#corrected-dependency-registration"],
      progress: {
        newEvidence: true,
        changedHypothesis: false,
        changedStrategy: false,
        reducedUnresolved: true,
      },
      now: "now",
    })

    expect(grant.allowed).toBe(true)
    if (!grant.allowed) throw new Error(grant.reason)
    expect(grant.target).toEqual({
      kind: "step",
      id: "critic-solution",
      key,
      agent: "critic",
      stepKind: "gate",
    })
    expect(grant.previousLimit).toBe(DEFAULT_LIMITS.maxDispatchesPerStep)
    expect(grant.newLimit).toBe(DEFAULT_LIMITS.maxDispatchesPerStep + 1)
    expect(
      recordDispatch({
        state,
        limits: DEFAULT_LIMITS,
        dispatchID: "c3",
        key,
        agent: "critic",
      }).allowed,
    ).toBe(true)
    expect(
      recordDispatch({
        state,
        limits: DEFAULT_LIMITS,
        dispatchID: "c4",
        key,
        agent: "critic",
      }).allowed,
    ).toBe(false)
  })

  test("workflow grant policy recovers exhausted agent-owned OQ dispatches", () => {
    const workflow = {
      id: "wf-oq",
      projectId: "project-test",
      revision: 0,
      anchor: "docs/anchors/test/anchor.md",
      createdBySession: "session",
      createdAt: "now",
      steps: [
        {
          id: "worker",
          agent: "worker",
          kind: "work" as const,
          dependsOn: [],
          status: "pending" as const,
        },
      ],
    }
    const question = {
      id: "oq-1",
      workflowId: workflow.id,
      question: "Which structural owner handles this correction?",
      raisedByAgent: "worker",
      raisedByStepId: "worker",
      requiredAuthority: "architect" as const,
      blocking: true,
      consumerStepIds: ["worker"],
      evidence: [],
      status: "open" as const,
      reconciliations: {},
      createdAt: "now",
    }
    const state = newBudgetState()
    const key = "oq:oq-1"

    for (const id of ["oq-a1", "oq-a2", "oq-a3"]) {
      expect(
        recordDispatch({
          state,
          limits: DEFAULT_LIMITS,
          dispatchID: id,
          key,
          agent: "architect",
        }).allowed,
      ).toBe(true)
    }

    const grant = grantWorkflowDispatchBudget({
      state,
      limits: DEFAULT_LIMITS,
      workflow,
      questions: [question],
      questionId: question.id,
      grantedBy: "general",
      reason: "New evidence makes another authority pass meaningful.",
      evidence: [],
      progress: {
        newEvidence: true,
        changedHypothesis: false,
        changedStrategy: false,
        reducedUnresolved: false,
      },
      now: "now",
    })

    expect(grant.allowed).toBe(true)
    if (!grant.allowed) throw new Error(grant.reason)
    expect(grant.target).toEqual({
      kind: "question",
      id: question.id,
      key,
      agent: "architect",
    })
    expect(grant.previousLimit).toBe(DEFAULT_LIMITS.maxCriticDispatchesPerStep)
    expect(grant.newLimit).toBe(DEFAULT_LIMITS.maxCriticDispatchesPerStep + 1)
    expect(
      recordDispatch({
        state,
        limits: DEFAULT_LIMITS,
        dispatchID: "oq-a4",
        key,
        agent: "architect",
      }).allowed,
    ).toBe(true)
    expect(
      recordDispatch({
        state,
        limits: DEFAULT_LIMITS,
        dispatchID: "oq-a5",
        key,
        agent: "architect",
      }).allowed,
    ).toBe(false)
  })

  test("bounded grants apply to gate-owning agents as well as workers", () => {
    const cases = [
      { agent: "reviewer", base: DEFAULT_LIMITS.maxReviewerDispatchesPerStep },
      { agent: "designer", base: DEFAULT_LIMITS.maxDispatchesPerStep },
      { agent: "acceptance", base: DEFAULT_LIMITS.maxDispatchesPerStep },
    ]

    for (const item of cases) {
      const state = newBudgetState()
      const key = `step:${item.agent}-gate`

      for (let attempt = 1; attempt <= item.base; attempt++) {
        expect(
          recordDispatch({
            state,
            limits: DEFAULT_LIMITS,
            dispatchID: `${item.agent}-${attempt}`,
            key,
            agent: item.agent,
          }).allowed,
        ).toBe(true)
      }

      expect(
        recordDispatch({
          state,
          limits: DEFAULT_LIMITS,
          dispatchID: `${item.agent}-blocked`,
          key,
          agent: item.agent,
        }).allowed,
      ).toBe(false)

      const grant = grantExtraDispatch({
        state,
        limits: DEFAULT_LIMITS,
        key,
        agent: item.agent,
        grantedBy: "general",
        reason: "Material progress justifies one more independent pass.",
        progress: {
          newEvidence: true,
          changedHypothesis: false,
          changedStrategy: false,
          reducedUnresolved: true,
        },
        now: "2026-09-21T17:45:00Z",
      })

      expect(grant.allowed).toBe(true)
      if (!grant.allowed) throw new Error(grant.reason)
      expect(grant.previousLimit).toBe(item.base)
      expect(grant.newLimit).toBe(item.base + 1)

      expect(
        recordDispatch({
          state,
          limits: DEFAULT_LIMITS,
          dispatchID: `${item.agent}-extra`,
          key,
          agent: item.agent,
        }).allowed,
      ).toBe(true)
    }
  })

  test("one material-progress grant allows exactly one extra dispatch without resetting history", () => {
    const state = newBudgetState()
    const key = "step:task:cli-agent-dry-run"

    for (const id of ["d1", "d2", "d3"]) {
      expect(
        recordDispatch({
          state,
          limits: DEFAULT_LIMITS,
          dispatchID: id,
          key,
          agent: "worker",
        }).allowed,
      ).toBe(true)
    }

    expect(
      recordDispatch({
        state,
        limits: DEFAULT_LIMITS,
        dispatchID: "d4-denied",
        key,
        agent: "worker",
      }).allowed,
    ).toBe(false)

    const grant = grantExtraDispatch({
      state,
      limits: DEFAULT_LIMITS,
      key,
      agent: "worker",
      grantedBy: "general",
      reason: "Externally verified formatting correction is now available.",
      progress: {
        newEvidence: true,
        changedHypothesis: false,
        changedStrategy: false,
        reducedUnresolved: true,
      },
      now: "2026-09-20T22:00:00Z",
    })

    expect(grant.allowed).toBe(true)
    if (!grant.allowed) throw new Error(grant.reason)
    expect(grant.previousLimit).toBe(3)
    expect(grant.newLimit).toBe(4)
    expect(state.totalDispatches).toBe(3)
    expect(state.byKey[key]).toBe(3)
    expect(state.grants).toHaveLength(1)

    expect(
      recordDispatch({
        state,
        limits: DEFAULT_LIMITS,
        dispatchID: "d4",
        key,
        agent: "worker",
      }).allowed,
    ).toBe(true)

    expect(state.totalDispatches).toBe(4)
    expect(state.byKey[key]).toBe(4)

    expect(
      recordDispatch({
        state,
        limits: DEFAULT_LIMITS,
        dispatchID: "d5",
        key,
        agent: "worker",
      }).allowed,
    ).toBe(false)
  })

  test("grant requires material progress and actual exhaustion", () => {
    const state = newBudgetState()
    const key = "step:task:x"

    expect(
      grantExtraDispatch({
        state,
        limits: DEFAULT_LIMITS,
        key,
        agent: "worker",
        grantedBy: "general",
        reason: "Try again.",
        progress: {
          newEvidence: true,
          changedHypothesis: false,
          changedStrategy: false,
          reducedUnresolved: false,
        },
        now: "now",
      }).allowed,
    ).toBe(false)

    for (const id of ["d1", "d2", "d3"]) {
      recordDispatch({
        state,
        limits: DEFAULT_LIMITS,
        dispatchID: id,
        key,
        agent: "worker",
      })
    }

    expect(
      grantExtraDispatch({
        state,
        limits: DEFAULT_LIMITS,
        key,
        agent: "worker",
        grantedBy: "general",
        reason: "No actual change.",
        progress: {
          newEvidence: false,
          changedHypothesis: false,
          changedStrategy: false,
          reducedUnresolved: false,
        },
        now: "now",
      }).allowed,
    ).toBe(false)
  })

  test("extra per-step grants remain hard bounded", () => {
    const state = newBudgetState()
    const key = "step:task:x"

    for (const id of ["d1", "d2", "d3"]) {
      recordDispatch({
        state,
        limits: DEFAULT_LIMITS,
        dispatchID: id,
        key,
        agent: "worker",
      })
    }

    for (let attempt = 1; attempt <= DEFAULT_LIMITS.maxExtraDispatchesPerStep; attempt++) {
      const grant = grantExtraDispatch({
        state,
        limits: DEFAULT_LIMITS,
        key,
        agent: "worker",
        grantedBy: "general",
        reason: `Material progress ${attempt}`,
        progress: {
          newEvidence: true,
          changedHypothesis: false,
          changedStrategy: false,
          reducedUnresolved: false,
        },
        now: `now-${attempt}`,
      })
      expect(grant.allowed).toBe(true)

      expect(
        recordDispatch({
          state,
          limits: DEFAULT_LIMITS,
          dispatchID: `extra-${attempt}`,
          key,
          agent: "worker",
        }).allowed,
      ).toBe(true)
    }

    expect(
      grantExtraDispatch({
        state,
        limits: DEFAULT_LIMITS,
        key,
        agent: "worker",
        grantedBy: "general",
        reason: "Too many extra attempts",
        progress: {
          newEvidence: true,
          changedHypothesis: false,
          changedStrategy: false,
          reducedUnresolved: false,
        },
        now: "later",
      }).allowed,
    ).toBe(false)
  })

  test("explicit user continuation authorizes exactly one exhausted-target dispatch", () => {
    const workflow = {
      id: "wf-user-continuation",
      projectId: "project-test",
      revision: 0,
      anchor: "docs/anchors/test/anchor.md",
      createdBySession: "session",
      createdAt: "now",
      steps: [
        {
          id: "worker",
          agent: "worker",
          kind: "work" as const,
          dependsOn: [],
          status: "pending" as const,
        },
      ],
    }
    const state = newBudgetState()
    const limits = { ...DEFAULT_LIMITS, maxTotalDispatches: 6 }
    const key = "step:worker"

    expect(
      continueWorkflowDispatchBudget({
        state,
        limits,
        workflow,
        questions: [],
        stepId: "worker",
        grantedBy: "general",
        reason: "The user wants the unfinished implementation to continue.",
        confirmation: "keep going",
        authorizationUserMessageId: "user-before-exhaustion",
        now: "before-exhaustion",
      }).allowed,
    ).toBe(false)

    for (const id of ["d1", "d2", "d3"]) {
      expect(
        recordDispatch({
          state,
          limits,
          dispatchID: id,
          key,
          agent: "worker",
        }).allowed,
      ).toBe(true)
    }

    for (let attempt = 1; attempt <= DEFAULT_LIMITS.maxExtraDispatchesPerStep; attempt++) {
      const grant = grantWorkflowDispatchBudget({
        state,
        limits,
        workflow,
        questions: [],
        stepId: "worker",
        grantedBy: "general",
        reason: `Material progress ${attempt} left bounded implementation work.`,
        progress: {
          newEvidence: false,
          changedHypothesis: false,
          changedStrategy: true,
          reducedUnresolved: true,
        },
        now: `grant-${attempt}`,
      })
      expect(grant.allowed).toBe(true)
      expect(
        recordDispatch({
          state,
          limits,
          dispatchID: `extra-${attempt}`,
          key,
          agent: "worker",
        }).allowed,
      ).toBe(true)
    }

    expect(state.totalDispatches).toBe(6)
    expect(
      recordDispatch({
        state,
        limits,
        dispatchID: "blocked-before-user-continuation",
        key,
        agent: "worker",
      }).allowed,
    ).toBe(false)

    expect(
      continueWorkflowDispatchBudget({
        state,
        limits,
        workflow,
        questions: [],
        stepId: "worker",
        grantedBy: "worker",
        reason: "Workers may not widen their own budget.",
        confirmation: "keep going",
        authorizationUserMessageId: "user-worker-self-extension",
        now: "unauthorized",
      }).allowed,
    ).toBe(false)

    expect(
      continueWorkflowDispatchBudget({
        state,
        limits,
        workflow,
        questions: [],
        stepId: "worker",
        grantedBy: "general",
        reason: "The user wants the unfinished implementation to continue.",
        confirmation: " ",
        authorizationUserMessageId: "user-missing-confirmation",
        now: "missing-confirmation",
      }).allowed,
    ).toBe(false)

    expect(
      continueWorkflowDispatchBudget({
        state,
        limits,
        workflow,
        questions: [],
        stepId: "worker",
        grantedBy: "general",
        reason: "The user wants the unfinished implementation to continue.",
        confirmation: "keep going",
        authorizationUserMessageId: " ",
        now: "missing-provenance",
      }).allowed,
    ).toBe(false)

    const continuation = continueWorkflowDispatchBudget({
      state,
      limits,
      workflow,
      questions: [],
      stepId: "worker",
      grantedBy: "general",
      reason: "The required identity-safety fix is still unfinished.",
      confirmation: "keep going with the existing worker",
      authorizationUserMessageId: "user-continue-1",
      now: "user-continuation",
    })

    expect(continuation.allowed).toBe(true)
    if (!continuation.allowed) throw new Error(continuation.reason)
    expect(continuation.previousStepLimit).toBe(6)
    expect(continuation.newStepLimit).toBe(7)
    expect(continuation.previousWorkflowLimit).toBe(6)
    expect(continuation.newWorkflowLimit).toBe(7)
    expect(continuation.continuation.requestedDispatches).toBe(1)
    expect(continuation.continuation.authorizationUserMessageId).toBe("user-continue-1")

    expect(
      recordDispatch({
        state,
        limits,
        dispatchID: "continued-1",
        key,
        agent: "worker",
      }).allowed,
    ).toBe(true)

    expect(
      recordDispatch({
        state,
        limits,
        dispatchID: "continued-2-without-new-authority",
        key,
        agent: "worker",
      }).allowed,
    ).toBe(false)

    const reused = continueWorkflowDispatchBudget({
      state,
      limits,
      workflow,
      questions: [],
      stepId: "worker",
      grantedBy: "general",
      reason: "Trying to reuse the same user turn must not mint another retry.",
      confirmation: "keep going with the existing worker",
      authorizationUserMessageId: "user-continue-1",
      now: "reused-user-turn",
    })
    expect(reused.allowed).toBe(false)
    if (reused.allowed) throw new Error("reused user authorization unexpectedly succeeded")
    expect(reused.reason).toContain("already authorized")

    expect(state.totalDispatches).toBe(7)
    expect(state.byKey[key]).toBe(7)
    expect(state.continuations?.[0]?.usedDispatches).toBe(1)
  })

  test("user continuation workflow capacity is reserved for the exact target", () => {
    const workflow = {
      id: "wf-target-reserved",
      projectId: "project-test",
      revision: 0,
      anchor: "docs/anchors/test/anchor.md",
      createdBySession: "session",
      createdAt: "now",
      steps: [
        {
          id: "worker-a",
          agent: "worker",
          kind: "work" as const,
          dependsOn: [],
          status: "pending" as const,
        },
        {
          id: "worker-b",
          agent: "worker",
          kind: "work" as const,
          dependsOn: [],
          status: "pending" as const,
        },
      ],
    }
    const limits = { ...DEFAULT_LIMITS, maxTotalDispatches: 3 }
    const state = newBudgetState()
    const keyA = "step:worker-a"
    const keyB = "step:worker-b"

    for (const id of ["a1", "a2", "a3"]) {
      expect(
        recordDispatch({
          state,
          limits,
          dispatchID: id,
          key: keyA,
          agent: "worker",
        }).allowed,
      ).toBe(true)
    }

    const continuation = continueWorkflowDispatchBudget({
      state,
      limits,
      workflow,
      questions: [],
      stepId: "worker-a",
      grantedBy: "general",
      reason: "Worker A still has accepted unfinished work.",
      confirmation: "give worker A one more try",
      authorizationUserMessageId: "user-worker-a",
      now: "continued",
    })
    expect(continuation.allowed).toBe(true)

    const wrongTarget = recordDispatch({
      state,
      limits,
      dispatchID: "b1-blocked",
      key: keyB,
      agent: "worker",
    })
    expect(wrongTarget.allowed).toBe(false)
    if (wrongTarget.allowed) throw new Error("worker-b unexpectedly consumed worker-a continuation")
    expect(wrongTarget.reason).toContain("no user-authorized continuation capacity remains for step:worker-b")

    expect(
      recordDispatch({
        state,
        limits,
        dispatchID: "a4",
        key: keyA,
        agent: "worker",
      }).allowed,
    ).toBe(true)

    const exhaustedA = recordDispatch({
      state,
      limits,
      dispatchID: "a5-blocked",
      key: keyA,
      agent: "worker",
    })
    expect(exhaustedA.allowed).toBe(false)
    expect(state.continuations?.[0]?.usedDispatches).toBe(1)
    expect(state.totalDispatches).toBe(4)
    expect(state.byKey[keyA]).toBe(4)
    expect(state.byKey[keyB]).toBeUndefined()
  })

  test("automatic progress grants remain usable after consumed user continuation", () => {
    const workflow = {
      id: "wf-auto-after-continuation",
      projectId: "project-test",
      revision: 0,
      anchor: "docs/anchors/test/anchor.md",
      createdBySession: "session",
      createdAt: "now",
      steps: [
        {
          id: "worker",
          agent: "worker",
          kind: "work" as const,
          dependsOn: [],
          status: "pending" as const,
        },
      ],
    }
    const state = newBudgetState()
    const key = "step:worker"

    for (const id of ["d1", "d2", "d3"]) {
      expect(
        recordDispatch({
          state,
          limits: DEFAULT_LIMITS,
          dispatchID: id,
          key,
          agent: "worker",
        }).allowed,
      ).toBe(true)
    }

    const continuation = continueWorkflowDispatchBudget({
      state,
      limits: DEFAULT_LIMITS,
      workflow,
      questions: [],
      stepId: "worker",
      grantedBy: "general",
      reason: "The user wants one more attempt despite no material progress yet.",
      confirmation: "give it one more try",
      authorizationUserMessageId: "user-one-more",
      now: "continued",
    })
    expect(continuation.allowed).toBe(true)
    expect(
      recordDispatch({
        state,
        limits: DEFAULT_LIMITS,
        dispatchID: "continued-1",
        key,
        agent: "worker",
      }).allowed,
    ).toBe(true)
    expect(state.continuations?.[0]?.usedDispatches).toBe(1)

    const progressGrant = grantWorkflowDispatchBudget({
      state,
      limits: DEFAULT_LIMITS,
      workflow,
      questions: [],
      stepId: "worker",
      grantedBy: "general",
      reason: "A changed strategy now justifies an automatic bounded retry.",
      progress: {
        newEvidence: false,
        changedHypothesis: false,
        changedStrategy: true,
        reducedUnresolved: false,
      },
      now: "material-progress",
    })
    expect(progressGrant.allowed).toBe(true)

    expect(
      recordDispatch({
        state,
        limits: DEFAULT_LIMITS,
        dispatchID: "automatic-after-continuation",
        key,
        agent: "worker",
      }).allowed,
    ).toBe(true)
    expect(state.byKey[key]).toBe(5)
    expect(state.continuations?.[0]?.usedDispatches).toBe(1)
  })

  test("reopen requires a material progress dimension", () => {
    expect(
      hasMaterialProgress({
        newEvidence: false,
        changedHypothesis: false,
        changedStrategy: false,
        reducedUnresolved: false,
      }),
    ).toBe(false)

    expect(
      hasMaterialProgress({
        newEvidence: true,
        changedHypothesis: false,
        changedStrategy: false,
        reducedUnresolved: false,
      }),
    ).toBe(true)
  })
})
