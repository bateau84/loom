import { describe, expect, test } from "bun:test"
import { loomPlanningInsights, projectPlanningInsights } from "./planning-insights"
import { validatePlanRoleFeasibility, type WorkPlanDefinition } from "./work"

describe("separate Loom planning advice", () => {
  test("only exact live names receive advice; missing and stale entries do not become a roster", () => {
    const live = ["worker", "ordinary-helper", "Planner", "toString"]
    const advice = {
      worker: { nativeWork: "Implement", caution: "Check authority", permission: "allow" },
      stale: { nativeWork: "Removed agent", caution: "Not installed" },
    }
    expect(projectPlanningInsights(live, advice).hints).toEqual([
      { name: "worker", nativeWork: "Implement", caution: "Check authority" },
    ])
    expect(live).toEqual(["worker", "ordinary-helper", "Planner", "toString"])
    for (const absent of [undefined, null, {}, [], "bad registry", 42]) {
      expect(projectPlanningInsights(live, absent).hints).toEqual([])
    }
  })

  test("malformed advice is omitted, not coerced into routing or permission metadata", () => {
    for (const malformed of [null, [], "work", {}, { nativeWork: 1, caution: "Limit" },
      { nativeWork: "Work", caution: false }, { nativeWork: " ", caution: "Limit" }]) {
      expect(projectPlanningInsights(["worker", "ordinary-helper"], { worker: malformed }).hints).toEqual([])
    }
  })

  test("advice is bounded independently of descriptions and cannot match a truncated name", () => {
    const longName = "n".repeat(129)
    const entry = { nativeWork: "w".repeat(1_100), caution: "c".repeat(1_100) }
    const names = Array.from({ length: 205 }, (_, index) => `agent-${index}`)
    const advice = Object.fromEntries(names.map((name) => [name, entry]))
    const projected = projectPlanningInsights(names, advice)
    expect(projected.hints).toHaveLength(200)
    expect(projected.hints[0]?.nativeWork).toHaveLength(1_000)
    expect(projected.hints[0]?.caution).toHaveLength(1_000)
    expect(projectPlanningInsights([longName], { [longName]: entry }).hints).toEqual([])
  })

  test("native-work advice does not enable unsupported planned roles", () => {
    for (const role of ["brainstorm", "planner", "critic", "acceptance"]) {
      const insights = loomPlanningInsights([role])
      expect(insights.advisoryOnly).toBe(true)
      expect(insights.hints[0]?.caution).toContain("Advisory OQs")
      const plan: WorkPlanDefinition = {
        goal: "Bounded native work", assumptions: [], outOfScope: [], authorityRefs: ["anchor"],
        obligations: [], riskBoundaries: [], acceptanceCoverage: [], relationships: [], correctionRouting: [],
        phases: [{ id: "phase", title: "Phase", objective: "Native work", waves: [{
          id: "wave", title: "Wave", objective: "Native work", constraints: [], tasks: [{
            id: "native", title: "Native", objective: "Native work", rationale: "Assigned authority",
            dependsOn: [], authorityRefs: ["anchor"], constraints: [], acceptanceCriteria: ["Real result"],
            subtasks: [], integration: [], verify: [], role, responsibility: "produce",
          }],
        }] }],
      }
      expect(() => validatePlanRoleFeasibility(plan)).toThrow(`role ${role} has no supported Task execution slot`)
    }
  })
})
