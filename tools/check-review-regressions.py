#!/usr/bin/env python3
"""Three targeted mutants plus two reverse-fix controls; never mutate the checkout."""
from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import tempfile


CASES = [
    ("ancestor-omission", "src/collaboration.ts", "      if (n.parent) add(n.parent, false)\n", "",
     "core", "parent criteria changes invalidate child completion"),
    ("failure-as-success", "src/context.ts", "      status: e.status,\n", '      status: "completed",\n',
     "core", "failed finish persists error status"),
    ("ctime-omission", "src/config.ts", " || before.ctimeNs !== after.ctimeNs", "",
     "core", "change-time-only edit rejects configuration"),
    ("raw-sdk-error-control", "src/plugin.ts", '''            const observed = event.status === "error"
              ? { ...event, error: { format: "loom-tool-error/v1", message: event.error.message } }
              : event
            const record = observer.after(observed, captureEnabled)''',
     "            const record = observer.after(event, captureEnabled)", "native", "SDK Tool.Error records a failed finish"),
    ("eager-selection-control", "src/plugin.ts", "            let result: unknown\n",
     "            store.selected(actor.session_id) // isolated reverse-fix control\n            let result: unknown\n",
     "native", "unreadable selection does not block discovery"),
]


def execute(command: list[str], cwd: Path, log: Path) -> subprocess.CompletedProcess[str]:
    result = subprocess.run(command, cwd=cwd, env={**os.environ, "NO_COLOR": "1"},
                            capture_output=True, text=True, timeout=90)
    log.write_text(result.stdout + result.stderr)
    return result


def workspace(repo: Path, target: Path) -> None:
    target.mkdir()
    for name in ("src", "tests", "examples", "tools"):
        shutil.copytree(repo / name, target / name, ignore=shutil.ignore_patterns("__pycache__"))
    for path in [*repo.glob("tsconfig*.json"), repo / "package.json", repo / "server.ts", repo / ".bun-version"]:
        shutil.copy2(path, target / path.name)
    (target / "node_modules").symlink_to(repo / "node_modules", target_is_directory=True)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--report-directory", type=Path, required=True)
    args = parser.parse_args()
    repo = Path(__file__).resolve().parents[1]
    output = args.report_directory.resolve()
    output.mkdir(parents=True, exist_ok=True)
    node, bun = shutil.which("node"), shutil.which("bun")
    compiler = repo / "node_modules/.bin/tsc"
    if not node or not bun or not compiler.exists():
        raise RuntimeError("Install the locked dependencies and provide Node and Bun; missing tools are not killed mutants")
    summary: dict = {"kind": "targeted-regression-counterchecks", "baseline_passed": False, "cases": [],
                     "limits": "Reconstructed mutations, not the reviewer's exact nine-patch set, independent review, or an exhaustive score."}
    try:
        with tempfile.TemporaryDirectory(prefix="loom-review-counterchecks-") as tmp:
            root = Path(tmp)
            for name, path, old, new, suite, pattern in [("baseline", None, None, None, None, None), *CASES]:
                work = root / name
                workspace(repo, work)
                if path:
                    source = work / path
                    text = source.read_text()
                    if text.count(old) != 1:
                        raise RuntimeError(f"{name}: mutation site changed; reconcile the probe instead of skipping it")
                    source.write_text(text.replace(old, new, 1))
                for label, command in [("typecheck", [str(compiler), "--noEmit"]),
                                       ("compile", [str(compiler), "-p", "tsconfig.core.json"])]:
                    result = execute(command, work, output / f"{name}-{label}.log")
                    if result.returncode:
                        raise RuntimeError(f"{name}: {label} failed; this is not a compiling mutant (see logs)")
                if name == "baseline":
                    for mode, command in [("core", [node, "--test", "--test-reporter=tap", "tests/review-findings.test.mjs"]),
                                          ("native", [bun, "test", "tests/review-findings-native.test.ts"])]:
                        if execute(command, work, output / f"baseline-{mode}.log").returncode:
                            raise RuntimeError(f"Baseline {mode} tests failed; mutant results would be invalid")
                    summary["baseline_passed"] = True
                    print("Baseline focused core and actual-SDK native tests: PASS", flush=True)
                    continue
                if suite == "core":
                    command = [node, "--test", "--test-reporter=tap", f"--test-name-pattern={pattern}", "tests/review-findings.test.mjs"]
                else:
                    command = [bun, "test", "tests/review-findings-native.test.ts", "--test-name-pattern", pattern]
                log = output / f"{name}-test.log"
                result = execute(command, work, log)
                text = log.read_text()
                infrastructure_error = any(word in text for word in ("ERR_MODULE_NOT_FOUND", "Cannot find module", "Could not resolve:", "Unhandled error between tests"))
                if suite == "core":
                    assertion = "ERR_ASSERTION" in text and bool(re.search(r"not ok[^\n]*" + re.escape(pattern), text))
                else:
                    assertion = "expect(received)" in text and bool(re.search(r"\(fail\)[^\n]*" + re.escape(pattern), text))
                caught = result.returncode != 0 and assertion and not infrastructure_error
                summary["cases"].append({"name": name, "full_typecheck": "passed", "core_compilation": "passed",
                                          "target": pattern, "caught_by_assertion": caught})
                if not caught:
                    raise RuntimeError(f"{name}: expected behavioral rejection was not established; inspect {log}")
                print(f"{name}: compiling change caught by its behavioral assertion", flush=True)
            print("Three targeted mutants and two reverse-fix controls caught. This is not an exhaustive mutation score.", flush=True)
    finally:
        (output / "report.json").write_text(json.dumps(summary, indent=2) + "\n")


if __name__ == "__main__":
    main()
