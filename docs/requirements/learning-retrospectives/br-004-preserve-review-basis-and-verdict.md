---
type: Behavioral Requirement
title: BR-004 — Preserve actual review basis and qualified findings
description: Distinguish requested review coverage from observed evidence supply, access, findings, and scope of verdict.
tags: [learning, review, evidence, requirements]
timestamp: 2026-11-12T00:00:00Z
---
# BR-004 — Preserve actual review basis and qualified findings

**Priority:** Must. **Status:** Proposed for independent requirements assessment; not an implemented or verified runtime capability.

**Statement:** Loom shall preserve the original review mandate and requested subjects separately from the evidence actually provided to or accessed by that review execution, and shall compare the actual findings/verdict scope with both the admitted mandate and observed coverage rather than accepting the Reviewer's later self-description as its original assignment.

**Acceptance criteria:**
- A reader can distinguish requested subjects, material supplied, sources actually retrieved, cited material and what the Reviewer claims to have inspected. None of these stages alone proves comprehension or complete inspection.
- Source material described as actually supplied or retrieved is backed by an observation from the same admitted Reviewer execution; a manifest pointer, authored statement or fabricated citation does not become proof of delivery/access.
- Missing, redacted, denied and unobserved sources are visible as limitations; a partially checked integrated artifact is not reported as exhaustive acceptance of every contributing task.
- A verdict identifies which original requested question, criteria and intended dimensions it answers, what it actually checked and what remains outside its coverage. A security-only PASS cannot be interpreted as complete correctness, reliability or acceptance even when subject/artifact membership is identical to a broader review.
- Review findings retain their Reviewer's source identity and explicitly point to the implicated earlier producing attempts, source observations or artifact versions; they never acquire the earlier agent's authorship.
- A re-review or Critic assessment identifies which earlier findings, work or assembled artifact it actually addresses, preserving the prior verdict and exclusions.

**Verification semantics:** Have a native Reviewer accept a 100-subject request but receive only a manifest pointer and return citations. Verify that the system does not certify material as supplied or retrieved absent corresponding same-invocation receipts. Repeat with actual source accesses, partial R2 review and an independent Critic. For two reviews of identical work/artifact versions, admit a security-only R1 and broader correctness/reliability R2; verify that public readback preserves their different mandates and restricted verdict meanings rather than treating matching subjects as equivalent approval.

## Derived from
The user-approved intent for [PR #233](https://github.com/bateau84/loom/pull/233) is to preserve correct Session/dispatch/task evidence and make whole-work, multi-Session learning automatic. The [accepted architecture](../../learning-evidence-and-review-scope.md) records the resulting constraints; its technical choices are not independent authority to add product behavior.
