---
type: component
title: Loom Control Plane
description: Runtime workflow, routing, task, scope, OQ, budget and attachment enforcement.
tags: [component, loom, control-plane]
---

# Control Plane

## Purpose

Keep deterministic coordination out of model memory.

## Public Seams

The Loom plugin exposes tools for:
- intent interview start/question/resolve/prepare/accept;
- workflow start/routing/status/completion/reopen;
- shared OQs;
- executable task DAGs and task attachment;
- one-use child dispatch grants and exact workflow/step/OQ attachment;
- evidence;
- Product Acceptance;
- living-knowledge sync;
- learning/heuristics;
- budget and scope inspection;
- bounded read-only project inspection.

## Internal Modules

- `plugins/loom/index.ts` — OpenCode integration and tool/hook surface.
- `plugins/loom/runtime.ts` — project/install identity, scoped storage, transactional persistence, cross-process locks, migration and grants.
- `plugins/loom/dashboard.ts` — read-only operational projection publication and aggregation.
- `plugins/loom/intent.ts` — intent interview and Anchor-acceptance state.
- `plugins/loom/workflow.ts` — workflow DAG and step state.
- `plugins/loom/work.ts` — Objective → Phase → Wave → Task hierarchy and claims.
- `plugins/loom/tasks.ts` — bounded implementation DAG validation.
- `plugins/loom/oq.ts` — shared questions.
- `plugins/loom/budget.ts` — dispatch/retry limits.
- `plugins/loom/scope.ts` / `shell.ts` — Worker mutation boundaries.

## State

Mutable execution state is no longer persisted directly in OpenCode plugin storage.

Loom now:
1. resolves a durable project epoch;
2. stores mutable execution records in `execution-state.sqlite` under the Loom installation state root;
3. namespaces execution records by `projectId`;
4. serializes shared workflow/work mutations with installation-shared OS locks plus transactional commits;
5. fences workflow mutations with a monotonic workflow revision and work-hierarchy mutations with an independent work version;
6. binds OpenCode sessions to workflows only through Loom-controlled start/dispatch/attach transitions.

OpenCode plugin storage is used only as the legacy import source during bounded migration. Execution state is still not product authority.

## Read-only projection

The control plane publishes bounded operational snapshots through `plugins/loom/dashboard.ts`. Projection failure is isolated from workflow execution.

## Depends on

- [Runtime Isolation](runtime-isolation.md)
- [Agent Runtime](agent-runtime.md)
- [Verification](verification.md)
