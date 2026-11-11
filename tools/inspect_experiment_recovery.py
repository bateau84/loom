#!/usr/bin/env python3
"""Read stopped-host snapshots for residual experimental Session instructions.

Only private copies are opened with SQLite. This tool does not withdraw entries,
repair databases, start OpenCode, qualify controls, or authorize Session reuse.
"""
from __future__ import annotations

import argparse
from contextlib import closing
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import re
import sqlite3
import stat
import sys
import tempfile

HOST_VERSION = "2.2.6"
ENTRY_KEY = "loom.live-instruction.v1"
STATE_KEY = "api/" + ENTRY_KEY
SIDECARS = ("", "-wal", "-shm", "-journal")
MAX_FILE_BYTES = 1024 * 1024 * 1024
MAX_ROWS = 10000
ID = re.compile(r"[A-Za-z0-9][A-Za-z0-9_.:-]{0,119}\Z")
SHA = re.compile(r"[0-9a-f]{64}\Z")
# Sorted migration IDs from anomalyco/opencode v2.2.6 (dc2ffcf8), not a host attestation.
NATIVE_MIGRATION_SHA256 = "eb4bb058405b639db90dfbcd13b31788dbeec71d28cc08bf2d43d72857767914"


def require(value, message):
    if not value:
        raise ValueError(message)


def digest(value):
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def checked_id(value):
    require(isinstance(value, str) and ID.fullmatch(value), "Invalid Session or trial identity")
    return value


def file_receipt(path, destination=None):
    """Refuse special files and detect replacement/change while reading."""
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    try:
        before = os.fstat(fd)
        require(stat.S_ISREG(before.st_mode), "Input is not a regular file")
        require(before.st_size <= MAX_FILE_BYTES, "Input exceeds 1 GiB inspection limit")
        hashed, size = hashlib.sha256(), 0
        with os.fdopen(os.dup(fd), "rb") as source:
            writer = None
            try:
                if destination is not None:
                    out = os.open(destination, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
                    writer = os.fdopen(out, "wb")
                while chunk := source.read(128 * 1024):
                    size += len(chunk)
                    require(size <= MAX_FILE_BYTES, "Input exceeds 1 GiB inspection limit")
                    hashed.update(chunk)
                    if writer:
                        writer.write(chunk)
            finally:
                if writer:
                    writer.close()
        after = os.fstat(fd)
        named = os.stat(path, follow_symlinks=False)
        signature = lambda s: (s.st_dev, s.st_ino, s.st_size, s.st_mtime_ns, s.st_ctime_ns)
        require(signature(before) == signature(after) == signature(named) and size == before.st_size,
                "Input changed during inspection; stop all writers")
        return {"bytes": size, "sha256": hashed.hexdigest()}
    finally:
        os.close(fd)


def inventory(path):
    require(path.is_absolute() and path.parent.resolve(strict=True) == path.parent,
            "Input paths must be absolute with canonical parents")
    result = {}
    for suffix in SIDECARS:
        member = Path(str(path) + suffix)
        if member.exists() or member.is_symlink():
            result[suffix] = file_receipt(member)
    require("" in result, "Missing database file")
    return result


def copy_snapshot(path, destination, expected):
    for suffix, receipt in expected.items():
        actual = file_receipt(Path(str(path) + suffix), Path(str(destination) + suffix))
        require(actual == receipt, "Input changed before copy; stop all writers")
    require(inventory(path) == expected, "Input or sidecar membership changed during copy")


def rows(db, sql, params=()):
    result = db.execute(sql, params).fetchmany(MAX_ROWS + 1)
    require(len(result) <= MAX_ROWS, "Inspection row limit exceeded; result is not complete")
    return result


def columns(db, table):
    # All table names are internal constants.
    return {r[1]: r[2].upper() for r in db.execute('PRAGMA table_info("' + table + '")')}


def require_columns(db, table, expected, *, exact=False):
    actual = columns(db, table)
    require((actual == expected if exact else all(actual.get(k) == v for k, v in expected.items())),
            "Unsupported database schema: " + table)


def native_evidence(db):
    require_columns(db, "migration", {"id": "TEXT", "time_completed": "INTEGER"}, exact=True)
    migrations = [r[0] for r in rows(db, "SELECT id FROM migration ORDER BY id")]
    require(all(isinstance(m, str) for m in migrations) and
            digest("\n".join(migrations)) == NATIVE_MIGRATION_SHA256,
            "Unsupported native migration inventory; exact OpenCode 2.2.6 required")
    require_columns(db, "session_v2", {"id": "TEXT", "project_id": "TEXT", "parent_id": "TEXT"})
    require_columns(db, "instruction_entry", {"session_id": "TEXT", "key": "TEXT", "value": "TEXT",
                    "removed": "INTEGER", "time_created": "INTEGER", "time_updated": "INTEGER"}, exact=True)
    require_columns(db, "instruction_state", {"session_id": "TEXT", "epoch_start": "INTEGER",
                    "through_seq": "INTEGER", "initial_values": "TEXT", "current_values": "TEXT"}, exact=True)
    sessions = {}
    for session, project, parent in rows(db, "SELECT id,project_id,parent_id FROM session_v2"):
        checked_id(session)
        require(session not in sessions and isinstance(project, str) and project, "Ambiguous native Session")
        if parent is not None:
            checked_id(parent)
        sessions[session] = {"session_id": session, "project_id": project, "parent_session_id": parent}
    evidence = {}
    for session, key, value, removed in rows(db, "SELECT session_id,key,value,removed FROM instruction_entry "
                                               "WHERE key LIKE 'loom.live-instruction.%'"):
        require(key == ENTRY_KEY, "Unsupported experimental native entry key")
        require(session in sessions and session not in evidence, "Ambiguous or orphaned native Session row")
        require(type(removed) is int and removed in (0, 1), "Invalid native removal state")
        content_sha = None
        if removed:
            require(value is None, "Malformed native withdrawal tombstone")
        else:
            require(isinstance(value, str) and len(value.encode("utf-8")) <= 1024 * 1024,
                    "Malformed or oversized native instruction")
            content = json.loads(value)
            require(isinstance(content, str), "Experimental native instruction is not text")
            content_sha = digest(content)
        evidence[session] = {"native_entry": "removed-tombstone" if removed else "present",
                             "native_content_sha256": content_sha, "instruction_history": False}
    # A fold can outlive entry removal and may be inherited by a native fork.
    for session, initial, current in rows(db, "SELECT session_id,initial_values,current_values FROM instruction_state"):
        require(session in sessions, "Instruction state references an unknown Session")
        for raw in (initial, current):
            require(isinstance(raw, str) and len(raw.encode("utf-8")) <= 1024 * 1024,
                    "Malformed or oversized native instruction state")
            values = json.loads(raw)
            require(isinstance(values, dict) and all(isinstance(k, str) and isinstance(v, str)
                    and SHA.fullmatch(v) for k, v in values.items()), "Malformed native instruction state")
            require(not any(k.startswith("api/loom.live-instruction.") and k != STATE_KEY for k in values),
                    "Unsupported experimental instruction history key")
            if STATE_KEY in values:
                entry = evidence.setdefault(session, {"native_entry": "absent", "native_content_sha256": None})
                entry["instruction_history"] = True
    return sessions, evidence


def learning_evidence(db):
    tables = {r[0] for r in db.execute("SELECT name FROM sqlite_schema WHERE type='table'")}
    require({"learning_candidates", "learning_trials"} <= tables, "Not a supported Loom learning database")
    if "learning_live_experiments" not in tables:
        require("learning_live_events" not in tables, "Partial experimental learning schema")
        return []
    require("learning_live_events" in tables, "Partial experimental learning schema")
    require_columns(db, "learning_live_experiments", {"id": "TEXT", "session_id": "TEXT",
                    "candidate_sha256": "TEXT", "candidate_id": "TEXT", "status": "TEXT"})
    require_columns(db, "learning_candidates", {"id": "TEXT", "content": "TEXT", "candidate_sha256": "TEXT"})
    result = []
    for trial, session, candidate, candidate_sha, status, content, stored_sha in rows(db,
            "SELECT e.id,e.session_id,e.candidate_id,e.candidate_sha256,e.status,c.content,c.candidate_sha256 "
            "FROM learning_live_experiments e LEFT JOIN learning_candidates c ON c.id=e.candidate_id"):
        checked_id(trial)
        checked_id(session)
        checked_id(candidate)
        require(isinstance(candidate_sha, str) and SHA.fullmatch(candidate_sha), "Malformed candidate fingerprint")
        require(status in {"installing", "assigned", "possible-exposure", "stopping", "stopped",
                           "recovery-required", "stop-uncertain"}, "Unknown archived experiment state")
        require(isinstance(content, str) and len(content.encode("utf-8")) <= 1024 * 1024 and
                digest(content) == stored_sha == candidate_sha, "Missing or changed archived candidate content")
        result.append({"session_id": session, "trial_id": trial, "candidate_sha256": candidate_sha,
                       "archived_status": status})
    return result


def inspect(native, learning, *, host_version, writers_stopped):
    require(writers_stopped is True, "Stop all native/Loom writers and acknowledge --writers-stopped")
    require(host_version == HOST_VERSION, "Only exact OpenCode 2.2.6 is supported")
    inputs = [Path(native), *map(Path, learning)]
    require(len(inputs) <= 33 and len(set(inputs)) == len(inputs), "Duplicate or excessive database inputs")
    receipts = [inventory(p) for p in inputs]
    require(sum(file["bytes"] for receipt in receipts for file in receipt.values()) <= 2 * MAX_FILE_BYTES,
            "Combined inputs exceed 2 GiB inspection limit")
    with tempfile.TemporaryDirectory(prefix="loom-experiment-inspect-") as temporary:
        snapshots = []
        for index, (path, receipt) in enumerate(zip(inputs, receipts)):
            copy = Path(temporary) / (str(index) + ".sqlite")
            copy_snapshot(path, copy, receipt)
            snapshots.append(copy)
        # This comparison spans the whole paired copy, not just individual files.
        require(all(inventory(p) == r for p, r in zip(inputs, receipts)), "Paired inputs changed during copy")
        snapshots_data = []
        for index, snapshot in enumerate(snapshots):
            with closing(sqlite3.connect(snapshot.as_uri() + "?mode=rw", uri=True)) as db:
                db.execute("PRAGMA query_only=ON")
                db.execute("PRAGMA trusted_schema=OFF")
                require(db.execute("PRAGMA quick_check").fetchall() == [("ok",)], "Database integrity check failed")
                require(not db.execute("PRAGMA foreign_key_check").fetchmany(1), "Database foreign-key check failed")
                snapshots_data.append(native_evidence(db) if index == 0 else learning_evidence(db))
    sessions, native_rows = snapshots_data[0]
    trials = {}
    for database in snapshots_data[1:]:
        for row in database:
            require(row["session_id"] not in trials, "Duplicate or mixed archived Session assignments")
            trials[row["session_id"]] = row
    results, blockers = [], []
    for session in sorted(set(native_rows) | set(trials)):
        native_row = native_rows.get(session, {"native_entry": "absent", "native_content_sha256": None,
                                               "instruction_history": False})
        trial = trials.get(session)
        reasons = []
        if session not in sessions:
            reasons.append("native-session-missing")
        if native_row["native_entry"] == "present":
            reasons.append("native-treatment-present")
            if trial is None:
                reasons.append("assignment-history-unavailable")
            elif trial["archived_status"] == "stopped":
                reasons.append("entry-present-after-stopped-state")
            if trial and native_row["native_content_sha256"] != trial["candidate_sha256"]:
                reasons.append("native-candidate-content-drift")
        if trial and trial["archived_status"] != "stopped":
            reasons.append("archived-withdrawal-unconfirmed")
        blockers.extend({"session_id": session, "reason": reason} for reason in reasons)
        results.append({**sessions.get(session, {"session_id": session}), **native_row,
                        "trial": trial, "control_eligible": False, "exposure": "possible-or-historical",
                        "recovery_blockers": reasons})
    return {"format": "loom-experiment-recovery/v1", "observed_at": datetime.now(timezone.utc).isoformat(),
            "host_version_operator_reported": host_version, "native_migration_sha256": NATIVE_MIGRATION_SHA256,
            "writers_stopped": "operator-asserted", "sqlite_version": sqlite3.sqlite_version,
            "snapshot_files": [{"input": i, "files": receipt} for i, receipt in enumerate(receipts)],
            "native_sessions_scanned": len(sessions), "learning_databases_scanned": len(learning),
            "active_native_entries": sum(r["native_entry"] == "present" for r in results),
            "status": "RECOVERY_REQUIRED" if blockers else "NO_ACTIVE_ENTRY_IN_SNAPSHOT",
            "sessions": results, "blockers": blockers, "session_reuse_authorized": False,
            "clean_controls_qualified": False,
            "coverage_limit": "Stopped snapshot inspection only; supplied files are not host attestations. "
            "No claim about missing/deleted history, omitted learning databases, other host databases, later writes, "
            "child eligibility, actual provider exposure, or complete audit events. Entry absence never erases prior exposure."}


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--native-db", required=True, type=Path)
    parser.add_argument("--learning-db", action="append", default=[], type=Path)
    parser.add_argument("--host-version", required=True)
    parser.add_argument("--writers-stopped", action="store_true")
    parser.add_argument("--report", required=True, type=Path)
    args = parser.parse_args(argv)
    try:
        require(args.report.is_absolute() and args.report.parent.resolve(strict=True) == args.report.parent,
                "Report parent must already exist and be canonical")
        # An absent WAL/SHM/journal is still an input-owned path. Creating JSON
        # there would damage native state despite read-only SQLite inspection.
        reserved = {Path(str(path) + suffix).resolve(strict=False)
                    for path in (args.native_db, *args.learning_db) for suffix in SIDECARS}
        require(args.report.resolve(strict=False) not in reserved,
                "Report destination overlaps an input database or reserved sidecar")
        report = inspect(args.native_db, args.learning_db, host_version=args.host_version,
                         writers_stopped=args.writers_stopped)
        fd = os.open(args.report, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        with os.fdopen(fd, "w", encoding="utf-8") as stream:
            json.dump(report, stream, indent=2)
            stream.write("\n")
        print(json.dumps({"status": report["status"], "active_native_entries": report["active_native_entries"],
                          "session_reuse_authorized": False}))
        return 1 if report["blockers"] else 0
    except (json.JSONDecodeError, OSError, sqlite3.Error, UnicodeError):
        print("RECOVERY_UNPROVEN: unsupported, inconsistent, unreadable input or unavailable report destination", file=sys.stderr)
        return 2
    except ValueError as error:
        # Only tool-authored messages reach here; I/O/SQLite/decoder errors may
        # contain private paths or source bytes and are handled above.
        print("RECOVERY_UNPROVEN: " + str(error), file=sys.stderr)
        return 2


if __name__ == "__main__":
    sys.exit(main())
