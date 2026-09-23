---
type: design
title: Loom Operations — Dashboard Refresh
description: Attention-led dashboard layout, human-readable work context, progressive disclosure, navigation and validation criteria.
tags: [design, loom, dashboard, ux, accessibility]
---

# Loom Operations — Dashboard Refresh

**Status:** implementation proposal for the user's requested redesign and names-first readability follow-up.

This refines [Dashboard Experience](dashboard-experience.md) within the accepted
Loom Anchor and read-only observation boundary. The user explicitly requested
human-readable information rather than unexplained UUIDs. Routine presentation
choices implement that intent; independent review approval is not implied here.
The [readable context contract](../../architecture/loom/specs/dashboard-readable-context.md)
defines the bounded data extension used by the view.

## Experience and reading order

The screenshot gave opaque sessions and publishers most of the page. The redesign
answers **what needs attention, what is happening, and where can I inspect it?**
Graphite surfaces, a mint navigation accent, readable type, restrained spacing,
and text-labeled status colors serve an operations workspace, not a marketing
page. Light, Dark, and System themes share the hierarchy. Do not fabricate charts,
progress, model names, cost data, or execution activity to fill space.

## Names first, IDs on demand

Project names and location cues identify repositories. Work titles come from an
explicit same-generation task/wave/objective association, then the recorded user
request, then a readable Anchor filename/folder. Unknown names remain explicit:
Unnamed workflow, Unnamed task, or Workflow outside this view. A UUID, hash or
session identifier is not a display name. No title is borrowed across projects,
conflicting objective reports, or generations.

Same-named workflows in one project receive numbered Run labels. These are local
disambiguators for the current view, not durable titles. Routing always uses exact
IDs. A task's Owned by link resolves the actual workflow in its own project.
Unknown ownership targets retain an exact deep link with an honest fallback label.

Known internal step names have plain-language labels, such as Review implementation
or Update project documentation. Arbitrary step identifiers are never split into
an invented description. A stage must match an actual projected step; otherwise
say Stage details unavailable. Pending/runnable means eligible for dispatch, not
proof of active execution. The agent filter and context panel describe the next
available agent rather than claiming it is running.

Workflow/session/project/step/claim IDs, original Anchor references and internal
stage keys remain selectable under native Technical details disclosures. IDs are
not primary headings, breadcrumbs, ownership labels, or session link names.
Publisher IDs and conflict digests also remain behind technical disclosure.

## Fleet and project

Persistent navigation exposes Fleet, Needs attention, and projects with location
cues. Fleet has labeled status/project/next-agent filters, a four-value summary,
and urgency-ordered workflows. Summary counts follow project/agent filters across
statuses; their scope is explained. Counts cover the current bounded projection,
not lifetime work. Summary buttons select status without clearing other filters.

Order conflicts, failures, blocked work, other open boundaries, active work,
completed work, other states, and stale history. Failed/blocked stale work retains
its attention priority plus a stale label. Needs attention includes conflicts,
unresolved state, failures/blocking, stale sources, exhausted budgets, questions
and required verification. Conditions may overlap; a count is not a diagnosis.

Cards show named project/work identity and status, the next available step, real
task/budget counts, publisher participation, questions/checks and activity age.
Unknown counts say Unavailable. Task progress requires a valid numerator and
positive denominator and is not product readiness. Budget means agent dispatches,
not money or task completion. A bounded question scan marks its count At least.

Project exposes Objective → Phase → Wave → Task and named ownership links.
Completed branches remain available; active/blocked branches start expanded.

## Workflow and session context

Workflow leads with name, state and task/question/verification/budget signals.
Current and additional eligible steps stay distinct. Open questions show the
recorded question, answer owner and blocking flag. Awaiting your answer applies
only to an open user-owned question. An answered question says its affected steps
must apply or acknowledge the answer; it does not ask the owner to answer again.
Marked blocking applies to affected steps and is not automatically a whole-workflow
root cause.

Checks still needed shows each recorded requirement, the named gate it must precede,
and the requesting role. Failure summaries are explicitly Reported results, not
verified causal explanations. Descriptions and lists may be limited; say so. Missing
or incompatible context provides counts-only guidance and an update/restart hint,
never an empty-details-as-success claim. Zero open verification requirements is not
a claim that all tests passed. Resolve questions and supply evidence through Loom;
there are no dashboard mutation controls.

Sessions are secondary. The coordinator is labeled only by exact recorded creator
membership. Other members use Session 1, Session 2, etc., with the workflow name
alongside. These local labels are not fabricated session titles or inferred agent
roles. Legacy activeSessionId was an alphabetical locator, so the UI does not use
it as evidence of activity. Full IDs remain in each session's technical details.
Extra sessions use native disclosure; there is no guessed external OpenCode URL.

The side panel shows the next agent, translated stage, Product Acceptance, knowledge
validity, and activity time. Publisher/lease/provenance details remain available.
Conflicts select no workflow, title, question, or session-membership winner.
Stale highest-revision state remains separate from live lower-revision publishers.

## Navigation and recovery

Existing workflow/session deep links remain valid. Fleet filters are in its hash
query; typing replaces rather than appends history. Navigation creates history
entries. Reload/copy restores filters, and Back restores focus/scroll where possible.
Native technical/hierarchy/session disclosures retain expansion through refresh.
Changed data preserves keyed focus; disappearance moves focus predictably and is
announced. Identical snapshots need not replace the DOM or announce unchanged data.
Client memories are bounded.

Refresh is a bounded display-only GET. Pause freezes automatic display updates,
including pending automatic responses. Manual Refresh remains possible while
paused. Resume requests current data. These controls never pause or resume Loom
execution. Projection receipt time is not publisher or workflow health.

Distinguish loading, no publishers, no projected workflows, no filter matches, and
unavailable projection. Failed/malformed refreshes keep the last valid snapshot,
including an empty one. Retry clears degradation. Invalid hashes get a recovery
link without rewriting the URL. Missing deep-link targets wait at the exact address;
repeated reads do not prove deletion.

## Accessibility and validation

Use native links/buttons/selects/details and labeled progress/meter semantics.
Preserve zoom, text-backed status, visible focus, logical reading order, keyboard
paths, skip navigation, reduced motion and forced colors. Aim for WCAG 2.2 AA
contrast/reflow; automation is not a full conformance audit. Narrow layouts stack
work/context, disclose Projects, and wrap paths/IDs rather than hiding content.

Validate the realized interface: triage, filters, copied/reloaded URLs, keyboard
Back/focus, changed snapshots, disclosures, disappearance/lag, pause/race/retry,
conflicts, stale/live participants, missing versus zero fields, and both themes.
The readability follow-up also checks the actual production publisher through the
server/browser: real record titles, question ownership, required evidence, coordinator
membership, reported failures, no default UUIDs, keyboard-reachable technical IDs,
legacy/unsupported context, escaping, redaction and bounded text at 320 CSS pixels.
Test-produced data is not the user's live workflow, and no model reliability or
independent Reviewer/Critic verdict follows from deterministic browser checks.
