---
type: requirement
title: BR-007 — Evidence Outranks Model Claims
description: Success claims require observed evidence and cannot be established by model confidence or fake verification.
tags: [requirement, loom, evidence, testing, trust]
---
**Status:** proposed

## Statement

Claims about builds, tests, runtime behavior, integrations, security checks, or Product Acceptance MUST be backed by observed evidence.

A model statement such as "tests pass" is not evidence by itself.

Mocks, stubs, skipped paths, hand-injected state, or fabricated inputs MUST NOT be presented as proof of real product-owned behavior when they bypass the behavior being claimed.

## Acceptance Criteria

1. Build/test/runtime success claims cite or reference observed execution evidence.
2. Missing evidence produces an explicit unproven state, never PASS.
3. Product Acceptance uses real product-owned components for the behavior under test.
4. Mocks/fakes are allowed only where they do not replace the product-owned behavior being claimed.
5. Evidence retains enough provenance to identify what ran and against which product state.

## Verification Semantics

Seed a review with one genuine passing test, one model-only claim, and one fake test that bypasses the product-owned path.

Only the genuine observed evidence may support PASS.

Generated prose, copied command text without execution, skipped tests, or hand-injected pipeline state are invalid proof.

## Derived from

- [Loom Anchor](../../anchors/loom/anchor.md)
