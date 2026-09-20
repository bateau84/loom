# python-async Reviewer Assessment

Reviewer-only domain contract. It does not create Loom authority, product meaning, or proof.

## Review criteria

Reviewer reconstructs task ownership and cancellation under Python’s event loop:

- coroutines that create tasks also own/join/cancel them or explicitly transfer ownership; bare `create_task` references are not lost to lifecycle ambiguity;
- `TaskGroup`/structured concurrency or equivalent error aggregation preserves sibling cancellation and does not orphan work after one task fails;
- `CancelledError` is re-raised/propagated correctly; broad `except Exception`/cleanup logic does not convert cancellation into success or restart work;
- blocking CPU/synchronous IO is offloaded or bounded so it cannot freeze the event loop;
- semaphores/queues/fan-out and producer/consumer rates are bounded under overload;
- timeouts (`asyncio.timeout`, `wait_for`, shields) have deliberate ownership and do not leak inner tasks or erase cleanup guarantees;
- async context managers/generators/resources close on success, exception, timeout, and cancellation;
- ordering/idempotency/duplicate side-effect semantics survive retries and concurrent completion.
