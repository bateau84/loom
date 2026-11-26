---
type: Architecture
title: "Layered engineering history: shared navigation and dashboard"
description: "A shared, authorized read projection over existing history, with explicit boundaries between navigation, originals and frozen retrospective populations."
tags: [loom, learning, history, dashboard, evidence, authorization]
timestamp: 2026-11-26T00:00:00Z
---

# Layered engineering history

## Decision and delivery boundary

Give humans and agents the same compact map of recorded engineering work. A
Store-owned projection supplies intent, historical work groups, significant
authored records, typed references and coverage. One authorized `loom_history`
reader exposes that projection as JSON, Markdown or a self-contained HTML
dashboard. Deterministic selectors search the eligible authorized history before
the result limit is applied, including work omitted from an overview. Consumers
then expand a selected group or retrieve an exact original through the existing
`loom_record` reader. Representative highlights are an entry point, not an
inventory of every important event.

This is the first useful **ledger navigation** increment of
[issue #227](https://github.com/bateau84/loom/issues/227). It does not claim the
entire four-layer product direction is delivered. Native conversation text,
historical dispatch prompts and full native message inventories still need their
existing source owner's supported authorization and history APIs. A source
reference, current selection or authored conclusion cannot fill those gaps.

The baseline at `beb9fb082a1f152a71d27720f306aff308ec5214` has no dashboard
implementation: the README and implementation design explicitly defer one. This
increment therefore provides the first read-only dashboard surface. It does not
add a server, browser session, unauthenticated endpoint or second evidence store.

The HTML is an authorized read captured at generation time. Included groups and
records expand locally. Deeper retrieval and refresh use the exact requests
shown in the view through `loom_history`; the HTML does not fetch sources or
refresh itself. Saving or forwarding a view is a separate recipient/retention
decision, not authority granted by its references.

## Derived from

- [BR-010 — Navigate layered engineering history](requirements/learning-retrospectives/br-010-layered-engineering-history.md) and [QS-006 — Progressive history navigation](requirements/learning-retrospectives/qs-006-progressive-history-navigation.md), recording the operator's accepted #227 direction.
- [Historical engineering evidence](learning-historical-evidence.md), including #251's discovery, original-source, field-disclosure and selected-population boundaries.
- [Review-scoped evidence and whole-work retrospectives](learning-evidence-and-review-scope.md) and the accepted [native evidence specification](learning-native-evidence-spec.md).
- [Stage 4 contract](learning-stage4-contract.md), [preparation](learning-stage4-preparation.md), [restricted execution lifecycle](learning-restricted-execution.md) and the [corrected S3 handoff](https://github.com/bateau84/loom/blob/bffcf4d1bf5a409395c4c3e33b38182a6d178d7d/docs/learning-evaluator-s3-handoff.md).

Earlier proposed labels in individual BR/QS/OC files are historical; the native
specification records their acceptance as the existing implementation baseline.
This design refines that architecture. It does not replace its review mandate,
source, recipient, retention or execution guarantees.

## Product meaning and experience

The four views answer different questions over the same evidence:

| View | Question | First increment and boundary |
| --- | --- | --- |
| Intent and overview | What was intended, and which branches deserve investigation? | Explicit Action intent where authorized; current intended Plan separately from historical work groups; recorded outcomes, concerns and failures; visible missing coverage. Original user conversations are not reconstructed from an Action title. |
| Execution and decisions | What happened in the selected work? | Historical Plan ancestry and WorkRefs; recorded Session/message groups; qualified chronological groups; captured tool, attribution, agent-context and skill-load metadata. A Session or chronology group is not a dispatch or execution attempt. Missing source content and invocation ownership remain unknown. |
| Assessment and outcome | What was reported, challenged or checked? | Authored result, assessment, QA and concern records, with their exact source references and qualifications. Deterministic aggregation does not establish resolution, diagnosis, causation or independent acceptance. |
| Exact originals | What supports the observation or claim? | Exact permitted Loom records through #251; other original owners remain explicit dependencies. Consumers may follow an original reference directly without traversing every layer. |

A human starts with the intent and coverage banner, then sees significant
branches and the historical/current Plan distinction. Native disclosure controls
expand included details. A selected branch shows its recorded evidence and exact
follow-up requests. The dashboard uses native keyboard-operable links and
disclosure controls, visible focus, text qualifications and responsive layout.
Status meaning cannot rely on color alone.

An agent receives the same identifiers, groups, totals, relationships and coverage
in structured form. Markdown presents the same navigable read as a document, not
a separate narrative summary. Ranking identifies kinds worth inspecting; it
does not grade the engineering or infer success from prose. If a question is
already known, discovery can begin with that question's terms and categories
without first paging through the ranked overview.

The restore-freshness reference trajectory illustrates the distinction. An
initial failed run, unchanged-code rerun, corrected revision and partial recheck
must remain separate records. Their sequence does not prove that the rerun
verified the correction or that a plausible explanation was the root cause.
The operator's private originals are not part of the development fixture.

## Shared owner and data flow

The existing Store and SQLite database continue to own Actions, Plans and ledger
records. A single read-only projector owns grouping and navigation semantics.
The plugin owns actual caller identity, location checks and authorization. The
JSON, document and dashboard renderers own presentation only.

1. Validate the explicit Action or Session scope and requested format.
2. Assert discovery, inspection and disclosure for the derived scope. Use a
   metadata-only source membership query solely to determine the required
   permission resources, then assert history inspection/disclosure for every
   contributing ledger Session before building any returned aggregate or preview.
3. Read one bounded, synchronous Store transaction. Obtain complete authorized
   scope aggregates, build historical/observed navigation memberships, and apply
   requested selectors before paging matching records or branches. Preserve
   omission and unavailable-source information.
4. Render the chosen representation, enforce the response bound and recheck the
   applicable source/location boundary and contributing Session membership.
5. Assert the full resource union against the exact final serialized view. No
   later asynchronous lookup or transformation may precede return.

The shared model does not query OpenCode's private database or copy transcripts.
Existing #251 readers, historical WorkRef resolution, review records,
ObjectiveIndex and evaluation preparation remain their own authoritative owners.
Later integration must reuse those owners rather than introduce parallel links
that silently disagree with them.

## Historical structure and identity

### Planned work

An established historical WorkRef contains the original Action revision, Plan
revision, node ID and contract hash. Resolve that exact definition through the
existing Collaboration owner. Never relabel earlier work using today's Plan.
Navigate from the recorded historical revision through its saved ancestor nodes
to exact WorkRef leaves. Each container has a usable expansion request, immediate
children and parent references; historical ancestry is not only a breadcrumb.
The current Plan is a separately labelled intended-work view; its status and
structure do not prove execution or verification.

Plan nodes in an overview are compact identity/title projections with explicit
returned/omitted counts. Historical node labels are likewise compact, and remain
bound to their exact recorded WorkRef. Contract content, dependencies and criteria
are not silently presented as included. The existing Plan reader retains its
legacy scope semantics; the new history permission checks do not retrofit every
pre-existing API with source-specific policy enforcement.

A record with only `node_id` has a recorded association but no established
historical Plan binding. Keep that group qualified. Removed nodes and work
outside the Plan remain navigable. An unavailable historical definition is a gap,
not permission to substitute another revision.

Ordinary authored records retain a subject fingerprint without necessarily
retaining a WorkRef. Connect these to observations with the same captured
fingerprint, Action and node using qualified related-branch references. A subject
fingerprint intentionally ignores unrelated Plan changes; identical fingerprints
can therefore span several Plan revisions. The association never establishes an
exact historical revision, dispatch, invocation, causal link or verification.
WorkRef contract hashes and subject fingerprints are different identities.

### Work without a Plan

Use recorded Sessions as containers. Where captured native message IDs exist,
their observations form observed message groups; captured start/finish references
retain their actual pairing. Records without message identity can form
chronological segments anchored by material authored records such as concerns,
results, assessments, questions or reopens. These are labelled analytical
chronology, with source-derived labels and sequence bounds. They are not fixed
record-page buckets, inferred attempts or causal phases.

Do not invent a Plan, assignment, invocation or objective from proximity,
titles, role names or matching artifact revisions. A reused Session can contain
several observed groups without asserting that they are separate dispatches.
Source-established invocations can be added later without changing this meaning.

### Selective discovery

The existing `read` operation accepts conjunctive selectors:

| Selector | Meaning and boundary |
| --- | --- |
| `match` | Literal ASCII-case-insensitive substring, 1–200 characters, over supported authored prose and captured observation metadata. It is not SQL wildcard, regular-expression or semantic matching. |
| `record_kinds` | Nonempty unique list of supported ledger kinds, evaluated before paging. |
| `verdict` | Captured authored `pass`, `fail` or `inconclusive`; no inferred sentiment or outcome. |
| `source_session_id`, `node_id` | Exact recorded source/association within the requested scope. These filters grant no source authority. |
| `plan_revision` | Positive exact Plan revision on established WorkRefs. A matching fingerprint does not make an unversioned report eligible. |
| `has_gaps` | Select records with or without known captured attribution/scope gaps. Absence of a recorded gap is not complete native coverage. |

Selectors inspect the eligible history before applying result limits. An older
matching failure can be discovered even when newer unrelated failures displace
it from every overview highlight. Many matching results still require bounded
pagination; this is selective retrieval, not a promise that every investigation
fits in one call. Matching counts, global scope totals and omitted rows/children
are distinct. A focused branch read omits unrelated global ranked branches and
the current intended Plan while retaining its relevant ancestry and associations.
Filtered branch reads list matching leaves, which can be deeper descendants of
the selected group. Their recorded parents remain explicit; expanding a match
recovers its complete historical path. Ordinary branch reads return immediate
children. Related fingerprint groups have their own included and omitted counts.

The scope is bounded at 100,000 ledger records and 64 MiB of stored record bodies;
the returned representation is bounded at 262,144 UTF-8 bytes. Oversized scopes
fail with an explicit boundary rather than silently sampling eligible history.
Compact metadata supplies tree memberships; only selected source bodies are
hydrated for projection. Exact historical definitions have their own cumulative
64 MiB hydration budget and are reused within a read after each WorkRef is
validated. There is no new capture, index lifecycle or cross-read cache.

### Stable references and live changes

Navigation references bind the representation version, source-store identity,
explicit authorized scope and exact group identity. A reference is checked
against the selected scope; it never grants access. Referenced identities are
encoded as data and cannot alias resource separators or HTML attributes.

An inclusive ledger sequence bound can hold append membership steady across
reads. It is not an immutable retrospective population: Action/Plan state and
external sources have separate versions and availability. The response therefore
identifies a live read and its observed boundary. Appended work requires refresh;
changed or unavailable source definitions retain their qualifications.

Branch traversal has its own bounded continuation, including a selected
container's children. Record continuation applies to selected branches and
discovery results. Preserve the returned selectors and ledger boundary across
continuations; the boundary does not pin current intended Plan or Action content.
The page limit controls records and branches. Representative highlights,
relationship fanout and compact intended Plan nodes have separate fixed bounds,
so reducing a record page does not silently remove all other analytical context.
`coverage.page_limit` and returned expansion requests retain the chosen page
size. Dense rendered views can exceed the byte ceiling at the default page
size; the read fails explicitly and the caller can request a smaller page.

The source store's opaque identity must accompany navigation. A matching Session
ID or record string from another store is not a common source identity.

## Evidence meaning and relationships

Keep three classes explicit: recorded observations, authored claims/relationships
and analytical interpretations. Every returned record retains its author,
identity, recorded time and available source/version basis. A tool event count is
a count of captured records under a named scope, not a count of all native
operations. Starts and finishes cannot be counted as two independent executions.
Unobserved measurements are unknown, not zero.

Project material metadata already captured by the Observer: attribution reason,
capture-gap flag, established/unscoped/unknown/ambiguous work scope, message/call
and start-record references, agent-context source and content hashes, and
skill-load content hashes and recorded qualifications. Bounded excerpts and
omissions remain explicit. Unsupported metadata cannot become trusted scope.
Significant captured attribution gaps have their own representative overview
lane and are discoverable with `has_gaps`.

An unpaired finish deliberately has no Action attribution. It is visible in its
eligible Session scope, not pulled into an Action merely because that Session
also contributed Action records. Ambiguous candidates and referenced records
outside the authorized scope are not disclosed through provenance metadata.
Agent snapshots describe observed context after Loom's processing; they do not
prove the final provider input. Skill-load hashes do not prove the agent read or
applied the skill.

Authored `evidence_ids` establish citations to existing scoped observation
records. They do not establish causation, a finding's resolution or a review's
complete coverage. Typed question/answer references preserve their existing
meaning. Omitted and unresolved references remain qualified; do not fetch or expose
a different scope merely because a record names it.

Existing review relationships and ObjectiveIndex links have their own authority:
an authored objective is interpretation, and a review's requested, supplied,
retrieved, cited and claimed-inspected evidence are different. The initial ledger
projection must identify missing integration rather than flatten these records
into fabricated correction/verification links. Their later inclusion requires
the existing authorized readers and exact source identities.

Representative selection must not let abundant observations displace all
assessments or concerns. Complete authorized totals are distinct from the bounded
records shown. A concern is a recorded concern; without resolution evidence it
is not automatically an unresolved defect. A PASS, completed Plan node or handback
is still an authored claim unless the original evidence separately establishes
the relevant verification and coverage.

## Authorization and trust

The derived view has a distinct `engineering-history` inspection/disclosure
resource under #251's native permission grammar. A metadata-only record grant
does not authorize history excerpts, labels, group counts, edges or HTML. The
caller comes from native tool context, never an input recipient parameter.
All identity components use the same URI encoding as #251.

An Action-level history grant is not enough to override a source Session denial.
The plugin determines contributing ledger Sessions with a metadata-only query
used for authorization, requires history inspection/disclosure for each of them
before constructing the projection, and includes the entire union in its final
assertion. It rechecks membership before release so a new constituent cannot
silently enter under the old resource union. A denied constituent fails the whole
view without leaking through totals, ranking, cursors or a different format.
Discovery filters do not narrow this permission union: even a nonmatching
contributor's denial withholds the entire requested Action view.
Session-scoped reads do not hydrate linked Action titles or Plans without Action
authority.

The caller and an explicitly requested Session scope retain native location
checks. Old ledger contributors need not still exist as live native Sessions:
their stored source identities are authorization resources, not claims of current
native existence. Their inclusion grants no access to their native originals.

The final assertion covers the **actual returned representation**, including
Markdown or HTML and diagnostics. Denial fails the operation without a partial
success-shaped overview. Source/caller location is rechecked before release;
continuations and refreshes reauthorize. Renderers do not resolve sources or
perform network operations.

The dashboard treats stored prose, identifiers, tool requests and URLs as
untrusted data. Escape text and attribute contexts, use native controls, and do
not turn source text into executable script or arbitrary external navigation.
Opening a generated file does not obtain a native Session's source rights.

Pinned OpenCode's permission observation is still not an atomic concurrent
revocation/source-release fence. This increment preserves #251's blocked raw
cross-Session/native-export release and the Stage 4 protected-transfer limits.
The HTML, digest or navigation reference cannot cure that missing host boundary.

## Alternatives and consequences

| Option | Mechanism, benefit and cost | Failure boundary and decision |
| --- | --- | --- |
| Separate agent and dashboard assembly | Each client enumerates existing record pages and assembles its own groups. No new Store reader, but duplicated scope, version and coverage logic and repeated investigation work. | Independent clients can disagree or accidentally infer membership; broad traversal remains the normal entry path. Rejected for the accepted shared-representation requirement. |
| Shared on-demand Store projection | Indexed scope aggregates and bounded representative rows, with one grouping model and existing historical readers. Adds one public authorized read seam and small presentation adapters. | Must bound queries, preserve omissions and authorize derived metadata. Selected as the smallest realization that provides useful navigation without new truth or lifecycle state. |
| Persisted history graph or summary service | Materialize groups/edges and maintain them as records arrive; can support later expensive cross-source queries. Requires synchronization, rebuild/version policy, retention and authorization propagation. | Stale or partially rebuilt summaries can become a competing truth; migration and recovery cost is not justified by current evidence. Defer unless measured Store reads or new accepted queries require it. |

The beneficiaries are investigators and users who currently reconstruct the
same work repeatedly. The new burden is maintaining a shared, truthful projection
and making bounded coverage understandable. A polished dashboard increases the
risk of mistaking reported completion for accepted delivery; explicit wording,
source links and negative tests address that risk. It grants no automatic
Evaluator authority, spending, retention expansion or right to rank people.
Users retain source inspection and interpretation; agents retain substantive
judgment. Longitudinal evaluation may reuse these references only after its own
population and source-authority obligations are met.

## Verification and delivery obligations

| Obligation | Owner and falsification point | Delivery boundary |
| --- | --- | --- |
| BR-010, QS-006: useful overview and selective expansion | Registered tools against competing concerns/failures in planned and unplanned histories; the older target is outside the initial overview. Start with question terms, navigate ancestry, retrieve exact originals and compare with competent #251 filters. | Scripted mechanics establish selective retrieval, not unfamiliar-agent comprehension or universal efficiency gains. |
| BR-001, OC-001, QS-001: attribution | Store projection preserves recorded Session, observation and WorkRef identities; no inference of invocation from Session grouping. | Existing capture reused; missing native invocation ownership remains a gap. |
| BR-002: historical definitions | Change Plan/Action after captured work, remove a node, then expand historical work and unversioned/no-Plan groups. | No current-Plan substitution; missing historical definitions remain visible. |
| BR-004, BR-005: original claims and qualified outcomes | Include initial failure, unchanged rerun, corrected head, partial recheck, conflicting assessments and missing originals. | No aggregate verified-success or proven-cause promotion. Review/ObjectiveIndex integration remains separately scoped. |
| OC-003, QS-004: protected derived views | Deny discovery, inspection or disclosure; test another recipient, scope mismatch, source movement and final denial for every format. Inspect entire serialized responses, not only record bodies. | Same qualified native permission observation as #251; no claim of atomic protected transfer. |
| BR-010: shared accessible dashboard | Compare rendered source IDs, group requests, relationships and coverage with JSON. Real Chromium CI exercises keyboard disclosure, internal references, dense histories, narrow viewport, focus, inert hostile content and automated accessibility checks. | Automated browser checks are not a manual screen-reader usability audit. Further loading/refresh remains a new authorized tool read. |
| BR-008 and selected-population contract | Verify live markers and sequence boundaries; add records after a read and show that no frozen manifest was created or changed. | Retrospective preview/freeze explicitly deferred to existing evaluation/source owners. |
| Preservation | Run applicable existing Store, registered-tool, build, dashboard and installed-host checks; compare source and evaluation state before/after navigation. | No source mutation, Stage 3 change, Evaluator dispatch or new raw capture. |

The PR's exact revision and receipts are the authority for executed checks. This
design and its proposed scenarios do not themselves prove test or installed-host
success. Preserve failed checks and qualification limitations in that delivery
record rather than converting the initial increment into full #227 acceptance.

The original 776-record measurement compared exhaustive old pagination with a
favorable history path. It is not evidence of an improvement over #251: a concern
filter followed by a source-Session query retrieves the same two records in two
calls. Qualification retains that counterexample and adds competing-finding
scenarios, actual returned bytes, local elapsed time and repeated projection
reads. No latency improvement, model-token savings or unfamiliar-agent
comprehension is inferred from those scripted measurements. Measure repeated
whole-scope assembly before considering caching or another persistence owner.

## Navigation, selection and freezing

Navigation proposes source identities worth inspecting. A later selected-
population preview must resolve exact membership, source versions, permitted
views, membership basis and known gaps. Freeze must preserve that exact approved
population through the existing evaluation/preparation owners. Appending new
records must not change it.

Do not filter an already frozen complete Stage 3 batch or reinterpret its
manifest as a selected objective. Manual selection may qualify the initial
retrospective, but recurring manual export/assembly cannot be the normal
automatic-learning path. Successful navigation, selection or freezing never
authorizes provider transfer or execution.

## Remaining owner boundaries

- OpenCode owns a supported complete-history reader, original native
  assignments/message parts and current recipient-specific protected release.
- Existing review and ObjectiveIndex owners retain exact mandates, typed
  correction/recheck relationships and authored objective membership; later
  navigation integration must preserve their permissions and qualifications.
- Existing Git/CI integrations own original pinned object/run/attempt/job/artifact
  resolution. A reference here is neither retrieval nor verification.
- EvaluationStore and preparation/source owners own a distinct frozen selected
  population. Stage 3 complete-batch and #249 execution contracts remain intact.
- Operator-local qualification owns the private #182/#187 originals and
  reconciliation of the differing previously reported five-record selections.

These dependencies remain open under #227. They do not prevent the independent
utility of a truthful, authorized map of the ledger already available today.
