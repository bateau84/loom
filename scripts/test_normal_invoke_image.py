"""Opt-in provider-free composition checks for diagnostic and RSP runner images."""
from __future__ import annotations

import importlib.util
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

    def test_runner_evidence_safety_candidate_admits_safe_result_and_preserves_inner_non_evidence(self):
        image = SMOKE.RUN.RUNNER_SAFETY_IMAGE
        runner_bin = os.environ.get("OPENCODE_EVAL_RUNNER_BIN") or shutil.which("opencode-eval-runner")
        self.assertTrue(runner_bin, "candidate runner executable must be explicitly available")
        original_invoke = SMOKE.RUN.invoke_container
        secret = SMOKE.FAKE_KEY

        def isolated_invoke(*, safety: bool, **kwargs):
            kwargs["config_root"] = None
            kwargs["require_runner_evidence_safety"] = safety
            kwargs["runner_defaults_known"] = True
            return original_invoke(**kwargs)

        with tempfile.TemporaryDirectory(prefix="loom-rsp-home-") as temp:
            root = Path(temp)
            environment = {
                "HOME": str(root / "home"),
                "XDG_DATA_HOME": str(root / "data"),
                "XDG_CACHE_HOME": str(root / "cache"),
                "OPENCODE_CONFIG_DIR": "",
                "OPENCODE_EVAL_RUNNER_AUTH": "",
                "OPENCODE_EVAL_RUNNER_CONFIG": "",
                "OPENCODE_EVAL_RUNNER_MODELS": "",
                "OPENCODE_EVAL_RUNNER_DB": "",
                "OPENCODE_EVAL_RUNNER_CONFIG_ROOT": "",
                "OPENCODE_EVAL_NORMAL_OBSERVATIONS": "",
                "OPENAI_API_KEY": "",
                "ANTHROPIC_API_KEY": "",
                "OPENROUTER_API_KEY": "",
                "OPENCODE_API_KEY": "",
                "COPILOT_GITHUB_TOKEN": "",
                "GH_TOKEN": "",
                "GITHUB_TOKEN": "",
                "OPENCODE_EVAL_RUNNER_BIN": str(Path(runner_bin).resolve()),
            }
            for directory in ("home", "data", "cache"):
                (root / directory).mkdir()
            with patch.dict(os.environ, environment, clear=False), \
                 patch.object(SMOKE.RUN, "invoke_container", wraps=original_invoke) as invoke:
                # The wrapper below changes only the host adapter's opt-in and
                # the resolved-seed declaration; both runs use the same fixture.
                invoke.side_effect = lambda **kwargs: isolated_invoke(safety=False, **kwargs)
                baseline, _probe, baseline_requests, baseline_errors, _ = SMOKE.ObserverPinnedImageSmoke().invoke_fixture(
                    image, safety_fixture=True,
                )
                self.assertEqual(invoke.call_count, 1)
                invoke.side_effect = lambda **kwargs: isolated_invoke(safety=True, **kwargs)
                safe, _probe, safe_requests, safe_errors, _ = SMOKE.ObserverPinnedImageSmoke().invoke_fixture(
                    image, safety_fixture=True,
                )

        self.assertEqual((baseline_requests, safe_requests), (4, 4))
        self.assertEqual(baseline_errors, [])
        self.assertEqual(safe_errors, [])
        self.assertFalse(baseline.get("infrastructure_error"), baseline.get("stderr"))
        self.assertFalse(safe.get("infrastructure_error"), safe.get("stderr"))
        self.assertEqual(
            (safe.get("exit_code"), safe.get("text"), safe.get("tools")),
            (baseline.get("exit_code"), baseline.get("text"), baseline.get("tools")),
        )
        self.assertEqual(safe["evidence_load"]["image"], image)
        self.assertEqual(safe["evidence_load"]["image_source_revision"], SMOKE.RUN.RUNNER_SAFETY_SOURCE)
        self.assertEqual(safe["evidence_load"]["host_source_revision"], SMOKE.RUN.RUNNER_SAFETY_SOURCE)
        self.assertTrue(safe["evidence_safety_validation"]["acknowledged"])
        self.assertTrue(safe["evidence_safety_ack"]["policy_valid"])
        self.assertTrue(safe["evidence_safety_ack"]["inventory_complete"])
        self.assertNotIn(secret, json.dumps(safe))
        self.assertNotIn("stdout", safe)
        self.assertFalse(safe["evidence_safety"]["coverage_complete"])
        evidence = safe["observed_tool_results"]
        native = next(event for event in evidence["events"] if event.get("tool") == "evalFixture_native_sentinel")
        public_native = next(
            event for event in evidence["events"]
            if event.get("tool") == "evalFixture_native_sentinel" and
            event.get("evidence_safety", {}).get("input", {}).get("state") == "exact"
        )
        self.assertEqual(native["evidence_safety"]["input"]["state"], "redacted")
        self.assertEqual(native["evidence_safety"]["output"]["state"], "omitted")
        self.assertIn("input", native["truncated_fields"])
        self.assertIn("output", native["truncated_fields"])
        self.assertFalse(SMOKE.RUN.nested_tool_capture_complete(evidence))
        self.assertFalse(any(event.get("tool") == "evalFixture_inner_sentinel" for event in evidence["events"]))
        self.assertIn("public-native-sentinel", json.dumps(public_native["output"]))
        public_action = {
            "tool": "evalFixture_native_sentinel", "args": {"marker": "public-native-sentinel"},
        }
        self.assertIn(public_action, SMOKE.RUN.tool_result_actions(evidence))

        base_case = {
            "id": "RSP-COMPOSITION-01", "agent": "general", "execution": "runtime",
            "prompt": "synthetic fixture", "trap": "", "expectations": [], "must_not": [],
        }
        positive_case = {
            **base_case,
            "actions": {"requires": [public_action]},
        }
        positive_failures = SMOKE.RUN.deterministic_failures(
            positive_case, safe.get("tools", []), [], tool_results=evidence,
        )
        self.assertFalse(any(message.startswith("required action not observed:") for message in positive_failures))

        absence_case = {
            **base_case,
            "actions": {"forbids": [{"tool": "browser_preview", "args": {"path": "private.png"}}]},
        }
        absence_failures = SMOKE.RUN.deterministic_failures(
            absence_case, safe.get("tools", []), [], tool_results=evidence,
        )
        self.assertTrue(any(message.startswith("non-evidence:") for message in absence_failures))

        result_case = {
            **base_case,
            "tool_results": {"requires": [{
                "tool": "evalFixture_native_sentinel",
                "args": {"marker": "public-native-sentinel"},
                "output_contains": "public-native-sentinel",
            }]},
        }
        result_failures = SMOKE.RUN.deterministic_failures(
            result_case, safe.get("tools", []), [], tool_results=evidence,
        )
        self.assertTrue(any(message.startswith("non-evidence:") for message in result_failures))

        prompt = SMOKE.RUN.judge_prompt(
            base_case, safe["text"], safe.get("tools", []), [], evidence,
        )
        self.assertIn('"coverage_complete": false', prompt)
        self.assertNotIn(secret, prompt)
        with tempfile.TemporaryDirectory(prefix="loom-rsp-artifact-") as artifact_temp:
            args = type("ArtifactArgs", (), {"iterations": 1, "artifact_dir": artifact_temp,
                                              "eval_run_id": "a" * 32})()
            artifact = {
                "case": base_case["id"], "classification": "non-evidence", "passed": False,
                "target": safe, "observed_tool_results": evidence,
                "deterministic_failures": result_failures,
            }
            SMOKE.RUN.write_case_artifact(base_case, args, 1, artifact)
            SMOKE.RUN.verify_case_artifact(base_case, args, 1, artifact)
            replayed = json.loads((Path(artifact_temp) / f"{base_case['id']}.json").read_text())
            self.assertEqual(replayed["observed_tool_results"]["evidence_safety"],
                             evidence["evidence_safety"])
            self.assertNotIn(secret, json.dumps(replayed))


if __name__ == "__main__":
    unittest.main()
