---
type: component
title: Loom Agent Runtime
description: Judgment roles and disposable execution contexts used by Loom.
tags: [component, loom, agents]
---

# Agent Runtime

## Primary Contexts

- `general` — user-facing governor and autonomous scheduler.
- `brainstorm` — interactive intent sparring and Anchor shaping.

## Authority Contexts

- Designer — human-facing meaning.
- Specifier — observable behavior and guarantees.
- Architect — structural realization.
- Reviewer — normal independent verification.
- Critic — rare holistic adversarial review.

## Execution Contexts

- Planner — implementation decomposition only.
- Worker — bounded implementation.
- Research — sourced factual investigation.
- Diagnostic — root-cause investigation.
- Acceptance — real end-to-end product proof.
- Documenter — current system/user knowledge maintenance.

Each subagent runs fresh and is given only its bounded objective/context.

## Source

- `agents/*.md`
- `plugins/loom/index.ts`

## Depends on

- [Control Plane](control-plane.md)
