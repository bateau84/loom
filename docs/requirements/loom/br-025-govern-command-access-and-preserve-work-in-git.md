---
type: requirement
title: BR-025 — Govern Command Access and Preserve Work in Git
description: Task-path-scoped command elevation with user-approved risk boundaries and truthful Git commit/push/pull-request outcomes.
tags: [requirement, loom, commands, git, authority]
---

# BR-025 — Govern Command Access and Preserve Work in Git

**Status:** proposed

## Statement

For governed work, Loom MUST provide task-scoped command access limited to that task's approved working paths. A rejected command may request elevation; execution may continue immediately only when the requested access is permitted without further approval. Commands that are materially destructive, host-wide, or outside the task's approved working paths MUST require explicit User approval; General cannot grant such access without that approval. Git operations MUST be available through command elevation. Agents MUST commit their work during progress and push those commits to origin when an origin is available. At conclusion General or an agent MAY create a pull request when an origin exists; missing origin and failed push/PR outcomes MUST be reported truthfully.

## Acceptance Criteria

1. A rejected command can request elevation for the assigned task, identifying the requested command authority and the working paths it requires. Granted authority is limited to those paths and the approved task; it does not authorize unrelated paths or tasks.
2. An eligible request confined to the task's approved working paths may be granted and continue immediately when no further approval is required. A request outside those paths is not silently included in task scope.
3. A materially destructive, host-wide, or out-of-approved-path command cannot execute until the User explicitly approves that command and its requested risk/scope. General may route/request approval but cannot substitute its own approval. Absent, declined, or ambiguous approval leaves the command unexecuted and not reported as successful.
4. Git operations, including repository-changing operations, can be requested through command elevation and remain bounded by the same approved task paths and user-approval boundaries.
5. Agents commit completed work during progress. When an origin is available, they push progress commits to it; when no origin is available, the local commit remains and status says it was not pushed. A failed/unavailable commit or push is reported accurately; a committed-but-unpushed change is not represented as pushed or lost.
6. At conclusion, General or an agent may create a PR when an origin exists. If origin is absent or PR creation fails, the workflow reports that outcome truthfully and does not claim a PR was created.
7. Command elevation does not grant product-scope authority or waive the explicit User approval required by criterion 3.

## Verification Semantics

Observe a rejected command request for elevation and verify granted commands are confined to the task's approved working paths. Verify an in-path eligible request can continue immediately, while materially destructive, host-wide, and out-of-approved-path commands remain blocked until explicit User approval and remain blocked if denied; General cannot substitute its approval. Verify Git operations use the same path/risk boundaries. During implementation, observe progress commits pushed when origin is available; exercise missing origin and failed push, confirming the local commit and an accurate not-pushed outcome. At conclusion, exercise PR creation with available origin, missing origin, and failed creation, and verify no false success claim.

## Derived from

- User-confirmed command and Git decisions in this authority-reconstruction workflow's follow-up requests (workflow `ca09d181-c4d2-4f75-b58e-47704451fdc2`, Specifier; 2026-09-28; no separate OQ ID supplied): elevation is limited to the task's approved working paths; materially destructive, host-wide, and out-of-approved-path commands require explicit User approval; Git operations are available through elevation; agents commit during progress and push to origin when available; missing origin and failed push outcomes are reported truthfully; General or an agent may create a PR when work concludes and origin exists.
- Accepted Loom Anchor, especially AC 2, 8, 10, 12, 14, and 24 (bounded autonomous progress, evidence, recovery, and inspectability).
