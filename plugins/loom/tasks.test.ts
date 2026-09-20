import { describe, expect, test } from "bun:test"
import { taskStepId, validateTaskPlan, writeScopesMayOverlap, type TaskSpec } from "./tasks"

function task(id: string, overrides: Partial<TaskSpec> = {}): TaskSpec {
  return {
    id,
    title: id,
    objective: "Implement " + id,
    dependsOn: [],
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

  test("parallel tasks may not overlap writes", () => {
    expect(
      writeScopesMayOverlap(["internal/routes/**"], ["internal/routes/parser/**"]),
    ).toBe(true)

    expect(() =>
      validateTaskPlan([
        task("routing", { write: ["internal/routes/**"] }),
        task("parser", { write: ["internal/routes/parser/**"] }),
      ]),
    ).toThrow()
  })

  test("overlapping writes are allowed when tasks are ordered", () => {
    const plan = validateTaskPlan([
      task("routing", { write: ["internal/routes/**"] }),
      task("parser", {
        dependsOn: ["routing"],
        write: ["internal/routes/parser/**"],
      }),
    ])
    expect(plan).toHaveLength(2)
  })

  test("requires explicit verification expectation", () => {
    expect(() => validateTaskPlan([task("api", { verify: [] })])).toThrow()
  })

  test("creates stable dynamic workflow step ids", () => {
    expect(taskStepId("youtube-auth")).toBe("task:youtube-auth")
  })
})
