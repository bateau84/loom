---
type: Playbook
title: "Cross-session inbox performance qualification"
description: "Bun measurements, indexed recipient and answer lookup, pagination correctness, and additive-index recovery evidence."
tags: [loom, collaboration, questions, sqlite, performance]
timestamp: 2026-11-17T00:00:00Z
---

# Cross-Session inbox performance qualification

The PR #237 inbox slowdown reproduces in Loom's supported Bun runtime. Both the
recipient lookup and the correlated answer lookup need correction. The change
keeps the existing ledger and answer index, adds one partial inbox index, and
uses an answer predicate that lets SQLite seek both existing answer-index keys.

## Runtime and workload

Measured on 2026-11-17 against the candidate query and the reviewed query from
`a55a4650f304353d2241081d3fc7f680ebacc2e2`:

- Bun **1.4.2**, Linux x86-64, bundled SQLite **3.53.2**.
- SQLite source ID:
  `2026-06-03 19:12:13 d6e03d8c777cfa2d35e3b60d8ec3e0187f3e9f99d8e2ee9cac695fd6fcdf1a24`.
- Disposable file-backed databases, WAL, `synchronous=2`, 4,096-byte pages,
  default 2,000-KiB SQLite page cache. No statistics were manually added and no
  shared or OS caches were evicted.
- One sequential process; one warm-up followed by seven measured repetitions.
- Each dataset contains **1,000 or 50,000 unrelated questions and their answers**,
  followed by 155 questions addressed to the tested Session: 77 open and 78 answered.
- Separate datasets exercise all records associated with one Action and all
  records with NULL Action scope. Native correctness tests additionally mix two
  Actions and Session-only scope in one inbox.
- Every comparison fully consumes up to 51 candidate rows. The revised product
  measurements also load and render up to 50 questions and their latest answers.

This is synthetic local workload qualification. The old review's SQLite 3.46.1
numbers are not reused as Bun evidence.

## Results

Times below are median milliseconds. “Candidate” is the SQL candidate query;
“Product” includes `Collaboration.inbox` and its answer summaries.

| Scope | Unrelated threads | Page | Original candidate | Revised candidate | Revised product |
| --- | ---: | --- | ---: | ---: | ---: |
| Action | 1,000 | Open | 6.233 | 0.093 | 1.594 |
| Action | 50,000 | Open | 357.972 | 0.125 | 1.805 |
| Action | 1,000 | Answered | 6.245 | 0.095 | 2.459 |
| Action | 50,000 | Answered | 351.625 | 0.109 | 2.882 |
| Action | 1,000 | All | 0.821 | 0.025 | 1.788 |
| Action | 50,000 | All | 47.873 | 0.027 | 1.972 |
| Action | 1,000 | Empty/open | 0.907 | 0.018 | 0.043 |
| Action | 50,000 | Empty/open | 49.166 | 0.018 | 0.040 |
| Session-only | 1,000 | Open | 6.084 | 0.097 | 3.433 |
| Session-only | 50,000 | Open | 349.234 | 0.103 | 1.608 |
| Session-only | 1,000 | Answered | 5.883 | 0.086 | 3.248 |
| Session-only | 50,000 | Answered | 335.752 | 0.097 | 3.531 |
| Session-only | 1,000 | All | 0.765 | 0.025 | 2.140 |
| Session-only | 50,000 | All | 45.223 | 0.027 | 1.936 |
| Session-only | 1,000 | Empty/open | 0.847 | 0.018 | 0.039 |
| Session-only | 50,000 | Empty/open | 44.352 | 0.018 | 0.038 |

The benchmark also measures page two for open/answered/all, and empty answered/all
inboxes. Every before/after candidate set is identical. Full pagination for each
state equals the exact IDs retained from production question/answer creation,
without omissions or duplicates.

The added index occupies **1,593,344 bytes (389 pages)** for 50,155 questions in
each large dataset. Building it through the real Store startup transaction took
**69.0 ms** for the Action dataset and **61.0 ms** for Session-only. These are local
measurements, not a startup latency bound for larger databases. The index adds
one entry per v2 question; answer writes do not qualify for the partial index.

## Why both changes are needed

The original recipient lookup uses:

```text
SEARCH q USING INTEGER PRIMARY KEY (rowid>?)
```

That visits unrelated ledger history when looking for a destination or confirming
an empty inbox. The new partial index on
`json_extract(data,'$.data.expected_session'), seq`, restricted to v2 questions,
changes the access path to:

```text
SEARCH q USING INDEX ledger_question_inbox (<expr>=? AND seq>?)
```

The original answer correlation uses only the first key of the existing index:

```text
SEARCH a USING INDEX ledger_answers (action_id=?)
```

`IN (q.id)` removes the outer TEXT-column affinity from this comparison, allowing
the existing question-ID expression key to participate. All question IDs created
by the store and all question IDs persisted by the answer producer are strings.
NULL Action scope is still matched with `IS`; Action association remains part of
the lookup. In the measured runtime the revised access path is:

```text
SEARCH a USING INDEX ledger_answers (action_id=? AND <expr>=?)
```

This is a measured change on the actual bundled engine, not an assumption that a
syntactic rewrite is universally faster. SQLite's expression-index and affinity
rules are documented in [Indexes on Expressions](https://www.sqlite.org/expridx.html)
and [Datatype comparison rules](https://www.sqlite.org/datatype3.html#comparisons).

## Compatibility and regression evidence

`tests/inbox-performance-native.test.ts` checks actual product calls and SQLite:

- Open/answered/all pagination across two Actions and Session-only scope, with
  unrelated history and an empty recipient.
- Both narrowed access paths, with no temporary ordering B-tree.
- Exact destination/format filtering and answer-to-Action matching, including
  NULL scope and misleading answers stored under the wrong Action.
- A populated v2 file with the prior schema, closed and reopened through Store;
  all old table rows and SQL declarations remain identical except for the new
  index. A second reopen is idempotent. Integrity and foreign-key checks pass.
- Interruption after index creation but before Store initialization commits;
  the schema and ledger roll back exactly and the next open succeeds.
- Removing the added index restores the previous schema without data conversion.

The historical preservation oracle explicitly allows only this index in addition
to the existing v2 review migration, checks its complete SQL definition, and
continues to compare every pre-existing declaration and stored row. Frozen
historical preservation, full-history and full-thread tests pass with that exact
allowance. There is no ledger rewrite, table-format change, new schema-version
requirement, queue, or retry mechanism.

Reproduce the measurements and obtain complete samples, query plans and compile
options with:

```sh
bun tests/benchmark_inbox.ts > /tmp/loom-inbox-benchmark.json
bun test tests/inbox-performance-native.test.ts tests/historical-preservation-native.test.ts tests/full-history-native.test.ts tests/full-thread-native.test.ts
bun run typecheck
```

The test command passed **15 tests / 1,055 expectations**, and type checking passed.
Wall-clock thresholds are deliberately excluded from CI; correctness, index
access paths and upgrade/recovery behavior are asserted instead.

## Remaining limits

Seven repetitions do not establish tail percentiles. This does not qualify cold
storage, concurrent writers, larger-than-tested histories, native host scheduling,
or model processing latency. Filtering an inbox with a very large number of its
own already-answered questions can still visit those addressed questions to find
the next open page. This change removes unrelated-recipient and unrelated-answer
amplification; it does not add a materialized open-question queue or a global
constant-time inbox guarantee.
