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

- **Worker** may inspect, build, test, run, stage files inside its Task write scope, commit only scoped staged changes through Loom's hook-isolated commit form, rebase, push, create PRs, and inspect CI. Dangerous broad staging, plain force-push, arbitrary shell composition, and PR merge remain blocked.
- **Diagnostic** may inspect, build/test through the existing verification allowlist, and inspect Git/PR/CI state conversationally. Arbitrary project execution is allowed only after attachment to a governed Diagnostic step, because raw project code can have host or external side effects even though repository/delivery mutation remains outside Diagnostic authority.
- **Designer, Specifier, Architect, Documenter, and General** may stage and commit only their fixed durable authoring scopes. Loom snapshots pre-existing dirty paths when the role takes ownership, refuses to absorb those paths, and admits a commit only when every staged path belongs to the role.
- Downstream roles never inherit ownership of unrelated dirty or staged files. `loom_complete` rejects new uncommitted changes created in the role's owned scope.

This keeps delivery ownership with the role that authored the durable change without adding extra Loom workflow ceremony.

## Source

- `agents/*.md`
- `plugins/loom/index.ts`

## Depends on

- [Control Plane](control-plane.md)


## Intent methodology

Loom loads `skills/intent-grilling/SKILL.md` after the conversation has crossed into committed product execution and user-owned product intent still needs resolution. The skill keeps interview methodology out of the always-loaded General directive and is inspired by one-question-at-a-time product grilling: recommendation with each question, resolve code/research-answerable branches independently, then converge on an Anchor.
