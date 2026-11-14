---
type: Behavioral Requirement
title: BR-006 — Evaluate accumulated work automatically
description: Process new eligible engineering evidence in Loom without recurring manual retrospective commands.
tags: [learning, automation, evaluation, requirements]
timestamp: 2026-11-12T00:00:00Z
---
# BR-006 — Evaluate accumulated work automatically

**Priority:** Must. **Status:** Proposed for independent requirements assessment; not an implemented or verified runtime capability.

**Statement:** When an authorized execution environment and preconfigured evaluation resources are available, Loom shall automatically identify and process eligible new or stale engineering evidence without requiring a user-triggered retrospective, manual Session exports, or manually authored links for each run.

**Acceptance criteria:**
- Eligible evidence from parent/child Sessions and associated prior work is discoverable for evaluation, including work that became inactive through failure or interruption rather than normal idle.
- Opportunistic idle-time processing may prepare provisional reports but never equates Session idle or a Coder handback with verified objective completion.
- If no qualified native access, permission or authorized model route/budget is available, the work remains inspectably pending or blocked; no unqualified paid fallback or forged report occurs.
- Following interruption or a later eligible execution opportunity, previously unprocessed evidence can be resumed without requiring the user to reconstruct its Session family manually.
- Routine normal engineering work remains usable when optional analysis is disabled, deferred or unavailable. Evaluator activity does not recursively cause unbounded self-evaluation.

**Verification semantics:** Start real engineering work, permit automatic evaluation and confirm subsequent evidence/report publication without invoking `/retro` or manually exporting/linking every Session. Repeat with no idle callback, model unavailability and disabled analysis; inspect truthful backlog and unchanged ordinary execution.

## Derived from
The user-approved intent for [PR #233](https://github.com/bateau84/loom/pull/233) is to preserve correct Session/dispatch/task evidence and make whole-work, multi-Session learning automatic. The [accepted architecture](../../learning-evidence-and-review-scope.md) records the resulting constraints; its technical choices are not independent authority to add product behavior.
