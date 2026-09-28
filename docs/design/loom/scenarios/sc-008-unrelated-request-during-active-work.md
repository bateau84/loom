---
type: design
title: SC-008 — Receive an unrelated request while work is active
description: Keep competing conversational requests distinct and recoverable.
tags: [scenario, loom, conversation, recovery]
---

# SC-008 — Receive an unrelated request while work is active

**Context:** A developer has asked Loom to execute a bounded change. Before it finishes, they bring an unrelated urgent question or new task into the same conversational thread. The active work may include specialist handoffs and partially completed repository changes.

**Goal:** Address the new request without accidentally changing the first work's scope, losing its context, or leaving the person unsure whether either request is still running.

**Scenario:** Loom recognizes that the new request is unrelated rather than treating it as a refinement of the active objective. It addresses the specific active workflow by pausing it before turning to the unrelated request; it does not pause unrelated workflows or all activity globally. The two requests remain distinguishable, and the new request stays conversational unless execution is clearly requested. If the system cannot confirm that the first workflow paused, Loom says so and does not represent it as safely paused or as completed cancellation. Later, the person can return to that workflow and understand its last confirmed state, preserved changes/evidence, and safe next action.

**Failure / edge condition:** The new request is silently folded into the active Plan, unrelated work is also paused without request/authority, the selected workflow continues after a supposed pause, or an interruption leaves external/tool execution outcome uncertain. Do not conflate requests, overwrite accepted intent, or imply that a host stop request confirms cancellation or pause. Preserve completed work and provenance; state uncertainty and blockers plainly.

**Observable outcome:** The person knows which request Loom is addressing, whether the original work is still running or paused, what is preserved, and how to return without repeating or corrupting work.

**Derived from:** `US-001`, `US-003`, `US-005`; Anchor Acceptance Criteria 2, 13, 25 and the conversation-first principle. `conversation-first-experience.md` currently defines refinement of the active objective but not unrelated-request pause semantics. This scenario captures the requested handling of the specific active workflow only; it does not claim an existing pause mechanism or define a global interruption policy or host/runtime guarantees.
