---
name: python-common-practice
description: "Python style, verification (ruff, pytest, type checker), severity tiers, and Loom integration for code review and subagent dispatch. Use when writing or reviewing Python code, doing a Python review, dispatching a Python subagent, or applying the shared review tier to a Python finding. Load this alongside any `python-*` skill. Defines the Python-specific layer on top of the system-wide `current Loom role directive and control-plane state`."
license: MIT
metadata:
  author: Bateau
  version: "1.2.0"
---

# Python Common Practice

The Python-specific base layer for every `python-*` skill in this set. The other skills describe *what* good Python looks like; this one describes *how you, the agent, operate* while applying them.

These are house skills authored for this workspace. They are authoritative here; there is no further "company override" layer above them.

> **System protocols live in `current Loom role directive and control-plane state`.** Delegation (hub-and-spoke), escalation markers, the memory system, stagnation, and step-limit honesty are defined there and apply to all agents — this skill does not restate them. When a domain skill says something like "launch parallel sub-agents," treat it as shorthand: **only `general` dispatches sub-agents** (per `current Loom role directive and control-plane state`). A spoke covers all the listed domains itself, sequentially, in one pass, then reports to `general`.

## Verification — the inner check loop

Never hand back code you have not verified. After each meaningful change, run the inner check loop and fix what it surfaces before continuing:

```bash
uv sync                  # keep the environment in sync with pyproject/uv.lock
ruff check .             # lint
ruff format --check .    # formatting (use `ruff format .` to apply)
pytest                   # asyncio_mode is configured in pyproject when async
mypy .                   # or `ty check` / `pyright` — if the repo configures one
```

A skill's tool commands (e.g. `pytest -k`, `pytest --cov`, `bandit -r`, `py-spy`) are part of *your* verify step, not optional extras. Run them, read the output yourself, and apply fixes with an explanatory comment — do not rely on `--fix`/`--unsafe-fixes` to mutate code silently without review.

Run commands through `uv run <cmd>` when the tool lives in the project venv (e.g. `uv run pytest`). If you cannot make the loop pass after focused attempts, stop and escalate rather than looping indefinitely (see stagnation handling in `current Loom role directive and control-plane state`).

## Severity mapping (reviews and audits)

Domain skills score issues on their own scales. When you report inside a review, map to the `reviewer` tiers so findings route correctly:

| Domain severity | Review tier | Action |
| --- | --- | --- |
| Critical / High | `CRITICAL` | Block. Must be fixed before merge. |
| Medium | `MAJOR` | Fix or get explicit sign-off. |
| Low / style | `MINOR` | Note; fix opportunistically. |

A `CRITICAL` finding warrants an `[ESCALATE: QUALITY]` back to `general`; a finding rooted in a design flaw warrants `[ESCALATE: ARCHITECTURE]` (markers defined in `current Loom role directive and control-plane state`).

## Strictness posture

These skills are intentionally strict. `MUST`/`NEVER`/`SHOULD` carry their RFC weight. The strictness encodes conventions that hold *beyond* the current codebase, so apply them even when local code is inconsistent.

When you deliberately break a rule, **add a code comment** explaining why. An unexplained deviation reads as a mistake; an explained one reads as a decision.

**Agent navigability:** When human readability and agent navigability conflict, prefer the option that serves both; when they genuinely conflict, name the trade-off explicitly. Python frameworks lean on implicit conventions the research identifies as agent-hostile — when a skill recommends deviation from framework conventions, name the training-distribution risk.

## Cross-reference style

Skills in this set reference each other by **bare local name** in backticks — e.g. "see the `python-testing` skill", "→ See `python-error-handling` skill". Every `python-*` name resolves to a sibling skill in `~/.config/opencode/skills`.

## Diagnose before fixing

Prefer evidence over intuition. When a skill offers a `Diagnose:` step (a profiler, `pytest --pdb`, `ruff check`, a type checker), run it and read the output *before* changing code. Confirm the hypothesis, then fix one thing, then re-check.

## Environment and tooling baseline

- **uv** is the package manager and runner. Prefer `uv add`/`uv remove`/`uv sync` over editing `pyproject.toml` by hand, and `uv run` to execute tools in the venv. → See the `uv-package-manager` skill.
- **ruff** owns formatting and linting. Do not hand-format or reorder imports — let ruff. → See `python-lint`.
- Target the `requires-python` floor in `pyproject.toml`; do not use syntax newer than that floor.
- Prefer the standard library before adding a dependency. New runtime dependencies are a maintenance commitment — justify them.

## References

- [PEP 8 — Style Guide for Python Code](https://peps.python.org/pep-0008/)
- [PEP 20 — The Zen of Python](https://peps.python.org/pep-0020/)
- [uv documentation](https://docs.astral.sh/uv/)
- [Ruff documentation](https://docs.astral.sh/ruff/)
