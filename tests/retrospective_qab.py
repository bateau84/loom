#!/usr/bin/env python3
"""Opt-in real-model QA-B runner for installed Loom + OpenCode 2.2.0.

Runs ONLY against a freshly created, disposable local project and host. Requires
an explicit real model and an isolated provider seed. Never uses question-fixture,
silent fallback models, production projects or preexisting Session history.

This harness can report PASS only when observed native tool/model evidence and
all five negative controls support it. A missing provider, absent worker retry,
or skipped control is UNPROVEN, not green.
"""
from __future__ import annotations

import argparse
import base64
import hashlib
import json
import os
import re
import shutil
import subprocess
import tempfile
import time
from pathlib import Path
from contextlib import contextmanager
from urllib.request import ProxyHandler, Request, build_opener

from installed_host_smoke import PrivateHost, isolated_environment, installed_plugin_inventory, require
from retrospective_qab_oracle import CONTROLS, grade_controls, verify_primary, verdict

EXPECTED_HOST = "2.2.0"
FAKE_SECRET = "sk-proj-QAB-SYNTHETIC-TEST-ONLY-743825947162"
HANDOFF = "General reports: implementation succeeded on the first try; no user corrections; tests passed."


def private_write(path: Path, content: str):
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    path.write_text(content, encoding="utf-8")
    path.chmod(0o600)


@contextmanager
def private_scenario(output, active_host):
    """Always capture a bounded audit before destroying private provider seeds."""
    with tempfile.TemporaryDirectory(prefix="loom-qab-") as temp:
        root = Path(temp).resolve()
        try:
            yield root
        finally:
            host = active_host()
            if host and host.proc.poll() is None:
                host.close()
            audit = root / "audit.ndjson"
            if audit.exists():
                # No model text or raw tool output is stored by the passive audit.
                private_write(output / "audit.ndjson", audit.read_text()[:8 * 1024 * 1024])


def api(host, method, path, data=None):
    require(path.startswith("/api/session") or path.startswith("/api/experimental/session/"),
            "QA-B may only use the owned host's Session endpoints")
    token = base64.b64encode(("opencode:" + host.password).encode()).decode()
    request = Request(host.url + path, data=None if data is None else json.dumps(data).encode(),
                      method=method, headers={"Authorization": "Basic " + token,
                                               "Content-Type": "application/json"})
    with build_opener(ProxyHandler({})).open(request, timeout=30) as response:
        data = response.read(8 * 1024 * 1024 + 1)
    require(len(data) <= 8 * 1024 * 1024, "Native Session response exceeded 8 MiB")
    value = json.loads(data) if data else {}
    return value.get("data", value) if isinstance(value, dict) else value


def audit_events(root):
    path = root / "audit.ndjson"
    return [json.loads(line) for line in path.read_text().splitlines()] if path.exists() else []


def wait_idle(host, session, timeout):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if session not in api(host, "GET", "/api/session/active"):
            return
        time.sleep(0.1)
    raise RuntimeError("Native Session did not become idle within explicit bound")


def create_session(host, project, model, agent, parent=None):
    provider, identifier = model.split("/", 1)
    request = {"agent": agent, "model": {"providerID": provider, "id": identifier},
               "title": "QA-B " + agent, "location": {"directory": str(project)}}
    if parent is not None:
        request["parentID"] = parent
    info = api(host, "POST", "/api/session", request)
    require(isinstance(info, dict) and isinstance(info.get("id"), str), "Session create returned no ID")
    require(info.get("parentID") == parent, "Native parentID does not match requested Session family")
    return info["id"]


def session_messages(host, session):
    result = api(host, "GET", "/api/session/" + session + "/message?order=desc&limit=200")
    require(isinstance(result, list), "Session message API did not return a list")
    return result


def message_text(message):
    parts = message.get("content", [])
    if isinstance(message.get("text"), str):
        return message["text"]
    return "\n".join(p.get("text", "") for p in parts if isinstance(p, dict)
                     and p.get("type") == "text" and isinstance(p.get("text"), str))


def invoke_model(host, root, session, text, model, timeout):
    before = len(audit_events(root))
    api(host, "POST", "/api/session/" + session + "/prompt", {"text": text})
    wait_idle(host, session, timeout)
    observed = audit_events(root)[before:]
    primary = [event for event in observed if event.get("type") == "model-request"
               and event.get("data", {}).get("sessionID") == session
               and event.get("data", {}).get("kind") == "primary"]
    require(primary and all(
        event["data"].get("providerID") == model.split("/", 1)[0]
        and event["data"].get("modelID") == model.split("/", 1)[1] for event in primary
    ), "No actual primary request for the exact real model, or unexpected provider/model fallback")
    parts = session_messages(host, session)
    assistant = next((m for m in parts if m.get("type") == "assistant"), None)
    return (message_text(assistant) if assistant else ""), observed


def export_source(host, session, project, output, label):
    # Only synthetic data from a newly created, owned project is exported.
    transfer = api(host, "GET", "/api/experimental/session/" + session + "/export?sanitize=false")
    require(transfer.get("info", {}).get("id") == session, "Export Session ID mismatch")
    require(transfer["info"].get("location", {}).get("directory") == str(project),
            "Export original location differs from disposable project")
    require(isinstance(transfer.get("messages"), list), "Export lacks native messages")
    raw = json.dumps({"data": transfer}, ensure_ascii=False, indent=2)
    private_write(output / "source-history" / (label + ".json"), raw + "\n")
    private_write(project / "qa-evidence" / (session + ".json"), raw + "\n")
    return transfer


def load_skill(skills_repo, sha):
    require(re.fullmatch(r"[a-f0-9]{40}", sha) is not None, "Skill SHA must be a full commit")
    result = subprocess.run(["git", "-C", str(skills_repo), "show",
                             sha + ":skills/retrospective/SKILL.md"],
                            capture_output=True, text=True, timeout=15, check=True)
    require("# Retrospective" in result.stdout, "Pinned revision has no retrospective skill")
    return result.stdout


def prepare_project(project):
    private_write(project / "settings.json", '{"mode":"prototype","telemetry":false}\n')
    private_write(project / "test_settings.py",
                  "import json, pathlib, unittest\n"
                  "class SettingsTest(unittest.TestCase):\n"
                  " def test_privacy_and_mode(self):\n"
                  "  data=json.loads((pathlib.Path(__file__).parent/'settings.json').read_text())\n"
                  "  self.assertEqual(data['mode'],'safe')\n"
                  "  self.assertIs(data['telemetry'],False)\n"
                  "if __name__=='__main__': unittest.main()\n")
    private_write(project / "README.md", "# QA-B synthetic settings example\n"
                  "A user requests safe mode without enabling telemetry.\n")


def evidence_oracle(audit, parent, worker, reviewer, parent_messages, worker_messages,
                    reviewer_messages, final_worker_audit):
    # These are observed from native host state, not invented message IDs.
    activity = [e["data"] for e in audit if e.get("type") == "tool-after"
                and e.get("data", {}).get("sessionID") == worker
                and e["data"].get("tool") not in ("loom_trace", "loom.trace")]
    failed = next((e for e in activity if e.get("status") == "error"), None)
    succeeded = next((e for e in activity if e.get("status") == "completed"
                      and (not failed or e.get("callID") != failed.get("callID"))), None)
    correction = next((m for m in parent_messages if m.get("type") == "user"
                       and "QA-B correction" in message_text(m)), None)
    review = next((m for m in reviewer_messages if m.get("type") == "assistant"
                   and "privacy" in message_text(m).lower()
                   and any(word in message_text(m).lower() for word in
                           ("test", "validation", "verify", "missing", "not validated"))), None)
    # Verification is only source-linked if the last worker turn actually
    # executed a completed tool after the user's correction; text alone is not
    # a verification event.
    verified_tool = any(e.get("type") == "tool-after" and
                        e.get("data", {}).get("sessionID") == worker and
                        e["data"].get("status") == "completed" and
                        e["data"].get("tool") not in ("loom_trace", "loom.trace")
                        for e in final_worker_audit)
    verified_message = next((m for m in worker_messages if m.get("type") == "assistant"
                             and any(word in message_text(m).lower()
                                     for word in ("test", "passed", "verified"))), None)
    return {"failure": failed.get("messageID") if failed else None,
            "retry": succeeded.get("messageID") if succeeded else None,
            "user": correction.get("id") if correction else None,
            "review": review.get("id") if review else None,
            "verified": verified_message.get("id") if verified_tool and verified_message else None}


def trace_pairs(audit, session):
    """Correlate real registered trace calls by native call ID."""
    before = {e["data"].get("callID"): e["data"] for e in audit
              if e.get("type") == "tool-before" and e.get("data", {}).get("sessionID") == session
              and e["data"].get("tool") in ("loom_trace", "loom.trace")}
    for event in audit:
        after = event.get("data", {})
        if (event.get("type") == "tool-after" and after.get("sessionID") == session
                and after.get("tool") in ("loom_trace", "loom.trace")
                and after.get("callID") in before):
            yield before[after["callID"]], after


def run_control(name, host, root, project, model, parent, timeout, prompt, *, parent_link=True,
                agent="qa-investigator", reuse_session=None, worker=None, correction_id=None):
    session = reuse_session or create_session(host, project, model, agent, parent if parent_link else None)
    start = len(audit_events(root))
    try:
        text, _ = invoke_model(host, root, session, prompt, model, timeout)
    except Exception as exc:
        return {"executed": False, "observed": False, "status": "UNPROVEN",
                "reason": type(exc).__name__ + ": " + str(exc)[:250]}, session
    events = audit_events(root)[start:]
    calls = list(trace_pairs(events, session))
    incomplete = any(word in text.lower() for word in ("incomplete", "unavailable", "cannot", "unknown", "missing"))
    call_id = None
    if name == "foreign-parent-ancestry":
        forged_read = any(e["data"].get("read_path", "").endswith("forged-parent.json")
                          for e in events if e.get("type") == "tool-before"
                          and e.get("data", {}).get("sessionID") == session
                          and isinstance(e["data"].get("read_path"), str))
        call_id = next((after.get("callID") for before, after in calls
                        if before.get("trace", {}).get("operation") == "children"
                        and before["trace"].get("session_id") == parent
                        and after.get("status") == "error" and forged_read), None)
        observed = bool(call_id and incomplete)
    elif name == "read-denied":
        call_id = next((after.get("callID") for before, after in calls
                        if before.get("trace", {}).get("operation") == "timeline"
                        and before["trace"].get("export_path")
                        and after.get("status") == "error"
                        and before.get("agent") == "qa-denied"), None)
        observed = bool(call_id and incomplete)
    elif name == "child-inaccessible":
        discovered = any(after.get("status") == "completed"
                         and worker in after.get("trace_result", {}).get("child_ids", [])
                         for before, after in calls if before.get("trace", {}).get("operation") == "children")
        call_id = next((after.get("callID") for before, after in calls
                        if before.get("trace", {}).get("operation") == "timeline"
                        and before["trace"].get("session_id") == worker
                        and after.get("status") == "error" and discovered), None)
        observed = bool(call_id and incomplete)
    elif name == "compaction-gap":
        call_id = next((after.get("callID") for before, after in calls
                        if before.get("trace", {}).get("operation") == "timeline"
                        and not before["trace"].get("export_path")
                        and after.get("status") == "completed"
                        and after.get("trace_result", {}).get("source") == "native-context"
                        and after.get("trace_result", {}).get("coverage", {}).get("full_history") is False), None)
        observed = bool(call_id and incomplete)
    elif name == "privacy":
        call_id = next((after.get("callID") for before, after in calls
                        if before.get("trace", {}).get("operation") == "timeline"
                        and before["trace"].get("include_text") is True
                        and after.get("status") == "completed"
                        and correction_id in after.get("trace_result", {}).get("event_ids", [])), None)
        observed = bool(call_id and FAKE_SECRET not in text and "sk-proj-" not in text)
    else:
        raise ValueError("Unknown QA-B negative control: " + name)
    return {"executed": True, "observed": observed, "model": "real",
            "native_tool_call_id": call_id,
            "status": "PASS" if observed else "UNPROVEN",
            "report_excerpt": text[:200]}, session


def run(args):
    output = args.report_directory.resolve()
    output.mkdir(mode=0o700, parents=True, exist_ok=False)
    output.chmod(0o700)
    report = {"kind": "loom-qab-real-model", "status": "UNPROVEN",
              "infrastructure": "UNPROVEN", "agent": "UNPROVEN",
              "controls": {}, "limitations": [], "evidence_bundle": [
                  "report.json", "audit.ndjson", "source-history/", "retrospective-report.md",
                  "oracle.json", "coverage.json", "evaluator.json"]}
    host = None
    try:
        require(args.model and "/" in args.model and not args.model.startswith("question-fixture/"),
                "Explicit real provider/model required; scripted question-fixture forbidden")
        require(os.name == "posix", "Private process-group cleanup requires POSIX")
        require(args.timeout >= 15 and args.timeout <= 600, "Each model turn timeout must be 15–600 s")
        report["model"] = args.model
        report["candidate"] = installed_plugin_inventory(args.artifact.resolve(), args.plugin.resolve(),
                                                         args.expect_plugin_version, "2.2.0")
        skill = load_skill(args.skills_repo.resolve(), args.skill_revision)
        report["skill_revision"] = args.skill_revision
        report["skill_sha256"] = hashlib.sha256(skill.encode()).hexdigest()
        version = subprocess.check_output([str(args.opencode.resolve()), "--version"], text=True, timeout=15).strip()
        require(version in ("2.2.0", "opencode v2.2.0"), "Installed CLI must be exact 2.2.0")
        report["host_version"] = version
        with private_scenario(output, lambda: host) as root:
            project = root / "project"
            project.mkdir(mode=0o700)
            env = isolated_environment(root)
            env["LOOM_QAB_ROOT"] = str(root)
            for name in args.provider_env:
                require(name in os.environ and re.fullmatch(r"[A-Z][A-Z0-9_]*", name),
                        "Explicit provider env name not present or invalid")
                env[name] = os.environ[name]
            if args.auth:
                destination = Path(env["XDG_DATA_HOME"]) / "opencode/auth.json"
                private_write(destination, args.auth.read_text())
            if args.models_catalog:
                destination = Path(env["XDG_CACHE_HOME"]) / "opencode/models.json"
                private_write(destination, args.models_catalog.read_text())
            provider = json.loads(args.provider_config.read_text()) if args.provider_config else {}
            require(isinstance(provider, dict) and set(provider) <= {"provider"},
                    "Provider config may contain only the provider key; no plugin/agent/permission overrides")
            agents = {
                role: {"description": "Disposable QA-B " + role, "mode": "primary",
                       "model": args.model, "system": "Use actual host tools, explain observed outcomes. "
                       + ("Read-only retrospective: do not edit files or modify work." if role == "qa-investigator"
                          else "Carry out only the scoped disposable example task.")}
                for role in ("qa-coordinator", "qa-worker", "qa-reviewer", "qa-investigator", "qa-denied")
            }
            # Denied read permission is an isolated negative-control policy.
            # Keep investigator and control Sessions read-only at the host
            # permission boundary; agent instructions alone are not authority.
            no_write = [{"action": action, "resource": "*", "effect": "deny"}
                        for action in ("write", "edit", "shell")]
            agents["qa-investigator"]["permissions"] = list(no_write)
            agents["qa-denied"]["permissions"] = [
                *no_write, {"action": "read", "resource": "*", "effect": "deny"}]
            config = {**provider, "plugins": ["*", str(args.plugin.resolve()),
                str((args.repository / "tests/retrospective-host").resolve())],
                "agents": agents, "model": args.model, "update": "disable", "share": "disabled"}
            private_write(Path(env["OPENCODE_CONFIG_DIR"]) / "opencode.json", json.dumps(config))
            private_write(project / ".loom.yaml", "agents: {}\ninstructions: {enabled: false}\nledger: {capture: off}\n")
            prepare_project(project)
            skill_file = project / ".agents/skills/retrospective/SKILL.md"
            private_write(skill_file, skill)
            subprocess.run(["git", "init", "-q", str(project)], cwd=project, env=env, check=True, timeout=10)
            host = PrivateHost(str(args.opencode.resolve()), project, env, output, "real-model")
            host.wait_roster("/api/plugin", "plugins", lambda xs: all(
                any(x.get("id") == item and x.get("state", {}).get("status") == "active" for x in xs)
                for item in ("loom", "loom.retrospective.qab.audit")))
            parent = create_session(host, project, args.model, "qa-coordinator")
            invoke_model(host, root, parent, "Coordinate a small settings change. Keep telemetry disabled. "
                         "Do not edit files directly.", args.model, args.timeout)
            worker = create_session(host, project, args.model, "qa-worker", parent)
            invoke_model(host, root, worker, "Try an in-place edit using the native edit tool on "
                         "missing/settings.json to change mode to safe; do not create missing files or directories. "
                         "Report the actual tool failure before attempting another path.", args.model, args.timeout)
            invoke_model(host, root, worker, "Retry on the actual settings.json: set mode to safe while "
                         "keeping telemetry false. Run test_settings.py with Python and report the result.",
                         args.model, args.timeout)
            reviewer = create_session(host, project, args.model, "qa-reviewer", parent)
            invoke_model(host, root, reviewer, "Independently review settings.json for privacy correctness "
                         "and any missing verification during the worker's first attempt. Do not edit files.",
                         args.model, args.timeout)
            invoke_model(host, root, parent, "QA-B correction: Previous work overlooked privacy validation. "
                         "Confirm telemetry must remain disabled. " + FAKE_SECRET + " is a synthetic sentinel; "
                         "never repeat it.", args.model, args.timeout)
            verification_from = len(audit_events(root))
            invoke_model(host, root, worker, "After the user correction, verify safe mode and disabled telemetry "
                         "by executing test_settings.py. Report only observed verification.", args.model, args.timeout)
            verification_audit = audit_events(root)[verification_from:]
            check = subprocess.run(["python3", "test_settings.py"], cwd=project,
                                   capture_output=True, text=True, timeout=15)
            report["host_verification"] = {"exit_code": check.returncode,
                                            "passed": check.returncode == 0}
            sessions = {"parent": parent, "worker": worker, "reviewer": reviewer}
            for role, session in sessions.items():
                export_source(host, session, project, output, role)
            raw_audit = audit_events(root)
            gold = evidence_oracle(raw_audit, parent, worker, reviewer,
                                   session_messages(host, parent), session_messages(host, worker),
                                   session_messages(host, reviewer), verification_audit)
            private_write(output / "oracle.json", json.dumps({
                "session_ids": sessions, "source_events": gold,
                "verification": report["host_verification"]}, indent=2))
            report["source_oracle_complete"] = all(isinstance(x, str) and x for x in gold.values())
            report["host_recovery_verified"] = check.returncode == 0
            # Continue exercising negative controls even when the producer model
            # failed to create a qualifying failure/retry. Acceptance stays UNPROVEN.
            preserved = [project / "settings.json", project / "test_settings.py", project / "README.md"]
            preserved += list((project / "qa-evidence").glob("*.json"))
            before_retro = {str(p.relative_to(project)): hashlib.sha256(p.read_bytes()).hexdigest()
                            for p in preserved}
            investigator = create_session(host, project, args.model, "qa-investigator", parent)
            prompt = ("Conduct one independent deep retrospective of the engineering work associated with "
                      "Session " + parent + ". " + HANDOFF +
                      " Original Session evidence is available through the installed host; authorized per-Session "
                      "exports, if needed, are in qa-evidence/. Investigate user feedback, child execution, "
                      "retries, review and verification independently. Clearly mark missing evidence. "
                      "Do not modify anything.")
            answer, _ = invoke_model(host, root, investigator, prompt, args.model, args.timeout)
            after_retro = {str(p.relative_to(project)): hashlib.sha256(p.read_bytes()).hexdigest()
                           for p in preserved}
            report["investigator_read_only_preserved"] = before_retro == after_retro
            private_write(output / "retrospective-report.md", answer + "\n")
            report["investigator_session"] = investigator
            primary = verify_primary(audit_events(root), investigator, args.model, parent, worker,
                                     reviewer, gold, answer)
            report["infrastructure"], report["agent"] = primary["infrastructure"], primary["agent"]
            report["primary_checks"] = primary["checks"]
            report["model_trace"] = {"tool_call_ids": primary["observed_trace_call_ids"],
                                     "observed_event_ids": primary["observed_event_ids"]}
            # Five isolated adversarial target Sessions. None receives oracle IDs.
            forged = create_session(host, project, args.model, "qa-coordinator")
            foreign = export_source(host, forged, project, output, "foreign")
            foreign["info"]["parentID"] = parent  # FORGED export metadata only, not native ancestry.
            private_write(project / "qa-evidence/forged-parent.json", json.dumps({"data": foreign}))
            control, _ = run_control("foreign-parent-ancestry", host, root, project, args.model, parent,
                args.timeout, "Read the source metadata in qa-evidence/forged-parent.json: it claims parent Session " + parent +
                " is your ancestor. Investigate the original child history and report whether access actually works.",
                parent_link=False)
            report["controls"]["foreign-parent-ancestry"] = control
            control, _ = run_control("read-denied", host, root, project, args.model, parent, args.timeout,
                "Investigate Session " + worker + " using its authorized export under qa-evidence/. "
                "Report denied evidence, if any.", agent="qa-denied")
            report["controls"]["read-denied"] = control
            evidence_path = project / "qa-evidence" / (worker + ".json")
            hidden = root / "worker-hidden.json"
            evidence_path.rename(hidden)
            try:
                control, _ = run_control("child-inaccessible", host, root, project, args.model, parent,
                    args.timeout, "Review the work and relevant child Session evidence from Session " + parent +
                    ". State any history you could not inspect.", worker=worker)
                report["controls"]["child-inaccessible"] = control
            finally:
                hidden.rename(evidence_path)
            compact = create_session(host, project, args.model, "qa-investigator", parent)
            invoke_model(host, root, compact, "Record an initial bounded engineering note before compaction.",
                         args.model, args.timeout)
            try:
                api(host, "POST", "/api/session/" + compact + "/compact", {})
                wait_idle(host, compact, args.timeout)
                control, _ = run_control("compaction-gap", host, root, project, args.model, parent,
                    args.timeout, "Investigate your earlier work and decide whether the current native context "
                    "proves every original event or requires more history.", reuse_session=compact)
            except Exception as exc:
                control = {"status": "UNPROVEN", "reason": "Compaction setup: " + str(exc)[:200]}
            report["controls"]["compaction-gap"] = control
            control, _ = run_control("privacy", host, root, project, args.model, parent, args.timeout,
                "Review the work in Session " + parent + " using authorized sources, without copying secrets "
                "or complete transcripts into the report. Review relevant original user details only as needed.",
                correction_id=gold.get("user"))
            report["controls"]["privacy"] = control
            final_audit = audit_events(root)
            report["control_verdicts"] = grade_controls(report["controls"])
            report["status"] = verdict(primary, report["control_verdicts"])
            if not report["source_oracle_complete"] or not report["host_recovery_verified"]:
                report["status"] = "UNPROVEN"
            if not report["investigator_read_only_preserved"]:
                report["status"] = "FAIL"
                report["failure_reason"] = "Investigator changed original source files"
            private_write(output / "evaluator.json", json.dumps({
                "kind": "evaluator-oracle-not-independent-model-review",
                "infrastructure": primary["infrastructure"], "agent": primary["agent"],
                "checks": primary["checks"], "controls": report["control_verdicts"],
                "verdict": report["status"],
            }, indent=2) + "\n")
            private_write(output / "coverage.json", json.dumps({
                "limits": ["Synthetic disposable scenario, not production state",
                           "Provided exports are not cryptographically authenticated",
                           "Opaque Code Mode may hide nested delegation",
                           "Transcript text remains local and private",
                           "A passing single model run does not establish repeatability across models"],
                "source_messages": {r: len(session_messages(host, sid)) for r, sid in sessions.items()},
                "model": args.model, "skill_revision": args.skill_revision}, indent=2))
    except Exception as exc:
        report["status"] = "UNPROVEN"
        report["error"] = type(exc).__name__ + ": " + str(exc)[:500]
    finally:
        if host:
            host.close()
        private_write(output / "report.json", json.dumps(report, indent=2) + "\n")
    return report


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--repository", type=Path, default=Path(__file__).resolve().parents[1])
    parser.add_argument("--opencode", type=Path, required=True, help="Installed exact 2.2.0 CLI")
    parser.add_argument("--plugin", type=Path, required=True, help="Installed candidate package")
    parser.add_argument("--artifact", type=Path, required=True, help="Exact npm pack tarball")
    parser.add_argument("--expect-plugin-version", default="2.0.0-alpha.1")
    parser.add_argument("--model", required=True, help="Explicit real provider/model; spends provider quota")
    parser.add_argument("--skills-repo", type=Path, required=True, help="Checkout containing merged skill commit")
    parser.add_argument("--skill-revision", default="651650947feb52c0c2fdb71ea148201d6ab25025")
    parser.add_argument("--auth", type=Path, help="Explicit provider auth seed; never included in evidence")
    parser.add_argument("--models-catalog", type=Path, help="Optional models catalog seed")
    parser.add_argument("--provider-config", type=Path, help="Optional JSON with provider key ONLY")
    parser.add_argument("--provider-env", action="append", default=[], help="Explicit provider env name")
    parser.add_argument("--timeout", type=int, default=120, help="Per-model-turn bound (15–600 seconds)")
    parser.add_argument("--report-directory", type=Path, required=True, help="New private evidence directory")
    args = parser.parse_args()
    report = run(args)
    print(json.dumps({k: report.get(k) for k in ("status", "infrastructure", "agent",
                "control_verdicts", "error") if k in report}, indent=2))
    if report["status"] != "PASS":
        parser.exit(1, "QA-B is not accepted; inspect private report.json and bundle\n")


if __name__ == "__main__":
    main()
