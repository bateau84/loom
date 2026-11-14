"""Oracle tests only: synthetic traces never qualify an installed host."""
import copy
import argparse
import json
import tempfile
import unittest
from pathlib import Path

from native_review_oracle import dispatch_receipts, source_basis


def dispatch_trace():
    source = {"sessionID": "parent", "messageID": "message", "id": "call",
              "agent": "general", "tool": "subagent", "input": {"prompt": "review"}}
    return [
        {"type": "ready", "data": {}},
        {"type": "tool-before", "data": source},
        {"type": "tool-after", "data": {**source, "status": "completed",
            "result": {"output": {"sessionID": "child", "status": "completed"},
                       "metadata": {"sessionID": "child"}}}},
    ]


def child_progress():
    return {"type": "native-event", "data": {"type": "session.tool.progress", "data": {
        "sessionID": "parent", "assistantMessageID": "message", "id": "call",
        "metadata": {"sessionID": "child"}}}}


class NativeReviewOracleTest(unittest.TestCase):
    def test_dispatch_uses_native_call_and_result_without_inventing_admission(self):
        receipt, = dispatch_receipts(dispatch_trace())
        self.assertEqual(receipt["binding"], "observed")
        self.assertEqual(receipt["parent"], ["parent", "message", "call"])
        self.assertEqual(receipt["child_session_id"], "child")
        self.assertEqual(receipt["admission_binding"], "UNQUALIFIED")

    def test_completion_before_invocation_cannot_bind_a_child(self):
        observed = dispatch_trace()
        observed[1:] = reversed(observed[1:])
        receipt, = dispatch_receipts(observed)
        self.assertEqual(receipt["binding"], "ambiguous")
        self.assertIsNone(receipt["child_session_id"])
        self.assertEqual(receipt["reason"], "reversed-hook-order")

    def test_missing_observer_start_leaves_dispatch_unqualified(self):
        receipt, = dispatch_receipts(dispatch_trace()[1:])
        self.assertEqual(receipt["binding"], "unknown")
        self.assertIsNone(receipt["child_session_id"])
        self.assertEqual(receipt["reason"], "missing-observer-continuity")

    def test_observer_boundary_prevents_cross_segment_return(self):
        for boundary in ("ready", "observer-failure"):
            observed = dispatch_trace()
            observed.insert(2, {"type": boundary, "data": {}})
            with self.subTest(boundary=boundary):
                receipt, = dispatch_receipts(observed)
                self.assertEqual(receipt["binding"], "unknown")
                self.assertIsNone(receipt["child_session_id"])
                self.assertEqual(receipt["reason"], "missing-observer-continuity")

    def test_progress_from_another_observer_segment_does_not_bind(self):
        for boundary in ("ready", "observer-failure"):
            observed = dispatch_trace()[:2] + [{"type": boundary, "data": {}}, child_progress()]
            with self.subTest(boundary=boundary):
                receipt, = dispatch_receipts(observed)
                self.assertEqual(receipt["binding"], "unknown")
                self.assertIsNone(receipt["child_session_id"])
                self.assertEqual(receipt["progress_receipts"], [])

    def test_progress_before_invocation_cannot_establish_or_rescue_a_binding(self):
        ready, before, after = dispatch_trace()
        for ending in ([], [after]):
            with self.subTest(has_return=bool(ending)):
                receipt, = dispatch_receipts([ready, child_progress(), before, *ending])
                self.assertEqual(receipt["binding"], "ambiguous")
                self.assertIsNone(receipt["child_session_id"])
                self.assertEqual(receipt["reason"], "reversed-progress-order")

    def test_new_ready_restores_only_a_new_local_observer_segment(self):
        observed = [{"type": "ready", "data": {}}, {"type": "observer-failure", "data": "lost"}]
        receipt, = dispatch_receipts(observed + dispatch_trace())
        self.assertEqual(receipt["binding"], "observed")
        self.assertEqual(receipt["observer_ready_receipt"], 3)
        self.assertEqual(receipt["admission_binding"], "UNQUALIFIED")

    def test_progress_only_and_delayed_progress_preserve_narrow_child_binding(self):
        ready, before, after = dispatch_trace()
        for ending in ([], [after]):
            with self.subTest(has_return=bool(ending)):
                receipt, = dispatch_receipts([ready, before, *ending, child_progress()])
                self.assertEqual(receipt["binding"], "observed")
                self.assertEqual(receipt["child_session_id"], "child")
                self.assertEqual(receipt["after_receipts"], [3] if ending else [])
                self.assertEqual(receipt["progress_receipts"], [4] if ending else [3])
                self.assertEqual(receipt["admission_binding"], "UNQUALIFIED")

    def test_progress_does_not_rescue_a_reversed_completion(self):
        ready, before, after = dispatch_trace()
        receipt, = dispatch_receipts([ready, after, before, child_progress()])
        self.assertEqual(receipt["binding"], "ambiguous")
        self.assertEqual(receipt["reason"], "reversed-hook-order")

    def test_identical_replayed_hooks_are_not_silently_deduplicated(self):
        for index in (1, 2):
            observed = dispatch_trace()
            observed.append(copy.deepcopy(observed[index]))
            with self.subTest(replayed=observed[index]["type"]):
                receipts = dispatch_receipts(observed)
                self.assertTrue(receipts)
                self.assertTrue(all(row["binding"] == "ambiguous" for row in receipts))
                self.assertTrue(all(row["reason"] == "reused-native-key" for row in receipts))

    def test_missing_start_does_not_create_a_dispatch(self):
        ready, _, after = dispatch_trace()
        self.assertEqual(dispatch_receipts([ready, after, child_progress()]), [])

    def test_observer_failure_cannot_reuse_the_previous_ready(self):
        ready, before, after = dispatch_trace()
        receipt, = dispatch_receipts([ready, {"type": "observer-failure", "data": "lost"}, before, after])
        self.assertEqual(receipt["binding"], "unknown")
        self.assertIsNone(receipt["observer_ready_receipt"])

    def test_missing_or_reused_keys_and_conflicting_child_cannot_be_joined(self):
        missing = dispatch_trace()
        for event in missing[1:]:
            del event["data"]["id"]
        duplicate = dispatch_trace()
        duplicate.insert(2, copy.deepcopy(duplicate[1]))
        conflicting = dispatch_trace()
        conflicting[2]["data"]["result"]["metadata"]["sessionID"] = "other-child"
        for observed in (missing, duplicate, conflicting):
            with self.subTest(observed=observed):
                self.assertTrue(all(row["binding"] != "observed" for row in dispatch_receipts(observed)))

    def test_wrong_call_or_actor_does_not_pair_identical_prompt_and_timing(self):
        for field in ("id", "agent", "messageID", "sessionID"):
            observed = dispatch_trace()
            observed[-1]["data"][field] = "other"
            with self.subTest(field=field):
                self.assertNotEqual(dispatch_receipts(observed)[0]["binding"], "observed")

    def test_citation_pointer_and_another_sessions_payload_do_not_prove_supply(self):
        observed = [
            {"type": "provider-request", "data": {"headers": {"x-opencode-session-id": "other"},
                "prompt": [{"role": "user", "content": "SOURCE_BYTES"}]}},
            {"type": "provider-request", "data": {"headers": {"x-opencode-session-id": "reviewer"},
                "prompt": [{"role": "user", "content": "manifest://evidence-a.txt"}]}},
            {"type": "context", "data": {"sessionID": "reviewer", "messages": ["SOURCE_BYTES"]}},
        ]
        basis = source_basis(observed, "reviewer", "evidence-a.txt", "SOURCE_BYTES")
        self.assertEqual(basis["supplied"], [])
        self.assertEqual(basis["retrieved"], [])
        self.assertEqual(basis["same_review_invocation"], "UNQUALIFIED")

    def test_actual_provider_bytes_and_completed_native_read_keep_separate_receipts(self):
        observed = [
            {"type": "provider-request", "data": {"headers": {"x-opencode-session-id": "reviewer"},
                "prompt": [{"role": "user", "content": "SOURCE_BYTES"}]}},
            {"type": "tool-after", "data": {"sessionID": "reviewer", "messageID": "m", "id": "c",
                "tool": "read", "input": {"path": "evidence-a.txt"}, "status": "completed",
                "result": {"content": [{"type": "text", "text": "SOURCE_BYTES"}]}}},
        ]
        basis = source_basis(observed, "reviewer", "evidence-a.txt", "SOURCE_BYTES")
        self.assertEqual(basis["supplied"], [1])
        self.assertEqual(basis["retrieved"], [{"receipt": 2, "call": ["reviewer", "m", "c"]}])
        observed[1]["data"]["status"] = "error"
        self.assertEqual(source_basis(observed, "reviewer", "evidence-a.txt", "SOURCE_BYTES")["retrieved"], [])

    def test_metadata_only_read_cannot_establish_retrieved_source_content(self):
        observed = [{"type": "tool-after", "data": {"sessionID": "reviewer", "messageID": "m", "id": "c",
            "tool": "read", "input": {"path": "evidence-a.txt"}, "status": "completed",
            "result": {"content": [{"type": "text", "text": "No content returned"}],
                       "metadata": {"debug": "SOURCE_BYTES"}}}}]
        self.assertEqual(source_basis(observed, "reviewer", "evidence-a.txt", "SOURCE_BYTES")["retrieved"], [])

    def test_provider_metadata_and_reviewer_assertions_do_not_become_source_supply(self):
        prompt = [{"role": "assistant", "content": [{"type": "text", "text": "SOURCE_BYTES"}]},
                  {"role": "user", "content": [{"type": "text", "text": "Only a pointer", "metadata": "SOURCE_BYTES"}]},
                  {"role": "tool", "content": [None, {"type": "tool-result", "output": None},
                      {"type": "tool-result", "output": {"type": "text", "value": "No source", "metadata": "SOURCE_BYTES"}}]}]
        event = {"type": "provider-request", "data": {"headers": {"x-opencode-session-id": "reviewer"}, "prompt": prompt}}
        self.assertEqual(source_basis([event], "reviewer", "evidence-a.txt", "SOURCE_BYTES")["supplied"], [])

    def test_unavailable_runtime_records_every_case_unqualified_and_no_native_pass(self):
        from installed_native_review import run
        with tempfile.TemporaryDirectory() as temporary:
            output = Path(temporary) / "report"
            report = run(argparse.Namespace(repository=Path(__file__).resolve().parents[1],
                report_directory=output, opencode=None, plugin=None, artifact=None))
            self.assertEqual(report["status"], "UNQUALIFIED")
            self.assertEqual(report["execution_status"], "UNQUALIFIED")
            self.assertFalse(report["checks"])
            self.assertTrue(all(row["status"] == "UNQUALIFIED" for row in report["scenarios"].values()))
            self.assertEqual(json.loads((output / "report.json").read_text()), report)


if __name__ == "__main__":
    unittest.main()
