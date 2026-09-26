---
type: design
title: Loom Runtime Isolation
description: Project/session/workflow compartmentalization for safe concurrent Loom execution across OpenCode processes and repositories.
tags: [architecture, loom, isolation, sessions, projects, concurrency]
---

**Status:** proposed

## Purpose

Loom treats several simultaneous OpenCode sessions, processes, repositories, worktrees, and folders as normal operation.

Runtime isolation is therefore a correctness boundary, not dashboard plumbing. Unrelated work must remain compartmentalized even when it shares one Loom installation and durable storage domain.

This design owns **execution identity, compartment membership, scoped storage, cross-process mutation, and migration**. Dashboard projection and UI are specified separately in [Dashboard Observability](dashboard-observability.md).

## Current implementation observation

The current control plane already has useful session-local bindings:

- `session/<sessionID>` points at an active workflow;
- `session-step/<sessionID>` binds an attached specialist/Worker step;
- evidence is indexed by session and later bound to workflow/step.

That is a good start, but the durable namespace is not consistently project-scoped.

Examples in the current implementation include:

- `workflow/<workflowId>`;
- `acceptance/<workflowId>`;
- `knowledge/<workflowId>`;
- `budget/<workflowId>`;
- `scope/<workflowId>/<stepId>`;
- `work/<objectiveId>`.

Most workflow IDs are UUID-like and therefore unlikely to collide accidentally, but "unlikely to collide" is not the isolation contract.

The clearest deterministic collision is persistent work identity: `objectiveIdForAnchor(anchor)` currently derives identity from the Anchor path alone. Two repositories with the same relative path such as `docs/anchors/app/anchor.md` therefore resolve to the same logical Objective key if they share the same plugin storage namespace.

The design must remove reliance on globally unique local names.

## Isolation model

Every Loom execution operation resolves a **Runtime Scope**:

```text
RuntimeScope
├── installationId
├── instanceId
├── projectId
├── sessionId
├── workflowId? 
└── stepId?
```

### Installation identity

`installationId` identifies the user's Loom installation/storage domain.

It is useful for dashboard grouping and migration but does not replace project isolation.

### Instance identity

`instanceId` identifies one running OpenCode+Loom process/runtime.

It is ephemeral enough to distinguish simultaneous processes and stable for that process lifetime.

A restarted OpenCode process receives a new runtime instance identity while durable project/workflow state remains addressable through project/workflow identity.

### Project identity

`projectId` is the mandatory namespace for mutable Loom execution state.

A canonical path is **location metadata**, not durable identity. V1 uses a project **epoch identity** that can detect path reuse.

For Git worktrees, Loom stores a generated project UUID in the worktree-private Git administration directory returned by Git (for example under `<worktree-git-dir>/loom/project-id`). The marker is not part of the tracked working tree. A clone or unrelated repository has a different marker even when it later occupies the same filesystem path.

For non-Git folders, Loom stores the generated UUID in a Loom-owned project marker such as `<project>/.loom/project-id`. The marker is operational metadata, not product authority. If the folder is not writable enough to create/read a durable marker, Loom MUST NOT claim durable compartmentalized identity for that folder; it may operate only in an explicitly non-durable mode until identity storage is available.

An installation-local registry indexes project IDs to current canonical locations for discovery/dashboard purposes. The marker remains the identity source, but the registry is an integrity guard against copied markers and ambiguous moves.

Project identity initialization is itself cross-process safe:

1. acquire an installation-wide identity lock for the canonical real path;
2. if a valid marker exists, read it;
3. otherwise create the marker with create-if-absent/atomic semantics; a losing process re-reads the winner's marker rather than keeping its own generated UUID;
4. reconcile that project ID against the installation registry under the same guard;
5. only then allow durable Loom execution state to resolve.

If the same project marker appears at a second canonical root while the registry's previous root still exists, Loom treats it as a **copy collision**, not one shared project. The newly discovered copy receives a new project epoch/marker (or durable execution is refused if the marker cannot be safely rewritten). If the previous root no longer exists, the registry may treat the new root as an unambiguous move and preserve the project ID.

The resulting model is:

```text
projectId = stable UUID for one project epoch
project metadata = {
  canonicalLocation,
  identitySource,
  markerLocation,
  filesystemFingerprint?,
  firstSeenAt,
  lastSeenAt
}
```

Identity rules are explicit:

- **symlink aliases** resolve through canonical real path and address the same project epoch;
- **Git worktrees** have distinct worktree-private markers and therefore distinct project identities even when they share a Git common directory;
- **moves/renames** preserve identity when the Loom project marker moves with the project and can be re-associated unambiguously;
- **copies/clones** without the original operational marker are a new project epoch; if a non-Git copy also copies `.loom/project-id`, simultaneous existence at two canonical roots is detected as a copy collision and the newcomer is re-keyed/refused rather than silently sharing state;
- **path reuse** by an unrelated project always creates a new project identity because it has a different/no marker; stale state under the old project namespace is never selected by path alone.

The human-readable location remains metadata for display and diagnostics.

### Session identity

`sessionId` is the OpenCode session identity.

A session binding is valid only inside its project:

```text
(projectId, sessionId) -> workflowId
```

A session ID without project identity is insufficient for Loom state resolution.

Session identity is provenance and a binding principal. It is **not** the sharing boundary for all workflow state: fresh Worker, Reviewer, Acceptance, Critic, and other child sessions intentionally consume state produced by other sessions in the same workflow.

### Workflow identity and membership

`workflowId` remains globally opaque/unique, and every workflow record carries `projectId`.

Shared workflow state also carries a monotonic `revision` incremented under the workflow cross-process mutation guard. That revision is the durable ordering signal for dashboard projections from multiple processes; per-instance snapshot generation is not comparable across instances.

Persistent Objective/Phase/Wave/Task state already carries its own monotonic aggregate version. That work-hierarchy version is independently projected and ordered; workflow revision never substitutes for work-hierarchy freshness.

The workflow is the execution-sharing compartment inside one project.

A caller-supplied workflow ID is only a selector. It never grants access by itself.

A session gains workflow membership only through a Loom-controlled path:

1. the General session that starts/resumes a workflow is bound by the control plane;
2. during an already-authorized child dispatch, an already-bound parent session causes Loom to create a one-use attachment authorization for the exact `projectId + workflowId + stepId/OQ + agent`;
3. the fresh child consumes that authorization when attaching/binding;
4. the resulting session binding records the exact workflow, and step attachment records the exact step/agent when mutation authority is step-scoped;
5. an authorization cannot be reused for a different session/workflow/step.

The implementation may realize the attachment authorization through trusted parent/child session metadata when OpenCode exposes it reliably, or through an opaque one-time dispatch grant. When a grant is used, its grant ID is cryptographically random/unguessable and its durable/scoped record contains at least `projectId`, `workflowId`, exact `stepId` or OQ identity, expected `agent`, issuing parent session, creation/expiry time, and consumed status. Consumption validates project, expected agent and unexpired/unconsumed state, records the consuming child `sessionId`, and is atomic under the workflow mutation guard; the grant is then deleted or irreversibly marked consumed.

In either case, **knowledge of the workflow ID alone is not authorization**.

Once bound:

- read-only workflow-shared state and workflow-bound evidence may be consumed across sessions that belong to the same workflow;
- session provenance remains attached to observations;
- step mutation requires the calling session's exact step attachment and role authority;
- a session bound to workflow A cannot access workflow B merely because B belongs to the same project.

### Binding lifecycle

A project-local OpenCode session has at most one **current** workflow binding.

A current binding may change only through a Loom-controlled start/resume/release transition. Rebinding:

1. verifies the previous binding is terminal or explicitly released by Loom;
2. clears the prior current step/OQ attachment before the new binding becomes visible;
3. establishes the new workflow binding under the same project scope;
4. makes old workflow/step selectors historical only — they cannot authorize current reads or mutation through the rebound session.

Fresh child sessions normally end with their one workflow/step attachment. A later unrelated use of the same OpenCode session must obtain a new Loom-controlled binding rather than inheriting the old one.

Supplying a valid workflow ID from the wrong project or unrelated same-project workflow must be rejected.

### Objective identity

Objective identity is project-local:

```text
(projectId, objectiveLogicalId)
```

The same Anchor-relative path in two repositories is therefore two different Objectives.

## Storage namespace

New durable execution state uses a project-prefixed namespace.

Conceptually:

```text
project/<projectId>/workflow/<workflowId>
project/<projectId>/session/<sessionId>/workflow
project/<projectId>/session/<sessionId>/step
project/<projectId>/intent/<intentId>
project/<projectId>/session/<sessionId>/intent
project/<projectId>/work/<objectiveId>
project/<projectId>/oq/<workflowId>/<questionId>
project/<projectId>/oq-index/<workflowId>
project/<projectId>/acceptance/<workflowId>
project/<projectId>/knowledge/<workflowId>
project/<projectId>/budget/<workflowId>
project/<projectId>/limits/<workflowId>
project/<projectId>/verification/<workflowId>
project/<projectId>/scope/<workflowId>/<stepId>
project/<projectId>/dispatch-grant/<grantId>
project/<projectId>/evidence/<evidenceId>
project/<projectId>/evidence-session/<sessionId>/<evidenceId>
project/<projectId>/evidence-step/<workflowId>/<stepId>/<evidenceId>
project/<projectId>/evidence-claim/<workflowId>/<stepId>/<claimId>
project/<projectId>/evidence-claim-id/<claimId>
```

This list is illustrative, not exhaustive. Before implementation, the scoped-store migration MUST inventory every mutable execution key family in the plugin and classify it as project-scoped, workflow/session-scoped, or an explicit installation-global exception such as advisory learning.

The implementation should hide these strings behind a scoped storage helper rather than let tools build keys ad hoc.

## Compartment access rule

For every tool/hook operation that touches mutable execution state:

1. derive the caller's current `projectId` from OpenCode context;
2. resolve the caller's session binding inside that project;
3. when an explicit workflow/objective identifier is supplied, load it only from that project's namespace;
4. validate stored `projectId` metadata;
5. for workflow-scoped access, require the caller's session binding/attachment to authorize that workflow; explicit IDs do not bypass membership;
6. for step-scoped mutation, require the exact attached step and role authority;
7. reject mismatch rather than searching globally for a matching ID.

Cross-session access is therefore intentional only inside the same workflow compartment. A Reviewer/Critic may consume workflow-bound evidence created by a Worker in another fresh session after both sessions are legitimately bound to that workflow.

No "fallback global search" is allowed for execution state.

## Learning exception

Cross-project learning is intentionally different from workflow state.

Episodes already record project provenance. Heuristics may be reusable across projects.

Therefore:

- execution state is project-isolated by default;
- learning may remain installation-global/advisory;
- every recalled episode retains source-project identity;
- learning can never act as execution authority.

The dashboard may filter or aggregate learning separately, but it must not blur that distinction.

## Concurrency and cross-process mutation

Multiple OpenCode+Loom processes are normal operation, so an in-memory mutex cannot be the correctness boundary.

V1 uses a host-local **cross-process mutation guard** shared by every process in the same Loom installation.

Conceptually:

```text
<persisted-installation-lock-root>/locks/<installationId>/<projectId>/workflow/<resourceHash>.lock
<persisted-installation-lock-root>/locks/<installationId>/<projectId>/work/<resourceHash>.lock
```

`resourceHash` is a filesystem-safe digest of the full scoped aggregate key, so local identifiers cannot escape or alias the lock namespace.

The lock root is installation-scoped, not instance-scoped: every process that shares one Loom durable storage domain MUST resolve the same lock root. The first process atomically persists the installation's chosen absolute lock root in durable Loom installation metadata, preferring `$XDG_RUNTIME_DIR/loom` when usable and otherwise choosing the user-private XDG state fallback. Later processes use that persisted root regardless of their own environment. A process that cannot access the persisted shared root cannot participate in mutable shared Loom state and MUST NOT choose another fallback. Lock files are user-only and are never a dashboard/control interface.

The correctness protocol is:

1. determine every aggregate that will be mutated;
2. acquire exclusive OS-backed advisory locks for those resource keys in canonical lexical order;
3. **after acquiring the locks**, re-read the latest durable records;
4. validate workflow/project membership, expected version/generation, claim ownership, and other preconditions against that fresh state;
5. apply the mutation and increment the aggregate version/generation where applicable;
6. persist with an atomic/transactional durable commit while the lock remains held;
7. only after the complete new record is durable, release the OS locks.

The advisory lock orders writers; it is not itself a crash-safe storage primitive. Each guarded aggregate write must guarantee that abrupt process death exposes either the previous complete record or the next complete record, never a torn/partially serialized generation. File-backed records therefore require same-filesystem temporary-write + atomic replacement (and durability flush where the backing API exposes it), while transactional stores may use their native atomic commit.

Process death releases the advisory lock automatically. A stale process that resumes from old in-memory state must re-acquire and re-read before any commit, so stale state cannot overwrite a newer generation.

Resource granularity:

- workflow lock: workflow transitions, budgets, verification state, OQ indexes, completion/reopen and other shared workflow aggregates;
- work/objective lock: persistent Objective → Phase → Wave → Task hierarchy and Wave/Task claims;
- operations touching both acquire both in canonical order.

Repository file mutation uses a separate project-scoped OS-backed advisory lock per concrete path. Task scopes may overlap and dirty Git state is not a lock. Immediately before an admitted edit/write/apply-patch or bounded file-mutating shell operation executes, Loom attempts to acquire every affected path lock without waiting. A second live writer targeting the same path receives a retryable write-lock error. The lock remains held for the whole tool call, is released when the tool returns, and is released automatically if the owning process exits.

An in-memory lock MAY remain as a local optimization but is never sufficient proof of serialization.

Parallel sessions/processes in different projects must never serialize merely because they use the same local Objective/Task names.

Parallel sessions/processes in the same project may coordinate through the shared project/workflow state only under this cross-process guard.

V1 assumes one user's Loom installation/storage domain is host-local. If Loom later supports one mutable store shared across hosts, this guard must be replaced/supplemented by storage-native transactions/CAS or a distributed lease with fencing before multi-host mutation is permitted.

## Migration

Existing unscoped keys cannot simply be renamed blindly.

Migration and upgrade strategy:

1. establish the current project epoch identity before any legacy lookup;
2. initialize/validate the installation's versioned runtime-schema ledger before normal mutable execution;
3. future canonical-store schema changes run as ordered, idempotent upgrade steps under the installation migration guard; project-format steps are invoked by the framework for every canonical project namespace before the installation version advances; all project mutations, installation mutations, the durable receipt, and version advance share one transactional commit boundary;
4. new writes use the scoped namespace only;
5. reads may perform a bounded legacy lookup when the scoped record is absent;
6. a legacy record is migrated when its project can be established unambiguously from stored workflow metadata, from exact resumed-session continuity supplied by the OpenCode host, **or from an already-canonical scoped workflow for that exact legacy workflow binding**; canonical path alone is never sufficient proof after path reuse;
7. resumed-session continuity requires the exact legacy session binding, exact resumed OpenCode session ID, matching OpenCode project identity, and no conflicting stored Loom project epoch;
8. after one pre-epoch workflow is safely canonicalized, its scoped `projectId` is durable provenance for additional legacy sessions whose stored `session/<sessionId>` binding names that exact workflow. Missing host project metadata may then be tolerated, but an explicit host-project mismatch, a different workflow, or conflicting legacy project epoch is still refused;
9. free-form user/model confirmation is not provenance and cannot authorize migration;
10. pre-project-epoch unscoped records copied after the installation has advanced beyond baseline are transformed through the registered idempotent baseline→current **project** upgrade path before they become readable as canonical current-version state; copy + transform + reconciliation receipt share one canonical transaction;
11. if a canonical scoped session binding already exists, it outranks compatibility state. Legacy data may complete missing pieces only when the legacy binding still names that same workflow; a stale legacy A binding after a controlled canonical rebind to B cannot provide provenance or import intent/work into B;
12. migration runs under the same cross-process mutation guard as the destination aggregate;
13. ambiguous or conflicting legacy records are reported, not merged;
14. successful continuity/canonical-workflow reconciliation writes a durable receipt identifying the target project epoch, hashed source session, provenance kind, and any baseline→current upgrade steps applied;
15. once migrated, the scoped record becomes canonical and future mutations never update the legacy execution key;
16. migration tests include transactional rollback of a failed schema upgrade, all-project project-format migration, pre-project-epoch continuity into a synthetic newer schema with failed-transform rollback, a controlled A→B rebind restarted while stale legacy A remains, a live old/new process version-skew case where the old writer is fenced after upgrade, identical Anchor paths, stale/path-reuse, resumed pre-upgrade sessions, secondary legacy sessions bound to an admitted canonical workflow, unrelated workflows, mismatched sessions, conflicting project provenance, and real OpenCode stop/restart of persisted pre-upgrade sessions.

Migration is a compatibility mechanism, not a permanent dual-authority mode. The runtime-schema ledger is the mechanism for future upgrades; per-session legacy reconciliation exists only where an older schema did not record enough project identity for an eager installation-wide migration.

Runtime upgrade callbacks operate on migration payload, never on the framework's own control ledger. The bounded installation capability hides `installation/runtime-schema` and `installation/runtime-upgrades/*` from direct access and broad scans. The framework passes each callback explicit source/target versions and whether it is running as the canonical upgrade, a late plugin-storage import, or a legacy-session import. Canonical callbacks run before their version advance; late-import callbacks may run after the installation ledger has already advanced, so their explicit context—not the hidden ledger—defines the transformation being replayed.

The installation-wide schema version is authoritative across all canonical project namespaces. A project-format step cannot advance that version after migrating only the project that happened to start Loom first: the framework enumerates persisted project registries and project namespaces and invokes the step for every one before commit. Normal project-scoped mutations are runtime-version fenced. Cross-process correctness protocol changes also advance this version even when no durable payload shape changes; the scoped-file-write-lock transition uses that fence so an already-running pre-lock writer cannot bypass the new serialization boundary. If another process upgrades the shared store, an already-running older Loom process fails closed on its next canonical project-state access/mutation and must restart with the current build. A mutation already in flight serializes through the SQLite transaction boundary before the upgrade, so the upgrade transforms its committed old-version result rather than racing an incompatible write.

Legacy OpenCode plugin storage is treated as baseline-version input even when it is discovered **after** the canonical installation has already advanced. A late legacy import copies and transforms its current project's records plus imported global learning state through the registered idempotent baseline→current callbacks inside one installation migration transaction before the import marker commits. Pre-project-epoch unscoped session continuity follows the same schema rule for project records inside its canonical migration transaction. Late-returning projects and resumed old sessions therefore cannot inject old-format records into a newer canonical store.

## Runtime failure semantics

- inability to establish an unambiguous durable project identity prevents durable Loom execution for that project;
- inability to access the installation-shared mutation guard prevents participation in mutable shared Loom state;
- ambiguous legacy records are reported and left unmigrated rather than guessed or merged; exact resumed-session continuity is accepted only under the bounded host-proof rule above;
- a stale process must re-acquire the cross-process guard and re-read current durable state before committing;
- cross-project or unrelated-workflow access mismatch is rejected, never repaired through a global fallback search;
- non-Git folders that cannot persist a project marker may run only in an explicitly non-durable mode whose state cannot be mistaken for durable compartmentalized execution.

## Security

- workflow IDs, Objective IDs, Task IDs, paths, and other caller-supplied selectors are not authorization;
- session-to-workflow membership is established only through Loom-controlled start/resume/attachment paths;
- one-use dispatch grants are unguessable, scoped, expiring, and atomically consumed;
- step mutation requires the exact bound project/workflow/step plus role authority; an explicit step write scope may narrow that authority but cannot expand the role's artifact ceiling;
- project markers and installation registries are operational identity metadata, not product authority;
- lock files are user-private operational coordination and are never an external control surface.

## Implementation sequence

1. Introduce the Runtime Scope/project-epoch identity primitive and installation registry.
2. Introduce the scoped-store/key helpers and migrate every mutable execution key family behind them.
3. Introduce Loom-controlled session/workflow membership and single-use child attachment grants.
4. Introduce the installation-shared cross-process mutation guard with re-read-after-lock/version validation.
5. Add deterministic multi-project, multi-session, multi-process, path-reuse, worktree, move, copy-collision, and migration tests.
6. Only after this contract is proven may dashboard aggregation rely on compartment identity.

## Related decisions and specification

- [Project Epoch Identity](decisions/project-epoch-identity.md)
- [Cross-Process Mutation Guard](decisions/cross-process-mutation-guard.md)
- [Runtime Scope and Scoped Storage Specification](specs/runtime-scope.md)

## Non-goals

This design does not:

- define dashboard layout or user interaction;
- make all sessions mutually isolated when they intentionally belong to the same workflow;
- merge unrelated repositories into one Loom authority domain;
- require one shared OpenCode process;
- require all sessions to use the same provider/model/profile;
- make cross-project learning executable authority;
- define multi-host shared mutation in V1.

## Satisfies

- [BR-001](../../requirements/loom/br-001-run-autonomously-to-real-boundary.md)
- [BR-007](../../requirements/loom/br-007-evidence-outranks-model-claims.md)
- [BR-008](../../requirements/loom/br-008-bounded-autonomy-and-progress.md)
- [BR-017](../../requirements/loom/br-017-concurrent-sessions-projects-compartmentalized.md)
