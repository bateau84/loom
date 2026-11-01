---
type: Playbook
title: "Manual stopped-writers backup and restore"
description: "Describes manual stopped-writer backup and restore of Loom state."
tags: [loom, backup, recovery]
timestamp: 2026-10-24T00:00:00Z
---

# Manual stopped-writers backup and restore

This is an offline, operator-initiated procedure for the Action Store, not the
legacy configuration exporter. It preserves the original files and restores to a
**separate, previously nonexistent directory**. It does not install the restored
state into a running host, migrate schemas, or repair damaged data.

This is the manual procedure referenced by the [alpha operating policy](operating-policy.md)
and the repository `README.md`. Keep it separate from the configuration exporter and
the narrow empty-sender-table startup compatibility upgrade described in
[migration guide](migration.md) (section **State and rollback**). A successful restore
comparison is not authorization to start a sender or evidence of general legacy
schema compatibility.

## Prerequisites and boundaries

- Stop **every writer and SQLite connection** to this project Store, including
  other OpenCode hosts, plugins and inspection tools. Prevent automatic restart
  until copying finishes. A quiet UI or `ledger.capture: off` is not enough.
  Use your host's normal shutdown procedure; these commands do not stop anything.
  If you cannot establish this prerequisite, do not copy.
- Identify the exact source from your deployment, not a filename search or the
  first hash directory found. Current `src/plugin.ts` uses
  `${XDG_STATE_HOME}/loom/actions-v1/<projectScope>/ledger.sqlite` when the state
  home is absolute, otherwise `~/.local/state/loom/actions-v1/...`.
  `projectScope` hashes the native project ID and canonical project path.
- Use Python 3.11+ with stdlib SQLite/JSON support, trusted local directories, and
  enough free space for a backup, restore and inspection copies. Keep all output
  private: ledger text and Session IDs may be sensitive. No new dependency is
  needed. Do not use this procedure against untrusted files or concurrent actors.
- Record the installed Loom commit/package version, Bun version, native host
  version, project identity/canonical path and source path alongside the backup.
  This procedure targets the current `PRAGMA user_version=1` Store. That number
  alone is not complete version provenance: use the same Loom revision for
  application verification. Do not point a newer build at the originals.
- This backs up Loom state only: not native OpenCode Sessions, configuration,
  credentials, repository files or external `artifact_refs` contents.

## 1. Copy the stopped file set

Save the following block as `copy-ledger.py` in your private operator scratch
directory. It never opens the source with SQLite. It copies the main database and
every applicable `-wal`, `-shm` and `-journal` sidecar under unchanged basenames.
Do not delete, checkpoint, rename or mix sidecars from different snapshots.
WAL can contain committed records absent from the main file.

<!-- backup-copy: executed verbatim by the native regression -->
```python
import hashlib
import os
from pathlib import Path
import shutil
import stat
import sys

def require(condition, message):
    if not condition:
        raise SystemExit(message)

def checksum(path):
    with path.open("rb") as handle:
        return hashlib.file_digest(handle, "sha256").hexdigest()

require(os.environ.get("LOOM_WRITERS_STOPPED") == "yes",
        "Confirm all writers/connections stopped: LOOM_WRITERS_STOPPED=yes")
require(len(sys.argv) == 3, "usage: copy-ledger.py SOURCE_DB NEW_DIRECTORY")
source, destination = map(Path, sys.argv[1:])
require(source.is_absolute() and destination.is_absolute(), "Use absolute paths")
require(source.name == "ledger.sqlite", "Expected explicit ledger.sqlite source")
require(source.parent.resolve() == source.parent, "Source parent must be canonical")
require(destination.parent.resolve() == destination.parent, "Destination parent must be canonical")
require(not destination.is_relative_to(source.parent), "Destination must be outside source directory")
paths = [source] + sorted(source.parent.glob(source.name + "-*"))
allowed = {source.name + suffix for suffix in ("", "-wal", "-shm", "-journal")}
for path in paths:
    require(path.name in allowed, "Unknown sidecar: " + path.name)
    require(stat.S_ISREG(path.lstat().st_mode), "Not a regular file: " + str(path))
before = {path.name: checksum(path) for path in paths}
# Atomic reservation refuses files, directories and dangling symlinks alike.
destination.mkdir(mode=0o700)
for path in paths:
    with path.open("rb") as reader, (destination / path.name).open("xb") as writer:
        shutil.copyfileobj(reader, writer)
    (destination / path.name).chmod(0o600)
require(before == {path.name: checksum(path) for path in paths}, "Source changed; reject copy")
require(before == {path.name: checksum(destination / path.name) for path in paths}, "Copy mismatch")
require(set(paths) == {source, *source.parent.glob(source.name + "-*")}, "File set changed; reject copy")
print("Copied stopped file set:", before)
```

In a shell, substitute **absolute, canonical paths** with existing trusted parent
directories. The four data directories below must be distinct; none may exist
yet except the source directory. Use a new name on failure; partial output is not
a verified backup and is deliberately left for diagnosis, never overwritten.

```sh
export LOOM_WRITERS_STOPPED=yes  # operator assertion, NOT automatic detection
SOURCE=/absolute/source/projectScope/ledger.sqlite
BACKUP=/absolute/private/backup-2026-10-16
RESTORED=/absolute/private/restored-2026-10-16
REFERENCE=/absolute/private/reference-2026-10-16
CHECK=/absolute/private/check-2026-10-16
python3 copy-ledger.py "$SOURCE" "$BACKUP"
```

Only continue after exit status 0. Preserve `SOURCE` and `BACKUP` untouched. The
checksum list proves file identity, **not** database health or meaningful state.
The stopped-writers prerequisite, not a checksum race detector, establishes a
consistent snapshot. Filesystem/device failure and power-loss durability are not
certified by this procedure.

## 2. Restore and verify on separate copies

While connections remain stopped, use the same block to restore the backup and
make two expendable inspection copies. SQLite may recover/checkpoint or rebuild
shared memory on these copies; never perform verification on the originals or
the preserved backup. `RESTORED` is also left unopened during this comparison.

```sh
python3 copy-ledger.py "$BACKUP/ledger.sqlite" "$RESTORED"
python3 copy-ledger.py "$BACKUP/ledger.sqlite" "$REFERENCE"
python3 copy-ledger.py "$RESTORED/ledger.sqlite" "$CHECK"
```

Save this second block as `verify-ledger.py`. It opens only existing inspection
files, checks integrity and foreign keys, and compares the schema and **every SQL
row**, including record qualifications, fingerprints, sequence order, selections,
historical Action definitions and delivery bookkeeping. It emits a full audit
for human inspection, not an empty-database boot check.

<!-- backup-verify: executed verbatim by the native regression -->
```python
from contextlib import ExitStack, closing
from itertools import zip_longest
import json
from pathlib import Path
import sqlite3
import sys

def require(condition, message):
    if not condition:
        raise SystemExit(message)

require(len(sys.argv) == 3, "usage: verify-ledger.py REFERENCE_DB CHECK_DB")
paths = [Path(arg).resolve(strict=True) for arg in sys.argv[1:]]
require(paths[0] != paths[1], "Inspection copies must be separate")
with ExitStack() as stack:
    databases = [stack.enter_context(closing(sqlite3.connect(path.as_uri() + "?mode=rw", uri=True)))
                 for path in paths]
    for db in databases:
        db.execute("PRAGMA query_only=ON")
        require(db.execute("PRAGMA user_version").fetchone() == (1,), "Unsupported Store version")
        require(db.execute("PRAGMA integrity_check").fetchall() == [("ok",)], "Integrity check failed")
        require(not db.execute("PRAGMA foreign_key_check").fetchall(), "Foreign key check failed")
    schema = "SELECT type,name,tbl_name,sql FROM sqlite_schema ORDER BY type,name"
    require(databases[0].execute(schema).fetchall() == databases[1].execute(schema).fetchall(), "Schema differs")
    tables = [row[0] for row in databases[0].execute("SELECT name FROM sqlite_schema WHERE type='table' ORDER BY name")]
    require({"actions", "plans", "ledger", "focus", "action_versions", "primary_deliveries"}.issubset(tables), "Missing Store tables")
    for table in tables:
        # Quote identifiers discovered from sqlite_schema, never interpolate raw input.
        quoted = '"' + table.replace('"', '""') + '"'
        cursors = [db.execute("SELECT * FROM " + quoted + " ORDER BY rowid") for db in databases]
        columns = [column[0] for column in cursors[0].description]
        count = 0
        for original, restored in zip_longest(*cursors):
            require(original == restored, "SQL content differs in " + table)
            count += 1
            print("ROW", table, json.dumps(dict(zip(columns, restored)), ensure_ascii=False))
        print("TABLE", table, count)
    print("PASS: identical SQL state and intact SQLite; inspect meaningful records below the file-copy level")
```

```sh
# Refuse an existing report too; use a new private report path for each run.
(set -C; python3 verify-ledger.py "$REFERENCE/ledger.sqlite" "$CHECK/ledger.sqlite" > /absolute/private/restore-audit.txt)
```

Require exit status 0 **and** check the audit against known work, not just counts:

- Match actual Action IDs, titles/goals and Action revisions. Check each saved Plan
  revision, including removed Tasks, `parent` and `depends_on` relationships.
- Locate known result, claim, assessment and QA IDs: full `statement`, `verdict`,
  `artifact_refs`, `verification`, Action/Task IDs and `fingerprint` must retain
  qualifications. `evidence_ids` must still name the original observations.
- Match a uniquely paired finish's `start_id` and original scope. An interrupted
  `started` record still has no inferred finish. Ambiguous finishes retain their
  diagnostic attribution and lack `start_id`, Action/Task and fingerprint; inspect
  Session-wide rows too, since Action-only queries omit unassigned finishes.
- Where present, check completion `work_ref` revisions/hash and original
  `work_goal`, reopen history, question/answer `question_id` links, assignment
  identities and delivery intents/events/fences. Answers are responses, not
  approval; completion reports are not acceptance. Saved selection is historical
  context, not native Session restoration.

For application-level verification use the **same Loom revision** on `CHECK`,
never the preserved copies. The automated regression below demonstrates this
with the real Store, including historical contracts and qualification-sensitive
context. If records are unreadable, missing or different, stop and diagnose;
do not create a replacement empty Store or call the restore successful.

## 3. Keep the boundary honest

Keep `SOURCE`, `BACKUP`, provenance and successful audit. Treat `REFERENCE` and
`CHECK` as disposable, not as backup originals. Choosing a deployment location
and re-enabling writers is a separate operator decision; this procedure does not
overwrite an existing live location or change project identity/routing. Restored
delivery state can include pending or uncertain sends: **do not start a native
sender during inspection**. A restored local fence cannot establish what a native
host admitted after the snapshot. Do not retry native work based on this copy.

Restoration does **not** replay missing events, infer interrupted invocation
success, restore in-memory capture-gap flags/observer epochs, certify unfinished
work, or guarantee native Session continuity. See [evidence pairing and capture
recovery](evidence-reliability.md).

## Repeatable isolated proof

From a checkout with its frozen-lock dependencies and required Bun runtime:

```sh
bun test tests/manual-backup-restore.test.ts
```

The test executes both Python blocks above against its own real Store fixtures
under the host temporary directory (`TMPDIR` if set), with `ALP02-*` names. It
checks a clean close and stopped-process residual WAL, preserved originals,
meaningful restored records/relationships, and refusal to overwrite existing
destinations. It is not evidence from a production Store, an online-backup claim,
native-host continuity proof or overall alpha acceptance.

Observed qualification from base `a5e27a13f93947891ceeba15dd75e58c7ab2ee7c`
(`loom-plugin` `2.0.0-alpha.1`): Bun 1.4.3 / SQLite 3.53.4 and Python 3.12.3 /
SQLite 3.45.1, Store schema 1. The three focused tests passed with 177 assertions.
Both round trips retained 20 ledger rows, two Plan revisions, one historical
Action version and one delivery fence. The clean fixture retained two Actions;
the residual-WAL fixture retained a third, WAL-only Action. Omitting WAL,
removing a result's qualification, or substituting an empty Store failed
verification. The repository's `.bun-version` pin is 1.4.2; this run used 1.4.3.
