---
type: requirement
title: BR-005 — Prevent Implementation from Inventing Missing Meaning
description: Missing product meaning is routed to the correct authority instead of being silently decided in implementation.
tags: [requirement, loom, authority, semantics]
---
**Status:** proposed

## Statement

Implementation MUST NOT silently define unresolved product behavior, human-facing semantics, guarantees, or structural authority.

When implementation reveals missing meaning, only the dependent work MUST pause. The missing decision is routed to the correct expertise, accepted knowledge is updated, and unaffected work may continue.

## Acceptance Criteria

1. Workers identify when required work exceeds their authority.
2. Missing human-facing semantics route to Designer; behavioral guarantees to Specifier; structural decisions to Architect.
3. Only work depending on the unresolved meaning is paused.
4. Accepted resolution is recorded before dependent implementation resumes.
5. No implementation artifact becomes product authority merely because it already exists.

## Verification Semantics

Use adversarial worker tasks containing an intentionally missing semantic or structural decision.

Valid proof shows the worker stops the dependent path and routes the gap while preserving independent progress.

A plausible implementation choice made without authority, even if tests pass, fails this requirement.

## Derived from

- [Loom Anchor](../../anchors/loom/anchor.md)

## Depends on

- [BR-002 — Route Missing Expertise Explicitly](br-002-route-missing-expertise-explicitly.md)
