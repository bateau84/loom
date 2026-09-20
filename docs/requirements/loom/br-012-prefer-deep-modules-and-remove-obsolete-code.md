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

## Derived from

- [Loom Anchor](../../anchors/loom/anchor.md)
