#!/usr/bin/env python3
from __future__ import annotations

import argparse
import importlib.util
import json
from io import StringIO
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

MODULE_PATH = Path(__file__).resolve().parent / "run-evals.py"
SPEC = importlib.util.spec_from_file_location("loom_run_evals", MODULE_PATH)
assert SPEC and SPEC.loader
RUN_EVALS = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(RUN_EVALS)


class WorkflowCredentialTests(unittest.TestCase):
    def test_live_workflow_uploads_hidden_eval_artifacts(self):
        workflow = (
            RUN_EVALS.ROOT / ".github" / "workflows" / "loom-live-evals.yml"
        ).read_text(encoding="utf-8")

        self.assertIn("path: .loom-evals/", workflow)
        self.assertIn("include-hidden-files: true", workflow)

    def test_live_workflow_scopes_provider_secrets_to_eval_step(self):
        workflow = (
            RUN_EVALS.ROOT / ".github" / "workflows" / "loom-live-evals.yml"
        ).read_text(encoding="utf-8")

        job_prefix = workflow.split("    steps:", 1)[0]
        self.assertNotIn("OPENAI_API_KEY:", job_prefix)
        self.assertNotIn("ANTHROPIC_API_KEY:", job_prefix)
        self.assertNotIn("OPENROUTER_API_KEY:", job_prefix)
        self.assertNotIn("OPENCODE_API_KEY:", job_prefix)

        eval_block = workflow.split("- name: Run isolated live evals", 1)[1]
        self.assertIn("OPENCODE_API_KEY: ${{ secrets.OPENCODE_API_KEY }}", eval_block)

    def test_modified_workflows_pin_reusable_actions_by_commit(self):
        checkout = "actions/checkout@11d5960a326750d5838078e36cf38b85af677262"
        setup_bun = "oven-sh/setup-bun@0c5077e51419868618aeaa5fe8019c62421857d6"
        upload = "actions/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02"

        live = (
            RUN_EVALS.ROOT / ".github" / "workflows" / "loom-live-evals.yml"
        ).read_text(encoding="utf-8")
        ci = (
            RUN_EVALS.ROOT / ".github" / "workflows" / "loom-ci.yml"
        ).read_text(encoding="utf-8")

        for workflow in (live, ci):
            self.assertIn(checkout, workflow)
            self.assertIn(setup_bun, workflow)
        self.assertIn(upload, live)
        self.assertNotIn("actions/checkout@v4", live + ci)
        self.assertNotIn("oven-sh/setup-bun@v2", live + ci)
        self.assertNotIn("actions/upload-artifact@v4", live)

    def test_live_workflow_forwards_opencode_api_key_explicitly(self):
        workflow = (
            RUN_EVALS.ROOT / ".github" / "workflows" / "loom-live-evals.yml"
        ).read_text(encoding="utf-8")

        self.assertIn("OPENCODE_API_KEY: ${{ secrets.OPENCODE_API_KEY }}", workflow)
        self.assertIn('args+=(--env OPENCODE_API_KEY)', workflow)


class MountPreparationTests(unittest.TestCase):
    def test_runtime_mountpoint_exists_before_read_only_workspace_mount(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            project = root / "project"
            source = root / "node_modules"
            project.mkdir()
            source.mkdir()

            resolved = RUN_EVALS.prepare_node_modules_mount(project, source)

            self.assertEqual(resolved, source)
            self.assertTrue((project / "node_modules").is_dir())



class SkillOwnedEvalDiscoveryTests(unittest.TestCase):
    def test_discovers_every_json_filename_inside_skill_evals_folder(self):
        with tempfile.TemporaryDirectory() as tmp:
            skills = Path(tmp) / "skills"
            eval_dir = skills / "demo-skill" / "evals"
            eval_dir.mkdir(parents=True)
            (eval_dir / "anything.json").write_text(
                json.dumps({
                    "skill": "demo-skill",
                    "cases": [{
                        "id": "A",
                        "prompt": "do A",
                        "trap": "miss A",
                        "expectations": ["does A"],
                        "negative_expectations": ["does not do B"],
                    }],
                }),
                encoding="utf-8",
            )
            (eval_dir / "another-name.json").write_text(
                json.dumps({
                    "skill_name": "demo-skill",
                    "evals": [{
                        "id": 2,
                        "prompt": "do C",
                        "trap": "miss C",
                        "expectations": ["does C"],
                    }],
                }),
                encoding="utf-8",
            )
            (eval_dir / "third.json").write_text(
                json.dumps([{
                    "id": "three",
                    "prompt": "do D",
                    "expectations": ["does D"],
                }]),
                encoding="utf-8",
            )
            (eval_dir / "ignored.txt").write_text("not an eval", encoding="utf-8")

            files = RUN_EVALS.skill_eval_files(skills)
            cases = RUN_EVALS.load_skill_owned_cases(skills)

            self.assertEqual(
                [path.name for path in files],
                ["another-name.json", "anything.json", "third.json"],
            )
            self.assertEqual(len(cases), 3)
            self.assertTrue(all(case["skill"] == "demo-skill" for case in cases))
            self.assertTrue(all(case["agent"] == RUN_EVALS.SKILL_EVAL_AGENT for case in cases))
            self.assertTrue(all(case["_skill_owned"] is True for case in cases))
            self.assertEqual(
                {case["id"] for case in cases},
                {"SKILL-demo-skill-A", "SKILL-demo-skill-2", "SKILL-demo-skill-three"},
            )

    def test_existing_web_ui_design_suite_is_discovered(self):
        cases = RUN_EVALS.load_skill_owned_cases(RUN_EVALS.ROOT / "skills")
        web_cases = [case for case in cases if case["skill"] == "web-ui-design"]

        self.assertEqual(len(web_cases), 4)
        self.assertEqual(
            {case["_skill_eval_source_id"] for case in web_cases},
            {"Web-01", "Web-02", "Web-03", "Web-04"},
        )
        self.assertTrue(all(case["execution"] == "runtime" for case in web_cases))
        self.assertTrue(all(case.get("_skill_owned") is True for case in web_cases))
        self.assertTrue(all("tools" not in case for case in web_cases))

    def test_skill_owned_case_without_trap_does_not_invent_one_from_description(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "skills" / "demo-skill" / "evals" / "case.json"
            path.parent.mkdir(parents=True)
            raw = {
                "id": 1,
                "name": "demo",
                "description": "Descriptive metadata, not a failure trap.",
                "prompt": "Do the thing.",
                "expectations": ["Does the thing."],
            }

            case = RUN_EVALS.normalize_skill_eval_case("demo-skill", raw, path, 0)

        self.assertEqual(case["trap"], "")
        self.assertFalse(case["_skill_trap_declared"])

    def test_skill_owned_case_exposes_local_id_and_name_selectors(self):
        case = {
            "id": "SKILL-web-ui-design-Web-01",
            "skill": "web-ui-design",
            "_skill_owned": True,
            "_skill_eval_source_id": "Web-01",
            "_skill_eval_name": "spa-back-button-and-url-design",
        }

        self.assertEqual(
            RUN_EVALS.case_selectors(case),
            {
                "SKILL-web-ui-design-Web-01",
                "Web-01",
                "spa-back-button-and-url-design",
            },
        )

    def test_skill_ablation_isolates_baseline_from_candidate_skill(self):
        case = next(
            case
            for case in RUN_EVALS.load_skill_owned_cases(RUN_EVALS.ROOT / "skills")
            if case["skill"] == "web-ui-design"
        )

        temp, baseline_project, candidate_project, _ = RUN_EVALS.setup_skill_ablation_projects(case)
        try:
            baseline_skill = baseline_project / ".opencode" / "skills" / "web-ui-design"
            candidate_skill = candidate_project / ".opencode" / "skills" / "web-ui-design"
            baseline_agent = (
                baseline_project
                / ".opencode"
                / "agents"
                / f"{RUN_EVALS.SKILL_BASELINE_AGENT}.md"
            ).read_text(encoding="utf-8")
            candidate_agent = (
                candidate_project
                / ".opencode"
                / "agents"
                / f"{RUN_EVALS.SKILL_EVAL_AGENT}.md"
            ).read_text(encoding="utf-8")

            self.assertFalse(baseline_skill.exists())
            self.assertTrue((candidate_skill / "SKILL.md").is_file())
            self.assertEqual(
                [path.name for path in (candidate_project / ".opencode" / "skills").iterdir()],
                ["web-ui-design"],
            )
            self.assertIn("normal model capability", baseline_agent)
            self.assertIn("Load the native skill `web-ui-design` before answering", candidate_agent)
        finally:
            import shutil
            shutil.rmtree(temp, ignore_errors=True)

    def test_semantic_behavior_score_counts_positive_negative_and_trap(self):
        grade = {
            "expectations": [
                {"expectation": "a", "met": True, "reason": "yes"},
                {"expectation": "b", "met": False, "reason": "no"},
            ],
            "violations": [
                {"rule": "c", "violated": False, "reason": "safe"},
            ],
            "trap_observed": False,
            "trap_evidence": "not present",
            "passed": False,
        }

        self.assertEqual(
            RUN_EVALS.semantic_behavior_score(grade, trap_declared=True),
            0.75,
        )

    def test_skill_value_distinguishes_improvement_and_regression(self):
        self.assertEqual(
            RUN_EVALS.classify_skill_value(25.0, trap_fixed=False, trap_regression=False),
            "material-improvement",
        )
        self.assertEqual(
            RUN_EVALS.classify_skill_value(4.0, trap_fixed=False, trap_regression=False),
            "improvement",
        )
        self.assertEqual(
            RUN_EVALS.classify_skill_value(0.0, trap_fixed=True, trap_regression=False),
            "material-improvement",
        )
        self.assertEqual(
            RUN_EVALS.classify_skill_value(20.0, trap_fixed=False, trap_regression=True),
            "regression",
        )

    def test_judge_schema_requires_explicit_trap_grade(self):
        good = {
            "passed": True,
            "expectations": [],
            "violations": [],
            "trap_observed": False,
            "trap_evidence": "not observed",
            "summary": "ok",
        }
        self.assertEqual(RUN_EVALS.parse_judge(json.dumps(good)), good)

        bad = dict(good)
        bad.pop("trap_observed")
        with self.assertRaisesRegex(ValueError, "trap_observed"):
            RUN_EVALS.parse_judge(json.dumps(bad))



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

    def test_skill_target_requires_confirmed_loaded_skill(self):
        actions = [
            {"tool": "skill", "args": {"id": "golang-concurrency"}},
        ]
        case = {
            "skill": "golang-concurrency",
            "actions": {
                "requires": [
                    {"tool": "skill", "arg": "name", "equals": "golang-concurrency"}
                ]
            },
        }

        failures = RUN_EVALS.deterministic_failures(
            case,
            ["skill"],
            actions,
            [],
        )

        self.assertEqual(
            failures,
            ["skill under test not confirmed loaded: golang-concurrency"],
        )

    def test_skill_owned_copilot_case_does_not_require_native_load(self):
        case = {
            "skill": "web-ui-design",
            "_skill_owned": True,
        }

        failures = RUN_EVALS.deterministic_failures(
            case,
            [],
            [],
            [],
            require_native_skill_load=False,
        )

        self.assertEqual(failures, [])

    def test_skill_target_accepts_confirmed_loaded_skill(self):
        actions = [
            {"tool": "skill", "args": {"id": "golang-concurrency"}},
        ]
        case = {
            "skill": "golang-concurrency",
            "actions": {
                "requires": [
                    {"tool": "skill", "arg": "name", "equals": "golang-concurrency"}
                ]
            },
        }

        failures = RUN_EVALS.deterministic_failures(
            case,
            ["skill"],
            actions,
            ["golang-concurrency"],
        )

        self.assertEqual(failures, [])

    def test_run_case_reports_phase_progress_and_records_timings(self):
        case = {
            "id": "TIMING-01",
            "agent": "general",
            "execution": "role-decision",
            "requirements": ["BR-001"],
            "prompt": "Act.",
            "trap": "none",
            "expectations": ["Acts."],
            "must_not": ["Must not stall."],
        }
        args = argparse.Namespace(
            iterations=1,
            target_transport="opencode",
            judge_transport="opencode",
            judge_model=None,
            model="openai/test",
            auth=None,
            provider_config=None,
            models_catalog=None,
            database=None,
            timeout_seconds=30,
            container_timeout=60,
            env=[],
            network=None,
            image=None,
            opencode_image=None,
            copilot_image=None,
            artifact_dir="unused",
            keep_temp=False,
        )

        target = {
            "exit_code": 0,
            "text": "Act now.",
            "tools": [],
            "actions": [],
            "skills_loaded": [],
            "stdout": "",
        }
        judge = {
            "exit_code": 0,
            "text": json.dumps(
                {
                    "passed": True,
                    "expectations": [{"expectation": "Acts.", "met": True, "reason": "done"}],
                    "violations": [{"rule": "Must not stall.", "violated": False, "reason": "not stalled"}],
                    "trap_observed": False,
                    "trap_evidence": "not observed",
                    "summary": "pass",
                }
            ),
            "tools": [],
            "actions": [],
            "stdout": "",
        }

        with tempfile.TemporaryDirectory() as tmp:
            target_project = Path(tmp) / "target"
            judge_project = Path(tmp) / "judge"
            target_project.mkdir()
            judge_project.mkdir()
            artifact_dir = Path(tmp) / "artifacts"
            args.artifact_dir = str(artifact_dir)

            with patch.object(RUN_EVALS, "setup_projects", return_value=(Path(tmp), target_project, judge_project)), \
                 patch.object(RUN_EVALS, "resolve_optional_file", return_value=None), \
                 patch.object(RUN_EVALS, "image_for_transport", return_value="test-image"), \
                 patch.object(RUN_EVALS, "invoke_container", side_effect=[target, judge]), \
                 patch.object(RUN_EVALS.time, "perf_counter", side_effect=[0.0, 1.0, 3.5, 4.0, 7.25, 8.0]), \
                 patch("sys.stdout", new_callable=StringIO) as stdout:
                result = RUN_EVALS.run_case(case, args, "podman")

            output = stdout.getvalue()
            self.assertIn("TIMING-01 [general/role-decision] target (opencode, openai/test) ...", output)
            self.assertIn("TIMING-01 target done in 2.5s", output)
            self.assertIn("TIMING-01 judge (opencode, openai/test) ...", output)
            self.assertIn("TIMING-01 judge done in 3.2s", output)
            self.assertEqual(result["timing"]["target_seconds"], 2.5)
            self.assertEqual(result["timing"]["judge_seconds"], 3.25)
            self.assertEqual(result["timing"]["total_seconds"], 8.0)

    def test_semantic_judge_receives_observed_action_arguments(self):
        case = {
            "id": "GENERAL-BUDGET-01",
            "agent": "general",
            "execution": "runtime",
            "trap": "miss the evidence reference",
            "expectations": ["Records the supplied evidence reference."],
            "must_not": ["Must not omit the evidence reference."],
        }
        actions = [
            {
                "tool": "loom_budget_grant",
                "args": {
                    "workflowId": "wf-budget-recovery",
                    "stepId": "critic-solution",
                    "evidence": ["docs/architecture/solution.md#dependency-registration"],
                },
            }
        ]

        prompt = RUN_EVALS.judge_prompt(
            case,
            "Grant attempted.",
            ["loom_budget_grant"],
            actions,
        )

        self.assertIn("OBSERVED TOOL ACTIONS:", prompt)
        self.assertIn("docs/architecture/solution.md#dependency-registration", prompt)
        self.assertIn('"stepId": "critic-solution"', prompt)

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
