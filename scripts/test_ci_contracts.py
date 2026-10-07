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


class AgentButlerPermissionTests(unittest.TestCase):
    def test_every_agent_explicitly_allows_butler_shell(self):
        permission = (
            '  - action: shell\n'
            '    resource: "but *"\n'
            '    effect: allow'
        )
        for path in sorted((ROOT / "agents").glob("*.md")):
            text = path.read_text()
            header_end = text.find("\n---", 4)
            self.assertGreater(header_end, 0, path.name)
            header = text[:header_end]
            with self.subTest(agent=path.stem):
                self.assertIn(permission, header)
                wildcard_deny = (
                    '  - action: shell\n'
                    '    resource: "*"\n'
                    '    effect: deny'
                )
                if wildcard_deny in header:
                    self.assertGreater(
                        header.index(permission),
                        header.index(wildcard_deny),
                        "Butler allow must follow wildcard shell deny",
                    )


class AgentGitPermissionTests(unittest.TestCase):
    def test_every_agent_explicitly_allows_git_and_but_shell(self):
        permissions = [
            (
                '  - action: shell\n'
                '    resource: "git *"\n'
                '    effect: allow'
            ),
            (
                '  - action: shell\n'
                '    resource: "but *"\n'
                '    effect: allow'
            ),
        ]
        wildcard_deny = (
            '  - action: shell\n'
            '    resource: "*"\n'
            '    effect: deny'
        )
        for path in sorted((ROOT / "agents").glob("*.md")):
            text = path.read_text()
            header_end = text.find("\n---", 4)
            self.assertGreater(header_end, 0, path.name)
            header = text[:header_end]
            with self.subTest(agent=path.stem):
                for permission in permissions:
                    self.assertIn(permission, header)
                    if wildcard_deny in header:
                        self.assertGreater(
                            header.index(permission),
                            header.index(wildcard_deny),
                            "Git/Butler allow must follow wildcard shell deny",
                        )

    def test_runtime_has_universal_git_inspection_and_fail_closed_fallback(self):
        source = (ROOT / "plugins/loom/index.ts").read_text()
        self.assertIn("isGitInspectionShellCommand(resource)", source)
        self.assertIn(
            "Read-only repository inspection is universally available",
            source,
        )


class CommitScopeAuthorityTests(unittest.TestCase):
    def test_commit_authority_is_scope_derived_not_role_allowlisted(self):
        source = (ROOT / "plugins/loom/index.ts").read_text()
        self.assertNotIn("repositoryCommitAgents", source)
        self.assertNotIn("roleCanOwnRepositoryCommit", source)
        self.assertIn(
            'if (agent !== "general" && !loomAgents.has(agent)) return false',
            source,
        )
        self.assertIn("committableWriteScope(effectiveWrite)", source)
        self.assertIn("commitAuthorized: committableWrite.length > 0", source)

    def test_scope_elevation_reports_commit_authority_from_effective_scope(self):
        source = (ROOT / "plugins/loom/index.ts").read_text()
        self.assertIn("grantedProjectPaths: projectPaths", source)
        self.assertIn(
            "committableWriteScope(\n                          result.scope?.write ?? result.roleWriteDefault",
            source,
        )
        self.assertIn(
            "Any durable project-local write scope, including scope granted by loom_scope_elevate",
            source,
        )
        granted = source.index('status: "granted"')
        next_tool = source.index('name: "scope_authorize_once"', granted)
        granted_block = source[granted:next_tool]
        self.assertIn("commitAuthorized:", granted_block)
        self.assertIn("committableWrite:", granted_block)


class OpenCodeVersionContractTests(unittest.TestCase):
    def test_primary_host_matches_plugin_dependency(self):
        package = json.loads((ROOT / "package.json").read_text())
        plugin_version = package["devDependencies"]["@opencode/plugin"]
        self.assertRegex(plugin_version, r"^\d+\.\d+\.\d+$")

        workflow = (ROOT / ".github/workflows/loom-ci.yml").read_text()
        self.assertIn(
            f"npm install --global @opencode/cli@{plugin_version}",
            workflow,
        )
        self.assertIn(
            f'opencode --version | grep -F "{plugin_version}"',
            workflow,
        )
        self.assertIn(
            f'docker run --rm --entrypoint opencode "$OPENCODE_EVAL_RUNNER_OPENCODE_IMAGE" --version | grep -F "{plugin_version}"',
            workflow,
        )
        self.assertIn(
            f"Verify eval DB sanitizer against a fresh OpenCode {plugin_version} database",
            workflow,
        )


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
            args, kwargs = run.call_args
            self.assertEqual(args, (["bun", "test", "./scripts/a space.test.ts"],))
            self.assertEqual(kwargs["cwd"], root)
            self.assertFalse(kwargs["check"])
            env = kwargs["env"]
            isolation_root = Path(env["LOOM_TEST_ISOLATION_ROOT"])
            self.assertEqual(Path(env["HOME"]), isolation_root / "home")
            self.assertEqual(Path(env["XDG_STATE_HOME"]), isolation_root / "state")
            self.assertEqual(Path(env["XDG_RUNTIME_DIR"]), isolation_root / "runtime")
            self.assertEqual(Path(env["TMPDIR"]), isolation_root / "tmp")
            self.assertNotIn("LOOM_TOOL_OUTPUT", env)
            self.assertFalse((Path(env["XDG_STATE_HOME"]) / "loom" / "runtime-root.json").exists())

    def test_isolated_environment_rejects_a_nonfresh_root(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            (root / "state").mkdir()
            (root / "state/loom").mkdir()
            (root / "state/loom/runtime-root.json").write_text("{}")
            with self.assertRaisesRegex(RuntimeError, "fresh and empty"):
                RUNNER.isolated_test_environment(root)

    def test_normal_entrypoint_uses_discovery(self):
        script = json.loads((ROOT / "package.json").read_text())["scripts"]["test"]
        self.assertIn("python3 scripts/run-unit-tests.py", script)
        self.assertNotIn("bun test ./", script)


if __name__ == "__main__":
    unittest.main()
