---
type: design
title: Loom Dashboard Experience
description: Human-facing information architecture and interaction design for monitoring concurrent Loom work outside OpenCode.
tags: [design, loom, dashboard, ux, ui, observability]
---

**Status:** proposed

## Experience goal

Give one operator a trustworthy, low-friction overview of many simultaneous OpenCode+Loom activities across unrelated repositories without forcing them to inspect each OpenCode TUI.

The dashboard is for **orientation, triage, and drill-down**, not workflow control.

## Primary scenarios

1. **Fleet scan** — determine what is active, blocked, failed, stale, or awaiting verification across all current projects.
2. **Project focus** — inspect one project's Objective → Phase → Wave → Task progress and active workflows without losing project identity.
3. **Workflow diagnosis** — understand where a workflow is, what is runnable/current, which gate is next, and why progress is blocked.
4. **Session context** — optionally inspect model/provider, activity, token/cost/message statistics, and a bounded recent-output preview without confusing OpenCode telemetry with Loom truth.
5. **Stale-instance recognition** — immediately distinguish offline/stale publishers from live but idle work.

## Information hierarchy

The default view prioritizes exceptions over volume:

1. critical consistency conflicts / failed work;
2. blocked work and open user/OQ boundaries;
3. open verification and budget pressure;
4. currently active/runnable work;
5. healthy recent work;
6. stale/offline historical compartments.

Project and workflow identity remain visible whenever detail is shown so similarly named tasks from different repositories cannot be mistaken for one another.

## Information architecture

The dashboard uses one primary containment hierarchy:

```text
Fleet
└── Project
    └── Workflow
        ├── Objective → Phase → Wave → Task progress
        └── Session telemetry (supplemental cross-link)
```

Rules:

- **Fleet** is the orientation/triage entry point; it is not organized by OpenCode process because users think first in projects/workflows that need attention.
- **Project** groups durable Loom work under one project identity/location.
- **Workflow** is the main operational-detail unit because it owns execution stage, gates, OQs, verification, budgets, Product Acceptance, and participating sessions.
- **Session telemetry** is a secondary related view, not a parent of Loom workflow truth. One workflow may have several participating sessions/instances.
- Every detail view exposes a persistent location trail equivalent to Fleet → Project → Workflow, with a semantic Back action that returns to the prior overview without losing filter/sort context.
- Cross-links may open a participating session or project, but must keep the current project/workflow identity visible so users never lose compartment context.

## Fleet view

One compact row/card per active or recent workflow compartment.

Required visible information:

- project name/location cue;
- objective/workflow label;
- current stage and current agent/step;
- hierarchical progress summary;
- state badge: active, blocked, failed, complete, stale/offline, or consistency conflict;
- open OQ count;
- open verification count;
- budget pressure/exhaustion indicator;
- last meaningful activity;
- instance participation/freshness.

The first screen should answer: **What needs my attention, and where is everything else?**

## Project view

Show:

- project identity/location;
- Objective → Phase → Wave → Task hierarchy;
- current Plan generation/revision and concise Plan goal;
- Phase/Wave intent;
- expandable Task detail for outcome, constraints, acceptance criteria, subtasks/checklist, integration context, and completed result;
- obligation, risk-boundary, and Product Acceptance coverage;
- Plan amendment/invalidation history;
- task/wave progress;
- active claims/workers;
- OQs visibly attached to their originating Task/Plan when correlated, preserving bounded historical Phase/Wave/Task context after amendments and routing to the originating workflow;
- workflows participating in the project;
- current gates and recent transitions;
- project-level stale/conflict indicators.

Completed hierarchy remains available but should not visually dominate active or blocked work.

## Workflow view

Show:

- accepted objective/Anchor reference;
- current execution stage;
- current and runnable steps;
- recent completed/failed transitions;
- Reviewer/Critic/Acceptance position;
- OQs, their answering role/status, and their originating Plan generation/revision/Task when correlated;
- verification requirements;
- dispatch budget state;
- Product Acceptance summary;
- knowledge-sync validity;
- participating OpenCode sessions/instances.

Where detail comes from OpenCode rather than Loom, label it as supplemental.

## Session enrichment panel

Optional and secondary.

May show:

- session title;
- provider/model;
- message/tool counts;
- token/cache/cost information when available;
- timestamps;
- bounded recent assistant output preview when enabled.

The panel must visually distinguish telemetry from Loom workflow state. Missing enrichment is a degraded detail panel, not a dashboard failure.

## Interaction contract

- Selecting a fleet item drills into its Project or Workflow detail without discarding the fleet filter/sort state.
- Filtering supports project, status, current agent, blocked/failed, stale/offline, and active/recent dimensions. A filter change updates results without moving keyboard focus unless the focused item disappears.
- Background refresh updates values in place. It must not steal focus, collapse the current drill-down, reset filters, or silently move selection to a different workflow with a similar name.
- If the selected item disappears because its publisher expires or retention removes it, selection moves predictably to the nearest remaining peer or to the parent view, and the UI announces that the previous item is no longer available.
- A semantic Back action returns Workflow → Project → Fleet and restores the prior selection/filter context.
- A direct path to the OpenCode session is available only when a safe session locator exists. Opening it is navigation to another tool, not a Loom state mutation.
- V1 exposes no workflow mutation control. Read-only fields must not look editable or actionable.

No interaction may imply that changing the dashboard changes Loom state.

## Flow coverage

### Flow: fleet triage

**Goal:** identify the most urgent Loom work and understand why it needs attention.

**Preconditions:** at least one valid projection is discoverable, or the dashboard can state that none is available.

1. Enter Fleet view.
2. Scan urgency-ordered workflow rows/cards with project identity visible.
3. Optionally filter/sort without losing the currently focused item.
4. Select one workflow needing attention.
5. Enter Workflow detail with the same project/workflow identity visible.
6. Return with Back; the previous fleet filter/sort and selection are restored.

**Exit states:** attention item understood; no matching work; no Loom instances; selected item became unavailable.

### Flow: project/workflow diagnosis

**Goal:** understand where one workflow is blocked or what runs next.

1. Enter Project or Workflow detail from Fleet.
2. Inspect Objective → Phase → Wave → Task progress and current/runnable steps.
3. Inspect OQ, verification, budget, Product Acceptance, knowledge, and gate summaries.
4. If more execution context is useful, follow a participating-session cross-link.
5. Return to Workflow, Project, or Fleet without losing compartment identity.

**Recovery:** stale-source, consistency conflict, or missing enrichment remains visible as a state of the current view rather than ejecting the user.

### Flow: optional session telemetry

**Goal:** inspect OpenCode-derived context without mistaking it for Loom authority.

1. Enter a participating session panel from Workflow detail.
2. Read model/provider/activity/token/cost/output data only when available.
3. Missing/disabled fields display `unavailable` / `not enabled`, never zero by implication.
4. Return to Workflow with the Loom-authoritative summary unchanged.

### Flow: stale/conflict investigation

**Goal:** understand whether the dashboard's latest-known view is trustworthy.

1. Select a stale-source or consistency-conflict workflow.
2. See the latest-known workflow revision, participating instances, each participant's liveness/revision, and the conflict/staleness explanation.
3. If a live participant is lagging a stale higher revision, show both facts; do not silently choose the lower revision.
4. Offer only observational navigation (for example, to a participating OpenCode session when available), never a dashboard-side repair action.
5. Return to the previous view with state preserved.

## States and recovery

### Loading

Show stable skeleton/placeholder regions; do not temporarily present missing data as healthy zero.

### Empty

Distinguish:
- no Loom instances discovered;
- instances discovered but no active/recent workflows;
- filters hiding all matching workflows.

### Stale/offline

Retain the last complete snapshot, visibly mark its age and stale/offline state, and never imply it is current.

### Consistency conflict

If two publishers report the same workflow revision with incompatible state, surface a prominent conflict state and the participating instances. Do not guess a winner.

### Projection/enrichment error

Keep last known Loom projection when valid and clearly mark the failing source. OpenCode enrichment failure should degrade only enrichment.

### Unknown / unavailable

Unknown, disabled, and explicit zero are different user-visible states.

- a missing token/cost/message count is shown as unavailable/unknown, not `0`;
- disabled output preview is shown as not enabled, not empty output;
- an unavailable enrichment source does not make the Loom workflow look healthier or more complete;
- missing Loom-authoritative fields are treated as projection/schema degradation, not guessed from OpenCode telemetry.

## Accessibility

- all status meaning must have text/icon semantics, not color alone;
- keyboard navigation must cover fleet rows/cards, filters, project/workflow drill-down, and back navigation;
- focus position remains predictable after refresh;
- live updates must not steal focus or constantly re-announce unchanged content;
- counts and progress expose accessible labels;
- tables/cards preserve meaningful reading order at narrow widths;
- contrast and state indicators must meet the project's chosen accessibility baseline.

## Surface constraints

V1 should be optimized for desktop monitoring because it complements a desktop terminal workflow, while remaining usable at narrower widths through progressive disclosure.

High-frequency updates should not cause visual reflow that makes active rows move unpredictably. Sorting by urgency may update when state materially changes, but the UI should preserve selection/focus.

## Visual semantics

The visual system communicates operational meaning without inventing a specific framework or token palette:

- consistency conflict and failed states have the strongest attention hierarchy; blocked, verification/budget pressure, active/runnable, healthy recent, and stale/offline follow in that order;
- every state uses a text label and icon/symbol; color is redundant emphasis only;
- Loom-authoritative state and OpenCode-derived telemetry occupy visibly different sections/labels so provenance can be understood at a glance;
- stale-source state always includes age/freshness text, not just a dimmed style;
- unavailable/unknown values use an explicit unavailable treatment rather than a numeric zero;
- selection/focus styling is distinct from severity/status styling;
- narrow layouts preserve status, identity, and current-stage meaning before optional telemetry is collapsed;
- visual motion, if used for refresh, must communicate change without causing row-jump or violating reduced-motion preferences.

Exact colors, typography tokens, component library, and frontend framework remain implementation choices unless later accepted design work makes them product-significant.

## Design boundary

This design does not choose snapshot transport, persistence, lock mechanism, project identity representation, OpenCode database schema, frontend framework, or backend topology.

Those are Architecture concerns. The design requires only that the implementation expose the states/interactions above reliably and preserve the read-only/non-authoritative boundary.

## Verification

Designer validation of the realized dashboard should exercise:

- several simultaneous repositories with similar task names;
- at least one blocked workflow, one active workflow, one stale/offline instance, and one completed workflow;
- a same-revision consistency conflict;
- missing OpenCode enrichment;
- keyboard-only Fleet → Project/Workflow → optional Session → return with filter/focus preservation;
- background refresh while a focused row remains stable and while the focused row disappears;
- stale highest-revision source beside a live lagging participant;
- missing/disabled enrichment and explicit zero values shown distinctly;
- narrow layout;
- clear distinction between Loom-authoritative state and OpenCode-derived telemetry.
