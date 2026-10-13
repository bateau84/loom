---
type: requirement
title: BR-025 — Govern Command Access and Preserve Work in Git
description: Effect- and ownership-based command elevation for authorized work, with explicit user authorization at ownership boundaries and truthful Git publication outcomes.
tags: [requirement, loom, commands, git, authority]
---

# BR-025 — Govern Command Access and Preserve Work in Git

**Status:** proposed

## Statement

For governed work, Loom MUST retain restrictive default command admission while permitting an agent to request task-scoped elevation for any operation needed to complete or recover authorized work; no command or Git operation is permanently unavailable solely because of its name. Admission MUST be based on the operation's actual effects and established workflow ownership, not a command-name classification. Bounded elevation MAY proceed without further User approval only when the operation's effects are within both the workflow-authorized scope and Loom-owned/recoverable state. Explicit User authorization MUST precede an operation whose effects cross that ownership/risk boundary—including effects on unrelated user data, shared or others' branches, or host-wide state—or when ownership or recoverability cannot be established. General cannot substitute its approval for the User's at that boundary. Elevation does not itself expand product authority or task scope. Git operations needed for authorized work MUST be requestable through elevation and preserve exact authorship and provenance. Agents MUST commit their work as it progresses and push those commits to origin when available. At conclusion General or an authorized agent MAY create a pull request when an origin exists; missing origin and failed commit, push, or PR outcomes MUST be reported truthfully.

## Acceptance Criteria

1. A rejected operation needed for the assigned work or its recovery can request elevation, identifying the requested operation, scope, and expected effects. The request and admission remain bounded to authorized work; elevation does not silently add product scope or authorize unrelated tasks.
2. Admission is decided from actual effects and established ownership/recoverability, not operation spelling or a permanently denied command-name list. Restrictive defaults remain, but an operation is not permanently unavailable solely by name.
3. If actual effects are bounded within workflow-authorized, Loom-owned/recoverable state, the operation may be automatically elevated even when commonly described as destructive. For example, removing owned generated files, aborting/resetting Loom's own failed rebase, or using force-with-lease on a Loom-owned delivery branch does not require User approval solely because the action is destructive-looking, provided its effects are in fact contained and recoverable.
4. Explicit User authorization is required before effects reach unrelated user data, shared or others' branches, host-wide state, or any state whose ownership or recoverability cannot be established. Without approval, the operation remains unexecuted; absent, declined, or ambiguous approval is not success. General may route/request approval but cannot substitute its own approval.
5. Git operations needed for authorized work can be requested through elevation. Any admitted Git operation preserves exact authorship/provenance and is governed by the same actual-effects boundary; e.g. effects on a shared/other-owned branch require User authorization even if the command would otherwise be scoped.
6. Agents commit their work as it progresses. When an origin is available, they push progress commits to it; when no origin is available, the local commit remains and status says it was not pushed. A failed/unavailable commit or push is reported accurately; a committed-but-unpushed change is not represented as pushed or lost.
7. At conclusion, General or an authorized agent may create a PR when an origin exists. If origin is absent or PR creation fails, the workflow reports that outcome truthfully and does not claim a PR was created.

## Verification Semantics

For representative operations, observe requested scope and actual effects, the established ownership/recoverability basis, admission outcome, and resulting state. Confirm that an operation name alone never makes it permanently unavailable; restrictive defaults deny until eligible elevation is granted. Confirm that removing Loom-owned generated files, aborting/resetting Loom's own failed rebase, and force-with-lease to a Loom-owned delivery branch can proceed without User approval when observed effects remain within authorized, recoverable state. Contrast operations affecting unrelated user data, shared/others' branches, or host-wide state, and cases with unestablished ownership/recoverability: each must remain unexecuted until explicit User authorization; General approval alone is insufficient. Verify elevation does not widen task/product scope and that Git authorship/provenance remains exact. During implementation, observe progress commits pushed when origin is available; exercise missing origin and failed commit/push, confirming accurate outcomes and that committed-but-unpushed work is neither misreported nor lost. At conclusion, exercise PR creation with available origin, missing origin, and failed creation, and verify no false success claim. Current runtime must be assessed separately: the Anchor records that requested command/Git elevation and this effect-based admission behavior are intended, not a claim that current implementation supports them.

## Derived from

- Accepted Loom Anchor, especially AC 2, 8, 10, 12, 14, 24, 34, and 35. AC 34 fixes effect-/ownership-based admission, bounded elevation, and the explicit-authorization boundary; AC 35 fixes Git authorship, progress publication, PR, and truthful outcome expectations.
- User-resolved intent `73f613dd-8e61-4f22-b5ed-af4495c4440c`: no command/Git operation is permanently unavailable solely by name; bounded automatic elevation is appropriate for effects within authorized Loom-owned/recoverable state; explicit User authorization applies across the ownership/risk boundary or when ownership/recoverability cannot be established. Concrete effects-based examples and cross-boundary cases are included above.

## Current implementation status

This is a proposed requirement, not a statement of current capability. The accepted Anchor records that the current Plan-to-Worker compiler still routes executable Plan Tasks to Worker and that the role-aware design is proposed; the requested command/Git elevation and effects-based admission must not be represented as implemented until observed. The remaining publication criteria state the accepted target behavior, not proof of deployed support.
