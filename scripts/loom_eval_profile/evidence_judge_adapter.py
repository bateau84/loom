"""Worker B ownership: Loom evidence, deterministic checks, and judge semantics."""

from __future__ import annotations

from collections.abc import Sequence

from runner.eval_api import (
    AttemptRecord,
    CheckOutcome,
    EvidenceReadiness,
    EvidenceRequirement,
    InvocationSpec,
    NormalizedCase,
    SemanticDecision,
)

from ._shared import PreparedLoomCase


class LoomEvidenceJudgeAdapter:
    """Task-7 B surface. Implementation belongs on eval-engine/07-evidence-judge-adapter."""

    def target_evidence_requirement(
        self,
        case: NormalizedCase,
        prepared: PreparedLoomCase,
    ) -> EvidenceRequirement:
        raise NotImplementedError("Task 7 worker B has not been reconciled")

    def deterministic_checks(
        self,
        case: NormalizedCase,
        prepared: PreparedLoomCase,
        target: AttemptRecord,
        readiness: EvidenceReadiness,
    ) -> Sequence[CheckOutcome]:
        raise NotImplementedError("Task 7 worker B has not been reconciled")

    def judge_spec(
        self,
        case: NormalizedCase,
        prepared: PreparedLoomCase,
        target: AttemptRecord,
        checks: Sequence[CheckOutcome],
    ) -> InvocationSpec | None:
        raise NotImplementedError("Task 7 worker B has not been reconciled")

    def parse_judge(
        self,
        case: NormalizedCase,
        prepared: PreparedLoomCase,
        judge: AttemptRecord,
    ) -> SemanticDecision:
        raise NotImplementedError("Task 7 worker B has not been reconciled")


EVIDENCE_JUDGE_ADAPTER = LoomEvidenceJudgeAdapter()
