---
name: python-how-to
description: "Python skills orchestrator — active on any Python coding, review, debug, or setup task. Loads the most relevant python-* skills: building a service loads python-fastapi + python-pydantic + python-async; writing tests loads python-testing; instrumenting loads python-observability. Always pairs with python-common-practice. Disambiguates overlapping skills and configures AGENTS.md to force-trigger skills in a project."
license: MIT
metadata:
  author: Bateau
  version: "1.1.0"
---

> **House skill.** Routes to the locally installed `python-*` skills in `~/.config/opencode/skills`.

**Persona:** You are a Python skills orchestrator. For every Python task, identify all relevant skills and load them together — a task rarely belongs to a single skill.

**Always load `python-common-practice` first.** It is the Python-specific base layer for this family: the inner check loop (ruff, pytest, type checker), diagnose-before-fixing, and cross-reference style. System-wide delegation and escalation live in `current Loom role directive and control-plane state`. Every routing decision below assumes both are in effect.

**Modes:**

- **Orchestrate** — for any Python coding, review, debug, or setup task, load the primary skill plus all applicable secondary skills simultaneously.
- **Disambiguate** — when two skills seem to overlap, use the boundary lines below to pick the owner.
- **Configure** — add a `## Required Python skills` block to the project's `AGENTS.md`. See [Configure mode](#configure-mode).

## Skill loading

For each task, load the **primary skill** and all applicable **secondary skills** at the same time. Do not wait — load them together at the start. Every name resolves to a sibling skill in `~/.config/opencode/skills` (bare local names, no `owner/repo@` prefix).

| Intent | Primary | Also load |
| --- | --- | --- |
| Build / review a FastAPI endpoint | `python-fastapi` | `python-pydantic`, `python-async`, `python-error-handling` |
| Define a data model or validate input | `python-pydantic` | `python-type-checking` |
| Load typed app configuration | `python-pydantic` | `python-common-practice` |
| Write or run concurrent I/O | `python-async` | `python-error-handling` |
| Call an external HTTP API (httpx) | `python-async` | `python-error-handling`, `python-observability` |
| Schedule background jobs (APScheduler) | `python-async` | `python-observability` |
| Write tests | `python-testing` | `python-async` (async tests) |
| Add type hints / fix a type error | `python-type-checking` | `python-pydantic` |
| Design error flow / custom exceptions | `python-error-handling` | `python-fastapi` (HTTP mapping) |
| Add logging, metrics, or tracing | `python-observability` | `python-error-handling` |
| Database queries / repository / migrations | `python-database` | `python-error-handling`, `python-testing` |
| Configure linting / formatting | `python-lint` | `python-type-checking` |
| Choose an architecture or design pattern | `python-design-patterns` | `python-type-checking`, `python-observability` (instrument as you build) |
| Manage dependencies / virtualenv | `python-common-practice` | `python-lint` |
| Set up a new project | `python-design-patterns` | `python-common-practice`, `python-lint`, `python-testing` |

## Categories at a glance

| Category | Skills |
| --- | --- |
| Foundation | `python-common-practice` |
| Code Quality | `python-lint` `python-type-checking` `python-error-handling` |
| Architecture & Design | `python-design-patterns` `python-async` `python-database` |
| Web & Data | `python-fastapi` `python-pydantic` |
| QA & Observability | `python-testing` `python-observability` |
| Project Setup | `python-common-practice` |

`python-design-patterns` is a pre-existing skill in this workspace; the rest are house `python-*` skills.

## Competing clusters — boundary lines

Pick the owner; load the neighbor only when the task spans the boundary.

- **`python-pydantic` vs `python-type-checking`** — Pydantic does **runtime** validation of external data at the boundary; type-checking does **static** analysis of internal code. Modeling an API payload → pydantic. Annotating a pure function or fixing a checker error → type-checking.
- **`python-error-handling` vs `python-observability`** — error-handling owns control flow (what to catch, raise, chain). Observability owns recording (logging the error, incrementing an error metric). Catching and re-raising → error-handling; deciding *how* to log it → observability.
- **`python-async` vs `python-fastapi`** — fastapi owns the request/response surface and DI; async owns coroutines, concurrency, and not blocking the loop. The danger zone (sync I/O in an `async def` handler) is owned by `python-async`.
- **`python-lint` vs `python-type-checking`** — ruff owns style, imports, and lint rules; the type checker owns type correctness. They run side by side; neither subsumes the other.

## Configure mode

To force a project to always load these skills, add a block to its `AGENTS.md`:

```markdown
## Required Python skills

Load `python-common-practice` plus, by task: `python-fastapi` + `python-pydantic`
for the API, `python-async` for concurrency, `python-testing` for tests,
`python-observability` for logging/metrics, `python-database` for persistence.
Route via `python-how-to`.
```

Tailor the list to the project's stack — drop skills it doesn't use (e.g. omit `python-database` for a stateless service).

## References

- [The Python Standard Library](https://docs.python.org/3/library/)
- [The Python Language Reference](https://docs.python.org/3/reference/)
