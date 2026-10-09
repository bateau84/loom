---
type: discovery
title: Changing Course Without Losing Progress — Foundational Discovery
description: Evidence-grounded challenge to Loom's state ownership, authority composition, recoverability, and architectural complexity.
tags: [loom, discovery, architecture, reliability, continuity, recoverability]
---

# Changing Course Without Losing Progress — Foundational Discovery

**Status:** discovery hypothesis and specialist-review input; **not accepted architecture, not implementation authorization, not a completed independent review**.  
**Observed source:** `bateau84/loom`, `functionality-anchor-requirements-coherance@7f0ddd14a5c970e39b2778ecb341b872b406865d` (2026-10-09).  
**Separate from:** unfinished OCI test-adapter work, existing staged files, and the original active Loom workflow. No changes to those work products are made or implied.  
**Scope:** foundational work-contract/lifecycle/authority composition, source-of-truth reduction, evidence applicability, execution and publication, production-isolated testing, failed-upgrade rollback, and offline/manual recovery from an unusable installation.  
**Non-goals:** running against installed/production state; production-state repair; executing adapters; merging PRs; new role support; rewriting the accepted Anchor; migration/backward-compatibility implementation; deployment; or declaring the old work complete. Backward compatibility with the current *internal* architecture is explicitly **not** a design constraint.

## Executive finding

Loom's central issue is **incomplete composition of otherwise defensible checks**. An agent may have a valid goal, accepted Task scope, observed evidence, or a reviewed result, yet a different subsystem has no way to consume that fact. The result is an avoidable stop, a fresh dispatch, or manual reconciliation. Increasing the number of recovery tools without reducing conflicting authorities would perpetuate this failure class.

We should **not** assume the current persistent work tree, executable Step graph, OQ board, session bindings, result archive, and review/gate bookkeeping are each irreducible. Challenge their authorship and persistence while preserving the *meaningful distinctions*: accepted authority, attempts, observed effects, evidence, independent assessment, explicit user decisions, and actual external operations.

The governing user outcomes are:

1. **Reliability:** normal changes in intent, scope, order, session ownership, installation state, and observed results can continue without fabricating proof or losing applicable completed work.
2. **Simplification:** reduce independently maintained decisions, statuses, reauthoring, and coordination steps; a prettier next-action facade without that reduction does not count.

A completed journey that depends on special prompts fails the second outcome. A cleaner architecture that cannot finish realistic journeys fails the first.

### Proposed system invariants (to be challenged and refined by Specifier)

- **P1 — Continuation:** every reachable unfinished state offers either a permitted productive transition, a genuine wait with named owner/resumption condition, or a safe user-authorized exit. If the goal is still feasible, cancellation alone is **not** an adequate recovery path.
- **P2 — Applicability:** for the same result, consumer contract, and relevant input versions, preservation, attachment, dispatch, review, and completion use the **same applicability decision** and reasons. A consumer may demand stronger proof but may not silently reinterpret the same advertised reuse grade.
- **P3 — Original truth:** a prior attempt, observed effect, claim, and independent review are never regenerated or upgraded by Planner prose; a changed contract can invalidate current applicability without deleting historical proof.
- **P4 — Actor identity:** user-owned decisions remain user-owned; specialist authority does not transfer to General or Worker simply because the specialist is unavailable.
- **P5 — Honest outcomes:** `blocked`, `interrupted`, `failed`, and `outcome-unknown` are attempt facts, not Task satisfaction, and do not imply host-operation quiescence.
- **P6 — Direct information access:** an authorized consumer can read an existing answer and its evidence without raising a new OQ or dispatching another specialist merely to transport it. Reconciliation records **its treatment**, not delivery.
- **P7 — Effect boundary:** scope, command, Git, and remote-operation rules classify a specific proposed operation/target/effect; grants never substitute for executable containment, or for actual command/publication results.
- **P8 — Safe recovery:** a broken plugin, failed upgrade, or ambiguous external operation cannot destroy the user's repository, results, or the operator's ability to inspect and recover offline.
- **P9 — Independent review:** an original producer's claim and independent assessment remain separately attributable. A new Plan revision does not silently PASS old or new gates.
- **P10 — Preflight:** an admitted, otherwise valid finite Plan should not require unpredicted repeated user approvals merely to satisfy its minimum dispatch/resource demand; capacity is estimated before commitment.

## What the current source supports

These are **source observations**, not live reproduction or independent specialist approval. The historical failure sequences are **reported incidents** unless specifically traced through the current code.

| Current mechanism | Observed boundary | Discovery implication |
| --- | --- | --- |
| Persistent Plan and work tree | `work.ts` persists `WorkPlanSnapshot` and `WorkNode` with mutable `status`, current `result` and `priorResults`; `invalidateTaskResult` moves a result into the archive and clears the current field. | Preserve original result immutably; ask whether mutable Task/ancestor status needs to be independently stored. |
| Executable Step graph | `workflow.ts` separately persists Step status, attempt, deps, TaskSpec, Reviewer control; `applyTaskPlan` compares/reconstructs Task contracts. `index.ts` `loom_task_plan` requires Planner to resubmit the full TaskSpec. | One authoritative semantic Task definition should generate executable admission contracts without a second model-authored copy. |
| Completion recovery | `reusableCompletedTaskIds` and `loom_work_reconcile` independently inspect semantic closure, executable fingerprint, original evidence and clean repository HEAD. | Replace multiple applicability predicates with one typed decision and dependency/artifact identity, then consume that decision consistently. |
| OQ sharing | `oq.ts` stores question, answer, status and per-consumer reconciliation; answer notifications are coordinated elsewhere. | Keep answer and consuming decisions authoritative; make notification delivery non-authoritative and independent of read access. |
| Review receipts | `workflow.ts` maintains Reviewer receipts and gates; `work.ts` stores reviewed Wave completion. | Preserve independent judgments; test whether separately mutable accepted/complete flags are derived views. |
| Permissions | `index.ts` has scope, command elevation, Git authorship/index, host event admission and per-step bindings. Current command elevation is restricted to enumerated command shapes and `stepId`. | Decide operation capabilities once per specific effects/target, then make every enforcement hook consume the same verdict; an OQ may be a legitimate target. |
| Lifecycle | `lifecycle.ts` supports cancellation and admission fencing; `loom_resume` restores access only after a successfully finished side workflow. | Separate conversational binding, workflow initiation admission, and external-operation state; implement normal pause/switch/rebind without inventing completion. |
| Budget | `budget.ts` defaults to 40 total dispatches, with per-step/role limits and extra grants. | Minimum finite-graph work and expected retries must inform preflight; count actual progress/cost separately from dispatch count. |
| Shared runtime | `runtime.ts` uses installation/project identities, SQLite KV under WAL with transaction/lock machinery, schema-version ledger, and older-writer fences. | Transactional consistency is valuable; independently test crash/upgrade/disaster recovery from a plugin that cannot load. |
| Test isolation | `scripts/run-unit-tests.py` and `test-isolation.ts` enforce disposable XDG/HOME roots before test import. `test-isolation.ts` explicitly says this is **not an OS sandbox**. | Keep as one safety layer; add production-inaccessible OS/OCI boundaries for integration tests. |
| OCI adapter proposal | `docs/architecture/loom/specs/oci-test-adapter.md` explicitly states implementation, pre-execution review and current-source test proof are unestablished. | The separate adapter must not be treated as an already-existing solution or dependency of this discovery. |
| Operational dashboard | Dashboard state is a read/projection companion; previous work requests broader multi-instance/session visibility. | Dashboard projections cannot repair or become independent workflow authority. |

### Source anchors (pinned to this baseline)

- [Work hierarchy/result/current-vs-archive](../../../../plugins/loom/work.ts) — `WorkHierarchy`, `WorkNode`, `invalidateTaskResult`, `syncWorkTaskStatuses`, `inspectTaskSemanticClosure`.
- [Executable Step graph, waits, review receipts](../../../../plugins/loom/workflow.ts) — `Step`, `buildSteps`, `applyTaskPlan`.
- [Registry/admission/Git/reconciliation/command elevation](../../../../plugins/loom/index.ts) — `loom_task_plan`, `reusableCompletedTaskIds`, `loom_work_reconcile`, `loom_command_elevate`, `assertAdviceHostPaths`.
- [Questions and consumer treatment](../../../../plugins/loom/oq.ts) — `answerQuestion`, `reconcileQuestion`.
- [Cancellation](../../../../plugins/loom/lifecycle.ts) — `cancelWorkflow`.
- [Runtime store and upgrade ledger](../../../../plugins/loom/runtime.ts) — `createTransactionalStorage`, `ensureRuntimeStateVersion` and `assertRuntimeStateVersion`.
- [Isolation guard](../../../../plugins/loom/test-isolation.ts) and [isolated unit launcher](../../../../scripts/run-unit-tests.py).
- [Current OCI-adapter proposal](../specs/oci-test-adapter.md) and [upgrade operator instructions](../../../user/upgrades.md).
- [Accepted product outcomes](../../../anchors/loom/anchor.md), [work hierarchy design](../work-hierarchy.md), [lifecycle proposal](../work-lifecycle-and-publication.md).
- Incident evidence: the reported Leash c01/c02/c03 carry-forward failure, Git authorization/staging/commit handoffs, OQ continuation, and failed startup/version mismatches. These reports justify probes; they are not proof of every hypothesized failure in the pinned build.

## Record ownership audit — hypothesis, not schema selection

**Rule:** each durable record must own one independently verifiable fact. If it is a projection, cache, or convenience index, declare it rebuildable and forbid treating it as authority.

| Fact/record family | Unique authority/fact worth retaining | Suspected duplicated or derivable data | Questions to falsify the proposed reduction |
| --- | --- | --- | --- |
| Accepted intent and user consent | Exact accepted content revision, scope and provenance of user decision | Session-local state derived from a mutable path and a confirmation string | How is accepted content cryptographically or semantically bound, not just its path? |
| Plan revisions | Immutable goal/obligation/Task contracts with authority refs and verified amendments | Re-entered executable TaskSpec, duplicated Phase/Wave descriptive fields in completion fingerprints | Can Plan own the Task contract while runtime derives gates and scopes? |
| Execution admission | A versioned compiled plan identity plus explicit execution-scoped selections | Persistent Task graph fields identical to Plan fields | Is compiled graph a deterministic projection, or must it persist a single digest for granted authority? |
| Exclusive claims/leases | Current real owner, lease generation, expiry/fence and observed operation ownership | Independent booleans on WorkNode and Workflow that claim same ownership | Which exact state can be reconstructed after a crashed owner? |
| Attempts | Unaltered original producer/role/session/attempt, start and terminal/unknown outcome | Mutable `Step.status` treated as execution truth | Can all current attempts be projected from immutable transitions with an atomic current-attempt pointer? |
| Host operations | Admission, actual invocation, external target/effects, termination or uncertainty | Tool-call success taken to imply process-tree quiescence | Which effects are observable vs unknowable without containment? |
| Evidence | Original attributed observations, claims and raw bounded traces | Recomputed or substituted proof against a later Plan | How can absent or incomplete observation be distinguished from a failed assertion? |
| Results | Immutable result identity/content, evidence and dependency inputs consumed | `WorkNode.result` vs `priorResults` as independent current-truth locations | Can one ledger of immutable outputs plus current applicability replace both fields? |
| Independent review | Verdict, reviewer/author independence, exact reviewed contract/results/evidence | Redundant per-Step PASS, per-Task complete and per-Wave completion flags | Which scoped review receipts must persist separately; can statuses be derived from them? |
| Consumer decisions | The consumer's disposition of existing attributed advice/answer | New OQ just to forward existing text; notifications used as proof of answer visibility | Can authorized readers dereference answer by ID and record use only when semantically needed? |
| Resource/effect grants | Concrete bounded user/owner authorization with expiry and target fingerprint | Different sub-checks maintaining separate descriptions of the same command/Git operation | Can one operation verdict be revalidated at every hook without collapsing distinct trust boundaries? |
| Resource budget | Allocated limit, actual consumption and explicit user override | Retry counts confused with progress; surprising default exhaustion | How is finite DAG minimum demand estimated and reported before execution? |
| Conversation binding | Session/owner identity and access to one or more work contexts | Binding used as proxy for runtime lifecycle or host quiescence | Can user switch projects without terminating any in-flight host operations? |
| Installation identity and schema | Durable version/manifest, writer fence, migration proof and operator recovery provenance | Legacy compatibility adapters not needed for a new internal storage model | How can a broken new build be inspected and rolled back without launching it? |
| Dashboard/learning | No execution authority; advisory/derived data only | Any mutable roll-up treated as permission or completion proof | Can the entire projection be deleted and rebuilt from sources? |

**Counterexamples to over-simplification:** review cannot be derived from producer results; user decisions cannot be inferred from agent recommendations; a permission grant cannot prove effects actually occurred; a host exit status cannot prove a remote side effect; resource/cost expenditure is distinct from claimed progress; irretrievable historical evidence cannot be synthesized.

## Candidate architectures (all previous decisions challengeable)

| Candidate | Approach | Composition and recovery | Simplification | Principal risk |
| --- | --- | --- | --- | --- |
| **A — one transactional fact model + derived projections** | One durable SQLite authority store for Plan revisions, attempts, reviews, answers, grants, and operation outcomes; deterministic DAG/Task/Wave projections and one applicability validator. Optional immutable event/attempt log, but no requirement to replay every state from raw events. | Single transactional commit and shared predicate; offline integrity/export tools can read a stable schema. | High if duplicated writable statuses and Planner Task authoring are removed. | Harder initial rework; must define stable input/output/resource identities and garbage collection carefully. |
| **B — full append-only event sourcing** | All canonical transitions are events; state reconstructed by replay with materialized projections. | Strong audit and crash inspection potential; deterministic replay offers useful tests. | Unclear: may replace state duplication with event ordering, projection repair and replay-migration burden. | A second complex state machine around replay, schema evolution and external effects. |
| **C — retain current stores and add an action resolver** | Central query collects existing readiness checks and reports “next step.” | Better diagnostics but leaves conflicting admission decisions intact. | Low. | A new orchestration layer can conceal, not remove, inconsistency. |
| **D — separate lifecycle, command and Plan services** | Split orchestration into separately persistent actors/services. | Separation of concerns but cross-store atomicity/host-operation ownership is harder. | Unlikely for local-first single-user Loom. | Distributed handoff, partial commits, version skew, outage modes. |

**Provisional direction:** study **A** first, then actively try to disprove it using concurrent edits, duplicate tool callbacks, review independence, external effects, and offline repair. No option is accepted by this document. B is a serious alternative only if append-only provenance demonstrably simplifies crash and evidence handling without multiplying operational state. C is **not** an acceptable final simplification; D needs a concrete benefit outweighing its distributed coordination cost.

### More fundamental challenges

1. **Is the Objective/Phase/Wave/Task tree essential canonical state?** Objective scope and Task contracts are real; Phase/Wave may be optional presentation/claim grouping rather than independently mutated completion records. Do not flatten away real gates, but justify every stored ancestor state.
2. **Does every cross-role handoff need a separate review gate?** Independent review of authoritative claims is necessary; mandatory advice or transport-only review may not be. Define assurance by consequence and review subject, not by a role mismatch.
3. **Is every user request a workflow?** Retain conversation-first investigation and bounded execution. Do not force a Plan or interview to ask a factual question or deliver an authorized small change.
4. **Are questions first-class blockers or ordinary data?** An answered record should be readable directly; a consumer's required judgment can remain a separate obligation. Notification is transport, not truth.
5. **Does a failed Task need an OQ to record why it stopped?** No: the attempt has its own terminal/interrupted/unknown state; an OQ is reserved for a real required decision.
6. **Is clean Git HEAD proof of individual output validity?** It is coarse environment provenance, not a suitable general identity for unrelated independent Tasks. Demand file/artifact/dependency/version-scoped proof without fabricating attribution in shared files.
7. **Should runtime schema compatibility dictate product architecture?** Not in this discovery. Keep proven work/evidence, but do not preserve redundant storage shapes solely for old API compatibility.

## Production-isolated test and verification strategy

The current test-only XDG/HOME-root guard is useful but explicitly not an OS sandbox. The OCI adapter is still separate and incomplete. **Discovery may use synthetic fixtures and separately permissioned disposable environments; it must not import, mount, open or run tests against the live installation state.**

1. **Static/projection proof:** pure transition/property tests with no plugin bootstrap, host processes, credentials, network or real filesystem mutation.
2. **Private-process proof:** fresh 0700 root created before Bun/OpenCode imports, all HOME/XDG/TMP/LOOM runtime paths redirected; synthetic SQLite fixtures only; dashboard and external launch disabled.
3. **OS/OCI integration proof:** explicit pinned image/engine, rootless/least privilege, no host state mounts, no user config, credentials, Git metadata, engine socket, remote endpoint or production DB, network=none by default. Copy a finite manifest of approved source + synthetic fixtures into a disposable test tree. A separate host-side canary establishes original state remained unchanged (no host-state access permitted).
4. **Real-host protocol proof:** disposable OpenCode config/state, separate project marker and Git worktree, isolated credentials/test fixtures, explicit host identity and plugin build attestation. Exercise actual attachment, evidence, shell, session rebinding and permission hooks; still no production state.
5. **Fault injection:** kill and restart process across admission, execution, SQLite commit, OQ delivery, review, plugin startup, schema migration, and external operation observation. Verify no duplicate effects or invented completion.
6. **Liveness exploration:** bounded model/property testing of Plan × session × OQ × permission × budget × evidence × operation-state transitions, not merely DAG acyclicity. Every reachable unfinished state must have a path or an accurately reported external boundary.

**No test execution or safety claim is recorded here.** Neither a green unit suite nor container startup alone proves this isolation; require observed source provenance, actual OS restrictions, and independent canary results. The separate OCI adapter may later be evaluated as a test transport, but the discovery remains independent of it.

## Upgrade rollback and broken-installation recovery

Two guarantees must be separate:

- **Transactional failed upgrade:** a migration that fails *before commit* rolls back the canonical SQLite transaction, receipt and schema advance. Existing code already attempts this with `BEGIN IMMEDIATE` / `ROLLBACK` and registered migration transactions. Verify in isolated fixtures under process crash, disk-full, injected callback failure, wrong version, and concurrent old/new writers.
- **Restore after a completed but defective upgrade:** rolling back the code is **not** equivalent to rolling back state already modified by the newer version. Blind downgrade, editing `installation/runtime-schema`, or deleting a WAL file could corrupt proof. A planned reversible snapshot or forward repair path is needed.

**Candidate safe operator sequence (design to test, not a production runbook or current command):**

1. Stop/fence Loom writers and external work admission; maintain OpenCode usability in an inspection-only mode if the plugin fails to initialize.
2. Use a **separate, small offline recovery tool** that does not import/start the broken Loom plugin. Locate installation identity and canonical DB without executing upgrade hooks.
3. Inspect integrity, schema ledger, upgrade receipts, active writers, outstanding host operations and project scopes **read-only**. Refuse repair if quiescence/identity cannot be established; do not infer that a stopped plugin killed external processes.
4. Produce a verified backup using SQLite's safe online-backup/checkpoint mechanism under exclusive/offline writer fencing; include and verify evidence/metadata and source manifest. Never copy only the main SQLite file while WAL may contain uncheckpointed transactions.
5. In a disposable copy, rehearse an operator-selected recovery strategy: rerun an idempotent failed step, forward-repair a newer schema, or restore a proven pre-upgrade snapshot. Prohibit a downgrade from silently dropping any post-snapshot legitimate writes.
6. Show an impact preview: affected workflows, results, user decisions, evidence and in-flight operations. Require explicit operator consent for data loss or uncertain external-state handling.
7. Replace/restore atomically only while writers remain fenced, retain the broken original in quarantine, reopen read-only first, and verify invariants before admitting new work.
8. Preserve an auditable recovery receipt linking backup/source, actual action, operator authorization and verification. Allow repeatable recovery after an interrupted recovery attempt.

**Failure classes to prove with synthetic data:** invalid/broken plugin import; unsupported future schema; missing migration; callback failure before commit; crash between upgrade steps; process death mid-transaction; stale older writer; bad/corrupt WAL/main DB; disk full; failed backup; wrong project marker; ambiguous external operation; post-upgrade writes that make a pre-upgrade snapshot stale; incomplete restore; missing credentials/toolchain; and accidental test invocation with an ambient HOME/XDG root.

**Invariant:** operator recovery must never manufacture reviewer PASS, completion, user consent, or evidence. Installation repair and work/contract reconciliation are separate decisions.

## Discovery decisions awaiting specialist assessment

These are **questions**, not silently accepted design changes.

| ID | Accountable assessment | Question and falsifier |
| --- | --- | --- |
| D01 | Architect + Specifier | Can one transactional fact model eliminate independently writable Step, Task and ancestor status while preserving independent gates and efficient reads? Demonstrate minimal facts and replay/projection after interruption. |
| D02 | Architect + Planner consumer | Can the executable graph be wholly generated from one Plan revision plus genuine operation-specific choices? Show failure of duplicated-Task authoring is impossible. |
| D03 | Architect + Reviewer | What is the minimum shared applicability proof and what legitimately different evidence demands may consumers add? Exercise unrelated commit, shared file, changed contract, reopened review, cross-Wave advisory. |
| D04 | Designer/General consumer + Architect | Can intent abandon, unanswered decision revision, pause/switch/cancel/resume and lost-coordinator takeover be normal transitions with safe fencing? |
| D05 | Security/host-runtime owner | Can step and OQ capabilities share effect admission without promoting lexical command matching to a security boundary? Show negative cases for external effects. |
| D06 | Reliability/operator + Architect | What durable operation outcomes are observable and which must remain unknown? Show pause/cancel with still-running external operation and safely recover after restart. |
| D07 | Reliability/operator | Can plugin failure be diagnosed and repaired using only an offline, minimal dependency path? Prove backup integrity, failed-upgrade rollback and no live state touches. |
| D08 | Specifier + Eval owner | What finite representative journeys establish both reliable completion and measurable removal of duplicate coordination? See companion journey specification. |
| D09 | Product authority/User | Which formerly accepted architecture decisions should be superseded? Provide exact rationale and affected invariants; do not silently amend the accepted Anchor or claim approval. |
| D10 | Resource/runtime owner | Does admission calculate lower-bound work/cost/capabilities correctly for bounded mixed-role Plans, and make genuinely discretionary budget waits explicit? |

### Suggested assessment sequence (discovery only)

1. **Architect:** independently inventory unique facts and duplicate states; compare A/B/C/D and write falsifiable recommendation—not another implementation-facing specification chosen by default.
2. **Specifier:** formalize progress, reuse, honest outcomes, authority and install-recovery requirements as small executable-state properties.
3. **Runtime/reliability assessment:** challenge the failure boundaries, concurrent writers, storage/backup/restore, and fully isolated tests.
4. **Independent Reviewer:** adversarially test that simplification cannot launder stale evidence, collapse independent gates, fabricate user consent, or break state under interruption.
5. **User decision:** accept or reject supersession of relevant architectural decisions only after the findings and journey outcomes are visible.

**Exit criteria for discovery:** one defensible fact-ownership schema; comparison with falsifiable reasons; a transition and recovery contract including genuine unavailable paths; a production-inaccessible test protocol; an operator-recovery strategy with rollback semantics; an incident-derived journey matrix with objective pass/fail measurements; and recorded unresolved specialist choices. Do not treat these documents, a draft PR, or review comments as implementation approval.

## Acceptance measures for later implementation (not claimed complete)

- 0 manual database edits, invented gate receipts, special recovery prompts, or forced unwanted intent acceptance in required journeys.
- 0 re-executions caused *solely* by unrelated Plan wording, Git commits or presentation-only grouping when relevant input/output/authority proof remains valid.
- 0 cases where an applicability verdict accepted by an upstream service is rejected by a downstream consumer under identical contract/input/proof dimensions.
- 0 unauthorized effects; 0 synthetic/missing runtime evidence promoted to PASS; 0 self-review promoted to independent approval.
- All genuine waits identify owner, precise missing capability/permission/information, preserved work and resumption conditions; cancellation is not scored as successful recovery when valid continuation exists.
- Every simulated failed upgrade restores the prior committed schema/content atomically; an already-completed defective upgrade requires a demonstrated safe recovery decision, not a blind downgrade.
- 0 reads/writes/listeners targeting real host Loom state during isolation tests; canary and OS boundary evidence are mandatory.
- Track coordination-tool calls, independently written state fields, manual interventions, unnecessary dispatches, elapsed blocked time, live/outcome-unknown operation count, and extra review handoffs alongside end-to-end completion.

**Companion:** [Incident-derived journeys and adversarial probes](continuity-journeys.md).
