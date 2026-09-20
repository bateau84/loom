# architectural-design Reviewer Assessment

Reviewer-only domain contract. It does not create Loom authority, product meaning, or proof.

## Review criteria

- Accepted obligations map to explicit components/boundaries without inventing product behavior.
- Data, control, state ownership, lifecycle, trust, failure, and evidence flows are coherent across boundaries.
- Public seams are smaller than internal complexity and ownership is unambiguous.
- Persistence and concurrency boundaries preserve accepted invariants.
- Load-bearing verification is concrete and persisted when required.
- Semantic gaps are surfaced instead of converted into architecture policy.

## Review depth

Scale review depth with consequence, uncertainty, boundary count, and blast radius.
