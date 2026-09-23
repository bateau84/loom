---
type: specification
title: Dashboard Readable Context
description: Optional bounded and digest-covered workflow context for human-readable dashboard information.
tags: [loom, dashboard, projection, specification]
---

# Dashboard Readable Context

This extends the read-only [dashboard projection](dashboard-projection.md) to support
[names-first dashboard design](../../../design/loom/dashboard-refresh.md). It changes
no workflow authority, admission policy, persisted runtime schema or mutation API.

## Optional context version 1

`WorkflowProjectionV1.context` is optional so an old snapshot remains readable.
A current publisher constructs it from the same Workflow and question records used
by its existing summary, before calculating the workflow state digest. It contains:

- bounded recorded request text;
- coordinator session identity only when the exact workflow creator is still in its
  participating-session list;
- at most 100 step identities, roles, kinds, statuses and available task labels,
  with reported-result text for failed steps only;
- at most 24 nonclosed questions: question text, required answer authority, recorded
  open/answered state and blocking flag;
- at most 24 open verification requirements: statement, evidence kind, requesting
  role, and the exact referenced gate's available step summary;
- explicit list truncation and question-count lower-bound indicators.

Only questions whose workflowId matches the workflow are included. The existing
question scan is capped at 1000; reaching that bound conservatively marks the count
as a lower bound even when exactly 1000 may exist. Closing a question excludes it;
answering without completing its consumer reconciliation retains it as answered.
Blocking questions come first, then open before answered questions within that
priority. No answer/evidence bodies, observation logs, shell output, hidden prompts,
or OpenCode transcripts are added. Per-agent session titles and live activity are
not available and must not be inferred from sorted membership or runnable steps.

Each text preview is at most 600 Unicode code points. Text over 16000 UTF-16 code
units is omitted rather than scanned unboundedly. Recognized credential assignments,
quoted credential values, authorization values, URL credentials, common token forms
and private-key blocks are redacted before truncation. Quoted credential values use
linear scanning, including escapes and unterminated quotes. Control/bidirectional-format
characters are removed. This is defense in depth, not a guarantee that arbitrary
prose is secret-free; authored operational summaries must not contain secrets.
The UI always escapes text and marks shortened descriptions and limited lists.

## Consistency and upgrade behavior

Context participates in stateDigest. Aggregation must not field-merge context from
another revision, choose a true same-revision conflict winner, or replace stale
latest state with a live lower revision.

A missing optional context object on a legacy publisher is not contradictory
context. At the same highest workflow revision, the narrow compatibility rule is:

1. There must be both legacy snapshots with no context and context-bearing snapshots
   using exactly supported context version 1.
2. Every complete payload must recompute to its own recorded stateDigest.
3. Removing only context and stateDigest from each payload must produce identical
   canonical common fields. No differing workflow field is ignored.
4. All context-bearing complete payload digests must agree with each other.
5. Choose one whole context-bearing snapshot; never merge fields from publishers.
   Its source freshness comes only from publishers carrying that complete snapshot.

Failure of any condition remains a visible consistency conflict, with no winner.
This rule does not apply to unknown versions, corrupted digests, different common
fields, different readable details, or different revisions. A live legacy publisher
cannot make details supplied only by stale publishers appear live. All participants
and their own liveness remain inspectable.

This prevents old snapshot files left behind by a process restart from causing a
permanent false conflict solely because this optional field was introduced. No
workflow revision bump or deletion of workflow history is needed for that case.

**After upgrading, restart the dashboard and OpenCode + Loom processes to produce
and display readable context.** Old snapshots alone still render with honest
counts-only guidance. Malformed or unknown optional context versions degrade that
detail section without inventing missing information. A genuine conflict is not
assumed resolved merely because a process restarted.

Legacy activeSessionId is retained in the old wire shape for compatibility but is
not trusted as activity evidence by the new UI. Coordinator identity is a membership
fact, not liveness. Product Acceptance and reported failures retain their existing
meanings; prose previews do not become observed evidence or verified root causes.

## Identity and limits

Display names never replace routing keys. Names are resolved within the selected
project and an explicit matching objective generation. Repeated titles use local
numbered Run labels; exact IDs remain in technical details. Unknown targets keep
exact deep links with unnamed/outside-view labels, rather than cross-project joins.
The dashboard reads only its projection, not arbitrary product files or internal
storage. Questions/checks are resolved through Loom, not the observation surface.

## Verification

Tests cover production record-to-projection-to-browser behavior, digest coverage,
compatible legacy snapshots, real mixed-publisher conflicts, corrupt digests, unknown
versions, stale context with live legacy publication, higher-revision precedence,
foreign-workflow exclusion, exact coordinator identity, text/list/scan bounds,
safe text rendering, unknown/legacy context, name collisions, generation isolation,
translated stages, and IDs hidden by default but reachable with a keyboard.
Fault-injected projections test presentation recovery only; they are not evidence
that the production publisher emits those faults.
