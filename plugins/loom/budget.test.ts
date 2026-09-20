import { describe, expect, test } from "bun:test"
import {
  DEFAULT_LIMITS,
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
