---
type: requirement
title: BR-006 — Independent Verification Is Normal; Holistic Attack Is Selective
description: Normal work gets independent review while expensive holistic adversarial review is reserved for system-level boundaries and exceptional failures.
tags: [requirement, loom, review, critic, verification]
---
**Status:** proposed

## Statement

Normal work MUST receive independent review against its accepted inputs, boundaries, and required evidence.

When an independent Reviewer PASS is the acceptance gate for a durable requirements, design, or architecture artifact, that Reviewer MUST own the resulting repository-defined acceptance-state transition and any matching acceptance-history entry. The producing Designer, Specifier, or Architect MUST NOT be redispatched solely to perform that bookkeeping.

Reviewer acceptance bookkeeping MUST be limited to lifecycle status / acceptance metadata and the repository's corresponding acceptance, change, or decision log. Any substantive artifact correction remains producer-owned and requires fresh independent review before acceptance.

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
7. A PASS that accepts a durable requirements, design, or architecture artifact leaves its repository-defined status/history in the accepted state through Reviewer-owned bookkeeping, without a bookkeeping-only producer redispatch.
8. A failed review does not mark the artifact accepted or write an acceptance entry; substantive findings return to the owning authority for correction and fresh review.

## Verification Semantics

Inspect workflow traces across normal and exceptional runs.

Valid proof shows frequent Reviewer use, sparse Critic use, fresh/different Critic context where practical, and explicit evidence for reopening decisions.

Repeated Critic invocation with no new evidence, self-review by the same producing context presented as independent review, a PASS that leaves required acceptance bookkeeping for a producer-only redispatch, or a failed review that marks an artifact accepted fails this requirement.

## Derived from

- [Loom Anchor](../../anchors/loom/anchor.md)

## Depends on

- [BR-007 — Evidence Outranks Model Claims](br-007-evidence-outranks-model-claims.md)
