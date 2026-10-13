# test-driven-development Quality Assurance

Critic-only adversarial contract. Assume competent production and normal review have already occurred; attack residual false confidence without creating new authority.

## QA criteria

Critic tries to falsify the actual testing/evidence claim, **not maximize test count**. A proposed counterexample must be reachable or credible under accepted behavior (or protect a serious high-consequence boundary), and not already be detected by existing proof. Recommend a new test only when the gap is distinct and material.

### Challenge test accumulation

- Find tests that prove the same thing, mock away their claimed behavior, or lock down internal implementation without accepted need.
- Find costly scaffolding and entire scenario matrices justified only by coverage targets, speculative inputs, or a preferred technique.
- Check whether a simpler existing test, typecheck, compiler check, or single integration case provides the same protection.
- A legitimate response to excess tests is consolidation or deletion, not automatically more tests.

The Red/Green checks below apply when TDD evidence is claimed; their absence alone does not invalidate sound non-TDD verification.

### Construct the simplest wrong implementation

For each **credible, load-bearing** requirement or regression claim, ask:

> What is the simplest incorrect implementation that would still make these tests pass?

Try examples such as:

- returning the first expected constant;
- special-casing only the tested inputs;
- ignoring one branch or state transition;
- implementing both sides of a round trip with the same wrong convention;
- satisfying interaction assertions without producing the required outcome;
- bypassing persistence, ordering, authorization, retry, or error semantics hidden by a double.

If a materially wrong implementation survives, the suite is under-specified.

### Attack RED evidence

Check whether the claimed Red could have failed before the intended behavioral assertion because of:

- setup or fixture defects;
- compile/type/import failures unrelated to the behavior;
- environment or dependency failures;
- an exception on the wrong path;
- an assertion that was never reached.

A ceremonial Red is not discriminating evidence.

### Attack GREEN evidence

Look for:

- a Fake It implementation that was never forced to generalize;
- tests that merely repeat implementation logic;
- mocks/fakes that return the final answer rather than model a boundary;
- assertions against values planted by the test itself;
- weak examples that permit over-fitting;
- test helpers that silently encode the same bug as production.

### Attack composition

Unit TDD can leave integration gaps. Where the claim crosses a process, protocol, persistence, filesystem, database, CLI, browser, or external-service boundary, verify that some higher-level evidence actually exercises that composition.

Do not accept mocked unit evidence as proof of a boundary the mock replaces.

### Attack refactoring confidence

Check that refactoring did not:

- weaken or delete the discriminating assertion;
- move production decision logic into shared test helpers;
- silently change behavior while tests stayed green;
- preserve green only because tests are coupled to the old implementation shape.

### Attack test ordering and design feedback

Inspect whether the sequence of tests forced useful design progress or merely accumulated examples after implementation. Where tests require excessive setup, many mocks, or broad internal knowledge, consider whether the suite hides a design/locality problem that can make future autonomous maintenance unsafe.

## Blocking guidance

Block when a material accepted behavior is claimed without discriminating evidence, when doubles bypass the product boundary under proof, when a temporary Fake It implementation is presented as complete behavior, or when load-bearing cross-boundary behavior lacks evidence at the boundary. A speculative counterexample or lack of a favored technique is not a blocker if simpler evidence suffices.

Exact red/green commit ritual is non-blocking unless repository policy requires it. Behavioral and evidence quality matter more than theater.

## QA depth

Increase depth with correctness/security consequence, state machines, boundary integration, mock density, persistence/recovery semantics, regression risk, and ease of writing a trivial implementation that fools the tests.
