---
name: solution-synthesis
description: Reconcile existing product, experience, behavior, and architecture contributions into a coherent end-to-end solution. Use for unresolved cross-domain composition; not a new master specification, universal meeting, or extra review gate.
---

# Solution Synthesis

The producing owners make a coherent solution. Independent review and adversarial QA test that solution; they are not its normal authors or assembly process.

## When useful

Use when an outcome crosses authority or component boundaries whose meanings or handoffs have not yet been reconciled. Skip it when existing accepted contracts already compose adequately. Multiple files, layers, or agents alone do not justify another step.

This method creates no role, decision authority, workflow state, approval, gate, or required artifact. Work through current ownership and normal handoffs; do not bypass bindings, independent review, or active execution limits.

## Method

1. **Start from the outcome and current sources.** Identify the accepted goal, relevant experience/behavior/architecture contributions, existing capabilities, and actual unknowns. Keep authority references distinct from implementation evidence and proposed changes.
2. **Walk the smallest useful journeys.** Follow a representative user/integration outcome across the affected boundaries, plus material failure or recovery paths. Work in terms of inputs, visible results, state changes, and responsibility, not merely matching document headings or API field names.
3. **Reconcile shared meaning.** Check the terms, identities, ownership, ordering, lifecycle states, success, failure, cancellation, and recovery that those journeys depend on. Each owner resolves its own domain and updates its authoritative artifact where needed. A coordinator's summary cannot settle a specialist disagreement or override an accepted commitment.
4. **Connect required capabilities and handoffs.** Distinguish capabilities shown to exist from assumptions and demonstrated gaps. Identify who supplies each missing contribution and what the receiving owner needs. Use `feature-handoff` for independently handled components or sessions when useful; a request to another owner is not proof the capability exists.
5. **Connect proof to the assembled outcome.** Name a credible product entry point and observable result for each load-bearing journey, with material integration/failure evidence needed. Carry expectations into existing verification and planning surfaces through the authorized owner. Detailed executable acceptance strategy remains with Acceptance; do not pre-claim its result or prescribe its implementation.
6. **Resolve only affected work.** Send a concrete contradiction or missing decision to its actual owner using existing routing/question paths. Preserve valid contributions and continue independent work. Reconcile affected consumers after a change; reference lists and old PASS labels do not make stale meaning current.

## Coordination, not central authorship

General coordinates convergence without selecting the specialists' design, contracts, or mechanisms. Designer retains human-facing experience, Specifier observable commitments, and Architect structural realization. User-owned changes follow the existing intent path. Planner decomposes the resulting accepted work; Reviewer independently assesses it; Critic attacks the whole where the current workflow requires that gate.

Use the existing conversation or permitted handoff/index for a short synthesis: the intended journey, current authoritative references, resolved boundary meanings, remaining owned gaps, and proof path. Do not create a second source of truth, require every specialist to attend, or add a gate. Persist actual decisions in their established owner artifacts, not only in this summary.

## Sufficient result

Downstream work can follow the intended outcome across the affected boundaries without inventing missing product, behavioral, or architectural decisions. Known load-bearing gaps remain explicitly incomplete; a coherent summary is not evidence that the product has been implemented or accepted.

Example: a UI says a job is cancelled, a behavioral contract promises no further writes, and an architecture only stops new dispatches. Reconcile in-flight effects and visible state with the owning specialists before dependent implementation. Do not choose weaker cancellation semantics in the synthesis merely because they are easier to implement.
