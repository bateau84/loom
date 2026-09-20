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

## Behavioral Conformance

The corpus under `evals/` attacks model-driven failure modes such as user-herding, authority drift, fake verification, shallow diagnosis, unsafe planning, stale-memory authority, and incomplete Product Acceptance.

- `scripts/validate-evals.ts` validates case shape and BR traceability without inference.
- `scripts/run-evals.py` runs selected cases through isolated real OpenCode sessions and a fresh semantic judge.
- `.github/workflows/loom-live-evals.yml` exposes inference-bearing evals only through explicit manual dispatch.

Runtime cases provide composition/tool evidence. Role-decision cases provide fresh-context directive-compliance evidence. Neither replaces real YuHaul Product Acceptance.

## Depends on

- [Control Plane](control-plane.md)
- [Agent Runtime](agent-runtime.md)
