---
type: Architecture
title: "OpenCode 2.2.6 compatibility candidate"
description: "Exact SDK/CLI upgrade and qualification boundary, with no new feature integration."
tags: [loom, opencode, compatibility, host-upgrade]
timestamp: 2026-11-08T00:00:00Z
---

# OpenCode 2.2.6 compatibility candidate

## Scope

- Pin `@opencode/plugin` and its transitive OpenCode SDK family to **2.2.6**
  in `package.json` / `bun.lock`. Preserve unrelated dependency pins.
- Install **unmodified `@opencode/cli@2.2.6`** separately from the packed
  Loom artifact in the installed-host boot and scripted-question CI jobs.
- Update version-specific smoke, question, and installed routing negative/disabled
  controls, including their source-applicability expectations. Do not alter
  Loom runtime behavior or native permissions.
- Keep the historical 2.1.4 model-routing fixtures and 2.0.29 Code Mode
  search fixture pinned; they cannot qualify production 2.2.6 routing.

## Changed upstream surface

The 2.2.6 plugin package now depends on the 2.2.6 OpenCode SDK family,
Effect **4.1.0**, and optional OpenTUI peers at **>=0.8.1**. The
lockfile updates only these required records using published 2.2.6 package
metadata/integrity records; frozen Bun CI must verify the result.

The 2.2.6 Promise Session adapter still delegates `ctx.session.get` to
`host.session.get`. The host Session service uses
`sessions.forSession(sessionID).get()`, and `Session.get` reads the
store by ID (or returns `NotFoundError`), without a selective read ACL.
Therefore the narrowly scoped **selective session-read-denial** check remains
`NOT APPLICABLE` based on tagged source inspection, `executed:false`.
This does **not** establish authorization for synthetic execution or other
session operations; `permission.assert` is a separate API.

Sources:
- [v2.2.6 release](https://github.com/anomalyco/opencode/releases/tag/v2.2.6)
- [Tagged Promise adapter](https://github.com/anomalyco/opencode/blob/v2.2.6/packages/plugin/src/promise/adapter.ts)
- [Tagged Session service](https://github.com/anomalyco/opencode/blob/v2.2.6/packages/core/src/session.ts)
- [Tagged Session.get](https://github.com/anomalyco/opencode/blob/v2.2.6/packages/core/src/session/session.ts)

## Acceptance requirements

CI on the exact PR head must successfully complete:

1. `bun install --frozen-lockfile`, lockfile cleanliness, TypeScript
   typecheck, core/native/Python tests and build.
2. Packed-artifact boot / restart / removal against exact CLI/SDK 2.2.6,
   preserving native agent definitions and empty-ledger behavior.
3. Installed scripted question, Session discovery, archive status,
   compaction, duplicate-input, and retrospective source-only checks.
4. Installed routing negative/disabled controls against the **same**
   exact CLI/SDK 2.2.6 pair. Managed-subscription routing must remain
   blocked by the normal fail-closed guard, with no quota DB or paid requests.
   **No managed-subscription route becomes qualified through this upgrade.**

Only the executed CI reports, tied to the PR head and exact installed package,
are upgrade evidence. The native scripted checks do not exercise paid/live
providers, external MCP servers, or a user's configuration. They do not
prove the full release's new features work inside Loom.

## Explicitly deferred

Background-job discovery, headless-run lifecycle adaptation, archived
scripted runs, MCP pooling, GUI extensions, warming, and custom fetch / Code
Mode VM experimentation remain separate changes with their own acceptance
criteria. No automatic routing, billing decisions, new worktree behavior,
or upgrade of an active OpenCode installation is authorized here.
