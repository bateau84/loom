---
type: requirement
title: BR-018 — External Operational Control Panel
description: Loom exposes a safe local control panel across working directories, sessions, workflows, and OpenCode instances, including the user-directed Archive/Permanent Delete lifecycle.
tags: [requirement, loom, dashboard, control-panel, observability, operations]
---
**Status:** proposed

## Statement

Loom MUST expose enough operational state for a local control panel outside the OpenCode TUI to let a developer inspect work through **Working directory → Session → Workflow**, including deeper workflow diagnostics when needed. Inspection is read-only: viewing any directory, session, workflow, Plan, status, or evidence MUST NOT itself authorize or perform workflow execution or planning mutations.

The control panel MUST expose Archive for any workflow and Permanent Delete from Archived view, according to the lifecycle guarantees in [BR-026](br-026-archive-or-permanently-delete-workflow-records-safely.md). An Active workflow MUST first be cancelled and its authority to continue work revoked before Archive or Permanent Delete. Archive may remove the workflow from the default view while unresolved in-flight-operation uncertainty remains only when Archived view retains an explicit uncertainty marker and relevant evidence. Permanent Delete requires explicit user confirmation and confirmed quiescence. Neither action may modify project files, retained evidence/provenance, or completed work. Loom state remains authoritative in the control plane. Optional OpenCode database enrichment MUST NOT determine Loom workflow truth.

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
14. Archive is available for any workflow. If the selected workflow is Active, it must first be cancelled and its authority to continue work revoked; cancellation alone does not delete or archive it. Archive then removes it from the default view and keeps it available in the separate Archived view.
15. In every workflow state, unresolved in-flight-operation uncertainty is visible with relevant evidence. Archive may hide an uncertain workflow from the default view only if its Archived view entry preserves the explicit uncertainty marker and relevant evidence; an archived or cancelled state does not imply quiescence.
16. Permanent Delete is available only from Archived view and only after explicit user confirmation of permanent record removal and confirmed quiescence of all previously admitted external operations. If confirmation or quiescence is missing or uncertain, the workflow remains archived and its uncertainty/evidence remains available.
17. Archive and Permanent Delete MUST NOT modify project files, retained evidence/provenance, or completed work. Evidence observations/claims, question answers and source attribution, and completed durable work remain unchanged and attributable to the workflow after its record is permanently deleted.
18. Workflow cleanup removes routing/control records that could cause a removed workflow to affect later work, including active question-routing state, without deleting the protected historical evidence/provenance in criterion 17.
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
- Archive attempts against workflows in each lifecycle state, verifying Active workflows are first cancelled/revoked and archived workflows disappear from default view while remaining in Archived view;
- unresolved in-flight operations represented with an uncertainty marker and relevant evidence across workflow states, including after cancellation and in Archived view;
- Permanent Delete rejected until both explicit confirmation and confirmed quiescence exist, then removes the workflow record from current and Archived views;
- retained evidence, answered-question provenance, source attribution, completed work, and project files after archive and permanent deletion;
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
- Earlier user resolution of dashboard scope in OQ `3fb7f28b-e116-4765-9366-d2a84c9f7222` (read-only inspection; terminal failed/cancelled cleanup only). This remains the historical answer to that earlier OQ and is not rewritten by this requirement.
- Later user decisions in intent OQs `16d3ec71-209a-480d-91c3-35a114f84b17` and `bd7d6b42-c822-4c9c-9fd0-882badb4aa41`, user answer to OQ `b3232418-978f-4209-bdbe-68f3c26814a1`, and the user's explicit all-workflow update in the authority-reconstruction workflow (2026-09-29; no separate OQ ID supplied): Archive/Permanent Delete may cover all workflows with Active cancellation, retained uncertainty/evidence, Permanent Delete confirmation/quiescence, and protection of files/evidence/provenance/completed work.

## Authority and Current-Implementation Status

This BR remains **proposed** and does not itself accept or replace a revised Loom product Anchor. The earlier terminal-only OQ above remains historical provenance; the newer explicit user updates are incorporated as the proposed behavioral direction, not silently attributed to that older answer. Current source/design evidence describes cleanup only for terminal failed/cancelled workflows and identifies `plugins/loom/workflow-cleanup.ts` as deleting OQ records (including answered content and attribution). Therefore current source does not establish all-workflow Archive/Permanent Delete or conformance with retention of all evidence/provenance. This is a source-backed implementation gap, not a claim about deployment or runtime incidence; see the [authority reconstruction experience assessment](../../design/loom/authority-reconstruction-experience.md#cleanup-current-implementation-vs-user-approved-boundary).

## Depends on

- [BR-017 — Concurrent Sessions and Projects Are Compartmentalized](br-017-concurrent-sessions-projects-compartmentalized.md)
- [BR-007 — Evidence Outranks Model Claims](br-007-evidence-outranks-model-claims.md)
