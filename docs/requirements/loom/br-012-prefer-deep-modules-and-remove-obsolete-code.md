---
type: requirement
title: BR-012 — Prefer Deep Modules and Remove Obsolete Implementation
description: Code should expose small useful interfaces, hide substantial implementation detail, and retire obsolete paths.
tags: [requirement, loom, code-quality, modules, maintainability]
---
**Status:** proposed

## Statement

When designing or materially restructuring code, Loom SHOULD prefer modules with a small clear interface, substantial useful behavior hidden behind that interface, a clean seam, tests that exercise the public interface, and implementation details callers do not need to understand.

Loom MUST NOT preserve old implementation merely because additive code is easier.

When a replacement makes old code obsolete, the plan MUST include safe removal or migration unless current evidence requires compatibility.

## Acceptance Criteria

1. New or materially reworked modules expose a narrow interface relative to the complexity they hide where practical.
2. Callers do not need knowledge of internal implementation details to use the module correctly.
3. Public seams have meaningful tests.
4. Replacements identify obsolete paths and remove or intentionally migrate them.
5. Compatibility code that remains has an explicit current reason.

## Verification Semantics

Review module boundaries, callers, tests, and replacement diffs.

Valid proof shows a useful public interface, hidden internal complexity, and no unexplained orphaned predecessor path.

File count, function length, or wrapper creation alone are not evidence of a deep module.

## Derived from

- [Loom Anchor](../../anchors/loom/anchor.md)
