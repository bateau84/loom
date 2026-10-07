"""Worker A ownership: Loom case discovery and project/workspace preparation."""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from contextlib import AbstractContextManager

from runner.eval_api import InvocationSpec, JsonValue, NormalizedCase

from ._shared import PreparedLoomCase


class LoomCaseWorkspaceAdapter:
    """Task-7 A surface. Implementation belongs on eval-engine/07-case-adapter."""

    def discover_cases(self) -> Sequence[NormalizedCase]:
        raise NotImplementedError("Task 7 worker A has not been reconciled")

    def prepare(
        self,
        case: NormalizedCase,
        iteration: int,
    ) -> AbstractContextManager[PreparedLoomCase]:
        raise NotImplementedError("Task 7 worker A has not been reconciled")

    def target_spec(
        self,
        case: NormalizedCase,
        prepared: PreparedLoomCase,
    ) -> InvocationSpec:
        raise NotImplementedError("Task 7 worker A has not been reconciled")

    def artifact_metadata(
        self,
        case: NormalizedCase,
        prepared: PreparedLoomCase,
    ) -> Mapping[str, JsonValue]:
        raise NotImplementedError("Task 7 worker A has not been reconciled")


CASE_ADAPTER = LoomCaseWorkspaceAdapter()
