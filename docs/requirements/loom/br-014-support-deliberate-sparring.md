---
type: requirement
title: BR-014 — Support Deliberate Sparring Before Execution
description: Loom provides an interactive mode for challenging and refining fuzzy intent before autonomous execution.
tags: [requirement, loom, brainstorm, sparring, intent]
---
**Status:** proposed

## Statement

Loom MUST provide an interactive mode where the user can explore ideas, challenge assumptions, compare alternatives, and refine fuzzy intent before accepting an Anchor.

This mode SHOULD push back on weak reasoning rather than optimizing for agreement.

Once execution begins from an accepted Anchor, ordinary implementation work MUST NOT repeatedly reopen product intent without new material evidence.

## Acceptance Criteria

1. Fuzzy ideas can enter an interactive exploration mode before execution.
2. The mode asks focused questions that materially clarify goal, scope, success, or constraints.
3. It challenges weak assumptions and presents meaningful alternatives where useful.
4. The result can be converted into an actionable Anchor.
5. Accepted intent is not repeatedly reopened during normal execution without new material evidence.

## Verification Semantics

Evaluate with ambiguous product prompts containing hidden trade-offs and weak assumptions.

Valid proof shows useful pushback and converges toward an actionable Anchor.

Simple agreement, feature-list expansion, or repeated questioning after the Anchor is accepted fails the intended behavior.

## Derived from

- [Loom Anchor](../../anchors/loom/anchor.md)
