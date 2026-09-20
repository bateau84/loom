# behavioral-spec Reviewer Assessment

Reviewer-only domain contract. It does not create Loom authority, product meaning, or proof.

## Review criteria

- Every normative behavior is observable/falsifiable without depending on a chosen implementation.
- Preconditions, ordering/precedence, continuation/termination, failure, cancellation, timeout, and recovery semantics are explicit when applicable.
- Edge combinations that change outcomes are covered rather than delegated implicitly to implementation.
- Structural choices are absent unless already accepted as product behavior.
- Missing product meaning remains unresolved/routed rather than silently normalized.
- Acceptance scenarios can map back to concrete behavioral statements.

## Review depth

Scale review depth with consequence, uncertainty, boundary count, and blast radius.
