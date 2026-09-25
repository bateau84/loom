---
type: component
title: Loom Control Panel
description: Read-only operational projection plus bounded local workflow cleanup.
tags: [component, loom, dashboard, control-panel, observability]
---

# Loom Control Panel

## Purpose

Present Loom using the user's mental model:

```text
Working directory → Session → Workflow
```

The UI remains primarily informational. Advanced workflow/plan/publisher details are available by drill-down.

## Projection

Each Loom process publishes user-private atomic JSON snapshots under the persisted runtime root:

```text
<runtime-root>/instances/<installationId>/<instanceId>/manifest.json
<runtime-root>/instances/<installationId>/<instanceId>/projects/<projectId>.json
```

`plugins/loom/dashboard.ts` publishes on startup, Loom activity, and heartbeat. Projection failure does not alter execution.

Aggregation never field-merges publishers, keeps workflow revision and work version independent, preserves stale higher revisions, and surfaces same-revision disagreement as a consistency conflict.

## Local HTTP surface

The server binds to `127.0.0.1` by default.

- `GET /` — control-panel UI;
- `GET /api/fleet` — aggregated read-only projection;
- `GET /health` — service health;
- `GET /status/<installationId>/<projectId>/workflow-<digest>.html` — generated read-only status artifact;
- `POST /api/control/workflows/delete` — bounded deletion of terminal failed/cancelled workflow execution records.

The POST control route requires a same-origin browser request and the current per-server control token. It writes canonical runtime state, never projection files.

## Cleanup semantics

Workflow cleanup:

- revalidates project, revision, status, and terminality under workflow/work locks;
- rejects active work;
- rejects workflows that own durable completed-Wave review receipts;
- releases owned work claims and dispatch grants;
- clears stale session bindings, OQs, scopes, budgets, limits, and release records;
- removes the canonical workflow execution record;
- retains evidence and durable completed results;
- writes a workflow-deletion tombstone.

The aggregator applies tombstones so stale publisher snapshots cannot temporarily resurrect deleted workflows in the UI.

## Navigation

The preferred routes are:

```text
/#/
/#/directory/<projectId>
/#/directory/<projectId>/session/<sessionId>
/#/directory/<projectId>/session/<sessionId>/workflow/<workflowId>
/#/directory/<projectId>/workflows
```

Legacy `/#/project/<projectId>/workflow/<workflowId>` links remain accepted.

The work map remains an advanced disclosure from the working-directory page.

## Source

- `plugins/loom/dashboard.ts`
- `plugins/loom/dashboard-control.ts`
- `plugins/loom/workflow-cleanup.ts`
- `plugins/loom/dashboard-server.ts`
- `plugins/loom/dashboard-web/*`
- `dashboard/*`
