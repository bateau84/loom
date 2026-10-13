#!/usr/bin/env python3
"""Validate skill-owned evals with the loader used by Loom's paired runner.

Run from a Loom checkout; --skills-root may point at another repository's skills/.
This tests executable input compatibility, not the model's skill behavior.
"""
from __future__ import annotations

import argparse
import importlib.util
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
LOADER = ROOT / "scripts" / "run-evals-legacy.py"


def consumer():
    # The live paired profile uses these same load_skill_owned_cases semantics.
    spec = importlib.util.spec_from_file_location("loom_skill_eval_case_contract", LOADER)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"skill eval consumer unavailable: {LOADER}")
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--skills-root",
        type=Path,
        default=ROOT / "skills",
        help="directory containing <skill>/evals/*.json (default: Loom skills)",
    )
    args = parser.parse_args(argv)
    try:
        if not args.skills_root.is_dir():
            raise ValueError(f"skills root does not exist: {args.skills_root}")
        cases = consumer().load_skill_owned_cases(args.skills_root)
    except (OSError, ValueError, RuntimeError, TypeError, KeyError) as exc:
        print(f"FAIL skill-owned eval consumer: {exc}", file=sys.stderr)
        return 1
    print(f"PASS skill-owned eval consumer ({len(cases)} cases)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
