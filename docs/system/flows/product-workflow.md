---
type: flow
title: Autonomous Product Workflow
description: Current end-to-end Loom flow from accepted intent to verified product.
tags: [flow, loom, product, autonomy]
---

# Autonomous Product Workflow

## Path

```text
accepted Anchor
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
