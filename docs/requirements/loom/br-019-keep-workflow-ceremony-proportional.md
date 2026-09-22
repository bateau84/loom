---
type: requirement
title: BR-019 — Keep Workflow Ceremony Proportional
description: Loom keeps ordinary conversation outside workflow state, then starts committed execution on the smallest safe path and escalates only when current evidence demonstrates the need.
tags: [requirement, loom, routing, proportionality, ceremony, escalation]
---
**Status:** proposed

## Statement

Ordinary conversation MUST remain outside durable workflow state by default.

Explanation, sparring, deep dives, research, diagnosis/debugging, focused review, inspection, and bounded problem-solving do not inherently require `loom_start` or an execution depth. Research and Diagnostic may operate as advisory conversational investigations when fresh specialist context materially improves the answer.

When the user commits Loom to tracked/governed execution — for example mutate/fix/apply/build/ship work, or an explicitly governed investigation/verification whose findings must be tracked, preserved, or independently verified — Loom MUST use the smallest workflow that can safely complete that committed work.

Execution depth is evidence-driven **after that boundary**:

- **Task** — direct bounded work. Read-only tasks use the relevant Diagnostic/Research/Reviewer path; mutation tasks use Worker plus independent verification.
- **Change** — substantial but bounded work that has demonstrably earned new Designer, Specifier, or Architect authority.
- **Objective** — broad product work that warrants decomposition, holistic Critic gates, whole-product Product Acceptance, and final product review.

Potential future complexity MUST NOT be treated as present complexity, and potential future execution MUST NOT be treated as a reason to create workflow state during ordinary conversation.

## Acceptance Criteria

1. Ordinary explanation, sparring, research/deep-dive, diagnosis-only, focused-review, and bounded problem-solving requests may complete without creating workflow state.
2. A clear bounded **execution commitment** can start without creating a new Anchor when no new product authority is required.
3. An explicitly governed read-only Task does not invoke Worker or require a Worker write scope; it ends through Reviewer verification after any required governed Diagnostic/Research work.
4. Task-depth work does not invoke Planner, Critic, Product Acceptance, knowledge sync, or final product gates unless another independent requirement specifically makes one necessary.
5. Diagnostic and bounded Research may occur conversationally without workflow state, or inside Task depth when the user explicitly requested governed/tracked work; neither automatically promotes execution depth.
6. A Task stays shallow when it uncovers an obvious bounded fix with no new product/design/architecture authority.
7. A completed Task may promote to Change when current evidence reveals unresolved UX semantics, behavioral guarantees, structural authority, or materially wider bounded scope; completed discovery evidence is preserved while widened implementation/review work is reopened.
8. Objective depth is selected only for broad product work that benefits from decomposition and whole-product acceptance.
9. `executionDepth=objective` is valid only with `productOutcome=true`, `implementationRequested=true`, and accepted product authority.
10. Request-backed work cannot silently become an Objective; Objective-depth execution requires accepted product authority.
11. Existing completed evidence is preserved when a workflow is re-routed deeper, but a gate is not preserved when its dependency set changes.
12. User approval to fix findings does not by itself force Objective depth; demonstrated breadth and authority needs control the depth.
13. Diagnosis-only or research-only conversation does not silently expand into implementation or durable workflow state. A later explicit fix/apply/build request crosses the execution boundary and then selects Task/Change/Objective from the demonstrated scope.
14. Conversational findings may carry forward as context when execution begins, but load-bearing workflow proof MUST be established through normal governed evidence/verification rather than treating conversational prose as proof.

## Verification Semantics

Behavioral evals MUST cover the conversation/execution boundary as well as all execution depths:

- **conversation / no workflow:** deep dive, diagnosis-only, explanation, sparring, focused review, and bounded investigation where the user asked for findings rather than tracked execution;
- **governed Task:** small fixes and explicitly tracked/read-only verification or investigation;
- **Change / Objective:** new user-facing semantics, new behavioral guarantees, cross-cutting structural decisions, and broad multi-part product objectives;
- **hybrid:** conversational investigation followed by an execution commitment, a shallow Task that stays shallow after a minor finding, a Task that promotes to Change after material evidence, and a follow-up that promotes previously discovered broad findings into an Objective.

The corpus SHOULD include adversarial prompts where "this might be bigger" is the only reason to escalate. Those cases pass only when Loom remains conversational or shallow according to the actual committed work.

## Derived from

- [Loom Anchor](../../anchors/loom/anchor.md)

## Depends on

- [BR-001 — Run Autonomously to a Real Boundary](br-001-run-autonomously-to-real-boundary.md)
- [BR-002 — Route Missing Expertise Explicitly](br-002-route-missing-expertise-explicitly.md)
- [BR-006 — Independent Verification Is Normal; Holistic Attack Is Selective](br-006-independent-review-and-selective-critic.md)
- [BR-008 — Bounded Autonomy and Progress](br-008-bounded-autonomy-and-progress.md)
- [BR-013 — Diagnose Root Causes, Not Just Symptoms](br-013-diagnose-root-causes.md)
