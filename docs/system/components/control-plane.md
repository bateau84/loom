---
type: component
title: Loom Control Plane
description: Runtime workflow, routing, task, scope, OQ, and budget enforcement.
tags: [component, loom, control-plane]
---

# Control Plane

## Purpose

Keep deterministic coordination out of model memory.

## Public Seams

The Loom plugin exposes tools for:
- workflow start/routing/status/completion/reopen;
- shared OQs;
- executable task DAGs and task attachment;
- evidence;
- Product Acceptance;
- living-knowledge sync;
- learning/heuristics;
- budget and scope inspection.

## Internal Modules

- `plugins/loom/index.ts` — OpenCode integration and tool/hook surface.
- `plugins/loom/workflow.ts` — workflow DAG and step state.
- `plugins/loom/tasks.ts` — bounded implementation DAG validation.
- `plugins/loom/oq.ts` — shared questions.
- `plugins/loom/budget.ts` — dispatch/retry limits.
- `plugins/loom/scope.ts` / `shell.ts` — Worker mutation boundaries.

## State

Workflow state is persisted through OpenCode plugin storage. It is execution state, not product authority.

## Depends on

- [Agent Runtime](agent-runtime.md)
- [Verification](verification.md)
