"""Provider-free Stage-2B smoke of the public Loom eval:live compatibility path.

A recording CLI stands in for the generic engine. These tests prove routing and
flag forwarding, NOT execution, evidence capture, or semantic PASS of live cases.
The generic engine and Loom profile have separate provider-free acceptance tests.
"""
from __future__ import annotations

import json
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
ENTRYPOINT = ROOT / "scripts" / "run-evals.py"


class EvalCutoverCliSmokeTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        folder = Path(self.temp.name)
        self.capture = folder / "forwarded.json"
        self.engine = folder / "opencode-eval-runner"
        self.engine.write_text(
            "#!/usr/bin/env python3\n"
            "import json, os, sys\n"
            "from pathlib import Path\n"
            "Path(os.environ['LOOM_EVAL_COMMAND_CAPTURE']).write_text("
            "json.dumps(sys.argv[1:]), encoding='utf-8')\n",
            encoding="utf-8",
        )
        self.engine.chmod(0o700)
        self.artifacts = folder / "artifacts"

    def invoke(self, *args: str) -> subprocess.CompletedProcess[str]:
        env = dict(os.environ)
        env["OPENCODE_EVAL_RUNNER_BIN"] = str(self.engine)
        env["LOOM_EVAL_COMMAND_CAPTURE"] = str(self.capture)
        return subprocess.run(
            [sys.executable, str(ENTRYPOINT), *args],
            cwd=ROOT,
            env=env,
            capture_output=True,
            text=True,
            timeout=45,
            check=False,
        )

    def forwarded(self) -> list[str]:
        self.assertTrue(self.capture.exists(), "generic runner was not invoked")
        value = json.loads(self.capture.read_text(encoding="utf-8"))
        self.assertIsInstance(value, list)
        return value

    @staticmethod
    def flag(args: list[str], name: str) -> str:
        return args[args.index(name) + 1]

    def test_role_conversation_runtime_multi_iteration_and_default_runtime_lane(self) -> None:
        # Actual corpus cases cover all three normal execution modes.
        result = self.invoke(
            "--cases", "INTENT-02,HUMAN-01,INTENT-01",
            "--model", "fixture/model",
            "--judge-model", "fixture/judge",
            "--iterations", "3", "--parallel", "4", "--network", "host",
            "--transport-retries", "0",
            "--artifact-dir", str(self.artifacts),
        )
        self.assertEqual(result.returncode, 0, result.stderr)
        command = self.forwarded()
        self.assertEqual(command[:3], ["eval", "--profile", "loom_eval_profile:PROFILE"])
        self.assertEqual(
            set(self.flag(command, "--cases").split(",")),
            {"INTENT-02", "HUMAN-01", "INTENT-01"},
        )
        self.assertEqual(self.flag(command, "--target-model"), "fixture/model")
        self.assertEqual(self.flag(command, "--judge-model"), "fixture/judge")
        self.assertEqual(self.flag(command, "--iterations"), "3")
        self.assertEqual(self.flag(command, "--parallel"), "4")
        self.assertEqual(self.flag(command, "--runtime-parallel"), "1")
        self.assertEqual(self.flag(command, "--network"), "host")
        self.assertEqual(self.flag(command, "--transport-retries"), "0")
        self.assertNotIn("run-evals-legacy.py", " ".join(command))

    def test_runtime_parallelism_requires_explicit_opt_in(self) -> None:
        result = self.invoke(
            "--cases", "INTENT-01", "--model", "fixture/model",
            "--iterations", "3", "--parallel", "4", "--runtime-parallel", "2",
        )
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(self.flag(self.forwarded(), "--runtime-parallel"), "2")

    def test_case_listing_requires_neither_model_nor_engine(self) -> None:
        result = self.invoke("--list")
        self.assertEqual(result.returncode, 0, result.stderr)
        for case_id in ("INTENT-01", "INTENT-02", "HUMAN-01", "Skills-Eval-02"):
            self.assertIn(case_id, result.stdout)
        self.assertFalse(self.capture.exists(), "listing must not invoke the engine")

    def test_missing_selection_refuses_inference_before_engine(self) -> None:
        result = self.invoke("--model", "fixture/model")
        self.assertEqual(result.returncode, 2)
        self.assertIn("pass --cases", result.stderr)
        self.assertFalse(self.capture.exists())

    def test_native_skill_routing_cannot_use_copilot_target(self) -> None:
        result = self.invoke(
            "--cases", "SKILL-GO-CONC-01", "--model", "fixture/model",
            "--target-transport", "github-copilot-cli",
            "--judge-transport", "github-copilot-cli",
        )
        self.assertEqual(result.returncode, 2)
        self.assertIn("native skill-routing", result.stderr)
        self.assertFalse(self.capture.exists())

    def test_retired_diagnostic_authority_flag_fails_closed(self) -> None:
        result = self.invoke(
            "--cases", "INTENT-01", "--model", "fixture/model",
            "--runner-evidence-safety",
        )
        self.assertEqual(result.returncode, 2)
        self.assertIn("retired", result.stderr)
        self.assertFalse(self.capture.exists())


if __name__ == "__main__":
    unittest.main()
