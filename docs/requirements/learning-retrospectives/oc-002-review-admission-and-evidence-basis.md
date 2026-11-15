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

**Preconditions:** A Loom-mediated review asks to assess a known work population under a defined assessment question and intended review coverage; other native reviews may occur without a qualified Loom admission record. The requester may be authorized to name a protected source without the intended native Reviewer being authorized to receive its content.

**Guarantees:**
- The requested review mandate—assessment question, intended evaluation/quality dimensions, applicable criteria, review mode and inclusion/exclusion boundaries—plus subject population and exact historical work/artifact revisions are established before native admission, rather than inferred from a later outcome or current selection.
- A review manifest is authoritative for the *requested* population only. Any claim that a particular native invocation received it depends on host-observed binding; absent binding, the relationship is explicitly unqualified.
- `requested`, `supplied`, `retrieved`, `cited`, and `claimed-inspected` represent different evidence relationships and must not be silently promoted from one stage to another.
- The authority to request or name a protected subject does **not** authorize disclosure of that source to a different native reviewing execution. Before protected source content is supplied, the receiving execution's access to that specific source/transfer must be authorized, or separate authorized disclosure must permit the transfer. A frozen manifest or confirmed invocation binding is not permission to deliver content. On denial, keep requested membership, withhold protected material and mark it unavailable to that Reviewer; do not label denial as successful supply/retrieval. Do not assume an OpenCode Session ACL feature not yet qualified.
- Supply and retrieval claims refer to the **same actual native review invocation** and source revisions as the admitted request, and expose inaccessible, omitted or unknown parts.
- Findings remain authored by the reviewer/critic execution, name affected subject/evidence where supported, and carry verdict coverage without granting blanket acceptance of unobserved work.
- Reviews initiated outside a qualified admission path remain readable with honest provenance, not forged admitted manifests.

**Semantic input/output:** Input is the original authorized review mandate, requested subjects and historical work/artifact scopes, intended receiving native review execution, source-specific disclosure authority and a native admission opportunity. Output is frozen original question/coverage and membership, qualified execution association, separately authorized and observed evidence supply/access (including denial/gaps), and appropriately scoped attributed findings.

**Failure semantics:** Native admission rejection, unsupported child reuse, wrong invocation, a requester authorized for source B but a receiving Reviewer not authorized to receive B, denied source read, partial input, cancellation or fabricated citation may not produce successful supply, transfer or exact-coverage attestation. Requested subjects and original mandate remain attributable even when protected material is withheld.

**Invariant:** Neither an authoritative requester, a frozen manifest, a native execution binding nor a reviewer-authored statement grants a different reviewing execution permission to receive protected source material or proves its delivery, retrieval, independent comprehension or final provider exposure.

**Verification semantics:** Admit two native reviews of identical 100-task subjects/artifact with different original mandates (security-only versus broad acceptance) and verify their questions, criteria, modes, exclusions and verdict qualifications remain distinguishable. Run a requester authorized to read protected Session B while the receiving Reviewer is not: deny transfer to the Reviewer while preserving requested membership and a visible gap; then verify explicitly authorized recipient access succeeds without upgrading manifest membership into observed receipt. Test a manifest-only prompt with synthetic citations; public readers must not certify unobserved supply/access.

## Derived from
- [BR-003 — Preserve requested review subjects](br-003-preserve-review-requested-subjects.md)
- [BR-004 — Preserve review basis and verdict](br-004-preserve-review-basis-and-verdict.md)
