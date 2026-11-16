"""Installed Stage 4 preparation mechanics, with no Evaluator dispatch.

The exact packed Loom candidate owns every request, review intent and reader.
An isolated local scripted provider invokes real native tools; it does not
produce an interpretation, replace a source owner or attest Q4/Q5. The fixture
creates synthetic authored fail/fail/pass evidence, not real engineering work.
"""
from __future__ import annotations

import argparse
from contextlib import closing
import hashlib
import json
from pathlib import Path
import shutil
import sqlite3
import subprocess
import tempfile
import time

from installed_host_smoke import (
    PrivateHost, installed_plugin_inventory, isolated_environment, require,
)
from installed_instruction_variants import verify_host_version
from installed_learning_stage3 import make_session, report_result, until
from installed_questions import Scenario, audit_session, events, final_events, request


HOST = "2.2.6"
CHECKS = {
    "S4-native-authored-whole-objective-source-preparation",
    "S4-native-stable-request-review-and-issue-replay",
    "S4-native-bounded-complete-membership-readback",
    "S4-native-foreign-and-revoked-readers-denied",
    "S4-native-wrong-identity-checksum-and-cursor-denied",
    "S4-native-restart-preserves-preparation-and-stage3",
    "S4-native-mutated-original-withholds-dependent-preparation",
    "S4-native-no-evaluator-dispatch-or-instruction-mutation",
}
IDENTITY_FIELDS = (
    "batch_id", "request_id", "review_request_id", "method_id", "manifest_sha256",
)
PUBLIC_READ_CHARS = 262144


def sha(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def encoded(value) -> str:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


def synthetic_method() -> dict:
    def content(name):
        return {"locator": "fixture://stage4/" + name,
                "sha256": hashlib.sha256(("synthetic:" + name).encode()).hexdigest()}

    def policy(name):
        return {"id": "fixture-" + name, "revision": "1", "sha256": content(name)["sha256"]}

    return {
        "format": "loom-evaluator-method/v1",
        "evaluator": {"agent": "evaluator", "definition": content("evaluator")},
        "audit_skill": {"skill": "agent-run-audit", "definition": content("agent-run-audit")},
        "rubric": content("rubric"), "instruction_bundle": content("instruction-bundle"),
        "result_format": "loom-evaluator-interpretation/v1",
        "model": {"provider_id": "question-fixture", "model_id": "reader",
                  "settings": content("settings")},
        "adapter": {"id": "fixture-unqualified", "version": "1", "profile": policy("profile")},
        "source_policy": policy("source-policy"), "route_policy": policy("route-policy"),
    }


def seed_trajectory(scenario: Scenario, owner: str) -> dict:
    anchor = scenario.invoke(owner, "record", {
        "operation": "add", "session_only": True, "kind": "result",
        "statement": "Synthetic original goal: deliver one corrected feature, not three independent successes.",
    })
    objective = scenario.invoke(owner, "objective", {
        "operation": "create", "source_type": "ledger-record", "source_id": anchor["id"],
        "unit_key": "stage4-fixture-objective", "label": "Synthetic fail/fail/pass trajectory",
    })
    action = scenario.invoke(owner, "action", {
        "operation": "create", "title": "Synthetic Stage 4 source fixture",
        "goal": "Retain one objective's authored correction history without evaluating it.",
    })
    links, verification_records, previous = [], [], None
    for number, verdict in enumerate(("fail", "fail", "pass"), 1):
        if previous is not None:
            correction = scenario.invoke(owner, "record", {
                "operation": "add", "session_only": True, "kind": "result",
                "statement": f"Synthetic corrective attempt {number} responds to the previous failed check.",
            })
            link = scenario.invoke(owner, "objective", {
                "operation": "link", "objective_id": objective["id"],
                "phase": "corrective-dispatch", "source_type": "ledger-record",
                "source_id": correction["id"], "related_sequence": previous,
                "note": "Authored fixture relation; no native Evaluator or Coder was dispatched.",
            })
            links.append(link)
        handback = scenario.invoke(owner, "record", {
            "operation": "add", "session_only": True, "kind": "result",
            "statement": f"Synthetic attempt {number} reports DONE; this statement does not prove correctness.",
        })
        handback_link = scenario.invoke(owner, "objective", {
            "operation": "link", "objective_id": objective["id"], "phase": "handback",
            "source_type": "ledger-record", "source_id": handback["id"],
            "assessment": "reported-done",
        })
        links.append(handback_link)
        verification = scenario.invoke(owner, "record", {
            "operation": "add", "kind": "qa", "action_id": action["id"], "verdict": verdict,
            "statement": f"Synthetic authored verification {number}: {verdict}; mechanics fixture only.",
        })
        verification_records.append(verification["id"])
        check = scenario.invoke(owner, "objective", {
            "operation": "link", "objective_id": objective["id"], "phase": "verification",
            "source_type": "ledger-record", "source_id": verification["id"],
            "related_sequence": handback_link["sequence"], "assessment": verdict,
        })
        links.append(check)
        previous = check["sequence"]
    links.append(scenario.invoke(owner, "objective", {
        "operation": "link", "objective_id": objective["id"], "phase": "outcome",
        "source_type": "ledger-record", "source_id": verification_records[-1],
        "related_sequence": previous, "assessment": "pass",
        "note": "One authored eventual outcome; neither native verification proof nor genuine reasoning.",
    }))
    original = scenario.invoke(owner, "objective", {
        "operation": "read", "objective_id": objective["id"], "limit": 50,
    })
    require(original["next_cursor"] is None, "Synthetic trajectory exceeded the complete source read")
    entries = original["entries"]
    require([entry["assessment"] for entry in entries if entry["phase"] == "verification"]
            == ["fail", "fail", "pass"], "Native authored verification sequence changed")
    for phase, count in (("request", 1), ("handback", 3), ("corrective-dispatch", 2), ("outcome", 1)):
        require(sum(entry["phase"] == phase for entry in entries) == count,
                "Native source trajectory has the wrong " + phase + " count")
    return {"anchor": anchor["id"], "objective": objective["id"],
            "links": [str(link["sequence"]) for link in links], "verification_records": verification_records}


def members(scenario: Scenario, owner: str, query: dict) -> tuple[list, list]:
    items, pages, after = [], [], 0
    for _ in range(200):
        page = scenario.invoke(owner, "insights", {**query, "after": after, "limit": 1})
        require(len(encoded(page)) <= PUBLIC_READ_CHARS, "Native membership page exceeds canonical character allowance")
        require(page["items"], "Successful membership page omitted frozen content")
        if query["operation"] == "evaluation-preparation-members":
            for field in ("request_id", "manifest_sha256"):
                require(page[field] == query[field], "Preparation continuation changed " + field)
        for member in page["items"]:
            require(member["ordinal"] > after, "Membership continuation did not preserve immutable ordinals")
            items.append({key: member[key] for key in ("key", "kind", "ordinal", "source_refs")})
        pages.append(page)
        if page["next_after"] is None:
            require(len({item["key"] for item in items}) == len(items), "Membership repeated a frozen subject")
            return items, pages
        require(isinstance(page["next_after"], int) and page["next_after"] > after,
                "Membership cursor failed to advance")
        after = page["next_after"]
    raise RuntimeError("Native membership reconstruction exceeded its bounded page count")


def denied(scenario: Scenario, actor: str, tool: str, query: dict) -> list:
    code = ("let rejected=false;try{await tools.loom." + tool + "(" + encoded(query)
            + ")}catch(error){rejected=true;}if(!rejected)throw new Error("
            + json.dumps("Expected native rejection for " + str(query.get("operation")))
            + ");return 'denied';")
    receipts = scenario.command(actor, code)
    calls = [event for event in receipts if event["type"] == "tool-after"
             and event["data"].get("tool") in ("loom_" + tool, "loom." + tool)]
    require(len(calls) == 1 and calls[0]["data"].get("status") == "error",
            "Missing actual native denial for " + str(query.get("operation")))
    return calls


def identity(value: dict) -> dict:
    result = {field: value[field] for field in IDENTITY_FIELDS}
    require(all(isinstance(item, str) and item for item in result.values()),
            "Preparation returned an incomplete stable identity")
    result["attempt_id"] = value["issue"]["attempt"]["attempt_id"]
    return result


def assert_unissued(value: dict):
    require(value["state"] == "prepared" and value["mode"] == "preparation-only",
            "Native preparation claimed evaluation or execution")
    attempt = value["issue"]["attempt"]
    require(attempt["state"] == "prepared" and attempt["native_outcome"] == "not-issued"
            and attempt["claimant_id"] is None and attempt["claimed_at"] is None,
            "Preparation consumed or invented a model-effect permit")
    require(attempt["native_binding"]["status"] == "unknown",
            "Local preparation upgraded native execution provenance")


def preparation_snapshot(learning: Path, ledger: Path) -> dict:
    """Read-only oracle: rejected native inputs cannot add or change durable effects."""
    result = {}
    for path, tables in (
        (learning, ("learning_evaluator_methods", "learning_evaluator_requests")),
        (ledger, ("review_requests", "review_issue_intents", "review_issue_outcomes")),
    ):
        with closing(sqlite3.connect(path.as_uri() + "?mode=ro", uri=True)) as db:
            db.execute("PRAGMA query_only=ON")
            for table in tables:
                result[table] = db.execute("SELECT * FROM " + table + " ORDER BY 1").fetchall()
            if path == learning:
                scope = ("evaluator-preparation/calling-session",)
                result["preparation_batches"] = db.execute(
                    "SELECT * FROM learning_evaluation_batches WHERE scope_key=? ORDER BY id", scope).fetchall()
                result["preparation_members"] = db.execute(
                    "SELECT * FROM learning_evaluation_members WHERE batch_id IN "
                    "(SELECT id FROM learning_evaluation_batches WHERE scope_key=?) ORDER BY batch_id,ordinal", scope).fetchall()
    return result


def run(args) -> dict:
    repo, output = args.repository.resolve(), args.report_directory.resolve()
    output.mkdir(parents=True, exist_ok=False, mode=0o700)
    result = {
        "format": "loom-installed-stage4-preparation/v1", "status": "UNPROVEN",
        "genuine_evaluator": "UNPROVEN", "e11": "UNPROVEN", "q4": "UNQUALIFIED", "q5": "UNQUALIFIED",
        "model_spending": "LOCAL_SCRIPTED_PROVIDER_ONLY", "checks": [],
        "limitations": [
            "Synthetic authored fail/fail/pass evidence; no original engineering corpus or real Evaluator reasoning.",
            "Method content and policy references are declared fixture inputs, not installed definitions or authority.",
            "No native review/source-exposure binding, protected transfer or provider/account eligibility qualified.",
            "Restart proves preparation recovery; no model effect, budget reservation or uncertain admission occurred.",
            "The only direct database write is the explicit stopped-host original-source corruption negative control.",
        ],
    }
    host = None
    try:
        require(args.opencode is not None and args.opencode.is_file(), "Pinned installed OpenCode binary missing")
        result["source_head"] = subprocess.check_output(["git", "-C", str(repo), "rev-parse", "HEAD"], text=True).strip()
        require(result["source_head"] == args.expect_head, "Installed Stage 4 source differs from exact reviewed head")
        require(not subprocess.check_output(["git", "-C", str(repo), "status", "--porcelain"], text=True).strip(),
                "Installed Stage 4 qualification requires a clean exact source candidate")
        result["candidate"] = installed_plugin_inventory(
            args.artifact.resolve(), args.plugin.resolve(), args.expect_plugin_version, HOST)
        runtime = [repo / "server.ts", *[path for path in (repo / "src").rglob("*") if path.is_file()]]
        require(all((args.plugin / path.relative_to(repo)).is_file()
                    and sha(path) == sha(args.plugin / path.relative_to(repo)) for path in runtime),
                "Installed runtime differs from the exact checked-in candidate")
        result["runtime_files_checked"] = len(runtime)
        result["input_sha256"] = {name: sha(repo / name) for name in (
            "tests/installed_learning_stage4.py", "tests/installed_learning_stage3.py", "tests/installed_questions.py",
            "tests/installed_host_smoke.py", "tests/installed_instruction_variants.py",
            "tests/question-host/server.ts", "tests/question-host/provider.mjs", "tests/question-host/review-script.ts",
            "package.json", "bun.lock", ".bun-version",
        )}
        result["cli_sha256"] = sha(args.opencode.resolve())
        with tempfile.TemporaryDirectory(prefix="loom-installed-stage4-") as temporary:
            root = Path(temporary).resolve()
            project = root / "project"
            project.mkdir()
            env = isolated_environment(root)
            env["LOOM_QUESTION_FIXTURE"] = str(root)
            if args.disable_filewatcher:
                env["OPENCODE_FILEWATCHER_DISABLE"] = "1"
                result["filewatcher"] = "disabled; watcher behavior unqualified"
            result["host_version"] = subprocess.check_output(
                [str(args.opencode.resolve()), "--version"], text=True, env=env, timeout=15).strip()
            verify_host_version(result["host_version"])
            config = {
                "plugins": ["*", str(args.plugin.resolve()), str(repo / "tests/question-host")],
                "agents": {name: {
                    "description": "Synthetic native Stage 4 preparation fixture; not a genuine Evaluator",
                    "mode": "primary", "system": "Execute only the local scripted fixture job.",
                    "model": "question-fixture/reader",
                    "permissions": [{"action": "*", "resource": "*", "effect": "allow"}]
                    + ([{"action": "read", "resource": "*ledger.sqlite", "effect": "deny"}]
                       if name == "restricted" else []),
                } for name in ("general", "restricted")},
                "model": "question-fixture/reader", "update": "disable", "share": "disabled",
            }
            (Path(env["OPENCODE_CONFIG_DIR"]) / "opencode.json").write_text(encoded(config))
            (project / ".loom.yaml").write_text("instructions: {enabled: false}\nledger: {capture: automatic}\n")
            (root / "jobs.json").write_text("{}")
            subprocess.run(["git", "init", "-q", str(project)], check=True, env=env, timeout=10)

            def boot(label):
                owned = PrivateHost(str(args.opencode.resolve()), project, env, output, label)
                try:
                    require(json.loads(owned.get("/api/info", "info")).get("version") == HOST,
                            "Wrong actual installed host version")
                    owned.wait_roster("/api/plugin", "plugins", lambda rows: all(any(
                        row.get("id") == plugin_id and row.get("state", {}).get("status") == "active"
                        for row in rows) for plugin_id in ("loom", "loom.question.fixture")))
                    return owned
                except Exception:
                    owned.close()
                    raise

            def check(name, **evidence):
                require(name in CHECKS and name not in {item["name"] for item in result["checks"]},
                        "Duplicate or unexpected Stage 4 qualification check")
                result["checks"].append({"name": name, "status": "PASS", **evidence})
                print("PASS " + name, flush=True)

            with audit_session(root) as audit:
                try:
                    host = boot("initial")
                    scenario = Scenario(host, root)
                    owner, foreign = [make_session(host, project, "general") for _ in range(2)]
                    result["sessions"] = {"owner": owner, "foreign": foreign}
                    learning_files = list(Path(env["XDG_STATE_HOME"]).rglob("learning.sqlite"))
                    ledger_files = list(Path(env["XDG_STATE_HOME"]).rglob("ledger.sqlite"))
                    require(len(learning_files) == len(ledger_files) == 1, "Expected one existing private store pair")
                    learning, ledger = learning_files[0], ledger_files[0]
                    trajectory = seed_trajectory(scenario, owner)
                    source_state = until(learning, owner, lambda value: bool(value.get("batch")
                        and value["batch"][1] == "complete"
                        and value.get("observations", {}).get("objective-verification-fail") == 2
                        and value.get("observations", {}).get("objective-verification-pass") == 1
                        and value.get("observations", {}).get("objective-outcome-pass") == 1),
                        "Complete Stage 3 authored correction trajectory", timeout=60)
                    source_batch = source_state["batch"][0]
                    stage3 = report_result(scenario, owner, source_batch)
                    require(stage3["batch"]["method"]["id"] == "descriptive-source-analysis/v2",
                            "Source preparation changed the Stage 3 method")
                    original_members, _ = members(scenario, owner, {
                        "operation": "evaluation-members", "batch_id": source_batch})
                    method = synthetic_method()
                    prepare = {"operation": "prepare-evaluation", "batch_id": source_batch,
                               "method": method, "budget_policy": None}
                    prepared = scenario.invoke(owner, "review", prepare)
                    assert_unissued(prepared)
                    stable = identity(prepared)
                    require(stable["batch_id"] != source_batch, "Stage 4 reused and changed the Stage 3 batch")
                    require(stable["method_id"] == "evaluator/v1/" + hashlib.sha256(encoded(method).encode()).hexdigest(),
                            "Declared method digest differs from its exact versioned manifest")
                    detail_query = {"operation": "evaluation-preparation", "batch_id": stable["batch_id"]}
                    page_query = {"operation": "evaluation-preparation-members", "batch_id": stable["batch_id"],
                                  "request_id": stable["request_id"], "manifest_sha256": stable["manifest_sha256"]}
                    detail = scenario.invoke(owner, "insights", detail_query)
                    require(identity(detail) == stable, "Public preparation reader changed stable identities")
                    assert_unissued(detail)
                    check("S4-native-authored-whole-objective-source-preparation",
                          original_objective=trajectory["objective"], source_batch=source_batch,
                          verification_sequence=["fail", "fail", "pass"], independent_origin_qualification="unproven",
                          preparation=stable, actual_reasoning=False)

                    replay = scenario.invoke(owner, "review", prepare)
                    require(identity(replay) == stable, "Native replay allocated a replacement request or issue")
                    assert_unissued(replay)
                    frozen = scenario.invoke(owner, "review", {
                        "operation": "read", "request_id": stable["review_request_id"]})
                    issue = scenario.invoke(owner, "review", {
                        "operation": "prepare", "request_id": stable["review_request_id"]})
                    require(issue["attempt"]["attempt_id"] == stable["attempt_id"]
                            and issue["attempt"]["state"] == "prepared", "Canonical review owner disagrees with evaluation issue")
                    require(frozen["request"]["request_id"] == stable["review_request_id"]
                            and frozen["member_count"] == 1 and len(frozen["members"]) == 1,
                            "Preparation did not map to one frozen manifest review subject")
                    artifacts = frozen["members"][0]["artifact_refs"]
                    require(len(artifacts) == 1 and artifacts[0]["version"]
                            == {"kind": "sha256", "value": stable["manifest_sha256"]},
                            "Frozen review subject does not bind the complete immutable membership manifest")
                    check("S4-native-stable-request-review-and-issue-replay", **stable)

                    prepared_members, pages = members(scenario, owner, page_query)
                    require(prepared_members == original_members, "Preparation omitted or changed frozen Stage 3 membership")
                    require(len(pages) > 1, "Membership paging did not exercise a real continuation")
                    refs = {(ref["kind"], ref["id"]) for member in prepared_members for ref in member["source_refs"]}
                    require(("objective", trajectory["objective"]) in refs
                            and all(("objective-link", link) in refs for link in trajectory["links"])
                            and all(("ledger-record", item) in refs for item in trajectory["verification_records"]),
                            "Prepared source membership lost original objective, correction or verification identities")
                    check("S4-native-bounded-complete-membership-readback", members=len(prepared_members),
                          pages=len(pages), page_chars=[len(encoded(page)) for page in pages],
                          immutable_manifest_sha256=stable["manifest_sha256"])

                    first_page = {**page_query, "after": 0, "limit": 1}
                    denied(scenario, foreign, "review", prepare)
                    for query in (detail_query, first_page):
                        denied(scenario, foreign, "insights", query)
                    request(host, "POST", f"/api/session/{owner}/agent", {"agent": "restricted"})
                    require(request(host, "GET", f"/api/session/{owner}")["agent"] == "restricted",
                            "Native agent revocation was not applied")
                    denied(scenario, owner, "review", prepare)
                    for query in (detail_query, first_page):
                        denied(scenario, owner, "insights", query)
                    request(host, "POST", f"/api/session/{owner}/agent", {"agent": "general"})
                    check("S4-native-foreign-and-revoked-readers-denied",
                          foreign_denials=3, revoked_same_owner_denials=3)

                    budget_policy = {"id": "fixture-budget", "revision": "1", "sha256": "c" * 64}
                    budgeted_input = {**prepare, "budget_policy": budget_policy}
                    budgeted = scenario.invoke(owner, "review", budgeted_input)
                    assert_unissued(budgeted)
                    require(budgeted["request"]["budget_policy"] == budget_policy
                            and budgeted["budget_reservation"] is None,
                            "A declared budget reference was dropped or treated as an actual reservation")
                    require(all(budgeted[field] != stable[field] for field in ("batch_id", "request_id")),
                            "A changed declared budget boundary reused the null-budget request")
                    budgeted_replay = scenario.invoke(owner, "review", budgeted_input)
                    assert_unissued(budgeted_replay)
                    require(identity(budgeted_replay) == identity(budgeted),
                            "A valid declared budget reference changed preparation identity on replay")
                    before_rejections = preparation_snapshot(learning, ledger)
                    for query in (
                        {**first_page, "request_id": "wrong-request-identity"},
                        {**first_page, "manifest_sha256": "0" * 64},
                        {**first_page, "after": -1},
                        {**first_page, "limit": 0},
                        {**first_page, "qualified": True},
                    ):
                        denied(scenario, owner, "insights", query)
                    for path in ((), ("evaluator", "definition"), ("model", "settings"), ("adapter", "profile")):
                        forged = json.loads(encoded(method))
                        target = forged
                        for field in path:
                            target = target[field]
                        target["host_qualified"] = True
                        denied(scenario, owner, "review", {**prepare, "method": forged})
                    for query in (
                        {**prepare, "host_qualified": True},
                        {**prepare, "request_id": stable["request_id"]},
                        {**prepare, "budget_policy": {**budget_policy, "approved": True}},
                    ):
                        denied(scenario, owner, "review", query)
                    require(preparation_snapshot(learning, ledger) == before_rejections,
                            "Rejected native inputs changed preparation population, method, mapping, review or canonical issue")
                    check("S4-native-wrong-identity-checksum-and-cursor-denied", negative_controls=12,
                          preparation_stores_unchanged=True, declared_budget_replay=True)

                    old_pid = host.proc.pid
                    host.close()
                    host = None
                    final_events(root)
                    host = boot("restart")
                    require(host.proc.pid != old_pid, "Preparation recovery reused the previous process")
                    scenario = Scenario(host, root)
                    recovered = scenario.invoke(owner, "insights", detail_query)
                    require(identity(recovered) == stable, "Restart changed durable preparation identity")
                    assert_unissued(recovered)
                    resumed = scenario.invoke(owner, "review", prepare)
                    require(identity(resumed) == stable, "Restart replay allocated a second evaluation issue")
                    assert_unissued(resumed)
                    restored_members, _ = members(scenario, owner, page_query)
                    require(restored_members == prepared_members, "Restart lost frozen preparation membership")
                    old_report = report_result(scenario, owner, source_batch)
                    require(old_report["report"]["id"] == stage3["report"]["id"]
                            and old_report["report"]["sha256"] == stage3["report"]["sha256"]
                            and old_report["report"]["body"] == stage3["report"]["body"],
                            "Stage 4 preparation changed Stage 3 historical readback")
                    status = scenario.invoke(owner, "insights", {"operation": "evaluation-status"})
                    require(status["automatic_model_calls"] is False
                            and status["genuine_evaluator"]["state"] == "blocked",
                            "Preparation enabled automatic model dispatch")
                    prior_requests = sum(event["type"] == "model-request" for event in events(root))
                    time.sleep(0.25)
                    require(sum(event["type"] == "model-request" for event in events(root)) == prior_requests,
                            "Idle preparation started an unsolicited native model request")
                    check("S4-native-restart-preserves-preparation-and-stage3", before_pid=old_pid,
                          after_pid=host.proc.pid, stage3_report_id=old_report["report"]["id"], **stable)

                    host.close()
                    host = None
                    final_events(root)
                    with closing(sqlite3.connect(ledger)) as db:
                        source = db.execute("SELECT data FROM ledger WHERE id=?", (trajectory["anchor"],)).fetchone()
                        require(source is not None, "Stopped negative control has no original source")
                        changed = json.loads(source[0])
                        changed["data"]["statement"] = "Stopped-host synthetic source corruption negative control."
                        db.execute("UPDATE ledger SET data=? WHERE id=?", (encoded(changed), trajectory["anchor"]))
                        db.commit()
                    host = boot("mutated-source")
                    scenario = Scenario(host, root)
                    denied(scenario, owner, "insights", detail_query)
                    denied(scenario, owner, "insights", first_page)
                    denied(scenario, owner, "review", prepare)
                    check("S4-native-mutated-original-withholds-dependent-preparation",
                          original_record=trajectory["anchor"], stopped_host_mutation=True, native_denials=3)
                    host.close()
                    host = None
                    observed = final_events(root)
                    require(any(event["type"] == "provider-request" for event in observed),
                            "No real native fixture-provider boundary was observed")
                    requests = [event for event in observed if event["type"] == "model-request"]
                    require(requests and all(event["data"].get("providerID", event["data"].get("model", {}).get("providerID"))
                                             == "question-fixture" for event in requests),
                            "An unapproved provider/model request was observed")
                    require(not any(event["type"] == "tool-before" and event["data"].get("tool")
                                    in ("subagent", "loom_tweak", "loom.tweak") for event in observed),
                            "Preparation attempted native dispatch or canonical instruction mutation")
                    check("S4-native-no-evaluator-dispatch-or-instruction-mutation",
                          evaluator_dispatches=0, instruction_mutations=0, provider="question-fixture",
                          inference_qualification="no real-model calls; scripted native tool driving only")
                    require({item["name"] for item in result["checks"]} == CHECKS,
                            "Stage 4 native qualification omitted a required check")
                    result["status"] = "PASS"
                finally:
                    if host is not None:
                        host.close()
                        host = None
                    try:
                        captured = audit.finalize(output / "audit.ndjson")
                        result["audit_sha256"] = captured.sha256
                        result["audit_receipts"] = len(captured.events)
                        result["audit_bytes"] = captured.byte_count
                    except Exception as error:
                        result["status"] = "FAIL"
                        result["audit_error"] = f"{type(error).__name__}: {error}"
                        result.setdefault("error", result["audit_error"])
    except Exception as error:
        result["status"] = "FAIL"
        result["error"] = f"{type(error).__name__}: {error}"
    finally:
        (output / "report.json").write_text(json.dumps(result, indent=2) + "\n")
        (output / "report.json").chmod(0o600)
    return result


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
    result = run(parser.parse_args())
    print(json.dumps({key: result.get(key) for key in (
        "status", "genuine_evaluator", "e11", "q4", "q5", "source_head", "error", "checks")}))
    raise SystemExit({"PASS": 0, "FAIL": 1, "UNPROVEN": 2}[result["status"]])


if __name__ == "__main__":
    main()
