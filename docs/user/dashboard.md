---
type: user-guide
title: Loom Control Panel
description: Use Loom's automatically managed local control panel.
tags: [user-guide, loom, dashboard, control-panel]
---

# Loom Control Panel

The control panel is a local view of Loom work across your OpenCode processes and working directories.

Its normal hierarchy is:

```text
Working directory → Session → Workflow
```

Workflow internals are available when needed, but they are not the starting point.

## Start

The control panel starts automatically with the Loom OpenCode plugin.

By default:

```text
http://127.0.0.1:54318
```

Set `LOOM_DASHBOARD_PORT` to choose another local port. Set `LOOM_DASHBOARD_AUTOSTART=0` to disable automatic startup.

For foreground/debug operation:

```bash
LOOM_DASHBOARD_AUTOSTART=0 opencode
# another terminal
bun run dashboard
```

## Pages

- **Control panel** — working directories, recent sessions, and sessions needing attention.
- **Working directory** — sessions for one directory plus a small summary.
- **Session** — workflows that belong to that conversation/work context.
- **Workflow** — detailed Loom execution state and diagnostics.
- **Manage workflows** — inspect and clean up failed/cancelled workflow records.
- **Advanced work map** — Objective → Phase → Wave → Task detail when deeper planning/execution context is needed.

Existing `#/project/.../workflow/...` links remain accepted for compatibility.

## Delete failed workflow attempts

Failed restart attempts can be deleted after they are terminal.

From a session or **Manage workflows**:

1. choose the failed/cancelled workflow or cleanup action;
2. review the workflows in the confirmation dialog;
3. choose **Delete workflows**.

Deletion removes obsolete Loom execution/control records so the old attempts no longer clutter the UI or interfere with later routing.

It does **not** delete your code or working-directory files.

Loom retains evidence and completed durable work results. Active work cannot be deleted; cancel it first. If a workflow owns durable completed-Wave review history, Loom keeps that workflow record rather than destroying required provenance.

## Refresh and projection state

The UI refreshes from Loom's bounded operational projection. Missing data is not treated as zero or success.

- **stale/offline** means the latest source lease expired;
- **consistency conflict** means publishers disagree at the same highest revision and Loom does not pick a winner;
- optional telemetry can be unavailable without changing authoritative Loom state.

## Security boundary

The server listens on loopback by default.

Normal projection/status reads remain observational. The cleanup endpoint is a separate bounded control path and requires a same-origin request plus a per-server control token embedded in the served page.

This is CSRF protection, not shared-host user authentication. On shared or untrusted multi-user hosts, use OS/container isolation or disable dashboard auto-start. Do not expose the control panel directly to the public internet. If you configure `LOOM_DASHBOARD_URL` behind an authenticated reverse proxy, preserve the public Host header so control actions can verify the configured origin.

## Status artifacts

`loom_status` may still generate private interactive workflow-status artifacts below `/status/...`. Those artifacts remain GET-only and do not expose a general runtime filesystem route.
