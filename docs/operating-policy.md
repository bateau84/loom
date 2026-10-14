# Alpha operating contract: protect recovery before refusing history

Status: **contract-first, partial implementation**. Based on `a4c258f` and the
subsequent operating-policy discussion. The configuration admission lifecycle
below is implemented by this change. History capacity modes, guarded index
preparation and their qualification tests are **not implemented by this change**.
No storage threshold is enabled. E remains open.

Loom remembers work; it does not control whether OpenCode may execute it.
A storage limit must not make the remembered work inaccessible or invent a
successful recording. Preserve the five tools, native permissions, and separate
old/new databases. Do not introduce scheduling, automatic pruning or rotation.

## 1. Targets are not yet a supported capacity statement

| Candidate qualification target | Unit and meaning | Status |
| --- | --- | --- |
| 100,000 ledger rows | All observations, claims, results, Assessment and QA; a start and finish are separate rows | Not qualified or enforced |
| 256 MiB active database | Allocated logical database pages, including tables, indexes and free pages; measure the main file separately | Not qualified or enforced |
| 64 MiB WAL pressure | Observed WAL file size, not a hard disk quota | Not qualified or enforced |
| 80% early warning | Informational pressure notice, not a rejection threshold | Not implemented |
| One active configuration load, eight waiting | In the host JavaScript realm containing the plugin, across instances and reloads | Implemented; see section 5 |

Both row and database targets must be qualified with disk-backed fixtures before
advertising a usable capacity-limited alpha. A 50,000-row in-memory retrieval
example is not such qualification. Main-file length can lag logical database
state while changes remain in WAL. Page size, freelist, WAL, shared-memory and
other temporary files must be reported separately. The table is not a combined
whole-process or total-disk allowance.

## 2. Recovery access is distinct from admitting retained history

The future storage mode is per database, not per agent or workflow. A restricted
mode must retain the tools even when opening for history writes is refused.

| Operation in capacity-restricted mode | Required behavior |
| --- | --- |
| Action listing, Plan/history/context reads | Available where the existing schema, indexes and read budgets permit; no history write required |
| Selection or clearing | Navigation, not a ledger append. Ledger-row capacity alone must not forbid it. Validate/save atomically if storage permits; otherwise report the failed navigation separately |
| Explicit context IDs | Return the successful read even if saving selection fails; include `selection_update` with `saved: false`, the actual previous selection and the reason |
| Diagnostics | Report mode, observed pressure, unavailable operations and required maintenance without opening for history writes |
| New Actions, changed Actions, Plan revisions, ledger appends | Refuse when their applicable capacity admission fails; never report a successful skipped write |
| Maintenance | Explicit operator path, outside ordinary agent execution; unavailable until its safety tests exist |

Selection is not an unlimited exception to database or WAL limits. A navigation
write that cannot meet the storage contract may fail. In that case the context
payload and navigation result must remain separately visible. Do not say the new
work was selected, clear the old reference silently, or substitute another task.
Subsequent automatic context follows the actual saved reference. The response
must tell the agent to supply the desired IDs for further request-scoped reads.
A failed clear must not return `selected: null` if the prior selection survived.
No unbounded session-memory fallback or hidden second persistence store is added.

Current `loom_context` still saves selection after reading and can throw if that
save fails. The above partial-outcome behavior is a required implementation/test,
not a claim that this contract alone fixes it. Invalid IDs, missing tasks, unknown
Actions and unreadable/corrupt data retain distinct outcomes. A context snapshot
remains a snapshot, not a lease preventing a later Plan edit.

At recording capacity, native execution continues. A refused start must mark the
existing conservative capture gap. A refused finish leaves its saved start
incomplete, not successful. There is no automatic native retry or invented
completion reservation. An accepted last row can be a start whose finish is later
refused; diagnostics must explain that incomplete capture.

## 3. Atomic admission and permitted growth

### Ledger rows

The row allowance check and its append must occur in the **same write
transaction**. A status query outside that transaction is advisory only. A
concurrent writer cannot use that earlier answer as permission to append.
A transaction proposing `k` rows commits only when `current + k <= limit`.
At the exact limit no new ledger row is admitted. Failed writes/commits roll back
both the append and any capacity counter. Existing larger databases are not
truncated, counted as empty, or silently replaced.

No index-wide count scan may be smuggled into each append. Any counter or bounded
count strategy needs its own initialization, concurrent-writer and recovery
proof. Plan/focus growth consumes database space even though it does not consume
ledger rows.

### Database pages and physical files

For an enabled logical page ceiling, **zero committed logical-page overshoot**
is the required outcome for ordinary history mutations and index preparation.
Admission must reserve/enforce growth or validate the resulting page allocation
before commit and roll back. Checking file length before a write is insufficient.
An already oversized database remains eligible for recovery reads; opening it
must not silently clamp, shrink, rebuild or replace it.

This postcondition does not imply that rollback writes no bytes, or that the
physical main file, WAL, journal, cache and temporary files together fit the same
limit. Qualification must measure successful and failed-operation growth on the
pinned engines, including index creation and held readers.

### WAL pressure and overshoot: not yet qualified

The 64 MiB value is an **observed pre-operation pressure target**, not an
allocation cap. A writer below it may grow the WAL. Repeated changes to the same
logical pages can grow WAL without growing the logical database. Checkpointing
may be held back by readers; the normal path must not forcibly discard readers
or silently truncate history to reclaim room.

There is **no accepted numeric overshoot allowance yet**. Before enabling a WAL
capacity policy, implementation must establish a finite per-operation growth
allowance (including failed/rolled-back operations) and enforce/account for it
under serialized writers. Record both the pre-observation threshold and that
allowance, and test the maximum boundary. Do not label input size, a timeout,
post-operation RSS or an observed timing sample as a dirty-page/disk bound.

Until this is demonstrated or the policy is explicitly revised, physical-growth
qualification and capacity-enabled release remain blocked. This document does
not invent a hidden hard quota or a supposedly harmless unlimited one-operation
overshoot. The configuration queue can be used independently of that work.

## 4. Startup, indexes and retention

Startup must first establish schema compatibility and bounded size metadata.
It must not run optional expensive index construction on large existing history
before checking the applicable maintenance policy. Initialize new empty stores
normally; retain existing compatible stores without rebuilding complete indexes.
Missing indexes on history outside the qualified range require explicit offline
preparation, with a read/diagnostic-capable plugin meanwhile.

A missing optional index does not authorize an unbounded replacement scan. Expose
supported exact-ID/limited reads where their existing access paths permit it;
report other operations as temporarily unavailable. Unsupported/corrupt schemas
may restrict access to diagnostics. Never turn an unreadable database into a new
empty successful one. Index failure must roll back partial preparation or leave
an explicitly recoverable state, preserve records and keep diagnostic tools.
Synchronous SQLite work has no promised wall-clock deadline merely because its
elapsed time is measured.

The current Store constructor still creates missing indexes synchronously.
Read/diagnostic-only startup is required follow-up work, not implemented here.
No automated retention, expiry, pruning, rotation, rewriting, or summarization-
as-replacement is allowed. Old correlation information must not disappear in a
way that makes reused host call keys apparently unique. A warning/limited mode
is not an archive. **Preserved history can still be unreadable through normal
record-size limits.**

Tested backup/export/restore is a release prerequisite before calling write
refusal a usable alpha experience. It may be implemented separately, but a
capacity-limited release without a demonstrated escape path is not accepted.
Backups must include meaningful records and verification of restored selections,
Plan revisions, claims/reviews, interrupted starts and correlation ambiguity.
The existing legacy-config exporter and empty-ledger boot test do not prove this.

## 5. Configuration admission lifecycle (implemented in this change)

`loadConfig()` admits one active load and at most eight FIFO waiters. One slot
covers all three sequential layers, decoding, validation and descriptor cleanup.
Every caller performs its own fresh reads after admission. No cached successful
configuration, shared result, cross-file snapshot or retry loop is introduced.
Direct internal calls to `readConfigSource()` are not this admission entrypoint;
all production plugin config reads use `loadConfig()`.

A single `globalThis`/`Symbol.for` state object holds the active flag and bounded
queue. Replacement modules use the same state; disposing one plugin cancels its
own requests, not another instance's requests and not the global queue. There is
no per-project admission registry to grow. This is a **host JavaScript realm**
limit. Separate processes/workers have separate state; same-process hostile code
is not contained by this mechanism.

- Success, parser/file failure and synchronous errors release the active slot
  after the admitted operation settles, including its close attempt.
- Pre-cancelled callers take no capacity. Cancelled waiters are removed promptly,
  have their abort listener detached and never start I/O/decoding.
- Active cancellation promptly returns a named failed configuration to its
  caller, but retains the active slot until real I/O and cleanup settle. Further
  layer/read/decoder steps check cancellation at their supported boundaries.
  A late error is consumed; no successful configuration is published afterward.
- Full-queue rejection is `LOOM_CONFIG_LOAD_OVERFLOW`; cancellation is
  `LOOM_CONFIG_LOAD_CANCELLED`. Both return the existing disabled injection/new-
  capture configuration, with no stale roles. The context hook removes stale
  Loom instruction/context blocks; a skipped before hook retains conservative
  evidence-gap behavior. No rejected load is described as successful capture.
- Tool invocations pass the host's abort signal and check cancellation before
  subsequent Store operations. Plugin disposal aborts its pending loads before
  deregistering hooks/closing storage. A callback resumed after disposal must
  not use closed Store state or publish old injected context.

Pinned OpenCode 2.0.18 tool executions have a signal; its context and tool
before/after hook interfaces do **not** provide individual caller signals. Those
hooks use the plugin lifetime signal. Ordinary Session interruption is therefore
not claimed to cancel their queue entries. Where a host supplies no cancellation,
a waiter remains until admitted or plugin disposal. Do not invent upstream APIs
or claim cancellation of native execution.

**Bounded queue length is not bounded waiting time.** Slow/stuck filesystem calls
can hold the active slot. Aborting the caller cannot safely free it while its I/O
still runs. No I/O deadline or synchronous-parser preemption is added. Calls to
`loom_agents` expose `config_loads` (active/waiting limits and no wait deadline),
but are themselves ordinary config consumers: a queued diagnostic call can wait;
a full queue returns failure diagnostics without joining it. General host API
latency is outside this queue.

The first live upgrade from code without this admission state must be done when
old loads have drained, preferably with a full host restart. It cannot retroactively
count loads that the previous implementation never registered. Subsequent
in-process replacements retain admission while old I/O finishes.

## 6. Qualification and regression matrix

| Requirement | Required proof | Status in this change |
| --- | --- | --- |
| One active / seven, eight, ninth waiters | Below/at/above, FIFO, overflow performs no I/O | Implemented tests |
| Slot lifecycle | Open/stat/read/close/parse failures, cancellation before admission/during I/O/close, listener cleanup | Implemented tests |
| Reload/disposal | Separate evaluated module graphs retain queue; old caller cancellation does not reset replacement capacity | Implemented tests |
| Stale settings and skipped capture | Registered plugin overflow removes guidance and cannot lend a later start to the missed call | Implemented simulated-host test |
| Cancelled tools | No Store mutation after queued tool cancellation | Implemented simulated-host test |
| Ledger count | N-1/N/N+1 on disk, two contending processes for last slot, failed append/commit | Pending storage implementation |
| DB/WAL boundaries | Target minus one page/at/above; index and mutation growth, held reader, rollback spill, bounded permitted growth | Pending qualification; no numeric overshoot accepted |
| Index preparation | Missing/existing/failed indexes, below/at/above qualified history; no record rewrite; recovery tools retained | Pending storage implementation |
| Fresh-session recovery at refusal | Real records; useful context survives failed selection save; truthful failed clear; no hidden history append | Pending storage implementation |
| Backup/restore exit path | Nonempty restored history, exact record IDs and ambiguity, damaged backup rejection | Pending release prerequisite |

Run the current regression commands with frozen dependencies. Configuration
admission tests are not disk-backed capacity tests or independent acceptance.
The installed-host boot probe remains load/equivalent-empty-ledger evidence, not
Research -> Worker -> task removal -> explicit recovery -> fresh-session proof.

No feature expansion is authorized by this contract. E can close only for its
stated implemented and qualified operations, with remaining OS/runtime/host
boundaries explicit and independent acceptance recorded separately.

## Sources and related contracts

- [Pinned host tool signals and hook interfaces](https://github.com/anomalyco/opencode/blob/v2.0.18/packages/plugin/src/promise/tool.ts)
- [Pinned context hook interface](https://github.com/anomalyco/opencode/blob/v2.0.18/packages/plugin/src/promise/session.ts)
- [AbortSignal lifecycle](https://nodejs.org/download/release/v22.15.0/docs/api/globals.html#event-abort)
- [SQLite WAL checkpoint/readers and growth](https://www.sqlite.org/wal.html)
- [Read consistency](read-consistency.md), [retrieval](retrieval-limits.md), [parser](configuration-parser.md), [file reads](configuration-limits.md)
