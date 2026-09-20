---
type: requirement
title: BR-016 — OpenCode Is the Required Initial Host
description: Loom's first implementation must operate inside OpenCode and cannot depend on future runtimes.
tags: [requirement, loom, opencode, portability]
---
**Status:** proposed

## Statement

The first Loom implementation MUST run inside OpenCode.

The requirements MUST NOT assume Leash or another future runtime exists.

## Acceptance Criteria

1. Loom can be installed/configured in an OpenCode environment.
2. Its required agent, skill, plugin, command, and documentation mechanisms use capabilities available in OpenCode.
3. The first usable YuHaul proof does not require Leash.
4. Future-runtime integration may be optional but is not a prerequisite for core operation.

## Verification Semantics

Verify by running Loom's initial workflow inside OpenCode from setup through representative execution.

Documentation or architecture claims of OpenCode compatibility are insufficient without an actual OpenCode run.

Any mandatory dependency on unreleased Leash capability fails this requirement.

## Derived from

- [Loom Anchor](../../anchors/loom/anchor.md)
