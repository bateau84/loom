"""Opt-in provider-free composition checks for diagnostic and RSP runner images."""
from __future__ import annotations

import importlib.util
import os
from pathlib import Path
import shutil
import json
import unittest
from unittest.mock import patch

SPEC = importlib.util.spec_from_file_location(
    "loom_observer_image_smoke", Path(__file__).with_name("test_eval_observer_image.py")
)
assert SPEC and SPEC.loader
SMOKE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(SMOKE)

IMAGE = "ghcr.io/bateau84/opencode-eval-runner@sha256:9ee84a581db820c24d92e3a672db457498d3e1478a400e87704391a6f24f0250"
RUNNER_AVAILABLE = bool(os.environ.get("OPENCODE_EVAL_RUNNER_BIN") or shutil.which("opencode-eval-runner"))


@unittest.skipUnless(shutil.which("podman") and RUNNER_AVAILABLE,
                     "requires podman and an explicitly available runner CLI")
class NormalInvokeImageComposition(unittest.TestCase):
    def test_normal_invoke_events_are_diagnostic_and_do_not_change_result(self):
        baseline, _probe, baseline_requests, baseline_errors, _ = SMOKE.ObserverPinnedImageSmoke().invoke_fixture(IMAGE)
        original_invoke = SMOKE.RUN.invoke_container

        def invoke_fixture_values(**kwargs):
            kwargs["normal_observation_payload_policy"] = SMOKE.RUN.NORMAL_PAYLOAD_POLICY_FIXTURE
            return original_invoke(**kwargs)

        with patch.object(SMOKE.RUN, "invoke_container", invoke_fixture_values), \
             patch.dict(os.environ, {"OPENCODE_EVAL_NORMAL_OBSERVATIONS": "1"}):
            result, _probe, requests, errors, _legacy_observer = SMOKE.ObserverPinnedImageSmoke().invoke_fixture(IMAGE)

        self.assertFalse(result.get("infrastructure_error"), result.get("stderr"))
        self.assertFalse(baseline.get("infrastructure_error"), baseline.get("stderr"))
        self.assertEqual(baseline_requests, 3)
        self.assertEqual(baseline_errors, [])
        self.assertEqual(requests, 3)
        self.assertEqual(errors, [])
        self.assertEqual(result.get("exit_code"), baseline.get("exit_code"))
        self.assertEqual(result.get("text"), baseline.get("text"))
        self.assertEqual(result.get("tools"), baseline.get("tools"))
        diagnostic = result.get("normal_invoke_diagnostic")
        self.assertIsInstance(diagnostic, dict)
        self.assertTrue(diagnostic.get("capture_valid"), diagnostic)
        self.assertTrue(diagnostic.get("diagnostic_only"))
        self.assertIs(diagnostic.get("evidence_eligible"), False)
        self.assertEqual(diagnostic.get("payload_policy"), "synthetic-secret-free-fixture/v1")
        events = diagnostic["events"]
        native = [item["event"] for item in events if item["schema"] == "opencode-native-observation/v2"]
        local = [item["event"] for item in events if item["schema"] == "opencode-local-observation/v1"]
        self.assertTrue(any(event.get("tool") == "evalFixture_native_sentinel" for event in native))
        self.assertTrue(any(event.get("kind") == "parent_start" for event in local))
        self.assertTrue(any(event.get("outcome") == "returned" for event in local))
        self.assertTrue(any(event.get("outcome") == "threw" for event in local))
        native_start = next(event for event in native if event.get("kind") == "call_start" and event.get("tool") == "evalFixture_native_sentinel")
        native_end = next(event for event in native if event.get("kind") == "call_end" and event.get("invocation_id") == native_start["invocation_id"])
        self.assertEqual(native_start["input"]["value"], {"marker": "native-sentinel"})
        self.assertIn("native-sentinel", json.dumps(native_end["result"]["value"]))
        inner_starts = [event for event in local if event.get("kind") == "call_start"]
        inner_terminals = {event["invocation_id"]: event for event in local if event.get("kind") == "call_end"}
        observed_inputs = [event["input"]["value"]["marker"] for event in inner_starts]
        self.assertEqual(observed_inputs, ["discarded-sentinel", "transformed-sentinel", "caught-sentinel"])
        self.assertEqual([inner_terminals[event["invocation_id"]]["outcome"] for event in inner_starts],
                         ["returned", "returned", "threw"])
        self.assertIn("FINAL-discarded-sentinel", json.dumps(inner_terminals[inner_starts[0]["invocation_id"]]["result"]["value"]))
        self.assertIn("FINAL-transformed-sentinel", json.dumps(inner_terminals[inner_starts[1]["invocation_id"]]["result"]["value"]))
        self.assertIn("caught-sentinel", json.dumps(inner_terminals[inner_starts[2]["invocation_id"]]["error"]["value"]))
        sequences = [item["event"]["sequence"] for item in events]
        self.assertEqual(sequences, sorted(set(sequences)))
        self.assertTrue(all(event["actor"]["agent"] == "general" for event in native + local))
        self.assertFalse(SMOKE.RUN.nested_tool_capture_complete(diagnostic))
        self.assertEqual(SMOKE.RUN.tool_result_actions(diagnostic), [])
        self.assertFalse(diagnostic["runwide_complete"])

    def test_sensitive_event_values_are_omitted_before_diagnostic_persistence(self):
        secret = SMOKE.FAKE_KEY
        original_response = SMOKE.tool_response

        def response_with_secret(call_id, name, arguments):
            if name == "execute":
                args = dict(arguments)
                code = args["code"]
                marker = 'return {discarded: Boolean(discarded), transformed: "script-transformed", caught};'
                args["code"] = code.replace(marker,
                    f'await tools.evalFixture.inner_sentinel({{marker:{json.dumps(secret)}}});\n' + marker)
                return original_response(call_id, name, args)
            return original_response(call_id, name, arguments)

        captured = []
        original_invoke = SMOKE.RUN.invoke_container

        def invoke_and_capture(**kwargs):
            kwargs["normal_observation_payload_policy"] = SMOKE.RUN.NORMAL_PAYLOAD_POLICY_FIXTURE
            result = original_invoke(**kwargs)
            path = kwargs["project"] / SMOKE.RUN.NORMAL_INVOKE_OBSERVER_FILENAME
            legacy_path = kwargs["project"] / SMOKE.RUN.OBSERVER_FILENAME
            captured.append((path.read_bytes() if path.is_file() else b"", legacy_path.exists()))
            return result

        with patch.object(SMOKE, "tool_response", response_with_secret), \
             patch.object(SMOKE.RUN, "invoke_container", invoke_and_capture), \
             patch.dict(os.environ, {"OPENCODE_EVAL_NORMAL_OBSERVATIONS": "1"}):
            result, _probe, requests, errors, _observer = SMOKE.ObserverPinnedImageSmoke().invoke_fixture(IMAGE)

        self.assertFalse(result.get("infrastructure_error"), result.get("stderr"))
        self.assertEqual(requests, 3)
        self.assertEqual(errors, [])
        self.assertEqual(result.get("text"), "fixture complete")
        self.assertEqual(len(captured), 1)
        raw, legacy_raw_writer_enabled = captured[0]
        self.assertFalse(legacy_raw_writer_enabled)
        self.assertNotIn(secret.encode(), raw)
        raw_records = [json.loads(line) for line in raw.decode("utf-8").splitlines()]
        self.assertTrue(any(record.get("event_omitted") is True and
                            record.get("omission_reason") == "sensitive_value"
                            for record in raw_records))
        diagnostic = result["normal_invoke_diagnostic"]
        self.assertFalse(diagnostic["capture_valid"])
        self.assertGreater(diagnostic["omitted_events"], 0)
        self.assertFalse(diagnostic["evidence_eligible"])
        self.assertEqual(diagnostic["payload_policy"], "synthetic-secret-free-fixture/v1")

if __name__ == "__main__":
    unittest.main()
