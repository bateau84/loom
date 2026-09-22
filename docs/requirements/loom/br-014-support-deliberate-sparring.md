---
type: requirement
title: BR-014 — Support Deliberate Sparring Before Execution
description: Loom's normal conversation supports challenging and refining fuzzy intent before autonomous execution.
tags: [requirement, loom, brainstorm, sparring, intent]
---
**Status:** proposed

## Statement

Loom MUST support normal conversational exploration where the user can explore ideas, challenge assumptions, compare alternatives, and refine fuzzy intent without first entering a separate mode or workflow.

Loom SHOULD push back on weak reasoning rather than optimizing for agreement. Brainstorming is part of Loom's primary conversational behavior; a separate Brainstorm specialist may be used internally when a fresh independent ideation pass is useful.

Once execution begins from an accepted Anchor, ordinary implementation work MUST NOT repeatedly reopen product intent without new material evidence.

## Acceptance Criteria

1. Fuzzy ideas can be explored in the normal Loom conversation before execution without selecting a separate mode.
2. Loom asks focused questions that materially clarify goal, scope, success, or constraints.
3. It challenges weak assumptions and presents meaningful alternatives where useful.
4. The result can be converted into an actionable Anchor.
5. Accepted intent is not repeatedly reopened during normal execution without new material evidence.

## Verification Semantics

Evaluate with ambiguous product prompts containing hidden trade-offs and weak assumptions.

Valid proof shows useful pushback and converges toward an actionable Anchor.

Simple agreement, feature-list expansion, or repeated questioning after the Anchor is accepted fails the intended behavior.

## Derived from

- [Loom Anchor](../../anchors/loom/anchor.md)
