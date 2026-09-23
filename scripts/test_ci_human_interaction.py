#!/usr/bin/env python3
"""Human-interaction eval wiring, not a model-quality score."""
from __future__ import annotations

import importlib.util
import json
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location("interaction_eval_runner", ROOT / "scripts/run-evals.py")
assert SPEC and SPEC.loader
RUNNER = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(RUNNER)
RESPONSE_SUITE = ROOT / "evals/human-interaction.json"
LIVE_SUITE = ROOT / "evals/human-interaction-live.json"
REGRESSION_SUITE = ROOT / "evals/human-interaction-regressions.json"
BR020 = ROOT / "docs/requirements/loom/br-020-conversation-is-primary-interface.md"


class HumanInteractionWiringTests(unittest.TestCase):
    def test_actual_response_cases_are_in_default_suite_without_nested_inference(self):
        cases = RUNNER.load_cases([RESPONSE_SUITE])
        self.assertEqual({item["id"] for item in cases}, {
            "HUMAN-01", "HUMAN-03", "HUMAN-04", "HUMAN-05", "HUMAN-06",
            "HUMAN-07", "HUMAN-08", "HUMAN-09", "HUMAN-10",
        })
        default_ids = {item["id"] for item in RUNNER.load_cases()}
        for case in cases:
            self.assertIn(case["id"], default_ids)
            self.assertEqual(case["agent"], "general")
            self.assertEqual(case["execution"], "conversation-response")
            self.assertNotIn("tools", case)
            self.assertNotIn("actions", case)
            self.assertEqual(RUNNER.case_workspace_mode(case), "ro")

    def test_regression_cases_are_opt_in_without_nested_inference(self):
        self.assertIs(json.loads(REGRESSION_SUITE.read_text())["default"], False)
        cases = RUNNER.load_cases([REGRESSION_SUITE])
        self.assertEqual({case["id"] for case in cases}, {
            "HUMAN-CAUSE-01", "HUMAN-CAUSE-UNKNOWN-01", "HUMAN-TRACE-01", "HUMAN-JSON-01",
            "HUMAN-JSON-OBSERVED-01", "HUMAN-BLOCKER-PRIORITY-01",
        })
        default_ids = {case["id"] for case in RUNNER.load_cases()}
        for case in cases:
            self.assertNotIn(case["id"], default_ids)
            self.assertEqual(case["agent"], "general")
            self.assertEqual(case["execution"], "conversation-response")
            self.assertEqual(RUNNER.case_workspace_mode(case), "ro")
            self.assertNotIn("tools", case)
            self.assertNotIn("actions", case)
            for grading in [case["trap"], *case["expectations"], *case["must_not"]]:
                self.assertNotIn(grading, case["prompt"])

    def test_removed_human_02_does_not_leave_a_stale_identical_evidence_requirement(self):
        requirement = BR020.read_text()
        self.assertIn("both short-status and detailed-report coverage", requirement)
        self.assertNotIn("paired short-status and detailed-report requests from identical evidence", requirement)

    def test_reviewer_false_green_boundaries_are_judge_only_and_explicit(self):
        response = {case["id"]: case for case in RUNNER.load_cases([RESPONSE_SUITE])}
        regressions = {case["id"]: case for case in RUNNER.load_cases([REGRESSION_SUITE])}

        handover = response["HUMAN-03"]
        handover_grading = [*handover["expectations"], *handover["must_not"]]
        self.assertTrue(any("optional rather than required remaining work" in rule for rule in handover_grading))
        self.assertTrue(any("unestablished check as required remaining work" in rule for rule in handover_grading))

        unknown = regressions["HUMAN-CAUSE-UNKNOWN-01"]
        unknown_grading = [*unknown["expectations"], *unknown["must_not"]]
        self.assertTrue(any("blocked verification state into an attempted" in rule for rule in unknown_grading))
        self.assertTrue(any("verification was attempted" in rule for rule in unknown_grading))

        for case in (handover, unknown):
            for grading in [case["trap"], *case["expectations"], *case["must_not"]]:
                self.assertNotIn(grading, case["prompt"])

    def test_status_contract_pins_critic_readiness_fixes(self):
        source = (ROOT / "agents/general.md").read_text()
        self.assertIn("affected check and any supplied immediate cause as one atomic fact", source)
        self.assertIn("Omit unrequested non-events such as non-deployment before dropping a known cause", source)
        self.assertIn("`blocked` or `pending` does not establish that a check was attempted", source)
        self.assertIn("additional prudent checks may be suggested only when clearly labeled optional", source)

        regressions = {case["id"]: case for case in RUNNER.load_cases([REGRESSION_SUITE])}
        priority = regressions["HUMAN-BLOCKER-PRIORITY-01"]
        self.assertIn("staging gateway denies every currently authorized verification identity", priority["prompt"])
        self.assertTrue(any("gateway-denial cause" in rule for rule in priority["must_not"]))

    def test_response_projects_keep_the_production_contract_but_not_grading_metadata(self):
        source_body = RUNNER.strip_frontmatter((ROOT / "agents/general.md").read_text())
        for case in RUNNER.load_cases([RESPONSE_SUITE, REGRESSION_SUITE]):
            with self.subTest(case=case["id"]):
                temporary, target, _ = RUNNER.setup_projects(case)
                try:
                    agent_root = target / ".opencode/agents"
                    self.assertEqual(sorted(path.name for path in agent_root.glob("*.md")), ["general.md"])
                    profile = (agent_root / "general.md").read_text()
                    # A heading alone cannot establish that the actual policy survived wrapping.
                    self.assertIn(source_body, profile)
                    self.assertIn("## Human-facing communication", profile)
                    self.assertIn('action: "*"', profile)
                    self.assertIn('resource: "*"', profile)
                    self.assertIn("effect: deny", profile)
                    for grading in [case["trap"], *case["expectations"], *case["must_not"]]:
                        self.assertNotIn(grading, profile)
                finally:
                    shutil.rmtree(temporary)

    def test_live_case_is_opt_in_and_requires_both_real_commands(self):
        self.assertFalse(json.loads(LIVE_SUITE.read_text())["default"])
        self.assertNotIn("HUMAN-RUNTIME-01", {case["id"] for case in RUNNER.load_cases()})
        case, = RUNNER.load_cases([LIVE_SUITE])
        self.assertEqual(case["execution"], "runtime")
        groups = case["actions"]["any_of"]
        self.assertEqual(len(groups), 2)
        self.assertEqual(
            {assertion["contains"] for group in groups for assertion in group},
            {"python3 checks/config_check.py", "python3 checks/recovery_check.py"},
        )

    def test_runtime_fixture_has_a_real_passing_check_and_failing_recovery_check(self):
        case, = RUNNER.load_cases([LIVE_SUITE])
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            for fixture in case["fixture_files"]:
                path = root / fixture["path"]
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_text(fixture["content"])
            before = {path.relative_to(root): path.read_bytes() for path in root.rglob("*") if path.is_file()}
            passing = subprocess.run([sys.executable, "checks/config_check.py"], cwd=root, capture_output=True, text=True, check=False)
            failing = subprocess.run([sys.executable, "checks/recovery_check.py"], cwd=root, capture_output=True, text=True, check=False)
            self.assertEqual(passing.returncode, 0, passing.stderr)
            self.assertIn("PASS configuration", passing.stdout)
            self.assertNotEqual(failing.returncode, 0)
            self.assertIn("got 0 attempts, want 3", failing.stderr)
            after = {path.relative_to(root): path.read_bytes() for path in root.rglob("*") if path.is_file()}
            self.assertEqual(after, before)


if __name__ == "__main__":
    unittest.main()
