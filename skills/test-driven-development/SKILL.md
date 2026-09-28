---
name: test-driven-development
description: "Test-Driven Development workflow for any language — use tests to drive behavior and design through a tight red-green-refactor loop. Use when implementing a feature test-first, choosing the next example, turning a bug into a regression test, evolving an API from tests, deciding when to Fake It or Triangulate, or judging whether TDD evidence really proves the claimed behavior. Covers the Test List, Red-Green-Refactor, Obvious Implementation / Fake It / Triangulation, design feedback, refactoring discipline, boundary tests, test doubles, and Loom's honest-green house rule. Pair with the language testing skill for mechanics."
license: MIT
metadata:
  author: Bateau
  version: "1.1.0"
---

> **House skill.** This is Loom's language-agnostic TDD methodology. It combines the normal TDD method with explicit Loom house choices about test integrity and test doubles. Language mechanics live in skills such as `golang-testing` and `python-testing`. Loom authority, routing, evidence, and escalation still come from the active role directive and control-plane state.

**Persona:** You let tests drive the next behavior and expose design pressure. You do not write new production behavior until a failing test demands it, and you do not trust a green bar until you know why it is green.

## Start with a Test List

Before coding, make a small working list of behaviors or examples implied by the accepted contract.

The Test List is not a complete up-front test plan. It is a queue of useful next questions. Update it whenever implementation teaches you something new.

Prefer this order:

1. the **defining case** — the central property that makes the behavior correct;
2. the smallest counterexample that prevents a trivial or over-fitted implementation;
3. important boundaries, errors, invariants, and integration cases;
4. newly discovered cases exposed by the implementation.

Choose **one** item and drive it through Red → Green → Refactor before choosing the next. If a test requires a large conceptual leap, split it.

## The core loop

TDD is a tight loop over one conceptual behavior at a time.

### 1. Red — specify the next behavior

Write the smallest test that expresses the next behavior, then run it.

A useful Red:

- fails because the intended behavior is missing or wrong;
- reaches the code path you mean to exercise;
- fails at the meaningful assertion or observable boundary;
- is small enough that the reason for failure is obvious.

A compile/type error caused by a deliberately not-yet-existing API can be a brief design step, but do not treat setup mistakes, bad imports, broken fixtures, unrelated dependency failures, or an unexplained failure as proof of Red. Resolve those until the failure discriminates the intended missing behavior.

If the new test passes immediately, determine why. The behavior may already exist, the assertion may be weak, or the test may not reach the intended path. Do not advance on an unexplained green.

### 2. Green — make the smallest coherent change

Write only enough production code to make the current test pass while preserving previous tests.

There are three useful Green strategies:

- **Obvious Implementation** — implement the direct solution when it is genuinely obvious and small.
- **Fake It** — use a deliberately simple or hard-coded implementation to get to green quickly when the design is uncertain.
- **Triangulate** — add another example that forces an over-fitted implementation to change. Repeat with the smallest useful examples until the implementation expresses the accepted rule rather than a special case.

A temporary Fake It implementation is valid TDD. It is not completion. If the accepted behavior is broader than the example, add the next discriminating test. One added example may only eliminate one fake; keep triangulating when another simple wrong implementation still satisfies the suite. Refactor under green once the tests constrain the accepted rule.

Do not build speculative generality, future options, or cases no accepted behavior requires.

### 3. Refactor — improve the design while green

With all relevant tests green, improve structure without changing behavior.

Refactoring includes production code **and test code**:

- improve names and APIs;
- remove duplication;
- simplify control flow;
- improve cohesion and locality;
- remove test setup noise;
- extract helpers that clarify intent;
- delete obsolete scaffolding from Fake It steps.

Run the focused test after each meaningful change, then the affected package/module suite. If behavior changes, you left Refactor and need a new Red.

### 4. Update the Test List

Mark the driven behavior complete, add anything learned, and choose the next smallest useful test.

Then repeat.

## Choosing the next test

The next test should teach you something or force useful progress.

Prefer tests that:

- define the main behavior before exotic edge cases;
- distinguish the desired behavior from the simplest wrong implementation;
- force one missing rule at a time;
- expose uncertainty in the API or design;
- exercise a boundary that lower-level tests cannot prove.

Avoid writing five failing tests at once. Multiple Reds make it harder to know which change caused progress and encourage implementing ahead.

## TDD is also a design method

The test is the first client of the production interface.

Pay attention to friction:

- If the test needs excessive setup, the production API may be too hard to use.
- If the test must understand many unrelated implementation details, responsibilities may be scattered.
- If every test needs many mocks, coupling may be too high.
- If a tiny behavior requires changes across many files, locality may be poor.
- If you cannot name the behavior cleanly in a test, the contract may be unclear.

Do not automatically "fix" test friction with more mocks or helpers. First ask whether the production design is creating the friction.

A useful Loom heuristic: if a focused test requires understanding roughly five or more implementation files, inspect the design boundary before normalizing that complexity.

## Behavior, examples, and invariants

- **Test behavior, not implementation.** Prefer externally meaningful results: returned values, persisted state, emitted events, protocol messages, operator-visible signals, or other accepted outputs.
- **Every bug becomes a regression test.** Reproduce the bug with Red before fixing it when practical, then keep that test.
- **Use examples to discover the rule.** When one example permits a trivial implementation, add the smallest second example that forces the actual rule.
- **Test invariants directly.** For state machines, parsers, encoders, stores, or security rules, identify properties that must remain true across examples.

### Operations and inverses

Round-trip tests are valuable for pairs such as encode/decode, add/remove, or serialize/parse:

`decode(encode(x)) == x`

But a round trip can pass when **both sides are wrong in the same way**. When the representation or behavior has independent meaning, also use known-answer tests for each side.

## Honest green — Loom house rule

A passing test counts only when **real input at the level under test travels through the real behavior path being claimed**.

"Real input" does not mean every unit test must boot the full product. A unit test may call a unit directly; an integration test may use an in-memory database or faithful fake when database-specific semantics are not the claim; a boundary test may fake an external service. What must remain real is the behavior whose correctness the test claims to prove.

A test is faking success when it:

- hand-injects the output the code under test was supposed to produce;
- mocks or stubs past the very behavior under proof;
- skips, xfails, comments out, or weakens the hard case to obtain green;
- asserts mainly on values the test itself planted rather than values produced by the behavior;
- replaces the missing implementation with equivalent logic inside the fake or fixture.

If a meaningful test cannot pass without bypassing the behavior, surface the implementation, design, or scope gap through Loom rather than massaging the test green.

The fingerprint to watch for is: *"the test passes because I supplied the thing the system was supposed to create."*

## Test doubles — Loom's default style

TDD itself does not require one mocking school. Loom defaults to a **classical/sociable style** because it usually gives agents stronger evidence about real collaboration:

- mock or stub true system boundaries such as network APIs, clocks, nondeterministic services, or expensive external systems;
- prefer real collaborators or behaviorally faithful in-memory fakes inside the owned codebase;
- avoid mocking the immediate collaborator when that collaboration is the behavior under proof;
- never put production-equivalent decision logic into a fake, because production and fake can then be wrong identically.

A more interaction-heavy/mockist style can still be TDD, but it is not Loom's default. If the accepted architecture or test boundary requires interaction assertions, keep them focused on observable protocol obligations rather than incidental call choreography.

A fixture is **input to** the behavior: sample payloads, files, database starting state, or protocol messages. It is not a substitute for output the behavior itself must create.

## Unit TDD does not prove every boundary

When accepted behavior crosses process, storage, protocol, filesystem, database, CLI, browser, or service boundaries, add the smallest higher-level test that proves the boundary actually composes.

Use the testing pyramid pragmatically:

- many focused unit tests for fast design feedback;
- integration/contract tests for owned boundaries;
- acceptance/end-to-end tests for load-bearing flows that cannot be proven below.

Do not claim a system behavior solely from unit tests whose doubles bypass the relevant composition.

Outside-in TDD is valid when a higher-level acceptance test usefully defines the feature. Keep the inner unit loop small rather than trying to make every Red an end-to-end test.

## Observability can be behavior

Logs, metrics, traces, and events are testable when they are part of an accepted operator or integration contract.

Test the semantic signal — level/category, stable fields, event type, or required context — rather than brittle wording or incidental formatting. Do not turn every internal log line into a public contract.

## Existing code and characterization

When changing poorly understood legacy behavior, a characterization test may first pin the current observable behavior so the change can be made safely.

A characterization test is not proof that the current behavior is correct. Once the desired change is clear, drive the new behavior with the normal Red → Green → Refactor loop.

## Inner-loop execution

After each Red and Green:

1. run the single focused test;
2. run the affected package/module suite before moving to the next behavior;
3. periodically run the broader relevant suite as the change grows;
4. keep blocking or long-running commands bounded according to the active execution policy.

Never advance to the next behavior on a red bar or an unexplained green bar.

## Anti-patterns

- **Test-after dressed as TDD** — production behavior exists first and the test merely confirms it.
- **Unexplained Red** — treating syntax, fixture, environment, or dependency failure as proof that the target behavior is missing.
- **Unexplained Green** — assuming a new test proves something because it passes immediately.
- **Permanent Fake It** — leaving a hard-coded example implementation when the accepted behavior requires generalization.
- **Assertion-free tests** — exercising code without discriminating expected behavior.
- **One mega-test** — many conceptual behaviors in one failure.
- **Testing incidental internals** — coupling tests to private structure that can change without changing behavior.
- **Mocking away the proof** — replacing the behavior under test with a double.
- **Testing the framework** — proving the ORM/router/library works rather than proving your logic.
- **Green at all costs** — weakening assertions, skipping cases, or seeding outputs merely to obtain green.
- **Refactor plus behavior change** — silently adding requirements while supposedly cleaning up.
- **Round-trip only** — letting two mutually wrong implementations validate each other.

## Cross-references

- active Loom role directive and control-plane state — authority, Test Integrity, execution policy, and evidence obligations;
- `golang-testing`, `python-testing`, `typescript-testing`, or another language testing skill — framework and language mechanics;
- the applicable language `*-common-practice` skill — compile/check/lint inner-loop mechanics.

---

This skill owns the TDD **method**. Language testing skills own testing **mechanics**. Load both for test-first implementation work.
