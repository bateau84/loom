---
type: Obligation Contract
title: OC-001 — Host observation and dispatch provenance
description: Shared semantics for native execution identity and Loom's attributable evidence history.
tags: [learning, provenance, native-host, contracts]
timestamp: 2026-11-12T00:00:00Z
---
# OC-001 — Host observation and dispatch provenance

**Priority:** Must. **Status:** Proposed for independent requirements assessment; not an implemented or verified runtime capability.

**Participants:** Native execution host (source of actually observed identities), Loom evidence capture/reader, and consumers interpreting dispatch relationships.

**Preconditions:** A native Session, invocation, tool event, subagent dispatch or result crosses an observable host boundary; the host may expose incomplete or ambiguous IDs.

**Guarantees:**
- Host-observed Session, message, call, agent and dispatch identities retain their actual source and scope. A Loom-generated record identifier does not manufacture native execution identity.
- A parent dispatch, child Session and one specific invocation are distinct semantic objects; child Session reuse alone is not one stable dispatch.
- A callback/result retains its originally established work association even when mutable selection changes afterward; unresolved association stays unknown or ambiguous.
- Authored relationships, text in native prompts and later analytical links do not become host attestations of origin or independent user requests.
- Retrieval of evidence across native Sessions remains permission-checked. The existence of a relationship or record does not convey read authority.

**Semantic input/output:** Input is host-observed execution and source context, with observable identity/coverage. Output is captured source evidence and qualified relationships exposing which identities and joins are established or unavailable.

**Failure semantics:** Missing hooks, duplicate/opaque host keys, a late callback, unavailable or truncated native context, partial capture and restart remain inspectable gaps or incomplete joins. Do not resolve them by FIFO, titles, agent name or time alone.

**Invariant:** No recorded event can be confidently attributed to a different execution solely because a later reader or Evaluator found a plausible relationship.

**Verification semantics:** Compare native parent/child invocation receipts to Loom source records across concurrent, reused and incomplete event families. Force a missing/ambiguous identity and inspect public readback for explicit uncertainty.

## Derived from
- [BR-001 — Preserve execution attribution](br-001-preserve-execution-attribution.md)
- [BR-002 — Preserve historical work scopes](br-002-preserve-historical-work-scopes.md)
