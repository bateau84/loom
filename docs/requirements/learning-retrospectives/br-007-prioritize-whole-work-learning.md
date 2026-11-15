---
type: Behavioral Requirement
title: BR-007 — Prioritize whole-work and longitudinal learning
description: Evaluate complete work trajectories across Sessions rather than treating local handbacks as independent successes.
tags: [learning, retrospectives, objectives, requirements]
timestamp: 2026-11-12T00:00:00Z
---
# BR-007 — Prioritize whole-work and longitudinal learning

**Priority:** Must. **Status:** Proposed for independent requirements assessment; not an implemented or verified runtime capability.

**Statement:** Loom's primary retrospective shall evaluate the broader available work trajectory across related attempts, reviews and Sessions, using incremental local reports as revisitable evidence rather than as independent success scores.

**Acceptance criteria:**
- A complete linked goal with several corrections, handbacks, reviews and final verification is represented as one linked objective trajectory, not one objective per agent or Session; several genuinely distinct goals in a Session remain separable when source evidence supports them.
- A retrospective can examine multiple Sessions and eligible objectives, including positive practices, failed attempts, corrective work, later counterevidence and prior recommendations, without averaging local task verdicts into a whole-work verdict.
- Recorded results, independent verification, inferred associations and author-reported claims remain distinguished. A later finding may change the present interpretation without rewriting earlier events.
- Apparent recurring patterns never claim independent originating objectives when that independence cannot be established by the trusted host/source; the system may still deliver qualified descriptive summaries.
- Recommendations explain the observed mechanism, supporting and contradicting evidence, applicability and uncertainty; observed correlation is not asserted to prove causal effectiveness.
- A positive-practice claim that an observed skill, instruction or method contributed to an outcome requires established **source chronology** placing the observation before that outcome. Post-outcome or unknown-order observations may remain descriptive, but cannot independently support an unqualified beneficial-practice conclusion. Even established pre-outcome exposure does not prove causality.

**Verification semantics:** Evaluate an objective with three Coder handbacks and failed/failed/passed verification across several Sessions, plus another separately evidenced objective. Require a coherent trajectory rather than three invented successes. Place a skill-load observation after the source-dated success and another with unavailable original event time; neither may independently support an unqualified positive-practice explanation even when ingested before retrospective analysis. Repeat with different Session IDs but unknown originating-request independence; trend claims stay qualified.

## Derived from
The user-approved intent for [PR #233](https://github.com/bateau84/loom/pull/233) is to preserve correct Session/dispatch/task evidence and make whole-work, multi-Session learning automatic. The [accepted architecture](../../learning-evidence-and-review-scope.md) records the resulting constraints; its technical choices are not independent authority to add product behavior.
