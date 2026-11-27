---
type: Architectural Design
title: "Connected engineering trajectories"
description: "Qualified relationships composed from existing source owners, with bounded navigation and independent append fences."
tags: [loom, learning, history, evidence, authorization]
timestamp: 2026-11-27T00:00:00Z
---

# Connected engineering trajectories

## Decision and product boundary

Extend [layered engineering history](ard-008-learning-engineering-history.md) after
merged #252 and #253 with connected evidence groups. An investigator can discover
a relevant finding, follow its returned trajectory request, inspect the related
correction and review scope, and retrieve the original records. This is an
increment of [#227](https://github.com/bateau84/loom/issues/227), not acceptance of
the full Evaluator capability.

The implementation composes bounded snapshots from **ObjectiveIndex**, the
existing **ReviewRequests** owner and the **Store/Observer** ledger. The transient
adjacency used for traversal is rebuilt for the authorized read. It is not
persisted, independently authored or a second graph/evidence store. All three
presentations consume this same representation.

Independent architectural assessment selected this composition and rejected a
persisted navigation graph. It also identified the requester-only review ACL,
the distinction between association corrections and interpretation changes, and
the need for separate owner append fences. Those constraints apply below.

## Relationship meaning

| Source relationship | Meaning retained by history |
| --- | --- |
| Objective source link | An attributed association with a phase, source verification, confidence and recorded time. It is not independently established objective membership. |
| Typed objective relation | The author asserts `supports`, `contradicts`, `addresses`, `assesses`, `supersedes` or `contests` between two original ledger sources. Confidence remains separate. |
| Objective `link-correction` | A sourced confirm/reject judgment about an objective association. It does not revise the truth of the underlying diagnosis. |
| Observer start/finish | The recorded association and its pairing qualification. It does not establish objective membership or engineering success. |
| Authored `evidence_ids` | Citations to original scoped observations. They retain the existing restricted evidence contract. |
| Historical assignment/completion/question | An explicit saved reference, exact assignment/question identity, worker Session and checked historical WorkRef. Assignment identity must be unique inside the original source scope and append boundary. It remains authored association without fabricated native dispatch provenance. |
| Review mandate and members | Exactly the frozen requested scope, historical WorkRefs, producing attempts, artifacts, inclusions and exclusions. |
| Requested work and prior review | Exact frozen constituent WorkRefs can connect to existing original records; explicit prior-review membership connects mandates in either direction. Requested membership does not establish an attempt or inspection. Current Plan descendants and matching revisions alone add no membership. |
| Review source relationship | Its original attribution: qualified retrieval receipts differ from authored observed/cited/claimed-inspected/finding relationships. Native review binding remains unknown. |
| Review correction | A sourced correction to the exact earlier review relationship. The original record and membership remain unchanged. |
| Requested recheck | The later mandate names an earlier finding/correction. It does not establish what the later reviewer actually inspected or resolved. |
| Source reference | A location and version for a separately authorized read. It grants no source release or execution authority. |

Traversal follows these explicit relationships in both directions. Connection
means the records are relevant to inspect together, not that the earlier event
caused the later one. Shared text, revision, timestamps, WorkRef fingerprints and
Session parentage do not create trajectory edges. Existing structural history
still shows its qualified fingerprint associations separately.

Rejected and candidate interpretations remain inspectable. A typed `supersedes`
association supplies the author's explicit interpretation change; it does not
erase the earlier claim or promote the later claim to a proved conclusion.
Absent structured relationships remain unknown.

## Retrospective and ordinary capture

The existing optional `loom_objective link` operation accepts a `relation` for
two distinct resolved ledger sources. Its target is an earlier link in the same
objective (`related_sequence`). Unsupported meanings, self references, source
cycles and incompatible idempotent replays are rejected. The relation is stored
with the source, author, confidence and note in the existing append-only owner.
Existing rows retain null/absent semantics; prose is not retroactively parsed
into stronger assertions.

There is no required registration stage. Ordinary observations, evidence
citations, review members, source returns, finding/correction relationships,
rechecks and question/progress references already carry useful structure. The
projection consumes those existing events. An author may add a retrospective
association where useful, without changing the historical record or claiming a
backdated native invocation. Historical assessments without a frozen review
manifest stay attributed original records; they are not converted into invented
historical review membership.

The additive nullable relationship column must not invalidate older evaluation
sources. The existing learning source owner omits null/undefined `relation` from
legacy objective-link source serialization, preserving the original bytes and
hashes. Non-null new relations participate in their own source identity. No
Stage 3 batch is filtered, reordered, reinterpreted or replaced.

## Navigation contract

`loom_history read` accepts exactly one root: `action_id`, `session_id` or
`objective_id`. Action and Session roots retain existing discovery and structural
branch behavior. An objective root projects its explicitly linked sources and
their original evidence.

After discovery, use `record.trajectory` with `operation:"read"`, or request an
exact `record_id` with `related:true`. This switches from literal discovery to
connected scope. It deliberately does not retain the original search terms:
the correction and review may use different language. Scope, ledger boundary,
owner boundaries and page limit remain in the returned request.

```json
{"operation":"read","action_id":"ACTION_ID","match":"restore freshness"}
```

```json
{"operation":"read","action_id":"ACTION_ID","record_id":"DISCOVERED_RECORD_ID","related":true}
```

The first request is a seed search, not semantic evidence. Prefer copying the
returned `trajectory` to manually constructing the second request, because the
returned form also preserves the observed boundaries.

Trajectory pages return chronological original-record projections, connected
objective/review groups and relevant qualified edges. They omit global
highlights, unrelated branch inventories and the current Plan. The exact frozen
review mandate remains separate from the selected observed/authored basis.
Every original retains its source identity, digest, exact record query and
source-specific unresolved or omitted-reference qualifications.

Copy the returned query and add `operation:"read"`; do not reconstruct selectors
from prose or edit an opaque `connection_cursor`.

| Returned request | Bounded population |
| --- | --- |
| `navigation.repeat` | Replay the same page. |
| `navigation.next_records` / `navigation.next_branches` | Remaining selected originals or structural branches. |
| `navigation.next_connections` | Remaining objective/review groups; on an owner-detail page, the remaining details for that owner. |
| `navigation.next_relationships` | Remaining qualified graph edges, without repeating those returned on the initial page. |
| Objective/review `details` | Start the complete authorized association/relationship population for that owner, independently of group discovery. |

Connection pages retain the original source references and a
`connections.context.read` query. They return no record bodies, highlights,
branch inventory or global Plan. JSON, Markdown and HTML contain the same
requests and qualifications. HTML remains an inert authorized document: native
disclosure controls expand included content; additional reads require the shown
tool request. The original source owners remain available through each group's
separate `source.query`.

An unfiltered Action overview also discovers caller-owned pending review
mandates admitted through their exact frozen requested Action scope, even when
no eligible ledger record yet carries that work. This adds no record or
trajectory edge and proves no execution or inspection. Record, trajectory,
branch and discovery reads retain their explicit relationship selection; they
do not inherit unrelated Action mandates.

For objective roots, the Store follows forward original-evidence citations and
recorded start/question/progress/assignment references under the original source
scope. Ordinary and trajectory reads use the same checked source resolver.
It does not enumerate the contributing Sessions or follow arbitrary reverse
citations. Reached records are **supporting originals**, not newly inferred
objective members. Historical assignment uniqueness is checked across the
original Action or unscoped Session at the ledger boundary, not just the linked
objective subset. Conflicting worker/assignment identities, inconsistent
row/WorkRef scope, invalid observation phases and unavailable originals retain
generic source-specific gaps without disclosing outside target identities.
Session roots never cross their source Session. A historical WorkRef remains
exact, while Action/Plan content requires its separate Action-scoped read.

## Authorization and stable continuation

The plugin obtains the actual caller from the native invocation. It first checks
discovery/inspection/disclosure for the requested history scope and the existing
source-file read permissions. Metadata-only preflight finds source contributors,
objective creators and association authors before their labels, notes or
aggregates are projected. The complete contributor union is authorized even
when a lexical filter hides the contributor's records. Source and owner checks
are repeated before final disclosure; all three formats bind the exact returned
bytes to the final assertion.

Review ownership does not change. Only the actual requesting Session can see its
applicable private manifests. Another Session's reviews are not exposed through
IDs, labels or counts. Evaluator-preparation requests are excluded from this
reader rather than bypassing preparation validation. A manifest whose scope
cannot be shown coherently within the selected source scope is omitted whole;
the view supplies a generic coverage limitation without inventing a complete
filtered mandate.

Owner selection follows explicit prior-review and requested-recheck dependencies
in both directions. Every concrete work, attempt, evidence and recheck target
still has to fit the authorized scope. If a dependency is withheld, its dependent
manifest is withheld whole, and disconnected prior-only context is pruned.
Reserved preparation requests never become ordinary history through a dependency.

There are separate live append fences:

| Field | Owner and purpose |
| --- | --- |
| `through` | Store ledger sequence, inclusive. |
| `owner_boundary.objective_links` | ObjectiveIndex insertion high-water mark, or null when that owner is unavailable. |
| `owner_boundary.review_requests` | Eligible caller-owned nonprepared request insertion boundary. |
| `owner_boundary.review_relationships` | Eligible caller-owned relationship sequence boundary. |
| `owner_version` | Digest of the bounded owner representations and namespace/scope; detects changed sources during continuation. |

New associations or review corrections do not enter an earlier continuation.
Changed or unavailable bounded owner sources cause a failed read requiring an
explicit restart. A connection cursor binds its page to the Store, normalized
original query, selected source identities, ledger/owner fences and owner version.
Changing a selector or page size requires a new initial read, not reusing that
cursor. Current source and final disclosure authorization run on every page.
These fields are not permission receipts. An append fence is
not an atomic cross-store snapshot, an immutable retrospective population or an
authorization to send evidence to another Session/provider.

The existing resource ceilings remain: 100,000 ledger records, 64 MiB source
bodies and 262,144 returned UTF-8 bytes. Owner snapshots and traversal also have
bounded counts/bytes. Limits fail explicitly; clients do not receive a silently
successful partial traversal. Pages bound returned records/groups, and omitted
owner detail remains qualified. A smaller scope or the original owner reader is
available when a legal source is too large for a compact history response.
Pagination never splits a frozen requested mandate into a misleading partial
scope. A single valid mandate can therefore still exceed the history response
ceiling at `limit:1`; that case fails explicitly and needs the existing owner
reader. Review content digests use the existing bounded owner hash budget so a
large relationship set can be paged without first hitting an unrelated generic
hash budget.

## Frozen retrospective populations remain separate

The [selected-population design](ard-010-learning-retrospective-populations.md) follows
this navigation increment. Its preview must resolve the chosen source identities,
versions, membership basis, permitted views and gaps again under their owners.
The EvaluationStore/preparation owner must freeze that exact authorized set.
Neither a trajectory request nor `owner_version` is such a manifest. Existing
complete Stage 3 batches and #249 claims/reservations/execution safeguards remain
unchanged. Production Evaluator dispatch is still disconnected.

## Qualification and remaining dependencies

The controlled equivalent preserves the #182/#187 distinctions: initial failed
attempt, unchanged-code rerun, plausible unproved historical cause, test-only
correction on another revision, scoped verification, merge, and separate release
acceptance. Different vocabulary, unrelated same-revision work, other private
reviews, later association appends and exact historical WorkRefs challenge
selection and disclosure. The investigator begins with only the Action and
engineering question. Tests use actual registered callbacks with a simulated
native host; installed-host and real-browser checks are separate evidence.

Compare equivalent information needs against competent baseline usage of
history selectors, ObjectiveIndex find/read, requester-owned review reads and
exact original retrieval. Report actual tool calls, returned UTF-8 bytes,
selection correctness, remaining manual joins and local elapsed time. Response
bytes are not tokens; fewer calls do not imply lower byte volume or latency.

The operator reported 16 selector calls and 570,321 response bytes in a private
large Action at merged #252. Those observations are not independently reproduced
here, do not measure tokens and do not establish that every exploratory call was
unavoidable. Private originals stay with the operator. The actual case still
needs operator-local qualification using the supported readers.

Full native historical originals, protected cross-Session release, pinned Git/CI
retrieval, immutable selected populations and genuine Evaluator reasoning remain
with their existing owners and prerequisites. No new raw capture, production
Evaluator execution or automatic instruction changes are introduced. #227 stays
open; merging this increment requires separate authorization.

### Remediation qualification, 2026-11-26

The external review identified four concrete navigation defects. The remediation
uses one checked original-reference resolver across roots, admits explicit
review dependencies and frozen requested work through their existing owner,
provides independent bounded group/edge/detail continuation, and retains each
record's unresolved and omitted-reference qualifications.

Independent follow-up review ran **53 tests / 1,737 assertions** and additional
counterexample probes. It cleared F01–F04 within the existing resource limits.
The probes included 12-group and 12-edge complete traversal, 18 cursor
rebinding/authorization rejections, mixed-scope dependency pruning, frozen
constituents after a Plan change, pending requested work without ledger evidence,
and 1,800 review relationships exhausted in 18 detail pages. Six production/help
file hashes remained unchanged through the review. A valid 289,188-byte complete
mandate still rejects at the history response ceiling; the owner read succeeds.
This is an explicit bounded failure, not a silently incomplete mandate.

The assembled local gates passed **438 core tests, 862 native tests and 304
Python tests**, project and qualification typechecks, and the production build.
The complete Stage 3 batch/hash and historical source preservation checks remain
in those gates. Hosted installed-native and Chromium receipts are revision-bound
in the draft delivery PR; local source/render checks do not replace them.

The first hosted run at `0ba5de7` passed the new seven-review continuation and
source-denial checks, then exposed a qualification-harness variable collision:
owner pages replaced saved native-child cursor pages before a later denial test.
The follow-up isolates owner traversal and retains the original native cursor,
source-integrity and no-Evaluator-effect checks. Its regression covers an empty
final owner chain, exact returned requests and the existing termination bound.
That failed run is not a successful installed-history receipt; the corrected
harness requires a complete new hosted run. Production source hashes did not
change in this follow-up.

#### Dense unplanned history and overlap

The new no-Plan fixture contains 24,000 records, 600 surrounding connected
evidence groups, 16 reused Sessions, three overlapping objectives, 24 review
mandates and 72 review relationships. Exhaustive bounded traversal discovers all
24 reviews and all 72 relationships without losing identities across their
respective continuation chains. It retains source bytes and excludes a later
association from already-issued cursors. JSON, Markdown and HTML agree.

Shared evidence has a measurable relevance cost: the Action trajectory contains
**260 records: 20 core reference originals plus 240 connected surrounding
records**. The objective-root source selection contains **26**. Neither count
makes every connected record relevant to the engineering question. Choosing a
narrower objective is an explicit source selection, not inferred relevance or an
automatic permission expansion.

The exhaustive qualification made **68 structured reads / 2,023,764 returned
UTF-8 bytes**, including 26 record pages, eight additional group pages, two edge
pages and 29 owner-detail pages. Three separate rendering checks returned
96,044 bytes. Local structured callback time was 62,787.04 ms. This is an
exhaustiveness/authorization exercise with repeated qualified scopes, not an
optimized investigator benchmark or production latency claim.

The equivalent-information planned comparison was rerun against exact main
`d0ff85ee09e5209058206a594f44338e088f3c10` over the same seeded stores. Both paths
retrieved the same 20 exact originals and applicable objective/review evidence:

| Route | Read calls | Returned UTF-8 bytes | Local callback time |
| --- | ---: | ---: | ---: |
| Remediated connected trajectory | 6 | 159,631 | 1,553.71 ms |
| Competent existing main tools | 9 | 52,489 | 422.90 ms |

Associations were held constant for this comparison. It still shows a call-count
reduction with higher response volume and local callback cost; it does not
measure the effort of creating absent associations.

#### Sparse discovery, authoring and a second fresh reader

A separate 24,000-record unplanned case began with **zero objective and review
associations**. The first investigator received only the Action, engineering
question and public registered-tool interface. Its initial concern trajectory
stopped at one record. It reconstructed the sequence with additional vocabulary,
kind and source queries and manual comparison of issue, revision and artifact
prose. It rejected an explicitly unrelated formatter result. Three searches
returned no matches; one broad observation page returned ten exporter distractors.

Before any writes, it supplied its provisional reconstruction. It then created
one attributed retrospective objective and 11 links through existing operations.
Three relations express authored `addresses`, `assesses` and `supersedes`;
the uncited initial CI and retry observations remain **uncertain candidates**.
Their labels/proximity do not establish the asserted test result, cause,
dispatch or review membership. No historical review manifest was invented.
One create request was rejected because a ledger source incorrectly supplied a
Session qualifier; the corrected request succeeded. There were no evidence
reads during authoring.

A second fresh investigator received only the same Action/question/interface,
without the first reader's IDs, notes or report. It used one lexical discovery
and three trajectory pages, then 14 exact original queries. It reconstructed the
seven required distinctions and retained the original cause, native review
binding and overall acceptance as unproved. It separated original observations,
original authored claims and the new retrospective interpretation.

| Measured phase | Registered calls | Returned UTF-8 bytes | Help/schema calls and bytes |
| --- | ---: | ---: | --- |
| Initial sparse discovery | 22 reads | 252,130 | 4 / 38,974 |
| Retrospective authoring | 13 writes: 12 succeeded, 1 rejected | 12,507 | 0 |
| Second fresh reader navigation | 18 reads | 132,702 | 2 / 30,496 |

Write requests added 7,288 UTF-8 bytes. Local callback times were 8,390.73 ms for
discovery, 24.22 ms for authoring and 4,342.50 ms for later navigation; model
reasoning, setup, transport and help are outside those callback times. These are
actual exploratory costs, not minimum call counts or statistically comparable
participant performance. The complete workflow includes the authoring cost;
post-association navigation alone is not a reconstruction benchmark.

The resulting trajectory selected **18 of the 20 controlled reference originals**.
It contained all ten authored records and four observation pairs. The first
investigator did not discover the uncited test-edit start/finish pair, so it was
not automatically recovered by later navigation. The second reader separately
retrieved ten authored originals and four finish observations; start records
were available in the shared projection. The required conceptual distinctions
were reconstructed, but this is not complete-original discovery. All 24,000
ledger originals were byte-identical afterward; disposable source state was
removed. Raw source/qualification hashes and exact requests/response hashes were
captured by the harness.

The private operator #182/#187 qualification remains **unperformed here**. Its
original discovery and association cost, protected original retrieval and actual
local usability remain separate dependencies. The existing tools now support a
truthful local rehearsal, documented in [testing](../../user-docs/testing.md), without exporting
private originals or enabling Evaluator execution.

### Initial controlled qualification at `1423b03`, 2026-11-26

These are the initial delivery measurements, before the external F01–F04/Q01–Q02
review. They remain historical evidence for that exact scope. They do not
qualify unregistered sparse history, dense unplanned owner fan-out or the
continuation corrections described above.

The scripted comparison loaded the candidate and exact main
`d0ff85ee09e5209058206a594f44338e088f3c10` callbacks over the **same seeded stores**.
Both routes retrieved the same 20 exact original ledger records, plus the
applicable objective/review information. Neither enumerated the whole Action.
Retrospective associations were held constant in both stores: this isolates
navigation and retrieval, not the old tools' ability to author the new typed
relation field or a claim that missing historical links repair themselves.
The baseline used the already competent route: a selective history query,
ObjectiveIndex find/read, four source-Session record queries and two original
review reads.

| Route | Registered read calls | Returned UTF-8 bytes | Local callback elapsed time |
| --- | ---: | ---: | ---: |
| Connected trajectory | 6 | 149,359 | 2,428.92 ms |
| Existing main tools | 9 | 52,489 | 448.64 ms |

This is a call-count reduction with a byte and local-latency cost. The connected
view returns relationship provenance, exact scopes and ready navigation; it
does not establish a byte-saving or speed-saving claim. Local timings exclude
fixture setup, model reasoning, host/network transport and production load.
The source and fixture hashes, exact requests and response hashes were captured
by the measurement harness. The reproducible command is in [testing](../../user-docs/testing.md).

A separate fresh agent received only the Action, question and public read-tool
interface. It did not inspect repository code, fixture/oracle files or SQL. It
found the initial concern with one literal query, followed two ten-record
trajectory pages and read the original source/review/objective owners. It
reconstructed all seven required distinctions, kept the historical cause
unproven and rejected promotion of the scoped pass into overall release
acceptance. It also distinguished an objective association rejection from proof
that the underlying diagnosis was false, and noted that the reported race-check
success lacked its own separate observation in the connected basis.

That investigation made **11 registered reads returning 253,353 UTF-8 bytes**,
including one repeated trajectory page after the execution display truncated a
combined response. Four help/schema reads returned another **54,565 bytes**.
These are the actual exploratory counts, not a minimum or an assertion that all
calls were unavoidable. Two failed localhost bootstrap attempts occurred before
any evidence read; a shared-file transport then invoked the same callbacks.
Transport overhead and help are reported separately from the registered-read
comparison. This was one controlled unfamiliar-agent run, not a statistical
study or a reproduction of the operator's private Action.

The investigator selected the 20 connected records and did not classify all
23,980 other records as irrelevant. It retrieved 19 distinct exact ledger
originals; the initial request was available in the history projection. Remaining
manual work was substantive evidence interpretation: establishing the actual
historical interleaving, retrieving original Git/CI contents, tying requested
review scope to native execution, and obtaining the outstanding release checks.
No further vocabulary searches were needed to connect the finding to its
correction and scoped review. The scripted same-information comparison above
separately verifies exact retrieval of all 20 originals by both tool routes.

Independent architecture assessment preceded implementation. A separate
implementation reviewer identified and independently rechecked fixes for
pending planned/unplanned recheck manifests, preflight metadata allocation and
observation-pairing consistency across expansion. Twelve contributor-denial
counterchecks covered original authors, correction authors, objective creators
and association authors across JSON, Markdown and HTML, with zero objective
body hydration before denial. The installed oracle additionally requires the
exact setup relationship receipts, so empty or substituted review evidence
cannot qualify from mandate checks alone. No material finding remained in that
initial independent review scope. The later external review identified missing
source closure, pending-review navigation, bounded continuation and source-gap
cases now covered by the remediation tests.

The assembled local gates passed: **438 core tests, 844 native tests, 299 Python
tests**, project typecheck and the production module build. The native suite
includes the legacy complete Stage 3 batch/hash preservation regression. A
separate registered no-Plan fixture selected seven authored originals and two
artifact-scoped reviews, retaining exact continuation and renderings. The
installed OpenCode and Chromium workflows provide separate, revision-specific
execution receipts in the delivery PR; source checks and registered simulated
callbacks do not substitute for those runs. That initial large comparison used
planned work; its small no-Plan probes did not establish an equivalent large
planned/unplanned benchmark.
