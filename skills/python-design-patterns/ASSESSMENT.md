# python-design-patterns Reviewer Assessment

Reviewer-only domain contract. It does not create Loom authority, product meaning, or proof.

## Review criteria

Reviewer asks whether the abstraction earns its complexity in Python’s dynamic object/function model:

- the change pressure/problem exists before the pattern; pattern vocabulary is not used as proof;
- protocols/ABCs/composition/functions/decorators/context managers/descriptors are chosen according to required contract, not imported from Java/C++ ceremony;
- decorators/descriptors/metaclasses preserve signatures/introspection/debuggability and do not hide surprising global/class mutation;
- plugin/factory/registry patterns define lifecycle, duplicate registration, ordering, discovery, and failure semantics;
- dependency inversion does not become a service locator/global registry;
- singleton/shared state is justified and safe under tests/concurrency/process models;
- extension points correspond to real variants and preserve substitutability at observable boundaries.
