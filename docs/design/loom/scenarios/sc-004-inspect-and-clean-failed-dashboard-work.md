---
type: design
title: SC-004 — Clean terminal failures without losing useful records
description: Dashboard cleanup journey with stale selections, blocked deletion, and uncertain response.
tags: [scenario, loom, dashboard, cleanup]
---

# SC-004 — Clean terminal failures without losing useful records

**Context:** A developer using Loom across working directories notices failed/cancelled restart attempts cluttering the work view; active work may coexist. They may use keyboard navigation or a narrow viewport. The user-approved cleanup boundary governs the intended journey; BR-018 remains proposed and is not independently accepted authority. Current implementation has a known source-level mismatch: `plugins/loom/workflow-cleanup.ts:292–299` deletes workflow OQ records, including answered-question content/attribution, despite the intended retained-evidence boundary. This is not a claim of historical incident or prevalence.
**Goal:** Locate terminal failed/cancelled workflow records and, only after explicit confirmation, remove those records without deleting project files, retained evidence, or completed work.
**Scenario:** The developer navigates read-only working-directory/session/workflow views and inspects status/evidence. They choose cleanup for one or more terminal failed/cancelled workflow records, review the exact records and the preservation boundary, then explicitly confirm. After confirmed success, the records are no longer presented as current operational work; project files, retained evidence, and completed work remain. Back/reload keeps navigation coherent.
**Failure / edge condition:** The selection has changed and is no longer terminal, projection is stale/conflicted, or the response is interrupted after possible completion. Do not silently include changed/non-terminal work or report success/failure when outcome is unknown. Preserve the last valid view and provide a way to refresh/reconcile the result. Historical cleanup regressions motivate testing identity and state drift; they do not expand cleanup eligibility or imply incident prevalence.
**Observable outcome:** The user knows exactly which terminal workflow records were removed or whether the result remains unknown; they can verify that project files, retained evidence, and completed work remain preserved. Dashboard inspection remains read-only and does not authorize execution.
**Derived from:** `US-004`; user resolution in OQ `3fb7f28b-e116-4765-9366-d2a84c9f7222`; `dashboard-experience.md`; `dashboard-refresh.md`. Historical design/test evidence is a journey refinement, not separate product authority.
