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

Tool execution hooks observe completed shell/tool operations and register provenance for verification-relevant events.

An agent cannot create equivalent proof by merely writing prose.

### Context shaping

Session context hooks can add the current compact workflow/task envelope and remove tools that are not valid for the active role.

### Retry limits

Session retry and Loom progress state bound repeated attempts.

Identical failure + unchanged strategy beyond the configured limit routes upward or stops.

## OQ Board

Questions are shared workflow state, not messages carried manually by General.

An OQ records:
- question;
- required authority;
- source evidence;
- blocking scope;
- answer;
- consumers;
- reconciliation status.

Agents query OQs relevant to their role/task.

The control plane validates that answers come from the required authority profile before treating them as authoritative.

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
