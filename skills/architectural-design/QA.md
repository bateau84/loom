# architectural-design Quality Assurance

Critic-only adversarial contract. Assume competent production and Reviewer conformance have already occurred; attack residual false confidence without creating new authority.

## QA criteria

- Attack interactions between individually sound components: partial failure, restart, concurrency, retry, cancellation, backpressure, and stale state.
- Look for shared assumptions about ordering, time, identity, durability, or trust that no single component owns.
- Remove or degrade one dependency and ask whether failure containment matches accepted outcomes.
- Search for architecture that passes local tests but cannot prove the assembled invariant.
- Challenge seams where authority/security/evidence crosses process, persistence, network, or privilege boundaries.

## QA depth

Increase QA depth where a shared wrong assumption could survive both competent production and normal review.
