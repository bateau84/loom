---
type: obligation-contract
title: OC-001 — Review Repair Ownership and Independent Approval
description: Shared guarantees for bounded Reviewer repairs, authorship-aware independent review, evidence continuity, and completion.
tags: [requirement, loom, review, repair, independence, evidence]
---
**Status:** proposed

# OC-001 — Review Repair Ownership and Independent Approval

## Participants

- **Coordinator:** assigns the current review mode and routes correction work.
- **Reviewer session:** reviews, and only when explicitly authorized may author a bounded implementation repair.
- **Producing role:** may correct findings under its existing professional authority.
- **Loom runtime:** enforces assignment, session/authorship eligibility, mutation scope, and completion semantics.

## Preconditions

- A governed implementation-review gate exists for an established intended outcome.
- The finding is concrete enough to distinguish correction from unresolved product, behavioral, design, architecture, or planning authority.
- Existing mandatory gate authority remains in force unless a separate accepted requirement explicitly says otherwise.

## Guarantees

1. The active Reviewer assignment is explicitly distinguishable as **review-only**, **repair-authorized**, or **independent re-review**.
2. Review-only is non-authoring for reviewed implementation. Reports and acceptance bookkeeping do not imply implementation-repair authority.
3. Repair-authorized mutation is limited to the current gate/attempt and remains subject to Loom's normal exact-session attachment, write-scope elevation, command, Git ownership, and commit guards.
4. A repair records the finding, change summary, verification summary/evidence, authoring Reviewer session, and resulting repository revision.
5. Same-session checking of Reviewer-authored bytes is **self-verification**. It preserves evidence but cannot satisfy a mandatory independent gate.
6. Independent re-review excludes every Reviewer session recorded as an author of the repair being approved. Missing or ambiguous authorship evidence is not proof of eligibility.
7. A non-authoring Reviewer session may be preferred for later re-check after a producing role repairs its findings. Continuing the same eligible session preserves context without changing the independence classification.
8. When a prior non-authoring Reviewer finds another problem in a Reviewer-authored repair, the original repairing Reviewer or a producing role may correct it; the non-authoring Reviewer remains eligible to resume if it did not author the new correction.
9. Final review evidence identifies the actual repository revision checked and the coverage/evidence supporting the verdict. A changed revision requires affected verification and review to be refreshed.
10. Existing valid evidence may be retained only when its covered behavior/state remains unchanged; no receipt silently narrows a whole-outcome review obligation.
11. A mandatory independent gate remains incomplete when no eligible reviewer can be established. Loom exposes the missing approval rather than declaring completion or cycling through equivalent ineligible contexts.
12. Reviewer repair conveys no publication, merge, requirement-waiver, or Critic authority.

## Semantic Input / Output

**Input**

- workflow/gate identity and attempt;
- assignment mode;
- finding and accepted intended outcome;
- authoring and prior-review session identity;
- bounded mutation/elevation history;
- verification/evidence attached to the current attempt.

**Output**

- repair receipt classified as self-verified, or review receipt classified as independent;
- exact repository revision associated with that receipt;
- explicit next-review eligibility/continuity state;
- a completed gate only when its required assurance has actually been obtained.

## Failure Semantics

- Out-of-scope repair is denied through the existing scope-authorization path.
- A repair that requires unresolved semantic/structural authority returns to the owning role.
- An ineligible repairing session cannot attach as the independent re-reviewer.
- Ambiguous reviewer authorship keeps independent approval pending.
- Failure to resume a preferred non-authoring reviewer may fall back to a fresh eligible Reviewer, but never to a known authoring session.
- Unavailable independent review preserves repair evidence and leaves the gate pending.

## Invariants

- **Authorship survives relabeling and redispatch.**
- **Self-verification is never represented as independent approval.**
- **Only explicit repair assignments expand Reviewer mutation authority.**
- **Accepted requirements/design/architecture meaning cannot be rewritten under implementation-repair authority.**
- **Gate completion evidence refers to the state actually reviewed.**

## Verification Semantics

Exercise the runtime boundary, not prompt wording alone:

- review-only Reviewer edit attempts are denied;
- explicit repair assignment can elevate bounded project-local scope and commit owned bytes;
- repair completion records self-verification and advances to independent re-review without passing the gate;
- the repairing session is rejected for that independent attempt;
- an eligible fresh Reviewer can attach and pass;
- after Worker repair, the prior non-authoring Reviewer is surfaced as the preferred resumable session;
- final receipts expose the checked repository revision and assurance classification.

## Derived from

- [BR-006 — Independent Verification Is Normal; Holistic Attack Is Selective](../br-006-independent-review-and-selective-critic.md)
- GitHub issue #117 feature handoff (proposal reconciled here; issue text itself is not durable authority)
