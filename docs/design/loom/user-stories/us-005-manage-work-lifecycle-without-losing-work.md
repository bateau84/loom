---
type: design
title: US-005 — Set work aside, return to it, and recover safely
description: Human goal for deferring, resuming, revising, and safely ending work.
tags: [user-story, loom, recovery, lifecycle]
---

# US-005 — Set work aside, return to it, and recover safely

**Actor / context:** A developer/product owner with more than one active or planned request, who may need to reprioritize, revisit an earlier decision, or stop work without losing useful progress.
**Trigger:** The person needs to defer a current workflow, resume it later, revise an earlier part of its accepted direction, or remove work they no longer want pursued.
**Goal:** Control whether work continues, resumes, is revised, cancelled, or archived while understanding what each choice means and retaining project files, evidence/provenance, and completed work.
**Observable success:** The person can distinguish a paused/backburnered workflow from active, blocked, cancelled, archived, and complete work; resume without reconstructing context; recover from an intentional backtrack without confusing stale downstream work for current results; and distinguish cancellation from archival/permanent deletion. An active-item Delete first requests cancellation. Ordinary Delete for eligible non-active work may archive it; permanent deletion is a separate explicit action from Archived. Project files, retained evidence/provenance, and completed work are not silently removed.
**Derived from:** `docs/anchors/loom/anchor.md` (Acceptance Criteria 13, 25 and Reserved Decisions); `US-003`; user's requested lifecycle boundaries in the authority-reconstruction design assignment. These lifecycle capabilities are a design gap, not current implementation authority; dashboard placement remains bounded by the accepted read-only inspection scope until explicitly reconciled.
