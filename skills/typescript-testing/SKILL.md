---
name: typescript-testing
description: "TypeScript/JavaScript testing mechanics across Bun test, Vitest, Jest, and similar runners: awaited async assertions, deterministic timers and concurrency, module/global mock isolation, runtime-vs-type-level tests, environment selection, regression tests, and false-green avoidance. Use when writing or reviewing tests for TypeScript/JavaScript code. Pair with test-driven-development for red-green-refactor process."
license: MIT
metadata:
  author: Bateau
  version: "1.0.0"
---

> **House skill.** test-driven-development owns test-first process and honest behavioral intent. This skill owns TypeScript/JavaScript test mechanics and common false-green modes. Use the repository's existing runner rather than introducing another by default.

## Start from the runner and environment

Inspect package scripts and test configuration before writing tests.

Know:

- runner: Bun test, Vitest, Jest, Node test, or another declared tool;
- environment: Bun/Node, jsdom, happy-dom, real browser, worker, etc.;
- module mode and transform pipeline;
- fake-timer implementation;
- setup files and global hooks;
- whether tests are typechecked separately.

Do not write browser API tests into a plain Node environment and then mock the entire browser surface to make them pass. Choose the environment that matches the boundary being verified.

## Async tests must own completion

The most dangerous false green is a test that finishes before the assertion executes.

- await the Promise under test;
- return it when the runner supports returned-Promise completion;
- await rejection or resolution matchers;
- for callback-style APIs, use the runner's supported completion mechanism and prove the callback was reached;
- never start an async assertion without attaching it to the test's lifetime.

A rejection assertion that is not awaited can pass while the operation fails later as an unhandled rejection.

## Test behavior through real code

Follow test-driven-development's honest-green rule.

- Mock external boundaries, clocks, network clients, filesystem adapters, or expensive third-party services when necessary.
- Do not mock the parser, state machine, component, or service whose behavior the test claims to verify.
- Prefer small in-memory fakes for stateful collaborator contracts over brittle call-order mocks.
- Assert observable results, state, or events rather than private helper calls.

If a mock returns the final value the code under test was supposed to compute, the test proves the mock.

## Timers and scheduler control

Real sleeps make tests slow and flaky. Use the runner's fake timers or an injected clock/scheduler when time itself is under test.

With fake timers:

- enable them explicitly within bounded scope;
- advance or run the intended timer work;
- account for Promise microtasks if timer callbacks schedule async work;
- restore real timers in cleanup even when assertions fail;
- avoid leaking fake-timer state into later tests.

Do not assume advancing timers automatically drains every Promise chain; verify the runner's semantics.

For scheduler-sensitive concurrency, deferred Promises or manual gates often provide clearer ordering control than timers.

## Module and global mocks

Module mocks can be process-wide, hoisted, cached, or persistent across tests depending on the runner.

- restore or reset mocked functions and globals;
- keep module replacement scoped to the smallest test surface;
- avoid order-dependent tests that rely on another test to initialize or reset singleton state;
- re-import or reset modules only when the runner semantics make that behavior explicit;
- be cautious with top-level mocks whose hoisting means source order is misleading.

Patch globals such as fetch, Date, crypto, location, or process.env through a reversible mechanism and restore the exact original value.

## Table and parameterized tests

Use parameterized cases when the same behavior should hold across inputs. Give each case a meaningful name or value label so failures identify the scenario.

Do not collapse substantially different behaviors into one giant test table merely to reduce lines.

## Runtime tests and type-level tests are different

Runtime tests cannot prove that invalid calls fail to compile. Type-level tests cannot prove runtime parsing or effects.

For important public APIs or generics, use the repository's established type-test mechanism when needed:

- expectTypeOf or equivalent;
- tsd or compile fixtures;
- precise ts-expect-error negative cases.

A ts-expect-error in production code is not a type test.

## Browser and UI tests

When DOM or browser behavior is material, load browser-runtime and existing UI or accessibility skills as applicable.

Prefer user-observable DOM behavior over framework internals. Use a real browser or E2E test when layout, navigation, focus integration, storage across pages or tabs, or actual browser policy is the thing being proven.

Do not ask a DOM shim to prove behavior it does not implement faithfully.

## Isolation and determinism

A test must pass alone and as part of the suite.

Reset:

- mutable singletons;
- environment variables;
- fake timers and clocks;
- spies and mocks;
- temporary files or storage;
- global listeners;
- module-scoped caches when the test intentionally changes them.

Prefer deterministic IDs, clocks, and random sources when values affect assertions. Do not weaken assertions to tolerate nondeterminism created by the test itself.

## Coverage with intent

Coverage percentage is a locator, not a correctness verdict.

Prioritize:

- defining behavior;
- a regression case for each fixed bug;
- failure and rejection paths;
- valid boundary values including falsy values;
- cancellation and race cases for async code;
- serialization and parse boundaries;
- cleanup.

Snapshots are appropriate for stable, reviewable structures. Avoid giant snapshots that hide semantic changes in noise.

## Verification loop

While developing, run the focused test first. Before completion, run the relevant containing suite and the repository's TypeScript typecheck and lint checks.

If a test is expected to catch a regression, temporarily break or otherwise falsify the behavior when practical to confirm the test actually fails for the intended reason.

## Completion check

1. Does every async assertion belong to the test lifetime?
2. Are mocks outside, not through, the behavior under test?
3. Are timers and scheduler state controlled and restored?
4. Can tests pass independently and in any order?
5. Does the selected environment faithfully implement the API being claimed?
6. Are runtime and type-level contracts tested with the right mechanism?
7. Do failure, cancellation, and cleanup paths have meaningful coverage where material?
8. Is the final suite green for a reason that would turn red if the behavior regressed?
