# python-async Assessment Contract

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

## Adjudication criteria

Critic cancels during every await boundary, fails one sibling, slows a consumer, times out a shielded operation, and injects blocking work. Probe “Task exception was never retrieved”, orphan tasks, swallowed cancellation, event-loop starvation, unbounded queues, and cleanup that is skipped or itself canceled incorrectly.

Block when a plausible schedule/cancellation can violate a mandatory invariant, leak unbounded work/resources, duplicate protected side effects, or make the service unresponsive. Choice of async construct is non-blocking when lifecycle semantics are sound.

## Scaling

Increase depth with task fan-out, background tasks, nested timeouts, queues/backpressure, external side effects, async resource management, and consequence of cancellation/duplicate work.