---
type: design
title: SC-003 — Diagnose a failure without expanding the request
description: Conversational diagnosis with misleading hypotheses and bounded evidence.
tags: [scenario, loom, diagnosis, recovery]
---

# SC-003 — Diagnose a failure without expanding the request

**Context:** A developer reports an unexpected failure with partial logs and asks Loom to debug it. Several causes may fit. Assumption: findings are wanted unless a code change is explicitly requested.
**Goal:** Learn the cause and safe next action without unrelated redesign or presenting mitigation as confirmed fix.
**Scenario:** Loom inspects evidence, tests/disproves plausible causes, and reports confirmed cause separately from hypotheses and mitigation. If evidence is insufficient, it identifies the smallest missing observation. If the user then requests repair, Loom scopes and executes it under appropriate authority.
**Failure / edge condition:** First theory is wrong, logs incomplete, or diagnostic host/tool fails. Loom preserves useful failed hypotheses as evidence, avoids sensitive disclosure, and does not turn a failed investigation into a successful fix.
**Observable outcome:** User receives evidence-calibrated diagnosis, uncertainty, and bounded next step; no repository mutation occurs unless execution intent is clear.
**Derived from:** `US-001`, `US-003`; Anchor Acceptance Criteria 12, 21–23; BR-013, BR-019, BR-020.
