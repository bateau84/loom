# Loom Product-Authority Reconstruction

**Status:** accepted

## Goal

Reconcile Loom's accepted product meaning with its actual user-facing capabilities, journeys, flows, and important couplings. Produce a coherent and traceable authority set—an accurate Loom Anchor and first principles, behavioral requirements and obligations, user stories, and scenarios—so implementation is governed by explicit user value and intended behavior rather than silently becoming product authority.

## Acceptance Criteria

1. The current product surface is inventoried from repository evidence, including conversation, the external dashboard, workflow and plan controls, and recovery paths. User-visible surfaces are candidates for scope review, not assumed in scope merely because they exist.
2. End-to-end user journeys, consequential state transitions, dependencies, and cross-component couplings are mapped with sources. Observed implementation, current documentation, and accepted product intent are distinguished.
3. Available bug and regression evidence is traced to affected journeys and existing authority. It is used to identify candidate missing or ambiguous expectations, edge cases, and recovery behavior; a bug or fix does not by itself establish a product requirement.
4. The intended product value and scope of each candidate user-facing surface are explicitly classified. Where repository evidence and professional analysis cannot resolve a subjective product choice, it remains visible for user decision rather than being inferred.
5. First principles state the product-level invariants that explain why Loom behaves as it does and guide consistent decisions across surfaces.
6. Behavioral requirements and cross-party obligations are implementation-independent, testable, traceable to accepted intent, and have clear verification paths.
7. Durable user stories and end-to-end scenarios cover the accepted user journeys, including material interruption, failure, uncertainty, and recovery cases. They are not inferred solely from implementation or tests.
8. The Anchor, first principles, requirements, obligations, stories, scenarios, flows, and relevant system-map knowledge form a coherent navigable set. Contradictions, uncovered candidate capabilities, and authority-status ambiguity are resolved or explicitly left open.
9. An independent review assesses coverage, provenance, contradictions, unsupported claims, and whether the resulting authority actually bounds the discovered functionality before the revised Loom Anchor is accepted.

## Not This

- Implementing or repairing product code as part of authority reconstruction.
- Treating every observed feature, architecture component, bug fix, test, or evaluation as proof of desired product scope.
- Converting each bug into a new requirement without examining the underlying user expectation and existing authority.
- Broadly rewriting technical architecture where no unresolved structural decision has been established.
- Hiding unresolved user-owned scope, priority, or guarantee choices behind professional language.
- Treating a documentation cross-reference or graph edge as proof that behavior is implemented or accepted.

## Reserved Decisions

The user retains authority over the intended user value and material product-scope classification of candidate surfaces, subjective priorities not resolved by existing accepted intent, and explicit acceptance of the revised Loom Anchor. Loom resolves repository-answerable facts and professional realization questions without unnecessarily sending them to the user.

## Context

- The current accepted Loom Anchor remains `docs/anchors/loom/anchor.md` and remains authoritative unless and until the user explicitly accepts a replacement.
- Initial discovery found 22 Behavioral Requirements, no separate durable User Story or Design Scenario corpus in the OKF inventory, and weak explicit traceability from requirements to system components.
- Current documentation and implementation describe a wider, more detailed surface than the Anchor alone makes easy to trace. Some design and architecture documents have proposed status despite corresponding current-system descriptions; those statuses require evidence-based reconciliation.
- The user directed that every user-visible surface, including the dashboard and workflow/plan controls, be inventoried as a candidate for explicit user-value classification.
- The user identified recurring bugs as a source of concrete requirements and scenarios that may not have been solidified. Bug evidence must be traced and interpreted, not promoted to authority without confirmation.
- The first history pass found leads around budget continuation, multi-consumer question reconciliation, specialist change publication, and dashboard cleanup. Exact incident descriptions and patches were not available in that pass; these remain unverified leads.
