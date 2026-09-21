---
type: user-guide
title: Loom Operational Dashboard
description: Start and use Loom's read-only external dashboard.
tags: [user-guide, loom, dashboard]
---

# Loom Operational Dashboard

The dashboard is a local read-only view of Loom work running across OpenCode processes and projects.

## Start

From the Loom repository/configuration:

```bash
bun run dashboard
```

By default it listens on:

```text
http://127.0.0.1:4318
```

Set `LOOM_DASHBOARD_PORT` to choose another local port.

## Views

- **Fleet** — attention-first list of active/recent workflows across projects.
- **Project** — Objective → Phase → Wave → Task progress and project workflows.
- **Workflow** — runnable/current steps, OQs, verification, budget, Product Acceptance, knowledge status and participating publishers.
- **Session context** — publisher/session freshness plus optional OpenCode telemetry when enabled.

Use the Status and Project filters to narrow Fleet. Browser Back or the breadcrumb links return through Workflow → Project → Fleet without changing Loom state.

## Status meaning

- **consistency conflict** — publishers claim the same highest workflow revision with different authoritative state; the dashboard does not pick a winner.
- **failed / blocked** — Loom-authoritative workflow status.
- **stale/offline** — the latest-known source lease expired.
- **active / complete** — Loom-authoritative state from the selected latest revision.

Missing optional telemetry is shown as unavailable/not enabled, not as zero or success.

## Safety

The dashboard is not a Loom controller.

- its HTTP surface is GET-only;
- snapshot files are observation data, not authority;
- it cannot answer OQs, grant budget, attach sessions, complete steps, or mutate workflows;
- dashboard/projection failure does not stop Loom execution;
- credentials, hidden prompts and unrestricted tool output are not projected by default.
