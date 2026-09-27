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

## Repository execution and delivery

Loom derives ordinary repository capability from the already-attached role; it does not issue a second per-command grant.

- **Worker** may inspect, build, test, and run within its execution policy. Its Task write paths are a starting expectation; when implementation discovery finds another project-local mutation target, Worker calls `loom_scope_elevate` and continues immediately when `continue=true`.
- **Designer, Specifier, Architect, Documenter, Worker, and other attached producer roles** mutate product files only under the exact current step attempt and current effective Loom write scope. Role artifact paths are defaults for expected work, not hidden hard file ceilings. Crossing a role default is recorded as scope activity for General/review visibility.
- **Hard-boundary writes** outside the project, through a symlink escape, or into repository-internal state return `continue=false`. The child stops; only the exact user **Allow once** decision can authorize those requested paths for that step attempt. The decision is never remembered.
- **Git delivery follows product write authority.** Loom records exact admitted file fingerprints per step attempt. Those exact bytes may be staged/committed; a fresh session on the same attempt can use the durable provenance without a separate adoption tool. Untouched, unproven, or subsequently changed dirty bytes remain ineligible.
- **Ephemeral reports** are a separate output class: producer-scoped and intentionally non-committable. Durable retention uses report promotion.
- **Diagnostic** may inspect, build/test through the existing verification allowlist, and inspect Git/PR/CI state conversationally. Arbitrary project execution remains governed because raw project code can have host/external side effects.
- Dangerous broad staging, plain force-push, arbitrary shell composition, and PR merge remain blocked unless a separate explicit capability authorizes them.

`loom_complete` rejects admitted product changes that remain uncommitted. Reopen/reroute advances the step attempt, so prior-attempt write/Git provenance cannot silently carry into new work.

## Source

- `agents/*.md`
- `plugins/loom/index.ts`

## Depends on

- [Control Plane](control-plane.md)


## Intent methodology

Loom loads `skills/intent-grilling/SKILL.md` after the conversation has crossed into committed product execution and user-owned product intent still needs resolution. The skill keeps interview methodology out of the always-loaded General directive and is inspired by one-question-at-a-time product grilling: recommendation with each question, resolve code/research-answerable branches independently, then converge on an Anchor.
