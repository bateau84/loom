# obligation-contract Reviewer Assessment

## Review criteria

- The seam actually warrants a durable shared semantic contract; the OC is not ceremony for private internals.
- Participants are semantic responsibilities and can be realized independently without freezing architecture.
- Preconditions, guarantees, semantic input/output, failure semantics, and invariant are mutually coherent and implementation-independent.
- Shared ordering, retry, duplication, idempotency, cancellation, lifecycle, authority, evidence, and recovery semantics are explicit where correctness depends on agreement.
- Every consequential guarantee has legitimate semantic authority; architecture merely revealing a seam has not become source authority.
- The OC does not weaken or contradict related BRs/QSs or accepted Designer semantics.
- Verification semantics exercise the actual participating boundary and close the claimed guarantee.
- Concrete schema/API/protocol details are absent unless externally authoritative.

## Review depth

Scale with independent implementation, security/authority consequence, failure ambiguity, and cross-party state/lifecycle complexity.
