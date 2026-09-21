---
type: user-guide
title: Loom Runtime Upgrades
description: How Loom preserves ongoing sessions and migrates durable runtime state across upgrades.
tags: [user-guide, loom, upgrades, migration, sessions]
---

# Loom Runtime Upgrades

Loom upgrades are designed to preserve ongoing OpenCode sessions without weakening project/workflow isolation.

## Normal upgrade

After pulling a Loom upgrade, restart OpenCode as usual.

Loom records the canonical runtime-state version under the installation's durable state root and applies any required ordered upgrade steps before normal mutable execution. Completed upgrade steps have durable receipts and are not rerun.

## Resuming an older OpenCode session

If the session was already running before Loom introduced the current project-epoch storage model, its old workflow may not contain a Loom `projectId`.

A restarted **same OpenCode session** is reconciled automatically when Loom can prove all of the following through the host:

- the exact OpenCode session ID is the one bound to the legacy workflow/intent;
- the host session belongs to the current OpenCode project;
- the legacy record does not name a conflicting Loom project epoch.

The migrated workflow is assigned the current durable project epoch and a reconciliation receipt is stored. Existing workflow progress, budget, OQs, evidence and session attachment are migrated where present.

This is why restarting an old session after upgrading Loom is supported without asking the model to create a new workflow.

## When Loom still refuses

Loom refuses migration when:

- the OpenCode session belongs to another project;
- a different session tries to adopt the legacy binding;
- the legacy workflow explicitly names another Loom project epoch;
- only a filesystem path or caller-supplied workflow ID connects the state to the current project.

A chat/model confirmation such as “yes, migrate it” is deliberately **not** migration authority.

If a future migration cannot prove ownership safely, Loom stops rather than merging unrelated execution state.

## Future schema upgrades

The runtime upgrade ledger provides a single mechanism for later state-format changes:

1. read the current runtime-state version;
2. acquire the installation migration guard;
3. execute the next registered `fromVersion → toVersion` step;
4. commit the mutation, upgrade receipt and version advance together;
5. repeat until the build's target version is reached.

Upgrade steps must be idempotent. Loom refuses runtime state created by a newer build or a missing upgrade path instead of guessing.
