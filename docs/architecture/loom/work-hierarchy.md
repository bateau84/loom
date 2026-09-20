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

Loom should model persistent work separately from workflow execution.

The work hierarchy is:

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

### Phase

A major coherent segment of the Objective.

A Phase groups related Waves and may carry phase-level prerequisites or gates.

### Wave

A bounded executable grouping of Tasks chosen for safe sequencing, concurrency, review, and acceptance.

A Wave is the normal unit of bounded autonomous implementation.

### Task

The smallest Planner-owned unit that should be independently assigned, executed, verified, and completed.

A Task may require multiple runtime steps or agent invocations.

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

## Independent Lifecycle State

Each work node carries its own lifecycle state.

Minimum states:

- `pending`
- `active`
- `blocked`
- `complete`
- `cancelled`

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

## Completion Rules

### Task completion

A Task is complete only when its own required execution and verification evidence are satisfied.

### Wave completion

A Wave is complete only when:

- all required Tasks are complete;
- required Wave-level review/gates pass;
- required Wave-level evidence is satisfied.

### Phase completion

A Phase is complete only when:

- all required Waves are complete;
- any Phase-level gate or acceptance condition is satisfied.

### Objective completion

An Objective is complete only when:

- all required Phases are complete;
- no mandatory child work remains unresolved;
- Objective-level Product Acceptance is satisfied when applicable;
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
- What is complete?
- What remains?
- What is blocked?
- What is the next dependency-eligible work?

## Planner Integration

Planner remains a disposable execution context, but its decomposition must be materialized into persistent Loom work state.

Conceptually:

```text
accepted solution
  -> Planner
  -> Objective / Phase / Wave / Task structure
  -> dependency DAG
  -> ownership
  -> gates
  -> verification requirements
  -> persistent Loom work state
```

A separate human-readable Plan document remains optional unless another product or authority requires one.

The important change is that the **semantic work structure and progress identity are durable**, not only the current bounded workflow DAG.

## Gate Scope

Gates attach to the work level they protect.

Examples:

- Solution/readiness gate: Objective or planning boundary
- implementation review: Wave
- Product Acceptance: Wave and/or Objective depending on what is being proven
- final holistic review: Objective

A gate PASS only authorizes completion or progression at its declared scope.

A Wave-level Product Acceptance PASS MUST NOT be interpreted as Objective-level Product Acceptance.

## Control-Plane Consequences

The control plane will need persistent identities and parent relationships for work nodes.

At minimum, future implementation must support:

- stable work-node IDs;
- node type: Objective / Phase / Wave / Task;
- parent ID;
- lifecycle state;
- dependency references;
- workflow-to-work-scope attachment;
- completion roll-up that checks ancestor criteria rather than blindly propagating success;
- queries suitable for status/sidebar views.

Exact storage schema and tool API are implementation decisions and are intentionally not prescribed here.

## Backward Compatibility

Existing workflows without hierarchy metadata should remain readable.

They should be treated as standalone legacy execution records unless explicitly attached to a reconstructed Objective.

Loom MUST NOT infer that an old `workflow=complete` record proves a larger Objective complete.

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
4. Wave-level gate success cannot satisfy an Objective-level gate.
5. Dependency eligibility is computed from the DAG without losing hierarchy.
6. Legacy standalone workflows remain readable without fabricating parent completion.
7. Status/UI can show both bounded workflow completion and parent Objective progress.

## Satisfies

- [BR-001](../../requirements/loom/br-001-run-autonomously-to-real-boundary.md)
- [BR-004](../../requirements/loom/br-004-produce-the-whole-product.md)
- [BR-008](../../requirements/loom/br-008-bounded-autonomy-and-progress.md)
- [BR-010](../../requirements/loom/br-010-fresh-sessions-start-from-map.md)
