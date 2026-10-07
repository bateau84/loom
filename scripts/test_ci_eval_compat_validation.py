from __future__ import annotations

import importlib.util
import json
import os
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

SCRIPT = Path(__file__).with_name("run-evals.py")


def load_wrapper():
    spec = importlib.util.spec_from_file_location("loom_eval_compat", SCRIPT)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


class CompatValidationTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.w = load_wrapper()

    def test_common_cli_flags_forward_to_generic_runner(self):
        w = self.w
        with tempfile.TemporaryDirectory() as temp:
            runner = Path(temp) / "opencode-eval-runner"
            runner.write_text("#!/bin/sh\n", encoding="utf-8")
            args = w.parser().parse_args([
                "--cases", "ROLE-1,RUNTIME-1", "--model", "target/model",
                "--judge-model", "judge/model", "--reasoning", "medium",
                "--judge-reasoning", "high", "--engine", "docker", "--network", "host",
                "--iterations", "2", "--parallel", "4", "--runtime-parallel", "2",
                "--transport-retries", "1", "--env", "CUSTOM_TOKEN",
                "--image", "example.invalid/eval@sha256:1234",
            ])
            with mock.patch.dict(os.environ, {"OPENCODE_EVAL_RUNNER_BIN": str(runner)}, clear=False):
                command = w.generic_command(args, ["ROLE-1", "RUNTIME-1"], Path(temp) / "artifacts")
                env = w._generic_env(args)
        self.assertEqual(command[1:4], ["eval", "--profile", "loom_eval_profile:PROFILE"])
        self.assertEqual(command[command.index("--cases") + 1], "ROLE-1,RUNTIME-1")
        self.assertEqual(command[command.index("--target-model") + 1], "target/model")
        self.assertEqual(command[command.index("--runtime-parallel") + 1], "2")
        self.assertEqual(command[command.index("--parallel") + 1], "4")
        self.assertEqual(json.loads(env[w.FORWARDED_ENV_NAMES]), ["CUSTOM_TOKEN"])
        self.assertEqual(env["OPENCODE_EVAL_RUNNER_OPENCODE_IMAGE"], "example.invalid/eval@sha256:1234")
        self.assertEqual(env["OPENCODE_EVAL_RUNNER_COPILOT_IMAGE"], "example.invalid/eval@sha256:1234")

    def test_normal_live_execution_never_calls_legacy_scheduler(self):
        w = self.w
        normal = {"id": "ROLE-1", "agent": "general", "execution": "role-decision", "requirements": []}
        with tempfile.TemporaryDirectory() as temp:
            runner = Path(temp) / "opencode-eval-runner"
            runner.write_text("#!/bin/sh\n", encoding="utf-8")
            with (
                mock.patch.object(w, "resolve_selection", return_value=[normal]),
                mock.patch.object(w, "_run", return_value=0) as run,
                mock.patch.dict(os.environ, {"OPENCODE_EVAL_RUNNER_BIN": str(runner)}, clear=False),
            ):
                status = w.main(["--cases", "ROLE-1", "--model", "fixture/model", "--artifact-dir", temp])
        self.assertEqual(status, 0)
        self.assertEqual(run.call_count, 1)
        command = run.call_args.args[0]
        self.assertEqual(command[1], "eval")
        self.assertNotIn(str(w.LEGACY_RUNNER), command)

    def test_mixed_selection_separates_skill_ablation(self):
        w = self.w
        normal = {"id": "RUNTIME-1", "agent": "worker", "execution": "runtime", "requirements": []}
        skill = {
            "id": "SKILL-demo-S1", "agent": "general", "execution": "runtime",
            "requirements": [], "_skill_owned": True, "_skill_name": "demo",
        }
        with tempfile.TemporaryDirectory() as temp:
            runner = Path(temp) / "opencode-eval-runner"
            runner.write_text("#!/bin/sh\n", encoding="utf-8")
            with (
                mock.patch.object(w, "resolve_selection", return_value=[normal, skill]),
                mock.patch.object(w, "_run", side_effect=[0, 0]) as run,
                mock.patch.dict(os.environ, {"OPENCODE_EVAL_RUNNER_BIN": str(runner)}, clear=False),
            ):
                status = w.main(["--all", "--model", "fixture/model", "--artifact-dir", temp])
        self.assertEqual(status, 0)
        self.assertEqual(run.call_count, 2)
        generic = run.call_args_list[0].args[0]
        paired = run.call_args_list[1].args[0]
        self.assertEqual(generic[generic.index("--cases") + 1], "RUNTIME-1")
        self.assertIn(str(Path(temp) / "normal"), generic)
        self.assertIn(str(w.PAIRED_RUNNER), paired)
        self.assertNotIn(str(w.LEGACY_RUNNER), paired)
        self.assertEqual(paired[paired.index("--cases") + 1], "SKILL-demo-S1")
        self.assertIn(str(Path(temp) / "skill-ablation"), paired)
        self.assertIsNotNone(run.call_args_list[1].kwargs.get("env"))

    def test_skill_only_uses_paired_without_normal_or_legacy_path(self):
        w = self.w
        skill = {
            "id": "SKILL-demo-S1", "agent": "skill-eval", "execution": "runtime",
            "skill": "demo", "requirements": [], "_skill_owned": True,
        }
        with tempfile.TemporaryDirectory() as temp:
            runner = Path(temp) / "opencode-eval-runner"
            runner.write_text("#!/bin/sh\n", encoding="utf-8")
            with (
                mock.patch.object(w, "resolve_selection", return_value=[skill]),
                mock.patch.object(w, "_run", return_value=0) as run,
                mock.patch.dict(os.environ, {"OPENCODE_EVAL_RUNNER_BIN": str(runner)}, clear=False),
            ):
                status = w.main(["--cases", skill["id"], "--model", "fixture/model", "--artifact-dir", temp])
        self.assertEqual(status, 0)
        self.assertEqual(run.call_count, 1)
        command = run.call_args.args[0]
        self.assertEqual(command[1], str(w.PAIRED_RUNNER))
        self.assertNotIn(str(w.LEGACY_RUNNER), command)
        self.assertIn("--transport-retries", command)

    def test_retired_legacy_engine_cannot_be_invoked_directly(self):
        # The legacy module is still imported for Loom policy helpers, but it
        # must not remain a second executable scheduler or container runner.
        import subprocess

        result = subprocess.run(
            [sys.executable, str(SCRIPT.with_name("run-evals-legacy.py")), "--list"],
            capture_output=True, text=True, check=False,
        )
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("not an executable eval engine", result.stderr)
        self.assertNotIn("Traceback", result.stderr)

    def test_listing_remains_provider_free_and_does_not_invoke_legacy_cli(self):
        w = self.w
        normal = {
            "id": "ROLE-1", "agent": "reviewer", "execution": "role-decision",
            "requirements": ["native-skill"],
        }
        skill = {
            "id": "SKILL-demo-S1", "skill": "demo", "execution": "runtime",
            "requirements": [],
        }
        legacy = mock.Mock()
        legacy.load_cases.return_value = [normal]
        legacy.load_skill_owned_cases.return_value = [skill]
        legacy.case_target_kind.side_effect = lambda case: "skill" if case.get("skill") else "agent"
        legacy.case_target_name.side_effect = lambda case: case.get("skill") or case["agent"]
        with (
            mock.patch.object(w, "_legacy", return_value=legacy),
            mock.patch.object(w, "_run") as run,
            mock.patch("builtins.print") as output,
        ):
            self.assertEqual(w.main(["--list"]), 0)
        run.assert_not_called()
        self.assertEqual(output.call_count, 2)
        self.assertEqual(output.call_args_list[0].args[0], "ROLE-1\tagent\treviewer\trole-decision\tnative-skill")
        self.assertEqual(output.call_args_list[1].args[0], "SKILL-demo-S1\tskill\tdemo\truntime\t")
        self.assertEqual(legacy.load_cases.call_args.kwargs["include_opt_in"], False)

    def test_listing_rejects_duplicate_ids_without_engine_or_inference(self):
        w = self.w
        case = {"id": "duplicate", "execution": "role-decision", "requirements": []}
        legacy = mock.Mock()
        legacy.load_cases.return_value = [case]
        legacy.load_skill_owned_cases.return_value = [case]
        with mock.patch.object(w, "_legacy", return_value=legacy), mock.patch.object(w, "_run") as run:
            with self.assertRaisesRegex(w.CompatibilityError, "duplicate behavioral eval"):
                w.list_cases(w.parser().parse_args(["--list"]))
        run.assert_not_called()


if __name__ == "__main__":
    unittest.main()
