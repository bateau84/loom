# python-design-patterns Assessment Contract

## Review criteria

Reviewer asks whether the abstraction earns its complexity in Python’s dynamic object/function model:

- the change pressure/problem exists before the pattern; pattern vocabulary is not used as proof;
- protocols/ABCs/composition/functions/decorators/context managers/descriptors are chosen according to required contract, not imported from Java/C++ ceremony;
- decorators/descriptors/metaclasses preserve signatures/introspection/debuggability and do not hide surprising global/class mutation;
- plugin/factory/registry patterns define lifecycle, duplicate registration, ordering, discovery, and failure semantics;
- dependency inversion does not become a service locator/global registry;
- singleton/shared state is justified and safe under tests/concurrency/process models;
- extension points correspond to real variants and preserve substitutability at observable boundaries.

## Adjudication criteria

Critic sketches the direct Python alternative, adds a second implementation, imports modules in different order, and tests introspection/serialization/pickling/concurrency where the pattern touches them. Attack clever metaprogramming that moves failures from construction to runtime magic.

Block when pattern use obscures ownership/control flow enough to create material correctness/API/maintainability risk or violates accepted architecture. Simpler-but-equivalent is usually reframe/maintainability, not an automatic gate failure.

## Scaling

Increase depth with metaprogramming, registries/plugins, public framework APIs, hidden global state, number of implementations, and architectural reach.