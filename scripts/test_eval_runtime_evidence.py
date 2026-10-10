#!/usr/bin/env python3
"""Provider-free integration tests of the PR #45 runtime verdict boundary."""
from __future__ import annotations

import argparse
import copy
import importlib.util
import json
from contextlib import redirect_stdout
from io import StringIO
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from runtime_evidence_contract import assertion_status, validate_runtime_evidence

SPEC = importlib.util.spec_from_file_location("loom_run_evals", Path(__file__).with_name("run-evals.py"))
RUN = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(RUN)
FIXTURES = json.loads((Path(__file__).parent / "fixtures/runtime-evidence-v1.json").read_text())


def fixture(name="native"):
    return copy.deepcopy(FIXTURES[name])


def scenario():
    return {"id": "EVIDENCE-01", "agent": "general", "execution": "runtime",
            "prompt": "Check status.", "trap": "invent success",
            "expectations": ["Use observed outcomes."], "must_not": ["Do not invent success."]}


class RuntimeEvidenceTests(unittest.TestCase):
    def readiness(self, evidence):
        return RUN.runtime_judge_evidence({"runtime_evidence": evidence})["status"]

    def run_case(self, target, case=None, grade_pass=True, candidate=None):
        case = case or scenario()
        grade = {"passed": grade_pass,
                 "expectations": [{"expectation": case["expectations"][0], "met": grade_pass}],
                 "violations": [{"rule": case["must_not"][0], "violated": False}],
                 "trap_observed": False, "trap_evidence": "none"}
        with tempfile.TemporaryDirectory() as tmp:
            args = argparse.Namespace(iterations=1, target_transport="opencode", judge_transport="opencode",
                judge_model=None, model="test", auth=None, provider_config=None, models_catalog=None,
                database=None, timeout_seconds=30, container_timeout=60, env=[], network=None,
                image="fixture", opencode_image=None, copilot_image=None,
                artifact_dir=str(Path(tmp) / "artifacts"), keep_temp=True)
            with patch.object(RUN, "setup_projects", return_value=(Path(tmp), Path(tmp), Path(tmp))), \
                 patch.object(RUN, "setup_skill_ablation_projects", return_value=(Path(tmp), Path(tmp), Path(tmp), Path(tmp))), \
                 patch.object(RUN, "resolve_optional_file", return_value=None), \
                 patch.object(RUN, "invoke_container_with_retry", side_effect=[target, {"exit_code": 0, "text": json.dumps(grade)}, candidate or target, {"exit_code": 0, "text": json.dumps(grade)}]) as invoke, \
                 redirect_stdout(StringIO()):
                result = RUN.run_case(case, args, "podman")
            saved = json.loads((Path(args.artifact_dir) / "EVIDENCE-01.json").read_text())
            self.assertEqual(saved, result)
            return result, invoke.call_args_list

    def target(self, evidence):
        return {"exit_code": 0, "text": "Done.", "runtime_evidence": evidence}

    def test_complete_native_trace_passes_with_unsupported_unneeded_finality(self):
        evidence = fixture()
        result, calls = self.run_case(self.target(evidence))
        self.assertTrue(result["passed"])
        self.assertEqual(result["classification"], "pass")
        self.assertEqual(result["runtime_evidence"], evidence)
        self.assertEqual(result["evidence_readiness"]["required_boundaries"], ["native", "code_mode_execution"])
        self.assertEqual(result["observed_actions"][0]["tool"], "loom_status")
        prompt = calls[1].kwargs["prompt"]
        self.assertIn(json.dumps(evidence, ensure_ascii=False, sort_keys=True), prompt)
        self.assertIn("VALIDATED RUNTIME_EVIDENCE", prompt)

    def test_invalid_and_incomplete_traces_skip_judge_and_cannot_pass(self):
        malformed = fixture()
        malformed["observations"][0]["invocation_id"] = []
        duplicate = fixture()
        duplicate["observations"] *= 2
        mismatch = fixture()
        mismatch["coverage"]["starts"]["value"] = 50
        missing_field = fixture()
        del missing_field["observations"][0]["result"]
        forged_complete = fixture("unclosed")
        forged_complete.update(status="complete", evidence_eligible=True)
        for evidence in [None, {}, malformed, duplicate, mismatch, missing_field, forged_complete,
                         *[fixture(name) for name in ("missing_terminal", "unclosed", "observer_failure", "callback_failure", "unsupported")]]:
            with self.subTest(evidence=evidence):
                result, calls = self.run_case(self.target(evidence))
                self.assertFalse(result["passed"])
                self.assertEqual(result["classification"], "non-evidence")
                self.assertEqual(len(calls), 1)
                self.assertIsNone(result["semantic"])
                self.assertEqual(result["deterministic_failures"], [])

    def test_unhashable_schema_states_fail_closed(self):
        for key in ("status", "schema"):
            evidence = fixture()
            evidence[key] = []
            self.assertEqual(self.readiness(evidence), "invalid")

    def test_required_exact_fields_must_be_available(self):
        for field in ("tool", "actor", "session_id", "message_id", "call_id", "parent", "input", "result"):
            for state in ("redacted", "omitted", "unsupported"):
                with self.subTest(field=field, state=state):
                    evidence = fixture()
                    evidence["observations"][0][field] = {"state": state, "reason": "test"}
                    # Some states also change canonical aggregate accounting;
                    # either invalid or ineligible is safe, never complete.
                    self.assertNotEqual(self.readiness(evidence), "complete")
        for state in ("redacted", "omitted", "unsupported"):
            evidence = fixture("native_error")
            evidence["observations"][0]["error"] = {"state": state, "reason": "test"}
            self.assertNotEqual(self.readiness(evidence), "complete")

    def test_assertion_scope_distinguishes_unavailable_field_states(self):
        # Parent ancestry is not an accounting-required native field. This
        # isolates field-level eligibility from aggregate status accounting.
        for state, expected in (("redacted", "incomplete"), ("omitted", "incomplete"), ("unsupported", "unsupported")):
            evidence = fixture()
            evidence["observations"][0]["parent"] = {"state": state, "reason": "test"}
            validate_runtime_evidence(evidence)
            self.assertEqual(self.readiness(evidence), expected)
            self.assertEqual(assertion_status(evidence, ["native"], [("n1", "tool")]), "complete")

    def test_every_required_boundary_must_be_complete(self):
        evidence = validate_runtime_evidence(fixture("code_mode"))
        self.assertEqual(assertion_status(evidence, ["native", "code_mode_execution"]), "complete")
        self.assertEqual(assertion_status(evidence, ["native", "code_mode_finality"]), "unsupported")
        self.assertEqual(assertion_status(evidence, ["unknown_boundary"]), "unsupported")
        self.assertEqual(self.readiness(evidence), "unsupported")
        result, calls = self.run_case(self.target(evidence))
        self.assertEqual(result["classification"], "non-evidence")
        self.assertEqual(len(calls), 1)
        for boundary in ("native", "code_mode_execution"):
            for state in ("incomplete", "unsupported"):
                evidence = fixture()
                evidence["coverage"]["boundaries"][boundary].update(status=state, evidence_eligible=False)
                self.assertNotEqual(self.readiness(evidence), "complete")

    def test_unknown_or_inconsistent_coverage_cannot_mean_zero(self):
        for name in ("observer_failures", "callback_failures"):
            evidence = fixture()
            evidence["coverage"][name] = {"state": "omitted", "reason": "unknown"}
            self.assertEqual(self.readiness(evidence), "incomplete")
        for boundary in ("native", "code_mode_execution"):
            for key in ("starts", "terminals", "missing_terminals"):
                evidence = fixture()
                evidence["coverage"]["boundaries"][boundary][key] = {"state": "omitted", "reason": "unknown"}
                self.assertEqual(self.readiness(evidence), "incomplete")
                evidence["coverage"]["boundaries"][boundary][key] = {"state": "available", "value": 99}
                self.assertEqual(self.readiness(evidence), "invalid")

    def test_timeout_and_interruption_never_authorize_pass(self):
        for state in ("timeout", "interrupted"):
            evidence = fixture()
            evidence.update(status="incomplete", evidence_eligible=False)
            evidence["coverage"]["process_state"] = state
            for boundary in ("native", "code_mode_execution"):
                evidence["coverage"]["boundaries"][boundary].update(status="incomplete", evidence_eligible=False)
            self.assertEqual(self.readiness(evidence), "incomplete")
            result, calls = self.run_case(self.target(evidence))
            self.assertEqual(result["classification"], "non-evidence")
            self.assertEqual(len(calls), 1)

    def test_diagnostics_never_backfill_authority(self):
        diagnostics = {"tools": ["FAKE_TOOL"], "actions": [{"tool": "FAKE_TOOL", "args": {}}],
                       "skills_loaded": ["FAKE_SKILL"], "stdout": "FAKE_STDOUT", "stderr": "",
                       "tool_result_evidence": {"events": [{"output": "FAKE_OUTPUT"}]},
                       "observed_tool_results": {"events": [{"output": "FAKE_OUTPUT"}]}}
        target = {**self.target(fixture()), **diagnostics}
        result, calls = self.run_case(target)
        self.assertTrue(result["passed"])
        for marker in ("FAKE_TOOL", "FAKE_SKILL", "FAKE_STDOUT", "FAKE_OUTPUT"):
            self.assertNotIn(marker, calls[1].kwargs["prompt"])
        for evidence in (None, fixture("code_mode"), fixture("missing_terminal")):
            result, calls = self.run_case({**target, "runtime_evidence": evidence})
            self.assertFalse(result["passed"])
            self.assertEqual(len(calls), 1)
        # Diagnostic required calls cannot satisfy deterministic assertions even
        # if a semantic judge returns PASS and capture is valid and empty.
        case = {**scenario(), "tools": {"requires": ["FAKE_TOOL"]}}
        result, _ = self.run_case({**target, "runtime_evidence": fixture("empty")}, case)
        self.assertEqual(result["classification"], "behavioral-fail")
        self.assertFalse(result["passed"])

    def test_valid_error_is_evidence_not_an_automatic_behavioral_failure(self):
        result, calls = self.run_case(self.target(fixture("native_error")))
        self.assertTrue(result["passed"])
        self.assertIn("permission denied", calls[1].kwargs["prompt"])
        result, _ = self.run_case(self.target(fixture()), grade_pass=False)
        self.assertEqual(result["classification"], "behavioral-fail")

    def test_runtime_skill_cases_cannot_bypass_readiness(self):
        case = {**scenario(), "_skill_owned": True, "skill": "python-testing"}
        result, calls = self.run_case(self.target(None), case)
        self.assertEqual(result["classification"], "non-evidence")
        self.assertEqual(len(calls), 1)

    def test_skill_candidate_evidence_is_gated_separately(self):
        case = {**scenario(), "_skill_owned": True, "skill": "python-testing"}
        result, calls = self.run_case(self.target(fixture("empty")), case, candidate=self.target(None))
        self.assertEqual(result["classification"], "non-evidence")
        self.assertEqual(result["candidate"]["evidence_readiness"]["status"], "invalid")
        self.assertEqual(len(calls), 3)

    def test_skill_load_uses_authoritative_call_not_diagnostic_list(self):
        case = {**scenario(), "_skill_owned": True, "skill": "python-testing"}
        candidate = self.target(fixture())
        candidate["skills_loaded"] = ["python-testing"]
        result, _ = self.run_case(self.target(fixture("empty")), case, candidate=candidate)
        self.assertFalse(result["passed"])
        self.assertIn("skill under test not confirmed loaded: python-testing", result["deterministic_failures"])
        item = candidate["runtime_evidence"]["observations"][0]
        item["tool"]["value"] = "skill"
        item["input"]["value"] = {"name": "python-testing"}
        result, calls = self.run_case(self.target(fixture("empty")), case, candidate=candidate)
        self.assertTrue(result["passed"])
        self.assertEqual(len(calls), 4)

    def test_product_failure_still_blocks_pass_with_complete_evidence(self):
        target = {**self.target(fixture()), "exit_code": 1, "stderr": "product failed"}
        result, calls = self.run_case(target)
        self.assertFalse(result["passed"])
        self.assertEqual(result["evidence_readiness"]["status"], "complete")
        self.assertIsNotNone(result["target_error"])
        self.assertEqual(len(calls), 1)

    def test_local_redaction_removes_exact_field_eligibility_without_mutation(self):
        secret = 'sk-test-"quoted-secret-0123456789'
        target = self.target(fixture())
        target["runtime_evidence"]["observations"][0]["result"]["value"] = {"token": secret}
        prepared = RUN.prepare_transport_result(target, [secret])
        field = prepared["runtime_evidence"]["observations"][0]["result"]
        self.assertEqual(field, {"state": "redacted", "reason": "loom_credential_redaction"})
        self.assertEqual(self.readiness(prepared["runtime_evidence"]), "incomplete")
        self.assertEqual(target["runtime_evidence"]["observations"][0]["result"]["state"], "available")
        self.assertNotIn(secret, json.dumps(prepared))

    def test_nonruntime_modes_do_not_require_runtime_evidence(self):
        for mode in ("role-decision", "conversation-response"):
            result, calls = self.run_case(self.target(None), {**scenario(), "execution": mode})
            self.assertTrue(result["passed"])
            self.assertEqual(len(calls), 2)
            self.assertIsNone(result["evidence_readiness"])


if __name__ == "__main__":
    unittest.main()
