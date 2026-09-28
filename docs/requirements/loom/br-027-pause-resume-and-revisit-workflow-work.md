---
type: requirement
title: BR-027 — Pause, Resume, and Revisit Workflow Work
description: Pause and resume work around interruptions and unrelated requests, with provenance-preserving backtracking.
tags: [requirement, loom, workflow, recovery, interruption]
---

# BR-027 — Pause, Resume, and Revisit Workflow Work

**Status:** proposed

## Statement

Loom MUST allow active work to pause for intermittent issues and to yield while the user pursues an unrelated request. The unrelated request can proceed while the original work remains paused and later resumable. When new evidence or correction requires backtracking, Loom MUST revisit affected work without losing prior status, provenance, or unaffected completed work.

## Acceptance Criteria

1. A workflow can pause for an intermittent issue without being misreported as completed, failed, or cancelled; its reason and progress remain inspectable.
2. When a user makes an unrelated request while work is active, Loom can pause the active work and proceed with the unrelated request without treating it as a change to or completion of the paused work.
3. A paused workflow can resume after the issue or unrelated request is resolved; its prior status and provenance are preserved, and changed evidence/dependencies are re-evaluated before dependent work continues.
4. When new evidence or correction invalidates prior work, Loom can backtrack to the affected work and reconsider dependent conclusions; unaffected completed work remains preserved and attributable.
5. Pause, resume, or backtracking is not by itself workflow/product completion, cancellation, scope expansion, or new implementation authority.

## Verification Semantics

Exercise an intermittent issue, a user-requested unrelated task during active work, and a correction requiring backtracking. For each, observe explicit paused/resumed state and reason, independent progress on the unrelated request, preserved prior status/provenance, re-evaluation of changed dependencies, and preservation of unaffected completed work. Verify these transitions neither claim completion nor grant new scope/authority.

## Derived from

- User-confirmed workflow behavior: pausing for intermittent issues, pausing active work for an unrelated user request while allowing the unrelated request to proceed, and addressing backtracking while preserving status/provenance.
- Accepted Loom Anchor, especially AC 2, 12–14, and 24 (autonomy to real boundaries, evidence-led recovery, bounded progress, and truthful inspection).
