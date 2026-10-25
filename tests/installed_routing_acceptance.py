"""Actual OpenCode V2 + packed Loom acceptance controls using LOCAL scripted providers.

This test never supplies credentials, never uses the user's OpenCode config,
and never claims that scripted models prove live subscription/provider failover.
The current adapter has no native safe-retry contract and the separate quota
manager has not been wired to it; missing end-to-end cases are UNPROVEN.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import subprocess
import tempfile
import time
from pathlib import Path

from installed_host_smoke import (
    PrivateHost, installed_plugin_inventory, isolated_environment, require, source_inventory,
)
from installed_questions import request, idle
from routing_acceptance_oracle import (
    records, expect_transport, expect_blocked, expect_single_native_tool,
    expect_failed_local_provider, run_mutation_controls,
)

HOST_VERSION = "2.1.4"
SDK_VERSION = "2.1.1"
PROVIDERS = ("route-primary", "route-secondary", "route-metered")
AGENTS = ("architect", "coder", "reviewer")

# These require capabilities *outside* the assembled 2.1.4 initial-only
# adapter. Do not convert fixture calls, mock unit tests or skipped cases to PASS.
NOT_PROVEN = {
    "1-preferred-included": "No native local verified-included attestation source is wired to the packed plugin",
    "2-same-model-next-provider": "No native safe provider-switch API at a pre-output retry boundary",
    "3-next-model-after-exhaustion": "Runtime does not re-plan failed requests",
    "6-fallback-before-output": "2.1.4 retry cannot atomically replace a model before transport replay",
    "7-no-replay-after-tool": "One normal native tool execution is tested; fallback after a tool is not supported",
    "8-stream-and-tool-account-affinity": "Native provider connection has no atomic lease across stream/continuation",
    "9-reasoning-preserved-on-fallback": "Native variants are tested by unit tests; no installed verified alternate route",
    "10-cross-process-quota": "PR #192 quota store is separate and not connected to the installed adapter",
    "12-cancel-compaction-provider-failures": "Restart and scripted native provider errors tested; cancellation/compaction with live failover not integrated",
    "live-two-provider": "Two permitted real native provider connections and explicit paid-use consent not supplied",
}


def read_events(root: Path) -> list[dict]:
    path = root / "routing-events.ndjson"
    return [json.loads(line) for line in path.read_text().splitlines()] if path.exists() else []


def config(enabled: bool) -> dict:
    # Intentionally NO per-agent model fields; routing enabled must not
    # fall back to the native global model for a managed agent.
    return {
        "plugins": ["*"],  # absolute candidate and private fixture appended by run()
        "agents": {
            agent: {"description": "Private routing " + agent,
                    "mode": "primary", "system": "Return the local fixture result."}
            for agent in AGENTS
        },
        "model": "route-primary/sol", "update": "disable", "share": "disabled",
    }


def routing_policy(enabled: bool, reasoning: str = "medium") -> dict:
    return {
        "model-routing": {
            "enabled": enabled, "default-class": "strong",
            "default-reasoning": reasoning, "paid-fallback": False,
            "provider-order": list(PROVIDERS),
        },
        "model-classes": {"strong": {"models": ["sol", "astra"]}},
        "agents": {a: {"roles": ["route-test"]} for a in AGENTS},
        "roles": {"route-test": {"model-class": "strong", "reasoning": reasoning}},
        # These aliases must match exactly; local providers supply both names.
        "model-aliases": {"sol": {p: "sol" for p in PROVIDERS}},
    }


def wait_terminal(host: PrivateHost, session: str) -> dict:
    end = time.monotonic() + 30
    current = None
    while time.monotonic() < end:
        current = request(host, "GET", f"/api/session/{session}")
        if current.get("outcome") in ("succeeded", "failed", "interrupted"):
            break
        time.sleep(.10)
    idle(host, [session], timeout=30)
    require(current is not None and current.get("outcome") in ("succeeded", "failed", "interrupted"),
            "Session had no terminal outcome within bounded installed-host wait")
    return current


def interrupt_after_fault(host: PrivateHost, session: str, root: Path, start: int,
                          *, after_tool: bool) -> bool:
    """Use the actual V2 interrupt route; never wait for unlimited provider retries."""
    deadline = time.monotonic() + 10
    while time.monotonic() < deadline:
        events = read_events(root)[start:]
        calls = records(events, "provider-request")
        executed = [e for e in records(events, "tool-after")
                    if e["data"].get("tool") == "execute" and e["data"].get("status") == "completed"]
        if (len(calls) >= 2 and executed) if after_tool else bool(calls):
            break
        time.sleep(.05)
    else:
        raise RuntimeError("Scripted provider fault did not reach its expected native boundary")
    response = request(host, "POST", f"/api/session/{session}/interrupt")
    require(isinstance(response, dict) and "interrupted" in response,
            "Installed host did not return a native V2 interrupt result")
    return bool(response["interrupted"])


def run_case(
    name: str, cli: Path, repo: Path, plugin: Path,
    output: Path, root: Path, env: dict, *,
    enabled: bool, scenario: str = "text", model: str = "route-primary",
    expect: str, reasoning: str = "medium",
) -> dict:
    project = root / "project"
    (root / "scenario.json").write_text(json.dumps({"kind": scenario}) + "\n")
    (project / ".loom.yaml").write_text(json.dumps(routing_policy(enabled, reasoning)) + "\n")
    host_config = config(enabled)
    host_config["plugins"].extend([str(plugin), str(repo / "tests/routing-host")])
    config_path = Path(env["OPENCODE_CONFIG_DIR"]) / "opencode.json"
    config_path.write_text(json.dumps(host_config) + "\n")
    start = len(read_events(root))
    host = PrivateHost(str(cli), project, env, output, name)
    try:
        info = json.loads(host.get("/api/info", "info"))
        require(info.get("version") == HOST_VERSION, "Wrong unmodified native host")
        host.wait_roster("/api/plugin", "plugins", lambda ps: all(any(
            p.get("id") == identifier and p.get("state", {}).get("status") == "active"
            for p in ps
        ) for identifier in ("loom", "loom.routing.acceptance.fixture")))
        selection = {"providerID": model, "id": "sol"} if model != "route-primary" else None
        payload = {"agent": "architect", "title": name,
                   "location": {"directory": str(project)}}
        if selection:
            payload["model"] = selection
        session = request(host, "POST", "/api/session", payload)["id"]
        request(host, "POST", f"/api/session/{session}/prompt", {"text": "LOCAL_ROUTING_ACCEPTANCE_" + name})
        interrupted = None
        if expect in ("provider-error", "tool-error"):
            interrupted = interrupt_after_fault(host, session, root, start,
                                                after_tool=(expect == "tool-error"))
        result = wait_terminal(host, session)
        captured = read_events(root)[start:]
        outcome = result.get("outcome")
        if expect == "one":
            require(outcome == "succeeded", f"{name}: native positive control did not succeed: {outcome}")
            calls = expect_transport(captured, model)
            require(calls[0]["data"].get("modelID") == "sol", "Wrong exact native model ID")
            require(not records(captured, "tool-before"), "Unexpected native tool execution")
        elif expect == "blocked":
            require(outcome == "failed", f"{name}: unavailable guarded request was not failed: {outcome}")
            expect_blocked(captured)
        elif expect == "tool":
            require(outcome == "succeeded", f"{name}: native tool continuation did not succeed: {outcome}")
            expect_single_native_tool(captured, model)
        elif expect in ("provider-error", "tool-error"):
            require(outcome in ("failed", "interrupted"), f"{name}: expected provider failure/interruption, got {outcome}")
            expect_failed_local_provider(captured, model, after_tool=(expect == "tool-error"))
        else:
            raise AssertionError("Unsupported test expectation")
        return {
            "name": name, "status": "PASS", "evidence_kind": "installed-local-provider",
            "routing_enabled": enabled, "session_outcome": outcome,
            "transport_routes": [e["data"]["providerID"] + "/" + e["data"]["modelID"]
                                 for e in records(captured, "provider-request")],
            "native_model_request_count": len(records(captured, "model-request")),
            "native_tool_before": len(records(captured, "tool-before")),
            "native_tool_after": len(records(captured, "tool-after")),
            "scenario": scenario, "native_interrupt_applied": interrupted,
        }
    finally:
        host.close()


def run(cli: Path, repo: Path, plugin: Path, artifact: Path, output: Path,
        expected_plugin_version: str) -> dict:
    output.mkdir(parents=True, exist_ok=True)
    report = {
        "kind": "installed-model-routing-acceptance-v214", "status": "UNPROVEN",
        "host_version_required": HOST_VERSION, "sdk_version_required": SDK_VERSION,
        "protection_controls": "NOT RUN", "live_provider_status": "UNPROVEN",
        "no_real_provider_credentials_used": True,
        "no_paid_provider_requests_allowed": True,
        "cases": [], "negative_controls": None,
        "unproven": [{"name": name, "reason": why} for name, why in NOT_PROVEN.items()],
    }
    try:
        report["candidate"] = installed_plugin_inventory(
            artifact, plugin, expected_plugin_version, SDK_VERSION)
        repo_source = source_inventory(repo)
        report["commit_sha"] = repo_source.get("head")
        report["plugin_source_sha256"] = repo_source["runtime_sha256"]
        report["fixture_sha256"] = {
            p: hashlib.sha256((repo / p).read_bytes()).hexdigest()
            for p in ("tests/routing-host/server.ts", "tests/routing-host/provider.mjs",
                      "tests/installed_routing_acceptance.py", "tests/routing_acceptance_oracle.py")
        }
        report["negative_controls"] = run_mutation_controls()
        observed = subprocess.check_output([str(cli), "--version"], timeout=15, text=True).strip()
        report["host_version_observed"] = observed
        require(observed in (HOST_VERSION, "opencode v" + HOST_VERSION),
                "Host must be an unmodified OpenCode 2.1.4")
        with tempfile.TemporaryDirectory(prefix="loom-routing-acceptance-") as temp:
            root = Path(temp).resolve()
            project = root / "project"
            project.mkdir()
            env = isolated_environment(root)  # Never inherit user's OPENAI_API_KEY or auth/config directories.
            env["LOOM_ROUTING_FIXTURE"] = str(root)
            subprocess.run(["git", "init", "-q", str(project)], env=env, check=True, timeout=10)
            checks = [
                # Positive controls prove the scripted providers really work
                # when Loom routing has been disabled.
                ("disabled-primary", False, "text", "route-primary", "one", "medium"),
                ("disabled-secondary", False, "text", "route-secondary", "one", "medium"),
                ("disabled-metered", False, "text", "route-metered", "one", "medium"),
                # The native host actually executes a tool and then sends a
                # second model request; we inspect the real execute hook.
                ("disabled-tool-continuation", False, "tool", "route-primary", "tool", "medium"),
                # Faults are issued by the in-memory language model AFTER
                # actual native transport. These must never call a different
                # provider or execute/replay a native tool.
                ("disabled-before-output-error", False, "pre-output-error",
                 "route-primary", "provider-error", "medium"),
                ("disabled-after-text-error", False, "partial-error",
                 "route-primary", "provider-error", "medium"),
                ("disabled-after-tool-error", False, "tool-then-error",
                 "route-primary", "tool-error", "medium"),
                # No fake 'subscription: included' hints are accepted.
                ("enabled-unknown-billing", True, "text", "route-primary", "blocked", "medium"),
                # A known-positive native metered transport must be blocked
                # with paid-fallback: false when billing is not verified.
                ("enabled-no-metered-fallback", True, "text", "route-metered", "blocked", "medium"),
                # The fixture catalog has medium only. No request can silently
                # lower requested high; full reasoning acceptance is UNPROVEN.
                ("enabled-no-reasoning-downgrade", True, "text", "route-primary", "blocked", "high"),
                # Restart with unchanged routing policy must still fail closed.
                ("enabled-guard-after-restart", True, "text", "route-primary", "blocked", "medium"),
                ("disabled-after-restart", False, "text", "route-secondary", "one", "medium"),
            ]
            for name, enabled, scenario, model, expectation, reasoning in checks:
                report["cases"].append(run_case(
                    name, cli, repo, plugin, output, root, env,
                    enabled=enabled, scenario=scenario, model=model,
                    expect=expectation, reasoning=reasoning))
        report["protection_controls"] = "PASS"
        # The overall verdict stays UNPROVEN until every required integration
        # case has installed-host and (where required) real-provider evidence.
        report["status"] = "UNPROVEN"
    except Exception as error:
        report["status"] = "FAIL"
        report["protection_controls"] = "FAIL"
        report["error"] = f"{type(error).__name__}: {error}"
        raise
    finally:
        (output / "report.json").write_text(json.dumps(report, indent=2) + "\n")
    return report


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--opencode", type=Path, required=True)
    parser.add_argument("--repository", type=Path, required=True)
    parser.add_argument("--plugin", type=Path, required=True)
    parser.add_argument("--artifact", type=Path, required=True)
    parser.add_argument("--expect-plugin-version", required=True)
    parser.add_argument("--report-directory", type=Path, required=True)
    args = parser.parse_args()
    report = run(args.opencode.resolve(), args.repository.resolve(), args.plugin.resolve(),
                 args.artifact.resolve(), args.report_directory.resolve(), args.expect_plugin_version)
    print(json.dumps({"status": report["status"],
                      "protection_controls": report["protection_controls"],
                      "cases": [{k: item[k] for k in ("name", "status", "session_outcome", "transport_routes")}
                                for item in report["cases"]],
                      "unproven": [item["name"] for item in report["unproven"]]}, indent=2))


if __name__ == "__main__":
    main()
