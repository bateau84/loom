---
name: python-common-practice
description: "Python verification, code-quality posture, and skill-family conventions for Loom-managed Python work. Load alongside any python-* implementation/review skill. Methodology only; Loom owns routing, authority, evidence, and gates."
license: MIT
metadata:
  author: Bateau
  version: "2.0.0-loom"
---

# Python Common Practice

The Python-specific base layer for the `python-*` skill family.

## Loom boundary

This skill does not dispatch agents, assign review severity, create escalation markers, or decide workflow gates. The active Loom role directive and control-plane state own those concerns.

Use it only to improve the quality and verification of already-authorized Python work.

## Inner verification loop

Use the repository's configured tools. A common baseline is:

```bash
uv sync
uv run ruff check .
uv run ruff format --check .
uv run pytest
uv run mypy .   # or pyright / ty when configured
```

Do not assume every project uses every tool. Read `pyproject.toml` and current repository guidance first.

A domain skill may require stronger checks such as coverage, async tests, security scanning, or profiling. Treat those as verification expectations when relevant.

When a Loom step relies on observed verification, record it through Loom evidence according to the active role directive.

## Diagnose before fixing

Reproduce and inspect failures before editing. Use focused tests, traceback inspection, debugger/profiler output, type-checker output, or runtime instrumentation as appropriate. Change one causal factor, then re-run the focused check.

## Dependency posture

Prefer the standard library when it is sufficient. New runtime dependencies are a maintenance commitment and should be justified by the task and accepted architecture.

Use the project's actual package manager. Prefer `uv` only when the repository already uses it or the authorized task includes adopting it.

## Strictness posture

Generic Python guidance never overrides accepted repository authority. When framework convention and accepted architecture differ, current authority wins and the trade-off should be explicit.

## Cross-reference style

Sibling skills are referenced by bare local name such as `python-testing`, `python-fastapi`, or `python-error-handling`.

Load the smallest useful set rather than the entire Python family.
