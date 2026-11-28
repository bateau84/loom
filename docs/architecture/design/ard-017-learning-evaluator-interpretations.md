---
type: Architectural Design
title: "Durable Evaluator interpretations"
description: "S5 result validation, atomic publication, source-linked readers and recovery through the restricted execution consumer."
tags: [loom, learning, evaluator, publication, authorization, recovery]
timestamp: 2026-11-27T00:00:00Z
---

# Durable Evaluator interpretations

S5 turns an already completed Evaluator result into a durable, inspectable
retrospective. It implements [S4-09 and S4-11](../spec/ars-004-learning-stage4-contract.md),
[BR-008](../../requirements/requirements/learning-retrospectives/br-008-persist-revisable-evaluation-history.md),
[BR-009](../../requirements/requirements/learning-retrospectives/br-009-present-controlled-system-improvements.md)
and [OC-004](../../requirements/obligation-contracts/learning-retrospectives/oc-004-evaluation-processing-and-publication.md)
through `EvaluationStore` in the existing `learning.sqlite`. There is no separate
report database, import operation, inference lifecycle or scheduler.

The implementation uses the existing [frozen populations](ard-010-learning-retrospective-populations.md)
and [restricted execution consumer](ard-012-learning-restricted-execution.md).
The [production authority handoff](../spec/ars-014-learning-retrospective-execution-authority.md)
remains a separate qualification boundary.

**Qualification is publication mechanics only.** The installed test provider
returns scripted JSON through a real OpenCode 2.3.0 Session. This proves the
result-to-publication path and its failure behavior; it does not establish
genuine Evaluator reasoning, semantic correctness, independent review or real
account authority. The production `Learning` constructor still has no execution
adapter. [#227](https://github.com/bateau84/loom/issues/227) remains open.

## Publication boundary

`EvaluatorExecution.publish(actor, pins, signal?)` accepts the same exact
`batch_id`, `request_id`, `manifest_sha256` and `attempt_id` used by the restricted
consumer. It does not accept interpretation JSON or an authority supplied by a
public caller.

1. Reconcile the existing authority inventory and retain its accounting first.
2. Require a completed, fenced result and settled authoritative usage.
3. Use the trusted owner's optional `readResult(admission, receipt)` to read the
   exact original native result. This capability must never infer, retry, resume,
   enqueue or wake work. Its absence fails publication closed.
4. Verify the original raw UTF-8 SHA-256, result identity, admission, method and
   exact frozen population. Validate authored claims against the trusted source
   delivery receipts.
5. Validate prior report/recommendation references and current original sources.
   Recheck caller authority before the final complete source-disclosure decision.
6. Commit the overall interpretation, all member completion checkpoints,
   dependencies and revision invalidations in one existing database transaction.

The overall report ID is `interpretation-` plus the canonical SHA-256 of
`{format:"loom-evaluator-report-id/v1", admission_sha256, result}`. Its checksum
also covers the batch, body, qualifications and complete source dependencies.
The body retains the exact original result text to permit offline verification;
public readers expose only the validated interpretation and provenance. The
immutable body does not include a changing accounting receipt sequence or a new
publication timestamp.

Each internal checkpoint has ID `interpretation-member-` plus the canonical hash
of `{format:"loom-evaluator-member-id/v1", report_id, member_key}`. It records
`{format:"loom-evaluator-member/v1", report_id, report_sha256, member_key}` and
that member's exact frozen source. These are completion pointers, not separately
authored interpretations or successful engineering outcomes. Their authenticated
parent carries the whole protection union. This avoids quadratic copies of that
union. No public endpoint or generic report reader exposes a checkpoint alone.

## Authored result contract

`loom-evaluator-interpretation/v1` is a strict, closed JSON object. All fields
below are required; unknown fields and versions reject the entire result.

| Field | Meaning |
| --- | --- |
| `covered_members` | Every frozen member exactly once, including gaps. |
| `conclusion` | `recommendations`, `no-change` or `insufficient-evidence`, with a statement and limitations. |
| `trajectory` | Attributed events, their member scope, exact supporting references and limitations. |
| `claims` | Findings, successful practices, avoidable failures, necessary exploration and recovery. |
| `review_coverage` | Requested and actually covered review dimensions, evidence and limitations. |
| `gaps` | Frozen unavailable sources, available sources not actually retrieved, or explicit coverage limitations. |
| `qualifications` | Chronology limitations and `independence:"unknown"`; this route cannot establish independent originating intent. |
| `prior_interpretations` | Exact prior report ID/checksum, `supersedes` or `contests`, and a reason. |

A claim has a stable `claim_id`, a kind (`observed`, `authored`, `interpretation`,
`verification` or `recommendation`), category, statement, member scope,
`supporting` and `contradicting` references, limitations, applicability and either
`recommendation:null` or a concrete proposal. A proposal requires a target,
mechanism, risks, validation proposals and any prior recommendation links.

References are `{member_key, source_index:0}`. They must identify an exact frozen
available original that the trusted owner actually delivered at the
`native-tool-result` or `provider-input` boundary. Each receipt names that
boundary, its own ID and the frozen source hash. Authored citations, selected
membership, a prompt pointer or a known source hash cannot mint retrieval facts.

Supported claims require support. Unsupported hypotheses are allowed only as
explicitly limited interpretations or recommendations. They cannot masquerade as
observations or verification. Contradictory evidence requires an explicit
limitation. Recommendations require applicability, risk and validation; a
no-change conclusion cannot carry change proposals. Unavailable and unretrieved
members require honest gap entries. Empty arrays are explicit, not inferred
coverage.

The validator checks machine-verifiable structure, identity and reference
consistency. It cannot decide whether a cited source entails a conclusion,
whether a causal explanation is sound, or whether a recommendation will help.
Independent assessment of those questions remains part of genuine S3 execution.

## Revisions and source authority

A later interpretation uses a newly prepared population or method and its own
admitted execution result. It links exact earlier report/checksum pairs; prior
recommendation links also name a real prior recommendation claim. Links must
remain within the same owner, source namespace and authored objective. The
batch's generic `previous_batch_id` is not a revision claim: it may describe
another objective.

Publication records explicit supersession/contestation in the existing
invalidation table. Old bodies and checksums remain unchanged and readable under
their current permissions; their internal batch state becomes `stale`. Public
pages expose only publication state and a uniform `revision_status` of
`not-assessed-by-this-view`. A restricted later report must not leak its existence
through an older report's status. Authorized later reports expose the revision
links. Missing revision markers,
wrong prior hashes, cross-objective references and cycles reject. A revision
inherits the entire earlier report dependency union, not only the sources it
cites. Up to 32 reports may participate in this bounded history graph.

Publication admission and interpretation reads share a limit of **1,728 unique
available native/external originals** across the complete dependency union:
32 reports multiplied by the existing 54-attempt population-selection allowance.
Exact identity includes the source namespace, pinned version/hash and permitted
view. Repeated references to the same original consume one validation; a different
version or view is a different dependency. This limit does not enlarge the
ordinary population tools' 128-read budget, the 54-attempt selection allowance,
or any inference reservation. The existing shared 60-second original-resolution
deadline also remains in force.

A report list validates its complete candidate union once, rather than resolving
the same population separately for every entry. That union has the same 1,728
original and 100,000 distinct selected-dependency bounds. A list that exceeds
either bound rejects without returning a successful prefix or a cursor; reduce
the requested list `limit`. A report exceeding the publication bound is rejected
before any report/checkpoint is committed. Report pagination cannot reduce its
dependency union, so changing the section or page size cannot bypass admission.

Every read and publication checks current original availability and the complete
selected/inherited disclosure union, including uncited inputs and frozen gaps.
When that union contains multiple populations, the trusted integration must
provide `authorizeUnion(actor, metadata[])`; individual stale grants are not
combined into permission. The public plugin uses one native assertion over its
accumulated source-view resources, followed by its existing final decision over
the exact serialized response hash. This is a current read check, not a claim
that the unresolved upstream atomic transfer boundary has been qualified.

The registered reader batches selected-member permissions before source
resolution. It reuses exact source-validation outcomes and immutable population
hydration only within that invocation, and discards resolved original values
after checking their pins. It does not retain grants or source observations for
later pages. Source Session locations are checked again before the final
serialized-response decision. This avoids repeatedly sending an expanding
resource list to the permission owner for every member or population while retaining the full
union, including unavailable and uncited sources, in both final decisions.

The registered tool uses the same unavailable response for source/read failures,
capacity rejection and final disclosure denial. It does not expose an inherited
protected threshold through a more specific error. Check current source/report
permissions, use the exact returned inspection/continuation command, or reduce
the report-list `limit`. Trusted publication and stopped-backup diagnostics retain
the precise admission reason. Cancellation remains cancellation. Empty lists also
require the final current file-union decision over their exact serialized bytes.

A source available at freeze that is now missing, changed or denied withholds
dependent content, metadata, counts and cursors. It is not silently converted
into an accepted gap. A source already unavailable at freeze remains an explicit
gap; no resolver or citation pretends to have retrieved it. Published history is
preserved in either case. Stopped backup validation checks provenance and
structure without fetching sources or granting disclosure after restore.

The trusted route must confine protected inputs to its declared source/method
scope. This implementation does not qualify extra context, private mandates or
untracked host inputs; those remain obligations of any future real adapter.

## Public inspection

List authorized reports through the existing tool:

```json
{"operation":"evaluation-interpretations","limit":10}
```

Open an exact report using the returned `inspect` command. For a human view:

```json
{"operation":"evaluation-interpretation","batch_id":"BATCH_ID","section":"overview","response_format":"markdown"}
```

`response_format` is `json` (default), `markdown` or `html` for a report. The list
uses JSON. Sections are `overview`, `trajectory`, `claims`, `review_coverage`,
`gaps`, `sources` and `prior_interpretations`. Claim entries include the full
positive/negative findings, counterevidence and proposal details. Source rows
separately show **selected**, **retrieved**, **cited** and **unavailable**. Their
`inspect` commands use `loom_history population-source` with exact population,
manifest and member pins. Prior interpretation entries link to the corresponding
authorized report reader.

Use returned `navigation.sections` and `navigation.next` commands. They preserve
report ID/checksum and section. `after` is an opaque ordinal/fragment cursor, not
the numeric cursor used by Stage 3. `coverage.complete` means the single page
contains the whole section; follow `navigation.next` until null to exhaust a
multi-page section. `limit` defaults to 25 and is a ceiling of 1–100 items.

Every page must fit in 180,000 UTF-8 bytes in JSON, Markdown and HTML, with a
separate canonical serialization-character bound. The final plugin response
remains capped at 262,144 bytes. Large individual items use exact canonical JSON
fragments with pinned character offsets; no text is silently truncated and no
cursor skips a rejected item. HTML escapes report text and disables scripts.

The authored interpretation has a 33,554,432 canonical-character / 2,000,000-value
admission budget, at most 20,000 items per collection and 65,536 characters per
narrative item. The retained publication envelope, including raw result text,
must also fit the existing 33,554,432-character storage budget. Overall source
unions are bounded to 100,000 references; frozen population limits are unchanged.
These are serialization limits, not token allowances or execution permission.

## Recovery and qualification

Replay reads the original result and reconciles accounting without a new
reservation, claim or inference. A transaction failure leaves no successful
prefix of checkpoints. A lost commit acknowledgement reuses the same report.
Restoring an older paired Loom snapshot reconstructs the same report ID and
checksum from the independently retained authority result. Publication time is
not part of that identity. Lost authority/native result history remains a
failure; publication never invents replacement inference permission.

The stopped backup inspector validates result hashes, method/request/admission
bindings, full current/prior dependency unions, member-parent checksums and
revision invalidations. Recomputing local report/backup checksums does not hide
substituted interpretation claims, omitted dependencies or broken parent links.
These are structural integrity checks; local hashes are not host signatures.

Qualification entry points:

- `tests/evaluator-interpretation-native.test.ts`: strict schemas, source
  references, honest gaps, recommendations, no-change, every section and exact
  Unicode fragments.
- `tests/evaluator-publication-native.test.ts`: actual consumer publication and
  complete readback for 517 anchors, transaction interruption, lost commit ACK,
  and revocation during the last caller check.
- `tests/evaluator-interpretations-public-native.test.ts`: actual registered
  public tools, all representations, uncited dependency authorization, source
  loss, final disclosure denial and absence of import/dispatch operations.
- `tests/evaluator-interpretation-capacity-native.test.ts`: shared publication
  and readback admission at 1,728/1,729 originals, no partial list beyond the
  union budget, per-invocation source revalidation and independent report lists.
- `tests/evaluator-interpretations-history-native.test.ts`: registered-tool
  revision and list readback at 128/129/162 distinct originals, exact owner-read
  deduplication and inherited-source denial/loss through a controlled GitHub CLI
  executable. This does not use a real account or qualify external availability.
- `tests/evaluator-interpretations-scaling-native.test.ts`: registered-tool
  readback, complete pagination and multi-population lists above 500 members, measured permission calls,
  cumulative resources, latency and sampled memory, with exact final union and
  serialized-response checks. Its native permission owner is a zero-delay
  simulation: these measurements qualify the production callback's work, not
  native permission-server or transport latency.
- `tests/evaluator-interpretation-backup-native.test.ts` and
  `tests/test_evaluator_interpretation_backup.py`: stopped restore and
  checksum-consistent corruption controls.
- `tests/installed_evaluator_interpretations.py`: the same #259 native consumer
  lifecycle, exact installed artifact and OpenCode version, 15 qualification
  checks across valid, invalid, interrupted and revised scripted results.

The installed suite records native result IDs/hashes, actual tool delivery,
included fixture usage, every page, original and revised report identities and
restored readback. It checks that two provider sends serve one controlled
execution (source request plus returned interpretation), and that replay,
publication, interruption recovery and old-snapshot restore add no sends. A
second explicitly prepared revision uses its own two-send reservation.

CI packages the exact reviewed head, validates the installed source inventory,
runs this suite and retains its report artifact. The existing #249/#259 installed
execution suites remain separate regression gates. Precise run revisions and
independent-review evidence are recorded in the implementation PR and #227.

No source collection is expanded. No skills, agents, configuration, experiments
or project code are changed by a recommendation. Automatic S6 scheduling,
upstream production authority, genuine S3 reasoning and its independent
assessment remain separate work. Nothing in S5 authorizes a merge or activation.
