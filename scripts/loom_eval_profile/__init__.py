"""Loom profile composition for opencode-eval-runner's generic eval engine.

This shared module only composes the frozen public EvalProfile surface.
Worker A owns case_adapter.py; worker B owns evidence_judge_adapter.py.
Generic scheduling, retries, classification, and artifact lifecycle stay in the runner.
"""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from contextlib import AbstractContextManager

from runner.eval_api import (
    AttemptRecord,
    CheckOutcome,
    EvidenceReadiness,
    EvidenceRequirement,
    InvocationSpec,
    JsonValue,
    NormalizedCase,
    SemanticDecision,
)

from ._shared import PreparedLoomCase
from .case_adapter import CASE_ADAPTER
from .evidence_judge_adapter import EVIDENCE_JUDGE_ADAPTER


class LoomEvalProfile:
    """Thin composition layer over the two Loom-owned Task-7 adapters."""

    def discover_cases(self) -> Sequence[NormalizedCase]:
        return CASE_ADAPTER.discover_cases()

    def prepare(
        self,
        case: NormalizedCase,
        iteration: int,
    ) -> AbstractContextManager[PreparedLoomCase]:
        return CASE_ADAPTER.prepare(case, iteration)

    def target_spec(
        self,
        case: NormalizedCase,
        prepared: PreparedLoomCase,
    ) -> InvocationSpec:
        return CASE_ADAPTER.target_spec(case, prepared)

    def target_evidence_requirement(
        self,
        case: NormalizedCase,
        prepared: PreparedLoomCase,
    ) -> EvidenceRequirement:
        return EVIDENCE_JUDGE_ADAPTER.target_evidence_requirement(case, prepared)

    def deterministic_checks(
        self,
        case: NormalizedCase,
        prepared: PreparedLoomCase,
        target: AttemptRecord,
        readiness: EvidenceReadiness,
    ) -> Sequence[CheckOutcome]:
        return EVIDENCE_JUDGE_ADAPTER.deterministic_checks(
            case,
            prepared,
            target,
            readiness,
        )

    def judge_spec(
        self,
        case: NormalizedCase,
        prepared: PreparedLoomCase,
        target: AttemptRecord,
        checks: Sequence[CheckOutcome],
    ) -> InvocationSpec | None:
        return EVIDENCE_JUDGE_ADAPTER.judge_spec(
            case,
            prepared,
            target,
            checks,
        )

    def parse_judge(
        self,
        case: NormalizedCase,
        prepared: PreparedLoomCase,
        judge: AttemptRecord,
    ) -> SemanticDecision:
        return EVIDENCE_JUDGE_ADAPTER.parse_judge(case, prepared, judge)

    def artifact_metadata(
        self,
        case: NormalizedCase,
        prepared: PreparedLoomCase,
    ) -> Mapping[str, JsonValue]:
        return CASE_ADAPTER.artifact_metadata(case, prepared)


PROFILE = LoomEvalProfile()

__all__ = ["LoomEvalProfile", "PROFILE", "PreparedLoomCase"]
