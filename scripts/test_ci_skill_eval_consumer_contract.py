"""Focused regressions for executable skill-eval consumer compatibility."""
from __future__ import annotations

import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

VALIDATOR = Path(__file__).with_name("validate-skill-evals.py")


class SkillEvalConsumerContractTests(unittest.TestCase):
    def run_case(self, case: dict) -> subprocess.CompletedProcess[str]:
        with tempfile.TemporaryDirectory(prefix="loom-skill-eval-contract-") as temp:
            skills = Path(temp)
            evals = skills / "example" / "evals"
            evals.mkdir(parents=True)
            (evals / "cases.json").write_text(
                json.dumps({"skill": "example", "cases": [case]}),
                encoding="utf-8",
            )
            return subprocess.run(
                [sys.executable, str(VALIDATOR), "--skills-root", str(skills)],
                capture_output=True,
                text=True,
                check=False,
            )

    def test_rejects_self_validating_request_expect_reject_shape(self):
        result = self.run_case({
            "id": "case-1",
            "request": "Summarize a deployment.",
            "expect": ["Include a source."],
            "reject": ["Invent a deployment."],
        })
        self.assertEqual(result.returncode, 1)
        self.assertIn("has no prompt", result.stderr)

    def test_accepts_real_consumer_shape(self):
        result = self.run_case({
            "id": "case-1",
            "prompt": "Summarize a deployment.",
            "trap": "Invent a deployment without proof.",
            "expectations": ["Include a source."],
            "negative_expectations": ["Do not invent a deployment."],
        })
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("PASS skill-owned eval consumer (1 cases)", result.stdout)


if __name__ == "__main__":
    unittest.main()
