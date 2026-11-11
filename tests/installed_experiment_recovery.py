"""Exercise the read-only recovery scanner against actual 2.2.6 native writes.

No prompts, model requests, live authorization or experiment enrollment. The
only native mutations create disposable Sessions and synthetic marker entries.
"""
from __future__ import annotations

import argparse
import importlib.util
import json
from pathlib import Path
import subprocess
import tempfile

from installed_host_smoke import PrivateHost, isolated_environment, require
from installed_instruction_variants import create_session, request, verify_host_version

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("experiment_recovery", ROOT / "tools/inspect_experiment_recovery.py")
scanner = importlib.util.module_from_spec(spec)
spec.loader.exec_module(scanner)


def run(opencode: Path, output: Path) -> dict:
    version = subprocess.check_output([str(opencode), "--version"], text=True, timeout=15).strip()
    verify_host_version(version)
    report = {"host": version, "status": "UNPROVEN", "checks": [],
              "limits": "Native storage/recovery inspection only. No inference, human consent, trial, or exposure proof."}
    output.mkdir(mode=0o700)
    host = None
    try:
        with tempfile.TemporaryDirectory(prefix="loom-recovery-host-") as temporary:
            root = Path(temporary).resolve()
            env = isolated_environment(root)
            env["OPENCODE_FILEWATCHER_DISABLE"] = "1"
            env["OPENCODE_DB"] = str(root / "opencode.db")
            project = root / "project"
            project.mkdir()
            config = {"plugins": ["*", str(ROOT / "tests/variant-host")],
                      "agents": {"variant-agent": {"description": "Disposable recovery probe", "mode": "primary",
                                 "model": "variant-fixture/scripted", "system": "Do not execute any work.",
                                 "permissions": [{"action": "*", "resource": "*", "effect": "deny"}]}},
                      "model": "variant-fixture/scripted", "update": "disable", "share": "disabled"}
            Path(env["OPENCODE_CONFIG_DIR"], "opencode.json").write_text(json.dumps(config))
            env["LOOM_VARIANT_FIXTURE_ROOT"] = str(root)
            (root / "variant-barrier.json").write_text('{"release":true}')
            subprocess.run(["git", "init", "-q", str(project)], env=env, check=True, timeout=10)

            def start(label):
                value = PrivateHost(str(opencode), project, env, output, label)
                try:
                    require(json.loads(value.get("/api/info", "info")).get("version") == "2.2.6",
                            "Unexpected native server version")
                    value.wait_roster("/api/plugin", "plugins", lambda rows: any(
                        r.get("id") == "loom.variant.qualification.fixture" and
                        r.get("state", {}).get("status") == "active" for r in rows))
                    return value
                except Exception:
                    value.close()
                    raise

            host = start("initial")
            control = create_session(host, project)
            orphan = create_session(host, project)
            withdrawn = create_session(host, project)
            key = scanner.ENTRY_KEY
            entry = lambda session: "/api/experimental/session/" + session + "/instructions/entries/" + key
            for session in (orphan, withdrawn):
                request(host, "PUT", entry(session), {"value": "DISPOSABLE_RECOVERY_MARKER"})
            request(host, "DELETE", entry(withdrawn))
            require(request(host, "GET", entry(withdrawn).rsplit("/", 1)[0]) == [], "Native removal did not complete")
            host.close()
            host = None
            native = root / "opencode.db"
            before = scanner.inventory(native)
            first = scanner.inspect(native, [], host_version="2.2.6", writers_stopped=True)
            require(scanner.inventory(native) == before, "Scanner modified source DB or sidecars")
            found = {r["session_id"]: r for r in first["sessions"]}
            require(first["status"] == "RECOVERY_REQUIRED" and first["active_native_entries"] == 1,
                    "Native orphan was not detected")
            require(found[orphan]["native_entry"] == "present" and
                    "assignment-history-unavailable" in found[orphan]["recovery_blockers"],
                    "Missing learning DB erased native treatment")
            require(found[withdrawn]["native_entry"] == "removed-tombstone" and
                    found[withdrawn]["control_eligible"] is False and control not in found,
                    "Withdrawal erased exposure history or fabricated control qualification")
            (output / "before-restart.json").write_text(json.dumps(first, indent=2) + "\n")
            report["checks"].append("Native orphan and withdrawal tombstone detected without source writes")

            host = start("reopened")
            require(request(host, "GET", entry(orphan).rsplit("/", 1)[0]) ==
                    [{"key": key, "value": "DISPOSABLE_RECOVERY_MARKER"}], "Orphan lost after restart")
            request(host, "DELETE", entry(orphan))
            host.close()
            host = None
            second = scanner.inspect(native, [], host_version="2.2.6", writers_stopped=True)
            require(second["status"] == "NO_ACTIVE_ENTRY_IN_SNAPSHOT" and second["active_native_entries"] == 0,
                    "Native withdrawal not recognized after reopening")
            require(len(second["sessions"]) == 2 and all(r["control_eligible"] is False for r in second["sessions"]),
                    "Removed sessions became clean controls")
            (output / "after-restart.json").write_text(json.dumps(second, indent=2) + "\n")
            event_file = root / "variant-events.ndjson"
            observed = ([json.loads(line) for line in event_file.read_text().splitlines() if line]
                        if event_file.exists() else [])
            require(not any(str(event.get("type", "")).startswith("provider-") for event in observed),
                    "Unexpected provider activity in storage-only qualification")
            report["checks"].append("Native restart, removal and retained exposure uncertainty")
            report["status"] = "PASS_NATIVE_STORAGE_INSPECTION"
    finally:
        if host is not None:
            host.close()
        (output / "report.json").write_text(json.dumps(report, indent=2) + "\n")
    return report


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--opencode", required=True, type=Path)
    parser.add_argument("--report-directory", required=True, type=Path)
    args = parser.parse_args()
    result = run(args.opencode.resolve(), args.report_directory.resolve())
    print(json.dumps(result))


if __name__ == "__main__":
    main()
