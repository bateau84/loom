---
type: requirement
title: BR-010 — Fresh Sessions Start from the Map
description: Fresh sessions recover purpose and structure from maintained knowledge before broad code exploration.
tags: [requirement, loom, context, documentation, recovery]
---
**Status:** proposed

## Statement

A fresh Loom session MUST be able to recover the product's purpose, important structure, current authority, and likely investigation surface from maintained repository knowledge before requiring broad codebase exploration.

The system map is navigation, not proof: current code claims still require current inspection when they matter.

## Acceptance Criteria

1. A fresh session can identify product purpose and current accepted authority from repository knowledge.
2. It can identify major components, important flows, and likely code areas for a bounded task.
3. It can begin targeted investigation without first scanning the entire repository.
4. Current implementation claims are still verified against relevant current code/evidence when load-bearing.

## Verification Semantics

Run a cold-session maintenance exercise with no conversational history.

Valid proof shows the session uses repository knowledge to narrow its investigation before targeted code inspection and successfully explains why it chose those areas.

Reading most or all source files before forming a useful system map does not satisfy the intended behavior.

## Derived from

- [Loom Anchor](../../anchors/loom/anchor.md)

## Depends on

- [BR-009 — Maintain Living Repository Knowledge](br-009-maintain-living-repository-knowledge.md)
