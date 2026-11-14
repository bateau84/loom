---
type: Quality Scenario
title: QS-004 — Protect derived reports under restricted source access
description: Avoid leaking protected source information through report, preview, count, or restored-history reads.
tags: [learning, privacy, security, quality]
timestamp: 2026-11-12T00:00:00Z
---
# QS-004 — Protect derived reports under restricted source access

**Priority:** Must. **Status:** Proposed for independent requirements assessment; not an implemented or verified runtime capability.

**Statement:** When an evaluator's authorized evidence includes a source not readable by a later report consumer, reporting and historical retrieval shall not disclose protected content or restricted derived information to that consumer unless a separately authorized release permits it.

**Acceptance criteria:**
- Project-wide findings access does not itself permit unrestricted access to reports derived from protected Sessions or Actions.
- Denied source access remains effective for full reports, excerpts, paginated views, summaries, aggregate metadata and fresh-host reads.
- If an authorized redacted/declassified report is supplied, its disclosure basis and narrower readable content are distinguishable from the protected original.
- A permission withdrawal, content expiry or restored backup does not silently broaden prior restricted report access.
- A denied reader receives a safe denial or policy-approved non-sensitive status, not an empty success-shaped result that suggests no contrary evidence existed.

**Verification semantics:** Have an Evaluator read two authorized Sessions, protect one from an otherwise valid project findings reader, then attempt unrestricted aggregate/report/preview retrieval before and after restore or access revocation. Verify every restricted channel remains denied unless an explicitly authorized derived projection is used.

## Derived from
- [BR-005 — Expose source evidence and coverage gaps](br-005-expose-source-evidence-and-gaps.md)
- [BR-008 — Persist revisable evaluation history](br-008-persist-revisable-evaluation-history.md)
