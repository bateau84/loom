#!/usr/bin/env python3
"""Offline, manifest-bound backup/restore for Loom Action and learning SQLite state.

Never opens source or preserved backup databases with SQLite. All SQLite checks
run on disposable copies. Does not stop writers, repair files, migrate schemas,
touch native sessions, or authorize work.
"""
import argparse
from contextlib import closing
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import sqlite3
import stat
import sys
import tempfile
from uuid import uuid4

FORMAT = "loom-stopped-state/v1"
MANIFEST = "loom-state-manifest.json"
DATABASES = ("ledger.sqlite", "learning.sqlite")
SIDECARS = ("-wal", "-shm", "-journal")
REQUIRED_TABLES = {
    # Historical sender/fence tables are optional in fresh installations.
    "ledger.sqlite": {
        "actions", "plans", "ledger", "focus", "action_versions",
    },
    "learning.sqlite": {"learning_candidates", "learning_trials"},
}
REQUIRED_COLUMNS = {
    "learning_candidates": {
        "id", "created_at", "author_session", "author_agent", "target_kind",
        "target_id", "base_sha256", "candidate_sha256", "content",
        "hypothesis", "evidence_refs", "status", "revised_from",
    },
    "learning_trials": {
        "id", "candidate_id", "recorded_at", "session_id", "agent",
        "observed_sha256", "observed_effect", "statement", "evidence_refs",
    },
}
# Mirrors evaluation schema v1 in src/evaluation-store.ts. No evaluation tables
# means legacy state; a partial schema must never be certified as that legacy.
EVALUATION_COLUMNS = {
    "learning_evaluation_schema": {"singleton", "version"},
    "learning_evaluation_batches": {
        "sequence", "id", "identity", "owner_session", "scope_key", "source_store_id",
        "boundary_json", "method_json", "membership_sha256", "revision", "previous_batch_id",
        "state", "blocked_reason", "claim_token", "worker_id", "lease_until_ms",
        "created_at", "updated_at", "report_id",
    },
    "learning_evaluation_members": {"batch_id", "key", "ordinal", "kind", "source_refs", "report_id"},
    "learning_evaluation_reports": {
        "id", "batch_id", "member_key", "slot", "created_at", "body_json", "qualifications_json", "sha256",
    },
    "learning_evaluation_dependencies": {"report_id", "source_key", "source_ref"},
    "learning_evaluation_invalidations": {"sequence", "batch_id", "source_key", "reason", "recorded_at"},
    "learning_evaluation_opportunities": {"session_id", "state", "reason", "generation", "updated_at"},
}
REVIEW_COLUMNS = {
    "review_store_identity": {"singleton", "store_id"},
    "review_requests": {"request_id", "requester_session", "data", "membership_data", "created_at"},
    "review_relationships": {"sequence", "id", "request_id", "data"},
    "review_issue_intents": {
        "sequence", "intent_key", "request_id", "attempt_id", "intent_data",
        "decision_ref", "decision_data", "state", "claimant_id",
        "rejection_reason", "native_outcome", "created_at", "claimed_at", "updated_at",
    },
    "review_issue_outcomes": {
        "sequence", "attempt_id", "status", "source_ref", "reason", "recorded_at",
    },
}


def require(condition, message):
    if not condition:
        raise ValueError(message)


def sha256(path):
    with path.open("rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()


def project_scope(project_id, canonical):
    # Matches src/plugin.ts digest({ project, canonical }) and model.ts canonical().
    encoded = json.dumps(
        {"canonical": canonical, "project": project_id},
        sort_keys=True, ensure_ascii=False, separators=(",", ":"),
    )
    return hashlib.sha256(encoded.encode("utf-8")).hexdigest()


def location(value, existing=False):
    path = Path(value)
    require(path.is_absolute(), "Paths must be absolute")
    parent = path.parent
    require(parent.is_dir() and parent.resolve(strict=True) == parent,
            "Destination/source parent must exist and be canonical: " + str(parent))
    if existing:
        require(path.is_dir() and not path.is_symlink(),
                "Source/backup must be an ordinary directory: " + str(path))
        require(path.resolve(strict=True) == path, "Directory must be canonical: " + str(path))
    return path


def inventory(directory, manifest=False):
    allowed = {name + suffix for name in DATABASES for suffix in ("", *SIDECARS)}
    entries = {}
    for path in directory.iterdir():
        if path.name == MANIFEST and manifest:
            continue
        require(path.name in allowed, "Unexpected backup/source file: " + path.name)
        require(stat.S_ISREG(path.lstat().st_mode),
                "Not an ordinary file (symlinks refused): " + str(path))
        entries[path.name] = {"size": path.stat().st_size, "sha256": sha256(path)}
    require("ledger.sqlite" in entries, "Missing required ledger.sqlite")
    for name in DATABASES:
        if name not in entries:
            require(not any(name + suffix in entries for suffix in SIDECARS),
                    "Orphan sidecar without " + name)
    return dict(sorted(entries.items()))


def copy_files(src, dst, names):
    for name in names:
        with (src / name).open("rb") as reader, (dst / name).open("xb") as writer:
            shutil.copyfileobj(reader, writer)
        (dst / name).chmod(0o600)


def inspect_sql(directory, file_names):
    # SQLite can recover a WAL or create/change -shm even for reads. Never
    # run it on source, backup, or restored state; only on private scratch.
    results = {}
    with tempfile.TemporaryDirectory(prefix="loom-state-inspect-") as scratch:
        inspected = Path(scratch)
        copy_files(directory, inspected, file_names)
        for name in DATABASES:
            if name not in file_names:
                continue
            uri = (inspected / name).as_uri() + "?mode=rw"
            with closing(sqlite3.connect(uri, uri=True)) as db:
                db.execute("PRAGMA query_only=ON")
                version = db.execute("PRAGMA user_version").fetchone()[0]
                supported_versions = (1, 2) if name == "ledger.sqlite" else (0,)
                require(version in supported_versions,
                        f"Unsupported {name} user_version={version}; expected one of {supported_versions}")
                require(db.execute("PRAGMA integrity_check").fetchall() == [("ok",)],
                        "Integrity check failed: " + name)
                require(not db.execute("PRAGMA foreign_key_check").fetchall(),
                        "Foreign key check failed: " + name)
                schema = db.execute(
                    "SELECT type,name,tbl_name,sql FROM sqlite_schema "
                    "ORDER BY type,name,tbl_name"
                ).fetchall()
                tables = {row[1] for row in schema if row[0] == "table"}
                required_columns = REQUIRED_COLUMNS if name == "learning.sqlite" else (
                    REVIEW_COLUMNS if version == 2 else {}
                )
                has_evaluation = name == "learning.sqlite" and any(
                    table.startswith("learning_evaluation_") for table in tables
                )
                if has_evaluation:
                    required_columns = {**required_columns, **EVALUATION_COLUMNS}
                required_tables = REQUIRED_TABLES[name] | set(required_columns)
                require(required_tables <= tables,
                        "Missing required " + name + " tables: " +
                        ", ".join(sorted(required_tables - tables)))
                for table, required in required_columns.items():
                    columns = {row[1] for row in db.execute(
                        'PRAGMA table_info("' + table + '")'
                    )}
                    require(required <= columns,
                            "Incompatible " + table + " columns: " +
                            ", ".join(sorted(required - columns)))
                if has_evaluation:
                    markers = db.execute(
                        "SELECT singleton,version FROM learning_evaluation_schema"
                    ).fetchall()
                    require(len(markers) == 1 and markers[0][0] == 1,
                            "Missing or invalid evaluation schema marker")
                    require(markers[0][1] == 1,
                            "Unsupported evaluation schema version: " + str(markers[0][1]))
                if name == "ledger.sqlite" and version == 2:
                    identity = db.execute(
                        "SELECT singleton,store_id FROM review_store_identity"
                    ).fetchall()
                    require(len(identity) == 1 and identity[0][0] == 1
                            and isinstance(identity[0][1], str)
                            and re.fullmatch(r"[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,119}", identity[0][1]),
                            "Missing or invalid review source-store identity; no replacement identity is authorized")
                schema_hash = hashlib.sha256(json.dumps(
                    schema, ensure_ascii=False, separators=(",", ":"),
                ).encode("utf-8")).hexdigest()
                results[name] = {
                    "user_version": version,
                    "schema_sha256": schema_hash,
                    "sqlite_version_checked_with": sqlite3.sqlite_version,
                }
    return results


def validate_backup(backup, args):
    manifest_path = backup / MANIFEST
    require(manifest_path.exists() and stat.S_ISREG(manifest_path.lstat().st_mode),
            "Missing or non-regular backup manifest: incomplete/unidentified set")
    data = json.loads(manifest_path.read_text(encoding="utf-8"))
    require(isinstance(data, dict) and data.get("format") == FORMAT,
            "Unsupported or missing backup-set format")
    require(isinstance(data.get("set_id"), str) and
            re.fullmatch(r"[0-9a-f-]{36}", data["set_id"]),
            "Invalid backup set identity")
    identity = {
        "id": args.project_id,
        "canonical": args.project_canonical,
        "scope": project_scope(args.project_id, args.project_canonical),
    }
    require(data.get("project") == identity, "Backup project identity mismatch")
    require(data.get("loom_revision") == args.loom_revision,
            "Backup Loom revision mismatch; inspect with exact recorded revision")
    require(data.get("package_version") == args.package_version,
            "Backup Loom package version mismatch")
    require(data.get("learning") in ("present", "absent-pre-learning"),
            "Unknown learning database membership")
    actual = inventory(backup, manifest=True)
    require(data.get("files") == actual,
            "Backup file membership, size or SHA-256 mismatch (missing/mixed/corrupt set)")
    learning_present = "learning.sqlite" in actual
    require(learning_present == (data["learning"] == "present"),
            "Learning membership differs from manifest; incomplete backup")
    expected = data.get("databases")
    require(isinstance(expected, dict) and
            set(expected) == (set(DATABASES) if learning_present else {"ledger.sqlite"}),
            "Backup database membership is incomplete")
    actual_sql = inspect_sql(backup, actual.keys())
    require(actual_sql == expected,
            "Backup SQLite format/schema differs from manifest; incompatible set")
    return data, actual


def stopped():
    require(os.environ.get("LOOM_WRITERS_STOPPED") == "yes",
            "Stop all relevant writers/connections and prevent restart; "
            "then explicitly set LOOM_WRITERS_STOPPED=yes (operator assertion only)")


def do_backup(args):
    stopped()
    source = location(args.source_dir, existing=True)
    backup = location(args.backup_dir)
    scope = project_scope(args.project_id, args.project_canonical)
    require(source.name == scope, "Source directory name does not match project scope")
    require(not backup.exists() and not backup.is_symlink(),
            "Backup destination exists; refusal to overwrite")
    require(not backup.is_relative_to(source) and not source.is_relative_to(backup),
            "Backup must be outside source state")
    before = inventory(source)
    learning_present = "learning.sqlite" in before
    require(learning_present != args.legacy_no_learning,
            "If learning.sqlite is absent, explicitly use --legacy-no-learning; "
            "if present, omit that flag")
    backup.mkdir(mode=0o700)
    copy_files(source, backup, before)
    require(inventory(source) == before, "Source changed during snapshot; reject partial copy")
    require(inventory(backup) == before, "File copy differs; reject partial copy")
    sql = inspect_sql(backup, before.keys())
    # Recheck after inspection. The stopped-writers condition, not these hashes,
    # is the cross-database consistency guarantee.
    require(inventory(source) == before and inventory(backup) == before,
            "Files changed during verification; reject partial copy")
    data = {
        "format": FORMAT,
        "set_id": str(uuid4()),
        "created_at": datetime.now(timezone.utc).isoformat(),
        "project": {"id": args.project_id, "canonical": args.project_canonical, "scope": scope},
        "loom_revision": args.loom_revision,
        "package_version": args.package_version,
        "learning": "present" if learning_present else "absent-pre-learning",
        "databases": sql,
        "files": before,
        "boundary": "offline-stopped-writers; no native Session or external artifact backup",
    }
    with (backup / MANIFEST).open("x", encoding="utf-8") as writer:
        json.dump(data, writer, indent=2, sort_keys=True, ensure_ascii=False)
        writer.write("\n")
    (backup / MANIFEST).chmod(0o600)
    print("BACKUP VERIFIED", data["set_id"], data["learning"],
          "files=" + ",".join(before))


def do_restore(args):
    stopped()
    backup = location(args.backup_dir, existing=True)
    destination = location(args.destination_dir)
    require(not destination.exists() and not destination.is_symlink(),
            "Restore destination exists; refusal to overwrite")
    require(not destination.is_relative_to(backup) and not backup.is_relative_to(destination),
            "Restore must be outside preserved backup")
    data, before = validate_backup(backup, args)
    scope = project_scope(args.project_id, args.project_canonical)
    require(destination.name == scope,
            "Restore destination must end in the manifest project scope")
    # No destination is created before manifest, checksum and SQL validation.
    destination.mkdir(mode=0o700)
    copy_files(backup, destination, before)
    require(inventory(backup, manifest=True) == before,
            "Backup changed during restore; reject incomplete destination")
    require(inventory(destination) == before,
            "Restored files differ from backup; reject incomplete destination")
    require(inspect_sql(destination, before.keys()) == data["databases"],
            "Restored SQL format/schema differs; reject incomplete destination")
    require(inventory(destination) == before, "Restored files changed during verification")
    print("RESTORE VERIFIED", data["set_id"], data["learning"],
          "files=" + ",".join(before))
    print("Isolated result only; no work has been resumed or authorized.")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="command", required=True)
    for name in ("backup", "restore"):
        action = sub.add_parser(name)
        action.add_argument("--project-id", required=True)
        action.add_argument("--project-canonical", required=True)
        action.add_argument("--loom-revision", required=True)
        action.add_argument("--package-version", required=True)
        if name == "backup":
            action.add_argument("--source-dir", required=True)
            action.add_argument("--backup-dir", required=True)
            action.add_argument("--legacy-no-learning", action="store_true")
        else:
            action.add_argument("--backup-dir", required=True)
            action.add_argument("--destination-dir", required=True)
    args = parser.parse_args()
    require(args.project_id and args.project_canonical.startswith("/"),
            "Provide native project ID and absolute canonical project path")
    require(re.fullmatch(r"[0-9a-f]{40}", args.loom_revision),
            "Provide exact 40-character Loom commit SHA")
    require(bool(args.package_version.strip()), "Package version required")
    if args.command == "backup":
        do_backup(args)
    else:
        do_restore(args)


if __name__ == "__main__":
    try:
        main()
    except (ValueError, OSError, sqlite3.Error, json.JSONDecodeError) as error:
        print("LOOM_BACKUP_REJECTED:", error, file=sys.stderr)
        sys.exit(1)
