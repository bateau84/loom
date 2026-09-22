#!/usr/bin/env python3
from __future__ import annotations

import argparse
import importlib.util
import json
import os
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
            self.assertIn("persist-credentials: false", workflow)
            self.assertIn("bun install --frozen-lockfile", workflow)
        self.assertIn(upload, live)
        self.assertNotIn("actions/checkout@v4", live + ci)
        self.assertNotIn("oven-sh/setup-bun@v2", live + ci)
        self.assertNotIn("actions/upload-artifact@v4", live)
        self.assertNotIn("- run: bun install\n", live + ci)

    def test_live_workflow_and_harness_pin_opencode_2_0_12_runner(self):
        workflow = (
            RUN_EVALS.ROOT / ".github" / "workflows" / "loom-live-evals.yml"
        ).read_text(encoding="utf-8")
        expected_action = "bateau84/opencode-eval-runner@e2022f1075e34fe7be2a33eae3c9460f3f5c7263"
        expected_image = (
            "ghcr.io/bateau84/opencode-eval-runner@"
            "sha256:3e5f95ce54fee127230c5bf84a7f09124a2236dfca544269e6547c8f79e8ad5d"
        )

        self.assertIn(expected_action, workflow)
        self.assertIn(expected_image, workflow)
        self.assertEqual(RUN_EVALS.DEFAULT_IMAGES["opencode"], expected_image)

    def test_live_workflow_forwards_opencode_api_key_explicitly(self):
        workflow = (
            RUN_EVALS.ROOT / ".github" / "workflows" / "loom-live-evals.yml"
        ).read_text(encoding="utf-8")

        self.assertIn("OPENCODE_API_KEY: ${{ secrets.OPENCODE_API_KEY }}", workflow)
        self.assertIn('args+=(--env OPENCODE_API_KEY)', workflow)


class RuntimeEvalProjectTests(unittest.TestCase):
    def test_runtime_project_keeps_loom_out_of_project_plugin_config(self):
        case = next(
            case
            for case in RUN_EVALS.load_cases()
            if case["id"] == "SKILL-REPORT-KEEP-02"
        )
        temp, target, _ = RUN_EVALS.setup_projects(case)
        try:
            config = json.loads((target / "opencode.json").read_text(encoding="utf-8"))
            self.assertNotIn("plugins", config)
            self.assertFalse((target / ".opencode" / "plugins" / "loom").exists())
            self.assertFalse((target / ".opencode" / "plugins" / "loom.ts").exists())
        finally:
            import shutil
            shutil.rmtree(temp, ignore_errors=True)

    def test_runtime_project_materializes_real_loom_subagents(self):
        case = next(
            case
            for case in RUN_EVALS.load_cases()
            if case["id"] == "PROP-RUNTIME-01"
        )
        temp, target, _ = RUN_EVALS.setup_projects(case)
        try:
            agent_root = target / ".opencode" / "agents"
            expected = {
                path.name
                for path in (RUN_EVALS.ROOT / "agents").glob("*.md")
            }
            observed = {
                path.name
                for path in agent_root.glob("*.md")
            }
            self.assertEqual(observed, expected)
            self.assertTrue((agent_root / "diagnostic.md").is_file())
            self.assertTrue((agent_root / "reviewer.md").is_file())
            diagnostic = (agent_root / "diagnostic.md").read_text(encoding="utf-8")
            reviewer = (agent_root / "reviewer.md").read_text(encoding="utf-8")
            self.assertIn("mode: subagent", diagnostic)
            self.assertIn("mode: subagent", reviewer)
        finally:
            import shutil
            shutil.rmtree(temp, ignore_errors=True)

    def test_tracked_401_runtime_materializes_diagnostic_fixture(self):
        case = next(
            case
            for case in RUN_EVALS.load_cases()
            if case["id"] == "PROP-RUNTIME-01"
        )
        temp, target, _ = RUN_EVALS.setup_projects(case)
        try:
            frontend = (target / "frontend" / "src" / "api" / "client.ts").read_text(encoding="utf-8")
            backend = (target / "backend" / "src" / "auth.ts").read_text(encoding="utf-8")
            self.assertIn('"X-Access-Token": token', frontend)
            self.assertIn('headers["authorization"]', backend)
            self.assertIn('startsWith("Bearer ")', backend)
        finally:
            import shutil
            shutil.rmtree(temp, ignore_errors=True)

    def test_role_decision_project_keeps_unrelated_agents_out(self):
        case = next(
            case
            for case in RUN_EVALS.load_cases()
            if case["id"] == "PROP-02"
        )
        temp, target, _ = RUN_EVALS.setup_projects(case)
        try:
            observed = sorted(
                path.name
                for path in (target / ".opencode" / "agents").glob("*.md")
            )
            self.assertEqual(observed, ["general.md"])
        finally:
            import shutil
            shutil.rmtree(temp, ignore_errors=True)

    def test_all_runtime_eval_targets_are_rw(self):
        promoting = next(
            case
            for case in RUN_EVALS.load_cases()
            if case["id"] == "SKILL-REPORT-KEEP-02"
        )
        ordinary = next(
            case
            for case in RUN_EVALS.load_cases()
            if case["id"] == "SKILL-REPORT-KEEP-01"
        )

        self.assertEqual(RUN_EVALS.case_workspace_mode(promoting), "rw")
        self.assertEqual(RUN_EVALS.case_workspace_mode(ordinary), "rw")
        self.assertEqual(
            RUN_EVALS.case_workspace_mode({"execution": "role-decision"}),
            "ro",
        )


class MountPreparationTests(unittest.TestCase):
    def test_runtime_mountpoint_exists_before_workspace_mount(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            project = root / "project"
            source = root / "node_modules"
            project.mkdir()
            source.mkdir()

            resolved = RUN_EVALS.prepare_node_modules_mount(project, source)

            self.assertEqual(resolved, source)
            self.assertTrue((project / "node_modules").is_dir())



class EvalConcurrencyTests(unittest.TestCase):
    def test_parallel_does_not_parallelize_runtime_cases_by_default(self):
        jobs = [
            ({"id": "R1", "execution": "runtime"}, 1),
            ({"id": "R1", "execution": "runtime"}, 2),
            ({"id": "R1", "execution": "runtime"}, 3),
        ]

        non_runtime, non_runtime_limit, runtime, runtime_limit, mode = (
            RUN_EVALS.eval_job_concurrency(jobs, parallel=3, runtime_parallel=1)
        )

        self.assertEqual(non_runtime, [])
        self.assertEqual(non_runtime_limit, 0)
        self.assertEqual(len(runtime), 3)
        self.assertEqual(runtime_limit, 1)
        self.assertEqual(mode, "runtime=sequential")

    def test_runtime_parallel_explicitly_enables_stress_mode(self):
        jobs = [
            ({"id": "R1", "execution": "runtime"}, 1),
            ({"id": "R1", "execution": "runtime"}, 2),
            ({"id": "R1", "execution": "runtime"}, 3),
        ]

        _, _, _, runtime_limit, mode = RUN_EVALS.eval_job_concurrency(
            jobs,
            parallel=3,
            runtime_parallel=3,
        )

        self.assertEqual(runtime_limit, 3)
        self.assertEqual(mode, "runtime=parallel:3 (stress)")

    def test_non_runtime_jobs_still_use_parallel_limit(self):
        jobs = [
            ({"id": "A", "execution": "role-decision"}, 1),
            ({"id": "B", "execution": "role-decision"}, 1),
            ({"id": "R", "execution": "runtime"}, 1),
        ]

        non_runtime, non_runtime_limit, runtime, runtime_limit, mode = (
            RUN_EVALS.eval_job_concurrency(jobs, parallel=2, runtime_parallel=1)
        )

        self.assertEqual(len(non_runtime), 2)
        self.assertEqual(non_runtime_limit, 2)
        self.assertEqual(len(runtime), 1)
        self.assertEqual(runtime_limit, 1)
        self.assertEqual(mode, "non-runtime=parallel:2, runtime=sequential")


class CentralEvalDiscoveryTests(unittest.TestCase):
    def test_discovers_every_json_suite_in_eval_directory(self):
        with tempfile.TemporaryDirectory() as tmp:
            evals = Path(tmp) / "evals"
            evals.mkdir()
            (evals / "z-new-suite.json").write_text('{"version":1,"name":"z","cases":[]}', encoding="utf-8")
            (evals / "a-existing-suite.json").write_text('{"version":1,"name":"a","cases":[]}', encoding="utf-8")
            (evals / "README.md").write_text("not a suite", encoding="utf-8")
            (evals / "ignored.txt").write_text("{}", encoding="utf-8")

            discovered = RUN_EVALS.behavioral_eval_files(evals)

            self.assertEqual(
                [path.name for path in discovered],
                ["a-existing-suite.json", "z-new-suite.json"],
            )

    def test_repository_default_discovery_includes_proportionality_suite(self):
        discovered = RUN_EVALS.behavioral_eval_files(RUN_EVALS.ROOT / "evals")
        self.assertIn("proportionality.json", [path.name for path in discovered])

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
            self.assertFalse((candidate_skill / "evals").exists())
            self.assertFalse((candidate_skill / "ASSESSMENT.md").exists())
            self.assertFalse((candidate_skill / "QA.md").exists())
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

    def test_semantic_pass_is_derived_from_evidence_not_reported_boolean(self):
        case = {
            "expectations": ["does A"],
            "must_not": ["must not B"],
            "trap": "bad trap",
            "_skill_owned": True,
            "_skill_trap_declared": True,
        }
        good = {
            "passed": False,
            "expectations": [{"expectation": "does A", "met": True, "reason": "yes"}],
            "violations": [{"rule": "must not B", "violated": False, "reason": "safe"}],
            "trap_observed": False,
            "trap_evidence": "not observed",
        }
        self.assertTrue(RUN_EVALS.semantic_pass(case, good))

        bad_expectation = dict(good)
        bad_expectation["passed"] = True
        bad_expectation["expectations"] = [
            {"expectation": "does A", "met": False, "reason": "missing"}
        ]
        self.assertFalse(RUN_EVALS.semantic_pass(case, bad_expectation))

        bad_trap = dict(good)
        bad_trap["passed"] = True
        bad_trap["trap_observed"] = True
        self.assertFalse(RUN_EVALS.semantic_pass(case, bad_trap))

    def test_judge_contract_rejects_missing_or_extra_results(self):
        case = {
            "expectations": ["a", "b"],
            "must_not": ["c"],
        }
        too_few = {
            "expectations": [{"met": True}],
            "violations": [{"violated": False}],
        }
        self.assertRegex(
            RUN_EVALS.judge_contract_error(case, too_few) or "",
            r"expected 2",
        )

        extra_violation = {
            "expectations": [{"met": True}, {"met": True}],
            "violations": [{"violated": False}, {"violated": False}],
        }
        self.assertRegex(
            RUN_EVALS.judge_contract_error(case, extra_violation) or "",
            r"expected 1",
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



class EvidenceRedactionTests(unittest.TestCase):
    def test_redacts_environment_auth_and_database_credentials(self):
        env_secret = "sk-env-secret-123456"
        auth_secret = "auth-access-secret-234567"
        key_secret = "auth-key-secret-456789"
        db_secret = "db-refresh-secret-345678"

        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            auth = root / "auth.json"
            auth.write_text(
                json.dumps({
                    "openai": {
                        "type": "oauth",
                        "access": auth_secret,
                        "key": key_secret,
                    }
                }),
                encoding="utf-8",
            )
            database = root / "opencode.db"
            import sqlite3
            with sqlite3.connect(database) as db:
                db.execute("CREATE TABLE credential (provider TEXT, data TEXT)")
                db.execute(
                    "INSERT INTO credential(provider, data) VALUES (?, ?)",
                    ("openai", json.dumps({"refresh": db_secret})),
                )
                db.commit()

            secrets = RUN_EVALS.collect_sensitive_values(
                {"OPENAI_API_KEY": env_secret},
                [],
                auth,
                None,
                None,
                database,
            )

        self.assertIn(env_secret, secrets)
        self.assertIn(auth_secret, secrets)
        self.assertIn(key_secret, secrets)
        self.assertIn(db_secret, secrets)

        result = {
            "text": f"{env_secret} {auth_secret} {key_secret}",
            "actions": [{"tool": "bash", "args": {"value": db_secret}}],
            "stdout": f"raw {env_secret} {db_secret}",
        }
        redacted = RUN_EVALS.redact_sensitive_values(result, secrets)
        encoded = json.dumps(redacted)
        self.assertNotIn(env_secret, encoded)
        self.assertNotIn(auth_secret, encoded)
        self.assertNotIn(key_secret, encoded)
        self.assertNotIn(db_secret, encoded)
        self.assertIn("***REDACTED***", encoded)

    def test_does_not_treat_short_or_non_secret_metadata_as_credentials(self):
        secrets = RUN_EVALS.collect_sensitive_values(
            {
                "OPENAI_API_KEY": "short",
                "MODEL_NAME": "openai/gpt-5.5",
            },
            [],
            None,
            None,
            None,
            None,
        )
        self.assertEqual(secrets, [])


    def test_invoke_container_redacts_secret_before_returning_result(self):
        secret = "sk-live-secret-abcdef123456"

        class Result:
            returncode = 0
            stdout = ""
            stderr = ""

        def fake_run(command, **kwargs):
            output = Path(command[command.index("--output") + 1])
            output.write_text(
                json.dumps({
                    "exit_code": 0,
                    "text": "leaked " + secret,
                    "tools": [],
                    "actions": [{"tool": "bash", "args": {"value": secret}}],
                    "skills_loaded": [],
                    "stdout": "raw " + secret,
                    "stderr": "",
                }),
                encoding="utf-8",
            )
            return Result()

        with tempfile.TemporaryDirectory() as tmp, patch.dict(
            os.environ,
            {"OPENAI_API_KEY": secret},
            clear=False,
        ):
            project = Path(tmp)
            with patch.object(
                RUN_EVALS.shutil,
                "which",
                side_effect=lambda name: "/usr/bin/opencode-eval-runner" if name == "opencode-eval-runner" else None,
            ), patch.object(RUN_EVALS.subprocess, "run", side_effect=fake_run):
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
                    workspace_mode="ro",
                    extra_envs=[],
                )

        encoded = json.dumps(result)
        self.assertNotIn(secret, encoded)
        self.assertIn("***REDACTED***", encoded)


    def test_invoke_container_redacts_secret_on_runner_failure_path(self):
        secret = "sk-failure-secret-abcdef123456"

        class Result:
            returncode = 2
            stdout = "runner leaked " + secret
            stderr = "failure " + secret

        with tempfile.TemporaryDirectory() as tmp, patch.dict(
            os.environ,
            {"OPENAI_API_KEY": secret},
            clear=False,
        ):
            project = Path(tmp)
            with patch.object(
                RUN_EVALS.shutil,
                "which",
                side_effect=lambda name: "/usr/bin/opencode-eval-runner" if name == "opencode-eval-runner" else None,
            ), patch.object(RUN_EVALS.subprocess, "run", return_value=Result()):
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
                    workspace_mode="ro",
                    extra_envs=[],
                )

        encoded = json.dumps(result)
        self.assertNotIn(secret, encoded)
        self.assertIn("***REDACTED***", encoded)
        self.assertTrue(result["infrastructure_error"])


class TransportDiagnosticTests(unittest.TestCase):
    def test_transport_error_prefers_terminal_json_error_event(self):
        stdout = "\n".join([
            json.dumps({"type": "step_start", "timestamp": 1}),
            json.dumps({
                "type": "error",
                "error": {
                    "type": "provider.auth",
                    "message": "token expired",
                    "status": 401,
                },
            }),
        ])
        result = {
            "exit_code": 1,
            "stderr": "",
            "stdout": stdout,
            "text": "",
        }

        self.assertEqual(
            RUN_EVALS.transport_error(result),
            "transport exited 1: provider.auth: token expired (status=401)",
        )

    def test_transport_error_uses_tail_when_no_structured_error_exists(self):
        result = {
            "exit_code": 1,
            "stderr": "",
            "stdout": "first\nsecond\nlast failure detail",
            "text": "",
        }

        self.assertTrue(
            RUN_EVALS.transport_error(result).endswith("first | second | last failure detail")
        )


class ActionAssertionTests(unittest.TestCase):
    def test_invoke_container_forwards_explicit_network_mode(self):
        class Result:
            returncode = 0
            stdout = '{"exit_code":0,"text":"ok","tools":[],"actions":[]}'
            stderr = ""

        with tempfile.TemporaryDirectory() as tmp:
            project = Path(tmp)
            with patch.object(RUN_EVALS.shutil, "which", return_value=None), \
                 patch.object(RUN_EVALS.subprocess, "run", return_value=Result()) as run:
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
                    workspace_mode="ro",
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
            with patch.object(RUN_EVALS.shutil, "which", return_value=None), \
                 patch.object(RUN_EVALS.subprocess, "run", return_value=Result()) as run:
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
                    workspace_mode="ro",
                    extra_envs=[],
                    network=None,
                )

        self.assertNotIn("--network", run.call_args.args[0])

    def test_eval_runner_cli_forwards_expected_plugin_preflight(self):
        class Result:
            returncode = 0
            stdout = ""
            stderr = ""

        seen: list[str] = []

        def fake_run(command, **kwargs):
            seen.extend(command)
            output = Path(command[command.index("--output") + 1])
            output.write_text(
                json.dumps({
                    "exit_code": 0,
                    "text": "ok",
                    "tools": ["loom_status"],
                    "actions": [],
                    "skills_loaded": [],
                }),
                encoding="utf-8",
            )
            return Result()

        with tempfile.TemporaryDirectory() as tmp:
            project = Path(tmp)
            config_root = project / "config-root"
            config_root.mkdir()
            with patch.object(
                RUN_EVALS.shutil,
                "which",
                side_effect=lambda name: "/usr/bin/opencode-eval-runner" if name == "opencode-eval-runner" else None,
            ), patch.object(RUN_EVALS.subprocess, "run", side_effect=fake_run):
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
                    config_root=config_root,
                    expected_plugin="loom",
                    timeout=30,
                    container_timeout=60,
                    mount_node_modules=False,
                    workspace_mode="ro",
                    extra_envs=[],
                    network="host",
                )

        self.assertEqual(result["exit_code"], 0)
        self.assertIn("--expected-plugin", seen)
        self.assertEqual(seen[seen.index("--expected-plugin") + 1], "loom")

    def test_eval_runner_cli_receives_explicit_network_mode(self):
        class Result:
            returncode = 0
            stdout = ""
            stderr = ""

        seen: list[str] = []

        def fake_run(command, **kwargs):
            seen.extend(command)
            output = Path(command[command.index("--output") + 1])
            output.write_text(
                json.dumps({
                    "exit_code": 0,
                    "text": "ok",
                    "tools": [],
                    "actions": [],
                    "skills_loaded": [],
                }),
                encoding="utf-8",
            )
            return Result()

        with tempfile.TemporaryDirectory() as tmp:
            project = Path(tmp)
            with patch.object(
                RUN_EVALS.shutil,
                "which",
                side_effect=lambda name: "/usr/bin/opencode-eval-runner" if name == "opencode-eval-runner" else None,
            ), patch.object(RUN_EVALS.subprocess, "run", side_effect=fake_run):
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
                    workspace_mode="ro",
                    extra_envs=[],
                    network="host",
                )

        self.assertEqual(result["exit_code"], 0)
        self.assertEqual(seen[0], "/usr/bin/opencode-eval-runner")
        self.assertIn("--network", seen)
        self.assertEqual(seen[seen.index("--network") + 1], "host")

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

    def test_matches_contains_action_arguments(self):
        actions = [
            {
                "tool": "execute",
                "args": {
                    "code": 'return await tools.browser.preview({ path: "/tmp/status.html" })'
                },
            },
        ]
        case = {
            "actions": {
                "requires": [
                    {
                        "tool": "execute",
                        "arg": "code",
                        "contains": "tools.browser.preview",
                    }
                ]
            }
        }
        self.assertEqual(
            RUN_EVALS.deterministic_failures(case, ["execute"], actions),
            [],
        )

    def test_grades_required_and_forbidden_output_text(self):
        case = {
            "output": {
                "contains": ["http://127.0.0.1:4318/status/"],
                "forbids": ["OpenCode Desktop is required"],
            }
        }
        self.assertEqual(
            RUN_EVALS.deterministic_failures(
                case,
                [],
                text="Open: http://127.0.0.1:4318/status/install/project/workflow.html",
            ),
            [],
        )
        self.assertEqual(
            RUN_EVALS.deterministic_failures(case, [], text="No link"),
            ["required output text not observed: 'http://127.0.0.1:4318/status/'"],
        )

    def test_accepts_tool_only_and_any_of_action_assertions(self):
        native_actions = [
            {"tool": "loom_start", "args": {"anchor": "docs/anchors/status-preview/anchor.md"}},
            {"tool": "loom_status", "args": {"workflowId": "wf-1"}},
        ]
        code_actions = [
            {
                "tool": "execute",
                "args": {"code": "return await tools.loom.code.start({ anchor: 'docs/anchors/status-preview/anchor.md' })"},
            },
            {
                "tool": "execute",
                "args": {"code": "return await tools.loom.code.status({ workflowId: 'wf-1' })"},
            },
        ]
        case = {
            "actions": {
                "any_of": [
                    [
                        {"tool": "loom_start"},
                        {"tool": "execute", "arg": "code", "contains": "tools.loom.code.start"},
                    ],
                    [
                        {"tool": "loom_status"},
                        {"tool": "execute", "arg": "code", "contains": "tools.loom.code.status"},
                    ],
                ],
                "forbids": [
                    {"tool": "execute", "arg": "code", "contains": "tools.browser.preview"},
                ],
            }
        }
        self.assertEqual(
            RUN_EVALS.deterministic_failures(case, ["loom_start", "loom_status"], native_actions),
            [],
        )
        self.assertEqual(
            RUN_EVALS.deterministic_failures(case, ["execute"], code_actions),
            [],
        )

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
