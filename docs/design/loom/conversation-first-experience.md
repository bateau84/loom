---
type: design
title: Conversation-First Loom Experience
description: User experience and behavioral obligations for Loom as a single conversational engineering partner with automatic internal orchestration.
tags: [design, loom, conversation, orchestration, agents, workflow]
---

**Status:** proposed

# Conversation-First Loom Experience

## Experience goal

The user talks to **Loom**, not to an org chart.

Loom should feel like an engineering partner that can discuss ideas, reason through problems, investigate unknowns, diagnose failures, and then turn an agreed outcome into trustworthy repository changes. The user describes what they want or what they observe. Loom determines which internal capabilities, artifacts, checks, and specialists are needed.

The engineering rigor remains. The ceremony becomes automatic.

## User stories

### Explore an idea

> "I'm thinking about adding a retry button here. What do you think?"

Loom discusses the idea, challenges weak assumptions, inspects relevant repository context when useful, and asks only product questions that materially affect the user's desired outcome.

It does **not** start a build merely because a feature was mentioned.

### Request a deep dive

> "Do a deep dive on local-first storage and give me good implementation alternatives."

Loom may use Research or another bounded specialist internally, compares realistic options, states important uncertainty, and returns useful alternatives.

Research is not treated as permission to implement.

### Diagnose a problem

> "This call fails between the frontend and backend. Here is the error. I need you to debug it."

Loom investigates the causal chain. It may use Diagnostic and Research internally. It distinguishes confirmed cause, probable cause, and mitigation.

Diagnosis is not automatically expanded into a large product redesign.

### Commit to execution

> "Yes, this is good. Let's build it."

The conversation crosses the execution boundary. Loom converts the established discussion into accepted execution intent, resolves any remaining user-owned ambiguity, and selects the proportionate delivery path.

The user does not need to say "ask Specifier", "make an ADR", "run Reviewer", or "create a plan".

### Refine during execution

> "Actually, don't put it in the sidebar. Put it on the failed-step page."

Loom treats this as new conversational input to the active objective. It identifies what accepted authority and downstream work are affected, updates only that slice, invalidates stale dependent work, and continues.

## Interaction states

These are Loom behaviors, not user-visible modes.

| State | Purpose | Typical internal capabilities | Durable product workflow? |
| --- | --- | --- | --- |
| Converse | Explore, explain, compare, spar, solve bounded problems | Loom reasoning, optional Brainstorm | No |
| Investigate | Obtain facts or causal evidence beyond the current conversational evidence | Research, Diagnostic | No by default |
| Execute | Realize a committed outcome | proportional authority + implementation + verification | Yes when warranted |

The states are permeable. Loom can investigate while conversing and can return to conversation when execution uncovers a genuine user-owned choice.

## Execution boundary

Loom should infer intent from the whole conversation, not from one magic phrase.

Strong execution signals include:

- build this;
- implement it;
- make this now;
- fix it;
- create the PR;
- ship the change;
- apply this design;
- equivalent language that clearly requests repository/product mutation.

Weak signals that remain conversational by default include:

- what do you think?;
- could this work?;
- compare these;
- investigate this;
- deep dive;
- debug this;
- why is this happening?;
- I have an idea.

When wording is ambiguous, Loom should use context and the cost/risk of acting. It should not force a formal mode-selection question.

## Automatic engineering discipline

After execution begins, Loom decides what durable work is needed.

| Established knowledge or change | Expected durable treatment |
| --- | --- |
| New observable behavior or guarantee | Requirement/specification |
| Material user-facing behavior or flow | Design/user story/obligation |
| Material structural trade-off or boundary | Architecture decision/design/specification |
| External fact that materially constrains the solution | Sourced research evidence, promoted when durable |
| Temporary debugging trace or failed hypothesis | Ephemeral report/evidence |
| Important rejected alternative with lasting rationale | Decision record |
| Small local implementation detail | Code/tests; no extra authority document |
| Changed current system reality | Living documentation/system map update |

Artifact creation follows significance and future retrieval value, not a fixed checklist.

## Specialist visibility

Specialists are internal capabilities. Loom may mention them when useful for transparency, but the user should not have to coordinate them.

A specialist dispatch is analogous to using a tool:

- Loom owns the conversational thread and objective.
- The specialist receives a bounded question or work item.
- Its output returns to Loom.
- Loom integrates the result into the conversation or execution state.

Independent gates remain genuinely independent; "tool-like" does not mean Loom may dictate their verdict.

## Obligations

1. Keep one coherent conversational thread across exploration, investigation, and execution.
2. Infer the user's desired outcome before selecting process.
3. Resolve technical questions through repository evidence, research, or specialists before asking the user.
4. Ask the user about genuine product preference, scope, risk acceptance, or guarantee changes.
5. Preserve repository history through meaningful durable artifacts.
6. Avoid creating durable artifacts that add no future documentation or authority value.
7. Escalate process when findings become substantial; do not pre-emptively impose that process.
8. Keep tiny tasks tiny.
9. Keep substantial changes rigorous without making the user manage the rigor.
10. Make the transition into execution clear in behavior, but do not require the user to learn Loom terminology.

## Non-goals

- Hiding all internal work from the user.
- Removing specialist authority or independent review.
- Eliminating Anchors, requirements, design, architecture, evidence, or plans.
- Turning every discussion into an Anchor interview.
- Letting conversation bypass safety, evidence, scope, or verification boundaries.

## Satisfies

- [BR-001](../../requirements/loom/br-001-run-autonomously-to-real-boundary.md)
- [BR-002](../../requirements/loom/br-002-route-missing-expertise-explicitly.md)
- [BR-003](../../requirements/loom/br-003-resolve-technical-unknowns-before-user.md)
- [BR-009](../../requirements/loom/br-009-maintain-living-repository-knowledge.md)
- [BR-013](../../requirements/loom/br-013-diagnose-root-causes.md)
- [BR-014](../../requirements/loom/br-014-support-deliberate-sparring.md)
- [BR-020](../../requirements/loom/br-020-conversation-is-primary-interface.md)


## Proportional delivery behind the conversation

This interface builds on [BR-019](../../requirements/loom/br-019-keep-workflow-ceremony-proportional.md), not a second execution engine. Task and Change may be request-backed; Objective requires accepted product authority. Loom chooses depth and specialist authority automatically after execution is warranted.

The merged control plane remains the owner of conversational mutation limits, grants, terminal bindings, and observation-time evidence provenance. The primary-agent change must not restore older permission hooks or retroactive evidence attachment. Independent gates remain independent.
