---
type: Architectural Design
title: "Session evaluation and incremental learning"
description: "Explicit engineering subjects, separate learning activity and bounded consumers of the existing Stage 3 scheduler."
tags: [loom, learning, sessions, evidence, recovery]
timestamp: 2026-11-28T00:00:00Z
---

# Session evaluation and incremental learning

An ordinary conversational Session is sufficient to select engineering work for evaluation. Selection does not retrospectively invent an Action, Plan or objective. A user can establish a boundary, inspect the foundation and its exact originals, then freeze that population before evaluation reasoning.

This realizes [#227](https://github.com/bateau84/loom/issues/227) using the [existing history projection](ard-008-learning-engineering-history.md), [frozen population owner](ard-010-learning-retrospective-populations.md), [original-source owners](ard-011-learning-original-source-resolution.md), [restricted execution consumer](ard-012-learning-restricted-execution.md) and merged [S5 interpretation contracts](ard-017-learning-evaluator-interpretations.md). The existing Stage 3 scheduler and EvaluationStore remain the only scheduler and evaluation database. Production execution remains disconnected under the [authority specification](../spec/ars-014-learning-retrospective-execution-authority.md).

## Boundaries and ownership

`EvaluationSubjects` stores immutable subject descriptors and a separate learning-activity audit in optional tables in `learning.sqlite`. A subject names a typed Session, Action or objective, an authored question, the existing source namespace and independent ledger/objective/link/review frontiers. A recorded completion pins an original completion record; a point-in-time cutoff makes no completion claim. These are source-owner sequence fences, not an atomic timestamp spanning both SQLite databases.

The durable subject precedes evaluation discovery and reconstruction. The shared history model supplies the human preview. Rendering and unestablished proposals remain read-only; freezing requires an established subject for the new Session/Action format. The source population is immutable while current original availability and authorization are rechecked. Later work requires a new subject/increment.

Session work cursors and comparable namespace ceilings are explicit, separate coordinates. A Session cursor advances only for its own source-owner rows, so unrelated work does not create processing opportunities. New subjects also pin `namespace_frontier`: the captured global owner positions, fenced before any still-unprocessed Session row. This lets a manual report and an automatic report compare the same source domains while retaining earlier cross-author associations. Deterministic checkpoints preserve their exact `namespace_through`; later model preparation reuses it instead of recapturing newer unrelated work. Older immutable subjects without this field keep conservative legacy comparison.

Learning purpose is attributable to a registered operation, a qualified execution recipient or proven native ancestry. Agent names do not classify purpose. Code Mode can give inner calls the same outer IDs: a learning read classifies the observed wrapper, not every colliding engineering sibling. Unknown inner-purpose and child relationships remain unknown. Source authorization and native parent identity cannot be inferred from a shared project.

An exact late purpose receipt can reveal that a wrapper was included in an earlier persisted batch. The current derived report is then withheld; a successor withdraws the learning source. Earlier population membership and report bytes remain immutable audit records. This behavior is tested independently from report-level mixing. It does not diagnose the unavailable private Waybar database.

## Incremental deterministic processing

Stage 3 coalesces relevant source notifications, idle opportunities and durable startup catch-up. Its existing work queue, claim leases and retry timer own scheduling. A fixed first-opportunity window prevents continuous events from postponing work forever. Idle is an opportunity, never an objective-completion signal.

The deterministic method establishes its subject before selection. Each quantum examines a configurable bounded number of new source-owner rows. It advances independent owner cursors only after its report commits. A durable rotating owner position prevents prolonged ledger activity from starving other source families when the configured quantum is small. Competing producers use an expected-predecessor check; losers retry from the committed cursor.

Reports contain bounded event counts, evidence-linked concerns and unmatched recorded starts. Exact paired finishes remove only their matching start; a later passing check does not erase an unrelated concern. Retained items keep the original batch/member/source position. Capacity exhaustion fails closed instead of silently dropping earlier work. Reports live outside the original conversation and are not injected into its model context.

Missing or denied originals, cancellation and quota failure do not advance a successful checkpoint. Durable pending input is resumed after restart. Exact late classification has a narrow recovery path; arbitrary missing engineering evidence cannot be skipped as if it were learning activity. Admitted learning Sessions and proven descendants never become automatic engineering subjects.

## Optional interpretation

A configurable method selects a provider/model and pinned instructions, source policy, route and resource policy. Configuration does not supply execution authority. Deterministic processing continues when inference is disabled or unavailable.

The bounded interpretation consumer uses existing EvaluationStore batches as method-specific intent/checkpoint records. It selects the oldest unprocessed deterministic prefix, retains relevant earlier concerns and establishes the exact committed source frontier. A pending frozen population and preparation are reused across later appends and restart. Only a completed, settled, published S5 result advances the interpretation checkpoint. Excluded-only prefixes can commit explicit no-inference bookkeeping; they do not pretend to be model interpretations.

A stronger method has its own cursor. Its admitted source reader can list/read prior compatible reports and selectively read an exact original from the named report's own frozen population. Earlier originals never become current population members. Trusted delivery receipts and explicit final prior dependencies account for all delivered context, including uncited report metadata. `context` preserves an earlier report; `supersedes` and `contests` retain existing revision semantics.

## Human experience and limits

The [product design](../../design/design-spec/ds-001-session-learning.md) makes intent, chronology, verification, counterevidence and limits primary. Technical identities remain expandable. The [interface specification](../spec/ars-015-session-learning.md) defines exact public operations and compatibility.

Controlled fixtures qualify source isolation, persistence, recovery and interaction mechanics. They do not qualify real historical coverage or genuine model reasoning. Existing S5 limits remain, including 32 recursively related reports and nonempty executable populations. An indefinite chain must explicitly narrow/rebase from originals or block; it must not silently forget dependencies. Historical native bodies, protected recipient transfer and included-usage accounting remain owned by their existing upstream authorities. No crawler or bypass is introduced.
