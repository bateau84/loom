---
name: python-type-checking
description: "Static typing for Python — type hints, generics, Optional/None handling, Union and the `X | Y` syntax, Literal, Protocol (structural typing), TypedDict, typing.cast, gradual typing, and running a static checker (mypy, ty, or pyright) in CI. Use when adding type annotations, fixing type-checker errors, designing typed interfaces, modeling None-safety, or configuring static type analysis. Also use when the user mentions mypy, pyright, ty, type hints, typing, Protocol, or generics in Python."
license: MIT
metadata:
  author: Bateau
  version: "1.1.0"
---

> **House skill.** Follow `python-common-practice` and `current Loom role directive and control-plane state`. Pairs with `python-pydantic` (runtime validation) and `python-lint`.

**Persona:** You are a Python engineer who uses types as machine-checked documentation. A correct annotation prevents a class of bugs without a single test.

# Static Typing

Type hints are checked by a separate tool, not the interpreter — Python ignores them at runtime. Their value is catching mismatches *before* execution and documenting intent precisely. Annotate public function signatures and module-level data; let inference handle obvious locals.

Run one static checker in the inner check loop (→ See `python-common-practice`): **mypy** (mature, ubiquitous), **ty** (Astral, very fast, pairs with a ruff/uv toolchain), or **pyright** (strict, editor-native). Pick one per repo and run it in CI; they disagree at the edges, so don't mix verdicts.

## Annotate signatures, infer locals

```python
def fuzzy_match(a: str, b: str, threshold: int = 80) -> bool:
    score = ratio(a, b)        # inferred int — no annotation needed
    return score >= threshold
```

Use modern syntax (target a recent `requires-python`):

- `list[str]`, `dict[str, int]`, `tuple[int, ...]` — builtins, not `typing.List`.
- `X | Y` and `X | None` — not `Union[X, Y]` / `Optional[X]`.
- `from collections.abc import Iterable, Callable, Sequence` — not the deprecated `typing` aliases.

## None is the most common bug — model it

`X | None` forces callers to handle absence. The checker then *proves* you narrowed it before use — this is where typing pays for itself.

```python
def find_user(uid: int) -> User | None: ...

u = find_user(1)
print(u.name)        # ✗ checker error: u may be None
if u is not None:
    print(u.name)    # ✓ narrowed to User inside the guard
```

Prefer narrowing (`if x is None: return`) over `cast` or `assert`. A `cast` silences the checker without proving anything; reserve it for cases the checker genuinely can't follow, and comment why.

## Protocols — structural typing over inheritance

A `Protocol` matches any object with the right shape, so you depend on a capability, not a base class. This is the typed version of duck typing and keeps modules decoupled (no shared base import).

```python
from typing import Protocol

class MatchRepository(Protocol):
    def save(self, decision: MatchDecision) -> None: ...
    def by_video(self, video_id: str) -> MatchDecision | None: ...

def record(repo: MatchRepository, d: MatchDecision) -> None:
    repo.save(d)        # any class with these methods satisfies the type
```

Use `Protocol` for ports/interfaces (the SQLite repo, an API client) so tests can pass a lightweight fake that simply has the methods.

## Other high-value tools

- `Literal["allow", "deny"]` — a closed set of string values, checked at call sites.
- `TypedDict` — a dict with known string keys and per-key types (for JSON payloads you don't model with Pydantic).
- `@overload` — different return types for different argument shapes.
- `typing.Final` — a constant that must not be reassigned.

## Gradual typing

You don't have to type everything at once. Start strict on new modules; let legacy modules stay loose. In mypy, ratchet up with `disallow_untyped_defs` per-package rather than globally on day one — an all-or-nothing flip drowns you in errors and teaches nothing.

```toml
[tool.mypy]
python_version = "3.13"
warn_unused_ignores = true
warn_redundant_casts = true
# strict = true   # turn on per-package as coverage grows
```

## Common mistakes

| Mistake | Fix |
| --- | --- |
| `Optional[X]` / `Union[A, B]` / `List[str]` | Use `X | None`, `A | B`, `list[str]`. |
| `cast` to silence a None error | Narrow with an `is None` guard; reserve `cast` for genuinely opaque cases, with a comment. |
| `Any` to make an error disappear | `Any` disables checking for that value; use a precise type or `object` + narrowing. |
| Inheriting a base class just for typing | Define a `Protocol`; depend on shape, not lineage. |
| Bare `# type: ignore` | Pin the error code: `# type: ignore[arg-type]`; `warn_unused_ignores` cleans stale ones. |
| Type checker not in CI | Add it to the inner loop and CI, or annotations silently rot. |

**Diagnose:** 1- `mypy .` / `ty check` / `pyright` — the type checker is itself the diagnostic; read its output before "fixing" by adding `Any` 2- `reveal_type(x)` in a checked file — prints the inferred type so you see what the checker sees.

## References

- [typing — Support for type hints](https://docs.python.org/3/library/typing.html)
- [PEP 484 — Type Hints](https://peps.python.org/pep-0484/)
- [PEP 544 — Protocols](https://peps.python.org/pep-0544/)
- [mypy documentation](https://mypy.readthedocs.io/)
