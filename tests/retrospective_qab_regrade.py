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


def _read(root: Path, name: str, limit: int) -> str:
    path = root / name
    if path.is_symlink() or not path.is_file() or path.stat().st_size > limit:
        raise ValueError("Required local QA-B evidence file is missing, linked or oversized")
    return path.read_text(encoding="utf-8")


def _statuses(value: object) -> dict:
    if not isinstance(value, dict):
        return {}
    return {name: value[name] if value[name] in ("PASS", "FAIL", "UNPROVEN")
            else "UNPROVEN" for name in value if isinstance(name, str)}


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
    primary = verify_primary(audit, report["investigator_session"], report["model"],
                             sessions["parent"], sessions["worker"], sessions["reviewer"],
                             events, retrospective)
    controls = grade_controls(report.get("controls", {}))
    overall = verdict(primary, controls)
    if report.get("source_gate", {}).get("ready") is not True or report.get("source_qualification") != "PASS":
        overall = "UNPROVEN"
    if report.get("investigator_read_only_preserved") is False:
        overall = "FAIL"
    elif report.get("investigator_read_only_preserved") is not True:
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
