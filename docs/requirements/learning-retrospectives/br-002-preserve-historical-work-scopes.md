---
type: Behavioral Requirement
title: BR-002 — Preserve historical work scopes
description: Let subsequent reviews reconstruct the original responsibilities and artifacts of each attempt.
tags: [learning, tasks, plans, history]
timestamp: 2026-11-12T00:00:00Z
---
# BR-002 — Preserve historical work scopes

**Priority:** Must. **Status:** Proposed for independent requirements assessment; not an implemented or verified runtime capability.

**Statement:** Loom shall make each recorded engineering attempt's original requested work scope and outcome evidence reconstructible at its applicable historical revision, without replacing that meaning with a later Task, Plan or artifact revision.

**Acceptance criteria:**
- When known, a task's original assigned outcome, criteria, constraints, dependencies, relevant provided context and governing Action/Plan revisions are retrievable alongside its producing execution and result.
- An artifact referenced by a review or attempt has the actual version/snapshot under consideration; a mutable branch, path, title or PR number alone does not establish the bytes that were reviewed.
- Replanning, requirement changes, corrective attempts and cancellation append changed context while preserving earlier contracts; a later successful result does not retroactively certify an earlier attempt.
- A Session may contribute to several work scopes or none; cross-Session continuation and source relationships are identifiable where established, while unknown membership stays unknown.
- When historical source content is inaccessible or not retained under the applicable authorization, the response identifies the unavailable material rather than claiming the scope was reconstructed.

**Verification semantics:** Dispatch work against revision A, change task requirements and artifacts to B while work is active, then review both revisions after a restart. Confirm that A's constraints/artifact remain distinct from B's, and verify that unavailable historical data produces a visible gap rather than a substituted current definition.

## Derived from
The user-approved intent for [PR #233](https://github.com/bateau84/loom/pull/233) is to preserve correct Session/dispatch/task evidence and make whole-work, multi-Session learning automatic. The [accepted architecture](../../learning-evidence-and-review-scope.md) records the resulting constraints; its technical choices are not independent authority to add product behavior.
