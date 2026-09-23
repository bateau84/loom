---
type: design
title: Loom Operations — Dashboard Refresh
description: Attention-led dashboard layout, progressive disclosure, navigation, display controls and validation criteria for the requested UI refresh.
tags: [design, loom, dashboard, ux, accessibility]
---

# Loom Operations — Dashboard Refresh

**Status:** implementation proposal for the user's requested dashboard redesign.

This refines [Dashboard Experience](dashboard-experience.md), within the accepted
Loom Anchor and the existing read-only projection boundary. It does not accept or
invent new backend capabilities, workflow authority, or telemetry. Independent
design/review approval is not implied by this document.

## Experience and reading order

The supplied workflow screenshot gives opaque session identifiers and publishers
most of the page while current work and operational signals have little visual
priority. The refresh answers three questions in order: **what needs attention,
what is happening, and where can I inspect it?**

Use an application workspace, not a marketing page: restrained graphite surfaces,
a mint navigation accent, compact typography and spacing, and semantic status
colors paired with text/symbols. Light, Dark, and System display themes use the
same information hierarchy. Do not decorate the interface with invented activity
charts, fabricated progress, or unavailable cost/model values.

### Fleet

Persistent navigation exposes Fleet, Needs attention, and named projects with
location cues. Project identity always uses the project ID for routing; matching
names never merge projects.

Fleet has labeled status, project and current-agent filters, followed by a
four-value summary and an urgency-ordered workflow list. Summary counts follow
project/agent filters but span statuses; this scope is explained immediately above
them. Summary buttons select the corresponding status while preserving other
filters. Counts describe the current bounded projection, not lifetime totals.

Order: consistency conflicts, failed work, blocked work, other open boundaries,
active work, completed work, other states, then stale history. Failed/blocked
stale work retains its failure priority and also displays its stale label.
Needs attention includes conflicts, unresolved state, failure/blocking, stale
sources, exhausted dispatch budgets, open questions and verification items.
These conditions may overlap; counts are not a causal diagnosis.

Each workflow shows project/work identity and status first, current agent/step
second, then real task and dispatch-budget counts, publisher participation, open
boundaries and activity age. Unknown values explicitly say Unavailable. A task
progress bar requires a valid numerator and positive denominator; it does not
estimate overall product readiness. The budget meter describes usage, not task
completion.

### Project and workflow

Project exposes the existing Objective → Phase → Wave → Task hierarchy and
workflow claims. Completed details remain available; active/blocked branches
start expanded. Bounded-history markers remain explicit.

Workflow leads with project/Anchor identity, state, and task/OQ/verification/budget
signals. Current and additional runnable steps are distinct from completed work.
A project work-map link preserves the containing project. The side panel shows
agent, stage, Product Acceptance, knowledge validity and last meaningful activity.
Owners, gate evidence and detailed blocker causes are not available in V1's
projection; say so instead of implying that counts explain why work stopped.

Use an objective title only from an explicit work-scope objective ID and matching
generation with a consistent projection. Otherwise use the Anchor filename/folder
as a display cue, retaining the full reference and workflow ID nearby. This is not
an inferred product title or an accepted Anchor mutation.

OpenCode sessions are secondary. Highlight only the explicitly projected active
session. Other sessions have generic membership labels and abbreviated IDs with
the full ID on the session page. More sessions use a native disclosure. Without
an active-session identity, show the first two members and disclose the remainder;
do not infer their roles or current activity. There is no synthetic direct link
to an external OpenCode UI without a projected safe locator.

Publisher IDs, revisions, leases and authority provenance use another disclosure.
On conflict, publisher information starts expanded and no resolved workflow
fields, progress or session membership are selected. Stale latest-known state is
separate from live-but-lagging participants; a live lower revision is not a winner.

## Interaction and recovery contract

Existing `#/project/{id}/workflow/{id}/session/{id}` links remain usable. Fleet
filters are encoded in its hash query. Typing replaces the current filter URL
without creating an entry per keystroke. Navigation creates history entries.
Reloading or opening a copied filtered URL restores filters; browser Back and
breadcrumb navigation return to the same filtered overview. Returning within the
page restores the previously focused item and scroll position where available.

Background updates do not reset filters, hierarchy/session disclosures, route or
focus. Identical project data need not replace the DOM. A changed projection
preserves keyed focus; disappearance moves focus to a remaining workflow or a
visible filter/main control and announces that change. Unchanged data is not
continually announced. Client memories are bounded, not an unbounded history.

Refresh is a display-only GET with bounded waiting and immediate button feedback.
Pause updates freezes display updates, including responses to automatic reads already in
flight. Explicit Refresh remains possible while paused; Resume requests current
data. None of these actions pause, start, resume or mutate Loom execution.
The delivery timestamp is labeled as projection receipt, not publisher health.

Distinguish loading, no discovered publishers, no projected workflows, filters
hiding everything, and unavailable projection. Failed/malformed refreshes retain
the last valid snapshot with a retry affordance, including a valid empty snapshot.
Successful retry clears degradation. Invalid hash syntax has a recovery link and
does not silently rewrite the address. Missing deep-link targets wait at the
requested URL: repeated reads do not prove deletion, and a later projection can
resolve the route without manual navigation.

## Accessibility and responsive behavior

Use native links, buttons, selects, details/summary and labeled progress/meter
semantics. Preserve browser zoom. All meaningful status has text, with color as
redundant emphasis. Aim at WCAG 2.2 AA: normal text at least 4.5:1; control/focus
boundaries at least 3:1; visible keyboard focus; skip navigation; logical reading
order; no keyboard trap; reflow at 320 CSS pixels. Automated checks alone do not
constitute a full accessibility-conformance claim.

Desktop uses persistent project navigation and two-column workflow detail. At
narrow widths navigation becomes a top region, Projects becomes a native
collapsed disclosure, and detail stacks vertically. Identity, status, current
work and recovery controls must not be hidden. Long paths/IDs wrap instead of
causing page-level horizontal scrolling. Respect reduced motion and forced colors.

## Implementation validation

Exercise the actual rendered interface, not only strings or design screenshots:

- Fleet triage, project/agent filtering, clear/no-results recovery, reloadable
  filtered URLs, keyboard drill-down, browser Back, and focus restoration;
- unchanged and changed background snapshots, manual disclosures, disappearance,
  projection lag, invalid URLs, HTTP/malformed responses, retry and bounded pause;
- same-revision conflicts, missing versus explicit-zero values, stale higher
  revision beside live lagging publication, and disabled supplemental telemetry;
- matching and mismatched work-scope generations and hostile projected text;
- Fleet/project/workflow at narrow and desktop sizes, both themes, expanded IDs,
  focus visibility, contrast, and real read-only HTTP behavior.

Real server/aggregation browser tests and isolated frontend fault-injection tests
prove different things. Report their evidence scopes separately. Screenshots use
seeded test/demo data, never claim to depict the user's live workflow state.
