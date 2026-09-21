#!/usr/bin/env python3
from __future__ import annotations

import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

MODULE_PATH = Path(__file__).resolve().parent / "run-evals.py"
SPEC = importlib.util.spec_from_file_location("loom_run_evals", MODULE_PATH)
assert SPEC and SPEC.loader
RUN_EVALS = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(RUN_EVALS)


class ActionAssertionTests(unittest.TestCase):
    def test_invoke_container_forwards_explicit_network_mode(self):
        class Result:
            returncode = 0
            stdout = '{"exit_code":0,"text":"ok","tools":[],"actions":[]}'
            stderr = ""

        with tempfile.TemporaryDirectory() as tmp:
            project = Path(tmp)
            with patch.object(RUN_EVALS.subprocess, "run", return_value=Result()) as run:
                result = RUN_EVALS.invoke_container(
                    engine="podman",
                    image="test-image",
                    transport="opencode",
                    model="openai/test",
                    agent="general",
                    prompt="test",
                    system="",
                    project=project,
                    auth=None,
                    config=None,
                    models_catalog=None,
                    database_seed=None,
                    config_root=None,
                    expected_plugin=None,
                    timeout=30,
                    container_timeout=60,
                    mount_node_modules=False,
                    extra_envs=[],
                    network="host",
                )

        self.assertEqual(result["exit_code"], 0)
        command = run.call_args.args[0]
        self.assertIn("--network", command)
        self.assertEqual(command[command.index("--network") + 1], "host")

    def test_invoke_container_leaves_network_default_when_unset(self):
        class Result:
            returncode = 0
            stdout = '{"exit_code":0,"text":"ok","tools":[],"actions":[]}'
            stderr = ""

        with tempfile.TemporaryDirectory() as tmp:
            project = Path(tmp)
            with patch.object(RUN_EVALS.subprocess, "run", return_value=Result()) as run:
                RUN_EVALS.invoke_container(
                    engine="podman",
                    image="test-image",
                    transport="opencode",
                    model="openai/test",
                    agent="general",
                    prompt="test",
                    system="",
                    project=project,
                    auth=None,
                    config=None,
                    models_catalog=None,
                    database_seed=None,
                    config_root=None,
                    expected_plugin=None,
                    timeout=30,
                    container_timeout=60,
                    mount_node_modules=False,
                    extra_envs=[],
                    network=None,
                )

        self.assertNotIn("--network", run.call_args.args[0])

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

    def test_matches_current_opencode_v2_argument_names(self):
        actions = [
            {"tool": "skill", "args": {"id": "golang-concurrency"}},
            {
                "tool": "read",
                "args": {
                    "path": "/workspace/.opencode/skills/golang-concurrency/ASSESSMENT.md"
                },
            },
            {"tool": "read", "args": {"path": "/workspace/pipeline.go"}},
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
                    {
                        "tool": "read",
                        "arg": "filePath",
                        "ends_with": "pipeline.go",
                    },
                ]
            }
        }
        self.assertEqual(
            RUN_EVALS.deterministic_failures(case, ["skill", "read"], actions),
            [],
        )

    def test_aliases_do_not_change_forbidden_companion_detection(self):
        actions = [
            {
                "tool": "read",
                "args": {"path": "/workspace/.opencode/skills/golang-cli/QA.md"},
            }
        ]
        case = {
            "actions": {
                "forbids": [
                    {
                        "tool": "read",
                        "arg": "filePath",
                        "ends_with": "skills/golang-cli/QA.md",
                    }
                ]
            }
        }
        failures = RUN_EVALS.deterministic_failures(case, ["read"], actions)
        self.assertEqual(len(failures), 1)
        self.assertTrue(failures[0].startswith("forbidden action observed:"))

    def test_matches_current_opencode_v2_argument_names(self):
        actions = [
            {"tool": "skill", "args": {"id": "golang-concurrency"}},
            {
                "tool": "read",
                "args": {
                    "path": "/workspace/.opencode/skills/golang-concurrency/ASSESSMENT.md"
                },
            },
            {"tool": "read", "args": {"path": "/workspace/pipeline.go"}},
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
                    {
                        "tool": "read",
                        "arg": "filePath",
                        "ends_with": "pipeline.go",
                    },
                ]
            }
        }
        self.assertEqual(
            RUN_EVALS.deterministic_failures(case, ["skill", "read"], actions),
            [],
        )

    def test_aliases_do_not_change_forbidden_companion_detection(self):
        actions = [
            {
                "tool": "read",
                "args": {"path": "/workspace/.opencode/skills/golang-cli/QA.md"},
            }
        ]
        case = {
            "actions": {
                "forbids": [
                    {
                        "tool": "read",
                        "arg": "filePath",
                        "ends_with": "skills/golang-cli/QA.md",
                    }
                ]
            }
        }
        failures = RUN_EVALS.deterministic_failures(case, ["read"], actions)
        self.assertEqual(len(failures), 1)
        self.assertTrue(failures[0].startswith("forbidden action observed:"))

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
