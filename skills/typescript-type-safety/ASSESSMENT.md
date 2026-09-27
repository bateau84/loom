# typescript-type-safety Reviewer Assessment

Reviewer-only domain contract. It does not create Loom authority, product meaning, or proof.

## Review criteria

Reviewer verifies that the compiler is proving useful invariants rather than being neutralized:

- any, assertions, double assertions, non-null operators, ignores, and ambient declarations are narrow, justified, and backed by an actual invariant;
- untrusted JSON, environment/config, persistence, tool/plugin input, browser storage, network data, and loosely typed third-party values receive runtime validation before being treated as trusted domain types;
- custom type predicates validate the complete property set or invariant their value-is-T claim promises;
- discriminated unions represent reachable states and closed unions are handled exhaustively without a catch-all that hides new variants;
- optional/missing/undefined semantics match runtime behavior and patch/update logic preserves valid false, 0, and empty-string values;
- indexed access and Map/object lookups respect possible absence, especially when noUncheckedIndexedAccess or mutation makes it visible;
- generic constraints and return relationships match what the implementation can actually produce;
- schema-derived/generated types do not drift from duplicate hand-authored definitions;
- structural assignability, excess-property checks, and same-shaped domain types are not treated as exact or nominal guarantees; runtime exactness is validated where required and compile-time brands/opaque types are used only when the domain distinction warrants them;
- type-level tests, when used, fail for the intended compile-time reason rather than merely suppressing diagnostics.
