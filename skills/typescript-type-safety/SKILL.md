---
name: typescript-type-safety
description: "TypeScript type-safety methodology for runtime boundaries, unknown/any, assertions and non-null operators, narrowing and type guards, discriminated unions, exhaustiveness, optional properties, indexed access, generics, and static-vs-runtime proof. Use when correctness depends on the compiler genuinely proving a state rather than being told to trust one."
license: MIT
metadata:
  author: Bateau
  version: "1.0.0"
---

> **House skill.** Pair with typescript-common-practice. This skill focuses on whether TypeScript's proof is real. It does not replace runtime validation libraries, domain architecture, or browser/framework skills.

## The central rule

A TypeScript type annotation does not change a runtime value.

The compiler can prove relationships among values only from information it has. Assertions, any, suppressions, and dishonest type guards can remove the proof obligation without making the program safer.

Ask of every load-bearing type claim: what code or trusted boundary established this fact?

If the answer is only "we cast it," the fact is not established.

## Unknown at untrusted boundaries

Use unknown for values whose shape is not yet established: parsed JSON, environment-derived structures, network responses, browser storage, message/event payloads, plugin/tool input, and loosely typed third-party values.

Narrow or parse unknown before using it.

- A cast from unknown to T is not runtime validation.
- JSON.parse returning a value that is assigned or cast to T does not make the JSON conform to T.
- Schema libraries are useful when already present or when the boundary warrants them, but a small explicit parser/guard can be better for a narrow shape.
- Keep validation at the boundary so the rest of the module can work with trusted domain types.

Do not spread unchecked unknown data into typed objects.

## Escape hatches are debt, not fixes

The main escape hatches are:

- any;
- assertions;
- double assertions through unknown;
- non-null assertions;
- ts-ignore or ts-expect-error used without a precise negative-test purpose;
- ambient declarations that claim an API exists;
- custom type predicates whose implementation does not prove their predicate.

Use an escape hatch only at a genuinely opaque boundary where the invariant is established elsewhere and cannot be expressed directly. Keep it narrow and explain the proof source.

Prefer object plus narrowing over any when a value is opaque.

## Narrowing must correspond to runtime evidence

Good narrowing checks real discriminants or properties.

- Prefer early guards that eliminate invalid or absent states.
- Use property checks, typeof, instanceof, explicit tag checks, or validated predicates when they match runtime reality.
- A custom predicate claiming value is Foo is trusted by the compiler; its body therefore carries a high proof burden.
- Do not write a predicate that checks one convenient property while claiming a much stronger object type.
- Re-check after mutation when the property that justified narrowing can change through aliasing.

Assertions are not a replacement for narrowing.

## Model state so invalid combinations are hard to express

Discriminated unions are especially valuable for workflows and UI/control-plane state.

Prefer one discriminant with state-specific fields over independent booleans and optional fields such as isLoading plus data? plus error?.

When all variants must be handled, make exhaustiveness explicit. A default branch that silently accepts future variants removes that protection.

Exhaustiveness is useful only when the union is genuinely closed by the owning contract.

## Optional, missing, and undefined are different

Read the repository compiler options before assuming optional-property behavior.

A property declared optional can mean the key is absent; depending on compiler settings, explicit undefined may or may not be assignable the same way. Runtime code can also distinguish key absence.

For patch/update types:

- decide whether omitted means leave unchanged;
- decide whether explicit undefined is a valid new value, a delete request, or invalid;
- do not use truthiness to detect presence when 0, false, or empty string are valid updates.

Partial<T> is convenient but does not define patch semantics by itself.

## Indexed access and collections

Array/map/object lookup can produce absence even when a broad type appears convenient.

- Honor noUncheckedIndexedAccess when enabled.
- Do not assert an element exists merely because a preceding length/index assumption seems obvious across mutation or async boundaries.
- Prefer Map.get/lookup handling that reflects possible absence.
- Keep key spaces closed when they are truly finite; otherwise model lookup failure.

## Generics should preserve relationships

A generic is useful when callers supply types and the function preserves a real relationship among them.

- Constrain type parameters to the capabilities the implementation actually uses.
- Do not introduce unconstrained generics as decorative flexibility.
- Do not promise a more specific return type than runtime behavior can guarantee.
- Be careful with mutable generic containers and variance/substitutability assumptions.

If the implementation needs a cast to manufacture T from unrelated data, the generic contract is probably lying.

## Runtime validation and static types

Use one authoritative boundary definition where possible. If a schema library generates or infers types, avoid re-declaring the same shape by hand.

Validation should reject malformed input rather than coerce it silently unless coercion is an accepted part of the boundary contract.

After validation, keep the trusted type narrow enough that downstream code does not need repeated casts.

## Type-level verification

Runtime tests and type-level checks prove different things.

For public APIs or tricky generic behavior, type-level tests can use the repository's established mechanism, such as expectTypeOf, tsd, compile fixtures, or precise ts-expect-error negative cases.

A ts-expect-error is useful in a type test only when the test fails if the compiler stops producing the expected error. It is not an ordinary implementation suppression.

## Completion check

Before completing type-safety-sensitive work:

1. Are external/opaque values unknown until validated?
2. Can every assertion/non-null/suppression point to a real proof source?
3. Do custom predicates prove the full type they claim?
4. Are state unions exhaustive where the state space is closed?
5. Are omitted, undefined, false, 0, and empty string handled according to the contract?
6. Can indexed access or mutation invalidate a previous assumption?
7. Do generics express a real relationship rather than manufacture types?
8. Are runtime validation and static typing backed by one coherent source of truth?
