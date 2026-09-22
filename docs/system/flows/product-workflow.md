---
type: flow
title: Autonomous Product Workflow
description: Current end-to-end Loom flow from fuzzy intent to verified product.
tags: [flow, loom, product, autonomy]
---

# Autonomous Product Workflow

## Path

```text
conversation
  -> optional sparring / repository inspection / research / diagnosis
  -> explicit execution intent
  -> focused intent resolution only where user-owned product meaning remains
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


## Conversation and execution boundary

Conversation is the outer loop. Mentioning an idea, asking for alternatives, requesting a deep dive, or asking for diagnosis does not by itself create a product workflow.

When the user clearly asks Loom to build, implement, change, fix, ship, or otherwise carry out the discussed outcome, Loom crosses into execution. It resolves only the remaining user-owned product meaning, captures durable authority proportionately, and proceeds autonomously.

After accepted execution intent exists, ordinary expertise-solvable work proceeds without user herding. The conversation remains available for interruption and refinement; affected authority and downstream work are reconciled rather than restarting the whole process.
