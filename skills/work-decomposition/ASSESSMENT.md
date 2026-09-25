# work-decomposition Reviewer Assessment

Reviewer-only domain contract. It does not create Loom authority, product meaning, or proof.

## Review criteria

- Task boundaries follow coherent capabilities/modules rather than file counts.
- Dependencies reflect real semantic/build/integration order and avoid artificial serialization.
- Parallel tasks have non-overlapping write surfaces or an explicit ordering dependency.
- Integration work and cross-boundary verification have clear ownership.
- A Task's executable write scope is sufficient for every implementation, integration, documentation, and verification obligation it owns; otherwise that responsibility is explicitly assigned elsewhere.
- Every accepted obligation assigned to a Task is represented by its outcome, constraints, acceptance criteria, integration contract, or explicit proof path rather than merely appearing in an ownership map.
- Acceptance criteria are falsifiable and sufficient to prove the Task's stated outcome; a Task must be executable as written without silently requiring mutation outside its allowed surface.
- Cross-Task responsibilities are not left ownerless between Task boundaries.
- Authority artifacts remain inputs, never Worker write scope.
- Each task can state an objective and verification expectation without duplicating sibling work.

## Review depth

Scale review depth with consequence, uncertainty, boundary count, and blast radius.
