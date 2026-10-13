---
type: design
title: Loom Hierarchical Work Model
description: Persistent Objective/Phase/Wave/Task hierarchy that separates product progress from bounded workflow execution.
tags: [architecture, loom, workflow, planning, hierarchy, completion]
---

**Status:** proposed

## Problem

Loom currently persists execution primarily as a workflow DAG of steps.

That is sufficient for bounded execution, but it does not preserve the larger work hierarchy that the Planner is decomposing. A workflow can therefore finish every local step and become `complete` even when it represents only one bounded part of a larger accepted product objective.

This conflicts with BR-004: the accepted product outcome is the unit of completion, and a locally complete component or task is not product completion.

The failure mode is:

```text
Accepted objective: Leash v1
  -> Planner emits one bounded first-wave DAG
  -> all workflow steps complete
  -> workflow becomes complete
```

The runtime result is locally true but ambiguous at the product level. Loom needs to distinguish **execution completion** from **ancestor work completion**.

## Decision

Loom models persistent work separately from workflow execution.

The canonical planned-product hierarchy is:

```text
Objective
  └── Phase
       └── Wave
            └── Task
```

Equivalent project-management terminology is commonly:

```text
Initiative
  └── Epic
       └── Task / Story
            └── Subtask
```

For Loom, the canonical names are **Objective, Phase, Wave, Task**.

Runtime workflow steps remain execution primitives beneath or around these work nodes. They are not required to map one-to-one to every hierarchy level.

## Meaning of Each Level

### Objective

The accepted parent outcome or release boundary.

Examples:

- `Leash v1`
- `YuHaul MVP`
- `Replace authentication subsystem`

An Objective is the level at which product completion is judged.

**Objective authority is established before Planner.** The Objective identity and completion boundary derive from the accepted Anchor or other accepted scope authority. Planner may not create, broaden, narrow, rename-as-new-scope, or otherwise redefine that accepted outcome.

### Phase

A major coherent segment of the Objective.

A Phase groups related Waves and may carry phase-level prerequisites or gates.

### Wave

A bounded executable grouping of Tasks chosen for safe sequencing, concurrency, review, and acceptance.

A Wave is the normal unit of bounded autonomous implementation.

### Task

The smallest Planner-owned unit that should be independently assigned, executed, verified, and completed.

A Task may require multiple runtime steps or agent invocations.

**Proposed accountability distinction:** Task identity, obligation ownership, and write scope alone do not establish the accountable *role* or a supported execution/decision path. [BR-024](../../requirements/loom/br-024-preserve-authority-ownership-through-handoffs.md) requires such a role and path for each planned work item, including specialist-owned deliverables and routine execution. The role's decision/output and a cross-role responsibility transfer must be traceable before dependent completion. Specialist authority does not transfer merely because a Worker implements a Task. This design does not prescribe a Task `owner` field or assert that current Plan/Task compilation already meets the requirement; see [Control Plane — Proposed accountable-role admission](control-plane.md#proposed-accountable-role-admission).

In the proposed realization a Task's completion derives from its **bound execution or decision path**, not from the presence of any `task:<id>` Worker step. Planner compiles mixed-role dependencies for the selected unclaimed Wave; a Task receives a dedicated role-owned step before executable review, or an explicit blocked user-decision boundary where only user authority can resolve it. A Reviewer-owned Task binds to an independent gate over other producer work. A pure role-only Wave still needs scoped independent review and evidence before roll-up; a planning-only Objective has no executable Wave at all and ends only its reviewed-Plan workflow. Existing runtime `loom_task_plan` compiles Worker-only steps and does not realize these paths. See [Role-Safe Plan Execution](role-safe-plan-execution.md) for the decision, admission, dependency, compatibility and unavailable-role handling.

## Plan Semantics Are First-Class

The hierarchy is not only a progress tree. Each plan generation also persists the shared semantic model that explains how accepted authority becomes executable work.

A plan generation records:

- the parent goal, assumptions, exclusions, and accepted authority references;
- an obligation coverage map with explicit source, disposition, Task ownership, verification, and authorized deferral/out-of-scope authority;
- material risk boundaries and whole-product acceptance coverage (accepted criteria/outcomes, not executable Product Acceptance scenarios);
- important cross-Task relationships and correction routes;
- for every Task: bounded outcome, rationale, dependencies, authority references, inherited constraints, falsifiable acceptance criteria, non-executable subtasks/checklist, integration context, and verification expectations; Plan-level risk/acceptance records canonically reference the Tasks they cover.

The control plane preserves this structure as data. A human-readable plan document is optional.

### Plan revision and generation

A **Plan revision** is an immutable-history amendment inside one still-trustworthy generation. Planner may atomically patch, add, or remove Phases, Waves, Tasks and Plan context even after Task execution has started. Loom keeps the current semantic snapshot plus inverse deltas sufficient to reconstruct earlier revisions exactly; each amendment records the actor, reason, changed operations, and revision. Normal agent context shows only the effective Plan; `loom_work_status(revision=...)` explicitly retrieves historical context.

A revision does **not** retroactively make an old completion satisfy a changed contract. Loom compares each Task's semantic contract and transitive dependencies, retains unaffected original Task attempts/results, and archives invalidated results with the revision/reason in `priorResults`. Reusable results require the original current-attempt evidence claims/observations and a matching stored semantic closure receipt. Missing or damaged receipts are rerun, never stamped with a new receipt computed from a later Plan. Work may remain `pending` after execution until independent implementation review; that roll-up status alone must not erase the result. A changed executable DAG is recompiled and independently reviewed before further execution, and stale specialist write/dispatch authority is denied.

A **new Plan generation** remains available for explicit Plan invalidation/replacement when the current generation itself cannot be adopted. Neither revision nor generation change grants Planner new product authority or silently passes a gate.

Planner may explicitly invalidate the current generation. Invalidation preserves its history but makes unfinished work non-runnable. Replacement planning creates a fresh generation; invalidation is not deletion and does not turn prior unfinished work into completion.

A Task outcome is **not** the accepted Objective. It is one bounded contribution inside the Objective. Worker therefore receives both the focused Task contract and parent Plan context, including durable result summaries/evidence references from completed dependencies; Reviewer/Critic receive a bounded whole-Plan map and inspect exact current executable Wave contracts on demand through `loom_task_status`. Durable Plan state is complete, while model-facing whole-Plan projection clips text and large ownership lists and reports omitted counts to prevent supported maximum Plan size from becoming uncontrolled model context. Planner has decomposition authority only: Plan fields compile accepted authority and never become a new source of product meaning.

OQs raised from governed planned work retain the Objective identity, Plan generation, **Plan revision**, and originating Task ID when known. Non-Task steps may explicitly correlate an OQ to an existing Task in the current generation; Loom validates that reference. Any Loom role may be the responder, including Planner, Worker, Reviewer, Critic, Acceptance, or Documenter. The responder receives the exact historical Task/Plan revision automatically when available; later same-generation amendments do not rewrite the OQ's origin context. During deferred legacy adoption, Task-linked OQs remain available before a rich revision exists: Loom validates the Task against the admitted legacy hierarchy and supplies bounded legacy Task context without inventing missing Plan semantics. An OQ answer remains a narrow role-owned answer; it does not substitute for an independent Reviewer/Critic/Product Acceptance gate.

## Hierarchy and DAG Are Separate

Hierarchy describes **scope ownership and progress**.

The DAG describes **execution ordering and dependency**.

Neither replaces the other.

Example:

```text
Objective: Product v1
  Phase: Core
    Wave 1
      Task A
      Task B
    Wave 2
      Task C
```

The execution DAG may state:

```text
Task A ─┐
        ├──> Task C
Task B ─┘
```

Loom MUST NOT flatten hierarchy merely because dependencies form a graph.

## Workflow Relationship

A Loom workflow is an **execution attempt over some bounded work scope**, not the parent Objective itself.

A workflow records which work node or nodes it is executing.

Example:

```text
Workflow: wf-123
Scope: Objective Leash v1 / Phase Core / Wave Dry-run foundation
```

When that workflow finishes:

```text
Workflow                     COMPLETE
Wave: Dry-run foundation     COMPLETE
Phase: Core                  ACTIVE
Objective: Leash v1          ACTIVE
```

A completed workflow therefore does not imply that its ancestors are complete.

## Simple and Non-Product Work

The hierarchy is required for Planner-driven product work where Loom must preserve progress across multiple bounded workflows.

The existing simple non-product `worker` path may remain a standalone workflow when the work does not need persistent multi-wave product tracking.

Loom MUST NOT manufacture empty Objective/Phase/Wave nodes only to satisfy ceremony. If simple work later becomes part of a larger tracked Objective, it may be attached through an explicit reconciliation step rather than inferred from conversational similarity.

## Independent Lifecycle State

Each work node carries its own lifecycle state.

Minimum states:

- `pending`
- `active`
- `blocked`
- `complete`
- `cancelled`
- `superseded`

Additional execution-specific states may exist without changing the hierarchy contract.

Example:

```text
Objective: Leash v1                 ACTIVE
  Phase: Core foundations           ACTIVE
    Wave: Dry-run foundation        COMPLETE
      Task: CLI genesis             COMPLETE
      Task: dependency reset        COMPLETE
    Wave: Admission + persistence   PENDING
```

## State Ownership and Mutation

Models propose work and report evidence. **The Loom control plane owns persistent hierarchy mutation.**

Planner may propose and register child decomposition under the already-established Objective. Worker, Reviewer, Critic, Acceptance, General, and other agents do not directly rewrite hierarchy state through prose.

Control-plane transitions own:

- node creation from an accepted Planner decomposition;
- activation/claim of runnable Tasks and Waves;
- Task completion from authorized workflow completion plus required evidence;
- Wave/Phase roll-up;
- Objective completion;
- blocking, cancellation, and supersession;
- reconciliation after replanning.

Shared hierarchy state is project-scoped and mutation is serialized or version-checked. A transition must fail on a stale expected version rather than silently overwrite newer state.

Two workflows MUST NOT independently claim the same exclusive Task execution or race an ancestor from `active` to `complete`.

The exact locking/storage mechanism is an implementation decision, but lost-update and double-completion behavior is not allowed.

## Completion Rules

### Task completion

A Task is complete only when its own required execution or decision, mandatory predecessor and independent-review dependencies, and verification evidence are satisfied. In the proposed mixed-role realization, a missing or unavailable role path cannot become complete through a Worker-only sibling, an OQ answer, or a workflow-level review of unrelated work. The current Worker-only Task compiler does not yet enforce that wider rule.

### Wave completion

A Wave is complete only when:

- all required active-generation Tasks are complete, including role-owned work and user-owned decisions where applicable;
- required Wave-level review/gates pass;
- required Wave-level evidence is satisfied.

### Phase completion

A Phase is complete only when:

- all required active-generation Waves are complete;
- any Phase-level gate or acceptance condition is satisfied.

### Objective completion

An Objective is complete only when:

- all required active-generation Phases are complete;
- no mandatory current child work remains unresolved;
- Objective-level Product Acceptance is satisfied when applicable (absence of Worker steps alone neither creates nor waives that obligation);
- required final review/shipping gates pass.

## Required Invariant

> Completion of a work node MUST NOT imply completion of an ancestor unless the ancestor's own completion criteria are independently satisfied.

This invariant prevents a bounded Wave from being mistaken for completion of the entire accepted product objective.

## Persistent Parent State

The hierarchy must survive:

- new OpenCode sessions;
- new Loom workflows;
- bounded child workflows;
- agent/session restarts;
- Planner regeneration;
- review and recovery cycles.

A later workflow should attach to existing work identity rather than recreate the Objective from conversational memory.

The control plane must be able to answer:

- What Objective does this workflow belong to?
- Which Phase/Wave/Task is being executed?
- Which plan generation is current?
- What is complete?
- What remains?
- What is blocked?
- What is superseded?
- What is the next dependency-eligible work?

## Planner Integration

Planner remains a disposable execution context and has no product authority.

The Objective is established first from accepted authority. Planner decomposes **inside that Objective** and proposes child work plus execution relationships.

Conceptually:

```text
accepted Objective authority
  -> Objective identity established
  -> Planner
  -> Phase / Wave / Task proposal
  -> dependency DAG
  -> ownership
  -> gates
  -> verification requirements
  -> control-plane validation/materialization
  -> independent Plan review
  -> Wave claim / execution
  -> persistent Loom work state
```

Planner cannot silently change Objective meaning while changing decomposition.

A separate human-readable Plan document remains optional unless another product or authority requires one.

The important change is that the **semantic work structure and progress identity are durable**, not only the current bounded workflow DAG.

## Replanning and Plan Generations

Replanning MUST preserve historical truth.

When execution has started, Planner may still revise the semantic Plan. Loom records each change as the next **immutable Plan revision** and updates only the effective Work projection; it never overwrites an original execution receipt. Explicit Plan invalidation still creates a replacement generation.

Rules:

1. Historical Plan revisions and invalidated Task execution receipts remain inspectable. Effective Task status may change from complete to pending after invalidation; the original result is retained in `priorResults`.
2. Removed work becomes `superseded`; adding/replacing work has an explicit revision record and is not evidence that removed work was completed.
3. A Task can retain a prior completion only when its own meaning, parent scope, role/authority, verification contract, and transitive Task dependencies are unchanged **and** the original attempt/evidence receipt is intact.
4. Changed prerequisites, authority, or evidence invalidate affected Task results and any completed consumers in their dependency closure; the old receipts remain historical, not current satisfaction.
5. A new executable Task graph requires fresh independent `review-plan` approval before the control plane claims the Wave. Handoff and implementation review gates are never auto-passed.
6. Reopening a reviewed Wave is denied after claimed or completed downstream work has consumed its result.
7. Ancestor completion is computed from effective current Work and the independently reviewed Wave/Objective gates. Neither a revision nor an older historical result can mark an incomplete Objective complete.
8. An explicit full-Plan replacement uses a new generation and preserves earlier generation history.

Exact generation IDs and persistence schema are implementation details.

## Execution Stage vs Work Phase

**Phase** is reserved for the persistent hierarchy defined here.

The workflow-local runtime concept previously named `phase` is an **execution stage**: for example THINK, BUILD, VERIFY, recovery, or another control-flow position inside one workflow.

New state and APIs MUST use `executionStage` (or an equivalent unambiguous name), not `phase`, for that runtime concept.

Legacy workflow snapshots containing a top-level workflow `phase` field are interpreted as legacy **execution-stage** metadata only. They MUST NOT be promoted into a hierarchical Phase without explicit reconciliation.

## Gate Scope

Gates attach to the work level they protect, and their scope is persisted.

Examples:

- solution/readiness gate: Objective or planning boundary;
- implementation review: Wave;
- Wave acceptance/integration proof: Wave;
- Product Acceptance: Objective;
- final holistic review: Objective.

A gate PASS only authorizes completion or progression at its declared scope.

For Objective implementation workflows, `review-plan` is a pre-execution Wave admission gate. Planner may compile the current Wave's exact executable Task contracts while the Wave remains unclaimed. Reviewer assesses the holistic Plan plus that executable DAG; only PASS authorizes the control plane to acquire the Wave claim. FAIL leaves the Plan/DAG unconsumed and amendable. This gate does not prove implementation or whole-product acceptance.

For a planning-only Objective workflow, the same gate has **planning scope only**: there is deliberately no executable DAG or Wave claim to admit. Under accepted Anchor AC8, PASS requires independent whole-Plan review confirming each mandatory obligation's accountable role, handoff and **currently implemented/enabled** future execution or decision path, including later Waves; a missing, unavailable or unrepresented owner/path or independent gate is a reported blocker, not a PASS postponed to Wave admission. The review does not require premature executable slots, but an unimplemented proposed compiler or hypothetical future route does not satisfy it. PASS attests only to the reviewed semantic Plan; it does not change existing Task/Wave implementation state, acquire a Wave claim, authorize dispatch, prove Task output, or complete the Objective. Delivery must separately validate the then-current capabilities and pass concrete Wave admission.

### Product Acceptance boundary

Loom's existing **Product Acceptance** meaning remains whole-product proof against accepted Anchor/requirement outcomes through the real product-owned composition.

Objective-level Product Acceptance is therefore the Product Acceptance result used for Objective completion.

A Wave may carry scoped **Wave acceptance** or integration evidence for criteria owned by that Wave. Such evidence may contribute to later Product Acceptance, but it is never equivalent to whole-product Product Acceptance unless that Wave itself is the complete accepted product outcome.

A Wave-level PASS MUST NOT be promoted into Objective-level Product Acceptance by roll-up.

## Control-Plane Consequences

The control plane will need persistent identities and parent relationships for work nodes.

At minimum, future implementation must support:

- stable work-node IDs;
- node type: Objective / Phase / Wave / Task;
- parent ID;
- plan generation / supersession identity;
- lifecycle state;
- dependency references;
- workflow-to-work-scope attachment;
- persisted gate scope;
- serialized or version-checked hierarchy mutation;
- exclusive active Task claim where required;
- completion roll-up that checks current-generation ancestor criteria rather than blindly propagating success;
- queries suitable for status/sidebar views.

Exact storage schema and tool API are implementation decisions and are intentionally not prescribed here.

## Backward Compatibility

Existing workflows without hierarchy metadata remain readable.

They are treated as standalone legacy execution records unless explicitly attached to a reconstructed Objective.

Loom MUST NOT infer that an old `workflow=complete` record proves a larger Objective complete.

Legacy workflow `phase` metadata is interpreted only as an execution stage, never as a persistent hierarchical Phase.

Historical task graphs remain historical evidence. Attaching them to a reconstructed Objective requires explicit reconciliation and does not fabricate ancestor completion.

## Example: Leash v1

```text
Objective: Leash v1

  Phase: Core foundations
    Wave: Dry-run foundation              COMPLETE
      Task: CLI genesis                   COMPLETE
      Task: dependency admission reset    COMPLETE
      Task: disclosure guard              COMPLETE
      Task: AgentDefinition dry-run       COMPLETE

    Wave: Admission + persistence         PENDING

  Phase: Runtime
    Wave: Workflow / AgentRun             PENDING
    Wave: Authority / budgets             PENDING
    Wave: Provider execution              PENDING

  Phase: Controlled effects
    Wave: Resources / tools / MCP         PENDING
    Wave: Containment                     PENDING

  Phase: Product completion
    Wave: assembled scenarios             PENDING
    Objective Product Acceptance          PENDING
```

Completing the first Wave records:

```text
Workflow: COMPLETE
Dry-run foundation: COMPLETE
Leash v1: ACTIVE
```

It does not record `Leash v1: COMPLETE`.

## Verification Intent

The implementation should eventually prove at least these cases:

1. Completing every step in a Wave workflow marks the Wave complete but leaves an incomplete ancestor Objective active.
2. A new session can attach another workflow to the same persistent Objective and recover remaining work.
3. Parent completion is rejected while a mandatory descendant remains pending or blocked.
4. Wave-level gate success cannot satisfy an Objective-level Product Acceptance or final gate.
5. Dependency eligibility is computed from the DAG without losing hierarchy.
6. Legacy standalone workflows remain readable without fabricating parent completion.
7. Legacy workflow `phase` is interpreted as execution-stage metadata, not hierarchical Phase.
8. Two concurrent workflows cannot both exclusively claim the same Task or overwrite hierarchy state from stale versions.
9. Same-generation Plan amendments record immutable revisions and retain invalidated completion receipts as history without treating them as current.
10. Changed prerequisites, role/authority, or missing original evidence prevent invalid carry-forward of dependent completion.
11. Simple non-product work can remain standalone without ceremonial empty hierarchy nodes.
12. Status/UI can show both bounded workflow completion and parent Objective progress.

## Satisfies

- [BR-001](../../requirements/loom/br-001-run-autonomously-to-real-boundary.md)
- [BR-004](../../requirements/loom/br-004-produce-the-whole-product.md)
- [BR-007](../../requirements/loom/br-007-evidence-outranks-model-claims.md)
- [BR-008](../../requirements/loom/br-008-bounded-autonomy-and-progress.md)
- [BR-010](../../requirements/loom/br-010-fresh-sessions-start-from-map.md)


## Execution claim lifetime and cancellation

A live Wave claim authorizes execution; it is not the permanent record of who reviewed completed work. `review-implementation` PASS records `completion` on the Wave and releases live claims. That receipt is exact to the completing workflow, work-plan generation, executed Tasks, and the full reviewed Task set. Later documentation/product gates consume it without modifying completed Task state. A replacement executing the remaining Tasks may assemble them with already-completed, unclaimed Tasks, but must still pass its own implementation review. This does not automatically adopt an unreviewed all-complete Wave or inherit another workflow's proof.

`loom_cancel` terminates the workflow, not its Objective/Phase/Wave/Task hierarchy. It retains completed work and releases only claims owned by the cancelled workflow. Incomplete work remains incomplete; replan/supersession is a separate authorized action. A new plan generation may preserve old completed nodes as history, but cancellation never relabels those nodes as fresh proof.

Implementation reopening requires the exact completed receipt and refuses to invalidate a Wave already consumed by claimed/completed downstream work. A Plan-only reopen preserves individually verified completed Task receipts where their contracts and dependency closure are unchanged, but still requires fresh Plan review. Documentation-only reopening leaves the live claim absent. For older completed Waves without receipts, the control plane admits only uniquely attributable persisted review history; ambiguity is reported, not repaired by taking ownership.

See [Control Plane](control-plane.md#workflow-cancellation-and-reviewed-completion) and [Runtime Upgrades](../../user/upgrades.md#cancelling-or-replacing-a-stuck-workflow).


When reopening a partial-recovery workflow, downstream-consumer checks start from **every Task in the reviewed Wave**, not only the Tasks that replacement executed. Removing a whole-Wave receipt invalidates the admission prerequisite of any dependent Wave. Claimed or completed direct/transitive consumers block reopening before any state change; unconsumed work remains reopenable.
