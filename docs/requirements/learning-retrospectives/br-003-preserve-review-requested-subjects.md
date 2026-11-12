---
type: Behavioral Requirement
title: BR-003 — Preserve requested review subjects
description: Freeze the exact requested members of reviews spanning multiple tasks, agents, and Sessions.
tags: [learning, review, scope, requirements]
timestamp: 2026-11-12T00:00:00Z
---
# BR-003 — Preserve requested review subjects

**Priority:** Must. **Status:** Proposed for independent requirements assessment; not an implemented or verified runtime capability.

**Statement:** For a Loom-mediated review or Critic dispatch, Loom shall preserve the authorized requested subject population and its historical work/artifact revisions before the review begins, and associate that request with the real review execution to the extent its native identity can be established.

**Acceptance criteria:**
- Requested subjects may be one, ten or one hundred mixed coding and non-coding tasks, attempts, artifacts or earlier reviews across Sessions/Actions, subject to existing source-read permissions; no member is omitted merely because a display or context page is bounded.
- The requested population and exact artifact versions are fixed for that review. Later changes and partial re-reviews receive distinct attributable review contexts.
- A confirmed native review execution is linked to its actual admitted request where host evidence supports the binding. Concurrent or reused child Sessions are not conflated.
- A native review outside the supported admission path remains representable with available source evidence but is not assigned an authoritative fabricated requested-subject population.
- A plan ancestor/descendant/dependency, selected Action or PR reference alone does not prove that all its work was within the review request.

**Verification semantics:** Admit reviews with 1, 10 and 100 independently established subjects under changing plan/artifact revisions. Inspect the original membership and admitted execution after a fresh process; attempt an external unstructured review and verify its unknown members are not silently inferred. Reject unauthorized cross-Action membership or reads.

## Derived from
The user-approved intent for [PR #233](https://github.com/bateau84/loom/pull/233) is to preserve correct Session/dispatch/task evidence and make whole-work, multi-Session learning automatic. The [accepted architecture](../../learning-evidence-and-review-scope.md) records the resulting constraints; its technical choices are not independent authority to add product behavior.
