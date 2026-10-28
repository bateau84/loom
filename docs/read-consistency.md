---
type: Architecture
title: "Read consistency: focused finding F audit"
description: "Analyzes guarantees and known gaps in read consistency across Loom state."
tags: [loom, storage, consistency]
timestamp: 2026-10-24T00:00:00Z
---

# Read consistency: focused finding F audit

Audited input: `35254ea8a0b468490c202286e9932060b7765afc` (including the
user's committed `bun.lock`). The original finding concerned combinations of
Action, Plan and contract status read from different database versions. This
follow-up audits the remaining paths; it does not make every API call part of
one global transaction or freeze work against later changes.

## Finding and correction

`Store.select()` previously read and hashed an Action/Plan to check a reference,
then saved its IDs in a separate statement. A controlled two-connection SQLite
probe reproduced a task removal committing after validation but before the focus
write. The operation then saved a reference that was already invalid.

Selection now validates existence and saves the reference in one `BEGIN IMMEDIATE`
transaction. Action-only selection checks the Action; task selection also checks
the node in its current Plan. No fingerprint is calculated: selection records
identity, not a reviewed contract. The lock ends at commit/rollback. A concurrent
writer either commits before validation (and the removed reference is rejected)
or after selection; the latter may legitimately make selection historical.

Creating an Action already has a write transaction. It saves the newly created
Action's initial selection inside that transaction using a private write helper,
not a nested transaction. Failed selection writes or commits preserve the prior
focus; failed creation rolls back both Action and initial selection. There are
no retries, permission gates or long-lived execution locks added here.

`Store.contractMatch()` had no production caller or declared package entrypoint;
Its tracked callers were test assertions in the core, observer-reliability and
selection-recovery suites. It has been removed rather than given another
transaction. All seven former assertions now read `contract_match` through
`taskContext()`, the same snapshot-based path used in production. This preserves
the changed/unchanged/removed-contract checks. The first full CI run caught four
missed test callers; the follow-up migrates them without dropping assertions.

## Audited operations and their actual guarantees

| Operation | Consistency contract and disposition |
| --- | --- |
| `taskContext()` / recovery | Action, current Plan, sampled records and all contract comparisons use one existing read snapshot. Missing-node recovery describes that snapshot. Unchanged. |
| `contextRecords()` | Internal sampling helper called inside the context snapshot in production. It does not promise an independent snapshot when called alone. No added transaction. |
| `select()` | Reference existence and selection write are atomic. Selection neither stores nor freezes a contract revision. Corrected. |
| `create()` | Action insertion and initial selection remain one existing write transaction. The private selection writer avoids nesting. |
| `startObservation()` | Selected IDs, available current contract and start record share the existing write transaction. A removed selected node keeps its historical IDs without a fabricated current fingerprint. Unchanged. |
| `record()` | Current subject fingerprint, referenced-evidence validation and record insertion share the existing write transaction. Unchanged. This does not validate the truth of the statement or freshness of its evidence. |
| `finishObservation()` | Starts, earlier finishes and the appended pairing decision are checked in the existing write transaction. Unchanged. |
| `hasUnfinishedObservationStart()` | Advisory eligibility only; it may become stale. `finishObservation()` rechecks before assigning evidence or admitting a capture-off completion. No added snapshot. |
| `plan()` | Returns one serialized Plan revision. The separate Action read is an existence check, not an Action/Plan pair returned to the caller. No Action deletion API exists in this version. No added snapshot. |
| `records()` | Each page comes from one query over append-only records; Action existence is checked separately. Later pages may include new appends. No cross-page frozen view is promised. |
| `action()`, `list()`, `selected()`, `hasSelection()` | Each reads one statement. Selected IDs can be historical. No added transaction. |
| `captureScope()` | Reads database identity for the existing host-process guard, not an Action/Plan/ledger bundle. Unchanged. |
| `update()`, `savePlan()` | Existing revision checks and writes remain transactional. Separate calls are not a combined Action-and-Plan update. Unchanged. |

## A snapshot is not a lease

Current question/answer writes add a separate boundary: `BEGIN IMMEDIATE` validates
the question, checks ANY prior committed answer and appends/commits the response.
Firstness eligibility exists only immediately after commit, not in durable recovery
state. Native resume and its separate SYSTEM outcome annotation occur afterward;
there is no transaction spanning SQLite and native input. A target ownership check
is not an atomic lease, and a timeout does not cancel started native I/O.

`full_thread` uses one local read transaction per page for eligible relation
selection/reserved hydration, then renders escaped Markdown. Direct question/answer
relations, deduplicated IDs and sequence order govern membership; no native Session
read or recursive evidence expansion occurs. Scope/location/version-bound cursors
continue labelled partial records, advancing only after their final part. Invalid,
changed, corrupt or unsupported continuation fails without advancing. Pages are
not a frozen concurrent snapshot and cursors are not promised perpetual validity.
See [collaboration](collaboration.md) (section **Full stored relational history**).

The explicit `loom_context` tool obtains a context snapshot and then revalidates
selection when supplied IDs should be selected. Those are separate boundaries:
returned context describes its own read revision, not a promise that no edit
occurred before selection or after the response. If a task disappears between
those boundaries, selection fails without replacing the old focus. A later
context read supplies the current snapshot or the existing recovery notice.
Similarly, the automatic hook may read selected IDs before opening its context
snapshot; this is not an atomic snapshot of Session selection plus project state.

After a successful selection, another agent may change the goal or Plan or remove
the node. That is allowed, not evidence corruption. Subsequent context reads and
fingerprint capture use their own consistent boundaries. Callers must not treat
an earlier response, eligibility hint or matching fingerprint as an execution
grant, a frozen review result or permanent current validity.

A database snapshot reflects one committed database state. It does not make two
separately committed goal/Plan edits one semantic change. Multi-call edits,
configuration/agent-registry reads, native execution and filesystem changes are
not covered by a cross-system snapshot guarantee.

## Verification and closure boundary

`tests/read-consistency.test.mjs` uses the real Store/SQLite path and two file-backed
connections. A small forwarding adapter controls the exact point at which the
second connection attempts a write; it does not supply expected database results.
The selection/removal counterexample fails on the audited input and passes after
the correction. Additional cases cover before/after removal, stale context versus
selection, Action-only selection, invalid inputs, clear, write/commit failures,
creation rollback, existing start/result fingerprint transactions, advisory
eligibility rechecks, and append-only pagination. The 14 focused tests pass locally.

This closes the focused F implementation audit for the contracts above, subject
to full-suite verification and independent review of the committed change. It
is not universal read serializability, performance acceptance, a real multi-agent
run, or acceptance of the assembled plugin on an installed OpenCode host. No new
installed-host scenario or independent Reviewer gate was performed by this audit.

E (total input/processing limits), live Research-to-Worker recovery with meaningful
records, frozen CI installation and backup/restore remain separate. The existing
`bun.lock` is preserved; tracking it does not by itself enable frozen CI installs.
No schemas, tools, observer logic, context sampling, permissions or orchestration
are changed here.

SQLite references: [transactions](https://www.sqlite.org/lang_transaction.html)
and [isolation](https://www.sqlite.org/isolation.html). In particular, write-intent
transactions serialize competing writers; ordinary BEGIN transactions do not nest.
