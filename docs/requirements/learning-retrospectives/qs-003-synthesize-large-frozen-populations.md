---
type: Quality Scenario
title: QS-003 — Synthesize large frozen populations without omission
description: Maintain truthful coverage and denominators when a retrospective exceeds interactive reader limits.
tags: [learning, scale, quality, retrospectives]
timestamp: 2026-11-12T00:00:00Z
---
# QS-003 — Synthesize large frozen populations without omission

**Priority:** Must. **Status:** Proposed for independent requirements assessment; not an implemented or verified runtime capability.

**Statement:** When a requested authorized retrospective population exceeds one processing/context page or the existing interactive comparison limits, Loom shall preserve complete frozen membership and a truthful overall result across bounded processing rounds.

**Acceptance criteria:**
- A review over 100 requested heterogeneous task subjects remains fully identifiable even when evidence and results require pagination or multiple contexts.
- A retrospective population larger than the present interactive 500-objective limit may be processed in bounded chunks; if any eligible member remains unprocessed, the overall batch cannot be represented as complete.
- Repeated appearances of one objective in different Sessions or chunks do not inflate the population count; unknown origin independence remains a qualifier even when authored objective IDs are distinct.
- The report distinguishes eligible, excluded, incomplete and unknown populations with stable denominators for the frozen evaluated boundary.
- Resource limits produce bounded progress, deferral or explicit incomplete status rather than silent truncation or an unbounded model call.

**Verification semantics:** Assemble more than 500 linked objectives, include shared Sessions, duplicate appearances and mixed source completeness, and interrupt between processing pages. Read the resulting aggregate and compare membership/denominators against the frozen source set; assert no omitted prefix is declared a complete retrospective.

## Derived from
- [BR-003 — Preserve requested review subjects](br-003-preserve-review-requested-subjects.md)
- [BR-007 — Prioritize whole-work learning](br-007-prioritize-whole-work-learning.md)
- [BR-008 — Persist revisable evaluation history](br-008-persist-revisable-evaluation-history.md)
