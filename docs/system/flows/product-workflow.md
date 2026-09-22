---
type: flow
title: Autonomous Product Workflow
description: Current end-to-end Loom flow from fuzzy intent to verified product.
tags: [flow, loom, product, autonomy]
---

# Autonomous Product Workflow

## Proportional paths

Loom starts with the smallest workflow that can safely finish the current request. Complexity discovered later may deepen the path; possible future complexity does not.

### Task

For bounded testing, debugging, inspection, focused review, mechanical edits, and small fixes:

```text
clear bounded request
  -> Diagnostic and/or Research only when actually needed
  -> if read-only: Reviewer task verification -> done
  -> if mutation requested: Worker -> Reviewer implementation/verification -> done
```

A Task does not require a new Anchor. It may use an existing accepted Anchor when relevant, otherwise it starts as a bounded request workflow. Read-only work uses `implementationRequested=false` and does not create a Worker/write-scope obligation.

### Change

When Task evidence shows new UX semantics, behavioral guarantees, or structural authority is actually needed:

```text
material bounded change
  -> required Research / Designer / Specifier only as earned
  -> Reviewer over changed meaning
  -> Architect + Reviewer only when structural authority is required
  -> Worker
  -> Reviewer implementation review
  -> knowledge-sync only for structural changes
  -> done
```

Change depth deliberately skips Planner, Critic, whole-product Product Acceptance, and final product gates.

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

## Navigation

- [Control Plane](../components/control-plane.md)
- [Verification](../components/verification.md)
- [Knowledge and Memory](../components/knowledge-memory.md)


## Intent boundary

Before the Anchor is accepted, the user is in the loop because Loom is discovering what product they want.

After acceptance, ordinary expertise-solvable work proceeds autonomously. Product intent is not repeatedly reopened without new material evidence.
