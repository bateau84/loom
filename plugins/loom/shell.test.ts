import { describe, expect, test } from "bun:test"
import {
  authorGitShellResourcesAllowed,
  diagnosticExecutionShellResourcesAllowed,
  diagnosticShellResourcesAllowed,
  isAllowedGitCommit,
  isAllowedWorkerShell,
  scopedGitAddTargets,
  scopedGofmtWriteTargets,
  shellResourcesAllowed,
  workerShellResourcesAllowed,
} from "./shell"

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
      "GOFLAGS=-buildvcs=true go list ./...",
      "CGO_ENABLED=1 go list ./...",
      "GOPROXY=https://proxy.example go list ./...",
      "GOPROXY=direct go list ./...",
      "GOVCS='*:all' go list ./...",
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

  test("lets Diagnostic execute bounded project code and inspect PR/CI state without delivery mutation", () => {
    for (const command of [
      "go test ./...",
      "go build ./...",
      "pytest -q",
      "python3 -m pytest -q",
      "gh pr checks 123",
      "gh run view 456 --log-failed",
      "gh run watch 456",
    ]) {
      expect(diagnosticShellResourcesAllowed([command])).toBe(true)
    }

    expect(
      diagnosticExecutionShellResourcesAllowed([
        "go run ./cmd/debug",
        "python scripts/reproduce.py --case timeout",
        "gh run view 456 --log-failed",
      ]),
    ).toBe(true)

    for (const command of [
      "go run ./cmd/debug",
      "python scripts/reproduce.py --case timeout",
      "python3 -m app.debug",
      "python -c 'open(\"x\", \"w\").write(\"y\")'",
      "python -m pip install requests",
      "git commit -m 'diagnostic write'",
      "gh run rerun 456 --failed",
      "gh pr create --title change --body change",
    ]) {
      expect(diagnosticShellResourcesAllowed([command])).toBe(false)
    }
  })

  test("lets Worker own the normal bounded delivery lifecycle", () => {
    const scope = ["src/**", "cmd/**"]

    for (const command of [
      "go run ./cmd/app",
      "python scripts/reproduce.py",
      "git fetch origin main",
      "git rebase origin/main",
      "git rebase --continue",
      "git push origin HEAD",
      "git push --force-with-lease origin HEAD",
      "gh pr create --title 'Fix runtime' --body 'Bounded change'",
      "gh pr edit --body 'Updated'",
    ]) {
      expect(workerShellResourcesAllowed([command], scope)).toBe(true)
    }

    expect(workerShellResourcesAllowed(["gofmt -w src/runtime.go"], scope)).toBe(true)
    expect(workerShellResourcesAllowed(["git add src/runtime.ts cmd/app/main.go"], scope)).toBe(true)
    expect(workerShellResourcesAllowed(["git add docs/requirements/runtime.md"], scope)).toBe(false)
    expect(workerShellResourcesAllowed(["git add ."], scope)).toBe(false)
    expect(workerShellResourcesAllowed(["git commit -m 'fix: runtime'"], scope)).toBe(true)
    expect(workerShellResourcesAllowed(["git commit -a -m 'fix: runtime'"], scope)).toBe(false)
    expect(workerShellResourcesAllowed(["git commit --amend --no-edit"], scope)).toBe(false)
    expect(workerShellResourcesAllowed(["git commit --no-verify -m 'fix: runtime'"], scope)).toBe(false)
    expect(workerShellResourcesAllowed(["git push --force origin HEAD"], scope)).toBe(false)
    expect(workerShellResourcesAllowed(["git push origin :main"], scope)).toBe(false)
    expect(workerShellResourcesAllowed(["git push origin main"], scope)).toBe(false)
    expect(workerShellResourcesAllowed(["git fetch ext::helper"], scope)).toBe(false)
    expect(workerShellResourcesAllowed(["git rebase --exec 'touch pwn' origin/main"], scope)).toBe(false)
    expect(workerShellResourcesAllowed(["git rebase --strategy=ours origin/main"], scope)).toBe(false)
    expect(workerShellResourcesAllowed(["gh pr edit 123 --body 'other PR'"], scope)).toBe(false)
    expect(workerShellResourcesAllowed(["gh pr create --head other --title x --body y"], scope)).toBe(false)
    expect(workerShellResourcesAllowed(["gh pr create --repo other/repo --title x --body y"], scope)).toBe(false)
    expect(workerShellResourcesAllowed(["gh pr create --body-file /etc/passwd --title x"], scope)).toBe(false)
    expect(workerShellResourcesAllowed(["gh pr create --template ../../secret.md --title x"], scope)).toBe(false)
    expect(workerShellResourcesAllowed(["gh pr edit --body-file /etc/passwd"], scope)).toBe(false)
    expect(workerShellResourcesAllowed(["gh run rerun 456 --failed"], scope)).toBe(false)
    expect(workerShellResourcesAllowed(["gh pr merge 123"], scope)).toBe(false)
  })

  test("lets durable artifact authors stage and commit only their owned files", () => {
    const designScope = ["docs/design/**"]

    expect(authorGitShellResourcesAllowed(["git add docs/design/runtime.md"], designScope)).toBe(true)
    expect(authorGitShellResourcesAllowed(["git add -- docs/design/runtime.md"], designScope)).toBe(true)
    expect(authorGitShellResourcesAllowed(["git commit -m 'docs(design): runtime'"], designScope)).toBe(true)
    expect(authorGitShellResourcesAllowed(["git add docs/requirements/runtime.md"], designScope)).toBe(false)
    expect(authorGitShellResourcesAllowed(["git add ."], designScope)).toBe(false)
    expect(authorGitShellResourcesAllowed(["git commit -a -m 'docs: all'"], designScope)).toBe(false)
    expect(authorGitShellResourcesAllowed(["git rebase main"], designScope)).toBe(false)

    expect(scopedGitAddTargets("git add docs/design/a.md docs/design/b.md")).toEqual([
      "docs/design/a.md",
      "docs/design/b.md",
    ])
    expect(scopedGitAddTargets("git add ../outside.md")).toBeUndefined()
    expect(isAllowedGitCommit("git commit -m 'docs: update'")).toBe(true)
    expect(isAllowedGitCommit("git commit --amend --no-edit")).toBe(false)
    expect(isAllowedGitCommit("git commit --no-verify -m 'docs: update'")).toBe(false)
    expect(isAllowedGitCommit("git commit -a -m 'all'")).toBe(false)
  })


})
