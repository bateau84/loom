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

## Derived from

- [Loom Anchor](../../anchors/loom/anchor.md)
