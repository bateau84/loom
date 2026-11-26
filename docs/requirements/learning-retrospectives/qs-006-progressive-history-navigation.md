---
type: Quality Scenario
title: QS-006 — Progressive history navigation
description: Usable and truthful selective investigation of large planned and unplanned work histories.
tags: [learning, history, navigation, quality, dashboard]
timestamp: 2026-11-26T00:00:00Z
---

# QS-006 — Progressive history navigation

**Priority:** Must. **Status:** Accepted target from the operator's #227
assignment; executed qualification belongs to the delivery record.

**Source and stimulus:** An unfamiliar authorized investigator starts with one
known Action or Session and needs to understand a selected engineering outcome,
including failures, corrections, partial rechecks and missing evidence.

**Environment:** A realistic large history has many unrelated recorded Sessions
and observations, historical Plan changes, concerns, conflicting authored claims
and a useful reference trajectory. An equivalent fixture has no Plan. Original
native/Git/CI sources may be unavailable or separately protected. The operator's
private history is not imported into CI.

**Response:** Return a bounded meaningful overview with significant branches,
source references, qualified counts and explicit coverage. Selective expansion
returns coherent related records. The dashboard and document expose the same
identities and qualifications. Denied information remains absent from all derived
channels; unavailable originals remain explicit gaps where disclosable.

**Measures and acceptance criteria:**

- Measure supported tool-call count, UTF-8 response bytes and retrieval latency
  for the same information need using the existing interfaces and new navigation.
  State fixture size, source/permission simulation and excluded work. Do not infer
  production latency, model-token savings or causal efficiency from these values.
- Record whether exhaustive client enumeration or pre-known child IDs were
  necessary. Where practical, verify that an unfamiliar agent picks the relevant
  branch without those IDs, and state how selection correctness was assessed.
- A failure, unchanged-code rerun and corrected-head verification remain distinct;
  no plain PASS or completion claim becomes proof of diagnosis or comprehensive
  acceptance. Observations cannot displace all material authored outcomes/concerns.
- Historical WorkRefs resolve at their original revision; node-only and no-Plan
  groups retain unknown assignment/attempt meaning. A reused Session does not
  become one invocation.
- Every output format agrees on source identities, coverage, omitted content and
  expansion requests. Exercise keyboard disclosure, visible focus, responsive
  layout and hostile source-text escaping in the human view.
- Test unauthorized discovery/inspection/disclosure, mismatched scope or store,
  refresh after change and final permission denial. Inspect complete serialized
  responses for leaks through counts, labels, relations, errors or navigation.
- Verify read-only behavior and preservation of existing exact readers, capture,
  Stage 3 membership and Evaluator execution safeguards. Separate a live sequence
  boundary from immutable retrospective membership.

## Derived from

- [BR-010 — Navigate layered engineering history](br-010-layered-engineering-history.md).
- [QS-001 — Concurrent execution attribution](qs-001-concurrent-execution-attribution.md) and [QS-004 — Protect derived reports](qs-004-protect-derived-reports.md).

## Realized by

- [Layered engineering history architecture](../../learning-engineering-history.md).
