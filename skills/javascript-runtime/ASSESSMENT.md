# javascript-runtime Reviewer Assessment

Reviewer-only domain contract. It does not create Loom authority, product meaning, or proof.

## Review criteria

Reviewer verifies that implementation claims match actual JavaScript semantics:

- object/array copies do not accidentally preserve shared nested identity where independent state is required;
- null, undefined, 0, false, empty string, NaN, and missing properties are not collapsed by convenience truthiness when the contract distinguishes them;
- delayed callbacks and closures read the intended state rather than a later mutation of the same binding;
- this binding is correct for normal functions, methods, callbacks, and arrow functions where context matters;
- ESM top-level side effects, live bindings, cycles, and module-level mutable singletons do not make correctness depend on hidden import order or stale shared state;
- Promise/microtask/timer ordering is established from runtime semantics or evidence rather than source-order intuition;
- finally blocks and cleanup do not replace or mask the primary return/error accidentally;
- spread, destructuring, sorting, and serialization are used with their real shallow/mutating semantics.

Where a finding depends on ordering or identity, Reviewer should prefer a minimal runtime reproducer or focused test over prose speculation.
