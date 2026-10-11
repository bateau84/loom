---
type: design
title: Loom Dashboard Observability and Control
description: Read-only operator projection with first-class sessions and a separate bounded local workflow-cleanup path.
tags: [architecture, loom, dashboard, control-panel, observability, projection]
---

**Status:** proposed — operator-overview revision; the new session-aware model is not implemented by this documentation change.

## Purpose

Loom exposes a local operator dashboard for work spread across OpenCode processes and projects/worktrees.

The target experience is **Overview, Sessions, Workflows, Work, and Projects**, with explicit relationships between those objects. The dashboard is the human's complete view of observed work, not a broader permission surface for agents. A working directory is a filter/grouping, not a mandatory parent page for everything.

The [Operator Model](specs/dashboard-operator-model.md) defines first-class session/host inventory, current versus historical relationships, activity evidence, coverage, and delivery/acceptance scenarios. The existing [V1 Projection Specification](specs/dashboard-projection.md) remains the compatibility contract during rollout; its workflow-derived session locators do not establish live activity. This draft changes the target design, not the running implementation.

## Projection boundary

Operational display data still flows through the read-only projection:

```text
OpenCode host inventory/activity + canonical Loom bindings/work
        |
        | atomic bounded snapshots + source-specific freshness
        v
host-local projection
        |
        v
dashboard aggregator
        |
        v
operator UI: Overview / Sessions / Workflows / Work / Projects
```

Snapshot files are never authority and are never written back to control Loom. OpenCode observations describe host identity/activity; only Loom describes workflow/step/Task authority and completion. A host heartbeat or a runnable step is not evidence that a session is executing.

Each manifest/project snapshot retains:

```text
schemaVersion
instanceId
projectId
generation
generatedAt
leaseExpiresAt
```

Publication remains atomic and per-publisher generation is monotonic. An expired lease produces stale/offline source state, not inferred session completion. Same-highest-revision incompatible workflow state is a consistency conflict; the aggregator does not invent a winner. Session observations retain their own source epoch/sequence, observation time, and validity rather than borrowing workflow revision or publisher liveness.

## Bounded control path

Workflow cleanup is deliberately separate from the projection path:

```text
browser control panel
        |
        | same-origin POST + per-server control token
        v
dashboard control endpoint
        |
        | project identity + runtime-version fence
        | workflow/work advisory locks
        v
canonical transactional Loom storage
```

The first control action is only:

```text
delete terminal failed/cancelled workflow records
```

It does not turn snapshot files into a command bus and it does not make dashboard availability an execution dependency. History filtering is independent of cleanup; removing visual clutter does not require deleting records.

### Browser admission

The dashboard server generates an unguessable control token when it starts and embeds it into the HTML served by that process.

A cleanup request is admitted only when:

- the HTTP method/path is the exact cleanup operation;
- the browser `Origin` and request Host are either literal loopback or match the explicitly configured `LOOM_DASHBOARD_URL`; arbitrary Host names are rejected to prevent DNS rebinding;
- the `X-Loom-Control-Token` matches the current server token;
- the target project exists in Loom's installation registry;
- the runtime schema version matches the running build.

The token is CSRF protection, not shared-host user authentication. Loopback remains the primary network boundary. An authenticated reverse proxy used with `LOOM_DASHBOARD_URL` must preserve the public Host header for control actions.

### Workflow deletion invariants

Deletion is allowed only when every selected workflow:

- belongs to the selected project;
- is terminal;
- is failed or cancelled;
- has not changed revision between selection and commit;
- does not own a durable completed-Wave review receipt.

The mutation acquires workflow locks plus relevant work-hierarchy locks before revalidating.

Deletion then:

1. releases claims owned by the deleted workflow;
2. revokes remaining dispatch grants;
3. removes the workflow from `WorkHierarchy.workflowIds`;
4. removes active session/step/OQ bindings that still point at it;
5. records a separate child-session deletion fence before dropping old child bindings, so late host/tool calls from those child sessions remain denied until a new valid attachment exists;
6. removes workflow-local budgets, limits, OQs, scopes, binding-release records, and work-release records;
7. removes the canonical `workflow/<id>` execution record;
8. writes a durable `workflow-deletion/<id>` tombstone.

Evidence observations/claims and durable completed work results are retained.

The deletion tombstone has a second purpose: stale publisher snapshots can continue to exist until their leases expire. The control-panel aggregator filters any workflow named by a tombstone so deleted work does not reappear in the UI during that window. The new session inventory must also respect tombstones on relationship lookups; it does not delete a still-existing host session merely because its workflow was removed.

## Storage capability

Canonical Loom storage exposes an optional `delete(key)` capability.

- transactional SQLite implements deletion inside the same serialized transaction model as reads/writes;
- project-scoped storage qualifies and runtime-version-fences deletion exactly like get/set/scan;
- workflow cleanup requires transactional storage so a mid-operation failure rolls back canonical control-plane changes;
- atomic-file storage implements the lower-level delete capability for compatibility/testing but is not eligible for workflow cleanup;
- callers that do not need mutation can continue implementing the older get/set/scan subset because deletion remains optional.

## Projection model

The target operator projection includes independent host/publisher, session, workflow, and work collections. Their identities and relationships are specified in [Operator Model](specs/dashboard-operator-model.md). Core session inventory is not optional cost/model enrichment and is not derived by selecting one session per workflow.

Preserve the existing workflow/work projection detail:

- project/working-directory identity;
- participating session IDs with explicit current/historical meaning in the operator view;
- workflow state/revision;
- runnable steps, distinct from observed executing sessions/steps;
- Objective, current Plan, Phase, Wave, and Task detail;
- OQs and verification counts/details;
- dispatch budget;
- Product Acceptance and knowledge state;
- recent activity and its source;
- publisher freshness;
- optional OpenCode cost/model/output enrichment.

Missing optional data is unavailable, never inferred as zero/success. Core session/activity capture failures likewise remain explicit unavailable/partial coverage rather than disappearing behind optional enrichment. Bounded page sizes do not permit silently incomplete active-work inventories.

## Failure semantics

Projection failure never blocks Loom execution. Before canonical execution state exists, the control panel may still show read-only snapshots. After canonical state exists, failure to read deletion tombstones makes the dashboard projection fail closed rather than allowing stale snapshots to resurrect deleted workflows; the browser keeps its last valid projection when one exists.

Cleanup failure is fail-closed:

- project files are not touched;
- no success is reported unless the canonical transaction completes;
- revision/work-binding changes force the user to refresh and retry;
- active work is rejected rather than implicitly cancelled;
- durable completed-Wave provenance blocks deletion;
- the HTTP server bounds request bodies before JSON/control processing;
- a completed tombstone makes a repeated delete idempotent, so an uncertain browser response can be retried safely without recreating or re-deleting state.

## Security and privacy

- server binds to loopback by default;
- projection files remain read-only observation data;
- cleanup uses canonical runtime storage, not writable projection files;
- no credential values, hidden prompts, or unrestricted tool output are projected;
- cleanup accepts workflow IDs and a bounded reason only;
- remote/public exposure still requires an authenticated/authorized reverse proxy or private tunnel;
- on shared multi-user hosts, OS/container isolation is required because loopback is not same-user authentication;
- operator visibility never creates or expands an agent's project/workflow/step binding.

## Non-goals

The control panel does not:

- answer OQs;
- grant dispatch budget;
- attach sessions;
- complete/pass/fail steps;
- edit Plans;
- cancel active work implicitly;
- delete project files;
- delete retained evidence;
- infer Loom truth from OpenCode transcripts.

Further control actions require separate product and architecture acceptance rather than expanding this endpoint generically.

## Related

- [Operator Dashboard Experience](../../design/loom/dashboard-experience.md)
- [Operator Model and Delivery](specs/dashboard-operator-model.md)
- [Dashboard Projection Transport](decisions/dashboard-projection-transport.md)
- [V1 Projection Specification](specs/dashboard-projection.md)
- [BR-018](../../requirements/loom/br-018-external-operational-dashboard.md)
