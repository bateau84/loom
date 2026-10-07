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


@dataclass(frozen=True)
class PreparedLoomCase:
    """Per-job project state prepared by worker A and consumed by both adapters."""

    iteration: int
    target_workspace: Path
    judge_workspace: Path
