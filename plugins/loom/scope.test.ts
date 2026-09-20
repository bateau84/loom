import { describe, expect, test } from "bun:test"
import { validateWriteScope } from "./scope"

describe("Loom worker write scopes", () => {
  test("accepts bounded product paths", () => {
    expect(validateWriteScope(["src/**", "package.json", "docs/system-map/**"])).toEqual([
      "src/**",
      "package.json",
      "docs/system-map/**",
    ])
  })

  test("rejects repository-wide write access", () => {
    expect(() => validateWriteScope(["*"])).toThrow()
    expect(() => validateWriteScope(["**"])).toThrow()
  })

  test("rejects accepted authority roots", () => {
    expect(() => validateWriteScope(["docs/requirements/**"])).toThrow()
    expect(() => validateWriteScope(["docs/architecture/foo.md"])).toThrow()
    expect(() => validateWriteScope(["docs/anchors/**"])).toThrow()
  })

  test("rejects path escape", () => {
    expect(() => validateWriteScope(["../other/**"])).toThrow()
    expect(() => validateWriteScope(["/tmp/**"])).toThrow()
  })
})
