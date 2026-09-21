#!/usr/bin/env python3
from __future__ import annotations

import importlib.util
import json
from pathlib import Path
import unittest

MODULE_PATH = Path(__file__).resolve().parent / "run-evals.py"
SPEC = importlib.util.spec_from_file_location("loom_run_evals", MODULE_PATH)
assert SPEC and SPEC.loader
RUN_EVALS = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(RUN_EVALS)


class ActionAssertionTests(unittest.TestCase):
    def test_prefers_normalized_transport_actions_over_raw_stdout(self):
        target = {
            "actions": [
                {"tool": "skill", "args": {"name": "golang-concurrency"}},
                {
                    "tool": "read",
                    "args": {
                        "filePath": "/workspace/.opencode/skills/golang-concurrency/ASSESSMENT.md"
                    },
                },
            ],
            "stdout": "",
        }
        self.assertEqual(
            RUN_EVALS.normalized_target_actions(target),
            target["actions"],
        )

    def test_falls_back_to_raw_stdout_for_older_runner_images(self):
        event = {
            "type": "tool_use",
            "part": {
                "type": "tool",
                "tool": "skill",
                "state": {"status": "completed", "input": {"name": "golang-cli"}},
            },
        }
        target = {"stdout": json.dumps(event) + "\n"}
        self.assertEqual(
            RUN_EVALS.normalized_target_actions(target),
            [{"tool": "skill", "args": {"name": "golang-cli"}}],
        )

    def test_extracts_tool_inputs_from_opencode_json_events(self):
        lines = [
            {
                "type": "tool_use",
                "part": {
                    "type": "tool",
                    "tool": "skill",
                    "state": {"status": "completed", "input": {"name": "golang-concurrency"}},
                },
            },
            {
                "type": "tool_use",
                "part": {
                    "type": "tool",
                    "tool": "read",
                    "state": {
                        "status": "completed",
                        "input": {"filePath": "/workspace/.opencode/skills/golang-concurrency/ASSESSMENT.md"},
                    },
                },
            },
        ]
        raw = "\n".join(json.dumps(line) for line in lines)
        self.assertEqual(
            RUN_EVALS.extract_observed_actions(raw),
            [
                {"tool": "skill", "args": {"name": "golang-concurrency"}},
                {
                    "tool": "read",
                    "args": {
                        "filePath": "/workspace/.opencode/skills/golang-concurrency/ASSESSMENT.md"
                    },
                },
            ],
        )

    def test_grades_equals_suffix_and_forbidden_actions(self):
        actions = [
            {"tool": "skill", "args": {"name": "golang-concurrency"}},
            {
                "tool": "read",
                "args": {
                    "filePath": "/workspace/.opencode/skills/golang-concurrency/ASSESSMENT.md"
                },
            },
        ]
        case = {
            "actions": {
                "requires": [
                    {"tool": "skill", "arg": "name", "equals": "golang-concurrency"},
                    {
                        "tool": "read",
                        "arg": "filePath",
                        "ends_with": "skills/golang-concurrency/ASSESSMENT.md",
                    },
                ],
                "forbids": [
                    {
                        "tool": "read",
                        "arg": "filePath",
                        "ends_with": "skills/golang-concurrency/QA.md",
                    }
                ],
            }
        }
        self.assertEqual(RUN_EVALS.deterministic_failures(case, ["skill", "read"], actions), [])

    def test_reports_missing_required_and_observed_forbidden_action(self):
        actions = [
            {
                "tool": "read",
                "args": {"filePath": "/workspace/.opencode/skills/golang-concurrency/QA.md"},
            }
        ]
        case = {
            "actions": {
                "requires": [
                    {"tool": "skill", "arg": "name", "equals": "golang-concurrency"}
                ],
                "forbids": [
                    {
                        "tool": "read",
                        "arg": "filePath",
                        "ends_with": "skills/golang-concurrency/QA.md",
                    }
                ],
            }
        }
        failures = RUN_EVALS.deterministic_failures(case, ["read"], actions)
        self.assertEqual(len(failures), 2)
        self.assertTrue(failures[0].startswith("required action not observed:"))
        self.assertTrue(failures[1].startswith("forbidden action observed:"))


if __name__ == "__main__":
    unittest.main()
