"""Counterexamples for the installed incremental receipt oracle, not native qualification."""
from copy import deepcopy
import hashlib
import unittest

from installed_incremental_learning import assert_idle_driver, assert_no_automatic_effects
from test_installed_learning_stage4 import driver_plan, driver_receipts


def idle_fixture(job="b" * 16, session="owner"):
    receipts = driver_receipts(job, session)
    # Keep the real-shaped prompt, inbox and first provider/step identities.
    # A no-tool fixture turn has one stopped step and no execute/follow-up.
    first = []
    for receipt in receipts:
        if receipt["type"] in ("tool-before", "tool-after"):
            continue
        first.append(deepcopy(receipt))
        if receipt["type"] == "native-event" and receipt["data"]["type"] == "session.step.ended":
            first[-1]["data"]["data"]["finish"] = "stop"
            break
    plan = {"session_id": session, "job": job, "code_sha256": hashlib.sha256(b"").hexdigest(), "idle_only": True}
    return first, plan


class IncrementalDriverOracleTest(unittest.TestCase):
    def test_one_no_tool_native_turn_has_one_explicit_driver_request(self):
        receipts, planned = idle_fixture()
        assert_idle_driver(receipts, planned)
        for kind in ("model-request", "provider-request", "tool-before"):
            with self.subTest(kind=kind):
                changed = deepcopy(receipts)
                changed.append(next((deepcopy(item) for item in receipts if item["type"] == kind),
                                    {"type": "tool-before", "data": {"tool": "execute"}}))
                with self.assertRaisesRegex(RuntimeError, "unexpected model/provider|unplanned tool"):
                    assert_idle_driver(changed, planned)

    def test_serial_engineering_and_idle_jobs_account_for_every_native_effect(self):
        normal = driver_receipts()
        normal_plan = driver_plan()[0]
        normal_plan["audit_start"] = 1
        idle_receipts, idle_plan = idle_fixture()
        idle_plan["audit_start"] = len(normal)
        combined = normal + idle_receipts[1:]
        expected = [normal_plan, idle_plan]
        result = assert_no_automatic_effects(combined, expected, "owner")
        self.assertEqual(result["planned_model_requests"], 3)
        self.assertEqual(result["automatic_model_requests"], 0)
        self.assertEqual(result["idle_turns"], 1)
        for unexpected in (
            {"type": "native-event", "data": {"type": "session.created", "data": {"sessionID": "learning-child"}}},
            {"type": "native-event", "data": {"type": "session.synthetic", "data": {"sessionID": "owner"}}},
            next(deepcopy(item) for item in idle_receipts if item["type"] == "model-request"),
        ):
            with self.subTest(unexpected=unexpected["type"]):
                with self.assertRaises(RuntimeError):
                    assert_no_automatic_effects([*combined, unexpected], expected, "owner")

    def test_no_tool_turn_cannot_hide_an_extra_admitted_input(self):
        receipts, planned = idle_fixture()
        changed = deepcopy(receipts)
        extra = next(deepcopy(item) for item in receipts if item["type"] == "native-event"
                     and item["data"]["type"] == "session.inbox.enqueued")
        extra["data"]["data"]["item"] = {"type": "synthetic", "payload": {"text": "Unrequested learning report"}}
        changed.append(extra)
        with self.assertRaisesRegex(RuntimeError, "extra or substituted input"):
            assert_idle_driver(changed, planned)


if __name__ == "__main__":
    unittest.main()
