---
type: design
title: SC-007 — Backburner work, resume it, and revise an earlier decision
description: Intentional deferral/resumption and safe recovery after a backtrack.
tags: [scenario, loom, recovery, lifecycle]
---

# SC-007 — Backburner work, resume it, and revise an earlier decision

**Context:** A product owner has an in-progress product change, then discovers that another priority is more urgent. Later, new information makes an earlier accepted direction unsuitable. Assumption: the person expects to return to work without rebuilding its context; this has not been validated through user research.

**Goal:** Defer and resume work intentionally, and safely revisit prior direction while preserving trustworthy progress.

**Scenario:** The person sets the current work aside and starts or discusses a different priority. The first work is visibly not running, its last known outcome and next boundary remain understandable, and resuming later returns to its relevant intent, Plan, evidence, and completed work. When the person backtracks to an earlier decision, Loom identifies which later results depend on that decision, distinguishes still-valid work from stale work, and explains the safe next step instead of silently presenting invalidated work as current.

**Failure / edge condition:** The person returns after a long pause and cannot tell whether work kept running, completed, or was merely hidden; or a revised direction leaves downstream work apparently green. Do not imply that pausing rolls back changes, that resume guarantees execution, or that all previous work remains valid. Show uncertainty and preserve recoverable work/evidence rather than duplicate or destructive action.

**Observable outcome:** The person can tell whether work is paused, resumed, or otherwise terminal; can re-enter with enough context to decide what happens next; and can distinguish preserved evidence/completed work from downstream work that needs reconsideration.

**Derived from:** `US-003`, `US-005`; Anchor Acceptance Criteria 13, 25; candidate lifecycle journey identified in authority reconstruction. Current dashboard refresh pause is display-only (`dashboard-refresh.md`) and is not workflow pause/resume capability. This scenario is design-gap analysis, not a claim that the requested capability exists.
