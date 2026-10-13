---
type: requirement
title: BR-023 — Explain Work State and Genuine Blockers
description: Users can distinguish ongoing work, supported progress, and the reason Loom cannot safely continue.
tags: [requirement, loom, transparency, evidence, blockers]
---
**Status:** proposed

## Statement

When Loom presents the state of accepted or committed work, it MUST make clear what it is doing, why that work is relevant to the accepted outcome, what observed evidence supports material progress claims, and why it has stopped when it cannot safely continue.

## Acceptance Criteria

1. A presented in-progress state identifies the active work at a level that distinguishes it from completed work and from work waiting on a decision or capability.
2. A material progress or success claim is traceable to observed evidence; absent evidence is represented as unknown or unproven, not implied success.
3. When work cannot safely continue, the explanation identifies the unresolved condition and whether it is a user-owned decision, an exhausted capability/recovery boundary, or another routed blocker.
4. The explanation does not characterize incomplete or blocked work as product completion, and does not imply that a user decision is needed for an expertise-solvable question.
5. These semantics do not require a particular presentation surface or expose hidden prompts, credentials, or unrestricted tool output.

## Verification Semantics

Inspect representative traces for active work, evidence-backed progress, missing evidence, an expertise-routed blocker, a genuine user-owned decision, exhausted bounded recovery, and completed work. For each trace, compare the presented explanation with canonical workflow state and observed evidence. Misstated status, unsupported progress, an unexplained stop, or a false user-approval boundary fails; different presentation surfaces may satisfy the same semantics.

## Derived from

- [Loom Anchor](../../anchors/loom/anchor.md), Acceptance Criterion 24
- [BR-001 — Run Autonomously to a Real Boundary](br-001-run-autonomously-to-real-boundary.md)
- [BR-007 — Evidence Outranks Model Claims](br-007-evidence-outranks-model-claims.md)
