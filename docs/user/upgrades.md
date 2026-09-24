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

When adopting a Loom release that introduces or changes runtime-version fencing, stop/restart all already-running OpenCode+Loom processes once. A process still executing code from before the fence existed cannot be retroactively intercepted by newer code; the durable fence protects version-skew between fence-capable releases going forward.

Loom records the canonical runtime-state version under the installation's durable state root and applies any required ordered upgrade steps before normal mutable execution. Completed deterministic upgrade steps have durable receipts and are not rerun.

Some upgrades also introduce **semantic compatibility actions** that cannot be manufactured safely by a storage migration. Loom derives those actions from current authoritative state. They are scoped to the thing that actually needs adoption (for example an Objective), exposed through `loom_upgrade_status`, and disappear automatically once the new invariant is satisfied. There is no model acknowledgement flag to clear.

## Resuming an older OpenCode session

If the session was already running before Loom introduced the current project-epoch storage model, its old workflow may not contain a Loom `projectId`.

A restarted **same OpenCode session** is reconciled automatically when Loom can prove all of the following through the host:

- the exact OpenCode session ID is the one bound to the legacy workflow/intent;
- the host session belongs to the current OpenCode project;
- the legacy record does not name a conflicting Loom project epoch.

The migrated workflow is assigned the current durable project epoch and a reconciliation receipt is stored. Existing workflow progress, budget, OQs, evidence and session attachment are migrated where present. If the installation has already advanced to a newer runtime schema, those older baseline-format project records are upgraded inside the same canonical transaction before the resumed session can read them as current state.

After that workflow has been safely admitted to the current project epoch, other pre-upgrade sessions that already have a durable legacy binding to **that exact same workflow** can also be reconciled. This covers older Planner/Worker/Reviewer/etc. sessions whose OpenCode host metadata may no longer expose the original project field after an upgrade. Loom uses the already-canonical workflow as provenance; it does not infer ownership from a path or a caller-supplied workflow ID.

This is why restarting an old session after upgrading Loom is supported without asking the model to create a new workflow or abandon the ongoing Objective.

If Loom later performs a controlled rebind of that session to another canonical workflow, the newer canonical binding wins permanently. Historical compatibility storage is not rewritten and may still mention the old workflow, but Loom will no longer use that stale binding, intent, or work data as migration authority after restart.

## When Loom still refuses

Loom refuses migration when:

- the OpenCode session explicitly belongs to another project;
- a session has no durable legacy binding to the already-admitted workflow it is trying to resume;
- the legacy workflow explicitly names another Loom project epoch;
- only a filesystem path or caller-supplied workflow ID connects the state to the current project.

A chat/model confirmation such as “yes, migrate it” is deliberately **not** migration authority.

If a future migration cannot prove ownership safely, Loom stops rather than merging unrelated execution state.

## Semantic compatibility actions

Runtime version 4 adds the first semantic compatibility action: `holistic-plan-adoption-v1`.

An active Objective created before holistic Plan snapshots is detected when its current generation exists but has no rich Plan snapshot. Loom does **not** synthesize rationale, acceptance criteria, risks, integration semantics, or authority mappings from the legacy Task DAG.

Instead:

1. the plugin injects one short compatibility notification only into the Objective's coordinator/General context while the action exists;
2. General calls `loom_upgrade_status` for the one-shot instructions;
3. if a Wave is claimed, that admitted Wave keeps its existing contract and completes/reviews normally; Task-linked peer OQs remain usable during this deferred period and carry bounded legacy Task context until a rich Plan exists;
4. adoption happens at the next natural Objective planning boundary rather than reopening reviewed work solely for migration;
5. a fresh Planner receives the pending upgrade action in `loom_attach` and reconstructs the remaining Objective from accepted authority plus durable completed-work evidence;
6. once the current generation has a rich Plan snapshot, the action is state-satisfied and disappears for every session observing that Objective.

Completed legacy work remains historical truth. Planner may classify obligations as already satisfied only when durable evidence actually proves that result.

## Future schema upgrades

The runtime upgrade ledger provides a single mechanism for later state-format changes:

1. read the current runtime-state version;
2. acquire the installation migration guard;
3. enumerate every canonical project namespace when the step changes project-scoped state;
4. execute the next registered `fromVersion → toVersion` installation/project migration callbacks;
5. commit every affected project mutation, installation mutation, upgrade receipt and version advance together;
6. repeat until the build's target version is reached.

Upgrade callbacks cannot inspect or modify Loom's framework-owned `installation/runtime-schema` or `installation/runtime-upgrades/*` records. Those keys are hidden even from broad installation scans; callbacks receive explicit source/target version and execution-phase context instead. Canonical upgrade callbacks run before the durable version advances; late compatibility replay may happen after it has advanced, and uses the explicit replay context rather than treating the current ledger value as source-version input. This prevents a migration payload transform from manufacturing, deleting, or rewriting the receipts/version metadata that proves the migration itself.

Upgrade steps must be idempotent. A failed transactional step leaves the prior complete version/data generation intact. Loom refuses runtime state created by a newer build or a missing upgrade path instead of guessing.

A project that has not been opened for a long time may still have records only in OpenCode's older plugin storage. If that project returns after the canonical Loom installation has already advanced to a newer runtime schema, Loom treats those records as baseline-version input and runs the registered idempotent upgrade callbacks over the imported project/global records before committing them. The same baseline→current transformation rule applies when an old **unscoped** session/workflow is reconciled lazily after the installation has advanced. The old-format records are never exposed as canonical newer-version state.

### Already-running OpenCode processes

An upgrade may happen while another OpenCode+Loom process from the previous build is still alive. Loom does not let that older process keep writing after the shared runtime schema advances.

Every normal project mutation validates the durable runtime version against the running build in the same transaction as the write. If another process upgrades the installation, an older still-running process fails closed on its next canonical project-state access/mutation and must be restarted with the current Loom build.

A mutation already in flight before the upgrade is serialized by the canonical SQLite transaction boundary; the upgrade runs after that old-version mutation commits and migrates its result.


## Cancelling or replacing a stuck workflow

After installing an update that advances the runtime fence, stop/restart all OpenCode+Loom processes. Runtime version 4 preserves existing records while fencing version-3 and older writers before holistic Plan adoption can mutate shared state. Do not downgrade against that upgraded store.

In the original General session, a request such as **“Abort this workflow, keep completed work, and start the replacement plan we agreed on”** authorizes cancellation and that replacement. General calls `loom_cancel` with the workflow ID, a reason and your exact confirmation, then checks the result before calling `loom_start`. Both native `loom_cancel` and the Code Mode mirror `tools.loom.code.cancel` use the same operation. This is an agent tool, not a shell command.

The old workflow remains visible as **cancelled** in status, sidebar and dashboard. Its completed Tasks, evidence and review outcomes remain available; unfinished checks stay unfinished. The Objective stays active/incomplete unless it had already independently completed. Cancellation does not revert files or stop a tool that was already running outside Loom.

The operation works before planning and after a completed Wave no longer has a live claim. Repeating it is safe, including after starting the replacement. Missing work state and claims belonging to another workflow are reported; those foreign claims are not released. A different General session cannot cancel a workflow merely by knowing its ID: resume the owning session rather than editing the database.

For the old **“Wave ... is claimed by nobody”** closure failure, upgrading may also let the owning Documenter finish normally when the completed Wave has uniquely provable stored review history. That missing live claim is expected after successful implementation review. Ambiguous history is not converted into proof; an explicit cancellation is still available to leave the workflow and create a separately authorized replacement.

Do not use `loom_work_release` as an abort command, delete runtime storage, rerun completed implementation, or manufacture a failed gate to escape a binding. Cancelled children cannot resume old work; a reused child needs a new exact grant for a different active workflow. Fully successful terminal workflows remain unchanged. Failed-terminal workflows still release claims and revoke unused grants on cancellation, while preserving the failed gate results. The owning General can perform that cleanup even after starting a replacement.


A cancelled child using Code Mode must use a single direct recovery call, with JSON arguments, for example `return await tools.loom.code.attach({"workflowId":"...","stepId":"...","grantId":"..."})`. The outer wrapper allows this narrow form, not arbitrary code. History reads have the same single-call form. Invalid or old grants still fail.

Proof now requires matched before/after observation of an operation on an unchanged attachment and step attempt. A result arriving after cancellation, rebinding or an observer restart stays passive history rather than proof for new work. Run a fresh verification operation when proof is needed; do not relabel the old result. Existing stored history is retained.
