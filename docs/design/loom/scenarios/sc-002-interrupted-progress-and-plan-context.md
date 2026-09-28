---
type: design
title: SC-002 — Resume an interrupted delivery and understand its plan
description: Resumption of multi-task work with plan context, exhausted retries, and honest evidence.
tags: [scenario, loom, planning, recovery]
---

# SC-002 — Resume an interrupted delivery and understand its plan

**Context:** A product owner returns after interruption to multi-task work spanning specialist sessions/workflows. They need a truthful summary, not a transcript. Assumption: relevant workflow and evidence state is available through conversation or read-only inspection; actual frequency and comprehension are unvalidated.
**Goal:** Reconstruct outcome, progress, dependencies, evidence, and any needed decision without reassembling context.
**Scenario:** The person locates the project/session/workflow in conversation or the read-only dashboard and inspects relevant Objective/Phase/Wave/Task context and blocker. If planning-only was requested, a reviewed Plan is presented as the planning workflow's intermediate outcome; the parent Objective/product is not described as complete, and no implementation is implied. In a separate recovery branch, an unfinished Worker has exhausted bounded dispatches. After returning later, the user sees the exact target, stop reason, preserved evidence/work, and whether a prior continuation authorization was consumed. A fresh explicit request is acknowledged for that exact target; Loom reports whether it resumed, remains exhausted, or completed, separately from acknowledging the request.
**Failure / edge condition:** A handoff omits context, projection is stale/conflicted, the continuation outcome is uncertain, or retry makes no progress. Do not label an eligible step active, unknown data zero/healthy, a reviewed Plan as product completion, or an attempted test as a pass. A fresh continuation request is not a general restart or repeated authorization; if its consumption/outcome cannot be established, report uncertainty rather than imply another run.
**Observable outcome:** The person distinguishes planning from implementation and product completion; knows why Loom stopped and what is preserved; can identify whether the exact continuation was accepted and its eventual result; and sees remaining evidence/gates without false completion.
**Derived from:** `US-002`, `US-003`; Anchor Acceptance Criteria 10–14, 18, 24; user resolution in OQ `3fb7f28b-e116-4765-9366-d2a84c9f7222`; BR-007, BR-008, BR-021, BR-022. The exhaustion history and regression cases refine this journey but do not independently establish authority or claim incident prevalence.
