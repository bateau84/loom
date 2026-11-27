---
type: Architectural Design
title: "Historical engineering evidence: discovery, originals and selected populations"
description: "Bounded extensions to existing evidence owners, with a first usable discovery and native-resolution increment and explicit remaining preparation dependencies."
tags: [loom, learning, evidence, authorization]
timestamp: 2026-11-27T00:00:00Z
---

# Historical engineering evidence

## Decision and delivery boundary

Extend the existing `loom_record` and `loom_trace` surfaces. Keep Loom records in
the existing Store, native history with OpenCode, and Git/CI originals with their
source owners. An agent should select identities and permitted views, without
knowing internal database locations or schemas.

This increment delivers metadata and selected-field ledger reads, explicit
historical Session discovery, native part inventory and structural matching, and
exact native status/dispatch projections. Raw tool input/output/error retrieval
and body matching are limited to the caller's own current native context. New
exported/cross-Session raw-original release remains blocked on the source-owner
boundary described below. This increment does not create an Evaluator execution
route or change Stage 3 complete-batch preparation. The complete architecture also
covers frozen retrospective populations and external originals; those delivery
boundaries are specified below, not claimed implemented by this increment.

The operator's #182/#187 investigation is motivation and an additional local
qualification case. Private originals are unavailable in the implementation
environment. Synthetic fixtures must preserve its structure and discriminators;
their success cannot establish that the private historical claim was reproduced.

## Governing intent and existing owners

The accepted [review-scoped architecture](ard-006-learning-evidence-and-review-scope.md),
[native evidence specification](../spec/ars-001-learning-native-evidence-spec.md),
[Stage 4 contract](../spec/ars-004-learning-stage4-contract.md),
[preparation](../../user-docs/learning-stage4-preparation.md) and
[restricted execution lifecycle](ard-012-learning-restricted-execution.md) govern this
extension. Their accepted BR/QS/OC baseline remains controlling despite historical
proposed labels in individual requirement files. The corrected
[S3 handoff at PR #250](https://github.com/bateau84/loom/blob/bffcf4d1bf5a409395c4c3e33b38182a6d178d7d/docs/learning-evaluator-s3-handoff.md)
is source-sufficiency evidence, not execution authorization.

| Capability | Existing owner and realization | Preserved boundary |
| --- | --- | --- |
| Discover/select | Store record queries, native Session inventory, existing ObjectiveIndex and review readers | Structure is evidence of a relationship, not proof of objective membership |
| Resolve originals | Store exact record lookup; OpenCode normalized native history/export; existing authorized Git/CI integrations | Exact source/version/view; no substitution by a summary, quote or adjacent result |
| Freeze approved population | Future selected-population extension under EvaluationStore and existing preparation/source owners | Distinct scope and manifest from complete Session Stage 3 batches; no filtered existing manifest |
| Explain support | Existing authored objective links and review relationships, with later versioned interpretation claims | Authored support is not host observation or proof of diagnosis |

`evidence_ids` continues to mean existing in-scope observer records. Native IDs,
artifact URLs and authored claims must not be inserted there. Existing objective
links can describe authored phases and corrections with uncertainty. Existing
review relationships remain bound to their frozen review subjects; retrospective
selection cannot invent prior review membership or independent assessment.

## Discovery and selection

Use the plugin's existing project/workspace/canonical-location scope. An Action
ID resolves through the current Store, and an explicitly authorized Session can
be used to filter its records without a focus, assignment or delivery row. A
missing local Action is unavailable here; it does not trigger a scan of unrelated
stores. An authorized cross-workspace locator remains a separate source-owner
dependency.

Metadata projections contain identities, sequence, kind, owner, recorded time,
fingerprint, size and reference counts. They withhold statements and native
bodies. Selected fields are an allowlisted projection through the existing exact
record-ID lookup. Existing default ledger behavior and sequence pagination remain
compatible. Inclusive upper and exclusive lower sequence bounds permit a stable
append boundary; they do not certify immutable external storage. The existing
local source-store identity accompanies the new record view. Native views expose
project/workspace identity and explicitly mark native store identity unavailable;
matching Session/part strings across hosts cannot establish a common source.

Historical child discovery uses OpenCode's supported Session inventory. Explicit
historical mode requires native discovery policy before target lookup and again
before return. The parent discovery scope authorizes direct-child structural
metadata in this exact project/workspace/location, not descendant content. The
new mode returns no raw scan count and rejects an out-of-scope native page rather
than returning a cursor derived from excluded rows. Continuation binds parent,
caller and location. Existing family-only child discovery retains its contract.
Parentage is structural, not objective membership. Native
`state.metadata.sessionID` is preserved as a dispatch reference from the exact
tool part, separate from Loom-attested assignment and authored interpretation.
Matching revision, chronology, agent role or Action membership cannot establish
participation. A bounded query may select candidates; an investigator must state
the evidence supporting the chosen objective population.

## Exact native originals

Keep timeline's existing privacy projection. New part inventory and exact-source
operations consume the same authorized source boundary: the caller's current
native context or an explicitly supplied project-local OpenCode export. Context
is post-compaction and incomplete; an export's authenticity/completeness is not
certified by a matching filename, Session ID or local hash.

OpenCode 2.3.0 normalizes historical inline message content and current separate
part rows in its own [history reader](https://github.com/anomalyco/opencode/blob/a6b15d33daf6ab7d35569f6d711fdb630b9f04e7/packages/core/src/session/history.ts).
The supported [export path](https://github.com/anomalyco/opencode/blob/a6b15d33daf6ab7d35569f6d711fdb630b9f04e7/packages/core/src/session/transfer.ts)
uses that reader and excludes unsettled messages.
Loom consumes normalized messages; it does not inspect native tables. The exact
native tool-part identity is Session + message + part ID. Tool output belongs to
that part; there is no invented result identity. Selected projections preserve
their source field and value. Missing fields remain explicit gaps; oversized
requested originals fail rather than silently excerpting.

Redaction-shaped strings or objects establish only that a marker was detected.
They may be literal original content, including in the caller's native context.
Such values remain conservatively withheld and excluded from matching, with
availability/gap reason `redaction-marker-unverified`; their original byte count
is omitted. Neither a supplied export nor a marker alone proves sanitizer
provenance. This uncertainty is preserved instead of reporting confirmed redaction.

Inventory defaults to metadata. Literal matching defaults to allowlisted tool
name, lifecycle status and dispatch Session ID. Explicit input/output matching
requires the caller's own native context. Export/cross-Session body matching is
blocked along with raw disclosure: matching IDs/counts would otherwise be an
oracle over withheld content. Matching requires inspection authority and returns
identities without the inspected bodies. Cursors bind the source digest, Session,
operation and filters; changed sources require a fresh query. For exact reads in
an evolving caller context, pin the part hash rather than the entire context hash.
No unbounded regex, SQL or arbitrary query language is exposed. Message bodies,
private reasoning, attachments and arbitrary tool metadata are not new views.

The pinned plugin SDK exposes `session.context`, but not public full-history
message/list/export methods or a target-Session content-authority capability.
The upstream dependency is to expose those supported methods and their source
authorization through the plugin SessionDomain or an explicitly qualified
adapter. Importing native core internals or creating a managed server is not the
fallback. Export creation remains an operator/source-owner step using an approved
existing endpoint and the corrected S3 handoff. Sanitized exports replace native
tool input/output/metadata, so cannot establish unavailable original output or
dispatch relationships.

## Authorization and failure semantics

Discovery, internal inspection and disclosure to the actual calling Session have
separately grantable resources under the existing native `read` permission.
Native effective policy is the authority: an assertion can succeed through an
existing wildcard allow and is not proof of a separate human approval. No Loom
grant database, permission hook, remembered `save` grant or caller-supplied token
is introduced. Export reads retain their canonical file-read resource. Existing
ledger access remains through Store; no database path is returned or required
from the caller. Source location and caller identity are rechecked before release.

The resource grammar is `loom:evidence:discover:SCOPE`,
`loom:evidence:inspect:SCOPE:view:VIEW`, and
`loom:evidence:disclose:SCOPE:view:VIEW:recipient:CALLER`. `SCOPE` is `session:ID`
or `action:ID`; exact record reads append `:record:ID`, and exact native-part reads
append `:message:ID:part:ID`. The caller and agent always come from native tool
context. Every identity component is URI encoded, including the recipient; an
embedded colon is `%3A` and cannot alias a resource separator or another tuple.
Views are `children`, `native-parts`, the selected `native-FIELD`,
`record-metadata`, `record-full`, or the selected `record-FIELD`.

An exact native-source response contains the selected fields and their gaps,
plus a required envelope of source/part identity and version hashes, namespace,
coverage and operation resolution status. Its `part` object contains only
`part_sha256`. The response's `status` says `resolved`, `partial`, `missing` or
`changed`; the native lifecycle value appears only in explicitly selected
`fields.status`. Tool names, timestamps, source/part sizes and all-field
availability are inventory metadata under `native-parts`, and are absent from
exact-source responses. Granting only exact dispatch inspection/disclosure can
therefore return dispatch while native status and inventory disclosure stay denied.
The permission envelope covers the complete serialized response, not just its
`fields` object. Identity/version hashes pin sources; they do not certify origin
or authorize other field views.

For example, these ordered native rules permit only the named historical parent
inventory within the new evidence resource namespace (other existing native
permissions are separate):

```json
[
  {"action":"read","resource":"loom:evidence:*","effect":"deny"},
  {"action":"read","resource":"loom:evidence:discover:session:PARENT","effect":"allow"},
  {"action":"read","resource":"loom:evidence:disclose:session:PARENT:view:children:recipient:READER","effect":"allow"}
]
```

An unauthorized request receives no protected identities, counts, previews or
relationships. Native denial/rejection propagates as a failed operation. Target
lookup failures after authorization have a generic scope-unavailable error. Every
page, retry and exact read rechecks authority; no cached result is a grant.
The response is serialized and bounded, source/location checks finish, then one
final native assertion covers the complete resource union and the exact returned
view digest. No further asynchronous work precedes return. A denial at that
assertion withholds the whole response, including a revocation observed during
earlier bounded retrieval.

**This is a native permission-decision observation, not an atomic policy/return
fence.** Pinned [native permission handling](https://github.com/anomalyco/opencode/blob/a6b15d33daf6ab7d35569f6d711fdb630b9f04e7/packages/core/src/permission.ts)
can collect rules before an awaited hook/approval and resolve a pending `once`
approval without re-evaluating a later configured denial. Source inspection
establishes that gap; it is not an executed private-data disclosure. New raw
export/cross-Session reads and matching therefore return
`unsupported-source-release` instead of relying on that assertion as protected
transfer authority. A source-owner release API needs an explicit current
source/version/view/recipient decision and revocation linearization before that
dependent capability can be enabled. Strict concurrent-revocation and full
protected-transfer acceptance remain unqualified for this increment.

No parameter can nominate another recipient. A returned view grants neither
new Loom raw retention nor delivery to another agent/provider. The host retains
its ordinary tool-return history; this is not a new Loom transcript snapshot.
General Q5 confinement remains a separate host qualification.

## Registered interfaces

Start with a known Action in the current workspace or an explicitly authorized
source Session. Existing exact record lookup is reused:

```json
{"operation":"query","action_id":"ACTION","source_session_id":"CHILD","projection":"metadata","record_kinds":["result","assessment","qa"],"limit":50}
{"operation":"query","action_id":"ACTION","record_id":"RECORD","projection":"fields","fields":["statement","artifact_refs"]}
```

These are `loom_record` calls. `after` is exclusive and `through` is inclusive;
repeat all filters with `after: next_after` until it is null. Metadata returns
reference counts, not reference strings. Fields must be nonempty, unique and
selected from `statement`, `evidence_ids`, `artifact_refs`, `verdict`,
`verification`. Missing selected fields are listed in `missing_fields`. Omitting
`projection` preserves the existing complete exact-ID record response.

These are `loom_trace` calls:

```json
{"operation":"children","access":"historical","session_id":"PARENT","limit":50}
{"operation":"parts","session_id":"PARENT","export_path":"private-retro/parent.json","tool":"subagent","limit":50}
{"operation":"source","session_id":"PARENT","export_path":"private-retro/parent.json","message_id":"MESSAGE","part_id":"PART","fields":["status","dispatch"]}
{"operation":"source","message_id":"MESSAGE","part_id":"PART","fields":["output"],"part_sha256":"REPLACE_WITH_RETURNED_PART_HASH"}
```

Only the last call reads raw output, and only from the actual caller's current
context. Replace its placeholder with the inventory's exact `part_sha256`.
`source_sha256` optionally pins the complete source. Exact sources report
`resolved`, `partial`, `missing`, or `changed`, retain field gaps, and never fetch
a neighboring part. New native views are bounded to 16 MiB normalized source,
20,000 messages, 60,000 parts, 1–50 returned parts and 262,144 response bytes.
Provided exports retain the existing 16 MiB file bound. Oversized exact content
fails; it is never silently excerpted. This is not a retained frozen population.

## Frozen retrospective populations: distinct evidence boundary

The [retrospective population design](ard-010-learning-retrospective-populations.md)
defines a separately typed selected-population scope under the existing evaluation
store, with an operator-approved retrospective selection initially acceptable.
Preview must resolve current source availability and coverage without mutation.
Freeze preserves exactly approved membership, identity/version, permitted view,
membership evidence and limitations. New records/Sessions/discovery results do
not alter it. Missing or changed originals stay gaps, never neighboring content.

Do not feed a subset into current `EvaluatorPreparation`: its complete Stage 3
membership validation is intentional. Existing Stage 3 sources, inventories and
historical readers retain their meanings. Native/external resolution and current
policy are asynchronous; the current synchronous Store validation callback cannot
be repurposed as proof that those owners were rechecked. The next increment must
design an asynchronous recipient-authorized resolution boundary and pinned
readback before connecting a selected population to preparation. No source
modification policy is decided here. Successful preparation grants no execution
permit and cannot weaken #249's held-reservation or claimant-owned-cleanup checks.

Manual selection is a qualification route, not the permanent automatic-learning
model. Later source-established objective/attempt relationships can propose the
same typed selection under configured policy without changing frozen semantics.

## External originals and fidelity

Reuse supported Git and CI integrations. Loom owns references and qualification,
not a general GitHub client, URL fetcher or artifact framework. A future adapter
must distinguish commit from tree, resolved object from quoted SHA, run from
attempt, job's actual tested revision, artifact ID from verified digest, and
suite success from named test events. Attempt 2 never substitutes for attempt 1.
An unavailable original failure makes its claim unverified without discarding
valid rerun/correction evidence. A narrow approved test-event projection may
extract events after artifact identity/digest validation; it cannot assign a
diagnosis. The watcher-first explanation remains an investigator hypothesis.

## Qualification and limits

Registered-tool tests exercise an unrelated Session sharing a revision,
children without Loom focus/assignment rows, five authored records, exact field
reads, original output identity, denial and mid-operation revocation, changed
cursor sources, oversized/missing/redacted content and unchanged complete batches.
The controlled measurement fixture has 261 direct children, three grandchildren,
3,364 normalized parent messages, 261 dispatch parts, six Plan revisions and 776
Action records. Four selected Sessions contain five authored records.

The following single run was measured through the registered tools on 2026-11-25.
The native and permission APIs are simulated; these are not installed-host
latencies or a production benchmark. Time sums invocation and serialization.

| Equivalent information need | Existing path: calls / response bytes / ms | New path: calls / response bytes / ms |
| --- | --- | --- |
| Discover the five records for the same four known approved Session IDs | Whole-Action inventory then filter: 16 / 410,865 / 17.200 | Session-filtered metadata: 4 / 2,235 / 4.185 |
| Read statement/artifact fields for the same five exact record IDs | Existing full exact-ID lookup: 5 / 3,010 / 3.005 | Selected fields: 5 / 3,516 / 3.772 |

Complete direct-child plus selected-grandchild traversal took seven calls and
51,381 response bytes. Structural part selection took one call and 3,155 bytes;
four exact dispatch-reference reads took four calls and 4,776 bytes. These are
absolute observations, without a fabricated pre-existing equivalent trace path.
No byte-identical request was repeated. The measured responses exposed no project
path, ledger filename or SQL literal under the fixture's explicit checks.

The selected-field envelope is larger for these small records. Its benefit here
is precise disclosure, not compression. Both inventory paths start with the same
approved Session IDs and return the same selected record coverage; the legacy
path also returns unrelated records and statement excerpts. Fixture setup,
permission RPCs, model reasoning and the investigator's selection reasoning are
excluded. Repeated envelope bytes are not model-context or token measurements.
The [test inventory](../../user-docs/testing.md) gives the command that emits the full measurement
JSON. Do not turn avoidable investigator mistakes into baseline cost or infer
token savings from byte counts.

Installed-host qualification must use the exact package on isolated OpenCode
2.3.0 with synthetic local-provider work and cleanup. Both storage-generation
claims require source-owner normalization evidence, with installed positive
controls in the dedicated historical-evidence workflow. A source test or a harness
definition is not an executed qualification; the PR and CI receipts record the
exact candidate and observed result. Private operator rehearsal, external artifact retrieval,
selected-population freeze, genuine Evaluator reasoning and production authority
remain separate acceptance evidence. The Stage 3 revision-count observation is a
separate investigation candidate; no scheduler or retention change follows.
