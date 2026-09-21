---
type: decision
title: Cross-Process Mutation Guard
description: Serialize host-local shared Loom mutations with installation-shared OS-backed advisory locks plus re-read/version validation.
tags: [architecture, decision, loom, concurrency, locking]
---

**Status:** proposed

## Decision

V1 uses host-local OS-backed exclusive advisory locks rooted in one installation-persisted shared runtime/state directory.

The first process atomically persists the selected absolute lock root in durable installation metadata. Later processes sharing the same durable Loom state MUST use that persisted root even when their local `XDG_RUNTIME_DIR` differs or is absent. Inability to access the persisted root is a hard mutation failure, not permission to choose a second lock domain.

The lock key is a filesystem-safe digest of the full scoped aggregate identity. Operations touching several aggregates acquire locks in canonical lexical order, re-read durable state after acquisition, validate current version/membership/claim preconditions, persist with an atomic/transactional durable commit while locked, then release.

The advisory lock provides writer ordering, not crash-safe persistence by itself. The guarded storage write MUST expose either the complete prior record or the complete next record after process failure; file-backed state uses atomic replacement on the same filesystem, while transactional storage may use its native atomic commit.

An in-memory mutex may optimize one process but is never the correctness boundary.

## Drivers

- multiple OpenCode+Loom processes are normal;
- the same workflow/objective may legitimately be touched by several processes;
- stale in-memory state must not overwrite newer durable generations;
- project-local names must not cause unrelated projects to serialize.

## Alternatives considered

### In-memory mutex

Rejected as insufficient across processes.

### Network lock service

Deferred because V1's mutable storage domain is host-local and should not require a network dependency.

### Storage-native transaction/CAS

Preferred if/when the chosen durable store exposes a reliable equivalent; the behavioral contract remains the same.

## Consequences

A process that cannot access the installation-shared lock root cannot participate in mutable shared state. Process death releases advisory locks, but every resumed mutation still re-reads durable state before commit. Process death during persistence must not leave a partially serialized aggregate visible to the next reader.

## Reconsider when

Loom supports one mutable storage domain shared across hosts. Multi-host mutation then requires storage-native transactions/CAS or a distributed lease with fencing.
