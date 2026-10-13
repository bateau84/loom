#!/usr/bin/env python3
"""No-inference installed OpenCode boot probe; NOT the two-agent acceptance test."""
from __future__ import annotations

import argparse
from contextlib import closing
import hashlib
import json
import os
from pathlib import Path
import re
import signal
import sqlite3
import subprocess
import tempfile
import time
from urllib.parse import urlencode

EXPECTED_TABLES = {"actions", "plans", "focus", "ledger"}
PROBE_AGENTS = {
    "probe-research": {"description": "External research fixture", "mode": "subagent", "system": "Read the supplied sources."},
    "probe-worker": {"description": "External worker fixture", "mode": "subagent", "system": "Implement only the assigned task."},
}


def host_config(plugin: Path | None = None) -> dict:
    # Preserve built-in plugin enablement; the fixtures are external native config.
    return {"plugins": ["*", *([str(plugin)] if plugin else [])], "agents": PROBE_AGENTS,
            "update": "disable", "share": "disabled"}


def roster_response(text: str, project: Path) -> list[dict]:
    response = json.loads(text)
    require(isinstance(response, dict) and isinstance(response.get("location"), dict),
            "Expected the pinned host's location/data envelope")
    require(response["location"].get("directory") == str(project), "Host responded for a different location")
    data = response.get("data")
    require(isinstance(data, list) and all(isinstance(item, dict) for item in data), "Host roster data must be a list of objects")
    return data


def require(condition: bool, message: str) -> None:
    if not condition:
        raise RuntimeError(message)


def isolated_environment(root: Path) -> dict[str, str]:
    # Never pass provider keys, shared-server addresses or the user's OpenCode config.
    env = {k: os.environ[k] for k in ("PATH", "SYSTEMROOT", "WINDIR") if k in os.environ}
    env.update({"CI": "1", "TERM": "dumb", "NO_COLOR": "1", "LANG": "C.UTF-8"})
    for key, directory in {
        "HOME": "home", "XDG_CONFIG_HOME": "config", "XDG_DATA_HOME": "data",
        "XDG_STATE_HOME": "state", "XDG_CACHE_HOME": "cache", "TMPDIR": "tmp",
        "XDG_RUNTIME_DIR": "run", "OPENCODE_CONFIG_DIR": "config/opencode",
    }.items():
        path = root / directory
        path.mkdir(parents=True, exist_ok=True, mode=0o700)
        env[key] = str(path)
    return env


def api_get_args(path: str, project: Path) -> list[str]:
    require(path in {"/api/agent", "/api/plugin"}, "Boot probe only permits read-only roster endpoints")
    return ["api", "--standalone", "GET", path + "?" + urlencode({"location[directory]": str(project)})]


def ledger_inventory(state: Path) -> list[dict]:
    result = []
    for path in sorted((state / "loom" / "actions-v1").glob("*/ledger.sqlite")):
        # Read only. Do not initialize, repair or otherwise create the expected tables.
        with closing(sqlite3.connect(path.as_uri() + "?mode=ro", uri=True)) as db:
            tables = {row[0] for row in db.execute("SELECT name FROM sqlite_master WHERE type='table'")}
            require(EXPECTED_TABLES <= tables, f"Incomplete Loom schema at {path}")
            require(db.execute("PRAGMA integrity_check").fetchone()[0] == "ok", "Loom database integrity failure")
            require(db.execute("PRAGMA user_version").fetchone()[0] == 1, "Unexpected Loom schema version")
            result.append({"relative_path": str(path.relative_to(state)),
                           "counts": {table: db.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0]
                                      for table in sorted(EXPECTED_TABLES)}})
    return result


def source_inventory(repo: Path) -> dict:
    paths = subprocess.check_output(["git", "-C", str(repo), "ls-files", "-z"]).decode().split("\0")
    callers, definitions = [], []
    for name in filter(None, paths):
        if not name.endswith((".ts", ".mjs", ".js")):
            continue
        for number, line in enumerate((repo / name).read_text(encoding="utf-8").splitlines(), 1):
            if re.search(r"\.recent\s*\(", line):
                callers.append({"path": name, "line": number})
            if re.search(r"^\s*recent\s*\(", line):
                definitions.append({"path": name, "line": number})
    return {"head": subprocess.check_output(["git", "-C", str(repo), "rev-parse", "HEAD"], text=True).strip(),
            "runtime_sha256": {str(p.relative_to(repo)): hashlib.sha256(p.read_bytes()).hexdigest()
                               for p in sorted((repo / "src").glob("*.ts"))},
            "recent_direct_call_sites": callers, "recent_definitions": definitions,
            "consumer_check_limit": "Direct source scan only; not an independent review or proof about external consumers."}


def run_probe(executable: str, repo: Path, output: Path, expected: str) -> dict:
    require(os.name == "posix", "This isolated process-group probe currently supports POSIX only")
    output.mkdir(parents=True, exist_ok=True)
    report = {"status": "running", "kind": "installed-host-boot-only", "expected_version": expected,
              "model_prompts_sent_by_probe": 0, "independent_review": False,
              "two_agent_acceptance": "not exercised", "checks": [], **source_inventory(repo)}
    (output / "report.json").write_text(json.dumps(report, indent=2) + "\n")
    try:
        with tempfile.TemporaryDirectory(prefix="loom-installed-") as temporary:
            root = Path(temporary).resolve()
            env = isolated_environment(root)
            project = root / "project"
            project.mkdir()
            subprocess.run(["git", "init", "-q", str(project)], env=env, check=True, timeout=10)
            config = Path(env["OPENCODE_CONFIG_DIR"]) / "opencode.json"
            config.write_text(json.dumps(host_config()) + "\n")

            def run(label: str, *args: str) -> str:
                started = time.monotonic()
                proc = subprocess.Popen([executable, *args], cwd=project, env=env,
                                        stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                                        text=True, start_new_session=True)
                try:
                    try:
                        stdout, stderr = proc.communicate(timeout=90)
                    except subprocess.TimeoutExpired:
                        os.killpg(proc.pid, signal.SIGKILL)
                        stdout, stderr = proc.communicate()
                        (output / f"{label}.stdout.txt").write_text(stdout)
                        (output / f"{label}.stderr.txt").write_text(stderr)
                        raise RuntimeError(f"{label} timed out; isolated process group stopped")
                finally:
                    # Also stop a private server if it outlived the CLI command.
                    try:
                        os.killpg(proc.pid, signal.SIGKILL)
                    except ProcessLookupError:
                        pass
                (output / f"{label}.stdout.txt").write_text(stdout)
                (output / f"{label}.stderr.txt").write_text(stderr)
                require(proc.returncode == 0, f"{label} exited {proc.returncode}; inspect captured stderr")
                report["checks"].append({"name": label, "exit_code": proc.returncode,
                                         "elapsed_seconds": round(time.monotonic() - started, 3)})
                return stdout

            version = run("version", "--version").strip()
            require(re.search(r"(?<![\d.])" + re.escape(expected) + r"(?![\d.])", version) is not None,
                    f"Wrong OpenCode version: {version!r}")
            report["observed_version"] = version
            baseline = roster_response(run("native-agents-before", *api_get_args("/api/agent", project)), project)
            require(isinstance(baseline, list) and len(baseline) > 0, "Native agent list must be non-empty")
            baseline.sort(key=lambda a: a["id"])
            for name, definition in PROBE_AGENTS.items():
                actual = next((a for a in baseline if a.get("id") == name), None)
                require(actual is not None and actual.get("description") == definition["description"],
                        f"Real host did not load external native agent {name}")
            native_id = "probe-worker"
            state = Path(env["XDG_STATE_HOME"])
            require(not ledger_inventory(state), "Baseline unexpectedly loaded Loom")
            config.write_text(json.dumps(host_config(repo)) + "\n")
            loom_config = Path(env["OPENCODE_CONFIG_DIR"]) / ".loom.yaml"
            # JSON is a YAML subset; the plugin still decodes this with its real YAML loader.
            loom_config.write_text(json.dumps({"version": 1, "agents": {native_id: {"roles": ["implementation"]}}}) + "\n")
            listing = roster_response(run("plugin-list", *api_get_args("/api/plugin", project)), project)
            require(isinstance(listing, list) and any(p.get("id") == "loom" for p in listing),
                    "Real host did not report loaded plugin ID loom")
            after = roster_response(run("native-agents-with-loom", *api_get_args("/api/agent", project)), project)
            after.sort(key=lambda a: a["id"])
            require(after == baseline, "Loom changed native agent definitions")
            first = ledger_inventory(state)
            require(len(first) == 1, "Expected exactly one project Loom Action database")
            require(all(n == 0 for n in first[0]["counts"].values()), "Boot invented work or ledger records")
            restarted = roster_response(run("plugin-list-after-restart", *api_get_args("/api/plugin", project)), project)
            require(any(p.get("id") == "loom" for p in restarted), "Loom did not load after private-server restart")
            require(ledger_inventory(state) == first, "Boot restart changed the existing empty ledger")
            # Removing Loom's config entry tests rollback of loading, not historical data migration.
            config.write_text(json.dumps(host_config()) + "\n")
            rollback = roster_response(run("plugin-list-after-removal", *api_get_args("/api/plugin", project)), project)
            require(isinstance(rollback, list) and not any(p.get("id") == "loom" for p in rollback), "Loom still loads after config removal")
            restored = roster_response(run("native-agents-after-removal", *api_get_args("/api/agent", project)), project)
            require(sorted(restored, key=lambda a: a["id"]) == baseline,
                    "Native agents changed after plugin removal")
            require(ledger_inventory(state) == first, "Removing the plugin modified its saved database")
            report["ledger"] = first
            report["status"] = "passed"
    except Exception as error:
        report["status"] = "failed"
        report["error"] = f"{type(error).__name__}: {error}"
        raise
    finally:
        (output / "report.json").write_text(json.dumps(report, indent=2) + "\n")
    return report


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--opencode", required=True, type=Path, help="Already installed CLI; nothing is installed by this script")
    parser.add_argument("--repository", type=Path, default=Path(__file__).resolve().parents[1])
    parser.add_argument("--report-directory", required=True, type=Path)
    parser.add_argument("--expect-version", default="2.0.18")
    args = parser.parse_args()
    try:
        result = run_probe(str(args.opencode.absolute()), args.repository.resolve(), args.report_directory.resolve(), args.expect_version)
        print(json.dumps(result, indent=2))
    except Exception as error:
        parser.exit(1, f"Installed-host boot probe failed: {error}\n")
