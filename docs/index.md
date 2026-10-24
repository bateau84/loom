# Loom documentation

This `docs/` directory is Loom's OKF documentation bundle. Each non-reserved Markdown
file in this directory is a documented concept, not an exempt "supporting" file.
Use this index to find the relevant contract and its evidence; a document's
historical status does not imply current runtime support.

The nested `requirements/` tree maintains its own index and history. Its
concepts are inventoried in that bundle rather than duplicated here.

The repository-root [OKF profile](../.okf-profile.yaml) defines a small,
evidence-based relationship vocabulary. It is a scanner configuration asset,
not a corpus concept document. Start `okf-mcp` with this repository as its
scan root so the profile is discovered; it declares no mandatory link counts.

## Core architecture and tools

- [Implementation boundaries](design.md) — Current plugin architecture and non-goals
- [Loom tool reference](tools.md) — Tool inputs, scopes and failures
- [Tool discovery](tool-discovery.md) — How agents find registered help
- [Coordination](coordination.md) — Optional agent coordination using OpenCode

## Agent work and evidence

- [Collaboration](collaboration.md) — Progress reports and contextual questions
- [Context relevance](context-relevance.md) — Bounded useful context and scope
- [Evidence reliability](evidence-reliability.md) — Pairing, capture gaps and recovery
- [Handoffs](handoffs.md) — Continuation and independent review
- [Review companions](review-companions.md) — Assessment and QA skill companion loaders
- [Task selection recovery](task-selection-recovery.md) — Recovery when plans change

## Configuration and compatibility

- [Configuration file limits](configuration-limits.md) — Bounded reads and error handling
- [Configuration parser](configuration-parser.md) — YAML decoding and allocation limits
- [Migration](migration.md) — Moving out of the legacy OpenCode bundle
- [Model routing (draft)](model-routing.md) — Model classes and provider-first planner; no live failover
- [Shared subscription quota state](shared-subscription-quota.md) — Machine-local cross-process state and adapter contract; not live dispatch
- [OpenCode 2.1.1 compatibility](opencode-2.1.1.md) — Supported host and native capabilities

## Operations and verification

- [Testing and CI](testing.md) — Test inventory and qualification scope
- [Installed-host validation](installed-host-validation.md) — Separates boot evidence from acceptance
- [Operating policy](operating-policy.md) — Supported alpha behavior and limits
- [Manual backup and restore](manual-backup-restore.md) — Stopped-writer recovery procedure
- [Processing limits](processing-limits.md) — Boundaries for bounded processing
- [Read consistency](read-consistency.md) — Scoped storage-read guarantees and gaps
- [Retrieval limits](retrieval-limits.md) — Bounded retrieval and configuration audit
- [Reviewer corrections](reviewer-corrections.md) — Historical independent review follow-ups

## Historical reference (not current runtime guarantees)

- [Retired assignment/delivery](assignment-delivery.md) — Retired protocol background
- [Handback comparison](handback-comparison.md) — Historical handback evaluation
- [Handback experiment](handback-experiment.md) — Historical trial
- [OpenCode 2.0.29](opencode-2.0.29.md) — Superseded compatibility research
- [Sender qualification](sender-qualification.md) — Historical delivery qualification

## Requirements and history

- [Requirements bundle](requirements/index.md) — Requirements and their own nested concept inventories
- [Documentation change log](log.md) — Changes to this documentation bundle
