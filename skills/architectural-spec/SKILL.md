---
name: architectural-spec
description: Define exact implementation-facing APIs, schemas, protocols, configuration shapes, messages, and interfaces after Loom architecture decisions are settled.
---

# Architectural Specification

Use this skill when behavior and structural choices are accepted and implementation needs an exact contract.

## Boundary

A specification realizes architecture; it does not create new architecture or product semantics. If exact specification reveals the need for a new store, protocol family, compatibility layer, lifecycle state, trust boundary, synchronization mechanism, or other material structural choice, return to design/decision work. Route missing observable semantics to the owning authority.

## Method

1. **Trace authority.** Identify the accepted behavior and parent architecture this contract realizes, plus any authoritative external protocol or current compatibility surface.
2. **State structural constraints.** Capture only falsifiable constraints that matter: versioning, ordering, atomicity, idempotency, durability, size/latency bounds, validation, serialization, authentication/authorization placement, or compatibility.
3. **Define the exact contract.** Specify names, fields, types, ranges/units, required/optional rules, methods/operations, messages, ordering, state transitions, validation, error representation, and unknown/extension behavior as applicable.
4. **Make invariants and ownership explicit.** State which side owns state and transitions, what must remain true, and any concurrency/atomicity boundary. Do not leave lifecycle or failure transitions implicit behind precise happy-path types.
5. **Specify failure behavior structurally.** Define error classes/statuses, retry/idempotency requirements where architecture already establishes them, partial-operation behavior, and what callers may safely infer. For identity-sensitive idempotency/deduplication seams, make the request identity/equivalence rule, atomic claim/commit boundary, simultaneous-contender arbitration, and the observable result for every contender explicit. "At most one object exists", "duplicates converge", or equivalent state-only guarantees are insufficient when callers could still observe incompatible outcomes.
6. **Define compatibility and evolution.** When versions or persisted states can coexist:
   - separate **reader acceptance** from **producer emission** rules;
   - distinguish unknown optional extension data from unknown required meaning;
   - specify which types/versions/semantic variants a newer producer may emit while older supported consumers still coexist;
   - define explicit handling for unsupported required meaning, unknown discriminators/types, rollback, and persisted old/new state.
   Do not invent rollout policy that parent architecture/product authority has not settled; surface the missing authority when exact emission/admission behavior is not derivable.
7. **Define security surface when applicable.** State trust boundary, authority/data crossing it, validation/authorization point, secret visibility/logging rules, replay controls, and failure behavior.
8. **Run the two-implementer test.** Two competent implementers reading only this specification should produce interoperable components. If materially incompatible implementations could both satisfy the text, tighten the contract.
9. **Define conformance evidence.** Name the smallest set of tests/proofs covering load-bearing invariants, transitions, edge cases, failures, compatibility, and real composition. When interoperability between independently implemented sides is load-bearing, include at least one composition check that exercises those real sides together rather than proving only schema syntax or one-sided behavior. Persist load-bearing downstream verification through Loom when needed.

Separate normative contract from examples. Prefer the smallest exact interface that removes material ambiguity.

## Durable specification shape

Use the sections that apply:

```markdown
## Derived from
## Satisfies
## Implements
## Scope
## Structural constraints
## Interface / schema / protocol
## Invariants and lifecycle
## Failure behavior
## Compatibility and evolution
## Security surface
## Verification
## Open questions
```

Examples are non-normative unless explicitly stated otherwise.
