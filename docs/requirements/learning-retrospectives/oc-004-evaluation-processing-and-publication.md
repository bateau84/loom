---
type: Obligation Contract
title: OC-004 — Evaluation processing and publication meaning
description: Shared meanings of eligibility, progress, completion, stale analysis, and durable report publication.
tags: [learning, evaluation, recovery, contracts]
timestamp: 2026-11-12T00:00:00Z
---
# OC-004 — Evaluation processing and publication meaning

**Priority:** Must. **Status:** Proposed for independent requirements assessment; not an implemented or verified runtime capability.

**Participants:** Engineering evidence source, evaluation scheduler/origin reader, Evaluator, report publisher and consumer.

**Preconditions:** Eligible authorized evidence can be processed incrementally or in an overall batch; observations or later reviews may arrive while earlier work is evaluated.

**Guarantees:**
- `Pending`, `blocked`, `partially processed`, `stale` and `complete through boundary` have distinct observable meanings. No Session is permanently evaluated because one callback, individual report or local Task finished.
- Batch membership and its source boundary remain stable for that publication; work outside the boundary belongs to future processing, while missing eligible members prevent a complete batch claim.
- A complete report is visible only when its own content, source/dependency identities, required protected material, authorization qualifications and processed boundary are consistently durable and retrievable.
- Re-running a previously admitted logical evaluation may reuse legitimate completed work but cannot publish multiple distinct successes for the same source/method boundary. Ambiguous model-provider execution is not claimed exactly once.
- Later contrary evidence or changed method can produce a new interpretation linked to the old one, without deleting the old record or duplicating the underlying originating objective.
- Missing source authorization or provider budget leaves a truthful pending/blocked obligation without disabling healthy ordinary execution.

**Semantic input/output:** Input is frozen eligible evidence membership, source high-water marks and an authorized evaluation method. Output is a qualified report, dependency provenance and corresponding processing state.

**Failure semantics:** A crash or cancellation before consistent publication cannot advance successful coverage. A reader encountering lost referenced content must not receive an unqualified completed result. Restart reconciles incomplete work and exposed gaps.

**Invariant:** A consumer never sees a `complete` evaluation whose required referenced report/source boundary is not available and authorized for that consumer.

**Verification semantics:** Interrupt at source processing, report content staging, publication and checkpoint boundaries, then recover across actual stores. Compare the public reader's report, membership and checkpoint identities; after a late review or access change, verify current conclusions and access remain correct.

## Derived from
- [BR-006 — Evaluate accumulated work automatically](br-006-run-evaluation-automatically.md)
- [BR-007 — Prioritize whole-work learning](br-007-prioritize-whole-work-learning.md)
- [BR-008 — Persist revisable evaluation history](br-008-persist-revisable-evaluation-history.md)
