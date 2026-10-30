"""Provider-free contract checks for QA-B grading, not a real-model PASS."""
import unittest
import argparse
import json
import subprocess
import sys
import tempfile
from pathlib import Path

from retrospective_qab import evidence_oracle, prepare_project, run as run_real_qab
from retrospective_qab_oracle import CONTROLS, grade_controls, verify_primary, verdict

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


    def test_scripted_provider_is_rejected_before_running_any_installed_host(self):
        with tempfile.TemporaryDirectory() as temp:
            path = Path(temp) / "new-private-result"
            options = argparse.Namespace(report_directory=path, model="question-fixture/reader", timeout=30)
            result = run_real_qab(options)
            self.assertEqual(result["status"], "UNPROVEN")
            self.assertIn("question-fixture forbidden", result["error"])
            self.assertEqual(json.loads((path / "report.json").read_text())["status"], "UNPROVEN")
            self.assertEqual(path.stat().st_mode & 0o777, 0o700)


if __name__ == "__main__":
    unittest.main()
