---
type: decision
title: Dashboard Projection Transport
description: Publish bounded dashboard snapshots as atomic host-local XDG files before considering socket/RPC transport.
tags: [architecture, decision, loom, dashboard, observability, transport]
---

**Status:** proposed

## Decision

V1 publishes dashboard data through a host-local instance registry and bounded JSON snapshot files under a user-private XDG runtime/state directory.

Each publisher writes a complete temporary generation and atomically replaces the canonical snapshot. A lease expiry determines online/stale state.

A later local RPC/socket transport may supplement or replace files without changing the projection schema.

## Drivers

- several independent OpenCode processes must be observable together;
- dashboard failure must not become an execution dependency;
- no listener/port lifecycle should be required per OpenCode process;
- readers need deterministic complete-generation semantics;
- the transport should remain simple enough to inspect/debug locally.

## Alternatives considered

### One HTTP listener per OpenCode process

Deferred because it creates port/discovery/lifecycle complexity for no V1 requirement.

### Dashboard reads Loom persistence directly

Rejected because it couples UI to internal storage layout and risks bypassing the bounded projection/privacy contract.

### OpenCode database as dashboard source

Rejected for Loom workflow truth; it remains optional read-only enrichment only.

## Consequences

Snapshot files need schema versioning, generation, timestamps, lease expiry, user-only permissions, and atomic replacement. Aggregators must never compare per-instance generations across publishers.

## Reconsider when

Interactive control, remote observation, or high-frequency streaming becomes an accepted product requirement.
