---
type: requirement
title: BR-004 — Produce the Whole Product
description: Completion is measured at the usable product level, not at isolated component completion.
tags: [requirement, loom, product, completion]
---
**Status:** proposed

## Statement

Loom MUST treat the accepted product outcome as the unit of completion.

Where applicable, completion includes application code, usable user interface, persistence and data model, authentication and authorization, external integrations, configuration, failure and recovery behavior, operational visibility, deployment/runtime needs, and user-facing documentation.

A locally complete component is not product completion.

## Acceptance Criteria

1. Completion is evaluated against the accepted Anchor, not only individual tasks.
2. All product-owned components required by the accepted outcome exist and are integrated.
3. Required UI, persistence, authentication, integrations, operations, and documentation are included when applicable.
4. End-to-end behavior crosses the real product-owned composition.
5. Missing mandatory product surfaces prevent completion.

## Verification Semantics

Use Product Acceptance scenarios rooted in Anchor outcomes and exercise the assembled product through realistic entry points.

Unit tests, isolated component tests, mocked product-owned dependencies, or a list of completed tasks cannot by themselves prove this requirement.

## Derived from

- [Loom Anchor](../../anchors/loom/anchor.md)

## Depends on

- [BR-006 — Independent Verification Is Normal; Holistic Attack Is Selective](br-006-independent-review-and-selective-critic.md)
- [BR-007 — Evidence Outranks Model Claims](br-007-evidence-outranks-model-claims.md)
