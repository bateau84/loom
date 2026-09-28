---
type: design
title: SC-001 — Explore first, then commit and refine during delivery
description: Conversation-to-execution journey including ambiguous intent and scoped refinement.
tags: [scenario, loom, conversation, execution]
---

# SC-001 — Explore first, then commit and refine during delivery

**Context:** A developer in OpenCode considers a feature, compares an approach, and may later authorize implementation. They need not know Loom's internal roles. Assumption: conversation history is available.
**Goal:** Decide the intended outcome without triggering premature changes, then delegate delivery without manually coordinating specialists.
**Scenario:** The developer asks whether retry behavior makes sense. Loom challenges an assumption and researches a technical unknown without starting a build. The developer clarifies a product preference and asks for the agreed outcome to be built. Loom makes the transition clear and proceeds. Mid-delivery, the developer corrects one user-facing detail; Loom reconciles the affected slice and continues authorized work.
**Failure / edge condition:** “Could you try this?” is ambiguous between an experiment and committed change; later refinement invalidates some dependent work. Loom neither mutates on ambiguous intent nor pretends stale work is current; it clarifies only material user-owned ambiguity and preserves unaffected work/evidence.
**Observable outcome:** The user can tell when execution begins, what refinement changed, what became stale and why, and whether delivery is complete or blocked. Exploration alone causes no accidental governed implementation.
**Derived from:** `US-001`; Anchor Acceptance Criteria 1–3, 23, 26 and Reserved Decisions; BR-019 and BR-020. `conversation-first-experience.md` provides proposed-status design precedent, not independent accepted intent.
