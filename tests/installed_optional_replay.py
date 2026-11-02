"""Exact installed OpenCode 2.2.0 transform replay and plugin-group lifecycle proof.

Loads the npm-packed Loom server through a fault-injection wrapper inside
an UNMODIFIED native host. Only isolated local in-memory providers are used.
A deliberate uncontained control callback establishes that native State.group
really would remove a model.request guard on transform failure.

The control intentionally sends one local "metered"-LABELLED fake request
after disabling the wrapper. It has no credentials, network AI provider or
billing relevance; it is a discrimination control, NOT safe subscription routing.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import subprocess
import tarfile
import tempfile
import time
from pathlib import Path

from installed_host_smoke import (
    PrivateHost, installed_plugin_inventory, isolated_environment, require,
    roster_response,
)
from installed_questions import request
from installed_routing_acceptance import (
    HOST_VERSION, SDK_VERSION, read_events, routing_policy, wait_terminal,
)


def replay_events(root: Path) -> list[str]:
    path = root / "replay-events.ndjson"
    return [json.loads(line)["event"] for line in path.read_text().splitlines()] if path.exists() else []


def roster(host: PrivateHost, project: Path) -> dict:
    items = roster_response(host.get("/api/plugin", "plugins"), project)
    return {item["id"]: item for item in items}


def case(mode: str, enabled: bool, cli: Path, plugin: Path,
         repo: Path, output: Path) -> dict:
    label = f"{mode}-{'enabled' if enabled else 'disabled'}"
    with tempfile.TemporaryDirectory(prefix="loom-routing-replay-") as temp:
        root = Path(temp).resolve()
        project = root / "project"
        project.mkdir()
        env = isolated_environment(root)
        env["LOOM_REPLAY_ROOT"] = str(root)
        env["LOOM_REPLAY_PACKED_SERVER"] = str((plugin / "server.ts").resolve())
        env["LOOM_REPLAY_FAULT"] = mode
        env["LOOM_ROUTING_FIXTURE"] = str(root)
        subprocess.run(["git", "init", "-q", str(project)], check=True, env=env, timeout=10)
        (root / "scenario.json").write_text(json.dumps({"kind": "text"}) + "\n")
        (project / ".loom.yaml").write_text(json.dumps(routing_policy(enabled)) + "\n")
        (Path(env["OPENCODE_CONFIG_DIR"]) / "opencode.json").write_text(json.dumps({
            "plugins": ["*", str(repo / "tests/routing-replay-host"),
                        str(repo / "tests/routing-host")],
            "agents": {"architect": {"description": "Private replay fixture",
                                    "mode": "primary", "system": "Return local answer."}},
            # Prove that absent Loom's guard the default is callable, not
            # that this synthetic route is a billable subscription.
            "model": "route-metered/sol", "update": "disable", "share": "disabled",
        }) + "\n")

        host = PrivateHost(str(cli), project, env, output, label)
        try:
            info = json.loads(host.get("/api/info", "info"))
            require(info.get("version") == HOST_VERSION, "Wrong installed OpenCode host")
            host.wait_roster("/api/plugin", "plugins", lambda items: all(
                any(p.get("id") == target and p.get("state", {}).get("status") == "active"
                    for p in items)
                for target in ("loom", "loom.routing.acceptance.fixture")))
            require("packed-loom-loaded" in replay_events(root),
                    "Wrapper did not load the packed candidate Loom entrypoint")

            (root / "trigger-replay").write_text("replay once\n")
            target = ("injected-skill-get-fault" if mode == "skill" else
                      "injected-review-add-fault" if mode == "review" else
                      "injected-uncontained-control-fault")
            deadline = time.monotonic() + 20
            state = None
            while time.monotonic() < deadline:
                observed = replay_events(root)
                status = roster(host, project).get("loom", {}).get("state", {}).get("status")
                if target in observed and status == ("failed" if mode == "control" else "active"):
                    state = status
                    break
                time.sleep(.10)
            require(state is not None,
                    f"{label}: native replay did not reach expected plugin-group state; "
                    f"observed events={replay_events(root)}")
            before = len(read_events(root))
            session = request(host, "POST", "/api/session", {
                "agent": "architect", "title": label,
                "location": {"directory": str(project)},
            })["id"]
            request(host, "POST", f"/api/session/{session}/prompt", {
                "text": "LOCAL_REPLAY_" + label,
            })
            result = wait_terminal(host, session)
            observed = read_events(root)[before:]
            calls = [e for e in observed if e.get("type") == "provider-request"]
            errors = json.dumps(result) + "\n" + (
                output / f"{label}.server.stderr.txt").read_text(errors="replace")
            if mode == "control":
                require(result.get("outcome") == "succeeded",
                        "Uncontained native-group control did not execute its local default")
                require(len(calls) == 1 and calls[0]["data"]["providerID"] == "route-metered",
                        "Control failed to prove local native transport after host disabled wrapper")
            elif enabled:
                require(result.get("outcome") == "failed", "Managed route unexpectedly executed")
                require(not calls, "Deferred optional callback failure removed native deny guard")
                require("LOOM_MODEL_ROUTING_HOST_UNQUALIFIED" in errors,
                        "Native model transport was blocked for an unrelated reason")
            else:
                require(result.get("outcome") == "succeeded",
                        "Routing-disabled mode was changed by optional replay")
                require(len(calls) == 1 and calls[0]["data"]["providerID"] == "route-metered",
                        "Disabled native default did not reach the local provider")

            return {
                "case": label, "status": "PASS", "host_plugin_status": state,
                "fault_observed": target, "provider_calls": len(calls),
                "outcome": result.get("outcome"),
                "boundary": ("native-uncontained-transform-control" if mode == "control"
                             else "packed-Loom-optional-transform-replay"),
                "account_billing": "UNPROVEN: local scripted provider only",
            }
        finally:
            host.close()


def run(cli: Path, repo: Path, plugin: Path, artifact: Path,
        output: Path, expected_version: str) -> dict:
    output.mkdir(parents=True, exist_ok=True)
    report = {
        "kind": "installed-optional-replay-v220",
        "status": "FAIL", "host_required": HOST_VERSION,
        "sdk_required": SDK_VERSION, "positive_managed_routing": "UNPROVEN",
        "source": "npm-packed Loom server inside real host State.group via fault wrapper",
        "cases": [],
    }
    try:
        report["candidate"] = installed_plugin_inventory(
            artifact, plugin, expected_version, SDK_VERSION)
        with tarfile.open(artifact, "r:gz") as archive:
            packed = archive.extractfile("package/server.ts")
            require(packed is not None, "Packed artifact missing server.ts")
            digest = hashlib.sha256(packed.read()).hexdigest()
        require(digest == hashlib.sha256((plugin / "server.ts").read_bytes()).hexdigest(),
                "Injected candidate server differs from packed artifact")
        report["packed_server_sha256"] = digest
        observed = subprocess.run([str(cli), "--version"], capture_output=True,
                                  text=True, check=True, timeout=20)
        require(HOST_VERSION in observed.stdout, "Wrong CLI version")
        report["host_observed"] = observed.stdout.strip()
        for mode, enabled in (("skill", True), ("review", True),
                              ("review", False), ("control", True)):
            report["cases"].append(case(mode, enabled, cli, plugin, repo, output))
        report["status"] = "PASS"
    except Exception as error:
        report["error"] = f"{type(error).__name__}: {error}"
        raise
    finally:
        (output / "replay-report.json").write_text(json.dumps(report, indent=2) + "\n")
    return report


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--opencode", type=Path, required=True)
    parser.add_argument("--repository", type=Path, required=True)
    parser.add_argument("--plugin", type=Path, required=True)
    parser.add_argument("--artifact", type=Path, required=True)
    parser.add_argument("--expect-plugin-version", required=True)
    parser.add_argument("--report-directory", type=Path, required=True)
    args = parser.parse_args()
    report = run(args.opencode.resolve(), args.repository.resolve(),
                 args.plugin.resolve(), args.artifact.resolve(),
                 args.report_directory.resolve(), args.expect_plugin_version)
    print(json.dumps({"status": report["status"], "cases": report["cases"],
                      "positive_managed_routing": report["positive_managed_routing"]}, indent=2))


if __name__ == "__main__":
    main()
