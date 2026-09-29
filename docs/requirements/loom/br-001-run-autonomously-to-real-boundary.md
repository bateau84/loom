---
type: requirement
title: BR-001 — Run Autonomously to a Real Boundary
description: Continue accepted work without routine user intervention until completion or a genuine user-owned boundary.
tags: [requirement, loom, autonomy, workflow]
---
**Status:** proposed

## Statement

After the user accepts an Anchor, Loom MUST continue through all expertise-solvable work without requiring routine user approvals.

Loom may stop for the user only when product intent or material scope genuinely needs a user decision, a subjective product choice cannot be derived from accepted intent, a material guarantee would be weakened, explicit material risk acceptance is required, or a required capability remains unavailable after bounded recovery is exhausted.

A phase change, agent handoff, review result, planning boundary, or implementation wave is not by itself a user boundary.

An explicit user cancellation is a separate terminal boundary. It ends that workflow, not the accepted product Objective. Cancellation is neither successful delivery nor a manufactured failed gate, and it does not undo files or already-running external operations.

## Acceptance Criteria

1. An accepted executable objective starts real work without asking the user for routine permission to continue.
2. Intermediate phase, review, plan, and worker boundaries continue automatically when the next step is authorized.
3. Technical or expert-owned blockers are routed to the capable authority without becoming user questions.
4. User interruption occurs only for a user-owned decision or exhausted capability boundary.
5. Completed independent work is preserved when one dependent path becomes blocked.
6. An explicit user cancellation works before planning, during execution, and after Wave review has ended its live claim. The owning General session records the reason and exact confirmation; retries do not modify a replacement workflow.
7. Cancellation preserves completed work, evidence, review outcomes and unfinished obligations, permits a new authorized workflow, and does not imply Objective completion. New dispatches, attachments to the cancelled workflow and late workflow mutations are refused.
8. Finishing a reviewed Wave does not prevent its remaining documentation or product gates from closing against that Wave's exact reviewed history.
9. Answering a blocking OQ automatically continues each still-current affected consumer when continuation is possible. General does not issue a second continuation for the same current consumer unless fresh evidence establishes that the first continuation was not scheduled, failed, or ended without reconciliation. If delivery or the resulting continuation fails while the consumer remains unresolved, the answer and workflow state remain resumable. If delivery status becomes unknowable after coordinator/session loss, Loom preserves a resumable incomplete boundary rather than guessing and creating a duplicate continuation. Superseded consumers are not revived.

## Verification Semantics

Verify with workflow traces from representative greenfield and maintenance runs. Exercise reviewed-Wave closure and user cancellation through registered tools, including replacement start, restart, missing/stale/foreign claims, late child actions and interrupted persistence. Deterministic lifecycle tests prove those control transitions; they do not by themselves prove reliable natural-language cancellation intent handling.

Valid proof includes uninterrupted phase progression, automatic expert rerouting, and a deliberate user stop only at a seeded user-owned decision.

Verify the current-consumer continuation contract at the host boundary, including the continuation signal used for an already-active consumer, and exercise a returned/waiting consumer through the real host. Also cover delivery failure, a superseded-consumer case, and an OQ answered by another specialist where General does not retain that responder's notification result. Valid proof shows automatic continuation for current work, no parallel continuation without positive recovery evidence, resumable durable state after failure, and no revival of stale work.

A narrated plan, repeated "continue?" prompts, or a trace that returns control at ordinary phase boundaries does not satisfy this requirement.

## Derived from

- [Loom Anchor](../../anchors/loom/anchor.md)

## Depends on

- [BR-002 — Route Missing Expertise Explicitly](br-002-route-missing-expertise-explicitly.md)
- [BR-003 — Resolve Technical Unknowns Before Asking the User](br-003-resolve-technical-unknowns-before-user.md)
- [BR-008 — Bounded Autonomy and Progress](br-008-bounded-autonomy-and-progress.md)
