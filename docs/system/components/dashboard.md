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
- `GET /health` — dashboard health.

Non-GET methods are rejected.

The UI implements Fleet → Project → Workflow → Session context, Objective → Phase → Wave → Task hierarchy, attention-first state labels, filters, keyboard-native navigation, focus preservation across refresh, explicit stale/conflict treatment and Loom-authoritative vs optional-telemetry provenance.

## Source

- `plugins/loom/dashboard.ts`
- `dashboard/server.ts`
- `dashboard/ui.ts`
- `plugins/loom/dashboard.test.ts`
- `dashboard/dashboard.test.ts`
