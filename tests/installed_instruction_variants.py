"""Installed 2.2.6 Session instruction-entry qualification, NOT production activation.

Requires an exact packed Loom, an unmodified external CLI, and an isolated local
scripted provider. No user configuration, global skill definitions, accounts or
live providers are read. Native provider requests are observed at the SDK input.
"""
from __future__ import annotations

import argparse
import base64
import hashlib
import json
import os
import subprocess
import tempfile
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from urllib.parse import urlencode
from urllib.request import Request

from installed_host_smoke import (
    PrivateHost, installed_plugin_inventory, isolated_environment, require,
)

HOST = "2.2.6"
KEY = "loom.variant.test"
MARKER = "LOOM_VARIANT_TEST_ONLY_V1"
CANDIDATE = MARKER + "\nThis is a transport marker, not behavior guidance."
MODEL = {"providerID": "variant-fixture", "id": "scripted"}


def sha(value: str | bytes) -> str:
    return hashlib.sha256(value.encode("utf8") if isinstance(value, str) else value).hexdigest()


def verify_host_version(actual: str, expected: str = HOST) -> None:
    require(actual in (expected, "opencode v" + expected),
            "HOST_MISMATCH: expected exact OpenCode " + expected + "; observed " + actual)


def verify_receipt(event: dict | None, *, expected_candidate: bool, candidate_sha: str) -> dict:
    """Only the actual SDK input receipt, never assignment or a context-hook hash, can pass."""
    require(isinstance(event, dict), "RECEIPT_MISSING: no native provider input was observed")
    require(isinstance(event.get("effective_sha256"), str) and
            len(event["effective_sha256"]) == 64, "RECEIPT_INCOMPLETE: no effective fingerprint")
    require(isinstance(event.get("system_bytes"), int) and event["system_bytes"] > 0,
            "RECEIPT_INCOMPLETE: system prompt absent")
    require(event.get("user_marker_seen") is False,
            "RECEIPT_AMBIGUOUS: marker arrived only through user text")
    if expected_candidate:
        require(event.get("entry_seen") is True and event.get("marker_seen") is True and
                event.get("candidate_sha256") == candidate_sha,
                "EXPOSURE_UNVERIFIED: assigned candidate absent or mismatched at native provider input")
    else:
        require(event.get("entry_seen") is False and event.get("marker_seen") is False and
                event.get("candidate_sha256") is None,
                "CONTROL_CONTAMINATED: candidate appeared in an unassigned Session")
    return event


def verify_attempt_receipts(arrivals: list[dict], receipts: list[dict], *,
                            expected_candidate: bool | None,
                            candidate_sha: str) -> list[dict]:
    """Every local SDK arrival needs its own complete receipt.

    A request can have several provider attempts. They are one scenario, never
    multiple independent trial outcomes. Attempt IDs are fixture-local only:
    this does not invent a native transport-attempt identity.
    """
    require(bool(arrivals), "RECEIPT_MISSING: no provider attempt reached the observer")
    arriving = [e.get("attemptID") for e in arrivals]
    observed = [e.get("attemptID") for e in receipts]
    require(all(isinstance(value, str) and value for value in arriving + observed) and
            len(set(arriving)) == len(arriving) and
            len(set(observed)) == len(observed) and
            set(arriving) == set(observed),
            "RECEIPT_GAP: unreceipted, repeated or foreign provider attempt")
    by_id = {event["attemptID"]: event for event in receipts}
    checked = []
    for attempt in arriving:
        receipt = by_id[attempt]
        if expected_candidate is not None:
            checked.append(verify_receipt(receipt,
                                          expected_candidate=expected_candidate,
                                          candidate_sha=candidate_sha))
        else:
            # Withdrawal permits historical exposure; do not call it baseline.
            require(isinstance(receipt.get("effective_sha256"), str) and
                    len(receipt["effective_sha256"]) == 64 and
                    isinstance(receipt.get("system_bytes"), int) and
                    receipt["system_bytes"] > 0,
                    "RECEIPT_INCOMPLETE: withdrawn request was not observed")
            checked.append(receipt)
    require(len({row["effective_sha256"] for row in checked}) == 1,
            "EFFECTIVE_DRIFT: attempts in one scenario saw different system instructions")
    return checked


def source_guard(expected: dict[str, str], actual: dict[str, str]) -> None:
    require(expected == actual, "SOURCE_DRIFT: source, agent or skill registry changed during qualification")


def request(host: PrivateHost, method: str, path: str, data: dict | None = None):
    require(path.startswith("/api/session") or
            path.startswith("/api/experimental/session/") or
            path.startswith("/api/agent?") or path.startswith("/api/skill?"),
            "Unexpected API outside disposable Session/registry verification")
    token = base64.b64encode(("opencode:" + host.password).encode()).decode()
    raw = None if data is None else json.dumps(data).encode()
    req = Request(host.url + path, data=raw, method=method, headers={
        "Authorization": "Basic " + token, "Content-Type": "application/json",
    })
    with host.opener.open(req, timeout=30) as response:
        payload = response.read(2 * 1024 * 1024 + 1)
    require(len(payload) <= 2 * 1024 * 1024, "Native response exceeded 2 MiB")
    parsed = json.loads(payload) if payload else None
    return parsed.get("data", parsed) if isinstance(parsed, dict) else parsed


def events(root: Path) -> list[dict]:
    path = root / "variant-events.ndjson"
    if not path.exists():
        return []
    return [json.loads(line) for line in path.read_text().splitlines() if line]


def await_events(root: Path, predicate, count: int, timeout: float = 25) -> list[dict]:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        try:
            found = [event for event in events(root) if predicate(event)]
        except json.JSONDecodeError:
            found = []
        if len(found) >= count:
            return found
        time.sleep(0.05)
    raise RuntimeError("RECEIPT_MISSING: bounded native/provider observation did not arrive")


def idle(host: PrivateHost, sessions: list[str], timeout: float = 30) -> None:
    # GET /active can be briefly empty during a wake/settlement transition.
    # This is called only AFTER the expected provider/request event exists.
    # The tagged native coordinator's /wait awaits its completed execution.
    for session in sessions:
        require(request(host, "POST",
                        "/api/experimental/session/" + session + "/wait") is None,
                "Native Session wait returned an unexpected payload")
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        active = request(host, "GET", "/api/session/active")
        require(isinstance(active, dict), "Native active Sessions API unavailable")
        if all(session not in active for session in sessions):
            return
        time.sleep(0.05)
    raise RuntimeError("Native Sessions did not become idle after a bounded wait")


def entry_path(session: str) -> str:
    return "/api/experimental/session/" + session + "/instructions/entries/" + KEY


def entry_list(host: PrivateHost, session: str) -> list[dict]:
    result = request(host, "GET", "/api/experimental/session/" + session + "/instructions/entries")
    require(isinstance(result, list), "Native instruction entry readback is not a list")
    return result


def assign(host: PrivateHost, session: str, *, candidate: str) -> None:
    # Only called for explicitly named Session IDs after native identity validation.
    result = request(host, "PUT", entry_path(session), {"value": candidate})
    require(result is None, "Unexpected native assignment response")
    require(entry_list(host, session) == [{"key": KEY, "value": candidate}],
            "ASSIGNMENT_UNVERIFIED: native readback differed")


def create_session(host: PrivateHost, project: Path, *, agent="variant-agent",
                   parent: str | None = None) -> str:
    info = request(host, "POST", "/api/session", {
        "title": "Disposable instruction-variant qualification",
        "agent": agent, "model": MODEL,
        **({"parentID": parent} if parent else {
            "location": {"directory": str(project)}}),
    })
    require(isinstance(info, dict) and isinstance(info.get("id"), str),
            "Native Session creation did not return an ID")
    session = info["id"]
    actual = request(host, "GET", "/api/session/" + session)
    require(actual.get("id") == session and actual.get("agent") == agent and
            actual.get("parentID") == parent and
            actual.get("location", {}).get("directory") == str(project),
            "ELIGIBILITY_UNKNOWN: native Session, ancestry or location changed")
    return session


def registry(host: PrivateHost, project: Path) -> dict[str, str]:
    query = "?" + urlencode({"location[directory]": str(project)})
    return {
        "agents": sha(json.dumps(request(host, "GET", "/api/agent" + query), sort_keys=True)),
        "skills": sha(json.dumps(request(host, "GET", "/api/skill" + query), sort_keys=True)),
    }


class Probe:
    def __init__(self, host: PrivateHost, root: Path, project: Path, report: dict):
        self.host, self.root, self.project, self.report = host, root, project, report
        self.assignments: dict[str, dict] = {}
        self.cases: list[dict] = []

    def assign(self, session: str, parent: str | None = None) -> None:
        require(session not in self.assignments, "Duplicate explicit assignment")
        actual = request(self.host, "GET", "/api/session/" + session)
        require(actual.get("id") == session and actual.get("parentID") == parent and
                actual.get("location", {}).get("directory") == str(self.project),
                "Unverified Session/child eligibility")
        assign(self.host, session, candidate=CANDIDATE)
        self.assignments[session] = {
            "sessionID": session, "native_parentID": parent,
            "candidate_sha256": sha(CANDIDATE), "assignment": "explicit-test-only",
        }

    def set_barrier(self, release: bool) -> None:
        (self.root / "variant-barrier.json").write_text(json.dumps({"release": release}))

    def prompt(self, session: str, name: str) -> None:
        request(self.host, "POST", "/api/session/" + session + "/prompt",
                {"text": "VARIANT_CASE:" + name + "\nInspect the request and reply with the fixture token."})

    def check(self, session: str, name: str, expected_candidate: bool) -> dict:
        observed = [e["data"] for e in events(self.root)
                    if e["type"] == "provider-request" and e["data"].get("testCase") == name]
        arriving = [e["data"] for e in events(self.root)
                    if e["type"] == "provider-arrival" and e["data"].get("testCase") == name]
        self.report["last_receipt_counts"] = {
            name: {"arrivals": len(arriving), "receipts": len(observed)}}
        attempts = verify_attempt_receipts(arriving, observed,
                                           expected_candidate=expected_candidate,
                                           candidate_sha=sha(CANDIDATE))
        verified = attempts[0]
        native = [e["data"] for e in events(self.root) if e["type"] == "native-request"
                  and e["data"].get("sessionID") == session and e["data"].get("kind") == "primary"]
        require(native, "NATIVE_LINK_MISSING: no primary native request for " + name)
        require(all(e["providerID"] == MODEL["providerID"] and e["model"] == MODEL["id"] for e in native),
                "Unexpected provider/model entered native Session")
        require(name not in [row["name"] for row in self.cases], "Duplicate scenario identifier")
        self.cases.append({
            "name": name, "sessionID": session,
            "assigned": session in self.assignments,
            "expected_candidate": expected_candidate,
            "actual_candidate_sha256": verified["candidate_sha256"],
            "effective_sha256": verified["effective_sha256"],
            "provider_attempt_count": len(attempts),
            "observation": "local AI SDK doStream input, after native context hook",
            "native_request_kind": "primary",
        })
        self.report["cases"] = list(self.cases)
        return verified

    def pair(self, cases: list[tuple[str, str, bool]]) -> None:
        # Real overlapping requests at the model boundary in one location.
        self.set_barrier(False)
        try:
            with ThreadPoolExecutor(max_workers=len(cases)) as pool:
                futures = [pool.submit(self.prompt, session, name) for session, name, _ in cases]
                for task in futures:
                    task.result(timeout=20)
            names = {name for _, name, _ in cases}
            deadline = time.monotonic() + 25
            while time.monotonic() < deadline:
                received = [e["data"].get("testCase") for e in events(self.root)
                            if e["type"] == "provider-arrival" and
                            e["data"].get("testCase") in names]
                counts = {name: received.count(name) for name in names}
                self.report["concurrent_arrival_counts"] = counts
                if all(number >= 1 for number in counts.values()):
                    break
                time.sleep(0.05)
            else:
                raise RuntimeError("RECEIPT_MISSING: every distinct concurrent Session must reach provider")
        finally:
            self.set_barrier(True)
        idle(self.host, [session for session, _, _ in cases])
        for session, name, treatment in cases:
            self.check(session, name, treatment)

    def one(self, session: str, name: str, treatment: bool) -> None:
        self.set_barrier(True)
        self.prompt(session, name)
        await_events(self.root, lambda e: e["type"] == "provider-request" and
                     e["data"].get("testCase") == name, 1)
        idle(self.host, [session])
        self.check(session, name, treatment)


def run(args) -> dict:
    output = args.report_directory.resolve()
    output.mkdir(parents=True, exist_ok=False)
    report: dict = {
        "status": "UNPROVEN", "kind": "installed-session-variant-mechanics",
        "expected_host": HOST, "expected_sdk": HOST, "checks": [],
        "limitations": [
            "This is a test-only explicit instruction entry, not automatic Loom assignment.",
            "No claim of behavior improvement, live-provider exposure or model understanding.",
            "Native skill loads, attachments, file reads, companions, agent replacements and automatic child eligibility are not qualified.",
            "Deletion cannot remove instructions already exposed in prior requests or history.",
            "Native transport retries and real delegated children are outside the supported subset.",
        ],
    }
    host = None
    try:
        require((args.repository / "tests/variant-host/server.ts").is_file(), "Fixture missing")
        require((args.repository / "node_modules/@opencode/plugin").is_dir(), "bun install is required")
        report["candidate_artifact"] = installed_plugin_inventory(
            args.artifact.resolve(), args.plugin.resolve(), args.expect_plugin_version, HOST)
        version = subprocess.check_output([str(args.opencode.resolve()), "--version"],
                                          text=True, timeout=15).strip()
        verify_host_version(version)
        report["observed_host"] = version
        report["upstream_tag"] = "anomalyco/opencode@dc2ffcf8bf26f9e669b6aa22b95f50e12be15e06"
        report["loom_base"] = "edab7a96e7c5a9172ceb98b8518c47c48a1d7c09"
        report["candidate_sha256"] = sha(CANDIDATE)
        with tempfile.TemporaryDirectory(prefix="loom-variants-") as temporary:
            root = Path(temporary).resolve()
            project = root / "project"
            project.mkdir()
            env = isolated_environment(root)
            env["LOOM_VARIANT_FIXTURE_ROOT"] = str(root)
            if args.disable_watcher:
                env["OPENCODE_FILEWATCHER_DISABLE"] = "1"
                report["limitations"].append("Filewatcher disabled only for isolated host.")
            (root / "variant-barrier.json").write_text('{"release":true}')
            no_tools = [{"action": "*", "resource": "*", "effect": "deny"}]
            config = {
                "plugins": ["*", str(args.plugin.resolve()),
                            str((args.repository / "tests/variant-host").resolve())],
                "agents": {
                    "variant-agent": {"description": "Local controller", "mode": "primary",
                                      "model": "variant-fixture/scripted",
                                      "system": "Use only the local scripted fixture.",
                                      "permissions": no_tools},
                    "variant-child": {"description": "Local child", "mode": "subagent",
                                      "model": "variant-fixture/scripted",
                                      "system": "Use only the local scripted fixture.",
                                      "permissions": no_tools},
                }, "model": "variant-fixture/scripted",
                "update": "disable", "share": "disabled",
            }
            config_file = Path(env["OPENCODE_CONFIG_DIR"]) / "opencode.json"
            config_file.write_text(json.dumps(config))
            (project / ".loom.yaml").write_text("agents: {}\ninstructions: {enabled: false}\nledger: {capture: off}\n")
            skill_file = project / ".agents/skills/qualification-probe/SKILL.md"
            skill_file.parent.mkdir(parents=True)
            skill_file.write_text("---\nname: qualification-probe\ndescription: Static harmless test guide\n---\n# Baseline\nNo variant content.\n")
            subprocess.run(["git", "init", "-q", str(project)], env=env, check=True, timeout=10)
            source = {
                "skill_file_sha256": sha(skill_file.read_bytes()),
                "config_sha256": sha(config_file.read_bytes()),
                "loom_config_sha256": sha((project / ".loom.yaml").read_bytes()),
            }
            report["base_sha256"] = source["skill_file_sha256"]
            def start(label: str):
                owned = PrivateHost(str(args.opencode.resolve()), project, env, output, label)
                try:
                    require(json.loads(owned.get("/api/info", "info")).get("version") == HOST,
                            "Host server advertises an unexpected version")
                    owned.wait_roster("/api/plugin", "plugins", lambda rows: all(
                        any(item.get("id") == value and item.get("state", {}).get("status") == "active"
                            for item in rows) for value in ("loom", "loom.variant.qualification.fixture")))
                    return owned
                except Exception:
                    owned.close()
                    raise
            host = start("initial")
            catalog = registry(host, project)
            snapshot = {**source, **catalog}
            control = create_session(host, project)
            treatment = create_session(host, project)
            probe = Probe(host, root, project, report)
            probe.assign(treatment)
            require(entry_list(host, control) == [], "Unassigned control had native entries")
            report["assignments"] = probe.assignments
            probe.pair([(control, "control-initial", False),
                        (treatment, "treatment-initial", True)])
            report["checks"].append("concurrent-control-treatment-provider-input")
            source_guard(snapshot, {
                "skill_file_sha256": sha(skill_file.read_bytes()),
                "config_sha256": sha(config_file.read_bytes()),
                "loom_config_sha256": sha((project / ".loom.yaml").read_bytes()),
                **registry(host, project),
            })
            probe.pair([(treatment, "treatment-continuation", True),
                        (control, "control-continuation", False)])
            report["checks"].append("same-session-continuation")
            child = create_session(host, project, agent="variant-child", parent=treatment)
            sibling = create_session(host, project, agent="variant-child", parent=treatment)
            probe.assign(child, parent=treatment)
            require(entry_list(host, sibling) == [], "Unassigned sibling inherited variant")
            probe.pair([(child, "child-explicit", True),
                        (sibling, "child-unassigned", False)])
            report["checks"].append("explicit-child-not-ancestry")
            # Interruption is accepted by the real Session coordinator while a
            # native provider request is held; it never undoes exposure.
            probe.set_barrier(False)
            try:
                probe.prompt(treatment, "treatment-interrupted")
                await_events(root, lambda e: e["type"] == "provider-request" and
                             e["data"].get("testCase") == "treatment-interrupted", 1)
                interruption = request(host, "POST",
                                       "/api/session/" + treatment + "/interrupt")
                require(isinstance(interruption, dict) and interruption.get("interrupted") is True,
                        "Native interruption was not accepted at a held model boundary")
            finally:
                probe.set_barrier(True)
            idle(host, [treatment])
            probe.check(treatment, "treatment-interrupted", True)
            probe.one(treatment, "treatment-after-interrupt", True)
            require(entry_list(host, treatment) == [{"key": KEY, "value": CANDIDATE}],
                    "Treatment assignment was lost after interruption")
            report["checks"].append("native-interruption-without-exposure-revocation")
            # A separate assigned native Session reaches the provider, but the
            # fixture deliberately emits only a partial receipt. It must not
            # become an accepted trial regardless of successful model output.
            fault = create_session(host, project)
            probe.assign(fault)
            probe.set_barrier(True)
            probe.prompt(fault, "fault-partial-exposure")
            partial = await_events(
                root, lambda e: e["type"] == "partial-provider-exposure" and
                e["data"].get("testCase") == "fault-partial-exposure", 1)[-1]["data"]
            idle(host, [fault])
            require(partial["entry_seen"] is True and partial["marker_seen"] is True,
                    "Fault fixture did not expose the candidate before receipt loss")
            try:
                probe.check(fault, "fault-partial-exposure", True)
            except RuntimeError as error:
                require("RECEIPT_GAP" in str(error),
                        "Partial exposure was rejected for an unexpected reason: " + str(error))
            else:
                raise RuntimeError("FAIL_OPEN: unreceipted native exposure was credited")
            report["negative_controls"] = {
                "partial_exposure_at_provider": True, "complete_delivery_receipt": False,
                "counted_as_trial": False, "rejection": "RECEIPT_GAP",
            }
            report["checks"].append("native-partial-exposure-is-not-credited")
            # Real native manual compaction, not an invented context-hook event.
            before_compact = len([e for e in events(root) if e["type"] == "native-request"
                                  and e["data"].get("sessionID") == treatment and
                                  e["data"].get("kind") == "compaction"])
            # Compaction can include an earlier user message in the prompt.
            # A user-text case label is NOT a native compaction request ID.
            # No other Sessions are active here; use a bounded event interval
            # and the separate native model.request kind=compaction witness.
            before_provider = len([e for e in events(root) if e["type"] == "provider-request"])
            before_arrival = len([e for e in events(root) if e["type"] == "provider-arrival"])
            request(host, "POST", "/api/session/" + treatment + "/compact", {})
            await_events(root, lambda e: e["type"] == "native-request" and
                         e["data"].get("sessionID") == treatment and
                         e["data"].get("kind") == "compaction",
                         before_compact + 1)
            idle(host, [treatment])
            compact = [e["data"] for e in events(root) if e["type"] == "native-request"
                       and e["data"].get("sessionID") == treatment and
                       e["data"].get("kind") == "compaction"]
            require(len(compact) == before_compact + 1, "Expected one native compaction request")
            provider_compact = [e["data"] for e in events(root)
                                if e["type"] == "provider-request"][before_provider:]
            arrived_compact = [e["data"] for e in events(root)
                               if e["type"] == "provider-arrival"][before_arrival:]
            checked_compact = verify_attempt_receipts(
                arrived_compact, provider_compact, expected_candidate=True,
                candidate_sha=sha(CANDIDATE))
            observed_compact = checked_compact[0]
            report["compaction"] = {
                "native_kind": "compaction",
                "provider_stage": "local AI SDK doStream input",
                "candidate_sha256": observed_compact["candidate_sha256"],
                "effective_sha256": observed_compact["effective_sha256"],
                "provider_attempt_count": len(checked_compact),
            }
            probe.one(treatment, "treatment-postcompact", True)
            report["checks"].append("native-compaction-provider-input-and-continuation")
            # A private host restart tests persistence, not erased history.
            host.close()
            host = start("restarted")
            probe.host = host
            require(entry_list(host, treatment) == [{"key": KEY, "value": CANDIDATE}],
                    "Treatment assignment lost on restart")
            require(entry_list(host, control) == [], "Control acquired entry on restart")
            probe.pair([(control, "control-restart", False),
                        (treatment, "treatment-restart", True)])
            report["checks"].append("host-restart-native-readback-and-provider-input")
            # Withdrawal is a future-instruction tombstone, not a clean-history promise.
            request(host, "DELETE", entry_path(treatment))
            require(entry_list(host, treatment) == [], "Native tombstone/readback failed")
            probe.set_barrier(True)
            probe.prompt(treatment, "treatment-withdrawn")
            await_events(root, lambda e: e["type"] == "provider-request" and
                         e["data"].get("testCase") == "treatment-withdrawn", 1)
            idle(host, [treatment])
            withdrawn = [e["data"] for e in events(root) if e["type"] == "provider-request"
                         and e["data"].get("testCase") == "treatment-withdrawn"]
            arrived_withdrawn = [e["data"] for e in events(root)
                                 if e["type"] == "provider-arrival" and
                                 e["data"].get("testCase") == "treatment-withdrawn"]
            checked_withdrawn = verify_attempt_receipts(
                arrived_withdrawn, withdrawn, expected_candidate=None,
                candidate_sha=sha(CANDIDATE))
            report["withdrawal"] = {
                "entry_list_empty": True,
                "provider_attempt_count": len(checked_withdrawn),
                "previously_exposed_marker_still_in_native_prompt":
                    any(entry["marker_seen"] for entry in checked_withdrawn),
                "claim": "no new entry; historical exposure is not revoked",
            }
            fresh = create_session(host, project)
            probe.one(fresh, "fresh-after-withdrawal", False)
            report["checks"].append("tombstone-without-erasure-claim")
            source_guard(snapshot, {
                "skill_file_sha256": sha(skill_file.read_bytes()),
                "config_sha256": sha(config_file.read_bytes()),
                "loom_config_sha256": sha((project / ".loom.yaml").read_bytes()),
                **registry(host, project),
            })
            report["checks"].append("no-shared-source-or-registry-mutation")
            # Unrelated observed candidate or unknown request makes the run inconclusive.
            known = {entry["name"] for entry in probe.cases} | {"treatment-withdrawn"}
            unknown = [e["data"] for e in events(root) if e["type"] == "provider-request"
                       and e["data"]["testCase"] is not None and e["data"]["testCase"] not in known]
            require(not unknown, "PARTIAL_EXPOSURE: unexpected provider request escaped attribution")
            report["cases"] = probe.cases
            report["native_requests"] = [
                e["data"] for e in events(root) if e["type"] == "native-request"]
            report["native_retries"] = [
                e["data"] for e in events(root) if e["type"] == "native-retry"]
            report["status"] = "QUALIFIED_BOUNDED"
    except Exception as error:
        report["status"] = "UNPROVEN"
        report["blocker"] = type(error).__name__ + ": " + str(error)
    finally:
        if host is not None:
            host.close()
        (output / "report.json").write_text(json.dumps(report, indent=2, sort_keys=True) + "\n")
    return report


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--opencode", required=True, type=Path)
    parser.add_argument("--repository", required=True, type=Path)
    parser.add_argument("--plugin", required=True, type=Path)
    parser.add_argument("--artifact", required=True, type=Path)
    parser.add_argument("--expect-plugin-version", required=True)
    parser.add_argument("--report-directory", required=True, type=Path)
    parser.add_argument("--disable-watcher", action="store_true")
    result = run(parser.parse_args())
    print(json.dumps({
        "status": result["status"], "checks": result["checks"],
        "blocker": result.get("blocker"), "report": "report.json",
    }, indent=2))
    if result["status"] != "QUALIFIED_BOUNDED":
        raise SystemExit(1)


if __name__ == "__main__":
    main()
