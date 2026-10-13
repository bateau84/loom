---
type: design
title: Loom Control Panel Experience
description: Human-facing information architecture for understanding and cleaning up Loom work outside OpenCode.
tags: [design, loom, dashboard, control-panel, ux, ui]
---

**Status:** proposed

**Accepted scope boundary:** Per user resolution of OQ `3fb7f28b-e116-4765-9366-d2a84c9f7222`, working-directory/session/workflow views are in scope for read-only inspection; the sole dashboard mutation in this design is explicit-confirmation removal of terminal failed/cancelled workflow records. Workflow/Objective plan-only may be shown as a reviewed intermediate outcome; dashboard presentation does not grant execution authority.

## Experience goal

Loom should feel like a **control panel for the user's work**, not a cockpit for Loom internals.

The first screen should answer, in plain language:

- Where am I working?
- Which sessions exist there?
- What is happening in a session?
- Does anything need me?
- Which workflow is responsible?
- Can obsolete failed work be removed?

Runtime concepts such as revisions, publishers, dispatch budgets, and agent internals remain available for diagnosis, but they do not define the primary navigation.

## Mental model

The primary containment hierarchy is:

```text
Working directory
└── Session
    └── Workflow
        └── Steps / agents / diagnostics
```

A working directory is the stable context the developer recognizes. A session is the conversation/work context in that directory. A workflow is execution machinery inside a session.

A small conversation may never create a workflow. Conversation-only OpenCode activity has no Loom control-plane state and is therefore outside this control panel until Loom state exists. A projected Loom session may contain more than one workflow.

## Primary pages

### Control panel

The home page shows:

1. working directories;
2. recent sessions;
3. sessions that need attention.

It does not lead with workflow counts, publisher counts, revisions, or budgets.

### Working directory

A directory page shows:

- canonical directory path;
- recent sessions in that directory;
- a small summary of active and failed work;
- the Objective → Phase → Wave → Task work map as a read-only advanced disclosure rather than the default content.

### Session

A session page is the main work page.

It shows:

- session title/goal when known;
- working-directory context;
- workflows contained in the session;
- simple workflow states: active, blocked, failed, complete, cancelled;
- open questions or other user-relevant boundaries;
- a cleanup action only when terminal failed/cancelled workflow records are present.

### Workflow

Workflow detail remains available for diagnosis. It can expose execution stages, OQs, verification, budget, Product Acceptance, participating sessions, publishers, and technical IDs as read-only information.

This is drill-down information, not the default product model.

## Workflow cleanup

The user may explicitly remove terminal failed/cancelled workflow records from the operational view.

Deletion is available for **terminal failed or cancelled workflows**.

The interaction must:

1. show which workflows will be deleted;
2. explain that project files are not changed;
3. explain that retained evidence and completed work are not deleted;
4. require an explicit confirmation action;
5. remove the confirmed terminal workflow records from normal operational views after success;
6. not delete project files, retained evidence, or completed work;
7. if eligibility or completion is uncertain, state that uncertainty rather than claim success or failure.

Deletion is intentionally different from cancellation:

- **Dashboard inspection** is read-only and does not start, resume, cancel, answer, or otherwise authorize execution.
- **Delete** removes only explicitly selected and confirmed terminal failed/cancelled workflow records; it is not cancellation and does not remove project files, retained evidence, or completed work.

## Planning-only outcome

The dashboard may display a reviewed Plan and the associated planning workflow's outcome as read-only context. When the user asked for planning only, show that the planning workflow is complete and its Plan was reviewed, while making clear that the product Objective is not thereby complete and implementation has not been authorized or performed. A later implementation request is a distinct authority transition; no dashboard Plan display or review action creates it.

## Progressive disclosure

Default pages show human concepts first.

Advanced state belongs behind drill-down or disclosure:

- Objective/Phase/Wave/Task plan details and the distinction between reviewed planning outcome and product completion;
- publishers and projection freshness;
- workflow revisions and internal IDs;
- dispatch budget;
- agent/step diagnostics;
- provenance.

A warning or count may surface at a higher level when it changes the user's next action.

## Interaction rules

- Browser Back preserves the directory → session → workflow path.
- Existing legacy workflow deep links remain valid during migration.
- Background refresh does not steal focus or replace the selected object with a similarly named object.
- If an object disappears after cleanup, navigation returns predictably to its session or directory.
- Status is expressed with text/icon semantics, not color alone.
- Destructive actions are keyboard reachable and use a modal confirmation with focus trapping/native dialog behavior.
- Narrow layouts collapse to one column without hiding required actions behind hover.

## Empty and failure states

Distinguish:

- no working directories projected;
- directory with no sessions;
- session with no workflows;
- no failed/cancelled workflows to clean up;
- stale/offline projection;
- consistency conflict;
- missing optional telemetry.

Unknown values are never shown as healthy zero.

## Visual direction

The control panel should be quiet.

Use:

- generous spacing;
- simple lists instead of dense cards when possible;
- one clear primary action per context;
- restrained status color;
- technical details only when requested.

Avoid dashboard decoration whose only purpose is to make the page look busy.

## Validation scenarios

Designer validation should cover:

1. developer switches among several working directories and resumes a recent session;
2. one session contains several workflows and their relationship is immediately clear;
3. several eligible terminal failed/cancelled workflow records are removed in one explicitly confirmed cleanup action;
4. active workflow deletion is unavailable/refused;
5. project files remain unchanged after workflow cleanup;
6. stale projection and consistency conflict remain understandable;
7. keyboard-only directory → session → workflow → back navigation;
8. modal open/close/cleanup-confirmation focus behavior;
9. 320 CSS-pixel narrow layout without horizontal overflow;
10. a reviewed Plan-only workflow is visibly distinct from Objective/product completion and confers no implementation authority;
11. technical diagnostics remain reachable without dominating normal use.
