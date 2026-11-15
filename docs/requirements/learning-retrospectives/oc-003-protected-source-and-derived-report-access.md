---
type: Obligation Contract
title: OC-003 — Protected source and derived-report access
description: Shared authorization and retention semantics across capture, review, evaluation and report distribution.
tags: [learning, privacy, authority, contracts]
timestamp: 2026-11-12T00:00:00Z
---
# OC-003 — Protected source and derived-report access

**Priority:** Must. **Status:** Proposed for independent requirements assessment; not an implemented or verified runtime capability.

**Participants:** Operator authorizing collection and disclosure, source permission owner, Loom capture/evaluation, protected evidence store or source provider, and derived-report reader.

**Preconditions:** Source material may contain private content or cross-Session data, and a report may derive statements or metadata from multiple such sources.

**Guarantees:**
- Existing `ledger.capture: automatic` means its current bounded metadata/digest collection; expanding into raw input/output or transcript retention requires separately authorized inclusion classes, purpose, readers and retention/deletion rules.
- A permitted evaluation read does not grant a blanket subsequent right to share the source or an unrestricted report derived from it.
- Derived report bodies, excerpts, citations, previews, counts and historical readers respect applicable source access and retention constraints unless a separately authorized redacted/declassified release permits a broader audience.
- Source read denial, withdrawn authorization, expiry, deletion and loss of retained material remain visible as denied or limited coverage, not false absence or success.
- Authorization and disclosure restrictions persist when evaluation state is recovered or restored; protected content is not silently copied into an unrestricted project-wide findings channel.

**Semantic input/output:** Input is source identity/content (or a declared gap) with applicable read, retention and sharing authority. Output is an allowed scoped evidence read, restricted derived report, or expressly authorized redacted release.

**Failure semantics:** If a reader's access cannot be justified, withhold restricted content and only return policy-approved non-sensitive status. If source restrictions change, do not continue serving older unrestricted derived views without renewed authorization.

**Invariant:** The authorization to analyze data never becomes an implicit authorization to expose its protected contents or derived sensitive details to another Session.

**Verification semantics:** Derive a report from two differently restricted Sessions. Allow the Evaluator to read both, deny another Session access to one, then verify that all report/readback channels obey the denial before and after access revocation and restore. Confirm legacy capture does not retain newly unauthorized raw data.

## Derived from
- [BR-005 — Expose source evidence and coverage gaps](br-005-expose-source-evidence-and-gaps.md)
- [BR-008 — Persist revisable evaluation history](br-008-persist-revisable-evaluation-history.md)
