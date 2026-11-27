---
type: Architectural Design
title: "Frozen objective-scoped retrospective populations"
description: "Stable selected evidence membership under EvaluationStore, with current source authorization and a distinct Evaluator preparation path."
tags: [loom, learning, evaluator, evidence, authorization, recovery]
timestamp: 2026-11-27T00:00:00Z
---

# Frozen objective-scoped retrospective populations

## Decision and authority

**Freeze a selected objective's evidence membership before preparing an
evaluation. Keep the frozen manifest in EvaluationStore and resolve originals
through their existing owners whenever they are inspected.** A connected
trajectory helps find evidence; it does not decide that everything reachable
belongs to the evaluation question.

The user selected this increment of [#227](https://github.com/bateau84/loom/issues/227)
after [#254](https://github.com/bateau84/loom/pull/254), merged at
`dfe649210ff9ac0a70ea9878e7e09d18450d2de6`. It follows the
[connected-history contract](ard-009-learning-connected-trajectories.md),
[historical-source boundary](ard-007-learning-historical-evidence.md),
[native evidence specification](../spec/ars-001-learning-native-evidence-spec.md) and
[Stage 4 contract](../spec/ars-004-learning-stage4-contract.md). The native specification and
Stage 4 contract carry the accepted BR/QS/OC baseline forward; historical
“Proposed” labels in the original requirements do not retract that acceptance.

This design adds no original-source modification policy, raw capture, protected
source release, recipient execution authority or automatic scheduler. The
existing [Stage 3](../../user-docs/learning-automatic-stage3.md) and
[preparation](../../user-docs/learning-stage4-preparation.md) contracts remain valid. The
[restricted execution safeguards](ard-012-learning-restricted-execution.md) remain
controlling. Implementation and executed qualification must be reported
separately; this architecture is not an execution receipt or product acceptance.

For the #182/#187 reference, the selected question may concern the restore
freshness test correction. Its initial failure, unchanged-code rerun, plausible
diagnosis, different-revision correction and scoped verification stay distinct.
A shared CI record may connect another objective without including that
objective. The separate release-acceptance question does not acquire a positive
answer from a scoped recheck. Historical associations remain attributed and
qualified; no missing relationship is reconstructed automatically.

## Selection and shared inspection

Use one explicit objective, an evaluation question and any explicit exclusions
with reasons as the selection recipe. The objective owner supplies its bounded
associations. Store supplies the checked forward references to supporting
originals. ReviewRequests supplies applicable complete requester-owned mandates
and qualified review relationships. Reuse those owners' source identities,
historical WorkRefs, relation meanings and missing-reference qualifications.

The selection does not take the transitive connected component of the Action.
It does not enumerate every Session containing a selected record or treat
current Plan descendants as historical membership. A record can support several
relationships while appearing once in the selected evidence inventory. The
single selected objective remains one objective; unique source IDs do not
establish independent originating requests.

The read-only preview establishes the complete bounded candidate before paging
its presentation. It reports selected sources, supporting basis, relationship
provenance, participating recorded work, exclusions and gaps. An excluded source
must not silently disappear from the explanation of another member's basis:
retain the permitted relationship qualification or an explicit unresolved-basis
gap. A resource ceiling fails explicitly rather than certifying a selected
prefix as complete.

The preview returns a canonical digest and replayable selection with ledger and
owner boundaries. Explicit freeze rechecks that same selection and digest. A
changed source, selector, permission-dependent view or owner snapshot cannot be
accepted as the earlier preview. A later fresh preview can propose a different
population; it does not revise the old one.

JSON and human-readable representations consume one population view. They show
the same member identities, versions, selection basis, exclusions and coverage.
Frozen pages distinguish retained manifest facts from **current** source
availability. References include supported exact-source read requests; no
renderer fetches originals or substitutes live history. Page cursors bind the
population identity and manifest digest, and every page applies current grants.

This selection boundary is reusable by a future policy-controlled proposer.
The current explicit approval route does not require future callers to assemble
individual records manually. Source-established objective relationships and a
configured policy can supply the same selection recipe later. Neither that
future proposer nor automatic reconstruction is delivered by this decision.

## Persistence and identity

EvaluationStore owns an optional retrospective extension in the existing
learning database. It stores a versioned manifest header and ordered member
metadata, not a copy of original ledger/native/Git/CI bodies. ObjectiveIndex,
ReviewRequests, Store and future qualified external source owners retain the
originals. This is selected evaluation metadata, not another evidence store or
persisted navigation graph.

The immutable identity covers the format version, owner, source namespace,
selected objective and question, selection policy/recipe and boundaries, complete
ordered membership, source versions and permitted views, relationship basis,
coverage, qualifications and exclusions. Equivalent repeated source references
are deduplicated by exact identity, version and view; distinct legitimate
relationships remain distinct. Creation timestamps and current availability or
permission observations are separate from content identity.

Native call references retain the full Session/message/call tuple even while
their originals remain unsupported. Call IDs alone are not unique originals.
Selection exhausts relationship continuations for every record page and
normalizes page-relative inclusion without discarding relationship provenance.

The header and all members commit in one transaction. Readers verify the whole
manifest, row correspondence and contiguous ordering before returning any page.
The complete population can be reconstructed by collecting bounded pages in
order; page-only ordinals and current resolution observations are not new frozen
members. Missing members, unexpected rows, unsupported formats and inconsistent
counts/hashes fail closed.

Freeze is idempotent over the exact canonical content. If that population
already exists, replay returns the same identity without rerunning a live query
to redefine it. Original-source disappearance can affect its current
availability, but cannot turn an acknowledged freeze into a different
population. Fresh source arrivals and associations belong to a separately
approved population.

### Alternatives considered

| Option | Mechanism and benefit | Cost and failure modes | Decision |
| --- | --- | --- | --- |
| Existing batch/member rows plus optional selection metadata | Reuse batch membership and hashes immediately; add rich metadata alongside the batch. | Batch processing states, predecessor chains and Stage 3 inventories need new exclusions; the synchronous original callback cannot authorize the new views. Rich relationship/gap metadata does not fit existing source references. A missing scope check can reinterpret selection as completed processing. | Viable, but adds unnecessary coupling to legacy batch semantics. |
| Optional retrospective manifest/member extension inside EvaluationStore | Preserve a distinct immutable population before any method is selected; preparation consumes its explicit identity. | Requires optional-schema validation, atomic row publication and paired backup coverage. A damaged extension must be isolated from healthy Stage 3 state. | Selected: the existing persistence owner gains the minimum distinct state needed by the accepted population meaning. |

Filtering a completed Stage 3 batch and retaining a live trajectory query are
not viable alternatives: each directly violates accepted membership semantics.

## Asynchronous source boundary and authorization

The subsequent [original-source increment](ard-011-learning-original-source-resolution.md)
connects selected current-caller native views and exact GitHub originals to this
boundary. New previews can pin those owner versions. Existing unresolved or
reference-only members retain their frozen identity and gaps; a newly available
original requires a fresh preview and explicit freeze. The native historical
release dependency and the execution fence below remain unchanged.

The preparation/population service uses an asynchronous source-resolution
boundary. A resolution request names the actual caller/recipient context,
source namespace and exact identity/version, and the permitted view. Its result
distinguishes an authorized matching original from unavailable, unresolved,
unsupported and changed-original gaps. A declared external revision is not a
verified external version. Native or external adapters remain unavailable where
their supported interfaces and authority do not establish the required check.

The EvaluationStore synchronous validation callback remains local Stage 3
validation. Neither that callback nor an in-process hash attests external
authorization, protected recipient transfer or native execution. The new
service must await the responsible owners; it cannot obtain authorization from
caller-supplied status fields.

Use existing history discovery, inspection and disclosure controls before
hydrating source-derived labels, relationship notes, references or counts.
Metadata-only contributor preflight precedes source projection. Recheck the
complete contributor union, configuration and final returned view after
asynchronous permission calls. A grant to discover an objective does not grant
each contributing source or its derived metadata.

Authorization failure is different from a missing exact original. If the
reader cannot receive an identity, count or qualification, deny that view
generically; do not reveal the protected member through a gap slot. Where the
member metadata is independently permitted, unavailable or changed original
content remains an explicit current gap without dropping the member. Exact
source retrieval returns the pinned version/view or a gap; it never returns a
neighboring revision as its substitute.

Review ownership and complete-manifest withholding remain unchanged. A private
mandate cannot be filtered into a seemingly complete public mandate, including
through frozen metadata. A shared population identity does not broaden the
audience for its contents. Current grants govern every preview, frozen page,
original read and preparation readback, including after restore. Frozen
permission observations are not permanent grants. This preserves the existing
non-atomic native authorization limitation rather than claiming a new universal
transfer fence.

## Preparation and execution boundary

Retrospective preparation consumes an explicit population ID and manifest
digest through a new discriminated source contract. It revalidates current
source access asynchronously and preserves the exact chosen population in the
prepared method/request chain. It does not manufacture a Stage 3 source batch
ID or use a filtered existing batch. Legacy request encodings and complete-batch
validation remain unchanged.

The v2 manifest labels its member count as deduplicated evidence sources and
reports one selected objective. Several source members never imply several
independent objectives.

Existing EvaluationStore, ReviewRequests and canonical issue owners retain the
preparation lifecycle, immutable request mapping, original requester and
cross-store replay rules. Missing source coverage stays explicit in the
prepared subject; preparation is not a claim that a future Evaluator has
received every original. No new preparation or successful source check claims
an issue, creates a native recipient, reserves spend or dispatches a provider.

The [restricted execution consumer](ard-012-learning-restricted-execution.md)
now supports this source through a separately declared trusted retrospective
integration. The v2 subject and semantic enrollment bind the exact population;
the resolver and whole-source authorization use the actual grant recipient.
Without that explicit capability the consumer still rejects v2, including when
an otherwise valid legacy execution adapter is supplied. Production has no
adapter. Existing #249 reservation, claimant ownership, cancellation and restore
protections apply unchanged; preparation and source availability are not grants.

## Failure, recovery and verification obligations

| Guarantee | Owner and enforcement | Required falsification point |
| --- | --- | --- |
| One bounded objective; no connected-objective expansion | Objective/source selection, explicit exclusions and complete basis qualifications | Large Action with shared evidence and an unrelated connected objective; selected count remains one. |
| Stable complete membership and exact versions | EvaluationStore atomic manifest/member commit and whole-manifest validation | Remove a member, alter a source version or relation, add a row, reorder ordinals or interrupt persistence; no successful partial manifest. |
| Many relationships, one evidence occurrence | Canonical source identity/version/view and separately retained relationship provenance | Overlapping objective/review associations preserve each meaning without duplicate evidence counts. |
| Historical scope survives later work | Frozen exact WorkRefs, source versions and owner snapshots | Change current Plan, append a review/association and add records; earlier population bytes and identity remain unchanged. |
| Current source gaps do not erase frozen membership | Asynchronous resolver and separate current availability projection | Delete/change an original after freeze; manifest remains reconstructible and exact-source retrieval cannot substitute content. |
| No protected discovery or disclosure | Existing native discovery/inspection/disclosure controls plus final view check | Deny one contributor or revoke during an awaited permission check; JSON, Markdown, HTML, source reads and continuations reveal no protected details. |
| Replay and recovery preserve identity | Deterministic identity, transactional publication and existing preparation replay owners | Lost commit acknowledgement, restart, process interruption, concurrent replay and stopped-state restore retain the same complete population and consumed issue state. |
| Optional damage stays contained | Retrospective schema validator and paired backup validator | Partial/unsupported extension or checksum-consistent structural corruption blocks retrospective certification while existing Stage 3 remains usable. |
| Preparation remains effect-free | Explicit source discriminator and required qualified execution integration | Exercise registered preparation/readback and a legacy adapter without retrospective authority; no Evaluator/native/provider effect occurs. |

Read-only preview performs no persistence repair. A failed freeze before commit
publishes nothing; after a durable commit, replay recovers that identity. No
transaction spans the native permission system or every source database. Exact
source rechecks and explicit later gaps constrain that limit; they do not claim
cross-owner atomicity. A committed preparation marker without its corresponding
mapping remains restore-required, following the existing lifecycle.

Backup/restore includes the new optional metadata and all member rows under the
paired stopped-host procedure. Validation must check schema, discriminants,
references, complete membership and content hashes. Recomputing a checksum over
arbitrary malformed data is insufficient. Restored state grants no new source
or execution authority.

Every retrospective preparation batch must resolve its exact frozen population,
owner, source namespace and population digest, and contain the complete ordered
projection of that population's source descriptors. Retained v2 requests must
agree with the batch and its separately calculated preparation-manifest digest.
These JSON references are not SQLite foreign keys: validating all surviving
populations cannot certify a preparation whose population was deleted while
another valid population remains. The offline validator enforces both sides of
the binding, including scope/source discriminants and committed mapping markers.

A frozen batch before request mapping, or a mapping before the ledger's canonical
review/issue write, remains a valid replay state. Recovery checks persisted
descriptors without consulting current originals; later source changes or loss
remain explicit gaps and do not rewrite the selected population.

Qualification uses planned and unplanned fixtures structurally equivalent to
the #182/#187 trajectory, more than one page of membership, and actual registered
tools. Keep installed-host, backup/recovery and existing Stage 3/4/#249 regression
checks distinct from unit mechanics. Private operator originals and their exact
approved selection remain a separate local qualification; no fixture supplies
that result or genuine Evaluator reasoning.

## Consequences and open dependencies

Stable membership lets a human, Researcher and future Evaluator discuss the same
question and evidence basis. It transfers explicit selection, storage and
recovery obligations to the existing owners. It does not remove the operator's
need to assess incomplete historical relationships. Metadata itself can reveal
sensitive work, so its persistence creates no new publication right.

“Frozen” means membership and its recorded basis are fixed. It does not promise
permanent original retention, immutable external content, verified truth,
complete native capture, goal independence or successful evaluation. Later
contrary evidence belongs to a new population or interpretation; it cannot be
smuggled into the old one by a current relationship lookup.

Original-source modification semantics remain unresolved: this increment
detects an exact-version mismatch and reports a gap, without deciding replacement,
retention, invalidation or republication policy for genuine interpretations.
Native full-history access, protected release, Git/CI original resolution,
real provider/account authority, automatic selection/scheduling and genuine
Evaluator reasoning remain their existing owners' separate dependencies.
