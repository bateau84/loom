---
type: anchor
title: Changing Course Without Losing Progress
description: Foundational reliability and simplification milestone, including safe testing and recoverable upgrades.
tags: [loom, reliability, lifecycle, recovery, simplification]
---

**Status:** accepted by the user on 2026-10-09 through intent `f8e4dc05-0329-4dce-8458-bd610b6e9b92`, with exact confirmation: "i Accept the anchor as it sits now." Immediate scope is specialist discovery, revised authority and an independently reviewed delivery plan; product implementation is not authorized by this phase.

## Goal

Make changes of direction, Plan revision, interruption and workflow switching normal supported journeys. Reduce the number of ways Loom becomes stuck by removing duplicated authoritative facts and unnecessary coordination, not by adding a parallel recovery system.

## Independent acceptance gates

1. **Reliability:** real representative journeys complete through Plan changes, interruptions, failed reviews and workflow switching without losing applicable work, manual state reconstruction, artificial recovery steps or repeated routine continuation prompts.
2. **Simplification:** the architecture demonstrably removes duplicated maintained facts, redundant decisions and unnecessary coordination. A cleaner interface hiding unchanged contradictory bookkeeping does not satisfy this gate.

Execution, current applicability, independent review and product acceptance remain distinct facts. For each authoritative record, identify the unique fact it owns and why that fact cannot instead be derived.

## Required outcomes

- Every reachable unfinished state exposes an authorized next action, a genuine wait with owner and resumption condition, or a safe user-authorized exit. When the goal remains authorized and feasible within available resources, continuation or bounded recovery preserves applicable completed work; cancellation is not a substitute for recovery.
- For the same result, consumer contract and relevant input versions, preservation, attachment, dispatch and completion use the same applicability decision. Preserved historical execution is not universal current approval.
- Plan meaning has one authoritative source. Execution-specific settings may remain separate; another model-authored copy of the same Task contract is not required.
- Existing authorized answers and their evidence are retrievable through stable references independently of notification delivery. Consumers record how material answers affect their obligations; information transport does not require a new decision.
- Historical attempts, evidence and independent judgments remain truthful. Missing proof, interrupted operations and unknown external outcomes are not converted to success.
- Historical user work, accepted decisions, original attempts, evidence and review receipts remain attributable and recoverable. Continuity of those facts does not require preserving current internal APIs, storage formats, tools or architectural mechanisms; specialists determine a simpler preservation boundary.
- Shared-file ownership is handled honestly through isolation or explicit handoff; named-file commits alone do not prove authorship of mixed changes.

## Safe testing and recovery

- Tests and development verification must not access or mutate production Loom databases or runtime state, including before imports, setup and subprocess initialization. Define an independently enforced boundary and prove it with synthetic instances and failure cases.
- A controlled upgrade has a verified recovery point before it begins, preserves all durable Loom state acknowledged before the upgrade begins and pauses new work admissions during the upgrade. A backup of an already-broken installation is useful evidence but does not substitute for that pre-upgrade recovery point.
- Failed-upgrade rollback restores the protected pre-upgrade state with compatible code and safe writer fencing; specialists determine the mechanism and treatment of already-running operations.
- Distinguish rollback of one failed migration transaction from rollback of a whole controlled upgrade. Earlier successfully committed migration steps need not disappear when a later transaction fails; the release-level recovery guarantee must be specified and tested separately.
- Isolation proof must not open production databases to compare their bytes. Use synthetic sentinel state and independently observed access restrictions; specialists determine decisive proof without making a production read part of the test oracle.
- Manual recovery remains usable when Loom or its plugin cannot start. A restore must never silently discard newer work; any such loss requires explicit user confirmation.
- Code rollback, schema/data recovery and already-issued external effects are distinguished. Restoring Loom state does not imply external effects were undone; unresolved outcomes remain visible.
- Discovery and planning do not authorize live production upgrades, rollback, database reads or unsafe host test execution.

## Representative acceptance journeys

1. Complete Tasks A and B; introduce unrelated work in another session and a controlled shared-file change; revise/split downstream C; interrupt and restart; correct a failed review; resolve a routine permission boundary; finish the Objective without unrelated repetition or bypassed gates.
2. Start an intent interview; leave a question unanswered; abandon that intent; perform a different request in the same conversation without fake acceptance.
3. Begin A; pause A; begin B; cancel B; return to A with preserved applicable work and honest in-flight outcomes.
4. Demonstrate isolated verification and failed-upgrade/manual recovery against synthetic installations, including an installation whose plugin cannot start.

Measure manual state repairs, unnecessary reruns and dispatches, contradictory decisions, Loom-caused blocking, unresolved operation outcomes and removed duplicate decisions. Separate genuine external waits, necessary user decisions and newly required verification from internal reliability failures. Merged corrections alone do not prove a representative journey completed.

The separate discovery PR's 26 journeys and 16 installation/recovery scenarios are a coverage catalogue, not an automatic requirement to execute every permutation before discovery can proceed. Specialists select and justify decisive probes against both independent gates and expose any remaining coverage limits.

## Current phase and authority

Specialist discovery establishes fact ownership, removable or derived states, contradictory admission rules, historical-evidence and independent-review boundaries, safe verification/recovery feasibility, and incident-derived tests. Appropriate owners may replace existing requirements, designs, architecture, obligations and user stories rather than treating current mechanisms as mandatory. Backward compatibility is not required.

Candidate A (one transactional fact model with derived projections) remains a provisional hypothesis alongside competing alternatives, not accepted architecture. Specialists must falsify and compare it, demonstrating removal of duplicate writable facts rather than merely relocating them.

Replacing an architectural mechanism within accepted product authority belongs to its professional owner. Changing user-owned goals, scope, guarantees or accepting material risk remains a user decision; architecture choices must not become unnecessary user approval questions.

Further specialist assessment must be verified cost-free or separately authorized for paid inference before dispatch. Discovery permission is not spending permission. No paid inference budget has been granted for this milestone; unknown billing is not evidence of zero cost.

The phase concludes with reviewed authority and an independently reviewed holistic delivery plan covering both acceptance gates. Implementation needs subsequent authorization. No additional planned-role expansion or adapter completion is a prerequisite by default.

## Exclusions and preserved context

- No product implementation, production-state operations or live upgrade/rollback in this phase. Paid inference remains prohibited unless separately and explicitly budget-authorized by the user.
- No fabricated evidence, ownership, receipts or passing checks; no automatic loss of live user data.
- Adapter workflow `4e22715d-c930-4a7e-a721-c3f2247ece3c` was cancelled with explicit user authorization on 2026-10-09. Its work remains incomplete and unaccepted; history is preserved, not a completed milestone. References to that workflow as active in the separate discovery documents are outdated.
- Existing staged files `scripts/loom-oci-test-adapter.py` and `scripts/test_loom_oci_adapter.py` remain untouched, uncommitted and untested by this work.
- User-supplied audits at `df5bd5d` identify 46 workflow families and 24 failure modes; these counts are not 24 reproduced runtime defects. Source-only discovery found repeated contract authoring, inconsistent validity boundaries and no coordinated backup/restore in its bounded inspection. Real journey and recovery evidence remains required.
- Draft PR #168 on `discovery/foundational-continuity-20261009` supplies two separate discovery inputs: `change-without-losing-progress.md` and `continuity-journeys.md`, based on `7f0ddd14`. General read them remotely; they are not merged, edited or accepted by this local draft. Their hypotheses and candidate tests do not authorize implementation or spending.

## User-owned decisions

The user accepted the milestone direction and two independent gates, authorized cancellation of the superseded adapter workflow, permitted replacing current authority without backward compatibility while requiring continuity of attributable historical work and proof, and answered **yes** to preserving acknowledged pre-upgrade durable state, pausing new work during upgrade and prohibiting silent loss of newer work during manual recovery. The user accepted the five discovery refinements recorded here and explicitly required separate authorization before any paid specialist inference. Full Anchor acceptance was recorded on 2026-10-09 from the exact confirmation: "i Accept the anchor as it sits now."
