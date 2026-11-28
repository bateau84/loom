"""Installed ordinary-Session incremental learning with an unmodified native host.

Only the external provider is scripted. The production scheduler establishes
subjects, freezes evidence and publishes every checkpoint. Read-only SQLite
observations wait for that work; real authorized Loom tools prove readback.
No source owner, native invocation, permission identity or report is fabricated.
"""
from __future__ import annotations

import argparse
from contextlib import closing
import hashlib
import json
from pathlib import Path
import resource
import shutil
import sqlite3
import subprocess
import tempfile
import time

from installed_host_smoke import PrivateHost, installed_plugin_inventory, isolated_environment, require
from installed_instruction_variants import verify_host_version
from installed_learning_stage3 import HOST, make_session
from installed_learning_stage4 import assert_driver_invocations
from installed_questions import Scenario, audit_session, events, idle, result_value


def sha(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def encoded(value) -> str:
    return json.dumps(value, sort_keys=True, ensure_ascii=False, separators=(",", ":"))


class IncrementalScenario(Scenario):
    """Keep the before-admission audit offset for each planned driver turn."""
    def begin(self, session, code, hold=None):
        job, start = super().begin(session, code, hold)
        self.invocation_plan[-1]["audit_start"] = start
        return job, start


def snapshot(learning: Path, ledger: Path, owner: str) -> dict:
    """Bounded passive oracle over the known disposable store pair, not retrieval."""
    result = {}
    with closing(sqlite3.connect(learning.as_uri() + "?mode=ro", uri=True, timeout=2)) as db:
        db.execute("PRAGMA query_only=ON")
        db.execute("BEGIN")
        names = {row[0] for row in db.execute("SELECT name FROM sqlite_schema WHERE type='table'")}
        row = db.execute("SELECT state,reason,generation FROM learning_evaluation_opportunities WHERE session_id=?", (owner,)).fetchone()
        result["opportunity"] = {"state": row[0], "reason": row[1], "generation": row[2]} if row else None
        rows = db.execute("SELECT id,sequence,state,boundary_json,report_id FROM learning_evaluation_batches "
                          "WHERE owner_session=? AND scope_key GLOB 'incremental-session-evidence/*' ORDER BY sequence LIMIT 65", (owner,)).fetchall()
        require(len(rows) <= 64, "Incremental scenario exceeded its bounded checkpoint census")
        batches = []
        for ident, sequence, state, boundary, report_id in rows:
            report = db.execute("SELECT sha256,body_json FROM learning_evaluation_reports WHERE id=?", (report_id,)).fetchone() if report_id else None
            members = db.execute("SELECT key,source_refs FROM learning_evaluation_members WHERE batch_id=? ORDER BY ordinal", (ident,)).fetchall()
            batches.append({"id": ident, "sequence": sequence, "state": state, "boundary": json.loads(boundary),
                            "report_id": report_id, "report_sha256": report[0] if report else None,
                            "body": json.loads(report[1]) if report else None,
                            "members": [{"key": key, "source_refs": json.loads(refs)} for key, refs in members]})
        result["batches"] = batches
        result["legacy_batches"] = db.execute("SELECT COUNT(*) FROM learning_evaluation_batches WHERE owner_session=? AND scope_key='permitted-session-evidence'", (owner,)).fetchone()[0]
        result["objectives"] = db.execute("SELECT COUNT(*) FROM learning_objectives").fetchone()[0]
        result["activities"] = [json.loads(row[0]) for row in db.execute(
            "SELECT data_json FROM learning_subject_activities WHERE session_id=? ORDER BY sequence LIMIT 129", (owner,))] if "learning_subject_activities" in names else []
        require(len(result["activities"]) <= 128, "Incremental scenario exceeded its bounded activity census")
    with closing(sqlite3.connect(ledger.as_uri() + "?mode=ro", uri=True, timeout=2)) as db:
        db.execute("PRAGMA query_only=ON")
        rows = db.execute("SELECT seq,data FROM ledger WHERE session_id=? ORDER BY seq LIMIT 129", (owner,)).fetchall()
        require(len(rows) <= 128, "Incremental scenario exceeded its bounded original census")
        result["ledger"] = [{"sequence": sequence, "record": json.loads(data)} for sequence, data in rows]
        result["actions"] = db.execute("SELECT COUNT(*) FROM actions").fetchone()[0]
        result["plans"] = db.execute("SELECT COUNT(*) FROM plans").fetchone()[0]
    return result


def settled(learning: Path, ledger: Path, owner: str, *, generation=0, timeout=30) -> dict:
    end, observed = time.monotonic() + timeout, None
    while time.monotonic() < end:
        observed = snapshot(learning, ledger, owner)
        batches, opportunity = observed["batches"], observed["opportunity"]
        through = batches[-1]["boundary"]["through_ledger"] if batches else -1
        maximum = observed["ledger"][-1]["sequence"] if observed["ledger"] else 0
        # A historical blocked attempt can remain for audit after a successful
        # replacement. Only the current committed cursor establishes catch-up.
        if (batches and batches[-1]["state"] == "complete" and batches[-1]["body"]
                and through == maximum and opportunity and opportunity["state"] == "idle"
                and opportunity["generation"] >= generation):
            return observed
        time.sleep(.05)
    raise RuntimeError("Incremental scheduler did not settle within its bound: " + encoded({
        "opportunity": observed and observed["opportunity"],
        "batches": [{"id": row["id"], "state": row["state"], "through": row["boundary"]["through_ledger"]}
                    for row in (observed or {}).get("batches", [])]}))


def checkpoint_identity(state: dict) -> list:
    return [(row["id"], row["report_id"], row["report_sha256"]) for row in state["batches"]]


def member_sources(state: dict) -> list:
    return [source for batch in state["batches"] if batch["state"] == "complete"
            for member in batch["members"] for source in member["source_refs"]]


def assert_idle_driver(observed: list, planned: dict) -> None:
    """A real no-tool native turn has one planned model step, followed by idle."""
    def data(kind):
        return [event["data"] for event in observed if event["type"] == kind]

    def native(kind):
        return [event["data"] for event in data("native-event") if event.get("type") == kind]

    session, text = planned["session_id"], "LOOM_HARNESS_JOB:" + planned["job"]
    prompts = data("prompt")
    require(len(prompts) == 1 and prompts[0].get("sessionID") == session
            and prompts[0].get("prompt", {}).get("text") == text, "Idle turn lost its planned native prompt")
    message = prompts[0].get("messageID")
    require(isinstance(message, str) and message, "Idle turn lacks its native input identity")
    require([(item.get("sessionID"), item.get("inboxID"), item.get("item", {}).get("type"),
              item.get("item", {}).get("payload", {}).get("text")) for item in native("session.inbox.enqueued")]
            == [(session, message, "user", text)], "Idle turn admitted an extra or substituted input")
    require([(item.get("sessionID"), item.get("inboxID")) for item in native("session.inbox.delivered")]
            == [(session, message)], "Idle turn delivered an extra or substituted input")
    requests, providers = data("model-request"), data("provider-request")
    starts, ends = native("session.step.started"), native("session.step.ended")
    require(len(requests) == len(providers) == len(starts) == len(ends) == 1,
            "Idle processing dispatched an unexpected model/provider step")
    require(requests[0].get("kind") == "primary" and requests[0].get("sessionID") == session
            and requests[0].get("model", {}).get("providerID") == "question-fixture"
            and requests[0].get("model", {}).get("id") == "reader",
            "Idle turn changed its planned model or native principal")
    step = starts[0].get("assistantMessageID")
    require(isinstance(step, str) and step and starts[0].get("sessionID") == session
            and ends[0].get("sessionID") == session and ends[0].get("assistantMessageID") == step
            and ends[0].get("finish") == "stop", "Idle turn lacks one exact stopped native step")
    require(providers[0].get("role") == "reader"
            and providers[0].get("headers", {}).get("x-opencode-session-id") == session,
            "Idle turn changed its provider recipient")
    users = [item.get("content") for item in providers[0].get("prompt", []) if item.get("role") == "user"]
    content = users[-1] if users else None
    actual = content if isinstance(content, str) else "\n".join(part.get("text", "") for part in content or [] if part.get("type") == "text")
    require(actual == text, "Idle provider input differs from the planned native prompt")
    require(not data("tool-before") and not data("tool-after"), "No-tool idle turn executed an unplanned tool")


def assert_no_automatic_effects(observed: list, plan: list[dict], owner: str) -> dict:
    """Reconcile the entire native sequence, including all idle opportunities."""
    prompts = [(index, event["data"]) for index, event in enumerate(observed) if event["type"] == "prompt"]
    require(plan and len(prompts) == len(plan), "Unexpected or missing driver/native prompt")
    require(len({item["job"] for item in plan}) == len(plan), "Repeated planned job")
    starts = [item.get("audit_start") for item in plan]
    require(all(isinstance(start, int) and 0 <= start < len(observed) for start in starts)
            and starts == sorted(set(starts)), "Driver audit boundaries are missing or repeated")
    for number, (planned, (_, prompt)) in enumerate(zip(plan, prompts)):
        require(prompt.get("sessionID") == planned["session_id"] == owner
                and prompt.get("prompt", {}).get("text") == "LOOM_HARNESS_JOB:" + planned["job"],
                "Native prompt sequence differs from the planned engineering/read/idle jobs")
        start, stop = starts[number], starts[number + 1] if number + 1 < len(starts) else len(observed)
        section = observed[start:stop]
        if planned.get("idle_only"):
            assert_idle_driver(section, planned)
        else:
            assert_driver_invocations(section, [planned])
    require(not any(event["type"] in ("model-request", "provider-request", "tool-before", "tool-after")
                    for event in observed[:starts[0]]), "Unplanned processing preceded the first driver prompt")
    expected_requests = sum(1 if item.get("idle_only") else 2 for item in plan)
    require(sum(event["type"] == "model-request" for event in observed) == expected_requests
            and sum(event["type"] == "provider-request" for event in observed) == expected_requests,
            "Automatic learning dispatched an additional model/provider request")
    created = {event["data"].get("data", {}).get("sessionID") for event in observed
               if event["type"] == "native-event" and event["data"].get("type") == "session.created"}
    require(created == {owner}, "Automatic learning created another native Session")
    require(not any(event["type"] == "tool-before" and event["data"].get("tool")
                    in ("subagent", "loom_tweak", "loom.tweak") for event in observed),
            "Automatic learning dispatched a child or changed instructions")
    require(not any(event["type"] == "native-event" and
                    (event["data"].get("type") == "session.synthetic"
                     or event["data"].get("data", {}).get("item", {}).get("type") == "synthetic")
                    for event in observed), "Automatic learning injected a synthetic input into the original conversation")
    return {"planned_jobs": len(plan), "idle_turns": sum(bool(item.get("idle_only")) for item in plan),
            "planned_model_requests": expected_requests, "automatic_model_requests": 0,
            "new_learning_sessions": 0, "automatic_conversation_injections": 0,
            "native_sequence_reconciled": True,
            "qualification": "Serial scripted driver accounting, not production inference or protected-send authority"}


def run(args) -> dict:
    repo, output = args.repository.resolve(), args.report_directory.resolve()
    output.mkdir(parents=True, exist_ok=False, mode=0o700)
    result = {"format": "loom-installed-incremental-learning/v1", "status": "UNPROVEN", "checks": [],
              "genuine_evaluator": "UNPROVEN", "production_inference": "UNQUALIFIED",
              "limitations": ["Controlled ordinary Session, not a recovered private historical engineering conversation.",
                              "Scripted external provider drives native tools; it does not supply learning reports or qualify model reasoning.",
                              "Explicit report inspections appear in their requesting driver's context; automatic learning never injects them.",
                              "Read-only database observations establish scheduler state, while public tools establish authorized readback."]}
    host = None
    started, resources = time.monotonic(), resource.getrusage(resource.RUSAGE_CHILDREN)
    try:
        require(args.opencode is not None and args.opencode.is_file(), "Pinned installed OpenCode binary missing")
        result["source_head"] = subprocess.check_output(["git", "-C", str(repo), "rev-parse", "HEAD"], text=True).strip()
        require(result["source_head"] == args.expect_head, "Installed incremental proof differs from the reviewed head")
        require(not subprocess.check_output(["git", "-C", str(repo), "status", "--porcelain"], text=True).strip(),
                "Installed incremental qualification requires a clean exact candidate")
        result["candidate"] = installed_plugin_inventory(args.artifact.resolve(), args.plugin.resolve(), args.expect_plugin_version, HOST)
        runtime = [repo / "server.ts", *[path for path in (repo / "src").rglob("*") if path.is_file()]]
        require(all((args.plugin / path.relative_to(repo)).is_file() and sha(path) == sha(args.plugin / path.relative_to(repo)) for path in runtime),
                "Packed production runtime differs from the candidate")
        result["runtime_files_checked"] = len(runtime)
        result["input_sha256"] = {name: sha(repo / name) for name in (
            "tests/installed_incremental_learning.py", "tests/installed_learning_stage3.py", "tests/installed_learning_stage4.py",
            "tests/installed_questions.py", "tests/installed_host_smoke.py", "tests/question-host/server.ts", "tests/question-host/provider.mjs",
            "package.json", "bun.lock", ".bun-version")}
        with tempfile.TemporaryDirectory(prefix="loom-installed-incremental-") as temporary:
            root = Path(temporary).resolve()
            project = root / "project"
            project.mkdir()
            env = isolated_environment(root)
            env["LOOM_QUESTION_FIXTURE"] = str(root)
            if args.disable_filewatcher:
                env["OPENCODE_FILEWATCHER_DISABLE"] = "1"
                result["filewatcher"] = "disabled; watcher behavior unqualified"
            version = subprocess.check_output([str(args.opencode.resolve()), "--version"], text=True, env=env, timeout=15).strip()
            verify_host_version(version)
            result["host"] = {"version": version, "sha256": sha(args.opencode.resolve())}
            config = {"plugins": ["*", str(args.plugin.resolve()), str(repo / "tests/question-host")],
                      "agents": {"general": {"description": "Private ordinary-Session incremental mechanics fixture",
                          "mode": "primary", "system": "Execute only the local scripted fixture job.",
                          "model": "question-fixture/reader", "permissions": [{"action": "*", "resource": "*", "effect": "allow"}]}},
                      "model": "question-fixture/reader", "update": "disable", "share": "disabled"}
            (Path(env["OPENCODE_CONFIG_DIR"]) / "opencode.json").write_text(encoded(config))
            # Deliberately omit learning.incremental: this qualifies the product default.
            (project / ".loom.yaml").write_text("instructions: {enabled: false}\nledger: {capture: automatic}\nlearning: {coalesce-ms: 1000}\n")
            (root / "jobs.json").write_text("{}")
            subprocess.run(["git", "init", "-q", str(project)], check=True, env=env, timeout=10)
            plan, readbacks = [], []
            with audit_session(root) as audit:
                try:
                    host = PrivateHost(str(args.opencode.resolve()), project, env, output, "incremental")
                    require(json.loads(host.get("/api/info", "info")).get("version") == HOST, "Wrong actual installed host")
                    host.wait_roster("/api/plugin", "plugins", lambda rows: all(any(row.get("id") == name
                        and row.get("state", {}).get("status") == "active" for row in rows) for name in ("loom", "loom.question.fixture")))
                    scenario = IncrementalScenario(host, root, plan)
                    owner = make_session(host, project, "general")
                    result["session_id"] = owner
                    learning = list(Path(env["XDG_STATE_HOME"]).rglob("learning.sqlite"))
                    ledger = list(Path(env["XDG_STATE_HOME"]).rglob("ledger.sqlite"))
                    require(len(learning) == len(ledger) == 1, "Expected one existing private store pair")
                    learning, ledger = learning[0], ledger[0]

                    def check(name, **evidence):
                        result["checks"].append({"name": name, "status": "PASS", **evidence})
                        print("PASS " + name, flush=True)

                    def source_job(values):
                        code = "const inputs=" + encoded(values) + ";for(const value of inputs)await tools.loom.record(value);return 'saved';"
                        receipts = scenario.command(owner, code)
                        originals = [result_value(event) for event in receipts if event["type"] == "tool-after"
                                     and event["data"].get("tool") in ("loom_record", "loom.record")]
                        require(len(originals) == len(values) and all(record.get("session_id") == owner for record in originals),
                                "Source creation did not return each native original")
                        return originals

                    def inspect(tool, query):
                        value = scenario.invoke(owner, tool, query)
                        text = encoded(value)
                        require(len(text.encode()) <= 262144, "Public incremental read exceeded its byte bound")
                        readbacks.append({"tool": tool, "operation": query["operation"], "bytes": len(text.encode()),
                                          "sha256": hashlib.sha256(text.encode()).hexdigest()})
                        return value

                    originals = source_job([
                        {"operation": "add", "session_only": True, "kind": "claim", "statement": "Intent: repair the Waybar network label without changing unrelated configuration."},
                        {"operation": "add", "session_only": True, "kind": "concern", "statement": "Ethernet remains unverified; a Wi-Fi-only recovery does not clear this concern."}])
                    first = settled(learning, ledger, owner)
                    first_ids = {record["id"] for record in originals}
                    require(first_ids.issubset({ref["id"] for ref in member_sources(first)}), "First automatic increment omitted original engineering evidence")
                    require(first["legacy_batches"] == first["actions"] == first["plans"] == first["objectives"] == 0,
                            "Default Session processing required or fabricated legacy goals")
                    check("incremental-default-ordinary-session", batches=len(first["batches"]), authored_originals=len(originals),
                          actions=0, plans=0, objectives=0, legacy_batches=0)

                    # Each empty scripted prompt is a real native one-step turn.
                    # Its context/idle notifications create scheduler opportunity,
                    # while no tool, source append or fake hook is introduced.
                    idle_receipts = []
                    stable = first
                    for _ in range(2):
                        generation = stable["opportunity"]["generation"]
                        scenario.begin(owner, "")
                        plan[-1]["idle_only"] = True
                        idle(host, [owner])
                        following = settled(learning, ledger, owner, generation=generation + 1)
                        require(checkpoint_identity(following) == checkpoint_identity(stable)
                                and following["ledger"] == stable["ledger"],
                                "Repeated idle reprocessed evidence or created an unrequested original")
                        idle_receipts.append({"from_generation": generation, "through_generation": following["opportunity"]["generation"],
                                              "checkpoint_ids": [batch["id"] for batch in following["batches"]]})
                        stable = following
                    check("native-repeated-idle-reuses-successful-cursor", opportunities=idle_receipts)

                    corrections = source_job([
                        {"operation": "add", "session_only": True, "kind": "result", "statement": "Correction: binding the widget to the active Wi-Fi interface restored the label."},
                        {"operation": "add", "session_only": True, "kind": "qa", "verdict": "pass", "statement": "Reported Wi-Fi reconnect passed. Ethernet remains outside the verification."}])
                    second = settled(learning, ledger, owner)
                    require(len(second["batches"]) > len(first["batches"]), "Later evidence did not produce a new committed increment")
                    require(checkpoint_identity(second)[:len(first["batches"])] == checkpoint_identity(first), "Later evidence rewrote an earlier report")
                    all_sources = member_sources(second)
                    require(len({(ref["kind"], ref["id"], ref.get("revision")) for ref in all_sources}) == len(all_sources),
                            "Committed increments processed an original more than once")
                    for record in [*originals, *corrections]:
                        require(sum(ref["id"] == record["id"] for ref in all_sources) == 1, "An authored original was skipped or duplicated")
                    prior_concern = originals[1]["id"]
                    require(any(item["source"]["id"] == prior_concern for item in second["batches"][-1]["body"]["retained"]["concerns"]),
                            "Later passing verification lost the earlier scoped concern")
                    automatic_events = events(root)
                    require(not any("loom-incremental-learning-report/v1" in encoded(event["data"].get("prompt", []))
                                    for event in automatic_events if event["type"] == "provider-request"),
                            "Background learning injected a report into the engineering model context")
                    check("later-correction-processes-new-evidence-and-retains-context", first_checkpoints=len(first["batches"]),
                          later_checkpoints=len(second["batches"]), unique_originals=len(all_sources), retained_concern=prior_concern)

                    established = inspect("review", {"operation": "establish-subject", "target": {"kind": "session", "id": owner},
                        "question": "Explain the scoped Wi-Fi recovery and the still-unverified Ethernet path."})
                    preview = inspect("history", {**established["preview"], "limit": 50})
                    require(preview["member_count"] == len(preview["items"]) and preview["freeze"], "Bounded ordinary Session preview did not expose an inspectable foundation")
                    frozen = inspect("review", preview["freeze"])
                    frozen_sources = {item["source"]["id"] for item in frozen["items"]}
                    require({record["id"] for record in [*originals, *corrections]}.issubset(frozen_sources), "Frozen ordinary subject lost its authored trajectory")

                    progress = inspect("insights", {"operation": "learning-progress", "limit": 5})
                    require(progress["format"] == "loom-incremental-learning-progress/v1"
                            and progress["inference"]["state"] == "disabled"
                            and progress["inference"]["execution_authority"] == "unavailable",
                            "Public progress enabled unqualified inference")
                    report = inspect("insights", {"operation": "learning-report", "batch_id": second["batches"][-1]["id"]})
                    require(report["availability"] == "available" and report["body"]["objective_success"] == "not-assessed",
                            "Incremental readback fabricated completion or withheld its intact engineering foundation")
                    concern = next((item for item in report["body"]["retained"]["concerns"] if item["source"]["id"] == prior_concern), None)
                    require(concern and concern["inspect"]["batch_id"] in {batch["id"] for batch in first["batches"]},
                            "Retained concern lost the earlier checkpoint's exact original selector")
                    source = inspect("insights", concern["inspect"])
                    require(source["availability"] == "available" and source["value"] == originals[1], "Supported source reader changed the exact retained original")
                    failed_query = {**concern["inspect"], "member_key": "deliberately-unavailable-member"}
                    failure = scenario.command(owner, "let denied=false;try{await tools.loom.insights(" + encoded(failed_query)
                        + ")}catch(error){denied=true}if(!denied)throw Error('Missing original unexpectedly readable');return 'denied';")
                    require(any(event["type"] == "tool-after" and event["data"].get("tool") in ("loom_insights", "loom.insights")
                                and event["data"].get("status") == "error" for event in failure), "Failed retrieval was not an actual native tool failure")
                    final_state = settled(learning, ledger, owner)
                    calls = {(item["invocation"]["message_id"], item["invocation"]["call_id"])
                             for item in final_state["activities"] if item.get("invocation")}
                    learning_rows = {item["record"]["id"] for item in final_state["ledger"]
                                     if item["record"].get("kind") == "observation"
                                     and item["record"].get("data", {}).get("tool") == "execute"
                                     and (item["record"]["data"].get("message_id"), item["record"]["data"].get("call_id")) in calls}
                    require(learning_rows and not learning_rows.intersection(frozen_sources), "Native evaluation wrappers entered the original frozen subject")
                    current = final_state["batches"][-1]["body"]
                    require(not any(item["source"]["id"] in learning_rows for key in ("concerns", "unfinished") for item in current["retained"][key]),
                            "Failed evidence retrieval contaminated current engineering findings")
                    require(any(item.get("outcome") == "failed" and item.get("detail") == "insights:learning-source"
                                and item.get("returned_bytes") == 0 for item in final_state["activities"]), "Failed retrieval lost its separate audit/resource accounting")
                    require(any(item["source"]["id"] == prior_concern for item in current["retained"]["concerns"]), "Readback activity lost an important earlier finding")
                    reread = inspect("history", {"operation": "population", "population_id": frozen["population_id"],
                        "manifest_sha256": frozen["manifest_sha256"], "limit": 50})
                    require({item["source"]["id"] for item in reread["items"]} == frozen_sources, "Later evaluation activity silently entered frozen membership")
                    require(final_state["actions"] == final_state["plans"] == final_state["objectives"] == 0,
                            "Ordinary Session inspection fabricated historical goal membership")
                    check("supported-readback-and-native-evaluation-isolation", public_reads=len(readbacks), exact_original_reads=1,
                          failed_original_reads=1, classified_native_wrappers=len(learning_rows), frozen_members=len(frozen_sources),
                          original_subject_unchanged=True, failed_retrieval_is_engineering_finding=False)
                    host.close()
                    host = None
                    captured = audit.finalize(output / "audit.ndjson")
                    effects = assert_no_automatic_effects(captured.events, plan, owner)
                    check("no-recursive-model-execution-or-conversation-injection", **effects)
                    result["audit_sha256"], result["audit_bytes"], result["audit_receipts"] = captured.sha256, captured.byte_count, len(captured.events)
                    result["readbacks"], result["driver_plan"] = readbacks, plan
                    result["status"] = "PASS"
                except Exception as error:
                    result["status"] = "FAIL"
                    result.setdefault("error", f"{type(error).__name__}: {error}")
                    raise
                finally:
                    if host is not None:
                        host.close()
                        host = None
                    if result["status"] != "PASS":
                        try:
                            captured = audit.finalize(output / "audit.ndjson")
                            result["audit_sha256"], result["audit_bytes"], result["audit_receipts"] = captured.sha256, captured.byte_count, len(captured.events)
                        except Exception as error:
                            result["audit_error"] = f"{type(error).__name__}: {error}"
                            result.setdefault("error", result["audit_error"])
    except Exception as error:
        result["status"] = "FAIL"
        result.setdefault("error", f"{type(error).__name__}: {error}")
    finally:
        usage = resource.getrusage(resource.RUSAGE_CHILDREN)
        result["resources"] = {"elapsed_seconds": time.monotonic() - started,
                               "child_user_seconds": usage.ru_utime - resources.ru_utime,
                               "child_system_seconds": usage.ru_stime - resources.ru_stime,
                               "peak_child_rss_kib": usage.ru_maxrss,
                               "qualification": "Process-level fixture resource observation; not per-model billing"}
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
    print(json.dumps({key: result.get(key) for key in ("status", "checks", "error")}))
    raise SystemExit(0 if result["status"] == "PASS" else 1)


if __name__ == "__main__":
    main()
