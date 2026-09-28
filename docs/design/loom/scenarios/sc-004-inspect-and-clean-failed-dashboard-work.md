---
type: design
title: SC-004 — Clean terminal failures without losing useful records
description: Dashboard cleanup journey with stale selections, blocked deletion, and uncertain response.
tags: [scenario, loom, dashboard, cleanup]
---

# SC-004 — Clean terminal failures without losing useful records

**Context:** A developer using Loom across working directories notices failed/cancelled restart attempts cluttering the work view; active work may coexist. They may use keyboard navigation or a narrow viewport. Assumption: BR-018 and dashboard design remain in force.
**Goal:** Locate terminal attempts and clean them without cancelling active work, deleting project files, or mistaking an uncertain browser response for failure.
**Scenario:** The developer navigates project/session/work details, selects terminal failed/cancelled attempts, reviews the exact set and consequences, and confirms. Removed records disappear from normal views while retained evidence/completed work remain. The person navigates Back or reloads and sees coherent state.
**Failure / edge condition:** Selection is stale, active work is included, a completed-Wave receipt blocks cleanup, projection is stale/conflicted, or response is interrupted after possible commit. Explain the boundary; preserve last valid view; allow refresh or idempotent safe retry without claiming unconfirmed success.
**Observable outcome:** User knows what was removed and retained; active work/project files remain untouched; blocked cleanup has an actionable reason; uncertain completion can be resolved safely.
**Derived from:** `US-004`; BR-018; `dashboard-experience.md`; `dashboard-refresh.md` (proposed status/current realization requires implementation validation). `dashboard-observability.md` is implementation evidence only, not human-facing authority.
