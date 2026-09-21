---
type: system-map
title: Loom Runtime Map
description: Current implemented component map for the Loom OpenCode AOS.
tags: [system-map, loom, runtime, navigation]
---

# Loom Runtime Map

Loom is a global OpenCode configuration and plugin-based AOS. Product meaning lives in repository authority documents; deterministic workflow mechanics live in the Loom plugin.

## Components

- [Control Plane](components/control-plane.md) — workflow DAG, routing, OQs, budgets, task scopes, attachment and grants.
- [Runtime Isolation](components/runtime-isolation.md) — project epochs, project-scoped durable state, cross-process mutation and session/workflow binding.
- [Dashboard](components/dashboard.md) — bounded read-only projection, multi-instance aggregation and external operational UI.
- [Agent Runtime](components/agent-runtime.md) — explicit judgment roles and disposable execution contexts.
- [Verification](components/verification.md) — evidence ledger, Reviewer, Product Acceptance, Critic.
- [Knowledge and Memory](components/knowledge-memory.md) — OKF system knowledge plus Loom/SynaBun learning.

## Important Flows

- [Autonomous Product Workflow](flows/product-workflow.md)

## Start Here

For a fresh task:
1. locate the product Anchor through OKF;
2. use this map to select relevant components/flows;
3. inspect current code only for the load-bearing surfaces of the task.

For concurrency, persistence, session attachment, or cross-project behavior, start with Runtime Isolation. For fleet monitoring or stale/conflict presentation, start with Dashboard.

## Source

- `agents/**`
- `plugins/loom/**`
- `dashboard/**`
- `opencode.json`

## User operations

- [Runtime Upgrades](../user/upgrades.md) — versioned state upgrades and resumed-session reconciliation.
