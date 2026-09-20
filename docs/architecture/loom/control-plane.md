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
- **task** — register/claim/complete bounded work and declared write surface.
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
