---
type: decision
title: Project Epoch Identity
description: Use generated project-epoch UUID markers rather than filesystem paths as durable Loom project identity.
tags: [architecture, decision, loom, isolation, identity]
---

**Status:** proposed

## Decision

Loom will identify one durable project epoch with a generated UUID stored in project-specific operational metadata.

- Git worktrees store the marker in the worktree-private Git administration directory.
- Non-Git folders store it in a Loom-owned marker such as `.loom/project-id`.
- An installation-local registry maps project IDs to current canonical locations and detects ambiguous copies/moves.
- Canonical filesystem path is metadata and lookup context, not durable identity.

## Drivers

- unrelated repositories can occupy the same path at different times;
- clones/copies can share names and relative Anchor paths;
- Git worktrees sharing one common repository still need separate worktree compartments;
- symlink aliases should resolve to the same project epoch;
- moves should preserve identity when unambiguous;
- simultaneous first-open from multiple processes must converge on one identity.

## Alternatives considered

### Hash the canonical path

Rejected as the sole identity because path reuse silently aliases unrelated project epochs.

### Git repository identity only

Rejected because different worktrees need distinct compartments and Loom also supports non-Git folders.

### Session/process-derived project identity

Rejected because project state must survive OpenCode process restarts and span legitimate same-project sessions.

## Consequences

Project identity initialization requires an installation-shared lock and atomic marker creation. Copied markers at two simultaneously existing roots must be re-keyed or refused. A project without writable durable marker storage cannot claim durable compartmentalized identity.

## Reconsider when

A future storage backend supplies a stronger project-epoch identity primitive that preserves the same path-reuse, worktree, move, copy, and race-safety guarantees.
