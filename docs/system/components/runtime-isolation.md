---
type: component
title: Loom Runtime Isolation
description: Project identity, scoped durable state, cross-process mutation and session/workflow attachment.
tags: [component, loom, runtime, isolation, concurrency]
---

# Runtime Isolation

## Purpose

Allow several OpenCode+Loom processes and sessions to work concurrently without leaking or colliding across projects or unrelated workflows.

## Identity

- one Loom installation has a persisted `installationId`;
- each project epoch has a UUID marker independent of canonical path;
- Git worktrees use worktree-private marker storage;
- non-Git projects use `.loom/project-id`;
- path reuse creates a new project epoch;
- a copied live marker is re-keyed rather than merged.

## Durable state

`plugins/loom/runtime.ts` stores execution state in:

```text
<XDG_STATE_HOME>/loom/execution-state.sqlite
```

Execution keys are project-scoped by default. Installation identity and cross-project learning are explicit global exceptions.

Canonical execution state carries a versioned runtime-schema ledger. Schema and correctness-protocol upgrades are ordered, idempotent and receipt-backed under the migration lock. Runtime version 6 fences version-5 processes before specialist step-attempt/write-scope authority can become current shared state. Project-format upgrades enumerate every canonical project namespace and commit all project/installation mutations, the receipt and version advance atomically. Normal project mutations are version-fenced, so an already-running older Loom process fails closed after another process advances the shared schema and must be restarted. Late legacy plugin-state imports are treated as baseline-version input and replay the registered idempotent upgrade callbacks transactionally before becoming canonical.

Legacy OpenCode plugin records are imported/migrated only when provenance is unambiguous. In-place upgrades may reconcile the exact state of a resumed OpenCode session when the host proves the same session ID and OpenCode project identity and no conflicting Loom project epoch exists. After that workflow is canonical in the current project epoch, additional pre-upgrade sessions with durable legacy bindings to that exact workflow may inherit the canonical workflow's project provenance even when old host project metadata is absent. Baseline-format unscoped records are upgraded through the registered project schema path before becoming canonical in a newer runtime. Each reconciliation writes an audit receipt; a different workflow, explicit project mismatch, path guess, or free-form confirmation never counts as provenance. A later canonical session rebind outranks stale compatibility bindings permanently. Other ambiguous pre-project-epoch state remains unmigrated and is reported.

## Cross-process correctness

The installation persists one absolute lock root in `runtime-root.json`. Every process sharing the durable Loom state uses that same root even when its local `XDG_RUNTIME_DIR` differs or is missing.

Workflow and work aggregates use OS-backed advisory locks. Multi-aggregate operations acquire locks in canonical order, re-read durable state, validate revisions/generations/claims, then commit transactionally.

The SQLite store uses WAL + FULL synchronous durability. Identity files use file sync plus directory sync before publication is treated as committed.

## Workflow sharing and sessions

The workflow is the execution-sharing compartment.

- General issues an unguessable, expiring, single-use dispatch grant for an exact workflow step or OQ.
- The fresh child session consumes that grant through `loom_attach`.
- Workflow-shared reads are available only after session binding.
- Step mutation requires the exact attached step and role.
- Durable specialist artifact mutation additionally requires the exact current step attempt; an explicit step scope may narrow but never widen the role's artifact ceiling.
- Scope, attachment, completion, reroute and reopen transitions serialize with active step mutations.
- Knowing a workflow ID is never sufficient authority.
- Rebinding away from an active workflow requires a Loom-controlled terminal/release transition.

## Verification

Current tests cover project/path/copy/worktree identity, first-open races, crash rollback, mixed-runtime-root processes, lock ordering, wrong-project grants, legacy refusal/migration, fresh Worker/Reviewer attachment, specialist step-scope/attempt invalidation, and mutation-vs-lifecycle serialization through the registered plugin tool boundary.

Normal CI starts real headless OpenCode 2.0.15 servers with Loom loaded and verifies independent projects/sessions sharing one installation. It also persists pre-upgrade OpenCode sessions through a real host shutdown/restart, swaps the legacy Loom fixture for the current plugin, and proves the same primary and secondary session IDs reconcile their ongoing workflow after restart.

## Source

- `plugins/loom/runtime.ts`
- `plugins/loom/runtime.test.ts`
- `plugins/loom/plugin-boundary.test.ts`
- `scripts/opencode-host-integration.ts`
- `docs/user/upgrades.md`
