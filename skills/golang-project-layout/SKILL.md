---
name: golang-project-layout
description: "Golang project layouts, workspaces, `cmd`/`internal`/`pkg` conventions, monorepos, and module splits. Use when starting a new Go project, organizing an existing codebase, setting up a monorepo, creating CLI tools with multiple mains, or deciding between directory conventions."
user-invocable: true
license: MIT
compatibility: Designed for Claude Code or similar AI coding agents, and for projects using Golang.
metadata:
  author: samber
  version: "1.3.0"
  openclaw:
    emoji: "📁"
    homepage: https://github.com/samber/cc-skills-golang
    requires:
      bins:
        - go
    install: []
allowed-tools: Read Edit Write Glob Grep Bash(go:*) Bash(golangci-lint:*) Bash(git:*) Agent AskUserQuestion
---

**Persona:** You are a Go project architect. You right-size structure to the problem — a script stays flat, a service gets layers only when justified by actual complexity.

Not for choosing between specific libraries or frameworks (→ See `golang-popular-libraries`).

# Go Project Layout

## Architecture Decision: Ask First

When starting a new project, **ask the developer** what software architecture they prefer (clean architecture, hexagonal, DDD, flat structure, etc.). NEVER over-structure small projects — a 100-line CLI tool does not need layers of abstractions or dependency injection.

→ See `golang-design-patterns` skill for detailed architecture guides with file trees and code examples.

## Dependency Injection: Ask Next

After settling on the architecture, **ask the developer** which dependency injection approach they want: manual constructor injection, a DI library, or none. See the `golang-dependency-injection` skill for a full comparison and decision table.

## 12-Factor App

For applications, follow [12-Factor App](https://12factor.net/) conventions: env-var config, stdout logging, stateless processes, and graceful shutdown.

## Quick Start: Choose Your Project Type

| Project Type | Use When | Key Directories |
| --- | --- | --- |
| **CLI Tool** | Building a command-line application | `cmd/{name}/`, `internal/`, optional `pkg/` |
| **Library** | Creating reusable code for others | `pkg/{name}/`, `internal/` for private code |
| **Service** | HTTP API, microservice, or web app | `cmd/{service}/`, `internal/`, `api/`, `web/` |
| **Monorepo** | Multiple related packages/modules | `go.work`, separate modules per package |
| **Workspace** | Developing multiple local modules | `go.work`, replace directives |

## Module Naming Conventions

Your module path in `go.mod` MUST match your repository URL, use lowercase only, and hyphens for multi-word segments: `github.com/jdoe/payment-processor`. Avoid generic names like `myproject` or `utils`. → See `golang-naming` skill for complete package naming conventions.

## Directory Layout

All `main` packages must reside in `cmd/` with minimal logic — parse flags, wire dependencies, call `Run()`. Business logic belongs in `internal/` or `pkg/`. Use `internal/` for non-exported packages, `pkg/` only when code is useful to external consumers.

See [directory layout examples](references/directory-layouts.md) for universal, small project, and library layouts, plus common mistakes.

## Organising Internal Code: Vertical Slices vs. Horizontal Layers

**Default for human teams:** separate directories by layer — `internal/handler/`, `internal/service/`, `internal/model/`. This is what the reference layouts show.

**For agent-maintained projects:** organise by feature (vertical slice), not by layer, unless deployment boundaries require otherwise.

```
# Horizontal — layer-based, default convention
internal/{handler,service,model}/

# Vertical — feature-based, prefer when agent-maintained
internal/{order,payment,user}/   # each dir: handler + service + types in 1–3 files
```

A vertical layout keeps a feature's complete implementation in 1–3 files. A horizontal layout requires reading 3–5 directories for the same feature change — a key predictor of agent task failure (ESEM 2026 — wide, flat directory structures (`repo_top_level_dir_count`) predict agent failure; `patch_num_hunks` is the strongest individual predictor [partially unverified — third report]).

**File consolidation:** 15 files × 30 lines is worse for agent navigability than 3 files × 150 lines — more files means more tool calls per task. But cap individual files at ~500 lines of business logic (provisional — OQ1 unresolved). A 2 000-line file triggers "Lost in the Middle" attention failures. The safe range: consolidated but bounded. Applies to `internal/` packages; generated files and test files are exempt.

## Essential Configuration Files

Every Go project should include at the root:

- **Makefile** — build automation. See [Makefile template](assets/Makefile)
- **.gitignore** — git ignore patterns. See [.gitignore template](assets/.gitignore)
- **.golangci.yml** — linter config. See the `golang-lint` skill for the recommended configuration

For application configuration with Cobra + Viper, see [config reference](references/config.md).

## Tests, Benchmarks, and Examples

Co-locate `_test.go` files with the code they test. Use `testdata/` for fixtures. See [testing layout](references/testing-layout.md) for file naming, placement, and organization details.

## Go Workspaces

Use `go.work` when developing multiple related modules in a monorepo. See [workspaces](references/workspaces.md) for setup, structure, and commands.

## Initialization Checklist

When starting a new Go project:

- [ ] **Ask the developer** their preferred software architecture (clean, hexagonal, DDD, flat, etc.)
- [ ] **Ask the developer** their preferred DI approach — see `golang-dependency-injection` skill
- [ ] Decide project type (CLI, library, service, monorepo)
- [ ] Right-size the structure to the project scope
- [ ] For agent-maintained projects: prefer vertical-slice organisation inside `internal/`
- [ ] Choose module name (matches repo URL, lowercase, hyphens)
- [ ] Run `go mod init github.com/user/project-name`
- [ ] Create `cmd/{name}/main.go` for entry point
- [ ] Create `internal/` for private code; `pkg/` only for public libraries
- [ ] For monorepos: Initialize `go work` and add modules
- [ ] Run `gofmt -s -w .` to ensure formatting
- [ ] Add `.gitignore` with `/vendor/` and binary patterns

## Related Skills

→ `golang-cli` — CLI tool structure and Cobra/Viper patterns. → `golang-dependency-injection` — DI approach comparison. → `golang-lint` — golangci-lint configuration. → `golang-continuous-integration` — CI/CD pipeline setup. → `golang-design-patterns` — architectural patterns including vertical-slice philosophy.
