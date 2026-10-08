from __future__ import annotations

import importlib.util
import json
import os
import sys
import tempfile
import types
import unittest
from unittest import mock
from dataclasses import dataclass
from pathlib import Path


@dataclass(frozen=True)
class NormalizedCase:
    id: str
    selectors: tuple[str, ...]
    lane: str
    project_data: object
    metadata: dict[str, object]


@dataclass(frozen=True)
class InvocationSpec:
    transport: str
    model: str
    reasoning: str | None
    agent: str | None
    skill: str | None
    workspace: Path
    workspace_mode: str
    prompt: str
    system: str | None
    expected_plugin: str | None
    engine: str
    network: str | None
    image: str | None
    auth: Path | None
    database: Path | None
    models_catalog: Path | None
    config: Path | None
    config_root: Path | None
    env_names: tuple[str, ...]
    timeout_seconds: int
    container_timeout: int


def load_case_adapter_module():
    """Load Worker-A code against the exact frozen public envelopes, in isolation."""
    package_root = Path(__file__).resolve().parent / "loom_eval_profile"
    package_name = "_loom_case_adapter_testpkg"

    runner = types.ModuleType("runner")
    api = types.ModuleType("runner.eval_api")
    api.NormalizedCase = NormalizedCase
    api.InvocationSpec = InvocationSpec
    api.JsonValue = object
    runner.eval_api = api

    package = types.ModuleType(package_name)
    package.__path__ = [str(package_root)]

    saved = {
        name: sys.modules.get(name)
        for name in ("runner", "runner.eval_api", package_name)
    }
    try:
        sys.modules["runner"] = runner
        sys.modules["runner.eval_api"] = api
        sys.modules[package_name] = package

        shared_name = package_name + "._shared"
        shared_spec = importlib.util.spec_from_file_location(
            shared_name, package_root / "_shared.py"
        )
        assert shared_spec is not None and shared_spec.loader is not None
        shared = importlib.util.module_from_spec(shared_spec)
        sys.modules[shared_name] = shared
        shared_spec.loader.exec_module(shared)

        module_name = package_name + ".case_adapter"
        module_spec = importlib.util.spec_from_file_location(
            module_name, package_root / "case_adapter.py"
        )
        assert module_spec is not None and module_spec.loader is not None
        module = importlib.util.module_from_spec(module_spec)
        sys.modules[module_name] = module
        module_spec.loader.exec_module(module)
        return module
    finally:
        for name in (
            package_name + ".case_adapter",
            package_name + "._shared",
            package_name,
            "runner.eval_api",
            "runner",
        ):
            prior = saved.get(name)
            if prior is None:
                sys.modules.pop(name, None)
            else:
                sys.modules[name] = prior


_case_adapter = load_case_adapter_module()
RUNTIME_NODE_MODULES_TARGET = _case_adapter.RUNTIME_NODE_MODULES_TARGET
TARGET_MODEL_OVERRIDE_REQUIRED = _case_adapter.TARGET_MODEL_OVERRIDE_REQUIRED
LoomCaseWorkspaceAdapter = _case_adapter.LoomCaseWorkspaceAdapter


AGENT = """---
description: Test agent
mode: subagent
---

Production instructions.
"""


def write_suite(root: Path, name: str, cases: list[dict], *, default: bool = True) -> None:
    evals = root / "evals"
    evals.mkdir(parents=True, exist_ok=True)
    (evals / f"{name}.json").write_text(
        json.dumps(
            {
                "version": 1,
                "name": name,
                "default": default,
                "cases": cases,
            }
        ),
        encoding="utf-8",
    )


def base_case(case_id: str, execution: str, **extra):
    value = {
        "id": case_id,
        "agent": "general",
        "execution": execution,
        "requirements": ["BR-001"],
        "prompt": "Do the bounded thing.",
        "trap": "Overreach.",
        "expectations": ["Stay bounded.", "State the result."],
        "must_not": ["Do not invent evidence."],
    }
    value.update(extra)
    return value


class LoomCaseWorkspaceAdapterTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="loom-case-adapter-test-")
        self.root = Path(self.temp.name)
        (self.root / "agents").mkdir()
        (self.root / "agents" / "general.md").write_text(AGENT, encoding="utf-8")
        (self.root / "agents" / "reviewer.md").write_text(AGENT, encoding="utf-8")
        (self.root / "skills" / "sample").mkdir(parents=True)
        (self.root / "skills" / "sample" / "SKILL.md").write_text(
            "# Sample\n", encoding="utf-8"
        )
        self.adapter = LoomCaseWorkspaceAdapter(self.root)

    def tearDown(self):
        self.temp.cleanup()

    def test_discovery_normalizes_all_central_cases_and_preserves_opt_in_metadata(self):
        write_suite(
            self.root,
            "default-suite",
            [
                base_case("ROLE-01", "role-decision"),
                base_case("RUNTIME-01", "runtime", default=False, skill="sample"),
            ],
        )
        write_suite(
            self.root,
            "opt-in-suite",
            [base_case("CHAT-01", "conversation-response")],
            default=False,
        )

        cases = self.adapter.discover_cases()

        self.assertEqual([case.id for case in cases], ["ROLE-01", "RUNTIME-01", "CHAT-01"])
        self.assertEqual([case.lane for case in cases], ["standard", "runtime", "standard"])
        runtime = cases[1]
        self.assertIn("suite:default-suite", runtime.selectors)
        self.assertIn("agent:general", runtime.selectors)
        self.assertIn("execution:runtime", runtime.selectors)
        self.assertIn("target-kind:skill", runtime.selectors)
        self.assertIn("target:skill:sample", runtime.selectors)
        self.assertIn("skill:sample", runtime.selectors)
        self.assertFalse(runtime.metadata["default_enabled"])
        self.assertFalse(cases[2].metadata["default_enabled"])
        self.assertEqual(runtime.project_data["skill"], "sample")

    def test_explicit_suite_paths_override_default_corpus_including_external_file(self):
        write_suite(self.root, "default", [base_case("DEFAULT-01", "role-decision")])
        with tempfile.TemporaryDirectory(prefix="loom-external-eval-suite-") as outside:
            suite = Path(outside) / "custom-eval-suite"
            suite.write_text(json.dumps({
                "version": 1, "name": "external", "default": False,
                "cases": [base_case("CUSTOM-01", "conversation-response")],
            }), encoding="utf-8")
            with mock.patch.dict(os.environ, {
                "LOOM_EVAL_SUITE_PATHS": json.dumps([str(suite)]),
            }):
                cases = self.adapter.discover_cases()
        self.assertEqual([case.id for case in cases], ["CUSTOM-01"])
        self.assertEqual(cases[0].metadata["source_suite"], "external")
        self.assertEqual(cases[0].metadata["source_path"], str(suite))
        # No --suite means the default corpus is restored.
        with mock.patch.dict(os.environ, {"LOOM_EVAL_SUITE_PATHS": ""}):
            with self.assertRaisesRegex(ValueError, "nonempty JSON path array"):
                self.adapter.discover_cases()

    def test_invalid_suite_bridge_fails_closed_without_fallback(self):
        write_suite(self.root, "default", [base_case("DEFAULT-01", "role-decision")])
        for invalid in ("not JSON", "[]", '{"unexpected": true}', '["/missing/suite.json"]'):
            with self.subTest(value=invalid), mock.patch.dict(
                os.environ, {"LOOM_EVAL_SUITE_PATHS": invalid}
            ):
                with self.assertRaises(ValueError):
                    self.adapter.discover_cases()

    def test_role_decision_prepare_builds_isolated_read_only_target_and_cleans_up(self):
        write_suite(
            self.root,
            "role",
            [
                base_case(
                    "ROLE-01",
                    "role-decision",
                    fixture_files=[{"path": "docs/context.md", "content": "fixture"}],
                )
            ],
        )
        case = self.adapter.discover_cases()[0]

        with self.adapter.prepare(case, 2) as prepared:
            target = prepared.target_workspace
            judge = prepared.judge_workspace
            target_agent = (target / ".opencode" / "agents" / "general.md").read_text(
                encoding="utf-8"
            )
            self.assertIn("mode: primary", target_agent)
            self.assertIn("effect: deny", target_agent)
            self.assertIn("Isolated behavioral-evaluation boundary", target_agent)
            self.assertEqual((target / "docs" / "context.md").read_text(), "fixture")
            self.assertTrue((target / ".opencode" / "skills" / "sample" / "SKILL.md").is_file())
            self.assertFalse((target / ".opencode" / "plugins").exists())
            self.assertEqual(json.loads((target / "opencode.json").read_text())["default_agent"], "general")
            self.assertEqual(json.loads((judge / "opencode.json").read_text())["default_agent"], "eval-judge")
            self.assertFalse((judge / ".opencode" / "agents" / "eval-judge.md").exists())

            spec = self.adapter.target_spec(case, prepared)
            self.assertEqual(spec.model, TARGET_MODEL_OVERRIDE_REQUIRED)
            self.assertEqual(spec.workspace_mode, "ro")
            self.assertIsNone(spec.config_root)
            self.assertIsNone(spec.expected_plugin)
            self.assertIsNone(spec.network)
            self.assertIsNone(spec.config)
            self.assertIn("Respond with the production decision/action", spec.prompt)
            self.assertIn("Isolated behavioral-evaluation boundary", spec.system or "")
            temp_root = target.parent

        self.assertFalse(temp_root.exists())

    def test_runtime_prepare_promotes_selected_agent_and_bridges_dependencies_read_only(self):
        (self.root / "node_modules" / "@opencode" / "plugin").mkdir(parents=True)
        write_suite(
            self.root,
            "runtime",
            [
                base_case(
                    "RUNTIME-01",
                    "runtime",
                    skill="sample",
                    target_timeout_seconds=540,
                    fixture_files=[{"path": "README.md", "content": "runtime fixture"}],
                )
            ],
        )
        case = self.adapter.discover_cases()[0]

        with self.adapter.prepare(case, 1) as prepared:
            target = prepared.target_workspace
            selected = (target / ".opencode" / "agents" / "general.md").read_text()
            other = (target / ".opencode" / "agents" / "reviewer.md").read_text()
            self.assertIn("mode: primary", selected)
            self.assertIn("mode: subagent", other)
            dependency_link = target / "node_modules"
            self.assertTrue(dependency_link.is_symlink())
            self.assertEqual(dependency_link.readlink().as_posix(), RUNTIME_NODE_MODULES_TARGET)
            self.assertEqual((target / "README.md").read_text(), "runtime fixture")

            spec = self.adapter.target_spec(case, prepared)
            self.assertEqual(spec.transport, "opencode")
            self.assertEqual(spec.skill, "sample")
            self.assertEqual(spec.workspace_mode, "rw")
            self.assertEqual(spec.expected_plugin, "loom")
            self.assertEqual(spec.config_root, self.root)
            self.assertEqual(spec.timeout_seconds, 540)
            self.assertEqual(spec.container_timeout, 600)
            self.assertIsNone(spec.system)
            metadata = self.adapter.artifact_metadata(case, prepared)
            self.assertEqual(metadata["evaluation_mode"], "normal")
            self.assertEqual(metadata["node_modules"], "config-root-readonly-bridge")
            self.assertEqual(metadata["requirements"], ["BR-001"])

    def test_conversation_response_preserves_prompt_and_uses_conversation_wrapper(self):
        write_suite(
            self.root,
            "chat",
            [base_case("CHAT-01", "conversation-response")],
        )
        case = self.adapter.discover_cases()[0]

        with self.adapter.prepare(case, 1) as prepared:
            spec = self.adapter.target_spec(case, prepared)
            self.assertEqual(spec.prompt, "Do the bounded thing.")
            self.assertEqual(spec.workspace_mode, "ro")
            self.assertIn("Isolated conversational-response evaluation boundary", spec.system or "")
            self.assertNotIn("production decision/action", spec.prompt)


if __name__ == "__main__":
    unittest.main()
