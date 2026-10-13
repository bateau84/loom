---
type: design
title: US-004 — Find and clean up operational work records
description: Human goal for locating operational work and safely cleaning terminal attempts.
tags: [user-story, loom, dashboard, cleanup]
---

# US-004 — Find and clean up operational work records

**Actor / context:** A developer using Loom across working directories or sessions who needs read-only operational visibility or has accumulated terminal failed/cancelled workflow records.
**Trigger:** Locate and inspect work, or intentionally remove obsolete terminal workflow records from the operational view.
**Goal:** Find relevant work by recognizable project/session/work context; only when appropriate, explicitly confirm removal of terminal failed/cancelled workflow records without deleting project files, retained evidence, or completed work.
**Observable success:** Directory/session/workflow information and evidence can be inspected without granting execution authority. Before cleanup, the exact terminal-record target and consequence are clear; after confirmation the person receives truthful outcome feedback and knows project files, retained evidence, and completed work remain preserved.
**Derived from:** User resolution in OQ `3fb7f28b-e116-4765-9366-d2a84c9f7222`; `docs/anchors/loom/anchor.md` (Acceptance Criterion 24, supporting intent); `br-018-external-operational-dashboard.md`; current design: `dashboard-experience.md`, `dashboard-refresh.md`.

**Provenance note:** The user explicitly accepted this bounded dashboard/cleanup scope in the cited OQ. That does not make unrelated BR-018 behaviors, transport details, or implementation mechanisms product authority.
