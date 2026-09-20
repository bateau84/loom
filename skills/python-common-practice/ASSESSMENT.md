# python-common-practice Assessment Contract

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

## Adjudication criteria

Critic repeats calls/constructors, supplies `0`/`False`/`""`/`None`, consumes generators twice, imports in a clean process, raises during context-manager work, and mutates nested/shared defaults. Attack “Pythonic” shortcuts that silently collapse distinct states.

Block when these semantics cause plausible correctness, data leakage, resource, or public-contract failures. Non-idiomatic but explicit/safe code is not a blocker solely for style.

## Scaling

Increase depth with shared mutable state, resource/context managers, generator/lazy pipelines, import-time behavior, public dynamic interfaces, and long-lived process state.