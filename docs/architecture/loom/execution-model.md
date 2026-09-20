---
type: design
title: Loom Execution Model
description: Agent roles, worker contexts, routing, and skill use inside OpenCode.
tags: [architecture, loom, agents, routing, skills]
---

**Status:** proposed

## Agent Set

Loom's repository is the global OpenCode config directory. Agent files therefore live directly under `agents/`, plugins under `plugins/`, skills under `skills/`, and commands under `commands/`.

### Primary

- **general** — user-facing execution governor; shapes fuzzy intent, records the Anchor acceptance boundary, then starts/resumes autonomous workflows.
- **brainstorm** — optional explicit sparring mode for intent exploration without autonomous execution.

### Authority subagents

- **designer** — human-facing behavior and implemented-experience validation.
- **specifier** — behavioral requirements and guarantees.
- **architect** — components, interfaces, persistence, lifecycle, protocols, and technical realization.
- **reviewer** — normal independent artifact and implementation review.
- **critic** — holistic adversarial review and exceptional cross-domain adjudication.

### Execution subagents

- **worker** — implementation and bounded technical work.
- **research** — sourced investigation and external knowledge.
- **diagnostic** — root-cause investigation.
- **acceptance** — executes real end-to-end Product Acceptance scenarios and records observed proof.
- **planner** — disposable decomposition context that turns an accepted solution into a bounded executable Worker DAG.
- **documenter** — maintains current system/user knowledge after implementation changes and verifies it through OKF.

Planner is an execution context, not a product authority or gate owner. The executable DAG lives in Loom workflow state; a separate Plan document is not required unless the product itself needs one.

## Fresh Context

Authority and execution subagents run in fresh OpenCode child sessions.

Only the minimum required context is passed:
- objective;
- Anchor;
- relevant accepted authority;
- relevant OQs;
- task scope;
- evidence references;
- allowed skills;
- completion proof.

Large workflow history is not copied into every child context.

## Explicit Routing

General does not rely only on prompt memory to decide whether expertise is required.

Before dependent work, the control plane records required capabilities.

Typical mapping:

| Meaning affected | Required capability |
| --- | --- |
| human-facing behavior | Designer |
| observable behavior / guarantee | Specifier |
| topology / interface / persistence / lifecycle | Architect |
| implementation | Worker |
| external factual uncertainty | Research |
| unexplained failure | Diagnostic |
| assembled-product proof | Acceptance |
| product implementation decomposition | Planner |
| implemented-system knowledge sync | Documenter |
| normal independent check | Reviewer |
| whole-solution challenge | Critic |

The coordinator may propose classification. The control plane prevents dependent stages from proceeding when recorded prerequisites are incomplete.

## Skills

Skills provide methodology, not authority.

A worker receives only a small relevant set. Skills are loaded on demand through OpenCode's native skill mechanism.

Examples:
- Go implementation;
- concurrency;
- database migrations;
- OAuth;
- browser/UI testing;
- documentation;
- security testing.

Skill selection should later be informed by measured effectiveness, not by loading every plausible skill.

## Permissions

Each named agent has a restrictive default permission profile.

Examples:
- Reviewer and Critic cannot edit product code.
- Specifier cannot edit implementation.
- Architect cannot implement.
- Worker cannot edit accepted authority documents unless explicitly assigned documentation work.
- Research has web/read tools but no product mutation.
- Diagnostic may inspect and experiment but does not silently ship fixes.

Task-specific worker write boundaries are additionally enforced by the control plane.

## Model Independence

Reviewer should differ from the producer in context.

Critic should use a different model from the primary producer where practical and always receive fresh adversarial context.

Different-model independence is preferred for holistic review, but absence of a second provider must not make Loom unusable.

## Satisfies

- [BR-002](../../requirements/loom/br-002-route-missing-expertise-explicitly.md)
- [BR-003](../../requirements/loom/br-003-resolve-technical-unknowns-before-user.md)
- [BR-005](../../requirements/loom/br-005-prevent-implementation-inventing-meaning.md)
- [BR-006](../../requirements/loom/br-006-independent-review-and-selective-critic.md)
- [BR-012](../../requirements/loom/br-012-prefer-deep-modules-and-remove-obsolete-code.md)
- [BR-013](../../requirements/loom/br-013-diagnose-root-causes.md)
- [BR-014](../../requirements/loom/br-014-support-deliberate-sparring.md)


## Intent interviewing

General loads the `intent-grilling` skill only when product intent is unresolved.

The interview follows four runtime-enforced rules:
- one unresolved user question at a time;
- every user question carries a recommended answer and short rationale;
- repository/research-answerable branches are resolved with evidence rather than sent to the user;
- execution cannot start while the active intent session is unresolved.

The interview is ready to draft an Anchor when Goal, observable success, scope, exclusions, user-owned decisions, and important context are clear enough that no unresolved user-owned branch would materially change them.

The user explicitly accepts the complete Anchor before autonomous execution begins.
