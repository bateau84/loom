---
type: Playbook
title: OpenCode 2.3.0 compatibility qualification
description: Exact SDK/CLI upgrade, installed proof boundaries, and deferred host-feature adoption.
tags: [opencode, upgrade, compatibility, qualification]
timestamp: 2026-11-17T00:00:00Z
---

# OpenCode 2.3.0 compatibility qualification

This change upgrades Loom's exact `@opencode/plugin` dependency and native CI host from 2.2.6 to **2.3.0** without enabling any new host feature. The native host is installed separately from the packaged plugin; `bun install --frozen-lockfile` and the package inventory must agree on the SDK version.

## Compatibility contract

- Keep automatic managed routing **unqualified** and default-disabled, including included-quota and billing assumptions.
- Keep Stage 3 and Stage 4 preparation working through real native process starts, storage/restart, public reads, denial controls, and scripted providers; do not infer genuine Evaluator reasoning or Q4/Q5.
- Treat 2.3.0's background-subagent return, parent notification, nested/idle and restart behavior as a **host behavior change** to be regression-tested, not a new Loom orchestration feature.
- Keep experimental MCP events and shell background flags off. Do not enable or depend on `session.fork` or other new hooks here.
- The offline experiment recovery scanner is **pinned to OpenCode 2.2.6's migration inventory**. A separate native 2.2.6 scanner fixture runs to preserve its existing guarantees. Never pass a 2.3.0 database to it as though supported; 2.3.0 recovery inspection requires fresh native migration qualification.
- Preserve original scripted-provider tests and their negative controls. A PASS establishes the named mechanics, not real-provider correctness, native Q4/Q5 transfer authority, model cost, or independent acceptance.

## Required validation before merge

- Production and fixture typechecks, core/native/Python suites, production bundle, `bun install --frozen-lockfile` and no lockfile drift.
- Installed boot/trust, structured questions and native review, Stage 3/4 preparation and recovery, routing guard/acceptance, instruction variants and workspace workflows on the exact 2.3.0 CLI/SDK pairing.
- Inspect installed traces for unexpected parent wakeups, child completion changes and repeated model requests. Do not relax assertions to clear a changed default.
- Confirm CI's terminal outcomes on the final PR head and review its diff before merge.

Feature adoption requires a separate PR and explicit acceptance criteria. This version bump must remain independently reversible.
