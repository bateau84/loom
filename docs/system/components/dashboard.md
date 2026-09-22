---
type: component
title: Loom Operational Dashboard
description: Read-only projection and external fleet dashboard for concurrent Loom work.
tags: [component, loom, dashboard, observability]
---

# Operational Dashboard

## Purpose

Show concurrent Loom work across projects and OpenCode instances without making the dashboard a workflow authority or controller.

## Publication

Each Loom process publishes user-private atomic JSON snapshots under the installation-persisted runtime root:

```text
<runtime-root>/instances/<installationId>/<instanceId>/manifest.json
<runtime-root>/instances/<installationId>/<instanceId>/projects/<projectId>.json
```

`plugins/loom/dashboard.ts` publishes on startup, on Loom activity, and by heartbeat. Each project publisher has its own monotonic generation and explicit `leaseExpiresAt`.

Projection failure is swallowed by the publication trigger and does not alter Loom workflow state.

## Authority and aggregation

Projected Loom workflow/work fields remain authoritative control-plane data. Optional OpenCode telemetry is supplemental and absent by default.

Aggregation:
- groups publishers by explicit project/workflow identity;
- never field-merges snapshots;
- orders workflow state by `workflowRevision`;
- orders hierarchy state independently by `workVersion`;
- retains a stale higher revision over a live lower revision and labels it `stale-source`;
- surfaces same-highest-revision digest disagreement as a consistency conflict;
- keeps participant liveness separate from workflow-state freshness.

## External UI

Run:

```bash
bun run dashboard
```

The server binds only to `127.0.0.1` by default and exposes:
- `GET /` — dashboard UI;
- `GET /api/fleet` — aggregated read-only projection;
- `GET /health` — dashboard health;
- `GET /status/<installationId>/<projectId>/workflow-<digest>.html` — one generated read-only workflow-status artifact.

The status route accepts only Loom UUID installation/project identities and generated `workflow-<20 hex>.html` names; it is not a general filesystem endpoint. Non-GET methods are rejected.

The running dashboard also publishes a short-lived `dashboard-endpoint.json` lease under the installation state root. Sidebar/status URL generation resolves this shared endpoint on demand. This keeps a separately started dashboard process and already-running OpenCode/Loom processes consistent when a non-default port or advertised reverse-proxy URL is used; an expired lease falls back to explicit configuration/defaults rather than remaining authoritative indefinitely.

The UI implements Fleet → Project → Workflow → Session context, expandable Objective → Phase → Wave → Task hierarchy, attention-first state labels, filters, keyboard-native navigation, focus preservation across refresh, explicit stale/conflict treatment and Loom-authoritative vs optional-telemetry provenance.

Workflow routes are stable deep links of the form `/#/project/<projectId>/workflow/<workflowId>`. Loom's sidebar RPC derives that URL from the same runtime project/workflow identity and the active shared dashboard endpoint lease, so interactive status reachability does not depend on a model copying tool output into its reply.

Because projection publication is asynchronous, a deep link whose project/workflow is not currently present is held in a waiting state instead of being rewritten. Re-reading the same projection is not evidence that authoritative state disappeared, and bounded/truncated workflow projections do not prove absence. The deep link remains intact until the user explicitly follows the Fleet/Project fallback navigation or the requested state appears.

## Source

- `plugins/loom/dashboard.ts`
- `plugins/loom/dashboard-endpoint.ts`
- `dashboard/server.ts`
- `dashboard/ui.ts`
- `plugins/loom/dashboard.test.ts`
- `dashboard/dashboard.test.ts`
