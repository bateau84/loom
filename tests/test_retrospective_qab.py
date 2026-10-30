"""Provider-free contract checks for QA-B grading, not a real-model PASS."""
import unittest
import argparse
import json
import sqlite3
import subprocess
import sys
import tempfile
from pathlib import Path
from unittest.mock import patch

from retrospective_qab import (evidence_oracle, prepare_project, run as run_real_qab,
                               run_control, seed_credential_database, ensure_model_available,
                               completed_model_text, summarize_native_tools,
                               source_gate, skip_unqualified_source,
                               skip_unqualified_primary, public_summary,
                               set_worker_write_gate, observed_patch_error)
from retrospective_qab_oracle import CONTROLS, grade_controls, verify_primary, verdict, paired_trace_events

INVESTIGATOR, PARENT, WORKER, REVIEWER = "investigator", "parent", "worker", "reviewer"
EVENTS = {"failure": "msg_failure", "retry": "msg_retry", "user": "msg_correction",
          "review": "msg_review", "verified": "msg_verified"}
MODEL = "openai/gpt-example"


def model_audit():
    return [{"type": "model-request", "data": {"sessionID": INVESTIGATOR,
             "kind": "primary", "providerID": "openai", "modelID": "gpt-example"}}]


def trace(call_id, op, session_id, result):
    return [
        {"type": "tool-before", "data": {"sessionID": INVESTIGATOR,
            "tool": "loom_trace", "callID": call_id,
            "trace": {"operation": op, "session_id": session_id, "export_path": "evidence.json"}}},
        {"type": "tool-after", "data": {"sessionID": INVESTIGATOR,
            "tool": "loom_trace", "callID": call_id, "status": "completed",
            "trace_result": {"parse": "ok", "session_id": session_id,
                             "coverage": {"full_history": None, "delegation_complete": False},
                             **result}}},
    ]


def sufficient():
    audit = model_audit()
    audit.extend([
        {"type": "tool-before", "data": {"sessionID": INVESTIGATOR, "tool": "skill",
            "callID": "load", "skill_id": "retrospective"}},
        {"type": "tool-after", "data": {"sessionID": INVESTIGATOR, "tool": "skill",
            "callID": "load", "status": "completed"}},
    ])
    audit += trace("discover", "children", PARENT, {"child_ids": [WORKER, REVIEWER]})
    audit += trace("parent", "timeline", PARENT, {"event_ids": ["msg_correction"]})
    audit += trace("worker", "timeline", WORKER,
                   {"event_ids": ["msg_failure", "msg_retry", "msg_verified"]})
    audit += trace("review", "timeline", REVIEWER, {"event_ids": ["msg_review"]})
    report = ("General's first-try claim was false and the handoff contradicted the correction. " +
              " ".join(EVENTS.values()))
    return audit, report


class QABEvidenceTests(unittest.TestCase):
    def grade(self, audit=None, report=""):
        return verify_primary(audit or [], INVESTIGATOR, MODEL, PARENT, WORKER, REVIEWER,
                              EVENTS, report)

    def test_narrative_only_is_never_evidence_of_model_tool_use(self):
        audit, report = sufficient()
        row = self.grade(report=report)
        self.assertEqual(row["infrastructure"], "UNPROVEN")
        self.assertEqual(row["agent"], "UNPROVEN")
        self.assertEqual(row["observed_trace_call_ids"], [])

    def test_real_model_request_without_native_child_discovery_is_unproven(self):
        audit, report = sufficient()
        audit = [x for x in audit if x.get("data", {}).get("callID") != "discover"]
        row = self.grade(audit, report)
        self.assertEqual(row["checks"]["model-discovered-children"], "UNPROVEN")
        self.assertEqual(row["agent"], "UNPROVEN")

    def test_skill_visibility_alone_does_not_count_as_load(self):
        audit, report = sufficient()
        audit = [e for e in audit if e.get("data", {}).get("callID") != "load"]
        row = self.grade(audit, report)
        self.assertEqual(row["checks"]["retrospective-skill-loaded"], "UNPROVEN")
        self.assertEqual(row["agent"], "UNPROVEN")

    def test_unpaired_tool_before_does_not_count_as_source_read(self):
        audit, report = sufficient()
        audit = [x for x in audit if not (
            x["type"] == "tool-after" and x["data"].get("callID") == "worker")]
        row = self.grade(audit, report)
        self.assertEqual(row["checks"]["model-read-source-events"], "UNPROVEN")
        self.assertEqual(row["agent"], "UNPROVEN")

    def test_negative_controls_cannot_pass_on_unexecuted_claims(self):
        controls = {k: {"status": "PASS", "executed": False, "observed": True, "model": "real"}
                    for k in CONTROLS}
        self.assertTrue(all(v == "UNPROVEN" for v in grade_controls(controls).values()))
        self.assertEqual(verdict(self.grade(), grade_controls(controls)), "UNPROVEN")

    def test_complete_synthetic_audit_is_recognized_only_as_oracle_unit_contract(self):
        audit, report = sufficient()
        row = self.grade(audit, report)
        self.assertEqual(row["infrastructure"], "PASS")
        self.assertEqual(row["agent"], "PASS")
        controls = {k: {"executed": True, "observed": True, "model": "real",
                        "native_tool_call_id": "call_" + k} for k in CONTROLS}
        self.assertEqual(verdict(row, grade_controls(controls)), "PASS")

    def test_explicit_failed_control_fails_aggregate(self):
        audit, report = sufficient()
        controls = {k: {"status": "FAIL"} for k in CONTROLS}
        self.assertEqual(verdict(self.grade(audit, report), grade_controls(controls)), "FAIL")

    def test_question_fixture_provider_cannot_pass_real_model_boundary(self):
        audit, report = sufficient()
        audit[0]["data"]["providerID"] = "question-fixture"
        audit[0]["data"]["modelID"] = "reader"
        row = self.grade(audit, report)
        self.assertEqual(row["checks"]["real-model-primary"], "UNPROVEN")
        self.assertEqual(row["agent"], "UNPROVEN")


    def test_disposable_fixture_has_a_real_initial_failure_and_verifiable_recovery(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            prepare_project(root)
            command = [sys.executable, "-I", "-B", "test_settings.py"]
            prior = subprocess.run(command, cwd=root, capture_output=True, text=True, timeout=10)
            self.assertNotEqual(prior.returncode, 0, "Initial unsafe mode must fail real Python test")
            (root / "settings.json").write_text('{"mode":"safe","telemetry":false}\n')
            after = subprocess.run(command, cwd=root, capture_output=True, text=True, timeout=10)
            self.assertEqual(after.returncode, 0, after.stderr)

    def test_source_retry_oracle_rejects_pre_failure_success_and_wrong_tool(self):
        # An earlier read completion and later shell success must not count as
        # a successful retry of a failed edit.
        def calls(steps):
            return [{"type": "tool-after", "data": {
                "sessionID": WORKER, "status": status, "tool": tool,
                "messageID": msg, "callID": str(i)}} for i, (status, tool, msg) in enumerate(steps)]
        parent_messages = [{"id": "msg_correction", "type": "user",
                            "text": "QA-B correction: keep privacy."}]
        reviewer_messages = [{"id": "msg_review", "type": "assistant",
                              "text": "Privacy was not validated by the first test."}]
        worker_messages = [{"id": "msg_verify", "type": "assistant",
                            "text": "Verified test passed."}]
        items = [("completed", "read", "pre"),
                 ("error", "edit", "failed"),
                 ("completed", "shell", "different_tool")]
        gold = evidence_oracle(calls(items), PARENT, WORKER, REVIEWER,
                               parent_messages, worker_messages, reviewer_messages, calls([
                                   ("completed", "shell", "msg_verify")]))
        self.assertEqual(gold["failure"], "failed")
        self.assertIsNone(gold["retry"])
        items.append(("completed", "edit", "recovered"))
        gold = evidence_oracle(calls(items), PARENT, WORKER, REVIEWER,
                               parent_messages, worker_messages, reviewer_messages, calls([
                                   ("completed", "shell", "msg_verify")]))
        self.assertEqual(gold["retry"], "recovered")


    def test_verified_recovery_requires_correlated_native_test_command(self):
        parent = [{"id": "msg_correction", "type": "user",
                   "text": "QA-B correction: preserve privacy."}]
        worker = [{"id": "msg_verified", "type": "assistant",
                   "text": "Test passed after verification."}]
        reviewer = [{"id": "msg_review", "type": "assistant",
                     "text": "Privacy validation missing in first test."}]
        observed = [
            {"type": "tool-before", "data": {"sessionID": WORKER, "callID": "verify",
                "tool": "shell", "verification_command": True}},
            {"type": "tool-after", "data": {"sessionID": WORKER, "callID": "verify",
                "tool": "shell", "status": "completed"}},
        ]
        old_only = evidence_oracle([], PARENT, WORKER, REVIEWER, parent, worker, reviewer,
                                   observed[1:])
        self.assertIsNone(old_only["verified"])
        good = evidence_oracle([], PARENT, WORKER, REVIEWER, parent, worker, reviewer, observed)
        self.assertEqual(good["verified"], "msg_verified")


    def test_confirmed_unauthorized_child_inventory_is_fail_not_unproven(self):
        observed = [
            {"type": "tool-before", "data": {
                "sessionID": INVESTIGATOR, "callID": "bypass",
                "tool": "loom_trace", "trace": {
                    "operation": "children", "session_id": PARENT}}},
            {"type": "tool-after", "data": {
                "sessionID": INVESTIGATOR, "callID": "bypass",
                "tool": "loom_trace", "status": "completed"}},
        ]
        # These stubs exercise ONLY the local evaluator, not an installed host.
        with (
            patch("retrospective_qab.create_session", return_value=INVESTIGATOR),
            patch("retrospective_qab.invoke_model", return_value=("source available", [])),
            patch("retrospective_qab.audit_events", side_effect=[[], observed]),
        ):
            check, _ = run_control("foreign-parent-ancestry", None, None, None,
                                   MODEL, PARENT, 30, "investigate", parent_link=False)
        self.assertEqual(check["status"], "FAIL")
        self.assertEqual(check["native_tool_call_id"], "bypass")


    def test_read_denial_control_requires_permission_error_not_generic_failure(self):
        def audit(error_kind):
            return [
                {"type": "tool-before", "data": {
                    "sessionID": INVESTIGATOR, "agent": "qa-denied",
                    "callID": "denial", "tool": "loom_trace", "trace": {
                        "operation": "timeline", "session_id": WORKER,
                        "export_path": "qa-evidence/worker.json"}}},
                {"type": "tool-after", "data": {
                    "sessionID": INVESTIGATOR, "callID": "denial",
                    "tool": "loom_trace", "status": "error", "error_kind": error_kind}},
            ]
        for kind, expected in [("other", "UNPROVEN"), ("permission-denied", "PASS")]:
            with (
                self.subTest(kind=kind),
                patch("retrospective_qab.create_session", return_value=INVESTIGATOR),
                patch("retrospective_qab.invoke_model", return_value=("Source incomplete", [])),
                patch("retrospective_qab.audit_events", side_effect=[[], audit(kind)]),
            ):
                result, _ = run_control("read-denied", None, None, None,
                                        MODEL, PARENT, 30, "inspect", agent="qa-denied", worker=WORKER)
                self.assertEqual(result["status"], expected)

    def test_child_unavailable_control_requires_missing_export_error(self):
        def audit(error_kind):
            return [
                {"type": "tool-before", "data": {"sessionID": INVESTIGATOR, "callID": "children",
                    "tool": "loom_trace", "trace": {"operation": "children", "session_id": PARENT}}},
                {"type": "tool-after", "data": {"sessionID": INVESTIGATOR, "callID": "children",
                    "tool": "loom_trace", "status": "completed",
                    "trace_result": {"child_ids": [WORKER]}}},
                {"type": "tool-before", "data": {"sessionID": INVESTIGATOR, "callID": "missing",
                    "tool": "loom_trace", "trace": {"operation": "timeline",
                    "session_id": WORKER, "export_path": "qa-evidence/worker.json"}}},
                {"type": "tool-after", "data": {"sessionID": INVESTIGATOR, "callID": "missing",
                    "tool": "loom_trace", "status": "error", "error_kind": error_kind}},
            ]
        for kind, expected in [("permission-denied", "UNPROVEN"), ("missing-export", "PASS")]:
            with (
                self.subTest(kind=kind),
                patch("retrospective_qab.create_session", return_value=INVESTIGATOR),
                patch("retrospective_qab.invoke_model", return_value=("Child history unavailable", [])),
                patch("retrospective_qab.audit_events", side_effect=[[], audit(kind)]),
            ):
                result, _ = run_control("child-inaccessible", None, None, None,
                                        MODEL, PARENT, 30, "inspect", worker=WORKER)
                self.assertEqual(result["status"], expected)


    def test_scripted_provider_is_rejected_before_running_any_installed_host(self):
        with tempfile.TemporaryDirectory() as temp:
            path = Path(temp) / "new-private-result"
            options = argparse.Namespace(report_directory=path, model="question-fixture/reader", timeout=30)
            result = run_real_qab(options)
            self.assertEqual(result["status"], "UNPROVEN")
            self.assertIn("question-fixture forbidden", result["error"])
            self.assertEqual(json.loads((path / "report.json").read_text())["status"], "UNPROVEN")
            self.assertEqual(path.stat().st_mode & 0o777, 0o700)


    def test_passive_audit_directory_has_discoverable_v2_server_part(self):
        # OpenCode V2 resolves configured local directories using server.ts
        # or index.ts, not arbitrary filenames like audit.ts. This must fail
        # before relying on the installed-host qualification.
        directory = Path(__file__).resolve().parent / "retrospective-host"
        self.assertTrue((directory / "audit.ts").is_file(), "QA-B audit implementation missing")
        entry = directory / "server.ts"
        self.assertTrue(entry.is_file(), "QA-B directory needs a server.ts entrypoint")
        self.assertIn('export { default } from "./audit.ts"', entry.read_text(encoding="utf-8"))


    def test_sanitized_database_keeps_credentials_not_session_history(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            original, seeded = root / "original.db", root / "isolated" / "opencode.db"
            with sqlite3.connect(original) as db:
                db.executescript("""
                    CREATE TABLE credential (id TEXT PRIMARY KEY, integration_id TEXT, value TEXT);
                    CREATE TABLE session (id TEXT PRIMARY KEY, private_message TEXT);
                    CREATE TABLE project (id TEXT PRIMARY KEY, path TEXT);
                    CREATE TABLE migration (hash TEXT PRIMARY KEY);
                    CREATE INDEX credential_by_provider ON credential(integration_id);
                """)
                db.execute("INSERT INTO credential VALUES (?,?,?)",
                           ("cred-1", "opencode", '{"type":"key","key":"synthetic-only"}'))
                db.execute("INSERT INTO session VALUES (?,?)",
                           ("ses-private", "DO_NOT_COPY_PRIVATE_SESSION"))
                db.execute("INSERT INTO project VALUES (?,?)", ("project-private", "/private/work"))
                db.execute("INSERT INTO migration VALUES (?)", ("migration-1",))
                db.commit()
            count = seed_credential_database(original, seeded)
            self.assertEqual(count, 1)
            self.assertEqual(seeded.stat().st_mode & 0o777, 0o600)
            with sqlite3.connect(seeded) as db:
                self.assertEqual(db.execute("SELECT COUNT(*) FROM credential").fetchone()[0], 1)
                self.assertEqual(db.execute("SELECT COUNT(*) FROM migration").fetchone()[0], 1)
                self.assertEqual(db.execute("SELECT COUNT(*) FROM session").fetchone()[0], 0)
                self.assertEqual(db.execute("SELECT COUNT(*) FROM project").fetchone()[0], 0)
                self.assertEqual(db.execute("PRAGMA integrity_check").fetchone()[0], "ok")
            with sqlite3.connect(original) as db:
                self.assertEqual(db.execute("SELECT COUNT(*) FROM session").fetchone()[0], 1)

    def test_invalid_database_source_fails_without_leaving_secret_copy(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            original, seeded = root / "bad.db", root / "isolated" / "opencode.db"
            with sqlite3.connect(original) as db:
                db.execute("CREATE TABLE session (id TEXT)")
            with self.assertRaisesRegex(RuntimeError, "credential table"):
                seed_credential_database(original, seeded)
            self.assertFalse(seeded.exists())

    def test_requested_model_must_match_provider_and_id(self):
        available = [
            {"providerID": "opencode-go", "id": "gpt-6-luna"},
            {"providerID": "openai", "id": "gpt-6.1-sol"},
        ]
        ensure_model_available(available, "opencode-go/gpt-6-luna")
        with self.assertRaisesRegex(RuntimeError, "opencode-go/gpt-6-luna"):
            ensure_model_available(available, "openai/gpt-6-luna")


    def test_model_request_without_new_completed_assistant_is_not_success(self):
        old = [{"id": "msg_old", "type": "assistant", "finish": "stop",
                "time": {"completed": 1}, "content": [{"type": "text", "text": "old"}]}]
        with self.assertRaisesRegex(RuntimeError, "no new assistant"):
            completed_model_text(old, old)
        with self.assertRaisesRegex(RuntimeError, "not completed"):
            completed_model_text(old, [
                {"id": "msg_new", "type": "assistant", "time": {"created": 2},
                 "content": [{"type": "text", "text": "partial"}]}, *old])

    def test_failed_provider_turn_is_not_treated_as_completed_response(self):
        new = [{"id": "msg_failure", "type": "assistant",
                "error": {"type": "provider.quota",
                          "message": "DO_NOT_ECHO_PRIVATE_ERROR"},
                "time": {"created": 2, "completed": 3},
                "content": [{"type": "text", "text": "I tried"}]}]
        with self.assertRaisesRegex(RuntimeError, "provider.quota") as raised:
            completed_model_text([], new)
        self.assertNotIn("DO_NOT_ECHO_PRIVATE_ERROR", str(raised.exception))

    def test_finished_model_turn_requires_new_message_and_preserves_actual_text(self):
        old = [{"id": "msg_old", "type": "assistant", "finish": "stop",
                "time": {"completed": 1}, "content": [{"type": "text", "text": "old"}]}]
        new = {"id": "msg_new", "type": "assistant", "finish": "stop",
               "time": {"created": 2, "completed": 3},
               "content": [{"type": "text", "text": "Actual new answer"}]}
        self.assertEqual(completed_model_text(old, [new, *old]), "Actual new answer")

    def test_native_tool_summary_does_not_trust_model_prose_or_leak_arguments(self):
        messages = [
            {"id": "msg_1", "type": "assistant", "content": [
                {"type": "text", "text": "PRIVATE_PROMPT_TEXT"},
                {"type": "tool", "name": "execute", "state": {"status": "completed",
                  "input": {"command": "PRIVATE_ARGUMENT"}}},
                {"type": "tool", "name": "execute", "state": {"status": "error",
                  "error": "PRIVATE_ERROR"}}]},
        ]
        summary = summarize_native_tools(messages)
        self.assertEqual(summary["total"], 2)
        self.assertEqual(summary["by_tool_status"], [
            {"tool": "execute", "status": "completed", "count": 1},
            {"tool": "execute", "status": "error", "count": 1}])
        self.assertNotIn("PRIVATE_", json.dumps(summary))
        self.assertEqual(summarize_native_tools([{"type": "assistant",
            "content": [{"type": "text", "text": "I used edit and it failed"}]}])["total"], 0)


    def test_source_gate_names_missing_events_and_failed_verification(self):
        oracle = {"failure": None, "retry": "msg_retry", "user": "msg_user",
                  "review": None, "verified": None}
        gate = source_gate(oracle, False)
        self.assertFalse(gate["ready"])
        self.assertEqual(gate["missing_source_events"], ["failure", "review", "verified"])
        self.assertFalse(gate["host_verification_passed"])

    def test_source_gate_accepts_only_complete_verified_originals(self):
        evidence = {"failure": "msg_1", "retry": "msg_2", "user": "msg_3",
                    "review": "msg_4", "verified": "msg_5"}
        self.assertTrue(source_gate(evidence, True)["ready"])
        self.assertFalse(source_gate(evidence, False)["ready"])

    def test_unqualified_source_skips_model_controls_without_pass(self):
        report = {"status": "UNPROVEN", "infrastructure": "UNPROVEN", "agent": "UNPROVEN"}
        gate = source_gate({"failure": None}, False)
        skipped = skip_unqualified_source(report, gate)
        self.assertTrue(skipped)
        self.assertEqual(set(report["controls"]), set(CONTROLS))
        self.assertEqual(set(report["control_verdicts"].values()), {"UNPROVEN"})
        self.assertTrue(all(c["executed"] is False for c in report["controls"].values()))
        self.assertEqual(report["blocked_reason_code"], "source-unqualified")
        report2 = {}
        self.assertFalse(skip_unqualified_source(report2, source_gate({
            "failure": "a", "retry": "b", "user": "c",
            "review": "d", "verified": "e"}, True)))
        self.assertEqual(report2, {})

    def test_public_summary_surfaces_source_blocker_without_private_details(self):
        report = {"status": "UNPROVEN", "infrastructure": "UNPROVEN", "agent": "UNPROVEN",
                  "source_gate": {"ready": False, "missing_source_events": ["retry"],
                                  "host_verification_passed": False},
                  "source_tool_observability": {"worker_native": {"total": 0}},
                  "source_first_attempt": {"patch_error_observed": False,
                                           "source_unchanged_under_gate": True},
                  "blocked_reason_code": "source-unqualified",
                  "raw_private_key": "DO_NOT_PRINT",
                  "controls": {"privacy": {"report_excerpt": "PRIVATE_SOURCE"}}}
        summary = public_summary(report)
        self.assertEqual(summary["blocked_reason_code"], "source-unqualified")
        self.assertEqual(summary["source_gate"]["missing_source_events"], ["retry"])
        self.assertEqual(summary["source_tool_observability"]["worker_native"]["total"], 0)
        self.assertEqual(summary["source_first_attempt"]["patch_error_observed"], False)
        self.assertNotIn("PRIVATE", json.dumps(summary))

    def test_adversarial_fail_cannot_be_downgraded_to_pass(self):
        controls = {k: {"status": "PASS", "executed": True, "observed": True,
                         "model": "real", "native_tool_call_id": "call_" + k}
                    for k in CONTROLS}
        controls["foreign-parent-ancestry"]["status"] = "FAIL"
        graded = grade_controls(controls)
        self.assertEqual(graded["foreign-parent-ancestry"], "FAIL")
        self.assertEqual(verdict({"infrastructure":"PASS", "agent":"PASS"}, graded), "FAIL")

    def test_explicit_unproven_control_cannot_pass_from_its_metadata(self):
        controls = {k: {"status": "PASS", "executed": True, "observed": True,
                         "model": "real", "native_tool_call_id": "call_" + k}
                    for k in CONTROLS}
        controls["read-denied"]["status"] = "UNPROVEN"
        self.assertEqual(grade_controls(controls)["read-denied"], "UNPROVEN")


    def test_unqualified_investigator_skips_optional_controls(self):
        report = {"status":"UNPROVEN", "infrastructure":"PASS", "agent":"UNPROVEN"}
        primary = {"infrastructure":"PASS", "agent":"UNPROVEN",
                   "checks":{"model-discovered-children":"UNPROVEN"}}
        self.assertTrue(skip_unqualified_primary(report, primary))
        self.assertEqual(report["blocked_reason_code"], "investigator-unqualified")
        self.assertEqual(report["control_verdicts"],
                         {name:"UNPROVEN" for name in CONTROLS})
        self.assertTrue(all(not x["executed"] for x in report["controls"].values()))
        self.assertFalse(skip_unqualified_primary({}, {"infrastructure":"PASS", "agent":"PASS"}))



    def test_same_codemode_call_id_reused_sequentially_preserves_trace_ownership(self):
        common = {"sessionID": INVESTIGATOR, "tool": "loom_trace", "callID": "outer-code-call"}
        stream = [
            {"type": "tool-before", "data": {**common,
                "trace": {"operation": "children", "session_id": PARENT}}},
            {"type": "tool-after", "data": {**common, "status": "completed",
                "trace_result": {"parse": "ok", "child_ids": [WORKER, REVIEWER]}}},
            {"type": "tool-before", "data": {**common,
                "trace": {"operation": "timeline", "session_id": WORKER,
                          "export_path": "qa-evidence/worker.json"}}},
            {"type": "tool-after", "data": {**common, "status": "completed",
                "trace_result": {"parse": "ok", "event_ids": [EVENTS["failure"]]}}},
        ]
        pairs = list(paired_trace_events(stream, INVESTIGATOR))
        self.assertEqual(len(pairs), 2)
        self.assertEqual([item[0]["trace"]["operation"] for item in pairs],
                         ["children", "timeline"])
        self.assertEqual([item[1]["trace_result"].get("child_ids") for item in pairs],
                         [[WORKER, REVIEWER], None])

    def test_overlapping_codemode_trace_calls_with_shared_id_fail_closed(self):
        common = {"sessionID": INVESTIGATOR, "tool": "loom_trace", "callID": "outer-code-call"}
        stream = [
            {"type": "tool-before", "data": {**common,
                "trace": {"operation": "children", "session_id": PARENT}}},
            {"type": "tool-before", "data": {**common,
                "trace": {"operation": "timeline", "session_id": WORKER,
                          "export_path": "qa-evidence/worker.json"}}},
            {"type": "tool-after", "data": {**common, "status": "completed",
                "trace_result": {"parse": "ok", "child_ids": [WORKER, REVIEWER]}}},
            {"type": "tool-after", "data": {**common, "status": "completed",
                "trace_result": {"parse": "ok", "event_ids": [EVENTS["failure"]]}}},
        ]
        self.assertEqual(list(paired_trace_events(stream, INVESTIGATOR)), [])
        graded = self.grade(model_audit() + stream, "narrative cannot authorize source reads")
        self.assertEqual(graded["checks"]["model-discovered-children"], "UNPROVEN")
        self.assertEqual(graded["checks"]["model-read-source-events"], "UNPROVEN")

    def test_trace_pairing_does_not_cross_tool_names_or_unpaired_events(self):
        common = {"sessionID": INVESTIGATOR, "callID": "outer-code-call"}
        stream = [
            {"type": "tool-before", "data": {**common, "tool": "loom_trace",
                "trace": {"operation": "children", "session_id": PARENT}}},
            {"type": "tool-after", "data": {**common, "tool": "read", "status": "completed"}},
            {"type": "tool-after", "data": {**common, "tool": "loom_trace",
                "status": "completed", "trace_result": {"child_ids": [WORKER]}}},
            {"type": "tool-after", "data": {**common, "tool": "loom_trace",
                "status": "completed", "trace_result": {"child_ids": [REVIEWER]}}},
        ]
        paired = list(paired_trace_events(stream, INVESTIGATOR))
        self.assertEqual(len(paired), 1)
        self.assertEqual(paired[0][1]["trace_result"]["child_ids"], [WORKER])


    def test_code_mode_nested_tool_statuses_are_projected_without_private_inputs(self):
        messages = [
            {"id": "msg_code", "type": "assistant", "content": [
                {"type": "tool", "name": "execute", "state": {
                    "status": "completed", "metadata": {
                        "toolCalls": [
                            {"tool": "edit", "status": "error",
                             "input": {"path": "/private/sensitive"}},
                            {"tool": "edit", "status": "completed"},
                            {"tool": "shell", "status": "completed"},
                        ], "error": True,
                    },
                    "content": [{"type": "text", "text": "PRIVATE_TOOL_OUTPUT"}],
                }},
            ]},
        ]
        summary = summarize_native_tools(messages)
        self.assertEqual(summary["total"], 1)
        self.assertEqual(summary["code_mode_inner"]["total"], 3)
        self.assertEqual(summary["code_mode_inner"]["error_count"], 1)
        self.assertEqual(summary["code_mode_inner"]["wrapper_error_count"], 1)
        self.assertEqual(summary["code_mode_inner"]["by_tool_status"], [
            {"tool": "edit", "status": "completed", "count": 1},
            {"tool": "edit", "status": "error", "count": 1},
            {"tool": "shell", "status": "completed", "count": 1},
        ])
        self.assertNotIn("PRIVATE", json.dumps(summary))
        self.assertNotIn("/private/", json.dumps(summary))

    def test_missing_code_mode_metadata_is_unknown_not_success(self):
        summary = summarize_native_tools([
            {"type": "assistant", "content": [
                {"type": "tool", "name": "execute",
                 "state": {"status": "completed"}}]}])
        self.assertEqual(summary["code_mode_inner"]["wrappers"], 1)
        self.assertEqual(summary["code_mode_inner"]["metadata_available"], 0)
        self.assertEqual(summary["code_mode_inner"]["status"], "unknown")


    def test_real_patch_error_and_same_tool_patch_retry_qualify_source_attempt(self):
        observations = [
            {"type": "tool-after", "data": {
                "sessionID": WORKER, "tool": "patch", "status": "error",
                "messageID": "msg_patch_failed", "callID": "call_1"}},
            {"type": "tool-after", "data": {
                "sessionID": WORKER, "tool": "patch", "status": "completed",
                "messageID": "msg_patch_retry", "callID": "call_2"}},
        ]
        parent = [{"id": "msg_correction", "type": "user",
                   "text": "QA-B correction: preserve privacy"}]
        reviewer = [{"id": "msg_review", "type": "assistant",
                     "content": [{"type": "text",
                                  "text": "Privacy verification was missing"}]}]
        final = [
            {"type": "tool-before", "data": {"sessionID": WORKER,
                "tool": "shell", "callID": "verify", "verification_command": True}},
            {"type": "tool-after", "data": {"sessionID": WORKER,
                "tool": "shell", "callID": "verify", "status": "completed"}},
        ]
        worker = [{"id": "msg_verified", "type": "assistant",
                   "content": [{"type": "text", "text": "Tests passed"}]}]
        gold = evidence_oracle(observations, PARENT, WORKER, REVIEWER,
                               parent, worker, reviewer, final)
        self.assertEqual(gold["failure"], "msg_patch_failed")
        self.assertEqual(gold["retry"], "msg_patch_retry")
        self.assertEqual(gold["verified"], "msg_verified")

    def test_successful_patch_without_prior_failure_is_not_a_recovery(self):
        success_only = [{"type": "tool-after", "data": {
            "sessionID": WORKER, "tool": "patch", "status": "completed",
            "messageID": "msg_success", "callID": "call_1"}}]
        gold = evidence_oracle(success_only, PARENT, WORKER, REVIEWER, [], [], [], [])
        self.assertIsNone(gold["failure"])
        self.assertIsNone(gold["retry"])


    def test_native_worker_gate_denies_writes_then_restores_session_policy(self):
        session = "ses_worker"
        recorded = []
        current = []
        def fake_api(host, method, path, data=None):
            self.assertEqual(path, "/api/session/" + session)
            if method == "PATCH":
                current[:] = data["permissions"]
                recorded.append((method, [dict(x) for x in current]))
                return {}
            if method == "GET":
                return {"id": session, "permissions": list(current)}
            self.fail("unexpected host operation")
        with patch("retrospective_qab.api", side_effect=fake_api):
            set_worker_write_gate(object(), session, denied=True)
            set_worker_write_gate(object(), session, denied=False)
        self.assertEqual([r["action"] for r in recorded[0][1]],
                         ["edit", "write", "shell"])
        self.assertTrue(all(r["effect"] == "deny" for r in recorded[0][1]))
        self.assertEqual(recorded[1], ("PATCH", []))

    def test_worker_gate_fail_closed_on_invalid_session_readback(self):
        with patch("retrospective_qab.api", side_effect=[{}, {"permissions": []}]):
            with self.assertRaisesRegex(RuntimeError, "permission policy"):
                set_worker_write_gate(object(), WORKER, denied=True)

    def test_real_patch_error_requires_correlated_native_start_and_terminal(self):
        events = [
            {"type": "tool-before", "data": {
                "sessionID": WORKER, "agent": "qa-worker", "tool": "patch",
                "callID": "patch-1", "messageID": "msg_failed"}},
            {"type": "tool-after", "data": {
                "sessionID": WORKER, "agent": "qa-worker", "tool": "patch",
                "callID": "patch-1", "messageID": "msg_failed", "status": "error"}},
        ]
        self.assertEqual(observed_patch_error(events, WORKER), "msg_failed")
        success = [events[0], {**events[1], "data": {**events[1]["data"], "status": "completed"}}]
        self.assertIsNone(observed_patch_error(success, WORKER))
        no_start = events[1:]
        self.assertIsNone(observed_patch_error(no_start, WORKER))
        other_session = [events[0], {**events[1], "data": {**events[1]["data"], "sessionID": "foreign"}}]
        self.assertIsNone(observed_patch_error(other_session, WORKER))
        other_tool = [events[0], {**events[1], "data": {**events[1]["data"], "tool": "shell"}}]
        self.assertIsNone(observed_patch_error(other_tool, WORKER))

    def test_source_oracle_does_not_substitute_completed_patch_for_failure(self):
        events = [
            {"type": "tool-after", "data": {"sessionID": WORKER, "tool": "patch",
                "status": "completed", "messageID": "msg_first"}},
            {"type": "tool-after", "data": {"sessionID": WORKER, "tool": "patch",
                "status": "completed", "messageID": "msg_second"}},
        ]
        gold = evidence_oracle(events, PARENT, WORKER, REVIEWER, [], [], [], [])
        self.assertIsNone(gold["failure"])
        self.assertIsNone(gold["retry"])


    def test_source_oracle_prefers_intended_patch_error_over_unrelated_shell_denial(self):
        observations = [
            {"type": "tool-after", "data": {"sessionID": WORKER, "tool": "shell",
                "status": "error", "messageID": "msg_unrelated_shell"}},
            {"type": "tool-after", "data": {"sessionID": WORKER, "tool": "patch",
                "status": "error", "messageID": "msg_patch_denied"}},
            {"type": "tool-after", "data": {"sessionID": WORKER, "tool": "patch",
                "status": "completed", "messageID": "msg_patch_recovered"}},
            {"type": "tool-after", "data": {"sessionID": WORKER, "tool": "shell",
                "status": "completed", "messageID": "msg_shell_success"}},
        ]
        gold = evidence_oracle(observations, PARENT, WORKER, REVIEWER, [], [], [], [])
        self.assertEqual(gold["failure"], "msg_patch_denied")
        self.assertEqual(gold["retry"], "msg_patch_recovered")


if __name__ == "__main__":
    unittest.main()
