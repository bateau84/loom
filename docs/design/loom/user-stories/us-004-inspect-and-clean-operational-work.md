---
type: design
title: US-004 — Find and clean up operational work records
description: Human goal for locating operational work and safely cleaning terminal attempts.
tags: [user-story, loom, dashboard, cleanup]
---

# US-004 — Find and clean up operational work records

**Actor / context:** A developer using Loom across working directories or sessions who needs an overview or has accumulated terminal failed/cancelled attempts.
**Trigger:** Locate work, inspect context, or remove obsolete terminal attempts from the normal operational view.
**Goal:** Find the relevant work by recognizable project/session/work names and, when appropriate, remove stale terminal records without harming project files, retained evidence, or active work.
**Observable success:** The person distinguishes work/state and can inspect details progressively; sees exact cleanup targets and consequences before confirming; and gets truthful success/failure/unknown feedback with a safe retry path.
**Derived from:** `docs/requirements/loom/br-018-external-operational-dashboard.md`; `docs/anchors/loom/anchor.md` (Acceptance Criteria 24–26, supporting intent only); current design: `dashboard-experience.md`, `dashboard-refresh.md`.

**Provenance note:** The accepted current Loom Anchor does not name dashboard cleanup. This story records separately accepted BR-018 and existing design authority, not an inference that every dashboard capability is Anchor scope.
