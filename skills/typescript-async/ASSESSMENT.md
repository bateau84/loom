# typescript-async Reviewer Assessment

Reviewer-only domain contract. It does not create Loom authority, product meaning, or proof.

## Review criteria

Reviewer verifies async lifecycle and concurrency rather than merely checking that happy-path awaits exist:

- every started Promise is awaited, returned, or intentionally detached with explicit rejection and shutdown/lifetime ownership;
- async collection code uses sequential, fail-fast parallel, best-effort parallel, or bounded concurrency according to the actual contract rather than async forEach or accidental fan-out;
- values read before await are not used after await as though shared state could not change;
- stale or superseded operations cannot commit a late result when newer work owns the state;
- AbortSignal or equivalent cancellation is propagated through supporting APIs and abort listeners/resources are cleaned up;
- timeout/race code accounts for losing operations continuing after Promise.race;
- finally/cleanup paths release timers, listeners, streams, locks, child processes, or temporary resources on success, failure, and cancellation;
- Promise.all, allSettled, race, and any semantics match the required continuation/failure behavior;
- retries are bounded, cancellable, and safe with respect to duplicate side effects;
- errors remain attached to the owning operation instead of being swallowed into false success.
