# work-decomposition Reviewer Assessment

Reviewer-only domain contract. It does not create Loom authority, product meaning, or proof.

## Review criteria

- Task boundaries follow coherent capabilities/modules rather than file counts.
- Dependencies reflect real semantic/build/integration order and avoid artificial serialization.
- Parallel tasks are ordered only by real semantic or execution dependencies. Overlapping bounded write scopes are acceptable by themselves because runtime file locks serialize concrete mutations; flag overlap only when it exposes ambiguous ownership, conflicting outcomes, or a missing dependency.
- Integration work and cross-boundary verification have clear ownership.
- When executable Tasks have been compiled, a Task's write scope is sufficient for every implementation, integration, documentation, and verification obligation it owns; otherwise that responsibility is explicitly assigned elsewhere. In an explicitly planning-only review, executable scopes are intentionally deferred and their absence is not a defect, but the semantic Task contract must be clear enough to compile a bounded scope later without inventing new product meaning.
- Every accepted obligation assigned to a Task is represented by its outcome, constraints, acceptance criteria, integration contract, or explicit proof path rather than merely appearing in an ownership map.
- Acceptance criteria are falsifiable and sufficient to prove the Task's stated outcome. When an executable scope exists, the Task can be executed without silently requiring mutation outside that surface; in planning-only mode, its semantic contract is specific enough for a later Planner to derive that bounded executable surface without inventing new meaning.
- Cross-Task responsibilities are not left ownerless between Task boundaries.
- Authority artifacts remain inputs, never Worker write scope.
- Each task can state an objective and verification expectation without duplicating sibling work.

## Review depth

Scale review depth with consequence, uncertainty, boundary count, and blast radius.
