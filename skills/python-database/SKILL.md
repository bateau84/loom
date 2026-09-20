---
name: python-database
description: "Python database access with stdlib `sqlite3` — parameterized queries, connection context managers, `sqlite3.Row` factory, transactions, the repository pattern, schema migrations via `PRAGMA user_version`, and SQLite pragmas (WAL, foreign_keys). Use when writing or reviewing SQLite code, building a repository over a file-based embedded DB, running migrations on a local SQLite file, or any time the user mentions `sqlite3`, WAL, or `aiosqlite`. Not for SQLAlchemy, Django ORM, PostgreSQL, MySQL, or async server-side DBs (→ See `python-database-orm`)."
license: MIT
metadata:
  author: Bateau
  version: "1.1.0"
---

> **House skill.** Follow `python-common-practice` and `current Loom role directive and control-plane state`. Pairs with `python-error-handling` and `python-testing` (real-DB fixtures).

**Persona:** You are a Python engineer who keeps SQL at the edge. The rest of the app talks to a repository, never to a cursor.

# SQLite with `sqlite3`

The stdlib `sqlite3` module is enough for an embedded DB — no ORM required. Keep all SQL behind a repository so the rest of the code depends on methods, not on the schema. This is sortarr's `db/{connection,migrations,repository}` layout.

## Parameterize every query — never format SQL

String-formatting user input into SQL is the classic injection vulnerability. Pass parameters with `?` placeholders; the driver escapes them safely.

```python
# ✗ Bad — SQL injection; an attacker controls the query
cur.execute(f"SELECT * FROM tracks WHERE id = '{track_id}'")

# ✓ Good — parameterized; value can never alter the query
cur.execute("SELECT * FROM tracks WHERE id = ?", (track_id,))
cur.execute("INSERT INTO tracks (id, title) VALUES (?, ?)", (tid, title))
```

Use `?` (qmark) placeholders, or `:name` with a dict. **Identifiers** (table/column names) can't be parameterized — if they're dynamic, validate them against an allow-list, never interpolate raw input.

## Connections via a context manager

Open and close connections deterministically with a context manager — leaked connections lock the file. sortarr's `get_connection` is the model: `sqlite3.Row` factory, error logged-and-re-raised, `close()` in `finally`.

```python
from contextlib import contextmanager
import sqlite3

@contextmanager
def get_connection(db_path: str):
    con = sqlite3.connect(db_path)
    con.row_factory = sqlite3.Row     # rows behave like dicts: row["title"]
    try:
        yield con
    finally:
        con.close()
```

`row_factory = sqlite3.Row` lets you access columns by name (`row["title"]`) instead of brittle positional indexing (`row[1]`) — adding a column won't silently shift your fields.

## Transactions — commit or roll back as a unit

`sqlite3` opens an implicit transaction; **nothing persists until `commit()`**. Wrap a multi-statement change so a failure rolls back cleanly. The connection used as a context manager commits on success and rolls back on exception:

```python
with get_connection(db_path) as con:
    with con:                                  # commit on success, rollback on exception
        con.execute("INSERT INTO runs (started) VALUES (?)", (now,))
        con.execute("UPDATE state SET last_run = ?", (now,))
```

Note the two `with`s do different jobs: the outer closes the connection; the inner (`with con:`) is the transaction boundary.

## Repository pattern

Expose intent-named methods, not SQL, so callers (and the FastAPI layer) never touch a cursor. Type the repository against a `Protocol` so tests can substitute a fake (→ See `python-type-checking`).

```python
class Repository:
    def __init__(self, con: sqlite3.Connection):
        self._con = con

    def save_decision(self, d: MatchDecision) -> None:
        self._con.execute(
            "INSERT OR REPLACE INTO decisions (video_id, verdict) VALUES (?, ?)",
            (d.video_id, d.verdict),
        )

    def decision_for(self, video_id: str) -> MatchDecision | None:
        row = self._con.execute(
            "SELECT video_id, verdict FROM decisions WHERE video_id = ?", (video_id,)
        ).fetchone()
        return MatchDecision(**row) if row else None
```

Return `None` for "not found" — that's expected absence, not an error (→ See `python-error-handling`).

## Migrations

Apply schema changes idempotently at startup with a versioned migration runner (`PRAGMA user_version`), so the app self-migrates and there's no separate command. Each migration runs once, in order, inside a transaction. Use `CREATE TABLE IF NOT EXISTS` and additive `ALTER TABLE` so re-running is safe.

## Pragmas worth setting

```python
con.execute("PRAGMA foreign_keys = ON")     # off by default in sqlite3 — enforce FKs
con.execute("PRAGMA journal_mode = WAL")    # concurrent readers + a writer; better throughput
```

`foreign_keys` is **off by default** — turn it on per connection or referential integrity isn't enforced.

## Sync `sqlite3` on an async event loop

The stdlib `sqlite3` API is **blocking**. Calling it directly inside an `async def` FastAPI handler stalls the event loop for the whole query — every other in-flight request waits. SQLite is also single-writer: concurrent writers serialize on a file lock, so one slow write blocks the rest. Keep DB work off the loop one of two ways:

```python
# ✓ A plain `def` handler — FastAPI runs it in a threadpool, off the loop
@router.get("/stats")
def get_stats(repo: Repository = Depends(get_repo)) -> StatsOut:
    return repo.stats()                       # blocking sqlite is fine here

# ✓ Inside an async handler, offload the blocking call
from starlette.concurrency import run_in_threadpool

@router.get("/decisions/{vid}")
async def get_decision(vid: str, repo=Depends(get_repo)) -> DecisionOut:
    row = await run_in_threadpool(repo.decision_for, vid)   # or asyncio.to_thread
    ...
```

Don't share one connection across tasks or threads — `sqlite3` connections aren't safe for concurrent use. Open per request (or per job), or use a thread-aware pool. In an APScheduler job, open the connection **inside** the job, not once at import time (→ See `python-async`).

## Common mistakes

| Mistake | Fix |
| --- | --- |
| f-string / `%`-format SQL with input | Use `?` placeholders; never interpolate values. |
| Forgetting `commit()` | Use `with con:` for the transaction, or commit explicitly. |
| Positional `row[1]` access | `con.row_factory = sqlite3.Row`; access by name. |
| Connection never closed | Open via a context manager; close in `finally`. |
| Assuming FK constraints enforced | `PRAGMA foreign_keys = ON` per connection. |
| SQL scattered across the app | Confine it to a repository; callers use methods. |
| Blocking `sqlite3` call inside an `async def` handler | Use a `def` handler (threadpool) or `await run_in_threadpool(...)` / `asyncio.to_thread`. |
| Sharing one connection across tasks/threads | Open per request or per job; `sqlite3` connections aren't concurrency-safe. |
| Mocking the DB in tests | Use a real `tmp_path` SQLite DB — it's fast and catches SQL errors. |

**Diagnose:** 1- `ruff`/`bandit` — flag string-formatted SQL (`S608`) 2- `EXPLAIN QUERY PLAN <sql>` — confirm an index is used before "optimizing" 3- run the test suite against a real `tmp_path` DB — SQL typos surface immediately.

## References

- [sqlite3 — DB-API 2.0 interface for SQLite](https://docs.python.org/3/library/sqlite3.html)
- [PEP 249 — Python Database API 2.0](https://peps.python.org/pep-0249/)
- [SQLite — Write-Ahead Logging](https://www.sqlite.org/wal.html)
- [Starlette — run_in_threadpool](https://www.starlette.io/concurrency/)
