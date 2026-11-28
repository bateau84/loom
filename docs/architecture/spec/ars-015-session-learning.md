---
type: Architectural Specification
title: "Session learning interfaces and checkpoints"
description: "Public subject, preview, incremental report and prior-original contracts."
tags: [loom, learning, specification, interfaces]
timestamp: 2026-11-28T00:00:00Z
---

# Session learning interfaces and checkpoints

The caller and source owner must agree on exactly which work is being evaluated before interpreting it. For example, a Session preview may show a failed restart and a later correction, while an append after its cutoff is outside that subject. The preview can inspect originals without freezing anything; the returned freeze request pins the inspected population.

## Derived from

[Session evaluation architecture](../design/ard-018-session-evaluation-and-incremental-learning.md), [S5 publication](../design/ard-017-learning-evaluator-interpretations.md), [source ownership](../design/ard-007-learning-historical-evidence.md) and [#227](https://github.com/bateau84/loom/issues/227). Existing #249–#262 source, authorization, recovery, disclosure-budget and restricted-execution contracts continue to apply.

## Public operations

| Tool and operation | Required identity | Contract |
|---|---|---|
| `review establish-subject` | `target:{kind:session|action|objective,id}`, `question` | Persist boundary before analysis; return exact preview request. |
| `history subject` | `subject_id`, `subject_sha256` | Read the established descriptor; no recapture. |
| `history subject-activities` | Same subject pins | Separate requester-owned audit, `after`/`limit`, failures and observed resource counts. |
| `history preview-population` | `selection` with target/question or returned subject pins | Read-only foundation; all pages must be inspected. Legacy `objective_id` remains accepted. |
| `history preview-source` | Returned selection, `preview_sha256`, `member_key` | Exact permitted original before freezing; changed preview fails. |
| `review freeze-population` | Returned selection and `preview_sha256` | Revalidate and freeze exactly; new format requires subject pins; empty evidence cannot freeze. |
| `insights learning-progress` | Calling Session; optional `before`, `limit` | Committed/observed frontiers and bounded reports; no foreign Session inference. |
| `insights learning-report` | `batch_id` | `section:summary|concerns|unfinished`, numeric `after`, `limit`. |
| `insights learning-source` | `batch_id`, `member_key`, `source_index` | One exact original; numeric `after`, `max_chars` 1–16000; follow `next`. |
| `insights evaluation-prior-source` | `report_id`, `report_sha256`, `member_key`, `source_index:0` | Original from that report's own population; ordinary source paging. |

History population/source/read, incremental progress/report/source and S5 interpretation/source views support `response_format:json|markdown|html`. Subject descriptor/audit reads are JSON-only. Exact requests must be copied from returned navigation; a record ID is not a member key, and history versions are not population versions. The registered help is syntax authority.

`cutoff` defaults to `{kind:"point-in-time"}`. `{kind:"recorded-completion",record_id}` requires a matching original engineering completion. A cutoff, idle period, successful processing checkpoint or reported QA pass never establishes broad objective completion.

## Identity, durability and compatibility

Subjects use `loom-evaluation-subject/v1`. Their content-addressed identity binds target, question, namespace, author, cutoff, origin and five frontiers: `ledger`, `objectives`, `objective_links`, `review_requests`, `review_relationships`. The stored checksum additionally binds identity and creation time.

New subjects and V2 selections also carry `namespace_frontier`, distinct from Session-local processing cursors. It records comparable namespace ceilings captured before discovery, capped before the first unprocessed owned row on each source axis. `namespace_through` pins the exact ceiling in deterministic/model checkpoints. Manual and automatic S5 context admission compares these explicit ceilings; later own rows and later foreign metadata remain excluded. Older subjects omit the optional field without rewriting their bytes and retain conservative all-axis comparison.

Legacy objective selection emits the original `loom-retrospective-population/v1` bytes. New typed subject selection emits `loom-retrospective-population/v2`, with `subject_id`, `subject_sha256`, `target`, `frontier`, `cutoff` and existing owner/version/exclusion fields. Session/Action preparation has `objective_count:null`, typed `target` and `target_count:1`; it does not invent an objective. Existing V1 readers/recovery remain supported. Older runtimes must not be used to mutate state requiring these new semantics.

The deterministic method's successful EvaluationStore batch owns its cursor, including owner rotation. Publication is the commit boundary. Physical failed/pending heads do not become successful cursors. A changed expected predecessor produces retryable pending work, not a competing successful interpretation. Resume reuses exact frozen membership and already committed member reports.

Optional model intents use `incremental-interpretation/<method-digest>` in the same store. Each immutable intent pins the oldest bounded deterministic prefix, exact population/preparation, method and budget. New appends cannot replace pending input. Successful S5 publication precedes method checkpoint commit; replay/recovery cannot infer again merely because the checkpoint acknowledgement was lost.

## Configuration and bounds

Under `learning`: `incremental` defaults true, `max-sources` defaults 128 (1–1000), `coalesce-ms` defaults 250 (0–60000). `interpretation.enabled` defaults false. Its `method` is a complete `loom-evaluator-method/v1`; `budget-policy` is a pinned policy reference. Coalescing defaults are `min-sources:16`, `max-age-ms:60000`, `min-interval-ms:60000`; numeric limits are validated before use. Missing execution authority returns a blocked interpretation while deterministic work continues.

Interpretation planning admits at most 64 deterministic checkpoints and 5000 exact original/context refs. Retained deterministic concerns plus unfinished starts are capped at 4000; overflow preserves the prior checkpoint and reports a block. Source fragments and output byte limits remain enforced through existing models. Progress pages shorten at their byte bound and preserve a continuation from the last included increment. S5 context admission shares its structural/read budgets across calls and reserves one of the 32 report slots for the current interpretation.

## Source authorization and receipt meaning

Every derived incremental report must authorize its complete dependency union, including retained earlier sources, before hydration/disclosure. Exact source reads resolve only the selected original. Legacy readers cannot bypass the new scope's disclosure owner. Each final response rechecks the relevant namespace, source identities, location and native grants, including its actual serialized bytes. This observation is not a newly qualified atomic revocation fence.

An admitted `EvaluatorSourceReader` gains `interpretations.list/read/source`. Optional trusted `context_retrieved` receipts distinguish `prior-interpretation` and `prior-original`. The latter binds report/hash/member/index/source hash and delivery boundary. A public read cannot manufacture this receipt. Every delivered report/original requires an explicit `prior_interpretations` dependency, even if uncited. Prior-original citations are distinct from current-member citations. Report relationships accept `context`, `supersedes`, `contests`; only the latter two invalidate earlier interpretations.

Unknown role names, reused inner-call IDs, independent goals, unsupported native bodies and unverified descendant relationships grant no access or provenance. Audit failures do not turn a read-only preview into a mutation prerequisite. Operational source recording remains append-only.

## Verification and readiness

Native subject, incremental/runtime, S5 context, registered reader, paired backup and adversarial restore tests exercise the implemented owners. The browser workflow executes registered HTML navigation, exact requests, keyboard operation, inertness, responsive layout and axe; the independent reader exercise measures comprehension and unnecessary retrieval. Generated fixtures, static validity and scripted S5 output alone do not establish real-user acceptance.

The [qualification report](../qualification/session-learning-rebuild.md) records actual results, failed attempts and remaining dependencies. #227 stays open for an authorized ordinary historical Session, real human walkthrough and qualified genuine inference. Production authority is intentionally absent.
