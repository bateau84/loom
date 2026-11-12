"""Qualify native review evidence boundaries on isolated OpenCode 2.2.6.

Only the external model is scripted. Native dispatch, admission, reads, policies,
Loom tools/observer and persistence are real. No production review-admission or
learning engine is installed by this probe. A mechanics PASS never fills that gap.
Exit 0: planned observations completed (execution_status only); 1: unexpected
failure; 2: runtime unavailable or incompatible. Qualification status remains
UNQUALIFIED when required native guarantees are absent, including on exit 0.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import secrets
import shutil
import subprocess
import tempfile
import time
from pathlib import Path

from installed_host_smoke import PrivateHost, installed_plugin_inventory, isolated_environment, require
from installed_instruction_variants import verify_host_version
from installed_questions import Scenario, events, idle, request
from native_review_oracle import call_key, dispatch_receipts, source_basis

HOST = "2.2.6"
SOURCE_REVISION = "dc2ffcf8bf26f9e669b6aa22b95f50e12be15e06"
SCENARIOS = {"Q1": "parent-child identity", "Q2": "concurrent and reused children",
             "Q3": "original mandate", "Q4": "effective evidence basis",
             "Q5": "recipient authorization", "Q6": "ambiguous observations",
             "Q7": "historical scope", "R1": "interruption restart and compaction"}


def sha(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def wait_for(root: Path, predicate, *, offset: int = 0, timeout: int = 30) -> dict:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        matches = [e for e in events(root)[offset:] if predicate(e)]
        if matches:
            return matches[-1]
        time.sleep(0.05)
    raise RuntimeError("Expected native observation did not arrive")


class ReviewScenario(Scenario):
    """Only fixture inputs are authored here; all IDs in receipts come from host output."""
    def __init__(self, host, root):
        super().__init__(host, root)
        self.jobs = json.loads((root / "jobs.json").read_text())

    def flush(self):
        staging = self.root / "jobs.next.json"
        staging.write_text(json.dumps(self.jobs))
        staging.replace(self.root / "jobs.json")

    def add(self, **script):
        job = secrets.token_hex(8)
        self.jobs[job] = script
        self.flush()
        return job

    def begin(self, session, code, hold=None):
        job = self.add(code=code, hold=hold)
        start = len(events(self.root))
        self.submit(session, job)
        return job, start

    def submit(self, session, job, extra="", **options):
        # The client may select an idempotent admission ID; only the native API
        # response/enqueued event confirms that the host admitted this request.
        result = request(self.host, "POST", f"/api/session/{session}/prompt", {
            "id": "msg_" + secrets.token_hex(12),
            "text": "LOOM_HARNESS_JOB:" + job + ("\n" + extra if extra else ""), **options})
        require(result.get("sessionID") == session and result.get("type") == "user",
                "Native prompt returned a foreign or non-user admission")
        return result

    def release(self, job):
        self.jobs[job]["hold"] = None
        self.flush()

    def create(self, agent="general"):
        return request(self.host, "POST", "/api/session", {"agent": agent,
            "title": "Identical qualification title", "model": {"providerID": "question-fixture", "id": "reader"},
            "location": {"directory": str(self.root / "project")}})["id"]

    def dispatch(self, parent, child_job, text="", *, child=None, background=False):
        start = len(events(self.root))
        value = {"agent": "reviewer", "description": "Identical review label",
                 "prompt": "LOOM_HARNESS_JOB:" + child_job + ("\n" + text if text else "")}
        if child:
            value["sessionID"] = child
        if background:
            value["background"] = True
        job = self.add(nativeCalls=[{"tool": "subagent", "input": value}])
        self.submit(parent, job)
        wait_for(self.root, lambda e: e["type"] == "tool-after" and e["data"].get("tool") == "subagent"
                 and e["data"].get("sessionID") == parent, offset=start)
        idle(self.host, [parent])
        receipts = [r for r in dispatch_receipts(events(self.root)) if r["before_receipt"] > start]
        require(len(receipts) == 1 and receipts[0]["binding"] == "observed", "Native dispatch did not bind a child")
        receipt = receipts[0]
        actual = request(self.host, "GET", "/api/session/" + receipt["child_session_id"])
        require(actual.get("parentID") == parent, "Native child parentage disagrees with dispatch receipt")
        key = tuple(receipt["parent"])
        terminal = wait_for(self.root, lambda e: e["type"] == "native-event" and e["data"].get("type") == "session.tool.success"
                            and (e["data"]["data"].get("sessionID"), e["data"]["data"].get("assistantMessageID"), e["data"]["data"].get("id")) == key,
                            offset=start)
        require(terminal["data"]["data"].get("metadata", {}).get("sessionID") == receipt["child_session_id"]
                and terminal["data"]["data"].get("executed") is False, "Durable native terminal disagrees with direct tool receipt")
        receipt["terminal_event_id"] = terminal["data"]["id"]
        receipt["return_status"] = terminal["data"]["data"]["metadata"]["status"]
        return receipt


def run(args) -> dict:
    repo, output = args.repository.resolve(), args.report_directory.resolve()
    output.mkdir(parents=True, exist_ok=False, mode=0o700)
    report = {"format": "loom-native-review-qualification/v1", "status": "UNQUALIFIED", "execution_status": "UNQUALIFIED",
              "fixture": "loom.question.fixture/native-review-script-v1",
              "expected_host": HOST, "inspected_upstream_revision": SOURCE_REVISION,
              "host_revision_provenance": "release source inspected; CLI bytes separately hashed, no embedded Git attestation",
              "checks": [], "scenarios": {key: {"name": value, "status": "UNQUALIFIED"} for key, value in SCENARIOS.items()},
              "capabilities": {}, "limitations": [
                  "Scripted provider proves mechanical behavior only, never model reasoning or comprehension.",
                  "No trusted parent-dispatch to child-admission or input-to-model-step receipt exists in this host profile.",
                  "Fixture-authored mandates are test inputs; production Loom review admission remains unimplemented.",
                  "No protected source retention policy, background learning, or canonical change is activated.",
              ]}
    host = None
    try:
        report["source_head"] = subprocess.check_output(["git", "-C", str(repo), "rev-parse", "HEAD"], text=True).strip()
        report["source_dirty"] = bool(subprocess.check_output(["git", "-C", str(repo), "status", "--porcelain"], text=True).strip())
        paths = ["tests/installed_native_review.py", "tests/native_review_oracle.py", "tests/question-host/server.ts",
                 "tests/question-host/review-script.ts", "tests/question-host/provider.mjs", "tests/installed_host_smoke.py",
                 "tests/installed_instruction_variants.py", "tests/installed_questions.py", ".bun-version", "bun.lock", "package.json"]
        report["input_sha256"] = {name: sha(repo / name) for name in paths}
        if args.opencode is None or not args.opencode.is_file():
            report["unqualified_reason"] = "OpenCode executable unavailable; no native cases executed"
            return report
        if args.plugin is None or args.artifact is None or not (repo / "node_modules/@opencode/plugin").is_dir():
            report["unqualified_reason"] = "Installed candidate artifact or fixture SDK unavailable"
            return report
        report["candidate"] = installed_plugin_inventory(args.artifact.resolve(), args.plugin.resolve(),
                                                          args.expect_plugin_version, HOST)
        runtime_paths = ["server.ts", *[str(p.relative_to(repo)) for p in sorted((repo / "src").rglob("*")) if p.is_file()]]
        require(all((args.plugin / name).is_file() and sha(repo / name) == sha(args.plugin / name) for name in runtime_paths),
                "Installed candidate runtime bytes differ from the tested checkout")
        report["runtime_sha256"] = {name: sha(repo / name) for name in runtime_paths}
        report["cli_sha256"] = sha(args.opencode.resolve())
        with tempfile.TemporaryDirectory(prefix="loom-native-review-") as temporary:
            root = Path(temporary).resolve()
            project = root / "project"
            project.mkdir()
            env = isolated_environment(root)
            env["LOOM_QUESTION_FIXTURE"] = str(root)
            if args.disable_filewatcher:
                env["OPENCODE_FILEWATCHER_DISABLE"] = "1"
                report["filewatcher"] = "disabled in disposable host; watcher behavior unqualified"
            version = subprocess.check_output([str(args.opencode.resolve()), "--version"], text=True, env=env, timeout=15).strip()
            report["observed_host"] = version
            try:
                verify_host_version(version)
            except RuntimeError:
                report["unqualified_reason"] = "CLI differs from inspected 2.2.6 profile; requalification required"
                return report
            permissions = [{"action": "*", "resource": "*", "effect": "allow"}]
            config = {"plugins": ["*", str(args.plugin.resolve()), str(repo / "tests/question-host")],
                      "agents": {agent: {"description": "Disposable native review fixture", "mode": mode,
                          "system": "Follow the local qualification script.", "model": "question-fixture/reader",
                          "permissions": permissions + ([{"action": "read", "resource": "*protected-b.txt", "effect": "deny"}]
                                                        if agent == "reviewer" else [])}
                          for agent, mode in (("general", "primary"), ("reviewer", "subagent"))},
                      "model": "question-fixture/reader", "update": "disable", "share": "disabled"}
            (Path(env["OPENCODE_CONFIG_DIR"]) / "opencode.json").write_text(json.dumps(config))
            (project / ".loom.yaml").write_text("instructions: {enabled: false}\nledger: {capture: automatic}\n")
            (root / "jobs.json").write_text("{}")
            sources = {path: "SYNTHETIC_" + secrets.token_hex(16) for path in ("evidence-a.txt", "evidence-b.txt", "protected-b.txt")}
            for path, value in sources.items():
                (project / path).write_text(value + "\n")
            report["synthetic_sources"] = {path: sha(project / path) for path in sources}
            subprocess.run(["git", "init", "-q", str(project)], env=env, check=True, timeout=10)

            def start(label):
                owned = PrivateHost(str(args.opencode.resolve()), project, env, output, label)
                try:
                    require(json.loads(owned.get("/api/info", "info")).get("version") == HOST, "Server version mismatch")
                    owned.wait_roster("/api/plugin", "plugins", lambda rows: all(any(
                        p.get("id") == ident and p.get("state", {}).get("status") == "active" for p in rows)
                        for ident in ("loom", "loom.question.fixture")))
                    return owned
                except Exception:
                    owned.close()
                    raise

            def check(name, **evidence):
                report["checks"].append({"name": name, "status": "PASS", **evidence})

            try:
                host = start("initial")
                scenario = ReviewScenario(host, root)
                ready = wait_for(root, lambda e: e["type"] == "ready")
                require(ready["data"].get("host_version") == HOST, "Plugin observed an unexpected host interface version")
                report["host_runtime_versions"] = ready["data"].get("runtime_versions", {})
                report["active_scenario"] = "Q1"
                parent = scenario.create()
                job = scenario.add(nativeCalls=[{"tool": "read", "input": {"path": "evidence-a.txt"}}])
                first = scenario.dispatch(parent, job)
                child = first["child_session_id"]
                basis = source_basis(events(root), child, "evidence-a.txt", sources["evidence-a.txt"])
                require(basis["retrieved"] and basis["supplied"], "Actual child native read/provider material absent")
                check("Q1-native-dispatch-and-child-read", dispatch=first, basis=basis)
                report["scenarios"]["Q1"].update(status="PASS", scope="direct parent tool tuple and actual child Session; admission causality unqualified")

                # Q2: two real overlapping calls, deliberately finishing in the
                # reverse order. Job names/barriers control the external model;
                # only native tuples and progress/results establish identities.
                report["active_scenario"] = "Q2"
                overlap_start = len(events(root))
                slow = scenario.add(nativeCalls=[{"tool": "read", "input": {"path": "evidence-a.txt"}}], hold="after")
                fast = scenario.add(nativeCalls=[{"tool": "read", "input": {"path": "evidence-b.txt"}}], hold="after")
                overlap = scenario.add(nativeCalls=[{"tool": "subagent", "input": {
                    "agent": "reviewer", "description": "Identical review label", "prompt": "LOOM_HARNESS_JOB:" + job}}
                    for job in (slow, fast)])
                scenario.submit(parent, overlap)
                for job in (slow, fast):
                    wait_for(root, lambda e, job=job: e["type"] == "provider-held" and e["data"].get("job") == job,
                             offset=overlap_start)
                started = [e["data"] for e in events(root)[overlap_start:] if e["type"] == "tool-before"
                           and e["data"].get("tool") == "subagent" and e["data"].get("sessionID") == parent]
                require(len(started) == 2 and len({call_key(e) for e in started}) == 2, "Concurrent native call IDs collided")
                fast_key = call_key(next(e for e in started if e["input"]["prompt"] == "LOOM_HARNESS_JOB:" + fast))
                slow_key = call_key(next(e for e in started if e["input"]["prompt"] == "LOOM_HARNESS_JOB:" + slow))
                scenario.release(fast)
                wait_for(root, lambda e: e["type"] == "tool-after" and e["data"].get("tool") == "subagent"
                         and call_key(e["data"]) == fast_key, offset=overlap_start)
                require(not any(e["type"] == "tool-after" and e["data"].get("tool") == "subagent"
                                and call_key(e["data"]) == slow_key for e in events(root)[overlap_start:]),
                        "Slow native child completed before its explicit provider barrier was released")
                scenario.release(slow)
                idle(host, [parent])
                concurrent = [r for r in dispatch_receipts(events(root)) if r["before_receipt"] > overlap_start]
                require(len(concurrent) == 2 and all(r["binding"] == "observed" for r in concurrent)
                        and len({r["child_session_id"] for r in concurrent}) == 2, "Concurrent children were conflated")
                continued = scenario.dispatch(parent, scenario.add(finalText="Reused child completed"), child=child)
                require(continued["child_session_id"] == child and continued["parent"] != first["parent"],
                        "Native reused child lost distinct parent invocation identity")
                held = scenario.add(nativeCalls=[{"tool": "read", "input": {"path": "evidence-a.txt"}}], hold="after")
                running_first = scenario.dispatch(parent, held, child=child, background=True)
                wait_for(root, lambda e: e["type"] == "provider-held" and e["data"].get("job") == held)
                running_second = scenario.dispatch(parent, scenario.add(finalText="Shared child follow-up"), child=child, background=True)
                require(running_first["parent"] != running_second["parent"]
                        and running_first["child_session_id"] == running_second["child_session_id"] == child
                        and running_first["return_status"] == running_second["return_status"] == "running",
                        "Shared running child was conflated with independent completed invocations")
                scenario.release(held)
                idle(host, [child, parent])
                check("Q2-concurrent-reverse-return-and-reuse", concurrent=concurrent, reused=[first, continued],
                      running_reuse=[running_first, running_second], shared_completion_attribution="UNQUALIFIED")
                report["scenarios"]["Q2"].update(status="PASS", scope="overlapping distinct children, sequential and running child reuse; shared output per dispatch unqualified")

                # The mandates are authored test requests, not a substitute for
                # future Loom review admission. Subject WorkRef comes from real
                # registered Loom operations and an immutable artifact digest.
                report["active_scenario"] = "Q3"
                action = scenario.invoke(parent, "action", {"operation": "create", "title": "Historical review fixture",
                                                            "goal": "Preserve requested scope"})
                nodes = [{"id": "task-a", "kind": "task", "title": "Original work", "outcome": "Original A",
                          "criteria": ["A remains distinguishable"]},
                         {"id": "task-b", "kind": "task", "title": "Later work", "outcome": "Original B"}]
                scenario.invoke(parent, "plan", {"operation": "save", "action_id": action["id"], "expected_revision": 0, "nodes": nodes})
                original_context = scenario.invoke(parent, "context", {"action_id": action["id"], "node_id": "task-a"})
                original_ref = original_context["work_ref"]
                require(original_ref["plan_revision"] == 1, "Fixture failed to obtain actual historical WorkRef")
                subjects = [{"work_ref": original_ref, "artifact": {"path": "evidence-a.txt", "sha256": sha(project / "evidence-a.txt")}}]
                mandates = [{"question": "Is the supplied artifact secure?", "dimensions": ["security"],
                             "criteria": ["No unintended disclosure"], "mode": "assessment", "exclusions": ["correctness", "reliability"], "subjects": subjects},
                            {"question": "Is the artifact correct and reliable?", "dimensions": ["correctness", "reliability"],
                             "criteria": ["Original task criteria", "Recovery remains correct"], "mode": "assessment-and-qa", "exclusions": [], "subjects": subjects}]
                admissions, original_payloads = [], []
                for index, mandate in enumerate(mandates, 1):
                    # Write immutable input before dispatch; the native enqueued
                    # event, not this file, proves what was actually admitted.
                    encoded = json.dumps(mandate, sort_keys=True)
                    manifest_path = output / f"mandate-r{index}.json"
                    manifest_path.write_text(encoded + "\n")
                    begin = len(events(root))
                    response = scenario.dispatch(parent, scenario.add(finalText="I claim unrestricted acceptance of everything."),
                                                 "ORIGINAL_REVIEW_MANDATE:" + encoded)
                    sid = response["child_session_id"]
                    admitted = [e["data"] for e in events(root)[begin:] if e["type"] == "native-event"
                                and e["data"].get("type") == "session.inbox.enqueued" and e["data"]["data"].get("sessionID") == sid]
                    require(len(admitted) == 1 and "ORIGINAL_REVIEW_MANDATE:" + encoded in admitted[0]["data"]["item"]["payload"]["text"],
                            "Native admission did not preserve the original full mandate")
                    native = admitted[0]["data"]
                    replay = request(host, "POST", f"/api/session/{sid}/prompt", {
                        "id": native["inboxID"], "text": "Changed retrospective mandate", "resume": False})
                    require(replay.get("payload") == native["item"]["payload"], "Native duplicate admission replaced original mandate")
                    enqueued = [e for e in events(root) if e["type"] == "native-event" and e["data"].get("type") == "session.inbox.enqueued"
                                and e["data"]["data"].get("sessionID") == sid and e["data"]["data"].get("inboxID") == native["inboxID"]]
                    require(len(enqueued) == 1, "Idempotent prompt retry created a duplicate native admission")
                    admissions.append({"session_id": sid, "input_id": native["inboxID"], "event_id": admitted[0]["id"],
                                       "manifest_sha256": sha(manifest_path), "dispatch_binding": "UNQUALIFIED"})
                    original_payloads.append(native["item"]["payload"])
                require(mandates[0]["subjects"] == mandates[1]["subjects"] and mandates[0] != mandates[1], "Mandate discriminator missing")
                check("Q3-native-original-mandates-and-idempotent-admission", admissions=admissions,
                      limitation="Fixture requests preserved by native inbox; production immutable review admission not implemented")
                report["scenarios"]["Q3"].update(status="PASS", scope="native preservation of distinct authored input mandates, not production Loom admission")

                # Q4: inline supply, real native retrieval, and a pointer-only
                # reviewer making plausible claims must remain distinguishable.
                report["active_scenario"] = "Q4"
                positive = scenario.dispatch(parent, scenario.add(nativeCalls=[{"tool": "read", "input": {"path": "evidence-a.txt"}}]),
                                             "ORIGINAL_REVIEW_MANDATE:" + json.dumps(mandates[0], sort_keys=True))
                positive_basis = source_basis(events(root), positive["child_session_id"], "evidence-a.txt", sources["evidence-a.txt"])
                require(positive_basis["supplied"] and positive_basis["retrieved"], "Admitted native Reviewer did not receive actual source")
                positive_admissions = [e["data"] for e in events(root) if e["type"] == "native-event"
                                       and e["data"].get("type") == "session.inbox.enqueued"
                                       and e["data"]["data"].get("sessionID") == positive["child_session_id"]]
                require(len(positive_admissions) == 1 and json.dumps(mandates[0], sort_keys=True)
                        in positive_admissions[0]["data"]["item"]["payload"]["text"], "Q4 source recipient did not have original mandate")
                inline = scenario.dispatch(parent, scenario.add(finalText="Inline source reviewed"),
                                           "SUPPLIED_SOURCE:" + sources["evidence-b.txt"])
                inline_basis = source_basis(events(root), inline["child_session_id"], "evidence-b.txt", sources["evidence-b.txt"])
                require(inline_basis["supplied"] and not inline_basis["retrieved"], "Inline supply was conflated with retrieval")
                negative = scenario.dispatch(parent, scenario.add(finalText="Cited evidence-a.txt. I inspected all task evidence and it passes."),
                                             "MANIFEST_POINTER:fixture://manifest-r1; requested evidence-a.txt sha256=" + subjects[0]["artifact"]["sha256"])
                negative_basis = source_basis(events(root), negative["child_session_id"], "evidence-a.txt", sources["evidence-a.txt"])
                require(not negative_basis["supplied"] and not negative_basis["retrieved"], "Pointer or citation manufactured source access")
                returned = events(root)[negative["after_receipts"][0] - 1]["data"]["result"]
                require("I inspected all task evidence" in json.dumps(returned), "Negative reviewer claim never traversed native return")
                check("Q4-supplied-retrieved-and-citation-only", retrieved=positive_basis, inline=inline_basis, pointer_only=negative_basis,
                      positive_admission_id=positive_admissions[0]["data"]["inboxID"],
                      cited_and_claimed_inspected="observed reviewer-authored return, not access proof")
                report["scenarios"]["Q4"].update(status="UNQUALIFIED", scope="Session-bound supply and exact native read PASS; binding both to one admitted review invocation unsupported")

                # Q5: actual native read policy, plus a harmless synthetic leak
                # counterexample. No test-owned gate is described as Loom ACL.
                report["active_scenario"] = "Q5"
                before = len(events(root))
                scenario.submit(parent, scenario.add(nativeCalls=[{"tool": "read", "input": {"path": "protected-b.txt"}}]))
                wait_for(root, lambda e: e["type"] == "tool-after" and e["data"].get("tool") == "read"
                         and e["data"].get("sessionID") == parent, offset=before)
                idle(host, [parent])
                requester_basis = source_basis(events(root), parent, "protected-b.txt", sources["protected-b.txt"])
                require(requester_basis["retrieved"], "Requester did not actually read protected test source")
                withheld = scenario.dispatch(parent, scenario.add(nativeCalls=[{"tool": "read", "input": {"path": "protected-b.txt"}}]),
                                             "REQUESTED_MEMBERSHIP:protected-b.txt; content unavailable without recipient authorization")
                sid = withheld["child_session_id"]
                denials = [e["data"] for e in events(root) if e["type"] == "tool-after" and e["data"].get("sessionID") == sid
                           and e["data"].get("tool") == "read" and e["data"].get("input", {}).get("path") == "protected-b.txt"]
                denial = denials[0].get("error", {}).get("error", {}) if len(denials) == 1 else {}
                require(len(denials) == 1 and denials[0].get("status") == "error"
                        and denial.get("_tag") == "Permission.BlockedError" and denial.get("permission") == "read"
                        and denial.get("resources") == ["protected-b.txt"], "Receiving Reviewer read denial was not observed")
                denied_basis = source_basis(events(root), sid, "protected-b.txt", sources["protected-b.txt"])
                require(not denied_basis["supplied"] and not denied_basis["retrieved"], "Denied source was mislabeled or delivered")
                leaked = scenario.dispatch(parent, scenario.add(nativeCalls=[{"tool": "read", "input": {"path": "protected-b.txt"}}],
                    finalText="Synthetic inline transfer counterexample"), sources["protected-b.txt"], child=sid)
                leak_basis = source_basis(events(root), leaked["child_session_id"], "protected-b.txt", sources["protected-b.txt"])
                require(leak_basis["supplied"] and not leak_basis["retrieved"], "Native inline-transfer counterexample changed; requalify source boundary")
                repeated_denial = [e["data"] for e in events(root)[leaked["before_receipt"] - 1:] if e["type"] == "tool-after"
                                   and e["data"].get("sessionID") == sid and e["data"].get("tool") == "read"]
                require(leaked["child_session_id"] == sid and len(repeated_denial) == 1
                        and repeated_denial[0].get("error", {}).get("error", {}).get("_tag") == "Permission.BlockedError",
                        "Actual same recipient read policy was not denied during inline disclosure")
                check("Q5-native-read-denial-and-unfenced-inline-transfer", requester=requester_basis, denied=denied_basis,
                      denied_call=list(call_key(denials[0])), inline_counterexample=leak_basis,
                      native_read_denial="PASS", native_recipient_transfer_property="FAIL",
                      limitation="Read policy does not fence parent inline disclosure. Loom delivery enforcement remains unimplemented.")
                report["scenarios"]["Q5"].update(status="UNQUALIFIED", scope="native transfer enforcement unsupported; actual inline bypass observed with synthetic bytes")

                # Q6: real Code Mode calls share the outer native key. Loom
                # intentionally omits its own meta tools; do not invent rows or
                # native inner IDs to make that observed coverage gap disappear.
                report["active_scenario"] = "Q6"
                opaque = scenario.create()
                before = len(events(root))
                scenario.command(opaque, "return await Promise.all([tools.loom.context({}), tools.loom.context({})])")
                inner = [e["data"] for e in events(root)[before:] if e["type"] == "tool-after"
                         and e["data"].get("tool") in ("loom_context", "loom.context") and e["data"].get("sessionID") == opaque]
                require(len(inner) == 2 and len({call_key(e) for e in inner}) == 1, "Expected actual opaque inner-call collision not exercised")
                records = scenario.invoke(opaque, "record", {"operation": "query", "session_only": True, "limit": 50})["items"]
                unpaired = [row for row in records if row["kind"] == "observation" and row["data"].get("phase") == "finished"
                            and row["data"].get("tool") in ("loom_context", "loom.context")]
                require(not unpaired, "Production meta-tool capture contract changed; requalify rather than infer inner provenance")
                outer_finished = [row for row in records if row["kind"] == "observation" and row["data"].get("phase") == "finished"
                                  and row["data"].get("tool") == "execute" and row["data"].get("call_id") == inner[0]["id"]]
                require(len(outer_finished) == 1 and outer_finished[0]["data"].get("start_id"), "Actual outer execution observation is missing")
                without_provider = [e for e in events(root) if e["type"] != "provider-request"]
                require(not source_basis(without_provider, child, "evidence-a.txt", sources["evidence-a.txt"])["supplied"],
                        "Missing provider observation was reconstructed from a weaker boundary")
                before_missing = len(events(root))
                scenario.submit(opaque, scenario.add(nativeCalls=[{"tool": "read", "input": {"path": "missing.txt"}}]))
                missing = wait_for(root, lambda e: e["type"] == "tool-after" and e["data"].get("sessionID") == opaque
                                   and e["data"].get("tool") == "read", offset=before_missing)
                idle(host, [opaque])
                require(missing["data"].get("status") == "error", "Unavailable source unexpectedly became a successful native read")
                check("Q6-real-inner-call-collision-and-incomplete-observation-control", shared_native_call=list(call_key(inner[0])),
                      outer_record_id=outer_finished[0]["id"], missing_source_call=list(call_key(missing["data"])),
                      inner_provenance="UNQUALIFIED: native inner ID absent; Loom meta-tool capture excluded",
                      missing_provider_control="PASS for deliberately reduced trace oracle only, not an injected native outage")
                report["scenarios"]["Q6"].update(status="PASS", scope="actual Code Mode collision and production capture gap exposed; no absent provider receipt inferred")

                # Q7: selection and plan change inside a real outer invocation.
                # The public completion explicitly uses the original WorkRef;
                # the production observer must keep the outer start's scope.
                report["active_scenario"] = "Q7"
                historical = scenario.create()
                scenario.invoke(historical, "context", {"action_id": action["id"], "node_id": "task-a"})
                revised_nodes = [{**node, "outcome": "Revised A"} if node["id"] == "task-a" else node for node in nodes]
                before = len(events(root))
                code = "await tools.loom.plan(" + json.dumps({"operation": "save", "action_id": action["id"],
                       "expected_revision": 1, "nodes": revised_nodes}) + ");"
                code += "await tools.loom.context(" + json.dumps({"action_id": action["id"], "node_id": "task-b"}) + ");"
                code += "return await tools.loom.record(" + json.dumps({"operation": "complete", "work_ref": original_ref,
                        "statement": "Completion against the original scope, not acceptance", "artifact_refs": ["fixture://evidence-a@" + subjects[0]["artifact"]["sha256"]]}) + ")"
                completion = scenario.command(historical, code, "record")
                outer = [e["data"] for e in events(root)[before:] if e["type"] == "tool-after"
                         and e["data"].get("tool") == "execute" and e["data"].get("sessionID") == historical]
                require(len(outer) == 1 and completion["data"]["work_ref"] == original_ref
                        and completion["node_id"] == "task-a", "Historical completion was rewritten to current work")
                current = scenario.invoke(historical, "context", {})
                require(current["work_ref"]["node_id"] == "task-b" and current["work_ref"]["plan_revision"] == 2,
                        "Mid-invocation plan/selection change was not exercised")
                records = scenario.invoke(historical, "record", {"operation": "query", "session_only": True, "limit": 50})["items"]
                pair = [row for row in records if row["kind"] == "observation" and row["data"].get("tool") == "execute"
                        and row["data"].get("call_id") == outer[0]["id"] and row["data"].get("message_id") == outer[0]["messageID"]]
                require(len(pair) == 2, "Native outer invocation has no unique saved start/finish")
                start_row = next(row for row in pair if row["data"]["phase"] == "started")
                finish_row = next(row for row in pair if row["data"]["phase"] == "finished")
                require(finish_row["data"].get("start_id") == start_row["id"] and all(row.get("node_id") == "task-a" for row in pair)
                        and finish_row.get("fingerprint") == start_row.get("fingerprint") and bool(start_row.get("fingerprint")),
                        "Late outer result borrowed the later selected work")
                historical_plan = scenario.invoke(historical, "plan", {"operation": "read", "action_id": action["id"], "revision": 1})
                require(historical_plan["nodes"] == nodes, "Original historical Plan content was lost")
                query = {"operation": "query", "action_id": action["id"], "record_id": completion["id"]}
                saved_completion = scenario.invoke(historical, "record", query)["items"]
                check("Q7-native-scope-change-and-original-work-ref", native_call=list(call_key(outer[0])),
                      work_ref=original_ref, start_record=start_row["id"], finish_record=finish_row["id"], completion_record=completion["id"])
                report["scenarios"]["Q7"].update(status="PASS", scope="actual outer-call start scope and historical WorkRef; general child-dispatch binding remains unavailable")

                # R1: actual interruption, native compaction and process reopen.
                # Session lifecycle events never supply a missing dispatch edge.
                report["active_scenario"] = "R1"
                interrupted_parent = scenario.create()
                held = scenario.add(nativeCalls=[{"tool": "read", "input": {"path": "evidence-b.txt"}}], hold="after")
                interrupted_dispatch = scenario.dispatch(interrupted_parent, held, background=True)
                interrupted_child = interrupted_dispatch["child_session_id"]
                wait_for(root, lambda e: e["type"] == "provider-held" and e["data"].get("job") == held)
                before = len(events(root))
                interruption = request(host, "POST", f"/api/session/{interrupted_child}/interrupt")
                require(interruption.get("interrupted") is True, "Native interruption was not accepted")
                scenario.release(held)
                interrupt_event = wait_for(root, lambda e: e["type"] == "native-event"
                    and e["data"].get("type") == "session.execution.interrupted"
                    and e["data"]["data"].get("sessionID") == interrupted_child, offset=before)
                idle(host, [interrupted_child, interrupted_parent])
                compacted_child = positive["child_session_id"]
                before = len(events(root))
                request(host, "POST", f"/api/session/{compacted_child}/compact", {})
                compact_event = wait_for(root, lambda e: e["type"] == "native-event"
                    and e["data"].get("type") == "session.compaction.ended"
                    and e["data"]["data"].get("sessionID") == compacted_child, offset=before)
                idle(host, [compacted_child])
                after_compact = len(events(root))
                scenario.submit(compacted_child, scenario.add(finalText="Postcompaction continuation"))
                wait_for(root, lambda e: e["type"] == "provider-request"
                         and e["data"].get("headers", {}).get("x-opencode-session-id") == compacted_child, offset=after_compact)
                idle(host, [compacted_child])
                postcompaction = source_basis(events(root)[after_compact:], compacted_child, "evidence-a.txt", sources["evidence-a.txt"])
                # This is a measurement, not an assumption that compaction must
                # remove or retain a particular historical byte window.
                postcompaction_marker_seen = bool(postcompaction["supplied"])
                old_pid = host.proc.pid
                host.close()
                host = None
                host = start("reopened")
                require(host.proc.pid != old_pid, "Recovery did not use a new host process")
                scenario = ReviewScenario(host, root)
                reader = scenario.create()
                require(scenario.invoke(reader, "record", query)["items"] == saved_completion,
                        "Public historical completion changed after host restart")
                for admitted, payload in zip(admissions, original_payloads):
                    replay = request(host, "POST", f"/api/session/{admitted['session_id']}/prompt", {
                        "id": admitted["input_id"], "text": "Changed after restart", "resume": False})
                    require(replay.get("payload") == payload, "Original native mandate changed after restart")
                require(request(host, "GET", f"/api/session/{child}").get("parentID") == parent,
                        "Native child parentage was lost after restart")
                recovered_plan = scenario.invoke(reader, "plan", {"operation": "read", "action_id": action["id"], "revision": 1})
                require(recovered_plan["nodes"] == nodes, "Historical Plan content changed after restart")
                for admitted in admissions:
                    enqueues = [e for e in events(root) if e["type"] == "native-event" and e["data"].get("type") == "session.inbox.enqueued"
                                and e["data"]["data"].get("sessionID") == admitted["session_id"]
                                and e["data"]["data"].get("inboxID") == admitted["input_id"]]
                    require(len(enqueues) == 1, "Complete audit contains a duplicate/missing original admission after replay/restart")
                check("R1-interrupt-compact-reopen-and-public-history", interruption_event_id=interrupt_event["data"]["id"],
                      compaction_event_id=compact_event["data"]["id"], processes=[old_pid, host.proc.pid],
                      completion_record=completion["id"], postcompaction_source_marker_seen=postcompaction_marker_seen,
                      limitation="Normal process reopen after interruption; crash during dispatch and per-dispatch recovery lineage remain unqualified")
                report["scenarios"]["R1"].update(status="PASS", scope="native interruption/compaction and durable completed history after process restart; in-flight recovery lineage unqualified")
                report["capabilities"] = capability_matrix()
                require(not any(e["type"] == "observer-failure" for e in events(root)), "Passive native observer failed; coverage incomplete")
                report.pop("active_scenario")
                report["execution_status"] = "PASS"
            finally:
                if host is not None:
                    host.close()
                    host = None
                audit = root / "audit.ndjson"
                if audit.exists():
                    shutil.copyfile(audit, output / "audit.ndjson")
                    (output / "audit.ndjson").chmod(0o600)
                    report["audit_sha256"] = sha(output / "audit.ndjson")
    except Exception as error:
        report["status"] = report["execution_status"] = "FAIL"
        report["error"] = str(error)
        if report.get("active_scenario"):
            report["scenarios"][report["active_scenario"]].update(status="FAIL", error=str(error))
    finally:
        (output / "report.json").write_text(json.dumps(report, indent=2) + "\n")
        (output / "report.json").chmod(0o600)
    return report


def capability_matrix():
    """Installed observed mechanisms plus explicitly source-inspected limits."""
    rows = [
        ("parent_dispatch", "Verified", ["Q1", "Q2"], "tool.hook execute.before/after; durable session.tool.success",
         "Direct native tools only; opaque inner calls are not independent native invocations."),
        ("dispatch_child", "Verified", ["Q1", "Q2"], "subagent progress/result child Session plus session.get parentID",
         "Child binding does not establish the child input ID or unique ownership of its history."),
        ("reused_child", "Partial", ["Q2"], "native subagent sessionID; distinct parent tuples; running results",
         "Sequential/running reuse observed. Shared child output is not attributable separately to each input."),
        ("prompt_admission", "Verified", ["Q3", "R1"], "native inbox enqueue event/input ID and idempotent API readback",
         "Prompt hook alone is not admission; these input IDs have no native parent-dispatch edge."),
        ("mandate_admission", "Partial", ["Q3", "Q4"], "full original mandate in native admitted payload; immutable duplicate-ID response",
         "Test-authored mandate preservation only. Production freeze/issue admission and dispatch cause not implemented."),
        ("supplied_material", "Partial", ["Q4"], "actual local AI SDK doStream prompt with native Session header",
         "Session-bound synthetic source bytes, not a general transport receipt or exact admitted execution."),
        ("subsequent_retrieval", "Partial", ["Q4", "Q6"], "direct native read return keyed by child Session/assistant message/tool call",
         "No host input-to-step edge; Code Mode inner keys can collide and Loom meta-tool capture is excluded."),
        ("recipient_authorization", "Unsupported", ["Q5"], "native recipient read denied; same actual recipient accepts parent-inlined bytes while read stays denied",
         "Native incoming-source transfer enforcement is absent. Read denial is not permission to disclose or an incoming transfer fence."),
        ("lifecycle", "Partial", ["Q7", "R1"], "start-bound outer call; historical WorkRef; native interrupt/compact; fresh-process public read",
         "Ordinary observations store focus/fingerprint, not full WorkRef. In-flight crash and per-input late/background return attribution are unqualified."),
    ]
    return {name: {"classification": classification, "evidence_scenarios": evidence,
                   "mechanism": mechanism, "limitations": limit} for name, classification, evidence, mechanism, limit in rows}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--opencode", type=Path, default=Path(shutil.which("opencode")) if shutil.which("opencode") else None)
    parser.add_argument("--repository", type=Path, default=Path(__file__).resolve().parents[1])
    parser.add_argument("--plugin", type=Path)
    parser.add_argument("--artifact", type=Path)
    parser.add_argument("--expect-plugin-version", default="2.0.0-alpha.1")
    parser.add_argument("--report-directory", type=Path, required=True)
    parser.add_argument("--disable-filewatcher", action="store_true")
    report = run(parser.parse_args())
    print(json.dumps({key: report.get(key) for key in ("status", "execution_status", "observed_host", "error", "unqualified_reason", "scenarios", "capabilities")}))
    raise SystemExit({"PASS": 0, "FAIL": 1, "UNQUALIFIED": 2}[report["execution_status"]])


if __name__ == "__main__":
    main()
