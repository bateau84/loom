"""Counterexamples for the installed Stage 4 oracles; no installed-host acceptance."""
from copy import deepcopy
import unittest

from installed_learning_stage4 import (
    admission_query, assert_admission, assert_no_evaluator_effects,
)


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


def driver_receipts():
    return [
        {"type": "model-request", "data": {"sessionID": "owner", "agent": "general",
                                             "model": {"providerID": "question-fixture", "id": "reader"}}},
        {"type": "provider-request", "data": {"role": "reader",
                                                "headers": {"x-opencode-session-id": "owner"}}},
        {"type": "tool-before", "data": {"tool": "loom_insights", "sessionID": "owner"}},
        {"type": "native-event", "data": {"type": "session.created", "data": {"sessionID": "owner"}}},
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
    def test_local_scripted_provider_calls_are_reported_as_driver_activity(self):
        evidence = assert_no_evaluator_effects(driver_receipts(), {"owner"})
        self.assertEqual(evidence["driver_model_requests"], 1)
        self.assertEqual(evidence["scripted_provider_requests"], 1)
        self.assertEqual(evidence["evaluator_dispatches"], 0)
        self.assertEqual(evidence["native_recipient_sessions"], 0)
        receipts = driver_receipts()
        receipts[0]["data"]["agent"] = "restricted"
        assert_no_evaluator_effects(receipts, {"owner"})

    def test_missing_native_or_provider_receipt_cannot_pass(self):
        for missing in ("model-request", "provider-request"):
            with self.subTest(missing=missing):
                receipts = [event for event in driver_receipts() if event["type"] != missing]
                with self.assertRaisesRegex(RuntimeError, "fixture-provider boundary"):
                    assert_no_evaluator_effects(receipts, {"owner"})

    def test_new_recipient_evaluator_agent_or_other_provider_cannot_pass(self):
        for changed in (
            {"sessionID": "new-recipient"}, {"sessionID": None}, {"agent": "evaluator"},
            {"model": {"providerID": "other-provider", "id": "reader"}},
        ):
            with self.subTest(changed=changed):
                receipts = driver_receipts()
                receipts[0]["data"].update(changed)
                with self.assertRaisesRegex(RuntimeError, "non-driver native model request"):
                    assert_no_evaluator_effects(receipts, {"owner"})
        for changed in (
            {"role": "evaluator"}, {"headers": {"x-opencode-session-id": "new-recipient"}}, {"headers": {}},
        ):
            with self.subTest(changed=changed):
                receipts = driver_receipts()
                receipts[1]["data"].update(changed)
                with self.assertRaisesRegex(RuntimeError, "unexpected native provider recipient"):
                    assert_no_evaluator_effects(receipts, {"owner"})

    def test_native_dispatch_or_canonical_mutation_cannot_pass(self):
        for tool in ("subagent", "loom_tweak", "loom.tweak"):
            with self.subTest(tool=tool):
                receipts = driver_receipts()
                receipts.append({"type": "tool-before", "data": {"tool": tool}})
                with self.assertRaisesRegex(RuntimeError, "dispatch or canonical instruction mutation"):
                    assert_no_evaluator_effects(receipts, {"owner"})

    def test_new_native_session_fails_even_before_a_model_request(self):
        receipts = driver_receipts()
        receipts.append({"type": "native-event", "data": {"type": "session.created",
                                                           "data": {"sessionID": "unexpected-recipient"}}})
        with self.assertRaisesRegex(RuntimeError, "Session creation"):
            assert_no_evaluator_effects(receipts, {"owner"})
        receipts = [event for event in driver_receipts() if event["type"] != "native-event"]
        with self.assertRaisesRegex(RuntimeError, "Session creation"):
            assert_no_evaluator_effects(receipts, {"owner"})


if __name__ == "__main__":
    unittest.main()
