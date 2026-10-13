import { describe, expect, test } from "bun:test"
import {
  acceptanceReadiness,
  createAcceptancePlan,
  recordAcceptanceResult,
  resetAcceptance,
} from "./acceptance"
import type { EvidenceClaim } from "./evidence"

function claim(id: string, kind: EvidenceClaim["kind"] = "product-acceptance"): EvidenceClaim {
  return {
    id,
    workflowId: "workflow-1",
    stepId: "product-acceptance",
    byAgent: "acceptance",
    kind,
    statement: "scenario exercised real product path",
    observationIds: ["obs-1"],
    createdAt: "now",
  }
}

describe("Loom Product Acceptance", () => {
  test("native Task-bound scenarios use the actual gate id and invalidate on reopen", () => {
    const plan = createAcceptancePlan({
      workflowId: "workflow-1", stepId: "task:accept", stepAttempt: 2,
      createdBy: "acceptance", now: "now",
      scenarios: [{ id: "SC-001", title: "Product route", criteria: ["Integrated product route works"] }],
    })
    const evidence = { ...claim("claim-1"), stepId: "task:accept", attempt: 2 }
    expect(() => recordAcceptanceResult({
      plan, scenarioId: "SC-001", stepId: "product-acceptance",
      outcome: "passed", claims: [evidence], byAgent: "acceptance", note: "tested", now: "later",
    })).toThrow("product-acceptance step")
    recordAcceptanceResult({
      plan, scenarioId: "SC-001", stepId: "task:accept",
      outcome: "passed", claims: [evidence], byAgent: "acceptance", note: "tested", now: "later",
    })
    expect(acceptanceReadiness(plan)).toBe("passed")
    resetAcceptance(plan, 3)
    expect(plan.stepId).toBe("task:accept")
    expect(plan.stepAttempt).toBe(3)
    expect(acceptanceReadiness(plan)).toBe("pending")
    expect(plan.scenarios[0]?.evidenceClaimIds).toEqual([])
  })

  test("requires scenarios mapped to accepted criteria", () => {
    expect(() =>
      createAcceptancePlan({
        workflowId: "workflow-1",
        createdBy: "acceptance",
        scenarios: [{ id: "login", title: "Login", criteria: [] }],
        now: "now",
      }),
    ).toThrow()
  })

  test("passing scenario requires product-acceptance evidence", () => {
    const plan = createAcceptancePlan({
      workflowId: "workflow-1",
      createdBy: "acceptance",
      scenarios: [{ id: "login", title: "Login", criteria: ["User can authenticate"] }],
      now: "now",
    })

    expect(() =>
      recordAcceptanceResult({
        plan,
        scenarioId: "login",
        outcome: "passed",
        claims: [],
        byAgent: "acceptance",
        note: "looked good",
        now: "later",
      }),
    ).toThrow()

    expect(() =>
      recordAcceptanceResult({
        plan,
        scenarioId: "login",
        outcome: "passed",
        claims: [claim("c1", "test")],
        byAgent: "acceptance",
        note: "unit test only",
        now: "later",
      }),
    ).toThrow()
  })

  test("scenario result cannot be overwritten without reset", () => {
    const plan = createAcceptancePlan({
      workflowId: "workflow-1",
      createdBy: "acceptance",
      scenarios: [{ id: "login", title: "Login", criteria: ["User can authenticate"] }],
      now: "now",
    })

    recordAcceptanceResult({
      plan,
      scenarioId: "login",
      outcome: "failed",
      claims: [],
      byAgent: "acceptance",
      note: "failed",
      now: "later",
    })

    expect(() =>
      recordAcceptanceResult({
        plan,
        scenarioId: "login",
        outcome: "passed",
        claims: [claim("c1")],
        byAgent: "acceptance",
        note: "changed mind",
        now: "later2",
      }),
    ).toThrow()
  })

  test("all scenarios must pass for Product Acceptance readiness", () => {
    const plan = createAcceptancePlan({
      workflowId: "workflow-1",
      createdBy: "acceptance",
      scenarios: [
        { id: "login", title: "Login", criteria: ["User can authenticate"] },
        { id: "route", title: "Route", criteria: ["Video reaches playlist"] },
      ],
      now: "now",
    })

    recordAcceptanceResult({
      plan,
      scenarioId: "login",
      outcome: "passed",
      claims: [claim("c1")],
      byAgent: "acceptance",
      note: "passed",
      now: "later",
    })
    expect(acceptanceReadiness(plan)).toBe("pending")

    recordAcceptanceResult({
      plan,
      scenarioId: "route",
      outcome: "passed",
      claims: [claim("c2")],
      byAgent: "acceptance",
      note: "passed",
      now: "later",
    })
    expect(acceptanceReadiness(plan)).toBe("passed")
  })

  test("failed and unproven outcomes block readiness", () => {
    const plan = createAcceptancePlan({
      workflowId: "workflow-1",
      createdBy: "acceptance",
      scenarios: [{ id: "route", title: "Route", criteria: ["Video reaches playlist"] }],
      now: "now",
    })

    recordAcceptanceResult({
      plan,
      scenarioId: "route",
      outcome: "unproven",
      claims: [],
      byAgent: "acceptance",
      note: "provider unavailable",
      now: "later",
    })
    expect(acceptanceReadiness(plan)).toBe("unproven")
  })

  test("reset invalidates previous acceptance after upstream change", () => {
    const plan = createAcceptancePlan({
      workflowId: "workflow-1",
      createdBy: "acceptance",
      scenarios: [{ id: "route", title: "Route", criteria: ["Video reaches playlist"] }],
      now: "now",
    })
    recordAcceptanceResult({
      plan,
      scenarioId: "route",
      outcome: "passed",
      claims: [claim("c1")],
      byAgent: "acceptance",
      note: "passed",
      now: "later",
    })

    resetAcceptance(plan)
    expect(acceptanceReadiness(plan)).toBe("pending")
    expect(plan.scenarios[0]?.evidenceClaimIds).toEqual([])
  })
})
