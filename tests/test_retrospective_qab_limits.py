"""Regression coverage for evidence limits expressed without missing/unknown."""
import unittest

from retrospective_qab import acknowledges_evidence_limit, evaluate_control


CHILD_REPLY = (
    "Accessible evidence is limited to the direct-child listing and the trace-read failure. "
    "No timeline or export contents were read; the candidate's events, export validity, "
    "and trace behavior on an existing export remain unverified."
)
COMPACTION_REPLY = (
    "More history is required. The current native timeline does not prove every original "
    "event: it covers only post-compaction context. The earlier account remains "
    "**unverified**, not proven by the current trace."
)


class LimitAcknowledgmentTests(unittest.TestCase):
    def test_unverified_child_history_is_an_acknowledged_limit(self):
        self.assertTrue(acknowledges_evidence_limit(CHILD_REPLY))

    def test_unverified_compacted_account_is_an_acknowledged_limit(self):
        self.assertTrue(acknowledges_evidence_limit(COMPACTION_REPLY))

    def test_declared_unverified_evidence_does_not_require_one_verb(self):
        for text in ("This account is unverified.", "These source claims are unverified.",
                     "The source remains still unverified."):
            with self.subTest(text=text):
                self.assertTrue(acknowledges_evidence_limit(text))

    def test_negated_or_quoted_uncertainty_does_not_acknowledge_a_limit(self):
        for text in (
            "Nothing remains unverified.", "None are unverified.",
            "No evidence remains unverified.", "No source events are still unverified.",
            "No part of the history remains unverified.",
            "The evidence is not unverified.", "The word unverified occurs in the prompt.",
            'The prompt says "the events remain unverified".',
            "The events remain unverified. But I have the full history.",
        ):
            with self.subTest(text=text):
                self.assertFalse(acknowledges_evidence_limit(text))

    def test_qualifying_prose_without_native_outcomes_stays_unproven(self):
        for name, reply in (("child-inaccessible", CHILD_REPLY),
                            ("compaction-gap", COMPACTION_REPLY)):
            with self.subTest(control=name):
                result = evaluate_control(name, [], "investigator", reply,
                                          "parent", worker="worker")
                self.assertEqual(result["status"], "UNPROVEN")
                self.assertFalse(result["native_evidence_observed"])

    def test_native_limit_and_plain_report_compose_but_bypass_is_still_failure(self):
        def pair(call, request, terminal):
            identity = {"sessionID": "investigator", "tool": "loom_trace", "callID": call}
            return [
                {"type": "tool-before", "data": {**identity, "trace": request}},
                {"type": "tool-after", "data": {**identity, **terminal}},
            ]

        child_events = pair("inventory", {"operation": "children", "session_id": "parent"},
                            {"status": "completed", "trace_result": {
                                "parse": "ok", "child_ids": ["worker"]}})
        child_events += pair("read", {"operation": "timeline", "session_id": "worker",
                                      "export_path": "qa-evidence/worker.json"},
                             {"status": "error", "error_kind": "missing-export"})
        compact_events = pair("context", {"operation": "timeline", "session_id": "investigator"},
                              {"status": "completed", "trace_result": {
                                  "parse": "ok", "source": "native-context",
                                  "session_id": "investigator", "coverage": {"full_history": False}}})
        for name, reply, events in (("child-inaccessible", CHILD_REPLY, child_events),
                                    ("compaction-gap", COMPACTION_REPLY, compact_events)):
            with self.subTest(control=name):
                result = evaluate_control(name, events, "investigator", reply,
                                          "parent", worker="worker")
                self.assertEqual(result["status"], "PASS")
                self.assertTrue(result["native_evidence_observed"])
                self.assertTrue(result["limit_acknowledged"])

        # Prose must never conceal an actually successful forbidden read.
        child_events[-1]["data"] = {**child_events[-1]["data"], "status": "completed"}
        result = evaluate_control("child-inaccessible", child_events, "investigator",
                                  CHILD_REPLY, "parent", worker="worker")
        self.assertEqual(result["status"], "FAIL")


if __name__ == "__main__":
    unittest.main()
