"""Opt-in provider-free composition checks for diagnostic and RSP runner images."""
from __future__ import annotations

import importlib.util
import argparse
import os
from pathlib import Path
import shutil
import json
import tempfile
import unittest
from unittest.mock import patch

SPEC = importlib.util.spec_from_file_location(
    "loom_observer_image_smoke", Path(__file__).with_name("test_eval_observer_image.py")
)
assert SPEC and SPEC.loader
SMOKE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(SMOKE)

IMAGE = "ghcr.io/bateau84/opencode-eval-runner@sha256:9ee84a581db820c24d92e3a672db457498d3e1478a400e87704391a6f24f0250"
RSP_IMAGE = SMOKE.RUN.RUNNER_SAFETY_IMAGE
RUNNER_AVAILABLE = bool(os.environ.get("OPENCODE_EVAL_RUNNER_BIN") or shutil.which("opencode-eval-runner"))


@unittest.skipUnless(shutil.which("podman") and RUNNER_AVAILABLE,
                     "requires podman and an explicitly available runner CLI")
class NormalInvokeImageComposition(unittest.TestCase):
    def test_normal_invoke_events_are_diagnostic_and_do_not_change_result(self):
        original_invoke = SMOKE.RUN.invoke_container

        def invoke_fixture_values(**kwargs):
            kwargs["normal_observation_payload_policy"] = SMOKE.RUN.NORMAL_PAYLOAD_POLICY_FIXTURE
            return original_invoke(**kwargs)

        with patch.object(SMOKE.RUN, "invoke_container", invoke_fixture_values), \
             patch.dict(os.environ, {"OPENCODE_EVAL_NORMAL_OBSERVATIONS": "1"}):
            baseline, _probe, baseline_requests, baseline_errors, _ = SMOKE.ObserverPinnedImageSmoke().invoke_fixture(IMAGE)

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
        self.assertEqual([event["input"]["value"]["marker"] for event in inner_starts],
                         ["discarded-sentinel", "transformed-sentinel", "caught-sentinel"])
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

    def test_disposable_rsp_profile_composes_with_transport_and_action_scoring(self):
        original_invoke = SMOKE.RUN.invoke_container
        original_admit = SMOKE.RUN._admit_runner_safety_result
        runner_result_files = []

        def invoke_disposable(**kwargs):
            kwargs["require_runner_evidence_safety"] = True
            kwargs["runner_defaults_known"] = True
            return original_invoke(**kwargs)

        def observe_runner_result_file(result, *args, **kwargs):
            # Observe the exact decoded bytes Loom read from the runner-owned
            # result file, then preserve the real admission validator.
            runner_result_files.append(result)
            return original_admit(result, *args, **kwargs)

        with patch.object(SMOKE.RUN, "invoke_container", invoke_disposable), \
             patch.object(SMOKE.RUN, "_admit_runner_safety_result", observe_runner_result_file):
            result, _probe, requests, errors, _observer = SMOKE.ObserverPinnedImageSmoke().invoke_fixture(
                RSP_IMAGE, payload_key_probe=True,
            )
        self.assertFalse(result.get("infrastructure_error"), result.get("stderr"))
        self.assertEqual(requests, 4)
        self.assertEqual(errors, [])
        evidence = result.get("observed_tool_results")
        self.assertIsInstance(evidence, dict)
        self.assertEqual(evidence.get("schema"), SMOKE.RUN.RUNNER_SAFE_EVENTS_SCHEMA)
        load = result.get("evidence_load")
        self.assertIsInstance(load, dict)
        self.assertEqual(load.get("image"), RSP_IMAGE)
        self.assertEqual(load.get("image_config"), SMOKE.RUN.RUNNER_SAFETY_IMAGE_CONFIG)
        self.assertEqual(load.get("image_source_revision"), SMOKE.RUN.RUNNER_SAFETY_SOURCE)
        self.assertEqual(load.get("host_source_revision"), SMOKE.RUN.RUNNER_SAFETY_SOURCE)
        self.assertEqual(load.get("image_package_init_sha256"), SMOKE.RUN.RUNNER_PACKAGE_INIT_SHA256)
        self.assertEqual(load.get("host_adapter_sha256"), SMOKE.RUN.RUNNER_HOST_ADAPTER_SHA256)
        ack = result.get("evidence_safety_ack")
        self.assertIsInstance(ack, dict)
        self.assertEqual(ack.get("schema"), SMOKE.RUN.RUNNER_SAFETY_ACK_SCHEMA)
        self.assertEqual(ack.get("image_source_revision"), SMOKE.RUN.RUNNER_SAFETY_SOURCE)
        self.assertGreater(evidence.get("observed_events", 0), 0)
        self.assertTrue(any(event.get("tool") == "evalFixture_native_sentinel" for event in evidence["events"]))
        key_probe = next(event for event in evidence["events"] if event.get("tool") == "evalFixture_payload_echo")
        self.assertNotIn("input", key_probe)
        self.assertEqual(key_probe["evidence_safety"]["input"]["state"], "omitted")
        self.assertEqual(key_probe["evidence_safety"]["input"]["reason"], "unsupported_representation")
        self.assertIn("input", key_probe["missing_fields"])
        escaped_test_secret = 'synthetic-"credential"\npath\\suffix'
        result_json = json.dumps(result, ensure_ascii=False)
        self.assertEqual(len(runner_result_files), 1)
        stored_projection = runner_result_files[0]
        self.assertEqual(stored_projection["tool_result_evidence"]["events"][1]["status"], "completed")
        self.assertNotIn("input", stored_projection["tool_result_evidence"]["events"][1])
        result_json += json.dumps(stored_projection, ensure_ascii=False)
        for secret_variant in SMOKE.RUN.sensitive_text_variants(escaped_test_secret):
            self.assertNotIn(secret_variant, result_json)
        runtime_state = result.get("runtime_state")
        self.assertTrue(SMOKE.RUN._valid_disposable_runtime_state(runtime_state), runtime_state)
        case = {"id": "RSP-NATIVE", "agent": "general", "execution": "runtime", "prompt": "",
                "trap": "", "expectations": [], "must_not": [],
                "actions": {"requires": [{"tool": "evalFixture_native_sentinel",
                                             "args": {"marker": "native-sentinel"}}]}}
        observed = SMOKE.RUN.tool_result_actions(evidence)
        self.assertEqual(SMOKE.RUN.deterministic_failures(case, [], observed, tool_results=evidence), [])
        prompt = SMOKE.RUN.judge_prompt(case, result.get("text", ""), [], observed, evidence)
        self.assertIn("OBSERVED TOOL RESULTS", prompt)
        self.assertIn("evalFixture_native_sentinel", prompt)
        with tempfile.TemporaryDirectory(dir="/tmp/opencode") as artifact_dir:
            args = argparse.Namespace(iterations=1, artifact_dir=artifact_dir, eval_run_id="a" * 32)
            artifact = {
                "case": case["id"], "iteration": 1, "agent": case["agent"],
                "execution": case["execution"], "target_image": RSP_IMAGE,
                "judge_image": RSP_IMAGE, "container_engine": "podman",
                "target_transport": "opencode", "judge_transport": "opencode",
                "model": "fixture/deterministic", "reasoning": None,
                "reasoning_source": "provider-default", "judge_model": "fixture/deterministic",
                "judge_reasoning": None, "judge_reasoning_source": "provider-default",
                "timing": {"target_seconds": 0, "judge_seconds": 0, "total_seconds": 0},
                "classification": "unproven", "passed": False, "target": result,
                "target_error": None, "observed_actions": observed,
                "observed_tool_results": evidence, "deterministic_failures": [],
                "judge_transport_result": None, "semantic": None, "judge_error": None,
            }
            SMOKE.RUN.write_case_artifact(case, args, 1, artifact)
            SMOKE.RUN.verify_case_artifact(case, args, 1, artifact)
            saved = json.loads((Path(artifact_dir) / (case["id"] + ".json")).read_text())
            self.assertEqual(saved["target"]["runtime_state"], runtime_state)
            self.assertEqual(saved["observed_tool_results"], evidence)
        self.assertFalse(SMOKE.RUN.nested_tool_capture_complete(evidence))

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
