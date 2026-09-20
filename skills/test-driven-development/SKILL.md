---
name: test-driven-development
description: "Test-Driven Development workflow for any language — the red-green-refactor discipline applied honestly. Use when writing a feature test-first, deciding what to test, turning a bug into a regression test, or judging whether a suite actually verifies behavior. Covers the cycle (failing test first, minimum code to pass, refactor under green), choosing the defining case over the merely interesting one, test-double discipline, and the house rule that a green test must exercise real code on real input — never hand-injected state. Pairs with golang-testing / python-testing for language specifics and current Loom role directive and control-plane state Test Integrity for the honesty gate."
license: MIT
metadata:
  author: Bateau
  version: "1.0.0"
---

> **House skill.** Language-agnostic TDD discipline for this workspace. The honesty gate lives in `current Loom role directive and control-plane state` -> Test Integrity; language mechanics live in `golang-testing` / `python-testing`. This skill is the process that ties them together.

**Persona:** You drive implementation from tests. You do not write production code until a failing test demands it, and you do not trust a green bar until you know _why_ it is green.

## The cycle

TDD is three steps on a tight loop. One behavior at a time.

1. **Red — write a failing test first.** Express the next increment of behavior as a test, and run it. It MUST fail, and fail for the _expected_ reason (assertion not met) — not a compile error or a typo. A test that passes the moment you write it tested nothing.
2. **Green — minimum code to pass.** Write the least production code that makes the test pass. No speculative generality, no handling of cases no test demands yet. Resist building ahead.
3. **Refactor — clean up under a green bar.** With the test passing, improve names, remove duplication, simplify — re-running the test after each change. The test is your safety net; refactoring without it is just editing.

Then repeat for the next behavior. Small steps beat big leaps: a failing test you can read is worth more than five you wrote at once and now cannot localize.

## What to test — the defining case, not the interesting one

The hard-won lesson: a suite can be green and still worthless if it tests the wrong thing.

- **Test the defining behavior first** — the property that, if broken, means the feature is _wrong_, not merely incomplete. The exotic edge case deserves a test; the central guarantee deserves it _first_. A suite that exercises the clever failure mode but never the plain "does it return the right answer for the obvious input" is a green light over a hole.
- **Test behavior, not implementation.** Assert on what the unit produces (return value, emitted event, persisted state), not on how it computes it. Tests coupled to internals break on every refactor and verify nothing a user cares about.
- **Every bug becomes a regression test.** Before fixing a bug, write the test that reproduces it (Red). Fix until it passes (Green). That test is now a permanent guard — the bug cannot return unnoticed.
- **An operation and its inverse are tested as a pair.** encode/decode, add/remove, forward/reverse link — round-trip them in one test so an asymmetry cannot hide.

## Honest green — the non-negotiable

This is the house line and it is absolute (full rules in `current Loom role directive and control-plane state` -> Test Integrity):

> A passing test counts only if it runs **real input through the real code path.**

A test is **faking success** — a coverage gap to escalate, not a checkmark — if it goes green by any of:

- **hand-injecting the data the pipeline should have produced** (manually seeding the rows/objects the code under test was supposed to build),
- **mocking past the boundary under test** (stubbing the very component whose correctness is the point),
- **skipping the hard case** (`skip` / `xfail` / commented-out) so only the easy paths run,
- **asserting on a value the test itself set**, rather than one the system produced.

If you cannot make a test pass by running real input through real code, that is a gap in the implementation or the design. Do not massage it green. Stop and escalate with the fitting code — `[ESCALATE: BUG]` (real path broken), `[ESCALATE: ARCHITECTURE]` (path never designed, or a precondition stubbed upstream), or `[ESCALATE: SCOPE]` (cannot be honestly tested as scoped).

The fingerprint to watch for: _"the test only passes because I set up the exact thing the code was supposed to create."_

## Test completeness as verification signal

Agents use test output as their **primary — often only — autonomous verification signal.** They stop at green. A sparse suite means an agent stops at a false green, treating an incomplete feature as done. Test completeness is therefore directly proportional to agent maintenance reliability: every uncovered behavior is a gap where an agent can confidently break something without knowing it.

A corollary for design: **a test that requires understanding five or more implementation files to write signals the implementation is too scattered for agent maintenance.** If writing the test demands tracing the full dependency chain, that is an information-locality problem in the code — not a testing problem. The fix is at the implementation boundary, not the test.

## Test doubles — discipline, not habit

- **Mock at the system boundary, never across the unit under test.** Stub the network, the clock, the third-party API. Do not stub the function you are testing or the immediate collaborators whose interaction _is_ the behavior.
- **Prefer real collaborators and in-memory fakes** over mocks that merely replay the answer you expected. A fake the real flow writes to and reads from is a fixture; a mock that returns the finished result is the code under test in disguise.
- **A fixture is _input to_ the pipeline** (a sample payload, a seed file the real flow consumes) — never a substitute _for_ the pipeline's own output.

## Observability is testable behavior

Logging is not exempt from TDD — it is one of its easier wins (see `current Loom role directive and control-plane state` -> Observability & Logging). A structured log line or emitted metric is observable output, so assert on it: that a failure path logs at Error with the offending input, that a boundary records what it decided. Writing the test for the log first is also the cheapest way to make "fail loudly" real instead of aspirational.

## The inner loop in practice

Per `current Loom role directive and control-plane state` and the language `*-common-practice` skills, after every Red and every Green:

- Run the **single** test you are driving for fast feedback, then the package/module suite before moving on.
- Any blocking or long command gets a `timeout N` prefix.
- Never advance to the next behavior on a red — or an unexplained-green — bar.

## Anti-patterns

- **Test-after dressed as TDD** — writing code, then a test that just confirms what you already wrote. You miss the design pressure Red applies; the test ossifies the implementation instead of specifying behavior.
- **Assertion-free tests** — calling the code and checking it "doesn't throw". Exercising is not asserting.
- **One mega-test** — twenty behaviors in a single test you cannot localize when it fails. One behavior per test.
- **Testing the framework** — do not test that the ORM saves or the router routes; test _your_ logic.
- **Green-at-all-costs** — weakening a correct assertion or stubbing the boundary to force the bar green. That is the exact failure `Honest green` exists to stop.

## Cross-references

- `current Loom role directive and control-plane state` — **Test Integrity** (the honesty gate this skill operationalizes) and **Observability & Logging**.
- `golang-testing` — Go mechanics: table tests, `testing.T`, `testify`, fuzzing, `t.Parallel`.
- `python-testing` — Python mechanics: `pytest`, fixtures, `parametrize`, `unittest.mock` boundaries.
- The language `*-common-practice` skill for the inner check/compile loop.

---

This skill is the workflow; the language testing skills are the mechanics. Load both for a test-first task.
