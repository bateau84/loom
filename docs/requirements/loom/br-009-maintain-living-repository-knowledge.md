---
type: requirement
title: BR-009 — Maintain Living Repository Knowledge
description: Repository documentation stays concise, current, and useful for understanding the product and system.
tags: [requirement, loom, documentation, okf, knowledge]
---
**Status:** proposed

## Statement

As the product changes, Loom MUST maintain concise documentation sufficient to explain product purpose, important behavior and guarantees, major modules and public seams, component and dependency relationships, important data and state, external integrations, important end-to-end flows, and operational and user-facing usage where relevant.

Documentation MUST change when the represented reality changes.

Documentation MUST NOT be created or expanded solely because ceremony requires another artifact.

Repository knowledge SHOULD use OKF-compatible documents and SHOULD be discoverable through OKF tooling when available.

## Acceptance Criteria

1. Changes that alter documented reality update the affected documentation in the same body of work.
2. Stable unaffected documentation is not rewritten merely to satisfy process.
3. Major components, dependencies, data, integrations, flows, and public seams are discoverable from repository knowledge.
4. Documentation relationships are machine-discoverable through OKF-compatible structure where available.
5. Documentation describes current reality rather than planned-but-unimplemented behavior without clear status.

## Verification Semantics

Compare representative implementation changes with the knowledge base before and after the change.

Valid proof shows changed facts updated, unchanged facts left alone, and OKF discovery locating the relevant documents.

A documentation-count target, generic architecture prose, or stale documents that merely exist do not satisfy this requirement.

## Derived from

- [Loom Anchor](../../anchors/loom/anchor.md)

## Supports

- [BR-010 — Fresh Sessions Start from the Map](br-010-fresh-sessions-start-from-map.md)
