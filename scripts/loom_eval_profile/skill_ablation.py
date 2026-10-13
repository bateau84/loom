"""Loom skill-owned paired eval policy for issue #127, Stage 1.

The generic runner owns target/judge execution, retries, evidence readiness,
non-evidence classification, pairing and artifact integrity. This module owns
Loom's skill fixtures, prompt, trap, score and comparison policy.

Legacy skill discovery and prompt text remain as explicit cleanup-stage debt.
"""
from __future__ import annotations

import importlib.util
import os
import re
import shutil
import sys
import tempfile
from collections.abc import Iterator, Mapping, Sequence
from contextlib import contextmanager
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from runner.eval_api import (
    AttemptRecord, CheckOutcome, EvidenceReadiness, EvidenceRequirement,
    InvocationSpec, NormalizedCase, SemanticDecision,
)
from runner.eval_compare import ComparisonDecision
from runner.eval_execute import TransientProviderRetryPolicy
from runner.eval_paired import PairedSideExecution
from container.runtime_evidence import BOUNDARY_NATIVE

from ._runtime_assertions import target_text
from ._shared import compatibility_env_names
from .evidence_judge_adapter import _strict_json, _validate_grade

ROOT = Path(__file__).resolve().parents[2]
PROVIDER_ENVS = (
    "OPENAI_API_KEY", "ANTHROPIC_API_KEY", "OPENROUTER_API_KEY",
    "COPILOT_GITHUB_TOKEN", "GH_TOKEN", "GITHUB_TOKEN",
)
# Runner host and OCI images must come from the same reviewed release.
# These are the immutable transport images exercised by Loom CI and live Actions;
# local ablations must not silently fall back to an older cached *-edge tag.
PAIRED_TRANSPORT_IMAGES = {
    "opencode": "ghcr.io/bateau84/opencode-eval-runner@sha256:a1a415e1f236c4d572ef7cd6190561b0b46ff8443761601d750eb88ce3c87442",
    "github-copilot-cli": "ghcr.io/bateau84/opencode-eval-runner@sha256:1c38e2d275206a9a0de057a01a43d8c4c00da4c44e56462ac17139c22f95a1f9",
}
_LEGACY: Any = None


def paired_transport_image(transport: str) -> str:
    """Select explicit caller override first, else CI-tested immutable image.

    Generic runner CLI supports a moving *-edge default, but a stale local tag
    can return result/v1 without runtime_evidence/v1. Do not let a skill ablation
    unknowingly compare results from an unreviewed transport image.
    """
    env_name = (
        "OPENCODE_EVAL_RUNNER_OPENCODE_IMAGE"
        if transport == "opencode"
        else "OPENCODE_EVAL_RUNNER_COPILOT_IMAGE"
    )
    return (
        os.environ.get(env_name)
        or os.environ.get("OPENCODE_EVAL_RUNNER_IMAGE")
        or PAIRED_TRANSPORT_IMAGES[transport]
    )


def _legacy() -> Any:
    global _LEGACY
    if _LEGACY is None:
        path = ROOT / "scripts" / "run-evals-legacy.py"
        spec = importlib.util.spec_from_file_location("_loom_skill_legacy", path)
        if spec is None or spec.loader is None:
            raise RuntimeError("skill-owned Loom compatibility semantics unavailable")
        module = importlib.util.module_from_spec(spec)
        sys.modules[spec.name] = module
        spec.loader.exec_module(module)
        _LEGACY = module
    return _LEGACY


def raw_case(case: NormalizedCase) -> dict[str, Any]:
    data = case.project_data
    if not isinstance(data, dict) or data.get("_skill_owned") is not True:
        raise ValueError("paired skill eval requires a skill-owned Loom case")
    return data


def observed_native_skill_load(
    result: Mapping[str, Any], *, skill: str, agent: str,
) -> tuple[str, str]:
    """Verify native skill loading from runner-owned runtime observations.

    Convenience `skills_loaded`, actions and model text are diagnostic, not
    authoritative evidence. An incomplete boundary or unavailable identity
    must never be backfilled from those projections.
    """
    evidence = result.get("runtime_evidence")
    if not isinstance(evidence, Mapping):
        return ("non-evidence", "native runtime_evidence unavailable")
    coverage = evidence.get("coverage")
    boundaries = coverage.get("boundaries") if isinstance(coverage, Mapping) else None
    native = boundaries.get(BOUNDARY_NATIVE) if isinstance(boundaries, Mapping) else None
    if (
        evidence.get("status") != "complete"
        or not isinstance(native, Mapping)
        or native.get("status") != "complete"
    ):
        return ("non-evidence", "complete native runtime boundary unavailable")
    observations = evidence.get("observations")
    session = result.get("session_id")
    if (
        not isinstance(observations, list)
        or not isinstance(session, str)
        or not session
        or "***REDACTED***" in session
    ):
        return ("non-evidence", "native observations or exact target session identity unavailable")

    matched = False
    for observation in observations:
        if not isinstance(observation, Mapping) or observation.get("mode") != "native":
            continue
        tool = observation.get("tool")
        if not isinstance(tool, Mapping) or tool.get("state") != "available":
            return ("non-evidence", "native tool identity unavailable")
        if tool.get("value") != "skill":
            continue
        actor = observation.get("actor")
        session_id = observation.get("session_id")
        if not isinstance(actor, Mapping) or actor.get("state") != "available":
            return ("non-evidence", "native skill actor identity unavailable")
        if not isinstance(session_id, Mapping) or session_id.get("state") != "available":
            return ("non-evidence", "native skill session identity unavailable")
        if actor.get("value") != agent or session_id.get("value") != session:
            continue  # Another actor/session cannot satisfy this side's load.

        inputs = observation.get("input")
        if not isinstance(inputs, Mapping) or inputs.get("state") != "available":
            return ("non-evidence", "native skill arguments unavailable")
        data = inputs.get("value")
        if not isinstance(data, Mapping):
            return ("non-evidence", "native skill arguments are not an object")
        name = data.get("id") if isinstance(data.get("id"), str) else data.get("name")
        if not isinstance(name, str):
            return ("non-evidence", "native skill identifier unavailable")
        if name != skill:
            continue
        if observation.get("outcome") == "missing":
            return ("non-evidence", "native skill invocation has no terminal")
        if observation.get("outcome") != "success":
            continue  # A failed skill call is not a successfully loaded skill.
        returned = observation.get("result")
        if not isinstance(returned, Mapping) or returned.get("state") != "available":
            return ("non-evidence", "native skill result unavailable")
        matched = True

    return ("loaded" if matched else "not-loaded", "authoritative native skill observation checked")


@dataclass(frozen=True)
class SkillSide:
    name: str
    target_workspace: Path
    judge_workspace: Path
    skill_body: str


class LoomSkillAblationProfile:
    """Loom-specific paired-eval callbacks and comparison semantics."""

    def __init__(self, args: Any, root: Path = ROOT):
        self.args = args
        self.root = root.resolve()
        self.legacy = _legacy()

    def discover_cases(self) -> tuple[NormalizedCase, ...]:
        cases: list[NormalizedCase] = []
        for data in self.legacy.load_skill_owned_cases(self.root / "skills"):
            cases.append(NormalizedCase(
                id=str(data["id"]),
                selectors=tuple(sorted(self.legacy.case_selectors(data))),
                # The ablation is reasoning-only, not a Loom runtime/plugin eval.
                lane="standard",
                project_data=data,
                metadata={
                    "evaluation_mode": "skill-ablation",
                    "skill": str(data["skill"]),
                    "source_path": str(data["_skill_eval_source"]),
                    "source_case": str(data["_skill_eval_source_id"]),
                },
            ))
        return tuple(cases)

    @contextmanager
    def prepare_pair(
        self, case: NormalizedCase, iteration: int
    ) -> Iterator[tuple[SkillSide, SkillSide]]:
        data = raw_case(case)
        skill = str(data["skill"])
        source = (self.root / "skills" / skill).resolve()
        if not source.is_relative_to((self.root / "skills").resolve()) or not (source / "SKILL.md").is_file():
            raise ValueError(f"{case.id}: skill under test has no safe SKILL.md")
        temp = Path(tempfile.mkdtemp(prefix="loom-skill-pair-"))
        try:
            baseline = temp / "baseline"
            candidate = temp / "candidate"
            for project in (baseline, candidate):
                (project / ".opencode" / "agents").mkdir(parents=True)
                (project / ".opencode" / "skills").mkdir(parents=True)

            shutil.copytree(
                source, candidate / ".opencode" / "skills" / skill,
                ignore=shutil.ignore_patterns("evals", "ASSESSMENT.md", "QA.md"),
            )
            (baseline / ".opencode" / "agents" / "skill-baseline.md").write_text(
                self.legacy.skill_baseline_agent(), encoding="utf-8"
            )
            (candidate / ".opencode" / "agents" / "skill-eval.md").write_text(
                self.legacy.skill_eval_agent(skill), encoding="utf-8"
            )
            self.legacy.write_project_config(baseline, "skill-baseline")
            self.legacy.write_project_config(candidate, "skill-eval")

            for fixture in data.get("fixture_files", []):
                for project in (baseline, candidate):
                    destination = self.legacy.safe_fixture_path(project, fixture["path"])
                    destination.parent.mkdir(parents=True, exist_ok=True)
                    destination.write_text(fixture["content"], encoding="utf-8")

            judge_dirs = (temp / "judge-baseline", temp / "judge-candidate")
            for judge_dir in judge_dirs:
                (judge_dir / ".opencode" / "agents").mkdir(parents=True)
                (judge_dir / ".opencode" / "agents" / "eval-judge.md").write_text(
                    self.legacy.JUDGE_AGENT, encoding="utf-8"
                )
                self.legacy.write_project_config(judge_dir, "eval-judge")
            body = (source / "SKILL.md").read_text(encoding="utf-8")
            yield (
                SkillSide("baseline", baseline, judge_dirs[0], body),
                SkillSide("candidate", candidate, judge_dirs[1], body),
            )
        finally:
            if self.args.keep_temp:
                print(f"KEEP {case.id}#{iteration}: {temp}", flush=True)
            else:
                shutil.rmtree(temp, ignore_errors=True)

    def _spec(
        self, *, side: SkillSide, skill: str, phase: str,
        prompt: str, system: str | None,
    ) -> InvocationSpec:
        transport = getattr(self.args, f"{phase}_transport")
        model = self.args.model if phase == "target" else self.args.judge_model or self.args.model
        reasoning = getattr(self.args, f"{phase}_reasoning") or self.args.reasoning
        timeout = self.args.timeout_seconds if self.args.timeout_seconds is not None else 240
        container_timeout = self.args.container_timeout if self.args.container_timeout is not None else 300
        return InvocationSpec(
            transport=transport,
            model=model,
            reasoning=reasoning,
            agent=("skill-baseline" if side.name == "baseline" else "skill-eval") if phase == "target" else "eval-judge",
            skill=skill if phase == "target" and side.name == "candidate" and transport == "opencode" else None,
            workspace=side.target_workspace if phase == "target" else side.judge_workspace,
            workspace_mode="ro",
            prompt=prompt,
            system=system,
            expected_plugin=None,
            engine=self.args.engine,
            network=self.args.network,
            image=paired_transport_image(transport),
            auth=None,
            database=None,
            models_catalog=None,
            config=None,
            config_root=None,
            env_names=tuple(dict.fromkeys((*PROVIDER_ENVS, *compatibility_env_names()))),
            timeout_seconds=timeout,
            container_timeout=container_timeout,
        )

    def target_spec(self, case: NormalizedCase, side: SkillSide) -> InvocationSpec:
        data = raw_case(case)
        system: str | None = None
        if self.args.target_transport == "github-copilot-cli":
            system = self.legacy.skill_ablation_copilot_system(
                side.skill_body, with_skill=(side.name == "candidate")
            )
        return self._spec(
            side=side, skill=str(data["skill"]), phase="target",
            prompt=str(data["prompt"]), system=system,
        )

    def deterministic_checks(
        self, case: NormalizedCase, side: SkillSide,
        target: AttemptRecord, readiness: EvidenceReadiness,
    ) -> Sequence[CheckOutcome]:
        if readiness.status != "ready":
            return (CheckOutcome("skill.evidence", "non-evidence", "runner evidence not ready", {}),)
        result = target.result
        if not isinstance(result, Mapping):
            return (CheckOutcome("skill.target", "non-evidence", "target result absent", {}),)
        # Skill score comparisons require the same four complete target
        # projections as legacy: assistant text, tools, actions and skill loads.
        # Generic runtime_evidence readiness is checked independently above.
        text = result.get("text")
        if not isinstance(text, str) or not text.strip() or "***REDACTED***" in text:
            return (CheckOutcome("skill.text", "non-evidence", "complete unsanitized target text unavailable", {}),)
        if len(text) > self.legacy.JUDGE_TEXT_LIMIT:
            return (CheckOutcome("skill.text", "non-evidence", "target text exceeds judge-input budget", {}),)
        if not isinstance(result.get("tools"), list) or not isinstance(result.get("actions"), list):
            return (CheckOutcome("skill.projections", "non-evidence", "complete target tool/action projections unavailable", {}),)
        loaded = result.get("skills_loaded")
        if not isinstance(loaded, list) or not all(isinstance(item, str) for item in loaded):
            return (CheckOutcome("skill.discovery", "non-evidence", "skill loading evidence unavailable", {}),)
        if any("***REDACTED***" in item for item in loaded):
            return (CheckOutcome("skill.discovery", "non-evidence", "skill loading evidence redacted", {}),)
        # Legacy supplied explicit per-field provenance. When the generic
        # transport supplies it, only exact score inputs are admissible.
        safety = result.get("evidence_safety")
        if isinstance(safety, Mapping):
            fields = safety.get("fields")
            if not isinstance(fields, (list, dict)):
                return (CheckOutcome("skill.exact-fields", "non-evidence", "field provenance unavailable", {}),)
            for field in ("text", "tools", "actions", "skills_loaded"):
                if isinstance(fields, dict):
                    disposition = fields.get(field)
                else:
                    disposition = next((
                        value for value in fields
                        if isinstance(value, Mapping) and value.get("event") is None and value.get("field") == field
                    ), None)
                if not isinstance(disposition, Mapping) or disposition.get("state") != "exact":
                    return (CheckOutcome("skill.exact-fields", "non-evidence", f"{field} is not exact", {}),)
        skill = str(raw_case(case)["skill"])
        # Copilot has no native skill loading; Loom supplies the candidate
        # methodology in its system prompt and excludes it from the baseline.
        if self.args.target_transport == "github-copilot-cli":
            return (CheckOutcome("skill.inline-methodology", "pass", "Copilot methodology boundary supplied by Loom", {}),)
        agent = "skill-baseline" if side.name == "baseline" else "skill-eval"
        load, reason = observed_native_skill_load(result, skill=skill, agent=agent)
        if load == "non-evidence":
            return (CheckOutcome("skill.native-evidence", "non-evidence", reason, {}),)
        if side.name == "baseline":
            if load == "loaded" or skill in loaded:
                return (CheckOutcome("skill.baseline", "non-evidence", "baseline contaminated or contradictory skill-load projections", {}),)
        else:
            if load != "loaded":
                return (CheckOutcome("skill.native-load", "fail", f"no completed native load of tested skill: {skill}", {}),)
            if skill not in loaded:
                return (CheckOutcome("skill.native-evidence", "non-evidence", "diagnostic skill-load projection conflicts with native runtime evidence", {}),)
        return (CheckOutcome("skill.discovery", "pass", f"{side.name} skill scope verified by native observations", {}),)

    def judge_spec(
        self, case: NormalizedCase, side: SkillSide,
        target: AttemptRecord, checks: Sequence[CheckOutcome],
    ) -> InvocationSpec | None:
        if any(check.status == "non-evidence" for check in checks):
            return None
        text, error = target_text(target)
        if text is None or not text.strip():
            raise ValueError(error or "complete target response unavailable")
        # Skill ablation judges only inline output, not legacy tool-result
        # projections or implied Loom runtime actions.
        prompt = self.legacy.judge_prompt(raw_case(case), text, [], [])
        system = (
            self.legacy.strip_frontmatter(self.legacy.JUDGE_AGENT)
            if self.args.judge_transport == "github-copilot-cli" else None
        )
        return self._spec(
            side=side, skill=str(raw_case(case)["skill"]), phase="judge",
            prompt=prompt, system=system,
        )

    def parse_judge(
        self, case: NormalizedCase, side: SkillSide, judge: AttemptRecord
    ) -> SemanticDecision:
        del side
        result = judge.result
        if not isinstance(result, Mapping) or not isinstance(result.get("text"), str):
            raise ValueError("judge complete text unavailable")
        if "***REDACTED***" in result["text"]:
            raise ValueError("judge text was redacted; grade is non-evidence")
        # Preserve the legacy Markdown-fence tolerance but require the existing
        # full judge contract. Malformed grades never become numeric zeroes.
        # Preserve historical Markdown-fence tolerance but decode the raw
        # payload with the strict parser used by normal judge evaluations.
        raw_grade = result["text"].strip()
        raw_grade = re.sub(r"^~~~(?:json)?\s*", "", raw_grade, flags=re.I)
        raw_grade = re.sub(r"\s*~~~$", "", raw_grade)
        raw_grade = re.sub(r"^```(?:json)?\s*", "", raw_grade, flags=re.I)
        raw_grade = re.sub(r"\s*```$", "", raw_grade)
        grade = _validate_grade(case, _strict_json(raw_grade))
        passed = self.legacy.semantic_pass(raw_case(case), grade)
        return SemanticDecision(
            status="pass" if passed else "fail",
            summary=str(grade["summary"]),
            data=grade,
        )

    def side_input(
        self, case: NormalizedCase, side: SkillSide
    ) -> PairedSideExecution:
        retries = self.args.transport_retries
        policy = TransientProviderRetryPolicy() if retries else None
        return PairedSideExecution(
            case=case,
            prepared=side,
            target_spec=self.target_spec(case, side),
            # A native skill-load assertion requires a complete, runner-owned
            # native observation boundary. Copilot uses inline methodology.
            evidence_requirement=EvidenceRequirement(
                (BOUNDARY_NATIVE,) if self.args.target_transport == "opencode" else ()
            ),
            profile=self,
            project_metadata={
                **case.metadata,
                "side": side.name,
                "workspace_mode": "ro",
                "judge_workspace_isolated": True,
            },
            target_retry_policy=policy,
            target_max_attempts=retries + 1,
            judge_retry_policy=policy,
            judge_max_attempts=retries + 1,
        )

    def comparison(self, case: NormalizedCase) -> "SkillComparisonPolicy":
        return SkillComparisonPolicy(raw_case(case), self.legacy)


class SkillComparisonPolicy:
    """Exact Loom absolute pass, score, trap and material-value rules."""

    def __init__(self, case: dict[str, Any], legacy: Any):
        self.case, self.legacy = case, legacy

    def compare_pair(self, baseline: Any, candidate: Any) -> ComparisonDecision:
        if baseline.semantic is None or candidate.semantic is None:
            raise ValueError("both independently judged sides are required")
        baseline_grade = baseline.semantic.data
        candidate_grade = candidate.semantic.data
        if not isinstance(baseline_grade, dict) or not isinstance(candidate_grade, dict):
            raise ValueError("semantic grades must be objects")
        declared = bool(self.case.get("_skill_trap_declared"))
        baseline_score = self.legacy.semantic_behavior_score(
            baseline_grade, trap_declared=declared
        )
        candidate_score = self.legacy.semantic_behavior_score(
            candidate_grade, trap_declared=declared
        )
        delta_pp = round((candidate_score - baseline_score) * 100.0, 2)
        trap_fixed = (
            declared and baseline_grade["trap_observed"] is True
            and candidate_grade["trap_observed"] is False
        )
        trap_regression = (
            declared and baseline_grade["trap_observed"] is False
            and candidate_grade["trap_observed"] is True
        )
        value = self.legacy.classify_skill_value(
            delta_pp, trap_fixed=trap_fixed, trap_regression=trap_regression
        )
        # Value is descriptive. Candidate absolute correctness alone decides PASS.
        passed = candidate.classification == "pass"
        return ComparisonDecision(
            classification="pass" if passed else "fail",
            summary=f"baseline {baseline_score:.0%} -> candidate {candidate_score:.0%} ({delta_pp:+.1f} pp); {value}",
            data={
                "baseline_score": baseline_score,
                "candidate_score": candidate_score,
                "delta_pp": delta_pp,
                "trap_fixed": trap_fixed,
                "trap_regression": trap_regression,
                "skill_value": value,
                "candidate_absolute_pass": passed,
            },
        )
