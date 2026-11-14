---
type: Behavioral Requirement
title: BR-001 — Preserve execution attribution
description: Capture permitted source observations without misattributing them to another Session, dispatch, or agent.
tags: [learning, evidence, provenance, requirements]
timestamp: 2026-11-12T00:00:00Z
---
# BR-001 — Preserve execution attribution

**Priority:** Must. **Status:** Proposed for independent requirements assessment; not an implemented or verified runtime capability.

**Statement:** For each captured engineering event, Loom shall preserve its established originating execution identity and relationship to the actual Session and dispatch/attempt when observable, without inventing an identity when source attribution is missing or ambiguous.

**Acceptance criteria:**
- Host-observable tool starts, finishes, errors, dispatches, skill-load observations, plan changes, results, reviews and corrections are attributable to their actual recorded Session and agent and, where confirmed, the correct invocation/attempt; events outside the observable host surface are not falsely claimed captured.
- Parent and child relationships, nested or concurrent dispatches, and repeated invocations of the same child Session are represented as distinct invocations when source proof permits; independent work without a dispatch remains distinguishable from a missing-dispatch relationship.
- A later change of active Action, Task or plan does not reassign an earlier event or late return to the newer selection.
- Missing, reused, opaque or conflicting host identities retain an explicit provenance/coverage gap rather than being matched by name, title, timing, similar arguments, completion order or a self-authored assertion.
- Original attribution survives fresh reads, subsequent evaluations and later corrections; an Evaluator or Reviewer cannot change the owner of the source event.

**Verification semantics:** Exercise a parent dispatching parallel, nested and reused child Sessions with overlapping calls, a changed Task selection, late returns and ambiguous wrapper calls. Inspect the recorded source-owner identity and gap states after a fresh process read. The requirement fails if any event moves to a different execution or an ambiguous relationship becomes certified by inference alone.

## Derived from
The user-approved intent for [PR #233](https://github.com/bateau84/loom/pull/233) is to preserve correct Session/dispatch/task evidence and make whole-work, multi-Session learning automatic. The [accepted architecture](../../learning-evidence-and-review-scope.md) records the resulting constraints; its technical choices are not independent authority to add product behavior.
