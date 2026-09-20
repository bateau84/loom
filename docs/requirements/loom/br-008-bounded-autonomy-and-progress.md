---
type: requirement
title: BR-008 — Bounded Autonomy and Progress
description: Autonomous work must show progress and remain within explicit practical limits.
tags: [requirement, loom, autonomy, budget, termination]
---
**Status:** proposed

## Statement

Every repeated attempt MUST produce at least one of: new material evidence, a materially changed hypothesis, a materially changed strategy, or a reduced unresolved set.

Otherwise Loom MUST stop repeating the same approach and reroute or stop safely.

Workflows MUST support practical bounds on expensive reasoning, retries, review loops, parallel work, and total resource use.

Budget exhaustion or exhausted recovery MUST produce an honest resumable state, not fabricated success.

## Acceptance Criteria

1. Each retry records what materially changed from the prior attempt.
2. Repeating the same failure with the same strategy beyond the configured limit is prevented.
3. Workflows carry explicit limits for expensive reasoning, retries, review loops, parallel work, or equivalent resource controls.
4. Exhausted limits produce a resumable incomplete state with preserved evidence.
5. Budget pressure never changes FAIL/UNPROVEN into PASS.

## Verification Semantics

Use synthetic failures that repeat identically, failures that reveal new evidence, and runs that exhaust configured limits.

Valid proof shows continued work only when progress changes materially and a clean stop when it does not.

An unlimited loop, hidden retry storm, or success claim caused by budget exhaustion fails this requirement.

## Derived from

- [Loom Anchor](../../anchors/loom/anchor.md)
