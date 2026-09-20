---
type: system-map
title: Loom Runtime Map
description: Current implemented component map for the Loom OpenCode AOS.
tags: [system-map, loom, runtime, navigation]
---

# Loom Runtime Map

Loom is a global OpenCode configuration and plugin-based AOS. Product meaning lives in repository authority documents; deterministic workflow mechanics live in the Loom plugin.

## Components

- [Control Plane](components/control-plane.md) — workflow DAG, routing, OQs, budgets, task scopes.
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

## Source

- `agents/**`
- `plugins/loom/**`
- `opencode.json`
