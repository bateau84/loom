---
name: typescript-async
description: "Asynchronous TypeScript correctness: Promise ownership, awaiting/returning work, async collection patterns, scheduler-sensitive state, cancellation with AbortSignal, cleanup, Promise combinator semantics, timeouts, bounded concurrency, and rejection propagation. Use when a TypeScript change starts, coordinates, cancels, races, retries, or observes asynchronous work."
license: MIT
metadata:
  author: Bateau
  version: "1.0.0"
---

> **House skill.** Pair with typescript-common-practice and javascript-runtime when event-loop semantics are load-bearing. This skill owns async lifecycle and concurrency correctness, not generic testing or browser UX.

## Every Promise needs an owner

For every started async operation, answer who owns its completion and failure.

A Promise should normally be:

- awaited;
- returned to a caller that owns it; or
- deliberately detached under an explicit lifecycle, with rejection handling and shutdown/cancellation behavior.

A floating Promise is not "background work" by default. It is work whose failure and lifetime are unowned.

Use void only when detachment is intentional and the rejection/lifecycle is handled elsewhere; do not use it to silence a linter around accidental fire-and-forget work.

## Async collection operations

Array forEach does not await an async callback.

Choose based on intended semantics:

- sequential dependency/order: for...of with await;
- independent fail-fast work: Promise.all over map;
- independent best-effort work where all outcomes matter: Promise.allSettled or an equivalent explicit collector;
- large or unbounded collections: bounded concurrency rather than starting everything at once.

Make ordering and failure policy visible in the code.

## State can change while awaiting

Every await yields control. Code after await may run after other operations changed shared state.

Before mutating based on pre-await assumptions, ask whether the assumption is still valid.

Typical approaches:

- operate on an immutable snapshot when that is the accepted behavior;
- re-read current state after await;
- compare a generation, version, or request token before committing the result;
- serialize the critical mutation with the repository's existing locking mechanism;
- make the operation idempotent where retries or reordering are expected.

Do not hold logical locks across slow external work unless the design explicitly requires it.

## Cancellation is a lifecycle, not an exception trick

When the underlying API supports AbortSignal, propagate a caller's signal instead of inventing unrelated flags.

- Abort old work when superseded if stale completion would be harmful.
- Treat cancellation as a distinct expected outcome where the product/runtime contract does so.
- Remove abort listeners and other registrations when the operation finishes.
- A timeout implemented with Promise.race does not automatically cancel the losing operation.

If work cannot be cancelled, code must still prevent a late result from committing stale state when that matters.

## Cleanup must run on every exit path

Timers, listeners, temporary resources, child processes, streams, and locks need explicit lifetime ownership.

Use finally when cleanup is required after success and failure. Keep the primary error visible; decide explicitly what happens if cleanup also fails.

For event or listener registration, keep the exact reference needed to unregister it.

## Promise combinators have different contracts

Promise.all:

- preserves input order in its result;
- rejects when one input rejects;
- does not cancel the remaining operations.

Promise.allSettled:

- waits for every input;
- reports each fulfillment/rejection;
- is appropriate only when continuing after individual failure is part of the intended contract.

Promise.race settles from the first settled input but does not stop losers.

Promise.any fulfills from the first fulfillment and rejects only if all inputs reject.

Choose the combinator from the failure and continuation contract, not convenience.

## Timeouts and retries

A timeout should have an actual stop or ignore policy for the underlying work.

Retries need:

- an accepted set of retryable failures;
- a bound on attempts or time;
- backoff/jitter where load amplification matters;
- cancellation propagation;
- idempotency or another duplicate-effect strategy when side effects are possible.

Do not retry programming errors or validation failures by default.

## Error propagation

Await or return Promises so rejection remains attached to the caller's control flow.

When intentionally collecting errors, retain enough context to identify which operation failed. Do not catch-and-log then return success unless accepted semantics explicitly convert the failure.

Unhandled-rejection prevention is not the same as correct error handling; swallowing every rejection hides broken outcomes.

## Testing async behavior

Load typescript-testing for mechanics. High-value async tests control completion order rather than sleeping:

- deferred Promises or manual gates;
- fake clocks for timer logic;
- injected clocks or schedulers when the code owns time;
- AbortController for cancellation;
- multiple concurrent calls for stale-write or race cases.

A test that only exercises the ordinary completion order is weak evidence for scheduler-sensitive code.

## Completion check

Before completing async TypeScript work:

1. Is every Promise awaited, returned, or deliberately owned as detached work?
2. Is collection concurrency/order explicit?
3. Can shared state change across each await?
4. Does cancellation reach the underlying operation where possible?
5. Can timed-out or superseded work still commit a late result?
6. Are listeners, timers, resources, and locks cleaned up on success, failure, and cancellation?
7. Does the chosen Promise combinator match the accepted failure policy?
8. Have tests forced important alternate completion and failure orders?
