---
type: obligation-contract
title: OC-002 — Existing Answers Are Information, Not New Decisions
description: Stable direct retrieval is independent of notifications and per-consumer treatment.
tags: [loom, questions, continuity, authority]
---

# OC-002 — Existing answers are information, not new decisions

**Participants:**
- Answer record owners/readers, notification transport, answer consumers and consumer admission/completion owners.

**Preconditions:**
- An answer/evidence is recorded and the reader is authorized for the information/use.

**Guarantees:**
- Stable references retrieve original question, answer, author/provenance, revision/context and evidence references after restart or missed notification. No new OQ, transport-only specialist dispatch or notification acknowledgement is required for access.
- Delivery, reading and treatment are distinct. Each consumer records incorporation, unaffectedness or explicitly authorized deferral of material answers for its obligations; another consumer's treatment cannot satisfy it.
- Dispatch to assess an answer is allowed subject to other prerequisites while its treatment is pending. Another consumer's pending treatment alone cannot block dispatch or completion of an otherwise-ready reconciled consumer.
- Changed question/answer/consumer meaning requires affected reassessment; unchanged applicable treatment is not invalidated merely by redelivery/notification failure. Deferral cannot waive required user decisions without authority.

**Semantic input/output:**
- Input: stable answer/evidence reference, authorized reader and consumer contract.
- Output: original attributable information, separately consumer treatment.

**Failure semantics:**
- Missing evidence or stale/ambiguous answer remains visibly unresolved. Transport cannot fabricate it. Duplicate/lost notifications neither erase answers nor cause duplicate admissions. New decisions remain distinct from retrieving old ones.

**Invariant:**
- Information delivery does not create authority, fulfillment or gate approval.

**Verification semantics:**
Suppress/duplicate notifications around persistence/restart. Two consumers read original answer/evidence without new questions; one completes while the other remains unreconciled. Replace an answer and show affected reassessment without relabeling the original.

**Derived from:**
- [Accepted Anchor](../../../anchors/loom-reliability/anchor.md), direct authorized information access and consumer treatment independent of transport.
