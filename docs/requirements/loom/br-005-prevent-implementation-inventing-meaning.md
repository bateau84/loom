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

## Derived from

- [Loom Anchor](../../anchors/loom/anchor.md)

## Depends on

- [BR-002 — Route Missing Expertise Explicitly](br-002-route-missing-expertise-explicitly.md)
