---
name: software-engineering
description: "MANDATORY baseline engineering discipline whenever a task authors or edits program-bearing source. Load before coding even for a one-line fix. Applies to application and library code, services, CLIs, APIs, scripts, tests, build logic, generators, migration code, infrastructure-as-code, code-bearing configuration, features, bug fixes, refactors, algorithms, and code deletion. Not for docs-only, research-only, design-only, commit-only, PR-only, or technical operations that do not change program-bearing source. This is the baseline; additionally load language/framework/domain skills."
license: MIT
metadata:
  author: Bateau
  version: "1.0.0"
---

# Software Engineering

This is the baseline discipline for changing software. It does not replace language, framework, testing, security, observability, Git, or domain skills. Load those when the task needs them.

## Core rules

- **Correctness first.** Clever code that is wrong has no value. Verify the defining behavior, important edge cases, failure paths, and compatibility obligations that actually apply.
- **Prefer the smallest complete solution.** Solve the accepted problem fully with the least new mechanism. Do not add speculative abstractions, extensibility, compatibility layers, feature flags, scaffolding, or TODO architecture for imagined future work.
- **Deletion beats coexistence.** When a replacement makes implementation obsolete, remove the obsolete path once its remaining uses are checked. Do not keep dead code "for later."
- **Make intent explicit.** Names, interfaces, state transitions, errors, and important decisions should reveal what the code means without requiring archaeology.
- **Fail visibly.** Surface and preserve actionable errors. Do not silently swallow failures, convert them into success, or hide partial failure behind fallback behavior unless accepted semantics explicitly require that behavior.
- **Respect accepted authority.** Implementation realizes accepted product, design, specification, security, lifecycle, and architecture meaning. It does not invent missing meaning.

## Deep modules and information locality

Prefer **deep modules**: small, stable interfaces that hide substantial implementation detail.

- Keep behavior that changes together close together.
- Keep implementation detail behind the narrowest useful boundary.
- Avoid layers, wrappers, adapters, managers, factories, and helper chains that mostly forward calls without hiding real complexity.
- Do not split one behavior across many files or modules merely to make pieces smaller.
- If a small behavior change requires tracing unrelated layers or widespread implementation knowledge, first consider whether the module boundary is too shallow or the information is too scattered.
- Preserve an existing good boundary rather than introducing a new abstraction simply because the change touches it.

A short function is not automatically simple. A small interface over substantial hidden behavior is often simpler than many tiny public pieces.

## Tests and honest green

Tests are part of implementation when behavior changes.

- Add or update tests alongside the code. Bugs should gain a regression test when the behavior can be exercised.
- Test the defining behavior before exotic cases.
- Prefer real inputs through the real code path. Mock external boundaries when needed; do not mock away the behavior being verified.
- A test that passes because expected pipeline output was hand-injected, the component under test was bypassed, the hard case was skipped, or the assertion was weakened is not evidence of correctness.
- Do not claim build, test, lint, security, runtime, or integration success without observed evidence.
- Load `test-driven-development` when implementing new behavior, fixing a defect, or when test-first work will materially improve the change; load the applicable language testing skill for mechanics.

## Errors and operational visibility

Operational behavior should be diagnosable at the boundary where it matters.

- For runtime boundaries, important decisions, retries, external calls, state transitions, and failure paths, add structured signals that let an operator understand what happened.
- Prefer useful, bounded signals over logging everything. Pure local computations do not need artificial telemetry.
- Use logs for discrete events and failure context, metrics for aggregate health/volume/latency, and traces when cross-boundary causality matters.
- Load an applicable observability skill when the task introduces or materially changes operational behavior.

Observability is part of behavior when operators depend on it; it is not decorative instrumentation added after the feature.

## Change hygiene

Keep the change easy to understand, review, revert, and maintain.

- Follow established repository conventions unless the task intentionally changes them.
- Keep unrelated cleanup out of the change. Local cleanup that directly removes complexity introduced or exposed by the change is appropriate.
- Do not edit generated output directly when the source generator owns it.
- Do not preserve obsolete compatibility by default. Preserve it only when an accepted contract or migration obligation requires it.
- Before declaring the implementation done, inspect the resulting diff for accidental complexity, duplicate paths, dead code, stale comments, and missing tests.

## Commits and pull requests

Commits and PRs are engineering artifacts, not afterthoughts.

- When the task includes creating commits, load `git-commit-discipline` before committing. Keep commits coherent, reviewable, and independently understandable.
- When the task includes creating or updating a pull request, load `pr-educational-body` before composing the PR body. Explain why the change exists, the conceptual delta, the important implementation concerns, and observed verification.
- Do not mix unrelated work into a commit or PR simply because it is nearby.

The detailed commit and PR formats live in those skills; do not duplicate them here.

## Completion check

Before returning implementation work, ask:

1. Does the code implement the accepted behavior, including important failure and edge cases?
2. Is there a smaller complete solution with less mechanism?
3. Did the change leave obsolete code, duplicate paths, speculative scaffolding, or shallow indirection behind?
4. Are module boundaries deep enough and is the information needed to change the behavior reasonably local?
5. Are errors surfaced and operational signals appropriate to the behavior?
6. Do tests exercise the real behavior and explain why the result is green?
7. Is the resulting diff focused and understandable?
8. If committing or opening a PR is in scope, were the dedicated Git/PR skills loaded?

If any answer exposes a real implementation gap, fix it or surface it through the active Loom authority path. Do not manufacture completion.
