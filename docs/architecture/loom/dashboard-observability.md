---
type: design
title: Loom Dashboard Observability
description: Read-only operational projection and aggregation for observing concurrent Loom work outside the OpenCode TUI.
tags: [architecture, loom, dashboard, observability, projection]
---

**Status:** proposed

## Purpose

Loom needs a useful operational view outside the OpenCode TUI for a user who routinely runs several unrelated OpenCode+Loom sessions across multiple repositories and folders.

This design owns **read-only projection, aggregation, freshness, optional OpenCode enrichment, and dashboard boundaries**. It depends on [Runtime Isolation](runtime-isolation.md); the dashboard must observe already-correct compartments rather than invent identity by inference.

The human-facing information architecture and interaction contract live in [Dashboard Experience Design](../../design/loom/dashboard-experience.md).

## Operational questions

The projection exists to answer a bounded set of operator questions without reading arbitrary Loom internals:

1. Which workflows need attention now, and why?
2. What is actively running or runnable in each project/workflow?
3. What is blocked by OQs, verification, budget, Product Acceptance, or consistency conflict?
4. What is the latest trustworthy Loom state, and which publishers are stale/offline or lagging?
5. Which visible values are Loom-authoritative and which are optional OpenCode telemetry?
6. When supplemental telemetry is missing, is it unavailable/disabled rather than truly zero?

Fields that do not help answer these questions should not be added merely because they are easy to export.

## Dashboard boundary

The dashboard consumes a **read-only operational projection**.

It does not read arbitrary Loom internals and it does not mutate Loom.

### Snapshot model

A project/workflow snapshot should contain bounded operational fields such as:

```text
installation
instance
project
session
workflow
workflow revision
objective/work-scope identity
workflow state
current/runnable steps
Objective → Phase → Wave → Task hierarchy plus hierarchical progress/work version
current Plan generation/revision, goal, obligation/risk/Product Acceptance coverage, and bounded Task context
Plan amendment/invalidation state
open OQ count plus Plan generation/revision/Task origin when correlated, including bounded historical origin context after later amendments
open verification count
budget usage/exhaustion
Product Acceptance state
knowledge-sync validity
recent transition/activity timestamp
active agent/model metadata when safely available
```

No raw secrets, auth material, hidden system prompts, or unrestricted tool-result bodies are exported.

Optional numeric/telemetry fields preserve absence explicitly. Missing/unavailable data is never coerced to zero, false, healthy, or complete.

### Local instance publication

The first dashboard transport should avoid making the dashboard a dependency of Loom execution.

Preferred V1 shape:

```text
OpenCode + Loom process
        |
        | state changes / heartbeat
        v
host-local read-only projection
        |
        v
dashboard aggregator
        |
        v
dashboard UI
```

A practical implementation is a host-local instance registry plus bounded snapshot files under an XDG runtime/state directory.

For example:

```text
<persisted-installation-runtime-root>/instances/<installationId>/<instanceId>/manifest.json
<persisted-installation-runtime-root>/instances/<installationId>/<instanceId>/projects/<projectId>.json
```

The manifest carries heartbeat/process metadata and the snapshot carries operational state.

### Snapshot publication invariant

Every published manifest/project snapshot carries at least:

```text
schemaVersion
instanceId
projectId
generation
generatedAt
leaseExpiresAt
```

Publication is atomic:

1. serialize the complete next generation to a temporary file in the same directory;
2. flush/close it;
3. atomically replace the previous snapshot;
4. only complete JSON documents become visible at the canonical path.

`generation` is monotonic for one instance/project publisher. The dashboard ignores an older generation after observing a newer one.

Heartbeat freshness is explicit through `leaseExpiresAt`. When the dashboard clock is later than that value, the instance/project is shown as stale/offline until a newer atomic publication arrives. A torn/unparseable snapshot is ignored and never merged with fields from another generation.

This avoids requiring each OpenCode process to expose a network listener and allows several independent OpenCode processes to be aggregated safely.

A later local RPC/socket transport may replace or supplement snapshot files without changing the projection contract.

## OpenCode database enrichment

The dashboard MAY open OpenCode's database read-only for presentation/telemetry that Loom does not own, such as:

- session title;
- model/provider;
- token/cost/cache statistics where available;
- message/tool counts;
- last assistant output preview;
- session timestamps.

Rules:

1. join to Loom through explicit OpenCode session identity;
2. never infer Loom PASS/FAIL/current-step truth from OpenCode messages;
3. never write the OpenCode database;
4. tolerate schema/version drift by disabling unavailable enrichment rather than corrupting Loom state;
5. keep sensitive transcript display opt-in and bounded.

Loom control-plane state remains authoritative for workflow semantics.

## Dashboard views supported by the projection

The first useful dashboard does not need to reproduce the OpenCode TUI.

### Fleet view

One row/card per active/recent compartment:

- project;
- workflow/objective;
- current step/agent;
- progress;
- blocked/failed indicators;
- open OQs;
- open verification;
- budget pressure;
- last activity;
- instance online/stale state.

### Project view

Shows the Objective → Phase → Wave → Task tree, the current Plan goal/revision, Phase/Wave intent, Task outcomes/acceptance/subtasks/integration context, obligation/risk/Product Acceptance coverage, amendment/invalidation history, active workflows, current claims, and recent transitions. Correlated OQs are visible at the Task that caused them and link back to the originating workflow.

### Workflow view

Shows:

- execution stage;
- runnable/current/recent steps;
- Reviewer/Critic/Acceptance position;
- evidence/verification summary;
- OQs;
- dispatch budget;
- latest status summaries.

### Session enrichment

Optional OpenCode-derived panel with model, messages, tokens/cost, last output, and session timing.

The architecture provides the data required by those views. The projection is deliberately bounded: active/non-terminal work is always present, while older terminal history may be trimmed with an explicit truncation marker rather than silently omitted as if no history existed. Exact information hierarchy, interactions, visual states, and accessibility belong to the Designer artifact rather than this architecture document.

## Failure semantics

Dashboard failure must never block Loom.

Projection write failure:

- is observable operational degradation;
- does not change workflow state;
- may be retried independently;
- must not convert state into success/failure.

Dashboard stale data is visibly timestamped.

If two instances report the same `projectId/workflowId`, that is not automatically a conflict: multiple processes may legitimately participate in one workflow.

The aggregator groups those reports as workflow participants and never field-merges them. It uses the durable workflow `revision` to reason about state ordering and publisher lease to reason about liveness:

- a lower revision is a lagging participant view;
- the highest observed valid revision is the latest-known Loom state candidate;
- if every publisher carrying that highest revision has an expired lease, the latest-known state remains visible but is explicitly marked **stale-source**; a live lower-revision participant does not overwrite it;
- two reports claiming the **same highest revision** but different workflow state are a consistency conflict and no winner is inferred;
- participant liveness is displayed separately from workflow state freshness;
- per-instance snapshot `generation` orders publications only from that one publisher and is never used to order different instances.

## Security and privacy

- projection is local-user readable by default;
- files use user-only permissions where supported;
- no credential values are projected;
- raw shell/tool output is excluded by default;
- dashboard mutations are absent in V1;
- any future control actions require a separately authenticated/authorized command path, not writable snapshot files.

Additional dashboard rules:

- transcript/output previews are opt-in and visibly classified as OpenCode-derived supplemental data;
- dashboard data is never interpreted as product or workflow authority;
- the observation surface has no mutation method in V1;
- projection publication failure is operational degradation, not workflow failure.

## Implementation sequence

1. Define the versioned projection contract after runtime compartment identity is available.
2. Publish bounded instance/project/workflow snapshots plus heartbeat/lease atomically.
3. Build the aggregator that groups instance participants without field-merging them.
4. Implement the external dashboard against the Designer artifact and projection contract.
5. Add optional read-only OpenCode database enrichment after Loom state aggregation is correct.
6. Verify stale/offline, conflicting same-revision participants, projection failure, and multiple concurrent projects.

## Related decision and specification

- [Dashboard Projection Transport](decisions/dashboard-projection-transport.md)
- [Dashboard Projection Specification](specs/dashboard-projection.md)

## Non-goals

This design does not:

- make the dashboard a workflow controller;
- infer Loom truth from OpenCode transcripts/messages;
- require a network listener in every OpenCode process;
- expose raw transcripts, secrets, hidden prompts, or unrestricted tool output by default;
- merge unrelated projects because their local names match;
- make dashboard availability a dependency of Loom execution.

## Satisfies

- [BR-017](../../requirements/loom/br-017-concurrent-sessions-projects-compartmentalized.md)
- [BR-018](../../requirements/loom/br-018-external-operational-dashboard.md)
