---
type: requirement
title: BR-017 — Concurrent Sessions and Projects Are Compartmentalized
description: Multiple simultaneous Loom/OpenCode sessions must not leak or collide across sessions, workflows, or repositories.
tags: [requirement, loom, isolation, concurrency, sessions, projects]
---
**Status:** proposed

## Statement

Loom MUST support multiple simultaneous OpenCode sessions in the same installation, including sessions working in different repositories or folders on unrelated objectives.

Every mutable execution record MUST belong to an explicit project identity and, where applicable, a workflow and session identity.

The **workflow is the execution-sharing compartment** inside a project. Session identity is provenance and an attachment/binding principal, not an automatic barrier between producer and verification sessions that intentionally participate in the same workflow.

A session MAY read workflow-shared state produced by another session only after the Loom control plane has explicitly bound or attached that session to the same project/workflow. Supplying a workflow ID, Objective ID, or step ID is never sufficient authorization by itself.

State from one project or unrelated workflow MUST NOT be read, mutated, claimed, reopened, completed, counted, or accepted as evidence for another project/workflow unless a Loom feature explicitly defines cross-project sharing.

The same relative Anchor path, Objective id, Task id, or other local identifier in two repositories MUST NOT collide. Reuse of a filesystem path by a different project epoch MUST NOT silently inherit the previous project's Loom state.

## Acceptance Criteria

1. Two concurrent sessions in different repositories may each run an active Loom workflow without affecting the other's workflow, OQs, evidence, budgets, verification requirements, task scopes, Product Acceptance, knowledge state, or work hierarchy.
2. Two concurrent sessions in the same repository may run independent workflows when Loom permits the underlying work to coexist; their session/workflow bindings remain distinct.
3. A session-to-workflow binding includes and validates project identity and is created only by a Loom-controlled start/dispatch/attachment path, not by trusting a caller-supplied workflow ID.
4. Fresh Worker, Reviewer, Acceptance, Critic, and other child sessions MAY consume workflow-shared state from another session when each session is explicitly bound to the same workflow. Step-scoped mutation still requires the exact attached step/role authority.
5. A session that is unbound, or bound to workflow A, cannot read or mutate workflow B merely by supplying workflow B's ID, even when both workflows belong to the same project.
6. Explicit workflow IDs cannot be used from a different project to bypass isolation.
7. Persistent Objective/work-hierarchy identity is project-scoped, so identical relative Anchor paths in different repositories remain distinct.
8. Worker permission checks use the calling session's project/workflow/step attachment and cannot inherit another session's scope.
9. Evidence observations retain session provenance; workflow-bound claims MAY be consumed by other sessions explicitly bound to the same workflow, but observations/claims cannot be relabeled or consumed across unrelated workflows/projects.
10. Shared workflow/work-hierarchy mutations from separate OpenCode+Loom processes are serialized by a cross-process correctness mechanism; an in-memory lock alone is insufficient.
11. Reopen, retry, failure, budget exhaustion, Product Acceptance, and completion in one compartment do not change another compartment.
12. Project identity creation is race-safe across processes: simultaneous first-open cannot create two durable identities for one project.
13. Project identity detects both path reuse and copied-marker collisions. A different project epoch appearing at a previously used canonical path, or a copied project marker appearing at a second still-existing root, cannot silently share/inherit the wrong namespace.
14. Existing single-session state can survive Loom upgrades without silently merging ambiguous records. A restarted OpenCode session MAY reconcile its own pre-project-epoch Loom binding when the host proves the exact same session ID and OpenCode project identity. After that exact workflow is canonicalized into the current project epoch, additional legacy sessions with durable pre-upgrade bindings to that exact workflow MAY reconcile through the canonical workflow's project identity even when an older host session lacks project metadata. This never authorizes a different workflow, another project, path-only inference, or model-supplied confirmation, and conflicting stored project provenance is always refused. Installation-wide schema upgrades migrate every affected canonical project namespace before advancing the shared version, commit migration data/receipt/version atomically, and fence already-running incompatible Loom processes from further canonical mutation after the version changes. Legacy plugin-storage records discovered only after the installation has advanced are transformed from their baseline format through the registered upgrade path before they can become canonical.
15. A session cannot silently switch from workflow A to workflow B. Rebinding is a Loom-controlled transition; it invalidates the previous step attachment and prevents selectors from the old binding being treated as current authority.
16. A cross-process mutation commit is crash-safe at the durable-record boundary: observers after abrupt process loss see either the complete previous generation or the complete new generation, never a torn/partial record.

## Architectural realization

This requirement is realized by [Runtime Isolation](../../architecture/loom/runtime-isolation.md), the [Project Epoch Identity](../../architecture/loom/decisions/project-epoch-identity.md) and [Cross-Process Mutation Guard](../../architecture/loom/decisions/cross-process-mutation-guard.md) decisions, and the [Runtime Scope Specification](../../architecture/loom/specs/runtime-scope.md).

## Verification Semantics

Use deterministic multi-project/multi-session tests with at least:

- project A and project B using the same relative Anchor path;
- two distinct OpenCode session IDs active concurrently;
- separate workflow IDs and task scopes;
- a fresh producer session and a fresh Reviewer/Critic session intentionally bound to the same workflow, proving legitimate cross-session evidence consumption;
- a same-project session attempting to access an unrelated workflow by supplying its workflow ID, proving rejection without a valid binding/attachment;
- deliberate attempts to read/mutate another project's workflow and evidence;
- two separate OpenCode+Loom process fixtures contending on the same workflow/objective, proving incompatible concurrent commits cannot both succeed;
- one workflow reopening/failing while the other remains unchanged;
- simultaneous first-open from two OpenCode processes, proving one canonical project epoch is established;
- path-reuse identity: unrelated project B appears at project A's former canonical path and cannot inherit A's state;
- a copied non-Git project marker appearing at a second live root, proving it is re-keyed/refused rather than merged;
- symlink/worktree/project-move cases consistent with the defined project-identity rules;
- controlled session rebinding from a terminal/released workflow to another workflow, proving the old step attachment no longer authorizes access;
- fault injection during guarded persistence, proving a reader observes either the old complete record or the new complete record, never a partially written generation;
- a transactional schema-upgrade fault after project mutation but before completion, proving project state, receipt and installation version all roll back together;
- a schema upgrade with old-format state in at least two project namespaces, proving every affected project is migrated before the installation version advances;
- a project whose legacy plugin state is first imported after the installation has already advanced, proving the imported records are transformed to the current schema atomically and a failed transform leaves no partial canonical import;
- two live processes representing old/new runtime versions, proving an old process that remains alive after the new process upgrades the store cannot perform another canonical project mutation;
- an in-progress pre-upgrade OpenCode session restarted after a Loom upgrade, proving its exact legacy session/workflow binding is reconciled into the new project epoch; then a second legacy session durably bound to that same now-canonical workflow can reconcile without laundering an unrelated workflow, another project, or conflicting stored project epoch.

Valid proof shows independent state snapshots, intended same-workflow sharing, explicit rejection of unrelated compartment access, and serialized cross-process mutation.

Passing tests with globally unique synthetic IDs alone is insufficient; collision-prone local identifiers, stale/path-reuse identity, and real multi-process contention must be exercised deliberately.

## Derived from

- [Loom Anchor](../../anchors/loom/anchor.md)

## Depends on

- [BR-001 — Run Autonomously to a Real Boundary](br-001-run-autonomously-to-real-boundary.md)
- [BR-007 — Evidence Outranks Model Claims](br-007-evidence-outranks-model-claims.md)
- [BR-008 — Bounded Autonomy and Progress](br-008-bounded-autonomy-and-progress.md)
