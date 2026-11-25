"""Counterexamples for the installed Stage 4 oracles; no installed-host acceptance."""
from copy import deepcopy
import hashlib
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from installed_learning_stage4 import (
    admission_query, assert_admission, assert_no_evaluator_effects,
)
from installed_questions import Scenario


def preparation():
    return {
        "batch_id": "prepared-batch", "request_id": "request", "method_id": "declared-method",
        "manifest_sha256": "a" * 64, "manifest": {"source_store_id": "source-store"},
        "request": {"source_scope": "calling-session-existing-evidence", "budget_policy": None},
        "issue": {"intent": {"request_id": "request", "kind": "initial"}, "attempt": {
            "attempt_id": "attempt", "state": "prepared", "claimant_id": None,
            "claimed_at": None, "native_outcome": "not-issued", "native_binding": {"status": "unknown"},
        }},
    }


def assessment():
    prepared = preparation()
    return {
        "format": "loom-evaluation-admission-assessment/v1", "state": "blocked", "mode": "assessment-only",
        "batch_id": "prepared-batch", "request_id": "request", "method_id": "declared-method",
        "manifest_sha256": "a" * 64, "source_store_id": "source-store",
        "source_scope": "calling-session-existing-evidence", "method_binding": "declared-not-admitted",
        "local_issue": prepared["issue"], "source_processing": "enabled", "dispatch_enabled": False,
        "automatic_model_calls": False, "effect_permit": None, "native_effect_identity": "not-established",
        "budget_reservation": None, "budget_accounting": "not-established",
        "blockers": [
            {"capability": "effective-method", "state": "unsupported", "reason": "effective-method-authority-unavailable"},
            {"capability": "recipient", "state": "unsupported", "reason": "qualified-recipient-preparation-unavailable"},
            {"capability": "recipient-source-access", "state": "unsupported", "reason": "recipient-source-authority-unavailable"},
            {"capability": "model-provider-account", "state": "unsupported", "reason": "model-account-authority-unavailable"},
            {"capability": "budget", "state": "missing", "reason": "budget-policy-missing"},
            {"capability": "budget-reservation", "state": "unsupported", "reason": "atomic-budget-owner-unavailable"},
            {"capability": "native-reconciliation", "state": "unsupported", "reason": "native-effect-reconciliation-unavailable"},
        ],
        "recovery": {"state": "qualification-required", "retry_authority": "unavailable",
                     "restore_reconciliation": "unsupported"},
        "qualifications": {
            "Q4": "partial-unqualified", "Q5": "unqualified-transfer-withheld", "E11": "unqualified",
            "originating_request_independence": "unknown", "reader_access_is_recipient_authority": False,
            "local_state_proves_native_nonexecution": False,
        },
    }


def driver_plan(job="a" * 16, session="owner"):
    return [{"session_id": session, "job": job,
             "code_sha256": hashlib.sha256(b"return 'fixture';").hexdigest()}]


def driver_receipts(job="a" * 16, session="owner", *, agent="general"):
    """One native prompt, one Code Mode call and its ordinary model follow-up."""
    def event(kind, data):
        return {"type": kind, "data": data}

    def native(kind, data):
        return event("native-event", {"type": kind, "data": data})

    model = {"providerID": "question-fixture", "id": "reader"}
    prompt = "LOOM_HARNESS_JOB:" + job
    message_id, first_step, second_step, call_id = [job + suffix for suffix in (":user", ":tool", ":final", ":call")]
    request = {"sessionID": session, "agent": agent, "model": model, "kind": "primary"}
    call = {"tool": "execute", "sessionID": session, "messageID": first_step,
            "id": call_id, "input": {"code": "return 'fixture';"}}
    provider = {"role": "reader", "headers": {"x-opencode-session-id": session},
                "prompt": [{"role": "user", "content": [{"type": "text", "text": prompt}]}]}
    followup = deepcopy(provider)
    followup["prompt"].extend([
        {"role": "assistant", "content": [{"type": "tool-call", "toolName": "execute", "toolCallId": call_id}]},
        {"role": "tool", "content": [{"type": "tool-result", "toolName": "execute", "toolCallId": call_id}]},
    ])
    return [
        native("session.created", {"sessionID": session}),
        event("prompt", {"sessionID": session, "messageID": message_id, "prompt": {"text": prompt}}),
        native("session.inbox.enqueued", {"sessionID": session, "inboxID": message_id,
                                          "item": {"type": "user", "payload": {"text": prompt}}}),
        native("session.inbox.delivered", {"sessionID": session, "inboxID": message_id}),
        event("model-request", deepcopy(request)), event("provider-request", provider),
        native("session.step.started", {**request, "assistantMessageID": first_step}),
        event("tool-before", call), event("tool-after", {**call, "status": "completed"}),
        native("session.step.ended", {"sessionID": session, "assistantMessageID": first_step, "finish": "tool-calls"}),
        event("model-request", deepcopy(request)), event("provider-request", followup),
        native("session.step.started", {**request, "assistantMessageID": second_step}),
        native("session.step.ended", {"sessionID": session, "assistantMessageID": second_step, "finish": "stop"}),
    ]


class AdmissionOracleTest(unittest.TestCase):
    def test_selector_uses_exact_preparation_and_canonical_attempt(self):
        self.assertEqual(admission_query(preparation()), {
            "operation": "evaluation-admission", "batch_id": "prepared-batch", "request_id": "request",
            "manifest_sha256": "a" * 64, "attempt_id": "attempt",
        })

    def test_declared_budget_and_capture_off_preserve_distinct_blockers(self):
        assert_admission(assessment(), preparation())
        prepared, value = preparation(), assessment()
        prepared["request"]["budget_policy"] = {"id": "declared-budget", "revision": "1", "sha256": "b" * 64}
        value["blockers"][4] = {"capability": "budget", "state": "unsupported",
                                "reason": "declared-budget-policy-is-not-authority"}
        assert_admission(value, prepared)
        value["source_processing"] = "disabled"
        value["blockers"].append({"capability": "source-processing", "state": "blocked",
                                  "reason": "source-processing-disabled"})
        assert_admission(value, prepared, capture_enabled=False)
        with self.assertRaisesRegex(RuntimeError, "source-processing configuration"):
            assert_admission(value, prepared)

    def test_readable_status_cannot_hide_an_effect_or_budget_authority(self):
        changes = {
            "dispatch_enabled": True, "automatic_model_calls": True, "effect_permit": {},
            "budget_reservation": {}, "budget_accounting": "reserved", "native_effect_identity": "native-id",
        }
        for field, changed in changes.items():
            with self.subTest(field=field):
                value = assessment()
                value[field] = changed
                with self.assertRaisesRegex(RuntimeError, "effect or budget authority"):
                    assert_admission(value, preparation())

    def test_changed_identity_or_canonical_claim_cannot_pass(self):
        for field in ("batch_id", "request_id", "method_id", "manifest_sha256"):
            with self.subTest(field=field):
                value = assessment()
                value[field] = "other"
                with self.assertRaisesRegex(RuntimeError, "changed " + field):
                    assert_admission(value, preparation())
        value = assessment()
        value["local_issue"]["attempt"]["claimant_id"] = "unexpected-claim"
        with self.assertRaisesRegex(RuntimeError, "canonical issue"):
            assert_admission(value, preparation())

    def test_missing_duplicated_or_upgraded_capability_blocker_cannot_pass(self):
        for kind in ("missing", "duplicate", "upgraded", "q4-blanket-blocker"):
            with self.subTest(kind=kind):
                value = assessment()
                if kind == "missing":
                    value["blockers"].pop()
                elif kind == "duplicate":
                    value["blockers"][-1] = deepcopy(value["blockers"][0])
                elif kind == "upgraded":
                    value["blockers"][0]["state"] = "authorized"
                else:
                    value["blockers"].append({"capability": "Q4", "state": "blocked", "reason": "unqualified"})
                with self.assertRaisesRegex(RuntimeError, "capability blocker"):
                    assert_admission(value, preparation())

    def test_recovery_and_reader_authority_cannot_be_upgraded(self):
        for section, field, changed, error in (
            ("recovery", "state", "ready-to-retry", "native recovery"),
            ("recovery", "restore_reconciliation", "supported", "native recovery"),
            ("qualifications", "reader_access_is_recipient_authority", True, "qualification boundary"),
            ("qualifications", "local_state_proves_native_nonexecution", True, "qualification boundary"),
            ("qualifications", "Q4", "qualified", "qualification boundary"),
            ("qualifications", "Q5", "qualified", "qualification boundary"),
        ):
            with self.subTest(section=section, field=field):
                value = assessment()
                value[section][field] = changed
                with self.assertRaisesRegex(RuntimeError, error):
                    assert_admission(value, preparation())


class NoEvaluatorEffectOracleTest(unittest.TestCase):
    def test_intended_jobs_are_recorded_before_native_prompt_and_across_restart(self):
        plan = []
        with tempfile.TemporaryDirectory(prefix="loom-stage4-oracle-") as temp:
            root = Path(temp)
            with patch("installed_questions.events", return_value=[]), patch("installed_questions.request") as native:
                def admitted(host, method, path, body):
                    self.assertEqual(len(plan), native.call_count)
                    self.assertEqual(body["text"], "LOOM_HARNESS_JOB:" + plan[-1]["job"])
                    self.assertEqual(plan[-1]["session_id"], "owner")
                    self.assertEqual(plan[-1]["code_sha256"], driver_plan()[0]["code_sha256"])
                native.side_effect = admitted
                Scenario(None, root, plan).begin("owner", "return 'fixture';")
                Scenario(None, root, plan).begin("owner", "return 'fixture';")
        self.assertEqual(len(plan), 2)
        self.assertNotEqual(plan[0]["job"], plan[1]["job"])

    def test_local_scripted_provider_calls_are_reported_as_driver_activity(self):
        evidence = assert_no_evaluator_effects(driver_receipts(), {"owner"}, driver_plan())
        self.assertEqual(evidence["driver_model_requests"], 2)
        self.assertEqual(evidence["scripted_provider_requests"], 2)
        self.assertEqual(evidence["evaluator_dispatches"], 0)
        self.assertEqual(evidence["native_recipient_sessions"], 0)
        self.assertEqual(evidence["planned_driver_invocations"], 1)
        self.assertEqual(evidence["expected_tool_followup_requests"], 1)
        self.assertEqual(evidence["native_auxiliary_requests"], 0)
        self.assertTrue(evidence["invocation_sequence_reconciled"])
        assert_no_evaluator_effects(driver_receipts(agent="restricted"), {"owner"}, driver_plan())

    def test_missing_native_or_provider_receipt_cannot_pass(self):
        for missing in ("model-request", "provider-request"):
            with self.subTest(missing=missing):
                receipts = [event for event in driver_receipts() if event["type"] != missing]
                with self.assertRaisesRegex(RuntimeError, "fixture-provider boundary"):
                    assert_no_evaluator_effects(receipts, {"owner"}, driver_plan())

    def test_new_recipient_evaluator_agent_or_other_provider_cannot_pass(self):
        for changed in (
            {"sessionID": "new-recipient"}, {"sessionID": None}, {"agent": "evaluator"},
            {"model": {"providerID": "other-provider", "id": "reader"}},
        ):
            with self.subTest(changed=changed):
                receipts = driver_receipts()
                next(event["data"] for event in receipts if event["type"] == "model-request").update(changed)
                with self.assertRaisesRegex(RuntimeError, "non-driver native model request"):
                    assert_no_evaluator_effects(receipts, {"owner"}, driver_plan())
        for changed in (
            {"role": "evaluator"}, {"headers": {"x-opencode-session-id": "new-recipient"}}, {"headers": {}},
        ):
            with self.subTest(changed=changed):
                receipts = driver_receipts()
                next(event["data"] for event in receipts if event["type"] == "provider-request").update(changed)
                with self.assertRaisesRegex(RuntimeError, "unexpected native provider recipient"):
                    assert_no_evaluator_effects(receipts, {"owner"}, driver_plan())

    def test_native_dispatch_or_canonical_mutation_cannot_pass(self):
        for tool in ("subagent", "loom_tweak", "loom.tweak"):
            with self.subTest(tool=tool):
                receipts = driver_receipts()
                receipts.append({"type": "tool-before", "data": {"tool": tool}})
                with self.assertRaisesRegex(RuntimeError, "dispatch or canonical instruction mutation"):
                    assert_no_evaluator_effects(receipts, {"owner"}, driver_plan())

    def test_new_native_session_fails_even_before_a_model_request(self):
        receipts = driver_receipts()
        receipts.append({"type": "native-event", "data": {"type": "session.created",
                                                           "data": {"sessionID": "unexpected-recipient"}}})
        with self.assertRaisesRegex(RuntimeError, "Session creation"):
            assert_no_evaluator_effects(receipts, {"owner"}, driver_plan())
        receipts = [event for event in driver_receipts() if event["type"] != "native-event"]
        with self.assertRaisesRegex(RuntimeError, "Session creation"):
            assert_no_evaluator_effects(receipts, {"owner"}, driver_plan())

    def test_unexpected_complete_invocation_using_a_legitimate_driver_is_rejected(self):
        # Distinct genuine-looking prompt/step/call IDs, same allowed Session,
        # agent and provider: the old identity allowlist accepted this sequence.
        receipts = driver_receipts() + driver_receipts("b" * 16)
        with self.assertRaisesRegex(RuntimeError, "prompt invocation sequence"):
            assert_no_evaluator_effects(receipts, {"owner"}, driver_plan())

    def test_unexpected_send_without_an_extra_prompt_is_rejected(self):
        receipts = driver_receipts()
        receipts.extend(deepcopy([event for event in receipts if event["type"] in ("model-request", "provider-request")][-2:]))
        with self.assertRaisesRegex(RuntimeError, "model/provider invocation"):
            assert_no_evaluator_effects(receipts, {"owner"}, driver_plan())

    def test_duplicate_cannot_replace_another_planned_job_with_equal_aggregate_counts(self):
        plan = driver_plan() + driver_plan("b" * 16)
        receipts = driver_receipts() + driver_receipts("b" * 16)
        assert_no_evaluator_effects(receipts, {"owner"}, plan)
        providers = [event for event in receipts if event["type"] == "provider-request"]
        providers[2]["data"] = deepcopy(providers[0]["data"])
        with self.assertRaisesRegex(RuntimeError, "Provider invocation sequence"):
            assert_no_evaluator_effects(receipts, {"owner"}, plan)

    def test_model_and_provider_counts_must_reconcile_individually(self):
        for kind in ("model-request", "provider-request"):
            with self.subTest(kind=kind):
                receipts = driver_receipts()
                receipts.append(deepcopy(next(event for event in receipts if event["type"] == kind)))
                with self.assertRaisesRegex(RuntimeError, "model/provider invocation"):
                    assert_no_evaluator_effects(receipts, {"owner"}, driver_plan())

    def test_unplanned_auxiliary_request_cannot_masquerade_as_a_driver_followup(self):
        # This fixture resolves title without inference and does not request
        # compaction. An auxiliary request needs its own explicit expectation.
        for kind in ("title", "compaction", None):
            with self.subTest(kind=kind):
                receipts = driver_receipts()
                requests = [event["data"] for event in receipts if event["type"] == "model-request"]
                requests[-1]["kind"] = kind
                with self.assertRaisesRegex(RuntimeError, "auxiliary request"):
                    assert_no_evaluator_effects(receipts, {"owner"}, driver_plan())

    def test_native_step_and_execute_identity_are_reconciled(self):
        for kind, change, expected in (
            ("session.step.started", {"assistantMessageID": "extra-step"}, "step outcomes"),
            ("session.step.ended", {"finish": "error"}, "step outcomes"),
            ("tool-after", {"id": "another-call"}, "expected step and result"),
            ("tool-before", {"input": {"code": "return 'unexpected';"}}, "planned script"),
            ("session.inbox.delivered", {"inboxID": "another-prompt"}, "delivered-input sequence"),
        ):
            with self.subTest(kind=kind, change=change):
                receipts = driver_receipts()
                target = next(event["data"]["data"] if event["type"] == "native-event" else event["data"]
                              for event in receipts if event["type"] == kind
                              or event["type"] == "native-event" and event["data"]["type"] == kind)
                target.update(change)
                with self.assertRaisesRegex(RuntimeError, expected):
                    assert_no_evaluator_effects(receipts, {"owner"}, driver_plan())

    def test_followup_must_contain_the_exact_native_tool_result(self):
        receipts = driver_receipts()
        provider = [event["data"] for event in receipts if event["type"] == "provider-request"][-1]
        provider["prompt"][-1]["content"][0]["toolCallId"] = "different-result"
        with self.assertRaisesRegex(RuntimeError, "exact native result follow-up"):
            assert_no_evaluator_effects(receipts, {"owner"}, driver_plan())


if __name__ == "__main__":
    unittest.main()
