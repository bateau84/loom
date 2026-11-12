---
type: Quality Scenario
title: QS-005 — Bound optional automatic analysis
description: Keep ordinary work functional when evaluation is expensive, unavailable, or recursively triggered.
tags: [learning, safety, cost, quality]
timestamp: 2026-11-12T00:00:00Z
---
# QS-005 — Bound optional automatic analysis

**Priority:** Must. **Status:** Proposed for independent requirements assessment; not an implemented or verified runtime capability.

**Statement:** During repeated idle notifications, concurrent evaluation opportunities, unavailable authorization/provider quota, cancellation or subsystem failure, Loom's optional analysis shall not cause unbounded dispatches, unauthorized spending or loss of ordinary engineering availability.

**Acceptance criteria:**
- Repeated stimuli for the same already-claimed evidence cannot cause unbounded competing evaluations or recursive self-audit loops.
- Absent authorized provider selection, configured budget or required source access leaves work pending/blocked without an unqualified paid fallback.
- Cancellation, shutdown and learning-storage errors cannot be misreported as successful analysis, and ordinary healthy engineering tools and existing safety guards remain usable.
- The operator can inspect the reason for deferral and whether work remains queued; later qualified operation can continue pending work without fabricating previous execution.
- No particular latency, spending amount, retention period or background daemon is assumed until the applicable operator policy is established.

**Verification semantics:** Exercise repeated idle callbacks, competing workers, quota exhaustion, denied permissions, cancellation and optional-store failure in the installed path. Confirm bounded job count/spend authorization, truthful pending status and continuing ordinary work.

## Derived from
- [BR-006 — Evaluate accumulated work automatically](br-006-run-evaluation-automatically.md)
- [BR-009 — Present controlled system improvements](br-009-present-controlled-system-improvements.md)
