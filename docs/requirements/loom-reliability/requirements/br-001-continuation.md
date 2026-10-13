---
type: requirement
title: BR-001 — Productive Continuation and Honest Waits
description: Unfinished states have truthful paths and feasible authorized goals remain continuable without reconstruction.
tags: [loom, reliability, continuation, resources]
---

# BR-001 — Productive continuation and honest waits

**Statement:**
Every reachable unfinished state shall expose an actually authorized next action, a genuine wait with owner and resumption condition, or a safe user-authorized exit. When the goal remains authorized and feasible within available resources, Loom shall support finite productive continuation or bounded recovery retaining applicable completed work; cancellation alone is not recovery.

**Acceptance criteria:**
- A next action is valid at its executing boundary, not merely suggested by a view. Circular prerequisites, repeated denials and cancel/restart instructions do not satisfy continuation.
- A continuation trace reaches useful remaining work or a necessary verification/decision boundary without manual state reconstruction, artificial completion/failure, resetting history/resource counters or repeated routine continuation prompts. Verification necessitated by changed inputs is not an unnecessary rerun.
- Waits identify missing decision, evidence, capability or resource, accountable owner and resumption condition/action. Missing expertise is not silently replaced by an unauthorized actor. Internal inconsistency is a defect, not an external wait.
- Before execution commitment of a finite Plan, check known minimum dispatch/capability/resource demand against authorized availability. Known insufficiency yields a bounded authorized alternative or genuine authorization/capability wait. Estimates remain distinct from unknown monetary cost and unforeseen later failures.
- Exhaustion preserves work/attempts/evidence; no overspend or unlimited retry is implied. Resolving a genuine wait resumes the applicable goal, not an unrelated reconstruction workflow.
- Safe exit requires actual user authority, retains history and revokes further admissions without claiming goal success or external-operation quiescence.

**Verification semantics:**
Show finite real traces for restart, failed-review repair, downstream revision and switching. At each stop verify the action is admitted or the owned wait has a remedy. Exercise insufficient resources/missing role and subsequent remedy/resumption. A mocked resolver or cancellation-only escape is insufficient.

**Derived from:**
- [Accepted Anchor](../../../anchors/loom-reliability/anchor.md), required outcomes and reliability gate.
- Specifier choice: finite traces and known-demand preflight distinguish progress from circular suggestions without unconditional success or automatic retry.
