# product-acceptance Quality Assurance

Critic-only adversarial contract. Assume competent production and Reviewer conformance have already occurred; attack residual false confidence without creating new authority.

## QA criteria

- Construct the easiest fake product that could pass the scenario set and identify what remains unproven.
- Attack seams where fixtures, mocks, clocks, networks, or seeded state accidentally implement the behavior under test.
- Look for assembled paths that work only because setup bypasses production initialization, auth, persistence, routing, or recovery.
- Test scenario coverage against Anchor outcomes rather than implementation features.
- Seek stale/correlated evidence where many PASS results ultimately rely on the same unproven assumption.

## QA depth

Increase QA depth where a shared wrong assumption could survive both competent production and normal review.
