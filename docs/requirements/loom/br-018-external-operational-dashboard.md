---
type: requirement
title: BR-018 — External Operational Control Panel
description: A complete operator overview of observed OpenCode instances, sessions, workflows, plans, tasks, and current work across projects.
tags: [requirement, loom, dashboard, control-panel, observability, operations]
---
**Status:** proposed — operator-overview revision; not implemented by this documentation change.

## Statement

Loom MUST expose a local operator dashboard that answers **what is happening across all observed instances, sessions, workflows, plans, and tasks**, without requiring the user to navigate through each working directory first.

Sessions, workflows, and durable work are related objects, not a mandatory Working directory → Session → Workflow containment tree. Projects are available as filters and groupings. The primary views are **Overview, Sessions, Workflows, Work, and Projects**.

The dashboard is the human's cross-workflow view. It MUST NOT grant agents visibility or execution authority outside their existing project/workflow bindings. Display projections remain observational and non-authoritative. Existing bounded workflow cleanup remains a separate canonical control path.

OpenCode is the source for host session identity and observed execution activity. Loom is the source for workflow/step bindings, work ownership, Plans, Tasks, and completion. Optional cost/model/output enrichment MUST NOT determine Loom truth.

## Overview and relationships

1. Overview exposes current sessions and workflows across the selected installation/project scope, their present work, relevant Plan/Task progress, and actionable blockers. It offers direct detail links rather than forcing a directory/session drill-down.
2. Instances, root sessions, and child sessions are counted separately. A window, publisher, host process, session, and workflow are not interchangeable. Counts deduplicate stable identities and state their coverage.
3. Sessions are first-class records. Conversation-only, idle, unbound, root, and child sessions remain discoverable when reported by the host. A missing workflow does not hide a session.
4. Session detail shows its actual title and parent when available, its current workflow/step/attempt and activity, and separately its historical participation. It does not invent a session from a workflow ID or treat an old failure as current session failure.
5. Workflow detail shows all known participating sessions, their roles and exact step/attempt relationships, runnable versus executing work, blockers, and links into the relevant Plan/Task. A workflow is not forced under one representative session.
6. Work is a primary view: Objective → current Plan → Phase → Wave → Task. It shows ownership and relevant session/workflow links. Standalone Tasks/Changes and work without a Plan remain visible with their actual available structure; no synthetic Objective or Plan is required.
7. Multiple workflows can contribute to one Objective. Workflow completion, Task completion, and Objective completion remain distinct. Invalidated/superseded Plans and prior attempts remain identifiable as history rather than disappearing or inflating current progress.
8. Projects and worktrees remain independently identifiable even when names and local IDs match. Project pages summarize all three views: sessions, workflows, and work.

## Truthfulness, coverage, and usability

9. Ready to dispatch is not running. A live publisher is not a busy session. The current agent/session is never chosen from the first runnable step or alphabetically sorted participants.
10. Observed session execution state, workflow state, publisher freshness, and work progress are separate values with attributable sources. Missing or expired activity evidence is unknown/stale, not idle, complete, failed, or zero.
11. Overview separates **Needs you**, **Blocked**, and ordinary automated waiting. An unresolved internal question or a future verification step alone does not establish a need for user intervention.
12. The default view emphasizes current work; complete and failed history remains reachable without deletion. Every shortened list offers a visible count/coverage notice and a way to reach the remaining records. Pagination never silently omits active work or breaks a selected object's links.
13. Completeness is relative to the reported installation/host inventory and capture window. Disconnected sources, unsupported host metadata, pre-observation history, filtered results, and genuinely empty inventories are distinct. The dashboard does not claim to discover every terminal window or machine.
14. Stale/offline sources and same-version consistency conflicts are explicit. No invented winner or cross-publisher field merge is used to manufacture a healthy result.
15. Publication remains versioned, bounded, atomic, and independent of execution availability. Paged reads remain tied to a stable generation and report invalidated cursors rather than silently mixing generations.
16. Status has text/icon meaning, not color alone. All primary navigation, filters, hierarchy expansion, links, and existing cleanup controls are keyboard operable, including at 320 CSS pixels.
17. Refresh preserves selection, focus, expansion, filters, and meaningful scroll position. Browser Back restores the previous view. Object identity does not change when its title or role changes.
18. Legacy workflow/session deep links remain valid. Workflow, session, and work links are direct and do not require inventing a parent session. An unresolved legacy link shows an honest unavailable state.

## Preserved cleanup and privacy requirements

19. A user can delete one or more terminal failed/cancelled workflows after explicit confirmation. Deletion is not cancellation, and neither is required merely to hide history from the current-work view.
20. Workflow deletion MUST NOT modify project files. It removes the execution record and stale routing/control state, including owned claims, grants, OQs, scopes, budgets, and bindings still pointing to that workflow.
21. Evidence observations/claims and completed durable work results are retained. Active/non-terminal workflows and workflows owning durable completed-Wave review history cannot be deleted.
22. Durable deletion records prevent stale publishers from resurrecting deleted workflows. A host session remains visible if it still exists, even when its workflow was removed; the relationship is labelled removed/historical, not silently redirected.
23. The cleanup endpoint remains separate from projections, host-local, guarded by same-origin intent and an unguessable per-server token, revision checked, transactional, and fail-closed. Uncertain responses are not reported as success; retry remains idempotent.
24. Credentials, raw hidden prompts, full transcripts, and unrestricted tool output are excluded by default. Session titles, short activity labels, and authored summaries are bounded, escaped, and redacted. Output previews remain opt-in.
25. Dashboard reads create no bindings, dispatches, workflow/Plan mutations, or execution approvals. Remote exposure still requires an authenticated private access layer; local visibility is not agent authorization.

## Verification semantics

Acceptance requires the [operator-model scenarios](../../architecture/loom/specs/dashboard-operator-model.md#acceptance-scenarios), including six independent host instances, several roots and children, multiple projects, a session without a workflow, two workflows contributing to one Plan, and missing/stale activity data.

Use real host observations to verify instance/session enumeration and execution activity. Synthetic fixtures can prove aggregation and navigation behavior, but cannot prove that the pinned OpenCode host supplies the required events. Browser checks must exercise production projection/aggregation/routes and preserve the existing cleanup, conflict, privacy, and keyboard regressions.

This document defines the target behavior. It is not evidence that the dashboard already implements it.

## Design and architectural realization

- [Control Panel Experience](../../design/loom/dashboard-experience.md)
- [Dashboard Observability and Control](../../architecture/loom/dashboard-observability.md)
- [Operator Model, Delivery Slices, and Acceptance](../../architecture/loom/specs/dashboard-operator-model.md)
- [V1 Projection Compatibility Contract](../../architecture/loom/specs/dashboard-projection.md)

## Derived from

- [Loom Anchor](../../anchors/loom/anchor.md)
- User clarification: the dashboard should provide the complete human overview across sessions/workflows; agent isolation is not a reason to hide this view.

## Depends on

- [BR-017 — Concurrent Sessions and Projects Are Compartmentalized](br-017-concurrent-sessions-projects-compartmentalized.md)
- [BR-007 — Evidence Outranks Model Claims](br-007-evidence-outranks-model-claims.md)
