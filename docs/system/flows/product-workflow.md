---
type: flow
title: Autonomous Product Workflow
description: Current end-to-end Loom flow from fuzzy intent to verified product.
tags: [flow, loom, product, autonomy]
---

# Autonomous Product Workflow


## One continuing conversation

Loom is the single user-facing engineering partner; `general` remains its runtime identifier. Brainstorming, explanation, and bounded problem-solving are normal conversation. Research/Diagnostic are internal capabilities, not modes the user must manage.

```text
conversation
  -> optional advisory investigation
  -> execution commitment
  -> Task / Change / Objective
  -> verified result, with conversation still available
```

Task and Change may be request-backed; Objective requires accepted product authority. Capture already-resolved meaning without asking the user to repeat it. New user-owned choices are not covered by an earlier commitment; specialist-owned realization remains with the specialist.

Scoped refinement reconciles affected authority and downstream work without discarding unaffected evidence. Conversational findings remain context, not retrospective governed proof. Terminal workflow bindings do not prevent later advisory investigation.

## Conversation before execution

Conversation is the outer loop. Explanation, sparring, deep dives, research, diagnosis, inspection, focused review, and bounded problem-solving may complete without any durable workflow state.

The transition is:

```text
conversation
  -> optional Research / Diagnostic investigation
  -> execution commitment
  -> Task / Change / Objective
```

Read-only imperative requests such as "perform a test", "verify this mapping", "check this policy", "review this helper", or "debug this failure" remain conversation when the requested outcome is findings rather than mutation or durable workflow treatment.

Execution commitment means the user asks Loom to mutate/fix/apply/build/ship an outcome, or explicitly requests governed verification/investigation whose findings must be tracked, preserved, independently reviewed/gated, or continued through workflow state. Finding a defect during conversation does not itself cross this boundary.

Execution depth classifies that governed execution; it does not classify ordinary conversation.

## Proportional paths

After that boundary, Loom starts with the smallest workflow that can safely finish the committed work. Complexity discovered later may deepen the path; possible future complexity does not.

### Task

For bounded committed execution such as small fixes, mechanical edits, or explicitly governed/tracked verification and investigation:

```text
clear bounded execution commitment
  -> Diagnostic and/or Research only when actually needed
  -> if governed read-only: Reviewer task verification -> done
  -> if mutation requested: Worker -> Reviewer implementation/verification -> done
```

A conversational debug/research/review request does not become a Task merely because it is bounded. A Task exists only after the execution boundary is crossed.

A Task does not require a new Anchor. It may use an existing accepted Anchor when relevant, otherwise it starts as a bounded request workflow. Governed read-only work uses `implementationRequested=false` and does not create a Worker/write-scope obligation.

### Change

When the committed request already demonstrates—or Task evidence later reveals—a bounded need for new UX semantics, behavioral guarantees, or structural authority:

```text
clear bounded change commitment
  -> required Research / Designer / Specifier only as earned
  -> Reviewer over changed meaning
  -> Architect + Reviewer only when structural authority is required
  -> Worker
  -> Reviewer implementation review
  -> knowledge-sync only for structural changes
  -> done
```

Change depth deliberately skips Planner, Critic, whole-product Product Acceptance, and final product gates.

A Change may therefore start directly as a request-backed workflow; it does not need a preceding Task. Unresolved Designer/Specifier/Architect work is specialist-owned realization, not automatically user-owned product intent. Use intent shaping only when a load-bearing choice truly belongs to the user rather than Loom expertise.

### Objective

For broad product work, multi-part feature delivery, or work that benefits from decomposition and whole-product acceptance:

```text
fuzzy/new product intent when needed
  -> focused grilling
  -> proposed Anchor
  -> explicit user acceptance
  -> accepted Anchor
  -> required Research / Designer / Specifier
  -> Reviewer
  -> Architect when structural realization is needed
  -> Reviewer
  -> Critic solution attack
  -> Planner
  -> bounded task:* Workers
  -> Reviewer implementation review
  -> Product Acceptance
     + Designer validation when human-facing
     + knowledge-sync
  -> Reviewer product review
  -> Critic final attack
  -> done
```

### Escalation rule

> The workflow must be cheaper and simpler than the work it coordinates.

Start shallow. Stay shallow for obvious bounded findings. A completed Task may escalate Task -> Change when later evidence earns additional authority; completed discovery evidence is preserved while widened implementation/review work is reopened. Change -> Objective is reserved for broad product delivery and requires an accepted Anchor, `productOutcome=true`, and implementation authority. A request is never promoted merely because it *might* uncover something substantial.

## Recovery

- Missing meaning routes through OQs to the correct authority.
- Failed review reopens only affected downstream work.
- Retry/dispatch budgets stop repeated non-progress.
- Upstream rework invalidates stale Product Acceptance and living-knowledge reports.
- A passed Wave review releases its execution claim; later workflow gates consume the exact reviewed history.
- Explicit user cancellation uses `loom_cancel`, preserves completed work and evidence, and permits a fresh authorized workflow. It does not turn unfinished gates into passes or undo already-running external tools. `loom_work_release` is not an abort operation.

## Navigation

- [Control Plane](../components/control-plane.md)
- [Verification](../components/verification.md)
- [Knowledge and Memory](../components/knowledge-memory.md)


## Intent boundary

Conversation precedes execution. Mentioning an idea, asking for alternatives, requesting a deep dive, asking for diagnosis, or requesting findings does not by itself create a workflow or Anchor.

When the user clearly asks Loom to carry out the outcome, Loom crosses into governed execution. Bounded work may start as request-backed Task/Change without a new Anchor when no new **user-owned product intent** must be decided. Change may obtain new Designer/Specifier/Architect authority inside that bounded workflow. Broad/new product work still requires accepted product authority before Objective execution.

Once a governed workflow starts, General continues it as an orchestration loop: after each synchronous child returns, inspect status and dispatch the next runnable owner. Read-only Task/Change workflows continue through their independent review gates even though no Worker is present.

After execution authority is established, ordinary expertise-solvable work proceeds autonomously. Product intent is not repeatedly reopened without new material evidence.
