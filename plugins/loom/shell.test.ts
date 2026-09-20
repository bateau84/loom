import { describe, expect, test } from "bun:test"
import { isAllowedWorkerShell, scopedGofmtWriteTargets, shellResourcesAllowed } from "./shell"

describe("Loom Worker shell policy", () => {
  test("allows common inspection and verification commands", () => {
    for (const command of [
      "git status --short",
      "git diff --stat",
      "go test ./...",
      "go build ./...",
      "gofmt -l cmd/leash/main.go internal/agentdefinition/definition.go",
      "gofmt -d internal/agentdefinition/definition.go",
      "gofmt internal/agentdefinition/definition.go",
      "bun test ./plugins/loom/workflow.test.ts",
      "bun run typecheck",
      "pytest -q",
      "cargo check",
      "rg TODO src",
      "find src -name '*.go'",
    ]) {
      expect(isAllowedWorkerShell(command)).toBe(true)
    }
  })

  test("rejects chaining and redirection", () => {
    expect(isAllowedWorkerShell("go test ./... && rm -rf src")).toBe(false)
    expect(isAllowedWorkerShell("cat file > other")).toBe(false)
    expect(isAllowedWorkerShell("rg foo src | xargs rm")).toBe(false)
  })

  test("rejects common write modes", () => {
    expect(isAllowedWorkerShell("eslint --fix src")).toBe(false)
    expect(isAllowedWorkerShell("ruff check --fix .")).toBe(false)
    expect(isAllowedWorkerShell("gofmt -w main.go")).toBe(false)
    expect(isAllowedWorkerShell("find src -delete")).toBe(false)
  })

  test("rejects arbitrary shell and dependency mutation commands", () => {
    expect(isAllowedWorkerShell("rm -rf src")).toBe(false)
    expect(isAllowedWorkerShell("sed -i s/a/b/ file")).toBe(false)
    expect(isAllowedWorkerShell("npm install foo")).toBe(false)
    expect(isAllowedWorkerShell("python -c 'open(\"x\", \"w\").write(\"y\")'")).toBe(false)
  })

  test("allows gofmt -w only inside the declared Worker write scope", () => {
    expect(isAllowedWorkerShell("gofmt -w internal/agentdefinition/definition.go")).toBe(false)

    expect(
      shellResourcesAllowed(
        ["gofmt -w internal/agentdefinition/definition.go cmd/leash/main.go"],
        ["internal/agentdefinition/**", "cmd/leash/**"],
      ),
    ).toBe(true)

    expect(
      shellResourcesAllowed(
        ["gofmt -w internal/agentdefinition/definition.go docs/architecture/leash-v1/index.md"],
        ["internal/agentdefinition/**"],
      ),
    ).toBe(false)

    expect(
      shellResourcesAllowed(
        ["gofmt -w internal/agentdefinition/definition.go ../other/file.go"],
        ["internal/agentdefinition/**"],
      ),
    ).toBe(false)

    expect(
      shellResourcesAllowed(
        ["gofmt -w internal/agentdefinition/*.go"],
        ["internal/agentdefinition/**"],
      ),
    ).toBe(false)
  })

  test("parses only conservative gofmt write forms", () => {
    expect(scopedGofmtWriteTargets("gofmt -w -s a.go b.go")).toEqual(["a.go", "b.go"])
    expect(scopedGofmtWriteTargets("gofmt -w -r 'x -> y' a.go")).toBeUndefined()
    expect(scopedGofmtWriteTargets("gofmt -w a.go && rm -rf .")).toBeUndefined()
    expect(scopedGofmtWriteTargets("gofmt -w /tmp/a.go")).toBeUndefined()
  })

  test("all scanner-produced command resources must be safe", () => {
    expect(shellResourcesAllowed(["git status --short", "go test ./..."])).toBe(true)
    expect(shellResourcesAllowed(["git status --short", "rm -rf src"])).toBe(false)
  })
})
