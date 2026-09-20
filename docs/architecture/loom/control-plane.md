---
type: design
title: Loom Control Plane
description: OpenCode plugin that enforces workflow state, routing, evidence coordination, bounded execution, and shared questions.
tags: [architecture, loom, control-plane, plugin, workflow]
---

**Status:** proposed

## Responsibility

The control plane handles rules that should not depend on an LLM remembering them.

It is implemented as a global OpenCode V2 plugin under `~/.config/opencode/plugins/loom/`, with custom tools and hooks. Loom's repository mirrors the global config directory, so OpenCode-specific files live at repository root.

## Core State

Each workflow has:

```text
workflow id
anchor
phase
required capabilities
completed capabilities
tasks
dependencies
open questions
evidence references
retry/progress counters
review counters
critic counters
resource limits
status
```

Runtime state is not product authority.

Durable product meaning remains in OKF documents.

## Control Tools

The plugin exposes a small Loom tool namespace.

Initial capabilities:

- **workflow** — start, inspect, advance, block, complete.
- **route** — classify required capabilities and inspect unmet prerequisites.
- **task** — register a validated implementation DAG, expose runnable tasks, and enforce bounded per-task write surfaces.
- **oq** — raise, list, answer, reconcile, reopen.
- **evidence** — register and query observed verification evidence.
- **progress** — record attempt deltas and detect repeated non-progress.

The exact tool surface should stay small and deep rather than mirror every internal state operation.

## Enforcement Hooks

OpenCode plugin hooks enforce:

### Permission boundary

Permission hooks deny writes outside the active worker task's allowed surface.

Static agent permissions provide the first boundary; task-scoped control adds the second.

### Evidence capture

Tool execution hooks record compact observations for non-Loom tool calls:
- session and agent identity when available;
- tool name and success/failure;
- timestamp;
- digests of input and result;
- redacted shell command or file path when safely available.

Raw tool output is not copied into the ledger by default.

Agents may create evidence claims only by referencing observations from their current session. Test/build/lint/security claims additionally require a recognized observed command of that class.

When a workflow step completes, its session observations are bound to that step. Reviewers can query the step's observations and claims directly.

An agent cannot create equivalent proof by merely writing prose.

### Context shaping

Session context hooks can add the current compact workflow/task envelope and remove tools that are not valid for the active role.

### Retry limits

Session retry and Loom progress state bound repeated attempts.

Identical failure + unchanged strategy beyond the configured limit routes upward or stops.

## OQ Board

Questions are shared workflow state, not messages carried manually by General.

An OQ records:
- the exact question and source evidence;
- the authority required to answer it;
- whether it blocks work;
- affected workflow-step consumers;
- the authoritative answer;
- per-consumer reconciliation.

Any active specialist may raise a question. The required authority reads and answers it directly from shared state. General schedules the required authority when needed but does not interpret or relay the question.

An answer is not closure when consumers already relied on the unresolved or prior meaning. Each declared consumer records `incorporated`, `unaffected`, or `explicitly-deferred`. Blocking work cannot complete until its relevant question is closed.

For a blocking question raised before downstream work begins, the raising step is automatically a consumer. Future dependent work consumes the corrected artifact normally and does not need ceremonial reconciliation merely because it is downstream.

Reopening explicitly preserves or invalidates the previous answer. Invalidating an answer clears prior reconciliation.

User-owned questions are the exception: General presents the exact stored question and records the exact user answer as user-sourced authority.

## Resource Bounds

V1 MUST hard-bound:
- repeated attempts;
- Reviewer correction cycles;
- Critic invocations;
- parallel workers;
- model request count or equivalent available execution counter.

Per-request token ceilings may be applied through OpenCode session hooks.

Exact monetary hard-stop enforcement is optional until OpenCode exposes reliable server-side cost accounting to the Loom plugin. Resource exhaustion still produces an honest resumable state.

## Storage

Workflow state must be project-scoped and inspectable.

The first implementation may use plugin durable storage keyed by project/workflow identity, with exportable workflow snapshots.

Do not store accepted product authority only inside plugin storage.

## Satisfies

- [BR-001](../../requirements/loom/br-001-run-autonomously-to-real-boundary.md)
- [BR-002](../../requirements/loom/br-002-route-missing-expertise-explicitly.md)
- [BR-005](../../requirements/loom/br-005-prevent-implementation-inventing-meaning.md)
- [BR-007](../../requirements/loom/br-007-evidence-outranks-model-claims.md)
- [BR-008](../../requirements/loom/br-008-bounded-autonomy-and-progress.md)

## OpenCode Basis

OpenCode V2 plugins expose agent/tool transforms, session hooks, permission hooks, durable JSON storage, custom tools, and session operations.

- https://opencode.ai/v2/docs/build/plugins
- https://opencode.ai/v2/docs/permissions


## Progress and dispatch budgets

Loom enforces a small execution budget independently of agent prose.

Initial defaults:
- total subagent dispatches per workflow: 40;
- ordinary step dispatches: 3;
- Reviewer dispatches per gate: 3;
- Critic dispatches per gate: 2;
- provider retries after the initial request: 2.

Permission hooks count authorized subagent dispatches using stable tool-call identity where available. A dispatch that exceeds its bound is denied.

Reopening failed work requires at least one explicit progress dimension: new evidence, changed hypothesis, changed strategy, or reduced unresolved work. The reopen reason is persisted.

These are safety defaults, not product semantics. Later configuration may tune them, but agents may not silently widen them during a run.


## Executable task DAG

Non-trivial product workflows contain a `plan` step owned by the disposable Planner context.

Planner registers a bounded task graph in workflow state. V1 validation requires:
- at least one task and no more than 24;
- stable unique task IDs;
- known acyclic dependencies;
- at least one verification expectation per task;
- bounded project-relative write scopes;
- no Worker authority over accepted Anchor, requirements, or architecture;
- no parallel tasks with potentially overlapping write surfaces unless dependency ordering makes them sequential.

Accepted tasks become real workflow nodes named `task:<id>`.

Each task carries:
- objective;
- dependencies;
- immutable write scope;
- suggested skills;
- verification expectations.

`review-implementation` depends on completion of every planned task.

The executable DAG is workflow state, not product authority. Changing product meaning still routes to Designer, Specifier, or Architect.

## Worker task scopes

For planned product work, the validated task DAG creates each Worker scope mechanically. General cannot widen a planned task's scope ad hoc; changing it requires reopening planning.

For the simple non-product `worker` path, General may declare a bounded scope directly.

Repository-wide wildcards and accepted authority roots (`docs/anchors`, `docs/requirements`, `docs/architecture`) are rejected.

The Worker child session must attach to the exact currently runnable workflow step before editing. Attachment returns the task envelope for planned work.

For every Worker edit permission evaluation, Loom checks the requested resource paths against the attached task scope and denies any edit outside that scope.

This V1 boundary governs OpenCode edit/write/apply-patch permissions. Arbitrary shell side effects are not path-contained by Loom and remain separately restricted through the Worker shell policy.


## Worker shell boundary

OpenCode shell commands run with the host user's authority, so Loom does not treat shell as equivalent to scoped edit tools.

Worker shell permission is restricted to a conservative inspection and verification allowlist. Compound commands, redirection, common write/fix flags, dependency installation, and arbitrary script execution are denied in V1.

External-directory access is denied for Worker.

This is intentionally restrictive. Mutation-heavy shell operations need a later controlled capability with stronger containment rather than a broader generic shell permission.


## Living-knowledge synchronization

Product workflows and structural maintenance include a `knowledge-sync` step after implementation review.

Documenter may update only current-reality knowledge surfaces:
- `docs/system/**`;
- `docs/user/**`;
- top-level `README.md` when setup/use materially changed.

Normative Anchor, requirements, design, and architecture remain owned by their existing authorities.

Before `knowledge-sync` may complete, Loom requires a structured knowledge report backed by an observed successful OKF-MCP discovery or verification call from the attached Documenter session.

A valid report either names changed knowledge documents or records a concrete reason why existing knowledge remains accurate.

If upstream work is reopened, the knowledge report is invalidated automatically and must be re-established before final product review.
