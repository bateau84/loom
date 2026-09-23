#!/usr/bin/env python3
"""Regression checks for the CI proof boundary; no model, Docker, or Bun needed."""
from __future__ import annotations

import importlib.util
import json
import subprocess
import tempfile
import unittest
from pathlib import Path
from unittest.mock import Mock, patch

from verify_runner_plugin import EXPECTED, MISSING, VERIFICATION, check_activation

ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location("unit_runner", ROOT / "scripts/run-unit-tests.py")
assert SPEC and SPEC.loader
RUNNER = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(RUNNER)


def active_result() -> dict:
    return {
        "expected": EXPECTED,
        "agent": "general",
        "entrypoints": ["plugins/loom.ts"],
        "plugin": {"id": EXPECTED, "state": {"status": "active"}},
        "verification": VERIFICATION,
    }


class ActivationTests(unittest.TestCase):
    def test_real_result_and_specific_negative_control(self):
        verify = Mock(side_effect=[active_result(), RuntimeError(
            f"expected plugin {MISSING!r} is not materialized in /config/plugins; available entries: ['loom.ts']"
        )])
        check_activation(verify, {})
        self.assertEqual([call.args[3] for call in verify.call_args_list], [EXPECTED, MISSING])
        self.assertTrue(all(call.args[2] == "openai/preflight-no-inference" for call in verify.call_args_list))

    def test_empty_or_incomplete_result_is_not_a_pass(self):
        for result in (None, {}, {"verification": VERIFICATION}):
            with self.subTest(result=result), self.assertRaises(RuntimeError):
                check_activation(Mock(return_value=result), {})

    def test_wrong_identity_inactive_state_or_missing_proof_is_rejected(self):
        for key, value in (
            ("expected", MISSING), ("agent", "worker"), ("entrypoints", []),
            ("verification", "inventory-only"),
            ("plugin", {"id": MISSING, "state": {"status": "active"}}),
            ("plugin", {"id": EXPECTED, "state": {"status": "failed"}}),
        ):
            with self.subTest(key=key, value=value), self.assertRaises(RuntimeError):
                check_activation(Mock(return_value={**active_result(), key: value}), {})

    def test_noop_verifier_cannot_pass_both_controls(self):
        with self.assertRaisesRegex(RuntimeError, "incorrectly accepted"):
            check_activation(Mock(return_value=active_result()), {})

    def test_unrelated_negative_failure_is_not_credited(self):
        for error in (RuntimeError("HTTP 401"), RuntimeError("server timed out"), TimeoutError("timeout")):
            with self.subTest(error=error), self.assertRaises((RuntimeError, TimeoutError)):
                check_activation(Mock(side_effect=[active_result(), error]), {})

    def test_positive_failure_propagates(self):
        with self.assertRaisesRegex(RuntimeError, "cannot load"):
            check_activation(Mock(side_effect=RuntimeError("cannot load")), {})

    def test_workflow_runs_a_file_and_checks_actual_output(self):
        workflow = (ROOT / ".github/workflows/loom-ci.yml").read_text()
        self.assertIn('"$image" /seed/opencode-config/scripts/verify_runner_plugin.py', workflow)
        self.assertNotIn('"$image" - <<', workflow)
        self.assertIn("set -euo pipefail", workflow)
        self.assertIn("grep -Fxq 'PASS real Loom plugin activation'", workflow)
        self.assertIn("grep -Fxq 'PASS missing plugin rejected'", workflow)


class UnitDiscoveryTests(unittest.TestCase):
    def fixture(self, root: Path) -> None:
        for directory in RUNNER.UNIT_ROOTS:
            (root / directory).mkdir(parents=True)

    def test_discovers_new_unit_suites_but_not_browser_or_external_suites(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            self.fixture(root)
            paths = ["plugins/loom/reports.test.ts", "scripts/nested/new.test.ts", "dashboard/new.test.ts"]
            for path in paths + ["dashboard/status.e2e.spec.ts", "scripts/host-integration.ts", "skills/fixture.test.ts"]:
                target = root / path
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_text("")
            self.assertEqual(RUNNER.discover_unit_tests(root), sorted("./" + path for path in paths))

    def test_missing_roots_and_empty_selection_fail_closed(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            with self.assertRaises(RuntimeError):
                RUNNER.discover_unit_tests(root)
            self.fixture(root)
            with self.assertRaisesRegex(RuntimeError, "No unit-test"):
                RUNNER.discover_unit_tests(root)

    def test_symlinked_suites_and_directories_are_not_followed(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            self.fixture(root)
            (root / "scripts/kept.test.ts").write_text("")
            (root / "outside").mkdir()
            (root / "outside/ignored.test.ts").write_text("")
            (root / "scripts/linked.test.ts").symlink_to(root / "outside/ignored.test.ts")
            (root / "scripts/linked-dir").symlink_to(root / "outside", target_is_directory=True)
            self.assertEqual(RUNNER.discover_unit_tests(root), ["./scripts/kept.test.ts"])

    def test_child_failure_and_argument_boundaries_are_preserved(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            self.fixture(root)
            (root / "scripts/a space.test.ts").write_text("")
            with patch.object(RUNNER.subprocess, "run", return_value=subprocess.CompletedProcess([], 7)) as run:
                self.assertEqual(RUNNER.run_unit_tests(root), 7)
            run.assert_called_once_with(["bun", "test", "./scripts/a space.test.ts"], cwd=root, check=False)

    def test_normal_entrypoint_uses_discovery(self):
        script = json.loads((ROOT / "package.json").read_text())["scripts"]["test"]
        self.assertIn("python3 scripts/run-unit-tests.py", script)
        self.assertNotIn("bun test ./", script)


if __name__ == "__main__":
    unittest.main()
