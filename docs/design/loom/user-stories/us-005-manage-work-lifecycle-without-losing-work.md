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
**Observable success:** The person can distinguish a specifically backburnered workflow from active, blocked, cancelled, archived, and complete work; resume it without reconstructing context; recover from an intentional backtrack without confusing stale downstream work for current results; and distinguish cancellation from archival/permanent deletion. Any workflow state can be removed from the default list by Archive, except that an Active workflow must first be cancelled and cancellation confirmed before it can be archived. If an operation may remain in flight after cancellation, Archived retains a clear uncertainty marker and relevant evidence; Permanent Delete is separately confirmed and unavailable until quiescence is confirmed. Project files, retained evidence/provenance, and completed work are preserved by the requested archive/delete journey.
**Derived from:** `docs/anchors/loom/anchor.md` (Acceptance Criteria 13, 25 and Reserved Decisions); `US-003`; user's lifecycle and Archive/Permanent Delete clarification in the authority-reconstruction design assignment. These are requested outcomes, not current capability or proof that the current accepted Anchor has been amended. The latest Archive journey must be reconciled with the earlier read-only-dashboard/terminal-cleanup boundary before implementation.
