# architectural-design Quality Assurance

Critic-only adversarial contract. Assume competent production and Reviewer conformance have already occurred; attack residual false confidence without creating new authority.

## QA criteria

- Attack interactions between individually sound components: partial failure, restart, concurrency, retry, cancellation, backpressure, stale state, and mixed old/new state.
- Search for silent false-positive/false-negative paths where the architecture reports success, safety, freshness, or authorization without the claimed invariant actually holding.
- Look for shared assumptions about ordering, time, identity, durability, ownership, or trust that no component truly enforces.
- Remove, delay, duplicate, or degrade one dependency and ask whether containment and recovery still match accepted outcomes.
- Attack incomplete inverse paths: write without reliable read, acquire without release, publish without reconcile, dispatch without cancel, create without safe removal.
- Search for authority/evidence laundering across persistence, process, network, plugin/tool/MCP, or privilege boundaries.
- Challenge whether a materially simpler architecture or omitted viable option changes the tradeoff frontier; do not demand complexity merely for hypothetical threats.
- Test whether the claimed invariant survives real assembled composition rather than only component-level verification.

## QA depth

Increase QA depth where a shared wrong assumption could survive both competent production and normal review.
