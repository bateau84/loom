"""Installed OpenCode 2.2.6 objective-source qualification, without paid inference.

This is a scripted-provider/native-host mechanical exercise, NOT a real Coder
reasoning trial, human acceptance or independent effectiveness judgment.
The installed Loom artifact owns all objective and ledger writes.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import secrets
import shutil
import sqlite3
import subprocess
import sys
import tempfile
from contextlib import closing
from pathlib import Path

from installed_host_smoke import PrivateHost, installed_plugin_inventory, isolated_environment, require
from installed_questions import Scenario, events, idle, request


def original_user(host, session):
    messages = request(host, "GET", f"/api/session/{session}/message?order=desc&limit=100")
    require(isinstance(messages, list), "Native Session message API returned no list")
    found = [m for m in messages
             if m.get("type") == "user" and isinstance(m.get("id"), str)
             and str(m.get("text", "")).startswith("LOOM_HARNESS_JOB:")]
    require(len(found) >= 1, "Missing native original source user message")
    return found[-1]["id"]


def native_edit(host, root, scenario, session, before, after):
    """Drive the *installed native edit tool* using the external local provider."""
    job = secrets.token_hex(8)
    scenario.jobs[job] = {"code": None, "hold": None, "nativeEdit": True,
                          "edit": {"path": "objective_runtime.py",
                                   "oldString": before, "newString": after}}
    (root / "jobs.json").write_text(json.dumps(scenario.jobs))
    start = len(events(root))
    request(host, "POST", f"/api/session/{session}/prompt", {"text": "LOOM_HARNESS_JOB:" + job})
    idle(host, [session])
    observed = [e["data"] for e in events(root)[start:]
                if e["type"] == "tool-after"
                and e["data"].get("sessionID") == session and e["data"].get("tool") == "edit"]
    require(len(observed) == 1 and observed[0]["status"] == "completed",
            "Installed native edit was absent, repeated or did not succeed: " + str(observed))
    return observed[0]


def runtime_check(project):
    """An actual executed scenario, not a fixture-supplied pass/fail flag."""
    completed = subprocess.run([sys.executable, str(project / "objective_runtime.py")],
                               cwd=project, text=True, capture_output=True, timeout=5, check=False)
    require(completed.returncode == 0, "Runtime scenario crashed; not a comparable correction check")
    return completed.stdout.strip() == "EXPECTED", completed.stdout.strip()


def exercise(host, scenario, root, project):
    parent = scenario.session("reader")
    scenario.command(parent, "return await tools.loom.agents({})")
    original = original_user(host, parent)
    native = scenario.invoke(parent, "trace", {"operation": "timeline", "limit": 50})
    require(any(e.get("source_message_id") == original and e["kind"] == "user_prompt"
                for e in native["events"]), "The original request is not observable in native context")
    empty = scenario.invoke(parent, "objective", {"operation": "list"})
    require(not empty["items"], "Disposable objective storage was not empty")

    anchor = {"operation": "create", "source_type": "native-message", "source_id": original,
              "unit_key": "feature", "label": "Scripted runtime objective, not live engineering"}
    objective = scenario.invoke(parent, "objective", anchor)
    require(objective["existing"] is False and objective["author_session"] == parent,
            "Real original request did not establish an attributed objective")
    repeated = scenario.invoke(parent, "objective", anchor)
    require(repeated["id"] == objective["id"] and repeated["existing"] is True,
            "Original request was duplicated on retry")
    other = scenario.invoke(parent, "objective", {**anchor, "unit_key": "unrelated",
        "label": "Separate objective in the same parent Session"})
    require(other["id"] != objective["id"], "Distinct goals in one Session were merged")

    action = scenario.invoke(parent, "action", {"operation": "create",
              "title": "Disposable runtime acceptance", "goal": "EXPECTED runtime output"})
    source = project / "objective_runtime.py"
    source.write_text('print("initial")\n')
    previous, attempts, verifications, child_ids = "initial", [], [], []
    for attempt in range(1, 4):
        child = request(host, "POST", "/api/session", {
            "parentID": parent, "agent": "question-reader", "title": "scripted attempt",
            "model": {"providerID": "question-fixture", "id": "reader"},
            "location": {"directory": str(project)}})["id"]
        child_ids.append(child)
        checked = request(host, "GET", f"/api/session/{child}")
        require(checked.get("parentID") == parent, "Native child ancestry did not match")

        if attempt > 1:
            intent = scenario.invoke(parent, "record", {"operation": "add", "kind": "result",
                "session_only": True, "statement": f"Fixture controller created native child {child} "
                     f"after a failed runtime verification in the same objective"})
            corrective = scenario.invoke(parent, "objective", {
                "operation": "link", "objective_id": objective["id"], "phase": "corrective-dispatch",
                "source_type": "ledger-record", "source_id": intent["id"],
                "related_sequence": verifications[-1],
                "note": "Manual native child creation with verified parentID; not model-selected delegation"})
            require(corrective["related_sequence"] == verifications[-1],
                    "Corrective redispatch was not tied to the failed check")

        expected_text = "EXPECTED" if attempt == 3 else f"WRONG_{attempt}"
        edit = native_edit(host, root, scenario, child, previous, expected_text)
        require(source.read_text() == f'print("{expected_text}")\n',
                "Real native edit did not update the runtime source exactly")
        previous = expected_text
        reported = scenario.invoke(child, "record", {"operation": "add", "kind": "result",
            "session_only": True,
            "statement": f"Scripted Coder DONE attempt {attempt}: native edit completed; "
                         "parent must check runtime output"})
        require(reported["session_id"] == child and reported["kind"] == "result",
                "Child did not persist its own native-attributed handback")

        child_export = request(host, "GET",
            f"/api/experimental/session/{child}/export?sanitize=true")
        require(child_export.get("info", {}).get("id") == child, "Wrong native child export")
        export_path = f"objective-child-{attempt}.json"
        (project / export_path).write_text(json.dumps({"data": child_export}))
        child_message = original_user(host, child)
        association = scenario.invoke(parent, "objective", {
            "operation": "link", "objective_id": objective["id"], "phase": "coordination",
            "source_type": "native-message", "source_id": child_message,
            "source_session_id": child, "export_path": export_path,
            "note": "Explicit association with inspected native child, not inferred from parentage"})
        require(association["parent_session_id"] == parent
                and association["verification"] == "provided-export-unverified",
                "Child source did not preserve original native ancestry and export caveat")

        handback = scenario.invoke(parent, "objective", {
            "operation": "link", "objective_id": objective["id"], "phase": "handback",
            "source_type": "ledger-record", "source_id": reported["id"],
            "assessment": "reported-done", "note": "Original scripted child claimed DONE"})
        require(handback["source_session_id"] == child and handback["source_id"] == reported["id"],
                "Handback lost original child authorship")

        passed, output = runtime_check(project)
        require(passed == (attempt == 3), "External runtime check did not produce two failures then a pass")
        qa = scenario.invoke(parent, "record", {
            "operation": "add", "kind": "qa", "action_id": action["id"],
            "verdict": "pass" if passed else "fail",
            "statement": f"Python subprocess verified attempt {attempt}: expected EXPECTED, got {output}"})
        check = scenario.invoke(parent, "objective", {
            "operation": "link", "objective_id": objective["id"], "phase": "verification",
            "source_type": "ledger-record", "source_id": qa["id"],
            "related_sequence": handback["sequence"],
            "assessment": "pass" if passed else "fail",
            "note": "Original QA record corroborated by the installed-host harness subprocess"})
        verifications.append(check["sequence"])
        attempts.append({"child": child, "handback": handback["sequence"],
                         "verification": check["sequence"], "runtime_pass": passed,
                         "native_edit_call": edit.get("id")})
    final = scenario.invoke(parent, "objective", {
        "operation": "link", "objective_id": objective["id"], "phase": "outcome",
        "source_type": "ledger-record", "source_id": qa["id"],
        "related_sequence": verifications[-1], "assessment": "pass",
        "note": "Eventually passed the scripted runtime scenario; not real-model reasoning"})
    require(final["related_sequence"] == verifications[-1], "Final outcome is detached from runtime check")

    by_source = scenario.invoke(parent, "objective", {
        "operation": "find", "source_type": "native-message",
        "source_id": original, "source_session_id": parent})
    require({x["id"] for x in by_source["items"]} == {objective["id"], other["id"]},
            "A shared native source incorrectly merged or hid objective identities")
    denied_session = scenario.session("reader")
    rejected = ("let rejected=false;try{await tools.loom.objective("
        + json.dumps({"operation": "link", "objective_id": objective["id"],
            "phase": "coordination", "source_type": "native-message", "source_id": child_message,
            "source_session_id": child})
        + ")}catch(e){rejected=true}if(!rejected)throw new Error('Foreign native context leaked');return true")
    scenario.command(denied_session, rejected)

    first = scenario.invoke(parent, "objective", {
        "operation": "read", "objective_id": objective["id"], "limit": 3})
    ceiling = first["snapshot_max_sequence"]
    late = scenario.invoke(parent, "objective", {
        "operation": "link", "objective_id": objective["id"], "phase": "coverage-gap",
        "source_type": "unavailable", "source_id": "opaque-code-mode", "gap_reason": "opaque-tool",
        "confidence": "uncertain",
        "note": "Inner Code Mode tool history is not guaranteed visible in native transcript"})
    require(late["sequence"] > ceiling, "Late source did not advance immutable sequence")
    pages, cursor = [first], first["next_cursor"]
    while cursor is not None and len(pages) < 20:
        page = scenario.invoke(parent, "objective", {
            "operation": "read", "objective_id": objective["id"], "cursor": cursor, "limit": 3})
        pages.append(page)
        cursor = page["next_cursor"]
    require(cursor is None, "Objective trajectory did not finish bounded cursor traversal")
    saved = [item for page in pages for item in page["entries"]]
    require(saved and len({e["sequence"] for e in saved}) == len(saved)
            and all(e["sequence"] <= ceiling for e in saved),
            "Snapshot cursor repeated or admitted concurrent new links")
    require([e["sequence"] for e in saved if e["phase"] == "handback"] ==
            [a["handback"] for a in attempts],
            "Native handback sources were lost or misordered")
    require([e["assessment"] for e in saved if e["phase"] == "verification"] ==
            ["fail", "fail", "pass"], "Original outcome judgments were conflated")
    require(sum(e["phase"] == "corrective-dispatch" for e in saved) == 2,
            "The initial and corrective attempts were not distinguished")
    require(sum(e["phase"] == "outcome" for e in saved) == 1,
            "The final outcome was counted more than once")
    require(sum(e["phase"] == "request" for e in saved) == 1,
            "One objective did not retain exactly one source request")

    state = list((root / "state/loom/actions-v1").glob("*/"))
    require(len(state) == 1, "Expected one isolated Loom state directory")
    with closing(sqlite3.connect((state[0] / "ledger.sqlite").as_uri() + "?mode=ro", uri=True)) as db:
        require(not db.execute("SELECT 1 FROM ledger WHERE kind='observation' LIMIT 1").fetchone(),
                "Automatic observation capture ignored ledger.capture: off")
        require(not db.execute("SELECT 1 FROM sqlite_schema WHERE name LIKE 'learning_objective%'").fetchone(),
                "Objective storage modified the frozen Action database")
    with closing(sqlite3.connect((state[0] / "learning.sqlite").as_uri() + "?mode=ro", uri=True)) as db:
        require(db.execute("SELECT COUNT(*) FROM learning_objectives").fetchone()[0] == 2,
                "A child handback or correction became a duplicate objective")
        require(db.execute("SELECT COUNT(*) FROM learning_objective_links WHERE objective_id=?",
                           (objective["id"],)).fetchone()[0] == len(saved) + 1,
                "Stored source trajectory count disagrees with the public cursor")
    return {"objective_id": objective["id"], "original_message": original,
            "other_objective_id": other["id"], "parent": parent,
            "attempts": attempts, "snapshot_sequence": ceiling, "source_events": len(saved),
            "gap_sequence": late["sequence"], "child_sessions": child_ids}


def run(args):
    output = args.report_directory.resolve()
    output.mkdir(parents=True, exist_ok=False)
    report = {"status": "UNPROVEN", "kind": "installed-objective-mechanics",
              "scope": "Exact OpenCode 2.2.6 + installed Loom artifact + local scripted model",
              "limitations": ["Fixture-driven native edits, not model reasoning or a real engineering work audit.",
                              "Actual Python runtime checks, but their QA records are authored interpretations.",
                              "Sanitized native exports are not cryptographic proofs of complete Session history."]}
    try:
        report["candidate"] = installed_plugin_inventory(args.artifact.resolve(), args.plugin.resolve(),
                                                         args.expect_plugin_version, "2.2.6")
        report["source_sha256"] = {str(path): hashlib.sha256((args.repository / path).read_bytes()).hexdigest()
                                   for path in (Path("tests/installed_objectives.py"),
                                                Path("tests/question-host/server.ts"),
                                                Path("src/objectives.ts"))}
        version = subprocess.check_output([str(args.opencode.resolve()), "--version"],
                                          text=True, timeout=15).strip()
        require(version in ("2.2.6", "opencode v2.2.6"), "Unexpected exact OpenCode host: " + version)
        report["host_version"] = version
        with tempfile.TemporaryDirectory(prefix="loom-objectives-") as private:
            root = Path(private).resolve()
            project = root / "project"
            project.mkdir()
            env = isolated_environment(root)
            env["LOOM_QUESTION_FIXTURE"] = str(root)
            subprocess.run(["git", "init", "-q", str(project)], env=env, check=True)
            config = {"plugins": ["*", str(args.plugin.resolve()),
                                 str(args.repository / "tests/question-host")],
                      "agents": {"question-reader": {"description": "Scripted native objective fixture",
                                  "mode": "primary", "model": "question-fixture/reader",
                                  "permissions": [{"action": "edit", "resource": "*", "effect": "allow"}],
                                  "system": "Follow only the local scripted provider's task."}},
                      "model": "question-fixture/reader", "update": "disable", "share": "disabled"}
            (Path(env["OPENCODE_CONFIG_DIR"]) / "opencode.json").write_text(json.dumps(config))
            (project / ".loom.yaml").write_text(
                "agents: {}\ninstructions: {enabled: false}\nledger: {capture: off}\n")
            (root / "jobs.json").write_text("{}")
            report["config_sha256"] = hashlib.sha256(json.dumps(config, sort_keys=True).encode()).hexdigest()

            def start(label):
                host = PrivateHost(str(args.opencode.resolve()), project, env, output, label)
                try:
                    require(json.loads(host.get("/api/info", "info"))["version"] == "2.2.6",
                            "Wrong installed host version")
                    host.wait_roster("/api/plugin", "plugins", lambda xs:
                        all(any(p["id"] == name and p.get("state", {}).get("status") == "active"
                                for p in xs) for name in ("loom", "loom.question.fixture")))
                    return host
                except Exception:
                    host.close()
                    raise

            host = start("objective-first")
            try:
                scenario = Scenario(host, root)
                result = exercise(host, scenario, root, project)
                report["checks"] = result
            finally:
                host.close()
            require(host.proc.poll() is not None, "First host was not stopped before restart")
            restarted = start("objective-restarted")
            try:
                again = Scenario(restarted, root)
                read = again.invoke(result["parent"], "objective", {
                    "operation": "read", "objective_id": result["objective_id"], "limit": 50})
                require(read["snapshot_max_sequence"] == result["gap_sequence"],
                        "Restart lost earlier or later objective links")
                require(len(read["entries"]) == result["source_events"] + 1,
                        "Restart did not recover the exact prior trajectory")
                require(sum(e["phase"] == "handback" for e in read["entries"]) == 3
                        and sum(e["phase"] == "verification" for e in read["entries"]) == 3,
                        "Restart duplicated or lost original Coder/QA history")
                resumed = again.invoke(result["parent"], "objective", {"operation": "list"})
                require(len(resumed["items"]) == 2, "Restart invented duplicate objective identities")
                report["restart"] = {"recovered": True, "objectives": len(resumed["items"]),
                                     "source_links": len(read["entries"])}
            finally:
                restarted.close()
            require(restarted.proc.poll() is not None, "Restart host did not stop")
            observed = events(root, final=True)
            require(not any(event["type"] == "observer-failure" for event in observed),
                    "Passive host observation failed; native evidence invalid")
            report["native_model_requests"] = sum(e["type"] == "model-request" for e in observed)
            require(report["native_model_requests"] > 0, "Installed host made no actual model request")
            require(all(e["data"].get("model", {}).get("providerID") == "question-fixture"
                        for e in observed if e["type"] == "model-request"),
                    "A non-scripted paid or unqualified model was requested")
            report["status"] = "PASS"
    except Exception as error:
        report["status"] = "FAIL"
        report["error"] = f"{type(error).__name__}: {error}"
    (output / "report.json").write_text(json.dumps(report, indent=2) + "\n")
    return report


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--opencode", type=Path, required=True)
    parser.add_argument("--artifact", type=Path, required=True)
    parser.add_argument("--plugin", type=Path, required=True)
    parser.add_argument("--repository", type=Path, required=True)
    parser.add_argument("--report-directory", type=Path, required=True)
    parser.add_argument("--expect-plugin-version", required=True)
    args = parser.parse_args()
    args.repository = args.repository.resolve()
    result = run(args)
    print(json.dumps(result, indent=2))
    if result["status"] != "PASS":
        parser.exit(1, "Installed native objective qualification failed; inspect report.json\n")


if __name__ == "__main__":
    main()
