"""Independent bounded installed Stage 3 mechanics qualification.

Uses the packed plugin, unmodified OpenCode 2.2.6, real native Session/Code
Mode/Loom tool calls, the production source notification and scheduler, actual
SQLite files, and later public Loom report readers. Only the external provider
is scripted, with a private isolated project. Never calls AutomaticLearning.run,
injects a checkpoint or constructs a report on behalf of production.

This proves only the named mechanics, not Q4/Q5, whole-objective/E11 acceptance,
a real Evaluator, live-provider eligibility or human provenance.
"""
from __future__ import annotations

import argparse
from contextlib import closing
import hashlib
import json
import secrets
from pathlib import Path
import shutil
import sqlite3
import subprocess
import tempfile
import time

from installed_host_smoke import PrivateHost, installed_plugin_inventory, isolated_environment, require
from installed_instruction_variants import verify_host_version
from installed_questions import Scenario, audit_session, events, final_events, idle, request

HOST = "2.2.6"
CHECKS = {
    "S3-installed-native-source-to-automatic-report",
    "S3-owner-only-public-source-linked-readback",
    "S3-foreign-and-revoked-readers-denied",
    "S3-denied-source-caught-up-after-restart",
    "S3-later-source-creates-a-new-revision",
    "S3-authored-R1-correction-and-partial-R2-scope",
    "S3-capture-off-prevents-automatic-analysis",
    "S3-no-automatic-model-or-mutation",
}


def sha(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def view(dbfile: Path, session: str) -> dict:
    if not dbfile.is_file():
        return {}
    with closing(sqlite3.connect(dbfile.as_uri() + "?mode=ro", uri=True, timeout=2)) as db:
        db.execute("PRAGMA query_only=ON")
        try:
            opportunity = db.execute(
                "SELECT state,reason FROM learning_evaluation_opportunities WHERE session_id=?",
                (session,)).fetchone()
            batch = db.execute(
                "SELECT id,state,report_id FROM learning_evaluation_batches WHERE owner_session=? "
                "ORDER BY sequence DESC LIMIT 1", (session,)).fetchone()
            overall = db.execute(
                "SELECT body_json FROM learning_evaluation_reports WHERE id=?",
                (batch[2],)).fetchone() if batch and batch[2] else None
        except sqlite3.OperationalError as error:
            if "no such table" in str(error):
                return {}
            raise
    return {
        "opportunity": list(opportunity) if opportunity else None,
        "batch": list(batch) if batch else None,
        "observations": json.loads(overall[0]).get("observations", {}) if overall else {},
    }


def until(dbfile: Path, session: str, predicate, label: str, timeout=30):
    end = time.monotonic() + timeout
    observed = None
    while time.monotonic() < end:
        observed = view(dbfile, session)
        if predicate(observed):
            return observed
        time.sleep(0.05)
    raise RuntimeError(f"{label} not observed for native Session; last states: {observed}")


def report_result(scenario: Scenario, owner: str, batch_id: str):
    value = scenario.invoke(owner, "insights", {"operation": "evaluation", "batch_id": batch_id})
    require(value["batch"]["id"] == batch_id, "Public result changed the batch identity")
    require(value["report"] is not None and value["report"]["availability"] == "available",
            "Public overall report was not retrievable with intact originals")
    require(value["report"]["body"] is not None, "Public report omitted its valid original basis")
    return value


def make_session(host, project: Path, agent: str) -> str:
    return request(host, "POST", "/api/session", {
        "agent": agent, "title": "Isolated Stage 3 verification",
        "model": {"providerID": "question-fixture", "id": "reader"},
        "location": {"directory": str(project)},
    })["id"]


def append_original(scenario: Scenario, owner: str, statement: str) -> dict:
    return scenario.invoke(owner, "record", {
        "operation": "add", "session_only": True,
        "kind": "result", "statement": statement,
    })


def run(args):
    repo, output = args.repository.resolve(), args.report_directory.resolve()
    output.mkdir(parents=True, exist_ok=False, mode=0o700)
    result = {
        "format": "loom-installed-stage3-mechanics/v1",
        "status": "UNPROVEN", "e11": "UNPROVEN", "genuine_evaluator": "UNPROVEN",
        "q4": "UNQUALIFIED", "q5": "PROTECTED_TRANSFER_WITHHELD",
        "model_spending": "SCRIPTED_EXTERNAL_PROVIDER_ONLY",
        "checks": [], "limitations": [
            "Synthetic source content, not a real 100-task multi-Session engineering trajectory.",
            "Original native review execution/exact input/source consumption is unqualified.",
            "No protected review transfer, original human lineage or final-model exposure receipt.",
            "Scripted external provider; no genuine Evaluator reasoning or live-provider billing proof.",
            "The SQLite read-only observer only waits for state; public Loom tools prove report readback.",
            "Graceful restart; forced process crash/power-loss recovery not proven by this run.",
        ],
    }
    host = None
    try:
        require(args.opencode is not None and args.opencode.is_file(), "Pinned installed OpenCode binary missing")
        result["source_head"] = subprocess.check_output(
            ["git", "-C", str(repo), "rev-parse", "HEAD"], text=True).strip()
        result["source_dirty"] = bool(subprocess.check_output(
            ["git", "-C", str(repo), "status", "--porcelain"], text=True).strip())
        require(not result["source_dirty"], "Qualification requires a clean exact source candidate")
        result["candidate"] = installed_plugin_inventory(
            args.artifact.resolve(), args.plugin.resolve(), args.expect_plugin_version, HOST)
        runtime_paths = ["server.ts", *[
            str(path.relative_to(repo)) for path in sorted((repo / "src").rglob("*"))
            if path.is_file()
        ]]
        require(all((args.plugin / name).is_file()
                    and sha(repo / name) == sha(args.plugin / name) for name in runtime_paths),
                "Installed plugin runtime differs from checked-in candidate")
        result["runtime_files_checked"] = len(runtime_paths)
        result["input_sha256"] = {name: sha(repo / name) for name in (
            "tests/installed_learning_stage3.py", "tests/installed_questions.py",
            "tests/installed_host_smoke.py", "tests/installed_instruction_variants.py",
            "tests/question-host/server.ts", "tests/question-host/provider.mjs",
            ".bun-version", "bun.lock", "package.json",
        )}
        result["cli_sha256"] = sha(args.opencode.resolve())

        with tempfile.TemporaryDirectory(prefix="loom-installed-stage3-") as temporary:
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
            allow = [{"action": "*", "resource": "*", "effect": "allow"}]
            config = {
                "plugins": ["*", str(args.plugin.resolve()), str(repo / "tests/question-host")],
                "agents": {
                    name: {
                        "description": "Isolated Stage 3 fixture (not a genuine Evaluator)",
                        "mode": "primary", "system": "Execute only the local scripted fixture job.",
                        "model": "question-fixture/reader",
                        "permissions": allow + (
                            [{"action": "read", "resource": "*ledger.sqlite", "effect": "deny"}]
                            if name == "restricted" else []),
                    }
                    for name in ("general", "restricted")
                },
                "model": "question-fixture/reader", "update": "disable", "share": "disabled",
            }
            (Path(env["OPENCODE_CONFIG_DIR"]) / "opencode.json").write_text(json.dumps(config))
            capture = project / ".loom.yaml"
            capture.write_text("instructions: {enabled: false}\nledger: {capture: automatic}\n")
            (root / "jobs.json").write_text("{}")
            subprocess.run(["git", "init", "-q", str(project)], check=True, env=env, timeout=10)
            learning = None

            def boot(label):
                owned = PrivateHost(str(args.opencode.resolve()), project, env, output, label)
                try:
                    require(json.loads(owned.get("/api/info", "info")).get("version") == HOST,
                            "Wrong actual installed host version")
                    owned.wait_roster("/api/plugin", "plugins", lambda rows: all(any(
                        row.get("id") == identity
                        and row.get("state", {}).get("status") == "active"
                        for row in rows) for identity in ("loom", "loom.question.fixture")))
                    return owned
                except Exception:
                    owned.close()
                    raise

            def check(name, **evidence):
                require(name in CHECKS and name not in {x["name"] for x in result["checks"]},
                        "Duplicate or unexpected qualification check")
                result["checks"].append({"name": name, "status": "PASS", **evidence})

            with audit_session(root) as audit:
                try:
                    host = boot("initial")
                    scenario = Scenario(host, root)
                    state_home = Path(env["XDG_STATE_HOME"])
                    candidates = list(state_home.rglob("learning.sqlite"))
                    require(len(candidates) == 1, "Packed plugin did not create one private learning database")
                    learning = candidates[0]
                    owner = make_session(host, project, "general")
                    unrelated = make_session(host, project, "general")
                    denied_worker = make_session(host, project, "restricted")
                    result["sessions"] = {
                        "owner": owner, "unrelated": unrelated, "denied_source_worker": denied_worker,
                    }

                    first = append_original(scenario, owner, "Synthetic Stage 3 authored result A")
                    require(first.get("id") and first.get("session_id") == owner,
                            "Native Loom record did not return the actual original identity")
                    initial = until(learning, owner,
                                    lambda v: bool(v.get("batch") and v["batch"][1] == "complete" and v["batch"][2]),
                                    "Automatic no-command evaluation")
                    batch_a = initial["batch"][0]
                    check("S3-installed-native-source-to-automatic-report",
                          source_record_id=first["id"], batch=batch_a,
                          entry="real native loom_record; background scheduler; SQLite publish")

                    page = scenario.invoke(owner, "insights", {"operation": "evaluations"})
                    require(any(x["id"] == batch_a for x in page["items"]),
                            "Native Loom public batch listing omitted its own automatic report")
                    original = report_result(scenario, owner, batch_a)
                    body = original["report"]["body"]
                    require(body["objective_success"] == "not-assessed"
                            and body["genuine_evaluator"]["state"] == "blocked"
                            and body["population"]["complete_through_frozen_boundary"] is True
                            and body["population"]["independent_originating_requests"] is None
                            and body["observations"].get("authored-record", 0) >= 1,
                            "Deterministic result invented a whole-objective or genuine-Evaluator verdict")
                    references = scenario.invoke(owner, "insights", {
                        "operation": "evaluation-sources", "batch_id": batch_a, "limit": 50,
                    })
                    require(references["availability"] == "available"
                            and references["source_ref_count"] >= 1
                            and any(row["id"] == first["id"] for row in references["items"]),
                            "Public source page cannot trace the original authored record")
                    check("S3-owner-only-public-source-linked-readback",
                          batch=batch_a, report_sha256=original["report"]["sha256"],
                          source_ref_count=references["source_ref_count"],
                          evaluator=body["genuine_evaluator"]["state"])

                    # Denial must arise from the actual native call, not from a
                    # Python Store simulation or a user-supplied owner key.
                    forbidden = scenario.command(unrelated, (
                        "let denied=false;try{await tools.loom.insights("
                        + json.dumps({"operation": "evaluation", "batch_id": batch_a}) +
                        ");}catch(error){denied=true;}if(!denied)throw new Error("
                        "\"Foreign Session received a private report\");return \"denied\";"))
                    require(any(event["type"] == "tool-after"
                                and event["data"].get("tool") in ("loom_insights", "loom.insights")
                                and event["data"].get("status") == "error"
                                for event in forbidden), "No denied native report read was observed")

                    # Start an actual source from a reader-denied agent. It must
                    # become blocked without publishing a report, then be found
                    # on restart with no new original event or idle callback.
                    restricted_original = append_original(
                        scenario, denied_worker, "Synthetic unavailable read source")
                    denied = until(learning, denied_worker,
                                   lambda v: bool(v.get("opportunity") and v["opportunity"][0] == "blocked"),
                                   "Native automatic permission denial")
                    require(not denied.get("batch") or denied["batch"][2] is None,
                            "Permission-denied learning published a report")
                    request(host, "POST", f"/api/session/{denied_worker}/agent", {"agent": "general"})
                    require(request(host, "GET", f"/api/session/{denied_worker}")["agent"] == "general",
                            "Native principal did not change")
                    first_pid = host.proc.pid
                    host.close()
                    host = None
                    final_events(root)
                    host = boot("reopened")
                    require(host.proc.pid != first_pid, "Recovery did not start another host process")
                    scenario = Scenario(host, root)
                    caught = until(learning, denied_worker,
                                   lambda v: bool(v.get("batch") and v["batch"][1] == "complete" and v["batch"][2]),
                                   "Startup catch-up after denied first run")
                    recovered_batch = caught["batch"][0]
                    recovered = report_result(scenario, denied_worker, recovered_batch)
                    require(any(restricted_original["id"] in ids
                                for ids in recovered["report"]["body"]["evidence_examples"].values()),
                            "Restart report lacks the original denied source record")
                    unchanged = report_result(scenario, owner, batch_a)
                    require(unchanged["report"]["sha256"] == original["report"]["sha256"],
                            "Reopen changed previously published original report")
                    check("S3-denied-source-caught-up-after-restart",
                          old_opportunity=denied["opportunity"][0],
                          recovered_batch=recovered_batch, original_id=restricted_original["id"],
                          processes=[first_pid, host.proc.pid])

                    # Produce later source through the real Loom tool and
                    # require a newly versioned report instead of rewriting A.
                    next_record = append_original(scenario, owner, "Synthetic late Stage 3 correction B")
                    revised = until(learning, owner,
                                    lambda v: bool(v.get("batch") and v["batch"][0] != batch_a
                                                   and v["batch"][1] == "complete" and v["batch"][2]),
                                    "Later-source revision")
                    batch_b = revised["batch"][0]
                    latest = report_result(scenario, owner, batch_b)
                    require(latest["report"]["body"]["population"]["source_count"] >
                            body["population"]["source_count"],
                            "Later-source report lost eligible original population")
                    require(any(next_record["id"] in ids
                                for ids in latest["report"]["body"]["evidence_examples"].values()),
                            "Late original record absent from new report")
                    check("S3-later-source-creates-a-new-revision",
                          prior_batch=batch_a, later_batch=batch_b,
                          later_record=next_record["id"])

                    # Author a real historical WorkRef, freeze R1 against A,
                    # record a finding, revise the Plan, and freeze partial R2
                    # against B. No native reviewer delivery is performed:
                    # this proves automatic source interpretation, not Q4/Q5.
                    action = scenario.invoke(owner, "action", {
                        "operation": "create", "title": "Synthetic reviewed objective",
                        "goal": "Retain historical work and partial corrective review",
                    })
                    scenario.invoke(owner, "plan", {
                        "operation": "save", "action_id": action["id"], "expected_revision": 0,
                        "nodes": [{"id": "task", "kind": "task", "title": "Artifact A",
                                   "outcome": "Original A criterion"}],
                    })
                    work_a = scenario.invoke(owner, "context", {
                        "action_id": action["id"], "node_id": "task"})["work_ref"]
                    artifact_a = project / "stage3-artifact-a.txt"
                    artifact_a.write_text("Synthetic assembled artifact A; not native review evidence.\n")

                    def member(key, work, artifact, prior=None):
                        return {
                            "member_id": key, "work_ref": work, "producing_attempt_refs": [],
                            "artifact_refs": [{"locator": str(artifact), "version": {
                                "kind": "sha256", "value": sha(artifact)}, "content_ref": None}],
                            "prior_review_request_id": prior, "membership_source_refs": [],
                            "gaps": [{"reason": "not-observed", "source_ref": None}],
                        }

                    def mandate(question, revision):
                        return {
                            "question": question, "dimensions": ["correctness"],
                            "criteria": [{"text": "Preserve " + revision + " task obligations",
                                          "source_ref": None}],
                            "mode": "independent", "inclusions": [revision],
                            "exclusions": ["other unreviewed work"],
                        }

                    r1 = "stage3-r1-" + secrets.token_hex(8)
                    frozen_a = scenario.invoke(owner, "review", {
                        "operation": "freeze", "request": {
                            "format": "loom-review-request/v1", "request_id": r1,
                            "mandate": mandate("Synthetic R1 examines A", "original A"),
                            "intended_recipient": {"agent": "reviewer", "session_id": None},
                            "members": [member("original-task", work_a, artifact_a)],
                            "rechecks": [],
                        },
                    })
                    require(frozen_a["status"] == "created",
                            "Production review owner did not freeze first request")
                    finding = append_original(scenario, owner, "Synthetic R1 found a defect in A")
                    scenario.invoke(owner, "review", {
                        "operation": "relate", "request_id": r1,
                        "relationship": "finding", "source_record_id": finding["id"],
                        "member_ids": ["original-task"],
                    })
                    r1_read = scenario.invoke(owner, "review", {
                        "operation": "read", "request_id": r1,
                    })
                    require(len(r1_read["relationships"]) == 1,
                            "Native R1 finding relationship not recoverable")
                    finding_ref = r1_read["relationships"][0]["id"]
                    historical_a = scenario.invoke(owner, "review", {
                        "operation": "work", "request_id": r1, "member_id": "original-task"})
                    require("Original A criterion" in json.dumps(historical_a),
                            "The initial original work scope was not retained")

                    scenario.invoke(owner, "plan", {
                        "operation": "save", "action_id": action["id"], "expected_revision": 1,
                        "nodes": [{"id": "task", "kind": "task", "title": "Artifact B",
                                   "outcome": "Corrected B criterion"}],
                    })
                    work_b = scenario.invoke(owner, "context", {
                        "action_id": action["id"], "node_id": "task"})["work_ref"]
                    artifact_b = project / "stage3-artifact-b.txt"
                    artifact_b.write_text("Synthetic corrected artifact B; not native review evidence.\n")
                    r2 = "stage3-r2-" + secrets.token_hex(8)
                    frozen_b = scenario.invoke(owner, "review", {
                        "operation": "freeze", "request": {
                            "format": "loom-review-request/v1", "request_id": r2,
                            "mandate": mandate("Synthetic partial R2 examines correction", "corrected B"),
                            "intended_recipient": {"agent": "reviewer", "session_id": None},
                            "members": [member("corrected-task", work_b, artifact_b, r1)],
                            "rechecks": [{"request_id": r1, "finding_ids": [finding_ref]}],
                        },
                    })
                    require(frozen_b["status"] == "created",
                            "Production review owner did not freeze corrective R2")
                    historical_after_b = scenario.invoke(owner, "review", {
                        "operation": "work", "request_id": r1, "member_id": "original-task"})
                    require("Original A criterion" in json.dumps(historical_after_b)
                            and "Corrected B criterion" not in json.dumps(historical_after_b),
                            "R2 changed R1's immutable historical work")
                    scope_b = scenario.invoke(owner, "review", {
                        "operation": "work", "request_id": r2, "member_id": "corrected-task"})
                    require("Corrected B criterion" in json.dumps(scope_b),
                            "R2 did not retain the corrected historical work")
                    r2_read = scenario.invoke(owner, "review", {
                        "operation": "read", "request_id": r2,
                    })
                    require(r2_read["request"]["rechecks"] == [
                        {"request_id": r1, "finding_ids": [finding_ref]}],
                        "R2 lost the specific original finding it rechecks")

                    combined = until(learning, owner,
                        lambda v: v.get("batch") is not None and v["batch"][1] == "complete"
                        and v.get("observations", {}).get("review-request", 0) >= 2
                        and sum(count for kind, count in v.get("observations", {}).items()
                                if kind.startswith("review-") and kind != "review-request") >= 1,
                        "Automatic R1/finding/partial-R2 interpretation")
                    combined_id = combined["batch"][0]
                    interpretation = report_result(scenario, owner, combined_id)["report"]["body"]
                    require(interpretation["objective_success"] == "not-assessed"
                            and interpretation["observations"].get("review-request", 0) == 2
                            and interpretation["genuine_evaluator"]["state"] == "blocked",
                            "Automatic review interpretation invented a native verdict")
                    check("S3-authored-R1-correction-and-partial-R2-scope",
                          request_ids=[r1, r2], report=combined_id,
                          historical_work_preserved=True, native_review_dispatch="withheld",
                          report_review_requests=interpretation["observations"]["review-request"])

                    # Same native Session was authorized before switching to
                    # read-denied agent; all private readers must now fail.
                    request(host, "POST", f"/api/session/{owner}/agent", {"agent": "restricted"})
                    _, offset = scenario.begin(owner,
                        "return await tools.loom.insights(" +
                        json.dumps({"operation": "evaluation", "batch_id": batch_a}) + ");")
                    idle(host, [owner])
                    failures = [
                        e for e in events(root)[offset:]
                        if e["type"] == "tool-after"
                        and e["data"].get("tool") in ("loom_insights", "loom.insights")
                        and e["data"].get("status") == "error"
                    ]
                    require(len(failures) == 1, "Revoked native report read did not fail")
                    require(not any(e["type"] == "tool-after"
                                    and e["data"].get("tool") in ("loom_insights", "loom.insights")
                                    and e["data"].get("status") == "completed"
                                    for e in events(root)[offset:]),
                            "Revocation returned protected derived content")
                    check("S3-foreign-and-revoked-readers-denied",
                          foreign_denied=True, same_session_revoked=True)

                    capture.write_text("instructions: {enabled: false}\nledger: {capture: off}\n")
                    optout = make_session(host, project, "general")
                    ignored = append_original(scenario, optout, "Synthetic capture-disabled source")
                    time.sleep(0.5)
                    state = view(learning, optout)
                    require(state.get("batch") is None,
                            "Automatic evaluation proceeded after capture opt-out")
                    status = scenario.invoke(optout, "insights", {"operation": "evaluation-status"})
                    require(status["enabled"] is False and status["automatic_model_calls"] is False,
                            "Native report reader ignores capture disabled status")
                    check("S3-capture-off-prevents-automatic-analysis",
                          source_record_id=ignored["id"], published_batch=False)

                    observed = events(root)
                    require(all(e["data"].get("providerID", e["data"].get("model", {}).get("providerID"))
                                == "question-fixture"
                                for e in observed if e["type"] == "model-request"),
                            "Unapproved provider/model request observed")
                    require(not any(e["type"] == "tool-before"
                                    and e["data"].get("tool") in ("subagent", "loom_tweak", "loom.tweak")
                                    for e in observed),
                            "Automatic analysis attempted native child dispatch or instruction mutation")
                    check("S3-no-automatic-model-or-mutation",
                          external_provider="question-fixture", new_subagent_calls=0,
                          instruction_changes=0)

                    require({x["name"] for x in result["checks"]} == CHECKS,
                            "Installed Stage 3 mechanics did not execute the entire required check set")
                    result["status"] = "PASS"
                finally:
                    if host is not None:
                        host.close()
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
    parser.add_argument("--opencode", type=Path, default=Path(shutil.which("opencode"))
                        if shutil.which("opencode") else None)
    parser.add_argument("--repository", type=Path, default=Path(__file__).resolve().parents[1])
    parser.add_argument("--plugin", type=Path, required=True)
    parser.add_argument("--artifact", type=Path, required=True)
    parser.add_argument("--expect-plugin-version", default="2.0.0-alpha.1")
    parser.add_argument("--report-directory", type=Path, required=True)
    parser.add_argument("--disable-filewatcher", action="store_true")
    result = run(parser.parse_args())
    print(json.dumps({k: result.get(k) for k in (
        "status", "e11", "genuine_evaluator", "source_head", "error", "checks")}))
    raise SystemExit({"PASS": 0, "FAIL": 1, "UNPROVEN": 2}[result["status"]])


if __name__ == "__main__":
    main()
