---
type: component
title: Loom Verification
description: Observed evidence, independent review, Product Acceptance, and final adversarial verification.
tags: [component, loom, verification, evidence]
---

# Verification

## Evidence Ledger

Non-Loom tool executions are observed by plugin hooks. Evidence claims reference observed events; prose alone cannot establish build/test/runtime success.

Source:
- `plugins/loom/evidence.ts`
- evidence hooks in `plugins/loom/index.ts`

## Review Layers

1. Worker self-check.
2. Observed mechanical evidence.
3. Reviewer implementation review.
4. Product Acceptance through the real assembled product.
5. Designer validation for human-facing products.
6. Reviewer product review.
7. Final Critic attack.

## Product Acceptance

Scenario state is workflow-local in `plugins/loom/acceptance.ts`. PASS requires Product Acceptance evidence claims. Upstream rework invalidates prior acceptance results.

## Depends on

- [Control Plane](control-plane.md)
- [Agent Runtime](agent-runtime.md)
