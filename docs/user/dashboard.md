---
type: user-guide
title: Loom Operational Dashboard
description: Use Loom's automatically managed read-only external dashboard.
tags: [user-guide, loom, dashboard]
---

# Loom Operational Dashboard

The dashboard is a local read-only view of Loom work running across OpenCode processes and projects.

## Start

The dashboard starts automatically with the Loom OpenCode plugin. No separate terminal or service command is normally required.

By default it listens on:

```text
http://127.0.0.1:54318
```

The first OpenCode process that sees no active dashboard lease binds the port and owns the server in-process. Other OpenCode processes reuse the shared endpoint lease. If the owner exits while another OpenCode process is still running, a remaining process takes over after the lease expires.

Earlier dashboard versions defaulted to `4318`. To preserve an existing bookmark or script, set `LOOM_DASHBOARD_PORT=4318`, but only when that port is not already used by OTLP/HTTP or another local service.

Set `LOOM_DASHBOARD_PORT` to choose another local port. Set `LOOM_DASHBOARD_AUTOSTART=0` on OpenCode to opt out of automatic startup.

For explicit foreground/debug operation, do not run a second server on the same port while an auto-started owner is active. Start OpenCode with auto-start disabled, then run the dashboard separately:

```bash
LOOM_DASHBOARD_AUTOSTART=0 opencode
# in another terminal
bun run dashboard
```

The running dashboard publishes its effective endpoint into Loom's installation state, and active Loom/OpenCode processes resolve sidebar/status links from that shared endpoint lease.

## Views

- **Fleet** — attention-first list of active/recent workflows across projects.
- **Project** — Objective → Phase → Wave → Task progress and project workflows.
- **Workflow** — runnable/current steps, OQs, verification, budget, Product Acceptance, knowledge status and participating publishers.
- **Session context** — publisher/session freshness plus optional OpenCode telemetry when enabled.

Use the Status and Project filters to narrow Fleet. Objective, Phase and Wave rows are expandable so large work plans do not need to stay fully open. Browser Back or the breadcrumb links return through Workflow → Project → Fleet without changing Loom state.

## In-session workflow status

`loom_status` stays compact in the OpenCode timeline. Interactive status itself is dashboard-owned and does not depend on the model repeating a presentation URL.

Start OpenCode with Loom enabled. The plugin ensures the read-only dashboard is available automatically.

Then open:

```text
http://127.0.0.1:54318
```

Fleet automatically lists active/recent Loom workflows. A workflow can also be opened directly through the stable dashboard route:

```text
http://127.0.0.1:54318/#/project/<projectId>/workflow/<workflowId>
```

The OpenCode terminal client's Loom sidebar exposes that stable deep link for the active workflow. In OpenCode web, the dashboard root remains a fixed browser entry point, so interactive status is still reachable even if plugin-tool output is not rendered by the host UI.

`loom_status` may additionally generate a user-private interactive HTML artifact under Loom's runtime root and return a `/status/...` URL. That artifact provides expandable hierarchy, search/filtering, current/upcoming work, OQs, verification, budget, Product Acceptance, and knowledge state. Artifact generation is a convenience path; dashboard reachability does not depend on it.

The `/status/...` endpoint serves only generated workflow-status artifacts and remains GET-only. It does not expose a general runtime filesystem route.

Use `LOOM_DASHBOARD_PORT` for a different local port. The dashboard process publishes that effective endpoint and refreshes a short lease, so existing OpenCode/Loom processes pick up the active port without requiring matching environment variables or a restart.

Use `LOOM_DASHBOARD_URL` on the owning OpenCode/dashboard process when the browser reaches the dashboard through a tunnel or reverse proxy. That advertised base URL is published through the same shared endpoint lease.

> **Local/remote trust boundary:** the dashboard has no built-in authentication and is designed for host-local observation. Loopback prevents remote-network access but is not same-user authentication: another user or process on a shared host may be able to connect. On shared or untrusted multi-user hosts, set `LOOM_DASHBOARD_AUTOSTART=0` or use OS/container isolation. Do not expose it directly to the public internet; for remote access, use a private tunnel or an authenticated/authorized reverse proxy. Treat canonical project paths/workflow metadata as operationally sensitive.

### Optional OpenCode Desktop preview

If OpenCode Desktop is installed and its experimental browser integration is connected, Loom metadata may contain a one-shot Desktop preview program. It is optional and is not part of the normal status flow. TUI/CLI/web/SSH/container/CI usage does not require it.

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
