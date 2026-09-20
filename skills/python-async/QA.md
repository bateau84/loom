# python-async Quality Assurance

Critic-only adversarial contract. Assume competent production and normal review have already occurred; attack residual false confidence without creating new authority.

## QA criteria

Critic cancels during every await boundary, fails one sibling, slows a consumer, times out a shielded operation, and injects blocking work. Probe “Task exception was never retrieved”, orphan tasks, swallowed cancellation, event-loop starvation, unbounded queues, and cleanup that is skipped or itself canceled incorrectly.

Block when a plausible schedule/cancellation can violate a mandatory invariant, leak unbounded work/resources, duplicate protected side effects, or make the service unresponsive. Choice of async construct is non-blocking when lifecycle semantics are sound.

## QA depth

Increase depth with task fan-out, background tasks, nested timeouts, queues/backpressure, external side effects, async resource management, and consequence of cancellation/duplicate work.
