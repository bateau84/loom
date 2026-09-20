---
type: design
title: Loom Verification Model
description: Evidence, Reviewer, Critic, and Product Acceptance responsibilities.
tags: [architecture, loom, verification, reviewer, critic, evidence]
---

**Status:** proposed

## Verification Layers

### 1. Worker self-check

Workers run task-local checks while producing work.

This is useful feedback but is not independent review.

### 2. Mechanical evidence

The control plane records compact tool observations automatically.

An evidence observation proves that a tool operation occurred; it does not by itself prove the product claim the agent wants to make.

Agents therefore create explicit claims that reference observed event IDs. For test/build/lint/security claims, Loom checks that at least one referenced successful shell observation matches that verification class.

Reviewer decides whether the observed operation actually proves the claimed behavior.

Raw result bodies are not stored by default; the ledger retains provenance, safe summaries, and digests.

Missing observed evidence cannot be replaced by confidence.

### 3. Reviewer

Reviewer is the normal independent gate.

Reviewer asks:

> Did this artifact or change correctly satisfy its accepted inputs, boundaries, and required evidence?

Reviewer may route defects back to the producer or the correct authority.

Reviewer does not redesign the whole product simply because another approach exists.

### 4. Product Acceptance

Product Acceptance is executed in a fresh **Acceptance** context, separate from Reviewer.

The active workflow holds a compact scenario plan. Each scenario:
- maps to one or more accepted Anchor/requirement criteria;
- has an immutable result for the current attempt;
- is `passed`, `failed`, or `unproven`;
- requires `product-acceptance` evidence claims for PASS.

Product Acceptance proves accepted outcomes through the real product-owned composition.

Mocks may stand in for true external systems where appropriate.

Mocks must not replace mandatory product-owned components in the path being claimed.

If upstream implementation is reopened, old Product Acceptance results are reset automatically.

Human-facing products additionally run a fresh Designer validation against the realized experience.

### 5. Product Reviewer

After Product Acceptance and any Designer validation pass, Reviewer independently checks:
- scenario coverage against accepted product criteria;
- evidence quality and revision relevance;
- whether real product-owned paths were exercised;
- whether locally green evidence actually proves the assembled product.

Mechanical Product Acceptance readiness is necessary but not sufficient for Reviewer PASS.

### 6. Critic

Critic asks:

> Does the assembled solution or realized product remain coherent when attacked as a whole?

Normal mandatory uses:
1. assembled solution before major implementation;
2. realized product before final acceptance.

Additional invocation requires evidence of serious cross-domain disagreement, repeated failed correction, or an outcome-threatening aggregate concern.

Critic may reopen accepted work only with new material evidence, contradiction, failed proof, or changed authority.

## Correction Limits

Default local correction cycle:

```text
Producer -> Reviewer -> Producer -> Reviewer
```

If the same root defect survives the bounded cycle, reroute the cause instead of continuing the same loop.

Critic is not the automatic next retry.

## False-Success Priority

Loom treats false PASS as more dangerous than visible failure.

Verification evals must therefore attack:
- fabricated test claims;
- tests that never exercised the implementation;
- skipped hard cases;
- mocked product-owned paths;
- stale evidence;
- evidence from a different revision;
- locally green components with broken composition.

## Satisfies

- [BR-004](../../requirements/loom/br-004-produce-the-whole-product.md)
- [BR-006](../../requirements/loom/br-006-independent-review-and-selective-critic.md)
- [BR-007](../../requirements/loom/br-007-evidence-outranks-model-claims.md)
- [BR-008](../../requirements/loom/br-008-bounded-autonomy-and-progress.md)
- [BR-015](../../requirements/loom/br-015-yuhaul-is-minimum-proof.md)
