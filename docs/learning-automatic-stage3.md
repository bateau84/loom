---
type: Playbook
title: "Stage 3: automatic learning implementation"
description: "Incremental implementation, source authority, durable reports and explicit native and model qualification boundaries for PR #233."
tags: [loom, learning, evidence, recovery]
timestamp: 2026-11-13T00:00:00Z
---

# Stage 3: automatic learning implementation

This implements the accepted [whole-work architecture](learning-evidence-and-review-scope.md) in bounded increments on PR #233. The complete product and E11 are not qualified. The [Stage 2 foundation](learning-review-stage2.md) and its private request ownership remain unchanged.

## Committed increment: original-source processing

`Learning.automatic` connects the recovered `EvaluationStore` to original Session-owned ledger evidence. It freezes an entire permitted source population, produces provisional source-linked descriptions in bounded quanta, and publishes an overall description only after every frozen member has a retrievable checkpoint. Replaying the same source/method boundary returns the same batch. Later evidence creates a revision and marks the preceding interpretation stale without overwriting its report.

Descriptions distinguish authored completion from observed tool return, error and instruction metadata. Neither tool success nor repeated handbacks establishes correct work or independent originating requests. Mixed completion/error evidence is flagged for original-source investigation. Practice observations never claim provider exposure or causal benefit. This deterministic preparation is **not genuine Evaluator judgement**.

The caller must obtain native source permission before discovery and revalidate it before overall publication. The processor grants no permission. Sources are limited to the supplied Session; derived records are owner-restricted. Original source hashes and the Store namespace are checked on publication and readback. Missing or changed originals withhold the report body. No new transcript, raw tool arguments/results, external provider, canonical mutation or experiment is introduced.

The source scan admits at most 20,000 source references and 8 MiB of serialized source material per Session snapshot. Exceeding a bound fails the snapshot rather than reporting a successful prefix. Processing uses 32-source members and at most 20 members per quantum. These are implementation safety bounds, not claims that unprocessed material was evaluated.

Report, dependency and checkpoint writes share the existing learning database transaction. The separate Action database remains the original source. Validation before publication and again on read detects source loss; this is not a cross-database atomic-commit or power-loss guarantee. Cancellation or revoked permission preserves resumable checkpoints but cannot publish a completed overall report.

## Remaining integration at this checkpoint

The processor is initialized by `Learning`, but is not yet triggered by native lifecycle events and has no registered public report tool. Automatic catch-up, objective/review populations, installed-host proof and complete requirements coverage remain unfinished. No previous lost-work test results are used as evidence for this implementation.

Q4 remains partial; Q5 retains its failed parent-inline transfer counterexample and withheld Loom delivery. Automatic model dispatch is blocked because native provenance, recipient transfer and included-usage routing are not qualified. E11 remains unqualified. These are independent gates, not a combined successful status.

## Executed verification

Bun 1.4.2, embedded SQLite 3.53.2: 42 focused processor, checkpoint, integrity and existing-learning tests passed, including denial before discovery, permission withdrawal before publication, cancellation, source removal, owner denial, revision linkage, recovery and the existing 601-member store control. Repository typecheck passed. This is component/registered-fixture evidence, not installed-host or real-model acceptance.
