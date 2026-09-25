---
type: requirement
title: BR-018 — External Operational Control Panel
description: Loom exposes a safe local control panel across working directories, sessions, workflows, and OpenCode instances.
tags: [requirement, loom, dashboard, control-panel, observability, operations]
---
**Status:** proposed

## Statement

Loom MUST expose enough operational state for a local control panel outside the OpenCode TUI to let a developer understand current work using the hierarchy **Working directory → Session → Workflow**, while retaining deeper workflow diagnostics when needed.

The projection remains observational and non-authoritative. A narrowly bounded control path MAY delete terminal failed/cancelled workflow execution records so stale attempts do not clutter the UI or interfere with future agent routing.

Loom state remains authoritative in the control plane. Optional OpenCode database enrichment MUST NOT determine Loom workflow truth.

## Acceptance Criteria

1. The primary user-facing hierarchy is Working directory → Session → Workflow; internal steps/agents/diagnostics are subordinate.
2. The home view lists working directories, recent sessions, and sessions needing attention without requiring workflow-level inspection.
3. A directory view lists its sessions and provides an advanced route to the durable work map.
4. A session view lists contained workflows and their plain-language state.
5. Workflow detail retains current/runnable steps, OQs, verification, budget, Product Acceptance, knowledge status, work hierarchy, publisher freshness, and technical provenance when projected.
6. Multiple repositories remain independently identifiable even when task/workflow names match.
7. Stale/offline and same-revision consistency-conflict state is explicit and never silently normalized.
8. Missing/unavailable telemetry is unknown/unavailable, never a healthy zero or inferred success.
9. Projection publication remains versioned, bounded, atomic, and independent of Loom execution availability.
10. Status meaning is not encoded by color alone and core navigation/actions are keyboard operable.
11. Background refresh preserves focus and current navigation context when the target still exists.
12. Legacy dashboard deep links remain valid while the new directory/session hierarchy is introduced.
13. A user can delete one or more terminal failed/cancelled workflows from the control panel after explicit confirmation.
14. Workflow deletion MUST NOT modify files in the working directory.
15. Workflow deletion removes the workflow's execution record, stale session bindings, live work claims, dispatch grants, OQs, scopes, budgets, and other routing/control records that could affect later work.
16. Evidence observations/claims and completed durable work results are retained.
17. Active/non-terminal workflows cannot be deleted; they must be cancelled first.
18. A workflow that owns durable completed-Wave review history cannot be deleted.
19. A durable deletion record prevents stale publisher snapshots from reintroducing a deleted workflow into the visible control panel.
20. The mutation endpoint is separate from projection files, is host-local, requires same-origin browser intent plus an unguessable per-server control token, and fails closed.
21. Cleanup failure does not alter project files or silently report success.
22. Secrets, credential material, raw hidden prompts, and unrestricted tool output are not exported by default.

## Verification Semantics

Proof includes:

- at least two working directories and multiple sessions;
- directory → session → workflow drill-down and return;
- stale-source and consistency-conflict fixtures;
- four failed workflow attempts deleted in one confirmed action;
- a rejected active-workflow deletion;
- retained evidence after deletion;
- released claims/session bindings after deletion;
- stale projected workflow hidden by the deletion record;
- POST cleanup rejected without the same-origin token;
- narrow-layout and keyboard validation.

## Design and architectural realization

Human-facing behavior is defined by [Loom Control Panel Experience](../../design/loom/dashboard-experience.md).

Technical realization is defined by [Dashboard Observability and Control](../../architecture/loom/dashboard-observability.md), the [Dashboard Projection Transport](../../architecture/loom/decisions/dashboard-projection-transport.md) decision, and the [Dashboard Projection Specification](../../architecture/loom/specs/dashboard-projection.md).

## Derived from

- [Loom Anchor](../../anchors/loom/anchor.md)

## Depends on

- [BR-017 — Concurrent Sessions and Projects Are Compartmentalized](br-017-concurrent-sessions-projects-compartmentalized.md)
- [BR-007 — Evidence Outranks Model Claims](br-007-evidence-outranks-model-claims.md)
