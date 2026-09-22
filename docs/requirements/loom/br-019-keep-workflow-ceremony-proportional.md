---
type: requirement
title: BR-019 — Keep Workflow Ceremony Proportional
description: Loom starts bounded work on the smallest safe execution path and escalates only when current evidence demonstrates the need.
tags: [requirement, loom, routing, proportionality, ceremony, escalation]
---
**Status:** proposed

## Statement

Loom MUST use the smallest workflow that can safely complete the current request.

Bounded testing, debugging, inspection, focused review, mechanical edits, and small fixes MUST NOT be routed through the full product lifecycle merely because they touch product code or could uncover larger issues.

Workflow depth is evidence-driven:

- **Task** — direct bounded work. Read-only tasks use the relevant Diagnostic/Research/Reviewer path; mutation tasks use Worker plus independent verification.
- **Change** — substantial but bounded work that has demonstrably earned new Designer, Specifier, or Architect authority.
- **Objective** — broad product work that warrants decomposition, holistic Critic gates, whole-product Product Acceptance, and final product review.

Potential future complexity MUST NOT be treated as present complexity.

## Acceptance Criteria

1. A clear bounded request can start without creating a new Anchor.
2. A read-only Task does not invoke Worker or require a Worker write scope; it ends through Reviewer verification after any required Diagnostic/Research work.
3. Task-depth work does not invoke Planner, Critic, Product Acceptance, knowledge sync, or final product gates unless another independent requirement specifically makes one necessary.
4. Diagnostic and bounded Research work can occur inside Task depth without automatically promoting the workflow.
5. A Task stays shallow when it uncovers an obvious bounded fix with no new product/design/architecture authority.
6. A completed Task may promote to Change when current evidence reveals unresolved UX semantics, behavioral guarantees, structural authority, or materially wider bounded scope; completed discovery evidence is preserved while widened implementation/review work is reopened.
7. Objective depth is selected only for broad product work that benefits from decomposition and whole-product acceptance.
8. `executionDepth=objective` is valid only with `productOutcome=true`, `implementationRequested=true`, and accepted product authority.
9. Request-backed work cannot silently become an Objective; Objective-depth execution requires accepted product authority.
10. Existing completed evidence is preserved when a workflow is re-routed deeper, but a gate is not preserved when its dependency set changes.
11. User approval to fix findings does not by itself force Objective depth; demonstrated breadth and authority needs control the depth.
12. Diagnosis-only or test-only requests do not silently expand into implementation unless repair was requested or subsequently authorized.

## Verification Semantics

Behavioral evals MUST cover all three classes:

- **no ceremony:** focused function test, debug trace, failing test investigation, small UI fix, endpoint verification, focused review;
- **ceremony required:** new user-facing semantics, new behavioral guarantees, cross-cutting structural decisions, broad multi-part product objectives;
- **hybrid:** a shallow task that stays shallow after a minor finding, a shallow task that promotes to Change after material evidence, and a follow-up that promotes previously discovered broad findings into an Objective.

The corpus SHOULD include adversarial prompts where "this might be bigger" is the only reason to escalate. Those cases pass only when Loom stays shallow.

## Derived from

- [Loom Anchor](../../anchors/loom/anchor.md)

## Depends on

- [BR-001 — Run Autonomously to a Real Boundary](br-001-run-autonomously-to-real-boundary.md)
- [BR-002 — Route Missing Expertise Explicitly](br-002-route-missing-expertise-explicitly.md)
- [BR-006 — Independent Verification Is Normal; Holistic Attack Is Selective](br-006-independent-review-and-selective-critic.md)
- [BR-008 — Bounded Autonomy and Progress](br-008-bounded-autonomy-and-progress.md)
- [BR-013 — Diagnose Root Causes, Not Just Symptoms](br-013-diagnose-root-causes.md)
