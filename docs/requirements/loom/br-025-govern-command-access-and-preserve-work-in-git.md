---
type: requirement
title: BR-025 — Govern Command Access and Preserve Work in Git
description: Task-scoped command elevation with Git, progress commits, and conditional pull request creation.
tags: [requirement, loom, commands, git, authority]
---

# BR-025 — Govern Command Access and Preserve Work in Git

**Status:** proposed

## Statement

For governed work, Loom MUST provide task-scoped command access analogous to file scope. A rejected command may request elevation; execution may continue immediately only when the requested access is permitted without further approval. Destructive commands and commands operating outside the working directory MUST await explicit General or User approval. Git operations MUST be available through command elevation. Agents MUST commit their work during progress; at conclusion General or an agent MAY create a pull request when an origin exists.

## Acceptance Criteria

1. A command rejected for insufficient authority can request task-scoped elevation that identifies the request's work context and requested authority; elevation does not implicitly authorize unrelated tasks.
2. If the requested command is within a boundary eligible for immediate permission, Loom can grant the needed task-scoped elevation and continue that command without an unnecessary approval round-trip.
3. Destructive commands and commands operating outside the working directory do not execute until General or User explicitly approves that requested access. A rejection, absent approval, or denial prevents execution and is not represented as command success.
4. Git operations, including those that change repository state, are requestable through the same command-elevation path; Git is not categorically denied solely because it mutates repository state.
5. Agents commit completed work during progress rather than waiting for workflow conclusion. A failed or unavailable commit is reported as uncommitted work, not silently treated as saved progress.
6. At conclusion, General or an agent can create a PR when an origin exists. If no origin exists, the workflow may conclude without a PR and must not report that one was created.
7. Command elevation does not grant product-scope authority or waive approval required for destructive/out-of-directory operations.

## Verification Semantics

Observe a rejected command request for elevation; verify an eligible request can be granted and resumed immediately, while destructive and out-of-working-directory requests remain blocked until explicit General/User approval and remain blocked if denied. Verify representative read-only and state-changing Git operations can be requested through elevation, within the granted scope. During implementation, observe agents committing work before task conclusion and accurately exposing a failed commit. At conclusion, observe PR creation by General or an agent with an available origin, and no false PR-success claim when origin is absent.

## Derived from

- User-confirmed command boundary: command elevation is task-scoped and analogous to file scope; rejected commands can request elevation; immediate continuation applies only to permitted boundaries; destructive or out-of-working-directory access requires General/User approval; Git operations use elevation; agents commit during progress; General or an agent can create a PR at conclusion when origin exists.
- Accepted Loom Anchor, especially AC 2, 8, 10, 12, 14, and 24 (bounded autonomous progress, evidence, recovery, and inspectability).
