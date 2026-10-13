---
type: requirement
title: BR-022 — Support Planning-Only Objective Completion
description: A whole-Objective planning request can terminate with a durable independently reviewed Plan without beginning implementation or completing the Objective.
tags: [requirement, loom, planning, objective, review, proportionality]
---
**Status:** proposed

## Statement

When the user requests a complete Objective Plan but explicitly does not authorize implementation, Loom MUST treat the reviewed Plan as the terminal outcome of that workflow without creating execution authority.

Completing the planning workflow MUST NOT complete or advance implementation of the parent Objective. The Objective remains active; existing completed/claimed work is preserved, and this workflow creates no new Worker execution or Wave claim.

## Acceptance Criteria

1. A planning-only outcome is available only when the user requests a Plan without authorizing implementation against an accepted Anchor.
2. Planning is complete only after a durable holistic Plan has received an independent whole-Plan review verdict; an absent or failed review is not reported as a reviewed outcome.
3. Completing the planning workflow creates no implementation execution, newly runnable implementation work, or claim over work reserved for execution.
4. Planning completion leaves the parent Objective's implementation status and any pre-existing implementation work unchanged.
5. A failed review does not grant implementation authority; planning remains incomplete until the Plan is revised as needed and reviewed successfully.
6. Any later implementation requires a distinct user-authorized transition and the normal independent review boundary before execution begins.
7. User-facing status distinguishes **planning workflow complete** from **Objective/product complete**, and does not imply that this workflow implemented the Objective or that pre-existing implementation state is absent.

## Verification Semantics

Verify an explicitly plan-only request through completion: a durable holistic Plan exists, an independent review has passed, no implementation work became runnable or claimed, and parent Objective/previous work state is unchanged. Verify a failed Plan review does not enable implementation and that a later separately authorized implementation request crosses its required review boundary. Evaluate that user-facing status calls the Plan outcome planning completion, not Objective or product completion.

## Derived from

- [BR-004 — Produce the Whole Product](br-004-produce-the-whole-product.md)
- [BR-006 — Independent Verification Is Normal; Holistic Attack Is Selective](br-006-independent-review-and-selective-critic.md)
- [BR-008 — Bounded Autonomy and Progress](br-008-bounded-autonomy-and-progress.md)
- [BR-019 — Keep Workflow Ceremony Proportional](br-019-keep-workflow-ceremony-proportional.md)
- [BR-021 — Preserve Holistic Plan Context Across Handoffs](br-021-preserve-holistic-plan-context.md)
- User resolution of planning scope in OQ `3fb7f28b-e116-4765-9366-d2a84c9f7222` (a reviewed planning/plan-only outcome is in scope as an intermediate outcome, distinct from product completion and granting no implementation authority).
