#!/usr/bin/env python3
"""Zero-inference fixture regressions, not a proxy for model behavior.

Run from any directory: python3 scripts/test_eval_fixtures.py
Only `sh -n` parses script fixtures; their commands are never executed.
"""
from __future__ import annotations

import json
from pathlib import Path, PurePosixPath
import shutil
import subprocess
import unittest

ROOT = Path(__file__).resolve().parents[1]


def require_multiline(content: str) -> None:
    """Catch serialized newline text without rejecting intentional shell escapes."""
    if not isinstance(content, str) or len(content.splitlines()) < 2:
        raise ValueError("fixture must contain real newline-separated lines")


def docker_entrypoint(content: str) -> list[str]:
    require_multiline(content)
    declarations = [line[11:].strip() for line in content.splitlines()
                    if line.startswith("ENTRYPOINT ")]
    if len(declarations) != 1:
        raise ValueError("expected one JSON ENTRYPOINT")
    value = json.loads(declarations[0])
    if not isinstance(value, list) or not value or not all(isinstance(x, str) for x in value):
        raise ValueError("ENTRYPOINT must be a nonempty string array")
    return value


class EncodingChecks(unittest.TestCase):
    def test_real_lines_preserve_intentional_printf_escape(self) -> None:
        text = "#!/bin/sh\nprintf '%s\\n' ready > /tmp/setup-state\n"
        require_multiline(text)
        self.assertIn("%s\\n", text)

    def test_rejects_double_serialized_newlines(self) -> None:
        with self.assertRaises(ValueError):
            require_multiline(r"#!/bin/sh\nprintf ready\n")

    def test_entrypoint_json_is_not_double_escaped(self) -> None:
        self.assertEqual(docker_entrypoint('FROM example\nENTRYPOINT ["/main.sh"]\n'), ["/main.sh"])
        with self.assertRaises(ValueError):
            docker_entrypoint('FROM example\nENTRYPOINT [\\"/main.sh\\"]\n')


class RepositoryFixtures(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.cases: dict[str, dict] = {}
        for path in sorted((ROOT / "evals").glob("*.json")):
            suite = json.loads(path.read_text(encoding="utf-8"))
            for case in suite["cases"]:
                if case["id"] in cls.cases:
                    raise AssertionError(f"duplicate case ID across suites: {case['id']}")
                cls.cases[case["id"]] = case
        if not cls.cases:
            raise AssertionError("no eval cases found")

    def fixture_map(self, case_id: str) -> dict[str, str]:
        return {f["path"]: f["content"] for f in self.cases[case_id].get("fixture_files", [])}

    def test_agents_and_fixture_paths(self) -> None:
        for case_id, case in self.cases.items():
            with self.subTest(case=case_id):
                self.assertTrue((ROOT / "agents" / f"{case['agent']}.md").is_file())
                paths: set[str] = set()
                for fixture in case.get("fixture_files", []):
                    path = PurePosixPath(fixture["path"])
                    self.assertFalse(path.is_absolute())
                    self.assertNotIn("..", path.parts)
                    self.assertNotIn(fixture["path"], paths)
                    self.assertIsInstance(fixture["content"], str)
                    paths.add(fixture["path"])

    def test_workflow_fixture_has_real_lines_and_keeps_unsafe_premise(self) -> None:
        text = self.fixture_map("REVIEW-GHA-WORKFLOW-01")[".github/workflows/pr-admin.yml"]
        require_multiline(text)
        lines = text.splitlines()
        self.assertIn("on:", lines)
        self.assertIn("  pull_request_target:", lines)
        self.assertIn("  contents: write", lines)
        self.assertIn("${{ github.event.pull_request.head.sha }}", text)
        self.assertIn("third-party/pr-helper@v1", text)
        self.assertIn("./scripts/check-pr.sh", text)

    def test_action_fixture_has_real_lines_and_keeps_lifecycle_trap(self) -> None:
        files = self.fixture_map("REVIEW-GHA-ACTION-01")
        for path, text in files.items():
            with self.subTest(path=path):
                require_multiline(text)
        self.assertEqual(docker_entrypoint(files["Dockerfile"]), ["/main.sh"])
        self.assertIn("USER app", files["Dockerfile"].splitlines())
        self.assertIn("  pre-entrypoint: /setup.sh", files["action.yml"].splitlines())
        self.assertIn("  post-entrypoint: /cleanup.sh", files["action.yml"].splitlines())
        self.assertIn("/tmp/setup-state", files["setup.sh"])
        self.assertIn("/tmp/setup-state", files["main.sh"])

    def test_action_shell_syntax_without_execution(self) -> None:
        shell = shutil.which("sh")
        if shell is None:
            self.skipTest("sh unavailable; fixture commands are never executed")
        for path, text in self.fixture_map("REVIEW-GHA-ACTION-01").items():
            if not path.endswith(".sh"):
                continue
            with self.subTest(path=path):
                result = subprocess.run([shell, "-n"], input=text, text=True,
                                        capture_output=True, timeout=5, check=False)
                self.assertEqual(result.returncode, 0, result.stderr)

    def test_fallback_fixture_still_lacks_companions_and_supplies_interface(self) -> None:
        for name in ("ASSESSMENT.md", "QA.md"):
            self.assertFalse((ROOT / "skills" / "golang-cli" / name).exists(),
                             "fallback fixture must be revised if this skill gains a companion")
        for case_id in ("REVIEW-SKILL-FALLBACK-01", "CRITIC-SKILL-FALLBACK-01"):
            with self.subTest(case=case_id):
                files = self.fixture_map(case_id)
                self.assertIn("cli.go", files)
                self.assertTrue(files["README.md"].strip())
                forbidden = self.cases[case_id]["actions"]["forbids"]
                self.assertFalse(any(a["tool"] == "glob" for a in forbidden))

    def test_setup_cases_and_separate_continuation_case_remain(self) -> None:
        for case_id in ("PROP-RUNTIME-02", "PROP-RUNTIME-03", "STATUS-PREVIEW-01"):
            with self.subTest(case=case_id):
                case = self.cases[case_id]
                self.assertEqual(case["execution"], "runtime")
                self.assertIn("subagent", case["tools"]["forbids"])
        continuation = self.cases["AUDIT-CHANGE-CONTINUE-01"]
        self.assertEqual(continuation["execution"], "runtime")
        owners = {a.get("equals") for a in continuation["actions"]["requires"]
                  if a["tool"] == "subagent" and a.get("arg") == "agent"}
        self.assertTrue({"designer", "specifier", "reviewer"}.issubset(owners))
        self.assertNotIn("subagent", continuation["tools"].get("forbids", []))

    def test_synthesis_coverage_is_not_replaced_by_decision_tests(self) -> None:
        for case_id in ("AUDIT-RESEARCH-SYNTH-01", "AUDIT-RESEARCH-SYNTH-02",
                        "SPEC-01", "DESIGN-01", "AUDIT-BRAINSTORM-01"):
            with self.subTest(case=case_id):
                self.assertEqual(self.cases[case_id]["execution"], "conversation-response")


if __name__ == "__main__":
    unittest.main()
