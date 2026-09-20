---
name: python-testing
description: "Production-ready Python tests with pytest — fixtures, parametrize, pytest-asyncio for async tests, monkeypatch, tmp_path, conftest.py scoping, markers, coverage, and testing FastAPI/httpx code. Use when writing or reviewing pytest tests, setting up fixtures, testing async code, parametrizing cases, mocking dependencies, or configuring pytest in pyproject.toml. Also use when the user mentions pytest, unittest, fixtures, mocking, or test coverage in Python."
license: MIT
metadata:
  author: Bateau
  version: "1.1.0"
---

> **House skill.** Follow `python-common-practice` and `current Loom role directive and control-plane state`.

**Persona:** You are a Python engineer who treats tests as executable specifications. You write tests to constrain behavior, not to chase a coverage number.

# Python Testing with pytest

Tests pin behavior. A good test fails for exactly one reason and names that reason. Prefer plain `assert` (pytest rewrites it for rich diffs) over `unittest`'s `assertEqual` zoo.

## Structure and naming

- Files `test_*.py`, functions `test_*`, one behavior per test. The name states the expected behavior: `test_rejects_match_below_threshold`, not `test_match_2`.
- **Arrange / Act / Assert** with blank lines between phases. If a test needs comments to explain phases, it is doing too much.
- Put shared fixtures in `conftest.py` at the narrowest directory that needs them — pytest discovers them up the tree, so scope drives reuse.

## Fixtures over setUp

Fixtures are dependency injection for tests: request what you need, get teardown for free via `yield`.

```python
import pytest

@pytest.fixture
def settings(tmp_path):
    # tmp_path is a per-test directory — no manual cleanup, no shared state
    return Settings(database_file=str(tmp_path / "test.db"))

@pytest.fixture
def repo(settings):
    conn = open_connection(settings.database_file)
    run_migrations(conn)
    yield Repository(conn)   # everything after yield is teardown
    conn.close()
```

Scope deliberately: default `function` (fresh per test, safest). Use `module`/`session` only for expensive, read-only setup — shared mutable fixtures leak state between tests and create order-dependent flakiness.

## Parametrize instead of loops

A loop inside one test stops at the first failure and reports one case. `parametrize` runs each case independently and names it.

```python
@pytest.mark.parametrize(
    ("title_a", "title_b", "expected"),
    [
        ("Song (Live)", "Song", True),
        ("Song", "Totally Other", False),
    ],
    ids=["live-suffix-matches", "different-titles-reject"],
)
def test_fuzzy_match(title_a, title_b, expected):
    assert is_match(title_a, title_b) is expected
```

## Async tests (pytest-asyncio)

When `pyproject.toml` sets `asyncio_mode = "auto"`, every `async def test_*` runs on the event loop with no decorator. Without it, mark each one `@pytest.mark.asyncio`. Know which mode the repo uses before adding tests.

```toml
[tool.pytest.ini_options]
asyncio_mode = "auto"
```

```python
async def test_fetches_playlist(httpx_mock):
    httpx_mock.add_response(json={"items": []})
    result = await client.get_playlist("abc")
    assert result == []
```

Async fixtures use the same `async def` + `yield` shape. Do not call `asyncio.run()` inside a test — you are already on the loop; nesting raises `RuntimeError`.

## Mocking — at the boundary, not the internals

Mock I/O and external services (YouTube/Spotify APIs, the network), not your own pure functions. Prefer real objects (the `tmp_path` SQLite DB) over mocks when they are cheap — sortarr's web tests run against a real in-process SQLite DB for exactly this reason.

```python
def test_skips_on_api_error(monkeypatch):
    def boom(*_): raise TimeoutError
    monkeypatch.setattr(client, "get_playlist", boom)
    # monkeypatch auto-reverts after the test — no manual cleanup
```

- `monkeypatch` for attributes/env/dicts (auto-reverted).
- `unittest.mock.AsyncMock` for awaitables; a plain `Mock` returns a coroutine-less value and the `await` fails.
- For httpx, prefer `pytest-httpx`'s `httpx_mock` or `respx` over patching internals — patch the transport, not the call site.

## Coverage and CI

```bash
pytest                       # all tests
pytest -k "match and not slow"   # filter by name expression
pytest -x --ff               # stop at first failure, failed-first ordering
pytest -q tests/test_match.py::test_fuzzy_match   # one test
pytest --cov=src --cov-report=term-missing        # coverage with missing lines
```

Coverage is a floor, not a goal: 100% coverage with no assertions tests nothing. Chase uncovered *branches* that carry risk, not the percentage.

## Common mistakes

| Mistake | Fix |
| --- | --- |
| `async def` test with no `asyncio_mode`/marker | Test is silently skipped or errors. Set `asyncio_mode = "auto"` or mark it. |
| `Mock()` where an `await` happens | Use `AsyncMock`; a sync Mock isn't awaitable. |
| `session`-scoped mutable fixture | Tests leak state and depend on order. Default to `function` scope. |
| Loop over cases in one test | Use `parametrize` so each case runs and reports independently. |
| Mocking your own pure logic | Mock only I/O boundaries; test real logic directly. |
| Shared session/file DB across tests | Give each test its own DB via `tmp_path` (function scope); a shared file leaks state and throws `database is locked` under parallel workers. |
| `assertEqual`/`TestCase` boilerplate | Use plain `assert`; pytest rewrites it with rich diffs. |

## References

- [pytest documentation](https://docs.pytest.org/)
- [pytest-asyncio](https://pytest-asyncio.readthedocs.io/)
- [pytest-httpx](https://github.com/Colin-b/pytest_httpx)
