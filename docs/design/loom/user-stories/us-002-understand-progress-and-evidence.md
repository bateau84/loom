---
type: design
title: US-002 — Understand what Loom is doing and why
description: Human goal for resuming context and understanding work state, evidence, and boundaries.
tags: [user-story, loom, observability, evidence]
---

# US-002 — Understand what Loom is doing and why

**Actor / context:** A product owner checking in between other work, potentially after interruption or across sessions/projects.
**Trigger:** Resume context, assess progress, or decide whether a surfaced boundary needs attention.
**Goal:** Understand work purpose, current state, accountable role/task handoffs, evidence, uncertainty, and safe next action without reconstructing agent internals or choosing specialists, whether through conversation or read-only directory/session/workflow inspection.
**Observable success:** The person distinguishes active, blocked, failed, complete, cancelled, stale, and unknown; inspects relevant evidence/work context and the accountable role for planned work; and understands why Loom stopped, what useful work is preserved, and what remains unresolved. A missing supported role path is reported as a blocker rather than hidden by reassignment to a generic executor. The person need not discover the roster or manually assign work. If planning was the requested outcome, they can distinguish a reviewed planning workflow from product/Objective completion and know that review granted no implementation authority.
**Derived from:** `docs/anchors/loom/anchor.md` (Acceptance Criteria 8, 18, 24–26, 36; First Principles 3–4; Context); user resolution in OQ `3fb7f28b-e116-4765-9366-d2a84c9f7222`; `br-007-evidence-outranks-model-claims.md`; `br-018-external-operational-dashboard.md`; `br-021-preserve-holistic-plan-context.md`; `br-022-support-planning-only-objective-completion.md`.
