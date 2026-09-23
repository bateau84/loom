#!/usr/bin/env python3
"""Negative controls for delivery-proof checking; no host/model invocation."""
import importlib.util
import json
from pathlib import Path
import unittest

SPEC = importlib.util.spec_from_file_location("profile_probe", Path(__file__).with_name("verify_conversation_profile.py"))
assert SPEC and SPEC.loader
PROBE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(PROBE)


class DeliveryProofTests(unittest.TestCase):
    def body(self, source="complete production body", role="system"):
        return {"model": "mock", "messages": [{"role": role, "content": source},
                {"role": "user", "content": "scenario"}]}

    def check(self, bodies):
        PROBE.verify_capture(bodies, "complete production body", "scenario", ["judge-only criterion"])

    def test_complete_instruction_and_user_input_pass(self):
        self.check([self.body()])

    def test_outer_markdown_whitespace_is_not_instruction_loss(self):
        PROBE.verify_capture([self.body()], "\ncomplete production body\n", "scenario", ["judge-only criterion"])

    def test_internal_body_change_is_still_rejected(self):
        with self.assertRaises(RuntimeError):
            PROBE.verify_capture([self.body()], "complete\nproduction body", "scenario", [])

    def test_partial_body_does_not_pass(self):
        with self.assertRaises(RuntimeError):
            self.check([self.body("production body")])

    def test_policy_in_user_content_does_not_pass(self):
        with self.assertRaises(RuntimeError):
            self.check([self.body(role="user")])

    def test_no_request_does_not_pass(self):
        with self.assertRaises(RuntimeError):
            self.check([])

    def test_grading_leak_does_not_pass(self):
        body = self.body()
        body["messages"].append({"role": "system", "content": "judge-only criterion"})
        with self.assertRaises(RuntimeError):
            self.check([body])

    def test_one_good_request_cannot_hide_a_bad_request(self):
        with self.assertRaises(RuntimeError):
            self.check([self.body(), self.body("partial")])

    def test_wrong_model_does_not_pass(self):
        body = self.body()
        body["model"] = "other"
        with self.assertRaises(RuntimeError):
            self.check([body])

    def test_missing_scenario_does_not_pass(self):
        body = self.body()
        body["messages"].pop()
        with self.assertRaises(RuntimeError):
            self.check([body])

    def test_multipart_instruction_content_passes(self):
        body = self.body()
        body["messages"][0]["content"] = [{"type": "text", "text": "complete production body"}]
        self.check([body])


class CliResponseTests(unittest.TestCase):
    def test_mock_reply_in_assistant_text_event_passes(self):
        PROBE.verify_cli_output(json.dumps({"type": "text", "part": {"text": "delivery-probe-complete"}}))

    def test_plain_or_echoed_marker_cannot_pass(self):
        for output in ("delivery-probe-complete", json.dumps({"prompt": "delivery-probe-complete"})):
            with self.assertRaises(RuntimeError):
                PROBE.verify_cli_output(output)

    def test_wrong_assistant_reply_cannot_pass(self):
        with self.assertRaises(RuntimeError):
            PROBE.verify_cli_output(json.dumps({"type": "text", "part": {"text": "other"}}))


if __name__ == "__main__":
    unittest.main()
