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
- where a role's mutation authority is attempt-bound, the session's attached step attempt MUST equal the current workflow step attempt;
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

A project-local session has at most one current workflow binding. Step attachment also records the exact workflow-step attempt when the attachment is consumed. Rebinding is permitted only through a Loom-controlled transition after the previous binding is terminal or explicitly released. Rebinding atomically clears the old step/OQ/attempt attachment before installing the new workflow binding; old selectors remain historical and do not authorize current access. Reopening or rerouting a step advances its attempt, so attempt-bound mutation requires a fresh attachment before it can resume.

## Scoped key families

New mutable execution keys are project-prefixed. At minimum the scoped store covers:

```text
project/<projectId>/workflow/<workflowId>
project/<projectId>/session/<sessionId>/workflow
project/<projectId>/session/<sessionId>/step
project/<projectId>/session/<sessionId>/step-attempt
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
7. for attempt-bound mutation, require the attached attempt to equal the current workflow-step attempt;
8. reject mismatch without global fallback.

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

## Migration and runtime upgrades

Scoped records are canonical. Legacy fallback is bounded and only allowed when destination is absent.

The canonical runtime store carries an installation-wide `runtime-schema` record. Runtime schema changes are implemented as ordered, idempotent `fromVersion → toVersion` upgrade steps under the installation migration lock.

The installation-wide version may advance only after the framework has processed every canonical project namespace known from persisted installation/project state. Project-format changes use the framework-owned per-project callback, which is invoked once for each enumerated project before the version advances; installation-global changes use the installation callback. The complete step — every project mutation, installation mutation, durable receipt, and schema-version advance — occurs in one storage transaction when transactional storage is active. A failed step therefore leaves the previous complete version/data generation intact.

During `canonical-upgrade`, callbacks execute while the durable store still has the step's `fromVersion`. During `late-plugin-import` or `legacy-session-import`, the installation ledger may already be at the current target version; replay callbacks therefore use the explicit step `fromVersion` / `toVersion` and phase context and cannot inspect the ledger. All callbacks MUST mutate only through the storage object supplied by the upgrade framework. They MUST NOT call normal version-fenced Loom mutation helpers or independently acquire workflow/work locks; the installation migration guard plus canonical storage transaction owns upgrade serialization. Framework-owned runtime upgrade metadata is never migration payload. Installation callbacks cannot read, write, or enumerate `installation/runtime-schema` or `installation/runtime-upgrades/*`; broad installation scans filter those keys. Callbacks receive explicit `fromVersion`, `toVersion`, and phase context (`canonical-upgrade`, `late-plugin-import`, or `legacy-session-import`) instead of consulting the control ledger.

The supplied capability is itself bounded: a project callback can address only unscoped keys inside its assigned `project/<projectId>/...` namespace, while an installation callback can address only installation/global key families and cannot read or mutate `project/...` state.

Legacy OpenCode plugin-storage import is a baseline-version compatibility source, not an exemption from the runtime schema. If a project first returns after the installation has advanced beyond the baseline, Loom imports that project's legacy scoped records and legacy global learning records under the installation migration transaction, then replays the registered **idempotent** baseline→current installation/project callbacks against the imported state before writing the import-complete marker. Copy, transformation, and marker publication are one transaction. Failure leaves the legacy source untouched and no partially imported canonical record visible.

The same rule applies to pre-project-epoch **unscoped** session continuity. When a resumed legacy session copies baseline workflow/budget/OQ/evidence/work/intent records into an installation whose canonical runtime schema is newer than baseline, those copied project records are transformed through the registered baseline→current project callback path inside the same canonical transaction before they become visible as current-version state. A failed transformation rolls back the copied canonical records and reconciliation receipt together.

Every normal project-scoped mutable transaction validates that the durable runtime version exactly matches the running build before mutation. The version check and write occur in the same transaction. An already-running older process that encounters a store upgraded by a newer process fails closed and must be restarted; it cannot continue writing with older schema assumptions. In-flight older mutations serialize through the canonical SQLite transaction boundary before the upgrade, so the upgrade transforms their committed old-version result rather than racing an incompatible write.

A build MUST refuse state whose runtime version is newer than it understands, and MUST refuse an upgrade when no contiguous registered path exists.

Pre-project-epoch OpenCode plugin state has one additional in-place-upgrade continuity rule. Loom MAY reconcile the exact legacy state bound to a resumed OpenCode session when all of the following hold:

1. the host returns the exact same OpenCode session ID being resumed;
2. that host session belongs to the current OpenCode project identity;
3. the legacy `session/<sessionId>` and/or `session-intent/<sessionId>` binding names the state being migrated;
4. the legacy workflow has no conflicting Loom `projectId`.

This is **session continuity provenance**, not path inference and not user/model confirmation. Loom records a durable upgrade-reconciliation receipt containing the target project epoch and hashed session identity. A supplied workflow ID, canonical path, or free-form confirmation string can never create this provenance.

Once that exact legacy workflow has been reconciled and exists canonically in the current project-scoped store with `projectId == currentProjectEpoch`, its canonical workflow record becomes durable provenance for **additional legacy sessions whose stored legacy session binding names that exact workflow**. This secondary reconciliation does not require the older host session to still expose project metadata, but an explicit OpenCode project mismatch still fails closed. It cannot authorize another legacy workflow, a caller-supplied workflow selector, or a conflicting stored Loom project epoch.

If the session already has a canonical scoped workflow binding, that canonical binding is authoritative. Legacy compatibility data may only complete missing pieces when its stored binding still names that same canonical workflow. After a Loom-controlled rebind from workflow A to workflow B, stale legacy A workflow/intent/work state is historical only and MUST NOT be used as provenance, imported into B, or produce a reconciliation receipt attributing B to A.

If durable legacy state already names a different Loom project epoch, neither session continuity nor canonical-workflow provenance may override it. If neither exact host-session proof nor exact admitted-workflow provenance exists, ambiguous records remain unmigrated and are reported.

## Conformance evidence

Deterministic tests must cover transactional upgrade rollback, all-project schema migration, late legacy import after the installation has already advanced (including failed-transform rollback), pre-project-epoch continuity imported into a synthetic newer runtime schema (including failed-transform rollback), a canonical A→B rebind followed by restart with stale legacy A still present, live old/new process version skew with the old writer fenced after upgrade, identical Anchor/objective/task names across projects, same-workflow fresh child sharing, unrelated same-project workflow rejection, controlled session rebinding with prior attachment invalidation, exact step-attempt invalidation after reopen/reroute, step-scope/lifecycle transitions contending with admitted mutation, cross-project rejection, two-process contention including mixed/missing `XDG_RUNTIME_DIR` environments sharing one durable installation, crash/fault injection during durable commit, project first-open races, path reuse, copied markers, symlinks, Git worktrees, moves, reopen/failure isolation, ambiguous legacy migration, and a real OpenCode host stop/restart where persisted pre-upgrade session IDs reconcile through the upgraded plugin.
