# architectural-spec Quality Assurance

Critic-only adversarial contract. Assume competent production and Reviewer conformance have already occurred; attack residual false confidence without creating new authority.

## QA criteria

- Give two competent implementers the spec mentally: could they build incompatible components that each satisfy the text?
- Attack unspecified atomicity, ordering, idempotency, ownership, timeout, or compatibility behavior at seams.
- Look for contracts that are exact on happy-path types but vague on lifecycle and failure transitions.
- Test upgrade/restart/partial-deployment states where two versions interact.
- Search for implementation details accidentally frozen as architecture without evidence they are load-bearing.

## QA depth

Increase QA depth where a shared wrong assumption could survive both competent production and normal review.
