#!/usr/bin/env python3
"""Stage-1 skill-ablation bridge to opencode-eval-runner generic paired mode.

The public generic eval CLI has no paired flag (runner issue #64). This thin
caller uses its paired Python API and its existing job scheduler/artifact store.
Loom chooses the final comparison verdict; the runner owns both phase lifecycles.
"""
from __future__ import annotations

import argparse
import importlib.util
import os
import shutil
import sys
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Sequence

ROOT = Path(__file__).resolve().parents[1]


def _bootstrap_runner() -> None:
    """Resolve the generic paired API from an explicit runner or Python import.

    GitHub Actions exposes the runner library on PYTHONPATH, while local
    installs may expose only its binary. Requiring both rejects valid setups.
    """
    configured = os.environ.get("OPENCODE_EVAL_RUNNER_BIN")
    if configured:
        binary = Path(configured).expanduser().resolve()
        if not binary.is_file():
            raise RuntimeError(f"OPENCODE_EVAL_RUNNER_BIN not found: {binary}")
        root = binary.parent.parent
        if not (root / "runner" / "eval_paired.py").is_file():
            raise RuntimeError(f"runner at {root} lacks generic paired mode; update to runner #64")
        sys.path.insert(0, str(root))
        return

    # The generic paired API is a Python library; its CLI is not required when
    # the module itself is already importable (e.g. through PYTHONPATH).
    try:
        paired_module = importlib.util.find_spec("runner.eval_paired")
    except (ImportError, ValueError):
        paired_module = None
    if paired_module is not None and paired_module.origin is not None:
        return

    binary_path = shutil.which("opencode-eval-runner")
    if binary_path:
        root = Path(binary_path).resolve().parent.parent
        if not (root / "runner" / "eval_paired.py").is_file():
            raise RuntimeError(f"runner at {root} lacks generic paired mode; update to runner #64")
        sys.path.insert(0, str(root))
        return

    raise RuntimeError(
        "generic paired runner #64 is not importable or on PATH; "
        "set OPENCODE_EVAL_RUNNER_BIN to its bin/opencode-eval-runner "
        "or add the runner checkout root to PYTHONPATH"
    )


def parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(description="Loom skill-owned paired-eval adapter")
    p.add_argument("--cases", required=True)
    p.add_argument("--model", required=True)
    p.add_argument("--judge-model")
    p.add_argument("--target-transport", choices=("opencode", "github-copilot-cli"), default="opencode")
    p.add_argument("--judge-transport", choices=("opencode", "github-copilot-cli"), default="opencode")
    p.add_argument("--engine", choices=("auto", "podman", "docker"), default="auto")
    p.add_argument("--network")
    p.add_argument("--reasoning")
    p.add_argument("--target-reasoning")
    p.add_argument("--judge-reasoning")
    p.add_argument("--timeout-seconds", type=int)
    p.add_argument("--container-timeout", type=int)
    p.add_argument("--transport-retries", type=int, default=2)
    p.add_argument("--iterations", type=int, default=1)
    p.add_argument("--parallel", nargs="?", const=0, type=int, default=1)
    p.add_argument("--runtime-parallel", type=int, default=1)
    p.add_argument("--artifact-dir", required=True)
    p.add_argument("--keep-temp", action="store_true")
    return p


def _verify_args(args: argparse.Namespace) -> None:
    if not args.cases.strip() or not args.model.strip():
        raise ValueError("explicit case IDs and target model are required")
    if args.iterations < 1 or args.parallel < 0 or args.runtime_parallel < 1:
        raise ValueError("invalid iterations or concurrency")
    if not 0 <= args.transport_retries <= 5:
        raise ValueError("transport retries must be from 0 to 5")
    if args.timeout_seconds is not None and args.timeout_seconds < 1:
        raise ValueError("timeout-seconds must be positive")
    if args.container_timeout is not None and args.container_timeout < 1:
        raise ValueError("container-timeout must be positive")
    if args.judge_transport != args.target_transport and not args.judge_model:
        raise ValueError("judge-model is required for a different judge transport")


def _pair_outcome(artifact: dict[str, Any]) -> str:
    """Only Loom interprets its own compared decision as PASS/FAIL."""
    comparison = artifact.get("comparison")
    if not isinstance(comparison, dict) or comparison.get("status") != "compared":
        return "non-evidence"
    decision = comparison.get("decision")
    if not isinstance(decision, dict) or decision.get("classification") not in {"pass", "fail"}:
        return "non-evidence"
    return str(decision["classification"])


def _failure_hint(value: Any) -> str | None:
    """Summarize runner classifications, never raw prompts or model outputs."""
    if not isinstance(value, dict):
        return None
    plane = value.get("plane")
    code = value.get("code")
    if not isinstance(code, str) or not code:
        return None
    prefix = f"{plane}/{code}" if isinstance(plane, str) and plane else code
    # The runner sanitizes transport errors, but bound logs further: avoid
    # dumping complete response bodies, prompts, or external diagnostics.
    message = value.get("message")
    if not isinstance(message, str) or not message.strip():
        return prefix
    return prefix + ": " + " ".join(message.split())[:240]


def side_evidence_notes(artifact: dict[str, Any]) -> list[str]:
    """Explain why either side cannot be judged, from the sealed pair artifact.

    These notes are diagnostic only. They do not add evidence, change
    classifications, or substitute missing judge or skill scores.
    """
    notes: list[str] = []
    sides = artifact.get("sides")
    if not isinstance(sides, dict):
        return notes
    for name in ("baseline", "candidate"):
        side = sides.get(name)
        if not isinstance(side, dict) or side.get("classification") != "non-evidence":
            continue
        prefix = f"  - {name}:"
        reasons: list[str] = []
        target = side.get("target")
        if isinstance(target, dict):
            attempts = target.get("attempts")
            if isinstance(attempts, list) and attempts:
                last = attempts[-1]
                if isinstance(last, dict):
                    failure = _failure_hint(last.get("failure"))
                    if failure:
                        reasons.append("target " + failure)
            readiness = target.get("evidence_readiness")
            if isinstance(readiness, dict) and readiness.get("status") not in (None, "ready"):
                reasons.append(
                    "readiness " + str(readiness.get("status"))
                    + (" (" + ",".join(str(x) for x in readiness.get("reasons", [])[:3])[:180] + ")"
                       if isinstance(readiness.get("reasons"), list) and readiness.get("reasons") else "")
                )
        checks = side.get("deterministic_checks")
        if isinstance(checks, list):
            for check in checks:
                if isinstance(check, dict) and check.get("status") == "non-evidence":
                    reasons.append(
                        "check " + str(check.get("name") or "unnamed")
                        + ": " + " ".join(str(check.get("reason") or "").split())[:180]
                    )
        judge = side.get("judge")
        if isinstance(judge, dict):
            contract = _failure_hint(judge.get("contract_failure"))
            if contract:
                reasons.append("judge contract " + contract)
            attempts = judge.get("attempts")
            if isinstance(attempts, list) and attempts:
                last = attempts[-1]
                if isinstance(last, dict):
                    failure = _failure_hint(last.get("failure"))
                    if failure:
                        reasons.append("judge " + failure)
        notes.append(prefix + ("; ".join(reasons) if reasons else "no detailed reason in artifact"))
    return notes


def _manifest(
    plan: Any, store: Any, created_at: str, selectors: Sequence[str],
    iterations: int, statuses: dict[tuple[str, int], str], summary: dict[str, Any],
) -> dict[str, Any]:
    from runner.eval_artifacts import EVAL_RUN_SCHEMA, artifact_identity_for_job

    return {
        "schema": EVAL_RUN_SCHEMA,
        "run_id": plan.run_id,
        "created_at": created_at,
        "selection": {
            "profile": "loom_eval_profile.skill_ablation:LoomSkillAblationProfile",
            "all": False,
            "selectors": list(selectors),
            "cases": list(dict.fromkeys(job.case.id for job in plan.jobs)),
            "mode": "paired",
        },
        "iterations": iterations,
        "concurrency": {
            "standard": plan.standard_parallelism,
            "runtime": plan.runtime_parallelism,
        },
        "jobs": [
            {
                "case": job.case.id,
                "iteration": job.iteration,
                "label": job.label,
                "lane": job.case.lane,
                "artifact": store.paired_job_relative_path(
                    artifact_identity_for_job(plan.run_id, job)
                ).as_posix(),
                "status": statuses.get((job.case.id, job.iteration), "planned"),
            }
            for job in plan.jobs
        ],
        "summary": summary,
        "project_metadata": {
            "schema": "loom-skill-paired-run/v1",
            "comparison_verdict_owner": "loom",
            "paired_lifecycle_owner": "opencode-eval-runner",
        },
    }


def run(args: argparse.Namespace) -> int:
    _verify_args(args)
    _bootstrap_runner()

    from runner.eval_artifacts import artifact_identity_for_job, claim_run_artifact_directory
    from runner.eval_cli import _run_lane  # Existing runner scheduler; public API debt for Stage 2.
    from runner.eval_paired import (
        PairedExecutionPolicy, build_paired_eval_artifact, run_paired_evaluation,
    )
    from runner.eval_plan import build_run_plan
    from loom_eval_profile.skill_ablation import LoomSkillAblationProfile

    profile = LoomSkillAblationProfile(args)
    case_ids = tuple(dict.fromkeys(i.strip() for i in args.cases.split(",") if i.strip()))
    run_id = uuid.uuid4().hex
    plan = build_run_plan(
        run_id, profile.discover_cases(), selectors=case_ids,
        iterations=args.iterations, standard_parallelism=args.parallel,
        runtime_parallelism=args.runtime_parallel,
    )
    if not plan.jobs:
        raise ValueError("skill-owned selection matched no cases")
    store = claim_run_artifact_directory(Path(args.artifact_dir).expanduser(), run_id)
    created = datetime.now(timezone.utc).isoformat()
    statuses: dict[tuple[str, int], str] = {}
    store.write_run_manifest(
        _manifest(plan, store, created, case_ids, args.iterations, statuses, {"status": "running"})
    )

    def execute(job: Any) -> dict[str, Any]:
        print(f"{job.label} [skill:{job.case.metadata['skill']}/paired] baseline -> candidate ...", flush=True)
        with profile.prepare_pair(job.case, job.iteration) as (baseline, candidate):
            completed = run_paired_evaluation(
                run_id=run_id,
                iteration=job.iteration,
                baseline=profile.side_input(job.case, baseline),
                candidate=profile.side_input(job.case, candidate),
                policy=PairedExecutionPolicy(mode="sequential"),
                comparison_extension=profile.comparison(job.case),
            )
            return build_paired_eval_artifact(completed)

    # Pair internals and retries use generic execution. The runner's job-lane
    # scheduler also preserves existing --parallel behavior across pairs.
    artifacts, errors = _run_lane(
        plan.jobs, parallelism=plan.standard_parallelism, execute=execute
    )
    counts = {"pass": 0, "fail": 0, "non-evidence": 0}
    for job in plan.jobs:
        key = (job.case.id, job.iteration)
        identity = artifact_identity_for_job(plan.run_id, job)
        artifact = artifacts.get(key)
        if artifact is None:
            statuses[key] = "error"
            print(f"{job.label} ... ERROR: {errors.get(key, 'missing paired artifact')}", file=sys.stderr)
            continue
        store.write_paired_job_artifact(identity, artifact)
        verified = store.read_paired_job_artifact(identity)
        outcome = _pair_outcome(verified)
        statuses[key] = outcome
        counts[outcome] += 1
        comparison = verified.get("comparison") or {}
        details = comparison.get("decision") if isinstance(comparison, dict) else None
        print(f"{job.label} ... {outcome.upper()}", flush=True)
        if outcome == "non-evidence":
            for note in side_evidence_notes(verified):
                print(note, flush=True)
        if isinstance(details, dict):
            print(f"  - {details.get('summary', '')}", flush=True)
        elif isinstance(comparison, dict) and isinstance(comparison.get("failure"), dict):
            print(f"  - {comparison['failure'].get('message', 'comparison unavailable')}", flush=True)

    error_count = sum(v == "error" for v in statuses.values())
    summary = {
        "status": "error" if error_count else "verdict" if counts["fail"] or counts["non-evidence"] else "pass",
        "pass": counts["pass"],
        "fail": counts["fail"],
        "non-evidence": counts["non-evidence"],
        "errors": error_count,
        "not_run": 0,
        "total": len(plan.jobs),
    }
    store.write_run_manifest(
        _manifest(plan, store, created, case_ids, args.iterations, statuses, summary)
    )
    print(
        f"Run {run_id}: {counts['pass']} pass, {counts['fail']} fail, "
        f"{counts['non-evidence']} non-evidence, {error_count} error. Artifacts: {store.root}",
        flush=True,
    )
    return 2 if error_count else 1 if counts["fail"] or counts["non-evidence"] else 0


def main(argv: Sequence[str] | None = None) -> int:
    args = parser().parse_args(argv)
    try:
        return run(args)
    except (OSError, TypeError, ValueError, RuntimeError) as exc:
        print(f"loom skill ablation: {type(exc).__name__}: {exc}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
