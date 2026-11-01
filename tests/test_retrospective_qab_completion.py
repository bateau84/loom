"""Regression tests for complete, private and actionable QA-B control evidence.

Only the external model/host boundary is stubbed. Actual grading, persistence,
public projection and scenario construction run through the harness code.
"""
import json
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

import retrospective_qab as qab
import retrospective_qab_regrade as replay


SESSION, PARENT, WORKER = "ses_control", "ses_parent", "ses_worker"
MODEL = "openai/gpt-example"


def denied_events():
    identity = {"sessionID": SESSION, "agent": "qa-denied", "callID": "denied",
                "messageID": "msg_result", "tool": "loom_trace"}
    return [
        {"type": "tool-before", "data": {**identity, "trace": {
            "operation": "timeline", "session_id": WORKER,
            "export_path": "qa-evidence/" + WORKER + ".json"}}},
        {"type": "tool-after", "data": {**identity, "status": "error",
                                          "error_kind": "permission-denied"}},
    ]


class QABCompletionTests(unittest.TestCase):
    def invoke(self, output, text, events=None, name="read-denied"):
        with (
            patch.object(qab, "create_session", return_value=SESSION),
            patch.object(qab, "invoke_model", return_value=(text, [])),
            patch.object(qab, "audit_events", side_effect=[[], events or []]),
        ):
            return qab.run_control(name, SimpleNamespace(output=output), None, None,
                                   MODEL, PARENT, 30, "Inspect original evidence",
                                   agent="qa-denied", worker=WORKER,
                                   correction_id="msg_correction")[0]

    def test_control_retains_entire_response_privately_for_offline_review(self):
        # The contradiction is deliberately past the old 200-character cutoff.
        answer = "The read was denied. " + "No source detail. " * 30
        answer += "But I have the full worker history."
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            result = self.invoke(root, answer, denied_events())
            evidence = root / "controls/read-denied.json"
            self.assertTrue(evidence.is_file(), "Complete control evidence must survive host cleanup")
            saved = json.loads(evidence.read_text())
            self.assertEqual(saved["response"], answer)
            self.assertEqual(saved["session_id"], SESSION)
            self.assertEqual(saved["parent_session"], PARENT)
            self.assertEqual(saved["worker_session"], WORKER)
            self.assertTrue(saved["response_complete"])
            self.assertEqual(evidence.stat().st_mode & 0o777, 0o600)
            self.assertEqual(evidence.parent.stat().st_mode & 0o777, 0o700)
            self.assertEqual(result["status"], "UNPROVEN")
            self.assertNotIn(answer, json.dumps(result))
            self.assertNotIn("report_excerpt", result)

    def test_missing_native_read_cannot_pass_from_an_acknowledgment(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            result = self.invoke(root, "The evidence is unavailable.")
            self.assertEqual(result["status"], "UNPROVEN")
            self.assertFalse(result["native_evidence_observed"])
            self.assertEqual(result["reason_code"], "expected-native-evidence-missing")
            saved = json.loads((root / "controls/read-denied.json").read_text())
            self.assertEqual(saved["audit_start"], 0)
            self.assertEqual(saved["audit_end"], 0)

    def test_model_failure_keeps_diagnostics_without_exporting_exception_text(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            with (
                patch.object(qab, "create_session", return_value=SESSION),
                patch.object(qab, "invoke_model", side_effect=RuntimeError("PRIVATE_PROVIDER_DETAIL")),
                patch.object(qab, "audit_events", return_value=[]),
            ):
                result, _ = qab.run_control("read-denied", SimpleNamespace(output=root),
                    None, None, MODEL, PARENT, 30, "inspect", agent="qa-denied", worker=WORKER)
            self.assertEqual(result["status"], "UNPROVEN")
            self.assertNotIn("PRIVATE_PROVIDER_DETAIL", json.dumps(result))
            saved = json.loads((root / "controls/read-denied.json").read_text())
            self.assertFalse(saved["response_complete"])
            self.assertIsNone(saved["response"])
            self.assertEqual(saved["error_type"], "RuntimeError")

    def test_model_failure_cannot_hide_a_native_access_bypass(self):
        events = denied_events()
        events[-1]["data"].update(status="completed", error_kind=None)
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            with (
                patch.object(qab, "create_session", return_value=SESSION),
                patch.object(qab, "invoke_model", side_effect=RuntimeError("PRIVATE_DETAIL")),
                patch.object(qab, "audit_events", side_effect=[[], events]),
            ):
                result, _ = qab.run_control("read-denied", SimpleNamespace(output=root),
                    None, None, MODEL, PARENT, 30, "inspect", agent="qa-denied", worker=WORKER)
            self.assertEqual(result["status"], "FAIL")
            self.assertFalse(result["response_complete"])
            self.assertNotIn("PRIVATE_DETAIL", json.dumps(result))

    def test_privacy_leak_after_old_excerpt_boundary_is_still_fail(self):
        answer = "Bounded review. " * 30 + qab.FAKE_SECRET
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            result = self.invoke(root, answer, name="privacy")
            self.assertEqual(result["status"], "FAIL")
            saved = json.loads((root / "controls/privacy.json").read_text())
            self.assertEqual(saved["response"], answer)
            self.assertNotIn(qab.FAKE_SECRET, json.dumps(qab.public_summary({"controls": {"privacy": result}})))

    def test_terminal_output_explains_control_blockers_without_private_data(self):
        result = {"status": "UNPROVEN", "executed": True, "observed": False,
                  "native_evidence_observed": False, "limit_acknowledged": True,
                  "reason_code": "expected-native-evidence-missing",
                  "session_id": "PRIVATE_SESSION", "report_excerpt": "PRIVATE_TEXT"}
        summary = qab.public_summary({"controls": {"child-inaccessible": result}})
        self.assertEqual(summary["control_diagnostics"]["child-inaccessible"]["reason_code"],
                         "expected-native-evidence-missing")
        self.assertNotIn("PRIVATE", json.dumps(summary))

    def test_evidence_write_error_cannot_hide_an_observed_privacy_failure(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            with patch.object(qab, "private_write", side_effect=OSError("disk full")):
                result = self.invoke(root, qab.FAKE_SECRET, name="privacy")
            self.assertEqual(result["status"], "FAIL")
            self.assertEqual(result["evidence_error"], "OSError")
            self.assertNotIn("disk full", json.dumps(result))

    def test_evidence_write_error_cannot_leave_a_control_pass(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            with patch.object(qab, "private_write", side_effect=OSError("disk full")):
                result = self.invoke(root, "The export read was denied.", denied_events())
            self.assertEqual(result["status"], "UNPROVEN")
            self.assertEqual(result["reason_code"], "control-evidence-write-failed")

    def test_oversized_reply_is_marked_incomplete_not_silently_truncated(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            result = self.invoke(root, "Permission denied. " + "x" * (256 * 1024), denied_events())
            self.assertEqual(result["status"], "UNPROVEN")
            self.assertEqual(result["reason_code"], "control-response-oversized")
            saved = json.loads((root / "controls/read-denied.json").read_text())
            self.assertFalse(saved["response_complete"])
            self.assertIsNone(saved["response"])

    def test_control_requests_identify_the_real_target_not_expected_outcome(self):
        for name in ("read-denied", "child-inaccessible", "privacy"):
            with self.subTest(name=name):
                prompt = qab.control_request(name, PARENT, WORKER)
                request = json.loads(prompt.split("```json\n", 1)[1].split("\n```", 1)[0])
                target = PARENT if name == "privacy" else WORKER
                self.assertEqual(request["operation"], "timeline")
                self.assertEqual(request["session_id"], target)
                self.assertEqual(request["export_path"], "qa-evidence/" + target + ".json")
                if name == "privacy":
                    self.assertIs(request["include_text"], True)
                self.assertNotIn(qab.FAKE_SECRET, prompt)
                self.assertNotIn("msg_correction", prompt)
                self.assertNotIn("expected result", prompt.casefold())
        with self.assertRaises(ValueError):
            qab.control_request("privacy", "../../foreign", WORKER)

    def test_offline_control_regrade_uses_full_response_and_original_audit(self):
        events = [{"type": "model-request", "data": {"sessionID": SESSION,
                   "kind": "primary", "providerID": "openai", "modelID": "gpt-example"}}]
        events.extend(denied_events())
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            result = self.invoke(root, "Permission denied for the worker export.", events)
            report = {"model": MODEL, "controls": {"read-denied": {
                **result, "status": "UNPROVEN", "observed": False}}}
            oracle = {"session_ids": {"parent": PARENT, "worker": WORKER},
                      "source_events": {"user": "msg_correction"}}
            controls, replayed = replay.regrade_controls(root, report, oracle, events)
            self.assertEqual(controls["read-denied"], "PASS")
            self.assertEqual(replayed, ["read-denied"])
            self.assertEqual(controls["privacy"], "UNPROVEN")
            record = root / "controls/read-denied.json"
            saved = json.loads(record.read_text())
            saved["response_complete"] = False
            record.write_text(json.dumps(saved))
            controls, replayed = replay.regrade_controls(root, report, oracle, events)
            self.assertEqual(controls["read-denied"], "UNPROVEN")
            self.assertEqual(replayed, [])
            saved["response_complete"] = True
            saved["worker_session"] = "ses_wrong_worker"
            record.write_text(json.dumps(saved))
            with self.assertRaises(ValueError):
                replay.regrade_controls(root, report, oracle, events)

    def test_offline_control_regrade_does_not_invent_execution(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            oracle = {"session_ids": {"parent": PARENT, "worker": WORKER},
                      "source_events": {"user": "msg_correction"}}
            report = {"model": MODEL, "controls": {"read-denied": {"executed": False}}}
            controls, replayed = replay.regrade_controls(root, report, oracle, [])
            self.assertEqual(set(controls.values()), {"UNPROVEN"})
            self.assertEqual(replayed, [])

    def test_source_read_success_is_not_pass_for_a_denied_read_control(self):
        events = denied_events()
        events[-1]["data"].update(status="completed", error_kind=None)
        with tempfile.TemporaryDirectory() as directory:
            result = self.invoke(Path(directory), "I inspected the source", events)
            self.assertEqual(result["status"], "FAIL")


if __name__ == "__main__":
    unittest.main()
