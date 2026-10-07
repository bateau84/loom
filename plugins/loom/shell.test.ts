import { describe, expect, test } from "bun:test"
import {
  authorGitShellResourcesAllowed,
  butlerCommitSourceIds,
  diagnosticExecutionShellResourcesAllowed,
  diagnosticShellResourcesAllowed,
  isAllowedButlerCommit,
  isAllowedGitCommit,
  isAllowedWorkerShell,
  isGitInspectionShellCommand,
  isGitShellCommand,
  isButlerCommitShellCommand,
  isButlerInspectionShellCommand,
  isButlerShellCommand,
  isGitAuthoringShellCommand,
  scopedGitAddTargets,
  scopedGofmtWriteTargets,
  shellResourcesAllowed,
  workerShellResourcesAllowed,
} from "./shell"

describe("Loom Worker shell policy", () => {

  test("allows universal read-only Git inspection and rejects mutation-shaped or escaping forms", () => {
    for (const command of [
      "git status --short",
      "git diff --stat",
      "git --no-pager log --oneline -20",
      "git show HEAD",
      "git rev-parse --show-toplevel",
      "git grep TODO",
      "git ls-files",
      "git blame src/runtime.ts",
      "git shortlog -sn",
      "git describe --always --dirty",
      "git merge-base HEAD origin/main",
      "git name-rev HEAD",
      "git ls-tree -r HEAD",
      "git branch --show-current",
      "git remote -v",
      "git tag --list",
    ]) {
      expect(isGitShellCommand(command)).toBe(true)
      expect(isGitInspectionShellCommand(command)).toBe(true)
      expect(isAllowedWorkerShell(command)).toBe(true)
    }

    for (const command of [
      "git reset --hard HEAD",
      "git checkout main",
      "git restore .",
      "git clean -fd",
      "git branch -D feature",
      "git remote set-url origin https://example.invalid/repo",
      "git tag v1",
      "git diff --output=diff.txt",
      "git diff --no-index /etc/passwd README.md",
      "git show --ext-diff HEAD",
      "git log --output history.txt",
      "git grep --open-files-in-pager=cat TODO",
      "git -C ../other status",
      "git -c core.pager=cat log",
    ]) {
      expect(isGitInspectionShellCommand(command)).toBe(false)
    }
  })


  test("allows Butler inspection commands but keeps mutations classified", () => {
    for (const command of [
      "but status",
      "but --json status -fv",
      "but diff",
      "but diff qs:5",
      "but show abc",
      "but branch",
      "but branch list -r",
      "but branch show feature",
      "but oplog",
      "but oplog list --since abc",
      "but pull --check",
      "but push feature --dry-run",
      "but commit --help",
    ]) {
      expect(isButlerShellCommand(command)).toBe(true)
      expect(isButlerInspectionShellCommand(command)).toBe(true)
    }

    for (const command of [
      "but pull",
      "but push feature",
      "but branch new feature",
      "but discard qs:5",
      "but squash a -t b -m 'combine'",
      "but pr new feature -t",
    ]) {
      expect(isButlerShellCommand(command)).toBe(true)
      expect(isButlerInspectionShellCommand(command)).toBe(false)
    }

    expect(isButlerShellCommand("but -C ../other status")).toBe(false)
  })

  test("admits only explicit selected-ID Butler commits with messages", () => {
    expect(
      butlerCommitSourceIds(
        "but commit -b feature -m 'fix(runtime): preserve ownership' qs uo",
      ),
    ).toEqual(["qs", "uo"])
    expect(
      butlerCommitSourceIds(
        "but --json commit --above abc -m 'feat: one' -m 'Verification: pass' qs",
      ),
    ).toEqual(["qs"])

    expect(
      isAllowedButlerCommit("but commit -b feature -m 'fix: scoped' qs"),
    ).toBe(true)
    expect(isButlerCommitShellCommand("but commit -m 'fix: scoped' qs")).toBe(true)

    for (const command of [
      "but commit -b feature -m 'fix: partial' qs:5",
      "but commit -b feature -m 'fix: broad' zz",
      "but commit -b feature -m 'fix: broad'",
      "but commit -b feature qs:5",
      "but commit --empty -b feature -m 'chore: marker'",
      "but commit -i -m 'fix: interactive'",
      "but commit --no-message qs:5",
      "but commit -b feature -m 'fix: scoped' qs:5 && but commit -b feature -m 'test: scoped' uo",
      "but -C ../other commit -b feature -m 'fix: scoped' qs:5",
    ]) {
      expect(isAllowedButlerCommit(command)).toBe(false)
    }
  })

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

  test("keeps git diff inspection read-only", () => {
    expect(isAllowedWorkerShell("git diff --cached --check")).toBe(true)
    expect(isAllowedWorkerShell("git diff --cached --stat")).toBe(true)
    expect(isAllowedWorkerShell("git diff --output=diff.txt")).toBe(false)
    expect(isAllowedWorkerShell("git diff --output diff.txt")).toBe(false)
    expect(isAllowedWorkerShell("git diff --ext-diff")).toBe(false)
    expect(isAllowedWorkerShell("git diff --textconv")).toBe(false)
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
    ]) {
      expect(workerShellResourcesAllowed([command], scope)).toBe(true)
    }

    expect(workerShellResourcesAllowed(["gofmt -w src/runtime.go"], scope)).toBe(true)
    expect(workerShellResourcesAllowed(["git add src/runtime.ts cmd/app/main.go"], scope)).toBe(true)
    expect(workerShellResourcesAllowed(["git add docs/requirements/runtime.md"], scope)).toBe(false)
    expect(workerShellResourcesAllowed(["git add ."], scope)).toBe(false)
    expect(
      workerShellResourcesAllowed(
        ["git -c core.hooksPath=/dev/null commit -m 'fix: runtime'"],
        scope,
      ),
    ).toBe(true)
    expect(
      workerShellResourcesAllowed(
        [
          "git -c core.hooksPath=/dev/null commit -F ephemeral-reports/worker/commit-messages/runtime.md",
        ],
        scope,
      ),
    ).toBe(true)
    expect(workerShellResourcesAllowed(["git commit -m 'fix: runtime'"], scope)).toBe(false)
    expect(
      workerShellResourcesAllowed(
        ["git -c core.hooksPath=/dev/null commit -F docs/runtime.md"],
        scope,
      ),
    ).toBe(false)
    expect(
      workerShellResourcesAllowed(
        [
          "git -c core.hooksPath=/dev/null commit -F ephemeral-reports/worker/commit-messages/nested/runtime.md",
        ],
        scope,
      ),
    ).toBe(false)
    expect(
      workerShellResourcesAllowed(
        [
          "git -c core.hooksPath=/dev/null commit -F ephemeral-reports/worker/commit-messages/runtime.txt",
        ],
        scope,
      ),
    ).toBe(false)
    expect(
      workerShellResourcesAllowed(
        [
          "git -c core.hooksPath=/dev/null commit -m 'fix: runtime' -F ephemeral-reports/worker/commit-messages/runtime.md",
        ],
        scope,
      ),
    ).toBe(false)
    expect(
      workerShellResourcesAllowed(
        ["git -c core.hooksPath=/dev/null commit -a -m 'fix: runtime'"],
        scope,
      ),
    ).toBe(false)
    expect(
      workerShellResourcesAllowed(
        ["git -c core.hooksPath=/dev/null commit --amend --no-edit"],
        scope,
      ),
    ).toBe(false)
    expect(workerShellResourcesAllowed(["git push --force origin HEAD"], scope)).toBe(false)
    expect(workerShellResourcesAllowed(["git push origin :main"], scope)).toBe(false)
    expect(workerShellResourcesAllowed(["git push origin main"], scope)).toBe(false)
    expect(workerShellResourcesAllowed(["git fetch ext::helper"], scope)).toBe(false)
    expect(workerShellResourcesAllowed(["git rebase --exec 'touch pwn' origin/main"], scope)).toBe(false)
    expect(workerShellResourcesAllowed(["git rebase --strategy=ours origin/main"], scope)).toBe(false)
    expect(workerShellResourcesAllowed(["gh pr edit --body 'Updated'"], scope)).toBe(false)
    expect(workerShellResourcesAllowed(["gh pr edit 123 --body 'other PR'"], scope)).toBe(false)
    expect(workerShellResourcesAllowed(["gh pr edit --body 'other PR' 123"], scope)).toBe(false)
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
    expect(
      authorGitShellResourcesAllowed(
        [
          "git add docs/design/runtime.md && git diff --cached --check && git diff --cached --stat && git diff --cached",
        ],
        designScope,
      ),
    ).toBe(true)
    expect(
      authorGitShellResourcesAllowed(
        [
          "git -c core.hooksPath=/dev/null add -- docs/design/runtime.md && git diff --cached --check",
        ],
        designScope,
      ),
    ).toBe(true)
    expect(
      authorGitShellResourcesAllowed(
        [
          "git add docs/design/runtime.md",
          "git diff --cached --stat",
          "git status --short",
        ],
        designScope,
      ),
    ).toBe(true)
    expect(
      authorGitShellResourcesAllowed(
        ["git -c core.hooksPath=/dev/null commit -m 'docs(design): runtime'"],
        designScope,
      ),
    ).toBe(true)
    expect(
      authorGitShellResourcesAllowed(
        [
          "git -c core.hooksPath=/dev/null commit -F ephemeral-reports/designer/commit-messages/runtime.md",
        ],
        designScope,
      ),
    ).toBe(true)
    expect(authorGitShellResourcesAllowed(["git commit -m 'docs(design): runtime'"], designScope)).toBe(false)
    expect(authorGitShellResourcesAllowed(["git add docs/requirements/runtime.md"], designScope)).toBe(false)
    expect(authorGitShellResourcesAllowed(["git add ."], designScope)).toBe(false)
    expect(
      authorGitShellResourcesAllowed(
        ["git -c core.hooksPath=/dev/null commit -a -m 'docs: all'"],
        designScope,
      ),
    ).toBe(false)
    expect(authorGitShellResourcesAllowed(["git rebase main"], designScope)).toBe(false)

    expect(scopedGitAddTargets("git add docs/design/a.md docs/design/b.md")).toEqual([
      "docs/design/a.md",
      "docs/design/b.md",
    ])
    expect(
      scopedGitAddTargets(
        "git add docs/design/a.md docs/design/b.md && git diff --cached --stat && git diff --cached",
      ),
    ).toEqual([
      "docs/design/a.md",
      "docs/design/b.md",
    ])
    expect(
      scopedGitAddTargets(
        "git -c core.hooksPath=/dev/null add -- docs/design/a.md && git diff --cached --check",
      ),
    ).toEqual(["docs/design/a.md"])
    expect(
      isGitAuthoringShellCommand(
        "git -c core.hooksPath=/dev/null add -- docs/design/a.md && git diff --cached --stat",
      ),
    ).toBe(true)
    expect(isGitAuthoringShellCommand("git add .")).toBe(true)
    expect(
      isGitAuthoringShellCommand(
        "git diff --cached && git -c core.hooksPath=/tmp/hooks add docs/design/a.md",
      ),
    ).toBe(true)
    expect(
      isGitAuthoringShellCommand(
        "git add docs/design/a.md; rm docs/design/a.md",
      ),
    ).toBe(true)
    expect(isGitAuthoringShellCommand("git show add")).toBe(false)
    expect(isGitAuthoringShellCommand("git diff -- commit")).toBe(false)
    expect(isGitAuthoringShellCommand("git --help add")).toBe(false)
    expect(
      isGitAuthoringShellCommand(
        "git --literal-pathspecs add docs/design/runtime.md",
      ),
    ).toBe(true)
    expect(
      isGitAuthoringShellCommand(
        "git -C nested add docs/design/runtime.md",
      ),
    ).toBe(true)
    expect(
      isGitAuthoringShellCommand(
        "git --git-dir .git commit -m 'bypass'",
      ),
    ).toBe(true)
    expect(
      isGitAuthoringShellCommand(
        "GIT_DIR=.git git add docs/design/runtime.md",
      ),
    ).toBe(true)
    expect(
      isGitAuthoringShellCommand(
        "/usr/bin/git add docs/design/runtime.md",
      ),
    ).toBe(true)
    expect(
      isGitAuthoringShellCommand(
        "command git add docs/design/runtime.md",
      ),
    ).toBe(true)
    expect(
      isGitAuthoringShellCommand(
        "env -i GIT_DIR=.git git add docs/design/runtime.md",
      ),
    ).toBe(true)
    expect(isGitAuthoringShellCommand("command -v git")).toBe(false)
    expect(
      authorGitShellResourcesAllowed(
        ["git add docs/design/runtime.md && git diff --output=docs/design/diff.txt"],
        designScope,
      ),
    ).toBe(false)
    expect(
      authorGitShellResourcesAllowed(
        ["git add docs/design/runtime.md && git diff --cached --ext-diff"],
        designScope,
      ),
    ).toBe(false)
    expect(
      authorGitShellResourcesAllowed(
        ["git add docs/design/runtime.md && git diff --cached --textconv"],
        designScope,
      ),
    ).toBe(false)
    expect(
      authorGitShellResourcesAllowed(
        ["git add docs/design/runtime.md && rm docs/design/runtime.md"],
        designScope,
      ),
    ).toBe(false)
    expect(
      authorGitShellResourcesAllowed(
        [
          "git add docs/design/runtime.md && git -c core.hooksPath=/dev/null commit -m 'docs: chained'",
        ],
        designScope,
      ),
    ).toBe(false)
    expect(
      scopedGitAddTargets(
        "git -c core.hooksPath=/tmp/hooks add docs/design/a.md",
      ),
    ).toBeUndefined()
    expect(
      scopedGitAddTargets(
        "git add ':(exclude)docs/design/runtime.md'",
      ),
    ).toBeUndefined()
    expect(
      scopedGitAddTargets(
        "git add :/docs/design/runtime.md",
      ),
    ).toBeUndefined()
    expect(
      authorGitShellResourcesAllowed(
        ["git add ':(exclude)docs/design/runtime.md'"],
        designScope,
      ),
    ).toBe(false)
    expect(scopedGitAddTargets("git add ../outside.md")).toBeUndefined()
    expect(
      isAllowedGitCommit(
        "git -c core.hooksPath=/dev/null commit -m 'docs: update'",
      ),
    ).toBe(true)
    expect(isAllowedGitCommit("git commit -m 'docs: update'")).toBe(false)
    expect(
      isAllowedGitCommit(
        "git -c core.hooksPath=/tmp/hooks commit -m 'docs: update'",
      ),
    ).toBe(false)
    expect(isAllowedGitCommit("git commit -a -m 'all'")).toBe(false)
  })


})
