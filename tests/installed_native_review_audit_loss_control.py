"""Actual-host audit-loss control for the existing native review harness.

Only the audit-file fault is substituted. The real host, native scenarios,
candidate plugin, harness run, report writer and CLI exit mapping remain real.
Exit 0 means the completed native run rejected the injected loss; exit 1 means
the control failed or never reached the required mechanical boundary.
"""
from __future__ import annotations

import argparse
import contextlib
import hashlib
import importlib
import io
import json
import subprocess
import sys
from pathlib import Path


def digest(raw: bytes) -> str:
    return hashlib.sha256(raw).hexdigest()


def write_private(path: Path, raw: bytes) -> None:
    path.write_bytes(raw)
    path.chmod(0o600)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--fault", choices=("missing", "prefix"), required=True)
    parser.add_argument("--repository", type=Path, required=True)
    parser.add_argument("--expect-head", required=True)
    parser.add_argument("--opencode", type=Path, required=True)
    parser.add_argument("--plugin", type=Path, required=True)
    parser.add_argument("--artifact", type=Path, required=True)
    parser.add_argument("--report-directory", type=Path, required=True)
    parser.add_argument("--expect-plugin-version", default="2.0.0-alpha.1")
    parser.add_argument("--disable-filewatcher", action="store_true")
    args = parser.parse_args()
    repo, output = args.repository.resolve(), args.report_directory.resolve()
    head = subprocess.check_output(["git", "-C", str(repo), "rev-parse", "HEAD"], text=True).strip()
    dirty = bool(subprocess.check_output(["git", "-C", str(repo), "status", "--porcelain"], text=True).strip())
    if head != args.expect_head or dirty:
        raise RuntimeError("Control requires the exact clean --expect-head checkout")
    if output.exists():
        raise RuntimeError("Control report directory must not exist")

    sys.path.insert(0, str(repo / "tests"))
    native = importlib.import_module("installed_native_review")
    if Path(native.__file__).resolve() != repo / "tests/installed_native_review.py":
        raise RuntimeError("Imported native harness does not belong to requested checkout")
    real_host, real_run = native.PrivateHost, native.run
    fault: dict = {"kind": args.fault, "injected": False, "injection_count": 0}
    returned: list[dict] = []
    injected_prefix: bytes | None = None

    class AuditLossHost(real_host):
        def close(self):
            nonlocal injected_prefix
            super().close()
            if self.label != "reopened" or fault["injected"]:
                return
            if self.proc.poll() is None:
                raise RuntimeError("Audit fault must occur only after the real writer stopped")
            audit = self.project.parent / "audit.ndjson"
            before = audit.read_bytes()
            lines = before.splitlines(keepends=True)
            observed = [json.loads(line) for line in lines]
            if len(observed) < 2 or any(row["type"] == "observer-failure" for row in observed):
                raise RuntimeError("Fault requires a nonempty healthy completed native audit")
            write_private(output / "pre-fault-audit.ndjson", before)
            fault.update(host_label=self.label, writer_stopped=True,
                         before_bytes=len(before), before_receipts=len(observed),
                         before_sha256=digest(before))
            if args.fault == "missing":
                audit.unlink()
                if audit.exists():
                    raise RuntimeError("Audit deletion did not occur")
                fault.update(after_bytes=None, after_receipts=None, after_sha256=None)
            else:
                prefix = lines[0]
                if not prefix or len(prefix) >= len(before):
                    raise RuntimeError("Control did not select a strict nonempty prefix")
                json.loads(prefix)  # The corrupted audit remains syntactically valid.
                audit.write_bytes(prefix)
                if audit.read_bytes() != prefix:
                    raise RuntimeError("Audit prefix truncation did not occur")
                injected_prefix = prefix
                fault.update(after_bytes=len(prefix), after_receipts=1, after_sha256=digest(prefix))
            fault.update(injected=True, injection_count=1)

    def capture_run(native_args):
        result = real_run(native_args)
        returned.append(result)
        return result

    native.PrivateHost, native.run = AuditLossHost, capture_run
    previous_argv = sys.argv
    sys.argv = [str(repo / "tests/installed_native_review.py"),
                "--repository", str(repo), "--opencode", str(args.opencode.resolve()),
                "--plugin", str(args.plugin.resolve()), "--artifact", str(args.artifact.resolve()),
                "--report-directory", str(output),
                "--expect-plugin-version", args.expect_plugin_version]
    if args.disable_filewatcher:
        sys.argv.append("--disable-filewatcher")
    cli_stdout, cli_stderr = io.StringIO(), io.StringIO()
    cli_exit = None
    unexpected_error = None
    try:
        with contextlib.redirect_stdout(cli_stdout), contextlib.redirect_stderr(cli_stderr):
            try:
                native.main()  # Exercise the actual CLI's run and exit mapping.
            except SystemExit as error:
                cli_exit = error.code
    except Exception as error:
        unexpected_error = f"{type(error).__name__}: {error}"
    finally:
        native.PrivateHost, native.run = real_host, real_run
        sys.argv = previous_argv

    output.mkdir(parents=True, exist_ok=True, mode=0o700)
    write_private(output / "control-native-cli.stdout.txt", cli_stdout.getvalue().encode())
    write_private(output / "control-native-cli.stderr.txt", cli_stderr.getvalue().encode())
    report = returned[0] if len(returned) == 1 else {}
    report_path = output / "report.json"
    persisted = json.loads(report_path.read_text()) if report_path.is_file() else {}
    checks = report.get("checks", [])
    all_mechanics_passed = (len(checks) == 8
                           and {row.get("name", "").split("-", 1)[0] for row in checks}
                           == {"Q1", "Q2", "Q3", "Q4", "Q5", "Q6", "Q7", "R1"}
                           and all(row.get("status") == "PASS" for row in checks))
    expected_audit_error = {
        "missing": "RuntimeError: Final audit file is missing",
        "prefix": "RuntimeError: Audit raw prefix changed or was truncated",
    }[args.fault]
    retained_audit = output / "audit.ndjson"
    retained_raw = retained_audit.read_bytes() if retained_audit.is_file() else None
    errors = []
    if unexpected_error:
        errors.append(unexpected_error)
    if fault["injection_count"] != 1:
        errors.append("The real reopened host did not reach exactly one fault injection")
    if not all_mechanics_passed:
        errors.append("Not all eight native mechanical checks passed before finalization")
    if report.get("source_head") != head or report.get("source_dirty") is not False:
        errors.append("Native report did not identify the exact clean target checkout")
    if len(returned) != 1 or persisted != report:
        errors.append("Returned native report and persisted report do not agree")
    if report.get("execution_status") != "FAIL" or report.get("status") != "FAIL" or cli_exit != 1:
        errors.append("Native report/CLI did not reject the injected final audit loss")
    if report.get("audit_error") != expected_audit_error:
        errors.append("Native report did not identify the intended audit-integrity failure")
    if report.get("error") != expected_audit_error:
        errors.append("Native run also failed outside the intended final audit fault")
    if args.fault == "missing" and retained_audit.exists():
        errors.append("Missing final audit was replaced by a fabricated retained audit")
    if args.fault == "prefix" and (injected_prefix is None or retained_raw != injected_prefix):
        errors.append("Retained final audit does not exactly equal the injected raw prefix")
    if any(field in report for field in ("audit_sha256", "audit_bytes", "audit_receipts")):
        errors.append("Rejected final audit retained successful audit hash/count metadata")
    summary = {
        "format": "loom-native-review-audit-loss-control/v1",
        "control_status": "FAIL" if errors else "PASS",
        "source_head": head, "source_dirty": dirty,
        "driver_sha256": digest(Path(__file__).read_bytes()),
        "fault": fault, "all_eight_mechanical_checks_passed": all_mechanics_passed,
        "mechanical_checks": [{"name": row.get("name"), "status": row.get("status")} for row in checks],
        "native_result": {"status": report.get("status"), "execution_status": report.get("execution_status"),
                          "cli_exit": cli_exit, "error": report.get("error"),
                          "audit_error": report.get("audit_error")},
        "retained_final_audit": {"exists": retained_audit.is_file(),
                                 "bytes": len(retained_raw) if retained_raw is not None else None,
                                 "sha256": digest(retained_raw) if retained_raw is not None else None},
        "errors": errors,
        "limits": ["Only final audit-file loss is substituted; native execution and its evidence are real.",
                   "Scripted-provider mechanics do not qualify model reasoning or protected review transfer.",
                   "The retained pre-fault audit is diagnostic evidence, not the harness's final audit."],
    }
    write_private(output / "audit-loss-control.json", (json.dumps(summary, indent=2) + "\n").encode())
    print(json.dumps(summary, indent=2))
    return 1 if errors else 0


if __name__ == "__main__":
    raise SystemExit(main())
