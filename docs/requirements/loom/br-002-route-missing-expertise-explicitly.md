---
type: requirement
title: BR-002 — Route Missing Expertise Explicitly
description: Required expertise must be routed explicitly and cannot be skipped because a coordinator forgets it exists.
tags: [requirement, loom, routing, authority]
---
**Status:** proposed

## Statement

When work requires human-experience, behavioral, structural, implementation, research, verification, or holistic-adversarial expertise, Loom MUST route the work to a capable independent context rather than letting an unrelated context silently make that decision.

Routing MUST be explicit enough that required expertise cannot be skipped merely because the coordinating model forgets that it exists.

## Acceptance Criteria

1. Human-facing semantic work invokes Designer capability when needed.
2. Behavioral or guarantee changes invoke Specifier capability when needed.
3. Structural/interface/lifecycle decisions invoke Architect capability when needed.
4. Normal conformance checking invokes Reviewer capability independently of the producer.
5. Holistic adversarial review invokes Critic only at defined system-level boundaries or exceptional escalation.
6. A coordinator cannot bypass required expertise solely by deciding to proceed directly.
7. Any Loom role may raise an OQ to any other Loom role when that role can answer the specific missing question; General may raise coordinator OQs directly.
8. Answering an OQ does not promote the responder into another authority role and does not substitute for a required independent Reviewer/Critic/Product Acceptance gate.

## Verification Semantics

Use routing tests that present tasks requiring each authority class and mixed combinations.

Valid proof shows the required specialist context was actually invoked before dependent work proceeded.

A routing table that exists only in prose, or a successful result where the required authority was skipped, is insufficient.

## Derived from

- [Loom Anchor](../../anchors/loom/anchor.md)
