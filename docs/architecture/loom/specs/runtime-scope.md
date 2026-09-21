---
type: specification
title: Runtime Scope and Scoped Storage Specification
description: Exact identity, membership, namespace, and mutation contract for Loom concurrent execution.
tags: [architecture, specification, loom, isolation, storage]
---

**Status:** proposed

## Identity primitives

V1 uses these identities:

| Field | Format/source | Lifetime |
| --- | --- | --- |
| `installationId` | generated UUID persisted once in Loom installation metadata | one durable Loom storage domain |
| `instanceId` | generated UUID at OpenCode+Loom process startup | one process lifetime |
| `projectId` | generated UUID from the project-epoch marker | one project epoch |
| `sessionId` | OpenCode session ID | one OpenCode session |
| `workflowId` | Loom workflow ID | one workflow |
| `stepId` | Loom workflow-step ID | one workflow step |

`installationId` is an explicit installation-global exception and is not derived from a filesystem path. It is stored at the installation-global key `installation/id`. The project registry is stored under `installation/projects/<projectId>`. These are operational identity records, not product/workflow authority.

`instanceId` is generated at plugin startup and is never reused as durable project/workflow identity.

The project marker format is versioned operational metadata:

```json
{
  "schemaVersion": 1,
  "projectId": "<uuid>"
}
```

The installation registry stores, per `projectId`, current canonical location, identity source, marker location, first/last seen timestamps, and optional filesystem fingerprint. Registry data aids discovery and collision detection; the project marker remains the identity source.

## RuntimeScope

Every mutable execution operation resolves:

```text
RuntimeScope {
  installationId
  instanceId
  projectId
  sessionId
  workflowId?
  stepId?
}
```

Rules:

- `installationId`, `instanceId`, `projectId`, and `sessionId` are always present for runtime calls;
- `projectId` is mandatory for durable mutable execution state;
- `sessionId` is mandatory caller provenance;
- `workflowId` is required for workflow-shared state;
- `stepId` is required for step-scoped mutation;
- explicit identifiers select records but never authorize access.

## Project/session/workflow binding

The canonical binding key is:

```text
(projectId, sessionId) -> workflowId
```

A fresh child gains membership only through Loom-controlled dispatch/attachment. A one-use attachment grant contains at least:

```text
grantId
projectId
workflowId
stepId or oqId
expectedAgent
issuingParentSessionId
createdAt
expiresAt
consumedAt?
consumingSessionId?
```

Grant consumption is atomic under the workflow mutation guard.

A project-local session has at most one current workflow binding. Rebinding is permitted only through a Loom-controlled transition after the previous binding is terminal or explicitly released. Rebinding atomically clears the old step/OQ attachment before installing the new workflow binding; old selectors remain historical and do not authorize current access.

## Scoped key families

New mutable execution keys are project-prefixed. At minimum the scoped store covers:

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

The implementation MUST inventory all mutable execution key families before migration; this list is not permission to leave omitted mutable families unscoped.

## Access validation

For any workflow state access:

1. derive current project identity from OpenCode location context;
2. resolve the current session's project-local workflow membership;
3. load explicit workflow/objective selectors only from the current project namespace;
4. validate stored project metadata;
5. require workflow membership for workflow-shared reads;
6. require exact step attachment plus role authority for step mutation;
7. reject mismatch without global fallback.

Same-workflow cross-session evidence consumption is allowed after legitimate membership. Unrelated workflow/project access is rejected.

## Aggregate revisions

Every shared workflow mutation increments a durable monotonic `revision` while holding the cross-process workflow guard.

Every persistent work-hierarchy mutation increments its own durable monotonic work aggregate version while holding the work/objective guard.

These revisions are independent cross-process ordering signals used by dashboard projection and consistency checks. A workflow revision never orders work-hierarchy state, and a work version never orders workflow state.

## Mutation guard

Lock roots are installation-shared and user-private.

The lock root is an **installation property**, not a per-process environment choice. The installation persists a versioned `runtime-root.json` record under its durable Loom state root.

On first initialization only:

1. prefer `$XDG_RUNTIME_DIR/loom` when `XDG_RUNTIME_DIR` is absolute and that directory can be made user-private/writable;
2. otherwise use `${XDG_STATE_HOME:-$HOME/.local/state}/loom/runtime`;
3. atomically publish the chosen absolute root in `runtime-root.json`.

Every later process sharing that durable Loom state reads and uses the persisted root regardless of its own `XDG_RUNTIME_DIR`. A process that cannot access the persisted installation root cannot mutate shared Loom state; it MUST NOT silently choose another lock root.

The lock layout is:

```text
<loom-runtime-or-state-root>/locks/<installationId>/<projectId>/<aggregate>/<resourceHash>.lock
```

`resourceHash` is a digest of the complete scoped aggregate identity. Resource locks are therefore independent across projects even when local Objective/Task IDs match.

Multi-resource operations:

1. derive the complete lock set before mutating;
2. sort lock identities lexically;
3. acquire every exclusive lock in that order;
4. re-read current durable records;
5. validate membership, version/generation, and claim preconditions;
6. mutate and persist with an atomic/transactional durable commit while locks remain held;
7. release in reverse order.

After an interrupted commit, readers MUST observe either the previous complete aggregate version or the next complete aggregate version. A torn JSON/record body is invalid evidence of state and must never become the canonical durable record.

The workflow aggregate owns workflow transitions, OQs, verification, budgets, completion/reopen, and related workflow state. The work aggregate owns Objective/Phase/Wave/Task hierarchy and claims. Operations spanning both acquire both locks.

## Migration

Scoped records are canonical. Legacy fallback is bounded and only allowed when destination is absent.

Migration requires unambiguous project provenance; path alone is insufficient after path reuse. Ambiguous records remain unmigrated and are reported.

## Conformance evidence

Deterministic tests must cover identical Anchor/objective/task names across projects, same-workflow fresh child sharing, unrelated same-project workflow rejection, controlled session rebinding with prior attachment invalidation, cross-project rejection, two-process contention including mixed/missing `XDG_RUNTIME_DIR` environments sharing one durable installation, crash/fault injection during durable commit, project first-open races, path reuse, copied markers, symlinks, Git worktrees, moves, reopen/failure isolation, and ambiguous legacy migration.
