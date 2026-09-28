---
type: design
title: SC-006 — Recover from malformed dashboard refresh without losing orientation
description: Retain and recover the last-good operational view when a refresh is invalid.
tags: [scenario, loom, dashboard, recovery, accessibility]
---

# SC-006 — Recover from malformed dashboard refresh without losing orientation

**Context:** A developer is inspecting a directory/session/workflow view, possibly a filtered or empty result, when a refresh fails validation. They may be navigating by keyboard or using a deep link. A historical browser regression supplies this failure stimulus; it does not establish production incidence or expand accepted product scope.

**Goal:** Continue to understand the last trustworthy view and recover without losing the current location, selection, or filter context.

**Scenario:** The dashboard receives malformed refresh data while the user is reading or navigating. It retains the last valid snapshot—even when that snapshot is empty—and marks it as retained/stale or unavailable rather than current and healthy. The current URL and navigation remain usable; focus and selection do not jump to a different record. An explicit refresh/retry can request current data. When valid data arrives, the freshness warning clears or updates and changed content is announced without repeating unchanged heartbeat details.

**Failure / edge condition:** Repeated malformed responses arrive or the retry fails. Do not replace the last-good view with poisoned values, misleading zero counts, or an unrelated empty/error route. State that current data could not be confirmed, preserve user orientation, and keep a discoverable recovery path. If a record truly disappears in a later valid view, do not claim that a previous failed refresh proved deletion.

**Observable outcome:** The user can continue from the same meaningful location, tell which information is retained versus confirmed current, and retry without false success or lost context.

**Derived from:** `US-002`, `US-003`; Anchor Acceptance Criteria 10, 12, 24; `dashboard-experience.md`, `dashboard-refresh.md`; historical malformed-refresh browser regression cited in the Designer response to OQ `501c7005-768c-423d-81aa-d6a0b058237f`. The regression refines the journey, not desired scope or prevalence.
