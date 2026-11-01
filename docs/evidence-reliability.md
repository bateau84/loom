---
type: Architecture
title: "Evidence pairing and capture recovery"
description: "Explains evidence capture pairing, failure gaps and recovery limits."
tags: [loom, evidence, reliability]
timestamp: 2026-10-24T00:00:00Z
---

# Evidence pairing and capture recovery

This change addresses findings **A** (same-tool Code Mode cross-pairing) and
**C** (lost correlation after a failed write and the pending-call capacity limit)
from the review of `204afd5`. It does not claim to complete the other findings.

## Host boundary

The pinned OpenCode v2.0.18 Code Mode implementation passes the outer tool context
to nested calls. Session, message, call ID and tool name therefore identify a
**group**, not necessarily a unique invocation:

https://github.com/anomalyco/opencode/blob/v2.0.18/packages/core/src/codemode/tool.ts#L83-L95

Loom records every observed start. It does not discard a second start because
its IDs or input match the first. A finish links to a start only when there is
exactly one saved start for the group, no earlier saved finish, the same observer
generation and actor, and matching input metadata. An input digest is a mismatch
check, never a way to choose between overlapping invocations.

A group with multiple starts remains ambiguous, even when calls were sequential
or all but one finish arrived. FIFO, elapsed time and matching inputs do not
establish which invocation a late completion belongs to. Ambiguous finishes keep
their host IDs, input/result digests and status when capture is enabled, but have
no `start_id`, Action,
Task or contract fingerprint. Their starts retain their known original scopes.
This deliberately prefers incomplete attribution over fabricated evidence.

## Persistence and failures

Correlation reads saved observation rows, using an index and at most two starts
and one finish per lookup. Start scope/contract capture and finish pairing use
transactions. A failed finish digest or insert leaves the start available for a
later retry. A successful finish cannot be linked to the same start a second time.

There is no in-memory pending-call collection, timeout eviction, or 1,024-call
ceiling. Interrupted starts remain historical records without success status;
1,100 interrupted starts are covered by a regression test. This removes the
memory-capacity failure, **not** the need for future on-disk retention policy.

A failed before hook, or a skipped same-key before hook while capture is off,
marks that host/database capture scope as degraded. Subsequent finishes stay unpaired:
otherwise an unrecorded sibling could consume an earlier start. Any skipped start
also marks later starts as following a capture gap, even after capture is enabled
again. This prevents an older uncaptured invocation from borrowing a new start.
Previously captured, different-key starts can still finish with their original
attribution when no matching start was missed. Native execution is not blocked;
new starts can still be recorded after storage recovers. This conservative gap
status outlives plugin instances and module reloads in the same host process.
`loom_agents` exposes the pairing state and `gap_scope: host-process/database`.

The pinned Bun source loader reloads modules in the same JavaScript host. A
`Symbol.for` registry on `globalThis`, keyed by the canonical SQLite path, keeps
two monotonic gap flags outside that module graph. Closing/reopening a connection,
replacing a Store or Observer, loading a new module graph, and failed storage
writes do not reset those flags. No call identifiers, inputs, outputs or digests
are kept in the registry. In-memory test databases use weak connection keys.
File-scope entries are retained until host exit, not evicted while a late call
might remain. This is not a total memory/processing bound or a security boundary.

A replacement still gets a distinct observer epoch, but the receiving epoch is
not evidence of where an uncaptured invocation began. Known gap state is shared
by old and new observers; a late failure reported by the old observer also
invalidates pairing in its replacement. Reused captured keys remain ambiguous.
A complete host-process restart permits new distinct calls; a plugin reload does
not clear a known gap. Cross-process event forwarding is not supported by this
in-process guard and must not be inferred from it.

**Install this repair with a full OpenCode host restart.** The pre-repair code
did not retain its gap flags outside the old instance. A hot upgrade cannot
reconstruct that already-lost knowledge. Do not move active state between paths
or replace the host's global registry while native calls are running.

There is no automatic retry of native work, replay of missing completions,
inference of completion, or new user-facing lifecycle gate.

### Capture-off contract

`ledger.capture: off` skips new starts. The after hook reads the effective setting
rather than bypassing it because a historical start exists. It may finish only a
previously captured, uniquely attributable in-flight call. Eligibility requires
one saved start and no saved finish, and the transaction rechecks all pairing
conditions. Settled/reused keys and ambiguous, gap-affected, missing-start or
cross-generation completions produce no new observation while capture is off.
Previously saved starts remain; suppression is not proof of completion.

Skipped hooks retain only the negative gap flags in process memory. This is not
capture of their status, identifiers or digests into the ledger. When capture is
re-enabled, uncertain finishes may again be recorded as unpaired diagnostics.
Explicit user/agent ledger writes are separate from automatic capture opt-out.

This assumes the host delivers the observed before/after hooks as documented.
It cannot detect every hook that the host never delivers, establish continuity
across process failure, or defend the database against other same-user programs.
Records created by the earlier buggy implementation are not retroactively fixed
or certified by adding this change.

## Inspection without changing work

`loom_agents` exposes `evidence.capture`, `evidence.pairing`, and the explicit
restart-continuity limitation. The execution hook warns when a finish is unpaired.
Use the existing ledger tool to inspect the current Session, including unassigned
finishes, without clearing or switching its selected Task:

```json
{ "operation": "query", "session_only": true }
```

This is an option of `loom_record`, not a new tool. Work-ID filters cannot be
combined with it, and it is not accepted for writes. The same paging and exact
`record_id` lookup remain available. Assessment/QA records and claims are unchanged;
a link to an observation still does not prove a claim.

## Verification and remaining work

`tests/observer-reliability.test.mjs` exercises overlapping and identical-input
calls, out-of-order completion, scope switches/replanning, duplicate/late events,
SQLite insert failures, digest failures, disabled capture, interrupted starts,
restart/reopen, two database connections, namespacing and raw-data exclusion.
The original interrupted-call test now sends one start; repeated starts are tested
separately and are no longer incorrectly required to be discarded.

The registered-plugin native test also covers shared Code Mode IDs, reverse
completion order, session-only inspection, unchanged selection, and disabled
capture during overlap. It uses a fake host and real Bun/SQLite, not a live CLI.

The follow-up `tests/reload-capture-review.test.mjs` covers skipped/failed capture,
module-graph and file-connection replacement, identical inputs, changed selection,
reversed finishes, old-observer late failure, scope isolation, settled-key opt-out,
in-flight completion, and escaped-prefix context. The registered-plugin tests
include SQLite-triggered start failure and replacement of the active hook set.
Run the complete native/SDK suites and installed-host sequence separately; source
and simulated-hook probes do not establish installed-host hot-reload acceptance.

Context sampling, snapshot reads and missing-task recovery now have their own
regression tests; their limits remain documented in the accompanying guides.
Total processing limits (E), broader consistency (F), operation diagnostics,
frozen dependencies, backup/restore, live two-agent resumption and independent
review remain open. Dashboards, scheduling and legacy import remain out of scope.

Pinned reload source: https://github.com/anomalyco/opencode/blob/v2.0.18/packages/plugin/src/source.bun.ts
SQLite database identity: https://www.sqlite.org/pragma.html#pragma_database_list
