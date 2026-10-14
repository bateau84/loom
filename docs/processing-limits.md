# Processing limits: first bounded E correction

Input baseline: `ca93dd3`. The original review correctly distinguished small
output from cheap processing. A plan could satisfy every individual field limit
while containing millions of characters, and rendering could serialize that full
plan before choosing a compact result. This change puts explicit limits around
Loom's JavaScript data handling. **It does not close all of finding E.**

## Limits implemented

| Boundary | Limit / behavior |
| --- | --- |
| New plan admission | 262,144 serialized JSON characters across all nodes; the existing 300-node and individual field/list limits still apply. Checked before cloning and graph traversal. |
| One canonical serialization / ordinary digest | 1,048,576 serialized characters, 32,768 value visits, depth 48. Repeated references cost work each time; cycles, accessors and non-plain objects are refused. |
| Stored Plan JSON decoding | 524,288 characters checked before `JSON.parse`. The extra space permits reading some earlier plans larger than the new admission limit. |
| Other stored JSON and ledger writes | 131,072 characters per value. Explicit record input is checked before fingerprinting/evidence queries; writes serialize within the same allowance. |
| Context fingerprint comparisons | A shared 1,048,576-character / 131,072-visit allowance across uncached comparisons. Once exhausted, later uncached checks are not attempted. |
| Full-context fit check | Stops at the requested 2,000–64,000-character output allowance rather than materializing the entire candidate JSON. |
| Compact context | Measures changing entries rather than repeatedly serializing the growing response. Array commas and counter-width changes count toward the exact output length. |

Characters here mean UTF-16 code units in serialized JSON, not tokens, UTF-8
bytes, or source-text length. JSON escapes count at their expanded length. These
are conservative alpha limits, not capacities inferred from one benchmark.
They are constants in `src/model.ts`, not new permissions or agent roles.

The canonical serializer preserves the prior bytes and SHA-256 for supported
plain data. Tests include fixed examples and seeded nested data, undefined
values, Unicode, escaping and non-finite numbers. It never emits a digest of a
truncated prefix. Previously unusual non-JSON inputs are not a compatibility
promise: functions, accessors, class instances and cyclic graphs are refused.

## Failure behavior and history

Failures have code `LOOM_PROCESSING_LIMIT`. A rejected plan or record does not
partially update storage. Large plans should carry shorter inline context and
references rather than copying entire source documents into every task.

An over-limit historical row is not deleted or rewritten. Decoding it fails
visibly rather than returning a misleading excerpt as a complete source. Plan
replacement reads revision metadata without decoding the old body, so an agent
can explicitly save a bounded new revision while retaining the original bytes.
Supplying a stale expected revision still fails and reports the current revision.
This is not a migration or backup implementation.

Observation hashing uses these same guards. An over-limit start follows the
existing capture-gap path; an over-limit completion leaves the saved start
available. No partial hash or successful observation is substituted. Native
execution still continues through the existing hook error handling. Independent
review and real-host exercise of these limit failures remain necessary.

When the shared context hashing allowance runs out, the affected record has
`contract_match: null` and `contract_match_reason: processing-limit`, not `false`.
`retrieval.contract_checks_omitted` counts records with unavailable comparisons.
Already computed comparisons remain usable for other records of the same scope.
Missing/changed contracts still report false where that comparison was made.
Neither true nor false is proof that code or external facts have been revalidated.

Sampling, source-excerpt warnings and exact record retrieval remain important.
The extra diagnostic metadata consumes output space: a very small context can
contain fewer excerpts. Consequential decisions still require reading complete
sources; neither this limit nor the benchmark proves preservation of meaning.

## Reproducible measurement

After compiling the real core, run:

```sh
bun run test:core
node tools/measure-processing.mjs
```

The script uses the real model, Store, SQLite and context path in an isolated
in-memory database. It builds 300 tasks with 219,265 serialized node characters,
30 conclusions and 1,000 routine observations. Each case has one uncounted warm-up
and ten measured iterations. Results include Node/SQLite/CPU information, median
and maximum time, output size, omitted comparisons, and native JSON serialization
volume. Fixture allocation/writes are not part of the timed read cases.

Observed locally on Node 22.16.0 / SQLite 3.49.1, Linux x64, AMD EPYC 9V74:

| Case | Baseline median ms | Changed median ms |
| --- | ---: | ---: |
| Validate the 300-task plan | 1.250 | 2.310 |
| Read stored Plan | 0.317 | 0.355 |
| Fingerprint the 300-task dependency closure | 1.413 | 1.602 |
| Context at 2,000 characters | 24.625 | 8.802 |
| Context at 64,000 characters | 57.908 | 10.936 |

The new checks add admission/hash overhead. Context savings partly come from
not performing every contract comparison: **11 records** had unavailable checks
in this fixture. The 2,000-character output contained four records instead of
five; the 64,000-character output contained 23 in both cases. These are trade-offs,
not a quality-equivalence or end-to-end speed claim.

For the compact read, the largest single native `JSON.stringify` result fell
from 263,820 to 901 characters, and total serialized volume from 4,920,786 to
1,107,581 characters. This metric includes serialization inside fingerprinting,
not just final rendering. Timing is illustrative and machine-dependent, not a
wall-clock guarantee. The script reruns the measurements; it does not assert
these particular timing values as a flaky CI threshold.

## Verification and E still open

The 22 focused tests cover aggregate limits, escapes, ordinary 300-task plans,
size/depth/visit bounds, alias expansion, cycles/accessors, hash compatibility,
write rollback, over-limit historical reads and explicit revision replacement,
start/completion capture failures, unknown rather than false contract status,
and limited compact serialization. The same suite had 3 passes / 19 failures
against the baseline; some failures concern newly introduced interfaces, not
19 distinct product defects. All 22 pass after the change, alongside the 26
previous capture/reload regression tests available in local verification.
Full SDK/native and complete core CI results must be read for the committed head.

**Remaining E work:** SQLite may materialize a large historical row before the
JavaScript length check; query scans, index creation and database I/O do not have
a total work budget. Native host input allocation, engine key enumeration,
proxy traps, YAML decoding/expansion and the process-wide capture-gap registry
are not bounded by this serializer. This is not a sandbox against hostile code
in the same process, a total memory limit, or an interruptible execution deadline.
The existing SQLite busy timeout is not a query-processing deadline.

The original F snapshot/transaction boundaries are retained. Independent review,
installed-host Research-to-Worker recovery with meaningful records, frozen CI
installation, backup/restore and retention remain separate. The committed
`bun.lock` is unchanged. Keep PR #180 draft; no scheduling or dashboard is added.

Reference: Node's [event-loop guidance](https://nodejs.org/en/learn/asynchronous-work/dont-block-the-event-loop)
explains why applying output truncation only after large JSON operations is not
a processing safeguard. Our limits and measurements above are project-specific.
