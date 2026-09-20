# python-design-patterns Quality Assurance

Critic-only adversarial contract. Assume competent production and normal review have already occurred; attack residual false confidence without creating new authority.

## QA criteria

Critic sketches the direct Python alternative, adds a second implementation, imports modules in different order, and tests introspection/serialization/pickling/concurrency where the pattern touches them. Attack clever metaprogramming that moves failures from construction to runtime magic.

Block when pattern use obscures ownership/control flow enough to create material correctness/API/maintainability risk or violates accepted architecture. Simpler-but-equivalent is usually reframe/maintainability, not an automatic gate failure.

## QA depth

Increase depth with metaprogramming, registries/plugins, public framework APIs, hidden global state, number of implementations, and architectural reach.
