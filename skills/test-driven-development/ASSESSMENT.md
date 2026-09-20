# test-driven-development Reviewer Assessment

Reviewer-only domain contract. It does not create Loom authority, product meaning, or proof.

## Review criteria

Reviewer verifies the RED→GREEN→REFACTOR cycle generated discriminating evidence rather than ceremony:

- RED test fails **for the intended missing behavior**, not syntax/setup/unrelated dependency failure; failure output demonstrates the target signal;
- GREEN implementation is the minimum coherent behavior needed for the accepted contract, not a hard-coded response that only satisfies one example;
- tests assert externally meaningful behavior/invariants and include boundary/counterexample cases needed to prevent trivial fake implementations;
- mocks/fakes preserve the boundary under proof and do not implement the same logic as production, making both wrong identically;
- REFACTOR runs the same behavior tests and does not silently expand scope/API/architecture;
- each cycle handles one conceptual behavior so failures remain diagnostic;
- integration/acceptance evidence is added when the behavior crosses boundaries unit TDD cannot prove.
