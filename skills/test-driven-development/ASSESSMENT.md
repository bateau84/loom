# test-driven-development Assessment Contract

## Review criteria

Reviewer verifies the RED→GREEN→REFACTOR cycle generated discriminating evidence rather than ceremony:

- RED test fails **for the intended missing behavior**, not syntax/setup/unrelated dependency failure; failure output demonstrates the target signal;
- GREEN implementation is the minimum coherent behavior needed for the accepted contract, not a hard-coded response that only satisfies one example;
- tests assert externally meaningful behavior/invariants and include boundary/counterexample cases needed to prevent trivial fake implementations;
- mocks/fakes preserve the boundary under proof and do not implement the same logic as production, making both wrong identically;
- REFACTOR runs the same behavior tests and does not silently expand scope/API/architecture;
- each cycle handles one conceptual behavior so failures remain diagnostic;
- integration/acceptance evidence is added when the behavior crosses boundaries unit TDD cannot prove.

## Adjudication criteria

Critic constructs the simplest **wrong** implementation that would satisfy the tests. If one exists for a load-bearing requirement, the suite is under-specified. Also inspect whether the claimed RED evidence could have failed before the intended test assertion.

Block when TDD evidence is used to claim mandatory behavior the tests do not discriminate, or when mocks bypass the product boundary under proof. Exact red/green commit ritual is non-blocking unless repository policy requires it; behavior/evidence quality matters more than theater.

## Scaling

Increase depth with correctness/security consequence, state machines, boundary integration, mock density, regression risk, and ease of writing a trivial implementation that fools the tests.