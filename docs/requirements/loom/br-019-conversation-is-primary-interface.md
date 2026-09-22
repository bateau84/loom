---
type: requirement
title: BR-019 — Conversation Is Loom's Primary Interface
description: Loom behaves as one conversational engineering partner and turns discussion into governed execution only when the user's intent crosses an execution boundary.
tags: [requirement, loom, conversation, primary-agent, autonomy, routing]
---
**Status:** proposed

## Statement

Loom MUST present one primary user-facing agent: **Loom**.

The normal interaction is an ongoing conversation. The user may explore an idea, ask for alternatives, request research, reason through a problem, or ask Loom to diagnose a problem without first choosing an agent, workflow, document type, or engineering process. Brainstorming, ordinary problem-solving, and synthesis are normal Loom behaviors; fresh specialist contexts are invoked only when they materially improve the work.

Loom MUST infer which internal capabilities are useful. Specialist agents, workflow machinery, requirements, design records, architecture decisions, plans, reviews, and evidence are implementation mechanisms behind Loom's interface rather than steps the user must manually request.

From the user's perspective, specialist agents MUST behave as capabilities of Loom rather than peer personas that require manual selection or handoff. Their internal authority and permission boundaries MUST remain intact: Loom may invoke them, but MUST NOT impersonate or override specialist authority or independent gates. Conversational Research/Diagnostic work MUST remain advisory and non-product-mutating; once a durable execution workflow exists, required specialist work remains subject to normal workflow routing, grants, budgets, and evidence.

Loom MUST NOT treat every product-related utterance as execution intent.

When the user clearly asks Loom to build, implement, change, fix, ship, or otherwise carry out the discussed outcome, Loom MUST transition from conversation into execution and autonomously select the proportionate engineering process needed to realize it.

The conversation remains active during execution. New user input may refine or redirect the active outcome; Loom reconciles affected authority and work rather than forcing the user to restart the process.

## Acceptance Criteria

1. A user can brainstorm or discuss a possible change without Loom automatically starting an execution workflow.
2. A user can request a deep dive or implementation alternatives and receive researched analysis without committing to build anything.
3. A user can ask Loom to debug an observed failure and receive diagnosis without Loom silently broadening the request into unrelated implementation.
4. Clear execution language such as "build this", "implement it", "fix that", or equivalent context-sensitive intent causes Loom to transition into execution without requiring the user to name agents or process steps.
5. During execution, Loom automatically engages Designer, Specifier, Architect, Research, Diagnostic, Planner, Worker, Reviewer, Critic, Acceptance, or Documenter only when their capability is warranted.
6. Durable requirements, design, architecture, decision, and knowledge artifacts are created or updated when the work establishes repository knowledge that future zero-context agents need.
7. Small bounded changes do not receive heavyweight ceremony merely because Loom has those capabilities.
8. The user can interrupt or refine ongoing execution conversationally; Loom updates only affected authority/work and preserves valid completed work.
9. `brainstorm` is not a separate required user-facing primary mode. Brainstorming is normal Loom behavior; a fresh Brainstorm subagent may still be used internally when an independent ideation pass is useful.
10. Problem-solving is normal Loom behavior. Diagnostic is used as a bounded specialist capability when fresh causal investigation materially improves confidence; the user is not required to switch to a separate Problem or Diagnostic persona.
11. Specialist agents are presented as Loom capabilities rather than peer user-facing actors, while their bounded authority, permissions, and independent-gate semantics remain enforced internally.
12. The public conceptual identity is Loom even if an underlying host/runtime retains a compatibility identifier such as `general`.
13. When prior conversation already resolved the product outcome and the user clearly says to build/fix/apply it, that execution commitment is sufficient acceptance of the discussed outcome; Loom does not require a second routine confirmation.
14. Synthesizing durable authority from an already-accepted conversation is capture-only: Loom MUST NOT introduce, weaken, or choose new user-owned product meaning under the earlier acceptance. Any newly discovered material user-owned branch remains unresolved and is surfaced narrowly before the affected authority is accepted.

## Verification Semantics

Behavioral evaluation should cover at least:

- open-ended idea sparring;
- research/deep-dive requests;
- diagnosis-only requests;
- explicit transition from prior discussion into implementation;
- a mixed UX/behavior/architecture change where Loom automatically selects specialists;
- a tiny bounded change where Loom deliberately avoids unnecessary ceremony;
- mid-execution user refinement.

Valid behavior feels like one capable engineering partner with an internal toolbench, not a menu of agents or a workflow form.

## Derived from

- [Loom Anchor](../../anchors/loom/anchor.md)
