#!/usr/bin/env python3
from __future__ import annotations

import argparse
import importlib.util
import json
import os
import re
import shutil
import subprocess
import sys
import uuid
from pathlib import Path
from types import ModuleType
from typing import Any, Sequence

ROOT = Path(__file__).resolve().parents[1]
LEGACY_RUNNER = ROOT / "scripts" / "run-evals-legacy.py"
PAIRED_RUNNER = ROOT / "scripts" / "run-skill-ablation.py"
PROFILE_REFERENCE = "loom_eval_profile:PROFILE"
FORWARDED_ENV_NAMES = "LOOM_EVAL_FORWARD_ENV_NAMES"
_LEGACY_MODULE: ModuleType | None = None


class CompatibilityError(RuntimeError):
    pass


def _legacy() -> ModuleType:
    global _LEGACY_MODULE
    if _LEGACY_MODULE is None:
        spec = importlib.util.spec_from_file_location("loom_run_evals_legacy", LEGACY_RUNNER)
        if not spec or not spec.loader:
            raise CompatibilityError("legacy eval compatibility module is unavailable")
        module = importlib.util.module_from_spec(spec)
        sys.modules[spec.name] = module
        spec.loader.exec_module(module)
        _LEGACY_MODULE = module
    return _LEGACY_MODULE


def parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(
        description=(
            "Loom eval compatibility entrypoint. Normal cases forward to the generic "
            "opencode-eval-runner eval engine; skill-owned ablation uses generic paired mode."
        )
    )
    p.add_argument("--all", action="store_true")
    p.add_argument("--cases", default="")
    p.add_argument("--suite", action="append", default=[])
    p.add_argument("--target-kind", choices=("all", "agent", "skill"), default="all")
    p.add_argument("--target", default="")
    p.add_argument("--model")
    p.add_argument("--judge-model")
    p.add_argument("--reasoning")
    p.add_argument("--target-reasoning")
    p.add_argument("--judge-reasoning")
    p.add_argument("--target-transport", choices=("opencode", "github-copilot-cli"), default="opencode")
    p.add_argument("--judge-transport", choices=("opencode", "github-copilot-cli"), default="opencode")
    p.add_argument("--engine", choices=("auto", "podman", "docker"), default="auto")
    p.add_argument("--network")
    p.add_argument("--image")
    p.add_argument("--opencode-image")
    p.add_argument("--copilot-image")
    p.add_argument("--runner-evidence-safety", action="store_true")
    p.add_argument("--auth")
    p.add_argument("--provider-config")
    p.add_argument("--models-catalog")
    p.add_argument("--database")
    p.add_argument("--env", action="append", default=[], metavar="NAME")
    p.add_argument("--artifact-dir")
    p.add_argument("--timeout-seconds", type=int)
    p.add_argument("--container-timeout", type=int)
    p.add_argument("--transport-retries", type=int, default=2)
    p.add_argument("--iterations", type=int, default=1)
    p.add_argument("--parallel", nargs="?", const=0, type=int, default=1, metavar="N")
    p.add_argument("--runtime-parallel", type=int, default=1, metavar="N")
    p.add_argument("--keep-temp", action="store_true")
    p.add_argument("--list", action="store_true")
    return p


def _csv(raw: str) -> set[str]:
    return {value.strip() for value in raw.split(",") if value.strip()}


def resolve_selection(args: argparse.Namespace) -> list[dict[str, Any]]:
    legacy = _legacy()
    selected_ids = _csv(args.cases)
    suite_paths = [Path(value).resolve() for value in args.suite] if args.suite else None
    cases = legacy.load_cases(suite_paths, include_opt_in=bool(selected_ids))
    cases.extend(legacy.load_skill_owned_cases(ROOT / "skills"))

    ids = [str(case["id"]) for case in cases]
    duplicates = sorted({case_id for case_id in ids if ids.count(case_id) > 1})
    if duplicates:
        raise CompatibilityError("duplicate behavioral eval case id(s): " + ", ".join(duplicates))

    selected_targets = _csv(args.target)
    if not args.all and not selected_ids and not selected_targets and args.target_kind == "all":
        raise CompatibilityError(
            "live evals spend model inference; pass --cases, --target, --target-kind agent/skill, or --all explicitly"
        )
    candidates = [
        case for case in cases
        if args.target_kind == "all" or legacy.case_target_kind(case) == args.target_kind
    ]
    known_targets = {legacy.case_target_name(case) for case in candidates}
    missing_targets = sorted(selected_targets - known_targets)
    if missing_targets:
        raise CompatibilityError("unknown target(s) for selected kind: " + ", ".join(missing_targets))
    candidates = [
        case for case in candidates
        if not selected_targets or legacy.case_target_name(case) in selected_targets
    ]
    known_selectors = set().union(*(legacy.case_selectors(case) for case in candidates)) if candidates else set()
    missing_ids = sorted(selected_ids - known_selectors)
    if missing_ids:
        suffix = "; valid selectors: " + ", ".join(sorted(known_selectors)) if known_selectors else ""
        raise CompatibilityError("unknown case id(s) for selected target(s): " + ", ".join(missing_ids) + suffix)
    selected = [
        case for case in candidates
        if args.all or not selected_ids or bool(legacy.case_selectors(case) & selected_ids)
    ]
    if not selected:
        raise CompatibilityError("selection matched no behavioral eval cases")
    return selected


def list_cases(args: argparse.Namespace) -> int:
    """List Loom-owned cases without launching the retired legacy CLI.

    The list is provider-free, does not need the generic runner binary, and
    intentionally retains the historical five-column developer format.
    Generic job planning and execution remain solely in the reusable runner.
    """
    legacy = _legacy()
    selected_ids = _csv(args.cases)
    suite_paths = [Path(value).resolve() for value in args.suite] if args.suite else None
    cases = legacy.load_cases(suite_paths, include_opt_in=bool(selected_ids))
    cases.extend(legacy.load_skill_owned_cases(ROOT / "skills"))

    ids = [str(case["id"]) for case in cases]
    duplicates = sorted({case_id for case_id in ids if ids.count(case_id) > 1})
    if duplicates:
        raise CompatibilityError("duplicate behavioral eval case id(s): " + ", ".join(duplicates))

    for case in cases:
        print("\t".join((
            str(case["id"]),
            legacy.case_target_kind(case),
            legacy.case_target_name(case),
            str(case["execution"]),
            ",".join(case["requirements"]),
        )))
    return 0


def _runner_binary() -> str:
    configured = os.environ.get("OPENCODE_EVAL_RUNNER_BIN")
    if configured:
        path = Path(configured).expanduser()
        if not path.is_file():
            raise CompatibilityError(f"OPENCODE_EVAL_RUNNER_BIN not found: {path}")
        return str(path)
    found = shutil.which("opencode-eval-runner")
    if not found:
        raise CompatibilityError("opencode-eval-runner Task-6 CLI not found")
    return found


def _generic_env(args: argparse.Namespace) -> dict[str, str]:
    env = dict(os.environ)
    scripts = str(ROOT / "scripts")
    env["PYTHONPATH"] = scripts + (os.pathsep + env["PYTHONPATH"] if env.get("PYTHONPATH") else "")
    if args.image:
        env["OPENCODE_EVAL_RUNNER_OPENCODE_IMAGE"] = args.image
        env["OPENCODE_EVAL_RUNNER_COPILOT_IMAGE"] = args.image
    else:
        if args.opencode_image:
            env["OPENCODE_EVAL_RUNNER_OPENCODE_IMAGE"] = args.opencode_image
        if args.copilot_image:
            env["OPENCODE_EVAL_RUNNER_COPILOT_IMAGE"] = args.copilot_image
    for name, value in (
        ("OPENCODE_EVAL_RUNNER_AUTH", args.auth),
        ("OPENCODE_EVAL_RUNNER_CONFIG", args.provider_config),
        ("OPENCODE_EVAL_RUNNER_MODELS", args.models_catalog),
        ("OPENCODE_EVAL_RUNNER_DB", args.database),
    ):
        if value:
            env[name] = str(Path(value).expanduser().resolve())
    env_names = list(dict.fromkeys(args.env))
    bad = [name for name in env_names if not re.fullmatch(r"[A-Za-z_][A-Za-z0-9_]*", name)]
    if bad:
        raise CompatibilityError("invalid environment variable name(s): " + ", ".join(bad))
    if env_names:
        env[FORWARDED_ENV_NAMES] = json.dumps(env_names, separators=(",", ":"))
    else:
        env.pop(FORWARDED_ENV_NAMES, None)
    return env


def _append_common(command: list[str], args: argparse.Namespace) -> None:
    for flag, value in (
        ("--judge-model", args.judge_model),
        ("--reasoning", args.reasoning),
        ("--target-reasoning", args.target_reasoning),
        ("--judge-reasoning", args.judge_reasoning),
        ("--network", args.network),
    ):
        if value:
            command += [flag, str(value)]
    if args.timeout_seconds is not None:
        command += ["--timeout-seconds", str(args.timeout_seconds)]
    if args.container_timeout is not None:
        command += ["--container-timeout", str(args.container_timeout)]


def generic_command(args: argparse.Namespace, case_ids: Sequence[str], artifact_dir: Path) -> list[str]:
    command = [
        _runner_binary(), "eval", "--profile", PROFILE_REFERENCE,
        "--cases", ",".join(case_ids), "--target-model", args.model,
        "--target-transport", args.target_transport, "--judge-transport", args.judge_transport,
        "--engine", args.engine, "--iterations", str(args.iterations),
        "--runtime-parallel", str(args.runtime_parallel),
        "--transport-retries", str(args.transport_retries), "--artifact-dir", str(artifact_dir),
    ]
    command += ["--parallel"] if args.parallel == 0 else ["--parallel", str(args.parallel)]
    _append_common(command, args)
    return command


def paired_ablation_command(args: argparse.Namespace, case_ids: Sequence[str], artifact_dir: Path) -> list[str]:
    """Route skill-owned cases to the generic paired Python API bridge."""
    command = [
        sys.executable, str(PAIRED_RUNNER), "--cases", ",".join(case_ids),
        "--model", args.model,
        "--target-transport", args.target_transport,
        "--judge-transport", args.judge_transport,
        "--engine", args.engine,
        "--iterations", str(args.iterations),
        "--runtime-parallel", str(args.runtime_parallel),
        "--transport-retries", str(args.transport_retries),
        "--artifact-dir", str(artifact_dir),
    ]
    command += ["--parallel"] if args.parallel == 0 else ["--parallel", str(args.parallel)]
    _append_common(command, args)
    if args.keep_temp:
        command.append("--keep-temp")
    return command

def _validate(args: argparse.Namespace) -> None:
    if not args.model:
        raise CompatibilityError("live evals require --model")
    if args.iterations < 1 or args.runtime_parallel < 1 or args.parallel < 0:
        raise CompatibilityError("invalid iteration/concurrency value")
    if not 0 <= args.transport_retries <= 5:
        raise CompatibilityError("--transport-retries must be from 0 to 5")
    if args.timeout_seconds is not None and args.timeout_seconds < 1:
        raise CompatibilityError("--timeout-seconds must be >= 1")
    if args.container_timeout is not None and args.container_timeout < 1:
        raise CompatibilityError("--container-timeout must be >= 1")
    if args.judge_transport != args.target_transport and not args.judge_model:
        raise CompatibilityError("--judge-model is required when target and judge transports differ")


def _run(command: Sequence[str], *, env: dict[str, str] | None = None) -> int:
    return subprocess.run(list(command), cwd=ROOT, env=env, check=False).returncode


def main(argv: Sequence[str] | None = None) -> int:
    raw = list(sys.argv[1:] if argv is None else argv)
    args = parser().parse_args(raw)
    try:
        if args.list:
            return list_cases(args)
        _validate(args)
        selected = resolve_selection(args)
        normal = [case for case in selected if not case.get("_skill_owned")]
        ablation = [case for case in selected if case.get("_skill_owned")]
        if args.runner_evidence_safety:
            raise CompatibilityError("--runner-evidence-safety is retired for migrated evals; generic runtime_evidence/v1 is authoritative")
        if normal and args.keep_temp:
            raise CompatibilityError("--keep-temp is not supported by the generic normal-eval profile")
        if args.target_transport != "opencode":
            incompatible = [str(case["id"]) for case in normal if case.get("skill")]
            if incompatible:
                raise CompatibilityError("native skill-routing eval cases require --target-transport opencode: " + ", ".join(incompatible))
        run_root = Path(args.artifact_dir).expanduser().resolve() if args.artifact_dir else ROOT / ".loom-evals" / uuid.uuid4().hex
        split = bool(normal and ablation)
        status = 0
        if normal:
            target = run_root / "normal" if split else run_root
            status = _run(generic_command(args, [str(case["id"]) for case in normal], target), env=_generic_env(args))
            if status == 2:
                return status
        if ablation:
            target = run_root / "skill-ablation" if split else run_root
            if split:
                print("Compatibility split: normal eval and generic paired skill ablation use separate artifact roots.", file=sys.stderr)
            status = max(status, _run(paired_ablation_command(args, [str(case["id"]) for case in ablation], target), env=_generic_env(args)))
        return status
    except CompatibilityError as exc:
        parser().error(str(exc))
        return 2


# Deliberate Loom-only compatibility surface. Never expose retired invocation,
# observer authority, scheduling, or artifact-writing helpers implicitly.
LOOM_COMPAT_EXPORTS = frozenset(["load_cases","load_skill_owned_cases","case_selectors","case_workspace_mode","case_target_kind","case_target_name","safe_fixture_path","sanitize_database_seed","setup_projects","write_project_config","judge_prompt","parse_judge","semantic_pass","semantic_behavior_score","classify_skill_value","skill_baseline_agent","skill_eval_agent","skill_ablation_copilot_system","strip_frontmatter","deterministic_failures","target_prompt"])


def __getattr__(name: str):
    if name not in LOOM_COMPAT_EXPORTS:
        raise AttributeError(name)
    try:
        return getattr(_legacy(), name)
    except AttributeError as exc:
        raise AttributeError(name) from exc


if __name__ == "__main__":
    raise SystemExit(main())
