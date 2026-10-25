"""Actual OpenCode V2 + packed Loom acceptance controls using LOCAL scripted providers.

This test never supplies credentials, never uses the user's OpenCode config,
and never claims that scripted models prove live subscription/provider failover.
The current adapter has no native safe-retry contract with the shared quota store assembled. Real billing and native account leasing
are not simulated as successful production claims.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import stat
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
REQUIREMENTS = [
    (1, "UNPROVEN", "Positive role-to-model selection on installed host needs verified included billing; mocked adapter tests are separate."),
    (2, "UNPROVEN", "Installed host proves high is not silently downgraded, not positive supported-variant dispatch."),
    (3, "UNPROVEN", "Same-model/next-provider order is shown in native adapter tests, not installed provider requests."),
    (4, "UNPROVEN", "Fresh installed-host selection after another process exhausts an eligible, attested route cannot be observed."),
    (5, "UNPROVEN", "Mocked pre-dispatch rejection is tested; local installed fixtures have no eligible committed route."),
    (6, "UNPROVEN", "Independent Bun processes share real SQLite quota blocks/recovery; assembled native dispatch lacks included attestation."),
    (7, "UNPROVEN", "Real shared store isolates synthetic provider accounts; installed native account switching is not proven."),
    (8, "PASS", "Local installed host rejects unverified routes; independently verified metered-billing policy is not isolated because no eligible managed route exists."),
    (9, "UNPROVEN", "Global-default transport is denied locally, but the scenario also has no eligible route; the mismatch-specific guard is not isolated."),
    (10, "UNPROVEN", "In-process adapter has an account/route guard; native stream/account lease cannot be proven."),
    (11, "UNPROVEN", "Native disabled-path errors and tools are counted; managed-tool interruption and any live fallback remain unproven."),
    (12, "PASS", "Actual installed native host executes the routing-disabled primary, alternate and tool-continuation paths."),
]

# These require trusted native host / provider capabilities not supplied by
# local in-memory language models. A simulated response is never a PASS here.
NOT_PROVEN = {
    "positive-eligible-managed-native-request":
        "The production plugin has no trusted native billing attestation for these synthetic local provider IDs",
    "initial-replan-after-shared-exhaustion":
        "Replanning is mocked with test-only attestations, not observed on an installed eligible route",
    "committed-request-pre-dispatch-block":
        "The installed local fixtures have no previously committed verified-included route to pre-block",
    "live-provider-account-lease":
        "The OpenCode 2.1.4 stream does not expose an atomic native account lease",
    "real-opencode-go-quota":
        "OpenCode Go has no supported provider-enforced, no-paid inclusion attestation in this setup",
    "real-provider-billing":
        "No real provider credentials or authorized paid API requests are supplied",
    "native-exact-sdk-match":
        "CLI 2.1.4 is installed; candidate SDK is still pinned to 2.1.1",
    "live-fallback-out-of-scope":
        "No safe in-flight model/provider replacement API is available or tested",
}


def run_quota_process_controls(repo: Path, root: Path, env: dict) -> dict:
    """Real SQLite WAL, separate Bun OS processes; NO synthetic billing proof.

    This is an isolated shared-state integration test, not evidence that a
    native OpenCode request used an included account or a new provider.
    """
    worker_path = repo / "tests/fixtures/quota-worker.ts"
    fixture_root = root / "quota-process-controls"
    fixture_root.mkdir(mode=0o700)
    def call(command: str, database: Path, *, account="fixture-account-a",
             model="sol", provider="route-primary") -> dict:
        cmd = ["bun", str(worker_path), command, str(database), account, model, provider]
        proc = subprocess.run(cmd, env=env, cwd=repo, capture_output=True,
                              text=True, timeout=20, check=False)
        require(proc.returncode == 0,
                "Independent quota worker failed: " + proc.stderr[-1000:])
        return json.loads(proc.stdout.strip())

    def after_cooldown(observation: dict) -> None:
        until = observation.get("retryAt")
        require(isinstance(until, (int, float)) and until > 0,
                "Worker did not report a bounded local probe time")
        time.sleep(max(0.0, until / 1000 - time.time()) + 0.15)

    blocked_db = fixture_root / "blocked.sqlite"
    require(call("exhaust-short", blocked_db).get("changed") is True,
            "Process A failed to record verified-style synthetic exhaustion")
    blocked = call("read", blocked_db)
    require(blocked.get("eligible") is False and blocked.get("reason") == "exhausted",
            "Process B did not observe process A's quota block")
    require(call("read", blocked_db, account="fixture-account-b").get("eligible") is True,
            "Another account on same provider inherited exhaustion")
    require(call("read", blocked_db, provider="route-secondary").get("eligible") is True,
            "Another provider inherited exhaustion")
    require(stat.S_IMODE(blocked_db.stat().st_mode) == 0o600,
            "Shared quota database is not 0600")
    require(stat.S_IMODE(fixture_root.stat().st_mode) == 0o700,
            "Fixture state root is not private")
    after_cooldown(blocked)
    first_probe = call("probe", blocked_db)
    second_probe = call("probe", blocked_db)
    require(first_probe.get("eligible") is True and first_probe.get("probe") is True,
            "First process was not allowed the expired-route probe")
    require(second_probe.get("eligible") is False and second_probe.get("probe") is False,
            "A second independent process claimed the already leased probe")

    recovery_db = fixture_root / "recovery.sqlite"
    require(call("exhaust-short", recovery_db).get("changed") is True,
            "Independent recovery fixture did not exhaust")
    after_cooldown(call("read", recovery_db))
    recovered = call("probe-recover", recovery_db)
    require(recovered.get("owned_probe") is True,
            "Recovery fixture did not own the probe reservation")
    state = call("read", recovery_db)
    require(state.get("eligible") is True and state.get("reason") is None,
            "A third process could not see recovery after the owned probe")
    return {
        "status": "PASS",
        "evidence_kind": "real-sqlite-independent-bun-processes",
        "assertions": [
            "process-b-sees-process-a-exhaustion",
            "same-provider-other-account-unblocked",
            "separate-provider-unblocked",
            "one-probe-owner-across-processes",
            "owned-probe-recovery-visible-to-another-process",
            "private-database-and-state-directory",
        ],
        "native_installed_route_proven": False,
        "billing_evidence": "test-only synthetic report, never a real-provider attestation",
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
    expect: str, reasoning: str = "medium", agent: str = "architect",
    use_global_default: bool = False, invalid_policy: bool = False,
    startup_fault: str | None = None,
) -> dict:
    project = root / "project"
    # These faults are injected BEFORE plugin activation, not after the
    # transport was already guarded. OpenCode must retain the early deny hook.
    state_home = Path(env["XDG_STATE_HOME"]) / "loom"
    if startup_fault == "quota-corrupt":
        quota_dir = state_home / "quota-v1"
        quota_dir.mkdir(mode=0o700, parents=True, exist_ok=True)
        (quota_dir / "subscriptions.sqlite").write_text("corrupt native quota store\n")
        (quota_dir / "subscriptions.sqlite").chmod(0o600)
    elif startup_fault == "action-ledger":
        state_home.mkdir(mode=0o700, parents=True, exist_ok=True)
        (state_home / "actions-v1").write_text("not a state directory\n")
    elif startup_fault is not None:
        raise ValueError("Unsupported routing startup fault")
    (root / "scenario.json").write_text(json.dumps({"kind": scenario}) + "\n")
    (project / ".loom.yaml").write_text(
        "model-routing:\n  enabled: true\n  default-class: [\n" if invalid_policy
        else json.dumps(routing_policy(enabled, reasoning)) + "\n")
    host_config = config(enabled)
    if use_global_default:
        host_config["model"] = "route-metered/sol"
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
        selection = {"providerID": model, "id": "sol"} if model != "route-primary" and not use_global_default else None
        payload = {"agent": agent, "title": name,
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
            # A random native failure must not be mistaken for the intended
            # billing/config guard merely because no local transport ran.
            expected_code = ("LOOM_MODEL_ROUTING_STARTUP_FAILED" if startup_fault
                             else "LOOM_MODEL_ROUTING_CONFIG_UNREADABLE" if invalid_policy
                             else "LOOM_MODEL_ROUTE_UNAVAILABLE")
            native_errors = (json.dumps(result) + "\n" +
                (output / f"{name}.server.stderr.txt").read_text(errors="replace"))
            require(expected_code in native_errors,
                    f"{name}: blocked for the wrong reason; missing {expected_code}")
            guard_code = expected_code
        elif expect == "tool":
            require(outcome == "succeeded", f"{name}: native tool continuation did not succeed: {outcome}")
            expect_single_native_tool(captured, model)
        elif expect == "compaction":
            require(outcome == "succeeded", f"{name}: prerequisite native tool failed: {outcome}")
            expect_single_native_tool(captured, model)
            request(host, "POST", f"/api/session/{session}/compact", {})
            deadline = time.monotonic() + 20
            while time.monotonic() < deadline:
                captured = read_events(root)[start:]
                if records(captured, "compaction-model-request"):
                    break
                time.sleep(.05)
            else:
                raise AssertionError("Native compaction did not reach the local model")
            idle(host, [session])
            captured = read_events(root)[start:]
            require(len(records(captured, "tool-before")) == 1 and
                    len(records(captured, "tool-after")) == 1,
                    "Compaction replayed or erased the executed native tool hooks")
            require(all((x["data"].get("providerID"), x["data"].get("modelID")) ==
                        (model, "sol") for x in records(captured, "provider-request")),
                    "Compaction selected an unexpected provider/model")
            require(all((x["data"].get("providerID"), x["data"].get("modelID")) ==
                        (model, "sol") for x in records(captured, "compaction-model-request")),
                    "Compaction model identity changed after the native tool")
            result = request(host, "GET", f"/api/session/{session}")
            outcome = result.get("outcome")
            require(outcome == "succeeded", "Native compaction did not finish successfully")
        elif expect in ("provider-error", "tool-error"):
            require(outcome in ("failed", "interrupted"), f"{name}: expected provider failure/interruption, got {outcome}")
            expect_failed_local_provider(captured, model, after_tool=(expect == "tool-error"))
        else:
            raise AssertionError("Unsupported test expectation")
        quota_db = Path(env["XDG_STATE_HOME"]) / "loom/quota-v1/subscriptions.sqlite"
        if enabled and startup_fault == "action-ledger":
            require(not quota_db.exists(),
                    "Action-ledger startup fault must precede opening the shared quota DB")
        elif enabled:
            require(quota_db.is_file(), "Routing-enabled installed Loom did not open shared quota state")
            require(stat.S_IMODE(quota_db.stat().st_mode) == 0o600,
                    "Installed plugin quota DB permissions must be 0600")
        elif name == "disabled-primary":
            require(not quota_db.exists(), "Routing-disabled native mode opened the shared quota DB")
        # The external fixture already omits raw prompts/headers/accounts.
        # Retain a further allowlisted, pseudonymized per-case trace so the
        # oracle can be replayed against CI evidence independently.
        safe_events = []
        allow = {"providerID", "modelID", "kind", "agent", "reasoning", "tool",
                 "status", "afterTool", "providerIDs"}
        for record in captured:
            details = {key: value for key, value in record.get("data", {}).items()
                       if key in allow}
            if "sessionID" in record.get("data", {}):
                details["sessionID"] = "fixture-session"
            safe_events.append({"type": record["type"], "data": details})
        trace = output / f"{name}.routing-events.ndjson"
        trace.write_text("".join(json.dumps(item, sort_keys=True) + "\n" for item in safe_events))
        return {
            "name": name, "status": "PASS", "evidence_kind": "installed-local-provider",
            "trace_file": trace.name,
            **({"guard_code": guard_code} if expect == "blocked" else {}),
            "quota_database_opened": quota_db.is_file() if enabled else None,
            "routing_enabled": enabled, "agent": agent, "session_outcome": outcome,
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
        "version_qualification": "OpenCode CLI 2.1.4 with Loom SDK 2.1.1 (NOT exact matched-version qualification)",
        "requirements": [{"id": number, "status": status, "evidence": evidence}
                         for number, status, evidence in REQUIREMENTS],
        "cases": [], "negative_controls": None,
        "shared_quota_process_controls": {"status": "UNPROVEN"},
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
                ("disabled-coder", False, "text", "route-primary", "one", "medium", "coder"),
                ("disabled-reviewer", False, "text", "route-primary", "one", "medium", "reviewer"),
                ("disabled-metered", False, "text", "route-metered", "one", "medium"),
                # The native host actually executes a tool and then sends a
                # second model request; we inspect the real execute hook.
                ("disabled-tool-continuation", False, "tool", "route-primary", "tool", "medium"),
                ("disabled-compaction-after-tool", False, "tool", "route-primary", "compaction", "medium"),
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
                ("enabled-unknown-coder", True, "text", "route-primary", "blocked", "medium", "coder"),
                ("enabled-unknown-reviewer", True, "text", "route-primary", "blocked", "medium", "reviewer"),
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
            for case in checks:
                name, enabled, scenario, model, expectation, reasoning, *agent_name = case
                report["cases"].append(run_case(
                    name, cli, repo, plugin, output, root, env,
                    enabled=enabled, scenario=scenario, model=model,
                    expect=expectation, reasoning=reasoning,
                    agent=agent_name[0] if agent_name else "architect"))
            # This model is a genuine local native global default, NOT an
            # explicitly pinned per-Session route. It must never be dispatched
            # when managed Loom routing is enabled.
            report["cases"].append(run_case(
                "enabled-unexpected-global-default", cli, repo, plugin, output, root, env,
                enabled=True, model="route-metered", expect="blocked",
                use_global_default=True))
            report["cases"].append(run_case(
                "enabled-invalid-policy-fail-closed", cli, repo, plugin, output, root, env,
                enabled=True, model="route-primary", expect="blocked",
                invalid_policy=True))
            report["shared_quota_process_controls"] = run_quota_process_controls(
                repo, root, env)
        # Separate disposable hosts: an intentionally broken quota DB or
        # ledger must not contaminate normal native acceptance cases.
        for fault in ("quota-corrupt", "action-ledger"):
            with tempfile.TemporaryDirectory(prefix="loom-routing-startup-fault-") as fault_temp:
                fault_root = Path(fault_temp).resolve()
                (fault_root / "project").mkdir()
                fault_env = isolated_environment(fault_root)
                fault_env["LOOM_ROUTING_FIXTURE"] = str(fault_root)
                subprocess.run(["git", "init", "-q", str(fault_root / "project")],
                               env=fault_env, check=True, timeout=10)
                report["cases"].append(run_case(
                    "enabled-startup-" + fault, cli, repo, plugin, output,
                    fault_root, fault_env, enabled=True, model="route-metered",
                    expect="blocked", use_global_default=True,
                    startup_fault=fault))
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
