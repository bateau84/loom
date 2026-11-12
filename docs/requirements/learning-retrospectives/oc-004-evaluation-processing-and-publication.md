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
- Evaluation-processing completeness means the frozen source boundary was processed and the report, dependencies and required evidence are durably retrievable within their **authorized processing scope**, with missing or denied evidence disclosed as coverage limits. This does not mean every later reader may access protected sources.
- Reader disclosure is a separate authorization state: an eligible consumer may see an expressly authorized redacted/declassified report projection, including truthful processing-completion status and coverage qualifications, without obtaining protected source bytes or implying unrestricted evidence access. The projection must be valid for that reader and cannot expose unpermitted content.
- Re-running a previously admitted logical evaluation may reuse legitimate completed work but cannot publish multiple distinct successes for the same source/method boundary. Ambiguous model-provider execution is not claimed exactly once.
- Later contrary evidence or changed method can produce a new interpretation linked to the old one, without deleting the old record or duplicating the underlying originating objective.
- Missing source authorization or provider budget leaves a truthful pending/blocked obligation without disabling healthy ordinary execution.

**Semantic input/output:** Input is frozen eligible evidence membership, source high-water marks and an authorized evaluation method. Output is a qualified report, dependency provenance and corresponding processing state.

**Failure semantics:** A crash or cancellation before consistent publication cannot advance successful coverage. A reader encountering lost referenced content must not receive an unqualified completed result. Restart reconciles incomplete work and exposed gaps.

**Invariant:** Processing-completion status cannot precede durable availability of its required original report/dependency/source boundary to the authorized evaluation process. A reader may see that truthful status only through an independently authorized disclosure view; it never implies that protected original evidence is fully accessible to that reader or that excerpts exhaust the review basis.

**Verification semantics:** Interrupt at source processing, report content staging, publication and checkpoint boundaries, then recover across actual stores. Compare the authorized processing reader's report, membership and checkpoint identities. Give another reader an authorized redacted/declassified view: it must show truthful processing status and disclosed gaps without granting access to protected sources or portraying excerpts as complete evidence. Revoke underlying access and verify restrictions persist; after a late review verify current conclusions.

## Derived from
- [BR-006 — Evaluate accumulated work automatically](br-006-run-evaluation-automatically.md)
- [BR-007 — Prioritize whole-work learning](br-007-prioritize-whole-work-learning.md)
- [BR-008 — Persist revisable evaluation history](br-008-persist-revisable-evaluation-history.md)
