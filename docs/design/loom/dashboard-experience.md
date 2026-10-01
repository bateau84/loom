---
type: design
title: Loom Operator Dashboard Experience
description: A session-aware overview of current work with independent Sessions, Workflows, Work, and Projects views.
tags: [design, loom, dashboard, control-panel, ux, ui]
---

**Status:** proposed — design-first draft; screens below describe the target, not implemented UI.

## Experience goal

Opening the dashboard should answer:

> What is everything doing, how does it connect to the work, and does anything need me?

The user should not need to understand Loom's record layout or open each project/session to answer that question. Keep technical diagnosis available, but put current work and its relationships first.

## Mental model

Use several linked views of the same state, not one forced containment tree:

| Object | What the user needs to know |
| --- | --- |
| Host instance | Which observed OpenCode runtime is available? |
| Session | Which conversation/agent is doing or waiting for what? |
| Workflow | Which execution steps and sessions are working together? |
| Work | Which outcome, Plan, Phase, Wave, and Task does this advance? |
| Project/worktree | Where does the work belong? |

A host can expose multiple sessions. A workflow can involve multiple sessions. A session can participate in successive workflows; current membership and history are separate. Several workflows can contribute to one Objective. A chat-only session can have no workflow. A Task/Change can exist without a full Objective Plan.

Parent-child session links describe real OpenCode relationships. They do not imply different terminal windows. Instance and session counts must not pretend to count UI windows.

## Navigation

Primary navigation is **Overview · Sessions · Workflows · Work · Projects**. Installation/project/status filters are visible and persist across cross-links where compatible. A project is a useful grouping, not a mandatory first click.

### Overview

Show three connected areas:

1. **Needs you / Blocked:** concrete reason, affected work, responsible session, and the next supported action or a direct link. Normal automated waiting is separate. Do not label every OQ/check as a user decision.
2. **Sessions now:** observed root sessions with expandable children, current role/activity, project, workflow, Task/step, and last observation. Unbound sessions are included. An optional flat list exposes every child without changing counts.
3. **Workflows and work:** current workflows with relevant Task progress and Plan links, shown once per stable identity. Full Objective progress is labelled separately from a workflow's own scope.

An illustrative row, not live data:

```text
Session                 Project     Activity                 Work
Dashboard work          loom        Waiting for child        Workflow: dashboard
  Worker                loom        Running tests            Task: session inventory
  Reviewer              loom        Idle                     Step: review implementation
Backend handoff         api         Waiting for your answer  Workflow: auth contract
Ideas                   leash       Idle                     No workflow
```

Only render those activity words when supported by the corresponding observations. A ready review step with no session yet belongs in the workflow's **Ready next** section, not as an invented Reviewer session.

The header distinguishes **observed host instances**, **root sessions**, **child sessions**, and **workflows**. Each count states scope/freshness where needed. Overview can be concise, but no eight-row cutoff may strand the rest: show **View all** with the full known count and any coverage limitation.

### Sessions

List actual sessions, independent of workflow existence. Support current/history, project, role, and activity filters plus title/ID search. Use stable IDs internally; show short IDs only as a disambiguator.

Session detail contains:

- actual title, project/worktree, observed host association, parent, and children;
- observed execution state and observation time, with current versus last-observed agent clearly distinguished;
- current workflow/step/attempt and Plan/Task links when Loom records them;
- separately labelled previous workflows, attempts, and recent activity;
- explicit missing-source or incomplete-history notices.

A prior failed workflow does not paint the whole current session failed. Multiple verified current activities are displayed as a set, not collapsed to a guessed single active agent. Session navigation never changes agent bindings.

### Workflows

List workflows directly across projects. Distinguish current work from history without requiring cleanup.

Workflow detail shows the request, its workflow state, **Running now**, **Waiting**, **Ready next**, completed/failed steps, and all participating sessions. Every running row links to the exact session and step attempt. Show the reason/source for a wait; unknown is acceptable when the source does not record it.

Place the related Plan and Task scope beside the execution view. Questions, required verification, budget, Product Acceptance, and knowledge status remain reachable. Only unresolved items that change progress should dominate the summary. Technical revisions, publishers, and evidence provenance are a diagnostic disclosure.

Workflow completion is not presented as Objective completion. A planning-only workflow is explicitly labelled and does not claim implementation progress.

### Work

Make durable work a primary view rather than an **Advanced work map**. Show:

```text
Objective → current Plan → Phase → Wave → Task
                                Task ↔ workflow ↔ session / step attempt
```

Keep the hierarchy readable: expand current/blocked work by default; let the user collapse phases and switch to a flat Task list. Plan goal, current revision, progress, and invalidation state are visible without opening technical details.

Task detail exposes its intended result, acceptance criteria, dependencies, owner, current execution links, questions, and completed result/evidence references. Step attempts and workflow IDs are execution links, not substitutes for Task identity.

Standalone work uses its recorded structure and says **No full Plan** where appropriate. A shared Objective appears once even when two workflows reference it. Historical Plans/attempts remain reachable and are never counted as current work.

### Projects

Projects summarize sessions, workflows, and work for one canonical project/worktree. Paths disambiguate duplicate names. All the same global views can be filtered to this project; no separate hierarchy or competing counts are invented here.

## Interaction and status rules

Direct links target stable objects. Changing a workflow coordinator must not change the workflow's URL. Support existing `#/project/.../workflow/...` and `#/directory/.../session/.../workflow/...` links through compatibility routing. A child-session link opens that real child's detail rather than looking it up only among coordinator groups.

Back restores the prior list/filters and meaningful scroll position. Refresh preserves focus, selected identity, and open hierarchy nodes. If a target is removed, show its removal/unavailable state and a predictable return link; never select a similarly named replacement.

Keep these concepts separate:

| Label | Meaning |
| --- | --- |
| Running | Fresh host activity supports execution now. |
| Idle | The host explicitly reports the session idle. |
| Waiting | A recorded wait reason exists; show what or whom it waits for. |
| Ready next | Loom says a step can be dispatched; it may not have a session yet. |
| Stale / activity unknown | Activity is missing, expired, unsupported, or disconnected. |
| Complete / failed / cancelled | State of the named workflow or work object, not of every related session. |

A fresh dashboard poll or publisher heartbeat does not make old activity current. Display status with text and icons as well as restrained color. At 320 CSS pixels, use labelled stacked rows, not horizontally overflowing tables. Core functions must not depend on hover.

## History, cleanup, and privacy

History is a view/filter, not a requirement to delete records. Preserve the existing explicit, confirmed deletion of terminal failed/cancelled workflows and its server-side protections. It does not cancel live work, modify project files, remove retained evidence, or delete host sessions. Keep the confirmation dialog keyboard accessible and preserve its focus behavior.

Titles/activity summaries are bounded, escaped, and redacted. Do not fetch full transcripts to populate an overview row. Missing titles get an honest short-ID label, not a title copied from an unrelated workflow. Model/token/cost details and opt-in output previews are secondary to the operational overview.

## Validation and implementation boundary

[BR-018](../../requirements/loom/br-018-external-operational-dashboard.md) owns behavioral acceptance. The [operator-model specification](../../architecture/loom/specs/dashboard-operator-model.md) defines data sources, relationships, delivery slices, and the multi-instance test matrix.

Validate the resulting product by navigating from Overview to a child's current Task and its Plan, then back, and by identifying the concrete blocker without opening all sessions. The six-instance fixture must also include a chat-only session and a stale source. A pleasant mockup alone does not prove live session coverage or truthful status.
