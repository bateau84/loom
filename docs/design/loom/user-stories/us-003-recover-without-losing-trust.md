---
type: design
title: US-003 — Recover from an interrupted or failed attempt
description: Human goal for bounded, truthful recovery that preserves useful work and evidence.
tags: [user-story, loom, recovery, trust]
---

# US-003 — Recover from an interrupted or failed attempt

**Actor / context:** A developer relying on Loom for consequential repository work when a host, specialist, tool, verification step, or dashboard request fails or is interrupted.
**Trigger:** Work stops unexpectedly, bounded retries are exhausted, a response is uncertain, or a failure is reported.
**Goal:** Resume or safely stop accurately, avoid duplicate/destructive actions, and retain useful work and evidence.
**Observable success:** Loom distinguishes confirmed outcomes from unknown ones, diagnoses from symptoms, preserves completed work/evidence, uses bounded evidence-led recovery where authorized, and identifies the smallest real blocker or safe next action.
**Derived from:** `docs/anchors/loom/anchor.md` (Acceptance Criteria 10–14, 21; Reserved Decisions); `br-008-bounded-autonomy-and-progress.md`; `br-013-diagnose-root-causes.md`; `br-020-conversation-is-primary-interface.md`.
