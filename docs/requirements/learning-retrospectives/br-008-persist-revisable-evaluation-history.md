---
type: Behavioral Requirement
title: BR-008 — Persist revisable evaluation history
description: Make source-linked evaluations, checkpoints and follow-up interpretations recoverable over time.
tags: [learning, history, evaluation, requirements]
timestamp: 2026-11-12T00:00:00Z
---
# BR-008 — Persist revisable evaluation history

**Priority:** Must. **Status:** Proposed for independent requirements assessment; not an implemented or verified runtime capability.

**Statement:** Loom shall preserve and expose the original sources, material qualifications, evaluation revisions and durable processing status needed to resume learning and revisit affected conclusions after later evidence.

**Acceptance criteria:**
- Reports identify the original work/evidence scope assessed, available coverage, evaluation method identity and the source boundary through which work was processed; progress status is not reduced to a permanent `evaluated=true` assertion.
- Successful checkpointed work is distinguishable from pending, blocked, interrupted, incomplete and stale work. A completed local step/Session report alone does not mean a larger retrospective batch is complete.
- A subsequent review, correction, newly available source or changed evaluation methodology can supersede affected interpretations while retaining old reports and their evidence basis as history.
- A reader can retrieve previous and current qualified interpretations and identify material disagreements, without relying on ephemeral agent-chat memory.
- Work outside the observed range, including newly arriving events during a batch, is not silently marked complete or lost.

**Verification semantics:** Evaluate part of a Session, restart, append an adverse review to an earlier result, and inspect both the older report and the new qualified assessment; verify that only actually processed source ranges were checkpointed and the overall batch retains correct completion state.

## Derived from
The user-approved intent for [PR #233](https://github.com/bateau84/loom/pull/233) is to preserve correct Session/dispatch/task evidence and make whole-work, multi-Session learning automatic. The [accepted architecture](../../learning-evidence-and-review-scope.md) records the resulting constraints; its technical choices are not independent authority to add product behavior.
