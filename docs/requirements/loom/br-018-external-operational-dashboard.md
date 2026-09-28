---
type: requirement
title: BR-018 — External Operational Control Panel
description: Loom exposes a safe local control panel across working directories, sessions, workflows, and OpenCode instances.
tags: [requirement, loom, dashboard, control-panel, observability, operations]
---
**Status:** proposed

## Statement

Loom MUST expose enough operational state for a local control panel outside the OpenCode TUI to let a developer inspect work through **Working directory → Session → Workflow**, including deeper workflow diagnostics when needed. Inspection is read-only: viewing any directory, session, workflow, Plan, status, or evidence MUST NOT itself authorize or perform workflow execution or planning mutations.

The control panel MUST permit explicit-confirmation removal of terminal failed/cancelled workflow records, and MUST NOT extend that cleanup capability to active/non-terminal workflows or to project files, retained evidence, or completed work. Loom state remains authoritative in the control plane. Optional OpenCode database enrichment MUST NOT determine Loom workflow truth.

## Acceptance Criteria

1. The primary user-facing hierarchy is Working directory → Session → Workflow; internal steps/agents/diagnostics are subordinate.
2. The home view lists working directories, recent sessions, and sessions needing attention without requiring workflow-level inspection.
3. A directory view lists its sessions and provides an advanced route to the durable work map.
4. A session view lists contained workflows and their plain-language state.
5. Workflow detail retains current/runnable steps, OQs, verification, budget, Product Acceptance, knowledge status, work hierarchy, publisher freshness, and technical provenance when projected.
6. Multiple repositories remain independently identifiable even when task/workflow names match.
7. Stale/offline and same-revision consistency-conflict state is explicit and never silently normalized.
8. Missing/unavailable telemetry is unknown/unavailable, never a healthy zero or inferred success.
9. A malformed or otherwise unverifiable projection is never presented as valid current state. The dashboard retains a previously validated view, including a valid empty view, as last-known and communicates its freshness; if no such view exists, it communicates that the view is unavailable.
10. A projection shown as current represents one coherent observation; partial or unverifiable data is not combined with validated data and presented as current.
11. Status meaning is not encoded by color alone and core navigation/actions are keyboard operable.
12. Background refresh preserves focus and current navigation context when the target still exists.
13. Legacy dashboard deep links remain valid while the new directory/session hierarchy is introduced.
14. A user can remove one or more terminal failed/cancelled workflow records from the control panel only after explicitly confirming the selected target(s) and removal.
15. Workflow deletion MUST NOT modify files in the working directory.
16. Workflow cleanup removes routing/control records that could cause the removed workflow to affect later work, including its active question-routing state. It does not require erasing the historical answer/evidence provenance associated with those records.
17. Evidence observations/claims, question answers and their source attribution, and completed durable work results are retained unchanged and remain attributable to the removed workflow; cleanup does not delete or rewrite them.
18. Active/non-terminal workflows cannot be deleted; they must be cancelled first.
19. A removed workflow is not represented as current merely because an older observation still contains it.
20. Cleanup failure does not alter project files or silently report success. Rejection, partial/unavailable outcome, or uncertain response is not presented as successful removal.
21. Secrets, credential material, raw hidden prompts, and unrestricted tool output are not exported by default.
22. Directory/session/workflow, Plan, status, or evidence inspection does not authorize or perform execution, answer questions, grant authority, cancel work, or edit a Plan.

## Verification Semantics

Proof includes:

- at least two working directories and multiple sessions;
- directory → session → workflow drill-down and return;
- stale-source and consistency-conflict fixtures;
- malformed/unverifiable projection input with and without a previously validated view (including a validated empty view), proving it is never presented as current/healthy and the last-known view is retained with freshness state when one exists;
- four failed workflow attempts deleted in one confirmed action;
- a rejected active-workflow deletion;
- retained evidence, answered-question provenance, and source attribution after deletion;
- retained completed work and project files after deletion;
- released claims/session bindings after deletion;
- an older observation cannot make a removed workflow appear current;
- cleanup rejected or unchanged when explicit confirmation is absent or declined;
- inspection of directory, session, workflow, Plan, status, and evidence leaves canonical execution/planning state unchanged and grants no mutation authority;
- narrow-layout and keyboard validation.

## Design and architectural realization

Human-facing behavior is defined by [Loom Control Panel Experience](../../design/loom/dashboard-experience.md).

Technical realization is defined by [Dashboard Observability and Control](../../architecture/loom/dashboard-observability.md), the [Dashboard Projection Transport](../../architecture/loom/decisions/dashboard-projection-transport.md) decision, and the [Dashboard Projection Specification](../../architecture/loom/specs/dashboard-projection.md).

## Derived from

- [Loom Anchor](../../anchors/loom/anchor.md)
- User resolution of dashboard scope in OQ `3fb7f28b-e116-4765-9366-d2a84c9f7222` (read-only directory/session/workflow inspection; cleanup limited to explicitly confirmed terminal failed/cancelled workflow records, preserving project files, retained evidence, and completed work).

## Depends on

- [BR-017 — Concurrent Sessions and Projects Are Compartmentalized](br-017-concurrent-sessions-projects-compartmentalized.md)
- [BR-007 — Evidence Outranks Model Claims](br-007-evidence-outranks-model-claims.md)
