"""Shared data passed between the Task-7 Loom profile adapters."""

from __future__ import annotations

import json
import os
from dataclasses import dataclass
from pathlib import Path


FORWARDED_ENV_NAMES = "LOOM_EVAL_FORWARD_ENV_NAMES"


def compatibility_env_names() -> tuple[str, ...]:
    """Return compatibility --env names forwarded by scripts/run-evals.py."""
    raw = os.environ.get(FORWARDED_ENV_NAMES, "")
    if not raw:
        return ()
    try:
        value = json.loads(raw)
    except json.JSONDecodeError as exc:
        raise ValueError(f"{FORWARDED_ENV_NAMES} must be a JSON string array") from exc
    if not isinstance(value, list) or not all(isinstance(item, str) and item for item in value):
        raise ValueError(f"{FORWARDED_ENV_NAMES} must be a JSON string array")
    return tuple(dict.fromkeys(value))


SUITE_PATHS_ENV = "LOOM_EVAL_SUITE_PATHS"


def compatibility_suite_paths() -> tuple[Path, ...] | None:
    """Exact --suite file set forwarded to the generic profile by Loom's CLI.

    None selects the normal repository corpus. An explicit list replaces that
    corpus, as the old compatibility entrypoint did; do not silently fall back
    to unrelated default suites.
    """
    raw = os.environ.get(SUITE_PATHS_ENV)
    if raw is None:
        return None
    try:
        value = json.loads(raw)
    except json.JSONDecodeError as exc:
        raise ValueError(f"{SUITE_PATHS_ENV} must be a nonempty JSON path array") from exc
    if not isinstance(value, list) or not value or not all(
        isinstance(path, str) and path.strip() for path in value
    ):
        raise ValueError(f"{SUITE_PATHS_ENV} must be a nonempty JSON path array")
    paths = tuple(Path(path).expanduser().resolve() for path in value)
    for path in paths:
        if not path.is_file():
            raise ValueError(f"{SUITE_PATHS_ENV}: suite file unavailable: {path}")
    return paths


@dataclass(frozen=True)
class PreparedLoomCase:
    """Per-job project state prepared by worker A and consumed by both adapters."""

    iteration: int
    target_workspace: Path
    judge_workspace: Path
