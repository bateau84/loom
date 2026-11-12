---
type: Obligation Contract
title: OC-002 — Review admission and effective evidence basis
description: Bind authorized requested review scope to real native execution and distinguish source-access stages.
tags: [learning, review, evidence, contracts]
timestamp: 2026-11-12T00:00:00Z
---
# OC-002 — Review admission and effective evidence basis

**Priority:** Must. **Status:** Proposed for independent requirements assessment; not an implemented or verified runtime capability.

**Participants:** Authorized review requester, Loom's review-admission responsibility, native reviewing execution, evidence-access observer, and review/report reader.

**Preconditions:** A Loom-mediated review asks to assess a known work population; other native reviews may occur without a qualified Loom admission record.

**Guarantees:**
- The requested review subject population and exact historical work/artifact revisions are established before native admission, rather than inferred from a later outcome or current selection.
- A review manifest is authoritative for the *requested* population only. Any claim that a particular native invocation received it depends on host-observed binding; absent binding, the relationship is explicitly unqualified.
- `requested`, `supplied`, `retrieved`, `cited`, and `claimed-inspected` represent different evidence relationships and must not be silently promoted from one stage to another.
- Supply and retrieval claims refer to the **same actual native review invocation** and source revisions as the admitted request, and expose inaccessible, omitted or unknown parts.
- Findings remain authored by the reviewer/critic execution, name affected subject/evidence where supported, and carry verdict coverage without granting blanket acceptance of unobserved work.
- Reviews initiated outside a qualified admission path remain readable with honest provenance, not forged admitted manifests.

**Semantic input/output:** Input is authorized requested work plus original scopes/artifact revisions and a native admission opportunity. Output is the immutable requested population, a qualified execution association, observed evidence supply/access and attributed findings.

**Failure semantics:** Native admission rejection, unsupported child reuse, wrong Invocation, denied source read, partial input, cancellation, or fabricated citation may not produce a successful exact-coverage attestation.

**Invariant:** Neither a manifest pointer nor a reviewer-authored statement proves source delivery, retrieval, independent comprehension or final provider exposure.

**Verification semantics:** Run one native Reviewer against a frozen 100-task manifest, validate its admitted identity and actual received/retrieved source receipts, then give another reviewer only the manifest pointer and synthetic citations. Public readers must distinguish the two and never certify missing supply/access.

## Derived from
- [BR-003 — Preserve requested review subjects](br-003-preserve-review-requested-subjects.md)
- [BR-004 — Preserve review basis and verdict](br-004-preserve-review-basis-and-verdict.md)
