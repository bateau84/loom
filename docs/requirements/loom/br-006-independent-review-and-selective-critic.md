---
type: requirement
title: BR-006 — Independent Verification Is Normal; Holistic Attack Is Selective
description: Normal work gets independent review while expensive holistic adversarial review is reserved for system-level boundaries and exceptional failures.
tags: [requirement, loom, review, critic, verification]
---
**Status:** proposed

## Statement

Normal work MUST receive independent review against its accepted inputs, boundaries, and required evidence.

Holistic adversarial review MUST be used for the assembled proposed solution before major implementation, the final realized product before acceptance, and serious cross-domain disagreement or repeated failure that local review cannot resolve.

Where practical, holistic adversarial review MUST use a different model and fresh context from the producer, with independent directives or assessment criteria.

Holistic review MUST NOT reopen accepted decisions merely because another approach can be imagined; reopening requires new material evidence, contradiction, failed proof, or changed authority.

## Acceptance Criteria

1. Producer work receives an independent Reviewer pass before it is treated as accepted input downstream.
2. Critic is not used as the routine first reviewer for ordinary artifacts.
3. The proposed whole solution receives one holistic adversarial review before major implementation.
4. The realized product receives one holistic adversarial review before final acceptance.
5. Exceptional Critic invocation records the evidence that justified escalation.
6. Accepted decisions remain closed unless material new evidence, contradiction, failed proof, or changed authority exists.

## Verification Semantics

Inspect workflow traces across normal and exceptional runs.

Valid proof shows frequent Reviewer use, sparse Critic use, fresh/different Critic context where practical, and explicit evidence for reopening decisions.

Repeated Critic invocation with no new evidence, or self-review by the same producing context presented as independent review, fails this requirement.

## Derived from

- [Loom Anchor](../../anchors/loom/anchor.md)

## Depends on

- [BR-007 — Evidence Outranks Model Claims](br-007-evidence-outranks-model-claims.md)
