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
their host IDs, input/result digests and status, but have no `start_id`, Action,
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
marks that observer's pairing as degraded. Subsequent finishes stay unpaired:
otherwise an unrecorded sibling could consume an earlier start. Any skipped start
also marks later starts as following a capture gap, even after capture is enabled
again. This prevents an older uncaptured invocation from borrowing a new start.
Previously captured, different-key starts can still finish with their original
attribution when no matching start was missed. Native execution is not blocked;
new starts can still be recorded after storage recovers. This conservative gap
status lasts for the observer instance and is exposed by `loom_agents`.

A new plugin instance has a new observer generation. It can read interrupted
history, but late finishes from the old instance are not treated as proven
continuous capture. New, distinct calls can pair normally. Reused old keys stay
ambiguous; a restart does not erase that history. There is no automatic retry of
native work, no inference of completion, and no new user-facing lifecycle gate.

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

Still outstanding from the review: useful-context ranking and truncation,
consistent and bounded context reads, removed-task recovery notices, other
configuration/operation gaps, a frozen dependency install, live two-agent
handoff/resumption and an independent implementation review. Dashboards,
scheduling and legacy import remain outside this reliability change.
