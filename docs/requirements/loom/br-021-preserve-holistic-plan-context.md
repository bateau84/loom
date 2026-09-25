---
type: requirement
title: BR-021 — Preserve Holistic Plan Context Across Handoffs
description: Objective planning remains a shared semantic model across General, implementation, review, QA, and peer-question handoffs.
tags: [requirement, loom, planning, context, handoff, oq]
---
**Status:** proposed

## Statement

For Planner-driven Objective work, Loom MUST preserve a durable holistic Plan that explains how accepted authority becomes executable work, and MUST project the relevant Plan/Task context into downstream fresh sessions without relying on General or another model to restate it from memory.

A Task is a bounded contribution to the accepted Objective. Its local outcome MUST NOT replace or narrow the parent accepted product meaning.

## Acceptance Criteria

1. A Plan generation records the goal, assumptions, exclusions, authority references, an explicit obligation coverage map, Phase/Wave/Task structure, material risk boundaries, whole-product acceptance coverage, cross-Task relationships, and correction routing. Executable Product Acceptance scenarios remain a separate Acceptance-owned control-plane object.
2. Every mandatory obligation has a source, non-blank disposition, owning Task/proof path when implemented, and explicit authority when deferred or marked out of scope.
3. Every planned Task records its bounded outcome, rationale, dependencies, accepted authority references, inherited constraints, falsifiable acceptance criteria, verification expectations, integration context, and optional non-executable subtasks/checklist.
4. Worker attachment exposes the focused Task contract together with parent Plan context and keeps mutation scope separate from semantic completion.
5. Reviewer and Critic can inspect the broader Plan and distinguish a producer defect from a decomposition/coverage defect.
6. Before a newly compiled Objective Wave is claimed or any planned Worker becomes runnable, an independent `review-plan` gate evaluates the holistic Plan together with the exact executable current-Wave contracts. The verdict is bound to the exact Plan generation/revision and executable Task-DAG fingerprint observed at Reviewer attachment and is rejected if either changes before completion. A failed Plan review leaves the Wave unclaimed and permits bounded Planner amendment/recompilation; only PASS authorizes the control plane to claim the Wave.
7. A mandatory accepted obligation with no owning Task/proof disposition is treated as a Planner coverage defect rather than normal Worker retry churn.
8. OQs raised from planned work retain Objective/generation/revision/Task correlation; any Loom responder receives the correlated Plan/Task context when available, and an OQ responder may raise a nested follow-up OQ to another role while preserving parent-OQ and affected-consumer provenance. Deferred legacy adoption MUST NOT disable Task-linked OQs; before a rich revision exists they retain Objective/generation/Task correlation and expose bounded legacy Task context.
9. Planner remains decomposition authority only. Plan fields compile accepted authority and never become new product/design/behavior/architecture authority.
10. Dependency handoff carries durable completed-predecessor result summaries and evidence-claim references, not only dependency IDs.
11. Bounded mid-plan corrections may amend only the affected pending/unclaimed Phase, Wave, Task, or Task subtask/checklist in the current generation, producing an immutable Plan revision and amendment record. Unaffected concurrent Wave DAGs remain executable when their semantic fingerprint is unchanged.
12. A local amendment MUST NOT retroactively rewrite semantic context already consumed by completed work. Such changes require a fresh Plan generation.
13. The current Plan generation can be explicitly invalidated without deleting history; invalidated work cannot execute further and replacement planning creates a fresh generation.
14. OQs may name any Loom role as responder. OQ answers from Reviewer/Critic are narrow answers, not gate verdicts, and General may raise coordinator OQs with explicit affected consumers when blocking.
15. Replanning preserves historical Plan generations rather than silently rewriting the semantic context of already executed work.
16. Dashboard and sidebar projections expose enough Plan identity/context to make current Phase/Wave/Task progress and correlated OQ origin understandable to humans without becoming workflow authority; historical OQs preserve bounded origin semantics from their immutable Plan revision rather than being relabeled with the latest Task meaning.
17. A pre-holistic active Objective with claimed or unfinished implementation work is detected as an Objective-scoped semantic upgrade action rather than mechanically fabricating missing Plan semantics; only the coordinator receives a short conditional notification, `loom_upgrade_status` carries the detailed one-shot procedure, fresh Planner attachment receives the pending action, and the action disappears automatically once authoritative state contains the rich Plan snapshot. A legacy Objective whose implementation work is already complete is not reopened solely to migrate representation while its final documentation/acceptance gates finish.
18. Runtime version fencing prevents older Loom writers from mutating shared state after the holistic-Plan compatibility release advances the canonical runtime version.

## Verification Semantics

Use deterministic control-plane tests to prove Plan validation, executable per-Wave limits, independent pre-execution Plan review, deferred Wave claim until review PASS, failed-review amendment/recompilation, immutable generation/revision history, per-Wave semantic freshness, surgical amendment safety, invalidation, bounded focused/full context projection, Task-contract equality, peer-OQ routing, revision-stable OQ correlation, runtime writer fencing, conditional upgrade notification, Objective-scoped upgrade detection, Planner handoff, and state-derived auto-completion. Use behavioral evals to prove Planner creates a sufficiently rich Plan and General/Reviewer/Critic classify an unowned accepted obligation as a planning gap instead of repeatedly retrying Worker.

## Derived from

- [BR-004 — Produce the Whole Product](br-004-produce-the-whole-product.md)
- [BR-005 — Prevent Implementation from Inventing Missing Meaning](br-005-prevent-implementation-inventing-meaning.md)
- [BR-008 — Bounded Autonomy and Progress](br-008-bounded-autonomy-and-progress.md)
- [BR-010 — Fresh Sessions Start from the Map](br-010-fresh-sessions-start-from-map.md)
