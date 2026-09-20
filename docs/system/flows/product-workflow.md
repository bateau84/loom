---
type: flow
title: Autonomous Product Workflow
description: Current end-to-end Loom flow from fuzzy intent to verified product.
tags: [flow, loom, product, autonomy]
---

# Autonomous Product Workflow

## Path

```text
fuzzy product intent
  -> focused grilling (one question at a time)
     + repository/research resolution where possible
  -> proposed Anchor
  -> explicit user acceptance
  -> accepted Anchor
  -> required Research / Designer / Specifier
  -> Reviewer
  -> Architect when structural realization is needed
  -> Reviewer
  -> Critic solution attack
  -> Planner
  -> bounded task:* Workers (parallel/sequential by DAG)
  -> Reviewer implementation review
  -> Product Acceptance
     + Designer validation when human-facing
     + knowledge-sync
  -> Reviewer product review
  -> Critic final attack
  -> done
```

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
