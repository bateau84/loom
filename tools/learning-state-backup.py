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
# Optional Stage 4 preparation is part of the same learning database. Any
# retained table requires its complete extension; absence is the legacy case.
EVALUATOR_COLUMNS = {
    "learning_evaluator_schema": {"singleton", "version"},
    "learning_evaluator_methods": {
        "id", "manifest_json", "manifest_sha256", "instruction_sha256",
    },
    "learning_evaluator_requests": {
        "batch_id", "slot", "method_id", "request_id", "data_json", "sha256", "created_at",
    },
}
# Frozen retrospective populations are immutable source descriptors under the
# existing EvaluationStore. They contain no original record bodies or grants.
RETROSPECTIVE_COLUMNS = {
    "learning_retrospective_schema": {"singleton", "version"},
    "learning_retrospective_populations": {
        "id", "owner_session", "owner_agent", "source_store_id", "manifest_sha256",
        "header_json", "contributors_json", "contains_private_reviews", "member_count",
        "metadata_sha256", "created_at",
    },
    "learning_retrospective_members": {"population_id", "key", "ordinal", "data_json"},
}
# Execution records are mirrors in the existing learning database, not a
# provider authority or spend pool. A retained preparation marker makes loss
# of this complete optional extension detectable without guessing nonexecution.
EXECUTION_COLUMNS = {
    "learning_execution_schema": {"singleton", "version"},
    "learning_execution_admissions": {
        "batch_id", "request_id", "attempt_id", "authority_id", "reservation_id",
        "semantic_key", "data_json", "sha256",
    },
    "learning_execution_receipts": {
        "batch_id", "sequence", "authority_id", "receipt_id", "data_json", "sha256",
    },
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


def retrospective_integrity(db, ledger_store_id):
    """Independently validate stored shape, row closure and exact frozen bytes.

    Retain nested canonical value slices rather than recanonicalizing them with
    Python's different Unicode collation/float formatter. Top-level contract
    keys below are fixed ASCII, with identical canonical ordering in Loom.
    """
    maximum = 33554432
    identifier = lambda value: isinstance(value, str) and bool(re.fullmatch(
        r"[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,119}", value))
    fingerprint = lambda value: isinstance(value, str) and bool(re.fullmatch(r"[a-f0-9]{64}", value))
    integer = lambda value: type(value) is int and 0 <= value <= 9007199254740991
    plain = lambda value, limit=8000: isinstance(value, str) and bool(value.strip()) and len(value) <= limit and not re.search(r"[\x00-\x1f]", value)
    encoded = lambda value: json.dumps(value, ensure_ascii=False, separators=(",", ":"))
    sha_text = lambda value: hashlib.sha256(value.encode("utf-8")).hexdigest()
    object_text = lambda values: "{" + ",".join(encoded(key) + ":" + values[key] for key in sorted(values)) + "}"
    decoder = json.JSONDecoder()

    def raw_object(text):
        require(isinstance(text, str) and len(text) <= maximum and text.startswith("{") and text.endswith("}"),
                "Invalid retrospective canonical mapping")
        result = {}
        offset = 1
        while offset < len(text) - 1:
            key, end = decoder.raw_decode(text, offset)
            require(isinstance(key, str) and key not in result and text[end:end + 1] == ":",
                    "Invalid retrospective canonical mapping fields")
            start = end + 1
            _, offset = decoder.raw_decode(text, start)
            result[key] = text[start:offset]
            if text[offset:offset + 1] == ",":
                offset += 1
            else:
                require(offset == len(text) - 1, "Invalid retrospective canonical mapping suffix")
                break
        require(object_text(result) == text, "Noncanonical retrospective contract mapping")
        return result

    def shape(value, fields, optional=()):
        require(isinstance(value, dict) and set(fields) <= set(value) <= set(fields) | set(optional),
                "Invalid retrospective contract fields")

    local_views = {"ledger-record": "record-full", "objective": "objective", "objective-link": "objective-link",
                   "review-request": "review-request", "review-relationship": "review-relationship"}
    rows = db.execute("SELECT id,owner_session,owner_agent,source_store_id,manifest_sha256,header_json,contributors_json,"
                      "contains_private_reviews,member_count,metadata_sha256,created_at FROM learning_retrospective_populations").fetchall()
    for population_id, owner, agent, namespace, manifest_sha, header_json, contributors_json, private_reviews, member_count, metadata_sha, created_at in rows:
        require(ledger_store_id is not None and namespace == ledger_store_id,
                "Retrospective source namespace does not match paired ledger")
        require(identifier(population_id) and identifier(owner) and identifier(namespace) and plain(agent, 200)
                and fingerprint(manifest_sha) and fingerprint(metadata_sha) and private_reviews in (0, 1)
                and type(member_count) is int and 1 <= member_count <= 20000,
                "Invalid retrospective population metadata")
        require(isinstance(created_at, str), "Invalid retrospective freeze timestamp")
        datetime.fromisoformat(created_at.replace("Z", "+00:00"))
        header_values = raw_object(header_json)
        header = json.loads(header_json)
        shape(header, ("format", "source_store_id", "selection", "contributors", "objective", "coverage", "qualifications"))
        require(header["format"] == "loom-retrospective-population/v1" and header["source_store_id"] == namespace,
                "Invalid retrospective population format or source namespace")
        contributors = json.loads(contributors_json)
        require(isinstance(contributors, list) and len(contributors) <= 2000 and all(identifier(item) for item in contributors)
                and len(set(contributors)) == len(contributors) and contributors == header["contributors"],
                "Invalid retrospective contributor population")
        for name in ("objective", "coverage"):
            require(isinstance(header[name], dict), "Invalid retrospective " + name)
        require(isinstance(header["qualifications"], list) and len(header["qualifications"]) <= 2000
                and all(plain(item) for item in header["qualifications"]), "Invalid retrospective qualifications")
        selected = header["selection"]
        shape(selected, ("mode", "objective_id", "question", "through", "owner_boundary", "owner_version", "exclusions"))
        require(selected["mode"] == "explicit-objective" and identifier(selected["objective_id"]) and plain(selected["question"])
                and integer(selected["through"]) and fingerprint(selected["owner_version"]), "Invalid retrospective selection")
        boundary = selected["owner_boundary"]
        shape(boundary, ("objective_links", "review_requests", "review_relationships"))
        require((boundary["objective_links"] is None or integer(boundary["objective_links"]))
                and integer(boundary["review_requests"]) and integer(boundary["review_relationships"]),
                "Invalid retrospective selection boundary")
        exclusions = selected["exclusions"]
        require(isinstance(exclusions, list) and len(exclusions) <= 20000, "Invalid retrospective exclusions")
        excluded_ids = set()
        for exclusion in exclusions:
            shape(exclusion, ("record_id", "reason"))
            require(identifier(exclusion["record_id"]) and plain(exclusion["reason"]) and exclusion["record_id"] not in excluded_ids,
                    "Invalid retrospective exclusion")
            excluded_ids.add(exclusion["record_id"])
        members = db.execute("SELECT key,ordinal,data_json FROM learning_retrospective_members WHERE population_id=? ORDER BY ordinal",
                             (population_id,)).fetchall()
        require(len(members) == member_count, "Incomplete retrospective frozen membership")
        size, observed_private, seen, encoded_members = len(header_json), False, set(), []
        for ordinal, (key, actual_ordinal, data_json) in enumerate(members, 1):
            require(actual_ordinal == ordinal and isinstance(data_json, str), "Incomplete retrospective frozen ordinals")
            size += len(data_json)
            require(size <= maximum, "Oversized retrospective frozen membership")
            member_values = raw_object(data_json)
            member = json.loads(data_json)
            shape(member, ("key", "source_store_id", "source", "permitted_view", "availability", "basis", "historical_scope", "qualifications"))
            source = member["source"]
            shape(source, ("kind", "id", "required"), ("session_id", "message_id", "revision", "sha256"))
            require(plain(source["kind"], 100) and plain(source["id"], 1000) and type(source["required"]) is bool
                    and identifier(member["source_store_id"]) and plain(member["permitted_view"], 120)
                    and member["availability"] in ("available", "missing", "unresolved", "unsupported"), "Invalid retrospective member source")
            if "session_id" in source:
                require(identifier(source["session_id"]) and source["session_id"] in contributors, "Missing retrospective source contributor")
            if source["kind"] == "native-call" or "message_id" in source:
                require(source["kind"] == "native-call" and "session_id" in source and identifier(source.get("message_id")),
                        "Invalid retrospective native-call message identity")
            if "revision" in source:
                require(plain(source["revision"], 200), "Invalid retrospective source version")
            if "sha256" in source:
                require(fingerprint(source["sha256"]), "Invalid retrospective source hash")
            if source["kind"] in local_views:
                require(member["source_store_id"] == namespace and member["permitted_view"] == local_views[source["kind"]],
                        "Invalid retrospective local source owner/view")
            if member["availability"] == "available":
                require("revision" in source and "sha256" in source and (source["kind"] not in local_views or "session_id" in source),
                        "Available retrospective source lacks exact version")
            source_values = raw_object(member_values["source"])
            del source_values["required"]
            key_input = object_text({"source_store_id": member_values["source_store_id"], "source": object_text(source_values),
                                     "permitted_view": member_values["permitted_view"]})
            require(key == member["key"] == "source-" + sha_text(key_input) and key not in seen, "Invalid retrospective source identity")
            seen.add(key)
            require(isinstance(member["basis"], list) and len(member["basis"]) <= 2000 and all(isinstance(item, dict) for item in member["basis"])
                    and (member["historical_scope"] is None or isinstance(member["historical_scope"], dict))
                    and isinstance(member["qualifications"], list) and len(member["qualifications"]) <= 2000
                    and all(plain(item) for item in member["qualifications"]), "Invalid retrospective member basis")
            observed_private = observed_private or source["kind"] in ("review-request", "review-relationship")
            encoded_members.append(data_json)
        require([key for key, _, _ in members] == sorted(seen), "Noncanonical retrospective source order")
        require(observed_private == bool(private_reviews), "Retrospective private-source metadata mismatch")
        manifest_text = object_text({**header_values, "members": "[" + ",".join(encoded_members) + "]"})
        require(sha_text(manifest_text) == manifest_sha, "Retrospective population digest mismatch")
        identity_text = object_text({"format": encoded("loom-retrospective-identity/v1"), "owner_session": encoded(owner),
                                     "source_store_id": encoded(namespace), "manifest_sha256": encoded(manifest_sha)})
        require(population_id == "retrospective-" + sha_text(identity_text), "Retrospective population identity mismatch")
        metadata_text = object_text({"population_id": encoded(population_id), "manifest_sha256": encoded(manifest_sha),
                                     "source_store_id": encoded(namespace), "owner_session": encoded(owner), "contributors": contributors_json,
                                     "contains_private_reviews": encoded(bool(private_reviews)), "member_count": encoded(member_count),
                                     "frozen_by": object_text({"session_id": encoded(owner), "agent": encoded(agent)}), "created_at": encoded(created_at)})
        require(sha_text(metadata_text) == metadata_sha, "Retrospective metadata digest mismatch")


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
    ledger_store_id = None
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
                has_evaluator = name == "learning.sqlite" and any(
                    table.startswith("learning_evaluator_") for table in tables
                )
                has_execution = name == "learning.sqlite" and any(
                    table.startswith("learning_execution_") for table in tables
                )
                has_retrospective = name == "learning.sqlite" and any(
                    table.startswith("learning_retrospective_") for table in tables
                )
                if has_evaluation or has_evaluator or has_execution or has_retrospective:
                    required_columns = {**required_columns, **EVALUATION_COLUMNS}
                if has_evaluator or has_execution:
                    required_columns = {**required_columns, **EVALUATOR_COLUMNS}
                if has_execution:
                    required_columns = {**required_columns, **EXECUTION_COLUMNS}
                    required_columns["learning_evaluator_requests"] = (
                        EVALUATOR_COLUMNS["learning_evaluator_requests"] |
                        {"execution_admission_sha256"}
                    )
                if has_retrospective:
                    required_columns = {**required_columns, **RETROSPECTIVE_COLUMNS}
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
                if has_evaluation and not has_evaluator:
                    mapped = db.execute(
                        "SELECT 1 FROM learning_evaluation_batches WHERE blocked_reason IN "
                        "('evaluator-request-mapped', 'evaluator-dispatch-unavailable') LIMIT 1"
                    ).fetchone()
                    require(not mapped,
                            "Missing required learning_evaluator_ tables for mapped evaluator preparation")
                if has_evaluation or has_evaluator:
                    markers = db.execute(
                        "SELECT singleton,version FROM learning_evaluation_schema"
                    ).fetchall()
                    require(len(markers) == 1 and markers[0][0] == 1,
                            "Missing or invalid evaluation schema marker")
                    require(markers[0][1] == 1,
                            "Unsupported evaluation schema version: " + str(markers[0][1]))
                    retrospective_preparation = db.execute(
                        "SELECT 1 FROM learning_evaluation_batches WHERE scope_key='evaluator-preparation/retrospective' LIMIT 1"
                    ).fetchone()
                    require(has_retrospective or not retrospective_preparation,
                            "Missing required learning_retrospective_ tables for retrospective preparation")
                if has_retrospective:
                    markers = db.execute("SELECT singleton,version FROM learning_retrospective_schema").fetchall()
                    require(len(markers) == 1 and markers[0][0] == 1,
                            "Missing or invalid retrospective population schema marker")
                    require(markers[0][1] == 1,
                            "Unsupported retrospective population schema version: " + str(markers[0][1]))
                    retrospective_integrity(db, ledger_store_id)
                if has_evaluator:
                    markers = db.execute(
                        "SELECT singleton,version FROM learning_evaluator_schema"
                    ).fetchall()
                    require(len(markers) == 1 and markers[0][0] == 1,
                            "Missing or invalid evaluator preparation schema marker")
                    require(markers[0][1] == 1,
                            "Unsupported evaluator preparation schema version: " + str(markers[0][1]))
                    evaluator_columns = {row[1] for row in db.execute(
                        "PRAGMA table_info(learning_evaluator_requests)"
                    )}
                    if "execution_admission_sha256" in evaluator_columns:
                        enrolled = db.execute(
                            "SELECT 1 FROM learning_evaluator_requests "
                            "WHERE execution_admission_sha256 IS NOT NULL LIMIT 1"
                        ).fetchone()
                        require(has_execution or not enrolled,
                                "Missing required learning_execution_ tables for enrolled evaluator execution")
                if has_execution:
                    markers = db.execute(
                        "SELECT singleton,version FROM learning_execution_schema"
                    ).fetchall()
                    require(len(markers) == 1 and markers[0][0] == 1,
                            "Missing or invalid evaluator execution schema marker")
                    require(markers[0][1] == 1,
                            "Unsupported evaluator execution schema version: " + str(markers[0][1]))
                    missing = db.execute(
                        "SELECT 1 FROM learning_evaluator_requests AS request "
                        "LEFT JOIN learning_execution_admissions AS admission "
                        "ON admission.batch_id=request.batch_id "
                        "WHERE request.execution_admission_sha256 IS NOT NULL "
                        "AND (admission.batch_id IS NULL OR "
                        "request.execution_admission_sha256<>admission.sha256) LIMIT 1"
                    ).fetchone()
                    unmarked = db.execute(
                        "SELECT 1 FROM learning_execution_admissions AS admission "
                        "LEFT JOIN learning_evaluator_requests AS request "
                        "ON request.batch_id=admission.batch_id "
                        "WHERE request.execution_admission_sha256 IS NULL "
                        "OR request.execution_admission_sha256<>admission.sha256 LIMIT 1"
                    ).fetchone()
                    require(not missing and not unmarked,
                            "Evaluator execution enrollment/mirror mismatch")
                if name == "ledger.sqlite" and version == 2:
                    identity = db.execute(
                        "SELECT singleton,store_id FROM review_store_identity"
                    ).fetchall()
                    require(len(identity) == 1 and identity[0][0] == 1
                            and isinstance(identity[0][1], str)
                            and re.fullmatch(r"[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,119}", identity[0][1]),
                            "Missing or invalid review source-store identity; no replacement identity is authorized")
                    ledger_store_id = identity[0][1]
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
