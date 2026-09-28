---
type: design
title: SC-002 — Resume an interrupted delivery and understand its plan
description: Resumption of multi-task work with plan context, exhausted retries, and honest evidence.
tags: [scenario, loom, planning, recovery]
---

# SC-002 — Resume an interrupted delivery and understand its plan

**Context:** A product owner returns after interruption to a substantial multi-task change spanning specialist sessions/workflows. They need truthful summary rather than transcript. Assumption: some workflow state is observable; frequency is unvalidated.
**Goal:** Reconstruct outcome, progress, dependencies, evidence, and any needed decision without reassembling context.
**Scenario:** The person resumes through conversation or the operational dashboard, locates project/session/workflow, and inspects relevant Objective/Phase/Wave/Task context and blocker. A step exhausts bounded retries; prior evidence and useful completed work remain available. The user may explicitly authorize one bounded continuation. Loom resumes the exact target and reports result and remaining independent checks.
**Failure / edge condition:** A handoff omits context; projection is stale/conflicted; or retry makes no progress. Do not label an eligible step active, unknown data zero/healthy, or an attempted test a pass. Continuation must preserve evidence and cannot authorize repeated retries from one instruction.
**Observable outcome:** User distinguishes product plan from execution stages, knows why Loom stopped and what is preserved, can identify the exact continuation authorization, and sees remaining evidence/gates without false completion.
**Derived from:** `US-002`, `US-003`; Anchor Acceptance Criteria 10–14, 18, 24; BR-007, BR-008, BR-021, BR-022.
