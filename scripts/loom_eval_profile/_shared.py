"""Shared data passed between the two Task-7 Loom profile adapters."""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path


@dataclass(frozen=True)
class PreparedLoomCase:
    """Per-job project state prepared by worker A and consumed by both adapters."""

    iteration: int
    target_workspace: Path
    judge_workspace: Path
