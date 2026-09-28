---
type: obligation-contract
title: OC-001 — Independent Question-Consumer Reconciliation
description: Shared semantic contract for answering and reconciling a question with multiple affected consumers.
tags: [obligation-contract, loom, questions, reconciliation, handoff]
---

**Status:** proposed

## Participants

- The party that asks and records a shared question and its answer.
- Each workflow step or role designated to consume that answer.
- The party that determines whether a consumer may proceed.

## Preconditions

- A question has an answer and one or more designated consumers.
- A consumer is otherwise eligible to proceed, subject to applying or acknowledging the answer and its own dependencies.

## Guarantees

- Each consumer's obligation to apply, acknowledge, or explicitly defer an answer is evaluated independently for that consumer.
- A consumer whose own reconciliation obligation is satisfied and whose other prerequisites are met may proceed without waiting for a different consumer's pending reconciliation.
- A consumer with its own outstanding reconciliation obligation remains blocked from proceeding when that obligation is required.
- An answer is not treated as reconciled for a consumer merely because another consumer reconciled it.

## Semantic input/output

- **Input:** the question, its current answer, the designated consumer identity, and that consumer's reconciliation outcome.
- **Output:** whether that consumer has satisfied its answer-related prerequisite to proceed; this outcome does not imply that other consumers have satisfied theirs.

## Failure semantics

- If the answer is absent, reopened, stale, or conflicting, no consumer may rely on it as a current reconciled answer until the ambiguity is resolved.
- If a consumer cannot establish that it is designated or that the answer applies to it, it remains unready; unrelated consumers' pending reconciliation does not convert that uncertainty into a global wait or a valid answer.
- A failed or unavailable reconciliation attempt leaves that consumer's obligation outstanding and does not undo another consumer's valid reconciliation.

## Invariant

- Pending reconciliation by one consumer never, by itself, blocks another otherwise-ready consumer; reconciliation state and provenance remain attributable to the specific consumer and the answer it consumed.

## Verification semantics

Exercise one answered blocking question with at least two designated consumers. Reconcile the first consumer while the second remains pending; demonstrate that the first can proceed when its other prerequisites are met and the second cannot proceed where reconciliation is required. Then reconcile the second and show that its status changes independently. Repeat with an absent, reopened, or conflicting answer and verify that no consumer treats it as current. Observe the real question handoff and consumer readiness decision, not an isolated helper result.

## Derived from

- [BR-021 — Preserve Holistic Plan Context Across Handoffs](br-021-preserve-holistic-plan-context.md), which establishes preservation of relevant question/Task context across handoffs.
- Specifier's ordinary correctness choice: readiness and acknowledgment are per consumer; one consumer's unfinished work does not invalidate another's completed prerequisite.
