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

## Derived from

- [Loom Anchor](../../anchors/loom/anchor.md)
