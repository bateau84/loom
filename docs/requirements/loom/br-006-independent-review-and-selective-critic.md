---
type: requirement
title: BR-006 — Independent Verification Is Normal; Holistic Attack Is Selective
description: Normal work gets independent review while bounded repair may be authorized without confusing self-verification with independent approval.
tags: [requirement, loom, review, critic, verification]
---
**Status:** proposed

## Statement

Normal work MUST receive independent review against its accepted inputs, boundaries, and required evidence unless accepted authority explicitly defines a narrower self-verified completion boundary. No such boundary may be inferred from patch size, finding severity, or agent confidence.

An implementation Reviewer MAY repair a concrete finding only when the current assignment explicitly authorizes repair, the intended outcome is already established, the correction is bounded, and a meaningful verification path exists. Review-only/advisory assignments do not carry that authority.

A Reviewer-authored repair MUST remain subject to normal scope, mutation, command, ownership, and evidence controls. The repairing session MAY self-verify its correction, but that evidence MUST be identified as self-verification and MUST NOT satisfy a mandatory independent-review gate.

When independent approval remains mandatory after a Reviewer-authored repair, a genuinely fresh non-authoring Reviewer context MUST assess the resulting artifact and affected behavior. Session identity and repair authorship are part of eligibility; relabeling, resuming, or forking the repairing context does not make it independent.

When a non-authoring Reviewer reports findings and a producing role corrects them, Loom SHOULD resume that same healthy Reviewer for re-check of the same bounded subject and gate. Fresh review is required when authorship, changed authority/scope, an explicit cold-review requirement, or unsafe resumability makes continuity ineligible.

When an independent Reviewer PASS is the acceptance gate for a durable requirements, design, or architecture artifact, that Reviewer MUST own the resulting repository-defined acceptance-state transition and any matching acceptance-history entry. The producing Designer, Specifier, or Architect MUST NOT be redispatched solely to perform that bookkeeping.

Reviewer acceptance bookkeeping MUST be limited to lifecycle status / acceptance metadata and the repository's corresponding acceptance, change, or decision log. Substantive requirements, design, or architecture corrections remain producer-owned and require independent review before acceptance.

Holistic adversarial review MUST be used for the assembled proposed solution before major implementation, the final realized product before acceptance, and serious cross-domain disagreement or repeated failure that local review cannot resolve.

Where practical, holistic adversarial review MUST use a different model and fresh context from the producer, with independent directives or assessment criteria.

Holistic review MUST NOT reopen accepted decisions merely because another approach can be imagined; reopening requires new material evidence, contradiction, failed proof, or changed authority.

## Acceptance Criteria

1. Producer work receives an independent Reviewer pass before it is treated as accepted input downstream unless accepted authority explicitly permits a self-verified completion boundary.
2. Review-only/advisory assignments cannot mutate reviewed implementation merely because a finding is easy to fix.
3. An explicitly repair-authorized implementation Reviewer can make a bounded correction under the same mutation/scope/evidence protections as other governed work.
4. Reviewer-authored repair evidence records the finding, resulting change, verification, authoring session, and actual reviewed artifact revision/state.
5. A repairing Reviewer cannot independently approve its own contribution; a mandatory independent gate remains pending until an eligible non-authoring Reviewer passes it.
6. A fresh independent re-review rejects a repairing session even if it is redispatched under a new assignment identifier.
7. Producer correction followed by re-check can resume the same healthy non-authoring Reviewer session; another cold Reviewer is not required merely because a new correction round occurred.
8. Re-review covers the repair and affected behavior while preserving prior evidence only where it remains applicable.
9. A stale review receipt for an earlier artifact state cannot approve later changed content.
10. Missing or ambiguous authorship/session evidence leaves required independent approval unresolved rather than producing a false PASS.
11. Critic is not used as the routine first reviewer or as a substitute for an unperformed mandatory independent implementation review.
12. A PASS that accepts a durable requirements, design, or architecture artifact leaves its repository-defined status/history in the accepted state through Reviewer-owned bookkeeping, without allowing the Reviewer to rewrite semantic content to make it pass.

## Verification Semantics

Inspect workflow traces and runtime state across review-only, producer-repair, Reviewer-repair, and independent re-review paths.

Valid proof shows assignment-specific mutation authority, session/authorship-aware dispatch and attachment, self-verification receipts that do not close mandatory independent gates, fresh non-authoring approval after Reviewer repairs, same-session Reviewer continuity after producer corrections when eligible, and review receipts tied to the actual artifact revision checked.

A review-only Reviewer mutating product files, a repairing session recording an independent PASS for its own change, reuse of an ineligible repairing session as the supposedly fresh reviewer, a stale PASS approving later changed content, or repeated equivalent ineligible dispatches fails this requirement.

## Derived from

- [Loom Anchor](../../anchors/loom/anchor.md)

## Depends on

- [BR-007 — Evidence Outranks Model Claims](br-007-evidence-outranks-model-claims.md)
- [OC-001 — Review Repair Ownership and Independent Approval](obligation-contracts/oc-001-review-repair-independence.md)
