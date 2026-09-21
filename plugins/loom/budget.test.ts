import { describe, expect, test } from "bun:test"
import {
  DEFAULT_LIMITS,
  grantExtraDispatch,
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
          agent: "critic",
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

  test("bounded grants apply to gate-owning agents as well as workers", () => {
    const cases = [
      { agent: "reviewer", base: DEFAULT_LIMITS.maxReviewerDispatchesPerStep },
      { agent: "critic", base: DEFAULT_LIMITS.maxCriticDispatchesPerStep },
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
