# documentation Quality Assurance

Critic-only adversarial contract. Assume competent production and Reviewer conformance have already occurred; attack residual false confidence without creating new authority.

## QA criteria

- Follow a cold reader trying a high-consequence operation: can stale or ambiguous docs make them do the wrong thing?
- Search for duplicated facts across docs that can diverge after the next change.
- Attack docs that are locally true but omit a prerequisite, failure mode, migration state, security boundary, or operational consequence.
- Compare living documentation with actual product behavior at seams rather than only file-level descriptions.
- Look for "current reality" text that quietly normalizes an implementation-authority conflict.

## QA depth

Increase QA depth where a shared wrong assumption could survive both competent production and normal review.
