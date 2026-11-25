"""Installed historical evidence qualification on isolated OpenCode 2.3.0.

Only the local external model is scripted. Real registered Loom tools author
five records in four native children, then discover and read their bounded
historical projections. The fixture does not reproduce private originals,
qualify protected cross-Session raw release, or run an Evaluator.
"""
from __future__ import annotations

import argparse
import base64
from contextlib import closing
import hashlib
import json
from pathlib import Path
import secrets
import shutil
import sqlite3
import subprocess
import tarfile
import tempfile
import time
from urllib.request import Request

from installed_host_smoke import PrivateHost, installed_plugin_inventory, isolated_environment, require
from installed_instruction_variants import verify_host_version
from installed_learning_stage4 import assert_driver_invocations
from installed_native_review import ReviewScenario
from installed_questions import audit_session, events, idle, request, result_value
from native_review_oracle import call_key


HOST = "2.3.0"
UPSTREAM = "a6b15d33daf6ab7d35569f6d711fdb630b9f04e7"
DIRECT_CHILDREN = 261
MAX_RESPONSE_BYTES = 262144
CHECKS = {
    "historical-complete-direct-child-traversal",
    "exact-five-records-four-source-sessions",
    "native-dispatch-projection-and-source-pins",
    "own-context-exact-original-and-part-pin",
    "cross-session-and-export-raw-release-blocked",
    "revoked-discovery-inspection-disclosure-and-file-read-denied",
    "source-change-and-cursor-scope-denied",
    "native-inline-and-split-export-normalization",
    "historical-sources-unchanged-and-no-evaluator-effects",
}


def encoded(value) -> str:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


def sha(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def verify_candidate(args, repo: Path) -> dict:
    head = subprocess.check_output(["git", "-C", str(repo), "rev-parse", "HEAD"], text=True).strip()
    require(head == args.expect_head, "Historical evidence source differs from the exact candidate head")
    require(not subprocess.check_output(["git", "-C", str(repo), "status", "--porcelain"], text=True).strip(),
            "Installed historical qualification requires a clean exact source candidate")
    inventory = installed_plugin_inventory(args.artifact.resolve(), args.plugin.resolve(), args.expect_plugin_version, HOST)
    runtime = {"server.ts", *(str(path.relative_to(repo)) for path in (repo / "src").rglob("*") if path.is_file())}
    installed = {"server.ts", *(str(path.relative_to(args.plugin.resolve()))
                               for path in (args.plugin.resolve() / "src").rglob("*") if path.is_file())}
    require(runtime == installed, "Installed candidate has missing or additional runtime files")
    with tarfile.open(args.artifact, "r:gz") as archive:
        packed = {item.name.removeprefix("package/") for item in archive.getmembers() if item.isfile()
                  and (item.name == "package/server.ts" or item.name.startswith("package/src/"))}
        require(runtime == packed, "Packed candidate has missing or additional runtime files")
        for name in sorted(runtime):
            member = archive.extractfile("package/" + name)
            require(member is not None and member.read() == (repo / name).read_bytes()
                    == (args.plugin / name).read_bytes(), "Packed, installed and checked-in runtime differ: " + name)
    return {"source_head": head, "candidate": inventory, "runtime_files_checked": len(runtime),
            "runtime_sha256": {name: sha(repo / name) for name in sorted(runtime)}}


def synthetic_transfer(host, owned: set[str], method: str, path: str, body=None):
    """Only unsanitized export/import of this disposable fixture's synthetic IDs.

    This deliberately does not widen installed_questions.request, and is never
    a Loom source adapter. Native HTTP is the independent source-owner oracle.
    """
    exports = {f"/api/experimental/session/{session}/export?sanitize=false" for session in owned}
    is_import = method == "POST" and path == "/api/experimental/session/import" and isinstance(body, dict)
    require((method == "GET" and path in exports)
            or (is_import and body.get("info", {}).get("id") in owned),
            "Synthetic source oracle attempted an unowned transfer endpoint")
    token = base64.b64encode(f"opencode:{host.password}".encode()).decode()
    req = Request(host.url + path, data=None if body is None else encoded(body).encode(), method=method,
                  headers={"Authorization": "Basic " + token, "Content-Type": "application/json"})
    with host.opener.open(req, timeout=30) as response:
        raw = response.read(16 * 1024 * 1024 + 1)
    require(len(raw) <= 16 * 1024 * 1024, "Synthetic transfer exceeded its bounded response")
    value = json.loads(raw)
    return value.get("data", value) if isinstance(value, dict) else value


def native_export(host, owned: set[str], session: str) -> dict:
    value = synthetic_transfer(host, owned, "GET", f"/api/experimental/session/{session}/export?sanitize=false")
    require(isinstance(value, dict) and value.get("info", {}).get("id") == session
            and isinstance(value.get("messages"), list), "Native export returned the wrong synthetic source")
    return value


def tool_parts(exported: dict) -> dict[tuple[str, str], dict]:
    result = {}
    for message in exported["messages"]:
        if message.get("type") != "assistant":
            continue
        for part in message.get("content", []):
            if part.get("type") != "tool":
                continue
            key = (message["id"], part["id"])
            require(key not in result, "Native export contains a duplicate exact tool-part identity")
            result[key] = part
    return result


def import_inline_control(host, owned: set[str], project: Path, source: dict) -> dict:
    """Public import writes inline messages; only the later physical oracle proves it."""
    info = json.loads(encoded(source["info"]))
    info["id"] = "ses_" + secrets.token_hex(12)
    info["title"] = "Synthetic imported transcript; no dispatch executed by this Session"
    for key in ("parentID", "fork", "revert"):
        info.pop(key, None)
    messages = []
    for original in source["messages"]:
        if original.get("type") != "assistant" or not any(
                part.get("type") == "tool" and part.get("name") == "subagent"
                for part in original.get("content", [])):
            continue
        message = json.loads(encoded(original))
        message["id"] = "msg_" + secrets.token_hex(12)
        messages.append(message)
    require(len(messages) == 4, "Expected four completed native dispatch messages for inline import")
    owned.add(info["id"])
    imported = synthetic_transfer(host, owned, "POST", "/api/experimental/session/import",
                                  {"info": info, "messages": messages, "location": {"directory": str(project)}})
    require(imported.get("id") == info["id"], "Native import did not retain the exact synthetic Session ID")
    exported = native_export(host, owned, info["id"])
    require(exported["messages"] == messages, "Supported export changed imported normalized messages")
    return exported


def physical_generation_oracle(database: Path, split: dict, inline: dict) -> dict:
    """Read-only, stopped-host physical assertion; never used by a runtime reader."""
    require(database.is_file(), "Isolated native database missing for physical storage assertion")
    checks = []
    with closing(sqlite3.connect(database.as_uri() + "?mode=ro", uri=True)) as db:
        db.execute("PRAGMA query_only=ON")
        for generation, exported in (("split", split), ("inline", inline)):
            session = exported["info"]["id"]
            selected = {message: [] for message, _ in tool_parts(exported)}
            for message in exported["messages"]:
                if message["id"] in selected:
                    selected[message["id"]] = message["content"]
            require(selected, "Generation oracle has no exact tool-bearing messages")
            total_inline = total_split = 0
            for message, expected in selected.items():
                rows = db.execute("SELECT data FROM session_message WHERE session_id=? AND id=? AND type='assistant'",
                                  (session, message)).fetchall()
                require(len(rows) == 1, "Physical oracle found a missing or foreign exact message")
                embedded = json.loads(rows[0][0]).get("content", [])
                parts = [json.loads(row[0]) for row in db.execute(
                    "SELECT data FROM session_part WHERE session_id=? AND message_id=? ORDER BY ordinal", (session, message))]
                require(isinstance(embedded, list), "Physical inline content is not a list")
                if generation == "inline":
                    require(embedded and not parts, "Public import did not produce actual inline-only storage")
                else:
                    require(parts and not embedded, "Native activity did not produce actual split-only storage")
                require((parts if parts else embedded) == expected,
                        "Physical native parts disagree with the supported normalized export")
                total_inline += len(embedded)
                total_split += len(parts)
            checks.append({"generation": generation, "session_id": session, "messages": len(selected),
                           "inline_parts": total_inline, "split_parts": total_split,
                           "exact_export_content_equal": True})
    return {"status": "PASS", "oracle": "isolated-stopped-host-read-only", "populations": checks,
            "split_configuration": "experimental.part_rows=true; not the 2.3.0 default"}


def assert_read_only_effects(observed: list[dict], readers: set[str], plans: list[dict]) -> dict:
    """A known caller is insufficient: reconcile each exact scripted invocation."""
    requests = [event["data"] for event in observed if event["type"] == "model-request"]
    require(requests and all(item.get("sessionID") in readers and item.get("agent") == "general"
            and item.get("model", {}).get("providerID") == "question-fixture" for item in requests),
            "Historical reading caused a non-reader or external model request")
    require(not any(event["type"] == "tool-before" and event["data"].get("tool") not in
                    ("execute", "loom_trace", "loom.trace", "loom_record", "loom.record") for event in observed),
            "Historical reading invoked an unexpected tool or native dispatch")
    require(not any(event["type"] == "native-event" and
                    (event["data"].get("type") in ("session.created", "session.synthetic")
                     or event["data"].get("data", {}).get("item", {}).get("type") == "synthetic")
                    for event in observed), "Historical reading created or resumed a recipient Session")
    require(not any(event["type"] == "provider-inputs" and event["data"].get("notices") for event in observed),
            "Historical reading generated a provider resume notice")
    for event in observed:
        if event["type"] == "tool-before" and event["data"].get("tool") in ("loom_record", "loom.record"):
            require(event["data"].get("input", {}).get("operation") == "query",
                    "Historical read phase mutated a Loom record")
    return {**assert_driver_invocations(observed, plans), "evaluator_dispatches": 0,
            "historical_recipient_requests": 0, "instruction_mutations": 0,
            "qualification": "local scripted provider only; genuine Evaluator reasoning remains UNPROVEN"}


class HistoricalScenario(ReviewScenario):
    def __init__(self, host, root):
        super().__init__(host, root)
        self.invocation_plan = None
        self.retrievals = []

    def begin(self, session, code, hold=None):
        job = self.add(code=code, hold=hold)
        if self.invocation_plan is not None:
            self.invocation_plan.append({"session_id": session, "job": job,
                                         "code_sha256": hashlib.sha256(code.encode()).hexdigest()})
        start = len(events(self.root))
        self.submit(session, job)
        return job, start

    def read(self, actor, tool, query, label):
        start = len(events(self.root))
        began = time.monotonic()
        value = self.invoke(actor, tool, query)
        elapsed = time.monotonic() - began
        observed = events(self.root)[start:]
        before = [event for event in observed if event["type"] == "tool-before"
                  and event["data"].get("tool") in ("loom_" + tool, "loom." + tool)]
        after = [event for event in observed if event["type"] == "tool-after"
                 and event["data"].get("tool") in ("loom_" + tool, "loom." + tool)]
        require(len(before) == len(after) == 1 and call_key(before[0]["data"]) is not None
                and call_key(before[0]["data"]) == call_key(after[0]["data"]),
                "Registered read receipt does not bind one exact native call")
        content = after[0]["data"]["result"]["content"]
        returned_text = content if isinstance(content, str) else "\n".join(
            part["text"] for part in content if part["type"] == "text")
        size = len(returned_text.encode())
        require(size <= MAX_RESPONSE_BYTES, "Registered evidence response exceeds its public bound")
        require(after[0]["at"] >= before[0]["at"], "Native receipt clock reversed; latency unavailable")
        if tool == "trace":
            namespace = value.get("namespace", {})
            require(isinstance(namespace.get("project_id"), str) and "workspace_id" in namespace
                    and namespace.get("native_store_identity") == "unavailable",
                    "Native evidence omitted its namespace or invented a store identity")
        self.retrievals.append({"label": label, "tool": tool, "query": query, "result": value,
                                "response_bytes": size, "tool_latency_ms": after[0]["at"] - before[0]["at"],
                                "driver_elapsed_ms": round(elapsed * 1000, 3)})
        return value

    def denied(self, actor, tool, query, reason=None):
        code = ("let rejected=false;try{await tools.loom." + tool + "(" + encoded(query)
                + ")}catch(error){rejected=true;}if(!rejected)throw new Error('Expected evidence denial');return 'denied';")
        receipts = self.command(actor, code)
        calls = [event for event in receipts if event["type"] == "tool-after"
                 and event["data"].get("tool") in ("loom_" + tool, "loom." + tool)]
        require(len(calls) == 1 and calls[0]["data"].get("status") == "error", "Missing registered evidence denial")
        if reason:
            require(reason in encoded(calls[0]["data"]), "Evidence denial had an unexpected reason")
        return calls[0]["data"]


def run(args) -> dict:
    repo, output = args.repository.resolve(), args.report_directory.resolve()
    output.mkdir(parents=True, exist_ok=False, mode=0o700)
    report = {"format": "loom-installed-historical-evidence/v1", "status": "UNPROVEN", "checks": [],
              "expected_host": HOST, "inspected_upstream_revision": UPSTREAM,
              "genuine_evaluator": "UNPROVEN", "protected_raw_release": "UNQUALIFIED-WITHHELD",
              "concurrent_revocation_fence": "UNQUALIFIED", "private_operator_originals": "NOT-ACCESSED",
              "storage_generation": {"status": "UNPROVEN", "reason": "physical oracle not completed"},
              "limitations": [
                  "Synthetic authored claims and native mechanics only; no private CI/Git originals were reproduced.",
                  "Export authenticity and completeness remain unverified in Loom, even for independently checked fixture bytes.",
                  "Native parentage, imported dispatch references and common Git revisions do not establish objective participation.",
                  "Revocation is exercised between retrievals; stale pending approval and atomic policy/return fencing remain unqualified.",
                  "Only this route's calls, UTF-8 response bytes and latency are measured; no baseline or token-cost saving is claimed.",
                  "Current activity explicitly enables experimental.part_rows=true; default OpenCode 2.3.0 storage is not inferred.",
              ]}
    host = None
    temporary_root = None
    try:
        require(args.opencode is not None and args.opencode.is_file(), "Pinned installed OpenCode executable missing")
        report.update(verify_candidate(args, repo))
        report["input_sha256"] = {name: sha(repo / name) for name in (
            "tests/installed_historical_evidence.py", "tests/installed_native_review.py", "tests/native_review_oracle.py",
            "tests/installed_learning_stage4.py", "tests/installed_questions.py", "tests/installed_host_smoke.py",
            "tests/installed_instruction_variants.py", "tests/question-host/server.ts", "tests/question-host/provider.mjs",
            "tests/question-host/review-script.ts", "package.json", "bun.lock", ".bun-version")}
        report["cli_sha256"] = sha(args.opencode.resolve())
        with tempfile.TemporaryDirectory(prefix="loom-installed-historical-") as temporary:
            root = Path(temporary).resolve()
            temporary_root = root
            project = root / "project"
            project.mkdir()
            env = isolated_environment(root)
            env["LOOM_QUESTION_FIXTURE"] = str(root)
            database = root / "data" / "fixture-native.db"
            env["OPENCODE_DB"] = str(database)
            if args.disable_filewatcher:
                env["OPENCODE_FILEWATCHER_DISABLE"] = "1"
                report["filewatcher"] = "disabled; watcher behavior UNPROVEN"
            report["host_version"] = subprocess.check_output(
                [str(args.opencode.resolve()), "--version"], env=env, text=True, timeout=15).strip()
            verify_host_version(report["host_version"])
            allow = [{"action": "*", "resource": "*", "effect": "allow"}]
            config = {"plugins": ["*", str(args.plugin.resolve()), str(repo / "tests/question-host")],
                      "agents": {name: {"description": "Synthetic historical evidence fixture",
                          "mode": mode, "system": "Execute only the local scripted fixture job.",
                          "model": "question-fixture/reader", "permissions": allow}
                          for name, mode in (("general", "primary"), ("reviewer", "subagent"))},
                      "model": "question-fixture/reader", "experimental": {"part_rows": True},
                      "update": "disable", "share": "disabled"}
            (Path(env["OPENCODE_CONFIG_DIR"]) / "opencode.json").write_text(encoded(config))
            (project / ".loom.yaml").write_text("instructions: {enabled: false}\nledger: {capture: automatic}\n")
            (root / "jobs.json").write_text("{}")
            (project / "synthetic.txt").write_text("Synthetic unchanged fixture revision; no actual CI or GitHub evidence.\n")
            subprocess.run(["git", "init", "-q", str(project)], env=env, check=True, timeout=10)
            subprocess.run(["git", "-C", str(project), "add", "synthetic.txt"], env=env, check=True, timeout=10)
            subprocess.run(["git", "-C", str(project), "-c", "user.name=Historical Fixture", "-c",
                            "user.email=fixture@invalid", "commit", "-qm", "Synthetic fixture revision"],
                           env=env, check=True, timeout=10)
            report["synthetic_git_head"] = subprocess.check_output(
                ["git", "-C", str(project), "rev-parse", "HEAD"], env=env, text=True).strip()

            def check(name, **evidence):
                require(name in CHECKS and name not in {item["name"] for item in report["checks"]},
                        "Duplicate or unexpected historical evidence check")
                report["checks"].append({"name": name, "status": "PASS", **evidence})
                print("PASS " + name, flush=True)

            with audit_session(root) as audit:
                try:
                    host = PrivateHost(str(args.opencode.resolve()), project, env, output, "historical")
                    require(json.loads(host.get("/api/info", "info")).get("version") == HOST, "Wrong actual native host version")
                    host.wait_roster("/api/plugin", "plugins", lambda rows: all(any(
                        row.get("id") == name and row.get("state", {}).get("status") == "active" for row in rows)
                        for name in ("loom", "loom.question.fixture")))
                    scenario = HistoricalScenario(host, root)
                    parent, reader, second_reader = [scenario.create() for _ in range(3)]
                    owned = {parent, reader, second_reader}
                    action = scenario.invoke(parent, "action", {"operation": "create", "title": "Synthetic bounded restore trajectory",
                        "goal": "Preserve original failure, unchanged rerun, correction and distinct verification scopes."})
                    claims = [
                        ("result", None, "SYNTHETIC_ORIGINAL_FAILURE: /coarse refresh returned false; /windows passed. Indexed row and watcher order are unproven."),
                        ("qa", "pass", "SYNTHETIC_UNCHANGED_RERUN: both named subtests passed on unchanged code; the earlier failure remains evidence."),
                        ("result", None, "SYNTHETIC_CORRECTION: one test file distinguishes an old indexed row from a controlled replacing update."),
                        ("assessment", "pass", "SYNTHETIC_CORRECTED_VERIFICATION: both named subtests passed on corrected head; authored fixture claim, not external proof."),
                        ("qa", "pass", "SYNTHETIC_RACE_SCOPE: separate race job reports suite success only; watcher-first explanation remains plausible and unproven."),
                    ]
                    records, dispatches = [], []
                    for indices in ((0,), (1,), (2,), (3, 4)):
                        script = []
                        for index in indices:
                            kind, verdict, statement = claims[index]
                            query = {"operation": "add", "action_id": action["id"], "kind": kind, "statement": statement,
                                     "evidence_ids": [], "artifact_refs": [f"fixture://historical/artifact-{index}"]}
                            if verdict:
                                query["verdict"] = verdict
                            script.append("await tools.loom.record(" + encoded(query) + ")")
                        start = len(events(root))
                        receipt = scenario.dispatch(parent, scenario.add(code="return [" + ",".join(script) + "]"))
                        dispatches.append(receipt)
                        child = receipt["child_session_id"]
                        owned.add(child)
                        created = [result_value(event) for event in events(root)[start:] if event["type"] == "tool-after"
                                   and event["data"].get("sessionID") == child
                                   and event["data"].get("tool") in ("loom_record", "loom.record")
                                   and event["data"].get("status") == "completed"]
                        require(len(created) == len(indices), "Native child did not author the exact planned records")
                        for index, record in zip(indices, created):
                            require(record["session_id"] == child and record["data"]["statement"] == claims[index][2]
                                    and record["data"]["evidence_ids"] == [], "Authored source identity or evidence links changed")
                        records.extend(created)
                    children = [item["child_session_id"] for item in dispatches]
                    fillers = []
                    for _ in range(DIRECT_CHILDREN - len(children)):
                        session = request(host, "POST", "/api/session", {"parentID": parent, "agent": "reviewer",
                            "title": "Unrelated synthetic Session at the same Git revision", "model": {"providerID": "question-fixture", "id": "reader"},
                            "location": {"directory": str(project)}})["id"]
                        owned.add(session)
                        fillers.append(session)
                    grandchildren = [request(host, "POST", "/api/session", {"parentID": fillers[0], "agent": "reviewer",
                        "title": "Synthetic grandchild", "location": {"directory": str(project)}})["id"] for _ in range(3)]
                    owned.update(grandchildren)
                    idle(host, [parent, *children])
                    originals = {session: native_export(host, owned, session) for session in (parent, *children)}
                    inline = import_inline_control(host, owned, project, originals[parent])
                    imported = inline["info"]["id"]
                    originals[imported] = inline
                    export_files = {}
                    for label, exported in (("split", originals[parent]), ("inline", inline)):
                        path = project / (label + "-evidence.json")
                        path.write_text(encoded(exported) + "\n")
                        path.chmod(0o600)
                        export_files[label] = path
                    report["fixture"] = {"parent": parent, "reader": reader, "second_reader": second_reader,
                        "participating_children": children, "direct_children": DIRECT_CHILDREN, "grandchildren": grandchildren,
                        "same_revision_nonparticipant": fillers[0], "action": action["id"], "record_ids": [item["id"] for item in records],
                        "dispatches": dispatches, "imported_control": imported,
                        "authored_support": "five claims with empty evidence_ids; no objective registration or Loom assignment/delivery"}
                    read_start = len(events(root))
                    scenario.invocation_plan = []

                    sessions, pages, cursor = [], [], None
                    for _ in range(10):
                        query = {"operation": "children", "access": "historical", "session_id": parent, "limit": 50}
                        if cursor:
                            query["cursor"] = cursor
                        page = scenario.read(reader, "trace", query, "historical-children")
                        require(page["coverage"] == {"direct_children": True, "recursive": False, "snapshot": False}
                                and "scanned" not in page, "Historical page widened its structural or snapshot claim")
                        sessions.extend(item["id"] for item in page["sessions"])
                        pages.append(page)
                        cursor = page["next_cursor"]
                        if cursor is None:
                            break
                    require(cursor is None and len(sessions) == len(set(sessions)) == DIRECT_CHILDREN
                            and set(sessions) == set(children + fillers), "Bounded traversal omitted or duplicated direct children")
                    require(all(item["objective_participation"] == "not-established"
                                for page in pages for item in page["sessions"]), "Parentage became objective membership")
                    descendants = scenario.read(reader, "trace", {"operation": "children", "access": "historical",
                        "session_id": fillers[0], "limit": 50}, "explicit-selected-descendants")
                    require({item["id"] for item in descendants["sessions"]} == set(grandchildren), "Explicit descendant inventory changed")
                    check("historical-complete-direct-child-traversal", children=len(sessions), pages=len(pages), grandchildren=3)

                    projected = []
                    for child in children:
                        after = 0
                        for _ in range(3):
                            page = scenario.read(reader, "record", {"operation": "query", "projection": "metadata",
                                "action_id": action["id"], "source_session_id": child, "record_kinds": ["result", "qa", "assessment"],
                                "after": after, "limit": 1}, "record-source-metadata")
                            require(isinstance(page.get("source_store_id"), str), "Record projection omitted its namespace identity")
                            require(all(item["session_id"] == child and "data" not in item and item["evidence_count"] == 0
                                        for item in page["items"]), "Metadata query leaked bodies, widened Session scope or invented support")
                            projected.extend(page["items"])
                            if page["next_after"] is None:
                                break
                            require(page["next_after"] > after, "Record sequence continuation failed to advance")
                            after = page["next_after"]
                        else:
                            raise RuntimeError("Bounded record traversal failed to terminate")
                    require({item["id"] for item in projected} == {item["id"] for item in records}
                            and len(projected) == 5, "Four selected Sessions did not resolve the exact five authored records")
                    through = max(item["sequence"] for item in projected)
                    for original in records:
                        page = scenario.read(reader, "record", {"operation": "query", "projection": "fields", "fields": ["statement", "evidence_ids"],
                            "record_id": original["id"], "source_session_id": original["session_id"], "action_id": action["id"],
                            "through": through}, "exact-record-fields")
                        require(len(page["items"]) == 1 and page["items"][0]["data"] == {
                            key: original["data"][key] for key in ("statement", "evidence_ids")}, "Exact field projection changed or widened the original")
                    empty = scenario.read(reader, "record", {"operation": "query", "projection": "metadata", "action_id": action["id"],
                        "source_session_id": fillers[0], "record_kinds": ["result", "qa", "assessment"]}, "unrelated-same-revision-control")
                    require(empty["items"] == [], "Same-revision nonparticipant inherited Action source records")
                    check("exact-five-records-four-source-sessions", records=5, source_sessions=4, through=through)

                    inventories = {}
                    for label, session in (("split", parent), ("inline", imported)):
                        items, cursor = [], None
                        for _ in range(5):
                            query = {"operation": "parts", "session_id": session, "export_path": export_files[label].name,
                                     "tool": "subagent", "limit": 2}
                            if cursor:
                                query["cursor"] = cursor
                            page = scenario.read(reader, "trace", query, label + "-native-parts")
                            require(page["coverage"]["authenticity"] == "provided-export-unverified"
                                    and page["coverage"]["full_history"] is None and page["coverage"]["location_verified"] is True,
                                    "Provided export was presented as authenticated or complete history")
                            require(page["source_sha256"] == sha(export_files[label]), "Native source hash did not pin exact supplied bytes")
                            require(not any(claim[2] in encoded(page) for claim in claims), "Native metadata exposed authored body content")
                            items.extend(page["items"])
                            inventories.setdefault(label, page)
                            cursor = page["next_cursor"]
                            if cursor is None:
                                break
                        require(cursor is None and len(items) == 4, "Native dispatch inventory omitted or duplicated exact parts")
                        found = []
                        native = tool_parts(originals[session])
                        for item in items:
                            source = scenario.read(reader, "trace", {"operation": "source", "session_id": session,
                                "export_path": export_files[label].name, "message_id": item["message_id"], "part_id": item["part_id"],
                                "fields": ["status", "dispatch"], "source_sha256": page["source_sha256"], "part_sha256": item["part_sha256"]},
                                label + "-exact-native-dispatch")
                            original = native[(item["message_id"], item["part_id"])]
                            require(source["status"] == "resolved" and source["fields"] == {
                                "status": original["state"]["status"], "dispatch": {"session_id": original["state"]["metadata"]["sessionID"],
                                "source_field": "state.metadata.sessionID"}}, "Exact native dispatch projection disagrees with the source owner")
                            found.append(source["fields"]["dispatch"]["session_id"])
                        require(set(found) == set(children), "Exact native dispatch references changed child identity")
                    structural = scenario.read(reader, "trace", {"operation": "parts", "session_id": parent,
                        "export_path": export_files["split"].name, "match": children[0]}, "structural-dispatch-match")
                    require(len(structural["items"]) == 1 and set(structural["matching"]["fields"]) == {"tool", "status", "dispatch"},
                            "Default matching did not select only projected structural fields")
                    body_control = scenario.read(reader, "trace", {"operation": "parts", "session_id": parent,
                        "export_path": export_files["split"].name, "match": "LOOM_HARNESS_JOB:"}, "structural-body-sentinel-control")
                    require(body_control["items"] == [], "Default structural matching inspected native input bodies")
                    check("native-dispatch-projection-and-source-pins", split_parts=4, inline_parts=4,
                          imported_dispatch="stored transcript references only; no imported-Session dispatch attestation")

                    marker = "SYNTHETIC_OWN_ORIGINAL_" + secrets.token_hex(12)
                    scenario.command(reader, "return " + json.dumps(marker))
                    own = scenario.read(reader, "trace", {"operation": "parts", "tool": "execute", "match": marker,
                        "match_fields": ["output"], "limit": 50}, "own-context-explicit-body-match")
                    require(len(own["items"]) == 1, "Own-context matching did not find one exact original output")
                    item = own["items"][0]
                    exact = {"operation": "source", "message_id": item["message_id"], "part_id": item["part_id"],
                             "fields": ["output"], "part_sha256": item["part_sha256"]}
                    original = scenario.read(reader, "trace", exact, "own-context-part-pin-after-append")
                    current = tool_parts(native_export(host, owned, reader))[(item["message_id"], item["part_id"])]
                    require(original["status"] == "resolved" and original["fields"]["output"] == current["state"]["content"]
                            and marker in encoded(original["fields"]["output"])
                            and original["source_sha256"] != own["source_sha256"], "Exact part pin failed after legitimate context append")
                    changed = scenario.read(reader, "trace", {**exact, "part_sha256": "0" * 64}, "own-context-wrong-part-pin")
                    require(changed["status"] == "changed" and changed["fields"] == {}, "Wrong part pin substituted an original")
                    missing = scenario.read(reader, "trace", {**exact, "part_id": "missing_fixture_part"}, "own-context-missing-exact-source")
                    require(missing["status"] == "missing" and missing["fields"] == {}, "Missing exact tuple substituted another part")
                    check("own-context-exact-original-and-part-pin", source_messages_changed=True, exact_original_equal=True)

                    target = inventories["split"]["items"][0]
                    cross = {"operation": "source", "session_id": parent, "message_id": target["message_id"], "part_id": target["part_id"], "fields": ["output"]}
                    scenario.denied(reader, "trace", cross, "unsupported-source-release")
                    scenario.denied(reader, "trace", {**cross, "export_path": export_files["split"].name}, "unsupported-source-release")
                    scenario.denied(reader, "trace", {"operation": "parts", "session_id": parent, "export_path": export_files["split"].name,
                        "match": "LOOM_HARNESS_JOB:", "match_fields": ["input"]}, "unsupported-source-release")
                    check("cross-session-and-export-raw-release-blocked", raw_reads=2, body_matching=1)

                    def policy(resource):
                        rules = allow + [{"action": "read", "resource": resource, "effect": "deny"}]
                        request(host, "PATCH", f"/api/session/{reader}", {"permissions": rules})
                        require(request(host, "GET", f"/api/session/{reader}").get("permissions") == rules,
                                "Native reader policy did not retain the exact revocation")

                    children_query = {"operation": "children", "access": "historical", "session_id": parent, "limit": 50}
                    parts_query = {"operation": "parts", "session_id": parent, "export_path": export_files["split"].name, "tool": "subagent"}
                    for resource, query in (
                        (f"loom:evidence:discover:session:{parent}", children_query),
                        (f"loom:evidence:disclose:session:{parent}:view:native-parts:recipient:{reader}", parts_query),
                        (f"loom:evidence:inspect:session:{parent}:view:native-dispatch", {**parts_query, "match": children[0]}),
                        (str(export_files["split"]), parts_query),
                    ):
                        policy(resource)
                        denial = scenario.denied(reader, "trace", query)
                        require(not any(child in encoded(denial.get("result", {})) for child in children),
                                "Revoked read disclosed protected child identities")
                        request(host, "PATCH", f"/api/session/{reader}", {"permissions": allow})
                    restored = scenario.read(reader, "trace", parts_query, "policy-restored-structural-read")
                    require(len(restored["items"]) == 4, "Policy restoration did not restore authorized structural reading")
                    check("revoked-discovery-inspection-disclosure-and-file-read-denied", revocations=4, timing="between completed retrievals")

                    scenario.denied(second_reader, "trace", {**children_query, "cursor": pages[0]["next_cursor"]}, "cursor")
                    scenario.denied(reader, "trace", {**children_query, "session_id": imported, "cursor": pages[0]["next_cursor"]}, "cursor")
                    saved = export_files["split"].read_bytes()
                    export_files["split"].write_bytes(saved + b"\n")
                    scenario.denied(reader, "trace", {**parts_query, "limit": 2, "cursor": inventories["split"]["next_cursor"]}, "cursor")
                    changed = scenario.read(reader, "trace", {"operation": "source", "session_id": parent,
                        "export_path": export_files["split"].name, "message_id": target["message_id"], "part_id": target["part_id"],
                        "fields": ["status"], "source_sha256": inventories["split"]["source_sha256"]}, "changed-export-exact-source")
                    require(changed["status"] == "changed" and changed["fields"] == {}, "Changed export substituted an original")
                    export_files["split"].write_bytes(saved + b"\xff")
                    scenario.denied(reader, "trace", parts_query, "UTF-8")
                    export_files["split"].write_bytes(saved)
                    check("source-change-and-cursor-scope-denied", recipient_and_parent_bound=True,
                          changed_export_withheld=True, invalid_utf8_rejected=True, hash_pins="original file bytes")

                    for session, before in originals.items():
                        require(native_export(host, owned, session) == before, "Historical native Session changed during evidence retrieval")
                    read_receipts = events(root)[read_start:]
                    effects = assert_read_only_effects(read_receipts, {reader, second_reader}, scenario.invocation_plan)
                    require(not any(event["type"] == "model-request" and event["data"].get("agent") == "evaluator"
                                    for event in events(root)), "Fixture unexpectedly invoked an Evaluator")
                    check("historical-sources-unchanged-and-no-evaluator-effects", historical_sources=len(originals), **effects)
                    report["expected_driver_invocations"] = scenario.invocation_plan
                    report["retrieval_metrics"] = {"successful_registered_reads": len(scenario.retrievals),
                        "returned_tool_text_bytes": sum(item["response_bytes"] for item in scenario.retrievals),
                        "registered_tool_latency_ms": sum(item["tool_latency_ms"] for item in scenario.retrievals),
                        "driver_elapsed_ms": round(sum(item["driver_elapsed_ms"] for item in scenario.retrievals), 3),
                        "maximum_response_bytes": max(item["response_bytes"] for item in scenario.retrievals),
                        "negative_control_calls": sum(event["type"] == "tool-after" and event["data"].get("status") == "error"
                            and event["data"].get("tool") in ("loom_trace", "loom.trace", "loom_record", "loom.record") for event in read_receipts),
                        "cost_claim": "No reliable token-cost estimate or baseline reduction is asserted."}
                    (output / "retrievals.json").write_text(json.dumps(scenario.retrievals, indent=2) + "\n")
                    (output / "retrievals.json").chmod(0o600)
                    for label, exported in (("split", originals[parent]), ("inline", inline)):
                        (output / (label + "-source.json")).write_text(encoded(exported) + "\n")
                        (output / (label + "-source.json")).chmod(0o600)
                    host.close()
                    host = None
                    try:
                        generation = physical_generation_oracle(database, originals[parent], inline)
                    except Exception as error:
                        report["storage_generation"] = {"status": "UNPROVEN", "reason": f"{type(error).__name__}: {error}"}
                        raise
                    report["storage_generation"] = generation
                    check("native-inline-and-split-export-normalization", **{key: value for key, value in generation.items() if key != "status"})
                    require({item["name"] for item in report["checks"]} == CHECKS, "Historical qualification omitted required checks")
                    report["status"] = "PASS"
                finally:
                    if host:
                        host.close()
                        host = None
                    try:
                        snapshot = audit.finalize(output / "audit.ndjson")
                        report["audit"] = {"sha256": snapshot.sha256, "bytes": snapshot.byte_count, "events": len(snapshot.events)}
                    except Exception as error:
                        report["status"] = "FAIL"
                        report["audit_error"] = f"{type(error).__name__}: {error}"
    except Exception as error:
        report["status"] = "FAIL"
        report["error"] = f"{type(error).__name__}: {error}"
    finally:
        report["cleanup"] = {"private_host_stopped": host is None or host.proc.poll() is not None,
                             "disposable_root_removed": temporary_root is None or not temporary_root.exists()}
        (output / "report.json").write_text(json.dumps(report, indent=2) + "\n")
        (output / "report.json").chmod(0o600)
    return report


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--opencode", type=Path, default=Path(shutil.which("opencode")) if shutil.which("opencode") else None)
    parser.add_argument("--repository", type=Path, default=Path(__file__).resolve().parents[1])
    parser.add_argument("--plugin", type=Path, required=True)
    parser.add_argument("--artifact", type=Path, required=True)
    parser.add_argument("--expect-plugin-version", default="2.0.0-alpha.1")
    parser.add_argument("--expect-head", required=True)
    parser.add_argument("--report-directory", type=Path, required=True)
    parser.add_argument("--disable-filewatcher", action="store_true")
    report = run(parser.parse_args())
    print(json.dumps({key: report.get(key) for key in ("status", "source_head", "error", "checks", "limitations")}))
    raise SystemExit({"PASS": 0, "FAIL": 1, "UNPROVEN": 2}[report["status"]])


if __name__ == "__main__":
    main()
