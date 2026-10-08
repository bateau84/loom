"""Provider-free Stage-1 coverage of Loom's generic paired ablation cutover."""
from __future__ import annotations

import importlib.util
import json
import sys
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest import mock

SCRIPTS = Path(__file__).resolve().parent
if str(SCRIPTS) not in sys.path:
    sys.path.insert(0, str(SCRIPTS))

bridge_spec = importlib.util.spec_from_file_location("loom_paired_bridge", SCRIPTS / "run-skill-ablation.py")
assert bridge_spec and bridge_spec.loader
bridge = importlib.util.module_from_spec(bridge_spec)
bridge_spec.loader.exec_module(bridge)


def args(**changes):
    values = {
        "model": "fixture/target",
        "judge_model": "fixture/judge",
        "target_transport": "opencode",
        "judge_transport": "opencode",
        "engine": "auto",
        "network": None,
        "reasoning": "medium",
        "target_reasoning": None,
        "judge_reasoning": None,
        "timeout_seconds": None,
        "container_timeout": None,
        "transport_retries": 0,
        "iterations": 1,
        "parallel": 1,
        "runtime_parallel": 1,
        "keep_temp": False,
    }
    values.update(changes)
    return SimpleNamespace(**values)


def fixture_root(root: Path, *, trap: str = "Ignore critical flaw.") -> None:
    skill = root / "skills" / "demo"
    evals = skill / "evals"
    evals.mkdir(parents=True)
    (skill / "SKILL.md").write_text("# Demo methodology\nCheck all constraints.\n", encoding="utf-8")
    (skill / "ASSESSMENT.md").write_text("reviewer only\n", encoding="utf-8")
    (skill / "QA.md").write_text("critic only\n", encoding="utf-8")
    (evals / "cases.json").write_text(json.dumps({
        "skill": "demo",
        "cases": [
            {
                "id": "S1",
                "prompt": "Check this design.",
                "trap": trap,
                "expectations": ["Check the design."],
                "negative_expectations": ["Never invent proof."],
            },
            {
                "id": "S2",
                "prompt": "Explain the algorithm.",
                "expectations": ["Explain the algorithm."],
                "negative_expectations": ["Do not guess."],
            },
        ],
    }), encoding="utf-8")


class PairInvoker:
    """Deterministic OpenCode-shaped target and strict judge results."""

    def __init__(
        self, *, baseline_good=False, candidate_good=True, candidate_loaded=True,
        invalid_baseline=False, raw_judge_text=None,
    ):
        self.baseline_good = baseline_good
        self.candidate_good = candidate_good
        self.candidate_loaded = candidate_loaded
        self.invalid_baseline = invalid_baseline
        self.raw_judge_text = raw_judge_text or {}
        self.calls: list[tuple[str, str]] = []

    def __call__(self, spec):
        from container.runtime_evidence import (
            build_runtime_evidence, field_available, unsupported_runtime_evidence,
        )
        from runner.eval_execute import RESULT_SCHEMA

        side = "baseline" if spec.agent == "skill-baseline" or spec.workspace.name == "judge-baseline" else "candidate"
        is_judge = spec.agent == "eval-judge"
        self.calls.append((side, "judge" if is_judge else "target"))
        good = self.baseline_good if side == "baseline" else self.candidate_good

        if is_judge:
            grade = {
                "passed": good,
                "expectations": [
                    {
                        "expectation": "Check the design.",
                        "met": good,
                        "reason": "Observed output.",
                    }
                ],
                "violations": [
                    {
                        "rule": "Never invent proof.",
                        "violated": False,
                        "reason": "No fabricated proof.",
                    }
                ],
                "trap_observed": not good,
                "trap_evidence": "No flaw reviewed." if not good else "Flaw reviewed.",
                "summary": "Satisfies methodology." if good else "Missed requirement.",
            }
            payload = self.raw_judge_text.get(side, json.dumps(grade))
        else:
            payload = "Output for " + side
        result = {
            "schema": RESULT_SCHEMA,
            "transport": spec.transport,
            "model": spec.model,
            "reasoning": spec.reasoning or "provider-default",
            "reasoning_source": "explicit" if spec.reasoning is not None else "provider-default",
            "exit_code": 0,
            "stderr": "",
            "text": payload,
            "tools": [],
            "actions": [],
            "session_id": "fixture-session-1",
            "runtime_evidence": unsupported_runtime_evidence("loom_pair_provider_free"),
            "skills_loaded": ["demo"] if side == "candidate" and self.candidate_loaded and not is_judge else [],
        }
        if spec.transport == "opencode":
            records = []
            if not is_judge and side == "candidate" and self.candidate_loaded:
                shared = {
                    "invocation_id": "native:fixture-skill-load",
                    "tool": field_available("skill"),
                    "agent": field_available("skill-eval"),
                    "session_id": field_available("fixture-session-1"),
                    "message_id": field_available("fixture-message-1"),
                    "call_id": field_available("fixture-call-1"),
                }
                records = [
                    {
                        **shared, "kind": "native_start", "sequence": 1,
                        "input": field_available({"id": "demo"}),
                        "parent_session_id": field_available(None),
                        "boundary": "decoded-tool-execute",
                    },
                    {
                        **shared, "kind": "native_terminal", "sequence": 2,
                        "outcome": "success",
                        "result": field_available({"content": "demo skill loaded"}),
                        "boundary": "session.tool.success",
                    },
                ]
            result["runtime_evidence"] = build_runtime_evidence({
                "capture_started": True,
                "capture_ended": True,
                "records": records,
                "observer_failures": 0,
                "callback_failures": 0,
                "issues": [],
            })
        if not is_judge and side == "baseline" and self.invalid_baseline:
            result["runtime_evidence"] = {"schema": "untrusted"}
        return 0, result


class SkillAblationCutoverTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        # Paired engine is an installed tool, never vendored into Loom.
        # Local developer tests without the optional CLI can run the rest of
        # Loom's suite; CI installs runner #64 and executes these tests in full.
        try:
            bridge._bootstrap_runner()
        except RuntimeError as exc:
            raise unittest.SkipTest(str(exc)) from exc
        from loom_eval_profile.skill_ablation import LoomSkillAblationProfile
        cls.Profile = LoomSkillAblationProfile

    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="loom-cutover-test-")
        self.root = Path(self.temp.name)
        fixture_root(self.root)
        self.a = args()
        self.profile = self.Profile(self.a, root=self.root)
        self.case = self.profile.discover_cases()[0]

    def tearDown(self):
        self.temp.cleanup()

    def pair(self, fake, *, iteration=1):
        from runner.eval_paired import (
            PairedExecutionPolicy, build_paired_eval_artifact,
            run_paired_evaluation,
        )

        with self.profile.prepare_pair(self.case, iteration) as (baseline, candidate):
            value = run_paired_evaluation(
                run_id="provider-free-run",
                iteration=iteration,
                baseline=self.profile.side_input(self.case, baseline),
                candidate=self.profile.side_input(self.case, candidate),
                policy=PairedExecutionPolicy(mode="sequential"),
                comparison_extension=self.profile.comparison(self.case),
                target_invoker=fake,
                judge_invoker=fake,
                sleep=lambda _: None,
            )
            artifact = build_paired_eval_artifact(value)
        return value, artifact

    def test_discovery_and_isolated_skill_workspace(self):
        cases = self.profile.discover_cases()
        self.assertEqual([case.id for case in cases], ["SKILL-demo-S1", "SKILL-demo-S2"])
        self.assertIn("S1", cases[0].selectors)
        self.assertEqual(cases[0].metadata["evaluation_mode"], "skill-ablation")
        with self.profile.prepare_pair(self.case, 2) as (baseline, candidate):
            self.assertFalse((baseline.target_workspace / ".opencode" / "skills" / "demo").exists())
            candidate_skill = candidate.target_workspace / ".opencode" / "skills" / "demo"
            self.assertTrue((candidate_skill / "SKILL.md").is_file())
            self.assertFalse((candidate_skill / "evals").exists())
            self.assertFalse((candidate_skill / "ASSESSMENT.md").exists())
            self.assertFalse((candidate_skill / "QA.md").exists())
            baseline_agent = (baseline.target_workspace / ".opencode" / "agents" / "skill-baseline.md").read_text()
            candidate_agent = (candidate.target_workspace / ".opencode" / "agents" / "skill-eval.md").read_text()
            self.assertIn("Do not load or infer repository skills", baseline_agent)
            self.assertIn("Load the native skill", candidate_agent)
            self.assertIn("reasoning-only", candidate_agent)
            self.assertNotEqual(baseline.judge_workspace, candidate.judge_workspace)
            self.assertTrue((baseline.judge_workspace / ".opencode" / "agents" / "eval-judge.md").is_file())
            self.assertEqual(self.profile.target_spec(self.case, baseline).skill, None)
            self.assertEqual(self.profile.target_spec(self.case, candidate).skill, "demo")
            temp_root = baseline.target_workspace.parent
        self.assertFalse(temp_root.exists())

    def test_skill_ablation_uses_ci_pinned_image_not_edge_by_default(self):
        from loom_eval_profile.skill_ablation import PAIRED_TRANSPORT_IMAGES
        with mock.patch.dict(
            "os.environ",
            {
                "OPENCODE_EVAL_RUNNER_OPENCODE_IMAGE": "",
                "OPENCODE_EVAL_RUNNER_COPILOT_IMAGE": "",
                "OPENCODE_EVAL_RUNNER_IMAGE": "",
            },
        ):
            with self.profile.prepare_pair(self.case, 1) as (baseline, candidate):
                for side in (baseline, candidate):
                    spec = self.profile.target_spec(self.case, side)
                    self.assertEqual(spec.image, PAIRED_TRANSPORT_IMAGES["opencode"])
                    self.assertIn("@sha256:", spec.image)
                    self.assertNotIn("-edge", spec.image)
                    self.assertEqual(
                        self.profile._spec(
                            side=side, skill="demo", phase="judge",
                            prompt="test", system=None,
                        ).image,
                        PAIRED_TRANSPORT_IMAGES["opencode"],
                    )

    def test_explicit_transport_image_overrides_pinned_default(self):
        from loom_eval_profile.skill_ablation import PAIRED_TRANSPORT_IMAGES
        custom_open = "localhost/custom-opencode@sha256:123"
        custom_generic = "localhost/shared@sha256:345"
        with mock.patch.dict(
            "os.environ",
            {
                "OPENCODE_EVAL_RUNNER_OPENCODE_IMAGE": custom_open,
                "OPENCODE_EVAL_RUNNER_COPILOT_IMAGE": "",
                "OPENCODE_EVAL_RUNNER_IMAGE": custom_generic,
            },
        ):
            with self.profile.prepare_pair(self.case, 1) as (baseline, _):
                self.assertEqual(self.profile.target_spec(self.case, baseline).image, custom_open)
                self.assertEqual(
                    self.profile._spec(
                        side=baseline, skill="demo", phase="judge",
                        prompt="test", system=None,
                    ).image,
                    custom_open,
                )
            self.assertNotEqual(PAIRED_TRANSPORT_IMAGES["opencode"], custom_open)
            copilot = self.Profile(
                args(target_transport="github-copilot-cli", judge_transport="github-copilot-cli"),
                root=self.root,
            )
            with copilot.prepare_pair(self.case, 1) as (baseline, _):
                self.assertEqual(copilot.target_spec(self.case, baseline).image, custom_generic)

    def test_ablation_score_trap_and_generic_paired_artifact(self):
        from runner.eval_artifacts import (
            ArtifactIdentity, claim_run_artifact_directory, validate_paired_eval_artifact,
        )
        fake = PairInvoker()
        outcome, artifact = self.pair(fake)
        self.assertEqual(fake.calls, [
            ("baseline", "target"), ("baseline", "judge"),
            ("candidate", "target"), ("candidate", "judge"),
        ])
        self.assertEqual((outcome.baseline.classification, outcome.candidate.classification), ("fail", "pass"))
        self.assertEqual(outcome.comparison.status, "compared")
        decision = outcome.comparison.decision
        self.assertEqual(decision.classification, "pass")
        self.assertTrue(decision.data["trap_fixed"])
        self.assertEqual(decision.data["skill_value"], "material-improvement")
        self.assertEqual(decision.data["baseline_score"], 1 / 3)
        self.assertEqual(decision.data["candidate_score"], 1)
        self.assertEqual(artifact["schema"], "opencode-eval-runner/eval-paired-artifact/v1")
        self.assertIn("target", artifact["sides"]["baseline"])
        self.assertIn("judge", artifact["sides"]["candidate"])
        validate_paired_eval_artifact(artifact)
        store = claim_run_artifact_directory(self.root / "paired-artifacts", "provider-free-run")
        identity = ArtifactIdentity("provider-free-run", self.case.id, 1)
        store.write_paired_job_artifact(identity, artifact)
        reread = store.read_paired_job_artifact(identity)
        self.assertEqual(reread["paired_artifact_evidence_id"], artifact["paired_artifact_evidence_id"])

    def test_regression_is_absolute_fail_even_when_both_sides_judged(self):
        outcome, artifact = self.pair(PairInvoker(baseline_good=True, candidate_good=False))
        self.assertEqual(outcome.comparison.status, "compared")
        self.assertEqual(outcome.comparison.decision.classification, "fail")
        self.assertEqual(outcome.comparison.decision.data["skill_value"], "regression")
        self.assertTrue(outcome.comparison.decision.data["trap_regression"])
        self.assertEqual(bridge._pair_outcome(artifact), "fail")

    def test_one_side_invalid_evidence_blocks_comparison_not_zero(self):
        fake = PairInvoker(invalid_baseline=True)
        outcome, artifact = self.pair(fake)
        self.assertEqual(outcome.baseline.classification, "non-evidence")
        self.assertEqual(outcome.comparison.status, "non-evidence")
        self.assertIsNone(outcome.comparison.decision)
        self.assertEqual(bridge._pair_outcome(artifact), "non-evidence")
        self.assertNotIn("delta_pp", artifact["comparison"])
        self.assertIn(("candidate", "judge"), fake.calls)

    def test_malformed_raw_judges_are_non_evidence_through_paired_lifecycle(self):
        from runner.eval_artifacts import validate_paired_eval_artifact

        grade = json.dumps({
            "passed": True,
            "expectations": [{
                "expectation": "Check the design.",
                "met": True,
                "reason": "Observed output.",
            }],
            "violations": [{
                "rule": "Never invent proof.",
                "violated": False,
                "reason": "No fabricated proof.",
            }],
            "trap_observed": False,
            "trap_evidence": "Flaw reviewed.",
            "summary": "Satisfies methodology.",
        })
        grade_fields = grade[1:-1]
        malformed = {
            "duplicate top-level passed": '{"passed":false,' + grade_fields + "}",
            "discarded non-json duplicate": '{"summary":NaN,' + grade_fields + "}",
            "non-json NaN": grade.replace('"summary": "Satisfies methodology."', '"summary": NaN'),
            "non-json Infinity": grade.replace('"summary": "Satisfies methodology."', '"summary": Infinity'),
            "nested duplicate": grade.replace('"met": true', '"met": false, "met": true'),
        }

        for side in ("baseline", "candidate"):
            for name, raw_text in malformed.items():
                with self.subTest(side=side, name=name):
                    outcome, artifact = self.pair(PairInvoker(raw_judge_text={side: raw_text}))

                    self.assertEqual(getattr(outcome, side).classification, "non-evidence")
                    self.assertEqual(outcome.comparison.status, "non-evidence")
                    self.assertIsNone(outcome.comparison.decision)
                    self.assertEqual(bridge._pair_outcome(artifact), "non-evidence")
                    self.assertNotIn("delta_pp", artifact["comparison"])
                    self.assertNotIn("baseline_score", artifact["comparison"])
                    self.assertNotIn("candidate_score", artifact["comparison"])
                    validate_paired_eval_artifact(artifact)

    def test_valid_fenced_and_unfenced_raw_judges_remain_supported(self):
        grade = json.dumps({
            "passed": True,
            "expectations": [{
                "expectation": "Check the design.",
                "met": True,
                "reason": "Observed output.",
            }],
            "violations": [{
                "rule": "Never invent proof.",
                "violated": False,
                "reason": "No fabricated proof.",
            }],
            "trap_observed": False,
            "trap_evidence": "Flaw reviewed.",
            "summary": "Satisfies methodology.",
        })

        for name, raw_text in (
            ("unfenced", grade),
            ("fenced", f"```json\n{grade}\n```"),
            ("plain fenced", f"```\n{grade}\n```"),
            ("tilde fenced", f"~~~json\n{grade}\n~~~"),
        ):
            with self.subTest(name=name):
                outcome, artifact = self.pair(PairInvoker(raw_judge_text={"baseline": raw_text, "candidate": raw_text}))

                self.assertEqual(outcome.baseline.classification, "pass")
                self.assertEqual(outcome.candidate.classification, "pass")
                self.assertEqual(outcome.comparison.status, "compared")
                self.assertEqual(outcome.comparison.decision.classification, "pass")
                self.assertIn("delta_pp", artifact["comparison"]["decision"]["data"])

    def test_missing_native_skill_load_fails_candidate_absolute_correctness(self):
        outcome, _ = self.pair(PairInvoker(candidate_loaded=False))
        self.assertEqual(outcome.candidate.classification, "fail")
        self.assertEqual(outcome.comparison.decision.classification, "fail")
        self.assertTrue(any(check.name == "skill.native-load" for check in outcome.candidate.deterministic_checks))

    def test_target_requires_authoritative_native_boundary(self):
        with self.profile.prepare_pair(self.case, 1) as (baseline, candidate):
            for side in (baseline, candidate):
                requirement = self.profile.side_input(self.case, side).evidence_requirement
                self.assertEqual(requirement.boundaries, ("native",))

    def test_diagnostic_skill_load_cannot_manufacture_native_success(self):
        from container.runtime_evidence import build_runtime_evidence

        class FakeNativeLoad(PairInvoker):
            def __call__(self, spec):
                status, result = super().__call__(spec)
                if spec.agent == "skill-eval":
                    # Product convenience field still says skill loaded, but
                    # no runner-owned native tool invocation occurred.
                    result["runtime_evidence"] = build_runtime_evidence({
                        "capture_started": True,
                        "capture_ended": True,
                        "records": [],
                        "observer_failures": 0,
                        "callback_failures": 0,
                        "issues": [],
                    })
                return status, result

        outcome, artifact = self.pair(FakeNativeLoad())
        self.assertEqual(outcome.candidate.classification, "fail")
        self.assertEqual(outcome.comparison.decision.classification, "fail")
        self.assertTrue(any(check.name == "skill.native-load" for check in outcome.candidate.deterministic_checks))

    def test_unsupported_runtime_evidence_is_non_evidence_even_with_skill_projection(self):
        from container.runtime_evidence import unsupported_runtime_evidence

        class UnsupportedNative(PairInvoker):
            def __call__(self, spec):
                status, result = super().__call__(spec)
                if spec.agent == "skill-eval":
                    result["runtime_evidence"] = unsupported_runtime_evidence("no_native_capture")
                return status, result

        outcome, artifact = self.pair(UnsupportedNative())
        self.assertEqual(outcome.candidate.classification, "non-evidence")
        self.assertEqual(outcome.comparison.status, "non-evidence")
        self.assertEqual(bridge._pair_outcome(artifact), "non-evidence")

    def test_redacted_native_skill_input_cannot_be_backfilled_from_diagnostics(self):
        from container.runtime_evidence import build_runtime_evidence, field_available

        class RedactedInput(PairInvoker):
            def __call__(self, spec):
                status, result = super().__call__(spec)
                if spec.agent == "skill-eval":
                    fields = {
                        "invocation_id": "native:fixture-load-redacted",
                        "tool": field_available("skill"),
                        "agent": field_available("skill-eval"),
                        "session_id": field_available("fixture-session-1"),
                        "message_id": field_available("fixture-message-1"),
                        "call_id": field_available("fixture-call-1"),
                    }
                    result["runtime_evidence"] = build_runtime_evidence({
                        "capture_started": True, "capture_ended": True,
                        "records": [
                            {
                                **fields, "kind": "native_start", "sequence": 1,
                                "input": {"state": "redacted", "reason": "credential_match"},
                                "parent_session_id": field_available(None),
                                "boundary": "decoded-tool-execute",
                            },
                            {
                                **fields, "kind": "native_terminal", "sequence": 2,
                                "outcome": "success",
                                "result": field_available({"content": "loaded"}),
                                "boundary": "session.tool.success",
                            },
                        ],
                        "observer_failures": 0, "callback_failures": 0, "issues": [],
                    })
                return status, result

        outcome, artifact = self.pair(RedactedInput())
        self.assertEqual(outcome.candidate.classification, "non-evidence")
        self.assertEqual(outcome.comparison.status, "non-evidence")
        self.assertEqual(bridge._pair_outcome(artifact), "non-evidence")

    def test_redacted_target_session_does_not_become_behavioral_fail(self):
        class RedactedSession(PairInvoker):
            def __call__(self, spec):
                status, result = super().__call__(spec)
                if spec.agent == "skill-eval":
                    result["session_id"] = "***REDACTED***"
                return status, result

        outcome, artifact = self.pair(RedactedSession())
        self.assertEqual(outcome.candidate.classification, "non-evidence")
        self.assertEqual(outcome.comparison.status, "non-evidence")
        self.assertEqual(bridge._pair_outcome(artifact), "non-evidence")

    def test_native_load_in_wrong_actor_does_not_satisfy_candidate(self):
        class WrongActor(PairInvoker):
            def __call__(self, spec):
                status, result = super().__call__(spec)
                if spec.agent == "skill-eval":
                    result["runtime_evidence"]["observations"][0]["actor"]["value"] = "other-agent"
                return status, result

        outcome, artifact = self.pair(WrongActor())
        self.assertEqual(outcome.candidate.classification, "fail")
        self.assertEqual(outcome.comparison.decision.classification, "fail")
        self.assertTrue(any(check.name == "skill.native-load" for check in outcome.candidate.deterministic_checks))

    def test_baseline_native_skill_contamination_blocks_comparison(self):
        from container.runtime_evidence import build_runtime_evidence, field_available

        class ContaminatedBaseline(PairInvoker):
            def __call__(self, spec):
                status, result = super().__call__(spec)
                if spec.agent == "skill-baseline":
                    common = {
                        "invocation_id": "native:baseline-load",
                        "tool": field_available("skill"),
                        "agent": field_available("skill-baseline"),
                        "session_id": field_available("fixture-session-1"),
                        "message_id": field_available("fixture-message-1"),
                        "call_id": field_available("fixture-call-1"),
                    }
                    result["runtime_evidence"] = build_runtime_evidence({
                        "capture_started": True, "capture_ended": True,
                        "records": [
                            {
                                **common, "kind": "native_start", "sequence": 1,
                                "input": field_available({"id": "demo"}),
                                "parent_session_id": field_available(None),
                                "boundary": "decoded-tool-execute",
                            },
                            {
                                **common, "kind": "native_terminal", "sequence": 2,
                                "outcome": "success",
                                "result": field_available({"content": "loaded"}),
                                "boundary": "session.tool.success",
                            },
                        ],
                        "observer_failures": 0, "callback_failures": 0, "issues": [],
                    })
                    # Contradictory diagnostic claims none loaded.
                    result["skills_loaded"] = []
                return status, result

        outcome, artifact = self.pair(ContaminatedBaseline())
        self.assertEqual(outcome.baseline.classification, "non-evidence")
        self.assertEqual(outcome.comparison.status, "non-evidence")

    def test_missing_score_projection_is_non_evidence(self):
        class MissingProjection(PairInvoker):
            def __call__(self, spec):
                status, result = super().__call__(spec)
                if spec.agent == "skill-baseline":
                    result.pop("skills_loaded", None)
                return status, result

        outcome, artifact = self.pair(MissingProjection())
        self.assertEqual(outcome.baseline.classification, "non-evidence")
        self.assertEqual(bridge._pair_outcome(artifact), "non-evidence")

    def test_redacted_target_text_is_non_evidence(self):
        class RedactedOutput(PairInvoker):
            def __call__(self, spec):
                status, result = super().__call__(spec)
                if spec.agent == "skill-eval":
                    result["text"] = "***REDACTED***"
                return status, result

        outcome, artifact = self.pair(RedactedOutput())
        self.assertEqual(outcome.candidate.classification, "non-evidence")
        self.assertEqual(bridge._pair_outcome(artifact), "non-evidence")

    def test_copilot_inline_methodology_and_native_skill_scopes(self):
        self.profile = self.Profile(args(target_transport="github-copilot-cli", judge_transport="github-copilot-cli"), root=self.root)
        with self.profile.prepare_pair(self.case, 1) as (baseline, candidate):
            base_spec = self.profile.target_spec(self.case, baseline)
            cand_spec = self.profile.target_spec(self.case, candidate)
            self.assertNotIn("Check all constraints.", base_spec.system)
            self.assertIn("Check all constraints.", cand_spec.system)
            self.assertIn("reasoning-only", cand_spec.system)
            self.assertIsNone(base_spec.skill)
            self.assertIsNone(cand_spec.skill)

    def test_generic_multi_iteration_expansion(self):
        from runner.eval_plan import build_run_plan
        plan = build_run_plan(
            "two-iterations", self.profile.discover_cases(),
            selectors=[self.case.id], iterations=2, standard_parallelism=2,
        )
        self.assertEqual([(job.case.id, job.iteration) for job in plan.jobs], [
            (self.case.id, 1), (self.case.id, 2),
        ])
        self.assertEqual(plan.standard_parallelism, 2)
        for iteration in (1, 2):
            outcome, artifact = self.pair(PairInvoker(), iteration=iteration)
            self.assertEqual(artifact["iteration"], iteration)
            self.assertEqual(outcome.comparison.decision.classification, "pass")

    def test_bridge_end_to_end_provider_free_and_persisted_manifest(self):
        from runner import eval_paired
        from runner.eval_artifacts import ArtifactIdentity, RunArtifactStore
        import loom_eval_profile.skill_ablation as skill_module

        fake = PairInvoker()
        actual = eval_paired.run_paired_evaluation

        def no_provider_inference(**kwargs):
            return actual(
                **kwargs, target_invoker=fake, judge_invoker=fake,
                sleep=lambda _: None,
            )

        options = args()
        options.cases = self.case.id
        options.artifact_dir = str(self.root / "bridge-run")
        with (
            mock.patch.object(
                skill_module, "LoomSkillAblationProfile",
                side_effect=lambda received: self.Profile(received, root=self.root),
            ),
            mock.patch.object(
                eval_paired, "run_paired_evaluation",
                side_effect=no_provider_inference,
            ),
        ):
            status = bridge.run(options)
        self.assertEqual(status, 0)
        manifest = json.loads((Path(options.artifact_dir) / "run.json").read_text())
        self.assertEqual(manifest["summary"]["pass"], 1)
        self.assertEqual(manifest["summary"]["errors"], 0)
        self.assertEqual(manifest["jobs"][0]["status"], "pass")
        self.assertTrue(manifest["jobs"][0]["artifact"].startswith("pairs/"))
        store = RunArtifactStore(root=Path(options.artifact_dir).resolve(), run_id=manifest["run_id"])
        paired = store.read_paired_job_artifact(ArtifactIdentity(manifest["run_id"], self.case.id, 1))
        self.assertEqual(bridge._pair_outcome(paired), "pass")
        self.assertIn(("baseline", "judge"), fake.calls)
        self.assertIn(("candidate", "judge"), fake.calls)

    def test_real_loom_skill_owned_profiles_can_prepare_without_inference(self):
        real = self.Profile(self.a)
        cases = [case for case in real.discover_cases() if case.id.startswith("SKILL-skills-eval-")]
        self.assertTrue(cases, "expected Loom skills-eval cases in repository")
        with real.prepare_pair(cases[0], 1) as (baseline, candidate):
            self.assertNotIn("skills-eval", [
                entry.name for entry in (baseline.target_workspace / ".opencode" / "skills").iterdir()
            ])
            self.assertTrue(
                (candidate.target_workspace / ".opencode" / "skills" / "skills-eval" / "SKILL.md").is_file()
            )
            self.assertEqual(real.target_spec(cases[0], candidate).skill, "skills-eval")

    def test_importable_paired_runner_needs_no_cli_on_path(self):
        # The generic paired API can already be supplied on PYTHONPATH.
        with (
            mock.patch.dict("os.environ", {"OPENCODE_EVAL_RUNNER_BIN": ""}),
            mock.patch.object(bridge.shutil, "which", return_value=None),
        ):
            bridge._bootstrap_runner()

    def test_missing_library_and_binary_gives_actionable_error(self):
        with (
            mock.patch.dict("os.environ", {"OPENCODE_EVAL_RUNNER_BIN": ""}),
            mock.patch.object(bridge.importlib.util, "find_spec", return_value=None),
            mock.patch.object(bridge.shutil, "which", return_value=None),
        ):
            with self.assertRaisesRegex(RuntimeError, "PYTHONPATH"):
                bridge._bootstrap_runner()

    def test_non_evidence_cli_reports_per_side_causes_without_raw_output(self):
        artifact = {
            "sides": {
                "baseline": {
                    "classification": "non-evidence",
                    "target": {
                        "attempts": [
                            {
                                "failure": {
                                    "plane": "product",
                                    "code": "product_error",
                                    "message": "provider rejected authentication",
                                },
                                "result": {"text": "secret private prompt"},
                            }
                        ],
                        "evidence_readiness": {"status": "ready", "reasons": []},
                    },
                    "judge": {"attempts": []},
                    "deterministic_checks": [],
                },
                "candidate": {
                    "classification": "non-evidence",
                    "target": {
                        "attempts": [
                            {
                                "failure": None,
                            }
                        ],
                        "evidence_readiness": {
                            "status": "incomplete",
                            "reasons": ["native_missing"],
                        },
                    },
                    "judge": {
                        "attempts": [],
                        "contract_failure": {
                            "plane": "infrastructure",
                            "code": "judge_contract_invalid",
                            "message": "wrong shape",
                        },
                    },
                    "deterministic_checks": [
                        {
                            "status": "non-evidence",
                            "name": "skill.discovery",
                            "reason": "skill load evidence missing",
                        }
                    ],
                },
            }
        }
        notes = bridge.side_evidence_notes(artifact)
        self.assertEqual(len(notes), 2)
        self.assertIn("baseline:", notes[0])
        self.assertIn("product/product_error", notes[0])
        self.assertIn("candidate:", notes[1])
        self.assertIn("readiness incomplete", notes[1])
        self.assertIn("skill.discovery", notes[1])
        self.assertIn("judge_contract_invalid", notes[1])
        self.assertNotIn("secret private prompt", " ".join(notes))

    def test_side_notes_do_not_manufacture_failures_for_valid_classifications(self):
        self.assertEqual(
            bridge.side_evidence_notes({
                "sides": {
                    "baseline": {"classification": "pass"},
                    "candidate": {"classification": "fail"},
                }
            }),
            [],
        )

    def test_missing_paired_engine_refused_before_inference(self):
        with tempfile.TemporaryDirectory() as tmp:
            binary = Path(tmp) / "bin" / "opencode-eval-runner"
            binary.parent.mkdir()
            binary.write_text("#!/bin/sh\n", encoding="utf-8")
            with mock.patch.dict("os.environ", {"OPENCODE_EVAL_RUNNER_BIN": str(binary)}):
                with self.assertRaisesRegex(RuntimeError, "lacks generic paired mode"):
                    bridge._bootstrap_runner()


if __name__ == "__main__":
    unittest.main()
