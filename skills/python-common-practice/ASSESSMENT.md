# python-common-practice Reviewer Assessment

Reviewer-only domain contract. It does not create Loom authority, product meaning, or proof.

## Review criteria

Reviewer checks Python idioms where language dynamism can hide state/lifecycle defects:

- mutable default arguments/class attributes and late-bound closures do not leak state between calls/instances;
- iterators/generators are not accidentally consumed twice, retained after resource closure, or mistaken for concrete reusable collections;
- context managers own files/locks/transactions/resources on every exception path;
- exceptions are caught at the narrowest meaningful boundary; truthiness/EAFP does not conflate valid falsy values with absence/failure;
- dataclass/default_factory/frozen/slots choices preserve intended mutability/equality/hash semantics;
- imports/module-level initialization do not perform hidden network/config/side effects that make testing/startup order-dependent;
- duck typing/protocol use remains explicit enough at public boundaries to avoid runtime-only surprises;
- copies/aliases of lists/dicts/nested objects preserve ownership expectations.
