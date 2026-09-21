---
type: requirement
title: BR-018 — External Operational Dashboard
description: Loom exposes a safe read-only operational view across concurrent projects, sessions, workflows, and OpenCode instances.
tags: [requirement, loom, dashboard, observability, operations]
---
**Status:** proposed

## Statement

Loom MUST expose enough read-only operational state for a dashboard outside the OpenCode TUI to show concurrent Loom work across repositories and OpenCode instances.

The dashboard is an observer, not an authority source or workflow controller.

Loom state remains authoritative in the control plane. Optional OpenCode database enrichment MAY add statistics, model/session metadata, or transcript-derived presentation, but MUST NOT determine Loom workflow truth.

## Acceptance Criteria

1. The dashboard can distinguish instance, project, OpenCode session, workflow, Objective, and active work scope.
2. It can show at least workflow state, current/runnable step, the Objective → Phase → Wave → Task hierarchy and hierarchical progress, open OQs, open verification requirements, dispatch-budget state, Product Acceptance state, and last meaningful activity.
3. Multiple simultaneous repositories appear independently even when their local Anchor/Task names are identical.
4. Stale/offline instances are visibly stale/offline rather than silently merged into live state.
5. The dashboard cannot mutate Loom workflow, authority, evidence, OQs, budgets, or completion state through the observation interface.
6. Optional OpenCode DB data is read-only and clearly classified as supplemental presentation/telemetry.
7. Secrets, credential material, raw hidden prompts, and unrestricted tool output are not exported by default.
8. Failure of the dashboard or observability projection does not block Loom execution.
9. Snapshot publication is versioned and atomic: a dashboard reader never combines fields from different generations, and stale/offline status is derived from an explicit publication lease/expiry rather than guessed from missing activity.
10. The default fleet view makes failed/blocked/conflicting/stale work distinguishable from healthy active work without opening each session.
11. The dashboard supports overview-to-project/workflow drill-down while keeping project/workflow identity visible enough to distinguish similarly named work.
12. Loom-authoritative workflow state and optional OpenCode-derived telemetry are visibly distinguishable.
13. Status meaning is not encoded by color alone, and core overview/drill-down navigation is keyboard-operable.
14. Missing, disabled, or unavailable telemetry is represented as unknown/unavailable and MUST NOT be rendered as a healthy zero or inferred success.
15. Background refresh preserves the user's current selection, filter/sort context, and keyboard focus when that target still exists; disappearance has a predictable fallback rather than an arbitrary focus jump.
16. Fleet → Project → Workflow → optional Session detail forms a complete navigable path with a clear return path and persistent project/workflow identity; the dashboard has no navigation dead end that requires restarting it.

## Design and architectural realization

Human-facing behavior is defined by [Dashboard Experience Design](../../design/loom/dashboard-experience.md).

Technical realization is defined by [Dashboard Observability](../../architecture/loom/dashboard-observability.md), the [Dashboard Projection Transport](../../architecture/loom/decisions/dashboard-projection-transport.md) decision, and the [Dashboard Projection Specification](../../architecture/loom/specs/dashboard-projection.md).

## Verification Semantics

Use at least two simultaneously active Loom/OpenCode instances or isolated instance fixtures with different projects and workflows.

Valid proof shows a single dashboard view with correct compartment identity and state, including one stale/offline instance.

Projection tests also exercise a writer update while a reader is polling: only complete generations are observable, an older generation cannot replace a newer one, and an expired `leaseExpiresAt` deterministically produces stale/offline status.

Attempted write operations through the dashboard observation surface must be unavailable or rejected.

Designer validation also exercises fleet triage, stale/offline and conflict presentation, authoritative-vs-enrichment distinction, missing-vs-zero semantics, refresh focus preservation, complete overview/drill-down/back flows, keyboard navigation, and narrow-layout behavior from the Dashboard Experience design.

## Derived from

- [Loom Anchor](../../anchors/loom/anchor.md)

## Depends on

- [BR-017 — Concurrent Sessions and Projects Are Compartmentalized](br-017-concurrent-sessions-projects-compartmentalized.md)
- [BR-007 — Evidence Outranks Model Claims](br-007-evidence-outranks-model-claims.md)
