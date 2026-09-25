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

1. Objective depth accepts `productOutcome=true` with `implementationRequested=false` for planning-only work against an accepted Anchor.
2. The planning-only Objective workflow ends after the required solution/authority work, Planner, and independent `review-plan`; it contains no Worker steps, implementation review, Product Acceptance, or final product gate.
3. Planner MUST persist a valid holistic Plan with `loom_work_plan`. Planning completion requires that durable Plan but MUST NOT require or create an executable Worker DAG.
4. `loom_task_plan` mechanically rejects planning-only workflows so no Worker scope, Wave claim, or executable Task can be created accidentally.
5. Reviewer receives the bounded holistic Plan and can inspect exact semantic Task contracts by Task ID. Missing executable write scopes are not a planning-only defect because scope compilation is intentionally deferred.
6. A planning-only `review-plan` verdict is fenced to the exact review attempt, Plan generation/revision, and whole-Plan semantic fingerprint so invalidation or same-revision semantic drift cannot reuse a stale verdict. PASS records the reviewed Plan revision/fingerprint on the workflow as a durable receipt, completes only the planning workflow, acquires no Wave claim, and leaves Objective/Task implementation state unchanged. Reopening Plan review clears that receipt until a fresh PASS.
7. Failed Plan review returns only the affected unconsumed planning work to Planner; it does not create implementation authority.
8. A later implementation request starts a fresh workflow against the same Objective/Plan. Planner may reuse the current reviewed semantic Plan and compile the first dependency-eligible executable Wave without replacing the Plan unless new evidence requires replanning.
9. The later implementation workflow receives the normal executable `review-plan` gate; only that PASS may acquire the Wave claim and make Workers runnable.
10. Status/dashboard/user-facing output distinguishes **planning workflow complete** from **Objective/product complete** and does not imply that this workflow implemented the Objective or that pre-existing implementation state is absent.

## Verification Semantics

Use deterministic routing/control-plane tests to prove the planning-only DAG, persistent-Plan requirement, `loom_task_plan` rejection, semantic Task inspection, zero Wave claims, active parent Objective, terminal planning workflow, and later Plan reuse for executable Wave compilation. Use behavioral evaluation to prove General honors an explicit “plan only / do not implement” instruction without dispatching Worker or inventing completion.

## Derived from

- [BR-004 — Produce the Whole Product](br-004-produce-the-whole-product.md)
- [BR-006 — Independent Verification Is Normal; Holistic Attack Is Selective](br-006-independent-review-and-selective-critic.md)
- [BR-008 — Bounded Autonomy and Progress](br-008-bounded-autonomy-and-progress.md)
- [BR-019 — Keep Workflow Ceremony Proportional](br-019-keep-workflow-ceremony-proportional.md)
- [BR-021 — Preserve Holistic Plan Context Across Handoffs](br-021-preserve-holistic-plan-context.md)
