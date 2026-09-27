# typescript-type-safety Quality Assurance

Critic-only adversarial contract. Assume competent production and normal review have already occurred; attack residual ways the TypeScript proof can be illusory.

## QA criteria

Critic asks what runtime value can still violate the static claim:

- replace asserted/cast input with malformed objects, missing keys, wrong primitive kinds, null, and extra variants;
- remove or inspect custom type guards and verify their runtime checks justify every property the predicate claims;
- exercise valid falsy patch values and distinguish omitted keys from explicit undefined;
- add a new discriminated-union variant and see whether supposedly exhaustive consumers fail to compile or silently fall through;
- force indexed lookups out of range or missing Map/object keys where callers assume presence;
- substitute edge-case generic implementations or values and inspect whether a cast is manufacturing the promised type;
- compare runtime schema definitions, inferred/generated types, and hand-written interfaces for drift;
- inspect compiler suppressions and ambient declarations to see whether the core path is effectively unchecked.

Block when a required type-safety claim exists only because the compiler was told to trust code that does not establish it. Explicit, bounded escape hatches at genuinely opaque boundaries are non-blocking when their proof source is real.

## QA depth

Increase depth for public/generic APIs, persisted/untrusted data, state machines, patch/update semantics, schema migrations, custom predicates, global declarations, and refactors that rely on types to guarantee broad mechanical safety.
