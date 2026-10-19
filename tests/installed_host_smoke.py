"""No-inference installed OpenCode boot probe; NOT the two-agent acceptance test."""
from __future__ import annotations

import argparse
import base64
import hashlib
import json
import os
import re
import secrets
import signal
import sqlite3
import subprocess
import tarfile
import tempfile
import time
from contextlib import closing
from pathlib import Path
from urllib.parse import urlencode, urlsplit
from urllib.request import HTTPRedirectHandler, ProxyHandler, Request, build_opener

EXPECTED_TABLES = {"actions", "plans", "focus", "ledger"}
PROBE_AGENTS = {
    "probe-research": {"description": "External research fixture", "mode": "subagent", "system": "Read the supplied sources."},
    "probe-worker": {"description": "External worker fixture", "mode": "subagent", "system": "Implement only the assigned task."},
}


def require(condition: bool, message: str) -> None:
    if not condition:
        raise RuntimeError(message)


def host_config(plugin: Path | None = None) -> dict:
    return {"plugins": ["*", *([str(plugin)] if plugin else [])], "agents": PROBE_AGENTS,
            "update": "disable", "share": "disabled"}


def roster_response(text: str, project: Path) -> list[dict]:
    response = json.loads(text)
    require(isinstance(response, dict) and isinstance(response.get("location"), dict), "Expected location/data envelope")
    require(response["location"].get("directory") == str(project), "Host responded for a different location")
    data = response.get("data")
    require(isinstance(data, list) and all(isinstance(item, dict) for item in data), "Host roster must be a list of objects")
    return data


def endpoint_path(path: str, project: Path) -> str:
    require(path in {"/api/agent", "/api/plugin", "/api/config", "/api/info"}, "Only read-only boot endpoints are permitted")
    return path if path == "/api/info" else path + "?" + urlencode({"location[directory]": str(project)})


def ready_url(text: str) -> str:
    url = json.loads(text)["url"]
    parts = urlsplit(url)
    require(parts.scheme == "http" and parts.hostname in {"127.0.0.1", "::1"}
            and parts.port is not None and not parts.username and not parts.password
            and not parts.query and not parts.fragment and parts.path in {"", "/"},
            "Private host must advertise a loopback HTTP endpoint")
    return url.rstrip("/")


def isolated_environment(root: Path) -> dict[str, str]:
    env = {k: os.environ[k] for k in ("PATH", "SYSTEMROOT", "WINDIR") if k in os.environ}
    env.update({"CI": "1", "TERM": "dumb", "NO_COLOR": "1", "LANG": "C.UTF-8", "OPENCODE_PRINT_LOGS": "1"})
    for key, directory in {
        "HOME": "home", "XDG_CONFIG_HOME": "config", "XDG_DATA_HOME": "data",
        "XDG_STATE_HOME": "state", "XDG_CACHE_HOME": "cache", "TMPDIR": "tmp",
        "XDG_RUNTIME_DIR": "run", "OPENCODE_CONFIG_DIR": "config/opencode",
    }.items():
        path = root / directory
        path.mkdir(parents=True, exist_ok=True, mode=0o700)
        env[key] = str(path)
    return env


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        raise RuntimeError("Private host redirected a boot request")


class PrivateHost:
    """Keep one real host alive across reads; its plugin activation is asynchronous."""
    def __init__(self, executable: str, project: Path, env: dict, output: Path, label: str):
        self.project, self.output, self.label = project, output, label
        self.password = secrets.token_urlsafe(24)
        self.opener = build_opener(ProxyHandler({}), NoRedirect())
        self.stdout_path = output / f"{label}.server.stdout.txt"
        self.stdout = self.stdout_path.open("w")
        self.stderr = (output / f"{label}.server.stderr.txt").open("w")
        try:
            self.proc = subprocess.Popen([executable, "serve", "--stdio", "--hostname", "127.0.0.1", "--port", "0"],
                cwd=project, env={**env, "OPENCODE_PASSWORD": self.password}, stdin=subprocess.PIPE,
                stdout=self.stdout, stderr=self.stderr, start_new_session=True)
        except Exception:
            self.stdout.close(); self.stderr.close(); raise
        try:
            deadline = time.monotonic() + 30
            while time.monotonic() < deadline:
                require(self.proc.poll() is None, f"{label}: server exited before readiness")
                with self.stdout_path.open() as stream:
                    line = stream.readline(65536)
                if line.endswith("\n"):
                    self.url = ready_url(line)
                    return
                time.sleep(0.05)
            raise RuntimeError(f"{label}: server readiness timed out")
        except Exception:
            self.close(); raise

    def close(self):
        if self.proc.stdin and not self.proc.stdin.closed:
            self.proc.stdin.close()  # EOF releases the private server's ownership lease.
        try:
            self.proc.wait(timeout=5)
        except subprocess.TimeoutExpired:
            try:
                os.killpg(self.proc.pid, signal.SIGKILL)
            except ProcessLookupError:
                pass
            self.proc.wait(timeout=5)
        finally:
            self.stdout.close(); self.stderr.close()

    def get(self, path: str, label: str) -> str:
        require(self.proc.poll() is None, f"{self.label}: server stopped during validation")
        token = base64.b64encode(f"opencode:{self.password}".encode()).decode()
        request = Request(self.url + endpoint_path(path, self.project), headers={"Authorization": "Basic " + token})
        with self.opener.open(request, timeout=10) as response:
            data = response.read(2 * 1024 * 1024 + 1)
        require(len(data) <= 2 * 1024 * 1024, "Boot response exceeded 2 MiB")
        text = data.decode()
        (self.output / f"{self.label}.{label}.latest.json").write_text(text + "\n")
        return text

    def wait_roster(self, path: str, label: str, predicate) -> tuple[list[dict], int]:
        # A successful HTTP response is not evidence that activation has finished.
        for attempt in range(120):
            data = roster_response(self.get(path, label), self.project)
            for item in data:
                if item.get("state", {}).get("status") == "failed":
                    raise RuntimeError(f"{self.label}: plugin failure: {item}")
            if predicate(data):
                return data, attempt + 1
            time.sleep(0.25)
        raise RuntimeError(f"{self.label}: expected {label} did not become ready; inspect latest response")


def ledger_inventory(state: Path) -> list[dict]:
    result = []
    for path in sorted((state / "loom" / "actions-v1").glob("*/ledger.sqlite")):
        with closing(sqlite3.connect(path.as_uri() + "?mode=ro", uri=True)) as db:
            tables = {row[0] for row in db.execute("SELECT name FROM sqlite_master WHERE type='table'")}
            require(EXPECTED_TABLES <= tables, f"Incomplete Loom schema at {path}")
            require(db.execute("PRAGMA integrity_check").fetchone()[0] == "ok", "Loom database integrity failure")
            require(db.execute("PRAGMA user_version").fetchone()[0] == 1, "Unexpected Loom schema version")
            result.append({"relative_path": str(path.relative_to(state)), "counts": {
                table: db.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0] for table in sorted(EXPECTED_TABLES)}})
    return result


def source_inventory(repo: Path) -> dict:
    # Inspect the candidate on disk, including additions and deletions. A source
    # archive/shallow checkout must not depend on historical Git objects.
    paths = [str(p.relative_to(repo)) for name in ("src", "tests") for p in (repo / name).rglob("*") if p.is_file()]
    identity = subprocess.run(["git", "-C", str(repo), "rev-parse", "--show-toplevel", "HEAD"],
                              capture_output=True, text=True, check=False)
    lines = identity.stdout.splitlines()
    head = lines[1] if identity.returncode == 0 and len(lines) == 2 and Path(lines[0]).resolve() == repo.resolve() else None
    callers, definitions = [], []
    for name in filter(None, paths):
        if not name.endswith((".ts", ".mjs", ".js")):
            continue
        for number, line in enumerate((repo / name).read_text(encoding="utf-8").splitlines(), 1):
            if re.search(r"\.recent\s*\(", line):
                callers.append({"path": name, "line": number})
            if re.search(r"^\s*recent\s*\(", line):
                definitions.append({"path": name, "line": number})
    return {"head": head,
            "runtime_sha256": {str(p.relative_to(repo)): hashlib.sha256(p.read_bytes()).hexdigest()
                               for p in sorted((repo / "src").glob("*.ts"))},
            "recent_direct_call_sites": callers, "recent_definitions": definitions,
            "consumer_check_limit": "Direct source scan only; not an independent review or proof about external consumers."}


def installed_plugin_inventory(artifact: Path, plugin: Path, expected_version: str, expected_sdk: str) -> dict:
    require(artifact.is_file(), f"Candidate package artifact is missing: {artifact}")
    require(plugin.is_dir(), f"Installed candidate package is missing: {plugin}")
    with tarfile.open(artifact, "r:gz") as archive:
        member = archive.extractfile("package/package.json")
        require(member is not None, "Candidate artifact has no package/package.json")
        artifact_package = json.load(member)
    installed_package = json.loads((plugin / "package.json").read_text())
    require(artifact_package == installed_package, "Installed package metadata differs from candidate artifact")
    require(installed_package.get("name") == "loom-plugin", "Candidate artifact is not loom-plugin")
    require(installed_package.get("version") == expected_version, "Wrong installed plugin version")
    require(installed_package.get("dependencies", {}).get("@opencode/plugin") == expected_sdk,
            "Candidate artifact does not pin the expected SDK")
    sdk_package = None
    for directory in (plugin, *plugin.parents):
        candidate = directory / "node_modules" / "@opencode" / "plugin" / "package.json"
        sibling = directory / "@opencode" / "plugin" / "package.json"
        for path in (candidate, sibling):
            if path.is_file():
                sdk_package = json.loads(path.read_text())
                break
        if sdk_package is not None:
            break
    require(sdk_package is not None and sdk_package.get("version") == expected_sdk,
            f"Installed SDK is not @opencode/plugin@{expected_sdk}")
    return {"name": installed_package["name"], "version": installed_package["version"],
            "sdk_version": sdk_package["version"], "artifact_sha256": hashlib.sha256(artifact.read_bytes()).hexdigest(),
            "artifact_filename": artifact.name, "installed_path": str(plugin.resolve())}


def run_probe(executable: str, repo: Path, output: Path, expected: str, disable_watcher: bool = False,
              plugin: Path | None = None, artifact: Path | None = None,
              expected_plugin: str | None = None, expected_sdk: str = "2.0.32",
              profile: str = "canonical-2.0.32") -> dict:
    require(os.name == "posix", "This isolated process-group probe currently supports POSIX only")
    output.mkdir(parents=True, exist_ok=True)
    report = {"status": "running", "kind": "installed-host-boot-only", "profile": profile, "expected_version": expected,
              "model_prompts_sent_by_probe": 0, "independent_review": False,
              "two_agent_acceptance": "not exercised", "checks": [], **source_inventory(repo)}
    try:
        require(plugin is not None and artifact is not None and expected_plugin is not None,
                "Installed candidate plugin path, artifact and expected plugin version are required")
        report["candidate_artifact"] = installed_plugin_inventory(artifact.resolve(), plugin.resolve(), expected_plugin, expected_sdk)
        with tempfile.TemporaryDirectory(prefix="loom-installed-") as temporary:
            root = Path(temporary).resolve()
            env = isolated_environment(root)
            if disable_watcher:
                env["OPENCODE_FILEWATCHER_DISABLE"] = "1"
                report["filewatcher"] = "Disabled only inside disposable owned hosts; watcher behavior not qualified"
            project = root / "project"
            project.mkdir()
            subprocess.run(["git", "init", "-q", str(project)], env=env, check=True, timeout=10)
            version = subprocess.run([executable, "--version"], cwd=project, env=env, capture_output=True, text=True, check=True, timeout=15)
            (output / "version.stdout.txt").write_text(version.stdout)
            require(re.search(r"(?<![\d.])" + re.escape(expected) + r"(?![\d.])", version.stdout) is not None, "Wrong CLI version")
            report["observed_version"] = version.stdout.strip()
            config = Path(env["OPENCODE_CONFIG_DIR"]) / "opencode.json"
            state = Path(env["XDG_STATE_HOME"])
            baseline = None
            first = None
            for label, enabled in [("baseline", False), ("with-loom", True), ("restart", True), ("removed", False)]:
                config.write_text(json.dumps(host_config(plugin.resolve() if enabled else None)) + "\n")
                (config.parent / ".loom.yaml").write_text(json.dumps({"version": 1, "agents": {"probe-worker": {"roles": ["implementation"]}}}) + "\n")
                started = time.monotonic()
                with closing(PrivateHost(executable, project, env, output, label)) as host:
                    info = json.loads(host.get("/api/info", "info"))
                    require(info.get("version") == expected, "Wrong server version")
                    host.get("/api/config", "config")
                    def ready_agents(items):
                        return all(any(a.get("id") == name and a.get("description") == cfg["description"] for a in items)
                                   for name, cfg in PROBE_AGENTS.items())
                    agents, attempts = host.wait_roster("/api/agent", "agents", ready_agents)
                    def ready_plugins(items, enabled=enabled):
                        if not items:
                            return False
                        loom = next((p for p in items if p.get("id") == "loom"), None)
                        return loom is not None and loom.get("state", {}).get("status") == "active" if enabled else loom is None
                    plugins, plugin_attempts = host.wait_roster("/api/plugin", "plugins", ready_plugins)
                    # Re-read after plugin activation before comparing complete native definitions.
                    agents = sorted(roster_response(host.get("/api/agent", "agents-final"), project), key=lambda a: a["id"])
                    if baseline is None:
                        baseline = agents
                    else:
                        require(agents == baseline, f"{label}: native agent definitions changed")
                ledger = ledger_inventory(state)
                if label == "baseline":
                    require(not ledger, "Baseline unexpectedly loaded Loom")
                elif label == "with-loom":
                    require(len(ledger) == 1, "Expected exactly one host-created Loom database")
                    require(all(n == 0 for n in ledger[0]["counts"].values()), "Boot invented work or ledger entries")
                    first = ledger
                else:
                    require(ledger == first, "Restart/removal changed the existing empty ledger")
                report["checks"].append({"name": label, "agents": len(agents), "plugins": len(plugins),
                    "agent_read_attempts": attempts, "plugin_read_attempts": plugin_attempts,
                    "elapsed_seconds": round(time.monotonic() - started, 3)})
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
    parser.add_argument("--expect-version", default="2.0.32")
    parser.add_argument("--plugin", required=True, type=Path, help="Installed candidate package directory")
    parser.add_argument("--artifact", required=True, type=Path, help="Exact npm package tarball installed at --plugin")
    parser.add_argument("--expect-plugin-version", required=True)
    parser.add_argument("--expect-sdk-version", default="2.0.32")
    parser.add_argument("--profile", default="canonical-2.0.32", help="Explicit compatibility profile identity for the report")
    parser.add_argument("--disable-filewatcher", action="store_true", help="Owned disposable hosts only; does not qualify watcher behavior")
    args = parser.parse_args()
    try:
        print(json.dumps(run_probe(str(args.opencode.absolute()), args.repository.resolve(), args.report_directory.resolve(),
                                   args.expect_version, args.disable_filewatcher, args.plugin, args.artifact,
                                   args.expect_plugin_version, args.expect_sdk_version, args.profile), indent=2))
    except Exception as error:  # noqa: BLE001 -- convert any probe failure to a nonzero CLI exit.
        parser.exit(1, f"Installed-host boot probe failed: {error}\n")
