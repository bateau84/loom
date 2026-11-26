---
type: Architecture
title: "Connected engineering trajectories"
description: "Qualified relationships composed from existing source owners, with bounded navigation and independent append fences."
tags: [loom, learning, history, evidence, authorization]
timestamp: 2026-11-26T00:00:00Z
---

# Connected engineering trajectories

## Decision and product boundary

Extend [layered engineering history](learning-engineering-history.md) after
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
| Historical assignment/completion | An explicit saved assignment reference, worker identity and identical historical WorkRef. It remains an authored completion without fabricated native dispatch provenance. |
| Review mandate and members | Exactly the frozen requested scope, historical WorkRefs, producing attempts, artifacts, inclusions and exclusions. |
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
review mandate remains separate from the selected observed/authored basis;
omitted relationship details are counted, with the existing owner reader shown.
Every original retains its source identity, digest and exact record query.

`navigation.repeat`, `navigation.next_records` and
`navigation.next_branches` are complete query objects. Add `operation:"read"`;
do not reconstruct selectors from prose. JSON, Markdown and HTML contain the
same requests and qualifications. HTML remains an inert authorized document:
native disclosure controls expand included content; additional reads require the
shown tool request.

For objective roots, the Store follows forward original-evidence citations and
recorded start/question/progress references under the original source scope.
It does not enumerate the contributing Sessions or follow arbitrary reverse
citations. Reached observations are **supporting originals**, not newly inferred
objective members. A historical WorkRef remains exact, while Action/Plan content
requires its separate Action-scoped read.

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
explicit restart. These fields are not permission receipts. An append fence is
not an atomic cross-store snapshot, an immutable retrospective population or an
authorization to send evidence to another Session/provider.

The existing resource ceilings remain: 100,000 ledger records, 64 MiB source
bodies and 262,144 returned UTF-8 bytes. Owner snapshots and traversal also have
bounded counts/bytes. Limits fail explicitly; clients do not receive a silently
successful partial traversal. Pages bound returned records/groups, and omitted
owner detail remains qualified. A smaller scope or the original owner reader is
available when a legal source is too large for a compact history response.

## Frozen retrospective populations remain separate

A future selected-population preview must resolve the chosen source identities,
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

### Executed controlled qualification, 2026-11-26

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
by the measurement harness. The reproducible command is in [testing](testing.md).

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
body hydration before denial. No material review finding remained open on the
checked implementation hashes.

The assembled local gates passed: **438 core tests, 844 native tests, 297 Python
tests**, project typecheck and the production module build. The native suite
includes the legacy complete Stage 3 batch/hash preservation regression. A
separate registered no-Plan fixture selected seven authored originals and two
artifact-scoped reviews, retaining exact continuation and renderings. The
installed OpenCode and Chromium workflows provide separate, revision-specific
execution receipts in the delivery PR; source checks and registered simulated
callbacks do not substitute for those runs. The large controlled comparison is
planned work; the no-Plan probes qualify the owner composition without claiming
an equivalent large planned/unplanned benchmark.
