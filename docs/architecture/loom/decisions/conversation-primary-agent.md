---
type: architectural-decision
title: Conversation Is Primary; Loom Is the Single Primary Agent
description: Make Loom the sole user-facing primary agent and treat specialist agents and workflows as internal capabilities selected from conversational intent.
tags: [architecture, decision, loom, agents, conversation, orchestration]
---

**Status:** proposed

# Decision

Loom has one conceptual primary agent: **Loom**.

The existing OpenCode runtime identifier `general` may remain temporarily as a compatibility implementation detail, but it no longer represents a separate product persona. Its directive is the Loom directive.

`brainstorm` is demoted from a user-facing primary mode to an optional fresh subagent/capability. Brainstorming itself becomes normal Loom behavior.

Problem-solving is also normal Loom behavior. Loom may reason through symptoms, hypotheses, trade-offs, and likely causes directly in the continuing conversation. Diagnostic is a bounded fresh-context capability for cases where causal investigation benefits from independent evidence gathering or dedicated root-cause work; it is not a second user-facing problem-solving mode.

From the user's perspective, specialist agents are capabilities of Loom: analogous to tools with bounded expertise, fresh context, authority, and permissions rather than peer personas the user must manage. This analogy does **not** collapse their governance boundaries. During governed execution, authority-producing and independent-gate specialists retain their own decision authority, permissions, and independence; Loom cannot impersonate or override them.

Research, Designer, Specifier, Architect, Planner, Worker, Reviewer, Critic, Acceptance, and Documenter remain bounded specialist contexts.

The user's conversation with Loom is the top-level control loop. Workflow state is created when committed execution needs durable coordination; it is not the default container for every useful conversation.

# Why

The previous model made the workflow too close to the user interface:

`prompt -> classify -> workflow -> agents`

The target interaction is:

`conversation -> understanding -> optional investigation -> user commits to action -> governed execution`

This retains Loom's strongest property — automatic engineering discipline and durable repository knowledge — while removing the need for the user to think in agent names, phases, or document types.

# Capability classes

## Conversational capabilities

Used without implying execution:

- Loom's own reasoning, sparring, problem-solving, and synthesis;
- Brainstorm for a fresh independent ideation pass;
- Research for factual/deep-dive work;
- Diagnostic for bounded fresh-context causal investigation.

These are read-only/advisory unless the user has separately crossed an execution boundary.

## Execution capabilities

Once execution intent is established, Loom selects proportionately from:

- Designer;
- Specifier;
- Architect;
- Planner;
- Worker;
- Reviewer;
- Critic;
- Acceptance;
- Documenter;
- Research/Diagnostic where required.

Authority-producing agents create durable documents only when the change establishes durable meaning worth preserving.

# Consequences

## Positive

- One stable user-facing identity.
- Specialists behave as Loom's internal capability/toolbench from the user's perspective while retaining bounded authority internally.
- No manual agent herding.
- Brainstorming and debugging become natural parts of conversation.
- Existing rigorous authority, evidence, and review mechanisms remain available.
- Repository history remains rich enough for future zero-context agents.
- Small tasks can remain shallow while substantial discoveries can escalate automatically.

## Costs

- General/Loom must distinguish conversation, investigation, and execution intent reliably.
- Some current assumptions that "product idea means start intent interview" must be relaxed.
- Evals must test transition boundaries, not only successful workflow routing.
- Host/runtime naming may continue to expose `general` until a safe identifier migration is justified.

# Rejected alternatives

## Keep General and Brainstorm as separate primary agents

Rejected because it makes the user choose an internal reasoning style before the work is understood.

## Make every conversation an intent session

Rejected because exploration, research, and debugging are useful without committing to product execution and because it recreates the ceremony this decision is intended to remove.

## Remove specialists and let one model do everything

Rejected because independent authority, fresh context, bounded permissions, and adversarial review remain useful quality and safety properties.

# Related

- [Conversation-First Loom Experience](../../../design/loom/conversation-first-experience.md)
- [BR-019](../../../requirements/loom/br-019-conversation-is-primary-interface.md)
- [Execution Model](../execution-model.md)
