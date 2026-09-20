# golang-structs-interfaces Reviewer Assessment

Reviewer-only domain contract. It does not create Loom authority, product meaning, or proof.

## Review criteria

Reviewer checks type design preserves Go method-set/zero-value/ownership semantics:

- interfaces are minimal and consumer-owned; implementation types are not forced to depend on abstractions created only for mocking;
- pointer vs value receiver choice preserves mutability, method-set satisfaction, and avoids copying mutexes/large state/invariants;
- typed-nil pointers stored in interfaces cannot produce surprising non-nil interface behavior at boundaries;
- embedding/promoted methods/fields do not accidentally expose API or ambiguous ownership; composition remains deliberate;
- exported fields do not let callers bypass invariants that constructors/methods are meant to enforce;
- zero value is useful or invalid states are prevented/documented; constructors are not ceremony only;
- comparability/map-key, JSON/encoding, generics constraints, and equality implications are considered where the type crosses those boundaries;
- public interface changes account for source compatibility and implementation burden.
