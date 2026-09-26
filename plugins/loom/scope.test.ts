import { describe, expect, test } from "bun:test"
import { resourceMatchesScope, resourcesWithinScope, validateStepWriteScope, validateWriteScope } from "./scope"

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
    expect(() => validateWriteScope(["docs/design/**"])).toThrow()
    expect(() => validateWriteScope(["docs/architecture/foo.md"])).toThrow()
    expect(() => validateWriteScope(["docs/anchors/**"])).toThrow()
  })

  test("rejects path escape", () => {
    expect(() => validateWriteScope(["../other/**"])).toThrow()
    expect(() => validateWriteScope(["/tmp/**"])).toThrow()
  })

  test("matches relative scope against normalized edit resources", () => {
    expect(resourceMatchesScope("src/app/main.go", "src/**")).toBe(true)
    expect(resourceMatchesScope("/workspace/project/src/app/main.go", "src/**")).toBe(true)
    expect(resourceMatchesScope("docs/requirements/x.md", "src/**")).toBe(false)
  })

  test("all edited resources must fit declared scope", () => {
    expect(resourcesWithinScope(["src/a.go", "src/b.go"], ["src/**"])).toBe(true)
    expect(resourcesWithinScope(["src/a.go", "README.md"], ["src/**"])).toBe(false)
  })
})

describe("Loom specialist step write scopes", () => {
  const specifierCeiling = ["docs/requirements/**"]

  test("allows exact files and bounded subpaths inside the role ceiling", () => {
    expect(validateStepWriteScope(
      ["docs/requirements/feature/br-050.md", "docs/requirements/feature/**"],
      specifierCeiling,
    )).toEqual([
      "docs/requirements/feature/br-050.md",
      "docs/requirements/feature/**",
    ])
  })

  test("cannot expand the role ceiling", () => {
    expect(() => validateStepWriteScope(["src/**"], specifierCeiling)).toThrow(
      "may narrow role authority but cannot grant",
    )
    expect(() => validateStepWriteScope(["docs/architecture/**"], specifierCeiling)).toThrow()
  })

  test("keeps the same bounded and project-relative floor", () => {
    expect(() => validateStepWriteScope(["**"], specifierCeiling)).toThrow()
    expect(() => validateStepWriteScope(["../docs/requirements/**"], specifierCeiling)).toThrow()
  })

  test("supports exact-file role ceilings", () => {
    expect(validateStepWriteScope(["README.md"], ["README.md"])).toEqual(["README.md"])
    expect(() => validateStepWriteScope(["README.md/**"], ["README.md"])).toThrow()
  })
})
