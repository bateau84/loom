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
5. An explicitly user-authorized continuation can add bounded dispatch capacity to the same unfinished target without replacing its Task/workflow or resetting prior attempts.
6. User-authorized continuation records the exact user instruction and never weakens verification, evidence, or independent-gate semantics.
7. Budget pressure never changes FAIL/UNPROVEN into PASS.

## Verification Semantics

Use synthetic failures that repeat identically, failures that reveal new evidence, runs that exhaust configured limits, and an exhausted unfinished target followed by explicit user authorization to continue.

Valid proof shows autonomous retry only when progress changes materially, a clean resumable stop when automatic recovery is exhausted, and bounded continuation of the same target when the user explicitly authorizes more work. The continuation must preserve prior attempts/evidence and the downstream verification path.

An unlimited loop, hidden retry storm, duplicate Task/workflow created only to reset quota, or success claim caused by budget exhaustion fails this requirement.

## Derived from

- [Loom Anchor](../../anchors/loom/anchor.md)
