---
type: design
title: Loom Dashboard Observability and Control
description: Read-only operational projection plus a bounded local cleanup path for the Loom control panel.
tags: [architecture, loom, dashboard, control-panel, observability, projection]
---

**Status:** proposed

## Purpose

Loom exposes a local control panel for work spread across OpenCode processes and working directories.

The primary UI hierarchy is defined by the Designer artifact as **Working directory → Session → Workflow**. This architecture owns projection, aggregation, freshness, and the narrowly bounded workflow-cleanup control path.

## Projection boundary

Operational display data still flows through the read-only projection:

```text
OpenCode + Loom process
        |
        | atomic bounded snapshot + heartbeat
        v
host-local projection
        |
        v
dashboard aggregator
        |
        v
control-panel UI
```

Snapshot files are never authority and are never written back to control Loom.

Each manifest/project snapshot retains:

```text
schemaVersion
instanceId
projectId
generation
generatedAt
leaseExpiresAt
```

Publication remains atomic and per-publisher generation is monotonic. An expired lease produces stale/offline state. Same-highest-revision incompatible workflow state is a consistency conflict; the aggregator does not invent a winner.

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

It does not turn snapshot files into a command bus and it does not make dashboard availability an execution dependency.

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

The deletion tombstone has a second purpose: stale publisher snapshots can continue to exist until their leases expire. The control-panel aggregator filters any workflow named by a tombstone so deleted work does not reappear in the UI during that window.

## Storage capability

Canonical Loom storage exposes an optional `delete(key)` capability.

- transactional SQLite implements deletion inside the same serialized transaction model as reads/writes;
- project-scoped storage qualifies and runtime-version-fences deletion exactly like get/set/scan;
- workflow cleanup requires transactional storage so a mid-operation failure rolls back canonical control-plane changes;
- atomic-file storage implements the lower-level delete capability for compatibility/testing but is not eligible for workflow cleanup;
- callers that do not need mutation can continue implementing the older get/set/scan subset because deletion remains optional.

## Projection model

The existing bounded workflow projection remains authoritative for presentation and can include:

- project/working-directory identity;
- participating session IDs;
- workflow state/revision;
- current/runnable steps;
- Objective → Phase → Wave → Task detail;
- OQs and verification counts/details;
- dispatch budget;
- Product Acceptance and knowledge state;
- recent activity;
- publisher freshness;
- optional OpenCode enrichment.

Missing optional data is unavailable, never inferred as zero/success.

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
- on shared multi-user hosts, OS/container isolation is required because loopback is not same-user authentication.

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

- [Control Panel Experience](../../design/loom/dashboard-experience.md)
- [Dashboard Projection Transport](decisions/dashboard-projection-transport.md)
- [Dashboard Projection Specification](specs/dashboard-projection.md)
- [BR-018](../../requirements/loom/br-018-external-operational-dashboard.md)
