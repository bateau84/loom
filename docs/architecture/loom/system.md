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

- General owns execution continuity and user communication.
- Brainstorm owns interactive sparring before accepted intent exists.
- The Anchor is the stable product-intent boundary.

### Authority plane

- Designer owns human-facing meaning.
- Specifier owns behavioral guarantees.
- Architect owns structural realization.
- Reviewer independently checks local conformance.
- Critic performs rare holistic adversarial adjudication.

### Worker plane

Fresh bounded execution contexts perform decomposition, implementation, research, diagnostics, migration, Product Acceptance, living-knowledge maintenance, and other technical work.

Planner decomposes an accepted solution into an executable DAG. Workers execute the resulting bounded tasks.

Neither Planner nor Worker gains product or architecture authority from execution capability.

### Control plane

An OpenCode plugin owns machine-enforced workflow mechanics:
- state;
- required-role prerequisites;
- task identity;
- retry/progress limits;
- OQ coordination;
- evidence registration;
- worker scope;
- execution counters.

### Knowledge plane

Durable OKF documents describe accepted product meaning and current system structure.

Ephemeral workflow state is separate from durable authority.

Experience and heuristics are retained as learning but never silently override accepted authority.

## Main Flow

```text
Intent
  -> Anchor
  -> THINK: research + Designer/Specifier/Architect as required
  -> Reviewer
  -> Critic: assembled solution
  -> BUILD: Planner DAG + bounded parallel/sequential Workers
  -> VERIFY: observed evidence + implementation Reviewer
  -> Product Acceptance + Designer validation when applicable + knowledge-sync
  -> product Reviewer
  -> Critic: realized product
  -> Done
```

The flow is conditional. Unneeded specialists are skipped. Missing expertise is routed when evidence requires it.

## Design Rule

A new agent role is justified only when independent context, distinct authority, or adversarial independence improves the outcome.

A new software mechanism is justified when the answer is already deterministic and should not depend on an LLM remembering a rule.

## Satisfies

- [BR-001](../../requirements/loom/br-001-run-autonomously-to-real-boundary.md)
- [BR-002](../../requirements/loom/br-002-route-missing-expertise-explicitly.md)
- [BR-004](../../requirements/loom/br-004-produce-the-whole-product.md)
- [BR-005](../../requirements/loom/br-005-prevent-implementation-inventing-meaning.md)
- [BR-016](../../requirements/loom/br-016-opencode-required-initial-host.md)

## OpenCode Basis

Loom is installed as the global OpenCode configuration at `~/.config/opencode`. Current OpenCode V2 provides global agents, fresh subagent sessions, ordered permissions, on-demand skills, custom tools, globally discovered plugins, agent transforms, session hooks, permission hooks, and durable plugin storage.

- https://opencode.ai/v2/docs/agents
- https://opencode.ai/v2/docs/permissions
- https://opencode.ai/v2/docs/skills
- https://opencode.ai/v2/docs/build/plugins
