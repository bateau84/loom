#!/usr/bin/env python3
from __future__ import annotations

import argparse
from concurrent.futures import ThreadPoolExecutor
import importlib.util
import json
import os
from io import StringIO
from pathlib import Path
import tempfile
import threading
import unittest
from unittest.mock import patch

MODULE_PATH = Path(__file__).resolve().parent / "run-evals-legacy.py"
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

    def test_live_workflow_exposes_reasoning_controls(self):
        workflow = (
            RUN_EVALS.ROOT / ".github" / "workflows" / "loom-live-evals.yml"
        ).read_text(encoding="utf-8")

        self.assertIn("      reasoning:", workflow)
        self.assertIn("      target_reasoning:", workflow)
        self.assertIn("      judge_reasoning:", workflow)
        self.assertIn('args+=(--reasoning "$EVAL_REASONING")', workflow)
        self.assertIn('args+=(--target-reasoning "$TARGET_REASONING")', workflow)
        self.assertIn('args+=(--judge-reasoning "$JUDGE_REASONING")', workflow)

    def test_opencode_host_and_plugin_api_share_compat_version(self):
        workflow = (
            RUN_EVALS.ROOT / ".github" / "workflows" / "loom-ci.yml"
        ).read_text(encoding="utf-8")
        package = json.loads((RUN_EVALS.ROOT / "package.json").read_text(encoding="utf-8"))
        plugin_version = package["devDependencies"]["@opencode/plugin"]
        install_prefix = "npm install --global @opencode/cli@"
        install_line = next(
            line.strip()
            for line in workflow.splitlines()
            if install_prefix in line
        )
        host_version = install_line.split(install_prefix, 1)[1].strip()
        self.assertEqual(host_version, plugin_version)

    def test_workflows_and_harness_pin_immutable_runner(self):
        live = (
            RUN_EVALS.ROOT / ".github" / "workflows" / "loom-live-evals.yml"
        ).read_text(encoding="utf-8")
        ci = (
            RUN_EVALS.ROOT / ".github" / "workflows" / "loom-ci.yml"
        ).read_text(encoding="utf-8")
        expected_action = "bateau84/opencode-eval-runner@a7efd0b96ec650f9a972b53830722e467b61eb36"
        expected_image = (
            "ghcr.io/bateau84/opencode-eval-runner@"
            "sha256:104a0895c83e4f36fb597e388656a4c6e445035c9a1fb5aaa2c9e922ad172a36"
        )
        expected_copilot_image = (
            "ghcr.io/bateau84/opencode-eval-runner@"
            "sha256:7b06209cac3a0125a0d90d49a200fd71c7f91dae24477183e95ba4df0a822818"
        )

        for workflow in (live, ci):
            self.assertIn(expected_action, workflow)
            self.assertIn(expected_image, workflow)
            self.assertIn(expected_copilot_image, workflow)
        # The migrated normal path uses the reviewed runtime-evidence runner
        # image independently of Loom's separate host/plugin compatibility pin.
        self.assertIn(
            'opencode "$OPENCODE_EVAL_RUNNER_OPENCODE_IMAGE" --version | grep -F "2.0.23"',
            ci,
        )
        # Stage 1 skill ablation requires the generic paired runner API. CI
        # and live workflows must use the same immutable action revision.

    def test_live_workflow_forwards_opencode_api_key_explicitly(self):
        workflow = (
            RUN_EVALS.ROOT / ".github" / "workflows" / "loom-live-evals.yml"
        ).read_text(encoding="utf-8")

        self.assertIn("OPENCODE_API_KEY: ${{ secrets.OPENCODE_API_KEY }}", workflow)
        self.assertIn('args+=(--env OPENCODE_API_KEY)', workflow)


class DatabaseSeedTests(unittest.TestCase):
    def test_sanitizer_accepts_fresh_v2_session_schema(self):
        import sqlite3

        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            source = root / "source.db"
            destination = root / "sanitized.db"

            with sqlite3.connect(source) as db:
                db.execute("CREATE TABLE credential (provider TEXT, data TEXT)")
                db.execute("CREATE TABLE session_v2 (id TEXT PRIMARY KEY)")
                db.execute(
                    "INSERT INTO credential(provider, data) VALUES (?, ?)",
                    ("openai", json.dumps({"type": "oauth", "refresh": "secret-value"})),
                )
                db.commit()

            result = RUN_EVALS.sanitize_database_seed(source, destination)
            self.assertEqual(result, destination)
            with sqlite3.connect(destination) as db:
                self.assertEqual(
                    db.execute("SELECT provider, data FROM credential").fetchall(),
                    [("openai", json.dumps({"type": "oauth", "refresh": "secret-value"}))],
                )
                tables = {
                    row[0]
                    for row in db.execute(
                        "SELECT name FROM sqlite_master WHERE type = 'table'"
                    )
                }
                self.assertIn("session_v2", tables)

    def test_sanitizer_keeps_legacy_session_schema_compatible(self):
        import sqlite3

        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            source = root / "source.db"
            destination = root / "sanitized.db"

            with sqlite3.connect(source) as db:
                db.execute("CREATE TABLE credential (provider TEXT, data TEXT)")
                db.execute("CREATE TABLE session (id TEXT PRIMARY KEY)")
                db.commit()

            self.assertEqual(
                RUN_EVALS.sanitize_database_seed(source, destination),
                destination,
            )


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

    def test_hidden_workflow_fixture_materializes_at_exact_path(self):
        case = next(
            case
            for case in RUN_EVALS.load_cases()
            if case["id"] == "REVIEW-GHA-WORKFLOW-01"
        )
        temp, target, _ = RUN_EVALS.setup_projects(case)
        try:
            workflow = target / ".github" / "workflows" / "pr-admin.yml"
            self.assertTrue(workflow.is_file())
            text = workflow.read_text(encoding="utf-8")
            self.assertIn("pull_request_target:", text)
            self.assertIn("github.event.pull_request.head.sha", text)
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
            self.assertIn('action: shell\n    resource: "*"\n    effect: deny', baseline_agent)
            self.assertIn('action: shell\n    resource: "*"\n    effect: deny', candidate_agent)
            self.assertIn("Return the complete requested result inline", baseline_agent)
            self.assertIn("return the complete artifact inline", candidate_agent)

            copilot_baseline = RUN_EVALS.skill_ablation_copilot_system(
                "persist this artifact", with_skill=False
            )
            copilot_candidate = RUN_EVALS.skill_ablation_copilot_system(
                "persist this artifact", with_skill=True
            )
            self.assertNotIn("persist this artifact", copilot_baseline)
            self.assertLess(
                copilot_candidate.index("persist this artifact"),
                copilot_candidate.index(RUN_EVALS.SKILL_ABLATION_INLINE_BOUNDARY),
            )
            self.assertTrue(
                copilot_candidate.endswith(RUN_EVALS.SKILL_ABLATION_INLINE_BOUNDARY)
            )
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
    def test_unconfirmed_runner_defaults_keep_inventory_incomplete(self):
        inventory = RUN_EVALS.collect_credential_inventory({}, [], None, None, None, None)

        self.assertFalse(inventory.complete)
        self.assertEqual(inventory.sources["config_root"], "incomplete")

    def test_runner_safety_mode_rejects_default_image_and_missing_cli_without_fallback(self):
        with tempfile.TemporaryDirectory() as tmp, patch.dict(
            os.environ,
            {"OPENCODE_EVAL_RUNNER_BIN": "", "OPENCODE_CONFIG_DIR": ""},
            clear=False,
        ), patch.object(RUN_EVALS.shutil, "which", return_value=None), patch.object(
            RUN_EVALS.subprocess, "run", side_effect=AssertionError("unsafe execution fallback invoked"),
        ):
            kwargs = dict(
                engine="podman", transport="opencode", model="openai/test", agent="general",
                prompt="synthetic", system="", project=Path(tmp), auth=None, config=None,
                models_catalog=None, database_seed=None, config_root=None, expected_plugin=None,
                timeout=30, container_timeout=60, mount_node_modules=False,
                workspace_mode="ro", extra_envs=[], require_runner_evidence_safety=True,
                runner_defaults_known=True,
            )
            wrong_image = RUN_EVALS.invoke_container(image=RUN_EVALS.DEFAULT_IMAGES["opencode"], **kwargs)
            missing_cli = RUN_EVALS.invoke_container(image=RUN_EVALS.RUNNER_SAFETY_IMAGE, **kwargs)
            legacy_candidate = RUN_EVALS.invoke_container(
                image=RUN_EVALS.RUNNER_SAFETY_IMAGE,
                **{**kwargs, "require_runner_evidence_safety": False},
            )

        self.assertTrue(wrong_image["infrastructure_error"])
        self.assertTrue(missing_cli["infrastructure_error"])
        self.assertEqual(wrong_image["observed_tool_results"]["events"], [])
        self.assertEqual(missing_cli["observed_tool_results"]["events"], [])
        self.assertIn("requires --runner-evidence-safety", legacy_candidate["stderr"])
        self.assertFalse(legacy_candidate["evidence_safety_preflight"]["product_launched"])

    def test_incomplete_config_root_safety_profile_stops_before_runner_launch(self):
        with tempfile.TemporaryDirectory() as tmp, patch.dict(
            os.environ,
            {"OPENCODE_EVAL_RUNNER_BIN": "", "OPENCODE_CONFIG_DIR": ""},
            clear=False,
        ), patch.object(RUN_EVALS.shutil, "which", return_value=None), patch.object(
            RUN_EVALS.subprocess, "run", side_effect=AssertionError("incomplete profile launched runner"),
        ):
            result = RUN_EVALS.invoke_container(
                engine="podman", image=RUN_EVALS.RUNNER_SAFETY_IMAGE, transport="opencode",
                model="openai/test", agent="general", prompt="synthetic", system="",
                project=Path(tmp), auth=None, config=None, models_catalog=None,
                database_seed=None, config_root=Path(tmp), expected_plugin=None, timeout=30,
                container_timeout=60, mount_node_modules=False, workspace_mode="ro", extra_envs=[],
                require_runner_evidence_safety=True, runner_defaults_known=True,
            )

        self.assertTrue(result["infrastructure_error"])
        self.assertIn("inventory incomplete", result["stderr"])
        self.assertFalse(result["evidence_safety_preflight"]["product_launched"])
        self.assertEqual(result["evidence_safety_preflight"]["inventory_sources"]["config_root"], "incomplete")
        self.assertNotIn("accessToken", json.dumps(result))

    def test_private_policy_file_is_mode_0600(self):
        inventory = RUN_EVALS.credential_inventory_from_values(["SYNTH-private-token"])
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "inventory.json"

            RUN_EVALS.write_private_policy(path, inventory.private_policy())

            self.assertEqual(path.stat().st_mode & 0o777, 0o600)
            self.assertEqual(json.loads(path.read_text())["values"], ["SYNTH-private-token"])

    def test_safety_cli_receives_private_policy_file_and_rejects_legacy_result(self):
        observed = {}

        class Result:
            returncode = 0
            stdout = ""
            stderr = ""

        def fake_run(command, **_kwargs):
            observed["command"] = command
            policy_path = Path(command[command.index("--evidence-policy-file") + 1])
            observed["mode"] = policy_path.stat().st_mode & 0o777
            observed["policy"] = json.loads(policy_path.read_text(encoding="utf-8"))
            Path(command[command.index("--output") + 1]).write_text(
                json.dumps({"schema": "opencode-eval-runner/v1", "text": "legacy raw output"}),
                encoding="utf-8",
            )
            return Result()

        with tempfile.TemporaryDirectory() as tmp, patch.dict(
            os.environ, {
                "OPENCODE_EVAL_RUNNER_BIN": "/runner-fixture", "OPENCODE_CONFIG_DIR": "",
                "OPENAI_API_KEY": "", "ANTHROPIC_API_KEY": "", "OPENROUTER_API_KEY": "",
                "OPENCODE_API_KEY": "", "COPILOT_GITHUB_TOKEN": "", "GH_TOKEN": "", "GITHUB_TOKEN": "",
            }, clear=False,
        ), patch.object(RUN_EVALS.subprocess, "run", side_effect=fake_run):
            result = RUN_EVALS.invoke_container(
                engine="podman", image=RUN_EVALS.RUNNER_SAFETY_IMAGE, transport="opencode",
                model="openai/test", agent="general", prompt="synthetic", system="",
                project=Path(tmp), auth=None, config=None, models_catalog=None,
                database_seed=None, config_root=None, expected_plugin=None, timeout=30,
                container_timeout=60, mount_node_modules=False, workspace_mode="ro", extra_envs=[],
                require_runner_evidence_safety=True, runner_defaults_known=True,
            )

        self.assertIn("--require-evidence-safety", observed["command"])
        self.assertEqual(observed["mode"], 0o600)
        self.assertTrue(observed["policy"]["complete"])
        self.assertEqual(observed["policy"]["values"], [])
        self.assertTrue(result["infrastructure_error"])
        self.assertNotIn("legacy raw output", json.dumps(result))

    def test_shared_synthetic_vectors_cover_aliases_metadata_and_short_values(self):
        vectors = json.loads((Path(__file__).parent / "fixtures" / "eval-evidence-safety-vectors.json").read_text())
        with tempfile.TemporaryDirectory() as tmp:
            auth = Path(tmp) / "auth.json"
            auth.write_text(json.dumps(vectors["credentialObject"]), encoding="utf-8")
            inventory = RUN_EVALS.collect_credential_inventory(
                {**vectors["credentialAliases"], **vectors["publicSettings"]},
                list(vectors["credentialAliases"]) + list(vectors["publicSettings"]),
                auth, None, None, None, runner_defaults_known=True,
            )

        self.assertTrue(inventory.complete)
        self.assertEqual(set(inventory.values), set(vectors["credentialAliases"].values()) | {
            "SYNTH-descendant-token",
        })
        self.assertTrue(set(vectors["publicSettings"].values()).isdisjoint(inventory.values))
        self.assertNotIn("oauth", inventory.values)
        self.assertNotIn("text", inventory.values)
        self.assertNotIn("low", inventory.values)

        short_inventory = RUN_EVALS.credential_inventory_from_values(vectors["shortCredentials"])
        event = {"schema": "text", "sequence": 1, "status": "completed",
                 "output": vectors["payload"]}
        projected = RUN_EVALS.project_evidence_event(event, short_inventory)
        self.assertEqual(projected["value"]["schema"], "text")
        self.assertEqual(projected["value"]["sequence"], 1)
        self.assertEqual(projected["fields"]["output"]["state"], "omitted")
        self.assertEqual(projected["fields"]["output"]["reason"], "sensitive_key")
        self.assertNotIn("output", projected["value"])

    def test_source_inventory_recognizes_camel_case_credentials_without_public_aliases(self):
        inventory = RUN_EVALS.collect_credential_inventory(
            host_env={
                "MODEL_MAX_TOKENS": "4096",
                "EXTRA_ACCESS_TOKEN": "env-access-secret",
                "CLIENT_SECRET": "env-client-secret",
            },
            extra_envs=["MODEL_MAX_TOKENS", "EXTRA_ACCESS_TOKEN", "CLIENT_SECRET"],
            auth=None,
            config=None,
            models_catalog=None,
            database_seed=None,
            runner_defaults_known=True,
        )

        self.assertTrue(inventory.complete)
        self.assertEqual(
            {item.value for item in inventory.entries if item.role == "credential"},
            {"env-access-secret", "env-client-secret"},
        )
        self.assertNotIn("4096", inventory.values)

    def test_unknown_custom_header_and_wrong_typed_credential_fail_closed(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            config = root / "config.json"
            config.write_text(json.dumps({
                "providers": {"fixture": {"settings": {
                    "headers": {
                        "X-Custom-Auth": "SYNTH-unclassified-header",
                        "type": "SYNTH-public-type-name",
                        "provider": "SYNTH-public-provider-name",
                        "id": "SYNTH-public-id-name",
                        "scope": "SYNTH-public-scope-name",
                        "context": "SYNTH-public-context-name",
                    },
                }}}
            }), encoding="utf-8")
            wrong_type = root / "auth.json"
            wrong_type.write_text(json.dumps({"credential": {"apiKey": 1}}), encoding="utf-8")
            scalar_root = root / "scalar-config.json"
            scalar_root.write_text(json.dumps("unclassified-secret-root"), encoding="utf-8")
            unkeyed = root / "unkeyed-credentials.json"
            unkeyed.write_text(json.dumps({"credentials": ["SYNTH-unkeyed"]}), encoding="utf-8")
            duplicate = root / "duplicate-config.json"
            duplicate.write_text('{"apiKey":"first","apiKey":"second"}', encoding="utf-8")
            custom_header = RUN_EVALS.collect_credential_inventory(
                {}, [], None, config, None, None, runner_defaults_known=True,
            )
            numeric_key = RUN_EVALS.collect_credential_inventory(
                {}, [], wrong_type, None, None, None, runner_defaults_known=True,
            )
            scalar_source = RUN_EVALS.collect_credential_inventory(
                {}, [], None, scalar_root, None, None, runner_defaults_known=True,
            )
            unkeyed_source = RUN_EVALS.collect_credential_inventory(
                {}, [], None, unkeyed, None, None, runner_defaults_known=True,
            )
            duplicate_source = RUN_EVALS.collect_credential_inventory(
                {}, [], None, duplicate, None, None, runner_defaults_known=True,
            )

        self.assertFalse(custom_header.complete)
        self.assertEqual(custom_header.sources["config"], "incomplete")
        self.assertNotIn("SYNTH-unclassified-header", custom_header.values)
        self.assertFalse(numeric_key.complete)
        self.assertEqual(numeric_key.sources["auth"], "incomplete")
        self.assertFalse(scalar_source.complete)
        self.assertFalse(unkeyed_source.complete)
        self.assertFalse(duplicate_source.complete)

    def test_disposition_and_judge_budget_vetoes_require_complete_text(self):
        exact = {"text": "complete", "evidence_safety": {"fields": {"text": {"state": "exact"}}}}
        self.assertIsNone(RUN_EVALS.judge_text_evidence_error(exact))
        redacted = {"text": "***REDACTED***", "evidence_safety": {"fields": {"text": {"state": "redacted"}}}}
        self.assertIsNotNone(RUN_EVALS.judge_text_evidence_error(redacted))
        omitted = {"evidence_safety": {"fields": {"text": {"state": "omitted"}}}}
        self.assertIsNotNone(RUN_EVALS.judge_text_evidence_error(omitted))
        over_budget = {**exact, "text": "x" * (RUN_EVALS.JUDGE_TEXT_LIMIT + 1)}
        self.assertIn("budget", RUN_EVALS.judge_text_evidence_error(over_budget))
        case = {"id": "JUDGE-BUDGET", "agent": "general", "execution": "role-decision",
                "trap": "", "expectations": [], "must_not": []}
        with self.assertRaisesRegex(ValueError, "complete assistant text"):
            RUN_EVALS.judge_prompt(case, over_budget["text"], [])
        target = {
            "text": "complete", "tools": [], "actions": [],
            "skills_loaded": ["software-engineering", "***REDACTED***"],
            "evidence_safety": {"fields": {
                "text": exact["evidence_safety"]["fields"]["text"],
                "tools": exact["evidence_safety"]["fields"]["text"],
                "actions": exact["evidence_safety"]["fields"]["text"],
                "skills_loaded": {"state": "redacted"},
            }},
        }
        self.assertIn("skills_loaded", RUN_EVALS.target_scoring_evidence_error(target))

    def test_skill_ablation_cannot_pass_from_redacted_candidate_or_judge_text(self):
        case = {
            "id": "SKILL-DISPOSITION", "agent": RUN_EVALS.SKILL_EVAL_AGENT,
            "execution": "runtime", "skill": "software-engineering", "prompt": "Act.",
            "expectations": ["Complete the task."], "must_not": ["Do not fabricate."],
            "trap": "", "_skill_owned": True, "_skill_trap_declared": False,
        }
        args = argparse.Namespace(
            auth=None, provider_config=None, models_catalog=None, database=None,
            target_transport="opencode", judge_transport="opencode", judge_model=None,
            model="fixture/model", iterations=1, target_reasoning=None, judge_reasoning=None,
            timeout_seconds=10, container_timeout=20, network=None, env=[],
            transport_retries=0, runner_evidence_safety=False, keep_temp=True,
            artifact_dir="unused", image=None, opencode_image=None, copilot_image=None,
        )
        exact = {"state": "exact"}
        exact_fields = {name: {"state": "exact"} for name in ("text", "tools", "actions", "skills_loaded")}
        grade = json.dumps({
            "passed": True,
            "expectations": [{"expectation": "Complete the task.", "met": True, "reason": "ok"}],
            "violations": [{"rule": "Do not fabricate.", "violated": False, "reason": "ok"}],
            "trap_observed": False, "trap_evidence": "none", "summary": "pass",
        })
        baseline_target = {"exit_code": 0, "text": "baseline", "tools": [], "actions": [],
                           "skills_loaded": [], "evidence_safety": {"fields": exact_fields}}
        candidate_target = {"exit_code": 0, "text": "***REDACTED***", "tools": [], "actions": [],
                            "skills_loaded": ["software-engineering"],
                            "evidence_safety": {"fields": {**exact_fields, "text": {"state": "redacted"}}}}
        judge_result = {"exit_code": 0, "text": grade,
                        "evidence_safety": {"fields": {"text": exact}}}
        with tempfile.TemporaryDirectory() as tmp, \
             patch.object(RUN_EVALS, "setup_skill_ablation_projects", return_value=(
                 Path(tmp), Path(tmp) / "baseline", Path(tmp) / "candidate", Path(tmp) / "judge")), \
             patch.object(RUN_EVALS, "resolve_optional_file", return_value=None), \
             patch.object(RUN_EVALS, "invoke_container_with_retry",
                          side_effect=[baseline_target, judge_result, candidate_target]) as invoke, \
             patch.object(RUN_EVALS, "write_case_artifact"):
            result = RUN_EVALS.run_skill_ablation_case(case, args, "podman")

        self.assertEqual(invoke.call_count, 3)
        self.assertFalse(result["passed"])
        self.assertEqual(result["classification"], "non-evidence")
        self.assertNotIn("candidate_absolute_pass", result)
        self.assertIn("not exact", result["candidate"]["target_error"])

        candidate_exact = {**candidate_target, "text": "candidate", "evidence_safety": {"fields": exact_fields}}
        judge_redacted = {"exit_code": 0, "text": grade,
                          "evidence_safety": {"fields": {"text": {"state": "redacted"}}}}
        with tempfile.TemporaryDirectory() as tmp, \
             patch.object(RUN_EVALS, "setup_skill_ablation_projects", return_value=(
                 Path(tmp), Path(tmp) / "baseline", Path(tmp) / "candidate", Path(tmp) / "judge")), \
             patch.object(RUN_EVALS, "resolve_optional_file", return_value=None), \
             patch.object(RUN_EVALS, "invoke_container_with_retry",
                          side_effect=[baseline_target, judge_result, candidate_exact, judge_redacted]), \
             patch.object(RUN_EVALS, "write_case_artifact"):
            judge_loss_result = RUN_EVALS.run_skill_ablation_case(case, args, "podman")
        self.assertFalse(judge_loss_result["passed"])
        self.assertEqual(judge_loss_result["classification"], "non-evidence")
        self.assertNotIn("candidate_absolute_pass", judge_loss_result)
        self.assertIn("not exact", judge_loss_result["candidate"]["judge_error"])

        candidate_skill_redacted = {
            **candidate_exact,
            "skills_loaded": ["software-engineering", "***REDACTED***"],
            "evidence_safety": {"fields": {**exact_fields,
                                            "skills_loaded": {"state": "redacted"}}},
        }
        with tempfile.TemporaryDirectory() as tmp, \
             patch.object(RUN_EVALS, "setup_skill_ablation_projects", return_value=(
                 Path(tmp), Path(tmp) / "baseline", Path(tmp) / "candidate", Path(tmp) / "judge")), \
             patch.object(RUN_EVALS, "resolve_optional_file", return_value=None), \
             patch.object(RUN_EVALS, "invoke_container_with_retry",
                          side_effect=[baseline_target, judge_result, candidate_skill_redacted]) as invoke, \
             patch.object(RUN_EVALS, "write_case_artifact"):
            skill_loss_result = RUN_EVALS.run_skill_ablation_case(case, args, "podman")
        self.assertEqual(invoke.call_count, 3)
        self.assertFalse(skill_loss_result["passed"])
        self.assertEqual(skill_loss_result["classification"], "non-evidence")
        self.assertNotIn("candidate_absolute_pass", skill_loss_result)
        self.assertIn("skills_loaded", skill_loss_result["candidate"]["target_error"])


    def test_camel_case_source_inventory_protects_public_transport_across_seed_sources(self):
        env_secret = "SYNTH-env-access"
        auth_secret = "SYNTH-auth-refresh"
        config_secret = "SYNTH-config-client"
        model_secret = "SYNTH-model-key"
        database_secret = "SYNTH-db-secret"
        database_json_secret = "SYNTH-db-json-token"
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            auth = root / "auth.json"
            auth.write_text(json.dumps({"refreshToken": auth_secret, "credential": {
                "type": "oauth", "accessToken": "SYNTH-nested-access", "context": "metadata",
            }}), encoding="utf-8")
            config = root / "config.json"
            config.write_text(json.dumps({"clientSecret": config_secret, "MODEL_MAX_TOKENS": 4096}), encoding="utf-8")
            models = root / "models.json"
            models.write_text(json.dumps({"secretKey": model_secret}), encoding="utf-8")
            database = root / "seed.db"
            import sqlite3
            with sqlite3.connect(database) as db:
                db.execute("CREATE TABLE credential (provider TEXT, refreshToken TEXT, data TEXT)")
                db.execute("INSERT INTO credential VALUES (?, ?, ?)", (
                    "openai", database_secret, json.dumps({"accessToken": database_json_secret}),
                ))
            inventory = RUN_EVALS.collect_credential_inventory(
                {"EXTRA_ACCESS_TOKEN": env_secret, "MODEL_MAX_TOKENS": "4096"},
                ["EXTRA_ACCESS_TOKEN", "MODEL_MAX_TOKENS"], auth, config, models, database,
                runner_defaults_known=True,
            )
            values = set(inventory.values)
            public = "workflow follow low-level context text 0 1"
            prepared = RUN_EVALS.prepare_transport_result(
                {"text": public + " " + " ".join(values), "stdout": json.dumps(
                    {"type": "tool_use", "part": {"type": "tool", "tool": "loom_status",
                     "callID": "call-safe", "state": {"status": "completed", "input": {},
                     "output": {"text": database_json_secret, "count": 1}}}}
                )}, list(values), inventory,
            )

        encoded = json.dumps(prepared, ensure_ascii=False)
        self.assertTrue(inventory.complete)
        self.assertEqual(values, {
            env_secret, auth_secret, "SYNTH-nested-access", config_secret, model_secret,
            database_secret, database_json_secret,
        })
        for secret in values:
            self.assertNotIn(secret, encoded)
        self.assertNotIn("stdout", prepared)
        self.assertEqual(prepared["evidence_safety"]["fields"]["text"]["state"], "redacted")
        self.assertFalse(prepared["observed_tool_results"]["evidence_safety"]["coverage_complete"])
        self.assertIn("workflow follow low-level context text 0 1", encoded)

    def test_sensitive_container_metadata_is_not_credential_material(self):
        secret = "DESC-TOKEN"
        with tempfile.TemporaryDirectory() as tmp:
            auth = Path(tmp) / "auth.json"
            auth.write_text(json.dumps({
                "credential": {
                    "type": "oauth",
                    "accessToken": secret,
                    "context": "text",
                    "scope": "low",
                }
            }), encoding="utf-8")
            inventory = RUN_EVALS.collect_credential_inventory(
                host_env={}, extra_envs=[], auth=auth, config=None,
                models_catalog=None, database_seed=None, runner_defaults_known=True,
            )

        self.assertTrue(inventory.complete)
        self.assertEqual(inventory.values, (secret,))
        self.assertIn(("auth", "credential.type", "public", "oauth"), inventory.entries_as_tuples())

    def test_typed_projection_keeps_protocol_structure_and_omits_unsafe_payload_keys(self):
        inventory = RUN_EVALS.credential_inventory_from_values(["1", "text"])
        projected = RUN_EVALS.project_evidence_event({
            "schema": "text",
            "sequence": 1,
            "status": "completed",
            "input": {"credential": "1", "text": "payload"},
            "output": {"text": "text", "nested": {"safe": "visible"}},
        }, inventory)

        self.assertEqual(projected["value"]["schema"], "text")
        self.assertEqual(projected["value"]["sequence"], 1)
        self.assertEqual(projected["fields"]["input"]["state"], "omitted")
        self.assertEqual(projected["fields"]["output"]["state"], "omitted")
        self.assertNotIn("output", projected["value"])
        self.assertNotIn('"credential"', json.dumps(projected))

    def test_payload_credential_keys_and_matching_scalars_are_omitted(self):
        for secret, payload in (("opaque93z", {"opaque93z": "safe"}), ("1", {"count": 1})):
            with self.subTest(secret=secret):
                projected = RUN_EVALS.project_evidence_event(
                    {"output": payload}, RUN_EVALS.credential_inventory_from_values([secret]),
                )
                self.assertNotIn("output", projected["value"])
                self.assertEqual(projected["fields"]["output"]["state"], "omitted")

    def test_json_escaped_credential_payload_keys_are_omitted(self):
        secret = 'quote" newline\n path\\suffix'
        inventory = RUN_EVALS.credential_inventory_from_values([secret])
        self.assertEqual(inventory.values, (secret,))
        encoded_key = secret
        for depth in range(4):
            with self.subTest(depth=depth):
                projected = RUN_EVALS.project_evidence_event(
                    {"output": {"nested": {encoded_key: "value"}}}, inventory,
                )
                self.assertNotIn("output", projected["value"])
                self.assertEqual(projected["fields"]["output"]["state"], "omitted")
                self.assertEqual(projected["fields"]["output"]["reason"], "sensitive_key")
            encoded_key = json.dumps(encoded_key, ensure_ascii=False)[1:-1]

        unsupported_key = encoded_key
        projected = RUN_EVALS.project_evidence_event(
            {"output": {unsupported_key: "value"}}, inventory,
        )
        self.assertNotIn("output", projected["value"])
        self.assertEqual(projected["fields"]["output"]["reason"], "unsupported_representation")

        encoded_value = secret
        for _depth in range(4):
            projected = RUN_EVALS.project_evidence_event({"output": encoded_value}, inventory)
            self.assertEqual(projected["value"]["output"], "***REDACTED***")
            self.assertEqual(projected["fields"]["output"]["state"], "redacted")
            encoded_value = json.dumps(encoded_value, ensure_ascii=False)[1:-1]
        self.assertIn("\\", encoded_value)
        self.assertEqual(RUN_EVALS._project_payload(encoded_value, inventory.values)[2], "unsupported_representation")
        projected = RUN_EVALS.project_evidence_event({"output": encoded_value}, inventory)
        self.assertNotEqual(projected["fields"]["output"]["state"], "exact", projected)
        self.assertNotIn(secret, json.dumps(projected["value"], ensure_ascii=False))

    def test_incomplete_inventory_omits_selectors_and_blocks_capture_completeness(self):
        with tempfile.TemporaryDirectory() as tmp:
            missing_auth = Path(tmp) / "missing-auth.json"
            inventory = RUN_EVALS.collect_credential_inventory(
                {}, [], missing_auth, None, None, None,
            )
        evidence = {
            "schema": "loom-tool-results/v1", "source": "target.stdout",
            "metadata_tool_capture_complete": True,
            "events": [{"tool": "loom_status", "input": '{"workflowId":"wf"}',
                        "output": '{"state":"ready"}', "truncated_fields": []}],
            "nested_tool_calls": [],
        }

        projected = RUN_EVALS.apply_evidence_projection(evidence, inventory)

        self.assertFalse(projected["evidence_safety"]["inventory_complete"])
        self.assertFalse(projected["evidence_safety"]["coverage_complete"])
        self.assertFalse(projected["metadata_tool_capture_complete"])
        self.assertNotIn("input", projected["events"][0])
        self.assertIn("input", projected["events"][0]["truncated_fields"])
        self.assertEqual(projected["events"][0]["evidence_safety"]["input"]["reason"], "inventory_incomplete")


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

    def test_short_provider_credential_is_protected_without_collecting_model_metadata(self):
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
        self.assertEqual(secrets, ["short"])

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
            {"OPENAI_API_KEY": secret, "OPENCODE_CONFIG_DIR": ""},
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
        self.assertNotIn("text", result)
        self.assertFalse(result["evidence_safety"]["inventory_complete"])

    def test_legacy_observer_policy_does_not_forward_seed_credentials_to_target_environment(self):
        secret = "SYNTH-seed-access-token"
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            auth = root / "auth.json"
            auth.write_text(json.dumps({"accessToken": secret}), encoding="utf-8")
            observed: dict[str, str] = {}

            class Result:
                returncode = 0
                stdout = '{"exit_code":0,"text":"done","tools":[],"actions":[]}'
                stderr = ""

            def fake_run(_command, **kwargs):
                observed.update(kwargs["env"])
                return Result()

            with patch.dict(os.environ, {"OPENCODE_CONFIG_DIR": "", "OPENCODE_EVAL_NORMAL_OBSERVATIONS": ""}, clear=False), \
                 patch.object(RUN_EVALS.shutil, "which", return_value=None), \
                 patch.object(RUN_EVALS.subprocess, "run", side_effect=fake_run):
                RUN_EVALS.invoke_container(
                    engine="podman", image="test-image", transport="opencode", model="openai/test",
                    agent="general", prompt="test", system="", project=root, auth=auth,
                    config=None, models_catalog=None, database_seed=None, config_root=None,
                    expected_plugin=None, timeout=30, container_timeout=60, mount_node_modules=False,
                    workspace_mode="ro", extra_envs=[],
                )

        policy = json.loads(observed["OPENCODE_EVAL_REDACTION_VALUES"])
        self.assertFalse(policy["complete"])
        self.assertEqual(policy["values"], [])
        self.assertNotIn(secret, json.dumps(policy))


    def test_invoke_container_redacts_secret_on_runner_failure_path(self):
        secret = "sk-failure-secret-abcdef123456"

        class Result:
            returncode = 2
            stdout = "x" * 99995 + secret + " trailing"
            stderr = "y" * 3995 + secret + " trailing"

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
        self.assertNotIn(secret[:10], encoded)
        self.assertIn("***REDACTED***", encoded)
        self.assertTrue(result["infrastructure_error"])

    def test_raw_container_invalid_json_redacts_before_clipping(self):
        secret = "sk-container-secret-abcdef123456"

        class Result:
            returncode = 2
            stdout = "x" * 99995 + secret + " trailing"
            stderr = "y" * 3995 + secret + " trailing"

        with tempfile.TemporaryDirectory() as tmp, patch.dict(
            os.environ,
            {"OPENAI_API_KEY": secret, "OPENCODE_EVAL_RUNNER_BIN": ""},
            clear=False,
        ):
            project = Path(tmp)
            with patch.object(RUN_EVALS.shutil, "which", return_value=None), patch.object(
                RUN_EVALS.subprocess, "run", return_value=Result()
            ):
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
        self.assertNotIn(secret[:10], encoded)
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


    def test_model_unavailable_provider_route_is_retryable(self):
        result = {
            "exit_code": 1,
            "stderr": "",
            "stdout": json.dumps({
                "type": "error",
                "error": {
                    "type": "provider.no-route",
                    "message": "Model unavailable: openai/gpt-6-luna",
                },
            }),
            "text": "",
        }

        self.assertTrue(RUN_EVALS.retryable_transport_error(result))

    def test_auth_failure_is_not_retryable(self):
        result = {
            "exit_code": 1,
            "stderr": "",
            "stdout": json.dumps({
                "type": "error",
                "error": {
                    "type": "provider.auth",
                    "message": "token expired",
                    "status": 401,
                },
            }),
            "text": "",
        }

        self.assertFalse(RUN_EVALS.retryable_transport_error(result))


    def test_model_unavailable_after_tool_use_is_not_retryable(self):
        error_event = json.dumps({
            "type": "error",
            "error": {
                "type": "provider.no-route",
                "message": "Model unavailable: openai/gpt-6-luna",
            },
        })
        cases = [
            {
                "exit_code": 1,
                "stderr": "",
                "stdout": error_event,
                "text": "",
                "tools": ["loom_status"],
                "actions": [],
            },
            {
                "exit_code": 1,
                "stderr": "",
                "stdout": error_event,
                "text": "",
                "tools": [],
                "actions": [{"tool": "loom_status", "args": {}}],
            },
            {
                "exit_code": 1,
                "stderr": "",
                "stdout": "\n".join([
                    json.dumps({
                        "type": "tool_use",
                        "part": {
                            "type": "tool",
                            "tool": "loom_status",
                            "state": {"input": {}},
                        },
                    }),
                    error_event,
                ]),
                "text": "",
                "tools": [],
            },
        ]

        for result in cases:
            with self.subTest(result=result):
                self.assertFalse(RUN_EVALS.retryable_transport_error(result))

    def test_transient_transport_retry_recovers_and_records_prior_error(self):
        unavailable = {
            "exit_code": 1,
            "stderr": "",
            "stdout": json.dumps({
                "type": "error",
                "error": {
                    "type": "provider.no-route",
                    "message": "Model unavailable: openai/gpt-6-luna",
                },
            }),
            "text": "",
        }
        success = {
            "exit_code": 0,
            "stderr": "",
            "stdout": "",
            "text": "ok",
        }

        with patch.object(
            RUN_EVALS,
            "invoke_container",
            side_effect=[unavailable, success],
        ) as invoke, patch.object(RUN_EVALS.time, "sleep") as sleep:
            result = RUN_EVALS.invoke_container_with_retry(retries=2)

        self.assertEqual(invoke.call_count, 2)
        sleep.assert_called_once_with(1)
        self.assertEqual(result["text"], "ok")
        self.assertEqual(result["transport_retry"]["attempts"], 2)
        self.assertEqual(len(result["transport_retry"]["errors"]), 1)
        self.assertIn("provider.no-route", result["transport_retry"]["errors"][0])


class ActionAssertionTests(unittest.TestCase):
    def test_companion_eval_cases_use_loom_methodology_surfaces(self):
        suite = json.loads(
            (RUN_EVALS.ROOT / "evals" / "verification.json").read_text(encoding="utf-8")
        )
        cases = {case["id"]: case for case in suite["cases"]}
        expected = {
            "REVIEW-SKILL-LOAD-01": ("golang-concurrency", "assessment"),
            "CRITIC-SKILL-LOAD-01": ("golang-concurrency", "qa"),
            "REVIEW-GHA-WORKFLOW-01": ("github-workflow", "assessment"),
            "REVIEW-GHA-ACTION-01": ("github-action", "assessment"),
        }

        for case_id, (skill, method) in expected.items():
            with self.subTest(case=case_id):
                case = cases[case_id]
                companion = "ASSESSMENT.md" if method == "assessment" else "QA.md"
                self.assertFalse(any(
                    item.get("tool") == "read"
                    and str(item.get("ends_with") or "").endswith(
                        f"skills/{skill}/{companion}"
                    )
                    for item in case["actions"]["requires"]
                ))
                native = {
                    "tool": "loom_assessment" if method == "assessment" else "loom_qa",
                    "arg": "skill",
                    "equals": skill,
                }
                code_mode = {
                    "tool": "execute",
                    "arg": "code",
                    "contains_all": [f"tools.loom.code.{method}(", skill],
                }
                self.assertTrue(any(
                    native in group and code_mode in group
                    for group in case["actions"]["any_of"]
                ))

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

    def test_fallback_container_forwards_explicit_reasoning_env(self):
        class Result:
            returncode = 0
            stdout = '{"exit_code":0,"text":"ok","tools":[],"actions":[],"reasoning":"high","reasoning_source":"explicit"}'
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
                    reasoning="high",
                )

        command = run.call_args.args[0]
        rendered = " ".join(command)
        self.assertIn("--env EVAL_REASONING=high", rendered)
        self.assertNotIn("--reasoning", command)
        self.assertFalse(result.get("infrastructure_error", False))

    def test_explicit_reasoning_fails_closed_when_transport_does_not_confirm_it(self):
        result = RUN_EVALS.enforce_reasoning_contract(
            {"exit_code": 0, "text": "ok", "stderr": ""},
            "high",
        )
        self.assertTrue(result["infrastructure_error"])
        self.assertIn("reasoning control mismatch", result["stderr"])

    def test_invoke_container_omits_reasoning_for_provider_default(self):
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
                )

        self.assertIn("--env EVAL_REASONING=", " ".join(run.call_args.args[0]))

    def test_reasoning_resolution_supports_common_and_role_overrides(self):
        args = argparse.Namespace(reasoning="medium", target_reasoning=None, judge_reasoning=None)
        self.assertEqual(RUN_EVALS.requested_reasoning(args, "target"), "medium")
        self.assertEqual(RUN_EVALS.requested_reasoning(args, "judge"), "medium")

        args.target_reasoning = "low"
        args.judge_reasoning = "high"
        self.assertEqual(RUN_EVALS.requested_reasoning(args, "target"), "low")
        self.assertEqual(RUN_EVALS.requested_reasoning(args, "judge"), "high")
        self.assertEqual(
            RUN_EVALS.reasoning_provenance("openai/gpt-5.6-luna", "opencode", None),
            ("provider-default", "provider-default"),
        )
        self.assertEqual(
            RUN_EVALS.reasoning_provenance("openai/gpt-5.6-luna#high", "opencode", None),
            ("high", "model-variant"),
        )
        self.assertEqual(
            RUN_EVALS.reasoning_provenance("gpt-5.6-luna", "github-copilot-cli", None),
            ("provider-default", "provider-default"),
        )
        self.assertEqual(
            RUN_EVALS.reasoning_provenance("openai/gpt-5.6-luna#high", "opencode", "medium"),
            ("medium", "explicit"),
        )

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

    def test_eval_runner_cli_receives_explicit_reasoning(self):
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
                    "reasoning": "high",
                    "reasoning_source": "explicit",
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
                    reasoning="high",
                )

        self.assertIn("--reasoning", seen)
        self.assertEqual(seen[seen.index("--reasoning") + 1], "high")
        self.assertFalse(result.get("infrastructure_error", False))

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

    def test_default_artifact_directory_is_run_scoped(self):
        self.assertEqual(
            RUN_EVALS.default_artifact_dir("run-123"),
            RUN_EVALS.ROOT / ".loom-evals" / "run-123",
        )

    def test_case_artifact_round_trip_detects_console_durable_mismatch(self):
        case = {"id": "INTEGRITY-01"}
        with tempfile.TemporaryDirectory() as tmp:
            args = argparse.Namespace(
                artifact_dir=tmp,
                iterations=1,
                eval_run_id="run-integrity-01",
            )
            artifact = {
                "classification": "behavioral-fail",
                "passed": False,
                "baseline_score": 1.0,
                "candidate_score": 0.8,
                "delta_pp": -20.0,
                "trap_fixed": False,
                "trap_regression": True,
                "candidate_absolute_pass": False,
                "semantic": {"passed": False},
                "candidate": {"semantic": {"passed": False}},
            }

            RUN_EVALS.write_case_artifact(case, args, 1, artifact)
            self.assertEqual(artifact["eval_run_id"], "run-integrity-01")
            self.assertRegex(artifact["artifact_evidence_id"], r"^[0-9a-f]{64}$")
            RUN_EVALS.verify_case_artifact(case, args, 1, artifact)

            path = RUN_EVALS.case_artifact_path(case, args, 1)
            durable = json.loads(path.read_text(encoding="utf-8"))
            durable["candidate_score"] = 1.0
            path.write_text(json.dumps(durable, indent=2) + "\n", encoding="utf-8")

            with self.assertRaisesRegex(RuntimeError, "evidence ID mismatch"):
                RUN_EVALS.verify_case_artifact(case, args, 1, artifact)

            RUN_EVALS.write_case_artifact(case, args, 1, artifact)
            durable = json.loads(path.read_text(encoding="utf-8"))
            durable["diagnostic_note"] = "different durable artifact content"
            path.write_text(json.dumps(durable, indent=2) + "\n", encoding="utf-8")

            with self.assertRaisesRegex(RuntimeError, "evidence ID mismatch"):
                RUN_EVALS.verify_case_artifact(case, args, 1, artifact)

            RUN_EVALS.write_case_artifact(case, args, 1, artifact)
            artifact["diagnostic_note"] = "different in-memory artifact content"
            with self.assertRaisesRegex(RuntimeError, "in-memory eval evidence ID mismatch"):
                RUN_EVALS.verify_case_artifact(case, args, 1, artifact)

    def test_case_artifact_refuses_cross_run_overwrite(self):
        case = {"id": "INTEGRITY-COLLISION-01"}
        with tempfile.TemporaryDirectory() as tmp:
            first_args = argparse.Namespace(
                artifact_dir=tmp,
                iterations=1,
                eval_run_id="run-first",
            )
            second_args = argparse.Namespace(
                artifact_dir=tmp,
                iterations=1,
                eval_run_id="run-second",
            )
            artifact = {"classification": "pass", "passed": True}

            RUN_EVALS.write_case_artifact(case, first_args, 1, dict(artifact))
            with self.assertRaisesRegex(RuntimeError, "artifact directory .* claimed by run"):
                RUN_EVALS.write_case_artifact(case, second_args, 1, dict(artifact))

            path = RUN_EVALS.case_artifact_path(case, first_args, 1)
            durable = json.loads(path.read_text(encoding="utf-8"))
            self.assertEqual(durable["eval_run_id"], "run-first")
            owner = Path(tmp) / ".loom-eval-run-id"
            self.assertEqual(owner.read_text(encoding="utf-8").strip(), "run-first")

            disjoint_case = {"id": "INTEGRITY-COLLISION-02"}
            with self.assertRaisesRegex(RuntimeError, "artifact directory .* claimed by run"):
                RUN_EVALS.write_case_artifact(disjoint_case, second_args, 1, dict(artifact))
            self.assertFalse(
                RUN_EVALS.case_artifact_path(disjoint_case, second_args, 1).exists()
            )

    def test_artifact_directory_claim_is_atomic_under_contention(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            barrier = threading.Barrier(2)

            def attempt(run_id: str):
                barrier.wait()
                try:
                    RUN_EVALS.claim_artifact_directory(root, run_id)
                    return ("claimed", run_id, "")
                except RuntimeError as exc:
                    return ("rejected", run_id, str(exc))

            with ThreadPoolExecutor(max_workers=2) as pool:
                results = list(pool.map(attempt, ("run-a", "run-b")))

            claimed = [item for item in results if item[0] == "claimed"]
            rejected = [item for item in results if item[0] == "rejected"]
            self.assertEqual(len(claimed), 1, results)
            self.assertEqual(len(rejected), 1, results)
            self.assertIn("claimed by run", rejected[0][2])

            owner = root / ".loom-eval-run-id"
            self.assertEqual(owner.read_text(encoding="utf-8").strip(), claimed[0][1])

            loser_args = argparse.Namespace(
                artifact_dir=tmp,
                iterations=1,
                eval_run_id=rejected[0][1],
            )
            with self.assertRaisesRegex(RuntimeError, "artifact directory .* claimed by run"):
                RUN_EVALS.write_case_artifact(
                    {"id": "CONTENDED-01"},
                    loser_args,
                    1,
                    {"classification": "pass", "passed": True},
                )
            self.assertFalse((root / "CONTENDED-01.json").exists())

    def test_artifact_directory_rejects_preexisting_unowned_evidence(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root / "stale-case.json").write_text('{"passed":true}\n', encoding="utf-8")

            with self.assertRaisesRegex(RuntimeError, "was not empty before run"):
                RUN_EVALS.claim_artifact_directory(root, "run-new")

            owner = root / ".loom-eval-run-id"
            self.assertFalse(owner.exists())
            self.assertTrue((root / "stale-case.json").is_file())

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
            "evidence_safety": {"fields": {name: {"state": "exact"} for name in
                                                ("text", "tools", "actions", "skills_loaded")}},
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
            "evidence_safety": {"fields": {"text": {"state": "exact"}}},
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

    def test_run_case_rejects_missing_judge_text_disposition(self):
        case = {
            "id": "JUDGE-DISPOSITION", "agent": "general", "execution": "role-decision",
            "requirements": [], "prompt": "Act.", "trap": "", "expectations": ["Act."],
            "must_not": ["Do not fabricate."],
        }
        args = argparse.Namespace(
            iterations=1, target_transport="opencode", judge_transport="opencode", judge_model=None,
            model="fixture/model", auth=None, provider_config=None, models_catalog=None, database=None,
            timeout_seconds=10, container_timeout=20, env=[], network=None,
            image=None, opencode_image=None, copilot_image=None, artifact_dir="unused", keep_temp=False,
        )
        text_exact = {name: {"state": "exact"} for name in ("text", "tools", "actions", "skills_loaded")}
        target = {"exit_code": 0, "text": "Act now.", "tools": [], "actions": [],
                  "skills_loaded": [], "evidence_safety": {"fields": text_exact}}
        judge = {"exit_code": 0, "text": json.dumps({
            "passed": True,
            "expectations": [{"expectation": "Act.", "met": True, "reason": "yes"}],
            "violations": [{"rule": "Do not fabricate.", "violated": False, "reason": "no"}],
            "trap_observed": False, "trap_evidence": "none", "summary": "yes",
        })}
        with tempfile.TemporaryDirectory() as tmp:
            target_project, judge_project = Path(tmp) / "target", Path(tmp) / "judge"
            target_project.mkdir(); judge_project.mkdir()
            args.artifact_dir = str(Path(tmp) / "artifacts")
            with patch.object(RUN_EVALS, "setup_projects", return_value=(Path(tmp), target_project, judge_project)), \
                 patch.object(RUN_EVALS, "resolve_optional_file", return_value=None), \
                 patch.object(RUN_EVALS, "image_for_transport", return_value="test-image"), \
                 patch.object(RUN_EVALS, "invoke_container", side_effect=[target, judge]):
                result = RUN_EVALS.run_case(case, args, "podman")
        self.assertFalse(result["passed"])
        self.assertIsNone(result["semantic"])
        self.assertIn("text is not exact", result["judge_error"])

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

    def test_action_contains_all_requires_every_fragment_in_one_argument(self):
        assertion = {
            "tool": "execute",
            "arg": "code",
            "contains_all": ["tools.loom.code.assessment(", "golang-concurrency"],
        }
        self.assertTrue(RUN_EVALS.action_matches({
            "tool": "execute",
            "args": {
                "code": 'return await tools.loom.code.assessment({skill:"golang-concurrency"})',
            },
        }, assertion))
        self.assertFalse(RUN_EVALS.action_matches({
            "tool": "execute",
            "args": {
                "code": 'return await tools.loom.code.assessment({skill:"github-workflow"})',
            },
        }, assertion))

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




class ConversationCompositionTests(unittest.TestCase):
    def test_newer_main_status_case_and_conversation_navigation_survive(self):
        suite = json.loads((RUN_EVALS.ROOT / "evals" / "intent-and-routing.json").read_text())
        cases = {case["id"]: case for case in suite["cases"]}
        self.assertTrue({"INTENT-01", "INTENT-02", "INTENT-03", "AUTONOMY-01", "AUTONOMY-02", "ROUTING-01", "OQ-ROUTE-01", "STATUS-PREVIEW-01"}.issubset(cases))
        status = cases["STATUS-PREVIEW-01"]
        self.assertEqual(status["execution"], "runtime")
        # Preserve each setup operation and both supported tool surfaces, not a
        # brittle count that rejects an additional required operation.
        groups = status["actions"]["any_of"]
        for operation in ("start", "route", "status"):
            with self.subTest(operation=operation):
                native = {"tool": f"loom_{operation}"}
                code_mode = {
                    "tool": "execute",
                    "arg": "code",
                    "contains": f"tools.loom.code.{operation}",
                }
                self.assertTrue(
                    any(native in group and code_mode in group for group in groups),
                    f"missing native/Code Mode alternatives for {operation}",
                )
        self.assertEqual(status["fixture_files"][0]["path"], "docs/anchors/status-preview/anchor.md")
        self.assertTrue(any(item.get("contains") == "tools.browser.preview" for item in status["actions"]["forbids"]))
        index = (RUN_EVALS.ROOT / "docs" / "architecture" / "loom" / "index.md").read_text()
        self.assertIn("decisions/conversation-primary-agent.md", index)

    def test_default_excludes_opt_in_cases_but_explicit_selection_can_include_them(self):
        cases = RUN_EVALS.load_cases()
        ids = {case["id"] for case in cases}
        self.assertIn("CONVERSATION-02", ids)
        self.assertIn("CONVERSATION-02-SYNTH", ids)
        self.assertIn("PROP-RUNTIME-01", ids)
        self.assertNotIn("CONVERSATION-02-LIVE", ids)
        self.assertNotIn("HUMAN-RUNTIME-01", ids)
        self.assertNotIn("BUDGET-CONTINUE-RUNTIME-QUOTA-01", ids)

        explicit_suite = RUN_EVALS.load_cases([RUN_EVALS.ROOT / "evals" / "conversation.json"])
        explicit_suite_ids = {case["id"] for case in explicit_suite}
        self.assertIn("CONVERSATION-02-LIVE", explicit_suite_ids)
        self.assertIn("HUMAN-RUNTIME-01", explicit_suite_ids)

        explicit_cases = RUN_EVALS.load_cases(include_opt_in=True)
        explicit_case_ids = {case["id"] for case in explicit_cases}
        self.assertIn("HUMAN-RUNTIME-01", explicit_case_ids)
        self.assertIn("BUDGET-CONTINUE-RUNTIME-QUOTA-01", explicit_case_ids)
        self.assertIn("BUDGET-CONTINUE-RUNTIME-SAME-OBJECTIVE-01", explicit_case_ids)

        self.assertEqual(RUN_EVALS.load_cases([]), [])
        self.assertIn("conversation.json", [path.name for path in RUN_EVALS.behavioral_eval_files(RUN_EVALS.ROOT / "evals")])

    def test_default_metadata_is_generic_and_fails_closed(self):
        from unittest.mock import patch
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root / "evals").mkdir()
            target = root / "evals" / "arbitrary-name.json"
            target.write_text(json.dumps({
                "cases": [
                    {"id": "ordinary"},
                    {"id": "costly", "default": False},
                ],
            }))
            with patch.object(RUN_EVALS, "ROOT", root):
                self.assertEqual([case["id"] for case in RUN_EVALS.load_cases()], ["ordinary"])
                self.assertEqual(
                    {case["id"] for case in RUN_EVALS.load_cases(include_opt_in=True)},
                    {"ordinary", "costly"},
                )
                self.assertEqual(
                    {case["id"] for case in RUN_EVALS.load_cases([target])},
                    {"ordinary", "costly"},
                )
                target.write_text(json.dumps({"cases": [{"id": "bad", "default": "false"}]}))
                with self.assertRaises(ValueError):
                    RUN_EVALS.load_cases()
                target.write_text(json.dumps({"default": "false", "cases": []}))
                with self.assertRaises(ValueError):
                    RUN_EVALS.load_cases()

    def test_response_is_isolated_and_has_no_decision_only_suffix(self):
        response = next(case for case in RUN_EVALS.load_cases() if case["id"] == "CONVERSATION-02-SYNTH")
        self.assertEqual(response["execution"], "conversation-response")
        self.assertEqual(RUN_EVALS.target_prompt(response), response["prompt"])
        decision = next(case for case in RUN_EVALS.load_cases() if case["id"] == "CONVERSATION-02")
        self.assertIn("production decision/action", RUN_EVALS.target_prompt(decision))
        temp, target, _ = RUN_EVALS.setup_projects(response)
        try:
            agents = target / ".opencode" / "agents"
            self.assertEqual(sorted(path.name for path in agents.iterdir()), ["general.md"])
            text = (agents / "general.md").read_text()
            self.assertIn("Isolated conversational-response evaluation boundary", text)
            self.assertIn('action: "*"', text)
            self.assertIn("effect: deny", text)
            self.assertNotIn("State the exact decision/action you would take and why.", text)
            self.assertFalse((target / ".opencode" / "plugins").exists())
            self.assertEqual(RUN_EVALS.case_workspace_mode(response), "ro")
        finally:
            import shutil
            shutil.rmtree(temp, ignore_errors=True)
        self.assertIn(response["prompt"], RUN_EVALS.judge_prompt(response, "answer", []))

    def test_source_references_are_distinct_and_come_from_supplied_context(self):
        case = {"prompt": "Sources: https://source.test/a and https://source.test/b", "output": {"min_source_urls": 2}}
        self.assertEqual(RUN_EVALS.deterministic_failures(case, [], text="[A](https://source.test/a) [B](https://source.test/b)"), [])
        self.assertTrue(RUN_EVALS.deterministic_failures(case, [], text="https://source.test/a https://source.test/a"))
        self.assertTrue(RUN_EVALS.deterministic_failures(case, [], text="https://unrelated.test/a https://unrelated.test/b"))
        self.assertTrue(RUN_EVALS.deterministic_failures(case, [], text="Research says so."))

    def test_action_equality_is_type_safe_and_conjunctive_within_one_call(self):
        expected = {"tool": "subagent", "args": {"agent": "research", "background": False}}
        self.assertTrue(RUN_EVALS.action_matches({"tool": "subagent", "args": {"agent": "research", "background": False}}, expected))
        self.assertFalse(RUN_EVALS.action_matches({"tool": "subagent", "args": {"agent": "research", "background": 0}}, expected))
        self.assertFalse(RUN_EVALS.action_matches({"tool": "subagent", "args": {"agent": "research", "background": True}}, expected))
        self.assertFalse(RUN_EVALS.action_matches({"tool": "subagent", "args": {"agent": "diagnostic", "background": False}}, expected))
        case = {"actions": {"requires": [expected]}}
        split = [{"tool": "subagent", "args": {"agent": "research", "background": True}}, {"tool": "subagent", "args": {"agent": "diagnostic", "background": False}}]
        self.assertTrue(RUN_EVALS.deterministic_failures(case, ["subagent"], split))
        self.assertFalse(RUN_EVALS.action_matches({"tool": "subagent", "args": {}}, {"tool": "subagent", "arg": "background", "equals": None}))
        self.assertTrue(RUN_EVALS.action_matches({"tool": "subagent", "args": {"background": None}}, {"tool": "subagent", "arg": "background", "equals": None}))

    def test_tool_result_assertions_bind_output_and_durable_json_state_to_observed_call(self):
        case = {
            "tool_results": {
                "requires": [
                    {
                        "tool": "loom_complete",
                        "args": {"workflowId": "eval-wf", "stepId": "review", "outcome": "fail"},
                        "json_path": "outcome",
                        "equals": "fail",
                    },
                    {
                        "tool": "loom_status",
                        "args": {"workflowId": "eval-wf", "detail": True},
                        "json_path": "workflow.steps.1.status",
                        "equals": "failed",
                    },
                ]
            }
        }
        results = {
            "schema": "opencode-eval-runner/tool-results/v1",
            "source": "opencode.event-stream.full",
            "observed_events": 2,
            "omitted_events": 0,
            "events": [
                {
                    "tool": "loom_complete",
                    "status": "completed",
                    "input": json.dumps({"workflowId": "eval-wf", "stepId": "review", "outcome": "fail"}),
                    "output": json.dumps({"finished": "review", "outcome": "fail"}),
                },
                {
                    "tool": "loom_status",
                    "status": "completed",
                    "input": json.dumps({"workflowId": "eval-wf", "detail": True}),
                    "output": json.dumps({"workflow": {"steps": [{"status": "complete"}, {"status": "failed"}]}}),
                },
            ],
        }
        self.assertEqual(
            RUN_EVALS.deterministic_failures(case, ["loom_complete", "loom_status"], tool_results=results),
            [],
        )

        results["events"][0]["output"] = json.dumps({"finished": "review", "outcome": "complete"})
        results["events"][1]["output"] = json.dumps({"workflow": {"steps": [{"status": "complete"}, {"status": "pending"}]}})
        failures = RUN_EVALS.deterministic_failures(
            case,
            ["loom_complete", "loom_status"],
            tool_results=results,
        )
        self.assertEqual(len(failures), 2)
        self.assertTrue(all(item.startswith("required tool result not observed:") for item in failures))

    def test_tool_result_assertions_fail_closed_on_missing_or_mismatched_events(self):
        case = {
            "tool_results": {
                "requires": [{
                    "tool": "loom_complete",
                    "args": {"workflowId": "eval-wf", "stepId": "worker"},
                    "output_contains": "Work steps require complete",
                }]
            }
        }
        self.assertTrue(RUN_EVALS.deterministic_failures(case, ["loom_complete"], tool_results=None))
        wrong_call = {
            "events": [{
                "tool": "loom_complete",
                "status": "completed",
                "input": json.dumps({"workflowId": "other", "stepId": "worker"}),
                "output": "Work steps require complete.",
            }]
        }
        self.assertTrue(RUN_EVALS.deterministic_failures(case, ["loom_complete"], tool_results=wrong_call))

    def test_code_mode_alias_requires_an_observed_inner_tool_event(self):
        assertion = {
            "tool": "loom_status",
            "args": {"workflowId": "eval-wf", "detail": True},
        }
        observed_inner = {
            "tool": "loom.code.status",
            "args": {"workflowId": "eval-wf", "detail": True},
        }
        self.assertTrue(RUN_EVALS.action_matches(observed_inner, assertion))

        wrapper_only = {
            "tool": "execute",
            "args": {"code": "return await tools.loom.code.status({workflowId:'eval-wf',detail:true})"},
        }
        self.assertFalse(RUN_EVALS.action_matches(wrapper_only, assertion))
        case = {
            "actions": {"requires": [assertion]},
            "tool_results": {"requires": [{
                **assertion,
                "json_path": "workflow.steps.0.status",
                "equals": "passed",
            }]},
        }
        wrapper_result = {
            "schema": "opencode-eval-runner/tool-results/v1",
            "source": "opencode.event-stream.full",
            "observed_events": 1,
            "omitted_events": 0,
            "events": [{
                "sequence": 1,
                "tool": "execute",
                "input": json.dumps(wrapper_only["args"]),
                "output": json.dumps({"workflow": {"steps": [{"status": "passed"}]}}),
            }],
        }
        failures = RUN_EVALS.deterministic_failures(
            case,
            ["execute"],
            [wrapper_only],
            tool_results=wrapper_result,
        )
        self.assertTrue(any(item.startswith("non-evidence:") for item in failures))

    def test_tool_result_occurrence_can_assert_state_after_the_operation(self):
        case = {
            "tool_results": {
                "requires": [{
                    "tool": "loom_status",
                    "args": {"workflowId": "eval-wf", "detail": True},
                    "occurrence": 2,
                    "after": {
                        "tool": "loom_complete",
                        "args": {"workflowId": "eval-wf", "stepId": "worker", "outcome": "pass"},
                    },
                    "json_path": "workflow.steps.0.status",
                    "equals": "pending",
                }]
            }
        }
        results = {
            "schema": "loom-tool-results/v1",
            "source": "target.stdout",
            "has_raw_trace": True,
            "unparsed_lines": 0,
            "observed_events": 3,
            "omitted_events": 0,
            "events": [
                {"sequence": 1, "tool": "loom_status", "input": json.dumps({"workflowId": "eval-wf", "detail": True}),
                 "output": json.dumps({"workflow": {"steps": [{"status": "complete"}]}})},
                {"sequence": 2, "tool": "loom_complete", "input": json.dumps({"workflowId": "eval-wf", "stepId": "worker", "outcome": "pass"}),
                 "output": json.dumps({"error": "Work steps require complete."})},
                {"sequence": 3, "tool": "loom_status", "input": json.dumps({"workflowId": "eval-wf", "detail": True}),
                 "output": json.dumps({"workflow": {"steps": [{"status": "pending"}]}})},
            ],
        }
        self.assertEqual(
            RUN_EVALS.deterministic_failures(case, ["loom_status"], tool_results=results),
            [],
        )
        case["tool_results"]["requires"][0]["occurrence"] = 1
        self.assertTrue(RUN_EVALS.deterministic_failures(case, ["loom_status"], tool_results=results))

    def test_tool_result_assertions_reject_incomplete_or_truncated_evidence(self):
        case = {
            "tool_results": {
                "requires": [{
                    "tool": "loom_status",
                    "args": {"workflowId": "eval-wf", "detail": True},
                    "json_path": "workflow.steps.0.status",
                    "equals": "pending",
                }]
            }
        }
        results = {
            "schema": "loom-tool-results/v1",
            "source": "target.stdout",
            "has_raw_trace": True,
            "unparsed_lines": 0,
            "observed_events": 2,
            "omitted_events": 1,
            "events": [{
                "tool": "loom_status",
                "input": json.dumps({"workflowId": "eval-wf", "detail": True}),
                "output": json.dumps({"workflow": {"steps": [{"status": "pending"}]}}),
            }],
        }
        failures = RUN_EVALS.deterministic_failures(case, ["loom_status"], tool_results=results)
        self.assertTrue(any("complete tool-result evidence unavailable" in failure for failure in failures))

        results["omitted_events"] = 0
        results["events"][0]["truncated_fields"] = ["output"]
        failures = RUN_EVALS.deterministic_failures(case, ["loom_status"], tool_results=results)
        self.assertTrue(any(failure.startswith("non-evidence:") for failure in failures))

    def test_gate_runtime_cases_expose_fixture_ids_and_assert_observed_state(self):
        suite = json.loads(
            (RUN_EVALS.ROOT / "evals" / "verification.json").read_text(encoding="utf-8")
        )
        cases = {
            case["id"]: case
            for case in suite["cases"]
            if case["id"].endswith("RUNTIME-01") or case["id"].startswith("GATE-")
        }
        expected = {
            "GATE-WORKER-BOUNDARY-RUNTIME-01",
            "GATE-REVIEWER-PASS-RUNTIME-01",
            "GATE-REVIEWER-FAIL-RUNTIME-01",
            "GATE-STALE-ATTEMPT-RUNTIME-01",
            "GATE-DEPENDENT-BLOCK-RUNTIME-01",
            "GATE-COORDINATOR-RESUME-RUNTIME-01",
        }
        for case_id in expected:
            with self.subTest(case=case_id):
                case = cases[case_id]
                self.assertEqual(case["execution"], "runtime")
                self.assertIn("tool_results", case)
                result_assertions = case["tool_results"].get("requires", [])
                self.assertTrue(result_assertions)
                self.assertTrue(any(
                    assertion["tool"] == "loom_status" and "json_path" in assertion
                    for assertion in result_assertions
                ))
                fixture_content = "\n".join(
                    fixture["content"]
                    for fixture in case.get("fixture_files", [])
                    if fixture["path"].endswith(".ts")
                )
                for assertion in case.get("actions", {}).get("requires", []):
                    for key in ("workflowId", "fromWorkflowId", "grantId", "stepId"):
                        value = assertion.get("args", {}).get(key)
                        if value:
                            self.assertIn(str(value), case["prompt"])
                self.assertNotIn("ses_", case["prompt"] + fixture_content)
                self.assertIn("event?.sessionID", fixture_content)

        reviewer_pass = cases["GATE-REVIEWER-PASS-RUNTIME-01"]
        ordinary_complete = {
            "workflowId": "eval-gate-reviewer-pass",
            "stepId": "review-implementation",
            "outcome": "complete",
        }
        self.assertTrue(any(
            action.get("tool") == "loom_complete" and action.get("args") == ordinary_complete
            for action in reviewer_pass["actions"]["requires"]
        ))
        self.assertTrue(any(
            result.get("tool") == "loom_complete" and result.get("args") == ordinary_complete and
            result.get("json_path") == "error" and
            result.get("equals") == "Gate steps require pass or fail."
            for result in reviewer_pass["tool_results"]["requires"]
        ))
        self.assertTrue(any(
            result.get("tool") == "loom_status" and
            result.get("json_path") == "workflow.steps.1.status" and
            result.get("equals") == "pending" and
            result.get("after", {}).get("args") == ordinary_complete
            for result in reviewer_pass["tool_results"]["requires"]
        ))
        self.assertFalse(any("must not call ordinary complete" in text.lower()
                             for text in reviewer_pass["must_not"]))

    def test_forbidden_tool_result_is_detected_by_exact_call_and_output(self):
        case = {
            "tool_results": {
                "forbids": [{
                    "tool": "loom_complete",
                    "args": {"workflowId": "eval-wf", "stepId": "review", "outcome": "pass"},
                    "json_path": "outcome",
                    "equals": "pass",
                }]
            }
        }
        results = {
            "schema": "loom-tool-results/v1",
            "source": "target.stdout",
            "has_raw_trace": True,
            "unparsed_lines": 0,
            "observed_events": 1,
            "omitted_events": 0,
            "events": [{
                "sequence": 1,
                "tool": "loom_complete",
                "input": json.dumps({"workflowId": "eval-wf", "stepId": "review", "outcome": "pass"}),
                "output": json.dumps({"error": "Gate PASS denied"}),
            }],
        }
        self.assertEqual(RUN_EVALS.deterministic_failures(case, ["loom_complete"], tool_results=results), [])

        results["events"][0]["output"] = json.dumps({"outcome": "pass"})
        self.assertTrue(any(
            failure.startswith("forbidden tool result observed:")
            for failure in RUN_EVALS.deterministic_failures(case, ["loom_complete"], tool_results=results)
        ))

    def test_nested_timeout_does_not_change_ordinary_defaults(self):
        live = next(
            case
            for case in RUN_EVALS.load_cases([RUN_EVALS.ROOT / "evals" / "conversation.json"])
            if case["id"] == "CONVERSATION-02-LIVE"
        )
        self.assertEqual(RUN_EVALS.case_target_timeout_seconds(live, 240), 360)
        self.assertEqual(RUN_EVALS.case_target_container_timeout(live, 300, 360), 420)
        self.assertEqual(RUN_EVALS.case_target_timeout_seconds({}, 240), 240)
        self.assertEqual(RUN_EVALS.case_target_container_timeout({}, 300, 240), 300)
        for bad in [True, "360", 0, 601]:
            with self.assertRaises(ValueError):
                RUN_EVALS.case_target_timeout_seconds({"target_timeout_seconds": bad}, 240)

    def test_non_runtime_modes_do_not_consume_runtime_concurrency(self):
        jobs = [({"execution": "conversation-response"}, 1), ({"execution": "role-decision"}, 1), ({"execution": "runtime"}, 1), ({"execution": "runtime"}, 2)]
        non_runtime, count, runtime, runtime_count, _ = RUN_EVALS.eval_job_concurrency(jobs, 6, 1)
        self.assertEqual((len(non_runtime), count, len(runtime), runtime_count), (2, 2, 2, 1))

    def test_one_primary_and_non_colliding_requirements(self):
        import re
        primary = [path.stem for path in (RUN_EVALS.ROOT / "agents").glob("*.md") if re.search(r"^mode: primary$", path.read_text(), re.M)]
        self.assertEqual(primary, ["general"])
        brainstorm = (RUN_EVALS.ROOT / "agents" / "brainstorm.md").read_text()
        self.assertIn('action: shell\n    resource: "*"\n    effect: deny', brainstorm)
        requirements = RUN_EVALS.ROOT / "docs" / "requirements" / "loom"
        self.assertEqual(len(list(requirements.glob("br-019-*.md"))), 1)
        self.assertEqual(len(list(requirements.glob("br-020-*.md"))), 1)
        self.assertTrue((requirements / "br-019-keep-workflow-ceremony-proportional.md").is_file())
        self.assertTrue((requirements / "br-020-conversation-is-primary-interface.md").is_file())


class ConversationalFeedbackCostTests(unittest.TestCase):
    def test_handoff_and_observed_impact_probes_do_not_install_subagents(self):
        import shutil
        expected = {
            "CONVERSATION-02-HANDOFF": "conversation-response",
            "AUTO-ORCHESTRATION-03": "role-decision",
        }
        cases = {case["id"]: case for case in RUN_EVALS.load_cases()}
        for case_id, execution in expected.items():
            with self.subTest(case=case_id):
                case = cases[case_id]
                self.assertEqual(case["execution"], execution)
                self.assertEqual(RUN_EVALS.case_workspace_mode(case), "ro")
                temp, target, _ = RUN_EVALS.setup_projects(case)
                try:
                    agents = target / ".opencode" / "agents"
                    self.assertEqual(sorted(p.name for p in agents.iterdir()), ["general.md"])
                    wrapper = (agents / "general.md").read_text()
                    self.assertIn('action: "*"', wrapper)
                    self.assertIn('effect: deny', wrapper)
                finally:
                    shutil.rmtree(temp, ignore_errors=True)


class ArtifactHandoffCostTests(unittest.TestCase):
    def test_artifact_probes_are_default_isolated_and_do_not_expose_rubrics(self):
        import shutil
        cases = {case["id"]: case for case in RUN_EVALS.load_cases()}
        expected = {
            "AUTO-ORCHESTRATION-01-HANDOFF": "conversation-response",
            "AUTO-ORCHESTRATION-01-RECORDS": "role-decision",
        }
        self.assertNotIn("CONVERSATION-02-LIVE", cases)
        for case_id, execution in expected.items():
            with self.subTest(case=case_id):
                case = cases[case_id]
                self.assertEqual(case["execution"], execution)
                self.assertEqual(RUN_EVALS.case_workspace_mode(case), "ro")
                prompt = RUN_EVALS.target_prompt(case)
                self.assertIn(case["prompt"], prompt)
                for criterion in case["expectations"] + case["must_not"]:
                    self.assertNotIn(criterion, prompt)
                temp, target, _ = RUN_EVALS.setup_projects(case)
                try:
                    agents = target / ".opencode" / "agents"
                    self.assertEqual(sorted(p.name for p in agents.iterdir()), ["general.md"])
                    wrapper = (agents / "general.md").read_text()
                    self.assertIn('action: "*"', wrapper)
                    self.assertIn('effect: deny', wrapper)
                finally:
                    shutil.rmtree(temp, ignore_errors=True)


if __name__ == "__main__":
    unittest.main()
