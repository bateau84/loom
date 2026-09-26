# architectural-spec Quality Assurance

Critic-only adversarial contract. Assume competent production and Reviewer conformance have already occurred; attack residual false confidence without creating new authority.

## QA criteria

- Give two competent implementers the spec mentally: find any place they could make incompatible choices while each still satisfies the text.
- Attack unspecified atomicity, ordering, concurrency, idempotency, ownership, timeout, retry, cancellation, or partial-commit behavior at seams.
- For idempotency/deduplication, probe same idempotency key + equivalent request concurrently, same idempotency key + conflicting request concurrently, winner commits while a loser remains in flight, crash around commit/ack, and timeout/retry while the first attempt is unresolved. Reject contracts that only guarantee one stored object while leaving contender-visible outcomes or request equivalence ambiguous.
- Look for contracts that are exact on happy-path types but vague on lifecycle, failure transitions, or what callers may infer after uncertainty.
- Test restart, replay, duplicate delivery, stale reads, unknown fields, malformed input, boundary values, and interrupted operations where applicable.
- Test upgrade, downgrade, rollback, and partial-deployment states where two versions or persisted formats interact.
- Search for authorization or validation gaps between parsing, admission, state mutation, and effect execution.
- Check whether examples accidentally contradict or broaden the normative contract.
- Search for implementation details accidentally frozen as architecture, or new architecture smuggled into a specification without a parent decision.
- Challenge conformance evidence that proves syntax while missing assembled behavior.

## QA depth

Increase QA depth where a shared wrong assumption could survive both competent production and normal review.
