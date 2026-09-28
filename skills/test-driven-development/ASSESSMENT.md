# test-driven-development Reviewer Assessment

Reviewer-only domain contract. It does not create Loom authority, product meaning, or proof.

## Review criteria

Reviewer verifies that TDD generated discriminating behavioral and design evidence rather than ceremony.

### Test selection and sequencing

- for non-trivial work, a small Test List or equivalent working queue identified the next behaviors without pretending to be a complete up-front test plan; for a genuine single-behavior change, the one next test is sufficient;
- the defining behavior was driven before exotic cases unless risk justified another order;
- each cycle handled one conceptual behavior so failures remained diagnostic;
- additional examples were chosen to force useful generalization, not merely increase test count.

### RED evidence

- RED failed because the intended behavior was missing or wrong;
- when the test was runnable, failure evidence reached the intended code path and exposed the target signal;
- a deliberate compile/type failure from a not-yet-existing API was attributable to that missing interface and was resolved into behavioral evidence as soon as the interface existed;
- setup, fixture, import, type, environment, or unrelated dependency failures were not misrepresented as the behavioral Red;
- an initially passing test was investigated rather than counted as proof without explanation.

### GREEN evidence

- the implementation is the smallest coherent behavior needed for the accepted contract;
- Obvious Implementation, Fake It, or Triangulation was used appropriately for the uncertainty at hand;
- a temporary hard-coded Fake It step is acceptable, but required general behavior is not considered complete while a simple special-case implementation still satisfies the suite;
- triangulation continues with additional discriminating examples when one new example merely replaces one fake with another;
- tests include the counterexamples or invariants needed to reject trivial wrong implementations.

### REFACTOR evidence

- production and test code were improved only while relevant behavior remained green;
- refactoring did not silently expand product behavior, API, or architecture;
- test cleanup preserved or improved discriminating strength rather than weakening assertions;
- obsolete Fake It scaffolding and accidental duplication were removed.

### Design feedback

- tests exercise externally meaningful behavior rather than incidental internals;
- excessive setup, mock density, scattered file knowledge, or awkward APIs were treated as possible design signals rather than hidden behind more test scaffolding;
- tests remain readable as clients of the production interface.

### Test integrity and boundaries

- real input at the level under test traverses the real behavior path being claimed;
- mocks/fakes preserve the boundary under proof and do not implement equivalent production logic that could be wrong identically;
- integration/contract/acceptance evidence exists where behavior crosses boundaries unit TDD cannot prove;
- round-trip tests are supplemented by independent known-answer tests when both halves could agree on the same wrong representation;
- operator-facing logs, metrics, traces, or events are asserted only when they are accepted observable behavior, using stable semantic fields rather than brittle formatting.

### Regression discipline

- bugs are reproduced by regression tests before the fix when practical;
- characterization tests are not confused with proof that legacy behavior is correct;
- the affected package/module suite still passes after each completed cycle.
