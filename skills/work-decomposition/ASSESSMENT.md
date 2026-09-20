# work-decomposition Reviewer Assessment

Reviewer-only domain contract. It does not create Loom authority, product meaning, or proof.

## Review criteria

- Task boundaries follow coherent capabilities/modules rather than file counts.
- Dependencies reflect real semantic/build/integration order and avoid artificial serialization.
- Parallel tasks have non-overlapping write surfaces or an explicit ordering dependency.
- Integration work and cross-boundary verification have clear ownership.
- Authority artifacts remain inputs, never Worker write scope.
- Each task can state an objective and verification expectation without duplicating sibling work.

## Review depth

Scale review depth with consequence, uncertainty, boundary count, and blast radius.
