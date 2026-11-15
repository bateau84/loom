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
import os
import secrets
import signal
import threading
from pathlib import Path
from urllib.request import Request, ProxyHandler, build_opener
import base64
import shutil
import sqlite3
import subprocess
import tempfile
import time

from installed_host_smoke import (PrivateHost, installed_plugin_inventory, isolated_environment,
    require, ready_url, endpoint_path, roster_response, NoRedirect)
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
    "S3-stopped-backup-restore-fresh-host-readback",
    "S3-501-objective-population-through-native-scheduler-and-pages",
    "S3-forced-crash-partial-checkpoint-and-late-source-recovery",
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


def frozen_progress(dbfile: Path, session: str, batch_id: str | None = None) -> dict | None:
    """Read committed, published SQLite state without creating evaluation outputs."""
    if not dbfile.is_file():
        return None
    with closing(sqlite3.connect(dbfile.as_uri() + "?mode=ro", uri=True, timeout=.2)) as db:
        db.execute("PRAGMA query_only=ON")
        # Two SELECTs must observe one snapshot while native checkpoints commit.
        # In WAL mode a read transaction does not block the production writer.
        db.execute("BEGIN")
        where = "b.id=?" if batch_id is not None else "b.owner_session=?"
        try:
            row = db.execute(
                "SELECT b.id,b.identity,b.membership_sha256,b.state,b.report_id,"
                "COUNT(m.key),COUNT(m.report_id) "
                "FROM learning_evaluation_batches b "
                "JOIN learning_evaluation_members m ON m.batch_id=b.id WHERE "
                + where + " GROUP BY b.id ORDER BY b.sequence DESC LIMIT 1",
                (batch_id if batch_id is not None else session,),
            ).fetchone()
            if not row:
                return None
            keys = db.execute(
                "SELECT m.key,m.report_id,r.sha256 "
                "FROM learning_evaluation_members m "
                "JOIN learning_evaluation_reports r ON r.id=m.report_id "
                "WHERE m.batch_id=? ORDER BY m.ordinal", (row[0],),
            ).fetchall()
        except sqlite3.OperationalError as error:
            if "no such table" in str(error):
                return None
            raise
        result = {
            "id": row[0], "identity": row[1], "membership_sha256": row[2],
            "state": row[3], "report_id": row[4],
            "member_count": row[5], "processed_count": row[6],
            "checkpoint_receipts": [[key, report, checksum] for key, report, checksum in keys],
        }
        require(len(keys) == result["processed_count"],
                "A processed checkpoint has no matching durable report receipt")
        return result


def force_crash_mid_checkpoint(
    executable: Path, project: Path, env: dict, output: Path,
    dbfile: Path, session: str, timeout=100,
) -> dict:
    """Kill only a disposable installed OpenCode process after real committed checkpoints.

    No production hooks, injected reports, artificial scheduler sleeps, or direct
    application DB writes. If the committed partial window cannot be observed,
    fail rather than calling an uninterrupted batch a crash-recovery PASS.
    """
    stdout = (output / "partial-crash.server.stdout.txt").open("w")
    stderr = (output / "partial-crash.server.stderr.txt").open("w")
    process = None
    before = None
    observed_progress = None
    activation = {"started": False, "active": False, "errors": []}
    activation_thread = None
    try:
        password = secrets.token_urlsafe(24)
        process = subprocess.Popen(
            [str(executable), "serve", "--stdio", "--hostname", "127.0.0.1", "--port", "0"],
            cwd=project, env={**env, "OPENCODE_PASSWORD": password},
            stdin=subprocess.PIPE, stdout=stdout, stderr=stderr, start_new_session=True,
        )
        # The native host initializes plugins lazily when a location-scoped
        # roster is requested. Raw CLI startup alone leaves no learning worker.
        # Activate through the exact public host endpoint concurrently with
        # committed-checkpoint polling, so no partial window can be missed while
        # waiting for plugin registration or host readiness.
        url = None
        ready_deadline = time.monotonic() + 30
        stdout_path = output / "partial-crash.server.stdout.txt"
        while time.monotonic() < ready_deadline:
            require(process.poll() is None, "Crash host exited before native readiness")
            with stdout_path.open() as reader:
                first_line = reader.readline(65536)
            if first_line.endswith("\n"):
                url = ready_url(first_line)
                break
            time.sleep(.01)
        require(url is not None, "Crash host never advertised the native HTTP endpoint")
        opener = build_opener(ProxyHandler({}), NoRedirect())
        token = base64.b64encode(("opencode:" + password).encode()).decode()
        def activate_native_plugin():
            activation["started"] = True
            for attempt in range(120):
                if process.poll() is not None:
                    break
                try:
                    req = Request(url + endpoint_path("/api/plugin", project),
                                  headers={"Authorization": "Basic " + token})
                    with opener.open(req, timeout=10) as response:
                        raw = response.read(2 * 1024 * 1024 + 1)
                    require(len(raw) <= 2 * 1024 * 1024,
                            "Native roster exceeded expected response budget")
                    plugins = roster_response(raw.decode(), project)
                    if all(any(item.get("id") == identity
                               and item.get("state", {}).get("status") == "active"
                               for item in plugins) for identity in ("loom", "loom.question.fixture")):
                        activation["active"] = True
                        return
                    if any(item.get("state", {}).get("status") == "failed" for item in plugins):
                        activation["errors"].append("Installed plugin reported startup failure")
                        return
                except Exception as error:
                    if process.poll() is not None:
                        return
                    activation["errors"].append(type(error).__name__)
                time.sleep(.02)
        activation_thread = threading.Thread(target=activate_native_plugin, daemon=True)
        activation_thread.start()
        end = time.monotonic() + timeout
        while time.monotonic() < end:
            require(process.poll() is None,
                    "Installed OpenCode exited before partial evaluation; inspect crash-host logs")
            try:
                candidate = frozen_progress(dbfile, session)
            except sqlite3.OperationalError as error:
                # Short WAL ownership/contention during a genuine transaction is
                # transient; nothing is classified PASS without a committed read.
                if "locked" not in str(error).lower() and "busy" not in str(error).lower():
                    raise
                candidate = None
            if candidate is not None:
                observed_progress = {key: candidate[key] for key in
                                     ("id", "state", "report_id", "member_count", "processed_count")}
            if (candidate is not None and candidate["state"] in ("processing", "pending")
                    and candidate["report_id"] is None
                    and 0 < candidate["processed_count"] < candidate["member_count"]):
                before = candidate
                os.killpg(process.pid, signal.SIGKILL)
                code = process.wait(timeout=10)
                require(code == -signal.SIGKILL,
                        "Installed host was not actually terminated by SIGKILL")
                after = frozen_progress(dbfile, session, before["id"])
                require(after is not None and after["id"] == before["id"]
                        and after["identity"] == before["identity"]
                        and after["membership_sha256"] == before["membership_sha256"]
                        and after["report_id"] is None
                        and 0 < after["processed_count"] < after["member_count"],
                        "Crash did not leave durable partial checkpoints before overall publication")
                return {"process_pid": process.pid, "termination": "SIGKILL",
                        "return_code": code, "observed_before_signal": before,
                        "durable_after_exit": after}
            time.sleep(.002)
        raise RuntimeError("Could not catch a committed partial batch before final publication: "
                           + json.dumps({"last_progress": observed_progress, "activation": activation}))
    finally:
        if process is not None:
            if process.poll() is None:
                os.killpg(process.pid, signal.SIGKILL)
            process.wait(timeout=10)
            if process.stdin is not None and not process.stdin.closed:
                process.stdin.close()
        if activation_thread is not None:
            activation_thread.join(timeout=1)
        stdout.close()
        stderr.close()


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
            "Graceful restart, stopped-state restore and forced SIGKILL of a partially checkpointed installed host; OS power-loss/disk durability and model effects unproven.",
        ],
    }
    host = None
    try:
        require(args.opencode is not None and args.opencode.is_file(), "Pinned installed OpenCode binary missing")
        result["source_head"] = subprocess.check_output(
            ["git", "-C", str(repo), "rev-parse", "HEAD"], text=True).strip()
        require(result["source_head"] == args.expect_head,
                "Installed Stage 3 proof did not checkout the exact reviewed PR head")
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

                    # Stop both SQLite owners before backup. The file-set backup
                    # utility must inspect disposable copies and leave original
                    # source, WAL and SHM bytes unchanged. Restore is isolated in
                    # a fresh state home; only the real public native Loom tools
                    # are then permitted to validate retained report readback.
                    session_info = request(host, "GET", f"/api/session/{owner}")
                    project_id = session_info.get("projectID")
                    require(isinstance(project_id, str) and project_id,
                            "Native project identity unavailable for offline backup")
                    canonical_project = str(project.resolve())
                    expected_scope = hashlib.sha256(json.dumps(
                        {"canonical": canonical_project, "project": project_id},
                        sort_keys=True, ensure_ascii=False, separators=(",", ":")
                    ).encode()).hexdigest()
                    source_dir = learning.parent
                    require(source_dir.name == expected_scope,
                            "Cannot bind the installed SQLite namespace to the native project")
                    host.close()
                    host = None
                    final_events(root)
                    # SQLite may checkpoint WAL and remove sidecars when its last
                    # connection closes. The accepted byte-for-byte invariant
                    # starts at the actual stopped-writers boundary, not while
                    # the live plugin still owns its files.
                    original_members = {
                        item.name: sha(item) for item in source_dir.iterdir() if item.is_file()
                    }
                    require("ledger.sqlite" in original_members
                            and "learning.sqlite" in original_members,
                            "Complete stopped Action/learning storage was not present")
                    backup_dir = root / "private-stopped-backup"
                    restored_state_home = root / "restored-state-home"
                    restore_parent = restored_state_home / "loom" / "actions-v1"
                    restore_parent.mkdir(parents=True)
                    restore_dir = restore_parent / expected_scope
                    utility = repo / "tools" / "learning-state-backup.py"
                    shared_flags = [
                        "--project-id", project_id,
                        "--project-canonical", canonical_project,
                        "--loom-revision", result["source_head"],
                        "--package-version", args.expect_plugin_version,
                    ]
                    stopped_env = {**env, "LOOM_WRITERS_STOPPED": "yes"}
                    backed = subprocess.run(["python3", str(utility), "backup",
                        "--source-dir", str(source_dir), "--backup-dir", str(backup_dir),
                        *shared_flags], env=stopped_env, capture_output=True,
                        text=True, timeout=45)
                    require(backed.returncode == 0, "Actual offline backup rejected the "
                            "stopped installed product state: " + backed.stderr[-1200:])
                    backup_members = {
                        item.name: sha(item) for item in backup_dir.iterdir() if item.is_file()
                        and item.name != "loom-state-manifest.json"
                    }
                    require(backup_members == original_members,
                            "Stopped-state backup changed/omitted source file bytes")
                    restored = subprocess.run(["python3", str(utility), "restore",
                        "--backup-dir", str(backup_dir), "--destination-dir", str(restore_dir),
                        *shared_flags], env=stopped_env, capture_output=True,
                        text=True, timeout=45)
                    require(restored.returncode == 0, "Actual offline restore failed: "
                            + restored.stderr[-1200:])
                    restored_members = {
                        item.name: sha(item) for item in restore_dir.iterdir() if item.is_file()
                    }
                    require(restored_members == original_members
                            and {item.name: sha(item) for item in source_dir.iterdir()
                                 if item.is_file()} == original_members,
                            "Restore or inspection modified original, backup or restored bytes")
                    manifest = json.loads(
                        (backup_dir / "loom-state-manifest.json").read_text())
                    require(manifest["learning"] == "present",
                            "Manifest did not identify durable learning state")

                    # Reuse original native Sessions, but not the original Loom
                    # state home or prior server process. The same native agent
                    # that was read-denied before backup must remain denied
                    # after restoration until a real native agent change.
                    env["XDG_STATE_HOME"] = str(restored_state_home)
                    host = boot("restored")
                    scenario = Scenario(host, root)
                    require(request(host, "GET", f"/api/session/{owner}")["agent"] == "restricted",
                            "Native read-revocation state was not retained")
                    denied_offset = len(events(root))
                    _, _ = scenario.begin(owner, "return await tools.loom.insights(" +
                        json.dumps({"operation": "evaluation", "batch_id": combined_id}) + ");")
                    idle(host, [owner])
                    denied_events = events(root)[denied_offset:]
                    require(any(e["type"] == "tool-after"
                                and e["data"].get("tool") in ("loom_insights", "loom.insights")
                                and e["data"].get("status") == "error"
                                for e in denied_events)
                            and not any(e["type"] == "tool-after"
                                        and e["data"].get("tool") in ("loom_insights", "loom.insights")
                                        and e["data"].get("status") == "completed"
                                        for e in denied_events),
                            "Restored host returned protected material to revoked native reader")
                    request(host, "POST", f"/api/session/{owner}/agent", {"agent": "general"})
                    restored_public = report_result(scenario, owner, combined_id)
                    original_public = interpretation
                    require(restored_public["report"]["body"] == original_public,
                            "Restored public overall report differs from original native read")
                    require(restored_public["report"]["sha256"] != "",
                            "Restored public report lost its integrity identity")
                    frozen_read = scenario.invoke(owner, "review", {
                        "operation": "read", "request_id": r2
                    })
                    require(frozen_read["request"]["rechecks"] == [
                        {"request_id": r1, "finding_ids": [finding_ref]}],
                        "Fresh restored host lost the R2 historical review recheck")
                    foreign_offset = len(events(root))
                    scenario.command(unrelated, "let denied=false;try{await tools.loom.insights(" +
                        json.dumps({"operation": "evaluation", "batch_id": combined_id}) +
                        ");}catch(error){denied=true;}if(!denied)throw new Error("
                        "\"Restored foreign Session disclosed private evaluation\");return \"denied\";")
                    require(any(e["type"] == "tool-after"
                                and e["data"].get("tool") in ("loom_insights", "loom.insights")
                                and e["data"].get("status") == "error"
                                for e in events(root)[foreign_offset:]),
                            "Foreign restored-host source read did not fail")
                    check("S3-stopped-backup-restore-fresh-host-readback",
                          old_session=owner, restored_batch=combined_id,
                          restored_report_sha256=restored_public["report"]["sha256"],
                          backup_set_id=manifest["set_id"], membership=len(original_members),
                          original_unchanged=True, restored_bytes_identical=True,
                          native_revocation_preserved=True, foreign_denied=True)

                    # More than 500 authored objectives from one true original
                    # Loom record. No test writes into SQLite directly. Capture
                    # is off during native creation, so the finished population
                    # must be discovered on the next production host's startup,
                    # not from direct evaluator invocation or a prebuilt report.
                    population = make_session(host, project, "general")
                    anchor = append_original(
                        scenario, population, "One request with 501 declared work units")
                    require(isinstance(anchor.get("id"), str),
                            "Native large-population original was not created")
                    large_path = restored_state_home / "loom" / "actions-v1" / expected_scope / "learning.sqlite"
                    require(view(large_path, population).get("batch") is None,
                            "Capture-off created a large-population evaluation")
                    objectives_created = 0
                    for offset in range(0, 501, 25):
                        end = min(offset + 25, 501)
                        code = (
                            "const source_id=" + json.dumps(anchor["id"]) + ";"
                            + f"for(let i={offset};i<{end};i++){{"
                            + "const response=JSON.parse(await tools.loom.objective({"
                            + 'operation:"create",source_type:"ledger-record",'
                            + 'source_id,label:"Synthetic work unit "+i,unit_key:"unit-"+i'
                            + "})).result;"
                            + 'if(response.existing!==false)throw Error("Unexpected objective replay");'
                            + "}return " + str(end - offset) + ";"
                        )
                        try:
                            observed = scenario.command(population, code)
                        except RuntimeError as error:
                            # The outer native execute can finish while its
                            # Code Mode metadata reports a failed script.
                            # Preserve the actual error for the owning test,
                            # rather than silently accepting a partial prefix.
                            recent = [e for e in events(root) if e["type"] == "tool-after"
                                      and e["data"].get("sessionID") == population]
                            failed = [e for e in recent if e["data"].get("status") == "error"]
                            execute = [e for e in recent if e["data"].get("tool") == "execute"]
                            final = execute[-1]["data"].get("result", {}) if execute else {}
                            diagnostic = {
                                "range": [offset, end],
                                "nested_completed": len([e for e in recent
                                    if e["data"].get("tool") in ("loom_objective", "loom.objective")
                                    and e["data"].get("status") == "completed"]),
                                "native_errors": [repr(e["data"].get("error"))[:500] for e in failed[-3:]],
                                "execute_metadata": repr(final.get("metadata"))[:1000],
                                "execute_content": repr(final.get("content"))[:1000],
                            }
                            raise RuntimeError("Native large-population source creation failed: "
                                               + json.dumps(diagnostic)) from error
                        completed = [e for e in observed if e["type"] == "tool-after"
                                     and e["data"].get("sessionID") == population
                                     and e["data"].get("tool") in
                                     ("loom_objective", "loom.objective")
                                     and e["data"].get("status") == "completed"]
                        require(len(completed) == end - offset,
                                "Installed Code Mode did not execute every native objective creation")
                        objectives_created += len(completed)
                    require(objectives_created == 501,
                            "Native large-population source did not produce 501 objectives")
                    require(view(large_path, population).get("batch") is None,
                            "Capture opt-out allowed background evaluation during bulk creation")

                    host.close()
                    host = None
                    final_events(root)
                    capture.write_text(
                        "instructions: {enabled: false}\nledger: {capture: automatic}\n")
                    crashed = force_crash_mid_checkpoint(
                        args.opencode.resolve(), project, env, output,
                        large_path, population)
                    partial = crashed["durable_after_exit"]
                    large_batch = partial["id"]
                    require(partial["member_count"] == 502,
                            "The killed batch did not freeze all 501 objective members plus its Session")
                    require(partial["processed_count"] > 0
                            and partial["processed_count"] < partial["member_count"],
                            "Crash did not preserve a nonempty proper subset of member checkpoints")

                    # Native startup must recover the original frozen batch.
                    # Its old 30-second claim may remain busy after process loss;
                    # late evidence is produced while recovery is pending.
                    host = boot("large-population-recovery")
                    scenario = Scenario(host, root)
                    late = append_original(
                        scenario, population,
                        "Synthetic late source after forced process crash; belongs to the next boundary")
                    require(late.get("id") and late["id"] != anchor["id"],
                            "Late source did not originate in a new native operation")
                    recovered = None
                    end = time.monotonic() + 120
                    while time.monotonic() < end:
                        recovered = frozen_progress(large_path, population, large_batch)
                        if (recovered is not None and recovered["state"] == "complete"
                                and recovered["report_id"] is not None
                                and recovered["processed_count"] == recovered["member_count"]):
                            break
                        time.sleep(.05)
                    require(recovered is not None and recovered["state"] == "complete"
                            and recovered["report_id"] is not None,
                            "Recovery did not finish the original frozen batch")
                    require(recovered["id"] == partial["id"]
                            and recovered["identity"] == partial["identity"]
                            and recovered["membership_sha256"] == partial["membership_sha256"]
                            and recovered["member_count"] == partial["member_count"]
                            and recovered["processed_count"] == recovered["member_count"],
                            "Recovery skipped or replaced original frozen membership")
                    saved = {key: (report, checksum) for key, report, checksum
                             in partial["checkpoint_receipts"]}
                    restored = {key: (report, checksum) for key, report, checksum
                                in recovered["checkpoint_receipts"]}
                    require(saved and all(restored.get(key) == record
                                          for key, record in saved.items()),
                            "Recovering worker lost or replaced committed checkpoints")
                    with closing(sqlite3.connect(
                            large_path.as_uri() + "?mode=ro", uri=True)) as db:
                        db.execute("PRAGMA query_only=ON")
                        logical = db.execute(
                            "SELECT COUNT(*) FROM learning_evaluation_batches WHERE identity=?",
                            (partial["identity"],)).fetchone()[0]
                        reports = db.execute(
                            "SELECT COUNT(*) FROM learning_evaluation_reports "
                            "WHERE batch_id=? AND slot='overall'",
                            (large_batch,)).fetchone()[0]
                    require(logical == 1 and reports == 1,
                            "Crash retry duplicated a logical batch or overall publication")
                    outcome = report_result(scenario, population, large_batch)
                    overall = outcome["report"]["body"]
                    require(overall["population"]["authored_objectives"] == 501
                            and overall["population"]["independent_originating_requests"] is None
                            and overall["population"]["complete_through_frozen_boundary"] is True
                            and overall["coverage"]["complete_native_history"] is False,
                            "Large population inflated independence or fabricated full native history")
                    seen_members = set()
                    after = 0
                    while True:
                        page = scenario.invoke(population, "insights", {
                            "operation": "evaluation-members", "batch_id": large_batch,
                            "after": after, "limit": 10,
                        })
                        for row in page["items"]:
                            require(row["key"] not in seen_members,
                                    "Paginated native evaluation repeated a frozen member")
                            seen_members.add(row["key"])
                            require(row["report"]["availability"] == "available",
                                    "Completed population has an unavailable member")
                        if page["next_after"] is None:
                            break
                        require(page["next_after"] > after,
                                "Native report pagination failed to progress")
                        after = page["next_after"]
                    require(len(seen_members) > 500,
                            "Large native report published a truncated member prefix")

                    source_refs = set()
                    source_after = 0
                    expected_source_count = outcome["report"]["source_ref_count"]
                    while True:
                        page = scenario.invoke(population, "insights", {
                            "operation": "evaluation-sources", "batch_id": large_batch,
                            "after": source_after, "limit": 50,
                        })
                        require(page["source_ref_count"] == expected_source_count,
                                "Source-reference pagination changed the frozen denominator")
                        for ref in page["items"]:
                            identity = (ref["kind"], ref["id"], ref.get("revision"))
                            require(identity not in source_refs and ref["available"],
                                    "Source page repeated or lost an available original")
                            source_refs.add(identity)
                        if page["next_after"] is None:
                            break
                        require(page["next_after"] > source_after,
                                "Native source pagination did not progress")
                        source_after = page["next_after"]
                    require(len(source_refs) == expected_source_count
                            and sum(kind == "objective" for kind, _, _ in source_refs) == 501
                            and sum(kind == "ledger-record" and refid == anchor["id"]
                                    for kind, refid, _ in source_refs) == 1,
                            "Large native source pagination omitted or duplicated originating evidence")
                    require(not any(refid == late["id"] for _, refid, _ in source_refs),
                            "Late evidence crossed the original frozen crash boundary")
                    check("S3-501-objective-population-through-native-scheduler-and-pages",
                          owner_session=population, original_record=anchor["id"],
                          authored_objectives=501, actual_members=len(seen_members),
                          unique_source_refs=len(source_refs),
                          independent_requests="unknown", batch=large_batch,
                          trigger="installed cold-start processing, interrupted and resumed")
                    # A source created *after* freeze must result in a later
                    # revision, not silently extend the recovered report.
                    newer = None
                    deadline = time.monotonic() + 120
                    while time.monotonic() < deadline:
                        newer = frozen_progress(large_path, population)
                        if (newer is not None and newer["id"] != large_batch
                                and newer["state"] == "complete" and newer["report_id"]):
                            break
                        time.sleep(.05)
                    require(newer is not None and newer["id"] != large_batch
                            and newer["state"] == "complete" and newer["report_id"],
                            "Late source was not published in a new attributable revision")
                    next_report = report_result(scenario, population, newer["id"])
                    revised_count = next_report["report"]["body"]["population"]["source_count"]
                    require(revised_count > expected_source_count,
                            "Late-source revision did not extend the original source population")
                    # Code Mode readback is itself a real native outer execute,
                    # which can append observation evidence and later revisions.
                    # Verify the immutable predecessor chain instead of assuming
                    # that the newest report immediately follows the crashed one.
                    predecessor = next_report["batch"]["previous_batch_id"]
                    ancestry = []
                    with closing(sqlite3.connect(
                            large_path.as_uri() + "?mode=ro", uri=True)) as db:
                        db.execute("PRAGMA query_only=ON")
                        db.execute("BEGIN")
                        while predecessor is not None and predecessor != large_batch:
                            require(predecessor not in ancestry and len(ancestry) < 100,
                                    "Evaluation revision ancestry is cyclic or unbounded")
                            ancestry.append(predecessor)
                            row = db.execute(
                                "SELECT previous_batch_id,owner_session,scope_key "
                                "FROM learning_evaluation_batches WHERE id=?",
                                (predecessor,)).fetchone()
                            require(row is not None and row[1] == population
                                    and row[2] == "permitted-session-evidence",
                                    "Late-source revision ancestry crossed its source/owner boundary")
                            predecessor = row[0]
                    require(predecessor == large_batch,
                            "Late-source evaluation is not descended from the recovered frozen batch")
                    # Check that the same first historical edge is publicly
                    # reconstructible, without issuing hundreds of Code Mode
                    # introspection requests that create extra native events.
                    if ancestry:
                        first_prior = scenario.invoke(population, "insights", {
                            "operation": "evaluation", "batch_id": ancestry[0],
                        })["batch"]
                        require(first_prior["id"] == ancestry[0]
                                and first_prior["previous_batch_id"] ==
                                (ancestry[1] if len(ancestry) > 1 else large_batch),
                                "The public prior-revision reader contradicted durable ancestry")
                    # A native tool invocation may produce an authored original
                    # and separate observer metadata. Compare complete source
                    # identities and public denominators, not 'one call = one row'.
                    last_sources = set()
                    after = 0
                    while True:
                        page = scenario.invoke(population, "insights", {
                            "operation": "evaluation-sources", "batch_id": newer["id"],
                            "after": after, "limit": 50,
                        })
                        require(page["source_ref_count"] ==
                                next_report["report"]["source_ref_count"],
                                "Late revision changed its advertised source denominator")
                        for item in page["items"]:
                            identity = (item["kind"], item["id"], item.get("revision"))
                            require(identity not in last_sources and item["available"],
                                    "Late revision repeated or withheld a source")
                            last_sources.add(identity)
                        if page["next_after"] is None:
                            break
                        require(page["next_after"] > after,
                                "Late revision source pagination did not progress")
                        after = page["next_after"]
                    require(source_refs.issubset(last_sources)
                            and any(refid == late["id"] for _, refid, _ in last_sources)
                            and any(refid == anchor["id"] for _, refid, _ in last_sources)
                            and revised_count == len(last_sources)
                            and next_report["report"]["source_ref_count"] == len(last_sources),
                            "Late revision did not retain original identities and all new sources")
                    check("S3-forced-crash-partial-checkpoint-and-late-source-recovery",
                          frozen_batch=large_batch, recovered_batch=recovered["id"],
                          persisted_members=partial["member_count"],
                          checkpointed_at_crash=partial["processed_count"],
                          original_checkpoints_preserved=len(saved),
                          total_after_recovery=recovered["processed_count"],
                          logical_batches_for_frozen_identity=logical,
                          overall_publications_for_frozen_identity=reports,
                          late_source=late["id"], later_revision=newer["id"],
                          original_source_count=expected_source_count,
                          later_source_count=next_report["report"]["body"]["population"]["source_count"],
                          intervening_report_revisions=len(ancestry),
                          revision_ancestry_reaches_recovered_batch=True,
                          source_and_report_bodies_checked_through_native_tools=True,
                          host_termination=crashed["termination"],
                          host_return_code=crashed["return_code"],
                          report_is_genuine_evaluator=False)

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
    parser.add_argument("--expect-head", required=True)
    parser.add_argument("--report-directory", type=Path, required=True)
    parser.add_argument("--disable-filewatcher", action="store_true")
    result = run(parser.parse_args())
    print(json.dumps({k: result.get(k) for k in (
        "status", "e11", "genuine_evaluator", "source_head", "error", "checks")}))
    raise SystemExit({"PASS": 0, "FAIL": 1, "UNPROVEN": 2}[result["status"]])


if __name__ == "__main__":
    main()
