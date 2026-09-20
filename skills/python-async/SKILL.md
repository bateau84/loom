---
name: python-async
description: "Asynchronous Python with asyncio and async/await — coroutines, tasks, TaskGroup, gather, cancellation, timeouts, async context managers, concurrency limits with Semaphore, the httpx.AsyncClient, and not blocking the event loop. Use when writing or reviewing async def code, calling async HTTP APIs, running concurrent I/O, scheduling background jobs (APScheduler), or debugging a hung/blocked event loop. Also use when the user mentions asyncio, await, coroutine, event loop, httpx, aiohttp, or async concurrency."
license: MIT
metadata:
  author: Bateau
  version: "1.1.0"
---

> **House skill.** Follow `python-common-practice` and `current Loom role directive and control-plane state`.

**Persona:** You are a Python async engineer. You treat the event loop as a single thread you must never block, and you make concurrency explicit.

# Asynchronous Python

`async`/`await` gives concurrency for **I/O-bound** work (HTTP, DB, files) on one thread. It does nothing for CPU-bound work — a tight loop inside `async def` freezes the whole loop. Reach for async when you wait on the network, not when you crunch numbers.

## The cardinal rule: never block the loop

A single synchronous call inside a coroutine stalls every other task. Diagnose these with ruff's `ASYNC` rules (→ See `python-lint`).

```python
# ✗ Bad — blocks the event loop; all concurrent tasks freeze
async def fetch(url):
    return requests.get(url).json()          # sync I/O
    time.sleep(5)                            # sync sleep

# ✓ Good — yields control while waiting
async def fetch(client: httpx.AsyncClient, url):
    resp = await client.get(url)
    return resp.json()
    # await asyncio.sleep(5)  for delays
```

For unavoidable blocking work (a sync library, CPU work), offload it: `await asyncio.to_thread(blocking_fn, arg)`. This keeps the loop responsive.

## Run things concurrently — explicitly

`await`ing calls one after another is sequential. To overlap, create tasks. Prefer `asyncio.TaskGroup` (3.11+): it cancels siblings on failure and propagates errors, so you never leak orphaned tasks.

```python
async def fetch_all(client, ids):
    async with asyncio.TaskGroup() as tg:        # structured concurrency
        tasks = [tg.create_task(fetch(client, i)) for i in ids]
    return [t.result() for t in tasks]           # all done, errors already raised
```

`asyncio.gather(*coros)` still works but, unless `return_exceptions=True`, a failure leaves the other tasks running unawaited. Prefer `TaskGroup` for new code.

## Bound concurrency — don't DoS the upstream

Unbounded `gather` over thousands of items opens thousands of sockets and gets you rate-limited. Cap it with a `Semaphore`.

```python
async def fetch_bounded(client, ids, limit=10):
    sem = asyncio.Semaphore(limit)
    async def one(i):
        async with sem:                  # at most `limit` in flight
            return await fetch(client, i)
    async with asyncio.TaskGroup() as tg:
        tasks = [tg.create_task(one(i)) for i in ids]
    return [t.result() for t in tasks]
```

This mirrors sortarr's `pipeline_concurrency` setting — a configurable cap, not unbounded fan-out.

## Timeouts and cancellation

Every network call needs a deadline, or one hung upstream hangs your service. Use `asyncio.timeout` (3.11+) as a context manager; it cancels the body on expiry.

```python
async with asyncio.timeout(30):
    data = await fetch(client, url)
```

Cancellation arrives as `asyncio.CancelledError`. **Never swallow it** — let it propagate so structured concurrency can unwind. If you must clean up, re-raise:

```python
try:
    await long_op()
except asyncio.CancelledError:
    await cleanup()
    raise                         # ✓ propagate; swallowing breaks cancellation
```

## httpx — reuse one client

Create one `AsyncClient` per app/lifespan and share it; a fresh client per request throws away connection pooling and TLS reuse. Always close it (or use it as a context manager).

```python
async with httpx.AsyncClient(timeout=30) as client:
    ...        # reuse across many requests
```

## Background scheduling (APScheduler)

For periodic jobs, use `AsyncIOScheduler` so jobs share the app's loop rather than spawning threads. Job functions are coroutines; keep them idempotent (a missed/overlapping run shouldn't corrupt state) and let `misfire_grace_time`/`max_instances=1` guard against pile-ups.

## Common mistakes

| Mistake | Fix |
| --- | --- |
| `requests`/`time.sleep`/sync DB inside `async def` | Use async equivalents or `asyncio.to_thread`; ruff `ASYNC` flags these. |
| Sequential `await` in a loop for independent calls | Fan out with `TaskGroup`; await once. |
| Unbounded `gather` over a large list | Bound with `asyncio.Semaphore`. |
| `except CancelledError: pass` | Re-raise it; swallowing it breaks shutdown and timeouts. |
| New `httpx.AsyncClient` per call | One shared client per lifespan; reuse the pool. |
| `asyncio.run()` called from inside a running loop | You're already on the loop; just `await`. |
| Calling a coroutine without `await` | Returns a coroutine object that never runs (and warns). Await it or make it a task. |

**Diagnose:** 1- `ruff check` with the `ASYNC` rule set — finds blocking calls in coroutines 2- run with `PYTHONASYNCIODEBUG=1` — surfaces un-awaited coroutines and slow callbacks 3- `py-spy dump --pid <pid>` — see where a hung event loop is stuck.

## References

- [asyncio — Asynchronous I/O](https://docs.python.org/3/library/asyncio.html)
- [Coroutines and Tasks](https://docs.python.org/3/library/asyncio-task.html)
- [httpx — Async usage](https://www.python-httpx.org/async/)
- [APScheduler documentation](https://apscheduler.readthedocs.io/)
