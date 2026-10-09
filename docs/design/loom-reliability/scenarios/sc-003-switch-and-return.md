---
type: design
title: SC-003 — Pause A, Cancel B, Return to A
description: Switch work while retaining progress and honest in-flight outcomes.
tags: [scenario, loom, lifecycle, recovery]
---

# SC-003 — Pause A, cancel B, return to A

**Context:** A developer works on A when B becomes urgent. An issued A operation may still be running.

**Goal:** Set A aside, work on B, leave B and resume A without replaying uncertain effects.

**Scenario:** The developer explicitly pauses A. Loom distinguishes requested pause from confirmed admission state and reports existing operations separately. At a safe switching boundary B begins under its authority. The developer cancels B; history and unfinished checks remain truthful. Returning to A shows retained usable work, changed inputs, outstanding operations and productive next action or genuine wait. Feasible authorized work continues without marking B complete.

**Failure / edge condition:** A's result is lost or B's late result arrives after cancellation. Never infer termination from pause/cancel or replay unknown external mutations. Inspect supported outcome evidence first; unresolved uncertainty names an owner and the condition needed to progress. B's result remains history, not revived execution. Switching A does not silently pause unrelated sessions.

**Observable outcome:** Current context, A's pause/return and B's cancellation are identifiable. Neither status nor conversation selection implies external quiescence. A returns to its authorized path without dummy success, resurrection or lost proof.

**Derived from:** [US-002](../user-stories/us-002-leave-and-return.md), Anchor journey 3; discovery J20/J22–J24. Lost-coordinator transfer is a further Architect/Acceptance probe, not a requirement to retain current bindings.
