# golang-concurrency Quality Assurance

Critic-only adversarial contract. Assume competent production and normal review have already occurred; attack residual false confidence without creating new authority.

## QA criteria

Critic constructs alternate schedules: cancel while blocked, close while sender is active, duplicate completion, slow consumer, worker error during fan-out, shutdown with queued work, and repeated start/stop. Probe deadlock, send-on-closed/double-close, goroutine leaks, unbounded growth, stale shared state, and starvation.

Any plausible execution that violates a mandatory invariant, leaks unbounded resources, deadlocks a required path, or silently loses/duplicates protected work is blocking. Lack of maximal parallelism or a conservative lock is not a blocker by itself.

## QA depth

Increase depth sharply with shared mutable state, fan-out/queues, nested concurrency, cancellation/shutdown, ordering guarantees, external side effects, and consequence of duplicate/lost work.
