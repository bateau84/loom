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

## Runtime write scope and elevation

A step's write scope is a **starting expectation and current mutation surface**,
not a claim that General or Planner can predict every file the child will need
before execution begins.

General MAY declare one or more exact files or bounded folders before dispatch.
Artifact-producing roles also have role-default locations that provide a useful
initial surface when General does not narrow it. A Worker MAY start with an empty
write list so it can inspect the repository before it knows the implementation
surface.

An attached child that discovers an additional project-local mutation target
MAY call `loom_scope_elevate` with the exact files/folders and a reason. Loom
MUST require the exact current runnable step attempt, append a durable elevation
record to the step scope, and make the expanded scope effective immediately.
Successful project-local elevation returns `continue=true`; the child continues
in the same session without a General round trip.

Role-default paths are observability defaults, not hard mutation ceilings.
Crossing a role default is recorded explicitly on the elevation so General,
status tooling, and later review can distinguish expected work from scope growth.
Product rules that are independent of role defaults remain hard rules; for
example durable reports remain promotion-only and ephemeral report namespaces
remain producer-scoped.

The following are **hard boundaries**, not self-elevatable project scope:

- a path lexically outside the current project;
- a project-relative path whose existing symlink ancestry resolves outside the
  current project;
- repository-internal `.git` state.

For a hard-boundary request, `loom_scope_elevate` MUST return
`status=user_authorization_required` and `continue=false`, together with the
exact user question. The child MUST stop its current turn immediately and return
control to General. It MUST NOT retry the write or continue on the assumption
that access will be granted later.

General presents the exact Loom question with only an **Allow once** or **Deny**
decision. Allow once authorizes only the requested path patterns for that exact
Workflow step attempt. It does not become project policy, does not survive a new
attempt/workflow, and MUST NOT expose a "remember my choice" path. A custom
answer grants no authority.

## Git authorship continuity and bounded recovery

For product artifacts, admitted write authority and commit authority are the
same scope: if a step may write a product path, it may stage and commit the exact
bytes Loom admitted for that path. A separate per-session scope-adoption
ceremony is not part of the authority model.

Loom records the resulting worktree fingerprint per exact Workflow step attempt
and path. Session-local Git ownership is only a cache. A fresh or resumed child
attached to the same Workflow step attempt MAY stage exact current bytes when
they match the durable step-attempt provenance record. No
`loom_scope_request` handoff is required. Reopen/reroute advances the attempt,
so prior-attempt provenance cannot authorize staging in the new attempt.

Scope alone never proves authorship. A path that was elevated into the write
surface but whose current bytes were not produced by an admitted mutation cannot
be staged. Likewise, bytes changed after the last admitted mutation fail closed.

Ephemeral reports are intentionally different: `ephemeral-reports/**` may be
written under its producer rules but is removed from committable scope. Durable
retention of a report uses the report-promotion path instead of ordinary Git
authorship.

If a runtime/guard defect has destroyed all usable product-byte provenance,
Loom MAY recover it only as an explicit user-authorized adoption of the
**current** uncommitted bytes. Recovery is General-owned, bound to one exact
latest real user message, one current runnable step attempt, one attached target
session, and paths inside that step's current committable write scope.
Already-staged or clean paths are ineligible. Loom records exact current
fingerprints and makes replay with the same authorization idempotent only while
the requested paths and fingerprints remain identical. Recovery itself does not
edit, stage, or commit repository content and MUST NOT claim that historical
authorship evidence survived the defect.

## Scoped key families

New mutable execution keys are project-prefixed. At minimum the scoped store covers:

```text
project/<projectId>/workflow/<workflowId>
project/<projectId>/session/<sessionId>/workflow
project/<projectId>/session/<sessionId>/step
project/<projectId>/session/<sessionId>/step-attempt
project/<projectId>/git-step-attempt-owned/<workflowId>/<stepId>/<attempt>/<path>
project/<projectId>/git-ownership-recovery-user-message/<generalSessionId>/<messageId>
project/<projectId>/scope-boundary-request/<generalSessionId>/<requestId>
project/<projectId>/scope-boundary-question-decision/<generalSessionId>/<requestId>
project/<projectId>/scope-boundary-authorization/<workflowId>/<stepId>/<attempt>/<requestId>
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
6. require exact step attachment plus the step's current effective write scope for normal project mutation;
7. permit project-local scope growth only through recorded `loom_scope_elevate` on the exact current runnable step attempt;
8. require an exact user-approved hard-boundary authorization for external, symlink-escaping, or repository-internal writes;
9. for attempt-bound mutation and Git provenance, require the attached attempt to equal the current workflow-step attempt;
10. reject mismatch without global fallback.

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

Deterministic tests must cover transactional upgrade rollback, all-project schema
migration, late legacy import after the installation has already advanced,
pre-project-epoch continuity, canonical rebinds, live old/new process version
skew, identical Objective/Task names across projects, same-workflow fresh child
sharing, unrelated workflow/project rejection, and controlled session rebinding.

Scope/Git conformance MUST additionally cover: Worker dispatch without a guessed
file list; immediate same-session project-local elevation; durable elevation
history including role-default crossings; hard-boundary `continue=false`
control transfer; exact Allow-once/Deny user menus with no remembered choice;
outside-project and symlink-escape denial before approval; attempt-bound expiry
of hard-boundary approval; product write-to-commit equivalence; ephemeral report
non-committability; fresh-session same-attempt staging from exact admitted
fingerprints without a scope-adoption call; changed/unproven/prior-attempt byte
rejection; explicit-user Git-provenance recovery after simulated runtime loss;
and scope/lifecycle transitions contending with admitted mutation.

Cross-process contention, crash/fault injection during durable commit, project
first-open races, path reuse, copied markers, symlinks, Git worktrees, moves,
reopen/failure isolation, ambiguous legacy migration, and real OpenCode host
stop/restart continuity remain required.
