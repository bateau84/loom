---
type: requirement
title: BR-008 — Bounded Autonomy and Progress
description: Autonomous work must show progress and remain within explicit practical limits.
tags: [requirement, loom, autonomy, budget, termination]
---
**Status:** proposed

## Statement

Every autonomously repeated attempt MUST produce at least one of: new material evidence, a materially changed hypothesis, a materially changed strategy, or a reduced unresolved set.

After bounded automatic recovery is exhausted, a fresh explicit user instruction MAY authorize exactly one additional attempt without such progress. That user instruction is single-use; any later no-progress attempt requires another fresh user instruction. Otherwise Loom MUST stop repeating the same approach and reroute or stop safely.

Workflows MUST support practical bounds on expensive reasoning, retries, review loops, parallel work, and total resource use.

Budget exhaustion or exhausted recovery MUST produce an honest resumable state, not fabricated success.

## Acceptance Criteria

1. Each autonomous retry records what materially changed from the prior attempt.
2. Repeating the same failure with the same strategy beyond the configured automatic limit is prevented.
3. Workflows carry explicit limits for expensive reasoning, retries, review loops, parallel work, or equivalent resource controls.
4. Exhausted limits produce a resumable incomplete state with preserved evidence.
5. A fresh explicitly user-authorized continuation adds exactly one dispatch to the same unfinished target without replacing its Task/workflow or resetting prior attempts.
6. User-authorized continuation records the exact observed user-message provenance, cannot reuse that user message, and never weakens verification, evidence, or independent-gate semantics.
7. A user continuation cannot be spent by another runnable target and cannot pre-authorize several no-progress retries.
8. Budget pressure never changes FAIL/UNPROVEN into PASS.

## Verification Semantics

Use synthetic failures that repeat identically, failures that reveal new evidence, runs that exhaust configured limits, and an exhausted unfinished target followed by explicit user authorization to continue.

Valid proof shows autonomous retry only when progress changes materially, a clean resumable stop when automatic recovery is exhausted, and exactly one continuation dispatch of the same target when a fresh observed user message explicitly authorizes it. The continuation must preserve prior attempts/evidence and the downstream verification path; reusing the same user message, charging a sibling target, or taking a second no-progress continuation dispatch must fail.

An unlimited loop, hidden retry storm, batched no-progress continuation, duplicate Task/workflow created only to reset quota, or success claim caused by budget exhaustion fails this requirement.

## Derived from

- [Loom Anchor](../../anchors/loom/anchor.md)
