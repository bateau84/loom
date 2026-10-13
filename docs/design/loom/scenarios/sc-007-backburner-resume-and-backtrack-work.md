---
type: design
title: SC-007 — Backburner work, resume it, and revise an earlier decision
description: Intentional deferral/resumption and safe recovery after a backtrack.
tags: [scenario, loom, recovery, lifecycle]
---

# SC-007 — Backburner work, resume it, and revise an earlier decision

**Context:** A product owner has an in-progress product change, then discovers that another priority is more urgent. Later, new information makes an earlier accepted direction unsuitable. Assumption: the person expects to return to work without rebuilding its context; this has not been validated through user research.

**Goal:** Defer and resume work intentionally, and safely revisit prior direction while preserving trustworthy progress.

**Scenario:** As a distinct lifecycle journey, the person explicitly asks to backburner this particular workflow. Loom communicates whether that workflow is confirmed paused; it does not equate hiding/archiving a record, pausing dashboard refresh, or an uncertain host interruption with workflow pause. Once paused, the person's last known outcome and next boundary remain understandable, and the person can request resumption later with relevant intent, Plan, evidence, and completed work available. Any admitted operation whose completion/quiescence is uncertain is disclosed with relevant evidence regardless of whether the workflow is active, paused, blocked, terminal, or archived. When the person backtracks to an earlier decision, Loom explains which later results may depend on it, distinguishes what is still confirmed from what needs reconsideration, and identifies the safe next step instead of silently presenting potentially stale work as current.

**Failure / edge condition:** The person returns after a long pause and cannot tell whether this workflow kept running, completed, was confirmed paused, or was merely hidden; an admitted operation may remain in flight even if the workflow is not active; or a revised direction leaves downstream work apparently green. Do not imply that pausing rolls back changes, that resume guarantees execution, that backburner pauses unrelated workflows, that lifecycle status proves host-operation quiescence, or that all previous work remains valid. Show uncertainty and preserve recoverable work/evidence rather than duplicate or destructive action.

**Observable outcome:** The person can tell whether the specifically selected workflow is confirmed paused, resumed, or otherwise terminal; can re-enter with enough context to decide what happens next; and can distinguish preserved evidence/completed work from downstream work that needs reconsideration. Any uncertainty about admitted operations remains visible independent of workflow state. No global pause or automatic interruption behavior is implied.

**Derived from:** `US-003`, `US-005`; Anchor Acceptance Criteria 13, 25; candidate lifecycle journey identified in authority reconstruction. Current dashboard refresh pause is display-only (`dashboard-refresh.md`) and is not workflow pause/resume capability. This scenario is design-gap analysis, not a claim that the requested capability exists.
