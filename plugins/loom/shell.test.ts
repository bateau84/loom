import { describe, expect, test } from "bun:test"
import { isAllowedWorkerShell, scopedGofmtWriteTargets, shellResourcesAllowed } from "./shell"

describe("Loom Worker shell policy", () => {
  test("allows common inspection and verification commands", () => {
    for (const command of [
      "git status --short",
      "git diff --stat",
      "go test ./...",
      "go build ./...",
      "go mod graph",
      "gofmt -l cmd/leash/main.go internal/agentdefinition/definition.go",
      "gofmt -d internal/agentdefinition/definition.go",
      "gofmt internal/agentdefinition/definition.go",
      "bun test ./plugins/loom/workflow.test.ts",
      "bun run typecheck",
      "pytest -q",
      "cargo check",
      "rg TODO src",
      "rg 'foo|bar' src",
      "find src -name '*.go'",
    ]) {
      expect(isAllowedWorkerShell(command)).toBe(true)
    }
  })

  test("allows constrained Go environment prefixes", () => {
    const prefix =
      "GOTOOLCHAIN=local GOENV=off GOWORK=off CGO_ENABLED=0 GOPROXY=off GOVCS='*:off' GOFLAGS=-mod=readonly"

    expect(isAllowedWorkerShell(`${prefix} go list -m all`)).toBe(true)
    expect(isAllowedWorkerShell(`${prefix} go mod graph`)).toBe(true)
    expect(isAllowedWorkerShell("GOFLAGS='-mod=readonly -trimpath' go list ./...")).toBe(true)
  })

  test("allows known-safe Python and XDG environment prefixes", () => {
    expect(
      isAllowedWorkerShell(
        "PYTHONDONTWRITEBYTECODE=1 PYTHONNOUSERSITE=1 PYTHONUNBUFFERED=1 PYTHONUTF8=1 pytest -q",
      ),
    ).toBe(true)

    expect(
      isAllowedWorkerShell(
        "XDG_CACHE_HOME=/tmp/loom-cache XDG_STATE_HOME=/tmp/loom-state XDG_RUNTIME_DIR=/run/user/1000 pytest -q",
      ),
    ).toBe(true)
  })

  test("rejects unknown environment variables", () => {
    expect(isAllowedWorkerShell("FOO=bar ls -la")).toBe(false)
    expect(isAllowedWorkerShell("FOO='some value' cat README.md")).toBe(false)
    expect(isAllowedWorkerShell("FOO=bar go list ./...")).toBe(false)
    expect(isAllowedWorkerShell("FOO=bar go test ./...")).toBe(false)
  })

  test("rejects dangerous or invalid environment overrides", () => {
    for (const command of [
      "PATH=/tmp ls",
      "LD_PRELOAD=/tmp/evil.so ls",
      "PYTHONPATH=/tmp pytest -q",
      "NODE_OPTIONS=--require=/tmp/evil.js npm test",
      "XDG_CONFIG_HOME=/tmp/config go list ./...",
      "GOENV=/tmp/goenv go list ./...",
      "GOFLAGS=-toolexec=./evil go list ./...",
      "XDG_CACHE_HOME=../cache pytest -q",
      "XDG_CACHE_HOME='/tmp/cache;touch /tmp/pwn' pytest -q",
    ]) {
      expect(isAllowedWorkerShell(command)).toBe(false)
    }
  })

  test("rejects shell control syntax even without whitespace", () => {
    for (const command of [
      "cat README.md>/tmp/output",
      "cat README.md>>/tmp/output",
      "cat</etc/passwd",
      "go test ./...;rm -rf src",
      "rg foo src|xargs rm",
      "ls&touch /tmp/pwn",
      "ls<(touch /tmp/pwn)",
      "ls>(cat)",
      "ls\nrm -rf src",
    ]) {
      expect(isAllowedWorkerShell(command)).toBe(false)
    }
  })

  test("rejects shell expansion and process substitution in environment prefixes", () => {
    for (const command of [
      "XDG_CACHE_HOME=/tmp/cache>/tmp/output cat README.md",
      "XDG_CACHE_HOME=<(touch /tmp/pwn) pytest -q",
      "GOENV=$(touch /tmp/pwn) go list ./...",
      "GOENV=`touch /tmp/pwn` go list ./...",
      "GOENV=${HOME} go list ./...",
      "GOENV=\"$HOME\" go list ./...",
      "GOENV=off\\ value go list ./...",
    ]) {
      expect(isAllowedWorkerShell(command)).toBe(false)
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
        ["GOENV=off gofmt -w internal/agentdefinition/definition.go"],
        ["internal/agentdefinition/**"],
      ),
    ).toBe(true)

    expect(
      shellResourcesAllowed(
        ["FOO=bar gofmt -w internal/agentdefinition/definition.go"],
        ["internal/agentdefinition/**"],
      ),
    ).toBe(false)

    expect(
      shellResourcesAllowed(
        ["GOENV=off gofmt -w internal/agentdefinition/definition.go>/tmp/output"],
        ["internal/agentdefinition/**"],
      ),
    ).toBe(false)

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
    expect(scopedGofmtWriteTargets("GOENV=off gofmt -w -s a.go b.go")).toEqual(["a.go", "b.go"])
    expect(scopedGofmtWriteTargets("FOO=bar gofmt -w a.go")).toBeUndefined()
    expect(scopedGofmtWriteTargets("gofmt -w -r 'x -> y' a.go")).toBeUndefined()
    expect(scopedGofmtWriteTargets("gofmt -w a.go && rm -rf .")).toBeUndefined()
    expect(scopedGofmtWriteTargets("gofmt -w a.go>/tmp/output")).toBeUndefined()
    expect(scopedGofmtWriteTargets("gofmt -w /tmp/a.go")).toBeUndefined()
  })

  test("all scanner-produced command resources must be safe", () => {
    expect(shellResourcesAllowed(["git status --short", "go test ./..."])).toBe(true)
    expect(shellResourcesAllowed(["git status --short", "rm -rf src"])).toBe(false)
  })
})
