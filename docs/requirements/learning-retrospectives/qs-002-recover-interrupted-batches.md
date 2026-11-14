---
type: Quality Scenario
title: QS-002 — Recover interrupted evaluation batches
description: Preserve useful evaluation progress and truthful publication through failures and restart.
tags: [learning, recovery, quality, evaluation]
timestamp: 2026-11-12T00:00:00Z
---
# QS-002 — Recover interrupted evaluation batches

**Priority:** Must. **Status:** Proposed for independent requirements assessment; not an implemented or verified runtime capability.

**Statement:** When evaluation is interrupted, cancelled, retried, or restarted between source capture, report publication and checkpointing, previously collected evidence shall remain recoverable without silently skipping work, duplicating logical reports or publishing false completeness.

**Acceptance criteria:**
- A crash before a report and its required dependencies are durably retrievable does not expose a successful processed checkpoint for that range.
- Published report, dependency identities and checkpoint identify the same evidence generation; missing referenced content is detected and its completeness is withdrawn or qualified, not silently ignored.
- Retried operations do not duplicate a logical assessment. Ambiguous remote model execution may require a new attempt, but cannot be reported as exactly-once model delivery.
- Interrupted and failed Sessions that never emitted an idle event are still eligible for later backlog discovery and recovery.
- Recovery allows unrelated engineering work to continue when the optional learning subsystem is degraded.

**Verification semantics:** Interrupt an end-to-end run before, during and after durable report publication, then recover. Read through real public readers and assert that neither a missing report nor incomplete source bytes can be concealed by a completed checkpoint; process the remainder once logically.

## Derived from
- [BR-006 — Evaluate accumulated work automatically](br-006-run-evaluation-automatically.md)
- [BR-008 — Persist revisable evaluation history](br-008-persist-revisable-evaluation-history.md)
