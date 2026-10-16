# E follow-up: bounded retrieval, configuration audit, and closure boundary

Baseline: `83de434`. This follows [Processing limits](processing-limits.md).
It bounds text returned from SQLite to JavaScript and avoids loading discarded
context candidates. It does not close all of E or establish live-host acceptance.

## Stored text before JavaScript allocation

Every Store query that returns a JSON body now guards that column with SQL CASE
and `octet_length(data)`. Above the byte ceiling, SQL returns NULL instead of the
body, and the existing parser raises `LOOM_PROCESSING_LIMIT`. No prefix is parsed,
no shortened hash is manufactured, and no historical bytes are rewritten.
`hasSelection()` reads a constant rather than a body it only needs to detect.

The existing exact limits count UTF-16 code units. SQLite's octet length counts
bytes in the database encoding. The SQL ceiling is **three times** the existing
character limit so it does not reject permitted multibyte text merely because
bytes and characters differ. Thus a Plan body transfers at most 1,572,864 stored
bytes, and an Action, focus or ledger body at most 393,216. The existing 524,288 /
131,072 character checks still apply after this bounded transfer. Text above the
character limit but below the conservative byte ceiling can reach JavaScript;
that does not bypass the character check.

SQLite documents that octet_length of a TEXT/BLOB table column can use metadata
without reading its content. CASE evaluates only the selected branch. This is
not a promise that every SQLite operation avoids reading that row: JSON indexes,
corruption handling, writes and index construction are separate costs.

## Metadata first, then selected bodies

Ledger pages first select at most 51 small `(seq, data_bytes)` candidates. Their
lookahead row never has its body loaded. Context preserves the prior ordering
and sampling: up to 16 conclusion scopes, two records per kind/scope, 48 final
conclusions and eight observations. It gathers candidate metadata, selects the
final sample, then loads only those bodies.

The selected ledger body set is limited to **4,194,304 stored bytes** before the
body query runs: at most 50 records for a page, or 56 for context. The body query
rechecks each reserved size in SQL. A body growing between metadata and body
queries cannot exceed its reservation at the driver boundary. A missing record
or failed check is an error, not a successful incomplete page.

This budget applies to the selected ledger set, not all process allocations.
Action/Plan reads, JS decoded objects and runtime/SQLite overhead are additional.
An Action list remains limited to 51 guarded rows, not to this 4 MiB ledger budget.
Evidence-reference validation may make up to 100 separately guarded reads.

Context uses its existing read snapshot across both phases. Ledger paging fixes
membership in its initial query over append-only records; later appends may
appear on subsequent pages. No cross-page snapshot or long-lived read lock is
added. External same-user tampering is not made safe by the reservation check.
See [Read consistency](read-consistency.md).

## Avoiding growing-history scans

Four additional indexes support Action/Task pages, Session/Task pages, all-Action
observations, and scoped observations. Conclusion indexes remain unchanged.
Instead of scanning recent unrelated rows until enough observations match, each
relevant scope reads at most nine ordered observation candidates. Merging these
small heads produces the same newest eight across the union of scopes.

There can be at most 300 input node IDs plus the Action-level scope: at most
2,709 observation candidates, plus 192 conclusion candidates, before selection.
The input count is checked before iterating that list. Small metadata counts do
not imply a fixed SQLite VM-step or wall-clock budget. Query-plan regressions
verify indexed lookups with no history-wide scan or temporary sort for the tested
scoped queries. Planner behavior on other engines/data distributions, cold I/O,
Action-list OFFSET traversal, index construction and total disk retention remain
outside this proof. The additional indexes cost disk space and write work; an
existing large database must build them when this version first opens it.

## Retrieval-only measurements

After compiling the core, run `node tools/measure-retrieval.mjs`. An optional
second argument names a separately compiled baseline Store module. The fixture
uses real Store/SQLite calls, two relevant tasks, 24 conclusion rows, 16 relevant
observations and later unrelated observations in the same Action. It measures
retrieval inside the context snapshot, **not** fingerprinting, context rendering,
model execution or a complete agent task. Each case uses five warmups and twenty
iterations on an in-memory database.

Local Node 22.16.0 / SQLite 3.49.1, Linux x64:

| Unrelated observations | Baseline median | Updated median |
| --- | ---: | ---: |
| 1,000 | 1.052 ms | 0.542 ms |
| 10,000 | 7.680 ms | 0.530 ms |
| 50,000 | 39.188 ms | 0.506 ms |

All cases selected identical record IDs in identical order. Ledger body transfers
fell from 33 to 24; metadata-plus-body result rows rose from 33 to 64. This is a
payload/query trade-off, not a claim that fewer SQL calls run. The old observation
plan searched by Action and filtered unrelated nodes; the new plan also searches
by node. These are reproducible warm examples, not timing acceptance thresholds,
constant-time proofs, peak-memory results, or guaranteed laptop performance.

## Configuration decoding: investigated, still open

`loadConfig()` currently checks the file's stat size, reads it, checks its byte
length, then calls the decoder before merging and schema validation. Those
checks do not cap the decoder's transient allocations. The stat/readFile pair
also does not bound allocation if a file grows between the two operations.
No runtime configuration or parser change is made in this follow-up.

`bun tools/probe-config-decoding.ts` characterizes five fixed small inputs:
ordinary roles, role aliases, a six-level/fanout-six alias graph, a cyclic alias,
and 100 nested arrays. Each runs in its own child process with a five-second
probe timeout. Reports record source size, reachable object/reference counts,
RSS before/after decoding, decode time, and subsequent schema acceptance/errors.
The inputs are deliberately finite, not an attempt to exhaust the machine.

Bun documents aliases as shared collection identities, potentially cyclic. That
means alias count alone is not proof of eager deep-copy expansion. Conversely,
small reachable graphs or end-of-decode RSS do not bound temporary parser memory,
merge expansion or every YAML input. The probe records actual tested-runtime
behavior; current documentation is not assumed to prove every supported release.
The probe timeout is **not** a limit installed in Loom's live decoder.

A future configuration correction must bound the file read itself and establish
decoder-level limits or an explicitly reviewed restricted input format/boundary.
Rejecting a graph only after decoding must not be called a pre-allocation bound.

## Preserved is not necessarily readable

An individually oversized record still fails exact retrieval. An oversized
selected set fails without silently skipping the offending records; smaller
`loom_record` pages or exact IDs can read individually admissible records.
Omitted lookahead/candidate records remain indicated by the existing has-more
flags, and explicit reads of oversized ones still fail. A bounded new Plan can
replace an oversized old revision without deleting or decoding its old body.

Do not delete records, edit the database in place or raise limits blindly merely
to make context appear complete. Preserve the database for offline recovery.
There is not yet a tested large-record export or backup/restore command; this
change does not convert legacy-export guidance into state-backup proof.

## Precise E closure criteria

A bounded E acceptance claim should cover ordinary plugin inputs and owned work:
finite admission before expensive copies, bounded traversal/hash/render loops,
bounded database text transfer with tested hot-query access paths, and truthful
failure without invented evidence or silent data loss. It must also cover the
configuration decoder/read boundary and explicitly account for startup/index and
retention costs. The last items remain open here; E is not declared closed.

It should not claim an OS memory quota, exact I/O latency, a bound on allocation
OpenCode already performed before calling Loom, or containment of hostile code
sharing the process. Those are different boundaries, not properties established
by a character counter or an SQL index. Independent review and installed-host
Research → Worker → removal → recovery → fresh-session resumption remain separate.

No scheduling, dashboard, new tool, permission engine or evidence pairing policy
is added. The committed lockfile and dependency versions remain untouched.

Sources: [SQLite octet_length](https://www.sqlite.org/lang_corefunc.html#octet_length),
[CASE evaluation](https://www.sqlite.org/lang_expr.html#the_case_expression),
[Bun YAML API](https://bun.com/reference/bun/YAML), and the checked
`src/config.ts` loader at the baseline above.
