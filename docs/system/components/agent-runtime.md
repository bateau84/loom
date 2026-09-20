---
type: component
title: Loom Agent Runtime
description: Judgment roles and disposable execution contexts used by Loom.
tags: [component, loom, agents]
---

# Agent Runtime

## Primary Contexts

- `general` — user-facing governor, default intent interviewer, and autonomous scheduler.
- `brainstorm` — optional explicit sparring mode; not required for normal Anchor shaping.

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


## Intent methodology

General loads `skills/intent-grilling/SKILL.md` for fuzzy product requests. The skill keeps interview methodology out of the always-loaded General directive and is inspired by one-question-at-a-time product grilling: recommendation with each question, resolve code/research-answerable branches independently, then converge on an Anchor.
