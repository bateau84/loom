# golang-structs-interfaces Assessment Contract

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

## Adjudication criteria

Critic tries typed nil, interface substitution, value copying, embedding name conflicts, zero construction, serialization round trip, and future implementation extension. Ask whether the type boundary encodes the architecture or accidentally fights it.

Block public/architectural contract violations, invariant bypass, unsafe copying, or nil-interface traps with material consequence. Interface-vs-concrete preference alone is non-blocking.

## Scaling

Increase depth with exported interfaces, number of implementations, mutable/concurrent state, serialization/comparability, embedding, and architectural boundary significance.