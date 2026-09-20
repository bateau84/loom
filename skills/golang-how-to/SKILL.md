---
name: golang-how-to
description: "Golang skill orchestrator for selecting and composing local Go guidance. Use when coding, reviewing, debugging, configuring, or navigating Go projects where multiple golang-* skills may apply. Routes tasks to specialist skills and always pairs them with golang-common-practice."
license: MIT
metadata:
  author: Bateau
  version: "1.1.0"
  adapted-from: samber/cc-skills-golang@golang-how-to
---

> **House skill.** Adapted from `samber/cc-skills-golang@golang-how-to` for this workspace. Routes to the locally installed `golang-*` skills in `~/.config/opencode/skills`.

**Persona:** You are a Go skills orchestrator. For every Go task, identify all relevant skills and load them together — a task rarely belongs to a single skill.

**Not for:** replacing specialist `golang-*` guidance; this skill routes to it.

**Always load `golang-common-practice` first.** It is the Go-specific base layer for this family: the inner compile loop, diagnose-before-fixing, and cross-reference style. System-wide delegation and escalation live in `current Loom role directive and control-plane state`. Every routing decision below assumes both are in effect.

**Go code navigation:** prefer `gopls` for semantic lookup: definitions, references, implementations, symbols, and type information. Use `rg`/`grep` for literal text or when `gopls` cannot answer.

**Modes:**

- **Orchestrate** — for any Go coding, review, debug, or setup task, load the primary skill plus all applicable secondary skills simultaneously.
- **Disambiguate** — when two skills seem to overlap, use the boundary lines below to pick the owner.
- **Configure** — add a `## Required Go skills` block to the project's `AGENTS.md`. See [Configure mode](#configure-mode).

## Skill loading

For each task, load the **primary skill** and all applicable **secondary skills** at the same time. Do not wait — load them together at the start. Every name resolves to a sibling skill in `~/.config/opencode/skills` (bare local names, no `owner/repo@` prefix).

| Intent | Primary | Also load |
| --- | --- | --- |
| Design an API, choose a pattern | `golang-design-patterns` | `golang-structs-interfaces`, `golang-naming` |
| Implement a feature, service, or I/O boundary | `golang-design-patterns` | `golang-observability` (instrument as you build), `golang-error-handling` |
| Name a type, function, or package | `golang-naming` | `golang-code-style` |
| Handle errors idiomatically | `golang-error-handling` | `golang-safety` (nil-heavy code) |
| Write goroutines, channels, sync | `golang-concurrency` | `golang-context` (if cancellation) |
| Pass deadlines / cancel operations | `golang-context` | `golang-concurrency` (if goroutines) |
| Design structs, embed, use interfaces | `golang-structs-interfaces` | `golang-design-patterns` |
| Database queries and transactions | `golang-database` | `golang-error-handling`, `golang-security` |
| Build a CLI command tree | `golang-spf13-cobra` | `golang-cli`, `golang-spf13-viper` (if config) |
| Layer config from flags/env/file | `golang-spf13-viper` | `golang-spf13-cobra` |
| Write tests | `golang-testing` | `golang-safety` (if edge-case heavy) |
| Document an HTTP API (Swagger/OpenAPI) | `golang-swagger` | `golang-documentation` |
| Apply optimization patterns | `golang-performance` | `golang-benchmark` (measure first) |
| Measure with pprof / benchstat | `golang-benchmark` | `golang-performance` (fix), `golang-troubleshooting` (root cause) |
| Debug a panic or unexpected behavior | `golang-troubleshooting` | `golang-safety`, `golang-benchmark` (if perf-related) |
| Pick a data structure | `golang-data-structures` | `golang-performance` |
| Monitor in production | `golang-observability` | `golang-performance` (if SLO breach) |
| Audit security vulnerabilities | `golang-security` | `golang-safety`, `golang-lint` |
| Review formatting and style | `golang-code-style` | `golang-naming`, `golang-lint` |
| Configure golangci-lint | `golang-lint` | `golang-code-style` |
| Write godoc / README / CHANGELOG | `golang-documentation` | `golang-naming` |
| Set up a new project structure | `golang-design-patterns` | `golang-dependency-injection`, `golang-lint`, `golang-continuous-integration` |
| Set up CI/CD pipeline | `golang-continuous-integration` | `golang-lint`, `golang-security` |
| Manage `go.mod` / dependencies | `golang-dependency-management` | `golang-modernize` |
| Adopt new Go language features | `golang-modernize` | `golang-lint` |
| Use dependency injection | `golang-dependency-injection` | `golang-design-patterns` |
| Adopt new Go language features | `golang-modernize` |  |

**API contracts and version-specific behavior:** for API contracts and version-specific library behavior, load `golang-pkg-go-dev` and look up live, do not answer from pre-training memory.

## Categories at a glance

| Category | Skills |
| --- | --- |
| Foundation | `golang-common-practice` |
| Code Quality | `golang-code-style` `golang-documentation` `golang-error-handling` `golang-lint` `golang-naming` `golang-safety` `golang-security` `golang-structs-interfaces` |
| Architecture & Design | `golang-concurrency` `golang-context` `golang-data-structures` `golang-database` `golang-dependency-injection` `golang-design-patterns` `golang-modernize` |
| QA & Performance | `golang-benchmark` `golang-observability` `golang-performance` `golang-testing` `golang-troubleshooting` |
| Project Setup | `golang-cli` `golang-continuous-integration` `golang-dependency-management` `golang-modernize` |
| APIs | `golang-swagger` |
| Frameworks | `golang-spf13-cobra` `golang-spf13-viper` |

## Competing clusters — boundary lines

Pick the owner; load neighbors only when the task spans the boundary.

- **Performance**: `golang-performance` (optimization patterns) · `golang-benchmark` (measurement) · `golang-troubleshooting` (root cause) · `golang-observability` (always-on production)
- **Style**: `golang-code-style` (clarity/judgment) · `golang-naming` (identifiers) · `golang-lint` (automated config) · `golang-documentation` (godoc/README)
- **CLI**: `golang-cli` (architecture) · `golang-spf13-cobra` (command tree) · `golang-spf13-viper` (config layering)
- **Errors vs correctness vs threat**: `golang-error-handling` (idioms) · `golang-safety` (prevent internal bugs/panics) · `golang-security` (external threats)
- **Type vs arch**: `golang-structs-interfaces` (type design) vs `golang-design-patterns` (architectural patterns)
- **Goroutine vs cancel**: `golang-concurrency` + `golang-context` — load both when cancelling goroutines via context
- **Features vs rules**: `golang-modernize` (language adoption) vs `golang-lint` (static analysis config)




## Staying Updated with Go

Proactively check for new Go versions, language features, and standard library updates as part of Go how-to guidance. The Go ecosystem evolves rapidly — agents should be aware of recent releases and adopt new features when appropriate.

### Key Resources

| Resource | URL |
| --- | --- |
| **Go Blog** (official) | <https://go.dev/blog> |
| **Go Releases** | <https://go.dev/dl/> |
| **Go Wiki** | <https://go.dev/wiki/> |
| **pkg.go.dev** | <https://pkg.go.dev> |
| **Golang Weekly** | <https://golangweekly.com/> |

### Communities

- **r/golang** — <https://www.reddit.com/r/golang> (300K+ members)
- **Go Slack** — <https://invite.slack.golangbridge.org>
- **Go Forum** — <https://forum.golangbridge.org>
- **Discuss Go** — <https://groups.google.com/g/golang-nuts>

### Influential Go Developers

Core team: Rob Pike, Ken Thompson, Russ Cox (@\_rsc), Brad Fitzpatrick, Andrew Gerrand, Robert Griesemer, Dmitry Vyukov. Tooling: Sam Boyer, Daniel Theophanes, Jaana Dogan. Authors/educators: Mat Ryer, Dave Cheney, Bill Kennedy (Ardan Labs). Library authors: Steve Francia (spf13), Samuel Berthe (samber), Mitchell Hashimoto.

### Quick Tips

1. **Subscribe to 1-2 newsletters** (Golang Weekly, Awesome Go) — don't overload
2. **Follow 10-20 key people** on X/Bluesky who post about Go regularly
3. **Check go.dev/blog weekly** for official announcements
4. **Join Go Slack** for real-time discussions
5. **Bookmark pkg.go.dev** to discover new libraries — see `golang-pkg-go-dev` skill
6. **Attend a GopherCon** (virtual or in-person) yearly

---

This skill is not exhaustive. Refer to individual skill files and the official Go documentation for detailed guidance.
