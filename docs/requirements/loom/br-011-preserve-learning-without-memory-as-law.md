---
type: requirement
title: BR-011 — Preserve Useful Learning Without Turning Memory into Law
description: Loom retains useful experience and heuristics without allowing memory to override current authority.
tags: [requirement, loom, memory, heuristics, learning]
---
**Status:** proposed

## Statement

Loom MUST retain useful lessons from failures, successful patterns, reviews, research, and product work.

Learned material MUST distinguish at least current accepted authority, workflow state, episodic experience, and provisional or validated heuristics.

Memory and heuristics MUST NOT silently override current accepted product authority.

A heuristic SHOULD become broadly trusted only after independent supporting evidence or repeated successful use.

## Acceptance Criteria

1. Durable authority, workflow state, episodic memory, and heuristic learning remain distinguishable.
2. Relevant past lessons can be retrieved in later sessions.
3. Conflicts between memory/heuristics and current authority resolve in favor of current authority.
4. New heuristics begin provisional unless prior evidence justifies stronger status.
5. Promotion records supporting evidence or repeated successful use.

## Verification Semantics

Test retrieval across sessions and inject a stale memory that conflicts with current accepted authority.

Valid proof shows useful recall while the stale memory is rejected as governing authority.

A vector-memory hit, agent recollection, or frequently repeated statement is not by itself proof that a heuristic is valid.

## Derived from

- [Loom Anchor](../../anchors/loom/anchor.md)
