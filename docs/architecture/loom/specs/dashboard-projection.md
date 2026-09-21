---
type: specification
title: Dashboard Projection Specification
description: Versioned read-only projection contract for aggregating concurrent Loom instances/projects/workflows.
tags: [architecture, specification, loom, dashboard, observability]
---

**Status:** proposed

## Runtime root and file layout

Projection publication uses the same **installation-persisted absolute runtime root** as cross-process coordination. The first Loom process selects and atomically records that root in `runtime-root.json`; every later process sharing the durable installation uses the persisted value regardless of its own `XDG_RUNTIME_DIR`.

The standalone dashboard resolves the root by reading that same installation metadata. If no Loom installation has initialized yet, it shows an empty fleet from the state-root fallback rather than creating workflow state.

V1 publishes:

```text
<root>/instances/<installationId>/<instanceId>/manifest.json
<root>/instances/<installationId>/<instanceId>/projects/<projectId>.json
```

All directories/files are created user-private where the host supports permissions. A publisher that cannot safely write this root reports projection degradation but does not change Loom workflow state.

## Instance manifest

```text
InstanceManifestV1 {
  schemaVersion: 1
  installationId: string
  instanceId: string
  processId?: number
  startedAt: timestamp
  generatedAt: timestamp
  leaseExpiresAt: timestamp
  projects: projectId[]
}
```

## Project snapshot

```text
ProjectSnapshotV1 {
  schemaVersion: 1
  installationId: string
  instanceId: string
  projectId: string
  generation: integer >= 0
  generatedAt: timestamp
  leaseExpiresAt: timestamp

  project: {
    displayName?: string
    canonicalLocation: string
  }

  projectionWindow: {
    workflowsTruncated: boolean
    completedObjectivesTruncated: boolean
  }

  workObjectives: WorkObjectiveProjectionV1[]
  workflows: WorkflowProjectionV1[]
  enrichment?: OpenCodeEnrichmentV1
}
```

`generation` is monotonic only for one `instanceId + projectId` publisher. All timestamps in this specification are UTC RFC3339 strings.

Optional values have three distinct meanings: explicit zero/false, unavailable/unknown (field omitted or status says unavailable), and disabled/not requested. Readers MUST NOT coerce omission into zero or healthy state.

## Work hierarchy projection

The project snapshot carries enough hierarchy structure for the Project view without requiring the dashboard to read Loom persistence directly.

```text
WorkState = "pending" | "active" | "blocked" | "complete" | "cancelled" | "superseded"

WorkObjectiveProjectionV1 {
  objectiveId: string
  anchor?: string
  title?: string
  status: WorkState
  workVersion: integer >= 1
  generation: integer >= 0
  stateDigest: string
  phases: WorkPhaseProjectionV1[]
}

WorkPhaseProjectionV1 {
  phaseId: string
  title?: string
  status: WorkState
  waves: WorkWaveProjectionV1[]
}

WorkWaveProjectionV1 {
  waveId: string
  title?: string
  status: WorkState
  tasks: WorkTaskProjectionV1[]
}

WorkTaskProjectionV1 {
  taskId: string
  title: string
  status: WorkState
  claimedByWorkflowId?: string
}
```

The projection preserves the current hierarchy generation and its independent durable `workVersion`. `stateDigest` is SHA-256 over canonical UTF-8 JSON of the normalized Loom-authoritative Objective projection, excluding publisher identity and publication timestamps. It MUST NOT flatten Workflow completion into ancestor Objective completion.

V1 projects the current generation rather than replaying the entire historical work graph. Superseded/cancelled historical nodes are available through Loom's durable store but are not required in the bounded dashboard projection unless a later product requirement adds history browsing.

## Shared summary types

```text
StepSummary {
  id: string
  agent: string
  kind: "work" | "gate"
  status: "pending" | "complete" | "passed" | "failed"
  label?: string
}

ProgressSummary {
  complete: integer >= 0
  total: integer >= 0
  blocked?: integer >= 0
  active?: integer >= 0
  failed?: integer >= 0
}
```

## Workflow projection

```text
WorkflowProjectionV1 {
  workflowId: string
  workflowRevision: integer >= 0
  stateDigest: string

  workScope?: {
    objectiveId: string
    generation: integer >= 1
    phaseId?: string
    waveId?: string
    taskIds?: string[]
  }
  anchor?: string
  executionStage?: string
  status: "active" | "blocked" | "failed" | "complete"

  currentSteps: StepSummary[]
  runnableSteps: StepSummary[]
  hierarchyProgress?: {
    objective?: ProgressSummary
    phases?: ProgressSummary
    waves?: ProgressSummary
    tasks?: ProgressSummary
  }

  openOqCount: integer >= 0
  openVerificationCount: integer >= 0

  budget: {
    used?: number
    limit?: number
    exhausted: boolean
  }

  productAcceptance?: {
    status: string
    passed?: number
    failed?: number
    unproven?: number
  }

  knowledgeSync?: {
    valid: boolean
    updatedAt?: timestamp
  }

  recentActivityAt: timestamp
  participatingSessionIds: string[]
  activeAgent?: string
  activeSessionId?: string
}
```

`stateDigest` is SHA-256 over canonical UTF-8 JSON of the normalized Loom-authoritative workflow projection. Canonical JSON uses recursively lexically sorted object keys and preserves array order. The digest excludes publisher identity, `generation`, publication timestamps/lease, and OpenCode enrichment, but includes all projected Loom-authoritative workflow fields.

This lets the aggregator detect two publishers claiming the same `workflowRevision` with incompatible authoritative state.

The projection MUST preserve explicit instance/project/session/workflow identity. OpenCode-derived data is nested under `enrichment` and is never mixed into the Loom-authoritative workflow object.

## Bounded projection window

The dashboard projection is an operational view, not the durable history store.

Each publisher MUST include:

- every non-terminal work Objective in the project;
- every workflow that is active, blocked, or failed;
- every workflow referenced by a currently claimed/runnable Task or Wave;
- enough terminal/recent workflow state to satisfy the configured dashboard recent-history window.

Older terminal workflows/Objectives may be omitted. When omission occurs, the corresponding `projectionWindow.*Truncated` flag is true so the dashboard does not imply that the bounded snapshot is complete historical inventory.

OpenCode enrichment is bounded to sessions participating in the projected workflows. V1 does not export an unbounded list of unrelated historical OpenCode sessions.

## Publication

1. serialize one complete next generation to a temporary file in the same directory;
2. flush/close;
3. atomically replace the canonical file;
4. expose only complete JSON documents.

Readers ignore torn/unparseable documents. An older generation from the same publisher cannot replace a newer observed generation.

## Freshness

`leaseExpiresAt` is authoritative for publication freshness. After expiry, the dashboard shows the publisher stale/offline until a newer valid generation arrives.

No activity heuristic substitutes for lease expiry.

## Multi-instance aggregation

Several instances may legitimately report the same project/workflow.

The aggregator groups them as participants and never field-merges snapshots.

For one workflow:

- lower `workflowRevision` is a lagging participant view;
- highest observed valid revision is the latest-known display candidate;
- if all publishers carrying that highest revision have expired leases, the candidate is retained as latest-known but marked `stale-source`;
- a live publisher at a lower revision is shown as live-but-lagging and does not replace a higher latest-known revision;
- same highest revision with different `stateDigest` is a consistency conflict and is surfaced visibly with no inferred winner;
- participant liveness and workflow-state freshness are separate display dimensions;
- per-instance `generation` is never used to order different publishers.

For one projected Objective/work hierarchy, apply the same rule using `workVersion` and its Objective `stateDigest`. Workflow and work-hierarchy freshness are independent: a current workflow projection cannot be used to overwrite a newer work hierarchy, or vice versa.

## Optional OpenCode enrichment

```text
OpenCodeEnrichmentV1 {
  status: "available" | "partial" | "unavailable"
  sourceSchema?: string
  errorSummary?: string
  sessions: {
    sessionId: string
    title?: string
    provider?: string
    model?: string
    messageCount?: number
    toolCount?: number
    inputTokens?: number
    outputTokens?: number
    cacheReadTokens?: number
    cacheWriteTokens?: number
    cost?: number
    createdAt?: timestamp
    updatedAt?: timestamp
    lastOutputPreview?: string
  }[]
}
```

Enrichment joins through explicit OpenCode session identity, is read-only, tolerates schema/version drift by omitting unavailable fields, and never decides Loom status. Absence of the entire `enrichment` object means enrichment is disabled/not requested; `status=unavailable` means requested but unavailable. Optional numeric values such as token/cost/message counts are unknown when omitted and zero only when explicitly reported as zero. `lastOutputPreview` is absent unless the user enables transcript/output preview.

## Privacy

The default projection excludes credentials, raw hidden prompts, unrestricted tool output, and full transcripts. Output/transcript previews are opt-in presentation data.

## Conformance evidence

Tests must cover two concurrent projects with identical local names, a projected Objective → Phase → Wave → Task tree whose ancestor completion remains independent of workflow completion, workflow-to-work-scope links, competing work-hierarchy publishers ordered by `workVersion` with same-version digest conflict detection, same workflow reported by multiple publishers, bounded-history truncation flags, atomic generation replacement, stale lease expiry, a stale highest-revision publisher beside a live lower-revision publisher, same-revision disagreement, projection write failure not blocking Loom, disabled vs unavailable enrichment, missing-vs-explicit-zero telemetry, and an observation surface with no mutation operation.
