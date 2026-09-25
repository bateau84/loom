import { describe, expect, test } from "bun:test"
import { taskStepId, validateTaskPlan, type TaskSpec } from "./tasks"

function task(id: string, overrides: Partial<TaskSpec> = {}): TaskSpec {
  return {
    id,
    title: id,
    objective: "Implement " + id,
    rationale: `Task ${id} is required by the accepted plan.`,
    dependsOn: [],
    authorityRefs: ["docs/architecture/example.md"],
    constraints: [],
    acceptanceCriteria: [`${id} behaves as specified`],
    subtasks: [],
    integration: [],
    write: [`internal/${id}/**`],
    skills: ["golang"],
    verify: ["go test ./..."],
    ...overrides,
  }
}

describe("Loom task graph", () => {
  test("accepts independent bounded tasks", () => {
    const plan = validateTaskPlan([task("api"), task("ui")])
    expect(plan.map((item) => item.id)).toEqual(["api", "ui"])
  })

  test("bounds task identifiers used in model-facing Plan maps", () => {
    expect(() => validateTaskPlan([task("a".repeat(97))]))
      .toThrow("Task id exceeds maximum of 96 characters")
  })

  test("rejects cycles", () => {
    expect(() =>
      validateTaskPlan([
        task("api", { dependsOn: ["ui"] }),
        task("ui", { dependsOn: ["api"] }),
      ]),
    ).toThrow()
  })

  test("rejects unknown dependencies", () => {
    expect(() => validateTaskPlan([task("api", { dependsOn: ["missing"] })])).toThrow()
  })

  test("rejects unbounded and authority write scopes", () => {
    expect(() => validateTaskPlan([task("api", { write: ["**"] })])).toThrow()
    expect(() => validateTaskPlan([task("api", { write: ["docs/architecture/**"] })])).toThrow()
  })

  test("parallel tasks may share write scope because runtime writes are serialized", () => {
    const plan = validateTaskPlan([
      task("routing", { write: ["internal/routes/**"] }),
      task("parser", { write: ["internal/routes/parser/**"] }),
    ])
    expect(plan).toHaveLength(2)
  })

  test("dependency ordering remains valid when write scopes overlap", () => {
    const plan = validateTaskPlan([
      task("routing", { write: ["internal/routes/**"] }),
      task("parser", {
        dependsOn: ["routing"],
        write: ["internal/routes/parser/**"],
      }),
    ])
    expect(plan).toHaveLength(2)
  })

  test("requires semantic task context and explicit verification", () => {
    expect(() => validateTaskPlan([task("api", { rationale: "" })])).toThrow()
    expect(() => validateTaskPlan([task("api", { authorityRefs: [] })])).toThrow()
    expect(() => validateTaskPlan([task("api", { acceptanceCriteria: [] })])).toThrow()
    expect(() => validateTaskPlan([task("api", { verify: [] })])).toThrow()
  })

  test("creates stable dynamic workflow step ids", () => {
    expect(taskStepId("youtube-auth")).toBe("task:youtube-auth")
  })
})
