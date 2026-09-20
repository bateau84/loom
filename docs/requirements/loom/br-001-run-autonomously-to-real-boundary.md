---
type: requirement
title: BR-001 — Run Autonomously to a Real Boundary
description: Continue accepted work without routine user intervention until completion or a genuine user-owned boundary.
tags: [requirement, loom, autonomy, workflow]
---
**Status:** proposed

## Statement

After the user accepts an Anchor, Loom MUST continue through all expertise-solvable work without requiring routine user approvals.

Loom may stop for the user only when product intent or material scope genuinely needs a user decision, a subjective product choice cannot be derived from accepted intent, a material guarantee would be weakened, explicit material risk acceptance is required, or a required capability remains unavailable after bounded recovery is exhausted.

A phase change, agent handoff, review result, planning boundary, or implementation wave is not by itself a user boundary.

## Derived from

- [Loom Anchor](../../anchors/loom/anchor.md)

## Depends on

- [BR-002 — Route Missing Expertise Explicitly](br-002-route-missing-expertise-explicitly.md)
- [BR-003 — Resolve Technical Unknowns Before Asking the User](br-003-resolve-technical-unknowns-before-user.md)
- [BR-008 — Bounded Autonomy and Progress](br-008-bounded-autonomy-and-progress.md)
