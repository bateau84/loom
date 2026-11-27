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
- [Public tool usability qualification](tool-usability.md) — Fresh-agent workflows, schema agreement, response measurements and independent review
- [Structured Open Questions](structured-questions.md) — Choice contract, usage investigation and qualification limits
- [Cross-session delivery authorization](cross-session-delivery-authorization.md) — Native permission for the actual caller and exact peer destination
- [Coordination](coordination.md) — Optional agent coordination using OpenCode

## Agent work and evidence

- [Deep retrospective session tracing](retrospective-trace.md) — Original Session evidence sources, access checks and coverage limits
- [Historical engineering evidence](learning-historical-evidence.md) — Authorized historical structure, record projections and exact native part references; protected originals and selected-population preparation dependencies
- [Layered engineering history](learning-engineering-history.md) — Shared authorized overview, historical work branches, readable document and first HTML dashboard; live navigation and frozen-selection boundaries
- [Connected engineering trajectories](learning-connected-trajectories.md) — Qualified objective, review and original-evidence relationships; retrospective associations, ready navigation and owner boundaries
- [Frozen retrospective evidence populations](learning-retrospective-populations.md) — Objective-scoped selection, durable exact membership, source-owned inspection and Evaluator preparation
- [Original-source resolution](learning-original-source-resolution.md) — Exact native current-context and GitHub originals through frozen readers, bounded content and unchanged execution fences
- [Native original-source handoff](learning-native-source-handoff.md) — Required upstream history and recipient-bound release interfaces, responsible owners and falsifiable acceptance
- [Learning evidence and provisional experiments](learning-experiments.md) — Bounded insight statistics, content fingerprints and manual tweak trials
- [Review-scoped evidence and whole-work retrospectives (approved concept)](learning-evidence-and-review-scope.md) — Accepted architecture and requirements direction for attribution and automatic multi-Session evaluation; not current runtime behavior
- [Native execution and review evidence specification](learning-native-evidence-spec.md) — Exact identity, original mandate, evidence-basis, failure and recipient-transfer contracts; bounded Stage 2 persistence is implemented
- [Stage 2 review persistence and reconstruction](learning-review-stage2.md) — Implemented original mandates, historical membership, canonical issue arbitration, authorized public readers, recovery evidence and remaining host/product blockers
- [Stage 3 automatic learning implementation](learning-automatic-stage3.md) — Merged bounded descriptions, six authorized readers and durable recovery; Q4/Q5 and E11 remain separate
- [Stage 4 whole-objective learning contract](learning-stage4-contract.md) — Fresh Q4/Q5 host investigation, minimum native changes, Evaluator architecture, authority boundaries and acceptance; documentation proposal only
- [Stage 4 durable Evaluator preparation](learning-stage4-preparation.md) — Declared methods, authorized frozen sources, canonical review linkage and recovery; genuine evaluation and dispatch remain unavailable
- [Stage 4 execution-admission assessment](learning-stage4-admission.md) — Authorized, read-only capability blockers and canonical issue recovery state; no effect permit or budget reservation
- [Restricted Evaluator execution lifecycle](learning-restricted-execution.md) — Durable execution consumer, controlled native mechanics and the missing production authority boundary
- [Retrospective execution authority](learning-retrospective-execution-authority.md) — Smallest owner-side implementation and falsifiable controls for one fixed production route, with source transfer, Q4 and Q5 kept distinct
- [One genuine Evaluator audit](learning-evaluator-s3-handoff.md) — Original-work scope, separate operator authorization and independent reasoning assessment
- [Native review qualification](native-review-qualification.md) — Installed 2.2.6 Q1–Q7 observations, negative controls, capability matrix and unsupported host guarantees
- [Native Evaluator audit qualification](native-evaluator-audit-qualification.md) — Source preflight and installed scripted recovery; real original-work audit pending
- [Trusted learning host contracts](learning-host-trust-contract.md) — Native provenance/permission counterexamples and the host-owned guarantees still required
- [Experimental treatment recovery](experiment-recovery.md) — Read-only stopped-host inspection of native entries, removed-entry history and archived assignment state
- [Session instruction variant qualification](session-instruction-qualification.md) — Installed 2.2.6 additive entry isolation tests, receipts, limits and unsupported routes
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
- [Model routing (draft)](model-routing.md) — Guarded native 2.1.4 initial selection with shared quota; no live failover
- [Workload-aware routing foundation](workload-routing.md) — Provider-free risk/quality-scoped model plans and optional durable **candidate-only** work decisions; live routing still blocked
- [Initial routing qualification #206 (2.3.0)](initial-routing-qualification-206.md) — Request-local selection candidate, native guard evidence, and remaining provider/account gates
- [Account-bound billing qualification](subscription-billing-qualification.md) — 2026-11-01 evidence, provider blockers and required no-paid attestation
- [Shared subscription quota](shared-subscription-quota.md) — Cross-process SQLite quota state, atomic reservation, recovery and evidence limits
- [Native attempt/account qualification #205 (2.3.0)](native-attempt-qualification-205.md) — Current host/source evidence, prepared-retry counterexamples, and proposed protected send-time identity contract
- [Historical native identity investigation (2.2.0)](native-request-identity.md) — Previous source-modelled account/attempt counterexamples
- [V2 model dispatch investigation](model-routing-v2-dispatch.md) — 2.1.1 blocker and 2.1.4 initial-routing update
- [OpenCode Go subscription eligibility](opencode-go-eligibility.md) — Missing native no-paid-overage guarantee; Go remains unverified
- [Safe native fallback proposal](opencode-v2-safe-live-fallback.md) — OpenCode host changes required before live switching
- [OpenCode 2.3.0 compatibility qualification](opencode-2.3.0.md) — Exact SDK/CLI candidate, installed regression gates, changed subagent semantics and deferred feature adoption
- [OpenCode 2.2.6 upgrade](opencode-2.2.6.md) — Historical SDK/CLI compatibility and safety boundaries
- [OpenCode 2.2.0 upgrade](opencode-2.2.0.md) — Historical matched SDK/CLI host compatibility and limits
- [OpenCode 2.1.1 compatibility](opencode-2.1.1.md) — Historical native host audit

## Operations and verification

- [QA-B retrospective acceptance](retrospective-qa-b.md) — Isolated real-model investigation and adversarial acceptance runbook
- [QA-B control evidence](retrospective-qa-b-controls.md) — Private evidence bundles, safeguards and offline regrading
- [Testing and CI](testing.md) — Test inventory and qualification scope
- [Cross-session inbox performance](inbox-performance.md) — Bun query plans, measured scaling and additive index compatibility
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
