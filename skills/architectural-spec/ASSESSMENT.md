# architectural-spec Reviewer Assessment

Reviewer-only domain contract. It does not create Loom authority, product meaning, or proof.

## Review criteria

- The specification traces to accepted behavior and parent architecture and does not create an unapproved structural mechanism or product semantic.
- Exact names, fields, types, validation, ordering, state transitions, ownership, errors, and extension/unknown behavior are implementation-ready where applicable.
- Atomicity, idempotency, concurrency, durability, timeout/retry representation, and partial-operation behavior are explicit when material to the seam.
- Two independent competent implementers could build interoperable sides of the contract without guessing the same unstated rule.
- Failure/lifecycle semantics are as precise as the happy path and remain consistent with accepted authority.
- Compatibility, migration, mixed-version behavior, and persisted old/new state are specified where coexistence is possible.
- Security boundaries specify validation/authorization placement, secret exposure/logging, replay controls, and failure behavior where relevant.
- Verification hooks cover load-bearing invariants, transitions, failures, compatibility, and real composition rather than only schema syntax.

## Review depth

Scale review depth with consequence, interoperability surface, statefulness, and blast radius.
