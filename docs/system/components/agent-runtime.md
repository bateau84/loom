---
type: component
title: Loom Agent Runtime
description: Judgment roles and disposable execution contexts used by Loom.
tags: [component, loom, agents]
---

# Agent Runtime

## Primary Context

- **Loom** is the single user-facing primary agent. The current OpenCode compatibility identifier is `general`.
- Loom owns the continuing conversation across exploration, ordinary problem-solving, investigation, and execution.
- `brainstorm` is an optional fresh subagent for independent ideation, not a second user-facing primary mode.
- `diagnostic` and `research` may be used as fresh-context conversational investigation capabilities without implying permission to implement. They remain bounded internal capabilities rather than user-facing personas.

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

Loom loads `skills/intent-grilling/SKILL.md` after the conversation has crossed into committed product execution and user-owned product intent still needs resolution. The skill keeps interview methodology out of the always-loaded General directive and is inspired by one-question-at-a-time product grilling: recommendation with each question, resolve code/research-answerable branches independently, then converge on an Anchor.
