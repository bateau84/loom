---
type: Playbook
title: "Inspecting deferred Session experiment state"
description: "Read-only stopped-host detection of native treatment entries and retained exposure history before recovery or downgrade."
tags: [loom, learning, recovery, opencode]
timestamp: 2026-11-11T00:00:00Z
---

# Inspecting deferred Session experiment state

`tools/inspect_experiment_recovery.py` finds residual treatment entries when an
operator has used the deferred #225/#228 controller. It reads **private copies**
of stopped OpenCode and Loom database files. It does not start a host, send a
model request, delete an entry, change a trial, or permit Session reuse.

Ordinary installations of the bounded release never shipped this controller.
The scanner is an explicit operator action. It adds no `entry.list` call or
other dependency to ordinary Loom requests.

## What the report establishes

The scanner checks all native Sessions in the **one supplied native database**,
including child Sessions, and compares the archived assignment rows in the
supplied learning databases. It detects active native treatment with missing
learning history, native entries surviving a recorded stop, candidate drift,
unfinished installation or withdrawal, and missing native Sessions. It does
not infer a child's eligibility from its parent.

OpenCode 2.2.6 retains removed entries as tombstones, while the public entry-list
API hides them. The scanner preserves those tombstones and references to the
treatment key in the native instruction-state fold. A removed entry can still
have appeared in earlier context. **No scanned Session becomes a certified
clean control.** A missing learning database never turns an existing native
entry or tombstone into an unexposed Session.

| Output | Meaning and action |
| --- | --- |
| `RECOVERY_REQUIRED` / exit 1 | At least one native treatment or unresolved archived transition remains. Keep the affected Sessions isolated. Use the original qualified recovery path after all pending writers have settled. |
| `NO_ACTIVE_ENTRY_IN_SNAPSHOT` / exit 0 | No active key or unresolved supplied assignment was found in this snapshot. This is not approval to resume or proof of no historical exposure. |
| `RECOVERY_UNPROVEN` / exit 2 | Inputs were unreadable, changed, malformed, oversized, ambiguous, or unsupported, or the report could not be written. Resolve the named input problem and repeat while writers remain stopped. No successful report is produced. |

Every successful report sets `session_reuse_authorized: false` and
`clean_controls_qualified: false`. It includes source-file SHA-256 receipts,
native Session identities, candidate hashes, retained exposure uncertainty and
specific blockers. It omits candidate text, messages, authorization strings and
credentials. Protect the report anyway: Session/project IDs are identifiers.

## Run against stopped state

1. Record the actual installed version with `opencode --version`. Only exact
   **2.2.6** is supported. The report records this as operator-supplied version
   evidence; neither a CLI argument nor a database hash is a host attestation.
2. Stop every OpenCode process using the database, all Loom writers and pending
   experiment enrollment/withdrawal. The tool cannot prove that you did this.
   Keep them stopped through inspection and any later recovery decision.
3. Identify the native database actually used by that host. The CLI can use an
   `OPENCODE_DB` override or a channel-specific filename. Do not choose an empty
   default path merely because it exists. Supply each relevant archived Loom
   `learning.sqlite` explicitly; missing or omitted histories remain unknown.
4. Choose a new report path in an existing private directory, then run:

```bash
python3 tools/inspect_experiment_recovery.py \
  --native-db /absolute/path/to/opencode.db \
  --learning-db /absolute/path/to/actions-v1/project-scope/learning.sqlite \
  --host-version 2.2.6 \
  --writers-stopped \
  --report /absolute/path/to/private/recovery-before.json
```

Repeat `--learning-db` for additional known project scopes. If no learning
database survives, omit it; native entry detection still runs and the report
states that zero learning databases were inspected. It cannot reconstruct
deleted assignment or authorization history.

Never delete `-wal`, `-shm` or `-journal` files to make inspection succeed.
The scanner copies every present sidecar, verifies file membership and hashes
before/after the complete copy, and opens only its temporary copies with
SQLite. This preserves committed residual WAL data without modifying sources.
Active writers are unsupported even if a particular scan sees no changed byte.

After an authorized withdrawal using the preserved controller or an explicitly
reviewed native recovery operation, stop writers again and retain a **new**
report. Do not overwrite the earlier receipt. Native removal, retirement,
learning-state restore and plugin removal are different operations. A report
cannot prevent a late in-flight PUT; stopping every writer is essential.
The report destination cannot be any input database or its reserved WAL/SHM/
journal path, including a sidecar that does not yet exist. That check runs before
inspection so writing a report cannot create invalid source-side database state.

## Supported storage boundary

The Linux/POSIX scanner's native migration-ID digest and consumed table shapes are pinned to
`anomalyco/opencode` v2.2.6, commit
`dc2ffcf8bf26f9e669b6aa22b95f50e12be15e06`. Unknown migration inventories,
instruction schema changes, treatment-key versions and archived trial states
fail closed. The scanner requires regular non-symlink files, limits each file
to 1 GiB and combined inputs to 2 GiB, and rejects result sets exceeding
10,000 rows instead of claiming a truncated scan is complete.

Sources inspected:

- [Native entry storage and tombstone behavior](https://github.com/anomalyco/opencode/blob/v2.2.6/packages/core/src/session/instruction-entry.ts).
- [Native Session, instruction-entry and fold tables](https://github.com/anomalyco/opencode/blob/v2.2.6/packages/core/src/session/sql.ts).
- [Instruction-state fold and fork baseline](https://github.com/anomalyco/opencode/blob/v2.2.6/packages/core/src/session/instruction-state.ts).
- [Exact native migration inventory](https://github.com/anomalyco/opencode/blob/v2.2.6/packages/core/src/database/migration.gen.ts).
- [Preserved deferred controller](https://github.com/bateau84/loom/blob/deferred/authorized-session-experiments-20261111/src/live-experiments.ts).

The scan does not read complete transcript/event history or certify provider
exposure. It cannot prove absence of previously deleted state, inspect another
native database, certify later writes, or authenticate caller-supplied files.
It does not restore missing native state from the separate
[Loom paired backup](manual-backup-restore.md).

## Verification and remaining controller obligations

Run the ordinary Python suite or the focused scanner regressions:

```bash
python3 -m unittest discover -s tests -p test_experiment_recovery.py -v
```

The component tests use explicit external storage fixtures and real SQLite
files. They exercise orphan detection, retained exposure after withdrawal,
uncertain transitions, candidate drift, malformed/unknown state, source-copy
change detection, bounded input handling and committed residual WAL. They do
not prove native host behavior by themselves.

For native creation, withdrawal and restart, install the pinned dependencies
and exact external CLI, then run the storage-only disposable-host test:

```bash
python3 tests/installed_experiment_recovery.py \
  --opencode /absolute/path/to/isolated-host/node_modules/.bin/opencode \
  --report-directory /absolute/path/to/new-native-recovery-report
```

This runner uses the actual host's public Session/entry operations to produce
the state, stops the host, invokes the production scanner, reopens the host,
withdraws the test entry, stops it again and verifies retained tombstones. It
sends no prompt. Its PASS is scoped to native storage inspection and restart,
not genuine human approval or model exposure.

Live experiments remain disabled. Before restoring a controller, its owner
still needs a host-owned authorization receipt; atomic or fenced entry writes
that cannot arrive after withdrawal; a durable inventory that survives loss of
learning state; qualified child admission; explicit delivery-route exclusions;
and bounded audit history with disclosed omissions. An ordinary request cannot
become dependent on an unreliable global entry scan. The offline scanner does
not claim to solve those online concurrency and trust boundaries. See
[the migration boundary](migration.md) and authoritative
[issue #227](https://github.com/bateau84/loom/issues/227).
