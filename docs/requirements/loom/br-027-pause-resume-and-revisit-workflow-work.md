---
type: requirement
title: BR-027 — Pause, Resume, and Revisit Workflow Work
description: Deliberate backburnering, safe pause/resume around interruptions and unrelated requests, and provenance-preserving backtracking.
tags: [requirement, loom, workflow, recovery, interruption]
---

# BR-027 — Pause, Resume, and Revisit Workflow Work

**Status:** proposed

## Statement

Loom MUST allow active work to be deliberately backburnered, paused for intermittent issues, or yielded while the user pursues an unrelated request. Before unrelated user work proceeds, Loom MUST confirm that the specific original workflow has reached its pause boundary. The unrelated request can then proceed while the original work's context is safely retained. A workflow MUST NOT be represented as paused-and-quiescent while operations from it remain in flight. When new evidence or correction requires backtracking, Loom MUST revisit affected work without losing prior status, provenance, or unaffected completed work.

## Acceptance Criteria

1. A user can deliberately place active work on the backburner when no failure or unrelated request requires pausing; the work remains resumable with its status, rationale, dependencies, and provenance inspectable.
2. Work can be paused for an intermittent issue without being misreported as completed, failed, or cancelled; its reason and progress remain inspectable.
3. When a user makes an unrelated request while work is active, Loom can yield the original work and proceed with the unrelated request only after confirming the specific original workflow has reached its pause boundary; retaining context or a general/session-level pause signal alone does not satisfy this condition. The unrelated request is not treated as a change to or completion of the original work.
4. A pause request does not prove that in-flight operations have stopped. The confirmed pause boundary means the original workflow will initiate no further work until resumed; it does not imply that previously admitted external operations are quiescent. In-flight uncertainty MUST remain explicitly marked, with relevant evidence, in any workflow state until resolved. Loom MUST NOT label work simply “paused” in a way that falsely implies quiescence.
5. A paused workflow can resume after the user chooses to resume or its pause condition is resolved. Before dependent work continues, Loom preserves prior status/provenance, checks the outcome of interrupted operations, and reevaluates changed evidence/dependencies without duplicating an operation whose outcome remains uncertain.
6. When new evidence or correction invalidates prior work, Loom can backtrack to the affected work and reconsider dependent conclusions; the history/status/provenance of superseded work remains inspectable, and unaffected completed work remains preserved and attributable.
7. Backburnering, pausing, resuming, or backtracking is not by itself workflow/product completion, cancellation, scope expansion, or new implementation authority.

## Verification Semantics

Exercise deliberate backburnering without an error, an intermittent issue, an unrelated work request during active execution, an in-flight operation when pause is requested, resumption after a resolved pause, and correction/backtracking. Verify the exact original workflow reaches a confirmed pause boundary before unrelated user work proceeds; a general/session-level pause or retained context alone is insufficient. Verify that the pause boundary prevents that workflow from initiating additional work but does not claim previously admitted operations stopped; uncertainty and evidence remain visible in every lifecycle state until resolved. Verify operation outcomes are reconciled before dependent work resumes and no duplicate execution follows an uncertain outcome. After resume/backtracking, verify changed dependencies are reevaluated, superseded work remains attributable, unaffected completed work is preserved, and none of these transitions falsely claims completion or grants scope/authority.

## Derived from

- User-confirmed workflow behavior in the authority-reconstruction workflow follow-up request (2026-09-28; no separate OQ ID supplied): deliberate backburnering; pausing for intermittent issues; yielding active work so an unrelated request can proceed; backtracking; and truthful pause/resume boundaries that do not imply in-flight operations are quiescent, while preserving active-work context and provenance.
- The user's answer to blocking OQ `b3232418-978f-4209-bdbe-68f3c26814a1` confirms that cancellation does not establish quiescence of previously admitted operations; BR-027 applies the same truthful-state constraint to pause/yield and does not treat a pause request as proof that operations stopped.
- User follow-up decisions (2026-09-28; no separate OQ ID supplied): uncertainty markers apply across workflow states, and the specific original workflow must be confirmed paused before unrelated user work proceeds.
- Accepted Loom Anchor, especially AC 2, 12–14, and 24 (autonomy to real boundaries, evidence-led recovery, bounded progress, and truthful inspection).
