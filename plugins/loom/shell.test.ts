import { describe, expect, test } from "bun:test"
import {
  authorGitShellResourcesAllowed,
  butlerCommitSourceIds,
  diagnosticExecutionShellResourcesAllowed,
  diagnosticShellResourcesAllowed,
  classifyVerificationShell,
  isElevatableVerificationShell,
  elevatedGenerationOutput,
  elevatedGenerationPaths,
  generationElevationError,
  elevatedVerificationEntrypoint,
  isAllowedButlerCommit,
  isAllowedGitCommit,
  isAllowedPackageScriptShell,
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
  test("admits tool metadata and binary lookup as inspection without a write scope", () => {
    for (const command of [
      "node --version",
      "bun --version",
      "node -v",
      "bun -v",
      "npm --version",
      "python3.12 -V",
      "go version", // Existing safe Go inspection
      "git --version",
      "git version",
      "but --version",
      "but --help", // Existing Butler inspection
      "kubectl --help",
      "GOENV=off node --version",
      "command -v node",
      "command -v bun",
    ]) {
      expect(isAllowedWorkerShell(command)).toBe(true)
      expect(shellResourcesAllowed([command])).toBe(true)
      expect(diagnosticShellResourcesAllowed([command])).toBe(true)
      expect(workerShellResourcesAllowed([command])).toBe(true)
    }
    expect(workerShellResourcesAllowed(["node --version", "bun --version"])).toBe(true)
  })

  test("metadata inspection does not admit arbitrary executable code or shell writes", () => {
    for (const command of [
      "node -e 'require(\"fs\").writeFileSync(\"/tmp/out\", \"x\")'",
      "node -p process.version",
      "bun -e 'console.log(1)'",
      "node --require ./inject.cjs --version",
      "node --version other.js",
      "bun --help ./script.ts",
      "npm install --version",
      "bash -v", // Verbose execution, not a version query
      "bash -h",
      "python -v", // Verbose interpreter, not a version query
      "go -v",
      "constructor -v",
      "__proto__ -v",
      "./node --version",
      "unknown-tool --version",
      "node --version && touch /tmp/out",
      "bun --version > /tmp/out",
      "git --version; git reset --hard",
      "command -v ./tool",
      "command -v node; touch /tmp/out",
      "PATH=/tmp node --version",
      "GOENV=on node --version",
    ]) {
      expect(isAllowedWorkerShell(command)).toBe(false)
      expect(shellResourcesAllowed([command])).toBe(false)
    }
    expect(workerShellResourcesAllowed(["node --version", "node -e 'console.log(1)'"])).toBe(false)
  })

  test("classifies unsafe Git and Butler chains as repository commands so runtime can fail closed", () => {
    expect(isGitShellCommand("git status && rm -f README.md")).toBe(true)
    expect(isGitInspectionShellCommand("git status && rm -f README.md")).toBe(false)

    expect(isButlerShellCommand("but status && but discard zz")).toBe(true)
    expect(isButlerInspectionShellCommand("but status && but discard zz")).toBe(false)
  })


  test("allows universal read-only Git inspection and rejects mutation-shaped or escaping forms", () => {
    for (const command of [
      "git status --short",
      "git --version",
      "git version",
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
      "but --version",
      "but --json status -fv",
      "but status --upstream --no-hint",
      "but diff",
      "but diff qs:5",
      "but show abc",
      "but show abc --verbose",
      "but branch",
      "but branch list -r",
      "but branch list --all --no-ahead --no-check",
      "but branch show feature",
      "but branch show feature --files",
      "but oplog",
      "but oplog list --since abc",
      "but commit --help",
    ]) {
      expect(isButlerShellCommand(command)).toBe(true)
      expect(isButlerInspectionShellCommand(command)).toBe(true)
    }

    for (const command of [
      "but pull",
      "but pull --check",
      "but push feature",
      "but push feature --dry-run",
      "but status -r",
      "but status --refresh-prs",
      "but branch list --review",
      "but branch show feature --review",
      "but branch show feature --ai",
      "but branch show feature --check",
      "but branch new feature",
      "but discard qs:5",
      "but squash a -t b -m 'combine'",
      "but pr new feature -t",
    ]) {
      expect(isButlerShellCommand(command)).toBe(true)
      expect(isButlerInspectionShellCommand(command)).toBe(false)
    }

    expect(isButlerShellCommand("but -C ../other status")).toBe(true)
    expect(isButlerInspectionShellCommand("but -C ../other status")).toBe(false)
  })

  test("admits only explicit selected-ID Butler commits with messages", () => {
    expect(
      butlerCommitSourceIds(
        "but commit -m 'fix(runtime): preserve ownership' qs uo",
      ),
    ).toEqual(["qs", "uo"])
    expect(
      butlerCommitSourceIds(
        "but --json commit -m 'feat: one' -m 'Verification: pass' qs",
      ),
    ).toEqual(["qs"])

    expect(
      isAllowedButlerCommit("but commit -m 'fix: scoped' qs"),
    ).toBe(true)
    expect(isButlerCommitShellCommand("but commit -m 'fix: scoped' qs")).toBe(true)

    for (const command of [
      "but commit -b feature -m 'fix: targeted' qs",
      "but commit --branch feature -m 'fix: targeted' qs",
      "but commit --branch=feature -m 'fix: targeted' qs",
      "but commit -m 'fix: partial' qs:5",
      "but commit -m 'fix: broad' zz",
      "but commit --above abc -m 'fix: positioned' qs",
      "but commit --below abc -m 'fix: positioned' qs",
      "but commit -m 'fix: broad'",
      "but commit qs:5",
      "but commit --empty -m 'chore: marker'",
      "but commit -i -m 'fix: interactive'",
      "but commit --no-message qs:5",
      "but commit -m 'fix: scoped' qs:5 && but commit -m 'test: scoped' uo",
      "but -C ../other commit -m 'fix: scoped' qs:5",
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

  test("allows named package scripts for project verification", () => {
    for (const command of [
      "bun run test:unit",
      "npm run test:unit",
      "pnpm run quality:check",
      "yarn run build:prod",
      "bun run my.task",
      "npm run lint:fix -- --write",
      "XDG_CACHE_HOME=/tmp/loom-cache bun run test:unit -- --filter unit",
    ]) {
      expect(isAllowedPackageScriptShell(command)).toBe(true)
      expect(isAllowedWorkerShell(command)).toBe(false)
      expect(shellResourcesAllowed([command])).toBe(false)
      expect(diagnosticShellResourcesAllowed([command])).toBe(true)
      expect(diagnosticExecutionShellResourcesAllowed([command])).toBe(true)
      expect(workerShellResourcesAllowed([command])).toBe(true)
    }

    for (const command of [
      "bun run",
      "npm run --prefix ../other test",
      "bun run ./scripts/probe.ts",
      "npm run ../other",
      "npm install",
      "npm run test:unit && rm -rf src",
      "npm run test:unit | cat",
      "npm run test:unit > results.txt",
      "npm run test:unit$(touch pwn)",
      "PATH=/tmp npm run test:unit",
    ]) {
      expect(isAllowedPackageScriptShell(command)).toBe(false)
    }
  })

  test("admits Python, Go, and shell testing for the verification roles", () => {
    const groups = [
      ["package", [
        "bun test ./plugins/loom/shell.test.ts",
        "npm test",
        "pnpm test",
        "yarn test",
      ]],
      ["python", [
        "python -m unittest discover -s tests",
        "python3 -m pytest tests -q",
        "python3.12 -m coverage run -m pytest",
        "python scripts/test_api.py",
        "python ./tests/run.py",
        "pytest -q",
        "tox -e py312",
        "ruff check .",
      ]],
      ["go", [
        "go test ./...",
        "go test -race -count=1 ./...",
        "go vet ./...",
        "go tool cover -func=coverage.out",
      ]],
      ["shell", [
        "bash scripts/test-unit.sh",
        "sh ./tests/run.sh",
        "bash -n scripts/deploy.sh",
        "shellcheck ./scripts/test-unit.sh",
        "bats tests/example.bats",
        "shfmt -d scripts/test-unit.sh",
        "./scripts/test-unit.sh",
      ]],
    ] as const
    for (const [family, commands] of groups) {
      for (const command of commands) {
        expect(classifyVerificationShell(command)?.family).toBe(family)
        expect(diagnosticShellResourcesAllowed([command])).toBe(true)
        expect(workerShellResourcesAllowed([command])).toBe(true)
      }
    }
    // Research does not inherit the new project-execution entitlement.
    expect(shellResourcesAllowed(["bash scripts/test-unit.sh"])).toBe(false)
    expect(shellResourcesAllowed(["python -m unittest discover"])).toBe(false)
  })

  test("rejects shell code injection and non-test entrypoints", () => {
    for (const command of [
      "bash -c 'rm -rf src'",
      "sh -lc 'go test ./...'",
      "python -c 'import os; os.system(\"touch /tmp/pwn\")'",
      "go generate ./...",
      "go env -w GOPROXY=direct",
      "bash ../outside/test.sh",
      "bash /tmp/test.sh",
      "bash scripts/deploy.sh",
      "python scripts/deploy.py",
      "bash scripts/test.sh && git push origin main",
      "python -m pip install -r requirements.txt",
      "ruff check --fix .",
      "python -m ruff check --fix .",
      "shfmt -d -w scripts/test.sh",
    ]) {
      expect(classifyVerificationShell(command)).toBeUndefined()
    }
  })

  test("project generation elevation admits scoped Swagger output without shell escape", () => {
    const command = "swag init -g doc.go -d ./internal/apiv2,./internal/app --parseDependency --parseInternal --output ./internal/swagger/v2 --tags 'internal-app-v1' --requiredByDefault"
    expect(elevatedGenerationOutput(command)).toBe("internal/swagger/v2")
    expect(elevatedGenerationPaths(command)).toEqual([
      "internal/swagger/v2/docs.go",
      "internal/swagger/v2/swagger.json",
      "internal/swagger/v2/swagger.yaml",
    ])
    expect(isElevatableVerificationShell(command)).toBe(false)
    expect(elevatedGenerationOutput("swag init --output=internal/swagger/v2 --outputTypes=json,yaml")).toBe("internal/swagger/v2")
    expect(elevatedGenerationOutput("swag init -o internal/swagger/v2 -t 'internal-app-v1'")).toBe("internal/swagger/v2")
    expect(elevatedGenerationOutput("swag init --ot json,yaml -o internal/swagger/v2")).toBe("internal/swagger/v2")
    expect(elevatedGenerationOutput("swag init --parseDepth 100 --pdl 3 -q -o internal/swagger/v2")).toBe("internal/swagger/v2")
    expect(elevatedGenerationOutput("swag init --tags '!internal-app-v1' -o internal/swagger/v2")).toBe("internal/swagger/v2")
    expect(generationElevationError("swag init --badOption 1 -o internal/swagger/v2")).toContain("Unsupported swag init option")
    expect(generationElevationError("swag init --output ../outside")).toContain("project-relative")
    expect(generationElevationError("swag init -g doc.go")).toContain("explicit -o or --output")

    for (const invalid of [
      "swag init",
      "swag init --output .",
      "swag init --output ../outside",
      "swag init --output /tmp/out",
      "swag init --output .git/hooks",
      "swag init --output .loom/private",
      "swag init --output internal/swagger/v2 --output /tmp/also",
      "swag init --output internal/swagger/v2 --dir ../outside",
      "swag init --output internal/swagger/v2 -g ../outside/doc.go",
      "swag init --output internal/swagger/v2 --outputTypes xml",
      "swag init --output internal/swagger/v2 --ot html",
      "swag init --output internal/swagger/v2 --parseDepth 0",
      "swag init --output internal/swagger/v2 --parseDepth 1001",
      "swag init --output internal/swagger/v2 --templateDelims unsafe",
      "swag init --output internal/swagger/v2 && git push origin main",
      "swag init --output 'internal/swagger/v2;rm'",
      "swag fmt --output internal/swagger/v2",
      "go generate ./...",
      "git push origin main",
      "npm install",
    ]) {
      expect(elevatedGenerationOutput(invalid)).toBeUndefined()
    }
  })

  test("explicit verification elevation accepts only bounded runner shapes", () => {
    for (const command of [
      "make test",
      "just test:unit",
      "bash scripts/ci.sh",
      "sh ./scripts/ci.sh",
      "python scripts/reproduce.py",
      "python3 -m custom_test_runner",
      "python3 -m tests.runner",
      "go run ./cmd/test-runner",
    ]) {
      expect(isElevatableVerificationShell(command)).toBe(true)
    }
    for (const command of [
      "bash scripts/deploy.sh",
      "python scripts/migrate-db.py",
      "go run ./cmd/deploy",
      "python3 -m pip._internal",
      "make test-clean",
      "make deploy",
      "make test -f /tmp/outside.mk",
      "make test --eval 'target:; echo unsafe'",
      "make test -C /tmp",
      "just test -f /tmp/Justfile",
      "python3 -m http.server",
      "python3 -m os",
      "just clean",
      "bash -c 'echo hello'",
      "sh -lc 'echo hello'",
      "python -c 'print(1)'",
      "python -m pip install",
      "go run ../other",
      "go run /tmp/script.go",
      "bash /tmp/ci.sh",
      "bash scripts/test.sh; rm -rf src",
      "git push origin main",
      "npm install",
      "rm -rf src",
    ]) {
      expect(isElevatableVerificationShell(command)).toBe(false)
    }
    expect(elevatedVerificationEntrypoint("bash scripts/ci.sh")).toBe("scripts/ci.sh")
    expect(elevatedVerificationEntrypoint("python scripts/reproduce.py")).toBe("scripts/reproduce.py")
    expect(elevatedVerificationEntrypoint("go run ./cmd/test-runner")).toBe("./cmd/test-runner")
    expect(elevatedVerificationEntrypoint("make test")).toBeUndefined()
    expect(elevatedVerificationEntrypoint("python -m tests.runner")).toBeUndefined()
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
