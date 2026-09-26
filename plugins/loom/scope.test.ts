import { describe, expect, test } from "bun:test"
import {
  committableWriteScope,
  mergeWriteScope,
  resourceMatchesScope,
  resourcesWithinScope,
  validateScopeElevation,
  validateWriteScope,
} from "./scope"

describe("Loom write scope", () => {
  test("accepts bounded starting paths, including an empty unknown Worker start", () => {
    expect(validateWriteScope([])).toEqual([])
    expect(
      validateWriteScope([
        "src/**",
        "package.json",
        "docs/requirements/**",
      ]),
    ).toEqual([
      "src/**",
      "package.json",
      "docs/requirements/**",
    ])
  })

  test("rejects repository-wide starting scope", () => {
    expect(() => validateWriteScope(["*"])).toThrow()
    expect(() => validateWriteScope(["**"])).toThrow()
  })

  test("rejects path escape from normal project-local scope", () => {
    expect(() => validateWriteScope(["../other/**"])).toThrow()
    expect(() => validateWriteScope(["/tmp/**"])).toThrow()
    expect(() => validateScopeElevation(["../other/**"])).toThrow()
    expect(() => validateScopeElevation(["/tmp/**"])).toThrow()
  })

  test("allows runtime elevation across prior role-default folders", () => {
    expect(
      validateScopeElevation([
        "src/**",
        "docs/architecture/runtime.md",
        "docs/requirements/behavior.md",
      ]),
    ).toEqual([
      "src/**",
      "docs/architecture/runtime.md",
      "docs/requirements/behavior.md",
    ])
  })

  test("merges runtime elevations into the effective scope", () => {
    expect(
      mergeWriteScope(
        ["src/main.go"],
        ["src/main.go", "src/api/**", "docs/requirements/runtime.md"],
      ),
    ).toEqual([
      "docs/requirements/runtime.md",
      "src/api/**",
      "src/main.go",
    ])
  })

  test("ephemeral reports never become committable product scope", () => {
    expect(
      committableWriteScope([
        "src/**",
        "ephemeral-reports/reviewer/**",
        "README.md",
      ]),
    ).toEqual(["src/**", "README.md"])
  })

  test("matches relative scope against normalized edit resources", () => {
    expect(resourceMatchesScope("src/app/main.go", "src/**")).toBe(true)
    expect(resourceMatchesScope("/workspace/project/src/app/main.go", "src/**")).toBe(true)
    expect(resourceMatchesScope("docs/requirements/x.md", "src/**")).toBe(false)
  })

  test("all edited resources must fit current scope", () => {
    expect(resourcesWithinScope(["src/a.go", "src/b.go"], ["src/**"])).toBe(true)
    expect(resourcesWithinScope(["src/a.go", "README.md"], ["src/**"])).toBe(false)
  })
})
