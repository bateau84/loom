---
type: Behavioral Requirement
title: BR-009 — Present controlled system-improvement recommendations
description: Produce inspectable recommendations without self-authorizing changes to canonical agent systems.
tags: [learning, improvements, authority, requirements]
timestamp: 2026-11-12T00:00:00Z
---
# BR-009 — Present controlled system-improvement recommendations

**Priority:** Must. **Status:** Proposed for independent requirements assessment; not an implemented or verified runtime capability.

**Statement:** Based on supported whole-work evidence, Loom shall make qualified findings and optional improvement recommendations inspectable while leaving consequential changes to agents, skills or operating policy subject to their existing authorized engineering and user-decision process.

**Acceptance criteria:**
- The overall output distinguishes practices worth retaining, recurrent problems, data limitations, inconclusive observations and actionable candidate improvements, with links to original sources and prior recommendations when relevant.
- The system can report that there is insufficient evidence or no justified change; it is not required to generate a proposal after every idle Session or batch.
- Evaluator/retrospective conclusions cannot directly modify canonical skills, agent directives, global configuration or project code, activate live variants, or count their own analyses as independent engineering objectives.
- Prior accepted or rejected proposals remain identifiable for later comparisons without being silently re-raised or promoted as effective merely because they were applied.
- Users can inspect the state/coverage and stop or defer automatic analysis under the established operator policy without disabling ordinary engineering work.

**Verification semantics:** Present a qualified retrospective with a positive practice, contrary evidence and an unverified candidate, then attempt an unapproved instruction mutation or paid dispatch. Confirm no change occurs. Run a window with insufficient evidence and verify an honest non-recommendation can be saved and read.

## Derived from
The user-approved intent for [PR #233](https://github.com/bateau84/loom/pull/233) is to preserve correct Session/dispatch/task evidence and make whole-work, multi-Session learning automatic. The [accepted architecture](../../learning-evidence-and-review-scope.md) records the resulting constraints; its technical choices are not independent authority to add product behavior.
