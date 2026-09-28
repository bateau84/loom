---
type: design
title: SC-005 — Resume while an answered question still needs downstream reconciliation
description: A delayed or multiple-consumer handoff after a user-owned answer is recorded.
tags: [scenario, loom, questions, handoff, recovery]
---

# SC-005 — Resume while an answered question still needs downstream reconciliation

**Context:** A product owner answers a question that blocks work across more than one handoff, then returns after a pause expecting work to have resumed. A historical regression establishes this as a useful failure case; the source does not establish its prevalence or make the defect itself product authority.

**Goal:** Understand whether the answer was received, what still needs to happen, and whether any further user action is actually needed.

**Scenario:** The person opens the same work/question context through conversation or read-only dashboard inspection. Their answer is shown as recorded, not as an unanswered prompt. The affected consumer(s) still needing to apply or acknowledge it are identified in human-readable terms. The person can distinguish Loom's remaining internal work from a genuine new user-owned decision. Later, when consumers reconcile the answer, the same question/work context reflects that transition without asking the user to answer again.

**Failure / edge condition:** One or more consumers remain pending or delayed after another consumer reconciles. Do not present the answer as universally applied, falsely report that work resumed, blame the user, or create a duplicate question. If the consumer state is unavailable, show it as unknown rather than healthy/complete.

**Observable outcome:** The person knows their answer was received, what remains pending, and whether Loom—not the user—owns the next step; later they can see the resolved downstream state in the same context.

**Derived from:** `US-002`, `US-003`; Anchor Acceptance Criteria 7, 12, 24; `dashboard-refresh.md` (answered question and affected consumer presentation); historical OQ reconciliation regression cited in the Designer response to OQ `501c7005-768c-423d-81aa-d6a0b058237f`. The regression refines the scenario; it does not independently establish a new requirement or promise a particular refresh cadence.
