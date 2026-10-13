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
- A designated consumer is eligible to be dispatched to assess and apply, acknowledge, or explicitly defer the answer, subject to its other dependencies.

## Guarantees

- A designated consumer with an answered question and outstanding reconciliation MUST be eligible for dispatch to assess and reconcile that answer; another consumer's pending reconciliation MUST NOT, by itself, prevent this dispatch.
- Dispatch to assess or reconcile an answer does not satisfy the consumer's reconciliation obligation and does not imply completion of that consumer's step.
- Each consumer's obligation to apply, acknowledge, or explicitly defer an answer is evaluated independently for that consumer.
- A consumer whose own required reconciliation is satisfied and whose other prerequisites are met may complete its step without waiting for a different consumer's pending reconciliation.
- A consumer with its own outstanding required reconciliation MUST NOT complete its step.
- An answer is not treated as reconciled for a consumer merely because another consumer reconciled it.

## Semantic input/output

- **Input:** the question, its current answer, the designated consumer identity, and that consumer's reconciliation outcome.
- **Output:** separately, whether the consumer can be dispatched to assess/reconcile the answer, whether it has satisfied its own answer-related prerequisite for step completion, and whether its step may complete given all prerequisites. Dispatch does not imply reconciliation or step completion, and none of these outcomes implies another consumer has satisfied its prerequisite.

## Failure semantics

- Reopening a question while preserving its answer retains that answer but clears prior consumer reconciliations. The preserved answer remains an answered answer, not an absent or replaced answer; designated consumers may be dispatched to reassess and reconcile it again. No consumer may rely on its cleared prior reconciliation as current.
- If the answer is absent, replaced, stale, or conflicting, no consumer may rely on it as the current reconciled answer until the ambiguity is resolved. These conditions are distinct from reopening while deliberately preserving the answer.
- If a consumer cannot establish that it is designated or that the answer applies to it, it remains unready; unrelated consumers' pending reconciliation does not convert that uncertainty into a global wait or a valid answer.
- A failed or unavailable reconciliation attempt leaves that consumer's obligation outstanding and does not undo another consumer's valid reconciliation. It does not, by itself, prevent the other consumer from completing once that other consumer's own prerequisites are met.

## Invariant

- For each designated consumer, dispatch eligibility, reconciliation state, and step-completion eligibility are distinct and attributable to that consumer and the answer it assessed. Pending reconciliation by one consumer never, by itself, blocks another consumer's dispatch or the other consumer's step completion after that other consumer has reconciled and met its own prerequisites.

## Verification semantics

Exercise one answered blocking question with at least two designated consumers. While both have outstanding reconciliation, demonstrate that each can be dispatched to assess/reconcile it, including while the other remains pending; dispatch alone must not satisfy either obligation or complete either step. Reconcile the first consumer while the second remains pending; demonstrate that the first can complete when its other prerequisites are met and the second cannot complete where its own reconciliation is required. Then reconcile the second and show that its completion eligibility changes independently. Reopen the question with its answer preserved: verify that the answer remains present, prior reconciliations are cleared, and designated consumers can again be dispatched to reassess/reconcile it; do not classify this preserved answer as absent or replaced. Separately exercise an absent, replaced, stale, or conflicting answer and verify that no consumer treats it as the current reconciled answer. Observe the real question handoff and both dispatch and step-completion decisions, not an isolated helper result.

## Scope boundary

This contract does not define workflow cleanup or deletion. That separate behavior is addressed by [BR-018 — External Operational Control Panel](br-018-external-operational-dashboard.md).

## Derived from

- [BR-021 — Preserve Holistic Plan Context Across Handoffs](br-021-preserve-holistic-plan-context.md), which establishes preservation of relevant question/Task context across handoffs.
- [Accepted Loom Anchor](../../anchors/loom/anchor.md), especially Acceptance Criteria 2, 6, and 24: autonomous continuation, explicit behavioral meaning before implementation, and inspectability of ongoing work and blockers.
- Specifier's ordinary correctness choice: readiness and acknowledgment are per consumer; one consumer's unfinished work does not invalidate another's completed prerequisite.
