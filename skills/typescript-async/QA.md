# typescript-async Quality Assurance

Critic-only adversarial contract. Assume competent production and normal review have already occurred; attack scheduler-dependent false confidence.

## QA criteria

Critic changes completion order and lifecycle timing:

- pause each awaited dependency and let a competing call mutate shared state before releasing it;
- reject each concurrent leg independently and after other legs have already produced side effects;
- cancel before start, during I/O, immediately after I/O, and just before result commit;
- let a timeout/race loser complete late and observe whether it mutates state or leaks resources;
- invoke the same operation concurrently, rapidly supersede it, and repeat cancellation/retry cycles;
- make cleanup fail while the primary operation also fails and inspect which error/outcome survives;
- run with an empty, one-item, and very large collection to expose accidental unbounded fan-out;
- observe unhandled rejections, lingering timers/listeners/processes, and work that survives owner shutdown.

Block when correctness depends on the ordinary scheduler order rather than an explicit ownership/state rule. Do not require cancellation for an API that cannot support it when stale-result suppression is sufficient and accepted.

## QA depth

Increase depth for control planes, persistent state mutation, request deduplication, search/typeahead, process management, retrying side effects, caches, locks, and any code with "latest request wins" semantics.
