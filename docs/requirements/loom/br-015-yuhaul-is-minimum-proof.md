---
type: requirement
title: BR-015 — YuHaul Is the Minimum End-to-End Proof
description: Loom's first release is proven by building and later maintaining YuHaul without manual agent herding.
tags: [requirement, loom, yuhaul, acceptance, dogfood]
---
**Status:** proposed

## Statement

Loom's first acceptable release MUST demonstrate these requirements by taking the accepted YuHaul product intent to a real usable product without manual agent herding.

The proof MUST include a later fresh-session maintenance exercise in which Loom understands enough of YuHaul from its maintained knowledge to diagnose and repair a real defect.

Leash-level complexity is the longer-term target, not a requirement for Loom's first usable release.

## Acceptance Criteria

1. Loom starts from the accepted YuHaul Anchor and reaches a usable YuHaul product.
2. Normal agent routing and correction proceeds without manual user herding.
3. YuHaul Product Acceptance exercises its real product-owned composition.
4. Repository knowledge is sufficient for a later cold session to navigate YuHaul meaningfully.
5. A later defect can be diagnosed and repaired from that fresh session.
6. The run records enough evidence to assess quality, autonomy, failures, and resource use.

## Verification Semantics

This requirement is verified only by an actual end-to-end YuHaul build followed by a separate cold-session maintenance exercise.

A toy substitute, mocked YuHaul, partial prototype, or demonstration composed of isolated green components does not satisfy it.

## Derived from

- [Loom Anchor](../../anchors/loom/anchor.md)

## Depends on

- [BR-004 — Produce the Whole Product](br-004-produce-the-whole-product.md)
- [BR-010 — Fresh Sessions Start from the Map](br-010-fresh-sessions-start-from-map.md)
