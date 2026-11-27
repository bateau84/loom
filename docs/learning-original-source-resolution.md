---
type: Architecture
title: "Original-source resolution for frozen retrospective populations"
description: "Bounded reads from existing native and GitHub source owners, with exact selected versions and truthful source gaps."
tags: [loom, learning, evidence, authorization, history]
timestamp: 2026-11-27T00:00:00Z
---

# Original-source resolution for frozen retrospective populations

## Decision and accepted scope

**Resolve permitted originals through their existing owners when a new
population is previewed, pin the selected source version and view when it is
frozen, and retrieve that exact view when the consumer follows its reference.**
EvaluationStore continues to retain the population manifest, not copies of the
original content. Store, ObjectiveIndex and ReviewRequests keep their existing
originals. OpenCode owns native messages and tool parts; GitHub owns the remote
Git and Actions objects consumed by the narrow external adapter.

For example, a frozen restore-freshness population can contain CI attempt 1's
failed job log, attempt 2's successful log on the same workflow head, the exact
test-correction file at another commit, and the existing attributed diagnosis
and review records. Reading attempt 1 must still return attempt 1 or a gap after
attempt 2 succeeds. None of these originals alone proves the historical watcher
ordering or overall release acceptance.

The operator selected this increment of [#227](https://github.com/bateau84/loom/issues/227)
after [#255](https://github.com/bateau84/loom/pull/255), merged at
`0c618ad417519fbc68bfe642662b23682eb6a63c`. The
[population contract](learning-retrospective-populations.md),
[historical-source boundary](learning-historical-evidence.md),
[connected-history contract](learning-connected-trajectories.md),
[native evidence specification](learning-native-evidence-spec.md),
[Stage 4 contract](learning-stage4-contract.md) and
[restricted execution safeguards](learning-restricted-execution.md) remain
controlling. The native specification carries forward the accepted BR/QS/OC
baseline despite historical proposed labels in the individual requirements.

This architecture describes the bounded realization and its required proof.
Implementation, test results and installed-host receipts are separate evidence.
It grants no production Evaluator execution, scheduling, raw-content capture,
cross-Session native disclosure or merge authority. The distinct retrospective
v2 preparation remains fenced from execution.

## Requirement coverage and owners

| Accepted obligation | Realization in this increment | Retained limit or owner dependency |
| --- | --- | --- |
| BR-005 and S4-05: originals or explicit source gaps | Awaited owner resolution; exact permitted content and source qualifications in `population-source` readback | A hash, locator, quoted revision or authored summary does not become original content. |
| BR-010 and QS-006: shared navigation to originals | Existing population members carry exact supported inspection requests; JSON, Markdown and HTML share the member projection | Retrieval does not infer new relationships or certify a complete native history. |
| OC-002: distinguish requested, retrieved and claimed-inspected | The frozen member states requested membership; a successful caller-bound source read states what that operation returned | It does not establish a particular admitted Evaluator invocation, final provider exposure or comprehension. |
| OC-003 and QS-004: source and derived-view authorization | Existing contributor/recipient checks plus source-specific inspection and disclosure checks; no new content store | The native permission observation is not an atomic revocation/source-release fence. |
| S4-08 and QS-003: complete frozen membership through bounded reads | Existing whole-manifest validation and member pagination; exact original limits fail explicitly | A successful source read covers that selected view, not all sources or a complete evaluated objective. |
| #255 recovery and S4-A preservation | Persist only existing manifest/member metadata, preserve v2 preparation bindings and stopped-host validation | Restore does not retain missing originals or grant current source access. Stage 3 complete batches retain their existing meaning. |

## Options and the smallest useful realization

Two implementations can reuse #255's asynchronous resolver. A configured
registered source-tool adapter could call existing Git/CI tools under the actual
native ToolContext, validate their outputs and pin their views. This avoids
managing credentials but requires a qualified exact tool schema, complete output
coverage and attempt-specific APIs. Calling a tool implementation directly is
not a newly observed native invocation; generic tool success also cannot prove
that its output was complete or its Git/CI identity exact.

The selected external path uses the existing authenticated `gh` integration
with fixed argument arrays and generated read-only API endpoints. This supplies
the few exact GitHub operations needed here without an HTTP authentication
client, a general GitHub tool, shell source, arbitrary URL fetching or an artifact
processing framework. Its costs are a local `gh` dependency, a supported GitHub
account route and bounded subprocess management. Missing integration, denied
access, owner loss and limits remain observable failures or source gaps. No
token is collected, stored, printed or supplied by the population.

Copying transcripts or downloaded objects into another Loom store is excluded
by source ownership and retention constraints. Importing OpenCode internals or
reading its private database is excluded by the supported-interface boundary.
The external increment remains useful independently of the native historical
source-release dependency.

## Source views and fidelity

### Native current-context originals

Use only the supported current-caller `session.context` route already qualified
by #251. An original native-message reference can resolve to the selected user
text view; an original native-call reference can resolve to the selected
allowlisted tool-part fields. Preserve the exact source Session, message and
part identities. The actual caller must be the source Session for raw current
context release; a population, same project, ancestor, role or agent name is not
an exception.

The version pins the selected original message/part and the digest pins its
deterministic permitted view. The view identifies original source fields and
coverage. User text excludes attachments and hidden reasoning. Tool fields
retain input, output, error, status and dispatch distinctions where those fields
are actually available. A subagent assignment is its original tool input when
present, not a reconstructed prompt from a handback. An absent field,
redaction-shaped value or compacted-away message remains a qualification or gap.

Native namespace metadata separates the known project/workspace and paired Loom
reference-store identity from **unavailable native-store identity**. A matching
Loom store ID, Session string or content hash does not establish that two hosts
share one native store. Current context is explicitly incomplete and
post-compaction; retrieving one original does not certify full Session history.

Observed skill invocations may supply their original returned content through
the tool-part view. A current skill file or configuration is not silently used
as the historical effective version. Effective instructions, configuration and
content versions remain unavailable where the owner did not preserve or expose
them. This increment adds no capture hooks or persistence for those originals.

Historical or cross-Session native raw sources continue to use an explicit
unsupported-source boundary. The actionable
[native source-owner handoff](learning-native-source-handoff.md) specifies the
required supported history and recipient-release interfaces, responsible owner,
enforcement point and falsifiable acceptance. It keeps those source interfaces
separate from Q4 invocation provenance and general Q5 protected transfer.

### External Git and CI originals

Only recognized exact GitHub locators enter the adapter. The host, repository,
operation and validated identity components determine fixed `gh api` arguments.
The adapter never executes a locator as a command, forwards a user-selected API
endpoint or turns an unknown URL into a general network read. The source
namespace identifies the GitHub repository owner separately from the local
Loom reference store.

The adapter resolves the existing `gh` executable and performs a bounded
`gh api --help` capability check before its first owner API request. A CLI
advertising `--allow-escape-sequences` uses that explicit raw-output option.
Otherwise a CLI must reproduce exact synthetic nonterminal text
(including a BOM, CRLF and terminal escape sequences) and all 256 byte values
after a loopback HTTP redirect. Try without the flag, and only if this local
test fails, try with the flag (a release may support it without advertising it).
Both probes use identical fixed GET arguments except for that flag. A version
string alone does not qualify a CLI.
The fixed synthetic probe uses a private temporary configuration, a dummy token,
no inherited credential or proxy environment, a loopback-only listener, a 4 KiB
output bound and a five-second timeout per probe request (at most four
subprocesses, inside the existing resolution deadline). It releases the
listener and temporary configuration before owner reads. The same resolved
executable performs the authorized owner GETs. Failed or unavailable probes
produce `github-cli-byte-output-unqualified`; no GitHub owner request or
flag-dropping retry occurs. This is capability qualification for the trusted
installed CLI, not sandboxing arbitrary executables or account qualification.

The actual-binary CI matrix exercises official releases 2.46.0, 2.87.3 and
2.106.0 with exact file, redirected CI job log and redirected digest-verified
archive checks; it does not establish live GitHub-account authorization.
CLI diagnostics and credentials are never returned to the reader. Source
references: [2.46.0 API output](https://github.com/cli/cli/blob/v2.46.0/pkg/cmd/api/api.go),
[2.87.3 API output](https://github.com/cli/cli/blob/v2.87.3/pkg/cmd/api/api.go),
[2.106.0 guarded output](https://github.com/cli/cli/blob/v2.106.0/pkg/cmd/api/api.go).

Each external original is limited to eight generated GET requests, 1 MiB per API
response, 512 KiB of original bytes and a 1 MiB complete permitted representation.
Each subprocess has a 20-second timeout. One registered tool call permits at most
128 native/external resolutions within a 60-second original-resolution deadline.
New selection admission permits at most **54 native/external owner-resolution
attempts**, including repeated associations and equivalent locator aliases.
This reserves fresh validation for every selected original and the complete
default 20-member freeze response within the existing limit:
`54 + 54 + 20 = 128`. A preview page of up to 50 members also fits
(`54 + 50 <= 128`). The limit counts actual owner attempts before member
deduplication, not only unique originals. A larger selection is rejected before
a freeze request is returned or a population is published. This is a structural
read-count admission rule, not a latency guarantee: changed sources, current
authorization, cancellation and the unchanged shared deadline can still reject
a later freeze. Existing frozen populations and freeze replays are not subject
to new-selection admission; their bounded readers retain the 128-read limit.
These are complete-read ceilings, not truncation rules. Original representations
are then returned in at most 32,768 UTF-16-unit fragments without splitting
surrogate pairs; the complete structured response stays within the existing
262,144-byte tool budget. Every fragment repeats exact frozen pins and rechecks
the original. Concatenate `content_json` fragments in offset order, verify the
frozen canonical JSON SHA-256 and then parse. Small complete views return `value`.

The following is a source association; it grants no source access. Replace its
identities with the actual selected objective, run, attempt and job:

```json
{"operation":"link","objective_id":"OBJECTIVE","phase":"verification","source_type":"external-ref","source_id":"https://github.com/OWNER/REPO/actions/runs/123/attempts/1/jobs/456","assessment":"inconclusive"}
```

After linking selected originals, call `loom_history preview-population` with
`selection: {objective_id, question}`, then copy its unchanged `freeze` request
to `loom_review` after the selection is approved. Each frozen member's `inspect`
request enters `loom_history population-source`. Its `navigation.next` remains
a `loom_history` request even when the first read came from the preparation
reader. JSON, Markdown and inert HTML render the same source view and coverage.

| Selected source | Permitted original and identity checks | Meaning that must not be inferred |
| --- | --- | --- |
| Full-SHA Git commit | Owner-resolved commit projection with the exact returned commit ID; commit and referenced tree IDs remain separate | A SHA quoted in a log is not a resolved commit. A tree ID does not identify a commit; returning a referenced tree ID is not retrieving the tree's contents. |
| File at a full commit SHA | Exact selected file/blob bytes and path, with the returned Git blob identity checked against those bytes | Working-tree contents, a branch tip or another path cannot substitute. A blob proves file content, not all commit contents. |
| Workflow run and explicit attempt | Owner's exact run/attempt projection, validating both identities | The run's current/latest attempt cannot replace the selected attempt. A workflow head revision is not proof of the actual checkout tested by every job. |
| Exact job in a selected run/attempt | Owner-checked run/attempt/job tuple and the complete bounded original job log. Canonical `/actions/runs/R/job/J` locators require the exact job's reported attempt; explicit `/attempts/A/jobs/J` locators also support a complete exact-attempt membership check. | A successful job or suite is not an individual named test event; a printed revision is not automatically the executed checkout. |
| Exact artifact | Owner artifact identity, available run association, expected digest and complete bounded archive bytes, with SHA-256 checked before release | A name, artifact ID, download URL or digest string alone is not the artifact. Archive retrieval does not parse or validate all contained tests or establish an unreported attempt association. |

The first artifact view is a digest-verified original archive encoded for
bounded structured readback. It is not a ZIP extraction service, a test report
parser or a universal artifact framework. Encoded content remains original
content in that representation; it must not be labeled an excerpt or a decoded
test report. When an authoritative expected digest is absent or verification
fails, the adapter cannot certify a verified artifact view.

Original CI logs allow a reader to inspect actual test events when those events
are present. The resolver does not synthesize events from a suite conclusion,
invent a job's tested revision from the workflow head, or diagnose the failure.
Any interpretation must cite the actual log/event coverage and its limitations.
Test-event extraction beyond this bounded original view is a separately
scoped extension, not an implicit artifact-processing capability.

## Composition with frozen populations

The existing asynchronous source-owner contract is the only resolution seam.
The source request carries the actual recipient, purpose, namespace, exact
identity/version and selected permitted view. A successful response must bind
to that request and pass the deterministic view-digest check. Owner inspection
and authorization complete before the caller consumes the original.

During a **new preview**, supported source references are resolved through their
owners to establish exact versioned descriptors and permitted views. Preserve
the authored association, historical scope, relationship provenance and
membership qualification alongside that descriptor. Resolving a reference
establishes source availability; it does not promote an authored association to
observed causation or independent objective membership.

Equivalent GitHub job locator spellings normalize to the exact canonical
run/job identity before owner resolution. An explicit attempt remains an
expected-version assertion. One resolved original has one member and digest;
every attributed association and its originally declared locator remain in
the membership basis and original ObjectiveIndex links. Repository-name case
is similarly normalized. This is exact source identity normalization, not
inferred historical relationship reconstruction.

Freeze rechecks the same preview and digest under current authority, then uses
the existing atomic manifest/member publication. The new capability needs no
parallel schema or content store. A later source change, lost object or revoked
access cannot rewrite the committed descriptor, member ordering or population
identity.

Previously frozen `reference-only` members remain their original gaps. They did
not select an original view or establish its exact version, so installing an
adapter cannot upgrade them in place. Establishing a new source identity or
permitted view requires a fresh preview and explicit freeze. Later original
availability never silently enlarges an existing population.

`population-source` follows one exact frozen member. Available content must
match the pinned namespace, tuple, view, version and digest. Missing, changed,
unresolved and unsupported originals remain truthful source states. None can
return newer content, an adjacent source, an authored summary or a quoted
identifier as a replacement. If identity metadata is itself forbidden, the
existing generic authorization failure withholds it rather than revealing a
protected gap slot.

## Bounds, authorization and failure handling

Enforce limits before allocating an unbounded original or returning content.
Subprocess output, native normalization, object fields, artifact bytes and final
serialized responses each have their own processing boundary. An exact source
that cannot fit the supported original view fails explicitly. A truncated log,
partial download, omitted page or cut-off archive cannot be marked full or
available. Population pagination continues to cover the complete frozen member
set, independently of any one member's content size.

Native identity comes from the actual invocation context, never a nominated
recipient input. Preserve contributor metadata preflight, source location,
inspection and disclosure checks across preview, pages, exact originals and
preparation readback. External authentication remains with `gh` and GitHub;
successful account access does not itself authorize disclosure to a different
native Session. Revalidate the complete source-derived returned view through
the existing final permission assertion; perform no subsequent asynchronous
source retrieval before return.

That assertion is a **permission-decision observation**, not an atomic
policy/source-release fence. The settled #251 pending-approval/revocation
limitation is unchanged. Denial observed before release must withhold the
complete response. Strict concurrent native revocation remains unqualified
where the source owner supplies no enforceable release boundary; a fixture
cannot manufacture that owner guarantee. Successful ordinary authorized
inspection does not require unrelated full Q4/Q5 qualification, and it cannot
be presented as satisfying those guarantees.

Cancellation stops bounded work and returns no successful original. Source-owner
absence, credential/integration absence, denied access, missing objects,
version changes and processing limits remain distinct where their existence is
permitted to be disclosed. Diagnostics must not include credentials, raw
unapproved response bodies or protected native material. No successful read
creates a capture permission, retained transcript, execution permit or provider
reservation.

If native context or original content outgrows byte, message/part-count, value or
depth capacity after freezing, the original resolves to the typed
`unresolved` / `native-source-processing-limit` gap. Authorized population pages
retain every frozen member, source pin, digest and continuation and expose the
same bounded gap in the current-source status. They return no original or
excerpt. Preparation still rejects a previously available original that is now
unresolved. Invalid source data or identity, authorization failures and
cancellation remain errors. The existing native trace interfaces continue to
reject capacity failures; only the population original resolver converts them
into availability gaps.

## Recovery and qualification obligations

Only descriptors and membership remain durable. Existing paired backups verify
the complete population and its exact v2 preparation linkage, including the
#255 F-01 missing-population correction. Offline recovery must not fetch current
sources to decide whether stored membership is structurally intact. After
restore, every original read applies current owner availability, version and
authorization; lost or changed originals remain explicit gaps.

| Required falsification | Expected behavior |
| --- | --- |
| Wrong native source Session, message or part | No neighboring match or cross-Session raw release. |
| A later CI attempt supplied for the frozen original failure | Identity mismatch; no available original substitution. |
| Quoted SHA supplied as a resolved Git object | No resolved-object claim without the selected owner lookup. |
| Original absent or changed after freeze | Same population bytes/identity; missing or changed current source. |
| Artifact bytes disagree with expected digest | No verified artifact or archive-content release. |
| Unauthorized contributor, original or recipient disclosure | Whole unauthorized view withheld, including metadata and derived counts. |
| Revocation observed during a bounded read | Withhold response through the existing final check; separately qualify any claimed atomic owner release. |
| Oversized, truncated or incomplete source | Explicit failure/coverage limitation, never a successful full-content prefix. |
| Native source/context exceeds capacity after freeze | Typed source gap; complete authorized frozen membership and continuation remain readable. |
| Selection at the owner-resolution admission boundary | 53/54 attempts can preview and freeze with unchanged fast sources; 55 attempts reject before publication. Revalidation and bounded readback remain reserved. |
| Restart, restore and preparation readback | Exact descriptors and membership survive; current sources are rechecked; v2 execution remains rejected. |
| Equivalent structured and human views | Same source identities, qualifications, coverage and exact inspection requests. |

Use actual registered tools and frozen-population readers for composed tests,
then the supported installed-host route for native integration checks. Keep
controlled source fixtures, actual GitHub retrieval, native installed mechanics
and the private operator rehearsal separately identified. A controlled
#182/#187 equivalent must distinguish original failure, unchanged-code rerun,
plausible but unproven diagnosis, exact correction, both named subtests on the
corrected revision, suite-level race verification and separate release criteria.
The private historical investigation is not reproduced by those fixtures.

## Consequences and unresolved decisions

The same immutable selection becomes useful for actual evidence inspection by
Researchers, Reviewers, Debuggers, humans and a separately authorized future
Evaluator. No new evidence database, reconstruction engine or scheduler is
needed. Availability can change without changing selected membership.

Original-source modification policy remains unresolved. Reporting a version
mismatch does not decide replacement, retention, invalidation, republication or
automatic creation of a new population. Native full-history/release support,
historical effective instruction coverage, protected Q4/Q5 guarantees, genuine
Evaluator reasoning and production execution authority remain with their
existing owners and qualification gates. Keep #227 open.
