---
type: obligation-contract
title: OC-001 — Tuple-Scoped Consistent Applicability
description: Preservation, attachment, dispatch and completion agree on reuse without confusing execution with approval.
tags: [loom, reliability, applicability, evidence]
---

# OC-001 — Tuple-scoped consistent applicability

**Participants:**
- Result/proof preservers; consumer attachment, admission/dispatch and completion owners; contract and independent-review assessors.

**Preconditions:**
- A result, intended consumer contract, relevant input versions and available original proof are identifiable.

**Guarantees:**
- For the same tuple of result identity, consumer contract meaning and relevant input versions (including dependency outputs, consumed artifacts, applicable authority, proof and review state), preservation-as-applicable, attachment, dispatch and completion use the same applicability verdict/reasons. Historical retention alone makes no applicability claim.
- Relevant inputs can change fulfillment or required assurance of that consumer obligation. Cosmetic labels/grouping or unrelated commits do not alone invalidate work. Changed consumed/shared-file bytes may: determine actual relevance and provenance, not universal whole-HEAD invalidation.
- Relevance is explicit/inspectable from accepted obligations and recorded consumed inputs. No automatic understanding of arbitrary semantic prose is assumed; uncertain relevance remains unproven for affected use until its authorized owner resolves it.
- Stronger consumer proof demand is a changed contract/assurance input, not reinterpretation of an identical tuple. Denial names missing/changed dimensions and affected scope. Review can be required while original producer execution remains reusable.
- Invalidation propagates only to affected dependent uses. Original consumed context/result identity is never rewritten to match the new Plan.

**Semantic input/output:**
- Input: original result/proof, consumer obligation and relevant versions/assurance conditions.
- Output: applicable, inapplicable or unproven for that use, with reasons; execution occurred, current fulfillment and review remain separately inspectable.

**Failure semantics:**
- Missing observation, conflicting ownership or unknown relevant version makes affected use unproven, not successful; retained history stays available.
- A changed tuple after admission must be checked before completion. Stale attachment/delayed events cannot complete new meaning. Denial preserves unaffected work and exposes resolution under BR-001.

**Invariant:**
- Same tuple, same applicability meaning at every boundary; changed verdict requires identified changed input or attributable correction.

**Verification semantics:**
Compare all four boundaries for unchanged inputs, unrelated commits, changed consumed bytes, split downstream Tasks, stronger proof and reopened review. Inject change after attachment. Observe unchanged originals and narrow affected uses. Contradictory same-tuple verdicts or irrelevant blanket reruns fail.

**Derived from:**
- [Accepted Anchor](../../../anchors/loom-reliability/anchor.md), consistent applicability and distinct historical execution/review.
- Specifier choice: explicit assurance/relevance and unproven outcomes; no fingerprint/schema/prose-automation choice.
