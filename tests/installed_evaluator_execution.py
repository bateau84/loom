"""Installed restricted execution consumer with an explicitly synthetic authority.

The packed production consumer reads authored original fixture evidence and
executes the actual native Session/provider path. The fixture owns its zero-cost
provider; it is not authority over any real account, installed Evaluator method,
private evidence, or billing. No production dispatch integration is registered.
"""
from __future__ import annotations

import argparse
import base64
from contextlib import closing
from datetime import datetime, timedelta, timezone
import hashlib
import json
import os
from pathlib import Path
import shutil
import signal
import sqlite3
import subprocess
import tempfile
import time
from urllib.request import Request

from installed_host_smoke import PrivateHost, installed_plugin_inventory, isolated_environment, require
from installed_instruction_variants import verify_host_version

HOST = "2.3.0"
PROVIDER = "evaluator-execution-fixture"
CHECKS = {
    "positive-native-one-send-and-completed-result",
    "original-result-recovered-after-host-restart",
    "old-loom-snapshot-recovers-without-new-effect",
    "additional-native-send-denied-by-durable-owner",
    "lost-ack-recovered-without-new-effect",
    "provider-rejection-with-native-admission-preserved",
    "crashed-native-send-retains-uncertain-reservation",
    "concurrent-issues-share-one-capacity-pool",
    "provider-admission-oracle-rejects-duplicate",
    "uncertain-reservation-never-claims-or-dispatches",
    "losing-validation-failure-preserves-native-winner",
    "losing-caller-abort-preserves-native-winner",
}
RETROSPECTIVE_CHECKS = (CHECKS - {"positive-native-one-send-and-completed-result"}) | {
    "positive-native-two-send-retrieval-and-completed-result",
    "exact-frozen-v2-preparation-and-native-recipient-retrieval",
    "later-history-cannot-change-evaluated-population",
    "wrong-request-cannot-authorize-execution",
    "wrong-population-cannot-authorize-execution",
    "denied-recipient-cannot-retrieve-or-execute",
    "changed-original-cannot-authorize-execution",
    "invalid-reservation-cannot-authorize-execution",
    "cancelled-native-execution-cannot-dispatch-again",
    "truncated-native-source-cannot-authorize-second-send",
}


def encoded(value):
    return json.dumps(value, sort_keys=True, separators=(",", ":"))


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def method(repo):
    def content(name, path):
        return {"locator": "fixture://execution/" + name, "sha256": sha(path)}

    def policy(name):
        return {"id": "fixture-" + name, "revision": "1", "sha256": hashlib.sha256(name.encode()).hexdigest()}

    fixture = repo / "tests/evaluator-execution-host"
    return {
        "format": "loom-evaluator-method/v1",
        "evaluator": {"agent": "evaluator", "definition": content("evaluator", fixture / "server.ts")},
        "audit_skill": {"skill": "agent-run-audit", "definition": content("scripted-audit-placeholder", fixture / "provider.mjs")},
        "rubric": content("scripted-rubric", fixture / "driver.ts"),
        "instruction_bundle": content("fixture-only-instructions", fixture / "server.ts"),
        "result_format": "loom-evaluator-interpretation/v1",
        "model": {"provider_id": PROVIDER, "model_id": "audit", "settings": content("settings", fixture / "server.ts")},
        "adapter": {"id": "test-only-native-provider-owner", "version": "1", "profile": policy("profile")},
        "source_policy": policy("synthetic-original-source"), "route_policy": policy("zero-cost-local-only"),
    }


def inventory(root):
    with closing(sqlite3.connect(root / "fixture-authority.sqlite")) as db:
        db.row_factory = sqlite3.Row
        return {"enrollments": [dict(row) for row in db.execute("SELECT * FROM fixture_enrollments ORDER BY issue_key")],
                "pools": [dict(row) for row in db.execute("SELECT * FROM fixture_pools")],
                "events": [{**dict(row), "data": json.loads(row["data"])}
                           for row in db.execute("SELECT * FROM fixture_events ORDER BY sequence")]}


def assert_admissions(value, expected):
    require(not any(event["type"] == "observer-failure" for event in value["events"]), "Native fixture observer failed")
    admitted = [event for event in value["events"] if event["type"] == "provider-admitted"]
    attempts = [event for event in value["events"] if event["type"] == "provider-attempt" and event["data"]["admitted"]]
    require(len(admitted) == len(attempts) == expected, "Unexpected actual provider admission count")
    require(len({(event["data"]["issue_key"], event["data"]["request_number"]) for event in admitted}) == len(admitted),
            "Duplicate invocation of a legitimate native recipient stage")
    for row in value["enrollments"]:
        numbers = [event["data"]["request_number"] for event in admitted if event["data"]["issue_key"] == row["issue_key"]]
        require(numbers == list(range(1, row["sends"] + 1)) and row["sends"] <= row["request_limit"],
                "Native requests escaped the exact reserved stage sequence")
    require(sum(row["sends"] for row in value["enrollments"]) == expected, "Provider journal and enrollment disagree")
    require(sum(pool["consumed"] for pool in value["pools"]) == expected, "Provider journal and shared accounting disagree")
    require(all(pool["consumed"] <= pool["reserved"] <= pool["capacity"] for pool in value["pools"]), "Shared pool overdraw")
    require(all(event["data"].get("provider_id") == PROVIDER for event in admitted), "Unexpected provider route")
    requests = [event["data"] for event in value["events"] if event["type"] == "model-request"]
    require(all(event.get("provider_id") == PROVIDER and event.get("model_id") == "audit"
                and event.get("agent") == "evaluator" and event.get("kind") == "primary" for event in requests),
            "Unexpected effective model, recipient or native auxiliary request")


def assert_no_cancellation(value):
    require(not any(event["type"] in ("consumer-cancel-entry", "consumer-native-interrupt")
                    for event in value["events"]), "Losing caller cancelled the shared authority admission")
    require(not any(row["revoked"] for row in value["enrollments"]), "Losing caller revoked the winner's reservation")
    require(not any(event["type"] == "native-event"
                    and event["data"].get("type") == "session.execution.interrupted"
                    for event in value["events"]), "Native winner was interrupted")


def until(read, predicate, label, seconds=20):
    deadline = time.monotonic() + seconds
    while time.monotonic() < deadline:
        value = read()
        if predicate(value):
            return value
        time.sleep(0.05)
    raise RuntimeError("Timed out: " + label)


def native(host, method_name, path, body=None):
    require(path.startswith("/api/session"), "Fixture native path escaped Session surface")
    token = base64.b64encode(("opencode:" + host.password).encode()).decode()
    request = Request(host.url + path, method=method_name,
                      data=encoded(body).encode() if body is not None else None,
                      headers={"Authorization": "Basic " + token, "Content-Type": "application/json"})
    with host.opener.open(request, timeout=10) as response:
        raw = response.read(2 * 1024 * 1024 + 1)
    require(len(raw) <= 2 * 1024 * 1024, "Native fixture response too large")
    result = json.loads(raw) if raw else None
    return result.get("data", result) if isinstance(result, dict) else result


def native_source_result(case, row):
    messages = native(case.host, "GET", "/api/session/" + row["session_id"] + "/message?order=asc&limit=200")
    require(isinstance(messages, list) and len(messages) < 200, "Native retrospective readback incomplete")
    tool_id = "call_eval_" + row["issue_key"][:32]
    tool_parts = [(message, part) for message in messages for part in message.get("content", [])
                  if part.get("type") == "tool" and part.get("id") == tool_id]
    require(len(tool_parts) == 1, "Actual native Evaluator source tool call is absent or repeated")
    message, part = tool_parts[0]
    require(message.get("agent") == "evaluator" and part.get("state", {}).get("status") == "completed",
            "Source retrieval did not complete in the actual Evaluator recipient")

    def strings(node):
        if isinstance(node, str):
            yield node
        elif isinstance(node, list):
            for child in node:
                yield from strings(child)
        elif isinstance(node, dict):
            for child in node.values():
                yield from strings(child)

    bodies = [text for text in strings(part) if text.startswith('{"format":"loom-controlled-retrospective-evidence/v1"')]
    require(len(bodies) == 1, "Native tool result did not retain the exact delivered evidence envelope")
    return message, tool_id, bodies[0]


def assert_retrospective_delivery(case):
    """Compare actual native tool output/provider input with the frozen owner data."""
    value = inventory(case.root)
    row = value["enrollments"][0]
    expected = json.loads((case.root / "consumers/first/case.json").read_text())
    message, tool_id, body = native_source_result(case, row)
    delivery = json.loads(body)
    digest = hashlib.sha256(body.encode()).hexdigest()
    require(delivery["recipient"]["session_id"] == row["session_id"] and delivery["recipient"]["agent"] == "evaluator"
            and delivery["subject"]["semantic_key"] == row["issue_key"]
            and delivery["subject"]["source"]["population_id"] == expected["population_id"]
            and delivery["subject"]["source"]["manifest_sha256"] == expected["population_sha256"],
            "Native evidence recipient/admission mismatch")
    originals = delivery["originals"]
    require(len(originals) == len(expected["members"]) and row["source_delivery_count"] == 1,
            "Native evidence retrieval omitted or repeated frozen members")
    require([item["member_key"] for item in originals] == [item["key"] for item in expected["members"]],
            "Native retrieval changed frozen membership or order")
    for original, member in zip(originals, expected["members"]):
        require(all(original[key] == expected["pins"][key] for key in ("batch_id", "request_id", "manifest_sha256")),
                "Native source callback changed preparation identity")
        require(original["population_id"] == expected["population_id"]
                and original["population_manifest_sha256"] == expected["population_sha256"]
                and original["source_index"] == 0 and original["source"] == member["source"]
                and original["source_store_id"] == member["source_store_id"]
                and original["permitted_view"] == member["permitted_view"]
                and original["receiving_session"] == row["session_id"], "Native original identity/version/view changed")
        if member["availability"] == "available":
            require(original["status"] == "available"
                    and hashlib.sha256(encoded(original["value"]).encode()).hexdigest() == member["source"]["sha256"],
                    "Native Evaluator did not retrieve the exact permitted original bytes")
        else:
            require(original["status"] == member["availability"] and "value" not in original
                    and original["gap"]["code"] == "unresolved-at-freeze",
                    "Native Evaluator received invented bytes or changed frozen source coverage")
    require("LATER_HISTORY_MUST_NOT_ENTER_FROZEN_EVALUATION" not in body, "Later history leaked into frozen evaluation")
    returned = [event["data"] for event in value["events"] if event["type"] == "native-source-tool-returned"]
    supplied = [event["data"] for event in value["events"] if event["type"] == "consumer-source-returned"]
    provider = [event["data"] for event in value["events"] if event["type"] == "provider-returned"]
    require(len(returned) == len(supplied) == len(provider) == 1
            and returned[0]["sha256"] == supplied[0]["sha256"] == provider[0]["source_result_sha256"] == digest
            and returned[0]["bytes"] == supplied[0]["bytes"] == provider[0]["source_bytes"] == len(body.encode())
            and returned[0]["message_id"] == message["id"] and returned[0]["call_id"] == tool_id,
            "Source callback, actual native tool and provider-visible evidence disagree")
    reads = [event["data"] for event in value["events"] if event["type"] == "source-owner-read"]
    require(reads and all(read["recipient_session_id"] == row["session_id"] for read in reads),
            "Execution resolved originals under the requester instead of the actual recipient")
    duplicate_denials = [event for event in value["events"] if event["type"] == "duplicate-source-callback-denied"]
    require(len(duplicate_denials) == 1 and len(supplied) == 1,
            "Concurrent duplicate source callback was not rejected before another original read")
    return {"population_id": expected["population_id"], "population_manifest_sha256": expected["population_sha256"],
            "preparation_manifest_sha256": expected["pins"]["manifest_sha256"], "member_count": len(originals),
            "native_session_id": row["session_id"], "native_message_id": message["id"], "native_tool_id": tool_id,
            "native_tool_result_sha256": digest, "requests": row["sends"],
            "callback_bytes": supplied[0]["bytes"], "native_tool_bytes": len(body.encode()), "provider_bytes": provider[0]["source_bytes"],
            "concurrent_source_callback_denials": len(duplicate_denials),
            "available_originals": sum(item["status"] == "available" for item in originals),
            "explicit_gaps": sum(item["status"] != "available" for item in originals)}


class Case:
    def __init__(self, args, root, output, name, mode="complete", lose_ack=False):
        self.args, self.root, self.output, self.name = args, root, output, name
        self.project = root / "project"
        self.project.mkdir()
        self.env = isolated_environment(root)
        self.env["LOOM_EXECUTION_FIXTURE"] = str(root)
        if args.disable_filewatcher:
            self.env["OPENCODE_FILEWATCHER_DISABLE"] = "1"
        self.policy = {"enabled": True, "source_enabled": True,
                       "expires_at": (datetime.now(timezone.utc) + timedelta(hours=1)).isoformat(timespec="milliseconds").replace("+00:00", "Z"),
                       "capacity": 2 if args.preparation_source == "retrospective" else 1,
                       "preparation_source": args.preparation_source,
                       "duplicate_source_probe": args.preparation_source == "retrospective" and name == "complete",
                       "account": "local-fixture-account", "mode": mode,
                       "method": method(args.repository), "lose_ack": lose_ack}
        config = {"plugins": ["*", str(args.plugin), str(args.repository / "tests/evaluator-execution-host")],
                  "agents": {"evaluator": {"description": "Scripted restricted execution mechanics fixture; not genuine reasoning",
                    "mode": "primary", "system": "Return only the local scripted mechanics response.",
                    "model": PROVIDER + "/audit", "permissions": [{"action": "*", "resource": "*", "effect": "deny"}]
                    + ([{"action": "evaluator_evidence", "resource": "*", "effect": "allow"}]
                       if args.preparation_source == "retrospective" else [])}},
                  "model": PROVIDER + "/audit", "update": "disable", "share": "disabled"}
        if args.preparation_source == "retrospective" and name != "truncated-source":
            # Exact complete controlled evidence must fit the host's tool-output
            # policy; never accept truncated JSON merely because its prefix fits.
            config["tool_output"] = {"max_bytes": 180000}
        configuration = Path(self.env["OPENCODE_CONFIG_DIR"]) / "opencode.json"
        configuration.write_text(encoded(config))
        self.policy["configuration_sha256"] = sha(configuration)
        (root / "policy.json").write_text(encoded(self.policy))
        (self.project / ".loom.yaml").write_text("instructions: {enabled: false}\nledger: {capture: automatic}\n")
        subprocess.run(["git", "init", "-q", str(self.project)], check=True, env=self.env, timeout=10)
        self.host = None
        self.restart_count = 0
        self.boot()

    def boot(self):
        self.host = PrivateHost(str(self.args.opencode), self.project, self.env, self.output,
                                self.name + "-" + str(self.restart_count))
        self.restart_count += 1
        try:
            require(json.loads(self.host.get("/api/info", "info")).get("version") == HOST, "Unexpected native version")
            self.host.wait_roster("/api/plugin", "plugins", lambda rows: all(any(
                row.get("id") == identifier and row.get("state", {}).get("status") == "active"
                for row in rows) for identifier in ("loom", "loom.evaluator.execution.fixture")))
            path = self.root / "native.json"
            path.write_text(encoded({"url": self.host.url, "password": self.host.password}))
            path.chmod(0o600)
        except Exception:
            self.close()
            raise

    def close(self):
        if self.host:
            self.host.close()
            self.host = None

    def restart(self, crash=False):
        if crash and self.host and self.host.proc.poll() is None:
            os.killpg(self.host.proc.pid, signal.SIGKILL)
        self.close()
        self.boot()

    def arguments(self, command, name="first"):
        return [str(self.args.bun), str(self.args.repository / "tests/evaluator-execution-host/driver.ts"),
                command, str(self.root), str(self.args.plugin), name]

    def driver(self, command, name="first", success=True):
        completed = subprocess.run(self.arguments(command, name), env=self.env, capture_output=True, text=True, timeout=35)
        require(completed.stdout.strip(), "Fixture driver returned no result: " + completed.stderr[-2000:])
        value = json.loads(completed.stdout.strip().splitlines()[-1])
        require(value["ok"] == success, "Unexpected fixture driver result: " + encoded(value))
        return value.get("result", value)

    def worker(self, command, name="first"):
        return subprocess.Popen(self.arguments(command, name), env=self.env, stdout=subprocess.PIPE,
                                stderr=subprocess.PIPE, text=True)

    def collect(self, worker, success=True):
        stdout, stderr = worker.communicate(timeout=35)
        require(stdout.strip(), "Concurrent fixture driver returned no result: " + stderr[-2000:])
        value = json.loads(stdout.strip().splitlines()[-1])
        require(value["ok"] == success and worker.returncode == (0 if success else 2),
                "Unexpected concurrent fixture driver result: " + encoded(value))
        return value.get("result", value)

    def snapshot(self):
        backup = self.root / "before-effect"
        backup.mkdir()
        for name in ("ledger.sqlite", "learning.sqlite"):
            source = self.root / "consumers/first" / name
            with closing(sqlite3.connect(source)) as original, closing(sqlite3.connect(backup / name)) as copy:
                original.backup(copy)

    def restore(self):
        for name in ("ledger.sqlite", "learning.sqlite"):
            source = self.root / "before-effect" / name
            target = self.root / "consumers/first" / name
            with closing(sqlite3.connect(source)) as original, closing(sqlite3.connect(target)) as copy:
                original.backup(copy)


def run(args):
    output = args.report_directory
    output.mkdir(parents=True, exist_ok=False, mode=0o700)
    retrospective = args.preparation_source == "retrospective"
    request_units = 2 if retrospective else 1
    result = {"format": "loom-installed-evaluator-execution-consumer/v1", "status": "UNPROVEN", "checks": [],
              "preparation_source": args.preparation_source, "requests_per_execution": request_units,
              "genuine_evaluator": "UNPROVEN", "real_account_authority": "UNPROVEN", "q4": "UNQUALIFIED",
              "q5": "UNQUALIFIED", "e11": "UNPROVEN", "model_spending": "LOCAL_SCRIPTED_PROVIDER_ONLY",
              "limitations": ["Direct composition of packed consumer; no production tool, scheduler or authority adapter is registered.",
                "Synthetic authored originals and scripted method/output do not establish S3 reasoning or real installed method authority.",
                "Durable local provider owner proves mechanics only; no provider billing, subscription account or private transfer is qualified.",
                "Fixture authority survives Loom restore; simultaneous rollback or loss of that authority requires fail-closed recovery and is not a tested production capability."]}
    case = None
    try:
        require(args.opencode and args.opencode.is_file() and args.bun and args.bun.is_file(), "Pinned native and Bun binaries required")
        result["source_head"] = subprocess.check_output(["git", "-C", str(args.repository), "rev-parse", "HEAD"], text=True).strip()
        require(result["source_head"] == args.expect_head, "Source candidate HEAD changed")
        result["source_dirty"] = bool(subprocess.check_output(["git", "-C", str(args.repository), "status", "--porcelain"], text=True).strip())
        require(args.allow_dirty_development or not result["source_dirty"], "Qualification requires a clean exact source candidate")
        result["development_only"] = args.allow_dirty_development
        result["candidate"] = installed_plugin_inventory(args.artifact, args.plugin, args.expect_plugin_version, HOST)
        paths = [args.repository / "server.ts", *[path for path in (args.repository / "src").rglob("*") if path.is_file()]]
        require(all((args.plugin / path.relative_to(args.repository)).is_file()
                    and sha(path) == sha(args.plugin / path.relative_to(args.repository)) for path in paths),
                "Packed runtime differs from source candidate")
        result["runtime_files_checked"] = len(paths)
        result["input_sha256"] = {str(path.relative_to(args.repository)): sha(path) for path in [
            args.repository / "tests/installed_evaluator_execution.py",
            args.repository / "tests/installed_host_smoke.py", args.repository / "tests/installed_instruction_variants.py",
            *sorted((args.repository / "tests/evaluator-execution-host").glob("*"))] if path.is_file()}
        result["cli_sha256"] = sha(args.opencode)
        result["journals"] = {}

        def check(name, **evidence):
            require(name in (RETROSPECTIVE_CHECKS if retrospective else CHECKS)
                    and name not in {item["name"] for item in result["checks"]}, "Unexpected or duplicate check")
            result["checks"].append({"name": name, "status": "PASS", **evidence})
            print("PASS " + name, flush=True)

        with tempfile.TemporaryDirectory(prefix="loom-installed-execution-") as temporary:
            base = Path(temporary).resolve()
            version_env = isolated_environment(base / "version")
            result["host_version"] = subprocess.check_output([str(args.opencode), "--version"], env=version_env, text=True, timeout=15).strip()
            verify_host_version(result["host_version"])
            cases = [("complete", "complete", False), ("lost-ack", "hold", True),
                                         ("reject", "reject", False), ("crash", "hold", False),
                                         ("uncertain", "complete", False), ("loser-failure", "hold", False),
                                         ("loser-abort", "hold", False),
                                         ("capacity", "complete", False)]
            if retrospective:
                cases += [(name, "complete", False) for name in
                          ("wrong-request", "wrong-population", "denied-recipient", "changed-source", "invalid-reservation", "truncated-source")]
                cases.append(("cancel", "hold", False))
            for name, mode, lose_ack in cases:
                root = base / name
                root.mkdir(mode=0o700)
                case = Case(args, root, output, name, mode, lose_ack)
                completed = False
                try:
                    prepared = case.driver("init")
                    if name == "complete":
                        if retrospective:
                            require(prepared["request_format"] == "loom-evaluation-request/v2", "Retrospective preparation was not v2")
                            appended = case.driver("append-history")
                            require(appended["population_id"] == prepared["population_id"]
                                    and appended["manifest_sha256"] == prepared["population_sha256"]
                                    and appended["member_count"] == prepared["member_count"],
                                    "Later source history altered the frozen manifest")
                        case.snapshot()
                        first = case.driver("execute")
                        require(first["qualification"] == "execution-consumer-only" and first["interpretation"] is None,
                                "Fixture upgraded qualification or manufactured interpretation")
                        require(first["receipt"]["execution"] == "completed" and first["receipt"]["budget"] == "settled",
                                "Native completed result not reconciled")
                        assert_admissions(inventory(root), request_units)
                        check("positive-native-two-send-retrieval-and-completed-result" if retrospective
                              else "positive-native-one-send-and-completed-result", result=first["receipt"]["result"])
                        if retrospective:
                            delivered = assert_retrospective_delivery(case)
                            check("exact-frozen-v2-preparation-and-native-recipient-retrieval", **delivered)
                            check("later-history-cannot-change-evaluated-population", **appended)
                        case.restart()
                        recovered = case.driver("recover")
                        require(recovered["receipt"] == first["receipt"], "Host restart changed original result")
                        assert_admissions(inventory(root), request_units)
                        check("original-result-recovered-after-host-restart")
                        case.restore()
                        restored = case.driver("execute")
                        require(restored["receipt"] == first["receipt"], "Older local snapshot authorized another effect")
                        assert_admissions(inventory(root), request_units)
                        check("old-loom-snapshot-recovers-without-new-effect")
                        row = inventory(root)["enrollments"][0]
                        native(case.host, "POST", "/api/session/" + row["session_id"] + "/prompt", {
                            "id": "msg_fixture_duplicate", "text": "Unexpected extra invocation", "resume": True})
                        observed = until(lambda: inventory(root), lambda value: value["enrollments"][0]["denied_sends"] >= 1,
                                         "additional provider invocation denied")
                        assert_admissions(observed, request_units)
                        check("additional-native-send-denied-by-durable-owner", denied_sends=observed["enrollments"][0]["denied_sends"])
                        broken = json.loads(encoded(observed))
                        duplicate = next(event for event in broken["events"] if event["type"] == "provider-admitted")
                        broken["events"].append(duplicate.copy())
                        try:
                            assert_admissions(broken, request_units)
                        except RuntimeError:
                            check("provider-admission-oracle-rejects-duplicate")
                        else:
                            raise RuntimeError("Oracle accepted duplicate using legitimate recipient identity")
                    elif name == "lost-ack":
                        value = case.driver("execute", success=False)
                        require("lost acknowledgement" in value["error"], "Lost ACK fault did not cross native admission")
                        held = until(lambda: inventory(root), lambda value: any(e["type"] == "provider-held" for e in value["events"]),
                                     "lost ACK with original provider request held")
                        snapshot = case.driver("inspect")["snapshot"]
                        receipts = snapshot.get("receipts") if isinstance(snapshot, dict) else None
                        require(isinstance(receipts, list) and bool(receipts)
                                and isinstance(receipts[-1], dict) and receipts[-1].get("budget") == "uncertain",
                                "Lost ACK accidentally reconciled before the intended recovery boundary")
                        row = held["enrollments"][0]
                        (root / ("release-" + row["input_id"])).write_text("release original fixture response")
                        # Observe native durability directly. Do not let the consumer or authority
                        # reconcile yet: the first result recovery must happen after host restart.
                        until(lambda: native(case.host, "GET", "/api/session/" + row["session_id"] + "/message?limit=200"),
                              lambda messages: any(message.get("type") == "assistant" and message.get("finish") == "stop"
                                                   and message.get("time", {}).get("completed") for message in messages),
                              "original result durable in native history")
                        case.restart()
                        recovered = case.driver("recover")
                        require(recovered["receipt"]["execution"] == "completed", "Lost ACK failed to recover original result")
                        assert_admissions(inventory(root), request_units)
                        check("lost-ack-recovered-without-new-effect")
                    elif name == "reject":
                        rejected = case.driver("execute")
                        require(rejected["receipt"]["execution"] == "not-admitted" and rejected["receipt"]["budget"] == "released"
                                and rejected["receipt"]["fenced"] and rejected["receipt"]["usage"] == {
                                    "requests": 0, "input_tokens": 0, "output_tokens": 0},
                                "Provider send rejection did not yield fenced zero-usage budget release")
                        observed = inventory(root)
                        assert_admissions(observed, 0)
                        row = observed["enrollments"][0]
                        enqueued = [event for event in observed["events"] if event["type"] == "native-event"
                                    and event["data"].get("type") == "session.inbox.enqueued"
                                    and event["data"].get("session_id") == row["session_id"]
                                    and event["data"].get("message_id") == row["input_id"]]
                        delivered = [event for event in observed["events"] if event["type"] == "native-event"
                                     and event["data"].get("type") == "session.inbox.delivered"
                                     and event["data"].get("session_id") == row["session_id"]
                                     and event["data"].get("message_id") == row["input_id"]]
                        denied = [event for event in observed["events"] if event["type"] == "provider-attempt"
                                  and event["data"].get("issue_key") == row["issue_key"]
                                  and event["data"].get("admitted") is False]
                        require(len(enqueued) == len(delivered) == len(denied) == row["denied_sends"] == 1
                                and enqueued[0]["sequence"] < delivered[0]["sequence"] < denied[0]["sequence"],
                                "Expected original native input admission and delivery before provider send denial")
                        require(any(e["type"] == "retry-denied" for e in observed["events"]), "Native retry decision was not exercised")
                        before = case.driver("inspect")["issue"]["attempt"]
                        require(before["state"] == "unknown" and before["native_outcome"] == "unknown"
                                and before["claimant_id"] and before["claimed_at"],
                                "Provider-only non-admission falsely rejected or reopened the consumed native issue")
                        claim = {key: before[key] for key in ("attempt_id", "claimant_id", "claimed_at")}
                        attempts = [event for event in observed["events"] if event["type"] in ("model-request", "provider-attempt")]
                        for command in ("recover", "execute"):
                            replay = case.driver(command)
                            require(replay["receipt"] == rejected["receipt"], "Reconciliation changed provider budget release")
                            after = case.driver("inspect")["issue"]["attempt"]
                            require(after["state"] == "unknown" and after["native_outcome"] == "unknown"
                                    and {key: after[key] for key in claim} == claim,
                                    "Recovery or replay changed the consumed claim or manufactured native non-admission")
                            replayed = inventory(root)
                            assert_admissions(replayed, 0)
                            require([event for event in replayed["events"]
                                     if event["type"] in ("model-request", "provider-attempt")] == attempts,
                                    "Recovery or replay issued another native model request")
                        check("provider-rejection-with-native-admission-preserved",
                              native_input_admitted=True, canonical_native_outcome="unknown", admitted_model_sends=0,
                              budget="released", claim_retained=True,
                              retry_decisions=sum(e["type"] == "retry-denied" for e in observed["events"]))
                    elif name == "crash":
                        uncertain = case.driver("execute")
                        require(uncertain["receipt"]["execution"] == "unknown" and uncertain["receipt"]["budget"] == "uncertain",
                                "Provider barrier did not preserve uncertainty")
                        assert_admissions(inventory(root), request_units)
                        case.restart(crash=True)
                        # Recovery reads uncertainty, and repeated consumer execution may not dispatch.
                        recovered = case.driver("recover")
                        replayed = case.driver("execute")
                        require(recovered["receipt"] == replayed["receipt"], "Consumer replay changed uncertain outcome")
                        assert_admissions(inventory(root), request_units)
                        # Exercise a real second native request after restart. Native restart may
                        # also resume its own persisted claim; both must use the same send fence.
                        row = inventory(root)["enrollments"][0]
                        native(case.host, "POST", "/api/session/" + row["session_id"] + "/prompt", {
                            "id": "msg_fixture_after_crash", "text": "Unexpected request after native crash", "resume": True})
                        observed = until(lambda: inventory(root), lambda value: value["enrollments"][0]["denied_sends"] >= 1,
                                         "native restart/repeated wake fence")
                        recovered = case.driver("recover")
                        require(recovered["receipt"]["budget"] == "uncertain", "Unknown admission released potentially consumed budget")
                        assert_admissions(observed, request_units)
                        require(observed["pools"][0]["reserved"] == request_units, "Restart released consumed reservation")
                        check("crashed-native-send-retains-uncertain-reservation", denied_sends=observed["enrollments"][0]["denied_sends"])
                    elif name == "uncertain":
                        first = case.driver("execute-uncertain")
                        require(first["receipt"]["execution"] == "reserved" and first["receipt"]["budget"] == "uncertain",
                                "Current uncertain reservation was not retained")
                        for command in ("recover", "execute"):
                            recovered = case.driver(command)
                            require(recovered["receipt"] == first["receipt"], "Uncertain inventory changed on replay")
                            issue = case.driver("inspect")["issue"]["attempt"]
                            require(issue["state"] == "prepared" and not issue["claimant_id"] and not issue["claimed_at"],
                                    "Uncertain reservation acquired the canonical claim")
                        observed = inventory(root)
                        assert_admissions(observed, 0)
                        assert_no_cancellation(observed)
                        require(len(observed["enrollments"]) == 1 and observed["pools"][0]["reserved"] == request_units,
                                "Uncertain reservation disappeared or released capacity")
                        require(not any(event["type"] in ("consumer-execute-entry", "model-request", "provider-attempt")
                                        or (event["type"] == "native-event"
                                            and event["data"].get("type") == "session.inbox.enqueued")
                                        for event in observed["events"]),
                                "Uncertain reservation reached execution or native input admission")
                        check("uncertain-reservation-never-claims-or-dispatches", canonical_claims=0,
                              execute_entries=0, native_inputs=0, model_sends=0, reserved_capacity=request_units)
                    elif name in ("loser-failure", "loser-abort"):
                        loser = case.worker("execute-" + name)
                        workers = [loser]
                        try:
                            until(lambda: (root / "loser-ready").is_file(), bool, "loser paused before its canonical claim")
                            winner = case.worker("execute-winner")
                            workers.append(winner)
                            held = until(lambda: inventory(root), lambda value: any(
                                event["type"] == "provider-held" for event in value["events"]),
                                "winning native provider request held")
                            assert_admissions(held, request_units)
                            before = case.driver("inspect")["issue"]["attempt"]
                            require(before["claimant_id"] and before["claimed_at"], "Native winner has no canonical claim")
                            claim = {key: before[key] for key in ("attempt_id", "claimant_id", "claimed_at")}
                            (root / "release-loser").write_text("fail or abort only the paused losing caller")
                            failed = case.collect(loser, success=False)
                            expected = "losing claim validation failed" if name == "loser-failure" else "losing caller aborted"
                            require(expected in failed["error"], "Losing caller did not cross the intended failure boundary")
                            observed = inventory(root)
                            assert_admissions(observed, request_units)
                            assert_no_cancellation(observed)
                            after = case.driver("inspect")["issue"]["attempt"]
                            require({key: after[key] for key in claim} == claim, "Losing caller changed the canonical winner")
                            require(winner.poll() is None, "Winner stopped before the original native response was released")
                            entries = [event for event in observed["events"] if event["type"] == "consumer-execute-entry"]
                            require(len(entries) == 1 and entries[0]["data"]["command"] == "execute-winner",
                                    "Losing caller entered authority execution")
                            row = observed["enrollments"][0]
                            (root / ("release-" + row["input_id"])).write_text("complete only the original winning response")
                            completed_winner = case.collect(winner)
                            require(completed_winner["receipt"]["execution"] == "completed"
                                    and completed_winner["receipt"]["budget"] == "settled",
                                    "Losing caller prevented the winner's original result from completing")
                            for command in ("recover", "execute"):
                                recovered = case.driver(command)
                                require(recovered["receipt"] == completed_winner["receipt"],
                                        "Winner recovery changed the original result")
                            final = inventory(root)
                            assert_admissions(final, request_units)
                            assert_no_cancellation(final)
                            require([event for event in final["events"] if event["type"] in (
                                "consumer-execute-entry", "model-request", "provider-attempt")] == [
                                    event for event in observed["events"] if event["type"] in (
                                        "consumer-execute-entry", "model-request", "provider-attempt")],
                                    "Winner completion or recovery caused an additional execution or model request")
                            check("losing-validation-failure-preserves-native-winner" if name == "loser-failure"
                                  else "losing-caller-abort-preserves-native-winner",
                                  canonical_claim_retained=True, authority_cancellations=0, native_interrupts=0,
                                  execute_entries=1, model_sends=request_units, result=completed_winner["receipt"]["result"])
                        finally:
                            for worker in workers:
                                if worker.poll() is None:
                                    worker.kill()
                                    worker.communicate(timeout=5)
                    elif name in ("wrong-request", "wrong-population", "denied-recipient", "changed-source", "invalid-reservation"):
                        if name == "changed-source":
                            case.driver("change-original")
                        failure = case.driver("execute" if name == "changed-source" else "execute-" + name, success=False)
                        expected_error = {"wrong-request": "preparation mismatch", "wrong-population": "authority changed",
                                          "denied-recipient": "recipient denied", "changed-source": "unavailable or changed",
                                          "invalid-reservation": "admission mismatched"}[name]
                        require(expected_error in failure["error"], "Negative control failed at an unintended boundary: " + failure["error"])
                        issue = case.driver("inspect")["issue"]["attempt"]
                        require(issue["state"] == "prepared" and not issue["claimant_id"] and not issue["claimed_at"],
                                "Rejected retrospective input acquired a canonical claim")
                        observed = inventory(root)
                        assert_admissions(observed, 0)
                        require(not any(event["type"] in ("consumer-execute-entry", "model-request", "provider-attempt",
                                                         "consumer-source-returned", "native-source-tool-returned")
                                        or event["type"] == "native-event" and event["data"].get("type") == "session.inbox.enqueued"
                                        for event in observed["events"]), "Rejected retrospective input reached native execution or source release")
                        label = {"wrong-request": "wrong-request-cannot-authorize-execution",
                                 "wrong-population": "wrong-population-cannot-authorize-execution",
                                 "denied-recipient": "denied-recipient-cannot-retrieve-or-execute",
                                 "changed-source": "changed-original-cannot-authorize-execution",
                                 "invalid-reservation": "invalid-reservation-cannot-authorize-execution"}[name]
                        check(label, canonical_claims=0, model_sends=0, native_inputs=0, source_releases=0)
                    elif name == "truncated-source":
                        first = case.driver("execute")
                        require(first["receipt"]["execution"] == "unknown" and first["receipt"]["budget"] == "uncertain",
                                "Truncated source lost the already admitted first effect")
                        observed = inventory(root)
                        row = observed["enrollments"][0]
                        assert_admissions(observed, 1)
                        _, _, body = native_source_result(case, row)
                        supplied = [event["data"] for event in observed["events"] if event["type"] == "consumer-source-returned"]
                        provider = [event["data"] for event in observed["events"] if event["type"] == "provider-source-observed"]
                        native_sha = hashlib.sha256(body.encode()).hexdigest()
                        require(len(supplied) == len(provider) == 1 and len(body.encode()) == 51200
                                and supplied[0]["bytes"] > 51200 and native_sha != supplied[0]["sha256"]
                                and provider[0]["output_type"] == "content" and provider[0]["bytes"] is None
                                and any(part["bytes"] == 51200 and part["sha256"] == native_sha
                                        for part in provider[0]["content_texts"]),
                                "Control did not exercise actual default native tool-output truncation")
                        require(row["denied_sends"] == 1 and observed["pools"][0]["reserved"] == request_units,
                                "Truncated source authorized another send or released uncertain capacity")
                        claim = case.driver("inspect")["issue"]["attempt"]
                        attempts = [event for event in observed["events"] if event["type"] in ("consumer-execute-entry", "model-request", "provider-attempt")]
                        for command in ("recover", "execute"):
                            recovered = case.driver(command)
                            require(recovered["receipt"] == first["receipt"], "Truncation recovery invented a terminal outcome")
                            after = case.driver("inspect")["issue"]["attempt"]
                            require(all(after[key] == claim[key] for key in ("attempt_id", "claimant_id", "claimed_at")),
                                    "Truncation recovery reopened the consumed claim")
                            replayed = inventory(root)
                            assert_admissions(replayed, 1)
                            require([event for event in replayed["events"] if event["type"] in (
                                "consumer-execute-entry", "model-request", "provider-attempt")] == attempts,
                                "Truncation recovery or replay dispatched another request")
                        check("truncated-native-source-cannot-authorize-second-send", callback_bytes=supplied[0]["bytes"],
                              native_tool_bytes=len(body.encode()),
                              provider_text_bytes=sum(part["bytes"] for part in provider[0]["content_texts"]),
                              provider_serialized_output_bytes=provider[0]["output_bytes"], provider_output_type=provider[0]["output_type"],
                              admitted_model_sends=1, denied_model_sends=1, budget="uncertain", reserved_capacity=request_units)
                    elif name == "cancel":
                        first = case.driver("execute")
                        require(first["receipt"]["execution"] == "unknown" and first["receipt"]["budget"] == "uncertain",
                                "Cancellation control did not reach held actual native request")
                        before = case.driver("inspect")["issue"]["attempt"]
                        cancelled = case.driver("cancel")
                        require(cancelled["receipt"]["fenced"] and cancelled["receipt"]["budget"] == "uncertain",
                                "Cancellation released potentially consumed capacity")
                        case.restart()
                        for command in ("recover", "execute"):
                            recovered = case.driver(command)
                            require(recovered["receipt"] == cancelled["receipt"], "Cancellation recovery changed uncertainty")
                        after = case.driver("inspect")["issue"]["attempt"]
                        require(all(after[key] == before[key] for key in ("attempt_id", "claimant_id", "claimed_at")),
                                "Cancellation or restart reopened the consumed claim")
                        observed = inventory(root)
                        assert_admissions(observed, request_units)
                        require(observed["enrollments"][0]["revoked"] and observed["pools"][0]["reserved"] == request_units,
                                "Cancellation lost the durable effect fence or retained accounting")
                        require(sum(event["type"] == "consumer-execute-entry" for event in observed["events"]) == 1,
                                "Cancelled execution was dispatched again")
                        check("cancelled-native-execution-cannot-dispatch-again", canonical_claim_retained=True,
                              model_sends=request_units, budget="uncertain", reserved_capacity=request_units)
                    elif name == "capacity":
                        case.driver("init", "second")
                        workers = [subprocess.Popen(case.arguments("execute", who), env=case.env, stdout=subprocess.PIPE,
                                                    stderr=subprocess.PIPE, text=True) for who in ("first", "second")]
                        outcomes = []
                        try:
                            for worker in workers:
                                stdout, stderr = worker.communicate(timeout=35)
                                require(stdout.strip(), "Concurrent driver failed: " + stderr[-1000:])
                                outcomes.append(json.loads(stdout.strip().splitlines()[-1]))
                        finally:
                            for worker in workers:
                                if worker.poll() is None:
                                    worker.kill()
                                    worker.wait(timeout=5)
                        require(sum(value["ok"] for value in outcomes) == 1, "Shared capacity admitted wrong number of independent issues")
                        require(any("insufficient capacity" in value.get("error", "") for value in outcomes), "Capacity loser did not fail at pool owner")
                        assert_admissions(inventory(root), request_units)
                        check("concurrent-issues-share-one-capacity-pool")
                    value = inventory(root)
                    result["journals"][name] = value
                    completed = True
                finally:
                    case.close()
                    case = None
                    if (root / "fixture-authority.sqlite").is_file():
                        result["journals"][name] = inventory(root)
                        if completed:
                            expected_sends = 0 if name in ("reject", "uncertain", "wrong-request", "wrong-population", "denied-recipient", "changed-source", "invalid-reservation") else 1 if name == "truncated-source" else request_units
                            assert_admissions(result["journals"][name], expected_sends)
        require({item["name"] for item in result["checks"]} == (RETROSPECTIVE_CHECKS if retrospective else CHECKS), "Missing installed execution checks")
        result["status"] = "PASS"
    except Exception as error:
        result["status"], result["error"] = "FAIL", f"{type(error).__name__}: {error}"
    finally:
        if case:
            case.close()
        (output / "report.json").write_text(json.dumps(result, indent=2) + "\n")
        (output / "report.json").chmod(0o600)
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--opencode", type=Path, required=True)
    parser.add_argument("--bun", type=Path, default=Path(shutil.which("bun")) if shutil.which("bun") else None)
    parser.add_argument("--repository", type=Path, default=Path(__file__).resolve().parents[1])
    parser.add_argument("--plugin", type=Path, required=True)
    parser.add_argument("--artifact", type=Path, required=True)
    parser.add_argument("--expect-plugin-version", default="2.0.0-alpha.1")
    parser.add_argument("--expect-head", required=True)
    parser.add_argument("--report-directory", type=Path, required=True)
    parser.add_argument("--disable-filewatcher", action="store_true")
    parser.add_argument("--preparation-source", choices=("stage3", "retrospective"), default="stage3")
    parser.add_argument("--allow-dirty-development", action="store_true",
                        help="Debug only; report is explicitly development-only and cannot qualify a reviewed commit")
    args = parser.parse_args()
    for name in ("opencode", "bun", "repository", "plugin", "artifact", "report_directory"):
        if getattr(args, name):
            setattr(args, name, getattr(args, name).resolve())
    result = run(args)
    print(json.dumps({key: result.get(key) for key in ("status", "source_head", "development_only", "error", "checks")}))
    raise SystemExit(0 if result["status"] == "PASS" else 1)


if __name__ == "__main__":
    main()
