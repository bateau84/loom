---
type: architectural-decision
title: Continuity Through Owned Facts and Derived Execution
description: Bounded replacement of duplicated work authority with a transactional fact model, immutable provenance and derived execution.
tags: [loom, architecture, reliability, continuity, simplification]
---

# Continuity through owned facts and derived execution

**Status:** accepted by independent architecture review on 2026-10-09, workflow `735f1bce-1974-4f34-9158-4ec7ed5572de`, step `review-architecture`, of Architect revision `d5f976e9a20b27840ca33d786a0362b6b3f0a17c`. No implementation authorization or runtime proof.

## Derived from / satisfies

[Accepted scope and document map](index.md). Realizes BR-001–003 and OC-001–003; [recovery and verification](proof-and-recovery.md) realizes QS-001–002. Accepted design owns human presentation, not a second stored status authority. Internal compatibility is unnecessary; attributable history is mandatory.

## Decision question and drivers

Which facts must survive changes of course, and which independently writable records can disappear? Prioritize narrow invalidation, honest original proof, finite continuation, independently enforced admissions and recoverable installation changes. Local OpenCode use does not earn distributed services. No universal semantic-prose equivalence, external exactly-once execution or automatic effect reversal is assumed.

## Evidence boundary

OKF discovery read accepted Anchor, all seven experience stories/scenarios and main design, all eight normative BR/OC/QS artifacts and P1–P8, plus current control-plane/work/isolation/scope/lifecycle/upgrade documentation. Documentation describes intent/advertised capability; it is not current reproduction. Remote draft PR #168's two discovery documents at source baseline `7f0ddd14` are hypotheses only. Their catalogue-wide prerequisites, production-canary reads and old active-adapter assumptions are superseded by accepted authority.

Fresh static code-intel graph narrowed current source; reads confirm:

- `plugins/loom/work.ts:30–143` owns Plan Task meaning and revisions; `workflow.ts:852–970` accepts another authored TaskSpec, embeds it into steps, compares full Task serialization and rejects changing unanswered waits. This is a concrete duplicate-authoring seam, not proof every journey fails.
- `runtime.ts:1094–1197` already uses SQLite WAL/FULL and transactional KV with BEGIN IMMEDIATE/rollback. One SQLite file does not remove independently writable overlapping domain facts. Retain transaction technology, replace overlapping aggregates.
- `scope.ts:104–130` matches normalized patterns by anchored glob regex; trailing-directory semantics are not intrinsically recursive. `shell.ts:918–960` rejects unrecognized commit words, including explicit path operands/`--`. These explain credible admission gaps without claiming a live reproduction.
- `index.ts:4756–4814` checks scope, shared index and attempt ownership; the native permission branch at `13795–13904` separately checks exact binding/scope/ownership. `1450–1490` maintains session/index ownership and rejects foreign staged files. Control-plane scope authorization is therefore not attestation that the actual native boundary will admit publication.

The supplied current workflow incident is evidence of actual authoring/publication contradiction, recorded in OQ `c6bdfd05` and human commit `2874f12`: reviewer status-only patches succeeded, control-plane committability said Yes, native staging denied exact-byte provenance, and Reviewer elevation was independently rejected by role policy. Designer/Specifier publication also depended on manual commits after foreign-index denial. Do not infer their missing provenance from these symptoms or adopt foreign bytes. Manual commits count as coordination burden, not reliability success.

## Alternatives assessed symmetrically

| Option | Ownership / preservation | Composition / failure behavior | Cost / security / operations |
| --- | --- | --- | --- |
| A: normalized relational facts + immutable payloads, transactional current selections, derived execution | One owner per fact; append original attempts/observations/judgments; current selections are explicit decisions | Atomic local transitions; external invocation remains a separate observed fact. Projection rebuild cannot create proof. Offline snapshots include payload closure | Reworks consumers/writers, explicit foreign keys and input identities. Small offline manager and process fencing still necessary; no distributed protocol |
| B: append-only command/event journal, deterministic reducers and projections | Sole event writer and versioned reducer own all decisions; old events remain attributable | Atomic event batches and replay can yield consistent admissions. External outcomes still need explicit events; restore requires compatible replay semantics | Viable and strong auditability; requires permanent reducer/version history, replay ordering and event upcasters. More recovery machinery; old bug can replay incorrectly without correction events. Comparable trust boundary to A |
| C: current aggregates plus shared action resolver | Could retain evidence and improve diagnostics quickly | Conflicting mutable Step/Work/result/ownership rules remain unless their writers are removed; resolver does not establish downstream admission | Lowest initial change, highest continuing coordination. Fails BR-003 as a final solution; not an adequate baseline despite facade benefits |
| D: separately persistent Plan/lifecycle/capability actors | Viable with exclusive ownership, durable messaging and conditional cross-service handoffs | Must preserve decision identity across partial commits, unavailable service and skew; no simple local transaction spanning pause/dispatch | Potential independent scaling/security domains, but none required here. Extra claims/outbox reconciliation/distributed backup costs exceed local need |

Choose **A**, after challenging it against the static counterexamples below. B is a serious complete alternative, not eliminated on correctness: A wins because normalized immutable facts already supply required attribution without retaining a replay language indefinitely. D loses on unjustified distribution. C fails a named accepted gate. Existing SQLite is adequate; selecting it is not preserving the KV/domain duplication. Do not build universal event sourcing, a new recovery workflow or a model-authored applicability oracle.

### Analytic discriminators (not executed probes)

1. Crash after producer result commit, before status refresh: A reconstructs usable/pending from original result, current contract and review receipts, not status repair. B reconstructs by reducer; C still needs to choose between independently writable statuses.
2. Split downstream C while A/B contracts/inputs stay unchanged: A retains their immutable results; current consumers request those results with their own contract/input tuple. A new assurance demand adds review work, not fabricated new execution. B can model this but retains event evolution burden.
3. Lost remote response: both A and B must preserve unknown invocation; neither transaction/replay proves no effect. This falsifies a naive 'single transaction makes everything atomic' version of A.
4. Reviewer admitted status-only edit but provenance absent at staging: A requires native mutation receipt and publication check to share one capability target and origin chain. Merely moving session/attempt ownership maps into SQLite would fail just as before.
5. Broken-plugin restoration: A's stable envelope and standalone manager can inspect/export without plugin imports. B requires an independently deployable compatible replay/inspection implementation. Neither option passes because a backup exists.

These distinguish architecture, not feasibility evidence. Host interception, enforced write custody and complete restoration are unproven and must be early delivery proofs before dependent rollout.

## Retained authority inventory

One installation-scoped SQLite canonical database (project/work identities in keys/relations) and immutable content-addressed payload storage. Domain modules expose commands, not arbitrary record writes. Facts below may have separate tables, but do not own overlapping copies of the same decision. Every correction/supersession is attributed; originals are not rewritten. Referenced payload bytes are durably synced before the transaction commits references and before acknowledgement. Unreferenced failed-write objects are harmless orphans, not successful work.

| Independently writable fact / owner | Why not derivable; retained boundary |
| --- | --- |
| Accepted content and exact user decision / actual user, recorded by coordinator | Recommendation/silence cannot yield consent. Immutable content digest, decision identity, actor and source; content path is a locator only |
| Plan revision and active selection / Planner under reviewed authority | Goal/Task semantics, dependencies, obligation/proof demand and amendment are new professional meaning. Store immutable revisions and selected revision; no second executable Task prose |
| Intent abandonment, pause/resume/cancel and work admission epoch / authorized lifecycle owner | Deliberate authority change cannot be inferred from selected conversation, failed attempt or idle host. Store attributable transitions and authoritative latest epoch |
| Execution settings and exact grant / assigning authority | Concrete write targets, chosen tool adapter, resource limits are choices beyond Plan meaning. Settings cannot override accepted obligations |
| Ownership lease / admission manager | Current exclusive owner and monotonically increasing fencing token resolve contenders; not inferred from last chat speaker. Store compare-and-swap winner and expiry; expiration alone does not stop external processes |
| Attempt and result / admitted producer plus observers | Actual original contract, inputs, invocation and output are occurrences. Append attributed attempt/outcome/result facts; no mutable current-vs-prior result relocation |
| External operation admission, invocation and observed outcome / effect broker and observer | Permission is not invocation; result claim is not actual effect. Stable operation identity, target, extent and unknown/running/outcome observations; never infer undo from internal rollback |
| Evidence observation and producer claim / observer and claimant separately | Observation cannot be synthesized from claim; retain source bytes/identity and bounded references, missing proof remains missing |
| Independent review and acceptance / distinct authorized assessors | Producer result or successful restore cannot imply PASS. Exact subject/assurance, reviewer identity and contributing authors; repairer's checks remain evidence only. Reliability/simplification acceptance receipts are separate |
| Question presentation, answer, replacement and per-consumer treatment / question owner, named responder, each consumer | Asked wording/provenance and material treatment are decisions. Delivery/read are not treatment. Asked originals survive replacements; unasked obsolete draft needs no answer |
| Material relevance/applicability correction / obligation owner | Explicit consumed input membership and an attributable resolution of ambiguous relevance are judgments. Algorithmic verdict cache is not writable authority |
| Mutation receipt and accountable handoff / trusted mutation observer, actual contributors | Actual base→output contribution cannot be derived from scope or filename. One receipt chain, no independent session/attempt authorship maps |
| Resource allocation, consumption and approved increment / user/allocator, broker | Authorized limit and actual spend are different occurrences. Deduplicated operation charges, never reset by Plan revision or owner transfer |
| Publication / Git observer | Local commit/remote confirmation are external facts, not authored bytes or gate approval. Store exact observed commit/tree and known/unknown remote outcome |
| Recovery cut, verification, selected activation and loss consent / standalone installation manager, actual user | Completeness/restorability/activation are observed facts and decisions, not schema labels. Stable external activation envelope owns which generation may write; database does not duplicate that selection |

Conversation selection is local navigation, not work authority. Installation identity and stable activation envelope are installation-manager owned facts. Learning and dashboard are advisory/read-only. Secret credentials never become payload/projection data.

## Removed writers and decisions

Delivery must remove, rather than retain shadow writes to:

- separately authored `TaskSpec` meaning at `loom_task_plan`/`applyTaskPlan`; compiled node carries Task revision reference, not editable contract copy;
- mutable WorkNode Task/Phase/Wave status and Step/gate status as independent satisfaction authorities; derive from selected contracts, original facts, grants and exact review receipts;
- `result` versus `priorResults` relocation/invalidation bookkeeping and adoption flags claiming reuse; all original results retained, current use derived;
- separate semantic-closure, executable-fingerprint and whole-HEAD carry-forward verdicts; all four use boundaries consume one tuple evaluator;
- session Git ownership and step-attempt authorship copies of the same contribution; one trusted mutation/handoff receipt chain supports both;
- blanket question reopen/treatment clearing, answer transport OQs and delivery-dependent retrieval;
- successful-side-work-only return binding, manual restoration of Wave claims, and fabricated completion to unlock context;
- installation/project mutable snapshots or dashboard rollups that can independently authorize work.

Phase/Wave grouping may remain immutable Plan organization, not independently completed state. A compiled graph/cache may be persisted with compiler/input digest for efficiency, but only rebuilt; no public cache-write API. Original review receipts and their assurance scopes remain even if derived gate status changes. Existing non-conflicting identity, observation and review-independence mechanisms can be reused behind the new seam, not duplicated beside it.

## Continuity conversion and transaction boundaries

Choose lossless **verified export/import**, not online old-format adapters. Admissions paused; stale writers fenced. Export original raw records and referenced artifacts with source namespace/key, content digest, schema version and source identity. Import an immutable historical envelope plus normalized facts where original attribution is supported. Verify family counts, references, payload digests, original contract/input context, decision sources and reviewer independence against the export before activation. Uninterpretable records remain directly recoverable raw history and make affected use unproven; they are not grounds to fabricate completion. Missing artifacts/proof prevent completeness claims, and where protected acknowledged state cannot be recovered conversion cannot proceed. Old state is kept as sealed history/recovery material, never another writable authority. No original receipt is backdated or relabelled as execution under a new contract.

Within one database transaction: validate epoch/lease/current selection and expected revision; append domain transition; consume one-use grant/resource charge; record admitted operation reservation; advance required indexes. Notifications and filesystem/Git/host effects are **outside** it. Durable reservation followed by lost invocation acknowledgement is unknown; do not replay blindly. Blob insertion precedes fact reference commit; commit acknowledgement follows durable reference and payload closure. Publication is a separate observed effect, not automatic completion of a document producer.

No canonical transaction holds while waiting for inference/network/external effect. Concurrent contenders serialize by transaction and expected revision; loser receives current decision/conflict, not a second grant. At external execution, validate epoch and operation token again. [Seams](realization-seams.md) specify the actual trust-boundary contract; [recovery](proof-and-recovery.md) specifies activation/fencing outside damaged schemas.

## Consequences and reconsideration

Positive: narrower reuse, reconstructible projections, one Plan meaning and one contribution provenance. Price: coordinated writer removal, immutable artifact retention, bounded compiler and offline recovery implementation. Immutable histories are not a free disk guarantee; capacity is preflighted and missing capacity is an owned wait. No retention/deletion policy is invented here.

Reconsider A if independent composition proof cannot remove duplicate decisions, or installation-level transaction contention measured under representative concurrent projects prevents required continuation. Prefer B only if it demonstrably reduces total durable decisions/recovery dependencies; don't adopt it merely for audit terminology. Host inability to fence old writers or constrain effect execution blocks the affected realization/rollout, not a waiver of guarantees. No unresolved user policy is currently needed. Technical proof obligations remain explicitly unexecuted.
