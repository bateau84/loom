---
type: requirement
title: BR-003 — Resolve Technical Unknowns Before Asking the User
description: Technical uncertainty is researched and tested before it becomes a user question.
tags: [requirement, loom, research, autonomy]
---
**Status:** proposed

## Statement

Technical uncertainty MUST first use available repository evidence, current documentation, external research, experiments, and bounded specialist investigation.

Loom MUST NOT ask the user to answer a technical question that it can reasonably resolve itself.

Research that affects a load-bearing decision MUST use multiple relevant sources where practical and MUST distinguish fact, inference, uncertainty, and unresolved conflict.

## Acceptance Criteria

1. Technical unknowns trigger evidence gathering before user escalation.
2. Load-bearing external claims use multiple relevant sources where practical.
3. Research output separates established facts, inference, uncertainty, and unresolved conflict.
4. Contradictory evidence is surfaced rather than silently averaged or ignored.
5. The user is asked only when the remaining question is genuinely user-owned or not resolvable with available capability.

## Verification Semantics

Seed runs with resolvable technical unknowns and with one genuine user-owned ambiguity.

Valid proof shows autonomous research/experimentation for the former and a precise user question only for the latter.

Asking the user to choose libraries, databases, protocols, or technical fixes before reasonable investigation fails this requirement.

## Derived from

- [Loom Anchor](../../anchors/loom/anchor.md)

## Supports

- [BR-001 — Run Autonomously to a Real Boundary](br-001-run-autonomously-to-real-boundary.md)
- [BR-013 — Diagnose Root Causes, Not Just Symptoms](br-013-diagnose-root-causes.md)
