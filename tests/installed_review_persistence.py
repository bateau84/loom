"""Qualify Stage 2 request persistence through packed Loom and real OpenCode 2.2.6.

Only the external provider is scripted. Production registration, native caller
identity, permission checks, SQLite persistence and process reopen are real.
This is mechanical persistence evidence, not review execution, protected transfer,
model reasoning or assembled automatic-learning acceptance.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import secrets
import shutil
import subprocess
import tempfile
from pathlib import Path

from installed_host_smoke import PrivateHost, installed_plugin_inventory, isolated_environment, require
from installed_instruction_variants import verify_host_version
from installed_questions import Scenario, audit_session, events, final_events, idle, request, result_value

HOST = "2.2.6"
REQUIRED_CHECKS = {
    "S2-automatic-review-request-and-canonical-preparation",
    "S2-complete-public-membership",
    "S2-original-historical-work-and-qualified-finding",
    "S2-unrelated-session-denied-without-ledger-disclosure",
    "S2-process-reopen-and-canonical-replay",
    "S2-native-permission-revocation",
}


def sha(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def completed_tools(observed, session, tool):
    return [event for event in observed if event["type"] == "tool-after"
            and event["data"].get("sessionID") == session
            and event["data"].get("tool") in ("loom_" + tool, "loom." + tool)
            and event["data"].get("status") == "completed"]


def qualification_status(checks):
    names = [check["name"] for check in checks]
    return "PASS" if len(names) == len(set(names)) and set(names) == REQUIRED_CHECKS and all(
        check["status"] == "PASS" for check in checks) else "UNQUALIFIED"


def run(args):
    repo, output = args.repository.resolve(), args.report_directory.resolve()
    output.mkdir(parents=True, exist_ok=False, mode=0o700)
    report = {
        "format": "loom-installed-review-persistence/v1", "execution_status": "UNQUALIFIED",
        "learning_qualification": "UNQUALIFIED", "checks": [], "expected_host": HOST,
        "limitations": [
            "Scripted external provider; no real-model reasoning or review verdict quality qualified.",
            "Structured review delivery remains withheld; no protected transfer or native review execution claimed.",
            "Native admitted-input to execution binding remains unsupported; authored evidence links remain unknown.",
            "Normal completed-state process reopen is exercised; crash recovery and retry authority have separate transaction tests.",
            "Read revocation prevents fresh private readback; it does not erase previously authorized native conversation content.",
            "All source material and mandate text are disposable synthetic qualification inputs.",
        ],
    }
    host = None
    try:
        report["source_head"] = subprocess.check_output(["git", "-C", str(repo), "rev-parse", "HEAD"], text=True).strip()
        report["source_dirty"] = bool(subprocess.check_output(["git", "-C", str(repo), "status", "--porcelain"], text=True).strip())
        paths = ["tests/installed_review_persistence.py", "tests/installed_questions.py", "tests/installed_host_smoke.py",
                 "tests/installed_instruction_variants.py", "tests/question-host/server.ts", "tests/question-host/review-script.ts",
                 "tests/question-host/provider.mjs", ".bun-version", "bun.lock", "package.json"]
        report["input_sha256"] = {name: sha(repo / name) for name in paths}
        if args.opencode is None or not args.opencode.is_file():
            report["unqualified_reason"] = "Installed OpenCode executable unavailable"
            return report
        report["candidate"] = installed_plugin_inventory(args.artifact.resolve(), args.plugin.resolve(), args.expect_plugin_version, HOST)
        runtime_paths = ["server.ts", *[str(p.relative_to(repo)) for p in sorted((repo / "src").rglob("*")) if p.is_file()]]
        require(all((args.plugin / path).is_file() and sha(repo / path) == sha(args.plugin / path) for path in runtime_paths),
                "Installed packed candidate runtime differs from the source checkout")
        report["runtime_sha256"] = {name: sha(repo / name) for name in runtime_paths}
        report["cli_sha256"] = sha(args.opencode.resolve())
        with (tempfile.TemporaryDirectory(prefix="loom-review-persistence-") as temporary,
              audit_session(Path(temporary).resolve()) as audit):
            root = Path(temporary).resolve()
            project = root / "project"
            project.mkdir()
            env = isolated_environment(root)
            env["LOOM_QUESTION_FIXTURE"] = str(root)
            if args.disable_filewatcher:
                env["OPENCODE_FILEWATCHER_DISABLE"] = "1"
                report["filewatcher"] = "disabled on the disposable host; watcher behavior unqualified"
            report["observed_host"] = subprocess.check_output([str(args.opencode.resolve()), "--version"], text=True, env=env, timeout=15).strip()
            verify_host_version(report["observed_host"])
            allow = [{"action": "*", "resource": "*", "effect": "allow"}]
            config = {
                "plugins": ["*", str(args.plugin.resolve()), str(repo / "tests/question-host")],
                "agents": {
                    name: {"description": "Synthetic Stage 2 persistence qualification", "mode": mode,
                           "system": "Follow the local scripted qualification input.", "model": "question-fixture/reader",
                           "permissions": allow + ([{"action": "read", "resource": "*ledger.sqlite", "effect": "deny"}]
                                                     if name == "restricted" else [])}
                    for name, mode in (("general", "primary"), ("reviewer", "subagent"), ("restricted", "primary"))
                },
                "model": "question-fixture/reader", "update": "disable", "share": "disabled",
            }
            (Path(env["OPENCODE_CONFIG_DIR"]) / "opencode.json").write_text(json.dumps(config))
            (project / ".loom.yaml").write_text("instructions: {enabled: false}\nledger: {capture: automatic}\n")
            (root / "jobs.json").write_text("{}")
            subprocess.run(["git", "init", "-q", str(project)], check=True, env=env, timeout=10)

            def start(label):
                owned = PrivateHost(str(args.opencode.resolve()), project, env, output, label)
                try:
                    require(json.loads(owned.get("/api/info", "info")).get("version") == HOST, "Server host version mismatch")
                    owned.wait_roster("/api/plugin", "plugins", lambda rows: all(any(
                        row.get("id") == identity and row.get("state", {}).get("status") == "active" for row in rows)
                        for identity in ("loom", "loom.question.fixture")))
                    return owned
                except Exception:
                    owned.close()
                    raise

            def session():
                return request(host, "POST", "/api/session", {"agent": "general", "title": "Synthetic review persistence",
                    "model": {"providerID": "question-fixture", "id": "reader"}, "location": {"directory": str(project)}})["id"]

            def check(name, **evidence):
                report["checks"].append({"name": name, "status": "PASS", **evidence})

            try:
                host = start("initial")
                first_pid = host.proc.pid
                ledgers = list(Path(env["XDG_STATE_HOME"]).rglob("ledger.sqlite"))
                require(len(ledgers) == 1, "Expected one candidate-created private ledger")
                scenario = Scenario(host, root)
                owner, unrelated = session(), session()
                report["sessions"] = {"requester": owner, "unrelated": unrelated}
                context = scenario.command(owner, '''
const action=JSON.parse(await tools.loom.action({operation:"create",title:"Synthetic historical review",goal:"Preserve artifact A"})).result;
await tools.loom.plan({operation:"save",action_id:action.id,expected_revision:0,nodes:[{id:"task",kind:"task",title:"Artifact A",outcome:"Original A outcome"}]});
return await tools.loom.context({action_id:action.id,node_id:"task"});
''', "context")
                work_ref = context["work_ref"]
                private_marker = "SYNTHETIC_PRIVATE_MANDATE_" + secrets.token_hex(12)
                review = {
                    "format": "loom-review-request/v1", "request_id": "installed-review-" + secrets.token_hex(8),
                    "mandate": {"question": private_marker + ": assess original artifact A", "dimensions": ["correctness"],
                        "criteria": [{"text": "Retain the original error behavior", "source_ref": None}],
                        "mode": "independent", "inclusions": ["historical A"], "exclusions": ["current B"]},
                    "intended_recipient": {"agent": "reviewer", "session_id": None}, "members": [], "rechecks": [],
                }
                for index in range(100):
                    source = project / f"synthetic-artifact-{index}.txt"
                    source.write_text(f"Synthetic artifact {index}; no production source material.\n")
                    review["members"].append({"member_id": f"member-{index}", "work_ref": work_ref if index == 0 else None,
                        "producing_attempt_refs": [], "artifact_refs": [{"locator": str(source),
                            "version": {"kind": "sha256", "value": sha(source)}, "content_ref": None}],
                        "prior_review_request_id": None, "membership_source_refs": [],
                        "gaps": [{"reason": "not-observed", "source_ref": None}]})
                (output / "synthetic-request.json").write_text(json.dumps(review, indent=2) + "\n")
                (output / "synthetic-request.json").chmod(0o600)
                ask = {"operation": "ask", "question": review["mandate"]["question"],
                       "recipient": {"kind": "agent", "id": "reviewer"}, "blocking": True, "review": review}
                observed = scenario.command(owner, "const input=" + json.dumps(ask) +
                    ";return await Promise.all([tools.loom.record(input),tools.loom.record(input)]);")
                calls = completed_tools(observed, owner, "record")
                require(len(calls) == 2, "Expected two actual production review initiator calls")
                saved = [result_value(event) for event in calls]
                require(sorted(item["review"]["status"] for item in saved) == ["created", "existing"], "Concurrent requests did not share immutable identity")
                require(all(item["dispatch"] == {"status": "not-attempted", "attempted": False,
                    "reason": "recipient-specific-protected-transfer-unqualified"} for item in saved), "Protected delivery was not withheld")
                require(not any(event["type"] == "tool-before" and event["data"].get("tool") == "subagent" for event in observed),
                        "Structured review unexpectedly invoked native subagent dispatch")
                require(all(event["data"].get("sessionID") == owner for event in observed if event["type"] == "model-request"),
                        "Structured review created a recipient model request")
                check("S2-automatic-review-request-and-canonical-preparation", request_id=review["request_id"],
                      creation_statuses=[item["review"]["status"] for item in saved], protected_delivery="withheld")

                def read(after=0):
                    return scenario.invoke(owner, "review", {"operation": "read", "request_id": review["request_id"], "after": after, "limit": 50})

                first_page, second_page = read(), read(50)
                require(first_page["members"] + second_page["members"] == review["members"], "Public membership omitted or rewrote a subject")
                require(first_page["next_after"] == 50 and second_page["next_after"] is None and first_page["member_count"] == 100,
                        "Public membership continuation is incomplete")
                require(first_page["request"]["mandate"] == review["mandate"] and first_page["request"]["work_revision_policy"] == "frozen-historical",
                        "Original review mandate or historical policy changed")
                require(len(first_page["issues"]) == 1 and first_page["issues"][0]["attempt"]["state"] == "prepared",
                        "Canonical initial issue was duplicated or claimed without delivery authority")
                check("S2-complete-public-membership", member_count=100, page_sizes=[len(first_page["members"]), len(second_page["members"])],
                      initial_attempt=first_page["issues"][0]["attempt"]["attempt_id"])

                changed = {"operation": "save", "action_id": work_ref["action_id"], "expected_revision": 1,
                           "nodes": [{"id": "task", "kind": "task", "title": "Artifact B", "outcome": "Later B outcome"}]}
                scenario.invoke(owner, "plan", changed)
                historical = scenario.invoke(owner, "review", {"operation": "work", "request_id": review["request_id"], "member_id": "member-0"})
                require(historical["status"] == "established" and "Original A outcome" in json.dumps(historical)
                        and "Later B outcome" not in json.dumps(historical), "Public reader substituted current Plan B")
                relation_code = "const request_id=" + json.dumps(review["request_id"]) + ";" + '''
const source=JSON.parse(await tools.loom.record({operation:"add",session_only:true,kind:"assessment",verdict:"inconclusive",statement:"Synthetic authored finding; exact native review attribution remains unavailable."})).result;
return await tools.loom.review({operation:"relate",request_id,relationship:"finding",source_record_id:source.id,member_ids:["member-0"]});
'''
                scenario.command(owner, relation_code, "review")
                with_relation = read()
                require(len(with_relation["relationships"]) == 1 and with_relation["relationships"][0]["review_binding"]["status"] == "unknown",
                        "Authored finding was promoted to exact native execution")
                require(with_relation["relationships"][0]["source_producer"]["session_id"] == owner, "Finding producer identity was lost")
                require(with_relation["relationships"][0]["relationship_attribution"] == {
                    "status": "unknown", "reason": "authored-association-unverified"}, "Authored association was promoted to source-producer attestation")
                check("S2-original-historical-work-and-qualified-finding", work_ref=historical["work_ref"],
                      review_binding=with_relation["relationships"][0]["review_binding"])

                deny_code = "let denied=false;try{await tools.loom.review(" + json.dumps({"operation": "read", "request_id": review["request_id"]}) + ")}" + \
                    'catch(error){denied=true}if(!denied)throw new Error("Unrelated Session accessed private request");return "denied";'
                scenario.command(unrelated, deny_code)
                thread = scenario.invoke(unrelated, "record", {"operation": "query", "view": "full_thread", "session_id": owner})
                require(private_marker not in json.dumps(thread), "Private mandate leaked into ordinary public ledger history")
                check("S2-unrelated-session-denied-without-ledger-disclosure", private_mandate_in_ordinary_history=False)

                host.close(); host = None
                final_events(root)
                host = start("reopened")
                scenario = Scenario(host, root)
                recovered = read()
                require(recovered["request"] == with_relation["request"] and recovered["namespace"] == with_relation["namespace"]
                        and recovered["issues"] == with_relation["issues"]
                        and recovered["relationships"] == with_relation["relationships"], "Reopened public read changed original identity or evidence")
                prepared = scenario.invoke(owner, "review", {"operation": "prepare", "request_id": review["request_id"]})
                require(prepared["status"] == "existing", "Reopen allocated a new canonical initial issue")
                require(read()["issues"] == recovered["issues"], "Canonical preparation replay changed the preserved attempt")
                check("S2-process-reopen-and-canonical-replay", process_ids=[first_pid, host.proc.pid], request_id=review["request_id"])

                # Public native agent switch changes the effective permission
                # owner on the SAME Session that successfully read the request.
                request(host, "POST", f"/api/session/{owner}/agent", {"agent": "restricted"})
                require(request(host, "GET", f"/api/session/{owner}")["agent"] == "restricted", "Native permission owner did not switch")
                _, offset = scenario.begin(owner, "return await tools.loom.review(" + json.dumps({"operation": "read", "request_id": review["request_id"]}) + ");")
                idle(host, [owner])
                denied = events(root)[offset:]
                require(not completed_tools(denied, owner, "review"), "Revoked native read permission returned a request")
                failures = [event for event in denied if event["type"] == "tool-after"
                            and event["data"].get("tool") in ("loom_review", "loom.review") and event["data"].get("status") == "error"]
                require(len(failures) == 1, "No exact failed production review read observed after native permission revocation")
                denial = failures[0]["data"].get("error", {}).get("error", {})
                require(denial.get("_tag") == "Permission.BlockedError" and denial.get("permission") == "read"
                        and denial.get("resources") == [str(ledgers[0].resolve())], "Review read failed for an unrelated reason")
                check("S2-native-permission-revocation", same_requester_session=owner, effective_agent="restricted",
                      failed_tool=failures[0]["data"]["tool"], protected_result_returned=False)
                observed = events(root)
                require(all(event["data"].get("model", {}).get("providerID", event["data"].get("providerID")) == "question-fixture"
                            for event in observed if event["type"] == "model-request"), "External model request observed")
                report["execution_status"] = qualification_status(report["checks"])
            finally:
                if host is not None:
                    host.close(); host = None
                try:
                    captured = audit.finalize(output / "audit.ndjson")
                    report.update(audit_sha256=captured.sha256, audit_bytes=captured.byte_count, audit_receipts=len(captured.events))
                except Exception as error:
                    report["execution_status"] = "FAIL"
                    report["audit_error"] = f"{type(error).__name__}: {error}"
                    report.setdefault("error", report["audit_error"])
    except Exception as error:
        report["execution_status"] = "FAIL"
        report["error"] = f"{type(error).__name__}: {error}"
    finally:
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
    parser.add_argument("--report-directory", type=Path, required=True)
    parser.add_argument("--disable-filewatcher", action="store_true")
    report = run(parser.parse_args())
    print(json.dumps({key: report.get(key) for key in ("execution_status", "learning_qualification", "observed_host", "error", "checks")}))
    raise SystemExit({"PASS": 0, "FAIL": 1, "UNQUALIFIED": 2}[report["execution_status"]])


if __name__ == "__main__":
    main()
