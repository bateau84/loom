from __future__ import annotations

import sys
import tempfile
import types
import unittest
from dataclasses import dataclass
from pathlib import Path
from typing import Any


def _install_runner_stubs() -> None:
    try:
        import runner.eval_api  # noqa: F401
        import runner.eval_evidence  # noqa: F401
        return
    except ModuleNotFoundError:
        pass

    runner = types.ModuleType("runner")
    runner.__path__ = []  # type: ignore[attr-defined]
    eval_api = types.ModuleType("runner.eval_api")
    eval_evidence = types.ModuleType("runner.eval_evidence")

    @dataclass(frozen=True)
    class EvidenceRequirement:
        boundaries: tuple[str, ...] = ()

    @dataclass(frozen=True)
    class EvidenceReadiness:
        status: str
        reasons: tuple[str, ...]
        required_boundaries: tuple[str, ...]

    @dataclass(frozen=True)
    class NormalizedCase:
        id: str
        selectors: tuple[str, ...]
        lane: str
        project_data: Any
        metadata: dict[str, Any]

    @dataclass(frozen=True)
    class AttemptRecord:
        attempt: int
        started_at: str
        duration_seconds: float
        host_exit_code: int | None
        result: dict[str, Any] | None
        failure: Any

    @dataclass(frozen=True)
    class CheckOutcome:
        name: str
        status: str
        reason: str
        metadata: dict[str, Any]

    @dataclass(frozen=True)
    class SemanticDecision:
        status: str
        summary: str
        data: Any

    @dataclass(frozen=True)
    class InvocationSpec:
        transport: str
        model: str
        reasoning: str | None
        agent: str | None
        skill: str | None
        workspace: Path
        workspace_mode: str
        prompt: str
        system: str | None
        expected_plugin: str | None
        engine: str
        network: str | None
        image: str | None
        auth: Path | None
        database: Path | None
        models_catalog: Path | None
        config: Path | None
        config_root: Path | None
        env_names: tuple[str, ...]
        timeout_seconds: int
        container_timeout: int

    def check_field_readiness(field: Any) -> EvidenceReadiness:
        if not isinstance(field, dict):
            return EvidenceReadiness("invalid", ("field_invalid:not_object",), ())
        state = field.get("state")
        if state == "available" and set(field) == {"state", "value"}:
            return EvidenceReadiness("ready", (), ())
        if state in {"redacted", "omitted", "unsupported"} and set(field) == {"state", "reason"}:
            status = "unsupported" if state == "unsupported" else "incomplete"
            return EvidenceReadiness(status, (f"field_{state}:{field['reason']}",), ())
        return EvidenceReadiness("invalid", ("field_invalid:state",), ())

    for module in (eval_api,):
        module.AttemptRecord = AttemptRecord
        module.CheckOutcome = CheckOutcome
        module.EvidenceReadiness = EvidenceReadiness
        module.EvidenceRequirement = EvidenceRequirement
        module.InvocationSpec = InvocationSpec
        module.JsonValue = Any
        module.NormalizedCase = NormalizedCase
        module.SemanticDecision = SemanticDecision
    eval_evidence.check_field_readiness = check_field_readiness

    sys.modules["runner"] = runner
    sys.modules["runner.eval_api"] = eval_api
    sys.modules["runner.eval_evidence"] = eval_evidence


_install_runner_stubs()

from runner.eval_api import AttemptRecord, CheckOutcome, EvidenceReadiness, NormalizedCase
from loom_eval_profile._shared import PreparedLoomCase
from loom_eval_profile.evidence_judge_adapter import (
    EVIDENCE_JUDGE_ADAPTER,
    RUNTIME_ASSERTION_REQUIREMENTS,
)


def available(value: Any) -> dict[str, Any]:
    return {"state": "available", "value": value}


def unavailable(state: str, reason: str) -> dict[str, str]:
    return {"state": state, "reason": reason}


def observation(
    *,
    tool: Any = None,
    input_value: Any = None,
    mode: str = "native",
    outcome: str = "success",
    result: Any = None,
    error: Any = None,
    start: int = 1,
    terminal: int = 2,
) -> dict[str, Any]:
    return {
        "invocation_id": f"call-{start}",
        "tool": available("loom_status" if tool is None else tool) if not isinstance(tool, dict) else tool,
        "mode": mode,
        "actor": available("general"),
        "session_id": available("session-1"),
        "message_id": available("message-1"),
        "call_id": available("call-1"),
        "parent": available(None if mode == "native" else {"kind": "invocation", "id": "outer"}),
        "input": available({"workflowId": "wf"} if input_value is None else input_value)
        if not isinstance(input_value, dict) or "state" not in input_value
        else input_value,
        "outcome": outcome,
        "result": (
            unavailable("omitted", "not_applicable")
            if outcome == "error"
            else result if isinstance(result, dict) and "state" in result else available({"status": "ok"} if result is None else result)
        ),
        "error": (
            unavailable("omitted", "not_applicable")
            if outcome == "success"
            else error if isinstance(error, dict) and "state" in error else available({"message": "failed"} if error is None else error)
        ),
        "start_sequence": start,
        "terminal_sequence": available(terminal),
    }


def case(case_id: str = "CASE-01", **overrides: Any) -> NormalizedCase:
    data = {
        "id": case_id,
        "agent": "general",
        "execution": "runtime",
        "prompt": "Inspect the workflow and answer.",
        "trap": "invent completion",
        "expectations": ["Use the observed state."],
        "must_not": ["Do not invent completion."],
    }
    data.update(overrides)
    return NormalizedCase(
        id=case_id,
        selectors=(case_id,),
        lane="runtime" if data["execution"] == "runtime" else "standard",
        project_data=data,
        metadata={},
    )


def target(*observations: dict[str, Any], text: str = "Observed state only.", **diagnostic: Any) -> AttemptRecord:
    return AttemptRecord(
        attempt=1,
        started_at="2026-10-07T00:00:00Z",
        duration_seconds=0.1,
        host_exit_code=0,
        result={
            "transport": "opencode",
            "model": "openai/gpt-6-luna",
            "reasoning": "medium",
            "reasoning_source": "explicit",
            "text": text,
            "runtime_evidence": {
                "schema": "opencode-eval-runner/runtime-evidence/v1",
                "status": "complete",
                "evidence_eligible": True,
                "observations": list(observations),
                "coverage": {},
            },
            **diagnostic,
        },
        failure=None,
    )


READY = EvidenceReadiness("ready", (), ("native", "code_mode_execution"))


class LoomEvidenceMappingTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temp = tempfile.TemporaryDirectory()
        root = Path(self.temp.name)
        self.prepared = PreparedLoomCase(1, root / "target", root / "judge")

    def tearDown(self) -> None:
        self.temp.cleanup()

    def test_runtime_family_mapping_is_explicit_and_boundary_scoped(self):
        runtime = case(
            tools={"requires": ["loom_status"]},
            actions={"requires": [{"tool": "loom_status", "args": {"workflowId": "wf"}}]},
            tool_results={"requires": [{"tool": "loom_status", "args": {"workflowId": "wf"}, "json_path": "status", "equals": "ok"}]},
        )
        requirement = EVIDENCE_JUDGE_ADAPTER.target_evidence_requirement(runtime, self.prepared)
        self.assertEqual(requirement.boundaries, ("native", "code_mode_execution"))
        self.assertEqual(RUNTIME_ASSERTION_REQUIREMENTS["tools"].fields, ("tool",))
        self.assertEqual(RUNTIME_ASSERTION_REQUIREMENTS["actions"].fields, ("tool", "input"))
        self.assertIn("result_or_error", RUNTIME_ASSERTION_REQUIREMENTS["tool_results"].fields)

        decision = case(execution="role-decision")
        self.assertEqual(
            EVIDENCE_JUDGE_ADAPTER.target_evidence_requirement(decision, self.prepared).boundaries,
            (),
        )

    def test_runtime_checks_ignore_legacy_diagnostic_tool_projections(self):
        runtime = case(
            tools={"requires": ["loom_status"], "forbids": ["loom_complete"]},
            actions={"requires": [{"tool": "loom_status", "args": {"workflowId": "wf"}}]},
        )
        actual = target(
            observation(),
            observed_tool_results={
                "events": [{"tool": "loom_complete", "input": {"workflowId": "wf"}}]
            },
            tool_result_evidence={"events": [{"tool": "loom_complete"}]},
            stdout='{"type":"tool_use","tool":"loom_complete"}',
        )
        checks = EVIDENCE_JUDGE_ADAPTER.deterministic_checks(runtime, self.prepared, actual, READY)
        self.assertTrue(checks)
        self.assertEqual({check.status for check in checks}, {"pass"})

    def test_unavailable_action_input_is_non_evidence_not_absence(self):
        runtime = case(
            actions={"requires": [{"tool": "loom_status", "args": {"workflowId": "wf"}}]},
        )
        actual = target(observation(input_value=unavailable("redacted", "credential_match")))
        checks = EVIDENCE_JUDGE_ADAPTER.deterministic_checks(runtime, self.prepared, actual, READY)
        action = next(check for check in checks if check.name == "actions.requires[0]")
        self.assertEqual(action.status, "non-evidence")
        self.assertIn("redacted", action.reason)

    def test_code_mode_exact_result_is_unsupported_non_evidence(self):
        runtime = case(
            tool_results={
                "requires": [
                    {
                        "tool": "loom_status",
                        "args": {"workflowId": "wf"},
                        "json_path": "status",
                        "equals": "ok",
                    }
                ]
            },
        )
        actual = target(
            observation(
                mode="code_mode",
                result=unavailable("unsupported", "stock_codemode_final_boundary_not_exposed"),
            )
        )
        checks = EVIDENCE_JUDGE_ADAPTER.deterministic_checks(runtime, self.prepared, actual, READY)
        result_check = next(check for check in checks if check.name == "tool_results.requires[0]")
        self.assertEqual(result_check.status, "non-evidence")
        self.assertIn("unsupported", result_check.reason.lower())

    def test_native_result_and_after_order_are_checked_from_runtime_evidence(self):
        runtime = case(
            tool_results={
                "requires": [
                    {
                        "tool": "loom_status",
                        "args": {"workflowId": "wf"},
                        "after": {"tool": "loom_complete", "args": {"workflowId": "wf"}},
                        "json_path": "workflow.status",
                        "equals": "complete",
                    }
                ]
            },
        )
        before = observation(tool="loom_complete", start=1, terminal=4, result={"outcome": "complete"})
        after = observation(tool="loom_status", start=2, terminal=3, result={"workflow": {"status": "complete"}})
        checks = EVIDENCE_JUDGE_ADAPTER.deterministic_checks(runtime, self.prepared, target(before, after), READY)
        result_check = next(check for check in checks if check.name == "tool_results.requires[0]")
        self.assertEqual(result_check.status, "pass")


class LoomJudgeContractTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temp = tempfile.TemporaryDirectory()
        root = Path(self.temp.name)
        self.prepared = PreparedLoomCase(1, root / "target", root / "judge")
        self.runtime_case = case()
        self.target = target(observation())

    def tearDown(self) -> None:
        self.temp.cleanup()

    def _judge(self, text: str) -> AttemptRecord:
        return AttemptRecord(1, "2026-10-07T00:00:00Z", 0.1, 0, {"text": text}, None)

    def _valid_payload(self) -> str:
        return (
            '{"passed":true,'
            '"expectations":[{"expectation":"Use the observed state.","met":true,"reason":"state cited"}],'
            '"violations":[{"rule":"Do not invent completion.","violated":false,"reason":"no invention"}],'
            '"trap_observed":false,"trap_evidence":"not observed","summary":"meets the case"}'
        )

    def test_judge_spec_preserves_semantics_and_only_exposes_canonical_runtime_evidence(self):
        spec = EVIDENCE_JUDGE_ADAPTER.judge_spec(self.runtime_case, self.prepared, self.target, ())
        self.assertIsNotNone(spec)
        assert spec is not None
        self.assertEqual(spec.workspace, self.prepared.judge_workspace)
        self.assertIn("POSITIVE EXPECTATIONS", spec.prompt)
        self.assertIn("Do not invent completion.", spec.prompt)
        self.assertIn("AUTHORITATIVE RUNTIME EVIDENCE", spec.prompt)
        self.assertIn("opencode-eval-runner/runtime-evidence/v1", spec.prompt)
        self.assertNotIn("OBSERVED TOOL RESULTS", spec.prompt)
        self.assertEqual(spec.model, "openai/gpt-6-luna")
        self.assertEqual(spec.reasoning, "medium")

    def test_judge_is_skipped_after_non_passing_deterministic_check(self):
        failed = CheckOutcome("deterministic", "fail", "already failed", {})
        self.assertIsNone(EVIDENCE_JUDGE_ADAPTER.judge_spec(self.runtime_case, self.prepared, self.target, (failed,)))

    def test_strict_judge_contract_maps_semantic_decision(self):
        decision = EVIDENCE_JUDGE_ADAPTER.parse_judge(
            self.runtime_case,
            self.prepared,
            self._judge(self._valid_payload()),
        )
        self.assertEqual(decision.status, "pass")
        self.assertEqual(decision.summary, "meets the case")

    def test_strict_judge_contract_rejects_duplicate_keys_mismatch_and_inconsistent_passed(self):
        duplicate = self._valid_payload().replace('{"passed":true,', '{"passed":true,"passed":true,', 1)
        mismatch = self._valid_payload().replace("Use the observed state.", "Different expectation.")
        inconsistent = self._valid_payload().replace('"passed":true', '"passed":false', 1)
        fenced = "```json\n" + self._valid_payload() + "\n```"
        for value in (duplicate, mismatch, inconsistent, fenced):
            with self.subTest(value=value[:30]):
                with self.assertRaises(ValueError):
                    EVIDENCE_JUDGE_ADAPTER.parse_judge(
                        self.runtime_case,
                        self.prepared,
                        self._judge(value),
                    )


if __name__ == "__main__":
    unittest.main()
