#!/usr/bin/env python3
"""Read-only, no-provider regrading of an existing private QA-B evidence bundle.

Recomputes deterministic investigator checks after evaluator fixes. It does
not rerun the model, alter the original evidence or turn skipped controls into
PASS. The original source files never need to leave the operator's machine.
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path

from retrospective_qab_oracle import CONTROLS, grade_controls, verify_primary, verdict
from retrospective_qab import evaluate_control


def _read(root: Path, name: str, limit: int) -> str:
    path = root / name
    chain = []
    part = path
    while part != root:
        if root not in part.parents:
            raise ValueError("QA-B evidence must stay within its report directory")
        chain.append(part)
        part = part.parent
    if (any(part.is_symlink() for part in chain)
            or not path.is_file() or path.stat().st_size > limit):
        raise ValueError("Required local QA-B evidence file is missing, linked or oversized")
    return path.read_text(encoding="utf-8")


def _statuses(value: object) -> dict:
    if not isinstance(value, dict):
        return {}
    return {name: value[name] if value[name] in ("PASS", "FAIL", "UNPROVEN")
            else "UNPROVEN" for name in value if isinstance(name, str)}


def regrade_controls(root: Path, report: dict, oracle: dict, audit: list) -> tuple[dict, list]:
    """Recheck retained complete replies; never manufacture skipped controls.

    Historical bundles without complete control files keep their original
    verdicts. Newly retained replies must match the run's model, targets and
    native audit interval before current grading can be applied offline.
    """
    original = report.get("controls", {})
    records = dict(original)
    replayed = []
    sessions = oracle["session_ids"]
    for name in CONTROLS:
        path = root / "controls" / (name + ".json")
        if not path.exists() and not path.is_symlink():
            continue
        prior = original.get(name, {})
        if prior.get("executed") is not True or prior.get("status") == "FAIL":
            continue
        saved = json.loads(_read(root, "controls/" + name + ".json", 2 * 1024 * 1024))
        if (not isinstance(saved, dict) or saved.get("schema_version") != 1
                or saved.get("kind") != "qa-b-control-evidence" or saved.get("control") != name
                or saved.get("parent_session") != sessions["parent"]
                or saved.get("model") != report["model"]
                or not isinstance(saved.get("session_id"), str)):
            raise ValueError("Control evidence identity does not match this run")
        if name in ("read-denied", "child-inaccessible") and saved.get("worker_session") != sessions["worker"]:
            raise ValueError("Control worker identity does not match this run")
        records[name] = {"status": "UNPROVEN"}
        text = saved.get("response")
        if (saved.get("response_complete") is not True or saved.get("error_type") is not None
                or not isinstance(text, str) or len(text.encode("utf-8")) > 256 * 1024):
            continue
        start, end = saved.get("audit_start"), saved.get("audit_end")
        if type(start) is not int or type(end) is not int or not 0 <= start <= end <= len(audit):
            raise ValueError("Control audit interval is absent or out of range")
        events = audit[start:end]
        requests = [e.get("data", {}) for e in events if e.get("type") == "model-request"
                    and e.get("data", {}).get("sessionID") == saved["session_id"]
                    and e.get("data", {}).get("kind") == "primary"]
        if not requests or any(str(e.get("providerID")) + "/" + str(e.get("modelID")) != report["model"]
                               for e in requests):
            continue
        records[name] = evaluate_control(name, events, saved["session_id"], text, sessions["parent"],
                                         worker=sessions["worker"],
                                         correction_id=oracle["source_events"].get("user"))
        replayed.append(name)
    return grade_controls(records), replayed


def regrade_existing(directory: Path) -> dict:
    root = directory.resolve(strict=True)
    report = json.loads(_read(root, "report.json", 1024 * 1024))
    oracle = json.loads(_read(root, "oracle.json", 1024 * 1024))
    audit = [json.loads(line) for line in _read(root, "audit.ndjson", 8 * 1024 * 1024).splitlines()]
    retrospective = _read(root, "retrospective-report.md", 1024 * 1024)
    if (not isinstance(report, dict) or report.get("kind") != "loom-qab-real-model"
            or not isinstance(oracle, dict)):
        raise ValueError("Not a supported real-model QA-B bundle")
    sessions = oracle.get("session_ids")
    events = oracle.get("source_events")
    if (not isinstance(sessions, dict) or
            not all(isinstance(sessions.get(role), str) for role in ("parent", "worker", "reviewer")) or
            not isinstance(events, dict) or
            not isinstance(report.get("model"), str) or
            not isinstance(report.get("investigator_session"), str)):
        raise ValueError("QA-B bundle lacks original Session/evidence identity")
    # Optional original host export: validate worker identity before allowing
    # any call-ID aliases. Older bundles without it retain message-only grading.
    source_path = root / "source-history" / "worker.json"
    worker_messages = None
    if source_path.exists() or source_path.is_symlink():
        source = json.loads(_read(root, "source-history/worker.json", 8 * 1024 * 1024))
        data = source.get("data") if isinstance(source, dict) else None
        if (not isinstance(data, dict) or not isinstance(data.get("info"), dict)
                or data["info"].get("id") != sessions["worker"]
                or not isinstance(data.get("messages"), list)):
            raise ValueError("Worker source history lacks expected Session identity")
        worker_messages = data["messages"]
    primary = verify_primary(audit, report["investigator_session"], report["model"],
                             sessions["parent"], sessions["worker"], sessions["reviewer"],
                             events, retrospective, worker_messages=worker_messages)
    controls, replayed_controls = regrade_controls(root, report, oracle, audit)
    overall = verdict(primary, controls)
    if overall != "FAIL" and (report.get("source_gate", {}).get("ready") is not True
                              or report.get("source_qualification") != "PASS"):
        overall = "UNPROVEN"
    if report.get("investigator_read_only_preserved") is False:
        overall = "FAIL"
    elif overall != "FAIL" and report.get("investigator_read_only_preserved") is not True:
        overall = "UNPROVEN"
    return {
        "kind": "qa-b-offline-regrade",
        "source_qualification": report.get("source_qualification"),
        "original": {
            "infrastructure": report.get("infrastructure"),
            "agent": report.get("agent"),
            "overall": report.get("status"),
            "checks": _statuses(report.get("primary_checks")),
        },
        "regraded": {
            "infrastructure": primary["infrastructure"],
            "agent": primary["agent"],
            "overall": overall,
            "checks": primary["checks"],
            "paired_trace_count": len(primary["observed_trace_call_ids"]),
            "source_event_count": len(primary["observed_event_ids"]),
        },
        "controls": controls,
        "replayed_controls": replayed_controls,
        "limitations": [
            "offline regrade only; no new model, native tools or controls executed",
            "provided evidence remains unauthenticated; source and call IDs withheld",
            "semantic correctness of investigator prose requires independent QA",
        ],
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--report-directory", type=Path, required=True)
    args = parser.parse_args()
    try:
        result = regrade_existing(args.report_directory)
    except (OSError, KeyError, TypeError, ValueError, json.JSONDecodeError) as error:
        parser.exit(2, "QA-B offline regrade failed: " + type(error).__name__ + "\n")
    print(json.dumps(result, indent=2))


if __name__ == "__main__":
    main()
