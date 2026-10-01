---
type: specification
title: Dashboard Operator Model
description: Proposed first-class session inventory, explicit execution relationships, operator navigation, and phased delivery for the Loom dashboard.
tags: [architecture, specification, loom, dashboard, sessions, observability]
---

**Status:** proposed — design-first draft; not implemented by this PR. This changes requirements/design only, not publishers, host adapters, browser routes, or runtime behavior.

## Scope and current baseline

This is the target model for the revised [BR-018](../../../requirements/loom/br-018-external-operational-dashboard.md) and [dashboard experience](../../../design/loom/dashboard-experience.md). The [V1 projection specification](dashboard-projection.md) remains the legacy compatibility contract. Its workflow-only session enrichment/window is not sufficient for the new session inventory.

Source baseline inspected: `9a13cc634bee3d2a969b1fb3f814692eb6c68ad1`.

- `ProjectSnapshotV1` in `plugins/loom/dashboard.ts` has workflows and work Objectives, but no first-class session collection; the snapshot builder does not populate optional session enrichment.
- `sessionIdForWorkflow()` / `sessionsFor()` in `plugins/loom/dashboard-web/client.ts` group workflows under one chosen session ID. That grouping is not a host session inventory and can miss child/unbound sessions.
- The workflow publisher uses runnable steps for `currentSteps`/`activeAgent`, and its legacy `activeSessionId` is the first sorted participant. Those fields do not prove current execution; the V1 specification already documents this limitation.
- Plans are behind `Advanced work map`, while the home view uses a bounded recent-session slice. The target requires direct Work access and reachable complete lists.

Do not copy these inference rules into a more attractive screen. Extend the existing publisher/aggregator rather than building a second authority store or a separate observability product.

## Identity and relationships

Keep independent collections for observed hosts/publishers, sessions, workflows, and work Objectives. A project associates records; it is not their only navigation entrypoint.

| Record | Stable key | Authority |
| --- | --- | --- |
| Publisher | installation + publisher instance ID | Existing Loom manifest |
| Host instance | installation + verified host identity/boot epoch | Host adapter; PID alone is insufficient |
| Session | installation + host-store identity + host session ID | Host inventory |
| Workflow | installation + Loom project epoch + workflow ID | Loom |
| Objective / Plan | project epoch + Objective ID + generation / Plan revision | Loom |
| Task | Objective + generation + logical Task ID; explicit standalone identity otherwise | Loom |
| Step attempt | workflow + step ID + attempt | Loom |

The current Loom `instanceId` identifies a publisher instance. It is not automatically proof of one terminal window or one distinct OpenCode server. Preserve publisher identity; introduce host identity only when proven by the adapter. Multiple windows attached to one host do not create multiple host records. A host restart uses a new boot identity; persistent session identity survives.

Parent/child session edges come from host metadata. Current workflow/step/attempt edges come from canonical Loom bindings. Historical membership is separate and cannot be inferred from a current binding after rebinding. Never join by title, relative path, PID alone, role, or array position. Ambiguous/unavailable joins remain explicit unresolved references.

A session may be observed through multiple host/publisher sources. Do not duplicate its inventory row or silently pick an execution owner. Show source disagreement when current ownership/activity cannot be resolved from authoritative observations.

## Proposed read model

The following is a semantic contract, not a declaration that these exact APIs already exist:

```text
OperatorSnapshot {
  schemaVersion, snapshotId, generatedAt
  installations[], projects[], publishers[], hostInstances[]
  sessions[], workflows[], workObjectives[]
  coverage: { sessions, activity, workflows, work, history }
}

SessionProjection {
  sessionKey, hostSessionId, hostStoreId, installationId
  projectRef?, title?, parentSessionKey?, createdAt?
  hostObservations[]
  execution: { state, reason?, observedAt?, validUntil?, sourceRef? }
  activity[]: { activityId, kind, agent?, startedAt, sourceRef }
  currentBindings[]: { projectRef, workflowRef, stepId?, attempt?, sourceRef }
  historicalParticipation: { entries[], completeness, nextCursor? }
  unavailableFields[], consistency
}

Coverage {
  status: complete | partial | unavailable | disabled
  scope, observedFrom?, capturedAt?, knownCount?, nextCursor?, reason?
}
```

`currentBindings` is a collection to express the observed model, not permission for multiple arbitrary bindings: canonical Loom rules still govern each project/workflow binding. Concurrent incompatible observations are a conflict, not a merged multi-owner authority. A session with no binding has an empty binding list only when the binding read succeeded; failed reads are unavailable.

Child lists are reverse lookups of recorded parent edges. Workflow participant views are reverse lookups of exact bindings and separately labelled historical edges. Work ownership joins use Loom's Task/Wave claims and exact step attempts. A Task completed by one session and reviewed by another retains both relationships with their distinct meanings.

Do not use volatile OpenCode activity to change a Loom workflow digest/revision, status, evidence, or completion. Each domain retains its own complete source record, revision/sequence, and freshness. A joined display exposes the sources instead of pretending to be one atomic cross-system truth.

## Collection and activity

The host adapter must be checked against the repository's pinned `@opencode/plugin` API before implementation. This draft does not invent a `ctx.session.list` or event name.

1. Enumerate host sessions independently of workflow bindings, using a verified host API or a versioned, read-only store adapter. Record title, parent, host-store/project identity, and explicit coverage. Include observed chat-only and idle sessions.
2. Subscribe to verified host lifecycle/activity notifications where supported. Use explicit running/idle/wait observations or correlated start/finish spans. Never infer an active session from a session's existence, updated timestamp, workflow eligibility, or publisher liveness.
3. Reconcile inventory/activity on startup and after event-stream gaps. A cache of events alone cannot claim complete historical inventory. Unsupported host versions degrade the affected source; Loom workflow/work projections still function.
4. Read canonical Loom bindings and exact step attempts independently. Observe binding releases/rebinds, cancellation, deletion, and restart; do not reuse a stale attempt as the current execution link.
5. Publish bounded records atomically through the existing private projection transport. Collection failures are isolated from execution and from unrelated sources.

Use a host snapshot watermark or buffer events during initial enumeration, then replay only newer observations. Deduplicate by source epoch/sequence or event identity. Event gaps invalidate activity certainty until reconciled. Periodic republishing of cached observations MUST NOT extend their activity validity; only successful host reconciliation can renew it. Out-of-order finish events cannot close a newer attempt/span.

Execution states are `running`, `idle`, `waiting`, and `unknown`. They require attributable observations; waiting includes a recorded reason when available. Publisher freshness is a separate live/stale value. Expired activity becomes unknown/stale while retaining a labelled last observation. An offline publisher does not prove host/session termination. A busy observation without a reliable activity span can say **Running — activity detail unavailable**, not guess a tool or agent.

Current agent attribution uses the observed turn/activity or exact Loom attachment and distinguishes those sources. A role can change within a persistent session; a historical role is not necessarily the current role. Bounded activity kinds can include model work, a tool call, waiting for permission, or waiting for a child, only where the host actually reports them. Do not export arguments, outputs, prompts, or reasoning.

## Coverage, aggregation, and history

Retain the current workflow/work version and digest conflict rules. Session activity needs its own source ordering; do not compare per-publisher sequence/generation numbers across different publishers. Prefer an authoritative host snapshot over derived guesses; when no authority ordering exists, display disagreement rather than field-merging candidates.

Live host instances can exist without workflows and must survive aggregation. One session reported by two publishers is one session, with two source observations. Two projects with the same local IDs remain distinct. Missing host identity means **Host identity unavailable**, not a fabricated instance.

Bounded pages must not make the installation appear complete after reading only the first scan window. Inventory discovery must traverse all source pages or report partial coverage. Keep active/non-terminal work reachable regardless of terminal-history caps. Known totals may be shown only when actually computed; otherwise say **At least N observed**.

Provide stable-generation cursors and detail lookup for sessions, workflows, Objectives, Plans, and Tasks. A removed or superseded target gets an explicit response, not a redirect to a different identity. Keep historical binding/Plan references as history; expose unsupported/pre-capture history honestly. A collection response cannot advertise `complete` while silently hiding unreturned pages.

On deletion, canonical tombstones continue to suppress workflow resurrection, including references from old session observations. Removing workflow state does not remove an extant host session or its title. The UI can show **Previous workflow removed** without exposing deleted operational contents. Projection read failure preserves the last good view with a stale/error notice, never fresh zero counts.

## Compatibility and security

Use a versioned operator projection alongside V1 during rollout. Define and test reader/writer negotiation before switching the default UI. V1-only publishers can still contribute workflow/work data; session/activity coverage is explicitly partial/unavailable. Legacy `activeSessionId` and runnable `currentSteps` are not upgraded into live facts.

Preserve both existing workflow URL families and session links. The new canonical workflow URL does not include a chosen session. Work/Task detail links include the relevant project, Objective, generation, and Plan identity so revising a Plan cannot silently retarget an old link.

The human operator's read model spans observed workflows, but no agent tool receives that access. Dashboard reads never create bindings or alter grants, claims, Plans, steps, or outcomes. Retain loopback defaults, private files, same-origin guarded cleanup, canonical transactional mutation, runtime-version fencing, and existing tombstone handling. Do not add generic attach/dispatch/edit/delete controls as part of navigation work.

Default projection remains transcript-free. Bound and sanitize all host titles and activity labels using the same privacy/escaping discipline as current readable context. Model/token/cost enrichment stays optional and distinct from the core session inventory. Remote/shared-host access still needs appropriate authentication and OS isolation.

## Delivery slices

These are implementation boundaries, not new mandatory approval gates. Each slice must be independently testable; no extra agent role is required.

| Slice | Concrete change | Completion evidence |
| --- | --- | --- |
| 1. Truthful inventory | Add typed sessions/host coverage to the existing publisher and aggregator; verified host adapter; exact binding/attempt joins; activity freshness and gap reconciliation. | Production-adapter tests plus real pinned-host enumeration/activity evidence, including a session without a workflow. |
| 2. Connected overview | Implement Overview, Sessions, Workflows, Work, Projects, direct details, filters, history, and compatibility routes; replace representative-session grouping and inferred active labels. | Browser tests against production transport/aggregator for child → Task → Plan and back; keyboard/narrow-screen proof. |
| 3. Multi-instance readiness | Exercise restart, stale/offline/gaps, mixed versions, conflicts, paging, deletion, and existing isolation/privacy controls. | Six-host end-to-end trace and retained regression results; no claim of complete coverage from mock data alone. |

Likely implementation owners are the existing `plugins/loom/dashboard.ts`, `dashboard-context.ts`, `dashboard-server.ts`, `dashboard-web/*`, the pinned host integration in `plugins/loom/index.ts`, and dashboard/host integration tests. Keep session collection modular rather than further expanding the main plugin file. V1 compatibility, cleanup, and existing workflow authority remain in their current components.

## Acceptance scenarios

All rows below are **required future checks, not results of this documentation PR**.

| Scenario | Required observable result |
| --- | --- |
| Six independent observed hosts, six root sessions, three actual children, multiple projects | Six host records and nine deduplicated sessions; roots/children counted separately; every record reachable. |
| Two UI windows attached to the same host/session | One host/session identity, not two invented executions. |
| Chat-only root and idle host with no workflows | Visible in Sessions/Overview with no workflow; not absent from aggregation. |
| Worker and Reviewer children in one workflow | Both real sessions have direct detail links and exact attempt relationships; an undispatched step is only Ready next. |
| Two workflows contribute to one Objective/Plan | One Plan and unique Task counts; both workflow scopes/owners linked; no double-counted progress. |
| Standalone Task/Change and planning-only workflow | Available work remains visible without a fabricated full Plan; planning completion is not implementation completion. |
| One session leaves failed W1 and starts W2 | W2 is current; W1 is separate history; old failure does not override present activity. |
| Runnable step, live publisher, but idle/missing host telemetry | Ready next plus idle/unknown; never inferred Running or a guessed active session. |
| Agent changes role or overlapping verified activities | Attribution follows actual observations; concurrent activity is not collapsed to the first role/session. |
| Host restart, out-of-order events, event gap, expired activity | Stable session identity; new host epoch; no stale attempt/spurious completion; uncertainty until reconciliation. |
| Duplicate publishers, same local IDs in separate projects, conflicting activity | Deduplicated exact identities; project isolation; explicit conflicts rather than a fabricated winner. |
| More than 100 current workflows, more than eight sessions, multiple source pages | All reachable with truthful counts/coverage and stable paging; no silent first-page omission. |
| Old V1 publisher alongside upgraded publisher | Workflow/work remain usable; missing session telemetry is explicit; V1 hints never become live activity. |
| Delete terminal workflow while a host session still exists | Workflow stays removed despite stale snapshots; host session remains visible; cleanup safety and retained evidence unchanged. |
| Keyboard, 320px layout, refresh, renamed object, legacy child/workflow links | Correct identity and return context; no lost focus or unreachable work; current Plan is not behind an advanced-only view. |
| Projection outage, hostile title, secret-bearing activity label, denied agent cross-workflow read | Stale/error view rather than fresh zeros; escaped/redacted bounded text; unchanged agent isolation and control authorization. |

A product walkthrough must answer **who is working on this Task, what Plan it belongs to, what blocks it, and whether the user needs to act** from the joined views without searching every session. Missing source evidence is an explicit answer, not permission to invent one.
