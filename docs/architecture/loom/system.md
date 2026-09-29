---
type: design
title: Loom System Architecture
description: High-level structure for Loom as an OpenCode-native autonomous product-building AOS.
tags: [architecture, loom, opencode, autonomy]
---

**Status:** proposed

## Purpose

Loom separates judgment from control.

Models perform reasoning, design, specification, architecture, implementation, review, research, and critique.

Software controls workflow state, routing prerequisites, permissions, evidence, retries, shared questions, and bounded execution.

## System Shape

```text
User
  |
  v
General / Brainstorm
  |
  v
Loom Control Plane
  |
  +--> Designer
  +--> Specifier
  +--> Architect
  +--> Reviewer
  +--> Critic
  |
  +--> Planner / Worker / Research / Diagnostic / Acceptance / Documenter contexts
  |
  v
Evidence + Repository Knowledge + Learning
```

## Planes

### Intent plane

- General owns user-facing intent shaping and execution continuity.
- Fuzzy product requests enter a stateful one-question-at-a-time interview using the load-on-demand `intent-grilling` skill.
- General resolves repository/research-answerable branches autonomously and asks the user only for genuinely user-owned product intent.
- Brainstorm remains an optional explicit sparring mode; it is not required for the default flow.
- The Anchor acceptance event is the stable boundary between interactive intent shaping and autonomous execution.

### Authority plane

- Designer owns human-facing meaning.
- Specifier owns behavioral guarantees.
- Architect owns structural realization.
- Reviewer independently checks local conformance.
- Critic performs rare holistic adversarial adjudication.

### Worker plane

Fresh bounded execution contexts perform decomposition, implementation, research, diagnostics, migration, Product Acceptance, living-knowledge maintenance, and other technical work.

Planner decomposes an accepted solution into a persistent Plan and, for implementation workflows, an executable DAG. Today `loom_task_plan` compiles Worker-only Task steps; it cannot execute a planned item requiring another role merely because a route-owned specialist step exists elsewhere in the workflow.

Neither Planner nor Worker gains product or architecture authority from execution capability.

**Proposed accountability boundary:** Every planned work item must have an identifiable accountable role and a supported execution or decision route, including routine work. A specialist-owned decision/deliverable stays attributable to that specialist across handoffs even if another role implements it. Planner's Task decomposition and a Worker's completion cannot stand in for the specialist's authority; unresolved role/path or missing specialist output must remain open and route for correction. This is the proposed realization of [BR-024](../../requirements/loom/br-024-preserve-authority-ownership-through-handoffs.md), not a claim of current capability or a mandated Plan `owner` field. See [Control Plane](control-plane.md#proposed-accountable-role-admission).

The chosen proposed execution seam gives each planned Task its dedicated role-owned step, independent Reviewer gate or explicit user-decision wait at unclaimed-Wave admission; a fixed prior route step is not reattributed as that Task's result. Prior reviewed route work may instead justify an evidenced already-satisfied obligation. Mixed-role dependencies and independent evidence gates precede dependent completion, including a zero-Worker Wave. Current `loom_task_plan` still emits Worker-only `task:<id>` steps; it cannot claim role-only Task execution or Objective completion. A planning-only review covers every mandatory obligation, including later Waves, and must reject a missing/unavailable role, decision path or gate rather than counting a proposed implementation as available. A reviewed planning-only Plan closes its workflow, not its Objective. General authors a proposed Anchor within accepted scope; independent review precedes the user's separate explicit acceptance, and a reviewed proposal is not yet governing authority. No migration of old Worker results into specialist decisions is implied.

The proposed command and lifecycle realization in [Work Lifecycle, Command Authority, and Publication](work-lifecycle-and-publication.md) binds task-scoped command grants, Git publication outcomes and per-workflow pause/cancel fences to that same accountable step/attempt. It separates a confirmed pause boundary (no new work from the specific workflow) from quiescence of previously admitted operations. Archive retains visible uncertainty in the Archived view; Permanent Delete requires explicit user confirmation and confirmed quiescence while preserving project files, evidence/provenance and completed work. These are **proposals**, not capabilities proved by the current plugin: no workflow pause/archive/command elevation is established in source, and current cleanup deletes answer-bearing OQ records.

### Control plane

An OpenCode plugin owns machine-enforced workflow mechanics:
- state;
- required-role prerequisites;
- task identity;
- retry/progress limits;
- OQ coordination;
- evidence registration;
- worker scope;
- execution counters;
- project/session/workflow compartment identity.

Multiple simultaneous OpenCode sessions and repositories are normal operation. Mutable Loom execution state is project-scoped and session/workflow-bound so unrelated work cannot collide or leak.

### Observability plane

Loom publishes a bounded read-only operational projection for tools outside the OpenCode TUI.

The projection aggregates explicit compartment identity and workflow status; it never becomes product authority. A narrowly bounded, explicitly confirmed workflow-cleanup command uses a separate canonical-state control path, not the projection as a mutation surface. A future dashboard may enrich the read-only projection with OpenCode database statistics, but OpenCode messages/database state do not determine Loom workflow truth.

**Cleanup is not yet provenance-safe:** the proposed cleanup boundary retains answered-question text and attribution as historical evidence, with active OQ routing detached; current `workflow-cleanup.ts` instead deletes the answer-bearing OQ records. The user-approved intent to retain evidence and completed work is not proof of current behavior; see [Dashboard Observability](dashboard-observability.md#workflow-deletion-invariants). OQ `closed` is aggregate all-consumer closure, not a prerequisite for an individually reconciled consumer's step completion; see [Control Plane](control-plane.md#oq-board).

See [Runtime Isolation](runtime-isolation.md) and [Dashboard Observability](dashboard-observability.md). Human-facing dashboard behavior is defined separately by [Dashboard Experience Design](../../design/loom/dashboard-experience.md).

### Knowledge plane

Durable OKF documents describe accepted product meaning and current system structure.

Ephemeral workflow state is separate from durable authority.

Experience and heuristics are retained as learning but never silently override accepted authority.

## Main Flow

```text
Fuzzy intent
  -> one-question-at-a-time grilling / autonomous fact resolution
  -> proposed Anchor
  -> explicit user acceptance
  -> accepted Anchor
  -> THINK: research + Designer/Specifier/Architect as required
  -> Reviewer
  -> Critic: assembled solution
  -> BUILD: Planner DAG + bounded parallel/sequential Workers (current compiler)
  -> VERIFY: observed evidence + implementation Reviewer
  -> Product Acceptance + Designer validation when applicable + knowledge-sync
  -> product Reviewer
  -> Critic: realized product
  -> Done
```

The flow is conditional. Unneeded specialists are skipped. Missing expertise is routed when evidence requires it.

The BUILD line describes the current usual implementation path, **not** the proposed mixed-role path's delivery readiness. A planning-only Objective stops its workflow at reviewed Plan without entering BUILD or closing the product Objective. In the proposed path, role-owned work and decision dependencies join the Wave DAG; a no-Worker Wave cannot skip its independently scoped proof merely because there are no Worker nodes. General's proposed Anchor needs independent review and then explicit user acceptance before it can govern new work.

## Design Rule

A new agent role is justified only when independent context, distinct authority, or adversarial independence improves the outcome.

A new software mechanism is justified when the answer is already deterministic and should not depend on an LLM remembering a rule.

## Satisfies

- [BR-001](../../requirements/loom/br-001-run-autonomously-to-real-boundary.md)
- [BR-002](../../requirements/loom/br-002-route-missing-expertise-explicitly.md)
- [BR-004](../../requirements/loom/br-004-produce-the-whole-product.md)
- [BR-005](../../requirements/loom/br-005-prevent-implementation-inventing-meaning.md)
- [BR-016](../../requirements/loom/br-016-opencode-required-initial-host.md)
- [BR-017](../../requirements/loom/br-017-concurrent-sessions-projects-compartmentalized.md)
- [BR-018](../../requirements/loom/br-018-external-operational-dashboard.md)

## OpenCode Basis

Loom is installed as the global OpenCode configuration at `~/.config/opencode`. Current OpenCode V2 provides global agents, fresh subagent sessions, ordered permissions, on-demand skills, custom tools, globally discovered plugins, agent transforms, session hooks, permission hooks, and durable plugin storage.

- https://opencode.ai/v2/docs/agents
- https://opencode.ai/v2/docs/permissions
- https://opencode.ai/v2/docs/skills
- https://opencode.ai/v2/docs/build/plugins
