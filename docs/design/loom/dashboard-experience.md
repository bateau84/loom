---
type: design
title: Loom Control Panel Experience
description: Human-facing information architecture for understanding and cleaning up Loom work outside OpenCode.
tags: [design, loom, dashboard, control-panel, ux, ui]
---

**Status:** proposed

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
- a route to **Manage workflows**;
- the Objective → Phase → Wave → Task work map as an advanced disclosure rather than the default content.

### Session

A session page is the main work page.

It shows:

- session title/goal when known;
- working-directory context;
- workflows contained in the session;
- simple workflow states: active, blocked, failed, complete, cancelled;
- open questions or other user-relevant boundaries;
- cleanup action when the session contains failed/cancelled workflow attempts.

### Workflow

Workflow detail remains available for diagnosis. It can expose execution stages, OQs, verification, budget, Product Acceptance, participating sessions, publishers, and technical IDs.

This is drill-down information, not the default product model.

## Workflow cleanup

Failed restart attempts create both visual clutter and stale control-plane state. The user must be able to remove them.

Deletion is available for **terminal failed or cancelled workflows**.

The interaction must:

1. show which workflows will be deleted;
2. explain that project files are not changed;
3. explain that retained evidence and durable completed work results are not deleted;
4. require an explicit confirmation action;
5. remove the deleted workflows from normal Loom views immediately after success;
6. remove stale workflow/session/control-plane bindings so the deleted attempts cannot interfere with later routing;
7. refuse deletion of active work;
8. refuse deletion when a durable completed-Wave review receipt still depends on that workflow record;
9. treat an interrupted/uncertain browser response as unknown rather than failed, and allow a safe retry without duplicating cleanup.

Deletion is intentionally different from cancellation:

- **Cancel** stops live work and releases execution authority.
- **Delete** removes an already-terminal failed/cancelled execution record from active Loom state.

## Progressive disclosure

Default pages show human concepts first.

Advanced state belongs behind drill-down or disclosure:

- Objective/Phase/Wave/Task plan details;
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
3. four failed restart workflows are deleted in one confirmed cleanup action;
4. active workflow deletion is unavailable/refused;
5. project files remain unchanged after workflow cleanup;
6. stale projection and consistency conflict remain understandable;
7. keyboard-only directory → session → workflow → back navigation;
8. modal open/close/confirmation focus behavior;
9. 320 CSS-pixel narrow layout without horizontal overflow;
10. technical diagnostics remain reachable without dominating normal use.
