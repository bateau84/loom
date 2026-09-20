---
name: python-lint
description: "Linting and formatting for Python projects with Ruff — running `ruff check` and `ruff format`, configuring `[tool.ruff]` in pyproject.toml, selecting and ignoring rule sets, per-file ignores, `# noqa` suppression, and import sorting (isort rules). Use when configuring Ruff, interpreting lint warnings, suppressing a rule, choosing rule sets, or setting up Python code-quality tooling. Also use when the user mentions ruff, flake8, isort, black, pylint, or pycodestyle."
license: MIT
metadata:
  author: Bateau
  version: "1.1.0"
---

> **House skill.** Follow `python-common-practice` and `current Loom role directive and control-plane state`.

**Persona:** You are a Python tooling engineer. You let the linter own mechanical correctness so humans review meaning, not whitespace.

# Python Linting with Ruff

Ruff is a single fast tool that replaces black (format), isort (imports), flake8, pyupgrade, and most of pylint. Use it as the one source of truth for formatting and lint. Do not run black/isort/flake8 alongside it — overlapping formatters fight each other.

## The two commands

```bash
ruff format .            # format (replaces black) — apply
ruff format --check .    # format check only — CI / verify
ruff check .             # lint
ruff check --fix .       # apply safe autofixes
ruff check --statistics .  # count violations by rule — triage a legacy codebase
```

`ruff format` and `ruff check` are separate: format owns layout, check owns rules. Run both. In the inner check loop use `--check` so verification never mutates files silently (see `python-common-practice`).

## Configuration — `[tool.ruff]` in pyproject.toml

Keep config in `pyproject.toml`, not a separate `.ruff.toml`, so it travels with the project metadata.

```toml
[tool.ruff]
target-version = "py313"   # match requires-python; enables version-aware rules
line-length = 100

[tool.ruff.lint]
select = ["E", "F", "I", "UP", "B", "SIM", "ASYNC", "RUF"]
ignore = ["E501"]          # optional: the formatter owns width; keep E501 on to flag lines it can't wrap

[tool.ruff.lint.per-file-ignores]
"tests/*" = ["S101"]       # asserts are fine in tests
"__init__.py" = ["F401"]   # re-exports
```

Rule-set picks that earn their keep:

| Code | Set | Why |
| --- | --- | --- |
| `E`, `F` | pycodestyle + Pyflakes | the baseline — real errors and undefined names |
| `I` | isort | import ordering, so you never sort by hand |
| `UP` | pyupgrade | rewrites old syntax to your `target-version` (pairs with `python-modernize` thinking) |
| `B` | flake8-bugbear | likely-bug patterns (mutable defaults, `except` too broad) |
| `SIM` | flake8-simplify | collapses needless complexity |
| `ASYNC` | flake8-async | blocking calls inside `async def` — critical for async services (→ See `python-async`) |
| `RUF` | Ruff-native | misc correctness, including unused `# noqa` |

Start broad, then `ignore` what produces noise — selecting a set and silencing a few rules beats hand-picking dozens.

## Suppressing warnings

Suppress narrowly and explain why — an unexplained `# noqa` reads as hiding a bug.

```python
import os  # noqa: F401  # re-exported for the public API
value = data[key]  # noqa: S105  # not a password despite the name
```

- Always pin the code: `# noqa: F401`, never a bare `# noqa` (a bare one hides future, unrelated violations).
- Prefer `per-file-ignores` in config over scattering `# noqa` when a rule is wrong for a whole category of files (tests, generated code).
- `RUF100` flags unused `# noqa` — let it clean up suppressions you no longer need.

**Diagnose:** 1- `ruff check --statistics .` — see which rules dominate before mass-fixing; expect a few rules to account for most violations 2- `ruff check --diff .` — preview what `--fix` would change without writing 3- `ruff rule <CODE>` — read the rationale for a rule before silencing it.

## Common mistakes

| Mistake | Fix |
| --- | --- |
| Running black + ruff format together | Pick one. `ruff format` is black-compatible; drop black. |
| Treating `ignore = ["E501"]` as mandatory | The formatter wraps most lines (best-effort), so ignoring `E501` is a common convention — but keeping it on to catch lines the formatter can't break (long URLs/strings) is equally valid. Decide per project. |
| Bare `# noqa` | Always pin the rule code so unrelated violations still surface. |
| No `target-version` | Set it; `UP` rules and version-aware checks need it to rewrite safely. |

## References

- [Ruff documentation](https://docs.astral.sh/ruff/)
- [Ruff rules reference](https://docs.astral.sh/ruff/rules/)
- [Ruff formatter](https://docs.astral.sh/ruff/formatter/)
