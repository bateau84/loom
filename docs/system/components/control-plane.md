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
- workflow start/routing/status/completion/reopen and explicit user-authorized cancellation;
- shared OQs;
- executable task DAGs and task attachment;
- one-use child dispatch grants and exact workflow/step/OQ attachment;
- evidence;
- Product Acceptance;
- living-knowledge sync;
- learning/heuristics;
- bounded Worker and specialist step write scopes, plus scope inspection;
- state-derived upgrade compatibility inspection through `loom_upgrade_status`;
- bounded read-only project inspection;
- explicit ephemeral-report promotion into durable `docs/reports/**`.

## Internal Modules

- `plugins/loom/index.ts` — OpenCode integration and tool/hook surface.
- `plugins/loom/runtime.ts` — project/install identity, scoped storage, transactional persistence, cross-process locks, migration and grants.
- `plugins/loom/dashboard.ts` — read-only operational projection publication and aggregation.
- `plugins/loom/dashboard-endpoint.ts` — installation-shared advertised dashboard endpoint lease consumed by status/sidebar links.
- `plugins/loom/status-view.ts` — compact status presentation plus user-private interactive HTML workflow artifact generation.
- `plugins/loom/intent.ts` — intent interview and Anchor-acceptance state.
- `plugins/loom/workflow.ts` — workflow DAG, step state and cancellation fence.
- `plugins/loom/lifecycle.ts` — atomic workflow cancellation, tool admission, terminal bindings and reviewed-Wave history recovery.
- `plugins/loom/recovery-code.ts` — restricted single-call Code Mode recovery for cancelled children.
- `plugins/loom/evidence-admission.ts` / `evidence.ts` — operation origin, attachment/attempt checks, historical observations and proof claims.
- `plugins/loom/work.ts` — Objective → Phase → Wave → Task hierarchy, live claims and reviewed-Wave receipts.
- `plugins/loom/upgrade-actions.ts` — state-derived semantic compatibility actions and minimal conditional model notification.
- `plugins/loom/tasks.ts` — bounded implementation DAG validation.
- `plugins/loom/oq.ts` — shared questions.
- `plugins/loom/budget.ts` — dispatch/retry limits.
- `plugins/loom/scope.ts` / `shell.ts` — bounded Worker mutation scopes, specialist artifact-scope ceilings, and restricted shell/Git mutation policy.
- `plugins/loom/reports.ts` — guarded report promotion and retention boundary.

## State

Mutable execution state is no longer persisted directly in OpenCode plugin storage.

Loom now:
1. resolves a durable project epoch;
2. stores mutable execution records in `execution-state.sqlite` under the Loom installation state root;
3. namespaces execution records by `projectId`;
4. serializes shared workflow/work mutations with installation-shared OS locks plus transactional commits;
5. fences workflow mutations with a monotonic workflow revision and work-hierarchy mutations with an independent work version;
6. binds OpenCode sessions to workflows only through Loom-controlled start/dispatch/attach transitions.

Artifact-producing specialist steps may carry an explicit write scope that only **narrows** the role's existing artifact permissions. Loom records the exact attached step attempt and serializes scope changes, attachment rotation, completion, rerouting, and reopen transitions with active mutations. Durable specialist artifacts are staged and committed by the producing role; they are not handed to Worker merely for publication.

OpenCode plugin storage is used only as the legacy import source during bounded migration. Execution state is still not product authority.

Runtime-schema migrations and semantic upgrade actions are separate. Deterministic storage changes run transactionally in the runtime upgrade ledger. Reasoning-required compatibility work is detected from authoritative state and exposed only while pending; successful state transition removes the action automatically for all sessions in that scope.

## OpenCode tool presentation

Loom control-plane tools have two equivalent OpenCode access surfaces. Existing native tools remain available as `loom_*`. The plugin also mirrors the same schemas/executors into the Code Mode catalog under `tools.loom.code.*`, preserving the native permission identity. Models can therefore use Loom correctly whether they prefer native tool calls or Code Mode discovery. Interactive status is dashboard-first and does not depend on model-generated presentation prose. The sidebar RPC exposes the active workflow's stable dashboard deep link using the dashboard process's shared advertised-endpoint lease; optional OpenCode Desktop preview metadata is kept separate from the normal execution path.

## Read-only presentation

The control plane publishes bounded operational snapshots through `plugins/loom/dashboard.ts`. Projection failure is isolated from workflow execution.

`loom_status` builds a compact status read model from current authoritative state. It may also write a user-private, read-only interactive HTML artifact under the Loom runtime root. The external dashboard remains the stable interactive entry point independently of that artifact, and the sidebar RPC exposes a project/workflow deep link derived from authoritative runtime identity. Presentation metadata may add a per-artifact URL plus optional OpenCode Desktop preview metadata. Artifact generation, dashboard availability, or Desktop preview availability is presentation-only and does not alter workflow execution.

## Depends on

- [Runtime Isolation](runtime-isolation.md)
- [Agent Runtime](agent-runtime.md)
- [Verification](verification.md)
