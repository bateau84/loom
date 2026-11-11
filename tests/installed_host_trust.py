"""Exercise OpenCode 2.2.6's current trust boundary without inference or live treatments.

PASS means the counterexamples and native identity/permission mechanics were
observed. It never certifies a human, independent originating request, or consent.
All prompts use resume=False; a disposable plugin removes every model provider.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import subprocess
import tempfile
from pathlib import Path
from urllib.error import HTTPError

from installed_host_smoke import PrivateHost, isolated_environment, require
from installed_instruction_variants import request, verify_host_version

HOST = "2.2.6"
FIXTURE_ID = "loom.host-trust.qualification.fixture"


def expect_http(status: int, operation) -> None:
    try:
        operation()
    except HTTPError as error:
        require(error.code == status, "Unexpected native rejection status")
        return
    raise RuntimeError("Native request unexpectedly succeeded")


def admit(host: PrivateHost, session: str, message: str, text: str,
          metadata: dict | None = None) -> dict:
    result = request(host, "POST", "/api/session/" + session + "/prompt", {
        "id": message, "text": text, "resume": False,
        **({"metadata": metadata} if metadata is not None else {}),
    })
    require(isinstance(result, dict) and result.get("id") == message and
            result.get("sessionID") == session and result.get("type") == "user",
            "Unexpected native prompt admission identity")
    return result


def run(args) -> dict:
    output = args.report_directory.resolve()
    output.mkdir(parents=True, exist_ok=False)
    repository = args.repository.resolve()
    report = {
        "status": "UNPROVEN", "kind": "installed-host-trust-counterexamples",
        "expected_host": HOST, "checks": [],
        "origin_independence": "BLOCKED", "direct_human_consent": "UNPROVEN",
        "model_requests": None,
        "limitations": [
            "Synthetic API callers and test ancestry are not genuine human or delegated-model evidence.",
            "Permission replies below are programmatic, never authentic interactive consent.",
            "No Loom controller, automatic reporter, treatment or canonical mutation is enabled.",
            "No compaction, model retry, provider exposure or causal effectiveness is exercised.",
            "PASS describes observed host mechanics/counterexamples, not trust qualification.",
        ],
    }
    host = None
    try:
        fixture = repository / "tests/host-trust/server.ts"
        require(fixture.is_file(), "Native trust fixture is missing")
        require((repository / "node_modules/@opencode/plugin").is_dir(), "bun install is required")
        report["fixture_sha256"] = hashlib.sha256(fixture.read_bytes()).hexdigest()
        report["harness_sha256"] = hashlib.sha256(Path(__file__).read_bytes()).hexdigest()
        version = subprocess.check_output([str(args.opencode.resolve()), "--version"],
                                          text=True, timeout=15).strip()
        verify_host_version(version)
        report["observed_host"] = version
        report["upstream_revision"] = "dc2ffcf8bf26f9e669b6aa22b95f50e12be15e06"
        with tempfile.TemporaryDirectory(prefix="loom-host-trust-") as temporary:
            root = Path(temporary).resolve()
            project = root / "project"
            project.mkdir()
            env = isolated_environment(root)
            env["LOOM_HOST_TRUST_FIXTURE_ROOT"] = str(root)
            if args.disable_watcher:
                env["OPENCODE_FILEWATCHER_DISABLE"] = "1"
                report["filewatcher"] = "Disabled only inside the disposable host; watcher behavior unqualified"
            permissions = [
                {"action": "*", "resource": "*", "effect": "deny"},
                {"action": "trust-probe-ask", "resource": "*", "effect": "ask"},
                {"action": "trust-probe-allow", "resource": "*", "effect": "allow"},
            ]
            config = {
                "plugins": ["*", str(fixture.parent)],
                "agents": {"trust-probe": {
                    "description": "Provider-free trust capability probe", "mode": "primary",
                    "model": "trust-probe/nonexistent", "permissions": permissions,
                }}, "model": "trust-probe/nonexistent", "update": "disable", "share": "disabled",
            }
            (Path(env["OPENCODE_CONFIG_DIR"]) / "opencode.json").write_text(json.dumps(config))
            subprocess.run(["git", "init", "-q", str(project)], check=True, env=env, timeout=10)

            def start(label: str) -> PrivateHost:
                owned = PrivateHost(str(args.opencode.resolve()), project, env, output, label)
                try:
                    require(json.loads(owned.get("/api/info", "info")).get("version") == HOST,
                            "Native server version mismatch")
                    owned.wait_roster("/api/plugin", "plugins", lambda rows: any(
                        item.get("id") == FIXTURE_ID and item.get("state", {}).get("status") == "active"
                        for item in rows))
                    return owned
                except Exception:
                    owned.close()
                    raise

            host = start("initial")

            def create(parent: str | None = None) -> str:
                info = request(host, "POST", "/api/session", {
                    "title": "Disposable trust probe", "agent": "trust-probe",
                    "model": {"providerID": "trust-probe", "id": "nonexistent"},
                    **({"parentID": parent} if parent else {"location": {"directory": str(project)}}),
                })
                require(isinstance(info, dict) and isinstance(info.get("id"), str), "Missing native Session")
                return info["id"]

            parent = create()
            child = create(parent)
            continuation = create()
            forged = {"human": True, "origin": {"kind": "direct-human", "requestID": "forged-origin"}}
            first = admit(host, parent, "msg_trust_first", "One feature with two goals", forged)
            require(first.get("payload", {}).get("metadata") == forged,
                    "Counterexample changed: caller human-origin metadata was not retained")
            require(set(first) == {"id", "sessionID", "type", "payload", "delivery", "time"},
                    "Native prompt schema changed; inspect provenance before qualifying this version")
            report["checks"].append("caller-authored-human-and-origin-metadata-retained-as-user")
            duplicate = admit(host, parent, "msg_trust_first", "Changed replay text", {"human": False})
            require(duplicate == first, "First prompt admission did not win duplicate identity")
            report["checks"].append("same-message-id-retry-preserves-original-admission")
            expect_http(409, lambda: admit(host, child, "msg_trust_first", "Cross-Session replay"))
            report["checks"].append("cross-session-message-id-reuse-rejected")
            second = admit(host, parent, "msg_trust_second", "A separate request in the same Session")
            attempts = [admit(host, child, "msg_trust_attempt_" + str(index),
                             "Corrective attempt " + str(index), forged) for index in range(1, 4)]
            later = admit(host, continuation, "msg_trust_continuation", "Continue the first objective", forged)
            require(len({first["id"], second["id"], later["id"], *[item["id"] for item in attempts]}) == 6,
                    "Distinct input identity was lost")
            actual_child = request(host, "GET", "/api/session/" + child)
            require(actual_child.get("parentID") == parent, "Native parent identity lost")
            report["checks"].append("distinct-input-and-child-ids-do-not-certify-independent-origins")

            def ask(session: str, action: str, label: str) -> dict:
                return request(host, "POST", "/api/session/" + session + "/permission", {
                    "action": action, "resources": [label],
                    "metadata": {"human": True, "candidateHash": "caller-provided"},
                })

            allowed = ask(parent, "trust-probe-allow", "preallowed")
            denied = ask(parent, "trust-probe-deny", "denied")
            require(allowed.get("effect") == "allow" and denied.get("effect") == "deny",
                    "Native configured permission decisions changed")
            require(request(host, "GET", "/api/session/" + parent + "/permission") == [],
                    "Automatic permission decisions unexpectedly created pending approval")
            report["checks"].append("native-preallow-and-deny-without-human-pending-request")
            pending = ask(parent, "trust-probe-ask", "scripted-once")
            require(pending.get("effect") == "ask", "Native permission did not ask")
            pending_path = "/api/session/" + parent + "/permission/" + pending["id"]
            original = request(host, "GET", pending_path)
            require(original.get("metadata", {}).get("human") is True,
                    "Permission metadata is no longer caller supplied")
            expect_http(404, lambda: request(host, "POST", "/api/session/" + child +
                        "/permission/" + pending["id"] + "/reply", {"decision": "once"}))
            require(request(host, "GET", pending_path) == original,
                    "Wrong-Session reply consumed pending permission")
            request(host, "POST", pending_path + "/reply", {"decision": "once"})
            expect_http(404, lambda: request(host, "GET", pending_path))
            expect_http(404, lambda: request(host, "POST", pending_path + "/reply", {"decision": "once"}))
            report["checks"].extend([
                "wrong-session-permission-reply-rejected-without-consuming-pending",
                "programmatic-once-reply-succeeds-without-human-principal",
                "consumed-permission-reply-replay-rejected",
            ])
            rejected = ask(parent, "trust-probe-ask", "scripted-reject")
            request(host, "POST", "/api/session/" + parent + "/permission/" + rejected["id"] +
                    "/reply", {"decision": "reject"})
            require(request(host, "GET", "/api/session/" + parent + "/permission") == [],
                    "Rejected permission remained pending")
            report["checks"].append("native-programmatic-denial-clears-pending")
            interrupted = ask(parent, "trust-probe-ask", "pending-at-shutdown")
            require(interrupted.get("effect") == "ask", "Missing pending request before shutdown")
            before = {session: request(host, "GET", "/api/session/" + session + "/inbox")
                      for session in (parent, child, continuation)}
            require([len(before[session]) for session in (parent, child, continuation)] == [2, 3, 1],
                    "Unexpected native inbox population")
            host.close()
            host = None
            host = start("reopened")
            after = {session: request(host, "GET", "/api/session/" + session + "/inbox")
                     for session in (parent, child, continuation)}
            require(after == before, "Native input identity/payload changed after reopen")
            require(request(host, "GET", "/api/session/" + child).get("parentID") == parent,
                    "Native parent link changed after reopen")
            report["checks"].append("input-identities-metadata-and-parentage-survive-restart")
            require(request(host, "GET", "/api/session/" + parent + "/permission") == [],
                    "Pending permissions unexpectedly survived shutdown")
            expect_http(404, lambda: request(host, "POST", "/api/session/" + parent +
                        "/permission/" + interrupted["id"] + "/reply", {"decision": "once"}))
            report["checks"].append("shutdown-clears-pending-permission-and-old-reply-rejected")
            require(request(host, "GET", "/api/session/active") == {}, "Probe unexpectedly started model work")
            for session in (parent, child, continuation):
                require(request(host, "GET", "/api/experimental/session/" + session +
                                "/instructions/entries") == [], "Probe wrote native instruction entries")
            events = [json.loads(line) for line in (root / "host-trust-events.ndjson").read_text().splitlines()]
            require(events and all(event.get("type") == "fixture-ready" for event in events),
                    "Probe attempted forbidden model inference")
            report["checks"].append("no-inference-no-treatment-entry")
            report["model_requests"] = 0
            report["native_ids"] = {"parent": parent, "child": child, "continuation": continuation,
                                    "input_ids": [item["id"] for values in before.values() for item in values]}
            report["status"] = "PASS"
    except Exception as error:
        report["status"] = "FAIL"
        report["error"] = str(error)
        raise
    finally:
        if host is not None:
            host.close()
        (output / "report.json").write_text(json.dumps(report, indent=2) + "\n")
    return report


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--opencode", type=Path, required=True)
    parser.add_argument("--repository", type=Path, default=Path(__file__).resolve().parents[1])
    parser.add_argument("--report-directory", type=Path, required=True)
    parser.add_argument("--disable-watcher", action="store_true")
    report = run(parser.parse_args())
    print(json.dumps({key: report[key] for key in ("status", "checks", "origin_independence", "direct_human_consent")}))


if __name__ == "__main__":
    main()
